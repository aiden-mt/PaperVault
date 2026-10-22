// Trợ lý AI trong Sổ tay: hỏi và viết dựa trên nguồn người dùng chọn (paper trong thư viện, trang ghi chú trong Sổ tay),
// giống RAG: ghi chú của paper luôn được gửi, mỗi câu hỏi tìm thêm đoạn khớp nhất trong toàn văn (BM25), và có thể tự tìm
// thêm paper liên quan trong thư viện. Câu trả lời gắn nhãn [P1] / [N1], khi chèn vào trang thành liên kết [[@paper]] / [[trang]].
import { api } from './api.js';
import { store, paperById } from './store.js';
import { dialog, toast } from './ui.js';
import { escapeHtml, clampText, fixMixedScript, copyText, norm } from './util.js';
import { streamChat, hasCredentials } from './llm.js';
import { buildChatSystem, paperNotesText, CHAT_LANGS } from './prompts.js';
import { chunksOf, bm25Pick, searchTerms } from './rag.js';
import { allPages, pageById, parseLinks, renderNote, paperShort, pageLabel } from './notebook.js';

const MODES = [
  ['notes', 'Chỉ ghi chú', 'Nhanh, rẻ: ghi chú đã trích xuất của paper và nội dung trang Sổ tay.'],
  ['retrieval', 'Ghi chú + đoạn liên quan', 'Khuyên dùng (RAG): thêm các đoạn khớp nhất với câu hỏi trong toàn văn paper.'],
  ['full', 'Toàn văn', 'Đầy đủ nhất, tốn token nhất: gửi toàn văn các paper đã chọn.'],
];
const TASKS = [
  ['Trả lời câu hỏi', ''],
  ['Tóm tắt nguồn', 'Tóm tắt các nguồn đã chọn: mỗi paper / ghi chú 2–3 ý chính.'],
  ['Bảng so sánh', 'Lập bảng so sánh các paper đã chọn: bài toán, phương pháp, dataset, kết quả chính, hạn chế.'],
  ['Related Work', 'Viết một đoạn Related Work (khoảng 150–250 từ) từ các paper đã chọn, gắn nhãn nguồn cho từng ý.'],
  ['Giải thích đoạn chọn', 'Giải thích đoạn đang chọn cho dễ hiểu, kèm ví dụ nếu cần, dựa trên các nguồn.'],
  ['Viết tiếp trang', 'Viết tiếp trang này theo mạch đang có, dựa trên các nguồn.'],
  ['Câu hỏi mở / hướng tiếp', 'Từ các nguồn, nêu các câu hỏi còn bỏ ngỏ và hướng thí nghiệm tiếp theo cho đề tài của tôi.'],
];
const RETRIEVAL_BUDGET = 20000;
const FULL_BUDGET = 400000;
const PAGE_BUDGET = 14000;   // ký tự tối đa mỗi trang ghi chú
const AUTO_MAX = 5;           // số paper tự tìm thêm tối đa
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { /* bỏ qua */ } return null; };

const NB_RULES = [
  '',
  'Bối cảnh: người dùng đang viết một trang trong Sổ tay nghiên cứu (Markdown) và sẽ chèn câu trả lời thẳng vào trang.',
  '- Ngoài các paper [P1], [P2]…, có thể có ghi chú của chính người dùng, gắn nhãn [N1], [N2]…; lấy ý từ ghi chú nào thì gắn nhãn đó ngay sau câu.',
  '- Viết Markdown gọn: đoạn ngắn, danh sách hoặc bảng khi hợp; công thức dùng $...$ hoặc $$...$$. Không chào hỏi, không nhắc lại câu hỏi, không viết tiêu đề cấp 1.',
  '- Nếu có <selection>, đó là đoạn người dùng đang bôi đen trong trang; yêu cầu thường nói về đoạn đó.',
  '- Nếu nguồn không đủ để trả lời, nói rõ phần nào thiếu thay vì đoán.',
].join('\n');

/** [P1] / [N2] / [P1, P3] → liên kết Sổ tay [[@paper]] / [[trang]] (không dùng "|" để không vỡ bảng Markdown). */
const linkOf = (s) => (s.kind === 'paper' ? `[[@${s.id}]]` : `[[${s.title}]]`);
function linkCites(md, labels) {
  return String(md || '').replace(/\[((?:[PN]\d+)(?:\s*[,;]\s*[PN]\d+)*)\]/g, (m, inner) => {
    const out = [...new Set(inner.split(/\s*[,;]\s*/).map((lab) => (labels.get(lab) ? linkOf(labels.get(lab)) : `[${lab}]`)))];
    return `(${out.join(', ')})`;
  });
}
const citedLabels = (md) => new Set([...String(md || '').matchAll(/\b([PN]\d+)\b/g)].map((m) => m[1]));

/**
 * Mở trợ lý AI cho trang page. selection: đoạn đang bôi đen. onInsert(md) chèn vào chỗ con trỏ, onReplace(md) thay đoạn
 * đang chọn (chỉ có khi có selection).
 */
export function aiDialog({ page, selection = '', onInsert, onReplace }) {
  const linked = page ? [...parseLinks(page.content || '').papers].filter((id) => paperById(id)) : [];
  const st = {
    papers: linked.slice(0, 10),       // id paper chọn tay
    auto: [],                          // id paper tự tìm thêm ở lần tạo gần nhất
    pages: page && String(page.content || '').trim() ? [page.id] : [],
    autoFind: LS('pv.nbAiAuto') !== '0',
    mode: LS('pv.nbAiMode') || 'retrieval',
    lang: LS('pv.nbAiLang') ?? (store.settings.chatLang || ''),
    format: LS('pv.nbAiFmt') || 'callout',
    history: [],                       // [{ role, content }] để hỏi tiếp
    answer: '', question: '', refs: [], labels: new Map(),
    busy: false, abort: null, pq: '', gq: '',
  };
  const texts = new Map();

  const body = document.createElement('div');
  body.className = 'ai-dlg';
  body.innerHTML = `<button type="button" class="ai-src-tg" id="ai-src-tg" title="Chọn paper, ghi chú và mức ngữ cảnh"></button>
    <div class="ai-main">
      ${selection ? `<details class="ai-sel" open><summary>Đoạn đang chọn (${selection.length} ký tự)</summary><div class="ai-sel-t">${escapeHtml(clampText(selection, 600))}</div></details>` : ''}
      <textarea id="ai-q" rows="3" placeholder="Hỏi hoặc yêu cầu AI viết… ví dụ: So sánh cách các paper xử lý dữ liệu ít nhãn (Ctrl + Enter để tạo)"></textarea>
      <div class="ai-tasks">${TASKS.map(([l, q], i) => (i === 4 && !selection) ? '' : `<button type="button" class="chip" data-task="${i}">${escapeHtml(l)}</button>`).join('')}</div>
      <div class="ai-go"><button type="button" class="primary" id="ai-run">✨ Tạo câu trả lời</button><span class="hint" id="ai-status"></span><span class="spacer"></span><button type="button" class="sm" id="ai-stop" hidden>Dừng</button></div>
      <div class="ai-out" id="ai-out"><div class="ai-empty hint">Chọn nguồn (paper, ghi chú), gõ câu hỏi rồi bấm <b>Tạo câu trả lời</b>. Câu trả lời ghi rõ nguồn [P1] (paper) và [N1] (ghi chú); khi chèn vào trang, các nhãn thành liên kết bấm được.</div></div>
      <div class="ai-acts" id="ai-acts" hidden>
        <select id="ai-fmt" title="Chèn ở dạng nào"><option value="callout">Khối ✨ AI (callout)</option><option value="plain">Văn bản thường</option></select>
        <button type="button" class="primary sm" id="ai-ins">Chèn vào trang</button>
        ${selection ? '<button type="button" class="sm" id="ai-rep">Thay đoạn đã chọn</button>' : ''}
        <button type="button" class="sm" id="ai-copy">Copy</button>
        <span class="spacer"></span>
        <button type="button" class="sm ghost" id="ai-again" title="Tạo lại câu trả lời cho câu hỏi vừa rồi">↻ Tạo lại</button>
      </div>
    </div>
    <aside class="ai-side">
      <div class="ai-sec"><div class="ai-sec-h">📄 Paper <span class="hint" id="ai-np"></span></div>
        <div id="ai-plist" class="ai-list"></div>
        <div class="ai-find"><input id="ai-pq" type="search" placeholder="+ Thêm paper: gõ tên, tác giả, tag…" autocomplete="off"><div class="ai-dd" id="ai-pdd" hidden></div></div>
        <div class="ai-quick" id="ai-pquick"></div>
        <label class="ai-chk"><input type="checkbox" id="ai-auto" ${st.autoFind ? 'checked' : ''}> Tự tìm thêm paper liên quan trong thư viện (tối đa ${AUTO_MAX})</label>
      </div>
      <div class="ai-sec"><div class="ai-sec-h">📓 Ghi chú Sổ tay <span class="hint" id="ai-ng"></span></div>
        <div id="ai-glist" class="ai-list"></div>
        <div class="ai-find"><input id="ai-gq" type="search" placeholder="+ Thêm trang ghi chú…" autocomplete="off"><div class="ai-dd" id="ai-gdd" hidden></div></div>
      </div>
      <div class="ai-sec"><div class="ai-sec-h">Mức ngữ cảnh</div>
        <div class="ai-modes">${MODES.map(([k, l, h]) => `<label class="ai-mode" title="${escapeHtml(h)}"><input type="radio" name="ai-mode" value="${k}" ${st.mode === k ? 'checked' : ''}><span><b>${escapeHtml(l)}</b><small>${escapeHtml(h)}</small></span></label>`).join('')}</div>
      </div>
      <label class="ai-sec ai-lang"><span class="ai-sec-h">Ngôn ngữ trả lời</span><select id="ai-lang">${CHAT_LANGS.map(([k, l]) => `<option value="${k}" ${k === st.lang ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></label>
    </aside>`;
  const $ = (id) => body.querySelector(`#${id}`);

  /* ---------- nguồn ---------- */
  const allP = () => store.papers.filter((p) => !p.deleted);
  function drawSources() {
    const plist = [...st.papers.map((id) => [id, false]), ...st.auto.filter((id) => !st.papers.includes(id)).map((id) => [id, true])];
    $('ai-np').textContent = plist.length ? `(${plist.length})` : '';
    $('ai-plist').innerHTML = plist.map(([id, auto]) => {
      const p = paperById(id);
      if (!p) return '';
      return `<div class="ai-src ${auto ? 'auto' : ''}" title="${escapeHtml(p.title)}"><span class="ai-src-b"><span class="ai-src-t">${escapeHtml(p.title)}</span><span class="ai-src-m">${escapeHtml(paperShort(p))}${auto ? ' · tự tìm' : ''}</span></span>${auto ? `<button type="button" class="ghost sm" data-keep="${id}" title="Giữ paper này cho các lần sau">Giữ</button>` : ''}<button type="button" class="ghost sm" data-rmp="${id}" title="Bỏ khỏi nguồn">✕</button></div>`;
    }).join('') || '<div class="hint ai-none">Chưa chọn paper nào.</div>';
    $('ai-ng').textContent = st.pages.length ? `(${st.pages.length})` : '';
    $('ai-glist').innerHTML = st.pages.map((id) => {
      const g = pageById(id);
      return g ? `<div class="ai-src"><span class="ai-src-b"><span class="ai-src-t">${escapeHtml(pageLabel(g))}</span>${page && id === page.id ? '<span class="ai-src-m">trang này</span>' : ''}</span><button type="button" class="ghost sm" data-rmg="${id}" title="Bỏ khỏi nguồn">✕</button></div>` : '';
    }).join('') || '<div class="hint ai-none">Không dùng ghi chú nào.</div>';
    const quick = [];
    const notIn = linked.filter((id) => !st.papers.includes(id));
    if (notIn.length) quick.push(`<button type="button" class="chip" data-addp="${notIn.join(',')}">+ Paper nhắc trong trang (${notIn.length})</button>`);
    const sel = [...store.selected].filter((id) => paperById(id) && !st.papers.includes(id));
    if (sel.length) quick.push(`<button type="button" class="chip" data-addp="${sel.join(',')}">+ Paper đang tick ở Thư viện (${sel.length})</button>`);
    if (page && !st.pages.includes(page.id)) quick.push(`<button type="button" class="chip" data-addg="${page.id}">+ Trang này</button>`);
    $('ai-pquick').innerHTML = quick.join('');
    const open = body.classList.contains('src-open');
    $('ai-src-tg').innerHTML = `📚 Nguồn: <b>${plist.length}</b> paper · <b>${st.pages.length}</b> ghi chú${st.autoFind ? ' · tự tìm thêm' : ''} · ${escapeHtml((MODES.find((m) => m[0] === st.mode) || MODES[1])[1])}<span class="spacer"></span>${open ? 'Ẩn ▴' : 'Chỉnh ▾'}`;
  }
  function dropdown(kind) {
    const q = norm((kind === 'p' ? $('ai-pq') : $('ai-gq')).value.trim());
    const dd = kind === 'p' ? $('ai-pdd') : $('ai-gdd');
    if (!q) { dd.hidden = true; return; }
    const items = kind === 'p'
      ? allP().filter((p) => !st.papers.includes(p.id) && norm(`${p.title} ${(p.extraction?.authors || []).join(' ')} ${(p.extraction?.tags || []).join(' ')} ${p.extraction?.year || ''}`).includes(q)).slice(0, 8)
        .map((p) => `<button type="button" data-addp="${p.id}"><span>${escapeHtml(p.title)}</span><small>${escapeHtml(paperShort(p))}</small></button>`)
      : allPages().filter((g) => !st.pages.includes(g.id) && norm(`${g.title} ${g.content || ''}`).includes(q)).slice(0, 8)
        .map((g) => `<button type="button" data-addg="${g.id}"><span>${escapeHtml(pageLabel(g))}</span></button>`);
    dd.innerHTML = items.join('') || '<div class="hint" style="padding:6px 8px">Không tìm thấy.</div>';
    dd.hidden = false;
  }

  /* ---------- dựng ngữ cảnh và gọi model ---------- */
  async function textOf(id) {
    if (!texts.has(id)) { try { texts.set(id, (await api.getText(id)).text || ''); } catch (_) { texts.set(id, ''); } }
    return texts.get(id);
  }
  async function autoPick(terms) {
    const docs = allP().filter((p) => !st.papers.includes(p.id)).map((p) => ({ key: p.id, text: paperNotesText(p, 'x') }));
    const hit = bm25Pick(docs, terms, { budget: Infinity, perKey: 1 });
    const top = hit[0]?.score || 0;
    return hit.filter((d) => d.score >= top * 0.35).slice(0, AUTO_MAX).map((d) => d.key);
  }

  async function run(question, { followUp = false } = {}) {
    if (st.busy) return;
    if (!hasCredentials(store.settings, 'notebook-ai')) { toast('Chưa có API key. Mở Cài đặt để nhập key Claude / OpenAI / Gemini.', 4000, 'err'); return; }
    question = String(question || '').trim();
    if (!question) { $('ai-q').focus(); toast('Gõ câu hỏi hoặc chọn một yêu cầu có sẵn.', 2500); return; }
    st.busy = true;
    st.question = question;
    st.answer = '';
    st.abort = new AbortController();
    $('ai-run').disabled = true;
    $('ai-stop').hidden = false;
    $('ai-acts').hidden = true;
    const status = (s) => { $('ai-status').textContent = s; };
    try {
      const needTerms = st.mode === 'retrieval' || (st.autoFind && !followUp);
      status(needTerms ? 'Đang tìm nguồn liên quan…' : 'Đang chuẩn bị…');
      const terms = needTerms ? await searchTerms(`${question} ${selection}`.trim(), store.settings) : [];
      if (st.autoFind && !followUp) st.auto = await autoPick(terms);
      else if (!st.autoFind) st.auto = [];
      drawSources();
      const paperIds = [...st.papers, ...st.auto.filter((id) => !st.papers.includes(id))];
      if (!paperIds.length && !st.pages.length && !selection) throw new Error('Chưa có nguồn nào: thêm paper, trang ghi chú, hoặc bật “Tự tìm thêm paper liên quan”.');
      // nhãn cố định trong một phiên: P1… cho paper, N1… cho ghi chú
      st.labels = new Map();
      const plab = new Map(paperIds.map((id, i) => [id, `P${i + 1}`]));
      paperIds.forEach((id) => st.labels.set(plab.get(id), { kind: 'paper', id }));
      st.pages.forEach((id, i) => { const g = pageById(id); if (g) st.labels.set(`N${i + 1}`, { kind: 'page', id, title: g.title || 'Không tên' }); });

      const parts = [];
      if (paperIds.length) {
        parts.push(`Tài liệu về ${paperIds.length} paper:`);
        const per = Math.floor(FULL_BUDGET / paperIds.length);
        for (const id of paperIds) {
          let b = paperNotesText(paperById(id), plab.get(id));
          if (st.mode === 'full') { const t = await textOf(id); b += t ? `\nToàn văn:\n${clampText(t, per)}` : '\n(Paper này chưa có toàn văn được lưu, chỉ có ghi chú.)'; }
          parts.push(`${b}\n</paper>`);
        }
      }
      const notes = [...st.labels].filter(([, s]) => s.kind === 'page');
      if (notes.length) {
        parts.push(`Ghi chú của người dùng trong Sổ tay (${notes.length} trang):`);
        for (const [lab, s] of notes) parts.push(`<note id="${lab}" title="${escapeHtml(s.title)}">\n${clampText(pageById(s.id)?.content || '', PAGE_BUDGET)}\n</note>`);
      }
      const settings = { ...store.settings, chatLang: st.lang };
      const system = [{ text: buildChatSystem(settings) + NB_RULES }, { text: parts.join('\n\n') || '(Không có tài liệu kèm theo.)', cache: true }];

      let user = question;
      st.refs = [];
      if (st.mode === 'retrieval' && paperIds.length) {
        status('Đang tìm đoạn liên quan trong toàn văn…');
        const docs = [];
        for (const id of paperIds) chunksOf(await textOf(id)).forEach((text, n) => docs.push({ key: id, label: plab.get(id), n, text }));
        const hits = bm25Pick(docs, terms, { budget: RETRIEVAL_BUDGET, perKey: 4 })
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }) || a.n - b.n);
        if (hits.length) {
          user = `Các đoạn trích từ toàn văn có thể liên quan (tìm tự động, có thể thiếu):\n${hits.map((h) => `<excerpt paper="${h.label}" part="${h.n + 1}">\n${h.text}\n</excerpt>`).join('\n')}\n\nYêu cầu: ${question}`;
          st.refs = hits.map((h) => ({ label: h.label, n: h.n + 1, preview: h.text.slice(0, 200) }));
        }
      }
      if (selection) user = `<selection page="${escapeHtml(page?.title || '')}">\n${clampText(selection, 6000)}\n</selection>\n\n${user}`;
      else if (page) user = `(Trang đang viết: “${page.title || 'Không tên'}”)\n\n${user}`;

      const messages = followUp ? [...st.history, { role: 'user', content: user }] : [{ role: 'user', content: user }];
      status('Đang viết…');
      let raf = 0;
      const out = await streamChat({
        settings, system, messages, signal: st.abort.signal, task: 'notebook-ai',
        onText: (t) => { st.answer += t; if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); },
        onRetry: (n, wait) => { st.answer = ''; status(`Bị giới hạn tốc độ, thử lại lần ${n} sau ${Math.round(wait / 1000)}s…`); },
      });
      st.answer = fixMixedScript(st.answer);
      st.history = [...messages, { role: 'assistant', content: st.answer }];
      status(out.stopReason === 'max_tokens' ? 'Câu trả lời bị cắt vì chạm giới hạn độ dài.' : `Xong · ${paperIds.length} paper, ${notes.length} ghi chú${st.refs.length ? `, ${st.refs.length} đoạn trích` : ''}.`);
      paint(true);
    } catch (e) {
      if (e.name === 'AbortError') { status('Đã dừng.'); if (st.answer) paint(true); }
      else { status(''); $('ai-out').innerHTML = `<div class="status err">${escapeHtml(e.message || String(e))}</div>`; }
    } finally {
      st.busy = false;
      st.abort = null;
      $('ai-run').disabled = false;
      $('ai-stop').hidden = true;
    }
  }

  const srcName = (lab) => { const s = st.labels.get(lab); return s?.kind === 'paper' ? paperShort(paperById(s.id) || {}) : (s?.title || lab); };
  function paint(done = false) {
    const md = linkCites(st.answer, st.labels);
    $('ai-out').innerHTML = `<div class="ai-qshow"><span>Hỏi</span>${escapeHtml(st.question)}</div><div class="ai-ans nb-prev">${renderNote(md) || '<span class="spin"></span>'}</div>${done && st.refs.length ? `<details class="ai-refs"><summary>${st.refs.length} đoạn trích đã dùng</summary>${st.refs.map((r) => `<div class="ai-ref"><b>${escapeHtml(srcName(r.label))}</b> · đoạn ${r.n}: <span class="hint">${escapeHtml(r.preview)}…</span></div>`).join('')}</details>` : ''}`;
    if (done && st.answer) {
      $('ai-acts').hidden = false;
      $('ai-fmt').value = st.format;
      $('ai-run').textContent = '✨ Hỏi tiếp';
      $('ai-run').title = 'Hỏi tiếp dựa trên câu trả lời vừa rồi (giữ cùng nguồn)';
      $('ai-q').value = '';
      $('ai-q').placeholder = 'Hỏi tiếp… (Ctrl + Enter)';
    }
  }

  /** Markdown để chèn: câu trả lời đã nối nguồn + dòng Nguồn. */
  function outputMd(fmt) {
    const md = linkCites(st.answer.trim(), st.labels);
    const used = citedLabels(st.answer);
    const list = [...st.labels].filter(([lab]) => !used.size || used.has(lab)).map(([, s]) => linkOf(s));
    const src = list.length ? `Nguồn: ${list.join(' · ')}` : '';
    if (fmt === 'plain') return `${md}${src ? `\n\n*${src}*` : ''}`;
    const head = st.question.replace(/\s+/g, ' ').slice(0, 120);
    return [`> [!ai] ${head}`, ...md.split('\n').map((l) => (l ? `> ${l}` : '>')), ...(src ? ['>', `> ${src}`] : [])].join('\n');
  }

  /* ---------- sự kiện ---------- */
  body.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#ai-src-tg')) { body.classList.toggle('src-open'); drawSources(); return; }
    const task = t.closest('[data-task]');
    if (task) { const q = TASKS[Number(task.dataset.task)][1]; const ta = $('ai-q'); ta.value = q; ta.focus(); ta.setSelectionRange(q.length, q.length); return; }
    const ap = t.closest('[data-addp]');
    if (ap) { ap.dataset.addp.split(',').forEach((id) => { if (!st.papers.includes(id)) st.papers.push(id); }); st.auto = st.auto.filter((id) => !st.papers.includes(id)); $('ai-pq').value = ''; $('ai-pdd').hidden = true; drawSources(); return; }
    const ag = t.closest('[data-addg]');
    if (ag) { if (!st.pages.includes(ag.dataset.addg)) st.pages.push(ag.dataset.addg); $('ai-gq').value = ''; $('ai-gdd').hidden = true; drawSources(); return; }
    const rp = t.closest('[data-rmp]');
    if (rp) { st.papers = st.papers.filter((id) => id !== rp.dataset.rmp); st.auto = st.auto.filter((id) => id !== rp.dataset.rmp); drawSources(); return; }
    const kp = t.closest('[data-keep]');
    if (kp) { st.papers.push(kp.dataset.keep); drawSources(); return; }
    const rg = t.closest('[data-rmg]');
    if (rg) { st.pages = st.pages.filter((id) => id !== rg.dataset.rmg); drawSources(); }
  });
  let closeFn = () => {};
  const bind = () => {
    $('ai-run').addEventListener('click', () => run($('ai-q').value, { followUp: !!st.history.length }));
    $('ai-again').addEventListener('click', () => { st.history = st.history.slice(0, -2); run(st.question, { followUp: !!st.history.length }); });
    $('ai-stop').addEventListener('click', () => st.abort?.abort());
    $('ai-q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('ai-run').click(); } });
    $('ai-pq').addEventListener('input', () => dropdown('p'));
    $('ai-gq').addEventListener('input', () => dropdown('g'));
    $('ai-auto').addEventListener('change', (e) => { st.autoFind = e.target.checked; LS('pv.nbAiAuto', st.autoFind ? '1' : '0'); if (!st.autoFind) { st.auto = []; drawSources(); } });
    body.querySelectorAll('input[name="ai-mode"]').forEach((r) => r.addEventListener('change', () => { st.mode = r.value; LS('pv.nbAiMode', st.mode); drawSources(); }));
    $('ai-lang').addEventListener('change', (e) => { st.lang = e.target.value; LS('pv.nbAiLang', st.lang); });
    $('ai-fmt').addEventListener('change', (e) => { st.format = e.target.value; LS('pv.nbAiFmt', st.format); });
    $('ai-ins').addEventListener('click', () => { onInsert?.(outputMd(st.format)); toast('Đã chèn câu trả lời vào trang.'); closeFn(); });
    $('ai-rep')?.addEventListener('click', () => { onReplace?.(outputMd('plain')); toast('Đã thay đoạn đã chọn.'); closeFn(); });
    $('ai-copy').addEventListener('click', () => copyText(outputMd(st.format)).then(() => toast('Đã copy Markdown.')));
  };
  drawSources();
  if (/\?\s*$/.test(selection.trim()) && selection.length < 400) body.querySelector('#ai-q').value = selection.trim();
  return dialog({
    title: '✨ Hỏi AI dựa trên paper và ghi chú',
    body, width: 1060,
    buttons: [{ label: 'Đóng', value: null }],
    onOpen: (_, close) => { closeFn = close; bind(); setTimeout(() => $('ai-q').focus(), 30); },
  }).then((v) => { st.abort?.abort(); return v; });
}
