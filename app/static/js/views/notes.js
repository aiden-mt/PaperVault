// Ghi chú & thẻ ghi nhớ: gom mọi đoạn đã lưu bằng "+ Ghi chú" (bong bóng dịch trong PDF và ở mọi trang) và các trích dẫn
// thêm tay, của tất cả paper. Hai chế độ: danh sách để tìm, sửa, xoá, xuất; và thẻ ghi nhớ để ôn (mặt trước đoạn gốc,
// lật ra bản dịch và nhận xét). Đánh dấu "Nhớ rồi" lưu ngay trên đoạn ghi chú (annotation.known).
import { store, savePaper, paperById } from '../store.js';
import { escapeHtml, fmtDate, copyText, download } from '../util.js';
import { $, toast, confirmDialog, dialog, mdToHtml } from '../ui.js';
import { rich, titleHtml } from '../richtext.js';

const state = { mode: 'list', q: '', paper: '', sort: 'new', onlyTr: false, onlyUnknown: false, deck: [], idx: 0, flipped: false };

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

export async function render(root) {
  root.innerHTML = `<div class="page-head"><h1>Ghi chú &amp; thẻ ghi nhớ</h1><span class="hint">Các đoạn đã lưu bằng nút + Ghi chú khi bôi đen để dịch, và các trích dẫn bạn thêm tay ở trang paper.</span></div>
    <div class="notes-bar">
      <div class="seg" id="nt-mode"><button data-m="list">Danh sách</button><button data-m="cards">Thẻ ghi nhớ</button></div>
      <input type="search" id="nt-q" placeholder="Tìm trong đoạn gốc, bản dịch, nhận xét, tên paper…">
      <select id="nt-paper"></select>
      <select id="nt-sort"><option value="new">Mới nhất</option><option value="old">Cũ nhất</option><option value="paper">Theo paper</option></select>
      <label class="row" style="gap:6px"><input type="checkbox" id="nt-tr"> Chỉ đoạn có bản dịch</label>
      <span class="spacer"></span>
      <button class="sm" id="nt-csv" title="Hai cột Mặt trước (đoạn gốc) và Mặt sau (bản dịch, nhận xét), nhập được vào Anki hoặc Quizlet">Tải CSV (Anki)</button>
      <button class="sm" id="nt-md">Tải Markdown</button>
    </div>
    <div id="nt-body"></div>`;

  const papersWith = [...new Map(allNotes().map(({ p }) => [p.id, p])).values()].sort((a, b) => a.title.localeCompare(b.title));
  $('nt-paper').innerHTML = `<option value="">Mọi paper (${papersWith.length})</option>${papersWith.map((p) => `<option value="${p.id}">${escapeHtml(p.title.slice(0, 70))} (${(p.annotations || []).length})</option>`).join('')}`;
  $('nt-paper').value = papersWith.some((p) => p.id === state.paper) ? state.paper : '';
  $('nt-q').value = state.q;
  $('nt-sort').value = state.sort;
  $('nt-tr').checked = state.onlyTr;

  const draw = () => {
    $('nt-mode').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.m === state.mode));
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
          <div class="hint note-meta"><a href="#/paper/${p.id}?tab=notes">${titleHtml(p.title)}</a>${a.page ? ` · tr. ${escapeHtml(a.page)}` : ''}${a.at ? ` · ${fmtDate(a.at)}` : ''}${a.known ? ' · <b class="ok-text">đã nhớ</b>' : ''}</div>
        </div>
        <div class="note-acts"><button class="ghost sm" data-act="copy" title="Sao chép đoạn gốc và bản dịch">⧉</button><button class="ghost sm" data-act="edit" title="Sửa">✎</button><button class="ghost sm" data-act="del" title="Xoá">🗑</button></div>
      </div>`).join('') || '<div class="empty">Không có đoạn nào khớp bộ lọc.</div>'}`;
  }

  function buildDeck() {
    let list = filtered();
    if (state.onlyUnknown) list = list.filter(({ a }) => !a.known);
    state.deck = list.map(({ p, a }) => ({ pid: p.id, aid: a.id }));
    state.idx = Math.min(state.idx, Math.max(0, state.deck.length - 1));
    state.flipped = false;
  }

  function drawCards() {
    if (!state.deck.length) buildDeck();
    const card = state.deck[state.idx];
    const p = card && paperById(card.pid);
    const a = p && (p.annotations || []).find((x) => x.id === card.aid);
    const known = state.deck.filter((c) => (paperById(c.pid)?.annotations || []).find((x) => x.id === c.aid)?.known).length;
    $('nt-body').innerHTML = `<div class="fc-bar"><span class="hint">${state.deck.length ? `Thẻ ${state.idx + 1}/${state.deck.length} · đã nhớ ${known}` : 'Không có thẻ nào khớp bộ lọc.'}</span><span class="spacer"></span>
        <label class="row" style="gap:6px"><input type="checkbox" id="fc-unknown" ${state.onlyUnknown ? 'checked' : ''}> Chỉ thẻ chưa nhớ</label>
        <button class="sm" id="fc-shuffle">Trộn thẻ</button></div>
      ${a ? `<div class="fc-card ${state.flipped ? 'flipped' : ''}" id="fc-card" tabindex="0" title="Bấm hoặc nhấn Space để lật">
          <div class="fc-face fc-front"><div class="fc-label">Đoạn gốc</div><div class="fc-text">${rich(a.quote)}</div><div class="hint fc-src">${titleHtml(p.title)}${a.page ? ` · tr. ${escapeHtml(a.page)}` : ''}</div></div>
          ${state.flipped ? `<div class="fc-face fc-back"><div class="fc-label">Bản dịch</div><div class="fc-text">${a.translation ? rich(a.translation) : '<span class="hint">(chưa có bản dịch)</span>'}</div>${a.note ? `<div class="fc-note">${mdToHtml(a.note)}</div>` : ''}</div>` : '<div class="hint fc-tap">Bấm vào thẻ hoặc nhấn Space để xem bản dịch</div>'}
        </div>
        <div class="fc-actions">
          <button class="sm" id="fc-prev" ${state.idx ? '' : 'disabled'}>Trước <kbd>←</kbd></button>
          <button class="sm" id="fc-flip">${state.flipped ? 'Úp lại' : 'Lật thẻ'} <kbd>Space</kbd></button>
          <button class="sm ${a.known ? '' : 'primary'}" id="fc-known">${a.known ? 'Bỏ đánh dấu đã nhớ' : 'Nhớ rồi'} <kbd>1</kbd></button>
          <button class="sm" id="fc-next" ${state.idx < state.deck.length - 1 ? '' : 'disabled'}>Sau <kbd>→</kbd></button>
        </div>
        <p class="hint" style="text-align:center">Phím tắt: Space lật thẻ, ← → chuyển thẻ, 1 đánh dấu nhớ rồi.</p>` : ''}`;
    $('fc-unknown').addEventListener('change', (e) => { state.onlyUnknown = e.target.checked; state.idx = 0; buildDeck(); drawCards(); });
    $('fc-shuffle').addEventListener('click', () => { for (let i = state.deck.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [state.deck[i], state.deck[j]] = [state.deck[j], state.deck[i]]; } state.idx = 0; state.flipped = false; drawCards(); });
    if (!a) return;
    const go = (d) => { const n = state.idx + d; if (n >= 0 && n < state.deck.length) { state.idx = n; state.flipped = false; drawCards(); } };
    $('fc-card').addEventListener('click', () => { state.flipped = !state.flipped; drawCards(); });
    $('fc-flip').addEventListener('click', () => { state.flipped = !state.flipped; drawCards(); });
    $('fc-prev').addEventListener('click', () => go(-1));
    $('fc-next').addEventListener('click', () => go(1));
    $('fc-known').addEventListener('click', async () => {
      await updateNote(card.pid, card.aid, { known: !a.known, knownAt: new Date().toISOString() });
      if (!a.known && state.idx < state.deck.length - 1) { state.idx += 1; state.flipped = false; }
      drawCards();
    });
  }

  // Phím tắt của thẻ ghi nhớ (chỉ khi đang ở chế độ thẻ, không gõ trong ô nhập).
  const onKey = (e) => {
    if (!$('nt-body')) { document.removeEventListener('keydown', onKey); return; }
    if (state.mode !== 'cards' || e.target?.closest?.('input, textarea, select')) return;
    if (e.key === ' ') { e.preventDefault(); $('fc-flip')?.click(); }
    else if (e.key === 'ArrowLeft') $('fc-prev')?.click();
    else if (e.key === 'ArrowRight') $('fc-next')?.click();
    else if (e.key === '1') $('fc-known')?.click();
  };
  document.addEventListener('keydown', onKey);

  const refilter = () => { state.idx = 0; state.deck = []; draw(); };
  $('nt-mode').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) { state.mode = b.dataset.m; state.deck = []; draw(); } });
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
}
