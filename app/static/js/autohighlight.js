// Tô câu đáng nhớ tự động (ý tưởng từ pass 5 của Loupe). Model đọc toàn văn theo từng trang, chọn câu đáng nhớ,
// mỗi câu thuộc một loại (một màu) và kèm một dòng "vì sao". App tự dò lại câu đó trong PDF: câu trích phải khớp
// nguyên văn mới được tô, số trang model khai chỉ là gợi ý. Câu không dò ra thì bỏ, không đoán.
import { store, savePaper, paperById } from './store.js';
import { complete, modelLabel } from './llm.js';
import { parseLooseJson } from './util.js';
import { pdfPages } from './pdftext.js';

export const KINDS = {
  claim: { label: 'Luận điểm', en: 'Claim', color: 'purple', share: 0.2, desc: 'khẳng định chính của paper' },
  mechanism: { label: 'Cơ chế', en: 'Mechanism', color: 'blue', share: 0.34, desc: 'cách phương pháp hoạt động' },
  evidence: { label: 'Bằng chứng', en: 'Evidence', color: 'green', share: 0.24, desc: 'kết quả có con số' },
  limit: { label: 'Giới hạn', en: 'Limitation', color: 'pink', share: 0.12, desc: 'hạn chế, điều kiện, chỗ chưa giải quyết' },
  term: { label: 'Thuật ngữ', en: 'Definition', color: 'yellow', share: 0.1, desc: 'câu định nghĩa thuật ngữ hoặc ký hiệu' },
};
export const LEVELS = { thua: { label: 'Thưa', perPage: 1 }, vua: { label: 'Vừa', perPage: 2.5 }, day: { label: 'Dày', perPage: 4.5 } };

/** Số câu cần tô theo số trang nội dung và mức người dùng chọn. */
export const budgetFor = (pageCount, level = 'vua') => Math.max(4, Math.min(80, Math.round(pageCount * (LEVELS[level] || LEVELS.vua).perPage)));

const MAX_CHARS = 170000;
const REF_HEAD = /^\s*(references|bibliography|tài liệu tham khảo)\s*$/im;

/** Cắt bỏ danh mục tham khảo và phần sau nó (model không nên tô ở đó, gửi đi chỉ tốn token). */
function contentPages(pages) {
  const out = [];
  let used = 0;
  for (const [i, pg] of pages.entries()) {
    let text = pg.text;
    // Chỉ tin tiêu đề "References" từ khoảng 30% bài trở đi (bài có phụ lục dài thì tham khảo nằm khá sớm).
    const m = i >= Math.floor(pages.length * 0.3) ? REF_HEAD.exec(text) : null;
    if (m) text = text.slice(0, m.index);
    if (text.trim().length > 40) { out.push({ ...pg, text }); used += text.length; }
    if (m || used > MAX_CHARS) break;
  }
  return out;
}

/* ---------- Dò câu trích trong trang ---------- */

const CHAR_MAP = { '‘': "'", '’': "'", '“': '"', '”': '"', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl' };
/** Chuẩn hoá để so khớp: bỏ khoảng trắng và gạch nối (PDF ngắt từ cuối dòng), chữ thường, gộp nháy cong, chữ ghép. */
function normChar(ch) {
  if (/\s/.test(ch) || /[-‐-―­]/.test(ch)) return '';
  return (CHAR_MAP[ch] || ch).toLowerCase();
}
const normText = (s) => [...String(s || '')].map(normChar).join('');

/** Chuỗi đã chuẩn hoá của một trang + bản đồ từng ký tự về (mảnh chữ, vị trí trong mảnh). */
function pageStream(pg) {
  if (pg._stream) return pg._stream;
  let text = '';
  const map = [];
  pg.items.forEach((it, k) => {
    [...it.str].forEach((ch, c) => {
      const n = normChar(ch);
      for (let j = 0; j < n.length; j += 1) map.push({ k, c });
      text += n;
    });
  });
  pg._stream = { text, map };
  return pg._stream;
}

function findRange(pg, quoteNorm) {
  const { text } = pageStream(pg);
  let at = text.indexOf(quoteNorm);
  if (at !== -1) return text.indexOf(quoteNorm, at + 1) === -1 ? [at, at + quoteNorm.length] : null; // xuất hiện hai lần: không đoán
  // Model chép lệch vài chữ ở giữa: neo bằng đầu và đuôi câu.
  if (quoteNorm.length < 70) return null;
  const head = quoteNorm.slice(0, 40);
  const tail = quoteNorm.slice(-30);
  at = text.indexOf(head);
  if (at === -1 || text.indexOf(head, at + 1) !== -1) return null;
  const end = text.indexOf(tail, at + head.length);
  if (end === -1 || end + tail.length - at > quoteNorm.length * 1.5) return null;
  return [at, end + tail.length];
}

/** Gộp các hộp cùng dòng thành dải liền. */
function mergeRects(rects) {
  const sorted = rects.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - r[1]) < Math.min(last[3], r[3]) * 0.5 && r[0] <= last[0] + last[2] + 0.02) {
      const x1 = Math.min(last[0], r[0]);
      const x2 = Math.max(last[0] + last[2], r[0] + r[2]);
      const y1 = Math.min(last[1], r[1]);
      const y2 = Math.max(last[1] + last[3], r[1] + r[3]);
      out[out.length - 1] = [x1, y1, x2 - x1, y2 - y1];
    } else out.push(r.slice());
  }
  return out.map((r) => r.map((v) => Math.round(v * 10000) / 10000));
}

function rectsFor(pg, [from, to]) {
  const { map } = pageStream(pg);
  const byItem = new Map();
  for (let i = from; i < to; i += 1) {
    const { k, c } = map[i];
    const cur = byItem.get(k);
    if (!cur) byItem.set(k, [c, c]); else cur[1] = c;
  }
  const rects = [];
  let text = '';
  for (const [k, [c0, c1]] of byItem) {
    const it = pg.items[k];
    const len = [...it.str].length || 1;
    rects.push([it.x + it.w * (c0 / len), it.y, it.w * ((c1 + 1 - c0) / len), it.h]);
    text += `${[...it.str].slice(c0, c1 + 1).join('')} `;
  }
  return { rects: mergeRects(rects), text: text.replace(/\s+/g, ' ').replace(/(\p{L})- (\p{Ll})/gu, '$1$2').trim() };
}

/** Tìm câu trích trong PDF: thử trang model khai trước, rồi các trang lân cận, rồi cả bài. */
function locate(pages, quote, pageHint) {
  const q = normText(quote);
  if (q.length < 25) return null;
  const order = [...pages].sort((a, b) => Math.abs(a.n - pageHint) - Math.abs(b.n - pageHint));
  for (const pg of order) {
    const range = findRange(pg, q);
    if (range) return { page: pg.n, ...rectsFor(pg, range) };
  }
  return null;
}

/* ---------- Gọi model ---------- */

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['marks'],
  properties: {
    marks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['page', 'quote', 'kind', 'why'],
        properties: {
          page: { type: 'integer', description: 'Số trang chứa câu, theo dòng "=== Trang N ===".' },
          quote: { type: 'string', description: 'Câu chép NGUYÊN VĂN từ paper, đúng từng chữ, không sửa, không dịch.' },
          kind: { type: 'string', enum: Object.keys(KINDS) },
          why: { type: 'string', description: 'Một câu: vì sao câu này đáng nhớ. Phải nói điều chính câu trích không nói ra.' },
        },
      },
    },
  },
};

function systemPrompt(total, settings) {
  const lang = settings.language === 'en' ? 'English' : 'tiếng Việt';
  const quota = Object.entries(KINDS).map(([k, v]) => `- ${k} (${v.desc}): khoảng ${Math.max(1, Math.round(total * v.share))} câu`).join('\n');
  return `Bạn giúp một nhà nghiên cứu đọc paper. Nhiệm vụ: chọn những câu ĐÁNG NHỚ NHẤT để tô sáng trên file PDF, tổng cộng khoảng ${total} câu.

Mỗi câu thuộc đúng một loại:
${quota}

Quy tắc chọn:
- quote chép NGUYÊN VĂN từ văn bản được cung cấp: đúng từng chữ, đúng thứ tự, không sửa, không dịch, không nối hai chỗ lại. Dài 8-45 từ, trọn một câu hoặc một mệnh đề chính. App sẽ dò lại câu này trong PDF, sai một chữ là câu bị bỏ.
- Chọn câu mang thông tin cụ thể. Loại evidence phải chứa con số. Loại mechanism phải nói rõ một bước hoặc một quan hệ nhân quả. Không chọn câu chung chung kiểu "our method achieves strong results".
- Không chọn tiêu đề mục, chú thích hình bảng, nội dung trong bảng, công thức đứng riêng, danh mục tham khảo, hay câu chỉ liệt kê related work.
- Rải đều theo mạch bài (mở đầu, phương pháp, thí nghiệm, kết luận). Không quá 4 câu trên một trang, không tô hai câu liền nhau trong cùng một đoạn.
- page là số trang trong dòng "=== Trang N ===" đứng trước câu đó.
- why viết bằng ${lang}, một câu ngắn, nói điều mà chính câu trích không nói ra: nó đóng vai gì trong lập luận, hệ quả là gì, hoặc nên nhớ để làm gì. Chép lại ý câu trích là vô ích.

Chỉ trả về JSON đúng schema.`;
}

/**
 * Tô câu đáng nhớ cho paper có PDF. Thay các nét AI đã tô trước đó, giữ nguyên nét người dùng tự tô.
 * Trả về { kept, dropped, total }.
 */
export async function autoHighlight(paperId, { level = 'vua', onStatus = () => {} } = {}) {
  const paper = paperById(paperId);
  if (!paper?.pdfId) throw new Error('Paper chưa có file PDF.');
  onStatus('Đang đọc chữ trong PDF…', 0);
  const all = await pdfPages(paper.pdfId);
  const pages = contentPages(all);
  if (!pages.length || pages.reduce((n, p) => n + p.text.length, 0) < 1500) throw new Error('PDF không có lớp chữ (bản scan) nên không tô tự động được.');
  const total = budgetFor(pages.length, level);
  const settings = store.settings;
  const user = `Tiêu đề: ${paper.title}\n\n${pages.map((p) => `=== Trang ${p.n} ===\n${p.text}`).join('\n\n')}`;
  onStatus(`Đang nhờ ${modelLabel(settings, 'highlight')} chọn khoảng ${total} câu…`, 1);
  const out = await complete({
    settings, system: systemPrompt(total, settings), user, schema: SCHEMA, schemaName: 'highlights',
    maxTokens: Math.min(16000, total * 170 + 1200), effort: settings.effort === 'xhigh' ? 'high' : settings.effort, task: 'highlight', paperId,
    onRetry: (n, wait) => onStatus(`Bị giới hạn tốc độ, thử lại lần ${n} sau ${Math.round(wait / 1000)}s…`),
  });
  const raw = (parseLooseJson(out.text)?.marks || []).filter((m) => m && m.quote && KINDS[m.kind]);
  if (!raw.length) throw new Error('Model không trả về câu nào, hãy thử lại.');
  onStatus('Đang dò vị trí từng câu trong PDF…', 2);
  const at = new Date().toISOString();
  const marks = [];
  const seen = new Set();
  let dropped = 0;
  for (const m of raw) {
    const hit = locate(all, m.quote, Number(m.page) || 1);
    const key = hit && `${hit.page}:${hit.rects[0]?.join(',')}`;
    if (!hit || !hit.rects.length || seen.has(key)) { dropped += 1; continue; }
    seen.add(key);
    marks.push({
      id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, page: hit.page, type: 'highlight',
      color: KINDS[m.kind].color, rects: hit.rects, text: hit.text, kind: m.kind, why: String(m.why || '').trim(), auto: true, at,
    });
  }
  if (!marks.length) throw new Error(`Không dò được câu nào trong PDF (model trả ${raw.length} câu nhưng không câu nào khớp nguyên văn). Hãy thử lại.`);
  marks.sort((a, b) => a.page - b.page || a.rects[0][1] - b.rects[0][1]);
  const latest = paperById(paperId) || paper;
  await savePaper({ ...latest, pdfMarks: [...(latest.pdfMarks || []).filter((x) => !x.auto), ...marks] });
  return { kept: marks.length, dropped, total: raw.length };
}

/** Xoá mọi nét AI đã tô, giữ nét người dùng tự tô. */
export async function clearAutoHighlights(paperId) {
  const p = paperById(paperId);
  const mine = (p?.pdfMarks || []).filter((x) => !x.auto);
  await savePaper({ ...p, pdfMarks: mine });
  return (p?.pdfMarks || []).length - mine.length;
}
