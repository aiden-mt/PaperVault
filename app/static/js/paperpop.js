// Thẻ nổi tóm tắt một paper trong thư viện (bấm mã P1, P2… ở trang So sánh và trong câu trả lời của Chat):
// tên, tác giả, năm, venue, chủ đề, trạng thái, tóm tắt, dataset, và nút "Mở paper" thay vì tự chuyển trang.
import { topicOf, paperById } from './store.js';
import { escapeHtml, STATUS_LABEL } from './util.js';
import { topicBadge } from './ui.js';
import { venueBadge } from './venue.js';
import { rich, titleHtml } from './richtext.js';

let pop = null;
export const closePaperPop = () => {
  pop?.remove();
  pop = null;
  document.removeEventListener('mousedown', popOutside, true);
  document.removeEventListener('keydown', popKey, true);
  window.removeEventListener('hashchange', closePaperPop);
};
const popOutside = (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('[data-ppop]')) closePaperPop(); };
const popKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePaperPop(); } };

function paperPopHtml(p, tag, actions) {
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
    <div class="wn-pop-badges"><span class="badge accent">${escapeHtml(tag)}</span>${venueBadge(p.venueInfo)}${topicBadge(topicOf(p))}${p.citationCount != null ? `<span class="badge">↗ ${Number(p.citationCount).toLocaleString('vi-VN')} trích dẫn</span>` : ''}${status ? `<span class="badge">${escapeHtml(status)}</span>` : ''}</div>
    ${summary ? `<p class="wn-pop-abs">${rich(String(summary).slice(0, 420))}${String(summary).length > 420 ? '…' : ''}</p>` : ''}
    ${ds.length ? `<div class="pp-ds"><span class="hint">Dataset / benchmark:</span> ${ds.map((d) => `<span class="badge">${escapeHtml(d)}</span>`).join(' ')}</div>` : ''}
    <div class="row wrap" style="gap:6px;margin-top:10px">
      <a class="btn sm primary-link" href="#/paper/${p.id}">Mở paper</a>
      ${p.url ? `<a class="btn sm" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">Mở link</a>` : ''}
      ${actions.map((a, i) => `<button class="sm" data-pp-act="${i}">${escapeHtml(a.label)}</button>`).join('')}
    </div>`;
}

/**
 * Mở thẻ cạnh phần tử anchor. tag: nhãn hiện trên thẻ (mặc định chữ của anchor).
 * actions: nút thêm [{ label, onClick(id) }] (ví dụ "Bỏ khỏi so sánh"). Bấm lại cùng mã thì đóng.
 */
export function openPaperPop(anchor, id, { tag = '', actions = [] } = {}) {
  const p = paperById(id);
  if (!p) return;
  const same = pop && pop.dataset.id === id && pop.dataset.anchor === (anchor.dataset.ppopKey || '');
  closePaperPop();
  if (same) return;
  pop = document.createElement('div');
  pop.className = 'wn-pop pp-pop';
  pop.dataset.id = id;
  pop.dataset.anchor = anchor.dataset.ppopKey || '';
  pop.innerHTML = paperPopHtml(p, tag || (anchor.querySelector('b')?.textContent || anchor.textContent || '').trim(), actions);
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
  pop.querySelector('.wn-pop-x').addEventListener('click', closePaperPop);
  pop.querySelectorAll('a[href^="#/"]').forEach((a) => a.addEventListener('click', closePaperPop));
  pop.querySelectorAll('[data-pp-act]').forEach((b) => b.addEventListener('click', () => { const a = actions[Number(b.dataset.ppAct)]; closePaperPop(); a?.onClick?.(id); }));
  document.addEventListener('mousedown', popOutside, true);
  document.addEventListener('keydown', popKey, true);
  window.addEventListener('hashchange', closePaperPop);
}
