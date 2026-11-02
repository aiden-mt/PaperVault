// Tìm paper theo tên / từ khoá ở trang Thêm paper, giống Google Scholar / Semantic Scholar. Các hàm thuần ở đây
// nhận diện chuỗi người dùng nhập, chuẩn hoá kết quả (Semantic Scholar hoặc OpenAlex), sắp xếp và so khớp với thư viện.
import { parseArxivId, norm } from './util.js';

/** Chuỗi là link / arXiv ID / DOI (tra cứu thẳng) hay là tên paper / từ khoá (cần tìm kiếm). */
export function isPaperIdentifier(q) {
  const s = String(q || '').trim();
  if (!s) return false;
  if (/^(https?:\/\/|www\.)/i.test(s)) return true;
  if (parseArxivId(s)) return true;
  if (/^(doi:\s*)?10\.\d{4,9}\/\S+$/i.test(s)) return true;
  if (/^(arxiv:)?[a-z-]+(\.[a-z]{2})?\/\d{7}(v\d+)?$/i.test(s)) return true; // arXiv kiểu cũ: cs/0601001
  // link không có http: openreview.net/forum?id=…, aclanthology.org/2024.acl-long.1
  return !/\s/.test(s) && /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S*$/i.test(s);
}

/** Một kết quả dạng bài Semantic Scholar (máy chủ đổi kết quả OpenAlex về cùng dạng) -> dạng hiển thị. */
export function searchItem(it) {
  const ext = it?.externalIds || {};
  const arxivId = String(ext.ArXiv || '').trim();
  const doi = String(ext.DOI || '').trim();
  const url = String(it?.url || '').trim();
  return {
    id: it?.paperId || arxivId || doi || url,
    title: String(it?.title || '').replace(/\s+/g, ' ').trim(),
    authors: (it?.authors || []).map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean),
    year: it?.year ? String(it.year) : '',
    date: it?.publicationDate || '',
    venue: String(it?.venue || '').trim(),
    cites: Number.isFinite(it?.citationCount) ? it.citationCount : null,
    arxivId, doi, url,
    abstract: String(it?.abstract || '').trim(),
    tldr: typeof it?.tldr === 'string' ? it.tldr : (it?.tldr?.text || ''),
    pdfUrl: it?.openAccessPdf?.url || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : ''),
    // chuỗi đưa vào ô tra cứu khi chọn bài: arXiv ID tốt nhất (có full text), rồi DOI, rồi link
    query: arxivId || doi || url,
  };
}

/** Sắp xếp kết quả: 'relevance' giữ thứ tự của máy chủ, 'cites' nhiều trích dẫn trước, 'newest' mới nhất trước. */
export function sortItems(items, mode = 'relevance') {
  const list = [...(items || [])];
  if (mode === 'cites') return list.sort((a, b) => (b.cites ?? -1) - (a.cites ?? -1));
  if (mode === 'newest') {
    const t = (x) => x.date || (x.year ? `${x.year}-00-00` : '');
    return list.sort((a, b) => t(b).localeCompare(t(a)));
  }
  return list;
}

const tokens = (s) => [...new Set(norm(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 2))];

/** Paper trong thư viện khớp mọi từ của truy vấn (tên, tác giả, nhãn, venue, arXiv ID, DOI). Khớp ở tên xếp trước. */
export function matchLibrary(papers, q, limit = 6) {
  const toks = tokens(q);
  if (!toks.length) return [];
  const whole = norm(q).replace(/\s+/g, ' ').trim();
  const rows = [];
  for (const p of papers || []) {
    if (!p || p.deletedAt) continue;
    const title = norm(p.title);
    const hay = [title, norm([].concat(p.authors || []).join(' ')), norm((p.tags || []).join(' ')), norm(p.venue), norm(p.arxivId), norm(p.doi)].join(' ');
    if (!toks.every((t) => hay.includes(t))) continue;
    rows.push({ p, score: toks.filter((t) => title.includes(t)).length * 2 + (title.includes(whole) ? 5 : 0) });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, limit).map((r) => r.p);
}

/** Kết quả tìm kiếm -> mục cho trang Hàng loạt (addEntries), cùng dạng mục đọc từ file .bib. */
export const toBatchEntry = (it) => ({
  type: '', title: it.title, authors: it.authors, year: it.year, venue: it.venue,
  doi: it.doi, arxivId: it.arxivId, url: it.url, abstract: it.abstract,
});
