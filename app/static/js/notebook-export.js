// Sổ tay: xuất trang hoặc cả nhánh (trang + mọi trang con) ra PDF / Word (.docx) / Markdown (.zip cho Obsidian),
// và xem, so sánh, khôi phục các phiên bản cũ của trang.
// PDF: máy chủ in trang bằng Edge / Chrome chạy ẩn (giữ công thức KaTeX, code tô màu, ảnh); máy không có trình duyệt
// hợp thì mở hộp thoại In của trình duyệt (chọn "Lưu thành PDF"). Word: dựng .docx ngay trong app, kèm ảnh.
import { api } from './api.js';
import { renderNote, childrenOf, allPages, paperShort } from './notebook.js';
import { paperById } from './store.js';
import { withPlainMath, plainTitle } from './richtext.js';
import { htmlToDocxWithImages, DOCX_MIME, zipBlob } from './docx.js';
import { escapeHtml, download, fmtRelative, copyText } from './util.js';
import { dialog, toast, spinner } from './ui.js';

const fileBase = (p) => (p.title || 'trang').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'trang';

/** HTML của trang để xuất: bỏ nút bấm, ô đánh dấu thành ☐ / ☑, callout thành khối trích dẫn có tiêu đề. */
function exportHtml(p, { forWord = false, anchors = null } = {}) {
  const raw = forWord ? withPlainMath(() => renderNote(p.content || '')) : renderNote(p.content || '');
  const doc = new DOMParser().parseFromString(`<div id="x">${raw}</div>`, 'text/html');
  const root = doc.getElementById('x');
  root.querySelectorAll('button, .nb-code-h .hint, script').forEach((b) => b.remove());
  root.querySelectorAll('.nb-todos input[type="checkbox"]').forEach((cb) => cb.replaceWith(doc.createTextNode(cb.hasAttribute('checked') ? '☑ ' : '☐ ')));
  root.querySelectorAll('a[href^="#"]').forEach((a) => a.removeAttribute('href')); // liên kết nội bộ của app vô nghĩa ngoài app
  // Xuất cả nhánh: liên kết tới trang cùng nhánh thành liên kết trong file (bấm được trong PDF).
  if (anchors) root.querySelectorAll('a[data-nb-page]').forEach((a) => { if (anchors.has(a.dataset.nbPage)) a.setAttribute('href', `#pg-${a.dataset.nbPage}`); });
  if (forWord) {
    root.querySelectorAll('.nb-callout').forEach((c) => {
      const q = doc.createElement('blockquote');
      const h = c.querySelector('.nb-co-h');
      if (h) { const b = doc.createElement('p'); b.innerHTML = `<b>${h.innerHTML}</b>`; q.appendChild(b); }
      const body = c.querySelector('.nb-co-b');
      if (body) q.append(...body.childNodes);
      c.replaceWith(q);
    });
    root.querySelectorAll('.nb-todos li').forEach((li) => { const pEl = doc.createElement('p'); pEl.innerHTML = li.innerHTML; li.replaceWith(pEl); });
    root.querySelectorAll('.nb-todos').forEach((ul) => { const d = doc.createElement('div'); d.append(...ul.childNodes); ul.replaceWith(d); });
    root.querySelectorAll('figcaption').forEach((fc) => { const pEl = doc.createElement('p'); pEl.innerHTML = `<i>${fc.innerHTML}</i>`; fc.replaceWith(pEl); });
  }
  const title = `${p.icon ? `${escapeHtml(p.icon)} ` : ''}${escapeHtml(p.title || 'Không tên')}`;
  return { title, body: root.innerHTML };
}

const PRINT_CSS = `@page { size: A4; margin: 16mm 15mm 18mm; }
html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
body { margin: 0; zoom: 1 !important; color: #111827; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.nb-print { max-width: none; margin: 0; padding: 0 !important; border: 0 !important; background: #fff !important; overflow: visible !important; height: auto !important; font-size: 11.5pt; }
.nb-print-h { font-size: 22pt; margin: 0 0 4pt; line-height: 1.25; }
.nb-print-meta { color: #6b7280; font-size: 9pt; margin: 0 0 14pt; padding-bottom: 8pt; border-bottom: 1px solid #e5e7eb; }
.nb-print img { max-width: 100%; }
.nb-print pre, .nb-print code { white-space: pre-wrap; word-break: break-word; }
.nb-print .nb-code, .nb-print .nb-callout, .nb-print figure, .nb-print table, .nb-print .nb-embed { break-inside: avoid; }
.nb-print h1, .nb-print h2, .nb-print h3 { break-after: avoid; }
.nb-print table { border-collapse: collapse; margin: 8pt 0; }
.nb-print th, .nb-print td { border: 1px solid #d1d5db; padding: 4pt 8pt; text-align: left; }
.nb-print th { background: #f3f4f6; }`;

function printDoc(p, { base = '' } = {}) {
  const { title, body } = exportHtml(p);
  const when = new Date(p.updatedAt || Date.now()).toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'short' });
  return `<!doctype html><html lang="vi" data-theme="light"><head><meta charset="utf-8">${base ? `<base href="${base}">` : ''}<title>${escapeHtml(p.title || 'Sổ tay')}</title>
<link rel="stylesheet" href="vendor/katex/katex.min.css"><link rel="stylesheet" href="css/theme.css"><link rel="stylesheet" href="css/app.css"><style>${PRINT_CSS}</style></head>
<body><article class="md nb-prev nb-print"><h1 class="nb-print-h">${title}</h1><div class="nb-print-meta">PaperVault · Sổ tay · sửa lần cuối ${escapeHtml(when)}</div>${body}</article></body></html>`;
}

/** Không in được bằng máy chủ: in qua khung ẩn, người dùng chọn "Lưu thành PDF" trong hộp thoại In. */
function printInFrame(docHtml) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(f);
  f.srcdoc = docHtml;
  f.onload = () => setTimeout(() => {
    try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast(`Không mở được hộp thoại In: ${e.message}`, 5000, 'err'); }
    setTimeout(() => f.remove(), 60000);
  }, 600);
}

export async function exportPagePdf(p) {
  toast('Đang tạo PDF…', 20000);
  try {
    const blob = await api.htmlToPdf(printDoc(p));
    await download(`${fileBase(p)}.pdf`, blob, 'application/pdf');
  } catch (e) {
    if (/no-browser/.test(e.message)) {
      toast('Máy không có Edge / Chrome để tạo PDF: mở hộp thoại In, chọn “Lưu thành PDF”.', 6000);
      printInFrame(printDoc(p, { base: `${location.origin}/` }));
    } else toast(e.message, 6000, 'err');
  }
}

export async function exportPageDocx(p) {
  const { title, body } = exportHtml(p, { forWord: true });
  try {
    const blob = await htmlToDocxWithImages(`<h1>${title}</h1>${body}`, { title: p.title || 'Sổ tay' });
    await download(`${fileBase(p)}.docx`, blob, DOCX_MIME, { note: 'Công thức giữ dạng mã LaTeX.' });
  } catch (e) { toast(`Không tạo được file Word: ${e.message}`, 5000, 'err'); }
}

/* ---------------------------------------------------------------- xuất cả nhánh */

const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '', 'vi');

/** Trang gốc (root = null: cả sổ tay) và mọi trang con, theo thứ tự ở cây trang: [{ p, depth, num }]. */
export function subtreeList(root) {
  const out = [];
  const seen = new Set();
  if (root) { out.push({ p: root, depth: 0, num: '' }); seen.add(root.id); }
  const walk = (id, depth, prefix) => {
    childrenOf(id).sort(byTitle).forEach((c, i) => {
      if (seen.has(c.id)) return;
      seen.add(c.id);
      const num = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      out.push({ p: c, depth, num });
      walk(c.id, depth + 1, num);
    });
  };
  walk(root ? root.id : null, 1, '');
  return out;
}

const fmtWhen = (v) => new Date(v || Date.now()).toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'short' });
const label = (p) => `${p.icon ? `${p.icon} ` : ''}${p.title || 'Không tên'}`;

const TREE_CSS = `.nb-toc { margin: 4pt 0 0; }
.nb-toc h2 { font-size: 14pt; margin: 0 0 8pt; }
.nb-toc a { color: inherit; text-decoration: none; display: block; padding: 2pt 0; border-bottom: 1px dotted #e5e7eb; }
.nb-toc .n { color: #6b7280; display: inline-block; min-width: 34pt; }
.nb-sec { break-before: page; }
.nb-sec-h { font-size: 18pt; margin: 0 0 3pt; line-height: 1.25; }
.nb-sec-h .n { color: #6b7280; margin-right: 8pt; }`;

function treeDocHtml(list, title, { forWord = false } = {}) {
  const anchors = new Set(list.map((x) => x.p.id));
  const toc = list.filter((x) => x.depth > 0).map((x) => forWord
    ? `<p>${'\u00a0'.repeat(4 * (x.depth - 1))}${escapeHtml(x.num)}\u00a0\u00a0${escapeHtml(label(x.p))}</p>`
    : `<a href="#pg-${escapeHtml(x.p.id)}" style="padding-left:${(x.depth - 1) * 16}pt"><span class="n">${escapeHtml(x.num)}</span>${escapeHtml(label(x.p))}</a>`).join('');
  const secs = list.map(({ p, num }, i) => {
    const { title: h, body } = exportHtml(p, { forWord, anchors });
    const n = num ? `<span class="n">${escapeHtml(num)}</span>` : '';
    if (forWord) return `${i ? '<div class="docx-pb"></div>' : ''}<h1>${num ? `${escapeHtml(num)}. ` : ''}${h}</h1>${body}`;
    return `<section class="nb-sec" id="pg-${escapeHtml(p.id)}"><h1 class="nb-sec-h">${n}${h}</h1><div class="nb-print-meta">Sửa lần cuối ${escapeHtml(fmtWhen(p.updatedAt))}</div>${body}</section>`;
  }).join('');
  const meta = `PaperVault · Sổ tay · ${list.length} trang · xuất ${fmtWhen()}`;
  if (forWord) return `<h1>${escapeHtml(title)}</h1><p><i>${escapeHtml(meta)}</i></p>${toc ? `<h2>Mục lục</h2>${toc}` : ''}${secs ? `<div class="docx-pb"></div>${secs}` : ''}`;
  return `<!doctype html><html lang="vi" data-theme="light"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="vendor/katex/katex.min.css"><link rel="stylesheet" href="css/theme.css"><link rel="stylesheet" href="css/app.css"><style>${PRINT_CSS}\n${TREE_CSS}</style></head>
<body><article class="md nb-prev nb-print"><h1 class="nb-print-h">${escapeHtml(title)}</h1><div class="nb-print-meta">${escapeHtml(meta)}</div>
${toc ? `<nav class="nb-toc"><h2>Mục lục</h2>${toc}</nav>` : ''}${secs}</article></body></html>`;
}

/* Markdown cho Obsidian / Logseq / VS Code: mỗi trang một file .md, trang có trang con thành thư mục cùng tên
   (ghi chú thư mục kiểu Obsidian), ảnh đã tải lên app vào attachments/, giữ nguyên [[liên kết]] và #tag. */
const safeName = (s) => String(s || 'Không tên').replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80) || 'Không tên';
const yamlStr = (s) => JSON.stringify(String(s ?? ''));
const paperUrl = (p) => p.url || (p.arxivId ? `https://arxiv.org/abs/${p.arxivId}` : p.doi ? `https://doi.org/${p.doi}` : '');

/** Đổi phần ngoài khối code của Markdown. */
const outsideCode = (md, fn) => String(md || '').split(/(```[\s\S]*?```|`[^`\n]*`)/).map((seg, i) => (i % 2 ? seg : fn(seg))).join('');

export function treeMarkdownFiles(list, top) {
  const ids = new Set(list.map((x) => x.p.id));
  const base = new Map(); // id -> tên file (không trùng trong cả bộ, để [[tên]] luôn trỏ đúng một file)
  const used = new Set();
  for (const { p } of list) {
    const n = safeName(p.title);
    let name = n;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${n} (${k})`;
    used.add(name.toLowerCase());
    base.set(p.id, name);
  }
  const titleTo = new Map(list.map(({ p }) => [(p.title || '').trim().toLowerCase(), p.id]));
  const dir = new Map(); // id -> thư mục chứa các trang con của nó
  const path = new Map(); // id -> đường dẫn file .md trong zip
  for (const { p, depth } of list) {
    const parentDir = (p.parentId && dir.get(p.parentId)) || top;
    const kids = childrenOf(p.id).some((c) => ids.has(c.id));
    // Trang gốc của nhánh nằm ngay trong thư mục của bộ xuất (đã mang tên nó), không lồng thêm một thư mục cùng tên.
    const own = depth === 0 ? top : kids ? `${parentDir}/${base.get(p.id)}` : parentDir;
    if (kids) dir.set(p.id, own);
    path.set(p.id, `${own}/${base.get(p.id)}.md`);
  }
  const images = new Set();
  const files = list.map(({ p }) => {
    const file = path.get(p.id);
    const up = '../'.repeat(file.split('/').length - 2); // từ thư mục của file về thư mục gốc của bộ xuất
    const body = outsideCode(p.content || '', (s) => s
      .replace(/(!?)\[\[([^\]\n]+?)\]\]/g, (m, bang, inner) => {
        const [targetRaw, alias] = inner.split('|');
        const [target, sec] = targetRaw.split('#');
        const t0 = target.trim();
        if (t0.startsWith('@')) {
          const pp = paperById(t0.slice(1));
          if (!pp) return alias || t0;
          const text = alias ? alias.trim() : `📄 ${paperShort(pp)}: ${plainTitle(pp.title)}`;
          const u = paperUrl(pp);
          return u ? `[${text.replace(/[[\]]/g, '')}](${u})` : text;
        }
        const id = titleTo.get(t0.toLowerCase());
        if (!id) return m;
        const name = base.get(id);
        const shown = alias ? alias.trim() : (name !== t0 ? t0 : '');
        return `${bang}[[${name}${sec ? `#${sec}` : ''}${shown ? `|${shown}` : ''}]]`;
      })
      .replace(/(!\[[^\]\n]*\]\(\s*)\/api\/image\/([0-9a-f]{16}\.(?:png|jpg|gif|webp|bmp))(\s*\))/g, (m, a, f, b) => { images.add(f); return `${a}${up}attachments/${f}${b}`; }));
    const fm = ['---', `title: ${yamlStr(p.title || '')}`];
    if (base.get(p.id) !== (p.title || '').trim()) fm.push(`aliases: [${yamlStr(p.title || '')}]`);
    if (p.icon) fm.push(`icon: ${yamlStr(p.icon)}`);
    if (p.createdAt) fm.push(`created: ${new Date(p.createdAt).toISOString()}`);
    if (p.updatedAt) fm.push(`updated: ${new Date(p.updatedAt).toISOString()}`);
    fm.push('---', '');
    return { name: file, data: `${fm.join('\n')}${body.endsWith('\n') ? body : `${body}\n`}` };
  });
  return { files, images: [...images] };
}

async function exportTreeMarkdown(list, title) {
  const top = safeName(title);
  const { files, images } = treeMarkdownFiles(list, top);
  let missing = 0;
  await Promise.all(images.map(async (f) => {
    try {
      const r = await fetch(`/api/image/${f}`);
      if (!r.ok) throw new Error(r.status);
      files.push({ name: `${top}/attachments/${f}`, data: new Uint8Array(await r.arrayBuffer()) });
    } catch (_) { missing++; }
  }));
  await download(`${top}.zip`, zipBlob(files), 'application/zip', {
    note: `Giải nén vào vault Obsidian (hoặc mở thư mục bằng Logseq / VS Code).${missing ? ` ${missing} ảnh không tải được.` : ''}`,
  });
}

/** Hộp thoại "Xuất cả nhánh": chọn phạm vi (nhánh của trang này / cả sổ tay) và định dạng. */
export async function exportTree(page) {
  const all = allPages().length;
  const branch = page ? subtreeList(page) : [];
  let body = null;
  const fmt = await dialog({
    title: 'Xuất nhiều trang', width: 560,
    body: `<div class="xt-scope">
        ${page ? `<label class="xt-opt"><input type="radio" name="xt-scope" value="branch" checked><span><b>Nhánh “${escapeHtml(label(page))}”</b><span class="hint">Trang này và ${branch.length - 1} trang con, cháu.</span></span></label>` : ''}
        <label class="xt-opt"><input type="radio" name="xt-scope" value="all" ${page ? '' : 'checked'}><span><b>Cả sổ tay</b><span class="hint">${all} trang (không tính thùng rác).</span></span></label>
      </div>
      <div class="label-text" style="margin-top:12px">Định dạng</div>
      <div class="xt-fmts">
        <label class="xt-opt"><input type="radio" name="xt-fmt" value="pdf" checked><span><b>PDF</b><span class="hint">Mục lục ở đầu, mỗi trang bắt đầu ở trang giấy mới, liên kết [[…]] bấm được.</span></span></label>
        <label class="xt-opt"><input type="radio" name="xt-fmt" value="docx"><span><b>Word (.docx)</b><span class="hint">Mục lục, ngắt trang giữa các trang, kèm ảnh. Công thức giữ dạng LaTeX.</span></span></label>
        <label class="xt-opt"><input type="radio" name="xt-fmt" value="md"><span><b>Markdown (.zip)</b><span class="hint">Cho Obsidian, Logseq: cây thư mục theo cây trang, giữ [[liên kết]] và #tag, ảnh trong attachments/.</span></span></label>
      </div>`,
    buttons: [{ label: 'Huỷ', value: null }, { label: 'Xuất', value: 'go', primary: true }],
    onOpen: (b) => { body = b; },
  });
  if (fmt !== 'go' || !body) return;
  const scope = body.querySelector('input[name="xt-scope"]:checked')?.value || 'all';
  const kind = body.querySelector('input[name="xt-fmt"]:checked')?.value || 'pdf';
  const list = scope === 'branch' && page ? branch : subtreeList(null);
  const title = scope === 'branch' && page ? (page.title || 'Sổ tay') : 'Sổ tay PaperVault';
  if (!list.length) return toast('Không có trang nào để xuất.', 3000);
  const fname = safeName(title);
  if (kind === 'md') return exportTreeMarkdown(list, title);
  if (kind === 'docx') {
    toast(`Đang tạo file Word (${list.length} trang)…`, 20000);
    try {
      const blob = await htmlToDocxWithImages(treeDocHtml(list, title, { forWord: true }), { title });
      await download(`${fname}.docx`, blob, DOCX_MIME, { note: 'Công thức giữ dạng mã LaTeX.' });
    } catch (e) { toast(`Không tạo được file Word: ${e.message}`, 5000, 'err'); }
    return;
  }
  toast(`Đang tạo PDF (${list.length} trang)…`, 30000);
  const html = treeDocHtml(list, title);
  try {
    await download(`${fname}.pdf`, await api.htmlToPdf(html), 'application/pdf');
  } catch (e) {
    if (/no-browser/.test(e.message)) {
      toast('Máy không có Edge / Chrome để tạo PDF: mở hộp thoại In, chọn “Lưu thành PDF”.', 6000);
      printInFrame(html.replace('<meta charset="utf-8">', `<meta charset="utf-8"><base href="${location.origin}/">`));
    } else toast(e.message, 6000, 'err');
  }
}

/* ---------------------------------------------------------------- lịch sử phiên bản */

/** So sánh theo dòng (LCS). Trả về [{ t: '=' | '+' | '-', s }]; văn bản quá dài thì null. */
export function lineDiff(a, b) {
  const A = String(a || '').split('\n');
  const B = String(b || '').split('\n');
  if (A.length * B.length > 4e6) return null;
  const n = A.length;
  const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: '=', s: A[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: '-', s: A[i++] }); else out.push({ t: '+', s: B[j++] });
  }
  while (i < n) out.push({ t: '-', s: A[i++] });
  while (j < m) out.push({ t: '+', s: B[j++] });
  return out;
}

export function diffHtml(oldText, curText, { oldLabel = 'bản cũ', curLabel = 'bản hiện tại' } = {}) {
  const d = lineDiff(oldText, curText);
  if (!d) return '<p class="hint">Trang quá dài để so sánh từng dòng.</p>';
  const add = d.filter((x) => x.t === '+').length;
  const del = d.filter((x) => x.t === '-').length;
  if (!add && !del) return `<p class="hint">Giống hệt ${curLabel}.</p>`;
  // Chỉ hiện dòng đổi kèm 2 dòng trước / sau; đoạn giống nhau dài thì gộp lại.
  const keep = d.map((x, k) => x.t !== '=' || d.slice(Math.max(0, k - 2), k + 3).some((y) => y.t !== '='));
  let html = '';
  let gap = 0;
  d.forEach((x, k) => {
    if (!keep[k]) { gap++; return; }
    if (gap) { html += `<div class="vh-gap">… ${gap} dòng giống nhau …</div>`; gap = 0; }
    html += `<div class="vh-l ${x.t === '+' ? 'add' : x.t === '-' ? 'del' : ''}"><span>${x.t === '=' ? ' ' : x.t}</span>${escapeHtml(x.s) || '&nbsp;'}</div>`;
  });
  if (gap) html += `<div class="vh-gap">… ${gap} dòng giống nhau …</div>`;
  return `<div class="hint vh-sum"><span class="vh-del">− ${del} dòng của ${oldLabel}</span> · <span class="vh-add">+ ${add} dòng của ${curLabel}</span></div><div class="vh-diff">${html}</div>`;
}

/**
 * Hộp thoại Lịch sử phiên bản. App tự lưu một bản mỗi khi trang được sửa (gộp các lần sửa liên tục trong 10 phút),
 * giữ 80 bản gần nhất. onRestored(page) chạy sau khi khôi phục.
 */
export async function openVersions(p, { onRestored } = {}) {
  let list = [];
  try { list = await api.pageVersions(p.id); } catch (e) { toast(e.message, 4000, 'err'); return; }
  if (!list.length) { toast('Trang này chưa có phiên bản cũ. App tự lưu một bản mỗi khi bạn sửa trang (tối đa mỗi 10 phút một bản).', 6000); return; }
  const cache = new Map();
  let sel = list[0].id;
  let view = 'diff';
  const fmt = (iso) => new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
  const r = await dialog({
    title: `Lịch sử phiên bản · ${p.title || 'Không tên'}`, width: 980,
    body: `<div class="vh">
        <div class="vh-list" id="vh-list"><div class="vh-cur"><b>Bản hiện tại</b><span class="hint">sửa ${escapeHtml(fmtRelative(p.updatedAt))} · ${String(p.content || '').length.toLocaleString('vi-VN')} ký tự</span></div>${list.map((v) => `<button type="button" class="vh-item" data-vid="${v.id}"><b>${escapeHtml(fmt(v.at))}</b><span class="hint">${escapeHtml(fmtRelative(v.at))} · ${v.size.toLocaleString('vi-VN')} ký tự${v.title !== (p.title || '') ? ` · tên: ${escapeHtml(v.title || 'Không tên')}` : ''}</span></button>`).join('')}</div>
        <div class="vh-main"><div class="seg vh-seg" id="vh-seg"><button data-v="diff">So với hiện tại</button><button data-v="view">Xem bản này</button><button data-v="md">Markdown</button></div><div class="vh-body" id="vh-body"></div></div>
      </div>
      <p class="hint" style="margin-top:8px">App tự lưu một bản khi bạn sửa trang (các lần sửa liên tục trong 10 phút gộp làm một), giữ ${list.length >= 80 ? '80' : 'tối đa 80'} bản gần nhất. Khôi phục cũng lưu lại bản hiện tại, nên luôn quay lại được.</p>`,
    buttons: [{ label: 'Copy Markdown', value: 'copy', onClick: async () => { const v = cache.get(sel); if (v) { await copyText(v.content || ''); toast('Đã copy.'); } return false; } }, { label: 'Đóng', value: null }, { label: 'Khôi phục', primary: true, onClick: (b, close) => { close('restore'); return false; } }],
    onOpen: (b) => {
      const draw = async () => {
        b.querySelectorAll('.vh-item').forEach((x) => x.classList.toggle('active', Number(x.dataset.vid) === sel));
        b.querySelectorAll('#vh-seg button').forEach((x) => x.classList.toggle('active', x.dataset.v === view));
        const box = b.querySelector('#vh-body');
        if (!cache.has(sel)) { box.innerHTML = spinner('Đang tải…'); cache.set(sel, await api.pageVersion(p.id, sel)); }
        const v = cache.get(sel);
        if (view === 'diff') box.innerHTML = diffHtml(v.content, p.content);
        else if (view === 'md') box.innerHTML = `<pre class="vh-md">${escapeHtml(v.content || '')}</pre>`;
        else box.innerHTML = `<div class="md nb-prev vh-prev">${renderNote(v.content || '') || '<p class="hint">Trang trống.</p>'}</div>`;
      };
      b.querySelector('#vh-list').addEventListener('click', (e) => { const it = e.target.closest('[data-vid]'); if (it) { sel = Number(it.dataset.vid); draw(); } });
      b.querySelector('#vh-seg').addEventListener('click', (e) => { const it = e.target.closest('[data-v]'); if (it) { view = it.dataset.v; draw(); } });
      draw();
    },
  });
  if (r !== 'restore') return;
  try {
    const saved = await api.restorePageVersion(p.id, sel);
    toast(`Đã khôi phục bản lúc ${fmt(list.find((v) => v.id === sel)?.at)}.`, 4000, 'ok');
    await onRestored?.(saved);
  } catch (e) { toast(e.message, 5000, 'err'); }
}
