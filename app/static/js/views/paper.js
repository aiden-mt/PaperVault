// Trang chi tiết một paper: đọc ghi chú, chỉnh sửa, PDF, hỏi đáp, paper liên quan, trích dẫn, nguồn.
import { api } from '../api.js';
import { store, onChange, topicOf, savePaper, removePaper, paperById, topicById, saveSettings } from '../store.js';
import { escapeHtml, fmtDate, fmtRelative, STATUS_LABEL, STATUS_ORDER, copyText, download, norm, uid } from '../util.js';
import { $, el, toast, confirmDialog, mdToHtml, ratingControl, topicBadge, setStatus, spinner, dialog, showProgress } from '../ui.js';
import { renderSections } from '../render.js';
import { paperToMarkdown, quickNoteLine, bibtexOf } from '../markdown.js';
import { normalizeExtraction } from '../schema.js';
import { attachRowHtml, createAttachBox, attachmentParts, msgImgsHtml, msgFilesHtml, zoomImage } from '../attach.js';
import { saveAnswerToNotebook } from '../notebook-save.js';
import { askPaper, NATIVE_PDF_PROVIDERS, hasCredentials, translateText, translateNotesAI, settingsFor, modelLabel } from '../llm.js';
import { CHAT_LANGS } from '../prompts.js';
import { s2Ident, pubTime, citeVelocity, fmtPub, citeRole, ROLE_LABELS, ROLE_HINTS, s2Key, ctxQuotes } from '../s2util.js';
import { buildWhatsNew, whatsNewJob, removeWhatsNew, whatsNewHtml, whatsNewMarkdown, addQueryOf, bindWhatsNewChips } from '../whatsnew.js';
import { timelineHtml, bindTimeline, timelineTime } from '../timeline.js';
import { loadWatches, addWatch, removeWatchWhere } from '../watches.js';
import { openGraph3D } from '../graph3d.js';
import { trackJob, jobProgressOpts, runJob, getJob, jobRunning, followJob } from '../bgjobs.js';
import { readableChatMd } from '../readable.js';
import { loadPages, pagesForPaper, pageLabel } from '../notebook.js';
import { buildResearchMap, researchJob, removeResearchMap, researchMapHtml, researchMapMarkdown, researchChip, togglePin, isPinned, removePin, compareState, compareBadgeHtml, compareButtonHtml, PER_KIND_OPTIONS, PER_KIND_DEFAULT, perKindValue, MAIN_CAP, BATCH_SIZE, fillMissing, fillJob, missingCodes, bindResearchSort, researchLog, restoreResearchMap, removeLogEntry, mapSummary, LOG_EVENTS, bindResearchLinks, jumpTo } from '../research.js';
import { titleHtml } from '../richtext.js';
import { NOTE_LANGS, sourceLang, displayLang, notesIn } from '../notes-i18n.js';
import { checkNumbers, checkDepth } from '../quality.js';
import { pdfFullText } from '../pdftext.js';
import { autoHighlight, clearAutoHighlights, budgetFor, KINDS, LEVELS } from '../autohighlight.js';
import { buildLecture, lectureJob, removeLecture, lectureHtml, lectureMarkdown, lectureIn, SECTION_ORDER, sectionTitle } from '../lecture.js';
import { TRANSLATE_LANGS, translateConfig } from '../translate.js';
import { apaCitation, copyRich } from '../cite.js';
import { reExtractSection, restoreSection } from '../section-extract.js';
import { runExtraction, savePaperFromExtraction, acceptPdfFile } from '../extract.js';
import { findPdf, attachFromUrl, autoAttach } from '../pdffind.js';
import { venueBadge, venueDetailHtml, VENUE_TYPES } from '../venue.js';

// Xếp từ dùng nhiều đến dùng ít: đọc hiểu (Ghi chú, PDF, Bài giảng, Hỏi đáp) -> mở rộng (Liên quan, Hướng nghiên cứu)
// -> viết bài (Trích dẫn) -> sửa dữ liệu (Chỉnh sửa, Nguồn).
const TABS = [['notes', 'Ghi chú'], ['pdf', 'PDF'], ['lecture', 'Bài giảng'], ['ask', 'Hỏi đáp'], ['related', 'Liên quan'], ['research', 'Hướng nghiên cứu'], ['cite', 'Trích dẫn'], ['edit', 'Chỉnh sửa'], ['source', 'Nguồn']];

/* ---------- helpers cho form chỉnh sửa (kế thừa extension) ---------- */
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let cur = obj;
  for (const k of keys) { if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; }
  cur[last] = value;
}
const codec = {
  text: { out: (v) => String(v ?? ''), in: (s) => s.trim() },
  csv: { out: (v) => (v || []).join(', '), in: (s) => s.split(',').map((x) => x.trim()).filter(Boolean) },
  lines: { out: (v) => (v || []).join('\n'), in: (s) => s.split('\n').map((x) => x.trim()).filter(Boolean) },
  ideas: {
    out: (v) => (v || []).map((i) => [i.idea, i.how_to_apply, i.effort].filter(Boolean).join(' :: ')).join('\n'),
    in: (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [idea, how = '', effort = ''] = l.split('::').map((x) => x.trim()); return { idea, how_to_apply: how, effort }; }),
  },
  components: {
    out: (v) => (v || []).map((c) => [c.name, c.kind, c.detail].filter(Boolean).join(' :: ')).join('\n'),
    in: (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name, kind = 'other', detail = ''] = l.split('::').map((x) => x.trim()); return { name, kind, detail }; }),
  },
  datasets: {
    out: (v) => (v || []).map((d) => [d.name, d.source, d.scale, d.characteristics, d.preprocessing].join(' | ')).join('\n'),
    in: (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name = '', source = '', scale = '', characteristics = '', preprocessing = ''] = l.split('|').map((x) => x.trim()); return { name, source, scale, characteristics, preprocessing }; }).filter((d) => d.name),
  },
  evidence: {
    out: (v) => (v || []).map((x) => [x.claim, x.location, x.purpose].join(' | ')).join('\n'),
    in: (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [claim = '', location = '', purpose = ''] = l.split('|').map((x) => x.trim()); return { claim, location, purpose }; }),
  },
  chain: {
    out: (v) => (v || []).map((x) => [x.role, x.step, x.section].filter((y, k) => k < 2 || y).join(' :: ')).join('\n'),
    in: (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const parts = l.split('::').map((x) => x.trim()); const hasRole = parts.length > 1 && /^(premise|gap|claim|method|evidence|conclusion)$/i.test(parts[0]); return { role: hasRole ? parts[0].toLowerCase() : 'claim', step: hasRole ? parts[1] : parts[0], section: (hasRole ? parts[2] : parts[1]) || '' }; }).filter((x) => x.step),
  },
  metrics: {
    out: (v) => (v || []).map((m) => [m.name, m.dataset, m.baseline, m.proposed, m.delta].join(' | ')).join('\n'),
    in: (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name = '', dataset = '', baseline = '', proposed = '', delta = ''] = l.split('|').map((x) => x.trim()); return { name, dataset, baseline, proposed, delta }; }),
  },
};
function field(draft, label, path, type, { input = 'textarea', rows = 3, full = false, hint = '' } = {}) {
  const value = codec[type].out(getPath(draft, path));
  const control = input === 'textarea'
    ? `<textarea data-path="${path}" data-type="${type}" rows="${rows}">${escapeHtml(value)}</textarea>`
    : `<input type="text" data-path="${path}" data-type="${type}" value="${escapeHtml(value)}">`;
  return `<label class="field ${full ? 'full' : ''}"><span class="label-text">${label}</span>${control}${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
}

/* ---------- paper liên quan trong thư viện (theo tag / dataset / chủ đề) ---------- */
function localRelated(p) {
  const tags = new Set((p.extraction?.tags || []).map(norm));
  const ds = new Set((p.extraction?.validation?.datasets || []).map(norm));
  return store.papers.filter((x) => x.id !== p.id).map((x) => {
    let score = 0;
    for (const t of x.extraction?.tags || []) if (tags.has(norm(t))) score += 2;
    for (const d of x.extraction?.validation?.datasets || []) if (ds.has(norm(d))) score += 3;
    if (x.topicId === p.topicId) score += 1;
    return { x, score };
  }).filter((r) => r.score > 1).sort((a, b) => b.score - a.score).slice(0, 8);
}

const INTENT_LABEL = { background: 'bối cảnh', methodology: 'dùng phương pháp', result: 'so sánh kết quả' };
/** Câu trích dẫn nguyên văn (Semantic Scholar): tác giả viết gì khi dẫn bài này. */
function ctxHtml(item, kind = '') {
  const ctx = (item._contexts || []).slice().sort((a, b) => b.length - a.length);
  const tags = `${item._influential ? '<span class="badge accent" title="Semantic Scholar đánh giá bài dẫn thật sự dựa vào bài được dẫn">ảnh hưởng lớn</span>' : ''}${(item._intents || []).map((x) => `<span class="badge">${escapeHtml(INTENT_LABEL[x] || x)}</span>`).join('')}`;
  if (!ctx.length) return tags ? `<div class="ctx-tags">${tags}</div>` : '';
  // Tài liệu tham khảo: câu nằm trong bài gốc (tím). Paper dẫn bài này: câu nằm trong bài kia (cam).
  return ctxQuotes(ctx, kind === 'references' ? 'main' : 'other', { extra: tags ? `<div class="ctx-tags">${tags}</div>` : '' });
}

/** true khi người dùng đang mở đúng tab của paper này (bảng việc nền khi đó không cần hiện thẻ của nó). */
const onPaperTab = (pid, tabKey) => () => {
  const m = location.hash.match(/^#\/paper\/([^?]+)(?:\?(.*))?$/);
  if (!m || decodeURIComponent(m[1]) !== pid) return false;
  return (new URLSearchParams(m[2] || '').get('tab') || 'notes') === tabKey;
};
/** true khi người dùng đang mở trang của paper này (tab nào cũng được). */
const onPaperPage = (pid) => () => {
  const m = location.hash.match(/^#\/paper\/([^?]+)/);
  return !!m && decodeURIComponent(m[1]) === pid;
};
// Lần trích xuất lại một mục gần nhất, để hoàn tác: { id, key, label, previous }. Nằm ngoài trang để việc xong lúc
// người dùng đang ở trang khác thì mở lại vẫn hoàn tác được.
let lastRedo = null;
/** Bắt đầu dựng bài giảng và theo dõi tiến độ ở bảng việc nền. */
const trackLecture = (pid) => trackJob(`lec:${pid}`, buildLecture(pid), { label: 'Bài giảng', title: paperById(pid)?.title || '', href: `#/paper/${pid}?tab=lecture`, here: onPaperTab(pid, 'lecture'), expectedMs: () => 40000 });

function s2Item(item, { onAdd, role = null, kind = '', seen = false, onSeen = null, showVelocity = false, cmp = null, onCompare = null }) {
  const ext = item.externalIds || {};
  const link = item.url || (ext.ArXiv ? `https://arxiv.org/abs/${ext.ArXiv}` : (ext.DOI ? `https://doi.org/${ext.DOI}` : ''));
  const inLib = store.papers.find((p) => (ext.ArXiv && p.arxivId && p.arxivId.replace(/v\d+$/, '') === ext.ArXiv) || (item.paperId && p.s2Id === item.paperId));
  const vel = citeVelocity(item);
  const roleBadge = role ? `<span class="badge role-${role.role}" title="${escapeHtml(`${ROLE_HINTS[kind]?.[role.role] || ''}. ${role.why}`)}">${escapeHtml(ROLE_LABELS[kind]?.[role.role] || '')}</span>` : '';
  const cmpCls = cmp?.code ? `s2-cmp s2-cmp-${cmp.rel || 'pin'}` : (cmp?.pinned ? 's2-cmp s2-cmp-wait' : '');
  const node = el(`<div class="s2-item ${seen || inLib ? 'seen' : ''} ${cmpCls}"><div class="body">
    <div class="t">${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">${titleHtml(item.title || '')}</a>` : titleHtml(item.title || '')}</div>
    <div class="hint">${cmp ? compareBadgeHtml(cmp) : ''}${roleBadge}${escapeHtml((item.authors || []).slice(0, 4).map((a) => a.name).join(', '))}${fmtPub(item) ? ` · ${fmtPub(item)}` : ''}${item.venue ? ` · ${escapeHtml(item.venue)}` : ''}${item.citationCount != null ? ` · ↗ ${item.citationCount}` : ''}${showVelocity && vel ? ` · ${vel >= 10 ? Math.round(vel) : vel.toFixed(1)} trích dẫn/tháng` : ''}${inLib ? ' · <b>đã có trong thư viện</b>' : (seen ? ' · đã xem' : '')}</div>
    ${ctxHtml(item, kind)}
    ${item.tldr ? `<div class="tldr" title="Tóm tắt một câu do Semantic Scholar tạo"><span class="badge">TLDR</span> ${escapeHtml(item.tldr)}</div>` : `<div class="abs">${escapeHtml(item.abstract || '')}</div>`}</div>
    <div class="s2-acts">${inLib ? `<a class="badge ok" href="#/paper/${inLib.id}">đã có</a>` : `<button class="sm" data-add>+ Thêm</button>`}${!inLib && onSeen ? `<button class="sm ghost" data-seen>${seen ? 'Bỏ đánh dấu' : 'Đã xem'}</button>` : ''}${onCompare && cmp ? compareButtonHtml(cmp, 'data-cmp') : ''}</div></div>`);
  node.querySelector('[data-add]')?.addEventListener('click', () => onAdd(ext.ArXiv ? `arXiv:${ext.ArXiv}` : (ext.DOI ? ext.DOI : link), item));
  node.querySelector('[data-seen]')?.addEventListener('click', () => onSeen(item, !seen));
  node.querySelector('[data-cmp]')?.addEventListener('click', (e) => onCompare(item, cmp, !!e.currentTarget.dataset.cmpGo));
  return node;
}

export async function render(root, { params, query }) {
  const id = params[0];
  let p = paperById(id);
  if (!p) { root.innerHTML = '<div class="empty">Không tìm thấy paper này. <a href="#/library">Về thư viện</a></div>'; return; }
  let tab = query.get('tab') || 'notes';
  let draft = null;

  // Đầu trang thu gọn (chỉ còn tên + chủ đề, trạng thái): mặc định khi khung thấp hoặc hẹp, ví dụ khi chia đôi màn hình.
  // Lựa chọn của người dùng nhớ riêng cho khung nhỏ và khung lớn.
  const smallBox = window.innerHeight < 700 || window.innerWidth < 760;
  const headKey = smallBox ? 'pv.ppHeadS' : 'pv.ppHead';
  let headPref = null;
  try { headPref = localStorage.getItem(headKey); } catch (_) { /* bỏ qua */ }
  const compact = headPref ? headPref === 'compact' : smallBox;
  root.innerHTML = `<div class="paper-page">
    <div class="paper-head ${compact ? 'compact' : ''}" id="pp-head">
      <div class="row"><a href="#/library/${p.topicId || 't_inbox'}" class="hint">← ${escapeHtml(topicOf(p)?.name || 'Thư viện')}</a><span class="spacer"></span>
        <button id="pp-headt" class="sm ghost" title="Thu gọn / mở rộng phần đầu trang (tác giả, tag, venue)">${compact ? '▾ Chi tiết' : '▴ Thu gọn'}</button>
        <button id="pp-copy" class="sm">Copy Markdown</button>
        <button id="pp-reextract" class="sm" title="Chạy lại trích xuất từ nguồn đã lưu / PDF">Trích xuất lại</button>
        <button id="pp-del" class="sm danger">Xoá</button></div>
      <input id="pp-title" class="title-input" value="${escapeHtml(p.title)}" title="Bấm để sửa tên">
      <div id="pp-meta" class="meta-row"></div>
      ${p.needsExtraction ? '<div class="dup-warn" style="margin-top:8px">Paper này mới có metadata (nhập từ .bib/.ris hoặc lưu nhanh), chưa trích xuất ghi chú. Bấm <b>Trích xuất lại</b> ở trên khi cần.</div>' : ''}
      <div class="meta-row">
        <select id="pp-topic">${store.topics.map((t) => `<option value="${t.id}" ${t.id === (p.topicId || 't_inbox') ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}</select>
        <span id="pp-labels" class="topic-chips"></span>
        <select id="pp-status">${STATUS_ORDER.map((s) => `<option value="${s}" ${(p.status || 'to-read') === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select>
        <span id="pp-rating"></span>
        <span class="spacer"></span><span id="pp-save-status" class="status"></span>
      </div>
    </div>
    <div class="tabs page-tabs" id="pp-tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div id="pp-body"></div>
  </div>`;

  $('pp-headt').addEventListener('click', () => {
    const h = $('pp-head');
    const on = !h.classList.contains('compact');
    h.classList.toggle('compact', on);
    $('pp-headt').textContent = on ? '▾ Chi tiết' : '▴ Thu gọn';
    try { localStorage.setItem(headKey, on ? 'compact' : 'full'); } catch (_) { /* bỏ qua */ }
  });

  const metaRow = () => {
    const e = p.extraction || {};
    $('pp-meta').innerHTML = [
      venueBadge(p.venueInfo),
      e.authors?.length ? `<span class="hint">${escapeHtml(e.authors.join(', '))}</span>` : '',
      e.venue ? `<span class="badge">${escapeHtml(e.venue)}</span>` : '',
      e.year ? `<span class="badge">${escapeHtml(e.year)}</span>` : '',
      p.citationCount != null ? `<span class="badge" title="Số trích dẫn (Semantic Scholar)">↗ ${p.citationCount} trích dẫn</span>` : '',
      e.confidence ? `<span class="badge conf-${escapeHtml(e.confidence)}">tin cậy: ${escapeHtml(e.confidence)}</span>` : '',
      p.url ? `<a class="badge" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">🔗 mở link</a>` : '',
      p.arxivId ? `<a class="badge" href="https://arxiv.org/abs/${escapeHtml(p.arxivId)}" target="_blank" rel="noopener">arXiv:${escapeHtml(p.arxivId)}</a>` : '',
      p.pdfId ? `<a class="badge" href="${api.pdfUrl(p.pdfId)}" target="_blank">📄 PDF</a>` : '',
      ...(e.tags || []).map((t) => `<a class="badge accent" href="#/library?tag=${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`),
      `<span class="hint">lưu ${fmtDate(p.createdAt)}${p.meta?.model ? ` · ${escapeHtml(p.meta.provider)}/${escapeHtml(p.meta.model)}` : ''}</span>`,
    ].filter(Boolean).join(' ');
  };
  metaRow();

  const quickSave = async (patch) => {
    p = await savePaper({ ...paperById(p.id), ...patch });
    if (!jobRunning(`rex:${p.id}`)) {
      setStatus('pp-save-status', 'Đã lưu.', 'ok');
      setTimeout(() => { if (!jobRunning(`rex:${p.id}`)) setStatus('pp-save-status', ''); }, 1500);
    }
    metaRow();
  };
  $('pp-rating').appendChild(ratingControl(p.rating || 0, (n) => quickSave({ rating: n })));

  const drawLabels = () => {
    const extra = (p.topicIds || []).filter((id) => id !== p.topicId && topicById(id));
    $('pp-labels').innerHTML = `${extra.map((id) => `<span class="badge topic" style="--c:${escapeHtml(topicById(id).color || '#888')}"><i></i>${escapeHtml(topicById(id).name)} <button class="ghost" style="padding:0 2px;border:none" data-unlabel="${id}" title="Bỏ nhãn">✕</button></span>`).join('')}<button class="ghost sm" id="pp-add-label" title="Gắn thêm nhãn phụ (paper thuộc nhiều chủ đề)">+ nhãn</button>`;
    $('pp-add-label').addEventListener('click', async () => {
      const opts = store.topics.filter((t) => t.id !== p.topicId);
      const chosen = new Set(p.topicIds || []);
      const ok = await dialog({
        title: 'Nhãn phụ', width: 460,
        body: `<p class="hint">Paper vẫn nằm ở thư mục chính, nhưng cũng hiện khi lọc theo các chủ đề được tick.</p>${opts.map((t) => `<label class="row" style="gap:6px;padding:3px 0"><input type="checkbox" value="${t.id}" ${chosen.has(t.id) ? 'checked' : ''} style="width:auto"> ${topicBadge(t)}</label>`).join('')}`,
        buttons: [{ label: 'Huỷ', value: false }, { label: 'Lưu', value: true, primary: true, onClick: async (body, close) => {
          const ids = [...body.querySelectorAll('input:checked')].map((i) => i.value);
          await quickSave({ topicIds: ids });
          close(true); return false;
        } }],
      });
      if (ok) drawLabels();
    });
    $('pp-labels').querySelectorAll('[data-unlabel]').forEach((b) => b.addEventListener('click', async () => { await quickSave({ topicIds: (p.topicIds || []).filter((x) => x !== b.dataset.unlabel) }); drawLabels(); }));
  };
  drawLabels();
  $('pp-topic').addEventListener('change', (e) => quickSave({ topicId: e.target.value }));
  $('pp-status').addEventListener('change', (e) => quickSave({ status: e.target.value }));
  $('pp-title').addEventListener('change', (e) => { const t = e.target.value.trim(); if (t) quickSave({ title: t }); });
  $('pp-copy').addEventListener('click', async () => {
    // Copy theo ngôn ngữ đang hiển thị ở tab Ghi chú.
    const opts = shown && tab === 'notes' ? shown : { lang: sourceLang(p.extraction || {}) };
    await copyText(paperToMarkdown(p, topicOf(p), opts));
    toast(`Đã copy Markdown (${langName(opts.lang)}).`);
  });
  $('pp-del').addEventListener('click', async () => {
    if (!(await confirmDialog(`Xoá paper "${p.title}"?`, { danger: true, okLabel: 'Xoá' }))) return;
    await removePaper(p.id);
    toast('Đã xoá.');
    location.hash = '#/library';
  });
  $('pp-reextract').addEventListener('click', reExtract);
  { const j = getJob(`rex:${p.id}`); if (j && !j.done) followReExtract(j); }
  $('pp-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    $('pp-tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    history.replaceState(null, '', `#/paper/${p.id}?tab=${tab}`);
    b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    drawTab();
  });
  // Khung hẹp: thanh tab cuộn ngang (không hiện thanh cuộn) — lăn chuột cũng cuộn ngang, tab đang mở luôn trong tầm nhìn.
  $('pp-tabs').addEventListener('wheel', (e) => {
    const t = $('pp-tabs');
    if (t.scrollWidth <= t.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    t.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  $('pp-tabs').querySelector('button.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  /* ---------------- các tab ---------------- */

  function annotationsHtml() {
    const list = p.annotations || [];
    return `<div class="card" id="pp-anno-card"><h2>Trích dẫn &amp; nhận xét theo đoạn <span class="hint">(${list.length})</span></h2>
      ${list.map((a) => `<div class="anno" data-aid="${a.id}"><span class="acts"><button class="ghost sm" data-anno-edit="${a.id}">✎</button><button class="ghost sm" data-anno-del="${a.id}">🗑</button></span>
        <div class="q">“${escapeHtml(a.quote)}”${a.page ? ` <span class="badge">tr. ${escapeHtml(a.page)}</span>` : ''}</div>${a.translation ? `<div class="tr"><span class="badge accent">Dịch</span> ${escapeHtml(a.translation)}</div>` : ''}${a.note ? `<div class="n">${mdToHtml(a.note)}</div>` : ''}</div>`).join('') || '<span class="hint">Chưa có. Bôi đen một đoạn trong tab <b>PDF</b> rồi bấm "+ Ghi chú" trên bong bóng dịch, hoặc bôi đen ở tab <b>Nguồn</b> rồi bấm "Ghi chú đoạn đã chọn", hoặc thêm tay bên dưới.</span>'}
      <div class="form-grid" style="margin-top:10px">
        <label class="field full"><span class="label-text">Đoạn trích (nguyên văn)</span><textarea id="pp-anno-quote" rows="2" placeholder="Dán câu/đoạn trong paper…"></textarea></label>
        <label class="field"><span class="label-text">Trang (tuỳ chọn)</span><input type="text" id="pp-anno-page" placeholder="3"></label>
        <label class="field"><span class="label-text">Nhận xét</span><input type="text" id="pp-anno-note" placeholder="Tại sao đoạn này đáng chú ý…"></label>
      </div><div class="row"><button id="pp-anno-add" class="sm primary">Thêm trích dẫn</button></div></div>`;
  }

  function bindAnnotations(scope) {
    const card = scope.querySelector('#pp-anno-card');
    if (!card) return;
    card.querySelector('#pp-anno-add').addEventListener('click', async () => {
      const quote = card.querySelector('#pp-anno-quote').value.trim();
      if (!quote) return toast('Nhập đoạn trích.', 2000, 'err');
      const a = { id: uid('a'), quote, page: card.querySelector('#pp-anno-page').value.trim(), note: card.querySelector('#pp-anno-note').value.trim(), at: new Date().toISOString() };
      await quickSave({ annotations: [...(paperById(p.id).annotations || []), a] });
      drawTab();
    });
    card.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-anno-del]');
      if (del) { await quickSave({ annotations: (paperById(p.id).annotations || []).filter((a) => a.id !== del.dataset.annoDel) }); drawTab(); return; }
      const ed = e.target.closest('[data-anno-edit]');
      if (ed) {
        const a = (p.annotations || []).find((x) => x.id === ed.dataset.annoEdit);
        if (!a) return;
        const ok = await dialog({ title: 'Sửa trích dẫn', body: `<label class="field"><span class="label-text">Đoạn trích</span><textarea id="ae-q" rows="3">${escapeHtml(a.quote)}</textarea></label><label class="field"><span class="label-text">Trang</span><input type="text" id="ae-p" value="${escapeHtml(a.page || '')}"></label><label class="field"><span class="label-text">Nhận xét</span><textarea id="ae-n" rows="3">${escapeHtml(a.note || '')}</textarea></label>`,
          buttons: [{ label: 'Huỷ', value: false }, { label: 'Lưu', value: true, primary: true, onClick: async (body, close) => {
            const next = (paperById(p.id).annotations || []).map((x) => (x.id === a.id ? { ...x, quote: body.querySelector('#ae-q').value.trim(), page: body.querySelector('#ae-p').value.trim(), note: body.querySelector('#ae-n').value.trim() } : x));
            await quickSave({ annotations: next }); close(true); return false;
          } }] });
        if (ok) drawTab();
      }
    });
  }

  // Tên riêng của paper (thành phần, dataset, metric, baseline) để bản dịch AI giữ nguyên và dùng thống nhất.
  const properNames = (ex) => [...new Set([
    ...(ex.key_idea?.components || []).map((c) => c?.name),
    ...(ex.dataset_details || []).map((d) => d?.name), ...(ex.validation?.datasets || []),
    ...(ex.validation?.metrics || []).map((m) => m?.name), ...(ex.validation?.baselines || []), ...(ex.validation?.benchmarks || []),
  ].map((x) => String(x || '').trim()).filter((x) => x && x.length <= 60))];

  // Bản ghi chú đang hiển thị (gốc hoặc đã dịch), dùng cho Copy Markdown.
  let shown = null;
  const langName = (l) => (NOTE_LANGS.find(([k]) => k === l) || [l, l])[1];

  /* Danh sách câu đáng nhớ AI đã tô trong PDF, nhóm theo loại. Bấm số trang để mở PDF đúng trang đó. */
  function insightsHtml() {
    const marks = (p.pdfMarks || []).filter((m) => m.auto && m.text);
    if (!marks.length) return '';
    return `<div class="card insights"><h2>Câu đáng nhớ <span class="hint">(${marks.length}, AI tô trong PDF)</span></h2>
      ${Object.entries(KINDS).map(([k, v]) => {
        const list = marks.filter((m) => m.kind === k);
        return list.length ? `<div class="ins-group"><div class="ins-title"><i class="hl-dot hl-${v.color}"></i>${v.label} <span class="hint">${list.length}</span></div>
          ${list.map((m) => `<div class="ins-item"><a class="badge" href="#/paper/${p.id}?tab=pdf&page=${m.page}" title="Mở PDF ở trang này">tr. ${m.page}</a>
            <div><div class="ins-quote">${escapeHtml(m.text)}</div>${m.why ? `<div class="ins-why">${escapeHtml(m.why)}</div>` : ''}</div></div>`).join('')}</div>` : '';
      }).join('')}</div>`;
  }

  /* Kiểm tra cơ học bản ghi chú: số liệu có trong toàn văn không, có câu nào chung chung không. Chỉ cảnh báo. */
  let sourceCache = null;
  async function drawQuality() {
    const box = $('pp-quality');
    if (!box || p.needsExtraction || !p.meta) { if (box) box.innerHTML = ''; return; }
    const pid = p.id;
    // Đọc lại mỗi lần vẽ: toàn văn có thể vừa được sửa ở tab Nguồn (đọc từ máy chủ nội bộ, rất nhanh).
    try { const tx = await api.getText(pid); sourceCache = { id: pid, text: tx.text || '', kind: tx.kind || p.sourceKind || '' }; } catch (_) { sourceCache = { id: pid, text: '', kind: '' }; }
    // Có PDF mà chưa có toàn văn (PDF từng được gửi thẳng cho model): đọc chữ từ PDF, lưu lại làm toàn văn
    // để lần sau đối chiếu ngay, đồng thời tìm kiếm toàn văn và Chat cũng dùng được.
    if (sourceCache.text.length < 4000 && p.pdfId) {
      box.innerHTML = '<div class="card quality"><div class="quality-body" style="padding-top:10px" id="pp-quality-prog"></div></div>';
      showProgress('pp-quality-prog', 'Đang đọc chữ từ PDF để đối chiếu số liệu…', { expectedMs: 4000 });
      try {
        const pdfText = await pdfFullText(p.pdfId);
        if (pdfText.length > Math.max(4000, sourceCache.text.length * 2)) {
          sourceCache = { id: pid, text: pdfText, kind: 'full text (trích từ PDF)' };
          api.putText(pid, pdfText, sourceCache.kind).then(() => { if (store.textLens) store.textLens[pid] = pdfText.length; }).catch(() => {});
        }
      } catch (_) { /* PDF hỏng hoặc dạng ảnh: giữ nguyên, báo chưa đối chiếu được */ }
    }
    if (!$('pp-quality') || p.id !== pid || tab !== 'notes') return;
    const ex = normalizeExtraction(p.extraction);
    const num = checkNumbers(ex, sourceCache.text, sourceCache.kind);
    const shallow = checkDepth(ex);
    const issues = num.missing.length + shallow.length;
    const coverNote = num.coverage === 'none'
      ? 'Chưa có toàn văn dạng text nên không đối chiếu được số liệu (PDF được gửi thẳng cho model, hoặc PDF dạng ảnh). Có thể dán toàn văn ở tab Nguồn.'
      : (num.coverage === 'abstract' ? 'Nguồn đã lưu chỉ có abstract hoặc rất ngắn, nên nhiều con số lấy từ thân bài sẽ không đối chiếu được.' : '');
    const summary = [
      num.coverage !== 'none' ? (num.missing.length ? `<span class="badge warn">${num.missing.length} con số cần đối chiếu</span>` : `<span class="badge ok">${num.checked} con số khớp toàn văn</span>`) : '<span class="badge">chưa đối chiếu được số liệu</span>',
      shallow.length ? `<span class="badge warn">${shallow.length} câu chung chung</span>` : '<span class="badge ok">không có câu chung chung</span>',
    ].join(' ');
    box.innerHTML = `<details class="card quality" ${issues ? 'open' : ''}>
      <summary><b>Kiểm tra ghi chú</b> ${summary}</summary>
      <div class="quality-body">
        ${coverNote ? `<p class="hint">${coverNote}</p>` : ''}
        ${num.missing.length ? `<h4>Con số không thấy trong toàn văn đã lưu</h4>
          <p class="hint">Có thể model ghi nhầm, tự tính, hoặc con số nằm trong bảng mà bộ bóc text bỏ sót. Nên mở PDF đối chiếu trước khi trích dẫn.</p>
          <ul>${num.missing.map((m) => `<li><span class="q-label">${escapeHtml(m.label)}</span> <b class="q-num">${escapeHtml(m.number)}</b> <span class="hint">${escapeHtml(m.excerpt)}</span></li>`).join('')}</ul>` : ''}
        ${shallow.length ? `<h4>Câu chung chung, chưa mang thông tin</h4>
          <p class="hint">Câu đúng nhưng thay tên phương pháp bằng từ khác vẫn "đúng". Nên sửa tay ở tab Chỉnh sửa hoặc trích xuất lại.</p>
          <ul>${shallow.map((s) => `<li><span class="q-label">${escapeHtml(s.label)}</span> ${escapeHtml(s.text)} <span class="hint">· ${escapeHtml(s.reason)}</span></li>`).join('')}</ul>` : ''}
        ${!issues && !coverNote ? '<p class="hint" style="margin:0">Mọi con số trong ghi chú đều có trong toàn văn đã lưu, và không thấy câu chung chung. Đây là kiểm tra cơ học, không thay cho việc đọc lại.</p>' : ''}
      </div></details>`;
  }

  function drawNotes() {
    const body = $('pp-body');
    const e = p.extraction || {};
    body.innerHTML = `
      <div class="lang-bar">
        <span class="lang-label">Ngôn ngữ ghi chú</span>
        <div class="seg" id="pp-lang">${NOTE_LANGS.map(([k, l]) => `<button data-lang="${k}">${l}</button>`).join('')}</div>
        <span id="pp-lang-info" class="hint"></span>
        <span class="spacer"></span>
        <button id="pp-lang-ai" class="sm" hidden title="Dịch lại toàn bộ ghi chú bằng mô hình đang dùng, sát văn phong học thuật hơn">Dịch lại bằng AI</button>
      </div>
      <div id="pp-quality"></div>
      <div id="pp-redo-bar"></div>
      <div id="pp-oneliner"></div>
      <div class="card venue-card"><div class="row"><h2 style="margin:0">Venue &amp; xếp hạng</h2><span class="spacer"></span><button id="pp-venue-edit" class="sm">Sửa venue</button>${p.venueInfo?.manual ? '<button id="pp-venue-auto" class="sm ghost" title="Bỏ phần sửa tay, nhận diện lại tự động">Tự nhận diện lại</button>' : ''}</div>${venueDetailHtml(p.venueInfo)}</div>
      <div class="sections" id="pp-sections"></div>
      ${insightsHtml()}
      <div class="card notes-box"><h2>Ghi chú cá nhân</h2>
        <textarea id="pp-notes" placeholder="Nhận xét, câu hỏi, ý tưởng khi đọc… (hỗ trợ Markdown đơn giản)">${escapeHtml(p.userNotes || '')}</textarea>
        <div class="row" style="margin-top:8px"><button id="pp-notes-save" class="primary sm">Lưu ghi chú</button><span class="hint">Ctrl+Enter để lưu nhanh</span></div></div>
      <div class="card pp-nb" id="pp-nb"><div class="row" style="align-items:center"><h2 style="margin:0">📓 Trong sổ tay nghiên cứu</h2><span class="spacer"></span><a class="btn-link sm" href="#/notebook?new=paper&paper=${encodeURIComponent(p.id)}">+ Ghi chú mới về bài này</a></div><div id="pp-nb-list" class="hint">Đang tải…</div></div>
      ${annotationsHtml()}
      <div class="card"><h2>Dòng note rút gọn</h2><div class="mono hint" style="user-select:all">${escapeHtml(quickNoteLine(p))}</div></div>`;
    const paint = (ex, lang) => {
      shown = { extraction: ex, lang };
      $('pp-oneliner').innerHTML = ex.one_liner ? `<div class="oneliner">${escapeHtml(ex.one_liner)}</div>` : '';
      $('pp-sections').innerHTML = renderSections(ex, { openFirst: true, paper: p, lang, redo: true });
      $('pp-sections').querySelectorAll('details').forEach((d) => { d.open = true; });
      markRedoBusy();
    };
    /** Mục đang được trích xuất lại (chạy nền): khoá các nút ↻ và hiện thanh tiến độ ở đúng mục đó. */
    function markRedoBusy() {
      const j = getJob(`rexsec:${p.id}`);
      const sec = $('pp-sections');
      if (!j || j.done || !sec) return;
      sec.querySelectorAll('[data-redo]').forEach((x) => { x.disabled = true; });
      const b = sec.querySelector(`[data-redo="${CSS.escape(j.info?.key || '')}"]`);
      const box = b?.closest('details');
      if (!box) return;
      box.classList.add('sec-busy');
      b.insertAdjacentHTML('beforebegin', '<span class="sec-status"></span>');
      const pid = p.id;
      followJob(j, box.querySelector('.sec-status'), { expectedMs: 35000, onDone: (x) => {
        if (p.id !== pid) return;
        if (x.error) toast(x.error, 7000, 'err');
        else { p = x.result.paper; metaRow(); $('pp-title').value = p.title; toast(`Đã trích xuất lại mục ${x.info.label}.`); }
        if (tab === 'notes') redraw();
      } });
    }
    const drawLang = async ({ ai = false } = {}) => {
      const src = sourceLang(e);
      const lang = displayLang(store.settings, e);
      $('pp-lang').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
      const info = $('pp-lang-info');
      const aiBtn = $('pp-lang-ai');
      aiBtn.hidden = true;
      if (lang === src) {
        paint(normalizeExtraction(e), lang);
        info.textContent = 'Bản gốc lúc trích xuất';
        return;
      }
      // Dịch bằng AI chạy nền (vài chục giây): rời trang vẫn dịch tiếp và lưu, mở lại thì thanh tiến độ chạy tiếp.
      const jobKey = `trn:${p.id}:${lang}`;
      const useJob = ai || jobRunning(jobKey);
      const cached = !useJob && await notesIn(p, lang, { cachedOnly: true });
      if (!cached) {
        paint(normalizeExtraction(e), src);
        if (!useJob) showProgress(info, `Đang dịch sang ${langName(lang)}…`, { expectedMs: 5000 });
      }
      try {
        let r = cached;
        if (!r && useJob) {
          const pid = p.id;
          const job = runJob(jobKey, (update) => {
            update(`Đang dịch lại sang ${langName(lang)} bằng AI…`);
            return notesIn(paperById(pid), lang, { translateAI: (texts, from, to) => translateNotesAI({ texts, from, to, settings: store.settings, keep: properNames(e) }) });
          }, { label: `Dịch ghi chú sang ${langName(lang)} bằng AI`, title: p.title, href: `#/paper/${pid}?tab=notes`, here: onPaperTab(pid, 'notes'), expectedMs: () => 30000 });
          followJob(job, info, { expectedMs: 30000 });
          await job.promise;
          if (job.error) throw job.cause || new Error(job.error);
          r = job.result;
        } else if (!r) r = await notesIn(paperById(p.id), lang, {});
        if (!info.isConnected || displayLang(store.settings, e) !== lang || tab !== 'notes') return; // đã rời trang / đổi lựa chọn trong lúc dịch
        paint(r.extraction, lang);
        info.textContent = `Bản dịch ${r.engine === 'AI' ? 'bằng AI' : `tự động (${r.engine || 'Google'})`} từ ${langName(src)}`;
        aiBtn.hidden = !hasCredentials(store.settings);
        aiBtn.textContent = r.engine === 'AI' ? 'Dịch lại bằng AI' : 'Dịch bằng AI cho chính xác hơn';
      } catch (err) {
        if (info.isConnected) info.innerHTML = `<span class="status err">Không dịch được: ${escapeHtml(err.message)}. Đang hiện bản gốc.</span>`;
      }
    };
    $('pp-lang').addEventListener('click', async (ev) => {
      const b = ev.target.closest('button[data-lang]');
      if (!b || b.classList.contains('active')) return;
      await saveSettings({ notesLang: b.dataset.lang });
      drawLang();
    });
    $('pp-lang-ai').addEventListener('click', () => drawLang({ ai: true }));
    drawLang();
    drawQuality();
    // Trích xuất lại riêng một mục: nút ↻ ở tiêu đề mục.
    const redraw = () => { const view = body.closest('.view'); const y = view?.scrollTop || 0; drawTab(); if (view) view.scrollTop = y; };
    if (lastRedo && lastRedo.id === p.id) {
      $('pp-redo-bar').innerHTML = `<div class="redo-bar">Đã trích xuất lại mục <b>${escapeHtml(lastRedo.label)}</b>. Các mục khác giữ nguyên.<span class="spacer"></span><button class="sm" id="pp-redo-undo">Hoàn tác</button><button class="sm ghost" id="pp-redo-close">Đóng</button></div>`;
      $('pp-redo-undo').addEventListener('click', async () => { const r = lastRedo; lastRedo = null; p = await restoreSection(p.id, r.key, r.previous); metaRow(); $('pp-title').value = p.title; redraw(); toast('Đã hoàn tác, mục trở về bản trước.'); });
      $('pp-redo-close').addEventListener('click', () => { lastRedo = null; $('pp-redo-bar').innerHTML = ''; });
    }
    $('pp-sections').addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-redo]');
      if (!btn) return;
      ev.preventDefault(); // nút nằm trong <summary>, không để nó gập mục lại
      if (btn.disabled) return;
      if (!hasCredentials(store.settings)) return toast('Chưa có API key. Mở Cài đặt để nhập key.', 3500, 'err');
      const key = btn.dataset.redo;
      const label = btn.dataset.label;
      const s = store.settings;
      const choice = await dialog({
        title: `Trích xuất lại mục ${label}`, width: 520,
        body: `<p>Mô hình đọc lại paper và chỉ viết lại mục này. Các mục khác, ghi chú cá nhân và trích dẫn theo đoạn được giữ nguyên.</p>
          <label class="field"><span class="label-text">Yêu cầu thêm cho mục này (tuỳ chọn)</span><textarea id="sr-hint" rows="3" placeholder="Ví dụ: ghi rõ từng thành phần của hàm loss, hoặc liệt kê đủ baseline trong Table 2"></textarea></label>
          <p class="hint" style="margin:0">Một lượt gọi ${escapeHtml(s.provider)}/${escapeHtml(s.models?.[s.provider] || '')}. Toàn văn vẫn được gửi đi nên phần đọc vào tốn như một lần trích xuất, phần viết ra thì ít hơn nhiều. Sau khi xong có nút Hoàn tác.</p>`,
        buttons: [{ label: 'Huỷ', value: null }, { label: 'Trích xuất lại mục này', primary: true, onClick: (b, close) => { close({ hint: b.querySelector('#sr-hint').value }); return false; } }],
      });
      if (!choice) return;
      const pid = p.id;
      if (jobRunning(`rexsec:${pid}`)) return;
      const job = runJob(`rexsec:${pid}`, async (update) => {
        const r = await reExtractSection(pid, key, { label, hint: choice.hint, onStatus: (m) => update(m) });
        lastRedo = { id: pid, key, label, previous: r.previous };
        return r;
      }, { label: `Trích xuất lại mục ${label}`, title: p.title, href: `#/paper/${pid}?tab=notes`, here: onPaperTab(pid, 'notes'), expectedMs: () => 35000 });
      job.info = { key, label };
      markRedoBusy();
    });
    const save = async () => { await quickSave({ userNotes: $('pp-notes').value }); toast('Đã lưu ghi chú.'); };
    $('pp-venue-edit').addEventListener('click', editVenue);
    $('pp-venue-auto')?.addEventListener('click', async () => { const next = { ...paperById(p.id) }; delete next.venueInfo; p = await savePaper(next); metaRow(); drawTab(); toast('Đã nhận diện lại venue.'); });
    $('pp-notes-save').addEventListener('click', save);
    $('pp-notes').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) save(); });
    bindAnnotations(body);
    // Các trang sổ tay nhắc tới bài này ([[@id]] hoặc ![[@id]]).
    loadPages().then(() => {
      const box = $('pp-nb-list');
      if (!box) return;
      const hits = pagesForPaper(p.id);
      box.innerHTML = hits.length
        ? hits.map(({ page, snippet }) => `<a class="pp-nb-row" href="#/notebook/${page.id}"><b>${escapeHtml(pageLabel(page))}</b>${snippet ? `<span class="hint">${escapeHtml(snippet)}</span>` : ''}</a>`).join('')
        : 'Chưa trang nào nhắc tới bài này. Trong sổ tay, gõ <code>[[@</code> rồi chọn bài để liên kết.';
      box.classList.toggle('hint', !hits.length);
    }).catch(() => { if ($('pp-nb-list')) $('pp-nb-list').textContent = 'Không tải được sổ tay.'; });
  }

  function drawEdit() {
    draft = structuredClone(p);
    draft.extraction = normalizeExtraction(draft.extraction);
    // Paper trích xuất theo 5 mục cũ chỉ có tên dataset: đưa vào bảng chi tiết để sửa tiếp.
    if (!draft.extraction.dataset_details.length && draft.extraction.validation.datasets.length) {
      draft.extraction.dataset_details = draft.extraction.validation.datasets.map((name) => ({ name, source: '', scale: '', characteristics: '', preprocessing: '' }));
    }
    const d = draft;
    const body = $('pp-body');
    body.innerHTML = `<div class="form-grid">
      <div class="sec-title">Thông tin chung</div>
      ${field(d, 'Link', 'url', 'text', { input: 'input', full: true })}
      ${field(d, 'Tác giả (phẩy)', 'extraction.authors', 'csv', { input: 'input' })}
      ${field(d, 'Venue', 'extraction.venue', 'text', { input: 'input' })}
      ${field(d, 'Năm', 'extraction.year', 'text', { input: 'input' })}
      ${field(d, 'Tags (phẩy)', 'extraction.tags', 'csv', { input: 'input' })}
      ${field(d, 'arXiv ID', 'arxivId', 'text', { input: 'input' })}
      ${field(d, 'DOI', 'doi', 'text', { input: 'input' })}
      ${field(d, 'Tóm tắt một câu', 'extraction.one_liner', 'text', { rows: 2, full: true })}
      ${field(d, 'Code / GitHub', 'extraction.code_url', 'text', { input: 'input' })}
      <div class="sec-title">3 · Problem &amp; Motivation</div>
      ${field(d, 'Nghiên cứu giải quyết bài toán gì', 'extraction.problem', 'text', { rows: 3, full: true })}
      ${field(d, 'Tại sao bài toán này quan trọng', 'extraction.motivation', 'text', { rows: 2, full: true })}
      <div class="sec-title">4 · Research Gap</div>
      ${field(d, 'Hạn chế của các nghiên cứu trước, vấn đề chưa được giải quyết', 'extraction.bottleneck', 'text', { rows: 4, full: true })}
      <div class="sec-title">5 · Research Question / Objective</div>
      ${field(d, 'Mục tiêu chính', 'extraction.objective.goal', 'text', { rows: 2 })}
      ${field(d, 'Giả thuyết nghiên cứu', 'extraction.objective.hypothesis', 'text', { rows: 2 })}
      <div class="sec-title">6 · Method</div>
      ${field(d, 'Ý tưởng cốt lõi', 'extraction.key_idea.summary', 'text', { rows: 3, full: true })}
      ${field(d, 'Các bước chính trong pipeline (mỗi dòng một bước)', 'extraction.key_idea.pipeline', 'lines', { rows: 4, full: true })}
      ${field(d, 'Mô hình / kỹ thuật (mỗi dòng: tên :: loại :: mô tả; loại = architecture/loss/data/training/pipeline/inference/other)', 'extraction.key_idea.components', 'components', { rows: 4, full: true })}
      ${field(d, 'Điểm khác biệt so với existing methods (dùng cho bảng so sánh)', 'extraction.novelty', 'text', { rows: 2, full: true })}
      <div class="sec-title">7 · Contribution</div>
      ${field(d, 'Các đóng góp (mỗi dòng một ý)', 'extraction.contributions', 'lines', { rows: 3, full: true })}
      <div class="sec-title">8 · Dataset</div>
      ${field(d, 'Mỗi dòng: tên | source | scale | đặc điểm | tiền xử lý', 'extraction.dataset_details', 'datasets', { rows: 4, full: true })}
      <div class="sec-title">9 · Experiments</div>
      ${field(d, 'Experimental setup', 'extraction.validation.setup', 'text', { rows: 3, full: true })}
      ${field(d, 'Baselines (phẩy)', 'extraction.validation.baselines', 'csv', { input: 'input' })}
      ${field(d, 'Benchmark (phẩy)', 'extraction.validation.benchmarks', 'csv', { input: 'input' })}
      ${field(d, 'Kết quả số (mỗi dòng: metric | dataset | baseline | đề xuất | Δ)', 'extraction.validation.metrics', 'metrics', { rows: 5, full: true })}
      ${field(d, 'Ablation study', 'extraction.validation.ablation', 'text', { rows: 3, full: true })}
      <div class="sec-title">10 · Findings</div>
      ${field(d, 'Phát hiện chính (mỗi dòng một ý)', 'extraction.validation.findings', 'lines', { rows: 3, full: true })}
      ${field(d, 'Kết quả hỗ trợ contribution', 'extraction.validation.main_results', 'text', { rows: 2 })}
      ${field(d, 'Tóm tắt Dataset/Metric một dòng (bảng so sánh)', 'extraction.dataset_metric_note', 'text', { rows: 2 })}
      <div class="sec-title">11 · Limitations</div>
      ${field(d, 'Các hạn chế (mỗi dòng một ý, hạn chế tự nhận thấy mở đầu bằng "(suy luận)")', 'extraction.limitation.items', 'lines', { rows: 4, full: true })}
      ${field(d, 'Chưa được giải quyết', 'extraction.limitation.unresolved', 'text', { rows: 2 })}
      ${field(d, 'Chi phí tính toán', 'extraction.limitation.compute_cost', 'text', { rows: 2 })}
      <div class="sec-title">12 · Relevance to Our Work</div>
      ${field(d, 'Liên quan đến phần nào của dự án', 'extraction.relevance.project_part', 'text', { rows: 2 })}
      ${field(d, 'Có thể cải thiện / mở rộng ở đâu', 'extraction.relevance.extend_or_improve', 'text', { rows: 2 })}
      ${field(d, 'Có thể kế thừa (mỗi dòng: ý tưởng :: cách áp dụng :: công sức)', 'extraction.applicable_ideas', 'ideas', { rows: 4, full: true })}
      ${field(d, 'Luận điểm có thể trích dẫn paper để hỗ trợ (mỗi dòng một ý)', 'extraction.relevance.citation_claims', 'lines', { rows: 3, full: true })}
      <div class="sec-title">Important Evidence</div>
      ${field(d, 'Mỗi dòng: claim | section / page / table | mục đích trích dẫn', 'extraction.evidence', 'evidence', { rows: 5, full: true })}
      <div class="sec-title">Chuỗi lập luận &amp; lưu ý khi đọc</div>
      ${field(d, 'Chuỗi lập luận (mỗi dòng: vai :: mắt xích :: section; vai = premise/gap/claim/method/evidence/conclusion)', 'extraction.argument_chain', 'chain', { rows: 6, full: true })}
      ${field(d, 'Lưu ý khi đọc (mỗi dòng một ý)', 'extraction.reader_warnings', 'lines', { rows: 3, full: true })}
    </div>
    <div class="sticky-actions"><button id="pp-edit-save" class="primary">Lưu thay đổi</button><span id="pp-edit-status" class="status"></span></div>`;
    $('pp-edit-save').addEventListener('click', async () => {
      for (const node of body.querySelectorAll('[data-path]')) setPath(draft, node.dataset.path, codec[node.dataset.type].in(node.value));
      draft.extraction = normalizeExtraction(draft.extraction);
      p = await savePaper(draft);
      metaRow();
      setStatus('pp-edit-status', 'Đã lưu.', 'ok');
      toast('Đã lưu thay đổi.');
    });
  }

  let marksTimer = null;
  let startPage = Number(query.get('page')) || 0; // mở PDF ở trang này (từ danh sách câu đáng nhớ)

  /* Tô câu đáng nhớ bằng AI: chọn mức, chạy, rồi báo trình đọc nạp lại các nét. */
  async function autoHighlightDialog() {
    if (!hasCredentials(store.settings)) return toast('Chưa có API key. Mở Cài đặt để nhập key.', 3500, 'err');
    const cur = paperById(p.id);
    const autoCount = (cur.pdfMarks || []).filter((m) => m.auto).length;
    const pagesGuess = Math.max(6, Math.round((store.textLens?.[p.id] || 40000) / 4200));
    const choice = await dialog({
      title: 'Tô câu đáng nhớ', width: 560,
      body: `<p>Mô hình đọc toàn văn trong PDF rồi tô những câu đáng nhớ. Mỗi câu thuộc một loại và có một dòng giải thích vì sao đáng nhớ, bấm vào nét tô để xem.</p>
        <div class="hl-legend">${Object.values(KINDS).map((k) => `<span><i class="hl-dot hl-${k.color}"></i><b>${k.label}</b> ${k.desc}</span>`).join('')}</div>
        <label class="field" style="margin-top:12px"><span class="label-text">Mật độ</span>
          <select id="ah-level">${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}" ${k === 'vua' ? 'selected' : ''}>${v.label} · khoảng ${budgetFor(pagesGuess, k)} câu</option>`).join('')}</select>
          <span class="hint">Số câu tính theo số trang nội dung, không tính danh mục tham khảo.</span></label>
        <ul class="hint" style="margin:0 0 0 18px;padding:0">
          <li>Một lượt gọi model (${escapeHtml(modelLabel(store.settings, 'highlight'))}), gửi toàn văn nên tốn token gần bằng một lần trích xuất.</li>
          <li>Câu nào model chép không khớp nguyên văn trong PDF thì bị bỏ, không tô đoán.</li>
          <li>${autoCount ? `<b>${autoCount}</b> câu AI đã tô trước đó sẽ được thay bằng lượt mới.` : 'Nét bạn tự tô và gạch chân được giữ nguyên.'} Tô xong vẫn hoàn tác được bằng ↶.</li>
        </ul>`,
      buttons: [
        { label: 'Huỷ', value: null },
        ...(autoCount ? [{ label: `Xoá ${autoCount} câu AI đã tô`, value: 'clear', danger: true }] : []),
        { label: 'Tô câu đáng nhớ', primary: true, onClick: (b, close) => { close({ level: b.querySelector('#ah-level').value }); return false; } },
      ],
    });
    if (!choice) return;
    const reload = () => $('pp-reader')?.contentWindow?.pvReloadMarks?.();
    if (choice === 'clear') { const n = await clearAutoHighlights(p.id); p = paperById(p.id); reload(); drawAhLegend(); return toast(`Đã xoá ${n} câu AI đã tô.`); }
    const pid = p.id;
    if (jobRunning(`ah:${pid}`)) return;
    runJob(`ah:${pid}`, (update) => autoHighlight(pid, { level: choice.level, onStatus: (m, step) => update(m, { of: 3, ...(step != null ? { step } : {}) }) }),
      { label: 'Tô câu đáng nhớ', title: p.title, href: `#/paper/${pid}?tab=pdf`, here: onPaperTab(pid, 'pdf'), expectedMs: (j) => (j.step === 1 ? 45000 : 4000) });
    followAutoHighlight();
  }

  /** Thanh tiến độ "Tô câu đáng nhớ" dưới thanh trình đọc; mở lại tab PDF giữa chừng thì chạy tiếp đúng chỗ. */
  function followAutoHighlight() {
    const j = getJob(`ah:${p.id}`);
    if (!j || j.done || !$('pp-ah-status')) return;
    if ($('pp-auto-hl')) $('pp-auto-hl').disabled = true;
    $('pp-ah-status').hidden = false;
    followJob(j, $('pp-ah-status'), { expectedMs: (x) => (x.step === 1 ? 45000 : 4000), onDone: (x) => {
      if ($('pp-auto-hl')) $('pp-auto-hl').disabled = false;
      if ($('pp-ah-status')) $('pp-ah-status').hidden = true;
      if (x.error) return toast(x.error, 7000, 'err');
      p = paperById(p.id) || p;
      $('pp-reader')?.contentWindow?.pvReloadMarks?.();
      drawAhLegend();
      const r = x.result;
      toast(`Đã tô ${r.kept} câu đáng nhớ${r.dropped ? ` (bỏ ${r.dropped} câu không khớp nguyên văn)` : ''}. Bấm vào nét tô để xem lý do.`, 7000);
    } });
  }

  /* Chú thích màu của câu AI tô, ngay dưới thanh trình đọc: mỗi loại một màu, kèm số câu. Thu gọn được. */
  function drawAhLegend() {
    const box = $('pp-ah-legend');
    if (!box) return;
    const marks = (paperById(p.id)?.pdfMarks || []).filter((m) => m.auto);
    if (!marks.length) { box.innerHTML = ''; return; }
    let collapsed = false;
    try { collapsed = localStorage.getItem('pv.ahLegend') === '0'; } catch (_) { /* bỏ qua */ }
    const count = (k) => marks.filter((m) => m.kind === k).length;
    box.innerHTML = collapsed
      ? '<div class="ah-legend compact"><button class="linkish" data-ah-legend="1">● Chú thích màu câu AI tô</button></div>'
      : `<div class="ah-legend"><span class="ah-legend-title">Màu câu AI tô:</span>${Object.entries(KINDS).map(([k, v]) => `<span class="ah-chip" title="${escapeHtml(`${v.label}: ${v.desc}`)}"><i class="hl-dot hl-${v.color}"></i>${v.label}<b>${count(k)}</b></span>`).join('')}
        <span class="hint ah-legend-tip">Bấm vào nét tô trên PDF để xem lý do. Nét bạn tự tô không thuộc nhóm nào.</span><span class="spacer"></span><button class="linkish" data-ah-legend="0" title="Thu gọn chú thích">Thu gọn</button></div>`;
    box.querySelector('[data-ah-legend]').addEventListener('click', (e) => {
      try { localStorage.setItem('pv.ahLegend', e.currentTarget.dataset.ahLegend); } catch (_) { /* bỏ qua */ }
      drawAhLegend();
    });
  }

  function drawPdf() {
    const body = $('pp-body');
    if (p.pdfId) {
      const cfg = translateConfig(store.settings);
      body.innerHTML = `<div class="reader-bar">
          <span class="reader-file" title="${escapeHtml(p.pdfName || 'paper.pdf')}">📄 ${escapeHtml(p.pdfName || 'paper.pdf')}</span>
          <span class="reader-tip"></span>
          <span class="spacer"></span>
          <label class="reader-opt" title="Ngôn ngữ đích">Dịch sang <select id="tr-lang">${TRANSLATE_LANGS.map(([k, l]) => `<option value="${k}" ${cfg.targetLang === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="reader-opt" title="Gửi kèm cả câu để từ nhiều nghĩa được dịch đúng ngữ cảnh"><input type="checkbox" id="tr-ctx" ${cfg.useContext ? 'checked' : ''}> Theo ngữ cảnh câu</label>
          <span class="sel-pick"><button id="tr-more" class="sm" aria-haspopup="menu">Tuỳ chọn ▾</button>
            <div id="tr-menu" class="menu right" role="menu" hidden>
              <label class="menu-check"><input type="radio" name="tr-mode" value="button" ${cfg.mode !== 'auto' ? 'checked' : ''}> Hiện nút 文 trước</label>
              <label class="menu-check"><input type="radio" name="tr-mode" value="auto" ${cfg.mode === 'auto' ? 'checked' : ''}> Dịch ngay khi bôi đen</label>
              <hr>
              <label class="menu-check"><input type="radio" name="tr-open" value="hover" ${cfg.openOn !== 'click' ? 'checked' : ''}> Mở khi rê chuột vào 文</label>
              <label class="menu-check"><input type="radio" name="tr-open" value="click" ${cfg.openOn === 'click' ? 'checked' : ''}> Mở khi bấm vào 文</label>
              <hr>
              <label class="menu-check"><input type="checkbox" id="tr-orig" ${cfg.showOriginal ? 'checked' : ''}> Hiện cả đoạn gốc</label>
              <hr>
              <button id="pp-pdf-replace">Thay file PDF…</button>
              <button id="pp-pdf-del" class="danger">Gỡ PDF</button>
            </div></span>
          <button id="pp-auto-hl" class="sm" title="AI đọc paper rồi tô các câu đáng nhớ, mỗi loại một màu, kèm lý do">✦ Tô câu đáng nhớ</button>
          <button id="pp-pdf-save" class="sm primary" hidden title="Lưu nét vẽ, chữ, chữ ký thêm bằng công cụ của PDF.js vào file PDF">Lưu nét vẽ vào PDF</button>
          <button id="pp-pdf-full" class="sm" title="Xem toàn màn hình (Esc để thoát)">Toàn màn hình</button>
          <a class="sm-link" href="${api.pdfUrl(p.pdfId)}" target="_blank" title="Mở file gốc bằng trình xem PDF mặc định">Mở file gốc</a>
        </div>
        <div id="pp-ah-status" class="reader-progress" hidden></div>
        <div id="pp-ah-legend"></div>
        <iframe id="pp-reader" class="pdf-frame reader" src="vendor/pdfjs/web/viewer.html?file=${encodeURIComponent(api.pdfUrl(p.pdfId))}#${startPage ? `page=${startPage}&` : ''}pagemode=none" allowfullscreen></iframe>
        <input type="file" id="pp-pdf-file" accept="application/pdf,.pdf" hidden>`;
      // Cầu nối cho script trong trình đọc (static/js/pdf-reader.js).
      window.pvReader = {
        config: () => translateConfig(store.settings),
        hasAI: () => hasCredentials(store.settings),
        translateAI: ({ text, sentence, targetLang }) => translateText({ text, sentence, targetLang, settings: store.settings, paperTitle: p.title }),
        getMarks: () => paperById(p.id)?.pdfMarks || [],
        toast: (msg) => toast(msg, 1800),
        saveMarks: (marks) => { clearTimeout(marksTimer); marksTimer = setTimeout(() => quickSave({ pdfMarks: marks.map((m) => ({ ...m })) }), 400); },
        onPdfEdited: (dirty) => { const b = $('pp-pdf-save'); if (b) b.hidden = !dirty; },
        saveAnnotation: async ({ quote, translation, sentence, page, note }) => {
          const a = { id: uid('a'), quote, translation: translation || '', page: page ? String(page) : '', note: note || '', at: new Date().toISOString() };
          if (sentence && sentence !== quote) a.context = sentence;
          await quickSave({ annotations: [...(paperById(p.id).annotations || []), a] });
          toast(`Đã lưu đoạn trích${page ? ` (tr. ${page})` : ''} vào phần Trích dẫn của paper.`);
        },
      };
      const saveTr = (patch) => saveSettings({ translate: { ...translateConfig(store.settings), ...patch } });
      $('tr-lang').addEventListener('change', (e) => saveTr({ targetLang: e.target.value }));
      $('tr-ctx').addEventListener('change', (e) => saveTr({ useContext: e.target.checked }));
      $('tr-orig').addEventListener('change', (e) => saveTr({ showOriginal: e.target.checked }));
      body.querySelectorAll('input[name="tr-mode"]').forEach((r) => r.addEventListener('change', async () => { await saveTr({ mode: r.value }); drawPdfTip(); }));
      body.querySelectorAll('input[name="tr-open"]').forEach((r) => r.addEventListener('change', async () => { await saveTr({ openOn: r.value }); drawPdfTip(); }));
      const drawPdfTip = () => {
        const c = translateConfig(store.settings);
        body.querySelector('.reader-tip').innerHTML = c.mode === 'auto' ? 'Bôi đen chữ để dịch ngay' : `Bôi đen chữ rồi ${c.openOn === 'hover' ? 'rê chuột vào' : 'bấm'} <b>文</b> để dịch`;
      };
      drawPdfTip();
      const menu = $('tr-menu');
      $('tr-more').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
      menu.addEventListener('click', (e) => { if (e.target.closest('button')) menu.hidden = true; e.stopPropagation(); });
      document.addEventListener('click', () => { if (menu.isConnected) menu.hidden = true; });
      $('pp-auto-hl').addEventListener('click', () => autoHighlightDialog());
      followAutoHighlight();
      drawAhLegend();
      $('pp-pdf-save').addEventListener('click', async () => {
        const w = $('pp-reader').contentWindow;
        if (!w?.pvSavePdf) return;
        const b = $('pp-pdf-save');
        b.disabled = true;
        b.textContent = 'Đang lưu…';
        try {
          // Mảng byte tạo trong iframe thuộc "realm" khác, instanceof Uint8Array ở trang cha sẽ sai: chép sang mảng mới.
          const bytes = new Uint8Array(await w.pvSavePdf());
          const old = p.pdfId;
          const up = await api.uploadPdf(bytes, p.pdfName || 'paper.pdf');
          await quickSave({ pdfId: up.id, pdfName: up.name });
          if (old) api.deletePdf(old).catch(() => {});
          toast('Đã lưu nét vẽ vào file PDF của paper.');
          drawPdf();
        } catch (err) { b.disabled = false; b.textContent = 'Lưu nét vẽ vào PDF'; toast(`Không lưu được: ${err.message}`, 5000, 'err'); }
      });
      $('pp-pdf-full').addEventListener('click', () => $('pp-reader').requestFullscreen?.().catch(() => toast('Không bật được toàn màn hình.')));
      $('pp-pdf-replace').addEventListener('click', () => $('pp-pdf-file').click());
      $('pp-pdf-file').addEventListener('change', (e) => attachPdf(e.target.files?.[0]));
      $('pp-pdf-del').addEventListener('click', async () => {
        if (!(await confirmDialog('Gỡ file PDF khỏi paper này (file sẽ bị xoá khỏi máy chủ)?', { danger: true, okLabel: 'Gỡ' }))) return;
        await api.deletePdf(p.pdfId).catch(() => {});
        await quickSave({ pdfId: null, pdfName: null });
        drawPdf();
      });
    } else {
      body.innerHTML = `<div class="card pdf-find">
          <div class="row wrap"><h2 style="margin:0">Tìm PDF trên mạng</h2><span class="spacer"></span>
            <button id="pf-auto" class="primary sm" disabled>Tự động tải bản tốt nhất</button><button id="pf-retry" class="sm ghost">Tìm lại</button></div>
          <p class="hint" style="margin:6px 0 10px">Tìm bản PDF công khai qua link và DOI của paper, Semantic Scholar, OpenAlex, arXiv (theo tên), CVF, NeurIPS, PMLR, ACL Anthology. Miễn phí, không tốn token.</p>
          <div id="pf-list">${spinner('Đang tìm…')}</div>
          <div id="pf-status" class="status"></div>
        </div>
        <div class="dropzone" id="pp-drop"><b>Hoặc chọn file PDF từ máy</b>bấm để chọn, hoặc kéo thả file vào đây</div>
        <input type="file" id="pp-pdf-file" accept="application/pdf,.pdf" hidden>`;
      $('pp-drop').addEventListener('click', () => $('pp-pdf-file').click());
      $('pp-pdf-file').addEventListener('change', (e) => attachPdf(e.target.files?.[0]));
      $('pp-drop').addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); $('pp-drop').classList.add('over'); });
      $('pp-drop').addEventListener('dragleave', () => $('pp-drop').classList.remove('over'));
      $('pp-drop').addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); $('pp-drop').classList.remove('over'); attachPdf([...(e.dataTransfer.files || [])][0]); });

      let found = [];
      const shortUrl = (u) => u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 90);
      const search = async () => {
        $('pf-list').innerHTML = spinner('Đang tìm…');
        $('pf-auto').disabled = true;
        setStatus('pf-status', '');
        try {
          const r = await findPdf(paperById(p.id) || p);
          found = r.candidates;
          $('pf-list').innerHTML = `${found.length ? `<div class="pf-items">${found.map((c, k) => `<div class="pf-item">
              <div class="pf-body"><b>${escapeHtml(c.source)}</b>${c.note ? ` <span class="hint">· ${escapeHtml(c.note)}</span>` : ''}<div class="hint mono" title="${escapeHtml(c.url)}">${escapeHtml(shortUrl(c.url))}</div></div>
              <button class="sm" data-dl="${k}">Tải về</button><a class="sm-link" href="${escapeHtml(c.url)}" target="_blank" rel="noopener">Mở</a></div>`).join('')}</div>`
            : '<p class="hint" style="margin:0">Không tìm thấy bản PDF công khai nào. Thử tìm thủ công qua các link dưới đây, tải file về rồi chọn file ở ô bên dưới.</p>'}
            <div class="pf-links hint">Tìm thủ công: ${r.links.map((l) => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`).join(' · ')}</div>
            ${r.errors?.length ? `<div class="hint">Một số nguồn tạm lỗi: ${escapeHtml(r.errors.join(' · ').slice(0, 220))}</div>` : ''}`;
          $('pf-auto').disabled = !found.length;
        } catch (err) {
          $('pf-list').innerHTML = `<span class="status err">${escapeHtml(err.message)}</span>`;
        }
      };
      const done = (r) => { p = r; toast('Đã tải và gắn PDF vào paper.'); metaRow(); drawPdf(); };
      $('pf-list').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-dl]');
        if (!b) return;
        const c = found[Number(b.dataset.dl)];
        b.disabled = true;
        showProgress('pf-status', `Đang tải từ ${c.source}…`, { expectedMs: 8000 });
        try { done(await attachFromUrl(paperById(p.id) || p, c.url)); }
        catch (err) { b.disabled = false; setStatus('pf-status', `${escapeHtml(c.source)}: ${escapeHtml(err.message)} Thử link khác.`, 'err'); }
      });
      $('pf-auto').addEventListener('click', async () => {
        $('pf-auto').disabled = true;
        try { done((await autoAttach(paperById(p.id) || p, { candidates: found, onStatus: (m) => showProgress('pf-status', m, { expectedMs: 12000 }) })).paper); }
        catch (err) { $('pf-auto').disabled = false; setStatus('pf-status', escapeHtml(err.message), 'err'); }
      });
      $('pf-retry').addEventListener('click', search);
      search();
    }
  }
  async function attachPdf(file) {
    if (!file) return;
    try {
      const { pdfBytes, pdfName } = await acceptPdfFile(file);
      const up = await api.uploadPdf(pdfBytes, pdfName);
      await quickSave({ pdfId: up.id, pdfName: up.name });
      toast('Đã đính kèm PDF.');
      drawPdf();
    } catch (e) { toast(e.message, 4000, 'err'); }
  }

  function drawAsk() {
    const body = $('pp-body');
    const qa = p.qa || [];
    const suggestions = [
      'Giải thích key idea bằng ngôn ngữ đơn giản, kèm ví dụ.',
      'Kết quả nào là quan trọng nhất và có đáng tin không?',
      'So với đề tài của tôi, nên mượn phần nào và bỏ phần nào?',
      'Điểm yếu lớn nhất của phương pháp là gì? Có thể khắc phục thế nào?',
      'Viết 3 câu tóm tắt paper này để đưa vào related work.',
    ];
    body.innerHTML = `<div class="row" style="gap:8px;margin-bottom:6px"><span class="lang-label">Ngôn ngữ trả lời</span><select id="pp-ask-lang" style="width:auto" title="Dùng chung với trang Chat với paper">${CHAT_LANGS.map(([k, l]) => `<option value="${k}" ${(store.settings.chatLang || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="hint" style="margin-bottom:8px">Hỏi model về paper này. Ngữ cảnh gồm ghi chú đã trích xuất${p.pdfId && NATIVE_PDF_PROVIDERS.has(settingsFor(store.settings, 'ask').provider) ? ', và file PDF gửi kèm' : ''}, cùng nội dung nguồn đã lưu (nếu có). Lịch sử được lưu cùng paper.</div>
      <div class="chat" id="pp-chat">${qa.map((x, k) => `${qaQuestionHtml(x)}<div class="msg a">${mdToHtml(readableChatMd(x.a))}${qaFoot(k)}</div>`).join('')}</div>
      <div class="suggest-q">${suggestions.map((s) => `<button data-q="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>
      <div class="pp-compose" id="pp-compose">
        <div class="chat-input"><textarea id="pp-q" placeholder="Câu hỏi của bạn… (Enter để gửi, Shift+Enter xuống dòng; dán hoặc kéo thả ảnh, file vào đây)"></textarea><button id="pp-ask" class="primary">Hỏi</button>${qa.length ? '<button id="pp-clear-chat" class="sm ghost">Xoá lịch sử</button>' : ''}</div>
        ${attachRowHtml('pp', 'Hỏi về hình, bảng, ảnh chụp màn hình hoặc một file khác cùng paper này')}
      </div>
      <div id="pp-ask-status" class="status"></div>`;
    const att = createAttachBox({ button: $('pp-attach'), input: $('pp-file'), chips: $('pp-att'), textarea: $('pp-q'), dropZone: $('pp-compose') });
    // "Xoá lịch sử" xuống hàng đính kèm (bên phải) để ô hỏi rộng hơn, nhất là khi chia đôi màn hình.
    { const cb = $('pp-clear-chat'); if (cb) { cb.classList.add('pp-clear'); $('pp-att').parentElement.appendChild(cb); } }
    const ask = async (q) => {
      q = (q || '').trim();
      if (att.busy()) return toast('Đang xử lý tệp đính kèm, chờ một chút rồi hỏi.', 2500);
      const items = att.items.slice();
      if (!q && items.length) q = `Giải thích ${items.some((a) => a.kind === 'image') ? 'ảnh' : 'file'} đính kèm và liên hệ với paper này.`;
      if (!q) return;
      if (!hasCredentials(store.settings, 'ask')) return setStatus('pp-ask-status', 'Chưa có API key. <a href="#/settings">Mở Cài đặt</a>.', 'err');
      setStatus('pp-ask-status', '');
      const pid = p.id;
      if (jobRunning(`ask:${pid}`)) return toast('Đang trả lời câu hỏi trước, chờ một chút.');
      // Lưu cùng lịch sử: ảnh (đường dẫn) và tên file; nội dung file chỉ gửi cho model, không lưu vào paper.
      const shown = {
        ...(items.some((a) => a.kind === 'image') ? { images: items.filter((a) => a.kind === 'image').map(({ url, name, mime }) => ({ url, name, mime })) } : {}),
        ...(items.some((a) => a.kind !== 'image') ? { files: items.filter((a) => a.kind !== 'image').map(({ kind, name, chars, clipped }) => ({ kind, name, chars, clipped })) } : {}),
      };
      att.clear();
      // Chạy nền: rời trang vẫn trả lời tiếp và lưu vào lịch sử hỏi đáp của paper.
      const job = runJob(`ask:${pid}`, async (update) => {
        update('Đang suy nghĩ…');
        const cur = paperById(pid);
        const history = (cur.qa || []).flatMap((x) => [{ role: 'user', content: x.q }, { role: 'assistant', content: x.a }]).slice(-8);
        const text = (await api.getText(pid)).text || '';
        let pdfBase64 = null;
        if (cur.pdfId && NATIVE_PDF_PROVIDERS.has(settingsFor(store.settings, 'ask').provider) && store.settings.pdfMode !== 'text' && text.length < 2000) {
          pdfBase64 = (await api.pdfBase64(cur.pdfId)).base64;
        }
        if (items.length) update('Đang đọc tệp đính kèm…');
        const { images, textPrefix } = await attachmentParts(items);
        const a = await askPaper({ paper: cur, text, settings: store.settings, question: `${textPrefix}${q}`, history, pdfBase64, images });
        const next = [...(paperById(pid).qa || []), { q, a, at: new Date().toISOString(), ...shown }].slice(-30);
        await savePaper({ ...paperById(pid), qa: next });
        return a;
      }, { label: 'Hỏi đáp về paper', title: p.title, href: `#/paper/${pid}?tab=ask`, here: onPaperTab(pid, 'ask'), expectedMs: () => 20000 });
      job.info = { q, ...shown };
      $('pp-q').value = '';
      followAsk(job);
    };
    /** Câu hỏi đang chờ trả lời: bong bóng câu hỏi + thanh tiến độ ở chỗ câu trả lời. */
    const followAsk = (job) => {
      const chat = $('pp-chat');
      chat.insertAdjacentHTML('beforeend', `${qaQuestionHtml(job.info)}<div class="msg a"></div>`);
      const node = chat.lastElementChild;
      $('pp-ask').disabled = true;
      node.scrollIntoView({ block: 'end' });
      followJob(job, node, { expectedMs: 20000, onDone: (j) => {
        if ($('pp-ask')) $('pp-ask').disabled = false;
        p = paperById(p.id) || p;
        node.innerHTML = j.error ? `<span class="status err">${escapeHtml(j.error)}</span>` : `${mdToHtml(readableChatMd(j.result))}${qaFoot((p.qa || []).length - 1)}`;
      } });
    };
    { const j = getJob(`ask:${p.id}`); if (j && !j.done) followAsk(j); }
    $('pp-ask-lang').addEventListener('change', async (ev) => { await saveSettings({ chatLang: ev.target.value }); toast('Đã đổi ngôn ngữ trả lời, áp dụng từ câu hỏi tới.'); });
    $('pp-ask').addEventListener('click', () => ask($('pp-q').value));
    $('pp-q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask($('pp-q').value); } });
    body.querySelector('.suggest-q').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) ask(b.dataset.q); });
    $('pp-clear-chat')?.addEventListener('click', async () => { p = await savePaper({ ...paperById(p.id), qa: [] }); drawAsk(); });
    $('pp-chat').addEventListener('click', async (e) => {
      const img = e.target.closest('.msg-imgs img[data-zoom]');
      if (img) return zoomImage(img);
      const sv = e.target.closest('[data-qa-save]');
      const cp = e.target.closest('[data-qa-copy]');
      const x = (paperById(p.id)?.qa || [])[Number((sv || cp)?.dataset.qaSave ?? (sv || cp)?.dataset.qaCopy)];
      if (!x) return;
      if (cp) { await copyText(x.a); toast('Đã copy.'); return; }
      saveAnswerToNotebook({ question: x.q, answer: x.a, paperIds: [p.id], labels: new Map([['P1', p.id]]), from: 'Hỏi đáp' });
    });
  }
  function qaQuestionHtml(x) {
    return `<div class="msg q">${msgImgsHtml(x.images)}${msgFilesHtml(x.files)}${escapeHtml(x.q)}</div>`;
  }
  function qaFoot(k) {
    return `<div class="msg-foot"><span class="spacer"></span><button type="button" class="ghost sm" data-qa-save="${k}" title="Chép câu trả lời này vào nhật ký hôm nay, một trang có sẵn hoặc trang mới">📓 Lưu vào Sổ tay</button><button type="button" class="ghost sm" data-qa-copy="${k}">Copy</button></div>`;
  }

  /* Bài giảng: tám mục đưa người đọc từ kiến thức nền tới chỗ hiểu cơ chế của bài. Dựng chạy nền, rời tab vẫn chạy tiếp. */
  function drawLecture() {
    const body = $('pp-body');
    const pid = p.id;
    const job = lectureJob(pid);
    const running = job && !job.done;
    const lec = running ? { sections: job.sections, lang: store.settings.language === 'en' ? 'en' : 'vi' } : p.lecture;
    const s = store.settings;
    const modelName = `${escapeHtml(s.provider)}/${escapeHtml(s.models?.[s.provider] || '')}`;
    const follow = () => {
      const fn = (j) => {
        if (tab !== 'lecture' || p.id !== pid || !$('pp-lecture')) { j.listeners.delete(fn); return; }
        if (j.done) { j.listeners.delete(fn); p = paperById(pid) || p; if (j.error) toast(j.error, 8000, 'err'); drawLecture(); return; }
        const st = $('pp-lec-status');
        if (st) showProgress(st, j.status, jobProgressOpts(j, 40000));
        const host = $('pp-lec-body');
        if (host && host.dataset.n !== String(Object.keys(j.sections).length)) {
          host.dataset.n = String(Object.keys(j.sections).length);
          host.innerHTML = lectureHtml({ sections: j.sections, lang: lec.lang }, { pending: SECTION_ORDER });
        }
      };
      lectureJob(pid).listeners.add(fn);
    };
    const start = async (again) => {
      if (!hasCredentials(store.settings)) return toast('Chưa có API key. Mở Cài đặt để nhập key.', 3500, 'err');
      if (again && !(await confirmDialog('Dựng lại bài giảng? Bản hiện tại sẽ được thay bằng bản mới khi dựng xong.', { okLabel: 'Dựng lại' }))) return;
      trackLecture(pid);
      drawLecture();
    };

    if (!lec) {
      body.innerHTML = `<div id="pp-lecture" class="lec-wrap"><div class="card lec-intro">
        <h2>Bài giảng</h2>
        <p>Ghi chú trích xuất trả lời câu hỏi bài này làm gì. Bài giảng trả lời câu hỏi khác: vì sao nó phải làm như vậy, và nó chạy ra sao. Mô hình đọc toàn văn rồi viết tám mục theo thứ tự cố định, dành cho người chưa làm đúng nhánh hẹp này.</p>
        <ol class="lec-outline">${SECTION_ORDER.map((n) => `<li>${escapeHtml(sectionTitle(n, 'vi'))}</li>`).join('')}</ol>
        <ul class="hint" style="margin:0 0 12px 18px;padding:0">
          <li>Cần toàn văn của paper (file PDF có lớp chữ, hoặc text ở tab Nguồn). Chỉ có abstract thì không đủ.</li>
          <li>Bốn lượt gọi ${modelName}, thêm tối đa hai lượt viết lại chỗ còn nông. Toàn văn được gửi ở mỗi lượt, với Claude thì từ lượt thứ hai chỉ tính giá đọc cache.</li>
          <li>Mục đối chiếu dùng câu trích dẫn nguyên văn từ Semantic Scholar, không tốn token để đọc từng bài được dẫn.</li>
          <li>Viết xong app soát số liệu so với toàn văn và đánh dấu câu còn nông ngay dưới từng mục.</li>
        </ul>
        <div class="row"><button id="pp-lec-build" class="primary">Dựng bài giảng</button><span class="hint">Mất khoảng 2 đến 5 phút. Có thể sang tab khác trong lúc chờ.</span></div></div></div>`;
      $('pp-lec-build').addEventListener('click', () => start(false));
      return;
    }

    const nWarn = (lec.warns || []).length;
    body.innerHTML = `<div id="pp-lecture" class="lec-wrap">
      <div class="lec-bar">
        ${running ? '<span id="pp-lec-status" class="status lec-prog"></span>' : `<span class="hint">${escapeHtml(lec.provider || '')}/${escapeHtml(lec.model || '')} · ${fmtDate(lec.at)}${lec.secs ? ` · ${lec.secs} giây` : ''}${lec.refs?.length ? ` · đối chiếu với ${lec.refs.length} bài được dẫn` : ' · không lấy được câu trích dẫn'}</span>
          ${nWarn ? `<span class="badge warn" title="Xem chi tiết ở cuối từng mục">${nWarn} chỗ cần xem lại</span>` : '<span class="badge ok">không có cảnh báo</span>'}`}
        <span class="spacer"></span>
        ${running ? '' : '<button id="pp-lec-copy" class="sm">Copy Markdown</button><button id="pp-lec-dl" class="sm">Tải .md</button><button id="pp-lec-again" class="sm">Dựng lại</button><button id="pp-lec-del" class="sm ghost">Xoá</button>'}
      </div>
      ${running ? '' : `<div class="lang-bar">
        <span class="lang-label">Ngôn ngữ bài giảng</span>
        <div class="seg" id="pp-lec-lang">${NOTE_LANGS.map(([k, l]) => `<button data-lang="${k}">${l}</button>`).join('')}</div>
        <span id="pp-lec-lang-info" class="hint"></span>
        <span class="spacer"></span>
        <button id="pp-lec-lang-ai" class="sm" hidden title="Dịch lại toàn bộ bài giảng bằng mô hình đang dùng, sát văn phong học thuật hơn">Dịch lại bằng AI</button>
      </div>`}
      <div class="lec-toc" id="pp-lec-toc"></div>
      <div id="pp-lec-body" data-n="${Object.keys(lec.sections || {}).length}">${lectureHtml(lec, { pending: running ? SECTION_ORDER : [] })}</div>
      ${!running && lec.refs?.length ? `<details class="card lec-refs"><summary>Các bài được dẫn dùng cho phần đối chiếu (${lec.refs.length})</summary><ul>${lec.refs.map((r) => `<li>${escapeHtml(r.title)}${r.year ? ` (${escapeHtml(String(r.year))})` : ''}${r.influential ? ' <span class="badge accent">ảnh hưởng lớn</span>' : ''}</li>`).join('')}</ul></details>` : ''}
    </div>`;
    body.querySelector('.lec-toc').addEventListener('click', (e) => { const b = e.target.closest('[data-sec]'); if (b) document.getElementById(`lec-${b.dataset.sec}`)?.scrollIntoView({ block: 'start' }); });
    const tocHtml = (lang) => SECTION_ORDER.map((n, i) => `<button class="linkish" data-sec="${n}">${i + 1}. ${escapeHtml(sectionTitle(n, lang))}</button>`).join('');
    $('pp-lec-toc').innerHTML = tocHtml(lec.lang);
    if (running) { showProgress('pp-lec-status', job.status, jobProgressOpts(job, 40000)); follow(); return; }
    // Bản đang hiển thị (gốc hoặc đã dịch), dùng cho Copy Markdown và Tải .md.
    let shownLec = p.lecture;
    const paintLec = (l) => { shownLec = l; $('pp-lec-toc').innerHTML = tocHtml(l.lang); $('pp-lec-body').innerHTML = lectureHtml(l); };
    // Dịch bằng AI theo từng nhóm khoảng 6000 ký tự để không chạm trần đầu ra của một lượt gọi.
    const translateChunks = async (texts, from, to, update) => {
      const keep = properNames(p.extraction || {});
      const out = [];
      for (let i = 0; i < texts.length;) {
        let j = i;
        let size = 0;
        while (j < texts.length && (j === i || size + texts[j].length <= 6000)) { size += texts[j].length; j += 1; }
        update('Đang dịch lại bằng AI…', { pct: (i / texts.length) * 100 });
        out.push(...await translateNotesAI({ texts: texts.slice(i, j), from, to, settings: store.settings, keep }));
        i = j;
      }
      return out;
    };
    const drawLecLang = async ({ ai = false } = {}) => {
      const src = p.lecture.lang || 'vi';
      const want = store.settings.notesLang;
      const lang = want === 'vi' || want === 'en' ? want : src;
      $('pp-lec-lang').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
      const info = $('pp-lec-lang-info');
      const aiBtn = $('pp-lec-lang-ai');
      aiBtn.hidden = true;
      if (lang === src) { paintLec(p.lecture); info.textContent = 'Bản gốc lúc dựng'; return; }
      // Dịch bằng AI chạy nền như dịch ghi chú.
      const jobKey = `trl:${pid}:${lang}`;
      const useJob = ai || jobRunning(jobKey);
      const cached = !useJob && await lectureIn(p, lang, { cachedOnly: true });
      if (!cached) { paintLec(p.lecture); if (!useJob) showProgress(info, `Đang dịch sang ${langName(lang)}…`, { expectedMs: 5000 }); }
      try {
        let r = cached;
        if (!r && useJob) {
          const job = runJob(jobKey, (update) => {
            update('Đang dịch lại bằng AI…', { pct: 0 });
            return lectureIn(paperById(pid), lang, { translateAI: (texts, from, to) => translateChunks(texts, from, to, update) });
          }, { label: `Dịch bài giảng sang ${langName(lang)} bằng AI`, title: p.title, href: `#/paper/${pid}?tab=lecture`, here: onPaperTab(pid, 'lecture'), expectedMs: () => 40000 });
          followJob(job, info, { expectedMs: 40000 });
          await job.promise;
          if (job.error) throw job.cause || new Error(job.error);
          r = job.result;
        } else if (!r) r = await lectureIn(paperById(pid), lang, {});
        p = paperById(pid) || p;
        const now = store.settings.notesLang;
        if (!info.isConnected || (now === 'vi' || now === 'en' ? now : src) !== lang || tab !== 'lecture' || !$('pp-lec-body')) return; // đã rời trang / đổi lựa chọn trong lúc dịch
        paintLec(r.lecture);
        info.textContent = `Bản dịch ${r.engine === 'AI' ? 'bằng AI' : `tự động (${r.engine || 'Google'})`} từ ${langName(src)}`;
        aiBtn.hidden = !hasCredentials(store.settings);
        aiBtn.textContent = r.engine === 'AI' ? 'Dịch lại bằng AI' : 'Dịch bằng AI cho chính xác hơn';
      } catch (err) {
        if (info.isConnected) info.innerHTML = `<span class="status err">Không dịch được: ${escapeHtml(err.message)}. Đang hiện bản gốc.</span>`;
      }
    };
    $('pp-lec-lang').addEventListener('click', async (ev) => {
      const b = ev.target.closest('button[data-lang]');
      if (!b || b.classList.contains('active')) return;
      await saveSettings({ notesLang: b.dataset.lang });
      drawLecLang();
    });
    $('pp-lec-lang-ai').addEventListener('click', () => drawLecLang({ ai: true }));
    drawLecLang();
    const fileName = `${(p.title || 'bai-giang').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80)} - bai giang.md`;
    $('pp-lec-copy').addEventListener('click', async () => { await copyText(lectureMarkdown(p, shownLec)); toast(`Đã copy bài giảng dạng Markdown (${langName(shownLec.lang || 'vi')}).`); });
    $('pp-lec-dl').addEventListener('click', () => download(fileName, lectureMarkdown(p, shownLec), 'text/markdown;charset=utf-8'));
    $('pp-lec-again').addEventListener('click', () => start(true));
    $('pp-lec-del').addEventListener('click', async () => {
      if (!(await confirmDialog('Xoá bài giảng của paper này?', { danger: true, okLabel: 'Xoá' }))) return;
      p = await removeLecture(pid);
      drawLecture();
    });
  }

  function drawRelated() {
    const body = $('pp-body');
    const local = localRelated(p);
    const ident = s2Ident(p);
    const rm = p.researchMap;
    const rmJob = researchJob(p.id);
    const rmCard = ident ? `<div class="card rm-quick" id="pp-rm-quick"><div class="row wrap" style="align-items:center"><h2 style="margin:0">🧭 Hướng nghiên cứu</h2>
        <span class="hint">${rmJob && !rmJob.done ? 'Đang tạo…' : rm ? `${(rm.data?.gaps || []).length} vấn đề còn bỏ ngỏ · ${(rm.data?.directions || []).length} hướng gợi ý · ${escapeHtml(fmtRelative(rm.at))}` : 'So sánh bài này với các bài nó dẫn và bài dẫn nó, chỉ ra phần còn bỏ ngỏ và hướng làm tiếp'}</span>
        <span class="spacer"></span><button class="sm ${rm ? '' : 'primary'}" id="pp-go-research">${rm ? 'Mở' : 'Tạo'} Hướng nghiên cứu →</button></div>
        ${rm && (rm.data?.directions || []).length ? `<ol class="rm-quick-list">${rm.data.directions.slice(0, 5).map((x, i) => `<li><button type="button" class="linkish rm-quick-go" data-go-dir="${i}" title="Mở hướng này trong tab Hướng nghiên cứu">${escapeHtml(x.title)}</button></li>`).join('')}</ol>` : ''}</div>` : '';
    body.innerHTML = `<div class="related-stack">
      <nav class="rel-nav" aria-label="Các phần của tab Liên quan">${ident ? '<button type="button" data-rel-go="pp-s2-card">Khám phá qua Semantic Scholar</button><button type="button" data-rel-go="pp-wn">Có gì mới kể từ bài này</button>' : ''}<button type="button" data-rel-go="pp-local">Trong thư viện <span class="hint">${local.length}</span></button>${ident ? '<button type="button" data-rel-go="pp-rm-quick">🧭 Hướng nghiên cứu</button>' : ''}</nav>
      <div class="card" id="pp-s2-card"><div class="row" style="align-items:center"><h2 style="margin:0">Khám phá qua Semantic Scholar</h2><span class="spacer"></span>
        ${ident ? '<button id="pp-research" class="sm" title="So sánh, phần còn bỏ ngỏ và hướng nghiên cứu tiếp (tab Hướng nghiên cứu)">🧭 Hướng nghiên cứu</button><button id="pp-litmap" class="sm" title="Bản đồ tài liệu 2D: cụm bài tương đồng, dòng thời gian theo trích dẫn, mở rộng từ nhiều bài gốc">🗺 Bản đồ tài liệu</button><button id="pp-graph3d" class="sm" title="Đồ thị 3D: bài này, các bài nó dẫn, các bài dẫn nó, và liên kết giữa chúng">🕸 Đồ thị 3D</button>' : ''}
        ${ident ? `<span class="sel-pick"><button id="pp-follow" class="sm" aria-haspopup="menu" title="Tự báo bài mới trong trang Theo dõi paper mới">🔔 Theo dõi ▾</button>
          <div id="pp-follow-menu" class="menu right" role="menu" hidden>
            <label class="menu-check"><input type="checkbox" id="pp-follow-cites"> Bài mới dẫn bài này</label>
            <button id="pp-follow-authors">Bài mới của tác giả…</button>
            <hr><a href="#/feed" class="menu-link">Mở trang Theo dõi paper mới</a>
          </div></span>` : ''}</div>
        ${ident ? `<div class="seg" id="pp-s2-kind"><button data-k="recommend" class="active">Gợi ý</button><button data-k="references" title="Paper này dẫn những bài nào và nói gì về chúng">Tài liệu tham khảo</button><button data-k="citations" title="Những paper khác dẫn bài này và nói gì về nó">Paper dẫn bài này</button></div>
        <div class="s2-tools">
          <select id="s2-range" title="Chỉ hiện bài đăng trong khoảng thời gian này"><option value="0">Mọi thời gian</option><option value="6">6 tháng gần đây</option><option value="12">1 năm gần đây</option><option value="24">2 năm gần đây</option></select>
          <select id="s2-sort"><option value="default">Thứ tự mặc định</option><option value="new">Mới nhất</option><option value="cites">Nhiều trích dẫn nhất</option><option value="hot" title="Số trích dẫn chia số tháng từ lúc đăng">Đang được chú ý</option></select>
          <label class="row" style="gap:6px"><input type="checkbox" id="s2-hide"> Ẩn bài đã có hoặc đã xem</label>
          <span class="spacer"></span><span id="s2-count" class="hint"></span>
        </div>
        <div class="s2-stamp-row"><span id="s2-stamp" class="hint"></span><button id="s2-refresh" class="sm ghost" title="Lấy kết quả mới nhất từ Semantic Scholar cho tab đang xem. Kết quả được lưu lại, lần sau mở paper không phải tải lại.">↻ Làm mới</button>
          <span class="spacer"></span><label class="s2-auto hint" title="Khi mở paper, kết quả đã lưu cũ hơn số ngày này sẽ tự được lấy mới. Để trống hoặc 0 thì chỉ làm mới khi bấm nút. Áp dụng cho mọi paper.">Tự làm mới sau <input type="number" id="s2-auto-days" min="0" max="365" step="1" placeholder="—" value="${Number(store.settings.s2AutoRefreshDays) > 0 ? Number(store.settings.s2AutoRefreshDays) : ''}"> ngày</label></div>
        <div id="s2-roles"></div>
        <div id="pp-s2" style="margin-top:8px"></div>` : '<span class="hint">Paper chưa có arXiv ID / DOI / link nên không tra cứu được.</span>'}
      </div>
      ${ident ? '<div class="card wn-card" id="pp-wn"></div>' : ''}
      <div class="card" id="pp-local"><h2>Trong thư viện của bạn (cùng tag / dataset / chủ đề)</h2>
        ${local.length ? local.map(({ x }) => `<div class="paper" data-id="${x.id}"><div class="body"><div class="t">${escapeHtml(x.title)}</div><div class="meta">${topicBadge(topicOf(x))}${(x.extraction?.tags || []).slice(0, 4).map((t) => `<span class="badge accent">#${escapeHtml(t)}</span>`).join('')}</div><div class="line"><b>Điểm mới:</b> ${escapeHtml(x.extraction?.novelty || '—')}</div></div></div>`).join('') : '<span class="hint">Chưa tìm thấy paper liên quan trong thư viện.</span>'}
      </div>
      ${rmCard}</div>`;
    $('pp-local').addEventListener('click', (e) => { const c = e.target.closest('.paper[data-id]'); if (c) location.hash = `#/paper/${c.dataset.id}`; });
    body.querySelector('.rel-nav')?.addEventListener('click', (e) => { const b = e.target.closest('[data-rel-go]'); if (b) document.getElementById(b.dataset.relGo)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    if (!ident) return;

    // Lựa chọn lọc được nhớ giữa các lần mở (chỉ trên máy này).
    const PREF_KEY = 'pv.s2prefs';
    const prefs = { range: 0, sort: 'default', hideSeen: false, onlyCtx: false, role: 'all' };
    try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (_) { /* bộ nhớ trình duyệt bị chặn */ }
    const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (_) { /* bỏ qua */ } };
    $('s2-range').value = String(prefs.range);
    $('s2-sort').value = prefs.sort;
    $('s2-hide').checked = !!prefs.hideSeen;

    // "Đã xem" dùng chung với trang Theo dõi paper mới (khoá theo arXiv ID, bài không có arXiv thì theo mã Semantic Scholar).
    let seenMap = {};
    const seenReady = api.kvGet('seenArxiv').then((x) => { seenMap = x || {}; }).catch(() => {});
    const isSeen = (it) => !!seenMap[s2Key(it)];
    const inLibrary = (it) => { const ext = it.externalIds || {}; return !!store.papers.find((p) => (ext.ArXiv && p.arxivId && p.arxivId.replace(/v\d+$/, '') === ext.ArXiv) || (it.paperId && p.s2Id === it.paperId)); };

    const data = {}; // kind -> { items, meta }
    let kind = 'recommend';
    let tlPicks = []; // các kỳ đang lọc từ dòng thời gian (gộp lại): [{ s, e, label }]
    let loadSeq = 0; // chỉ nhận kết quả của lượt bấm mới nhất (lượt cũ về muộn không được ghi đè)

    const draw = () => {
      const box = $('pp-s2');
      const d = data[kind];
      if (!box || !d) return;
      // Vẽ lại cả khung làm chiều cao đổi tạm thời; giữ vị trí cuộn để trang không nhảy khi bấm lọc.
      const view = box.closest('.view');
      const keepY = view ? view.scrollTop : 0;
      const keepMin = box.offsetHeight;
      box.style.minHeight = `${keepMin}px`;
      requestAnimationFrame(() => { box.style.minHeight = ''; if (view && Math.abs(view.scrollTop - keepY) > 2) view.scrollTop = keepY; });
      const edges = kind !== 'recommend';
      let list = d.items.map((it) => ({ it, role: edges ? citeRole(it) : null }));
      // Đếm theo vai trên toàn bộ danh sách đã lọc thời gian, để con số trên nút lọc không đổi khi chọn vai.
      if (prefs.range) { const from = Date.now() - prefs.range * 30.4 * 864e5; list = list.filter((x) => pubTime(x.it) >= from); }
      if (prefs.hideSeen) list = list.filter((x) => !isSeen(x.it) && !inLibrary(x.it));
      if (edges && prefs.onlyCtx) list = list.filter((x) => x.it._influential || x.it._contexts?.length);
      if (kind === 'citations' && tlPicks.length) list = list.filter((x) => { const t = timelineTime(x.it); return tlPicks.some((k) => t >= k.s && t < k.e); });
      const counts = { all: list.length, method: 0, result: 0, mention: 0, unknown: 0 };
      for (const x of list) if (x.role) counts[x.role.role] += 1;
      if (edges && prefs.role !== 'all') list = list.filter((x) => x.role.role === prefs.role);
      const by = { new: (x) => -pubTime(x.it), cites: (x) => -(x.it.citationCount || 0), hot: (x) => -citeVelocity(x.it) }[prefs.sort];
      if (by) list = list.slice().sort((a, b) => by(a) - by(b));

      $('s2-roles').innerHTML = edges ? `<div class="role-bar">${['all', 'method', 'result', 'mention', 'unknown'].filter((r) => r === 'all' || counts[r]).map((r) => `<button class="role-chip ${r !== 'all' ? `role-${r}` : ''} ${prefs.role === r ? 'active' : ''}" data-role="${r}" title="${escapeHtml(r === 'all' ? '' : ROLE_HINTS[kind][r])}">${r === 'all' ? 'Tất cả' : ROLE_LABELS[kind][r]} <b>${counts[r]}</b></button>`).join('')}</div>` : '';
      $('s2-count').textContent = `${list.length}/${d.items.length} bài`;
      box.innerHTML = edges ? `${kind === 'citations' ? timelineHtml(d.items, (it) => citeRole(it).role, { capped: d.meta.total >= 100, selected: tlPicks.map((k) => k.s) }) : ''}<div class="ctx-head">
          <span>${kind === 'references'
            ? `<b>${d.meta.total}</b> tài liệu tham khảo · <b>${d.meta.withContext}</b> có câu trích dẫn · <b>${d.meta.influential}</b> ảnh hưởng lớn`
            : `<b>${d.meta.total}</b> paper dẫn bài này${d.meta.total >= 100 ? ' (100 bài đầu)' : ''} · <b>${d.meta.withContext}</b> có câu trích dẫn · <b>${d.meta.influential}</b> ảnh hưởng lớn`}</span>
          <span class="spacer"></span>
          <label class="row" style="gap:6px"><input type="checkbox" id="pp-ctx-only" ${prefs.onlyCtx ? 'checked' : ''}> Chỉ bài có câu trích dẫn</label></div>
        <p class="hint" style="margin:0 0 8px">${kind === 'references'
          ? 'Phần trích trong khung là nguyên văn câu tác giả viết khi dẫn bài đó, cho biết paper này lấy gì từ nó.'
          : 'Phần trích trong khung là nguyên văn câu các paper khác viết khi dẫn paper này.'} Nhãn phân loại dựa vào câu trích dẫn nên đôi khi sai, rê chuột vào nhãn để xem lý do.${d.meta.stale ? ' Semantic Scholar đang giới hạn tốc độ, đây là bản đã lưu trước đó.' : ''}</p>
        <div id="pp-ctx-list"></div>` : '<div id="pp-ctx-list"></div>';
      bindTimeline(box, (pick) => {
        if (!pick) tlPicks = [];
        else if (pick.drop || tlPicks.some((k) => k.s === pick.s)) tlPicks = tlPicks.filter((k) => k.s !== pick.s);
        else tlPicks = [...tlPicks, pick].sort((a, b) => a.s - b.s);
        draw();
      });
      const host = $('pp-ctx-list');
      if (!list.length) host.innerHTML = `<span class="hint">${d.items.length ? 'Không có bài nào khớp bộ lọc.' : 'Không có kết quả.'}</span>`;
      for (const x of list) {
        host.appendChild(s2Item(x.it, {
          kind, role: x.role, seen: isSeen(x.it), showVelocity: prefs.sort === 'hot',
          onAdd: (q) => { location.hash = `#/add?q=${encodeURIComponent(q)}`; },
          onSeen: async (it, on) => { if (on) seenMap[s2Key(it)] = new Date().toISOString(); else delete seenMap[s2Key(it)]; draw(); await api.kvSet('seenArxiv', seenMap); },
          cmp: compareState(paperById(p.id), x.it),
          // Bài đã có trong bảng so sánh: mở tab Hướng nghiên cứu; còn lại: chọn / bỏ chọn để so sánh.
          onCompare: async (it, st, go) => { if (go) { goTab('research'); return; } await togglePin(p.id, it, { references: 'ref', citations: 'cit' }[kind] || 'rec'); p = paperById(p.id) || p; draw(); },
        }));
      }
      $('pp-ctx-only')?.addEventListener('change', (e) => { prefs.onlyCtx = e.target.checked; savePrefs(); draw(); });
    };
    const autoDays = () => Math.max(0, Number(store.settings.s2AutoRefreshDays) || 0);
    // Dòng "Khám phá lúc …": kết quả của mỗi tab được lưu lại, lấy mới khi bấm Làm mới hoặc khi cũ hơn ngưỡng tự làm mới.
    const drawStamp = (loading = false) => {
      const el = $('s2-stamp');
      if (!el) return;
      const at = data[kind]?.meta?.cachedAt;
      if (loading) { el.textContent = 'Đang khám phá…'; return; }
      if (!at) { el.textContent = ''; return; }
      const iso = new Date(at * 1000).toISOString();
      const when = new Date(at * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
      el.innerHTML = `Khám phá lúc <b>${escapeHtml(when)}</b> (${escapeHtml(fmtRelative(iso))}) · ${autoDays() ? `tự làm mới khi cũ hơn ${autoDays()} ngày` : 'đã lưu, bấm Làm mới để cập nhật'}${data[kind].meta.stale ? ' · <span class="status warn">Semantic Scholar đang giới hạn tốc độ, đang hiện bản đã lưu</span>' : ''}`;
    };

    const load = async (k, refresh = false) => {
      if (k !== kind) tlPicks = [];
      kind = k;
      const box = $('pp-s2');
      const seq = ++loadSeq;
      const stale = () => seq !== loadSeq || !box.isConnected;
      if (data[k] && !refresh) { draw(); drawStamp(); return; }
      $('s2-roles').innerHTML = '';
      drawStamp(true);
      if ($('s2-refresh')) $('s2-refresh').disabled = true;
      showProgress(box, k === 'recommend' ? 'Đang lấy gợi ý từ Semantic Scholar…' : 'Đang lấy danh sách và câu trích dẫn từ Semantic Scholar…', { expectedMs: 6000 });
      try {
        if (k === 'recommend') {
          const r = await api.s2Recommend(ident, refresh, autoDays());
          if (stale()) return;
          // Máy chủ cũ trả về mảng; máy chủ mới trả { items, cachedAt }.
          data[k] = Array.isArray(r) ? { items: r, meta: {} } : { items: r.items || [], meta: { cachedAt: r.cachedAt, stale: r.stale } };
        } else {
          const r = await (k === 'citations' ? api.s2Citations : api.s2References)(ident, refresh, autoDays());
          if (stale()) return;
          data[k] = { items: r.items || [], meta: r };
        }
        await seenReady;
        if (!stale()) { draw(); drawStamp(); }
        if (refresh && !stale()) toast('Đã cập nhật kết quả khám phá.');
      } catch (e) {
        if (stale()) return;
        drawStamp();
        box.innerHTML = `<span class="status err">${escapeHtml(e.message)}</span><div class="hint">Semantic Scholar giới hạn tốc độ với người dùng không có key; thử lại sau hoặc thêm S2 API key trong Cài đặt.</div>`;
      } finally {
        if (seq === loadSeq && $('s2-refresh')) $('s2-refresh').disabled = false;
      }
    };
    $('s2-refresh')?.addEventListener('click', () => load(kind, true));
    $('s2-auto-days')?.addEventListener('change', async (e) => {
      const n = Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0)));
      e.target.value = n || '';
      await saveSettings({ s2AutoRefreshDays: n });
      toast(n ? `Kết quả khám phá cũ hơn ${n} ngày sẽ tự được lấy mới khi mở paper.` : 'Đã tắt tự làm mới. Kết quả chỉ cập nhật khi bấm Làm mới.');
      if (data[kind] && !$('s2-refresh')?.disabled) drawStamp(); // đang tải thì giữ dòng "Đang khám phá…"
    });
    load('recommend');
    drawWhatsNew();
    bindFollow();
    $('pp-graph3d')?.addEventListener('click', () => openGraph3D(paperById(p.id) || p));
    $('pp-litmap')?.addEventListener('click', async () => (await import('../litmap.js')).openLitMap(paperById(p.id) || p));
    $('pp-research')?.addEventListener('click', () => goTab('research'));
    $('pp-go-research')?.addEventListener('click', () => goTab('research'));
    // Bấm một hướng trong thẻ 🧭: mở tab Hướng nghiên cứu và cuộn tới đúng hướng đó.
    body.querySelector('.rm-quick')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-go-dir]');
      if (!b) return;
      goTab('research');
      setTimeout(() => jumpTo(`rm-dir-${b.dataset.goDir}`), 120);
    });
    $('pp-s2-kind').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      $('pp-s2-kind').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      load(b.dataset.k);
    });
    $('s2-range').addEventListener('change', (e) => { prefs.range = Number(e.target.value); savePrefs(); draw(); });
    $('s2-sort').addEventListener('change', (e) => { prefs.sort = e.target.value; savePrefs(); draw(); });
    $('s2-hide').addEventListener('change', (e) => { prefs.hideSeen = e.target.checked; savePrefs(); draw(); });
    $('s2-roles').addEventListener('click', (e) => { const b = e.target.closest('[data-role]'); if (b) { prefs.role = b.dataset.role; savePrefs(); draw(); } });
  }

  /* "Có gì mới kể từ bài này": tóm tắt bằng AI những gì các paper dẫn bài này đã làm thêm. */
  function drawWhatsNew() {
    const box = $('pp-wn');
    if (!box) return;
    const pid = p.id;
    const job = whatsNewJob(pid);
    const running = job && !job.done;
    const wn = p.whatsNew;
    const head = '<div class="row" style="align-items:center"><h2 style="margin:0">Có gì mới kể từ bài này</h2><span class="spacer"></span>';
    if (running) {
      box.innerHTML = `${head}</div><div id="pp-wn-status" style="margin-top:10px"></div>`;
      showProgress('pp-wn-status', job.status, jobProgressOpts(job, job.step === 1 ? 40000 : 6000));
      const fn = (j) => {
        if (!$('pp-wn') || p.id !== pid) { j.listeners.delete(fn); return; }
        if (j.done) { j.listeners.delete(fn); p = paperById(pid) || p; if (j.error) toast(j.error, 8000, 'err'); drawWhatsNew(); return; }
        if ($('pp-wn-status')) showProgress('pp-wn-status', j.status, jobProgressOpts(j, j.step === 1 ? 40000 : 6000));
      };
      job.listeners.add(fn);
      return;
    }
    const s = store.settings;
    if (!wn) {
      box.innerHTML = `${head}</div>
        <p class="hint" style="margin:8px 0">Mô hình đọc tóm tắt và câu trích dẫn của tối đa 30 paper dẫn bài này (ưu tiên bài kế thừa phương pháp, so sánh kết quả, ảnh hưởng lớn), rồi tổng hợp: giới hạn nào của bài đã được giải quyết, kết quả mới trên cùng dataset, hướng mở rộng, phản biện, và bài nên đọc tiếp. Một lượt gọi ${escapeHtml(s.provider)}/${escapeHtml(s.models?.[s.provider] || '')}, rẻ hơn một lần trích xuất.</p>
        <button id="pp-wn-build" class="primary sm">Tạo bản tóm tắt</button>`;
    } else {
      const age = Math.round((Date.now() - Date.parse(wn.at)) / 864e5);
      box.innerHTML = `${head}<button id="pp-wn-copy" class="sm">Copy Markdown</button><button id="pp-wn-build" class="sm">Cập nhật</button><button id="pp-wn-del" class="sm ghost">Xoá</button></div>
        <div class="hint" style="margin:4px 0 10px">Tổng hợp từ ${wn.papers.length}/${wn.total} paper dẫn bài này · ${escapeHtml(wn.provider || '')}/${escapeHtml(wn.model || '')} · ${age ? `${age} ngày trước` : 'hôm nay'}. Chỉ dựa vào tóm tắt và câu trích dẫn, chưa đọc toàn văn từng bài. Bấm mã C1, C2… để mở bài.</div>
        <div id="pp-wn-body">${whatsNewHtml(wn)}</div>`;
      $('pp-wn-copy').addEventListener('click', async () => { await copyText(whatsNewMarkdown(p, wn)); toast('Đã copy bản tóm tắt dạng Markdown.'); });
      $('pp-wn-del').addEventListener('click', async () => { if (await confirmDialog('Xoá bản tóm tắt "Có gì mới"?', { danger: true, okLabel: 'Xoá' })) { p = await removeWhatsNew(pid); drawWhatsNew(); } });
      $('pp-wn-body').addEventListener('click', (e) => { const b = e.target.closest('[data-wn-add]'); if (b) location.hash = `#/add?q=${encodeURIComponent(addQueryOf(wn, b.dataset.wnAdd))}`; });
      // Bấm mã C1, C2… mở thẻ chi tiết; bản tóm tắt cũ thiếu thông tin thì lấy thêm từ danh sách bài dẫn đã lưu đệm.
      bindWhatsNewChips($('pp-wn-body'), wn, {
        loadExtra: async () => new Map(((await api.s2Citations(s2Ident(p))).items || []).map((it) => [it.paperId, it])),
        onCompare: (x, go) => (go ? goTab('research') : togglePin(pid, x, 'cit')), compareOf: (x) => compareState(paperById(pid), x),
      });
    }
    $('pp-wn-build').addEventListener('click', () => {
      if (!hasCredentials(store.settings)) return toast('Chưa có API key. Mở Cài đặt để nhập key.', 3500, 'err');
      trackJob(`wn:${pid}`, buildWhatsNew(pid), { label: 'Có gì mới kể từ bài này', title: p.title, href: `#/paper/${pid}?tab=related`, here: onPaperTab(pid, 'related'), expectedMs: (j) => (j.step === 1 ? 40000 : 6000) });
      drawWhatsNew();
    });
  }

  /* Nút 🔔 Theo dõi: tạo bộ theo dõi bài dẫn bài này, hoặc bài mới của tác giả, trong trang Theo dõi paper mới. */
  function bindFollow() {
    const btn = $('pp-follow');
    if (!btn) return;
    const ident = s2Ident(p);
    const menu = $('pp-follow-menu');
    const sync = async () => { const ws = await loadWatches(); if ($('pp-follow-cites')) $('pp-follow-cites').checked = ws.some((w) => w.type === 'cites' && w.ident === ident); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; if (!menu.hidden) sync(); });
    const outside = (e) => { if (!menu.isConnected) { document.removeEventListener('click', outside); return; } if (!menu.contains(e.target) && e.target !== btn) menu.hidden = true; };
    document.addEventListener('click', outside);
    $('pp-follow-cites').addEventListener('change', async (e) => {
      if (e.target.checked) {
        const r = await addWatch({ type: 'cites', ident, paperTitle: p.title, name: `Dẫn: ${p.title.slice(0, 60)}` });
        toast(r.existed ? 'Đã đang theo dõi bài dẫn bài này.' : 'Đã thêm vào trang Theo dõi paper mới. Bấm Quét ở đó để xem bài dẫn mới.', 6000, '', { label: 'Mở', onClick: () => { location.hash = '#/feed'; } });
      } else {
        await removeWatchWhere((w) => w.type === 'cites' && w.ident === ident);
        toast('Đã bỏ theo dõi bài dẫn bài này.');
      }
    });
    $('pp-follow-authors').addEventListener('click', async () => {
      menu.hidden = true;
      let authors = [];
      try { authors = await api.s2Authors(ident); } catch (err) { return toast(err.message, 6000, 'err'); }
      if (!authors.length) return toast('Semantic Scholar không có thông tin tác giả của bài này.', 4000, 'err');
      const ws = await loadWatches();
      const watched = new Set(ws.filter((w) => w.type === 'author').map((w) => w.authorId));
      const picked = await dialog({
        title: 'Theo dõi bài mới của tác giả', width: 520,
        body: `<p class="hint" style="margin-top:0">Mỗi tác giả được tick thành một bộ theo dõi trong trang Theo dõi paper mới. Hồ sơ tác giả của Semantic Scholar đôi khi gộp nhầm người trùng tên, nhất là tên viết tắt. Quét xong mà thấy nhiều bài lạ ngành thì gỡ bộ theo dõi đó.</p>
          <div class="pick-list">${authors.map((a) => `<label class="row" style="gap:8px;padding:4px 0"><input type="checkbox" value="${escapeHtml(a.authorId)}" data-name="${escapeHtml(a.name)}" ${watched.has(a.authorId) ? 'checked' : ''} style="width:auto"> ${escapeHtml(a.name)}</label>`).join('')}</div>`,
        buttons: [{ label: 'Huỷ', value: null }, { label: 'Lưu', primary: true, onClick: (b, close) => { close([...b.querySelectorAll('input')].map((i) => ({ id: i.value, name: i.dataset.name, on: i.checked }))); return false; } }],
      });
      if (!picked) return;
      let added = 0;
      let removed = 0;
      for (const a of picked) {
        if (a.on && !watched.has(a.id)) { await addWatch({ type: 'author', authorId: a.id, authorName: a.name, name: `Tác giả: ${a.name}` }); added += 1; }
        if (!a.on && watched.has(a.id)) removed += await removeWatchWhere((w) => w.type === 'author' && w.authorId === a.id);
      }
      toast(added || removed ? `Đã ${[added ? `thêm ${added}` : '', removed ? `bỏ ${removed}` : ''].filter(Boolean).join(', ')} bộ theo dõi tác giả.` : 'Không có thay đổi.', 6000, '', added ? { label: 'Mở', onClick: () => { location.hash = '#/feed'; } } : null);
    });
  }

  function drawCite() {
    const body = $('pp-body');
    const e = p.extraction || {};
    const bib = bibtexOf(p);
    body.innerHTML = `<div class="card"><h2>BibTeX</h2><pre class="code" id="pp-bib">${escapeHtml(bib)}</pre><div class="row"><button id="pp-bib-copy" class="sm">Copy BibTeX</button><button id="pp-bib-dl" class="sm">Tải .bib</button></div></div>
      <div class="card"><div class="row"><h2 style="margin:0">Trích dẫn APA <span class="hint">(bản thứ 7)</span></h2><span class="spacer"></span>
          <label class="row hint" style="gap:6px" title="APA viết tiêu đề kiểu sentence case: chỉ viết hoa chữ đầu câu, chữ đầu sau dấu hai chấm và tên riêng"><input type="checkbox" id="pp-apa-keep" style="width:auto"> Giữ nguyên chữ hoa của tiêu đề</label></div>
        <div class="apa-label">Mục tài liệu tham khảo</div>
        <div class="apa-ref" id="pp-apa-ref"></div>
        <div class="row wrap" style="margin-top:8px"><button id="pp-apa-copy" class="sm primary" title="Dán vào Word hoặc Google Docs vẫn giữ in nghiêng">Copy có định dạng</button><button id="pp-apa-copy-text" class="sm">Copy văn bản thuần</button></div>
        <div class="apa-label" style="margin-top:14px">Trích dẫn trong bài</div>
        <div class="apa-intext"><span class="hint">Trong ngoặc</span><code id="pp-apa-in"></code><button class="linkish" id="pp-apa-in-copy">Copy</button>
          <span class="hint">Trong câu</span><code id="pp-apa-narr"></code><button class="linkish" id="pp-apa-narr-copy">Copy</button></div>
        <p class="hint" id="pp-apa-note" style="margin:12px 0 0"></p></div>
      <div class="card"><h2>Dòng note rút gọn</h2><div class="mono-box">${escapeHtml(quickNoteLine(p))}</div></div>`;
    $('pp-bib-copy').addEventListener('click', async () => { await copyText(bib); toast('Đã copy BibTeX.'); });
    $('pp-bib-dl').addEventListener('click', () => download(`${bibtexOf(p).match(/\{([^,]+),/)[1]}.bib`, bib, 'application/x-bibtex;charset=utf-8'));
    let apa;
    const KIND_NOTE = { journal: 'bài tạp chí, in nghiêng tên tạp chí', proceedings: 'bài trong kỷ yếu hội nghị, in nghiêng tên kỷ yếu', preprint: 'preprint, in nghiêng tiêu đề', other: 'tài liệu đứng riêng, in nghiêng tiêu đề' };
    const drawApa = () => {
      apa = apaCitation(p, { keepTitleCase: $('pp-apa-keep').checked });
      $('pp-apa-ref').innerHTML = apa.html;
      $('pp-apa-in').textContent = apa.inText;
      $('pp-apa-narr').textContent = apa.narrative;
      $('pp-apa-note').innerHTML = `Nhận dạng là ${KIND_NOTE[apa.kind]}. APA không dùng in đậm trong mục tài liệu tham khảo.${apa.missing.length ? ` App chưa lưu ${escapeHtml(apa.missing.join(', '))}, nên bổ sung tay nếu nơi nộp bài yêu cầu.` : ''}${$('pp-apa-keep').checked ? '' : ' Tiêu đề đã được chuyển sang kiểu chỉ viết hoa chữ đầu câu, nên soát lại tên riêng.'}`;
    };
    $('pp-apa-keep').addEventListener('change', drawApa);
    drawApa();
    $('pp-apa-copy').addEventListener('click', async () => { const rich = await copyRich(apa.html, apa.text); toast(rich ? 'Đã copy kèm định dạng in nghiêng.' : 'Đã copy dạng văn bản thuần (trình duyệt không cho copy kèm định dạng).'); });
    $('pp-apa-copy-text').addEventListener('click', async () => { await copyText(apa.text); toast('Đã copy văn bản thuần.'); });
    $('pp-apa-in-copy').addEventListener('click', async () => { await copyText(apa.inText); toast('Đã copy.'); });
    $('pp-apa-narr-copy').addEventListener('click', async () => { await copyText(apa.narrative); toast('Đã copy.'); });
  }

  async function drawSource() {
    const body = $('pp-body');
    body.innerHTML = `<span class="hint">${spinner('Đang tải…')}</span>`;
    const t = await api.getText(p.id);
    body.innerHTML = `<div class="card"><h2>Nội dung nguồn đã lưu ${t.kind ? `· ${escapeHtml(t.kind)}` : ''} · ${(t.text || '').length.toLocaleString('vi-VN')} ký tự</h2>
      <p class="hint">Đây là văn bản đã gửi cho model khi trích xuất, cũng dùng làm ngữ cảnh cho tab Hỏi đáp. Bạn có thể dán full text mới rồi bấm "Lưu" (và "Trích xuất lại" ở đầu trang nếu muốn cập nhật ghi chú).</p>
      <textarea id="pp-src" rows="18" style="font-family:var(--mono);font-size:12px">${escapeHtml(t.text || '')}</textarea>
      <div class="row wrap" style="margin-top:8px"><button id="pp-src-save" class="primary sm">Lưu nội dung nguồn</button><button id="pp-src-anno" class="sm" disabled title="Bôi đen một đoạn trong ô trên rồi bấm">Ghi chú đoạn đã chọn</button><span id="pp-src-status" class="status"></span></div></div>
      ${annotationsHtml()}
      <div class="card"><h2>Thông tin trích xuất</h2><div class="mono-box">${escapeHtml(JSON.stringify(p.meta || {}, null, 2))}</div></div>`;
    $('pp-src-save').addEventListener('click', async () => {
      await api.putText(p.id, $('pp-src').value, t.kind || 'text người dùng dán');
      setStatus('pp-src-status', 'Đã lưu.', 'ok');
    });
    const ta = $('pp-src');
    const updateSel = () => { $('pp-src-anno').disabled = !(ta.selectionEnd > ta.selectionStart); };
    ta.addEventListener('select', updateSel); ta.addEventListener('mouseup', updateSel); ta.addEventListener('keyup', updateSel);
    $('pp-src-anno').addEventListener('click', () => {
      const q = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
      if (!q) return;
      body.querySelector('#pp-anno-quote').value = q;
      body.querySelector('#pp-anno-note').focus();
      body.querySelector('#pp-anno-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    bindAnnotations(body);
  }

  async function editVenue() {
    const vi = p.venueInfo || {};
    const rankOpts = ['', 'A*', 'A', 'B', 'C', 'Australasian B', 'Australasian C', 'National', 'Unranked'];
    const qOpts = ['', 'Q1', 'Q2', 'Q3', 'Q4'];
    const ok = await dialog({
      title: 'Sửa venue & xếp hạng', width: 640,
      body: `<label class="field"><span class="label-text">Tìm trong bảng CORE / SJR (gõ tên viết tắt hoặc tên đầy đủ)</span><input type="search" id="ve-q" placeholder="ví dụ: CVPR, TPAMI, Medical Image Analysis"></label>
        <div id="ve-results" style="max-height:200px;overflow:auto;margin-bottom:10px"></div>
        <div class="form-grid">
          <label class="field"><span class="label-text">Loại</span><select id="ve-type">${Object.entries(VENUE_TYPES).map(([k, l]) => `<option value="${k}" ${vi.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span class="label-text">Viết tắt</span><input type="text" id="ve-acr" value="${escapeHtml(vi.acronym || vi.parent?.acronym || '')}"></label>
          <label class="field full"><span class="label-text">Tên đầy đủ</span><input type="text" id="ve-name" value="${escapeHtml(vi.name || '')}"></label>
          <label class="field"><span class="label-text">Hạng CORE (hội nghị)</span><select id="ve-rank">${rankOpts.map((r) => `<option value="${r}" ${(vi.rank || '') === r ? 'selected' : ''}>${r || '—'}</option>`).join('')}</select></label>
          <label class="field"><span class="label-text">SJR quartile (tạp chí)</span><select id="ve-q4">${qOpts.map((r) => `<option value="${r}" ${(vi.quartile || '') === r ? 'selected' : ''}>${r || '—'}</option>`).join('')}</select></label>
          <label class="field full"><span class="label-text">Ghi chú</span><input type="text" id="ve-note" value="${escapeHtml(vi.note || '')}" placeholder="ví dụ: Oral, Spotlight, Best paper…"></label>
        </div>`,
      buttons: [{ label: 'Huỷ', value: false }, {
        label: 'Lưu', value: true, primary: true,
        onClick: async (body, close) => {
          const g = (id) => body.querySelector(id).value.trim();
          const info = { type: g('#ve-type'), acronym: g('#ve-acr'), name: g('#ve-name'), rank: g('#ve-rank'), quartile: g('#ve-q4'), note: g('#ve-note'), manual: true, matchedBy: 'manual', system: g('#ve-rank') ? (vi.system && /CORE/.test(vi.system) ? vi.system : 'CORE') : (g('#ve-q4') ? (vi.system && /SJR/.test(vi.system) ? vi.system : 'SJR') : '') };
          if (['workshop', 'findings'].includes(info.type) && vi.parent) info.parent = vi.parent;
          await quickSave({ venueInfo: info });
          close(true);
          return false;
        },
      }],
      onOpen: (body) => {
        let t;
        body.querySelector('#ve-q').addEventListener('input', (e) => {
          clearTimeout(t);
          t = setTimeout(async () => {
            const q = e.target.value.trim();
            if (q.length < 2) { body.querySelector('#ve-results').innerHTML = ''; return; }
            const rs = await api.venueSearch(q).catch(() => []);
            body.querySelector('#ve-results').innerHTML = rs.map((r, i) => `<div class="s2-item" style="cursor:pointer" data-i="${i}"><div class="body"><b>${escapeHtml(r.acronym ? `${r.acronym} · ` : '')}${escapeHtml(r.name)}</b><div class="hint">${escapeHtml(r.kind === 'core' ? `Hội nghị · CORE ${r.rank} (${r.system})` : `${r.type} · ${r.quartile || 'chưa có quartile'} · SJR ${r.sjr ?? '?'} (${r.system})`)}</div></div></div>`).join('') || '<span class="hint">Không tìm thấy.</span>';
            body.querySelector('#ve-results').onclick = (ev) => {
              const it = rs[Number(ev.target.closest('[data-i]')?.dataset.i)];
              if (!it) return;
              const cur = body.querySelector('#ve-type').value;
              body.querySelector('#ve-type').value = it.kind === 'core' ? (['workshop', 'findings'].includes(cur) ? cur : 'conference') : ({ journal: 'journal', 'trade journal': 'journal', 'book series': 'book-series', 'conference and proceedings': 'conference' }[it.type] || 'journal');
              body.querySelector('#ve-acr').value = it.acronym || '';
              body.querySelector('#ve-name').value = it.name;
              body.querySelector('#ve-rank').value = it.kind === 'core' ? (it.rank in { 'A*': 1, A: 1, B: 1, C: 1, 'Australasian B': 1, 'Australasian C': 1, Unranked: 1 } ? it.rank : '') : '';
              body.querySelector('#ve-q4').value = it.kind === 'sjr' ? (it.quartile || '') : '';
            };
          }, 250);
        });
      },
    });
    if (ok) { metaRow(); drawTab(); toast('Đã lưu venue.'); }
  }

  async function reExtract() {
    const pid = p.id;
    if (jobRunning(`rex:${pid}`)) return toast('Paper này đang được trích xuất lại, xem thanh tiến độ ở đầu trang.');
    if (!hasCredentials(store.settings)) return toast('Chưa có API key. Mở Cài đặt.', 3000, 'err');
    const t = await api.getText(p.id);
    if (!p.pdfId && (t.text || '').length < 120) return toast('Chưa có nội dung nguồn / PDF để trích xuất lại. Vào tab Nguồn hoặc PDF để bổ sung.', 4000, 'err');
    if (!(await confirmDialog('Chạy lại trích xuất ghi chú theo template từ nguồn đã lưu? Ghi chú cá nhân, trích dẫn theo đoạn, trạng thái và đánh giá được giữ nguyên. Phần ghi chú trích xuất sẽ được thay bằng bản mới.', { okLabel: 'Trích xuất lại' }))) return;
    const source = { url: p.url, title: p.title, arxivId: p.arxivId, doi: p.doi, kind: t.kind || p.sourceKind, text: t.text || '', pdfId: p.pdfId, pdfName: p.pdfName, exceptId: p.id, s2Id: p.s2Id, citationCount: p.citationCount };
    // Chạy nền: rời trang vẫn chạy tiếp và tự lưu, mở lại thì thanh tiến độ chạy tiếp đúng chỗ.
    const job = runJob(`rex:${pid}`, async (update) => {
      const r = await runExtraction(source, { onStatus: (m) => update(m) });
      await savePaperFromExtraction({ extraction: r.extraction, meta: r.meta, source: r.source, topicId: paperById(pid)?.topicId || source.topicId, existingId: pid });
      return r;
    }, { label: 'Trích xuất lại ghi chú', title: p.title, href: `#/paper/${pid}?tab=notes`, here: onPaperPage(pid), expectedMs: () => 50000 });
    followReExtract(job);
  }

  /** Thanh tiến độ trích xuất lại ở đầu trang paper. */
  function followReExtract(job) {
    if ($('pp-reextract')) $('pp-reextract').disabled = true;
    followJob(job, $('pp-save-status'), { expectedMs: 50000, onDone: (j) => {
      if ($('pp-reextract')) $('pp-reextract').disabled = false;
      if (j.error) return setStatus('pp-save-status', escapeHtml(j.error), 'err');
      p = paperById(p.id) || p;
      setStatus('pp-save-status', 'Đã trích xuất lại.', 'ok');
      metaRow();
      drawTab();
    } });
  }

  /** Chuyển sang một tab khác của trang paper (dùng cho lối tắt từ tab Liên quan). */
  function goTab(k) { $('pp-tabs').querySelector(`button[data-tab="${k}"]`)?.click(); $('pp-body')?.closest('.view')?.scrollTo({ top: 0 }); }

  /* ---------------- tab Hướng nghiên cứu ---------------- */
  /** Nút "Lịch sử": danh sách phiên bản trước của bản đồ, xem / khôi phục / xoá. */
  async function bindResearchLog(pid) {
    const btn = $('pp-rm-log');
    if (!btn) return;
    const log = await researchLog(pid);
    if (!$('pp-rm-log')) return;
    $('pp-rm-log-n').textContent = log.length ? `(${log.length})` : '';
    btn.hidden = !log.length;
    // Chưa có bản đồ (vừa xoá) nhưng có lịch sử: gợi ý khôi phục ngay.
    if (!p.researchMap && log.length && !$('pp-rm-undo')) {
      btn.insertAdjacentHTML('afterend', `<button id="pp-rm-undo" class="sm">↶ Khôi phục bản gần nhất (${escapeHtml(fmtRelative(log[0].map.at))})</button>`);
      $('pp-rm-undo').addEventListener('click', async () => { p = await restoreResearchMap(pid, log[0].id); toast('Đã khôi phục bản đồ.'); drawResearch(); });
    }
    btn.onclick = () => openResearchLog(pid);
  }

  async function openResearchLog(pid) {
    const render = (log) => {
      const cur = paperById(pid)?.researchMap;
      const row = (map, entry) => {
        const s = mapSummary(map);
        const when = new Date(map.at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
        return `<div class="rml-row ${entry ? '' : 'rml-cur'}">
          <div class="rml-main"><b>${entry ? 'Bản tạo lúc' : 'Bản hiện tại · tạo lúc'} ${escapeHtml(when)}</b>${map.filledAt ? ` <span class="hint">· so sánh thêm ${escapeHtml(fmtRelative(map.filledAt))}</span>` : ''}${map.restoredAt && !entry ? ' <span class="badge">đã khôi phục</span>' : ''}
            <div class="hint">${escapeHtml(s.model || '')} · ${s.papers} bài (${s.compared} đã so sánh) · ${s.coverage} khía cạnh · ${s.gaps} khoảng trống · ${s.directions} hướng đi${map.perKind ? ` · mỗi loại ${map.perKind === 'all' ? 'toàn bộ' : map.perKind}` : ''}</div>
            ${entry ? `<div class="hint">${escapeHtml(LOG_EVENTS[entry.event] || 'Đã lưu')} · ${escapeHtml(fmtRelative(entry.savedAt))}</div>` : ''}</div>
          <div class="rml-acts">${entry ? `<button class="sm" data-view="${entry.id}">Xem</button><button class="sm primary" data-restore="${entry.id}">Khôi phục</button><button class="sm ghost" data-del="${entry.id}" title="Xoá phiên bản này khỏi lịch sử">✕</button>` : '<span class="badge ok">đang dùng</span>'}</div></div>`;
      };
      return `<p class="hint" style="margin-top:0">Mỗi lần Cập nhật, So sánh thêm, Xoá hoặc Khôi phục, bản đồ trước đó được lưu lại ở đây (tối đa 15 bản). Khôi phục một bản thì bản hiện tại cũng được lưu vào lịch sử, nên luôn quay lại được.</p>
        <div class="rml-list">${cur ? row(cur, null) : ''}${log.map((e) => row(e.map, e)).join('') || '<span class="hint">Chưa có phiên bản nào.</span>'}</div>`;
    };
    let log = await researchLog(pid);
    dialog({
      title: 'Lịch sử bản đồ hướng nghiên cứu', width: 760, body: render(log),
      onOpen: (bodyEl, close) => {
        bodyEl.addEventListener('click', async (e) => {
          const v = e.target.closest('[data-view]');
          const r = e.target.closest('[data-restore]');
          const d = e.target.closest('[data-del]');
          if (v) {
            const entry = log.find((x) => x.id === v.dataset.view);
            if (!entry) return;
            dialog({ title: `Phiên bản tạo lúc ${new Date(entry.map.at).toLocaleString('vi-VN')}`, width: 1100, body: `<div class="rm-body rml-preview">${researchMapHtml(entry.map, p)}</div>`,
              onOpen: (b2) => bindWhatsNewChips(b2, entry.map) });
          } else if (r) {
            if (!(await confirmDialog('Khôi phục phiên bản này? Bản đồ hiện tại sẽ được lưu vào lịch sử trước khi thay.', { okLabel: 'Khôi phục' }))) return;
            p = await restoreResearchMap(pid, r.dataset.restore);
            toast('Đã khôi phục phiên bản đã chọn.');
            close(null);
            drawResearch();
          } else if (d) {
            if (!(await confirmDialog('Xoá phiên bản này khỏi lịch sử? Không hoàn tác được.', { danger: true, okLabel: 'Xoá' }))) return;
            await removeLogEntry(pid, d.dataset.del);
            log = await researchLog(pid);
            bodyEl.innerHTML = render(log);
            if ($('pp-rm-log-n')) $('pp-rm-log-n').textContent = log.length ? `(${log.length})` : '';
          }
        });
      },
    });
  }

  function drawResearch() {
    const body = $('pp-body');
    const pid = p.id;
    const ident = s2Ident(p);
    const job = researchJob(pid);
    const running = job && !job.done;
    const rm = p.researchMap;
    const s = store.settings;
    const head = `<div class="row wrap rm-head"><h2 style="margin:0">Hướng nghiên cứu</h2><button id="pp-rm-log" class="sm ghost" hidden title="Các phiên bản trước của bản đồ: xem, khôi phục hoặc xoá">🕘 Lịch sử <span id="pp-rm-log-n"></span></button><span class="hint">So sánh với bài được dẫn (R), bài dẫn bài này (C) và bài bạn chọn (S) · ai cover gì · còn bỏ ngỏ gì · nên làm gì tiếp</span><span class="spacer"></span>`;
    if (!ident) { body.innerHTML = `<div class="card">${head}</div><p class="hint">Paper chưa có arXiv ID / DOI / link nên không tra được bài dẫn và bài được dẫn trên Semantic Scholar.</p></div>`; return; }
    if (running) {
      body.innerHTML = `<div class="card">${head}</div><div id="pp-rm-status" style="margin-top:12px"></div></div>`;
      const show = (j) => showProgress('pp-rm-status', j.status, jobProgressOpts(j, j.step >= 2 ? 60000 : 6000));
      show(job);
      const fn = (j) => {
        if (tab !== 'research' || p.id !== pid || !$('pp-rm-status')) { j.listeners.delete(fn); return; }
        if (j.done) { j.listeners.delete(fn); p = paperById(pid) || p; if (j.error) toast(j.error, 8000, 'err'); else toast('Đã tạo bản đồ hướng nghiên cứu.'); drawResearch(); return; }
        show(j);
      };
      job.listeners.add(fn);
      bindResearchLog(pid);
      return;
    }
    const startBtn = (label, primary) => `<button id="pp-rm-build" class="sm ${primary ? 'primary' : ''}">${label}</button>`;
    let perKind = PER_KIND_DEFAULT;
    try { const v = localStorage.getItem('pv.rmPerKind') || rm?.perKind; if (v) perKind = v === 'all' ? 'all' : Number(v); } catch (_) { /* bộ nhớ trình duyệt bị chặn */ }
    const nSelect = `<label class="row hint rm-n" title="Số bài tối đa lấy từ mỗi loại (bài được dẫn, bài dẫn bài này). Trên ${MAIN_CAP} bài: ${MAIN_CAP} bài tiêu biểu được phân tích sâu (tổng quan, cover, khoảng trống, hướng đi), các bài còn lại được so sánh thêm theo đợt ${BATCH_SIZE} bài, mỗi đợt một lượt gọi mô hình.">Mỗi loại tối đa <select id="pp-rm-n">${PER_KIND_OPTIONS.map((n) => `<option value="${n}" ${String(n) === String(perKind) ? 'selected' : ''}>${n === 'all' ? 'Toàn bộ' : n}</option>`).join('')}</select> bài</label>`;
    // Bài người dùng chọn thêm (nút "⇄ So sánh với bài gốc" ở tab Liên quan, đồ thị 3D, thẻ C1…).
    const pins = p.researchPins || [];
    const inMap = new Set((rm?.papers || []).map((x) => x.key));
    const pinsHtml = pins.length ? `<div class="rm-pins"><div class="rm-pins-h"><b>Bài bạn chọn để so sánh (${pins.length})</b>${pins.some((x) => !inMap.has(x.key)) ? '<span class="hint">Bài chưa có trong bản đồ sẽ được đưa vào khi bấm Cập nhật.</span>' : ''}</div>
      ${pins.map((x) => `<div class="rm-pin-row"><span class="badge">${escapeHtml({ ref: 'bài gốc dẫn', cit: 'dẫn bài gốc', rec: 'gợi ý', other: 'bài khác' }[x.relation] || 'bài khác')}</span><span class="rm-pin-t">${titleHtml(x.it?.title || '')}</span>${inMap.has(x.key) ? '<span class="badge ok">đã trong bản đồ</span>' : '<span class="badge warn">chưa cập nhật</span>'}<button class="ghost sm" data-unpin="${escapeHtml(x.key)}" title="Bỏ khỏi danh sách so sánh">✕</button></div>`).join('')}</div>` : '';
    if (!rm) {
      body.innerHTML = `<div class="card" id="pp-rm-card">${head}</div>
        <p class="hint" style="margin:10px 0">Mô hình đọc ghi chú của bài này cùng tóm tắt và câu trích dẫn của các bài nó dẫn và các bài dẫn nó (ưu tiên bài kế thừa phương pháp, so sánh kết quả, ảnh hưởng lớn), cộng các bài bạn tự chọn, rồi lập: bảng so sánh phương pháp / bài toán / domain / dữ liệu, bảng khía cạnh nào đã được bài nào cover, các vấn đề còn bỏ ngỏ, và hướng nghiên cứu tiếp theo${s.myResearch?.trim() ? ' kèm liên hệ với đề tài của bạn' : ' (nhập đề tài trong Cài đặt để có gợi ý bám đề tài)'}. Một lượt gọi ${escapeHtml(s.provider)}/${escapeHtml(s.models?.[s.provider] || '')}.</p>
        <p class="hint" style="margin:0 0 10px">Muốn so sánh thêm một bài cụ thể: bấm <b>⇄ So sánh</b> trên bài đó ở tab Liên quan, trong đồ thị 3D, hoặc trên thẻ C1, C2… của phần "Có gì mới".</p>
        ${pinsHtml}
        <div class="row wrap" style="margin-top:8px">${startBtn('Tạo bản đồ hướng nghiên cứu', true)}${nSelect}<label class="row hint" style="gap:6px"><input type="checkbox" id="pp-rm-fresh" style="width:auto"> Lấy mới danh sách bài từ Semantic Scholar</label></div></div>`;
    } else {
      const cnt = (rel) => rm.papers.filter((x) => x.relation === rel).length;
      const firstOf = (rel) => rm.papers.find((x) => x.relation === rel)?.id;
      const demo = [firstOf('ref'), firstOf('cit'), firstOf('pin')].filter(Boolean).map((id) => researchChip(rm, p, id)).join(' ');
      body.innerHTML = `<div class="card" id="pp-rm-card">${head}<button id="pp-rm-graph" class="sm" title="Mở đồ thị trích dẫn 3D của bài này">🕸 Đồ thị 3D</button><button id="pp-rm-copy" class="sm">Copy Markdown</button>${startBtn('Cập nhật')}<button id="pp-rm-del" class="sm ghost">Xoá</button></div>
        <div class="row wrap rm-meta"><span class="hint">Dựa trên ${cnt('ref')}/${rm.totals?.refs ?? cnt('ref')} bài được dẫn, ${cnt('cit')}/${rm.totals?.cits ?? cnt('cit')} bài dẫn bài này${cnt('pin') ? ` và ${cnt('pin')} bài bạn chọn` : ''}${rm.mainCount && rm.mainCount < rm.papers.length ? ` (phân tích sâu ${rm.mainCount} bài tiêu biểu, ${rm.papers.length - rm.mainCount} bài còn lại so sánh thêm theo đợt)` : ''} · ${escapeHtml(rm.provider || '')}/${escapeHtml(rm.model || '')} · ${escapeHtml(fmtRelative(rm.at))}. Chỉ dựa vào tóm tắt và câu trích dẫn, chưa đọc toàn văn từng bài.${demo ? ` Bấm mã ${demo} để xem bài.` : ''}</span><span class="spacer"></span>${nSelect}</div>
        ${pinsHtml}
        <div id="pp-rm-fill-status"></div>
        <div id="pp-rm-body" class="rm-body">${researchMapHtml(rm, p)}</div></div>`;
      $('pp-rm-copy').addEventListener('click', async () => { await copyText(researchMapMarkdown(p, rm)); toast('Đã copy bản đồ hướng nghiên cứu dạng Markdown.'); });
      $('pp-rm-del').addEventListener('click', async () => { if (await confirmDialog('Xoá bản đồ hướng nghiên cứu của paper này?', { danger: true, okLabel: 'Xoá' })) { p = await removeResearchMap(pid); drawResearch(); } });
      $('pp-rm-graph').addEventListener('click', () => openGraph3D(paperById(pid) || p));
      // Gắn trên cả thẻ để mã bài ở dòng mô tả phía trên cũng bấm được.
      bindWhatsNewChips($('pp-rm-card'), rm);
      bindResearchSort($('pp-rm-body'), pid);
      bindResearchLinks($('pp-rm-body'));
    }
    $('pp-rm-n').addEventListener('change', (e) => { try { localStorage.setItem('pv.rmPerKind', e.target.value); } catch (_) { /* bỏ qua */ } });
    bindResearchLog(pid);
    // So sánh lại các bài mô hình bỏ sót: chạy nền, có thanh tiến độ ngay trên bảng và trong bảng việc nền.
    const fj = fillJob(pid);
    const followFill = (j) => {
      const box = $('pp-rm-fill-status');
      if (box) showProgress(box, j.status, jobProgressOpts(j, j.step === 1 ? 50000 : 20000));
      // Mỗi lúc chỉ chạy một lượt so sánh: khoá mọi nút so sánh cho tới khi xong.
      $('pp-rm-body')?.querySelectorAll('[data-rm-fill], [data-rm-fill-sel], [data-rm-fill-one]').forEach((b) => b.setAttribute('disabled', ''));
      const fn = (x) => {
        if (tab !== 'research' || p.id !== pid || !$('pp-rm-fill-status')) { x.listeners.delete(fn); return; }
        if (x.done) {
          x.listeners.delete(fn); p = paperById(pid) || p;
          if (x.error) toast(x.error, 8000, 'err');
          else toast(x.left ? `Đã so sánh thêm ${x.filled} bài; ${x.left} bài vẫn thiếu thông tin.` : `Đã so sánh thêm ${x.filled} bài.`, 5000, 'ok');
          drawResearch(); return;
        }
        showProgress($('pp-rm-fill-status'), x.status, jobProgressOpts(x, x.step === 1 ? 50000 : 20000));
      };
      j.listeners.add(fn);
    };
    if (rm && fj && !fj.done) followFill(fj);
    $('pp-rm-card').addEventListener('click', (e) => {
      const all = e.target.closest('[data-rm-fill]');
      const sel = e.target.closest('[data-rm-fill-sel]');
      const one = e.target.closest('[data-rm-fill-one]');
      if (!all && !sel && !one) return;
      if (!hasCredentials(store.settings)) { toast('Chưa có API key. Mở Cài đặt để nhập key.', 3500, 'err'); return; }
      // Tất cả bài còn thiếu, chỉ các bài đã tick, hoặc riêng một bài.
      const codes = one ? [one.dataset.rmFillOne] : sel ? [...$('pp-rm-body').querySelectorAll('[data-rm-pick]:checked')].map((c) => c.dataset.rmPick) : null;
      if (codes && !codes.length) return;
      const n = codes ? codes.length : missingCodes(p.researchMap).length;
      const j = trackJob(`rmfill:${pid}`, fillMissing(pid, codes), { label: n === 1 && codes ? `So sánh bài ${codes[0]}` : `So sánh ${n} bài còn thiếu`, title: p.title, href: `#/paper/${pid}?tab=research`, here: onPaperTab(pid, 'research'), expectedMs: (x) => (x.step === 1 ? Math.min(50000, 8000 + n * 2500) : 20000) });
      followFill(j);
    });
    // Tick chọn bài chưa so sánh: cập nhật nút "So sánh N bài đã chọn".
    $('pp-rm-card').addEventListener('change', (e) => {
      const bodyEl = $('pp-rm-body');
      if (!bodyEl) return;
      if (e.target.matches('[data-rm-pick-all]')) bodyEl.querySelectorAll('[data-rm-pick]').forEach((c) => { if (!c.closest('tr')?.hidden) c.checked = e.target.checked; });
      if (!e.target.matches('[data-rm-pick], [data-rm-pick-all]')) return;
      const picked = bodyEl.querySelectorAll('[data-rm-pick]:checked').length;
      const btn = bodyEl.querySelector('[data-rm-fill-sel]');
      if (btn) { btn.textContent = `So sánh ${picked} bài đã chọn`; btn.disabled = !picked || !!(fillJob(pid) && !fillJob(pid).done); btn.classList.toggle('primary', picked > 0); }
      const allBox = bodyEl.querySelector('[data-rm-pick-all]');
      const total = bodyEl.querySelectorAll('[data-rm-pick]').length;
      if (allBox && e.target !== allBox) { allBox.checked = picked === total; allBox.indeterminate = picked > 0 && picked < total; }
    });
    $('pp-rm-card').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-unpin]');
      if (!b) return;
      await removePin(pid, b.dataset.unpin);
      p = paperById(pid) || p;
      drawResearch();
    });
    $('pp-rm-build').addEventListener('click', async () => {
      if (!hasCredentials(store.settings)) return toast('Chưa có API key. Mở Cài đặt để nhập key.', 3500, 'err');
      const nv = $('pp-rm-n')?.value || PER_KIND_DEFAULT;
      const n = perKindValue(nv);
      // Nhiều bài: báo trước số lượt gọi mô hình để người dùng quyết định.
      if (n >= 50) {
        const est = n === Infinity ? 'toàn bộ (có thể vài trăm bài)' : `tối đa ${n * 2} bài`;
        const calls = n === Infinity ? 'nhiều lượt' : `khoảng ${1 + Math.ceil(Math.max(0, n * 2 - MAIN_CAP) / BATCH_SIZE)} lượt`;
        if (!(await confirmDialog(`Lập bản đồ với ${est}: ${MAIN_CAP} bài tiêu biểu được phân tích sâu, các bài còn lại được so sánh thêm theo đợt ${BATCH_SIZE} bài. Sẽ gọi mô hình ${calls}, tốn token tương ứng. Tiếp tục?`, { okLabel: 'Tiếp tục' }))) return;
      }
      trackJob(`rm:${pid}`, buildResearchMap(pid, { refresh: !!$('pp-rm-fresh')?.checked, perKind: nv }), { label: 'Hướng nghiên cứu', title: p.title, href: `#/paper/${pid}?tab=research`, here: onPaperTab(pid, 'research'), expectedMs: (j) => (j.step >= 2 ? 60000 : 6000) });
      drawResearch();
    });
  }

  function drawTab() {
    ({ notes: drawNotes, lecture: drawLecture, edit: drawEdit, pdf: drawPdf, ask: drawAsk, related: drawRelated, research: drawResearch, cite: drawCite, source: drawSource })[tab]();
  }
  drawTab();

  return onChange(() => { const np = paperById(p.id); if (np) { p = np; $('pp-title').value = p.title; } });
}
