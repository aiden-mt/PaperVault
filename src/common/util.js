// Tiện ích dùng chung cho toàn extension.

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
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
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

export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function asArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => x != null && x !== '');
  return [v];
}
