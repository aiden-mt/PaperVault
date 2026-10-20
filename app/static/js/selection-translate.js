// Bôi đen để dịch ở mọi trang của app (ghi chú, bài giảng, Hỏi đáp, Chat, danh sách paper…), cùng cách làm với trình
// đọc PDF (pdf-reader.js): bôi đen -> nút 文 -> bong bóng bản dịch theo ngữ cảnh câu, có Dịch bằng AI, Sao chép, và
// "+ Ghi chú" khi đang ở trang một paper. Trình đọc PDF nằm trong iframe riêng nên vẫn dùng bản của nó.
// Bật / tắt bằng Cài đặt → Dịch khi đọc → "Bôi đen để dịch ở mọi trang" (translate.appWide).
import { translateSelection, cleanText, TRANSLATE_DEFAULTS } from './translate.js';
import { store, paperById, savePaper } from './store.js';
import { translateText, hasCredentials } from './llm.js';
import { uid } from './util.js';
import { pronunciationHtml, handleSpeakAction, lookupPronunciation, phoneticWords, stopSpeaking } from './pronounce.js';

const HOVER_DELAY = 150;
const PREFETCH_DELAY = 60;
const MAX_CONTEXT_SIDE = 320;
const MAX_SELECTION_FOR_CONTEXT = 200;
const INLINE_DISPLAYS = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents', 'ruby', 'ruby-text']);

const config = () => ({ ...TRANSLATE_DEFAULTS, ...(store.settings?.translate || {}) });
const enabled = () => config().appWide !== false;
/** Paper đang mở (trang #/paper/<id>) để "+ Ghi chú" lưu vào đó; ngoài trang paper thì không có nút này. */
const currentPaper = () => { const m = /^#\/paper\/([^?/]+)/.exec(location.hash); return m ? paperById(m[1]) : null; };

const host = document.createElement('div');
host.id = 'pv-app-translate';
const shadow = host.attachShadow({ mode: 'open' });
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = new URL('../css/pdf-reader.css', import.meta.url).href;
const button = document.createElement('button');
button.className = 'pv-button';
button.type = 'button';
button.title = 'Dịch đoạn đã chọn (Ctrl+Shift+D)';
button.textContent = '文';
const panel = document.createElement('div');
panel.className = 'pv-panel';
const overlay = document.createElement('div');
overlay.className = 'pv-overlay';
shadow.append(link, overlay, button, panel);
// Gắn vào <html> chứ không vào <body>: body bị zoom theo cỡ chữ giao diện, còn toạ độ bôi đen là toạ độ màn hình.
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
/** Tô nhạt câu ngữ cảnh, thêm ⟦ ở đầu và ⟧ ở cuối, để thấy bộ dịch đã dựa vào câu nào. */
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

/* ---------- Câu ngữ cảnh quanh đoạn chọn ---------- */
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
  while (el && el !== document.body) {
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
  const ctx = { before: cleanText(before.text.slice(from)), after: cleanText(after.text.slice(0, to)), range: contextRange(range, before.map[from], after.map[to - 1]) };
  return ctx.before || ctx.after ? ctx : null;
}

/** Vùng không bật dịch: ô nhập liệu (bôi đen ở đó là để sửa chữ), mã nguồn, và chính bong bóng dịch. */
function excluded(node) {
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return !el || !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], pre, code, .no-translate');
}

function currentSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const text = sel.toString().trim();
  if (!text || text.length > 3000) return null;
  const range = sel.getRangeAt(0);
  if (excluded(range.startContainer) || excluded(range.endContainer)) return null;
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  const wants = config().useContext && cleanText(text).length <= MAX_SELECTION_FOR_CONTEXT;
  return { text, rect, context: wants ? extractContext(range, text) : null };
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
    currentPaper() ? '<button type="button" data-act="save" class="pv-primary" title="Lưu đoạn trích và bản dịch vào phần Trích dẫn của paper đang mở">+ Ghi chú</button>' : '',
    hasCredentials(store.settings) && !state.ai ? '<button type="button" data-act="ai" title="Dịch lại bằng mô hình AI đang dùng, sát văn phong học thuật hơn">Dịch bằng AI</button>' : '',
    '<button type="button" data-act="copy">Sao chép</button>',
  ].join('') : '';
  panel.innerHTML = `<div class="pv-header">
      <div class="pv-badges"><span class="pv-badge">${esc(state.badge || 'Đang dịch…')}</span>${kind ? `<span class="pv-badge pv-badge-${kind[0]}">${kind[1]}</span>` : ''}</div>
      <button type="button" class="pv-close" data-act="close" title="Đóng (Esc)">✕</button></div>
    ${rows.join('')}${actions ? `<div class="pv-actions">${actions}</div>` : ''}`;
  panel._state = state;
}
function showPanel(state) { renderPanel(state); place(panel, pending.rect); }

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
    const p = currentPaper();
    if (!p) return;
    btn.disabled = true;
    btn.textContent = 'Đang lưu…';
    try {
      const a = { id: uid('a'), quote: state.original, translation: state.ai || state.translated, page: '', note: '', at: new Date().toISOString() };
      await savePaper({ ...paperById(p.id), annotations: [...(paperById(p.id).annotations || []), a] });
      btn.textContent = 'Đã lưu ✓';
    } catch (_) { btn.disabled = false; btn.textContent = 'Lỗi, thử lại'; }
    return;
  }
  if (act === 'ai') {
    const t = token;
    showPanel({ ...state, aiLoading: true, aiError: '' });
    try {
      const ai = await translateText({ text: state.original, sentence: state.sourceSentence, targetLang: config().targetLang, settings: store.settings, paperTitle: currentPaper()?.title || '' });
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
  showPanel({ loading: true });
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
      pronLoading: wantsPron,
      sourceSentence: ctx ? [ctx.before, original, ctx.after].filter(Boolean).join(' ').replace(/\s+([,.;:!?…])/g, '$1') : original,
    });
    // Phiên âm tra sau, không làm chậm bản dịch.
    if (wantsPron) {
      const pron = await lookupPronunciation(original, res.detected).catch(() => null);
      if (t === token && panel._state) showPanel({ ...panel._state, pron, pronLoading: false });
    }
  } catch (err) {
    if (t === token) showPanel({ error: err.message || 'Không kết nối được tới bộ dịch.' });
  }
}

function handleSelection() {
  if (!enabled()) { hideAll(); return; }
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
  if (e.key === 'Escape' && panel.classList.contains('pv-visible')) hideAll();
  if (e.key.toLowerCase() === 'd' && e.ctrlKey && e.shiftKey && enabled()) {
    const sel = currentSelection();
    if (sel) { e.preventDefault(); pending = sel; doTranslate(); }
  }
});
window.addEventListener('scroll', hideAll, true);
window.addEventListener('resize', hideAll);
window.addEventListener('hashchange', hideAll);
