// Hình trong câu trả lời của AI (Chat, Hỏi đáp):
//  - Hình / bảng gốc của paper: mã [P1.F3] / [F3] (xem figures.js). Mã đứng riêng một dòng hiện ảnh ngay chỗ đó, mã nằm trong
//    câu thành nút, hình chưa hiện chỗ nào thì gom xuống cuối câu trả lời. Bấm ảnh để phóng to, có nút mở đúng trang PDF.
//  - Sơ đồ: khối ```mermaid (thư viện Mermaid đóng gói sẵn trong vendor/mermaid, chỉ nạp khi cần).
//  - Biểu đồ: khối ```chart chứa JSON { type: bar | line, title, unit, labels, series: [{ name, data }] }, vẽ SVG.
// Khối hỏng (cú pháp sai) thì giữ nguyên mã kèm dòng báo lỗi nhỏ, không làm hỏng cả câu trả lời.
import { escapeHtml } from './util.js';

const esc = escapeHtml;
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

/* ---------------------------------------------------------------- hình gốc của paper */

/** Khung một hình gốc. ref: { fig, paperId, tag } với tag là mã hiện cho người đọc (P1.F3 / F3). */
export function figureBlockHtml(ref) {
  const { fig, paperId, tag } = ref;
  const cap = String(fig.caption || '').replace(/\s+/g, ' ');
  return `<figure class="viz-fig" data-fig="${esc(tag)}"><img src="${esc(fig.url)}" alt="${esc(`${fig.label}: ${cap.slice(0, 160)}`)}" data-zoom loading="lazy">
    <figcaption><span class="badge">${esc(tag)}</span> ${esc(cap.length > 260 ? `${cap.slice(0, 260)}…` : cap)}
      <span class="viz-fig-act">${paperId ? `<a href="#/paper/${esc(paperId)}?tab=pdf&page=${fig.page}" title="Mở PDF ở trang có hình này">Trang ${fig.page} ↗</a>` : `trang ${fig.page}`}</span></figcaption></figure>`;
}

/**
 * Đổi mã hình trong HTML câu trả lời. resolve(code) -> { fig, paperId, tag } | null.
 * Mã đứng riêng một đoạn: hiện ảnh tại chỗ. Mã trong câu: nút nhỏ; hình chưa hiện ở đâu thì gom vào cuối.
 */
export function linkFigures(html, resolve) {
  const shown = new Set();
  const CODE = /\[((?:P\d+\.)?[FB]\d{1,2})\]/g;
  let out = String(html).replace(/<p>\s*((?:\[(?:P\d+\.)?[FB]\d{1,2}\]\s*)+)<\/p>/g, (m, codes) => {
    const blocks = [...codes.matchAll(CODE)].map((c) => resolve(c[1])).filter(Boolean);
    if (!blocks.length) return m;
    blocks.forEach((r) => shown.add(r.tag));
    return blocks.map(figureBlockHtml).join('');
  });
  const cited = [];
  out = out.replace(CODE, (m, code) => {
    const r = resolve(code);
    if (!r) return m;
    if (!shown.has(r.tag) && !cited.some((x) => x.tag === r.tag)) cited.push(r);
    return `<button type="button" class="wn-chip fig-chip" data-fig-go="${esc(r.tag)}" title="${esc(`${r.fig.label} (trang ${r.fig.page}) · bấm để xem hình`)}">${esc(r.tag)}</button>`;
  });
  if (cited.length) out += `<div class="viz-gallery">${cited.map(figureBlockHtml).join('')}</div>`;
  return out;
}

/* ---------------------------------------------------------------- phóng to */

function lightbox(src, caption) {
  const ov = document.createElement('div');
  ov.className = 'viz-lb';
  ov.innerHTML = `<div class="viz-lb-body">${src.startsWith('<svg') || src.startsWith('<div') ? src : `<img src="${esc(src)}" alt="">`}</div>${caption ? `<div class="viz-lb-cap">${esc(caption)}</div>` : ''}<div class="viz-lb-hint">Bấm ra ngoài hoặc Esc để đóng</div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  ov.addEventListener('click', (e) => { if (!e.target.closest('.viz-lb-body svg, .viz-lb-body img')) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(ov);
}

/** Gắn sự kiện một lần cho vùng chứa câu trả lời: bấm ảnh / sơ đồ để phóng to, bấm mã hình để xem hình. */
export function bindVisuals(root) {
  if (!root || root.dataset.vizBound) return;
  root.dataset.vizBound = '1';
  root.addEventListener('click', (e) => {
    const img = e.target.closest('.viz-fig img');
    if (img) { e.preventDefault(); lightbox(img.getAttribute('src'), img.alt); return; }
    const chip = e.target.closest('[data-fig-go]');
    if (chip) {
      e.preventDefault();
      const fig = chip.closest('.md, .msg, .viz-host')?.querySelector(`.viz-fig[data-fig="${CSS.escape(chip.dataset.figGo)}"] img`);
      if (fig) lightbox(fig.getAttribute('src'), fig.alt);
      return;
    }
    const zoom = e.target.closest('[data-viz-zoom]');
    if (zoom) { const box = zoom.closest('.viz-mermaid, .viz-chart')?.querySelector('svg'); if (box) lightbox(box.outerHTML, ''); return; }
    const save = e.target.closest('[data-viz-svg]');
    if (save) {
      const box = save.closest('.viz-mermaid, .viz-chart')?.querySelector('svg');
      if (!box) return;
      import('./util.js').then(({ download }) => download(`${save.dataset.vizSvg || 'so-do'}.svg`, box.outerHTML, 'image/svg+xml'));
    }
  });
}

/* ---------------------------------------------------------------- sơ đồ Mermaid */

let mermaidP = null;
function loadMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  mermaidP ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/mermaid/mermaid.min.js';
    s.onload = () => resolve(window.mermaid);
    s.onerror = () => { mermaidP = null; reject(new Error('Không tải được thư viện vẽ sơ đồ.')); };
    document.head.appendChild(s);
  });
  return mermaidP;
}
const svgCache = new Map();
let seq = 0;

const tools = (kind) => `<div class="viz-tools"><button type="button" class="ghost sm" data-viz-zoom title="Phóng to">⤢</button><button type="button" class="ghost sm" data-viz-svg="${kind}" title="Tải ảnh SVG">⭳ SVG</button></div>`;

async function renderMermaid(pre) {
  const src = pre.textContent.trim();
  if (!src) return;
  const key = `${isDark() ? 'd' : 'l'}|${src}`;
  let svg = svgCache.get(key);
  if (!svg) {
    const m = await loadMermaid();
    m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark() ? 'dark' : 'neutral', fontFamily: 'inherit', flowchart: { htmlLabels: false } });
    const id = `pvmm${Date.now().toString(36)}${seq++}`;
    try {
      ({ svg } = await m.render(id, src));
    } finally {
      document.getElementById(`d${id}`)?.remove(); // Mermaid để lại khung lỗi trong body khi cú pháp sai
      document.getElementById(id)?.remove();
    }
    svgCache.set(key, svg);
    if (svgCache.size > 60) svgCache.delete(svgCache.keys().next().value);
  }
  const box = document.createElement('div');
  box.className = 'viz-mermaid';
  box.innerHTML = `${tools('so-do')}<div class="viz-svg">${svg}</div><details class="viz-src"><summary>Xem mã sơ đồ</summary><pre></pre></details>`;
  box.querySelector('.viz-src pre').textContent = src;
  // Sơ đồ ngang dài: giữ tối thiểu 3/4 cỡ gốc cho chữ còn đọc được, khung cuộn ngang thay vì thu nhỏ hết cỡ.
  const el = box.querySelector('.viz-svg svg');
  const w = el?.viewBox?.baseVal?.width;
  if (w) el.style.minWidth = `${Math.round(w * 0.75)}px`;
  pre.replaceWith(box);
}

/* ---------------------------------------------------------------- biểu đồ (SVG tự vẽ) */

const PALETTE = ['#4f46e5', '#0d9488', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#65a30d', '#db2777'];
const num = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.eE+\-]/g, '')));
const fmt = (v) => (Math.abs(v) >= 1000 ? v.toLocaleString('vi-VN', { maximumFractionDigits: 0 }) : String(Math.round(v * 100) / 100).replace('.', ','));
const niceStep = (span) => { const raw = span / 5; const p = 10 ** Math.floor(Math.log10(raw || 1)); return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) || p * 10; };

/** spec -> chuỗi SVG; ném lỗi khi dữ liệu không dùng được. */
export function chartSvg(spec) {
  const labels = (spec.labels || []).map(String).slice(0, 30);
  const series = (spec.series || []).filter((s) => Array.isArray(s?.data)).slice(0, 8)
    .map((s, i) => ({ name: String(s.name || `Dãy ${i + 1}`), data: labels.map((_, k) => num(s.data[k])), color: PALETTE[i % PALETTE.length] }));
  if (!labels.length || !series.length) throw new Error('thiếu labels hoặc series');
  const vals = series.flatMap((s) => s.data).filter(Number.isFinite);
  if (!vals.length) throw new Error('không có số');
  const type = spec.type === 'line' ? 'line' : 'bar';
  const W = 680;
  const H = 340;
  const pad = { l: 58, r: 16, t: spec.title ? 38 : 16, b: 74 };
  let lo = Math.min(0, ...vals);
  let hi = Math.max(...vals);
  if (type === 'line' && lo === 0 && Math.min(...vals) > 0) lo = Math.min(...vals) - (hi - Math.min(...vals)) * 0.15; // đường: không ép trục về 0
  if (hi === lo) hi = lo + 1;
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
  const gw = iw / labels.length;
  const parts = [];
  for (let v = lo; v <= hi + step / 2; v += step) parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="cg-grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end" class="cg-tick">${esc(fmt(v))}</text>`);
  const bars = type === 'bar' && labels.length * series.length <= 40;
  if (type === 'bar') {
    const bw = Math.max(3, (gw * 0.78) / series.length);
    series.forEach((s, si) => s.data.forEach((v, k) => {
      if (!Number.isFinite(v)) return;
      const x = pad.l + k * gw + gw * 0.11 + si * bw;
      const y0 = y(Math.max(0, lo));
      const y1 = y(v);
      parts.push(`<rect x="${x}" y="${Math.min(y0, y1)}" width="${bw - 1}" height="${Math.max(1, Math.abs(y1 - y0))}" fill="${s.color}" rx="2"><title>${esc(`${s.name} · ${labels[k]}: ${fmt(v)}${spec.unit ? ` ${spec.unit}` : ''}`)}</title></rect>`);
      if (bars && bw >= 16) parts.push(`<text x="${x + (bw - 1) / 2}" y="${Math.min(y0, y1) - 3}" text-anchor="middle" class="cg-val">${esc(fmt(v))}</text>`);
    }));
  } else {
    series.forEach((s) => {
      const pts = s.data.map((v, k) => (Number.isFinite(v) ? [pad.l + k * gw + gw / 2, y(v)] : null)).filter(Boolean);
      parts.push(`<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.2"/>`);
      s.data.forEach((v, k) => { if (Number.isFinite(v)) parts.push(`<circle cx="${pad.l + k * gw + gw / 2}" cy="${y(v)}" r="3.5" fill="${s.color}"><title>${esc(`${s.name} · ${labels[k]}: ${fmt(v)}${spec.unit ? ` ${spec.unit}` : ''}`)}</title></circle>`); });
    });
  }
  // Nhãn trục ngang: xoay khi dài hoặc nhiều.
  const rot = labels.length > 6 || labels.some((l) => l.length > 10);
  labels.forEach((l, k) => {
    const x = pad.l + k * gw + gw / 2;
    const t = l.length > 22 ? `${l.slice(0, 21)}…` : l;
    parts.push(rot ? `<text transform="translate(${x},${pad.t + ih + 12}) rotate(-35)" text-anchor="end" class="cg-lab">${esc(t)}<title>${esc(l)}</title></text>` : `<text x="${x}" y="${pad.t + ih + 16}" text-anchor="middle" class="cg-lab">${esc(t)}</text>`);
  });
  const legend = series.length > 1 ? series.map((s, i) => `<g transform="translate(${pad.l + i * Math.min(160, iw / series.length)},${H - 12})"><rect width="10" height="10" y="-9" fill="${s.color}" rx="2"/><text x="14" class="cg-leg">${esc(s.name.slice(0, 22))}</text></g>`).join('') : '';
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="cg" role="img" aria-label="${esc(spec.title || 'Biểu đồ')}">
    <style>.cg text{fill:currentColor;font-family:inherit}.cg-tick,.cg-lab,.cg-leg,.cg-val{font-size:11px}.cg-val{opacity:.8}.cg-grid{stroke:currentColor;opacity:.12}.cg-title{font-size:14px;font-weight:600}</style>
    ${spec.title ? `<text x="${W / 2}" y="22" text-anchor="middle" class="cg-title">${esc(String(spec.title).slice(0, 90))}${spec.unit && !String(spec.title).includes(`(${spec.unit})`) ? ` (${esc(spec.unit)})` : ''}</text>` : ''}
    <line x1="${pad.l}" x2="${pad.l}" y1="${pad.t}" y2="${pad.t + ih}" class="cg-grid"/>
    ${parts.join('')}${legend}</svg>`;
}

function renderChart(pre) {
  const spec = JSON.parse(pre.textContent.trim());
  const box = document.createElement('div');
  box.className = 'viz-chart';
  box.innerHTML = `${tools('bieu-do')}<div class="viz-svg">${chartSvg(spec)}</div>`;
  pre.replaceWith(box);
}

/* ---------------------------------------------------------------- dựng mọi khối trong một vùng */

/** Dựng sơ đồ / biểu đồ trong root (gọi sau khi đã đặt HTML câu trả lời). Không chạy với câu trả lời đang viết dở. */
export async function enhanceVisuals(root) {
  if (!root) return;
  bindVisuals(root);
  const fail = (pre, what, e) => {
    if (pre.dataset.vizErr) return;
    pre.dataset.vizErr = '1';
    pre.insertAdjacentHTML('afterend', `<div class="hint viz-err">Không vẽ được ${what}: ${esc(String(e?.message || e).split('\n')[0].slice(0, 160))}. Hiện mã gốc ở trên.</div>`);
  };
  for (const pre of root.querySelectorAll('pre[data-lang="chart"]:not([data-viz-err])')) {
    try { renderChart(pre); } catch (e) { fail(pre, 'biểu đồ', e); }
  }
  for (const pre of root.querySelectorAll('pre[data-lang="mermaid"]:not([data-viz-err])')) {
    try { await renderMermaid(pre); } catch (e) { fail(pre, 'sơ đồ', e); }
  }
}
