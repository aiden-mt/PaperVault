// Đọc chữ của một file PDF đã lưu bằng PDF.js (bản đi kèm trong static/vendor/pdfjs).
//  - pdfFullText: toàn văn, dùng để đối chiếu số liệu, tìm kiếm toàn văn, làm ngữ cảnh cho Chat khi paper có PDF
//    nhưng chưa có toàn văn dạng text (PDF từng được gửi thẳng cho model).
//  - pdfPages: từng trang kèm vị trí mỗi mảnh chữ (toạ độ 0..1 theo trang), dùng để tô sáng một câu bất kỳ
//    mà không cần trang đó đang hiển thị.
import { api } from './api.js';

let lib = null;
const cache = new Map(); // pdfId -> pages

async function pdfjs() {
  if (!lib) {
    lib = await import('../vendor/pdfjs/build/pdf.mjs');
    lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/build/pdf.worker.mjs', import.meta.url).href;
  }
  return lib;
}

/**
 * Trả về [{ n, text, items: [{ str, x, y, w, h }] }]. x/y/w/h là hộp của mảnh chữ theo tỉ lệ trang (gốc ở góc trên trái).
 * text là chữ của trang, mỗi dòng PDF một dòng.
 */
export async function pdfPages(pdfId, { maxPages = 80 } = {}) {
  if (!pdfId) return [];
  if (cache.has(pdfId)) return cache.get(pdfId);
  const { getDocument, Util } = await pdfjs();
  const task = getDocument({ url: api.pdfUrl(pdfId), isEvalSupported: false });
  const doc = await task.promise;
  const pages = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n += 1) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = [];
      const lines = [];
      let line = '';
      for (const it of content.items) {
        if (!('str' in it)) continue;
        if (it.str.trim()) {
          const tx = Util.transform(vp.transform, it.transform);
          const fh = Math.hypot(tx[2], tx[3]) || it.height || 10;
          // Hộp phủ từ trên đỉnh chữ tới dưới đường chân chữ một chút (phần đuôi của g, p, y).
          items.push({ str: it.str, x: tx[4] / vp.width, y: (tx[5] - fh * 0.86) / vp.height, w: (it.width || 0) / vp.width, h: (fh * 1.12) / vp.height });
        }
        line += it.str;
        if (it.hasEOL) { lines.push(line); line = ''; } else if (it.str && !/\s$/.test(it.str)) line += ' ';
      }
      if (line.trim()) lines.push(line);
      pages.push({ n, text: lines.join('\n').replace(/[ \t]+/g, ' '), items });
    }
  } finally {
    try { await task.destroy(); } catch (_) { /* bỏ qua lỗi dọn tài nguyên */ }
  }
  cache.set(pdfId, pages);
  return pages;
}

/** Text của cả PDF (các trang nối bằng dòng trống), chuỗi rỗng nếu PDF không có lớp chữ. */
export async function pdfFullText(pdfId, opts) {
  return (await pdfPages(pdfId, opts)).map((p) => p.text).join('\n\n').trim();
}
