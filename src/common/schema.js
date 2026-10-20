// JSON Schema mô tả kết quả trích xuất. Dùng chung cho structured output của cả 3 provider.

const str = (description) => ({ type: 'string', description });
const strArr = (description) => ({ type: 'array', description, items: { type: 'string' } });

export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title', 'authors', 'venue', 'year', 'one_liner',
    'problem', 'bottleneck', 'key_idea', 'validation', 'limitation',
    'novelty', 'dataset_metric_note', 'applicable_ideas',
    'suggested_topic', 'alternative_topics', 'tags', 'confidence',
  ],
  properties: {
    title: str('Tên đầy đủ của paper, giữ nguyên tiếng Anh.'),
    authors: strArr('Tối đa 6 tác giả đầu; để mảng rỗng nếu không rõ.'),
    venue: str('Hội nghị/tạp chí hoặc "arXiv preprint"; chuỗi rỗng nếu không rõ.'),
    year: str('Năm công bố dạng "2024"; chuỗi rỗng nếu không rõ.'),
    one_liner: str('Một câu duy nhất tóm tắt toàn bộ paper.'),

    problem: str('PROBLEM: bài toán cụ thể nhóm tác giả muốn giải quyết, nêu rõ input/output và bối cảnh ứng dụng.'),
    bottleneck: str('BOTTLENECK: hạn chế cụ thể của các phương pháp SOTA hiện tại mà paper nhắm tới. Nêu tên phương pháp hoặc dòng phương pháp bị chỉ trích nếu paper có nhắc.'),

    key_idea: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'components'],
      properties: {
        summary: str('Ý tưởng cốt lõi trong 2-4 câu: cơ chế nào khắc phục bottleneck ở trên.'),
        components: {
          type: 'array',
          description: 'Các thành phần kỹ thuật: architecture, loss function, data augmentation, pipeline, training strategy.',
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

    validation: {
      type: 'object',
      additionalProperties: false,
      required: ['setup', 'datasets', 'benchmarks', 'metrics', 'ablation', 'main_results'],
      properties: {
        setup: str('Thiết kế thực nghiệm: backbone, dữ liệu huấn luyện, phần cứng, protocol so sánh.'),
        datasets: strArr('Tên các dataset được dùng.'),
        benchmarks: strArr('Tên các benchmark, leaderboard hoặc track được đánh giá.'),
        metrics: {
          type: 'array',
          description: 'Các con số quan trọng nhất, tối đa 8 mục.',
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
        main_results: str('Kết luận thực nghiệm tổng thể trong 1-3 câu.'),
      },
    },

    limitation: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'compute_cost', 'unresolved'],
      properties: {
        items: strArr('Từng hạn chế cụ thể. Nếu là bạn tự suy ra chứ tác giả không nêu, mở đầu bằng "(suy luận)".'),
        compute_cost: str('Chi phí tính toán: số tham số, GPU-hours, VRAM, thời gian inference. Ghi "Không nêu" nếu paper không đề cập.'),
        unresolved: str('Điểm chưa giải quyết triệt để hoặc hướng mở còn bỏ ngỏ.'),
      },
    },

    novelty: str('ĐIỂM MỚI: 1-2 câu súc tích, đúng thứ paper này có mà các paper trước không có. Dùng cho bảng so sánh.'),
    dataset_metric_note: str('DATASET/METRIC: một dòng ngắn gọn dạng "COCO, VQAv2 - mAP 54.2 (+2.1), 31 FPS". Dùng cho bảng so sánh.'),

    applicable_ideas: {
      type: 'array',
      description: 'Ý TƯỞNG CÓ THỂ ÁP DỤNG cho đề tài của người đọc, 2-4 ý. Nếu người đọc không mô tả đề tài, đưa ra ý tưởng tái sử dụng chung.',
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
    problem: '', bottleneck: '',
    key_idea: { summary: '', components: [] },
    validation: { setup: '', datasets: [], benchmarks: [], metrics: [], ablation: '', main_results: '' },
    limitation: { items: [], compute_cost: '', unresolved: '' },
    novelty: '', dataset_metric_note: '', applicable_ideas: [],
    suggested_topic: '', alternative_topics: [], tags: [], confidence: 'thấp',
  };
}

/** Chuẩn hoá dữ liệu model trả về để UI không phải kiểm tra null ở khắp nơi. */
export function normalizeExtraction(raw) {
  const base = emptyExtraction();
  const r = raw || {};
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : (v ? [String(v)] : []));
  return {
    ...base,
    ...r,
    authors: arr(r.authors),
    key_idea: { ...base.key_idea, ...(r.key_idea || {}), components: arr(r.key_idea && r.key_idea.components) },
    validation: {
      ...base.validation,
      ...(r.validation || {}),
      datasets: arr(r.validation && r.validation.datasets),
      benchmarks: arr(r.validation && r.validation.benchmarks),
      metrics: arr(r.validation && r.validation.metrics),
    },
    limitation: { ...base.limitation, ...(r.limitation || {}), items: arr(r.limitation && r.limitation.items) },
    applicable_ideas: arr(r.applicable_ideas),
    alternative_topics: arr(r.alternative_topics),
    tags: arr(r.tags).map((t) => String(t).toLowerCase()),
  };
}
