// Âm lịch Việt Nam và ngày lễ, tính ngay trong app (không cần mạng): đổi dương → âm theo thuật toán của Hồ Ngọc Đức
// (thiên văn, múi giờ +7, có tháng nhuận), tên can chi của năm / tháng / ngày, và danh sách ngày lễ, ngày kỷ niệm.
const INT = Math.floor;
const TZ = 7;

function jdFromDate(dd, mm, yy) {
  const a = INT((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
  if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
  return jd;
}

/** Thời điểm sóc (trăng mới) thứ k tính từ 1/1/1900, theo ngày Julius. */
function newMoon(k) {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = Math.PI / 180;
  let jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 -= 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  const deltat = T < -11
    ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
    : -0.000278 + 0.000265 * T + 0.000262 * T2;
  return jd1 + C1 - deltat;
}

/** Kinh độ mặt trời (radian, 0..2π) tại ngày Julius jdn. */
function sunLongitude(jdn) {
  const T = (jdn - 2451545.0) / 36525;
  const T2 = T * T;
  const dr = Math.PI / 180;
  const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr;
  L -= Math.PI * 2 * INT(L / (Math.PI * 2));
  return L;
}

const sunSector = (dayNumber) => INT((sunLongitude(dayNumber - 0.5 - TZ / 24) / Math.PI) * 6);
const newMoonDay = (k) => INT(newMoon(k) + 0.5 + TZ / 24);

/** Ngày bắt đầu tháng 11 âm (tháng chứa đông chí) của năm yy. */
function lunarMonth11(yy) {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = INT(off / 29.530588853);
  const nm = newMoonDay(k);
  return sunSector(nm) >= 9 ? newMoonDay(k - 1) : nm;
}

/** Vị trí tháng nhuận (tính từ tháng 11 âm) trong năm âm có 13 tháng. */
function leapMonthOffset(a11) {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last;
  let i = 1;
  let arc = sunSector(newMoonDay(k + i));
  do {
    last = arc;
    i += 1;
    arc = sunSector(newMoonDay(k + i));
  } while (arc !== last && i < 14);
  return i - 1;
}

const cache = new Map();
/** Dương lịch → âm lịch: { day, month, year, leap, jd }. */
export function solarToLunar(dd, mm, yy) {
  const key = `${yy}-${mm}-${dd}`;
  if (cache.has(key)) return cache.get(key);
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = INT((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = newMoonDay(k + 1);
  if (monthStart > dayNumber) monthStart = newMoonDay(k);
  let a11 = lunarMonth11(yy);
  let b11 = a11;
  let year;
  if (a11 >= monthStart) {
    year = yy;
    a11 = lunarMonth11(yy - 1);
  } else {
    year = yy + 1;
    b11 = lunarMonth11(yy + 1);
  }
  const day = dayNumber - monthStart + 1;
  const diff = INT((monthStart - a11) / 29);
  let leap = false;
  let month = diff + 11;
  if (b11 - a11 > 365) {
    const leapDiff = leapMonthOffset(a11);
    if (diff >= leapDiff) {
      month = diff + 10;
      if (diff === leapDiff) leap = true;
    }
  }
  if (month > 12) month -= 12;
  if (month >= 11 && diff < 4) year -= 1;
  const out = { day, month, year, leap, jd: dayNumber };
  if (cache.size > 4000) cache.clear();
  cache.set(key, out);
  return out;
}
/** Âm lịch của một ngày 'YYYY-MM-DD'. */
export const lunarOf = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); return solarToLunar(d, m, y); };

/* ---------- can chi ---------- */
const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
const CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
const ANIMAL = ['Chuột', 'Trâu', 'Hổ', 'Mèo', 'Rồng', 'Rắn', 'Ngựa', 'Dê', 'Khỉ', 'Gà', 'Chó', 'Lợn'];
const ANIMAL_ICON = ['🐭', '🐃', '🐯', '🐱', '🐲', '🐍', '🐴', '🐐', '🐵', '🐔', '🐶', '🐷'];

/** Tên năm âm lịch, ví dụ 2024 → "Giáp Thìn". */
export const yearName = (lunarYear) => `${CAN[(lunarYear + 6) % 10]} ${CHI[(lunarYear + 8) % 12]}`;
/** Con giáp của năm âm: { name: 'Rồng', icon: '🐲' }. */
export const yearAnimal = (lunarYear) => ({ name: ANIMAL[(lunarYear + 8) % 12], icon: ANIMAL_ICON[(lunarYear + 8) % 12] });
export const monthName = (lunarMonth, lunarYear) => `${CAN[(lunarYear * 12 + lunarMonth + 3) % 10]} ${CHI[(lunarMonth + 1) % 12]}`;
export const dayName = (jd) => `${CAN[(jd + 9) % 10]} ${CHI[(jd + 1) % 12]}`;
const MONTH_LABEL = ['', 'Giêng', 'Hai', 'Ba', 'Tư', 'Năm', 'Sáu', 'Bảy', 'Tám', 'Chín', 'Mười', 'Một', 'Chạp'];
/** "tháng Chín", "tháng Giêng", "tháng Hai nhuận". */
export const monthLabel = (l) => `tháng ${MONTH_LABEL[l.month]}${l.leap ? ' nhuận' : ''}`;

/* ---------- ngày lễ ---------- */
// [tháng-ngày, tên, nghỉ?]. Dương lịch.
const SOLAR = [
  ['01-01', 'Tết Dương lịch', true],
  ['02-03', 'Thành lập Đảng Cộng sản Việt Nam'],
  ['02-14', 'Lễ Tình nhân'],
  ['02-27', 'Thầy thuốc Việt Nam'],
  ['03-08', 'Quốc tế Phụ nữ'],
  ['03-26', 'Thành lập Đoàn TNCS Hồ Chí Minh'],
  ['04-30', 'Giải phóng miền Nam', true],
  ['05-01', 'Quốc tế Lao động', true],
  ['05-19', 'Sinh nhật Bác Hồ'],
  ['06-01', 'Quốc tế Thiếu nhi'],
  ['06-28', 'Ngày Gia đình Việt Nam'],
  ['07-27', 'Thương binh Liệt sĩ'],
  ['08-19', 'Cách mạng tháng Tám'],
  ['09-02', 'Quốc khánh', true],
  ['10-10', 'Giải phóng Thủ đô'],
  ['10-20', 'Phụ nữ Việt Nam'],
  ['11-20', 'Nhà giáo Việt Nam'],
  ['12-22', 'Quân đội Nhân dân Việt Nam'],
  ['12-24', 'Đêm Giáng sinh'],
  ['12-25', 'Giáng sinh'],
];
// [tháng-ngày âm, tên, nghỉ?]. Không áp cho tháng nhuận.
const LUNAR = [
  ['1-1', 'Tết Nguyên đán', true],
  ['1-2', 'Mùng 2 Tết', true],
  ['1-3', 'Mùng 3 Tết', true],
  ['1-15', 'Rằm tháng Giêng'],
  ['3-3', 'Tết Hàn thực'],
  ['3-10', 'Giỗ Tổ Hùng Vương', true],
  ['4-15', 'Lễ Phật đản'],
  ['5-5', 'Tết Đoan ngọ'],
  ['7-15', 'Vu Lan'],
  ['8-15', 'Tết Trung thu'],
  ['12-23', 'Ông Công ông Táo'],
];

const pad = (n) => String(n).padStart(2, '0');
const nextDay = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); const x = new Date(y, m - 1, d + 1); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };

/** Ngày lễ / kỷ niệm của một ngày: [{ name, off (nghỉ lễ), lunar (theo âm lịch) }]. */
export function holidaysOf(ymd) {
  const out = [];
  const md = ymd.slice(5);
  for (const [k, name, off] of SOLAR) if (k === md) out.push({ name, off: !!off, lunar: false });
  const l = lunarOf(ymd);
  if (!l.leap) for (const [k, name, off] of LUNAR) if (k === `${l.month}-${l.day}`) out.push({ name, off: !!off, lunar: true });
  // Giao thừa: ngày cuối tháng Chạp (29 hoặc 30 Tết, hôm sau là mùng 1 Tết).
  if (l.month === 12 && !l.leap && l.day >= 29) { const n = lunarOf(nextDay(ymd)); if (n.month === 1 && n.day === 1) out.push({ name: `Giao thừa (${l.day} Tết)`, off: true, lunar: true }); }
  return out;
}

/** Nhãn ngắn hiện trong ô lịch: "15" hoặc "1/9" (ngày đầu tháng âm), kèm "N" nếu tháng nhuận. */
export const lunarShort = (l) => (l.day === 1 ? `${l.day}/${l.month}${l.leap ? 'N' : ''}` : String(l.day));
