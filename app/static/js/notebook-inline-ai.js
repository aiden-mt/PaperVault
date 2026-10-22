// AI nhanh trong Sổ tay (giống Notion AI): làm việc ngay trên một đoạn — cải thiện, rút gọn, giải thích, dịch, chuyển
// thành bảng… — hoặc viết mới ở chỗ con trỏ. Menu nổi cạnh đoạn, kết quả hiện ngay bên dưới với các nút Thay thế /
// Chèn bên dưới / Thử lại, có ô "Bảo AI sửa tiếp". Người dùng lưu được yêu cầu riêng thành prompt nhanh.
import { store, paperById, saveSettings } from './store.js';
import { toast } from './ui.js';
import { escapeHtml, clampText, fixMixedScript, copyText, norm } from './util.js';
import { streamChat, hasCredentials } from './llm.js';
import { paperNotesText } from './prompts.js';
import { parseLinks, renderNote, paperShort } from './notebook.js';

const EDIT = [
  { id: 'improve', g: 'Chỉnh đoạn', icon: '✎', label: 'Cải thiện văn phong', mode: 'replace', p: 'Viết lại đoạn cho rõ ràng, mạch lạc, tự nhiên hơn. Giữ nguyên ý, số liệu và thuật ngữ.' },
  { id: 'fix', icon: '✓', label: 'Sửa chính tả & ngữ pháp', mode: 'replace', p: 'Chỉ sửa lỗi chính tả, ngữ pháp, dấu câu. Không đổi ý, không đổi cách diễn đạt.' },
  { id: 'shorter', icon: '−', label: 'Viết ngắn lại', mode: 'replace', p: 'Rút gọn còn khoảng một nửa độ dài, giữ ý chính và số liệu.' },
  { id: 'longer', icon: '+', label: 'Viết chi tiết hơn', mode: 'replace', p: 'Viết chi tiết hơn: thêm giải thích, bước trung gian, ví dụ ngắn. Không bịa số liệu.' },
  { id: 'academic', icon: 'Aa', label: 'Giọng văn học thuật', mode: 'replace', p: 'Viết lại theo văn phong học thuật như trong bài báo khoa học: chính xác, khách quan, mạch lạc.' },
  { id: 'simple', icon: '≈', label: 'Viết dễ hiểu hơn', mode: 'replace', p: 'Viết lại cho người mới dễ hiểu: câu ngắn, giải thích thuật ngữ khi cần.' },
  { id: 'summary', g: 'Tạo từ đoạn', icon: 'Σ', label: 'Tóm tắt', mode: 'below', p: 'Tóm tắt đoạn trong 2–4 câu.' },
  { id: 'explain', icon: '?', label: 'Giải thích', mode: 'below', p: 'Giải thích đoạn này: khái niệm chính, cơ chế hoạt động, kèm một ví dụ minh hoạ ngắn.' },
  { id: 'bullets', icon: '•', label: 'Rút ý chính', mode: 'below', p: 'Rút các ý chính thành danh sách gạch đầu dòng ngắn.' },
  { id: 'table', icon: '▦', label: 'Chuyển thành bảng', mode: 'below', p: 'Chuyển nội dung thành một bảng Markdown hợp lý.' },
  { id: 'quiz', icon: 'Q', label: 'Tạo câu hỏi ôn tập', mode: 'below', p: 'Tạo 3–5 câu hỏi ôn tập kèm đáp án ngắn từ đoạn này (danh sách, đáp án in nghiêng).' },
  { id: 'critique', icon: '!', label: 'Phản biện, tìm điểm yếu', mode: 'below', p: 'Chỉ ra giả định ngầm, điểm yếu và chỗ cần kiểm chứng trong đoạn này.' },
  { id: 'cite', icon: '@', label: 'Bổ sung dẫn chứng từ paper trong trang', mode: 'below', papers: true, p: 'Dựa trên các paper được cung cấp, bổ sung dẫn chứng hoặc số liệu cho các ý trong đoạn; mỗi dẫn chứng gắn liên kết paper dạng [[@id]] ngay sau câu.' },
  { id: 'en', g: 'Dịch', icon: 'EN', label: 'Dịch sang tiếng Anh', mode: 'below', p: 'Dịch sang tiếng Anh học thuật.' },
  { id: 'vi', icon: 'VI', label: 'Dịch sang tiếng Việt', mode: 'below', p: 'Dịch sang tiếng Việt; giữ thuật ngữ tiếng Anh quan trọng trong ngoặc khi cần.' },
];
const WRITE = [
  { id: 'continue', g: 'Viết với AI', icon: '→', label: 'Viết tiếp', p: 'Viết tiếp trang từ chỗ con trỏ, theo mạch đang có (1–3 đoạn).' },
  { id: 'outline', icon: '≡', label: 'Lập dàn ý cho trang', p: 'Lập dàn ý (tiêu đề ## và gạch đầu dòng) cho trang, dựa trên tiêu đề và nội dung hiện có.' },
  { id: 'pagesum', icon: 'Σ', label: 'Tóm tắt cả trang', p: 'Tóm tắt toàn bộ trang trong 3–5 gạch đầu dòng.' },
  { id: 'brainstorm', icon: '✱', label: 'Brainstorm ý tưởng', p: 'Đưa ra 5–7 ý tưởng nghiên cứu hoặc thí nghiệm liên quan tới nội dung trang, mỗi ý một dòng kèm lý do ngắn.' },
  { id: 'cmp', icon: '▦', label: 'Bảng so sánh paper trong trang', papers: true, p: 'Lập bảng so sánh các paper được cung cấp: bài toán, phương pháp, dataset, kết quả chính, hạn chế. Cột đầu là liên kết [[@id]].' },
  { id: 'todo', icon: '☐', label: 'Danh sách việc cần làm', p: 'Từ nội dung trang, đề xuất danh sách việc cần làm dạng "- [ ] ...".' },
];

const SYSTEM = [
  'Bạn là trợ lý viết trong Sổ tay nghiên cứu (Markdown) của một nhà nghiên cứu AI.',
  '- Chỉ trả về nội dung kết quả bằng Markdown, sẵn sàng chèn thẳng vào trang. Không mở đầu kiểu "Đây là…", không giải thích thêm, không bọc kết quả trong ```.',
  '- Với yêu cầu sửa một đoạn: giữ ngôn ngữ gốc của đoạn (trừ khi yêu cầu dịch); giữ nguyên công thức LaTeX ($...$, $$...$$), liên kết [[...]], mã nguồn và số liệu.',
  '- Khi viết mới: dùng ngôn ngữ chính của trang.',
  '- Không bịa số liệu hay trích dẫn. Chỉ dẫn paper bằng [[@id]] khi paper đó có trong tài liệu được cung cấp.',
  '- Không viết tiêu đề cấp 1.',
].join('\n');

let cur = null; // { el, close }
const zoom = () => parseFloat(getComputedStyle(document.body).zoom) || 1;
const myPrompts = () => (Array.isArray(store.settings.nbPrompts) ? store.settings.nbPrompts : []);

/** Chữ thuần của một đoạn Markdown để xem trước: bỏ ký hiệu đầu dòng, callout, liên kết, đậm / nghiêng. */
function plainPreview(md) {
  return String(md || '')
    .replace(/^\s*>?\s*\[!\w+\][+-]?\s*/gm, '')
    .replace(/^\s*(?:>\s*)+/gm, '')
    .replace(/^\s*(?:#{1,6}|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/!?\[\[(@?)([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, at, a, b) => b || (at && paperById(a) ? paperShort(paperById(a)) : a))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|~~|==|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Bỏ khối ``` bao ngoài nếu model lỡ bọc kết quả. */
function unwrap(md) {
  const m = /^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/.exec(md);
  return (m ? m[1] : md).trim();
}

/**
 * Mở menu AI nhanh ở toạ độ màn hình (x, y).
 * kind 'edit': text là đoạn đang chọn, apply.replace / apply.below. kind 'write': viết mới ở chỗ con trỏ, apply.insert.
 * page: { title, content, cursor } — cursor là vị trí con trỏ trong content (để AI biết đang viết ở đâu).
 */
export function openInlineAI({ x, y, kind = 'edit', text = '', page = {}, apply = {}, openFull = null }) {
  cur?.close();
  const z = zoom();
  const el = document.createElement('div');
  el.className = 'nbq';
  document.body.appendChild(el);
  const st = { view: 'menu', q: '', i: 0, items: [], action: null, prompt: '', out: '', history: [], abort: null, busy: false };
  const place = () => {
    const vw = window.innerWidth / z;
    const vh = window.innerHeight / z;
    const below = vh - (y / z + 6) - 10;   // chỗ trống dưới đoạn
    const above = y / z - 34 - 10;         // chỗ trống trên đoạn (chừa dòng đang chọn)
    if (!st.side) st.side = below >= Math.min(380, above) ? 'below' : 'above';
    const room = Math.max(200, st.side === 'below' ? below : above);
    el.style.maxHeight = `${Math.min(st.view === 'result' ? 560 : 460, room)}px`;
    const w = el.offsetWidth;
    el.style.left = `${Math.max(8, Math.min(x / z, vw - w - 8))}px`;
    if (st.side === 'below') { el.style.top = `${Math.min(y / z + 6, vh - 210)}px`; el.style.bottom = 'auto'; }
    else { el.style.bottom = `${Math.max(8, vh - (y / z - 34))}px`; el.style.top = 'auto'; }
  };
  const list = kind === 'edit' ? EDIT : WRITE;
  const words = String(text || '').trim() ? String(text).trim().split(/\s+/).length : 0;
  const close = () => {
    st.abort?.abort();
    el.remove();
    document.removeEventListener('pointerdown', onOut, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('hashchange', close);
    if (cur?.el === el) cur = null;
  };
  const onOut = (e) => { if (!el.contains(e.target)) close(); };
  cur = { el, close };

  /* ---------- menu ---------- */
  function filtered() {
    const q = norm(st.q.trim());
    const mine = myPrompts().map((p, i) => ({ ...p, id: `mine${i}`, mine: i, icon: '★', g: 'Prompt của tôi', mode: p.mode || (kind === 'edit' ? 'replace' : 'below') }));
    const all = [...list, ...mine];
    const hits = q ? all.filter((a) => norm(a.label).includes(q) || (a.mine != null && norm(a.p).includes(q))) : all;
    return st.q.trim() ? [{ id: 'custom', icon: '↵', label: `Hỏi AI: “${st.q.trim()}”`, p: st.q.trim(), mode: kind === 'edit' ? 'below' : 'below', custom: true }, ...hits] : hits;
  }
  function drawMenu() {
    st.items = filtered();
    if (st.i >= st.items.length) st.i = 0;
    let lastG = '';
    const rows = st.items.map((a, k) => {
      const g = a.custom ? '' : (a.g || lastG);
      const head = g && g !== lastG ? `<div class="nbq-g">${escapeHtml(g)}</div>` : '';
      if (g) lastG = g;
      return `${head}<button type="button" class="nbq-it ${k === st.i ? 'on' : ''}" data-k="${k}"><span class="nbq-ic">${a.icon}</span><span class="nbq-l">${escapeHtml(a.label)}</span>${a.mine != null ? `<span class="nbq-del" data-del="${a.mine}" title="Xoá prompt này">✕</span>` : ''}</button>`;
    }).join('');
    el.innerHTML = `<div class="nbq-in"><span>✨</span><input id="nbq-q" placeholder="${kind === 'edit' ? 'Bảo AI làm gì với đoạn này…' : 'Bảo AI viết gì…'}" value="${escapeHtml(st.q)}" autocomplete="off"></div>
      ${kind === 'edit' ? `<div class="nbq-sel" title="${escapeHtml(clampText(text, 600))}"><span class="nbq-sel-k">Đoạn chọn · ${words} từ</span><span class="nbq-sel-t">${escapeHtml(clampText(plainPreview(text), 160))}</span></div>` : ''}
      <div class="nbq-list">${rows || '<div class="hint nbq-none">Không có mục khớp. Nhấn Enter để hỏi AI theo câu bạn gõ.</div>'}</div>
      <div class="nbq-foot">${st.q.trim() ? '<button type="button" class="sm ghost" data-save>⭐ Lưu thành prompt nhanh</button>' : ''}${openFull ? '<button type="button" class="sm ghost" data-full title="Chọn paper và trang ghi chú làm nguồn, tìm đoạn liên quan trong toàn văn">📚 Hỏi với nguồn (paper, ghi chú)…</button>' : ''}<span class="hint">↑↓ chọn · Enter chạy · Esc đóng</span></div>`;
    const inp = el.querySelector('#nbq-q');
    inp.addEventListener('input', () => { st.q = inp.value; st.i = st.q.trim() && filtered().length > 1 ? 1 : 0; const pos = inp.selectionStart; drawMenu(); const n = el.querySelector('#nbq-q'); n.focus(); n.setSelectionRange(pos, pos); });
    place();
  }

  /* ---------- chạy ---------- */
  function contextMsg(a) {
    const content = String(page.content || '');
    const parts = [];
    if (kind === 'edit') {
      const at = content.indexOf(text);
      const before = at >= 0 ? content.slice(Math.max(0, at - 1500), at) : '';
      const after = at >= 0 ? content.slice(at + text.length, at + text.length + 800) : '';
      parts.push(`<page title="${escapeHtml(page.title || '')}">`, before ? `…${before}` : '', `<selected>\n${text}\n</selected>`, after ? `${after}…` : '', '</page>');
    } else {
      const c = Number.isFinite(page.cursor) ? page.cursor : content.length;
      parts.push(`<page title="${escapeHtml(page.title || '')}">`, clampText(`${content.slice(0, c)}⟦CON TRỎ⟧${content.slice(c)}`, 14000), '</page>', 'Chỗ cần viết là ⟦CON TRỎ⟧.');
    }
    if (a.papers || /\[\[@/.test(a.p)) {
      const ids = [...parseLinks(content).papers].filter((id) => paperById(id)).slice(0, 8);
      if (ids.length) parts.push(`Các paper được nhắc trong trang (id dùng để dẫn: [[@id]]):\n${ids.map((id) => `${paperNotesText(paperById(id), `@${id}`)}\n</paper>`).join('\n')}`);
      else parts.push('(Trang chưa nhắc tới paper nào trong thư viện.)');
    }
    parts.push(`Yêu cầu: ${a.p}${kind === 'edit' ? ' (áp dụng cho đoạn trong <selected>)' : ''}`);
    return parts.filter(Boolean).join('\n');
  }
  async function run(a, refine = '') {
    if (!hasCredentials(store.settings, 'notebook-inline')) { toast('Chưa có API key. Mở Cài đặt để nhập key.', 4000, 'err'); return; }
    st.view = 'result';
    st.action = a;
    st.busy = true;
    st.out = '';
    st.abort = new AbortController();
    const messages = refine
      ? [...st.history, { role: 'user', content: `Sửa lại kết quả vừa rồi theo yêu cầu: ${refine}. Chỉ trả về bản đã sửa.` }]
      : [{ role: 'user', content: contextMsg(a) }];
    drawResult();
    try {
      let raf = 0;
      await streamChat({
        settings: store.settings, system: [{ text: SYSTEM }], messages, signal: st.abort.signal, task: 'notebook-inline',
        onText: (t) => { st.out += t; if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintOut(); }); },
      });
      st.out = unwrap(fixMixedScript(st.out));
      st.history = [...messages, { role: 'assistant', content: st.out }];
    } catch (e) {
      if (e.name !== 'AbortError') { st.err = e.message || String(e); }
    } finally {
      st.busy = false;
      st.abort = null;
      drawResult();
    }
  }
  function paintOut() {
    const box = el.querySelector('.nbq-out');
    if (!box) return;
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 40; // đang ở cuối thì đi theo chữ mới
    box.innerHTML = st.out ? renderNote(unwrap(st.out)) : '<div class="nbq-wait"><span class="spin"></span> AI đang đọc đoạn và viết…</div>';
    if (st.busy && stick) box.scrollTop = box.scrollHeight;
    const s = el.querySelector('.nbq-st');
    const n = st.out.trim() ? st.out.trim().split(/\s+/).length : 0;
    if (s) s.textContent = st.busy ? (n ? `đang viết · ${n} từ` : 'đang viết…') : (st.err ? '' : `${n} từ`);
  }
  function drawResult() {
    const a = st.action;
    const canReplace = kind === 'edit' && apply.replace;
    const primary = kind === 'write' ? 'insert' : (a.mode === 'replace' && canReplace ? 'replace' : 'below');
    const btn = (k, label) => `<button type="button" class="sm ${k === primary ? 'primary' : ''}" data-act="${k}">${label}</button>`;
    el.innerHTML = `<div class="nbq-rh"><span class="nbq-ic">${escapeHtml(a.icon || '✦')}</span><span class="nbq-rh-t"><b>${escapeHtml(a.custom ? 'Yêu cầu của bạn' : a.label)}</b><span class="nbq-st"></span></span>${st.busy ? '<button type="button" class="sm" data-act="stop">■ Dừng</button>' : '<button type="button" class="sm ghost nbq-x" data-act="discard" title="Đóng (Esc)">✕</button>'}</div>
      ${kind === 'edit' ? `<div class="nbq-sel nbq-sel-r"><span class="nbq-sel-k">Đoạn gốc</span><span class="nbq-sel-t">${escapeHtml(clampText(plainPreview(text), 140))}</span></div>` : ''}
      <div class="nbq-out nb-prev"></div>
      ${st.err ? `<div class="status err">${escapeHtml(st.err)}</div>` : ''}
      ${!st.busy && st.out ? `<div class="nbq-acts">${kind === 'write' ? btn('insert', '↵ Chèn') : `${canReplace ? btn('replace', '⇄ Thay thế') : ''}${btn('below', '↓ Chèn bên dưới')}`}<span class="spacer"></span>${btn('retry', '↻ Thử lại')}${btn('copy', 'Copy')}</div>
        <div class="nbq-in nbq-refine"><span>↳</span><input id="nbq-r" placeholder="Bảo AI sửa tiếp… ví dụ: ngắn hơn, thêm ví dụ (Enter)" autocomplete="off"></div>` : ''}`;
    paintOut();
    place();
    el.querySelector('#nbq-r')?.focus();
  }

  /* ---------- sự kiện ---------- */
  el.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); }); // giữ vùng chọn trong trình soạn
  el.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const arr = myPrompts().filter((_, i) => i !== Number(del.dataset.del));
      await saveSettings({ nbPrompts: arr });
      drawMenu();
      return;
    }
    const it = e.target.closest('[data-k]');
    if (it) { run(st.items[Number(it.dataset.k)]); return; }
    if (e.target.closest('[data-save]')) {
      const p = st.q.trim();
      const arr = [...myPrompts(), { label: p.length > 48 ? `${p.slice(0, 46)}…` : p, p, mode: kind === 'edit' ? 'replace' : 'below' }];
      await saveSettings({ nbPrompts: arr });
      toast('Đã lưu prompt nhanh. Tìm trong nhóm “Prompt của tôi”.');
      st.q = '';
      drawMenu();
      el.querySelector('#nbq-q')?.focus();
      return;
    }
    if (e.target.closest('[data-full]')) { close(); openFull?.(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const md = unwrap(st.out);
    if (act === 'stop') st.abort?.abort();
    else if (act === 'retry') { st.history = []; run(st.action); }
    else if (act === 'copy') copyText(md).then(() => toast('Đã copy Markdown.'));
    else if (act === 'discard') close();
    else if (act === 'replace') { apply.replace?.(md); close(); }
    else if (act === 'below') { apply.below?.(md); close(); }
    else if (act === 'insert') { apply.insert?.(md); close(); }
  });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (st.view === 'menu') {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = st.items.length;
        if (!n) return;
        st.i = (st.i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        el.querySelectorAll('.nbq-it').forEach((b, k) => b.classList.toggle('on', k === st.i));
        el.querySelector('.nbq-it.on')?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const a = st.items[st.i] || (st.q.trim() ? { id: 'custom', label: '', p: st.q.trim(), mode: 'below', custom: true } : null);
        if (a) run(a);
      }
    } else if (e.key === 'Enter' && e.target.id === 'nbq-r' && e.target.value.trim() && !st.busy) {
      e.preventDefault();
      run(st.action, e.target.value.trim());
    }
  };
  document.addEventListener('pointerdown', onOut, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('hashchange', close);
  drawMenu();
  el.querySelector('#nbq-q').focus();
  return { close };
}

export const closeInlineAI = () => cur?.close();
