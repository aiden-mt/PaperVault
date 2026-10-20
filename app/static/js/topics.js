// Danh sách chủ đề mặc định + thuật toán gợi ý thư mục (local, không tốn token).

export const DEFAULT_TOPICS = [
  { id: 't_vqa', name: 'VQA', color: '#5b8def',
    description: 'Visual Question Answering, TextVQA, ChartQA, DocVQA...',
    keywords: ['vqa', 'visual question answering', 'question answering over images', 'textvqa', 'gqa', 'okvqa', 'docvqa', 'chartqa', 'vizwiz', 'answer', 'question'] },
  { id: 't_vlm', name: 'Vision-Language & Multimodal LLM', color: '#7c5cff',
    description: 'CLIP, BLIP, LLaVA, Qwen-VL, multimodal alignment.',
    keywords: ['vision-language', 'multimodal', 'clip', 'blip', 'llava', 'qwen-vl', 'image-text', 'cross-modal', 'visual instruction tuning', 'mllm', 'lmm'] },
  { id: 't_caption', name: 'Image Captioning', color: '#00a3a3',
    description: 'Sinh mô tả ảnh, dense captioning.',
    keywords: ['captioning', 'caption', 'image description', 'cider', 'coco caption', 'dense caption'] },
  { id: 't_det', name: 'Object Detection', color: '#e8873a',
    description: 'Detection, DETR, YOLO, open-vocabulary detection.',
    keywords: ['detection', 'detector', 'yolo', 'detr', 'faster r-cnn', 'bounding box', 'map', 'anchor', 'open-vocabulary detection', 'grounding'] },
  { id: 't_seg', name: 'Segmentation', color: '#3aa06a',
    description: 'Semantic / instance / panoptic segmentation, SAM.',
    keywords: ['segmentation', 'segment anything', 'sam', 'mask', 'miou', 'panoptic', 'instance segmentation', 'semantic segmentation'] },
  { id: 't_llm', name: 'LLM & NLP', color: '#c2557a',
    description: 'Language model, instruction tuning, reasoning, alignment.',
    keywords: ['language model', 'llm', 'transformer', 'instruction tuning', 'rlhf', 'dpo', 'chain-of-thought', 'reasoning', 'tokenizer', 'perplexity', 'alignment'] },
  { id: 't_rag', name: 'RAG & Retrieval', color: '#8a6d3b',
    description: 'Retrieval-augmented generation, dense retrieval, re-ranking.',
    keywords: ['retrieval', 'rag', 'retriever', 'dense passage', 'reranking', 'knowledge base', 'vector database', 'bm25', 'recall@k'] },
  { id: 't_gen', name: 'Generative & Diffusion', color: '#b45cd6',
    description: 'Diffusion, GAN, text-to-image, video generation.',
    keywords: ['diffusion', 'gan', 'text-to-image', 'stable diffusion', 'denoising', 'fid', 'generative', 'latent diffusion', 'flow matching'] },
  { id: 't_ocr', name: 'OCR & Document AI', color: '#4a7c8c',
    description: 'OCR, layout understanding, table/form extraction.',
    keywords: ['ocr', 'text recognition', 'document understanding', 'layout', 'table recognition', 'scene text', 'handwritten', 'form parsing'] },
  { id: 't_video', name: 'Video Understanding', color: '#d05353',
    description: 'Action recognition, temporal grounding, video QA.',
    keywords: ['video', 'temporal', 'action recognition', 'frame', 'spatio-temporal', 'video qa', 'tracking'] },
  { id: 't_speech', name: 'Speech & Audio', color: '#2f8f9d',
    description: 'ASR, TTS, audio representation.',
    keywords: ['speech', 'asr', 'audio', 'tts', 'whisper', 'phoneme', 'wer', 'acoustic'] },
  { id: 't_eff', name: 'Efficiency & Compression', color: '#6b7280',
    description: 'Quantization, pruning, distillation, PEFT, tốc độ/bộ nhớ.',
    keywords: ['quantization', 'pruning', 'distillation', 'lora', 'peft', 'efficient', 'latency', 'throughput', 'flops', 'memory footprint', 'kv cache', 'inference speed'] },
  { id: 't_train', name: 'Training & Optimization', color: '#3f6f4f',
    description: 'Loss function, optimizer, self-supervised, curriculum.',
    keywords: ['loss function', 'optimizer', 'self-supervised', 'contrastive learning', 'pretraining', 'data augmentation', 'curriculum', 'regularization', 'schedule'] },
  { id: 't_data', name: 'Dataset & Benchmark', color: '#8c7b3f',
    description: 'Bộ dữ liệu mới, benchmark, evaluation protocol.',
    keywords: ['dataset', 'benchmark', 'annotation', 'evaluation protocol', 'we release', 'we introduce a new dataset', 'test set', 'human evaluation'] },
  { id: 't_inbox', name: 'Inbox (chưa phân loại)', color: '#9aa0a6',
    description: 'Nơi chứa tạm các paper chưa quyết định chủ đề.',
    keywords: [] },
];

/**
 * Chấm điểm chủ đề dựa trên tần suất keyword trong title/abstract/tags.
 * Trả về mảng { topicId, name, score } đã sắp giảm dần.
 */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Regex khớp nguyên từ/cụm từ (cho phép số nhiều), tránh "frame" khớp "framework", "map" khớp "mapping". */
function keywordRegex(k) {
  return new RegExp('(?<![a-z0-9])' + escapeRegExp(k) + '(?:s|es)?(?![a-z0-9])', 'g');
}

export function scoreTopics(text, topics) {
  const hay = String(text || '').toLowerCase();
  if (!hay.trim()) return [];
  const title = hay.slice(0, 300); // trọng số cao hơn cho phần đầu (title + abstract mở đầu)
  const out = [];
  for (const t of topics) {
    let score = 0;
    for (const kw of t.keywords || []) {
      const k = kw.toLowerCase();
      if (!k) continue;
      const rx = keywordRegex(k);
      const hits = (hay.match(rx) || []).length;
      if (!hits) continue;
      const weight = k.includes(' ') ? 3 : 1.5;      // cụm từ đặc trưng hơn từ đơn
      const titleBonus = (title.match(keywordRegex(k)) || []).length ? 4 : 0;
      score += Math.min(hits, 5) * weight + titleBonus;
    }
    if (score > 0) out.push({ topicId: t.id, name: t.name, score: Math.round(score * 10) / 10 });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Kết hợp gợi ý local với tên chủ đề do LLM đề xuất.
 * Trả về { topicId, isNew, newName, ranked }.
 */
export function suggestTopic({ text, topics, llmTopicName }) {
  const ranked = scoreTopics(text, topics);
  if (llmTopicName) {
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    const match = topics.find((t) => norm(t.name) === norm(llmTopicName));
    if (match) {
      const existing = ranked.find((r) => r.topicId === match.id);
      if (existing) existing.score += 8;
      else ranked.unshift({ topicId: match.id, name: match.name, score: 8 });
      ranked.sort((a, b) => b.score - a.score);
    } else {
      return { topicId: ranked[0]?.topicId || 't_inbox', isNew: true, newName: llmTopicName, ranked };
    }
  }
  return { topicId: ranked[0]?.topicId || 't_inbox', isNew: false, newName: null, ranked };
}
