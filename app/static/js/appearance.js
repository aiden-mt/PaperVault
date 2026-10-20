// Tuỳ chỉnh chữ: phông và cỡ chữ của giao diện, phông, cỡ chữ và giãn dòng của phần nội dung để đọc
// (ghi chú, bài giảng, Hỏi đáp, Chat). Áp ngay khi đổi, lưu trong Cài đặt, và chép một bản vào bộ nhớ trình duyệt để
// lần mở app sau áp được ngay từ đầu, không bị nháy phông mặc định.
//  - Cỡ chữ giao diện dùng CSS zoom trên <body>: phóng cả chữ, nút, khoảng cách theo cùng tỉ lệ như khi zoom trình duyệt.
//  - Cỡ chữ nội dung dùng zoom trên khung nội dung, nên bảng và chữ nhỏ bên trong vẫn giữ tỉ lệ với chữ thường.

export const DEFAULT_APPEARANCE = { uiFont: '', uiScale: 100, readFont: '', readScale: 100, lineHeight: 0 };

const BASE_STACK = '"Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, Inter, Roboto, "Helvetica Neue", sans-serif';

/** Phông có sẵn trên Windows và hiển thị đủ dấu tiếng Việt. value rỗng = phông mặc định. */
export const UI_FONTS = [
  ['', 'Segoe UI (mặc định)'], ['Arial', 'Arial'], ['Calibri', 'Calibri'], ['Tahoma', 'Tahoma'], ['Verdana', 'Verdana'],
  ['Segoe UI Semilight', 'Segoe UI Semilight'], ['Times New Roman', 'Times New Roman'], ['Cambria', 'Cambria'], ['Georgia', 'Georgia'],
];
export const READ_FONTS = [
  ['', 'Giống phông giao diện'], ['Times New Roman', 'Times New Roman (có chân)'], ['Cambria', 'Cambria (có chân)'], ['Georgia', 'Georgia (có chân)'],
  ['Segoe UI', 'Segoe UI'], ['Arial', 'Arial'], ['Calibri', 'Calibri'], ['Tahoma', 'Tahoma'], ['Verdana', 'Verdana'],
];
export const LINE_HEIGHTS = [[0, 'Mặc định'], [1.4, 'Hẹp (1,4)'], [1.6, 'Vừa (1,6)'], [1.8, 'Thoáng (1,8)'], [2, 'Rất thoáng (2,0)']];

const CACHE = 'pv-appearance';
const clampNum = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
/** Tên phông người dùng gõ tay: chỉ giữ ký tự an toàn để chèn vào CSS. */
const cleanFont = (s) => String(s || '').replace(/[^\p{L}\p{N} \-_.]/gu, '').trim().slice(0, 60);

export function normalizeAppearance(a) {
  const x = { ...DEFAULT_APPEARANCE, ...(a || {}) };
  return {
    uiFont: cleanFont(x.uiFont),
    uiScale: clampNum(x.uiScale, 80, 150, 100),
    readFont: cleanFont(x.readFont),
    readScale: clampNum(x.readScale, 80, 170, 100),
    lineHeight: Number(x.lineHeight) ? clampNum(x.lineHeight, 1.2, 2.4, 0) : 0,
  };
}

export function applyAppearance(raw) {
  const a = normalizeAppearance(raw);
  const root = document.documentElement;
  const set = (k, v) => (v ? root.style.setProperty(k, v) : root.style.removeProperty(k));
  set('--font', a.uiFont ? `"${a.uiFont}", ${BASE_STACK}` : '');
  set('--font-display', a.uiFont ? `"${a.uiFont}", ${BASE_STACK}` : '');
  set('--ui-zoom', a.uiScale !== 100 ? String(a.uiScale / 100) : '');
  set('--read-font', a.readFont ? `"${a.readFont}", ${BASE_STACK}` : '');
  set('--read-zoom', a.readScale !== 100 ? String(a.readScale / 100) : '');
  set('--read-lh', a.lineHeight ? String(a.lineHeight) : '');
  root.classList.toggle('read-lh', !!a.lineHeight);
  try { localStorage.setItem(CACHE, JSON.stringify(a)); } catch (_) { /* bộ nhớ trình duyệt bị chặn */ }
  return a;
}

/** Bản đã chép lần trước, để áp trước khi tải xong Cài đặt từ máy chủ. */
export function cachedAppearance() {
  try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (_) { return null; }
}
