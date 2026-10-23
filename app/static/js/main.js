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
import { isEmbed, splitActive, initSplit, initEmbed, restore as restoreSplit, forward as forwardSplit, toggle as toggleSplit, openPanel as openSplitPanel, openOther as openSplitOther, eachPane } from './split.js';
import { initPaneSync } from './panesync.js';
import { busyLabels } from './bgjobs.js';
import { startReminders } from './reminders.js';
import { startFeeds } from './calfeeds.js';
import { autoCheckUpdates } from './updates.js';
import { initPalette, openPalette, openDiary, paletteOpen } from './palette.js';

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

/** Tô mục đang mở ở thanh bên và trỏ nút Hướng dẫn tới đúng mục. */
function setActive(name) {
  const n = routes[name] ? name : '';
  document.querySelectorAll('#nav a[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === n));
  $('btn-help').href = `#/help?s=${help.sectionForRoute(n)}`;
  $('btn-help').hidden = n === 'help';
}

/** Gỡ trang đang hiện (trước khi chia đôi màn hình). */
function teardown() {
  if (typeof cleanup === 'function') { try { cleanup(); } catch (_) { /* bỏ qua */ } }
  cleanup = null;
  $('view').innerHTML = '';
}

export async function route() {
  // Đang chia đôi: cửa sổ chính không vẽ trang, chuyển địa chỉ mới cho khung đang chọn.
  if (splitActive()) { forwardSplit(location.hash || '#/'); $('nav').classList.remove('open'); return; }
  const { name, params, query } = parseHash();
  const view = routes[name] || dashboard;
  currentName = routes[name] ? name : '';
  if (typeof cleanup === 'function') { try { cleanup(); } catch (_) { /* bỏ qua */ } }
  cleanup = null;
  const root = $('view');
  root.className = 'view';
  root.innerHTML = '';
  setActive(currentName);
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
  eachPane((w) => w.pvApplyTheme?.(next));
});

/* ---------- Tìm kiếm toàn cục ---------- */

$('btn-quick-add').addEventListener('click', () => navigate('#/add'));
$('nav-toggle').addEventListener('click', () => $('nav').classList.toggle('open'));
window.addEventListener('pv:pane-pointerdown', () => $('nav').classList.remove('open'));
$('btn-split').addEventListener('click', (e) => openSplitPanel(e.currentTarget));

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
  if (e.ctrlKey && e.key === '\\' && !isEmbed) { e.preventDefault(); toggleSplit(); return; }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); showPalette(); return; }
  if (paletteOpen()) return;
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
  if (e.key === '/') { e.preventDefault(); showPalette(); }
  else if (e.key === 'n') navigate('#/add');
  else if (e.key === 'g') pendingG = Date.now(); // chờ phím tiếp theo
  else if (e.key === '?') navigate('#/help');
});
let pendingG = 0;

/* ---------- Tìm nhanh (Ctrl+K) ---------- */

// Ô tìm ở thanh trên mở bảng tìm nhanh: lệnh, paper, toàn văn, sổ tay, chat, lịch.
// Đang chia đôi thì hai khung dùng chung một bảng ở cửa sổ chính, kết quả mở ở khung đang chọn.
const PALETTE_EXTRA = [
  { icon: '➕', label: 'Thêm paper', hint: 'PDF arXiv DOI link', keys: ['N'], run: () => navigate('#/add') },
  { icon: '📔', label: 'Nhật ký hôm nay', hint: 'sổ tay daily', run: () => openDiary(navigate) },
  { icon: '💬', label: 'Cuộc trò chuyện mới', hint: 'chat hỏi đáp AI', run: () => navigate('#/chat?new=1') },
  { icon: '◫', label: 'Chia đôi / gộp màn hình', hint: 'split hai khung', keys: ['Ctrl', '\\'], run: () => toggleSplit() },
  { icon: '🌓', label: 'Đổi giao diện sáng / tối', hint: 'theme dark light', run: () => $('theme-toggle').click() },
  { icon: '💸', label: 'Chi phí & ngân sách AI', hint: 'cài đặt usage budget token', run: () => navigate('#/settings?s=usage') },
];
function paletteCommands() {
  const nav = [...document.querySelectorAll('#nav a[data-route]')].map((a) => ({
    icon: '→', label: `Mở ${a.dataset.full || a.textContent.trim()}`, hint: 'đi tới trang',
    keys: NAV_SHORTCUT[a.dataset.route], run: () => navigate(a.getAttribute('href')),
  }));
  return [...nav, ...PALETTE_EXTRA];
}
initPalette({ navigate, commands: paletteCommands, canOther: () => splitActive(), openOther: (h) => openSplitOther(null, h) });
window.pvPalette = (q) => openPalette(q);

/** Mở bảng tìm nhanh. Trong một khung khi chia đôi: chọn khung này rồi mở bảng ở cửa sổ chính. */
function showPalette(q = '') {
  if (isEmbed) {
    try {
      const h = window.parent?.pvSplit;
      if (h && window.parent.pvPalette) { h.setFocusFrom(window); window.parent.pvPalette(q); return; }
    } catch (_) { /* không với tới cửa sổ chính thì mở ngay trong khung */ }
  }
  openPalette(q);
}
$('global-search').addEventListener('focus', (e) => { const q = e.target.value; e.target.value = ''; e.target.blur(); showPalette(q); });

// Bản desktop, bấm ✕ khi Cài đặt là "Hỏi mỗi lần": desktop.py gọi hàm này để hỏi thu xuống khay hay thoát.
let askingClose = false;
window.pvAskClose = async () => {
  if (askingClose) return;
  askingClose = true;
  try {
    const { dialog } = await import('./ui.js');
    // Việc nền đang chạy ở cửa sổ chính và ở các khung chia đôi.
    const jobs = [...busyLabels()];
    eachPane((w) => { try { jobs.push(...(w.pvBusyJobs?.() || [])); } catch (_) { /* khung khác nguồn */ } });
    let remember = false;
    const r = await dialog({
      title: 'Đóng PaperVault?', width: 460,
      body: `<p style="margin-top:0"><b>Thu xuống khay</b>: app vẫn chạy ở biểu tượng cạnh đồng hồ, tới giờ vẫn nhắc việc. <b>Thoát</b>: tắt hẳn app.</p>
        ${jobs.length ? `<p class="status err">Đang chạy: ${escapeHtml(jobs.join(', '))}. Thoát bây giờ sẽ dừng các việc này.</p>` : ''}
        <label class="check"><input type="checkbox" id="ask-close-remember"> Ghi nhớ lựa chọn, không hỏi lại <span class="hint">(đổi lại ở Cài đặt → Ứng dụng)</span></label>`,
      buttons: [{ label: 'Huỷ', value: null }, { label: 'Thoát', value: 'quit', danger: true }, { label: 'Thu xuống khay', value: 'tray', primary: true }],
      onOpen: (b) => { b.querySelector('#ask-close-remember').addEventListener('change', (e) => { remember = e.target.checked; }); },
    });
    if (!r) return;
    if (remember) { const { saveSettings } = await import('./store.js'); await saveSettings({ closeAction: r }); }
    await desktop.closeChoice(r);
  } finally { askingClose = false; }
};

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
  if (isEmbed) initEmbed({ route, busy: busyLabels, applyTheme });
  else initSplit({ route, teardown, setActive });
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
  initPaneSync({
    currentName: () => currentName,
    rerender: async () => { if (splitActive()) return; const v = $('view'); const y = v.scrollTop; await route(); v.scrollTop = y; },
  });
  window.addEventListener('hashchange', route);
  if (!restoreSplit()) await route();
  // Nhắc việc và kiểm tra bản mới chỉ chạy ở cửa sổ chính, không chạy lại trong từng khung chia đôi.
  if (!isEmbed) { startReminders(); autoCheckUpdates(); }
  startFeeds({ primary: !isEmbed });
})();
