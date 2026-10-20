// Trích xuất lại ghi chú cho nhiều paper (từ Thư viện). Chạy lần lượt từng paper, có bảng tiến trình nổi
// với nút Dừng, vẫn chạy tiếp khi chuyển sang trang khác trong app.
import { api } from './api.js';
import { store, paperById } from './store.js';
import { hasCredentials } from './llm.js';
import { runExtraction, savePaperFromExtraction } from './extract.js';
import { escapeHtml } from './util.js';
import { toast, dialog } from './ui.js';
import { startJob, jobRunning } from './job.js';

/** Paper đã có ghi chú theo template mới (để gợi ý bỏ qua cho đỡ tốn token). */
export const hasTemplateNotes = (p) => {
  const e = p?.extraction || {};
  return !p?.needsExtraction && (!!e.lang || (e.dataset_details || []).length > 0 || !!e.objective?.goal || (e.evidence || []).length > 0);
};

/** Hỏi xác nhận rồi trích xuất lại các paper ids. */
export async function reextractPapers(ids) {
  if (jobRunning()) return toast('Đang có một việc chạy nền (bảng ở góc dưới), chờ xong hoặc bấm Dừng.');
  if (!hasCredentials(store.settings)) return toast('Chưa có API key. Mở Cài đặt để nhập key.', 3500, 'err');
  const papers = ids.map(paperById).filter(Boolean);
  if (!papers.length) return toast('Tick chọn ít nhất một paper trước.');
  const done = papers.filter(hasTemplateNotes).length;
  const choice = await dialog({
    title: 'Trích xuất lại ghi chú', width: 540,
    body: `<p>Chạy lại trích xuất theo template cho <b>${papers.length}</b> paper từ toàn văn hoặc PDF đã lưu. Ghi chú cá nhân, trích dẫn theo đoạn, trạng thái, đánh giá và thư mục được giữ nguyên.</p>
      <ul class="hint" style="margin:0 0 8px 18px;padding:0">
        <li>Mỗi paper là một lượt gọi model (${escapeHtml(store.settings.provider)}/${escapeHtml(store.settings.models?.[store.settings.provider] || '')}), tốn token như khi thêm paper.</li>
        <li>Paper chưa có toàn văn hay PDF được bỏ qua, app báo lại ở cuối.</li>
        <li>Có thể chuyển sang trang khác trong lúc chạy, bảng tiến trình ở góc dưới có nút Dừng.</li>
      </ul>
      ${done ? `<label class="row" style="gap:8px;margin-top:6px"><input type="checkbox" id="rx-skip" checked> Bỏ qua ${done} paper đã có ghi chú theo template mới</label>` : ''}`,
    buttons: [{ label: 'Huỷ', value: null }, { label: 'Bắt đầu', primary: true, onClick: (b, close) => { close({ skip: !!b.querySelector('#rx-skip')?.checked }); return false; } }],
  });
  if (!choice) return;
  const todo = papers.filter((p) => !(choice.skip && hasTemplateNotes(p)));
  if (!todo.length) return toast('Các paper đã chọn đều đã có ghi chú theo template mới.');

  const job = startJob('Trích xuất lại');
  if (!job) return;
  const ok = [];
  const skipped = [];
  const failed = [];
  const setNow = (i, title, msg) => job.step(i, todo.length, title, msg);
  try {
    for (const [i, p0] of todo.entries()) {
      if (job.stop) break;
      const p = paperById(p0.id);
      if (!p) continue;
      setNow(i, p.title, 'Đang đọc nguồn đã lưu…');
      try {
        const t = await api.getText(p.id);
        if (!p.pdfId && (t.text || '').length < 120) { skipped.push(p); continue; }
        const source = { url: p.url, title: p.title, arxivId: p.arxivId, doi: p.doi, kind: t.kind || p.sourceKind, text: t.text || '', pdfId: p.pdfId, pdfName: p.pdfName, exceptId: p.id, s2Id: p.s2Id, citationCount: p.citationCount };
        const r = await runExtraction(source, { onStatus: (m) => setNow(i, p.title, m) });
        const latest = paperById(p.id) || p;
        await savePaperFromExtraction({ extraction: r.extraction, meta: r.meta, source: r.source, topicId: latest.topicId, existingId: p.id });
        ok.push(p);
      } catch (e) {
        failed.push({ p, msg: e.message });
      }
    }
  } finally {
    const stopped = job.stop;
    job.finish();
    const left = todo.length - ok.length - skipped.length - failed.length;
    toast(`Đã trích xuất lại ${ok.length}/${todo.length} paper${stopped && left ? `, dừng trước ${left} paper` : ''}.`, 6000, failed.length ? 'err' : '');
    if (skipped.length || failed.length) {
      dialog({
        title: 'Một số paper chưa trích xuất lại được', width: 640,
        body: `${skipped.length ? `<p><b>${skipped.length}</b> paper chưa có toàn văn hay PDF. Mở paper, thêm PDF ở tab <b>PDF</b> hoặc dán nội dung ở tab <b>Nguồn</b> rồi thử lại.</p><ul style="margin:0 0 10px 18px;padding:0">${skipped.map((p) => `<li><a href="#/paper/${p.id}">${escapeHtml(p.title)}</a></li>`).join('')}</ul>` : ''}
          ${failed.length ? `<p><b>${failed.length}</b> paper gặp lỗi:</p><ul style="margin:0 0 0 18px;padding:0">${failed.map((f) => `<li><a href="#/paper/${f.p.id}">${escapeHtml(f.p.title)}</a>: ${escapeHtml(f.msg)}</li>`).join('')}</ul>` : ''}`,
      });
    }
  }
}
