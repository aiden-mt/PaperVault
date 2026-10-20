// Dòng thời gian các paper dẫn bài này: cột chồng theo tháng (hoặc quý, năm khi trải dài), mỗi màu một cách dùng bài
// gốc. Nhìn để biết hướng này còn được quan tâm hay đã chững lại. Rê chuột vào cột để xem số liệu, có bảng thay thế.
import { escapeHtml } from './util.js';
import { pubTime, ROLE_LABELS } from './s2util.js';

const ORDER = ['method', 'result', 'mention', 'unknown']; // thứ tự cố định từ đáy lên, màu theo vai chứ không theo hạng
const W = 760;
const H = 190;
const PAD = { l: 34, r: 8, t: 10, b: 26 };

const WEEK = 7 * 864e5;
function bucketer(times) {
  const min = Math.min(...times);
  const now = Date.now();
  const months = (now - min) / (30.4 * 864e5);
  // Bài được dẫn rất nhiều thì 100 bài mới nhất chỉ nằm trong vài tuần: chia theo tuần mới thấy được nhịp.
  const unit = months <= 2.5 ? 'week' : (months <= 24 ? 'month' : (months <= 96 ? 'quarter' : 'year'));
  const keyOf = (t) => {
    if (unit === 'week') return Math.floor(t / WEEK);
    const d = new Date(t);
    const y = d.getUTCFullYear();
    if (unit === 'month') return y * 12 + d.getUTCMonth();
    if (unit === 'quarter') return y * 4 + Math.floor(d.getUTCMonth() / 3);
    return y;
  };
  const label = (k) => (unit === 'week' ? (() => { const d = new Date(k * WEEK); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`; })() : unit === 'month' ? `${(k % 12) + 1}/${Math.floor(k / 12)}` : (unit === 'quarter' ? `Q${(k % 4) + 1}/${Math.floor(k / 4)}` : String(k)));
  // Mốc đầu và cuối (ms) của một kỳ, để lọc danh sách theo cột được bấm.
  const bounds = (k) => {
    if (unit === 'week') return [k * WEEK, (k + 1) * WEEK];
    if (unit === 'month') return [Date.UTC(Math.floor(k / 12), k % 12, 1), Date.UTC(Math.floor((k + 1) / 12), (k + 1) % 12, 1)];
    if (unit === 'quarter') return [Date.UTC(Math.floor(k / 4), (k % 4) * 3, 1), Date.UTC(Math.floor((k + 1) / 4), ((k + 1) % 4) * 3, 1)];
    return [Date.UTC(k, 0, 1), Date.UTC(k + 1, 0, 1)];
  };
  return { unit, keyOf, label, bounds, from: keyOf(min), to: keyOf(now) };
}

/** HTML biểu đồ. items: danh sách bài dẫn; roleOf(item) -> 'method' | 'result' | 'mention' | 'unknown'. */
/** Mốc thời gian dùng cho lọc: ngày đăng ở tương lai (số tạp chí in sau) tính là hôm nay, giống cách vẽ cột. */
export const timelineTime = (it) => Math.min(pubTime(it), Date.now());

export function timelineHtml(items, roleOf, { capped = false, selected = [] } = {}) {
  const sel = new Set(selected);
  const now = Date.now();
  const dated = items.map((it) => ({ t: Math.min(pubTime(it), now), role: roleOf(it), inf: !!it._influential })).filter((x) => x.t);
  if (dated.length < 3) return '';
  const b = bucketer(dated.map((x) => x.t));
  const buckets = [];
  for (let k = b.from; k <= b.to; k += 1) { const [s, e] = b.bounds(k); buckets.push({ k, s, e, label: b.label(k), counts: { method: 0, result: 0, mention: 0, unknown: 0 }, total: 0, inf: 0 }); }
  for (const x of dated) {
    const bk = buckets[b.keyOf(x.t) - b.from];
    if (!bk) continue;
    bk.counts[x.role] += 1; bk.total += 1; if (x.inf) bk.inf += 1;
  }
  const max = Math.max(1, ...buckets.map((x) => x.total));
  const step = max <= 4 ? 1 : Math.ceil(max / 4);
  const top = Math.ceil(max / step) * step;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const band = innerW / buckets.length;
  const bw = Math.max(3, Math.min(24, band * 0.7));
  const y = (v) => PAD.t + innerH - (v / top) * innerH;
  const unitName = { week: 'tuần', month: 'tháng', quarter: 'quý', year: 'năm' }[b.unit];

  let grid = '';
  for (let v = 0; v <= top; v += step) grid += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}" class="${v ? 'tl-grid' : 'tl-base'}"/><text x="${PAD.l - 6}" y="${y(v) + 4}" class="tl-axis" text-anchor="end">${v}</text>`;
  const every = Math.max(1, Math.ceil(buckets.length / 12));
  let bars = '';
  buckets.forEach((bk, i) => {
    const cx = PAD.l + band * i + band / 2;
    const x0 = cx - bw / 2;
    if (i % every === 0 || i === buckets.length - 1) bars += `<text x="${cx}" y="${H - 8}" class="tl-axis" text-anchor="middle">${bk.label}</text>`;
    let base = 0;
    bars += `<g class="tl-col${sel.has(bk.s) ? ' sel' : ''}">`;
    const segs = ORDER.filter((r) => bk.counts[r]);
    segs.forEach((r, si) => {
      const y1 = y(base + bk.counts[r]);
      const y0 = y(base);
      const h = Math.max(1, y0 - y1 - (si < segs.length - 1 || base ? 0 : 0));
      const gap = si > 0 ? 2 : 0; // khe 2px màu nền giữa các đoạn chồng
      const hh = Math.max(1, h - gap);
      if (si === segs.length - 1) {
        const r4 = Math.min(4, hh, bw / 2); // đầu cột bo 4px, chân cột vuông
        bars += `<path class="tl-${r}" d="M${x0},${y0 - gap} V${y1 + r4} Q${x0},${y1} ${x0 + r4},${y1} H${x0 + bw - r4} Q${x0 + bw},${y1} ${x0 + bw},${y1 + r4} V${y0 - gap} Z"/>`;
      } else {
        bars += `<rect class="tl-${r}" x="${x0}" y="${y1}" width="${bw}" height="${hh}"/>`;
      }
      base += bk.counts[r];
    });
    bars += '</g>';
    bars += `<rect class="tl-hit${bk.total ? ' has' : ''}" x="${PAD.l + band * i}" y="${PAD.t}" width="${band}" height="${innerH}" data-i="${i}"/>`;
  });

  const legend = ORDER.filter((r) => buckets.some((bk) => bk.counts[r])).map((r) => `<span><i class="tl-key tl-${r}"></i>${escapeHtml(ROLE_LABELS.citations[r])}</span>`).join('');
  const rows = buckets.filter((bk) => bk.total).map((bk) => `<tr><td>${bk.label}</td>${ORDER.map((r) => `<td>${bk.counts[r] || ''}</td>`).join('')}<td><b>${bk.total}</b></td><td>${bk.inf || ''}</td></tr>`).join('');
  const picks = buckets.filter((bk) => sel.has(bk.s));
  return `<div class="tl${picks.length ? ' has-sel' : ''}" data-buckets='${escapeHtml(JSON.stringify(buckets.map((bk) => ({ l: bk.label, c: bk.counts, t: bk.total, inf: bk.inf, s: bk.s, e: bk.e }))))}'>
    <div class="tl-head"><b>Dòng thời gian</b><span class="hint">${dated.length} bài dẫn theo ${unitName} đăng${capped ? ', chỉ gồm 100 bài mới nhất' : ''} · bấm vào cột để lọc, bấm thêm cột khác để gộp</span></div>
    ${picks.length ? `<div class="tl-picks"><span class="hint">Đang lọc:</span>${picks.map((bk) => `<button class="tl-chip" data-tl-drop="${bk.s}" title="Bỏ kỳ này khỏi bộ lọc">${escapeHtml(bk.label)} ✕</button>`).join('')}<button class="linkish" data-tl-clear>Bỏ lọc toàn bộ</button></div>` : ''}<div class="tl-legend-row"><span class="spacer"></span><span class="tl-legend">${legend}</span></div>
    <div class="tl-plot"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Số paper dẫn bài này theo ${unitName}">${grid}${bars}</svg><div class="tl-tip" hidden></div></div>
    <details class="tl-table"><summary>Xem dạng bảng</summary><div class="table-wrap"><table><thead><tr><th>${unitName[0].toUpperCase()}${unitName.slice(1)}</th>${ORDER.map((r) => `<th>${escapeHtml(ROLE_LABELS.citations[r])}</th>`).join('')}<th>Tổng</th><th>Ảnh hưởng lớn</th></tr></thead><tbody>${rows}</tbody></table></div></details>
  </div>`;
}

/**
 * Gắn tooltip cho biểu đồ đã chèn vào trang. onPick({ s, e, label }) khi bấm một cột có bài (bên gọi tự bật / tắt kỳ đó
 * trong bộ lọc), onPick(null) khi bỏ lọc toàn bộ, onPick({ s, drop: true }) khi bỏ một kỳ bằng nút trên thanh lọc.
 */
export function bindTimeline(root, onPick = null) {
  const tl = root.querySelector('.tl');
  if (!tl) return;
  if (onPick) {
    tl.querySelector('.tl-plot').addEventListener('click', (ev) => {
      const hit = ev.target.closest('.tl-hit.has');
      if (!hit) return;
      const bk = JSON.parse(tl.dataset.buckets || '[]')[Number(hit.dataset.i)];
      onPick({ s: bk.s, e: bk.e, label: bk.l });
    });
    tl.querySelector('[data-tl-clear]')?.addEventListener('click', () => onPick(null));
    tl.querySelectorAll('[data-tl-drop]').forEach((b) => b.addEventListener('click', () => onPick({ s: Number(b.dataset.tlDrop), drop: true })));
  }
  const data = JSON.parse(tl.dataset.buckets || '[]');
  const tip = tl.querySelector('.tl-tip');
  const plot = tl.querySelector('.tl-plot');
  plot.addEventListener('mousemove', (ev) => {
    const hit = ev.target.closest('.tl-hit');
    if (!hit) { tip.hidden = true; plot.querySelectorAll('.tl-hit.on').forEach((x) => x.classList.remove('on')); return; }
    const bk = data[Number(hit.dataset.i)];
    plot.querySelectorAll('.tl-hit.on').forEach((x) => x.classList.remove('on'));
    hit.classList.add('on');
    tip.innerHTML = `<b>${bk.l}</b> · ${bk.t} bài${bk.inf ? ` · ${bk.inf} ảnh hưởng lớn` : ''}${bk.t ? '<div class="hint">Bấm để thêm hoặc bỏ kỳ này khỏi bộ lọc</div>' : ''}${ORDER.filter((r) => bk.c[r]).map((r) => `<div><i class="tl-key tl-${r}"></i>${escapeHtml(ROLE_LABELS.citations[r])}: <b>${bk.c[r]}</b></div>`).join('')}`;
    tip.hidden = false;
    const pr = plot.getBoundingClientRect();
    const z = pr.width / plot.offsetWidth || 1;
    let x = (ev.clientX - pr.left) / z + 12;
    if (x + 200 > plot.offsetWidth) x -= 224;
    tip.style.left = `${Math.max(0, x)}px`;
    tip.style.top = `${Math.max(0, (ev.clientY - pr.top) / z - 10)}px`;
  });
  plot.addEventListener('mouseleave', () => { tip.hidden = true; plot.querySelectorAll('.tl-hit.on').forEach((x) => x.classList.remove('on')); });
}
