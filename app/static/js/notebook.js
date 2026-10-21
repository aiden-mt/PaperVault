// Sổ tay nghiên cứu: trang Markdown kiểu Obsidian (liên kết [[trang]], liên kết ngược, #tag, nhúng trang) kết hợp khối
// kiểu Notion (cây trang lồng nhau, việc cần làm, callout, bảng paper truy vấn từ thư viện), và gắn chặt với thư viện:
// [[@paperId]] trỏ tới một paper, ![[@paperId]] nhúng thẻ paper, khối ```papers liệt kê paper theo bộ lọc.
// File này lo dữ liệu và cách hiển thị; trang giao diện ở views/notebook.js.
import { api } from './api.js';
import { store, paperById, topicOf } from './store.js';
import { mdToHtml } from './ui.js';
import { escapeHtml, uid, STATUS_LABEL } from './util.js';
import { plainTitle, titleHtml, renderMath } from './richtext.js';
import { codeBlockHtml } from './highlight.js';

/* ---------------- dữ liệu ---------------- */

let pages = null;
let loading = null;
const subs = new Set();
const emit = () => { for (const fn of [...subs]) { try { fn(); } catch (e) { console.error(e); } } };
export const onPagesChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };

export async function loadPages(force = false) {
  if (pages && !force) return pages;
  loading ||= api.pages().then((list) => { pages = list || []; loading = null; return pages; }, (e) => { loading = null; throw e; });
  return loading;
}
export const allPages = () => (pages || []).filter((p) => !p.deleted);
export const trashPages = () => (pages || []).filter((p) => p.deleted);
export const pageById = (id) => (pages || []).find((p) => p.id === id) || null;
export const pageByTitle = (t) => { const k = String(t || '').trim().toLowerCase(); return k ? allPages().find((p) => (p.title || '').trim().toLowerCase() === k) || null : null; };

export function newPage(fields = {}) {
  return { id: uid('pg'), title: '', icon: '', parentId: null, content: '', fav: false, ...fields };
}

export async function savePage(p) {
  const saved = await api.putPage(p);
  const i = (pages || []).findIndex((x) => x.id === saved.id);
  if (i >= 0) pages[i] = saved; else (pages ||= []).unshift(saved);
  emit();
  return saved;
}
export async function savePages(list) {
  if (!list.length) return [];
  const saved = await api.putPages(list);
  for (const s of saved) { const i = pages.findIndex((x) => x.id === s.id); if (i >= 0) pages[i] = s; else pages.unshift(s); }
  emit();
  return saved;
}
/** Xoá hẳn (chỉ dùng trong Thùng rác). */
export async function destroyPage(id) {
  await api.deletePage(id);
  pages = (pages || []).filter((p) => p.id !== id);
  emit();
}

/* ---------------- liên kết ---------------- */

const WIKI = /(!?)\[\[([^\]\n]+?)\]\]/g;
const linkTarget = (inner) => inner.split('|')[0].split('#')[0].trim();

/** Bỏ khối code để không bắt nhầm liên kết / tag nằm trong code. */
const stripCode = (md) => String(md || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');

export function parseLinks(md) {
  const out = { pages: new Set(), papers: new Set() };
  for (const m of stripCode(md).matchAll(WIKI)) {
    const t = linkTarget(m[2]);
    if (t.startsWith('@')) out.papers.add(t.slice(1));
    else if (t) out.pages.add(t.toLowerCase());
  }
  return out;
}

const TAG = /(^|[\s(])#([\p{L}][\p{L}\p{N}_/-]*)/gu;
export function tagsOf(md) {
  const s = new Set();
  for (const m of stripCode(md).replace(/^#{1,6}\s/gm, '').matchAll(TAG)) s.add(m[2].toLowerCase());
  return [...s];
}

export function allTags() {
  const count = new Map();
  for (const p of allPages()) for (const t of tagsOf(p.content)) count.set(t, (count.get(t) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Dòng chứa đoạn khớp, rút gọn để làm trích đoạn. */
function snippetAround(md, test) {
  const lines = String(md || '').split('\n');
  const hit = lines.find((l) => test(l)) || '';
  return readableLinks(hit.replace(/^[#>\-*\s\d.[\]x]+/, '')).trim().slice(0, 180);
}

/** Đổi cú pháp liên kết thành chữ đọc được: [[@id|Tên]] -> 📄 Tên, [[Trang|chữ]] -> chữ. */
export function readableLinks(s) {
  return String(s || '').replace(/!?\[\[([^\]\n]+?)\]\]/g, (m, inner) => {
    const [target, alias] = inner.split('|');
    const tg = target.split('#')[0].trim();
    if (tg.startsWith('@')) { const p = paperById(tg.slice(1)); return `📄 ${(alias || (p ? paperShort(p) : tg)).trim()}`; }
    return (alias || tg).trim();
  });
}

/** Các trang có liên kết tới page (liên kết ngược). */
export function backlinks(page) {
  const key = (page.title || '').trim().toLowerCase();
  if (!key) return [];
  return allPages().filter((p) => p.id !== page.id && parseLinks(p.content).pages.has(key))
    .map((p) => ({ page: p, snippet: snippetAround(p.content, (l) => l.toLowerCase().includes(`[[${key}`)) }));
}

/** Trang có nhắc tên page nhưng chưa đặt liên kết (giống "Unlinked mentions" của Obsidian). */
export function unlinkedMentions(page) {
  const key = (page.title || '').trim().toLowerCase();
  if (key.length < 3) return [];
  return allPages().filter((p) => p.id !== page.id && !parseLinks(p.content).pages.has(key) && stripCode(p.content).toLowerCase().includes(key))
    .map((p) => ({ page: p, snippet: snippetAround(p.content, (l) => l.toLowerCase().includes(key)) }));
}

/** Các trang nhắc tới một paper trong thư viện ([[@id]] hoặc ![[@id]]). */
export function pagesForPaper(paperId) {
  return allPages().filter((p) => parseLinks(p.content).papers.has(paperId))
    .map((p) => ({ page: p, snippet: snippetAround(p.content, (l) => l.includes(`@${paperId}`)) }));
}

/** Đổi tên trang: sửa mọi [[Tên cũ…]] ở các trang khác thành tên mới. Trả về danh sách trang đã sửa (chưa lưu). */
export function renameLinks(oldTitle, newTitle) {
  const o = String(oldTitle || '').trim();
  const n = String(newTitle || '').trim();
  if (!o || !n || o === n) return [];
  const esc = o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(!?\\[\\[)${esc}(?=\\]\\]|\\||#)`, 'gi');
  const changed = [];
  for (const p of allPages()) {
    if (!re.test(p.content || '')) continue;
    re.lastIndex = 0;
    changed.push({ ...p, content: p.content.replace(re, `$1${n}`) });
  }
  return changed;
}

export const pageLabel = (p) => `${p.icon ? `${p.icon} ` : ''}${p.title || 'Không tên'}`;
export const paperShort = (p) => {
  const e = p?.extraction || {};
  const first = String((e.authors || [])[0] || '').trim().split(/\s+/).pop();
  return `${first || plainTitle(p?.title || '').split(/\s+/).slice(0, 3).join(' ')}${e.year ? ` ${e.year}` : ''}`;
};

/** Đường dẫn cha của một trang (từ gốc tới trang cha gần nhất). */
export function ancestors(page) {
  const out = [];
  let cur = page?.parentId ? pageById(page.parentId) : null;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.unshift(cur); cur = cur.parentId ? pageById(cur.parentId) : null; }
  return out;
}
export const childrenOf = (id) => allPages().filter((p) => (p.parentId || null) === (id || null));
/** true khi target là page hoặc nằm bên trong page (để không kéo một trang vào chính con của nó). */
export function isInside(target, page) {
  let cur = target;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) { if (cur.id === page.id) return true; seen.add(cur.id); cur = cur.parentId ? pageById(cur.parentId) : null; }
  return false;
}

/* ---------------- mẫu trang ---------------- */

/** Ngày theo giờ máy dạng YYYY-MM-DD (toISOString là giờ UTC: ở Việt Nam trước 7 giờ sáng sẽ ra ngày hôm trước). */
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => localDate();
export const TEMPLATES = [
  { id: 'blank', label: 'Trang trống', icon: '📄', desc: 'Bắt đầu từ trang trắng.', make: () => ({ content: '' }) },
  {
    id: 'paper', label: 'Ghi chú đọc paper', icon: '📑', paper: true, desc: 'Nhúng thẻ một paper trong thư viện, kèm khung: câu hỏi khi đọc, điều rút ra, áp dụng cho đề tài.',
    make: (p) => ({
      title: p ? `Đọc: ${plainTitle(p.title).slice(0, 80)}` : 'Ghi chú đọc paper',
      content: `${p ? `![[@${p.id}]]\n\n` : ''}## Câu hỏi khi đọc\n- \n\n## Điều rút ra\n- \n\n## Áp dụng cho đề tài của tôi\n- [ ] \n\n## Liên kết\n- Liên quan: [[ ]]\n\n#đọc-paper\n`,
    }),
  },
  {
    id: 'review', label: 'Tổng quan một chủ đề', icon: '🗺', desc: 'Mục tiêu, các hướng tiếp cận, bảng paper liên quan lấy từ thư viện, khoảng trống còn bỏ ngỏ.',
    make: () => ({ content: '> [!info] Mục tiêu\n> Chủ đề này trả lời câu hỏi gì, phạm vi tới đâu.\n\n## Các hướng tiếp cận\n### Hướng 1\n- Bài tiêu biểu: [[@ ]]\n\n## Bảng paper liên quan\n```papers\ntag: \nsort: year\ncols: title, year, venue, status\n```\n\n## Khoảng trống còn bỏ ngỏ\n- \n\n#tổng-quan\n' }),
  },
  {
    id: 'exp', label: 'Kế hoạch thí nghiệm', icon: '🧪', desc: 'Giả thuyết, bảng thiết lập (dataset, baseline, metric), việc cần làm, kết quả, rủi ro.',
    make: () => ({ content: '## Giả thuyết\n\n## Thiết lập\n| Thành phần | Lựa chọn |\n| --- | --- |\n| Dataset | |\n| Baseline | |\n| Metric | |\n\n## Việc cần làm\n- [ ] Chuẩn bị dữ liệu\n- [ ] Chạy baseline\n- [ ] Chạy phương pháp đề xuất\n\n## Kết quả\n\n> [!warning] Rủi ro\n> \n\n#thí-nghiệm\n' }),
  },
  { id: 'daily', label: 'Nhật ký hôm nay', icon: '📅', desc: 'Một trang cho mỗi ngày, gom trong trang “Nhật ký”, nối với Lịch. Đã có trang hôm nay thì mở trang đó.', make: (_, d = today()) => ({ title: `Nhật ký ${d}`, content: `## Hôm nay đọc\n- \n\n## Ý tưởng\n- \n\n## Việc cần làm\n- [ ] \n\n#nhật-ký\n` }) },
];

/* ---------------- nhật ký theo ngày (nối với Lịch) ---------------- */

export const dailyTitle = (date) => `Nhật ký ${date}`;
/** Ngày của một trang nhật ký ("Nhật ký 2026-10-21" -> "2026-10-21"), không phải nhật ký thì rỗng. */
export const dailyDateOf = (page) => (/^Nhật ký (\d{4}-\d{2}-\d{2})$/.exec(String(page?.title || '').trim()) || [])[1] || '';
export const dailyPage = (date) => pageByTitle(dailyTitle(date));
/** Trang nhật ký của ngày date (tạo nếu chưa có, đặt trong trang "Nhật ký"). */
export async function ensureDailyPage(date = localDate()) {
  await loadPages();
  const hit = dailyPage(date);
  if (hit) return hit;
  let parent = pageByTitle('Nhật ký');
  if (!parent) parent = await savePage(newPage({ title: 'Nhật ký', icon: '📅', content: 'Mỗi ngày một trang. Bấm 📅 Hôm nay ở thanh bên, hoặc chọn một ngày trong Lịch, để mở trang của ngày đó.\n' }));
  const tpl = TEMPLATES.find((x) => x.id === 'daily').make(null, date);
  return savePage(newPage({ ...tpl, icon: '📅', parentId: parent.id }));
}

/* ---------- việc cần làm có hạn trong Sổ tay: "- [ ] việc 📅 2026-10-25" ---------- */
const DUE_RE = /^(\s*[-*] \[([ xX])\] )(.*?)\s*📅\s*(\d{4}-\d{2}-\d{2})\s*$/;
/** Mọi việc cần làm có ngày hạn trong các trang: [{ pageId, line, text, done, date }]. */
export function datedTasks() {
  const out = [];
  for (const p of allPages()) {
    String(p.content || '').split('\n').forEach((l, i) => {
      const m = DUE_RE.exec(l);
      if (m) out.push({ pageId: p.id, line: i, text: m[3].trim(), done: m[2] !== ' ', date: m[4] });
    });
  }
  return out;
}
/** Đánh dấu xong / chưa xong một việc có hạn (sửa thẳng dòng trong trang nguồn). */
export async function toggleDatedTask(pageId, line) {
  const p = pageById(pageId);
  if (!p) return null;
  return savePage({ ...p, content: toggleTodo(p.content, line) });
}

/* ---------------- hiển thị ---------------- */

const inlineMd = (s) => mdWithImages(s).replace(/^<p>|<\/p>$/g, '');
const CALLOUT = {
  note: ['📝', 'Ghi chú'], info: ['ℹ️', 'Thông tin'], tip: ['💡', 'Mẹo'], idea: ['💡', 'Ý tưởng'], important: ['❗', 'Quan trọng'],
  warning: ['⚠️', 'Lưu ý'], danger: ['⛔', 'Nguy cơ'], question: ['❓', 'Câu hỏi'], quote: ['❝', 'Trích dẫn'], todo: ['☑️', 'Việc cần làm'], success: ['✅', 'Đã xong'],
};

function paperEmbedHtml(id) {
  const p = paperById(id);
  if (!p) return `<div class="nb-embed nb-missing-paper">📄 Không tìm thấy paper <code>${escapeHtml(id)}</code> trong thư viện.</div>`;
  const e = p.extraction || {};
  const t = topicOf(p);
  return `<div class="nb-embed nb-paper-card" data-nb-paper="${escapeHtml(p.id)}">
    <div class="nb-pc-t"><a href="#/paper/${escapeHtml(p.id)}">${titleHtml(p.title || '')}</a></div>
    <div class="hint">${escapeHtml((e.authors || []).slice(0, 3).join(', '))}${e.authors?.length > 3 ? ' et al.' : ''}${e.year ? ` · ${escapeHtml(e.year)}` : ''}${e.venue ? ` · ${escapeHtml(e.venue)}` : ''}</div>
    ${e.one_liner ? `<div class="nb-pc-one">${escapeHtml(e.one_liner)}</div>` : ''}
    <div class="nb-pc-meta"><span class="badge">${escapeHtml(STATUS_LABEL[p.status || 'to-read'] || '')}</span>${p.rating ? `<span class="badge">${'★'.repeat(p.rating)}</span>` : ''}${t ? `<span class="badge topic" style="--c:${escapeHtml(t.color || '#888')}"><i></i>${escapeHtml(t.name)}</span>` : ''}${(e.tags || []).slice(0, 4).map((x) => `<span class="badge accent">#${escapeHtml(x)}</span>`).join('')}</div></div>`;
}

/** Khối ```papers: "tag: vqa", "topic: …", "status: reading", "q: từ khoá", "year: 2020-2024", "sort: year|rating|added|title", "cols: …", "limit: 20". */
const COLS = {
  title: ['Paper', (p) => `<a href="#/paper/${escapeHtml(p.id)}">${titleHtml(p.title || '')}</a>`],
  year: ['Năm', (p) => escapeHtml(p.extraction?.year || '')],
  venue: ['Venue', (p) => escapeHtml(p.venueInfo?.acronym || p.extraction?.venue || '')],
  status: ['Trạng thái', (p) => escapeHtml(STATUS_LABEL[p.status || 'to-read'] || '')],
  rating: ['Đánh giá', (p) => (p.rating ? '★'.repeat(p.rating) : '')],
  topic: ['Chủ đề', (p) => escapeHtml(topicOf(p)?.name || '')],
  tags: ['Tag', (p) => (p.extraction?.tags || []).slice(0, 4).map((x) => `#${escapeHtml(x)}`).join(' ')],
  idea: ['Ý chính', (p) => escapeHtml(p.extraction?.one_liner || '')],
  novelty: ['Điểm mới', (p) => escapeHtml(p.extraction?.novelty || '')],
  dataset: ['Dataset / metric', (p) => escapeHtml(p.extraction?.dataset_metric_note || '')],
};
export const PAPER_QUERY_HELP = 'tag, topic, status (to-read / reading / done), q, year (2020-2024), sort (year / rating / added / title), cols (title, year, venue, status, rating, topic, tags, idea, novelty, dataset), limit';
export const QUERY_COLS = Object.entries(COLS).map(([k, [label]]) => [k, label]);
export const QUERY_SORTS = [['added', 'Mới thêm vào thư viện trước'], ['year', 'Năm đăng, mới trước'], ['rating', 'Đánh giá cao trước'], ['title', 'Tên A → Z']];
export const QUERY_KEYS = ['tag', 'topic', 'status', 'year', 'q', 'sort', 'cols', 'limit'];
/** "tag: a, b\nsort: year" -> { tag: 'a, b', sort: 'year' } */
export function parsePaperQuery(src) {
  const q = {};
  for (const line of String(src || '').split('\n')) { const m = /^\s*(\w+)\s*:\s*(.*)$/.exec(line); if (m && m[2].trim()) q[m[1].toLowerCase()] = m[2].trim(); }
  return q;
}
export const paperQuerySrc = (q) => QUERY_KEYS.filter((k) => String(q[k] ?? '').trim()).map((k) => `${k}: ${String(q[k]).trim()}`).join('\n');

/** Chạy bộ lọc trên thư viện: { list (đã cắt theo limit), total, cols }. */
export function runPaperQuery(q) {
  const norm = (s) => String(s || '').toLowerCase();
  let list = store.papers.filter((p) => !p.deleted);
  if (q.tag) { const tags = q.tag.split(',').map((x) => norm(x.replace(/^#/, '').trim())).filter(Boolean); list = list.filter((p) => (p.extraction?.tags || []).some((t) => tags.includes(norm(t)))); }
  if (q.topic) list = list.filter((p) => norm(topicOf(p)?.name).includes(norm(q.topic)));
  if (q.status) { const st = q.status.split(',').map((x) => norm(x.trim())); list = list.filter((p) => st.includes(norm(p.status || 'to-read')) || st.includes(norm(STATUS_LABEL[p.status || 'to-read']))); }
  if (q.q) list = list.filter((p) => norm(`${p.title} ${p.extraction?.one_liner || ''} ${(p.extraction?.tags || []).join(' ')}`).includes(norm(q.q)));
  if (q.year) { const [a, b] = q.year.split('-').map((x) => Number(x.trim())); list = list.filter((p) => { const y = Number(p.extraction?.year); return y && y >= (a || 0) && y <= (b || a || 9999); }); }
  const sorters = { year: (a, b) => (Number(b.extraction?.year) || 0) - (Number(a.extraction?.year) || 0), rating: (a, b) => (b.rating || 0) - (a.rating || 0), added: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)), title: (a, b) => String(a.title).localeCompare(String(b.title)) };
  list.sort(sorters[q.sort] || sorters.added);
  const total = list.length;
  list = list.slice(0, Math.max(1, Math.min(500, Number(q.limit) || 50)));
  const cols = (q.cols || 'title, year, venue, status').split(',').map((x) => x.trim().toLowerCase()).filter((c) => COLS[c]);
  return { list, total, cols };
}

export function paperQueryHtml(src, idx = null) {
  const q = typeof src === 'string' ? parsePaperQuery(src) : src;
  const { list, total, cols } = runPaperQuery(q);
  const desc = Object.entries(q).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'toàn bộ thư viện';
  return `<div class="nb-query"><div class="nb-query-h"><span class="nb-query-t">📚 Bảng paper</span><span class="nb-query-n">${total} paper${total > list.length ? `, hiện ${list.length}` : ''}</span>${idx != null ? `<button type="button" class="sm ghost nb-q-edit" data-nb-q="${idx}" title="Chỉnh bảng: chọn bộ lọc, cột, cách sắp xếp">⚙<span class="nb-q-lbl"> Chỉnh bảng</span></button>` : ''}<span class="hint nb-query-desc" title="${escapeHtml(desc)}">${escapeHtml(desc)}</span></div>
    ${list.length ? `<div class="table-wrap"><table class="data"><thead><tr>${cols.map((c) => `<th>${COLS[c][0]}</th>`).join('')}</tr></thead><tbody>${list.map((p) => `<tr>${cols.map((c) => `<td>${COLS[c][1](p)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="hint" style="padding:8px">Không có paper nào khớp bộ lọc.</div>'}</div>`;
}

/* ---------- ảnh ---------- */
// ![mô tả](link) · ![mô tả|400](link) đặt độ rộng 400px · ![mô tả|60%](link) theo phần trăm.
// Link nhận: ảnh đã tải lên app (/api/image/…), http(s)://…, data:image/… (png, jpeg, gif, webp).
const IMG_RE = /!\[([^\]\n]*)\]\(\s*([^)\s]+)\s*\)/g;
const IMG_LINE = /^\s*!\[([^\]\n]*)\]\(\s*([^)\s]+)\s*\)\s*$/;
const safeImgUrl = (u) => /^\/api\/image\/[0-9a-f]{16}\.(png|jpg|gif|webp|bmp)$/.test(u) || /^https?:\/\/\S+$/i.test(u) || /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(u);
export function imageHtml(altRaw, url, { block = false } = {}) {
  const parts = String(altRaw || '').split('|');
  let size = '';
  if (parts.length > 1 && /^\s*\d{1,4}(px|%)?\s*$/.test(parts[parts.length - 1])) {
    const v = parts.pop().trim();
    size = /%$/.test(v) ? `width:${Math.min(100, parseInt(v, 10))}%` : `width:${parseInt(v, 10)}px`;
  }
  const alt = parts.join('|').trim();
  if (!safeImgUrl(url)) return `<span class="nb-img-bad" title="Link ảnh không hợp lệ">🖼 ${escapeHtml(alt || url)}</span>`;
  const img = `<img class="nb-img" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy"${size ? ` style="${size}"` : ''} title="${escapeHtml(alt ? `${alt} · bấm để phóng to` : 'Bấm để phóng to')}">`;
  return block ? `<figure class="nb-fig">${img}${alt ? `<figcaption>${escapeHtml(alt)}</figcaption>` : ''}</figure>` : img;
}
/** Markdown -> HTML có ảnh cùng dòng: thay ảnh bằng ký hiệu giữ chỗ trước, dựng Markdown, rồi đặt ảnh lại. */
function mdWithImages(src) {
  const imgs = [];
  const masked = String(src).replace(IMG_RE, (m, alt, url) => { imgs.push(imageHtml(alt, url)); return `\u2063IMG${imgs.length - 1}\u2063`; });
  const html = mdToHtml(masked);
  return imgs.length ? html.replace(/\u2063IMG(\d+)\u2063/g, (m, k) => imgs[Number(k)]) : html;
}

/** Liên kết và tag trong phần chữ của HTML đã dựng (không đụng thẻ HTML, code). */
function inlineLinks(html) {
  return html.split(/(<pre[\s\S]*?<\/pre>|<code>[\s\S]*?<\/code>|<[^>]+>)/).map((seg) => {
    if (!seg || seg.startsWith('<')) return seg;
    return seg.replace(/\[\[([^\]\n]+?)\]\]/g, (m, inner) => {
      const [targetRaw, alias] = inner.split('|');
      const target = targetRaw.split('#')[0].trim();
      if (target.startsWith('@')) {
        const p = paperById(target.slice(1));
        if (!p) return `<span class="nb-paper nb-missing" title="Không tìm thấy paper này trong thư viện">📄 ${alias || target}</span>`;
        return `<a class="nb-paper" href="#/paper/${escapeHtml(p.id)}" data-nb-paper="${escapeHtml(p.id)}" title="${escapeHtml(plainTitle(p.title))}">📄 ${alias ? alias.trim() : escapeHtml(paperShort(p))}</a>`;
      }
      const pg = pageByTitle(target);
      if (!pg) return `<a class="nb-link nb-missing" data-nb-new="${escapeHtml(target)}" title="Chưa có trang này, bấm để tạo">${alias ? alias.trim() : target}</a>`;
      return `<a class="nb-link" data-nb-page="${escapeHtml(pg.id)}">${alias ? alias.trim() : escapeHtml(pageLabel(pg))}</a>`;
    }).replace(TAG, (m, pre, tag) => `${pre}<a class="nb-tag" data-nb-tag="${escapeHtml(tag.toLowerCase())}">#${tag}</a>`);
  }).join('');
}

/**
 * Dựng HTML của một trang. Ngoài Markdown thường còn có: việc cần làm "- [ ]" (bấm được), callout "> [!note] Tiêu đề",
 * nhúng paper "![[@id]]", nhúng trang "![[Tên trang]]", bảng paper ```papers, liên kết [[…]] và #tag.
 */
export function renderNote(md, { depth = 0, qc = null, mark = false } = {}) {
  if (depth === 0 && qc === null) qc = { n: 0 }; // qc: false = khối nằm trong callout, không gắn nút Chỉnh bảng
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const out = [];
  let buf = [];
  let bufStart = 0;
  // mark: bọc mỗi khối trong <div class="nb-blk" data-line="dòng nguồn"> để đồng bộ vị trí giữa phần viết và phần xem.
  const blk = (html, line) => (mark ? `<div class="nb-blk" data-line="${line}">${html}</div>` : html);
  const flush = () => { if (buf.length) { out.push(blk(mdWithImages(buf.join('\n')), bufStart)); buf = []; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const s = i; // dòng bắt đầu của khối đang xét
    if (/^\s*```papers\s*$/.test(l)) {
      flush();
      const q = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) q.push(lines[i]);
      out.push(blk(paperQueryHtml(q.join('\n'), qc ? qc.n++ : null), s));
      continue;
    }
    // Khối code: khung riêng có tên ngôn ngữ và tô màu theo ngôn ngữ; ```math là công thức LaTeX đứng riêng.
    const fence = /^\s*```\s*([\w#+.-]*)\s*$/.exec(l);
    if (fence) {
      flush();
      const code = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) code.push(lines[i]);
      const body = code.join('\n');
      out.push(blk(/^(math|latexmath|tex-math)$/i.test(fence[1]) ? `<div class="nb-math">${renderMath(body, true)}</div>` : codeBlockHtml(body, fence[1]), s));
      continue;
    }
    if (/^\s*```/.test(l)) { buf.push(l); for (i++; i < lines.length; i++) { buf.push(lines[i]); if (/^\s*```/.test(lines[i])) break; } continue; }
    // Ảnh đứng riêng một dòng: hình có chú thích.
    const im = IMG_LINE.exec(l);
    if (im) { flush(); out.push(blk(imageHtml(im[1], im[2], { block: true }), s)); continue; }
    let m = /^\s*!\[\[@([^\]|#]+)(?:\|[^\]]*)?\]\]\s*$/.exec(l);
    if (m) { flush(); out.push(blk(paperEmbedHtml(m[1].trim()), s)); continue; }
    m = /^\s*!\[\[([^\]|#@][^\]|#]*)(?:[|#][^\]]*)?\]\]\s*$/.exec(l);
    if (m) {
      flush();
      const pg = pageByTitle(m[1]);
      out.push(blk(pg && depth < 1
        ? `<div class="nb-embed nb-page-embed"><div class="nb-pe-h"><a class="nb-link" data-nb-page="${escapeHtml(pg.id)}">${escapeHtml(pageLabel(pg))}</a></div>${renderNote(pg.content, { depth: depth + 1 })}</div>`
        : `<div class="nb-embed nb-missing-paper">${pg ? `Trang <b>${escapeHtml(pg.title)}</b> (không nhúng lồng nhau)` : `Chưa có trang <b>${escapeHtml(m[1])}</b>`}</div>`, s));
      continue;
    }
    if (/^\s*[-*] \[[ xX]\] /.test(l)) {
      flush();
      const items = [];
      for (; i < lines.length && /^\s*[-*] \[[ xX]\] /.test(lines[i]); i++) {
        const indent = Math.floor(lines[i].match(/^\s*/)[0].length / 2);
        const raw = lines[i].replace(/^\s*[-*] \[[ xX]\] /, '');
        const due = /\s*📅\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(raw);
        const isDone = /\[[xX]\]/.test(lines[i]);
        const dueHtml = due ? `<a class="nb-due ${!isDone && due[1] < localDate() ? 'late' : ''} ${due[1] === localDate() ? 'now' : ''}" href="#/calendar?d=${due[1]}" title="Hạn ${due[1]} · mở Lịch ngày này">📅 ${Number(due[1].slice(8))}/${Number(due[1].slice(5, 7))}</a>` : '';
        items.push(`<li class="nb-todo ${isDone ? 'done' : ''}" style="--ind:${indent}"><input type="checkbox" data-nb-line="${i}" ${isDone ? 'checked' : ''}${depth ? ' disabled' : ''}><span>${inlineMd(due ? raw.slice(0, due.index) : raw)} ${dueHtml}</span></li>`);
      }
      i--;
      out.push(blk(`<ul class="nb-todos">${items.join('')}</ul>`, s));
      continue;
    }
    m = /^>\s*\[!(\w+)\]([+-]?)\s*(.*)$/.exec(l);
    if (m) {
      flush();
      const body = [];
      for (i++; i < lines.length && /^>/.test(lines[i]); i++) body.push(lines[i].replace(/^>\s?/, ''));
      i--;
      const [icon, label] = CALLOUT[m[1].toLowerCase()] || ['📝', m[1]];
      out.push(blk(`<div class="nb-callout nb-co-${escapeHtml(m[1].toLowerCase())}"><div class="nb-co-h">${icon} ${m[3] ? inlineMd(m[3]) : label}</div>${body.join('').trim() ? `<div class="nb-co-b">${renderNote(body.join('\n'), { depth, qc: false })}</div>` : ''}</div>`, s));
      continue;
    }
    if (mark) {
      // Mỗi đoạn (ngăn bởi dòng trống) và mỗi tiêu đề là một khối riêng, để nhảy qua lại được tới đúng chỗ.
      if (!l.trim()) { flush(); continue; }
      if (/^#{1,6}\s/.test(l)) flush();
    }
    if (!buf.length) bufStart = i;
    buf.push(l);
  }
  flush();
  return inlineLinks(out.join('\n'));
}

/** Đổi trạng thái việc cần làm ở dòng thứ line. */
export function toggleTodo(md, line) {
  const lines = String(md || '').split('\n');
  if (!lines[line]) return md;
  lines[line] = lines[line].replace(/^(\s*[-*] \[)([ xX])(\] )/, (m, a, x, b) => `${a}${x === ' ' ? 'x' : ' '}${b}`);
  return lines.join('\n');
}
