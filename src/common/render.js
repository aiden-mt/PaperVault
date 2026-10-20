// Render 5 mục trích xuất ra HTML (dùng chung popup + library).
import { escapeHtml } from './util.js';

const KIND_LABEL = {
  architecture: 'architecture', loss: 'loss function', data: 'data',
  training: 'training', pipeline: 'pipeline', inference: 'inference', other: 'khác',
};

function para(s, empty = '<em class="muted">Chưa có.</em>') {
  const t = String(s || '').trim();
  return t ? escapeHtml(t) : empty;
}

function list(items) {
  const arr = (items || []).filter(Boolean);
  if (!arr.length) return '<em class="muted">Chưa có.</em>';
  return `<ul>${arr.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

function metricsHtml(metrics) {
  const rows = (metrics || []).filter((m) => m && (m.name || m.proposed));
  if (!rows.length) return '<em class="muted">Paper không nêu con số cụ thể.</em>';
  return `<table>
    <tr><th>Metric</th><th>Dataset</th><th>Baseline</th><th>Đề xuất</th><th>Δ</th></tr>
    ${rows.map((m) => `<tr>
      <td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.dataset)}</td>
      <td>${escapeHtml(m.baseline)}</td><td><b>${escapeHtml(m.proposed)}</b></td>
      <td>${escapeHtml(m.delta)}</td></tr>`).join('')}
  </table>`;
}

/** Trả về HTML gồm 5 khối <details>. openFirst = mở sẵn khối đầu. */
export function renderSections(e, { openFirst = true } = {}) {
  const ki = e.key_idea || {};
  const v = e.validation || {};
  const lim = e.limitation || {};

  const components = (ki.components || []).length
    ? `<ul>${ki.components.map((c) => `<li><b>${escapeHtml(c.name)}</b> <span class="badge">${escapeHtml(KIND_LABEL[c.kind] || c.kind || 'khác')}</span><br>${escapeHtml(c.detail)}</li>`).join('')}</ul>`
    : '';

  const ideas = (e.applicable_ideas || []).length
    ? `<ul>${e.applicable_ideas.map((i) => `<li><b>${escapeHtml(i.idea)}</b> — ${escapeHtml(i.how_to_apply)}${i.effort ? ` <span class="badge">công sức: ${escapeHtml(i.effort)}</span>` : ''}</li>`).join('')}</ul>`
    : '<em class="muted">Chưa có.</em>';

  const blocks = [
    ['1. Problem', para(e.problem)],
    ['2. Bottleneck', para(e.bottleneck)],
    ['3. Key Idea / Method', `${para(ki.summary)}${components}`],
    ['4. Validation', [
      v.setup ? `<b>Thiết kế:</b> ${escapeHtml(v.setup)}` : '',
      (v.datasets || []).length ? `<b>Dataset:</b> ${escapeHtml(v.datasets.join(', '))}` : '',
      (v.benchmarks || []).length ? `<b>Benchmark:</b> ${escapeHtml(v.benchmarks.join(', '))}` : '',
      metricsHtml(v.metrics),
      v.ablation ? `<b>Ablation:</b> ${escapeHtml(v.ablation)}` : '',
      v.main_results ? `<b>Kết luận:</b> ${escapeHtml(v.main_results)}` : '',
    ].filter(Boolean).join('<br>')],
    ['5. Limitation', [
      list(lim.items),
      lim.compute_cost ? `<b>Chi phí tính toán:</b> ${escapeHtml(lim.compute_cost)}` : '',
      lim.unresolved ? `<b>Chưa giải quyết triệt để:</b> ${escapeHtml(lim.unresolved)}` : '',
    ].filter(Boolean).join('<br>')],
    ['Note nhanh (để so sánh)', [
      `<b>Điểm mới:</b> ${para(e.novelty)}`,
      `<b>Dataset/Metric:</b> ${para(e.dataset_metric_note)}`,
      `<b>Ý tưởng áp dụng cho bài của mình:</b>${ideas}`,
    ].join('<br>')],
  ];

  return blocks.map(([title, body], idx) => `
    <details${openFirst && idx === 0 ? ' open' : ''}>
      <summary>${title}</summary>
      <div class="body">${body}</div>
    </details>`).join('');
}
