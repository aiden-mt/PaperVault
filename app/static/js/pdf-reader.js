// Chạy bên trong trình đọc PDF.js (static/vendor/pdfjs/web/viewer.html) ở tab PDF của trang paper.
// Bôi đen chữ trong PDF -> nút 文 -> bong bóng bản dịch theo ngữ cảnh câu. Kế thừa content.js của extension
// "Dịch Khi Bôi Đen", thêm: lưu đoạn trích + bản dịch vào paper, dịch lại bằng mô hình AI đang dùng.
// Trang cha (paper.js) cung cấp window.pvReader = { config(), saveAnnotation(), translateAI(), hasAI() }.
import { translateSelection, cleanText, TRANSLATE_DEFAULTS } from './translate.js';
import { pronunciationHtml, handleSpeakAction, lookupPronunciation, phoneticWords, stopSpeaking } from './pronounce.js';

const bridge = () => {
  try { return window.parent !== window ? window.parent.pvReader || null : null; } catch (_) { return null; }
};
const config = () => ({ ...TRANSLATE_DEFAULTS, ...(bridge()?.config?.() || {}) });

/* ---------- Cấu hình PDF.js trước khi trình đọc khởi động ---------- */
// Khi nằm trong iframe, PDF.js phát sự kiện "webviewerloaded" lên document của trang cha (detail.source = window này).
function configureViewer(e) {
  if (e?.detail?.source && e.detail.source !== window) return;
  const opts = window.PDFViewerApplicationOptions;
  if (!opts) return;
  try {
    opts.set('localeProperties', { lang: 'vi' });
    opts.set('disableHistory', true);
    opts.set('sidebarViewOnLoad', 0);
  } catch (_) { /* bản PDF.js khác có thể không có tuỳ chọn này */ }
}
for (const target of [document, (() => { try { return window.parent.document; } catch (_) { return null; } })()]) {
  if (!target) continue;
  const once = (e) => { target.removeEventListener('webviewerloaded', once); configureViewer(e); };
  target.addEventListener('webviewerloaded', once);
}

const HOVER_DELAY = 150;
const PREFETCH_DELAY = 60;
const MAX_CONTEXT_SIDE = 320;
const MAX_SELECTION_FOR_CONTEXT = 200;
const INLINE_DISPLAYS = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents', 'ruby', 'ruby-text']);

const host = document.createElement('div');
host.id = 'pv-reader-host';
const shadow = host.attachShadow({ mode: 'open' });
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = new URL('../css/pdf-reader.css', import.meta.url).href;
const button = document.createElement('button');
button.className = 'pv-button';
button.type = 'button';
button.title = 'Dịch đoạn đã chọn';
button.textContent = '文';
const panel = document.createElement('div');
panel.className = 'pv-panel';
const overlay = document.createElement('div');
overlay.className = 'pv-overlay';
shadow.append(link, overlay, button, panel);
document.documentElement.appendChild(host);

let pending = null;
let hoverTimer = null;
let prefetchTimer = null;
let token = 0;

function hideAll() {
  stopSpeaking();
  clearTimeout(hoverTimer);
  clearTimeout(prefetchTimer);
  button.classList.remove('pv-visible');
  panel.classList.remove('pv-visible');
  overlay.textContent = '';
}

function box(className, rect) {
  const el = document.createElement('div');
  el.className = className;
  Object.assign(el.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  return el;
}
function bracket(char, x, rect) {
  const el = document.createElement('div');
  el.className = 'pv-bracket';
  el.textContent = char;
  Object.assign(el.style, { left: `${x}px`, top: `${rect.top}px`, height: `${rect.height}px`, fontSize: `${Math.max(11, rect.height)}px` });
  return el;
}
/** Tô nhạt cả câu ngữ cảnh ngay trên PDF, thêm ⟦ ở đầu và ⟧ ở cuối. */
function markContext(range) {
  overlay.textContent = '';
  if (!range) return;
  const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
  if (!rects.length) return;
  for (const r of rects) overlay.appendChild(box('pv-band', r));
  const first = rects[0];
  const last = rects[rects.length - 1];
  overlay.append(bracket('⟦', first.left - 8, first), bracket('⟧', last.right + 1, last));
}

function place(el, rect) {
  const margin = 8;
  el.style.visibility = 'hidden';
  el.classList.add('pv-visible');
  const { width, height } = el.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  let top = rect.bottom + margin;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, rect.top - height - margin);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.visibility = 'visible';
}

/* ---------- Lấy câu ngữ cảnh quanh đoạn chọn ---------- */
const makeBuffer = () => ({ text: '', map: [] });
function pushPiece(buf, node, offset, data) {
  if (buf.text) { buf.text += ' '; buf.map.push({ node, offset }); }
  for (let i = 0; i < data.length; i += 1) buf.map.push({ node, offset: offset + i });
  buf.text += data;
}
function cutBefore(text) {
  const from = Math.max(0, text.length - MAX_CONTEXT_SIDE);
  const win = text.slice(from);
  const matches = [...win.matchAll(/[.!?…:;]\s+/g)];
  const last = matches[matches.length - 1];
  let index;
  if (last) index = from + last.index + last[0].length;
  else if (from > 0) { const sp = win.indexOf(' '); index = sp === -1 ? from : from + sp + 1; } else index = 0;
  while (index < text.length && /\s/.test(text[index])) index += 1;
  return index;
}
function cutAfter(text) {
  const win = text.slice(0, MAX_CONTEXT_SIDE);
  const end = win.match(/[.!?…](\s|$)/);
  let index;
  if (end) index = end.index + 1;
  else if (text.length > win.length) { const sp = win.lastIndexOf(' '); index = sp === -1 ? win.length : sp; } else index = win.length;
  while (index > 0 && /\s/.test(text[index - 1])) index -= 1;
  return index;
}
function findTextBlock(node, selLen) {
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  // Trong PDF.js mỗi span của text layer chỉ là một dòng: lấy cả trang mới đủ ngữ cảnh.
  const page = el?.closest('.textLayer');
  if (page) return page;
  while (el && el !== document.documentElement) {
    const isBlock = !INLINE_DISPLAYS.has(getComputedStyle(el).display);
    if (isBlock && (el.textContent || '').trim().length > selLen) return el;
    el = el.parentElement;
  }
  return null;
}
const isVisible = (el) => !!el && (el.checkVisibility ? el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true }) : !!el.offsetParent);
const sideOf = (range, node) => { try { return range.comparePoint(node, 0); } catch (_) { return 0; } };

function contextRange(sel, start, end) {
  try {
    const r = document.createRange();
    if (start) r.setStart(start.node, start.offset); else r.setStart(sel.startContainer, sel.startOffset);
    if (end) r.setEnd(end.node, Math.min(end.offset + 1, end.node.length)); else r.setEnd(sel.endContainer, sel.endOffset);
    return r.collapsed ? null : r;
  } catch (_) { return null; }
}
function extractContext(range, text) {
  const block = findTextBlock(range.commonAncestorContainer, text.trim().length);
  if (!block) return null;
  const before = makeBuffer();
  const after = makeBuffer();
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.data.trim() || !isVisible(node.parentElement)) continue;
    if (node === range.startContainer || node === range.endContainer) {
      if (node === range.startContainer) pushPiece(before, node, 0, node.data.slice(0, range.startOffset));
      if (node === range.endContainer) pushPiece(after, node, range.endOffset, node.data.slice(range.endOffset));
      continue;
    }
    const side = sideOf(range, node);
    if (side < 0) pushPiece(before, node, 0, node.data);
    else if (side > 0) pushPiece(after, node, 0, node.data);
  }
  const from = cutBefore(before.text);
  const to = cutAfter(after.text);
  const ctx = {
    before: cleanText(before.text.slice(from)),
    after: cleanText(after.text.slice(0, to)),
    range: contextRange(range, before.map[from], after.map[to - 1]),
  };
  return ctx.before || ctx.after ? ctx : null;
}

function pageOf(node) {
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return el?.closest('.page')?.dataset.pageNumber || '';
}

function currentSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const range = sel.getRangeAt(0);
  if (!range.commonAncestorContainer.parentElement?.closest?.('#viewerContainer') && !range.commonAncestorContainer.closest?.('#viewerContainer')) return null;
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  const cfg = config();
  const wants = cfg.useContext && cleanText(text).length <= MAX_SELECTION_FOR_CONTEXT;
  return { text, rect, page: pageOf(range.startContainer), context: wants ? extractContext(range, text) : null };
}

/* ---------- Bong bóng bản dịch ---------- */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c]);
function marked(value, highlight) {
  const at = highlight ? value.toLowerCase().indexOf(highlight.toLowerCase()) : -1;
  if (at === -1) return esc(value);
  return `${esc(value.slice(0, at))}<mark>${esc(value.slice(at, at + highlight.length))}</mark>${esc(value.slice(at + highlight.length))}`;
}

function renderPanel(state) {
  const cfg = config();
  const b = bridge();
  const kind = state.usedContext ? ['ctx', 'theo ngữ cảnh'] : state.standalone ? ['plain', 'dịch riêng'] : state.sentenceOnly ? ['plain', 'cả câu'] : null;
  const rows = [];
  if (state.loading) rows.push('<div class="pv-spinner"></div>');
  if (state.error) rows.push(`<div class="pv-error">${esc(state.error)}</div>`);
  if (state.translated) rows.push(pronunciationHtml(state));
  if (state.translated) rows.push(`<div class="pv-translated">${state.sentenceOnly ? '<span class="pv-edge">⟦</span>' : ''}${esc(state.translated)}${state.sentenceOnly ? '<span class="pv-edge">⟧</span>' : ''}</div>`);
  if (state.standalone && state.original) rows.push(`<div class="pv-note">Không tách riêng được “${esc(state.original)}” trong câu này. Đây là nghĩa khi đứng một mình, có thể lệch với ngữ cảnh, hãy đối chiếu câu bên dưới.</div>`);
  else if (state.sentenceOnly && state.original) rows.push(`<div class="pv-note">Không tách riêng được nghĩa của “${esc(state.original)}” trong câu này, nên hiển thị cả câu.</div>`);
  if (state.sentence && state.sentence !== state.translated) rows.push(`<div class="pv-sentence"><span class="pv-label">Trong câu: </span><span class="pv-edge">⟦</span>${marked(state.sentence, state.highlight)}<span class="pv-edge">⟧</span></div>`);
  if (state.ai) rows.push(`<div class="pv-ai"><span class="pv-label">Bản dịch AI: </span>${esc(state.ai)}</div>`);
  if (state.aiLoading) rows.push('<div class="pv-ai"><span class="pv-label">Đang dịch bằng AI…</span></div>');
  if (state.aiError) rows.push(`<div class="pv-error">${esc(state.aiError)}</div>`);
  if (state.original && cfg.showOriginal) rows.push(`<div class="pv-original"><span class="pv-label">Gốc: </span>${esc(state.original)}</div>`);

  const actions = state.translated ? [
    b?.saveAnnotation ? '<button type="button" data-act="save" class="pv-primary" title="Lưu đoạn trích, bản dịch và số trang vào phần Trích dẫn của paper">+ Ghi chú</button>' : '',
    b?.hasAI?.() && !state.ai ? '<button type="button" data-act="ai" title="Dịch lại bằng mô hình AI đang dùng, sát văn phong học thuật hơn">Dịch bằng AI</button>' : '',
    '<button type="button" data-act="copy">Sao chép</button>',
  ].join('') : '';
  panel.innerHTML = `<div class="pv-header">
      <div class="pv-badges"><span class="pv-badge">${esc(state.badge || 'Đang dịch…')}</span>${kind ? `<span class="pv-badge pv-badge-${kind[0]}">${kind[1]}</span>` : ''}${state.page ? `<span class="pv-badge pv-badge-page">tr. ${esc(state.page)}</span>` : ''}</div>
      <button type="button" class="pv-close" data-act="close" title="Đóng (Esc)">✕</button></div>
    ${rows.join('')}${actions ? `<div class="pv-actions">${actions}</div>` : ''}`;
  panel._state = state;
}

function showPanel(state) {
  renderPanel(state);
  place(panel, pending.rect);
}

panel.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const state = panel._state || {};
  const act = btn.dataset.act;
  if (act === 'close') return hideAll();
  if (handleSpeakAction(act, state, btn)) return;
  if (act === 'copy') {
    try { await navigator.clipboard.writeText(state.ai || state.translated); } catch (_) { /* bỏ qua */ }
    btn.textContent = 'Đã chép';
    setTimeout(() => { btn.textContent = 'Sao chép'; }, 1200);
    return;
  }
  if (act === 'save') {
    btn.disabled = true;
    btn.textContent = 'Đang lưu…';
    try {
      await bridge().saveAnnotation({ quote: state.original, translation: state.ai || state.translated, sentence: state.sourceSentence, page: state.page });
      btn.textContent = 'Đã lưu ✓';
    } catch (err) { btn.disabled = false; btn.textContent = 'Lỗi, thử lại'; }
    return;
  }
  if (act === 'ai') {
    const t = token;
    showPanel({ ...state, aiLoading: true, aiError: '' });
    try {
      const ai = await bridge().translateAI({ text: state.original, sentence: state.sourceSentence, targetLang: config().targetLang });
      if (t === token) showPanel({ ...state, ai, aiLoading: false });
    } catch (err) { if (t === token) showPanel({ ...state, aiLoading: false, aiError: err.message }); }
  }
});

function prefetch(sel) {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    translateSelection({ text: sel.text, context: sel.context && { before: sel.context.before, after: sel.context.after }, tl: config().targetLang }).catch(() => {});
  }, PREFETCH_DELAY);
}

async function doTranslate() {
  if (!pending) return;
  clearTimeout(hoverTimer);
  clearTimeout(prefetchTimer);
  button.classList.remove('pv-visible');
  const sel = pending;
  const t = ++token;
  showPanel({ loading: true, page: sel.page });
  markContext(sel.context?.range);
  const tl = config().targetLang;
  try {
    const res = await Promise.race([
      translateSelection({ text: sel.text, context: sel.context && { before: sel.context.before, after: sel.context.after }, tl }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Bộ dịch phản hồi quá lâu. Hãy thử lại.')), 12000)),
    ]);
    if (t !== token) return;
    const ctx = sel.context;
    const original = cleanText(sel.text);
    const wantsPron = !!phoneticWords(original, res.detected);
    showPanel({
      ...res,
      badge: `${res.detected || 'auto'} → ${tl}`,
      original,
      page: sel.page,
      pronLoading: wantsPron,
      sourceSentence: ctx ? [ctx.before, original, ctx.after].filter(Boolean).join(' ').replace(/\s+([,.;:!?…])/g, '$1') : original,
    });
    // Phiên âm tra sau, không làm chậm bản dịch.
    if (wantsPron) {
      const pron = await lookupPronunciation(original, res.detected).catch(() => null);
      if (t === token && panel._state) showPanel({ ...panel._state, pron, pronLoading: false });
    }
  } catch (err) {
    if (t === token) showPanel({ error: err.message || 'Không kết nối được tới bộ dịch.', page: sel.page });
  }
}

function handleSelection() {
  const sel = currentSelection();
  if (!sel) { hideAll(); return; }
  pending = sel;
  if (config().mode === 'auto') doTranslate();
  else {
    panel.classList.remove('pv-visible');
    place(button, sel.rect);
    prefetch(sel);
  }
}

button.addEventListener('mousedown', (e) => e.preventDefault());
button.addEventListener('click', doTranslate);
button.addEventListener('mouseenter', () => {
  if (config().openOn !== 'hover') return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(doTranslate, HOVER_DELAY);
});
button.addEventListener('mouseleave', () => clearTimeout(hoverTimer));
document.addEventListener('mouseup', (e) => { if (!e.composedPath().includes(host)) setTimeout(handleSelection, 10); });
document.addEventListener('mousedown', (e) => { if (!e.composedPath().includes(host)) hideAll(); });
document.addEventListener('keyup', (e) => { if (e.shiftKey || e.key === 'Shift') setTimeout(handleSelection, 10); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideAll();
  // Ctrl+Shift+D: dịch ngay đoạn đang chọn (thay cho menu chuột phải của extension).
  if (e.key.toLowerCase() === 'd' && e.ctrlKey && e.shiftKey) {
    const sel = currentSelection();
    if (sel) { e.preventDefault(); pending = sel; doTranslate(); }
  }
});
window.addEventListener('scroll', hideAll, true);
window.addEventListener('resize', hideAll);

/* ---------- Tô sáng / gạch chân: bật công cụ rồi bôi đen chữ ----------
   Nét đánh dấu lưu trong paper (paper.pdfMarks) theo toạ độ tương đối của trang, nên đổi cỡ zoom vẫn khớp
   và không sửa file PDF gốc. Bấm vào một nét để dịch, lưu làm ghi chú hoặc xoá. */
const MARK_COLORS = { yellow: '#ffd43b', green: '#69db7c', blue: '#74c0fc', pink: '#f783ac', red: '#ff8787', purple: '#b197fc' };
const COLOR_NAMES = { yellow: 'Vàng', green: 'Xanh lá', blue: 'Xanh dương', pink: 'Hồng', red: 'Đỏ', purple: 'Tím' };
// Câu đáng nhớ do AI tô (autohighlight.js): mỗi loại một màu.
const KIND_NAMES = { claim: 'Luận điểm', mechanism: 'Cơ chế', evidence: 'Bằng chứng', limit: 'Giới hạn', term: 'Thuật ngữ' };
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { /* bỏ qua */ } return null; };
const markState = { mode: 'none', color: store('pv-mark-color') in MARK_COLORS ? store('pv-mark-color') : 'yellow' };
let marks = [];
const loadMarks = () => { marks = (bridge()?.getMarks?.() || []).filter((m) => m && m.rects?.length); };
const saveMarks = () => bridge()?.saveMarks?.(marks);

/* Hoàn tác / làm lại cho tô sáng, gạch chân: lưu ảnh chụp danh sách nét trước mỗi thao tác (tạo, xoá, đổi màu). */
const undoStack = [];
const redoStack = [];
const HISTORY_LIMIT = 100;
let syncHistoryButtons = () => {};
function snapshot() {
  undoStack.push(JSON.stringify(marks));
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  syncHistoryButtons();
}
function restore(from, to, label) {
  if (!from.length) return false;
  to.push(JSON.stringify(marks));
  marks = JSON.parse(from.pop());
  hideAll();
  drawAllMarks();
  saveMarks();
  syncHistoryButtons();
  bridge()?.toast?.(label);
  return true;
}
const undoMark = () => restore(undoStack, redoStack, 'Đã hoàn tác đánh dấu.');
const redoMark = () => restore(redoStack, undoStack, 'Đã làm lại đánh dấu.');

function injectToolbar() {
  const anchor = document.getElementById('editorModeButtons');
  if (!anchor || document.getElementById('pvMarkTools')) return;
  const css = document.createElement('style');
  css.textContent = `
    #editorHighlightButton, #editorHighlightParamsToolbar { display: none !important; }
    .pv-tools { display: flex; align-items: center; gap: 2px; margin-right: 6px; padding-right: 6px; border-right: 1px solid var(--separator-color, rgba(0,0,0,.15)); position: relative; }
    .pv-tool { width: 32px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 4px; background: none; color: var(--main-color); cursor: pointer; font: 600 14px/1 "Segoe UI", sans-serif; }
    .pv-tool:hover:not(:disabled) { background: var(--button-hover-color, rgba(0,0,0,.08)); }
    .pv-tool:disabled { opacity: .35; cursor: default; }
    .pv-tool.on { background: var(--toggled-btn-bg-color, rgba(79,70,229,.18)); outline: 1px solid rgba(79,70,229,.45); }
    .pv-tool svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .pv-tool .sw { width: 14px; height: 14px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgba(0,0,0,.25); }
    .pv-color-menu { position: absolute; top: 34px; right: 0; z-index: 100000; display: flex; gap: 8px; padding: 10px 12px; background: var(--doorhanger-bg-color, #fff); border: 1px solid var(--doorhanger-border-color, #ccc); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.18); }
    .pv-color-menu[hidden] { display: none; }
    .pv-color-menu button { width: 24px; height: 24px; border-radius: 50%; border: 2px solid transparent; background: var(--c); cursor: pointer; }
    .pv-color-menu button.on { border-color: #4f46e5; box-shadow: 0 0 0 2px #fff inset; }
    .pv-marks { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
    .pv-mark { position: absolute; border-radius: 2px; }
    .pv-highlight { background: var(--c); opacity: .42; mix-blend-mode: multiply; }
    .pv-underline { border-bottom: 2px solid var(--c); }
    .pv-mark.flash { outline: 2px solid #4f46e5; }
    body.pv-marking .textLayer { cursor: text; }
    body.pv-marking .textLayer ::selection { background: rgba(79,70,229,.25); }
    body.pv-erasing .textLayer, body.pv-erasing .textLayer span { cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='%23fff' stroke='%23333' stroke-width='1.6' stroke-linejoin='round'><path d='m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21z'/><path d='M22 21H7' fill='none'/></svg>") 4 20, crosshair; }
    body.pv-erasing .textLayer ::selection { background: rgba(220,38,38,.18); }`;
  document.head.appendChild(css);
  const wrap = document.createElement('div');
  wrap.id = 'pvMarkTools';
  wrap.className = 'pv-tools';
  wrap.innerHTML = `
    <button id="pvHl" class="pv-tool" type="button" title="Tô sáng: bật rồi bôi đen chữ cần tô"><svg viewBox="0 0 24 24"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg></button>
    <button id="pvUl" class="pv-tool" type="button" title="Gạch chân: bật rồi bôi đen chữ cần gạch"><svg viewBox="0 0 24 24"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><path d="M4 20h16"/></svg></button>
    <button id="pvEraser" class="pv-tool" type="button" title="Cục tẩy: bật rồi bôi đen hoặc rê chuột (giữ chuột trái) qua phần đã tô / gạch để xoá"><svg viewBox="0 0 24 24"><path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg></button>
    <button id="pvColor" class="pv-tool" type="button" title="Màu tô sáng / gạch chân"><span class="sw"></span></button>
    <button id="pvUndo" class="pv-tool" type="button" title="Hoàn tác đánh dấu (Ctrl+Z)" disabled><svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button>
    <button id="pvRedo" class="pv-tool" type="button" title="Làm lại (Ctrl+Y hoặc Ctrl+Shift+Z)" disabled><svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg></button>
    <div id="pvColorMenu" class="pv-color-menu" hidden>${Object.entries(MARK_COLORS).map(([k, c]) => `<button type="button" data-color="${k}" title="${COLOR_NAMES[k]}" style="--c:${c}"></button>`).join('')}</div>`;
  anchor.prepend(wrap);
  const sync = () => {
    wrap.querySelector('#pvHl').classList.toggle('on', markState.mode === 'highlight');
    wrap.querySelector('#pvUl').classList.toggle('on', markState.mode === 'underline');
    wrap.querySelector('#pvEraser').classList.toggle('on', markState.mode === 'erase');
    document.body.classList.toggle('pv-erasing', markState.mode === 'erase');
    wrap.querySelector('#pvColor .sw').style.setProperty('--c', MARK_COLORS[markState.color]);
    wrap.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('on', b.dataset.color === markState.color));
    document.body.classList.toggle('pv-marking', markState.mode !== 'none');
  };
  const setMode = (mode) => {
    markState.mode = markState.mode === mode ? 'none' : mode;
    // Tắt công cụ chú thích của PDF.js để bôi đen chữ được.
    if (markState.mode !== 'none') window.PDFViewerApplication?.eventBus?.dispatch('switchannotationeditormode', { source: window, mode: 0 });
    hideAll();
    sync();
  };
  syncHistoryButtons = () => {
    wrap.querySelector('#pvUndo').disabled = !undoStack.length;
    wrap.querySelector('#pvRedo').disabled = !redoStack.length;
  };
  wrap.querySelector('#pvUndo').addEventListener('click', undoMark);
  wrap.querySelector('#pvRedo').addEventListener('click', redoMark);
  wrap.querySelector('#pvHl').addEventListener('click', () => setMode('highlight'));
  wrap.querySelector('#pvUl').addEventListener('click', () => setMode('underline'));
  wrap.querySelector('#pvEraser').addEventListener('click', () => setMode('erase'));
  wrap.querySelector('#pvColor').addEventListener('click', (e) => { e.stopPropagation(); const m = wrap.querySelector('#pvColorMenu'); m.hidden = !m.hidden; });
  wrap.querySelector('#pvColorMenu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    markState.color = b.dataset.color;
    store('pv-mark-color', markState.color);
    wrap.querySelector('#pvColorMenu').hidden = true;
    if (markState.mode === 'none' || markState.mode === 'erase') { markState.mode = 'none'; setMode('highlight'); } else sync();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#pvMarkTools')) wrap.querySelector('#pvColorMenu').hidden = true; });
  // Bật công cụ của PDF.js (vẽ, chữ, ảnh...) thì tắt chế độ đánh dấu.
  anchor.addEventListener('click', (e) => { if (e.target.closest('.toolbarButton') && !e.target.closest('#pvMarkTools') && markState.mode !== 'none') { markState.mode = 'none'; sync(); } });
  sync();
}

const pageEls = () => [...document.querySelectorAll('#viewer .page[data-page-number]')];

function drawPageMarks(pageEl) {
  if (!pageEl) return;
  const n = Number(pageEl.dataset.pageNumber);
  let layer = pageEl.querySelector(':scope > .pv-marks');
  const mine = marks.filter((m) => m.page === n);
  if (!mine.length) { layer?.remove(); return; }
  if (!layer) { layer = document.createElement('div'); layer.className = 'pv-marks'; pageEl.appendChild(layer); }
  layer.innerHTML = mine.map((m) => m.rects.map(([x, y, w, h]) => `<div class="pv-mark pv-${m.type}" data-mark="${m.id}" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%;--c:${MARK_COLORS[m.color] || MARK_COLORS.yellow}"></div>`).join('')).join('');
}
const drawAllMarks = () => pageEls().forEach(drawPageMarks);

/** Gộp các ô chữ cùng dòng thành một dải liền (toạ độ 0..1 theo trang). */
function mergeRects(rects) {
  const sorted = rects.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - r[1]) < Math.min(last[3], r[3]) * 0.5 && r[0] <= last[0] + last[2] + 0.012) {
      const x1 = Math.min(last[0], r[0]);
      const x2 = Math.max(last[0] + last[2], r[0] + r[2]);
      const y1 = Math.min(last[1], r[1]);
      const y2 = Math.max(last[1] + last[3], r[1] + r[3]);
      out[out.length - 1] = [x1, y1, x2 - x1, y2 - y1];
    } else out.push(r.slice());
  }
  return out.map((r) => r.map((v) => Math.round(v * 10000) / 10000));
}

function createMarkFromSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const text = cleanText(sel.toString());
  if (!text) return false;
  const pages = pageEls().map((el) => ({ el, r: el.getBoundingClientRect() }));
  const byPage = new Map();
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 1) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const pg = pages.find(({ r: pr }) => cx >= pr.left && cx <= pr.right && cy >= pr.top && cy <= pr.bottom);
    if (!pg) continue;
    const n = Number(pg.el.dataset.pageNumber);
    if (!byPage.has(n)) byPage.set(n, []);
    byPage.get(n).push([(r.left - pg.r.left) / pg.r.width, (r.top - pg.r.top) / pg.r.height, r.width / pg.r.width, r.height / pg.r.height]);
  }
  if (!byPage.size) return false;
  const at = new Date().toISOString();
  snapshot();
  for (const [page, rects] of byPage) {
    marks.push({ id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, page, type: markState.mode, color: markState.color, rects: mergeRects(rects), text: byPage.size > 1 ? text : text, at });
    drawPageMarks(pages.find((x) => Number(x.el.dataset.pageNumber) === page)?.el);
  }
  sel.removeAllRanges();
  saveMarks();
  return true;
}

/** Bấm vào một nét đánh dấu: tìm nét nằm dưới con trỏ (lớp chữ của PDF.js che mất sự kiện chuột). */
function markAt(x, y) {
  for (const el of pageEls()) {
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const px = (x - r.left) / r.width;
    const py = (y - r.top) / r.height;
    const n = Number(el.dataset.pageNumber);
    for (let i = marks.length - 1; i >= 0; i -= 1) {
      const m = marks[i];
      if (m.page !== n) continue;
      if (m.rects.some(([mx, my, mw, mh]) => px >= mx && px <= mx + mw && py >= my - 0.004 && py <= my + mh + 0.004)) return { mark: m, pageEl: el };
    }
  }
  return null;
}

function showMarkMenu(mark, x, y) {
  pending = { rect: { left: x, right: x, top: y, bottom: y, width: 0, height: 0 }, text: mark.text, page: String(mark.page), context: null };
  panel.innerHTML = `<div class="pv-header"><div class="pv-badges"><span class="pv-badge">${mark.kind && KIND_NAMES[mark.kind] ? KIND_NAMES[mark.kind] : (mark.type === 'underline' ? 'Gạch chân' : 'Tô sáng')}</span>${mark.auto ? '<span class="pv-badge pv-badge-ctx">AI tô</span>' : ''}<span class="pv-badge pv-badge-page">tr. ${mark.page}</span></div>
    <button type="button" class="pv-close" data-act="close" title="Đóng (Esc)">✕</button></div>
    ${mark.why ? `<div class="pv-translated" style="font-size:13.5px">${esc(mark.why)}</div>` : ''}
    <div class="pv-original" style="${mark.why ? '' : 'margin-top:0;padding-top:0;border-top:none;'}color:#1f2937">${esc(mark.text.length > 400 ? `${mark.text.slice(0, 400)}…` : mark.text)}</div>
    <div class="pv-actions">
      <button type="button" data-act="mark-tr" class="pv-primary">Dịch</button>
      ${bridge()?.saveAnnotation ? '<button type="button" data-act="mark-note">+ Ghi chú</button>' : ''}
      <button type="button" data-act="mark-copy">Sao chép</button>
      <span style="flex:1"></span>
      ${Object.keys(MARK_COLORS).map((k) => `<button type="button" data-act="mark-color" data-color="${k}" title="${COLOR_NAMES[k]}" style="width:22px;height:22px;padding:0;border-radius:50%;background:${MARK_COLORS[k]};${k === mark.color ? 'outline:2px solid #4f46e5;outline-offset:1px' : ''}"></button>`).join('')}
      <button type="button" data-act="mark-del" style="color:#b91c1c">Xoá</button>
    </div>`;
  panel._state = { mark };
  place(panel, pending.rect);
}

panel.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act^="mark-"]');
  if (!btn) return;
  e.stopImmediatePropagation();
  const { mark } = panel._state || {};
  if (!mark) return;
  const act = btn.dataset.act;
  if (act === 'mark-del') {
    snapshot();
    marks = marks.filter((m) => m.id !== mark.id);
    drawAllMarks(); saveMarks(); hideAll();
  } else if (act === 'mark-color') {
    if (mark.color === btn.dataset.color) return;
    snapshot();
    mark.color = btn.dataset.color;
    drawAllMarks(); saveMarks(); showMarkMenu(mark, pending.rect.left, pending.rect.top);
  } else if (act === 'mark-copy') {
    try { await navigator.clipboard.writeText(mark.text); } catch (_) { /* bỏ qua */ }
    btn.textContent = 'Đã chép';
  } else if (act === 'mark-note') {
    btn.disabled = true;
    try { await bridge().saveAnnotation({ quote: mark.text, translation: '', page: String(mark.page), note: mark.why ? `${KIND_NAMES[mark.kind] || 'Ghi chú'}: ${mark.why}` : '' }); btn.textContent = 'Đã lưu ✓'; } catch (_) { btn.disabled = false; }
  } else if (act === 'mark-tr') {
    doTranslate();
  }
}, true);

// Đang bật công cụ: bôi đen xong là đánh dấu luôn, không hiện nút dịch. Bấm vào nét đã có thì mở menu của nét đó.
document.addEventListener('mouseup', (e) => {
  if (e.composedPath().includes(host) || e.button !== 0) return;
  if (markState.mode === 'erase') {
    setTimeout(() => { finishErase(); hideAll(); }, 0);
    return;
  }
  if (markState.mode !== 'none') {
    setTimeout(() => { if (createMarkFromSelection()) hideAll(); }, 0);
    return;
  }
  setTimeout(() => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const hit = markAt(e.clientX, e.clientY);
    if (hit) showMarkMenu(hit.mark, e.clientX, e.clientY);
  }, 20);
}, true);

/* ---------- Khởi động: chờ PDF.js sẵn sàng rồi vẽ lại nét đánh dấu mỗi khi một trang được vẽ ---------- */
(async function bootMarks() {
  const app = await new Promise((resolve) => {
    const tick = () => (window.PDFViewerApplication?.initializedPromise ? resolve(window.PDFViewerApplication) : setTimeout(tick, 50));
    tick();
  });
  await app.initializedPromise;
  injectToolbar();
  loadMarks();
  app.eventBus.on('pagesinit', () => { loadMarks(); drawAllMarks(); });
  app.eventBus.on('pagerendered', (e) => drawPageMarks(e.source?.div));
  app.eventBus.on('textlayerrendered', (e) => drawPageMarks(e.source?.div));
  drawAllMarks();
  // Nét vẽ / chữ thêm bằng công cụ của PDF.js chỉ giữ được khi lưu vào file: báo trang cha để hiện nút Lưu.
  let lastDirty = false;
  setInterval(() => {
    const dirty = !!app._annotationStorageModified;
    if (dirty !== lastDirty) { lastDirty = dirty; bridge()?.onPdfEdited?.(dirty); }
  }, 1200);
  // Trang cha vừa đổi danh sách nét (AI tô câu đáng nhớ, hoặc xoá các nét AI): nạp lại, vẫn hoàn tác được.
  window.pvReloadMarks = () => { snapshot(); loadMarks(); hideAll(); drawAllMarks(); };
  // Nhảy tới một trang (từ danh sách câu đáng nhớ ở tab Ghi chú).
  window.pvGoToPage = (n) => { app.page = Number(n) || 1; };
  window.pvSavePdf = async () => {
    const bytes = await app.pdfDocument.saveDocument();
    app._annotationStorageModified = false;
    delete app._annotationStorageModified;
    return bytes;
  };
}());

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
  const editorMode = window.PDFViewerApplication?.pdfViewer?.annotationEditorMode;
  if (editorMode > 0) return;
  const k = e.key.toLowerCase();
  const isUndo = k === 'z' && !e.shiftKey;
  const isRedo = k === 'y' || (k === 'z' && e.shiftKey);
  if (!isUndo && !isRedo) return;
  if (isUndo ? undoMark() : redoMark()) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

/* ---------- Cục tẩy ----------
   Bôi đen: xoá đúng phần chữ được chọn khỏi các nét (nét bị cắt đôi nếu tẩy ở giữa).
   Giữ chuột trái rê qua: xoá cả dòng nét nằm dưới con trỏ. Một lần tẩy là một bước hoàn tác. */
let eraseSession = null;
const EPS = 0.004;

function pageAt(x, y) {
  for (const el of pageEls()) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { el, r, n: Number(el.dataset.pageNumber) };
  }
  return null;
}

/** Xoá các dải nét nằm dưới điểm (x, y). Trả về true nếu có thay đổi. */
function eraseAtPoint(x, y) {
  const pg = pageAt(x, y);
  if (!pg) return false;
  const px = (x - pg.r.left) / pg.r.width;
  const py = (y - pg.r.top) / pg.r.height;
  let changed = false;
  for (const m of marks) {
    if (m.page !== pg.n) continue;
    const keep = m.rects.filter(([mx, my, mw, mh]) => !(px >= mx && px <= mx + mw && py >= my - 0.006 && py <= my + mh + 0.006));
    if (keep.length !== m.rects.length) { m.rects = keep; changed = true; }
  }
  if (changed) { marks = marks.filter((m) => m.rects.length); drawPageMarks(pg.el); }
  return changed;
}

/** Cắt bỏ phần nét trùng với vùng chữ đang bôi đen. */
function eraseSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const cuts = [];
  for (const r of sel.getRangeAt(0).getClientRects()) {
    if (r.width < 1 || r.height < 1) continue;
    const pg = pageAt(r.left + r.width / 2, r.top + r.height / 2);
    if (pg) cuts.push({ n: pg.n, x: (r.left - pg.r.left) / pg.r.width, y: (r.top - pg.r.top) / pg.r.height, w: r.width / pg.r.width, h: r.height / pg.r.height });
  }
  sel.removeAllRanges();
  let changed = false;
  for (const m of marks) {
    let rects = m.rects;
    for (const c of cuts.filter((k) => k.n === m.page)) {
      const next = [];
      for (const [x, y, w, h] of rects) {
        const overlapY = Math.min(y + h, c.y + c.h) - Math.max(y, c.y);
        const a = x; const b = x + w; const s = c.x; const e = c.x + c.w;
        if (overlapY < Math.min(h, c.h) * 0.5 || e <= a || s >= b) { next.push([x, y, w, h]); continue; }
        changed = true;
        if (s - a > EPS) next.push([a, y, s - a, h]);
        if (b - e > EPS) next.push([e, y, b - e, h]);
      }
      rects = next;
    }
    m.rects = rects.map((r) => r.map((v) => Math.round(v * 10000) / 10000));
  }
  if (changed) { marks = marks.filter((m) => m.rects.length); drawAllMarks(); }
  return changed;
}

function finishErase() {
  const session = eraseSession;
  eraseSession = null;
  const before = session ? session.before : JSON.stringify(marks);
  const changed = eraseSelection() || !!session?.changed;
  if (!changed) return;
  undoStack.push(before);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  syncHistoryButtons();
  saveMarks();
}

document.addEventListener('mousedown', (e) => {
  if (markState.mode !== 'erase' || e.button !== 0 || e.composedPath().includes(host)) return;
  if (!e.target.closest?.('#viewerContainer')) return;
  eraseSession = { before: JSON.stringify(marks), changed: false };
  if (eraseAtPoint(e.clientX, e.clientY)) eraseSession.changed = true;
}, true);
document.addEventListener('mousemove', (e) => {
  if (!eraseSession || !(e.buttons & 1)) return;
  if (eraseAtPoint(e.clientX, e.clientY)) eraseSession.changed = true;
}, true);
