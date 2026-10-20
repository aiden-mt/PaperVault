// Tiện ích dùng chung (kế thừa từ extension, bổ sung vài hàm cho app).

export function uid(prefix = 'p') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nowISO() {
  return new Date().toISOString();
}

export function slugify(text, maxLen = 70) {
  const from = 'àáãảạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệđìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ';
  const to   = 'aaaaaaaaaaaaaaaaaaeeeeeeeeeeediiiiioooooooooooooooooouuuuuuuuuuuyyyyy';
  let s = String(text || '').toLowerCase();
  for (let i = 0; i < from.length; i++) s = s.split(from[i]).join(to[i]);
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (s || 'untitled').slice(0, maxLen).replace(/-+$/g, '');
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Cắt text theo số ký tự nhưng giữ phần đầu + phần cuối (kết luận/limitation thường ở cuối). */
export function clampText(text, maxChars) {
  const t = String(text || '').replace(/\r/g, '');
  if (t.length <= maxChars) return t;
  const head = Math.floor(maxChars * 0.7);
  const tail = maxChars - head - 40;
  return `${t.slice(0, head)}\n\n[... lược bớt ${t.length - maxChars} ký tự ở giữa ...]\n\n${t.slice(-tail)}`;
}

const BACKSLASH = String.fromCharCode(92);

/** Parse JSON từ output của LLM, chịu được code fence hoặc chữ thừa xung quanh. */
export function parseLooseJson(raw) {
  if (raw == null) throw new Error('Model không trả về nội dung.');
  if (typeof raw === 'object') return raw;
  let s = String(raw).trim();
  // Thử nguyên văn trước: trường Markdown (ghi chú template) có thể chứa ``` bên trong chuỗi JSON.
  try { return JSON.parse(s); } catch (_) { /* thử cách khác */ }
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i) || s.match(/```json\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch (_) { /* thử cách khác */ }
  const start = s.indexOf('{');
  if (start === -1) throw new Error('Không tìm thấy JSON trong phản hồi của model.');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === BACKSLASH) esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(start, i + 1));
    }
  }
  throw new Error('JSON trong phản hồi bị cắt cụt (thử tăng max tokens hoặc giảm độ dài input).');
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function fmtRelative(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'vừa xong';
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} ngày trước`;
  return fmtDate(iso);
}

export const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

const FILE_KINDS = {
  csv: 'Bảng CSV', bib: 'BibTeX', tex: 'LaTeX', doc: 'Tài liệu Word', docx: 'Tài liệu Word', md: 'Markdown', json: 'JSON', txt: 'Văn bản', pdf: 'PDF',
};

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function anchorDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Lưu file, luôn hỏi chỗ lưu: bản desktop dùng hộp thoại "Lưu thành" của Windows, trình duyệt Chrome / Edge dùng
 * showSaveFilePicker, trình duyệt khác rơi về tải xuống thường. Trả về { name, path? } khi đã lưu, null khi người dùng huỷ.
 * opts.note: câu thêm vào thông báo sau khi lưu; opts.quiet: không hiện thông báo.
 */
export async function download(filename, content, mime = 'text/plain;charset=utf-8', opts = {}) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const ext = (filename.match(/\.(\w+)$/) || [])[1]?.toLowerCase() || '';
  const label = FILE_KINDS[ext] || ext.toUpperCase() || 'File';
  const { toast } = await import('./ui.js');
  const done = (res) => {
    if (res && !opts.quiet) {
      const where = res.path ? ` vào ${res.path}` : '';
      const reveal = res.path && window.pywebview?.api?.reveal_file ? { label: 'Mở thư mục', onClick: () => window.pywebview.api.reveal_file(res.path) } : null;
      toast(`Đã lưu ${res.name}${where}.${opts.note ? ` ${opts.note}` : ''}`, opts.note ? 6000 : 4000, 'ok', reveal);
    }
    return res;
  };
  // Bản desktop (pywebview chặn tải xuống của trang): ghi file qua Python sau hộp thoại "Lưu thành".
  if (window.pywebview?.api?.save_file) {
    try {
      const path = await window.pywebview.api.save_file(filename, await blobToBase64(blob), label);
      if (!path) return null;
      return done({ name: path.split(/[\\/]/).pop(), path });
    } catch (e) {
      toast(`Không lưu được file: ${e?.message || e}`, 5000, 'err');
      return null;
    }
  }
  if (window.showSaveFilePicker) {
    try {
      const type = (blob.type || mime).split(';')[0] || 'application/octet-stream';
      const handle = await window.showSaveFilePicker({ suggestedName: filename, types: ext ? [{ description: label, accept: { [type]: [`.${ext}`] } }] : undefined });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return done({ name: handle.name });
    } catch (e) {
      if (e?.name === 'AbortError') return null;
      // Mất "user activation" hoặc kiểu MIME không hợp lệ: rơi về tải xuống thường.
    }
  }
  anchorDownload(filename, blob);
  return done({ name: filename });
}

// Chữ Kirin hay bị mô hình chen vào giữa từ Latin, đổi về chữ Latin tương ứng.
const CYR2LAT = { а: 'a', в: 'v', е: 'e', ё: 'e', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', б: 'b', г: 'g', д: 'd', ж: 'z', ш: 's', щ: 's', ы: 'y', э: 'e', ю: 'u', я: 'a' };
/** Sửa từ Latin bị lẫn chữ Kirin (chỉ sửa từ có cả chữ Latin lẫn Kirin, không đụng văn bản tiếng Nga thật). */
export function fixMixedScript(text) {
  return String(text ?? '').replace(/[\p{L}\p{M}]+/gu, (w) => {
    if (!/[Ѐ-ӿ]/.test(w) || !/[A-Za-zÀ-ɏḀ-ỿ]/.test(w)) return w;
    return w.replace(/[\u0400-\u04FF]/g, (ch) => {
      const lower = ch.toLowerCase();
      const lat = CYR2LAT[lower] || '';
      return ch === lower ? lat : lat.toUpperCase();
    });
  });
}

export function asArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => x != null && x !== '');
  return [v];
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function parseArxivId(s) {
  const str = String(s || '').trim();
  const m = str.match(/arxiv\.org\/(?:abs|pdf|html)\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?|[a-z-]+\/\d{7}(?:v\d+)?)/i)
    || str.match(/^(?:arxiv:)?([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)$/i);
  return m ? m[1] : '';
}

export function bytesToBase64(bytes) {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const STATUS_LABEL = { 'to-read': 'Chưa đọc', reading: 'Đang đọc', done: 'Đã đọc' };
export const STATUS_ORDER = ['to-read', 'reading', 'done'];

/** Chuỗi tìm kiếm không dấu, chữ thường. */
export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
}

/** Đọc dữ liệu từ query string của hash (#/route?a=1&b=2). */
export function hashQuery() {
  const i = location.hash.indexOf('?');
  return new URLSearchParams(i >= 0 ? location.hash.slice(i + 1) : '');
}

export function stars(n) {
  const v = Math.max(0, Math.min(5, Number(n) || 0));
  return '★'.repeat(v) + '☆'.repeat(5 - v);
}

export function copyText(text) {
  return navigator.clipboard.writeText(text);
}
