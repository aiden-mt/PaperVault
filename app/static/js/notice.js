// Thẻ thông báo ở góc dưới bên phải (nhắc việc, có bản mới…): có tiêu đề, nội dung, nút bấm, ở lại tới khi đóng.
// Khác toast: nhiều thẻ xếp chồng được, không tự tắt (trừ khi truyền ms).
import { escapeHtml } from './util.js';

let box = null;
const byKey = new Map();

// Bảng việc nền (bgjobs.js) cũng ở góc dưới bên phải: xếp thẻ thông báo lên phía trên nó.
let follow = 0;
function stack() {
  if (!box?.isConnected || !box.children.length) { clearInterval(follow); follow = 0; return; }
  const tray = document.querySelector('.bg-tray');
  box.style.bottom = tray && !tray.hidden && tray.offsetHeight ? `${tray.offsetHeight + 30}px` : '';
}

function host() {
  if (!follow) follow = setInterval(stack, 400);
  if (box && document.body.contains(box)) return box;
  box = document.createElement('div');
  box.className = 'pv-notices';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  document.body.appendChild(box);
  return box;
}

/**
 * notice({ key, icon, title, body (HTML), actions: [{ label, primary, onClick(close) }], ms, kind })
 * key: thẻ cùng key thay thế thẻ cũ. Trả về hàm đóng thẻ.
 */
export function notice({ key = '', icon = '', title = '', body = '', actions = [], ms = 0, kind = '' } = {}) {
  if (key && byKey.has(key)) byKey.get(key)();
  const el = document.createElement('div');
  el.className = `pv-notice ${kind}`;
  el.innerHTML = `${icon ? `<div class="pvn-ic">${escapeHtml(icon)}</div>` : ''}<div class="pvn-main">
      ${title ? `<div class="pvn-t">${escapeHtml(title)}</div>` : ''}${body ? `<div class="pvn-b">${body}</div>` : ''}
      ${actions.length ? `<div class="pvn-acts">${actions.map((a, i) => `<button type="button" class="sm ${a.primary ? 'primary' : 'ghost'}" data-i="${i}">${escapeHtml(a.label)}</button>`).join('')}</div>` : ''}
    </div><button type="button" class="pvn-x ghost" title="Đóng" aria-label="Đóng">×</button>`;
  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    if (key && byKey.get(key) === close) byKey.delete(key);
    el.classList.add('out');
    setTimeout(() => el.remove(), 180);
  };
  el.querySelector('.pvn-x').addEventListener('click', close);
  el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
    const a = actions[Number(b.dataset.i)];
    const keep = a?.onClick?.(close);
    if (keep !== true) close();
  }));
  host().appendChild(el);
  stack();
  if (key) byKey.set(key, close);
  if (ms) timer = setTimeout(close, ms);
  return close;
}
