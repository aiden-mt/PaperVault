// Trích dẫn theo APA bản thứ 7 (mục tài liệu tham khảo và trích dẫn trong bài).
// APA chỉ dùng in nghiêng, không dùng in đậm: bài tạp chí và bài hội nghị thì nghiêng tên tạp chí hoặc kỷ yếu,
// còn preprint và tài liệu đứng riêng thì nghiêng chính tiêu đề.
import { escapeHtml } from './util.js';

const PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'dos', 'du', 'la', 'le', 'ter', 'ten', 'bin', 'ibn', 'al', 'el']);
const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

/** Chữ cái đầu của tên riêng: "Jean-Pierre" -> "J.-P.", "J." giữ nguyên. */
const initialOf = (name) => name.split('-').filter(Boolean).map((x) => `${[...x][0].toUpperCase()}.`).join('-');

/** "Xiaoyu Chen" -> { family: "Chen", given: "X." }. Nhận cả dạng "Chen, Xiaoyu" và họ có tiểu từ ("van der Maaten"). */
export function parseAuthor(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').replace(/[*†‡§\d]+$/g, '').trim();
  if (!s) return null;
  let family;
  let given;
  if (s.includes(',')) {
    [family, given = ''] = s.split(',').map((x) => x.trim());
  } else {
    const parts = s.split(' ').filter((x) => !SUFFIX.test(x));
    if (parts.length === 1) return { family: parts[0], given: '' };
    let i = parts.length - 1;
    while (i > 1 && PARTICLES.has(parts[i - 1].toLowerCase())) i -= 1;
    family = parts.slice(i).join(' ');
    given = parts.slice(0, i).join(' ');
  }
  return { family, given: given.split(' ').filter(Boolean).map(initialOf).join(' ') };
}

const nameOf = (a) => (a.given ? `${a.family}, ${a.given}` : a.family);

/** Danh sách tác giả kiểu APA: tới 20 người thì ghi hết, từ 21 người thì 19 người đầu, dấu ba chấm, người cuối. */
export function apaAuthors(list) {
  const a = (list || []).map(parseAuthor).filter(Boolean);
  if (!a.length) return '';
  if (a.length === 1) return nameOf(a[0]);
  if (a.length === 2) return `${nameOf(a[0])}, & ${nameOf(a[1])}`;
  if (a.length <= 20) return `${a.slice(0, -1).map(nameOf).join(', ')}, & ${nameOf(a[a.length - 1])}`;
  return `${a.slice(0, 19).map(nameOf).join(', ')}, . . . ${nameOf(a[a.length - 1])}`;
}

// Từ viết hoa chữ đầu nhưng là tên riêng, không hạ xuống chữ thường khi chuyển tiêu đề sang sentence case.
const PROPER = new Set(['English', 'Chinese', 'Vietnamese', 'Japanese', 'Korean', 'German', 'French', 'Spanish', 'Arabic', 'Hindi', 'Russian', 'European', 'American', 'Asian', 'African',
  'Bayesian', 'Gaussian', 'Markov', 'Markovian', 'Monte', 'Carlo', 'Fourier', 'Lipschitz', 'Hessian', 'Jacobian', 'Kalman', 'Newton', 'Turing', 'Boolean', 'Euclidean', 'Riemannian',
  'Laplacian', 'Wasserstein', 'Hopfield', 'Boltzmann', 'Langevin', 'Dirichlet', 'Poisson', 'Bernoulli', 'Shapley', 'Nash', 'Pareto', 'Hilbert', 'Hebbian', 'Kolmogorov', 'Gibbs', 'Bregman',
  'Python', 'Java', 'Wikipedia', 'Twitter', 'Reddit', 'Google', 'Microsoft', 'Amazon', 'Atari', 'Minecraft', 'Internet', 'Earth', 'Mars', 'Transformer', 'Transformers']);

/**
 * Tiêu đề kiểu sentence case của APA: chỉ viết hoa chữ đầu câu, chữ đầu sau dấu hai chấm, và tên riêng.
 * Từ có chữ hoa ở giữa, toàn chữ hoa, hoặc chứa số (TableVision, LLM, GPT-4) coi là tên riêng nên giữ nguyên.
 */
export function sentenceCase(title) {
  const words = String(title || '').trim().split(/\s+/);
  let startOfSentence = true;
  return words.map((w) => {
    const core = w.replace(/^[("'“‘\[]+|[)"'”’\],.;:!?]+$/g, '');
    const plain = /^[A-Z][a-z]+(?:[-’'][A-Za-z][a-z]*)*$/.test(core);
    let out = w;
    if (plain && !startOfSentence && !PROPER.has(core.split(/[-’']/)[0])) out = w.replace(core, core.toLowerCase());
    else if (startOfSentence && /^[a-z]/.test(core)) out = w.replace(core, core[0].toUpperCase() + core.slice(1));
    startOfSentence = /[:?!—–]$/.test(w) || w === '-';
    return out;
  }).join(' ');
}

function kindOf(paper) {
  const e = paper.extraction || {};
  const t = paper.venueInfo?.type;
  if (t === 'journal') return 'journal';
  if (['conference', 'workshop', 'findings', 'book-chapter', 'book-series'].includes(t)) return 'proceedings';
  if (t === 'preprint') return 'preprint';
  const v = e.venue || '';
  if (/journal|transactions|tpami|letters|review|magazine|nature|science\b/i.test(v)) return 'journal';
  if (/(cvpr|iccv|eccv|neurips|nips|icml|iclr|acl|emnlp|naacl|aaai|ijcai|kdd|www|sigir|conference|proceedings|workshop|symposium)/i.test(v)) return 'proceedings';
  if (paper.arxivId || /arxiv|preprint|biorxiv|medrxiv|openreview/i.test(v)) return 'preprint';
  return v ? 'proceedings' : 'other';
}

const endDot = (s) => (/[.?!]$/.test(s) ? s : `${s}.`);

/**
 * Mục tài liệu tham khảo kiểu APA 7. Trả về { html, text, inText, narrative, kind, missing: [..] }.
 * html dùng <i> cho phần in nghiêng, text là bản không định dạng.
 */
export function apaCitation(paper, { keepTitleCase = false } = {}) {
  const e = paper.extraction || {};
  const kind = kindOf(paper);
  const authors = apaAuthors(e.authors);
  const year = /^\d{4}$/.test(String(e.year || '').trim()) ? String(e.year).trim() : '';
  const date = `(${year || 'n.d.'}).`;
  const title = keepTitleCase ? String(paper.title || '').trim() : sentenceCase(paper.title);
  const arxiv = paper.arxivId ? paper.arxivId.replace(/v\d+$/, '') : '';
  const link = paper.doi ? `https://doi.org/${String(paper.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}` : (arxiv ? `https://arxiv.org/abs/${arxiv}` : (paper.url || ''));
  // Bảng CORE ghi kèm tên cũ kiểu "(was NIPS)", không thuộc tên kỷ yếu.
  const venue = (paper.venueInfo?.name || e.venue || '').replace(/\s*\((was|formerly)\b[^)]*\)/gi, '').replace(/\s+/g, ' ').trim();
  const missing = [];
  if (!authors) missing.push('tác giả');
  if (!year) missing.push('năm');

  // Mỗi phần là [chuỗi, có in nghiêng không].
  const parts = [];
  // Không có tác giả thì tiêu đề lên đầu, ngày theo sau.
  const lead = authors ? [[endDot(authors), false], [date, false]] : null;
  const titlePart = (italic) => [endDot(title), italic];
  if (kind === 'journal') {
    parts.push(...(lead || []), titlePart(false));
    if (!lead) parts.push([date, false]);
    parts.push([venue, true], ['.', false]);
    missing.push('số tập, số kỳ và số trang');
  } else if (kind === 'proceedings') {
    parts.push(...(lead || []), titlePart(false));
    if (!lead) parts.push([date, false]);
    parts.push(['In', false], [venue, true], ['.', false]);
    missing.push('số trang và nhà xuất bản của kỷ yếu');
  } else {
    parts.push(...(lead || []), titlePart(true));
    if (!lead) parts.push([date, false]);
    const repo = arxiv || /arxiv/i.test(venue) ? 'arXiv' : (kind === 'preprint' ? venue : '');
    if (repo) parts.push([endDot(repo), false]);
  }
  if (link) parts.push([link, false]); else missing.push('DOI hoặc link');

  // Ghép: dấu chấm đứng riêng thì dính liền phần trước, còn lại cách nhau một dấu cách.
  const join = (fmt) => parts.reduce((acc, [s, it]) => `${acc}${s === '.' || !acc ? '' : ' '}${fmt(s, it)}`, '');
  const html = join((s, it) => (it ? `<i>${escapeHtml(s)}</i>` : escapeHtml(s)));
  const text = join((s) => s);

  // Trích dẫn trong bài.
  const fam = (e.authors || []).map(parseAuthor).filter(Boolean).map((a) => a.family);
  const who = !fam.length ? `“${title.split(/\s+/).slice(0, 4).join(' ')}…”` : (fam.length === 1 ? fam[0] : (fam.length === 2 ? `${fam[0]} & ${fam[1]}` : `${fam[0]} et al.`));
  const whoNarr = fam.length === 2 ? `${fam[0]} and ${fam[1]}` : who;
  const y = year || 'n.d.';
  return { html, text, inText: `(${who}, ${y})`, narrative: `${whoNarr} (${y})`, kind, missing };
}

/** Copy có định dạng (dán vào Word, Google Docs vẫn giữ in nghiêng), kèm bản văn bản thuần cho nơi không nhận HTML. */
export async function copyRich(html, text) {
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([`<span style="font-family:'Times New Roman',serif;font-size:12pt">${html}</span>`], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
    return true;
  } catch (_) {
    await navigator.clipboard.writeText(text);
    return false;
  }
}
