// Đồng bộ thư viện ra thư mục thật trên máy bằng File System Access API.
// Chỉ chạy được trong trang extension (library/options), không chạy trong service worker.
import { kvGet, kvSet } from './db.js';
import { slugify, fmtDate } from './util.js';
import { paperToMarkdown, topicIndexMarkdown, compareTableMarkdown } from './markdown.js';

const ROOT_KEY = 'rootDirHandle';

export function isSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/** Tên thư mục/file an toàn cho Windows. */
export function safeName(name) {
  return String(name || 'untitled')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80) || 'untitled';
}

export async function pickRootDirectory() {
  if (!isSupported()) throw new Error('Trình duyệt không hỗ trợ File System Access API.');
  const handle = await window.showDirectoryPicker({ id: 'papervault-root', mode: 'readwrite' });
  await kvSet(ROOT_KEY, handle);
  return handle;
}

export async function getRootDirectory() {
  return kvGet(ROOT_KEY, null);
}

export async function clearRootDirectory() {
  await kvSet(ROOT_KEY, null);
}

/**
 * Kiểm tra quyền ghi. Chrome thu hồi quyền sau mỗi phiên nên cần request lại,
 * và request phải nằm trong một user gesture (click).
 */
export async function ensurePermission(handle, { request = true } = {}) {
  if (!handle) return false;
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (!request) return false;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function writeFile(dirHandle, filename, contents) {
  const fh = await dirHandle.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  await w.write(new Blob([contents], { type: 'text/markdown;charset=utf-8' }));
  await w.close();
}

/**
 * Ghi toàn bộ thư viện: <root>/<Chủ đề>/<slug-paper>.md + _index.md mỗi thư mục,
 * cùng README.md và _bang-so-sanh-tat-ca.md ở thư mục gốc.
 * Trả về { files, folders }.
 */
export async function syncLibrary({ papers, topics, onProgress = () => {} }) {
  const root = await getRootDirectory();
  if (!root) throw new Error('Chưa chọn thư mục gốc.');
  if (!(await ensurePermission(root))) throw new Error('Bạn chưa cấp quyền ghi vào thư mục đã chọn.');

  const byTopic = new Map();
  for (const p of papers) {
    const key = p.topicId || '__none__';
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key).push(p);
  }

  let files = 0;
  let folders = 0;
  const readmeRows = [];

  for (const [topicId, list] of byTopic) {
    const topic = topics.find((t) => t.id === topicId) || { name: 'Chưa phân loại', id: '__none__' };
    const folderName = safeName(topic.name);
    const dir = await root.getDirectoryHandle(folderName, { create: true });
    folders++;

    const used = new Set();
    for (const p of list) {
      let base = slugify(p.title || p.id);
      let name = `${base}.md`;
      let n = 2;
      while (used.has(name)) name = `${base}-${n++}.md`;
      used.add(name);
      await writeFile(dir, name, paperToMarkdown(p, topic));
      files++;
      onProgress(`${folderName}/${name}`);
    }
    await writeFile(dir, '_index.md', topicIndexMarkdown(topic, list));
    files++;
    readmeRows.push(`- **${topic.name}** — ${list.length} paper ([mở](./${folderName}/_index.md))`);
  }

  const readme = [
    '# PaperVault',
    '',
    `_Đồng bộ lúc ${fmtDate(new Date().toISOString())} · ${papers.length} paper · ${byTopic.size} chủ đề_`,
    '',
    '## Thư mục chủ đề',
    '',
    ...readmeRows,
    '',
    '> Thư mục này được extension ghi đè mỗi lần đồng bộ. Muốn ghi chú lâu dài, sửa trong extension rồi đồng bộ lại.',
  ].join('\n');
  await writeFile(root, 'README.md', readme);
  await writeFile(root, '_bang-so-sanh-tat-ca.md', [
    '# Bảng so sánh toàn bộ paper',
    '',
    compareTableMarkdown(papers, { withBottleneck: true }),
  ].join('\n'));
  files += 2;

  return { files, folders };
}
