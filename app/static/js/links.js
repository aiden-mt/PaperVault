// Lọc link / ID paper từ văn bản bất kỳ: email, reading list, Markdown, HTML, BibTeX, trang web copy về.
import { parseReferences, lookupQuery } from './bib.js';

const PAPER_DOMAINS = [
  'arxiv.org', 'openreview.net', 'aclanthology.org', 'doi.org', 'dl.acm.org', 'ieeexplore.ieee.org', 'link.springer.com',
  'sciencedirect.com', 'proceedings.neurips.cc', 'papers.nips.cc', 'neurips.cc', 'openaccess.thecvf.com', 'proceedings.mlr.press',
  'jmlr.org', 'aaai.org', 'ojs.aaai.org', 'ijcai.org', 'ecva.net', 'semanticscholar.org', 'biorxiv.org', 'medrxiv.org',
  'nature.com', 'science.org', 'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'mdpi.com', 'frontiersin.org', 'wiley.com',
  'tandfonline.com', 'iopscience.iop.org', 'researchgate.net', 'ssrn.com', 'isca-archive.org', 'isca-speech.org',
  'cv-foundation.org', 'bmva.org', 'bmvc2022.org', 'mlr.press', 'acm.org', 'springer.com', 'elsevier.com', 'plos.org',
  'techrxiv.org', 'hal.science', 'hal.archives-ouvertes.fr', 'scholar.archive.org', 'europepmc.org', 'jstor.org',
];
const NON_PAPER_DOMAINS = [
  'github.com', 'gitlab.com', 'twitter.com', 'x.com', 'youtube.com', 'youtu.be', 'linkedin.com', 'facebook.com',
  'medium.com', 'reddit.com', 'google.com', 'docs.google.com', 'drive.google.com', 'kaggle.com', 'wikipedia.org',
  'notion.so', 'discord.gg', 'slack.com', 'zoom.us', 'bit.ly', 'instagram.com', 't.co',
];

const ARXIV_NEW = /(?<![\d.\/])(\d{4}\.\d{4,5})(v\d+)?(?![\d])/g;
const ARXIV_OLD = /\b((?:cs|math|stat|physics|eess|q-bio|q-fin|econ|astro-ph|cond-mat|hep-[a-z]+|nlin|quant-ph)(?:\.[A-Z]{2})?\/\d{7})(v\d+)?\b/g;
const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>]+)/gi;
const URL_RE = /\bhttps?:\/\/[^\s"'<>\])}]+/gi;

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; }
}
const onDomain = (host, list) => list.some((d) => host === d || host.endsWith(`.${d}`));

function cleanDoi(d) {
  let s = d.replace(/[.,;:]+$/, '');
  // bỏ ngoặc đóng thừa ở cuối (DOI có thể chứa ngoặc cân bằng)
  while (s.endsWith(')') && (s.match(/\(/g) || []).length < (s.match(/\)/g) || []).length) s = s.slice(0, -1);
  s = s.replace(/\/(full|abstract|pdf|epdf)$/i, '');
  return s;
}

function cleanUrl(u) {
  let s = u.replace(/[.,;:!?]+$/, '');
  while (s.endsWith(')') && (s.match(/\(/g) || []).length < (s.match(/\)/g) || []).length) s = s.slice(0, -1);
  try {
    const url = new URL(s);
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|source$)/i.test(k)) url.searchParams.delete(k);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch (_) { return s; }
}

/** Chuẩn hoá một URL đã biết về dạng truy vấn tốt nhất (arXiv ID, DOI, link OpenReview...). */
function classifyUrl(u) {
  const host = hostOf(u);
  let m;
  if ((m = u.match(/arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i))) return { kind: 'arxiv', query: m[1], key: `arxiv:${m[1]}` };
  if ((m = u.match(/(?:huggingface\.co\/papers|alphaxiv\.org\/(?:abs|overview)|arxiv-sanity[^/]*\/abs|scholar-inbox\.com\/papers|paperswithcode\.com\/paper\/arxiv)\/(\d{4}\.\d{4,5})/i))) return { kind: 'arxiv', query: m[1], key: `arxiv:${m[1]}` };
  if ((m = u.match(/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/.+)$/i))) { const d = cleanDoi(decodeURIComponent(m[1])); return { kind: 'doi', query: d, key: `doi:${d.toLowerCase()}` }; }
  if ((m = u.match(/(?:dl\.acm\.org|onlinelibrary\.wiley\.com|tandfonline\.com|journals\.sagepub\.com)\/doi\/(?:abs\/|full\/|pdf\/|epdf\/)?(10\.\d{4,9}\/[^?#]+)/i))) { const d = cleanDoi(decodeURIComponent(m[1])); return { kind: 'doi', query: d, key: `doi:${d.toLowerCase()}` }; }
  if ((m = u.match(/openreview\.net\/(?:forum|pdf|attachment)\?id=([A-Za-z0-9_\-]+)/i))) return { kind: 'openreview', query: `https://openreview.net/forum?id=${m[1]}`, key: `or:${m[1]}` };
  if ((m = u.match(/aclanthology\.org\/([A-Z0-9][A-Za-z0-9.\-]+?)(?:\.pdf)?\/?$/i))) return { kind: 'acl', query: `https://aclanthology.org/${m[1]}`, key: `acl:${m[1].toLowerCase()}` };
  if (/\.pdf($|\?)/i.test(u)) return { kind: 'pdf-url', query: u, key: `url:${u.toLowerCase()}` };
  if (onDomain(host, NON_PAPER_DOMAINS)) return { kind: 'other-url', query: u, key: `url:${u.toLowerCase()}` };
  if (onDomain(host, PAPER_DOMAINS)) return { kind: 'paper-url', query: u, key: `url:${u.toLowerCase()}` };
  return { kind: 'other-url', query: u, key: `url:${u.toLowerCase()}` };
}

export const LINK_KIND_LABEL = {
  arxiv: 'arXiv', doi: 'DOI', openreview: 'OpenReview', acl: 'ACL Anthology', 'pdf-url': 'Link PDF',
  'paper-url': 'Trang paper', 'other-url': 'Link khác', bib: 'BibTeX/RIS', title: 'Tiêu đề',
};

/**
 * Lọc văn bản -> danh sách mục { kind, query, key, label, title? }.
 * options.titleLines: coi các dòng không có link (đủ dài, giống tiêu đề) là tiêu đề paper cần tìm.
 */
export function extractLinks(text, { titleLines = false } = {}) {
  const src = String(text || '');
  const out = [];
  const seen = new Set();
  const push = (item) => {
    if (!item || seen.has(item.key)) return;
    seen.add(item.key);
    out.push(item);
  };

  // 1) BibTeX / RIS nhúng trong văn bản
  if (/@\w+\s*[{(]/.test(src) || /^TY\s{2}-/m.test(src)) {
    for (const e of parseReferences(src)) {
      const q = lookupQuery(e);
      const c = q ? (q.startsWith('http') ? classifyUrl(q) : (/^10\./.test(q) ? { kind: 'doi', query: q, key: `doi:${q.toLowerCase()}` } : { kind: 'arxiv', query: q, key: `arxiv:${q.replace(/v\d+$/, '')}` })) : null;
      push({ ...(c || { kind: 'title', query: '', key: `title:${e.title.toLowerCase()}` }), label: e.title, title: e.title, fromBib: true, entry: e });
    }
  }

  // 2) URL
  const urlSpans = [];
  for (const m of src.matchAll(URL_RE)) {
    const u = cleanUrl(m[0]);
    urlSpans.push([m.index, m.index + m[0].length]);
    push({ ...classifyUrl(u), label: u });
  }
  const outsideUrls = (idx) => !urlSpans.some(([a, b]) => idx >= a && idx < b);

  // 3) DOI trần (doi: 10.xxx/yyy)
  for (const m of src.matchAll(DOI_RE)) {
    if (!outsideUrls(m.index)) continue;
    const d = cleanDoi(m[1]);
    push({ kind: 'doi', query: d, key: `doi:${d.toLowerCase()}`, label: d });
  }

  // 4) arXiv ID trần (arXiv:2401.12345, 2401.12345v2, cs/0501001)
  for (const m of src.matchAll(ARXIV_NEW)) {
    if (!outsideUrls(m.index)) continue;
    const id = m[1];
    const [yy, mm] = [Number(id.slice(0, 2)), Number(id.slice(2, 4))];
    if (mm < 1 || mm > 12 || yy < 7) continue; // loại số như 2024.12345 không phải ID
    const before = src.slice(Math.max(0, m.index - 12), m.index);
    if (/10\.\d*\/?[^\s]*$/.test(before)) continue; // nằm trong DOI
    push({ kind: 'arxiv', query: id, key: `arxiv:${id}`, label: `arXiv:${id}${m[2] || ''}` });
  }
  for (const m of src.matchAll(ARXIV_OLD)) {
    if (!outsideUrls(m.index)) continue;
    push({ kind: 'arxiv', query: m[1], key: `arxiv:${m[1]}`, label: `arXiv:${m[1]}` });
  }

  // 5) dòng không có link -> tiêu đề (tuỳ chọn)
  if (titleLines) {
    for (const raw of src.split(/\r?\n/)) {
      const line = raw.replace(/^\s*(?:[-*•>]|\d+[.)])\s*/, '').replace(/\*\*|__|`/g, '').trim();
      if (!line || URL_RE.test(line) || DOI_RE.test(line) || /\d{4}\.\d{4,5}/.test(line)) { URL_RE.lastIndex = 0; DOI_RE.lastIndex = 0; continue; }
      URL_RE.lastIndex = 0; DOI_RE.lastIndex = 0;
      const words = line.split(/\s+/);
      if (words.length < 4 || words.length > 30 || line.length > 250 || /^@|^[A-Z]{2}\s{2}-/.test(line) || /[{}=]/.test(line)) continue;
      // bỏ câu thường trong email / ghi chú: lời chào, câu dẫn kết thúc bằng dấu hai chấm hoặc câu hỏi
      if (/[:?!]$/.test(line) || /^(hi|hello|hey|dear|thanks|thank you|regards|best|cheers|chào|xin chào|cảm ơn|thân|nhờ|mọi người|anh|chị|em)(?=[\s,.!]|$)/i.test(line)) continue;
      const t = line.replace(/\s*[\[(]?(19|20)\d{2}[\])]?\.?$/, '').replace(/[.。]$/, '');
      push({ kind: 'title', query: '', key: `title:${t.toLowerCase()}`, label: t, title: t });
    }
  }
  return out;
}

/** Tìm arXiv ID / DOI / tiêu đề trong phần đầu text trích từ PDF. */
export function identifyFromPdfText(text) {
  const head = String(text || '').slice(0, 6000);
  const out = { arxivId: '', doi: '', title: '' };
  let m = head.match(/arXiv:\s*(\d{4}\.\d{4,5})(v\d+)?/i) || head.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i);
  if (m) out.arxivId = m[1];
  m = head.match(/\b(10\.\d{4,9}\/[^\s"'<>]+)/);
  if (m) out.doi = cleanDoi(m[1]);
  const lines = head.split(/\n+/).map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
  // tiêu đề thường nằm trước dòng "Abstract"; bỏ nhãn hình, số liệu, dòng tác giả/đơn vị
  const absAt = lines.findIndex((l) => /^abstract\b/i.test(l));
  const zone = lines.slice(0, absAt > 0 ? absAt : 25);
  for (const l of zone) {
    const words = l.split(' ');
    const letters = (l.match(/\p{L}/gu) || []).length;
    if (l.length < 10 || l.length > 220 || words.length < 2) continue;
    if (letters / l.length < 0.75 || /[%=<>@©]|\d{3,}/.test(l)) continue;
    if (/arxiv|preprint|proceedings|conference|journal|copyright|licen[sc]e|university|institute|department|http|abstract|correspond|equal contribution|submitted|accepted|under review|technical report|workshop|github/i.test(l)) continue;
    if (l === l.toLowerCase()) continue;
    out.title = l;
    break;
  }
  return out;
}
