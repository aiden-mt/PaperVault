// Tìm nhanh toàn app (Ctrl+K): lệnh, paper, toàn văn PDF, trang Sổ tay, cuộc trò chuyện, việc trong Lịch.
// Gõ ">" ở đầu để chỉ tìm lệnh. ↑ ↓ chọn, Enter mở, Alt + Enter mở ở khung bên kia khi đang chia đôi màn hình.
import { api } from './api.js';
import { store, paperById } from './store.js';
import { escapeHtml, norm } from './util.js';
import { plainTitle } from './richtext.js';
import { loadPages, allPages, ensureDailyPage, pageByTitle, newPage, savePage } from './notebook.js';
import { loadEvents, allEvents } from './calendar.js';

let opts = null; // { navigate, commands: () => [{label, hint, keys, icon, run}], canOther: () => bool, openOther(hash) }
let wrap = null;

export function initPalette(o) { opts = o; }
export const paletteOpen = () => !!wrap;

const tokens = (q) => norm(q).split(/\s+/).filter(Boolean);
const hits = (hay, toks) => toks.every((t) => hay.includes(t));
/** Điểm khớp: trùng đầu tiêu đề > có trong tiêu đề > chỉ có trong phần khác. */
function score(title, rest, toks, q) {
  const t = norm(title);
  if (!hits(`${t} ${norm(rest)}`, toks)) return -1;
  if (t.startsWith(norm(q))) return 3;
  return hits(t, toks) ? 2 : 1;
}
const top = (arr, n) => arr.filter((x) => x.s >= 0).sort((a, b) => b.s - a.s || (b.at || 0) - (a.at || 0)).slice(0, n);
const ts = (v) => (v ? new Date(v).getTime() || 0 : 0);

/** Cắt một đoạn quanh chỗ khớp để hiện dưới tiêu đề. */
function snippetOf(text, toks) {
  // Bỏ ký hiệu Markdown để đoạn trích đọc được: callout, liên kết [[…]], đậm / nghiêng, công thức, tiêu đề.
  const s = String(text || '')
    .replace(/^\s*>?\s*\[![\w-]+\][+-]?/gm, '')
    .replace(/!?\[\[@?([^\]|]*)\|?([^\]]*)\]\]/g, (m, a, b) => b || (m.includes('[[@') ? '📄' : a))
    .replace(/[*_`#>]+|\$\$?/g, ' ')
    .replace(/\s+/g, ' ');
  if (!toks.length) return '';
  const i = norm(s).indexOf(toks[0]);
  if (i < 0) return '';
  const a = Math.max(0, i - 40);
  return (a ? '… ' : '') + s.slice(a, i + 90) + (i + 90 < s.length ? ' …' : '');
}
function mark(text, toks) {
  let h = escapeHtml(text);
  for (const t of toks) {
    if (t.length < 2) continue;
    // So khớp trên bản bỏ dấu, tô trên bản gốc: duyệt từng vị trí của chuỗi đã chuẩn hoá (cùng độ dài với bản gốc sau NFC).
    const src = String(text);
    const n = norm(src);
    if (n.length !== src.length) continue;
    const parts = [];
    let from = 0;
    for (let i = n.indexOf(t); i >= 0; i = n.indexOf(t, i + t.length)) { parts.push(escapeHtml(src.slice(from, i)), `<mark>${escapeHtml(src.slice(i, i + t.length))}</mark>`); from = i + t.length; }
    if (parts.length) { parts.push(escapeHtml(src.slice(from))); h = parts.join(''); }
    break;
  }
  return h;
}

function localResults(q) {
  const toks = tokens(q.replace(/^>/, ''));
  const onlyCmd = q.trim().startsWith('>');
  const groups = [];
  const cmds = opts.commands().map((c) => ({ ...c, s: toks.length ? score(c.label, c.hint || '', toks, q.replace(/^>/, '').trim()) : 0 }));
  const cmdHits = top(cmds, toks.length ? 6 : (onlyCmd ? 30 : 6));
  if (cmdHits.length) groups.push({ name: 'Lệnh', items: cmdHits.map((c) => ({ icon: c.icon || '⚡', title: c.label, sub: c.hint || '', keys: c.keys, run: c.run })) });
  if (onlyCmd) return groups;

  const papers = store.papers.filter((p) => !p.deleted);
  const pHits = toks.length
    ? top(papers.map((p) => { const e = p.extraction || {}; return { p, s: score(p.title, [...(e.authors || []), ...(e.tags || []), e.venue, e.year, e.one_liner, e.key_idea?.summary, (e.validation?.datasets || []).join(' '), p.userNotes, p.arxivId, p.doi].join(' '), toks, q), at: ts(p.addedAt) }; }), 8)
    : top(papers.map((p) => ({ p, s: 0, at: ts(p.updatedAt || p.addedAt) })), 4);
  if (pHits.length) groups.push({ name: toks.length ? 'Paper' : 'Paper mới cập nhật', items: pHits.map(({ p }) => ({ icon: '📄', title: plainTitle(p.title) || 'Không tên', sub: [(p.extraction?.authors || []).slice(0, 3).join(', '), p.extraction?.venue, p.extraction?.year].filter(Boolean).join(' · '), href: `#/paper/${p.id}` })) });

  const pages = allPages();
  const nHits = toks.length
    ? top(pages.map((p) => ({ p, s: score(p.title || '', p.content || '', toks, q), at: ts(p.updatedAt) })), 8)
    : top(pages.map((p) => ({ p, s: 0, at: ts(p.updatedAt) })), 4);
  if (nHits.length) groups.push({ name: toks.length ? 'Sổ tay' : 'Trang sổ tay gần đây', items: nHits.map(({ p }) => ({ icon: p.icon || '📝', title: p.title || 'Không tên', sub: toks.length && !hits(norm(p.title), toks) ? snippetOf(p.content, toks) : '', href: `#/notebook/${encodeURIComponent(p.id)}` })) });

  if (toks.length) {
    const evs = top(allEvents().map((e) => ({ e, s: score(e.title || '', e.note || '', toks, q), at: ts(e.date) })), 5);
    if (evs.length) groups.push({ name: 'Lịch', items: evs.map(({ e }) => ({ icon: '📅', title: e.title || 'Không tên', sub: [e.date, e.allDay ? 'cả ngày' : e.time].filter(Boolean).join(' · '), href: `#/calendar?d=${e.date}` })) });
    if (chats) {
      const cHits = top(chats.map((c) => ({ c, s: score(c.title || '', '', toks, q), at: ts(c.updatedAt) })), 5);
      if (cHits.length) groups.push({ name: 'Chat', items: cHits.map(({ c }) => ({ icon: '💬', title: c.title || 'Cuộc trò chuyện', sub: `${c.turns || 0} câu hỏi`, href: `#/chat/${c.id}` })) });
    }
  }
  return groups;
}

/** Mục cuối danh sách: lọc Thư viện theo đúng chuỗi đang gõ (cách tìm cũ của ô tìm kiếm). */
function libraryItem(q) {
  const s = q.trim();
  return s && !s.startsWith('>') ? { icon: '📚', title: `Lọc Thư viện theo “${s}”`, sub: 'Tên, tác giả, tag, dataset, ý tưởng…', href: `#/library?q=${encodeURIComponent(s)}` } : null;
}
/** Tạo nhanh trang sổ tay tên đúng chuỗi đang gõ (khi chưa có trang trùng tên). */
function createItem(q) {
  const s = q.trim();
  if (!s || s.startsWith('>') || s.length > 120 || pageByTitle(s)) return null;
  return { icon: '＋', title: `Tạo trang sổ tay “${s}”`, sub: 'Trang mới ở gốc cây trang', run: async () => { const p = await savePage(newPage({ title: s, parentId: null })); opts.navigate(`#/notebook/${encodeURIComponent(p.id)}`); } };
}

let chats = null;
let fullText = { q: '', items: [] };

export async function openPalette(initial = '') {
  if (!opts) return;
  if (wrap) { wrap.querySelector('input').select(); return; }
  if (document.querySelector('.modal')) return; // đang mở hộp thoại khác thì không chồng lên
  chats = null;
  fullText = { q: '', items: [] };
  wrap = document.createElement('div');
  wrap.className = 'modal pal-wrap';
  wrap.innerHTML = `<div class="pal" role="dialog" aria-label="Tìm nhanh">
      <div class="pal-in"><svg class="i"><use href="#i-search"/></svg>
        <input type="search" placeholder="Tìm paper, nội dung PDF, trang sổ tay, chat, lịch… (gõ > để tìm lệnh)" autocomplete="off" spellcheck="false" aria-label="Tìm nhanh">
        <kbd>Esc</kbd></div>
      <div class="pal-list" role="listbox"></div>
      <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> chọn</span><span><kbd>Enter</kbd> mở</span><span class="pal-alt"><kbd>Alt</kbd>+<kbd>Enter</kbd> mở ở khung bên kia</span><span><kbd>&gt;</kbd> chỉ tìm lệnh</span></div>
    </div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector('input');
  const list = wrap.querySelector('.pal-list');
  wrap.querySelector('.pal-alt').hidden = !opts.canOther?.();
  let items = [];
  let sel = 0;
  let timer = 0;

  const draw = () => {
    const q = input.value;
    const groups = localResults(q);
    const toks = tokens(q);
    if (fullText.q === q.trim() && fullText.items.length) groups.push({ name: 'Nội dung PDF', items: fullText.items });
    const more = [libraryItem(q), createItem(q)].filter(Boolean);
    if (more.length) groups.push({ name: 'Khác', items: more });
    items = groups.flatMap((g) => g.items);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    let i = 0;
    list.innerHTML = groups.length ? groups.map((g) => `<div class="pal-g">${escapeHtml(g.name)}</div>${g.items.map((it) => {
      const n = i++;
      return `<div class="pal-it${n === sel ? ' sel' : ''}" role="option" data-i="${n}" aria-selected="${n === sel}">
        <span class="pal-ic">${escapeHtml(it.icon)}</span>
        <span class="pal-tx"><span class="pal-t">${mark(it.title, toks)}</span>${it.sub ? `<span class="pal-s">${it.html ? it.sub : mark(it.sub, toks)}</span>` : ''}</span>
        ${it.keys ? `<span class="pal-k">${it.keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('')}</span>` : ''}</div>`;
    }).join('')}`).join('')
      : `<div class="pal-empty">${q.trim() ? `Không thấy kết quả cho “${escapeHtml(q.trim())}”.${q.trim().length < 3 ? ' Gõ từ 3 ký tự để tìm cả trong nội dung PDF.' : ''}` : 'Gõ để tìm.'}</div>`;
    list.querySelector('.pal-it.sel')?.scrollIntoView({ block: 'nearest' });
  };

  const searchFull = () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3 || q.startsWith('>')) return;
    timer = setTimeout(async () => {
      try {
        const rows = await api.search(q);
        if (!wrap || input.value.trim() !== q) return;
        // Bỏ paper đã hiện ở nhóm Paper để danh sách không lặp.
        const shown = new Set(items.filter((it) => it.href?.startsWith('#/paper/')).map((it) => it.href));
        fullText = { q, items: (rows || []).map((r) => ({ r, p: paperById(r.paperId) })).filter(({ p }) => p && !p.deleted && !shown.has(`#/paper/${p.id}`)).slice(0, 6).map(({ r, p }) => ({
          icon: '🔎', title: plainTitle(p.title) || 'Không tên', html: true,
          sub: escapeHtml(String(r.snippet || '').replace(/\s+/g, ' ')).replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>'),
          href: `#/paper/${p.id}`,
        })) };
        draw();
      } catch (_) { /* không tìm được toàn văn thì thôi */ }
    }, 220);
  };

  const close = () => { clearTimeout(timer); wrap?.remove(); wrap = null; document.removeEventListener('keydown', onKey, true); };
  const activate = async (n, other = false) => {
    const it = items[n];
    if (!it) return;
    close();
    if (it.run) { await it.run(); return; }
    if (other && opts.canOther?.()) { opts.openOther(it.href); return; }
    opts.navigate(it.href);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      list.querySelectorAll('.pal-it').forEach((x) => { const on = Number(x.dataset.i) === sel; x.classList.toggle('sel', on); x.setAttribute('aria-selected', on); });
      list.querySelector('.pal-it.sel')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); activate(sel, e.altKey); }
  };
  document.addEventListener('keydown', onKey, true);
  input.addEventListener('input', () => { sel = 0; draw(); searchFull(); });
  list.addEventListener('mousemove', (e) => {
    const it = e.target.closest('.pal-it');
    if (!it || Number(it.dataset.i) === sel) return;
    sel = Number(it.dataset.i);
    list.querySelectorAll('.pal-it').forEach((x) => x.classList.toggle('sel', Number(x.dataset.i) === sel));
  });
  list.addEventListener('click', (e) => { const it = e.target.closest('.pal-it'); if (it) activate(Number(it.dataset.i), e.altKey); });
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });

  input.value = initial;
  draw();
  input.focus();
  if (initial) searchFull();
  // Nạp thêm dữ liệu chưa có (sổ tay, lịch, chat) rồi vẽ lại.
  Promise.allSettled([loadPages(), loadEvents(), api.chats().then((c) => { chats = c; })]).then(() => { if (wrap) draw(); });
}

/** Lệnh "Nhật ký hôm nay" dùng chung. */
export async function openDiary(navigate) {
  const p = await ensureDailyPage();
  navigate(`#/notebook/${encodeURIComponent(p.id)}`);
}
