// Hình và bảng gốc của paper (Figure N, Table N) để Chat / Hỏi đáp chèn vào câu trả lời.
// Cách tìm: đọc lớp chữ của PDF (PDF.js), lấy dòng bắt đầu bằng "Figure 3." / "Fig. 3:" / "Table 2:" làm chú thích, rồi
// xác định vùng hình: hình thường nằm TRÊN chú thích (dò lên tới dòng chữ thân bài gần nhất), bảng thường nằm DƯỚI chú thích
// (dò xuống). Cột: chú thích lệch trái / phải thì hình nằm trong cột đó, ở giữa trang thì hình trải hết bề ngang.
// Dựng trang thành ảnh, cắt vùng, lưu vào kho ảnh của app; kết quả lưu ở paper.figures nên mỗi PDF chỉ cắt một lần.
// Giới hạn: PDF bản scan (không có lớp chữ) không tìm được chú thích; bố cục lạ có thể cắt thừa / thiếu một chút.
import { api } from './api.js';
import { paperById, savePaper } from './store.js';
import { pdfjs } from './pdftext.js';

export const FIG_VERSION = 3;
const CAPTION = /^(Figure|FIGURE|Fig\.|FIG\.|Table|TABLE|Tab\.)\s*(\d{1,2}|[IVX]{1,4})\s*[:.|]\s*(.*)$/;
const MAX_PAGES = 40;
const MAX_FIGS = 30;

/** Mã của một hình: F3 (Figure 3), B2 (Bảng / Table 2). */
export const figCode = (kind, num) => `${kind === 'table' ? 'B' : 'F'}${num}`;

/** Gộp các mảnh chữ liền nhau trên cùng một dòng (theo thứ tự đọc) thành dòng của từng cột. Toạ độ 0..1 theo trang. */
function linesOf(items) {
  const lines = [];
  let cur = null;
  for (const it of items) {
    const h = it.h || 0.012;
    if (cur && Math.abs(it.y - cur.y0) < h * 0.5 && it.x - cur.x1 < 0.035 && it.x >= cur.x0 - 0.01) {
      cur.x1 = Math.max(cur.x1, it.x + it.w);
      cur.y1 = Math.max(cur.y1, it.y + h);
      cur.text += (/\s$/.test(cur.text) || /^\s/.test(it.str) ? '' : ' ') + it.str;
      continue;
    }
    cur = { x0: it.x, x1: it.x + it.w, y0: it.y, y1: it.y + h, h, text: it.str };
    lines.push(cur);
  }
  for (const l of lines) l.text = l.text.replace(/\s+/g, ' ').trim();
  return lines.filter((l) => l.text);
}

/** Vùng các hình / bảng của một trang: [{ kind, num, caption, box: [x, y, w, h] }]. */
export function findFigures(page) {
  const lines = linesOf(page.items || []);
  if (!lines.length) return [];
  // Cỡ chữ thân bài: cỡ chữ phổ biến nhất; dòng thân bài: rộng (gần hết bề ngang cột) và đúng cỡ chữ đó.
  const hs = lines.map((l) => Math.round(l.h * 1000)).sort((a, b) => a - b);
  const bodyH = hs[Math.floor(hs.length / 2)] / 1000;
  // Khối chú thích: dòng "Figure N" cùng các dòng tiếp theo sát bên dưới, cùng phạm vi ngang.
  const caps = [];
  lines.forEach((l, i) => {
    const m = CAPTION.exec(l.text);
    if (!m || (!m[3] && l.text.length < 12)) return;
    let cap = { x0: l.x0, x1: l.x1, y0: l.y0, y1: l.y1, kind: /^t/i.test(m[1]) ? 'table' : 'figure' };
    let text = l.text;
    for (let k = i + 1; k < lines.length && k < i + 8; k++) {
      const n = lines[k];
      if (n.y0 - cap.y1 > Math.max(n.h, l.h) * 0.9 || n.y0 < cap.y0 || CAPTION.test(n.text)) break;
      if (n.x1 < cap.x0 - 0.05 || n.x0 > cap.x1 + 0.05) continue;
      cap = { ...cap, x0: Math.min(cap.x0, n.x0), x1: Math.max(cap.x1, n.x1), y1: n.y1 };
      text += ` ${n.text}`;
      if (text.length > 600) break;
    }
    caps.push({ num: m[2], cap, text });
  });
  const out = [];
  caps.forEach(({ num, cap, text }) => {
    const kind = cap.kind;
    // Phạm vi ngang: chú thích nằm giữa trang -> cả bề ngang; lệch trái / phải -> cột đó.
    const mid = (cap.x0 + cap.x1) / 2;
    const wide = cap.x1 - cap.x0 > 0.55 || (mid > 0.4 && mid < 0.6);
    const [L, R] = wide ? [0.04, 0.96] : (mid < 0.5 ? [0.04, 0.505] : [0.495, 0.96]);
    const colW = R - L;
    const inCol = (x) => x.x1 > L + 0.01 && x.x0 < R - 0.01;
    const isBody = (x) => inCol(x) && x.x1 - x.x0 > colW * 0.62 && Math.abs(x.h - bodyH) < bodyH * 0.25 && !CAPTION.test(x.text);
    // Vùng phía trên chú thích (tới dòng thân bài / khối chú thích khác gần nhất) và phía dưới, kèm mốc chặn mỗi phía.
    const stops = [...lines.filter(isBody), ...caps.map((c) => c.cap).filter((c) => c !== cap && inCol(c))];
    let top = 0.045;
    let upStop = null;
    for (const x of stops) if (x.y1 <= cap.y0 - 0.002 && x.y1 > top) { top = x.y1; upStop = x; }
    let bottom = 0.955;
    let dnStop = null;
    for (const x of stops) if (x.y0 >= cap.y1 + 0.004 && x.y0 < bottom) { bottom = x.y0; dnStop = x; }
    // Phần nằm giữa hai chú thích thuộc chú thích nào: ngay trên chú thích Figure là hình của nó (hình có chú thích ở dưới),
    // ngay dưới chú thích Table là bảng của nó (bảng có chú thích ở trên). Vùng quá thấp (< 5% trang) coi như không có.
    const upOk = cap.y0 - top >= 0.05 && upStop?.kind !== 'table';
    const dnOk = bottom - cap.y1 >= 0.05 && dnStop?.kind !== 'figure';
    // Hình: ưu tiên phía trên; bảng: ưu tiên phía dưới. Phía ưu tiên không hợp lệ thì lấy phía kia.
    const above = kind === 'figure' ? upOk || !dnOk : !dnOk && upOk;
    const box = above
      ? [L, top + 0.004, colW, cap.y1 + 0.006 - (top + 0.004)]
      : [L, cap.y0 - 0.006, colW, bottom - 0.004 - (cap.y0 - 0.006)];
    if (box[3] < 0.05 || box[3] > 0.92) return;
    out.push({ kind, num, caption: text.slice(0, 600), box: box.map((v) => Math.max(0, Math.min(1, v))) });
  });
  return out;
}

/** Dựng trang rồi cắt vùng box (toạ độ 0..1) thành ảnh PNG; trả về Blob. */
async function cropPage(page, box, targetW = 1400) {
  const vp1 = page.getViewport({ scale: 1 });
  const scale = Math.min(3, Math.max(1.2, targetW / (vp1.width * box[2])));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // intent 'print': PDF.js dựng bằng hẹn giờ thường; chế độ mặc định chờ requestAnimationFrame nên đứng yên khi cửa sổ
  // không được vẽ (app thu xuống khay, khung đang ẩn).
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  const [x, y, w, h] = [box[0] * canvas.width, box[1] * canvas.height, box[2] * canvas.width, box[3] * canvas.height].map(Math.round);
  const out = document.createElement('canvas');
  out.width = Math.max(1, w);
  out.height = Math.max(1, h);
  out.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return new Promise((res) => out.toBlob(res, 'image/png'));
}

const running = new Map(); // paperId -> Promise

/**
 * Hình / bảng của paper (cắt từ PDF lần đầu, lưu lại cho các lần sau). Trả về [{ code, kind, num, label, page, caption, url }].
 * Không có PDF / PDF không có lớp chữ thì trả về [].
 */
export async function ensureFigures(paperId, { onStatus } = {}) {
  const p = paperById(paperId);
  if (!p?.pdfId) return [];
  if (p.figures?.pdfId === p.pdfId && p.figures.v === FIG_VERSION) return p.figures.items || [];
  if (running.has(paperId)) return running.get(paperId);
  const job = (async () => {
    const { getDocument, Util } = await pdfjs();
    const task = getDocument({ url: api.pdfUrl(p.pdfId), isEvalSupported: false });
    const doc = await task.promise;
    const items = [];
    const seen = new Set();
    try {
      for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES) && items.length < MAX_FIGS; n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const its = [];
        for (const it of content.items) {
          if (!('str' in it) || !it.str.trim()) continue;
          const tx = Util.transform(vp.transform, it.transform);
          const fh = Math.hypot(tx[2], tx[3]) || it.height || 10;
          its.push({ str: it.str, x: tx[4] / vp.width, y: (tx[5] - fh * 0.86) / vp.height, w: (it.width || 0) / vp.width, h: (fh * 1.12) / vp.height });
        }
        for (const f of findFigures({ items: its })) {
          const code = figCode(f.kind, f.num);
          if (seen.has(code)) continue; // phụ lục có thể lặp số: lấy lần xuất hiện đầu
          seen.add(code);
          onStatus?.(`Đang cắt ${f.kind === 'table' ? 'bảng' : 'hình'} ${f.num} (trang ${n})…`);
          const blob = await cropPage(page, f.box);
          if (!blob) continue;
          const up = await api.uploadImage(new Uint8Array(await blob.arrayBuffer()), `${p.id}-${code}.png`);
          items.push({ code, kind: f.kind, num: f.num, label: `${f.kind === 'table' ? 'Table' : 'Figure'} ${f.num}`, page: n, caption: f.caption, url: up.url, box: f.box });
        }
      }
    } finally {
      try { await task.destroy(); } catch (_) { /* bỏ qua */ }
    }
    const latest = paperById(paperId) || p;
    await savePaper({ ...latest, figures: { v: FIG_VERSION, pdfId: p.pdfId, at: new Date().toISOString(), items } });
    return items;
  })().finally(() => running.delete(paperId));
  running.set(paperId, job);
  return job;
}

/** Hình đã cắt sẵn (không cắt mới). */
export const figuresOf = (p) => (p?.figures?.pdfId && p.figures.pdfId === p.pdfId && p.figures.v === FIG_VERSION ? p.figures.items || [] : []);

/* ---------- dùng trong Chat / Hỏi đáp ---------- */

// Câu hỏi về hình: nêu số hình / bảng, hoặc hỏi về kiến trúc, sơ đồ, biểu đồ, kết quả trong bảng…
const FIG_Q = /(?<![\p{L}\p{N}])(hình|figure|fig|bảng|table|tab|kiến trúc|architecture|sơ đồ|diagram|pipeline|overview|tổng quan|biểu đồ|chart|plot|đồ thị|minh hoạ|minh họa|ảnh|visuali[sz]e)(?![\p{L}])/iu;
const NUM_REF = /(?<![\p{L}])(hình|figure|fig\.?|bảng|table|tab\.?)\s*(\d{1,2})/giu;
const words = (s) => String(s || '').toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);

/**
 * Hình nên gửi kèm câu hỏi để model nhìn thấy: hình / bảng được nêu số ("Figure 3", "bảng 2"), không có thì các hình có
 * chú thích khớp câu hỏi nhất (khi câu hỏi nói về hình, kiến trúc, biểu đồ…). items: hình của MỘT paper.
 */
export function pickFigures(items, question, { max = 2 } = {}) {
  if (!items?.length || !question) return [];
  const want = [...String(question).matchAll(NUM_REF)].map((m) => figCode(/^(b|t)/i.test(m[1]) ? 'table' : 'figure', m[2]));
  const named = want.map((c) => items.find((x) => x.code === c)).filter(Boolean);
  if (named.length) return [...new Set(named)].slice(0, max);
  if (!FIG_Q.test(question)) return [];
  const q = new Set(words(question));
  return items.map((x) => ({ x, s: words(x.caption).filter((w) => q.has(w)).length + (/overview|architecture|framework|pipeline|tổng quan|kiến trúc/i.test(x.caption) && /kiến trúc|architecture|tổng quan|overview|pipeline|sơ đồ/i.test(question) ? 2 : 0) }))
    .filter((y) => y.s > 0).sort((a, b) => b.s - a.s).slice(0, max).map((y) => y.x);
}
export const isFigureQuestion = (q) => FIG_Q.test(String(q || ''));

/** Danh sách hình cho ngữ cảnh: "[P1.F2] Figure 2 (tr. 4): chú thích…". prefix: "P1." trong Chat, "" trong Hỏi đáp. */
export function figureListText(items, prefix = '', { captionChars = 220, max = 30 } = {}) {
  return (items || []).slice(0, max).map((x) => `[${prefix}${x.code}] ${x.label} (tr. ${x.page}): ${String(x.caption || '').replace(/^(Figure|Fig\.|Table|Tab\.)\s*\S+\s*[:.|]\s*/i, '').replace(/\s+/g, ' ').slice(0, captionChars)}`).join('\n');
}
