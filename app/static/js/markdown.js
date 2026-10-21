// Kết xuất Markdown: note từng paper, index từng chủ đề, bảng so sánh, BibTeX, file xuất thư mục.
import { fmtDate, slugify } from './util.js';
import { stripMarker } from './readable.js';
import { localizeFixed } from './langfix.js';
import { splitLimitations } from './schema.js';
import { labelsFor, effortLabel } from './render.js';

const dash = '→';

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

export function metricsTable(metrics, L = null) {
  const rows = (metrics || []).filter((m) => m && (m.name || m.proposed));
  if (!rows.length) return `_${L ? L.noMetrics : 'Paper không nêu con số cụ thể.'}_`;
  return [
    L ? `| ${L.mCols.join(' | ')} |` : '| Metric | Dataset | Baseline | Đề xuất | Cải thiện |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((m) => `| ${cell(m.name)} | ${cell(m.dataset)} | ${cell(m.baseline)} | ${cell(m.proposed)} | ${cell(m.delta)} |`),
  ].join('\n');
}

/**
 * Note đầy đủ của một paper, theo đúng thứ tự template đọc paper.
 * extraction / lang (tuỳ chọn): xuất bản ghi chú đã dịch, nhãn mục theo ngôn ngữ đó.
 */
export function paperToMarkdown(paper, topic, { extraction = null, lang = 'vi' } = {}) {
  const L = labelsFor(lang);
  const en = lang === 'en';
  const e = localizeFixed(extraction || paper.extraction || {}, lang);
  const v = e.validation || {};
  const lim = e.limitation || {};
  const ki = e.key_idea || {};
  const obj = e.objective || {};
  const rel = e.relevance || {};
  const { stated, observed } = splitLimitations(lim.items);
  const md = [];
  const NA = en ? '_Not stated._' : '_Không nêu._';
  const line = (label, value) => { if (String(value ?? '').trim()) md.push(`- **${label}:** ${String(value).trim()}`); };
  const sub = (label, items) => {
    const arr = (items || []).filter(Boolean);
    if (!arr.length) return;
    md.push(`- **${label}:**`);
    for (const x of arr) md.push(`  - ${x}`);
  };
  const section = (title) => { md.push(''); md.push(`### ${title}`); };

  md.push(`# ${paper.title || '(chưa có tên)'}`);
  md.push('');
  const metaBits = [];
  if (topic?.name) metaBits.push(`**${en ? 'Topic' : 'Chủ đề'}:** ${topic.name}`);
  if (paper.status) metaBits.push(`**${en ? 'Status' : 'Trạng thái'}:** ${paper.status}`);
  if (paper.rating) metaBits.push(`**${en ? 'Rating' : 'Đánh giá'}:** ${'★'.repeat(paper.rating)}${'☆'.repeat(5 - paper.rating)}`);
  if (metaBits.length) md.push(metaBits.join(' · '));
  if (e.tags?.length) md.push(`**Tags:** ${e.tags.map((x) => `#${x.replace(/\s+/g, '-')}`).join(' ')}`);
  md.push(`**${en ? 'Saved' : 'Lưu ngày'}:** ${fmtDate(paper.createdAt)}${e.confidence ? ` · ${en ? 'Extraction confidence' : 'Độ tin cậy trích xuất'}: ${e.confidence}` : ''}`);
  if (e.one_liner) { md.push(''); md.push(`> ${e.one_liner}`); }

  section('1. Paper');
  md.push(e.title || paper.title || NA);
  if (e.authors?.length) md.push(`_${e.authors.join(', ')}_`);
  section('2. Venue/Year');
  md.push([e.venue, e.year].filter(Boolean).join(' / ') || NA);

  section(L.s3);
  line(L.problem, e.problem);
  line(L.motivation, e.motivation);
  section(L.s4);
  md.push(e.bottleneck || NA);
  section(L.s5.replace(' / ', '/'));
  line(L.goal, obj.goal);
  line(L.hypothesis, obj.hypothesis);

  section(L.s6);
  line(L.summary, ki.summary);
  if (ki.pipeline?.length) {
    md.push(`- **${L.pipeline}:**`);
    ki.pipeline.forEach((s, n) => md.push(`  ${n + 1}. ${stripMarker(s)}`));
  }
  if (ki.components?.length) {
    md.push(`- **${L.components}:**`);
    for (const c of ki.components) md.push(`  - **${c.name || 'Component'}** _(${c.kind || 'other'})_: ${c.detail || ''}`);
  }
  line(L.novelty, e.novelty);

  section(L.s7);
  md.push(bullets(e.contributions, NA));

  section(L.s8);
  const ds = e.dataset_details || [];
  if (ds.length) {
    md.push(`| ${L.dsCols.join(' | ')} |`);
    md.push('| --- | --- | --- | --- | --- |');
    for (const d of ds) md.push(`| ${cell(d.name)} | ${cell(d.source)} | ${cell(d.scale)} | ${cell(d.characteristics)} | ${cell(d.preprocessing)} |`);
  } else {
    md.push(v.datasets?.length ? `- **${L.dsName}:** ${v.datasets.join(', ')}` : NA);
  }

  section(L.s9);
  line(L.setup, v.setup);
  line(L.baselines, (v.baselines || []).join(', '));
  line(L.benchmarks, (v.benchmarks || []).join(', '));
  line(L.ablation, v.ablation);
  md.push('');
  md.push(`**${L.metrics}:**`);
  md.push('');
  md.push(metricsTable(v.metrics, L));

  section(L.s10);
  sub(L.findings, v.findings);
  line(L.mainResults, v.main_results);
  line(L.dmNote, e.dataset_metric_note);

  section(L.s11);
  sub(L.stated, stated);
  sub(L.observed, observed);
  line(L.unresolved, lim.unresolved);
  line(L.compute, lim.compute_cost);

  section(L.s12b);
  line(L.projectPart, rel.project_part);
  if (e.applicable_ideas?.length) {
    md.push(`- **${L.inherit}:**`);
    for (const x of e.applicable_ideas) md.push(`  - **${x.idea}** — ${x.how_to_apply || ''}${x.effort ? ` _(${L.effort}: ${effortLabel(x.effort, lang)})_` : ''}`);
  }
  line(L.extend, rel.extend_or_improve);
  sub(L.claims, rel.citation_claims);

  section('References');
  md.push(`- **Paper URL:** ${paper.url || (paper.arxivId ? `https://arxiv.org/abs/${paper.arxivId}` : '-')}`);
  md.push(`- **DOI:** ${paper.doi || e.doi || '-'}`);
  md.push(`- **Code/GitHub:** ${e.code_url || '-'}`);

  section('Important Evidence');
  const ev = (e.evidence || []).filter((x) => x && (x.claim || x.location));
  md.push(`| ${L.evCols.join(' | ')} |`);
  md.push('|---|---|---|');
  if (ev.length) for (const x of ev) md.push(`| ${cell(x.claim)} | ${cell(x.location)} | ${cell(x.purpose)} |`);
  else md.push('| | | |');

  const chain = (e.argument_chain || []).filter((x) => x && x.step);
  if (chain.length) {
    section(L.chain);
    chain.forEach((x, n) => md.push(`${n + 1}. **[${L.roles[x.role] || x.role || ''}]** ${x.step}${x.section ? ` _(${x.section})_` : ''}`));
  }
  if ((e.reader_warnings || []).filter(Boolean).length) {
    section(L.warnings);
    md.push(bullets(e.reader_warnings));
  }

  md.push('');
  md.push(`## ${en ? 'Quick note' : 'Note nhanh'}`);
  md.push(`\`${quickNoteLine({ ...paper, extraction: e })}\``);
  md.push('');
  md.push(`## ${en ? 'Personal notes' : 'Ghi chú cá nhân'}`);
  md.push(paper.userNotes?.trim() ? paper.userNotes.trim() : (en ? '_(empty)_' : '_(trống)_'));
  md.push('');
  if (paper.annotations?.length) {
    md.push(`## ${en ? 'Quotes & comments' : 'Trích dẫn & nhận xét'}`);
    for (const a of paper.annotations) {
      md.push(`> ${String(a.quote || '').replace(/\n+/g, ' ')}${a.page ? ` _(${en ? 'p.' : 'tr.'} ${a.page})_` : ''}`);
      if (a.translation) md.push(`> _${en ? 'Translation' : 'Dịch'}:_ ${String(a.translation).replace(/\n+/g, ' ')}`);
      if (a.note) md.push(`> — ${a.note}`);
      md.push('');
    }
  }
  if (e.research_notes?.trim()) {
    md.push(`## ${L.legacy}`);
    md.push(e.research_notes.trim().replace(/^(#{1,4})(\s)/gm, (_, h, sp) => `${'#'.repeat(Math.min(6, h.length + 2))}${sp}`));
    md.push('');
  }
  if (paper.meta?.model) {
    md.push('---');
    md.push(`_${en ? 'Extracted with' : 'Trích xuất bằng'} ${paper.meta.provider}/${paper.meta.model} · ${fmtDate(paper.meta.extractedAt)}_`);
  }
  return md.join('\n');
}

/** Bảng so sánh: Tên paper | Điểm mới | Dataset/Metric | Ý tưởng áp dụng (+ cột tuỳ chọn). */
export function compareTableMarkdown(papers, { withBottleneck = false, withLimitation = false } = {}) {
  const head = ['Tên paper', 'Điểm mới', 'Dataset/Metric', 'Ý tưởng có thể áp dụng cho bài của mình'];
  if (withLimitation) head.push('Limitation');
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
    if (withLimitation) row.push(cell((e.limitation?.items || []).join('; ')));
    if (withBottleneck) row.splice(1, 0, cell(e.bottleneck));
    lines.push(`| ${row.join(' | ')} |`);
  }
  return lines.join('\n');
}

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

export function libraryToMarkdown(papers, topics) {
  const byTopic = groupByTopic(papers);
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

export function groupByTopic(papers) {
  const byTopic = new Map();
  for (const p of papers) {
    const key = p.topicId || '__none__';
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key).push(p);
  }
  return byTopic;
}

function safeName(name) {
  return String(name || 'untitled').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 80) || 'untitled';
}

/** Danh sách file { path, content } để máy chủ ghi ra thư mục xuất. */
export function buildLibraryFiles(papers, topics) {
  const files = [];
  const byTopic = groupByTopic(papers);
  const readmeRows = [];
  for (const [topicId, list] of byTopic) {
    const topic = topics.find((t) => t.id === topicId) || { name: 'Chưa phân loại', id: '__none__' };
    const folder = safeName(topic.name);
    const used = new Set();
    for (const p of list) {
      const base = slugify(p.title || p.id);
      let name = `${base}.md`;
      let n = 2;
      while (used.has(name)) name = `${base}-${n++}.md`;
      used.add(name);
      files.push({ path: `${folder}/${name}`, content: paperToMarkdown(p, topic) });
    }
    files.push({ path: `${folder}/_index.md`, content: topicIndexMarkdown(topic, list) });
    readmeRows.push(`- **${topic.name}** — ${list.length} paper ([mở](./${folder}/_index.md))`);
  }
  files.push({
    path: 'README.md',
    content: [
      '# PaperVault', '',
      `_Đồng bộ lúc ${fmtDate(new Date().toISOString())} · ${papers.length} paper · ${byTopic.size} chủ đề_`, '',
      '## Thư mục chủ đề', '', ...readmeRows, '',
      '> Thư mục này được PaperVault ghi đè mỗi lần đồng bộ. Muốn ghi chú lâu dài, sửa trong app rồi đồng bộ lại.',
    ].join('\n'),
  });
  files.push({ path: '_bang-so-sanh-tat-ca.md', content: ['# Bảng so sánh toàn bộ paper', '', compareTableMarkdown(papers, { withBottleneck: true })].join('\n') });
  files.push({ path: 'references.bib', content: bibtexAll(papers) });
  return files;
}

/* ------------------------- BibTeX ------------------------- */

const authorList = (e) => (Array.isArray(e.authors) ? e.authors : String(e.authors || '').split(/\s*(?:;|,|\band\b)\s*/)).map((a) => String(a || '').trim()).filter(Boolean);
const ascii = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

export function bibtexKey(paper) {
  const e = paper.extraction || {};
  const first = ascii(authorList(e)[0] || 'anon').split(/\s+/).pop().toLowerCase().replace(/[^a-z]/g, '') || 'anon';
  const word = (paper.title || '').toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length > 3 && !['with', 'from', 'that', 'this', 'using', 'towards', 'toward'].includes(w)) || 'paper';
  return `${first}${e.year || ''}${word}`;
}

/** Khoá BibTeX không trùng cho một nhóm paper (trùng thì thêm a, b, c… như Google Scholar). */
export function bibtexKeys(papers) {
  const seen = new Map();
  const out = new Map();
  for (const p of papers) {
    const base = bibtexKey(p);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    out.set(p.id, n ? `${base}${String.fromCharCode(97 + ((n - 1) % 26))}` : base);
  }
  return out;
}

/** Cả file .bib cho nhiều paper, khoá không trùng. */
export function bibtexAll(papers) {
  const keys = bibtexKeys(papers);
  return papers.map((p) => bibtexOf(p, keys.get(p.id))).join('\n\n');
}

export function bibtexOf(paper, key) {
  const e = paper.extraction || {};
  const esc = (s) => String(s || '').replace(/[{}\\]/g, '').replace(/([&%#_$])/g, '\\$1').replace(/\s+/g, ' ').trim();
  const isArxiv = !!paper.arxivId || /arxiv/i.test(e.venue || '');
  const type = isArxiv && !/(cvpr|iccv|eccv|neurips|nips|icml|iclr|acl|emnlp|naacl|aaai|ijcai|kdd|www|sigir|tpami|ieee|acm|springer|journal|transactions)/i.test(e.venue || '')
    ? 'misc' : (/journal|transactions|tpami|ieee access/i.test(e.venue || '') ? 'article' : 'inproceedings');
  const lines = [`@${type}{${typeof key === 'string' && key ? key : bibtexKey(paper)},`];
  lines.push(`  title = {${esc(paper.title)}},`);
  const authors = authorList(e);
  if (authors.length) lines.push(`  author = {${authors.map(esc).join(' and ')}},`);
  if (e.year) lines.push(`  year = {${esc(e.year)}},`);
  if (type === 'article') lines.push(`  journal = {${esc(e.venue)}},`);
  else if (type === 'inproceedings') lines.push(`  booktitle = {${esc(e.venue)}},`);
  if (paper.arxivId) {
    const id = paper.arxivId.replace(/v\d+$/, '');
    lines.push(`  eprint = {${id}},`);
    lines.push('  archivePrefix = {arXiv},');
    if (type === 'misc') lines.push(`  howpublished = {arXiv preprint arXiv:${id}},`);
  }
  if (paper.doi) lines.push(`  doi = {${String(paper.doi).replace(/[{}\s]/g, '')}},`);
  if (paper.url) lines.push(`  url = {${paper.url}},`);
  lines.push('}');
  return lines.join('\n');
}

/* ------------------------- Bản tổng hợp related work ------------------------- */

export function synthesisToMarkdown(s, papers) {
  const md = [`# Tổng hợp related work (${papers.length} paper)`, '', `_Tạo ngày ${fmtDate(new Date().toISOString())}_`, ''];
  md.push('## Tổng quan', '', s.overview || '', '');
  md.push('## Các hướng tiếp cận', '');
  for (const t of s.themes || []) {
    md.push(`### ${t.name}`, '', `_Paper:_ ${(t.papers || []).join('; ')}`, '', t.summary || '', '');
  }
  md.push('## So sánh theo khía cạnh', '', '| Khía cạnh | Nhận xét |', '| --- | --- |');
  for (const c of s.comparison || []) md.push(`| ${cell(c.aspect)} | ${cell(c.notes)} |`);
  md.push('', '## Khoảng trống nghiên cứu', '', bullets(s.gaps), '');
  md.push('## Vị trí của đề tài', '', s.positioning || '', '');
  md.push('## Bản nháp Related Work', '', s.related_work_draft || '', '');
  md.push('## Việc nên làm tiếp', '', bullets(s.next_steps), '');
  md.push('## Bảng so sánh', '', compareTableMarkdown(papers, { withBottleneck: true }));
  return md.join('\n');
}

/* ------------------------- LaTeX ------------------------- */

// Ký hiệu Unicode hay gặp trong ghi chú -> lệnh LaTeX, để pdflatex không báo lỗi "Unicode character not set up".
const LATEX_SYMBOLS = {
  '→': '$\\rightarrow$', '←': '$\\leftarrow$', '↔': '$\\leftrightarrow$', '⇒': '$\\Rightarrow$', '↑': '$\\uparrow$', '↓': '$\\downarrow$',
  '≥': '$\\geq$', '≤': '$\\leq$', '≠': '$\\neq$', '≈': '$\\approx$', '×': '$\\times$', '±': '$\\pm$', '∼': '$\\sim$', '·': '$\\cdot$', '•': '\\textbullet{}',
  '–': '--', '—': '---', '“': '``', '”': "''", '‘': '`', '’': "'", '…': '\\ldots{}', '°': '$^\\circ$',
  'α': '$\\alpha$', 'β': '$\\beta$', 'γ': '$\\gamma$', 'δ': '$\\delta$', 'ε': '$\\epsilon$', 'θ': '$\\theta$', 'λ': '$\\lambda$', 'μ': '$\\mu$',
  'σ': '$\\sigma$', 'τ': '$\\tau$', 'φ': '$\\phi$', 'ω': '$\\omega$', 'Δ': '$\\Delta$', '∑': '$\\sum$', '∞': '$\\infty$', '∈': '$\\in$',
};
const LATEX_SYMBOL_RE = new RegExp(`[${Object.keys(LATEX_SYMBOLS).join('')}]`, 'g');

export function latexEscape(s) {
  return String(s ?? '')
    .replace(/\\/g, '\u0000')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}')
    .replace(/\u0000/g, '\\textbackslash{}')
    .replace(LATEX_SYMBOL_RE, (c) => LATEX_SYMBOLS[c])
    .replace(/\s*\r?\n+\s*/g, ' ');
}

/** Bảng so sánh dạng LaTeX (tabularx, cần \usepackage{tabularx,booktabs}). Tên paper kèm \cite{key}. */
export function compareTableLatex(papers, { withBottleneck = false } = {}) {
  const cols = withBottleneck ? 'lXXXX' : 'lXXX';
  const head = ['Paper', ...(withBottleneck ? ['Bottleneck'] : []), 'Novelty', 'Dataset / Metric', 'Applicable ideas'];
  const rows = papers.map((p) => {
    const e = p.extraction || {};
    const ideas = (e.applicable_ideas || []).map((i) => i.idea).filter(Boolean).join('; ');
    const cells = [`${latexEscape((p.title || '').slice(0, 60))} \\cite{${bibtexKey(p)}}`, ...(withBottleneck ? [latexEscape(e.bottleneck)] : []), latexEscape(e.novelty), latexEscape(e.dataset_metric_note), latexEscape(ideas)];
    return `    ${cells.join(' & ')} \\\\`;
  });
  return [
    '\\begin{table*}[t]', '  \\centering', '  \\small',
    `  \\begin{tabularx}{\\textwidth}{${cols}}`, '    \\toprule',
    `    ${head.map((h) => `\\textbf{${h}}`).join(' & ')} \\\\`, '    \\midrule',
    ...rows, '    \\bottomrule', '  \\end{tabularx}',
    '  \\caption{Comparison of related work.}', '  \\label{tab:related-work}', '\\end{table*}',
  ].join('\n');
}

/** Bản tổng hợp related work -> file .tex hoàn chỉnh (section + bảng), trích dẫn theo key BibTeX. */
export function synthesisToLatex(s, papers) {
  const keyByTitle = new Map(papers.map((p) => [String(p.title || '').toLowerCase(), bibtexKey(p)]));
  const cite = (text) => String(text || '').replace(/\[([^\]]{4,120})\]/g, (m, name) => {
    const n = name.toLowerCase();
    for (const [t, k] of keyByTitle) if (t.includes(n) || n.includes(t.slice(0, 30))) return `\\cite{${k}}`;
    return m;
  });
  const para = (t) => cite(latexEscape(t)).replace(/\\textbackslash\{\}cite\\{([^}]*)\\}/g, '\\cite{$1}');
  const out = ['% Sinh bởi PaperVault — cần \\usepackage{tabularx,booktabs}; thư viện: references.bib', '\\section{Related Work}', ''];
  out.push(para(s.overview), '');
  for (const t of s.themes || []) out.push(`\\paragraph{${latexEscape(t.name)}}`, para(t.summary), '');
  out.push(...String(s.related_work_draft || '').split(/\n{2,}/).map((p) => para(p) + '\n'));
  out.push('\\paragraph{Research gaps}', '\\begin{itemize}', ...(s.gaps || []).map((g) => `  \\item ${para(g)}`), '\\end{itemize}', '');
  out.push(compareTableLatex(papers, { withBottleneck: true }));
  return out.join('\n');
}

/* ------------------------- Word: HTML trung gian, docx.js chuyển sang .docx ------------------------- */

const escH = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function compareTableWordHtml(papers, { withBottleneck = false } = {}) {
  const head = ['Tên paper', ...(withBottleneck ? ['Bottleneck'] : []), 'Điểm mới', 'Dataset/Metric', 'Ý tưởng áp dụng'];
  const rows = papers.map((p) => {
    const e = p.extraction || {};
    const ideas = (e.applicable_ideas || []).map((i) => i.idea).filter(Boolean).join('; ');
    const cells = [`<b>${escH(p.title)}</b>${e.year ? ` (${escH(e.year)})` : ''}`, ...(withBottleneck ? [escH(e.bottleneck)] : []), escH(e.novelty), escH(e.dataset_metric_note), escH(ideas)];
    return `<tr>${cells.map((c) => `<td valign="top">${c}</td>`).join('')}</tr>`;
  });
  return `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:10pt"><thead><tr>${head.map((h) => `<th style="background:#eee">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

/** Tài liệu Word dạng HTML (đưa vào htmlToDocx để ra .docx). landscape: trang ngang cho bảng nhiều cột. */
export function wordDocument(title, bodyHtml, { landscape = false } = {}) {
  const page = landscape
    ? '@page WordSection1{size:841.9pt 595.3pt;mso-page-orientation:landscape;margin:54pt 48pt}'
    : '@page WordSection1{size:595.3pt 841.9pt;margin:60pt 60pt}';
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><meta name="ProgId" content="Word.Document"><title>${escH(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${page} div.WordSection1{page:WordSection1} body{font-family:Calibri,Arial;font-size:11pt;line-height:1.4} h1{font-size:16pt} h2{font-size:13pt;margin-top:14pt} blockquote{border-left:3px solid #999;margin:6pt 0;padding-left:8pt;color:#444} table{width:100%} td,th{vertical-align:top} th{text-align:left}</style></head><body><div class="WordSection1">${bodyHtml}</div></body></html>`;
}

export function synthesisToWordHtml(s, papers) {
  const p = (t) => `<p>${escH(t)}</p>`;
  const list = (items) => `<ul>${(items || []).map((i) => `<li>${escH(i)}</li>`).join('')}</ul>`;
  const body = [
    `<h1>Tổng hợp related work (${papers.length} paper)</h1>`,
    '<h2>Tổng quan</h2>', p(s.overview),
    '<h2>Các hướng tiếp cận</h2>', ...(s.themes || []).map((t) => `<p><b>${escH(t.name)}</b> <i>(${escH((t.papers || []).join('; '))})</i><br>${escH(t.summary)}</p>`),
    '<h2>So sánh theo khía cạnh</h2>', `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse"><tr><th>Khía cạnh</th><th>Nhận xét</th></tr>${(s.comparison || []).map((c) => `<tr><td><b>${escH(c.aspect)}</b></td><td>${escH(c.notes)}</td></tr>`).join('')}</table>`,
    '<h2>Khoảng trống nghiên cứu</h2>', list(s.gaps),
    '<h2>Vị trí của đề tài</h2>', `<blockquote>${escH(s.positioning)}</blockquote>`,
    '<h2>Bản nháp Related Work</h2>', ...String(s.related_work_draft || '').split(/\n{2,}/).map(p),
    '<h2>Việc nên làm tiếp</h2>', list(s.next_steps),
    '<h2>Bảng so sánh</h2>', compareTableWordHtml(papers, { withBottleneck: true }),
  ].join('\n');
  return wordDocument('Related work', body);
}
