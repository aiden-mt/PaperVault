// Đăng ký lịch qua link .ics (Google Calendar: "Địa chỉ bí mật ở định dạng iCal", Outlook, lịch hội nghị…).
// Sự kiện chỉ đọc, hiện cùng kế hoạch trong Lịch với màu riêng của từng lịch. Cửa sổ chính tải lại mỗi 30 phút
// (máy chủ của app tải hộ link để tránh lỗi CORS); các khung khác đọc bản đã lưu trong kv "calendarFeedCache".
import { api } from './api.js';
import { parseIcs } from './ics.js';
import { setFeedData, ymd, addDays } from './calendar.js';
import { uid } from './util.js';

const SYNC_MS = 30 * 60e3;
const RETRY_MS = 5 * 60e3;
export const FEED_COLORS = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#0891b2', '#9333ea', '#ca8a04'];

let feeds = [];
let cache = {}; // feedId -> events[]
let loaded = null;
const subs = new Set();
export const onFeedsChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => { for (const fn of [...subs]) { try { fn(); } catch (e) { console.error(e); } } };

export const allFeeds = () => feeds;
export const feedById = (id) => feeds.find((f) => f.id === id) || null;

function publish() {
  const on = feeds.filter((f) => f.on !== false);
  setFeedData(on.map((f) => [`feed:${f.id}`, f.name || 'Lịch đăng ký', f.color || FEED_COLORS[0]]), on.flatMap((f) => cache[f.id] || []));
  emit();
}

export async function loadFeeds(force = false) {
  if (loaded && !force) return loaded;
  loaded = (async () => {
    const [f, c] = await Promise.all([api.kvGet('calendarFeeds').catch(() => null), api.kvGet('calendarFeedCache').catch(() => null)]);
    feeds = Array.isArray(f) ? f : [];
    cache = c && typeof c === 'object' ? c : {};
    publish();
    return feeds;
  })();
  return loaded;
}

const saveFeeds = () => api.kvSet('calendarFeeds', feeds);
const safeId = (s) => String(s).replace(/[^\w.-]+/g, '_').slice(0, 80);

/** Văn bản .ics -> sự kiện của lịch f (bỏ sự kiện đã qua hơn ~1 năm cho nhẹ). */
export function feedEventsFrom(text, f) {
  const { events } = parseIcs(text);
  const cutoff = ymd(addDays(new Date(), -400));
  const seen = new Set();
  return events
    .filter((e) => (e.repeat && e.repeat !== 'none' ? !e.until || e.until >= cutoff : e.date >= cutoff))
    .slice(0, 5000)
    .map((e, i) => {
      let id = `fd_${f.id}_${safeId(e.icsUid || i)}_${e.date}`;
      if (seen.has(id)) id += `_${i}`;
      seen.add(id);
      return { ...e, id, feed: f.id, cat: `feed:${f.id}`, remind: f.remind ? e.remind : '' };
    });
}

/** Tải lại một lịch. Lỗi thì giữ bản cũ và ghi lỗi để hiện trong hộp thoại quản lý. */
export async function syncFeed(f) {
  f.lastTry = new Date().toISOString();
  try {
    const { text } = await api.icsFetch(f.url);
    cache[f.id] = feedEventsFrom(text, f);
    f.count = cache[f.id].length;
    f.lastSync = f.lastTry;
    f.error = '';
  } catch (e) {
    f.error = e.message || String(e);
  }
  await Promise.all([saveFeeds(), api.kvSet('calendarFeedCache', cache)]).catch(() => {});
  publish();
  return f;
}

/** Tải lại các lịch đã quá 30 phút (lỗi thì thử lại sau 5 phút). */
export async function syncDue({ force = false } = {}) {
  await loadFeeds();
  const now = Date.now();
  for (const f of feeds) {
    if (f.on === false) continue;
    const stale = !f.lastSync || now - Date.parse(f.lastSync) > SYNC_MS;
    const cool = !f.lastTry || now - Date.parse(f.lastTry) > RETRY_MS;
    if (force || (stale && cool)) await syncFeed(f);
  }
}

export async function addFeed({ name, url, color }) {
  await loadFeeds();
  const f = { id: uid('cf'), name: name || 'Lịch đăng ký', url, color: color || FEED_COLORS[feeds.length % FEED_COLORS.length], on: true, addedAt: new Date().toISOString() };
  feeds.push(f);
  await syncFeed(f);
  return f;
}

export async function updateFeed(id, patch) {
  await loadFeeds();
  const f = feedById(id);
  if (!f) return null;
  const urlChanged = patch.url && patch.url !== f.url;
  Object.assign(f, patch);
  if (urlChanged || 'remind' in patch) return syncFeed(f);
  await saveFeeds();
  publish();
  return f;
}

export async function removeFeed(id) {
  await loadFeeds();
  feeds = feeds.filter((f) => f.id !== id);
  delete cache[id];
  await Promise.all([saveFeeds(), api.kvSet('calendarFeedCache', cache)]);
  publish();
}

/** Chạy khi mở app. primary: cửa sổ chính (không phải khung chia đôi) mới tự tải lại theo giờ. */
export function startFeeds({ primary = true } = {}) {
  loadFeeds().then(() => { if (primary && feeds.length) setTimeout(() => syncDue(), 4000); }).catch(() => {});
  if (primary) setInterval(() => { if (feeds.length) syncDue(); }, RETRY_MS);
  window.addEventListener('pv:synced', (e) => { if ((e.detail?.kinds || []).includes('kv')) loadFeeds(true); });
}
