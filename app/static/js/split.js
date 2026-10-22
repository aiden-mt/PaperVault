// Chia đôi màn hình: hai khung đặt dọc (trái | phải) hoặc ngang (trên / dưới), mỗi khung chạy một chức năng của app.
// Mỗi khung là một bản app trong iframe ở chế độ nhúng (?embed=1): trang có đủ chức năng, không đụng ID của khung kia,
// và tự co giãn theo bề rộng khung. Cửa sổ chính giữ thanh bên + thanh trên; chúng điều khiển khung đang chọn (viền màu).
import { $, confirmDialog, toast } from './ui.js';
import { escapeHtml } from './util.js';
import { store, paperById } from './store.js';

export const isEmbed = new URLSearchParams(location.search).has('embed');

const LS_KEY = 'pv.split';
const DEFAULT = { on: false, dir: 'v', ratio: 50, focus: 'a', swapped: false, a: '#/', b: '#/notebook' };
let st = (() => { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') }; } catch (_) { return { ...DEFAULT }; } })();
const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch (_) { /* bỏ qua */ } };
const clampRatio = (r) => Math.max(15, Math.min(85, Math.round(Number(r) || 50)));
st.ratio = clampRatio(st.ratio);

let hooks = { route: async () => {}, teardown: () => {}, setActive: () => {} };
let root = null;
const other = (p) => (p === 'a' ? 'b' : 'a');
const frame = (p) => root?.querySelector(`.pane[data-pane="${p}"] iframe`);
const win = (p) => { try { return frame(p)?.contentWindow || null; } catch (_) { return null; } };
const routeName = (hash) => (String(hash || '').replace(/^#\/?/, '').split(/[/?]/)[0] || '');

/** Các chức năng chọn được cho một khung, lấy theo thanh bên (giữ đúng thứ tự và tên). */
function functions() {
  return [...document.querySelectorAll('#nav a[data-route]')].map((a) => [a.dataset.route, a.querySelector('.nav-l')?.textContent.trim() || a.textContent.trim(), a.querySelector('use')?.getAttribute('href') || '']);
}
const iconOf = (hash) => {
  const name = routeName(hash);
  if (name === 'paper') return '#i-file-plus';
  return (functions().find(([r]) => r === name) || [])[2] || '#i-dashboard';
};
const svg = (href) => (href ? `<svg class="i"><use href="${href}"/></svg>` : '');
/** Paper để mở khi chọn bố cục "đọc paper": paper đang mở ở một khung / màn hình chính, nếu không thì paper sửa gần nhất. */
function paperHash() {
  for (const h of [location.hash, st[st.focus], st.a, st.b]) if (routeName(h) === 'paper') return h;
  const p = [...store.papers].filter((x) => !x.deleted).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  return p ? `#/paper/${p.id}` : '#/library';
}
const PRESETS = [
  { id: 'read-note', dir: 'v', ratio: 55, label: 'Đọc paper + ghi chép', a: paperHash, b: () => '#/notebook', ia: '📄', ib: '📓' },
  { id: 'paper-chat', dir: 'v', ratio: 55, label: 'Đọc paper + Chat', a: paperHash, b: () => '#/chat', ia: '📄', ib: '💬' },
  { id: 'lib-chat', dir: 'h', ratio: 50, label: 'Thư viện + Chat', a: () => '#/library', b: () => '#/chat', ia: '📚', ib: '💬' },
  { id: 'cal-note', dir: 'v', ratio: 50, label: 'Lịch + Sổ tay', a: () => '#/calendar', b: () => '#/notebook', ia: '📅', ib: '📓' },
];
function labelOf(hash) {
  const name = routeName(hash);
  if (name === 'paper') {
    const id = decodeURIComponent(String(hash).replace(/^#\/?paper\//, '').split(/[/?]/)[0] || '');
    const p = paperById(id);
    return `Paper${p ? ` · ${p.title}` : ''}`;
  }
  return (functions().find(([r]) => r === name) || [, 'Trang'])[1];
}
/** Khung còn lại nên mở gì khi vừa chia đôi: đọc paper → Sổ tay, thư viện → Chat… */
function defaultOther(hash) {
  const name = routeName(hash);
  return { paper: '#/notebook', library: '#/chat', chat: '#/library', notebook: '#/library', calendar: '#/notebook', compare: '#/chat' }[name] || '#/notebook';
}
const paneUrl = (hash) => `${location.pathname}?embed=1${hash && hash !== '#' ? hash : '#/'}`;

export const splitActive = () => !!st.on && !isEmbed;

/* ---------- dựng khung ---------- */

function build() {
  if (root) return root;
  const pane = (p, n) => `<section class="pane" data-pane="${p}">
      <div class="pane-h">
        <span class="pane-tag" title="Khung ${n}">${n}</span>
        <span class="pane-ic"></span>
        <span class="pane-t"></span>
        <span class="pane-menu-wrap"><button type="button" class="sm pane-menu-btn" data-pmenu title="Mở chức năng hoặc paper khác trong khung này">Đổi ▾</button><div class="menu right pane-menu" hidden></div></span>
        <button type="button" class="icon-btn pane-b" data-pa="only" title="Chỉ giữ khung này (thoát chia đôi)">⤢</button>
        <button type="button" class="icon-btn pane-b" data-pa="close" title="Đóng khung này">✕</button>
      </div>
      <iframe class="pane-f" title="Khung ${n}"></iframe>
    </section>`;
  $('view').insertAdjacentHTML('afterend', `<div id="panes" class="panes" hidden>
      ${pane('a', 1)}
      <div class="pane-div" role="separator" tabindex="0" title="Kéo để đổi tỉ lệ · bấm đúp để về 50/50 · phím mũi tên để chỉnh từng 5%"><span class="pane-pct" hidden></span></div>
      ${pane('b', 2)}
      <div class="pane-cover" hidden></div>
    </div>`);
  root = $('panes');
  root.addEventListener('click', (e) => {
    const mb = e.target.closest('[data-pmenu]');
    if (mb) { togglePaneMenu(mb.closest('.pane').dataset.pane); return; }
    const go = e.target.closest('[data-pgo]');
    if (go) { const p = go.closest('.pane').dataset.pane; closePaneMenus(); navigatePane(p, go.dataset.pgo); setFocus(p); return; }
    const b = e.target.closest('[data-pa]');
    if (!b) return;
    const p = b.closest('.pane').dataset.pane;
    exit(b.dataset.pa === 'only' ? p : other(p));
  });
  root.querySelectorAll('.pane').forEach((el) => el.addEventListener('pointerdown', () => setFocus(el.dataset.pane)));
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('.pane-menu-wrap')) closePaneMenus(); }, true);
  root.querySelectorAll('iframe').forEach((f) => f.addEventListener('load', () => attach(f.closest('.pane').dataset.pane)));
  bindDivider(root.querySelector('.pane-div'));
  return root;
}

function closePaneMenus() { root?.querySelectorAll('.pane-menu').forEach((m) => { m.hidden = true; }); }
/** Menu đổi chức năng của một khung: các trang của app (có icon) và vài paper sửa gần đây. */
function togglePaneMenu(p) {
  const m = root.querySelector(`.pane[data-pane="${p}"] .pane-menu`);
  const open = m.hidden;
  closePaneMenus();
  if (!open) return;
  const cur = st[p] || '';
  const recent = [...store.papers].filter((x) => !x.deleted).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 6);
  m.innerHTML = `<div class="pm-h">Chức năng</div>${functions().map(([r, l, ic]) => `<button type="button" data-pgo="#/${r}" class="${routeName(cur) === r ? 'on' : ''}">${svg(ic)}<span>${escapeHtml(l)}</span></button>`).join('')}
    ${recent.length ? `<hr><div class="pm-h">Paper gần đây</div>${recent.map((x) => `<button type="button" data-pgo="#/paper/${x.id}" title="${escapeHtml(x.title)}">${svg('#i-file-plus')}<span class="pm-paper">${escapeHtml(x.title)}</span></button>`).join('')}` : ''}`;
  m.hidden = false;
  // khung dưới (chia ngang): menu không được tràn khỏi đáy cửa sổ, phần thừa cuộn trong menu
  const r = m.getBoundingClientRect();
  const z = r.width / (m.offsetWidth || r.width) || 1;
  m.style.maxHeight = `${Math.max(160, (window.innerHeight - r.top - 12) / z)}px`;
}

/** Nối sự kiện của bản app trong khung: bấm vào khung = chọn khung, đổi trang = cập nhật tiêu đề và địa chỉ. */
function attach(p) {
  const w = win(p);
  if (!w || w.location.href === 'about:blank') return;
  // Bấm vào trong khung: sự kiện thuộc iframe, cửa sổ chính không nhận được, nên tự đóng bảng ◫ và menu Đổi ▾ ở đây.
  w.addEventListener('pointerdown', () => { setFocus(p); closePanel(); closePaneMenus(); window.dispatchEvent(new CustomEvent('pv:pane-pointerdown')); }, true);
  w.addEventListener('focus', () => setFocus(p));
  w.addEventListener('hashchange', () => onPaneHash(p));
  onPaneHash(p);
}

function onPaneHash(p) {
  const w = win(p);
  if (!w) return;
  st[p] = w.location.hash || '#/';
  save();
  const t = root.querySelector(`.pane[data-pane="${p}"] .pane-t`);
  t.textContent = labelOf(st[p]);
  t.title = t.textContent;
  root.querySelector(`.pane[data-pane="${p}"] .pane-ic`).innerHTML = svg(iconOf(st[p]));
  if (p === st.focus) mirror();
}

/** Địa chỉ của cửa sổ chính đi theo khung đang chọn (không tạo bước lịch sử mới, không vẽ lại). */
function mirror() {
  const h = st[st.focus] || '#/';
  if (location.hash !== h) history.replaceState(null, '', h);
  hooks.setActive(routeName(h));
}

function setFocus(p) {
  if (!root) return;
  const changed = st.focus !== p;
  st.focus = p;
  root.querySelectorAll('.pane').forEach((el) => el.classList.toggle('focus', el.dataset.pane === p));
  if (changed) { save(); mirror(); }
}

function layout() {
  if (!root) return;
  root.className = `panes dir-${st.dir}`;
  root.hidden = !st.on;
  const first = st.swapped ? 'b' : 'a';
  root.querySelector(`.pane[data-pane="${first}"]`).style.cssText = `order:0;flex:0 0 calc(${st.ratio}% - 3px)`;
  root.querySelector(`.pane[data-pane="${other(first)}"]`).style.cssText = 'order:2;flex:1 1 0';
  root.querySelector('.pane-div').style.order = 1;
  root.querySelectorAll('.pane-tag').forEach((el) => { const p = el.closest('.pane').dataset.pane; el.textContent = p === first ? '1' : '2'; });
  const bs = $('btn-split');
  if (bs) bs.classList.toggle('on', !!st.on);
  drawPop();
}

function navigatePane(p, hash) {
  const f = frame(p);
  if (!f) return;
  const w = win(p);
  if (w && w.location.href !== 'about:blank' && w.location.pathname === location.pathname) {
    if (w.location.hash === hash) w.pvRoute?.();
    else w.location.hash = hash;
  } else f.src = paneUrl(hash);
}

/* ---------- vào / ra chế độ chia đôi ---------- */

export function enter({ dir, a, b, ratio } = {}) {
  build();
  if (dir) st.dir = dir;
  if (ratio) st.ratio = clampRatio(ratio);
  if (!st.on) {
    st.a = a || location.hash || '#/';
    st.b = b || defaultOther(st.a);
    st.focus = 'a';
    st.swapped = false;
    st.on = true;
    hooks.teardown();
    $('view').hidden = true;
    frame('a').src = paneUrl(st.a);
    frame('b').src = paneUrl(st.b);
    setFocus('a');
    showTip();
  } else if (b) navigatePane(other(st.focus), b);
  save();
  layout();
}

/** Bố cục nhanh: đặt chiều, tỉ lệ và trang của hai khung một lần. */
export function applyPreset(id) {
  const pr = PRESETS.find((x) => x.id === id);
  if (!pr) return;
  const a = pr.a();
  const b = pr.b();
  if (!st.on) { enter({ dir: pr.dir, a, b, ratio: pr.ratio }); return; }
  st.dir = pr.dir;
  st.ratio = pr.ratio;
  st.swapped = false;
  navigatePane('a', a);
  navigatePane('b', b);
  setFocus('a');
  save();
  layout();
}

/** Lần đầu chia đôi: nhắc ngắn cách dùng. */
function showTip() {
  try { if (localStorage.getItem('pv.splitTip')) return; localStorage.setItem('pv.splitTip', '1'); } catch (_) { return; }
  toast('Đang chia đôi: bấm vào một khung để chọn nó (viền màu), thanh bên trái sẽ điều khiển khung đó. Kéo thanh giữa để đổi tỉ lệ, nút “Đổi ▾” để mở chức năng khác.', 9000);
}

/** Mở lại bố cục đã lưu khi khởi động app. */
export function restore() {
  if (!st.on || isEmbed) return false;
  build();
  if (location.hash && location.hash !== st[st.focus]) st[st.focus] = location.hash;
  $('view').hidden = true;
  frame('a').src = paneUrl(st.a);
  frame('b').src = paneUrl(st.b);
  setFocus(st.focus);
  root.querySelectorAll('.pane').forEach((el) => el.classList.toggle('focus', el.dataset.pane === st.focus));
  layout();
  mirror();
  return true;
}

/** Thoát chia đôi, giữ trang của khung keep ở màn hình chính. Hỏi lại nếu khung bị đóng còn việc nền đang chạy. */
export async function exit(keep = st.focus) {
  if (!st.on) return;
  const busy = ['a', 'b'].flatMap((p) => { try { return win(p)?.pvBusyJobs?.() || []; } catch (_) { return []; } });
  if (busy.length && !(await confirmDialog(`Trong các khung đang có việc chạy nền: ${busy.join(', ')}. Đóng khung sẽ dừng các việc này. Vẫn đóng?`, { title: 'Đóng chia đôi', okLabel: 'Vẫn đóng', danger: true }))) return;
  const hash = st[keep] || '#/';
  st.on = false;
  save();
  ['a', 'b'].forEach((p) => { const f = frame(p); if (f) f.src = 'about:blank'; });
  layout();
  $('view').hidden = false;
  history.replaceState(null, '', hash);
  await hooks.route();
}

export function toggle() { if (st.on) exit(); else enter(); }

export function swap() { st.swapped = !st.swapped; st.ratio = 100 - st.ratio; save(); layout(); }

export function setDir(dir) { if (!st.on) enter({ dir }); else { st.dir = dir; save(); layout(); } }

export function setRatio(r) { st.ratio = clampRatio(r); save(); layout(); }

/** Cửa sổ chính đổi trang (thanh bên, ô tìm kiếm, phím tắt) → chuyển cho khung đang chọn. */
export function forward(hash) { navigatePane(st.focus, hash || '#/'); }

/** Mở một trang ở khung không được chọn (Alt + bấm link trong một khung). */
export function openOther(fromPane, hash) {
  const p = fromPane ? other(fromPane) : other(st.focus);
  navigatePane(p, hash);
}

/** Gửi một hàm tới mọi khung (vd. đổi giao diện sáng / tối). */
export function eachPane(fn) { ['a', 'b'].forEach((p) => { const w = win(p); if (w && w.location.href !== 'about:blank') { try { fn(w); } catch (_) { /* khung đang tải */ } } }); }

/* ---------- thanh chia: kéo chuột, phím mũi tên, bấm đúp ---------- */

function bindDivider(div) {
  const pct = div.querySelector('.pane-pct');
  const cover = root.querySelector('.pane-cover');
  const show = () => { pct.hidden = false; pct.textContent = `${st.ratio} : ${100 - st.ratio}`; };
  div.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    cover.hidden = false; // iframe nuốt sự kiện chuột, phủ một lớp trong suốt khi đang kéo
    cover.style.cursor = st.dir === 'v' ? 'col-resize' : 'row-resize';
    div.classList.add('drag');
    let raf = 0;
    let last = null;
    const move = (ev) => {
      last = ev;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = root.getBoundingClientRect();
        const v = st.dir === 'v' ? (last.clientX - r.left) / r.width : (last.clientY - r.top) / r.height;
        const ratio = clampRatio(v * 100);
        if (ratio !== st.ratio) { st.ratio = ratio; layout(); }
        show();
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      cover.hidden = true;
      div.classList.remove('drag');
      pct.hidden = true;
      save();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  div.addEventListener('dblclick', () => { setRatio(50); show(); setTimeout(() => { pct.hidden = true; }, 900); });
  div.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -5, ArrowUp: -5, ArrowRight: 5, ArrowDown: 5 }[e.key];
    if (!d) return;
    e.preventDefault();
    setRatio(st.ratio + d);
    show();
  });
  div.addEventListener('blur', () => { pct.hidden = true; });
}

/* ---------- bảng điều khiển ở thanh trên ---------- */

let pop = null;
/** Đóng bảng ◫ (bấm ra ngoài, bấm vào một khung, Esc). */
export function closePanel() { if (pop) pop.hidden = true; }
function drawPop() {
  if (!pop || pop.hidden) return;
  const fns = functions();
  const otherHash = st.on ? st[other(st.focus)] : defaultOther(location.hash);
  const mini = (dir, ia, ib) => `<span class="sp-mini dir-${dir}"><i>${ia}</i><i>${ib}</i></span>`;
  pop.innerHTML = `<div class="sp-h"><b>Chia đôi màn hình</b><span class="spacer"></span><kbd>Ctrl</kbd><kbd>\\</kbd></div>
    <div class="sp-sub">Bố cục nhanh</div>
    <div class="sp-presets-g">${PRESETS.map((x) => `<button type="button" class="sp-pre" data-sp-pre="${x.id}">${mini(x.dir, x.ia, x.ib)}<span>${escapeHtml(x.label)}</span></button>`).join('')}</div>
    <div class="sp-sub">Tuỳ chỉnh</div>
    <div class="seg sp-modes">
      <button type="button" data-sp-mode="off" class="${st.on ? '' : 'active'}" title="Một trang"><span class="sp-mini one"><i></i></span>Một khung</button>
      <button type="button" data-sp-mode="v" class="${st.on && st.dir === 'v' ? 'active' : ''}" title="Trái | phải">${mini('v', '', '')}Chia dọc</button>
      <button type="button" data-sp-mode="h" class="${st.on && st.dir === 'h' ? 'active' : ''}" title="Trên / dưới">${mini('h', '', '')}Chia ngang</button>
    </div>
    <label class="sp-row"><span>Khung ${st.on ? 'kia' : 'thứ hai'} mở</span>
      <select id="sp-other"><option value="">${escapeHtml(labelOf(otherHash))}</option>${fns.map(([r, l]) => `<option value="#/${r}">${escapeHtml(l)}</option>`).join('')}</select></label>
    <div class="sp-row"><span>Tỉ lệ ${st.dir === 'v' ? 'khung trái' : 'khung trên'}</span>
      <span class="sp-ratio"><input id="sp-ratio" type="number" min="15" max="85" step="1" value="${st.ratio}"> %</span></div>
    <div class="sp-presets">${[[50, '50 : 50'], [60, '60 : 40'], [70, '70 : 30'], [40, '40 : 60'], [30, '30 : 70']].map(([v, l]) => `<button type="button" class="sm ${st.ratio === v ? 'primary' : ''}" data-sp-ratio="${v}">${l}</button>`).join('')}</div>
    ${st.on ? '<button type="button" class="sm" id="sp-swap">⇄ Đổi chỗ hai khung</button>' : ''}
    <p class="hint sp-hint">Bấm vào một khung để chọn nó (viền màu). Thanh bên trái, ô tìm kiếm và phím tắt điều khiển khung đang chọn. Kéo thanh giữa hai khung để đổi tỉ lệ, bấm đúp để về 50 : 50. Nút <b>Đổi ▾</b> trên mỗi khung mở chức năng hoặc paper khác. <b>Alt + bấm</b> một link để mở nó ở khung bên kia.</p>`;
}

export function openPanel(anchor) {
  if (!pop) {
    pop = document.createElement('div');
    pop.className = 'sp-pop';
    pop.hidden = true;
    document.body.appendChild(pop);
    pop.addEventListener('click', (e) => {
      const pre = e.target.closest('[data-sp-pre]');
      if (pre) { applyPreset(pre.dataset.spPre); pop.hidden = true; return; }
      const m = e.target.closest('[data-sp-mode]');
      if (m) { const v = m.dataset.spMode; if (v === 'off') exit(); else setDir(v); return; }
      const r = e.target.closest('[data-sp-ratio]');
      if (r) { if (!st.on) enter(); setRatio(r.dataset.spRatio); return; }
      if (e.target.closest('#sp-swap')) swap();
    });
    pop.addEventListener('change', (e) => {
      if (e.target.id === 'sp-ratio') setRatio(e.target.value);
      if (e.target.id === 'sp-other' && e.target.value) { if (!st.on) enter({ b: e.target.value }); else navigatePane(other(st.focus), e.target.value); }
    });
    pop.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'sp-ratio') setRatio(e.target.value); });
    document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest?.('#btn-split')) pop.hidden = true; }, true);
    // Dự phòng: cửa sổ chính mất tiêu điểm (bấm vào iframe, đổi sang ứng dụng khác) thì cũng đóng.
    window.addEventListener('blur', () => { if (!pop.hidden && !pop.contains(document.activeElement)) pop.hidden = true; closePaneMenus(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) pop.hidden = true; });
  }
  if (!pop.hidden) { pop.hidden = true; return; }
  pop.hidden = false;
  drawPop();
  const r = anchor.getBoundingClientRect();
  const z = r.width / (anchor.offsetWidth || r.width) || 1; // body có CSS zoom
  pop.style.top = `${(r.bottom + 6) / z}px`;
  pop.style.right = `${Math.max(8, (document.documentElement.clientWidth - r.right) / z)}px`;
}

/* ---------- khởi tạo ---------- */

/** Cửa sổ chính: hooks.route vẽ trang, hooks.teardown gỡ trang hiện tại, hooks.setActive(name) tô mục thanh bên. */
export function initSplit(h) {
  hooks = { ...hooks, ...h };
  window.pvSplit = { toggle, enter, exit, openOther, setFocusFrom: (w) => ['a', 'b'].find((p) => win(p) === w) };
}

/** Bản app trong một khung: phím tắt chia đôi và Alt + bấm link gửi lên cửa sổ chính. */
export function initEmbed({ route, busy, applyTheme }) {
  document.documentElement.classList.add('embed');
  window.pvRoute = route;
  window.pvBusyJobs = busy;
  window.pvApplyTheme = applyTheme;
  const host = () => { try { return window.parent?.pvSplit || null; } catch (_) { return null; } };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === '\\') { e.preventDefault(); host()?.toggle(); }
  });
  document.addEventListener('click', (e) => {
    if (!e.altKey) return;
    const a = e.target.closest('a[href^="#/"]');
    const h = host();
    if (!a || !h) return;
    e.preventDefault();
    e.stopPropagation();
    h.openOther(h.setFocusFrom(window), a.getAttribute('href'));
  }, true);
}

export const splitState = () => ({ ...st });
