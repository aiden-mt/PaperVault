// Adapter LLM cho 3 nhà cung cấp (Anthropic / OpenAI / Gemini), gọi trực tiếp từ trình duyệt.
// Có một hàm `complete` dùng chung (JSON schema tuỳ chọn, PDF đính kèm tuỳ chọn);
// các tác vụ (trích xuất, hỏi đáp, tổng hợp) xây trên đó.
import { EXTRACTION_SCHEMA, toGeminiSchema, normalizeExtraction } from './schema.js';
import {
  buildSystemPrompt, buildUserPrompt, buildAskSystem, buildAskContext, translateRules,
  SYNTHESIS_SCHEMA, buildSynthesisSystem, buildSynthesisUser,
} from './prompts.js';
import { parseLooseJson, fixMixedScript } from './util.js';
import { api } from './api.js';

export const PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/app/apikey' },
};

/** Provider nhận thẳng file PDF trong request. */
export const NATIVE_PDF_PROVIDERS = new Set(['anthropic', 'gemini']);

function anthropicSupportsEffort(model) {
  return /^claude-(opus-(5|4-6|4-7|4-8)|sonnet-(5|4-6)|fable-5|mythos-5)/.test(model || '');
}

/**
 * Các model Claude có bộ lọc an toàn có thể từ chối (stop_reason "refusal") -> bật server-side fallback:
 * API tự chạy lại yêu cầu bị từ chối trên model phù hợp thay vì trả về lời từ chối.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
let fallbackUnsupported = false;
function anthropicUsesFallback(model) {
  return !fallbackUnsupported && /^claude-(opus-5|fable-5|mythos-5)/.test(model || '');
}
function anthropicHeaders(apiKey, model) {
  const h = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    // Bắt buộc khi gọi API trực tiếp từ trình duyệt.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (anthropicUsesFallback(model)) h['anthropic-beta'] = FALLBACK_BETA;
  return h;
}
/** Nếu tài khoản / model không nhận tham số fallback (400 nhắc tới fallback) thì tắt nó và gửi lại. */
async function anthropicFetch(apiKey, body, { signal } = {}) {
  const send = () => {
    const b = { ...body };
    if (anthropicUsesFallback(b.model)) b.fallbacks = 'default';
    return fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: anthropicHeaders(apiKey, b.model), body: JSON.stringify(b), signal });
  };
  let res = await send();
  if (res.status === 400 && anthropicUsesFallback(body.model)) {
    const txt = await res.clone().text().catch(() => '');
    if (/fallback/i.test(txt)) { fallbackUnsupported = true; res = await send(); }
  }
  return res;
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

const TRUNCATED = 'Phản hồi bị cắt vì chạm giới hạn token. Tăng "Max output tokens" trong Cài đặt.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Thử lại khi bị giới hạn tốc độ (429), lỗi máy chủ (5xx) hoặc rớt mạng: chờ 3s, 8s, 20s. */
async function withRetry(fn, { onRetry = () => {} } = {}) {
  const delays = [3000, 8000, 20000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const retriable = e?.status === 429 || e?.status === 529 || (e?.status >= 500 && e?.status < 600) || /Failed to fetch|NetworkError|load failed/i.test(e?.message || '');
      if (e?.noRetry || !retriable || attempt >= delays.length) throw e;
      onRetry(attempt + 1, delays[attempt], e);
      await sleep(delays[attempt]);
    }
  }
}

function tokensOf(usage) {
  if (!usage) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const cacheRead = usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cachedContentTokenCount ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  let input = usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount ?? 0;
  // OpenAI/Gemini tính token cache nằm trong prompt_tokens; Anthropic tách riêng -> quy về "input không cache".
  if (usage.prompt_tokens != null || usage.promptTokenCount != null) input = Math.max(0, input - cacheRead);
  return { input, output: usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount ?? 0, cacheRead, cacheWrite };
}

function logUsage({ provider, model, task, paperId, usage }) {
  const tk = tokensOf(usage);
  if (tk.input || tk.output || tk.cacheRead || tk.cacheWrite) {
    api.logUsage({ at: new Date().toISOString(), provider, model, task, inputTokens: tk.input, outputTokens: tk.output, cacheRead: tk.cacheRead, cacheWrite: tk.cacheWrite, paperId });
  }
}

/* ------------------------- Anthropic ------------------------- */

async function callAnthropic({ apiKey, model, system, messages, maxTokens, effort, schema, pdfBase64, cacheSystem }) {
  const msgs = messages.map((m, i) => {
    if (i === 0 && pdfBase64 && m.role === 'user') {
      return { role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: m.content },
      ] };
    }
    return { role: m.role, content: m.content };
  });
  // cacheSystem: system prompt lớn và giống hệt nhau giữa nhiều lượt gọi (toàn văn paper) -> lượt sau chỉ trả giá đọc cache.
  const body = { model, max_tokens: maxTokens, system: cacheSystem ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system, messages: msgs };
  if (schema) body.output_config = { format: { type: 'json_schema', schema } };
  if (effort && anthropicSupportsEffort(model)) {
    body.output_config = body.output_config || {};
    body.output_config.effort = effort;
  }
  const res = await anthropicFetch(apiKey, body);
  if (!res.ok) await readError(res, 'Anthropic');
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error(`Model từ chối xử lý nội dung này${data.stop_details?.category ? ` (nhóm: ${data.stop_details.category})` : ''}.`);
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (data.stop_reason === 'max_tokens') throw new Error(TRUNCATED);
  return { text, usage: data.usage, model: data.model };
}

/* -------------------------- OpenAI --------------------------- */

async function callOpenAI({ apiKey, model, system, messages, maxTokens, schema, schemaName }) {
  const usesCompletionTokens = /^(o\d|gpt-5)/.test(model || '');
  const body = { model, messages: [{ role: 'system', content: system }, ...messages] };
  if (schema) body.response_format = { type: 'json_schema', json_schema: { name: schemaName || 'output', strict: true, schema } };
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
  if (choice?.finish_reason === 'length') throw new Error(TRUNCATED);
  return { text: choice?.message?.content || '', usage: data.usage, model: data.model };
}

/* -------------------------- Gemini --------------------------- */

async function callGemini({ apiKey, model, system, messages, maxTokens, schema, pdfBase64 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const contents = messages.map((m, i) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: (i === 0 && pdfBase64 && m.role === 'user')
      ? [{ inlineData: { mimeType: 'application/pdf', data: pdfBase64 } }, { text: m.content }]
      : [{ text: m.content }],
  }));
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (schema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = toGeminiSchema(schema);
  }
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) await readError(res, 'Gemini');
  const data = await res.json();
  const cand = data.candidates?.[0];
  if (!cand) throw new Error(`Gemini không trả về kết quả: ${JSON.stringify(data.promptFeedback || {}).slice(0, 200)}`);
  if (cand.finishReason === 'MAX_TOKENS') throw new Error(TRUNCATED);
  const text = (cand.content?.parts || []).map((p) => p.text || '').join('');
  return { text, usage: data.usageMetadata, model };
}

/* ------------------------- Entry point ----------------------- */

export function pickCredentials(settings) {
  const provider = settings.provider || 'anthropic';
  const apiKey = (settings.apiKeys?.[provider] || '').trim();
  const model = (settings.models?.[provider] || '').trim();
  if (!apiKey) throw new Error(`Chưa có API key cho ${PROVIDERS[provider]?.label || provider}. Mở Cài đặt để nhập key.`);
  if (!model) throw new Error(`Chưa chọn model cho ${PROVIDERS[provider]?.label || provider}.`);
  return { provider, apiKey, model };
}

export function hasCredentials(settings) {
  try { pickCredentials(settings); return true; } catch (_) { return false; }
}

/**
 * Gọi model. messages: [{role:'user'|'assistant', content}] (nếu chỉ có `user` thì tự tạo).
 * Trả về { text, usage, model, provider }.
 */
export async function complete({ settings, system, user, messages, schema = null, schemaName = 'output', pdfBase64 = null, maxTokens, effort, task = '', paperId = '', onRetry, cacheSystem = false }) {
  const { provider, apiKey, model } = pickCredentials(settings);
  const args = {
    apiKey, model, system,
    messages: messages || [{ role: 'user', content: user }],
    maxTokens: maxTokens || settings.maxOutputTokens || 8000,
    effort: effort || settings.effort,
    schema, schemaName, cacheSystem,
    pdfBase64: pdfBase64 && NATIVE_PDF_PROVIDERS.has(provider) ? pdfBase64 : null,
  };
  const fn = { anthropic: callAnthropic, openai: callOpenAI, gemini: callGemini }[provider];
  if (!fn) throw new Error(`Provider không hỗ trợ: ${provider}`);
  const out = await withRetry(() => fn(args), { onRetry });
  logUsage({ provider, model: out.model || model, task, paperId, usage: out.usage });
  return { ...out, provider, model: out.model || model };
}

/** Trích xuất ghi chú theo template. source: { url, title, authors, venue, year, arxivId, kind, text, pdfBase64 } */
export async function extractPaper({ source, settings, topicNames = [], onRetry }) {
  const { provider } = pickCredentials(settings);
  const hasPdf = !!source?.pdfBase64;
  const nativePdf = hasPdf && NATIVE_PDF_PROVIDERS.has(provider) && settings.pdfMode !== 'text';

  if (hasPdf && !nativePdf && !(source.text || '').trim()) {
    throw new Error(`${PROVIDERS[provider]?.label || provider} không nhận file PDF trực tiếp, mà app cũng không trích được text từ PDF này. Hãy đổi sang Claude/Gemini trong Cài đặt, hoặc dán nội dung paper vào ô text.`);
  }
  if (!nativePdf && (!source?.text || source.text.trim().length < 120)) {
    throw new Error('Nội dung paper quá ngắn (<120 ký tự). Hãy dùng link full text, dán text hoặc chọn file PDF.');
  }

  const system = buildSystemPrompt(settings);
  const user = buildUserPrompt({ source: { ...source, attachedPdf: nativePdf }, settings, topicNames });
  const started = Date.now();
  const raw = await complete({
    settings, system, user, schema: EXTRACTION_SCHEMA, schemaName: 'paper_extraction',
    pdfBase64: nativePdf ? source.pdfBase64 : null, task: 'extract', paperId: source.exceptId || '', onRetry,
    maxTokens: extractionOutputTokens(settings, provider),
  });
  const extraction = normalizeExtraction(parseLooseJson(raw.text));
  extraction.lang = settings.language === 'en' ? 'en' : 'vi'; // để biết khi nào cần dịch lúc hiển thị
  return {
    extraction,
    meta: {
      provider: raw.provider,
      model: raw.model,
      usage: raw.usage || null,
      elapsedMs: Date.now() - started,
      inputChars: (source.text || '').length,
      kind: source.kind || '',
      pdfMode: nativePdf ? 'file PDF gửi thẳng cho model' : (hasPdf ? 'text trích từ PDF' : ''),
      extractedAt: new Date().toISOString(),
    },
  };
}

/** Bản ghi chú theo template dài hơn 5 mục cũ (thêm dataset, evidence, relevance...), nên nâng trần token khi model cho phép. */
function extractionOutputTokens(settings, provider) {
  const base = settings.maxOutputTokens || 8000;
  const model = settings.models?.[provider] || '';
  if (provider === 'anthropic') return Math.max(base, 16000);
  if (provider === 'openai') return Math.min(Math.max(base, 12000), 16000);
  // Gemini 2.5 trở lên cho tới 65k token đầu ra, các bản cũ chỉ 8192.
  return /gemini-(2\.5|[3-9])/.test(model) ? Math.max(base, 16000) : Math.min(base, 8192);
}

const LANG_NAMES = { vi: 'tiếng Việt', en: 'English', ja: 'tiếng Nhật', ko: 'tiếng Hàn', 'zh-CN': 'tiếng Trung giản thể', 'zh-TW': 'tiếng Trung phồn thể', fr: 'tiếng Pháp', de: 'tiếng Đức', es: 'tiếng Tây Ban Nha', ru: 'tiếng Nga', th: 'tiếng Thái' };

/** Dịch một đoạn trong paper bằng mô hình đang dùng (sát văn phong học thuật hơn Google). sentence: câu chứa đoạn đó. */
export async function translateText({ text, sentence = '', targetLang = 'vi', settings, paperTitle = '' }) {
  const lang = LANG_NAMES[targetLang] || targetLang;
  const system = [
    `Bạn là dịch giả học thuật, dịch tài liệu khoa học sang ${lang}. Bản dịch phải giữ nguyên vẹn mạch lập luận của tác giả, không chỉ đúng nghĩa từng câu.`,
    '',
    translateRules(targetLang),
    '',
    'Nếu đoạn cần dịch chỉ là một từ hoặc cụm từ: dịch theo đúng nghĩa trong câu ngữ cảnh. Nếu đó là thuật ngữ nên giữ tiếng Anh thì giữ nguyên và thêm một dòng giải thích ngắn nó là gì.',
    'Chỉ trả về bản dịch, không lời dẫn.',
  ].join('\n');
  const isShort = text.trim().split(/\s+/).length <= 6 && sentence && sentence.trim() !== text.trim();
  const user = [
    paperTitle ? `Paper: ${paperTitle}` : '',
    isShort ? `Câu ngữ cảnh: ${sentence}` : '',
    `Đoạn cần dịch:\n${text}`,
  ].filter(Boolean).join('\n\n');
  const out = await complete({ settings, system, user, maxTokens: 2000, effort: 'low', task: 'translate' });
  return out.text.trim();
}

/** Dịch danh sách đoạn ghi chú (giữ thứ tự, giữ số lượng) bằng mô hình đang dùng. Trả về mảng chuỗi. */
export async function translateNotesAI({ texts, from = 'vi', to = 'en', settings, keep = [] }) {
  const schema = {
    type: 'object', additionalProperties: false, required: ['items'],
    properties: { items: { type: 'array', description: `Bản dịch sang ${LANG_NAMES[to] || to}, đúng thứ tự và đúng số phần tử của đầu vào.`, items: { type: 'string' } } },
  };
  const system = [
    `Bạn dịch ghi chú đọc paper khoa học từ ${LANG_NAMES[from] || from} sang ${LANG_NAMES[to] || to}.`,
    'Dịch chính xác, cô đọng, đúng văn phong ghi chú nghiên cứu. Các đoạn thuộc cùng một paper nên một thuật ngữ phải dịch thống nhất ở mọi đoạn.',
    '',
    translateRules(to),
    keep.length ? `\nTên riêng của paper này, giữ nguyên từng ký tự: ${keep.slice(0, 60).join(', ')}.` : '',
    '',
    'Đầu vào là mảng JSON các đoạn. Trả về JSON {"items": [...]} có đúng số phần tử, phần tử thứ i là bản dịch của đoạn thứ i.',
  ].join('\n');
  const out = await complete({
    settings, system, user: JSON.stringify(texts), schema, schemaName: 'notes_translation',
    maxTokens: Math.max(settings.maxOutputTokens || 8000, 8000), effort: 'low', task: 'translate-notes',
  });
  const items = parseLooseJson(out.text)?.items;
  if (!Array.isArray(items) || items.length !== texts.length) throw new Error('Mô hình trả về số đoạn dịch không khớp, hãy thử lại.');
  return items.map((x) => String(x ?? ''));
}

/** Hỏi đáp về một paper. history: [{role, content}] các lượt trước. */
export async function askPaper({ paper, text, settings, question, history = [], pdfBase64 = null }) {
  const context = buildAskContext({ paper, text: pdfBase64 ? '' : text, settings });
  const first = `${context}\n\n## Câu hỏi\n${history.length ? '(Xem lịch sử hội thoại bên dưới.)' : question}`;
  const messages = [{ role: 'user', content: first }];
  if (history.length) {
    for (const h of history) messages.push({ role: h.role, content: h.content });
    messages.push({ role: 'user', content: question });
  }
  const out = await complete({ settings, system: buildAskSystem(settings), messages, pdfBase64, maxTokens: Math.min(settings.maxOutputTokens || 4000, 4000), effort: settings.effort === 'xhigh' ? 'high' : settings.effort, task: 'ask', paperId: paper.id || '' });
  out.text = fixMixedScript(out.text);
  return out.text.trim();
}

/** Tổng hợp related work từ nhiều paper. */
export async function synthesize({ papers, settings, focus = '' }) {
  const out = await complete({
    settings,
    system: buildSynthesisSystem(settings),
    user: buildSynthesisUser({ papers, settings, focus }),
    schema: SYNTHESIS_SCHEMA,
    schemaName: 'related_work_synthesis',
    task: 'synthesis',
  });
  return { synthesis: parseLooseJson(out.text), meta: { provider: out.provider, model: out.model, usage: out.usage } };
}

/** Gọi thử một request nhỏ để kiểm tra key/model. */
export async function testConnection(settings) {
  const out = await complete({ settings, system: 'Trả lời đúng một từ.', user: 'Nói: OK', maxTokens: 64, effort: 'low', task: 'test' });
  return `Kết nối OK với ${out.model}.`;
}


/* ======================= Streaming cho chatbot ======================= */

/** Đọc Server-Sent Events từ một Response. Trả về từng { event, data } (data là chuỗi JSON). */
async function* sseEvents(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = 'message';
      const data = [];
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) yield { event, data: data.join('\n') };
    }
  }
}

async function streamAnthropic({ apiKey, model, system, messages, maxTokens, effort, onText, signal }) {
  const body = {
    model, max_tokens: maxTokens, stream: true,
    // Khối ngữ cảnh lớn (danh sách paper) được đánh dấu cache: các lượt hỏi sau chỉ tốn phí đọc cache.
    system: system.map((b) => ({ type: 'text', text: b.text, ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}) })),
    messages: messages.map((m, i) => (i === messages.length - 1 && m.role === 'user'
      ? { role: 'user', content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] }
      : { role: m.role, content: m.content })),
  };
  if (effort && anthropicSupportsEffort(model)) body.output_config = { effort };
  const res = await anthropicFetch(apiKey, body, { signal });
  if (!res.ok) await readError(res, 'Anthropic');
  const usage = {};
  let stopReason = '';
  let outModel = model;
  let stopDetails = null;
  for await (const { event, data } of sseEvents(res)) {
    let d;
    try { d = JSON.parse(data); } catch (_) { continue; }
    if (event === 'message_start' || d.type === 'message_start') {
      Object.assign(usage, d.message?.usage || {});
      outModel = d.message?.model || outModel;
    } else if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta') {
      onText(d.delta.text);
    } else if (d.type === 'message_delta') {
      stopReason = d.delta?.stop_reason || stopReason;
      stopDetails = d.delta?.stop_details || stopDetails;
      if (d.usage) Object.assign(usage, d.usage);
    } else if (d.type === 'error' || event === 'error') {
      const err = new Error(`[Anthropic] ${d.error?.message || 'Lỗi khi đang nhận phản hồi.'}`);
      err.status = d.error?.type === 'overloaded_error' ? 529 : 500;
      throw err;
    }
  }
  return { usage, model: outModel, stopReason, stopDetails };
}

async function streamOpenAI({ apiKey, model, system, messages, maxTokens, onText, signal }) {
  const usesCompletionTokens = /^(o\d|gpt-5)/.test(model || '');
  const body = {
    model, stream: true, stream_options: { include_usage: true },
    messages: [{ role: 'system', content: system.map((b) => b.text).join('\n\n') }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
  };
  body[usesCompletionTokens ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal,
  });
  if (!res.ok) await readError(res, 'OpenAI');
  let usage = null;
  let stopReason = '';
  for await (const { data } of sseEvents(res)) {
    if (data === '[DONE]') break;
    let d;
    try { d = JSON.parse(data); } catch (_) { continue; }
    const c = d.choices?.[0];
    if (c?.delta?.content) onText(c.delta.content);
    if (c?.finish_reason) stopReason = c.finish_reason;
    if (d.usage) usage = d.usage;
  }
  return { usage, model, stopReason: stopReason === 'length' ? 'max_tokens' : stopReason };
}

async function streamGemini({ apiKey, model, system, messages, maxTokens, onText, signal }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: system.map((b) => b.text).join('\n\n') }] },
    contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: { maxOutputTokens: maxTokens },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) await readError(res, 'Gemini');
  let usage = null;
  let stopReason = '';
  for await (const { data } of sseEvents(res)) {
    let d;
    try { d = JSON.parse(data); } catch (_) { continue; }
    const cand = d.candidates?.[0];
    for (const part of cand?.content?.parts || []) if (part.text) onText(part.text);
    if (cand?.finishReason) stopReason = cand.finishReason === 'MAX_TOKENS' ? 'max_tokens' : cand.finishReason.toLowerCase();
    if (d.usageMetadata) usage = d.usageMetadata;
  }
  return { usage, model, stopReason };
}

/**
 * Chat có streaming.
 * system: [{ text, cache?: boolean }] — khối nào ổn định giữa các lượt (danh sách paper) thì đặt cache: true.
 * messages: [{ role: 'user'|'assistant', content: string }]
 * onText(chunk) được gọi mỗi khi có chữ mới. Trả về { usage, model, provider, stopReason }.
 */
export async function streamChat({ settings, system, messages, onText, signal, task = 'chat', onRetry }) {
  const { provider, apiKey, model } = pickCredentials(settings);
  const maxTokens = provider === 'anthropic' ? 64000 : Math.min(settings.maxOutputTokens || 8000, provider === 'gemini' ? 8192 : 16000);
  const fn = { anthropic: streamAnthropic, openai: streamOpenAI, gemini: streamGemini }[provider];
  let emitted = false;
  const run = () => fn({ apiKey, model, system, messages, maxTokens, effort: settings.effort, signal, onText: (t) => { emitted = true; onText(t); } });
  // Chỉ thử lại khi chưa nhận được chữ nào (tránh lặp nội dung đã hiện).
  const out = await withRetry(async () => {
    try { return await run(); } catch (e) { if (emitted || e.name === 'AbortError') e.noRetry = true; throw e; }
  }, { onRetry });
  logUsage({ provider, model: out.model || model, task, paperId: '', usage: out.usage });
  if (out.stopReason === 'refusal') {
    const err = new Error(`Model từ chối trả lời câu hỏi này${out.stopDetails?.category ? ` (nhóm: ${out.stopDetails.category})` : ''}.`);
    err.refusal = true;
    throw err;
  }
  return { ...out, provider, model: out.model || model };
}

/** Rút từ khoá tiếng Anh từ câu hỏi (để tìm đoạn liên quan trong paper tiếng Anh). */
export async function englishKeywords({ settings, question }) {
  const out = await complete({
    settings, maxTokens: 300, effort: 'low', task: 'chat-keywords',
    system: 'You convert a research question into English search keywords. Reply with 5-12 comma-separated keywords or short phrases only, no explanation.',
    user: question,
  });
  return out.text.split(/[,\n]/).map((x) => x.trim().replace(/^[-*\d.\s]+/, '')).filter((x) => x && x.length < 60).slice(0, 12);
}
