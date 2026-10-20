// Thư viện: sidebar chủ đề + thùng rác, tìm kiếm (kể cả toàn văn), ba kiểu xem, thao tác hàng loạt, dọn trùng, điều hướng phím.
import { api } from '../api.js';
import { store, onChange, topicOf, topicIdsOf, inTopic, bulkPapers, saveTopic, savePaper, restorePaper, duplicateGroups, removePaper } from '../store.js';
import { escapeHtml, fmtDate, norm, STATUS_LABEL, STATUS_ORDER, download, uid, debounce } from '../util.js';
import { $, toast, confirmDialog, promptDialog, selectDialog, dialog, topicBadge, selectAllHtml, syncSelectAll } from '../ui.js';
import { compareTableMarkdown, libraryToMarkdown, bibtexAll } from '../markdown.js';
import { venueBadge, VENUE_TYPES, RANK_FILTERS, matchesRankFilter, rankSortKey } from '../venue.js';
import { reextractPapers, hasTemplateNotes } from '../reextract.js';
import { findPdfsBulk } from '../pdffind.js';

const ALL = '__all__';
const TRASH = '__trash__';
const state = {
  topicId: ALL, q: '', status: '', sort: 'updated', view: 'list', tag: '', year: '', rating: 0, vtype: '', rank: '',
  ftHits: new Map(),   // paperId -> snippet (kết quả tìm toàn văn từ máy chủ)
  ftQuery: '',
  trash: [],
  focus: -1,
};

function visible() {
  if (state.topicId === TRASH) {
    const q = norm(state.q.trim());
    return state.trash.filter((p) => !q || norm(p.title).includes(q));
  }
  let list = store.papers.slice();
  if (state.topicId !== ALL) list = list.filter((p) => inTopic(p, state.topicId));
  if (state.status) list = list.filter((p) => (p.status || 'to-read') === state.status);
  if (state.tag) list = list.filter((p) => (p.extraction?.tags || []).includes(state.tag));
  if (state.year) list = list.filter((p) => String(p.extraction?.year || '') === state.year);
  if (state.rating) list = list.filter((p) => (p.rating || 0) >= state.rating);
  if (state.vtype) list = list.filter((p) => (p.venueInfo?.type || 'unknown') === state.vtype);
  if (state.rank) list = list.filter((p) => matchesRankFilter(p, state.rank));
  const q = norm(state.q.trim());
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean);
    list = list.filter((p) => {
      if (state.ftHits.has(p.id)) return true;
      const e = p.extraction || {};
      const hay = norm([
        p.title, p.url, p.userNotes, e.novelty, e.problem, e.bottleneck, e.dataset_metric_note, e.key_idea?.summary, e.one_liner,
        (e.authors || []).join(' '), e.venue, e.year, (e.tags || []).join(' '), (e.validation?.datasets || []).join(' '),
        (e.applicable_ideas || []).map((i) => `${i.idea} ${i.how_to_apply}`).join(' '),
        (e.limitation?.items || []).join(' '), (p.annotations || []).map((a) => `${a.quote} ${a.translation || ''} ${a.note}`).join(' '),
        e.motivation, e.objective?.goal, (e.contributions || []).join(' '), (e.validation?.findings || []).join(' '),
        (e.validation?.baselines || []).join(' '), (e.evidence || []).map((x) => x.claim).join(' '),
      ].filter(Boolean).join(' '));
      return terms.every((t) => hay.includes(t));
    });
  }
  const cmp = {
    updated: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
    created: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
    title: (a, b) => String(a.title).localeCompare(String(b.title)),
    year: (a, b) => String(b.extraction?.year || '').localeCompare(String(a.extraction?.year || '')),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    cites: (a, b) => (b.citationCount || 0) - (a.citationCount || 0),
    rank: (a, b) => rankSortKey(a) - rankSortKey(b) || (b.citationCount || 0) - (a.citationCount || 0),
  }[state.sort] || (() => 0);
  return list.sort(cmp);
}

function sidebarHtml() {
  const counts = new Map();
  for (const p of store.papers) for (const id of topicIdsOf(p)) counts.set(id, (counts.get(id) || 0) + 1);
  return `
    <li data-id="${ALL}" class="${state.topicId === ALL ? 'active' : ''}"><span class="dot" style="background:var(--muted)"></span><span class="name">Tất cả</span><span class="count">${store.papers.length}</span></li>
    ${store.topics.map((t) => `<li data-id="${t.id}" class="${state.topicId === t.id ? 'active' : ''}" title="${escapeHtml(t.description || '')}">
      <span class="dot" style="background:${escapeHtml(t.color || '#888')}"></span><span class="name">${escapeHtml(t.name)}</span><span class="count">${counts.get(t.id) || 0}</span></li>`).join('')}
    <li data-id="${TRASH}" class="${state.topicId === TRASH ? 'active' : ''}" style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px"><span class="dot" style="background:var(--danger)"></span><span class="name">🗑 Thùng rác</span><span class="count">${store.trashCount}</span></li>`;
}

function snippetHtml(id) {
  const s = state.ftHits.get(id);
  if (!s) return '';
  return `<div class="snippet">Toàn văn: ${escapeHtml(s).replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>')}</div>`;
}

function cardHtml(p, i) {
  const e = p.extraction || {};
  const ideas = (e.applicable_ideas || []).map((x) => x.idea).filter(Boolean).join('; ');
  const st = p.status || 'to-read';
  const inTrash = state.topicId === TRASH;
  const extra = (p.topicIds || []).filter((id) => id !== p.topicId).map((id) => topicBadge(store.topics.find((t) => t.id === id))).join('');
  return `<div class="paper ${store.selected.has(p.id) ? 'selected' : ''} ${i === state.focus ? 'focused' : ''}" data-id="${p.id}" draggable="${!inTrash}">
    <input type="checkbox" class="pick" data-id="${p.id}" ${store.selected.has(p.id) ? 'checked' : ''}>
    <div class="body">
      <div class="t">${escapeHtml(p.title)}</div>
      <div class="meta">
        ${topicBadge(topicOf(p))}${extra}
        ${venueBadge(p.venueInfo)}
        <span class="badge st-${st}">${STATUS_LABEL[st]}</span>
        ${e.year ? `<span class="badge">${escapeHtml(e.year)}</span>` : ''}
        ${(!p.venueInfo || ['unknown', 'other'].includes(p.venueInfo.type)) && e.venue ? `<span class="badge" title="${escapeHtml(e.venue)}">${escapeHtml(e.venue.slice(0, 40))}</span>` : ''}
        ${p.citationCount != null ? `<span class="badge" title="Số trích dẫn (Semantic Scholar)">↗ ${p.citationCount}</span>` : ''}
        ${p.pdfId ? '<span class="badge">PDF</span>' : ''}
        ${p.needsExtraction ? '<span class="badge warn" title="Mới nhập metadata, chưa trích xuất ghi chú">chưa trích xuất</span>' : (e.confidence ? `<span class="badge conf-${escapeHtml(e.confidence)}" title="Độ tin cậy trích xuất">tin cậy: ${escapeHtml(e.confidence)}</span>` : '')}
        ${(e.tags || []).slice(0, 5).map((x) => `<span class="badge accent tag" data-tag="${escapeHtml(x)}">#${escapeHtml(x)}</span>`).join('')}
        ${p.rating ? `<span class="stars">${'★'.repeat(p.rating)}</span>` : ''}
        <span class="badge">${inTrash ? `xoá ${fmtDate(p.deletedAt)}` : fmtDate(p.createdAt)}</span>
      </div>
      ${inTrash ? `<div class="row" style="margin-top:4px"><button class="sm" data-restore="${p.id}">Khôi phục</button><button class="sm danger" data-purge="${p.id}">Xoá vĩnh viễn</button></div>` : `
      <div class="line"><b>Điểm mới:</b> ${escapeHtml(e.novelty || '—')}</div>
      <div class="line"><b>Dataset/Metric:</b> ${escapeHtml(e.dataset_metric_note || '—')}</div>
      <div class="line"><b>Áp dụng được:</b> ${escapeHtml(ideas || '—')}</div>${snippetHtml(p.id)}`}
    </div>
  </div>`;
}

function kanbanHtml(list) {
  return `<div class="kanban">${STATUS_ORDER.map((st) => {
    const items = list.filter((p) => (p.status || 'to-read') === st);
    return `<div class="kan-col" data-status="${st}"><h3><span>${STATUS_LABEL[st]}</span><span>${items.length}</span></h3>
      ${items.map((p) => {
        const e = p.extraction || {};
        return `<div class="kan-card" draggable="true" data-id="${p.id}"><div class="t">${escapeHtml(p.title)}</div>
          <div class="meta">${topicBadge(topicOf(p))}${e.year ? `<span class="badge">${escapeHtml(e.year)}</span>` : ''}${p.rating ? `<span class="stars">${'★'.repeat(p.rating)}</span>` : ''}</div>
          <div class="hint">${escapeHtml((e.one_liner || e.novelty || '').slice(0, 140))}</div></div>`;
      }).join('') || '<div class="hint">Trống.</div>'}</div>`;
  }).join('')}</div>`;
}

function tableHtml(list) {
  return `<div class="table-wrap"><table class="data"><thead><tr>
    <th class="pick-col"></th><th>Tên paper</th><th>Chủ đề</th><th>Năm</th><th>Venue</th><th>Trạng thái</th><th>Đánh giá</th><th>↗</th><th>Điểm mới</th><th>Dataset/Metric</th></tr></thead><tbody>
    ${list.map((p) => {
      const e = p.extraction || {};
      return `<tr data-id="${p.id}" class="${store.selected.has(p.id) ? 'selected' : ''}"><td class="pick-col"><input type="checkbox" class="pick" data-id="${p.id}" ${store.selected.has(p.id) ? 'checked' : ''}></td>
        <td><b>${escapeHtml(p.title)}</b></td><td>${topicBadge(topicOf(p))}</td><td>${escapeHtml(e.year || '')}</td><td>${venueBadge(p.venueInfo) || escapeHtml((e.venue || '').slice(0, 30))}</td>
        <td><span class="badge st-${p.status || 'to-read'}">${STATUS_LABEL[p.status || 'to-read']}</span></td><td class="stars">${'★'.repeat(p.rating || 0)}</td><td>${p.citationCount ?? ''}</td>
        <td>${escapeHtml(e.novelty || '')}</td><td>${escapeHtml(e.dataset_metric_note || '')}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

/* ---------- Dọn trùng ---------- */
async function dedupe() {
  const groups = duplicateGroups();
  if (!groups.length) return toast('Không tìm thấy paper trùng.');
  const total = groups.reduce((n, g) => n + g.length - 1, 0);
  const body = `<p>Tìm thấy <b>${total}</b> bản trùng trong <b>${groups.length}</b> nhóm. Mỗi nhóm giữ lại bản cập nhật gần nhất, gộp ghi chú / đánh giá / PDF / nhãn từ các bản còn lại, rồi đưa bản thừa vào thùng rác.</p>
    ${groups.map((g) => `<div class="card" style="padding:8px 10px;margin-bottom:6px"><b>${escapeHtml(g[0].title)}</b><ul class="hint" style="margin:4px 0 0 16px">${g.map((p) => `<li>${escapeHtml(p.title)} · ${escapeHtml(p.arxivId || p.doi || p.url || 'không link')} · ${fmtDate(p.updatedAt)}</li>`).join('')}</ul></div>`).join('')}`;
  const ok = await dialog({ title: 'Dọn paper trùng', body, width: 720, buttons: [{ label: 'Huỷ', value: false }, { label: `Gộp ${total} bản trùng`, value: true, primary: true }] });
  if (!ok) return;
  let removed = 0;
  for (const g of groups) {
    g.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const keep = { ...g[0] };
    for (const extra of g.slice(1)) {
      keep.userNotes = [keep.userNotes, extra.userNotes].filter((x) => x && x.trim()).join('\n\n---\n\n');
      keep.rating = Math.max(keep.rating || 0, extra.rating || 0);
      keep.pdfId = keep.pdfId || extra.pdfId; keep.pdfName = keep.pdfName || extra.pdfName;
      keep.arxivId = keep.arxivId || extra.arxivId; keep.doi = keep.doi || extra.doi; keep.url = keep.url || extra.url;
      keep.citationCount = keep.citationCount ?? extra.citationCount;
      keep.topicIds = [...new Set([...(keep.topicIds || []), extra.topicId, ...(extra.topicIds || [])].filter((id) => id && id !== keep.topicId))];
      keep.annotations = [...(keep.annotations || []), ...(extra.annotations || [])];
      keep.qa = [...(keep.qa || []), ...(extra.qa || [])].slice(-30);
      if (keep.status === 'to-read' && extra.status !== 'to-read') keep.status = extra.status;
      // giữ pdf của bản bị gộp: gỡ pdfId khỏi bản thừa để máy chủ không xoá file
      await savePaper({ ...extra, pdfId: keep.pdfId === extra.pdfId ? null : extra.pdfId });
      await removePaper(extra.id);
      removed++;
    }
    await savePaper(keep);
  }
  toast(`Đã gộp ${removed} bản trùng (nằm trong thùng rác 30 ngày).`);
}

export async function render(root, { params, query }) {
  if (params[0]) state.topicId = params[0];
  if (query.has('q')) state.q = query.get('q');
  if (query.has('status')) state.status = query.get('status');
  if (query.has('tag')) state.tag = query.get('tag');
  if (query.has('year')) state.year = query.get('year');
  if (query.has('rank')) state.rank = query.get('rank');
  if (state.topicId !== TRASH && !store.topics.find((t) => t.id === state.topicId)) state.topicId = ALL;
  state.focus = -1;

  root.className = 'view split';
  root.innerHTML = `
    <div class="lib">
      <aside class="lib-side">
        <div class="side-head"><span>Chủ đề</span><button id="lib-add-topic" class="ghost sm" title="Thêm chủ đề">+</button></div>
        <ul id="lib-topics" class="topic-list"></ul>
      </aside>
      <div class="lib-main">
        <div class="lib-head">
          <div class="row wrap">
            <h1 id="lib-title"></h1><span id="lib-count" class="badge"></span>
            <span class="spacer"></span>
            <div class="seg" id="lib-view">
              <button data-view="list" class="${state.view === 'list' ? 'active' : ''}">Danh sách</button>
              <button data-view="kanban" class="${state.view === 'kanban' ? 'active' : ''}">Kanban</button>
              <button data-view="table" class="${state.view === 'table' ? 'active' : ''}">Bảng</button>
            </div>
          </div>
          <div class="controls">
            <input type="search" id="lib-q" placeholder="Lọc… (tìm cả trong toàn văn đã lưu)" value="${escapeHtml(state.q)}" style="max-width:280px">
            <select id="lib-status"><option value="">Mọi trạng thái</option>${STATUS_ORDER.map((s) => `<option value="${s}" ${state.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select>
            <select id="lib-vtype" title="Loại venue"><option value="">Mọi loại venue</option>${Object.entries(VENUE_TYPES).map(([k, l]) => `<option value="${k}" ${state.vtype === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <select id="lib-rank" title="Hạng venue (CORE cho hội nghị, SJR cho tạp chí)"><option value="">Mọi hạng</option>${RANK_FILTERS.map(([k, l]) => `<option value="${k}" ${state.rank === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <select id="lib-rating"><option value="0">Mọi đánh giá</option>${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${state.rating === n ? 'selected' : ''}>≥ ${'★'.repeat(n)}</option>`).join('')}</select>
            <select id="lib-sort">
              <option value="updated">Mới cập nhật</option><option value="created">Mới thêm</option><option value="title">Tên A→Z</option>
              <option value="year">Năm giảm dần</option><option value="rating">Đánh giá cao</option><option value="cites">Trích dẫn nhiều</option><option value="rank">Hạng venue</option>
            </select>
            <span id="lib-chips"></span>
          </div>
        </div>
        <div class="sel-bar" id="lib-selbar">
          <span class="sel-pick">${selectAllHtml('lib-all')}<button id="lib-selmenu" class="ghost sm sel-caret" title="Chọn theo điều kiện" aria-haspopup="menu">▾</button>
            <div id="lib-menu" class="menu" role="menu" hidden>
              <button data-sel="all">Tất cả trong danh sách</button>
              <button data-sel="none">Không chọn</button>
              <button data-sel="invert">Đảo lựa chọn</button>
              <hr>
              ${STATUS_ORDER.map((s) => `<button data-sel="st:${s}">${STATUS_LABEL[s]}</button>`).join('')}
              <button data-sel="pdf">Có PDF</button>
              <button data-sel="nopdf">Chưa có PDF</button>
              <button data-sel="noext">Chưa trích xuất</button>
              <button data-sel="oldnotes" title="Paper chưa trích xuất hoặc trích xuất theo 5 mục cũ">Chưa có ghi chú theo template</button>
            </div></span>
          <span id="lib-selinfo" class="sel-info"></span>
          <span class="spacer"></span>
          <span class="kbd-hint" id="lib-kbd" ${state.view === 'list' ? '' : 'hidden'} title="Phím tắt trong danh sách"><kbd>J</kbd><kbd>K</kbd> di chuyển · <kbd>Enter</kbd> mở · <kbd>X</kbd> chọn</span>
          <span id="lib-actions" class="row wrap sel-actions"></span>
        </div>
        <div id="lib-body" class="lib-body"></div>
      </div>
    </div>`;

  $('lib-sort').value = state.sort;

  // Thanh chọn kiểu Gmail: chưa chọn gì thì chỉ hiện thao tác chung, có chọn thì hiện thao tác hàng loạt.
  let actionsKey = '';
  const drawActions = () => {
    const n = store.selected.size;
    const key = `${state.topicId === TRASH}|${n > 0}`;
    if (key === actionsKey) return;
    actionsKey = key;
    if (state.topicId === TRASH) {
      $('lib-actions').innerHTML = (n ? `<button id="lib-restore" class="sm">Khôi phục</button><button id="lib-purge" class="sm danger">Xoá vĩnh viễn</button>` : '')
        + `<button id="lib-empty" class="sm danger ghost">Dọn sạch thùng rác</button>`;
    } else if (n) {
      $('lib-actions').innerHTML = `<button id="lib-chat" class="sm primary" title="Hỏi đáp với các paper đã chọn">Chat</button><button id="lib-compare" class="sm">So sánh</button><button id="lib-move" class="sm">Chuyển thư mục</button>
        <span class="sel-pick"><button id="lib-more-btn" class="sm" title="Thao tác khác" aria-haspopup="menu">Khác ▾</button>
          <div id="lib-more" class="menu right" role="menu" hidden><button id="lib-reextract" title="Chạy lại trích xuất ghi chú theo template cho các paper đã chọn">Trích xuất lại ghi chú (AI)</button><button id="lib-findpdf" title="Tìm bản PDF công khai cho các paper chưa có PDF rồi tải về">Tìm &amp; tải PDF</button><hr><button id="lib-set-status">Đổi trạng thái</button><button id="lib-label">Gắn nhãn phụ</button><button id="lib-export">Xuất…</button></div></span>
        <button id="lib-del" class="sm danger">Xoá</button>`;
      $('lib-more-btn').addEventListener('click', (e) => { e.stopPropagation(); $('lib-more').hidden = !$('lib-more').hidden; });
      $('lib-more').addEventListener('click', () => { $('lib-more').hidden = true; });
    } else {
      $('lib-actions').innerHTML = `<button id="lib-dedupe" class="sm ghost" title="Gộp paper trùng tên / arXiv / DOI">Dọn trùng</button><button id="lib-export" class="sm ghost" title="Xuất toàn bộ danh sách đang xem">Xuất danh sách</button>`;
    }
    bindActions();
  };

  const drawSelBar = (list = visible()) => {
    const picked = list.filter((p) => store.selected.has(p.id)).length;
    const n = store.selected.size;
    const kanban = state.topicId !== TRASH && state.view === 'kanban';
    $('lib-selbar').classList.toggle('kanban', kanban);
    syncSelectAll($('lib-all'), list.length, picked);
    const outside = n - picked;
    $('lib-selinfo').innerHTML = n
      ? `<b>Đã chọn ${n}</b>${outside > 0 ? ` <span class="hint">(${outside} ngoài danh sách đang xem)</span>` : ''} <button class="linkish" id="lib-clear">Bỏ chọn</button>`
      : '';
    drawActions();
  };

  const draw = () => {
    $('lib-topics').innerHTML = sidebarHtml();
    const list = visible();
    $('lib-title').textContent = state.topicId === ALL ? 'Tất cả paper' : (state.topicId === TRASH ? 'Thùng rác' : (store.topics.find((t) => t.id === state.topicId)?.name || 'Chủ đề'));
    $('lib-count').textContent = `${list.length} paper`;
    const chips = [];
    if (state.tag) chips.push(`<span class="chip">#${escapeHtml(state.tag)} <button data-clear="tag">✕</button></span>`);
    if (state.year) chips.push(`<span class="chip">năm ${escapeHtml(state.year)} <button data-clear="year">✕</button></span>`);
    if (state.ftHits.size && state.q.trim()) chips.push(`<span class="chip" title="Số paper khớp trong nội dung toàn văn đã lưu">toàn văn: ${state.ftHits.size}</span>`);
    $('lib-chips').innerHTML = chips.join(' ');
    drawSelBar(list);
    const body = $('lib-body');
    if (!list.length) {
      body.innerHTML = state.topicId === TRASH
        ? '<div class="empty">Thùng rác trống. Paper bị xoá nằm ở đây 30 ngày rồi tự xoá hẳn.</div>'
        : `<div class="empty">Không có paper nào ở đây.<br><a href="#/add">+ Thêm paper</a> từ link arXiv/DOI, file PDF, file .bib hoặc dán text.</div>`;
      return;
    }
    if (state.topicId !== TRASH && state.view === 'kanban') body.innerHTML = kanbanHtml(list);
    else if (state.topicId !== TRASH && state.view === 'table') body.innerHTML = tableHtml(list);
    else body.innerHTML = list.map(cardHtml).join('');
  };
  drawActions();
  draw();
  const unsub = onChange(draw);

  const fullTextSearch = debounce(async () => {
    const q = state.q.trim();
    if (q.length < 2 || state.topicId === TRASH) { state.ftHits = new Map(); state.ftQuery = ''; draw(); return; }
    try {
      const hits = await api.search(q);
      if (state.q.trim() !== q) return;
      state.ftHits = new Map(hits.map((h) => [h.paperId, h.snippet]));
      state.ftQuery = q;
    } catch (_) { state.ftHits = new Map(); }
    draw();
  }, 250);
  if (state.q.trim()) fullTextSearch();

  const updateSel = () => {
    $('sel-info').innerHTML = store.selected.size ? `<a href="#/compare">${store.selected.size} paper đã chọn →</a>` : '';
    drawSelBar();
  };

  /* ---- sidebar ---- */
  $('lib-topics').addEventListener('click', async (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    state.topicId = li.dataset.id;
    state.focus = -1;
    if (state.topicId === TRASH) state.trash = await api.trash();
    history.replaceState(null, '', state.topicId === ALL ? '#/library' : `#/library/${state.topicId}`);
    drawActions();
    draw();
  });
  if (state.topicId === TRASH) { state.trash = await api.trash(); draw(); }
  $('lib-topics').addEventListener('dragover', (e) => { const li = e.target.closest('li'); if (li && li.dataset.id !== ALL && li.dataset.id !== TRASH) { e.preventDefault(); li.classList.add('drop-target'); } });
  $('lib-topics').addEventListener('dragleave', (e) => { e.target.closest('li')?.classList.remove('drop-target'); });
  $('lib-topics').addEventListener('drop', async (e) => {
    const li = e.target.closest('li');
    if (!li || li.dataset.id === ALL || li.dataset.id === TRASH) return;
    e.preventDefault();
    li.classList.remove('drop-target');
    const id = e.dataTransfer.getData('text/paper-id');
    if (!id) return;
    const ids = store.selected.has(id) ? [...store.selected] : [id];
    await bulkPapers('move', ids, li.dataset.id);
    toast(`Đã chuyển ${ids.length} paper.`);
  });
  $('lib-add-topic').addEventListener('click', async () => {
    const name = await promptDialog('Tên thư mục chủ đề mới', { title: 'Thêm chủ đề', placeholder: 'ví dụ: Video Grounding' });
    if (!name?.trim()) return;
    await saveTopic({ id: uid('t'), name: name.trim(), description: 'Thư mục do bạn tạo.', keywords: [], color: '#6b7cff' });
    toast('Đã thêm chủ đề. Vào trang Chủ đề để thêm từ khoá gợi ý.');
  });

  /* ---- bộ lọc ---- */
  $('lib-view').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    state.view = b.dataset.view;
    $('lib-view').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    $('lib-kbd').hidden = state.view !== 'list';
    draw();
  });
  $('lib-q').addEventListener('input', (e) => { state.q = e.target.value; state.focus = -1; draw(); fullTextSearch(); });
  $('lib-status').addEventListener('change', (e) => { state.status = e.target.value; draw(); });
  $('lib-rating').addEventListener('change', (e) => { state.rating = Number(e.target.value); draw(); });
  $('lib-vtype').addEventListener('change', (e) => { state.vtype = e.target.value; draw(); });
  $('lib-rank').addEventListener('change', (e) => { state.rank = e.target.value; draw(); });
  $('lib-sort').addEventListener('change', (e) => { state.sort = e.target.value; draw(); });
  $('lib-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-clear]'); if (b) { state[b.dataset.clear] = ''; draw(); } });
  // Như Gmail: đang chọn một phần hoặc tất cả thì bấm sẽ bỏ chọn, chưa chọn gì thì chọn hết danh sách đang xem.
  $('lib-all').addEventListener('click', (e) => {
    const list = visible();
    const anyPicked = list.some((p) => store.selected.has(p.id));
    if (anyPicked) list.forEach((p) => store.selected.delete(p.id)); else list.forEach((p) => store.selected.add(p.id));
    e.target.indeterminate = false;
    draw(); updateSel();
  });
  const selectWhere = (kind) => {
    const list = visible();
    if (kind === 'none') { store.selected.clear(); return; }
    if (kind === 'invert') { list.forEach((p) => (store.selected.has(p.id) ? store.selected.delete(p.id) : store.selected.add(p.id))); return; }
    list.forEach((p) => store.selected.delete(p.id));
    const test = {
      all: () => true,
      pdf: (p) => !!p.pdfId,
      nopdf: (p) => !p.pdfId,
      noext: (p) => !!p.needsExtraction,
      oldnotes: (p) => !hasTemplateNotes(p),
    }[kind] || ((p) => kind.startsWith('st:') && (p.status || 'to-read') === kind.slice(3));
    list.filter(test).forEach((p) => store.selected.add(p.id));
  };
  const closeMenu = () => { $('lib-menu').hidden = true; };
  $('lib-selmenu').addEventListener('click', (e) => { e.stopPropagation(); $('lib-menu').hidden = !$('lib-menu').hidden; });
  $('lib-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sel]');
    if (!b) return;
    selectWhere(b.dataset.sel);
    closeMenu();
    draw(); updateSel();
  });
  const onDocClick = (e) => {
    if (!e.target.closest('#lib-menu')) closeMenu();
    if (!e.target.closest('#lib-more') && $('lib-more')) $('lib-more').hidden = true;
  };
  document.addEventListener('click', onDocClick);
  $('lib-selbar').addEventListener('click', (e) => {
    if (e.target.id === 'lib-clear') { store.selected.clear(); draw(); updateSel(); }
  });

  /* ---- danh sách ---- */
  const body = $('lib-body');
  body.addEventListener('click', async (e) => {
    const cb = e.target.closest('.pick');
    if (cb) {
      e.stopPropagation();
      if (cb.checked) store.selected.add(cb.dataset.id); else store.selected.delete(cb.dataset.id);
      cb.closest('.paper, tr')?.classList.toggle('selected', cb.checked);
      updateSel();
      return;
    }
    const tag = e.target.closest('.tag[data-tag]');
    if (tag) { e.stopPropagation(); state.tag = tag.dataset.tag; draw(); return; }
    const rs = e.target.closest('[data-restore]');
    if (rs) { e.stopPropagation(); await restorePaper(rs.dataset.restore); state.trash = state.trash.filter((p) => p.id !== rs.dataset.restore); draw(); toast('Đã khôi phục.'); return; }
    const pg = e.target.closest('[data-purge]');
    if (pg) {
      e.stopPropagation();
      if (!(await confirmDialog('Xoá vĩnh viễn paper này? Không khôi phục được.', { danger: true, okLabel: 'Xoá vĩnh viễn' }))) return;
      await api.deletePaper(pg.dataset.purge, true);
      state.trash = state.trash.filter((p) => p.id !== pg.dataset.purge);
      store.trashCount = Math.max(0, store.trashCount - 1);
      draw();
      return;
    }
    const item = e.target.closest('[data-id]');
    if (item && state.topicId !== TRASH) location.hash = `#/paper/${item.dataset.id}`;
  });
  body.addEventListener('dragstart', (e) => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    e.dataTransfer.setData('text/paper-id', item.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  body.addEventListener('dragover', (e) => { const col = e.target.closest('.kan-col'); if (col) { e.preventDefault(); col.classList.add('over'); } });
  body.addEventListener('dragleave', (e) => { e.target.closest('.kan-col')?.classList.remove('over'); });
  body.addEventListener('drop', async (e) => {
    const col = e.target.closest('.kan-col');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('over');
    const id = e.dataTransfer.getData('text/paper-id');
    const p = store.papers.find((x) => x.id === id);
    if (!p || p.status === col.dataset.status) return;
    await savePaper({ ...p, status: col.dataset.status });
  });

  /* ---- phím tắt trong danh sách: j/k di chuyển, Enter mở, x tick chọn ---- */
  const onKey = (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || state.view !== 'list' || document.querySelector('.modal')) return;
    const list = visible();
    if (!list.length) return;
    if (e.key === 'j' || e.key === 'ArrowDown') { state.focus = Math.min(list.length - 1, state.focus + 1); }
    else if (e.key === 'k' || e.key === 'ArrowUp') { state.focus = Math.max(0, state.focus - 1); }
    else if (e.key === 'Enter' && state.focus >= 0) { if (state.topicId !== TRASH) location.hash = `#/paper/${list[state.focus].id}`; return; }
    else if (e.key === 'x' && state.focus >= 0) { const id = list[state.focus].id; if (store.selected.has(id)) store.selected.delete(id); else store.selected.add(id); updateSel(); }
    else return;
    e.preventDefault();
    draw();
    body.querySelector('.paper.focused')?.scrollIntoView({ block: 'nearest' });
  };
  document.addEventListener('keydown', onKey);

  /* ---- thao tác hàng loạt ---- */
  function bindActions() {
    const needSel = () => { if (!store.selected.size) { toast('Tick chọn ít nhất một paper trước.'); return false; } return true; };
    $('lib-compare')?.addEventListener('click', () => { if (needSel()) location.hash = '#/compare'; });
    $('lib-chat')?.addEventListener('click', () => { if (needSel()) location.hash = `#/chat?ids=${[...store.selected].join(',')}`; });
    $('lib-reextract')?.addEventListener('click', () => { if (needSel()) reextractPapers([...store.selected]); });
    $('lib-findpdf')?.addEventListener('click', () => { if (needSel()) findPdfsBulk([...store.selected].map((id) => store.papers.find((x) => x.id === id)).filter(Boolean)); });
    $('lib-move')?.addEventListener('click', async () => {
      if (!needSel()) return;
      const to = await selectDialog(`Chuyển ${store.selected.size} paper sang thư mục`, store.topics.map((t) => ({ value: t.id, label: t.name })), { title: 'Chuyển thư mục' });
      if (!to) return;
      const n = await bulkPapers('move', store.selected, to);
      toast(`Đã chuyển ${n} paper.`);
    });
    $('lib-label')?.addEventListener('click', async () => {
      if (!needSel()) return;
      const to = await selectDialog(`Gắn nhãn phụ cho ${store.selected.size} paper (paper vẫn ở thư mục chính)`, store.topics.map((t) => ({ value: t.id, label: t.name })), { title: 'Gắn nhãn phụ' });
      if (!to) return;
      for (const id of store.selected) {
        const p = store.papers.find((x) => x.id === id);
        if (p && p.topicId !== to && !(p.topicIds || []).includes(to)) await savePaper({ ...p, topicIds: [...(p.topicIds || []), to] });
      }
      toast('Đã gắn nhãn phụ.');
    });
    $('lib-set-status')?.addEventListener('click', async () => {
      if (!needSel()) return;
      const st = await selectDialog('Trạng thái mới', STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] })), { title: 'Đổi trạng thái' });
      if (!st) return;
      await bulkPapers('status', store.selected, st);
      toast('Đã cập nhật trạng thái.');
    });
    $('lib-dedupe')?.addEventListener('click', dedupe);
    $('lib-del')?.addEventListener('click', async () => {
      if (!needSel()) return;
      const ids = [...store.selected];
      const n = await bulkPapers('delete', ids);
      toast(`Đã đưa ${n} paper vào thùng rác.`, 6000, '', { label: 'Hoàn tác', onClick: async () => { await bulkPapers('restore', ids); toast('Đã khôi phục.'); } });
    });
    $('lib-restore')?.addEventListener('click', async () => {
      if (!needSel()) return;
      const ids = [...store.selected];
      await bulkPapers('restore', ids);
      state.trash = state.trash.filter((p) => !ids.includes(p.id));
      draw();
      toast(`Đã khôi phục ${ids.length} paper.`);
    });
    $('lib-purge')?.addEventListener('click', async () => {
      if (!needSel()) return;
      if (!(await confirmDialog(`Xoá vĩnh viễn ${store.selected.size} paper? Không khôi phục được.`, { danger: true, okLabel: 'Xoá vĩnh viễn' }))) return;
      const ids = [...store.selected];
      await bulkPapers('purge', ids);
      state.trash = state.trash.filter((p) => !ids.includes(p.id));
      draw();
    });
    $('lib-empty')?.addEventListener('click', async () => {
      if (!state.trash.length) return;
      if (!(await confirmDialog(`Xoá vĩnh viễn toàn bộ ${state.trash.length} paper trong thùng rác?`, { danger: true, okLabel: 'Dọn sạch' }))) return;
      await bulkPapers('purge', state.trash.map((p) => p.id));
      state.trash = [];
      draw();
    });
    $('lib-export')?.addEventListener('click', async () => {
      const list = visible();
      const picked = list.filter((p) => store.selected.has(p.id));
      const rows = picked.length ? picked : list;
      const kind = await selectDialog(`Xuất ${rows.length} paper (${picked.length ? 'đã chọn' : 'toàn bộ khung nhìn'}) dạng`, [
        { value: 'md', label: 'Markdown đầy đủ (nhóm theo chủ đề)' },
        { value: 'table', label: 'Bảng so sánh (Markdown)' },
        { value: 'csv', label: 'CSV bảng so sánh (Excel)' },
        { value: 'bib', label: 'BibTeX (references.bib)' },
        { value: 'json', label: 'JSON (chỉ các paper này)' },
      ], { title: 'Xuất dữ liệu' });
      if (!kind) return;
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === 'md') download(`papervault-${stamp}.md`, libraryToMarkdown(rows, store.topics), 'text/markdown;charset=utf-8');
      else if (kind === 'table') download(`papervault-sosanh-${stamp}.md`, compareTableMarkdown(rows, { withBottleneck: true }), 'text/markdown;charset=utf-8');
      else if (kind === 'bib') download('references.bib', bibtexAll(rows),'application/x-bibtex;charset=utf-8');
      else if (kind === 'json') download(`papervault-papers-${stamp}.json`, JSON.stringify({ format: 'papervault-export', version: 2, exportedAt: new Date().toISOString(), topics: store.topics, papers: rows }, null, 2), 'application/json');
      else if (kind === 'csv') {
        const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
        const csv = [
          ['Tên paper', 'Năm', 'Venue', 'Chủ đề', 'Trạng thái', 'Trích dẫn', 'Điểm mới', 'Dataset/Metric', 'Ý tưởng áp dụng', 'Limitation', 'Link'].map(esc).join(','),
          ...rows.map((p) => {
            const e = p.extraction || {};
            return [p.title, e.year, e.venue, topicOf(p)?.name || '', STATUS_LABEL[p.status || 'to-read'], p.citationCount ?? '', e.novelty, e.dataset_metric_note,
              (e.applicable_ideas || []).map((i) => i.idea).join('; '), (e.limitation?.items || []).join('; '), p.url].map(esc).join(',');
          }),
        ].join('\n');
        download(`papervault-sosanh-${stamp}.csv`, `﻿${csv}`, 'text/csv;charset=utf-8');
      }
    });
  }

  return () => { unsub(); document.removeEventListener('keydown', onKey); document.removeEventListener('click', onDocClick); };
}
