// Bản đồ tài liệu 2D: gộp ba cách nhìn của các công cụ khám phá tài liệu.
//  - Cụm tương đồng (kiểu Connected Papers): bài đặt gần nhau khi dẫn nhiều bài chung hoặc hay được cùng một bài dẫn,
//    không chỉ khi dẫn trực tiếp nhau; màu theo năm, cỡ theo số trích dẫn; danh sách Nền tảng / Phát triển.
//  - Dòng thời gian (kiểu Litmaps): trục ngang là ngày đăng, trục dọc là số trích dẫn, cạnh là quan hệ dẫn.
//  - Nhiều bài gốc (kiểu ResearchRabbit): thêm một bài trên bản đồ làm bài gốc để mở rộng bản đồ theo hướng đó; bản đồ
//    được lưu theo paper, mở lại giữ nguyên các bài gốc đã thêm.
// Dữ liệu lấy từ /api/s2/graph (cùng nguồn với đồ thị 3D, máy chủ tính sẵn độ tương đồng).
import { api } from './api.js';
import { store, paperById } from './store.js';
import { togglePin, compareState, compareButtonHtml } from './research.js';
import { escapeHtml, download } from './util.js';
import { el, showProgress, toast } from './ui.js';
import { s2Ident } from './s2util.js';
import { titleHtml, plainTitle } from './richtext.js';
import { libraryMatch } from './graph3d.js';

const KV = (pid) => `litmap:${pid}`;
const N_OPTIONS = [40, 80, 150, 300];
const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
const linkOf = (n) => (n.arxiv ? `https://arxiv.org/abs/${n.arxiv}` : (n.doi ? `https://doi.org/${n.doi}` : n.url));
const surname = (n) => { const a = String(n.authors || '').split(',')[0].trim(); return a ? a.split(/\s+/).pop() : (plainTitle(n.title || '').split(/\s+/).slice(0, 2).join(' ') || '?'); };
const shortLabel = (n) => `${surname(n)}${n.year ? ` ${n.year}` : ''}`;
const fmtN = (x) => (x >= 10000 ? `${Math.round(x / 1000)}k` : x >= 1000 ? `${(x / 1000).toFixed(1)}k` : String(x || 0));
const dateFrac = (n) => {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(n.date || '');
  if (m) return Number(m[1]) + (Number(m[2]) - 1) / 12 + (Number(m[3] || 15) - 1) / 365;
  return n.year ? n.year + 0.5 : null;
};
const radius = (n) => 4 + Math.min(16, 3.1 * Math.log10((n.citations || 0) + 1)) + (n.isSeed ? 3 : 0);

/** Mở bản đồ tài liệu toàn màn hình cho một paper trong thư viện. */
export async function openLitMap(paper) {
  const mainIdent = s2Ident(paper);
  if (!mainIdent) return toast('Paper chưa có arXiv ID, DOI hoặc link nên không dựng được bản đồ.', 4000, 'err');
  const saved = await api.kvGet(KV(paper.id)).catch(() => null) || {};
  const st = {
    view: saved.view === 'time' ? 'time' : 'sim',
    n: N_OPTIONS.includes(saved.n) ? saved.n : 80,
    minW: typeof saved.minW === 'number' ? saved.minW : 0.25,
    hideLib: !!saved.hideLib,
    y0: 0, y1: 0, q: '', tab: 'rel',
  };
  // Bài gốc: bài đang xem (cố định) + các bài người dùng thêm để mở rộng.
  const seeds = [{ ident: mainIdent, title: paper.title, main: true }, ...((saved.seeds || []).filter((s) => s.ident && s.ident !== mainIdent))];
  const graphs = new Map(); // ident -> dữ liệu đồ thị từ máy chủ
  let nodes = new Map();    // id -> nút đã gộp
  let simEdges = new Map(); // 'a|b' -> w
  let cites = new Set();    // 'a>b': a dẫn b
  let visible = Object.assign([], { edges: [], cites: [], maxW: 1 });
  let forced = new Set();   // bài người dùng chọn từ danh sách dù nằm ngoài top N
  let selected = null;
  let hover = null;
  let maxScore = 1;

  const ov = el(`<div class="lm-overlay" role="dialog" aria-label="Bản đồ tài liệu">
    <div class="lm-top">
      <div class="lm-title"><b>🗺 Bản đồ tài liệu</b></div>
      <div class="seg lm-view" id="lm-view"><button data-v="sim" title="Bài gần nhau khi dẫn nhiều bài chung hoặc hay được cùng một bài dẫn (kiểu Connected Papers)">Cụm tương đồng</button><button data-v="time" title="Trục ngang: ngày đăng · trục dọc: số trích dẫn · cạnh: quan hệ dẫn (kiểu Litmaps)">Dòng thời gian</button></div>
      <div class="lm-tools">
        <label title="Số bài hiện trên bản đồ, chọn theo mức liên quan với các bài gốc">Hiện <select id="lm-n">${N_OPTIONS.map((x) => `<option value="${x}">${x} bài</option>`).join('')}</select></label>
        <label>Năm <select id="lm-y0"></select>–<select id="lm-y1"></select></label>
        <label id="lm-minw-wrap" title="Chỉ vẽ liên kết tương đồng từ mức này trở lên">Liên kết ≥ <input type="range" id="lm-minw" min="0" max="0.6" step="0.05"></label>
        <label title="Ẩn bài đã có trong thư viện (bài gốc vẫn hiện)"><input type="checkbox" id="lm-hidelib"> Ẩn bài đã có</label>
        <input type="search" id="lm-q" placeholder="Tìm tên bài, tác giả…">
        <button class="sm" id="lm-fit" title="Đưa toàn bộ bản đồ vào khung nhìn">Vừa khung</button>
        <button class="sm" id="lm-png" title="Lưu ảnh bản đồ đang xem">Ảnh PNG</button>
        <button class="sm" id="lm-refresh" title="Lấy lại dữ liệu từ Semantic Scholar cho mọi bài gốc">Tải lại</button>
        <button class="sm" id="lm-close" title="Esc chỉ bỏ chọn bài đang chọn">Đóng (Shift + Esc)</button>
      </div>
    </div>
    <div class="lm-seedbar"><div class="lm-seeds" id="lm-seeds"></div><span class="hint lm-stats" id="lm-stats"></span></div>
    <div class="lm-body">
      <div class="lm-canvas" id="lm-canvas"><canvas id="lm-cv"></canvas><div class="lm-wait" id="lm-wait"></div><div class="lm-tip" id="lm-tip" hidden></div>
        <div class="lm-legend" id="lm-legend"></div></div>
      <aside class="lm-side" id="lm-side">
        <div id="lm-detail"></div>
        <div class="seg lm-tabs" id="lm-tabs">
          <button data-t="rel" title="Xếp theo mức tương đồng với các bài gốc">Liên quan nhất</button>
          <button data-t="prior" title="Bài được nhiều bài trên bản đồ cùng dẫn: thường là công trình nền tảng của hướng này">Nền tảng</button>
          <button data-t="deriv" title="Bài dẫn nhiều bài trên bản đồ: thường là tổng quan hoặc công trình tiếp nối gần đây">Phát triển</button>
          <button data-t="lib" title="Bài trên bản đồ đã có trong thư viện của bạn">Trong thư viện</button>
        </div>
        <div class="lm-list" id="lm-list"></div>
      </aside>
    </div>
    <div class="lm-help hint">Esc bỏ chọn · Shift + Esc đóng · kéo nền để dời · cuộn để phóng to · kéo một bài để dời nó · bấm một bài để xem chi tiết · 🌱 <b>Thêm làm bài gốc</b> để mở rộng bản đồ theo hướng của bài đó</div>
  </div>`);
  document.body.appendChild(ov);
  const $$ = (id) => ov.querySelector(`#${id}`);
  const cv = $$('lm-cv');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const T = { k: 1, x: 0, y: 0 }; // màn hình = thế giới * k + (x, y)

  const close = () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('keydown', onKey, true); ov.remove(); };
  // Esc: bỏ chọn bài đang chọn; Shift + Esc: đóng bản đồ.
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    if (e.shiftKey && !e.ctrlKey && !e.altKey) close(); // Shift + Esc: Windows không dùng tổ hợp này (Ctrl + Esc mở menu Start)
    else if (document.activeElement === $$('lm-q') && st.q) { $$('lm-q').value = ''; st.q = ''; draw(); }
    else if (selected) select(null);
  };
  document.addEventListener('keydown', onKey, true);
  $$('lm-close').addEventListener('click', close);

  const persist = () => api.kvSet(KV(paper.id), { seeds: seeds.filter((s) => !s.main).map(({ ident, title }) => ({ ident, title })), view: st.view, n: st.n, minW: st.minW, hideLib: st.hideLib }).catch(() => {});

  /* ---------------- dữ liệu ---------------- */

  async function loadSeed(s, refresh = false) {
    if (graphs.has(s.ident) && !refresh) return true;
    try {
      const g = await api.s2Graph(s.ident, { refresh });
      graphs.set(s.ident, g);
      s.id = g.center?.id;
      if (!s.title) s.title = g.center?.title || s.ident;
      return true;
    } catch (e) {
      toast(`Không lấy được dữ liệu cho “${plainTitle(s.title || s.ident)}”: ${e.message}`, 6000, 'err');
      return false;
    }
  }

  async function loadAll(refresh = false) {
    $$('lm-wait').hidden = false;
    showProgress($$('lm-wait'), `Đang lấy bài tham khảo, bài dẫn và độ tương đồng từ Semantic Scholar cho ${seeds.length} bài gốc…`, { expectedMs: 9000 * seeds.length });
    for (const s of [...seeds]) {
      const ok = await loadSeed(s, refresh);
      if (!ok && !s.main) seeds.splice(seeds.indexOf(s), 1);
    }
    $$('lm-wait').hidden = true;
    if (!graphs.has(mainIdent)) { $$('lm-wait').hidden = false; $$('lm-wait').innerHTML = '<span class="status err">Không lấy được dữ liệu cho bài này.</span><div class="hint">Semantic Scholar giới hạn tốc độ khi không có key, thử lại sau hoặc thêm S2 API key trong Cài đặt.</div>'; return; }
    merge();
    initYears();
    relayout(true);
  }

  /** Gộp đồ thị của mọi bài gốc thành một bản đồ. */
  function merge() {
    const prev = nodes;
    nodes = new Map();
    simEdges = new Map();
    cites = new Set();
    const seedIds = new Set(seeds.map((s) => s.id).filter(Boolean));
    const put = (raw, extra) => {
      let n = nodes.get(raw.id);
      if (!n) {
        const old = prev.get(raw.id);
        n = { ...raw, simBy: {}, rel: new Set(), inG: 0, outG: 0, shared: 0, x: old?.x, y: old?.y, vx: 0, vy: 0 };
        nodes.set(raw.id, n);
      }
      Object.assign(n, extra);
      return n;
    };
    for (const s of seeds) {
      const g = graphs.get(s.ident);
      if (!g) continue;
      const c = g.center || {};
      put({ id: c.id, title: c.title, year: c.year, citations: c.citations, venue: c.venue, arxiv: c.arxiv, doi: c.doi, url: c.url, authors: c.authors || '', date: c.date || '' }, { isSeed: true, main: !!s.main });
      for (const raw of g.nodes || []) {
        const n = put(raw, {});
        n.simBy[c.id] = Math.max(n.simBy[c.id] || 0, raw.simSeed || 0);
        n.rel.add(raw.kind);
        n.inG = Math.max(n.inG, raw.inG || 0);
        n.outG = Math.max(n.outG, raw.outG || 0);
        n.shared = Math.max(n.shared, raw.shared || 0);
        if (!n.tldr && raw.tldr) n.tldr = raw.tldr;
        if (!n.abstract && raw.abstract) n.abstract = raw.abstract;
      }
      for (const e of g.sim || []) {
        const k = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
        simEdges.set(k, Math.max(simEdges.get(k) || 0, e.w));
      }
      for (const l of g.links || []) cites.add(`${l.source}>${l.target}`);
    }
    for (const n of nodes.values()) {
      n.isSeed = seedIds.has(n.id);
      n.lib = libraryMatch(n);
      const sims = Object.values(n.simBy);
      // Liên quan với nhiều bài gốc thì xếp cao hơn (giống bản đồ nhiều bài gốc của Litmaps).
      n.score = n.isSeed ? 99 : sims.reduce((a, b) => a + b, 0) + 0.04 * Math.log10((n.citations || 0) + 1) + (n.rel.has('ref') || n.rel.has('cit') ? 0.05 : 0);
    }
    maxScore = Math.max(0.0001, ...[...nodes.values()].filter((n) => !n.isSeed).map((n) => n.score));
    [yearLo, yearHi] = yearDomain(); // thang màu theo năm dùng chung cho bản đồ, danh sách và chú thích
  }

  function initYears() {
    const ys = [...nodes.values()].map((n) => n.year).filter(Boolean);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const opts = (sel) => { const out = []; for (let y = lo; y <= hi; y++) out.push(`<option value="${y}" ${y === sel ? 'selected' : ''}>${y}</option>`); return out.join(''); };
    // Người dùng chưa tự chọn năm thì luôn lấy trọn khoảng năm của bản đồ (thêm bài gốc thì khoảng năm rộng ra).
    if (!st.yUser || !st.y0 || st.y0 < lo || st.y0 > hi) st.y0 = lo;
    if (!st.yUser || !st.y1 || st.y1 > hi || st.y1 < lo) st.y1 = hi;
    $$('lm-y0').innerHTML = opts(st.y0);
    $$('lm-y1').innerHTML = opts(st.y1);
  }

  /** Tập bài đang hiện: N bài liên quan nhất qua bộ lọc, luôn kèm bài gốc và bài người dùng chọn từ danh sách. */
  function computeVisible() {
    const pass = (n) => n.isSeed || forced.has(n.id) || ((!n.year || (n.year >= st.y0 && n.year <= st.y1)) && !(st.hideLib && n.lib));
    const ranked = [...nodes.values()].filter((n) => !n.isSeed && pass(n)).sort((a, b) => b.score - a.score);
    const keep = new Set([...nodes.values()].filter((n) => n.isSeed).map((n) => n.id));
    for (const n of ranked) { if (keep.size >= st.n + seeds.length) break; keep.add(n.id); }
    for (const id of forced) if (nodes.has(id)) keep.add(id);
    visible = [...keep].map((id) => nodes.get(id)).filter((n) => st.view !== 'time' || dateFrac(n) != null);
    const ids = new Set(visible.map((n) => n.id));
    visible.edges = [...simEdges].map(([k, w]) => { const [a, b] = k.split('|'); return { a: nodes.get(a), b: nodes.get(b), w }; }).filter((e) => e.a && e.b && ids.has(e.a.id) && ids.has(e.b.id));
    visible.cites = [...cites].map((k) => { const [a, b] = k.split('>'); return { a: nodes.get(a), b: nodes.get(b) }; }).filter((e) => e.a && e.b && ids.has(e.a.id) && ids.has(e.b.id));
    visible.maxW = Math.max(0.0001, ...visible.edges.map((e) => e.w));
  }

  /* ---------------- bố cục ---------------- */

  let raf = 0;
  let alpha = 0;
  let anim = null; // chuyển cảnh sang bố cục dòng thời gian
  const TW = 1200, TH = 640; // khung thế giới của dòng thời gian
  let tl = null; // { lo, hi, lcMax }

  function relayout(fit = false) {
    computeVisible();
    if (st.view === 'sim') {
      const seedsV = visible.filter((n) => n.isSeed);
      seedsV.forEach((s, i) => { if (s.x == null) { s.x = i * 160 - (seedsV.length - 1) * 80; s.y = 0; } });
      for (const n of visible) {
        if (n.x != null) continue; // giữ vị trí cũ (kể cả từ dòng thời gian): lực sẽ kéo về cụm, chuyển cảnh mượt
        const near = seedsV.reduce((best, s) => ((n.simBy[s.id] || 0) > (n.simBy[best?.id] || -1) ? s : best), seedsV[0]);
        const r = 120 + 260 * (1 - Math.min(1, n.score / maxScore));
        const a = Math.random() * Math.PI * 2;
        n.x = (near?.x || 0) + Math.cos(a) * r;
        n.y = (near?.y || 0) + Math.sin(a) * r;
      }
      anim = null;
      alpha = 1;
    } else {
      const ds = visible.map(dateFrac);
      const lo = Math.floor(Math.min(...ds)), hi = Math.ceil(Math.max(...ds)) || lo + 1;
      const lcMax = Math.max(1, ...visible.map((n) => Math.log10((n.citations || 0) + 1)));
      tl = { lo, hi: hi === lo ? lo + 1 : hi, lcMax };
      const tgt = new Map(visible.map((n) => [n, { x: ((dateFrac(n) - tl.lo) / (tl.hi - tl.lo)) * TW, y: (1 - Math.log10((n.citations || 0) + 1) / tl.lcMax) * TH }]));
      // Gỡ chồng nút: đẩy nhẹ theo chiều dọc, giữ đúng vị trí ngang (ngày đăng).
      const arr = [...tgt];
      for (let it = 0; it < 60; it++) {
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            const [na, pa] = arr[i]; const [nb, pb] = arr[j];
            const dx = pb.x - pa.x, dy = pb.y - pa.y, min = radius(na) + radius(nb) + 2;
            if (Math.abs(dx) < min && Math.abs(dy) < min) { const d = Math.hypot(dx, dy) || 0.1; if (d < min) { const push = (min - d) / 2; const uy = d > 0.2 ? dy / d : (Math.random() - 0.5); pa.y -= uy * push; pb.y += uy * push; pa.x -= (dx / d) * push * 0.15; pb.x += (dx / d) * push * 0.15; } }
          }
        }
      }
      anim = { t0: performance.now(), from: new Map(visible.map((n) => [n, { x: n.x ?? tgt.get(n).x, y: n.y ?? tgt.get(n).y }])), to: tgt };
      alpha = 0;
    }
    drawList();
    drawLegend();
    stats();
    if (fit) { pendingFit = 2; autoFit = true; }
    kick();
  }
  let autoFit = true; // khung nhìn tự đi theo bố cục lực cho tới khi người dùng dời / phóng to
  let pendingFit = 0; // 2: vừa khung ngay khung hình đầu; 1: vừa khung lại khi bố cục lực gần ổn định

  function tick() {
    const vs = visible;
    const n = vs.length;
    for (let i = 0; i < n; i++) {
      const a = vs[i];
      for (let j = i + 1; j < n; j++) {
        const b = vs[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const d = Math.sqrt(d2);
        const f = (1400 * alpha) / d2;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
        const min = radius(a) + radius(b) + 6;
        if (d < min) { const p = ((min - d) / d) * 0.25; a.vx -= dx * p; a.vy -= dy * p; b.vx += dx * p; b.vy += dy * p; }
      }
    }
    for (const e of vs.edges) {
      if (e.w < st.minW * visible.maxW) continue;
      const wn = Math.min(1, e.w / visible.maxW);
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.hypot(dx, dy) || 1;
      const L = 40 + 170 * (1 - wn);
      const f = (d - L) * (0.02 + 0.1 * wn) * alpha;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      e.a.vx += fx; e.a.vy += fy; e.b.vx -= fx; e.b.vy -= fy;
    }
    for (const v of vs) {
      if (v === dragNode) { v.vx = 0; v.vy = 0; continue; }
      v.vx -= v.x * 0.012 * alpha; v.vy -= v.y * 0.012 * alpha;
      v.vx *= 0.55; v.vy *= 0.55;
      v.x += v.vx; v.y += v.vy;
    }
    alpha *= 0.985;
  }

  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    let busy = false;
    if (st.view === 'sim' && alpha > 0.02) { for (let i = 0; i < 3; i++) tick(); busy = true; }
    if (anim) {
      const t = Math.min(1, (now - anim.t0) / 550);
      const e = 1 - (1 - t) ** 3;
      for (const [n, p] of anim.to) { const f = anim.from.get(n); n.x = f.x + (p.x - f.x) * e; n.y = f.y + (p.y - f.y) * e; }
      if (t >= 1) anim = null; else busy = true;
    }
    if (pendingFit === 2) { fitView(); pendingFit = st.view === 'sim' ? 1 : 0; } else if (pendingFit === 1 && autoFit) { fitView(); if (!busy) pendingFit = 0; }
    draw();
    if (busy) kick();
  }

  function fitView() {
    const vs = st.view === 'time' && anim ? [...anim.to.values()] : visible;
    if (!vs.length) return;
    const xs = vs.map((v) => v.x), ys = vs.map((v) => v.y);
    const minX = Math.min(...xs) - 30, maxX = Math.max(...xs) + 30, minY = Math.min(...ys) - 30, maxY = Math.max(...ys) + 30;
    const padL = st.view === 'time' ? 56 : 20, padB = st.view === 'time' ? 34 : 20;
    const k = Math.max(0.15, Math.min(3, Math.min((W - padL - 20) / (maxX - minX || 1), (H - padB - 20) / (maxY - minY || 1))));
    T.k = k;
    T.x = padL + (W - padL - 20 - (maxX - minX) * k) / 2 - minX * k;
    T.y = 20 + (H - padB - 20 - (maxY - minY) * k) / 2 - minY * k;
  }

  /* ---------------- vẽ ---------------- */

  const css = (name, fb) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
  let yearLo = 0, yearHi = 1;
  // Thang màu theo năm: xanh tím (cũ) -> xanh ngọc -> vàng -> cam (mới). Mọi màu đều đủ đậm để thấy trên nền sáng lẫn tối.
  const STOPS = [[0, [91, 110, 225]], [0.35, [24, 160, 170]], [0.68, [214, 168, 0]], [1, [234, 84, 24]]];
  const mix = (t) => {
    for (let i = 1; i < STOPS.length; i++) {
      const [t1, c1] = STOPS[i];
      const [t0, c0] = STOPS[i - 1];
      if (t <= t1) { const u = (t - t0) / (t1 - t0 || 1); return c0.map((v, k) => Math.round(v + (c1[k] - v) * u)); }
    }
    return STOPS[STOPS.length - 1][1];
  };
  /** Miền năm của thang màu: bỏ 5% bài cũ nhất (thường lẻ loi vài bài rất cũ làm cả bản đồ cùng một màu). */
  function yearDomain() {
    const ys = [...nodes.values()].map((n) => n.year).filter(Boolean).sort((a, b) => a - b);
    if (!ys.length) return [0, 1];
    const lo = ys[Math.floor(ys.length * 0.05)];
    const hi = ys[ys.length - 1];
    return [lo, Math.max(hi, lo + 1)];
  }
  function yearColor(n, a = 1) {
    if (!n.year) return `rgba(150,150,150,${a})`;
    const t = Math.max(0, Math.min(1, (n.year - yearLo) / Math.max(1, yearHi - yearLo)));
    const [r, g, b] = mix(t);
    return `rgba(${r},${g},${b},${a})`;
  }

  function resize() {
    const box = $$('lm-canvas');
    dpr = window.devicePixelRatio || 1;
    W = box.clientWidth; H = box.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    draw();
  }
  window.addEventListener('resize', resize);

  const sx = (x) => x * T.k + T.x;
  const sy = (y) => y * T.k + T.y;
  const qMatch = (n) => st.q && (`${n.title} ${n.authors}`.toLowerCase().includes(st.q));

  function neighborsOf(n) {
    const out = new Set();
    if (!n) return out;
    if (st.view === 'sim') for (const e of visible.edges) { if (e.a === n) out.add(e.b); else if (e.b === n) out.add(e.a); }
    else for (const e of visible.cites) { if (e.a === n) out.add(e.b); else if (e.b === n) out.add(e.a); }
    return out;
  }

  function draw() {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const text = css('--text', '#111'), muted = css('--muted', '#888'), border = css('--border', '#ddd'), accent = css('--accent', '#4f46e5');
    [yearLo, yearHi] = yearDomain();
    const focus = selected || hover;
    const nb = neighborsOf(focus);
    const dim = (n) => focus && n !== focus && !nb.has(n);

    if (st.view === 'time' && tl) drawAxes(muted, border);

    // cạnh
    ctx.lineCap = 'round';
    if (st.view === 'sim') {
      for (const e of visible.edges) {
        if (e.w < st.minW * visible.maxW) continue;
        const wn = Math.min(1, e.w / visible.maxW);
        const on = focus && (e.a === focus || e.b === focus);
        ctx.strokeStyle = on ? accent : muted;
        ctx.globalAlpha = on ? 0.85 : (focus ? 0.05 : 0.08 + 0.35 * wn);
        ctx.lineWidth = on ? 1.2 + 2 * wn : 0.6 + 1.6 * wn;
        ctx.beginPath(); ctx.moveTo(sx(e.a.x), sy(e.a.y)); ctx.lineTo(sx(e.b.x), sy(e.b.y)); ctx.stroke();
      }
    } else {
      for (const e of visible.cites) {
        const on = focus && (e.a === focus || e.b === focus);
        if (focus && !on) continue;
        ctx.strokeStyle = on ? accent : muted;
        ctx.globalAlpha = on ? 0.8 : 0.1;
        ctx.lineWidth = on ? 1.4 : 0.7;
        const x1 = sx(e.a.x), y1 = sy(e.a.y), x2 = sx(e.b.x), y2 = sy(e.b.y);
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.15;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // nút
    const ordered = [...visible].sort((a, b) => (a === focus) - (b === focus) || a.isSeed - b.isSeed);
    for (const n of ordered) {
      const r = radius(n) * Math.min(1.6, Math.max(0.7, Math.sqrt(T.k)));
      const x = sx(n.x), y = sy(n.y);
      ctx.globalAlpha = dim(n) ? 0.3 : 1;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = yearColor(n);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = isDark() ? 'rgba(255,255,255,.45)' : 'rgba(15,23,42,.35)';
      ctx.stroke();
      if (n.lib) { ctx.lineWidth = 2.4; ctx.strokeStyle = '#16a34a'; ctx.beginPath(); ctx.arc(x, y, r + 1.5, 0, Math.PI * 2); ctx.stroke(); }
      if (n.isSeed) { ctx.lineWidth = 3; ctx.strokeStyle = text; ctx.beginPath(); ctx.arc(x, y, r + (n.lib ? 4 : 2), 0, Math.PI * 2); ctx.stroke(); }
    }
    // Vòng đánh dấu (bài đang chọn, đang rê, khớp tìm kiếm): vẽ sau cùng, có viền nền để luôn thấy trọn hình tròn.
    ctx.globalAlpha = 1;
    for (const n of visible) {
      const sel = n === selected || n === hover;
      if (!sel && !qMatch(n)) continue;
      const r = radius(n) * Math.min(1.6, Math.max(0.7, Math.sqrt(T.k))) + (n.isSeed ? 7 : 5);
      const x = sx(n.x), y = sy(n.y);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.lineWidth = 5; ctx.strokeStyle = css('--bg', '#fff'); ctx.stroke();
      ctx.lineWidth = 2.5; ctx.strokeStyle = sel ? accent : '#f59e0b'; ctx.stroke();
    }
    // nhãn: bài gốc, bài đang chọn / rê, bài khớp tìm kiếm, và bài trích dẫn nhiều khi đủ chỗ
    ctx.globalAlpha = 1;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const topCited = new Set([...visible].sort((a, b) => (b.citations || 0) - (a.citations || 0)).slice(0, T.k > 1.5 ? 60 : T.k > 0.9 ? 18 : 8));
    for (const n of visible) {
      const show = n.isSeed || n === selected || n === hover || qMatch(n) || nb.has(n) || (!focus && topCited.has(n));
      if (!show) continue;
      const r = radius(n) * Math.min(1.6, Math.max(0.7, Math.sqrt(T.k)));
      const label = shortLabel(n);
      const x = sx(n.x), y = sy(n.y) + r + 12;
      ctx.lineWidth = 3; ctx.strokeStyle = css('--bg', '#fff'); ctx.globalAlpha = dim(n) ? 0.4 : 0.9; ctx.strokeText(label, x, y);
      ctx.fillStyle = n.isSeed ? text : (dim(n) ? muted : text); ctx.globalAlpha = dim(n) ? 0.5 : 1; ctx.fillText(label, x, y);
    }
    ctx.globalAlpha = 1;
  }

  function drawAxes(muted, border) {
    ctx.save();
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = muted; ctx.strokeStyle = border; ctx.lineWidth = 1;
    const span = tl.hi - tl.lo;
    const step = span > 30 ? 10 : span > 14 ? 5 : span > 6 ? 2 : 1;
    ctx.textAlign = 'center';
    for (let y = Math.ceil(tl.lo / step) * step; y <= tl.hi; y += step) {
      const x = sx(((y - tl.lo) / span) * TW);
      if (x < 40 || x > W) continue;
      ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 22); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillText(String(y), x, H - 8);
    }
    ctx.textAlign = 'right';
    for (const c of [0, 1, 10, 100, 1000, 10000, 100000]) {
      const lc = Math.log10(c + 1);
      if (lc > tl.lcMax + 0.01) break;
      const y = sy((1 - lc / tl.lcMax) * TH);
      if (y < 8 || y > H - 22) continue;
      ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.moveTo(44, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillText(fmtN(c), 40, y + 4);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left'; ctx.fillText('↑ số trích dẫn', 6, 14);
    ctx.textAlign = 'right'; ctx.fillText('ngày đăng →', W - 8, H - 26);
    ctx.restore();
  }

  /* ---------------- tương tác ---------------- */

  /** Toạ độ chuột trong khung vẽ, đã bù tỉ lệ phóng của trang (Cài đặt > cỡ chữ giao diện dùng CSS zoom). */
  const pt = (e) => {
    const r = cv.getBoundingClientRect();
    const s = r.width / (W || r.width || 1);
    return [(e.clientX - r.left) / s, (e.clientY - r.top) / s];
  };
  const pick = (mx, my) => {
    let best = null, bd = Infinity;
    for (const n of visible) {
      const r = radius(n) * Math.min(1.6, Math.max(0.7, Math.sqrt(T.k))) + 3;
      const d = Math.hypot(sx(n.x) - mx, sy(n.y) - my);
      if (d < r && d < bd) { bd = d; best = n; }
    }
    return best;
  };
  let drag = null; let dragNode = null; let moved = false;
  cv.addEventListener('pointerdown', (e) => {
    const [mx, my] = pt(e);
    const n = pick(mx, my);
    moved = false;
    cv.setPointerCapture(e.pointerId);
    if (n && st.view === 'sim') { dragNode = n; drag = { mx, my }; } else drag = { mx, my, tx: T.x, ty: T.y, node: n };
  });
  cv.addEventListener('pointermove', (e) => {
    const [mx, my] = pt(e);
    if (drag) {
      if (Math.abs(mx - drag.mx) + Math.abs(my - drag.my) > 3) moved = true;
      if (dragNode) { autoFit = false; dragNode.x = (mx - T.x) / T.k; dragNode.y = (my - T.y) / T.k; alpha = Math.max(alpha, 0.25); kick(); }
      else if (moved) { autoFit = false; T.x = drag.tx + mx - drag.mx; T.y = drag.ty + my - drag.my; draw(); }
      return;
    }
    const n = pick(mx, my);
    if (n !== hover) { hover = n; cv.style.cursor = n ? 'pointer' : 'grab'; draw(); }
    const tip = $$('lm-tip');
    if (n) {
      tip.hidden = false;
      tip.innerHTML = `<b>${titleHtml(n.title || '')}</b><div class="hint">${escapeHtml(n.authors || '')}${n.year ? ` · ${n.year}` : ''} · ↗ ${fmtN(n.citations)}${n.lib ? ' · <span style="color:#16a34a">đã có trong thư viện</span>' : ''}</div>`;
      tip.style.left = `${Math.min(W - 300, mx + 14)}px`; tip.style.top = `${Math.min(H - 70, my + 14)}px`;
    } else tip.hidden = true;
  });
  cv.addEventListener('pointerup', (e) => {
    const [mx, my] = pt(e);
    if (!moved) { const n = pick(mx, my); select(n); }
    drag = null; dragNode = null;
  });
  cv.addEventListener('pointerleave', () => { hover = null; $$('lm-tip').hidden = true; draw(); });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [mx, my] = pt(e);
    autoFit = false;
    const k = Math.max(0.1, Math.min(6, T.k * Math.exp(-e.deltaY * 0.0015)));
    T.x = mx - ((mx - T.x) / T.k) * k; T.y = my - ((my - T.y) / T.k) * k; T.k = k;
    draw();
  }, { passive: false });

  function select(n, center = false) {
    selected = n || null;
    if (n && center) {
      const p = anim?.to?.get(n) || n;
      autoFit = false;
      T.x = W / 2 - p.x * T.k; T.y = H / 2 - p.y * T.k;
    }
    drawDetail();
    drawList();
    draw();
  }

  /* ---------------- bảng bên ---------------- */

  const seedName = (id) => { const n = nodes.get(id); return n ? shortLabel(n) : '?'; };

  function drawDetail() {
    const box = $$('lm-detail');
    const n = selected;
    if (!n) {
      let mini = false;
      try { mini = localStorage.getItem('pv.lmIntro') === '0'; } catch (_) { /* bỏ qua */ }
      if (mini) {
        box.innerHTML = '<button type="button" class="lm-intro-mini linkish" data-lm-intro="1">ℹ Cách đọc bản đồ ▸</button>';
      } else box.innerHTML = `<div class="lm-card lm-intro"><div class="lm-intro-h"><b>Cách đọc bản đồ</b><button type="button" class="ghost sm" data-lm-intro="0" title="Thu gọn">Thu gọn ▴</button></div>
        <ul><li><b>Cụm tương đồng</b>: bài gần nhau khi dẫn nhiều bài chung hoặc thường được dẫn cùng nhau, nên hai bài cùng hướng vẫn đứng cạnh nhau dù không dẫn trực tiếp nhau.</li>
        <li><b>Dòng thời gian</b>: bên trái là bài cũ, bên phải là bài mới; càng cao càng được trích dẫn nhiều. Bấm một bài để thấy nó dẫn và được dẫn bởi bài nào.</li>
        <li>Màu theo năm: <b style="color:rgb(91,110,225)">xanh tím</b> là bài cũ, <b style="color:rgb(234,84,24)">cam</b> là bài mới (thang năm ở góc dưới bản đồ) · cỡ nút theo số trích dẫn · <span style="color:#16a34a">viền xanh lá</span>: đã có trong thư viện · viền đậm: bài gốc.</li></ul></div>`;
      box.querySelector('[data-lm-intro]').addEventListener('click', (e) => {
        try { localStorage.setItem('pv.lmIntro', e.currentTarget.dataset.lmIntro); } catch (_) { /* bỏ qua */ }
        drawDetail();
      });
      return;
    }
    const p = paperById(paper.id);
    const rels = [];
    for (const s of seeds) {
      if (!s.id || s.id === n.id) continue;
      const nm = escapeHtml(seedName(s.id));
      if (cites.has(`${s.id}>${n.id}`)) rels.push(`🌱 ${nm} dẫn bài này`);
      if (cites.has(`${n.id}>${s.id}`)) rels.push(`Bài này dẫn 🌱 ${nm}`);
      if (n.simBy[s.id]) rels.push(`Tương đồng với 🌱 ${nm}: ${Math.round((n.simBy[s.id] / maxScore) * 100)}%`);
    }
    if (n.rel.has('hop2') && n.shared) rels.push(`Bài nền chung: ${n.shared} bài trên bản đồ cùng dẫn`);
    if (n.inG) rels.push(`Được ${n.inG} bài trên bản đồ dẫn`);
    if (n.outG) rels.push(`Dẫn ${n.outG} bài trên bản đồ`);
    const seed = seeds.find((s) => s.id === n.id);
    const link = linkOf(n);
    box.innerHTML = `<div class="lm-card">
      <div class="lm-card-t">${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">${titleHtml(n.title || '')}</a>` : titleHtml(n.title || '')}</div>
      <div class="hint">${escapeHtml(n.authors || '')}${n.year ? ` · ${n.year}` : ''}${n.venue ? ` · ${escapeHtml(n.venue)}` : ''} · ↗ ${fmtN(n.citations)} trích dẫn</div>
      ${n.isSeed ? `<div class="lm-badges"><span class="badge accent">🌱 bài gốc${n.main ? ' (bài đang xem)' : ''}</span></div>` : ''}
      ${rels.length ? `<ul class="lm-rels">${rels.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
      ${n.tldr || n.abstract ? `<p class="lm-abs">${escapeHtml(n.tldr || n.abstract)}${!n.tldr && (n.abstract || '').length >= 300 ? '…' : ''}</p>` : ''}
      <div class="lm-acts">
        ${n.lib ? '<button class="sm" data-lm-open>Mở trong thư viện</button>' : (n.main ? '' : '<button class="sm primary" data-lm-add>+ Thêm vào thư viện</button>')}
        ${n.isSeed ? (seed && !seed.main ? '<button class="sm" data-lm-unseed>Bỏ khỏi bài gốc</button>' : '') : '<button class="sm" data-lm-seed title="Lấy thêm bài tham khảo, bài dẫn và bài tương đồng của bài này rồi gộp vào bản đồ">🌱 Thêm làm bài gốc</button>'}
        ${n.main ? '' : compareButtonHtml(compareState(p, n), 'data-lm-cmp', { long: true })}
        <button class="sm ghost" data-lm-unsel>Bỏ chọn</button>
      </div></div>`;
    box.querySelector('[data-lm-open]')?.addEventListener('click', () => { close(); location.hash = `#/paper/${n.lib.id}`; });
    box.querySelector('[data-lm-add]')?.addEventListener('click', () => { const q = n.arxiv ? `arXiv:${n.arxiv}` : (n.doi || n.url || n.title); close(); location.hash = `#/add?q=${encodeURIComponent(q)}`; });
    box.querySelector('[data-lm-unsel]')?.addEventListener('click', () => select(null));
    box.querySelector('[data-lm-seed]')?.addEventListener('click', () => addSeed(n));
    box.querySelector('[data-lm-unseed]')?.addEventListener('click', () => removeSeed(seed));
    box.querySelector('[data-lm-cmp]')?.addEventListener('click', async (e) => {
      if (e.currentTarget.dataset.cmpGo) { close(); location.hash = `#/paper/${paper.id}?tab=research`; return; }
      const kind = n.rel.has('ref') ? 'ref' : n.rel.has('cit') ? 'cit' : 'other';
      await togglePin(paper.id, { ...n, kind }, kind);
      drawDetail();
    });
  }

  function listRows() {
    const all = [...nodes.values()].filter((n) => !n.isSeed);
    if (st.tab === 'prior') return all.filter((n) => n.inG >= 2).sort((a, b) => b.inG - a.inG || (a.year || 0) - (b.year || 0));
    if (st.tab === 'deriv') return all.filter((n) => n.outG >= 2).sort((a, b) => b.outG - a.outG || (b.year || 0) - (a.year || 0));
    if (st.tab === 'lib') return all.filter((n) => n.lib).sort((a, b) => b.score - a.score);
    return all.sort((a, b) => b.score - a.score);
  }

  function drawList() {
    $$('lm-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.t === st.tab));
    const rows = listRows().slice(0, 200);
    const vis = new Set(visible.map((n) => n.id));
    const metric = (n) => (st.tab === 'prior' ? `<span class="lm-metric" title="Số bài trên bản đồ dẫn bài này">${n.inG} bài dẫn</span>`
      : st.tab === 'deriv' ? `<span class="lm-metric" title="Số bài trên bản đồ mà bài này dẫn">dẫn ${n.outG}</span>`
        : `<span class="lm-metric" title="Mức liên quan so với bài liên quan nhất">${Math.round((n.score / maxScore) * 100)}%</span>`);
    const note = { rel: 'Xếp theo mức tương đồng với các bài gốc.', prior: 'Bài được nhiều bài trên bản đồ cùng dẫn, thường là công trình nền tảng.', deriv: 'Bài dẫn nhiều bài trên bản đồ, thường là tổng quan hoặc công trình tiếp nối.', lib: 'Bài trên bản đồ đã có trong thư viện.' }[st.tab];
    $$('lm-list').innerHTML = `<div class="hint lm-list-note">${note} ${rows.length ? `(${rows.length})` : ''}</div>${rows.map((n) => `<button type="button" class="lm-row ${n === selected ? 'on' : ''} ${vis.has(n.id) ? '' : 'off'}" data-id="${escapeHtml(n.id)}">
      <i class="lm-dot" style="background:${yearColor(n)}${n.lib ? ';box-shadow:0 0 0 2px #16a34a' : ''}"></i>
      <span class="lm-row-b"><span class="lm-row-t">${titleHtml(n.title || '')}</span><span class="hint">${escapeHtml(surname(n))}${n.year ? ` · ${n.year}` : ''} · ↗ ${fmtN(n.citations)}${vis.has(n.id) ? '' : ' · chưa hiện trên bản đồ'}</span></span>${metric(n)}</button>`).join('') || '<div class="hint" style="padding:10px">Chưa có bài nào.</div>'}`;
  }

  function drawLegend() {
    [yearLo, yearHi] = yearDomain();
    const lo = yearLo, hi = yearHi;
    const oldest = Math.min(...[...nodes.values()].map((n) => n.year).filter(Boolean));
    const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(lo + (hi - lo) * f)))];
    const grad = STOPS.map(([t, c]) => `rgb(${c.join(',')}) ${Math.round(t * 100)}%`).join(', ');
    $$('lm-legend').innerHTML = `<span class="lm-yr"><span class="lm-yr-k">Năm</span><span class="lm-yr-bar"><span class="lm-grad" style="background:linear-gradient(90deg, ${grad})"></span>
        <span class="lm-yr-ticks">${ticks.map((y) => `<span style="left:${((y - lo) / Math.max(1, hi - lo)) * 100}%">${y === lo && oldest < lo ? `≤${y}` : y}</span>`).join('')}</span></span><span class="lm-yr-k">cũ → mới</span></span>
      <span class="lm-lg"><i class="lm-dot" style="width:7px;height:7px;background:${yearColor({ year: lo })}"></i><i class="lm-dot" style="width:14px;height:14px;background:${yearColor({ year: lo })}"></i> cỡ = số trích dẫn</span>
      <span class="lm-lg"><i class="lm-dot lm-ring-lib"></i> trong thư viện</span><span class="lm-lg"><i class="lm-dot lm-ring-seed"></i> bài gốc</span>`;
  }

  function stats() {
    const undated = [...nodes.values()].filter((n) => dateFrac(n) == null).length;
    $$('lm-stats').textContent = `${nodes.size} bài · ${seeds.length} bài gốc${undated ? ` · ${undated} bài không rõ ngày đăng (ẩn ở dòng thời gian)` : ''}`;
    $$('lm-stats').title = `Đang hiện ${visible.length} bài trên bản đồ`;
  }

  function drawSeeds() {
    $$('lm-seeds').innerHTML = `<span class="hint">Bài gốc:</span>${seeds.map((s, i) => `<span class="lm-seed ${s.main ? 'main' : ''}" title="${escapeHtml(plainTitle(s.title || s.ident))}"><button type="button" class="linkish" data-seed-go="${i}">🌱 ${escapeHtml(plainTitle(s.title || s.ident).slice(0, 60))}</button>${s.main ? '' : `<button type="button" class="lm-seed-x" data-seed-x="${i}" title="Bỏ bài gốc này">✕</button>`}</span>`).join('')}
      <span class="hint lm-seed-tip">${seeds.length < 2 ? 'Bấm một bài trên bản đồ rồi chọn “Thêm làm bài gốc” để mở rộng.' : 'Bài liên quan tới nhiều bài gốc được xếp cao hơn.'}</span>`;
  }

  async function addSeed(n) {
    if (seeds.some((s) => s.id === n.id)) return;
    const s = { ident: n.id, title: n.title, id: n.id };
    seeds.push(s);
    drawSeeds();
    $$('lm-wait').hidden = false;
    showProgress($$('lm-wait'), `Đang mở rộng bản đồ từ “${plainTitle(n.title).slice(0, 60)}”…`, { expectedMs: 9000 });
    const ok = await loadSeed(s);
    $$('lm-wait').hidden = true;
    if (!ok) { seeds.splice(seeds.indexOf(s), 1); drawSeeds(); return; }
    persist();
    merge();
    initYears();
    relayout(true);
    select(nodes.get(n.id));
    toast(`Đã thêm bài gốc. Bản đồ có ${nodes.size} bài.`);
  }

  function removeSeed(s) {
    if (!s || s.main) return;
    seeds.splice(seeds.indexOf(s), 1);
    graphs.delete(s.ident);
    persist();
    drawSeeds();
    merge();
    initYears();
    selected = null;
    relayout(true);
    drawDetail();
  }

  /* ---------------- điều khiển ---------------- */

  $$('lm-view').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === st.view));
  $$('lm-n').value = String(st.n);
  $$('lm-minw').value = String(st.minW);
  $$('lm-hidelib').checked = st.hideLib;
  const syncMinW = () => {
    const on = st.view === 'sim';
    $$('lm-minw-wrap').classList.toggle('lm-off', !on);
    $$('lm-minw').disabled = !on;
    $$('lm-minw-wrap').title = on ? 'Chỉ vẽ liên kết tương đồng từ mức này trở lên' : 'Chỉ dùng ở chế độ Cụm tương đồng';
  };
  syncMinW();
  $$('lm-view').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b || b.dataset.v === st.view) return;
    st.view = b.dataset.v;
    $$('lm-view').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    syncMinW();
    persist();
    relayout(true);
  });
  $$('lm-n').addEventListener('change', (e) => { st.n = Number(e.target.value); persist(); relayout(true); });
  $$('lm-y0').addEventListener('change', (e) => { st.yUser = true; st.y0 = Number(e.target.value); if (st.y0 > st.y1) { st.y1 = st.y0; $$('lm-y1').value = String(st.y1); } relayout(true); });
  $$('lm-y1').addEventListener('change', (e) => { st.yUser = true; st.y1 = Number(e.target.value); if (st.y1 < st.y0) { st.y0 = st.y1; $$('lm-y0').value = String(st.y0); } relayout(true); });
  $$('lm-minw').addEventListener('input', (e) => { st.minW = Number(e.target.value); alpha = Math.max(alpha, 0.4); kick(); });
  $$('lm-minw').addEventListener('change', persist);
  $$('lm-hidelib').addEventListener('change', (e) => { st.hideLib = e.target.checked; persist(); relayout(); });
  $$('lm-q').addEventListener('input', (e) => { st.q = e.target.value.trim().toLowerCase(); draw(); });
  $$('lm-fit').addEventListener('click', () => { autoFit = true; fitView(); draw(); });
  $$('lm-refresh').addEventListener('click', () => loadAll(true));
  $$('lm-png').addEventListener('click', () => {
    // Ảnh có nền (canvas trong suốt): vẽ lên một canvas phụ có nền trùng màu trang.
    const out = document.createElement('canvas');
    out.width = cv.width; out.height = cv.height;
    const c2 = out.getContext('2d');
    c2.fillStyle = css('--bg', '#fff'); c2.fillRect(0, 0, out.width, out.height);
    c2.drawImage(cv, 0, 0);
    out.toBlob((blob) => blob && download(`ban-do-tai-lieu-${(plainTitle(paper.title) || 'paper').slice(0, 40).replace(/[^\p{L}\p{N}]+/gu, '-')}.png`, blob, 'image/png'));
  });
  $$('lm-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) { st.tab = b.dataset.t; drawList(); } });
  $$('lm-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    const n = nodes.get(b.dataset.id);
    if (!n) return;
    if (!visible.includes(n)) { forced.add(n.id); relayout(); }
    select(n, true);
  });
  $$('lm-list').addEventListener('mouseover', (e) => { const b = e.target.closest('[data-id]'); const n = b && nodes.get(b.dataset.id); if (n !== hover) { hover = n && visible.includes(n) ? n : null; draw(); } });
  $$('lm-seeds').addEventListener('click', (e) => {
    const x = e.target.closest('[data-seed-x]');
    if (x) return removeSeed(seeds[Number(x.dataset.seedX)]);
    const g = e.target.closest('[data-seed-go]');
    if (g) { const s = seeds[Number(g.dataset.seedGo)]; const n = s?.id && nodes.get(s.id); if (n) select(n, true); }
  });

  drawSeeds();
  drawDetail();
  resize();
  await loadAll(false);
}
