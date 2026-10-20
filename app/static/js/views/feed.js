// Theo dõi paper mới trên arXiv theo từ khoá + danh mục; lưu các "watch" trong kv, đánh dấu đã xem.
import { api } from '../api.js';
import { store, findDuplicate } from '../store.js';
import { escapeHtml, fmtRelative, uid } from '../util.js';
import { $, toast, dialog, confirmDialog, spinner, showProgress, setStatus, selectAllHtml, syncSelectAll } from '../ui.js';
import { scanWatch, WATCH_TYPES } from '../watches.js';
import { titleHtml } from '../richtext.js';

const CATS = ['cs.CV', 'cs.CL', 'cs.LG', 'cs.AI', 'cs.IR', 'cs.MM', 'cs.RO', 'cs.SD', 'eess.AS', 'eess.IV', 'stat.ML'];
const state = { watches: [], seen: {}, activeId: null, results: [], loading: false, unseenOnly: false, picked: new Set() };

async function load() {
  state.watches = (await api.kvGet('watches')) || [];
  state.seen = (await api.kvGet('seenArxiv')) || {};
}
const saveWatches = () => api.kvSet('watches', state.watches);
const saveSeen = () => api.kvSet('seenArxiv', state.seen);

/** Bộ theo dõi bài dẫn hoặc tác giả: chỉ sửa được tên và số kết quả, nguồn cố định theo paper hoặc tác giả đã chọn. */
function editS2Watch(w) {
  return dialog({
    title: 'Sửa bộ theo dõi',
    body: `<p class="hint" style="margin-top:0">${w.type === 'cites' ? `Theo dõi bài mới dẫn <b>${escapeHtml(w.paperTitle || w.ident)}</b>.` : `Theo dõi bài mới của tác giả <b>${escapeHtml(w.authorName || w.authorId)}</b>.`} Tạo hoặc gỡ bộ này ở tab Liên quan của trang paper.</p>
      <label class="field"><span class="label-text">Tên</span><input type="text" id="w-name" value="${escapeHtml(w.name)}"></label>
      <label class="field"><span class="label-text">Số kết quả mỗi lần quét</span><input type="number" id="w-max" min="10" max="100" value="${w.max || 50}"></label>`,
    buttons: [{ label: 'Huỷ', value: null }, {
      label: 'Lưu', value: true, primary: true,
      onClick: async (body, close) => {
        const name = body.querySelector('#w-name').value.trim();
        if (!name) { toast('Nhập tên.', 2000, 'err'); return false; }
        const i = state.watches.findIndex((x) => x.id === w.id);
        if (i >= 0) state.watches[i] = { ...w, name, max: Number(body.querySelector('#w-max').value) || 50 };
        await saveWatches();
        close(true);
        return false;
      },
    }],
  });
}

function editWatch(w) {
  if (w && (w.type === 'cites' || w.type === 'author')) return editS2Watch(w);
  const isNew = !w;
  w = w || { id: uid('w'), name: '', keywords: [], cats: ['cs.CV'], max: 40 };
  return dialog({
    title: isNew ? 'Thêm bộ theo dõi' : 'Sửa bộ theo dõi',
    body: `<label class="field"><span class="label-text">Tên</span><input type="text" id="w-name" value="${escapeHtml(w.name)}" placeholder="ví dụ: VQA y tế"></label>
      <label class="field"><span class="label-text">Từ khoá (cách nhau bởi dấu phẩy; paper khớp ít nhất một từ khoá)</span><input type="text" id="w-kw" value="${escapeHtml(w.keywords.join(', '))}" placeholder="visual question answering, medical VQA, radiology report"></label>
      <div class="field"><span class="label-text">Danh mục arXiv (paper khớp ít nhất một)</span>
        <div class="row wrap" id="w-cats">${CATS.map((c) => `<label class="row" style="gap:4px;font-size:12px"><input type="checkbox" value="${c}" ${w.cats.includes(c) ? 'checked' : ''} style="width:auto"> ${c}</label>`).join('')}</div>
        <input type="text" id="w-cats-extra" placeholder="Danh mục khác, ví dụ: q-bio.QM, math.OC" value="${escapeHtml(w.cats.filter((c) => !CATS.includes(c)).join(', '))}" style="margin-top:6px"></div>
      <label class="field"><span class="label-text">Số kết quả mỗi lần quét</span><input type="number" id="w-max" min="10" max="200" value="${w.max || 40}"></label>`,
    buttons: [{ label: 'Huỷ', value: null }, {
      label: 'Lưu', value: true, primary: true,
      onClick: async (body, close) => {
        const name = body.querySelector('#w-name').value.trim();
        const keywords = body.querySelector('#w-kw').value.split(',').map((s) => s.trim()).filter(Boolean);
        const cats = [...body.querySelectorAll('#w-cats input:checked')].map((i) => i.value)
          .concat(body.querySelector('#w-cats-extra').value.split(',').map((s) => s.trim()).filter(Boolean));
        if (!name) { toast('Nhập tên.', 2000, 'err'); return false; }
        if (!keywords.length && !cats.length) { toast('Cần từ khoá hoặc danh mục.', 2500, 'err'); return false; }
        const next = { ...w, name, keywords, cats, max: Number(body.querySelector('#w-max').value) || 40 };
        const i = state.watches.findIndex((x) => x.id === w.id);
        if (i >= 0) state.watches[i] = next; else state.watches.push(next);
        await saveWatches();
        state.activeId = next.id;
        close(true);
        return false;
      },
    }],
  });
}

export async function render(root) {
  await load();
  root.innerHTML = `<div class="page-head"><h1>Theo dõi paper mới</h1><span class="hint">Quét arXiv theo từ khoá, bài mới dẫn một paper, hoặc bài mới của một tác giả. Paper đã có trong thư viện hoặc đã xem sẽ được đánh dấu.</span><span class="spacer"></span><button id="fd-add" class="primary sm">+ Bộ theo dõi</button></div>
    <div class="grid-3">
      <div>
        <div class="row wrap" style="margin-bottom:8px"><button id="fd-check" class="sm">Quét bộ đang chọn</button><button id="fd-check-all" class="sm">Quét tất cả</button><span class="spacer"></span>
          <label class="row" style="gap:6px;font-size:12.5px"><input type="checkbox" id="fd-unseen-only" ${state.unseenOnly ? 'checked' : ''}> Chỉ hiện chưa xem</label>
          <button id="fd-seen-all" class="sm ghost" title="Đánh dấu mọi paper trong danh sách là đã xem">Đánh dấu đã xem hết</button>
          <button id="fd-unseen-all" class="sm ghost" title="Bỏ đánh dấu đã xem cho mọi paper trong danh sách">Bỏ đánh dấu đã xem</button></div>
        <div id="fd-status" class="status" style="margin-bottom:8px"></div>
        <div id="fd-results"></div>
      </div>
      <div class="card"><h2>Bộ theo dõi</h2><div id="fd-bulk" class="watch-bulk"></div><div id="fd-list"></div>
        <p class="hint" style="margin-top:8px">Bộ theo dõi bài dẫn và tác giả tạo ở tab Liên quan của trang paper, nút 🔔 Theo dõi. arXiv cập nhật theo ngày làm việc, quét mỗi sáng là đủ.</p></div>
    </div>`;

  const drawList = () => {
    // Bỏ các lựa chọn của bộ đã không còn.
    state.picked = new Set([...state.picked].filter((id) => state.watches.some((w) => w.id === id)));
    const n = state.picked.size;
    $('fd-bulk').innerHTML = state.watches.length ? `${selectAllHtml('fd-all')}<span class="hint">${n ? `Đã chọn ${n}/${state.watches.length}` : ''}</span><span class="spacer"></span>
      <button class="sm" id="fd-scan-picked" ${n ? '' : 'disabled'} title="Quét các bộ đã chọn">Quét đã chọn</button>
      <button class="sm danger" id="fd-del-picked" ${n ? '' : 'disabled'}>Xoá đã chọn${n ? ` (${n})` : ''}</button>
      <button class="sm ghost danger" id="fd-del-all" title="Xoá mọi bộ theo dõi">Xoá tất cả</button>` : '';
    syncSelectAll($('fd-all'), state.watches.length, n);
    $('fd-list').innerHTML = state.watches.length ? state.watches.map((w) => `<div class="watch ${w.id === state.activeId ? 'active' : ''} ${state.picked.has(w.id) ? 'picked' : ''}" data-id="${w.id}">
      <input type="checkbox" class="watch-pick" data-pick="${w.id}" ${state.picked.has(w.id) ? 'checked' : ''} title="Chọn bộ này">
      <div class="watch-body"><b class="watch-name" data-sel="${w.id}" title="Bấm để quét bộ này">${escapeHtml(w.name)}</b>
      <div class="hint watch-meta"><span class="badge">${WATCH_TYPES[w.type || 'arxiv']}</span> ${w.type === 'cites' ? escapeHtml(w.paperTitle || w.ident) : (w.type === 'author' ? escapeHtml(w.authorName || w.authorId) : `${escapeHtml(w.keywords.join(', ') || '(mọi từ khoá)')} · ${escapeHtml(w.cats.join(', ') || '(mọi danh mục)')}`)}${w.lastChecked ? ` · quét ${fmtRelative(w.lastChecked)}` : ''}${w.unseen ? ` · <b style="color:var(--accent)">${w.unseen} mới</b>` : ''}</div></div>
      <div class="watch-acts"><button class="ghost sm" data-edit="${w.id}" title="Sửa">✎</button><button class="ghost sm" data-del="${w.id}" title="Xoá">🗑</button></div></div>`).join('')
      : '<span class="hint">Chưa có bộ theo dõi. Bấm "+ Bộ theo dõi".</span>';
  };

  const isSeen = (r) => !!state.seen[r.arxivId];
  /** Đếm lại số paper chưa xem của từng bộ theo dõi sau khi đánh dấu / bỏ đánh dấu. */
  const recount = async () => {
    for (const w of state.watches) {
      const mine = state.results.filter((r) => r.watch === w.name);
      if (mine.length) w.unseen = mine.filter((r) => !isSeen(r) && !findDuplicate({ arxivId: r.arxivId, title: r.title })).length;
    }
    const unseen = state.results.filter((r) => !isSeen(r) && !findDuplicate({ arxivId: r.arxivId, title: r.title })).length;
    await saveSeen(); await saveWatches(); await api.kvSet('feedUnseen', unseen);
    if (state.results.length) setStatus('fd-status', `${state.results.length} paper, ${unseen} chưa xem.`, 'ok');
  };
  const syncBulkButtons = () => {
    const seenCount = state.results.filter(isSeen).length;
    $('fd-seen-all').disabled = !state.results.length || seenCount === state.results.length;
    $('fd-unseen-all').disabled = !seenCount;
    $('fd-unseen-all').textContent = seenCount ? `Bỏ đánh dấu đã xem (${seenCount})` : 'Bỏ đánh dấu đã xem';
  };

  const drawResults = () => {
    const box = $('fd-results');
    syncBulkButtons();
    if (!state.results.length) { box.innerHTML = '<div class="empty">Chọn một bộ theo dõi rồi bấm "Quét".</div>'; return; }
    const list = state.unseenOnly ? state.results.filter((r) => !isSeen(r) && !findDuplicate({ arxivId: r.arxivId, title: r.title })) : state.results;
    if (!list.length) { box.innerHTML = '<div class="empty">Đã xem hết paper trong lần quét này. Bỏ tick "Chỉ hiện chưa xem" để xem lại.</div>'; return; }
    box.innerHTML = list.map((r) => {
      const inLib = findDuplicate({ arxivId: r.arxivId, title: r.title });
      const seen = !!state.seen[r.arxivId];
      return `<div class="feed-item ${seen || inLib ? 'seen' : ''}" data-id="${escapeHtml(r.arxivId)}">
        <div class="body"><div class="t"><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${titleHtml(r.title)}</a></div>
          <div class="hint">${escapeHtml(r.authors)} · ${escapeHtml(r.when || r.published)} · ${escapeHtml((r.cats || []).slice(0, 3).join(', '))}${state.watches.length > 1 && r.watch ? ` · <span class="badge">${escapeHtml(r.watch)}</span>` : ''}${inLib ? ' · <b>đã có trong thư viện</b>' : (seen ? ' · đã xem' : '')}</div>
          <div class="abs">${escapeHtml(r.abstract)}</div></div>
        <div style="display:flex;flex-direction:column;gap:4px">${inLib ? `<a class="badge ok" href="#/paper/${inLib.id}">mở</a>` : `<button class="sm primary" data-add="${escapeHtml(r.arxivId)}" data-q="${escapeHtml(r.q || r.arxivId)}">+ Thêm</button>`}${inLib ? '' : (seen
          ? `<button class="sm ghost" data-unseen="${escapeHtml(r.arxivId)}" title="Đưa paper này về chưa xem">Bỏ đánh dấu</button>`
          : `<button class="sm ghost" data-skip="${escapeHtml(r.arxivId)}" title="Đánh dấu đã xem">Đã xem</button>`)}</div></div>`;
    }).join('');
  };
  drawList(); drawResults();

  async function check(ids) {
    const ws = state.watches.filter((w) => ids.includes(w.id));
    if (!ws.length) return toast('Chọn một bộ theo dõi trước.');
    state.loading = true;
    let all = [];
    for (const [wi, w] of ws.entries()) {
      showProgress('fd-status', `Đang quét "${w.name}"…`, { step: wi, of: ws.length, expectedMs: 5000 });
      try {
        const rs = await scanWatch(w);
        w.lastChecked = new Date().toISOString();
        w.unseen = rs.filter((r) => !state.seen[r.arxivId] && !findDuplicate({ arxivId: r.arxivId, title: r.title })).length;
        all = all.concat(rs.map((r) => ({ ...r, watch: w.name })));
      } catch (e) {
        setStatus('fd-status', `"${escapeHtml(w.name)}": ${escapeHtml(e.message)} ${w.type === 'cites' || w.type === 'author' ? 'Semantic Scholar giới hạn tốc độ khi không có key, thử lại sau hoặc thêm S2 API key trong Cài đặt.' : 'arXiv API đôi khi chậm, thử lại sau.'}`, 'err');
        state.loading = false;
        await saveWatches(); drawList();
        return;
      }
    }
    const uniq = new Map();
    for (const r of all) if (!uniq.has(r.arxivId)) uniq.set(r.arxivId, r);
    state.results = [...uniq.values()].sort((a, b) => String(b.published).localeCompare(String(a.published)));
    const unseen = state.results.filter((r) => !state.seen[r.arxivId] && !findDuplicate({ arxivId: r.arxivId, title: r.title })).length;
    await saveWatches();
    await api.kvSet('feedUnseen', unseen);
    setStatus('fd-status', `${state.results.length} paper, ${unseen} chưa xem.`, 'ok');
    state.loading = false;
    drawList(); drawResults();
  }

  $('fd-add').addEventListener('click', async () => { if (await editWatch(null)) drawList(); });
  /** Xoá các bộ theo dõi theo danh sách mã, có hoàn tác. Kết quả quét của các bộ đó cũng bị bỏ khỏi danh sách bên trái. */
  async function removeWatches(ids, label) {
    const gone = state.watches.filter((w) => ids.includes(w.id));
    if (!gone.length) return;
    const before = state.watches.slice();
    const beforeResults = state.results.slice();
    state.watches = state.watches.filter((w) => !ids.includes(w.id));
    const names = new Set(gone.map((w) => w.name));
    state.results = state.results.filter((r) => !names.has(r.watch));
    for (const id of ids) state.picked.delete(id);
    if (ids.includes(state.activeId)) state.activeId = null;
    await saveWatches(); drawList(); drawResults();
    toast(`Đã xoá ${label}.`, 7000, '', {
      label: 'Hoàn tác',
      onClick: async () => { state.watches = before; state.results = beforeResults; await saveWatches(); drawList(); drawResults(); toast('Đã khôi phục.'); },
    });
  }

  $('fd-bulk').addEventListener('change', (e) => {
    if (e.target.id !== 'fd-all') return;
    state.picked = e.target.checked ? new Set(state.watches.map((w) => w.id)) : new Set();
    drawList();
  });
  $('fd-bulk').addEventListener('click', async (e) => {
    if (e.target.id === 'fd-scan-picked') { if (state.picked.size) check([...state.picked]); return; }
    if (e.target.id === 'fd-del-picked') {
      const ids = [...state.picked];
      if (ids.length && await confirmDialog(`Xoá ${ids.length} bộ theo dõi đã chọn?`, { danger: true, okLabel: 'Xoá' })) await removeWatches(ids, `${ids.length} bộ theo dõi`);
      return;
    }
    if (e.target.id === 'fd-del-all') {
      const ids = state.watches.map((w) => w.id);
      if (ids.length && await confirmDialog(`Xoá tất cả ${ids.length} bộ theo dõi?`, { danger: true, okLabel: 'Xoá tất cả' })) await removeWatches(ids, `tất cả ${ids.length} bộ theo dõi`);
    }
  });
  $('fd-list').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-pick]');
    if (!cb) return;
    if (cb.checked) state.picked.add(cb.dataset.pick); else state.picked.delete(cb.dataset.pick);
    drawList();
  });
  $('fd-list').addEventListener('click', async (e) => {
    if (e.target.closest('[data-pick]')) return;
    const sel = e.target.closest('[data-sel]');
    if (sel) { state.activeId = sel.dataset.sel; drawList(); check([state.activeId]); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) { if (await editWatch(state.watches.find((w) => w.id === ed.dataset.edit))) drawList(); return; }
    const del = e.target.closest('[data-del]');
    if (del && await confirmDialog('Xoá bộ theo dõi này?', { danger: true, okLabel: 'Xoá' })) {
      const w = state.watches.find((x) => x.id === del.dataset.del);
      await removeWatches([del.dataset.del], `bộ "${w?.name || ''}"`);
    }
  });
  $('fd-check').addEventListener('click', () => check(state.activeId ? [state.activeId] : state.watches.slice(0, 1).map((w) => w.id)));
  $('fd-check-all').addEventListener('click', () => check(state.watches.map((w) => w.id)));
  $('fd-seen-all').addEventListener('click', async () => {
    const newly = state.results.filter((r) => !isSeen(r)).map((r) => r.arxivId);
    for (const id of newly) state.seen[id] = Date.now();
    await recount();
    drawList(); drawResults();
    toast(`Đã đánh dấu ${newly.length} paper là đã xem.`, 6000, '', {
      label: 'Hoàn tác',
      onClick: async () => { for (const id of newly) delete state.seen[id]; await recount(); drawList(); drawResults(); toast('Đã hoàn tác.'); },
    });
  });
  $('fd-unseen-all').addEventListener('click', async () => {
    const was = state.results.filter(isSeen).map((r) => [r.arxivId, state.seen[r.arxivId]]);
    if (!was.length) return;
    for (const [id] of was) delete state.seen[id];
    await recount();
    drawList(); drawResults();
    toast(`Đã bỏ đánh dấu ${was.length} paper.`, 6000, '', {
      label: 'Hoàn tác',
      onClick: async () => { for (const [id, at] of was) state.seen[id] = at; await recount(); drawList(); drawResults(); toast('Đã hoàn tác.'); },
    });
  });
  $('fd-unseen-only').addEventListener('change', (e) => { state.unseenOnly = e.target.checked; drawResults(); });
  $('fd-results').addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    if (add) { state.seen[add.dataset.add] = Date.now(); await saveSeen(); location.hash = `#/add?q=${encodeURIComponent(add.dataset.q || add.dataset.add)}`; return; }
    const skip = e.target.closest('[data-skip]');
    if (skip) { state.seen[skip.dataset.skip] = Date.now(); await recount(); drawList(); drawResults(); return; }
    const unseen = e.target.closest('[data-unseen]');
    if (unseen) { delete state.seen[unseen.dataset.unseen]; await recount(); drawList(); drawResults(); }
  });

  if (!state.watches.length && (store.settings.myResearch || '').trim()) {
    // gợi ý bộ đầu tiên từ đề tài
    setStatus('fd-status', 'Chưa có bộ theo dõi. Bấm "+ Bộ theo dõi" và dán vài từ khoá từ đề tài của bạn.');
  }
}
