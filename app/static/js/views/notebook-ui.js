// Hộp thoại của Sổ tay: chọn mẫu khi tạo trang, trình dựng bảng paper, hướng dẫn cú pháp và phím tắt.
import { store, topicOf, tagIndex } from '../store.js';
import { dialog, toast } from '../ui.js';
import { escapeHtml, STATUS_LABEL, STATUS_ORDER, copyText } from '../util.js';
import { plainTitle, renderMath, mathMacros } from '../richtext.js';
import { CODE_LANGS, langKey, codeBlockHtml } from '../highlight.js';
import { loadMathLib, mathLib, saveMathLib, parseLatexDefs, ML_PRESET, macroSignature } from '../mathlib.js';
import {
  TEMPLATES, QUERY_COLS, QUERY_SORTS, parsePaperQuery, paperQuerySrc, runPaperQuery, paperQueryHtml,
  allPages, pageLabel, pageByTitle, renderNote, isInside, pageById,
} from '../notebook.js';

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '', 'vi');

/** Danh sách <option> chọn trang cha (loại trang trong exclude và các trang con của chúng). */
export function parentOptions(selectedId = null, exclude = []) {
  const ex = exclude.map(pageById).filter(Boolean);
  const out = ['<option value="">— Ngoài cùng (không có trang cha) —</option>'];
  const walk = (parentId, depth) => {
    for (const p of allPages().filter((x) => (x.parentId || null) === parentId).sort(byTitle)) {
      if (ex.some((e) => isInside(p, e))) continue;
      out.push(`<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${'   '.repeat(depth)}${escapeHtml(pageLabel(p))}</option>`);
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out.join('');
}

/* ---------------- 1. Tạo trang theo mẫu ---------------- */

/**
 * Chọn mẫu → điền tuỳ chọn (tên, trang cha, paper) → bấm Tạo trang. Bấm đúp một mẫu để tạo ngay với mặc định.
 * Trả về { tpl, title, parentId, paper } hoặc null.
 */
export async function pickTemplate({ parentId = null, title = '', tplId = 'blank', paperId = '' } = {}) {
  const papers = store.papers.filter((p) => !p.deleted).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const st = { tpl: TEMPLATES.find((x) => x.id === tplId) || TEMPLATES[0], paper: papers.find((p) => p.id === paperId) || null, title, titleTouched: !!title, parentId };
  return dialog({
    title: 'Tạo trang mới', width: 820,
    body: `<div class="nbt">
        <div class="nbt-list" role="radiogroup" aria-label="Mẫu trang">${TEMPLATES.map((x) => `<button type="button" class="nbt-card" role="radio" data-tpl="${x.id}"><span class="nbt-i">${x.icon}</span><span><b>${escapeHtml(x.label)}</b><span class="hint">${escapeHtml(x.desc || '')}</span></span></button>`).join('')}</div>
        <div class="nbt-opt" id="nbt-opt"></div></div>`,
    buttons: [
      { label: 'Huỷ', value: null },
      { label: 'Tạo trang', primary: true, onClick: (body, close) => { close(result(body)); return false; } },
    ],
    onOpen: (body, close) => {
      const draw = () => {
        body.querySelectorAll('.nbt-card').forEach((c) => { const on = c.dataset.tpl === st.tpl.id; c.classList.toggle('on', on); c.setAttribute('aria-checked', on ? 'true' : 'false'); });
        const made = st.tpl.make(st.paper);
        if (!st.titleTouched) st.title = made.title || '';
        const daily = st.tpl.id === 'daily' && pageByTitle(made.title);
        body.querySelector('#nbt-opt').innerHTML = `
          <div class="nbt-h">${st.tpl.icon} ${escapeHtml(st.tpl.label)}</div>
          ${daily ? '<div class="dup-warn">Đã có trang nhật ký hôm nay. Bấm <b>Tạo trang</b> sẽ mở trang đó.</div>' : ''}
          ${st.tpl.paper ? `<div class="field"><span class="label-text">Paper <span class="hint">(tuỳ chọn, ${papers.length} bài trong thư viện)</span></span>
              <input type="search" id="nbt-pq" placeholder="Tìm theo tên, tác giả, năm…">
              <div class="nbt-papers" id="nbt-papers"></div>
              <div class="hint" id="nbt-psel">${st.paper ? `Đã chọn: <b>${escapeHtml(plainTitle(st.paper.title))}</b>` : 'Chưa chọn paper: trang tạo ra không có thẻ paper.'}</div></div>` : ''}
          ${daily ? '' : `<label class="field"><span class="label-text">Tên trang</span><input id="nbt-title" value="${escapeHtml(st.title)}" placeholder="Không tên"></label>
          <label class="field"><span class="label-text">Đặt trong trang</span><select id="nbt-parent">${parentOptions(st.parentId)}</select></label>`}
          <details class="nbt-prev"><summary>Xem nội dung mẫu</summary><div class="nb-prev md">${renderNote(made.content) || '<p class="hint">Trang trống.</p>'}</div></details>`;
        const pq = body.querySelector('#nbt-pq');
        if (pq) {
          const list = () => {
            const q = fold(pq.value);
            const hits = papers.filter((p) => !q || fold(`${p.title} ${(p.extraction?.authors || []).join(' ')} ${p.extraction?.year || ''}`).includes(q)).slice(0, 60);
            body.querySelector('#nbt-papers').innerHTML = hits.map((p) => `<label class="nbt-paper ${st.paper?.id === p.id ? 'on' : ''}"><input type="radio" name="nbt-p" value="${p.id}" ${st.paper?.id === p.id ? 'checked' : ''}><span><b>${escapeHtml(plainTitle(p.title))}</b><span class="hint">${escapeHtml((p.extraction?.authors || []).slice(0, 2).join(', '))}${p.extraction?.year ? ` · ${escapeHtml(p.extraction.year)}` : ''}${topicOf(p) ? ` · ${escapeHtml(topicOf(p).name)}` : ''}</span></span></label>`).join('') || '<div class="hint" style="padding:8px">Không có paper nào khớp.</div>';
          };
          pq.addEventListener('input', list);
          body.querySelector('#nbt-papers').addEventListener('change', (e) => {
            st.paper = papers.find((p) => p.id === e.target.value) || null;
            const keep = pq.value;
            draw();
            const pq2 = body.querySelector('#nbt-pq');
            if (pq2) { pq2.value = keep; pq2.dispatchEvent(new Event('input')); }
          });
          list();
        }
        const ti = body.querySelector('#nbt-title');
        ti?.addEventListener('input', () => { st.title = ti.value; st.titleTouched = true; });
        ti?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(result(body)); } });
        body.querySelector('#nbt-parent')?.addEventListener('change', (e) => { st.parentId = e.target.value || null; });
      };
      body.querySelector('.nbt-list').addEventListener('click', (e) => {
        const c = e.target.closest('[data-tpl]');
        if (!c || c.dataset.tpl === st.tpl.id) return;
        st.tpl = TEMPLATES.find((x) => x.id === c.dataset.tpl);
        draw();
      });
      body.querySelector('.nbt-list').addEventListener('dblclick', (e) => { if (e.target.closest('[data-tpl]')) close(result(body)); });
      draw();
    },
  });
  function result(body) {
    return { tpl: st.tpl, title: (body.querySelector('#nbt-title')?.value ?? st.title).trim(), parentId: body.querySelector('#nbt-parent') ? (body.querySelector('#nbt-parent').value || null) : st.parentId, paper: st.paper };
  }
}

/* ---------------- 2. Trình dựng bảng paper ---------------- */

/** Mở trình dựng bảng với mã khối hiện có (src); trả về mã khối mới hoặc null nếu huỷ. */
export async function paperQueryBuilder(src = '') {
  const q = parsePaperQuery(src);
  const tags = [...tagIndex()].map(([t, ids]) => [t, ids.length]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const selTags = new Set(String(q.tag || '').split(',').map((x) => x.trim().replace(/^#/, '').toLowerCase()).filter(Boolean));
  const selStatus = new Set(String(q.status || '').split(',').map((x) => x.trim()).filter(Boolean));
  const selCols = (q.cols || 'title, year, venue, status').split(',').map((x) => x.trim()).filter(Boolean);
  const [y0, y1] = String(q.year || '').split('-').map((x) => x.trim());
  const editing = !!src.trim();
  return dialog({
    title: editing ? 'Chỉnh bảng paper' : 'Chèn bảng paper từ thư viện', width: 860,
    body: `<p class="hint" style="margin-top:0">Bảng lấy trực tiếp từ thư viện và tự cập nhật khi thư viện thay đổi. Chọn bộ lọc ở tab 1, cột và cách sắp xếp ở tab 2, xem kết quả ở tab 3.</p>
      <div class="seg nbq-tabs" id="nbq-tabs"><button data-t="filter" class="active">1. Lọc paper</button><button data-t="cols">2. Cột &amp; sắp xếp</button><button data-t="prev">3. Xem trước</button><button data-t="code">Mã khối</button></div>
      <div class="nbq-count" id="nbq-count"></div>
      <div class="nbq-pane" data-p="filter">
        <div class="field"><span class="label-text">Tag <span class="hint">(bài có ít nhất một tag được chọn; bỏ trống = mọi tag)</span></span>
          <input type="search" id="nbq-tagq" placeholder="Tìm tag…">
          <div class="nbq-chips" id="nbq-tags"></div></div>
        <div class="nbq-grid">
          <label class="field"><span class="label-text">Chủ đề</span><select id="nbq-topic"><option value="">Mọi chủ đề</option>${store.topics.map((t) => `<option value="${escapeHtml(t.name)}" ${q.topic === t.name ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}</select></label>
          <div class="field"><span class="label-text">Trạng thái đọc</span><div class="nbq-checks">${STATUS_ORDER.map((s) => `<label><input type="checkbox" data-st="${s}" ${selStatus.has(s) ? 'checked' : ''}> ${escapeHtml(STATUS_LABEL[s])}</label>`).join('')}</div></div>
          <div class="field"><span class="label-text">Năm đăng</span><div class="nbq-row"><input type="number" id="nbq-y0" placeholder="từ" value="${escapeHtml(y0 || '')}" min="1900" max="2100"><span>–</span><input type="number" id="nbq-y1" placeholder="đến" value="${escapeHtml(y1 || '')}" min="1900" max="2100"></div></div>
          <label class="field"><span class="label-text">Từ khoá <span class="hint">(trong tên, ý chính, tag)</span></span><input id="nbq-q" value="${escapeHtml(q.q || '')}" placeholder="ví dụ: retrieval"></label>
        </div>
      </div>
      <div class="nbq-pane" data-p="cols" hidden>
        <div class="nbq-grid">
          <div class="field"><span class="label-text">Cột hiển thị <span class="hint">(theo thứ tự đánh dấu)</span></span><div class="nbq-checks nbq-cols" id="nbq-cols">${QUERY_COLS.map(([k, label]) => `<label><input type="checkbox" data-col="${k}" ${selCols.includes(k) ? 'checked' : ''}> ${escapeHtml(label)} <code>${k}</code></label>`).join('')}</div></div>
          <div class="field"><span class="label-text">Sắp xếp</span><div class="nbq-checks">${QUERY_SORTS.map(([k, label]) => `<label><input type="radio" name="nbq-sort" value="${k}" ${(q.sort || 'added') === k ? 'checked' : ''}> ${escapeHtml(label)} <code>${k}</code></label>`).join('')}</div>
            <label class="field" style="margin-top:10px"><span class="label-text">Số dòng tối đa</span><input type="number" id="nbq-limit" min="1" max="500" value="${escapeHtml(q.limit || '50')}"></label></div>
        </div>
      </div>
      <div class="nbq-pane" data-p="prev" hidden>
        <div class="nbq-leave" id="nbq-leave" hidden></div>
        <div id="nbq-prev" class="nb-prev md"></div></div>
      <div class="nbq-pane" data-p="code" hidden>
        <p class="hint">Đây là mã của khối trong trang. Có thể gõ tay theo cùng cú pháp, mỗi dòng một tuỳ chọn <code>tên: giá trị</code>:</p>
        <pre class="code" id="nbq-src"></pre>
        <table class="data nbq-help"><tbody>
          <tr><td><code>tag</code></td><td>Một hoặc nhiều tag, cách nhau bởi dấu phẩy.</td></tr>
          <tr><td><code>topic</code></td><td>Tên chủ đề (khớp một phần tên).</td></tr>
          <tr><td><code>status</code></td><td>${STATUS_ORDER.map((s) => `<code>${s}</code> (${escapeHtml(STATUS_LABEL[s])})`).join(', ')}.</td></tr>
          <tr><td><code>year</code></td><td><code>2020-2024</code> hoặc một năm <code>2023</code>.</td></tr>
          <tr><td><code>q</code></td><td>Từ khoá tìm trong tên, ý chính và tag.</td></tr>
          <tr><td><code>sort</code></td><td>${QUERY_SORTS.map(([k, l]) => `<code>${k}</code> (${escapeHtml(l)})`).join(', ')}.</td></tr>
          <tr><td><code>cols</code></td><td>${QUERY_COLS.map(([k, l]) => `<code>${k}</code> (${escapeHtml(l)})`).join(', ')}.</td></tr>
          <tr><td><code>limit</code></td><td>Số dòng tối đa, mặc định 50.</td></tr>
        </tbody></table>
      </div>`,
    buttons: [
      { label: 'Huỷ', value: null },
      { label: editing ? 'Cập nhật bảng' : 'Chèn bảng', primary: true, onClick: (body, close) => { close(paperQuerySrc(read(body))); return false; } },
    ],
    onOpen: (body, close) => {
      const drawTags = () => {
        const f = fold(body.querySelector('#nbq-tagq').value);
        body.querySelector('#nbq-tags').innerHTML = tags.filter(([t]) => !f || fold(t).includes(f)).slice(0, 80).map(([t, n]) => `<button type="button" class="nbq-chip ${selTags.has(t.toLowerCase()) ? 'on' : ''}" data-tag="${escapeHtml(t)}">#${escapeHtml(t)} <span class="hint">${n}</span></button>`).join('') || '<span class="hint">Thư viện chưa có tag nào.</span>';
      };
      const update = () => {
        const qq = read(body);
        const { total, list } = runPaperQuery(qq);
        body.querySelector('#nbq-count').innerHTML = `Khớp <b>${total}</b> paper${total > list.length ? ` · bảng hiện ${list.length} dòng đầu` : ''}`;
        body.querySelector('#nbq-src').textContent = `\`\`\`papers\n${paperQuerySrc(qq)}\n\`\`\``;
        if (!body.querySelector('[data-p="prev"]').hidden) body.querySelector('#nbq-prev').innerHTML = paperQueryHtml(qq);
      };
      body.querySelector('#nbq-tabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-t]');
        if (!b) return;
        body.querySelectorAll('#nbq-tabs button').forEach((x) => x.classList.toggle('active', x === b));
        body.querySelectorAll('.nbq-pane').forEach((p) => { p.hidden = p.dataset.p !== b.dataset.t; });
        update();
      });
      body.querySelector('#nbq-tagq').addEventListener('input', drawTags);
      // Bấm một paper ở phần xem trước: hỏi trước thay vì chuyển trang ngay (hộp thoại sẽ treo lại phía trên trang mới).
      // Đồng ý thì đóng hộp thoại rồi mới mở paper.
      body.querySelector('#nbq-prev').addEventListener('click', (e) => {
        const a = e.target.closest('a[href^="#/"]');
        if (!a) return;
        e.preventDefault();
        const bar = body.querySelector('#nbq-leave');
        bar.hidden = false;
        bar.innerHTML = `<span>Mở <b>${escapeHtml(a.textContent.trim().slice(0, 90))}</b>? Hộp thoại này sẽ đóng${src.trim() ? ', thay đổi bảng chưa cập nhật sẽ bị bỏ' : ', bảng chưa được chèn'}.</span><span class="spacer"></span><button type="button" class="sm primary" data-leave-go>Mở paper</button><button type="button" class="sm" data-leave-stay>Ở lại</button>`;
        bar.querySelector('[data-leave-go]').onclick = () => { close(null); location.hash = a.getAttribute('href'); };
        bar.querySelector('[data-leave-stay]').onclick = () => { bar.hidden = true; };
        bar.querySelector('[data-leave-go]').focus();
      });
      body.querySelector('#nbq-tags').addEventListener('click', (e) => {
        const c = e.target.closest('[data-tag]');
        if (!c) return;
        const k = c.dataset.tag.toLowerCase();
        if (selTags.has(k)) selTags.delete(k); else selTags.add(k);
        c.classList.toggle('on', selTags.has(k));
        update();
      });
      body.addEventListener('input', update);
      body.addEventListener('change', update);
      drawTags();
      update();
    },
  });
  function read(body) {
    const cols = [...body.querySelectorAll('[data-col]:checked')].map((x) => x.dataset.col);
    // giữ thứ tự cột như mã cũ, cột mới thêm nối vào cuối
    const ordered = [...selCols.filter((c) => cols.includes(c)), ...cols.filter((c) => !selCols.includes(c))];
    const a = body.querySelector('#nbq-y0').value.trim();
    const b = body.querySelector('#nbq-y1').value.trim();
    return {
      tag: [...selTags].join(', '),
      topic: body.querySelector('#nbq-topic').value,
      status: [...body.querySelectorAll('[data-st]:checked')].map((x) => x.dataset.st).join(', '),
      year: a || b ? (a && b ? `${a}-${b}` : (a ? `${a}-` : `-${b}`)) : '',
      q: body.querySelector('#nbq-q').value.trim(),
      sort: body.querySelector('input[name="nbq-sort"]:checked')?.value || '',
      cols: ordered.join(', '),
      limit: body.querySelector('#nbq-limit').value.trim() && body.querySelector('#nbq-limit').value.trim() !== '50' ? body.querySelector('#nbq-limit').value.trim() : '',
    };
  }
}

/* ---------------- 3. Hướng dẫn cú pháp và phím tắt ---------------- */

const EX = {
  md: [
    ['Tiêu đề', '# Tiêu đề lớn\n## Tiêu đề mục\n### Tiêu đề nhỏ'],
    ['Chữ', '**đậm**, *nghiêng*, `code ngắn`, [liên kết web](https://arxiv.org)'],
    ['Danh sách', '- ý thứ nhất\n- ý thứ hai\n  - ý con (thụt 2 dấu cách hoặc Tab)\n\n1. bước một\n2. bước hai'],
    ['Trích dẫn', '> Một câu trích từ paper.'],
    ['Khối code', '```python\nloss = criterion(logits, labels)  # tính loss\nloss.backward()\n```', 'Gõ / → Khối code để chọn ngôn ngữ và xem trước. Hỗ trợ python, cpp, c, csharp, java, javascript, typescript, rust, go, sql, bash, json, yaml, latex, r, matlab, html.'],
    ['Khối code C++', '```cpp\n#include <vector>\nint main() {\n  std::vector<int> v{1, 2, 3};\n  return v.size();\n}\n```'],
    ['Bảng', '| Dataset | Accuracy |\n| --- | --- |\n| VQAv2 | 78.2 |\n| OK-VQA | 55.1 |'],
    ['Công thức LaTeX', 'Cùng dòng: $\\mathcal{L} = -\\sum_i \\log p(y_i)$\n\n$$\nP(Q, A \\mid I) = \\prod_{t} P(w_t \\mid w_{<t}, I)\n$$', 'Gõ / → Công thức LaTeX để có bảng ký hiệu và xem trước. Macro tự định nghĩa (\\R, \\norm…) đặt ở 📐 Thư viện LaTeX, dùng được trong mọi công thức.'],
    ['Công thức nhiều dòng', '```math\n\\begin{aligned}\n\\theta^* &= \\arg\\min_\\theta \\mathcal{L}(\\theta) \\\\\n&= \\arg\\min_\\theta \\sum_i \\ell(f_\\theta(x_i), y_i)\n\\end{aligned}\n```', 'Khối ```math cũng là công thức đứng riêng, tiện cho công thức dài nhiều dòng.'],
    ['Đường kẻ', '---'],
  ],
  link: [
    ['Liên kết trang', 'Xem thêm [[Phương pháp đánh giá]].\nĐổi chữ hiện: [[Phương pháp đánh giá|cách đánh giá]].', 'Gõ [[ rồi chọn trong danh sách. Trang chưa có thì hiện chữ mờ, bấm vào để tạo.'],
    ['Nhắc tới paper', 'Bài gốc: [[@', 'Gõ [[@ rồi gõ vài chữ của tên paper, chọn trong danh sách. App chèn [[@mã-paper|tên ngắn]]. Trang paper (tab Ghi chú) sẽ hiện các trang nhắc tới nó.'],
    ['Nhúng thẻ paper', '![[@', 'Gõ ![[@ rồi chọn paper. Dòng này hiện thành thẻ: tên, tác giả, năm, venue, ý chính, trạng thái đọc, tag.'],
    ['Nhúng một trang khác', '![[Phương pháp đánh giá]]', 'Hiện nguyên nội dung của trang kia ngay tại đây (một cấp, không lồng nhau).'],
    ['Tag', 'Bài này thuộc #vqa và #self-training', 'Bấm một tag để lọc mọi trang có tag đó. Tag phải bắt đầu bằng chữ cái.'],
  ],
  block: [
    ['Việc cần làm', '- [ ] Chạy lại baseline\n- [x] Đọc phần 3\n  - [ ] việc con', 'Bấm ô vuông ở phần xem để đánh dấu xong.'],
    ['Callout', '> [!idea] Ý tưởng\n> Dùng teacher sinh cả câu hỏi lẫn câu trả lời.', 'Loại: note, info, tip, idea, important, warning, danger, question, quote, todo, success.'],
    ['Callout cảnh báo', '> [!warning] Rủi ro\n> Pseudo-label có thể nhiễu.'],
    ['Callout câu hỏi', '> [!question] Còn chưa rõ\n> Vì sao top-p = 0.92?'],
  ],
};
const KEYS = [
  ['Ctrl + K', 'Mở nhanh một trang (gõ tên chưa có rồi Enter để tạo)'],
  ['Ctrl + S', 'Lưu ngay (bình thường tự lưu sau khi ngừng gõ)'],
  ['Ctrl + B / Ctrl + I', 'In đậm / in nghiêng chữ đang chọn'],
  ['Ctrl + /', 'Mở hướng dẫn này'],
  ['/', 'Danh sách khối để chèn (tiêu đề, việc cần làm, callout, bảng, code, công thức, paper…)'],
  ['[[  ·  [[@  ·  ![[@', 'Liên kết trang · nhắc tới paper · nhúng thẻ paper'],
  ['↑ ↓ · Enter / Tab · Esc', 'Chọn trong danh sách gợi ý · chèn · đóng danh sách'],
  ['Enter (trong danh sách)', 'Tự thêm dòng mới cùng kiểu (-, 1., - [ ], >). Enter ở dòng trống thì thoát danh sách'],
  ['Tab / Shift + Tab', 'Thụt vào / lùi ra một cấp danh sách'],
  ['Bấm đúp (chế độ Chia đôi)', 'Bấm đúp một chữ ở phần xem để nhảy tới đúng chữ đó ở phần viết'],
  ['G rồi B', 'Mở Sổ tay từ bất kỳ trang nào của app'],
  ['Esc · Shift + Esc (Đồ thị)', 'Bỏ chọn · đóng đồ thị'],
];

/** Hướng dẫn có các tab: Markdown, Liên kết & paper, Khối đặc biệt, Bảng paper, Phím tắt. insert(text) nếu có thì hiện nút "Chèn vào trang". */
export function openGuide(tab = 'md', { insert = null } = {}) {
  const exRows = (list) => `<table class="data nbg-ex"><thead><tr><th style="width:30%">Bạn gõ</th><th>Hiện ra</th></tr></thead><tbody>${list.map(([label, code, note], i) => `<tr>
      <td><div class="nbg-label">${escapeHtml(label)}</div><pre class="code">${escapeHtml(code)}</pre><div class="nbg-acts"><button type="button" class="sm ghost" data-copy="${escapeHtml(code)}">Copy</button>${insert ? `<button type="button" class="sm ghost" data-ins="${escapeHtml(code)}">Chèn vào trang</button>` : ''}</div></td>
      <td><div class="nb-prev md nbg-out">${renderNote(code, { qc: false })}</div>${note ? `<div class="hint">${escapeHtml(note)}</div>` : ''}</td></tr>`).join('')}</tbody></table>`;
  const tags = [...tagIndex()].sort((a, b) => b[1].length - a[1].length).slice(0, 24).map(([t]) => t);
  const queryEx = `\`\`\`papers\ntag: ${tags[0] || 'vqa'}\nstatus: reading, done\nsort: year\ncols: title, year, venue, status\nlimit: 10\n\`\`\``;
  const panes = {
    md: `<p class="hint">Sổ tay dùng Markdown: gõ ký hiệu, phần xem bên phải hiện định dạng. Các ví dụ dưới đây được dựng trực tiếp bằng bộ hiển thị của sổ tay.</p>${exRows(EX.md)}`,
    link: `<p class="hint">Liên kết hai chiều kiểu Obsidian: trang được liên kết tới sẽ thấy trang kia trong mục <b>Liên kết tới trang này</b>. Đổi tên trang thì liên kết ở mọi trang khác tự đổi theo.</p>${exRows(EX.link)}`,
    block: `<p class="hint">Các khối riêng của sổ tay, ngoài Markdown thường.</p>${exRows(EX.block)}`,
    query: `<p>Khối <code>\`\`\`papers</code> dựng một bảng paper lấy trực tiếp từ thư viện, giống một database của Notion. Cách dễ nhất: gõ <code>/</code> → <b>Bảng paper từ thư viện</b> để mở trình dựng bảng có các tab chọn bộ lọc, cột và sắp xếp. Bảng đã có trong trang thì bấm <b>⚙ Chỉnh bảng</b> ở góc bảng.</p>
      <p class="hint">Hoặc gõ tay, mỗi dòng một tuỳ chọn <code>tên: giá trị</code>:</p>
      ${exRows([['Ví dụ', queryEx, 'Bảng tự cập nhật khi thư viện thay đổi (thêm paper, đổi trạng thái…).']])}
      <table class="data nbq-help"><thead><tr><th>Tuỳ chọn</th><th>Giá trị có thể dùng</th></tr></thead><tbody>
        <tr><td><code>tag</code></td><td>Tag trong thư viện, cách nhau bởi dấu phẩy. Tag đang có: ${tags.map((t) => `<code>${escapeHtml(t)}</code>`).join(' ') || '<span class="hint">chưa có</span>'}</td></tr>
        <tr><td><code>topic</code></td><td>Tên chủ đề: ${store.topics.map((t) => `<code>${escapeHtml(t.name)}</code>`).join(' ')}</td></tr>
        <tr><td><code>status</code></td><td>${STATUS_ORDER.map((s) => `<code>${s}</code> (${escapeHtml(STATUS_LABEL[s])})`).join(', ')}</td></tr>
        <tr><td><code>year</code></td><td><code>2020-2024</code>, <code>2023</code>, <code>2022-</code> (từ 2022)</td></tr>
        <tr><td><code>q</code></td><td>Từ khoá tìm trong tên, ý chính, tag</td></tr>
        <tr><td><code>sort</code></td><td>${QUERY_SORTS.map(([k, l]) => `<code>${k}</code> (${escapeHtml(l)})`).join(', ')}</td></tr>
        <tr><td><code>cols</code></td><td>${QUERY_COLS.map(([k, l]) => `<code>${k}</code> (${escapeHtml(l)})`).join(', ')}</td></tr>
        <tr><td><code>limit</code></td><td>Số dòng tối đa (1–500, mặc định 50)</td></tr>
      </tbody></table>`,
    keys: `<table class="data"><thead><tr><th style="width:34%">Phím</th><th>Tác dụng</th></tr></thead><tbody>${KEYS.map(([k, d]) => `<tr><td>${k.split(/(\s·\s|\s\/\s|\s\+\s)/).map((x) => (/^\s[·/+]\s$/.test(x) ? escapeHtml(x) : `<kbd>${escapeHtml(x)}</kbd>`)).join('')}</td><td>${escapeHtml(d)}</td></tr>`).join('')}</tbody></table>`,
  };
  const TABS = [['md', 'Markdown'], ['link', 'Liên kết & paper'], ['block', 'Khối đặc biệt'], ['query', 'Bảng paper'], ['keys', 'Phím tắt']];
  dialog({
    title: 'Hướng dẫn Sổ tay', width: 960,
    body: `<div class="seg nbg-tabs">${TABS.map(([k, l]) => `<button data-gt="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`).join('')}</div>
      ${TABS.map(([k]) => `<div class="nbg-pane" data-gp="${k}" ${k === tab ? '' : 'hidden'}>${panes[k]}</div>`).join('')}`,
    buttons: [{ label: 'Đóng', value: null }],
    onOpen: (body, close) => {
      body.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-gt]');
        if (t) { body.querySelectorAll('[data-gt]').forEach((x) => x.classList.toggle('active', x === t)); body.querySelectorAll('[data-gp]').forEach((p) => { p.hidden = p.dataset.gp !== t.dataset.gt; }); return; }
        const c = e.target.closest('[data-copy]');
        if (c) { await copyText(c.dataset.copy); toast('Đã copy.'); return; }
        const i = e.target.closest('[data-ins]');
        if (i && insert) { insert(i.dataset.ins); close(null); }
      });
    },
  });
}

/* ---------------- 4. Chèn khối code ---------------- */

const LAST_LANG = 'pv.nbCodeLang';
/** Chọn ngôn ngữ + dán code, xem trước có tô màu. Trả về khối Markdown ```lang … ``` hoặc null. */
export async function codeDialog({ code = '', lang = '' } = {}) {
  let cur = langKey(lang || (() => { try { return localStorage.getItem(LAST_LANG) || 'python'; } catch (_) { return 'python'; } })());
  return dialog({
    title: code ? 'Sửa khối code' : 'Chèn khối code', width: 820,
    body: `<div class="nbc-top"><label class="field"><span class="label-text">Ngôn ngữ</span><select id="nbc-lang">${CODE_LANGS.map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></label>
        <span class="hint">Mỗi ngôn ngữ tô màu riêng: từ khoá, chuỗi, số, chú thích, tên hàm. Tab trong ô code chèn 4 dấu cách.</span></div>
      <textarea id="nbc-code" class="nbc-code" spellcheck="false" placeholder="Dán hoặc gõ code ở đây…">${escapeHtml(code)}</textarea>
      <div class="hint" style="margin:8px 0 4px">Xem trước</div><div id="nbc-prev"></div>`,
    buttons: [{ label: 'Huỷ', value: null }, { label: code ? 'Cập nhật' : 'Chèn code', primary: true, onClick: (b, close) => {
      const c = b.querySelector('#nbc-code').value.replace(/\s+$/, '');
      try { localStorage.setItem(LAST_LANG, cur); } catch (_) { /* bỏ qua */ }
      close(`\`\`\`${cur === 'text' ? '' : cur}\n${c}\n\`\`\``);
      return false;
    } }],
    onOpen: (body) => {
      const ta = body.querySelector('#nbc-code');
      const draw = () => { body.querySelector('#nbc-prev').innerHTML = codeBlockHtml(ta.value || '// code', cur); };
      body.querySelector('#nbc-lang').addEventListener('change', (e) => { cur = e.target.value; draw(); });
      ta.addEventListener('input', draw);
      ta.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end'); draw(); } });
      draw();
      setTimeout(() => ta.focus(), 30);
    },
  });
}

/* ---------------- 5. Chèn công thức LaTeX ---------------- */

const PALETTE = [
  ['Cơ bản', [['\\frac{a}{b}', 'phân số'], ['x^{n}', 'mũ'], ['x_{i}', 'chỉ số dưới'], ['\\sqrt{x}', 'căn'], ['\\sum_{i=1}^{n}', 'tổng'], ['\\prod_{i=1}^{n}', 'tích'], ['\\int_{a}^{b}', 'tích phân'], ['\\lim_{n \\to \\infty}', 'giới hạn'], ['\\log', 'log'], ['\\exp', 'exp'], ['\\hat{y}', 'mũ ^'], ['\\bar{x}', 'gạch trên'], ['\\tilde{x}', 'ngã'], ['\\dot{x}', 'chấm']]],
  ['Hy Lạp', [['\\alpha'], ['\\beta'], ['\\gamma'], ['\\delta'], ['\\epsilon'], ['\\eta'], ['\\theta'], ['\\lambda'], ['\\mu'], ['\\pi'], ['\\sigma'], ['\\tau'], ['\\phi'], ['\\psi'], ['\\omega'], ['\\Gamma'], ['\\Delta'], ['\\Theta'], ['\\Sigma'], ['\\Phi'], ['\\Omega']]],
  ['Quan hệ & phép toán', [['\\leq'], ['\\geq'], ['\\neq'], ['\\approx'], ['\\sim'], ['\\propto'], ['\\times'], ['\\cdot'], ['\\pm'], ['\\in'], ['\\notin'], ['\\subset'], ['\\cup'], ['\\cap'], ['\\forall'], ['\\exists'], ['\\nabla'], ['\\partial'], ['\\infty'], ['\\to'], ['\\Rightarrow'], ['\\mid']]],
  ['Học máy', [['\\mathbb{E}_{x \\sim p}[\\cdot]', 'kỳ vọng'], ['\\mathcal{L}', 'loss'], ['\\arg\\max_{\\theta}', 'argmax'], ['\\operatorname{softmax}(z)', 'softmax'], ['\\lVert x \\rVert_2', 'chuẩn'], ['\\mathbf{W}', 'ma trận'], ['\\boldsymbol{\\theta}', 'tham số'], ['P(y \\mid x)', 'xác suất'], ['D_{\\mathrm{KL}}(p \\,\\|\\, q)', 'KL'], ['\\nabla_{\\theta} \\mathcal{L}', 'gradient']]],
  ['Cấu trúc', [['\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', 'ma trận'], ['f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{khác} \\end{cases}', 'cases'], ['\\begin{aligned} a &= b \\\\ &= c \\end{aligned}', 'nhiều dòng'], ['\\text{chữ}', 'chữ thường'], ['\\left( \\cdot \\right)', 'ngoặc co giãn']]],
];

/** Soạn công thức LaTeX có xem trước KaTeX. Trả về chuỗi $…$ hoặc $$…$$ (hoặc null). */
export async function formulaDialog({ tex = '', display = true, onLibrary = null } = {}) {
  await loadMathLib();
  let mode = display ? 'block' : 'inline';
  return dialog({
    title: 'Chèn công thức LaTeX', width: 900,
    body: `<div class="nbf-top"><div class="seg" id="nbf-mode"><button data-m="block">Đứng riêng $$…$$</button><button data-m="inline">Cùng dòng $…$</button></div><span class="spacer"></span>${onLibrary ? '<button type="button" class="sm ghost" id="nbf-lib">📐 Thư viện LaTeX</button>' : ''}</div>
      <textarea id="nbf-tex" class="nbc-code nbf-tex" spellcheck="false" placeholder="ví dụ: \\mathcal{L} = -\\sum_{i} \\log p_\\theta(y_i \\mid x_i)">${escapeHtml(tex)}</textarea>
      <div class="nbf-prev" id="nbf-prev"></div>
      <div class="nbf-save"><input id="nbf-name" placeholder="Tên gợi nhớ khi bấm “Lưu vào thư viện” (tuỳ chọn)"><span class="hint">Ctrl + Enter để chèn</span></div>
      <div class="seg nbf-tabs" id="nbf-tabs">${PALETTE.map(([g], i) => `<button data-g="${i}" class="${i ? '' : 'active'}">${escapeHtml(g)}</button>`).join('')}<button data-g="mine">Của tôi</button></div>
      <div class="nbf-pal" id="nbf-pal"></div>`,
    buttons: [
      { label: 'Huỷ', value: null },
      { label: 'Lưu vào thư viện', onClick: async (b) => {
        const t = b.querySelector('#nbf-tex').value.trim();
        if (!t) return false;
        const name = b.querySelector('#nbf-name').value.trim() || t.slice(0, 40);
        const l = mathLib();
        await saveMathLib({ ...l, snippets: [...l.snippets, { name, tex: t }] });
        b.querySelector('#nbf-name').value = '';
        toast(`Đã lưu “${name}” vào thư viện (tab Của tôi).`);
        return false;
      } },
      { label: 'Chèn công thức', primary: true, onClick: (b, close) => { const t = b.querySelector('#nbf-tex').value.trim(); if (!t) return false; close(mode === 'block' ? `$$\n${t}\n$$` : `$${t}$`); return false; } },
    ],
    onOpen: (body, close) => {
      const ta = body.querySelector('#nbf-tex');
      const prev = () => {
        const t = ta.value.trim();
        if (!t) { body.querySelector('#nbf-prev').innerHTML = '<span class="hint">Xem trước công thức ở đây.</span>'; return; }
        let err = '';
        try { window.katex?.renderToString(t, { throwOnError: true, displayMode: mode === 'block', macros: mathMacros() }); } catch (e) { err = e.message.replace(/^KaTeX parse error:\s*/, ''); }
        body.querySelector('#nbf-prev').innerHTML = `${renderMath(t, mode === 'block')}${err ? `<div class="status err">Lỗi LaTeX: ${escapeHtml(err)}</div>` : ''}`;
      };
      const pal = (g) => {
        const box = body.querySelector('#nbf-pal');
        if (g === 'mine') {
          const l = mathLib();
          const macros = Object.entries(l.macros);
          box.innerHTML = `${l.snippets.length ? l.snippets.map((s) => `<button type="button" class="nbf-sym nbf-snip" data-ins="${escapeHtml(s.tex)}" title="${escapeHtml(s.tex)}"><span>${renderMath(s.tex)}</span><span class="hint">${escapeHtml(s.name)}</span></button>`).join('') : '<span class="hint">Chưa lưu công thức nào. Viết một công thức rồi bấm “Lưu vào thư viện”.</span>'}
            ${macros.length ? `<div class="nbf-sub">Macro (${macros.length}):</div>${macros.map(([k, v]) => `<button type="button" class="nbf-sym" data-ins="${escapeHtml(macroSignature(k, v).replace(/\{x\d\}/g, '{}'))}" title="${escapeHtml(`${k} = ${v}`)}"><code>${escapeHtml(macroSignature(k, v))}</code></button>`).join('')}` : ''}`;
          return;
        }
        box.innerHTML = PALETTE[g][1].map(([s, label]) => `<button type="button" class="nbf-sym" data-ins="${escapeHtml(s)}" title="${escapeHtml(s)}"><span>${renderMath(s)}</span>${label ? `<span class="hint">${escapeHtml(label)}</span>` : ''}</button>`).join('');
      };
      body.querySelector('#nbf-mode').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m; body.querySelectorAll('#nbf-mode button').forEach((x) => x.classList.toggle('active', x === b)); prev(); });
      body.querySelectorAll('#nbf-mode button').forEach((x) => x.classList.toggle('active', x.dataset.m === mode));
      body.querySelector('#nbf-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (!b) return; body.querySelectorAll('#nbf-tabs button').forEach((x) => x.classList.toggle('active', x === b)); pal(b.dataset.g); });
      body.querySelector('#nbf-pal').addEventListener('click', (e) => {
        const b = e.target.closest('[data-ins]');
        if (!b) return;
        ta.focus();
        ta.setRangeText(b.dataset.ins, ta.selectionStart, ta.selectionEnd, 'end');
        prev();
      });
      body.querySelector('#nbf-lib')?.addEventListener('click', async () => { await onLibrary(); pal('mine'); body.querySelectorAll('#nbf-tabs button').forEach((x) => x.classList.toggle('active', x.dataset.g === 'mine')); prev(); });
      ta.addEventListener('input', prev);
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); body.closest('.modal-box')?.querySelector('.modal-foot button.primary')?.click(); } });
      pal(0);
      prev();
      setTimeout(() => ta.focus(), 30);
    },
  });
}

/* ---------------- 6. Thư viện LaTeX (macro + công thức đã lưu, nhập từ file) ---------------- */

export async function mathLibraryDialog() {
  const l = await loadMathLib(true);
  const st = { macros: { ...l.macros }, snippets: [...l.snippets] };
  return dialog({
    title: '📐 Thư viện LaTeX', width: 900,
    body: `<p class="hint" style="margin-top:0">Macro định nghĩa ở đây dùng được trong mọi công thức của app (sổ tay, ghi chú, chat…), giống <code>\\newcommand</code> trong preamble. Ví dụ đặt <code>\\R</code> = <code>\\mathbb{R}</code> thì <code>$x \\in \\R^n$</code> hiện thành ${renderMath('x \\in \\mathbb{R}^n')}.</p>
      <div class="seg nbg-tabs" id="nbl-tabs"><button data-t="macro" class="active">Macro</button><button data-t="import">Nhập từ LaTeX</button><button data-t="snip">Công thức đã lưu</button></div>
      <div class="nbl-pane" data-p="macro">
        <div class="nbl-add"><input id="nbl-name" placeholder="\\tên (ví dụ \\R)"><input id="nbl-def" placeholder="định nghĩa (ví dụ \\mathbb{R}, dùng #1 #2 cho tham số)"><button type="button" class="sm primary" id="nbl-addbtn">Thêm</button><button type="button" class="sm" id="nbl-preset" title="Thêm các macro hay dùng khi viết về học máy">+ Gói học máy</button></div>
        <div id="nbl-macros"></div>
      </div>
      <div class="nbl-pane" data-p="import" hidden>
        <p class="hint">Dán preamble hoặc nội dung file <code>.sty</code> / <code>.tex</code>; app đọc <code>\\newcommand</code>, <code>\\renewcommand</code>, <code>\\def</code>, <code>\\DeclareMathOperator</code>, <code>\\let</code>. Các lệnh khác được bỏ qua.</p>
        <div class="row" style="gap:8px;margin-bottom:6px"><button type="button" class="sm" id="nbl-file">Chọn file .tex / .sty…</button><input type="file" id="nbl-fileinput" accept=".tex,.sty,.txt" hidden><span class="hint" id="nbl-fname"></span></div>
        <textarea id="nbl-src" class="nbc-code" rows="9" spellcheck="false" placeholder="\\newcommand{\\R}{\\mathbb{R}}&#10;\\DeclareMathOperator*{\\argmax}{arg\\,max}&#10;\\newcommand{\\norm}[1]{\\left\\lVert #1 \\right\\rVert}"></textarea>
        <div class="row" style="gap:8px;margin-top:6px"><button type="button" class="sm primary" id="nbl-parse">Đọc và thêm vào thư viện</button><span id="nbl-res" class="hint"></span></div>
      </div>
      <div class="nbl-pane" data-p="snip" hidden><div id="nbl-snips"></div></div>`,
    buttons: [{ label: 'Huỷ', value: null }, { label: 'Lưu thư viện', primary: true, onClick: async (b, close) => { await saveMathLib(st); toast('Đã lưu thư viện LaTeX.'); close(true); return false; } }],
    onOpen: (body) => {
      const drawMacros = () => {
        const list = Object.entries(st.macros).sort((a, b) => a[0].localeCompare(b[0]));
        body.querySelector('#nbl-macros').innerHTML = list.length ? `<table class="data"><thead><tr><th>Macro</th><th>Định nghĩa</th><th>Ví dụ</th><th></th></tr></thead><tbody>${list.map(([k, v]) => {
          const sig = macroSignature(k, v);
          const sample = sig.replace(/\{x(\d)\}/g, (m, n) => `{${'xyz'[n - 1] || 'a'}}`);
          return `<tr><td><code>${escapeHtml(sig)}</code></td><td><code>${escapeHtml(v)}</code></td><td>${renderMathWith(sample, st.macros)}</td><td><button type="button" class="sm ghost" data-del="${escapeHtml(k)}" title="Xoá macro">✕</button></td></tr>`;
        }).join('')}</tbody></table>` : '<p class="hint">Chưa có macro nào. Thêm từng macro ở trên, bấm “+ Gói học máy”, hoặc nhập từ file LaTeX ở tab bên cạnh.</p>';
      };
      const drawSnips = () => {
        body.querySelector('#nbl-snips').innerHTML = st.snippets.length ? `<table class="data"><thead><tr><th>Tên</th><th>Công thức</th><th>LaTeX</th><th></th></tr></thead><tbody>${st.snippets.map((s, i) => `<tr><td>${escapeHtml(s.name)}</td><td>${renderMathWith(s.tex, st.macros)}</td><td><code>${escapeHtml(s.tex)}</code></td><td><button type="button" class="sm ghost" data-sdel="${i}">✕</button></td></tr>`).join('')}</tbody></table>` : '<p class="hint">Chưa lưu công thức nào. Trong hộp Chèn công thức, bấm “Lưu vào thư viện”.</p>';
      };
      body.querySelector('#nbl-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (!b) return; body.querySelectorAll('#nbl-tabs button').forEach((x) => x.classList.toggle('active', x === b)); body.querySelectorAll('.nbl-pane').forEach((p) => { p.hidden = p.dataset.p !== b.dataset.t; }); });
      body.querySelector('#nbl-addbtn').addEventListener('click', () => {
        let n = body.querySelector('#nbl-name').value.trim();
        const d = body.querySelector('#nbl-def').value.trim();
        if (!n || !d) return toast('Nhập tên macro và định nghĩa.', 2500, 'err');
        if (!n.startsWith('\\')) n = `\\${n}`;
        if (!/^\\[A-Za-z@]+$/.test(n)) return toast('Tên macro chỉ gồm chữ cái, ví dụ \\R hoặc \\norm.', 3000, 'err');
        st.macros[n] = d;
        body.querySelector('#nbl-name').value = ''; body.querySelector('#nbl-def').value = '';
        drawMacros();
      });
      body.querySelector('#nbl-preset').addEventListener('click', () => { const before = Object.keys(st.macros).length; st.macros = { ...ML_PRESET, ...st.macros }; drawMacros(); toast(`Đã thêm ${Object.keys(st.macros).length - before} macro (macro trùng tên giữ bản của bạn).`); });
      body.querySelector('#nbl-macros').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { delete st.macros[b.dataset.del]; drawMacros(); } });
      body.querySelector('#nbl-snips').addEventListener('click', (e) => { const b = e.target.closest('[data-sdel]'); if (b) { st.snippets.splice(Number(b.dataset.sdel), 1); drawSnips(); } });
      body.querySelector('#nbl-file').addEventListener('click', () => body.querySelector('#nbl-fileinput').click());
      body.querySelector('#nbl-fileinput').addEventListener('change', async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        body.querySelector('#nbl-src').value = await f.text();
        body.querySelector('#nbl-fname').textContent = f.name;
      });
      body.querySelector('#nbl-parse').addEventListener('click', () => {
        const r = parseLatexDefs(body.querySelector('#nbl-src').value);
        Object.assign(st.macros, r.macros);
        body.querySelector('#nbl-res').innerHTML = r.found ? `Đã thêm ${r.found} macro: ${Object.keys(r.macros).map((k) => `<code>${escapeHtml(k)}</code>`).join(' ')}${r.skipped.length ? ` · ${escapeHtml(r.skipped.join(', '))}` : ''}. Bấm <b>Lưu thư viện</b> để giữ.` : 'Không tìm thấy định nghĩa nào.';
        drawMacros();
      });
      drawMacros();
      drawSnips();
    },
  });
}

/** Dựng công thức với một bộ macro chưa lưu (để xem thử trong hộp Thư viện). */
function renderMathWith(tex, macros) {
  const k = window.katex;
  if (!k) return escapeHtml(tex);
  try { return k.renderToString(tex, { throwOnError: false, macros: { ...macros }, strict: 'ignore' }); } catch (_) { return escapeHtml(tex); }
}

/* ---------------- 7. Chèn ảnh từ đường link ---------------- */

/** Nhập link ảnh, mô tả và độ rộng; xem trước. Trả về ![mô tả|rộng](link) hoặc null. */
export async function imageUrlDialog() {
  return dialog({
    title: 'Chèn ảnh từ đường link', width: 640,
    body: `<label class="field"><span class="label-text">Link ảnh (http/https)</span><input id="nbi-url" placeholder="https://…/figure.png"></label>
      <div class="nbq-grid"><label class="field"><span class="label-text">Mô tả / chú thích</span><input id="nbi-alt" placeholder="ví dụ: Hình 2: kiến trúc mô hình"></label>
      <label class="field"><span class="label-text">Độ rộng <span class="hint">(để trống = vừa khung)</span></span><input id="nbi-w" placeholder="400 hoặc 60%"></label></div>
      <div class="hint">Ảnh từ link cần có mạng mới hiện. Muốn lưu hẳn vào app thì tải ảnh về rồi kéo thả vào trang.</div>
      <div id="nbi-prev" class="nbi-prev"></div>`,
    buttons: [{ label: 'Huỷ', value: null }, { label: 'Chèn ảnh', primary: true, onClick: (b, close) => {
      const url = b.querySelector('#nbi-url').value.trim();
      if (!/^https?:\/\/\S+$/i.test(url)) { toast('Nhập link ảnh bắt đầu bằng http:// hoặc https://', 3000, 'err'); return false; }
      const w = b.querySelector('#nbi-w').value.trim();
      const alt = b.querySelector('#nbi-alt').value.trim().replace(/[[\]|]/g, ' ');
      close(`![${alt || 'ảnh'}${/^\d{1,4}(px|%)?$/.test(w) ? `|${w}` : ''}](${url})`);
      return false;
    } }],
    onOpen: (body) => {
      const prev = () => {
        const url = body.querySelector('#nbi-url').value.trim();
        body.querySelector('#nbi-prev').innerHTML = /^https?:\/\/\S+$/i.test(url) ? `<img src="${escapeHtml(url)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'status err',textContent:'Không tải được ảnh từ link này.'}))">` : '';
      };
      body.querySelector('#nbi-url').addEventListener('change', prev);
      body.querySelector('#nbi-url').addEventListener('input', prev);
      setTimeout(() => body.querySelector('#nbi-url').focus(), 30);
    },
  });
}
