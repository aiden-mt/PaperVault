// Chat với nhiều paper. Bố cục ba cột: danh sách hội thoại · khung chat · bảng "Nguồn" (paper đang dùng + bộ chọn).
import { saveAnswerToNotebook } from '../notebook-save.js';
import { api } from '../api.js';
import { ATTACH_ACCEPT, kindOf, readAttachment, attachmentPayload, attachChipsHtml, MAX_ATTACH, msgFilesHtml, msgImgsHtml } from '../attach.js';
import { store, paperById, topicOf, inTopic, saveSettings } from '../store.js';
import { escapeHtml, fmtRelative, download, norm, copyText, clampText, debounce, fixMixedScript } from '../util.js';
import { $, toast, confirmDialog, mdToHtml, topicBadge, selectAllHtml, syncSelectAll, showProgress } from '../ui.js';
import { unverifiedNumbers } from '../quality.js';
import { streamChat, hasCredentials } from '../llm.js';
import { tokenize, chunksOf, bm25Pick, searchTerms } from '../rag.js';
import { buildChatSystem, paperNotesText, CHAT_LANGS, CHAT_LENGTHS } from '../prompts.js';
import { makeJob, trackJob } from '../bgjobs.js';
import { readableChatMd } from '../readable.js';
import { venueBadge, RANK_FILTERS, matchesRankFilter, rankSortKey } from '../venue.js';

const MODES = {
  notes: { label: 'Chỉ ghi chú', hint: 'Rẻ và nhanh. Dùng ghi chú đã trích xuất, ghi chú cá nhân và trích dẫn bạn đánh dấu.' },
  retrieval: { label: 'Ghi chú + đoạn liên quan', hint: 'Khuyên dùng. Mỗi câu hỏi tìm thêm các đoạn khớp nhất trong toàn văn.' },
  full: { label: 'Toàn văn', hint: 'Đầy đủ nhất, tốn token nhất. Với Claude, phần này được cache nên các câu sau rẻ hơn.' },
};
const SUGGESTIONS = [
  ['So sánh phương pháp', 'So sánh phương pháp của các paper này: điểm giống, điểm khác, ưu nhược điểm.'],
  ['Bảng dataset và kết quả', 'Lập bảng dataset, metric và kết quả chính của từng paper.'],
  ['Paper nào hợp đề tài của tôi?', 'Paper nào phù hợp nhất với đề tài của tôi? Vì sao?'],
  ['Hạn chế và khoảng trống', 'Những hạn chế chung và khoảng trống nghiên cứu mà các paper để lại là gì?'],
  ['Đề xuất thí nghiệm', 'Đề xuất một thí nghiệm kết hợp ý tưởng từ các paper này.'],
  ['Tóm tắt cho Related Work', 'Tóm tắt mỗi paper trong 2 câu để đưa vào phần Related Work.'],
];
const FULL_BUDGET = 600000;       // ký tự toàn văn tối đa cho chế độ Toàn văn
const RETRIEVAL_BUDGET = 24000;   // ký tự đoạn trích mỗi câu hỏi
const HAS_TEXT = 3000;            // từ ngưỡng này coi là có toàn văn
const state = {
  chat: null, abort: null, list: [], texts: new Map(),
  streaming: null,      // hội thoại đang nhận câu trả lời (vẫn chạy khi người dùng sang trang khác)
  picking: false, panelOpen: true,
  pick: { q: '', topic: '', rank: '', textOnly: false },
};

/* ================================================================ bản nháp khung hỏi */
// Chữ và tệp đính kèm chưa gửi, theo từng hội thoại (hội thoại mới chưa lưu dùng khoá "new"): sang trang khác, đổi hội thoại
// hoặc tắt app rồi quay lại vẫn còn. Ảnh và PDF đã nằm trong kho của app nên chỉ lưu tham chiếu; nháp quá 30 ngày thì bỏ.
const DRAFT_KEY = 'pv.chatDrafts';
const DRAFT_DAYS = 30;
const draftKey = (c) => c?.id || 'new';
function readDrafts() {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') || {};
    const cut = Date.now() - DRAFT_DAYS * 864e5;
    return Object.fromEntries(Object.entries(all).filter(([, d]) => d && (d.at || 0) > cut));
  } catch (_) { return {}; }
}
function writeDrafts(all) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(all)); return; } catch (_) { /* đầy: thử bỏ nội dung file chữ */ }
  try {
    const slim = Object.fromEntries(Object.entries(all).map(([k, d]) => [k, { ...d, attach: (d.attach || []).filter((a) => a.kind === 'image' || a.kind === 'pdf-scan') }]));
    localStorage.setItem(DRAFT_KEY, JSON.stringify(slim));
  } catch (_) { /* không lưu được: bỏ qua */ }
}
const getDraft = (c) => readDrafts()[draftKey(c)] || null;
function putDraft(key, text, attach) {
  const all = readDrafts();
  if (!String(text || '').trim() && !(attach || []).length) delete all[key];
  else all[key] = { text: String(text || ''), attach: (attach || []).map((a) => ({ ...a })), at: Date.now() };
  writeDrafts(all);
}

/* ================================================================ dữ liệu hội thoại */

function newChat(paperIds = []) {
  const c = { id: null, title: 'Cuộc trò chuyện mới', paperIds: [], labels: {}, nextLabel: 1, mode: 'retrieval', messages: [] };
  for (const id of paperIds) addPaper(c, id);
  return c;
}
function addPaper(c, id) {
  if (!paperById(id) || c.paperIds.includes(id)) return false;
  c.paperIds.push(id);
  if (!c.labels[id]) c.labels[id] = `P${c.nextLabel++}`;
  return true;
}
const papersOf = (c) => c.paperIds.map((id) => ({ p: paperById(id), label: c.labels[id], id })).filter((x) => x.p);
const hasText = (id) => (store.textLens?.[id] || 0) >= HAS_TEXT || (state.texts.get(id) || '').length >= HAS_TEXT;

async function ensureTexts(ids) {
  const missing = ids.filter((id) => !state.texts.has(id));
  await Promise.all(missing.map(async (id) => {
    try { state.texts.set(id, (await api.getText(id)).text || ''); } catch (_) { state.texts.set(id, ''); }
  }));
}

/* ================================================================ ngữ cảnh gửi model */

function corpusText(c) {
  const items = papersOf(c);
  const perPaper = items.length ? Math.floor(FULL_BUDGET / items.length) : 0;
  const parts = [`Tài liệu về ${items.length} paper người dùng đã chọn:`];
  for (const { p, label, id } of items) {
    let block = paperNotesText(p, label);
    if (c.mode === 'full') {
      const t = state.texts.get(id) || '';
      block += t ? `\nToàn văn:\n${clampText(t, perPaper)}` : '\n(Paper này chưa có toàn văn được lưu, chỉ có ghi chú.)';
    }
    parts.push(`${block}\n</paper>`);
  }
  return parts.join('\n\n');
}
const systemBlocks = (c) => [{ text: buildChatSystem(store.settings, { length: store.settings.chatLength || '' }) }, { text: corpusText(c), cache: true }];

/** BM25 trên các đoạn của toàn văn. Trả về [{ label, id, n, text }]. */
function retrieve(c, queryTerms) {
  const docs = [];
  for (const { label, id } of papersOf(c)) chunksOf(state.texts.get(id)).forEach((text, n) => docs.push({ key: id, label, id, n, text }));
  return bm25Pick(docs, queryTerms, { budget: RETRIEVAL_BUDGET, perKey: 4 })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }) || a.n - b.n);
}

async function composeUserTurn(c, question) {
  if (c.mode !== 'retrieval') return { sent: question, refs: [] };
  await ensureTexts(c.paperIds);
  let terms = await searchTerms(question, store.settings);
  const prevQ = [...c.messages].reverse().find((m) => m.role === 'user');
  if (prevQ && terms.length < 4) terms = terms.concat(tokenize(prevQ.content));
  const hits = retrieve(c, terms);
  if (!hits.length) return { sent: question, refs: [] };
  const excerpt = hits.map((h) => `<excerpt paper="${h.label}" part="${h.n + 1}">\n${h.text}\n</excerpt>`).join('\n');
  return {
    sent: `Các đoạn trích từ toàn văn có thể liên quan đến câu hỏi (tìm tự động, có thể thiếu):\n${excerpt}\n\nCâu hỏi: ${question}`,
    refs: hits.map((h) => ({ label: h.label, n: h.n + 1, preview: h.text.slice(0, 220) })),
  };
}

const estTokens = (chars) => Math.round(chars / 3.6);

/* ================================================================ render tin nhắn */

function citeLinks(html, c) {
  const byLabel = new Map(papersOf(c).map((x) => [x.label, x]));
  return html.replace(/\[((?:P\d+)(?:\s*[,;]\s*P\d+)*)\]/g, (m, inner) => inner.split(/\s*[,;]\s*/).map((lab) => {
    const x = byLabel.get(lab);
    return x ? `<a class="cite" href="#/paper/${x.id}" title="${escapeHtml(x.p.title)}">${lab}</a>` : `<span class="cite missing">${lab}</span>`;
  }).join(''));
}

const filesHtml = msgFilesHtml;
const imgsHtml = msgImgsHtml;

function messageHtml(m, i, c) {
  if (m.role === 'user') {
    return `<div class="msg q" data-i="${i}">${imgsHtml(m.images)}${filesHtml(m.files)}${m.imageOnly ? '' : escapeHtml(m.content).replace(/\n/g, '<br>')}${m.refs?.length ? `<details class="refs"><summary>Đã gửi kèm ${m.refs.length} đoạn trích từ toàn văn</summary>${m.refs.map((r) => `<div><b>${r.label} · đoạn ${r.n}</b> <span class="hint">${escapeHtml(r.preview)}…</span></div>`).join('')}</details>` : ''}</div>`;
  }
  const u = m.usage || {};
  const inT = (u.input_tokens ?? u.prompt_tokens ?? u.promptTokenCount ?? 0);
  const cacheR = (u.cache_read_input_tokens ?? u.prompt_tokens_details?.cached_tokens ?? u.cachedContentTokenCount ?? 0);
  const cacheW = (u.cache_creation_input_tokens ?? 0);
  const outT = (u.output_tokens ?? u.completion_tokens ?? u.candidatesTokenCount ?? 0);
  const f = (n) => n.toLocaleString('vi-VN');
  return `<div class="msg a ${m.error ? 'err' : ''}" data-i="${i}">
    <div class="md">${m.content ? citeLinks(mdToHtml(readableChatMd(m.content)), c) : (m.error ? '' : '<span class="spin"></span> Đang soạn câu trả lời…')}</div>
    ${m.error ? `<div class="status err">${escapeHtml(m.error)}</div><button class="sm" data-retry="${i}">Hỏi lại</button>` : ''}
    ${m.unverified?.length && !m.pending ? `<div class="msg-warn" title="Kiểm tra cơ học: các con số này không xuất hiện trong ghi chú, toàn văn hay đoạn trích đã gửi cho model">⚠ ${m.unverified.length} con số không thấy trong tài liệu đã gửi, nên đối chiếu lại: ${m.unverified.map((n) => `<b>${escapeHtml(n)}</b>`).join(', ')}</div>` : ''}
    ${m.content && !m.pending ? `<div class="msg-foot"><span class="hint">${escapeHtml(m.model || '')}${inT || outT ? ` · vào ${f(inT)}${cacheR ? ` · đọc cache ${f(cacheR)}` : ''}${cacheW ? ` · ghi cache ${f(cacheW)}` : ''} · ra ${f(outT)} token` : ''}${m.stopped ? ' · đã dừng' : ''}${m.truncated ? ' · bị cắt vì đạt giới hạn độ dài' : ''}</span><span class="spacer"></span><button class="ghost sm" data-save-nb="${i}" title="Chép câu trả lời này vào nhật ký hôm nay, một trang có sẵn hoặc trang mới">📓 Lưu vào Sổ tay</button><button class="ghost sm" data-copy="${i}">Copy</button></div>` : ''}
  </div>`;
}

/* ================================================================ bảng Nguồn */

function sourceCardHtml({ p, label, id }) {
  const t = hasText(id);
  return `<div class="src-card" data-id="${id}">
    <span class="src-label">${label}</span>
    <div class="src-body">
      <a class="src-title" href="#/paper/${id}" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</a>
      <div class="src-meta">${venueBadge(p.venueInfo, { compact: true })}${p.extraction?.year ? `<span>${escapeHtml(p.extraction.year)}</span>` : ''}
        <span class="src-text ${t ? 'yes' : 'no'}" title="${t ? 'Đã lưu toàn văn, dùng được cho chế độ đoạn liên quan và toàn văn' : 'Chưa có toàn văn, chatbot chỉ dùng ghi chú của paper này'}">${t ? '● toàn văn' : '○ chỉ ghi chú'}</span>
        ${p.needsExtraction ? '<span class="src-warn" title="Paper mới có thông tin cơ bản, chưa trích xuất ghi chú">chưa trích xuất</span>' : ''}</div>
    </div>
    <button class="ghost sm src-rm" data-rm="${id}" title="Bỏ paper này khỏi hội thoại" aria-label="Bỏ paper">✕</button>
  </div>`;
}

function pickerList() {
  const { q, topic, rank, textOnly } = state.pick;
  const nq = norm(q.trim());
  let list = store.papers.slice();
  if (topic) list = list.filter((p) => inTopic(p, topic));
  if (rank) list = list.filter((p) => matchesRankFilter(p, rank));
  if (textOnly) list = list.filter((p) => hasText(p.id));
  if (nq) list = list.filter((p) => norm(`${p.title} ${(p.extraction?.tags || []).join(' ')} ${(p.extraction?.authors || []).join(' ')} ${p.venueInfo?.acronym || ''} ${p.venueInfo?.name || ''}`).includes(nq));
  return list.sort((a, b) => Number(state.chat.paperIds.includes(b.id)) - Number(state.chat.paperIds.includes(a.id)) || rankSortKey(a) - rankSortKey(b));
}

function pickerHtml() {
  const c = state.chat;
  const list = pickerList();
  const { topic, rank, textOnly, q } = state.pick;
  const notIn = list.filter((p) => !c.paperIds.includes(p.id));
  const libSel = [...store.selected].filter((id) => paperById(id) && !c.paperIds.includes(id));
  return `<div class="picker">
    <input type="search" id="pk-q" placeholder="Tìm theo tên, tác giả, tag, venue…" value="${escapeHtml(q)}" autocomplete="off">
    <div class="pk-filters">
      <select id="pk-topic" aria-label="Lọc theo chủ đề"><option value="">Mọi chủ đề</option>${store.topics.map((t) => { const n = store.papers.filter((p) => inTopic(p, t.id)).length; return n ? `<option value="${t.id}" ${topic === t.id ? 'selected' : ''}>${escapeHtml(t.name)} (${n})</option>` : ''; }).join('')}</select>
      <select id="pk-rank" aria-label="Lọc theo hạng"><option value="">Mọi hạng</option>${RANK_FILTERS.map(([k, l]) => `<option value="${k}" ${rank === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="pk-check"><input type="checkbox" id="pk-text" ${textOnly ? 'checked' : ''}> có toàn văn</label>
    </div>
    <div class="pk-quick">
      ${libSel.length ? `<button class="sm" data-pk="lib">＋ ${libSel.length} paper đang tick ở Thư viện</button>` : ''}
    </div>
    ${list.length ? `<div class="sel-bar compact pk-selbar">${selectAllHtml('pk-all', (topic || rank || textOnly || q) ? `Chọn tất cả ${list.length} kết quả` : 'Chọn tất cả')}<span class="hint" style="margin:0">${list.length - notIn.length}/${list.length} đã chọn</span></div>` : ''}
    <div class="pk-list" role="listbox" aria-multiselectable="true">
      ${list.map((p) => {
        const on = c.paperIds.includes(p.id);
        return `<label class="pk-row ${on ? 'on' : ''}" role="option" aria-selected="${on}"><input type="checkbox" data-pick="${p.id}" ${on ? 'checked' : ''}>
          <span class="pk-body"><span class="pk-title">${escapeHtml(p.title)}</span>
          <span class="src-meta">${venueBadge(p.venueInfo, { compact: true })}${p.extraction?.year ? `<span>${escapeHtml(p.extraction.year)}</span>` : ''}${topicBadge(topicOf(p))}<span class="src-text ${hasText(p.id) ? 'yes' : 'no'}">${hasText(p.id) ? '● toàn văn' : '○ ghi chú'}</span></span></span></label>`;
      }).join('') || '<div class="hint" style="padding:10px">Không có paper nào khớp bộ lọc.</div>'}
    </div>
    <div class="pk-foot"><span class="hint">${c.paperIds.length} paper trong hội thoại</span><span class="spacer"></span><button class="primary sm" data-pk="done">Xong</button></div>
  </div>`;
}

function panelHtml() {
  const c = state.chat;
  const items = papersOf(c);
  if (state.picking) {
    return `<div class="src-head"><b>Thêm paper</b><span class="spacer"></span><button class="ghost sm" data-pk="done" aria-label="Đóng">✕</button></div>${pickerHtml()}`;
  }
  const noText = items.filter((x) => !hasText(x.id)).length;
  return `<div class="src-head"><b>Nguồn</b><span class="src-count">${items.length} paper</span><span class="spacer"></span><button class="sm" data-pk="open">＋ Thêm</button></div>
    <div class="src-mode">
      <label class="label-text" for="ch-mode">Mức ngữ cảnh gửi cho AI</label>
      <select id="ch-mode">${Object.entries(MODES).map(([k, m]) => `<option value="${k}" ${c.mode === k ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
      <div class="hint" id="ch-info">${escapeHtml(MODES[c.mode].hint)}</div>
      <label class="label-text" for="ch-lang" style="margin-top:10px">Ngôn ngữ trả lời</label>
      <select id="ch-lang" title="Áp dụng cho mọi cuộc trò chuyện và tab Hỏi đáp của từng paper">${CHAT_LANGS.map(([k, l]) => `<option value="${k}" ${(store.settings.chatLang || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${c.mode !== 'notes' && noText ? `<div class="src-alert">${noText} paper chưa có toàn văn nên chỉ dùng ghi chú.</div>` : ''}
    </div>
    <div class="src-list">${items.map(sourceCardHtml).join('') || '<div class="hint" style="padding:12px">Chưa có paper nào. Bấm “＋ Thêm”.</div>'}</div>
    ${items.length ? `<div class="src-foot hint">Ngữ cảnh cố định khoảng <b>${estTokens(corpusText(c).length).toLocaleString('vi-VN')}</b> token${c.mode === 'retrieval' ? ', thêm tối đa khoảng 6.700 token đoạn trích mỗi câu hỏi' : ''}.</div>` : ''}`;
}

/* ================================================================ màn hình bắt đầu */

function startHtml() {
  const libSel = [...store.selected].filter((id) => paperById(id));
  const topics = store.topics.map((t) => ({ t, n: store.papers.filter((p) => inTopic(p, t.id)).length })).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, 12);
  return `<div class="chat-start">
    <h2>Chọn paper để bắt đầu</h2>
    <p class="hint">Chatbot chỉ trả lời dựa trên các paper bạn chọn và gắn nguồn [P1], [P2] cho từng ý, bấm vào để mở paper.</p>
    <div class="start-grid">
      ${libSel.length ? `<button class="start-card primary-card" data-start="lib"><b>Dùng ${libSel.length} paper đang chọn</b><span>Các paper bạn đã tick trong Thư viện hoặc trang So sánh.</span></button>` : ''}
      <button class="start-card" data-start="pick"><b>Tìm và chọn từng paper</b><span>Lọc theo tên, chủ đề, hạng venue, paper có toàn văn.</span></button>
      <div class="start-card topics-card"><b>Chọn cả một chủ đề</b><span>Thêm toàn bộ paper của chủ đề, có thể bỏ bớt ở bảng Nguồn.</span>
        <div class="start-topics">${topics.map(({ t, n }) => `<button class="chip-btn" data-start-topic="${t.id}" title="${escapeHtml(t.name)}"><i style="background:${escapeHtml(t.color || '#888')}"></i>${escapeHtml(t.name)} <span>${n}</span></button>`).join('') || '<span class="hint">Thư viện chưa có paper.</span>'}</div></div>
    </div>
  </div>`;
}

/* ================================================================ trang */

export async function render(root, { params, query }) {
  root.className = 'view split';
  const fromIds = (query.get('ids') || '').split(',').filter(Boolean);
  if (params[0] && state.streaming?.id === params[0]) {
    state.chat = state.streaming;
  } else if (params[0]) {
    try { state.chat = await api.chat(params[0]); } catch (_) { state.chat = newChat(); }
  } else if (fromIds.length || query.get('new')) {
    state.chat = newChat(fromIds);
  } else if (!state.chat) {
    state.chat = newChat();
  }
  state.picking = false;
  // Khung hẹp (≤ 1000px, ví dụ một nửa màn hình chia đôi): bảng Nguồn là ngăn trượt đè lên khung chat, mặc định đóng.
  const narrow = () => window.matchMedia('(max-width: 1000px)').matches;
  if (narrow()) state.panelOpen = false;

  root.innerHTML = `<div class="chat-page ${state.panelOpen ? '' : 'no-panel'}">
    <div class="ch-scrim" id="ch-scrim" title="Đóng"></div>
    <aside class="chat-side">
      <div class="side-head"><span>Hội thoại</span><button id="ch-new" class="ghost sm" title="Hội thoại mới">＋ Mới</button></div>
      <div id="ch-list" class="chat-list"></div>
    </aside>
    <section class="chat-main">
      <div class="chat-head"><button id="ch-history" class="sm" title="Danh sách hội thoại">☰ Hội thoại</button><input id="ch-title" class="title-input" placeholder="Tên hội thoại" aria-label="Tên hội thoại">
        <button id="ch-toggle" class="sm" title="Hiện / ẩn bảng Nguồn"></button><button id="ch-export" class="sm">Xuất .md</button><button id="ch-del" class="sm danger">Xoá</button></div>
      <div id="ch-msgs" class="chat-msgs"></div>
      <div class="chat-compose" id="ch-compose">
        <div id="ch-suggest" class="suggest-q"></div>
        <div class="chat-input"><textarea id="ch-q" rows="2" placeholder="Hỏi về các paper đã chọn… (Enter để gửi, Shift+Enter xuống dòng)"></textarea>
          <button id="ch-send" class="primary">Gửi</button><button id="ch-stop" class="sm danger" hidden>Dừng</button></div>
        <div class="ch-att-row"><button type="button" class="sm ghost" id="ch-attach" title="Đính kèm ảnh (hình, biểu đồ, ảnh chụp màn hình) hoặc file (PDF, .txt, .md, .csv, .json, .tex, .bib, code…). Cũng có thể dán Ctrl+V hoặc kéo thả vào đây.">📎 Đính kèm</button><input type="file" id="ch-file" accept="${ATTACH_ACCEPT}" multiple hidden><div id="ch-att" class="ch-att"></div><span class="hint ch-att-hint">Dán (Ctrl+V) hoặc kéo thả ảnh, PDF, file chữ vào khung hỏi</span>
          <label class="ch-len" title="Độ dài câu trả lời. Tự động: câu hỏi ngắn thì trả lời ngắn, xin tóm tắt thì gạch đầu dòng, xin chi tiết thì viết đầy đủ."><span>Độ dài</span><select id="ch-len">${CHAT_LENGTHS.map(([v, l]) => `<option value="${v}" ${(store.settings.chatLength || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      </div>
    </section>
    <aside class="src-panel" id="ch-panel" aria-label="Nguồn của hội thoại"></aside>
  </div>`;
  const page = root.querySelector('.chat-page');

  const drawList = async () => {
    try { state.list = await api.chats(); } catch (_) { state.list = []; }
    if (!$('ch-list')) return;
    $('ch-list').innerHTML = state.list.map((c) => `<div class="chat-item ${state.chat?.id === c.id ? 'active' : ''}" data-id="${c.id}">
      <div class="t">${escapeHtml(c.title || '(không tên)')}</div><div class="hint">${c.paperIds.length} paper · ${c.turns} câu hỏi · ${fmtRelative(c.updatedAt)}</div>
      <button class="ghost sm del" data-del="${c.id}" title="Xoá hội thoại" aria-label="Xoá">✕</button></div>`).join('') || '<div class="hint" style="padding:8px 12px">Chưa có hội thoại nào được lưu.</div>';
  };

  const drawPanel = () => {
    const panel = $('ch-panel');
    if (!panel) return;
    const keepQ = document.activeElement?.id === 'pk-q';
    const pos = keepQ ? document.activeElement.selectionStart : 0;
    const listScroll = panel.querySelector('.pk-list, .src-list')?.scrollTop || 0;
    panel.innerHTML = panelHtml();
    if ($('pk-all')) {
      const ids = pickerList().map((p) => p.id);
      syncSelectAll($('pk-all'), ids.length, ids.filter((id) => state.chat.paperIds.includes(id)).length);
    }
    const sc = panel.querySelector('.pk-list, .src-list');
    if (sc) sc.scrollTop = listScroll;
    if (keepQ || (state.picking && !document.activeElement?.closest?.('#ch-panel'))) {
      const inp = $('pk-q');
      if (inp) { inp.focus(); inp.setSelectionRange(pos || inp.value.length, pos || inp.value.length); }
    }
    $('ch-toggle').textContent = state.panelOpen ? 'Ẩn nguồn' : `📚 Nguồn (${state.chat.paperIds.length})`;
  };

  const drawMsgs = (keepScroll = false) => {
    const c = state.chat;
    const box = $('ch-msgs');
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (!c.paperIds.length && !c.messages.length) {
      box.innerHTML = startHtml();
      $('ch-compose').hidden = true;
      return;
    }
    $('ch-compose').hidden = false;
    box.innerHTML = c.messages.length
      ? c.messages.map((m, i) => messageHtml(m, i, c)).join('')
      : `<div class="chat-ready"><b>Sẵn sàng hỏi về ${c.paperIds.length} paper.</b><span class="hint">Chọn một câu gợi ý bên dưới hoặc tự đặt câu hỏi. Có thể thêm hoặc bỏ paper ở bảng Nguồn bất cứ lúc nào.</span>${!hasCredentials(store.settings, 'chat') ? '<span class="status err">Chưa có API key. <a href="#/settings">Mở Cài đặt</a>.</span>' : ''}</div>`;
    c.messages.forEach((m, i) => {
      if (!m.pending || m.content || !m.stage) return;
      const node = box.querySelector(`.msg[data-i="${i}"] .md`);
      if (node) showProgress(node, m.stage.label, { expectedMs: m.stage.ms, startedAt: Date.parse(m.at) });
    });
    const busy = !!state.abort && state.streaming === c;
    if ($('ch-send')) { $('ch-send').hidden = busy; $('ch-stop').hidden = !busy; }
    $('ch-suggest').innerHTML = c.messages.length ? '' : SUGGESTIONS.map(([label, q]) => `<button data-q="${escapeHtml(q)}" title="${escapeHtml(q)}">${escapeHtml(label)}</button>`).join('');
    if (!keepScroll || nearBottom) box.scrollTop = box.scrollHeight;
  };

  // c: hội thoại cần lưu (mặc định hội thoại đang mở; câu trả lời viết xong có thể thuộc hội thoại người dùng đã rời).
  const persist = async (c = state.chat) => {
    if (!c.messages.length && !c.id && !c.paperIds.length) return;
    const saved = await api.putChat({ ...c, messages: c.messages.map(({ pending, stage, ...m }) => m) });
    c.id = saved.id;
    c.createdAt = saved.createdAt;
    // Chỉ sửa địa chỉ khi người dùng vẫn đang xem đúng hội thoại này trong trang Chat.
    if (state.chat === c && location.hash.startsWith('#/chat') && !location.hash.startsWith(`#/chat/${c.id}`)) history.replaceState(null, '', `#/chat/${c.id}`);
    if ($('ch-list')) drawList();
  };
  const persistSoon = debounce(() => persist().catch(() => {}), 600);

  let draftReady = false; // khung hỏi đã dựng xong (khôi phục nháp được)
  const drawAll = async () => {
    if (draftReady) restoreDraft();
    $('ch-title').value = state.chat.title || '';
    page.classList.toggle('no-panel', !state.panelOpen);
    if (state.chat.mode !== 'notes') ensureTexts(state.chat.paperIds).then(() => { drawPanel(); });
    drawPanel();
    drawMsgs();
    drawList();
  };
  drawAll();

  /* ---- thay đổi tập paper ---- */
  const setPapers = (mutator) => {
    const c = state.chat;
    mutator(c);
    drawPanel();
    drawMsgs(true);
    persistSoon();
    if (c.mode !== 'notes') ensureTexts(c.paperIds).then(drawPanel);
  };

  /* ---- gửi câu hỏi ---- */
  async function ask(question, { retryIndex = null } = {}) {
    const c = state.chat;
    question = (question || '').trim();
    const prev = retryIndex != null ? c.messages[retryIndex - 1] : null;
    const images = prev ? (prev.images || []) : attach.filter((a) => a.kind === 'image').map(({ url, name, mime }) => ({ url, name, mime }));
    const files = prev ? (prev.files || []) : attach.filter((a) => a.kind !== 'image').map((a) => ({ ...a }));
    if (attachBusy) return toast('Đang xử lý tệp đính kèm, chờ một chút rồi gửi.', 2500);
    if (!question && !images.length && !files.length) return;
    const imageOnly = !question;
    if (imageOnly) {
      const what = [images.length ? (images.length > 1 ? 'các ảnh' : 'ảnh') : '', files.length ? (files.length > 1 ? 'các file' : 'file') : ''].filter(Boolean).join(' và ');
      question = `Tóm tắt và giải thích ${what} đính kèm${c.paperIds.length ? ', liên hệ với các paper đã chọn' : ''}.`;
    }
    if (state.abort) return toast(state.streaming === c ? 'Đang trả lời câu trước, chờ xong hoặc bấm Dừng.' : 'Đang trả lời ở một hội thoại khác, chờ xong rồi hỏi tiếp.', 3500);
    if (!c.paperIds.length && !images.length && !files.length) { toast('Chọn ít nhất một paper trước (hoặc đính kèm ảnh / file để hỏi về chúng).', 3000, 'err'); state.picking = true; state.panelOpen = true; drawAll(); return; }
    if (!hasCredentials(store.settings, 'chat')) return toast('Chưa có API key. Mở Cài đặt.', 3000, 'err');
    if (retryIndex != null) c.messages.splice(retryIndex - 1, 2);
    if (!c.messages.length && (!c.title || c.title === 'Cuộc trò chuyện mới')) { c.title = question.slice(0, 70); $('ch-title').value = c.title; }
    $('ch-q').value = '';
    const userMsg = { role: 'user', content: question, at: new Date().toISOString(), ...(images.length ? { images } : {}), ...(files.length ? { files } : {}), ...(imageOnly ? { imageOnly: true } : {}) };
    if (retryIndex == null) { attach.length = 0; drawAttach(); }
    const ans = { role: 'assistant', content: '', pending: true, at: new Date().toISOString() };
    c.messages.push(userMsg, ans);
    const idx = c.messages.length - 1; // cố định vị trí bong bóng của lượt này
    // Thanh tiến độ trong bong bóng trả lời cho tới khi chữ đầu tiên về (lúc đó nội dung thay chỗ thanh).
    const startedAt = Date.parse(ans.at);
    // Thẻ ở bảng nổi khi người dùng sang trang khác: câu trả lời vẫn viết tiếp và được lưu vào hội thoại.
    const job = makeJob();
    trackJob('chat:answer', job, { label: 'Chat với paper', title: c.title || '', href: () => (c.id ? `#/chat/${c.id}` : '#/chat'), here: () => location.hash.startsWith('#/chat'), expectedMs: () => 15000 });
    const pendingBar = (label, expectedMs) => {
      ans.stage = { label, ms: expectedMs };
      job.update(label);
      const node = state.chat === c && !ans.content && $('ch-msgs')?.querySelector(`.msg[data-i="${idx}"] .md`);
      if (node) showProgress(node, label, { expectedMs, startedAt });
    };
    drawMsgs();
    pendingBar(c.mode !== 'notes' ? 'Đang tìm đoạn liên quan trong paper…' : 'Đang chuẩn bị ngữ cảnh…', 8000);
    state.abort = new AbortController();
    state.streaming = c;
    $('ch-send').hidden = true;
    $('ch-stop').hidden = false;
    let raf = 0;
    const paint = () => {
      raf = 0;
      if (state.chat !== c) return;
      const node = $('ch-msgs')?.querySelector(`.msg[data-i="${idx}"] .md`);
      if (node) node.innerHTML = citeLinks(mdToHtml(readableChatMd(ans.content)), c);
      const box = $('ch-msgs');
      if (box && box.scrollHeight - box.scrollTop - box.clientHeight < 160) box.scrollTop = box.scrollHeight;
    };
    try {
      if (c.mode !== 'notes') await ensureTexts(c.paperIds);
      const { sent, refs } = await composeUserTurn(c, question);
      // Nội dung file chữ đính kèm đi trước câu hỏi (lưu trong lượt hỏi để các câu hỏi tiếp theo vẫn có).
      const textFiles = files.filter((f) => f.text);
      userMsg.sent = textFiles.length
        ? `Người dùng đính kèm ${textFiles.length} file:\n${textFiles.map((f) => `<file name="${f.name}">\n${f.text}\n</file>`).join('\n')}\n\n${sent}`
        : sent;
      userMsg.refs = refs;
      drawMsgs(true);
      pendingBar('Đang chờ mô hình trả lời…', 12000);
      const history = c.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.role === 'user' ? (m.sent || m.content) : m.content, imgs: m.role === 'user' ? [...(m.images || []), ...(m.files || []).filter((f) => f.kind === 'pdf-scan')] : null })).filter((m) => m.content);
      // Ảnh của các lượt hỏi gửi lại kèm lượt đó (model không nhớ ảnh giữa các lượt); tối đa 12 ảnh gần nhất cho đỡ tốn token.
      let budget = 12;
      for (let k = history.length - 1; k >= 0; k--) {
        const list = history[k].imgs || [];
        delete history[k].imgs;
        if (!list.length || budget <= 0) continue;
        const use = list.slice(0, budget);
        budget -= use.length;
        if (k === history.length - 1) pendingBar(`Đang chuẩn bị ${use.length} tệp đính kèm…`, 3000);
        history[k].images = (await Promise.all(use.map(imagePayload))).filter(Boolean);
      }
      const out = await streamChat({
        settings: store.settings, system: systemBlocks(c), messages: history, signal: state.abort.signal,
        onText: (t) => { if (!ans.content) job.update('Đang viết câu trả lời…'); ans.content += t; if (!raf) raf = requestAnimationFrame(paint); },
        onRetry: (n, wait) => { ans.content = ''; const node = state.chat === c && $('ch-msgs')?.querySelector(`.msg[data-i="${idx}"] .md`); if (node) node.innerHTML = `<span class="spin"></span> Bị giới hạn tốc độ, thử lại lần ${n} sau ${Math.round(wait / 1000)}s…`; },
      });
      ans.content = fixMixedScript(ans.content);
      ans.model = out.model;
      ans.usage = out.usage;
      ans.truncated = out.stopReason === 'max_tokens';
      // Mọi con số trong câu trả lời phải có trong tài liệu đã gửi (ghi chú, toàn văn, đoạn trích) hoặc trong câu hỏi.
      const sentAll = c.messages.filter((m) => m.role === 'user').map((m) => m.sent || m.content).join('\n');
      // Lượt có ảnh: số liệu có thể đọc từ ảnh nên không đối chiếu được với tài liệu chữ.
      ans.unverified = userMsg.images?.length || files.some((f) => f.kind === 'pdf-scan') ? [] : unverifiedNumbers(ans.content, `${corpusText(c)}\n${sentAll}`).slice(0, 12);
    } catch (e) {
      if (e.name === 'AbortError') ans.stopped = true;
      else ans.error = e.message;
    } finally {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      delete ans.pending;
      delete ans.stage;
      if (!ans.content && !ans.error) ans.error = ans.stopped ? 'Đã dừng trước khi có nội dung.' : 'Không nhận được nội dung.';
      state.abort = null;
      state.streaming = null;
      if ($('ch-send')) $('ch-send').hidden = false;
      if ($('ch-stop')) $('ch-stop').hidden = true;
      if ($('ch-msgs') && state.chat === c) drawMsgs(true);
      await persist(c).catch((err) => toast(`Không lưu được hội thoại: ${err.message}`, 4000, 'err'));
      job.finish(ans.stopped ? '' : (ans.error || ''));
    }
  }

  /* ---- ảnh đính kèm ---- */
  // Chờ gửi cùng câu hỏi tiếp theo: ảnh { kind: 'image', url, name, mime }, file chữ { kind: 'text' | 'pdf', name, text, chars },
  // PDF không có lớp chữ (bản scan) { kind: 'pdf-scan', name, pdfId } gửi nguyên file cho model.
  const attach = [];
  let attachBusy = false;
  let shownChat = null; // hội thoại có bản nháp đang hiện trong khung hỏi (id có sau lần gửi đầu, nên giữ chính đối tượng)
  function drawAttach() {
    const box = $('ch-att');
    if (!box) return;
    box.innerHTML = attachChipsHtml(attach, attachBusy);
    $('ch-compose')?.classList.toggle('has-att', attach.length > 0 || attachBusy);
    saveDraft();
  }
  function saveDraft() {
    const q = $('ch-q');
    if (!q || !shownChat) return;
    putDraft(draftKey(shownChat), q.value, attach);
  }
  function restoreDraft() {
    if (state.chat === shownChat) return;
    saveDraft(); // giữ nháp của hội thoại vừa rời
    shownChat = state.chat;
    const d = getDraft(state.chat);
    $('ch-q').value = d?.text || '';
    attach.length = 0;
    attach.push(...(d?.attach || []));
    drawAttach();
  }

  async function addImages(files) {
    const list = [...files];
    const bad = list.filter((f) => !kindOf(f));
    if (bad.length) toast(`Chưa đọc được: ${bad.map((f) => f.name).join(', ')}. Nhận ảnh (PNG, JPG, GIF, WebP), PDF và file chữ (.txt, .md, .csv, .json, .tex, .bib, code…). File Word hãy lưu thành PDF trước.`, 6000, 'err');
    const ok = list.filter((f) => kindOf(f));
    if (!ok.length) return;
    const room = MAX_ATTACH - attach.length;
    if (room <= 0) return toast(`Mỗi câu hỏi đính kèm tối đa ${MAX_ATTACH} tệp.`, 3000);
    const key0 = draftKey(shownChat);
    const box0 = $('ch-att');
    if (ok.length > room) toast(`Chỉ thêm ${room} tệp đầu (tối đa ${MAX_ATTACH} tệp mỗi câu hỏi).`, 3000);
    try {
      for (const f of ok.slice(0, room)) {
        const kind = kindOf(f);
        attachBusy = kind === 'image' ? 'Đang xử lý ảnh…' : `Đang đọc ${f.name}…`;
        drawAttach();
        const it = await readAttachment(f);
        if (it) attach.push(it);
        // Đã rời trang Chat trong lúc đọc tệp: khung hỏi này không còn, ghi thẳng vào nháp của hội thoại đó.
        if (!box0.isConnected) { if (it) { const d = readDrafts()[key0]; putDraft(key0, d?.text || '', [...(d?.attach || []), it]); } continue; }
        drawAttach();
      }
    } catch (e) {
      toast(`Không thêm được tệp: ${e.message}`, 4000, 'err');
    } finally {
      attachBusy = false;
      drawAttach();
      $('ch-q')?.focus();
    }
  }
  const imagePayload = attachmentPayload;
  $('ch-attach').addEventListener('click', () => $('ch-file').click());
  $('ch-file').addEventListener('change', (e) => { addImages(e.target.files); e.target.value = ''; });
  $('ch-att').addEventListener('click', (e) => { const b = e.target.closest('[data-rm-att]'); if (b) { attach.splice(Number(b.dataset.rmAtt), 1); drawAttach(); } });
  $('ch-q').addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    addImages(files);
  });
  const compose = $('ch-compose');
  const hasImg = (e) => [...(e.dataTransfer?.items || [])].some((it) => it.kind === 'file');
  compose.addEventListener('dragover', (e) => { if (!hasImg(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; compose.classList.add('drop'); });
  compose.addEventListener('dragleave', (e) => { if (!compose.contains(e.relatedTarget)) compose.classList.remove('drop'); });
  compose.addEventListener('drop', (e) => { compose.classList.remove('drop'); if (!e.dataTransfer?.files?.length) return; e.preventDefault(); addImages(e.dataTransfer.files); });
  // Bấm ảnh trong tin nhắn để phóng to.
  $('ch-msgs').addEventListener('click', (e) => {
    const img = e.target.closest('.msg-imgs img[data-zoom]');
    if (!img) return;
    const ov = document.createElement('div');
    ov.className = 'hp-lb';
    ov.innerHTML = `<img src="${img.getAttribute('src')}" alt=""><div class="hp-lb-cap">${escapeHtml(img.alt)} · bấm để đóng</div>`;
    const close = () => { ov.remove(); document.removeEventListener('keydown', onEsc, true); };
    const onEsc = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
    ov.addEventListener('click', close);
    document.addEventListener('keydown', onEsc, true);
    document.body.appendChild(ov);
  });

  /* ---- sự kiện: khung chat ---- */
  $('ch-send').addEventListener('click', () => ask($('ch-q').value));
  $('ch-len').addEventListener('change', async (e) => {
    await saveSettings({ chatLength: e.target.value });
    toast({ '': 'Độ dài tự co giãn theo câu hỏi.', short: 'Câu trả lời sẽ ngắn gọn.', long: 'Câu trả lời sẽ chi tiết.' }[e.target.value], 2000, 'ok');
  });
  $('ch-q').addEventListener('input', debounce(saveDraft, 250));
  $('ch-stop').addEventListener('click', () => state.abort?.abort());
  $('ch-q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask($('ch-q').value); } });
  $('ch-suggest').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) ask(b.dataset.q); });
  $('ch-msgs').addEventListener('click', async (e) => {
    const cp = e.target.closest('[data-copy]');
    if (cp) { await copyText(state.chat.messages[Number(cp.dataset.copy)].content); toast('Đã copy.'); return; }
    const sv = e.target.closest('[data-save-nb]');
    if (sv) {
      const c = state.chat;
      const i = Number(sv.dataset.saveNb);
      const used = new Set([...String(c.messages[i].content).matchAll(/\bP\d+\b/g)].map((m) => m[0]));
      const ps = papersOf(c);
      saveAnswerToNotebook({
        question: c.messages[i - 1]?.content || '', answer: c.messages[i].content, from: 'Chat với paper',
        labels: new Map(ps.map((x) => [x.label, x.id])),
        // Dòng nguồn: paper được trích trong câu trả lời; không trích paper nào thì ghi các paper của cuộc trò chuyện (tối đa 5).
        paperIds: (ps.some((x) => used.has(x.label)) ? ps.filter((x) => used.has(x.label)) : ps).slice(0, 5).map((x) => x.id),
      });
      return;
    }
    const rt = e.target.closest('[data-retry]');
    if (rt) { const i = Number(rt.dataset.retry); ask(state.chat.messages[i - 1]?.content, { retryIndex: i }); return; }
    // màn hình bắt đầu
    const st = e.target.closest('[data-start]');
    if (st?.dataset.start === 'lib') setPapers((c) => { for (const id of store.selected) addPaper(c, id); });
    if (st?.dataset.start === 'pick') { state.picking = true; state.panelOpen = true; page.classList.remove('no-panel'); drawPanel(); }
    const tp = e.target.closest('[data-start-topic]');
    if (tp) setPapers((c) => { for (const p of store.papers) if (inTopic(p, tp.dataset.startTopic)) addPaper(c, p.id); });
  });
  $('ch-title').addEventListener('change', (e) => { state.chat.title = e.target.value.trim() || 'Cuộc trò chuyện mới'; persistSoon(); });
  $('ch-history').addEventListener('click', () => page.classList.toggle('show-history'));
  $('ch-msgs').addEventListener('pointerdown', () => page.classList.remove('show-history'));
  $('ch-toggle').addEventListener('click', () => { state.panelOpen = !state.panelOpen; page.classList.toggle('no-panel', !state.panelOpen); drawPanel(); });
  const chMq = window.matchMedia('(max-width: 1000px)');
  const onChMq = (ev) => { if (ev.matches && state.panelOpen) { state.panelOpen = false; state.picking = false; page.classList.add('no-panel'); drawPanel(); } page.classList.remove('show-history'); };
  chMq.addEventListener('change', onChMq);
  $('ch-scrim').addEventListener('click', () => {
    page.classList.remove('show-history');
    if (narrow() && state.panelOpen) { state.panelOpen = false; state.picking = false; page.classList.add('no-panel'); drawPanel(); }
  });

  /* ---- sự kiện: bảng Nguồn + bộ chọn ---- */
  const panel = $('ch-panel');
  panel.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { e.preventDefault(); setPapers((c) => { c.paperIds = c.paperIds.filter((x) => x !== rm.dataset.rm); }); return; }
    const pk = e.target.closest('[data-pk]');
    if (!pk) return;
    const act = pk.dataset.pk;
    if (act === 'open') { state.picking = true; drawPanel(); }
    else if (act === 'done') { state.picking = false; drawPanel(); }
    else if (act === 'lib') setPapers((c) => { for (const id of store.selected) addPaper(c, id); });
  });
  // Như Gmail: đã chọn một phần hoặc tất cả kết quả thì bấm sẽ bỏ chọn chúng, chưa chọn gì thì thêm hết.
  panel.addEventListener('click', (e) => {
    if (e.target.id !== 'pk-all') return;
    const ids = pickerList().map((p) => p.id);
    setPapers((c) => {
      if (ids.some((id) => c.paperIds.includes(id))) c.paperIds = c.paperIds.filter((x) => !ids.includes(x));
      else for (const id of ids) addPaper(c, id);
    });
  });
  panel.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-pick]');
    if (cb) {
      setPapers((c) => { if (cb.checked) addPaper(c, cb.dataset.pick); else c.paperIds = c.paperIds.filter((x) => x !== cb.dataset.pick); });
      return;
    }
    if (e.target.id === 'pk-topic') { state.pick.topic = e.target.value; drawPanel(); }
    else if (e.target.id === 'pk-rank') { state.pick.rank = e.target.value; drawPanel(); }
    else if (e.target.id === 'pk-text') { state.pick.textOnly = e.target.checked; drawPanel(); }
    else if (e.target.id === 'ch-lang') {
      saveSettings({ chatLang: e.target.value }).then(() => toast(`Từ câu hỏi tới, AI trả lời ${({ '': 'theo ngôn ngữ trích xuất', auto: 'theo ngôn ngữ câu hỏi', vi: 'bằng tiếng Việt', en: 'bằng tiếng Anh' })[e.target.value]}.`));
    }
    else if (e.target.id === 'ch-mode') {
      state.chat.mode = e.target.value;
      if (state.chat.mode !== 'notes') ensureTexts(state.chat.paperIds).then(drawPanel);
      drawPanel();
      persistSoon();
    }
  });
  const onSearch = debounce(() => drawPanel(), 120);
  panel.addEventListener('input', (e) => { if (e.target.id === 'pk-q') { state.pick.q = e.target.value; onSearch(); } });
  panel.addEventListener('keydown', (e) => { if (e.target.id === 'pk-q' && e.key === 'Escape') { e.stopPropagation(); state.picking = false; drawPanel(); } });

  /* ---- sự kiện: danh sách hội thoại + đầu trang ---- */
  $('ch-new').addEventListener('click', () => {
    if (state.abort) return;
    state.chat = newChat();
    state.picking = false;
    page.classList.remove('show-history');
    history.replaceState(null, '', '#/chat?new=1');
    drawAll();
  });
  $('ch-list').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      if (!(await confirmDialog('Xoá hội thoại này?', { danger: true, okLabel: 'Xoá' }))) return;
      await api.deleteChat(del.dataset.del);
      if (state.chat?.id === del.dataset.del) state.chat = newChat();
      drawAll();
      return;
    }
    const item = e.target.closest('[data-id]');
    if (!item || state.abort) return;
    state.chat = await api.chat(item.dataset.id);
    state.picking = false;
    page.classList.remove('show-history');
    history.replaceState(null, '', `#/chat/${state.chat.id}`);
    drawAll();
  });
  $('ch-del').addEventListener('click', async () => {
    const c = state.chat;
    if (c.id && !(await confirmDialog('Xoá hội thoại này?', { danger: true, okLabel: 'Xoá' }))) return;
    if (c.id) await api.deleteChat(c.id);
    state.chat = newChat();
    history.replaceState(null, '', '#/chat?new=1');
    drawAll();
  });
  $('ch-export').addEventListener('click', () => {
    const c = state.chat;
    const md = [`# ${c.title}`, '', '## Paper', '', ...papersOf(c).map(({ p, label }) => `- **[${label}]** ${p.title}${p.url ? ` (${p.url})` : ''}`), '', '## Hội thoại', ''];
    for (const m of c.messages) md.push(m.role === 'user' ? `### Hỏi\n\n${(m.images || []).map((im) => `![${im.name || 'ảnh'}](${location.origin}${im.url})\n`).join('')}${(m.files || []).map((f) => `- 📄 ${f.name}\n`).join('')}${m.content}\n` : `### Trả lời\n\n${m.content || m.error || ''}\n`);
    download(`chat-${(c.title || 'papervault').slice(0, 40).replace(/[^\p{L}\p{N}]+/gu, '-')}.md`, md.join('\n'), 'text/markdown;charset=utf-8');
  });

  draftReady = true;
  restoreDraft();

  // Rời trang Chat không huỷ câu trả lời đang viết: nó chạy tiếp, xong thì lưu vào hội thoại (bảng nổi báo tiến độ).
  // Chữ đang soạn được lưu thành nháp để quay lại vẫn còn.
  return () => { saveDraft(); chMq.removeEventListener('change', onChMq); };
}
