// Đồ thị trích dẫn 3D quanh một paper: bài gốc ở giữa, các bài nó dẫn, các bài dẫn nó, và cạnh giữa các bài đó với nhau.
// Dùng 3d-force-graph (WebGL, đóng gói sẵn trong vendor, chỉ tải khi mở đồ thị). Kéo để xoay, cuộn để phóng, bấm một
// bài để xem chi tiết và bay tới đó, rê chuột để làm nổi các bài nối với nó.
import { api } from './api.js';
import { store, paperById } from './store.js';
import { togglePin, compareState, compareButtonHtml, compareBadgeHtml } from './research.js';
import { escapeHtml } from './util.js';
import { el, showProgress, toast } from './ui.js';
import { s2Ident, ctxQuotes } from './s2util.js';
import { rich, titleHtml, plainTitle } from './richtext.js';

// Màu lấy theo thứ tự cố định của bảng màu phân loại đã kiểm định (xanh dương, cam, xanh ngọc, tím), cho sáng và tối.
const PALETTE = {
  light: { ref: '#2a78d6', cit: '#eb6834', both: '#1baf7a', lib: '#6250d6', hop2: '#eda100', center: '#0b0b0b', link: 'rgba(80,80,90,.45)', inner: 'rgba(98,80,214,.55)', bg: '#fcfcfb', out: '#008300', in: '#d55181', faint: 'rgba(80,80,90,.08)', noYear: '#c3c2b7' },
  dark: { ref: '#3987e5', cit: '#d95926', both: '#199e70', lib: '#9085e9', hop2: '#c98500', center: '#f0efec', link: 'rgba(200,200,210,.28)', inner: 'rgba(144,133,233,.6)', bg: '#1a1a19', out: '#2fb52f', in: '#e87ba4', faint: 'rgba(200,200,210,.06)', noYear: '#52514e' },
};
// Năm đăng: thang viridis (đổi cả sắc lẫn độ sáng theo thứ tự, phân biệt được với người mù màu). Chia năm thành tối đa
// sáu nhóm, mỗi nhóm một màu rời, để nhìn là biết bài thuộc giai đoạn nào thay vì đoán sắc độ trên một dải liền.
// Bản sáng bỏ đoạn vàng nhạt nhất (chìm vào nền trắng), bản tối bỏ đoạn tím sẫm nhất (chìm vào nền đen).
const YEAR_COLORS = {
  light: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#b5cf1b'],
  dark: ['#5b3a8e', '#3e6ab0', '#2a9a9a', '#3dbb74', '#9bd643', '#fde725'],
};
// Chủ đề: bảng màu phân loại 7 ô theo thứ tự cố định (đã kiểm định cho người mù màu), ô cuối xám cho "Khác".
const TOPIC_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#2fb52f', '#9085e9'],
};
const STOP = new Set(('a an the and or of for in on to with without by from via using use used based towards toward into over under '
  + 'is are be being as at its it this that these those we our their can than more most less new novel approach approaches method '
  + 'methods study studies paper analysis framework frameworks towards beyond through across between within via vs versus case '
  + 'not do does how what when why which while where who whom toward study results result effective efficient simple general '
  + 'improving improved improve improves enhancing enhanced enhance large scale benchmark benchmarks evaluation evaluating evaluate '
  + 'model models task tasks data dataset datasets learning system systems based work existing propose proposed show shows '
  + 'one two three first also both each such other different via under also only well high low introduce introduces introducing '
  + 'present presents demonstrate demonstrates achieve achieves provide provides enable enables investigate finding findings '
  + 'find finds found across score scores performance problem problems setting settings against given among often even still however '
  + 'shown make makes made many much several various propose proposes proposed introduced state-of-the-art sota outperform '
  + 'outperforms outperforming current recent recently').split(/\s+/));
const TOPIC_MAX = 7;

/** Từ hoặc cụm hai từ đặc trưng của một bài (tiêu đề và TLDR), viết thường. */
function termsOf(n) {
  const words = `${n.title} ${n.tldr || ''}`.toLowerCase().replace(/[^a-z0-9\- ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  const out = new Set();
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (!STOP.has(w)) out.add(w.replace(/s$/, ''));
    const v = words[i + 1];
    if (v && !STOP.has(w) && !STOP.has(v)) out.add(`${w.replace(/s$/, '')} ${v.replace(/s$/, '')}`);
  }
  return out;
}

/**
 * Gán chủ đề cho từng bài. custom: danh sách từ khoá người dùng tự đặt (bài nhận từ khoá đầu tiên khớp).
 * Không có thì tự tìm: chọn lần lượt cụm từ phủ được nhiều bài chưa có chủ đề nhất (cụm hai từ được ưu tiên vì rõ nghĩa
 * hơn), bỏ cụm có ở quá nửa số bài vì đó là chủ đề chung của cả đồ thị. Trả về { topics: [{ label, count }], of: Map }.
 */
function computeTopics(nodes, custom, centerTitle = '') {
  const of = new Map();
  if (custom.length) {
    const counts = custom.map(() => 0);
    for (const n of nodes) {
      const text = `${n.title} ${n.tldr || ''} ${n.abstract || ''}`.toLowerCase();
      const i = custom.findIndex((k) => text.includes(k.toLowerCase()));
      if (i >= 0) { of.set(n.id, i); counts[i] += 1; }
    }
    return { topics: custom.map((k, i) => ({ label: k, count: counts[i] })), of };
  }
  const terms = new Map(nodes.map((n) => [n.id, termsOf(n)]));
  const df = new Map();
  for (const set of terms.values()) for (const w of set) df.set(w, (df.get(w) || 0) + 1);
  const maxDf = Math.max(3, nodes.length * 0.5);
  // Từ có trong tiêu đề bài gốc thì bài nào cũng nhắc tới, không phân biệt được chủ đề.
  const own = termsOf({ title: centerTitle });
  const cands = [...df].filter(([w, c]) => c >= 3 && c <= maxDf && !own.has(w) && !w.split(' ').some((x) => own.has(x))).map(([w]) => w);
  const topics = [];
  const left = new Set(nodes.map((n) => n.id));
  while (topics.length < TOPIC_MAX && left.size) {
    let best = null;
    let bestScore = 0;
    for (const w of cands) {
      let cover = 0;
      for (const id of left) if (terms.get(id).has(w)) cover += 1;
      const score = cover * (w.includes(' ') ? 2 : 1);
      if (cover >= 3 && score > bestScore) { best = w; bestScore = score; }
    }
    if (!best) break;
    const idx = topics.length;
    let count = 0;
    for (const id of [...left]) if (terms.get(id).has(best)) { of.set(id, idx); left.delete(id); count += 1; }
    topics.push({ label: best, count });
  }
  return { topics, of };
}

const KIND_LABEL = { ref: 'Bài này dẫn', cit: 'Dẫn bài này', both: 'Dẫn qua lại', lib: 'Đã có trong thư viện', hop2: 'Bài nền chung' };

let libLoading = null;
function loadLib() {
  if (window.ForceGraph3D) return Promise.resolve();
  libLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/force-graph-3d/3d-force-graph.min.js';
    s.onload = () => resolve();
    s.onerror = () => { libLoading = null; reject(new Error('Không tải được thư viện đồ thị 3D.')); };
    document.head.appendChild(s);
  });
  return libLoading;
}

const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function libraryMatch(n) {
  const t = norm(n.title);
  return store.papers.find((p) => (n.arxiv && p.arxivId && p.arxivId.replace(/v\d+$/, '') === n.arxiv)
    || (n.id && p.s2Id === n.id) || (n.doi && p.doi && p.doi.toLowerCase() === n.doi.toLowerCase()) || (t && norm(p.title) === t));
}
const linkOf = (n) => (n.arxiv ? `https://arxiv.org/abs/${n.arxiv}` : (n.doi ? `https://doi.org/${n.doi}` : n.url));

/** Mở đồ thị 3D toàn màn hình cho paper trong thư viện. */
export async function openGraph3D(paper) {
  const ident = s2Ident(paper);
  if (!ident) return toast('Paper chưa có arXiv ID, DOI hoặc link nên không dựng được đồ thị.', 4000, 'err');
  const ov = el(`<div class="g3-overlay" role="dialog" aria-label="Đồ thị trích dẫn 3D">
    <div class="g3-top">
      <div class="g3-title"><b>Đồ thị trích dẫn</b><span class="hint" id="g3-stats"></span></div>
      <div class="g3-tools">
        <label><input type="checkbox" id="g3-refs" checked> Bài này dẫn</label>
        <label><input type="checkbox" id="g3-cits" checked> Dẫn bài này</label>
        <label id="g3-hop2-wrap" hidden><input type="checkbox" id="g3-hop2show" checked> Bài nền chung</label>
        <label title="Chỉ giữ bài có cạnh nối với một bài khác ngoài bài gốc"><input type="checkbox" id="g3-inner"> Chỉ bài nối với nhau</label>
        <select id="g3-color" title="Tô màu nút theo"><option value="kind">Màu theo loại</option><option value="year">Màu theo năm</option><option value="topic">Màu theo chủ đề / từ khoá</option></select>
        <input type="search" id="g3-q" placeholder="Tìm tiêu đề…" style="width:170px">
        <input type="text" id="g3-kw" class="g3-kw-off" placeholder="Từ khoá, cách nhau bởi dấu phẩy" title="Chỉ dùng khi tô màu theo chủ đề. Để trống thì app tự tìm chủ đề từ tiêu đề và TLDR. Ví dụ: retrieval, medical, bootstrap" style="width:220px" disabled>
        <button class="sm" id="g3-fit" title="Đưa toàn bộ đồ thị vào khung nhìn">Vừa khung</button>
        <button class="sm" id="g3-refresh" title="Lấy lại danh sách bài từ Semantic Scholar (kết quả được lưu, chỉ lấy mới khi bấm)">Tải lại</button>
        <button class="sm" id="g3-research" title="So sánh các bài trong đồ thị với bài này, phần còn bỏ ngỏ và hướng nghiên cứu tiếp (tab Hướng nghiên cứu)">🧭 Hướng nghiên cứu${paper.researchMap ? '' : ' (tạo)'}</button>
        <button class="sm" id="g3-close" title="Esc chỉ bỏ chọn bài đang chọn">Đóng (Shift + Esc)</button>
      </div>
    </div>
    <div class="g3-expand">
      <span class="hint">Mở rộng:</span>
      <label title="Số bài dẫn bài này tối đa lấy về (mới nhất trước)">Bài dẫn tối đa <select id="g3-cits-n"><option value="100">100</option><option value="300">300</option><option value="500">500</option><option value="1000">1000</option><option value="custom">Tự nhập…</option></select></label>
      <span id="g3-cits-custom" class="g3-cits-custom" hidden><input type="number" id="g3-cits-v" min="10" max="5000" step="10" value="200" title="Từ 10 đến 5000 bài"><button class="sm" id="g3-cits-go">Áp dụng</button></span>
      <label title="Thêm các bài ngoài đồ thị mà nhiều bài trong đồ thị cùng dẫn, thường là công trình nền tảng của cả hướng"><input type="checkbox" id="g3-hop2"> Thêm bài nền chung (bậc 2)</label>
      <label id="g3-min-wrap" title="Một bài ngoài đồ thị phải được ít nhất bấy nhiêu bài trong đồ thị cùng dẫn">được ít nhất <select id="g3-min"><option value="2">2</option><option value="3" selected>3</option><option value="5">5</option><option value="8">8</option></select> bài cùng dẫn</label>
      <span class="hint" id="g3-expand-note">Đồ thị càng lớn thì lần đầu tải càng lâu, kết quả được lưu đệm 7 ngày.</span>
    </div>
    <div class="g3-legend" id="g3-legend"></div>
    <div class="g3-body">
      <aside class="g3-list" id="g3-list">
        <div class="g3-list-head"><b id="g3-list-count">Danh sách</b><span class="spacer"></span>
          <select id="g3-list-sort" title="Sắp xếp danh sách"><option value="cites">Nhiều trích dẫn</option><option value="year">Mới nhất</option><option value="deg">Nhiều liên kết</option><option value="rank">Hạng venue cao nhất</option><option value="title">Theo tên</option></select>
          <button class="ghost sm" id="g3-list-hide" title="Ẩn danh sách">◀</button></div>
        <div class="g3-filters">
          <input type="search" id="gf-name" placeholder="Lọc theo tên bài…">
          <input type="search" id="gf-kw" placeholder="Lọc theo từ khoá / chủ đề…" title="Tìm trong tiêu đề, TLDR, tóm tắt, venue và tên chủ đề. Nhiều từ khoá cách nhau bởi dấu phẩy, bài khớp một từ là qua.">
          <div class="g3-frow"><span>Năm</span><select id="gf-y0"></select><span>–</span><select id="gf-y1"></select></div>
          <div class="g3-frow"><span>Chủ đề</span><select id="gf-topic"><option value="">Mọi chủ đề</option></select></div>
          <div class="g3-frow"><span>Trích dẫn ≥</span><select id="gf-cites"><option value="0">0</option><option value="10">10</option><option value="50">50</option><option value="100">100</option><option value="500">500</option><option value="1000">1000</option></select></div>
          <div class="g3-frow"><label title="Bật: bộ lọc áp lên cả đồ thị, danh sách và đồ thị luôn hiện cùng một tập bài. Tắt: chỉ lọc danh sách, đồ thị giữ nguyên"><input type="checkbox" id="gf-link" checked> Liên kết với đồ thị</label><span class="spacer"></span><button class="linkish" id="gf-clear">Xoá lọc</button></div>
        </div>
        <div class="g3-list-items" id="g3-list-items"></div>
      </aside>
      <button class="g3-list-show sm" id="g3-list-show" title="Hiện danh sách paper" hidden>▶ Danh sách</button>
      <div class="g3-canvas" id="g3-canvas"><div class="g3-stage" id="g3-stage"></div><div class="g3-wait" id="g3-wait"></div><div class="g3-hover" id="g3-hover" hidden></div></div>
    </div>
    <aside class="g3-side" id="g3-side" hidden></aside>
    <div class="g3-help hint">Esc bỏ chọn · Shift + Esc đóng · kéo để xoay · cuộn để phóng to · chuột phải kéo để dời · bấm một bài để xem chi tiết · cỡ nút theo số trích dẫn</div>
  </div>`);
  document.body.appendChild(ov);
  const $$ = (id) => ov.querySelector(`#${id}`);
  let G = null;
  let raw = null;
  let selected = null;
  let hover = null;
  let neighbors = new Set();
  let matches = new Set();
  const close = () => {
    try { G?._destructor?.(); } catch (_) { /* bỏ qua */ }
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey, true);
    ov.remove();
  };
  // Esc: bỏ chọn bài đang chọn; Shift + Esc: đóng đồ thị.
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    if (e.shiftKey && !e.ctrlKey && !e.altKey) close(); // Shift + Esc: Windows không dùng tổ hợp này (Ctrl + Esc mở menu Start)
    else if (selected) { selected = null; side(null); refresh(); refreshList(); }
  };
  const onResize = () => { if (G) G.width($$('g3-canvas').clientWidth).height($$('g3-canvas').clientHeight); };
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  $$('g3-close').addEventListener('click', close);
  // Lối tắt sang tab Hướng nghiên cứu của bài đang xem.
  $$('g3-research').addEventListener('click', () => { close(); location.hash = `#/paper/${paper.id}?tab=research`; });

  /** Số bài dẫn tối đa: theo ô chọn, hoặc số tự nhập (10 đến 5000). */
  const citsLimit = () => {
    if ($$('g3-cits-n').value !== 'custom') return Number($$('g3-cits-n').value);
    const v = Math.round(Number($$('g3-cits-v').value) || 100);
    return Math.max(10, Math.min(5000, v));
  };
  const opts = () => ({ cits: citsLimit(), hop2: $$('g3-hop2').checked, minShared: Number($$('g3-min').value) });
  let loadId = 0; // chỉ nhận kết quả của lượt tải mới nhất (đổi số bài liên tiếp thì lượt cũ về muộn bị bỏ)
  async function load(refresh = false) {
    const my = ++loadId;
    $$('g3-wait').hidden = false;
    const o = opts();
    showProgress($$('g3-wait'), `Đang lấy bài tham khảo, tối đa ${o.cits} bài dẫn${o.hop2 ? ', bài nền chung' : ''} và liên kết giữa chúng từ Semantic Scholar…`, { expectedMs: 8000 + o.cits * 25 + (o.hop2 ? 8000 : 0) });
    try {
      await loadLib();
      const got = await api.s2Graph(ident, { ...opts(), refresh });
      if (my !== loadId) return;
      raw = got;
    } catch (e) {
      if (my !== loadId) return;
      $$('g3-wait').innerHTML = `<span class="status err">${escapeHtml(e.message)}</span><div class="hint">Semantic Scholar giới hạn tốc độ khi không có key, thử lại sau hoặc thêm S2 API key trong Cài đặt.</div>`;
      return;
    }
    if (!ov.isConnected) return;
    $$('g3-wait').hidden = true;
    for (const n of raw.nodes) n.lib = libraryMatch(n) || null;
    topicCache = null;
    fillFilterOptions();
    const s = raw.stats;
    $$('g3-stats').textContent = ` · ${raw.center.title} · ${s.refs} bài tham khảo · ${s.cits} bài dẫn${s.cits >= (s.citsLimit || 100) ? ` (${s.citsLimit || 100} bài mới nhất)` : ''}${s.hop2 ? ` · ${s.hop2} bài nền chung` : ''} · ${raw.innerFailed ? 'chưa lấy được liên kết giữa các bài' : `${s.inner} liên kết giữa các bài`}`;
    $$('g3-hop2-wrap').hidden = !s.hop2;
    if (raw.innerFailed) toast('Semantic Scholar đang giới hạn tốc độ nên chưa lấy được liên kết giữa các bài. Bấm Tải lại sau ít phút.', 8000, 'err');
    draw();
  }

  /** Bộ lọc năm / hạng / chủ đề / trích dẫn của khung danh sách. Bài gốc luôn qua. */
  function passFilters(n) {
    if (n.center) return true;
    const nameQ = plainTitle($$('gf-name').value).toLowerCase();
    if (nameQ && !plainTitle(n.title).toLowerCase().includes(nameQ)) return false;
    const kws = $$('gf-kw').value.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
    if (kws.length) {
      const ti = topicsNow().of.get(n.id);
      const hay = `${plainTitle(n.title)} ${n.tldr || ''} ${n.abstract || ''} ${n.venue || ''} ${ti == null ? '' : topicsNow().topics[ti]?.label || ''}`.toLowerCase();
      if (!kws.some((k) => hay.includes(k))) return false;
    }
    const y0 = Number($$('gf-y0').value) || 0;
    const y1 = Number($$('gf-y1').value) || 9999;
    if ((y0 || y1 < 9999) && !(n.year && n.year >= y0 && n.year <= y1)) return false;
    const tp = $$('gf-topic').value;
    if (tp !== '') { const i = topicsNow().of.get(n.id); if (tp === '-1' ? i != null : i !== Number(tp)) return false; }
    if ((n.citations || 0) < Number($$('gf-cites').value || 0)) return false;
    return true;
  }
  const filtersOn = () => !!($$('gf-name').value.trim() || $$('gf-kw').value.trim() || $$('gf-y0').value || $$('gf-y1').value || $$('gf-topic').value !== '' || Number($$('gf-cites').value));

  /** Điền lại các ô chọn năm và chủ đề theo dữ liệu hiện có, giữ lựa chọn cũ nếu còn hợp lệ. */
  function fillFilterOptions() {
    const ys = [...new Set(raw.nodes.map((n) => n.year).filter(Boolean))].sort((a, b) => a - b);
    for (const [id, label] of [['gf-y0', 'Từ'], ['gf-y1', 'Đến']]) {
      const el = $$(id);
      const cur = el.value;
      el.innerHTML = `<option value="">${label}</option>${ys.map((y) => `<option value="${y}">${y}</option>`).join('')}`;
      if (ys.includes(Number(cur))) el.value = cur;
    }
    const el = $$('gf-topic');
    const cur = el.value;
    const { topics, of } = topicsNow();
    el.innerHTML = `<option value="">Mọi chủ đề</option>${topics.map((x, i) => `<option value="${i}">${escapeHtml(x.label)} (${x.count})</option>`).join('')}<option value="-1">Khác (${raw.nodes.length - of.size})</option>`;
    if ([...el.options].some((o) => o.value === cur)) el.value = cur;
  }

  function filtered() {
    const showRefs = $$('g3-refs').checked;
    const showCits = $$('g3-cits').checked;
    const showHop2 = $$('g3-hop2show').checked;
    const innerOnly = $$('g3-inner').checked;
    const innerDeg = new Map();
    for (const l of raw.links) if (l.kind === 'inner') { innerDeg.set(l.source, (innerDeg.get(l.source) || 0) + 1); innerDeg.set(l.target, (innerDeg.get(l.target) || 0) + 1); }
    const keep = new Set([raw.center.id]);
    for (const n of raw.nodes) {
      const okKind = n.kind === 'hop2' ? showHop2 : (n.kind === 'both' ? (showRefs || showCits) : (n.kind === 'ref' ? showRefs : showCits));
      if (okKind && (!innerOnly || innerDeg.get(n.id)) && (!$$('gf-link').checked || passFilters(n))) keep.add(n.id);
    }
    // Bài nền chung chỉ nối tới các bài trong đồ thị đã dẫn nó. Ẩn loại bài đó đi (ví dụ tắt "Bài này dẫn") thì bài nền
    // chung nào không còn bài đang hiển thị nào dẫn tới sẽ trôi lơ lửng không cạnh: bỏ luôn những bài đó.
    const linked = new Set();
    for (const l of raw.links) if (l.kind === 'hop2' && keep.has(l.source) && keep.has(l.target)) linked.add(l.target);
    for (const n of raw.nodes) if (n.kind === 'hop2' && !linked.has(n.id)) keep.delete(n.id);
    const nodes = [{ ...raw.center, center: true, citations: raw.center.citations }, ...raw.nodes.filter((n) => keep.has(n.id))];
    // Dữ liệu gốc ghi "source dẫn target". Khi vẽ thì đảo chiều: mũi tên đi TỪ bài được dẫn SANG bài dẫn nó, tức theo
    // dòng ý tưởng được kế thừa. Từ đây trong đồ thị: source = bài được dẫn, target = bài dẫn.
    const links = raw.links.filter((l) => keep.has(l.source) && keep.has(l.target)).map((l) => ({ ...l, source: l.target, target: l.source }));
    return { nodes, links };
  }

  const years = () => raw.nodes.map((n) => n.year).filter(Boolean);
  /** Chia năm thành tối đa 6 nhóm có số bài gần bằng nhau, không cắt ngang một năm. [{ lo, hi, label, color }] */
  let binCache = null;
  function yearBins() {
    if (binCache) return binCache;
    const counts = new Map();
    for (const y of years()) counts.set(y, (counts.get(y) || 0) + 1);
    const ys = [...counts.keys()].sort((a, b) => a - b);
    const groups = [];
    if (ys.length <= 6) for (const y of ys) groups.push([y, y]);
    else {
      const target = years().length / 6;
      let start = null;
      let acc = 0;
      ys.forEach((y, i) => {
        if (start == null) start = y;
        acc += counts.get(y);
        const yearsLeft = ys.length - i - 1;
        const binsLeft = 6 - groups.length - 1;
        // Đóng nhóm khi đủ số bài, hoặc khi số năm còn lại chỉ vừa đủ chia cho các nhóm còn lại; nhóm cuối gom phần dư.
        if (i === ys.length - 1 || (groups.length < 5 && (acc >= target || yearsLeft === binsLeft))) { groups.push([start, y]); start = null; acc = 0; }
      });
    }
    const pal = YEAR_COLORS[isDark() ? 'dark' : 'light'];
    binCache = groups.map(([lo, hi], i) => ({
      lo, hi,
      label: lo === hi ? String(lo) : (i === 0 ? `≤ ${hi}` : `${lo}–${hi}`),
      color: pal[groups.length === 1 ? pal.length - 1 : Math.round((i * (pal.length - 1)) / (groups.length - 1))],
    }));
    return binCache;
  }
  let topicCache = null;
  const customKw = () => $$('g3-kw').value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, TOPIC_MAX);
  function topicsNow() {
    if (!topicCache) topicCache = computeTopics(raw.nodes, customKw(), raw.center.title);
    return topicCache;
  }
  function colorOf(n) {
    const pal = PALETTE[isDark() ? 'dark' : 'light'];
    const dim = (hover || matches.size) && !(n.id === hover?.id || neighbors.has(n.id) || matches.has(n.id) || n.id === selected?.id);
    let c;
    if (n.center) c = pal.center;
    else if ($$('g3-color').value === 'topic') { const i = topicsNow().of.get(n.id); c = i == null ? pal.noYear : TOPIC_COLORS[isDark() ? 'dark' : 'light'][i]; }
    else if ($$('g3-color').value === 'year') c = n.year ? (yearBins().find((b) => n.year >= b.lo && n.year <= b.hi)?.color || pal.noYear) : pal.noYear;
    else c = n.lib ? pal.lib : pal[n.kind];
    if (!dim) return c;
    const [r, g, b] = c.match(/\w\w/g).map((x) => parseInt(x, 16));
    return `rgba(${r},${g},${b},0.18)`; // bài không liên quan mờ đi khi đang rê chuột hoặc tìm
  }

  function legend() {
    const pal = PALETTE[isDark() ? 'dark' : 'light'];
    const arrows = `<span class="g3-sep"></span><span class="hint">Rê chuột vào một bài:</span><span><i class="g3-line" style="background:${pal.out}"></i>mũi tên ra, bài đó được bài kia dẫn</span><span><i class="g3-line" style="background:${pal.in}"></i>mũi tên vào, bài đó dẫn bài kia</span>`;
    if ($$('g3-color').value === 'topic') {
      topicCache = null;
      const { topics, of } = topicsNow();
      const cols = TOPIC_COLORS[isDark() ? 'dark' : 'light'];
      const other = raw.nodes.length - of.size;
      $$('g3-legend').innerHTML = `<span><i style="background:${pal.center}"></i>Bài đang xem</span><span class="hint">${customKw().length ? 'Từ khoá:' : 'Chủ đề tự tìm:'}</span>${topics.map((x, i) => `<button class="g3-topic" data-topic="${i}" title="Bấm để làm nổi các bài thuộc chủ đề này"><i style="background:${cols[i]}"></i>${escapeHtml(x.label)} <b>${x.count}</b></button>`).join('')}${other ? `<button class="g3-topic" data-topic="-1"><i style="background:${pal.noYear}"></i>Khác <b>${other}</b></button>` : ''}${topics.length ? '' : '<span class="hint">không tìm được chủ đề chung, hãy tự đặt từ khoá</span>'}${arrows}`;
      return;
    }
    if ($$('g3-color').value === 'year') {
      binCache = null;
      const bins = yearBins();
      const noYear = raw.nodes.some((n) => !n.year);
      $$('g3-legend').innerHTML = `<span><i style="background:${pal.center}"></i>Bài đang xem</span><span class="hint">Năm đăng:</span>${bins.map((b) => `<span><i style="background:${b.color}"></i>${b.label}</span>`).join('')}${noYear ? `<span><i style="background:${pal.noYear}"></i>Không rõ năm</span>` : ''}${arrows}`;
      return;
    }
    const has = (k) => raw.nodes.some((n) => (k === 'lib' ? n.lib : !n.lib && n.kind === k));
    $$('g3-legend').innerHTML = `<span><i style="background:${pal.center}"></i>Bài đang xem</span>${['ref', 'cit', 'both', 'hop2', 'lib'].filter(has).map((k) => `<span><i style="background:${pal[k]}"></i>${KIND_LABEL[k]}</span>`).join('')}<span><i class="g3-line" style="background:${pal.inner}"></i>Hai bài dẫn nhau</span>${arrows}`;
  }

  /** Số cạnh ra (bài này dẫn) và vào (được dẫn) của một bài trong đồ thị đang hiển thị. */
  function degrees(n) {
    let out = 0;
    let inn = 0;
    // Mũi tên đi từ bài được dẫn sang bài dẫn: cạnh ra = được dẫn, cạnh vào = dẫn bài khác.
    for (const l of G.graphData().links) { if ((l.source.id ?? l.source) === n.id) out += 1; if ((l.target.id ?? l.target) === n.id) inn += 1; }
    return { citedBy: out, cites: inn };
  }
  function hoverCard(n) {
    const pal = PALETTE[isDark() ? 'dark' : 'light'];
    const { citedBy, cites } = degrees(n);
    return `<b>${titleHtml(n.title)}</b>
      <div class="hint">${escapeHtml([n.authors, n.year, n.venue].filter(Boolean).join(' · '))}</div>
      <div class="g3-hc-tags">${n.center ? '<span class="badge accent">Bài đang xem</span>' : `<span class="badge">${KIND_LABEL[n.kind]}</span>`}${n.influential ? '<span class="badge accent">ảnh hưởng lớn</span>' : ''}${n.lib ? '<span class="badge ok">đã có trong thư viện</span>' : ''}<span class="badge">↗ ${n.citations || 0} trích dẫn</span>${n.rank ? `<span class="badge accent">${escapeHtml(n.rank)}</span>` : ''}</div>
      ${$$('g3-color').value === 'topic' && !n.center ? `<div class="hint">Chủ đề: <b>${escapeHtml(topicsNow().topics[topicsNow().of.get(n.id)]?.label || 'Khác')}</b></div>` : ''}
      ${n.kind === 'hop2' ? `<div class="hint">Nằm ngoài đồ thị, được <b>${n.shared || 0}</b> bài trong đồ thị cùng dẫn</div>` : ''}
      <div class="g3-hc-deg"><span><i style="background:${pal.out}"></i>được <b>${citedBy}</b> bài trong đồ thị dẫn (mũi tên ra)</span><span><i style="background:${pal.in}"></i>dẫn <b>${cites}</b> bài trong đồ thị (mũi tên vào)</span></div>
      ${n.tldr ? `<div class="g3-hc-tldr">${rich(n.tldr.length > 220 ? `${n.tldr.slice(0, 220)}…` : n.tldr)}</div>` : ''}
      <div class="hint">Bấm để xem chi tiết</div>`;
  }
  let mouse = { x: 0, y: 0 };
  const placeCard = () => {
    const card = $$('g3-hover');
    if (!card || card.hidden) return;
    const box = $$('g3-canvas');
    const z = box.getBoundingClientRect().width / box.offsetWidth || 1;
    let x = mouse.x / z + 16;
    let y = mouse.y / z + 16;
    if (x + card.offsetWidth > box.offsetWidth - 8) x = mouse.x / z - card.offsetWidth - 16;
    if (y + card.offsetHeight > box.offsetHeight - 8) y = Math.max(8, box.offsetHeight - card.offsetHeight - 8);
    card.style.left = `${Math.max(8, x)}px`;
    card.style.top = `${y}px`;
  };

  function side(n) {
    const box = $$('g3-side');
    if (!n) { box.hidden = true; return; }
    const lib = n.center ? paper : n.lib;
    const link = linkOf(n);
    const deg = G.graphData().links.filter((l) => (l.source.id ?? l.source) === n.id || (l.target.id ?? l.target) === n.id).length;
    box.innerHTML = `<button class="ghost sm g3-x" title="Đóng">✕</button>
      <h3>${titleHtml(n.title)}</h3>
      <div class="hint">${escapeHtml([n.authors, n.year, n.venue].filter(Boolean).join(' · '))}</div>
      ${n.center ? '' : `<div class="wn-pop-cmp">${compareBadgeHtml(compareState(paperById(paper.id), n))}</div>`}
      <div class="g3-badges">${n.center ? '<span class="badge accent">Bài đang xem</span>' : `<span class="badge">${KIND_LABEL[n.kind]}</span>`}${n.influential ? '<span class="badge accent">ảnh hưởng lớn</span>' : ''}<span class="badge">↗ ${n.citations || 0} trích dẫn</span><span class="badge">${deg} liên kết trong đồ thị</span></div>
      ${n.center ? '' : ctxQuotes(n.contexts, n.kind === 'cit' ? 'other' : 'main', { max: 3 })}
      ${n.tldr || n.abstract ? `<p class="g3-abs">${n.tldr ? '<span class="badge">TLDR</span> ' : ''}${rich(n.tldr || n.abstract)}</p>` : ''}
      <div class="row wrap" style="gap:6px;margin-top:8px">
        ${link ? `<a class="btn sm" href="${escapeHtml(link)}" target="_blank" rel="noopener">Mở link</a>` : ''}
        ${lib ? (n.center ? '' : `<a class="btn sm" href="#/paper/${lib.id}" data-go-lib>Mở trong thư viện</a>`) : `<button class="sm primary" data-add>+ Thêm vào thư viện</button>`}
        <button class="sm" data-focus>Bay tới</button>
        ${n.center ? '' : compareButtonHtml(compareState(paperById(paper.id), n), 'data-cmp', { long: true })}
      </div>`;
    box.hidden = false;
    box.querySelector('.g3-x').addEventListener('click', () => { selected = null; side(null); refresh(); });
    box.querySelector('[data-focus]').addEventListener('click', () => focus(n));
    box.querySelector('[data-cmp]')?.addEventListener('click', async (e) => {
      if (e.currentTarget.dataset.cmpGo) { close(); location.hash = `#/paper/${paper.id}?tab=research`; return; }
      await togglePin(paper.id, n, { ref: 'ref', both: 'ref', cit: 'cit' }[n.kind] || 'other');
      side(n);
    });
    box.querySelector('[data-add]')?.addEventListener('click', () => { const q = n.arxiv ? `arXiv:${n.arxiv}` : (n.doi || n.url || n.title); close(); location.hash = `#/add?q=${encodeURIComponent(q)}`; });
    box.querySelector('[data-go-lib]')?.addEventListener('click', () => close());
  }

  function focus(n) {
    const d = 220; // đủ xa để thấy cả các bài nối với nó
    const r = Math.hypot(n.x || 1, n.y || 1, n.z || 1);
    const k = 1 + d / r;
    G.cameraPosition({ x: (n.x || 1) * k, y: (n.y || 1) * k, z: (n.z || 1) * k }, n, 900);
  }

  function setHover(n) {
    hover = n || null;
    neighbors = new Set();
    if (n) for (const l of G.graphData().links) { const s = l.source.id ?? l.source; const t = l.target.id ?? l.target; if (s === n.id) neighbors.add(t); if (t === n.id) neighbors.add(s); }
  }

  /* Danh sách bên trái: các bài đang có trong đồ thị (theo bộ lọc), lọc thêm theo ô tìm hoặc chủ đề đang chọn. */
  function refreshList() {
    if (!G || !raw) return;
    const box = $$('g3-list-items');
    const nodes = G.graphData().nodes;
    const degOf = new Map();
    for (const l of G.graphData().links) for (const id of [l.source.id ?? l.source, l.target.id ?? l.target]) degOf.set(id, (degOf.get(id) || 0) + 1);
    // Đồ thị đã lọc sẵn, danh sách chỉ liệt kê đúng các bài đang có trên đồ thị (thêm phần làm nổi khi tìm hoặc bấm chủ đề).
    // Liên kết bật: đồ thị đã lọc sẵn nên danh sách lấy đúng các bài trên đồ thị. Tắt: danh sách tự lọc, đồ thị giữ nguyên.
    const linked = $$('gf-link').checked;
    let list = nodes.filter((n) => !n.center && (!matches.size || matches.has(n.id)) && (linked || passFilters(n)));
    const RANK_ORDER = { 'A*': 0, A: 1, B: 2, C: 3, Q1: 4, Q2: 5, Q3: 6, Q4: 7 };
    const by = {
      cites: (n) => -(n.citations || 0), year: (n) => -(Number(n.year) || 0), deg: (n) => -(degOf.get(n.id) || 0),
      rank: (n) => (RANK_ORDER[n.rank] ?? 99) * 1e7 - Math.min(n.citations || 0, 9999999), // cùng hạng thì nhiều trích dẫn trước
    }[$$('g3-list-sort').value];
    const nameKey = (n) => plainTitle(n.title).toLowerCase();
    list.sort(by ? (a, b) => by(a) - by(b) || nameKey(a).localeCompare(nameKey(b)) : (a, b) => nameKey(a).localeCompare(nameKey(b)));
    const center = nodes.find((n) => n.center);
    $$('g3-list-count').textContent = `${list.length}${matches.size || filtersOn() ? ` / ${raw.nodes.length}` : ''} bài`;
    const pal = PALETTE[isDark() ? 'dark' : 'light'];
    const row = (n) => {
      const saved = matches; matches = new Set(); const saveHover = hover; hover = null;
      const c = colorOf(n); // màu đúng như trên đồ thị, không bị làm mờ
      matches = saved; hover = saveHover;
      return `<div class="g3-li${selected?.id === n.id ? ' sel' : ''}${n.center ? ' center' : ''}" data-id="${escapeHtml(n.id)}">
        <i style="background:${n.center ? pal.center : c}"></i>
        <div><div class="g3-li-t">${titleHtml(n.title)}</div>
        <div class="g3-li-m">${[n.year, n.rank, `↗ ${n.citations || 0}`, n.center ? 'bài đang xem' : KIND_LABEL[n.kind], `${degOf.get(n.id) || 0} liên kết`].filter(Boolean).map((x) => escapeHtml(String(x))).join(' · ')}${n.lib ? ' · <b>trong thư viện</b>' : ''}</div></div></div>`;
    };
    box.innerHTML = (center && !matches.size ? row(center) : '') + list.map(row).join('') || '<div class="hint" style="padding:12px">Không có bài nào khớp.</div>';
  }

  const refresh = () => { if (G) G.nodeColor(G.nodeColor()).linkColor(G.linkColor()).linkWidth(G.linkWidth()).linkDirectionalParticles(G.linkDirectionalParticles()); };

  function draw({ keepCamera = false } = {}) {
    const pal = PALETTE[isDark() ? 'dark' : 'light'];
    const data = filtered();
    binCache = null;
    legend();
    const canvas = $$('g3-canvas');
    if (!G) {
      // Thư viện xoá sạch nội dung phần tử nó gắn vào, nên gắn vào g3-stage riêng; thẻ thông tin và màn chờ nằm cạnh.
      G = window.ForceGraph3D()($$('g3-stage'))
        .width(canvas.clientWidth).height(canvas.clientHeight)
        .nodeId('id')
        .nodeVal((n) => (n.center ? 12 : 1.5 + Math.log2(1 + (n.citations || 0)) * 1.4))
        .nodeLabel(() => '') // thẻ thông tin tự vẽ (g3-hover), tooltip của thư viện hay bị mất khi đổi màu nút
        .nodeOpacity(0.95)
        .showNavInfo(false) // dòng hướng dẫn tiếng Việt nằm ở chân màn hình
        .cooldownTicks(160)
        .linkDirectionalArrowLength((l) => (l.kind === 'inner' ? 4 : 3.5)) // mũi tên nằm sát nút đích: A → B nghĩa là A được B dẫn
        .linkDirectionalArrowRelPos(1)
        .linkDirectionalParticleWidth(2.2)
        .linkDirectionalParticleSpeed(0.007)
        .onNodeClick((n) => { selected = n; side(n); focus(n); refresh(); refreshList(); })
        .onNodeHover((n) => {
          setHover(n);
          canvas.style.cursor = n ? 'pointer' : '';
          const card = $$('g3-hover');
          if (n) { card.innerHTML = hoverCard(n); card.hidden = false; placeCard(); } else card.hidden = true;
          refresh();
        })
        .onBackgroundClick(() => { selected = null; side(null); refresh(); refreshList(); });
      canvas.addEventListener('mousemove', (e) => { const r = canvas.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; placeCard(); });
      canvas.addEventListener('mouseleave', () => { $$('g3-hover').hidden = true; });
      G.d3Force('charge').strength(-140); // đẩy các nút ra xa nhau hơn mặc định để thấy rõ cạnh
      G.d3Force('link').distance((l) => (l.kind === 'inner' ? 45 : 70));
    }
    // (danh sách bên trái vẽ lại theo dữ liệu mới, xem cuối hàm)
    G.backgroundColor(pal.bg)
      .nodeColor(colorOf)
      .linkColor((l) => {
        const s = l.source.id ?? l.source;
        const t = l.target.id ?? l.target;
        if (hover) {
          if (s === hover.id) return pal.out; // mũi tên ra: bài đang rê chuột được bài kia dẫn
          if (t === hover.id) return pal.in; // mũi tên vào: bài đang rê chuột dẫn bài kia
          return pal.faint;
        }
        return l.kind === 'inner' ? pal.inner : pal.link;
      })
      .linkWidth((l) => { const on = hover && ((l.source.id ?? l.source) === hover.id || (l.target.id ?? l.target) === hover.id); return on ? 1.6 : (l.kind === 'inner' ? 0.6 : 0); })
      .linkDirectionalParticles((l) => (hover && ((l.source.id ?? l.source) === hover.id || (l.target.id ?? l.target) === hover.id) ? 3 : 0))
      .graphData(data);
    // Khung nhìn ban đầu gần hơn mặc định của thư viện (mặc định đặt camera rất xa nên đồ thị trông bé).
    if (!keepCamera) G.cameraPosition({ x: 0, y: 0, z: Math.max(260, Math.cbrt(data.nodes.length) * 85) });
    refreshList();
  }

  const reloadGraph = () => { selected = null; side(null); G?.graphData({ nodes: [], links: [] }); load(); };
  ['g3-hop2', 'g3-min'].forEach((id) => $$(id).addEventListener('change', () => {
    $$('g3-min-wrap').classList.toggle('g3-off', !$$('g3-hop2').checked);
    reloadGraph();
  }));
  // "Tự nhập…": hiện ô số, chỉ tải lại khi bấm Áp dụng hoặc Enter (gõ dở không tải liên tục).
  $$('g3-cits-n').addEventListener('change', () => {
    const custom = $$('g3-cits-n').value === 'custom';
    $$('g3-cits-custom').hidden = !custom;
    if (custom) { $$('g3-cits-v').focus(); $$('g3-cits-v').select(); } else reloadGraph();
  });
  const applyCustom = () => { $$('g3-cits-v').value = String(citsLimit()); reloadGraph(); };
  $$('g3-cits-go').addEventListener('click', applyCustom);
  $$('g3-cits-v').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCustom(); } });
  $$('g3-min-wrap').classList.add('g3-off');
  ['g3-refs', 'g3-cits', 'g3-hop2show', 'g3-inner'].forEach((id) => $$(id).addEventListener('change', () => { selected = null; side(null); draw(); }));
  $$('g3-color').addEventListener('change', () => {
    // Ô từ khoá luôn giữ chỗ (chỉ làm mờ khi không dùng) để các ô khác trên thanh công cụ không nhảy vị trí.
    const on = $$('g3-color').value === 'topic';
    $$('g3-kw').disabled = !on;
    $$('g3-kw').classList.toggle('g3-kw-off', !on);
    matches = new Set(); legend(); refresh(); refreshList();
  });
  let kwTimer = 0;
  $$('g3-kw').addEventListener('input', () => { clearTimeout(kwTimer); kwTimer = setTimeout(() => { matches = new Set(); legend(); fillFilterOptions(); refresh(); refreshList(); }, 350); });
  // Bấm một chủ đề trong chú thích: làm nổi các bài thuộc chủ đề đó, bấm lại để bỏ.
  let activeTopic = null;
  $$('g3-legend').addEventListener('click', (e) => {
    const b = e.target.closest('[data-topic]');
    if (!b) return;
    const i = Number(b.dataset.topic);
    activeTopic = activeTopic === i ? null : i;
    const { of } = topicsNow();
    matches = activeTopic == null ? new Set() : new Set(G.graphData().nodes.filter((n) => !n.center && (activeTopic === -1 ? !of.has(n.id) : of.get(n.id) === activeTopic)).map((n) => n.id));
    $$('g3-legend').querySelectorAll('[data-topic]').forEach((x) => x.classList.toggle('active', Number(x.dataset.topic) === activeTopic));
    refresh();
    refreshList();
  });
  $$('g3-fit').addEventListener('click', () => G?.zoomToFit(700, 40));
  $$('g3-refresh').addEventListener('click', () => { G?.graphData({ nodes: [], links: [] }); load(true); });
  let qTimer = 0;
  $$('g3-q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      const q = e.target.value.trim().toLowerCase();
      matches = new Set(q.length < 2 ? [] : G.graphData().nodes.filter((n) => plainTitle(n.title).toLowerCase().includes(q)).map((n) => n.id));
      refresh();
      refreshList();
      const first = q.length >= 2 && G.graphData().nodes.find((n) => matches.has(n.id));
      if (first) { selected = first; side(first); focus(first); }
    }, 250);
  });
  // Sự kiện của danh sách
  $$('g3-list-sort').addEventListener('change', refreshList);
  // Mọi bộ lọc áp lên đồ thị; danh sách vẽ lại theo đồ thị nên hai bên luôn khớp. Giữ góc nhìn khi lọc.
  const applyFilters = () => { if ($$('gf-link').checked) { selected = null; side(null); draw({ keepCamera: true }); } else refreshList(); };
  let typeTimer = 0;
  ['gf-name', 'gf-kw'].forEach((id) => $$(id).addEventListener('input', () => { clearTimeout(typeTimer); typeTimer = setTimeout(applyFilters, 350); }));
  ['gf-y0', 'gf-y1', 'gf-topic', 'gf-cites'].forEach((id) => $$(id).addEventListener('change', applyFilters));
  $$('gf-link').addEventListener('change', () => { selected = null; side(null); draw({ keepCamera: true }); });
  $$('gf-clear').addEventListener('click', () => {
    ['gf-y0', 'gf-y1', 'gf-topic', 'gf-name', 'gf-kw'].forEach((id) => { $$(id).value = ''; });
    $$('gf-cites').value = '0';
    matches = new Set();
    applyFilters();
  });
  const items = $$('g3-list-items');
  const nodeOf = (el) => el && G?.graphData().nodes.find((n) => n.id === el.dataset.id);
  items.addEventListener('click', (e) => { const n = nodeOf(e.target.closest('.g3-li')); if (!n) return; selected = n; side(n); focus(n); refresh(); refreshList(); });
  items.addEventListener('mouseover', (e) => { const n = nodeOf(e.target.closest('.g3-li')); if (n && n !== hover) { setHover(n); refresh(); } });
  items.addEventListener('mouseleave', () => { setHover(null); refresh(); });
  const toggleList = (show) => {
    $$('g3-list').hidden = !show;
    $$('g3-list-show').hidden = show;
    try { localStorage.setItem('pv.g3list', show ? '1' : '0'); } catch (_) { /* bỏ qua */ }
    requestAnimationFrame(onResize);
  };
  $$('g3-list-hide').addEventListener('click', () => toggleList(false));
  $$('g3-list-show').addEventListener('click', () => toggleList(true));
  try { if (localStorage.getItem('pv.g3list') === '0') { $$('g3-list').hidden = true; $$('g3-list-show').hidden = false; } } catch (_) { /* bỏ qua */ }
  load();
}
