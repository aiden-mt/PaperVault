// "Có gì mới kể từ bài này": đọc các paper dẫn bài gốc (abstract hoặc TLDR, kèm câu trích dẫn nguyên văn) rồi nhờ
// mô hình tổng hợp: giới hạn nào của bài gốc đã được giải quyết, kết quả mới trên cùng dataset, hướng mở rộng, phản biện.
// Chỉ một lượt gọi mô hình với vài chục bản tóm tắt ngắn, rẻ hơn một lần trích xuất. Kết quả lưu trong paper.whatsNew.
import { api } from './api.js';
import { store, savePaper, paperById } from './store.js';
import { complete } from './llm.js';
import { parseLooseJson, escapeHtml } from './util.js';
import { titleHtml, plainTitle, rich } from './richtext.js';
import { normalizeExtraction, splitLimitations } from './schema.js';
import { unverifiedNumbers } from './quality.js';
import { s2Ident, pubTime, fmtPub, citeRole, ROLE_LABELS, ctxQuotes } from './s2util.js';
import { compareButtonHtml, compareBadgeHtml } from './research.js';

const MAX_PAPERS = 30;

/** Chọn bài đáng đưa cho mô hình: bài kế thừa hoặc so sánh kết quả và bài ảnh hưởng lớn trước, rồi tới bài mới. */
function pickPapers(items) {
  const w = { result: 3, method: 3, mention: 1, unknown: 0 };
  return items
    .map((it) => ({ it, role: citeRole(it) }))
    .filter((x) => x.it.tldr || x.it.abstract || x.it._contexts?.length)
    .sort((a, b) => (w[b.role.role] + (b.it._influential ? 2 : 0)) - (w[a.role.role] + (a.it._influential ? 2 : 0)) || pubTime(b.it) - pubTime(a.it))
    .slice(0, MAX_PAPERS);
}

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['overview', 'addressed_limits', 'new_results', 'extensions', 'challenges', 'reading_list'],
  properties: {
    overview: { type: 'string', description: '3-5 câu: sau bài gốc, hướng nghiên cứu này đã đi tới đâu.' },
    addressed_limits: {
      type: 'array', description: 'Mỗi giới hạn L1, L2… của bài gốc một mục, theo đúng thứ tự.',
      items: {
        type: 'object', additionalProperties: false, required: ['limit', 'status', 'how', 'papers'],
        properties: {
          limit: { type: 'string', description: 'Mã giới hạn, ví dụ "L2".' },
          status: { type: 'string', enum: ['addressed', 'partial', 'not_found'], description: 'addressed: có bài nói rõ đã khắc phục; partial: khắc phục một phần hoặc trong điều kiện hẹp; not_found: không thấy bài nào trong danh sách.' },
          how: { type: 'string', description: 'Bài sau khắc phục bằng cách nào. Rỗng khi not_found.' },
          papers: { type: 'array', items: { type: 'string' }, description: 'Mã bài, ví dụ ["C3", "C7"].' },
        },
      },
    },
    new_results: {
      type: 'array', description: 'Kết quả mới trên cùng dataset hoặc metric với bài gốc, chỉ khi bản tóm tắt có nêu.',
      items: {
        type: 'object', additionalProperties: false, required: ['dataset', 'metric', 'number', 'claim', 'papers'],
        properties: {
          dataset: { type: 'string' }, metric: { type: 'string' },
          number: { type: 'string', description: 'Con số chép nguyên văn từ tài liệu, rỗng nếu tài liệu không nêu số.' },
          claim: { type: 'string', description: 'Bài sau tuyên bố gì so với bài gốc hoặc so với state of the art.' },
          papers: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    extensions: {
      type: 'array', description: 'Hướng mở rộng: áp dụng sang bài toán, dữ liệu, modality khác, hoặc cải tiến một thành phần.',
      items: { type: 'object', additionalProperties: false, required: ['direction', 'detail', 'papers'], properties: { direction: { type: 'string' }, detail: { type: 'string' }, papers: { type: 'array', items: { type: 'string' } } } },
    },
    challenges: {
      type: 'array', description: 'Bài chỉ ra điểm yếu, phản biện, hoặc cho kết quả ngược với bài gốc. Mảng rỗng nếu không có.',
      items: { type: 'object', additionalProperties: false, required: ['point', 'papers'], properties: { point: { type: 'string' }, papers: { type: 'array', items: { type: 'string' } } } },
    },
    reading_list: {
      type: 'array', description: '3-5 bài nên đọc tiếp, xếp theo mức đáng đọc.',
      items: { type: 'object', additionalProperties: false, required: ['paper', 'why'], properties: { paper: { type: 'string' }, why: { type: 'string' } } },
    },
  },
};

function buildPrompt(paper, picked, lang) {
  const e = normalizeExtraction(paper.extraction);
  const { stated, observed } = splitLimitations(e.limitation?.items);
  const limits = [...stated, ...observed, e.limitation?.unresolved].filter((x) => String(x || '').trim());
  const metrics = (e.validation?.metrics || []).filter((m) => m?.name).map((m) => `${m.name} trên ${m.dataset || '?'}: ${m.proposed || '?'}`);
  const out = lang === 'en' ? 'English' : 'tiếng Việt';
  const system = `Bạn giúp một nhà nghiên cứu cập nhật một hướng nghiên cứu: sau bài gốc, các paper dẫn nó đã làm thêm được gì. Viết bằng ${out}, giữ nguyên thuật ngữ, tên phương pháp, dataset, metric bằng tiếng Anh.

Quy tắc:
- Chỉ dùng thông tin trong danh sách paper được cung cấp (tiêu đề, câu trích dẫn, tóm tắt). Không bổ sung kiến thức ngoài, không đoán nội dung bài từ tiêu đề.
- Mỗi ý phải ghi mã bài nguồn (C1, C2…) đúng như trong danh sách.
- Con số phải chép nguyên văn từ tài liệu. Tài liệu không nêu số thì để number rỗng.
- Một giới hạn chỉ được coi là đã giải quyết khi tóm tắt hoặc câu trích dẫn nói rõ điều đó. Chỉ cùng chủ đề thì chưa đủ.
- Câu trích dẫn do máy bóc nên có thể lệch, chỉ khẳng định điều câu đó thật sự chứa.
- Viết cụ thể: bài sau làm gì, bằng cơ chế nào, khác bài gốc ở đâu. Không viết câu chung chung kiểu "cải thiện hiệu suất".`;
  const user = [
    '## Bài gốc',
    `Tiêu đề: ${paper.title}`,
    e.year ? `Năm: ${e.year}` : null,
    e.one_liner ? `Tóm tắt: ${e.one_liner}` : null,
    e.key_idea?.summary ? `Ý tưởng chính: ${e.key_idea.summary}` : null,
    (e.validation?.datasets || []).length ? `Dataset: ${e.validation.datasets.join(', ')}` : null,
    metrics.length ? `Kết quả chính: ${metrics.join('; ')}` : null,
    '',
    '## Giới hạn của bài gốc',
    limits.length ? limits.map((x, i) => `L${i + 1}. ${x}`).join('\n') : '(Ghi chú chưa có mục giới hạn. Trả addressed_limits là mảng rỗng.)',
    '',
    `## Các paper dẫn bài gốc (${picked.length} bài)`,
    ...picked.map((x, i) => {
      const it = x.it;
      const ctx = (it._contexts || []).slice().sort((a, b) => b.length - a.length).slice(0, 2).map((c) => `  Câu trích dẫn: "${c.slice(0, 400)}"`);
      return [`[C${i + 1}] ${it.title}${fmtPub(it) ? ` (${fmtPub(it)})` : ''}${it.venue ? ` · ${it.venue}` : ''} · vai: ${ROLE_LABELS.citations[x.role.role]}${it._influential ? ' · ảnh hưởng lớn' : ''}`,
        ...ctx, `  Tóm tắt: ${(it.tldr || it.abstract || '(không có)').replace(/\s+/g, ' ').slice(0, 700)}`].join('\n');
    }),
  ].filter((x) => x != null).join('\n');
  return { system, user, nLimits: limits.length, limits };
}

const jobs = new Map();
export const whatsNewJob = (paperId) => jobs.get(paperId) || null;

/** Tạo (hoặc cập nhật) bản tóm tắt. Chạy nền như bài giảng: rời tab vẫn chạy tiếp và tự lưu. */
export function buildWhatsNew(paperId) {
  const running = jobs.get(paperId);
  if (running && !running.done) return running;
  const job = { status: 'Đang chuẩn bị…', step: 0, of: 2, done: false, error: '', listeners: new Set() };
  const emit = (status, step) => { if (status) job.status = status; if (step != null) job.step = step; for (const fn of [...job.listeners]) { try { fn(job); } catch (_) { /* tab đã đóng */ } } };
  jobs.set(paperId, job);
  (async () => {
    const paper = paperById(paperId);
    const ident = s2Ident(paper);
    if (!ident) throw new Error('Paper chưa có arXiv ID, DOI hoặc link nên không tra được bài dẫn.');
    emit('Đang lấy danh sách paper dẫn bài này từ Semantic Scholar…', 0);
    const r = await api.s2Citations(ident, true);
    const items = r.items || [];
    if (!items.length) throw new Error('Semantic Scholar chưa ghi nhận paper nào dẫn bài này.');
    const picked = pickPapers(items);
    if (!picked.length) throw new Error('Các paper dẫn bài này chưa có tóm tắt hay câu trích dẫn để đọc.');
    const settings = store.settings;
    const lang = settings.language === 'en' ? 'en' : 'vi';
    const { system, user, limits } = buildPrompt(paper, picked, lang);
    emit(`Đang nhờ ${settings.provider}/${settings.models?.[settings.provider]} đọc ${picked.length} bài…`, 1);
    const out = await complete({
      settings, system, user, schema: SCHEMA, schemaName: 'whats_new', task: 'whats-new', paperId,
      maxTokens: 6000, effort: ['high', 'xhigh', 'max'].includes(settings.effort) ? 'medium' : settings.effort,
      onRetry: (n, wait) => emit(`Bị giới hạn tốc độ, thử lại lần ${n} sau ${Math.round(wait / 1000)}s…`),
    });
    const data = parseLooseJson(out.text);
    if (!data || typeof data !== 'object') throw new Error('Mô hình không trả về kết quả đọc được, hãy thử lại.');
    // Mã bài phải có thật trong danh sách đã gửi; mã lạ thì bỏ.
    const valid = new Set(picked.map((_, i) => `C${i + 1}`));
    const clean = (arr) => (Array.isArray(arr) ? arr : []).map((x) => ({ ...x, papers: (x.papers || []).map((s) => String(s).replace(/[[\]\s]/g, '')).filter((s) => valid.has(s)) }));
    const result = {
      overview: String(data.overview || ''),
      addressed_limits: clean(data.addressed_limits).map((x) => ({ ...x, text: limits[Number(String(x.limit).replace(/\D/g, '')) - 1] || '' })),
      new_results: clean(data.new_results), extensions: clean(data.extensions), challenges: clean(data.challenges),
      reading_list: (Array.isArray(data.reading_list) ? data.reading_list : []).map((x) => ({ ...x, paper: String(x.paper || '').replace(/[[\]\s]/g, '') })).filter((x) => valid.has(x.paper)),
    };
    // Con số phải có trong tài liệu đã gửi.
    const nums = unverifiedNumbers(result.new_results.map((x) => `${x.number} ${x.claim}`).join('\n'), user);
    const wn = {
      at: new Date().toISOString(), model: out.model, provider: out.provider, lang,
      total: items.length, newestAt: Math.max(...items.map(pubTime)),
      papers: picked.map((x, i) => ({
        id: `C${i + 1}`, paperId: x.it.paperId, title: x.it.title, date: fmtPub(x.it), role: x.role.role, influential: !!x.it._influential,
        arxiv: x.it.externalIds?.ArXiv || '', doi: x.it.externalIds?.DOI || '', url: x.it.url || '',
        authors: (x.it.authors || []).slice(0, 4).map((a) => a.name).join(', '), venue: x.it.venue || '', citations: x.it.citationCount || 0,
        contexts: (x.it._contexts || []).slice(0, 2), tldr: x.it.tldr || '', abstract: (x.it.abstract || '').slice(0, 400),
      })),
      data: result, unverified: nums,
    };
    await savePaper({ ...paperById(paperId), whatsNew: wn });
    return wn;
  })().then(() => { job.done = true; emit('Xong.'); }, (e) => { job.done = true; job.error = e.message || String(e); emit(); });
  return job;
}

export async function removeWhatsNew(paperId) {
  jobs.delete(paperId);
  return savePaper({ ...paperById(paperId), whatsNew: null });
}

/* ---------- Hiển thị ---------- */

const STATUS = { addressed: ['Đã giải quyết', 'ok'], partial: ['Giải quyết một phần', 'warn'], not_found: ['Chưa thấy bài nào', ''] };

export function whatsNewHtml(wn) {
  const byId = Object.fromEntries((wn.papers || []).map((x) => [x.id, x]));
  const chip = (id) => {
    const x = byId[id];
    if (!x) return '';
    const link = x.arxiv ? `https://arxiv.org/abs/${x.arxiv}` : (x.doi ? `https://doi.org/${x.doi}` : x.url);
    return `<button type="button" class="wn-chip" data-wn="${id}" title="${escapeHtml(`${plainTitle(x.title)}${x.date ? ` · ${x.date}` : ''}`)} · bấm để xem chi tiết">${id}</button>`;
  };
  const chips = (ids) => (ids || []).map(chip).join('');
  const d = wn.data || {};
  const sec = (title, body) => (body ? `<div class="wn-sec"><h3>${title}</h3>${body}</div>` : '');
  return `${d.overview ? `<p class="wn-overview">${escapeHtml(d.overview)}</p>` : ''}
    ${sec('Giới hạn của bài gốc', (d.addressed_limits || []).length ? `<ul class="wn-list">${d.addressed_limits.map((x) => {
      const [label, cls] = STATUS[x.status] || STATUS.not_found;
      return `<li><span class="badge ${cls}">${label}</span> <b>${escapeHtml(x.limit)}</b>${x.text ? ` <span class="hint">${escapeHtml(x.text)}</span>` : ''}${x.how ? `<div>${escapeHtml(x.how)} ${chips(x.papers)}</div>` : ''}</li>`;
    }).join('')}</ul>` : '')}
    ${sec('Kết quả mới trên cùng dataset', (d.new_results || []).length ? `<div class="table-wrap"><table class="wn-table"><thead><tr><th>Dataset</th><th>Metric</th><th>Kết quả</th><th>Bài</th></tr></thead><tbody>${d.new_results.map((x) => `<tr><td>${escapeHtml(x.dataset)}</td><td>${escapeHtml(x.metric)}</td><td>${x.number ? `<b>${escapeHtml(x.number)}</b> · ` : ''}${escapeHtml(x.claim)}</td><td>${chips(x.papers)}</td></tr>`).join('')}</tbody></table></div>${wn.unverified?.length ? `<p class="hint">⚠ Con số không thấy trong tài liệu đã gửi, nên đối chiếu lại: ${wn.unverified.map((n) => `<b>${escapeHtml(n)}</b>`).join(', ')}</p>` : ''}` : '')}
    ${sec('Hướng mở rộng', (d.extensions || []).length ? `<ul class="wn-list">${d.extensions.map((x) => `<li><b>${escapeHtml(x.direction)}</b> ${chips(x.papers)}<div>${escapeHtml(x.detail)}</div></li>`).join('')}</ul>` : '')}
    ${sec('Phản biện hoặc kết quả ngược', (d.challenges || []).length ? `<ul class="wn-list">${d.challenges.map((x) => `<li>${escapeHtml(x.point)} ${chips(x.papers)}</li>`).join('')}</ul>` : '')}
    ${sec('Nên đọc tiếp', (d.reading_list || []).length ? `<ol class="wn-list">${d.reading_list.map((x) => { const p = byId[x.paper]; return `<li><span class="wn-read-t">${chip(x.paper)} ${titleHtml(p?.title || '')}</span><button class="sm" data-wn-add="${escapeHtml(x.paper)}">+ Thêm</button><div class="hint">${escapeHtml(x.why)}</div></li>`; }).join('')}</ol>` : '')}`;
}

/** Truy vấn cho trang Thêm paper từ một mã bài C1, C2… */
export function addQueryOf(wn, id) {
  const x = (wn.papers || []).find((p) => p.id === id);
  if (!x) return '';
  return x.arxiv ? `arXiv:${x.arxiv}` : (x.doi || x.url || x.title);
}

export function whatsNewMarkdown(paper, wn) {
  const byId = Object.fromEntries((wn.papers || []).map((x) => [x.id, x]));
  const refs = (ids) => (ids || []).map((id) => `[${id}]`).join('');
  const d = wn.data || {};
  const out = [`# Có gì mới kể từ: ${paper.title}`, '', `_Tổng hợp từ ${wn.papers.length}/${wn.total} paper dẫn bài này, ${new Date(wn.at).toLocaleDateString('vi-VN')}._`, ''];
  if (d.overview) out.push(d.overview, '');
  if ((d.addressed_limits || []).length) { out.push('## Giới hạn của bài gốc', ''); for (const x of d.addressed_limits) out.push(`- **${x.limit}** (${(STATUS[x.status] || STATUS.not_found)[0]})${x.text ? ` ${x.text}` : ''}${x.how ? `: ${x.how} ${refs(x.papers)}` : ''}`); out.push(''); }
  if ((d.new_results || []).length) { out.push('## Kết quả mới', '', '| Dataset | Metric | Kết quả | Bài |', '|---|---|---|---|'); for (const x of d.new_results) out.push(`| ${x.dataset} | ${x.metric} | ${x.number ? `${x.number} · ` : ''}${x.claim} | ${refs(x.papers)} |`); out.push(''); }
  if ((d.extensions || []).length) { out.push('## Hướng mở rộng', ''); for (const x of d.extensions) out.push(`- **${x.direction}** ${refs(x.papers)}: ${x.detail}`); out.push(''); }
  if ((d.challenges || []).length) { out.push('## Phản biện hoặc kết quả ngược', ''); for (const x of d.challenges) out.push(`- ${x.point} ${refs(x.papers)}`); out.push(''); }
  if ((d.reading_list || []).length) { out.push('## Nên đọc tiếp', ''); d.reading_list.forEach((x, i) => out.push(`${i + 1}. [${x.paper}] ${byId[x.paper]?.title || ''}: ${x.why}`)); out.push(''); }
  out.push('## Danh sách bài', '');
  for (const x of wn.papers) out.push(`- [${x.id}] ${x.title}${x.date ? ` (${x.date})` : ''}${x.arxiv ? ` https://arxiv.org/abs/${x.arxiv}` : (x.doi ? ` https://doi.org/${x.doi}` : '')}`);
  return out.join('\n');
}

/* ---------- Thẻ chi tiết khi bấm mã C1, C2… ---------- */

const ROLE_TEXT = { method: 'Kế thừa phương pháp', result: 'So sánh kết quả', mention: 'Chỉ nhắc tới', unknown: 'Chưa rõ' };
const linkOfPaper = (x) => (x.arxiv ? `https://arxiv.org/abs/${x.arxiv}` : (x.doi ? `https://doi.org/${x.doi}` : x.url));
const libMatch = (x) => {
  const t = plainTitle(x.title).toLowerCase();
  return store.papers.find((p) => (x.arxiv && p.arxivId && p.arxivId.replace(/v\d+$/, '') === x.arxiv)
    || (x.paperId && p.s2Id === x.paperId) || (x.doi && p.doi && p.doi.toLowerCase() === x.doi.toLowerCase()) || (t && plainTitle(p.title).toLowerCase() === t));
};

/**
 * Gắn thẻ chi tiết cho các mã C1, C2… trong bản tóm tắt. Bản tóm tắt tạo trước đây chưa lưu tác giả, câu trích dẫn, TLDR:
 * lấy bổ sung từ danh sách bài dẫn đã lưu đệm (loadExtra trả về Map paperId -> bài Semantic Scholar).
 */
export function bindWhatsNewChips(root, wn, { loadExtra = null, onCompare = null, compareOf = null } = {}) {
  let pop = null;
  let extra = null;
  const close = () => { pop?.remove(); pop = null; document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onKey, true); };
  const outside = (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('.wn-chip')) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };

  const render = (x, more) => {
    const it = more || {};
    const authors = x.authors || (it.authors || []).slice(0, 4).map((a) => a.name).join(', ');
    const venue = x.venue || it.venue || '';
    const cites = x.citations ?? it.citationCount ?? null;
    const contexts = (x.contexts && x.contexts.length ? x.contexts : (it._contexts || []).slice(0, 2));
    const tldr = x.tldr || it.tldr || '';
    const abs = x.abstract || (it.abstract || '').slice(0, 400);
    const lib = libMatch(x);
    const link = linkOfPaper(x);
    return `<button class="ghost sm wn-pop-x" title="Đóng">✕</button>
      <h3>${titleHtml(x.title)}</h3>
      <div class="hint">${escapeHtml([authors, x.date, venue].filter(Boolean).join(' · '))}</div>
      ${compareOf ? `<div class="wn-pop-cmp">${compareBadgeHtml(compareOf(x))}</div>` : ''}
      <div class="wn-pop-badges"><span class="badge">${x.id}</span>${x.relation ? `<span class="badge">${x.relation === 'ref' ? 'Bài gốc dẫn' : 'Dẫn bài gốc'}</span>` : ''}<span class="badge role-${x.role || 'unknown'}">${x.roleText || ROLE_TEXT[x.role] || ROLE_TEXT.unknown}</span>${x.influential ? '<span class="badge accent">ảnh hưởng lớn</span>' : ''}${cites != null ? `<span class="badge">↗ ${cites} trích dẫn</span>` : ''}${lib ? '<span class="badge ok">đã có trong thư viện</span>' : ''}</div>
      ${ctxQuotes(contexts, x.relation === 'ref' ? 'main' : 'other', { max: 3 })}
      ${tldr || abs ? `<p class="wn-pop-abs">${tldr ? '<span class="badge">TLDR</span> ' : ''}${rich(tldr || abs)}</p>` : ''}
      ${!more && !x.authors && loadExtra ? '<div class="hint" data-wn-loading>Đang lấy thêm thông tin…</div>' : ''}
      <div class="row wrap" style="gap:6px;margin-top:8px">
        ${link ? `<a class="btn sm" href="${escapeHtml(link)}" target="_blank" rel="noopener">Mở link</a>` : ''}
        ${lib ? `<a class="btn sm" href="#/paper/${lib.id}">Mở trong thư viện</a>` : `<button class="sm primary" data-wn-add-pop>+ Thêm vào thư viện</button>`}
        ${onCompare && compareOf ? compareButtonHtml(compareOf(x), 'data-wn-cmp', { long: true }) : ''}
      </div>`;
  };

  root.addEventListener('click', async (e) => {
    const chipEl = e.target.closest('.wn-chip[data-wn]');
    if (!chipEl) return;
    e.preventDefault();
    const x = (wn.papers || []).find((p) => p.id === chipEl.dataset.wn);
    if (!x) return;
    close();
    pop = document.createElement('div');
    pop.className = 'wn-pop';
    pop.innerHTML = render(x, null);
    document.body.appendChild(pop);
    // Đặt thẻ cạnh mã vừa bấm, không tràn khỏi cửa sổ.
    const place = () => {
      if (!pop) return;
      const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
      const r = chipEl.getBoundingClientRect();
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      const vw = window.innerWidth / z;
      const vh = window.innerHeight / z;
      let left = r.right / z + 8;
      if (left + w > vw - 8) left = Math.max(8, r.left / z - w - 8);
      let top = r.top / z - 10;
      if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
    };
    const wire = () => {
      pop.querySelector('.wn-pop-x').addEventListener('click', close);
      pop.querySelector('[data-wn-add-pop]')?.addEventListener('click', () => { const q = x.arxiv ? `arXiv:${x.arxiv}` : (x.doi || x.url || plainTitle(x.title)); close(); location.hash = `#/add?q=${encodeURIComponent(q)}`; });
      pop.querySelectorAll('a[href^="#/"]').forEach((a) => a.addEventListener('click', close));
      pop.querySelector('[data-wn-cmp]')?.addEventListener('click', async (e) => {
        const go = !!e.currentTarget.dataset.cmpGo;
        if (go) close();
        await onCompare(x, go);
        if (!go && pop) { pop.innerHTML = render(x, extra?.get?.(x.paperId) || null); wire(); place(); }
      });
    };
    wire();
    place();
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey, true);
    if (!x.authors && loadExtra) {
      try {
        extra ||= await loadExtra();
        const more = extra.get(x.paperId);
        if (pop && pop.isConnected) { pop.innerHTML = render(x, more || {}); wire(); place(); }
      } catch (_) {
        pop?.querySelector('[data-wn-loading]')?.remove();
      }
    }
  });
}
