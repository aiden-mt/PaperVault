// Đính kèm ảnh / file khi hỏi AI (Chat, tab Hỏi đáp của paper, hộp thoại AI trong Sổ tay).
// Mục đính kèm: ảnh { kind: 'image', url, name, mime } (đã lưu lên máy chủ), file chữ / PDF có chữ
// { kind: 'text' | 'pdf', name, text, chars, clipped }, PDF không có lớp chữ (bản scan) { kind: 'pdf-scan', name, pdfId }
// gửi nguyên file cho model.
import { api } from './api.js';
import { pdfFullText } from './pdftext.js';
import { bytesToBase64 } from './pdf.js';
import { escapeHtml } from './util.js';
import { toast } from './ui.js';

export const TEXT_EXT = new Set('txt md markdown csv tsv json jsonl tex bib ris py ipynb js ts jsx tsx java c h cpp hpp cc cs go rs rb php sql sh bash ps1 r m swift kt scala yaml yml toml ini cfg xml html htm css log rst srt'.split(' '));
export const ATTACH_ACCEPT = `image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf,text/*,${[...TEXT_EXT].map((e) => `.${e}`).join(',')}`;
export const FILE_CHARS = 80000; // ký tự tối đa mỗi file chữ gửi cho model
export const MAX_ATTACH = 6;
export const fmtChars = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',')}k` : String(n));

export const kindOf = (f) => {
  const ext = (f.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  if (/^image\/(png|jpeg|gif|webp)$/.test(f.type)) return 'image';
  if (f.type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (/^text\//.test(f.type) || TEXT_EXT.has(ext)) return 'text';
  return '';
};

/** Thu nhỏ ảnh lớn (cạnh dài ≤ 1600px) cho đỡ tốn token; ảnh nhỏ giữ nguyên. Trả về Blob. */
export async function shrink(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const MAX = 1600;
  if (Math.max(bmp.width, bmp.height) <= MAX && file.size <= 1.5 * 1024 * 1024) { bmp.close?.(); return file; }
  const s = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * s);
  cv.height = Math.round(bmp.height * s);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  const type = file.type === 'image/png' && file.size < 4 * 1024 * 1024 ? 'image/png' : 'image/jpeg';
  return new Promise((res) => cv.toBlob((b) => res(b || file), type, 0.9));
}

/** Một file -> mục đính kèm (ảnh và PDF được lưu vào kho của app). Trả về null nếu file quá lớn. */
export async function readAttachment(f) {
  const kind = kindOf(f);
  if (kind === 'image') {
    const blob = await shrink(f);
    const r = await api.uploadImage(new Uint8Array(await blob.arrayBuffer()), f.name || 'anh-dan.png');
    return { kind: 'image', url: r.url, name: f.name || 'ảnh dán', mime: blob.type || f.type };
  }
  if (kind === 'pdf') {
    if (f.size > 40 * 1024 * 1024) { toast(`${f.name} quá lớn (tối đa 40 MB).`, 4000, 'err'); return null; }
    // Lưu PDF vào kho của app rồi đọc chữ bằng PDF.js; không có lớp chữ (bản scan) thì gửi nguyên file cho model.
    const up = await api.uploadPdf(f, f.name);
    const text = (await pdfFullText(up.id, { maxPages: 120 }).catch(() => '')).trim();
    if (text.length >= 200) return { kind: 'pdf', name: f.name, text: text.slice(0, FILE_CHARS), chars: Math.min(text.length, FILE_CHARS), clipped: text.length > FILE_CHARS };
    return { kind: 'pdf-scan', name: f.name, pdfId: up.id };
  }
  if (f.size > 4 * 1024 * 1024) { toast(`${f.name} quá lớn (file chữ tối đa 4 MB).`, 4000, 'err'); return null; }
  const text = (await f.text()).replace(/\r\n/g, '\n');
  return { kind: 'text', name: f.name, text: text.slice(0, FILE_CHARS), chars: Math.min(text.length, FILE_CHARS), clipped: text.length > FILE_CHARS };
}

/** Ảnh đã lưu trên máy chủ / PDF bản scan -> { mime, data (base64), name } để gửi cho model (nhớ trong bộ nhớ). */
const payloadCache = new Map();
export async function attachmentPayload(im) {
  if (im.pdfId) {
    const key = `pdf:${im.pdfId}`;
    if (payloadCache.has(key)) return payloadCache.get(key);
    try { const out = { mime: 'application/pdf', name: im.name, data: bytesToBase64(await api.pdfBytes(im.pdfId)) }; payloadCache.set(key, out); return out; } catch (_) { return null; }
  }
  if (payloadCache.has(im.url)) return payloadCache.get(im.url);
  try {
    const blob = await (await fetch(im.url)).blob();
    const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(blob); });
    const ext = (im.url.match(/\.(\w+)$/) || [])[1];
    const mime = blob.type && blob.type !== 'application/octet-stream' ? blob.type : ({ png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext] || 'image/png');
    const out = { mime, data, name: im.name };
    payloadCache.set(im.url, out);
    return out;
  } catch (_) { return null; }
}

/**
 * Danh sách đính kèm -> phần gửi cho model: images (ảnh + PDF scan, dạng base64) và textPrefix (nội dung các file chữ,
 * đặt trước câu hỏi).
 */
export async function attachmentParts(list) {
  const visual = list.filter((a) => a.kind === 'image' || a.kind === 'pdf-scan');
  const textFiles = list.filter((a) => a.kind === 'text' || a.kind === 'pdf');
  const images = (await Promise.all(visual.map(attachmentPayload))).filter(Boolean);
  const textPrefix = textFiles.length ? `Người dùng đính kèm ${textFiles.length} file:\n${textFiles.map((f) => `<file name="${f.name}">\n${f.text}\n</file>`).join('\n')}\n\n` : '';
  return { images, textPrefix };
}

/** Thẻ nhỏ của từng mục đính kèm (có nút ✕ data-rm-att). */
export function attachChipsHtml(list, busy = '') {
  return list.map((a, k) => (a.kind === 'image'
    ? `<span class="ch-att-it" title="${escapeHtml(a.name)}"><img src="${escapeHtml(a.url)}" alt=""><button type="button" class="ch-att-x" data-rm-att="${k}" title="Bỏ ảnh này">✕</button></span>`
    : `<span class="ch-att-file" title="${escapeHtml(a.name)}${a.clipped ? ' · file dài, chỉ gửi phần đầu' : ''}">📄 <span class="ch-att-fn">${escapeHtml(a.name)}</span> <span class="hint">${a.kind === 'pdf-scan' ? 'PDF scan' : `${fmtChars(a.chars)} ký tự`}</span><button type="button" class="ch-att-x" data-rm-att="${k}" title="Bỏ file này">✕</button></span>`)).join('')
    + (busy ? `<span class="ch-att-file busy"><span class="spin"></span> ${escapeHtml(busy === true ? 'Đang xử lý…' : busy)}</span>` : '');
}

/** Nút và ô HTML cho một khu đính kèm (dùng cùng createAttachBox). */
export const attachRowHtml = (prefix, hint = 'Dán (Ctrl+V) hoặc kéo thả ảnh, PDF, file chữ vào khung hỏi') => `<div class="ch-att-row"><button type="button" class="sm ghost" id="${prefix}-attach" title="Đính kèm ảnh (hình, biểu đồ, ảnh chụp màn hình) hoặc file (PDF, .txt, .md, .csv, .json, .tex, .bib, code…). Cũng có thể dán Ctrl+V hoặc kéo thả vào đây.">📎 Đính kèm</button><input type="file" id="${prefix}-file" accept="${ATTACH_ACCEPT}" multiple hidden><div id="${prefix}-att" class="ch-att"></div><span class="hint ch-att-hint">${escapeHtml(hint)}</span></div>`;

/**
 * Gắn hành vi đính kèm cho một khung hỏi: nút 📎, dán Ctrl+V vào textarea, kéo thả vào dropZone.
 * Trả về { items, busy(), clear(), add(files) }.
 */
export function createAttachBox({ button, input, chips, textarea, dropZone, onChange = () => {} }) {
  const items = [];
  let busy = false;
  const draw = () => {
    chips.innerHTML = attachChipsHtml(items, busy);
    dropZone?.classList.toggle('has-att', items.length > 0 || !!busy);
    onChange(items);
  };
  async function add(files) {
    const list = [...files];
    const bad = list.filter((f) => !kindOf(f));
    if (bad.length) toast(`Chưa đọc được: ${bad.map((f) => f.name).join(', ')}. Nhận ảnh (PNG, JPG, GIF, WebP), PDF và file chữ (.txt, .md, .csv, .json, .tex, .bib, code…). File Word hãy lưu thành PDF trước.`, 6000, 'err');
    const ok = list.filter((f) => kindOf(f));
    if (!ok.length) return;
    const room = MAX_ATTACH - items.length;
    if (room <= 0) { toast(`Mỗi câu hỏi đính kèm tối đa ${MAX_ATTACH} tệp.`, 3000); return; }
    if (ok.length > room) toast(`Chỉ thêm ${room} tệp đầu (tối đa ${MAX_ATTACH} tệp mỗi câu hỏi).`, 3000);
    try {
      for (const f of ok.slice(0, room)) {
        busy = kindOf(f) === 'image' ? 'Đang xử lý ảnh…' : `Đang đọc ${f.name}…`;
        draw();
        const it = await readAttachment(f);
        if (it) items.push(it);
      }
    } catch (e) {
      toast(`Không thêm được tệp: ${e.message}`, 4000, 'err');
    } finally {
      busy = false;
      draw();
      textarea?.focus();
    }
  }
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => { add(e.target.files); e.target.value = ''; });
  chips.addEventListener('click', (e) => { const b = e.target.closest('[data-rm-att]'); if (b) { items.splice(Number(b.dataset.rmAtt), 1); draw(); } });
  textarea?.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    add(files);
  });
  if (dropZone) {
    const hasFile = (e) => [...(e.dataTransfer?.items || [])].some((it) => it.kind === 'file');
    dropZone.addEventListener('dragover', (e) => { if (!hasFile(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dropZone.classList.add('drop'); });
    dropZone.addEventListener('dragleave', (e) => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drop'); });
    dropZone.addEventListener('drop', (e) => { dropZone.classList.remove('drop'); if (!e.dataTransfer?.files?.length) return; e.preventDefault(); add(e.dataTransfer.files); });
  }
  draw();
  return { items, busy: () => !!busy, clear: () => { items.length = 0; draw(); }, add };
}

/** Ảnh và file đã gửi, hiện trong bong bóng câu hỏi (ảnh bấm để phóng to: data-zoom). */
export const msgFilesHtml = (list) => (list?.length ? `<div class="msg-files">${list.map((f) => `<span class="msg-file" title="${escapeHtml(f.name)}">📄 ${escapeHtml(f.name)} <span class="hint">· ${f.kind === 'pdf-scan' ? 'gửi nguyên PDF' : `${fmtChars(f.chars || 0)} ký tự${f.clipped ? ', đã cắt bớt' : ''}`}</span></span>`).join('')}</div>` : '');
export const msgImgsHtml = (list) => (list?.length ? `<div class="msg-imgs">${list.map((im) => `<img src="${escapeHtml(im.url)}" alt="${escapeHtml(im.name || 'ảnh')}" title="${escapeHtml(im.name || '')} · bấm để phóng to" data-zoom loading="lazy">`).join('')}</div>` : '');

/** Phóng to ảnh khi bấm (lớp phủ, Esc hoặc bấm để đóng). */
export function zoomImage(img) {
  const ov = document.createElement('div');
  ov.className = 'hp-lb';
  ov.innerHTML = `<img src="${escapeHtml(img.getAttribute('src'))}" alt=""><div class="hp-lb-cap">${escapeHtml(img.alt || '')} · bấm để đóng</div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onEsc, true); };
  const onEsc = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
  ov.addEventListener('click', close);
  document.addEventListener('keydown', onEsc, true);
  document.body.appendChild(ov);
}
