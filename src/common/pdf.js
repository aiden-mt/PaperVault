// Xử lý PDF: đọc file thành base64 (gửi thẳng cho model) và trích text cục bộ (fallback).
// Bộ trích text là heuristic tự viết, không dùng thư viện ngoài: đủ tốt cho phần lớn
// paper LaTeX, nhưng có thể ra ký tự lạ với font CID không kèm ToUnicode.

const BS = String.fromCharCode(92); // dấu gạch chéo ngược

/* ------------------------- Chuyển đổi cơ bản ------------------------- */

export function bytesToBase64(bytes) {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Chuỗi latin-1 chuẩn xác theo từng byte (TextDecoder('latin1') thực chất là windows-1252). */
function bytesToLatin1(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return s;
}

export async function readFile(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length < 5 || bytesToLatin1(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('File này không phải PDF hợp lệ.');
  }
  return bytes;
}

/* ------------------------- Giải nén stream ------------------------- */

async function inflateStrict(bytes, format) {
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (_) {
    return null;
  }
}

/** Giữ lại phần đã giải nén được khi stream bị hỏng hoặc /Length sai. */
async function inflatePartial(bytes, format) {
  let ds;
  try { ds = new DecompressionStream(format); } catch (_) { return null; }
  const writer = ds.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } catch (_) { /* dùng phần đã đọc được */ }
  if (!total) return null;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

async function inflate(bytes) {
  // Hầu hết PDF có thêm ký tự xuống dòng trước 'endstream'; byte thừa này
  // khiến DecompressionStream báo lỗi, nên phải cắt trước khi giải nén.
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d
    || bytes[end - 1] === 0x20 || bytes[end - 1] === 0x09)) end--;

  for (const candidate of [bytes.subarray(0, end), bytes]) {
    for (const format of ['deflate', 'deflate-raw']) {
      const out = await inflateStrict(candidate, format);
      if (out) return out;
    }
  }
  for (const format of ['deflate', 'deflate-raw']) {
    const out = await inflatePartial(bytes.subarray(0, end), format);
    if (out) return out;
  }
  return null;
}

/* ------------------------- Phân tích cấu trúc ------------------------- */

/** Quét tuần tự các object "N G obj ... endobj" (không cần xref). */
function scanObjects(latin1) {
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(latin1))) {
    const num = Number(m[1]);
    const start = m.index + m[0].length;
    const end = latin1.indexOf('endobj', start);
    if (end === -1) continue;
    objs.set(num, { num, start, end, body: latin1.slice(start, Math.min(end, start + 4000)) });
    re.lastIndex = end;
  }
  return objs;
}

/** Lấy vùng byte của stream trong một object, kèm dict phía trước. */
function streamRange(latin1, obj) {
  const sIdx = latin1.indexOf('stream', obj.start);
  if (sIdx === -1 || sIdx > obj.end) return null;
  const dict = latin1.slice(obj.start, sIdx);
  let dataStart = sIdx + 6;
  if (latin1[dataStart] === '\r') dataStart++;
  if (latin1[dataStart] === '\n') dataStart++;
  const eIdx = latin1.indexOf('endstream', dataStart);
  if (eIdx === -1) return null;
  return { dict, from: dataStart, to: eIdx };
}

async function decodeStream(bytes, latin1, obj) {
  const r = streamRange(latin1, obj);
  if (!r) return null;
  const raw = bytes.subarray(r.from, r.to);
  if (/\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode|\/JBIG2Decode/.test(r.dict)) return null; // ảnh
  if (/\/FlateDecode/.test(r.dict)) {
    const out = await inflate(raw);
    return out ? { dict: r.dict, text: bytesToLatin1(out) } : null;
  }
  if (/\/Filter/.test(r.dict)) return null; // LZW, RunLength... bỏ qua
  return { dict: r.dict, text: bytesToLatin1(raw) };
}

/* ------------------------- CMap /ToUnicode ------------------------- */

function hexToUnicode(hex) {
  let out = '';
  for (let i = 0; i + 3 < hex.length + 1; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    if (!Number.isNaN(code)) out += String.fromCharCode(code);
  }
  return out;
}

function parseCMap(text) {
  const map = new Map();

  const charRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let m;
  while ((m = charRe.exec(text))) {
    const pairRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let p;
    while ((p = pairRe.exec(m[1]))) map.set(parseInt(p[1], 16), hexToUnicode(p[2]));
  }

  const rangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = rangeRe.exec(text))) {
    const body = m[1];
    const simple = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let r;
    while ((r = simple.exec(body))) {
      const lo = parseInt(r[1], 16);
      const hi = Math.min(parseInt(r[2], 16), lo + 65535);
      const dst = parseInt(r[3], 16);
      for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(dst + (c - lo)));
    }
    const arrayForm = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g;
    while ((r = arrayForm.exec(body))) {
      const lo = parseInt(r[1], 16);
      const items = r[3].match(/<([0-9A-Fa-f]+)>/g) || [];
      items.forEach((it, i) => map.set(lo + i, hexToUnicode(it.slice(1, -1))));
    }
  }
  return map;
}

/* ------------------------- Trích text ------------------------- */

function decodeLiteral(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== BS) { out += s[i]; continue; }
    const c = s[++i];
    if (c === 'n') out += '\n';
    else if (c === 'r') out += '\r';
    else if (c === 't') out += '\t';
    else if (c === 'b' || c === 'f') out += ' ';
    else if (c >= '0' && c <= '7') {
      let oct = c;
      while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else if (c === '\n') { /* nối dòng */ }
    else out += c;
  }
  return out;
}

/** Đọc chuỗi literal bắt đầu tại vị trí dấu '(' , trả về [nội dung, vị trí kế tiếp]. */
function readLiteral(src, i) {
  let depth = 1;
  let out = '';
  i++;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === BS) { out += c + (src[i + 1] || ''); i += 2; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (!depth) break; }
    out += c;
    i++;
  }
  return [out, i + 1];
}

function mapCodes(str, cmap, twoByte) {
  if (!cmap || !cmap.size) return str;
  let out = '';
  if (twoByte) {
    for (let i = 0; i + 1 < str.length; i += 2) {
      const code = (str.charCodeAt(i) << 8) | str.charCodeAt(i + 1);
      out += cmap.get(code) ?? '';
    }
  } else {
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      out += cmap.get(code) ?? str[i];
    }
  }
  return out;
}

/** Duyệt content stream, ghép text theo các toán tử Tj / TJ / ' / ". */
function extractFromContent(content, fontMaps) {
  const parts = [];
  let stack = [];       // toán hạng gần nhất
  let curFont = null;
  let pendingHex = false;
  let i = 0;

  const cmapFor = () => fontMaps.get(curFont) || null;

  while (i < content.length) {
    const c = content[i];

    if (c === '(') {
      const [raw, next] = readLiteral(content, i);
      stack.push({ type: 'str', value: decodeLiteral(raw), hex: false });
      i = next;
      continue;
    }
    if (c === '<' && content[i + 1] !== '<') {
      const end = content.indexOf('>', i);
      if (end === -1) break;
      const hex = content.slice(i + 1, end).replace(/[^0-9A-Fa-f]/g, '');
      let s = '';
      for (let k = 0; k + 1 < hex.length; k += 2) s += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
      if (hex.length % 2) s += String.fromCharCode(parseInt(hex[hex.length - 1] + '0', 16));
      stack.push({ type: 'str', value: s, hex: true });
      pendingHex = true;
      i = end + 1;
      continue;
    }
    if (c === '[' || c === ']') { stack.push({ type: 'punct', value: c }); i++; continue; }

    // token
    const m = /^[^\s\[\]()<>/]+|^\/[^\s\[\]()<>/]*/.exec(content.slice(i));
    if (!m) { i++; continue; }
    const tok = m[0];
    i += tok.length;

    if (tok.startsWith('/')) { stack.push({ type: 'name', value: tok.slice(1) }); continue; }
    if (/^-?[\d.]+$/.test(tok)) { stack.push({ type: 'num', value: Number(tok) }); continue; }

    switch (tok) {
      case 'Tf': {
        const name = [...stack].reverse().find((x) => x.type === 'name');
        if (name) curFont = name.value;
        stack = [];
        break;
      }
      case 'Tj':
      case "'":
      case '"': {
        const s = [...stack].reverse().find((x) => x.type === 'str');
        if (s) parts.push(mapCodes(s.value, cmapFor(), s.hex && pendingHex));
        if (tok !== 'Tj') parts.push('\n');
        stack = [];
        break;
      }
      case 'TJ': {
        let buf = '';
        for (const item of stack) {
          if (item.type === 'str') buf += mapCodes(item.value, cmapFor(), item.hex);
          else if (item.type === 'num' && item.value < -120) buf += ' ';
        }
        parts.push(buf);
        stack = [];
        break;
      }
      case 'Td': case 'TD': case 'T*': case 'Tm':
        parts.push('\n');
        stack = [];
        break;
      case 'ET':
        parts.push('\n');
        stack = [];
        break;
      default:
        stack = [];
    }
    if (stack.length > 64) stack = stack.slice(-16);
  }
  return parts.join('');
}

function tidy(text) {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/-\n([a-z])/g, '$1')       // nối từ bị gạch nối cuối dòng
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n +/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, idx, arr) => l || arr[idx - 1])
    .join('\n')
    .trim();
}

/** Tỉ lệ ký tự "đọc được" — dùng để cảnh báo khi font không có ToUnicode. */
function readableRatio(text) {
  if (!text) return 0;
  const sample = text.slice(0, 6000);
  let good = 0;
  for (const ch of sample) {
    const c = ch.codePointAt(0);
    if ((c >= 32 && c < 127) || c === 10 || (c >= 0x00c0 && c <= 0x024f)) good++;
  }
  return good / sample.length;
}

/**
 * Trích text từ PDF.
 * Trả về { text, pages, readable, ratio }.
 */
export async function extractPdfText(bytes) {
  const latin1 = bytesToLatin1(bytes);
  const objs = scanObjects(latin1);
  const pages = (latin1.match(/\/Type\s*\/Page[^s]/g) || []).length || undefined;

  // 1) Giải nén mọi stream ứng viên
  const decoded = new Map();
  for (const obj of objs.values()) {
    const d = await decodeStream(bytes, latin1, obj);
    if (d) decoded.set(obj.num, d);
  }

  // 2) Bản đồ font -> CMap: /Font << /F13 12 0 R >> ; object 12 có /ToUnicode 13 0 R
  const toUnicodeOf = new Map();  // objNum của font -> objNum của CMap
  for (const obj of objs.values()) {
    const mm = obj.body.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    if (mm) toUnicodeOf.set(obj.num, Number(mm[1]));
  }
  const fontMaps = new Map();     // tên font (/F13) -> Map<code, char>
  const fontDictRe = /\/Font\s*<<([\s\S]*?)>>/g;
  let fm;
  while ((fm = fontDictRe.exec(latin1))) {
    const refRe = /\/([A-Za-z0-9_.#-]+)\s+(\d+)\s+\d+\s+R/g;
    let ref;
    while ((ref = refRe.exec(fm[1]))) {
      const cmapObj = toUnicodeOf.get(Number(ref[2]));
      if (cmapObj == null) continue;
      const stream = decoded.get(cmapObj);
      if (!stream) continue;
      if (!fontMaps.has(ref[1])) fontMaps.set(ref[1], parseCMap(stream.text));
    }
  }

  // 3) Ghép text từ các content stream
  const chunks = [];
  for (const [, d] of decoded) {
    if (!/BT[\s\S]{0,4000}?(Tj|TJ)/.test(d.text)) continue;
    if (/beginbfchar|beginbfrange|\/Type\s*\/Font/.test(d.text)) continue;
    chunks.push(extractFromContent(d.text, fontMaps));
  }

  const text = tidy(chunks.join('\n'));
  const ratio = readableRatio(text);
  return { text, pages, ratio, readable: text.length > 400 && ratio > 0.85 };
}

/** Số trang ước lượng nhanh, không cần giải nén. */
export function estimatePages(bytes) {
  const head = bytesToLatin1(bytes);
  const m = head.match(/\/Count\s+(\d+)/);
  if (m) return Number(m[1]);
  return (head.match(/\/Type\s*\/Page[^s]/g) || []).length || undefined;
}
