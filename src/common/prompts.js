// Xây dựng system prompt + user prompt cho việc trích xuất paper.
import { clampText } from './util.js';

const FIELD_GUIDE = `Năm mục bắt buộc, hiểu theo đúng nghĩa sau:
1. Problem  - Bài toán cụ thể nhóm tác giả muốn giải quyết là gì? Nêu input/output, bối cảnh, vì sao đáng giải.
2. Bottleneck - Các phương pháp hiện tại (SOTA) đang gặp hạn chế gì? Phải cụ thể (ví dụ: "attention toàn cục tốn O(n^2) nên không chạy được ảnh 4K"), không nói chung chung kiểu "chưa đủ tốt".
3. Key Idea / Method - Ý tưởng cốt lõi để khắc phục hạn chế đó: architecture, loss function, data augmentation, pipeline, chiến lược huấn luyện. Tách thành từng thành phần có tên gọi như trong paper.
4. Validation - Thực nghiệm được thiết kế thế nào (dataset, benchmark, ablation study)? Kết quả cải thiện ở metric nào và cải thiện bao nhiêu (mAP, FPS, latency, memory, accuracy...). Ưu tiên trích đúng con số trong bảng kết quả.
5. Limitation - Giới hạn của bài báo, điểm chưa giải quyết triệt để, chi phí tính toán có quá cao không.`;

const RULES = `Quy tắc bắt buộc:
- CHỈ dựa vào nội dung được cung cấp. Không bịa số liệu, không bịa tên dataset. Thông tin không có trong văn bản thì để chuỗi rỗng hoặc ghi "Không nêu".
- Nếu chỉ nhận được abstract (không có full text), vẫn điền đủ các mục nhưng đặt confidence = "thấp" và ghi rõ "(chỉ dựa trên abstract)" ở các mục thiếu căn cứ.
- Giữ nguyên tiếng Anh cho thuật ngữ chuyên ngành, tên phương pháp, tên dataset, tên metric. Phần diễn giải viết bằng {LANG}.
- Viết cô đọng như ghi chú nghiên cứu, không lặp lại câu chữ của abstract, không mở bài kiểu "Bài báo này...".
- Với các con số: ghi đúng dạng trong paper, kèm dataset tương ứng.
- Chỉ trả về JSON đúng schema, không kèm giải thích hay code fence.`;

export function buildSystemPrompt(settings) {
  const lang = settings.language === 'en' ? 'English' : 'tiếng Việt';
  return [
    'Bạn là trợ lý đọc paper cho một nhà nghiên cứu. Nhiệm vụ: đọc nội dung paper và trích xuất một bản ghi chú có cấu trúc, chính xác, dùng được ngay khi viết related work.',
    '',
    FIELD_GUIDE,
    '',
    RULES.replace('{LANG}', lang),
  ].join('\n');
}

export function buildUserPrompt({ source, settings, topicNames }) {
  const parts = [];

  parts.push('## Metadata thu được từ trang web');
  parts.push(`- URL: ${source.url || '(không có)'}`);
  parts.push(`- Tiêu đề: ${source.title || '(không có)'}`);
  if (source.authors) parts.push(`- Tác giả: ${source.authors}`);
  if (source.venue) parts.push(`- Venue: ${source.venue}`);
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
  parts.push('Mục applicable_ideas phải nối được paper này với đề tài trên: mượn được kỹ thuật gì, cần sửa gì để dùng.');

  parts.push('');
  if (source.attachedPdf) {
    parts.push('## Nội dung paper');
    parts.push('Toàn văn paper nằm trong file PDF đính kèm ngay trước tin nhắn này. Hãy đọc trực tiếp từ đó, bao gồm cả bảng biểu và hình.');
  } else {
    parts.push('## Nội dung paper');
    parts.push('<paper>');
    parts.push(clampText(source.text, settings.maxInputChars));
    parts.push('</paper>');
  }

  return parts.join('\n');
}

/** Prompt rút gọn cho chức năng "hỏi nhanh" trên một paper đã lưu. */
export function buildAskPrompt(paper, question) {
  return [
    'Dưới đây là ghi chú đã trích xuất của một paper. Trả lời câu hỏi của người dùng chỉ dựa trên ghi chú này; nếu ghi chú không đủ thông tin, nói rõ là không đủ.',
    '',
    JSON.stringify({ title: paper.title, url: paper.url, extraction: paper.extraction }, null, 2),
    '',
    `Câu hỏi: ${question}`,
  ].join('\n');
}
