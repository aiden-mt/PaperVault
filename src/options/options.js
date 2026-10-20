import { getSettings, saveSettings, exportAll, getPapers, getTopics } from '../common/db.js';
import { pickRootDirectory, getRootDirectory, clearRootDirectory, isSupported, ensurePermission } from '../common/fs.js';
import { download } from '../common/util.js';
import { appStatus } from '../common/app.js';

const $ = (id) => document.getElementById(id);

const MODEL_HINTS = {
  anthropic: 'Gợi ý: claude-opus-5 (chất lượng cao nhất), claude-sonnet-5 (rẻ hơn), claude-haiku-4-5 (nhanh, rẻ).',
  openai: 'Gợi ý: gpt-4o, gpt-4o-mini. Nhập đúng model id mà key của bạn dùng được.',
  gemini: 'Gợi ý: gemini-2.0-flash, gemini-1.5-pro. Nhập đúng model id trong AI Studio.',
};

let settings = null;

function syncProviderUI() {
  const p = $('provider').value;
  document.querySelectorAll('.key-row').forEach((r) => r.classList.toggle('active', r.dataset.p === p));
  $('model').value = settings.models[p] || '';
  $('model-hint').textContent = MODEL_HINTS[p];
  $('effort').closest('label').style.opacity = p === 'anthropic' ? '1' : '.45';
}

async function load() {
  settings = await getSettings();
  $('provider').value = settings.provider;
  $('key-anthropic').value = settings.apiKeys.anthropic || '';
  $('key-openai').value = settings.apiKeys.openai || '';
  $('key-gemini').value = settings.apiKeys.gemini || '';
  $('my-research').value = settings.myResearch || '';
  $('language').value = settings.language;
  $('effort').value = settings.effort;
  $('max-input').value = settings.maxInputChars;
  $('max-output').value = settings.maxOutputTokens;
  $('pdf-mode').value = settings.pdfMode || 'auto';
  $('auto-sync').checked = !!settings.autoSyncFolder;
  $('app-url').value = settings.appUrl || 'http://127.0.0.1:8765';
  syncProviderUI();

  const [papers, topics] = await Promise.all([getPapers(), getTopics()]);
  $('stats').textContent = `${papers.length} paper · ${topics.length} chủ đề`;

  if (!isSupported()) {
    $('folder-status').textContent = 'Trình duyệt không hỗ trợ';
    $('btn-folder').disabled = true;
  } else {
    const root = await getRootDirectory();
    $('folder-status').textContent = root ? `Đã chọn: ${root.name}` : 'Chưa chọn thư mục';
  }
}

function collect() {
  const p = $('provider').value;
  return {
    provider: p,
    models: { ...settings.models, [p]: $('model').value.trim() },
    apiKeys: {
      anthropic: $('key-anthropic').value.trim(),
      openai: $('key-openai').value.trim(),
      gemini: $('key-gemini').value.trim(),
    },
    myResearch: $('my-research').value,
    language: $('language').value,
    effort: $('effort').value,
    maxInputChars: Number($('max-input').value) || 60000,
    maxOutputTokens: Number($('max-output').value) || 8000,
    pdfMode: $('pdf-mode').value,
    autoSyncFolder: $('auto-sync').checked,
    appUrl: $('app-url').value.trim() || 'http://127.0.0.1:8765',
  };
}

$('provider').addEventListener('change', () => {
  settings = { ...settings, ...collect() };
  syncProviderUI();
});

$('btn-save').addEventListener('click', async () => {
  settings = await saveSettings(collect());
  $('save-status').className = 'status ok';
  $('save-status').textContent = 'Đã lưu.';
  setTimeout(() => { $('save-status').textContent = ''; }, 2000);
});

$('btn-test').addEventListener('click', async () => {
  const s = { ...settings, ...collect() };
  $('test-status').className = 'status';
  $('test-status').innerHTML = '<span class="spin"></span> Đang kiểm tra…';
  chrome.runtime.sendMessage({ type: 'testConnection', settings: s }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) {
      $('test-status').className = 'status err';
      $('test-status').textContent = res?.error || chrome.runtime.lastError?.message || 'Lỗi.';
      return;
    }
    $('test-status').className = 'status ok';
    $('test-status').textContent = res.data;
  });
});

$('btn-folder').addEventListener('click', async () => {
  try {
    const h = await pickRootDirectory();
    await ensurePermission(h);
    $('folder-status').textContent = `Đã chọn: ${h.name}`;
  } catch (e) {
    if (e.name !== 'AbortError') $('folder-status').textContent = e.message;
  }
});

$('btn-folder-clear').addEventListener('click', async () => {
  await clearRootDirectory();
  $('folder-status').textContent = 'Chưa chọn thư mục';
});

$('btn-app-test').addEventListener('click', async () => {
  settings = await saveSettings({ appUrl: $('app-url').value.trim() || 'http://127.0.0.1:8765' });
  const st = await appStatus();
  $('app-status').className = `status ${st.ok ? 'ok' : 'err'}`;
  $('app-status').textContent = st.ok ? `App đang chạy tại ${st.url} (${st.papers} paper).` : `Không kết nối được ${st.url}. Hãy mở PaperVault App trước.`;
});

$('btn-backup').addEventListener('click', async () => {
  const data = await exportAll();
  download(`papervault-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
});

$('btn-open-lib').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/library/library.html') });
});

load();
