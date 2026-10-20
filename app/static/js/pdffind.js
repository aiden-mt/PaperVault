// Tìm và tải PDF cho paper chưa có file: máy chủ gom link từ link paper / DOI (CVF, NeurIPS, PMLR, ACL, OpenReview),
// Semantic Scholar, OpenAlex và arXiv (theo tên), rồi tải thẳng về kho PDF của app. Miễn phí, không tốn token.
import { api } from './api.js';
import { savePaper, paperById } from './store.js';
import { escapeHtml } from './util.js';
import { toast, dialog } from './ui.js';
import { startJob, jobRunning } from './job.js';

const fileName = (p) => `${p.arxivId || (p.title || 'paper').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}.pdf`;

export const findPdf = (paper) => api.pdfFind(paper);

/** Tải một link PDF và gắn vào paper. Trả về paper đã lưu. */
export async function attachFromUrl(paper, url) {
  const up = await api.pdfDownload(url, fileName(paper));
  const latest = paperById(paper.id) || paper;
  return savePaper({ ...latest, pdfId: up.id, pdfName: up.name });
}

/** Thử lần lượt các link tìm được, gắn file PDF đầu tiên tải được. Trả về { paper, candidate } hoặc ném lỗi kèm danh sách đã thử. */
export async function autoAttach(paper, { candidates = null, onStatus = () => {} } = {}) {
  let list = candidates;
  if (!list) {
    onStatus('Đang tìm PDF trên arXiv, Semantic Scholar, OpenAlex…');
    list = (await findPdf(paper)).candidates;
  }
  if (!list.length) throw new Error('Không tìm thấy link PDF công khai nào.');
  const tried = [];
  for (const c of list) {
    onStatus(`Đang tải từ ${c.source}…`);
    try {
      const saved = await attachFromUrl(paper, c.url);
      return { paper: saved, candidate: c };
    } catch (e) {
      tried.push(`${c.source}: ${e.message}`);
    }
  }
  const err = new Error(`Đã thử ${list.length} link nhưng không tải được file PDF (${tried.join(' · ')}).`);
  err.tried = tried;
  throw err;
}

/** Tìm và tải PDF cho nhiều paper (từ Thư viện), chạy nền có bảng tiến trình. */
export async function findPdfsBulk(papers) {
  if (jobRunning()) return toast('Đang có một việc chạy nền (bảng ở góc dưới), chờ xong hoặc bấm Dừng.');
  const todo = papers.filter((p) => p && !p.pdfId);
  const has = papers.length - todo.length;
  if (!todo.length) return toast('Các paper đã chọn đều đã có PDF.');
  const ok = await dialog({
    title: 'Tìm và tải PDF', width: 520,
    body: `<p>Tìm file PDF công khai cho <b>${todo.length}</b> paper chưa có PDF${has ? ` (bỏ qua ${has} paper đã có)` : ''} trên arXiv, Semantic Scholar, OpenAlex, CVF, NeurIPS, PMLR, ACL Anthology, rồi tải về và gắn vào paper.</p>
      <p class="hint">Miễn phí, không tốn token. Mỗi paper mất vài giây. Paper chỉ có bản trả phí sẽ không tải được.</p>`,
    buttons: [{ label: 'Huỷ', value: false }, { label: 'Bắt đầu', value: true, primary: true }],
  });
  if (!ok) return;
  const job = startJob('Tìm PDF');
  if (!job) return;
  const done = [];
  const failed = [];
  try {
    for (const [i, p] of todo.entries()) {
      if (job.stop) break;
      job.step(i, todo.length, p.title, 'Đang tìm…');
      try {
        const r = await autoAttach(paperById(p.id) || p, { onStatus: (m) => job.step(i, todo.length, p.title, m) });
        done.push({ p, src: r.candidate.source });
      } catch (e) {
        failed.push({ p, msg: e.message });
      }
    }
  } finally {
    const stopped = job.stop;
    job.finish();
    toast(`Đã tải PDF cho ${done.length}/${todo.length} paper${stopped ? ' (đã dừng)' : ''}.`, 6000, failed.length && !done.length ? 'err' : '');
    if (failed.length) {
      dialog({
        title: `${failed.length} paper chưa tìm được PDF`, width: 680,
        body: `<p class="hint">Mở paper, vào tab <b>PDF</b> để xem các link đã tìm, mở Google Scholar hoặc trang nhà xuất bản, rồi tải file về và chọn file.</p>
          <ul style="margin:0 0 0 18px;padding:0">${failed.map((f) => `<li><a href="#/paper/${f.p.id}?tab=pdf">${escapeHtml(f.p.title)}</a><div class="hint" style="margin:0 0 6px">${escapeHtml(f.msg.slice(0, 300))}</div></li>`).join('')}</ul>`,
      });
    }
  }
}
