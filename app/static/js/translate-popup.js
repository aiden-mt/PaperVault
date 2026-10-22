// Bảng nhanh "Dịch khi bôi đen" trên thanh đầu trang (giống popup của extension): đổi ngôn ngữ đích, cách kích hoạt,
// bật / tắt dịch ở mọi trang mà không phải vào Cài đặt, và mở trang Ghi chú & thẻ ghi nhớ. Đổi là lưu ngay.
import { store, saveSettings } from './store.js';
import { TRANSLATE_LANGS, translateConfig } from './translate.js';
import { toast } from './ui.js';

const btn = document.getElementById('btn-translate');
let pop = null;

/** Nút trên thanh đầu trang mờ đi khi đang tắt dịch ở mọi trang. */
export function syncTranslateButton() {
  if (btn) btn.classList.toggle('off', translateConfig(store.settings).appWide === false);
}

function close() {
  pop?.remove();
  pop = null;
  document.removeEventListener('mousedown', outside, true);
  document.removeEventListener('keydown', onKey, true);
  btn?.classList.remove('active');
}
const outside = (e) => { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close(); };
const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };

async function save(patch) {
  const cfg = { ...translateConfig(store.settings), ...patch };
  await saveSettings({ translate: cfg });
  syncTranslateButton();
}

function open() {
  const c = translateConfig(store.settings);
  const notes = store.papers.reduce((n, p) => n + (p.deletedAt ? 0 : (p.annotations || []).length), 0);
  pop = document.createElement('div');
  pop.className = 'tr-pop';
  pop.innerHTML = `<div class="tr-pop-head"><b>Dịch khi bôi đen</b><label class="switch" title="Bật / tắt dịch khi bôi đen ở mọi trang của app (trình đọc PDF luôn dịch được)"><input type="checkbox" id="trp-on" ${c.appWide !== false ? 'checked' : ''}><span></span></label></div>
    <label class="field"><span class="label-text">Dịch sang</span><select id="trp-lang">${TRANSLATE_LANGS.map(([k, l]) => `<option value="${k}" ${c.targetLang === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field"><span class="label-text">Cách kích hoạt</span><select id="trp-mode"><option value="button" ${c.mode !== 'auto' ? 'selected' : ''}>Hiện nút 文 trước</option><option value="auto" ${c.mode === 'auto' ? 'selected' : ''}>Dịch ngay khi bôi đen</option></select></label>
    <label class="field"><span class="label-text">Mở bản dịch khi</span><select id="trp-open"><option value="hover" ${c.openOn !== 'click' ? 'selected' : ''}>Rê chuột vào nút 文</option><option value="click" ${c.openOn === 'click' ? 'selected' : ''}>Bấm vào nút 文</option></select></label>
    <label class="row tr-pop-check"><input type="checkbox" id="trp-ctx" ${c.useContext ? 'checked' : ''}> Dịch theo ngữ cảnh câu</label>
    <label class="row tr-pop-check"><input type="checkbox" id="trp-orig" ${c.showOriginal ? 'checked' : ''}> Hiện cả đoạn gốc</label>
    <a class="tr-pop-notes" href="#/notes">Ghi chú &amp; thẻ ghi nhớ <span>${notes}</span></a>
    <p class="hint">Bôi đen đoạn văn ở bất kỳ trang nào để dịch, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> dịch ngay, <kbd>Esc</kbd> đóng. Khi bật dịch theo ngữ cảnh, cả câu xung quanh được gửi kèm nên <i>spring</i> trong câu nói về đồng hồ ra "lò xo" chứ không phải "mùa xuân".</p>`;
  document.body.appendChild(pop);
  // Đặt ngay dưới nút 文, mép phải thẳng mép phải nút (body có thể bị zoom theo cỡ chữ giao diện).
  const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
  const r = btn.getBoundingClientRect();
  pop.style.top = `${r.bottom / z + 6}px`;
  pop.style.left = `${Math.max(8, r.right / z - pop.offsetWidth)}px`;
  pop.style.right = 'auto';
  btn.classList.add('active');
  const $p = (id) => pop.querySelector(`#${id}`);
  $p('trp-on').addEventListener('change', async (e) => { await save({ appWide: e.target.checked }); toast(e.target.checked ? 'Đã bật dịch khi bôi đen ở mọi trang.' : 'Đã tắt dịch khi bôi đen ngoài trình đọc PDF.'); });
  $p('trp-lang').addEventListener('change', (e) => save({ targetLang: e.target.value }));
  $p('trp-mode').addEventListener('change', (e) => save({ mode: e.target.value }));
  $p('trp-open').addEventListener('change', (e) => save({ openOn: e.target.value }));
  $p('trp-ctx').addEventListener('change', (e) => save({ useContext: e.target.checked }));
  $p('trp-orig').addEventListener('change', (e) => save({ showOriginal: e.target.checked }));
  pop.querySelector('.tr-pop-notes').addEventListener('click', close);
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', onKey, true);
}

btn?.addEventListener('click', () => (pop ? close() : open()));
window.addEventListener('hashchange', close);
// Bấm vào một khung chia đôi (iframe: cửa sổ này không nhận được mousedown) hoặc cửa sổ mất tiêu điểm: cũng đóng.
window.addEventListener('pv:pane-pointerdown', close);
window.addEventListener('blur', () => { if (pop && !pop.contains(document.activeElement)) close(); });
