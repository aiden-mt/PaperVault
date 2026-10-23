// Ghi chú & thẻ ghi nhớ: gom mọi đoạn đã lưu bằng "+ Ghi chú" (bong bóng dịch trong PDF và ở mọi trang) và các trích dẫn
// thêm tay, của tất cả paper. Hai chế độ: danh sách để tìm, sửa, xoá, xuất; và thẻ ghi nhớ để ôn (mặt trước đoạn gốc,
// lật ra bản dịch và nhận xét). Thẻ ôn theo lặp lại ngắt quãng (../srs.js): chấm Quên / Khó / Nhớ / Dễ, app tự tính
// ngày ôn tiếp theo và lưu trên đoạn ghi chú (annotation.srs). #/notes?mode=review mở thẳng lượt ôn hôm nay.
import { store, savePaper, paperById, saveSettings } from '../store.js';
import { escapeHtml, fmtDate, copyText, download } from '../util.js';
import { $, toast, confirmDialog, dialog, mdToHtml } from '../ui.js';
import { rich, titleHtml } from '../richtext.js';
import { GRADES, srsOf, schedule, fmtInterval, dueCards, srsConfig, SRS_DEFAULTS, isEarly, repairSrs } from '../srs.js';
import { localDate } from '../notebook.js';
import { lookupPronunciation, phoneticWords, play, stopSpeaking } from '../pronounce.js';

// deckMode: 'due' = lượt ôn hôm nay (thẻ tới hạn + thẻ mới), 'all' = lướt mọi thẻ khớp bộ lọc.
const state = { mode: 'list', q: '', paper: '', sort: 'new', onlyTr: false, deckMode: 'due', deck: [], idx: 0, flipped: false, done: 0, built: false };

function allNotes() {
  const out = [];
  for (const p of store.papers) {
    if (p.deletedAt) continue;
    for (const a of p.annotations || []) if (a && a.quote) out.push({ p, a });
  }
  return out;
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  let list = allNotes().filter(({ p, a }) => (!state.paper || p.id === state.paper)
    && (!state.onlyTr || (a.translation || '').trim())
    && (!q || `${a.quote} ${a.translation || ''} ${a.note || ''} ${p.title}`.toLowerCase().includes(q)));
  const t = (x) => Date.parse(x.a.at || '') || 0;
  if (state.sort === 'new') list.sort((x, y) => t(y) - t(x));
  else if (state.sort === 'old') list.sort((x, y) => t(x) - t(y));
  else list.sort((x, y) => x.p.title.localeCompare(y.p.title) || t(x) - t(y));
  return list;
}

async function updateNote(paperId, noteId, patch) {
  const p = paperById(paperId);
  if (!p) return;
  await savePaper({ ...p, annotations: (p.annotations || []).map((a) => (a.id === noteId ? { ...a, ...patch } : a)) });
}

const fmtDue = (ymd) => { const [y, m, d] = ymd.split('-'); return `${Number(d)}/${Number(m)}${Number(y) !== new Date().getFullYear() ? `/${y}` : ''}`; };
function srsBadge(a) {
  const s = srsOf(a);
  if (!s) return ' · <span class="srs-tag new">thẻ mới</span>';
  const today = localDate();
  if (s.due <= today) return ' · <span class="srs-tag due">cần ôn hôm nay</span>';
  return ` · <span class="srs-tag">${s.interval >= 21 ? 'đã thuộc · ' : ''}ôn lại ${fmtDue(s.due)}</span>`;
}

/* ---------- phát âm (dùng chung bộ phát âm của bong bóng dịch) ---------- */
const ACC = [['uk', 'UK', 'Anh-Anh'], ['us', 'US', 'Anh-Mỹ']];
const PRON_KEY = 'pv.notesAcc';
const prefAcc = () => { try { return localStorage.getItem(PRON_KEY) === 'us' ? 'us' : 'uk'; } catch (_) { return 'uk'; } };
const setPrefAcc = (a) => { try { localStorage.setItem(PRON_KEY, a); } catch (_) { /* bỏ qua */ } };
const pronCache = new Map(); // đoạn gốc -> Promise<{ uk, us } | null>
const isEnglishQuote = (s) => /[A-Za-z]/.test(s || '') && !/[À-ỹ]/.test(s || '');
/** Khối phát âm của mặt trước thẻ: mỗi giọng một dòng (nhãn, IPA nếu là từ / cụm ngắn, nút nghe). */
function pronHtml(quote) {
  if (!isEnglishQuote(quote)) return '';
  const short = !!phoneticWords(quote, 'en');
  return `<div class="fc-pron" data-quote="${escapeHtml(quote)}">${ACC.map(([k, lab, name]) => `<div class="fc-pron-r">
      <span class="fc-pron-k" title="${name}">${lab}</span>${short ? `<span class="fc-pron-ipa" data-ipa="${k}">…</span>` : `<span class="hint">Nghe đoạn gốc</span>`}
      <button type="button" class="fc-say ${prefAcc() === k ? 'pref' : ''}" data-say="${k}" title="Nghe giọng ${name}${prefAcc() === k ? ' (phím P)' : ''}">▶ Nghe</button></div>`).join('')}</div>`;
}
/** Điền IPA (tra như bong bóng dịch: Wiktionary, từ điển CMU…), có lưu tạm theo đoạn. */
async function fillPron(box) {
  const quote = box?.dataset.quote;
  if (!quote || !box.querySelector('[data-ipa]')) return;
  if (!pronCache.has(quote)) pronCache.set(quote, lookupPronunciation(quote, 'en').catch(() => null));
  const p = await pronCache.get(quote);
  if (!box.isConnected) return;
  box.querySelectorAll('[data-ipa]').forEach((el) => {
    const v = p?.[el.dataset.ipa];
    el.textContent = v ? `/${v}/` : 'chưa có phiên âm';
    el.classList.toggle('none', !v);
  });
}
function sayQuote(quote, acc, btn) {
  if (!quote) return;
  setPrefAcc(acc);
  play(quote, acc, (on, src) => {
    if (!btn) return;
    btn.classList.toggle('loading', on && !src);
    btn.classList.toggle('on', on && !!src);
    btn.textContent = on ? (src ? '■ Đang phát' : '… Đang tải') : '▶ Nghe';
  });
}

export async function render(root, { query } = {}) {
  if (query?.get('mode') === 'review') { state.mode = 'cards'; state.deckMode = 'due'; state.deck = []; state.built = false; }
  root.innerHTML = `<div class="page-head"><h1>Ghi chú &amp; thẻ ghi nhớ</h1><span class="hint">Các đoạn đã lưu bằng nút + Ghi chú khi bôi đen để dịch, và các trích dẫn bạn thêm tay ở trang paper.</span></div>
    <div class="notes-bar">
      <div class="seg" id="nt-mode"><button data-m="list">Danh sách</button><button data-m="cards">Ôn thẻ${(() => { const n = dueCards(allNotes()).length; return n ? ` <span class="nt-count" title="Thẻ cần ôn hôm nay">${n}</span>` : ''; })()}</button></div>
      <input type="search" id="nt-q" placeholder="Tìm trong đoạn gốc, bản dịch, nhận xét, tên paper…">
      <select id="nt-paper"></select>
      <select id="nt-sort" class="nt-list-only"><option value="new">Mới nhất</option><option value="old">Cũ nhất</option><option value="paper">Theo paper</option></select>
      <label class="row" style="gap:6px"><input type="checkbox" id="nt-tr"> Chỉ đoạn có bản dịch</label>
      <span class="spacer"></span>
      <button class="sm nt-list-only" id="nt-csv" title="Hai cột Mặt trước (đoạn gốc) và Mặt sau (bản dịch, nhận xét), nhập được vào Anki hoặc Quizlet">Tải CSV (Anki)</button>
      <button class="sm nt-list-only" id="nt-md">Tải Markdown</button>
    </div>
    <div id="nt-body"></div>`;

  const papersWith = [...new Map(allNotes().map(({ p }) => [p.id, p])).values()].sort((a, b) => a.title.localeCompare(b.title));
  $('nt-paper').innerHTML = `<option value="">Mọi paper (${papersWith.length})</option>${papersWith.map((p) => `<option value="${p.id}">${escapeHtml(p.title.slice(0, 70))} (${(p.annotations || []).length})</option>`).join('')}`;
  $('nt-paper').value = papersWith.some((p) => p.id === state.paper) ? state.paper : '';
  $('nt-q').value = state.q;
  $('nt-sort').value = state.sort;
  $('nt-tr').checked = state.onlyTr;

  repairAll().then((n) => { if (n) { toast(`Đã sửa lịch ôn của ${n} thẻ bị giãn quá xa (do chấm lặp ở bản trước).`, 4000, 'ok'); state.built = false; if ($('nt-body')) draw(); } }).catch(() => {});

  const draw = () => {
    $('nt-mode').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.m === state.mode));
    root.querySelector('.notes-bar')?.classList.toggle('cards', state.mode === 'cards');
    if (state.mode === 'cards') drawCards(); else drawList();
  };

  function drawList() {
    const list = filtered();
    const total = allNotes().length;
    if (!total) {
      $('nt-body').innerHTML = '<div class="empty">Chưa có ghi chú nào. Bôi đen một đoạn ở bất kỳ trang nào (hoặc trong PDF), mở bong bóng dịch rồi bấm <b>+ Ghi chú</b> khi đang ở trang một paper.</div>';
      return;
    }
    $('nt-body').innerHTML = `<div class="hint" style="margin:0 0 8px">${list.length}/${total} đoạn</div>${list.map(({ p, a }) => `<div class="note-item" data-p="${p.id}" data-a="${escapeHtml(a.id)}">
        <div class="note-main">
          <div class="note-q">“${rich(a.quote)}”</div>
          ${a.translation ? `<div class="note-tr"><span class="badge accent">Dịch</span> ${rich(a.translation)}</div>` : ''}
          ${a.note ? `<div class="note-n">${mdToHtml(a.note)}</div>` : ''}
          <div class="hint note-meta"><a href="#/paper/${p.id}?tab=notes">${titleHtml(p.title)}</a>${a.page ? ` · tr. ${escapeHtml(a.page)}` : ''}${a.at ? ` · ${fmtDate(a.at)}` : ''}${srsBadge(a)}</div>
        </div>
        <div class="note-acts">${isEnglishQuote(a.quote) ? `<button class="ghost sm" data-act="say" title="Nghe đoạn gốc (giọng ${prefAcc() === 'us' ? 'Anh-Mỹ' : 'Anh-Anh'})">▶</button>` : ''}<button class="ghost sm" data-act="copy" title="Sao chép đoạn gốc và bản dịch">⧉</button><button class="ghost sm" data-act="edit" title="Sửa">✎</button><button class="ghost sm" data-act="del" title="Xoá">🗑</button></div>
      </div>`).join('') || '<div class="empty">Không có đoạn nào khớp bộ lọc.</div>'}`;
  }

  function buildDeck() {
    const list = filtered();
    state.deck = (state.deckMode === 'due' ? dueCards(list) : list).map(({ p, a }) => ({ pid: p.id, aid: a.id }));
    state.idx = 0;
    state.flipped = false;
    state.done = 0;
    state.built = true;
  }
  const cardOf = (c) => { const p = c && paperById(c.pid); const a = p && (p.annotations || []).find((x) => x.id === c.aid); return a ? { p, a } : null; };

  function drawCards() {
    if (!state.built) buildDeck();
    const review = state.deckMode === 'due';
    const cur = cardOf(state.deck[state.idx]);
    // Số trên nút "Ôn thẻ" theo dữ liệu mới nhất (sau mỗi lần chấm điểm).
    const nDue = dueCards(allNotes()).length;
    const badge = $('nt-mode')?.querySelector('[data-m="cards"]');
    if (badge) badge.innerHTML = `Ôn thẻ${nDue ? ` <span class="nt-count" title="Thẻ cần ôn hôm nay">${nDue}</span>` : ''}`;
    const head = `<div class="fc-bar"><div class="seg" id="fc-deck"><button data-d="due" class="${review ? 'active' : ''}">Cần ôn hôm nay</button><button data-d="all" class="${review ? '' : 'active'}">Tất cả thẻ</button></div>
        <span class="hint">${review
    ? (state.deck.length ? `Còn <b>${state.deck.length - state.idx}</b> thẻ${state.done ? ` · đã ôn ${state.done}` : ''}` : '')
    : (state.deck.length ? `Thẻ ${state.idx + 1}/${state.deck.length}` : '')}</span><span class="spacer"></span>
        ${review ? '' : '<button class="sm" id="fc-shuffle">Trộn thẻ</button>'}<button class="sm" id="fc-cfg" title="Số thẻ mới mỗi ngày, khoảng ôn lần đầu, khoảng tối đa">⚙ Nhịp ôn</button></div>`;
    if (!cur) {
      const next = filtered().map(({ a }) => srsOf(a)?.due).filter(Boolean).sort().find((d) => d > localDate());
      $('nt-body').innerHTML = `${head}<div class="fc-empty">${review
        ? `${state.done ? `<div class="fc-done">🎉</div><b>Xong lượt ôn hôm nay: ${state.done} thẻ.</b>` : '<b>Hôm nay không còn thẻ nào cần ôn.</b>'}<br><span class="hint">${next ? `Lần ôn tới: ${fmtDue(next)}.` : ''} Mỗi ngày app đưa vào tối đa ${srsConfig().newPerDay} thẻ mới (đổi ở ⚙ Nhịp ôn).</span>`
        : state.deck.length ? `<b>Đã xem hết ${state.deck.length} thẻ.</b><br><button class="sm" id="fc-restart" style="margin-top:10px">Xem lại từ đầu</button>` : 'Không có thẻ nào khớp bộ lọc.'}</div>`;
      bindHead();
      $('fc-restart')?.addEventListener('click', () => { state.idx = 0; state.flipped = false; drawCards(); });
      return;
    }
    const { p, a } = cur;
    const s = srsOf(a);
    const today = localDate();
    $('nt-body').innerHTML = `${head}
      <div class="fc-card ${state.flipped ? 'flipped' : ''}" id="fc-card" tabindex="0" title="Bấm hoặc nhấn Space để lật">
        <div class="fc-face fc-front"><div class="fc-label">Đoạn gốc ${s ? `<span class="srs-tag">${s.due <= today ? 'tới hạn' : `ôn lại ${fmtDue(s.due)}`} · khoảng ${fmtInterval(s.interval)}</span>` : '<span class="srs-tag new">thẻ mới</span>'}</div><div class="fc-text">${rich(a.quote)}</div>${pronHtml(a.quote)}<div class="hint fc-src">${titleHtml(p.title)}${a.page ? ` · tr. ${escapeHtml(a.page)}` : ''}</div></div>
        ${state.flipped ? `<div class="fc-face fc-back"><div class="fc-label">Bản dịch</div><div class="fc-text">${a.translation ? rich(a.translation) : '<span class="hint">(chưa có bản dịch)</span>'}</div>${a.note ? `<div class="fc-note">${mdToHtml(a.note)}</div>` : ''}</div>` : '<div class="hint fc-tap">Bấm vào thẻ hoặc nhấn Space để xem bản dịch</div>'}
      </div>
      <div class="fc-actions">
        ${review ? '' : `<button class="sm" id="fc-prev" ${state.idx ? '' : 'disabled'}>Trước <kbd>←</kbd></button>`}
        ${state.flipped
    ? GRADES.map(([g, label, key, cls]) => {
      const nx = schedule(s, g, today);
      const sub = nx.early ? 'giữ lịch' : fmtInterval(nx.interval);
      const tip = nx.early ? `Thẻ chưa tới hạn: giữ lịch ôn ${fmtDue(s.due)}` : `Lần ôn tới: ${fmtInterval(nx.interval)}${nx.interval > 0 ? ` (${fmtDue(nx.due)})` : ''}`;
      return `<button class="sm fc-grade ${cls}" data-grade="${g}" title="${escapeHtml(tip)}"><b>${label}</b><small>${sub}</small><kbd>${key}</kbd></button>`;
    }).join('')
    : '<button class="sm primary" id="fc-flip">Lật thẻ <kbd>Space</kbd></button>'}
        ${review ? '' : `<button class="sm" id="fc-next" ${state.idx < state.deck.length - 1 ? '' : 'disabled'}>Sau <kbd>→</kbd></button>`}
      </div>
      <p class="hint fc-help"><b>P</b> nghe đoạn gốc. Nhớ lại nghĩa trước khi lật (<b>Space</b>). Sau khi lật, chấm mức nhớ bằng phím <b>1</b>–<b>4</b>. Thẻ “ôn lại ngay” quay lại cuối lượt này; thẻ nhớ tốt được giãn dần khoảng cách.${s && isEarly(s, today) ? ' Thẻ này chưa tới hạn nên chấm Khó / Nhớ / Dễ chỉ ôn thử, không đổi lịch; Quên thì học lại từ đầu.' : ''}</p>`;
    bindHead();
    fillPron($('fc-card').querySelector('.fc-pron'));
    $('fc-card').addEventListener('click', (e) => {
      const sb = e.target.closest('[data-say]');
      if (sb) { e.stopPropagation(); sayQuote(a.quote, sb.dataset.say, sb); return; }
      state.flipped = !state.flipped;
      drawCards();
    });
    $('fc-flip')?.addEventListener('click', () => { state.flipped = true; drawCards(); });
    $('fc-prev')?.addEventListener('click', () => go(-1));
    $('fc-next')?.addEventListener('click', () => go(1));
    $('nt-body').querySelectorAll('[data-grade]').forEach((b) => b.addEventListener('click', () => grade(Number(b.dataset.grade))));
  }
  function bindHead() {
    $('fc-cfg')?.addEventListener('click', openSrsSettings);
    $('fc-deck').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b && b.dataset.d !== state.deckMode) { state.deckMode = b.dataset.d; buildDeck(); drawCards(); } });
    $('fc-shuffle')?.addEventListener('click', () => { for (let i = state.deck.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [state.deck[i], state.deck[j]] = [state.deck[j], state.deck[i]]; } state.idx = 0; state.flipped = false; drawCards(); });
  }
  const go = (d) => { const n = state.idx + d; if (n >= 0 && n < state.deck.length) { state.idx = n; state.flipped = false; drawCards(); } };
  let grading = false;
  async function grade(g) {
    const c = state.deck[state.idx];
    const cur = cardOf(c);
    if (!cur || grading) return;
    grading = true;
    const label = GRADES[g][1];
    let next;
    try {
      next = schedule(srsOf(cur.a), g);
      if (!next.early) await updateNote(c.pid, c.aid, { srs: next, known: next.interval >= 21, knownAt: next.interval >= 21 ? (cur.a.knownAt || new Date().toISOString()) : cur.a.knownAt || null });
    } catch (e) {
      toast(`Không lưu được kết quả ôn: ${e.message}`, 4000, 'err');
      return;
    } finally { grading = false; }
    toast(next.early ? `${label} · thẻ chưa tới hạn, giữ lịch ôn ${fmtDue(next.due)}.`
      : next.interval > 0 ? `${label} · ôn lại sau ${fmtInterval(next.interval)} (${fmtDue(next.due)}).` : `${label} · thẻ quay lại trong lượt này.`, 1800, 'ok');
    state.flipped = false;
    if (state.deckMode === 'due') {
      state.done += 1;
      // Quên / Khó với thẻ mới: đưa thẻ xuống cuối lượt để ôn lại ngay hôm nay.
      if (next.interval === 0) state.deck.push(c);
    }
    state.idx += 1; // "Tất cả thẻ": hết thẻ thì hiện "Đã xem hết", không đứng yên ở thẻ cuối
    drawCards();
  }

  // Phím tắt của thẻ ghi nhớ (chỉ khi đang ở chế độ thẻ, không gõ trong ô nhập).
  const onKey = (e) => {
    if (!$('nt-body')) { document.removeEventListener('keydown', onKey); return; }
    if (state.mode !== 'cards' || e.target?.closest?.('input, textarea, select')) return;
    if (e.key === ' ') { e.preventDefault(); if ($('fc-card')) { state.flipped = !state.flipped; drawCards(); } }
    else if (e.key === 'ArrowLeft') $('fc-prev')?.click();
    else if (e.key === 'ArrowRight') $('fc-next')?.click();
    else if (state.flipped && ['1', '2', '3', '4'].includes(e.key)) grade(Number(e.key) - 1);
    else if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const cur = cardOf(state.deck[state.idx]);
      if (cur && isEnglishQuote(cur.a.quote)) sayQuote(cur.a.quote, prefAcc(), $('fc-card')?.querySelector(`[data-say="${prefAcc()}"]`));
    }
  };
  document.addEventListener('keydown', onKey);

  /* ---------- nhịp ôn ---------- */
  async function openSrsSettings() {
    const c = srsConfig();
    const fld = (id, label, val, min, max, step, hint) => `<label class="field"><span class="label-text">${label}</span><input type="number" id="${id}" value="${val}" min="${min}" max="${max}" step="${step}"><span class="hint">${hint}</span></label>`;
    const preview = (cfg) => {
      // Một thẻ luôn chấm Nhớ đúng hạn: các mốc ôn lần lượt.
      let s = null;
      let day = localDate();
      const steps = [];
      for (let i = 0; i < 6; i++) { s = schedule(s, 2, day, cfg); steps.push(s.interval); day = s.due; }
      return steps.map((d) => fmtInterval(d)).join(' → ');
    };
    const r = await dialog({
      title: 'Nhịp ôn thẻ ghi nhớ', width: 560,
      body: `<p class="hint" style="margin-top:0">App dùng lặp lại ngắt quãng kiểu Anki: thẻ nhớ tốt được giãn dần, thẻ quên quay lại ngay rồi học lại từ đầu.</p>
        <div class="srs-cfg">
          ${fld('sc-new', 'Thẻ mới mỗi ngày', c.newPerDay, 0, 500, 1, 'Số thẻ chưa học đưa vào lượt ôn hôm nay.')}
          ${fld('sc-good', 'Nhớ lần đầu → ôn lại sau (ngày)', c.goodFirst, 1, 30, 1, 'Lần hai gấp 3 lần, sau đó nhân hệ số giãn.')}
          ${fld('sc-easy', 'Dễ lần đầu → ôn lại sau (ngày)', c.easyFirst, 1, 60, 1, 'Dễ còn tăng hệ số giãn thêm 0,15.')}
          ${fld('sc-ease', 'Hệ số giãn ban đầu', c.startEase, 1.3, 4, 0.1, 'Lớn hơn thì khoảng ôn dài ra nhanh hơn (Anki: 2,5).')}
          ${fld('sc-max', 'Khoảng ôn tối đa (ngày)', c.maxInterval, 7, 3650, 1, 'Thẻ đã thuộc vẫn được ôn lại ít nhất sau chừng này ngày.')}
        </div>
        <div class="srs-prev"><b>Thẻ luôn chấm Nhớ đúng hạn:</b> <span id="sc-prev">${preview(c)}</span></div>
        <p class="hint">Khó: thẻ mới quay lại trong lượt, thẻ cũ giãn chậm (×1,2). Quên: ôn lại ngay, hệ số giãn giảm 0,2. Ở “Tất cả thẻ”, chấm thẻ chưa tới hạn không đổi lịch (trừ Quên).</p>`,
      buttons: [{ label: 'Mặc định', value: 'reset' }, { label: 'Huỷ', value: null }, { label: 'Lưu', value: 'save', primary: true }],
      onOpen: (b) => {
        const read = () => srsConfig({ srs: { newPerDay: b.querySelector('#sc-new').value, goodFirst: b.querySelector('#sc-good').value, easyFirst: b.querySelector('#sc-easy').value, startEase: b.querySelector('#sc-ease').value, maxInterval: b.querySelector('#sc-max').value } });
        b.addEventListener('input', () => { b.querySelector('#sc-prev').textContent = preview(read()); });
        openSrsSettings.read = read;
      },
    });
    if (!r) return;
    const cfg = r === 'reset' ? { ...SRS_DEFAULTS } : openSrsSettings.read();
    await saveSettings({ srs: cfg });
    const n = await repairAll();
    toast(`Đã lưu nhịp ôn${n ? `, cập nhật lịch của ${n} thẻ theo khoảng tối đa mới` : ''}.`, 3000, 'ok');
    state.built = false;
    draw();
  }

  /** Sửa lịch ôn bất hợp lý (khoảng ôn bị nhân lên do chấm lặp ở bản cũ, hoặc dài hơn khoảng tối đa). */
  async function repairAll() {
    const byPaper = new Map();
    for (const { p, a } of allNotes()) {
      const fixed = repairSrs(a);
      if (!fixed) continue;
      if (!byPaper.has(p.id)) byPaper.set(p.id, new Map());
      byPaper.get(p.id).set(a.id, fixed);
    }
    let n = 0;
    for (const [pid, fixes] of byPaper) {
      const p = paperById(pid);
      if (!p) continue;
      n += fixes.size;
      await savePaper({ ...p, annotations: (p.annotations || []).map((a) => (fixes.has(a.id) ? { ...a, srs: fixes.get(a.id), known: fixes.get(a.id).interval >= 21 } : a)) });
    }
    return n;
  }

  const refilter = () => { state.idx = 0; state.deck = []; state.built = false; draw(); };
  $('nt-mode').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) { state.mode = b.dataset.m; state.deck = []; state.built = false; draw(); } });
  let qTimer = 0;
  $('nt-q').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value; refilter(); }, 200); });
  $('nt-paper').addEventListener('change', (e) => { state.paper = e.target.value; refilter(); });
  $('nt-sort').addEventListener('change', (e) => { state.sort = e.target.value; refilter(); });
  $('nt-tr').addEventListener('change', (e) => { state.onlyTr = e.target.checked; refilter(); });

  $('nt-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const item = btn.closest('.note-item');
    const p = paperById(item.dataset.p);
    const a = (p?.annotations || []).find((x) => x.id === item.dataset.a);
    if (!a) return;
    if (btn.dataset.act === 'say') { sayQuote(a.quote, prefAcc(), null); return; }
    if (btn.dataset.act === 'copy') { await copyText([a.quote, a.translation].filter(Boolean).join('\n')); toast('Đã sao chép.'); return; }
    if (btn.dataset.act === 'del') {
      if (!(await confirmDialog('Xoá đoạn ghi chú này?', { danger: true, okLabel: 'Xoá' }))) return;
      const before = p.annotations || [];
      await savePaper({ ...p, annotations: before.filter((x) => x.id !== a.id) });
      drawList();
      toast('Đã xoá.', 6000, '', { label: 'Hoàn tác', onClick: async () => { await savePaper({ ...paperById(p.id), annotations: before }); drawList(); } });
      return;
    }
    if (btn.dataset.act === 'edit') {
      const ok = await dialog({
        title: 'Sửa ghi chú', width: 560,
        body: `<label class="field"><span class="label-text">Đoạn gốc</span><textarea id="ne-q" rows="3">${escapeHtml(a.quote)}</textarea></label>
          <label class="field"><span class="label-text">Bản dịch</span><textarea id="ne-t" rows="3">${escapeHtml(a.translation || '')}</textarea></label>
          <label class="field"><span class="label-text">Nhận xét</span><textarea id="ne-n" rows="3">${escapeHtml(a.note || '')}</textarea></label>`,
        buttons: [{ label: 'Huỷ', value: false }, { label: 'Lưu', primary: true, onClick: async (b, close) => {
          await updateNote(p.id, a.id, { quote: b.querySelector('#ne-q').value.trim(), translation: b.querySelector('#ne-t').value.trim(), note: b.querySelector('#ne-n').value.trim() });
          close(true); return false;
        } }],
      });
      if (ok) drawList();
    }
  });

  const csvCell = (s) => `"${String(s || '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  $('nt-csv').addEventListener('click', () => {
    const rows = filtered().map(({ p, a }) => [csvCell(a.quote), csvCell([a.translation, a.note, `(${p.title}${a.page ? `, tr. ${a.page}` : ''})`].filter(Boolean).join(' — '))].join(','));
    if (!rows.length) return toast('Không có ghi chú nào để xuất.', 2500, 'err');
    download('papervault-ghi-chu.csv', `﻿${rows.join('\n')}`, 'text/csv;charset=utf-8');
  });
  $('nt-md').addEventListener('click', () => {
    const list = filtered();
    if (!list.length) return toast('Không có ghi chú nào để xuất.', 2500, 'err');
    const out = ['# Ghi chú đã lưu', ''];
    let last = '';
    for (const { p, a } of list) {
      if (state.sort === 'paper' && p.id !== last) { out.push(`## ${p.title}`, ''); last = p.id; }
      out.push(`> ${a.quote}${a.page ? ` (tr. ${a.page})` : ''}`, '');
      if (a.translation) out.push(`**Dịch:** ${a.translation}`, '');
      if (a.note) out.push(a.note, '');
      if (state.sort !== 'paper') out.push(`_${p.title}_`, '');
    }
    download('papervault-ghi-chu.md', out.join('\n'), 'text/markdown;charset=utf-8');
  });

  draw();
  return () => { document.removeEventListener('keydown', onKey); stopSpeaking(); };
}
