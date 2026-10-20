// Dịch đoạn bôi đen theo ngữ cảnh câu, kế thừa extension "Dịch Khi Bôi Đen".
//
// Dịch riêng một từ thường sai nghĩa ("spring" luôn ra "mùa xuân"). Nên gửi kèm cả câu, hai bản song song:
// câu để trơn (nguồn đáng tin) và câu có đánh dấu *từ* (để tách đúng phần tương ứng). Chỉ tin phần tách ra
// khi nó nằm trong bản dịch câu để trơn. Lệch nhau thì dịch ngược từng cụm 1-4 từ quanh vị trí ước lượng,
// cụm nào quay về đúng đoạn đã chọn chính là nó. Cuối cùng mới rơi về nghĩa khi đứng riêng hoặc cả câu.
import { api } from './api.js';

const MARK = '*';
const MARKED_RE = /\*([^*]+)\*/;
const WORD_EDGES = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const MAX_WINDOW_WORDS = 4;
const WINDOW_SPAN = 10;
const CACHE_LIMIT = 300;

const cache = new Map();
const inflight = new Map();

function share(key, start) {
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (inflight.has(key)) return inflight.get(key);
  const job = start()
    .then((v) => {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
      cache.set(key, v);
      return v;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

const normalizeWord = (w) => String(w || '').replace(WORD_EDGES, '').toLowerCase();

/** Dọn chữ lấy từ PDF: bỏ dấu *, gộp khoảng trắng, nối từ bị ngắt dòng bằng gạch nối ("com- pile"). */
export function cleanText(text) {
  return String(text || '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(\p{L})-\s+(\p{Ll})/gu, '$1$2')
    .trim();
}

function phraseWindows(sentence, focus) {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const center = Math.round(focus * words.length);
  const from = Math.max(0, center - WINDOW_SPAN);
  const to = Math.min(words.length, center + WINDOW_SPAN);
  const seen = new Set();
  for (let start = from; start < to; start += 1) {
    for (let size = 1; size <= MAX_WINDOW_WORDS && start + size <= words.length; size += 1) {
      const phrase = words.slice(start, start + size).join(' ').replace(WORD_EDGES, '');
      if (phrase) seen.add(phrase);
    }
  }
  return [...seen];
}

async function locateByBackTranslation(selection, plain, tl, focus) {
  const source = plain.detected;
  if (!source || source === 'auto' || source === tl) return null;
  const windows = phraseWindows(plain.translated, focus);
  if (windows.length < 2) return null;
  let back;
  try { back = (await api.translate(windows, source, tl)).items; } catch (_) { return null; }
  const wanted = normalizeWord(selection);
  let best = null;
  windows.forEach((phrase, i) => {
    if (normalizeWord(back[i]?.translated) !== wanted) return;
    if (!best || phrase.length < best.length) best = phrase;
  });
  return best;
}

/**
 * text: đoạn đã chọn. context: { before, after } (câu xung quanh) hoặc null. tl: ngôn ngữ đích.
 * Trả về { translated, detected, sentence?, highlight?, usedContext, standalone?, sentenceOnly?, engine }.
 */
export function translateSelection({ text, context, tl = 'vi' }) {
  const selection = cleanText(text);
  const key = `${tl}|${context?.before || ''}|${selection}|${context?.after || ''}`;
  return share(key, async () => {
    if (!context || (!context.before && !context.after)) {
      const r = await api.translate([selection], tl);
      const it = r.items[0] || {};
      if (!it.translated) throw new Error('Không nhận được bản dịch.');
      return { ...it, engine: r.engine, usedContext: false };
    }
    const join = (middle) => [context.before, middle, context.after].filter(Boolean).join(' ');
    // Câu để trơn + câu đánh dấu + từ đứng riêng đi chung một lượt gọi.
    const r = await api.translate([join(selection), join(MARK + selection + MARK), selection], tl);
    const [plain, marked, alone] = r.items;
    if (!plain?.translated) throw new Error('Không nhận được bản dịch.');
    const base = { ...plain, engine: r.engine, sentence: plain.translated };

    const m = marked && MARKED_RE.exec(marked.translated || '');
    const segment = m ? m[1].trim() : '';
    if (segment && plain.translated.toLowerCase().includes(segment.toLowerCase())) {
      return { ...base, translated: segment, highlight: segment, usedContext: true };
    }
    const focus = (context.before.length + selection.length / 2) / (context.before.length + selection.length + context.after.length || 1);
    const recovered = await locateByBackTranslation(selection, plain, tl, focus);
    if (recovered) return { ...base, translated: recovered, highlight: recovered, usedContext: true };
    if (alone?.translated) return { ...base, translated: alone.translated, standalone: true, usedContext: false };
    return { ...plain, engine: r.engine, sentenceOnly: true, usedContext: false };
  });
}

export const TRANSLATE_LANGS = [
  ['vi', 'Tiếng Việt'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['zh-CN', '中文 (giản thể)'],
  ['zh-TW', '中文 (phồn thể)'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['ru', 'Русский'], ['th', 'ไทย'],
];

// appWide: bôi đen để dịch ở mọi trang của app (selection-translate.js), không chỉ trong trình đọc PDF.
export const TRANSLATE_DEFAULTS = { targetLang: 'vi', mode: 'button', openOn: 'hover', useContext: true, showOriginal: true, appWide: true };

export function translateConfig(settings) {
  return { ...TRANSLATE_DEFAULTS, ...(settings?.translate || {}) };
}
