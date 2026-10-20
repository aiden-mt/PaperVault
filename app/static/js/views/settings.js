// Cài đặt: model & API key, đề tài, tham số trích xuất, thư mục xuất Markdown, sao lưu, dữ liệu & cloud.
import { api } from '../api.js';
import { store, saveSettings, loadAll } from '../store.js';
import { escapeHtml, download } from '../util.js';
import { $, toast, setStatus, spinner, showProgress, confirmDialog } from '../ui.js';
import { testConnection, PROVIDERS } from '../llm.js';
import { TRANSLATE_LANGS, translateConfig } from '../translate.js';
import { buildLibraryFiles } from '../markdown.js';
import { isDesktop, desktop } from '../desktop.js';
import { applyAppearance, normalizeAppearance, DEFAULT_APPEARANCE, UI_FONTS, READ_FONTS, LINE_HEIGHTS } from '../appearance.js';

const MODEL_HINTS = {
  anthropic: 'Gợi ý: claude-opus-5 (chất lượng cao nhất), claude-sonnet-5 (rẻ hơn), claude-haiku-4-5 (nhanh, rẻ).',
  openai: 'Gợi ý: gpt-4o, gpt-4o-mini. Nhập đúng model id mà key của bạn dùng được.',
  gemini: 'Gợi ý: gemini-2.0-flash, gemini-1.5-pro. Nhập đúng model id trong AI Studio.',
};

/** Ô chọn phông: danh sách có sẵn, cộng mục "Phông khác…" để gõ tên phông đã cài trên máy. */
function fontPicker(id, list, value) {
  const known = list.some(([v]) => v === value);
  return `<div class="row" style="gap:6px"><select id="${id}">${list.map(([v, l]) => `<option value="${escapeHtml(v)}" ${known && v === value ? 'selected' : ''} style="${v ? `font-family:'${escapeHtml(v)}'` : ''}">${escapeHtml(l)}</option>`).join('')}<option value="__custom" ${known ? '' : 'selected'}>Phông khác…</option></select>
    <input type="text" id="${id}-custom" placeholder="Tên phông đã cài, ví dụ Be Vietnam Pro" value="${known ? '' : escapeHtml(value)}" ${known ? 'hidden' : ''} style="flex:1;min-width:140px"></div>`;
}

export async function render(root) {
  const s = store.settings;
  const ap = normalizeAppearance(s.appearance);
  const tr = translateConfig(s);
  let health = {};
  try { health = await api.health(); } catch (_) { /* bỏ qua */ }
  root.innerHTML = `<div class="settings-page">
    <div class="page-head"><h1>Cài đặt</h1></div>

    <section class="card"><h2>Mô hình</h2>
      <div class="two">
        <label class="field"><span class="label-text">Nhà cung cấp</span><select id="st-provider">${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}" ${s.provider === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <label class="field"><span class="label-text">Model</span><input type="text" id="st-model"><span class="hint" id="st-model-hint"></span></label>
      </div>
      ${Object.entries(PROVIDERS).map(([k, v]) => `<div class="key-row" data-p="${k}"><label class="field"><span class="label-text">${v.label} API key</span><input type="password" id="st-key-${k}" value="${escapeHtml(s.apiKeys?.[k] || '')}" autocomplete="off"><span class="hint">Lấy tại <a href="${v.keyUrl}" target="_blank" rel="noopener">${v.keyUrl.replace('https://', '')}</a>. Key lưu trong file dữ liệu SQLite trên máy bạn.</span></label></div>`).join('')}
      <div class="row"><button id="st-test" class="sm">Kiểm tra kết nối</button><span id="st-test-status" class="status"></span></div>
    </section>

    <section class="card"><h2>Đề tài của bạn</h2>
      <label class="field"><textarea id="st-research" rows="4" placeholder="Ví dụ: Tôi đang làm VQA tiếng Việt cho ảnh y tế, dùng backbone BLIP-2, vấn đề chính là thiếu dữ liệu và tốc độ inference trên GPU 8GB.">${escapeHtml(s.myResearch || '')}</textarea>
        <span class="hint">Căn cứ để mục “Ý tưởng có thể áp dụng cho bài của mình”, tab Hỏi đáp và bản tổng hợp related work bám sát bài của bạn.</span></label>
    </section>


    <section class="card"><h2>Trích xuất</h2>
      <div class="two">
        <label class="field"><span class="label-text">Ngôn ngữ khi trích xuất</span><select id="st-lang"><option value="vi" ${s.language === 'vi' ? 'selected' : ''}>Tiếng Việt</option><option value="en" ${s.language === 'en' ? 'selected' : ''}>English</option></select><span class="hint">Ngôn ngữ model viết ghi chú.</span></label>
        <label class="field"><span class="label-text">Hiển thị ghi chú bằng</span><select id="st-notes-lang"><option value="" ${!s.notesLang ? 'selected' : ''}>Giữ ngôn ngữ lúc trích xuất</option><option value="vi" ${s.notesLang === 'vi' ? 'selected' : ''}>Tiếng Việt</option><option value="en" ${s.notesLang === 'en' ? 'selected' : ''}>English</option></select><span class="hint">Khác ngôn ngữ trích xuất thì app tự dịch (miễn phí) và lưu lại. Đổi nhanh ở tab Ghi chú của paper.</span></label>
        <label class="field"><span class="label-text">Effort (chỉ Claude)</span><select id="st-effort">${['low', 'medium', 'high', 'xhigh'].map((e) => `<option value="${e}" ${s.effort === e ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
        <label class="field"><span class="label-text">Số ký tự tối đa gửi đi</span><input type="number" id="st-maxin" min="4000" max="400000" step="1000" value="${s.maxInputChars}"><span class="hint">Full text dài sẽ bị cắt bớt phần giữa.</span></label>
        <label class="field"><span class="label-text">Max output tokens</span><input type="number" id="st-maxout" min="1000" max="32000" step="500" value="${s.maxOutputTokens}"></label>
        <label class="field" style="grid-column:1/-1"><span class="label-text">Xử lý file PDF</span><select id="st-pdf"><option value="auto" ${s.pdfMode === 'auto' ? 'selected' : ''}>Gửi thẳng file PDF cho model — đọc được cả bảng và hình (Claude, Gemini)</option><option value="text" ${s.pdfMode === 'text' ? 'selected' : ''}>Luôn trích text từ PDF rồi mới gửi — rẻ hơn, mất bảng/hình</option></select><span class="hint">OpenAI không nhận PDF qua Chat Completions nên luôn dùng text trích tại chỗ.</span></label>
        <label class="field" style="grid-column:1/-1"><span class="label-text">Semantic Scholar API key (tuỳ chọn)</span><input type="password" id="st-s2" value="${escapeHtml(s.s2ApiKey || '')}" autocomplete="off"><span class="hint">Không bắt buộc. Có key thì tra cứu / gợi ý paper liên quan ít bị giới hạn tốc độ. Xin tại api.semanticscholar.org.</span>
          <div class="row" style="margin-top:6px"><button type="button" id="st-s2-check" class="sm">Kiểm tra key</button><span id="st-s2-status" class="status"></span></div></label>
      </div>
    </section>

    <section class="card"><h2>Dịch khi bôi đen</h2>
      <p class="hint" style="margin:-4px 0 12px">Bôi đen chữ để dịch nhanh (Google, không cần API key, không tốn token), trong tab <b>PDF</b> và, nếu bật ô bên dưới, ở mọi trang khác của app: ghi chú, bài giảng, Hỏi đáp, Chat, danh sách paper. Bong bóng dịch có nút <b>Dịch bằng AI</b> dùng mô hình ở trên và nút <b>+ Ghi chú</b> lưu đoạn trích kèm bản dịch, số trang vào paper.</p>
      <div class="two">
        <label class="field"><span class="label-text">Dịch sang</span><select id="st-tr-lang">${TRANSLATE_LANGS.map(([k, l]) => `<option value="${k}" ${tr.targetLang === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span class="label-text">Cách kích hoạt</span><select id="st-tr-mode"><option value="button" ${tr.mode !== 'auto' ? 'selected' : ''}>Hiện nút 文 trước</option><option value="auto" ${tr.mode === 'auto' ? 'selected' : ''}>Dịch ngay khi bôi đen</option></select></label>
        <label class="field"><span class="label-text">Mở bản dịch khi</span><select id="st-tr-open"><option value="hover" ${tr.openOn !== 'click' ? 'selected' : ''}>Rê chuột vào nút 文</option><option value="click" ${tr.openOn === 'click' ? 'selected' : ''}>Bấm vào nút 文</option></select></label>
        <div class="field"><label class="row" style="gap:8px;margin-top:22px"><input type="checkbox" id="st-tr-ctx" ${tr.useContext ? 'checked' : ''}> Dịch theo ngữ cảnh câu</label>
          <label class="row" style="gap:8px;margin-top:6px"><input type="checkbox" id="st-tr-orig" ${tr.showOriginal ? 'checked' : ''}> Hiện cả đoạn gốc</label>
          <label class="row" style="gap:8px;margin-top:6px"><input type="checkbox" id="st-tr-app" ${tr.appWide !== false ? 'checked' : ''}> Bôi đen để dịch ở mọi trang của app</label></div>
      </div>
      <p class="hint" style="margin:0">Dịch theo ngữ cảnh gửi kèm cả câu xung quanh, nên <i>spring</i> trong câu nói về đồng hồ ra "lò xo" chứ không phải "mùa xuân". Ô nhập liệu và khối mã không bật dịch. Phím tắt: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> dịch đoạn đang chọn, <kbd>Esc</kbd> đóng bong bóng.</p>
    </section>

    <section class="card"><h2>Xuất thư viện ra thư mục Markdown</h2>
      <p class="hint">Mỗi chủ đề là một thư mục con chứa file .md của từng paper, kèm <span class="mono">_index.md</span> (bảng so sánh), <span class="mono">README.md</span>, <span class="mono">_bang-so-sanh-tat-ca.md</span> và <span class="mono">references.bib</span>. Đặt thư mục này trong OneDrive / Google Drive / kho Obsidian nếu muốn đồng bộ.</p>
      <label class="field"><span class="label-text">Đường dẫn thư mục xuất (tuyệt đối)</span><div class="row"><input type="text" id="st-exportdir" value="${escapeHtml(s.exportDir || '')}" placeholder="D:\\Research\\PaperVault  hoặc  C:\\Users\\ban\\OneDrive\\PaperVault">${isDesktop() ? '<button id="st-exportdir-pick" class="sm">Chọn…</button>' : ''}</div></label>
      <label class="field"><span class="row" style="gap:6px"><input type="checkbox" id="st-autosync" style="width:auto" ${s.autoSync ? 'checked' : ''}> Tự động ghi ra thư mục sau mỗi lần lưu / sửa paper</span></label>
      <div class="row wrap"><button id="st-sync" class="sm">Đồng bộ ngay</button><button id="st-open" class="sm">Mở thư mục</button><span id="st-sync-status" class="status"></span></div>
    </section>

    <section class="card"><h2>Sao lưu &amp; nhập dữ liệu</h2>
      <div class="row wrap"><button id="st-backup" class="sm">Tải file sao lưu JSON</button><button id="st-import" class="sm">Nhập JSON (gộp)</button><button id="st-import-replace" class="sm danger">Nhập JSON (thay thế toàn bộ)</button><input type="file" id="st-file" accept="application/json" hidden><span id="st-import-status" class="status"></span></div>
      <p class="hint" style="margin-top:8px">Nhận cả file sao lưu của <b>extension PaperVault</b> (Thư viện → Xuất → 3) lẫn của app này. File của app có kèm nội dung nguồn (full text) từng paper.</p>
    </section>

    <section class="card"><h2>Bảng xếp hạng venue</h2>
      <p class="hint">Hội nghị xếp hạng theo <a href="https://portal.core.edu.au/conf-ranks/" target="_blank" rel="noopener">CORE / ICORE</a> (A*, A, B, C). Tạp chí, book series và kỷ yếu theo <a href="https://www.scimagojr.com/" target="_blank" rel="noopener">Scimago Journal Rank</a> (Q1–Q4, SJR, H-index). App có sẵn một bản dữ liệu; bấm cập nhật để tải bản mới nhất từ hai trang này rồi phân loại lại cả thư viện.</p>
      <div id="st-rank-info" class="mono-box">${spinner('Đang tải…')}</div>
      <div class="row wrap" style="margin-top:8px"><button id="st-rank-update" class="sm">Cập nhật bảng xếp hạng trực tuyến</button><button id="st-rank-reclass" class="sm">Phân loại lại toàn bộ thư viện</button><span id="st-rank-status" class="status"></span></div>
    </section>

    <section class="card"><h2>Số trích dẫn (Semantic Scholar)</h2>
      <p class="hint">Số trích dẫn được ghi lúc thêm paper. Bấm cập nhật để lấy con số mới nhất cho toàn bộ thư viện (theo lô 100 paper, không cần key nhưng có key thì nhanh hơn).</p>
      <div class="row wrap"><button id="st-cites" class="sm">Cập nhật số trích dẫn</button><span id="st-cites-status" class="status">${store.lastCitationRefresh ? `Lần cuối: ${escapeHtml(new Date(store.lastCitationRefresh).toLocaleString('vi-VN'))}` : 'Chưa cập nhật lần nào.'}</span></div>
    </section>

    <section class="card"><h2>Sử dụng API &amp; chi phí</h2>
      <div id="st-usage"><span class="hint">${spinner('Đang tải…')}</span></div>
      <p class="hint" style="margin-top:8px">Chi phí là ước tính (USD cho 1 triệu token vào / ra). Khi bật <b>Tự cập nhật đơn giá</b>, app lấy giá mới nhất từ bảng giá công khai LiteLLM (làm mới mỗi tuần, kể cả giá đọc / ghi cache) và điền vào các ô có nhãn <i>tự động</i>. Ô bạn tự sửa được giữ nguyên; xoá trống ô rồi bấm Lưu để dùng lại giá tự động. Model không có trong bảng giá thì tự nhập.</p>
    </section>

    <section class="card"><h2>Dữ liệu &amp; đồng bộ cloud</h2>
      <div class="mono-box">Thư mục dữ liệu: ${escapeHtml(health.dataDir || '?')}\nCSDL SQLite:     ${escapeHtml(health.db || '?')}\nFile PDF:        ${escapeHtml(health.pdfDir || '?')}\nSố paper:        ${health.papers ?? '?'}</div>
      ${isDesktop() ? `<div class="row wrap" style="margin-top:8px"><button id="st-datadir-pick" class="sm">Đổi thư mục dữ liệu…</button><button id="st-datadir-open" class="sm">Mở thư mục dữ liệu</button><span id="st-datadir-status" class="status"></span></div>
      <p class="hint" style="margin-top:8px"><b>Dùng OneDrive / Google Drive:</b> bấm <i>Đổi thư mục dữ liệu…</i>, chọn một thư mục trong OneDrive/Drive; app sẽ copy dữ liệu hiện có sang đó (nếu nơi đó chưa có dữ liệu), ghi <span class="mono">config.json</span> và khởi động lại. Chỉ mở app trên <b>một máy tại một thời điểm</b>.</p>` : `<p class="hint" style="margin-top:8px"><b>Dùng OneDrive / Google Drive:</b> tạo file <span class="mono">config.json</span> cạnh <span class="mono">server.py</span> với nội dung
        <span class="mono">{"dataDir": "C:\\\\Users\\\\ban\\\\OneDrive\\\\PaperVault"}</span> (hoặc đặt biến môi trường <span class="mono">PV_DATA</span>) rồi khởi động lại app. Toàn bộ CSDL và PDF sẽ nằm trong thư mục đó và được client OneDrive/Drive đồng bộ lên cloud. Chỉ mở app trên <b>một máy tại một thời điểm</b> để tránh xung đột file.
        Nếu đang có dữ liệu ở thư mục cũ, tải file sao lưu JSON rồi nhập lại sau khi đổi thư mục, hoặc copy nguyên thư mục <span class="mono">data</span> sang.</p>`}
    </section>
    ${isDesktop() ? `<section class="card"><h2>Ứng dụng</h2><div class="row wrap"><button id="st-restart" class="sm">Khởi động lại</button><button id="st-quit" class="sm danger">Thoát PaperVault</button><span class="hint">Cửa sổ nhớ kích thước và vị trí lần trước.</span></div></section>` : ''}

    <section class="card" id="st-font-card"><h2>Phông chữ &amp; cỡ chữ</h2>
      <p class="hint" style="margin-top:0">Đổi là thấy ngay và được lưu luôn, không cần bấm Lưu cài đặt.</p>
      <div class="form-grid">
        <label class="field"><span class="label-text">Phông chữ giao diện</span>${fontPicker('ap-ui-font', UI_FONTS, ap.uiFont)}</label>
        <label class="field"><span class="label-text">Cỡ chữ giao diện <b id="ap-ui-scale-v">${ap.uiScale}%</b></span><input type="range" id="ap-ui-scale" min="80" max="150" step="5" value="${ap.uiScale}"><span class="hint">Phóng cả chữ, nút và khoảng cách, giống zoom trình duyệt.</span></label>
        <label class="field"><span class="label-text">Phông chữ nội dung đọc</span>${fontPicker('ap-read-font', READ_FONTS, ap.readFont)}<span class="hint">Ghi chú, bài giảng, Hỏi đáp và Chat. Phông có chân (Times, Cambria, Georgia) dễ đọc đoạn dài hơn.</span></label>
        <label class="field"><span class="label-text">Cỡ chữ nội dung đọc <b id="ap-read-scale-v">${ap.readScale}%</b></span><input type="range" id="ap-read-scale" min="80" max="170" step="5" value="${ap.readScale}"><span class="hint">Tính trên cỡ giao diện, bảng trong nội dung phóng theo cùng tỉ lệ.</span></label>
        <label class="field"><span class="label-text">Giãn dòng nội dung đọc</span><select id="ap-lh">${LINE_HEIGHTS.map(([v, l]) => `<option value="${v}" ${Number(ap.lineHeight) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="apx-preview read-scope" id="ap-preview"><b>Xem trước:</b> Mô hình dựng một mạng mệnh đề từ các đoạn lấy về, rồi cho chúng kích hoạt lẫn nhau qua vài vòng. Mệnh đề nào không được mệnh đề khác đỡ thì tắt dần, nhờ vậy đoạn nhiễu bị loại theo mức ăn khớp chứ không theo một ngưỡng điểm cố định. Accuracy tăng từ 62,3% lên 68,1% trên OK-VQA.</div>
      <div class="row" style="margin-top:10px"><button id="ap-reset" class="sm">Về mặc định</button><span id="ap-status" class="status"></span></div>
    </section>

    <section class="card"><h2>Giao diện &amp; phím tắt</h2>
      <p class="hint"><kbd>/</kbd> tìm kiếm · <kbd>n</kbd> thêm paper · <kbd>g</kbd> rồi <kbd>d</kbd>/<kbd>l</kbd>/<kbd>c</kbd>/<kbd>t</kbd>/<kbd>s</kbd> đi tới Tổng quan / Thư viện / So sánh / Chủ đề / Cài đặt · <kbd>Esc</kbd> đóng hộp thoại · kéo paper thả vào chủ đề ở sidebar để chuyển thư mục.</p>
    </section>

    <div class="sticky-actions"><button id="st-save" class="primary">Lưu cài đặt</button><span id="st-save-status" class="status"></span></div>
  </div>`;

  // ---- Phông chữ & cỡ chữ: áp ngay, lưu sau 400 ms kể từ lần đổi cuối
  let apTimer = 0;
  const readFont = (id) => ($(id).value === '__custom' ? $(`${id}-custom`).value : $(id).value);
  const apNow = () => ({ uiFont: readFont('ap-ui-font'), uiScale: Number($('ap-ui-scale').value), readFont: readFont('ap-read-font'), readScale: Number($('ap-read-scale').value), lineHeight: Number($('ap-lh').value) });
  const apChanged = () => {
    const a = applyAppearance(apNow());
    $('ap-ui-scale-v').textContent = `${a.uiScale}%`;
    $('ap-read-scale-v').textContent = `${a.readScale}%`;
    clearTimeout(apTimer);
    apTimer = setTimeout(async () => { await saveSettings({ appearance: a }); setStatus('ap-status', 'Đã lưu.', 'ok'); setTimeout(() => setStatus('ap-status', ''), 1500); }, 400);
  };
  for (const id of ['ap-ui-font', 'ap-read-font']) {
    $(id).addEventListener('change', () => { $(`${id}-custom`).hidden = $(id).value !== '__custom'; if ($(id).value === '__custom') $(`${id}-custom`).focus(); apChanged(); });
    $(`${id}-custom`).addEventListener('input', apChanged);
  }
  ['ap-ui-scale', 'ap-read-scale'].forEach((id) => $(id).addEventListener('input', apChanged));
  $('ap-lh').addEventListener('change', apChanged);
  $('ap-reset').addEventListener('click', () => {
    const d = DEFAULT_APPEARANCE;
    $('ap-ui-font').value = d.uiFont; $('ap-read-font').value = d.readFont;
    $('ap-ui-font-custom').hidden = true; $('ap-read-font-custom').hidden = true;
    $('ap-ui-scale').value = d.uiScale; $('ap-read-scale').value = d.readScale; $('ap-lh').value = '0';
    apChanged();
  });

  $('st-s2-check').addEventListener('click', async (e) => {
    e.preventDefault();
    showProgress('st-s2-status', 'Đang gọi thử Semantic Scholar…', { expectedMs: 3000 });
    try {
      const r = await api.s2Check($('st-s2').value.trim());
      setStatus('st-s2-status', escapeHtml(r.message), { ok: 'ok', limited: 'ok', invalid: 'err', error: 'err', none: '' }[r.status] || '');
    } catch (err) { setStatus('st-s2-status', escapeHtml(err.message), 'err'); }
  });

  const models = { ...s.models };
  const syncProvider = () => {
    const p = $('st-provider').value;
    document.querySelectorAll('.key-row').forEach((r) => r.classList.toggle('active', r.dataset.p === p));
    $('st-model').value = models[p] || '';
    $('st-model-hint').textContent = MODEL_HINTS[p];
  };
  syncProvider();
  $('st-model').addEventListener('input', (e) => { models[$('st-provider').value] = e.target.value.trim(); });
  $('st-provider').addEventListener('change', syncProvider);

  const collect = () => ({
    provider: $('st-provider').value,
    models,
    apiKeys: Object.fromEntries(Object.keys(PROVIDERS).map((k) => [k, $(`st-key-${k}`).value.trim()])),
    myResearch: $('st-research').value,
    language: $('st-lang').value,
    notesLang: $('st-notes-lang').value,
    effort: $('st-effort').value,
    maxInputChars: Number($('st-maxin').value) || 60000,
    maxOutputTokens: Number($('st-maxout').value) || 8000,
    pdfMode: $('st-pdf').value,
    s2ApiKey: $('st-s2').value.trim(),
    exportDir: $('st-exportdir').value.trim(),
    autoSync: $('st-autosync').checked,
    translate: {
      targetLang: $('st-tr-lang').value, mode: $('st-tr-mode').value, openOn: $('st-tr-open').value,
      useContext: $('st-tr-ctx').checked, showOriginal: $('st-tr-orig').checked, appWide: $('st-tr-app').checked,
    },
  });

  $('st-save').addEventListener('click', async () => {
    await saveSettings(collect());
    setStatus('st-save-status', 'Đã lưu.', 'ok');
    toast('Đã lưu cài đặt.');
    setTimeout(() => setStatus('st-save-status', ''), 2000);
  });
  $('st-test').addEventListener('click', async () => {
    setStatus('st-test-status', spinner('Đang kiểm tra…'));
    try { setStatus('st-test-status', escapeHtml(await testConnection({ ...s, ...collect() })), 'ok'); }
    catch (e) { setStatus('st-test-status', escapeHtml(e.message), 'err'); }
  });
  $('st-sync').addEventListener('click', async () => {
    const root = $('st-exportdir').value.trim();
    if (!root) return setStatus('st-sync-status', 'Nhập đường dẫn thư mục xuất trước.', 'err');
    setStatus('st-sync-status', spinner('Đang ghi file…'));
    try {
      await saveSettings({ exportDir: root });
      const r = await api.sync(buildLibraryFiles(store.papers, store.topics), { root });
      setStatus('st-sync-status', `Đã ghi ${r.files} file vào ${escapeHtml(r.root)}.`, 'ok');
    } catch (e) { setStatus('st-sync-status', escapeHtml(e.message), 'err'); }
  });
  $('st-open').addEventListener('click', async () => {
    try { await api.openFolder($('st-exportdir').value.trim()); } catch (e) { setStatus('st-sync-status', escapeHtml(e.message), 'err'); }
  });
  $('st-exportdir-pick')?.addEventListener('click', async () => {
    const dir = await desktop.pickFolder($('st-exportdir').value.trim());
    if (dir) { $('st-exportdir').value = dir; await saveSettings({ exportDir: dir }); toast('Đã chọn thư mục xuất.'); }
  });
  $('st-datadir-open')?.addEventListener('click', () => desktop.openPath(health.dataDir));
  $('st-datadir-pick')?.addEventListener('click', async () => {
    const dir = await desktop.pickFolder(health.dataDir);
    if (!dir) return;
    if (dir.replace(/[\\/]+$/, '') === String(health.dataDir).replace(/[\\/]+$/, '')) return toast('Vẫn là thư mục hiện tại.');
    const move = await confirmDialog(`Chuyển dữ liệu sang:\n${dir}\n\nApp sẽ copy CSDL + PDF hiện có sang đó (nếu nơi đó chưa có dữ liệu), ghi config.json rồi khởi động lại.`, { okLabel: 'Chuyển & khởi động lại' });
    if (!move) return;
    setStatus('st-datadir-status', spinner('Đang chuyển…'));
    const r = await desktop.setDataDir(dir, true);
    if (!r) return setStatus('st-datadir-status', 'Không đổi được thư mục.', 'err');
    setStatus('st-datadir-status', 'Đang khởi động lại…', 'ok');
    setTimeout(() => desktop.restart(), 600);
  });
  $('st-restart')?.addEventListener('click', () => desktop.restart());
  $('st-quit')?.addEventListener('click', async () => { if (await confirmDialog('Thoát PaperVault?', { okLabel: 'Thoát' })) desktop.quit(); });
  $('st-cites').addEventListener('click', async () => {
    $('st-cites').disabled = true;
    showProgress('st-cites-status', 'Đang cập nhật số trích dẫn…', { expectedMs: Math.max(3000, store.papers.length * 15) });
    try {
      const r = await api.s2Refresh();
      await loadAll();
      setStatus('st-cites-status', `Đã cập nhật ${r.updated}/${r.total} paper.`, 'ok');
    } catch (e) { setStatus('st-cites-status', escapeHtml(e.message), 'err'); }
    finally { $('st-cites').disabled = false; }
  });

  // ---- bảng xếp hạng ----
  const drawRankInfo = async () => {
    try {
      const i = await api.rankingsInfo();
      $('st-rank-info').textContent = `Hội nghị: ${i.core ? `${i.core.source} · ${i.core.count} hội nghị · tệp ${i.core.file} (${i.core.updated})` : 'chưa có dữ liệu'}
Tạp chí:  ${i.sjr ? `SJR ${i.sjr.year} · ${i.sjr.count.toLocaleString('vi-VN')} ấn phẩm · tệp ${i.sjr.file} (${i.sjr.updated})` : 'chưa có dữ liệu'}`;
    } catch (e) { $('st-rank-info').textContent = e.message; }
  };
  drawRankInfo();
  $('st-rank-update').addEventListener('click', async () => {
    $('st-rank-update').disabled = true;
    showProgress('st-rank-status', 'Đang tải bảng CORE và SJR…', { expectedMs: 20000 });
    try {
      const r = await api.rankingsUpdate();
      await loadAll();
      setStatus('st-rank-status', `Đã cập nhật ${r.core.source} (${r.core.count} hội nghị) và SJR ${r.sjr.year} (${r.sjr.count.toLocaleString('vi-VN')} ấn phẩm). Phân loại lại ${r.changed} paper.`, 'ok');
      drawRankInfo();
    } catch (e) { setStatus('st-rank-status', `${escapeHtml(e.message)} — vẫn dùng bảng hiện có.`, 'err'); }
    finally { $('st-rank-update').disabled = false; }
  });
  $('st-rank-reclass').addEventListener('click', async () => {
    showProgress('st-rank-status', 'Đang phân loại venue…', { expectedMs: 5000 });
    try {
      const r = await api.venueReclassify(true);
      await loadAll();
      setStatus('st-rank-status', `Đã phân loại lại, ${r.changed} paper thay đổi. Paper bạn sửa venue tay được giữ nguyên.`, 'ok');
    } catch (e) { setStatus('st-rank-status', escapeHtml(e.message), 'err'); }
  });

  // ---- sử dụng API ----
  const prices = { ...(s.prices || {}) };
  const hasPrice = (pr) => pr && (pr.in != null || pr.out != null);
  // Giá tự động: lấy từ bảng giá công khai (LiteLLM) qua máy chủ, chỉ điền ô trống hoặc ô đang là giá tự động; ô bạn tự nhập được giữ.
  const autoPrices = async (keys, force) => {
    const meta = await api.prices(keys, force);
    let changed = 0;
    for (const [key, pr] of Object.entries(meta.prices || {})) {
      const cur = prices[key];
      if (hasPrice(cur) && cur.auto !== true) continue;
      const next = { in: pr.in, out: pr.out, cacheRead: pr.cacheRead, cacheWrite: pr.cacheWrite, auto: true, matched: pr.matched };
      if (JSON.stringify(cur || {}) !== JSON.stringify(next)) { prices[key] = next; changed++; }
    }
    if (changed) await saveSettings({ prices });
    return { ...meta, changed };
  };
  const priceMetaText = (meta, err) => {
    if (err) return `<span class="status err">${escapeHtml(err)}</span>`;
    if (!meta) return '';
    const when = meta.fetchedAt ? new Date(meta.fetchedAt * 1000).toLocaleDateString('vi-VN') : '';
    const miss = (meta.missing || []).length;
    return `Nguồn: <a href="https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json" target="_blank" rel="noopener">bảng giá LiteLLM</a>${when ? `, tải ngày ${when}` : ''}${miss ? ` · ${miss} model không có trong bảng giá, tự nhập nếu cần` : ''}${meta.stale ? ` · <span class="status warn">${escapeHtml(meta.stale)}</span>` : ''}`;
  };
  const drawUsage = async ({ force = false } = {}) => {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    let u;
    try { u = await api.usage(monthStart.toISOString()); } catch (e) { $('st-usage').innerHTML = `<span class="status err">${escapeHtml(e.message)}</span>`; return; }
    const autoOn = store.settings.autoPrices !== false;
    let meta = null;
    let metaErr = '';
    if ((autoOn || force) && u.totals.length) {
      try { meta = await autoPrices(u.totals.map((t) => `${t.provider}/${t.model}`), force); } catch (e) { metaErr = e.message; }
    }
    if (!$('st-usage')) return; // đã rời trang Cài đặt trong lúc chờ
    const fmt = (n) => Number(n || 0).toLocaleString('vi-VN');
    const fmtP = (v) => (v == null ? '' : String(+Number(v).toFixed(4)));
    let totalCost = 0;
    const rows = u.totals.map((t) => {
      const key = `${t.provider}/${t.model}`;
      const pr = prices[key] || {};
      // Giá token cache: dùng giá thật nếu bảng giá có, không thì ước tính theo hệ số
      // (Anthropic đọc 0.1x / ghi 1.25x, OpenAI đọc 0.5x, Gemini đọc 0.25x giá input).
      const rf = { anthropic: 0.1, openai: 0.5, gemini: 0.25 }[t.provider] ?? 0.1;
      const wf = t.provider === 'anthropic' ? 1.25 : 1;
      const cacheR = pr.cacheRead != null ? (t.cacheRead || 0) / 1e6 * pr.cacheRead : (pr.in ? (t.cacheRead || 0) * rf / 1e6 * pr.in : 0);
      const cacheW = pr.cacheWrite != null ? (t.cacheWrite || 0) / 1e6 * pr.cacheWrite : (pr.in ? (t.cacheWrite || 0) * wf / 1e6 * pr.in : 0);
      const cost = (pr.in ? t.inputTokens / 1e6 * pr.in : 0) + cacheR + cacheW + (pr.out ? t.outputTokens / 1e6 * pr.out : 0);
      totalCost += cost;
      const auto = pr.auto === true && hasPrice(pr);
      const tip = auto
        ? `Tự động từ bảng giá LiteLLM (${pr.matched || key})${pr.cacheRead != null ? `, đọc cache $${fmtP(pr.cacheRead)}/1M` : ''}${pr.cacheWrite != null ? `, ghi cache $${fmtP(pr.cacheWrite)}/1M` : ''}. Sửa số rồi bấm Lưu để dùng giá của bạn.`
        : (hasPrice(pr) ? 'Giá bạn tự nhập (không bị ghi đè khi cập nhật tự động). Xoá trống rồi bấm Lưu để dùng lại giá tự động.' : 'Chưa có giá');
      const inp = (k) => `<input type="number" step="any" min="0" class="price-in ${auto ? 'price-auto' : ''}" data-price="${escapeHtml(key)}" data-k="${k}" value="${fmtP(pr[k])}" data-orig="${fmtP(pr[k])}" title="${escapeHtml(tip)}" placeholder="$/1M">`;
      const tag = auto ? ` <span class="price-tag" title="${escapeHtml(tip)}">tự động</span>` : '';
      return `<tr><td>${escapeHtml(key)}${tag}</td><td>${t.calls}</td><td>${fmt(t.inputTokens)}</td><td title="đọc cache / ghi cache">${fmt(t.cacheRead)} / ${fmt(t.cacheWrite)}</td><td>${fmt(t.outputTokens)}</td>
        <td>${inp('in')}</td><td>${inp('out')}</td>
        <td>${hasPrice(pr) ? `$${cost.toFixed(3)}` : '—'}</td></tr>`;
    }).join('');
    $('st-usage').innerHTML = u.totals.length
      ? `<div class="price-bar"><span class="hint">Tháng này: <b>${u.count}</b> lượt gọi${totalCost ? ` · ước tính <b>$${totalCost.toFixed(2)}</b>` : ''}</span><span class="spacer"></span>
          <label class="row hint" style="gap:6px" title="Mỗi lần mở trang này, app lấy đơn giá mới nhất (làm mới mỗi tuần) và điền vào các ô trống hoặc ô đang là giá tự động"><input type="checkbox" id="st-auto-price" style="width:auto" ${autoOn ? 'checked' : ''}> Tự cập nhật đơn giá</label>
          <button id="st-price-refresh" class="sm">↻ Cập nhật đơn giá ngay</button></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Model</th><th>Lượt</th><th>Token vào</th><th>Cache đọc / ghi</th><th>Token ra</th><th>Giá vào</th><th>Giá ra</th><th>Ước tính</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="price-meta hint">${priceMetaText(meta, metaErr)}</div>
        <div class="row" style="margin-top:6px"><button id="st-prices-save" class="sm">Lưu đơn giá</button><button id="st-usage-all" class="sm ghost">Xem toàn bộ lịch sử</button></div>`
      : '<span class="hint">Tháng này chưa gọi model lần nào.</span>';
    $('st-auto-price')?.addEventListener('change', async (e) => {
      await saveSettings({ autoPrices: e.target.checked });
      toast(e.target.checked ? 'Đã bật tự cập nhật đơn giá.' : 'Đã tắt tự cập nhật đơn giá. Giá đang có được giữ nguyên.');
      if (e.target.checked) drawUsage();
    });
    $('st-price-refresh')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Đang tải bảng giá…';
      await drawUsage({ force: true });
      toast('Đã cập nhật đơn giá từ bảng giá LiteLLM. Ô bạn tự nhập được giữ nguyên.');
    });
    $('st-prices-save')?.addEventListener('click', async () => {
      for (const inp of $('st-usage').querySelectorAll('[data-price]')) {
        if (inp.value === inp.dataset.orig) continue; // không đổi thì giữ nguyên (kể cả giá tự động)
        const key = inp.dataset.price;
        const next = { ...(prices[key] || {}), [inp.dataset.k]: inp.value === '' ? null : Number(inp.value) };
        // Sửa tay thì thành giá của bạn; xoá trống cả hai ô thì để app tự điền lại.
        prices[key] = next.in == null && next.out == null ? { in: null, out: null } : { in: next.in ?? null, out: next.out ?? null, auto: false };
      }
      await saveSettings({ prices });
      toast('Đã lưu đơn giá.');
      drawUsage();
    });
    $('st-usage-all')?.addEventListener('click', async () => {
      const all = await api.usage('');
      const fmtT = (t) => `${t.provider}/${t.model}: ${t.calls} lượt, ${fmt(t.inputTokens)} vào, ${fmt(t.outputTokens)} ra`;
      toast(`Toàn bộ: ${all.count} lượt gọi. ${all.totals.map(fmtT).join(' · ')}`, 8000);
    });
  };
  drawUsage();

  $('st-backup').addEventListener('click', async () => {
    const data = await api.backup(true);
    download(`papervault-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
  });
  let replaceMode = false;
  $('st-import').addEventListener('click', () => { replaceMode = false; $('st-file').click(); });
  $('st-import-replace').addEventListener('click', async () => {
    if (!(await confirmDialog('Thay thế TOÀN BỘ paper hiện có bằng dữ liệu trong file? Không hoàn tác được.', { danger: true, okLabel: 'Thay thế' }))) return;
    replaceMode = true; $('st-file').click();
  });
  $('st-file').addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    showProgress('st-import-status', 'Đang nhập dữ liệu…', { expectedMs: 5000 });
    try {
      const data = JSON.parse(await file.text());
      const n = await api.importData(data, !replaceMode);
      await loadAll();
      setStatus('st-import-status', `Đã nhập ${n} paper.`, 'ok');
      toast(`Đã nhập ${n} paper.`);
    } catch (e) { setStatus('st-import-status', escapeHtml(e.message), 'err'); }
    ev.target.value = '';
  });
}
