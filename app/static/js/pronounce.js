// Phát âm tiếng Anh cho bong bóng dịch (cả trang app lẫn trình đọc PDF):
//  - Phiên âm IPA tách rõ giọng Anh-Mỹ (US) và Anh-Anh (UK): Wiktionary, dự phòng từ điển CMU (Anh-Mỹ) và dictionaryapi.dev.
//  - Nghe / tải MP3 theo từng giọng: từ đơn có bản ghi âm người thật đúng giọng thì dùng bản ghi âm,
//    còn lại là giọng đọc của Google Dịch (en-US / en-GB). Âm thanh lấy qua máy chủ của app và được lưu lại.
// Không phụ thuộc module khác để dùng được trong iframe của trình đọc PDF.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c]);

const MAX_WORDS = 4;
const MAX_SPEAK = 600;
const ORIGIN = location.origin;
const ACCENTS = [
  { key: 'us', region: 'US', name: 'Anh-Mỹ', tag: 'en-US' },
  { key: 'uk', region: 'UK', name: 'Anh-Anh', tag: 'en-GB' },
];
const cache = new Map();

const isEnglish = (lang) => !lang || lang === 'auto' || /^en/i.test(lang);

/** Các từ cần tra phiên âm, hoặc null nếu đoạn không phải từ / cụm tiếng Anh ngắn. */
export function phoneticWords(text, lang = '') {
  if (!isEnglish(lang)) return null;
  const words = String(text || '').trim().split(/\s+/).map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ''));
  if (!words.length || words.length > MAX_WORDS || !words.every((w) => /^[A-Za-z][A-Za-z'’-]*$/.test(w))) return null;
  return words;
}

async function lookup(word) {
  const k = word.toLowerCase();
  if (!cache.has(k)) {
    const p = fetch(`${ORIGIN}/api/dict?w=${encodeURIComponent(k)}`).then((r) => r.json()).then((j) => (j.ok ? j.data : {})).catch(() => ({}));
    cache.set(k, p);
    // Kết quả rỗng (nguồn lỗi tạm thời) không giữ lại, lần bôi đen sau tra lại.
    p.then((d) => { if (!Object.keys(d?.ipa || {}).length) cache.delete(k); });
  }
  return cache.get(k);
}

/**
 * Phiên âm cho một từ hoặc cụm ngắn: { words, us, uk, recUS, recUK, src }.
 * us / uk là dòng phiên âm của cả cụm theo từng giọng ('' nếu có từ chưa có phiên âm giọng đó).
 */
export async function lookupPronunciation(text, lang) {
  const words = phoneticWords(text, lang);
  if (!words) return null;
  const rows = await Promise.all(words.map(async (w) => ({ word: w, d: await lookup(w) })));
  const of = (r, region) => r.d.ipa?.[region] || r.d.ipa?.both || '';
  const line = (region) => (rows.every((r) => of(r, region)) ? rows.map((r) => of(r, region).replace(/^[/[]|[/\]]$/g, '')).join(' ') : '');
  const one = rows.length === 1 ? rows[0].d : null;
  const hasRec = (region) => !!one && (one.audio || []).some((a) => a.region === region);
  const srcs = [...new Set(rows.map((r) => r.d.src).filter(Boolean))];
  return { words: rows.map((r) => r.word), us: line('US'), uk: line('UK'), recUS: hasRec('US'), recUK: hasRec('UK'), src: srcs.join(', ') };
}

/* ---------- Nghe và tải ---------- */

let current = null;
const ttsUrl = (text, accent, dl = false) => `${ORIGIN}/api/tts?q=${encodeURIComponent(String(text).slice(0, MAX_SPEAK))}&accent=${accent}${dl ? '&dl=1' : ''}`;

export function stopSpeaking() {
  if (current) { try { current.pause?.(); } catch (_) { /* bỏ qua */ } current = null; }
  try { window.speechSynthesis?.cancel(); } catch (_) { /* bỏ qua */ }
}

/** Dự phòng khi không lấy được âm thanh từ máy chủ: giọng của hệ điều hành, đúng giọng Anh-Mỹ / Anh-Anh nếu máy có. */
function speakLocal(text, tag) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const u = new SpeechSynthesisUtterance(String(text).slice(0, MAX_SPEAK));
  u.lang = tag;
  const v = (synth.getVoices() || []).find((x) => x.lang === tag && /natural|neural|online/i.test(x.name)) || (synth.getVoices() || []).find((x) => x.lang === tag);
  if (v) u.voice = v;
  synth.speak(u);
}

const audioCache = new Map(); // "accent|text" -> Promise<{ url, src }>

/** Lấy âm thanh (một lần cho mỗi đoạn + giọng) kèm nguồn thật: 'rec' bản ghi âm người thật, 'tts' giọng đọc. */
function fetchAudio(text, accent) {
  const k = `${accent}|${text}`;
  if (!audioCache.has(k)) {
    const p = fetch(ttsUrl(text, accent)).then(async (r) => {
      if (!r.ok) throw new Error('tts');
      return { url: URL.createObjectURL(await r.blob()), src: r.headers.get('X-Audio-Source') || 'tts' };
    });
    audioCache.set(k, p);
    p.catch(() => audioCache.delete(k));
  }
  return audioCache.get(k);
}

/** Phát đoạn tiếng Anh theo giọng ('us' | 'uk'). onState(playing, src) để đổi trạng thái nút và nhãn nguồn. */
export function play(text, accent, onState) {
  stopSpeaking();
  const acc = ACCENTS.find((a) => a.key === accent) || ACCENTS[0];
  onState?.(true, '');
  const token = {};
  current = token;
  fetchAudio(text, acc.key).then(({ url, src }) => {
    if (current !== token) return;
    const audio = new Audio(url);
    current = audio;
    onState?.(true, src);
    audio.addEventListener('ended', () => onState?.(false, src));
    audio.play().catch(() => { onState?.(false, src); speakLocal(text, acc.tag); });
  }).catch(() => { if (current === token) { onState?.(false, 'local'); speakLocal(text, acc.tag); } });
}

/** Tải MP3 của đoạn theo giọng. Trong app dùng hộp thoại "Lưu thành" của app; nơi khác tải xuống thường. */
export async function downloadAudio(text, accent) {
  const acc = ACCENTS.find((a) => a.key === accent) || ACCENTS[0];
  const name = `${String(text).replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '') || 'phat-am'}-${acc.key === 'uk' ? 'anh-anh' : 'anh-my'}.mp3`;
  const res = await fetch(ttsUrl(text, acc.key, true));
  if (!res.ok) throw new Error('Không tạo được file âm thanh.');
  const blob = await res.blob();
  const host = (() => { try { return window.top?.pvDownload; } catch (_) { return null; } })();
  if (host) return host(name, blob, 'audio/mpeg');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

/* ---------- Giao diện trong bong bóng ---------- */

/** Khối phát âm của đoạn gốc tiếng Anh: mỗi giọng một dòng (nhãn giọng, phiên âm, nguồn âm thanh, nút nghe / tải). */
export function pronunciationHtml(state) {
  const text = state.original || '';
  if (!text || !isEnglish(state.detected) || text.length > MAX_SPEAK) return '';
  const p = state.pron;
  const short = !!phoneticWords(text, state.detected);
  const rows = ACCENTS.map((a) => {
    const ipa = p ? p[a.key] : '';
    const rec = p ? p[`rec${a.region}`] : false;
    const ipaHtml = !short ? ''
      : ipa ? `<span class="pv-ipa" title="Phiên âm quốc tế (IPA) giọng ${a.name}">/${esc(ipa)}/</span>`
        : `<span class="pv-ipa pv-ipa-none">${state.pronLoading ? 'đang tra…' : `chưa có phiên âm ${a.name}`}</span>`;
    const src = rec ? 'người thật' : 'giọng đọc';
    const srcTip = rec ? `Bản ghi âm người bản xứ giọng ${a.name} (từ điển); nếu tạm thời không tải được sẽ dùng giọng đọc của Google` : `Giọng đọc của Google, giọng ${a.name} (${a.tag})`;
    return `<div class="pv-acc pv-acc-${a.key}">
      <span class="pv-acc-k" title="${a.tag}">${a.region}</span><span class="pv-acc-n">${a.name}</span>${ipaHtml}
      <span class="pv-acc-src" title="${esc(srcTip)}">${src}</span>
      <button type="button" class="pv-speak" data-act="say-${a.key}" title="Nghe giọng ${a.name}">▶ Nghe</button>
      <button type="button" class="pv-speak pv-dl" data-act="dl-${a.key}" title="Tải file MP3 giọng ${a.name}">⬇</button></div>`;
  }).join('');
  const word = short ? `<div class="pv-pron-w">${esc(text)}${p?.src ? `<span class="pv-pron-src" title="Nguồn phiên âm">${esc(p.src)}</span>` : ''}</div>` : '<div class="pv-pron-w pv-pron-long">Nghe đoạn gốc</div>';
  return `<div class="pv-pron">${word}${rows}</div>`;
}

/** Xử lý các nút nghe / tải trong bong bóng. Trả về true nếu đã xử lý. */
export function handleSpeakAction(act, state, btn) {
  const m = /^(say|dl)-(us|uk)$/.exec(act || '');
  if (!m) return false;
  const text = state.original || '';
  if (m[1] === 'say') {
    play(text, m[2], (on, src) => {
      if (!btn) return;
      btn.classList.toggle('on', on);
      btn.textContent = on ? '■ Đang phát' : '▶ Nghe';
      // Nhãn nguồn theo âm thanh thật sự nhận được.
      const tag = btn.closest('.pv-acc')?.querySelector('.pv-acc-src');
      const name = ACCENTS.find((a) => a.key === m[2]).name;
      if (tag && src) {
        tag.textContent = { rec: 'người thật', tts: 'giọng đọc', local: 'giọng máy tính' }[src] || 'giọng đọc';
        tag.title = { rec: `Bản ghi âm người bản xứ giọng ${name} (từ điển)`, tts: `Giọng đọc của Google, giọng ${name}`, local: `Không lấy được âm thanh từ máy chủ, đang dùng giọng có sẵn của máy tính (${name} nếu máy có)` }[src] || '';
      }
    });
  } else {
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    downloadAudio(text, m[2]).catch(() => {}).finally(() => { if (btn) { btn.disabled = false; btn.textContent = '⬇'; } });
  }
  return true;
}
