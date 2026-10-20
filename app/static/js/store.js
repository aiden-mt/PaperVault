// State toàn cục của app (bản sao trong bộ nhớ của dữ liệu trên máy chủ) + sự kiện thay đổi.
import { api } from './api.js';
import { buildLibraryFiles } from './markdown.js';

export const store = {
  papers: [],
  topics: [],
  settings: {},
  inbox: [],
  trashCount: 0,
  lastCitationRefresh: null,
  hasFts: true,
  textLens: {},       // paperId -> số ký tự toàn văn đã lưu
  ready: false,
  selected: new Set(),   // id các paper đang được tick chọn (dùng chung giữa thư viện và so sánh)
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }

export async function loadAll() {
  const s = await api.state();
  store.papers = s.papers;
  store.topics = s.topics;
  store.settings = s.settings;
  store.inbox = s.inbox || [];
  store.trashCount = s.trashCount || 0;
  store.lastCitationRefresh = s.lastCitationRefresh || null;
  store.hasFts = s.hasFts !== false;
  store.textLens = s.textLens || {};
  store.ready = true;
  emit();
}

export async function refreshInbox() {
  store.inbox = await api.inbox();
  emit();
}

export const topicOf = (p) => store.topics.find((t) => t.id === (p?.topicId || 't_inbox'));
export const topicById = (id) => store.topics.find((t) => t.id === id);
export const paperById = (id) => store.papers.find((p) => p.id === id);
/** Chủ đề chính + các nhãn phụ của paper. */
export const topicIdsOf = (p) => [p?.topicId || 't_inbox', ...(p?.topicIds || []).filter((id) => id !== (p?.topicId || 't_inbox'))];
export const inTopic = (p, topicId) => topicIdsOf(p).includes(topicId);

function upsertLocal(list, item) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item; else list.unshift(item);
}

export async function savePaper(paper) {
  const saved = await api.putPaper(paper);
  if (paper.sourceText) store.textLens[saved.id] = paper.sourceText.length;
  if (saved.deletedAt) store.papers = store.papers.filter((p) => p.id !== saved.id);
  else upsertLocal(store.papers, saved);
  store.papers.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  emit();
  scheduleAutoSync();
  return saved;
}

/** Tự ghi thư viện ra thư mục xuất (nếu bật trong Cài đặt), gộp nhiều lần lưu liên tiếp thành một lần ghi. */
let syncTimer = null;
export function scheduleAutoSync() {
  if (!store.settings?.autoSync || !store.settings?.exportDir) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    api.sync(buildLibraryFiles(store.papers, store.topics), { root: store.settings.exportDir })
      .catch((e) => console.warn('[PaperVault] auto-sync:', e.message));
  }, 1500);
}

/** Đưa vào thùng rác (khôi phục được trong 30 ngày). */
export async function removePaper(id) {
  await api.deletePaper(id, false);
  store.papers = store.papers.filter((p) => p.id !== id);
  store.selected.delete(id);
  store.trashCount++;
  emit();
}

export async function restorePaper(id) {
  const p = await api.restorePaper(id);
  if (p) { upsertLocal(store.papers, p); store.trashCount = Math.max(0, store.trashCount - 1); }
  store.papers.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  emit();
  return p;
}

export async function bulkPapers(op, ids, value) {
  const list = [...ids];
  const n = await api.bulk(op, list, value);
  store.papers = await api.papers();
  if (op === 'delete' || op === 'purge') for (const id of list) store.selected.delete(id);
  if (op === 'delete') store.trashCount += n;
  if (op === 'restore' || op === 'purge') store.trashCount = Math.max(0, store.trashCount - n);
  emit();
  scheduleAutoSync();
  return n;
}

export async function saveTopic(topic) {
  const saved = await api.putTopic(topic);
  upsertLocal(store.topics, saved);
  store.topics.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  emit();
  return saved;
}

export async function removeTopic(id, reassign = 't_inbox') {
  const n = await api.deleteTopic(id, reassign);
  store.topics = store.topics.filter((t) => t.id !== id);
  for (const p of store.papers) {
    if (p.topicId === id) p.topicId = reassign;
    if (p.topicIds?.includes(id)) p.topicIds = p.topicIds.filter((x) => x !== id);
  }
  emit();
  return n;
}

export async function saveSettings(patch) {
  store.settings = await api.putSettings(patch);
  emit();
  return store.settings;
}

/** Tìm paper trùng theo arXiv ID / DOI / URL / tên. */
export function findDuplicate({ url, arxivId, doi, title, exceptId = null }) {
  const n = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nt = n(title);
  const ax = (arxivId || '').replace(/v\d+$/, '');
  const d = (doi || '').toLowerCase();
  return store.papers.find((p) => p.id !== exceptId && (
    (ax && p.arxivId && p.arxivId.replace(/v\d+$/, '') === ax) ||
    (d && p.doi && p.doi.toLowerCase() === d) ||
    (url && p.url && p.url.split('#')[0] === String(url).split('#')[0]) ||
    (nt.length > 12 && n(p.title) === nt)
  )) || null;
}

/** Nhóm các paper trùng nhau (arXiv ID / DOI / tên chuẩn hoá). Trả về mảng nhóm, mỗi nhóm ≥ 2. */
export function duplicateGroups() {
  const n = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const groups = new Map();
  for (const p of store.papers) {
    const key = p.arxivId ? `a:${p.arxivId.replace(/v\d+$/, '')}`
      : (p.doi ? `d:${p.doi.toLowerCase()}` : (n(p.title).length > 12 ? `t:${n(p.title)}` : `u:${p.url || p.id}`));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  // gộp thêm theo tên trùng giữa các nhóm khác khoá (ví dụ một bản có arXiv ID, một bản không)
  const byTitle = new Map();
  for (const [key, list] of groups) {
    for (const p of list) {
      const t = n(p.title);
      if (t.length <= 12) continue;
      if (!byTitle.has(t)) byTitle.set(t, new Set());
      byTitle.get(t).add(key);
    }
  }
  const merged = new Map();
  const seen = new Set();
  for (const [key, list] of groups) {
    if (seen.has(key)) continue;
    const bucket = new Set([key]);
    for (const p of list) {
      const t = n(p.title);
      for (const k of byTitle.get(t) || []) bucket.add(k);
    }
    const all = [];
    for (const k of bucket) { seen.add(k); all.push(...groups.get(k)); }
    if (all.length > 1) merged.set(key, all);
  }
  return [...merged.values()];
}

/** Thống kê nhanh cho dashboard. */
export function stats() {
  const byStatus = { 'to-read': 0, reading: 0, done: 0 };
  const byTopic = new Map();
  const byYear = new Map();
  const tags = new Map();
  for (const p of store.papers) {
    byStatus[p.status || 'to-read'] = (byStatus[p.status || 'to-read'] || 0) + 1;
    const t = p.topicId || 't_inbox';
    byTopic.set(t, (byTopic.get(t) || 0) + 1);
    const y = p.extraction?.year || '';
    if (/^\d{4}$/.test(y)) byYear.set(y, (byYear.get(y) || 0) + 1);
    for (const tag of p.extraction?.tags || []) tags.set(tag, (tags.get(tag) || 0) + 1);
  }
  return { total: store.papers.length, byStatus, byTopic, byYear, tags };
}

/** Tất cả tag đang dùng: Map(tag -> [paperId]). */
export function tagIndex() {
  const m = new Map();
  for (const p of store.papers) for (const t of p.extraction?.tags || []) {
    if (!m.has(t)) m.set(t, []);
    m.get(t).push(p.id);
  }
  return m;
}

/** Ghi nhận độ dài toàn văn vừa lưu (để giao diện biết paper nào có toàn văn). */
export function noteTextLen(id, len) { store.textLens[id] = len || 0; }
