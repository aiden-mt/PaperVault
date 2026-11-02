// Thêm paper: từ link/arXiv/DOI, file PDF, text dán tay, nhập hàng loạt, file .bib/.ris, và hộp thư từ extension.
import { api } from '../api.js';
import { store, topicById, findDuplicate, refreshInbox } from '../store.js';
import { escapeHtml, fmtSize, fmtRelative } from '../util.js';
import { $, toast, setStatus, spinner, showProgress, confirmDialog, selectAllHtml, syncSelectAll } from '../ui.js';
import { runExtraction, savePaperFromExtraction, acceptPdfFile, resolveQuery, saveMetadataOnly } from '../extract.js';
import { renderSections } from '../render.js';
import { hasCredentials } from '../llm.js';
import { parseReferences } from '../bib.js';
import { zoteroCardHtml, bindZoteroCard } from '../zotero.js';
import { renderBatch, addEntries } from './batch.js';
import { runJob, getJob, jobRunning, followJob } from '../bgjobs.js';
import { isPaperIdentifier, searchItem, sortItems, matchLibrary, toBatchEntry } from '../papersearch.js';

let pendingFiles = [];
export function setPendingFiles(files) { pendingFiles = files; }

const state = { tab: 'link', source: null, pdf: null, result: null, saving: false, savedId: null, refs: [] };
// Tìm paper theo tên / từ khoá: kết quả đã tải, vị trí trang sau, bộ lọc năm, cách xếp, bài đã tích để thêm hàng loạt.
const search = { q: '', items: [], offset: 0, total: 0, source: '', year: '', sort: 'relevance', picked: new Set(), loading: false };

export async function render(root, { query }) {
  state.tab = query.get('tab') || (pendingFiles.length ? 'pdf' : 'link');
  state.source = null; state.result = null; state.savedId = null; state.pdf = null;
  root.innerHTML = `<div class="add-page">
    <div class="page-head"><h1>Thêm paper</h1><span class="hint">Trích xuất ghi chú theo template đọc paper (Problem &amp; Motivation · Research Gap · Method · Dataset · Experiments · Findings · Limitations · Relevance · Evidence) rồi phân loại vào thư mục chủ đề.</span></div>
    ${!hasCredentials(store.settings) ? '<div class="dup-warn">Chưa có API key. <a href="#/settings">Mở Cài đặt</a> để nhập key trước khi trích xuất. Vẫn nhập được metadata từ file .bib/.ris mà không cần key.</div>' : ''}
    <div id="add-inbox"></div>
    <div class="tabs" id="add-tabs">
      <button data-tab="link">Tìm / Link / arXiv / DOI</button><button data-tab="pdf">File PDF</button><button data-tab="text">Dán text</button><button data-tab="batch">Hàng loạt (link + nhiều PDF)</button><button data-tab="bib">Zotero / .bib / .ris</button>
    </div>
    <div id="add-body"></div>
    <div id="add-status" class="status" style="margin-top:10px"></div>
    <div id="add-result"></div>
  </div>`;
  $('add-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    state.tab = b.dataset.tab;
    drawTab();
  });
  drawInbox();
  drawTab();
  if (query.get('q')) { $('add-q').value = query.get('q'); submitQuery(); }
  if (pendingFiles.length && state.tab === 'pdf') { const f = pendingFiles.shift(); pendingFiles = []; acceptPdf(f); }
  // Trích xuất chạy nền: đang chạy thì thanh tiến độ chạy tiếp, xong lúc người dùng ở trang khác thì hiện kết quả để lưu.
  const aj = getJob(ADD_JOB);
  if (aj && !aj.done) followAdd(aj);
  else if (aj?.done && !aj.shown) showAddResult(aj);
}

/* ---------------- Hộp thư từ extension ---------------- */

function drawInbox() {
  const box = $('add-inbox');
  if (!box) return;
  if (!store.inbox.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="card" style="border-color:var(--accent)"><h2>Hộp thư từ extension · ${store.inbox.length}</h2>
    ${store.inbox.map((it) => {
      const src = it.source || {};
      const title = it.extraction?.title || src.title || src.url || '(không tên)';
      return `<div class="row wrap" style="padding:6px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:200px"><b>${escapeHtml(title)}</b><div class="hint">${escapeHtml(src.kind || '')}${src.text ? ` · ${src.text.length.toLocaleString('vi-VN')} ký tự` : ''} · ${fmtRelative(it.at)}${it.extraction ? ' · <b>đã trích xuất sẵn</b>' : ''}</div></div>
        ${it.extraction ? `<button class="sm primary" data-inbox-save="${it.id}">Lưu ngay</button>` : `<button class="sm primary" data-inbox-extract="${it.id}">Trích xuất</button>`}
        <button class="sm ghost" data-inbox-drop="${it.id}">Bỏ</button></div>`;
    }).join('')}</div>`;
  box.onclick = async (e) => {
    const b = e.target.closest('button[data-inbox-save],button[data-inbox-extract],button[data-inbox-drop]');
    if (!b) return;
    const id = b.dataset.inboxSave || b.dataset.inboxExtract || b.dataset.inboxDrop;
    const it = store.inbox.find((x) => x.id === id);
    if (!it) return;
    if (b.dataset.inboxDrop) { await api.inboxRemove(id); await refreshInbox(); drawInbox(); return; }
    if (b.dataset.inboxExtract) {
      await api.inboxRemove(id); await refreshInbox(); drawInbox();
      state.tab = 'text'; drawTab();
      $('add-url').value = it.source?.url || '';
      $('add-text').value = it.source?.text || '';
      if ((it.source?.text || '').length >= 120) extract({ ...it.source, kind: it.source.kind || 'từ extension' });
      return;
    }
    // đã có extraction từ extension: hiện khối xác nhận như sau khi trích xuất
    const { suggestTopic } = await import('../topics.js');
    const ex = it.extraction;
    const hay = [ex.title, ex.problem, ex.bottleneck, ex.key_idea?.summary, (ex.tags || []).join(' ')].filter(Boolean).join(' ');
    const suggestion = suggestTopic({ text: hay, topics: store.topics, llmTopicName: ex.suggested_topic });
    const duplicate = findDuplicate({ url: it.source?.url, arxivId: it.source?.arxivId, title: ex.title });
    state.result = { extraction: ex, meta: it.meta || { provider: 'extension', model: '', elapsedMs: 0 }, suggestion, duplicate, source: { ...(it.source || {}), text: it.source?.text || '' }, inboxId: id };
    state.savedId = null;
    renderConfirm(state.result);
  };
}

function drawTab() {
  $('add-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  $('add-result').innerHTML = '';
  setStatus('add-status', '');
  const body = $('add-body');
  if (state.tab === 'link') {
    body.innerHTML = `<label class="field"><span class="label-text">Tên paper, từ khoá, link, arXiv ID hoặc DOI</span>
      <div class="row"><input type="search" id="add-q" placeholder="visual question answering hallucination · LEAML · 2401.12345 · 10.1145/… · https://…"><button id="add-resolve" class="primary">Tìm</button></div>
      <span class="hint">Gõ tên paper hoặc từ khoá để tìm như Google Scholar (Semantic Scholar, OpenAlex dự phòng). Dán link, arXiv ID hay DOI thì app tra cứu thẳng, tự tải abstract + full text hoặc file PDF nếu có.</span></label>
      <div id="add-preview"></div>
      <div id="add-search"></div>`;
    $('add-resolve').addEventListener('click', submitQuery);
    $('add-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitQuery(); });
    $('add-q').focus();
    if (search.q && search.items.length) { $('add-q').value = search.q; drawSearch(); }
  } else if (state.tab === 'pdf') {
    body.innerHTML = `<div class="dropzone" id="add-drop"><b>Chọn file PDF</b>kéo thả vào đây hoặc bấm để chọn — chọn nhiều file thì chuyển sang chế độ hàng loạt</div>
      <input type="file" id="add-file" accept="application/pdf,.pdf" multiple hidden>
      <div id="add-chip" class="file-chip" hidden><span id="add-chip-text"></span><button id="add-chip-clear">✕</button></div>
      <label class="field"><span class="label-text">Link paper (tuỳ chọn, để nhận diện trùng và mở lại sau)</span><input type="text" id="add-url" placeholder="https://…"></label>
      <div class="row"><button id="add-extract" class="primary" disabled>Trích xuất ghi chú</button></div>`;
    $('add-drop').addEventListener('click', () => $('add-file').click());
    $('add-file').addEventListener('change', (e) => { const fl = [...(e.target.files || [])]; if (fl.length > 1) toBatch(fl); else acceptPdf(fl[0]); });
    ['dragenter', 'dragover'].forEach((ev) => $('add-drop').addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); $('add-drop').classList.add('over'); }));
    $('add-drop').addEventListener('dragleave', () => $('add-drop').classList.remove('over'));
    $('add-drop').addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); $('add-drop').classList.remove('over'); const fl = [...(e.dataTransfer.files || [])].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)); if (fl.length > 1) toBatch(fl); else acceptPdf(fl[0]); });
    $('add-chip-clear').addEventListener('click', () => { state.pdf = null; showChip(); });
    $('add-extract').addEventListener('click', () => extract({ url: $('add-url').value.trim(), title: state.pdf.pdfName.replace(/\.pdf$/i, ''), kind: `file PDF (${state.pdf.pdfName})`, pdfBytes: state.pdf.pdfBytes, pdfName: state.pdf.pdfName, text: '' }));
  } else if (state.tab === 'text') {
    body.innerHTML = `<label class="field"><span class="label-text">Link paper (tuỳ chọn)</span><input type="text" id="add-url" placeholder="https://…"></label>
      <label class="field"><span class="label-text">Abstract hoặc full text</span><textarea id="add-text" rows="12" placeholder="Dán nội dung paper (tối thiểu 120 ký tự)…"></textarea></label>
      <div class="row"><button id="add-extract" class="primary">Trích xuất ghi chú</button><button id="add-blank" class="sm">Tạo note trống (tự điền)</button></div>`;
    $('add-extract').addEventListener('click', () => {
      const text = $('add-text').value.trim();
      if (text.length < 120) return setStatus('add-status', 'Cần ít nhất 120 ký tự.', 'err');
      extract({ url: $('add-url').value.trim(), title: '', kind: 'text người dùng dán', text });
    });
    $('add-blank').addEventListener('click', createBlank);
  } else if (state.tab === 'batch') {
    body.innerHTML = '<div id="batch-root"></div>';
    const files = pendingFiles;
    pendingFiles = [];
    renderBatch($('batch-root'), { files });
  } else {
    body.innerHTML = `${zoteroCardHtml()}
      <div class="dropzone" id="bib-drop"><b>Chọn file .bib, .ris hoặc CSL JSON</b>xuất từ Zotero, Mendeley (File → Export), Google Scholar… hoặc dán nội dung bên dưới</div>
      <input type="file" id="bib-file" accept=".bib,.ris,.json,.txt" hidden>
      <label class="field"><textarea id="bib-text" rows="6" placeholder="@inproceedings{…}  hoặc  TY  - JOUR …"></textarea></label>
      <div class="row wrap"><button id="bib-parse" class="sm">Đọc danh sách</button><span id="bib-count" class="hint"></span></div>
      <div id="bib-list"></div>`;
    $('bib-drop').addEventListener('click', () => $('bib-file').click());
    $('bib-file').addEventListener('change', async (e) => { const f = e.target.files?.[0]; if (f) { $('bib-text').value = await f.text(); parseBib(f.name); } });
    ['dragenter', 'dragover'].forEach((ev) => $('bib-drop').addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); $('bib-drop').classList.add('over'); }));
    $('bib-drop').addEventListener('dragleave', () => $('bib-drop').classList.remove('over'));
    $('bib-drop').addEventListener('drop', async (e) => { e.preventDefault(); e.stopPropagation(); $('bib-drop').classList.remove('over'); const f = [...(e.dataTransfer.files || [])][0]; if (f) { $('bib-text').value = await f.text(); parseBib(f.name); } });
    $('bib-parse').addEventListener('click', () => parseBib(''));
    bindZoteroCard(body);
  }
}

/* ---------------- .bib / .ris ---------------- */

function parseBib(filename) {
  const text = $('bib-text').value;
  state.refs = parseReferences(text, filename).map((r) => ({ ...r, dup: findDuplicate({ url: r.url, arxivId: r.arxivId, doi: r.doi, title: r.title }) }));
  $('bib-count').textContent = state.refs.length ? `${state.refs.length} mục, ${state.refs.filter((r) => r.dup).length} đã có trong thư viện.` : 'Không đọc được mục nào. Kiểm tra định dạng file.';
  const list = $('bib-list');
  if (!state.refs.length) { list.innerHTML = ''; return; }
  list.innerHTML = `<div class="row wrap" style="margin:8px 0">
      <span class="hint" style="margin:0">Lưu vào thư mục</span>
      <select id="bib-topic" style="width:auto">${store.topics.map((t) => `<option value="${t.id}" ${t.id === 't_inbox' ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}</select>
      <span class="spacer"></span>
      <button id="bib-quick" class="primary sm" title="Tạo paper với tiêu đề/tác giả/năm/DOI, không gọi model">Nhập nhanh (chỉ metadata)</button>
      <button id="bib-full" class="sm" title="Đưa vào danh sách hàng loạt để tra cứu, chọn lọc, trích xuất rồi lưu">Đưa vào danh sách hàng loạt</button></div>
    <div class="sel-bar compact">${selectAllHtml('bib-all')}<span id="bib-selinfo" class="sel-info"></span><span class="hint" style="margin:0">Mục đã có trong thư viện không được chọn sẵn</span></div>
    <div class="table-wrap"><table class="data"><thead><tr><th class="pick-col"></th><th>Tiêu đề</th><th>Năm</th><th>Nhận diện</th><th></th></tr></thead><tbody>
    ${state.refs.map((r, i) => `<tr><td class="pick-col"><input type="checkbox" class="bib-pick" data-i="${i}" ${r.dup ? '' : 'checked'}></td><td><b>${escapeHtml(r.title)}</b><div class="hint">${escapeHtml(r.authors.slice(0, 3).join(', '))}${r.venue ? ` · ${escapeHtml(r.venue.slice(0, 40))}` : ''}</div></td><td>${escapeHtml(r.year)}</td><td class="hint">${escapeHtml(r.arxivId ? `arXiv:${r.arxivId}` : (r.doi || (r.url ? 'link' : 'chỉ tiêu đề')))}</td><td>${r.dup ? `<a class="badge ok" href="#/paper/${r.dup.id}">đã có</a>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
  const picked = () => [...list.querySelectorAll('.bib-pick:checked')].map((cb) => state.refs[Number(cb.dataset.i)]);
  const syncBib = () => {
    const n = picked().length;
    // Mục đã có trong thư viện không tính vào "tất cả", nên chọn hết mục mới là ô chủ được tick đầy đủ.
    syncSelectAll($('bib-all'), state.refs.filter((r) => !r.dup).length || state.refs.length, n);
    $('bib-selinfo').textContent = n ? `Đã chọn ${n}/${state.refs.length}` : '';
  };
  syncBib();
  // Như Gmail: đang có mục được chọn thì bấm sẽ bỏ chọn hết, chưa chọn gì thì chọn tất cả mục chưa có trong thư viện.
  $('bib-all').addEventListener('click', () => {
    const any = picked().length > 0;
    list.querySelectorAll('.bib-pick').forEach((cb, i) => { cb.checked = !any && !state.refs[i].dup; });
    syncBib();
  });
  list.addEventListener('change', (e) => { if (e.target.classList.contains('bib-pick')) syncBib(); });
  $('bib-quick').addEventListener('click', async () => {
    const items = picked();
    if (!items.length) return toast('Chưa chọn mục nào.');
    const topicId = $('bib-topic').value;
    let n = 0;
    for (const r of items) { await saveMetadataOnly(r, { topicId }); n++; }
    toast(`Đã nhập ${n} paper (chỉ metadata). Mở từng paper và bấm "Trích xuất lại" khi cần.`);
    parseBib('');
  });
  $('bib-full').addEventListener('click', async () => {
    const items = picked();
    if (!items.length) return toast('Chưa chọn mục nào.');
    const n = await addEntries(items);
    state.tab = 'batch';
    drawTab();
    toast(`Đã đưa ${n} mục vào danh sách hàng loạt. Bấm "Tra cứu metadata" rồi chọn mục để trích xuất và lưu.`, 5000);
  });
}

/* ---------------- Link ---------------- */

/** Ô nhập ở tab đầu: link / arXiv ID / DOI thì tra cứu thẳng, còn lại là tên paper / từ khoá thì tìm kiếm. */
function submitQuery() {
  const q = $('add-q').value.trim();
  if (!q) return;
  if (isPaperIdentifier(q)) { $('add-search').innerHTML = ''; search.q = ''; resolveLink(); } else runSearch(q);
}

/* ---------------- Tìm paper theo tên / từ khoá ---------------- */

const THIS_YEAR = new Date().getFullYear();
const YEAR_OPTS = [['', 'Mọi năm'], ...[0, 1, 3, 6].map((k) => [`${THIS_YEAR - k}-`, `Từ ${THIS_YEAR - k}`]), [`-${THIS_YEAR - 7}`, `Trước ${THIS_YEAR - 6}`]];
const SORT_OPTS = [['relevance', 'Liên quan nhất'], ['cites', 'Nhiều trích dẫn'], ['newest', 'Mới nhất']];
const PAGE = 20;

async function runSearch(q, { more = false } = {}) {
  if (search.loading) return;
  if (!more) Object.assign(search, { q, items: [], offset: 0, total: 0, source: '', picked: new Set() });
  search.loading = true;
  $('add-preview').innerHTML = '';
  $('add-result').innerHTML = '';
  setStatus('add-status', '');
  if (!more) drawSearch();
  else { const b = $('as-more'); if (b) { b.disabled = true; b.textContent = 'Đang tải…'; } }
  try {
    const r = await api.litSearch(q, { year: search.year, limit: PAGE, offset: search.offset });
    if (search.q !== q) return; // người dùng đã tìm câu khác
    const seen = new Set(search.items.map((x) => x.id));
    search.items.push(...(r.items || []).map(searchItem).filter((x) => x.title && !seen.has(x.id)));
    search.offset += PAGE;
    search.total = r.total || search.items.length;
    search.source = r.source || '';
  } catch (e) {
    setStatus('add-status', escapeHtml(e.message), 'err');
  } finally { search.loading = false; }
  drawSearch();
}

const fmtAuthors = (a) => (a.length > 4 ? `${a.slice(0, 3).join(', ')}, …, ${a[a.length - 1]}` : a.join(', '));

function searchRow(it) {
  const dup = findDuplicate({ arxivId: it.arxivId, doi: it.doi, title: it.title });
  const meta = [fmtAuthors(it.authors), [it.venue, it.year].filter(Boolean).join(' · ')].filter(Boolean).join(' — ');
  const abs = it.tldr || it.abstract;
  return `<div class="as-item${dup ? ' has' : ''}">
    ${dup ? '<span class="as-check"></span>' : `<label class="as-check" title="Tích để thêm nhiều bài một lúc"><input type="checkbox" data-as-pick="${escapeHtml(it.id)}" ${search.picked.has(it.id) ? 'checked' : ''}></label>`}
    <div class="as-body">
      <div class="as-title">${it.url ? `<a href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a>` : escapeHtml(it.title)}</div>
      ${meta ? `<div class="as-meta">${escapeHtml(meta)}</div>` : ''}
      ${abs ? `<div class="as-abs">${it.tldr ? '<b>TL;DR</b> ' : ''}${escapeHtml(abs.length > 320 ? `${abs.slice(0, 320)}…` : abs)}</div>` : ''}
      <div class="as-facts">
        ${it.cites != null ? `<span>↗ ${it.cites.toLocaleString('vi-VN')} trích dẫn</span>` : ''}
        ${it.arxivId ? `<span>arXiv:${escapeHtml(it.arxivId)}</span>` : (it.doi ? `<span>DOI ${escapeHtml(it.doi)}</span>` : '')}
        ${it.pdfUrl ? `<a href="${escapeHtml(it.pdfUrl)}" target="_blank" rel="noopener">[PDF]</a>` : ''}
        ${dup ? `<a class="as-have" href="#/paper/${dup.id}">✓ Đã có trong thư viện</a>` : ''}
      </div>
    </div>
    <div class="as-act">${dup ? `<a class="btn sm" href="#/paper/${dup.id}">Mở</a>` : `<button class="sm primary" data-as-use="${escapeHtml(it.id)}" ${it.query ? '' : 'disabled title="Bài này không có arXiv ID, DOI hay link để tra cứu"'}>Chọn</button>`}</div>
  </div>`;
}

function drawSearch() {
  const box = $('add-search');
  if (!box) return;
  if (!search.q) { box.innerHTML = ''; return; }
  const local = matchLibrary(store.papers, search.q, 5);
  const items = sortItems(search.items, search.sort);
  const first = search.loading && !search.items.length;
  const count = search.items.length
    ? `${search.items.length}${search.total > search.items.length ? ` / khoảng ${search.total.toLocaleString('vi-VN')}` : ''} kết quả`
    : 'không có kết quả';
  box.innerHTML = `${local.length ? `<div class="as-local"><div class="as-head">Trong thư viện của bạn · ${local.length}</div>
      ${local.map((p) => `<a class="as-local-item" href="#/paper/${p.id}"><b>${escapeHtml(p.title || '(không tên)')}</b><span class="hint">${escapeHtml([[].concat(p.authors || []).slice(0, 3).join(', '), p.venue, p.year].filter(Boolean).join(' · '))}</span></a>`).join('')}</div>` : ''}
    <div class="as-bar">
      <span class="as-head">Trên mạng · ${first ? 'đang tìm…' : count}${search.source ? ` <span class="hint">(${escapeHtml(search.source)})</span>` : ''}</span>
      <span class="spacer"></span>
      <select id="as-year" title="Năm xuất bản">${YEAR_OPTS.map(([v, l]) => `<option value="${v}" ${search.year === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="as-sort" title="Sắp xếp các kết quả đã tải">${SORT_OPTS.map(([v, l]) => `<option value="${v}" ${search.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    ${first ? spinner('Đang tìm trên Semantic Scholar…') : ''}
    <div class="as-list">${items.map(searchRow).join('')}</div>
    ${search.items.length && search.items.length < search.total ? '<div class="row" style="justify-content:center;margin-top:10px"><button id="as-more" class="sm">Xem thêm kết quả</button></div>' : ''}
    <div id="as-selbar" class="as-selbar" hidden><span id="as-selinfo"></span><span class="spacer"></span><button class="sm ghost" id="as-selclear">Bỏ chọn</button><button class="sm primary" id="as-seladd">Thêm vào hàng loạt</button></div>`;
  const selbar = () => {
    $('as-selbar').hidden = !search.picked.size;
    $('as-selinfo').textContent = `Đã chọn ${search.picked.size} bài`;
  };
  selbar();
  $('as-year').addEventListener('change', (e) => { search.year = e.target.value; runSearch(search.q); });
  $('as-sort').addEventListener('change', (e) => { search.sort = e.target.value; drawSearch(); });
  $('as-more')?.addEventListener('click', () => runSearch(search.q, { more: true }));
  $('as-selclear').addEventListener('click', () => { search.picked.clear(); drawSearch(); });
  $('as-seladd').addEventListener('click', async () => {
    const entries = search.items.filter((x) => search.picked.has(x.id)).map(toBatchEntry);
    search.picked.clear();
    state.tab = 'batch';
    drawTab();
    const n = await addEntries(entries);
    toast(`Đã đưa ${n} bài vào danh sách hàng loạt. App đang tra cứu từng bài.`, 3500);
  });
  const list = box.querySelector('.as-list');
  list.addEventListener('change', (e) => {
    const c = e.target.closest('[data-as-pick]');
    if (!c) return;
    if (c.checked) search.picked.add(c.dataset.asPick); else search.picked.delete(c.dataset.asPick);
    selbar();
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-as-use]');
    if (!b) return;
    const it = search.items.find((x) => x.id === b.dataset.asUse);
    if (!it?.query) return;
    list.querySelectorAll('.as-item.on').forEach((x) => x.classList.remove('on'));
    b.closest('.as-item').classList.add('on');
    $('add-q').value = it.query;
    resolveLink({ fallback: it });
    $('add-preview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

/** Source dựng từ chính kết quả tìm kiếm (tên, tác giả, abstract), dùng khi tra cứu theo DOI / link không lấy được nội dung. */
function sourceFromSearch(it, why) {
  const authors = it.authors.join(', ');
  return {
    url: it.url, title: it.title, authors, venue: it.venue, year: it.year, arxivId: it.arxivId, doi: it.doi, s2Id: '',
    citationCount: it.cites, kind: it.abstract ? `abstract (${search.source || 'kết quả tìm kiếm'})` : '',
    text: it.abstract ? `Title: ${it.title}\nAuthors: ${authors}\n\nAbstract:\n${it.abstract}` : '',
    pdfUrl: it.pdfUrl, tldr: it.tldr, venueHints: {}, warnings: why ? [`Không tra cứu đầy đủ được từ ${it.doi ? 'DOI' : 'link'} (${why.length > 90 ? `${why.slice(0, 90)}…` : why}). App dùng tên, tác giả, abstract từ kết quả tìm kiếm.`] : [],
  };
}

/** Tra cứu chuỗi trong ô nhập. fallback: kết quả tìm kiếm vừa chọn, dùng khi tra cứu lỗi hoặc thiếu abstract. */
async function resolveLink({ fallback = null } = {}) {
  const q = $('add-q').value.trim();
  if (!q) return;
  $('add-resolve').disabled = true;
  $('add-preview').innerHTML = '';
  $('add-result').innerHTML = '';
  try {
    let src;
    try {
      src = await resolveQuery(q, { onStatus: (m) => showProgress('add-status', m, { expectedMs: 8000 }) });
      if (fallback?.abstract && (src.text || '').length < fallback.abstract.length) {
        src.text = sourceFromSearch(fallback, '').text;
        src.kind = src.kind || 'abstract (kết quả tìm kiếm)';
      }
    } catch (e) {
      if (!fallback) throw e;
      src = sourceFromSearch(fallback, e.message.replace(/\.$/, ''));
    }
    state.source = src;
    setStatus('add-status', '');
    $('add-preview').innerHTML = `<div class="source-preview">
      <div><b>${escapeHtml(src.title || '(chưa rõ tên)')}</b></div>
      <div class="hint">${escapeHtml(src.authors || '')}${src.year ? ` · ${escapeHtml(src.year)}` : ''}${src.venue ? ` · ${escapeHtml(src.venue)}` : ''}${src.citationCount != null ? ` · ↗ ${src.citationCount} trích dẫn` : ''}</div>
      <div class="row wrap" style="margin-top:6px"><span class="badge">${escapeHtml(src.kind || 'không rõ')}</span><span class="badge">${(src.text || '').length.toLocaleString('vi-VN')} ký tự</span>${src.pdfBytes ? `<span class="badge accent">PDF ${fmtSize(src.pdfBytes.length)}</span>` : (src.pdfUrl ? '<span class="badge">có link PDF</span>' : '')}${src.arxivId ? `<span class="badge">arXiv:${escapeHtml(src.arxivId)}</span>` : ''}</div>
      ${src.tldr ? `<div class="hint" style="margin-top:6px"><b>TL;DR (S2):</b> ${escapeHtml(src.tldr)}</div>` : ''}
      ${(src.warnings || []).length ? `<div class="hint" style="color:var(--warn)">${src.warnings.map(escapeHtml).join('<br>')}</div>` : ''}
      <pre>${escapeHtml((src.text || '').slice(0, 1200))}${(src.text || '').length > 1200 ? '…' : ''}</pre>
      <div class="row" style="margin-top:8px"><button id="add-extract" class="primary">Trích xuất ghi chú</button><button id="add-meta-only" class="sm" title="Lưu ngay không gọi model">Lưu chỉ metadata</button></div></div>`;
    $('add-extract').addEventListener('click', () => extract(src));
    $('add-meta-only').addEventListener('click', async () => {
      const p = await saveMetadataOnly({ title: src.title, authors: (src.authors || '').split(',').map((s) => s.trim()).filter(Boolean), year: src.year, venue: src.venue, doi: src.doi, arxivId: src.arxivId, url: src.url, abstract: src.text?.split('Abstract:')[1]?.trim() || '' });
      if (src.pdfBytes) { const up = await api.uploadPdf(src.pdfBytes, src.pdfName); const { savePaper } = await import('../store.js'); await savePaper({ ...p, pdfId: up.id, pdfName: up.name }); }
      toast('Đã lưu metadata.'); location.hash = `#/paper/${p.id}`;
    });
  } catch (e) {
    setStatus('add-status', escapeHtml(e.message), 'err');
  } finally { $('add-resolve').disabled = false; }
}

/* ---------------- PDF ---------------- */

function showChip() {
  const chip = $('add-chip');
  if (!chip) return;
  chip.hidden = !state.pdf;
  $('add-drop').hidden = !!state.pdf;
  $('add-extract').disabled = !state.pdf;
  if (state.pdf) $('add-chip-text').textContent = `📄 ${state.pdf.pdfName} (${fmtSize(state.pdf.size)}${state.pdf.pages ? ` · ~${state.pdf.pages} trang` : ''})`;
}

async function acceptPdf(file) {
  if (!file) return;
  try {
    state.pdf = await acceptPdfFile(file);
    showChip();
    setStatus('add-status', 'Đã nạp PDF. Bấm "Trích xuất ghi chú".', 'ok');
  } catch (e) { setStatus('add-status', escapeHtml(e.message), 'err'); }
}

/* ---------------- Trích xuất + xác nhận ---------------- */

const ADD_JOB = 'add:extract';

async function extract(source) {
  if (jobRunning(ADD_JOB)) return toast('Đang trích xuất một paper khác, chờ xong rồi thử lại.', 3000);
  $('add-result').innerHTML = '';
  const job = runJob(ADD_JOB, (update) => runExtraction(source, { onStatus: (m) => update(m) }), {
    label: 'Trích xuất paper mới', title: source.title || source.pdfName || source.url || '', href: '#/add',
    here: () => location.hash.startsWith('#/add'), expectedMs: () => 50000,
    doneText: 'Đã trích xuất xong. Mở để kiểm tra rồi lưu vào thư viện.',
  });
  followAdd(job);
}

/** Thanh tiến độ trích xuất ở trang Thêm paper. */
function followAdd(job) {
  if ($('add-extract')) $('add-extract').disabled = true;
  followJob(job, $('add-status'), { expectedMs: 50000, onDone: (j) => { if ($('add-extract')) $('add-extract').disabled = false; showAddResult(j); } });
}

function showAddResult(j) {
  j.shown = true;
  if (j.error) return setStatus('add-status', escapeHtml(j.error), 'err');
  const r = j.result;
  state.result = r;
  state.savedId = null;
  setStatus('add-status', r.source.warning ? `⚠️ ${escapeHtml(r.source.warning)}` : 'Xong. Kiểm tra rồi bấm <b>Lưu vào thư viện</b>.', r.source.warning ? 'err' : 'ok');
  renderConfirm(r);
}

function renderConfirm(r) {
  const { extraction, meta, suggestion, duplicate } = r;
  const scores = new Map((suggestion.ranked || []).map((x) => [x.topicId, x.score]));
  const sorted = [...store.topics].sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0));
  const chosen = duplicate?.topicId || suggestion.topicId || 't_inbox';
  const box = $('add-result');
  box.innerHTML = `<div class="card" style="margin-top:12px">
    <div class="row wrap"><b style="font-size:14px">${escapeHtml(extraction.title || r.source.title || '(chưa có tên)')}</b></div>
    <div class="hint">${escapeHtml(extraction.one_liner || '')}</div>
    <div class="row wrap" style="margin:6px 0 10px"><span class="badge conf-${escapeHtml(extraction.confidence)}">độ tin cậy: ${escapeHtml(extraction.confidence || '?')}</span>
      <span class="badge">${escapeHtml(meta.provider)}${meta.model ? `/${escapeHtml(meta.model)}` : ''}${meta.elapsedMs ? ` · ${(meta.elapsedMs / 1000).toFixed(1)}s` : ''}</span>${meta.pdfMode ? `<span class="badge accent">${escapeHtml(meta.pdfMode)}</span>` : ''}
      ${meta.usage ? `<span class="badge" title="token vào/ra">${meta.usage.input_tokens ?? meta.usage.prompt_tokens ?? meta.usage.promptTokenCount ?? '?'} → ${meta.usage.output_tokens ?? meta.usage.completion_tokens ?? meta.usage.candidatesTokenCount ?? '?'} token</span>` : ''}</div>
    <div class="sections">${renderSections(extraction, { openFirst: true })}</div>
    ${duplicate ? `<div class="dup-warn">Thư viện đã có <b>${escapeHtml(duplicate.title)}</b>.
      <div class="row" style="margin-top:6px"><label class="row" style="gap:4px"><input type="radio" name="dup" value="update" checked> Cập nhật bản đã lưu (giữ ghi chú, trạng thái, đánh giá)</label>
      <label class="row" style="gap:4px"><input type="radio" name="dup" value="new"> Lưu thành bản mới</label></div></div>` : ''}
    <div class="form-grid" style="margin-top:10px">
      <label class="field"><span class="label-text">Thư mục chủ đề</span>
        <select id="add-topic">${sorted.map((t) => `<option value="${t.id}" ${t.id === chosen && !suggestion.isNew ? 'selected' : ''}>${escapeHtml(t.name)}${scores.get(t.id) ? ` — gợi ý ${scores.get(t.id)}` : ''}</option>`).join('')}<option value="__new__" ${suggestion.isNew ? 'selected' : ''}>➕ Tạo thư mục mới…</option></select>
        <span class="hint" id="add-topic-why"></span></label>
      <label class="field" id="add-newtopic-wrap" ${suggestion.isNew ? '' : 'hidden'}><span class="label-text">Tên thư mục mới</span><input type="text" id="add-newtopic" value="${escapeHtml(suggestion.newName || '')}"></label>
      <label class="field full"><span class="label-text">Ghi chú cá nhân (tuỳ chọn)</span><textarea id="add-notes" rows="2"></textarea></label>
    </div>
    <div class="row"><button id="add-save" class="primary">${duplicate ? 'Lưu / cập nhật' : 'Lưu vào thư viện'}</button><span id="add-save-status" class="status"></span></div></div>`;
  $('add-topic-why').innerHTML = suggestion.isNew
    ? `Model đề xuất chủ đề mới: <b>${escapeHtml(suggestion.newName)}</b>. Bạn có thể đổi sang thư mục có sẵn.`
    : ((suggestion.ranked || []).slice(0, 3).map((x) => `${x.name} (${x.score})`).join(' · ') || 'Không đủ tín hiệu để gợi ý — chọn thủ công.');
  $('add-topic').addEventListener('change', (e) => { $('add-newtopic-wrap').hidden = e.target.value !== '__new__'; });
  $('add-save').addEventListener('click', save);
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function save() {
  if (state.saving || !state.result) return;
  if (state.savedId) { location.hash = `#/paper/${state.savedId}`; return; }
  const sel = $('add-topic').value;
  const newName = sel === '__new__' ? $('add-newtopic').value.trim() : '';
  if (sel === '__new__' && !newName) return setStatus('add-save-status', 'Nhập tên thư mục mới.', 'err');
  const dupMode = document.querySelector('input[name="dup"]:checked')?.value;
  const existingId = state.result.duplicate && dupMode !== 'new' ? state.result.duplicate.id : null;
  state.saving = true;
  $('add-save').disabled = true;
  setStatus('add-save-status', spinner('Đang lưu…'));
  try {
    const { paper, updated } = await savePaperFromExtraction({
      extraction: state.result.extraction, meta: state.result.meta, source: state.result.source,
      topicId: sel === '__new__' ? null : sel, newTopicName: newName, userNotes: $('add-notes').value, existingId,
    });
    if (state.result.inboxId) { await api.inboxRemove(state.result.inboxId); await refreshInbox(); drawInbox(); }
    state.savedId = paper.id;
    $('add-save').textContent = updated ? '✓ Đã cập nhật — mở paper' : '✓ Đã lưu — mở paper';
    $('add-save').disabled = false;
    setStatus('add-save-status', `${updated ? 'Đã cập nhật' : 'Đã lưu'} vào <b>${escapeHtml(topicById(paper.topicId)?.name || '')}</b>.`, 'ok');
    toast(updated ? 'Đã cập nhật paper.' : 'Đã lưu paper.');
    state.pdf = null;
    showChip();
  } catch (e) {
    setStatus('add-save-status', escapeHtml(e.message), 'err');
    $('add-save').disabled = false;
  } finally { state.saving = false; }
}

async function createBlank() {
  const { emptyExtraction } = await import('../schema.js');
  const { savePaper } = await import('../store.js');
  const e = emptyExtraction();
  e.title = 'Note trống';
  const p = await savePaper({ title: 'Note trống', url: $('add-url').value.trim(), topicId: 't_inbox', extraction: e, userNotes: $('add-text').value.trim(), status: 'to-read', rating: 0 });
  location.hash = `#/paper/${p.id}?tab=edit`;
}

/** Chuyển sang tab hàng loạt với danh sách file PDF. */
function toBatch(files) {
  pendingFiles = files;
  state.tab = 'batch';
  drawTab();
}
