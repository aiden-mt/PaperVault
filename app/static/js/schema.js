// JSON Schema mô tả kết quả trích xuất. Dùng chung cho structured output của cả 3 provider.
// Cấu trúc theo template đọc paper (12 mục + References + Important Evidence), gộp với 5 mục gốc
// Problem / Bottleneck / Key Idea / Validation / Limitation: mục trùng nhau dùng chung một trường.

const str = (description) => ({ type: 'string', description });
const strArr = (description) => ({ type: 'array', description, items: { type: 'string' } });

export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title', 'authors', 'venue', 'year', 'one_liner',
    'problem', 'motivation', 'bottleneck', 'objective', 'key_idea', 'novelty', 'contributions',
    'dataset_details', 'validation', 'limitation', 'relevance', 'applicable_ideas',
    'doi', 'code_url', 'evidence', 'argument_chain', 'reader_warnings', 'dataset_metric_note',
    'suggested_topic', 'alternative_topics', 'tags', 'confidence',
  ],
  properties: {
    // 1-2. Paper, Venue/Year
    title: str('Tên đầy đủ của paper, giữ nguyên tiếng Anh.'),
    authors: strArr('Tối đa 6 tác giả đầu; để mảng rỗng nếu không rõ.'),
    venue: str('Hội nghị/tạp chí hoặc "arXiv preprint"; chuỗi rỗng nếu không rõ.'),
    year: str('Năm công bố dạng "2024"; chuỗi rỗng nếu không rõ.'),
    one_liner: str('Một câu duy nhất tóm tắt toàn bộ paper.'),

    // 3. Problem & Motivation
    problem: str('PROBLEM: nghiên cứu giải quyết bài toán cụ thể gì, nêu rõ input/output và bối cảnh ứng dụng.'),
    motivation: str('MOTIVATION: tại sao bài toán này quan trọng (ứng dụng, quy mô, chi phí, rủi ro nếu không giải quyết).'),

    // 4. Research Gap (= Bottleneck)
    bottleneck: str('RESEARCH GAP / BOTTLENECK: hạn chế cụ thể của các nghiên cứu trước (SOTA) mà paper nhắm tới, nêu tên phương pháp hoặc dòng phương pháp nếu có, và vấn đề nào vẫn chưa được giải quyết.'),

    // 5. Research Question / Objective
    objective: {
      type: 'object',
      additionalProperties: false,
      required: ['goal', 'hypothesis'],
      properties: {
        goal: str('Mục tiêu chính hoặc câu hỏi nghiên cứu của tác giả.'),
        hypothesis: str('Giả thuyết nghiên cứu cụ thể nếu paper nêu (tường minh hoặc ngầm định, khi ngầm định ghi "(suy luận)"). Ghi "Không nêu" nếu không có.'),
      },
    },

    // 6. Method (= Key Idea)
    key_idea: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'pipeline', 'components'],
      properties: {
        summary: str('Ý tưởng cốt lõi trong 2-4 câu: cơ chế nào khắc phục research gap ở trên.'),
        pipeline: strArr('Các bước chính trong pipeline theo thứ tự, mỗi bước một câu ngắn.'),
        components: {
          type: 'array',
          description: 'Mô hình / kỹ thuật được sử dụng: architecture, loss function, data augmentation, training strategy, inference.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'kind', 'detail'],
            properties: {
              name: str('Tên thành phần theo đúng cách gọi trong paper.'),
              kind: {
                type: 'string',
                description: 'Loại thành phần.',
                enum: ['architecture', 'loss', 'data', 'training', 'pipeline', 'inference', 'other'],
              },
              detail: str('Cách hoạt động, kèm công thức hoặc tham số quan trọng nếu có.'),
            },
          },
        },
      },
    },
    novelty: str('ĐIỂM KHÁC BIỆT so với existing methods: 1-2 câu súc tích, đúng thứ paper này có mà các paper trước không có. Dùng cho bảng so sánh.'),

    // 7. Contribution
    contributions: strArr('Những đóng góp mới của nghiên cứu, mỗi ý một đóng góp (phương pháp, dataset, benchmark, phân tích, mã nguồn...).'),

    // 8. Dataset
    dataset_details: {
      type: 'array',
      description: 'Các dataset dùng để huấn luyện / đánh giá.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'source', 'scale', 'characteristics', 'preprocessing'],
        properties: {
          name: str('Tên dataset.'),
          source: str('Nguồn gốc: công bố bởi ai / thu thập từ đâu / do paper tự xây dựng.'),
          scale: str('Quy mô: số mẫu, số lớp, số giờ, kích thước...; rỗng nếu không nêu.'),
          characteristics: str('Đặc điểm dữ liệu: modality, domain, độ phân giải, ngôn ngữ, phân bố nhãn...'),
          preprocessing: str('Tiền xử lý / lọc dữ liệu / chia tập train-val-test; "Không nêu" nếu không có.'),
        },
      },
    },

    // 9-10. Experiments + Findings (= Validation)
    validation: {
      type: 'object',
      additionalProperties: false,
      required: ['setup', 'baselines', 'benchmarks', 'metrics', 'ablation', 'findings', 'main_results'],
      properties: {
        setup: str('Experimental setup: backbone, dữ liệu huấn luyện, phần cứng, siêu tham số chính, protocol so sánh.'),
        baselines: strArr('Các phương pháp baseline được so sánh.'),
        benchmarks: strArr('Tên các benchmark, leaderboard hoặc track được đánh giá.'),
        metrics: {
          type: 'array',
          description: 'Kết quả định lượng quan trọng nhất (evaluation metrics), tối đa 8 mục.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'dataset', 'baseline', 'proposed', 'delta'],
            properties: {
              name: str('Tên metric: mAP, FPS, latency, memory, Accuracy, CIDEr, WER.'),
              dataset: str('Dataset hoặc benchmark tương ứng; rỗng nếu không rõ.'),
              baseline: str('Giá trị của phương pháp so sánh; rỗng nếu paper không nêu.'),
              proposed: str('Giá trị của phương pháp đề xuất.'),
              delta: str('Mức cải thiện, ví dụ "+2.3 mAP" hoặc "-35% latency".'),
            },
          },
        },
        ablation: str('Ablation study kiểm chứng điều gì và rút ra kết luận gì. Ghi "Không có" nếu paper không làm.'),
        findings: strArr('Những phát hiện chính từ thí nghiệm (kể cả phân tích định tính), mỗi ý một phát hiện.'),
        main_results: str('Kết quả nào trực tiếp hỗ trợ contribution, 1-3 câu, nêu con số.'),
      },
    },
    dataset_metric_note: str('DATASET/METRIC: một dòng ngắn gọn dạng "COCO, VQAv2 - mAP 54.2 (+2.1), 31 FPS". Dùng cho bảng so sánh.'),

    // 11. Limitations
    limitation: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'compute_cost', 'unresolved'],
      properties: {
        items: strArr('Từng hạn chế cụ thể. Hạn chế tác giả thừa nhận ghi bình thường. Hạn chế bạn tự nhận thấy khi phân tích thì mở đầu bằng "(suy luận)".'),
        compute_cost: str('Chi phí tính toán: số tham số, GPU-hours, VRAM, thời gian inference. Ghi "Không nêu" nếu paper không đề cập.'),
        unresolved: str('Những vấn đề chưa được giải quyết triệt để hoặc hướng mở còn bỏ ngỏ.'),
      },
    },

    // 12. Relevance to Our Work
    relevance: {
      type: 'object',
      additionalProperties: false,
      required: ['project_part', 'extend_or_improve', 'citation_claims'],
      properties: {
        project_part: str('Nghiên cứu này liên quan đến phần nào trong đề tài của người đọc. Người đọc chưa mô tả đề tài thì nêu bài toán / hướng nghiên cứu mà paper hữu ích.'),
        extend_or_improve: str('Có thể cải thiện hoặc mở rộng paper này ở đâu (gắn với đề tài của người đọc nếu có).'),
        citation_claims: strArr('Các luận điểm mà paper này có thể được trích dẫn để hỗ trợ khi viết bài, mỗi ý một luận điểm.'),
      },
    },
    applicable_ideas: {
      type: 'array',
      description: 'Có thể KẾ THỪA phương pháp / kỹ thuật nào cho đề tài của người đọc, 2-4 ý. Nếu người đọc không mô tả đề tài, đưa ra ý tưởng tái sử dụng chung.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['idea', 'how_to_apply', 'effort'],
        properties: {
          idea: str('Kỹ thuật hoặc ý tưởng cụ thể có thể mượn lại.'),
          how_to_apply: str('Áp dụng vào đề tài của người đọc như thế nào, cần đổi gì.'),
          effort: { type: 'string', description: 'Công sức triển khai ước lượng.', enum: ['thấp', 'trung bình', 'cao'] },
        },
      },
    },

    // References
    doi: str('DOI của paper nếu có trong metadata hoặc nội dung; rỗng nếu không thấy. Không bịa.'),
    code_url: str('Link code / GitHub / project page nếu paper có nêu; rỗng nếu không thấy. Không bịa.'),

    // Important Evidence
    evidence: {
      type: 'array',
      description: 'IMPORTANT EVIDENCE: 3-8 claim hoặc kết quả quan trọng nhất kèm vị trí trong paper, dùng khi trích dẫn.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'location', 'purpose'],
        properties: {
          claim: str('Claim / evidence, viết ngắn gọn, kèm con số nếu có.'),
          location: str('Vị trí cụ thể: Section 4.2, Table 3, Fig. 5, tr. 7. Ghi "Không rõ" nếu không xác định được.'),
          purpose: str('Mục đích trích dẫn: dùng để hỗ trợ luận điểm gì, so sánh gì.'),
        },
      },
    },

    // Mạch lập luận và chỗ cần dè chừng (ý tưởng từ Loupe)
    argument_chain: {
      type: 'array',
      description: 'CHUỖI LẬP LUẬN của paper: 6-10 mắt xích xếp theo thứ tự lý lẽ (không nhất thiết theo thứ tự trang). Đọc xong phải hiểu vì sao kết luận hợp lý, hoặc chỗ nào lý lẽ còn hở.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['step', 'role', 'section'],
        properties: {
          step: str('Một mắt xích, viết thành câu hoàn chỉnh, có nội dung cụ thể.'),
          role: { type: 'string', description: 'Vai của mắt xích trong lập luận.', enum: ['premise', 'gap', 'claim', 'method', 'evidence', 'conclusion'] },
          section: str('Tên section trong paper chứa mắt xích này; rỗng nếu không rõ.'),
        },
      },
    },
    reader_warnings: strArr('LƯU Ý KHI ĐỌC: 0-5 chỗ dễ hiểu nhầm, hoặc khẳng định nghe mạnh hơn bằng chứng thực tế (ví dụ chỉ thử trên một dataset, baseline yếu, cải thiện nằm trong sai số). Mảng rỗng nếu không có.'),

    suggested_topic: str('Tên thư mục chủ đề phù hợp nhất. Ưu tiên chọn đúng một tên trong danh sách chủ đề đã có; chỉ đề xuất tên mới khi thực sự không có chủ đề nào phù hợp.'),
    alternative_topics: strArr('Tối đa 2 chủ đề thay thế.'),
    tags: strArr('3-6 từ khoá ngắn, tiếng Anh, chữ thường.'),
    confidence: { type: 'string', description: 'Độ tin cậy của bản trích xuất này.', enum: ['cao', 'trung bình', 'thấp'] },
  },
};

/** Gemini responseSchema không chấp nhận additionalProperties hoặc $schema. */
export function toGeminiSchema(node) {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'additionalProperties' || k === '$schema') continue;
      out[k] = toGeminiSchema(v);
    }
    if (out.type === 'object' && out.properties) out.propertyOrdering = Object.keys(out.properties);
    return out;
  }
  return node;
}

/** Khung dữ liệu rỗng, dùng khi người dùng tạo note thủ công. */
export function emptyExtraction() {
  return {
    title: '', authors: [], venue: '', year: '', one_liner: '',
    problem: '', motivation: '', bottleneck: '',
    objective: { goal: '', hypothesis: '' },
    key_idea: { summary: '', pipeline: [], components: [] },
    novelty: '', contributions: [],
    dataset_details: [],
    validation: { setup: '', baselines: [], datasets: [], benchmarks: [], metrics: [], ablation: '', findings: [], main_results: '' },
    dataset_metric_note: '',
    limitation: { items: [], compute_cost: '', unresolved: '' },
    relevance: { project_part: '', extend_or_improve: '', citation_claims: [] },
    applicable_ideas: [],
    doi: '', code_url: '', evidence: [], argument_chain: [], reader_warnings: [],
    suggested_topic: '', alternative_topics: [], tags: [], confidence: 'thấp',
  };
}

/** Chuẩn hoá dữ liệu model trả về để UI không phải kiểm tra null ở khắp nơi. */
export function normalizeExtraction(raw) {
  const base = emptyExtraction();
  const r = raw || {};
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : (v ? [String(v)] : []));
  const v = r.validation || {};
  const details = arr(r.dataset_details).filter((d) => d && typeof d === 'object' && d.name);
  // validation.datasets (chỉ tên) vẫn dùng cho tìm kiếm, lọc, paper liên quan: lấy từ dataset_details nếu có.
  const datasetNames = details.length ? details.map((d) => String(d.name).trim()).filter(Boolean) : arr(v.datasets);
  return {
    ...base,
    ...r,
    authors: arr(r.authors),
    objective: { ...base.objective, ...(r.objective || {}) },
    key_idea: {
      ...base.key_idea,
      ...(r.key_idea || {}),
      pipeline: arr(r.key_idea && r.key_idea.pipeline),
      components: arr(r.key_idea && r.key_idea.components),
    },
    contributions: arr(r.contributions),
    dataset_details: details,
    validation: {
      ...base.validation,
      ...v,
      baselines: arr(v.baselines),
      datasets: datasetNames,
      benchmarks: arr(v.benchmarks),
      metrics: arr(v.metrics),
      findings: arr(v.findings),
    },
    limitation: { ...base.limitation, ...(r.limitation || {}), items: arr(r.limitation && r.limitation.items) },
    relevance: { ...base.relevance, ...(r.relevance || {}), citation_claims: arr(r.relevance && r.relevance.citation_claims) },
    applicable_ideas: arr(r.applicable_ideas),
    evidence: arr(r.evidence).filter((x) => x && typeof x === 'object' && (x.claim || x.location)),
    argument_chain: arr(r.argument_chain).filter((x) => x && typeof x === 'object' && x.step),
    reader_warnings: arr(r.reader_warnings).map(String),
    alternative_topics: arr(r.alternative_topics),
    tags: arr(r.tags).map((t) => String(t).toLowerCase()),
  };
}

/** Tách hạn chế tác giả thừa nhận và hạn chế "(suy luận)" / "(inferred)" do phân tích. */
export function splitLimitations(items) {
  const inferred = /^\s*\((suy luận|inferred)\)\s*/i;
  const stated = [];
  const observed = [];
  for (const it of items || []) (inferred.test(it) ? observed : stated).push(String(it).replace(inferred, ''));
  return { stated, observed };
}
