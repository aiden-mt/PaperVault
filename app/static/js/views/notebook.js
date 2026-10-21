// Trang Sổ tay nghiên cứu (#/notebook, #/notebook/<id>): cây trang bên trái, trình soạn thảo Markdown + xem trước,
// liên kết ngược, đồ thị liên kết. Dữ liệu và cách dựng nội dung nằm ở ../notebook.js.
import { api } from '../api.js';
import { store, paperById } from '../store.js';
import { $, toast, dialog, confirmDialog } from '../ui.js';
import { escapeHtml, fmtRelative, download, copyText, debounce } from '../util.js';
import { plainTitle, titleHtml } from '../richtext.js';
import {
  loadPages, allPages, trashPages, pageById, pageByTitle, newPage, savePage, savePages, destroyPage, onPagesChange,
  parseLinks, tagsOf, allTags, backlinks, unlinkedMentions, renameLinks, pageLabel, paperShort, ancestors, childrenOf,
  isInside, TEMPLATES, renderNote, toggleTodo, PAPER_QUERY_HELP, ensureDailyPage, localDate, dailyDateOf,
} from '../notebook.js';
import { pickTemplate, paperQueryBuilder, openGuide, codeDialog, formulaDialog, mathLibraryDialog, parentOptions, imageUrlDialog } from './notebook-ui.js';
import { loadMathLib } from '../mathlib.js';
import { loadEvents, occurrences, toggleDone, saveEvent, catOf, fmtDay } from '../calendar.js';

const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { /* bỏ qua */ } return null; };
const EMOJIS = '📄 📑 📝 📓 📚 🧠 💡 🧪 🔬 📊 📈 🗺 🧭 🎯 ✅ ⭐ 🔥 ❓ ⚠️ 📌 🗂 🧩 🛠 🤖 👁 🖼 🗣 🌐 📅 🏷 💬 🔗 🧮 📐 🧬 🏁 🚧 🌱 🪄'.split(' ');

export async function render(root, { params, query }) {
  root.className = 'view split';
  root.innerHTML = `<div class="nb-page">
    <aside class="nb-side">
      <div class="nb-side-h"><button type="button" class="nb-side-title" id="nb-home" title="Về trang chủ Sổ tay">📓 Sổ tay nghiên cứu</button><span class="spacer"></span><button class="ghost sm" id="nb-help" title="Hướng dẫn: Markdown, liên kết, khối, bảng paper, phím tắt (Ctrl + /)">❔</button><button class="ghost sm" id="nb-graph" title="Đồ thị liên kết giữa các trang và paper">🕸</button></div>
      <input type="search" id="nb-search" placeholder="Tìm trang, nội dung, #tag… (Ctrl+K)">
      <div class="nb-side-acts"><button class="primary sm" id="nb-new">+ Trang mới</button><button class="sm" id="nb-daily" title="Mở (hoặc tạo) trang nhật ký của hôm nay">📅 Hôm nay</button></div>
      <div class="nb-selbar" id="nb-selbar" hidden></div>
      <div class="nb-tree" id="nb-tree"></div>
      <details class="nb-fold" id="nb-tags-wrap"><summary>🏷 Tag</summary><div id="nb-tags" class="nb-tags"></div></details>
      <details class="nb-fold" id="nb-trash-wrap"><summary>🗑 Thùng rác <span id="nb-trash-n"></span></summary><div class="nb-trash-bar" id="nb-trash-bar"></div><div id="nb-trash"></div></details>
      <div class="nb-side-foot"><button class="ghost sm" id="nb-mathlib" title="Macro LaTeX (\\R, \\norm…) và công thức hay dùng, nhập từ file .tex / .sty">📐 Thư viện LaTeX</button></div>
    </aside>
    <section class="nb-main" id="nb-main"><div class="empty">Đang tải sổ tay…</div></section>
  </div>`;

  let cur = null;          // id trang đang mở
  let titleAtFocus = '';   // tên đã chốt của trang đang mở, để khi đổi tên thì sửa liên kết ở trang khác
  let dirty = false;
  let saving = Promise.resolve();
  const collapsed = new Set(JSON.parse(LS('pv.nbCollapsed') || '[]'));
  let selecting = false;    // chế độ chọn nhiều trang trong cây
  const picked = new Set(); // trang đang được chọn
  const tPicked = new Set(); // trang đang được chọn trong thùng rác
  loadMathLib();
  let mode = LS('pv.nbMode') || 'split';
  let syncOn = LS('pv.nbSync') !== '0'; // cuộn đồng bộ phần viết và phần xem (giống Overleaf)

  try { await loadPages(); } catch (e) { $('nb-main').innerHTML = `<div class="empty">Không tải được sổ tay: ${escapeHtml(e.message)}</div>`; return () => {}; }

  /* ---------------- lưu ---------------- */

  const status = (msg) => { const s = $('nb-status'); if (s) s.textContent = msg; };
  async function persist() {
    if (!cur || !dirty) return;
    const p = pageById(cur);
    const ed = $('nb-ed');
    const ti = $('nb-title');
    if (!p) return;
    dirty = false;
    status('Đang lưu…');
    saving = savePage({ ...p, content: ed ? ed.value : p.content, title: ti ? ti.value.trim() : p.title })
      .then(() => status('Đã lưu'))
      .catch((e) => { dirty = true; status(`Chưa lưu được: ${e.message}`); });
    await saving;
  }
  const persistSoon = debounce(persist, 700);
  const markDirty = () => { dirty = true; status('Đang sửa…'); persistSoon(); };

  /* ---------------- điều hướng trong trang ---------------- */

  async function openPage(id, { push = true, focus = false } = {}) {
    await persist();
    cur = id && pageById(id) && !pageById(id).deleted ? id : null;
    if (push) history.pushState(null, '', cur ? `#/notebook/${cur}` : '#/notebook');
    drawTree();
    drawMain();
    if (focus && $('nb-title')) { $('nb-title').focus(); $('nb-title').select(); }
  }

  async function createPage(fields = {}, { open = true } = {}) {
    const p = await savePage(newPage(fields));
    if (open) await openPage(p.id, { focus: !fields.title });
    return p;
  }

  async function createFromTemplate({ parentId = null, title = '', tplId = 'blank', paperId = '' } = {}) {
    await persist();
    const r = await pickTemplate({ parentId, title, tplId, paperId });
    if (!r) return;
    if (r.tpl.id === 'daily') return openDaily();
    const made = r.tpl.make(r.paper);
    await createPage({ icon: r.tpl.id === 'blank' ? '' : r.tpl.icon, ...made, title: r.title || made.title || '', parentId: r.parentId });
  }

  async function openDaily(date) {
    await persist();
    const p = await ensureDailyPage(date || localDate());
    await openPage(p.id);
  }

  /* ---------------- cây trang ---------------- */

  const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '', 'vi');
  function nodeHtml(p, depth) {
    const kids = childrenOf(p.id).sort(byTitle);
    const open = !collapsed.has(p.id);
    return `<div class="nb-node ${p.id === cur ? 'on' : ''} ${picked.has(p.id) ? 'picked' : ''}" draggable="${selecting ? 'false' : 'true'}" data-id="${p.id}" style="--d:${depth}">
        <button type="button" class="nb-tw ${kids.length ? '' : 'leaf'}" data-tw="${p.id}" tabindex="-1">${kids.length ? (open ? '▾' : '▸') : '•'}</button>
        ${selecting ? `<input type="checkbox" class="nb-pick" data-pick="${p.id}" ${picked.has(p.id) ? 'checked' : ''} aria-label="Chọn trang">` : ''}
        <span class="nb-node-t" data-open="${p.id}">${escapeHtml(pageLabel(p))}</span>
        ${selecting ? '' : `<button type="button" class="nb-node-add" data-child="${p.id}" title="Thêm trang con">+</button>`}</div>
      ${kids.length && open ? kids.map((k) => nodeHtml(k, depth + 1)).join('') : ''}`;
  }

  function drawTree() {
    const q = $('nb-search').value.trim().toLowerCase();
    const tree = $('nb-tree');
    if (q) {
      const tag = q.startsWith('#') ? q.slice(1) : '';
      const hits = allPages().map((p) => {
        if (tag) return tagsOf(p.content).some((t) => t.startsWith(tag)) ? { p, s: '' } : null;
        const inTitle = (p.title || '').toLowerCase().includes(q);
        const idx = (p.content || '').toLowerCase().indexOf(q);
        if (!inTitle && idx < 0) return null;
        return { p, rank: inTitle ? 0 : 1, s: idx >= 0 ? p.content.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, ' ') : '' };
      }).filter(Boolean).sort((a, b) => (a.rank || 0) - (b.rank || 0));
      tree.innerHTML = `<div class="nb-tree-h">${hits.length} kết quả</div>${hits.map(({ p, s }) => `<div class="nb-hit ${p.id === cur ? 'on' : ''}" data-open="${p.id}"><b>${escapeHtml(pageLabel(p))}</b>${s ? `<span class="hint">…${escapeHtml(s)}…</span>` : ''}</div>`).join('') || '<div class="hint" style="padding:6px 10px">Không có trang nào khớp.</div>'}`;
    } else {
      const favs = allPages().filter((p) => p.fav).sort(byTitle);
      const roots = childrenOf(null).sort(byTitle);
      tree.innerHTML = `${favs.length ? `<div class="nb-tree-h">⭐ Yêu thích</div>${favs.map((p) => `<div class="nb-node nb-fav ${p.id === cur ? 'on' : ''}" data-id="${p.id}" style="--d:0"><span class="nb-tw leaf">•</span><span class="nb-node-t" data-open="${p.id}">${escapeHtml(pageLabel(p))}</span></div>`).join('')}` : ''}
        <div class="nb-tree-h nb-root-drop" data-drop-root="1"><span>Trang <span class="hint">(${allPages().length})</span></span><span class="spacer"></span>${allPages().length ? `<button type="button" class="linkish nb-sel-toggle" data-sel-toggle="1" title="Chọn nhiều trang để di chuyển hoặc xoá">${selecting ? 'Xong' : '☑ Chọn'}</button>` : ''}</div>
        ${roots.map((p) => nodeHtml(p, 0)).join('') || '<div class="hint" style="padding:6px 10px">Chưa có trang nào. Bấm “+ Trang mới”.</div>'}`;
    }
    const tags = allTags();
    $('nb-tags').innerHTML = tags.map(([t, n]) => `<button type="button" class="nb-tagchip" data-tag="${escapeHtml(t)}">#${escapeHtml(t)} <span class="hint">${n}</span></button>`).join('') || '<span class="hint">Chưa có tag. Gõ #tên-tag trong trang.</span>';
    const trash = trashRoots();
    for (const id of [...tPicked]) if (!trash.some((p) => p.id === id)) tPicked.delete(id);
    $('nb-trash-n').textContent = trash.length ? `(${trash.length})` : '';
    $('nb-trash-bar').innerHTML = trash.length ? `<label class="nb-tb-all" title="Chọn tất cả"><input type="checkbox" data-tall ${tPicked.size === trash.length ? 'checked' : ''}> Tất cả</label>
      <button type="button" class="sm" data-trestore ${tPicked.size ? '' : 'disabled'} title="Khôi phục các trang đã chọn">↶ Khôi phục${tPicked.size ? ` ${tPicked.size}` : ''}</button>
      <button type="button" class="sm danger" data-tdestroy ${tPicked.size ? '' : 'disabled'} title="Xoá vĩnh viễn các trang đã chọn">✕ Xoá${tPicked.size ? ` ${tPicked.size}` : ''}</button>` : '';
    $('nb-trash').innerHTML = trash.length ? `${trash.map((p) => {
      const n = trashPages().filter((x) => x.trashedWith === p.id).length;
      return `<div class="nb-trash-row ${tPicked.has(p.id) ? 'picked' : ''}"><input type="checkbox" data-tpick="${p.id}" ${tPicked.has(p.id) ? 'checked' : ''}><span class="nb-trash-t" title="${escapeHtml(pageLabel(p))} · xoá ${escapeHtml(fmtRelative(p.deletedAt))}">${escapeHtml(pageLabel(p))}${n > 1 ? ` <span class="hint">+${n - 1}</span>` : ''}</span><button class="nb-ico" data-restore="${p.id}" title="Khôi phục">↶</button><button class="nb-ico danger" data-destroy="${p.id}" title="Xoá vĩnh viễn">✕</button></div>`;
    }).join('')}<button type="button" class="linkish nb-empty-trash" data-tempty title="Xoá vĩnh viễn mọi trang trong thùng rác">Dọn sạch thùng rác</button>` : '<span class="hint nb-empty">Trống.</span>';
    drawSelbar();
  }

  /* ---------- chọn nhiều: di chuyển / xoá ---------- */
  const trashRoots = () => trashPages().filter((p) => !p.trashedWith || p.trashedWith === p.id || !pageById(p.trashedWith));
  /** Trang được chọn mà trang cha (gần hay xa) không được chọn: thao tác trên các trang này là đủ, trang con đi theo. */
  const pickedRoots = () => [...picked].map(pageById).filter((p) => p && !p.deleted && !ancestors(p).some((a) => picked.has(a.id)));
  function drawSelbar() {
    const bar = $('nb-selbar');
    bar.hidden = !selecting;
    if (!selecting) return;
    bar.innerHTML = `<div class="nb-selbar-top"><span>Đã chọn <b>${picked.size}</b>/${allPages().length}</span><button type="button" class="linkish" data-sall>${picked.size === allPages().length && picked.size ? 'Bỏ chọn hết' : 'Chọn tất cả'}</button></div>
      <div class="nb-selbar-acts"><button type="button" class="sm" data-smove ${picked.size ? '' : 'disabled'} title="Đưa các trang đã chọn vào trong một trang khác">↪ Di chuyển</button><button type="button" class="sm danger" data-sdel ${picked.size ? '' : 'disabled'} title="Đưa các trang đã chọn vào thùng rác">🗑 Xoá</button><button type="button" class="sm" data-sdone title="Thoát chế độ chọn">Xong</button></div>`;
  }
  function setSelecting(on) { selecting = on; if (!on) picked.clear(); drawTree(); }
  async function moveSelected() {
    const roots = pickedRoots();
    if (!roots.length) return;
    const to = await dialog({
      title: `Di chuyển ${roots.length} trang`, width: 480,
      body: `<p class="hint" style="margin-top:0">Trang con của các trang được chọn đi theo trang cha của chúng.</p><label class="field"><span class="label-text">Đặt vào trong</span><select id="nb-mv">${parentOptions(null, roots.map((r) => r.id))}</select></label>`,
      buttons: [{ label: 'Huỷ', value: null }, { label: 'Di chuyển', primary: true, onClick: (b, close) => { close({ id: b.querySelector('#nb-mv').value || null }); return false; } }],
    });
    if (!to) return;
    await persist();
    await savePages(roots.map((p) => ({ ...pageById(p.id), parentId: to.id })));
    if (to.id) collapsed.delete(to.id);
    toast(`Đã di chuyển ${roots.length} trang.`);
    setSelecting(false);
    drawCrumbs();
  }
  async function trashSelected() {
    const roots = pickedRoots();
    if (!roots.length) return;
    const all = allPages().filter((x) => roots.some((r) => isInside(x, r)));
    if (!(await confirmDialog(`Đưa ${roots.length} trang${all.length > roots.length ? ` (kèm ${all.length - roots.length} trang con)` : ''} vào thùng rác? Có thể khôi phục ở cuối thanh bên.`, { okLabel: 'Đưa vào thùng rác', danger: true }))) return;
    await persist();
    const at = new Date().toISOString();
    await savePages(all.map((x) => ({ ...x, deleted: true, deletedAt: at, trashedWith: roots.find((r) => isInside(x, r)).id })));
    const curGone = cur && !allPages().some((p) => p.id === cur);
    setSelecting(false);
    toast(`Đã đưa ${all.length} trang vào thùng rác.`);
    if (curGone) openPage(null);
  }
  async function restoreTrash(ids) {
    const group = trashPages().filter((p) => ids.includes(p.id) || ids.includes(p.trashedWith));
    if (!group.length) return;
    const restoring = new Set(group.map((p) => p.id));
    await savePages(group.map(({ deleted, deletedAt, trashedWith, ...p }) => ({ ...p, parentId: p.parentId && (restoring.has(p.parentId) || (pageById(p.parentId) && !pageById(p.parentId).deleted)) ? p.parentId : null })));
    for (const id of ids) tPicked.delete(id);
    toast(`Đã khôi phục ${group.length} trang.`);
    drawTree();
  }
  async function destroyTrash(ids, { all = false } = {}) {
    const group = all ? trashPages() : trashPages().filter((p) => ids.includes(p.id) || ids.includes(p.trashedWith));
    if (!group.length) return;
    if (!(await confirmDialog(`${all ? 'Dọn sạch thùng rác: x' : 'X'}oá vĩnh viễn ${group.length} trang? Không hoàn tác được.`, { danger: true, okLabel: 'Xoá vĩnh viễn' }))) return;
    for (const p of group) await destroyPage(p.id);
    tPicked.clear();
    toast(`Đã xoá vĩnh viễn ${group.length} trang.`);
    drawTree();
  }
  $('nb-selbar').addEventListener('click', (e) => {
    if (e.target.closest('[data-sall]')) { if (picked.size === allPages().length) picked.clear(); else allPages().forEach((p) => picked.add(p.id)); drawTree(); return; }
    if (e.target.closest('[data-smove]')) return moveSelected();
    if (e.target.closest('[data-sdel]')) return trashSelected();
    if (e.target.closest('[data-sdone]')) setSelecting(false);
  });

  $('nb-tree').addEventListener('click', (e) => {
    if (e.target.closest('[data-sel-toggle]')) { setSelecting(!selecting); return; }
    if (selecting) {
      const n = e.target.closest('.nb-node[data-id]');
      if (n && !e.target.closest('[data-tw]')) { const id = n.dataset.id; if (picked.has(id)) picked.delete(id); else picked.add(id); if (e.target.matches('input[data-pick]')) e.target.checked = picked.has(id); drawTree(); return; }
    }
    const tw = e.target.closest('[data-tw]');
    if (tw) { const id = tw.dataset.tw; if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id); LS('pv.nbCollapsed', JSON.stringify([...collapsed])); drawTree(); return; }
    const add = e.target.closest('[data-child]');
    if (add) { collapsed.delete(add.dataset.child); createFromTemplate({ parentId: add.dataset.child }); return; }
    const o = e.target.closest('[data-open]');
    if (o) openPage(o.dataset.open);
  });
  // Kéo thả để đổi trang cha (thả lên dòng "Trang" để đưa ra ngoài cùng).
  let dragId = null;
  $('nb-tree').addEventListener('dragstart', (e) => { const n = e.target.closest('.nb-node[data-id]'); if (n) { dragId = n.dataset.id; e.dataTransfer.effectAllowed = 'move'; } });
  $('nb-tree').addEventListener('dragover', (e) => { const t = e.target.closest('.nb-node[data-id], [data-drop-root]'); if (t && dragId) { e.preventDefault(); $('nb-tree').querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')); t.classList.add('drop'); } });
  $('nb-tree').addEventListener('dragleave', (e) => { e.target.closest?.('.drop')?.classList.remove('drop'); });
  $('nb-tree').addEventListener('drop', async (e) => {
    e.preventDefault();
    $('nb-tree').querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
    const src = pageById(dragId);
    dragId = null;
    if (!src) return;
    const t = e.target.closest('.nb-node[data-id], [data-drop-root]');
    if (!t) return;
    const parent = t.dataset.dropRoot ? null : pageById(t.dataset.id);
    if (parent && isInside(parent, src)) return toast('Không thể đưa một trang vào chính trang con của nó.', 3000, 'err');
    if ((src.parentId || null) === (parent?.id || null)) return;
    await persist();
    await savePage({ ...pageById(src.id), parentId: parent?.id || null });
    if (parent) collapsed.delete(parent.id);
    drawTree();
    if (cur === src.id) drawCrumbs();
  });
  $('nb-tags').addEventListener('click', (e) => { const b = e.target.closest('[data-tag]'); if (b) { $('nb-search').value = `#${b.dataset.tag}`; drawTree(); } });
  $('nb-trash').addEventListener('click', async (e) => {
    if (e.target.closest('[data-tempty]')) return destroyTrash([], { all: true });
    const r = e.target.closest('[data-restore]');
    const d = e.target.closest('[data-destroy]');
    const pk = e.target.closest('[data-tpick]');
    if (pk) { if (pk.checked) tPicked.add(pk.dataset.tpick); else tPicked.delete(pk.dataset.tpick); drawTree(); return; }
    if (r) return restoreTrash([r.dataset.restore]);
    if (d) return destroyTrash([d.dataset.destroy]);
  });
  $('nb-trash-bar').addEventListener('click', (e) => {
    const all = e.target.closest('[data-tall]');
    if (all) { const roots = trashRoots(); if (all.checked) roots.forEach((p) => tPicked.add(p.id)); else tPicked.clear(); drawTree(); return; }
    if (e.target.closest('[data-trestore]')) return restoreTrash([...tPicked]);
    if (e.target.closest('[data-tdestroy]')) return destroyTrash([...tPicked]);
    if (e.target.closest('[data-tempty]')) return destroyTrash([], { all: true });
  });
  $('nb-search').addEventListener('input', drawTree);
  $('nb-new').addEventListener('click', () => createFromTemplate({ parentId: null }));
  $('nb-daily').addEventListener('click', () => openDaily());
  $('nb-graph').addEventListener('click', () => openNoteGraph());
  $('nb-home').addEventListener('click', () => openPage(null));
  $('nb-help').addEventListener('click', () => openGuide('md', { insert: insertSnippet }));
  $('nb-mathlib').addEventListener('click', async () => { if (await mathLibraryDialog()) drawPreview(); });

  /* ---------------- vùng chính ---------------- */

  function drawCrumbs() {
    const p = pageById(cur);
    const box = $('nb-crumbs');
    if (!p || !box) return;
    box.innerHTML = `<button type="button" class="nb-crumb-home" data-open-home="1" title="Về trang chủ Sổ tay">⌂ Sổ tay</button>${ancestors(p).map((a) => `<span class="nb-crumb-sep">/</span><a data-open="${a.id}">${escapeHtml(pageLabel(a))}</a>`).join('')}<span class="nb-crumb-sep">/</span><span class="nb-crumb-cur">${escapeHtml(pageLabel(p))}</span>`;
  }

  function drawHome() {
    const recent = [...allPages()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 12);
    const nTags = allTags().length;
    const nPapers = new Set(allPages().flatMap((p) => [...parseLinks(p.content).papers])).size;
    $('nb-main').innerHTML = `<div class="nb-home">
      <div class="nb-home-h"><h1>📓 Sổ tay nghiên cứu</h1><span class="spacer"></span><button type="button" class="primary" data-home-new>+ Trang mới</button><button type="button" data-home-daily>📅 Hôm nay</button></div>
      <div class="nb-home-stats"><span><b>${allPages().length}</b> trang</span><span><b>${nTags}</b> tag</span><span><b>${nPapers}</b> paper được nhắc tới</span>${trashPages().length ? `<span>${trashPages().length} trong thùng rác</span>` : ''}</div>
      ${recent.length ? `<h3>Sửa gần đây</h3><div class="nb-recent">${recent.map((p) => `<button type="button" class="nb-recent-c" data-open="${p.id}"><b>${escapeHtml(pageLabel(p))}</b><span class="hint">${escapeHtml(fmtRelative(p.updatedAt))}${ancestors(p).length ? ` · trong ${escapeHtml(ancestors(p).map((a) => a.title).join(' / '))}` : ''}</span><span class="nb-recent-s">${escapeHtml((p.content || '').replace(/[#>*`[\]!-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120))}</span></button>`).join('')}</div>` : ''}
      <div class="nb-guide-btns"><span class="hint">Hướng dẫn chi tiết:</span>${[['md', 'Markdown'], ['link', 'Liên kết & paper'], ['block', 'Khối đặc biệt'], ['query', 'Bảng paper'], ['keys', 'Phím tắt']].map(([k, l]) => `<button type="button" class="sm" data-guide="${k}">${l}</button>`).join('')}<button type="button" class="sm" data-mathlib="1">📐 Thư viện LaTeX</button></div>
      <details class="nb-cheat"><summary>Cú pháp nhanh</summary>
        <table class="data"><tbody>
          <tr><td><code>[[Tên trang]]</code></td><td>Liên kết tới trang (chưa có thì bấm vào để tạo). <code>[[Tên|chữ hiện]]</code> để đổi chữ hiện.</td></tr>
          <tr><td><code>[[@</code></td><td>Liên kết tới một paper trong thư viện (gõ để tìm). Trang paper sẽ hiện các trang nhắc tới nó.</td></tr>
          <tr><td><code>![[@id]]</code> / <code>![[Tên trang]]</code></td><td>Nhúng thẻ paper / nhúng nội dung một trang khác.</td></tr>
          <tr><td><code>- [ ] việc</code></td><td>Việc cần làm, bấm ô vuông ở phần xem để đánh dấu xong.</td></tr>
          <tr><td><code>&gt; [!idea] Tiêu đề</code></td><td>Callout: note, info, tip, idea, warning, danger, question, success.</td></tr>
          <tr><td><code>\`\`\`papers</code></td><td>Bảng paper lấy trực tiếp từ thư viện: ${escapeHtml(PAPER_QUERY_HELP)}.</td></tr>
          <tr><td><code>#tag</code></td><td>Gắn tag, bấm tag để lọc các trang cùng tag.</td></tr>
          <tr><td><code>/</code></td><td>Mở danh sách khối: tiêu đề, việc cần làm, callout, bảng, khối code (chọn ngôn ngữ), công thức LaTeX, paper…</td></tr>
          <tr><td><code>\`\`\`python</code> … <code>\`\`\`</code></td><td>Khối code có khung riêng và tô màu theo ngôn ngữ (Python, C++, C#, Java, JS/TS, Rust, Go, SQL, Bash, LaTeX…).</td></tr>
          <tr><td><code>![mô tả|400](link)</code></td><td>Ảnh: dán (Ctrl+V), kéo thả file vào trang, hoặc <code>/</code> → Ảnh từ máy / Ảnh từ đường link. Số sau dấu | là độ rộng (px hoặc %). Bấm ảnh ở phần xem để phóng to.</td></tr>
          <tr><td><code>$x^2$</code> · <code>$$…$$</code></td><td>Công thức LaTeX cùng dòng / đứng riêng. Macro tự định nghĩa ở 📐 Thư viện LaTeX.</td></tr>
          <tr><td>Phím tắt</td><td>Ctrl+K tìm trang · Ctrl+S lưu · Ctrl+B / Ctrl+I đậm / nghiêng · Tab / Shift+Tab thụt lề danh sách · Ctrl+/ hướng dẫn.</td></tr>
        </tbody></table></details></div>`;
  }

  function drawMain() {
    const p = pageById(cur);
    if (!p) { drawHome(); return; }
    $('nb-main').innerHTML = `<div class="nb-doc">
      <div class="nb-head">
        <div class="nb-crumbs" id="nb-crumbs"></div>
        <div class="nb-title-row">
          <button type="button" class="nb-icon" id="nb-icon" title="Đổi biểu tượng">${p.icon ? escapeHtml(p.icon) : '<span class="hint">＋</span>'}</button>
          <input id="nb-title" class="nb-title" placeholder="Không tên" value="${escapeHtml(p.title || '')}">
          <div class="seg nb-mode" id="nb-mode"><button data-m="edit" title="Chỉ soạn">Viết</button><button data-m="split" title="Soạn và xem cạnh nhau">Chia đôi</button><button data-m="read" title="Chỉ xem, để đọc">Xem</button></div>
          <button type="button" class="ghost sm" id="nb-help2" title="Hướng dẫn cú pháp và phím tắt (Ctrl + /)">❔</button>
          <button type="button" class="ghost sm nb-fav-btn ${p.fav ? 'on' : ''}" id="nb-fav" title="${p.fav ? 'Bỏ khỏi Yêu thích' : 'Thêm vào Yêu thích'}">${p.fav ? '★' : '☆'}</button>
          <span class="sel-pick"><button type="button" class="ghost sm" id="nb-more" aria-haspopup="menu">⋯</button>
            <div class="menu right" id="nb-menu" role="menu" hidden>
              <button data-act="child">Thêm trang con</button><button data-act="move">Di chuyển tới…</button><button data-act="dup">Nhân bản</button>
              <hr><button data-act="copy">Copy Markdown</button><button data-act="md">Tải file .md</button>
              <hr><button data-act="del" class="danger">Đưa vào thùng rác</button></div></span>
        </div>
        <div class="nb-meta hint"><span id="nb-status">Đã lưu</span> · sửa ${escapeHtml(fmtRelative(p.updatedAt))} · <span id="nb-count"></span></div>
      </div>
      ${dailyDateOf(p) ? '<div class="nb-daycal" id="nb-daycal"></div>' : ''}
      <div class="nb-body mode-${mode}" id="nb-body">
        <div class="nb-edwrap"><textarea id="nb-ed" spellcheck="false" placeholder="Viết gì đó… gõ / để chèn khối, [[ để liên kết trang, [[@ để nhắc tới paper">${escapeHtml(p.content || '')}</textarea><div class="nb-pop" id="nb-pop" hidden></div></div>
        <div class="nb-gutter" id="nb-gutter">
          <button type="button" data-nbgo="prev" title="Tới chỗ này ở phần xem: cuộn phần xem tới đoạn đang có con trỏ">▶</button>
          <button type="button" data-nbgo="ed" title="Tới chỗ này ở phần viết: đưa con trỏ về đoạn đang xem ở đầu phần xem (hoặc bấm đúp vào một đoạn ở phần xem)">◀</button>
          <button type="button" data-sync class="${syncOn ? 'on' : ''}" title="${syncOn ? 'Đang cuộn đồng bộ hai bên. Bấm để tắt' : 'Bấm để bật cuộn đồng bộ hai bên'}">⇅</button>
        </div>
        <div class="nb-prev md" id="nb-prev"></div>
      </div>
      <div class="nb-links" id="nb-links"></div></div>`;
    drawCrumbs();
    const main = $('nb-main');
    main.onscroll = () => main.querySelector('.nb-head')?.classList.toggle('stuck', main.scrollTop > 4);
    $('nb-mode').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.m === mode));
    drawPreview();
    drawLinks();
    bindDoc();
    drawDayCal();
  }

  /** Trang nhật ký: kế hoạch của ngày đó từ Lịch (đánh dấu xong, thêm nhanh, mở Lịch). */
  async function drawDayCal() {
    const p = pageById(cur);
    const date = dailyDateOf(p);
    const box = $('nb-daycal');
    if (!date || !box) return;
    await loadEvents();
    const occ = occurrences(date, date);
    box.innerHTML = `<div class="nb-dc-h"><b>📅 Lịch · ${escapeHtml(fmtDay(date))}</b><span class="hint">${occ.length ? `${occ.filter((o) => o.done).length}/${occ.length} xong` : 'chưa có kế hoạch'}</span><span class="spacer"></span><a class="sm nb-dc-open" href="#/calendar?d=${date}">Mở Lịch ngày này →</a></div>
      <div class="nb-dc-list">${occ.map((o) => { const [, cl, col] = catOf(o.ev.cat); return `<label class="nb-dc-item ${o.done ? 'done' : ''}" title="${escapeHtml(cl)}"><input type="checkbox" data-dc="${o.ev.id}" ${o.done ? 'checked' : ''}><i style="background:${col}"></i>${o.ev.start ? `<b>${escapeHtml(o.ev.start)}</b>` : ''}<span>${escapeHtml(o.ev.title)}</span></label>`; }).join('')}
        <input class="nb-dc-add" id="nb-dc-add" placeholder="+ Thêm kế hoạch cho ngày này (Enter) · ví dụ 14:00 Họp nhóm"></div>`;
    box.querySelectorAll('[data-dc]').forEach((cb) => cb.addEventListener('change', async () => { await toggleDone(cb.dataset.dc, date); drawDayCal(); }));
    const add = box.querySelector('#nb-dc-add');
    add.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !add.value.trim()) return;
      const m = /^(\d{1,2})[:h](\d{2})\s+(.+)$/.exec(add.value.trim());
      await saveEvent({ title: (m ? m[3] : add.value).trim(), date, start: m ? `${m[1].padStart(2, '0')}:${m[2]}` : '', cat: 'other', pageId: p.id });
      await drawDayCal();
      $('nb-dc-add')?.focus();
    });
  }

  const drawPreview = () => {
    const ed = $('nb-ed');
    if (!ed) return;
    $('nb-prev').innerHTML = renderNote(ed.value, { mark: true }) || '<p class="hint">Trang trống.</p>';
    smap = null; // bố cục đổi: tính lại bảng vị trí khi cần
    const words = ed.value.trim() ? ed.value.trim().split(/\s+/).length : 0;
    $('nb-count').textContent = `${words.toLocaleString('vi-VN')} từ`;
  };
  const previewSoon = debounce(drawPreview, 160);

  function drawLinks() {
    const p = pageById(cur);
    const box = $('nb-links');
    if (!p || !box) return;
    const ed = $('nb-ed');
    const content = ed ? ed.value : p.content;
    const back = backlinks({ ...p, title: $('nb-title')?.value || p.title });
    const unl = unlinkedMentions({ ...p, title: $('nb-title')?.value || p.title });
    const papers = [...parseLinks(content).papers].map(paperById).filter(Boolean);
    const kids = childrenOf(p.id).sort(byTitle);
    box.innerHTML = `
      ${kids.length ? `<div class="nb-lsec"><h4>Trang con (${kids.length})</h4>${kids.map((k) => `<a class="nb-lrow" data-open="${k.id}">${escapeHtml(pageLabel(k))}</a>`).join('')}</div>` : ''}
      <div class="nb-lsec"><h4>Liên kết tới trang này (${back.length})</h4>${back.map(({ page, snippet }) => `<a class="nb-lrow" data-open="${page.id}"><b>${escapeHtml(pageLabel(page))}</b>${snippet ? `<span class="hint">${escapeHtml(snippet)}</span>` : ''}</a>`).join('') || '<span class="hint">Chưa trang nào liên kết tới đây. Viết [[' + escapeHtml(p.title || 'tên trang') + ']] ở trang khác.</span>'}</div>
      ${unl.length ? `<div class="nb-lsec"><h4>Có nhắc tên nhưng chưa liên kết (${unl.length})</h4>${unl.map(({ page, snippet }) => `<div class="nb-lrow nb-unl"><a data-open="${page.id}"><b>${escapeHtml(pageLabel(page))}</b><span class="hint">${escapeHtml(snippet)}</span></a><button class="sm ghost" data-linkify="${page.id}" title="Đổi lần nhắc đầu tiên thành liên kết">Liên kết</button></div>`).join('')}</div>` : ''}
      ${papers.length ? `<div class="nb-lsec"><h4>Paper trong trang (${papers.length})</h4>${papers.map((x) => `<a class="nb-lrow" href="#/paper/${x.id}"><b>📄 ${titleHtml(x.title || '')}</b><span class="hint">${escapeHtml(paperShort(x))}${x.extraction?.one_liner ? ` · ${escapeHtml(x.extraction.one_liner.slice(0, 120))}` : ''}</span></a>`).join('')}</div>` : ''}`;
  }

  /* ---------------- đồng bộ phần viết <-> phần xem (kiểu Overleaf) ---------------- */

  let smap = null; // [{ e: y trong phần viết, p: y trong phần xem }] tại đầu mỗi khối
  let lock = { src: '', until: 0 };
  function setMode(m) {
    mode = m;
    LS('pv.nbMode', mode);
    $('nb-body').className = `nb-body mode-${mode}`;
    $('nb-mode').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.m === mode));
    smap = null;
  }
  const lineOfPos = (v, pos) => { let n = 0; for (let i = 0; i < pos; i++) if (v.charCodeAt(i) === 10) n++; return n; };
  const posOfLine = (v, line) => { let p = 0; for (let n = 0; n < line; n++) { const k = v.indexOf('\n', p); if (k < 0) return v.length; p = k + 1; } return p; };
  const blocks = () => [...($('nb-prev')?.querySelectorAll(':scope > .nb-blk') || [])];
  /** Toạ độ dọc (trong nội dung textarea) của đầu các dòng, đo bằng một bản sao ẩn có cùng phông và bề rộng. */
  function lineYs(ta, lines) {
    const div = document.createElement('div');
    const cs = getComputedStyle(ta);
    for (const k of ['boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontSize', 'lineHeight', 'fontFamily', 'letterSpacing', 'wordSpacing', 'tabSize', 'textTransform', 'textIndent']) div.style[k] = cs[k];
    Object.assign(div.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', wordWrap: 'break-word', overflow: 'hidden', top: '0', left: '-9999px', height: 'auto' });
    const v = ta.value;
    let last = 0;
    const marks = [];
    for (const ln of lines) {
      const pos = posOfLine(v, ln);
      div.appendChild(document.createTextNode(v.slice(last, pos)));
      const sp = document.createElement('span');
      div.appendChild(sp);
      marks.push(sp);
      last = pos;
    }
    div.appendChild(document.createTextNode(v.slice(last) || ' '));
    ta.parentElement.appendChild(div);
    const ys = marks.map((s) => s.offsetTop);
    div.remove();
    return ys;
  }
  function buildMap() {
    const ed = $('nb-ed');
    const pv = $('nb-prev');
    const bl = blocks();
    if (!ed || !pv || !bl.length) return null;
    const ys = lineYs(ed, bl.map((b) => Number(b.dataset.line)));
    const pts = [{ e: 0, p: 0 }];
    bl.forEach((b, i) => {
      const prev = pts[pts.length - 1];
      const e = Math.max(prev.e, ys[i]);
      const p = Math.max(prev.p, b.offsetTop - pv.firstElementChild.offsetTop);
      pts.push({ e, p });
    });
    pts.push({ e: Math.max(pts[pts.length - 1].e, ed.scrollHeight - ed.clientHeight), p: Math.max(pts[pts.length - 1].p, pv.scrollHeight - pv.clientHeight) });
    return pts;
  }
  const interp = (pts, a, b, v) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const x0 = pts[i][a], x1 = pts[i + 1][a];
      if (v <= x1 || i === pts.length - 2) return pts[i][b] + (x1 > x0 ? Math.min(1, Math.max(0, (v - x0) / (x1 - x0))) : 0) * (pts[i + 1][b] - pts[i][b]);
    }
    return 0;
  };
  function syncFrom(src) {
    if (!syncOn || mode !== 'split') return;
    const now = performance.now();
    if (lock.src && lock.src !== src && now < lock.until) return; // cuộn do chính đồng bộ gây ra
    const ed = $('nb-ed');
    const pv = $('nb-prev');
    if (!ed || !pv) return;
    smap ||= buildMap();
    if (!smap) return;
    lock = { src, until: now + 120 };
    if (src === 'ed') pv.scrollTop = interp(smap, 'e', 'p', ed.scrollTop);
    else ed.scrollTop = interp(smap, 'p', 'e', pv.scrollTop);
  }
  const flash = (el) => { if (!el) return; el.classList.remove('nb-flash'); void el.offsetWidth; el.classList.add('nb-flash'); setTimeout(() => el.classList.remove('nb-flash'), 1400); };
  /** ▶ Cuộn phần xem tới khối chứa dòng đang có con trỏ. */
  function goPreview() {
    const ed = $('nb-ed');
    const pv = $('nb-prev');
    if (!ed || !pv) return;
    if (mode !== 'split') setMode('split');
    const line = lineOfPos(ed.value, ed.selectionStart);
    let target = null;
    for (const b of blocks()) { if (Number(b.dataset.line) <= line) target = b; else break; }
    target ||= blocks()[0];
    if (!target) return;
    lock = { src: 'go', until: performance.now() + 700 };
    pv.scrollTop = Math.max(0, target.offsetTop - pv.firstElementChild.offsetTop - 16);
    flash(target);
  }
  /** Khối đang ở đầu vùng nhìn của phần xem. */
  function topBlock() {
    const pv = $('nb-prev');
    const base = pv.firstElementChild?.offsetTop || 0;
    return blocks().find((b) => b.offsetTop - base + b.offsetHeight > pv.scrollTop + 8) || blocks()[0];
  }
  /** ◀ / bấm đúp: đưa con trỏ ở phần viết về đầu khối (hoặc chọn đúng chữ word trong khối), cuộn tới đó. */
  function goEditor(block, word = '') {
    const ed = $('nb-ed');
    if (!ed || !block) return;
    if (mode === 'read') setMode('split');
    const v = ed.value;
    const bl = blocks();
    const i = bl.indexOf(block);
    const s = Number(block.dataset.line);
    const e = i >= 0 && i + 1 < bl.length ? Number(bl[i + 1].dataset.line) : v.split('\n').length;
    const ps = posOfLine(v, s);
    const pe = posOfLine(v, e);
    let a = ps;
    let b = v.indexOf('\n', ps);
    if (b < 0 || b > pe) b = pe;
    if (word) { const k = v.slice(ps, pe).indexOf(word); if (k >= 0) { a = ps + k; b = a + word.length; } }
    ed.focus({ preventScroll: true });
    ed.setSelectionRange(a, b);
    const y = lineYs(ed, [lineOfPos(v, a)])[0];
    lock = { src: 'go', until: performance.now() + 700 };
    ed.scrollTop = Math.max(0, y - ed.clientHeight / 3);
    flash(block);
  }
  window.addEventListener('resize', () => { smap = null; });

  /* ---------------- soạn thảo ---------------- */

  function bindDoc() {
    const ed = $('nb-ed');
    const ti = $('nb-title');
    titleAtFocus = (pageById(cur)?.title || '').trim(); // tên đã chốt: đổi tên thì sửa liên kết ở trang khác theo tên này
    ti.addEventListener('input', () => { markDirty(); });
    ti.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ed.focus(); } });
    const commitTitle = async () => {
      const now = ti.value.trim();
      if (!now || now === titleAtFocus) return;
      const old = titleAtFocus;
      titleAtFocus = now;
      const clash = allPages().find((x) => x.id !== cur && (x.title || '').trim().toLowerCase() === now.toLowerCase());
      if (clash) toast(`Đã có trang khác tên “${now}”. Liên kết [[${now}]] sẽ trỏ tới trang đó; nên đặt tên khác.`, 5000, 'err');
      dirty = true;
      await persist();
      const changed = renameLinks(old, now);
      if (changed.length) { await savePages(changed); toast(`Đã cập nhật liên kết ở ${changed.length} trang.`); }
      drawTree();
      drawCrumbs();
      drawLinks();
    };
    ti.addEventListener('blur', commitTitle);
    ti.addEventListener('change', commitTitle);
    ed.addEventListener('input', () => { markDirty(); previewSoon(); updatePop(); });
    ed.addEventListener('click', updatePop);
    ed.addEventListener('keydown', onEdKey);
    // Dán ảnh (chụp màn hình rồi Ctrl+V, hoặc copy ảnh từ trang web).
    ed.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
      if (!files.length) return;
      e.preventDefault();
      uploadImages(files, ed.selectionStart);
    });
    // Kéo thả file ảnh vào phần viết hoặc phần xem.
    const body = $('nb-body');
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    body.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; body.classList.add('nb-dropping'); });
    body.addEventListener('dragleave', (e) => { if (!body.contains(e.relatedTarget)) body.classList.remove('nb-dropping'); });
    body.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      body.classList.remove('nb-dropping');
      const files = [...e.dataTransfer.files];
      if (!files.some((f) => /^image\//.test(f.type))) return toast('Chỉ thả được file ảnh (PNG, JPEG, GIF, WebP, BMP).', 3500, 'err');
      // Thả vào phần viết: chèn ở chỗ con trỏ; thả vào phần xem: chèn cuối trang.
      uploadImages(files, e.target === ed ? ed.selectionStart : ed.value.length);
    });
    ed.addEventListener('blur', () => setTimeout(() => { if (!$('nb-pop')?.matches(':hover')) closePop(); }, 120));
    $('nb-mode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      setMode(b.dataset.m);
      if (mode !== 'read') ed.focus();
    });
    // Bấm đúp một đoạn ở phần xem: mở phần viết và chọn đúng chữ / dòng đó trong nguồn.
    $('nb-prev').addEventListener('dblclick', (e) => {
      if (e.target.closest('a, button, input, .nb-code-h')) return;
      if (mode === 'read') return; // chế độ Xem: bấm đúp chỉ để chọn chữ như bình thường, không nhảy về phần viết
      const block = e.target.closest('#nb-prev > .nb-blk');
      const word = (window.getSelection()?.toString() || '').trim();
      if (block) goEditor(block, word.length > 1 && !/\s/.test(word) ? word : '');
    });
    $('nb-gutter').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.nbgo === 'prev') goPreview();
      else if (b.dataset.nbgo === 'ed') goEditor(topBlock());
      else if (b.hasAttribute('data-sync')) {
        syncOn = !syncOn;
        LS('pv.nbSync', syncOn ? '1' : '0');
        b.classList.toggle('on', syncOn);
        b.title = syncOn ? 'Đang cuộn đồng bộ hai bên. Bấm để tắt' : 'Bấm để bật cuộn đồng bộ hai bên';
        toast(syncOn ? 'Đã bật cuộn đồng bộ: cuộn một bên, bên kia đi theo.' : 'Đã tắt cuộn đồng bộ: hai bên cuộn độc lập.');
        if (syncOn) syncFrom('ed');
      }
    });
    // Sự kiện cuộn vốn chỉ phát tối đa một lần mỗi khung hình nên đồng bộ thẳng, không cần requestAnimationFrame.
    ed.addEventListener('scroll', () => syncFrom('ed'));
    $('nb-prev').addEventListener('scroll', () => syncFrom('prev'));
    $('nb-prev').addEventListener('change', (e) => {
      const cb = e.target.closest('[data-nb-line]');
      if (!cb) return;
      ed.value = toggleTodo(ed.value, Number(cb.dataset.nbLine));
      markDirty();
      drawPreview();
    });
    $('nb-fav').addEventListener('click', async () => { await persist(); const p = await savePage({ ...pageById(cur), fav: !pageById(cur).fav }); $('nb-fav').textContent = p.fav ? '★' : '☆'; $('nb-fav').classList.toggle('on', !!p.fav); drawTree(); });
    $('nb-icon').addEventListener('click', pickIcon);
    $('nb-help2').addEventListener('click', () => openGuide('md', { insert: insertSnippet }));
    $('nb-more').addEventListener('click', (e) => { e.stopPropagation(); $('nb-menu').hidden = !$('nb-menu').hidden; });
    $('nb-menu').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) { $('nb-menu').hidden = true; pageAction(b.dataset.act); } });
    $('nb-links').addEventListener('click', async (e) => {
      const lk = e.target.closest('[data-linkify]');
      if (!lk) return;
      const other = pageById(lk.dataset.linkify);
      const name = ($('nb-title').value || '').trim();
      const re = new RegExp(`(?<!\\[\\[)(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
      if (!other || !re.test(other.content)) return;
      await savePage({ ...other, content: other.content.replace(re, (m) => `[[${name}${m === name ? '' : `|${m}`}]]`) });
      toast(`Đã liên kết trong “${other.title}”.`);
      drawLinks();
    });
  }

  async function pickIcon() {
    const p = pageById(cur);
    const v = await dialog({
      title: 'Biểu tượng trang', width: 420,
      body: `<div class="nb-emojis">${EMOJIS.map((x) => `<button type="button" data-emo="${x}">${x}</button>`).join('')}</div><label class="field" style="margin-top:10px"><span class="label-text">Hoặc gõ / dán một emoji</span><input id="nb-emo-in" maxlength="4" value="${escapeHtml(p.icon || '')}"></label>`,
      buttons: [{ label: 'Bỏ biểu tượng', value: '' }, { label: 'Huỷ', value: null }, { label: 'Dùng', primary: true, onClick: (b, close) => { close(b.querySelector('#nb-emo-in').value.trim()); return false; } }],
      onOpen: (body, close) => body.addEventListener('click', (e) => { const b = e.target.closest('[data-emo]'); if (b) close(b.dataset.emo); }),
    });
    if (v === null || v === undefined) return;
    await persist();
    await savePage({ ...pageById(cur), icon: v });
    $('nb-icon').innerHTML = v ? escapeHtml(v) : '<span class="hint">＋</span>';
    drawTree();
    drawCrumbs();
  }

  async function pageAction(act) {
    await persist();
    const p = pageById(cur);
    if (!p) return;
    if (act === 'child') { collapsed.delete(p.id); return createFromTemplate({ parentId: p.id }); }
    if (act === 'dup') return createPage({ ...p, id: undefined, title: `${p.title || 'Không tên'} (bản sao)`, fav: false, createdAt: undefined });
    if (act === 'copy') { await copyText(p.content || ''); return toast('Đã copy Markdown.'); }
    if (act === 'md') return download(`${(p.title || 'trang').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'trang'}.md`, `# ${p.title || ''}\n\n${p.content || ''}`, 'text/markdown;charset=utf-8');
    if (act === 'move') {
      const opts = allPages().filter((x) => x.id !== p.id && !isInside(x, p)).sort(byTitle);
      const to = await dialog({
        title: `Di chuyển “${p.title || 'Không tên'}”`, width: 460,
        body: `<label class="field"><span class="label-text">Trang cha mới</span><select id="nb-move-to"><option value="">— Ngoài cùng —</option>${opts.map((x) => `<option value="${x.id}" ${x.id === p.parentId ? 'selected' : ''}>${escapeHtml(pageLabel(x))}</option>`).join('')}</select></label>`,
        buttons: [{ label: 'Huỷ', value: null }, { label: 'Di chuyển', primary: true, onClick: (b, close) => { close({ id: b.querySelector('#nb-move-to').value }); return false; } }],
      });
      if (!to) return;
      await savePage({ ...p, parentId: to.id || null });
      drawTree(); drawCrumbs();
      return;
    }
    if (act === 'del') {
      const subtree = allPages().filter((x) => isInside(x, p));
      if (!(await confirmDialog(`Đưa “${p.title || 'Không tên'}”${subtree.length > 1 ? ` và ${subtree.length - 1} trang con` : ''} vào thùng rác? Có thể khôi phục ở cuối thanh bên.`, { okLabel: 'Đưa vào thùng rác' }))) return;
      const at = new Date().toISOString();
      await savePages(subtree.map((x) => ({ ...x, deleted: true, deletedAt: at, trashedWith: p.id })));
      cur = null;
      history.pushState(null, '', p.parentId && pageById(p.parentId) ? `#/notebook/${p.parentId}` : '#/notebook');
      cur = p.parentId && pageById(p.parentId) && !pageById(p.parentId).deleted ? p.parentId : null;
      drawTree(); drawMain();
    }
  }

  // Bấm liên kết trong phần xem / liên kết ngược / đường dẫn.
  $('nb-main').addEventListener('click', async (e) => {
    if (!e.target.closest('#nb-menu') && !e.target.closest('#nb-more') && $('nb-menu')) $('nb-menu').hidden = true;
    const home = e.target.closest('[data-open-home]');
    if (home) return openPage(null);
    const tpl = e.target.closest('[data-home-tpl]');
    if (tpl) return tpl.dataset.homeTpl === 'daily' ? openDaily() : createFromTemplate({ tplId: tpl.dataset.homeTpl });
    if (e.target.closest('[data-home-new]')) return createFromTemplate();
    if (e.target.closest('[data-home-daily]')) return openDaily();
    const gd = e.target.closest('[data-guide]');
    if (gd) return openGuide(gd.dataset.guide, { insert: $('nb-ed') ? insertSnippet : null });
    if (e.target.closest('[data-mathlib]')) return mathLibraryDialog();
    const qe = e.target.closest('[data-nb-q]');
    if (qe) { e.preventDefault(); return editQueryBlock(Number(qe.dataset.nbQ)); }
    const cp = e.target.closest('.nb-code-copy');
    if (cp) { await copyText(cp.closest('.nb-code').querySelector('pre').innerText); return toast('Đã copy code.'); }
    const im = e.target.closest('#nb-prev img.nb-img');
    if (im) return openLightbox(im.src, im.alt);
    const pg = e.target.closest('[data-nb-page], [data-open]');
    if (pg && !e.target.closest('[data-linkify]')) { e.preventDefault(); return openPage(pg.dataset.nbPage || pg.dataset.open); }
    const nw = e.target.closest('[data-nb-new]');
    if (nw) { e.preventDefault(); return createPage({ title: nw.textContent.trim() === nw.dataset.nbNew ? nw.dataset.nbNew : nw.dataset.nbNew, parentId: null }); }
    const tg = e.target.closest('[data-nb-tag]');
    if (tg) { $('nb-search').value = `#${tg.dataset.nbTag}`; drawTree(); }
  });

  /* ---------------- gợi ý khi gõ: [[ liên kết, / khối ---------------- */

  const SLASH = [
    { k: 'h1', label: 'Tiêu đề 1', kw: 'heading tieu de h1', ins: '# ' },
    { k: 'h2', label: 'Tiêu đề 2', kw: 'heading tieu de h2', ins: '## ' },
    { k: 'h3', label: 'Tiêu đề 3', kw: 'heading tieu de h3', ins: '### ' },
    { k: 'todo', label: 'Việc cần làm', kw: 'todo viec checkbox', ins: '- [ ] ' },
    { k: 'ul', label: 'Danh sách', kw: 'list danh sach bullet', ins: '- ' },
    { k: 'ol', label: 'Danh sách đánh số', kw: 'number danh sach so', ins: '1. ' },
    { k: 'quote', label: 'Trích dẫn', kw: 'quote trich dan', ins: '> ' },
    { k: 'note', label: 'Callout ghi chú', kw: 'callout note ghi chu', ins: '> [!note] ' },
    { k: 'idea', label: 'Callout ý tưởng', kw: 'callout idea y tuong', ins: '> [!idea] ' },
    { k: 'warn', label: 'Callout lưu ý', kw: 'callout warning luu y canh bao', ins: '> [!warning] ' },
    { k: 'q', label: 'Callout câu hỏi', kw: 'callout question cau hoi', ins: '> [!question] ' },
    { k: 'table', label: 'Bảng', kw: 'table bang', ins: '| Cột 1 | Cột 2 |\n| --- | --- |\n|  |  |\n' },
    { k: 'code', label: 'Khối code (chọn ngôn ngữ)…', kw: 'code python cpp c++ java javascript rust go sql bash', dialog: 'code' },
    { k: 'math', label: 'Công thức LaTeX đứng riêng…', kw: 'math cong thuc latex katex', dialog: 'math' },
    { k: 'imath', label: 'Công thức LaTeX cùng dòng…', kw: 'math inline cong thuc latex', dialog: 'imath' },
    { k: 'img', label: 'Ảnh từ máy…', kw: 'anh hinh image picture upload tai len', dialog: 'img' },
    { k: 'imgurl', label: 'Ảnh từ đường link…', kw: 'anh hinh image url link', dialog: 'imgurl' },
    { k: 'hr', label: 'Đường kẻ', kw: 'divider duong ke hr', ins: '---\n' },
    { k: 'page', label: 'Liên kết trang', kw: 'link lien ket trang page', ins: '[[', reopen: true },
    { k: 'paper', label: 'Nhắc tới paper', kw: 'paper lien ket bai', ins: '[[@', reopen: true },
    { k: 'embed', label: 'Nhúng thẻ paper', kw: 'embed nhung paper the', ins: '![[@', reopen: true },
    { k: 'query', label: 'Bảng paper từ thư viện…', kw: 'database bang paper query thu vien', dialog: 'query' },
    { k: 'date', label: 'Ngày hôm nay', kw: 'date ngay hom nay', ins: () => localDate() },
    { k: 'due', label: 'Hạn chót 📅 (hiện trên Lịch)', kw: 'han chot deadline due lich calendar ngay', ins: () => ` 📅 ${localDate()}` },
    { k: 'sub', label: 'Trang con mới', kw: 'subpage trang con', sub: true },
  ];
  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  let pop = null; // { kind, start, items, i }

  function caretXY(ta, pos) {
    const div = document.createElement('div');
    const cs = getComputedStyle(ta);
    for (const k of ['boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontSize', 'lineHeight', 'fontFamily', 'letterSpacing', 'wordSpacing', 'tabSize', 'textTransform', 'textIndent']) div.style[k] = cs[k];
    Object.assign(div.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', wordWrap: 'break-word', overflow: 'hidden', top: '0', left: '-9999px' });
    div.textContent = ta.value.slice(0, pos);
    const span = document.createElement('span');
    span.textContent = ta.value.slice(pos) || '.';
    div.appendChild(span);
    ta.parentElement.appendChild(div);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    const xy = { x: span.offsetLeft - ta.scrollLeft + ta.offsetLeft, y: span.offsetTop - ta.scrollTop + ta.offsetTop + lh };
    div.remove();
    return xy;
  }

  function updatePop() {
    const ed = $('nb-ed');
    if (!ed) return;
    const pos = ed.selectionStart;
    if (pos !== ed.selectionEnd) return closePop();
    const before = ed.value.slice(0, pos);
    let m = /\[\[([^\]\n[]*)$/.exec(before);
    if (m) {
      const q = m[1];
      const qq = fold(q.replace(/^@/, ''));
      const items = [];
      if (!q.startsWith('@')) {
        for (const p of allPages().filter((x) => x.id !== cur && fold(x.title).includes(qq)).slice(0, 7)) items.push({ type: 'page', p, label: pageLabel(p) });
      }
      for (const p of store.papers.filter((x) => !x.deleted && (fold(x.title).includes(qq) || fold(paperShort(x)).includes(qq))).slice(0, q.startsWith('@') ? 12 : 5)) items.push({ type: 'paper', p, label: `📄 ${plainTitle(p.title)}`, sub: paperShort(p) });
      if (q.trim() && !q.startsWith('@') && !pageByTitle(q)) items.push({ type: 'new', title: q.trim(), label: `＋ Tạo trang “${q.trim()}”` });
      return showPop({ kind: 'link', start: pos - m[0].length, items });
    }
    m = /(^|\s)\/([\p{L}\p{N} ]{0,24})$/u.exec(before);
    if (m && !/\s{2}$/.test(m[2])) {
      const q = fold(m[2]);
      const items = SLASH.filter((s) => !q || fold(s.label).includes(q) || s.kw.includes(q)).map((s) => ({ type: 'slash', s, label: s.label }));
      return showPop({ kind: 'slash', start: pos - m[2].length - 1, items });
    }
    closePop();
  }

  function showPop(state) {
    const box = $('nb-pop');
    if (!state.items.length) return closePop();
    pop = { ...state, i: Math.min(pop?.kind === state.kind ? pop.i : 0, state.items.length - 1) };
    box.innerHTML = `<div class="nb-pop-h hint">${state.kind === 'slash' ? 'Chèn khối' : 'Liên kết · ↑↓ chọn · Enter chèn · Esc đóng'}</div>${state.items.map((it, i) => `<button type="button" class="nb-pop-i ${i === pop.i ? 'on' : ''}" data-i="${i}"><span>${escapeHtml(it.label)}</span>${it.sub ? `<span class="hint">${escapeHtml(it.sub)}</span>` : ''}</button>`).join('')}`;
    const ed = $('nb-ed');
    const xy = caretXY(ed, ed.selectionStart);
    box.hidden = false;
    const maxX = ed.offsetLeft + ed.clientWidth - box.offsetWidth - 6;
    box.style.left = `${Math.max(ed.offsetLeft + 4, Math.min(maxX, xy.x))}px`;
    box.style.top = `${xy.y + 4}px`;
    box.querySelector('.nb-pop-i.on')?.scrollIntoView({ block: 'nearest' });
  }
  function closePop() { pop = null; const b = $('nb-pop'); if (b) b.hidden = true; }
  // Chọn bằng chuột: mousedown để textarea không mất con trỏ trước khi chèn.
  $('nb-main').addEventListener('mousedown', (e) => {
    const b = e.target.closest('.nb-pop-i');
    if (!b || !pop) return;
    e.preventDefault();
    pop.i = Number(b.dataset.i);
    choosePop();
  });

  /* ---------- ảnh ---------- */
  const imgAlt = (f) => { const n = String(f.name || '').replace(/\.[^.]+$/, '').trim(); return !n || /^(image|screenshot|ảnh chụp|clipboard)/i.test(n) ? 'ảnh' : n.replace(/[[\]|]/g, ' '); };
  /** Tải các file ảnh lên rồi chèn ![tên](link) vào phần viết từ vị trí pos, mỗi ảnh một dòng. */
  async function uploadImages(files, pos) {
    const ed = $('nb-ed');
    if (!ed) return;
    if (mode === 'read') setMode('split');
    const list = [...files].filter((f) => /^image\//.test(f.type));
    let at = Math.max(0, Math.min(pos ?? ed.selectionStart, ed.value.length));
    let done = 0;
    for (const f of list) {
      const mark = `![Đang tải ${imgAlt(f)}…](uploading-${Date.now()}-${done})`;
      insertAt(at, mark);
      try {
        const r = await api.uploadImage(f, f.name || 'image.png');
        const md = `![${imgAlt(f)}](${r.url})`;
        const v = ed.value;
        const k = v.indexOf(mark);
        if (k >= 0) { ed.value = v.slice(0, k) + md + v.slice(k + mark.length); at = k + md.length; }
        done++;
      } catch (err) {
        const k = ed.value.indexOf(mark);
        if (k >= 0) ed.value = ed.value.slice(0, k) + ed.value.slice(k + mark.length);
        toast(`Không tải được ảnh ${f.name || ''}: ${err.message}`, 5000, 'err');
      }
      markDirty();
      drawPreview();
    }
    if (done) toast(done > 1 ? `Đã chèn ${done} ảnh.` : 'Đã chèn ảnh. Đổi độ rộng: ![mô tả|400](…) hoặc ![mô tả|50%](…).', 4500);
  }
  function pickImages() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';
    inp.multiple = true;
    inp.onchange = () => { if (inp.files?.length) uploadImages(inp.files, $('nb-ed')?.selectionStart); };
    inp.click();
  }
  function openLightbox(src, alt) {
    const ov = document.createElement('div');
    ov.className = 'nb-lightbox';
    ov.innerHTML = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt || '')}">${alt ? `<div class="nb-lb-cap">${escapeHtml(alt)}</div>` : ''}<div class="nb-lb-hint">Bấm ra ngoài hoặc Esc để đóng</div>`;
    const close = () => { ov.remove(); document.removeEventListener('keydown', onEsc, true); };
    const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    ov.addEventListener('click', close);
    document.addEventListener('keydown', onEsc, true);
    document.body.appendChild(ov);
  }

  /** Chèn text vào trình soạn thảo ở vị trí pos; khối (code, bảng, công thức đứng riêng) luôn nằm trên dòng riêng. */
  function insertAt(pos, text, { block = true } = {}) {
    const ed = $('nb-ed');
    if (!ed) return;
    const v = ed.value;
    const before = block && pos > 0 && v[pos - 1] !== '\n' ? '\n' : '';
    const after = block && v[pos] !== '\n' ? '\n' : '';
    ed.value = v.slice(0, pos) + before + text + after + v.slice(pos);
    const at = pos + before.length + text.length + after.length;
    ed.focus();
    ed.setSelectionRange(at, at);
    markDirty();
    drawPreview();
  }
  function insertSnippet(text) {
    const ed = $('nb-ed');
    if (!ed) return;
    if (mode === 'read') setMode('split');
    insertAt(ed.selectionStart ?? ed.value.length, text, { block: /\n/.test(text) });
  }
  /** Mở trình dựng bảng cho khối ```papers thứ idx (đếm ở cấp ngoài cùng) rồi thay khối đó bằng bản mới. */
  async function editQueryBlock(idx) {
    const ed = $('nb-ed');
    if (!ed) return;
    const lines = ed.value.split('\n');
    let n = -1;
    let s = -1;
    for (let i = 0; i < lines.length; i++) if (/^\s*```papers\s*$/.test(lines[i]) && ++n === idx) { s = i; break; }
    if (s < 0) return;
    let e = s + 1;
    while (e < lines.length && !/^\s*```\s*$/.test(lines[e])) e++;
    const src = await paperQueryBuilder(lines.slice(s + 1, e).join('\n'));
    if (src == null) return;
    lines.splice(s, e - s + 1, '```papers', ...(src ? src.split('\n') : []), '```');
    ed.value = lines.join('\n');
    markDirty();
    drawPreview();
    toast('Đã cập nhật bảng.');
  }

  async function choosePop() {
    const ed = $('nb-ed');
    if (!pop || !ed) return;
    const it = pop.items[pop.i];
    const pos = ed.selectionStart;
    const v = ed.value;
    let ins = '';
    let caret = null;
    let reopen = false;
    let end = pos;
    if (pop.kind === 'link') {
      if (v.slice(pos, pos + 2) === ']]') end = pos + 2;
      if (it.type === 'page') ins = `[[${it.p.title}]]`;
      else if (it.type === 'paper') ins = `[[@${it.p.id}|${paperShort(it.p)}]]`;
      else if (it.type === 'new') { const np = await savePage(newPage({ title: it.title, parentId: null })); ins = `[[${np.title}]]`; drawTree(); toast(`Đã tạo trang “${np.title}”.`); }
    } else {
      const s = it.s;
      if (s.dialog) {
        // Bỏ chữ "/…" đã gõ, mở hộp thoại, rồi chèn kết quả vào đúng chỗ đó.
        const at0 = pop.start;
        ed.value = v.slice(0, at0) + v.slice(end);
        closePop();
        markDirty();
        let txt = null;
        if (s.dialog === 'code') txt = await codeDialog();
        else if (s.dialog === 'query') { const src = await paperQueryBuilder(''); txt = src == null ? null : `\`\`\`papers\n${src}\n\`\`\``; }
        else if (s.dialog === 'img') { ed.focus(); ed.setSelectionRange(at0, at0); pickImages(); return; }
        else if (s.dialog === 'imgurl') txt = await imageUrlDialog();
        else txt = await formulaDialog({ display: s.dialog === 'math', onLibrary: mathLibraryDialog });
        if (txt) insertAt(at0, txt, { block: s.dialog !== 'imath' });
        else { ed.focus(); ed.setSelectionRange(at0, at0); }
        return;
      }
      if (s.sub) {
        const np = await savePage(newPage({ title: 'Trang con mới', parentId: cur }));
        ins = `[[${np.title}]]`;
        drawTree();
      } else {
        ins = typeof s.ins === 'function' ? s.ins() : s.ins;
        if (s.caret != null) caret = s.caret;
        reopen = !!s.reopen;
      }
    }
    ed.value = v.slice(0, pop.start) + ins + v.slice(end);
    const at = pop.start + (caret != null ? caret : ins.length);
    ed.setSelectionRange(at, at);
    ed.focus();
    closePop();
    markDirty();
    drawPreview();
    if (reopen) updatePop();
  }

  function onEdKey(e) {
    const ed = e.currentTarget;
    if (pop) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); pop.i = (pop.i + (e.key === 'ArrowDown' ? 1 : -1) + pop.items.length) % pop.items.length; showPop(pop); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choosePop(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); return; }
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); dirty = true; persist(); return; }
    if (mod && (e.key === 'b' || e.key === 'i')) {
      e.preventDefault();
      const mark = e.key === 'b' ? '**' : '*';
      const a = ed.selectionStart, b = ed.selectionEnd;
      ed.setRangeText(`${mark}${ed.value.slice(a, b)}${mark}`, a, b, 'end');
      if (a === b) ed.setSelectionRange(a + mark.length, a + mark.length);
      markDirty(); previewSoon();
      return;
    }
    const pos = ed.selectionStart;
    const ls = ed.value.lastIndexOf('\n', pos - 1) + 1;
    const line = ed.value.slice(ls, pos);
    if (e.key === 'Tab' && ed.selectionStart === ed.selectionEnd) {
      e.preventDefault();
      if (/^\s*([-*] |\d+\. )/.test(ed.value.slice(ls))) {
        if (e.shiftKey) { const n = (ed.value.slice(ls).match(/^ {1,2}/) || [''])[0].length; if (n) { ed.setRangeText('', ls, ls + n, 'preserve'); ed.setSelectionRange(pos - n, pos - n); } } else { ed.setRangeText('  ', ls, ls, 'preserve'); ed.setSelectionRange(pos + 2, pos + 2); }
      } else if (!e.shiftKey) ed.setRangeText('  ', pos, pos, 'end');
      markDirty(); previewSoon();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && ed.selectionStart === ed.selectionEnd) {
      const m = /^(\s*)([-*] \[[ xX]\] |[-*] |(\d+)\. |> )(.*)$/.exec(line);
      if (!m) return;
      e.preventDefault();
      if (!m[4].trim() && pos === ls + line.length) { ed.setRangeText(m[1], ls, pos, 'end'); markDirty(); previewSoon(); return; } // dòng chỉ có ký hiệu: thoát danh sách
      const next = m[2].startsWith('- [') || m[2].startsWith('* [') ? '- [ ] ' : m[3] ? `${Number(m[3]) + 1}. ` : m[2];
      ed.setRangeText(`\n${m[1]}${next}`, pos, pos, 'end');
      markDirty(); previewSoon();
    }
  }

  /* ---------------- tìm nhanh (Ctrl+K) ---------------- */

  async function quickSwitch() {
    const id = await dialog({
      title: 'Mở trang', width: 560,
      body: '<input type="search" id="nb-qs" placeholder="Gõ tên trang…" autofocus><div id="nb-qs-list" class="nb-qs-list"></div>',
      buttons: [{ label: 'Đóng', value: null }],
      onOpen: (body, close) => {
        const input = body.querySelector('#nb-qs');
        let sel = 0;
        let list = [];
        const draw = () => {
          const q = fold(input.value);
          list = allPages().filter((p) => !q || fold(p.title).includes(q)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 30);
          sel = Math.min(sel, Math.max(0, list.length - 1));
          body.querySelector('#nb-qs-list').innerHTML = list.map((p, i) => `<button type="button" class="nb-pop-i ${i === sel ? 'on' : ''}" data-id="${p.id}"><span>${escapeHtml(pageLabel(p))}</span><span class="hint">${escapeHtml(ancestors(p).map((a) => a.title).join(' / '))}</span></button>`).join('') || `<div class="hint" style="padding:8px">Không có. Enter để tạo trang “${escapeHtml(input.value)}”.</div>`;
        };
        input.addEventListener('input', () => { sel = 0; draw(); });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + Math.max(1, list.length)) % Math.max(1, list.length); draw(); }
          if (e.key === 'Enter') { e.preventDefault(); close(list[sel]?.id || (input.value.trim() ? { create: input.value.trim() } : null)); }
        });
        body.querySelector('#nb-qs-list').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) close(b.dataset.id); });
        draw();
        setTimeout(() => input.focus(), 30);
      },
    });
    if (!id) return;
    if (typeof id === 'object') return createPage({ title: id.create });
    openPage(id);
  }

  /* ---------------- đồ thị liên kết ---------------- */

  function openNoteGraph() {
    const ov = document.createElement('div');
    ov.className = 'nbg-overlay';
    ov.innerHTML = `<div class="nbg-top"><b>🕸 Đồ thị sổ tay</b><span class="hint" id="nbg-stats"></span><span class="spacer"></span>
      <label class="hint"><input type="checkbox" id="nbg-papers" checked> Hiện paper</label>
      <label class="hint"><input type="checkbox" id="nbg-orph"> Ẩn trang không liên kết</label>
      <button class="sm" id="nbg-close" title="Esc bỏ chọn">Đóng (Shift + Esc)</button></div>
      <div class="nbg-body"><canvas id="nbg-cv"></canvas><div class="nbg-info" id="nbg-info" hidden></div></div>
      <div class="hint nbg-help">Esc bỏ chọn · Shift + Esc đóng · kéo nền để dời · cuộn để phóng to · bấm một nút để xem, bấm đúp để mở · <span style="color:var(--accent)">●</span> trang · <span style="color:#ea580c">●</span> paper</div>`;
    document.body.appendChild(ov);
    const cv = ov.querySelector('#nbg-cv');
    const ctx = cv.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    const T = { k: 1, x: 0, y: 0 };
    let N = [], E = [], sel = null, hov = null, alpha = 1, raf = 0, auto = true;
    const build = () => {
      const showPapers = ov.querySelector('#nbg-papers').checked;
      const hideOrph = ov.querySelector('#nbg-orph').checked;
      const old = new Map(N.map((n) => [n.key, n]));
      const nodes = new Map();
      const edges = [];
      const add = (key, o) => { if (!nodes.has(key)) { const prev = old.get(key); nodes.set(key, { key, ...o, x: prev?.x ?? (Math.random() - 0.5) * 400, y: prev?.y ?? (Math.random() - 0.5) * 400, vx: 0, vy: 0, deg: 0 }); } return nodes.get(key); };
      for (const p of allPages()) add(`p:${p.id}`, { kind: 'page', id: p.id, label: pageLabel(p) });
      for (const p of allPages()) {
        const links = parseLinks(p.content);
        for (const t of links.pages) { const q = pageByTitle(t); if (q && q.id !== p.id) edges.push([`p:${p.id}`, `p:${q.id}`]); }
        if (showPapers) for (const id of links.papers) { const x = paperById(id); if (x) { add(`x:${id}`, { kind: 'paper', id, label: paperShort(x), title: plainTitle(x.title) }); edges.push([`p:${p.id}`, `x:${id}`]); } }
        if (p.parentId && pageById(p.parentId) && !pageById(p.parentId).deleted) edges.push([`p:${p.parentId}`, `p:${p.id}`, 'tree']);
      }
      const E2 = edges.filter(([a, b]) => nodes.has(a) && nodes.has(b)).map(([a, b, k]) => ({ a: nodes.get(a), b: nodes.get(b), tree: k === 'tree' }));
      for (const e of E2) { e.a.deg++; e.b.deg++; }
      N = [...nodes.values()].filter((n) => !hideOrph || n.deg > 0);
      const keep = new Set(N);
      E = E2.filter((e) => keep.has(e.a) && keep.has(e.b));
      ov.querySelector('#nbg-stats').textContent = ` · ${N.filter((n) => n.kind === 'page').length} trang · ${N.filter((n) => n.kind === 'paper').length} paper · ${E.length} liên kết`;
      alpha = 1; auto = true; kick();
    };
    const R = (n) => 4 + Math.min(10, Math.sqrt(n.deg) * 2.2) + (n.kind === 'page' && n.id === cur ? 3 : 0);
    const tick = () => {
      for (let i = 0; i < N.length; i++) {
        const a = N[i];
        for (let j = i + 1; j < N.length; j++) {
          const b = N[j];
          let dx = b.x - a.x, dy = b.y - a.y; let d2 = dx * dx + dy * dy; if (d2 < 1) { dx = Math.random(); dy = Math.random(); d2 = 1; }
          const d = Math.sqrt(d2), f = (900 * alpha) / d2;
          a.vx -= (dx / d) * f; a.vy -= (dy / d) * f; b.vx += (dx / d) * f; b.vy += (dy / d) * f;
        }
      }
      for (const e of E) {
        const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.hypot(dx, dy) || 1, f = (d - (e.tree ? 50 : 80)) * 0.06 * alpha;
        e.a.vx += (dx / d) * f; e.a.vy += (dy / d) * f; e.b.vx -= (dx / d) * f; e.b.vy -= (dy / d) * f;
      }
      for (const n of N) { if (n === drag?.n) continue; n.vx -= n.x * 0.01 * alpha; n.vy -= n.y * 0.01 * alpha; n.vx *= 0.55; n.vy *= 0.55; n.x += n.vx; n.y += n.vy; }
      alpha *= 0.985;
    };
    const fit = () => {
      if (!N.length) return;
      const xs = N.map((n) => n.x), ys = N.map((n) => n.y);
      const x0 = Math.min(...xs) - 40, x1 = Math.max(...xs) + 40, y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 40;
      T.k = Math.max(0.15, Math.min(2.5, Math.min(W / (x1 - x0 || 1), H / (y1 - y0 || 1))));
      T.x = (W - (x1 - x0) * T.k) / 2 - x0 * T.k; T.y = (H - (y1 - y0) * T.k) / 2 - y0 * T.k;
    };
    const css = (v, f) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || f;
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const focus = sel || hov;
      const nb = new Set(); if (focus) for (const e of E) { if (e.a === focus) nb.add(e.b); if (e.b === focus) nb.add(e.a); }
      const accent = css('--accent', '#4f46e5'), muted = css('--muted', '#888'), text = css('--text', '#111');
      for (const e of E) {
        const on = focus && (e.a === focus || e.b === focus);
        ctx.strokeStyle = on ? accent : muted; ctx.globalAlpha = on ? 0.9 : focus ? 0.06 : (e.tree ? 0.18 : 0.35); ctx.lineWidth = on ? 1.6 : 1;
        ctx.setLineDash(e.tree ? [3, 3] : []);
        ctx.beginPath(); ctx.moveTo(e.a.x * T.k + T.x, e.a.y * T.k + T.y); ctx.lineTo(e.b.x * T.k + T.x, e.b.y * T.k + T.y); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center';
      for (const n of N) {
        const x = n.x * T.k + T.x, y = n.y * T.k + T.y, r = R(n);
        const dim = focus && n !== focus && !nb.has(n);
        ctx.globalAlpha = dim ? 0.25 : 1;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = n.kind === 'paper' ? '#ea580c' : accent; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(15,23,42,.35)'; ctx.stroke();
        if (n.kind === 'page' && n.id === cur) { ctx.lineWidth = 3; ctx.strokeStyle = text; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke(); }
        if (n === sel || n === hov) { ctx.lineWidth = 2.5; ctx.strokeStyle = accent; ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke(); }
        if (!dim && (T.k > 0.7 || n === focus || nb.has(n) || n.deg >= 3)) {
          const lb = n.label.length > 34 ? `${n.label.slice(0, 33)}…` : n.label;
          ctx.lineWidth = 3; ctx.strokeStyle = css('--bg', '#fff'); ctx.strokeText(lb, x, y + r + 12); ctx.fillStyle = text; ctx.fillText(lb, x, y + r + 12);
        }
      }
      ctx.globalAlpha = 1;
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const frame = () => { raf = 0; if (alpha > 0.02) { tick(); tick(); if (auto) fit(); kick(); } draw(); };
    const resize = () => { const b = ov.querySelector('.nbg-body'); dpr = devicePixelRatio || 1; W = b.clientWidth; H = b.clientHeight; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = `${W}px`; cv.style.height = `${H}px`; draw(); };
    const pt = (e) => { const r = cv.getBoundingClientRect(); const s = r.width / (W || 1); return [(e.clientX - r.left) / s, (e.clientY - r.top) / s]; };
    const pick = (mx, my) => N.find((n) => Math.hypot(n.x * T.k + T.x - mx, n.y * T.k + T.y - my) < R(n) + 4) || null;
    let drag = null;
    const info = (n) => {
      const box = ov.querySelector('#nbg-info');
      if (!n) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = `<b>${n.kind === 'paper' ? '📄 ' : ''}${escapeHtml(n.kind === 'paper' ? n.title : n.label)}</b><div class="hint">${n.deg} liên kết</div><button class="sm primary" id="nbg-open">${n.kind === 'paper' ? 'Mở paper' : 'Mở trang'}</button>`;
      box.querySelector('#nbg-open').onclick = () => openNode(n);
    };
    const openNode = (n) => { close(); if (n.kind === 'paper') location.hash = `#/paper/${n.id}`; else openPage(n.id); };
    cv.addEventListener('pointerdown', (e) => { const [mx, my] = pt(e); const n = pick(mx, my); cv.setPointerCapture(e.pointerId); drag = { n, mx, my, tx: T.x, ty: T.y, moved: false }; });
    cv.addEventListener('pointermove', (e) => {
      const [mx, my] = pt(e);
      if (drag) {
        if (Math.abs(mx - drag.mx) + Math.abs(my - drag.my) > 3) drag.moved = true;
        if (!drag.moved) return;
        auto = false;
        if (drag.n) { drag.n.x = (mx - T.x) / T.k; drag.n.y = (my - T.y) / T.k; alpha = Math.max(alpha, 0.2); kick(); } else { T.x = drag.tx + mx - drag.mx; T.y = drag.ty + my - drag.my; draw(); }
        return;
      }
      const n = pick(mx, my); if (n !== hov) { hov = n; cv.style.cursor = n ? 'pointer' : 'grab'; draw(); }
    });
    cv.addEventListener('pointerup', () => { if (drag && !drag.moved) { sel = drag.n; info(sel); draw(); } drag = null; });
    cv.addEventListener('dblclick', (e) => { const [mx, my] = pt(e); const n = pick(mx, my); if (n) openNode(n); });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); auto = false; const [mx, my] = pt(e); const k = Math.max(0.1, Math.min(5, T.k * Math.exp(-e.deltaY * 0.0015))); T.x = mx - ((mx - T.x) / T.k) * k; T.y = my - ((my - T.y) / T.k) * k; T.k = k; draw(); }, { passive: false });
    const onKey = (e) => { if (e.key !== 'Escape') return; e.stopPropagation(); e.preventDefault(); if (e.shiftKey && !e.ctrlKey && !e.altKey) close(); else { sel = null; info(null); draw(); } };
    const close = () => { cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', resize); ov.remove(); };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', resize);
    ov.querySelector('#nbg-close').addEventListener('click', close);
    ov.querySelector('#nbg-papers').addEventListener('change', build);
    ov.querySelector('#nbg-orph').addEventListener('change', build);
    resize();
    build();
    const me = N.find((n) => n.kind === 'page' && n.id === cur);
    if (me) { sel = me; info(me); }
  }

  /* ---------------- phím tắt của trang + dọn dẹp ---------------- */

  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); quickSwitch(); }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); openGuide('md', { insert: $('nb-ed') ? insertSnippet : null }); }
  };
  document.addEventListener('keydown', onKey);
  // Nút Quay lại của trình duyệt đổi hash nên bộ định tuyến của app tự dựng lại trang với đúng trang con.
  // Trang thay đổi (tạo, xoá, khôi phục, đổi tên…): vẽ lại cây, trang chủ (Sửa gần đây) và rời trang đang mở nếu nó vừa bị xoá.
  const unsub = onPagesChange(() => {
    if (!$('nb-tree')) return;
    drawTree();
    if (cur && !allPages().some((p) => p.id === cur)) { cur = null; dirty = false; history.replaceState(null, '', '#/notebook'); drawMain(); }
    else if (!cur && $('nb-main').querySelector('.nb-home')) drawHome();
  });
  const onUnload = () => { if (dirty) persist(); };
  window.addEventListener('beforeunload', onUnload);

  drawTree();
  const startId = params[0] ? decodeURIComponent(params[0]) : null;
  if (query.get('new') === 'paper' && query.get('paper')) {
    const p = paperById(query.get('paper'));
    const tpl = TEMPLATES.find((x) => x.id === 'paper').make(p);
    history.replaceState(null, '', '#/notebook');
    await createPage({ icon: '📑', ...tpl });
  } else await openPage(startId, { push: false });

  return () => {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', onUnload);
    unsub();
    if (dirty) persist();
  };
}
