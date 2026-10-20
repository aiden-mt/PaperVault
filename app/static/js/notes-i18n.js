// Hiển thị ghi chú trích xuất bằng tiếng Việt hoặc tiếng Anh.
// Ghi chú chỉ trích xuất một lần theo ngôn ngữ trong Cài đặt. Khi xem bằng ngôn ngữ kia, app dịch các trường văn bản
// (Google miễn phí qua máy chủ, hoặc mô hình AI khi người dùng chọn) rồi lưu bản dịch vào paper.notesTr[lang].
// Tên riêng (tiêu đề, tác giả, venue, tên dataset, tên thành phần, metric, con số, link) giữ nguyên.
import { api } from './api.js';
import { savePaper, paperById } from './store.js';
import { normalizeExtraction } from './schema.js';
import { protectMath, restoreMath } from './richtext.js';

export const NOTE_LANGS = [['vi', 'Tiếng Việt'], ['en', 'English']];
const INFERRED = { vi: '(suy luận) ', en: '(inferred) ' };
const INFERRED_RE = /^\s*\((suy luận|inferred)\)\s*/i;

/** Ngôn ngữ gốc của bản ghi chú: lưu lúc trích xuất, paper cũ thì đoán theo dấu tiếng Việt. */
export function sourceLang(e) {
  if (e?.lang === 'vi' || e?.lang === 'en') return e.lang;
  const sample = [e?.problem, e?.bottleneck, e?.key_idea?.summary, e?.novelty, e?.one_liner].filter(Boolean).join(' ');
  if (!sample.trim()) return 'vi';
  return /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(sample) ? 'vi' : 'en';
}

/** Ngôn ngữ cần hiển thị theo Cài đặt (rỗng = giữ ngôn ngữ gốc). */
export function displayLang(settings, e) {
  const want = settings?.notesLang;
  return want === 'vi' || want === 'en' ? want : sourceLang(e);
}

/** Danh sách các trường văn bản cần dịch: [{ path, text }]. path dạng 'key_idea.pipeline.0'. */
function collect(e) {
  const out = [];
  const add = (path, v) => { if (typeof v === 'string' && v.trim()) out.push({ path, text: v }); };
  const each = (path, arr, keys) => (arr || []).forEach((x, i) => {
    if (typeof x === 'string') add(`${path}.${i}`, x);
    else if (x && keys) for (const k of keys) add(`${path}.${i}.${k}`, x[k]);
  });
  ['one_liner', 'problem', 'motivation', 'bottleneck', 'novelty', 'dataset_metric_note'].forEach((k) => add(k, e[k]));
  add('objective.goal', e.objective?.goal);
  add('objective.hypothesis', e.objective?.hypothesis);
  add('key_idea.summary', e.key_idea?.summary);
  each('key_idea.pipeline', e.key_idea?.pipeline);
  each('key_idea.components', e.key_idea?.components, ['detail']);
  each('contributions', e.contributions);
  each('dataset_details', e.dataset_details, ['scale', 'characteristics', 'preprocessing']);
  add('validation.setup', e.validation?.setup);
  add('validation.ablation', e.validation?.ablation);
  add('validation.main_results', e.validation?.main_results);
  each('validation.findings', e.validation?.findings);
  each('limitation.items', e.limitation?.items);
  add('limitation.compute_cost', e.limitation?.compute_cost);
  add('limitation.unresolved', e.limitation?.unresolved);
  add('relevance.project_part', e.relevance?.project_part);
  add('relevance.extend_or_improve', e.relevance?.extend_or_improve);
  each('relevance.citation_claims', e.relevance?.citation_claims);
  each('applicable_ideas', e.applicable_ideas, ['idea', 'how_to_apply']);
  each('evidence', e.evidence, ['claim', 'purpose']);
  each('argument_chain', e.argument_chain, ['step']);
  each('reader_warnings', e.reader_warnings);
  return out;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let cur = obj;
  for (const k of keys) cur = cur[k];
  cur[last] = value;
}

/** Dấu vân tay nội dung gốc, để biết bản dịch đã cũ khi ghi chú được sửa hoặc trích xuất lại. */
function fingerprint(fields) {
  let h = 0;
  const s = fields.map((f) => `${f.path}=${f.text}`).join('␟');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${fields.length}:${h >>> 0}`;
}

function applyTranslations(e, fields, texts, lang) {
  const out = structuredClone(e);
  fields.forEach((f, i) => {
    let t = String(texts[i] ?? '').trim() || f.text;
    if (f.inferred) t = INFERRED[lang] + t.replace(INFERRED_RE, '');
    setPath(out, f.path, t);
  });
  out.lang = lang;
  return out;
}

/** Tách nhãn "(suy luận)" ra trước khi dịch để bộ dịch không làm hỏng, sau đó gắn lại nhãn đúng ngôn ngữ. */
function prepare(e) {
  return collect(e).map((f) => (INFERRED_RE.test(f.text) ? { ...f, inferred: true, text: f.text.replace(INFERRED_RE, '') } : f));
}

/**
 * Bản ghi chú của paper bằng ngôn ngữ lang. Trả về { extraction, translated, engine, at, stale }.
 * Có bản dịch còn mới trong paper.notesTr thì dùng lại, không thì dịch rồi lưu (trừ khi cachedOnly).
 */
export async function notesIn(paper, lang, { cachedOnly = false, translateAI = null } = {}) {
  const e = normalizeExtraction(paper.extraction);
  const src = sourceLang(e);
  if (lang === src) return { extraction: e, translated: false };
  const fields = prepare(e);
  const fp = fingerprint(fields);
  const cached = paper.notesTr?.[lang];
  if (cached?.fp === fp && cached.data && !translateAI) {
    return { extraction: applyTranslations(e, fields, cached.data, lang), translated: true, engine: cached.engine, at: cached.at };
  }
  if (cachedOnly) return null;
  let texts;
  let engine;
  // Công thức LaTeX thay bằng ký hiệu giữ chỗ trước khi dịch, dịch xong đặt lại nguyên văn.
  const guarded = fields.map((f) => protectMath(f.text));
  if (translateAI) {
    texts = await translateAI(guarded.map((g) => g.text), src, lang);
    engine = 'AI';
  } else {
    const r = await api.translate(guarded.map((g) => g.text), lang, src);
    texts = r.items.map((x) => x.translated);
    engine = r.engine || 'Google';
  }
  texts = texts.map((x, i) => restoreMath(x, guarded[i].keep));
  const at = new Date().toISOString();
  const latest = paperById(paper.id) || paper;
  await savePaper({ ...latest, notesTr: { ...(latest.notesTr || {}), [lang]: { fp, data: texts, engine, at } } });
  return { extraction: applyTranslations(e, fields, texts, lang), translated: true, engine, at };
}
