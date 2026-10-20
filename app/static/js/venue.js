// Hiển thị loại venue (hội nghị / workshop / tạp chí / chương sách...) và hạng (CORE A*..C, SJR Q1..Q4).
import { escapeHtml } from './util.js';

export const VENUE_TYPES = {
  conference: 'Hội nghị',
  workshop: 'Workshop',
  findings: 'Findings',
  journal: 'Tạp chí',
  'book-chapter': 'Chương sách',
  'book-series': 'Book series',
  book: 'Sách',
  preprint: 'Preprint',
  thesis: 'Luận văn',
  other: 'Khác',
  unknown: 'Chưa rõ',
};

export const RANK_FILTERS = [
  ['A*', 'CORE A*'], ['A', 'CORE A'], ['B', 'CORE B'], ['C', 'CORE C'],
  ['Q1', 'SJR Q1'], ['Q2', 'SJR Q2'], ['Q3', 'SJR Q3'], ['Q4', 'SJR Q4'],
  ['none', 'Chưa có hạng'],
];

const RANK_ORDER = { 'A*': 0, A: 1, B: 2, C: 3, 'Australasian A': 4, 'Australasian B': 5, 'Australasian C': 6 };
const Q_ORDER = { Q1: 0, Q2: 1, Q3: 2, Q4: 3 };

/** Hạng chính của một paper: 'A*' | 'A' | ... | 'Q1' | ... | '' (workshop/findings không tính hạng riêng). */
export function primaryRank(vi) {
  if (!vi) return '';
  if (vi.rank && !vi.parent) return vi.rank;
  if (vi.quartile) return vi.quartile;
  return '';
}

export function rankSortKey(p) {
  const vi = p?.venueInfo;
  if (!vi) return 99;
  const r = primaryRank(vi);
  if (r in RANK_ORDER) return RANK_ORDER[r];
  if (r in Q_ORDER) return 10 + Q_ORDER[r];
  if (vi.parent?.rank in RANK_ORDER) return 20 + RANK_ORDER[vi.parent.rank];
  return 50;
}

export function matchesRankFilter(p, f) {
  if (!f) return true;
  const r = primaryRank(p.venueInfo);
  if (f === 'none') return !r || !(r in RANK_ORDER || r in Q_ORDER);
  return r === f;
}

function rankClass(r) {
  if (r === 'A*') return 'rk-astar';
  if (r === 'A' || r === 'Q1') return 'rk-a';
  if (r === 'B' || r === 'Q2') return 'rk-b';
  if (r === 'C' || r === 'Q3') return 'rk-c';
  if (r === 'Q4') return 'rk-d';
  return 'rk-other';
}

/** Tên ngắn gọn để hiện trên badge. */
export function venueShortName(vi) {
  if (!vi) return '';
  if (vi.acronym) return vi.acronym;
  if (vi.parent?.acronym) return vi.parent.acronym;
  const n = vi.name || '';
  return n.length > 42 ? `${n.slice(0, 40)}…` : n;
}

function tooltip(vi) {
  const lines = [`${VENUE_TYPES[vi.type] || vi.type}${vi.name ? `: ${vi.name}` : ''}`];
  if (vi.rank && !vi.parent) lines.push(`Hạng ${vi.system || 'CORE'}: ${vi.rank}`);
  if (vi.parent) lines.push(`Hội nghị chủ ${vi.parent.acronym} xếp hạng ${vi.parent.rank} (${vi.parent.system})`);
  if (vi.quartile) lines.push(`${vi.system || 'SJR'}: ${vi.quartile}${vi.sjr != null ? ` · SJR ${vi.sjr}` : ''}${vi.hIndex != null ? ` · H-index ${vi.hIndex}` : ''}`);
  if (vi.note) lines.push(vi.note);
  if (vi.manual) lines.push('(bạn đã sửa tay)');
  return lines.join('\n');
}

/** Badge gọn cho card/bảng: "Hội nghị · CVPR · A*". */
export function venueBadge(vi, { compact = false } = {}) {
  if (!vi || vi.type === 'unknown') return '';
  const type = VENUE_TYPES[vi.type] || vi.type;
  const name = venueShortName(vi);
  const r = primaryRank(vi);
  const parentRank = !r && vi.parent?.rank ? vi.parent.rank : '';
  const rankHtml = r
    ? `<b class="rk ${rankClass(r)}">${escapeHtml(r)}</b>`
    : (parentRank ? `<b class="rk rk-parent" title="Hạng của hội nghị chủ">${escapeHtml(vi.parent.acronym)} ${escapeHtml(parentRank)}</b>` : '');
  return `<span class="badge venue v-${escapeHtml(vi.type)}" title="${escapeHtml(tooltip(vi))}">${compact ? '' : `<i>${escapeHtml(type)}</i>`}${name && !(vi.parent && name === vi.parent.acronym && parentRank) ? `<span>${escapeHtml(name)}</span>` : ''}${rankHtml}</span>`;
}

/** Khối chi tiết trong trang paper. */
export function venueDetailHtml(vi) {
  if (!vi || vi.type === 'unknown') return '<span class="hint">Chưa nhận diện được venue. Điền trường Venue ở tab Chỉnh sửa hoặc bấm "Sửa venue".</span>';
  const rows = [];
  rows.push(['Loại', VENUE_TYPES[vi.type] || vi.type]);
  if (vi.name) rows.push(['Tên', `${vi.name}${vi.acronym ? ` (${vi.acronym})` : ''}`]);
  const r = primaryRank(vi);
  if (vi.rank && !vi.parent) rows.push(['Hạng hội nghị', `${vi.rank} · ${vi.system || 'CORE'}`]);
  if (vi.parent) rows.push(['Hội nghị chủ', `${vi.parent.name} (${vi.parent.acronym}) · ${vi.parent.rank} · ${vi.parent.system}`]);
  if (vi.quartile || vi.sjr != null) rows.push(['Tạp chí / ấn phẩm', `${vi.quartile || 'chưa có quartile'}${vi.sjr != null ? ` · SJR ${vi.sjr}` : ''}${vi.hIndex != null ? ` · H-index ${vi.hIndex}` : ''} · ${vi.system || 'SJR'}`]);
  if (vi.publisher) rows.push(['Nhà xuất bản', vi.publisher]);
  if (vi.categories) rows.push(['Lĩnh vực (SJR)', vi.categories]);
  if (vi.note) rows.push(['Ghi chú', vi.note]);
  rows.push(['Nguồn nhận diện', vi.manual ? 'bạn sửa tay' : ({ core: 'khớp bảng CORE', 'sjr-issn': 'khớp ISSN trong SJR', 'sjr-title': 'khớp tên trong SJR', 'sjr-abbr': 'khớp tên viết tắt', 'sjr-fuzzy': 'khớp gần đúng tên trong SJR', hint: 'suy từ Semantic Scholar / Crossref', regex: 'suy từ tên venue', arxiv: 'chỉ có trên arXiv' }[vi.matchedBy] || vi.matchedBy || '—')]);
  return `<div class="venue-detail">${venueBadge(vi)}${r ? '' : ''}<table class="kv">${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</table></div>`;
}
