// Kết xuất Markdown: note từng paper, index từng chủ đề, bảng so sánh.
import { fmtDate, slugify } from './util.js';

const dash = '→'; // mũi tên → dùng trong dòng note rút gọn

function cell(s) {
  return String(s ?? '').replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim() || '-';
}

function bullets(items, empty = '_Không có thông tin._') {
  const list = (items || []).filter(Boolean);
  return list.length ? list.map((i) => `- ${i}`).join('\n') : empty;
}

/** Dòng note rút gọn: Tên paper → Điểm mới → Dataset/Metric → Ý tưởng áp dụng. */
export function quickNoteLine(paper) {
  const e = paper.extraction || {};
  const ideas = (e.applicable_ideas || []).map((i) => i.idea).filter(Boolean).join('; ');
  return [
    paper.title || '(chưa có tên)',
    e.novelty || '(chưa có điểm mới)',
    e.dataset_metric_note || '(chưa có dataset/metric)',
    ideas || '(chưa có ý tưởng áp dụng)',
  ].join(` ${dash} `);
}

export function metricsTable(metrics) {
  const rows = (metrics || []).filter((m) => m && (m.name || m.proposed));
  if (!rows.length) return '_Paper không nêu con số cụ thể._';
  return [
    '| Metric | Dataset | Baseline | Đề xuất | Cải thiện |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((m) => `| ${cell(m.name)} | ${cell(m.dataset)} | ${cell(m.baseline)} | ${cell(m.proposed)} | ${cell(m.delta)} |`),
  ].join('\n');
}

/** Note đầy đủ của một paper. */
export function paperToMarkdown(paper, topic) {
  const e = paper.extraction || {};
  const v = e.validation || {};
  const lim = e.limitation || {};
  const ki = e.key_idea || {};
  const md = [];

  md.push(`# ${paper.title || '(chưa có tên)'}`);
  md.push('');
  const metaBits = [];
  if (e.authors?.length) metaBits.push(`**Tác giả:** ${e.authors.join(', ')}`);
  if (e.venue || e.year) metaBits.push(`**Venue:** ${[e.venue, e.year].filter(Boolean).join(' ')}`);
  if (topic?.name) metaBits.push(`**Chủ đề:** ${topic.name}`);
  if (paper.status) metaBits.push(`**Trạng thái:** ${paper.status}`);
  if (paper.rating) metaBits.push(`**Đánh giá:** ${'★'.repeat(paper.rating)}${'☆'.repeat(5 - paper.rating)}`);
  if (metaBits.length) md.push(metaBits.join(' · '));
  if (paper.url) md.push(`**Link:** ${paper.url}`);
  if (e.tags?.length) md.push(`**Tags:** ${e.tags.map((t) => `#${t.replace(/\s+/g, '-')}`).join(' ')}`);
  md.push(`**Lưu ngày:** ${fmtDate(paper.createdAt)}${e.confidence ? ` · Độ tin cậy trích xuất: ${e.confidence}` : ''}`);
  md.push('');

  if (e.one_liner) {
    md.push(`> ${e.one_liner}`);
    md.push('');
  }

  md.push('## 1. Problem');
  md.push(e.problem || '_Chưa điền._');
  md.push('');

  md.push('## 2. Bottleneck');
  md.push(e.bottleneck || '_Chưa điền._');
  md.push('');

  md.push('## 3. Key Idea / Method');
  md.push(ki.summary || '_Chưa điền._');
  if (ki.components?.length) {
    md.push('');
    for (const c of ki.components) {
      md.push(`- **${c.name || 'Thành phần'}** _(${c.kind || 'other'})_: ${c.detail || ''}`);
    }
  }
  md.push('');

  md.push('## 4. Validation');
  if (v.setup) { md.push(`**Thiết kế:** ${v.setup}`); md.push(''); }
  if (v.datasets?.length) md.push(`**Dataset:** ${v.datasets.join(', ')}`);
  if (v.benchmarks?.length) md.push(`**Benchmark:** ${v.benchmarks.join(', ')}`);
  md.push('');
  md.push(metricsTable(v.metrics));
  md.push('');
  if (v.ablation) { md.push(`**Ablation:** ${v.ablation}`); md.push(''); }
  if (v.main_results) { md.push(`**Kết luận thực nghiệm:** ${v.main_results}`); md.push(''); }

  md.push('## 5. Limitation');
  md.push(bullets(lim.items));
  md.push('');
  if (lim.compute_cost) md.push(`**Chi phí tính toán:** ${lim.compute_cost}`);
  if (lim.unresolved) md.push(`**Chưa giải quyết triệt để:** ${lim.unresolved}`);
  md.push('');

  md.push('## Note nhanh');
  md.push(`\`${quickNoteLine(paper)}\``);
  md.push('');
  md.push(`- **Điểm mới:** ${e.novelty || '-'}`);
  md.push(`- **Dataset/Metric:** ${e.dataset_metric_note || '-'}`);
  md.push('- **Ý tưởng có thể áp dụng cho bài của mình:**');
  if (e.applicable_ideas?.length) {
    for (const i of e.applicable_ideas) {
      md.push(`  - **${i.idea}** — ${i.how_to_apply || ''}${i.effort ? ` _(công sức: ${i.effort})_` : ''}`);
    }
  } else {
    md.push('  - _Chưa có._');
  }
  md.push('');

  md.push('## Ghi chú cá nhân');
  md.push(paper.userNotes?.trim() ? paper.userNotes.trim() : '_(trống)_');
  md.push('');

  if (paper.meta?.model) {
    md.push('---');
    md.push(`_Trích xuất bằng ${paper.meta.provider}/${paper.meta.model} · ${fmtDate(paper.meta.extractedAt)}_`);
  }
  return md.join('\n');
}

/** Bảng so sánh: Tên paper | Điểm mới | Dataset/Metric | Ý tưởng áp dụng. */
export function compareTableMarkdown(papers, { withBottleneck = false } = {}) {
  const head = ['Tên paper', 'Điểm mới', 'Dataset/Metric', 'Ý tưởng có thể áp dụng cho bài của mình'];
  if (withBottleneck) head.splice(1, 0, 'Bottleneck nhắm tới');
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];

  for (const p of papers) {
    const e = p.extraction || {};
    const ideas = (e.applicable_ideas || []).map((i) => i.idea).filter(Boolean).join('; ');
    const row = [
      p.url ? `[${cell(p.title)}](${p.url})` : cell(p.title),
      cell(e.novelty),
      cell(e.dataset_metric_note),
      cell(ideas),
    ];
    if (withBottleneck) row.splice(1, 0, cell(e.bottleneck));
    lines.push(`| ${row.join(' | ')} |`);
  }
  return lines.join('\n');
}

/** File _index.md cho mỗi thư mục chủ đề. */
export function topicIndexMarkdown(topic, papers) {
  const md = [];
  md.push(`# ${topic?.name || 'Chưa phân loại'}`);
  if (topic?.description) { md.push(''); md.push(`_${topic.description}_`); }
  md.push('');
  md.push(`Tổng cộng **${papers.length}** paper · cập nhật ${fmtDate(new Date().toISOString())}`);
  md.push('');
  md.push('## Bảng so sánh');
  md.push('');
  md.push(papers.length ? compareTableMarkdown(papers) : '_Chưa có paper nào._');
  md.push('');
  md.push('## Danh sách note');
  md.push('');
  for (const p of papers) {
    md.push(`- [${p.title || '(chưa có tên)'}](./${slugify(p.title || p.id)}.md)${p.extraction?.year ? ` (${p.extraction.year})` : ''}`);
  }
  return md.join('\n');
}

/** Một file Markdown gộp toàn bộ thư viện. */
export function libraryToMarkdown(papers, topics) {
  const byTopic = new Map();
  for (const p of papers) {
    const key = p.topicId || '__none__';
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key).push(p);
  }
  const md = ['# PaperVault — Toàn bộ thư viện', '', `_Xuất ngày ${fmtDate(new Date().toISOString())} · ${papers.length} paper_`, ''];
  for (const [topicId, list] of byTopic) {
    const topic = topics.find((t) => t.id === topicId);
    md.push(`## ${topic?.name || 'Chưa phân loại'} (${list.length})`);
    md.push('');
    md.push(compareTableMarkdown(list));
    md.push('');
    for (const p of list) {
      md.push(paperToMarkdown(p, topic));
      md.push('');
      md.push('---');
      md.push('');
    }
  }
  return md.join('\n');
}
