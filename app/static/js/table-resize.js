// Kéo mép tiêu đề cột để đổi độ rộng cột, áp dụng cho mọi bảng có hàng tiêu đề (<th>) trong app.
// Kéo một cột chỉ đổi cột đó, bảng rộng ra hoặc hẹp lại theo (bảng rộng hơn khung thì cuộn ngang).
// Độ rộng được nhớ theo bộ tiêu đề cột: bảng cùng loại ở paper khác cũng dùng lại. Bấm đúp vào mép cột để về tự động.
// Chiều cao hàng luôn tự co giãn theo nội dung.

const EDGE = 6; // vùng bắt chuột quanh mép cột, tính bằng px
const MIN_W = 48;
const PREFIX = 'pv.colw:';

const headerRow = (table) => table.tHead?.rows[0] || table.rows[0] || null;
const headerCells = (table) => {
  const row = headerRow(table);
  return row && [...row.cells].every((c) => c.tagName === 'TH') ? [...row.cells] : [];
};
const usable = (table) => table && !table.closest('[data-noresize]') && !table.hasAttribute('data-noresize') && headerCells(table).length > 1;
const storeKey = (table) => `${PREFIX}${headerCells(table).map((c) => c.textContent.trim().slice(0, 40)).join('|')}`;

function load(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } }
function save(key, val) { try { if (val) localStorage.setItem(key, JSON.stringify(val)); else localStorage.removeItem(key); } catch (_) { /* bộ nhớ trình duyệt bị chặn */ } }

/** Bảng nằm trong khung không cuộn ngang được thì bọc thêm một khung cuộn, để bảng kéo rộng không làm vỡ trang. */
function ensureScroller(table) {
  const p = table.parentElement;
  if (!p || p.classList.contains('tbl-scroll')) return;
  const ov = getComputedStyle(p).overflowX;
  if (ov === 'auto' || ov === 'scroll') return;
  const wrap = document.createElement('div');
  wrap.className = 'tbl-scroll';
  p.insertBefore(wrap, table);
  wrap.appendChild(table);
}

function applyWidths(table, widths) {
  const cells = headerCells(table);
  if (!widths || widths.length !== cells.length) return false;
  ensureScroller(table);
  cells.forEach((c, i) => { c.style.width = `${widths[i]}px`; c.style.minWidth = ''; c.style.maxWidth = ''; });
  table.style.tableLayout = 'fixed';
  table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`;
  table.style.minWidth = '0';
  table.style.maxWidth = 'none';
  table.dataset.resized = '1';
  return true;
}

function resetWidths(table) {
  headerCells(table).forEach((c) => { c.style.width = ''; });
  table.style.tableLayout = '';
  table.style.width = '';
  table.style.minWidth = '';
  table.style.maxWidth = '';
  delete table.dataset.resized;
  save(storeKey(table), null);
}

/** Ô tiêu đề có mép đang nằm dưới con trỏ (mép phải của ô đó, hoặc mép trái của ô kế tiếp). */
function edgeAt(ev) {
  const th = ev.target.closest?.('th');
  if (!th) return null;
  const table = th.closest('table');
  if (!usable(table)) return null;
  const cells = headerCells(table);
  const i = cells.indexOf(th);
  if (i < 0) return null;
  const r = th.getBoundingClientRect();
  if (r.right - ev.clientX <= EDGE) return { table, cells, i };
  if (ev.clientX - r.left <= EDGE && i > 0) return { table, cells, i: i - 1 };
  return null;
}

/** Tỉ lệ giữa px trên màn hình và px CSS của bảng (khác 1 khi giao diện hoặc nội dung được phóng to). */
const zoomOf = (el) => (el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1) || 1;

let drag = null;

document.addEventListener('mousemove', (ev) => {
  if (drag) {
    const w = Math.max(MIN_W, Math.round(drag.start + (ev.clientX - drag.x) / drag.z));
    drag.widths[drag.i] = w;
    applyWidths(drag.table, drag.widths);
    return;
  }
  document.documentElement.classList.toggle('col-resize-hover', !!edgeAt(ev));
}, { passive: true });

document.addEventListener('mousedown', (ev) => {
  if (ev.button !== 0) return;
  const hit = edgeAt(ev);
  if (!hit) return;
  ev.preventDefault();
  ev.stopPropagation();
  const z = zoomOf(hit.table);
  const widths = hit.cells.map((c) => Math.round(c.getBoundingClientRect().width / z));
  drag = { table: hit.table, i: hit.i, x: ev.clientX, start: widths[hit.i], widths, z };
  applyWidths(hit.table, widths);
  document.documentElement.classList.add('col-resizing');
}, true);

document.addEventListener('mouseup', () => {
  if (!drag) return;
  save(storeKey(drag.table), drag.widths);
  drag = null;
  document.documentElement.classList.remove('col-resizing');
}, true);

// Bấm vào mép cột không được làm sắp xếp bảng hay mở/gập mục chứa bảng.
document.addEventListener('click', (ev) => { if (edgeAt(ev)) { ev.preventDefault(); ev.stopPropagation(); } }, true);

document.addEventListener('dblclick', (ev) => {
  const hit = edgeAt(ev);
  if (!hit) return;
  ev.preventDefault();
  resetWidths(hit.table);
}, true);

/** Bảng mới hiện ra mà đã có độ rộng lưu từ trước thì áp lại. */
function restoreIn(root) {
  const tables = root.tagName === 'TABLE' ? [root] : root.querySelectorAll?.('table') || [];
  for (const t of tables) {
    if (t.dataset.resized || !usable(t)) continue;
    const w = load(storeKey(t));
    if (w) applyWidths(t, w);
  }
}

let pending = null;
new MutationObserver((records) => {
  for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) (pending ||= new Set()).add(n);
  if (pending && !pending.scheduled) {
    pending.scheduled = true;
    requestAnimationFrame(() => { const nodes = pending; pending = null; for (const n of nodes) if (n.isConnected) restoreIn(n); });
  }
}).observe(document.body, { childList: true, subtree: true });
restoreIn(document.body);
