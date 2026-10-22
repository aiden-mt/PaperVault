// Trích xuất lại MỘT mục của ghi chú thay vì toàn bộ. Model vẫn đọc cả paper (cần ngữ cảnh), nhưng chỉ viết lại các
// trường của mục được chọn, các mục khác giữ nguyên, kể cả phần người dùng đã sửa tay.
import { store, savePaper, paperById } from './store.js';
import { fixLanguage } from './langfix.js';
import { complete, NATIVE_PDF_PROVIDERS, settingsFor, modelLabel } from './llm.js';
import { EXTRACTION_SCHEMA, normalizeExtraction } from './schema.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';
import { prepareSource } from './extract.js';
import { sourceLang } from './notes-i18n.js';
import { parseLooseJson } from './util.js';
import { api } from './api.js';

/** Mỗi mục trên màn hình ứng với những trường nào của bản ghi chú. Dạng 'validation.setup' là trường con. */
export const SECTION_FIELDS = {
  s12: ['title', 'authors', 'venue', 'year', 'one_liner'],
  s3: ['problem', 'motivation'],
  s4: ['bottleneck'],
  s5: ['objective'],
  s6: ['key_idea', 'novelty'],
  s7: ['contributions'],
  s8: ['dataset_details'],
  s9: ['validation.setup', 'validation.baselines', 'validation.benchmarks', 'validation.metrics', 'validation.ablation'],
  s10: ['validation.findings', 'validation.main_results', 'dataset_metric_note'],
  s11: ['limitation'],
  s12b: ['relevance', 'applicable_ideas'],
  refs: ['doi', 'code_url'],
  evidence: ['evidence'],
  chain: ['argument_chain'],
  warnings: ['reader_warnings'],
};

/** Schema chỉ gồm các trường của mục: lấy nguyên định nghĩa từ schema đầy đủ để mô tả từng trường không lệch. */
function partialSchema(fields) {
  const props = {};
  for (const f of fields) {
    const [top, sub] = f.split('.');
    const node = EXTRACTION_SCHEMA.properties[top];
    if (!node) continue;
    if (!sub) { props[top] = node; continue; }
    if (!props[top]) props[top] = { type: 'object', additionalProperties: false, required: [], properties: {} };
    if (node.properties?.[sub]) { props[top].properties[sub] = node.properties[sub]; props[top].required.push(sub); }
  }
  return { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props };
}

/** Giá trị hiện tại của các trường (đưa cho model tham khảo, và để hoàn tác). */
function pickFields(e, fields) {
  const out = {};
  for (const f of fields) {
    const [top, sub] = f.split('.');
    if (!sub) out[top] = e[top];
    else { out[top] = out[top] || {}; out[top][sub] = e[top]?.[sub]; }
  }
  return structuredClone(out);
}

/** Ghép phần mới vào bản ghi chú: chỉ đè đúng các trường của mục. */
export function mergeFields(extraction, fields, patch) {
  const e = structuredClone(extraction);
  for (const f of fields) {
    const [top, sub] = f.split('.');
    if (patch?.[top] === undefined) continue;
    if (!sub) e[top] = patch[top];
    else if (patch[top] && patch[top][sub] !== undefined) e[top] = { ...(e[top] || {}), [sub]: patch[top][sub] };
  }
  const lang = extraction.lang;
  const out = normalizeExtraction(e);
  if (lang) out.lang = lang;
  return out;
}

/**
 * Trích xuất lại một mục. hint: yêu cầu thêm của người dùng (tuỳ chọn).
 * Trả về { paper, previous } với previous là giá trị cũ của các trường (để hoàn tác bằng restoreSection).
 */
export async function reExtractSection(paperId, key, { label = '', hint = '', onStatus = () => {} } = {}) {
  const fields = SECTION_FIELDS[key];
  if (!fields) throw new Error('Mục này không trích xuất lại riêng được.');
  const p = paperById(paperId);
  const current = normalizeExtraction(p.extraction);
  const t = await api.getText(paperId).catch(() => ({}));
  if (!p.pdfId && (t.text || '').length < 120) throw new Error('Chưa có nội dung nguồn hoặc PDF để trích xuất. Vào tab Nguồn hoặc PDF để bổ sung.');
  const source = await prepareSource({ url: p.url, title: p.title, arxivId: p.arxivId, doi: p.doi, kind: t.kind || p.sourceKind, text: t.text || '', pdfId: p.pdfId, pdfName: p.pdfName }, { onStatus });
  // Viết đúng ngôn ngữ của bản ghi chú hiện có, không theo Cài đặt, để một bản ghi chú không lẫn hai thứ tiếng.
  const settings = { ...store.settings, language: sourceLang(current) };
  const nativePdf = !!source.pdfBase64 && NATIVE_PDF_PROVIDERS.has(settingsFor(settings, 'extract-section').provider) && settings.pdfMode !== 'text';
  if (!nativePdf && (source.text || '').trim().length < 120) throw new Error('Nội dung paper quá ngắn để trích xuất.');
  const previous = pickFields(current, fields);
  const user = [
    buildUserPrompt({ source: { ...source, attachedPdf: nativePdf }, settings, topicNames: store.topics.map((x) => x.name) }),
    '',
    '## Nhiệm vụ lần này',
    `CHỈ trích xuất lại mục "${label || key}", gồm các trường: ${fields.join(', ')}. Không trả về trường nào khác.`,
    'Đọc lại phần liên quan trong paper và viết lại từ đầu cho chính xác và đủ chi tiết. Mọi quy tắc ở trên vẫn áp dụng.',
    `Bản hiện tại của mục này, chỉ để tham khảo (có thể thiếu hoặc sai, đừng chép lại nguyên):\n${JSON.stringify(previous)}`,
    hint.trim() ? `Yêu cầu thêm của người đọc cho mục này: ${hint.trim()}` : '',
  ].filter((x) => x !== '').join('\n');
  onStatus(`Đang gọi ${modelLabel(settings, 'extract-section')}…`);
  const out = await complete({
    settings, system: buildSystemPrompt(settings), user, schema: partialSchema(fields), schemaName: 'paper_section',
    pdfBase64: nativePdf ? source.pdfBase64 : null, task: 'extract-section', paperId,
    maxTokens: Math.min(Math.max(settings.maxOutputTokens || 8000, 4000), 8000),
    onRetry: (n, wait) => onStatus(`Bị giới hạn tốc độ, thử lại lần ${n} sau ${Math.round(wait / 1000)}s…`),
  });
  const patch = parseLooseJson(out.text);
  if (!patch || typeof patch !== 'object' || !fields.some((f) => patch[f.split('.')[0]] !== undefined)) throw new Error('Model không trả về nội dung cho mục này, hãy thử lại.');
  await fixLanguage(patch, settings.language); // giữ mục viết lại đúng một thứ tiếng như phần còn lại
  const latest = paperById(paperId);
  const extraction = mergeFields(normalizeExtraction(latest.extraction), fields, patch);
  const patchPaper = { extraction };
  if (key === 's12' && extraction.title) patchPaper.title = extraction.title;
  const paper = await savePaper({ ...latest, ...patchPaper, meta: { ...(latest.meta || {}), sectionRedo: { ...(latest.meta?.sectionRedo || {}), [key]: new Date().toISOString() } } });
  return { paper, previous: { ...previous, __title: latest.title } };
}

/** Hoàn tác: đặt lại giá trị cũ của các trường. */
export async function restoreSection(paperId, key, previous) {
  const latest = paperById(paperId);
  const { __title, ...fieldsPrev } = previous;
  const extraction = mergeFields(normalizeExtraction(latest.extraction), SECTION_FIELDS[key], fieldsPrev);
  return savePaper({ ...latest, extraction, ...(key === 's12' && __title ? { title: __title } : {}) });
}
