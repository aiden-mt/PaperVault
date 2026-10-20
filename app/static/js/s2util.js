// Tiện ích cho danh sách Semantic Scholar dùng chung giữa trang paper, bản tóm tắt "Có gì mới" và trang Theo dõi:
// ngày đăng, tốc độ trích dẫn, phân loại bài dẫn theo cách dùng bài gốc, khoá "đã xem".

/** Mã tra cứu Semantic Scholar của một paper trong thư viện ('' nếu không tra được). */
export const s2Ident = (p) => p.s2Id || (p.arxivId ? `arXiv:${p.arxivId.replace(/v\d+$/, '')}` : (p.doi ? `DOI:${p.doi}` : (p.url ? `URL:${p.url}` : '')));

/** Ngày đăng của bài (publicationDate, không có thì giữa năm), dạng số ms; 0 nếu không rõ. */
export function pubTime(it) {
  const d = it.publicationDate ? Date.parse(it.publicationDate) : NaN;
  if (Number.isFinite(d)) return d;
  return it.year ? Date.UTC(Number(it.year), 6, 1) : 0;
}
export const monthsSince = (it) => { const t = pubTime(it); return t ? Math.max(1, (Date.now() - t) / (30.4 * 864e5)) : 0; };
/** Số trích dẫn mỗi tháng kể từ khi đăng: bài mới mà tăng nhanh là bài đang được chú ý. */
export const citeVelocity = (it) => { const m = monthsSince(it); return m ? (it.citationCount || 0) / m : 0; };
export const fmtPub = (it) => {
  if (it.publicationDate && /^\d{4}-\d{2}/.test(it.publicationDate)) { const [y, m] = it.publicationDate.split('-'); return `tháng ${Number(m)}/${y}`; }
  return it.year ? String(it.year) : '';
};

// Câu trích dẫn cho biết bài kia dùng bài này thế nào. Nhãn intents của Semantic Scholar hay trống với bản preprint,
// nên dò thêm từ khoá trong chính câu trích dẫn. So sánh kết quả xét trước vì câu kiểu "we compare with X, following Y"
// thì cái đáng biết là có so số với nhau.
const ROLE_RESULT = /\b(outperform\w*|surpass\w*|compar(e|es|ed|ing|ison|able)|baselines?|beat|beats|than\b|improv\w* (over|upon)|gains? over|on par with|competitive with|falls? short)\b/i;
const ROLE_METHOD = /\b(follow(s|ing|ed)?|build(s|ing)? (up)?on|built (up)?on|extend(s|ing|ed)?|extension of|based on|adopt(s|ed|ing)?|inspired by|borrow\w*|we (use|employ|leverage|utili[sz]e|apply|reuse)|using the|modif(y|ies|ied)|variant of|initiali[sz]ed? (from|with)|fine-?tun\w* (from|on top of)|same (setting|protocol|architecture|pipeline) as)\b/i;
const ROLE_RESULT_WEAK = /\b(state-of-the-art|sota|benchmark\w*|leaderboard)\b/i;
/** Vai của bài trong danh sách: 'method' | 'result' | 'mention' | 'unknown', kèm lý do để hiện khi rê chuột. */
export function citeRole(it) {
  const intents = it._intents || [];
  if (intents.includes('result')) return { role: 'result', why: 'Semantic Scholar gắn nhãn so sánh kết quả' };
  if (intents.includes('methodology')) return { role: 'method', why: 'Semantic Scholar gắn nhãn dùng phương pháp' };
  const text = (it._contexts || []).join(' ');
  if (!text) return intents.length ? { role: 'mention', why: 'Semantic Scholar gắn nhãn bối cảnh' } : { role: 'unknown', why: 'Không có câu trích dẫn để biết' };
  let m = ROLE_RESULT.exec(text);
  if (m) return { role: 'result', why: `Câu trích dẫn có “${m[0]}”` };
  m = ROLE_METHOD.exec(text);
  if (m) return { role: 'method', why: `Câu trích dẫn có “${m[0]}”` };
  m = ROLE_RESULT_WEAK.exec(text);
  if (m) return { role: 'result', why: `Câu trích dẫn có “${m[0]}”` };
  return { role: 'mention', why: 'Câu trích dẫn chỉ nhắc tới, không nói dùng hay so sánh' };
}
export const ROLE_LABELS = {
  citations: { method: 'Kế thừa phương pháp', result: 'So sánh kết quả', mention: 'Chỉ nhắc tới', unknown: 'Chưa rõ' },
  references: { method: 'Bài này dựa vào', result: 'Bài này so sánh với', mention: 'Chỉ nhắc tới', unknown: 'Chưa rõ' },
};
export const ROLE_HINTS = {
  citations: { method: 'Paper sau dùng hoặc mở rộng cách làm của bài này', result: 'Paper sau lấy bài này làm baseline, thường là chỗ có kết quả mới', mention: 'Chỉ dẫn trong phần tổng quan', unknown: 'Semantic Scholar không có câu trích dẫn' },
  references: { method: 'Bài này dùng hoặc mở rộng cách làm của bài được dẫn', result: 'Bài này lấy bài được dẫn làm baseline để so sánh', mention: 'Chỉ dẫn trong phần tổng quan', unknown: 'Semantic Scholar không có câu trích dẫn' },
};
export const s2Key = (it) => (it.externalIds?.ArXiv ? it.externalIds.ArXiv : `s2:${it.paperId}`);

/* ---------- Câu trích dẫn: ghi rõ câu lấy từ bài nào ---------- */

const escQ = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Nhãn và màu theo chiều trích dẫn: 'main' = câu nằm trong bài gốc (bài gốc viết về bài kia, tím);
 *  'other' = câu nằm trong bài kia (bài kia viết về bài gốc, cam). */
export const CTX_SIDE = {
  main: { label: 'Trích từ bài gốc', tip: 'Câu này nằm trong bài gốc (bài đang xem): bài gốc viết gì khi dẫn bài này.' },
  other: { label: 'Trích từ bài này', tip: 'Câu này nằm trong bài kia: bài này viết gì khi dẫn bài gốc (bài đang xem).' },
};

/** Khối câu trích dẫn có nhãn nguồn. side: 'main' | 'other'. max: số câu hiện sẵn, phần còn lại thu gọn. */
export function ctxQuotes(contexts, side, { max = 2, extra = '' } = {}) {
  const list = (contexts || []).filter(Boolean);
  if (!list.length) return extra ? `<div class="ctx">${extra}</div>` : '';
  const s = CTX_SIDE[side] || CTX_SIDE.other;
  const q = (c) => `<blockquote>${escQ(c)}</blockquote>`;
  return `<div class="ctx ctx-${side === 'main' ? 'main' : 'other'}">${extra}<div class="ctx-src" title="${escQ(s.tip)}"><i></i>${s.label}</div>${list.slice(0, max).map(q).join('')}${list.length > max ? `<details><summary>Xem thêm ${list.length - max} câu</summary>${list.slice(max).map(q).join('')}</details>` : ''}</div>`;
}
