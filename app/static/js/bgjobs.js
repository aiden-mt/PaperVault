// Theo dõi các việc AI chạy nền (Bài giảng, Có gì mới, Hướng nghiên cứu…) và hiện bảng nổi ở góc màn hình khi người dùng
// đang ở trang khác: thanh tiến độ chạy tiếp đúng chỗ (không tính lại từ đầu), xong thì báo và có nút mở kết quả.
import { escapeHtml } from './util.js';
import { showProgress } from './ui.js';

const tracked = new Map(); // key -> { job, label, title, href, here, doneAt }
let tray = null;
let timer = 0;

/**
 * Bắt đầu theo dõi một job ({ status, step, of, done, error, listeners }).
 * here(): true khi trang đang mở đã tự hiện tiến độ của job này (khi đó bảng nổi ẩn thẻ của nó).
 */
export function trackJob(key, job, { label, title = '', href = '', here = () => false, expectedMs = () => 40000 }) {
  if (!job) return job;
  if (!job.startedAt) {
    job.startedAt = Date.now();
    job.stepAt = Date.now();
    job.lastStep = job.step;
    job.listeners.add((j) => {
      if (j.step !== j.lastStep) { j.lastStep = j.step; j.stepAt = Date.now(); }
      if (j.done && !j.finishedAt) j.finishedAt = Date.now();
      render();
    });
  }
  tracked.set(key, { job, label, title, href, here, expectedMs });
  render();
  return job;
}

/** Tuỳ chọn cho showProgress để thanh tiến độ của job chạy tiếp đúng chỗ khi vẽ lại. */
export const jobProgressOpts = (job, expectedMs) => ({ step: job.step, of: job.of, expectedMs, startedAt: job.startedAt, stepStartedAt: job.stepAt });

function ensureTray() {
  if (tray && tray.isConnected) return tray;
  tray = document.createElement('div');
  tray.className = 'bg-tray';
  tray.setAttribute('role', 'status');
  document.body.appendChild(tray);
  tray.addEventListener('click', (e) => {
    const x = e.target.closest('[data-bg-close]');
    if (x) { tracked.delete(x.dataset.bgClose); render(); return; }
    const open = e.target.closest('[data-bg-open]');
    if (open) {
      const t = tracked.get(open.dataset.bgOpen);
      if (t?.job.done) tracked.delete(open.dataset.bgOpen);
      if (t?.href) location.hash = t.href;
      render();
    }
  });
  return tray;
}

function render() {
  const now = Date.now();
  // Việc đã xong được báo 12 giây rồi tự ẩn (trừ khi lỗi: giữ tới khi người dùng đóng).
  for (const [k, t] of tracked) if (t.job.done && !t.job.error && t.job.finishedAt && now - t.job.finishedAt > 12000) tracked.delete(k);
  // Trang đang mở đã tự hiện việc này thì ẩn thẻ; việc đã xong mà người dùng đang xem kết quả thì bỏ luôn.
  for (const [k, t] of tracked) if (t.job.done && t.here()) tracked.delete(k);
  const shown = [...tracked.entries()].filter(([, t]) => !t.here());
  if (!shown.length) { if (tray) tray.hidden = true; stopTimer(); return; }
  const node = ensureTray();
  node.hidden = false;
  // Tránh đè lên bảng tiến trình trích xuất hàng loạt nếu đang hiện.
  const jp = document.getElementById('job-panel');
  node.style.bottom = jp && !jp.hidden && jp.offsetParent ? `${jp.offsetHeight + 32}px` : '';
  const keys = new Set(shown.map(([k]) => k));
  node.querySelectorAll('.bg-card').forEach((c) => { if (!keys.has(c.dataset.key)) c.remove(); });
  for (const [key, t] of shown) {
    let card = node.querySelector(`.bg-card[data-key="${CSS.escape(key)}"]`);
    const state = t.job.done ? (t.job.error ? 'err' : 'ok') : 'run';
    if (!card || card.dataset.state !== state) {
      const html = `<div class="bg-card ${state}" data-key="${escapeHtml(key)}" data-state="${state}">
        <div class="bg-head"><b>${state === 'ok' ? '✓ ' : state === 'err' ? '⚠ ' : ''}${escapeHtml(t.label)}</b><span class="spacer"></span>
          ${t.href ? `<button class="sm" data-bg-open="${escapeHtml(key)}">${state === 'run' ? 'Xem' : 'Mở'}</button>` : ''}
          <button class="ghost sm" data-bg-close="${escapeHtml(key)}" title="Ẩn (việc vẫn chạy tiếp)">✕</button></div>
        ${t.title ? `<div class="bg-title" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</div>` : ''}
        <div class="bg-body">${state === 'ok' ? '<span class="hint">Đã xong, kết quả đã được lưu.</span>' : state === 'err' ? `<span class="status err">${escapeHtml(t.job.error)}</span>` : ''}</div></div>`;
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const fresh = tmp.firstElementChild;
      if (card) card.replaceWith(fresh); else node.appendChild(fresh);
      card = fresh;
    }
    if (state === 'run') showProgress(card.querySelector('.bg-body'), t.job.status, jobProgressOpts(t.job, t.expectedMs(t.job)));
  }
  startTimer();
}

// Kiểm tra lại định kỳ: người dùng chuyển trang / tab thì thẻ tương ứng hiện hoặc ẩn.
function startTimer() { if (!timer) timer = setInterval(render, 1000); }
function stopTimer() { clearInterval(timer); timer = 0; }
window.addEventListener('hashchange', () => setTimeout(render, 50));
