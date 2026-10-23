// Đọc file BibTeX (.bib) và RIS (.ris) từ Zotero / Mendeley / Google Scholar thành danh sách mục chuẩn hoá.
// Mỗi mục: { key, type, title, authors: [], year, venue, doi, arxivId, url, abstract }

import { parseArxivId } from './util.js';

const LATEX_MAP = { "\\'e": 'é', '\\"u': 'ü', '\\"o': 'ö', '\\"a': 'ä', "\\'a": 'á', '\\~n': 'ñ', '\\c{c}': 'ç', '\\&': '&', '--': '–', '---': '—', '~': ' ' };

function cleanLatex(s) {
  let t = String(s || '');
  for (const [k, v] of Object.entries(LATEX_MAP)) t = t.split(k).join(v);
  return t.replace(/[{}]/g, '').replace(/\\[a-zA-Z]+/g, '').replace(/\s+/g, ' ').trim();
}

function splitAuthors(s) {
  return cleanLatex(s).split(/\s+and\s+/i).map((a) => {
    const t = a.trim();
    if (t.includes(',')) { const [last, first] = t.split(',').map((x) => x.trim()); return `${first} ${last}`.trim(); }
    return t;
  }).filter(Boolean);
}

/** Đọc một giá trị trường: {…} lồng nhau, "…" hoặc số/chuỗi trần. Trả về [value, vị trí kết thúc]. */
function readValue(src, i) {
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] === '{') {
    let depth = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) break; }
    }
    return [src.slice(i + 1, j), j + 1];
  }
  if (src[i] === '"') {
    let j = i + 1;
    while (j < src.length && src[j] !== '"') { if (src[j] === '\\') j++; j++; }
    return [src.slice(i + 1, j), j + 1];
  }
  let j = i;
  while (j < src.length && !/[,}\n]/.test(src[j])) j++;
  return [src.slice(i, j).trim(), j];
}

export function parseBibtex(text) {
  const src = String(text || '').replace(/\r/g, '');
  const entries = [];
  const re = /@(\w+)\s*[{(]\s*([^,\s]*)\s*,/g;
  let m;
  while ((m = re.exec(src))) {
    const type = m[1].toLowerCase();
    if (['comment', 'preamble', 'string'].includes(type)) continue;
    const fields = {};
    let i = re.lastIndex;
    for (;;) {
      while (i < src.length && /[\s,]/.test(src[i])) i++;
      if (i >= src.length || src[i] === '}' || src[i] === ')') break;
      const nm = src.slice(i).match(/^([\w-]+)\s*=/);
      if (!nm) break;
      i += nm[0].length;
      const [val, next] = readValue(src, i);
      fields[nm[1].toLowerCase()] = val;
      i = next;
    }
    re.lastIndex = i;
    const doi = cleanLatex(fields.doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    const eprint = cleanLatex(fields.eprint || '');
    const url = cleanLatex(fields.url || fields.howpublished || '');
    const arxivId = parseArxivId(url) || (/^\d{4}\.\d{4,5}/.test(eprint) ? eprint : '') || parseArxivId(cleanLatex(fields.journal || '')) || parseArxivId(cleanLatex(fields.note || ''));
    entries.push({
      key: m[2], type,
      title: cleanLatex(fields.title),
      authors: splitAuthors(fields.author || ''),
      year: cleanLatex(fields.year).slice(0, 4),
      venue: cleanLatex(fields.booktitle || fields.journal || fields.publisher || ''),
      doi, arxivId, url: /^https?:/.test(url) ? url : (arxivId ? `https://arxiv.org/abs/${arxivId}` : (doi ? `https://doi.org/${doi}` : '')),
      abstract: cleanLatex(fields.abstract || ''),
      keywords: cleanLatex(fields.keywords || '').split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean),
    });
  }
  return entries.filter((e) => e.title);
}

export function parseRis(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const entries = [];
  let cur = null;
  const push = () => { if (cur && cur.title) entries.push(cur); cur = null; };
  for (const line of lines) {
    const m = line.match(/^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/);
    if (!m) continue;
    const [, tag, v] = m;
    const val = v.trim();
    if (tag === 'TY') { push(); cur = { key: '', type: val.toLowerCase(), title: '', authors: [], year: '', venue: '', doi: '', arxivId: '', url: '', abstract: '', keywords: [] }; continue; }
    if (!cur) continue;
    if (tag === 'ER') { push(); continue; }
    if (tag === 'TI' || tag === 'T1') cur.title = cur.title || val;
    else if (tag === 'AU' || tag === 'A1') cur.authors.push(val.includes(',') ? val.split(',').reverse().map((x) => x.trim()).join(' ') : val);
    else if (tag === 'PY' || tag === 'Y1') cur.year = cur.year || val.slice(0, 4);
    else if (tag === 'DO') cur.doi = val.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    else if (tag === 'UR' || tag === 'L1' || tag === 'L2') { if (!cur.url) cur.url = val; if (!cur.arxivId) cur.arxivId = parseArxivId(val); }
    else if (tag === 'JO' || tag === 'T2' || tag === 'JF' || tag === 'BT') cur.venue = cur.venue || val;
    else if (tag === 'AB' || tag === 'N2') cur.abstract = cur.abstract || val;
    else if (tag === 'KW') cur.keywords.push(val.toLowerCase());
    else if (tag === 'ID') cur.key = val;
  }
  push();
  for (const e of entries) if (!e.url) e.url = e.arxivId ? `https://arxiv.org/abs/${e.arxivId}` : (e.doi ? `https://doi.org/${e.doi}` : '');
  return entries;
}

/** CSL JSON (Zotero, Mendeley, Paperpile… "Export → CSL JSON"): mảng các mục { title, author: [{ family, given }], issued… }. */
export function parseCslJson(text) {
  let data;
  try { data = JSON.parse(text); } catch (_) { return []; }
  const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [data];
  return list.filter((x) => x && typeof x === 'object' && x.title).map((x) => {
    const doi = String(x.DOI || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    const url = String(x.URL || '');
    const arxivId = parseArxivId(url) || parseArxivId(String(x.number || '')) || parseArxivId(String(x.note || ''));
    const year = String(x.issued?.['date-parts']?.[0]?.[0] || x.issued?.raw || '').slice(0, 4);
    return {
      key: String(x.id || x['citation-key'] || ''), type: String(x.type || ''),
      title: String(x.title).trim(),
      authors: (x.author || []).map((a) => a.literal || [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean),
      year, venue: String(x['container-title'] || x['event-title'] || x.publisher || ''),
      doi, arxivId, url: /^https?:/.test(url) ? url : (arxivId ? `https://arxiv.org/abs/${arxivId}` : (doi ? `https://doi.org/${doi}` : '')),
      abstract: String(x.abstract || ''),
      keywords: String(x.keyword || '').split(/[,;]/).map((k) => k.trim().toLowerCase()).filter(Boolean),
    };
  });
}

/** Đoán định dạng theo nội dung rồi parse. */
export function parseReferences(text, filename = '') {
  const t = String(text || '');
  if (/\.json$/i.test(filename) || /^\s*[[{]/.test(t)) return parseCslJson(t);
  if (/\.ris$/i.test(filename) || /^TY\s{2}-/m.test(t)) return parseRis(t);
  return parseBibtex(t);
}

/** Chuỗi tra cứu tốt nhất cho một mục: DOI > arXiv > URL > tiêu đề. */
export function lookupQuery(entry) {
  if (entry.arxivId) return entry.arxivId;
  if (entry.doi) return entry.doi;
  if (entry.url && /^https?:/.test(entry.url)) return entry.url;
  return '';
}
