# PaperVault Extension cho Chrome / Edge

Extension đọc trang paper đang mở (arXiv, OpenReview, ACL Anthology…), trích xuất ghi chú bằng AI, xếp vào thư mục chủ đề và xuất bảng so sánh. Khi app PaperVault đang chạy, extension đẩy paper thẳng sang app.

← Về [README chính](../README.md)

## 1. Cài đặt

1. Mở `chrome://extensions` (hoặc `edge://extensions`).
2. Bật **Developer mode** (góc trên bên phải).
3. Bấm **Load unpacked** → chọn thư mục repo đã tải về (thư mục chứa `manifest.json`).
4. Ghim icon PaperVault ra thanh công cụ.

## 2. Cấu hình lần đầu

Vào **Cài đặt** (nút trong popup, hoặc chuột phải icon → Options):

| Mục | Ghi chú |
| --- | --- |
| Nhà cung cấp + API key | Claude (`claude-opus-5`), OpenAI (`gpt-4o`), hoặc Gemini (`gemini-2.0-flash`). Key lưu trong IndexedDB trên máy bạn. |
| **Đề tài của bạn** | Quan trọng nhất. Mô tả càng cụ thể, mục "Ý tưởng có thể áp dụng" càng bám sát bài của bạn. |
| Số ký tự tối đa | Mặc định 60.000. Full text dài hơn sẽ bị cắt phần giữa (giữ đầu + cuối vì Limitation thường nằm cuối). |
| Thư mục trên máy | Chọn thư mục gốc để ghi file `.md`. |

Bấm **Kiểm tra kết nối** để chắc chắn key/model hoạt động trước khi trích xuất thật.

## 3. Cách dùng

### Trích xuất từ trang đang mở
Mở paper → bấm icon PaperVault → **Trích xuất 5 mục** → xem lại → chọn thư mục chủ đề → **Lưu vào thư viện**.

Extension tự nhận diện:

| Trang | Lấy được |
| --- | --- |
| `arxiv.org/abs/...` | Abstract + metadata, đồng thời **tự thử tải bản HTML full text** (`arxiv.org/html/...`) nếu paper có |
| `arxiv.org/html/...`, `ar5iv` | Full text |
| `arxiv.org/pdf/...` | Tự chuyển sang lấy bản `/abs/` hoặc `/html/` của cùng arXiv ID |
| OpenReview, ACL Anthology | Title + abstract + metadata |
| Trang khác | Heuristic (`article` / `main` / `body`) |
| PDF bất kỳ | Bấm **Dùng file PDF của trang này** — extension tải file rồi gửi thẳng cho model |

### Trích xuất từ file PDF
Ba đường vào, dùng đường nào cũng được:

- Popup → tab **PDF / Dán text** → chọn hoặc kéo thả file `.pdf`.
- Thư viện → **+ Thêm paper** → chọn/kéo thả PDF. Kéo file vào **bất kỳ đâu trong trang thư viện** cũng được.
- Đang mở một PDF trên trình duyệt → popup → **Dùng file PDF của trang này**.

Với Claude và Gemini, file PDF được **gửi thẳng cho model**, nên model đọc được cả bảng kết quả và hình — mục Validation vì thế chính xác hơn hẳn so với đọc abstract. Với OpenAI (Chat Completions không nhận PDF), extension **tự trích text từ PDF** ngay trong trình duyệt rồi mới gửi; bộ trích text tự viết, không cần thư viện ngoài, có giải mã `/ToUnicode` CMap nên chữ ra đúng với phần lớn PDF sinh từ LaTeX. PDF bản scan (ảnh) thì không trích được text — hãy dùng Claude/Gemini cho trường hợp đó.

Giới hạn: 24MB mỗi file.

### Trích xuất từ text dán tay
Popup → tab **PDF / Dán text**, hoặc bôi đen đoạn text trên trang → chuột phải → *PaperVault: trích xuất đoạn đang chọn*.

### Thư viện
Nút **Thư viện** trong popup (hoặc chuột phải icon → mở thư viện):

- **Sidebar**: thư mục chủ đề, kèm số lượng; thêm / đổi tên / xoá.
- **Danh sách**: mỗi card hiển thị sẵn Điểm mới / Dataset-Metric / Ý tưởng áp dụng. Click để mở và **sửa mọi trường** (5 mục, bảng metric, note cá nhân, trạng thái, đánh giá sao).
- **So sánh**: bảng 4 cột đúng format bạn cần. Tick chọn vài paper để so sánh riêng, hoặc để trống để so sánh cả thư mục. **Copy bảng so sánh** cho ra Markdown dán thẳng vào Notion/Obsidian/Overleaf.
- **Chuyển thư mục** / **Xoá** hàng loạt cho nhiều paper đã tick, và **Dọn trùng** để gộp các bản trùng tên/link (giữ bản cập nhật gần nhất).
- Phím tắt: `/` để focus ô tìm kiếm, `Esc` để đóng modal.

### Phân loại chủ đề
Hai tầng gợi ý, luôn cho phép ghi đè thủ công:

1. **Local**: chấm điểm từ khoá của từng chủ đề trên title + abstract (cụm từ nhiều điểm hơn từ đơn, xuất hiện ở title được cộng thêm).
2. **LLM**: model chọn một tên trong danh sách chủ đề hiện có, hoặc đề xuất tên mới nếu không có mục nào hợp.

Dropdown xếp thư mục theo điểm gợi ý và luôn có mục **➕ Tạo thư mục mới**.

Sau khi trích xuất, khối xác nhận hiện ngay dưới kết quả: chọn thư mục → bấm lưu. Nếu paper đã có trong thư viện, extension báo trùng và cho chọn **cập nhật bản cũ** (giữ nguyên ghi chú cá nhân, trạng thái, đánh giá, ngày tạo) hay **lưu thành bản mới**; nút lưu tự khoá sau khi lưu xong nên không tạo bản trùng do bấm hai lần. Lỡ đóng popup giữa chừng thì mở lại sẽ có nút **Khôi phục** kết quả chưa lưu (giữ trong 20 phút).

15 chủ đề mặc định: VQA, Vision-Language & Multimodal LLM, Image Captioning, Object Detection, Segmentation, LLM & NLP, RAG & Retrieval, Generative & Diffusion, OCR & Document AI, Video Understanding, Speech & Audio, Efficiency & Compression, Training & Optimization, Dataset & Benchmark, Inbox.

## 4. Xuất dữ liệu

| Cách | Kết quả |
| --- | --- |
| **Đồng bộ thư mục** | `<gốc>/<Chủ đề>/<ten-paper>.md` + `_index.md` (có bảng so sánh) mỗi thư mục + `README.md` + `_bang-so-sanh-tat-ca.md` ở gốc |
| **Xuất → 1** | Một file Markdown gộp toàn bộ, nhóm theo chủ đề |
| **Xuất → 2** | Chỉ bảng so sánh (Markdown) |
| **Xuất → 3** | JSON sao lưu (nhập lại bằng **Nhập JSON**) |
| **Xuất → 4** | CSV bảng so sánh (mở được bằng Excel, có BOM nên không lỗi tiếng Việt) |
| **Copy Markdown** | Note đầy đủ của một paper vào clipboard |

Lưu ý: Chrome thu hồi quyền ghi thư mục sau khi đóng trình duyệt, nên mỗi phiên lần đầu bạn cần bấm **Đồng bộ thư mục** một lần để cấp lại quyền.

## 5. Cấu trúc mã nguồn

```
manifest.json
icons/
src/
  background/service-worker.js   điều phối scrape → LLM → lưu; context menu; tải thêm full text arXiv
  content/scrape.js              inject vào tab, adapter cho từng site
  common/
    db.js        IndexedDB: papers / topics / kv (settings, directory handle)
    llm.js       adapter Anthropic · OpenAI · Gemini (đều dùng structured output theo schema)
    schema.js    JSON Schema của bản trích xuất + chuẩn hoá dữ liệu
    prompts.js   system/user prompt (định nghĩa rõ 5 mục, cấm bịa số liệu)
    topics.js    chủ đề mặc định + thuật toán chấm điểm gợi ý
    markdown.js  render note, _index.md, bảng so sánh
    render.js    render 5 mục ra HTML (dùng chung popup + thư viện)
    pdf.js       đọc PDF: base64 cho model, và bộ trích text tự viết (inflate + /ToUnicode)
    fs.js        File System Access API
    theme.css    biến màu + component, tự đổi theo dark mode
  popup/ library/ options/
```

## 6. Ghi chú kỹ thuật

- **Structured output** dùng cho cả 3 provider: Anthropic `output_config.format.json_schema`, OpenAI `response_format.json_schema` (`strict: true`), Gemini `responseSchema` — nên kết quả luôn đúng schema thay vì phải đoán JSON từ văn bản (vẫn có parser dự phòng chịu được code fence).
- Gọi Anthropic từ trình duyệt cần header `anthropic-dangerous-direct-browser-access: true` — đã có sẵn.
- Không gửi `temperature` hay `budget_tokens` (Opus 5 / Sonnet 5 từ chối các tham số này); `output_config.effort` chỉ gửi cho các model Claude hỗ trợ.
- Chi phí tham khảo: một abstract ~1–2K token input; một full text bị cắt ở 60K ký tự ~15–20K token input. Nếu chỉ cần lướt nhanh, để **effort: low** hoặc dùng Haiku/Flash.
- PDF gửi cho model dưới dạng `document`/`inlineData` base64; file được cất tạm trong IndexedDB thay vì đẩy vài MB qua `chrome.runtime.sendMessage`, và bị xoá ngay sau khi trích xuất xong.
- Prompt yêu cầu model ghi `(chỉ dựa trên abstract)` và hạ `confidence` khi không có full text — bạn thấy ngay mức tin cậy trong popup và trên card.

## 7. Hạn chế đã biết

- PDF bản scan không có lớp text: chỉ dùng được với Claude/Gemini (gửi thẳng file), không trích text cục bộ được.
- Bộ trích text PDF là heuristic tự viết, không phải pdf.js: với font CID không kèm `/ToUnicode` thì chữ có thể ra ký tự lạ — extension có cảnh báo khi phát hiện.
- Đồng bộ thư mục là **ghi đè**, không xoá file của paper đã bị xoá trong extension — dọn thủ công nếu cần.
- Bảng metric trong note chỉ sửa được ở dạng dòng `metric | dataset | baseline | đề xuất | Δ` (đủ dùng, nhưng không phải trình soạn bảng).
