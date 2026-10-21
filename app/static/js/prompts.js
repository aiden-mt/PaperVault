// Prompt cho các tác vụ LLM: trích xuất ghi chú theo template đọc paper, hỏi đáp, tổng hợp related work.
import { clampText } from './util.js';

const FIELD_GUIDE = `Bản ghi chú đi theo template đọc paper của người đọc. Năm mục gốc Problem, Bottleneck, Key Idea, Validation, Limitation đã gộp vào các mục tương ứng nên không lặp lại:
1. Paper, 2. Venue/Year (title, authors, venue, year) - lấy đúng như trong paper / metadata.
3. Problem & Motivation (problem, motivation) - bài toán cụ thể với input/output, bối cảnh, và vì sao bài toán quan trọng.
4. Research Gap (bottleneck) - các nghiên cứu trước (SOTA) hạn chế gì, vấn đề nào chưa được giải quyết. Phải cụ thể (ví dụ: "attention toàn cục tốn O(n^2) nên không chạy được ảnh 4K"), không nói chung chung kiểu "chưa đủ tốt".
5. Research Question/Objective (objective) - mục tiêu chính và giả thuyết nghiên cứu nếu có.
6. Method (key_idea, novelty) - ý tưởng cốt lõi, các bước chính trong pipeline, mô hình/kỹ thuật được dùng (tách thành từng thành phần có tên gọi như trong paper), điểm khác biệt so với existing methods.
7. Contribution (contributions) - các đóng góp mới.
8. Dataset (dataset_details) - tên, nguồn, quy mô, đặc điểm, tiền xử lý / lọc của từng dataset.
9. Experiments (validation.setup, baselines, benchmarks, metrics, ablation) - thiết lập thí nghiệm, baseline, metric đánh giá, ablation study. Ưu tiên trích đúng con số trong bảng kết quả.
10. Findings (validation.metrics, findings, main_results) - kết quả định lượng quan trọng, phát hiện chính, kết quả nào trực tiếp hỗ trợ contribution.
11. Limitations (limitation) - hạn chế tác giả thừa nhận, hạn chế bạn nhận thấy khi phân tích (đánh dấu "(suy luận)"), vấn đề chưa giải quyết, chi phí tính toán.
12. Relevance to Our Work (relevance, applicable_ideas) - liên quan phần nào của đề tài người đọc, kế thừa được phương pháp nào, cải thiện / mở rộng ở đâu, trích dẫn paper để hỗ trợ luận điểm nào.
References (doi, code_url) - DOI và link code nếu có, không bịa link.
Important Evidence (evidence) - 3-8 claim quan trọng kèm vị trí cụ thể trong paper (Section, Table, Fig., trang) và mục đích trích dẫn.
Chuỗi lập luận (argument_chain) - 6-10 mắt xích từ tiền đề, khoảng trống, luận điểm, cách làm, bằng chứng đến kết luận, xếp theo thứ tự lý lẽ.
Lưu ý khi đọc (reader_warnings) - chỗ dễ hiểu nhầm hoặc khẳng định mạnh hơn bằng chứng.
Ngoài ra one_liner, dataset_metric_note và novelty là các dòng ngắn dùng cho bảng so sánh nhiều paper.`;

const RULES = `Quy tắc bắt buộc:
- CHỈ dựa vào nội dung được cung cấp. Không bịa số liệu, không bịa tên dataset, không bịa link. Thông tin không có trong văn bản thì để chuỗi rỗng / mảng rỗng hoặc ghi "Không nêu".
- Nếu chỉ nhận được abstract (không có full text), vẫn điền đủ các mục nhưng đặt confidence = "thấp" và ghi rõ "(chỉ dựa trên abstract)" ở các mục thiếu căn cứ. Khi đó evidence chỉ ghi các claim có trong abstract với vị trí "Abstract".
- Giữ nguyên tiếng Anh cho thuật ngữ chuyên ngành, tên phương pháp, tên dataset, tên metric. Phần diễn giải viết bằng {LANG}.
- Viết cô đọng như ghi chú nghiên cứu, không lặp lại câu chữ của abstract, không mở bài kiểu "Bài báo này...". Mỗi thông tin chỉ ghi ở một mục phù hợp nhất, không chép lại giữa các mục.
- Với các con số: ghi đúng dạng trong paper, kèm dataset tương ứng. Chỉ ghi con số có trong văn bản. Bảng kết quả chỉ thấy chú thích mà không thấy số thì ghi "Không nêu", không đoán số.
- Giữ đúng MỨC KHẲNG ĐỊNH của tác giả: may/might = "có thể", suggests/indicates = "cho thấy", we hypothesize = "giả thuyết rằng", tends to = "có xu hướng", up to X = "lên tới X". Không nâng thành "chứng minh", "chắc chắn", "luôn luôn", cũng không hạ xuống.
- Không viết câu rỗng. Phép thử: thay tên phương pháp bằng một từ vô nghĩa mà câu vẫn "đúng" thì câu đó không mang thông tin. "X cải thiện chất lượng nhờ cơ chế Y" phải nói rõ Y làm gì, cải thiện metric nào, bao nhiêu, trên dataset nào.
- Công thức và ký hiệu toán viết bằng LaTeX đặt trong cặp $...$, ví dụ $\\mathcal{L}_{VQA} = -\\sum_n \\log P_\\theta(y_n \\mid y_{<n}, x)$ hoặc $\\text{top-}p = 0.92$. Không viết công thức bằng ký tự Unicode rời (ℒ, ∑, θ đứng ngoài $...$). Tên mô hình, dataset thì viết thường, không đặt trong $...$.
- Một trường văn bản (chuỗi) có nhiều ý liệt kê thì mỗi ý một dòng riêng, bắt đầu bằng "1) ", "2) "…
- Phần tử của một MẢNG (pipeline, components, datasets, items…) KHÔNG tự đánh số, không gạch đầu dòng, không viết "Step 1:" ở đầu: app tự đánh số khi hiển thị.
- Trường văn bản dài hơn 3 câu thì chia đoạn: mỗi đoạn 2-3 câu, một ý, các đoạn cách nhau bằng một dòng trống (\\n\\n trong chuỗi JSON). Câu ngắn, khoảng 25 từ trở xuống.
- Chỉ trả về JSON đúng schema, không kèm giải thích hay code fence.`;

// Prompt và mô tả schema viết bằng tiếng Việt: khi đầu ra là tiếng Anh phải nói rõ các cụm cố định cũng viết tiếng Anh.
const ONLY_ENGLISH = `- OUTPUT LANGUAGE IS ENGLISH. Every string value in the JSON must be English only, with no Vietnamese word anywhere. The instructions above and the schema descriptions are written in Vietnamese; translate their fixed phrases instead of copying them: "Không nêu" -> "Not stated", "(suy luận)" -> "(inferred)", "(chỉ dựa trên abstract)" -> "(abstract only)". Only the confidence field keeps its enum value as given.`;

const langName = (settings) => (settings.language === 'en' ? 'English' : 'tiếng Việt');

/** Ngôn ngữ trả lời của Chat và tab Hỏi đáp (Cài đặt chatLang). Rỗng = theo ngôn ngữ trích xuất. */
export const CHAT_LANGS = [['', 'Theo ngôn ngữ trích xuất'], ['auto', 'Theo ngôn ngữ câu hỏi'], ['vi', 'Tiếng Việt'], ['en', 'English']];
function answerLangRule(settings) {
  const l = settings.chatLang || '';
  if (l === 'auto') return 'Trả lời bằng đúng ngôn ngữ của câu hỏi mới nhất: hỏi tiếng Việt thì trả lời tiếng Việt, hỏi tiếng Anh thì trả lời tiếng Anh, kể cả khi các lượt trước dùng ngôn ngữ khác.';
  const en = l === 'en' || (l !== 'vi' && settings.language === 'en');
  return en
    ? 'Answer in English, even when the question is written in Vietnamese and even if earlier turns used Vietnamese. Mark general knowledge that is not in the documents with "(outside the documents)".'
    : 'Trả lời bằng tiếng Việt, kể cả khi câu hỏi viết bằng tiếng Anh hoặc các lượt trước dùng tiếng Anh.';
}

/* ------------------------- Thuật ngữ khi trả lời bằng tiếng Việt (Hỏi đáp, Chat) ------------------------- */
// Lỗi hay gặp: dịch từng chữ thuật ngữ ("Tư duy Chuỗi" cho chain-of-thought, "mô hình giáo viên" cho teacher model),
// hoặc chen chữ của bảng chữ cái khác ("фakт"). Người đọc là nghiên cứu viên: câu tiếng Việt, thuật ngữ tiếng Anh.
const VI_TERM_RULES = `Quy tắc viết tiếng Việt cho nghiên cứu viên (BẮT BUỘC):
- Viết như một nghiên cứu viên người Việt nói trong seminar: câu và phần giải thích bằng tiếng Việt, còn thuật ngữ chuyên môn GIỮ NGUYÊN tiếng Anh. Phép thử: người trong ngành có nói từ đó bằng tiếng Anh không; có thì viết tiếng Anh.
- Luôn giữ tiếng Anh cho: tên phương pháp / mô hình / module / dataset / metric / thư viện do tác giả hoặc cộng đồng đặt; mọi chữ viết tắt (VQA, LLM, VLM, SOTA, QA, CoT, RAG, F1, mAP, BLEU); và các thuật ngữ như chain-of-thought, self-training, teacher model, student model, pseudo-label, pseudo-QA, data augmentation, knowledge distillation, fine-tuning, pre-training, instruction tuning, in-context learning, few-shot, zero-shot, prompt, embedding, encoder, decoder, backbone, attention, transformer, token, retrieval, grounding, hallucination, fact-checking, domain adaptation, out-of-distribution, robustness, benchmark, baseline, ablation study, loss, objective, inference, latency, throughput, checkpoint, pipeline, noise, filtering, consistency, calibration.
- CẤM dịch từng chữ thuật ngữ: không viết "Tư duy Chuỗi" (đúng: chain-of-thought), "mô hình giáo viên" (đúng: teacher model), "ví dụ miền ít" (đúng: few-shot examples), "tiếng ồn" cho noise trong dữ liệu (đúng: noise / nhãn nhiễu), "kiểm tra fakt" (đúng: fact-checking), "thích ứng miền" (đúng: domain adaptation).
- Cần giải thích thuật ngữ khó thì giữ tiếng Anh và chú nghĩa ngắn trong ngoặc đúng một lần ở lần đầu, ví dụ: pseudo-label (nhãn giả do mô hình tự sinh).
- Tiêu đề và chữ in đậm cũng theo quy tắc trên, ví dụ "**Kết hợp fact-checking dựa trên tri thức ngoài**", không phải "**Kết hợp với Kiểm tra Thông tin Bên ngoài**". Không viết hoa từng chữ trong tiêu đề tiếng Việt.
- Chỉ dùng chữ Latin (tiếng Việt có dấu và tiếng Anh). Tuyệt đối không chen chữ Kirin, Hy Lạp (trừ ký hiệu toán trong LaTeX), Hán, hay ký tự của ngôn ngữ khác vào giữa từ.`;
const EN_TERM_RULES = 'Use precise standard terminology of the field (keep method, model, dataset and metric names exactly as written by the authors). Use only Latin script.';

/** Quy tắc thuật ngữ theo ngôn ngữ trả lời (auto: cả hai, áp dụng theo ngôn ngữ của câu hỏi). */
function termRules(settings) {
  const l = settings.chatLang || '';
  if (l === 'auto') return `${VI_TERM_RULES}\n(Khi trả lời tiếng Anh: ${EN_TERM_RULES})`;
  const en = l === 'en' || (l !== 'vi' && settings.language === 'en');
  return en ? EN_TERM_RULES : VI_TERM_RULES;
}

/* ------------------------- Luật dịch học thuật (dùng cho "Dịch bằng AI") ------------------------- */
// Bốn chỗ dịch máy hay làm hỏng lập luận của paper: thuật ngữ trôi, mức khẳng định bị đổi, từ nối bị nuốt, văn dịch cứng.

const KEEP_FACTS = `Giữ nguyên, không dịch và không đổi: mọi con số, đơn vị, phần trăm; công thức và ký hiệu toán; tên mô hình, dataset, metric, thư viện; trích dẫn như (Zhao et al., 2021) hay [12]; link.
Cấm: thêm ý, bỏ ý, tóm tắt; bỏ phủ định (not, without, fail to); bỏ mệnh đề điều kiện (if, when, assuming); đảo chiều so sánh.`;

export const TRANSLATE_RULES_VI = `## Thuật ngữ: mặc định GIỮ NGUYÊN tiếng Anh
- Giữ tiếng Anh: tên do tác giả đặt (tên phương pháp, module, mô hình), mọi chữ viết tắt (RAG, LLM, SOTA, F1), và thuật ngữ giới nghiên cứu Việt vẫn gọi bằng tiếng Anh (transformer, embedding, token, prompt, baseline, benchmark, retrieval, encoder, decoder, attention, fine-tune, zero-shot, few-shot, pipeline, checkpoint, batch).
- Phép thử: một nghiên cứu viên người Việt có nói từ đó trong seminar không. Họ nói "retrieval" chứ không nói "truy hồi" thì viết retrieval.
- Chỉ dịch từ thường: mô hình, huấn luyện, dữ liệu, độ chính xác, thí nghiệm, kết quả, giả thuyết, đánh giá.
- Một thuật ngữ dùng MỘT cách gọi trong cả bản dịch. Thuật ngữ khó thì chú nghĩa trong ngoặc đúng một lần ở lần đầu.
- Các cụm hay dịch sai: state-of-the-art = tốt nhất hiện nay (hoặc SOTA); ablation study = thí nghiệm loại bỏ thành phần; downstream task = tác vụ ứng dụng; ground truth = nhãn chuẩn; trade-off = đánh đổi; extensive experiments = thí nghiệm trên diện rộng; in the wild = trong thực tế.

## Giữ đúng mức khẳng định
may / might / could = "có thể" (không phải "sẽ"); suggests / indicates = "cho thấy" (không phải "chứng minh"); we hypothesize = "chúng tôi giả thuyết rằng"; tends to = "có xu hướng"; appears to = "dường như"; up to X = "lên tới X"; often / typically giữ nguyên là "thường". significantly theo nghĩa thống kê = "có ý nghĩa thống kê". Cấm nâng lên và cấm hạ xuống.

## Giữ mạch lập luận
- Từ nối phải hiện rõ: However = "Tuy nhiên"; Thus / Therefore = "Do đó"; Moreover = "Hơn nữa"; In contrast = "Ngược lại"; Specifically = "Cụ thể là"; i.e. = "tức là".
- while / whereas chỉ sự đối lập thì dịch "trong khi đó", "còn". since / as chỉ nguyên nhân thì dịch "vì", "do".
- this / it / they mơ hồ thì thay bằng chính danh từ nó trỏ tới.
- Câu dài trên khoảng 35 từ thì tách thành 2-3 câu và chèn từ nối để quan hệ logic không mất.

## Viết như người Việt viết
Dịch ý, không dịch từng từ. Bỏ "sự / việc" thừa ("sự cải thiện của hiệu năng" thành "hiệu năng cải thiện"). Tránh chuỗi "của". Ưu tiên câu chủ động, không dùng "bị" cho câu trung tính. Tác giả tự xưng "chúng tôi".

## ${KEEP_FACTS}`;

export const TRANSLATE_RULES_OTHER = `Keep the strength of every claim exactly as written (may, suggests, tends to, up to): never strengthen or weaken it. Keep logical connectives explicit. Use one consistent rendering per technical term, and keep method, model, dataset and metric names, numbers, units, symbols, citations and links unchanged. Do not add, drop or summarise content; never drop negations or conditions, never reverse a comparison.`;

export const translateRules = (targetLang) => (targetLang === 'vi' ? TRANSLATE_RULES_VI : TRANSLATE_RULES_OTHER);

export function buildSystemPrompt(settings) {
  return [
    'Bạn là trợ lý đọc paper cho một nhà nghiên cứu. Nhiệm vụ: đọc nội dung paper và trích xuất một bản ghi chú có cấu trúc, chính xác, dùng được ngay khi viết related work.',
    '',
    FIELD_GUIDE,
    '',
    RULES.replace('{LANG}', langName(settings)),
    settings.language === 'en' ? ONLY_ENGLISH : '',
  ].filter(Boolean).join('\n');
}

export function buildUserPrompt({ source, settings, topicNames }) {
  const parts = [];
  parts.push('## Metadata thu được');
  parts.push(`- URL: ${source.url || '(không có)'}`);
  parts.push(`- Tiêu đề: ${source.title || '(không có)'}`);
  if (source.authors) parts.push(`- Tác giả: ${source.authors}`);
  if (source.venue) parts.push(`- Venue: ${source.venue}`);
  if (source.year) parts.push(`- Năm: ${source.year}`);
  if (source.arxivId) parts.push(`- arXiv ID: ${source.arxivId}`);
  parts.push(`- Loại nội dung bên dưới: ${source.kind || 'không rõ'}`);

  parts.push('');
  parts.push('## Danh sách thư mục chủ đề hiện có');
  parts.push(topicNames.length ? topicNames.map((n) => `- ${n}`).join('\n') : '- (chưa có)');
  parts.push('Hãy chọn suggested_topic là MỘT tên trong danh sách trên nếu phù hợp. Chỉ đề xuất tên chủ đề mới khi không có mục nào hợp lý.');

  parts.push('');
  parts.push('## Đề tài hiện tại của người đọc');
  parts.push(settings.myResearch?.trim()
    ? settings.myResearch.trim()
    : '(Người đọc chưa mô tả đề tài. Hãy đưa ra các ý tưởng có thể tái sử dụng ở mức tổng quát.)');
  parts.push('Mục relevance và applicable_ideas phải nối được paper này với đề tài trên: liên quan phần nào, mượn được kỹ thuật gì, cần sửa gì để dùng, trích dẫn để hỗ trợ luận điểm nào.');

  parts.push('');
  parts.push('## Nội dung paper');
  if (source.attachedPdf) {
    parts.push('Toàn văn paper nằm trong file PDF đính kèm ngay trước tin nhắn này. Hãy đọc trực tiếp từ đó, bao gồm cả bảng biểu và hình.');
  } else {
    parts.push('<paper>');
    parts.push(clampText(source.text, settings.maxInputChars));
    parts.push('</paper>');
  }
  return parts.join('\n');
}

/* ------------------------- Hỏi đáp về một paper ------------------------- */

export function buildAskSystem(settings) {
  return [
    'Bạn là trợ lý nghiên cứu. Người dùng hỏi về MỘT paper cụ thể. Trả lời ngắn gọn, có cấu trúc.',
    answerLangRule(settings),
    termRules(settings),
    'Chỉ dựa vào ghi chú đã trích xuất và nội dung paper được cung cấp. Nếu không đủ thông tin, nói rõ "paper không nêu" thay vì suy đoán; nếu suy luận thì đánh dấu "(suy luận)".',
    'Khi trích số liệu, kèm dataset/metric tương ứng. Có thể dùng Markdown (danh sách, bảng ngắn). Công thức viết bằng LaTeX trong $...$ (cùng dòng) hoặc $$...$$ (đứng riêng).',
  ].join('\n');
}

export function buildAskContext({ paper, text, settings }) {
  const parts = [];
  parts.push('## Ghi chú đã trích xuất');
  parts.push(JSON.stringify({ title: paper.title, url: paper.url, extraction: paper.extraction, userNotes: paper.userNotes || '' }, null, 1));
  if (settings.myResearch?.trim()) {
    parts.push('');
    parts.push('## Đề tài của người dùng');
    parts.push(settings.myResearch.trim());
  }
  if (text) {
    parts.push('');
    parts.push('## Nội dung paper');
    parts.push('<paper>');
    parts.push(clampText(text, Math.min(settings.maxInputChars || 60000, 80000)));
    parts.push('</paper>');
  }
  return parts.join('\n');
}

/* ------------------------- Tổng hợp related work ------------------------- */

const str = (description) => ({ type: 'string', description });
const strArr = (description) => ({ type: 'array', description, items: { type: 'string' } });

export const SYNTHESIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'themes', 'comparison', 'gaps', 'positioning', 'related_work_draft', 'next_steps'],
  properties: {
    overview: str('2-4 câu tổng quan: nhóm paper này cùng giải bài toán gì, xu hướng chung là gì.'),
    themes: {
      type: 'array',
      description: 'Các nhóm/hướng tiếp cận chính (2-5 nhóm).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'papers', 'summary'],
        properties: {
          name: str('Tên hướng tiếp cận.'),
          papers: strArr('Tên các paper thuộc nhóm (đúng tên trong danh sách).'),
          summary: str('Điểm chung, điểm khác nhau giữa các paper trong nhóm, 2-4 câu.'),
        },
      },
    },
    comparison: {
      type: 'array',
      description: 'So sánh theo từng khía cạnh: bài toán, dữ liệu, kiến trúc, kết quả, chi phí.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['aspect', 'notes'],
        properties: { aspect: str('Khía cạnh so sánh.'), notes: str('Nhận xét cụ thể, có nhắc tên paper và con số nếu có.') },
      },
    },
    gaps: strArr('Khoảng trống nghiên cứu rút ra từ limitation của các paper (3-6 ý).'),
    positioning: str('Đề tài của người đọc đứng ở đâu so với các paper này: kế thừa gì, khác gì, đóng góp tiềm năng.'),
    related_work_draft: str('Đoạn Related Work hoàn chỉnh (2-4 đoạn văn) có thể dán vào bài, trích dẫn dạng [Tên paper ngắn]. Viết bằng ngôn ngữ yêu cầu.'),
    next_steps: strArr('3-5 việc cụ thể nên làm tiếp: thí nghiệm, baseline cần chạy, dataset cần thử.'),
  },
};

export function buildSynthesisSystem(settings) {
  return [
    `Bạn là cộng sự nghiên cứu giàu kinh nghiệm. Nhiệm vụ: đọc ghi chú của nhiều paper và viết bản tổng hợp related work bằng ${langName(settings)}, giữ nguyên thuật ngữ tiếng Anh.`,
    'Chỉ dùng thông tin trong ghi chú. Không bịa số liệu. Khi so sánh phải nêu tên paper cụ thể.',
    'Chỉ trả về JSON đúng schema.',
  ].join('\n');
}

export function buildSynthesisUser({ papers, settings, focus }) {
  const parts = [];
  parts.push('## Đề tài của người đọc');
  parts.push(settings.myResearch?.trim() || '(chưa mô tả)');
  if (focus?.trim()) {
    parts.push('');
    parts.push('## Trọng tâm người đọc muốn nhấn mạnh');
    parts.push(focus.trim());
  }
  parts.push('');
  parts.push(`## Ghi chú của ${papers.length} paper`);
  for (const p of papers) {
    const e = p.extraction || {};
    parts.push('');
    parts.push(`### ${p.title}`);
    parts.push(JSON.stringify({
      venue: e.venue, year: e.year, one_liner: e.one_liner,
      problem: e.problem, bottleneck: e.bottleneck,
      key_idea: e.key_idea, validation: { datasets: e.validation?.datasets, metrics: e.validation?.metrics, main_results: e.validation?.main_results },
      contributions: e.contributions, findings: e.validation?.findings, limitation: e.limitation, novelty: e.novelty, dataset_metric_note: e.dataset_metric_note,
      applicable_ideas: e.applicable_ideas, tags: e.tags, userNotes: p.userNotes || '',
    }, null, 0));
  }
  return parts.join('\n');
}


/* ------------------------- Chat với nhiều paper ------------------------- */

const one = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Phần ổn định của system prompt (không đổi giữa các lượt -> cache được). */
export function buildChatSystem(settings) {
  return [
    'Bạn là trợ lý nghiên cứu. Người dùng đang trò chuyện về một tập paper do họ chọn; mỗi paper có nhãn như [P1], [P2].',
    answerLangRule(settings),
    termRules(settings),
    '',
    'Cách trả lời:',
    '- Dựa trên tài liệu về các paper được cung cấp. Mỗi ý lấy từ một paper phải gắn nhãn nguồn ngay sau câu, ví dụ: "... tăng 2.1 mAP [P2]". Nhiều nguồn thì ghi [P1][P3].',
    '- Nếu tài liệu không có thông tin để trả lời, nói rõ là các paper không nêu. Có thể bổ sung kiến thức chung nhưng phải ghi "(ngoài tài liệu)".',
    '- Khi so sánh nhiều paper, dùng bảng Markdown ngắn nếu giúp đọc nhanh hơn.',
    '- Trích số liệu đúng như trong tài liệu, kèm dataset và metric.',
    '- Công thức viết bằng LaTeX trong $...$ (cùng dòng) hoặc $$...$$ (đứng riêng).',
    '- Đi thẳng vào câu trả lời, không nhắc lại câu hỏi, không mở đầu xã giao.',
    settings.myResearch?.trim() ? `\nĐề tài của người dùng (dùng khi họ hỏi về khả năng áp dụng):\n${settings.myResearch.trim()}` : '',
  ].join('\n');
}

/** Ghi chú có cấu trúc của một paper, dạng văn bản gọn. */
export function paperNotesText(p, label) {
  const e = p.extraction || {};
  const v = e.validation || {};
  const lim = e.limitation || {};
  const vi = p.venueInfo || {};
  const venue = [vi.acronym || vi.name || e.venue, e.year, vi.rank && !vi.parent ? `CORE ${vi.rank}` : '', vi.quartile ? `SJR ${vi.quartile}` : ''].filter(Boolean).join(' · ');
  const lines = [
    `<paper id="${label}">`,
    `Tiêu đề: ${one(p.title)}`,
    e.authors?.length ? `Tác giả: ${e.authors.join(', ')}` : '',
    venue ? `Venue: ${venue}` : '',
    e.one_liner ? `Tóm tắt: ${one(e.one_liner)}` : '',
    e.problem ? `Problem: ${one(e.problem)}` : '',
    e.bottleneck ? `Bottleneck: ${one(e.bottleneck)}` : '',
    e.motivation ? `Motivation: ${one(e.motivation)}` : '',
    e.objective?.goal ? `Mục tiêu: ${one(e.objective.goal)}${e.objective.hypothesis && !/^không nêu/i.test(e.objective.hypothesis) ? ` · Giả thuyết: ${one(e.objective.hypothesis)}` : ''}` : '',
    e.key_idea?.summary ? `Key idea: ${one(e.key_idea.summary)}` : '',
    e.key_idea?.pipeline?.length ? `Pipeline: ${e.key_idea.pipeline.map(one).join(' → ')}` : '',
    ...(e.key_idea?.components || []).map((c) => `  - ${one(c.name)} (${c.kind || 'other'}): ${one(c.detail)}`),
    v.setup ? `Thiết kế thực nghiệm: ${one(v.setup)}` : '',
    v.datasets?.length ? `Dataset: ${v.datasets.join(', ')}` : '',
    v.benchmarks?.length ? `Benchmark: ${v.benchmarks.join(', ')}` : '',
    ...(v.metrics || []).filter((m) => m.name || m.proposed).map((m) => `  - ${one(m.name)} @ ${one(m.dataset)}: ${one(m.proposed)}${m.baseline ? ` (baseline ${one(m.baseline)})` : ''}${m.delta ? ` ${one(m.delta)}` : ''}`),
    v.baselines?.length ? `Baseline: ${v.baselines.join(', ')}` : '',
    v.ablation ? `Ablation: ${one(v.ablation)}` : '',
    v.findings?.length ? `Phát hiện chính: ${v.findings.map(one).join(' | ')}` : '',
    v.main_results ? `Kết luận thực nghiệm: ${one(v.main_results)}` : '',
    lim.items?.length ? `Limitation: ${lim.items.map(one).join(' | ')}` : '',
    lim.compute_cost ? `Chi phí tính toán: ${one(lim.compute_cost)}` : '',
    e.novelty ? `Điểm mới: ${one(e.novelty)}` : '',
    (e.argument_chain || []).length ? `Chuỗi lập luận: ${e.argument_chain.map((s) => `[${s.role}] ${one(s.step)}`).join(' → ')}` : '',
    (e.reader_warnings || []).length ? `Lưu ý khi đọc: ${e.reader_warnings.map(one).join(' | ')}` : '',
    e.contributions?.length ? `Đóng góp: ${e.contributions.map(one).join(' | ')}` : '',
    (e.dataset_details || []).length ? `Chi tiết dataset: ${e.dataset_details.map((d) => [d.name, d.scale, d.source].filter(Boolean).map(one).join(', ')).join(' | ')}` : '',
    e.code_url ? `Code: ${e.code_url}` : '',
    ...(e.evidence || []).slice(0, 8).map((x) => `  - Bằng chứng: ${one(x.claim)}${x.location ? ` (${one(x.location)})` : ''}`),
    e.applicable_ideas?.length ? `Ý tưởng áp dụng: ${e.applicable_ideas.map((i) => `${one(i.idea)} (${one(i.how_to_apply)})`).join(' | ')}` : '',
    p.userNotes?.trim() ? `Ghi chú của người dùng: ${one(p.userNotes).slice(0, 2000)}` : '',
    ...(p.annotations || []).slice(0, 20).map((a) => `  - Trích dẫn người dùng đánh dấu${a.page ? ` (tr. ${a.page})` : ''}: "${one(a.quote).slice(0, 400)}"${a.note ? ` — ${one(a.note)}` : ''}`),
  ];
  return lines.filter(Boolean).join('\n');
}
