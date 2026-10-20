// Quản lý chủ đề (thêm / sửa / xoá / gộp) và tag (đổi tên / gộp / xoá trên toàn thư viện).
import { store, onChange, saveTopic, removeTopic, bulkPapers, savePaper, tagIndex, topicIdsOf } from '../store.js';
import { escapeHtml, uid } from '../util.js';
import { $, toast, dialog, confirmDialog, selectDialog, promptDialog } from '../ui.js';

function editDialog(t) {
  const isNew = !t;
  t = t || { id: uid('t'), name: '', color: '#6b7cff', description: '', keywords: [] };
  return dialog({
    title: isNew ? 'Thêm chủ đề' : 'Sửa chủ đề',
    body: `<label class="field"><span class="label-text">Tên</span><input type="text" id="tp-name" value="${escapeHtml(t.name)}"></label>
      <div class="row" style="gap:14px;align-items:flex-start">
        <label class="field"><span class="label-text">Màu</span><input type="color" id="tp-color" value="${escapeHtml(t.color || '#6b7cff')}" style="width:60px;height:34px;padding:2px"></label>
        <label class="field" style="flex:1"><span class="label-text">Mô tả</span><input type="text" id="tp-desc" value="${escapeHtml(t.description || '')}"></label></div>
      <label class="field"><span class="label-text">Từ khoá gợi ý tự động (cách nhau bởi dấu phẩy)</span><textarea id="tp-kw" rows="3">${escapeHtml((t.keywords || []).join(', '))}</textarea>
        <span class="hint">Dùng để chấm điểm gợi ý thư mục khi trích xuất: cụm từ nhiều điểm hơn từ đơn, xuất hiện ở tiêu đề được cộng thêm.</span></label>`,
    buttons: [{ label: 'Huỷ', value: null }, {
      label: 'Lưu', value: true, primary: true,
      onClick: async (body, close) => {
        const name = body.querySelector('#tp-name').value.trim();
        if (!name) { toast('Nhập tên chủ đề.', 2000, 'err'); return false; }
        await saveTopic({ ...t, name, color: body.querySelector('#tp-color').value, description: body.querySelector('#tp-desc').value.trim(),
          keywords: body.querySelector('#tp-kw').value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) });
        toast('Đã lưu chủ đề.');
        close(true);
        return false;
      },
    }],
  });
}

async function renameTag(oldTag, newTag) {
  newTag = String(newTag || '').trim().toLowerCase();
  if (!newTag || newTag === oldTag) return 0;
  let n = 0;
  for (const p of store.papers) {
    const tags = p.extraction?.tags || [];
    if (!tags.includes(oldTag)) continue;
    const next = [...new Set(tags.map((t) => (t === oldTag ? newTag : t)))];
    await savePaper({ ...p, extraction: { ...p.extraction, tags: next } });
    n++;
  }
  return n;
}

async function deleteTag(tag) {
  let n = 0;
  for (const p of store.papers) {
    const tags = p.extraction?.tags || [];
    if (!tags.includes(tag)) continue;
    await savePaper({ ...p, extraction: { ...p.extraction, tags: tags.filter((t) => t !== tag) } });
    n++;
  }
  return n;
}

export async function render(root) {
  root.innerHTML = `<div class="page-head"><h1>Chủ đề &amp; tag</h1><span class="hint">Chủ đề = thư mục khi xuất Markdown; một paper có một chủ đề chính và có thể gắn thêm nhãn phụ. Tag là từ khoá tự do do model gán.</span><span class="spacer"></span><button id="tp-add" class="primary sm">+ Thêm chủ đề</button></div>
    <div class="table-wrap"><table class="data" id="tp-table"></table></div>
    <h2 style="margin-top:22px;font-size:14px">Tag</h2>
    <div class="row wrap" style="margin-bottom:8px"><input type="search" id="tg-q" placeholder="Lọc tag…" style="max-width:240px"><span id="tg-count" class="hint"></span></div>
    <div class="table-wrap"><table class="data" id="tg-table"></table></div>`;

  const draw = () => {
    const counts = new Map();
    const primary = new Map();
    for (const p of store.papers) {
      for (const id of topicIdsOf(p)) counts.set(id, (counts.get(id) || 0) + 1);
      primary.set(p.topicId || 't_inbox', (primary.get(p.topicId || 't_inbox') || 0) + 1);
    }
    $('tp-table').innerHTML = `<thead><tr><th></th><th>Tên</th><th>Mô tả</th><th>Từ khoá</th><th>Paper (chính + phụ)</th><th></th></tr></thead><tbody>
      ${store.topics.map((t) => `<tr><td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${escapeHtml(t.color || '#888')}"></span></td>
        <td><a href="#/library/${t.id}"><b>${escapeHtml(t.name)}</b></a></td><td>${escapeHtml(t.description || '')}</td>
        <td class="hint">${escapeHtml((t.keywords || []).slice(0, 12).join(', '))}${(t.keywords || []).length > 12 ? '…' : ''}</td>
        <td>${primary.get(t.id) || 0}${(counts.get(t.id) || 0) > (primary.get(t.id) || 0) ? ` <span class="hint">+${(counts.get(t.id) || 0) - (primary.get(t.id) || 0)} phụ</span>` : ''}</td>
        <td style="white-space:nowrap"><button class="sm" data-edit="${t.id}">Sửa</button> <button class="sm" data-merge="${t.id}" title="Chuyển toàn bộ paper sang chủ đề khác rồi xoá">Gộp</button> <button class="sm danger" data-del="${t.id}" ${t.id === 't_inbox' ? 'disabled' : ''}>Xoá</button></td></tr>`).join('')}</tbody>`;
    drawTags();
  };
  const drawTags = () => {
    const q = ($('tg-q').value || '').toLowerCase();
    const idx = [...tagIndex().entries()].filter(([t]) => !q || t.includes(q)).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    $('tg-count').textContent = `${idx.length} tag`;
    $('tg-table').innerHTML = `<thead><tr><th>Tag</th><th>Paper</th><th></th></tr></thead><tbody>
      ${idx.map(([t, ids]) => `<tr><td><a href="#/library?tag=${encodeURIComponent(t)}">#${escapeHtml(t)}</a></td><td>${ids.length}</td>
        <td style="white-space:nowrap"><button class="sm" data-tag-rename="${escapeHtml(t)}">Đổi tên</button> <button class="sm" data-tag-merge="${escapeHtml(t)}">Gộp vào…</button> <button class="sm danger" data-tag-del="${escapeHtml(t)}">Xoá</button></td></tr>`).join('') || '<tr><td colspan="3" class="hint">Chưa có tag.</td></tr>'}</tbody>`;
  };
  draw();
  $('tg-q').addEventListener('input', drawTags);

  $('tp-add').addEventListener('click', () => editDialog(null));
  $('tp-table').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const t = store.topics.find((x) => x.id === (b.dataset.edit || b.dataset.merge || b.dataset.del));
    if (!t) return;
    if (b.dataset.edit) return editDialog(t);
    if (b.dataset.del) {
      const n = store.papers.filter((p) => p.topicId === t.id).length;
      if (!(await confirmDialog(`Xoá chủ đề "${t.name}"?${n ? `\n${n} paper trong đó sẽ chuyển về Inbox.` : ''}`, { danger: true, okLabel: 'Xoá' }))) return;
      await removeTopic(t.id, 't_inbox');
      toast('Đã xoá chủ đề.');
    }
    if (b.dataset.merge) {
      const to = await selectDialog(`Gộp "${t.name}" vào chủ đề`, store.topics.filter((x) => x.id !== t.id).map((x) => ({ value: x.id, label: x.name })), { title: 'Gộp chủ đề' });
      if (!to) return;
      const ids = store.papers.filter((p) => p.topicId === t.id).map((p) => p.id);
      if (ids.length) await bulkPapers('move', ids, to);
      for (const p of store.papers) if (p.topicIds?.includes(t.id)) await savePaper({ ...p, topicIds: [...new Set(p.topicIds.map((x) => (x === t.id ? to : x)))].filter((x) => x !== p.topicId) });
      const target = store.topics.find((x) => x.id === to);
      await saveTopic({ ...target, keywords: [...new Set([...(target.keywords || []), ...(t.keywords || [])])] });
      await removeTopic(t.id, to);
      toast(`Đã gộp ${ids.length} paper vào "${target.name}".`);
    }
  });

  $('tg-table').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tagRename) {
      const nn = await promptDialog(`Đổi tên tag "#${b.dataset.tagRename}" thành`, { title: 'Đổi tên tag', value: b.dataset.tagRename });
      if (!nn) return;
      const n = await renameTag(b.dataset.tagRename, nn);
      toast(`Đã đổi tên trên ${n} paper.`);
    } else if (b.dataset.tagMerge) {
      const others = [...tagIndex().keys()].filter((t) => t !== b.dataset.tagMerge).sort();
      const to = await selectDialog(`Gộp "#${b.dataset.tagMerge}" vào tag`, others.map((t) => ({ value: t, label: `#${t}` })), { title: 'Gộp tag' });
      if (!to) return;
      const n = await renameTag(b.dataset.tagMerge, to);
      toast(`Đã gộp trên ${n} paper.`);
    } else if (b.dataset.tagDel) {
      if (!(await confirmDialog(`Xoá tag "#${b.dataset.tagDel}" khỏi mọi paper?`, { danger: true, okLabel: 'Xoá' }))) return;
      const n = await deleteTag(b.dataset.tagDel);
      toast(`Đã xoá khỏi ${n} paper.`);
    }
  });
  return onChange(draw);
}
