// Lịch kế hoạch: sự kiện / việc có ngày (đọc paper, thí nghiệm, viết bài, deadline, họp…), lặp lại hằng ngày / tuần /
// tháng, gắn với paper trong thư viện hoặc trang Sổ tay. Lưu trong kv "calendar" (một mảng), đủ cho dùng cá nhân.
// Lịch còn hiện: trang nhật ký của từng ngày và việc cần làm có hạn "📅 YYYY-MM-DD" trong Sổ tay (xem notebook.js).
import { api } from './api.js';
import { uid } from './util.js';

export const CATS = [
  ['read', 'Đọc paper', '#4f46e5'],
  ['exp', 'Thí nghiệm', '#0d9488'],
  ['write', 'Viết bài', '#d97706'],
  ['deadline', 'Deadline', '#dc2626'],
  ['meet', 'Họp / thảo luận', '#7c3aed'],
  ['other', 'Khác', '#64748b'],
];
// Lịch đăng ký (calfeeds.js) mỗi lịch là một "loại" riêng: ['feed:<id>', tên, màu]. Sự kiện của chúng chỉ đọc, không lưu vào kv "calendar".
const feedCats = new Map();
let feedEvents = [];
export function setFeedData(cats, evs) {
  feedCats.clear();
  for (const c of cats) feedCats.set(c[0], c);
  feedEvents = evs;
  emit();
}
export const feedCatList = () => [...feedCats.values()];
export const isFeedEvent = (e) => !!e?.feed;
export const catOf = (k) => CATS.find((c) => c[0] === k) || feedCats.get(k) || CATS[CATS.length - 1];
export const REPEATS = [['none', 'Không lặp'], ['daily', 'Hằng ngày'], ['weekly', 'Hằng tuần'], ['monthly', 'Hằng tháng']];
// Nhắc việc: số phút trước giờ bắt đầu ('' = không nhắc). Kế hoạch cả ngày (không có giờ) tính từ 8:00 sáng.
export const REMINDS = [['', 'Không nhắc'], ['0', 'Đúng giờ'], ['5', 'Trước 5 phút'], ['10', 'Trước 10 phút'], ['15', 'Trước 15 phút'], ['30', 'Trước 30 phút'], ['60', 'Trước 1 giờ'], ['120', 'Trước 2 giờ'], ['1440', 'Trước 1 ngày']];
export const ALLDAY_REMIND_AT = '08:00';
export const hasRemind = (e) => e?.remind !== undefined && e.remind !== null && e.remind !== '';
/** Thời điểm nhắc (Date) của một lần diễn ra vào ngày date, null nếu không nhắc. */
export function remindAt(e, date) {
  if (!hasRemind(e)) return null;
  const [h, m] = String(e.start || ALLDAY_REMIND_AT).split(':').map(Number);
  const d = parseYmd(date);
  d.setHours(h || 0, m || 0, 0, 0);
  return new Date(d.getTime() - Number(e.remind) * 60000);
}

let events = null;
const subs = new Set();
export const onCalendarChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => { for (const fn of [...subs]) { try { fn(); } catch (e) { console.error(e); } } };

export async function loadEvents(force = false) {
  if (events && !force) return events;
  const v = await api.kvGet('calendar').catch(() => null);
  events = Array.isArray(v) ? v : [];
  return events;
}
/** Mọi sự kiện để hiện: kế hoạch của bạn và sự kiện của các lịch đăng ký đang bật. */
export const allEvents = () => (feedEvents.length ? [...(events || []), ...feedEvents] : events || []);
/** Chỉ kế hoạch của bạn (xuất .ics, quá hạn…). */
export const ownEvents = () => events || [];
async function persist() { await api.kvSet('calendar', events); emit(); }

export async function saveEvent(ev) {
  await loadEvents();
  const e = { repeat: 'none', cat: 'other', ...ev, id: ev.id || uid('ev'), updatedAt: new Date().toISOString() };
  const i = events.findIndex((x) => x.id === e.id);
  if (i >= 0) events[i] = e; else events.push(e);
  await persist();
  return e;
}
/** Lưu nhiều kế hoạch một lượt (nhập .ics). Kế hoạch trùng id thì thay. */
export async function saveEvents(list) {
  await loadEvents();
  const at = new Date().toISOString();
  for (const ev of list) {
    const e = { repeat: 'none', cat: 'other', ...ev, id: ev.id || uid('ev'), updatedAt: at };
    const i = events.findIndex((x) => x.id === e.id);
    if (i >= 0) events[i] = e; else events.push(e);
  }
  await persist();
}
export async function removeEvent(id) {
  await loadEvents();
  events = events.filter((x) => x.id !== id);
  await persist();
}
/** Đánh dấu xong một lần diễn ra (sự kiện lặp: theo từng ngày). */
export async function toggleDone(id, date) {
  await loadEvents();
  const e = events.find((x) => x.id === id);
  if (!e) return;
  if (e.repeat && e.repeat !== 'none') {
    const s = new Set(e.doneDates || []);
    if (s.has(date)) s.delete(date); else s.add(date);
    e.doneDates = [...s];
  } else e.done = !e.done;
  await persist();
}

/* ---------- ngày ---------- */
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/** Thứ Hai đầu tuần chứa d. */
export const weekStart = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); };
export const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
export const fmtDay = (s) => { const d = parseYmd(s); return `${['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`; };

/** Các lần diễn ra trong [from, to] (YYYY-MM-DD): [{ ev, date, done }], sắp theo ngày rồi giờ. */
export function occurrences(from, to) {
  const out = [];
  for (const e of allEvents()) {
    if (!e.date) continue;
    const rep = e.repeat || 'none';
    const until = e.until && e.until < to ? e.until : to;
    if (rep === 'none') {
      if (e.date >= from && e.date <= to) out.push({ ev: e, date: e.date, done: !!e.done });
      continue;
    }
    const start = parseYmd(e.date);
    const end = parseYmd(until);
    const push = (s) => { if (s >= from && !(e.skip || []).includes(s)) out.push({ ev: e, date: s, done: (e.doneDates || []).includes(s) }); };
    if (rep === 'monthly') {
      // giữ đúng ngày trong tháng; tháng không có ngày đó (ví dụ 31/4) thì bỏ qua
      for (let k = 0; k < 1200; k++) {
        const d = new Date(start.getFullYear(), start.getMonth() + k, start.getDate());
        if (d > end) break;
        if (d.getDate() === start.getDate()) push(ymd(d));
      }
    } else {
      const step = rep === 'daily' ? 1 : 7;
      let d = new Date(start);
      const f = parseYmd(from);
      if (d < f) d = addDays(d, Math.floor((f - d) / 864e5 / step) * step); // nhảy tới gần khoảng đang xem
      for (let k = 0; d <= end && k < 2000; k++) { push(ymd(d)); d = addDays(d, step); }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.ev.start || '99').localeCompare(String(b.ev.start || '99')));
}
