// Lặp lại ngắt quãng (SM-2, kiểu Anki) cho thẻ ghi nhớ: mỗi đoạn ghi chú (annotation) có a.srs =
// { due: 'YYYY-MM-DD', interval (ngày), ease, reps, lapses, firstAt, lastAt }. Chưa có srs = thẻ mới.
// Bản cũ chỉ có a.known (đã nhớ): coi như thẻ đã thuộc, khoảng ôn 21 ngày tính từ lúc đánh dấu.
// Nhịp ôn chỉnh được trong trang Thẻ ghi nhớ (⚙ Nhịp ôn), lưu ở settings.srs.
import { localDate } from './notebook.js';
import { store } from './store.js';

/** Nhịp ôn mặc định: thẻ mới mỗi ngày, khoảng lần đầu khi chấm Nhớ / Dễ, hệ số giãn ban đầu, khoảng tối đa (ngày). */
export const SRS_DEFAULTS = { newPerDay: 20, goodFirst: 1, easyFirst: 4, startEase: 2.5, maxInterval: 365 };
export const srsConfig = (settings = store.settings) => {
  const c = { ...SRS_DEFAULTS, ...(settings?.srs || {}) };
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  return {
    newPerDay: Math.round(num(c.newPerDay, 0, 500, 20)),
    goodFirst: Math.round(num(c.goodFirst, 1, 30, 1)),
    easyFirst: Math.round(num(c.easyFirst, 1, 60, 4)),
    startEase: num(c.startEase, 1.3, 4, 2.5),
    maxInterval: Math.round(num(c.maxInterval, 7, 3650, 365)),
  };
};
export const NEW_PER_DAY = SRS_DEFAULTS.newPerDay; // giữ cho mã cũ; số thực dùng là srsConfig().newPerDay
export const GRADES = [
  // [điểm, nhãn, phím, lớp CSS]
  [0, 'Quên', '1', 'again'],
  [1, 'Khó', '2', 'hard'],
  [2, 'Nhớ', '3', 'good'],
  [3, 'Dễ', '4', 'easy'],
];

const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return localDate(new Date(y, m - 1, d + n)); };
const ymdTime = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1).getTime(); };
export const daysBetween = (a, b) => Math.round((ymdTime(b) - ymdTime(a)) / 864e5);

/** Thẻ chưa tới hạn (ôn sớm, ví dụ khi lướt "Tất cả thẻ"). */
export const isEarly = (s, today = localDate()) => !!s?.due && s.due > today;

/** Trạng thái ôn của một thẻ; null = thẻ mới chưa ôn lần nào. */
export function srsOf(a) {
  if (a?.srs?.due) return a.srs;
  if (a?.known) {
    const at = localDate(new Date(Date.parse(a.knownAt || a.at || '') || Date.now()));
    return { due: addDays(at, 21), interval: 21, ease: 2.5, reps: 3, lapses: 0, firstAt: at, lastAt: at };
  }
  return null;
}

/**
 * Lịch ôn tiếp theo sau khi chấm điểm (0 Quên, 1 Khó, 2 Nhớ, 3 Dễ).
 * Thẻ chưa tới hạn mà chấm Khó / Nhớ / Dễ thì giữ nguyên lịch (trả về kèm early: true): ôn sớm không làm giãn khoảng,
 * nên bấm lại nhiều lần cũng không đẩy lịch ôn đi xa. Chấm Quên thì luôn tính lại từ đầu.
 */
export function schedule(prev, grade, today = localDate(), cfg = srsConfig()) {
  if (prev && grade > 0 && isEarly(prev, today)) return { ...prev, early: true };
  const s = { interval: 0, ease: cfg.startEase, reps: 0, lapses: 0, ...(prev || {}) };
  delete s.early;
  let { interval, ease, reps, lapses } = s;
  if (grade === 0) {
    lapses += 1; reps = 0; interval = 0; ease = Math.max(1.3, ease - 0.2);
  } else {
    // Khó: thẻ mới thì ôn lại ngay trong lượt (khác Quên ở chỗ không tính là quên), thẻ cũ giãn chậm.
    if (grade === 1) {
      if (reps === 0) interval = 0;
      else { interval = Math.max(interval + 1, Math.round(interval * 1.2)); ease = Math.max(1.3, ease - 0.15); }
    }
    if (grade === 2) interval = reps === 0 ? cfg.goodFirst : reps === 1 ? Math.max(cfg.goodFirst + 1, cfg.goodFirst * 3) : Math.max(interval + 1, Math.round(interval * ease));
    if (grade === 3) { interval = reps === 0 ? cfg.easyFirst : Math.max(interval + 2, Math.round(interval * ease * 1.3)); ease = Math.min(ease + 0.15, 4); }
    if (interval > 0) reps += 1;
  }
  interval = Math.min(interval, cfg.maxInterval);
  return { due: addDays(today, interval), interval, ease: Math.round(ease * 100) / 100, reps, lapses, firstAt: s.firstAt || today, lastAt: today };
}

/**
 * Sửa lịch ôn bất hợp lý (bản cũ cho chấm lại một thẻ nhiều lần nên khoảng ôn bị nhân lên tới 10 năm) và áp khoảng tối đa
 * mới khi người dùng hạ nó. Khoảng hợp lệ không thể dài hơn khoảng 3,5 lần số ngày đã học thẻ (cộng khoảng Dễ lần đầu).
 * Trả về srs đã sửa, hoặc null nếu không cần sửa.
 */
export function repairSrs(a, cfg = srsConfig()) {
  const s = a?.srs;
  if (!s?.due || !s.lastAt) return null;
  const studied = Math.max(0, daysBetween(s.firstAt || s.lastAt, s.lastAt));
  const cap = Math.min(cfg.maxInterval, Math.max(cfg.easyFirst, Math.ceil(studied * 3.5) + cfg.easyFirst));
  const dueGap = daysBetween(s.lastAt, s.due);
  if (s.interval <= cap && dueGap <= cap) return null;
  const interval = Math.min(s.interval, cap);
  return { ...s, interval, due: addDays(s.lastAt, interval), ease: Math.min(s.ease || cfg.startEase, cfg.startEase + 0.3), reps: Math.min(s.reps || 0, 2 + Math.floor(studied / 7)) };
}

/** Khoảng cách hiện trên nút chấm điểm: "hôm nay", "1 ngày", "3 tuần", "2 tháng"… */
export function fmtInterval(days) {
  if (days <= 0) return 'ôn lại ngay';
  if (days < 14) return `${days} ngày`;
  if (days < 60) return `${Math.round(days / 7)} tuần`;
  if (days < 365) return `${Math.round(days / 30)} tháng`;
  return `${(days / 365).toFixed(1).replace('.', ',')} năm`;
}

/** Mọi thẻ (đoạn ghi chú có đoạn gốc) của thư viện: [{ p, a }]. */
export function allCards(papers) {
  const out = [];
  for (const p of papers || []) {
    if (p.deletedAt || p.deleted) continue;
    for (const a of p.annotations || []) if (a && a.quote) out.push({ p, a });
  }
  return out;
}

/**
 * Thẻ cần ôn hôm nay: thẻ tới hạn (cũ trước) + thẻ mới, mỗi ngày tối đa NEW_PER_DAY thẻ mới
 * (trừ số thẻ mới đã bắt đầu học hôm nay).
 */
export function dueCards(cards, today = localDate()) {
  const due = [];
  const fresh = [];
  let startedToday = 0;
  for (const c of cards) {
    const s = srsOf(c.a);
    if (!s) fresh.push(c);
    else {
      if (s.firstAt === today && c.a.srs) startedToday += 1;
      if (s.due <= today) due.push(c);
    }
  }
  due.sort((x, y) => srsOf(x.a).due.localeCompare(srsOf(y.a).due));
  fresh.sort((x, y) => (Date.parse(x.a.at || '') || 0) - (Date.parse(y.a.at || '') || 0));
  return [...due, ...fresh.slice(0, Math.max(0, srsConfig().newPerDay - startedToday))];
}

/** Số liệu cho Tổng quan / Lịch. */
export function srsStats(papers, today = localDate()) {
  const cards = allCards(papers);
  const list = dueCards(cards, today);
  const fresh = list.filter((c) => !srsOf(c.a)).length;
  return { total: cards.length, due: list.length, review: list.length - fresh, fresh, learned: cards.filter((c) => (srsOf(c.a)?.interval || 0) >= 21).length };
}
