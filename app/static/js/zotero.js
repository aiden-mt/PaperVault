// Nhập thẳng từ thư viện Zotero trên máy (trang Thêm paper → tab Zotero / .bib / .ris).
// Máy chủ đọc bản chép của zotero.sqlite (api.zoteroScan) và chép PDF vào app (api.zoteroPdf); trang này chọn mục,
// đổi collection thành chủ đề rồi tạo paper chỉ có metadata (không gọi model), kèm PDF, ghi chú và highlight.
import { api } from './api.js';
import { store, findDuplicate, savePaper, saveTopic } from './store.js';
import { saveMetadataOnly } from './extract.js';
import { escapeHtml, uid, fmtSize } from './util.js';
import { toast, selectAllHtml, syncSelectAll } from './ui.js';

let lib = null; // kết quả quét gần nhất
let running = false;

const colPath = (c, byKey) => { const out = []; for (let x = c, k = 0; x && k < 10; x = byKey.get(x.parent), k++) out.unshift(x.name); return out; };

export function zoteroCardHtml() {
  return `<div class="zt-card" id="zt-card">
    <div class="row wrap"><b>Nhập thẳng từ Zotero trên máy</b><span class="spacer"></span><button type="button" class="sm primary" id="zt-scan">Đọc thư viện Zotero</button></div>
    <div class="hint">Lấy tên, tác giả, năm, DOI, abstract, tag, collection, ghi chú, highlight và file PDF, không cần xuất file, không gọi model.
      Mendeley: <i>File → Export</i> ra BibTeX hoặc RIS rồi chọn file ở ô bên dưới.</div>
    <div id="zt-body"></div></div>`;
}

export function bindZoteroCard(root) {
  const card = root.querySelector('#zt-card');
  if (!card) return;
  const body = card.querySelector('#zt-body');
  card.querySelector('#zt-scan').addEventListener('click', () => scan(body, ''));
  if (lib) draw(body);
}

async function scan(body, dir) {
  body.innerHTML = '<div class="hint" style="margin-top:8px">Đang đọc thư viện Zotero…</div>';
  try {
    const r = await api.zoteroScan(dir);
    if (!r.found) {
      lib = null;
      dirForm(body, 'Không thấy thư viện Zotero ở chỗ mặc định (<code>~/Zotero</code>).');
      return;
    }
    lib = r;
    lib.items.forEach((it) => { it.dup = findDuplicate({ url: it.url, arxivId: it.arxivId, doi: it.doi, title: it.title }); });
    draw(body);
  } catch (e) {
    dirForm(body, `<span class="status err">${escapeHtml(e.message)}</span>`, dir);
  }
}

/** Ô nhập thư mục dữ liệu Zotero (khi không thấy, thư viện trống, hoặc muốn đọc thư viện khác). */
function dirForm(body, msgHtml, value = '') {
  body.innerHTML = `<div class="zt-miss"><p>${msgHtml} Nếu bạn lưu thư viện ở chỗ khác, dán đường dẫn thư mục dữ liệu
      (Zotero: <i>Edit → Settings → Advanced → Files and Folders → Data Directory Location</i>):</p>
    <div class="row"><input id="zt-dir" placeholder="D:\\Zotero" value="${escapeHtml(value)}"><button type="button" class="sm" id="zt-dir-go">Đọc</button></div></div>`;
  const go = () => scan(body, body.querySelector('#zt-dir').value.trim());
  body.querySelector('#zt-dir-go').addEventListener('click', go);
  body.querySelector('#zt-dir').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}

function draw(body) {
  const byKey = new Map(lib.collections.map((c) => [c.key, c]));
  const cols = lib.collections.map((c) => ({ ...c, path: colPath(c, byKey) })).sort((a, b) => a.path.join('/').localeCompare(b.path.join('/'), 'vi'));
  const nPdf = lib.items.filter((x) => x.pdfs.length).length;
  const nNote = lib.items.filter((x) => x.notes.length || x.annotations.length).length;
  const nDup = lib.items.filter((x) => x.dup).length;
  if (!lib.items.length) {
    dirForm(body, `Thư viện Zotero ở <code>${escapeHtml(lib.dir)}</code> chưa có mục nào.`);
    return;
  }
  body.innerHTML = `<div class="hint" style="margin:8px 0">${escapeHtml(lib.dir)}${lib.fromBackup ? ' · đang đọc bản sao lưu (Zotero đang mở, có thể thiếu thay đổi mới nhất)' : ''}:
      <b>${lib.items.length}</b> mục, ${nPdf} có PDF, ${nNote} có ghi chú / highlight, ${cols.length} collection${nDup ? `, ${nDup} đã có trong thư viện` : ''}.
      <button type="button" class="linkish" id="zt-other">Đọc thư mục khác…</button></div>
    <div class="zt-opts">
      <label class="field"><span class="label-text">Xem</span><select id="zt-col"><option value="">Tất cả mục (${lib.items.length})</option>
        ${cols.map((c) => `<option value="${escapeHtml(c.key)}">${'\u00a0\u00a0'.repeat(c.path.length - 1)}${escapeHtml(c.name)} (${c.count})</option>`).join('')}
        <option value="-">Không thuộc collection nào (${lib.items.filter((x) => !x.collections.length).length})</option></select></label>
      <label class="field"><span class="label-text">Lưu vào chủ đề</span><select id="zt-topic">
        <option value="@col" ${cols.length ? 'selected' : ''}>Theo collection (tạo chủ đề cùng tên nếu chưa có)</option>
        ${store.topics.map((t) => `<option value="${t.id}" ${!cols.length && t.id === 't_inbox' ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}</select></label>
    </div>
    <div class="row wrap zt-checks">
      <label class="check"><input type="checkbox" id="zt-pdf" checked> Kèm file PDF (${nPdf})</label>
      <label class="check"><input type="checkbox" id="zt-notes" checked> Kèm ghi chú &amp; highlight</label>
      <label class="check"><input type="checkbox" id="zt-tags" checked> Kèm tag</label>
    </div>
    <div class="sel-bar compact">${selectAllHtml('zt-all')}<span id="zt-selinfo" class="sel-info"></span><span class="spacer"></span><button type="button" class="primary sm" id="zt-go">Nhập mục đã chọn</button></div>
    <div id="zt-prog"></div>
    <div class="table-wrap zt-table"><table class="data"><thead><tr><th class="pick-col"></th><th>Tiêu đề</th><th>Năm</th><th>Kèm</th><th></th></tr></thead><tbody id="zt-rows"></tbody></table></div>`;
  const $q = (s) => body.querySelector(s);
  const picked = new Set(lib.items.filter((x) => !x.dup).map((x) => x.key));
  const visible = () => {
    const c = $q('#zt-col').value;
    return lib.items.filter((x) => (!c ? true : c === '-' ? !x.collections.length : x.collections.includes(c)));
  };
  const drawRows = () => {
    const list = visible();
    $q('#zt-rows').innerHTML = list.slice(0, 500).map((x) => `<tr><td class="pick-col"><input type="checkbox" class="zt-pick" data-k="${escapeHtml(x.key)}" ${picked.has(x.key) ? 'checked' : ''}></td>
      <td><b>${escapeHtml(x.title)}</b><div class="hint">${escapeHtml(x.authors.slice(0, 3).join(', '))}${x.venue ? ` · ${escapeHtml(x.venue.slice(0, 50))}` : ''}</div></td>
      <td>${escapeHtml(x.year)}</td>
      <td class="hint">${[x.pdfs.length ? '📄 PDF' : '', x.notes.length ? `📝 ${x.notes.length}` : '', x.annotations.length ? `🖍 ${x.annotations.length}` : ''].filter(Boolean).join(' · ')}</td>
      <td>${x.dup ? `<a class="badge ok" href="#/paper/${x.dup.id}">đã có</a>` : ''}</td></tr>`).join('')
      + (list.length > 500 ? `<tr><td></td><td colspan="4" class="hint">… và ${list.length - 500} mục nữa (vẫn được nhập nếu đang chọn).</td></tr>` : '');
    sync();
  };
  const sync = () => {
    const list = visible();
    const n = list.filter((x) => picked.has(x.key)).length;
    syncSelectAll($q('#zt-all'), list.filter((x) => !x.dup).length || list.length, n);
    $q('#zt-selinfo').textContent = picked.size ? `Đã chọn ${picked.size}` : '';
    $q('#zt-go').disabled = !picked.size || running;
  };
  $q('#zt-col').addEventListener('change', drawRows);
  $q('#zt-other').addEventListener('click', () => dirForm(body, 'Đọc một thư viện Zotero khác.', lib.dir));
  $q('#zt-all').addEventListener('click', () => {
    const list = visible();
    const any = list.some((x) => picked.has(x.key));
    for (const x of list) { if (any) picked.delete(x.key); else if (!x.dup) picked.add(x.key); }
    drawRows();
  });
  $q('#zt-rows').addEventListener('change', (e) => {
    const cb = e.target.closest('.zt-pick');
    if (!cb) return;
    if (cb.checked) picked.add(cb.dataset.k); else picked.delete(cb.dataset.k);
    sync();
  });
  $q('#zt-go').addEventListener('click', () => runImport(body, lib.items.filter((x) => picked.has(x.key)), {
    topic: $q('#zt-topic').value, pdf: $q('#zt-pdf').checked, notes: $q('#zt-notes').checked, tags: $q('#zt-tags').checked, cols, byKey,
  }));
  drawRows();
}

/** Chủ đề cho từng collection: dùng chủ đề trùng tên nếu có, chưa có thì tạo. Tên trùng giữa các nhánh thì ghép "Cha / Con". */
async function topicsFor(items, cols) {
  const used = new Set(items.flatMap((x) => x.collections));
  const leafCount = new Map();
  for (const c of cols) leafCount.set(c.name.toLowerCase(), (leafCount.get(c.name.toLowerCase()) || 0) + 1);
  const map = new Map();
  for (const c of cols) {
    if (!used.has(c.key)) continue;
    const name = leafCount.get(c.name.toLowerCase()) > 1 ? c.path.join(' / ') : c.name;
    let t = store.topics.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!t) t = await saveTopic({ name, description: 'Nhập từ collection Zotero', keywords: [] });
    map.set(c.key, t.id);
  }
  return map;
}

async function runImport(body, items, opt) {
  if (running || !items.length) return;
  running = true;
  const prog = body.querySelector('#zt-prog');
  const go = body.querySelector('#zt-go');
  if (go) go.disabled = true;
  let stop = false;
  const show = (i, msg = '') => {
    if (!prog.isConnected) return;
    prog.innerHTML = `<div class="zt-prog"><div class="budget-meter"><i style="width:${Math.round((i / items.length) * 100)}%"></i></div>
      <div class="row"><span class="hint">Đang nhập ${i}/${items.length}${msg ? ` · ${escapeHtml(msg)}` : ''}</span><span class="spacer"></span><button type="button" class="sm ghost" id="zt-stop">Dừng</button></div></div>`;
    prog.querySelector('#zt-stop').onclick = () => { stop = true; };
  };
  let done = 0;
  let pdfs = 0;
  let bytes = 0;
  const errs = [];
  try {
    const colTopic = opt.topic === '@col' ? await topicsFor(items, opt.cols) : null;
    for (const [i, it] of items.entries()) {
      if (stop) break;
      show(i, it.title.slice(0, 60));
      try {
        const tids = colTopic ? [...new Set(it.collections.map((k) => colTopic.get(k)).filter(Boolean))] : [opt.topic];
        const topicId = tids[0] || 't_inbox';
        const p = await saveMetadataOnly({ ...it, keywords: opt.tags ? it.tags.map((t) => t.toLowerCase()) : [], type: it.type }, { topicId });
        const patch = {};
        if (tids.length > 1) patch.topicIds = tids;
        if (opt.notes && it.notes.length) patch.userNotes = `Ghi chú từ Zotero:\n\n${it.notes.join('\n\n---\n\n')}`;
        if (opt.notes && it.annotations.length) {
          const at = new Date().toISOString();
          patch.annotations = it.annotations.map((a) => ({ id: uid('a'), quote: a.quote || '(ghi chú)', note: a.note, page: a.page, at }));
        }
        if (opt.pdf && it.pdfs.length) {
          try {
            const up = await api.zoteroPdf(it.pdfs[0]);
            patch.pdfId = up.id;
            patch.pdfName = up.name;
            pdfs++;
            bytes += up.size || 0;
          } catch (e) { errs.push(`${it.title.slice(0, 50)}: PDF lỗi (${e.message})`); }
        }
        if (Object.keys(patch).length) await savePaper({ ...p, ...patch });
        it.dup = p;
        done++;
      } catch (e) { errs.push(`${it.title.slice(0, 50)}: ${e.message}`); }
    }
  } finally {
    running = false;
  }
  const msg = `<div class="zt-prog ok"><b>Đã nhập ${done} paper</b>${pdfs ? `, ${pdfs} file PDF (${fmtSize(bytes)})` : ''}${stop ? ' (đã dừng giữa chừng)' : ''}.
      <a href="#/library">Mở Thư viện</a>. Paper chỉ có metadata: mở từng paper, bấm <b>Trích xuất lại</b> khi cần ghi chú đầy đủ.
      ${errs.length ? `<details><summary>${errs.length} lỗi</summary><ul>${errs.slice(0, 30).map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul></details>` : ''}</div>`;
  if (body.isConnected && lib) {
    draw(body); // vẽ lại: mục vừa nhập hiện "đã có" và không còn được chọn
    const p2 = body.querySelector('#zt-prog');
    if (p2) p2.innerHTML = msg;
  }
  toast(`Đã nhập ${done} paper từ Zotero.`, 4000, 'ok');
}
