// Tạo file Word .docx thật (Office Open XML) từ HTML đơn giản, không cần thư viện ngoài.
// Hỗ trợ: h1-h3, p, b/strong, i/em, u, a, code, sup/sub, br, ul/ol (lồng nhau), blockquote, table (th, colspan),
// img (qua htmlToDocxWithImages: tải ảnh trước rồi nhúng vào file).
// File zip được ghi kiểu "stored" (không nén), Word / LibreOffice / Google Docs đều mở được.

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const xml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // Ký tự điều khiển không hợp lệ trong XML.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const INLINE = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'A', 'SPAN', 'CODE', 'SUP', 'SUB', 'BR', 'SMALL', 'MARK', 'S', 'DEL', 'FONT', 'KBD', 'IMG']);

/* ---------------------------------------------------------------- chuyển HTML -> WordprocessingML */

function makeConverter(textWidth, images = null) {
  let pics = 0;
  // Ảnh nằm trong dòng; rộng quá khổ giấy thì thu nhỏ cho vừa (1 px = 9525 EMU, 1 twip = 635 EMU).
  function drawing(im) {
    const maxEmu = textWidth * 635;
    let cx = Math.round(im.w * 9525);
    let cy = Math.round(im.h * 9525);
    if (cx > maxEmu) { cy = Math.round(cy * maxEmu / cx); cx = maxEmu; }
    const id = ++pics;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/>`
      + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="${im.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
      + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }
  const nums = []; // [{ id, ordered }]
  const newNum = (ordered) => { const id = nums.length + 1; nums.push({ id, ordered }); return id; };

  function run(text, f) {
    const pr = [
      f.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : '',
      f.bold ? '<w:b/><w:bCs/>' : '', f.italic ? '<w:i/><w:iCs/>' : '', f.strike ? '<w:strike/>' : '',
      f.link ? '<w:color w:val="2F5496"/>' : (f.color ? `<w:color w:val="${f.color}"/>` : ''),
      f.underline || f.link ? '<w:u w:val="single"/>' : '',
      f.size ? `<w:sz w:val="${f.size}"/><w:szCs w:val="${f.size}"/>` : '',
      f.vert ? `<w:vertAlign w:val="${f.vert}"/>` : '',
    ].join('');
    return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
  }

  function runs(nodes, f, state) {
    let out = '';
    for (const n of nodes) {
      if (n.nodeType === 3) {
        let t = n.textContent.replace(/\s+/g, ' ');
        if (state.atStart) t = t.replace(/^ /, '');
        if (!t) continue;
        state.atStart = /\s$/.test(t);
        out += run(t, f);
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (tag === 'BR') { out += '<w:r><w:br/></w:r>'; state.atStart = true; continue; }
      if (tag === 'IMG') {
        const im = images?.get(n.getAttribute('src') || '');
        if (im) out += drawing(im);
        else if (n.getAttribute('alt')) out += run(`[${n.getAttribute('alt')}]`, { ...f, italic: true });
        state.atStart = false;
        continue;
      }
      const g = { ...f };
      if (tag === 'B' || tag === 'STRONG') g.bold = true;
      if (tag === 'I' || tag === 'EM') g.italic = true;
      if (tag === 'U') g.underline = true;
      if (tag === 'S' || tag === 'DEL') g.strike = true;
      if (tag === 'A') g.link = true;
      if (tag === 'CODE' || tag === 'KBD') g.code = true;
      if (tag === 'SUP') g.vert = 'superscript';
      if (tag === 'SUB') g.vert = 'subscript';
      out += runs(n.childNodes, g, state);
    }
    return out;
  }

  function para(nodes, ctx) {
    const body = runs(nodes, { bold: ctx.bold, italic: ctx.italic, size: ctx.size, color: ctx.color }, { atStart: true });
    if (!body && !ctx.keepEmpty) return '';
    const pPr = [
      ctx.style ? `<w:pStyle w:val="${ctx.style}"/>` : '',
      ctx.num ? `<w:numPr><w:ilvl w:val="${ctx.lvl || 0}"/><w:numId w:val="${ctx.num}"/></w:numPr>` : '',
      ctx.inTable ? '<w:spacing w:before="0" w:after="40" w:line="252" w:lineRule="auto"/>' : '',
    ].join('');
    return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${body}</w:p>`;
  }

  function list(el, ctx, lvl) {
    const num = newNum(el.tagName === 'OL');
    let out = '';
    for (const li of el.children) {
      if (li.tagName !== 'LI') continue;
      const inline = [];
      const nested = [];
      for (const c of li.childNodes) (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL') ? nested : inline).push(c);
      out += para(inline, { ...ctx, style: ctx.inTable ? '' : 'ListParagraph', num, lvl: Math.min(lvl, 2), keepEmpty: true });
      for (const sub of nested) out += list(sub, ctx, lvl + 1);
    }
    return out;
  }

  function table(el, ctx) {
    const rows = [...el.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr')];
    if (!rows.length) return '';
    const span = (c) => Math.max(1, parseInt(c.getAttribute('colspan') || '1', 10) || 1);
    const ncol = Math.max(...rows.map((r) => [...r.children].reduce((s, c) => s + span(c), 0)), 1);
    const fs = /font-size:\s*([\d.]+)pt/i.exec(el.getAttribute('style') || '');
    const size = fs ? Math.round(parseFloat(fs[1]) * 2) : ctx.size;
    // Cột đầu (thường là tên paper) rộng hơn một chút.
    const unit = textWidth / (ncol + (ncol > 2 ? 0.4 : 0));
    const widths = Array.from({ length: ncol }, (_, i) => Math.round(i === 0 && ncol > 2 ? unit * 1.4 : unit));
    const border = (k) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>`;
    let out = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>
      <w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="57" w:type="dxa"/><w:left w:w="85" w:type="dxa"/><w:bottom w:w="57" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar></w:tblPr>
      <w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
    for (const r of rows) {
      const cells = [...r.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
      const head = cells.length && cells.every((c) => c.tagName === 'TH');
      out += `<w:tr>${head ? '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' : ''}`;
      let col = 0;
      for (const c of cells) {
        const n = span(c);
        const w = widths.slice(col, col + n).reduce((a, b) => a + b, 0);
        col += n;
        const th = c.tagName === 'TH';
        const inner = blocks(c, { ...ctx, inTable: true, bold: th || ctx.bold, size, style: '' });
        out += `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${n > 1 ? `<w:gridSpan w:val="${n}"/>` : ''}${th ? '<w:shd w:val="clear" w:color="auto" w:fill="EDEFF5"/>' : ''}</w:tcPr>${inner || '<w:p/>'}</w:tc>`;
      }
      out += '</w:tr>';
    }
    return `${out}</w:tbl><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`;
  }

  function blocks(parent, ctx) {
    let out = '';
    let inline = [];
    const flush = () => {
      if (inline.some((n) => n.nodeType === 1 || n.textContent.trim())) out += para(inline, ctx);
      inline = [];
    };
    for (const n of parent.childNodes) {
      if (n.nodeType === 3 || (n.nodeType === 1 && INLINE.has(n.tagName))) { inline.push(n); continue; }
      if (n.nodeType !== 1) continue;
      flush();
      const tag = n.tagName;
      if (/^H[1-6]$/.test(tag)) out += para(n.childNodes, { ...ctx, style: ctx.inTable ? '' : `Heading${Math.min(3, Number(tag[1]))}`, bold: ctx.inTable || ctx.bold });
      else if (tag === 'P') out += para(n.childNodes, ctx);
      else if (tag === 'UL' || tag === 'OL') out += list(n, ctx, 0);
      else if (tag === 'BLOCKQUOTE') out += blocks(n, { ...ctx, style: ctx.inTable ? '' : 'Quote', italic: true });
      else if (tag === 'TABLE') out += table(n, ctx);
      else if (tag === 'PRE') out += n.textContent.split('\n').map((l) => `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${run(l, { code: true, size: 18 })}</w:p>`).join('');
      else if (n.classList.contains('docx-pb')) out += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; // ngắt trang
      else if (['HR', 'SCRIPT', 'STYLE', 'TITLE', 'META', 'XML'].includes(tag)) continue;
      else out += blocks(n, ctx);
    }
    flush();
    return out;
  }

  return { blocks, nums };
}

const BULLETS = ['•', '◦', '▪'];

function numberingXml(nums) {
  const lvls = (ordered) => [0, 1, 2].map((i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? (i === 1 ? 'lowerLetter' : 'decimal') : 'bullet'}"/>
    <w:lvlText w:val="${ordered ? `%${i + 1}.` : BULLETS[i]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${360 + i * 360}" w:hanging="270"/></w:pPr></w:lvl>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W_NS}>
${nums.map((n) => `<w:abstractNum w:abstractNumId="${n.id}"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(n.ordered)}</w:abstractNum>`).join('\n')}
${nums.map((n) => `<w:num w:numId="${n.id}"><w:abstractNumId w:val="${n.id}"/></w:num>`).join('\n')}
</w:numbering>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="A6A6A6"/></w:pBdr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/><w:color w:val="444444"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/><w:contextualSpacing/></w:pPr></w:style>
</w:styles>`;

/* ---------------------------------------------------------------- zip (stored) */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files, type = DOCX_MIME) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, time, true); local.setUint16(12, date, true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true); cd.setUint16(14, date, true); cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type });
}

/** Gói nhiều file thành .zip (không nén). files: [{ name: 'thư mục/tên.md', data: string | Uint8Array }]. */
export const zipBlob = (files) => zip(files, 'application/zip');

/* ---------------------------------------------------------------- API */

/**
 * HTML (một đoạn hoặc cả trang) -> Blob .docx.
 * opts.title: tiêu đề tài liệu (thuộc tính file); opts.landscape: trang A4 nằm ngang cho bảng nhiều cột.
 */
export function htmlToDocx(html, { title = 'PaperVault', landscape = false, images = null } = {}) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const [pw, ph, margin] = landscape ? [16838, 11906, 851] : [11906, 16838, 1134];
  // images: Map(src -> { data: Uint8Array, ext: 'png' | 'jpeg' | 'gif', w, h }) do htmlToDocxWithImages chuẩn bị.
  const media = [];
  const refs = new Map();
  for (const [src, im] of images || []) { const k = media.length + 1; media.push({ ...im, name: `image${k}.${im.ext}`, rid: `rIdImg${k}` }); refs.set(src, media[k - 1]); }
  const conv = makeConverter(pw - margin * 2, refs);
  const body = conv.blocks(doc.body, {}) || '<w:p/>';
  const sect = `<w:sectPr><w:pgSz w:w="${pw}" w:h="${ph}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const hasNum = conv.nums.length > 0;
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
${[...new Set(media.map((m) => m.ext))].map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('')}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
${hasNum ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : ''}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xml(title)}</dc:title><dc:creator>PaperVault</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${hasNum ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' : ''}
${media.map((m) => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('')}</Relationships>` },
    { name: 'word/styles.xml', data: STYLES },
    ...(hasNum ? [{ name: 'word/numbering.xml', data: numberingXml(conv.nums) }] : []),
    ...media.map((m) => ({ name: `word/media/${m.name}`, data: m.data })),
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${body}${sect}</w:body></w:document>` },
  ]);
}

/** Đọc ảnh về dạng Word nhúng được: PNG / JPEG / GIF giữ nguyên, định dạng khác (WebP, BMP) vẽ lại thành PNG. */
async function loadImage(src, cssWidth) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  let { width: w, height: h } = bmp;
  let data;
  let ext = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif' }[blob.type] || '';
  if (ext) data = new Uint8Array(await blob.arrayBuffer());
  else {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0);
    data = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer());
    ext = 'png';
  }
  bmp.close?.();
  if (cssWidth && cssWidth < w) { h = Math.round(h * cssWidth / w); w = cssWidth; }
  return { data, ext, w, h };
}

/** Như htmlToDocx nhưng tải và nhúng ảnh (<img src>) vào file. Ảnh không tải được thì ghi chú thích thay cho ảnh. */
export async function htmlToDocxWithImages(html, opts = {}) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const images = new Map();
  await Promise.all([...doc.querySelectorAll('img[src]')].map(async (img) => {
    const src = img.getAttribute('src');
    if (images.has(src)) return;
    const px = /width:\s*(\d+)px/.exec(img.getAttribute('style') || '');
    try { images.set(src, await loadImage(src, px ? Number(px[1]) : 0)); } catch (_) { /* bỏ qua ảnh lỗi */ }
  }));
  return htmlToDocx(html, { ...opts, images });
}
