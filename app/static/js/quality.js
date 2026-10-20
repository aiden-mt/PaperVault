// Kiểm tra cơ học cho ghi chú trích xuất và câu trả lời Chat (ý tưởng từ Loupe: verify.py, depth.py).
//  1. Số liệu: mọi con số trong ghi chú phải có mặt trong toàn văn đã lưu. Không thấy thì CẢNH BÁO, không chặn:
//     bộ bóc text từ PDF có thể sót số trong bảng, nên đây là lời nhắc đối chiếu lại chứ không phải kết luận "bịa".
//  2. Câu chung chung: câu đúng nhưng không mang thông tin ("X cải thiện chất lượng" mà không nói bằng cách nào).
// Hai phía bóc số cố ý KHÔNG đối xứng: phía ghi chú bóc chặt (chỉ thứ trông như số liệu), phía nguồn bóc rộng
// (mọi dãy chữ số) vì nguồn chỉ là nơi để tìm, bóc rộng chỉ làm giảm báo động giả.
import { splitLimitations } from './schema.js';

const MULT = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9, 'nghìn': 1e3, 'ngàn': 1e3, 'triệu': 1e6, 'tỷ': 1e9, 'tỉ': 1e9, thousand: 1e3, million: 1e6, billion: 1e9 };

const normNum = (s) => {
  let t = String(s).replace(/\s/g, '');
  // 1,281,167 -> 1281167 (dấu phẩy ngăn nghìn). 87,8 (dấu phẩy thập phân kiểu Việt) -> 87.8
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  return t.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};

/** Mọi dãy số trong nguồn (bóc rộng tay). Trả về { set: Set<chuỗi đã chuẩn hoá>, values: number[] }. */
export function sourceNumbers(text) {
  const set = new Set();
  const values = [];
  const src = String(text || '').replace(/(\d)\s+([.,])\s*(\d)/g, '$1$2$3'); // "87 . 8" do bóc PDF
  for (const m of src.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const n = normNum(m[0]);
    set.add(n);
    const v = parseFloat(n);
    if (Number.isFinite(v)) values.push(v);
    // 62.30 và 62.3 là một
    if (n.includes('.')) set.add(String(parseFloat(n)));
  }
  return { set, values };
}

// Phía ghi chú: số có phần thập phân, phần trăm, hệ số nhân, hoặc số nguyên từ 13 trở lên. Bỏ qua số nằm trong
// tên riêng (Qwen2.5-7B, GPT-4, ViT-B/16), năm 19xx/20xx, số mục ("Sec 4.1", "Table 3"), nhãn [P1].
const CLAIM_NUM = /(?<![A-Za-z\d._\-/])([+\-−]?\d+(?:[.,]\d+)*)(\s?%|\s?(?:k|K|M|B)\b|\s(?:nghìn|ngàn|triệu|tỷ|tỉ|thousand|million|billion)\b|x\b|×)?(?![\w\-/])/g;
const REF_BEFORE = /(?:sec(?:tion)?\.?|mục|table|bảng|fig(?:ure)?\.?|hình|eq(?:uation)?\.?|công thức|tr\.|trang|page|p\.|appendix|phụ lục|step|bước|v|top-?|@)\s*$/i;

/** Các con số trông như số liệu trong một đoạn ghi chú: [{ raw, norm, value }]. */
export function claimNumbers(text) {
  const out = [];
  const s = String(text || '');
  for (const m of s.matchAll(CLAIM_NUM)) {
    const digits = m[1].replace(/^[+\-−]/, '');
    const unit = (m[2] || '').trim();
    const norm = normNum(digits);
    const value = parseFloat(norm);
    if (!Number.isFinite(value)) continue;
    const before = s.slice(Math.max(0, m.index - 14), m.index);
    if (REF_BEFORE.test(before)) continue;
    const isYear = /^(19|20)\d{2}$/.test(norm) && !unit;
    const plainSmallInt = !norm.includes('.') && !unit && value < 13;
    if (isYear || plainSmallInt) continue;
    out.push({ raw: m[0].trim(), norm, value, unit });
  }
  return out;
}

function inSource(num, src) {
  if (src.set.has(num.norm) || src.set.has(String(num.value))) return true;
  // 1.28M trong ghi chú, 1,281,167 trong bài (và ngược lại): so giá trị, cho lệch 1,5% do làm tròn.
  const mult = MULT[num.unit];
  const target = mult ? num.value * mult : num.value;
  if (mult || num.value >= 1000) {
    const cands = mult ? [target] : [target, target / 1e3, target / 1e6];
    return src.values.some((v) => cands.some((c) => c > 0 && Math.abs(v - c) / c <= 0.015));
  }
  // 0.878 trong bài, 87.8% trong ghi chú (và ngược lại)
  if (num.unit === '%' && src.set.has(normNum(String(num.value / 100)))) return true;
  if (num.value < 1 && src.set.has(normNum(String(Math.round(num.value * 1000) / 10)))) return true;
  return false;
}

/** Các trường ghi chú cần đối chiếu số: [{ label, text }]. Bỏ phần liên hệ đề tài (không lấy từ paper) và cột Δ (số tự tính). */
function numericFields(e) {
  const out = [];
  const add = (label, v) => { if (typeof v === 'string' && v.trim()) out.push({ label, text: v }); };
  const each = (label, arr, pick = (x) => x) => (arr || []).forEach((x) => add(label, pick(x)));
  add('Tóm tắt một câu', e.one_liner);
  add('3. Problem', e.problem);
  add('3. Motivation', e.motivation);
  add('4. Research Gap', e.bottleneck);
  add('5. Objective', e.objective?.goal);
  add('6. Method · ý tưởng', e.key_idea?.summary);
  each('6. Method · pipeline', e.key_idea?.pipeline);
  each('6. Method · kỹ thuật', e.key_idea?.components, (c) => c?.detail);
  add('6. Method · điểm khác biệt', e.novelty);
  each('7. Contribution', e.contributions);
  each('8. Dataset', e.dataset_details, (d) => [d?.scale, d?.characteristics, d?.preprocessing].filter(Boolean).join(' · '));
  add('9. Experiments · setup', e.validation?.setup);
  each('9. Experiments · kết quả số', e.validation?.metrics, (m) => [m?.baseline, m?.proposed].filter(Boolean).join(' / '));
  add('9. Experiments · ablation', e.validation?.ablation);
  each('10. Findings', e.validation?.findings);
  add('10. Findings · kết quả hỗ trợ', e.validation?.main_results);
  add('10. Findings · tóm tắt', e.dataset_metric_note);
  each('11. Limitations', e.limitation?.items);
  add('11. Limitations · chi phí', e.limitation?.compute_cost);
  each('Important Evidence', e.evidence, (x) => x?.claim);
  return out;
}

/**
 * Đối chiếu số liệu của ghi chú với toàn văn. Trả về { checked, missing: [{ label, number, excerpt }], coverage }.
 * coverage: 'full' | 'abstract' (chỉ có abstract, không đủ để đối chiếu) | 'none' (không có text).
 */
export function checkNumbers(extraction, sourceText, sourceKind = '') {
  const text = String(sourceText || '');
  const coverage = text.length < 400 ? 'none' : (text.length < 4000 || /abstract/i.test(sourceKind) && !/full|pdf/i.test(sourceKind) ? 'abstract' : 'full');
  if (coverage === 'none') return { checked: 0, missing: [], coverage };
  const src = sourceNumbers(text);
  const missing = [];
  const seen = new Set();
  let checked = 0;
  for (const f of numericFields(extraction || {})) {
    for (const n of claimNumbers(f.text)) {
      checked += 1;
      if (inSource(n, src)) continue;
      const key = `${f.label}|${n.norm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const at = f.text.indexOf(n.raw);
      const from = Math.max(0, at - 60);
      missing.push({ label: f.label, number: n.raw, excerpt: `${from ? '…' : ''}${f.text.slice(from, at + n.raw.length + 60).trim()}${at + n.raw.length + 60 < f.text.length ? '…' : ''}` });
    }
  }
  return { checked, missing, coverage };
}

/** Đối chiếu số trong câu trả lời Chat với tài liệu đã gửi cho model. Trả về mảng chuỗi số không thấy. */
export function unverifiedNumbers(answer, contextText) {
  const src = sourceNumbers(contextText);
  // Bỏ khối code, và những câu model tự ghi là kiến thức ngoài tài liệu.
  const body = String(answer || '').replace(/```[\s\S]*?```/g, ' ').split(/(?<=[.!?\n])\s+/).filter((s) => !/ngoài tài liệu|outside the (provided )?documents/i.test(s)).join(' ');
  const out = [];
  for (const n of claimNumbers(body)) if (!inSource(n, src) && !out.includes(n.raw)) out.push(n.raw);
  return out;
}

/* ---------- Câu chung chung ---------- */

const FILLER = [
  /đóng (một )?vai trò (quan trọng|then chốt|thiết yếu)/i, /góp phần (nâng cao|cải thiện|thúc đẩy)/i, /có ý nghĩa (quan trọng|to lớn)/i,
  /mang lại (hiệu quả|kết quả) (cao|tốt|đáng kể)/i, /một cách hiệu quả/i, /đạt (được )?kết quả (tốt|khả quan|ấn tượng|vượt trội)(?![^.]*\d)/i,
  /plays? an? (important|crucial|key|vital) role/i, /achieves? (promising|impressive|superior|strong|good) (results|performance)(?![^.]*\d)/i,
  /state-of-the-art (results|performance)(?![^.]*\d)/i, /significantly (improves?|outperforms?)(?![^.]*\d)/i,
];
const VAGUE_VERB = /(cải thiện|nâng cao|tối ưu( hoá| hóa)?|tăng cường|improv(es?|ing)|enhanc(es?|ing)|boosts?|optimi[sz](es?|ing))/i;
const HOW = /(bằng cách|bằng việc|nhờ|thông qua|qua việc|bằng |by |via |using |through |with a |with an )/i;
const CAUSAL = /(\bvì\b|\bdo\b|\bnên\b|nhờ|để |bằng cách|dẫn đến|khiến|từ đó|do đó|because|since |so that|therefore|thus|hence|leads? to|which |→|->)/i;
const hasDigit = (s) => /\d/.test(s);
const sentences = (text) => String(text || '').split(/(?<=[.!?])\s+(?=[A-ZÀ-Ỵ(\d])/).map((s) => s.trim()).filter((s) => s.length > 25);
const words = (s) => new Set(String(s || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);

function shallowReason(sentence) {
  const filler = FILLER.find((re) => re.test(sentence));
  if (filler) return 'cụm chung chung, không mang thông tin';
  if (VAGUE_VERB.test(sentence) && !HOW.test(sentence) && !hasDigit(sentence)) return 'nói "cải thiện" mà không nói bằng cách nào hay bao nhiêu';
  if (sentence.length > 170 && !CAUSAL.test(sentence) && !hasDigit(sentence)) return 'câu dài nhưng không có cơ chế, quan hệ nhân quả hay con số';
  return '';
}

/** Câu chung chung trong một đoạn văn bất kỳ: [{ reason, text }]. Dùng cho bài giảng. */
export function shallowSentences(text) {
  const out = [];
  for (const s of sentences(text)) { const r = shallowReason(s); if (r) out.push({ reason: r, text: s }); }
  return out;
}

/** Tìm câu chung chung trong các mục cần chiều sâu. Trả về [{ label, reason, text }]. */
export function checkDepth(extraction) {
  const e = extraction || {};
  const out = [];
  const scan = (label, text) => { for (const s of sentences(text)) { const r = shallowReason(s); if (r) out.push({ label, reason: r, text: s }); } };
  const each = (label, arr) => (arr || []).forEach((x) => { if (typeof x === 'string') { const r = shallowReason(x); if (r && x.length > 25) out.push({ label, reason: r, text: x }); } });
  scan('6. Method · ý tưởng', e.key_idea?.summary);
  scan('6. Method · điểm khác biệt', e.novelty);
  each('6. Method · pipeline', e.key_idea?.pipeline);
  each('7. Contribution', e.contributions);
  each('10. Findings', e.validation?.findings);
  scan('10. Findings · kết quả hỗ trợ', e.validation?.main_results);
  each('11. Limitations', splitLimitations(e.limitation?.items).observed);
  // Giải thích vòng quanh: mô tả thành phần chỉ lặp lại tên của nó.
  for (const c of e.key_idea?.components || []) {
    const name = words(c?.name);
    const detail = [...words(c?.detail)];
    if (!c?.detail || !name.size) continue;
    const fresh = detail.filter((w) => !name.has(w));
    if (detail.length <= 4 || fresh.length / detail.length < 0.4) out.push({ label: '6. Method · kỹ thuật', reason: 'mô tả chỉ lặp lại tên thành phần, chưa nói nó hoạt động thế nào', text: `${c.name}: ${c.detail}` });
  }
  return out.slice(0, 12);
}
