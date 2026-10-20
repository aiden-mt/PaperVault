// Cầu nối với cửa sổ desktop (pywebview). Khi chạy trong trình duyệt thường, mọi hàm trả về null.

export const isDesktop = () => !!window.pywebview?.api;

let readyPromise = null;
/** Chờ pywebview sẵn sàng (sự kiện pywebviewready), tối đa ~1,5 giây. */
export function whenReady() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve) => {
    if (window.pywebview?.api) return resolve(true);
    if (!new URLSearchParams(location.search).get('desktop')) return resolve(false);
    const t = setTimeout(() => resolve(!!window.pywebview?.api), 1500);
    window.addEventListener('pywebviewready', () => { clearTimeout(t); resolve(true); }, { once: true });
  });
  return readyPromise;
}

const call = async (fn, ...args) => {
  if (!isDesktop()) return null;
  try { return await window.pywebview.api[fn](...args); } catch (e) { console.warn('[desktop]', fn, e); return null; }
};

export const desktop = {
  info: () => call('app_info'),
  pickFolder: (start = '') => call('pick_folder', start),
  pickFiles: (pdfOnly = true) => call('pick_files', pdfOnly),
  readFile: (path) => call('read_file_base64', path),
  setDataDir: (path, move = false) => call('set_data_dir', path, move),
  openPath: (path) => call('open_path', path),
  openUrl: (url) => call('open_url', url),
  restart: () => call('restart'),
  quit: () => call('quit'),
};
