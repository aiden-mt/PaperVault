// Cầu nối tới PaperVault App (ứng dụng desktop chạy tại http://127.0.0.1:8765).
import { getSettings } from './db.js';

async function base() {
  const s = await getSettings();
  return String(s.appUrl || 'http://127.0.0.1:8765').replace(/\/+$/, '');
}

/** App có đang chạy không? Trả về { ok, url, papers } hoặc { ok: false }. */
export async function appStatus() {
  const url = await base();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${url}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    const data = await res.json();
    return data.ok ? { ok: true, url, papers: data.data?.papers } : { ok: false, url };
  } catch (_) {
    return { ok: false, url };
  }
}

/** Đẩy một mục vào hộp thư của app: { source, extraction?, meta? }. */
export async function sendToApp(item) {
  const url = await base();
  const res = await fetch(`${url}/api/inbox`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `App trả về HTTP ${res.status}`);
  return data.data;
}

/** Nhập toàn bộ thư viện extension vào app (gộp, bỏ qua id đã có). */
export async function importLibraryToApp(exportData) {
  const url = await base();
  const res = await fetch(`${url}/api/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: exportData, merge: true }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `App trả về HTTP ${res.status}`);
  return data.data;
}
