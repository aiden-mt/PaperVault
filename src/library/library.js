import {
  getPapers, getTopics, putPaper, putTopic, deletePaper, deleteTopic,
  exportAll, importAll, kvGet, kvSet, getSettings,
} from '../common/db.js';
import { emptyExtraction, normalizeExtraction } from '../common/schema.js';
import { paperToMarkdown, compareTableMarkdown, libraryToMarkdown, quickNoteLine } from '../common/markdown.js';
import { escapeHtml, download, fmtDate, uid } from '../common/util.js';
import { pickRootDirectory, getRootDirectory, syncLibrary, isSupported, ensurePermission } from '../common/fs.js';
import { readFile, bytesToBase64, extractPdfText, estimatePages } from '../common/pdf.js';
import { NATIVE_PDF_PROVIDERS } from '../common/llm.js';
import { appStatus, importLibraryToApp } from '../common/app.js';

const $ = (id) => document.getElementById(id);
const ALL = '__all__';

const state = {
  papers: [],
  topics: [],
  topicId: ALL,
  search: '',
  sort: 'updated',
  status: '',
  view: 'list',
  selected: new Set(),
  draft: null,      // paper đang mở trong modal chi tiết
  pending: null,    // kết quả trích xuất trong modal thêm mới
  pdf: null,        // { key, name, size, pages, bytes } của file PDF đang chọn
  saving: false,
};

const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/* ============================ Tiện ích ============================ */

function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res?.ok) return reject(new Error(res?.error || 'Lỗi không xác định.'));
      resolve(res.data);
    });
  });
}

const topicOf = (p) => state.topics.find((t) => t.id === p.topicId);

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let cur = obj;
  for (const k of keys) {
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[last] = value;
}

/* Chuyển đổi giữa dữ liệu và text trong ô nhập */
const codec = {
  text: { out: (v) => String(v ?? ''), in: (s) => s.trim() },
  csv: {
    out: (v) => (v || []).join(', '),
    in: (s) => s.split(',').map((x) => x.trim()).filter(Boolean),
  },
  lines: {
    out: (v) => (v || []).join('\n'),
    in: (s) => s.split('\n').map((x) => x.trim()).filter(Boolean),
  },
  ideas: {
    out: (v) => (v || []).map((i) => [i.idea, i.how_to_apply, i.effort].filter(Boolean).join(' :: ')).join('\n'),
    in: (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [idea, how = '', effort = ''] = l.split('::').map((x) => x.trim());
      return { idea, how_to_apply: how, effort };
    }),
  },
  metrics: {
    out: (v) => (v || []).map((m) => [m.name, m.dataset, m.baseline, m.proposed, m.delta].join(' | ')).join('\n'),
    in: (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name = '', dataset = '', baseline = '', proposed = '', delta = ''] = l.split('|').map((x) => x.trim());
      return { name, dataset, baseline, proposed, delta };
    }),
  },
  number: { out: (v) => String(v ?? 0), in: (s) => Number(s) || 0 },
};

/* ============================ Lọc & sắp xếp ============================ */

function visiblePapers() {
  let list = state.papers.slice();
  if (state.topicId !== ALL) list = list.filter((p) => (p.topicId || 't_inbox') === state.topicId);
  if (state.status) list = list.filter((p) => (p.status || 'to-read') === state.status);

  const q = state.search.trim().toLowerCase();
  if (q) {
    list = list.filter((p) => {
      const e = p.extraction || {};
      const hay = [
        p.title, p.url, p.userNotes, e.novelty, e.problem, e.bottleneck,
        e.dataset_metric_note, e.key_idea?.summary,
        (e.tags || []).join(' '),
        (e.validation?.datasets || []).join(' '),
        (e.applicable_ideas || []).map((i) => `${i.idea} ${i.how_to_apply}`).join(' '),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  const cmp = {
    updated: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
    created: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)),
    title: (a, b) => String(a.title).localeCompare(String(b.title)),
    year: (a, b) => String(b.extraction?.year || '').localeCompare(String(a.extraction?.year || '')),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
  }[state.sort];
  return list.sort(cmp);
}

/* ============================ Render ============================ */

function renderSidebar() {
  const counts = new Map();
  for (const p of state.papers) {
    const k = p.topicId || 't_inbox';
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const rows = [
    `<li data-id="${ALL}" class="${state.topicId === ALL ? 'active' : ''}">
       <span class="dot" style="background:var(--muted)"></span>
       <span class="name">Tất cả</span><span class="count">${state.papers.length}</span></li>`,
    ...state.topics.map((t) => `
      <li data-id="${t.id}" class="${state.topicId === t.id ? 'active' : ''}" title="${escapeHtml(t.description || '')}">
        <span class="dot" style="background:${escapeHtml(t.color || '#888')}"></span>
        <span class="name">${escapeHtml(t.name)}</span>
        <span class="count">${counts.get(t.id) || 0}</span>
        <span class="acts">
          <button data-act="rename" title="Đổi tên">✎</button>
          <button data-act="delete" title="Xoá thư mục">🗑</button>
        </span>
      </li>`),
  ];
  $('topic-list').innerHTML = rows.join('');
}

function paperCard(p) {
  const e = p.extraction || {};
  const t = topicOf(p);
  const ideas = (e.applicable_ideas || []).map((i) => i.idea).filter(Boolean).join('; ');
  const statusLabel = { 'to-read': 'chưa đọc', reading: 'đang đọc', done: 'đã đọc' }[p.status || 'to-read'];
  return `
  <div class="paper" data-id="${p.id}">
    <input type="checkbox" class="pick" data-id="${p.id}" ${state.selected.has(p.id) ? 'checked' : ''}>
    <div class="body">
      <div class="t">${escapeHtml(p.title)}</div>
      <div class="meta">
        ${t ? `<span class="badge" style="border-color:${escapeHtml(t.color)}">${escapeHtml(t.name)}</span>` : ''}
        <span class="badge">${statusLabel}</span>
        ${e.year ? `<span class="badge">${escapeHtml(e.year)}</span>` : ''}
        ${e.venue ? `<span class="badge">${escapeHtml(e.venue)}</span>` : ''}
        ${(e.tags || []).slice(0, 4).map((x) => `<span class="badge accent">#${escapeHtml(x)}</span>`).join('')}
        ${p.rating ? `<span class="stars">${'★'.repeat(p.rating)}</span>` : ''}
        <span class="badge">${fmtDate(p.createdAt)}</span>
      </div>
      <div class="line"><b>Điểm mới:</b> ${escapeHtml(e.novelty || '—')}</div>
      <div class="line"><b>Dataset/Metric:</b> ${escapeHtml(e.dataset_metric_note || '—')}</div>
      <div class="line"><b>Áp dụng được:</b> ${escapeHtml(ideas || '—')}</div>
    </div>
  </div>`;
}

function renderList() {
  const list = visiblePapers();
  $('view-count').textContent = `${list.length} paper`;
  $('view-title').textContent = state.topicId === ALL
    ? 'Tất cả paper'
    : (state.topics.find((t) => t.id === state.topicId)?.name || 'Chủ đề');

  if (state.view === 'compare') {
    $('list-view').hidden = true;
    $('compare-view').hidden = false;
    renderCompare(list);
    return;
  }
  $('list-view').hidden = false;
  $('compare-view').hidden = true;
  $('list-view').innerHTML = list.length
    ? list.map(paperCard).join('')
    : `<div class="empty">Chưa có paper nào ở đây.<br>Mở một trang paper rồi bấm icon PaperVault, hoặc dùng nút <b>+ Thêm paper</b>.</div>`;
}

function renderCompare(list) {
  const picked = list.filter((p) => state.selected.has(p.id));
  const rows = picked.length ? picked : list;
  if (!rows.length) {
    $('compare-view').innerHTML = '<div class="empty">Không có gì để so sánh.</div>';
    return;
  }
  $('compare-view').innerHTML = `
    <p class="hint">${picked.length ? `Đang so sánh ${picked.length} paper đã chọn.` : `Đang so sánh toàn bộ ${rows.length} paper trong khung nhìn. Tick chọn để thu hẹp.`}</p>
    <table>
      <thead><tr>
        <th>Tên paper</th><th>Điểm mới</th><th>Dataset / Metric</th><th>Ý tưởng áp dụng cho bài của mình</th>
      </tr></thead>
      <tbody>
        ${rows.map((p) => {
          const e = p.extraction || {};
          const ideas = (e.applicable_ideas || []);
          return `<tr data-id="${p.id}">
            <td>${p.url ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a>` : escapeHtml(p.title)}
                <div class="hint">${escapeHtml([e.venue, e.year].filter(Boolean).join(' '))}</div></td>
            <td>${escapeHtml(e.novelty || '—')}</td>
            <td>${escapeHtml(e.dataset_metric_note || '—')}</td>
            <td>${ideas.length ? `<ul>${ideas.map((i) => `<li><b>${escapeHtml(i.idea)}</b> — ${escapeHtml(i.how_to_apply)}</li>`).join('')}</ul>` : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function render() {
  renderSidebar();
  renderList();
}

/* ============================ Modal chi tiết ============================ */

function field(label, path, type, { input = 'textarea', rows = 3, full = false, hint = '' } = {}) {
  const value = codec[type].out(getPath(state.draft, path));
  const control = input === 'textarea'
    ? `<textarea data-path="${path}" data-type="${type}" rows="${rows}">${escapeHtml(value)}</textarea>`
    : `<input type="text" data-path="${path}" data-type="${type}" value="${escapeHtml(value)}">`;
  return `<label class="field ${full ? 'full' : ''}">
    <span class="label-text">${label}</span>${control}
    ${hint ? `<span class="hint">${hint}</span>` : ''}
  </label>`;
}

function openDetail(paperId) {
  const p = state.papers.find((x) => x.id === paperId);
  if (!p) return;
  state.draft = structuredClone(p);
  state.draft.extraction = normalizeExtraction(state.draft.extraction);

  $('d-title').value = p.title || '';
  $('d-status').textContent = '';

  const topicOpts = state.topics
    .map((t) => `<option value="${t.id}" ${t.id === p.topicId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`)
    .join('');
  const statusOpts = [['to-read', 'Chưa đọc'], ['reading', 'Đang đọc'], ['done', 'Đã đọc']]
    .map(([v, l]) => `<option value="${v}" ${(p.status || 'to-read') === v ? 'selected' : ''}>${l}</option>`).join('');
  const ratingOpts = [0, 1, 2, 3, 4, 5]
    .map((n) => `<option value="${n}" ${(p.rating || 0) === n ? 'selected' : ''}>${n ? '★'.repeat(n) : 'chưa đánh giá'}</option>`).join('');

  $('d-body').innerHTML = `
  <div class="form-grid">
    <div class="sec-title">Thông tin chung</div>
    ${field('Link', 'url', 'text', { input: 'input', full: true })}
    ${field('Tác giả', 'extraction.authors', 'csv', { input: 'input' })}
    ${field('Venue', 'extraction.venue', 'text', { input: 'input' })}
    ${field('Năm', 'extraction.year', 'text', { input: 'input' })}
    ${field('Tags', 'extraction.tags', 'csv', { input: 'input' })}
    <label class="field"><span class="label-text">Thư mục chủ đề</span>
      <select data-path="topicId" data-type="text">${topicOpts}</select></label>
    <label class="field"><span class="label-text">Trạng thái</span>
      <select data-path="status" data-type="text">${statusOpts}</select></label>
    <label class="field"><span class="label-text">Đánh giá</span>
      <select data-path="rating" data-type="number">${ratingOpts}</select></label>
    ${field('Tóm tắt một câu', 'extraction.one_liner', 'text', { rows: 2, full: true })}

    <div class="sec-title">1 · Problem</div>
    ${field('Bài toán cụ thể muốn giải quyết', 'extraction.problem', 'text', { rows: 4, full: true })}

    <div class="sec-title">2 · Bottleneck</div>
    ${field('Hạn chế của SOTA hiện tại', 'extraction.bottleneck', 'text', { rows: 4, full: true })}

    <div class="sec-title">3 · Key Idea / Method</div>
    ${field('Ý tưởng cốt lõi', 'extraction.key_idea.summary', 'text', { rows: 4, full: true })}
    <div class="field full"><span class="label-text">Thành phần kỹ thuật</span>
      ${(state.draft.extraction.key_idea.components || []).length
        ? `<ul class="hint">${state.draft.extraction.key_idea.components.map((c) => `<li><b>${escapeHtml(c.name)}</b> (${escapeHtml(c.kind || 'other')}): ${escapeHtml(c.detail)}</li>`).join('')}</ul>`
        : '<span class="hint">Không có.</span>'}
    </div>

    <div class="sec-title">4 · Validation</div>
    ${field('Thiết kế thực nghiệm', 'extraction.validation.setup', 'text', { rows: 3, full: true })}
    ${field('Dataset', 'extraction.validation.datasets', 'csv', { input: 'input' })}
    ${field('Benchmark', 'extraction.validation.benchmarks', 'csv', { input: 'input' })}
    ${field('Kết quả số (mỗi dòng: metric | dataset | baseline | đề xuất | Δ)', 'extraction.validation.metrics', 'metrics', { rows: 5, full: true })}
    ${field('Ablation study', 'extraction.validation.ablation', 'text', { rows: 3 })}
    ${field('Kết luận thực nghiệm', 'extraction.validation.main_results', 'text', { rows: 3 })}

    <div class="sec-title">5 · Limitation</div>
    ${field('Các hạn chế (mỗi dòng một ý)', 'extraction.limitation.items', 'lines', { rows: 4, full: true })}
    ${field('Chi phí tính toán', 'extraction.limitation.compute_cost', 'text', { rows: 2 })}
    ${field('Chưa giải quyết triệt để', 'extraction.limitation.unresolved', 'text', { rows: 2 })}

    <div class="sec-title">Note để so sánh</div>
    ${field('Điểm mới', 'extraction.novelty', 'text', { rows: 2, full: true })}
    ${field('Dataset/Metric (một dòng)', 'extraction.dataset_metric_note', 'text', { rows: 2, full: true })}
    ${field('Ý tưởng áp dụng cho bài của mình (mỗi dòng: ý tưởng :: cách áp dụng :: công sức)',
      'extraction.applicable_ideas', 'ideas', { rows: 5, full: true })}
    ${field('Ghi chú cá nhân', 'userNotes', 'text', { rows: 4, full: true })}

    <div class="sec-title">Dòng note rút gọn</div>
    <div class="field full"><div class="mono hint">${escapeHtml(quickNoteLine(p))}</div></div>
  </div>`;

  $('detail').hidden = false;
}

function collectDraft() {
  for (const el of $('d-body').querySelectorAll('[data-path]')) {
    setPath(state.draft, el.dataset.path, codec[el.dataset.type].in(el.value));
  }
  state.draft.title = $('d-title').value.trim() || state.draft.title;
  return state.draft;
}

async function saveDetail() {
  const paper = collectDraft();
  await putPaper(paper);
  state.papers = await getPapers();
  render();
  $('d-status').textContent = 'Đã lưu.';
  $('d-status').className = 'status ok';
  await autoSyncIfEnabled();
  setTimeout(() => { $('d-status').textContent = ''; }, 2000);
}

/* ============================ Thêm paper (PDF / text) ============================ */

function showChip() {
  const chip = $('a-chip');
  if (!state.pdf) {
    chip.hidden = true;
    $('a-dropzone').hidden = false;
    return;
  }
  chip.hidden = false;
  $('a-dropzone').hidden = true;
  const pages = state.pdf.pages ? ` · ~${state.pdf.pages} trang` : '';
  $('a-chip-text').textContent = `📄 ${state.pdf.name} (${fmtSize(state.pdf.size)}${pages})`;
}

function clearPdf() {
  if (state.pdf?.key) kvSet(state.pdf.key, null);
  state.pdf = null;
  showChip();
}

function openAdd(prefill = {}) {
  $('a-url').value = prefill.url || '';
  $('a-text').value = prefill.text || '';
  $('a-status').textContent = '';
  $('a-result').innerHTML = '';
  state.pending = null;
  clearPdf();
  $('addmodal').hidden = false;
  if (prefill.file) acceptPdf(prefill.file);
}

async function acceptPdf(file) {
  if (!file) return;
  if (file.size > 24 * 1024 * 1024) {
    $('a-status').className = 'status err';
    $('a-status').textContent = 'File PDF lớn hơn 24MB, model sẽ từ chối. Hãy cắt bớt trang.';
    return;
  }
  $('a-status').className = 'status';
  $('a-status').innerHTML = '<span class="spin"></span> Đang đọc file PDF…';
  try {
    const bytes = await readFile(file);
    const key = `pdfBlob:${uid('f')}`;
    await kvSet(key, bytesToBase64(bytes));
    state.pdf = { key, name: file.name, size: bytes.length, pages: estimatePages(bytes), bytes };
    showChip();
    $('a-status').className = 'status ok';
    $('a-status').textContent = 'Đã nạp PDF. Bấm "Trích xuất 5 mục".';
  } catch (e) {
    $('a-status').className = 'status err';
    $('a-status').textContent = e.message;
  }
}

/** Provider không nhận PDF trực tiếp thì trích text tại chỗ. */
async function pdfTextIfNeeded() {
  const s = await getSettings();
  if (NATIVE_PDF_PROVIDERS.has(s.provider) && s.pdfMode !== 'text') return '';
  $('a-status').innerHTML = '<span class="spin"></span> Đang trích text từ PDF…';
  const r = await extractPdfText(state.pdf.bytes);
  if (!r.text || r.text.length < 200) {
    throw new Error('Không trích được text từ PDF này (có thể là bản scan). Chuyển sang Claude/Gemini để gửi thẳng file PDF.');
  }
  return r.text;
}

async function extractFromModal() {
  const text = $('a-text').value.trim();
  if (!state.pdf && text.length < 120) {
    $('a-status').className = 'status err';
    $('a-status').textContent = 'Cần ít nhất 120 ký tự, hoặc chọn một file PDF.';
    return;
  }
  $('a-extract').disabled = true;
  $('a-status').className = 'status';
  $('a-status').innerHTML = '<span class="spin"></span> Đang trích xuất…';
  try {
    const source = state.pdf
      ? {
          url: $('a-url').value.trim(),
          title: state.pdf.name.replace(/\.pdf$/i, ''),
          kind: `file PDF (${state.pdf.name})`,
          pdfKey: state.pdf.key,
          text: text || await pdfTextIfNeeded(),
        }
      : { url: $('a-url').value.trim(), title: '', kind: 'text người dùng dán', text };

    const data = await send({ type: 'extract', source });
    state.pending = { data, source };
    if (state.pdf) { state.pdf = null; showChip(); }   // service worker đã dọn key
    renderPendingConfirm(data);
    $('a-status').textContent = '';
  } catch (e) {
    $('a-status').className = 'status err';
    $('a-status').textContent = e.message;
  } finally {
    $('a-extract').disabled = false;
  }
}

/** Khối xác nhận sau khi trích xuất: chọn thư mục, xử lý trùng, rồi lưu. */
function renderPendingConfirm(data) {
  const dup = data.duplicate;
  const topicOpts = data.topics
    .map((t) => {
      const chosen = dup?.topicId || data.suggestion.topicId;
      return `<option value="${t.id}" ${t.id === chosen ? 'selected' : ''}>${escapeHtml(t.name)}</option>`;
    })
    .join('');

  $('a-result').innerHTML = `
    <div class="card" style="margin-top:12px">
      <div><b>${escapeHtml(data.extraction.title || '(chưa có tên)')}</b></div>
      <div class="hint">${escapeHtml(data.extraction.one_liner || '')}</div>
      <div class="row wrap" style="margin-top:6px">
        <span class="badge">độ tin cậy: ${escapeHtml(data.extraction.confidence || '?')}</span>
        <span class="badge">${escapeHtml(data.meta.provider)}/${escapeHtml(data.meta.model)}</span>
        ${data.meta.pdfMode ? `<span class="badge accent">${escapeHtml(data.meta.pdfMode)}</span>` : ''}
      </div>

      ${dup ? `<div class="dup-warn" style="margin-top:10px">
        Thư viện đã có <b>${escapeHtml(dup.title)}</b>.
        <div class="row">
          <label class="row sm-label"><input type="radio" name="a-dup" value="update" checked> Cập nhật bản đã lưu</label>
          <label class="row sm-label"><input type="radio" name="a-dup" value="new"> Lưu thành bản mới</label>
        </div>
      </div>` : ''}

      <label class="field" style="margin-top:10px">
        <span class="label-text">Thư mục chủ đề${data.suggestion.isNew ? ` — model gợi ý mới: ${escapeHtml(data.suggestion.newName)}` : ''}</span>
        <select id="a-topic">${topicOpts}<option value="__new__">➕ Tạo thư mục mới…</option></select>
      </label>
      <input type="text" id="a-newtopic" placeholder="Tên thư mục mới" value="${escapeHtml(data.suggestion.newName || '')}" ${data.suggestion.isNew ? '' : 'hidden'}>
      <div class="row" style="margin-top:10px">
        <button id="a-save" class="primary">${dup ? 'Lưu / cập nhật' : 'Lưu vào thư viện'}</button>
        <span id="a-save-status" class="status"></span>
      </div>
    </div>`;

  if (data.suggestion.isNew) $('a-topic').value = '__new__';
  $('a-topic').addEventListener('change', (ev) => { $('a-newtopic').hidden = ev.target.value !== '__new__'; });
  $('a-save').addEventListener('click', saveFromModal);
}

async function saveFromModal() {
  if (state.saving || !state.pending) return;
  const { data, source } = state.pending;
  const sel = $('a-topic').value;
  const newName = sel === '__new__' ? $('a-newtopic').value.trim() : '';
  if (sel === '__new__' && !newName) {
    $('a-save-status').className = 'status err';
    $('a-save-status').textContent = 'Nhập tên thư mục mới.';
    return;
  }

  const dupMode = document.querySelector('input[name="a-dup"]:checked')?.value;
  const existingId = data.duplicate && dupMode !== 'new' ? data.duplicate.id : null;

  state.saving = true;
  $('a-save').disabled = true;
  $('a-save-status').className = 'status';
  $('a-save-status').innerHTML = '<span class="spin"></span> Đang lưu…';
  try {
    const { paper, updated } = await send({
      type: 'save',
      payload: {
        extraction: data.extraction,
        meta: data.meta,
        source,
        topicId: sel === '__new__' ? null : sel,
        newTopicName: newName,
        userNotes: '',
        existingId,
      },
    });
    state.pending = null;
    await reload();
    $('addmodal').hidden = true;
    toast(`${updated ? 'Đã cập nhật' : 'Đã lưu'}: ${paper.title.slice(0, 60)}`);
    await autoSyncIfEnabled();
  } catch (e) {
    $('a-save-status').className = 'status err';
    $('a-save-status').textContent = e.message;
    $('a-save').disabled = false;
  } finally {
    state.saving = false;
  }
}

async function createBlankPaper() {
  const e = emptyExtraction();
  e.title = 'Note trống';
  const p = await putPaper({
    title: 'Note trống',
    url: $('a-url').value.trim(),
    topicId: state.topicId === ALL ? 't_inbox' : state.topicId,
    extraction: e,
    userNotes: $('a-text').value.trim(),
    status: 'to-read',
    rating: 0,
  });
  await reload();
  $('addmodal').hidden = true;
  openDetail(p.id);
}

/* ---------------- Kéo thả PDF vào bất kỳ đâu trong thư viện ---------------- */

let dragDepth = 0;
document.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  dragDepth++;
  document.body.classList.add('drag-over');
});
document.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove('drag-over');
});
document.addEventListener('dragover', (e) => {
  if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('drag-over');
  const file = [...(e.dataTransfer.files || [])].find((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  if (!file) return toast('Chỉ nhận file PDF.');
  if ($('addmodal').hidden) openAdd({ file });
  else acceptPdf(file);
});

/* ---------------- Dọn paper trùng ---------------- */

async function dedupe() {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const groups = new Map();
  for (const p of state.papers) {
    const key = p.arxivId ? `a:${p.arxivId.replace(/v\d+$/, '')}`
      : (norm(p.title).length > 12 ? `t:${norm(p.title)}` : `u:${p.url || p.id}`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  const total = dupGroups.reduce((n, g) => n + g.length - 1, 0);
  if (!total) return toast('Không tìm thấy paper trùng.');
  if (!confirm(`Tìm thấy ${total} bản trùng trong ${dupGroups.length} nhóm.\nGiữ lại bản cập nhật gần nhất của mỗi nhóm và xoá phần còn lại?`)) return;

  for (const g of dupGroups) {
    g.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    for (const extra of g.slice(1)) await deletePaper(extra.id);
  }
  await reload();
  toast(`Đã xoá ${total} bản trùng.`);
}
/* ============================ Đồng bộ / xuất / nhập ============================ */

async function autoSyncIfEnabled() {
  const s = await getSettings();
  if (!s.autoSyncFolder) return;
  const root = await getRootDirectory();
  if (!root || !(await ensurePermission(root, { request: false }))) return;
  try {
    await syncLibrary({ papers: state.papers, topics: state.topics });
  } catch (_) { /* im lặng: auto-sync không được làm phiền người dùng */ }
}

async function refreshSyncInfo() {
  const root = await getRootDirectory();
  if (!isSupported()) {
    $('sync-info').textContent = 'Trình duyệt không hỗ trợ ghi ra thư mục.';
    return;
  }
  $('sync-info').innerHTML = root
    ? `Thư mục: <b>${escapeHtml(root.name)}</b>`
    : 'Chưa chọn thư mục đồng bộ.';
}

async function doSync() {
  try {
    let root = await getRootDirectory();
    if (!root) root = await pickRootDirectory();
    if (!(await ensurePermission(root))) throw new Error('Bạn chưa cấp quyền ghi.');
    toast('Đang ghi file…', 8000);
    const { files, folders } = await syncLibrary({ papers: state.papers, topics: state.topics });
    toast(`Đã ghi ${files} file trong ${folders} thư mục.`);
    await refreshSyncInfo();
  } catch (e) {
    if (e.name === 'AbortError') return;
    toast(`Lỗi đồng bộ: ${e.message}`, 5000);
  }
}

function exportMenu() {
  const list = visiblePapers();
  const picked = list.filter((p) => state.selected.has(p.id));
  const rows = picked.length ? picked : list;
  const choice = prompt(
    'Chọn kiểu xuất:\n1 = Markdown toàn bộ (theo chủ đề)\n2 = Bảng so sánh (Markdown)\n3 = JSON sao lưu\n4 = CSV bảng so sánh',
    '1',
  );
  if (!choice) return;
  const stamp = new Date().toISOString().slice(0, 10);
  if (choice.trim() === '1') {
    download(`papervault-${stamp}.md`, libraryToMarkdown(rows, state.topics), 'text/markdown;charset=utf-8');
  } else if (choice.trim() === '2') {
    download(`papervault-sosanh-${stamp}.md`, compareTableMarkdown(rows, { withBottleneck: true }), 'text/markdown;charset=utf-8');
  } else if (choice.trim() === '3') {
    exportAll().then((data) => download(`papervault-backup-${stamp}.json`, JSON.stringify(data, null, 2), 'application/json'));
  } else if (choice.trim() === '4') {
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const csv = [
      ['Tên paper', 'Điểm mới', 'Dataset/Metric', 'Ý tưởng áp dụng', 'Chủ đề', 'Link'].map(esc).join(','),
      ...rows.map((p) => {
        const e = p.extraction || {};
        return [
          p.title, e.novelty, e.dataset_metric_note,
          (e.applicable_ideas || []).map((i) => i.idea).join('; '),
          topicOf(p)?.name || '', p.url,
        ].map(esc).join(',');
      }),
    ].join('\n');
    download(`papervault-sosanh-${stamp}.csv`, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
  }
}

/* ============================ Sự kiện ============================ */

$('topic-list').addEventListener('click', async (ev) => {
  const li = ev.target.closest('li');
  if (!li) return;
  const act = ev.target.closest('button')?.dataset.act;
  const id = li.dataset.id;

  if (act === 'rename') {
    const t = state.topics.find((x) => x.id === id);
    const name = prompt('Tên chủ đề mới:', t.name);
    if (name?.trim()) { await putTopic({ ...t, name: name.trim() }); await reload(); }
    return;
  }
  if (act === 'delete') {
    const t = state.topics.find((x) => x.id === id);
    const count = state.papers.filter((p) => p.topicId === id).length;
    if (!confirm(`Xoá thư mục "${t.name}"?${count ? `\n${count} paper trong đó sẽ chuyển về Inbox.` : ''}`)) return;
    await deleteTopic(id, { reassignTo: 't_inbox' });
    if (state.topicId === id) state.topicId = ALL;
    await reload();
    return;
  }
  state.topicId = id;
  state.selected.clear();
  render();
});

$('btn-add-topic').addEventListener('click', async () => {
  const name = prompt('Tên thư mục chủ đề mới (ví dụ: VQA, Video Grounding):');
  if (!name?.trim()) return;
  const kw = prompt('Từ khoá gợi ý tự động (cách nhau bởi dấu phẩy, có thể bỏ trống):', '') || '';
  await putTopic({
    id: uid('t'),
    name: name.trim(),
    description: 'Thư mục do bạn tạo.',
    keywords: kw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    color: '#6b7cff',
  });
  await reload();
});

$('list-view').addEventListener('click', (ev) => {
  const cb = ev.target.closest('.pick');
  if (cb) {
    ev.stopPropagation();
    if (cb.checked) state.selected.add(cb.dataset.id);
    else state.selected.delete(cb.dataset.id);
    return;
  }
  const card = ev.target.closest('.paper');
  if (card) openDetail(card.dataset.id);
});

$('compare-view').addEventListener('dblclick', (ev) => {
  const tr = ev.target.closest('tr[data-id]');
  if (tr) openDetail(tr.dataset.id);
});

$('search').addEventListener('input', (e) => { state.search = e.target.value; renderList(); });
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderList(); });
$('filter-status').addEventListener('change', (e) => { state.status = e.target.value; renderList(); });

document.querySelectorAll('.tabs.inline button').forEach((b) => {
  b.addEventListener('click', () => {
    state.view = b.dataset.view;
    document.querySelectorAll('.tabs.inline button').forEach((x) => x.classList.toggle('active', x === b));
    renderList();
  });
});

$('select-all').addEventListener('change', (e) => {
  const list = visiblePapers();
  if (e.target.checked) list.forEach((p) => state.selected.add(p.id));
  else state.selected.clear();
  renderList();
});

$('btn-copy-table').addEventListener('click', async () => {
  const list = visiblePapers();
  const picked = list.filter((p) => state.selected.has(p.id));
  const md = compareTableMarkdown(picked.length ? picked : list);
  await navigator.clipboard.writeText(md);
  toast('Đã copy bảng so sánh (Markdown).');
});

$('btn-bulk-move').addEventListener('click', async () => {
  if (!state.selected.size) return toast('Chưa chọn paper nào.');
  const names = state.topics.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
  const pick = prompt(`Chuyển ${state.selected.size} paper sang thư mục nào?\n${names}`, '1');
  const idx = Number(pick) - 1;
  if (!state.topics[idx]) return;
  for (const id of state.selected) {
    const p = state.papers.find((x) => x.id === id);
    if (p) await putPaper({ ...p, topicId: state.topics[idx].id });
  }
  state.selected.clear();
  await reload();
  toast('Đã chuyển thư mục.');
});

$('btn-bulk-del').addEventListener('click', async () => {
  if (!state.selected.size) return toast('Chưa chọn paper nào.');
  if (!confirm(`Xoá vĩnh viễn ${state.selected.size} paper khỏi thư viện?`)) return;
  for (const id of state.selected) await deletePaper(id);
  state.selected.clear();
  await reload();
});

$('d-close').addEventListener('click', () => { $('detail').hidden = true; });
$('detail').addEventListener('click', (e) => { if (e.target.id === 'detail') $('detail').hidden = true; });
$('d-save').addEventListener('click', saveDetail);
$('d-del').addEventListener('click', async () => {
  if (!confirm('Xoá paper này?')) return;
  await deletePaper(state.draft.id);
  $('detail').hidden = true;
  await reload();
});
$('d-copy').addEventListener('click', async () => {
  const p = collectDraft();
  await navigator.clipboard.writeText(paperToMarkdown(p, state.topics.find((t) => t.id === p.topicId)));
  toast('Đã copy Markdown.');
});
$('d-open').addEventListener('click', () => {
  if (state.draft?.url) window.open(state.draft.url, '_blank', 'noopener');
  else toast('Paper này chưa có link.');
});

function closeAdd() {
  clearPdf();
  state.pending = null;
  $('addmodal').hidden = true;
}

$('btn-add').addEventListener('click', () => openAdd());
$('a-close').addEventListener('click', closeAdd);
$('addmodal').addEventListener('click', (e) => { if (e.target.id === 'addmodal') closeAdd(); });
$('a-extract').addEventListener('click', extractFromModal);
$('a-manual').addEventListener('click', createBlankPaper);
$('btn-dedupe').addEventListener('click', dedupe);

$('a-dropzone').addEventListener('click', () => $('a-file').click());
$('a-file').addEventListener('change', (e) => acceptPdf(e.target.files?.[0]));
$('a-chip-clear').addEventListener('click', clearPdf);
['dragenter', 'dragover'].forEach((ev) => $('a-dropzone').addEventListener(ev, () => $('a-dropzone').classList.add('over')));
['dragleave', 'drop'].forEach((ev) => $('a-dropzone').addEventListener(ev, () => $('a-dropzone').classList.remove('over')));

$('btn-sync').addEventListener('click', doSync);
$('btn-export').addEventListener('click', exportMenu);
$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const added = await importAll(JSON.parse(await file.text()));
    await reload();
    toast(`Đã nhập ${added} paper.`);
  } catch (e) {
    toast(`Lỗi nhập: ${e.message}`, 5000);
  }
  ev.target.value = '';
});
$('btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('detail').hidden = true;
    if (!$('addmodal').hidden) closeAdd();
  }
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    $('search').focus();
  }
});

/* ============================ Khởi động ============================ */

async function reload() {
  [state.papers, state.topics] = await Promise.all([getPapers(), getTopics()]);
  render();
}

(async function init() {
  await reload();
  await refreshSyncInfo();

  appStatus().then((st) => {
    if (!st.ok) return;
    $('btn-to-app').hidden = false;
    $('btn-to-app').addEventListener('click', async () => {
      try {
        toast('Đang gửi sang App…', 8000);
        const n = await importLibraryToApp(await exportAll());
        toast(`Đã nhập ${n} paper mới vào PaperVault App (${st.papers} paper bên đó trước khi nhập).`, 6000);
      } catch (e) { toast(`Lỗi: ${e.message}`, 6000); }
    });
  });

  if (new URLSearchParams(location.search).get('paste') === '1') {
    const pending = await kvGet('pendingPaste', null);
    if (pending?.text) {
      openAdd({ text: pending.text, url: pending.url });
      await kvSet('pendingPaste', null);
    }
  }
})();
