// Thêm hàng loạt theo ba bước:
//   1. Đưa nguồn vào: dán văn bản có link / thả nhiều PDF -> app tự tìm paper và tự tra cứu metadata (miễn phí).
//   2. Duyệt: mỗi paper là một thẻ với quyết định rõ ràng "Thêm" hoặc "Bỏ qua"; mục trùng được bỏ qua sẵn.
//   3. Lưu: một nút đưa các paper đã chọn vào thư viện, tuỳ chọn trích xuất ghi chú bằng AI.
import { api } from '../api.js';
import { store, findDuplicate, topicById, savePaper, paperById, noteTextLen } from '../store.js';
import { escapeHtml, fmtSize, uid, debounce } from '../util.js';
import { toast } from '../ui.js';
import { extractLinks, identifyFromPdfText } from '../links.js';
import { runExtraction, savePaperFromExtraction, resolveQuery, saveMetadataOnly, acceptPdfFile } from '../extract.js';
import { extractPdfText } from '../pdf.js';
import { hasCredentials } from '../llm.js';
import { suggestTopic } from '../topics.js';
import { venueBadge } from '../venue.js';

const SOURCE_LABEL = { arxiv: 'arXiv', doi: 'DOI', openreview: 'OpenReview', acl: 'ACL', 'pdf-url': 'Link PDF', 'paper-url': 'Trang web', 'other-url': 'Link', title: 'Tìm theo tên', pdf: 'File PDF' };

const st = {
  items: [],            // danh sách chờ (lưu ở máy chủ, kv "staging")
  texts: new Map(),     // id -> nội dung text (chỉ trong bộ nhớ)
  skipped: [],          // link không giống paper, chờ người dùng quyết định
  filter: 'all',
  expanded: new Set(),
  sourceOpen: null,     // null = tự quyết theo việc đã có mục hay chưa
  extract: null,        // tuỳ chọn trích xuất ghi chú khi lưu (null = mặc định theo có API key)
  resolving: false,
  refreshing: false,
  saving: false,
  stop: false,
  progress: null,       // { done, total, label }
  lastRun: null,        // { saved, errors, stopped, extract }
  flash: '',
  loaded: false,
};

const persist = debounce(() => {
  api.kvSet('staging', st.items.map(({ busy, ...it }) => it)).catch(() => {});
}, 400);

async function load() {
  if (st.loaded) return;
  st.items = (await api.kvGet('staging').catch(() => null)) || [];
  for (const it of st.items) {
    if (['resolving', 'extracting', 'saving'].includes(it.status)) it.status = it.extraction ? 'extracted' : (it.title ? 'resolved' : 'new');
    if (it.include === undefined) it.include = it.checked !== false && it.status !== 'error'; // dữ liệu từ phiên bản cũ
    delete it.checked;
  }
  st.loaded = true;
}

/* ================================================================ phân nhóm */

const isPending = (it) => it.status === 'new' || it.status === 'resolving';
const isBusy = (it) => ['resolving', 'extracting', 'saving'].includes(it.status);
const groupOf = (it) => {
  if (it.status === 'saved') return 'saved';
  if (it.status === 'error') return 'error';
  if (it.dupId || it.twinOf) return 'dup';
  return 'review';
};
const decidable = (it) => !['saved', 'error'].includes(groupOf(it)) && !isPending(it);

function counts() {
  const c = { all: st.items.length, include: 0, dup: 0, error: 0, saved: 0, pending: 0 };
  for (const it of st.items) {
    const g = groupOf(it);
    if (g === 'saved') c.saved++;
    else if (g === 'error') c.error++;
    else if (g === 'dup') c.dup++;
    if (isPending(it)) c.pending++;
    if (it.include && g !== 'saved' && g !== 'error') c.include++;
  }
  return c;
}
function visibleItems() {
  const f = st.filter;
  if (f === 'all') return st.items;
  if (f === 'include') return st.items.filter((i) => i.include && !['saved', 'error'].includes(groupOf(i)));
  return st.items.filter((i) => groupOf(i) === f);
}
const saveTargets = () => st.items.filter((i) => i.include && decidable(i));

/* ================================================================ nhận nguồn */

function addDetected(list) {
  let added = 0;
  const keys = new Set(st.items.map((i) => i.key));
  for (const d of list) {
    if (keys.has(d.key)) continue;
    keys.add(d.key);
    const it = { id: uid('s'), key: d.key, kind: d.kind, query: d.query, label: d.label, include: true, status: 'new', title: d.title || '', topicId: '' };
    if (d.entry) Object.assign(it, { authors: d.entry.authors.join(', '), year: d.entry.year, venue: d.entry.venue, doi: d.entry.doi, arxivId: d.entry.arxivId, url: d.entry.url, bibType: d.entry.type, abstract: d.entry.abstract });
    st.items.push(it);
    added++;
  }
  persist();
  return added;
}

/** Nhận nhiều file PDF: đọc, tìm arXiv ID / DOI / tiêu đề trong text, tải lên máy chủ. */
export async function addPdfFiles(files, onProgress = () => {}) {
  await load();
  const pdfs = [...files].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  let n = 0;
  for (const f of pdfs) {
    onProgress(`Đang đọc ${f.name} (${++n}/${pdfs.length})…`);
    const it = { id: uid('s'), key: `pdf:${f.name}:${f.size}`, kind: 'pdf', label: f.name, pdfName: f.name, size: f.size, include: true, status: 'new', topicId: '' };
    if (st.items.some((x) => x.key === it.key)) continue;
    try {
      const { pdfBytes } = await acceptPdfFile(f);
      try {
        const r = await extractPdfText(pdfBytes);
        if (r.text) {
          st.texts.set(it.id, r.readable ? r.text : '');
          const idf = identifyFromPdfText(r.text);
          Object.assign(it, { arxivId: idf.arxivId, doi: idf.doi, title: idf.title, textLen: r.text.length, abstract: abstractOf(r.text) });
        }
      } catch (_) { /* PDF scan: vẫn nhận, model đọc file trực tiếp */ }
      const up = await api.uploadPdf(pdfBytes, f.name);
      it.pdfId = up.id;
      it.query = it.arxivId || it.doi || '';
    } catch (e) {
      it.status = 'error';
      it.error = e.message;
      it.include = false;
    }
    st.items.push(it);
    persist();
    draw();
  }
  return pdfs.length;
}

/** Đưa danh sách mục (từ .bib/.ris) vào danh sách chờ. */
export async function addEntries(entries) {
  await load();
  const det = entries.map((e) => {
    const q = e.arxivId || e.doi || (e.url && /^https?:/.test(e.url) ? e.url : '');
    const kind = e.arxivId ? 'arxiv' : (e.doi ? 'doi' : (q ? 'paper-url' : 'title'));
    return { kind, query: q, key: q ? `${kind}:${q.toLowerCase()}` : `title:${e.title.toLowerCase()}`, label: e.title, title: e.title, entry: e };
  });
  const n = addDetected(det);
  autoResolve();
  return n;
}

/* ================================================================ tra cứu (tự động, miễn phí) */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function abstractOf(text) {
  const t = String(text || '');
  const i = t.search(/\babstract\b[:.]?/i);
  const body = (i >= 0 ? t.slice(i).replace(/^abstract[:.\s]*/i, '') : t).replace(/\s+/g, ' ').trim();
  return body.slice(0, 700);
}

async function queryFromTitle(title) {
  const hit = await api.findTitle(title);
  return hit?.query || null;
}

function markDuplicate(it) {
  const dup = findDuplicate({ url: it.url, arxivId: it.arxivId, doi: it.doi, title: it.title });
  it.dupId = dup?.id || '';
  const n = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const idx = st.items.indexOf(it);
  const twin = st.items.find((x, j) => j < idx && x.status !== 'error' && (
    (it.arxivId && x.arxivId && x.arxivId.replace(/v\d+$/, '') === it.arxivId.replace(/v\d+$/, ''))
    || (it.doi && x.doi && x.doi.toLowerCase() === it.doi.toLowerCase())
    || (n(it.title).length > 12 && n(x.title) === n(it.title))));
  it.twinOf = twin ? twin.id : '';
  if (!it.userDecided) it.include = !it.dupId && !it.twinOf;
}

async function classifyVenue(it) {
  try {
    it.venueInfo = await api.venueClassify([it.venue || ''], it.venueHints || (it.bibType ? { bibType: it.bibType } : {}), !!it.arxivId);
  } catch (_) { /* không bắt buộc */ }
}

async function resolveItem(it) {
  it.status = 'resolving';
  it.error = '';
  draw();
  try {
    let q = it.query;
    if (!q && (it.title || it.kind === 'title')) {
      try { q = await queryFromTitle(it.title || it.label); } catch (e) { if (it.kind !== 'pdf') throw e; it.note = e.message; }
    }
    if (!q) {
      if (it.kind === 'pdf') { it.status = 'resolved'; it.note = it.note || 'Không tìm được thông tin trên mạng, dùng tiêu đề đọc từ PDF.'; await classifyVenue(it); markDuplicate(it); return; }
      throw new Error('Không tìm thấy paper nào có tiêu đề đủ giống.');
    }
    let r;
    try {
      r = await api.resolve(q);
    } catch (e) {
      if (it.kind !== 'pdf') throw e;
      it.status = 'resolved';
      it.note = `Không tra được thông tin trên mạng. Vẫn trích xuất được từ file PDF.`;
      await classifyVenue(it);
      markDuplicate(it);
      return;
    }
    Object.assign(it, {
      query: q, title: r.title || it.title, authors: r.authors || it.authors || '', year: r.year || it.year || '', venue: r.venue || it.venue || '',
      arxivId: r.arxivId || it.arxivId || '', doi: r.doi || it.doi || '', url: r.url || it.url || '', s2Id: r.s2Id || '',
      citationCount: r.citationCount ?? null, sourceKind: r.kind || '', textLen: Math.max(it.textLen || 0, (r.text || '').length),
      pdfUrl: r.pdfUrl || '', venueHints: r.venueHints || {}, tldr: r.tldr || '', note: (r.warnings || []).join(' · '),
      abstract: it.abstract || abstractOf(r.text),
    });
    if (r.text && (it.kind !== 'pdf' || !(st.texts.get(it.id) || '').length)) st.texts.set(it.id, r.text);
    it.status = 'resolved';
    await classifyVenue(it);
    markDuplicate(it);
  } catch (e) {
    it.status = 'error';
    it.error = e.message;
    if (!it.userDecided) it.include = false;
  } finally { persist(); draw(); }
}

/** Tra cứu lần lượt mọi mục mới. Chạy nền, không tốn token. */
async function autoResolve() {
  if (st.resolving) return;
  st.resolving = true;
  draw();
  try {
    for (;;) {
      const it = st.items.find((i) => i.status === 'new');
      if (!it) break;
      await resolveItem(it);
      await sleep(300);
    }
  } finally {
    st.resolving = false;
    draw();
  }
}

/* ================================================================ trích xuất + lưu */

function localTopic(it) {
  return suggestTopic({ text: [it.title, it.venue, it.abstract, it.tldr].filter(Boolean).join(' '), topics: store.topics }).topicId || 't_inbox';
}
function topicChoice(it) {
  if (it.topicId) return { topicId: it.topicId, newTopicName: '' };
  const s = it.suggestion;
  if (s?.isNew) return { topicId: null, newTopicName: s.newName };
  if (s?.topicId) return { topicId: s.topicId, newTopicName: '' };
  return { topicId: localTopic(it), newTopicName: '' };
}

async function extractItem(it) {
  it.status = 'extracting';
  it.error = '';
  draw();
  try {
    let source;
    if (it.kind === 'pdf') {
      source = {
        url: it.url || '', title: it.title || it.pdfName.replace(/\.pdf$/i, ''), authors: it.authors || '', year: it.year || '', venue: it.venue || '',
        arxivId: it.arxivId || '', doi: it.doi || '', s2Id: it.s2Id || '', citationCount: it.citationCount ?? null,
        kind: `file PDF (${it.pdfName})`, pdfId: it.pdfId, pdfName: it.pdfName, text: st.texts.get(it.id) || '', venueHints: it.venueHints || {},
      };
    } else {
      source = await resolveQuery(it.query, { onStatus: (m) => { it.note = m; draw(); } });
      source.venueHints = source.venueHints || it.venueHints || {};
      if (source.pdfBytes) {
        const up = await api.uploadPdf(source.pdfBytes, source.pdfName);
        Object.assign(source, { pdfId: up.id, pdfName: up.name });
        delete source.pdfBytes;
        it.pdfId = up.id;
      }
      if (source.text) st.texts.set(it.id, source.text);
    }
    const r = await runExtraction(source, { onStatus: (m) => { it.note = m; draw(); } });
    const { text, ...lean } = r.source;
    Object.assign(it, { extraction: r.extraction, meta: r.meta, suggestion: r.suggestion, source: lean, status: 'extracted', note: '' });
    if (text) st.texts.set(it.id, text);
    it.title = r.extraction.title || it.title;
    if (r.duplicate) it.dupId = r.duplicate.id;
  } catch (e) {
    it.status = 'error';
    it.error = e.message;
  } finally { persist(); draw(); }
}

async function saveItem(it) {
  it.status = 'saving';
  draw();
  try {
    const { topicId, newTopicName } = topicChoice(it);
    let paper;
    if (it.extraction) {
      ({ paper } = await savePaperFromExtraction({
        extraction: it.extraction, meta: it.meta, source: { ...(it.source || {}), text: st.texts.get(it.id) || '', venueHints: it.venueHints || it.source?.venueHints },
        topicId, newTopicName, existingId: it.dupId || null,
      }));
    } else {
      if (it.dupId) { it.status = 'resolved'; it.note = 'Đã có trong thư viện. Bật “Trích xuất ghi chú” nếu muốn cập nhật bản cũ.'; return; }
      paper = await saveMetadataOnly({
        title: it.title || it.label, authors: String(it.authors || '').split(',').map((s) => s.trim()).filter(Boolean),
        year: it.year, venue: it.venue, doi: it.doi, arxivId: it.arxivId, url: it.url, abstract: it.abstract || it.tldr || '',
      }, { topicId: topicId || 't_inbox' });
      const patch = {};
      if (it.pdfId) Object.assign(patch, { pdfId: it.pdfId, pdfName: it.pdfName || `${it.arxivId || 'paper'}.pdf` });
      if (it.venueHints) patch.venueHints = it.venueHints;
      if (it.citationCount != null) patch.citationCount = it.citationCount;
      if (it.s2Id) patch.s2Id = it.s2Id;
      if (Object.keys(patch).length) paper = await savePaper({ ...paperById(paper.id), ...patch });
      const text = st.texts.get(it.id);
      if (text && text.length > (it.abstract || '').length + 200) {
        await api.putText(paper.id, text, it.kind === 'pdf' ? 'text trích từ PDF' : (it.sourceKind || 'nội dung nguồn'));
        noteTextLen(paper.id, text.length);
      }
    }
    it.savedId = paper.id;
    it.status = 'saved';
    it.note = '';
  } catch (e) {
    it.status = 'error';
    it.error = e.message;
  } finally { persist(); draw(); }
}

const extractOn = () => hasCredentials(store.settings) && (st.extract == null ? true : st.extract);

async function runSave() {
  if (st.saving) return;
  const targets = saveTargets();
  if (!targets.length) { toast('Chưa có paper nào được chọn để thêm.'); return; }
  st.saving = true;
  st.stop = false;
  st.lastRun = null;
  const extract = extractOn();
  st.progress = { done: 0, total: targets.length, label: '' };
  let saved = 0;
  let errors = 0;
  draw();
  for (const it of targets) {
    if (st.stop) break;
    st.progress.label = it.title || it.label;
    draw();
    if (extract && it.status !== 'extracted') await extractItem(it);
    if (it.status !== 'error' && !st.stop) await saveItem(it);
    if (it.status === 'saved') saved++; else if (it.status === 'error') errors++;
    st.progress.done++;
  }
  st.saving = false;
  st.lastRun = { saved, errors, stopped: st.stop, extract };
  st.progress = null;
  st.filter = errors ? 'error' : (saved ? 'saved' : st.filter);
  draw();
}

/* ================================================================ giao diện */

let root = null;
const $$ = (sel) => root?.querySelector(sel);

function statusLine(it) {
  if (it.status === 'resolving') return '<span class="bq-state run"><span class="spin"></span> Đang tìm thông tin…</span>';
  if (it.status === 'new') return '<span class="bq-state">Chờ tra cứu</span>';
  if (it.status === 'extracting') return `<span class="bq-state run"><span class="spin"></span> ${escapeHtml(it.note || 'Đang trích xuất ghi chú…')}</span>`;
  if (it.status === 'saving') return '<span class="bq-state run"><span class="spin"></span> Đang lưu…</span>';
  if (it.status === 'error') return `<span class="bq-state err">${escapeHtml(it.error || 'Lỗi')}</span>`;
  if (it.status === 'saved') return `<span class="bq-state ok">✓ Đã lưu vào <b>${escapeHtml(topicById(paperById(it.savedId)?.topicId)?.name || 'thư viện')}</b></span>`;
  return it.note ? `<span class="bq-state warn">${escapeHtml(it.note)}</span>` : '';
}

function decisionHtml(it) {
  const g = groupOf(it);
  if (g === 'saved') return `<a class="bq-open" href="#/paper/${it.savedId}">Mở paper →</a>`;
  if (g === 'error') return `<button class="sm" data-act="retry" data-id="${it.id}">Thử lại</button>`;
  if (isPending(it)) return '<span class="bq-wait">Đang tra cứu</span>';
  return `<div class="bq-decision" role="group" aria-label="Quyết định cho paper này">
    <button type="button" class="${it.include ? 'on' : ''}" data-act="include" data-id="${it.id}" aria-pressed="${!!it.include}" title="Đưa paper này vào thư viện">✓ Thêm</button>
    <button type="button" class="${it.include ? '' : 'on off'}" data-act="exclude" data-id="${it.id}" aria-pressed="${!it.include}" title="Không thêm paper này">Bỏ qua</button></div>`;
}

function cardHtml(it) {
  const g = groupOf(it);
  const dup = it.dupId ? paperById(it.dupId) : null;
  const twin = it.twinOf ? st.items.find((x) => x.id === it.twinOf) : null;
  const title = it.title || (it.kind === 'pdf' ? it.pdfName : it.label);
  const authors = String(it.authors || '').split(',').map((s) => s.trim()).filter(Boolean);
  const meta = [authors.length ? authors.slice(0, 3).join(', ') + (authors.length > 3 ? ' và cộng sự' : '') : '', it.year].filter(Boolean).join(' · ');
  const facts = [
    it.citationCount != null ? `<span class="bq-fact" title="Số trích dẫn (Semantic Scholar)">↗ ${Number(it.citationCount).toLocaleString('vi-VN')} trích dẫn</span>` : '',
    it.pdfId ? '<span class="bq-fact">Có PDF</span>' : '',
    it.textLen > 3000 ? '<span class="bq-fact" title="App đã lấy được toàn văn, trích xuất và chat sẽ chính xác hơn">Có toàn văn</span>' : '',
    it.extraction ? '<span class="bq-fact ok">ghi chú sẵn sàng</span>' : '',
  ].join('');
  const expanded = st.expanded.has(it.id);
  const abs = it.tldr || it.abstract || '';
  const suggestionName = it.suggestion ? (it.suggestion.isNew ? `${it.suggestion.newName} (mới)` : topicById(it.suggestion.topicId)?.name) : topicById(localTopic(it))?.name;
  const inList = it.include && decidable(it);
  return `<article class="bq-card g-${g} ${inList ? 'is-in' : ''} ${isBusy(it) ? 'is-busy' : ''}" data-id="${it.id}">
    <div class="bq-main">
      <div class="bq-top"><span class="bq-src" title="${escapeHtml(it.label)}">${escapeHtml(SOURCE_LABEL[it.kind] || it.kind)}</span>
        <h3 class="bq-title">${it.url ? `<a href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>` : escapeHtml(title)}</h3></div>
      ${meta || it.venueInfo || facts ? `<div class="bq-meta">${meta ? `<span class="bq-authors">${escapeHtml(meta)}</span>` : ''}${venueBadge(it.venueInfo)}${facts}</div>` : ''}
      ${abs ? `<p class="bq-abs">${escapeHtml(expanded ? abs : abs.slice(0, 240))}${!expanded && abs.length > 240 ? '…' : ''}</p>` : ''}
      ${dup ? `<div class="bq-note dup">Thư viện đã có paper này: <a href="#/paper/${dup.id}">${escapeHtml(dup.title.slice(0, 90))}</a>. ${it.include ? 'Nếu trích xuất ghi chú, app sẽ <b>cập nhật bản cũ</b> và giữ ghi chú, trạng thái, đánh giá.' : 'Chọn “Thêm” nếu muốn cập nhật bản cũ.'}</div>` : ''}
      ${twin && !dup ? `<div class="bq-note dup">Trùng với “${escapeHtml((twin.title || twin.label).slice(0, 80))}” ở phía trên danh sách, nên được bỏ qua sẵn.</div>` : ''}
      <div class="bq-status">${statusLine(it)}</div>
      ${expanded ? `<dl class="bq-more"><dt>Nguồn</dt><dd class="mono">${escapeHtml(it.label)}</dd>${it.sourceKind ? `<dt>Nội dung lấy được</dt><dd>${escapeHtml(it.sourceKind)}${it.textLen ? ` · ${it.textLen.toLocaleString('vi-VN')} ký tự` : ''}</dd>` : ''}${it.venue ? `<dt>Venue gốc</dt><dd>${escapeHtml(it.venue)}</dd>` : ''}${it.size ? `<dt>Kích thước</dt><dd>${fmtSize(it.size)}</dd>` : ''}</dl>` : ''}
    </div>
    <div class="bq-side">
      ${decisionHtml(it)}
      ${inList ? `<label class="bq-topic"><span>Thư mục</span><select data-act="topic" data-id="${it.id}"><option value="">Tự gợi ý${suggestionName ? `: ${escapeHtml(suggestionName)}` : ''}</option>${store.topics.map((t) => `<option value="${t.id}" ${it.topicId === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}</select></label>` : ''}
      <div class="bq-links"><button type="button" class="linkish" data-act="toggle" data-id="${it.id}">${expanded ? 'Thu gọn' : 'Chi tiết'}</button>${g !== 'saved' ? `<button type="button" class="linkish danger" data-act="remove" data-id="${it.id}">Xoá khỏi danh sách</button>` : ''}</div>
    </div>
  </article>`;
}

function stepperHtml(c) {
  const has = st.items.length > 0;
  const allSaved = has && c.saved > 0 && !c.include && !c.pending;
  const s2 = !has ? '' : (allSaved ? 'done' : 'active');
  const step = (n, label, sub, state) => `<li class="bq-step ${state}"><span class="n">${state === 'done' ? '✓' : n}</span><span class="t"><b>${label}</b><small>${sub}</small></span></li>`;
  return `<ol class="bq-steps">
    ${step(1, 'Đưa nguồn vào', has ? `${c.all} mục trong danh sách` : 'Dán link hoặc thả file PDF', has ? 'done' : 'active')}
    ${step(2, 'Duyệt và chọn', c.pending ? `Đang tra thông tin ${c.all - c.pending}/${c.all}…` : (has ? `${c.include} paper được chọn` : 'App tự tra thông tin, miễn phí'), s2)}
    ${step(3, 'Lưu vào thư viện', c.saved ? `${c.saved} paper đã lưu` : 'Có thể kèm trích xuất ghi chú', allSaved ? 'done' : '')}
  </ol>`;
}

function filterTabsHtml(c) {
  const tabs = [['all', 'Tất cả', c.all], ['include', 'Sẽ thêm', c.include], ['dup', 'Đã có / trùng', c.dup], ['error', 'Cần xử lý', c.error], ['saved', 'Đã lưu', c.saved]];
  return `<div class="seg bq-tabs" role="tablist">${tabs.filter(([k, , n]) => k === 'all' || n || st.filter === k).map(([k, l, n]) => `<button type="button" role="tab" aria-selected="${st.filter === k}" data-filter="${k}" class="${st.filter === k ? 'active' : ''} ${k === 'error' && n ? 't-err' : ''}">${l}<span class="cnt">${n}</span></button>`).join('')}</div>`;
}

function actionBarHtml(c) {
  const key = hasCredentials(store.settings);
  const targets = saveTargets().length;
  if (st.saving && st.progress) {
    const pct = Math.round((st.progress.done / Math.max(1, st.progress.total)) * 100);
    return `<div class="bq-bar running"><div class="bq-progress"><div style="width:${pct}%"></div></div>
      <div class="bq-bar-info">Đang xử lý ${Math.min(st.progress.done + 1, st.progress.total)}/${st.progress.total} · <b>${escapeHtml(String(st.progress.label).slice(0, 70))}</b></div><span class="spacer"></span>
      <button type="button" class="sm danger" data-act="stop" ${st.stop ? 'disabled' : ''}>${st.stop ? 'Đang dừng sau mục này…' : 'Dừng'}</button></div>`;
  }
  return `<div class="bq-bar">
    <div class="bq-bar-info"><b>${targets}</b> paper sẽ được thêm${c.pending ? ` <span class="hint">· còn ${c.pending} mục đang tra cứu</span>` : ''}</div>
    <label class="bq-extract ${key ? '' : 'disabled'}" title="${key ? 'AI đọc từng paper và điền Problem, Bottleneck, Key Idea, Validation, Limitation' : 'Cần API key trong Cài đặt'}">
      <input type="checkbox" data-act="extract" ${extractOn() ? 'checked' : ''} ${key ? '' : 'disabled'}> Trích xuất ghi chú bằng AI${key ? '' : ' · <a href="#/settings">cần API key</a>'}</label>
    <span class="spacer"></span>
    <button type="button" class="primary" data-act="save" ${targets ? '' : 'disabled'}>${targets ? `Lưu ${targets} paper vào thư viện` : (c.pending ? 'Đang tra cứu…' : 'Chưa chọn paper nào')}</button>
  </div>`;
}

function summaryHtml() {
  const r = st.lastRun;
  if (!r || st.saving) return '';
  const parts = [];
  if (r.saved) parts.push(`Đã lưu ${r.saved} paper${r.extract ? ' kèm ghi chú' : ', chưa trích xuất ghi chú (làm sau bằng nút “Trích xuất lại” trong trang paper)'}.`);
  if (r.errors) parts.push(`${r.errors} mục gặp lỗi, xem tab “Cần xử lý”.`);
  if (!parts.length) parts.push('Không có paper nào được lưu.');
  return `<div class="bq-summary ${r.errors ? 'warn' : 'ok'}"><span><b>${r.stopped ? 'Đã dừng.' : 'Xong.'}</b> ${parts.join(' ')}</span>
    <span class="spacer"></span>${r.saved ? '<a href="#/library">Mở thư viện →</a>' : ''}<button type="button" class="linkish" data-act="clean">Dọn mục đã lưu</button><button type="button" class="linkish" data-act="dismiss" aria-label="Đóng">✕</button></div>`;
}

function skippedHtml() {
  if (!st.skipped.length) return '';
  return `<details class="bq-skipped"><summary>${st.skipped.length} link không giống paper đã được bỏ qua</summary>
    ${st.skipped.map((d, i) => `<div class="row"><span class="mono">${escapeHtml(d.label)}</span><span class="spacer"></span><button type="button" class="linkish" data-act="add-skipped" data-i="${i}">Vẫn thêm</button></div>`).join('')}</details>`;
}

function sourceHtml() {
  const open = st.sourceOpen ?? !st.items.length;
  const flash = st.flash ? `<div class="bq-flash">${st.flash}</div>` : '';
  if (!open) {
    return `<div class="bq-source collapsed"><button type="button" class="sm" data-act="source-open">＋ Thêm link hoặc PDF khác</button>${flash}${skippedHtml()}</div>`;
  }
  return `<section class="bq-source">
    <div class="bq-source-grid">
      <div class="bq-paste">
        <label class="label-text" for="bq-text">Dán văn bản có link paper</label>
        <textarea id="bq-text" rows="6" placeholder="Email, reading list, ghi chú, BibTeX… App tự nhận link arXiv, DOI, OpenReview, ACL, link PDF.&#10;&#10;Ví dụ:&#10;Attention Is All You Need https://arxiv.org/abs/1706.03762&#10;doi: 10.1109/CVPR52729.2023.01234"></textarea>
        <div class="row wrap"><button type="button" class="primary sm" data-act="find">Tìm paper trong văn bản</button>
          <label class="row hint" style="gap:4px"><input type="checkbox" id="bq-titles" style="width:auto"> dòng không có link là tên paper</label>
          ${st.items.length ? '<span class="spacer"></span><button type="button" class="linkish" data-act="source-close">Thu gọn</button>' : ''}</div>
      </div>
      <div class="bq-or"><span>hoặc</span></div>
      <div class="dropzone bq-drop" id="bq-drop" tabindex="0"><div class="bq-drop-icon">⤓</div><b>Thả nhiều file PDF vào đây</b>bấm để chọn file · <a href="#" data-act="folder">chọn cả thư mục</a></div>
    </div>
    <input type="file" id="bq-files" accept="application/pdf,.pdf" multiple hidden>
    <input type="file" id="bq-dir" webkitdirectory multiple hidden>
    ${flash}${skippedHtml()}
  </section>`;
}

function listHtml(c) {
  if (!st.items.length) {
    return `<div class="bq-empty">Mỗi paper tìm được sẽ hiện thành một thẻ ở đây. App tự tra tiêu đề, tác giả, venue, hạng và đánh dấu paper đã có trong thư viện, bạn chỉ cần chọn <b>Thêm</b> hoặc <b>Bỏ qua</b> rồi bấm lưu.</div>`;
  }
  const list = visibleItems();
  const anyDecidable = list.some(decidable);
  const busy = st.saving || st.refreshing;
  return `<div class="bq-listhead">${filterTabsHtml(c)}
      <span class="bq-tools"><button type="button" class="sm" data-act="refresh" ${busy ? 'disabled' : ''} title="Đồng bộ lại với thư viện: paper đã xoá khỏi thư viện quay về để duyệt, đánh dấu trùng được tính lại, mục lỗi được tra cứu lại">${st.refreshing ? '<span class="spin"></span> Đang làm mới…' : '↻ Làm mới'}</button>
      ${c.saved ? `<button type="button" class="linkish" data-act="clean" ${busy ? 'disabled' : ''} title="Bỏ các thẻ đã lưu khỏi danh sách (paper vẫn ở trong thư viện)">Dọn mục đã lưu (${c.saved})</button>` : ''}
      <button type="button" class="linkish danger" data-act="clear-all" ${busy ? 'disabled' : ''} title="Bỏ mọi thẻ khỏi danh sách để bắt đầu lại (paper đã lưu vẫn ở trong thư viện)">Xoá cả danh sách</button></span>
      <span class="spacer"></span>
      ${anyDecidable ? `<span class="bq-bulk"><button type="button" class="linkish" data-act="all-in">Thêm tất cả</button><button type="button" class="linkish" data-act="all-out">Bỏ qua tất cả</button>
      <select data-act="bulk-topic" aria-label="Đặt thư mục cho các paper đang chọn Thêm"><option value="">Đặt thư mục cho các paper đã chọn…</option><option value="__auto">Tự gợi ý</option>${store.topics.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}</select></span>` : ''}
    </div>
    <div class="bq-list">${list.map(cardHtml).join('') || '<div class="bq-empty small">Không có mục nào trong tab này.</div>'}</div>`;
}

function draw() {
  if (!root || !document.body.contains(root)) return;
  const c = counts();
  const view = root.closest('.view');
  const scroll = view?.scrollTop;
  const text = $$('#bq-text')?.value;
  root.innerHTML = `${stepperHtml(c)}${sourceHtml()}${summaryHtml()}${listHtml(c)}${st.items.length ? actionBarHtml(c) : ''}`;
  if (text && $$('#bq-text')) $$('#bq-text').value = text;
  if (view && scroll != null) view.scrollTop = scroll;
  bindSource();
}

function bindSource() {
  const drop = $$('#bq-drop');
  if (!drop) return;
  drop.addEventListener('click', (e) => { if (e.target.closest('[data-act="folder"]')) { e.preventDefault(); $$('#bq-dir').click(); } else $$('#bq-files').click(); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $$('#bq-files').click(); } });
  $$('#bq-files').addEventListener('change', (e) => { acceptFiles(e.target.files); e.target.value = ''; });
  $$('#bq-dir').addEventListener('change', (e) => { acceptFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); }));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); acceptFiles(e.dataTransfer.files); });
}

async function acceptFiles(fl) {
  const files = [...(fl || [])];
  if (!files.length) return;
  st.flash = `<span class="spin"></span> Đang đọc ${files.length} file…`;
  draw();
  const before = st.items.length;
  const n = await addPdfFiles(files, (m) => { st.flash = `<span class="spin"></span> ${escapeHtml(m)}`; draw(); });
  const added = st.items.length - before;
  st.flash = n ? `Đã thêm ${added} file PDF${n > added ? `, ${n - added} file đã có trong danh sách` : ''}. App đang tự tra thông tin.` : 'Không có file PDF nào trong số file vừa chọn.';
  st.sourceOpen = null;
  st.filter = 'all';
  draw();
  autoResolve();
}

function findInText() {
  const text = $$('#bq-text')?.value || '';
  const found = extractLinks(text, { titleLines: $$('#bq-titles')?.checked });
  if (!found.length) { toast('Không tìm thấy link paper, arXiv ID, DOI hay mục BibTeX nào.', 3500, 'err'); return; }
  const papers = found.filter((d) => d.kind !== 'other-url');
  const others = found.filter((d) => d.kind === 'other-url');
  const before = st.items.length;
  addDetected(papers);
  const added = st.items.length - before;
  const known = new Set(st.skipped.map((d) => d.key));
  st.skipped = st.skipped.concat(others.filter((d) => !known.has(d.key)));
  const already = papers.length - added;
  st.flash = `Đã thêm ${added} paper${already ? `, ${already} mục đã có sẵn trong danh sách` : ''}${others.length ? `, bỏ qua ${others.length} link không giống paper` : ''}. App đang tự tra thông tin.`;
  if ($$('#bq-text')) $$('#bq-text').value = '';
  st.sourceOpen = null;
  st.filter = 'all';
  draw();
  autoResolve();
}

/** Đồng bộ danh sách với thư viện hiện tại và tra cứu lại các mục lỗi. */
async function refreshList() {
  if (st.saving || st.refreshing) return;
  st.refreshing = true;
  draw();
  let back = 0;
  let retry = 0;
  try {
    const s = await api.state();
    store.papers = s.papers;
    store.topics = s.topics;
    for (const it of st.items) {
      if (isBusy(it)) continue;
      if (it.status === 'saved') {
        const p = paperById(it.savedId);
        if (p && !p.deletedAt) { it.title = p.title || it.title; continue; }
        // Paper đã bị xoá khỏi thư viện: đưa thẻ về để duyệt lại.
        Object.assign(it, { status: it.extraction ? 'extracted' : 'resolved', savedId: '', userDecided: false, note: 'Paper này không còn trong thư viện.' });
        back++;
        markDuplicate(it);
      } else if (it.status === 'error') {
        Object.assign(it, { status: 'new', error: '', userDecided: false });
        retry++;
      } else if (!isPending(it)) {
        markDuplicate(it);
      }
    }
    persist();
    const parts = [back ? `${back} paper không còn trong thư viện được đưa về để duyệt` : '', retry ? `tra cứu lại ${retry} mục lỗi` : ''].filter(Boolean);
    toast(parts.length ? `Đã làm mới: ${parts.join(', ')}.` : 'Đã làm mới danh sách.');
  } catch (e) {
    toast(`Không làm mới được: ${e.message}`, 3500, 'err');
  } finally {
    st.refreshing = false;
    draw();
  }
  if (retry) autoResolve();
}

/** Bỏ mọi thẻ khỏi danh sách, hoàn tác được trong vài giây. PDF đã tải lên của mục chưa lưu chỉ bị xoá khi hết hạn hoàn tác. */
function clearAll() {
  if (!st.items.length || st.saving) return;
  const prev = { items: st.items, texts: new Map(st.texts), skipped: st.skipped, lastRun: st.lastRun };
  let undone = false;
  st.items = [];
  st.skipped = [];
  st.lastRun = null;
  st.filter = 'all';
  st.expanded.clear();
  st.sourceOpen = null;
  st.flash = '';
  persist();
  draw();
  toast(`Đã xoá ${prev.items.length} thẻ khỏi danh sách. Paper đã lưu vẫn ở trong thư viện.`, 6000, '', {
    label: 'Hoàn tác',
    onClick: () => { undone = true; Object.assign(st, { items: prev.items.concat(st.items), texts: prev.texts, skipped: prev.skipped, lastRun: prev.lastRun }); persist(); draw(); },
  });
  setTimeout(() => {
    if (undone) return;
    for (const it of prev.items) {
      st.texts.delete(it.id);
      if (it.pdfId && !it.savedId) api.deletePdf(it.pdfId).catch(() => {});
    }
  }, 6500);
}

function onClick(e) {
  const f = e.target.closest('[data-filter]');
  if (f) { st.filter = f.dataset.filter; draw(); return; }
  const b = e.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
  const act = b.dataset.act;
  const it = b.dataset.id ? st.items.find((x) => x.id === b.dataset.id) : null;
  switch (act) {
    case 'find': findInText(); break;
    case 'source-open': st.sourceOpen = true; draw(); break;
    case 'source-close': st.sourceOpen = false; draw(); break;
    case 'include': case 'exclude': it.include = act === 'include'; it.userDecided = true; persist(); draw(); break;
    case 'toggle': if (st.expanded.has(it.id)) st.expanded.delete(it.id); else st.expanded.add(it.id); draw(); break;
    case 'retry': it.status = 'new'; it.error = ''; it.userDecided = false; persist(); draw(); autoResolve(); break;
    case 'remove':
      if (it.pdfId && !it.savedId) api.deletePdf(it.pdfId).catch(() => {});
      st.items = st.items.filter((x) => x !== it);
      persist(); draw(); break;
    case 'all-in': case 'all-out':
      for (const x of visibleItems()) if (decidable(x)) { x.include = act === 'all-in'; x.userDecided = true; }
      persist(); draw(); break;
    case 'save': runSave(); break;
    case 'stop': st.stop = true; draw(); break;
    case 'clean': {
      const n = st.items.filter((x) => x.status === 'saved').length;
      st.items = st.items.filter((x) => x.status !== 'saved'); st.lastRun = null; st.filter = 'all'; persist(); draw();
      toast(`Đã bỏ ${n} thẻ đã lưu khỏi danh sách. Paper vẫn ở trong thư viện.`);
      break;
    }
    case 'refresh': refreshList(); break;
    case 'clear-all': clearAll(); break;
    case 'dismiss': st.lastRun = null; draw(); break;
    case 'add-skipped': {
      const d = st.skipped.splice(Number(b.dataset.i), 1)[0];
      addDetected([{ ...d, kind: 'paper-url' }]);
      draw(); autoResolve(); break;
    }
    default: break;
  }
}

function onChange(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.dataset.act === 'topic') {
    const it = st.items.find((x) => x.id === el.dataset.id);
    it.topicId = el.value;
    persist();
  } else if (el.dataset.act === 'bulk-topic' && el.value) {
    const v = el.value === '__auto' ? '' : el.value;
    let n = 0;
    for (const x of visibleItems()) if (x.include && decidable(x)) { x.topicId = v; n++; }
    persist();
    draw();
    toast(`Đã đặt thư mục cho ${n} paper.`);
  } else if (el.dataset.act === 'extract') {
    st.extract = el.checked;
    draw();
  }
}

export async function renderBatch(container, { files = [] } = {}) {
  await load();
  root = container;
  root.classList.add('bq');
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('keydown', (e) => { if (e.target.id === 'bq-text' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) findInText(); });
  draw();
  if (files.length) await acceptFiles(files);
  else if (st.items.some((i) => i.status === 'new')) autoResolve();
}
