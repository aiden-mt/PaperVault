// Client gọi API của máy chủ Python.

/** Tham số truy vấn cho kết quả khám phá Semantic Scholar: lấy mới ngay, hoặc tự lấy mới khi bản lưu cũ hơn N ngày. */
const s2q = (refresh, maxAgeDays, limit = 0) => { const q = [refresh ? 'refresh=1' : '', maxAgeDays > 0 ? `maxAgeDays=${maxAgeDays}` : '', limit > 0 ? `limit=${limit}` : ''].filter(Boolean).join('&'); return q ? `?${q}` : ''; };

const MUTATING = /^(papers|topics|settings|kv\/|pages|import|backups\/restore|inbox|venue\/reclassify)/;

async function req(method, path, body, { raw = false, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) {
    if (body instanceof Uint8Array || body instanceof Blob || body instanceof ArrayBuffer) {
      opts.body = body;
    } else {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(`/api/${path}`, opts);
  } catch (e) {
    throw new Error('Không kết nối được máy chủ PaperVault. Hãy chắc rằng server.py đang chạy.');
  }
  if (raw) return res;
  let data;
  try { data = await res.json(); } catch (_) { throw new Error(`Máy chủ trả về lỗi HTTP ${res.status}.`); }
  if (!data.ok) { const err = new Error(data.error || `Lỗi HTTP ${res.status}`); err.status = res.status; err.body = data; throw err; }
  // Đã ghi dữ liệu: báo để các bản app khác đang mở (khung chia đôi, tab khác) nạp lại.
  if (method !== 'GET' && MUTATING.test(path)) window.dispatchEvent(new CustomEvent('pv:mutated', { detail: { path } }));
  return data.data;
}

export const api = {
  health: () => req('GET', 'health'),
  state: () => req('GET', 'state'),
  search: (q) => req('GET', `search?q=${encodeURIComponent(q)}`),

  papers: () => req('GET', 'papers'),
  trash: () => req('GET', 'papers/trash'),
  paper: (id) => req('GET', `papers/${id}`),
  putPaper: (p) => req('POST', 'papers', p),
  deletePaper: (id, permanent = false) => req('DELETE', `papers/${id}${permanent ? '?permanent=1' : ''}`),
  restorePaper: (id) => req('POST', `papers/${id}/restore`),
  bulk: (op, ids, value) => req('POST', 'papers/bulk', { op, ids, value }),
  getText: (id) => req('GET', `papers/${id}/text`),
  putText: (id, text, kind) => req('POST', `papers/${id}/text`, { text, kind }),

  topics: () => req('GET', 'topics'),
  putTopic: (t) => req('POST', 'topics', t),
  deleteTopic: (id, reassign = 't_inbox') => req('DELETE', `topics/${id}?reassign=${encodeURIComponent(reassign)}`),

  settings: () => req('GET', 'settings'),
  putSettings: (patch) => req('POST', 'settings', patch),
  kvGet: (k) => req('GET', `kv/${k}`),
  kvSet: (k, value) => req('POST', `kv/${k}`, { value }),

  uploadPdf: async (fileOrBytes, name) => {
    const bytes = fileOrBytes instanceof Uint8Array ? fileOrBytes : new Uint8Array(await fileOrBytes.arrayBuffer());
    return req('POST', 'pdf', bytes, { headers: { 'content-type': 'application/pdf', 'X-Filename': encodeURIComponent(name || fileOrBytes.name || 'paper.pdf') } });
  },
  pdfUrl: (id) => `/api/pdf/${id}`,
  /** Tải một ảnh lên (Sổ tay). Trả về { id, url, name, size }. */
  uploadImage: async (file, name) => {
    const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
    return req('POST', 'image', bytes, { headers: { 'content-type': 'application/octet-stream', 'X-Filename': encodeURIComponent(name || file.name || 'image') } });
  },
  pdfBase64: (id) => req('GET', `pdf/${id}/base64`),
  pdfBytes: async (id) => new Uint8Array(await (await fetch(`/api/pdf/${id}`)).arrayBuffer()),
  deletePdf: (id) => req('DELETE', `pdf/${id}`),

  pdfFind: (paper) => req('POST', 'pdf-find', { title: paper.title, doi: paper.doi, arxivId: paper.arxivId, url: paper.url, s2Id: paper.s2Id }),
  pdfDownload: (url, name = '') => req('POST', 'pdf-download', { url, name }),
  translate: (q, tl = 'vi', sl = 'auto') => req('POST', 'translate', { q, tl, sl }),
  resolve: (query) => req('POST', 'resolve', { query }),
  findTitle: (q) => req('GET', `find-title?q=${encodeURIComponent(q)}`),
  fetchUrl: (url, binary = false) => req('POST', 'fetch', { url, binary }),
  s2Recommend: (ident, refresh = false, maxAgeDays = 0) => req('GET', `s2/recommend/${encodeURIComponent(ident)}${s2q(refresh, maxAgeDays)}`),
  s2Citations: (ident, refresh = false, maxAgeDays = 0, limit = 0) => req('GET', `s2/citations/${encodeURIComponent(ident)}${s2q(refresh, maxAgeDays, limit)}`),
  s2Graph: (ident, { refresh = false, cits = 100, hop2 = false, minShared = 3 } = {}) => req('GET', `s2/graph/${encodeURIComponent(ident)}?cits=${cits}&hop2=${hop2 ? 1 : 0}&minShared=${minShared}${refresh ? '&refresh=1' : ''}`),
  s2Check: (key = '') => req('GET', `s2/check${key ? `?key=${encodeURIComponent(key)}` : ''}`),
  s2Authors: (ident) => req('GET', `s2/authors/${encodeURIComponent(ident)}`),
  s2AuthorPapers: (authorId) => req('GET', `s2/author-papers/${encodeURIComponent(authorId)}`),
  s2References: (ident, refresh = false, maxAgeDays = 0, limit = 0) => req('GET', `s2/references/${encodeURIComponent(ident)}${s2q(refresh, maxAgeDays, limit)}`),
  s2Search: (q) => req('GET', `s2/search?q=${encodeURIComponent(q)}`),
  s2Refresh: (ids = []) => req('POST', 's2/refresh', { ids }),
  s2Details: (ids = []) => req('POST', 's2/details', { ids }),
  arxivSearch: (keywords, cats, max = 50) => req('GET', `arxiv/search?q=${encodeURIComponent(keywords.join(','))}&cats=${encodeURIComponent(cats.join(','))}&max=${max}`),

  logUsage: (row) => req('POST', 'usage', row).catch(() => null),
  usageCost: (since) => req('GET', `usage/cost?since=${encodeURIComponent(since)}`),
  usage: (since = '') => req('GET', `usage?since=${encodeURIComponent(since)}`),
  prices: (models, refresh = false) => req('GET', `prices?models=${encodeURIComponent(models.join(','))}${refresh ? '&refresh=1' : ''}`),

  zoteroScan: (dir = '') => req('GET', `zotero/scan?dir=${encodeURIComponent(dir)}`),
  zoteroPdf: (path) => req('POST', 'zotero/pdf', { path }),
  icsFetch: (url) => req('GET', `ics-fetch?url=${encodeURIComponent(url)}`),
  chats: () => req('GET', 'chats'),
  chat: (id) => req('GET', `chats/${id}`),
  putChat: (c) => req('POST', 'chats', c),
  deleteChat: (id) => req('DELETE', `chats/${id}`),
  pages: () => req('GET', 'pages'),
  putPage: (p) => req('POST', 'pages', p),
  putPages: (list) => req('POST', 'pages', list),
  deletePage: (id) => req('DELETE', `pages/${id}`),

  venueClassify: (candidates, hints = {}, hasArxiv = false) => req('POST', 'venue/classify', { candidates, hints, hasArxiv }),
  venueSearch: (q) => req('GET', `venue/search?q=${encodeURIComponent(q)}`),
  venueReclassify: (force = false) => req('POST', 'venue/reclassify', { force }),
  rankingsInfo: () => req('GET', 'rankings'),
  rankingsUpdate: () => req('POST', 'rankings/update', {}),

  inbox: () => req('GET', 'inbox'),
  inboxRemove: (id) => req('DELETE', `inbox/${id}`),

  sync: (files, { root, clean = false } = {}) => req('POST', 'sync', { files, root, clean }),
  backup: (withTexts = true) => req('GET', `backup?texts=${withTexts ? 1 : 0}`),
  importData: (data, merge = true) => req('POST', 'import', { data, merge }),
  // Sao lưu đầy đủ dạng .zip (dữ liệu + PDF + ảnh) trong thư mục sao lưu
  backups: () => req('GET', 'backups'),
  createBackup: () => req('POST', 'backups'),
  openBackupDir: () => req('POST', 'backups/open'),
  backupFile: async (name) => { const r = await fetch(`/api/backups/${encodeURIComponent(name)}`); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); },
  restoreBackup: (fileOrName, merge = true) => (typeof fileOrName === 'string'
    ? req('POST', `backups/restore?merge=${merge ? 1 : 0}`, { name: fileOrName })
    : req('POST', `backups/restore?merge=${merge ? 1 : 0}`, fileOrName, { headers: { 'content-type': 'application/zip' } })),
  updateCheck: () => req('GET', 'update-check'),
  /** Trang HTML đầy đủ -> Blob PDF (máy chủ in bằng Edge / Chrome chạy ẩn). Lỗi 'no-browser' khi máy không có trình duyệt hợp. */
  htmlToPdf: async (html) => {
    const r = await req('POST', 'export/pdf', { html }, { raw: true });
    if (r.ok && (r.headers.get('content-type') || '').includes('pdf')) return r.blob();
    let msg = `HTTP ${r.status}`;
    try { msg = (await r.json()).error || msg; } catch (_) { /* bỏ qua */ }
    throw new Error(msg);
  },
  pageVersions: (id) => req('GET', `pages/${id}/versions`),
  pageVersion: (id, vid) => req('GET', `pages/${id}/versions/${vid}`),
  restorePageVersion: (id, vid) => req('POST', `pages/${id}/versions/${vid}/restore`),
  openFolder: (path) => req('POST', 'open', { path }),
};
