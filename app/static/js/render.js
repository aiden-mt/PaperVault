// Render ghi chú trích xuất ra HTML theo thứ tự template đọc paper (1-12, References, Important Evidence).
// lang = 'vi' | 'en' đổi nhãn các mục cho khớp ngôn ngữ đang hiển thị.
import { escapeHtml } from './util.js';
import { mdToHtml } from './ui.js';
import { stripMarker } from './readable.js';
import { localizeFixed } from './langfix.js';
import { splitLimitations } from './schema.js';
import { rich, richBlock } from './richtext.js';

const KIND_LABEL = {
  architecture: 'architecture', loss: 'loss function', data: 'data',
  training: 'training', pipeline: 'pipeline', inference: 'inference', other: 'other',
};

/** Nhãn mục và trường theo ngôn ngữ, dùng chung cho HTML và Markdown. */
export const NOTE_LABELS = {
  vi: {
    empty: 'Chưa có.', s12: '1–2. Paper · Venue/Year', paper: 'Paper', authors: 'Tác giả', venueYear: 'Venue/Year',
    s3: '3. Problem & Motivation', problem: 'Nghiên cứu giải quyết bài toán gì', motivation: 'Tại sao bài toán này quan trọng',
    s4: '4. Research Gap', s5: '5. Research Question / Objective', goal: 'Mục tiêu chính', hypothesis: 'Giả thuyết nghiên cứu',
    s6: '6. Method', summary: 'Ý tưởng cốt lõi', pipeline: 'Các bước chính trong pipeline', components: 'Mô hình / kỹ thuật được sử dụng', novelty: 'Điểm khác biệt so với existing methods',
    s7: '7. Contribution', s8: '8. Dataset', dsCols: ['Dataset', 'Source', 'Scale', 'Đặc điểm', 'Tiền xử lý / lọc'], dsName: 'Dataset name',
    s9: '9. Experiments', setup: 'Experimental setup', baselines: 'Baselines', benchmarks: 'Benchmark', metrics: 'Kết quả định lượng', ablation: 'Ablation study',
    mCols: ['Metric', 'Dataset', 'Baseline', 'Đề xuất', 'Δ'], noMetrics: 'Paper không nêu con số cụ thể.',
    s10: '10. Findings', findings: 'Phát hiện chính', mainResults: 'Kết quả hỗ trợ contribution', dmNote: 'Tóm tắt dataset/metric',
    s11: '11. Limitations', stated: 'Tác giả thừa nhận', observed: 'Nhận thấy khi phân tích', unresolved: 'Chưa được giải quyết', compute: 'Chi phí tính toán',
    s12b: '12. Relevance to Our Work', projectPart: 'Liên quan đến phần nào của dự án', inherit: 'Có thể kế thừa', extend: 'Có thể cải thiện / mở rộng', claims: 'Có thể trích dẫn để hỗ trợ luận điểm', effort: 'công sức',
    refs: 'References', evidence: 'Important Evidence', evCols: ['Claim / Evidence', 'Section / Page / Table', 'Citation Purpose'], legacy: 'Ghi chú template (bản cũ)',
    chain: 'Chuỗi lập luận', warnings: 'Lưu ý khi đọc',
    roles: { premise: 'tiền đề', gap: 'khoảng trống', claim: 'luận điểm', method: 'cách làm', evidence: 'bằng chứng', conclusion: 'kết luận' },
  },
  en: {
    empty: 'Not available.', s12: '1–2. Paper · Venue/Year', paper: 'Paper', authors: 'Authors', venueYear: 'Venue/Year',
    s3: '3. Problem & Motivation', problem: 'Problem addressed', motivation: 'Why it matters',
    s4: '4. Research Gap', s5: '5. Research Question / Objective', goal: 'Main objective', hypothesis: 'Research hypothesis',
    s6: '6. Method', summary: 'Core idea', pipeline: 'Main pipeline steps', components: 'Models / techniques used', novelty: 'Difference from existing methods',
    s7: '7. Contribution', s8: '8. Dataset', dsCols: ['Dataset', 'Source', 'Scale', 'Characteristics', 'Preprocessing / filtering'], dsName: 'Dataset name',
    s9: '9. Experiments', setup: 'Experimental setup', baselines: 'Baselines', benchmarks: 'Benchmarks', metrics: 'Key quantitative results', ablation: 'Ablation study',
    mCols: ['Metric', 'Dataset', 'Baseline', 'Proposed', 'Δ'], noMetrics: 'No concrete numbers reported.',
    s10: '10. Findings', findings: 'Key findings', mainResults: 'Results supporting the contribution', dmNote: 'Dataset/metric summary',
    s11: '11. Limitations', stated: 'Acknowledged by the authors', observed: 'Identified through analysis', unresolved: 'Unresolved issues', compute: 'Computational cost',
    s12b: '12. Relevance to Our Work', projectPart: 'Related part of our project', inherit: 'Methods we can adopt', extend: 'Possible improvements / extensions', claims: 'Claims this paper can support', effort: 'effort',
    refs: 'References', evidence: 'Important Evidence', evCols: ['Claim / Evidence', 'Section / Page / Table', 'Citation Purpose'], legacy: 'Template notes (legacy)',
    chain: 'Argument chain', warnings: 'Reader warnings',
    roles: { premise: 'premise', gap: 'gap', claim: 'claim', method: 'method', evidence: 'evidence', conclusion: 'conclusion' },
  },
};
export const labelsFor = (lang) => NOTE_LABELS[lang === 'en' ? 'en' : 'vi'];

/** Giá trị enum công sức lưu bằng tiếng Việt, hiển thị theo ngôn ngữ đang chọn. */
const EFFORT_EN = { 'thấp': 'low', 'trung bình': 'medium', 'cao': 'high' };
export const effortLabel = (v, lang) => (lang === 'en' ? EFFORT_EN[v] || v : v);

const has = (s) => String(s ?? '').trim() !== '';

/**
 * HTML các khối <details> theo template. openFirst = mở sẵn khối đầu.
 * paper (tuỳ chọn) để hiện link / DOI ở mục References. lang chọn nhãn tiếng Việt hoặc tiếng Anh.
 * redo = true thêm nút trích xuất lại riêng từng mục (xem section-extract.js).
 */
export function renderSections(e, { openFirst = true, paper = null, lang = 'vi', redo = false } = {}) {
  e = localizeFixed(e || {}, lang); // "Không nêu" trong bản tiếng Anh -> "Not stated."…
  const L = labelsFor(lang);
  const EMPTY = `<em class="muted">${L.empty}</em>`;
  const para = (s) => (has(s) ? richBlock(String(s).trim()) : EMPTY);
  const field = (label, value) => (has(value) ? `<div class="f"><b>${label}:</b> ${richBlock(String(value).trim())}</div>` : '');
  const list = (items, { ordered = false } = {}) => {
    const arr = (items || []).filter(has);
    if (!arr.length) return EMPTY;
    const tag = ordered ? 'ol' : 'ul';
    return `<${tag}>${arr.map((i) => `<li>${rich(stripMarker(i))}</li>`).join('')}</${tag}>`;
  };
  const labeledList = (label, items, opts) => ((items || []).filter(has).length ? `<div class="f"><b>${label}:</b>${list(items, opts)}</div>` : '');
  const join = (parts) => parts.filter(Boolean).join('') || EMPTY;
  const table = (cols, rows) => `<table><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${rows.join('')}</table>`;

  const ki = e.key_idea || {};
  const v = e.validation || {};
  const lim = e.limitation || {};
  const obj = e.objective || {};
  const rel = e.relevance || {};
  const { stated, observed } = splitLimitations(lim.items);

  const metrics = (v.metrics || []).filter((m) => m && (m.name || m.proposed));
  const metricsHtml = metrics.length
    ? `<div class="f"><b>${L.metrics}:</b></div>${table(L.mCols, metrics.map((m) => `<tr><td>${rich(m.name)}</td><td>${rich(m.dataset)}</td><td>${rich(m.baseline)}</td><td><b>${rich(m.proposed)}</b></td><td>${rich(m.delta)}</td></tr>`))}`
    : '';
  const details = e.dataset_details || [];
  const datasetsHtml = details.length
    ? table(L.dsCols, details.map((d) => `<tr><td><b>${rich(d.name)}</b></td><td>${rich(d.source)}</td><td>${rich(d.scale)}</td><td>${rich(d.characteristics)}</td><td>${rich(d.preprocessing)}</td></tr>`))
    : list(v.datasets); // paper trích xuất theo 5 mục cũ chỉ có tên dataset
  const ev = (e.evidence || []).filter((x) => x && (x.claim || x.location));
  const evidenceHtml = ev.length ? table(L.evCols, ev.map((x) => `<tr><td>${rich(x.claim)}</td><td>${rich(x.location)}</td><td>${rich(x.purpose)}</td></tr>`)) : EMPTY;

  const components = (ki.components || []).length
    ? `<div class="f"><b>${L.components}:</b><ul>${ki.components.map((c) => `<li><b>${rich(c.name)}</b> <span class="badge">${escapeHtml(KIND_LABEL[c.kind] || c.kind || 'other')}</span><br>${rich(c.detail)}</li>`).join('')}</ul></div>`
    : '';
  const ideas = (e.applicable_ideas || []).length
    ? `<div class="f"><b>${L.inherit}:</b><ul>${e.applicable_ideas.map((i) => `<li><b>${rich(i.idea)}</b> — ${rich(i.how_to_apply)}${i.effort ? ` <span class="badge">${L.effort}: ${escapeHtml(effortLabel(i.effort, lang))}</span>` : ''}</li>`).join('')}</ul></div>`
    : '';
  const link = (href, label) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(label || href)}</a>`;
  const doi = paper?.doi || e.doi;
  const refs = [
    paper?.url ? `<div class="f"><b>Paper URL:</b> ${link(paper.url)}</div>` : '',
    paper?.arxivId ? `<div class="f"><b>arXiv:</b> ${link(`https://arxiv.org/abs/${paper.arxivId}`, paper.arxivId)}</div>` : '',
    doi ? `<div class="f"><b>DOI:</b> ${link(`https://doi.org/${doi}`, doi)}</div>` : '',
    e.code_url && /^https?:\/\//i.test(e.code_url) ? `<div class="f"><b>Code/GitHub:</b> ${link(e.code_url)}</div>` : field('Code/GitHub', e.code_url),
  ];

  const blocks = [
    ['s12', L.s12, join([field(L.paper, e.title || paper?.title), field(L.authors, (e.authors || []).join(', ')), field(L.venueYear, [e.venue, e.year].filter(Boolean).join(' / '))])],
    ['s3', L.s3, join([field(L.problem, e.problem), field(L.motivation, e.motivation)])],
    ['s4', L.s4, para(e.bottleneck)],
    ['s5', L.s5, join([field(L.goal, obj.goal), field(L.hypothesis, obj.hypothesis)])],
    ['s6', L.s6, join([field(L.summary, ki.summary), labeledList(L.pipeline, ki.pipeline, { ordered: true }), components, field(L.novelty, e.novelty)])],
    ['s7', L.s7, list(e.contributions)],
    ['s8', L.s8, datasetsHtml],
    ['s9', L.s9, join([field(L.setup, v.setup), labeledList(L.baselines, v.baselines), field(L.benchmarks, (v.benchmarks || []).join(', ')), metricsHtml, field(L.ablation, v.ablation)])],
    ['s10', L.s10, join([labeledList(L.findings, v.findings), field(L.mainResults, v.main_results), field(L.dmNote, e.dataset_metric_note)])],
    ['s11', L.s11, join([labeledList(L.stated, stated), labeledList(L.observed, observed), field(L.unresolved, lim.unresolved), field(L.compute, lim.compute_cost)])],
    ['s12b', L.s12b, join([field(L.projectPart, rel.project_part), ideas, field(L.extend, rel.extend_or_improve), labeledList(L.claims, rel.citation_claims)])],
    ['refs', L.refs, join(refs)],
    ['evidence', L.evidence, evidenceHtml],
  ];
  const chain = (e.argument_chain || []).filter((x) => x && x.step);
  if (chain.length) {
    blocks.push(['chain', L.chain, `<ol class="arg-chain">${chain.map((x) => `<li><span class="arg-role arg-${escapeHtml(x.role || 'claim')}">${escapeHtml(L.roles[x.role] || x.role || '')}</span> ${rich(x.step)}${has(x.section) ? ` <span class="hint">· ${rich(x.section)}</span>` : ''}</li>`).join('')}</ol>`]);
  }
  if ((e.reader_warnings || []).filter(has).length) blocks.push(['warnings', L.warnings, `<ul class="reader-warn">${e.reader_warnings.filter(has).map((w) => `<li>${rich(w)}</li>`).join('')}</ul>`]);
  // Ghi chú Markdown theo template của bản trước (nếu paper từng được điền).
  if (has(e.research_notes)) blocks.push(['', L.legacy, `<div class="tpl-notes">${mdToHtml(e.research_notes)}</div>`]);

  // Hai mục cuối chỉ hiện khi có nội dung. Khi cho trích xuất lại thì luôn hiện để mục đang trống vẫn bấm được.
  if (redo) {
    if (!blocks.some(([k]) => k === 'chain')) blocks.push(['chain', L.chain, EMPTY]);
    if (!blocks.some(([k]) => k === 'warnings')) blocks.push(['warnings', L.warnings, EMPTY]);
  }
  const redoBtn = (key, title) => (redo && key
    ? `<button type="button" class="sec-redo" data-redo="${key}" data-label="${rich(title)}" title="${lang === 'en' ? 'Re-extract this section only' : 'Trích xuất lại riêng mục này'}">↻</button>` : '');
  return blocks.map(([key, title, body], idx) => `
    <details${openFirst && idx === 0 ? ' open' : ''}${key ? ` data-sec="${key}"` : ''}>
      <summary><span>${title}</span>${redoBtn(key, title)}</summary>
      <div class="body">${body}</div>
    </details>`).join('');
}
