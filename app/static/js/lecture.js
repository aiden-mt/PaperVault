// Bài giảng (ý tưởng từ Loupe: survey/lecture.py). Khác ghi chú trích xuất ở mục tiêu: ghi chú trả lời "bài này nói gì",
// bài giảng đưa một người chưa làm đúng nhánh hẹp này đi tới chỗ hiểu được bài, kể cả cơ chế bên trong.
//  - Tám mục theo thứ tự cố định, viết theo từng mẻ nhỏ. Mục "cơ chế" đi một mình để được trọn trần đầu ra.
//  - Toàn văn nằm ở system prompt, giống hệt nhau giữa các mẻ, nên từ mẻ thứ hai trở đi chỉ trả giá đọc cache.
//  - Phần đối chiếu dùng câu trích dẫn nguyên văn từ Semantic Scholar (miễn phí) thay cho việc đọc từng bài được dẫn.
//  - Viết xong thì soát cơ học: số liệu có trong toàn văn không, có câu nông không. Mục bị chấm nông được viết lại
//    một lần kèm đúng câu bị chê. Cảnh báo còn lại hiện cho người đọc, không chặn.
import { api } from './api.js';
import { store, savePaper, paperById } from './store.js';
import { complete } from './llm.js';
import { parseLooseJson, clampText, escapeHtml } from './util.js';
import { mdToHtml } from './ui.js';
import { pdfFullText } from './pdftext.js';
import { unverifiedNumbers, shallowSentences } from './quality.js';
import { protectMath, restoreMath, rich, titleHtml } from './richtext.js';

export const SECTIONS = {
  prereq: {
    vi: 'Cần biết trước', en: 'What you need to know first',
    shape: '{"items": [{"term": "…", "why": "…"}], "where": "…"}',
    spec: `Ba đến năm thứ mà bài báo GIẢ ĐỊNH người đọc đã biết nên không giải thích. Mỗi thứ gồm term (giữ thuật ngữ tiếng Anh) và why: 2-4 câu nói nó LÀM GÌ và vì sao bài này cần đến nó.
Chọn đúng thứ bài này thật sự dựa vào, không phải kiến thức phổ thông của ngành. "Mạng nơ-ron là gì" thì không ai cần, "vì sao pretraining không nhãn thay được dữ liệu có nhãn" thì cần.`,
  },
  problem: {
    vi: 'Bài toán', en: 'The problem',
    shape: '{"body": "…", "where": "…"}',
    spec: `Bài toán bài này giải, kể bằng một tình huống cụ thể có trong bài: một đầu vào thật, một thất bại thật. Không phát biểu trừu tượng kiểu "vấn đề X còn nhiều thách thức".
Sau đó nói rõ cái giá của việc chưa giải được: thiếu nó thì người ta phải làm gì thay thế và tốn kém ở đâu.`,
  },
  why_hard: {
    vi: 'Vì sao cách hiển nhiên không xong', en: 'Why the obvious approach fails',
    shape: '{"body": "…", "where": "…"}',
    spec: `Cách mà một người thông minh sẽ nghĩ ra đầu tiên, và chính xác nó vỡ ở đâu. Mục này làm cho đóng góp của bài có nghĩa: thiếu nó thì phương pháp chỉ là một cách làm trong vô số cách.
Nếu bài có nói về các hướng trước đó thì dùng đúng chỗ đó.`,
  },
  mechanism: {
    vi: 'Cơ chế, chạy tay một ví dụ', en: 'The mechanism, traced on one example',
    shape: '{"input": "…", "steps": [{"do": "…", "why": "…", "note": "…"}], "where": "…"}',
    spec: `MỤC DÀI NHẤT VÀ QUAN TRỌNG NHẤT. Lấy MỘT đầu vào cụ thể rồi đi hết đường của nó qua phương pháp, từng bước một. Sáu đến mười bước.
Mỗi bước gồm ba phần:
  do: bước này làm gì, với đại lượng nào, ra cái gì. Câu đầu của do phải ngắn, đọc như tên bước.
  why: vì sao bước này cần thiết, bỏ nó đi thì hỏng chỗ nào.
  note: ký hiệu hoặc siêu tham số của bước này đọc thành lời. Không có thì để chuỗi rỗng.
Ưu tiên đầu vào có thật trong bài. Bài không kể ví dụ nào chạy hết đường thì được tự dựng một tình huống minh hoạ, nhưng phải nói rõ đó là giả định ngay ở input ("giả sử…") và các con số trong đó phải nhất quán với nhau. Không trình bày số tự nghĩ ra như kết quả đo của bài.`,
  },
  compare: {
    vi: 'Đặt cạnh những bài nó dẫn', en: 'Next to the papers it cites',
    shape: '{"items": [{"paper": "…", "took": "…", "differs": "…"}], "placement": "…", "where": "…"}',
    spec: `Dùng HỒ SƠ ĐỐI CHIẾU kèm bên dưới (nếu có) và phần related work trong toàn văn. Với 4-7 bài đáng nói nhất:
  paper: tên bài được dẫn.
  took: bài này LẤY GÌ từ đó (ý tưởng, thành phần, tập dữ liệu).
  differs: và KHÁC ở chỗ nào, cụ thể, không phải "cải tiến hơn".
Câu trích dẫn trong hồ sơ là lời của chính tác giả bài này nói về bài kia, hãy bám vào nó. Câu do máy bóc nên có thể lệch: chỉ khẳng định điều câu đó thật sự chứa.
placement: 2-4 câu đặt bài này vào mạch nghiên cứu. Nó nối tiếp nhánh nào và cãi lại giả định nào của nhánh đó.`,
  },
  evidence: {
    vi: 'Số liệu nói gì, và không nói gì', en: 'What the numbers show, and what they do not',
    shape: '{"items": [{"claim": "…", "number": "…", "setting": "…"}], "limits_of_evidence": "…", "where": "…"}',
    spec: `Hai đến bốn kết quả chính. Mỗi kết quả có claim (điều được khẳng định), number (con số NGUYÊN VĂN trong bài) và setting (tập dữ liệu nào, so với cái gì, đo bằng chỉ số nào).
limits_of_evidence: những gì các số này KHÔNG chứng minh. Thí nghiệm chỉ chạy trên một tập? Baseline có được chỉnh ngang mức không? Chênh lệch có nằm trong dao động không?`,
  },
  limits: {
    vi: 'Chỗ đáng ngờ', en: 'What to be sceptical about',
    shape: '{"items": [{"point": "…", "so_what": "…"}], "where": "…"}',
    spec: `Ba đến năm điểm yếu thật. Ưu tiên điều bài tự thừa nhận, rồi mới đến điều thấy được từ chính nội dung bài (giả định chưa kiểm, phạm vi thí nghiệm hẹp, chi phí không báo cáo).
point là điểm yếu, viết ngắn. so_what là hệ quả: điểm yếu này làm kết luận nào yếu đi. Không viết câu vô thưởng vô phạt kiểu "cần thêm nghiên cứu".`,
  },
  check: {
    vi: 'Tự kiểm tra', en: 'Check yourself',
    shape: '{"items": [{"q": "…", "a": "…"}]}',
    spec: `Bốn đến sáu câu hỏi để người đọc tự soát mình đã hiểu chưa, kèm đáp án ngắn.
Phải là câu hỏi "vì sao" hoặc "điều gì xảy ra nếu", không phải câu tra cứu. "Phương pháp tên gì" thì vô dụng, "bỏ bước lượng tử hoá đi thì hỏng chỗ nào" mới buộc người đọc dựng lại lời giải thích. Ít nhất một câu hỏi vào chỗ dễ hiểu nhầm nhất của bài.`,
  },
};
export const SECTION_ORDER = Object.keys(SECTIONS);
const BATCHES = [['prereq', 'problem', 'why_hard'], ['mechanism'], ['compare', 'evidence'], ['limits', 'check']];
// Mục có số là khẳng định về bài. "problem" và "mechanism" cố ý kể một tình huống ví dụ nên không đối chiếu số,
// nếu không bộ soát kêu oan hàng chục lần và cảnh báo thật bị trôi.
const CLAIM_SECTIONS = new Set(['evidence', 'compare', 'limits', 'why_hard', 'prereq']);
const MAX_REDO = 4;
const MAX_OUT = 8000;
export const LEAD_MAX = 90; // in đậm chỉ có tác dụng khi ngắn

export const sectionTitle = (name, lang = 'vi') => SECTIONS[name]?.[lang === 'en' ? 'en' : 'vi'] || name;

/* ---------- Nguồn ---------- */

const REF_HEAD = /\n\s*(references|bibliography|tài liệu tham khảo)\s*\n/gi;
/** Bỏ danh mục tham khảo ở cuối (chỉ tin tiêu đề từ 30% bài trở đi): gửi đi chỉ tốn token. */
function dropReferences(text) {
  let cut = -1;
  for (const m of text.matchAll(REF_HEAD)) if (m.index > text.length * 0.3) { cut = m.index; break; }
  return cut > 0 ? text.slice(0, cut) : text;
}

async function loadFullText(paper, onStatus) {
  let text = '';
  try { text = (await api.getText(paper.id)).text || ''; } catch (_) { /* chưa lưu */ }
  if (text.length < 4000 && paper.pdfId) {
    onStatus('Đang đọc chữ từ PDF…');
    try {
      const pdfText = await pdfFullText(paper.pdfId);
      if (pdfText.length > Math.max(4000, text.length * 2)) {
        text = pdfText;
        api.putText(paper.id, pdfText, 'full text (trích từ PDF)').then(() => { if (store.textLens) store.textLens[paper.id] = pdfText.length; }).catch(() => {});
      }
    } catch (_) { /* PDF dạng ảnh */ }
  }
  return text;
}

const s2Ident = (p) => p.s2Id || (p.arxivId ? `arXiv:${p.arxivId.replace(/v\d+$/, '')}` : (p.doi ? `DOI:${p.doi}` : (p.url ? `URL:${p.url}` : '')));

/** Hồ sơ đối chiếu: các bài được dẫn kèm nguyên văn câu trích dẫn. Lỗi mạng thì trả mảng rỗng, bài giảng vẫn viết được. */
async function loadDossier(paper) {
  const ident = s2Ident(paper);
  if (!ident) return [];
  try {
    const r = await api.s2References(ident);
    return (r.items || []).filter((x) => x._contexts?.length || x._influential).slice(0, 18).map((x) => ({
      title: x.title || '', year: x.year || '', influential: !!x._influential,
      gist: (x.abstract || '').replace(/\s+/g, ' ').slice(0, 220),
      why: (x._contexts || []).slice().sort((a, b) => b.length - a.length).slice(0, 2).map((c) => c.slice(0, 320)),
    }));
  } catch (_) { return []; }
}

function dossierText(refs) {
  if (!refs.length) return '';
  const out = ['=== HỒ SƠ ĐỐI CHIẾU: các bài mà bài này dẫn ===',
    'Mỗi mục gồm bài được dẫn là gì và NGUYÊN VĂN câu trong bài này ở chỗ trích dẫn nó. Câu do máy bóc tự động, có thể lệch.'];
  refs.forEach((r, i) => {
    out.push(`[R${i + 1}] ${r.title}${r.year ? ` (${r.year})` : ''}${r.influential ? '  ★ bài này dựa nhiều vào nó' : ''}`);
    if (r.gist) out.push(`    là gì: ${r.gist}`);
    for (const w of r.why) out.push(`    chỗ dẫn: "${w}"`);
  });
  return out.join('\n');
}

/* ---------- Prompt ---------- */

function systemPrompt(paper, text, lang) {
  const out = lang === 'en' ? 'English' : 'tiếng Việt';
  return `Bạn viết BÀI GIẢNG về một bài báo khoa học: người đọc đi từ đầu đến cuối là hiểu được bài đó, không cần ai giảng thêm. Viết bằng ${out}.

Bạn KHÔNG viết tóm tắt. Tóm tắt trả lời "bài này nói gì". Bài giảng trả lời "vì sao nó phải làm như vậy, và nó chạy ra sao".

## Người đọc
Một người cùng lĩnh vực rộng nhưng chưa làm đúng nhánh hẹp này: đọc được ký hiệu toán, biết khái niệm nền phổ thông của ngành, nhưng chưa đọc những bài mà bài này coi là ai cũng đã đọc. Sai lầm phải tránh là viết như tác giả viết. Chỗ nào bài báo nói vắn tắt vì cho là hiển nhiên, bạn phải dừng lại và nói rõ.

## Luật viết
- Ký hiệu phải được đọc thành lời: nó là gì, chỉ số chạy trên cái gì, vì sao cần chỉ số đó.
- Khái niệm mới xuất hiện lần đầu phải kèm một câu nói nó LÀM GÌ, không phải nó tên gì.
- Thuật ngữ tiếng Anh giữ nguyên, lần đầu kèm giải thích ngắn trong ngoặc. Không tự chế bản dịch cho thuật ngữ.
- Câu hoàn chỉnh, đủ chủ vị. Không mở bằng "Trong bài báo này, các tác giả…", vào thẳng nội dung.
- Công thức và ký hiệu viết bằng LaTeX trong $...$ (cùng dòng) hoặc $$...$$ (đứng riêng), ví dụ $z_t \\sim q(\\cdot \\mid x_t)$. App dựng công thức khi hiển thị. Sau công thức vẫn phải đọc nó thành lời.

## Tiêu chuẩn độ sâu
Phép thử cho mọi câu giải thích: thay thuật ngữ trong câu bằng một từ vô nghĩa. Nếu câu vẫn nghe hợp lý thì bạn mới đặt tên chứ chưa giải thích, phải viết lại.
1. Cơ chế, không phải nhãn. Nói dữ liệu đi qua những bước nào và VÌ SAO bước đó tạo ra kết quả ấy.
2. Nói bằng cách nào, đừng chỉ nói tốt hơn. Câu có "cải thiện", "nâng cao", "tối ưu" mà không kèm cơ chế hoặc con số là câu chưa viết xong.
3. Cụ thể trước, tổng quát sau. Giải thích được bằng một ví dụ chạy tay thì đưa ví dụ đó ra.
4. Nói ra chỗ có thể sai: điều kiện mà kết luận phụ thuộc vào.
Cấm các cụm rỗng như "đóng vai trò quan trọng", "góp phần nâng cao", "mang lại hiệu quả cao", "đáng chú ý là".

## Ràng buộc về sự thật
- Mọi con số nói về bài phải có mặt nguyên văn trong TOÀN VĂN. Không suy ra, không làm tròn khác đi, không ghép hai số thành tỉ lệ mới.
- Bài không nói thì viết là bài không nói. Không lấp bằng kiến thức chung của bạn.
- Trường "where" ghi mục, hình hoặc bảng trong bài mà nội dung dựa vào, ví dụ "Sec. 3.2, Table 2".

=== TOÀN VĂN BÀI BÁO ===
Tiêu đề: ${paper.title || ''}

${text}`;
}

function userPrompt(names, dossier, redo) {
  const parts = [`Viết ${names.length} mục sau, mỗi mục là một khoá trong JSON trả về:\n\n${names.map((n) => `### "${n}": ${SECTIONS[n].vi}\n${SECTIONS[n].spec}\nDạng: ${SECTIONS[n].shape}`).join('\n\n')}`];
  if (names.includes('compare')) parts.push(dossier || 'Không có hồ sơ đối chiếu. Chỉ dùng phần related work và các chỗ trích dẫn trong toàn văn, và nói ở mức bài này tự mô tả.');
  if (redo) {
    parts.push(`=== LẦN TRƯỚC BỊ CHẤM LÀ NÔNG, VIẾT LẠI ĐÚNG NHỮNG CHỖ NÀY ===\n${names.filter((n) => redo[n]).map((n) => `- [${n}] ${redo[n]}`).join('\n')}\n\nGiữ nguyên phần đã đạt. Chỗ bị chấm thì viết tới cơ chế: nói bằng cách nào, chứ không nói rằng có.`);
  }
  parts.push(`Chỉ trả về MỘT đối tượng JSON dạng {${names.map((n) => `"${n}": …`).join(', ')}}. Không lời dẫn, không rào \`\`\`.`);
  return parts.join('\n\n');
}

/** Một mẻ, thử lại một lần nếu phản hồi không bóc ra JSON được (lần thử lại chỉ tốn phần đầu ra vì prefix đã ấm). */
async function runBatch({ settings, system, names, dossier, redo, paperId, onStatus }) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const out = await complete({
      settings, system, cacheSystem: true, user: userPrompt(names, dossier, redo), maxTokens: MAX_OUT,
      effort: ['high', 'xhigh', 'max'].includes(settings.effort) ? 'medium' : settings.effort, task: 'lecture', paperId,
      onRetry: (n, wait) => onStatus(`Bị giới hạn tốc độ, thử lại lần ${n} sau ${Math.round(wait / 1000)}s…`),
    });
    try {
      const obj = parseLooseJson(out.text);
      const got = {};
      for (const n of names) if (obj?.[n] && typeof obj[n] === 'object') got[n] = obj[n];
      if (Object.keys(got).length) return { got, model: out.model };
      last = new Error('Model không trả về mục nào.');
    } catch (e) { last = e; }
  }
  throw last;
}

/* ---------- Soát ---------- */

const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

/** Mọi đoạn văn xuôi của một mục: [{ label, text }]. Bóc theo hình dạng riêng của từng mục. */
function textsOf(name, d) {
  const out = [];
  if (!d || typeof d !== 'object') return out;
  if (name === 'mechanism') arr(d.steps).forEach((s, i) => out.push({ label: `bước ${i + 1}`, text: `${str(s.do)} ${str(s.why)}` }));
  else if (name === 'prereq') arr(d.items).forEach((it) => out.push({ label: str(it.term).slice(0, 30), text: str(it.why) }));
  else if (name === 'compare') { arr(d.items).forEach((it) => out.push({ label: str(it.paper).slice(0, 30), text: `${str(it.took)} ${str(it.differs)}` })); out.push({ label: 'vị trí', text: str(d.placement) }); }
  else if (name === 'limits') arr(d.items).forEach((it) => out.push({ label: str(it.point).slice(0, 30), text: str(it.so_what) }));
  else if (name === 'evidence') out.push({ label: 'giới hạn bằng chứng', text: str(d.limits_of_evidence) });
  else if (name !== 'check') out.push({ label: '', text: str(d.body) }); // câu hỏi tự kiểm vốn ngắn, soát độ sâu là kêu oan
  return out.filter((x) => x.text.trim());
}

function numberBlob(name, d) {
  if (name === 'evidence') return `${arr(d.items).map((i) => `${str(i.claim)} ${str(i.number)} ${str(i.setting)}`).join(' ')} ${str(d.limits_of_evidence)}`;
  return textsOf(name, d).map((x) => x.text).join(' ');
}

/** Trả về [{ section, kind: 'number'|'shallow'|'missing', msg, text? }]. */
function checkLecture(sections, sourceText) {
  const warns = [];
  for (const name of SECTION_ORDER) {
    const d = sections[name];
    if (!d) continue;
    if (CLAIM_SECTIONS.has(name) && sourceText.length > 4000) {
      const nums = unverifiedNumbers(numberBlob(name, d), sourceText);
      if (nums.length) warns.push({ section: name, kind: 'number', msg: `${nums.length} con số không thấy nguyên văn trong toàn văn đã lưu: ${nums.slice(0, 8).join(', ')}${nums.length > 8 ? '…' : ''}` });
    }
    for (const t of textsOf(name, d)) {
      for (const s of shallowSentences(t.text)) warns.push({ section: name, kind: 'shallow', msg: `${t.label ? `${t.label}: ` : ''}${s.reason}`, text: s.text });
    }
  }
  return warns;
}

/* ---------- Dựng ---------- */

const jobs = new Map();
/** Lượt dựng đang chạy của một paper (để tab Bài giảng vẽ lại tiến độ khi người dùng quay lại), hoặc null. */
export const lectureJob = (paperId) => jobs.get(paperId) || null;

/**
 * Dựng bài giảng cho paper. Chạy nền: người dùng rời tab thì vẫn chạy tiếp và tự lưu vào paper.
 * Trả về job { status, sections, done, error, listeners:Set<fn>, promise }.
 */
export function buildLecture(paperId) {
  const running = jobs.get(paperId);
  if (running && !running.done) return running;
  // step/of: bước đang chạy trên tổng số bước (đọc nguồn, bốn mẻ viết, viết lại chỗ nông), cho thanh tiến độ.
  const job = { status: 'Đang chuẩn bị…', step: 0, of: BATCHES.length + 2, sections: {}, done: false, error: '', listeners: new Set(), promise: null };
  const emit = (status, step) => { if (status) job.status = status; if (step != null) job.step = step; for (const fn of [...job.listeners]) { try { fn(job); } catch (_) { /* tab đã đóng */ } } };
  jobs.set(paperId, job);
  job.promise = (async () => {
    const started = Date.now();
    const settings = store.settings;
    const paper = paperById(paperId);
    const lang = settings.language === 'en' ? 'en' : 'vi';
    const fullText = await loadFullText(paper, emit);
    if (fullText.length < 4000) throw new Error('Paper chưa có toàn văn (mới có abstract hoặc PDF dạng ảnh) nên không đủ để dựng bài giảng. Đính kèm PDF hoặc dán toàn văn ở tab Nguồn.');
    emit('Đang lấy câu trích dẫn từ Semantic Scholar (miễn phí)…', 0);
    const refs = await loadDossier(paper);
    const dossier = dossierText(refs);
    const body = clampText(dropReferences(fullText), Math.max(settings.maxInputChars || 60000, 100000));
    const system = systemPrompt(paper, body, lang);
    let model = '';
    const failed = [];
    for (const [i, names] of BATCHES.entries()) {
      emit(`Mẻ ${i + 1}/${BATCHES.length}: đang viết ${names.map((n) => sectionTitle(n, lang).toLowerCase()).join(', ')}…`, i + 1);
      try {
        const r = await runBatch({ settings, system, names, dossier, paperId, onStatus: emit });
        Object.assign(job.sections, r.got);
        model = r.model || model;
        emit();
      } catch (e) {
        // Lỗi key, quota hay model sai thì các mẻ sau cũng hỏng y vậy: dừng luôn cho khỏi tốn.
        if (!Object.keys(job.sections).length) throw e;
        failed.push(e.message);
      }
    }
    // Đào sâu: chỉ mục bị chấm nông, kèm đúng câu bị chê. Chê chung chung thì model viết dài hơn chứ không sâu hơn.
    const checkSrc = `${fullText}\n${dossier}`;
    let warns = checkLecture(job.sections, checkSrc);
    const redo = {};
    for (const w of warns) {
      if (w.kind !== 'shallow' || redo[w.section] || Object.keys(redo).length >= MAX_REDO) continue;
      redo[w.section] = `${w.msg}. Câu: "${w.text.slice(0, 160)}"`;
    }
    const redone = [];
    const groups = [Object.keys(redo).filter((n) => n !== 'mechanism'), redo.mechanism ? ['mechanism'] : []].filter((g) => g.length);
    for (const names of groups) {
      emit(`Đang viết lại chỗ còn nông: ${names.map((n) => sectionTitle(n, lang).toLowerCase()).join(', ')}…`, BATCHES.length + 1);
      try {
        const r = await runBatch({ settings, system, names, dossier, redo, paperId, onStatus: emit });
        Object.assign(job.sections, r.got);
        redone.push(...Object.keys(r.got));
        emit();
      } catch (_) { /* giữ bản đầu, cảnh báo vẫn hiện */ }
    }
    if (redone.length) warns = checkLecture(job.sections, checkSrc);
    // Mục thiếu phải nằm trong kết quả, không chỉ thoáng qua ở dòng tiến độ.
    for (const n of SECTION_ORDER) if (!job.sections[n]) warns.push({ section: n, kind: 'missing', msg: `Không dựng được mục này${failed.length ? ` (${failed[0].slice(0, 140)})` : ''}. Bấm Dựng lại để viết nốt.` });
    const lecture = {
      sections: job.sections, warns, redone, lang, model, provider: settings.provider,
      refs: refs.map((r) => ({ title: r.title, year: r.year, influential: r.influential })),
      textLen: fullText.length, secs: Math.round((Date.now() - started) / 1000), at: new Date().toISOString(),
    };
    await savePaper({ ...paperById(paperId), lecture });
    return lecture;
  })().then((lec) => { job.done = true; emit('Xong.'); return lec; }, (e) => { job.done = true; job.error = e.message || String(e); emit(); return null; });
  return job;
}

export async function removeLecture(paperId) {
  jobs.delete(paperId);
  return savePaper({ ...paperById(paperId), lecture: null });
}

/* ---------- Hiển thị ---------- */

const para = (s) => mdToHtml(str(s));
const lead = (s) => { const t = str(s).trim(); return t.length && t.length <= LEAD_MAX ? `<b>${rich(t)}</b>` : rich(t); };
/** Câu đầu của "do" làm tên bước (in đậm khi ngắn), phần còn lại là thân. */
function splitLead(text) {
  const t = str(text).trim();
  const m = /^(.{8,90}?[.:!?])\s+(.+)$/s.exec(t);
  return m ? [m[1], m[2]] : (t.length <= LEAD_MAX ? [t, ''] : ['', t]);
}

function sectionBody(name, d, lang) {
  const L = lang === 'en'
    ? { input: 'Worked example', why: 'Why it is needed', note: 'Notation', took: 'Takes', differs: 'Differs', not: 'What these numbers do not prove', ans: 'Answer', claim: 'Claim', number: 'Number', setting: 'Setting' }
    : { input: 'Đầu vào lấy làm ví dụ', why: 'Vì sao cần', note: 'Ký hiệu', took: 'Lấy', differs: 'Khác', not: 'Các số này không chứng minh', ans: 'Đáp án', claim: 'Khẳng định', number: 'Con số', setting: 'Điều kiện đo' };
  if (name === 'prereq') return `<dl class="lec-terms">${arr(d.items).map((it) => `<dt>${rich(str(it.term))}</dt><dd>${para(it.why)}</dd>`).join('')}</dl>`;
  if (name === 'problem' || name === 'why_hard') return para(d.body);
  if (name === 'mechanism') {
    return `${str(d.input) ? `<div class="lec-input"><span class="lec-k">${L.input}</span>${para(d.input)}</div>` : ''}
      <ol class="lec-steps">${arr(d.steps).map((s) => { const [head, rest] = splitLead(s.do); return `<li>${head ? `<div class="lec-do"><b>${rich(head)}</b></div>` : ''}${rest ? para(rest) : ''}
        ${str(s.why) ? `<div class="lec-why"><span class="lec-k">${L.why}</span>${para(s.why)}</div>` : ''}
        ${str(s.note) ? `<div class="lec-note"><span class="lec-k">${L.note}</span>${para(s.note)}</div>` : ''}</li>`; }).join('')}</ol>`;
  }
  if (name === 'compare') {
    return `${arr(d.items).map((it) => `<div class="lec-cmp"><div class="lec-cmp-t">${titleHtml(str(it.paper))}</div>
      <div class="lec-pair"><span class="lec-k">${L.took}</span><div>${para(it.took)}</div></div>
      <div class="lec-pair"><span class="lec-k">${L.differs}</span><div>${para(it.differs)}</div></div></div>`).join('')}${str(d.placement) ? `<div class="lec-place">${para(d.placement)}</div>` : ''}`;
  }
  if (name === 'evidence') {
    return `<div class="table-wrap"><table class="lec-table"><thead><tr><th style="width:24%">${L.number}</th><th style="width:40%">${L.claim}</th><th>${L.setting}</th></tr></thead><tbody>${arr(d.items).map((it) => `<tr><td class="lec-num">${rich(str(it.number))}</td><td>${rich(str(it.claim))}</td><td>${rich(str(it.setting))}</td></tr>`).join('')}</tbody></table></div>
      ${str(d.limits_of_evidence) ? `<div class="lec-why"><span class="lec-k">${L.not}</span>${para(d.limits_of_evidence)}</div>` : ''}`;
  }
  if (name === 'limits') return `<ul class="lec-limits">${arr(d.items).map((it) => `<li>${lead(it.point)}${str(it.so_what) ? `<div class="lec-so">${para(it.so_what)}</div>` : ''}</li>`).join('')}</ul>`;
  if (name === 'check') return `<ol class="lec-check">${arr(d.items).map((it) => `<li>${rich(str(it.q))}<details><summary>${L.ans}</summary>${para(it.a)}</details></li>`).join('')}</ol>`;
  return '';
}

/** HTML của bài giảng. pending: tên các mục đang chờ viết (khi đang dựng). */
export function lectureHtml(lec, { pending = [] } = {}) {
  const lang = lec.lang || 'vi';
  const warnsOf = (n) => (lec.warns || []).filter((w) => w.section === n);
  return SECTION_ORDER.map((name, i) => {
    const d = lec.sections?.[name];
    const head = `<h2><span class="lec-no">${i + 1}</span>${escapeHtml(sectionTitle(name, lang))}${(lec.redone || []).includes(name) ? ' <span class="badge" title="Mục này bị chấm là nông ở lượt đầu nên đã được viết lại">đã viết lại</span>' : ''}</h2>`;
    if (!d) {
      if (pending.includes(name)) return `<section class="card lec-sec lec-wait" id="lec-${name}">${head}<span class="hint">Đang chờ viết…</span></section>`;
      const miss = warnsOf(name).find((w) => w.kind === 'missing');
      return miss ? `<section class="card lec-sec" id="lec-${name}">${head}<span class="status err">${escapeHtml(miss.msg)}</span></section>` : '';
    }
    const ws = warnsOf(name);
    const num = ws.filter((w) => w.kind === 'number');
    const shallow = ws.filter((w) => w.kind === 'shallow');
    const warnBox = ws.length ? `<details class="lec-warn"><summary>${num.length ? '<span class="badge warn">số liệu cần đối chiếu</span>' : ''}${shallow.length ? `<span class="badge warn">${shallow.length} câu còn nông</span>` : ''}</summary>
      <ul>${num.map((w) => `<li>${escapeHtml(w.msg)}</li>`).join('')}${shallow.map((w) => `<li>${escapeHtml(w.text || '')} <span class="hint">· ${escapeHtml(w.msg)}</span></li>`).join('')}</ul></details>` : '';
    return `<section class="card lec-sec" id="lec-${name}">${head}${sectionBody(name, d, lang)}${str(d.where) ? `<div class="lec-where hint">${lang === 'en' ? 'Based on' : 'Dựa vào'} ${escapeHtml(d.where)}</div>` : ''}${warnBox}</section>`;
  }).join('');
}

export function lectureMarkdown(paper, lec) {
  const lang = lec.lang || 'vi';
  const s = lec.sections || {};
  const en = lang === 'en';
  const out = [`# ${paper.title || 'Bài giảng'}`, ''];
  const head = (n) => out.push(`\n## ${sectionTitle(n, lang)}\n`);
  const mdLead = (t) => { const x = str(t).trim(); return x.length && x.length <= LEAD_MAX ? `**${x}**` : x; };
  if (s.prereq) { head('prereq'); for (const it of arr(s.prereq.items)) out.push(`**${str(it.term)}**: ${str(it.why)}\n`); }
  for (const n of ['problem', 'why_hard']) if (s[n]) { head(n); out.push(`${str(s[n].body)}\n`); }
  if (s.mechanism) {
    head('mechanism');
    if (str(s.mechanism.input)) out.push(`**${en ? 'Worked example' : 'Đầu vào lấy làm ví dụ'}:** ${s.mechanism.input}\n`);
    arr(s.mechanism.steps).forEach((st, i) => {
      out.push(`${i + 1}. ${str(st.do)}`);
      if (str(st.why)) out.push(`   *${en ? 'Why it is needed' : 'Vì sao cần'}:* ${st.why}`);
      if (str(st.note)) out.push(`   *${en ? 'Notation' : 'Ký hiệu'}:* ${st.note}`);
      out.push('');
    });
  }
  if (s.compare) {
    head('compare');
    for (const it of arr(s.compare.items)) out.push(`**${str(it.paper)}**  \n${en ? 'Takes' : 'Lấy'}: ${str(it.took)}  \n${en ? 'Differs' : 'Khác'}: ${str(it.differs)}\n`);
    if (str(s.compare.placement)) out.push(`${s.compare.placement}\n`);
  }
  if (s.evidence) {
    head('evidence');
    for (const it of arr(s.evidence.items)) out.push(`- **${str(it.number)}**: ${str(it.claim)} (${str(it.setting)})`);
    if (str(s.evidence.limits_of_evidence)) out.push(`\n**${en ? 'What these numbers do not prove' : 'Các số này không chứng minh'}:** ${s.evidence.limits_of_evidence}\n`);
  }
  if (s.limits) { head('limits'); for (const it of arr(s.limits.items)) out.push(`- ${mdLead(it.point)}${str(it.so_what) ? `. ${it.so_what}` : ''}`); out.push(''); }
  if (s.check) {
    // Đáp án xuống cuối, không nằm ngay dưới câu hỏi: tự dựng lại lời giải thích mới là lúc học được.
    head('check');
    const items = arr(s.check.items);
    items.forEach((it, i) => out.push(`${i + 1}. ${str(it.q)}`));
    if (items.length) { out.push(`\n<details>\n<summary>${en ? 'Answers' : 'Đáp án'}</summary>\n`); items.forEach((it, i) => out.push(`${i + 1}. ${str(it.a)}`)); out.push('\n</details>'); }
  }
  if (lec.refs?.length) { out.push(`\n## ${en ? 'Cited papers used for the comparison' : 'Các bài được dẫn dùng cho phần đối chiếu'}\n`); for (const r of lec.refs) out.push(`- ${r.title}${r.year ? ` (${r.year})` : ''}${r.influential ? ' ★' : ''}`); }
  return out.join('\n');
}

/* ---------- Xem bằng ngôn ngữ khác ---------- */

// Tên thuật ngữ, tên bài được dẫn, con số và vị trí trong bài giữ nguyên, không dịch.
const KEEP_KEYS = new Set(['term', 'paper', 'number', 'where']);

/** Mọi đoạn văn cần dịch: [{ path: [...], part, text }]. Trường nhiều đoạn được tách theo dòng trống để giữ ngắt đoạn. */
function collectStrings(sections) {
  const out = [];
  const walk = (node, path) => {
    if (typeof node === 'string') {
      node.split(/\n{2,}/).forEach((text, part) => { if (text.trim()) out.push({ path, part, text: text.trim() }); });
    } else if (Array.isArray(node)) node.forEach((x, i) => walk(x, [...path, i]));
    else if (node && typeof node === 'object') for (const k of Object.keys(node)) if (!KEEP_KEYS.has(k)) walk(node[k], [...path, k]);
  };
  for (const n of SECTION_ORDER) if (sections?.[n]) walk(sections[n], [n]);
  return out;
}

function fingerprint(fields) {
  let h = 0;
  const s = fields.map((f) => `${f.path.join('.')}#${f.part}=${f.text}`).join('␟');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${fields.length}:${h >>> 0}`;
}

function applyStrings(sections, fields, texts) {
  const out = structuredClone(sections);
  const groups = new Map();
  fields.forEach((f, i) => {
    const key = f.path.join('\u0000');
    if (!groups.has(key)) groups.set(key, { path: f.path, parts: [] });
    groups.get(key).parts.push(String(texts[i] ?? '').trim() || f.text);
  });
  for (const { path, parts } of groups.values()) {
    let cur = out;
    for (const k of path.slice(0, -1)) cur = cur[k];
    cur[path[path.length - 1]] = parts.join('\n\n');
  }
  return out;
}

/**
 * Bài giảng của paper bằng ngôn ngữ lang. Trả về { lecture, translated, engine, at }, hoặc null khi cachedOnly mà chưa có bản dịch.
 * Bản dịch lưu trong paper.lecture.tr[lang], dựng lại bài giảng thì bản dịch cũ tự mất hiệu lực.
 */
export async function lectureIn(paper, lang, { cachedOnly = false, translateAI = null } = {}) {
  const lec = paper.lecture;
  const src = lec.lang || 'vi';
  if (lang === src) return { lecture: lec, translated: false };
  const fields = collectStrings(lec.sections);
  const fp = fingerprint(fields);
  const cached = lec.tr?.[lang];
  const build = (texts) => ({ ...lec, sections: applyStrings(lec.sections, fields, texts), lang });
  if (cached?.fp === fp && cached.data && !translateAI) return { lecture: build(cached.data), translated: true, engine: cached.engine, at: cached.at };
  if (cachedOnly) return null;
  let texts;
  let engine;
  const guarded = fields.map((f) => protectMath(f.text)); // giữ nguyên công thức khi dịch
  if (translateAI) {
    texts = await translateAI(guarded.map((g) => g.text), src, lang);
    engine = 'AI';
  } else {
    const r = await api.translate(guarded.map((g) => g.text), lang, src);
    texts = r.items.map((x) => x.translated);
    engine = r.engine || 'Google';
  }
  texts = texts.map((x, i) => restoreMath(x, guarded[i].keep));
  const at = new Date().toISOString();
  const latest = paperById(paper.id) || paper;
  if (latest.lecture?.at === lec.at) await savePaper({ ...latest, lecture: { ...latest.lecture, tr: { ...(latest.lecture.tr || {}), [lang]: { fp, data: texts, engine, at } } } });
  return { lecture: build(texts), translated: true, engine, at };
}
