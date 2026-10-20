// Bộ theo dõi của trang Theo dõi paper mới, lưu trong kv "watches". Ba loại:
//  - arxiv (mặc định): từ khoá + danh mục arXiv.
//  - cites: bài mới dẫn một paper (theo mã Semantic Scholar của paper đó).
//  - author: bài mới của một tác giả (theo mã tác giả Semantic Scholar).
import { api } from './api.js';
import { uid } from './util.js';
import { pubTime, fmtPub, s2Key, citeRole, ROLE_LABELS } from './s2util.js';

export const loadWatches = async () => (await api.kvGet('watches')) || [];
export const saveWatches = (list) => api.kvSet('watches', list);

const sameWatch = (a, b) => a.type === b.type && (a.type === 'cites' ? a.ident === b.ident : a.authorId === b.authorId);

/** Thêm bộ theo dõi nếu chưa có. Trả về { watch, existed }. */
export async function addWatch(w) {
  const list = await loadWatches();
  const found = list.find((x) => sameWatch(x, w));
  if (found) return { watch: found, existed: true };
  const watch = { id: uid('w'), keywords: [], cats: [], max: 50, ...w };
  list.push(watch);
  await saveWatches(list);
  return { watch, existed: false };
}

export async function removeWatchWhere(pred) {
  const list = await loadWatches();
  const next = list.filter((x) => !pred(x));
  await saveWatches(next);
  return list.length - next.length;
}

/** Bài Semantic Scholar -> dạng kết quả của trang Theo dõi (giống kết quả arXiv). */
export function fromS2(it, { withRole = false } = {}) {
  const ext = it.externalIds || {};
  const role = withRole && (it._contexts?.length || it._intents?.length) ? ROLE_LABELS.citations[citeRole(it).role] : '';
  return {
    arxivId: s2Key(it), // khoá "đã xem", chung với tab Liên quan
    q: ext.ArXiv ? `arXiv:${ext.ArXiv}` : (ext.DOI || it.url || it.title),
    title: it.title || '',
    authors: (it.authors || []).slice(0, 6).map((a) => a.name).join(', '),
    published: it.publicationDate || (it.year ? String(it.year) : ''),
    when: fmtPub(it), t: pubTime(it),
    cats: [it.venue, role].filter(Boolean),
    abstract: it.tldr || it.abstract || '',
    url: ext.ArXiv ? `https://arxiv.org/abs/${ext.ArXiv}` : (it.url || (ext.DOI ? `https://doi.org/${ext.DOI}` : '')),
  };
}

/** Quét một bộ theo dõi, trả về danh sách kết quả mới nhất trước. */
export async function scanWatch(w) {
  if (w.type === 'cites') {
    const r = await api.s2Citations(w.ident, true);
    return (r.items || []).map((it) => fromS2(it, { withRole: true })).sort((a, b) => b.t - a.t).slice(0, w.max || 50);
  }
  if (w.type === 'author') {
    return (await api.s2AuthorPapers(w.authorId)).map((it) => fromS2(it)).slice(0, w.max || 50);
  }
  return api.arxivSearch(w.keywords, w.cats, w.max || 40);
}

export const WATCH_TYPES = { arxiv: 'Từ khoá arXiv', cites: 'Bài dẫn', author: 'Tác giả' };
