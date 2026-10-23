// Kiểm tra bản mới trên GitHub Releases (qua máy chủ: /api/update-check), tự kiểm tra mỗi ngày một lần.
import { api } from './api.js';
import { store, saveSettings } from './store.js';
import { escapeHtml } from './util.js';
import { notice } from './notice.js';
import { isDesktop, desktop } from './desktop.js';

const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { /* bỏ qua */ } return null; };
const DAY = 864e5;

export async function checkForUpdate({ force = false } = {}) {
  const r = await api.updateCheck();
  LS('pv.updLast', String(Date.now()));
  if (force) LS('pv.updSkip', ''); // tự bấm kiểm tra thì hiện lại cả bản đã bỏ qua
  return r;
}

export function openRelease(url) {
  if (isDesktop()) desktop.openUrl(url);
  else window.open(url, '_blank', 'noopener');
}

/** Ghi chú phát hành (Markdown của GitHub) -> HTML gọn: chỉ giữ dòng chữ, tiêu đề và gạch đầu dòng. */
export function releaseNotesHtml(md, max = 30) {
  return escapeHtml(md).split(/\r?\n/).filter((l) => l.trim()).slice(0, max)
    .map((l) => (/^#+\s/.test(l) ? `<b>${l.replace(/^#+\s/, '')}</b>` : /^\s*[-*]\s/.test(l) ? `• ${l.replace(/^\s*[-*]\s/, '')}` : l))
    .map((l) => l.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')).join('<br>');
}

/** Gọi lúc mở app: nếu đã quá một ngày từ lần kiểm tra trước thì hỏi GitHub, có bản mới thì hiện thẻ thông báo. */
export function autoCheckUpdates() {
  if (store.settings?.updateCheck === false) return;
  if (Date.now() - Number(LS('pv.updLast') || 0) < DAY) return;
  setTimeout(async () => {
    let r;
    try { r = await checkForUpdate(); } catch (_) { return; } // không có mạng: thử lại lần mở app sau
    if (!r?.newer || LS('pv.updSkip') === r.latest) return;
    notice({
      key: 'update', icon: '⬆',
      title: `Có bản PaperVault mới: ${r.latest}`,
      body: `Bạn đang dùng ${escapeHtml(r.current)}.${r.notes ? `<div class="pvn-notes">${releaseNotesHtml(r.notes, 8)}</div>` : ''}`,
      actions: [
        { label: 'Tải bản mới', primary: true, onClick: () => openRelease(isDesktop() && r.download ? r.download : r.url) },
        ...(isDesktop() && r.download ? [{ label: 'Xem thay đổi', onClick: () => { openRelease(r.url); return true; } }] : []),
        { label: 'Bỏ qua bản này', onClick: () => LS('pv.updSkip', r.latest) },
        { label: 'Tắt tự kiểm tra', onClick: () => saveSettings({ updateCheck: false }) },
      ],
    });
  }, 8000);
}
