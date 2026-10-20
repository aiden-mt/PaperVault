// Adapter gọi LLM cho 3 nhà cung cấp. Chạy trong service worker (MV3) nên dùng fetch trực tiếp.
import { EXTRACTION_SCHEMA, toGeminiSchema, normalizeExtraction } from './schema.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';
import { parseLooseJson } from './util.js';

export const PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/app/apikey' },
};

/** Provider nhận thẳng file PDF trong request (không cần trích text trước). */
export const NATIVE_PDF_PROVIDERS = new Set(['anthropic', 'gemini']);

/** Các model Anthropic chấp nhận output_config.effort. */
function anthropicSupportsEffort(model) {
  return /^claude-(opus-(5|4-6|4-7|4-8)|sonnet-(5|4-6)|fable-5|mythos-5)/.test(model || '');
}

async function readError(res, provider) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || body?.error?.type || body?.message || JSON.stringify(body).slice(0, 300);
  } catch (_) {
    detail = (await res.text().catch(() => '')).slice(0, 300);
  }
  const hint = {
    401: 'API key sai hoặc chưa nhập. Kiểm tra lại trong Cài đặt.',
    403: 'Key không có quyền dùng model này.',
    404: 'Không tìm thấy model. Kiểm tra lại tên model trong Cài đặt.',
    413: 'Nội dung quá dài. Giảm "Số ký tự tối đa" trong Cài đặt.',
    429: 'Bị giới hạn tốc độ hoặc hết quota. Thử lại sau ít phút.',
  }[res.status] || (res.status >= 500 ? 'Lỗi phía máy chủ nhà cung cấp, thử lại sau.' : '');
  const err = new Error(`[${provider} ${res.status}] ${hint} ${detail}`.trim());
  err.status = res.status;
  throw err;
}

/* ------------------------- Anthropic ------------------------- */

async function callAnthropic({ apiKey, model, system, user, maxTokens, effort, pdfBase64 }) {
  const content = pdfBase64
    ? [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: user },
      ]
    : user;

  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
    output_config: {
      format: { type: 'json_schema', schema: EXTRACTION_SCHEMA },
    },
  };
  if (effort && anthropicSupportsEffort(model)) body.output_config.effort = effort;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Bắt buộc khi gọi API trực tiếp từ môi trường trình duyệt / extension.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) await readError(res, 'Anthropic');

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('Model từ chối xử lý nội dung này (stop_reason: refusal).');
  }
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (data.stop_reason === 'max_tokens') {
    throw new Error('Phản hồi bị cắt vì chạm giới hạn token. Tăng "Max output tokens" trong Cài đặt.');
  }
  return { text, usage: data.usage, model: data.model };
}

/* -------------------------- OpenAI --------------------------- */

async function callOpenAI({ apiKey, model, system, user, maxTokens }) {
  const usesCompletionTokens = /^(o\d|gpt-5)/.test(model || '');
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'paper_extraction', strict: true, schema: EXTRACTION_SCHEMA },
    },
  };
  body[usesCompletionTokens ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) await readError(res, 'OpenAI');

  const data = await res.json();
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) throw new Error(`Model từ chối: ${choice.message.refusal}`);
  if (choice?.finish_reason === 'length') {
    throw new Error('Phản hồi bị cắt vì chạm giới hạn token. Tăng "Max output tokens" trong Cài đặt.');
  }
  return { text: choice?.message?.content || '', usage: data.usage, model: data.model };
}

/* -------------------------- Gemini --------------------------- */

async function callGemini({ apiKey, model, system, user, maxTokens, pdfBase64 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const parts = pdfBase64
    ? [{ inlineData: { mimeType: 'application/pdf', data: pdfBase64 } }, { text: user }]
    : [{ text: user }];
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(EXTRACTION_SCHEMA),
      maxOutputTokens: maxTokens,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await readError(res, 'Gemini');

  const data = await res.json();
  const cand = data.candidates?.[0];
  if (!cand) throw new Error(`Gemini không trả về kết quả: ${JSON.stringify(data.promptFeedback || {}).slice(0, 200)}`);
  if (cand.finishReason === 'MAX_TOKENS') {
    throw new Error('Phản hồi bị cắt vì chạm giới hạn token. Tăng "Max output tokens" trong Cài đặt.');
  }
  const text = (cand.content?.parts || []).map((p) => p.text || '').join('');
  return { text, usage: data.usageMetadata, model };
}

/* ------------------------- Entry point ----------------------- */

function pickCredentials(settings) {
  const provider = settings.provider || 'anthropic';
  const apiKey = (settings.apiKeys?.[provider] || '').trim();
  const model = (settings.models?.[provider] || '').trim();
  if (!apiKey) {
    throw new Error(`Chưa có API key cho ${PROVIDERS[provider]?.label || provider}. Mở Cài đặt để nhập key.`);
  }
  if (!model) throw new Error(`Chưa chọn model cho ${PROVIDERS[provider]?.label || provider}.`);
  return { provider, apiKey, model };
}

async function dispatch({ provider, apiKey, model, system, user, settings, pdfBase64 }) {
  const args = {
    apiKey, model, system, user, pdfBase64,
    maxTokens: settings.maxOutputTokens || 8000,
    effort: settings.effort,
  };
  if (provider === 'anthropic') return callAnthropic(args);
  if (provider === 'openai') return callOpenAI(args);
  if (provider === 'gemini') return callGemini(args);
  throw new Error(`Provider không hỗ trợ: ${provider}`);
}

/**
 * Trích xuất 5 mục từ nội dung paper.
 * source: { url, title, authors, venue, arxivId, kind, text }
 */
export async function extractPaper({ source, settings, topicNames = [] }) {
  const { provider, apiKey, model } = pickCredentials(settings);

  // Quyết định gửi thẳng PDF hay dùng text đã trích.
  const hasPdf = !!source?.pdfBase64;
  const nativePdf = hasPdf
    && NATIVE_PDF_PROVIDERS.has(provider)
    && settings.pdfMode !== 'text';

  if (hasPdf && !nativePdf && !(source.text || '').trim()) {
    throw new Error(
      `${PROVIDERS[provider]?.label || provider} không nhận file PDF trực tiếp, mà extension cũng không trích được text từ PDF này. `
      + 'Hãy đổi sang Claude/Gemini trong Cài đặt, hoặc copy nội dung paper rồi dán vào ô text.',
    );
  }
  if (!nativePdf && (!source?.text || source.text.trim().length < 120)) {
    throw new Error('Nội dung paper quá ngắn (<120 ký tự). Hãy mở trang abstract/full text, dán text thủ công hoặc chọn file PDF.');
  }

  const system = buildSystemPrompt(settings);
  const user = buildUserPrompt({ source: { ...source, attachedPdf: nativePdf }, settings, topicNames });

  const started = Date.now();
  const raw = await dispatch({
    provider, apiKey, model, system, user, settings,
    pdfBase64: nativePdf ? source.pdfBase64 : null,
  });
  const extraction = normalizeExtraction(parseLooseJson(raw.text));

  return {
    extraction,
    meta: {
      provider,
      model: raw.model || model,
      usage: raw.usage || null,
      elapsedMs: Date.now() - started,
      inputChars: (source.text || '').length,
      kind: source.kind || '',
      pdfMode: nativePdf ? 'file PDF gửi thẳng cho model' : (hasPdf ? 'text trích từ PDF' : ''),
      extractedAt: new Date().toISOString(),
    },
  };
}

/** Gọi thử 1 request rất nhỏ để kiểm tra key/model trong trang Cài đặt. */
export async function testConnection(settings) {
  const { provider, apiKey, model } = pickCredentials(settings);
  const system = 'Trả lời đúng một từ.';
  const user = 'Nói: OK';

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: 64, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!res.ok) await readError(res, 'Anthropic');
    return `Kết nối OK với ${model}.`;
  }
  if (provider === 'openai') {
    const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    body[/^(o\d|gpt-5)/.test(model) ? 'max_completion_tokens' : 'max_tokens'] = 64;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) await readError(res, 'OpenAI');
    return `Kết nối OK với ${model}.`;
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: user }] }] }),
    },
  );
  if (!res.ok) await readError(res, 'Gemini');
  return `Kết nối OK với ${model}.`;
}
