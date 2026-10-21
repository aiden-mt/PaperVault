// Giữ một bản ghi chú đúng một thứ tiếng. Prompt và mô tả schema viết bằng tiếng Việt (có các cụm cố định như
// "Không nêu", "(suy luận)", "(chỉ dựa trên abstract)"), nên khi trích xuất bằng tiếng Anh mô hình đôi khi chép nguyên
// cụm tiếng Việt, hoặc bộ dịch máy chỉ dịch được nửa ("Not nêu"). Hai lớp sửa:
//  - localizeFixed: đổi các cụm cố định sang đúng ngôn ngữ hiển thị (không tốn gì, áp dụng cả cho ghi chú cũ);
//  - fixLanguage: sau khi trích xuất tiếng Anh, chuỗi nào còn chữ tiếng Việt thì dịch sang tiếng Anh (Google, miễn phí).
import { api } from './api.js';
import { protectMath, restoreMath } from './richtext.js';

const VI_CHARS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

// Cả chuỗi chỉ là "không có thông tin".
const NOT_STATED = /^(?:không nêu|not nêu|không nêu rõ|không đề cập|không có thông tin|chưa rõ|chưa nêu|not stated|not mentioned|not reported|not specified|not given|n\/a)\s*\.?$/i;
const FIXED = {
  en: [
    [/\(\s*chỉ dựa trên abstract\s*\)/gi, '(abstract only)'],
    [/\(\s*suy luận\s*\)/gi, '(inferred)'],
    [/\bNot nêu\b/g, 'Not stated'],
    [/\bKhông nêu\b/g, 'Not stated'],
    [/\bkhông nêu\b/g, 'not stated'],
  ],
  vi: [
    [/\(\s*abstract only\s*\)/gi, '(chỉ dựa trên abstract)'],
    [/\(\s*inferred\s*\)/gi, '(suy luận)'],
    [/\bNot nêu\b/g, 'Không nêu'],
  ],
};
const PLACEHOLDER = { en: 'Not stated.', vi: 'Không nêu.' };

function fixString(s, lang) {
  if (typeof s !== 'string' || !s) return s;
  if (NOT_STATED.test(s.trim())) return PLACEHOLDER[lang] || s;
  let out = s;
  for (const [re, to] of FIXED[lang] || []) out = out.replace(re, to);
  return out;
}

/** Bản sao của value (chuỗi / mảng / object) với các cụm cố định đã đổi sang lang. */
export function localizeFixed(value, lang) {
  if (lang !== 'en' && lang !== 'vi') return value;
  if (typeof value === 'string') return fixString(value, lang);
  if (Array.isArray(value)) return value.map((v) => localizeFixed(v, lang));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = localizeFixed(v, lang);
    return out;
  }
  return value;
}

// Không dịch các trường là tên riêng / trích nguyên văn (tên tác giả người Việt có dấu là bình thường).
const SKIP_KEYS = new Set(['title', 'authors', 'venue', 'url', 'doi', 'code', 'links', 'quote', 'lang', 'confidence', 'suggested_topic', 'alternative_topics', 'name', 'source', 'paper', 'term']);

/** Chuỗi có đáng kể chữ tiếng Việt: ít nhất hai từ có dấu tiếng Việt, hoặc một từ trong chuỗi ngắn. */
export function hasVietnamese(s) {
  if (typeof s !== 'string' || !VI_CHARS.test(s)) return false;
  const words = s.split(/\s+/).filter(Boolean);
  const vi = words.filter((w) => VI_CHARS.test(w)).length;
  return vi >= 2 || words.length <= 4;
}

/**
 * Sửa tại chỗ một object kết quả trích xuất cho đúng lang. Với 'en': đổi cụm cố định, rồi dịch những chuỗi còn chữ
 * tiếng Việt sang tiếng Anh. Trả về số chuỗi đã dịch. Lỗi mạng khi dịch thì bỏ qua (lúc hiển thị vẫn đổi cụm cố định).
 */
export async function fixLanguage(obj, lang) {
  if (!obj || typeof obj !== 'object' || (lang !== 'en' && lang !== 'vi')) return 0;
  const slots = [];
  const walk = (node, key) => {
    if (Array.isArray(node)) { node.forEach((v, i) => { if (typeof v === 'string') { node[i] = fixString(v, lang); if (lang === 'en' && !SKIP_KEYS.has(key) && hasVietnamese(node[i])) slots.push([node, i]); } else walk(v, key); }); return; }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === 'string') { node[k] = fixString(v, lang); if (lang === 'en' && !SKIP_KEYS.has(k) && hasVietnamese(node[k])) slots.push([node, k]); } else walk(v, k);
      }
    }
  };
  walk(obj, '');
  if (!slots.length) return 0;
  try {
    const guarded = slots.map(([n, k]) => protectMath(n[k]));
    const r = await api.translate(guarded.map((g) => g.text), 'en', 'vi');
    r.items.forEach((x, i) => { if (x?.translated) { const [n, k] = slots[i]; n[k] = fixString(restoreMath(x.translated, guarded[i].keep), 'en'); } });
    return slots.length;
  } catch (_) { return 0; }
}
