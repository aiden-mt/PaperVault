// Danh mục cột cho bảng so sánh: mọi thông số trích xuất từ paper, chia nhóm theo template đọc paper.
// Mỗi cột trả về chuỗi hoặc mảng chuỗi (mảng hiện thành danh sách). Dùng chung cho bảng HTML, Markdown, CSV, LaTeX, Word.
import { splitLimitations } from './schema.js';

const s = (v) => String(v ?? '').trim();
const arr = (v) => (v || []).map(s).filter(Boolean);
const rankText = (p) => {
  const vi = p.venueInfo || {};
  return [
    vi.rank && !vi.parent ? `${vi.system || 'CORE'} ${vi.rank}` : '',
    vi.parent?.rank ? `(${vi.parent.acronym || 'parent'} ${vi.parent.rank})` : '',
    vi.quartile ? `SJR ${vi.quartile}` : '',
  ].filter(Boolean).join(' · ');
};
const effortEn = { 'thấp': 'low', 'trung bình': 'medium', 'cao': 'high' };

/** [key, nhóm, nhãn vi, nhãn en, (paper, extraction, lang) => chuỗi | mảng] */
const DEFS = [
  ['venue', 'general', 'Venue / Năm / Hạng', 'Venue / Year / Rank', (p, e) => [[e.venue, e.year].filter(Boolean).join(' '), rankText(p)].filter(Boolean).join(' · ')],
  ['authors', 'general', 'Tác giả', 'Authors', (p, e) => arr(e.authors).join(', ')],
  ['citations', 'general', 'Số trích dẫn', 'Citations', (p) => (p.citationCount != null ? String(p.citationCount) : '')],
  ['oneLiner', 'general', 'Tóm tắt một câu', 'One-line summary', (p, e) => s(e.one_liner)],

  ['problem', 'problem', 'Bài toán', 'Problem', (p, e) => s(e.problem)],
  ['motivation', 'problem', 'Tại sao quan trọng', 'Motivation', (p, e) => s(e.motivation)],
  ['bottleneck', 'problem', 'Research gap (bottleneck)', 'Research gap', (p, e) => s(e.bottleneck)],
  ['objective', 'problem', 'Mục tiêu / giả thuyết', 'Objective / hypothesis', (p, e, lang) => [s(e.objective?.goal), s(e.objective?.hypothesis) ? `${lang === 'en' ? 'Hypothesis' : 'Giả thuyết'}: ${s(e.objective.hypothesis)}` : ''].filter(Boolean)],

  ['keyIdea', 'method', 'Ý tưởng cốt lõi', 'Core idea', (p, e) => s(e.key_idea?.summary)],
  ['pipeline', 'method', 'Các bước pipeline', 'Pipeline steps', (p, e) => arr(e.key_idea?.pipeline).map((x, i) => `${i + 1}. ${x}`)],
  ['components', 'method', 'Mô hình / kỹ thuật', 'Models / techniques', (p, e) => (e.key_idea?.components || []).map((c) => `${s(c.name)}${c.kind ? ` (${c.kind})` : ''}${c.detail ? `: ${s(c.detail)}` : ''}`).filter(Boolean)],
  ['novelty', 'method', 'Điểm mới', 'Novelty', (p, e) => s(e.novelty)],
  ['contributions', 'method', 'Đóng góp', 'Contributions', (p, e) => arr(e.contributions)],

  ['datasets', 'exp', 'Dataset (chi tiết)', 'Datasets (details)', (p, e) => ((e.dataset_details || []).length
    ? e.dataset_details.map((d) => [s(d.name), [s(d.scale), s(d.source)].filter(Boolean).join(', ')].filter(Boolean).join(' — '))
    : arr(e.validation?.datasets))],
  ['setup', 'exp', 'Experimental setup', 'Experimental setup', (p, e) => s(e.validation?.setup)],
  ['baselines', 'exp', 'Baselines', 'Baselines', (p, e) => arr(e.validation?.baselines).join(', ')],
  ['benchmarks', 'exp', 'Benchmark', 'Benchmarks', (p, e) => arr(e.validation?.benchmarks).join(', ')],
  ['metrics', 'exp', 'Kết quả số', 'Quantitative results', (p, e) => (e.validation?.metrics || []).filter((m) => m && (m.name || m.proposed))
    .map((m) => `${s(m.name)}${m.dataset ? ` @ ${s(m.dataset)}` : ''}: ${s(m.proposed)}${m.baseline ? ` (vs ${s(m.baseline)})` : ''}${m.delta ? ` ${s(m.delta)}` : ''}`)],
  ['ablation', 'exp', 'Ablation', 'Ablation', (p, e) => s(e.validation?.ablation)],

  ['findings', 'findings', 'Phát hiện chính', 'Key findings', (p, e) => arr(e.validation?.findings)],
  ['mainResults', 'findings', 'Kết quả hỗ trợ contribution', 'Results supporting contribution', (p, e) => s(e.validation?.main_results)],
  ['dmNote', 'findings', 'Dataset / Metric (tóm tắt)', 'Dataset / Metric (summary)', (p, e) => s(e.dataset_metric_note)],

  ['limStated', 'limits', 'Hạn chế tác giả thừa nhận', 'Limitations (authors)', (p, e) => splitLimitations(e.limitation?.items).stated],
  ['limObserved', 'limits', 'Hạn chế nhận thấy khi phân tích', 'Limitations (analysis)', (p, e) => splitLimitations(e.limitation?.items).observed],
  ['unresolved', 'limits', 'Vấn đề chưa giải quyết', 'Unresolved issues', (p, e) => s(e.limitation?.unresolved)],
  ['compute', 'limits', 'Chi phí tính toán', 'Computational cost', (p, e) => s(e.limitation?.compute_cost)],

  ['projectPart', 'relevance', 'Liên quan phần nào của đề tài', 'Related part of our project', (p, e) => s(e.relevance?.project_part)],
  ['ideas', 'relevance', 'Ý tưởng áp dụng / kế thừa', 'Ideas to adopt', (p, e, lang) => (e.applicable_ideas || []).map((i) => `${s(i.idea)}${i.how_to_apply ? ` — ${s(i.how_to_apply)}` : ''}${i.effort ? ` (${lang === 'en' ? `effort: ${effortEn[i.effort] || i.effort}` : `công sức: ${i.effort}`})` : ''}`).filter(Boolean)],
  ['extend', 'relevance', 'Cải thiện / mở rộng', 'Improvements / extensions', (p, e) => s(e.relevance?.extend_or_improve)],
  ['claims', 'relevance', 'Luận điểm có thể trích dẫn', 'Citable claims', (p, e) => arr(e.relevance?.citation_claims)],

  ['evidence', 'refs', 'Important evidence', 'Important evidence', (p, e) => (e.evidence || []).filter((x) => x && (x.claim || x.location))
    .map((x) => `${s(x.claim)}${x.location ? ` [${s(x.location)}]` : ''}${x.purpose ? ` → ${s(x.purpose)}` : ''}`)],
  ['chain', 'refs', 'Chuỗi lập luận', 'Argument chain', (p, e) => (e.argument_chain || []).filter((x) => x && x.step).map((x) => `[${x.role || ''}] ${s(x.step)}`)],
  ['warnings', 'refs', 'Lưu ý khi đọc', 'Reader warnings', (p, e) => arr(e.reader_warnings)],
  ['doi', 'refs', 'DOI', 'DOI', (p, e) => s(p.doi || e.doi)],
  ['code', 'refs', 'Code / GitHub', 'Code / GitHub', (p, e) => s(e.code_url)],
  ['link', 'refs', 'Link paper', 'Paper link', (p) => s(p.url || (p.arxivId ? `https://arxiv.org/abs/${p.arxivId}` : ''))],
  ['tags', 'refs', 'Tags', 'Tags', (p, e) => arr(e.tags).join(', ')],
];

export const COL_GROUPS = [
  ['general', 'Thông tin chung', 'General'],
  ['problem', '3–5. Problem, Research Gap, Objective', '3–5. Problem, Gap, Objective'],
  ['method', '6–7. Method, Contribution', '6–7. Method, Contribution'],
  ['exp', '8–9. Dataset, Experiments', '8–9. Dataset, Experiments'],
  ['findings', '10. Findings', '10. Findings'],
  ['limits', '11. Limitations', '11. Limitations'],
  ['relevance', '12. Relevance to Our Work', '12. Relevance to Our Work'],
  ['refs', 'References, Evidence', 'References, Evidence'],
];

export const COLUMNS = DEFS.map(([key, group, vi, en, get]) => ({ key, group, vi, en, get }));
export const DEFAULT_COLS = ['novelty', 'dmNote', 'ideas'];
export const ALL_COLS = COLUMNS.map((c) => c.key);

/** Các cột đang chọn theo đúng thứ tự trong danh mục. */
export function pickColumns(keys) {
  const set = new Set(keys && keys.length ? keys : DEFAULT_COLS);
  return COLUMNS.filter((c) => set.has(c.key));
}

export const colLabel = (c, lang) => (lang === 'en' ? c.en : c.vi);

/** Giá trị một ô: chuỗi hoặc mảng chuỗi. */
export function cellValue(col, paper, extraction, lang = 'vi') {
  const v = col.get(paper, extraction || paper.extraction || {}, lang);
  return Array.isArray(v) ? v.filter(Boolean) : s(v);
}

/** Ô dạng một dòng văn bản (cho Markdown, CSV, LaTeX). */
export const cellText = (v, sep = '; ') => (Array.isArray(v) ? v.join(sep) : v);

/* ---------- Xuất bảng theo các cột đang chọn ---------- */
// items: [{ paper, extraction }] (extraction có thể là bản đã dịch). lang: nhãn cột.

const titleHead = (lang) => (lang === 'en' ? 'Paper' : 'Tên paper');
const mdCell = (v) => String(v ?? '').replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim() || '-';

export function tableMarkdown(items, columns, lang = 'vi') {
  const head = [titleHead(lang), ...columns.map((c) => colLabel(c, lang))];
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const { paper: p, extraction: e } of items) {
    const title = p.url ? `[${mdCell(p.title)}](${p.url})` : mdCell(p.title);
    lines.push(`| ${[title, ...columns.map((c) => mdCell(cellText(cellValue(c, p, e, lang), '<br>')))].join(' | ')} |`);
  }
  return lines.join('\n');
}

export function tableCsv(items, columns, lang = 'vi') {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [[titleHead(lang), ...columns.map((c) => colLabel(c, lang))].map(esc).join(',')];
  for (const { paper: p, extraction: e } of items) rows.push([p.title, ...columns.map((c) => cellText(cellValue(c, p, e, lang), '\n'))].map(esc).join(','));
  return `﻿${rows.join('\r\n')}\r\n`;
}

export function tableLatex(items, columns, { lang = 'vi', latexEscape, bibtexKey }) {
  // Cột tên paper rộng cố định, các cột còn lại chia đều phần còn lại, tự xuống dòng và canh trái cho dễ đọc.
  const rag = '>{\\raggedright\\arraybackslash}';
  const spec = `${rag}p{${columns.length > 4 ? '0.16' : '0.22'}\\textwidth}${`${rag}X`.repeat(columns.length)}`;
  const head = [titleHead(lang), ...columns.map((c) => colLabel(c, lang))];
  const rows = items.map(({ paper: p, extraction: e }) => {
    const cells = [`${latexEscape(p.title || '')} \\cite{${bibtexKey(p)}}`, ...columns.map((c) => latexEscape(cellText(cellValue(c, p, e, lang))) || '--')];
    return `    ${cells.join(' & ')} \\\\`;
  });
  return [
    '% Sinh bởi PaperVault. Cần trong preamble:',
    '%   \\usepackage{tabularx,booktabs,array}',
    lang === 'en' ? '%   \\usepackage[utf8]{inputenc}' : '%   \\usepackage[utf8]{inputenc} \\usepackage[T5]{fontenc} \\usepackage[vietnamese]{babel}  (hoặc biên dịch bằng XeLaTeX)',
    '% Kèm file references.bib (nút BibTeX) để \\cite{} hoạt động.',
    '',
    '\\begin{table*}[t]', '  \\centering', columns.length > 4 ? '  \\scriptsize' : '  \\small', '  \\setlength{\\tabcolsep}{4pt}',
    `  \\begin{tabularx}{\\textwidth}{${spec}}`, '    \\toprule',
    `    ${head.map((h) => `\\textbf{${latexEscape(h)}}`).join(' & ')} \\\\`, '    \\midrule',
    ...rows.flatMap((r, i) => (i ? ['    \\addlinespace', r] : [r])), '    \\bottomrule', '  \\end{tabularx}',
    `  \\caption{${lang === 'en' ? 'Comparison of related work.' : 'So sánh các công trình liên quan.'}}`, '  \\label{tab:related-work}', '\\end{table*}',
  ].join('\n');
}

const escH = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cellHtml = (v) => (Array.isArray(v) ? (v.length ? `<ul style="margin:0;padding-left:14pt">${v.map((x) => `<li>${escH(x)}</li>`).join('')}</ul>` : '—') : (escH(v) || '—'));

export function tableWordHtml(items, columns, lang = 'vi') {
  const head = [titleHead(lang), ...columns.map((c) => colLabel(c, lang))];
  const rows = items.map(({ paper: p, extraction: e }) => {
    const ex = e || p.extraction || {};
    const cells = [`<b>${escH(p.title)}</b>${ex.year ? ` (${escH(ex.year)})` : ''}`, ...columns.map((c) => cellHtml(cellValue(c, p, e, lang)))];
    return `<tr>${cells.map((c) => `<td valign="top">${c}</td>`).join('')}</tr>`;
  });
  return `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:${columns.length > 5 ? 8 : 10}pt"><thead><tr>${head.map((h) => `<th style="background:#eee">${escH(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
