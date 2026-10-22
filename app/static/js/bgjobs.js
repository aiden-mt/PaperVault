// Theo dõi các việc AI chạy nền (Bài giảng, Có gì mới, Hướng nghiên cứu…) và hiện bảng nổi ở góc màn hình khi người dùng
// đang ở trang khác: thanh tiến độ chạy tiếp đúng chỗ (không tính lại từ đầu), xong thì báo và có nút mở kết quả.
import { escapeHtml } from './util.js';
import { showProgress, endProgress } from './ui.js';

const tracked = new Map(); // key -> { job, label, title, href, here, doneAt }
let tray = null;
let timer = 0;

/**
 * Bắt đầu theo dõi một job ({ status, step, of, done, error, listeners }).
 * here(): true khi trang đang mở đã tự hiện tiến độ của job này (khi đó bảng nổi ẩn thẻ của nó).
 */
export function trackJob(key, job, { label, title = '', href = '', here = () => false, expectedMs = () => 40000, doneText = '' }) {
  if (!job) return job;
  if (!job.tracked) {
    job.tracked = true;
    if (!job.startedAt) { job.startedAt = Date.now(); job.stepAt = Date.now(); }
    job.lastStep = job.step;
    job.listeners.add((j) => {
      if (j.step !== j.lastStep) { j.lastStep = j.step; j.stepAt = Date.now(); }
      if (j.done && !j.finishedAt) j.finishedAt = Date.now();
      render();
    });
  }
  tracked.set(key, { job, label, title, href, here, expectedMs, doneText });
  render();
  return job;
}

/** Tuỳ chọn cho showProgress để thanh tiến độ của job chạy tiếp đúng chỗ khi vẽ lại. */
export const jobProgressOpts = (job, expectedMs) => ({ step: job.step, of: job.of, ...(job.pct != null ? { pct: job.pct } : {}), expectedMs, startedAt: job.startedAt, stepStartedAt: job.stepAt });

/* ---------- Job chung cho việc chạy một lần (trích xuất lại, tô câu, dịch bằng AI, hỏi đáp…) ---------- */

const jobs = new Map(); // key -> job, giữ cả job đã xong để trang mở lại lấy được kết quả

/** Job rỗng: update(status, { step, of, pct }) báo tiến độ, finish(error) kết thúc. */
export function makeJob() {
  const job = { status: 'Đang chuẩn bị…', step: null, of: 0, pct: null, done: false, error: '', result: undefined, listeners: new Set(), startedAt: Date.now(), stepAt: Date.now() };
  const emit = () => { for (const fn of [...job.listeners]) { try { fn(job); } catch (_) { /* trang đã đóng */ } } };
  job.update = (status, o = {}) => {
    if (status) job.status = status;
    if (o.step != null && o.step !== job.step) { job.step = o.step; job.stepAt = Date.now(); }
    if (o.of != null) job.of = o.of;
    if (o.pct !== undefined) job.pct = o.pct;
    emit();
  };
  job.finish = (error = '') => { job.error = error; job.done = true; emit(); };
  return job;
}

export const getJob = (key) => jobs.get(key) || null;
export const jobRunning = (key) => { const j = jobs.get(key); return !!j && !j.done; };

/**
 * Chạy fn(update) thành job nền: rời trang thì việc vẫn chạy và tự lưu, trang mở lại thì thấy thanh tiến độ chạy tiếp
 * đúng chỗ, ở trang khác thì hiện thẻ ở bảng nổi (track: tuỳ chọn của trackJob). Gọi lại cùng key khi việc đang chạy
 * thì trả về job cũ, không gọi model thêm lần nữa. job.promise xong khi việc xong (kể cả lỗi, xem job.error).
 */
export function runJob(key, fn, track = null) {
  const cur = jobs.get(key);
  if (cur && !cur.done) return cur;
  const job = makeJob();
  job.key = key;
  jobs.set(key, job);
  if (track) trackJob(key, job, track);
  job.promise = Promise.resolve()
    .then(() => fn(job.update))
    .then((r) => { job.result = r; job.finish(); }, (e) => { job.cause = e; job.finish(e?.message || String(e)); })
    .then(() => job);
  return job;
}

/**
 * Vẽ tiến độ của job vào target (id hoặc phần tử) cho tới khi xong. Trang vẽ lại thì phần tử cũ bị gỡ và thôi theo
 * dõi, trang mới gọi followJob lại với phần tử mới. onDone(job) chạy một lần nếu phần tử còn trên trang lúc job xong.
 */
export function followJob(job, target, { expectedMs = 40000, onDone = null } = {}) {
  const node = typeof target === 'string' ? document.getElementById(target) : target;
  if (!job || !node) return () => {};
  const ms = typeof expectedMs === 'function' ? expectedMs : () => expectedMs;
  const fn = (j) => {
    if (!node.isConnected) { j.listeners.delete(fn); return; }
    if (j.done) { j.listeners.delete(fn); endProgress(node); onDone?.(j); return; }
    showProgress(node, j.status, jobProgressOpts(j, ms(j)));
  };
  job.listeners.add(fn);
  fn(job);
  return () => job.listeners.delete(fn);
}

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
      const href = typeof t?.href === 'function' ? t.href() : t?.href;
      if (href) location.hash = href;
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
        <div class="bg-body">${state === 'ok' ? `<span class="hint">${escapeHtml((typeof t.doneText === 'function' ? t.doneText(t.job) : t.doneText) || 'Đã xong, kết quả đã được lưu.')}</span>` : state === 'err' ? `<span class="status err">${escapeHtml(t.job.error)}</span>` : ''}</div></div>`;
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

/** Tên các việc nền đang chạy trong cửa sổ này (dùng để hỏi lại trước khi đóng một khung chia đôi). */
export function busyLabels() {
  const out = [];
  for (const [key, t] of tracked) if (!t.job.done) out.push(t.label || key);
  for (const [key, j] of jobs) if (!j.done && !tracked.has(key)) out.push('Việc nền đang chạy');
  return [...new Set(out)];
}
