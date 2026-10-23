// "Lưu vào Sổ tay": chép một câu trả lời của AI (Chat với paper, tab Hỏi đáp) vào nhật ký hôm nay, một trang có sẵn
// hoặc một trang mới. Trích dẫn [P1] của Chat đổi thành [[@id]] để bấm được và hiện trong liên kết ngược của paper.
import { loadPages, allPages, pageById, savePage, newPage, ensureDailyPage, pageLabel, localDate } from './notebook.js';
import { escapeHtml } from './util.js';
import { dialog, toast } from './ui.js';

const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) { /* bỏ qua */ } return null; };

/** [P1], [P2, P3] -> [[@id]] theo bảng nhãn -> id paper. */
export function citesToLinks(md, labels) {
  if (!labels?.size) return md;
  return String(md || '').replace(/\[((?:P\d+)(?:\s*[,;]\s*P\d+)*)\]/g, (m, inner) => inner.split(/\s*[,;]\s*/).map((lab) => (labels.has(lab) ? `[[@${labels.get(lab)}]]` : `[${lab}]`)).join(' '));
}

function block({ question, answer, paperIds, from, withQ, style }) {
  const d = new Date();
  const when = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  const src = `*${[from, ...paperIds.map((id) => `[[@${id}]]`)].filter(Boolean).join(' · ')} · ${when}*`;
  const ans = String(answer || '').trim();
  const q = String(question || '').replace(/\s+/g, ' ').trim();
  if (style === 'plain') return `${withQ && q ? `**Hỏi:** ${q}\n\n` : ''}${ans}\n\n${src}`;
  const head = withQ && q ? (q.length > 140 ? `${q.slice(0, 137)}…` : q) : 'Trả lời của AI';
  return [`> [!ai] ${head}`, ...`${ans}\n\n${src}`.split('\n').map((l) => (l ? `> ${l}` : '>'))].join('\n');
}

/**
 * Mở hộp thoại rồi lưu. question, answer: Markdown; paperIds: paper liên quan (ghi ở dòng nguồn);
 * labels: Map nhãn [P1] -> id paper (Chat); from: nơi lấy câu trả lời ("Chat với paper", "Hỏi đáp").
 */
export async function saveAnswerToNotebook({ question = '', answer = '', paperIds = [], labels = null, from = '' } = {}) {
  await loadPages();
  const pages = allPages().slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const lastDest = LS('pv.saveNbDest') || 'daily';
  const lastPage = LS('pv.saveNbPage') || '';
  const style0 = LS('pv.saveNbStyle') || 'callout';
  const qShort = String(question || '').replace(/\s+/g, ' ').trim();
  const r = await dialog({
    title: 'Lưu vào Sổ tay', width: 560,
    body: `<div class="svnb">
      <label class="svnb-opt"><input type="radio" name="svnb-dest" value="daily" ${lastDest === 'daily' ? 'checked' : ''}> <span><b>Nhật ký hôm nay</b> <span class="hint">(${escapeHtml(localDate())})</span></span></label>
      <label class="svnb-opt"><input type="radio" name="svnb-dest" value="page" ${lastDest === 'page' && pages.length ? 'checked' : ''} ${pages.length ? '' : 'disabled'}> <span><b>Thêm vào cuối trang</b></span></label>
      <select id="svnb-page" class="svnb-sub">${pages.map((p) => `<option value="${p.id}" ${p.id === lastPage ? 'selected' : ''}>${escapeHtml(pageLabel(p))}</option>`).join('')}</select>
      <label class="svnb-opt"><input type="radio" name="svnb-dest" value="new" ${lastDest === 'new' ? 'checked' : ''}> <span><b>Trang mới</b></span></label>
      <input id="svnb-title" class="svnb-sub" placeholder="Tên trang mới" value="${escapeHtml(qShort.slice(0, 70) || 'Ghi chép từ AI')}">
      <div class="svnb-row"><label class="check"><input type="checkbox" id="svnb-q" ${qShort ? 'checked' : 'disabled'}> Kèm câu hỏi</label>
        <select id="svnb-style" style="width:auto"><option value="callout" ${style0 === 'callout' ? 'selected' : ''}>Khối ✨ AI (thu gọn được)</option><option value="plain" ${style0 === 'plain' ? 'selected' : ''}>Đoạn văn thường</option></select></div>
      <p class="hint">Trích dẫn paper trong câu trả lời thành liên kết [[@paper]], hiện ở mục “Trong sổ tay nghiên cứu” của trang paper đó.</p></div>`,
    buttons: [{ label: 'Huỷ', value: null }, { label: 'Lưu', primary: true, onClick: (b, close) => {
      const dest = b.querySelector('input[name="svnb-dest"]:checked')?.value || 'daily';
      const title = b.querySelector('#svnb-title').value.trim();
      if (dest === 'new' && !title) { toast('Nhập tên trang mới.', 2500, 'err'); return false; }
      close({ dest, pageId: b.querySelector('#svnb-page').value, title, withQ: b.querySelector('#svnb-q').checked, style: b.querySelector('#svnb-style').value });
      return false;
    } }],
    onOpen: (b) => {
      // Bấm vào ô chọn trang / ô tên thì chọn luôn lựa chọn tương ứng.
      b.querySelector('#svnb-page').addEventListener('focus', () => { const x = b.querySelector('input[value="page"]'); if (!x.disabled) x.checked = true; });
      b.querySelector('#svnb-title').addEventListener('focus', () => { b.querySelector('input[value="new"]').checked = true; });
    },
  });
  if (!r) return null;
  LS('pv.saveNbDest', r.dest);
  LS('pv.saveNbStyle', r.style);
  const text = block({ question, answer: citesToLinks(answer, labels), paperIds, from, withQ: r.withQ, style: r.style });
  let saved;
  try {
    if (r.dest === 'new') saved = await savePage(newPage({ title: r.title, content: `${text}\n` }));
    else {
      const target = r.dest === 'daily' ? await ensureDailyPage(localDate()) : pageById(r.pageId);
      if (!target) throw new Error('Không tìm thấy trang.');
      if (r.dest === 'page') LS('pv.saveNbPage', target.id);
      const cur = String(target.content || '').replace(/\s+$/, '');
      saved = await savePage({ ...target, content: `${cur}${cur ? '\n\n' : ''}${text}\n` });
    }
  } catch (e) { toast(`Không lưu được: ${e.message}`, 5000, 'err'); return null; }
  toast(`Đã lưu vào “${pageLabel(saved)}”.`, 6000, 'ok', { label: 'Mở trang', onClick: () => { location.hash = `#/notebook/${saved.id}`; } });
  return saved;
}
