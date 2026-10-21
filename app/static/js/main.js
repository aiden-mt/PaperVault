// Điểm vào của app: nạp dữ liệu, router theo hash, điều hướng, phím tắt.
import { api } from './api.js';
import { store, loadAll, onChange } from './store.js';
import { $ } from './ui.js';
import './table-resize.js';
import './selection-translate.js';
import { applyAppearance, cachedAppearance } from './appearance.js';
import { escapeHtml, download } from './util.js';
import { whenReady, isDesktop, desktop } from './desktop.js';
import * as dashboard from './views/dashboard.js';
import * as library from './views/library.js';
import * as paper from './views/paper.js';
import * as add from './views/add.js';
import * as compare from './views/compare.js';
import * as topics from './views/topics.js';
import * as settings from './views/settings.js';
import * as feed from './views/feed.js';
import * as chat from './views/chat.js';
import * as help from './views/help.js';
import * as notes from './views/notes.js';
import * as notebook from './views/notebook.js';
import * as calendar from './views/calendar.js';
import { loadMathLib } from './mathlib.js';
import { syncTranslateButton } from './translate-popup.js';

const routes = { '': dashboard, library, paper, add, compare, topics, settings, feed, chat, help, notes, notebook, calendar };
let cleanup = null;
let currentName = '';

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const qi = raw.indexOf('?');
  const path = qi >= 0 ? raw.slice(0, qi) : raw;
  const query = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
  const segs = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: segs[0] || '', params: segs.slice(1), query };
}

export async function route() {
  const { name, params, query } = parseHash();
  const view = routes[name] || dashboard;
  currentName = routes[name] ? name : '';
  if (typeof cleanup === 'function') { try { cleanup(); } catch (_) { /* bỏ qua */ } }
  cleanup = null;
  const root = $('view');
  root.className = 'view';
  root.innerHTML = '';
  document.querySelectorAll('#nav a[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === currentName));
  $('btn-help').href = `#/help?s=${help.sectionForRoute(currentName)}`;
  $('btn-help').hidden = currentName === 'help';
  $('nav').classList.remove('open');
  try {
    cleanup = await view.render(root, { params, query });
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="empty">Lỗi hiển thị trang: ${e.message}</div>`;
  }
  root.scrollTop = 0;
}

export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

/* ---------- Giao diện sáng / tối ---------- */

const currentTheme = () => document.documentElement.dataset.theme
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  $('theme-label').textContent = currentTheme() === 'dark' ? 'Giao diện sáng' : 'Giao diện tối';
}

$('theme-toggle').addEventListener('click', async () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('pv-theme', next); } catch (_) { /* bỏ qua */ }
});

/* ---------- Tìm kiếm toàn cục ---------- */

$('global-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = e.target.value.trim();
    navigate(`#/library?q=${encodeURIComponent(q)}`);
  }
});
$('btn-quick-add').addEventListener('click', () => navigate('#/add'));
$('nav-toggle').addEventListener('click', () => $('nav').classList.toggle('open'));

// Phím tắt chuyển trang: "g" rồi một phím (G D = Tổng quan…), riêng Thêm paper là "n".
// Một bảng dùng chung cho cả xử lý phím lẫn nhãn phím tắt hiện cạnh mục menu.
const GO_KEYS = { '': 'd', library: 'l', chat: 'a', compare: 'c', feed: 'f', topics: 't', notes: 'n', notebook: 'b', calendar: 'k', settings: 's', help: 'h' };
const NAV_SHORTCUT = { ...Object.fromEntries(Object.entries(GO_KEYS).map(([r, k]) => [r, ['G', k.toUpperCase()]])), add: ['N'] };
const kbdHtml = (keys) => keys.map((k) => `<kbd>${k}</kbd>`).join('');

document.querySelectorAll('.nav a[data-route]').forEach((a) => {
  const keys = NAV_SHORTCUT[a.dataset.route];
  if (!keys) return;
  a.title = `${a.dataset.full || a.textContent.trim()} · phím tắt ${keys.join(' rồi ')}`;
  const s = document.createElement('span');
  s.className = 'nav-kbd';
  s.innerHTML = kbdHtml(keys);
  a.appendChild(s);
});
$('btn-quick-add').title = 'Thêm paper (phím N)';
$('btn-quick-add').insertAdjacentHTML('beforeend', '<kbd class="btn-kbd">N</kbd>');
$('btn-help').title = 'Hướng dẫn cho trang này (phím ?)';
$('btn-translate').title = 'Dịch khi bôi đen: cài đặt nhanh, ghi chú & thẻ ghi nhớ (bôi đen rồi Ctrl+Shift+D để dịch ngay)';

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  // Đang chờ phím thứ hai của "g …" thì xử lý trước, để "g n" mở Ghi chú chứ không phải Thêm paper.
  if (pendingG && Date.now() - pendingG < 900) {
    pendingG = 0;
    const route = Object.keys(GO_KEYS).find((r) => GO_KEYS[r] === e.key.toLowerCase());
    if (route != null) { e.preventDefault(); navigate(`#/${route}`); }
    return;
  }
  if (e.key === '/') { e.preventDefault(); $('global-search').focus(); }
  else if (e.key === 'n') navigate('#/add');
  else if (e.key === 'g') pendingG = Date.now(); // chờ phím tiếp theo
  else if (e.key === '?') navigate('#/help');
});
let pendingG = 0;

// Cho các khung con (trình đọc PDF) dùng chung cách lưu file của app: hỏi chỗ lưu, bản desktop dùng hộp thoại của Windows.
window.pvDownload = (name, content, mime) => download(name, content, mime);

/* ---------- Kéo thả file ---------- */

// PDF chỉ được thêm qua trang "Thêm paper". Thả file ở chỗ khác thì bỏ qua,
// đồng thời chặn trình duyệt / WebView2 mở file đó thay cho app.
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e) || e.defaultPrevented) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'none';
});
window.addEventListener('drop', (e) => { if (hasFiles(e)) e.preventDefault(); });

/* ---------- Thông tin chọn ---------- */

onChange(() => {
  const n = store.selected.size;
  $('sel-info').innerHTML = n ? `<a href="#/compare">${n} paper đã chọn →</a>` : '';
  const inbox = $('nav-inbox');
  if (inbox) { inbox.textContent = store.inbox.length || ''; inbox.hidden = !store.inbox.length; }
});

/* ---------- Khởi động ---------- */

/* ---------- Chế độ desktop (pywebview) ---------- */

async function initDesktop() {
  const ok = await whenReady();
  if (!ok) return;
  document.documentElement.dataset.desktop = '1';
  // Link ngoài mở bằng trình duyệt mặc định của hệ điều hành thay vì bên trong cửa sổ app.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href) && !href.startsWith(location.origin)) {
      e.preventDefault();
      desktop.openUrl(href);
    } else if (a.target === '_blank' && href.startsWith('/api/pdf/')) {
      e.preventDefault();
      desktop.openUrl(location.origin + href);
    }
  }, true);
}

(async function init() {
  try { applyTheme(localStorage.getItem('pv-theme') || ''); } catch (_) { /* bỏ qua */ }
  applyAppearance(cachedAppearance()); // áp ngay bản đã nhớ, tránh nháy phông mặc định
  await initDesktop();
  try {
    await loadAll();
    loadMathLib(); // macro LaTeX tự định nghĩa (Sổ tay → Thư viện LaTeX) dùng cho mọi công thức
    applyAppearance(store.settings.appearance);
    syncTranslateButton();
    const h = await api.health();
    const dir = h.dataDir.length > 30 ? `…${h.dataDir.slice(-28)}` : h.dataDir;
    $('conn').innerHTML = `<svg class="i"><use href="#i-database"/></svg><span><b>${h.papers} paper</b>${isDesktop() ? ' · bản desktop' : ''}<br>${escapeHtml(dir)}</span>`;
    $('conn').title = `Thư mục dữ liệu: ${h.dataDir}`;
  } catch (e) {
    $('view').innerHTML = `<div class="empty"><b>Không kết nối được máy chủ.</b><br>${e.message}<br><br>Chạy <code>python server.py</code> trong thư mục app rồi tải lại trang.</div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  await route();
})();
