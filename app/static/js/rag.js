// Tìm đoạn liên quan trong văn bản (BM25 trên các đoạn), dùng chung cho Chat và trợ lý AI của Sổ tay.
import { norm } from './util.js';
import { englishKeywords } from './llm.js';

const STOP = new Set('the a an of to in and or for on with by from as is are was were be been this that these those we our it its at which what how why when where who does do did can could should would will not no than then there their they them into using use used based via also such both each more most other only over under between about'.split(' ')
  .concat('là và của các những cho với được trong một này khi thì mà có không để như về từ theo đã đang sẽ nào gì sao bao nhiêu hay hoặc thế tôi bạn paper bài'.split(' ')));

export function tokenize(s) {
  return norm(s).split(/[^a-z0-9À-ɏḀ-ỿ]+/).filter((t) => t.length > 1 && !STOP.has(t));
}

/** Cắt văn bản thành các đoạn ~size ký tự, gối nhau overlap ký tự, ưu tiên cắt ở chỗ xuống dòng. */
export function chunksOf(text, size = 1400, overlap = 200) {
  const out = [];
  const t = String(text || '').replace(/\r/g, '');
  for (let i = 0; i < t.length; i += size - overlap) {
    let end = Math.min(t.length, i + size);
    const nl = t.lastIndexOf('\n', end);
    if (nl > i + size * 0.6) end = nl;
    out.push(t.slice(i, end).trim());
    if (end >= t.length) break;
  }
  return out.filter((x) => x.length > 80);
}

/**
 * Chấm BM25 cho docs ([{ key, text, terms? }]) theo queryTerms rồi chọn các đoạn điểm cao nhất, tổng không quá budget
 * ký tự, mỗi key (paper / trang) tối đa perKey đoạn. Trả về các doc được chọn (kèm score), theo điểm giảm dần.
 */
export function bm25Pick(docs, queryTerms, { budget = 24000, perKey = 4 } = {}) {
  for (const d of docs) if (!d.terms) d.terms = tokenize(d.text);
  if (!docs.length || !queryTerms.length) return [];
  const df = new Map();
  for (const d of docs) for (const t of new Set(d.terms)) df.set(t, (df.get(t) || 0) + 1);
  const avg = docs.reduce((a, d) => a + d.terms.length, 0) / docs.length || 1;
  const q = [...new Set(queryTerms)];
  for (const d of docs) {
    const tf = new Map();
    for (const t of d.terms) tf.set(t, (tf.get(t) || 0) + 1);
    let s = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
      s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.terms.length / avg));
    }
    d.score = s;
  }
  const picked = [];
  const perDoc = new Map();
  let used = 0;
  for (const d of docs.filter((x) => x.score > 0).sort((a, b) => b.score - a.score)) {
    if ((perDoc.get(d.key) || 0) >= perKey || used + d.text.length > budget) continue;
    picked.push(d);
    used += d.text.length;
    perDoc.set(d.key, (perDoc.get(d.key) || 0) + 1);
    if (used > budget * 0.95) break;
  }
  return picked;
}

const VI = /[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]/i;

/** Từ khoá để tìm đoạn: câu hỏi tiếng Việt, paper tiếng Anh → xin model thêm vài từ khoá tiếng Anh. */
export async function searchTerms(question, settings) {
  let terms = tokenize(question);
  if (VI.test(question)) {
    try { terms = terms.concat(tokenize((await englishKeywords({ settings, question })).join(' '))); } catch (_) { /* vẫn tìm bằng từ gốc */ }
  }
  return terms;
}
