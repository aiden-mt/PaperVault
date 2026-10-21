// Thư viện LaTeX của người dùng: macro (\R -> \mathbb{R}, \norm{x} -> \left\lVert x \right\rVert…) dùng được trong mọi
// công thức của app, và công thức hay dùng lưu lại để chèn nhanh. Lưu trong kv "mathLib". Nhập được từ file .tex / .sty
// (đọc \newcommand, \renewcommand, \def, \DeclareMathOperator, \let).
import { api } from './api.js';
import { setMathMacros } from './richtext.js';

let lib = { macros: {}, snippets: [] };
let loaded = null;

export function loadMathLib(force = false) {
  if (loaded && !force) return loaded;
  loaded = api.kvGet('mathLib').catch(() => null).then((v) => {
    lib = { macros: (v && v.macros) || {}, snippets: (v && v.snippets) || [] };
    setMathMacros(lib.macros);
    return lib;
  });
  return loaded;
}
export const mathLib = () => lib;

export async function saveMathLib(next) {
  lib = { macros: { ...(next.macros || {}) }, snippets: [...(next.snippets || [])] };
  setMathMacros(lib.macros);
  loaded = Promise.resolve(lib);
  await api.kvSet('mathLib', lib);
  return lib;
}

/** Gói macro hay dùng khi viết về học máy. */
export const ML_PRESET = {
  '\\R': '\\mathbb{R}', '\\N': '\\mathbb{N}', '\\E': '\\mathbb{E}', '\\Prob': '\\mathbb{P}',
  '\\argmax': '\\operatorname*{arg\\,max}', '\\argmin': '\\operatorname*{arg\\,min}', '\\softmax': '\\operatorname{softmax}',
  '\\KL': 'D_{\\mathrm{KL}}', '\\loss': '\\mathcal{L}', '\\T': '^{\\top}',
  '\\norm': '\\left\\lVert #1 \\right\\rVert', '\\abs': '\\left| #1 \\right|', '\\inner': '\\langle #1, #2 \\rangle',
  '\\vx': '\\mathbf{x}', '\\vy': '\\mathbf{y}', '\\vz': '\\mathbf{z}', '\\mW': '\\mathbf{W}', '\\vtheta': '\\boldsymbol{\\theta}',
};

/** Đọc nội dung trong ngoặc nhọn cân bằng bắt đầu ở s[i] === '{'. Trả về [nội dung, vị trí sau '}'] hoặc null. */
function braced(s, i) {
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '{') depth++;
    else if (s[j] === '}') { depth--; if (depth === 0) return [s.slice(i + 1, j), j + 1]; }
  }
  return null;
}
const skipWs = (s, i) => { while (i < s.length && /\s/.test(s[i])) i++; return i; };

/**
 * Lấy macro từ văn bản LaTeX (preamble, file .sty). Trả về { macros, found, skipped }.
 * Tham số tuỳ chọn có mặc định (\newcommand{\x}[2][a]{…}) được coi như tham số thường vì KaTeX không hỗ trợ.
 */
export function parseLatexDefs(text) {
  const s = String(text || '').replace(/(^|[^\\])%[^\n]*/g, '$1'); // bỏ chú thích
  const macros = {};
  const skipped = [];
  let m;
  const cmdRe = /\\(?:re|provide)?newcommand\*?\s*/g;
  while ((m = cmdRe.exec(s))) {
    let i = skipWs(s, m.index + m[0].length);
    let name;
    if (s[i] === '{') { const b = braced(s, i); if (!b) continue; name = b[0].trim(); i = b[1]; } else { const n = /^\\[A-Za-z@]+/.exec(s.slice(i)); if (!n) continue; name = n[0]; i += name.length; }
    i = skipWs(s, i);
    if (s[i] === '[') { const e = s.indexOf(']', i); i = skipWs(s, e + 1); }
    if (s[i] === '[') { const e = s.indexOf(']', i); skipped.push(`${name} (tham số mặc định bị bỏ qua)`); i = skipWs(s, e + 1); }
    const b = braced(s, i);
    if (name && b) macros[name] = b[0].trim();
  }
  const defRe = /\\def\s*(\\[A-Za-z@]+)\s*((?:#\d)*)\s*/g;
  while ((m = defRe.exec(s))) { const b = braced(s, m.index + m[0].length); if (b) macros[m[1]] = b[0].trim(); }
  const opRe = /\\DeclareMathOperator(\*?)\s*/g;
  while ((m = opRe.exec(s))) {
    let i = skipWs(s, m.index + m[0].length);
    const a = braced(s, i);
    if (!a) continue;
    i = skipWs(s, a[1]);
    const b = braced(s, i);
    if (b) macros[a[0].trim()] = `\\operatorname${m[1] ? '*' : ''}{${b[0].trim()}}`;
  }
  const letRe = /\\let\s*(\\[A-Za-z@]+)\s*=?\s*(\\[A-Za-z@]+)/g;
  while ((m = letRe.exec(s))) macros[m[1]] = m[2];
  return { macros, found: Object.keys(macros).length, skipped };
}

/** Chữ ký để hiện: \norm{#1} khi macro có tham số. */
export function macroSignature(name, body) {
  const n = Math.max(0, ...[...String(body).matchAll(/#(\d)/g)].map((x) => Number(x[1])));
  return n ? `${name}${Array.from({ length: n }, (_, k) => `{x${k + 1}}`).join('')}` : name;
}
