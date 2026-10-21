// Thành phần giao diện nhỏ dùng chung: toast, hộp thoại, modal, render markdown đơn giản.
import { escapeHtml } from './util.js';
import { withMath, linkify, subSup } from './richtext.js';

export const $ = (id) => document.getElementById(id);
export const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

let toastTimer;
/** toast(msg, ms, kind, { label, onClick }) — action tuỳ chọn, ví dụ "Hoàn tác". */
export function toast(msg, ms = 2800, kind = '', action = null) {
  const t = $('toast');
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-act';
    b.textContent = action.label;
    b.addEventListener('click', () => { t.hidden = true; action.onClick(); });
    t.appendChild(b);
    ms = Math.max(ms, 6000);
  }
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/** Hộp thoại tổng quát. Trả về Promise<giá trị nút bấm>. */
export function dialog({ title = '', body = '', buttons = [{ label: 'Đóng', value: null }], width = 520, onOpen } = {}) {
  return new Promise((resolve) => {
    const wrap = el(`<div class="modal">
      <div class="modal-box" style="width:min(${width}px,100%)">
        <div class="modal-head"><strong>${escapeHtml(title)}</strong><span class="spacer"></span><button class="ghost sm" data-x>✕</button></div>
        <div class="modal-body"></div>
        <div class="modal-foot"></div>
      </div></div>`);
    const bodyEl = wrap.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
    const foot = wrap.querySelector('.modal-foot');
    const close = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', onHash); resolve(v); };
    // Chuyển sang trang khác (liên kết, phím tắt) thì đóng hộp thoại, không để nó treo trên trang mới.
    const onHash = () => close(null);
    window.addEventListener('hashchange', onHash);
    for (const b of buttons) {
      const btn = el(`<button class="${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}">${escapeHtml(b.label)}</button>`);
      btn.addEventListener('click', async () => {
        if (b.onClick) {
          const r = await b.onClick(bodyEl, close);
          if (r === false) return;
        }
        close(b.value);
      });
      foot.appendChild(btn);
    }
    wrap.querySelector('[data-x]').addEventListener('click', () => close(null));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(null); });
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    if (onOpen) onOpen(bodyEl, close);
  });
}

export function confirmDialog(message, { title = 'Xác nhận', okLabel = 'Đồng ý', danger = false } = {}) {
  return dialog({
    title,
    body: `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
    buttons: [{ label: 'Huỷ', value: false }, { label: okLabel, value: true, primary: !danger, danger }],
  });
}

export function promptDialog(message, { title = 'Nhập', value = '', placeholder = '', multiline = false } = {}) {
  const id = `pd_${Math.random().toString(36).slice(2, 8)}`;
  return dialog({
    title,
    body: `<label class="field"><span class="label-text">${escapeHtml(message)}</span>
      ${multiline ? `<textarea id="${id}" rows="4">${escapeHtml(value)}</textarea>` : `<input type="text" id="${id}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">`}</label>`,
    buttons: [{ label: 'Huỷ', value: null }, { label: 'OK', value: '__ok__', primary: true, onClick: (bodyEl, close) => { close(bodyEl.querySelector(`#${id}`).value); return false; } }],
    onOpen: (bodyEl) => {
      const input = bodyEl.querySelector(`#${id}`);
      input.focus();
      if (!multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') bodyEl.closest('.modal').querySelector('.modal-foot button.primary').click(); });
    },
  });
}

/** Chọn một mục trong danh sách (ví dụ chọn thư mục). options: [{value,label}] */
export function selectDialog(message, options, { title = 'Chọn', value = '' } = {}) {
  const id = `sd_${Math.random().toString(36).slice(2, 8)}`;
  return dialog({
    title,
    body: `<label class="field"><span class="label-text">${escapeHtml(message)}</span>
      <select id="${id}">${options.map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></label>`,
    buttons: [{ label: 'Huỷ', value: null }, { label: 'OK', value: '__ok__', primary: true, onClick: (bodyEl, close) => { close(bodyEl.querySelector(`#${id}`).value); return false; } }],
  });
}

/**
 * Markdown -> HTML gọn (đủ cho câu trả lời LLM và ghi chú): heading, bold, italic, code, bảng, đoạn, và danh sách.
 * Danh sách theo đúng quy tắc Markdown: dòng trống giữa các mục không ngắt danh sách (nếu ngắt thì mục nào cũng
 * thành "1."), mục thụt vào là danh sách con, dòng thụt vào sau một mục là phần nối tiếp của mục đó.
 */
export function mdToHtml(md) {
  // Công thức đứng riêng có thể trải nhiều dòng: gộp về một dòng trước khi tách dòng.
  const lines = String(md || '').replace(/\r/g, '').replace(/\t/g, '    ')
    .replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (m) => m.replace(/\n+/g, ' ')).split('\n');
  const out = [];
  const lists = []; // ngăn xếp danh sách đang mở: { kind: 'ul'|'ol', indent }
  let blank = false; // vừa gặp dòng trống khi đang ở trong danh sách
  let table = null;
  let code = false;
  // Chữ thường: chỉ số dưới / trên dạng văn bản (I_u, x^2) được dựng, trừ trong `code`.
  const mdText = (s) => String(s).split(/(`[^`]+`)/).map((seg) => (/^`[^`]+`$/.test(seg)
    ? `<code>${escapeHtml(seg.slice(1, -1))}</code>`
    : subSup(escapeHtml(seg))
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>'))).join('');
  // Link Markdown và link trần đều thành hyperlink; tách trước để dấu * hay _ trong URL không bị hiểu là in nghiêng.
  const mdInline = (s) => linkify(s, mdText);
  // Công thức tách ra trước, phần chữ mới đi qua Markdown (để * và _ trong công thức không bị hiểu là in nghiêng).
  const inline = (s) => withMath(s, mdInline);
  const top = () => lists[lists.length - 1];
  const closeOne = () => { out.push(`</li></${lists.pop().kind}>`); };
  const closeList = () => { while (lists.length) closeOne(); blank = false; };
  const closeTable = () => { if (table) { out.push('</tbody></table>'); table = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const indent = line.length - line.trimStart().length;
    // Dòng thụt sâu hơn mục đang mở thì thuộc về mục đó (đoạn nối tiếp, khối code, trích dẫn nằm trong mục).
    const inItem = lists.length > 0 && indent > top().indent;
    if (line.trimStart().startsWith('```')) {
      if (!inItem && !code) closeList();
      closeTable(); code = !code; out.push(code ? '<pre>' : '</pre>'); continue;
    }
    if (code) { out.push(escapeHtml(raw)); continue; }
    if (!line.trim()) { if (lists.length) blank = true; continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (!table) { if (!inItem) closeList(); table = true; out.push(`<table><thead><tr>${cells.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>`); continue; }
      out.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`);
      continue;
    }
    closeTable();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }
    const li = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      const kind = /^\d/.test(li[1]) ? 'ol' : 'ul';
      // Về lại cấp danh sách có cùng độ thụt (lệch một dấu cách vẫn coi là cùng cấp).
      while (lists.length && indent < top().indent - 1) closeOne();
      if (lists.length && Math.abs(indent - top().indent) <= 1 && top().kind !== kind) closeOne();
      if (lists.length && Math.abs(indent - top().indent) <= 1) out.push('</li>');
      else {
        // Danh sách đánh số bắt đầu từ số model viết (ví dụ danh sách tiếp tục từ 3 sau một đoạn chen giữa).
        const start = kind === 'ol' ? parseInt(li[1], 10) : 1;
        out.push(`<${kind}${kind === 'ol' && start > 1 ? ` start="${start}"` : ''}>`);
        lists.push({ kind, indent });
      }
      // Mô hình hay đánh số lại bên trong mục ("1. 1) …", "- • …"): bỏ phần lặp.
      out.push(`<li>${inline(kind === 'ol' ? li[2].replace(/^\(?\d{1,2}[.)](?!\d)\s*/, '') : li[2].replace(/^[-*•·]\s+/, ''))}`);
      blank = false;
      continue;
    }
    if (inItem) {
      const text = line.trim();
      if (text.startsWith('>')) out.push(`<blockquote>${inline(text.replace(/^>\s?/, ''))}</blockquote>`);
      else out.push(blank ? `<p>${inline(text)}</p>` : ` ${inline(text)}`);
      blank = false;
      continue;
    }
    closeList();
    if (line.startsWith('>')) { out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList(); closeTable();
  if (code) out.push('</pre>');
  return out.join('\n');
}

export function spinner(text = '') {
  return `<span class="spin"></span> ${escapeHtml(text)}`;
}

export function setStatus(target, msg, kind = '') {
  const node = typeof target === 'string' ? $(target) : target;
  if (!node) return;
  node.className = `status ${kind}`;
  node.innerHTML = msg;
}

/** Nút sao đánh giá (1-5), gọi onChange(n). */
export function ratingControl(value, onChange) {
  const wrap = el('<span class="rating"></span>');
  const draw = (v) => {
    wrap.innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="star ${n <= v ? 'on' : ''}" data-n="${n}" title="${n} sao">★</button>`).join('');
  };
  draw(value || 0);
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('.star');
    if (!b) return;
    const n = Number(b.dataset.n);
    const next = n === value ? 0 : n;
    value = next;
    draw(next);
    onChange(next);
  });
  return wrap;
}

/** Ô "Chọn tất cả" kiểu Gmail đặt ngay trên cột tick: checkbox ba trạng thái + nhãn. */
export function selectAllHtml(id, label = 'Chọn tất cả') {
  return `<label class="sel-master" title="${escapeHtml(label)}"><input type="checkbox" id="${id}"><span>${escapeHtml(label)}</span></label>`;
}

/** Cập nhật checkbox chủ: tick khi đã chọn hết, gạch ngang khi mới chọn một phần. */
export function syncSelectAll(box, total, picked) {
  if (!box) return;
  box.checked = total > 0 && picked >= total;
  box.indeterminate = picked > 0 && picked < total;
  box.disabled = total === 0;
}

export function topicBadge(topic) {
  if (!topic) return '';
  return `<span class="badge topic" style="--c:${escapeHtml(topic.color || '#888')}"><i></i>${escapeHtml(topic.name)}</span>`;
}

/* ---------- Thanh tiến độ ---------- */

const progressState = new WeakMap();
const fmtElapsed = (ms) => { const s = Math.floor(ms / 1000); return s < 60 ? `${s} giây` : `${Math.floor(s / 60)} phút ${String(s % 60).padStart(2, '0')}`; };

/**
 * Hiện hoặc cập nhật thanh tiến độ trong target (id hoặc phần tử). Gọi lại trên cùng target thì chỉ đổi nhãn và mức,
 * thời gian đã chạy không bị tính lại từ đầu. Thanh tự dừng khi nội dung target bị thay (ví dụ setStatus báo xong).
 * opts:
 *  - pct: tiến độ thật, 0..100.
 *  - step, of: đang ở bước thứ step (đếm từ 0) trên tổng of bước. Trong một bước thanh nhích dần theo thời gian.
 *  - expectedMs: thời gian thường gặp của cả việc (hoặc của mỗi bước khi có step). Không có pct thì thanh ước tính
 *    theo thời gian và dừng ở 95% cho tới khi xong, nên không bao giờ báo đầy khi việc còn chạy.
 */
export function showProgress(target, label, opts = {}) {
  const node = typeof target === 'string' ? $(target) : target;
  if (!node) return;
  let st = progressState.get(node);
  if (!st || !st.el.isConnected || !node.contains(st.el)) {
    if (st) clearInterval(st.timer);
    node.innerHTML = `<span class="pbar-wrap"><span class="pbar-top"><span class="pbar-label"></span><span class="pbar-time"></span></span><span class="pbar"><i></i></span></span>`;
    if (node.classList.contains('status')) node.className = 'status';
    // startedAt: mốc bắt đầu thật, khi phần tử bị vẽ lại giữa chừng thì thời gian không tính lại từ 0.
    st = { el: node.firstElementChild, start: opts.startedAt || Date.now(), stepStart: opts.stepStartedAt || Date.now(), step: -1, timer: 0, opts: {} };
    progressState.set(node, st);
    st.timer = setInterval(() => tick(node, st), 250);
  }
  // stepStartedAt: mốc bắt đầu bước hiện tại của việc chạy nền, để thanh không chạy lại từ đầu khi vẽ lại.
  if (opts.step != null && opts.step !== st.step) { st.step = opts.step; st.stepStart = opts.stepStartedAt || Date.now(); }
  if (opts.startedAt) st.start = opts.startedAt;
  st.opts = { ...opts };
  st.el.querySelector('.pbar-label').textContent = label || '';
  tick(node, st);
}

function tick(node, st) {
  if (!st.el.isConnected || !node.contains(st.el)) { clearInterval(st.timer); return; }
  const { pct, of, expectedMs = 30000 } = st.opts;
  const now = Date.now();
  let width;
  if (pct != null) width = Math.max(0, Math.min(100, pct));
  else if (of) {
    const span = 100 / of;
    width = span * Math.max(0, st.step) + span * 0.92 * (1 - Math.exp(-(now - st.stepStart) / expectedMs));
  } else width = 95 * (1 - Math.exp(-(now - st.start) / expectedMs));
  st.el.querySelector('.pbar i').style.width = `${width.toFixed(1)}%`;
  const parts = [];
  if (of) parts.push(`bước ${Math.min(of, Math.max(0, st.step) + 1)}/${of}`);
  else if (pct != null) parts.push(`${Math.round(width)}%`);
  parts.push(fmtElapsed(now - st.start));
  st.el.querySelector('.pbar-time').textContent = parts.join(' · ');
}

/** Dừng và xoá thanh tiến độ trong target. */
export function endProgress(target, html = '') {
  const node = typeof target === 'string' ? $(target) : target;
  if (!node) return;
  const st = progressState.get(node);
  if (st) clearInterval(st.timer);
  progressState.delete(node);
  node.innerHTML = html;
}
