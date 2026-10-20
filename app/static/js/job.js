// Bảng tiến trình nổi cho việc chạy nền nhiều bước (trích xuất lại, tìm PDF hàng loạt...): thanh tiến độ, paper đang
// xử lý, nút Dừng. Mỗi lúc chỉ chạy một việc. Việc vẫn chạy tiếp khi người dùng chuyển trang trong app.
import { el } from './ui.js';

let current = null;

export const jobRunning = () => !!current;

export function startJob(name) {
  if (current) return null;
  let node = document.getElementById('job-panel');
  if (!node) {
    node = el(`<div id="job-panel" class="job-panel" role="status">
      <div class="row"><b id="job-title"></b><span class="spacer"></span><button id="job-stop" class="sm">Dừng</button></div>
      <div class="job-bar"><i id="job-fill"></i></div>
      <div id="job-now" class="job-now"></div>
      <div id="job-sub" class="hint"></div></div>`);
    document.body.appendChild(node);
    node.querySelector('#job-stop').addEventListener('click', () => {
      if (!current) return;
      current.stop = true;
      node.querySelector('#job-stop').disabled = true;
      node.querySelector('#job-sub').textContent = 'Sẽ dừng sau paper đang xử lý…';
    });
  }
  // Trong một bước (thường là một lượt gọi model) thanh nhích dần theo thời gian, tối đa 92% của bước đó.
  let stepAt = Date.now();
  let cur = { i: 0, total: 1 };
  const fill = () => { const span = 100 / cur.total; node.querySelector('#job-fill').style.width = `${(span * cur.i + span * 0.92 * (1 - Math.exp(-(Date.now() - stepAt) / 40000))).toFixed(1)}%`; };
  const timer = setInterval(fill, 300);
  const job = {
    stop: false,
    step(i, total, title, msg = '') {
      node.querySelector('#job-title').textContent = `${name} ${i + 1}/${total}`;
      if (i !== cur.i || total !== cur.total) { cur = { i, total }; stepAt = Date.now(); }
      fill();
      node.querySelector('#job-now').textContent = title || '';
      if (!job.stop) node.querySelector('#job-sub').textContent = msg;
    },
    finish() { clearInterval(timer); current = null; node.hidden = true; },
  };
  current = job;
  node.hidden = false;
  node.querySelector('#job-stop').disabled = false;
  node.querySelector('#job-sub').textContent = '';
  node.querySelector('#job-title').textContent = name;
  return job;
}
