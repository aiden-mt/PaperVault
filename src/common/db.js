// Lớp truy cập IndexedDB: papers / topics / kv (settings, directory handle).
import { uid, nowISO } from './util.js';
import { DEFAULT_TOPICS } from './topics.js';

const DB_NAME = 'papervault';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('papers')) {
        const s = db.createObjectStore('papers', { keyPath: 'id' });
        s.createIndex('topicId', 'topicId', { unique: false });
        s.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('topics')) {
        db.createObjectStore('topics', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    try { result = fn(os); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const wrap = (req) => ({ __req: req });

/* ---------------- kv ---------------- */

export async function kvGet(key, fallback = null) {
  const row = await tx('kv', 'readonly', (os) => wrap(os.get(key)));
  return row ? row.value : fallback;
}

export async function kvSet(key, value) {
  await tx('kv', 'readwrite', (os) => os.put({ key, value }));
  return value;
}

/* ---------------- settings ---------------- */

export const DEFAULT_SETTINGS = {
  provider: 'anthropic',
  models: {
    anthropic: 'claude-opus-5',
    openai: 'gpt-4o',
    gemini: 'gemini-2.0-flash',
  },
  apiKeys: { anthropic: '', openai: '', gemini: '' },
  maxInputChars: 60000,
  maxOutputTokens: 8000,
  effort: 'high',           // chỉ áp dụng cho Anthropic
  language: 'vi',           // ngôn ngữ note: vi | en
  myResearch: '',           // mô tả đề tài của bạn -> dùng cho mục "Ý tưởng áp dụng"
  autoSyncFolder: false,    // tự ghi ra thư mục thật sau mỗi lần lưu
  pdfMode: 'auto',          // auto = gửi thẳng PDF nếu provider hỗ trợ; text = luôn trích text trước
  appUrl: 'http://127.0.0.1:8765', // PaperVault App (ứng dụng desktop) để đẩy paper sang
};

export async function getSettings() {
  const s = await kvGet('settings', null);
  if (!s) return structuredClone(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    models: { ...DEFAULT_SETTINGS.models, ...(s.models || {}) },
    apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...(s.apiKeys || {}) },
  };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = {
    ...cur,
    ...patch,
    models: { ...cur.models, ...(patch.models || {}) },
    apiKeys: { ...cur.apiKeys, ...(patch.apiKeys || {}) },
  };
  await kvSet('settings', next);
  return next;
}

/* ---------------- topics ---------------- */

export async function getTopics() {
  const list = await tx('topics', 'readonly', (os) => wrap(os.getAll()));
  if (list && list.length) return list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const seeded = DEFAULT_TOPICS.map((t) => ({ ...t, createdAt: nowISO() }));
  await tx('topics', 'readwrite', (os) => seeded.forEach((t) => os.put(t)));
  return seeded.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

export async function putTopic(topic) {
  const t = { id: topic.id || uid('t'), keywords: [], color: '#6b7cff', ...topic };
  await tx('topics', 'readwrite', (os) => os.put(t));
  return t;
}

export async function deleteTopic(topicId, { reassignTo = null } = {}) {
  const papers = await getPapers();
  const affected = papers.filter((p) => p.topicId === topicId);
  for (const p of affected) {
    p.topicId = reassignTo;
    p.updatedAt = nowISO();
    await putPaper(p);
  }
  await tx('topics', 'readwrite', (os) => os.delete(topicId));
  return affected.length;
}

/* ---------------- papers ---------------- */

export async function getPapers() {
  const list = await tx('papers', 'readonly', (os) => wrap(os.getAll()));
  return (list || []).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getPaper(id) {
  return tx('papers', 'readonly', (os) => wrap(os.get(id)));
}

export async function putPaper(paper) {
  const p = { ...paper };
  p.id = p.id || uid('p');
  p.createdAt = p.createdAt || nowISO();
  p.updatedAt = nowISO();
  await tx('papers', 'readwrite', (os) => os.put(p));
  return p;
}

export async function deletePaper(id) {
  await tx('papers', 'readwrite', (os) => os.delete(id));
}

/** Tìm paper trùng theo url / arxivId / title đã chuẩn hoá. */
export async function findDuplicate({ url, arxivId, title }) {
  const papers = await getPapers();
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nt = norm(title);
  return papers.find((p) => (
    (arxivId && p.arxivId && p.arxivId === arxivId) ||
    (url && p.url && p.url.split('#')[0] === String(url).split('#')[0]) ||
    (nt.length > 12 && norm(p.title) === nt)
  )) || null;
}

export async function exportAll() {
  return {
    format: 'papervault-export',
    version: 1,
    exportedAt: nowISO(),
    topics: await getTopics(),
    papers: await getPapers(),
  };
}

export async function importAll(data, { merge = true } = {}) {
  if (!data || !Array.isArray(data.papers)) throw new Error('File import không đúng định dạng PaperVault.');
  const existing = merge ? await getPapers() : [];
  const seen = new Set(existing.map((p) => p.id));
  let added = 0;
  for (const t of data.topics || []) await putTopic(t);
  for (const p of data.papers) {
    if (merge && seen.has(p.id)) continue;
    await tx('papers', 'readwrite', (os) => os.put({ ...p, id: p.id || uid('p') }));
    added++;
  }
  return added;
}
