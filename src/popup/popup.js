import { getTopics, getSettings, kvSet, kvGet } from '../common/db.js';
import { renderSections } from '../common/render.js';
import { paperToMarkdown } from '../common/markdown.js';
import { escapeHtml, uid } from '../common/util.js';
import { readFile, bytesToBase64, extractPdfText, estimatePages } from '../common/pdf.js';
import { NATIVE_PDF_PROVIDERS } from '../common/llm.js';
import { appStatus, sendToApp } from '../common/app.js';

const $ = (id) => document.getElementById(id);
const state = {
  source: null,       // nội dung scrape được từ tab
  result: null,       // { extraction, meta, suggestion, duplicate }
  topics: [],
  tab: 'page',
  pdf: null,          // { key, name, size, pages, bytes }
  savedId: null,      // id sau khi đã lưu, để chặn lưu trùng
};

function setStatus(msg, kind = '') {
  const el = $('status');
  el.className = `status ${kind}`;
  el.innerHTML = msg;
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res?.ok) return reject(new Error(res?.error || 'Lỗi không xác định.'));
      resolve(res.data);
    });
  });
}

const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/* ---------------- Tabs ---------------- */

document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.tab = btn.dataset.tab;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
    $('tab-page').hidden = state.tab !== 'page';
    $('tab-paste').hidden = state.tab !== 'paste';
  });
});

function switchTab(name) {
  document.querySelector(`.tabs button[data-tab="${name}"]`)?.click();
}

/* ---------------- Đọc trang hiện tại ---------------- */

async function loadCurrentTab() {
  setStatus('');
  $('src-title').textContent = 'Đang đọc trang…';
  $('btn-use-pdf').hidden = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab?.id;
    if (!tab?.id || /^(chrome|edge|about|chrome-extension):/i.test(tab.url || '')) {
      $('src-title').textContent = 'Trang này không đọc được.';
      $('src-warn').textContent = 'Mở một trang paper (arXiv, OpenReview, ACL…) hoặc dùng tab "PDF / Dán text".';
      return;
    }
    const source = await send({ type: 'scrape', tabId: tab.id });
    state.source = source;
    $('src-title').textContent = source.title || '(không lấy được tiêu đề)';
    $('src-kind').textContent = source.kind || 'không rõ';
    $('src-len').textContent = `${source.text.length.toLocaleString('vi-VN')} ký tự`;

    if (source.site === 'pdf') {
      $('btn-use-pdf').hidden = false;
      $('src-warn').innerHTML = source.text.length > 400
        ? 'Trang này là PDF. Có thể lấy trực tiếp file PDF để trích xuất đầy đủ hơn.'
        : '⚠️ Đây là file PDF nên không đọc được text từ DOM. Bấm <b>Dùng file PDF của trang này</b> bên dưới.';
    } else if (!source.text || source.text.length < 400) {
      $('src-warn').innerHTML = '⚠️ Nội dung lấy được khá ngắn, kết quả có thể sơ sài. Cân nhắc mở bản HTML full text, dùng file PDF hoặc dán text thủ công.';
    } else {
      $('src-warn').textContent = '';
    }
  } catch (e) {
    $('src-title').textContent = 'Không đọc được trang.';
    $('src-warn').textContent = e.message;
  }
}

/* ---------------- Nhận file PDF ---------------- */

function showPdfChip() {
  if (!state.pdf) {
    $('pdf-chip').hidden = true;
    $('dropzone').hidden = false;
    return;
  }
  $('pdf-chip').hidden = false;
  $('dropzone').hidden = true;
  const pages = state.pdf.pages ? ` · ~${state.pdf.pages} trang` : '';
  $('pdf-chip-text').textContent = `📄 ${state.pdf.name} (${fmtSize(state.pdf.size)}${pages})`;
}

async function acceptPdfFile(file) {
  if (!file) return;
  if (file.size > 24 * 1024 * 1024) {
    setStatus('File PDF lớn hơn 24MB, model sẽ từ chối. Hãy cắt bớt trang.', 'err');
    return;
  }
  setStatus('<span class="spin"></span> Đang đọc file PDF…');
  try {
    const bytes = await readFile(file);
    const key = `pdfBlob:${uid('f')}`;
    await kvSet(key, bytesToBase64(bytes));
    state.pdf = { key, name: file.name, size: bytes.length, pages: estimatePages(bytes), bytes };
    showPdfChip();
    switchTab('paste');
    setStatus('Đã nạp PDF. Bấm "Trích xuất 5 mục".', 'ok');
  } catch (e) {
    setStatus(escapeHtml(e.message), 'err');
  }
}

async function useTabPdf() {
  setStatus('<span class="spin"></span> Đang tải file PDF từ trang…');
  try {
    const r = await send({ type: 'grabTabPdf', tabId: state.tabId });
    state.pdf = { key: r.pdfKey, name: (r.url || '').split('/').pop() || 'paper.pdf', size: r.size, pages: null, bytes: null };
    if (!$('paste-url').value) $('paste-url').value = r.url || '';
    showPdfChip();
    switchTab('paste');
    setStatus('Đã lấy PDF từ trang. Bấm "Trích xuất 5 mục".', 'ok');
  } catch (e) {
    setStatus(`${escapeHtml(e.message)} — thử tải file về máy rồi chọn thủ công.`, 'err');
  }
}

function clearPdf() {
  if (state.pdf?.key) kvSet(state.pdf.key, null);
  state.pdf = null;
  showPdfChip();
}

$('dropzone').addEventListener('click', () => $('file-pdf').click());
$('file-pdf').addEventListener('change', (e) => acceptPdfFile(e.target.files?.[0]));
$('pdf-clear').addEventListener('click', clearPdf);
$('btn-use-pdf').addEventListener('click', useTabPdf);

['dragenter', 'dragover'].forEach((ev) => $('dropzone').addEventListener(ev, (e) => {
  e.preventDefault();
  $('dropzone').classList.add('over');
}));
['dragleave', 'drop'].forEach((ev) => $('dropzone').addEventListener(ev, (e) => {
  e.preventDefault();
  $('dropzone').classList.remove('over');
}));
$('dropzone').addEventListener('drop', (e) => {
  const file = [...(e.dataTransfer?.files || [])].find((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  if (file) acceptPdfFile(file);
});

/* ---------------- Trích xuất ---------------- */

/** Với provider không nhận PDF trực tiếp thì trích text tại chỗ. */
async function pdfTextIfNeeded(settings) {
  const native = NATIVE_PDF_PROVIDERS.has(settings.provider) && settings.pdfMode !== 'text';
  if (native) return '';
  if (!state.pdf?.bytes) {
    throw new Error('Provider hiện tại không nhận PDF trực tiếp. Hãy chọn file PDF từ máy (thay vì lấy từ trang) hoặc chuyển sang Claude/Gemini.');
  }
  setStatus('<span class="spin"></span> Đang trích text từ PDF…');
  const r = await extractPdfText(state.pdf.bytes);
  if (!r.text || r.text.length < 200) {
    throw new Error('Không trích được text từ PDF này (có thể là bản scan). Hãy dùng Claude/Gemini để gửi thẳng file PDF.');
  }
  if (!r.readable) {
    setStatus('⚠️ Text trích ra có nhiều ký tự lạ (font không kèm ToUnicode). Kết quả có thể sai.', 'err');
  }
  return r.text;
}

async function doExtract() {
  const settings = await getSettings();
  if (!settings.apiKeys?.[settings.provider]) {
    setStatus('Chưa có API key. <a href="#" id="go-opt">Mở Cài đặt</a> để nhập.', 'err');
    $('go-opt')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
    return;
  }

  let source;
  if (state.tab === 'paste') {
    const text = $('paste-text').value.trim();
    if (state.pdf) {
      source = {
        url: $('paste-url').value.trim(),
        title: state.pdf.name.replace(/\.pdf$/i, ''),
        kind: `file PDF (${state.pdf.name})`,
        pdfKey: state.pdf.key,
        text: text || await pdfTextIfNeeded(settings),
      };
    } else {
      if (text.length < 120) { setStatus('Cần ít nhất 120 ký tự nội dung, hoặc chọn một file PDF.', 'err'); return; }
      source = { url: $('paste-url').value.trim(), title: '', kind: 'text người dùng dán', text };
    }
  } else {
    if (!state.source?.text) { setStatus('Chưa có nội dung từ trang. Bấm "Đọc lại".', 'err'); return; }
    source = state.source;
  }

  $('btn-extract').disabled = true;
  setStatus(`<span class="spin"></span> Đang gọi ${settings.provider}/${settings.models[settings.provider]}… (10-60 giây, đừng đóng popup)`);
  try {
    const data = await send({ type: 'extract', source });
    state.source = source;
    state.result = data;
    state.topics = data.topics;
    state.savedId = null;
    if (state.pdf) { state.pdf = null; showPdfChip(); }  // key đã được service worker dọn
    renderResult(data);
    setStatus('Xong. Kiểm tra rồi bấm <b>Lưu vào thư viện</b>.', 'ok');
  } catch (e) {
    setStatus(escapeHtml(e.message), 'err');
  } finally {
    $('btn-extract').disabled = false;
  }
}

function renderResult({ extraction, meta, suggestion, topics, duplicate }) {
  $('result').hidden = false;
  $('r-title').textContent = extraction.title || state.source?.title || '(chưa có tên)';
  $('r-conf').textContent = `độ tin cậy: ${extraction.confidence || '?'}`;
  $('r-model').textContent = `${meta.provider}/${meta.model} · ${(meta.elapsedMs / 1000).toFixed(1)}s${meta.pdfMode ? ` · ${meta.pdfMode}` : ''}`;
  $('r-oneliner').textContent = extraction.one_liner || '';

  // Trùng lặp: cho chọn cập nhật hay tạo bản mới, mặc định là cập nhật.
  state.duplicate = duplicate || null;
  $('dup-box').hidden = !duplicate;
  if (duplicate) {
    $('dup-text').innerHTML = `Thư viện đã có <b>${escapeHtml(duplicate.title)}</b>.`;
    document.querySelector('input[name="dupmode"][value="update"]').checked = true;
  }

  $('sections').innerHTML = renderSections(extraction);

  const sel = $('topic-select');
  const scores = new Map((suggestion.ranked || []).map((r) => [r.topicId, r.score]));
  const sorted = [...topics].sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0));
  sel.innerHTML = sorted.map((t) => {
    const s = scores.get(t.id);
    return `<option value="${t.id}">${escapeHtml(t.name)}${s ? ` — gợi ý ${s}` : ''}</option>`;
  }).join('') + '<option value="__new__">➕ Tạo thư mục mới…</option>';

  if (suggestion.isNew && suggestion.newName) {
    sel.value = '__new__';
    $('newtopic-wrap').hidden = false;
    $('newtopic-name').value = suggestion.newName;
    $('topic-why').innerHTML = `Model đề xuất chủ đề mới: <b>${escapeHtml(suggestion.newName)}</b>. Bạn có thể đổi sang thư mục có sẵn.`;
  } else {
    sel.value = duplicate?.topicId || suggestion.topicId || 't_inbox';
    $('newtopic-wrap').hidden = true;
    const top3 = (suggestion.ranked || []).slice(0, 3).map((r) => `${r.name} (${r.score})`).join(' · ');
    $('topic-why').textContent = top3 ? `Gợi ý: ${top3}` : 'Không đủ tín hiệu để gợi ý — chọn thủ công.';
  }

  $('btn-save').disabled = false;
  $('btn-save').textContent = duplicate ? 'Lưu / cập nhật' : 'Lưu vào thư viện';
}

/* ---------------- Lưu ---------------- */

async function doSave() {
  if (!state.result) return;
  if (state.savedId) { setStatus('Kết quả này đã được lưu rồi.', 'ok'); return; }

  const sel = $('topic-select').value;
  const newName = sel === '__new__' ? $('newtopic-name').value.trim() : '';
  if (sel === '__new__' && !newName) { setStatus('Nhập tên thư mục mới.', 'err'); return; }

  const dupMode = document.querySelector('input[name="dupmode"]:checked')?.value;
  const existingId = state.duplicate && dupMode === 'update' ? state.duplicate.id : null;

  $('btn-save').disabled = true;
  setStatus('<span class="spin"></span> Đang lưu…');
  try {
    const { paper, updated } = await send({
      type: 'save',
      payload: {
        extraction: state.result.extraction,
        meta: state.result.meta,
        source: state.source,
        topicId: sel === '__new__' ? null : sel,
        newTopicName: newName,
        userNotes: $('user-notes').value.trim(),
        existingId,
      },
    });
    state.savedId = paper.id;
    await kvSet('lastExtraction', null);
    $('btn-save').textContent = updated ? '✓ Đã cập nhật' : '✓ Đã lưu';
    setStatus(
      `${updated ? 'Đã cập nhật' : 'Đã lưu'} "${escapeHtml(paper.title).slice(0, 46)}…" vào <b>${escapeHtml(state.topics.find((t) => t.id === paper.topicId)?.name || newName)}</b>. `
      + '<a href="#" id="go-lib">Mở thư viện</a>',
      'ok',
    );
    $('go-lib')?.addEventListener('click', (e) => {
      e.preventDefault();
      send({ type: 'openLibrary' });
    });
  } catch (e) {
    setStatus(escapeHtml(e.message), 'err');
    $('btn-save').disabled = false;
  }
}

/* ---------------- Khôi phục kết quả chưa lưu ---------------- */

async function checkPending() {
  const pending = await kvGet('lastExtraction', null);
  if (!pending?.result) return;
  if (Date.now() - (pending.at || 0) > 20 * 60 * 1000) {
    await kvSet('lastExtraction', null);
    return;
  }
  $('restore-box').hidden = false;
  $('restore-title').textContent = pending.result.extraction?.title || '(không tên)';
  $('restore-yes').addEventListener('click', () => {
    state.source = pending.source;
    state.result = pending.result;
    state.topics = pending.result.topics;
    state.savedId = null;
    renderResult(pending.result);
    $('restore-box').hidden = true;
    setStatus('Đã khôi phục kết quả trích xuất trước đó.', 'ok');
  });
  $('restore-no').addEventListener('click', async () => {
    await kvSet('lastExtraction', null);
    $('restore-box').hidden = true;
  });
}

/* ---------------- Sự kiện ---------------- */

$('topic-select').addEventListener('change', (ev) => {
  $('newtopic-wrap').hidden = ev.target.value !== '__new__';
});
$('btn-extract').addEventListener('click', doExtract);
$('btn-recheck').addEventListener('click', loadCurrentTab);
$('btn-save').addEventListener('click', doSave);
$('btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('btn-library').addEventListener('click', () => send({ type: 'openLibrary' }));
$('btn-copy').addEventListener('click', async () => {
  if (!state.result) return;
  const topic = state.topics.find((t) => t.id === $('topic-select').value);
  const md = paperToMarkdown({
    title: state.result.extraction.title,
    url: state.source?.url,
    extraction: state.result.extraction,
    meta: state.result.meta,
    userNotes: $('user-notes').value,
    createdAt: new Date().toISOString(),
  }, topic);
  await navigator.clipboard.writeText(md);
  setStatus('Đã copy Markdown vào clipboard.', 'ok');
});

/* ---------------- PaperVault App (desktop) ---------------- */

async function currentSource() {
  if (state.tab === 'paste') {
    const text = $('paste-text').value.trim();
    if (text.length < 120 && !state.pdf) return null;
    return { url: $('paste-url').value.trim(), title: '', kind: 'text người dùng dán (extension)', text };
  }
  return state.source?.text ? { ...state.source } : null;
}

async function initAppBridge() {
  const st = await appStatus();
  if (!st.ok) return;
  $('btn-to-app').hidden = false;
  $('btn-to-app').addEventListener('click', async () => {
    const source = await currentSource();
    if (!source) return setStatus('Chưa có nội dung để gửi.', 'err');
    try {
      await sendToApp({ source });
      setStatus(`Đã gửi sang PaperVault App. <a href="${st.url}/#/add" target="_blank">Mở app</a>`, 'ok');
    } catch (e) { setStatus(escapeHtml(e.message), 'err'); }
  });
  $('btn-result-to-app').addEventListener('click', async () => {
    if (!state.result) return;
    try {
      await sendToApp({ source: state.source, extraction: state.result.extraction, meta: state.result.meta });
      setStatus(`Đã gửi kết quả sang PaperVault App. <a href="${st.url}/#/add" target="_blank">Mở app</a>`, 'ok');
    } catch (e) { setStatus(escapeHtml(e.message), 'err'); }
  });
  const obs = new MutationObserver(() => { $('btn-result-to-app').hidden = $('result').hidden; });
  obs.observe($('result'), { attributes: true, attributeFilter: ['hidden'] });
}

(async function init() {
  state.topics = await getTopics();
  showPdfChip();
  await loadCurrentTab();
  await checkPending();
  initAppBridge();
})();
