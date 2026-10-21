// Tô màu code theo ngôn ngữ cho khối ```lang trong Sổ tay. Bộ tách từ gọn, tự viết (không cần thư viện ngoài, chạy
// được khi không có mạng): chú thích, chuỗi, số, từ khoá, hàm dựng sẵn, tên hàm, chỉ thị tiền xử lý, lệnh LaTeX.
import { escapeHtml } from './util.js';

const W = (s) => new Set(s.split(/\s+/).filter(Boolean));
const C_LIKE_COMMENT = { line: '//', block: ['/*', '*/'] };
const LANGS = {
  python: { label: 'Python', line: '#', str: ['"""', "'''", '"', "'"], kw: W('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case'), bi: W('print len range list dict set tuple int float str bool open super isinstance enumerate zip map filter sum min max abs sorted round type self cls np torch nn F pd plt') },
  cpp: { label: 'C++', ...C_LIKE_COMMENT, pp: true, str: ['"', "'"], kw: W('alignas auto bool break case catch char class const constexpr continue decltype default delete do double else enum explicit extern false float for friend goto if inline int long mutable namespace new noexcept nullptr operator override private protected public register return short signed sizeof static static_cast struct switch template this throw true try typedef typename union unsigned using virtual void volatile while final'), bi: W('std cout cin endl vector string map unordered_map set pair size_t printf scanf make_shared unique_ptr shared_ptr') },
  c: { label: 'C', ...C_LIKE_COMMENT, pp: true, str: ['"', "'"], kw: W('auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while NULL'), bi: W('printf scanf malloc free memcpy strlen size_t FILE fopen fclose') },
  csharp: { label: 'C#', ...C_LIKE_COMMENT, str: ['@"', '"', "'"], kw: W('abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach get goto if implicit in init int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref return sbyte sealed set short sizeof static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while yield'), bi: W('Console List Dictionary Task Math String Linq IEnumerable var') },
  java: { label: 'Java', ...C_LIKE_COMMENT, str: ['"', "'"], kw: W('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public return short static super switch synchronized this throw throws true false try void volatile while var record'), bi: W('System String List ArrayList Map HashMap Integer Math Arrays') },
  javascript: { label: 'JavaScript', ...C_LIKE_COMMENT, str: ['`', '"', "'"], kw: W('async await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield'), bi: W('console document window Math JSON Promise Array Object String Number Map Set fetch') },
  typescript: { label: 'TypeScript', ...C_LIKE_COMMENT, str: ['`', '"', "'"], kw: W('abstract any as async await boolean break case catch class const continue declare default do else enum export extends false finally for from function if implements import in infer instanceof interface keyof let module namespace never new null number of private protected public readonly return static string super switch this throw true try type typeof undefined unknown var void while'), bi: W('console Math JSON Promise Array Object Record Partial Map Set') },
  rust: { label: 'Rust', ...C_LIKE_COMMENT, str: ['"'], kw: W('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'), bi: W('Vec String Option Some None Result Ok Err Box println print format vec') },
  go: { label: 'Go', ...C_LIKE_COMMENT, str: ['`', '"', "'"], kw: W('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil'), bi: W('fmt len cap make new append panic recover error string int float64 bool byte') },
  sql: { label: 'SQL', line: '--', block: ['/*', '*/'], str: ["'", '"'], ci: true, kw: W('select from where and or not in is null as join left right inner outer on group by order having limit offset insert into values update set delete create table index view drop alter primary key foreign references distinct union all case when then else end exists like between asc desc with'), bi: W('count sum avg min max coalesce cast date now') },
  bash: { label: 'Bash', line: '#', str: ['"', "'"], kw: W('if then else elif fi for while do done case esac function in return export local source echo exit'), bi: W('cd ls grep sed awk cat python pip conda git cp mv rm mkdir curl') },
  json: { label: 'JSON', str: ['"'], kw: W('true false null') },
  yaml: { label: 'YAML', line: '#', str: ['"', "'"], kw: W('true false null yes no') },
  latex: { label: 'LaTeX', line: '%', str: [], tex: true },
  r: { label: 'R', line: '#', str: ['"', "'"], kw: W('if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA library'), bi: W('c list data.frame print paste mean sum length ggplot') },
  matlab: { label: 'MATLAB', line: '%', str: ["'", '"'], kw: W('break case catch continue else elseif end for function global if otherwise parfor persistent return switch try while'), bi: W('zeros ones size length disp plot figure fprintf') },
  html: { label: 'HTML / XML', block: ['<!--', '-->'], str: ['"', "'"], markup: true },
  markdown: { label: 'Markdown', str: [] },
  text: { label: 'Văn bản thường', str: [] },
};
const ALIAS = { py: 'python', 'c++': 'cpp', cc: 'cpp', hpp: 'cpp', h: 'c', cs: 'csharp', 'c#': 'csharp', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', rs: 'rust', golang: 'go', sh: 'bash', shell: 'bash', zsh: 'bash', tex: 'latex', yml: 'yaml', xml: 'html', md: 'markdown', txt: 'text', plain: 'text', '': 'text' };
export const CODE_LANGS = Object.entries(LANGS).map(([k, v]) => [k, v.label]);
export const langKey = (lang) => { const k = String(lang || '').trim().toLowerCase(); return LANGS[k] ? k : (ALIAS[k] || (LANGS[k] ? k : 'text')); };
export const langLabel = (lang) => LANGS[langKey(lang)]?.label || lang || 'Code';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cache = new Map();
function tokenizer(key) {
  if (cache.has(key)) return cache.get(key);
  const L = LANGS[key];
  const parts = [];
  if (L.block) parts.push(`(?<com>${esc(L.block[0])}[\\s\\S]*?(?:${esc(L.block[1])}|$))`);
  if (L.line) parts.push(`(?<lcom>${esc(L.line)}[^\\n]*)`);
  (L.str || []).forEach((d, i) => {
    if (d.length === 3) parts.push(`(?<str${i}>${esc(d)}[\\s\\S]*?(?:${esc(d)}|$))`); // chuỗi ba dấu nháy (Python)
    else if (d === '@"') parts.push(`(?<str${i}>@"(?:""|[^"])*"?)`); // chuỗi nguyên văn C#
    else if (d === '`') parts.push(`(?<str${i}>\`(?:\\\\[\\s\\S]|[^\\\\\`])*\`?)`); // template string, được xuống dòng
    else parts.push(`(?<str${i}>${esc(d)}(?:\\\\.|[^\\\\\\n${esc(d)}])*${esc(d)}?)`);
  });
  if (L.pp) parts.push('(?<pp>^[ \\t]*#[^\\n]*)');
  if (L.tex) parts.push('(?<cmd>\\\\(?:[A-Za-z@]+|.))', '(?<math>\\$[^$\\n]*\\$)', '(?<brace>[{}\\[\\]])');
  if (L.markup) parts.push('(?<tag></?[A-Za-z][\\w:-]*)', '(?<attr>\\b[\\w:-]+(?==))');
  parts.push('(?<num>\\b(?:0x[0-9a-fA-F]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b)');
  parts.push('(?<id>[A-Za-z_][A-Za-z0-9_]*)');
  const re = new RegExp(parts.join('|'), `g${L.pp ? 'm' : ''}`);
  cache.set(key, re);
  return re;
}

/** HTML đã tô màu của một đoạn code (đã escape). */
export function highlight(code, lang) {
  const key = langKey(lang);
  const L = LANGS[key];
  const src = String(code ?? '');
  if (key === 'text' || key === 'markdown') return escapeHtml(src);
  if (key === 'json') {
    // Khoá của object (chuỗi đứng trước dấu :) tô khác giá trị.
    return escapeHtml(src).replace(/(&quot;(?:\\.|[^&\\]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g,
      (m, s, colon, kw, num) => (s ? `<span class="${colon ? 'hl-attr' : 'hl-str'}">${s}</span>${colon || ''}` : kw ? `<span class="hl-kw">${kw}</span>` : `<span class="hl-num">${num}</span>`));
  }
  const re = tokenizer(key);
  re.lastIndex = 0;
  let out = '';
  let last = 0;
  for (const m of src.matchAll(re)) {
    out += escapeHtml(src.slice(last, m.index));
    last = m.index + m[0].length;
    const g = m.groups;
    const t = escapeHtml(m[0]);
    if (g.com || g.lcom) out += `<span class="hl-com">${t}</span>`;
    else if (Object.keys(g).some((k) => k.startsWith('str') && g[k])) out += `<span class="hl-str">${t}</span>`;
    else if (g.pp) out += `<span class="hl-pp">${t}</span>`;
    else if (g.cmd) out += `<span class="hl-kw">${t}</span>`;
    else if (g.math) out += `<span class="hl-str">${t}</span>`;
    else if (g.brace) out += `<span class="hl-punc">${t}</span>`;
    else if (g.tag) out += `<span class="hl-kw">${t}</span>`;
    else if (g.attr) out += `<span class="hl-attr">${t}</span>`;
    else if (g.num) out += `<span class="hl-num">${t}</span>`;
    else if (g.id) {
      const w = L.ci ? m[0].toLowerCase() : m[0];
      const next = src.slice(last).match(/^\s*\(/);
      if (L.kw?.has(w)) out += `<span class="hl-kw">${t}</span>`;
      else if (L.bi?.has(w)) out += `<span class="hl-bi">${t}</span>`;
      else if (next) out += `<span class="hl-fn">${t}</span>`;
      else if (/^[A-Z][a-z0-9]/.test(m[0]) && !['sql', 'bash'].includes(key)) out += `<span class="hl-type">${t}</span>`;
      else out += t;
    } else out += t;
  }
  return out + escapeHtml(src.slice(last));
}

/** Khối code có khung riêng: tên ngôn ngữ, nút copy, số dòng, code đã tô màu. */
export function codeBlockHtml(code, lang) {
  const key = langKey(lang);
  const lines = String(code ?? '').replace(/\n$/, '').split('\n').length;
  return `<div class="nb-code" data-lang="${key}"><div class="nb-code-h"><span class="nb-code-lang">${escapeHtml(langLabel(lang))}</span><span class="hint">${lines} dòng</span><span class="spacer"></span><button type="button" class="sm ghost nb-code-copy" title="Copy code">Copy</button></div><pre class="nb-code-pre"><code>${highlight(String(code ?? '').replace(/\n$/, ''), key)}</code></pre></div>`;
}
