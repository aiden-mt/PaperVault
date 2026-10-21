// So sánh nhiều paper: bảng chuẩn, biểu đồ metric cùng dataset, tổng hợp related work bằng LLM, xuất Markdown/CSV/BibTeX/LaTeX/Word.
import { api } from '../api.js';
import { store, onChange, topicOf, paperById, saveSettings } from '../store.js';
import { escapeHtml, download, copyText, norm, STATUS_LABEL } from '../util.js';
import { $, toast, setStatus, spinner, topicBadge, mdToHtml, selectAllHtml, syncSelectAll } from '../ui.js';
import { runJob, getJob, jobRunning, followJob } from '../bgjobs.js';
import { readableChatMd, stripMarker } from '../readable.js';
import { richBlock } from '../richtext.js';
import { synthesisToMarkdown, bibtexAll, bibtexKeys, synthesisToLatex, wordDocument, synthesisToWordHtml, bibtexKey, latexEscape } from '../markdown.js';
import { COLUMNS, COL_GROUPS, DEFAULT_COLS, ALL_COLS, pickColumns, colLabel, cellValue, tableMarkdown, tableCsv, tableLatex, tableWordHtml } from '../compare-cols.js';
import { sourceLang, notesIn } from '../notes-i18n.js';
import { synthesize, hasCredentials } from '../llm.js';
import { venueBadge } from '../venue.js';
import { htmlToDocx, DOCX_MIME } from '../docx.js';
import { analyzeMetrics } from '../compare-metrics.js';
import { rich, titleHtml } from '../richtext.js';

let lastSynthesis = null;

function selectedPapers() {
  return [...store.selected].map(paperById).filter(Boolean);
}

function lowerIsBetter(name) {
  return /latency|time|ms\b|wer|cer|fid|perplexity|ppl|loss|error|memory|params|flops|size|cost|mae|mse|rmse/i.test(name);
}

// Ký hiệu ngắn cho paper trong bảng dataset dùng chung (P1, P2…), tên đầy đủ khi rê chuột.
const paperTag = (i) => `P${i + 1}`;

function sharedTableHtml(papers, shared) {
  const head = papers.map((p, i) => `<th class="ds-p"><button type="button" class="ds-tag" data-ppop="${p.id}" title="${escapeHtml(p.title)} · bấm để xem tóm tắt">${paperTag(i)}</button></th>`).join('');
  const rows = shared.map((d) => `<tr><th class="ds-name">${escapeHtml(d.label)}<span class="ds-n">${d.papers.size}/${papers.length}</span></th>${papers.map((p) => {
    const uses = d.papers.get(p.id);
    if (!uses) return '<td class="ds-no" title="Không dùng">–</td>';
    const vals = uses.filter((u) => u.raw).map((u) => `<span class="ds-val" title="${escapeHtml(u.metric)}">${escapeHtml(u.raw)}</span>`).join(' ');
    return `<td class="ds-yes" title="${escapeHtml(p.title)}${uses.length ? `: ${escapeHtml(uses.map((u) => `${u.metric}${u.raw ? ` ${u.raw}` : ''}`).join(', '))}` : ''}"><span class="ds-cell"><i></i><span class="ds-tick">✓</span><span class="ds-vals">${vals}</span></span></td>`;
  }).join('')}</tr>`).join('');
  const legend = papers.map((p, i) => `<button type="button" class="ds-leg" data-ppop="${p.id}" title="Bấm để xem tóm tắt paper"><b>${paperTag(i)}</b> ${titleHtml(p.title)}</button>`).join('');
  return `<h4 class="ds-title">Dataset / benchmark dùng chung <span class="hint">(${shared.length} dataset được ≥ 2 paper dùng · số bên cạnh ✓ là kết quả paper báo cáo)</span></h4>
    <div class="table-wrap ds-wrap" data-noresize><table class="data ds-table"><thead><tr><th class="ds-name">Dataset</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <div class="ds-legend">${legend}</div>`;
}

function chartsHtml(papers) {
  const { shared, charts } = analyzeMetrics(papers);
  if (!shared.length) return '<span class="hint">Các paper đang chọn chưa dùng chung dataset / benchmark nào (theo cột Benchmark, Dataset và Kết quả số). Kiểm tra lại tên dataset ở tab Chỉnh sửa nếu bạn biết chúng có dùng chung.</span>';
  const chartList = charts.map((g) => {
    const lower = lowerIsBetter(g.name);
    const rows = g.rows.slice().sort((a, b) => (lower ? a.value - b.value : b.value - a.value));
    const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
    const bestVal = rows[0].value;
    return `<div class="metric-chart"><h4>${escapeHtml(g.name)}${g.dataset ? ` <span class="hint">@ ${escapeHtml(g.dataset)}</span>` : ''} <span class="hint">${lower ? '(thấp hơn tốt hơn)' : '(cao hơn tốt hơn)'}</span></h4>
      <div class="bars">${rows.map((r) => `<div class="bar-row" data-go="#/paper/${r.paper.id}" title="${escapeHtml(r.paper.title)}: ${escapeHtml(r.raw)}${r.baseline ? ` (baseline ${escapeHtml(r.baseline)})` : ''}">
        <span class="bar-lbl">${escapeHtml(r.paper.title)}</span>
        <span class="bar-track"><span class="bar-fill ${r.value === bestVal ? 'best' : ''}" style="width:${(Math.abs(r.value) / max) * 100}%"></span></span>
        <span class="bar-val">${escapeHtml(r.raw)}</span></div>`).join('')}</div></div>`;
  }).join('');
  return `${sharedTableHtml(papers, shared)}
    ${chartList ? `<h4 class="ds-title">Biểu đồ kết quả trên cùng dataset</h4><p class="hint ds-warn">Con số lấy từ ghi chú của từng paper; thiết lập (split, backbone, có dùng thêm dữ liệu hay không) có thể khác nhau, nên xem như tham khảo.</p>${chartList}`
      : '<p class="hint">Chưa có cặp kết quả số nào cùng metric trên cùng dataset để vẽ biểu đồ (thường do ghi chú chỉ ghi "see tables"). Bảng trên vẫn cho biết paper nào dùng dataset nào.</p>'}`;
}

/* ---------- Khung Chọn paper: kéo đổi độ rộng, thu nhỏ (nhớ trong trình duyệt) ---------- */
const PICK_W = 'pv.cmpPickW';
const PICK_MIN = 'pv.cmpPickMin';
const PICK_DEFAULT = 340;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* bộ nhớ bị chặn */ } };

function setupPickPane() {
  const layout = $('cmp-layout');
  const split = $('cmp-split');
  const clampW = (w) => Math.round(Math.max(220, Math.min(w, Math.max(260, layout.offsetWidth * 0.6))));
  const setW = (w, save = true) => { const v = clampW(w); layout.style.setProperty('--pick-w', `${v}px`); if (save) lsSet(PICK_W, String(v)); return v; };
  const setMin = (on) => { layout.classList.toggle('pick-min', on); lsSet(PICK_MIN, on ? '1' : null); };
  setW(Number(lsGet(PICK_W)) || PICK_DEFAULT, false);
  setMin(lsGet(PICK_MIN) === '1');
  $('cmp-pick-min').addEventListener('click', () => setMin(true));
  $('cmp-pick-open').addEventListener('click', () => setMin(false));
  split.addEventListener('dblclick', () => { setW(PICK_DEFAULT); lsSet(PICK_W, null); });
  split.addEventListener('keydown', (e) => {
    const cur = parseFloat(getComputedStyle(layout).getPropertyValue('--pick-w')) || PICK_DEFAULT;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setW(cur + 24); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setW(cur - 24); }
  });
  split.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Tỉ lệ px màn hình / px CSS (giao diện có thể đang phóng to theo cỡ chữ).
    const z = (layout.getBoundingClientRect().width / layout.offsetWidth) || 1;
    layout.classList.add('resizing');
    document.documentElement.classList.add('col-resizing');
    const move = (ev) => setW((layout.getBoundingClientRect().right - ev.clientX) / z - 8, false);
    const up = (ev) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      layout.classList.remove('resizing');
      document.documentElement.classList.remove('col-resizing');
      // Kéo gần sát mép phải thì thu nhỏ luôn.
      const w = (layout.getBoundingClientRect().right - ev.clientX) / z;
      if (w < 150) { setMin(true); return; }
      setW(w - 8);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

/* ---------- Thẻ nổi tóm tắt paper (bấm P1, P2… trong bảng dataset dùng chung) ---------- */
let pop = null;
const closePop = () => {
  pop?.remove();
  pop = null;
  document.removeEventListener('mousedown', popOutside, true);
  document.removeEventListener('keydown', popKey, true);
  window.removeEventListener('hashchange', closePop);
};
const popOutside = (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('[data-ppop]')) closePop(); };
const popKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } };

function paperPopHtml(p, tag) {
  const e = p.extraction || {};
  const authors = Array.isArray(e.authors) ? e.authors : String(e.authors || '').split(',').map((s) => s.trim()).filter(Boolean);
  const meta = [authors.slice(0, 4).join(', ') + (authors.length > 4 ? ' và cộng sự' : ''), e.year, e.venue].filter(Boolean).join(' · ');
  const summary = e.one_liner || e.novelty || e.problem || '';
  const v = e.validation || {};
  const ds = [...new Set([...(v.benchmarks || []), ...(v.datasets || [])].map((x) => String(x).replace(/\([^)]*\)/g, '').trim()).filter(Boolean))].slice(0, 8);
  const status = STATUS_LABEL[p.status || 'to-read'];
  return `<button class="ghost sm wn-pop-x" title="Đóng (Esc)">✕</button>
    <h3>${titleHtml(p.title)}</h3>
    ${meta ? `<div class="hint">${escapeHtml(meta)}</div>` : ''}
    <div class="wn-pop-badges"><span class="badge accent">${tag}</span>${venueBadge(p.venueInfo)}${topicBadge(topicOf(p))}${p.citationCount != null ? `<span class="badge">↗ ${Number(p.citationCount).toLocaleString('vi-VN')} trích dẫn</span>` : ''}${status ? `<span class="badge">${escapeHtml(status)}</span>` : ''}</div>
    ${summary ? `<p class="wn-pop-abs">${rich(String(summary).slice(0, 420))}${String(summary).length > 420 ? '…' : ''}</p>` : ''}
    ${ds.length ? `<div class="pp-ds"><span class="hint">Dataset / benchmark:</span> ${ds.map((d) => `<span class="badge">${escapeHtml(d)}</span>`).join(' ')}</div>` : ''}
    <div class="row wrap" style="gap:6px;margin-top:10px">
      <a class="btn sm primary-link" href="#/paper/${p.id}">Mở paper</a>
      ${p.url ? `<a class="btn sm" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">Mở link</a>` : ''}
      <button class="sm" data-pp-rm>Bỏ khỏi so sánh</button>
    </div>`;
}

function openPaperPop(anchor, id, { onRemove } = {}) {
  const p = paperById(id);
  if (!p) return;
  const same = pop && pop.dataset.id === id;
  closePop();
  if (same) return; // bấm lại cùng mã thì đóng
  const tag = (anchor.querySelector('b')?.textContent || anchor.textContent || '').trim();
  pop = document.createElement('div');
  pop.className = 'wn-pop pp-pop';
  pop.dataset.id = id;
  pop.innerHTML = paperPopHtml(p, escapeHtml(tag));
  document.body.appendChild(pop);
  // Đặt cạnh mã vừa bấm, không tràn khỏi cửa sổ (body có thể bị zoom theo cỡ chữ giao diện).
  const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const vw = window.innerWidth / z;
  const vh = window.innerHeight / z;
  let left = r.right / z + 8;
  if (left + w > vw - 8) left = Math.max(8, r.left / z - w - 8);
  let top = r.top / z - 10;
  if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.querySelector('.wn-pop-x').addEventListener('click', closePop);
  pop.querySelectorAll('a[href^="#/"]').forEach((a) => a.addEventListener('click', closePop));
  pop.querySelector('[data-pp-rm]').addEventListener('click', () => { closePop(); onRemove?.(id); });
  document.addEventListener('mousedown', popOutside, true);
  document.addEventListener('keydown', popKey, true);
  window.addEventListener('hashchange', closePop);
}

export async function render(root, { query }) {
  if (query.get('ids')) query.get('ids').split(',').forEach((id) => store.selected.add(id));
  root.innerHTML = `<div class="page-head"><h1>So sánh &amp; tổng hợp</h1><span class="hint">Tên paper → Điểm mới → Dataset/Metric → Ý tưởng có thể áp dụng cho bài của mình</span></div>
    <div class="cmp-layout" id="cmp-layout">
      <div class="cmp-main">
        <div class="card"><div class="cmp-tools">
          <div class="cmp-tools-row">
            <span id="cmp-count" class="badge"></span>
            <span class="sel-pick"><button id="cmp-cols-btn" class="sm" aria-haspopup="true">Thông số hiển thị ▾</button>
              <div id="cmp-cols" class="menu col-menu" hidden></div></span>
            <button id="cmp-all-cols" class="sm ghost" title="Hiện mọi thông số đã trích xuất">Hiện tất cả</button>
            <div class="seg" id="cmp-orient" title="Hướng bảng"><button data-o="rows">Paper theo hàng</button><button data-o="cols">Paper theo cột</button></div>
            <span class="spacer"></span>
            <button id="cmp-chat" class="sm primary" title="Hỏi đáp với các paper đang so sánh"><svg class="i"><use href="#i-chat"/></svg>Chat với các paper này</button>
          </div>
          <div class="cmp-export">
            <span class="cmp-export-label">Xuất bảng</span>
            <div class="btn-group" role="group" aria-label="Xuất bảng so sánh">
              <button id="cmp-copy" title="Copy bảng dạng Markdown vào clipboard"><svg class="i"><use href="#i-copy"/></svg>Markdown</button>
              <button id="cmp-csv" title="Lưu file .csv mở bằng Excel / Google Sheets"><svg class="i"><use href="#i-download"/></svg>CSV</button>
              <button id="cmp-bib" title="Lưu references.bib của các paper đang so sánh"><svg class="i"><use href="#i-download"/></svg>BibTeX</button>
              <button id="cmp-tex" title="Lưu bảng LaTeX (tabularx + booktabs) kèm \\cite{}"><svg class="i"><use href="#i-download"/></svg>LaTeX</button>
              <button id="cmp-doc" title="Lưu file .docx mở bằng Word / Google Docs / LibreOffice"><svg class="i"><use href="#i-download"/></svg>Word</button>
            </div>
          </div>
        </div>
          <div id="cmp-lang" class="hint cmp-lang"></div>
          <div id="cmp-table" class="table-wrap cmp-wrap" style="margin-top:10px"></div></div>
        <div class="card"><h2>Dataset &amp; metric dùng chung</h2><div id="cmp-charts"></div></div>
        <div class="card"><h2>Tổng hợp related work bằng AI</h2>
          <p class="hint">Model đọc ghi chú của các paper đã chọn, nhóm theo hướng tiếp cận, so sánh, chỉ ra khoảng trống và viết bản nháp Related Work bám theo đề tài của bạn (Cài đặt → Đề tài).</p>
          <label class="field"><span class="label-text">Trọng tâm muốn nhấn mạnh (tuỳ chọn)</span><input type="text" id="syn-focus" placeholder="ví dụ: so sánh về chi phí inference và khả năng chạy trên thiết bị yếu"></label>
          <div class="row"><button id="syn-run" class="primary">Tổng hợp</button><span id="syn-status" class="status"></span></div>
          <div id="syn-out" class="synth"></div></div>
      </div>
      <div class="cmp-split" id="cmp-split" role="separator" aria-orientation="vertical" tabindex="0" title="Kéo để đổi độ rộng khung Chọn paper · bấm đúp để về mặc định"></div>
      <aside class="card cmp-pick-card">
        <button type="button" class="cmp-pick-rail" id="cmp-pick-open" title="Mở khung Chọn paper"><span>«</span><b>Chọn paper</b><span class="cmp-rail-n" id="cmp-rail-n"></span></button>
        <div class="cmp-pick-head"><h2>Chọn paper</h2><span class="spacer"></span>
          <button type="button" class="ghost sm" id="cmp-pick-min" title="Thu nhỏ khung này để bảng so sánh rộng hơn">Thu nhỏ »</button></div>
        <input type="search" id="cmp-q" placeholder="Lọc…" style="margin-bottom:8px">
        <div class="sel-bar compact">${selectAllHtml('cmp-all')}<span id="cmp-selinfo" class="sel-info"></span></div>
        <div id="cmp-pick" class="pick-list"></div></aside>
    </div>`;
  setupPickPane();

  const pickList = () => {
    const q = norm($('cmp-q').value);
    return store.papers.filter((p) => !q || norm(`${p.title} ${(p.extraction?.tags || []).join(' ')} ${topicOf(p)?.name || ''}`).includes(q));
  };
  const drawMaster = () => {
    const list = pickList();
    syncSelectAll($('cmp-all'), list.length, list.filter((p) => store.selected.has(p.id)).length);
    $('cmp-selinfo').textContent = store.selected.size ? `Đã chọn ${store.selected.size}` : '';
    $('cmp-rail-n').textContent = store.selected.size ? String(store.selected.size) : '';
    $('sel-info').innerHTML = store.selected.size ? `<a href="#/compare">${store.selected.size} paper đã chọn →</a>` : '';
  };
  const drawPick = () => {
    const list = pickList();
    $('cmp-pick').innerHTML = list.map((p) => `<label class="pick-row ${store.selected.has(p.id) ? 'on' : ''}">
      <input type="checkbox" data-id="${p.id}" ${store.selected.has(p.id) ? 'checked' : ''}>
      <span><span class="pick-t">${escapeHtml(p.title)}</span><span class="pick-m">${topicBadge(topicOf(p))} <span class="hint">${escapeHtml(p.extraction?.year || '')}</span></span></span></label>`).join('') || '<span class="hint">Không có paper khớp.</span>';
    drawMaster();
  };
  /* ---------- Cột hiển thị, hướng bảng, ngôn ngữ ---------- */
  const colKeys = () => (Array.isArray(store.settings.compareCols) && store.settings.compareCols.length ? store.settings.compareCols : DEFAULT_COLS);
  const orient = () => (store.settings.compareOrient === 'cols' ? 'cols' : 'rows');
  const viewLang = () => (store.settings.notesLang === 'en' || store.settings.notesLang === 'vi' ? store.settings.notesLang : '');
  const saveCols = (keys) => saveSettings({ compareCols: ALL_COLS.filter((k) => keys.includes(k)) });

  const drawColMenu = () => {
    const on = new Set(colKeys());
    $('cmp-cols').innerHTML = `<div class="col-menu-head"><b>Thông số hiển thị</b><span class="spacer"></span>
        <button class="linkish" data-preset="all">Tất cả</button><button class="linkish" data-preset="default">Mặc định</button><button class="linkish" data-preset="none">Bỏ hết</button></div>
      <div class="col-menu-grid">${COL_GROUPS.map(([g, label]) => `<div class="col-group"><label class="col-group-title"><input type="checkbox" data-group="${g}" ${COLUMNS.filter((c) => c.group === g).every((c) => on.has(c.key)) ? 'checked' : ''}> ${escapeHtml(label)}</label>
        ${COLUMNS.filter((c) => c.group === g).map((c) => `<label class="menu-check"><input type="checkbox" data-col="${c.key}" ${on.has(c.key) ? 'checked' : ''}> ${escapeHtml(c.vi)}</label>`).join('')}</div>`).join('')}</div>`;
    $('cmp-cols-btn').textContent = `Thông số hiển thị (${on.size}/${ALL_COLS.length}) ▾`;
    $('cmp-all-cols').hidden = on.size === ALL_COLS.length;
  };

  // Bản ghi chú theo ngôn ngữ đang hiển thị (dùng bản dịch đã lưu nếu có, chưa có thì giữ bản gốc).
  const withLang = async (rows) => {
    const lang = viewLang();
    const items = await Promise.all(rows.map(async (p) => {
      const src = sourceLang(p.extraction || {});
      if (!lang || lang === src) return { paper: p, extraction: p.extraction || {}, missing: false };
      const r = await notesIn(p, lang, { cachedOnly: true }).catch(() => null);
      return { paper: p, extraction: r ? r.extraction : (p.extraction || {}), missing: !r };
    }));
    return { items, lang: lang || 'vi' };
  };

  const cellHtml = (v) => (Array.isArray(v)
    ? (v.length ? (v.length === 1 ? escapeHtml(v[0]) : `<ul>${v.map((x) => `<li>${escapeHtml(stripMarker(x))}</li>`).join('')}</ul>`) : '<span class="muted">—</span>')
    : (v ? escapeHtml(v) : '<span class="muted">—</span>'));
  const titleCell = (p) => {
    const e = p.extraction || {};
    // Gọn: chỉ tên paper + một hàng nhãn (venue đã có trong nhãn hạng, nên bỏ dòng venue đầy đủ).
    return `<b class="cmp-title" title="${escapeHtml([p.title, e.venue].filter(Boolean).join('\n'))}">${escapeHtml(p.title)}</b><div class="cmp-tags">${venueBadge(p.venueInfo)}${e.year ? `<span class="cmp-year">${escapeHtml(String(e.year))}</span>` : ''}${topicBadge(topicOf(p))}</div>`;
  };

  let drawSeq = 0;
  const drawTable = async () => {
    if (!$('cmp-count')) return; // đã rời trang So sánh trong lúc chờ
    const rows = selectedPapers();
    const seq = ++drawSeq;
    $('cmp-count').textContent = `${rows.length} paper`;
    drawColMenuIfOpen();
    $('cmp-orient').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.o === orient()));
    $('cmp-charts').innerHTML = rows.length >= 2 ? chartsHtml(rows) : '<span class="hint">Chọn ít nhất 2 paper.</span>';
    if (!rows.length) { $('cmp-table').innerHTML = '<div class="empty">Tick chọn paper ở cột bên phải (hoặc trong Thư viện) để so sánh.</div>'; $('cmp-lang').innerHTML = ''; return; }
    const columns = pickColumns(colKeys());
    const { items, lang } = await withLang(rows);
    if (seq !== drawSeq) return;
    const missing = items.filter((x) => x.missing).length;
    $('cmp-lang').innerHTML = viewLang()
      ? `Ghi chú hiển thị bằng <b>${lang === 'en' ? 'English' : 'tiếng Việt'}</b> (đổi ở tab Ghi chú của paper hoặc Cài đặt).${missing ? ` ${missing} paper chưa có bản dịch nên đang hiện bản gốc. <button class="linkish" id="cmp-translate">Dịch ${missing} paper</button>` : ''}`
      : '';
    $('cmp-table').classList.toggle('transposed', orient() === 'cols');
    if (orient() === 'cols') {
      // Mỗi paper một cột, mỗi thông số một hàng: dễ đọc khi hiện nhiều thông số.
      const groups = COL_GROUPS.filter(([g]) => columns.some((c) => c.group === g));
      $('cmp-table').innerHTML = `<table class="data cmp-table"><thead><tr><th class="cmp-field">${lang === 'en' ? 'Field' : 'Thông số'}</th>${items.map(({ paper: p }) => `<th class="cmp-paper" data-id="${p.id}">${titleCell(p)} <button class="ghost sm" data-rm="${p.id}" title="Bỏ khỏi so sánh">✕</button></th>`).join('')}</tr></thead><tbody>
        ${groups.map(([g, vi, en]) => `<tr class="cmp-group"><td colspan="${items.length + 1}"><span>${escapeHtml(lang === 'en' ? en : vi)}</span></td></tr>${columns.filter((c) => c.group === g).map((c) => `<tr><th class="cmp-field"><div class="cmp-pin">${escapeHtml(colLabel(c, lang))}</div></th>${items.map(({ paper, extraction }) => `<td>${cellHtml(cellValue(c, paper, extraction, lang))}</td>`).join('')}</tr>`).join('')}`).join('')}
      </tbody></table>`;
    } else {
      $('cmp-table').innerHTML = `<table class="data cmp-table"><thead><tr><th class="cmp-first">${lang === 'en' ? 'Paper' : 'Tên paper'}</th>${columns.map((c) => `<th>${escapeHtml(colLabel(c, lang))}</th>`).join('')}<th></th></tr></thead><tbody>
        ${items.map(({ paper, extraction }) => `<tr data-id="${paper.id}"><td class="cmp-first"><div class="cmp-pin">${titleCell(paper)}</div></td>${columns.map((c) => `<td>${cellHtml(cellValue(c, paper, extraction, lang))}</td>`).join('')}
          <td><button class="ghost sm" data-rm="${paper.id}" title="Bỏ khỏi so sánh">✕</button></td></tr>`).join('')}</tbody></table>`;
    }
    pinBelowHeader();
  };
  // Tên paper (hoặc tên thông số) trong hàng cao trượt theo khi cuộn, luôn hiện ngay dưới hàng tiêu đề đang cố định.
  let headObs = null;
  const pinBelowHeader = () => {
    const wrap = $('cmp-table');
    const head = wrap.querySelector('thead');
    headObs?.disconnect();
    if (!head) return;
    const set = () => wrap.style.setProperty('--cmp-head-h', `${head.offsetHeight}px`);
    set();
    headObs = new ResizeObserver(set);
    headObs.observe(head);
  };
  const drawColMenuIfOpen = () => { if (!$('cmp-cols').hidden) drawColMenu(); else { const n = colKeys().length; $('cmp-cols-btn').textContent = `Thông số hiển thị (${n}/${ALL_COLS.length}) ▾`; $('cmp-all-cols').hidden = n === ALL_COLS.length; } };

  const drawAll = () => { drawPick(); drawTable(); };
  drawAll();
  if (lastSynthesis) drawSynthesis(lastSynthesis);

  $('cmp-q').addEventListener('input', drawPick);
  $('cmp-pick').addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-id]');
    if (!cb) return;
    if (cb.checked) store.selected.add(cb.dataset.id); else store.selected.delete(cb.dataset.id);
    cb.closest('.pick-row')?.classList.toggle('on', cb.checked);
    drawTable();
    drawMaster();
  });
  // Như Gmail: đã chọn một phần hoặc tất cả thì bấm sẽ bỏ chọn danh sách đang lọc, chưa chọn gì thì chọn hết.
  $('cmp-all').addEventListener('click', () => {
    const list = pickList();
    const anyPicked = list.some((p) => store.selected.has(p.id));
    list.forEach((p) => (anyPicked ? store.selected.delete(p.id) : store.selected.add(p.id)));
    drawAll();
  });
  $('cmp-table').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { store.selected.delete(rm.dataset.rm); drawAll(); return; }
    const tr = e.target.closest('tr[data-id], th[data-id]');
    if (tr && e.detail === 2) location.hash = `#/paper/${tr.dataset.id}`;
  });
  $('cmp-charts').addEventListener('click', (e) => {
    const pp = e.target.closest('[data-ppop]');
    if (pp) { e.preventDefault(); openPaperPop(pp, pp.dataset.ppop, { onRemove: (id) => { store.selected.delete(id); drawAll(); } }); return; }
    const go = e.target.closest('[data-go]'); if (go) location.hash = go.dataset.go;
  });
  $('cmp-cols-btn').addEventListener('click', (e) => { e.stopPropagation(); const m = $('cmp-cols'); m.hidden = !m.hidden; if (!m.hidden) drawColMenu(); });
  $('cmp-cols').addEventListener('click', async (e) => {
    e.stopPropagation();
    const pre = e.target.closest('[data-preset]');
    if (!pre) return;
    await saveCols(pre.dataset.preset === 'all' ? ALL_COLS : pre.dataset.preset === 'none' ? [COLUMNS[0].key] : DEFAULT_COLS);
    drawColMenu(); drawTable();
  });
  $('cmp-cols').addEventListener('change', async (e) => {
    const on = new Set(colKeys());
    const g = e.target.dataset.group;
    if (g) COLUMNS.filter((c) => c.group === g).forEach((c) => (e.target.checked ? on.add(c.key) : on.delete(c.key)));
    else if (e.target.dataset.col) (e.target.checked ? on.add(e.target.dataset.col) : on.delete(e.target.dataset.col));
    if (!on.size) on.add(COLUMNS[0].key);
    await saveCols([...on]);
    drawColMenu(); drawTable();
  });
  const closeCols = (e) => { if (!e.target.closest('#cmp-cols') && $('cmp-cols')) $('cmp-cols').hidden = true; };
  document.addEventListener('click', closeCols);
  $('cmp-all-cols').addEventListener('click', async () => { await saveCols(ALL_COLS); drawTable(); toast('Đang hiện mọi thông số. Chọn "Paper theo cột" để đọc dễ hơn khi có nhiều thông số.', 4000); });
  $('cmp-orient').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-o]');
    if (!b) return;
    await saveSettings({ compareOrient: b.dataset.o });
    drawTable();
  });
  $('cmp-lang').addEventListener('click', async (e) => {
    if (e.target.id !== 'cmp-translate') return;
    e.target.disabled = true;
    const lang = viewLang();
    const rows = selectedPapers();
    let n = 0;
    for (const p of rows) {
      if (sourceLang(p.extraction || {}) === lang) continue;
      e.target.textContent = `Đang dịch ${++n}…`;
      try { await notesIn(paperById(p.id), lang); } catch (_) { /* bỏ qua paper lỗi */ }
    }
    drawTable();
  });
  $('cmp-chat').addEventListener('click', () => { const rows = selectedPapers(); if (!rows.length) return toast('Chưa chọn paper.'); location.hash = `#/chat?ids=${rows.map((p) => p.id).join(',')}`; });

  const needRows = () => { const rows = selectedPapers(); if (!rows.length) toast('Chưa chọn paper.'); return rows; };
  const exportData = async () => { const rows = needRows(); if (!rows.length) return null; const { items, lang } = await withLang(rows); return { rows, items, lang, columns: pickColumns(colKeys()) }; };
  $('cmp-copy').addEventListener('click', async () => {
    const d = await exportData(); if (!d) return;
    await copyText(tableMarkdown(d.items, d.columns, d.lang));
    toast(`Đã copy bảng so sánh (Markdown, ${d.columns.length} thông số).`);
  });
  // Khoá trích dẫn dùng chung cho BibTeX và \cite{} trong bảng LaTeX (khoá trùng được thêm a, b, c).
  const citeKey = (rows) => { const keys = bibtexKeys(rows); return (p) => keys.get(p.id) || bibtexKey(p); };
  $('cmp-bib').addEventListener('click', async () => {
    const rows = needRows(); if (!rows.length) return;
    await download('references.bib', `${bibtexAll(rows)}\n`, 'application/x-bibtex;charset=utf-8', { note: `${rows.length} mục BibTeX.` });
  });
  $('cmp-tex').addEventListener('click', async () => {
    const d = await exportData(); if (!d) return;
    await download('related-work-table.tex', `${tableLatex(d.items, d.columns, { lang: d.lang, latexEscape, bibtexKey: citeKey(d.rows) })}\n`, 'text/x-tex;charset=utf-8', {
      note: d.columns.length > 4 ? 'Bảng nhiều cột dùng cỡ chữ nhỏ, có thể bỏ bớt thông số. Lưu thêm references.bib để \\cite{} hoạt động.' : 'Lưu thêm references.bib để \\cite{} hoạt động.',
    });
  });
  $('cmp-doc').addEventListener('click', async () => {
    const d = await exportData(); if (!d) return;
    const html = wordDocument('Bảng so sánh', `<h1>Bảng so sánh ${d.rows.length} paper</h1>${tableWordHtml(d.items, d.columns, d.lang)}`, { landscape: d.columns.length > 3 });
    await download('bang-so-sanh.docx', htmlToDocx(html, { title: 'Bảng so sánh', landscape: d.columns.length > 3 }), DOCX_MIME);
  });
  $('cmp-csv').addEventListener('click', async () => {
    const d = await exportData(); if (!d) return;
    await download('papervault-sosanh.csv', tableCsv(d.items, d.columns, d.lang), 'text/csv;charset=utf-8', { note: 'Mở được bằng Excel / Google Sheets.' });
  });

  $('syn-run').addEventListener('click', async () => {
    const rows = selectedPapers();
    if (rows.length < 2) return setStatus('syn-status', 'Chọn ít nhất 2 paper.', 'err');
    if (!hasCredentials(store.settings)) return setStatus('syn-status', 'Chưa có API key. <a href="#/settings">Mở Cài đặt</a>.', 'err');
    if (jobRunning('syn')) return;
    const focus = $('syn-focus').value;
    // Chạy nền: rời trang vẫn tổng hợp tiếp và lưu, mở lại thì thanh tiến độ chạy tiếp.
    const job = runJob('syn', async (update) => {
      update(`Đang tổng hợp ${rows.length} paper…`);
      const { synthesis, meta } = await synthesize({ papers: rows, settings: store.settings, focus });
      lastSynthesis = { synthesis, papers: rows, meta, at: new Date().toISOString() };
      await api.kvSet('lastSynthesis', { ...lastSynthesis, papers: rows.map((p) => p.id) }).catch(() => {});
      return lastSynthesis;
    }, { label: `Tổng hợp related work (${rows.length} paper)`, href: '#/compare', here: () => location.hash.startsWith('#/compare'), expectedMs: () => 60000 });
    followSynthesis(job);
  });

  function followSynthesis(job) {
    $('syn-run').disabled = true;
    followJob(job, $('syn-status'), { expectedMs: 60000, onDone: (j) => {
      if ($('syn-run')) $('syn-run').disabled = false;
      if (j.error) return setStatus('syn-status', escapeHtml(j.error), 'err');
      setStatus('syn-status', `Xong (${j.result.meta.provider}/${j.result.meta.model}).`, 'ok');
      drawSynthesis(j.result);
    } });
  }
  { const j = getJob('syn'); if (j && !j.done) followSynthesis(j); }

  function drawSynthesis({ synthesis: s, papers }) {
    const md = synthesisToMarkdown(s, papers);
    $('syn-out').innerHTML = `<div class="cmp-export syn-export"><span class="cmp-export-label">Xuất bản tổng hợp · ${papers.length} paper</span><div class="btn-group" role="group">
        <button id="syn-copy" title="Copy bản tổng hợp dạng Markdown"><svg class="i"><use href="#i-copy"/></svg>Markdown</button>
        <button id="syn-dl" title="Lưu file .md"><svg class="i"><use href="#i-download"/></svg>.md</button>
        <button id="syn-tex" title="Lưu file .tex (section Related Work + bảng)"><svg class="i"><use href="#i-download"/></svg>LaTeX</button>
        <button id="syn-doc" title="Lưu file .docx"><svg class="i"><use href="#i-download"/></svg>Word</button></div></div>
      <h3>Tổng quan</h3><div class="syn-p">${richBlock(s.overview || '')}</div>
      <h3>Các hướng tiếp cận</h3>${(s.themes || []).map((t) => `<p><b>${escapeHtml(t.name)}</b> <span class="hint">(${escapeHtml((t.papers || []).join('; '))})</span></p><div class="syn-p">${richBlock(t.summary || '')}</div>`).join('')}
      <h3>So sánh theo khía cạnh</h3><table class="data"><thead><tr><th>Khía cạnh</th><th>Nhận xét</th></tr></thead><tbody>${(s.comparison || []).map((c) => `<tr><td><b>${escapeHtml(c.aspect)}</b></td><td>${escapeHtml(c.notes)}</td></tr>`).join('')}</tbody></table>
      <h3>Khoảng trống nghiên cứu</h3><ul>${(s.gaps || []).map((g) => `<li>${escapeHtml(stripMarker(g))}</li>`).join('')}</ul>
      <h3>Vị trí của đề tài</h3><blockquote>${richBlock(s.positioning || '')}</blockquote>
      <h3>Bản nháp Related Work</h3><div class="draft">${mdToHtml(readableChatMd(s.related_work_draft || ''))}</div>
      <h3>Việc nên làm tiếp</h3><ul>${(s.next_steps || []).map((g) => `<li>${escapeHtml(stripMarker(g))}</li>`).join('')}</ul>`;
    $('syn-copy').addEventListener('click', async () => { await copyText(md); toast('Đã copy bản tổng hợp.'); });
    $('syn-dl').addEventListener('click', () => download(`related-work-${new Date().toISOString().slice(0, 10)}.md`, md, 'text/markdown;charset=utf-8'));
    $('syn-tex').addEventListener('click', () => download('related-work.tex', synthesisToLatex(s, papers), 'text/x-tex;charset=utf-8'));
    $('syn-doc').addEventListener('click', () => download('related-work.docx', htmlToDocx(synthesisToWordHtml(s, papers), { title: 'Related work' }), DOCX_MIME));
  }

  if (!lastSynthesis) {
    api.kvGet('lastSynthesis').then((saved) => {
      if (!saved?.synthesis) return;
      const papers = (saved.papers || []).map(paperById).filter(Boolean);
      if (!papers.length) return;
      lastSynthesis = { synthesis: saved.synthesis, papers, meta: saved.meta };
      if ($('syn-out')) { drawSynthesis(lastSynthesis); if (!jobRunning('syn')) setStatus('syn-status', `Bản tổng hợp trước (${(saved.at || '').slice(0, 10)}).`); }
    }).catch(() => {});
  }

  const unsub = onChange(drawAll);
  return () => { unsub(); document.removeEventListener('click', closeCols); };
}
