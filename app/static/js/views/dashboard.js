// Trang tổng quan: số liệu, phân bố theo chủ đề/năm, paper gần đây, hàng đợi đọc, tag.
import { srsStats } from '../srs.js';
import { store, stats, onChange, topicOf, saveSettings } from '../store.js';
import { escapeHtml, fmtRelative, STATUS_LABEL, stars } from '../util.js';
import { topicBadge } from '../ui.js';
import { hasCredentials } from '../llm.js';
import { api } from '../api.js';
import { primaryRank } from '../venue.js';

function card(p) {
  const e = p.extraction || {};
  return `<div class="paper" data-id="${p.id}">
    <div class="body">
      <div class="t">${escapeHtml(p.title)}</div>
      <div class="meta">${topicBadge(topicOf(p))}<span class="badge st-${p.status || 'to-read'}">${STATUS_LABEL[p.status || 'to-read']}</span>
        ${e.year ? `<span class="badge">${escapeHtml(e.year)}</span>` : ''}${p.rating ? `<span class="stars">${'★'.repeat(p.rating)}</span>` : ''}
        <span class="hint">${fmtRelative(p.updatedAt)}</span></div>
      <div class="line"><b>Điểm mới:</b> ${escapeHtml(e.novelty || '—')}</div>
    </div></div>`;
}

let chatCount = 0;

export async function render(root) {
  let feedUnseen = 0;
  api.chats().then((l) => { chatCount = l.length; draw(); }).catch(() => {});
  let monthTokens = null;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  api.kvGet('feedUnseen').then((n) => { feedUnseen = n || 0; draw(); }).catch(() => {});
  api.usage(monthStart.toISOString()).then((u) => { monthTokens = u.totals.reduce((a, t) => a + t.inputTokens + t.outputTokens, 0); draw(); }).catch(() => {});
  const draw = () => {
    const s = stats();
    const topicRows = [...s.byTopic.entries()]
      .map(([id, n]) => ({ t: store.topics.find((x) => x.id === id) || { id, name: 'Chưa phân loại', color: '#888' }, n }))
      .sort((a, b) => b.n - a.n);
    const maxT = Math.max(1, ...topicRows.map((r) => r.n));
    const years = [...s.byYear.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).slice(-10);
    const maxY = Math.max(1, ...years.map((y) => y[1]));
    const recent = store.papers.slice(0, 6);
    const queue = store.papers.filter((p) => (p.status || 'to-read') === 'to-read').sort((a, b) => (b.rating || 0) - (a.rating || 0) || String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 6);
    const tags = [...s.tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    const noKey = !hasCredentials(store.settings);

    const srs = srsStats(store.papers);
    root.innerHTML = `
      <div class="page-head"><h1>Tổng quan</h1><span class="hint">${store.settings.myResearch ? `Đề tài: ${escapeHtml(store.settings.myResearch.slice(0, 120))}${store.settings.myResearch.length > 120 ? '…' : ''}` : 'Chưa mô tả đề tài — vào Cài đặt để mục "Ý tưởng áp dụng" bám sát bài của bạn.'}</span></div>
      ${noKey ? `<div class="dup-warn">Chưa có API key. <a href="#/settings">Mở Cài đặt</a> để nhập key Claude / OpenAI / Gemini trước khi trích xuất paper.</div>` : ''}
      <div class="tiles">
        <div class="tile clickable" data-go="#/library"><div class="n">${s.total}</div><div class="l">paper trong thư viện</div></div>
        <div class="tile clickable" data-go="#/library?status=to-read"><div class="n">${s.byStatus['to-read'] || 0}</div><div class="l">chưa đọc</div></div>
        <div class="tile clickable" data-go="#/library?status=reading"><div class="n">${s.byStatus.reading || 0}</div><div class="l">đang đọc</div></div>
        <div class="tile clickable" data-go="#/library?status=done"><div class="n">${s.byStatus.done || 0}</div><div class="l">đã đọc</div></div>
        <div class="tile clickable" data-go="#/topics"><div class="n">${store.topics.length}</div><div class="l">chủ đề</div></div>
        ${srs.total ? `<div class="tile clickable" data-go="#/notes?mode=review" title="Thẻ ghi nhớ tới hạn ôn và thẻ mới của hôm nay"${srs.due ? ' style="border-color:var(--accent)"' : ''}><div class="n">${srs.due}</div><div class="l">thẻ cần ôn hôm nay</div></div>` : ''}
        <div class="tile clickable" data-go="#/feed"><div class="n">${feedUnseen}</div><div class="l">paper mới trên arXiv chưa xem</div></div>
        ${store.inbox.length ? `<div class="tile clickable" data-go="#/add" style="border-color:var(--accent)"><div class="n">${store.inbox.length}</div><div class="l">chờ xử lý từ extension</div></div>` : ''}
        <div class="tile clickable" data-go="#/settings"><div class="n">${monthTokens == null ? '…' : (monthTokens >= 1e6 ? `${(monthTokens / 1e6).toFixed(1)}M` : (monthTokens >= 1e3 ? `${Math.round(monthTokens / 1e3)}K` : monthTokens))}</div><div class="l">token đã dùng tháng này</div></div>
      </div>
      ${(() => { const d = store.lastCitationRefresh ? (Date.now() - new Date(store.lastCitationRefresh).getTime()) / 86400000 : 999; return s.total >= 3 && d > 14 ? `<div class="hint" style="margin:-6px 0 12px">Số trích dẫn ${store.lastCitationRefresh ? `đã ${Math.floor(d)} ngày chưa cập nhật` : 'chưa cập nhật lần nào'}. <a href="#/settings">Cập nhật trong Cài đặt</a>.</div>` : ''; })()}
      ${onboardingHtml(s)}
      ${s.total === 0 ? `<div class="card empty">Thư viện đang trống. <a href="#/add">Thêm paper đầu tiên</a> bằng link arXiv, DOI, file PDF hoặc dán abstract.<br><span class="hint">Có dữ liệu từ extension? Vào Cài đặt → Nhập JSON sao lưu.</span></div>` : ''}
      <div class="grid-2">
        <div class="card"><h2>Paper theo chủ đề</h2>
          <div class="bars">${topicRows.map((r) => `<div class="bar-row" data-go="#/library/${r.t.id}" title="${escapeHtml(r.t.name)}: ${r.n} paper">
            <span class="bar-lbl"><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${escapeHtml(r.t.color || '#888')};margin-right:6px"></i>${escapeHtml(r.t.name)}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${(r.n / maxT) * 100}%"></span></span>
            <span class="bar-val">${r.n}</span></div>`).join('') || '<span class="hint">Chưa có dữ liệu.</span>'}</div>
        </div>
        <div class="card"><h2>Paper theo năm công bố</h2>
          ${years.length ? `<div class="cols">${years.map(([y, n]) => `<div class="col" data-go="#/library?year=${y}" title="${y}: ${n} paper"><div class="c-fill" data-v="${n}" style="height:${(n / maxY) * 100}%"></div><div class="c-lbl">${y}</div></div>`).join('')}</div>` : '<span class="hint">Chưa có dữ liệu.</span>'}
          <h2 style="margin-top:16px">Hạng venue</h2>
          ${rankBars()}
          <h2 style="margin-top:16px">Tag phổ biến</h2>
          <div class="tag-cloud">${tags.map(([t, n]) => `<span class="badge accent" data-go="#/library?tag=${encodeURIComponent(t)}">#${escapeHtml(t)} <span class="hint">${n}</span></span>`).join('') || '<span class="hint">Chưa có tag.</span>'}</div>
        </div>
      </div>
      <div class="grid-2">
        <div class="card"><h2>Cập nhật gần đây</h2>${recent.map(card).join('') || '<span class="hint">Chưa có.</span>'}</div>
        <div class="card"><h2>Hàng đợi đọc (chưa đọc, ưu tiên đánh giá cao)</h2>${queue.map(card).join('') || '<span class="hint">Không còn paper chưa đọc.</span>'}</div>
      </div>`;
  };
  draw();
  // root là khung chung của mọi trang: phải gỡ sự kiện khi rời Tổng quan, không thì bấm ở trang khác cũng bị bắt.
  const onClick = (e) => {
    const go = e.target.closest('[data-go]');
    if (go && go.dataset.go === '__dismiss') {
      // lưu cả vào cài đặt trên máy chủ: localStorage có thể mất (đổi cổng, xoá dữ liệu trình duyệt, máy khác)
      try { localStorage.setItem('pv-onboard-done', '1'); } catch (_) { /* bỏ qua */ }
      saveSettings({ onboardDismissed: true }).catch(() => {});
      draw();
      return;
    }
    if (go) { location.hash = go.dataset.go; return; }
    const card = e.target.closest('.paper[data-id]');
    if (card) location.hash = `#/paper/${card.dataset.id}`;
  };
  root.addEventListener('click', onClick);
  const unsub = onChange(draw);
  return () => { root.removeEventListener('click', onClick); unsub(); };
}

function onboardingHtml(s) {
  let dismissed = false;
  try { dismissed = localStorage.getItem('pv-onboard-done') === '1'; } catch (_) { /* bỏ qua */ }
  if (store.settings.onboardDismissed) dismissed = true;
  const steps = [
    [hasCredentials(store.settings), 'Nhập API key và bấm Kiểm tra kết nối', '#/settings'],
    [!!(store.settings.myResearch || '').trim(), 'Mô tả đề tài của bạn trong Cài đặt', '#/settings'],
    [s.total > 0, 'Thêm paper đầu tiên (link, PDF hoặc hàng loạt)', '#/add'],
    [store.papers.some((p) => (p.userNotes || '').trim() || (p.annotations || []).length), 'Ghi chú hoặc đánh dấu một đoạn trong paper', '#/library'],
    [chatCount > 0, 'Chọn vài paper và hỏi trong Chat', '#/chat'],
  ];
  const done = steps.filter((x) => x[0]).length;
  if (dismissed || done === steps.length) return '';
  return `<div class="card onboarding"><div class="row"><h2 style="margin:0">Bắt đầu với PaperVault · ${done}/${steps.length}</h2><span class="spacer"></span><a href="#/help?s=start">Xem hướng dẫn</a><button class="ghost sm" data-go="__dismiss" title="Ẩn">✕</button></div>
    <ul class="checklist">${steps.map(([ok, label, href]) => `<li class="${ok ? 'ok' : ''}"><span>${ok ? '✓' : '○'}</span><a href="${href}">${escapeHtml(label)}</a></li>`).join('')}</ul></div>`;
}

function rankBars() {
  const groups = [['A*', 'CORE A*'], ['A', 'CORE A'], ['B', 'CORE B'], ['C', 'CORE C'], ['Q1', 'SJR Q1'], ['Q2', 'SJR Q2'], ['Q3', 'SJR Q3'], ['Q4', 'SJR Q4']];
  const counts = new Map();
  let other = 0;
  for (const p of store.papers) {
    const r = primaryRank(p.venueInfo);
    if (groups.some((g) => g[0] === r)) counts.set(r, (counts.get(r) || 0) + 1); else other++;
  }
  const rows = groups.filter(([k]) => counts.get(k));
  if (!rows.length) return '<span class="hint">Chưa có paper nào có hạng venue.</span>';
  const max = Math.max(...rows.map(([k]) => counts.get(k)), other || 0, 1);
  return `<div class="bars">${rows.map(([k, l]) => `<div class="bar-row" data-go="#/library?rank=${encodeURIComponent(k)}" title="${l}: ${counts.get(k)} paper"><span class="bar-lbl">${l}</span><span class="bar-track"><span class="bar-fill" style="width:${(counts.get(k) / max) * 100}%"></span></span><span class="bar-val">${counts.get(k)}</span></div>`).join('')}
    ${other ? `<div class="bar-row" data-go="#/library?rank=none" title="Chưa có hạng: ${other} paper"><span class="bar-lbl hint">Chưa có hạng</span><span class="bar-track"><span class="bar-fill muted-fill" style="width:${(other / max) * 100}%"></span></span><span class="bar-val">${other}</span></div>` : ''}</div>`;
}
