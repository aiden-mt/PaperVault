// "Hướng nghiên cứu": đặt bài gốc giữa các bài nó dẫn (R1, R2…), các bài dẫn nó (C1, C2…) và các bài người dùng tự chọn
// thêm (S1, S2…), so sánh khác biệt, cho biết các bài cover nhau ở khía cạnh nào (phương pháp, bài toán, domain, dữ liệu,
// đánh giá…), chỉ ra phần còn bỏ ngỏ và gợi ý hướng nghiên cứu tiếp. Một lượt gọi mô hình với tóm tắt + câu trích dẫn;
// kết quả lưu trong paper.researchMap, bài tự chọn lưu trong paper.researchPins.
import { api } from './api.js';
import { store, savePaper, paperById } from './store.js';
import { complete } from './llm.js';
import { parseLooseJson, escapeHtml, uid } from './util.js';
import { toast } from './ui.js';
import { titleHtml, plainTitle } from './richtext.js';
import { normalizeExtraction, splitLimitations } from './schema.js';
import { s2Ident, pubTime, fmtPub, citeRole, ROLE_LABELS } from './s2util.js';

export const PER_KIND_DEFAULT = 12;
export const PER_KIND_OPTIONS = [8, 12, 20, 30, 50, 100, 'all'];
export const MAIN_CAP = 30;      // số bài tiêu biểu đưa vào lượt phân tích chính (tổng quan, cover, khoảng trống, hướng đi)
export const BATCH_SIZE = 25;    // số bài mỗi lượt so sánh thêm
const ALL_LIMIT = 1000;          // "Toàn bộ": số bài tối đa lấy từ Semantic Scholar mỗi loại
/** Số bài mỗi loại từ lựa chọn ('all' = toàn bộ). */
export const perKindValue = (v) => (v === 'all' || v === Infinity ? Infinity : (PER_KIND_OPTIONS.includes(Number(v)) ? Number(v) : PER_KIND_DEFAULT));
export const MAX_REFS = PER_KIND_DEFAULT; // giữ tên cũ cho chỗ đang dùng
export const MAX_CITS = PER_KIND_DEFAULT;

/* ---------- Bài người dùng chọn thêm để so sánh (ghim) ---------- */

/** Chuyển bài từ nhiều nguồn (bài Semantic Scholar, thẻ C1…, nút đồ thị 3D) về một dạng giống bài Semantic Scholar. */
function asS2(o) {
  if (!o) return null;
  if (o.externalIds || o.publicationDate !== undefined || Array.isArray(o.authors)) {
    return {
      paperId: o.paperId || '', title: o.title || '', externalIds: { ArXiv: o.externalIds?.ArXiv || '', DOI: o.externalIds?.DOI || '' }, url: o.url || '',
      authors: (o.authors || []).slice(0, 6).map((a) => ({ name: a.name || String(a) })), year: o.year || '', publicationDate: o.publicationDate || '',
      venue: o.venue || '', citationCount: o.citationCount ?? null, tldr: o.tldr || '', abstract: (o.abstract || '').slice(0, 600),
      _contexts: (o._contexts || []).slice(0, 3), _intents: o._intents || [], _influential: !!o._influential,
    };
  }
  // Dạng rút gọn (thẻ C1… của "Có gì mới", nút trong đồ thị 3D).
  return {
    paperId: o.paperId || (/^[0-9a-f]{40}$/.test(o.id || '') ? o.id : ''), title: o.title || '',
    externalIds: { ArXiv: o.arxiv || '', DOI: o.doi || '' }, url: o.url || '',
    authors: String(o.authors || '').split(',').map((s) => s.trim()).filter(Boolean).map((name) => ({ name })),
    year: o.year || (String(o.date || '').match(/\d{4}/) || [''])[0], publicationDate: '', venue: o.venue || '',
    citationCount: o.citations ?? null, tldr: o.tldr || '', abstract: (o.abstract || '').slice(0, 600),
    _contexts: (o.contexts || []).slice(0, 3), _intents: [], _influential: !!o.influential,
  };
}

export const pinKey = (o) => {
  const it = asS2(o) || {};
  const ext = it.externalIds || {};
  return it.paperId || (ext.ArXiv ? `arxiv:${ext.ArXiv.replace(/v\d+$/, '')}` : '') || (ext.DOI ? `doi:${ext.DOI.toLowerCase()}` : '') || `t:${plainTitle(it.title).toLowerCase()}`;
};

export const isPinned = (paper, o) => !!(paper?.researchPins || []).some((x) => x.key === pinKey(o));

const SOURCE_LABEL = { ref: 'bài gốc dẫn', cit: 'dẫn bài gốc', rec: 'gợi ý', other: 'bài khác' };

/** Ghim / bỏ ghim một bài để so sánh với bài gốc trong tab Hướng nghiên cứu. Trả về true nếu sau thao tác bài đang được ghim. */
export async function togglePin(paperId, o, relation = 'other') {
  const p = paperById(paperId);
  if (!p) return false;
  const key = pinKey(o);
  const pins = p.researchPins || [];
  if (pins.some((x) => x.key === key)) {
    await savePaper({ ...p, researchPins: pins.filter((x) => x.key !== key) });
    toast('Đã bỏ bài này khỏi danh sách so sánh.');
    return false;
  }
  const it = asS2(o);
  await savePaper({ ...p, researchPins: [...pins, { key, relation: SOURCE_LABEL[relation] ? relation : 'other', at: new Date().toISOString(), it }] });
  toast(`Đã thêm “${plainTitle(it.title).slice(0, 60)}” để so sánh với bài gốc. Bấm Cập nhật ở tab Hướng nghiên cứu để đưa vào bản đồ.`, 6000, 'ok', {
    label: 'Mở Hướng nghiên cứu', onClick: () => { location.hash = `#/paper/${paperId}?tab=research`; },
  });
  return true;
}

export async function removePin(paperId, key) {
  const p = paperById(paperId);
  if (p) await savePaper({ ...p, researchPins: (p.researchPins || []).filter((x) => x.key !== key) });
}

/* ---------- Chọn bài ---------- */

/** Chọn bài đáng đưa cho mô hình: bài kế thừa / so sánh và bài ảnh hưởng lớn trước; cần có tóm tắt hoặc câu trích dẫn. */
function pick(items, n, newerFirst, skip) {
  const w = { method: 3, result: 3, mention: 1, unknown: 0 };
  return (items || [])
    .filter((it) => !skip.has(pinKey(it)))
    .map((it) => ({ it, role: citeRole(it) }))
    .filter((x) => x.it.title && (x.it.tldr || x.it.abstract || x.it._contexts?.length))
    .sort((a, b) => (w[b.role.role] + (b.it._influential ? 2 : 0) + (b.it._contexts?.length ? 1 : 0))
      - (w[a.role.role] + (a.it._influential ? 2 : 0) + (a.it._contexts?.length ? 1 : 0))
      || (newerFirst ? pubTime(b.it) - pubTime(a.it) : (b.it.citationCount || 0) - (a.it.citationCount || 0)))
    .slice(0, Math.max(0, n));
}

const DIMS = ['method', 'problem', 'domain', 'data', 'evaluation', 'efficiency', 'robustness', 'theory', 'other'];
const ids = { type: 'array', items: { type: 'string' }, description: 'Mã bài, ví dụ ["R2", "C5", "S1"]. Dùng "P" cho bài gốc.' };
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['overview', 'lineage', 'comparison', 'coverage', 'gaps', 'directions'],
  properties: {
    overview: { type: 'string', description: '3-5 câu: bài gốc đứng ở đâu trong dòng nghiên cứu này, kế thừa nền tảng nào (R…) và được phát triển tiếp ra sao (C…).' },
    lineage: {
      type: 'object', additionalProperties: false, required: ['foundations', 'developments'],
      properties: {
        foundations: { type: 'string', description: '1-3 câu: các bài nền (R…) đóng góp gì cho bài gốc. Ghi mã bài.' },
        developments: { type: 'string', description: '1-3 câu: các bài sau (C…) đẩy hướng này đi đâu. Ghi mã bài.' },
      },
    },
    comparison: {
      type: 'array', description: 'BẮT BUỘC đủ: bài gốc P và MỌI mã R, C, S trong danh sách, mỗi bài đúng một dòng. Thiếu thông tin thì ghi "chưa rõ" chứ không bỏ bài.',
      items: {
        type: 'object', additionalProperties: false, required: ['paper', 'relation', 'method', 'problem', 'domain', 'data', 'difference'],
        properties: {
          paper: { type: 'string', description: 'Mã bài: P, R1, C3, S2…' },
          relation: {
            type: 'string', enum: ['main', 'foundation', 'tool', 'baseline', 'extends', 'applies', 'competes', 'critiques', 'related'],
            description: 'Quan hệ với bài gốc. main: chỉ dùng cho P. foundation: bài gốc kế thừa phương pháp / mô hình / ý tưởng của bài này. tool: bài gốc chỉ dùng bài này như công cụ, thư viện, dataset, optimizer, cách đánh giá (PyTorch, COCO, Adam, t-SNE…). baseline: bài gốc so kết quả với bài này. extends: bài sau mở rộng phương pháp của bài gốc. applies: bài sau áp dụng bài gốc sang bài toán / domain khác. competes: giải cùng bài toán theo cách khác. critiques: phản biện hoặc cho kết quả ngược. related: cùng chủ đề, không có quan hệ rõ.',
          },
          method: { type: 'string', description: 'Phương pháp / cơ chế cốt lõi, ngắn gọn.' },
          problem: { type: 'string', description: 'Bài toán hoặc gap mà bài nhắm tới.' },
          domain: { type: 'string', description: 'Domain / modality / thiết lập ứng dụng.' },
          data: { type: 'string', description: 'Dataset / benchmark nêu trong tài liệu; "chưa rõ" nếu tài liệu không nêu.' },
          difference: { type: 'string', description: 'Với R / C / S: khác bài gốc ở điểm then chốt nào. Với P: đóng góp riêng của bài gốc so với các bài còn lại.' },
        },
      },
    },
    coverage: {
      type: 'array', description: '6-10 khía cạnh của hướng nghiên cứu (trải đủ các loại: phương pháp, bài toán, domain, dữ liệu, đánh giá…), cho biết bài nào đã cover.',
      items: {
        type: 'object', additionalProperties: false, required: ['aspect', 'dimension', 'main', 'papers', 'note'],
        properties: {
          aspect: { type: 'string', description: 'Tên khía cạnh cụ thể, ví dụ "Tạo dữ liệu giả cho domain khan hiếm", "Robustness với câu hỏi diễn đạt lại".' },
          dimension: { type: 'string', enum: DIMS },
          main: { type: 'string', enum: ['yes', 'partial', 'no'], description: 'Bài gốc (P) có cover khía cạnh này không. yes: giải quyết rõ; partial: có nhắc tới hoặc chỉ giải quyết một phần; no: không đề cập.' },
          papers: { type: 'array', items: { type: 'string' }, description: 'Các nghiên cứu KHÁC (mã R, C, S) đã cover khía cạnh này. KHÔNG ghi "P" ở đây: mức cover của bài gốc chỉ ghi ở trường main. Mảng rỗng nếu chưa bài nào.' },
          note: { type: 'string', description: 'Các bài cover tới đâu, chồng lấn hay bổ sung cho nhau thế nào.' },
        },
      },
    },
    gaps: {
      type: 'array', description: '3-7 vấn đề CÒN BỎ NGỎ: chưa bài nào trong danh sách giải quyết, hoặc chỉ giải quyết một phần.',
      items: {
        type: 'object', additionalProperties: false, required: ['gap', 'dimension', 'status', 'evidence', 'papers'],
        properties: {
          gap: { type: 'string', description: 'Vấn đề cụ thể còn mở.' },
          dimension: { type: 'string', enum: DIMS },
          status: { type: 'string', enum: ['open', 'partial'], description: 'open: chưa thấy bài nào; partial: có bài chạm tới nhưng hẹp hoặc chưa thuyết phục.' },
          evidence: { type: 'string', description: 'Dựa vào đâu mà thấy còn mở: giới hạn bài gốc nêu, câu trích dẫn, khoảng trống trong bảng cover.' },
          papers: { type: 'array', items: { type: 'string' }, description: 'Mã các bài đã chạm tới vấn đề (R, C, S). Thêm "P" nếu vấn đề lấy từ giới hạn do chính bài gốc nêu.' },
        },
      },
    },
    directions: {
      type: 'array', description: '3-6 hướng nghiên cứu tiếp, xếp theo mức đáng làm. Phải bám vào gaps ở trên.',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'idea', 'gap', 'gap_ids', 'builds_on', 'first_step', 'novelty', 'risk', 'fit'],
        properties: {
          title: { type: 'string', description: 'Tên hướng, ngắn.' },
          idea: { type: 'string', description: '2-4 câu: làm gì, bằng cơ chế nào, kỳ vọng gì.' },
          gap: { type: 'string', description: 'Gap nào ở trên hướng này giải quyết (chép ngắn).' },
          gap_ids: { type: 'array', items: { type: 'string' }, description: 'Mã các khoảng trống trong mảng gaps mà hướng này giải quyết, theo thứ tự xuất hiện: "G1" là phần tử đầu tiên, "G2" là phần tử thứ hai…' },
          builds_on: ids,
          first_step: { type: 'string', description: 'Thí nghiệm hoặc việc đầu tiên nên làm, đủ cụ thể để bắt tay (dataset, baseline, metric).' },
          novelty: { type: 'string', enum: ['incremental', 'moderate', 'high'] },
          risk: { type: 'string', description: 'Rủi ro hoặc điều kiện có thể làm hướng này thất bại.' },
          fit: { type: 'string', description: 'Liên hệ với đề tài của người đọc nếu có; rỗng nếu không có đề tài hoặc không liên quan.' },
        },
      },
    },
  },
};

function paperLine(code, x, kind) {
  const it = x.it;
  const ctx = (it._contexts || []).slice().sort((a, b) => b.length - a.length).slice(0, 2).map((c) => `  Câu trích dẫn: "${c.slice(0, 380)}"`);
  const role = kind === 'pin' ? 'người đọc chọn thêm' : ROLE_LABELS[kind][x.role.role];
  return [`[${code}] ${it.title}${fmtPub(it) ? ` (${fmtPub(it)})` : ''}${it.venue ? ` · ${it.venue}` : ''} · ${role}${it._influential ? ' · ảnh hưởng lớn' : ''}${x.pinned && kind !== 'pin' ? ' · người đọc muốn so sánh kỹ bài này' : ''}`,
    ...ctx, `  Tóm tắt: ${(it.tldr || it.abstract || '(không có)').replace(/\s+/g, ' ').slice(0, 650)}`].join('\n');
}

function buildPrompt(paper, refs, cits, extra, lang, settings, prevNotes = '') {
  const e = normalizeExtraction(paper.extraction);
  const { stated, observed } = splitLimitations(e.limitation?.items);
  const limits = [...stated, ...observed, e.limitation?.unresolved].filter((x) => String(x || '').trim());
  const out = lang === 'en' ? 'English' : 'tiếng Việt';
  const system = `Bạn là cố vấn nghiên cứu. Nhiệm vụ: đặt một bài báo (bài gốc, mã P) giữa các bài nó dẫn (R…), các bài dẫn nó (C…) và các bài người đọc chọn thêm (S…), so sánh chúng, chỉ ra mỗi bài cover khía cạnh nào, phần nào còn bỏ ngỏ, rồi đề xuất hướng nghiên cứu tiếp. Viết bằng ${out}, giữ nguyên thuật ngữ, tên phương pháp, dataset, metric bằng tiếng Anh.

Quy tắc:
- Chỉ dùng thông tin trong tài liệu được cung cấp (ghi chú bài gốc, tiêu đề, câu trích dẫn, tóm tắt). Không bổ sung kiến thức ngoài, không đoán nội dung bài từ tiêu đề.
- Bảng comparison phải có đủ P và mọi mã R, C, S trong danh sách, không bỏ bài nào.
- Trong bảng coverage, mức cover của bài gốc chỉ ghi ở trường main; danh sách papers chỉ gồm các bài khác (R, C, S), không ghi P. Bài gốc chỉ nhắc tới mà chưa giải quyết thì main là "partial".
- Phân biệt rõ quan hệ: thư viện, dataset, optimizer, công cụ trực quan hoá / đánh giá là "tool", không phải "foundation"; "baseline" chỉ dùng khi bài gốc thật sự so kết quả với bài đó.
- Mỗi nhận định về một bài phải ghi mã bài đúng như trong danh sách (P, R1, C2, S1…).
- Một vấn đề chỉ được coi là "còn bỏ ngỏ" khi không bài nào trong danh sách nói rõ đã giải quyết; nếu có bài chạm tới thì ghi status "partial" và nêu mã bài.
- Khi tóm tắt quá ít để kết luận, ghi "chưa rõ" thay vì suy diễn.
- Hướng đề xuất phải cụ thể, khả thi, bám vào gap đã nêu; tránh câu chung chung kiểu "cải thiện hiệu suất", "mở rộng sang dữ liệu khác".`;
  const user = [
    '## Bài gốc [P]',
    `Tiêu đề: ${paper.title}`,
    e.year ? `Năm: ${e.year}` : null,
    e.one_liner ? `Tóm tắt: ${e.one_liner}` : null,
    e.problem ? `Bài toán: ${e.problem}` : null,
    e.bottleneck ? `Gap bài gốc nhắm tới: ${e.bottleneck}` : null,
    e.key_idea?.summary ? `Phương pháp: ${e.key_idea.summary}` : null,
    e.novelty ? `Điểm mới: ${e.novelty}` : null,
    (e.contributions || []).length ? `Đóng góp: ${e.contributions.join('; ')}` : null,
    (e.validation?.datasets || []).length ? `Dataset: ${e.validation.datasets.join(', ')}` : null,
    (e.validation?.benchmarks || []).length ? `Benchmark: ${e.validation.benchmarks.join(', ')}` : null,
    e.dataset_metric_note ? `Kết quả: ${e.dataset_metric_note}` : null,
    limits.length ? `Giới hạn:\n${limits.map((x) => `- ${x}`).join('\n')}` : null,
    '',
    `## Bài gốc dẫn (${refs.length} bài, nền tảng hoặc baseline)`,
    ...(refs.length ? refs.map((x, i) => paperLine(`R${i + 1}`, x, 'references')) : ['(không có)']),
    '',
    `## Bài dẫn bài gốc (${cits.length} bài, phát triển sau)`,
    ...(cits.length ? cits.map((x, i) => paperLine(`C${i + 1}`, x, 'citations')) : ['(không có)']),
    ...(extra.length ? ['', `## Bài người đọc chọn thêm để so sánh (${extra.length} bài)`, ...extra.map((x, i) => paperLine(`S${i + 1}`, x, 'pin'))] : []),
    prevNotes ? `\n## Ghi chú so sánh của lần lập bản đồ trước (CHỈ ĐỂ THAM KHẢO)\nĐối chiếu từng ý với tài liệu ở trên: giữ điều còn đúng, sửa điều sai, bổ sung chỗ thiếu; tài liệu không ủng hộ thì bỏ. Mã bài đã được đổi theo danh sách lần này.\n${prevNotes}` : null,
    settings.myResearch?.trim() ? `\n## Đề tài của người đọc (dùng cho trường fit)\n${settings.myResearch.trim()}` : '\n(Người đọc chưa nhập đề tài: để trường fit rỗng.)',
  ].filter((x) => x != null).join('\n');
  return { system, user };
}

const jobs = new Map();
export const researchJob = (paperId) => jobs.get(paperId) || null;

const pack = (x, code, relation) => ({
  id: code, key: pinKey(x.it), relation, pinned: !!x.pinned, paperId: x.it.paperId, title: x.it.title, date: fmtPub(x.it), role: x.role.role,
  roleText: relation === 'pin' ? 'Bạn chọn thêm' : ROLE_LABELS[relation === 'ref' ? 'references' : 'citations'][x.role.role], influential: !!x.it._influential,
  arxiv: x.it.externalIds?.ArXiv || '', doi: x.it.externalIds?.DOI || '', url: x.it.url || '',
  authors: (x.it.authors || []).slice(0, 4).map((a) => a.name).join(', '), venue: x.it.venue || '', citations: x.it.citationCount || 0,
  contexts: (x.it._contexts || []).slice(0, 2), tldr: x.it.tldr || '', abstract: (x.it.abstract || '').slice(0, 400),
});

// Dòng so sánh dự phòng khi mô hình bỏ sót bài: vẫn hiện đủ bài, ghi rõ là chưa được so sánh.
const REL_OF = { ref: { method: 'foundation', result: 'baseline' }, cit: { method: 'extends', result: 'competes' } }; // còn lại: related

/**
 * Bảng cover: mức cover của bài gốc nằm ở cột P (main), nên bỏ "P" khỏi danh sách bài đã cover.
 * Mô hình đôi khi ghi P vào danh sách nhưng đánh dấu bài gốc "không cover" (thường là bài gốc chỉ nhắc tới):
 * khi đó coi là cover một phần và ghi chú lý do.
 */
function cleanCoverage(list) {
  return (list || []).map((x) => {
    const papers = (x.papers || []).filter((c) => c !== 'P');
    const mentioned = (x.papers || []).includes('P');
    const main = mentioned && (!x.main || x.main === 'no') ? 'partial' : (x.main || 'no');
    return { ...x, papers, main, mainNote: mentioned && main !== x.main ? 'Bài gốc có nhắc tới nhưng chưa giải quyết' : (x.mainNote || '') };
  });
}

/* ---------- Dòng bài gốc từ ghi chú, và bổ trợ giữa các lần cập nhật ---------- */

const CMP_FIELDS = ['method', 'problem', 'domain', 'data', 'difference'];
const isBlank = (v) => { const s = String(v ?? '').trim(); return !s || /^(chưa rõ|không rõ|unknown|n\/a|none|—|-)\.?$/i.test(s); };
const clip = (s, n = 260) => { const v = String(s || '').replace(/\s+/g, ' ').trim(); return v.length > n ? `${v.slice(0, n - 1)}…` : v; };

/** Các cột của dòng bài gốc (P) lấy từ chính ghi chú của bài: dùng khi mô hình bỏ sót dòng P hoặc để trống cột. */
function mainRowFromNotes(paper) {
  const e = normalizeExtraction(paper?.extraction || {});
  const datasets = [...new Set([...(e.validation?.datasets || []), ...(e.validation?.benchmarks || [])].map((x) => String(x).replace(/\([^)]*\)/g, '').trim()).filter(Boolean))];
  return {
    method: clip(e.key_idea?.summary || (e.key_idea?.components || []).map((c) => c?.name).filter(Boolean).join(', ')),
    problem: clip(e.problem || e.bottleneck),
    domain: clip((e.tags || []).slice(0, 5).join(', '), 120),
    data: clip(datasets.join(', '), 160),
    difference: clip(e.novelty || (e.contributions || [])[0]),
  };
}

/** Dòng P luôn có nội dung: cột mô hình bỏ trống được điền từ ghi chú của bài gốc (đánh dấu nguồn để người đọc biết). */
export function withMainRow(comparison, paper) {
  const list = (comparison || []).slice();
  const i = list.findIndex((x) => x.paper === 'P');
  const notes = mainRowFromNotes(paper);
  const row = i >= 0 ? { ...list[i] } : { paper: 'P', relation: 'main' };
  row.relation = 'main';
  const fromNotes = [...(row.fromNotes || [])];
  for (const f of CMP_FIELDS) {
    if (isBlank(row[f]) && !isBlank(notes[f])) { row[f] = notes[f]; if (!fromNotes.includes(f)) fromNotes.push(f); }
  }
  row.fromNotes = fromNotes;
  row.missing = CMP_FIELDS.every((f) => isBlank(row[f]));
  if (i >= 0) list[i] = row; else list.unshift(row);
  return list;
}

/** Dòng so sánh của lần cập nhật trước theo danh tính bài (mã R / C / S có thể đổi giữa các lần). */
function prevRowsByKey(prevMap) {
  const out = new Map();
  if (!prevMap?.data?.comparison) return out;
  const keyOf = new Map((prevMap.papers || []).map((x) => [x.id, x.key || pinKey(x)]));
  for (const r of prevMap.data.comparison) {
    if (r.missing) continue;
    const k = r.paper === 'P' ? 'P' : keyOf.get(r.paper);
    if (k) out.set(k, r);
  }
  return out;
}

/** Ghi chú lần trước đưa vào prompt để mô hình đối chiếu lại (không chép nguyên). */
function prevNotesForPrompt(prev, papers) {
  if (!prev.size) return '';
  const lines = [];
  const add = (code, r) => lines.push(`[${code}] quan hệ: ${r.relation || '?'}; phương pháp: ${clip(r.method, 140) || '?'}; bài toán: ${clip(r.problem, 140) || '?'}; domain: ${clip(r.domain, 80) || '?'}; dữ liệu: ${clip(r.data, 100) || '?'}; khác biệt: ${clip(r.difference, 180) || '?'}`);
  if (prev.has('P')) add('P', prev.get('P'));
  for (const x of papers) { const r = prev.get(x.key); if (r) add(x.id, r); }
  return lines.length ? lines.join('\n') : '';
}

/**
 * Bổ trợ kết quả mới bằng kết quả lần trước: dòng mô hình bỏ sót hoặc cột trống / "chưa rõ" được lấy từ lần trước
 * (đánh dấu fromPrev); quan hệ khác với lần trước thì giữ kết quả mới và ghi prevRelation để người đọc kiểm tra.
 */
function mergeWithPrev(comparison, papers, prev) {
  if (!prev.size) return comparison;
  const keyOf = new Map(papers.map((x) => [x.id, x.key]));
  return comparison.map((row) => {
    const k = row.paper === 'P' ? 'P' : keyOf.get(row.paper);
    const old = k && prev.get(k);
    if (!old) return row;
    if (row.missing) {
      return { ...old, paper: row.paper, missing: false, fromPrev: [...CMP_FIELDS, 'relation'].filter((f) => !isBlank(old[f])), fromNotes: [] };
    }
    const out = { ...row, fromPrev: [] };
    for (const f of CMP_FIELDS) if (isBlank(out[f]) && !isBlank(old[f])) { out[f] = old[f]; out.fromPrev.push(f); }
    if (old.relation && out.relation && old.relation !== out.relation && out.paper !== 'P') out.prevRelation = old.relation;
    return out;
  });
}

/* ---------- Lịch sử phiên bản của bản đồ (để quay lại khi lần cập nhật sau kém hơn) ---------- */
// Lưu riêng trong kv "rmlog:<paperId>" (không nằm trong paper để danh sách paper không nặng thêm), giữ LOG_MAX bản gần nhất.

const LOG_MAX = 15;
export const LOG_EVENTS = { build: 'Trước khi cập nhật', fill: 'Trước khi so sánh thêm bài còn thiếu', delete: 'Trước khi xoá', restore: 'Trước khi khôi phục bản khác' };
const logKey = (paperId) => `rmlog:${paperId}`;

export async function researchLog(paperId) {
  const v = await api.kvGet(logKey(paperId)).catch(() => null);
  return Array.isArray(v) ? v : [];
}

/** Lưu bản đồ sắp bị thay vào lịch sử. event: build | fill | delete | restore. */
async function pushLog(paperId, map, event) {
  if (!map?.data) return;
  const log = await researchLog(paperId);
  // Không lưu trùng bản đã có (cùng thời điểm tạo và cùng lần so sánh thêm).
  if (log.some((x) => x.map?.at === map.at && (x.map?.filledAt || '') === (map.filledAt || ''))) return;
  log.unshift({ id: uid('rml'), savedAt: new Date().toISOString(), event, map });
  await api.kvSet(logKey(paperId), log.slice(0, LOG_MAX)).catch(() => {});
}

/** Tóm tắt một phiên bản để hiện trong danh sách lịch sử. */
export function mapSummary(map) {
  const d = map?.data || {};
  const cmp = d.comparison || [];
  return {
    papers: (map?.papers || []).length,
    compared: cmp.filter((x) => !x.missing && x.paper !== 'P').length,
    gaps: (d.gaps || []).length,
    directions: (d.directions || []).length,
    coverage: (d.coverage || []).length,
    model: [map?.provider, map?.model].filter(Boolean).join('/'),
  };
}

/** Khôi phục một phiên bản trong lịch sử thành bản hiện tại; bản hiện tại (nếu có) được lưu vào lịch sử trước. */
export async function restoreResearchMap(paperId, entryId) {
  const log = await researchLog(paperId);
  const entry = log.find((x) => x.id === entryId);
  if (!entry) throw new Error('Không tìm thấy phiên bản này trong lịch sử.');
  const cur = paperById(paperId);
  await pushLog(paperId, cur?.researchMap, 'restore');
  // Bản được khôi phục trở thành bản hiện tại: rút khỏi lịch sử để khỏi trùng.
  await api.kvSet(logKey(paperId), (await researchLog(paperId)).filter((x) => x.id !== entryId)).catch(() => {});
  return savePaper({ ...paperById(paperId), researchMap: { ...entry.map, restoredAt: new Date().toISOString() } });
}

export async function removeLogEntry(paperId, entryId) {
  const log = await researchLog(paperId);
  await api.kvSet(logKey(paperId), log.filter((x) => x.id !== entryId));
}

/** Tạo (hoặc cập nhật) bản đồ nghiên cứu. Chạy nền: rời tab vẫn chạy tiếp và tự lưu. */
export function buildResearchMap(paperId, { refresh = false, perKind = PER_KIND_DEFAULT } = {}) {
  const running = jobs.get(paperId);
  if (running && !running.done) return running;
  const job = { status: 'Đang chuẩn bị…', step: 0, of: 3, done: false, error: '', listeners: new Set() };
  const emit = (status, step) => { if (status) job.status = status; if (step != null) job.step = step; for (const fn of [...job.listeners]) { try { fn(job); } catch (_) { /* tab đã đóng */ } } };
  jobs.set(paperId, job);
  (async () => {
    const paper = paperById(paperId);
    const ident = s2Ident(paper);
    if (!ident) throw new Error('Paper chưa có arXiv ID, DOI hoặc link nên không tra được bài dẫn và bài được dẫn.');
    const n = perKindValue(perKind);
    // Nhiều bài hơn mặc định của danh sách đã lưu (300 bài được dẫn / 100 bài dẫn) thì lấy thêm từ Semantic Scholar.
    const want = (base) => (n === Infinity ? ALL_LIMIT : (n > base ? n * 2 : 0));
    emit('Đang lấy các bài được dẫn từ Semantic Scholar…', 0);
    const rr = await api.s2References(ident, refresh, 0, want(300)).catch(() => ({ items: [] }));
    emit('Đang lấy các bài dẫn bài này từ Semantic Scholar…', 1);
    const cr = await api.s2Citations(ident, refresh, 0, want(100)).catch(() => ({ items: [] }));
    // Bài người dùng ghim luôn được đưa vào; phần còn lại chọn tự động cho đủ số bài mỗi loại.
    const pins = (paper.researchPins || []).filter((x) => x?.it?.title);
    const pinned = (rel) => pins.filter((x) => x.relation === rel).map((x) => ({ it: x.it, role: citeRole(x.it), pinned: true }));
    const pinKeys = new Set(pins.map((x) => x.key));
    const refs = [...pinned('ref'), ...pick(rr.items, n - pinned('ref').length, false, pinKeys)];
    const cits = [...pinned('cit'), ...pick(cr.items, n - pinned('cit').length, true, pinKeys)];
    const extra = pins.filter((x) => x.relation !== 'ref' && x.relation !== 'cit').map((x) => ({ it: x.it, role: citeRole(x.it), pinned: true }));
    if (!refs.length && !cits.length && !extra.length) throw new Error('Chưa lấy được bài dẫn hay bài được dẫn có tóm tắt để so sánh (có thể Semantic Scholar đang giới hạn tốc độ, thử lại sau).');
    const settings = store.settings;
    const lang = settings.language === 'en' ? 'en' : 'vi';
    const papersNow = [...refs.map((x, i) => pack(x, `R${i + 1}`, 'ref')), ...cits.map((x, i) => pack(x, `C${i + 1}`, 'cit')), ...extra.map((x, i) => pack(x, `S${i + 1}`, 'pin'))];
    const prev = prevRowsByKey(paper.researchMap);
    // Lượt phân tích chính chỉ gồm bài tiêu biểu (danh sách đã xếp theo mức quan trọng); phần còn lại so sánh theo đợt.
    const room = Math.max(10, MAIN_CAP - extra.length);
    const mainR = Math.min(refs.length, Math.max(Math.ceil(room / 2), room - cits.length));
    const mainC = Math.min(cits.length, room - mainR);
    const mainRefs = refs.slice(0, mainR);
    const mainCits = cits.slice(0, mainC);
    const mainSet = new Set([...papersNow.filter((x) => x.relation === 'ref').slice(0, mainR), ...papersNow.filter((x) => x.relation === 'cit').slice(0, mainC), ...papersNow.filter((x) => x.relation === 'pin')].map((x) => x.id));
    const rest = papersNow.filter((x) => !mainSet.has(x.id));
    job.of = 3 + Math.ceil(rest.length / BATCH_SIZE);
    const { system, user } = buildPrompt(paper, mainRefs, mainCits, extra, lang, settings, prevNotesForPrompt(prev, papersNow.filter((x) => mainSet.has(x.id))));
    const total = mainRefs.length + mainCits.length + extra.length;
    emit(`Đang nhờ ${settings.provider}/${settings.models?.[settings.provider]} phân tích ${total} bài tiêu biểu${rest.length ? ` (còn ${rest.length} bài so sánh thêm theo đợt)` : ''}…`, 2);
    const out = await complete({
      settings, system, user, schema: SCHEMA, schemaName: 'research_map', task: 'research-map', paperId,
      maxTokens: Math.min(16000, 6000 + total * 300), effort: ['high', 'xhigh', 'max'].includes(settings.effort) ? 'medium' : settings.effort,
      onRetry: (k, wait) => emit(`Bị giới hạn tốc độ, thử lại lần ${k} sau ${Math.round(wait / 1000)}s…`),
    });
    const data = parseLooseJson(out.text);
    if (!data || typeof data !== 'object') throw new Error('Mô hình không trả về kết quả đọc được, hãy thử lại.');
    const papers = papersNow;
    // Mã bài phải có thật trong danh sách đã gửi; mã lạ thì bỏ.
    const valid = new Set(['P', ...papers.map((x) => x.id)]);
    const code = (s) => String(s || '').replace(/[[\]\s]/g, '').toUpperCase();
    const keep = (arr) => (Array.isArray(arr) ? arr : []).map((x) => ({ ...x, papers: (x.papers || []).map(code).filter((s) => valid.has(s)) }));
    const seen = new Set();
    const comparison = (Array.isArray(data.comparison) ? data.comparison : []).map((x) => ({ ...x, paper: code(x.paper) }))
      .filter((x) => valid.has(x.paper) && !seen.has(x.paper) && seen.add(x.paper));
    // Các bài ngoài nhóm tiêu biểu: so sánh theo đợt.
    if (rest.length) {
      const extraRows = await compareRows({ paper, list: rest, lang, settings, paperId, onStatus: emit, stepOffset: 3 });
      for (const [c, r] of extraRows) if (!seen.has(c)) { comparison.push(r); seen.add(c); }
    }
    // Bài mô hình bỏ sót vẫn có một dòng, ghi rõ chưa được so sánh, để bảng luôn đủ mọi bài đã đọc.
    for (const x of papers) {
      if (seen.has(x.id)) continue;
      comparison.push({ paper: x.id, relation: REL_OF[x.relation]?.[x.role] || 'related', method: '', problem: '', domain: '', data: '', difference: '', missing: true });
    }
    if (!seen.has('P')) comparison.unshift({ paper: 'P', relation: 'main', method: '', problem: '', domain: '', data: '', difference: '', missing: true });
    // Bổ trợ bằng lần cập nhật trước, rồi đảm bảo dòng bài gốc có nội dung từ ghi chú của chính bài.
    const merged = withMainRow(mergeWithPrev(comparison, papers, prev), paper);
    const result = {
      overview: String(data.overview || ''),
      lineage: { foundations: String(data.lineage?.foundations || ''), developments: String(data.lineage?.developments || '') },
      comparison: merged,
      coverage: cleanCoverage(keep(data.coverage)),
      gaps: keep(data.gaps),
      directions: (Array.isArray(data.directions) ? data.directions : []).map((x) => ({ ...x, gap_ids: (x.gap_ids || []).map((g) => String(g).toUpperCase().replace(/[^G0-9]/g, '')).filter((g) => /^G\d+$/.test(g)), builds_on: (x.builds_on || []).map(code).filter((s) => valid.has(s)) })),
    };
    const map = {
      at: new Date().toISOString(), model: out.model, provider: out.provider, lang, perKind: n === Infinity ? 'all' : n, mainCount: mainSet.size,
      totals: { refs: (rr.items || []).length, cits: (cr.items || []).length },
      papers, data: result,
    };
    await pushLog(paperId, paperById(paperId)?.researchMap, 'build');
    await savePaper({ ...paperById(paperId), researchMap: map });
    return map;
  })().then(() => { job.done = true; emit('Xong.'); }, (e) => { job.done = true; job.error = e.message || String(e); emit(); });
  return job;
}

export async function removeResearchMap(paperId) {
  jobs.delete(paperId);
  await pushLog(paperId, paperById(paperId)?.researchMap, 'delete');
  return savePaper({ ...paperById(paperId), researchMap: null });
}

/* ---------- So sánh lại các bài mô hình bỏ sót ---------- */

const fillJobs = new Map();
export const fillJob = (paperId) => fillJobs.get(paperId) || null;
export const missingCodes = (map) => (map?.data?.comparison || []).filter((x) => x.missing && x.paper !== 'P').map((x) => x.paper);

/**
 * Với các bài còn "chưa so sánh": lấy thêm tóm tắt đầy đủ + TLDR + lĩnh vực từ Semantic Scholar, rồi gọi mô hình một lượt
 * chỉ để so sánh những bài này với bài gốc. Kết quả ghép vào bảng so sánh đã có; bài vẫn thiếu thông tin thì giữ dòng cũ.
 */
/**
 * So sánh một danh sách bài (đã đóng gói, có mã R / C / S) với bài gốc, chia đợt BATCH_SIZE bài mỗi lượt gọi mô hình.
 * details: Map paperId -> thông tin thêm từ Semantic Scholar (tuỳ chọn). Trả về Map mã -> dòng so sánh.
 */
async function compareRows({ paper, list, details = new Map(), lang, settings, paperId, onStatus = () => {}, stepOffset = 0 }) {
  const e = normalizeExtraction(paper.extraction);
  const kindText = { ref: 'bài gốc dẫn', cit: 'dẫn bài gốc', pin: 'người đọc chọn thêm' };
  const system = `Bạn là cố vấn nghiên cứu. So sánh từng bài trong danh sách với bài gốc (P). Viết bằng ${lang === 'en' ? 'English' : 'tiếng Việt'}, giữ thuật ngữ, tên phương pháp, dataset bằng tiếng Anh.
Quy tắc:
- Trả đúng một dòng cho MỖI mã bài trong danh sách, không bỏ bài nào.
- Chỉ dùng thông tin được cung cấp. Thiếu thông tin cho một cột thì ghi "chưa rõ", nhưng vẫn phải có dòng.
- Phân biệt rõ quan hệ: thư viện, dataset, optimizer, công cụ trực quan hoá / đánh giá là "tool"; "foundation" là bài gốc kế thừa phương pháp / ý tưởng; "baseline" chỉ khi bài gốc so kết quả với bài đó.`;
  const head = [
    '## Bài gốc [P]', `Tiêu đề: ${paper.title}`,
    e.one_liner ? `Tóm tắt: ${e.one_liner}` : null, e.problem ? `Bài toán: ${e.problem}` : null,
    e.key_idea?.summary ? `Phương pháp: ${e.key_idea.summary}` : null, e.novelty ? `Điểm mới: ${e.novelty}` : null,
    (e.validation?.datasets || []).length ? `Dataset: ${e.validation.datasets.join(', ')}` : null,
  ].filter((x) => x != null).join('\n');
  const got = new Map();
  const batches = [];
  for (let i = 0; i < list.length; i += BATCH_SIZE) batches.push(list.slice(i, i + BATCH_SIZE));
  for (let b = 0; b < batches.length; b++) {
    const part = batches[b];
    const user = [head, '', `## Các bài cần so sánh (${part.length} bài)`,
      ...part.map((x) => {
        const d = details.get(x.paperId) || {};
        return [`[${x.id}] ${x.title}${x.date ? ` (${x.date})` : ''}${x.venue || d.venue ? ` · ${x.venue || d.venue}` : ''} · ${kindText[x.relation] || ''}${(d.fields || []).length ? ` · lĩnh vực: ${d.fields.join(', ')}` : ''}`,
          ...(x.contexts || []).slice(0, 2).map((c) => `  Câu trích dẫn: "${String(c).slice(0, 380)}"`),
          `  TLDR: ${d.tldr || x.tldr || '(không có)'}`,
          `  Tóm tắt: ${(d.abstract || x.abstract || '(không có)').replace(/\s+/g, ' ').slice(0, 1400)}`].join('\n');
      })].join('\n');
    onStatus(`Đang so sánh ${part.length} bài${batches.length > 1 ? ` (đợt ${b + 1}/${batches.length})` : ''}…`, stepOffset + b);
    try {
      const out = await complete({
        settings, system, user, task: 'research-map-fill', paperId, schemaName: 'research_fill',
        schema: { type: 'object', additionalProperties: false, required: ['comparison'], properties: { comparison: { ...SCHEMA.properties.comparison, description: 'Mỗi mã bài trong danh sách đúng một dòng.' } } },
        maxTokens: Math.min(14000, 2000 + part.length * 450), effort: ['high', 'xhigh', 'max'].includes(settings.effort) ? 'medium' : settings.effort,
        onRetry: (k, wait) => onStatus(`Bị giới hạn tốc độ, thử lại lần ${k} sau ${Math.round(wait / 1000)}s…`),
      });
      const data = parseLooseJson(out.text);
      const codes = new Set(part.map((x) => x.id));
      for (const r of (Array.isArray(data?.comparison) ? data.comparison : [])) {
        const c = String(r.paper || '').replace(/[[\]\s]/g, '').toUpperCase();
        if (codes.has(c) && !got.has(c)) got.set(c, { ...r, paper: c, relation: r.relation === 'main' ? 'related' : r.relation });
      }
    } catch (err) {
      if (b === 0 && batches.length === 1) throw err;
      onStatus(`Đợt ${b + 1} lỗi (${err.message}), các bài trong đợt này để “chưa so sánh”.`);
    }
  }
  return got;
}

export function fillMissing(paperId, only = null) {
  const running = fillJobs.get(paperId);
  if (running && !running.done) return running;
  const job = { status: 'Đang chuẩn bị…', step: 0, of: 2, done: false, error: '', listeners: new Set() };
  const emit = (status, step) => { if (status) job.status = status; if (step != null) job.step = step; for (const fn of [...job.listeners]) { try { fn(job); } catch (_) { /* tab đã đóng */ } } };
  fillJobs.set(paperId, job);
  (async () => {
    const paper = paperById(paperId);
    const map = paper?.researchMap;
    // only: chỉ so sánh các mã được chọn (một bài, hoặc các bài tick chọn); mặc định là mọi bài còn thiếu.
    const codes = missingCodes(map).filter((c) => !only || only.includes(c));
    if (!codes.length) throw new Error('Không còn bài nào chưa được so sánh.');
    const byId = Object.fromEntries(map.papers.map((x) => [x.id, x]));
    const list = codes.map((c) => byId[c]).filter(Boolean);
    emit(`Đang tìm thêm thông tin ${list.length} bài trên Semantic Scholar…`, 0);
    const ids = list.map((x) => x.paperId).filter((x) => /^[0-9a-f]{40}$/.test(x || ''));
    const details = new Map();
    if (ids.length) {
      // Semantic Scholar bị giới hạn tốc độ có thể chờ lâu: chờ tối đa 1 phút để lấy đủ thông tin, quá thì so sánh bằng thông tin đã lưu.
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 60000));
      try { (await Promise.race([api.s2Details(ids), timeout]) || []).forEach((d) => { if (d?.paperId) details.set(d.paperId, d); }); } catch (_) { /* dùng thông tin đã lưu */ }
      if (!details.size) emit('Semantic Scholar phản hồi chậm, so sánh bằng thông tin đã lưu…');
    }
    const settings = store.settings;
    const lang = map.lang || (settings.language === 'en' ? 'en' : 'vi');
    job.of = 1 + Math.ceil(list.length / BATCH_SIZE);
    const got = await compareRows({ paper, list, details, lang, settings, paperId, onStatus: emit, stepOffset: 1 });
    // Ghép vào bản đồ mới nhất (người dùng có thể đã sửa paper trong lúc chờ).
    const cur = paperById(paperId);
    const m = cur.researchMap;
    const comparison = (m.data.comparison || []).map((x) => (got.has(x.paper) ? { ...got.get(x.paper), relation: got.get(x.paper).relation === 'main' ? 'related' : got.get(x.paper).relation } : (codes.includes(x.paper) ? { ...x, retried: true } : x)));
    // Lưu thêm tóm tắt đầy đủ vừa tìm được vào thẻ bài để bấm mã R / C xem được.
    const papers = m.papers.map((x) => { const d = details.get(x.paperId); return d ? { ...x, tldr: x.tldr || d.tldr, abstract: x.abstract || (d.abstract || '').slice(0, 400) } : x; });
    await pushLog(paperId, m, 'fill');
    await savePaper({ ...cur, researchMap: { ...m, papers, data: { ...m.data, comparison }, filledAt: new Date().toISOString() } });
    job.filled = got.size;
    job.left = codes.length - got.size;
  })().then(() => { job.done = true; emit('Xong.'); }, (e) => { job.done = true; job.error = e.message || String(e); emit(); });
  return job;
}

/* ---------- Hiển thị ---------- */

// [nhãn, lớp màu, giải thích khi rê chuột]
const REL = {
  main: ['Bài gốc', 'accent', 'Bài đang xem (mã P).'],
  foundation: ['Nền tảng', 'rel-found', 'Bài gốc XÂY TRÊN bài này: dùng lại phương pháp, mô hình, kiến trúc hoặc ý tưởng của nó làm nền (ví dụ dùng BLIP-2 làm backbone rồi fine-tune).'],
  tool: ['Công cụ / dữ liệu', 'rel-tool', 'Bài gốc chỉ DÙNG bài này như công cụ: thư viện, dataset, optimizer, cách trực quan hoá hay đánh giá (PyTorch, COCO, Adam, t-SNE…). Không kế thừa ý tưởng chính.'],
  baseline: ['Baseline', 'rel-base', 'Bài gốc SO KẾT QUẢ với bài này: chạy lại hoặc lấy số của nó làm mốc để chứng minh mình tốt hơn. Là đối thủ cần vượt, không phải thứ được dùng lại.'],
  extends: ['Mở rộng', 'rel-ext', 'Bài sau KẾ THỪA phương pháp của bài gốc và phát triển thêm (thêm thành phần, thiết lập rộng hơn, cải tiến điểm yếu).'],
  applies: ['Áp dụng', 'rel-app', 'Bài sau đem phương pháp của bài gốc sang bài toán, domain hoặc dữ liệu khác, gần như giữ nguyên cách làm.'],
  competes: ['Cạnh tranh', 'rel-comp', 'Giải CÙNG bài toán theo cách khác, thường so kết quả trực tiếp với bài gốc (bài gốc là baseline của nó hoặc ngược lại).'],
  critiques: ['Phản biện', 'rel-crit', 'Chỉ ra điểm yếu, giả định sai hoặc cho kết quả ngược với bài gốc.'],
  related: ['Liên quan', '', 'Cùng chủ đề nhưng không có quan hệ kế thừa, sử dụng hay so sánh rõ ràng.'],
};
const SORT_HINT = ' · Bấm để đưa nhóm này lên đầu.';
const relBadge = (rel, guessed = false) => {
  const key = REL[rel] ? rel : 'related';
  const [l, c, tip] = REL[key];
  return `<span class="badge ${c} rm-tag ${guessed ? 'rm-guess' : ''}" data-st="cmp" data-sk="rel:${key}" title="${escapeHtml(`${guessed ? `Ước đoán từ câu trích dẫn (mô hình chưa phân loại bài này). ${tip}` : tip}${SORT_HINT}`)}">${l}${guessed ? '?' : ''}</span>`;
};
const DIM = { method: 'Phương pháp', problem: 'Bài toán', domain: 'Domain', data: 'Dữ liệu', evaluation: 'Đánh giá', efficiency: 'Hiệu năng', robustness: 'Độ bền vững', theory: 'Lý thuyết', other: 'Khác' };
const DIM_TIP = {
  method: 'Cách làm: mô hình, kiến trúc, thuật toán, quy trình huấn luyện.',
  problem: 'Bài toán hoặc câu hỏi nghiên cứu được đặt ra.',
  domain: 'Lĩnh vực / modality / thiết lập ứng dụng (y tế, ảnh viễn thám, đa ngôn ngữ…).',
  data: 'Dữ liệu: tạo, thu thập, gán nhãn, tăng cường hoặc thiếu dữ liệu.',
  evaluation: 'Cách đánh giá: benchmark, metric, giao thức thí nghiệm.',
  efficiency: 'Chi phí tính toán, tốc độ, bộ nhớ, số tham số.',
  robustness: 'Độ bền vững: nhiễu, tấn công, phân phối lệch, câu hỏi diễn đạt lại.',
  theory: 'Phân tích lý thuyết, giả định, chứng minh.',
  other: 'Khía cạnh khác.',
};
const dimBadge = (d, st) => { const k = DIM[d] ? d : 'other'; return `<span class="badge rm-tag" data-st="${st}" data-sk="dim:${k}" title="${escapeHtml(DIM_TIP[k] + SORT_HINT)}">${DIM[k]}</span>`; };
const GAP_TIP = { open: 'Chưa bài nào trong danh sách đã đọc giải quyết vấn đề này.', partial: 'Có bài chạm tới (mã bài bên cạnh) nhưng còn hẹp, chưa thuyết phục hoặc chỉ trong điều kiện riêng.' };
const NOVEL_TIP = { incremental: 'Cải tiến nhỏ trên cách làm có sẵn: dễ làm, rủi ro thấp, đóng góp vừa phải.', moderate: 'Kết hợp hoặc chuyển hướng có chủ đích, có điểm mới rõ.', high: 'Hướng mới đáng kể so với các bài đã đọc: tiềm năng cao nhưng rủi ro cũng cao.' };
const MAIN = { yes: ['✓', 'ok', 'Bài gốc đã cover'], partial: ['◐', 'warn', 'Bài gốc cover một phần'], no: ['–', '', 'Bài gốc chưa cover'] };
const NOVEL = { incremental: ['Cải tiến nhỏ', ''], moderate: ['Mới vừa', 'accent'], high: ['Mới nhiều', 'ok'] };
const CODE_TIP = { P: 'P: bài gốc (bài đang xem)', R: 'R: bài mà bài gốc dẫn (tài liệu tham khảo)', C: 'C: bài dẫn bài gốc (ra sau)', S: 'S: bài bạn tự chọn thêm để so sánh' };

/** Chú giải các nhãn quan hệ và mã bài: rê chuột vào nhãn để xem nghĩa, bấm để đưa nhóm lên đầu bảng. */
function legendHtml(map) {
  const used = new Set((map.data?.comparison || []).map((x) => x.relation));
  const keys = Object.keys(REL).filter((k) => k !== 'main');
  const codes = ['R', 'C', 'S'].filter((c) => (map.papers || []).some((x) => x.id[0] === c));
  const cls = { R: 'rm-ref', C: 'rm-cit', S: 'rm-pin' };
  const name = { P: 'Bài gốc', R: 'Bài gốc dẫn', C: 'Dẫn bài gốc', S: 'Bạn chọn thêm' };
  const code = (c) => `<span class="rm-lg-code rm-tag" data-st="cmp" data-sk="code:${c}" data-label="${c} · ${name[c]}" title="${CODE_TIP[c]}${SORT_HINT}"><span class="wn-chip ${c === 'P' ? 'rm-main' : cls[c]}">${c}</span>${name[c]}</span>`;
  const hasMissing = (map.data?.comparison || []).some((x) => x.missing && x.paper !== 'P');
  return `<div class="rm-legend">
    <div class="rm-lg-row"><span class="rm-lg-k">Quan hệ</span><div class="rm-lg-v">${keys.map((k) => `<span class="${used.has(k) ? '' : 'rm-unused'}">${relBadge(k)}</span>`).join('')}</div></div>
    <div class="rm-lg-row"><span class="rm-lg-k">Mã bài</span><div class="rm-lg-v">${['P', ...codes].map(code).join('')}${hasMissing ? `<span class="rm-lg-code rm-tag" data-st="cmp" data-sk="missing" title="Dòng mô hình chưa so sánh; nhãn có dấu ? là app ước đoán từ câu trích dẫn${SORT_HINT}"><span class="rm-lg-swatch"></span>Chưa so sánh</span>` : ''}</div></div>
    <div class="rm-lg-row"><span class="rm-lg-k">Nguồn ô</span><div class="rm-lg-v"><span class="rm-from rm-from-notes" title="Mô hình không ghi, lấy từ ghi chú của chính bài gốc">từ ghi chú bài gốc</span><span class="rm-from rm-from-prev" title="Lần này mô hình không ghi hoặc ghi chưa rõ, bổ sung từ lần cập nhật trước">từ lần cập nhật trước</span><span class="rm-relchg" title="Quan hệ lần này khác lần trước">↻ khác lần trước</span></div></div>
    <div class="rm-lg-foot">Rê chuột vào nhãn để xem nghĩa · bấm để đưa nhóm đó lên đầu bảng</div>
  </div>`;
}
const CHIP_CLASS = { ref: 'rm-ref', cit: 'rm-cit', pin: 'rm-pin' };

/* ---------- Bấm nhãn để đưa nhóm lên đầu (sắp xếp / lọc tại chỗ, không gọi lại mô hình) ---------- */

const sortBar = (st) => `<div class="rm-sortbar" data-st-bar="${st}" hidden><span class="hint">Đang đưa lên đầu:</span><span class="rm-sort-keys"></span>
  <label class="row hint" style="gap:5px"><input type="checkbox" data-st-only="${st}" style="width:auto"> Chỉ hiện nhóm đã chọn</label>
  <button type="button" class="linkish" data-st-clear="${st}">Bỏ chọn</button></div>`;

const sortStates = new Map(); // paperId -> { cmp|cov|gap: { keys: [], only } }

/**
 * Gắn hành vi bấm nhãn: các dòng khớp nhãn đã chọn lên đầu (theo thứ tự bấm), dòng khác mờ đi hoặc ẩn khi bật
 * "Chỉ hiện nhóm đã chọn". Bấm lại nhãn để bỏ. Lựa chọn được giữ khi tab vẽ lại trong phiên làm việc.
 */
export function bindResearchSort(root, paperId) {
  if (!root) return;
  const all = sortStates.get(paperId) || {};
  sortStates.set(paperId, all);
  const state = (st) => (all[st] ||= { keys: [], only: false });
  const apply = (st) => {
    const body = root.querySelector(`[data-st-body="${st}"]`);
    if (!body) return;
    const { keys, only } = state(st);
    const rows = [...body.children];
    const rank = (r) => { const own = (r.dataset.keys || '').split(' '); const i = keys.findIndex((k) => own.includes(k)); return i < 0 ? keys.length : i; };
    rows.sort((a, b) => rank(a) - rank(b) || Number(a.dataset.idx) - Number(b.dataset.idx)).forEach((r) => body.appendChild(r));
    for (const r of rows) {
      const hit = !keys.length || rank(r) < keys.length;
      r.classList.toggle('rm-dimrow', !hit && !only);
      r.hidden = !hit && only;
    }
    root.querySelectorAll(`[data-st="${st}"][data-sk]`).forEach((el) => el.classList.toggle('rm-on', keys.includes(el.dataset.sk)));
    const bar = root.querySelector(`[data-st-bar="${st}"]`);
    if (bar) {
      bar.hidden = !keys.length;
      const label = (k) => { const el = root.querySelector(`[data-st="${st}"][data-sk="${CSS.escape(k)}"]`); return (el?.dataset.label || el?.textContent || k).replace(/\?$/, ''); };
      bar.querySelector('.rm-sort-keys').innerHTML = keys.map((k, i) => `<button type="button" class="rm-sort-key" data-st-drop="${st}" data-k="${escapeHtml(k)}" title="Bỏ nhãn này">${i + 1}. ${escapeHtml(label(k))} ✕</button>`).join('');
      const n = rows.filter((r) => rank(r) < keys.length).length;
      bar.querySelector('.rm-sort-keys').insertAdjacentHTML('beforeend', `<span class="hint">${n}/${rows.length} dòng khớp</span>`);
      bar.querySelector(`[data-st-only="${st}"]`).checked = only;
    }
  };
  root.addEventListener('click', (e) => {
    const tag = e.target.closest('[data-sk][data-st]');
    if (tag && root.contains(tag)) {
      e.preventDefault();
      const s = state(tag.dataset.st);
      const k = tag.dataset.sk;
      s.keys = s.keys.includes(k) ? s.keys.filter((x) => x !== k) : [...s.keys, k];
      apply(tag.dataset.st);
      return;
    }
    const drop = e.target.closest('[data-st-drop]');
    if (drop) { const s = state(drop.dataset.stDrop); s.keys = s.keys.filter((x) => x !== drop.dataset.k); apply(drop.dataset.stDrop); return; }
    const clr = e.target.closest('[data-st-clear]');
    if (clr) { all[clr.dataset.stClear] = { keys: [], only: false }; apply(clr.dataset.stClear); }
  });
  root.addEventListener('change', (e) => {
    const o = e.target.closest('[data-st-only]');
    if (o) { state(o.dataset.stOnly).only = o.checked; apply(o.dataset.stOnly); }
  });
  ['cmp', 'cov', 'gap'].forEach((st) => { if (all[st]?.keys.length) apply(st); });
}

/* ---------- Liên kết giữa hướng đi và khoảng trống ---------- */

const words = (s) => new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2));
/** Chỉ số (0-based) các khoảng trống mà một hướng đi giải quyết: theo mã G mô hình ghi, không có thì theo độ giống nội dung. */
export function directionGaps(dir, gaps) {
  const n = (gaps || []).length;
  const byId = [...new Set((dir.gap_ids || []).map((g) => Number(String(g).replace(/\D/g, '')) - 1).filter((i) => i >= 0 && i < n))];
  if (byId.length) return byId;
  const a = words(dir.gap);
  if (!a.size) return [];
  let best = -1;
  let bestScore = 0;
  (gaps || []).forEach((g, i) => {
    const b = words(g.gap);
    const inter = [...a].filter((w) => b.has(w)).length;
    const score = inter / Math.max(1, Math.min(a.size, b.size));
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return bestScore >= 0.4 ? [best] : [];
}

/** Bấm mã G / số hướng: cuộn tới thẻ tương ứng và làm nổi trong chốc lát. */
export function jumpTo(id) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('rm-flash');
  void el.offsetWidth; // chạy lại hiệu ứng
  el.classList.add('rm-flash');
  setTimeout(() => el.classList.remove('rm-flash'), 1800);
  return true;
}

export function bindResearchLinks(root) {
  root?.addEventListener('click', (e) => {
    const j = e.target.closest('[data-jump]');
    if (!j || !root.contains(j)) return;
    e.preventDefault();
    jumpTo(j.dataset.jump);
  });
}

/** Mã bài bấm được (R1, C2, S1); P là bài gốc. */
export function researchChip(map, paper, id) {
  if (id === 'P') return `<span class="wn-chip rm-main" title="${escapeHtml(plainTitle(paper.title))}">P</span>`;
  const x = (map.papers || []).find((p) => p.id === id);
  if (!x) return '';
  return `<button type="button" class="wn-chip ${CHIP_CLASS[x.relation] || ''}" data-wn="${id}" title="${escapeHtml(`${plainTitle(x.title)}${x.date ? ` · ${x.date}` : ''}`)} · bấm để xem chi tiết">${id}</button>`;
}

export function researchMapHtml(map, paper) {
  const byId = Object.fromEntries((map.papers || []).map((x) => [x.id, x]));
  const chip = (id) => researchChip(map, paper, id);
  const chips = (list) => (list || []).map(chip).join('');
  const d = map.data || {};
  let secN = 0;
  const sec = (title, sub, body) => (body ? `<section class="rm-sec"><header class="rm-sec-h"><span class="rm-sec-n">${++secN}</span><div><h3>${title}</h3>${sub ? `<p class="rm-sec-sub">${sub}</p>` : ''}</div></header>${body}</section>` : '');
  const linkify = (s) => escapeHtml(s).replace(/\b([RCS]\d{1,2}|P)\b(?![-.'’])/g, (m) => (m === 'P' || byId[m] ? chip(m) : m));
  const dash = (s) => (String(s || '').trim() ? escapeHtml(s) : '<span class="muted">—</span>');
  // Ô lấy từ ghi chú bài gốc hoặc từ lần cập nhật trước: đánh dấu để người đọc biết nguồn.
  const src = (x, f, html) => (x.fromNotes?.includes(f) ? `<span class="rm-from rm-from-notes" title="Lấy từ ghi chú của bài gốc (mô hình không ghi ở lần này)">${html}</span>`
    : x.fromPrev?.includes(f) ? `<span class="rm-from rm-from-prev" title="Bổ sung từ lần cập nhật trước (lần này mô hình không ghi hoặc ghi chưa rõ)">${html}</span>` : html);

  const lineage = d.lineage && (d.lineage.foundations || d.lineage.developments)
    ? `<div class="rm-lineage"><div class="rm-lin"><span class="rm-lin-k rm-ref">Nền tảng (R)</span><p>${linkify(d.lineage.foundations || '—')}</p></div>
        <div class="rm-lin rm-lin-mid"><span class="rm-lin-k rm-main">Bài gốc (P)</span><p>${titleHtml(paper.title)}</p></div>
        <div class="rm-lin"><span class="rm-lin-k rm-cit">Phát triển sau (C)</span><p>${linkify(d.lineage.developments || '—')}</p></div></div>` : '';

  // Bài đã so sánh trước (P, R, C, S), bài mô hình chưa so sánh xuống cuối bảng.
  const order = (x) => (x.missing && x.paper !== 'P' ? 1000 : 0) + ({ P: 0, R: 1, C: 2, S: 3 }[x.paper[0]] ?? 4) * 100 + Number(x.paper.slice(1) || 0);
  const comp = withMainRow(d.comparison || [], paper).sort((a, b) => order(a) - order(b));
  const missing = comp.filter((x) => x.missing && x.paper !== 'P').length;
  const compTable = comp.length ? `<div class="table-wrap rm-wrap"><table class="data rm-table"><thead><tr><th>Bài</th><th>Quan hệ</th><th>Phương pháp</th><th>Bài toán / gap</th><th>Domain</th><th>Dữ liệu / benchmark</th><th>Khác biệt</th></tr></thead><tbody data-st-body="cmp">
    ${comp.map((x, i) => {
      const isMain = x.paper === 'P';
      const t = isMain ? paper.title : byId[x.paper]?.title;
      const meta = isMain ? '' : [byId[x.paper]?.date, byId[x.paper]?.pinned ? 'bạn chọn' : ''].filter(Boolean).join(' · ');
      const diff = x.missing && !isMain
        ? `<span class="hint">${x.retried ? 'Đã thử lại nhưng chưa đủ thông tin để so sánh.' : 'Chưa được so sánh.'} Bấm mã bài để đọc tóm tắt.</span>
`
        : `${isMain ? '<span class="rm-own">Đóng góp riêng:</span> ' : ''}${src(x, 'difference', dash(x.difference))}`;
      return `<tr class="${isMain ? 'rm-row-main' : ''} ${x.missing ? 'rm-row-missing' : ''}" data-idx="${i}" data-keys="rel:${REL[x.relation] ? x.relation : 'related'} code:${x.paper[0]}${x.missing && !isMain ? ' missing' : ''}"><td class="rm-c-paper">${x.missing && !isMain ? `<input type="checkbox" class="rm-pick" data-rm-pick="${x.paper}" title="Chọn để so sánh cùng các bài đã chọn">` : ''}${chip(x.paper)} <span class="rm-t">${titleHtml(t || '')}</span>${meta ? `<span class="hint rm-date">${escapeHtml(meta)}</span>` : ''}${x.missing && !isMain ? `<div class="rm-fill-one"><button class="sm" data-rm-fill-one="${x.paper}" title="Tìm thêm thông tin bài ${x.paper} trên Semantic Scholar và so sánh riêng bài này với bài gốc ngay">🔎 So sánh bài này</button></div>` : ''}</td>
        <td>${relBadge(x.relation, !!x.missing)}${x.prevRelation && REL[x.prevRelation] ? `<span class="rm-relchg" title="Lần cập nhật trước xếp bài này là “${REL[x.prevRelation][0]}”; lần này là “${(REL[x.relation] || REL.related)[0]}”. Nên kiểm tra lại.">↻ trước: ${REL[x.prevRelation][0]}</span>` : ''}</td>${['method', 'problem', 'domain', 'data'].map((f) => `<td>${src(x, f, dash(x[f]))}</td>`).join('')}<td>${diff}</td></tr>`;
    }).join('')}
    </tbody></table></div>${missing ? `<div class="rm-fill"><span class="hint">${missing} bài chưa được so sánh (nằm cuối bảng)${comp.some((x) => x.retried) ? '; một số bài đã thử lại nhưng Semantic Scholar không có đủ thông tin' : ''}.</span>
      <label class="row hint rm-pick-all" title="Tick / bỏ tick mọi bài chưa so sánh"><input type="checkbox" data-rm-pick-all style="width:auto"> Chọn tất cả</label>
      <button class="sm" data-rm-fill-sel disabled title="Chỉ so sánh các bài đã tick ở cột Bài">So sánh 0 bài đã chọn</button>
      <button class="sm primary" data-rm-fill title="Lấy thêm tóm tắt đầy đủ, TLDR, lĩnh vực của các bài này từ Semantic Scholar rồi nhờ mô hình so sánh riêng chúng với bài gốc. Một lượt gọi mô hình, không làm lại cả bản đồ.">🔎 Tự tìm và so sánh tất cả ${missing} bài</button></div>` : ''}` : '';

  const cov = cleanCoverage(d.coverage || []);
  const covTable = cov.length ? `<div class="table-wrap rm-wrap"><table class="data rm-cov"><thead><tr><th>Khía cạnh</th><th>Loại</th><th title="Bài gốc có cover khía cạnh này không: ✓ có · ◐ một phần · – chưa">P</th><th>Bài đã cover</th><th>Cover tới đâu</th></tr></thead><tbody data-st-body="cov">
    ${cov.map((x, i) => { const mk = MAIN[x.main] ? x.main : 'no'; const [sym, cls, tip0] = MAIN[mk]; const tip = x.mainNote ? `${tip0} (${x.mainNote})` : tip0; return `<tr data-idx="${i}" data-keys="dim:${DIM[x.dimension] ? x.dimension : 'other'} main:${mk}"><td><b>${escapeHtml(x.aspect)}</b></td><td>${dimBadge(x.dimension, 'cov')}</td><td class="rm-mainc"><span class="rm-sym rm-tag ${cls}" data-st="cov" data-sk="main:${mk}" data-label="${tip}" title="${tip}${SORT_HINT}">${sym}</span></td><td>${chips(x.papers) || '<span class="hint">chưa có bài khác</span>'}</td><td>${linkify(x.note || '')}</td></tr>`; }).join('')}
    </tbody></table></div>` : '';

  const dirGaps = (d.directions || []).map((x) => directionGaps(x, d.gaps));
  const gapItem = (x, i) => {
    const st = x.status === 'open' ? 'open' : 'partial';
    const solvers = dirGaps.map((g, k) => (g.includes(i) ? k : -1)).filter((k) => k >= 0);
    const fromMain = (x.papers || []).includes('P');
    const others = (x.papers || []).filter((c) => c !== 'P');
    const statusBadge = `<span class="badge rm-tag ${st === 'open' ? 'err' : 'warn'}" data-st="gap" data-sk="status:${st}" title="${GAP_TIP[st]}${SORT_HINT}">${st === 'open' ? 'Còn bỏ ngỏ' : 'Mới giải quyết một phần'}</span>`;
    return `<li class="rm-gap rm-gap-${st}" id="rm-gap-${i}" data-idx="${i}" data-keys="dim:${DIM[x.dimension] ? x.dimension : 'other'} status:${st}">
      <span class="rm-gap-n">G${i + 1}</span>
      <div class="rm-gap-body">
        <div class="rm-gap-title">${escapeHtml(x.gap)}</div>
        ${x.evidence ? `<div class="rm-gap-ev">${linkify(x.evidence)}</div>` : ''}
        <div class="rm-gap-meta">${dimBadge(x.dimension, 'gap')}${statusBadge}
          ${fromMain ? '<span class="rm-gap-src" title="Vấn đề được rút ra từ phần giới hạn do chính bài gốc (P) nêu">Căn cứ: <b>Giới hạn bài gốc</b></span>' : ''}
          ${others.length ? `<span class="rm-gap-src" title="Các bài đã chạm tới vấn đề này nhưng chưa giải quyết trọn vẹn">Bài đã chạm tới: ${chips(others)}</span>` : ''}
          ${solvers.length ? `<span class="rm-gap-src">Hướng đề xuất: ${solvers.map((k) => `<button type="button" class="rm-jump rm-jump-dir" data-jump="rm-dir-${k}" title="${escapeHtml(d.directions[k].title)}">${k + 1}</button>`).join('')}</span>` : ''}</div>
      </div></li>`;
  };
  const gaps = (d.gaps || []).length ? `<ul class="rm-gaps" data-st-body="gap">${d.gaps.map(gapItem).join('')}</ul>` : '';

  const dirs = (d.directions || []).length ? `<div class="rm-dirs">${d.directions.map((x, i) => { const [nl, nc] = NOVEL[x.novelty] || NOVEL.moderate; return `<article class="rm-dir" id="rm-dir-${i}"><div class="rm-dir-h"><span class="rm-dir-n">${i + 1}</span><h4>${escapeHtml(x.title)}</h4><span class="badge rm-tag ${nc}" title="${escapeHtml(NOVEL_TIP[x.novelty] || NOVEL_TIP.moderate)}">${nl}</span></div>
      <p>${linkify(x.idea || '')}</p>
      ${x.gap || dirGaps[i].length ? `<div class="rm-kv"><span>Giải quyết</span><div>${dirGaps[i].map((g) => `<button type="button" class="rm-jump rm-jump-gap" data-jump="rm-gap-${g}" title="${escapeHtml(d.gaps[g].gap)}">G${g + 1}</button>`).join('')} ${linkify(x.gap || '')}</div></div>` : ''}
      ${(x.builds_on || []).length ? `<div class="rm-kv"><span>Dựa trên</span><div>${chips(x.builds_on)}</div></div>` : ''}
      ${x.first_step ? `<div class="rm-kv"><span>Bước đầu</span><div>${linkify(x.first_step)}</div></div>` : ''}
      ${x.risk ? `<div class="rm-kv"><span>Rủi ro</span><div>${linkify(x.risk)}</div></div>` : ''}
      ${x.fit ? `<div class="rm-kv rm-fit"><span>Với đề tài của bạn</span><div>${linkify(x.fit)}</div></div>` : ''}</article>`; }).join('')}</div>` : '';

  // Danh sách mọi bài đã đưa cho mô hình, để biết bản đồ dựa trên những bài nào.
  const group = (rel, label) => { const list = (map.papers || []).filter((x) => x.relation === rel); return list.length ? `<div class="rm-src"><span class="rm-src-k">${label} (${list.length})</span>${list.map((x) => `<span class="rm-src-i">${chip(x.id)} ${titleHtml(x.title)}${x.date ? ` <span class="hint">${escapeHtml(x.date)}</span>` : ''}</span>`).join('')}</div>` : ''; };
  const sources = `${group('ref', 'Bài gốc dẫn')}${group('cit', 'Dẫn bài gốc')}${group('pin', 'Bạn chọn thêm')}`;

  return `${d.overview ? `<p class="wn-overview">${linkify(d.overview)}</p>` : ''}${lineage}
    ${sec('So sánh các bài', 'Phương pháp, bài toán, domain, dữ liệu và điểm khác bài gốc · dòng P là đóng góp riêng của bài gốc', compTable ? legendHtml(map) + sortBar('cmp') + compTable : '')}
    ${sec('Các nghiên cứu đã cover những khía cạnh nào', 'Cột P: bài gốc có cover không (✓ có · ◐ một phần · – chưa) · cột “Bài đã cover”: các nghiên cứu khác · bấm nhãn loại hoặc ✓ ◐ – để đưa lên đầu', covTable ? sortBar('cov') + covTable : '')}
    ${sec('Còn bỏ ngỏ', 'Vấn đề chưa nghiên cứu nào trong danh sách giải quyết trọn vẹn · bấm nhãn để đưa lên đầu', gaps ? sortBar('gap') + gaps : '')}
    ${sec('Hướng nghiên cứu tiếp theo', 'Xếp theo mức đáng làm, mỗi hướng bám vào một vấn đề còn bỏ ngỏ', dirs)}
    ${sources ? `<details class="rm-sources"><summary>Các bài đã đọc để lập bản đồ (${(map.papers || []).length})</summary>${sources}</details>` : ''}`;
}

export function researchMapMarkdown(paper, map) {
  const byId = Object.fromEntries((map.papers || []).map((x) => [x.id, x]));
  const refs = (l) => (l || []).map((id) => `[${id}]`).join('');
  const d = map.data || {};
  const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
  const count = (rel) => map.papers.filter((x) => x.relation === rel).length;
  const out = [`# Hướng nghiên cứu: ${paper.title}`, '', `_So sánh bài gốc [P] với ${count('ref')} bài được dẫn [R], ${count('cit')} bài dẫn nó [C]${count('pin') ? ` và ${count('pin')} bài tự chọn [S]` : ''}, ${new Date(map.at).toLocaleDateString('vi-VN')}._`, ''];
  if (d.overview) out.push(d.overview, '');
  if (d.lineage?.foundations || d.lineage?.developments) out.push('## Dòng nghiên cứu', '', `- **Nền tảng:** ${d.lineage.foundations}`, `- **Phát triển sau:** ${d.lineage.developments}`, '');
  if ((d.comparison || []).length) {
    out.push('## So sánh các bài', '', '| Bài | Quan hệ | Phương pháp | Bài toán / gap | Domain | Dữ liệu / benchmark | Khác biệt |', '|---|---|---|---|---|---|---|');
    for (const x of withMainRow(d.comparison, paper)) out.push(`| [${x.paper}] ${cell(x.paper === 'P' ? paper.title : byId[x.paper]?.title)} | ${(REL[x.relation] || REL.related)[0]} | ${cell(x.method)} | ${cell(x.problem)} | ${cell(x.domain)} | ${cell(x.data)} | ${x.missing ? '(chưa so sánh)' : `${x.paper === 'P' ? 'Đóng góp riêng: ' : ''}${cell(x.difference)}`} |`);
    out.push('');
  }
  if ((d.coverage || []).length) {
    out.push('## Các nghiên cứu đã cover những khía cạnh nào', '', '| Khía cạnh | Loại | Bài gốc | Bài đã cover | Ghi chú |', '|---|---|---|---|---|');
    for (const x of cleanCoverage(d.coverage)) out.push(`| ${cell(x.aspect)} | ${DIM[x.dimension] || ''} | ${(MAIN[x.main] || MAIN.no)[2]}${x.mainNote ? ` (${x.mainNote})` : ''} | ${refs(x.papers)} | ${cell(x.note)} |`);
    out.push('');
  }
  if ((d.gaps || []).length) { out.push('## Còn bỏ ngỏ', ''); d.gaps.forEach((x, i) => out.push(`- **G${i + 1}. ${x.gap}** (${x.status === 'open' ? 'còn bỏ ngỏ' : 'một phần'}, ${DIM[x.dimension] || ''}) ${refs(x.papers)}${x.evidence ? `: ${x.evidence}` : ''}`)); out.push(''); }
  if ((d.directions || []).length) {
    out.push('## Hướng nghiên cứu tiếp theo', '');
    d.directions.forEach((x, i) => {
      out.push(`### ${i + 1}. ${x.title} (${(NOVEL[x.novelty] || NOVEL.moderate)[0]})`, '', x.idea || '', '');
      if (x.gap) out.push(`- **Giải quyết:** ${x.gap}`);
      if ((x.builds_on || []).length) out.push(`- **Dựa trên:** ${refs(x.builds_on)}`);
      if (x.first_step) out.push(`- **Bước đầu:** ${x.first_step}`);
      if (x.risk) out.push(`- **Rủi ro:** ${x.risk}`);
      if (x.fit) out.push(`- **Với đề tài của bạn:** ${x.fit}`);
      out.push('');
    });
  }
  out.push('## Danh sách bài', '');
  for (const x of map.papers) out.push(`- [${x.id}] ${x.title}${x.date ? ` (${x.date})` : ''}${x.arxiv ? ` https://arxiv.org/abs/${x.arxiv}` : (x.doi ? ` https://doi.org/${x.doi}` : '')}`);
  return out.join('\n');
}

/* ---------- Trạng thái "so sánh với bài gốc" của một bài (dùng ở tab Liên quan, thẻ mã bài, đồ thị 3D) ---------- */

/**
 * { code, rel, pinned }: code là mã bài trong bảng so sánh hiện có (R3, C1, S2…) hoặc '' nếu chưa có;
 * pinned: bài đã được chọn để so sánh (sẽ vào bảng ở lần Cập nhật tới).
 */
export function compareState(paper, o) {
  if (!paper || !o) return { code: '', rel: '', pinned: false };
  const key = pinKey(o);
  const hit = (paper.researchMap?.papers || []).find((x) => (x.key || pinKey(x)) === key);
  return { code: hit?.id || '', rel: hit?.relation || '', pinned: (paper.researchPins || []).some((x) => x.key === key) };
}

const REL_CHIP = { ref: 'rm-ref', cit: 'rm-cit', pin: 'rm-pin' };

/** Nhãn trạng thái cho dòng thông tin của bài. */
export function compareBadgeHtml(st) {
  if (st.code) return `<span class="rm-in" title="Bài này có trong bảng So sánh của tab Hướng nghiên cứu với mã ${st.code}"><span class="wn-chip ${REL_CHIP[st.rel] || ''}">${st.code}</span>Trong bảng so sánh</span>`;
  if (st.pinned) return '<span class="rm-in rm-in-wait" title="Đã chọn để so sánh; bấm Cập nhật ở tab Hướng nghiên cứu để đưa vào bảng">⇄ Đã chọn so sánh · chờ Cập nhật</span>';
  return '';
}

/** Nút so sánh theo trạng thái. attr: thuộc tính để gắn sự kiện (ví dụ 'data-cmp'). */
export function compareButtonHtml(st, attr, { long = false } = {}) {
  if (st.code) return `<button type="button" class="sm on" ${attr} data-cmp-go="1" title="Đã có trong bảng so sánh (${st.code}). Bấm để mở tab Hướng nghiên cứu.">✓ Đã so sánh · ${st.code}</button>`;
  if (st.pinned) return `<button type="button" class="sm on" ${attr} title="Đã chọn để so sánh, chờ Cập nhật ở tab Hướng nghiên cứu. Bấm để bỏ chọn.">✓ Đã chọn${long ? ' so sánh' : ''}</button>`;
  return `<button type="button" class="sm ${long ? '' : 'ghost'}" ${attr} title="Đưa bài này vào tab Hướng nghiên cứu để so sánh với bài gốc">⇄ So sánh${long ? ' với bài gốc' : ''}</button>`;
}
