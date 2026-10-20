// Service worker: điều phối scrape trang, gọi LLM, lưu dữ liệu.
import { getSettings, getTopics, putTopic, putPaper, getPaper, findDuplicate, kvGet, kvSet } from '../common/db.js';
import { extractPaper, testConnection } from '../common/llm.js';
import { suggestTopic } from '../common/topics.js';
import { uid } from '../common/util.js';

const LIBRARY_URL = chrome.runtime.getURL('src/library/library.html');

/* ---------------- HTML -> text (service worker không có DOMParser) ---------------- */

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchText(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`Không tải được ${url} (HTTP ${res.status})`);
  return res.text();
}

/** Lấy thêm nội dung từ arXiv: ưu tiên bản HTML full text, fallback trang abstract. */
async function enrichFromArxiv(arxivId) {
  const idNoVer = arxivId.replace(/v\d+$/, '');
  const out = { text: '', kind: '', title: '', authors: '' };

  try {
    const html = await fetchText(`https://arxiv.org/html/${arxivId}`);
    if (!/no html|not available/i.test(html.slice(0, 500))) {
      const body = htmlToText(html);
      if (body.length > 3000) {
        out.text = body;
        out.kind = 'full text (arXiv HTML)';
        return out;
      }
    }
  } catch (_) { /* nhiều paper không có bản HTML - bỏ qua */ }

  try {
    const html = await fetchText(`https://arxiv.org/abs/${idNoVer}`);
    const title = (html.match(/<h1 class="title[^"]*">([\s\S]*?)<\/h1>/i)?.[1] || '')
      .replace(/<[^>]+>/g, '').replace(/^\s*Title:\s*/i, '').trim();
    const abs = (html.match(/<blockquote class="abstract[^"]*">([\s\S]*?)<\/blockquote>/i)?.[1] || '')
      .replace(/<[^>]+>/g, '').replace(/^\s*Abstract:\s*/i, '').trim();
    const authors = (html.match(/<div class="authors">([\s\S]*?)<\/div>/i)?.[1] || '')
      .replace(/<[^>]+>/g, '').replace(/^\s*Authors:\s*/i, '').trim();
    out.title = title;
    out.authors = authors;
    out.text = htmlToText(`Title: ${title}\nAuthors: ${authors}\n\nAbstract:\n${abs}`);
    out.kind = 'abstract (arXiv)';
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

/* ---------------- Scrape tab ---------------- */

async function scrapeTab(tabId) {
  const [inj] = await chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/content/scrape.js'],
  });
  const source = inj?.result;
  if (!source) throw new Error('Không đọc được nội dung trang. Thử tải lại trang rồi bấm lại.');

  if (source.needsFetch && source.arxivId) {
    const extra = await enrichFromArxiv(source.arxivId);
    if (extra.text && extra.text.length > source.text.length) {
      source.text = extra.text;
      source.kind = extra.kind || source.kind;
      if (!source.title && extra.title) source.title = extra.title;
      if (!source.authors && extra.authors) source.authors = extra.authors;
    }
  }
  return source;
}

/* ---------------- Lấy file PDF của tab đang mở ---------------- */

/** Hàm này được inject vào tab: tải chính URL của trang (same-origin) rồi trả về base64. */
function grabPdfFromPage() {
  return (async () => {
    try {
      const res = await fetch(location.href, { credentials: 'include' });
      if (!res.ok) return { ok: false, error: `Tải PDF thất bại (HTTP ${res.status}).` };
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
        return { ok: false, error: 'Nội dung tải về không phải PDF.' };
      }
      if (bytes.length > 24 * 1024 * 1024) return { ok: false, error: 'File PDF lớn hơn 24MB.' };
      let bin = '';
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      }
      return { ok: true, base64: btoa(bin), size: bytes.length, url: location.href, title: document.title };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  })();
}

async function grabTabPdf(tabId) {
  const [inj] = await chrome.scripting.executeScript({ target: { tabId }, func: grabPdfFromPage });
  const r = inj?.result;
  if (!r?.ok) throw new Error(r?.error || 'Không lấy được file PDF từ trang này.');
  const pdfKey = `pdfBlob:${Date.now().toString(36)}`;
  await kvSet(pdfKey, r.base64);
  return { pdfKey, size: r.size, url: r.url, title: r.title };
}

/* ---------------- Trích xuất + gợi ý chủ đề ---------------- */

async function runExtraction(rawSource) {
  const settings = await getSettings();
  const topics = await getTopics();

  // File PDF được cất trong IndexedDB để không phải đẩy vài MB qua message.
  const source = { ...rawSource };
  if (source.pdfKey) {
    source.pdfBase64 = await kvGet(source.pdfKey, null);
    if (!source.pdfBase64) throw new Error('Không tìm thấy dữ liệu PDF tạm (thử chọn lại file).');
  }

  let extraction; let meta;
  try {
    ({ extraction, meta } = await extractPaper({
      source,
      settings,
      topicNames: topics.map((t) => t.name),
    }));
  } finally {
    if (source.pdfKey) await kvSet(source.pdfKey, null);
  }

  const hay = [
    extraction.title, source.title,
    extraction.problem, extraction.bottleneck,
    extraction.key_idea?.summary,
    (extraction.tags || []).join(' '),
    (extraction.validation?.datasets || []).join(' '),
    (source.text || '').slice(0, 4000),
  ].filter(Boolean).join(' ');

  const suggestion = suggestTopic({ text: hay, topics, llmTopicName: extraction.suggested_topic });
  const dup = await findDuplicate({
    url: source.url,
    arxivId: source.arxivId,
    title: extraction.title || source.title,
  });

  const result = {
    extraction,
    meta,
    suggestion,
    topics,
    duplicate: dup
      ? { id: dup.id, title: dup.title, topicId: dup.topicId, updatedAt: dup.updatedAt }
      : null,
  };

  // Giữ lại kết quả để popup khôi phục nếu người dùng lỡ đóng popup giữa chừng.
  const { pdfBase64, ...leanSource } = source;
  await kvSet('lastExtraction', { result, source: leanSource, at: Date.now() });

  return result;
}

/* ---------------- Lưu ---------------- */

async function savePaper({ extraction, meta, source, topicId, newTopicName, userNotes, existingId }) {
  let finalTopicId = topicId;
  if (newTopicName && newTopicName.trim()) {
    const topics = await getTopics();
    const exists = topics.find((t) => t.name.toLowerCase() === newTopicName.trim().toLowerCase());
    finalTopicId = exists
      ? exists.id
      : (await putTopic({
          id: uid('t'),
          name: newTopicName.trim(),
          description: 'Thư mục do bạn tạo.',
          keywords: (extraction.tags || []).slice(0, 6),
          color: '#6b7cff',
        })).id;
  }

  // Ghi đè bản cũ: giữ lại ghi chú cá nhân, trạng thái, đánh giá và ngày tạo.
  const previous = existingId ? await getPaper(existingId) : null;

  const paper = {
    ...(previous || {}),
    id: previous?.id,
    createdAt: previous?.createdAt,
    title: extraction.title || source?.title || previous?.title || '(chưa có tên)',
    url: source?.url || previous?.url || '',
    arxivId: source?.arxivId || previous?.arxivId || '',
    topicId: finalTopicId || previous?.topicId || 't_inbox',
    extraction,
    meta,
    userNotes: (userNotes || '').trim() || previous?.userNotes || '',
    status: previous?.status || 'to-read',
    rating: previous?.rating || 0,
    sourceKind: source?.kind || '',
  };
  const saved = await putPaper(paper);
  await kvSet('lastExtraction', null);
  return { paper: saved, updated: !!previous };
}

/* ---------------- Router ---------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case 'scrape':
          return sendResponse({ ok: true, data: await scrapeTab(msg.tabId) });
        case 'extract':
          return sendResponse({ ok: true, data: await runExtraction(msg.source) });
        case 'grabTabPdf':
          return sendResponse({ ok: true, data: await grabTabPdf(msg.tabId) });
        case 'save':
          return sendResponse({ ok: true, data: await savePaper(msg.payload) });
        case 'testConnection':
          return sendResponse({ ok: true, data: await testConnection(msg.settings || (await getSettings())) });
        case 'openLibrary':
          await chrome.tabs.create({ url: LIBRARY_URL + (msg.query || '') });
          return sendResponse({ ok: true });
        default:
          return sendResponse({ ok: false, error: `Message không hỗ trợ: ${msg?.type}` });
      }
    } catch (e) {
      console.error('[PaperVault]', e);
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true; // giữ kênh mở cho phản hồi bất đồng bộ
});

/* ---------------- Context menu ---------------- */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'pv-selection',
      title: 'PaperVault: trích xuất đoạn đang chọn',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'pv-open',
      title: 'PaperVault: mở thư viện',
      contexts: ['action', 'page'],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'pv-open') {
    await chrome.tabs.create({ url: LIBRARY_URL });
    return;
  }
  if (info.menuItemId === 'pv-selection' && info.selectionText) {
    await kvSet('pendingPaste', {
      text: info.selectionText,
      url: tab?.url || info.pageUrl || '',
      title: tab?.title || '',
      at: Date.now(),
    });
    await chrome.tabs.create({ url: `${LIBRARY_URL}?paste=1` });
  }
});
