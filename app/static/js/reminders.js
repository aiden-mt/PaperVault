// Nhắc việc của Lịch: chạy ở cửa sổ chính (không chạy trong khung chia đôi), 30 giây xem một lần. Tới giờ nhắc thì
// hiện thẻ thông báo kèm tiếng chuông, thông báo của hệ điều hành (bản desktop: qua biểu tượng ở khay, vẫn chạy khi
// đã đóng cửa sổ) và nháy nút app trên thanh tác vụ.
// Lần nhắc đã hiện ghi vào localStorage để không nhắc lại; mở app muộn vẫn nhắc nếu việc chưa kết thúc.
import { loadEvents, occurrences, remindAt, hasRemind, ymd, addDays, fmtDay, parseYmd, onCalendarChange } from './calendar.js';
import { notice } from './notice.js';
import { escapeHtml } from './util.js';
import { isDesktop, desktop } from './desktop.js';

const KEY = 'pv.remFired';
const GRACE = 30 * 60e3;    // mở app muộn: vẫn nhắc trong 30 phút sau giờ nhắc, hoặc tới khi việc kết thúc
const SNOOZE = 10 * 60e3;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { return {}; } };
const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (_) { /* bỏ qua */ } };

let timer = 0;
let ticks = 0;
const snoozed = new Map(); // key -> thời điểm nhắc lại

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [1175, 0.18]].forEach(([f, at]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.55);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch (_) { /* không có âm thanh */ }
}

const when = (o) => `${o.ev.start ? `${o.ev.start}${o.ev.end ? `–${o.ev.end}` : ''}` : 'Cả ngày'} · ${o.date === ymd(new Date()) ? 'hôm nay' : fmtDay(o.date)}`;

function fire(o, key) {
  const fired = read();
  fired[key] = Date.now();
  write(fired);
  chime();
  // Bản desktop: cửa sổ đang ẩn ở khay hoặc không ở trước thì báo bằng thông báo của Windows (bấm vào mở đúng ngày).
  const away = document.hidden || !document.hasFocus();
  if (isDesktop()) { desktop.attention(); if (away) desktop.notify(`⏰ ${o.ev.title}`, when(o), `#/calendar?d=${o.date}`); }
  try {
    if (window.Notification && Notification.permission === 'granted' && document.hidden) new Notification(`⏰ ${o.ev.title}`, { body: when(o), tag: key });
  } catch (_) { /* bỏ qua */ }
  notice({
    key: `rem:${key}`, icon: '⏰', kind: 'remind',
    title: o.ev.title,
    body: `${escapeHtml(when(o))}${o.ev.notes ? `<div class="pvn-notes">${escapeHtml(o.ev.notes.slice(0, 200))}</div>` : ''}`,
    actions: [
      { label: 'Mở Lịch', primary: true, onClick: () => { location.hash = `#/calendar?d=${o.date}`; } },
      { label: 'Báo lại sau 10 phút', onClick: () => { snoozed.set(key, Date.now() + SNOOZE); } },
    ],
  });
}

/** Lúc việc kết thúc (ms): giờ kết thúc, không có thì bắt đầu + 1 giờ; việc cả ngày thì hết ngày. */
function endOf(o) {
  const d = parseYmd(o.date);
  const hm = o.ev.start ? (o.ev.end && o.ev.end > o.ev.start ? o.ev.end : null) : '23:59';
  if (hm) { const [h, m] = hm.split(':').map(Number); d.setHours(h, m, 0, 0); return d.getTime(); }
  const [h, m] = o.ev.start.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime() + 3600e3;
}

async function tick() {
  ticks++;
  // Lịch có thể đổi ở khung khác / tab khác: thỉnh thoảng nạp lại từ máy chủ.
  await loadEvents(ticks % 4 === 0).catch(() => null);
  const now = Date.now();
  const today = new Date();
  const fired = read();
  for (const [k, at] of snoozed) {
    if (at > now) continue;
    snoozed.delete(k);
    const [id, date] = k.split('|');
    const o = occurrences(date, date).find((x) => x.ev.id === id);
    if (o && !o.done) fire(o, k);
  }
  // Nhắc "trước 1 ngày" của việc ngày mai cũng nằm trong khoảng này.
  for (const o of occurrences(ymd(addDays(today, -1)), ymd(addDays(today, 2)))) {
    if (o.done || !hasRemind(o.ev)) continue;
    const at = remindAt(o.ev, o.date);
    const key = `${o.ev.id}|${o.date}|${o.ev.remind}|${o.ev.start || ''}`;
    if (!at || at.getTime() > now || now > Math.max(at.getTime() + GRACE, endOf(o)) || fired[key] || snoozed.has(key)) continue;
    fire(o, key);
  }
  // Dọn khoá cũ hơn 3 ngày.
  const keep = Object.fromEntries(Object.entries(read()).filter(([, t]) => now - t < 3 * 864e5));
  write(keep);
}

export function startReminders() {
  if (timer) return;
  setTimeout(tick, 3000);
  timer = setInterval(tick, 30000);
  onCalendarChange(() => setTimeout(tick, 200));
  // Kế hoạch sửa ở khung chia đôi / tab khác: xét nhắc ngay khi dữ liệu được đồng bộ về.
  window.addEventListener('pv:synced', (e) => { if (e.detail?.kinds?.includes('kv')) setTimeout(tick, 200); });
}

/** Xin quyền thông báo của trình duyệt (gọi khi người dùng chọn nhắc việc lần đầu). */
export function askNotifyPermission() {
  try {
    if (!isDesktop() && window.Notification && Notification.permission === 'default') Notification.requestPermission();
  } catch (_) { /* bỏ qua */ }
}
