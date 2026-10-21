// Trang Lịch (#/calendar[?d=YYYY-MM-DD]): kế hoạch theo tháng / tuần / danh sách, nối với nhật ký và việc có hạn
// trong Sổ tay. Dữ liệu ở ../calendar.js; nhật ký và việc có hạn ở ../notebook.js.
import { store, paperById } from '../store.js';
import { $, toast, dialog, confirmDialog } from '../ui.js';
import { escapeHtml } from '../util.js';
import { plainTitle } from '../richtext.js';
import {
  CATS, catOf, REPEATS, loadEvents, saveEvent, removeEvent, toggleDone, occurrences, onCalendarChange, allEvents,
  ymd, parseYmd, addDays, weekStart, WEEKDAYS, fmtDay,
} from '../calendar.js';
import {
  loadPages, allPages, pageById, pageLabel, paperShort, dailyPage, ensureDailyPage, datedTasks, toggleDatedTask, onPagesChange,
} from '../notebook.js';

const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { /* bỏ qua */ } return null; };
const MONTHS = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];

export async function render(root, { query }) {
  root.className = 'view split';
  const todayStr = ymd(new Date());
  const st = {
    view: ['month', 'week', 'agenda'].includes(LS('pv.calView')) ? LS('pv.calView') : 'month',
    cursor: parseYmd(query.get('d') || todayStr),
    sel: query.get('d') || todayStr,
    hidden: new Set(JSON.parse(LS('pv.calHidden') || '[]')),
    tasks: LS('pv.calTasks') !== '0',
    full: LS('pv.calFull') === '1',     // tuần: hiện cả 0–24h thay vì 7–23h
    side: LS('pv.calSide') !== '0',     // bảng ngày bên phải
  };
  root.innerHTML = `<div class="cal-page ${st.side ? '' : 'noside'}">
    <section class="cal-main">
      <div class="cal-head">
        <div class="cal-nav"><button type="button" class="sm" id="cal-prev" title="Trước">‹</button><button type="button" class="sm" id="cal-today">Hôm nay</button><button type="button" class="sm" id="cal-next" title="Sau">›</button></div>
        <h2 id="cal-title"></h2>
        <span class="spacer"></span>
        <div class="seg" id="cal-view"><button data-v="month">Tháng</button><button data-v="week">Tuần</button><button data-v="agenda">Danh sách</button></div>
        <button type="button" class="sm" id="cal-side-t" title="Ẩn / hiện bảng ngày bên phải">◧</button>
        <button type="button" class="primary" id="cal-add">+ Kế hoạch</button>
      </div>
      <div class="cal-filters" id="cal-filters"></div>
      <div class="cal-body" id="cal-body"></div>
    </section>
    <aside class="cal-side" id="cal-side"></aside>
  </div>`;

  await Promise.all([loadEvents(), loadPages()]);

  /* ---------- dữ liệu của một khoảng ngày ---------- */
  function itemsIn(from, to) {
    const map = new Map();
    const add = (d, it) => { if (!map.has(d)) map.set(d, []); map.get(d).push(it); };
    for (const o of occurrences(from, to)) if (!st.hidden.has(o.ev.cat || 'other')) add(o.date, { kind: 'ev', ...o });
    if (st.tasks) for (const t of datedTasks()) if (t.date >= from && t.date <= to) add(t.date, { kind: 'task', ...t });
    return map;
  }
  const hasDiary = (d) => !!dailyPage(d);

  /* ---------- tiêu đề, bộ lọc ---------- */
  function drawHead() {
    const c = st.cursor;
    let title = `${MONTHS[c.getMonth()]}, ${c.getFullYear()}`;
    if (st.view === 'week') { const a = weekStart(c); const b = addDays(a, 6); title = `Tuần ${a.getDate()}/${a.getMonth() + 1} – ${b.getDate()}/${b.getMonth() + 1}/${b.getFullYear()}`; }
    if (st.view === 'agenda') title = `Từ ${fmtDay(st.sel)}`;
    $('cal-title').textContent = title;
    $('cal-view').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === st.view));
    $('cal-filters').innerHTML = `${CATS.map(([k, l, col]) => `<button type="button" class="cal-fchip ${st.hidden.has(k) ? 'off' : ''}" data-cat="${k}" style="--c:${col}" title="${st.hidden.has(k) ? 'Đang ẩn, bấm để hiện' : 'Bấm để ẩn'}"><i></i>${escapeHtml(l)}</button>`).join('')}
      <button type="button" class="cal-fchip ${st.tasks ? '' : 'off'}" data-tasks="1" style="--c:#0891b2" title="Việc cần làm có hạn 📅 trong Sổ tay"><i></i>Việc trong Sổ tay</button>`;
  }

  /* ---------- các chế độ xem ---------- */
  const chip = (it) => {
    if (it.kind === 'task') return `<div class="cal-chip task ${it.done ? 'done' : ''}" data-task="${it.pageId}:${it.line}" title="${escapeHtml(`${it.text} · trong ${pageLabel(pageById(it.pageId) || {})} · bấm để mở trang`)}"><span class="cal-box">${it.done ? '☑' : '☐'}</span>${escapeHtml(it.text)}</div>`;
    const [, , col] = catOf(it.ev.cat);
    const rep = it.ev.repeat && it.ev.repeat !== 'none';
    return `<div class="cal-chip ${it.done ? 'done' : ''}" draggable="${rep ? 'false' : 'true'}" data-ev="${it.ev.id}" data-date="${it.date}" style="--c:${col}" title="${escapeHtml(`${it.ev.start ? `${it.ev.start}${it.ev.end ? `–${it.ev.end}` : ''} ` : ''}${it.ev.title}${rep ? ' (lặp lại)' : ''}`)}">${it.ev.start ? `<b>${escapeHtml(it.ev.start)}</b> ` : ''}${rep ? '↻ ' : ''}${escapeHtml(it.ev.title)}</div>`;
  };

  function drawMonth() {
    const first = new Date(st.cursor.getFullYear(), st.cursor.getMonth(), 1);
    const start = weekStart(first);
    const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const map = itemsIn(ymd(days[0]), ymd(days[41]));
    $('cal-body').innerHTML = `<div class="cal-month"><div class="cal-wd">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div><div class="cal-grid">${days.map((d) => {
      const s = ymd(d);
      const items = map.get(s) || [];
      return `<div class="cal-cell ${d.getMonth() !== st.cursor.getMonth() ? 'out' : ''} ${s === todayStr ? 'today' : ''} ${s === st.sel ? 'sel' : ''} ${d.getDay() === 0 || d.getDay() === 6 ? 'wkend' : ''}" data-date="${s}">
        <div class="cal-dn"><span class="cal-dnum">${d.getDate()}</span>${hasDiary(s) ? '<span class="cal-diary" title="Có nhật ký ngày này">📓</span>' : ''}</div>
        <div class="cal-items">${items.slice(0, 3).map(chip).join('')}${items.length > 3 ? `<div class="cal-more">+${items.length - 3} nữa</div>` : ''}</div></div>`;
    }).join('')}</div></div>`;
  }

  /* ---------- Tuần: lưới giờ (cột giờ bên trái, mỗi ngày một cột, khối đặt đúng giờ) ---------- */
  const HOUR_PX = 52;
  const mins = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  let wk = null; // { h0, h1, days } của lần vẽ gần nhất, dùng khi bấm / kéo
  function drawWeek() {
    const start = weekStart(st.cursor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const map = itemsIn(ymd(days[0]), ymd(days[6]));
    // Khung giờ: 7–23h (hoặc cả ngày), tự nới ra nếu có kế hoạch nằm ngoài.
    let h0 = st.full ? 0 : 7;
    let h1 = st.full ? 24 : 23;
    for (const items of map.values()) for (const it of items) {
      if (it.kind !== 'ev' || mins(it.ev.start) == null) continue;
      const s = mins(it.ev.start);
      const e = mins(it.ev.end) ?? s + 60;
      h0 = Math.min(h0, Math.floor(s / 60));
      h1 = Math.max(h1, Math.min(24, Math.ceil(Math.max(e, s + 30) / 60)));
    }
    // Vẽ lại cùng tuần (sau khi thêm / kéo): giữ nguyên vị trí cuộn và khung giờ.
    const keepScroll = $('cw-scroll') && wk && wk.days[0] === ymd(days[0]) && wk.h0 === h0 ? $('cw-scroll').scrollTop : null;
    wk = { h0, h1, days: days.map(ymd) };
    const hours = h1 - h0;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const col = (d, i) => {
      const s = ymd(d);
      const items = map.get(s) || [];
      const timed = items.filter((it) => it.kind === 'ev' && mins(it.ev.start) != null).map((it) => {
        const a = mins(it.ev.start);
        let b = mins(it.ev.end);
        if (b == null || b <= a) b = a + 60;
        return { it, a, b: Math.max(b, a + 20) };
      }).sort((x, y) => x.a - y.a || y.b - x.b);
      // Chia làn cho các khối chồng giờ: mỗi cụm chồng nhau chia đều bề ngang.
      const lanes = [];
      let cluster = [];
      let clusterEnd = -1;
      const flushCluster = () => { const n = Math.max(1, ...cluster.map((x) => x.lane + 1)); cluster.forEach((x) => { x.n = n; }); cluster = []; };
      for (const x of timed) {
        if (x.a >= clusterEnd && cluster.length) { flushCluster(); lanes.length = 0; }
        let lane = lanes.findIndex((end) => end <= x.a);
        if (lane < 0) { lane = lanes.length; lanes.push(x.b); } else lanes[lane] = x.b;
        x.lane = lane;
        cluster.push(x);
        clusterEnd = Math.max(clusterEnd, x.b);
      }
      if (cluster.length) flushCluster();
      const blocks = timed.map((x) => {
        const [, cl, colr] = catOf(x.it.ev.cat);
        const e = x.it.ev;
        const rep = e.repeat && e.repeat !== 'none';
        const top = ((x.a - h0 * 60) / 60) * HOUR_PX;
        const height = Math.max(((x.b - x.a) / 60) * HOUR_PX - 3, 22);
        const paper = e.paperId && paperById(e.paperId);
        return `<div class="cw-ev ${x.it.done ? 'done' : ''} ${height < 40 ? 'tiny' : ''}" data-ev="${e.id}" data-date="${s}" data-a="${x.a}" data-b="${x.b}" style="--c:${colr};top:${top}px;height:${height}px;left:calc(${(x.lane / x.n) * 100}% + 2px);width:calc(${100 / x.n}% - 4px)" title="${escapeHtml(`${e.title} · ${hhmm(x.a)}–${hhmm(x.b)} · ${cl}${rep ? ' · lặp lại' : ''}`)}">
          <b>${rep ? '↻ ' : ''}${escapeHtml(e.title)}</b><span>${hhmm(x.a)}–${hhmm(x.b)}${paper ? ' · 📄' : ''}${e.pageId ? ' · 📓' : ''}</span><i class="cw-rs" data-rs="1" title="Kéo để đổi giờ kết thúc"></i></div>`;
      }).join('');
      const nowLine = s === todayStr && nowMin >= h0 * 60 && nowMin <= h1 * 60 ? `<div class="cw-now" style="top:${((nowMin - h0 * 60) / 60) * HOUR_PX}px"></div>` : '';
      return `<div class="cw-col ${s === todayStr ? 'today' : ''} ${s === st.sel ? 'sel' : ''} ${i >= 5 ? 'wkend' : ''}" data-date="${s}">${blocks}${nowLine}</div>`;
    };
    const allday = (d) => {
      const s = ymd(d);
      const items = (map.get(s) || []).filter((it) => it.kind === 'task' || mins(it.ev.start) == null);
      return `<div class="cw-ad ${s === todayStr ? 'today' : ''}" data-date="${s}">${items.map(chip).join('')}</div>`;
    };
    $('cal-body').innerHTML = `<div class="cw" style="--hp:${HOUR_PX}px;--hours:${hours}">
      <div class="cw-head"><div class="cw-corner"><button type="button" class="sm cw-full" id="cw-full" title="${st.full ? 'Chỉ hiện 7–23h' : 'Hiện cả ngày 0–24h'}">⇕ ${st.full ? '7–23h' : '0–24h'}</button></div>
        ${days.map((d, i) => { const s = ymd(d); return `<div class="cw-dh ${s === todayStr ? 'today' : ''} ${s === st.sel ? 'sel' : ''}" data-date="${s}"><span>${WEEKDAYS[i]}</span><b>${d.getDate()}</b>${hasDiary(s) ? '<span class="cal-diary" title="Có nhật ký">📓</span>' : ''}</div>`; }).join('')}</div>
      <div class="cw-allrow"><div class="cw-ad-l">Cả ngày</div>${days.map(allday).join('')}</div>
      <div class="cw-scroll" id="cw-scroll"><div class="cw-grid">
        <div class="cw-times">${Array.from({ length: hours }, (_, k) => `<span style="top:${k * HOUR_PX}px">${String(h0 + k).padStart(2, '0')}:00</span>`).join('')}</div>
        ${days.map(col).join('')}
      </div></div>
      <div class="hint cw-help">Bấm một ô giờ trống để thêm việc · kéo khối để dời giờ / ngày · kéo mép dưới để đổi giờ kết thúc · bấm khối để sửa</div></div>`;
    // Cuộn tới giờ đang làm việc (hoặc 8:00) lần đầu mở tuần.
    const sc = $('cw-scroll');
    const firstEv = Math.min(...[...map.values()].flat().filter((it) => it.kind === 'ev' && mins(it.ev.start) != null).map((it) => mins(it.ev.start)), 24 * 60);
    const target = days.some((d) => ymd(d) === todayStr) ? Math.max(h0 * 60, nowMin - 90) : Math.max(h0 * 60, Math.min(firstEv, 8 * 60) - 30);
    sc.scrollTop = keepScroll ?? ((target - h0 * 60) / 60) * HOUR_PX;
  }

  /** Ô nhỏ thêm nhanh một việc ở khung giờ đã bấm. */
  function slotPopover(date, a, clientX, clientY) {
    document.querySelector('.cw-pop')?.remove();
    const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
    const pop = document.createElement('div');
    pop.className = 'cw-pop';
    pop.innerHTML = `<div class="cw-pop-h">${escapeHtml(fmtDay(date))}</div>
      <input class="cw-pop-t" placeholder="Tên việc… (Enter để thêm)">
      <div class="cw-pop-row"><input type="time" class="cw-pop-a" value="${hhmm(a)}"><span>–</span><input type="time" class="cw-pop-b" value="${hhmm(Math.min(a + 60, 24 * 60 - 1))}">
        <select class="cw-pop-c">${CATS.map(([k, l]) => `<option value="${k}">${escapeHtml(l)}</option>`).join('')}</select></div>
      <div class="cw-pop-row"><button type="button" class="sm ghost" data-more>Chi tiết…</button><span class="spacer"></span><button type="button" class="sm" data-cancel>Huỷ</button><button type="button" class="sm primary" data-ok>Thêm</button></div>`;
    document.body.appendChild(pop);
    const W = pop.offsetWidth, H = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(innerWidth / z - W - 8, clientX / z + 8))}px`;
    pop.style.top = `${Math.max(8, Math.min(innerHeight / z - H - 8, clientY / z - 20))}px`;
    const close = () => { pop.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey, true); };
    const outside = (e) => { if (!pop.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const read = () => ({ title: pop.querySelector('.cw-pop-t').value.trim(), date, start: pop.querySelector('.cw-pop-a').value, end: pop.querySelector('.cw-pop-b').value, cat: pop.querySelector('.cw-pop-c').value });
    const ok = async () => { const v = read(); if (!v.title) return pop.querySelector('.cw-pop-t').focus(); close(); await saveEvent(v); };
    pop.querySelector('[data-ok]').onclick = ok;
    pop.querySelector('[data-cancel]').onclick = close;
    pop.querySelector('[data-more]').onclick = () => { const v = read(); close(); editEvent(v); };
    pop.querySelector('.cw-pop-t').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', onKey, true); pop.querySelector('.cw-pop-t').focus(); }, 0);
  }

  /** Kéo khối (dời giờ / ngày) hoặc kéo mép dưới (đổi giờ kết thúc). Bấm không kéo thì mở hộp sửa. */
  function bindWeekDrag(body) {
    body.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !wk) return;
      const block = e.target.closest('.cw-ev');
      const colEl = e.target.closest('.cw-col');
      if (!colEl) return;
      const rect = colEl.getBoundingClientRect();
      const scale = rect.height / colEl.offsetHeight || 1;
      const minAt = (clientY, el) => { const r = el.getBoundingClientRect(); return wk.h0 * 60 + ((clientY - r.top) / scale / HOUR_PX) * 60; };
      if (!block) {
        // Bấm ô trống: thêm việc ở mốc 30 phút gần nhất.
        const a = Math.max(wk.h0 * 60, Math.min(wk.h1 * 60 - 30, Math.floor(minAt(e.clientY, colEl) / 30) * 30));
        st.sel = colEl.dataset.date;
        drawSide();
        body.querySelectorAll('.cw-col, .cw-dh').forEach((c) => c.classList.toggle('sel', c.dataset.date === st.sel));
        slotPopover(colEl.dataset.date, a, e.clientX, e.clientY);
        return;
      }
      e.preventDefault();
      const ev = allEvents().find((k) => k.id === block.dataset.ev);
      if (!ev) return;
      const resize = !!e.target.closest('[data-rs]');
      const a0 = Number(block.dataset.a), b0 = Number(block.dataset.b);
      const y0 = e.clientY;
      let moved = false;
      let na = a0, nb = b0, nday = block.dataset.date;
      try { block.setPointerCapture(e.pointerId); } catch (_) { /* con trỏ không bắt được: vẫn theo dõi trên cả cửa sổ */ }
      const snap = (m) => Math.round(m / 15) * 15;
      const onMove = (m) => {
        const dy = (m.clientY - y0) / scale / HOUR_PX * 60;
        if (!moved && Math.abs(m.clientY - y0) < 4 && !resize) return;
        moved = true;
        block.classList.add('dragging');
        if (resize) {
          nb = Math.max(a0 + 15, Math.min(24 * 60, snap(b0 + dy)));
          block.style.height = `${Math.max(((nb - a0) / 60) * HOUR_PX - 3, 22)}px`;
        } else {
          const len = b0 - a0;
          na = Math.max(0, Math.min(24 * 60 - len, snap(a0 + dy)));
          nb = na + len;
          block.style.top = `${((na - wk.h0 * 60) / 60) * HOUR_PX}px`;
          // đổi ngày theo cột dưới con trỏ (kế hoạch lặp lại chỉ đổi giờ)
          const under = document.elementsFromPoint(m.clientX, m.clientY).find((x) => x.classList?.contains('cw-col'));
          if (under && under !== block.parentElement && (!ev.repeat || ev.repeat === 'none')) { under.appendChild(block); nday = under.dataset.date; }
        }
        block.querySelector('span').textContent = `${hhmm(na)}–${hhmm(nb)}`;
      };
      const onUp = async () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (!moved) { editEvent(ev, block.dataset.date); return; }
        const patch = { ...ev, start: hhmm(na), end: hhmm(nb) };
        if (!ev.repeat || ev.repeat === 'none') patch.date = nday;
        await saveEvent(patch);
        toast(`Đã đặt “${ev.title}” vào ${hhmm(na)}–${hhmm(nb)}${patch.date && patch.date !== ev.date ? `, ${fmtDay(patch.date)}` : ''}.`);
      };
      // Theo dõi trên cả cửa sổ: kéo nhanh ra khỏi khối vẫn không mất.
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  function drawAgenda() {
    const from = st.sel;
    const to = ymd(addDays(parseYmd(from), 60));
    const map = itemsIn(from, to);
    // Quá hạn: việc chưa xong trước hôm nay (kế hoạch một lần và việc có hạn trong Sổ tay)
    const overdue = [
      ...allEvents().filter((e) => (!e.repeat || e.repeat === 'none') && !e.done && e.date < todayStr && !st.hidden.has(e.cat || 'other')).map((e) => ({ kind: 'ev', ev: e, date: e.date, done: false })),
      ...(st.tasks ? datedTasks().filter((t) => !t.done && t.date < todayStr).map((t) => ({ kind: 'task', ...t })) : []),
    ].sort((a, b) => a.date.localeCompare(b.date));
    const dates = [...map.keys()].sort();
    $('cal-body').innerHTML = `<div class="cal-agenda">
      ${overdue.length ? `<div class="cal-ag-day overdue"><div class="cal-ag-h">⚠ Quá hạn chưa xong (${overdue.length})</div>${overdue.map((it) => rowHtml(it, true)).join('')}</div>` : ''}
      ${dates.map((d) => `<div class="cal-ag-day ${d === todayStr ? 'today' : ''}"><div class="cal-ag-h" data-date="${d}">${escapeHtml(fmtDay(d))}${d === todayStr ? ' · hôm nay' : ''}${hasDiary(d) ? ' <span class="cal-diary">📓</span>' : ''}</div>${map.get(d).map((it) => rowHtml(it)).join('')}</div>`).join('') || '<div class="empty">Không có kế hoạch nào trong 60 ngày tới.</div>'}</div>`;
  }

  /** Một dòng kế hoạch / việc (dùng ở bảng bên và chế độ Danh sách). */
  function rowHtml(it, showDate = false) {
    if (it.kind === 'task') {
      const pg = pageById(it.pageId);
      return `<div class="cal-row ${it.done ? 'done' : ''}"><input type="checkbox" data-task-cb="${it.pageId}:${it.line}" ${it.done ? 'checked' : ''}><span class="cal-dot" style="--c:#0891b2"></span>
        <div class="cal-row-b"><span class="cal-row-t">${escapeHtml(it.text)}</span><span class="hint">${showDate ? `${escapeHtml(fmtDay(it.date))} · ` : ''}việc trong <a href="#/notebook/${it.pageId}">📓 ${escapeHtml(pg ? pageLabel(pg) : 'trang')}</a></span></div></div>`;
    }
    const e = it.ev;
    const [, cl, col] = catOf(e.cat);
    const paper = e.paperId && paperById(e.paperId);
    const page = e.pageId && pageById(e.pageId);
    return `<div class="cal-row ${it.done ? 'done' : ''}"><input type="checkbox" data-ev-cb="${e.id}" data-date="${it.date}" ${it.done ? 'checked' : ''}><span class="cal-dot" style="--c:${col}" title="${escapeHtml(cl)}"></span>
      <div class="cal-row-b"><span class="cal-row-t">${e.start ? `<b>${escapeHtml(e.start)}${e.end ? `–${escapeHtml(e.end)}` : ''}</b> ` : ''}${escapeHtml(e.title)}${e.repeat && e.repeat !== 'none' ? ' <span class="hint">↻</span>' : ''}</span>
        <span class="hint">${showDate ? `${escapeHtml(fmtDay(it.date))} · ` : ''}${escapeHtml(cl)}${paper ? ` · <a href="#/paper/${paper.id}">📄 ${escapeHtml(paperShort(paper))}</a>` : ''}${page ? ` · <a href="#/notebook/${page.id}">📓 ${escapeHtml(pageLabel(page))}</a>` : ''}</span>
        ${e.notes ? `<span class="cal-notes">${escapeHtml(e.notes)}</span>` : ''}</div>
      <button type="button" class="nb-ico" data-edit="${e.id}" data-date="${it.date}" title="Sửa">✎</button></div>`;
  }

  /* ---------- bảng bên: ngày đang chọn ---------- */
  function drawSide() {
    const d = st.sel;
    const items = itemsIn(d, d).get(d) || [];
    const evs = items.filter((x) => x.kind === 'ev');
    const tasks = items.filter((x) => x.kind === 'task');
    const diary = dailyPage(d);
    const snip = diary ? String(diary.content || '').replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (m, x, y) => y || x.replace(/^@/, '')).replace(/[#>*`[\]!-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) : '';
    $('cal-side').innerHTML = `<div class="cal-sd-h"><h3>${escapeHtml(fmtDay(d))}</h3>${d === todayStr ? '<span class="badge accent">Hôm nay</span>' : ''}</div>
      <div class="cal-card cal-diary-card">${diary
        ? `<div class="cal-card-h">📓 Nhật ký ngày này<span class="spacer"></span><button type="button" class="sm" data-diary="${d}">Mở</button></div>${snip ? `<div class="hint">${escapeHtml(snip)}…</div>` : ''}`
        : `<div class="cal-card-h">📓 Chưa có nhật ký<span class="spacer"></span><button type="button" class="sm" data-diary="${d}">+ Tạo nhật ký</button></div><div class="hint">Trang nhật ký của ngày này trong Sổ tay, có sẵn khung đọc gì / ý tưởng / việc cần làm.</div>`}</div>
      ${dayPlanHtml(d, evs, tasks)}
      <div class="cal-sd-sec"><h4>Kế hoạch (${evs.length})</h4>${evs.map((it) => rowHtml(it)).join('') || '<div class="hint">Chưa có kế hoạch. Bấm + Thêm kế hoạch, hoặc bấm vào một ô giờ trong lịch tuần.</div>'}</div>
      ${st.tasks ? `<div class="cal-sd-sec"><h4>Việc có hạn trong Sổ tay (${tasks.length})</h4>${tasks.map((it) => rowHtml(it)).join('') || '<div class="hint">Trong Sổ tay, viết <code>- [ ] việc 📅 ' + d + '</code> (hoặc gõ / → Hạn chót) để việc hiện ở đây.</div>'}</div>` : ''}`;
  }

  /* ---------- bảng ngày: tổng quan, khoảng trống, gợi ý lên lịch đọc ---------- */
  const DAY_A = 8 * 60;  // khung giờ làm việc để tính khoảng trống
  const DAY_B = 22 * 60;
  /** Khoảng trống ≥ 30 phút trong 8–22h (bỏ phần đã trôi qua nếu là hôm nay): [[a, b], …] theo phút. */
  function freeSlots(d, evs) {
    const busy = evs.filter((x) => mins(x.ev.start) != null).map((x) => { const a = mins(x.ev.start); let b = mins(x.ev.end); if (b == null || b <= a) b = a + 60; return [a, b]; }).sort((x, y) => x[0] - y[0]);
    let cur = DAY_A;
    if (d === todayStr) { const n = new Date(); cur = Math.max(cur, Math.ceil((n.getHours() * 60 + n.getMinutes()) / 30) * 30); }
    const out = [];
    for (const [a, b] of busy) { if (a - cur >= 30) out.push([cur, Math.min(a, DAY_B)]); cur = Math.max(cur, b); if (cur >= DAY_B) break; }
    if (DAY_B - cur >= 30) out.push([cur, DAY_B]);
    return out.filter(([a, b]) => b - a >= 30 && a < DAY_B);
  }
  const fmtDur = (m) => (m >= 60 ? `${Math.floor(m / 60)} giờ${m % 60 ? ` ${m % 60} phút` : ''}` : `${m} phút`);
  function dayPlanHtml(d, evs, tasks) {
    const all = [...evs, ...tasks];
    const done = all.filter((x) => x.done).length;
    const busyMin = evs.filter((x) => mins(x.ev.start) != null).reduce((s, x) => { const a = mins(x.ev.start); let b = mins(x.ev.end); if (b == null || b <= a) b = a + 60; return s + (b - a); }, 0);
    const slots = d >= todayStr ? freeSlots(d, evs) : [];
    const reading = store.papers.filter((p) => !p.deleted && p.status === 'reading').slice(0, 4);
    const planned = new Set(allEvents().map((e) => e.paperId).filter(Boolean));
    return `<div class="cal-card cal-plan">
        <div class="cal-card-h">📊 Tổng quan ngày<span class="spacer"></span><button type="button" class="sm primary" data-add-day="${d}">+ Thêm kế hoạch</button></div>
        <div class="cal-stats"><span><b>${done}/${all.length}</b> đã xong</span><span><b>${evs.length}</b> kế hoạch</span><span><b>${fmtDur(busyMin)}</b> đã xếp lịch</span></div>
        ${all.length ? `<div class="cal-progress" title="${done}/${all.length} việc đã xong"><i style="width:${Math.round((done / all.length) * 100)}%"></i></div>` : ''}
      </div>
      ${d >= todayStr ? `<div class="cal-card"><div class="cal-card-h">🕘 Khoảng trống <span class="hint">(8–22h)</span></div>
        ${slots.length ? `<div class="cal-slots">${slots.map(([a, b]) => `<button type="button" class="cal-slot" data-slot="${a}" data-slot-end="${Math.min(b, a + 60)}" title="Bấm để thêm việc vào ${hhmm(a)}–${hhmm(Math.min(b, a + 60))}">${hhmm(a)}–${hhmm(b)} <span class="hint">${fmtDur(b - a)}</span></button>`).join('')}</div>` : '<div class="hint">Không còn khoảng trống từ 30 phút trở lên.</div>'}</div>` : ''}
      ${reading.length && d >= todayStr ? `<div class="cal-card"><div class="cal-card-h">📚 Gợi ý lên lịch đọc <span class="hint">(paper “Đang đọc”)</span></div>
        ${reading.map((p) => `<div class="cal-sug"><span class="cal-sug-t" title="${escapeHtml(plainTitle(p.title))}">${escapeHtml(paperShort(p))}${planned.has(p.id) ? ' <span class="badge">đã có lịch</span>' : ''}</span><button type="button" class="sm" data-sched="${p.id}" title="Thêm 1 giờ đọc paper này vào khoảng trống sớm nhất">Lên lịch</button></div>`).join('')}</div>` : ''}`;
  }

  function draw() {
    drawHead();
    if (st.view === 'month') drawMonth();
    else if (st.view === 'week') drawWeek();
    else drawAgenda();
    drawSide();
  }

  /* ---------- hộp thoại kế hoạch ---------- */
  async function editEvent(ev = {}, occDate = '') {
    const isNew = !ev.id;
    const papers = store.papers.filter((p) => !p.deleted).sort((a, b) => plainTitle(a.title).localeCompare(plainTitle(b.title)));
    const pages = allPages().sort((a, b) => (a.title || '').localeCompare(b.title || '', 'vi'));
    const rep = ev.repeat && ev.repeat !== 'none';
    const r = await dialog({
      title: isNew ? 'Thêm kế hoạch' : 'Sửa kế hoạch', width: 620,
      body: `<label class="field"><span class="label-text">Tên</span><input id="ce-title" value="${escapeHtml(ev.title || '')}" placeholder="ví dụ: Đọc paper SelTDA, chạy lại baseline…"></label>
        <div class="cal-form">
          <label class="field"><span class="label-text">Ngày</span><input type="date" id="ce-date" value="${escapeHtml(ev.date || st.sel)}"></label>
          <label class="field"><span class="label-text">Bắt đầu</span><input type="time" id="ce-start" value="${escapeHtml(ev.start || '')}"></label>
          <label class="field"><span class="label-text">Kết thúc</span><input type="time" id="ce-end" value="${escapeHtml(ev.end || '')}"></label>
          <label class="field"><span class="label-text">Loại</span><select id="ce-cat">${CATS.map(([k, l]) => `<option value="${k}" ${(ev.cat || 'read') === k ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></label>
          <label class="field"><span class="label-text">Lặp lại</span><select id="ce-rep">${REPEATS.map(([k, l]) => `<option value="${k}" ${(ev.repeat || 'none') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field"><span class="label-text">Lặp đến ngày <span class="hint">(trống = mãi)</span></span><input type="date" id="ce-until" value="${escapeHtml(ev.until || '')}"></label>
        </div>
        <div class="cal-form two">
          <label class="field"><span class="label-text">Gắn paper <span class="hint">(tuỳ chọn)</span></span><select id="ce-paper"><option value="">—</option>${papers.map((p) => `<option value="${p.id}" ${ev.paperId === p.id ? 'selected' : ''}>${escapeHtml(plainTitle(p.title).slice(0, 90))}</option>`).join('')}</select></label>
          <label class="field"><span class="label-text">Gắn trang Sổ tay <span class="hint">(tuỳ chọn)</span></span><select id="ce-page"><option value="">—</option>${pages.map((p) => `<option value="${p.id}" ${ev.pageId === p.id ? 'selected' : ''}>${escapeHtml(pageLabel(p))}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span class="label-text">Ghi chú</span><textarea id="ce-notes" rows="3">${escapeHtml(ev.notes || '')}</textarea></label>
        ${rep && occDate ? `<p class="hint">Đây là kế hoạch lặp lại: sửa ở đây áp dụng cho mọi lần. Chỉ bỏ riêng ngày ${escapeHtml(occDate)} thì bấm “Bỏ lần này”.</p>` : ''}`,
      buttons: [
        ...(isNew ? [] : [{ label: 'Xoá', danger: true, value: 'delete' }]),
        ...(rep && occDate ? [{ label: 'Bỏ lần này', value: 'skip' }] : []),
        { label: 'Huỷ', value: null },
        { label: isNew ? 'Thêm' : 'Lưu', primary: true, onClick: (b, close) => {
          const title = b.querySelector('#ce-title').value.trim();
          const date = b.querySelector('#ce-date').value;
          if (!title || !date) { toast('Nhập tên và ngày.', 2500, 'err'); return false; }
          close({ title, date, start: b.querySelector('#ce-start').value, end: b.querySelector('#ce-end').value, cat: b.querySelector('#ce-cat').value, repeat: b.querySelector('#ce-rep').value, until: b.querySelector('#ce-until').value, paperId: b.querySelector('#ce-paper').value, pageId: b.querySelector('#ce-page').value, notes: b.querySelector('#ce-notes').value.trim() });
          return false;
        } },
      ],
      onOpen: (b) => setTimeout(() => b.querySelector('#ce-title').focus(), 30),
    });
    if (!r) return;
    if (r === 'delete') {
      if (!(await confirmDialog(`Xoá kế hoạch “${ev.title}”${rep ? ' (mọi lần lặp)' : ''}?`, { danger: true, okLabel: 'Xoá' }))) return;
      await removeEvent(ev.id);
    } else if (r === 'skip') await saveEvent({ ...ev, skip: [...(ev.skip || []), occDate] });
    else await saveEvent({ ...ev, ...r });
    draw();
  }

  /* ---------- sự kiện ---------- */
  const move = (n) => {
    const c = st.cursor;
    if (st.view === 'month') st.cursor = new Date(c.getFullYear(), c.getMonth() + n, 1);
    else if (st.view === 'week') st.cursor = addDays(c, 7 * n);
    else { st.sel = ymd(addDays(parseYmd(st.sel), 30 * n)); st.cursor = parseYmd(st.sel); }
    draw();
  };
  $('cal-prev').addEventListener('click', () => move(-1));
  $('cal-next').addEventListener('click', () => move(1));
  $('cal-today').addEventListener('click', () => { st.cursor = new Date(); st.sel = todayStr; draw(); });
  $('cal-view').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; st.view = b.dataset.v; LS('pv.calView', st.view); if (st.view !== 'agenda') st.cursor = parseYmd(st.sel); draw(); });
  $('cal-add').addEventListener('click', () => editEvent({ date: st.sel }));
  $('cal-side-t').addEventListener('click', () => { st.side = !st.side; LS('pv.calSide', st.side ? '1' : '0'); root.querySelector('.cal-page').classList.toggle('noside', !st.side); });
  $('cal-body').addEventListener('click', (e) => { if (e.target.closest('#cw-full')) { st.full = !st.full; LS('pv.calFull', st.full ? '1' : '0'); drawWeek(); } });
  bindWeekDrag($('cal-body'));
  // Rê chuột trên lưới tuần: tô đậm ô 30 phút dưới con trỏ, kèm giờ, để biết bấm sẽ thêm việc vào đâu.
  $('cal-body').addEventListener('pointermove', (e) => {
    const colEl = e.target.closest('.cw-col');
    const old = $('cal-body').querySelector('.cw-hover');
    if (!colEl || !wk || e.buttons || e.target.closest('.cw-ev')) { old?.remove(); return; }
    const r = colEl.getBoundingClientRect();
    const scale = r.height / colEl.offsetHeight || 1;
    const slot = Math.floor(((e.clientY - r.top) / scale / HOUR_PX) * 2); // số ô 30 phút tính từ đầu khung giờ
    const a = wk.h0 * 60 + slot * 30;
    if (slot < 0 || a >= wk.h1 * 60) { old?.remove(); return; }
    let h = old;
    if (!h || h.parentElement !== colEl) { old?.remove(); h = document.createElement('div'); h.className = 'cw-hover'; colEl.appendChild(h); }
    if (h.dataset.a === String(a)) return;
    h.dataset.a = String(a);
    h.style.top = `${slot * HOUR_PX / 2}px`;
    h.style.height = `${HOUR_PX / 2}px`;
    h.textContent = `${hhmm(a)}–${hhmm(a + 30)}`;
  });
  $('cal-body').addEventListener('pointerleave', () => $('cal-body').querySelector('.cw-hover')?.remove());
  $('cal-filters').addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]');
    if (c) { if (st.hidden.has(c.dataset.cat)) st.hidden.delete(c.dataset.cat); else st.hidden.add(c.dataset.cat); LS('pv.calHidden', JSON.stringify([...st.hidden])); draw(); return; }
    if (e.target.closest('[data-tasks]')) { st.tasks = !st.tasks; LS('pv.calTasks', st.tasks ? '1' : '0'); draw(); }
  });
  const page = root.querySelector('.cal-page');
  page.addEventListener('click', async (e) => {
    if (e.target.closest('.cw-ev')) return;
    const ev = e.target.closest('.cal-chip[data-ev]');
    if (ev) { const x = allEvents().find((k) => k.id === ev.dataset.ev); if (x) editEvent(x, ev.dataset.date); return; }
    const tk = e.target.closest('.cal-chip[data-task]');
    if (tk) { location.hash = `#/notebook/${tk.dataset.task.split(':')[0]}`; return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) { const x = allEvents().find((k) => k.id === ed.dataset.edit); if (x) editEvent(x, ed.dataset.date); return; }
    const ad = e.target.closest('[data-add-day]');
    if (ad) return editEvent({ date: ad.dataset.addDay });
    const sl = e.target.closest('[data-slot]');
    if (sl) return editEvent({ date: st.sel, start: hhmm(Number(sl.dataset.slot)), end: hhmm(Number(sl.dataset.slotEnd)) });
    const sc = e.target.closest('[data-sched]');
    if (sc) {
      const p = paperById(sc.dataset.sched);
      const evs = (itemsIn(st.sel, st.sel).get(st.sel) || []).filter((x) => x.kind === 'ev');
      const [a, b] = freeSlots(st.sel, evs)[0] || [];
      return editEvent({ date: st.sel, title: `Đọc: ${plainTitle(p?.title || '').slice(0, 80)}`, cat: 'read', paperId: p?.id || '', start: a != null ? hhmm(a) : '', end: a != null ? hhmm(Math.min(b, a + 60)) : '' });
    }
    const di = e.target.closest('[data-diary]');
    if (di) { const p = await ensureDailyPage(di.dataset.diary); location.hash = `#/notebook/${p.id}`; return; }
    const cell = e.target.closest('[data-date]');
    if (cell && !cell.classList.contains('cw-col') && !cell.classList.contains('cw-ev') && !e.target.closest('a, input, button, select')) { st.sel = cell.dataset.date; if (st.view === 'agenda') { draw(); return; } drawSide(); page.querySelectorAll('.cal-cell, .cw-col, .cw-dh').forEach((c) => c.classList.toggle('sel', c.dataset.date === st.sel)); }
  });
  page.addEventListener('change', async (e) => {
    const ec = e.target.closest('[data-ev-cb]');
    if (ec) { await toggleDone(ec.dataset.evCb, ec.dataset.date); draw(); return; }
    const tc = e.target.closest('[data-task-cb]');
    if (tc) { const [pid, line] = tc.dataset.taskCb.split(':'); await toggleDatedTask(pid, Number(line)); draw(); }
  });
  page.addEventListener('dblclick', (e) => {
    const cell = e.target.closest('.cal-cell[data-date], .cw-ad[data-date], .cw-dh[data-date]');
    if (cell && !e.target.closest('.cal-chip')) editEvent({ date: cell.dataset.date });
  });
  // Kéo một kế hoạch (không lặp) sang ngày khác.
  page.addEventListener('dragstart', (e) => { const c = e.target.closest('.cal-chip[data-ev]'); if (c) { e.dataTransfer.setData('text/x-cal', c.dataset.ev); e.dataTransfer.effectAllowed = 'move'; } });
  page.addEventListener('dragover', (e) => { const cell = e.target.closest('.cal-cell, .cal-wcol'); if (cell && [...e.dataTransfer.types].includes('text/x-cal')) { e.preventDefault(); page.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')); cell.classList.add('drop'); } });
  page.addEventListener('drop', async (e) => {
    const id = e.dataTransfer.getData('text/x-cal');
    const cell = e.target.closest('.cal-cell, .cal-wcol');
    page.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
    if (!id || !cell) return;
    e.preventDefault();
    const x = allEvents().find((k) => k.id === id);
    if (!x || x.date === cell.dataset.date) return;
    await saveEvent({ ...x, date: cell.dataset.date });
    toast(`Đã dời “${x.title}” sang ${fmtDay(cell.dataset.date)}.`);
    draw();
  });

  draw();
  const unsubA = onCalendarChange(() => { if ($('cal-body')) draw(); });
  const unsubB = onPagesChange(() => { if ($('cal-body')) draw(); });
  return () => { unsubA(); unsubB(); };
}
