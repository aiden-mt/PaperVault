// Hiển thị văn bản do mô hình viết cho đúng dạng khoa học:
//  - Công thức LaTeX trong $...$, \(...\) (cùng dòng) và $$...$$, \[...\] (đứng riêng) dựng bằng KaTeX đóng gói sẵn
//    trong vendor/katex, chạy được khi không có mạng. KaTeX chưa tải được thì giữ nguyên chữ.
//  - Chỉ số dưới / trên viết kiểu văn bản thường (D_Aug, P_θ, y_<n, x^2, 10^{-3}) ở ghi chú cũ chưa dùng LaTeX.
//  - Liệt kê viết liền trong một đoạn ("1) … 2) … 3) …", "(i) … (ii) …") tách thành danh sách đánh số.
import { escapeHtml } from './util.js';

// $...$ cùng dòng: không có khoảng trắng ngay trong hai dấu $, và không theo sau bởi chữ số, để "$5 và $10" không bị coi là công thức.
const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?![\s$])([^$\n]+?)(?<!\s)\$(?!\d)/g;

export function renderMath(tex, display = false) {
  const k = window.katex;
  if (!k) return escapeHtml(display ? `$$${tex}$$` : `$${tex}$`);
  try {
    return k.renderToString(tex.trim(), { displayMode: display, throwOnError: false, output: 'html', strict: 'ignore', trust: false });
  } catch (_) {
    return escapeHtml(tex);
  }
}

/** Tách công thức ra khỏi văn bản: phần chữ đi qua plain(text), phần công thức dựng bằng KaTeX. */
export function withMath(raw, plain = escapeHtml) {
  const s = String(raw ?? '');
  let out = '';
  let last = 0;
  for (const m of s.matchAll(MATH)) {
    out += plain(s.slice(last, m.index));
    const display = m[1] != null || m[2] != null;
    out += renderMath(m[1] ?? m[2] ?? m[3] ?? m[4], display);
    last = m.index + m[0].length;
  }
  return out + plain(s.slice(last));
}

// Chỉ số dưới / trên dạng văn bản. Gốc là ký hiệu ngắn (x, P, ℒ, VQG), không phải từ thường viết thường kiểu
// snake_case (code_url) để khỏi biến tên biến thành chỉ số. Chạy trên chuỗi đã escape nên "<" là "&lt;".
const SUB = /(^|[\s(\[{,;=+\-*/|·:'’])([A-Za-zͰ-Ͽℒℓ]{1,4}(?:&#39;|′|’)?)_(\{[^}<>]{1,16}\}|(?:&lt;|&gt;|≤|≥)?[A-Za-z0-9Ͱ-Ͽ]{1,8})/g;
const SUP = /(^|[\s(\[{,;=+\-*/|·:])([A-Za-z0-9Ͱ-Ͽ)]{1,4})\^(\{[^}<>]{1,16}\}|[-+−]?[A-Za-z0-9Ͱ-Ͽ]{1,4})/g;
const unbrace = (x) => (x.startsWith('{') ? x.slice(1, -1) : x);
export function subSup(escaped) {
  return escaped
    .replace(SUB, (m, pre, base, sub) => (/^[a-z]{3,}$/.test(base) ? m : `${pre}${base}<sub>${unbrace(sub)}</sub>`))
    .replace(SUP, (m, pre, base, sup) => `${pre}${base}<sup>${unbrace(sup)}</sup>`);
}

/* ---------- Đường link ---------- */

// Link Markdown [chữ](url) và link trần (https://…, www.…). Dấu câu ở cuối ("…/abs/2401.1.", "(xem https://x.org)")
// không thuộc link.
const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|((?:https?:\/\/|www\.)[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}])/g;
const anchor = (href, label) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}</a>`;

/** Tách link ra khỏi văn bản: phần chữ đi qua plain(text), link thành thẻ <a> mở ở cửa sổ ngoài. */
export function linkify(raw, plain = escapeHtml) {
  const s = String(raw ?? '');
  let out = '';
  let last = 0;
  for (const m of s.matchAll(LINK)) {
    out += plain(s.slice(last, m.index));
    if (m[1] != null) out += anchor(m[2], plain(m[1]));
    else out += anchor(m[3].startsWith('www.') ? `https://${m[3]}` : m[3], escapeHtml(m[3]));
    last = m.index + m[0].length;
  }
  return out + plain(s.slice(last));
}

/** Một đoạn văn bản: escape, dựng công thức, link bấm được, chỉ số dưới / trên. */
export const rich = (s) => withMath(s, (x) => linkify(x, (y) => subSup(escapeHtml(y))));

/* ---------- Liệt kê viết liền ---------- */

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };
const ENUM = /(^|[\s.;:,])(\(?)(\d{1,2}|i{1,3}|iv|vi{0,3})\)\s+/g;

/** "Intro: 1) a. 2) b. 3) c." -> { intro, items } khi có ít nhất hai mục đánh số liên tiếp từ 1; không thì null. */
export function splitEnum(raw) {
  const s = String(raw ?? '');
  const marks = [];
  for (const m of s.matchAll(ENUM)) {
    const roman = /^[iv]+$/.test(m[3]);
    marks.push({ at: m.index + m[1].length, end: m.index + m[0].length, n: roman ? ROMAN[m[3]] : Number(m[3]), kind: `${roman ? 'r' : 'd'}${m[2] ? 'p' : ''}` });
  }
  // Lấy dãy dài nhất bắt đầu từ 1, tăng đều 1, cùng một kiểu đánh số.
  let best = [];
  marks.forEach((m0, i) => {
    if (m0.n !== 1) return;
    const seq = [m0];
    for (let j = i + 1; j < marks.length; j += 1) if (marks[j].kind === m0.kind && marks[j].n === seq[seq.length - 1].n + 1) seq.push(marks[j]);
    if (seq.length > best.length) best = seq;
  });
  if (best.length < 2) return null;
  const items = best.map((m, i) => s.slice(m.end, i + 1 < best.length ? best[i + 1].at : s.length).trim().replace(/[;,]\s*(and|và)?\s*$/i, '').trim());
  if (items.some((x) => !x)) return null;
  return { intro: s.slice(0, best[0].at).trim(), items };
}

/** Một trường văn bản của ghi chú: tách liệt kê viết liền thành danh sách, phần còn lại như rich(). */
export function richBlock(s) {
  const e = splitEnum(s);
  if (!e) return rich(s);
  return `${e.intro ? `<div class="enum-intro">${rich(e.intro)}</div>` : ''}<ol class="enum">${e.items.map((x) => `<li>${rich(x)}</li>`).join('')}</ol>`;
}

/* ---------- Giữ công thức khi dịch ---------- */

/** Thay công thức bằng ký hiệu giữ chỗ ⟦0⟧, ⟦1⟧… trước khi gửi bộ dịch (bộ dịch hay làm hỏng LaTeX). */
export function protectMath(text) {
  const keep = [];
  const out = String(text ?? '').replace(MATH, (m) => { keep.push(m); return `⟦${keep.length - 1}⟧`; });
  return { text: out, keep };
}
export function restoreMath(text, keep) {
  if (!keep.length) return text;
  return String(text ?? '').replace(/⟦\s*(\d+)\s*⟧/g, (m, i) => keep[Number(i)] ?? m);
}

/** Tiêu đề paper: dựng công thức LaTeX trong $...$ (nhiều tiêu đề arXiv có), phần còn lại escape thường. */
export const titleHtml = (s) => withMath(s, escapeHtml);

/** Tiêu đề dạng chữ thuần để tìm kiếm và sắp xếp: bỏ lệnh LaTeX, giữ chữ. */
export const plainTitle = (s) => String(s ?? '').replace(/\$([^$]*)\$/g, (m, x) => x.replace(/\\[a-zA-Z]+|\\[!,;: ]|[{}^_]/g, ' ')).replace(/\s+/g, ' ').trim();
