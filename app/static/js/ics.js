// Xuất / nhập lịch dạng iCalendar (.ics, RFC 5545) để trao đổi với Google Calendar, Outlook, Apple Calendar.
// Kế hoạch có giờ ghi theo giờ UTC; kế hoạch cả ngày ghi dạng ngày. Hỗ trợ lặp hằng ngày / tuần / tháng (UNTIL, COUNT,
// EXDATE) và nhắc việc (VALARM). Lặp phức tạp hơn (cách 2 tuần, theo thứ…) chỉ nhập lần đầu, kèm ghi chú.
import { CATS, REMINDS, ALLDAY_REMIND_AT, hasRemind, parseYmd, ymd, addDays } from './calendar.js';

const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const unesc = (s) => String(s ?? '').replace(/\\n/gi, '\n').replace(/\\([\\;,])/g, '$1');
const utcStamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const dateVal = (s) => s.replace(/-/g, '');
const at = (date, hhmm) => { const d = parseYmd(date); const [h, m] = String(hhmm).split(':').map(Number); d.setHours(h || 0, m || 0, 0, 0); return d; };

/** Gấp dòng dài hơn 75 byte (UTF-8) theo chuẩn: dòng tiếp theo bắt đầu bằng một dấu cách. */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let n = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** events (mảng kế hoạch của Lịch) -> nội dung file .ics. */
export function eventsToIcs(events, { name = 'PaperVault' } = {}) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PaperVault//Lich ke hoach//VI', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`];
  const stamp = utcStamp(new Date());
  for (const e of events) {
    if (!e?.date || !e.title) continue;
    const allDay = !e.start;
    const rep = e.repeat && e.repeat !== 'none' ? e.repeat : '';
    L.push('BEGIN:VEVENT', `UID:${e.icsUid || `${e.id}@papervault`}`, `DTSTAMP:${stamp}`);
    if (allDay) {
      L.push(`DTSTART;VALUE=DATE:${dateVal(e.date)}`, `DTEND;VALUE=DATE:${dateVal(ymd(addDays(parseYmd(e.date), 1)))}`);
    } else {
      const s = at(e.date, e.start);
      let end = e.end ? at(e.date, e.end) : new Date(s.getTime() + 3600e3);
      if (end <= s) end = new Date(s.getTime() + 3600e3);
      L.push(`DTSTART:${utcStamp(s)}`, `DTEND:${utcStamp(end)}`);
    }
    L.push(`SUMMARY:${esc(e.title)}`);
    if (e.notes) L.push(`DESCRIPTION:${esc(e.notes)}`);
    const cat = CATS.find((c) => c[0] === (e.cat || 'other'));
    if (cat) L.push(`CATEGORIES:${esc(cat[1])}`);
    if (rep) {
      const freq = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' }[rep];
      const until = e.until ? (allDay ? dateVal(e.until) : utcStamp(at(e.until, '23:59'))) : '';
      L.push(`RRULE:FREQ=${freq}${until ? `;UNTIL=${until}` : ''}`);
      for (const d of e.skip || []) L.push(allDay ? `EXDATE;VALUE=DATE:${dateVal(d)}` : `EXDATE:${utcStamp(at(d, e.start))}`);
    } else if (e.done) L.push('STATUS:CONFIRMED', 'X-PAPERVAULT-DONE:1');
    if (hasRemind(e)) {
      // Cả ngày: nhắc lúc 8:00 trừ số phút; có giờ: trước giờ bắt đầu.
      const before = Number(e.remind) - (allDay ? Number(ALLDAY_REMIND_AT.split(':')[0]) * 60 : 0);
      const trig = before >= 0 ? `-PT${before}M` : `PT${-before}M`;
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, `TRIGGER:${trig}`, 'END:VALARM');
    }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return `${L.map(fold).join('\r\n')}\r\n`;
}

/* ---------------------------------------------------------------- đọc .ics */

function parseLine(line) {
  // NAME;PARAM=a;PARAM="x:y":VALUE — dấu ':' trong ngoặc kép không phải dấu tách.
  let q = false;
  let i = 0;
  for (; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === ':' && !q) break; }
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [name, ...ps] = head.split(';');
  const params = {};
  for (const p of ps) { const k = p.indexOf('='); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, ''); }
  return { name: name.toUpperCase(), params, value };
}

/** Giờ ở múi giờ tz (tên IANA) -> Date; tên múi giờ lạ (ví dụ của Outlook) thì coi như giờ máy. */
function zoned(y, mo, d, h, mi, s, tz) {
  const local = new Date(y, mo - 1, d, h, mi, s);
  if (!tz) return local;
  try {
    const guess = Date.UTC(y, mo - 1, d, h, mi, s);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess));
    const g = (t) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
    return new Date(guess - (asUtc - guess));
  } catch (_) { return local; }
}

/** Giá trị ngày / giờ -> { date: 'YYYY-MM-DD', time: 'HH:MM' | '' } theo giờ máy. */
function readDate(prop) {
  if (!prop) return null;
  const v = prop.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined || prop.params.VALUE === 'DATE') return { date: `${y}-${mo}-${d}`, time: '' };
  const dt = z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0))) : zoned(+y, +mo, +d, +h, +mi, +(s || 0), prop.params.TZID);
  return { date: ymd(dt), time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}` };
}

/** "-PT15M", "-P1D", "-PT1H30M", "PT8H"… -> số phút (dương = trước giờ bắt đầu). */
function triggerMinutes(v) {
  const m = /^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
  if (!m) return null;
  const mins = (+(m[2] || 0)) * 10080 + (+(m[3] || 0)) * 1440 + (+(m[4] || 0)) * 60 + (+(m[5] || 0));
  return m[1] === '-' ? mins : -mins;
}
const nearestRemind = (mins) => {
  const opts = REMINDS.filter(([k]) => k !== '').map(([k]) => Number(k));
  return String(opts.reduce((a, b) => (Math.abs(b - mins) < Math.abs(a - mins) ? b : a), opts[0]));
};

/** Nội dung .ics -> { events: [kế hoạch], skipped: số mục bỏ qua }. Mỗi kế hoạch có icsUid để nhập lại không bị trùng. */
export function parseIcs(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let skipped = 0;
  let cur = null;
  let alarm = null;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const p = parseLine(raw);
    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VEVENT') { cur = { props: {}, ex: [], alarms: [] }; continue; }
    if (!cur) continue;
    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VALARM') { alarm = {}; continue; }
    if (p.name === 'END' && p.value.toUpperCase() === 'VALARM') { if (alarm) cur.alarms.push(alarm); alarm = null; continue; }
    if (alarm) { alarm[p.name] = p; continue; }
    if (p.name === 'END' && p.value.toUpperCase() === 'VEVENT') {
      const ev = toEvent(cur);
      if (ev) events.push(ev); else skipped++;
      cur = null;
      continue;
    }
    if (p.name === 'EXDATE') cur.ex.push(p);
    else cur.props[p.name] = p;
  }
  return { events, skipped };
}

function toEvent(c) {
  const P = c.props;
  if (P['RECURRENCE-ID']) return null; // một lần lặp đã sửa riêng: không hỗ trợ
  if ((P.STATUS?.value || '').toUpperCase() === 'CANCELLED') return null;
  const s = readDate(P.DTSTART);
  if (!s) return null;
  const title = unesc(P.SUMMARY?.value || '').trim() || '(không tên)';
  const notes = [];
  if (P.DESCRIPTION) notes.push(unesc(P.DESCRIPTION.value).trim());
  if (P.LOCATION?.value) notes.push(`Địa điểm: ${unesc(P.LOCATION.value)}`);
  const ev = { title, date: s.date, start: s.time, end: '', cat: 'other', repeat: 'none', icsUid: P.UID?.value || '' };
  const e = readDate(P.DTEND);
  if (s.time && e?.time && e.date === s.date && e.time > s.time) ev.end = e.time;
  else if (s.time && P.DURATION) {
    const mins = -triggerMinutes(P.DURATION.value);
    if (mins > 0) { const d = at(s.date, s.time); d.setMinutes(d.getMinutes() + mins); if (ymd(d) === s.date) ev.end = `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  }
  const catTxt = unesc(P.CATEGORIES?.value || '').split(',')[0].trim().toLowerCase();
  const cat = CATS.find(([k, l]) => l.toLowerCase() === catTxt || k === catTxt);
  if (cat) ev.cat = cat[0];
  else if (/deadline|hạn/i.test(title)) ev.cat = 'deadline';
  else if (/họp|meeting|meet|seminar/i.test(title)) ev.cat = 'meet';
  if (P.RRULE) {
    const r = Object.fromEntries(P.RRULE.value.split(';').map((x) => x.split('=')).map(([k, v]) => [String(k).toUpperCase(), v]));
    const freq = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' }[(r.FREQ || '').toUpperCase()];
    const simple = freq && (!r.INTERVAL || r.INTERVAL === '1') && !r.BYSETPOS && !(r.BYDAY && freq !== 'weekly') && !(r.BYDAY && r.BYDAY.includes(','));
    if (simple) {
      ev.repeat = freq;
      if (r.UNTIL) { const u = readDate({ value: r.UNTIL, params: {} }); if (u) ev.until = u.date; }
      else if (r.COUNT) {
        const n = Math.max(1, Number(r.COUNT) || 1) - 1;
        const d0 = parseYmd(s.date);
        ev.until = ymd(freq === 'monthly' ? new Date(d0.getFullYear(), d0.getMonth() + n, d0.getDate()) : addDays(d0, n * (freq === 'daily' ? 1 : 7)));
      }
      const skip = [];
      for (const x of c.ex) for (const v of x.value.split(',')) { const d = readDate({ value: v, params: x.params }); if (d) skip.push(d.date); }
      if (skip.length) ev.skip = skip;
    } else notes.push(`(Lặp lại theo quy tắc ${P.RRULE.value}: PaperVault chỉ nhập lần đầu tiên.)`);
  }
  const trig = c.alarms.map((a) => triggerMinutes(a.TRIGGER?.value)).find((x) => x !== null && x !== undefined);
  if (trig !== undefined) ev.remind = nearestRemind(s.time ? trig : trig + Number(ALLDAY_REMIND_AT.split(':')[0]) * 60);
  if (P['X-PAPERVAULT-DONE']) ev.done = true;
  ev.notes = notes.filter(Boolean).join('\n\n');
  return ev;
}
