// Ngữ cảnh mở rộng cho Chat với paper: kết quả các công cụ khác đã chạy cho từng paper trong hội thoại.
// Phần cố định (cache được với Claude): Hướng nghiên cứu, mạng trích dẫn, "Có gì mới", câu tô trong PDF, trang Sổ tay.
// Phần theo câu hỏi (tìm đoạn khớp như toàn văn): Bài giảng và các lượt Hỏi đáp trước đó.
// Mạng trích dẫn ưu tiên các bài đã được Hướng nghiên cứu phân tích (quan hệ, phương pháp, khác biệt), bổ sung số liệu của
// đồ thị trích dẫn (độ tương đồng, số bài trong mạng dẫn tới, hạng venue) và bài gần nhất theo đồ thị chưa được phân tích.
// Bài liên quan có cùng tên / arXiv / DOI trong thư viện được ghi rõ để người dùng đưa vào hội thoại.
import { api } from './api.js';
import { store } from './store.js';
import { plainTitle } from './richtext.js';
import { s2Ident, citeRole, fmtPub } from './s2util.js';
import { loadPages, pagesForPaper } from './notebook.js';
import { researchMapMarkdown } from './research.js';
import { whatsNewMarkdown } from './whatsnew.js';
import { lectureMarkdown } from './lecture.js';
import { KINDS as MARK_KINDS } from './autohighlight.js';

/** [khoá, nhãn, giải thích] của từng loại dữ liệu kèm theo (bật / tắt ở bảng Nguồn). */
export const CTX_KINDS = [
  ['network', 'Mạng trích dẫn', 'Bài nền và bài phát triển tiếp: ưu tiên bài đã phân tích ở Hướng nghiên cứu, kèm số liệu đồ thị trích dẫn'],
  ['research', 'Hướng nghiên cứu', 'Tổng quan dòng nghiên cứu, khoảng trống còn mở, hướng đi tiếp'],
  ['whatsnew', 'Có gì mới', 'Giới hạn đã được giải quyết, kết quả mới, phản biện từ các bài dẫn'],
  ['marks', 'Câu tô trong PDF', 'Câu AI tô (kèm loại và lý do) và câu bạn tô'],
  ['notebook', 'Sổ tay', 'Các trang Sổ tay nhắc tới paper'],
  ['lecture', 'Bài giảng', 'Chỉ lấy đoạn khớp câu hỏi'],
  ['qa', 'Hỏi đáp trước đó', 'Các lượt hỏi đáp ở tab Hỏi đáp, chỉ lấy lượt khớp câu hỏi'],
];
export const ctxOf = (c) => Object.fromEntries(CTX_KINDS.map(([k]) => [k, c?.ctx?.[k] !== false]));

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clamp = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…(đã rút gọn)` : s);
const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(n || 0));

/* ---------- dữ liệu cần tải trước (đồ thị trích dẫn đã dựng, danh sách bài dẫn / được dẫn, trang Sổ tay) ---------- */

const graphs = new Map(); // id paper -> { g: đồ thị đã lưu đệm | null, at }
const edges = new Map();  // id paper -> { refs, cits } từ Semantic Scholar (khi chưa có Hướng nghiên cứu lẫn đồ thị)

/** Tải dữ liệu cho các paper trong hội thoại. Không gọi model; đồ thị chỉ dùng bản đã dựng (mở đồ thị 3D / bản đồ tài liệu). */
export async function ensureContext(c, papers) {
  const ctx = ctxOf(c);
  const jobs = [];
  if (ctx.notebook) jobs.push(loadPages().catch(() => null));
  if (ctx.network) {
    for (const p of papers) {
      const ident = s2Ident(p);
      if (!ident) continue;
      // Chưa có đồ thị thì một phút sau hỏi lại (người dùng có thể vừa mở đồ thị 3D / bản đồ tài liệu của paper).
      const had = graphs.get(p.id);
      if (!had || (!had.g && Date.now() - had.at > 60e3)) jobs.push(api.s2Graph(ident, { cacheOnly: true }).then((g) => graphs.set(p.id, { g: g || null, at: Date.now() }), () => graphs.set(p.id, { g: null, at: Date.now() })));
      if (!p.researchMap?.papers?.length && !edges.has(p.id)) {
        jobs.push(Promise.all([api.s2References(ident).catch(() => ({ items: [] })), api.s2Citations(ident).catch(() => ({ items: [] }))])
          .then(([r, ci]) => edges.set(p.id, { refs: r.items || [], cits: ci.items || [] })));
      }
    }
  }
  await Promise.all(jobs);
}
/** Quên dữ liệu đã tải (người dùng vừa dựng lại Hướng nghiên cứu / đồ thị). */
export function resetContext() { graphs.clear(); edges.clear(); }

/* ---------- khớp bài liên quan với thư viện ---------- */

let libIndex = null;
let libStamp = '';
function libFind(x) {
  const stamp = `${store.papers.length}:${store.papers[0]?.updatedAt || ''}`;
  if (!libIndex || libStamp !== stamp) {
    libIndex = { arxiv: new Map(), doi: new Map(), s2: new Map(), title: new Map() };
    for (const p of store.papers) {
      if (p.deletedAt) continue;
      if (p.arxivId) libIndex.arxiv.set(p.arxivId.replace(/v\d+$/, '').toLowerCase(), p);
      if (p.doi) libIndex.doi.set(p.doi.toLowerCase(), p);
      if (p.s2Id) libIndex.s2.set(p.s2Id, p);
      const t = plainTitle(p.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (t) libIndex.title.set(t, p);
    }
    libStamp = stamp;
  }
  const arxiv = String(x.arxiv || x.externalIds?.ArXiv || '').replace(/v\d+$/, '').toLowerCase();
  const doi = String(x.doi || x.externalIds?.DOI || '').toLowerCase();
  const t = plainTitle(x.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return (arxiv && libIndex.arxiv.get(arxiv)) || (doi && libIndex.doi.get(doi)) || (x.paperId && libIndex.s2.get(x.paperId)) || (t && libIndex.title.get(t)) || null;
}

/* ---------- mạng trích dẫn ---------- */

const REL_TEXT = { foundation: 'nền tảng', tool: 'công cụ / dataset', baseline: 'baseline', extends: 'mở rộng', applies: 'áp dụng', competes: 'cạnh tranh', critiques: 'phản biện', related: 'liên quan' };
const REL_RANK = { extends: 0, foundation: 1, critiques: 2, competes: 3, baseline: 4, applies: 5, related: 6, tool: 7 };

/** Các bài trong mạng trích dẫn của paper p, xếp theo mức đáng đọc: [{ code, title, meta, rel, detail, lib, link }]. */
export function networkOf(p, { max = 25 } = {}) {
  const g = graphs.get(p.id)?.g;
  const gNodes = new Map((g?.nodes || []).map((n) => [n.id, n]));
  const graphMeta = (n) => (n ? [n.simSeed ? `tương đồng ${Number(n.simSeed).toFixed(2)}` : '', n.inG ? `${n.inG} bài trong mạng dẫn tới` : '', n.rank ? `hạng ${n.rank}` : ''].filter(Boolean) : []);
  const out = [];
  const used = new Set();
  const map = p.researchMap;
  if (map?.papers?.length) {
    const rows = new Map((map.data?.comparison || []).map((r) => [r.paper, r]));
    const list = map.papers.map((x) => ({ x, r: rows.get(x.id) || {} }))
      .sort((a, b) => (!!b.x.pinned - !!a.x.pinned) || ((REL_RANK[a.r.relation] ?? 6) - (REL_RANK[b.r.relation] ?? 6)) || (!!b.x.influential - !!a.x.influential)
        || ((gNodes.get(b.x.paperId)?.simSeed || 0) - (gNodes.get(a.x.paperId)?.simSeed || 0)) || ((b.x.citations || 0) - (a.x.citations || 0)));
    for (const { x, r } of list.slice(0, max)) {
      const n = gNodes.get(x.paperId);
      if (x.paperId) used.add(x.paperId);
      out.push({
        code: x.id, title: x.title, rel: REL_TEXT[r.relation] || x.roleText || '',
        meta: [x.date, x.venue, x.citations ? `${fmtK(x.citations)} trích dẫn` : '', x.influential ? 'ảnh hưởng lớn' : '', x.pinned ? 'bạn chọn thêm' : '', ...graphMeta(n)].filter(Boolean),
        detail: [r.method && !/^chưa rõ$/i.test(r.method) ? `phương pháp: ${one(r.method)}` : '', r.difference ? `khác: ${one(r.difference)}` : '', !r.method && !r.difference && x.tldr ? one(x.tldr) : ''].filter(Boolean).join('; '),
        lib: libFind(x), link: x.arxiv ? `https://arxiv.org/abs/${x.arxiv}` : (x.doi ? `https://doi.org/${x.doi}` : x.url || ''), analyzed: true,
        raw: { ...x, relation: x.relation === 'pin' ? '' : x.relation },
      });
    }
  }
  // Bài gần nhất theo đồ thị (Connected Papers) mà Hướng nghiên cứu chưa phân tích, hoặc toàn bộ khi chưa có Hướng nghiên cứu.
  const room = Math.max(map?.papers?.length ? 8 : max, 0);
  if (g?.nodes?.length && room) {
    const extra = g.nodes.filter((n) => !used.has(n.id) && n.kind !== 'hop2')
      .sort((a, b) => (b.simSeed || 0) - (a.simSeed || 0) || (!!b.influential - !!a.influential) || (b.citations || 0) - (a.citations || 0)).slice(0, room);
    extra.forEach((n, i) => out.push({
      code: `N${i + 1}`, title: n.title, rel: n.kind === 'ref' ? 'paper này dẫn' : n.kind === 'cit' ? 'dẫn paper này' : 'dẫn qua lại',
      meta: [n.year, n.venue, n.citations ? `${fmtK(n.citations)} trích dẫn` : '', n.influential ? 'ảnh hưởng lớn' : '', ...graphMeta(n)].filter(Boolean),
      detail: one(n.tldr || n.abstract || '').slice(0, 260), lib: libFind(n), link: n.arxiv ? `https://arxiv.org/abs/${n.arxiv}` : (n.doi ? `https://doi.org/${n.doi}` : n.url || ''),
      raw: {
        paperId: n.id, title: n.title, authors: n.authors || '', date: n.date || (n.year ? String(n.year) : ''), venue: n.venue || '', citations: n.citations || 0,
        contexts: n.contexts || [], tldr: n.tldr || '', abstract: n.abstract || '', arxiv: n.arxiv || '', doi: n.doi || '', url: n.url || '',
        relation: n.kind === 'ref' || n.kind === 'cit' ? n.kind : '', role: citeRole({ _intents: n.intents, _contexts: n.contexts }).role,
        roleText: n.simSeed ? `Gần theo đồ thị (tương đồng ${Number(n.simSeed).toFixed(2)})` : 'Gần theo đồ thị trích dẫn', influential: !!n.influential,
      },
    }));
  } else if (!map?.papers?.length) {
    // Chưa dựng Hướng nghiên cứu lẫn đồ thị: lấy thẳng bài dẫn / được dẫn, ưu tiên bài ảnh hưởng lớn và nhiều trích dẫn.
    const e = edges.get(p.id) || { refs: [], cits: [] };
    const top = (arr) => [...arr].sort((a, b) => (!!b._influential - !!a._influential) || (b.citationCount || 0) - (a.citationCount || 0)).slice(0, Math.ceil(max / 2));
    const add = (it, code, rel) => out.push({
      code, title: it.title, rel, meta: [it.year, it.venue, it.citationCount ? `${fmtK(it.citationCount)} trích dẫn` : '', it._influential ? 'ảnh hưởng lớn' : ''].filter(Boolean),
      detail: one(it.tldr || it.abstract || '').slice(0, 260), lib: libFind(it),
      link: it.externalIds?.ArXiv ? `https://arxiv.org/abs/${it.externalIds.ArXiv}` : (it.externalIds?.DOI ? `https://doi.org/${it.externalIds.DOI}` : it.url || ''),
      raw: {
        paperId: it.paperId || '', title: it.title, authors: (it.authors || []).slice(0, 4).map((a) => a.name).join(', '), date: fmtPub(it), venue: it.venue || '',
        citations: it.citationCount ?? null, contexts: (it._contexts || []).slice(0, 2), tldr: it.tldr || '', abstract: (it.abstract || '').slice(0, 400),
        arxiv: it.externalIds?.ArXiv || '', doi: it.externalIds?.DOI || '', url: it.url || '', relation: code[0] === 'R' ? 'ref' : 'cit', role: citeRole(it).role, influential: !!it._influential,
      },
    });
    top(e.refs).forEach((it, i) => add(it, `R${i + 1}`, 'paper này dẫn'));
    top(e.cits).forEach((it, i) => add(it, `C${i + 1}`, 'dẫn paper này'));
  }
  return out;
}

/* ---------- phần cố định của từng paper ---------- */

/** Đổi mã bài trong kết quả Hướng nghiên cứu / Có gì mới (R3, C5, S1, P) sang mã theo paper trong hội thoại (P1.R3…).
   G1… (khoảng trống) giữ nguyên. */
const recode = (s, label) => String(s || '')
  .replace(/\[(?:P|bài gốc)\]/g, `[${label}]`)
  .replace(/\[?\b([RCSN]\d{1,3})\b\]?/g, `[${label}.$1]`);

/** Văn bản bổ sung cho một paper (đặt trong khối <paper> của ngữ cảnh). scale < 1 khi hội thoại có nhiều paper. */
export function extraBlock(p, label, ctx, scale = 1) {
  const parts = [];
  const lim = (n) => Math.max(600, Math.round(n * scale));
  if (ctx.research && p.researchMap?.data) {
    const d = p.researchMap.data;
    const lines = [
      d.overview ? `Tổng quan: ${one(d.overview)}` : '',
      d.lineage?.foundations ? `Nền tảng: ${one(d.lineage.foundations)}` : '',
      d.lineage?.developments ? `Phát triển sau: ${one(d.lineage.developments)}` : '',
      ...(d.coverage || []).slice(0, 10).map((x) => `- Khía cạnh "${one(x.aspect)}": paper này ${x.main === 'yes' ? 'đã cover' : x.main === 'partial' ? 'cover một phần' : 'chưa cover'}${(x.papers || []).length ? `; bài khác đã cover: ${x.papers.map((c) => `[${c}]`).join('')}` : ''}${x.note ? `. ${one(x.note)}` : ''}`),
      ...(d.gaps || []).map((x, i) => `- Khoảng trống G${i + 1} (${x.status === 'open' ? 'còn bỏ ngỏ' : 'một phần'}): ${one(x.gap)}${(x.papers || []).length ? ` ${x.papers.map((c) => `[${c}]`).join('')}` : ''}${x.evidence ? `. Căn cứ: ${one(x.evidence)}` : ''}`),
      ...(d.directions || []).map((x, i) => `- Hướng ${i + 1}: ${one(x.title)}. ${one(x.idea)}${x.gap ? ` Giải quyết: ${one(x.gap)}.` : ''}${(x.builds_on || []).length ? ` Dựa trên ${x.builds_on.map((c) => `[${c}]`).join('')}.` : ''}${x.first_step ? ` Bước đầu: ${one(x.first_step)}.` : ''}${x.risk ? ` Rủi ro: ${one(x.risk)}.` : ''}${x.fit ? ` Với đề tài người dùng: ${one(x.fit)}.` : ''}`),
    ].filter(Boolean).map((s) => recode(s, label));
    if (lines.length) parts.push(`<research_directions paper="${label}" built="${(p.researchMap.at || '').slice(0, 10)}">\n${clamp(lines.join('\n'), lim(5000))}\n</research_directions>`);
  }
  if (ctx.network) {
    const net = networkOf(p, { max: Math.max(8, Math.round(25 * scale)) });
    if (net.length) {
      const lines = net.map((x) => {
        const lib = x.lib ? (x.lib.id === p.id ? '' : ` · có trong thư viện: "${one(plainTitle(x.lib.title)).slice(0, 80)}"`) : '';
        return `[${label}.${x.code}] ${one(x.title)} (${x.meta.join(' · ')})${x.rel ? ` · quan hệ: ${x.rel}` : ''}${lib}${x.detail ? `\n  ${x.detail}` : ''}`;
      });
      const head = p.researchMap?.papers?.length ? 'Bài trong mạng trích dẫn, ưu tiên bài đã phân tích ở Hướng nghiên cứu (R: paper này dẫn, C: dẫn paper này, S: người dùng chọn thêm, N: gần nhất theo đồ thị trích dẫn, chưa phân tích)'
        : 'Bài trong mạng trích dẫn (R: paper này dẫn, C: dẫn paper này, N: gần nhất theo đồ thị trích dẫn); chưa phân tích quan hệ chi tiết';
      parts.push(`<citation_network paper="${label}">\n${head}:\n${clamp(lines.join('\n'), lim(6000))}\n</citation_network>`);
    }
  }
  if (ctx.whatsnew && p.whatsNew?.data) {
    const md = whatsNewMarkdown(p, p.whatsNew).split('\n## Danh sách bài')[0];
    // "Có gì mới" đánh số C1, C2… riêng, trùng với C của Hướng nghiên cứu nhưng là bài khác: đổi sang W1, W2…
    const wmd = md.replace(/\[?\b(?:C(\d{1,3}))\b\]?/g, `[${label}.W$1]`).replace(/\[(?:P|bài gốc)\]/g, `[${label}]`);
    parts.push(`<whats_new paper="${label}">\n${clamp(wmd, lim(3500))}\n</whats_new>`);
  }
  if (ctx.marks && (p.pdfMarks || []).length) {
    const marks = (p.pdfMarks || []).filter((m) => (m.text || '').trim()).sort((a, b) => (b.auto ? 0 : 1) - (a.auto ? 0 : 1) || (a.page || 0) - (b.page || 0));
    const lines = marks.slice(0, Math.round(30 * Math.max(scale, 0.5))).map((m) => `- [${m.auto ? (MARK_KINDS[m.kind]?.label || 'AI tô') : 'người dùng tô'}${m.page ? `, tr. ${m.page}` : ''}] "${one(m.text).slice(0, 300)}"${m.why ? ` (vì: ${one(m.why)})` : ''}${m.note ? ` (ghi chú: ${one(m.note)})` : ''}`);
    if (lines.length) parts.push(`<pdf_highlights paper="${label}">\n${clamp(lines.join('\n'), lim(3000))}\n</pdf_highlights>`);
  }
  if (ctx.notebook) {
    const pages = pagesForPaper(p.id).slice(0, 6);
    if (pages.length) parts.push(`<notebook paper="${label}">\nTrang Sổ tay của người dùng nhắc tới paper này:\n${clamp(pages.map(({ page, snippet }) => `- "${one(page.title)}": ${one(snippet).replace(new RegExp(`\\[\\[@${p.id}[^\\]]*\\]\\]`, 'g'), `[${label}]`)}`).join('\n'), lim(2500))}\n</notebook>`);
  }
  return parts.join('\n');
}

/** Ghi chú cho mô hình về các mã bài liên quan (đặt một lần ở đầu ngữ cảnh). */
export const CTX_GUIDE = 'Ngoài ghi chú, mỗi paper có thể kèm kết quả các công cụ người dùng đã chạy: hướng nghiên cứu (research_directions), mạng trích dẫn (citation_network), "có gì mới" từ các bài dẫn (whats_new), câu tô trong PDF (pdf_highlights), trang Sổ tay (notebook). Bài liên quan có mã dạng [P1.R3], [P1.C2], [P1.N1], [P1.W4] (W: bài dẫn paper trong whats_new, đánh số riêng, khác C): khi nhắc tới bài đó, ghi đúng mã này. G1, G2… trong research_directions là mã khoảng trống, không phải bài. Khi gợi ý bài nên đọc thêm, ưu tiên bài ghi "có trong thư viện".';

/* ---------- phần theo câu hỏi ---------- */

/** Các đoạn Bài giảng và Hỏi đáp trước của paper, để tìm theo câu hỏi: [{ src, text }]. */
export function retrievalDocs(p, ctx) {
  const out = [];
  if (ctx.lecture && p.lecture?.sections) {
    try {
      const md = lectureMarkdown(p, p.lecture);
      md.split(/\n(?=#{1,3} )/).forEach((sec) => { if (sec.trim().length > 40) out.push({ src: 'bài giảng', text: sec.trim().slice(0, 2400) }); });
    } catch (_) { /* bài giảng dạng cũ */ }
  }
  if (ctx.qa) for (const x of p.qa || []) if (x?.q && x?.a) out.push({ src: 'hỏi đáp trước', text: `Hỏi: ${one(x.q)}\nĐáp: ${String(x.a).trim().slice(0, 2000)}` });
  return out;
}

/** Bài liên quan có trong thư viện nhưng chưa ở trong hội thoại: [{ p, via, rel }] (gợi ý thêm ở bảng Nguồn). */
/** Bài dẫn paper trong "Có gì mới" (mã W1, W2…), cùng dạng với networkOf. */
function whatsNewOf(p) {
  return (p.whatsNew?.papers || []).map((x) => ({
    code: `W${String(x.id || '').replace(/^\D+/, '')}`, title: x.title, rel: 'dẫn paper này (Có gì mới)',
    meta: [x.date, x.venue, x.citations ? `${fmtK(x.citations)} trích dẫn` : '', x.influential ? 'ảnh hưởng lớn' : ''].filter(Boolean),
    detail: one(x.tldr || x.abstract || '').slice(0, 260), lib: libFind(x),
    link: x.arxiv ? `https://arxiv.org/abs/${x.arxiv}` : (x.doi ? `https://doi.org/${x.doi}` : x.url || ''),
    raw: { ...x, relation: 'cit' },
  }));
}
/** Mọi bài liên quan của paper: mạng trích dẫn và bài của "Có gì mới". */
const relatedOf = (p, max) => [...networkOf(p, { max }), ...whatsNewOf(p)];

export function librarySuggestions(c, papers) {
  const inChat = new Set(c.paperIds);
  const seen = new Map();
  papers.forEach(({ p, label }) => {
    for (const x of relatedOf(p, 40)) {
      if (!x.lib || inChat.has(x.lib.id) || seen.has(x.lib.id)) continue;
      seen.set(x.lib.id, { p: x.lib, via: `${label}.${x.code}`, rel: x.rel });
    }
  });
  return [...seen.values()].slice(0, 12);
}

/**
 * Mọi bài liên quan của các paper trong hội thoại, theo đúng dạng thẻ chi tiết của Hướng nghiên cứu / Có gì mới
 * (bindWhatsNewChips), mã là P1.C3… để bấm vào mã trong câu trả lời mở thẻ.
 */
export function relatedEntries(papers) {
  return papers.flatMap(({ p, label }) => relatedOf(p, 200).filter((x) => x.raw).map((x) => ({ ...x.raw, id: `${label}.${x.code}`, mainId: p.id })));
}

/** Thông tin một mã bài liên quan (P1.R3) để hiện thẻ trong câu trả lời. */
export function relatedByCode(papers, code) {
  const [label, k] = String(code).split('.');
  const hit = papers.find((x) => x.label === label);
  return hit ? relatedOf(hit.p, 200).find((x) => x.code === k) || null : null;
}
