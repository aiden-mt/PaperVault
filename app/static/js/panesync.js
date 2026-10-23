// Đồng bộ giữa các bản app đang mở cùng lúc (hai khung chia đôi, hoặc nhiều tab trình duyệt).
// Bản nào ghi dữ liệu thì báo qua BroadcastChannel; các bản khác nạp lại dữ liệu, và vẽ lại trang nếu trang chỉ để xem
// (thư viện, tổng quan, lịch…) và người dùng không đang thao tác ở đó. Paper đang tick chọn cũng dùng chung.
import { store, loadAll, emit, onChange } from './store.js';
import { loadPages, pagesChangedElsewhere } from './notebook.js';
import { loadEvents } from './calendar.js';
import { applyAppearance } from './appearance.js';

const PASSIVE = new Set(['', 'library', 'topics', 'compare', 'calendar', 'notes']);

export function initPaneSync({ currentName, rerender }) {
  if (typeof BroadcastChannel !== 'function') return;
  const ch = new BroadcastChannel('pv-sync');
  const me = Math.random().toString(36).slice(2);

  // Ghi dữ liệu ở bản này → báo các bản khác (gộp các lần ghi liên tiếp).
  let outKinds = new Set();
  let outTimer = 0;
  window.addEventListener('pv:mutated', (e) => {
    outKinds.add(String(e.detail?.path || '').split(/[/?]/)[0]);
    clearTimeout(outTimer);
    outTimer = setTimeout(() => { ch.postMessage({ from: me, kinds: [...outKinds] }); outKinds = new Set(); }, 250);
  });

  // Paper đang tick chọn: chọn ở thư viện khung này, so sánh ở khung kia.
  let selKey = [...store.selected].sort().join(',');
  onChange(() => {
    const k = [...store.selected].sort().join(',');
    if (k === selKey) return;
    selKey = k;
    ch.postMessage({ from: me, sel: [...store.selected] });
  });

  let inKinds = new Set();
  let inTimer = 0;
  ch.onmessage = (e) => {
    const m = e.data || {};
    if (m.from === me) return;
    if (m.sel) {
      store.selected = new Set(m.sel);
      selKey = [...store.selected].sort().join(',');
      emit();
      if (currentName() === 'compare' && !document.hasFocus()) rerender();
      return;
    }
    (m.kinds || []).forEach((k) => inKinds.add(k));
    clearTimeout(inTimer);
    inTimer = setTimeout(refresh, 500);
  };

  async function refresh() {
    const kinds = inKinds;
    inKinds = new Set();
    try {
      await loadAll();
      if (kinds.has('pages')) { await loadPages(true); pagesChangedElsewhere(); }
      if (kinds.has('kv')) await loadEvents(true);
      // báo các phần chạy nền (nhắc việc…) rằng dữ liệu vừa được nạp lại từ bản khác
      window.dispatchEvent(new CustomEvent('pv:synced', { detail: { kinds: [...kinds] } }));
      if (kinds.has('settings')) applyAppearance(store.settings.appearance);
    } catch (_) { return; }
    const typing = document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]');
    if (PASSIVE.has(currentName()) && !document.hasFocus() && !typing && !document.querySelector('.modal')) rerender();
  }
}
