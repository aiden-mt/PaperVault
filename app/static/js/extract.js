// Luồng trích xuất dùng chung: chuẩn bị nguồn (text / PDF) -> gọi LLM -> gợi ý chủ đề -> kiểm tra trùng -> lưu.
import { api } from './api.js';
import { fixLanguage } from './langfix.js';
import { store, savePaper, saveTopic, findDuplicate, paperById } from './store.js';
import { extractPaper, NATIVE_PDF_PROVIDERS, hasCredentials, settingsFor, modelLabel } from './llm.js';
import { suggestTopic } from './topics.js';
import { extractPdfText, readFile, estimatePages } from './pdf.js';
import { bytesToBase64, uid } from './util.js';
import { emptyExtraction } from './schema.js';

/**
 * source: { url, title, authors, venue, year, arxivId, doi, kind, text, pdfBytes?, pdfId?, pdfName?, s2Id?, citationCount? }
 * onStatus(msg) nhận thông báo tiến trình.
 * Trả về { extraction, meta, suggestion, duplicate, source }.
 */
export async function runExtraction(rawSource, { onStatus = () => {} } = {}) {
  const settings = store.settings;
  const source = await prepareSource(rawSource, { onStatus });

  onStatus(`Đang gọi ${modelLabel(settings, 'extract')}… (10–90 giây)`);
  const { extraction, meta } = await extractPaper({
    source, settings, topicNames: store.topics.map((t) => t.name),
    onRetry: retryStatus(onStatus),
  });
  // Bản tiếng Anh không được lẫn tiếng Việt (prompt viết bằng tiếng Việt nên mô hình đôi khi chép cụm "Không nêu"…).
  if (extraction.lang === 'en') {
    onStatus('Đang soát phần tiếng Việt lẫn vào bản tiếng Anh…');
    const n = await fixLanguage(extraction, 'en');
    if (n) meta.langFixed = n;
  } else await fixLanguage(extraction, 'vi');

  const hay = [
    extraction.title, source.title, extraction.problem, extraction.bottleneck, extraction.key_idea?.summary,
    (extraction.tags || []).join(' '), (extraction.validation?.datasets || []).join(' '), (source.text || '').slice(0, 4000),
  ].filter(Boolean).join(' ');
  const suggestion = suggestTopic({ text: hay, topics: store.topics, llmTopicName: extraction.suggested_topic });
  const duplicate = findDuplicate({ url: source.url, arxivId: source.arxivId, title: extraction.title || source.title, exceptId: source.exceptId });

  const { pdfBase64, ...lean } = source;
  return { extraction, meta, suggestion, duplicate, source: lean };
}

const retryStatus = (onStatus) => (n, wait, e) => onStatus(`Bị giới hạn tốc độ / lỗi tạm (${e.status || 'mạng'}), thử lại lần ${n} sau ${Math.round(wait / 1000)}s…`);

/** Chuẩn bị nguồn gửi cho model: PDF dạng base64 (Claude/Gemini) hoặc text trích từ PDF. */
export async function prepareSource(rawSource, { onStatus = () => {} } = {}) {
  const settings = store.settings;
  if (!hasCredentials(settings)) throw new Error('Chưa có API key. Mở Cài đặt để nhập key trước.');
  const source = { ...rawSource };
  const native = NATIVE_PDF_PROVIDERS.has(settingsFor(settings, 'extract').provider) && settings.pdfMode !== 'text';

  if (source.pdfBytes || source.pdfId) {
    if (native) {
      onStatus('Đang chuẩn bị file PDF gửi cho model…');
      if (source.pdfBytes) source.pdfBase64 = bytesToBase64(source.pdfBytes);
      else source.pdfBase64 = (await api.pdfBase64(source.pdfId)).base64;
    }
    if ((!source.text || source.text.length < 120) && !native) {
      onStatus('Đang trích text từ PDF…');
      const bytes = source.pdfBytes || await api.pdfBytes(source.pdfId);
      const r = await extractPdfText(bytes);
      if (!r.text || r.text.length < 200) {
        throw new Error('Không trích được text từ PDF này (có thể là bản scan). Hãy dùng Claude/Gemini để gửi thẳng file PDF.');
      }
      source.text = r.text;
      source.kind = source.kind || 'text trích từ PDF';
      if (!r.readable) source.warning = 'Text trích từ PDF có nhiều ký tự lạ (font không kèm ToUnicode), kết quả có thể sai.';
    } else if (!source.text && native) {
      // vẫn thử trích text để lưu làm nội dung tìm kiếm / hỏi đáp về sau (không bắt buộc)
      try {
        const bytes = source.pdfBytes || await api.pdfBytes(source.pdfId);
        const r = await extractPdfText(bytes);
        if (r.text && r.text.length > 500 && r.readable) source.text = r.text;
      } catch (_) { /* bỏ qua */ }
    }
  }
  return source;
}

/**
 * Lưu kết quả trích xuất thành paper. Nếu existingId -> cập nhật, giữ ghi chú/trạng thái/đánh giá cũ.
 */
export async function savePaperFromExtraction({ extraction, meta, source, topicId, newTopicName, userNotes = '', existingId = null, status }) {
  let finalTopicId = topicId;
  if (newTopicName && newTopicName.trim()) {
    const exists = store.topics.find((t) => t.name.toLowerCase() === newTopicName.trim().toLowerCase());
    finalTopicId = exists ? exists.id : (await saveTopic({
      id: uid('t'), name: newTopicName.trim(), description: 'Thư mục do bạn tạo.',
      keywords: (extraction.tags || []).slice(0, 6), color: '#6b7cff',
    })).id;
  }

  // Nếu có PDF ở dạng bytes (chưa lưu) thì đẩy lên máy chủ để giữ lại.
  let pdfId = source.pdfId || null;
  let pdfName = source.pdfName || null;
  if (!pdfId && source.pdfBytes) {
    const up = await api.uploadPdf(source.pdfBytes, source.pdfName || `${extraction.title || 'paper'}.pdf`);
    pdfId = up.id;
    pdfName = up.name;
  }

  const previous = existingId ? paperById(existingId) : null;
  const paper = {
    ...(previous || {}),
    id: previous?.id,
    createdAt: previous?.createdAt,
    title: extraction.title || source.title || previous?.title || '(chưa có tên)',
    url: source.url || previous?.url || '',
    arxivId: source.arxivId || previous?.arxivId || '',
    doi: source.doi || previous?.doi || cleanDoi(extraction.doi),
    s2Id: source.s2Id || previous?.s2Id || '',
    citationCount: source.citationCount ?? previous?.citationCount ?? null,
    topicId: finalTopicId || previous?.topicId || 't_inbox',
    topicIds: previous?.topicIds || [],
    extraction,
    meta,
    userNotes: (userNotes || '').trim() || previous?.userNotes || '',
    status: status || previous?.status || 'to-read',
    rating: previous?.rating || 0,
    sourceKind: source.kind || previous?.sourceKind || '',
    pdfId: pdfId || previous?.pdfId || null,
    pdfName: pdfName || previous?.pdfName || null,
    sourceText: source.text || undefined,
    needsExtraction: false,
    venueRaw: source.venue || previous?.venueRaw || '',
    venueHints: (source.venueHints && Object.keys(source.venueHints).length) ? source.venueHints : (previous?.venueHints || null),
  };
  const saved = await savePaper(paper);
  return { paper: saved, updated: !!previous };
}

/** Đọc file PDF từ người dùng -> { pdfBytes, pdfName, size, pages }. */
export async function acceptPdfFile(file) {
  if (file.size > 32 * 1024 * 1024) throw new Error('File PDF lớn hơn 32MB, model sẽ từ chối. Hãy cắt bớt trang.');
  const bytes = await readFile(file);
  return { pdfBytes: bytes, pdfName: file.name, size: bytes.length, pages: estimatePages(bytes) };
}

/** Từ chuỗi người dùng nhập (arXiv/DOI/URL) -> source, tự tải PDF nếu có và provider nhận PDF. */
export async function resolveQuery(query, { onStatus = () => {}, wantPdf = true } = {}) {
  onStatus('Đang tra cứu nguồn…');
  const r = await api.resolve(query);
  const source = {
    url: r.url || (query.startsWith('http') ? query : ''),
    title: r.title || '', authors: r.authors || '', venue: r.venue || '', year: r.year || '',
    arxivId: r.arxivId || '', doi: r.doi || '', s2Id: r.s2Id || '', citationCount: r.citationCount ?? null,
    kind: r.kind || '', text: r.text || '', pdfUrl: r.pdfUrl || '', warnings: r.warnings || [], tldr: r.tldr || '',
    venueHints: r.venueHints || {},
  };
  const settings = store.settings;
  const native = NATIVE_PDF_PROVIDERS.has(settingsFor(settings, 'extract').provider) && settings.pdfMode !== 'text';
  const needFullText = !/full text/i.test(source.kind || '');
  if (wantPdf && source.pdfUrl && (native || needFullText)) {
    try {
      onStatus('Đang tải file PDF…');
      const f = await api.fetchUrl(source.pdfUrl, true);
      if (f.isPdf) {
        const bin = atob(f.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        source.pdfBytes = bytes;
        source.pdfName = `${source.arxivId || source.title || 'paper'}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
        if (!native && needFullText) {
          onStatus('Đang trích text từ PDF…');
          const t = await extractPdfText(bytes);
          if (t.text && t.text.length > (source.text || '').length && t.readable) {
            source.text = t.text;
            source.kind = 'full text (trích từ PDF)';
          }
        } else if (native && needFullText) {
          source.kind = `${source.kind || 'abstract'} + file PDF`;
        }
      }
    } catch (e) {
      source.warnings.push(`Không tải được PDF: ${e.message}`);
    }
  }
  return source;
}

/**
 * Tạo paper chỉ có metadata (chưa trích xuất) từ mục BibTeX/RIS hoặc kết quả arXiv — nhanh, không tốn token.
 * entry: { title, authors, year, venue, doi, arxivId, url, abstract, keywords }
 */
export async function saveMetadataOnly(entry, { topicId = 't_inbox', status = 'to-read' } = {}) {
  const e = emptyExtraction();
  e.title = entry.title || '';
  e.authors = (entry.authors || []).slice(0, 8);
  e.year = entry.year || '';
  e.venue = entry.venue || '';
  e.one_liner = (entry.abstract || '').slice(0, 300);
  e.tags = (entry.keywords || []).slice(0, 6);
  e.confidence = 'thấp';
  const paper = {
    title: entry.title || '(chưa có tên)',
    url: entry.url || '', arxivId: entry.arxivId || '', doi: entry.doi || '',
    topicId, extraction: e, meta: null, userNotes: '', status, rating: 0,
    sourceKind: entry.abstract ? 'abstract (nhập từ thư viện)' : 'chỉ metadata',
    venueRaw: entry.venue || '',
    venueHints: entry.type ? { bibType: entry.type } : (entry.venueHints || null),
    sourceText: entry.abstract ? `Title: ${entry.title}\nAuthors: ${(entry.authors || []).join(', ')}\n\nAbstract:\n${entry.abstract}` : undefined,
    needsExtraction: true,
  };
  return savePaper(paper);
}

/** DOI model đọc được trong paper: chỉ nhận chuỗi đúng dạng 10.xxxx/..., bỏ tiền tố https://doi.org/. */
function cleanDoi(s) {
  const m = String(s || '').match(/10\.\d{4,9}\/[^\s"<>]+/);
  return m ? m[0].replace(/[.,;)]+$/, '') : '';
}
