# PaperVault App — ứng dụng quản lý & tổng hợp paper

Phiên bản ứng dụng độc lập của extension PaperVault. Chạy trên máy bạn bằng Python (không cần cài thêm thư viện), mở trong trình duyệt bất kỳ, dữ liệu lưu trong SQLite trên đĩa.

So với extension, app có thêm:

| Nhóm | Chức năng |
| --- | --- |
| Thêm paper | Một paper từ arXiv ID, link, DOI, PDF hoặc text. PDF chỉ nhận qua trang Thêm paper (bấm chọn file hoặc thả vào đúng ô), thả file ở trang khác không nhập nhầm. Máy chủ tự tải abstract, toàn văn arXiv HTML và PDF. Nhập file .bib / .ris từ Zotero, Mendeley. Hộp thư nhận paper từ extension. |
| Thêm hàng loạt | Luồng ba bước có thanh tiến trình: **đưa nguồn vào** (dán văn bản bất kỳ để lọc link arXiv/DOI/OpenReview/ACL/PDF, hoặc thả nhiều PDF, cả thư mục), **duyệt** (app tự tra tiêu đề, venue, hạng, trùng lặp miễn phí; mỗi paper là một thẻ có nút *Thêm* / *Bỏ qua*, tab lọc Sẽ thêm / Đã có / Cần xử lý / Đã lưu, thư mục cho từng paper), **lưu** (một nút ở thanh dưới, tuỳ chọn trích xuất ghi chú bằng AI, có tiến trình và nút Dừng). |
| Venue & xếp hạng | Tự nhận diện hội nghị, workshop, Findings, tạp chí, chương sách, book series, preprint, luận văn. Hạng hội nghị theo **CORE/ICORE2026** (A*, A, B, C), tạp chí theo **Scimago SJR 2025** (Q1–Q4, SJR, H-index). Workshop/Findings hiện hạng hội nghị chủ ở dạng mờ. Lọc, sắp xếp theo hạng, sửa tay, cập nhật bảng trực tuyến. |
| Chat với paper | Ba cột: lịch sử hội thoại (ngăn trượt khi cửa sổ hẹp), khung chat, bảng **Nguồn** liệt kê paper kèm venue, hạng và cho biết có toàn văn hay chỉ ghi chú. Bộ chọn ngay trong bảng Nguồn: tìm, lọc theo chủ đề / hạng / có toàn văn, thêm cả kết quả lọc. Hội thoại mới có màn hình bắt đầu (dùng paper đang tick, chọn cả chủ đề, tìm từng paper). Nhãn [P1] cố định, bấm để mở paper. Ba mức ngữ cảnh, streaming, prompt-cache với Claude, lưu và xuất .md. |
| Hướng dẫn trong app | Trang Hướng dẫn có mục lục và tìm kiếm, nút **?** trên thanh trên cùng mở đúng mục của trang đang xem, danh sách "Bắt đầu với PaperVault" trên Tổng quan. |
| Thư viện | Danh sách / kanban / bảng. Tìm cả trong toàn văn (FTS5). Lọc theo chủ đề, nhãn phụ, trạng thái, đánh giá, tag, năm, loại venue, hạng. Ô *Chọn tất cả* kiểu Gmail ngay trên cột tick (ba trạng thái, menu chọn nhanh theo trạng thái / có PDF / chưa trích xuất / đảo chọn), thanh thao tác hàng loạt chỉ hiện khi có paper được tick. *Khác → Trích xuất lại ghi chú (AI)* chạy lại trích xuất cho nhiều paper (lần lượt, có tiến trình và nút Dừng, chạy tiếp khi chuyển trang, tuỳ chọn bỏ qua paper đã có ghi chú theo template mới), menu chọn nhanh có thêm *Chưa có ghi chú theo template*. Dọn trùng, thùng rác 30 ngày có hoàn tác, phím j/k/Enter/x. |
| Ghi chú theo template | Mỗi lần trích xuất, model điền bản ghi chú có cấu trúc theo template đọc paper: 1–2 Paper, Venue/Year · 3 Problem & Motivation · 4 Research Gap · 5 Research Question/Objective · 6 Method (ý tưởng, pipeline, kỹ thuật, điểm khác biệt) · 7 Contribution · 8 Dataset (bảng tên, nguồn, quy mô, đặc điểm, tiền xử lý) · 9 Experiments · 10 Findings · 11 Limitations (tác giả thừa nhận / tự phân tích) · 12 Relevance to Our Work · References (DOI, code) · Important Evidence (claim, vị trí, mục đích trích dẫn). Năm mục cũ Problem / Bottleneck / Key Idea / Validation / Limitation được gộp vào các mục tương ứng, không lặp. Nút *Tiếng Việt / English* ở tab Ghi chú đổi ngôn ngữ hiển thị: app tự dịch (Google miễn phí, lưu lại trong paper, tự dịch lại khi ghi chú thay đổi), có nút dịch lại bằng AI. Copy Markdown theo ngôn ngữ đang xem. |
| Kiểm tra ghi chú | Hai phép kiểm cơ học, không tốn token (ý tưởng từ Loupe): **đối chiếu số liệu** (mọi con số trong ghi chú phải có trong toàn văn, không thấy thì cảnh báo kèm mục chứa nó, tự đọc chữ từ PDF bằng PDF.js khi chưa có toàn văn) và **bắt câu chung chung** ("cải thiện" mà không nói bằng cách nào, cụm rỗng, mô tả lặp lại tên). Chat cũng dò số liệu trong câu trả lời với tài liệu đã gửi. Bản trích xuất có thêm *Chuỗi lập luận* và *Lưu ý khi đọc*. Dịch bằng AI dùng luật dịch học thuật: giữ thuật ngữ tiếng Anh, giữ mức khẳng định, giữ từ nối. |
| Dịch khi đọc PDF | Tab PDF dùng PDF.js (kế thừa extension *Dịch Khi Bôi Đen*): bôi đen chữ → nút 文 → bản dịch theo ngữ cảnh câu (Google miễn phí qua máy chủ app, không tốn token), câu ngữ cảnh đánh dấu ⟦ ⟧ ngay trên PDF. Bong bóng có *Dịch bằng AI* (mô hình đang dùng, văn phong học thuật) và *+ Ghi chú* (lưu đoạn gốc, bản dịch, số trang vào Trích dẫn của paper). Tuỳ chọn ngôn ngữ đích, kích hoạt bằng nút / tự động, rê chuột / bấm, ngay trên thanh trình đọc hoặc trong Cài đặt. |
| Tô sáng, gạch chân, tìm PDF | Thanh công cụ trình đọc có bút tô sáng, gạch chân, cục tẩy (tẩy một phần hoặc cả nét), hoàn tác / làm lại (Ctrl+Z, Ctrl+Y) và 5 màu: bật rồi bôi đen chữ là đánh dấu, lưu trong paper (không sửa file), bấm vào nét để dịch / lưu ghi chú / đổi màu / xoá. Nét vẽ, chữ, chữ ký của PDF.js lưu vào file bằng nút *Lưu nét vẽ vào PDF*. Paper chưa có PDF: app tự tìm bản công khai (link & DOI của paper, Semantic Scholar, OpenAlex, arXiv theo tên, CVF, NeurIPS, PMLR, ACL Anthology) để tải một chạm, hoặc tìm hàng loạt từ Thư viện (*Khác → Tìm & tải PDF*). |
| Tô câu đáng nhớ | Nút *✦ Tô câu đáng nhớ* trong tab PDF: mô hình đọc toàn văn rồi tô câu theo năm loại (luận điểm, cơ chế, bằng chứng, giới hạn, thuật ngữ), mỗi loại một màu, kèm lý do. Câu không khớp nguyên văn trong PDF bị bỏ. Thẻ *Câu đáng nhớ* ở tab Ghi chú liệt kê theo loại, bấm số trang để mở đúng trang. |
| Đồ thị trích dẫn 3D | Tab Liên quan → *🕸 Đồ thị 3D*: bài gốc, bài tham khảo, bài dẫn và cạnh giữa chúng (lấy bằng một request batch của Semantic Scholar), vẽ bằng 3d-force-graph đóng gói sẵn (`static/vendor/force-graph-3d`). Lọc, tô màu theo năm, tìm, bấm để xem chi tiết hoặc thêm vào thư viện. |
| Có gì mới kể từ bài này | Tab Liên quan: mô hình đọc tóm tắt và câu trích dẫn của tối đa 30 paper dẫn bài, tổng hợp giới hạn đã được giải quyết, kết quả mới, hướng mở rộng, phản biện, bài nên đọc. Dòng thời gian số bài dẫn theo tháng. Nút 🔔 Theo dõi tạo bộ theo dõi bài dẫn mới hoặc bài mới của tác giả trong trang Theo dõi. |
| Lọc và phân loại bài liên quan | Tab Liên quan: lọc theo thời gian, sắp xếp mới nhất / nhiều trích dẫn / đang được chú ý, ẩn bài đã có hoặc đã xem, TLDR một câu. Paper dẫn bài này chia thành kế thừa phương pháp, so sánh kết quả, chỉ nhắc tới, dựa vào câu trích dẫn. |
| Câu trích dẫn | Tab Liên quan: danh sách *Trích dẫn* và *Tài liệu tham khảo* từ Semantic Scholar kèm nguyên văn câu trích dẫn, mục đích trích dẫn và nhãn ảnh hưởng lớn, lưu đệm 7 ngày. |
| Bài giảng | Tab *Bài giảng* trên trang paper: mô hình đọc toàn văn rồi viết tám mục (cần biết trước, bài toán, vì sao cách hiển nhiên không xong, cơ chế chạy tay một ví dụ, đối chiếu với bài được dẫn, số liệu, chỗ đáng ngờ, tự kiểm tra). Mục đối chiếu dùng câu trích dẫn từ Semantic Scholar. Viết xong app soát số liệu và câu nông, mục nông được viết lại một lần. Xuất Markdown. |
| Trích xuất lại một mục | Nút *↻* ở tiêu đề từng mục trong tab Ghi chú: chỉ viết lại mục đó (kèm yêu cầu thêm tuỳ chọn), các mục khác và phần sửa tay giữ nguyên, có *Hoàn tác*. |
| Ngôn ngữ trả lời của Chat | Ô *Ngôn ngữ trả lời* ở trang Chat (khung Nguồn) và tab Hỏi đáp: tiếng Việt, tiếng Anh, theo ngôn ngữ câu hỏi, hoặc theo ngôn ngữ trích xuất (mặc định). Hai chỗ dùng chung một lựa chọn. |
| Phông chữ & cỡ chữ | Cài đặt → *Phông chữ & cỡ chữ*: phông và cỡ chữ giao diện (phóng cả nút, khoảng cách), phông, cỡ chữ và giãn dòng riêng cho nội dung đọc (ghi chú, bài giảng, Hỏi đáp, Chat), gõ được tên phông đã cài. Áp ngay và lưu luôn. |
| Công thức, liệt kê, link | Công thức LaTeX trong `$...$` / `$$...$$` dựng bằng KaTeX đóng gói sẵn (`static/vendor/katex`, chạy offline). Chỉ số dưới/trên dạng chữ thường (`D_Aug`, `x^2`) cũng được hiện đúng. Liệt kê viết liền "1) 2) 3)" tách thành danh sách. Link trần và link Markdown đều bấm được. Prompt trích xuất, bài giảng, Chat yêu cầu mô hình viết công thức bằng LaTeX; khi dịch, công thức được giữ nguyên. |
| Bảng và tiến độ | Kéo mép tiêu đề cột để đổi độ rộng cột ở mọi bảng (nhớ theo bộ tiêu đề cột, bấm đúp để về tự động). Việc phải chờ (tra cứu, trích xuất, bài giảng, tô câu, dịch, tổng hợp, Chat, quét arXiv, tìm PDF) có thanh tiến độ kèm thời gian đã chạy. Việc nhiều bước báo theo bước, việc một lượt gọi model thì ước tính theo thời gian và dừng ở 95% cho tới khi xong. |
| Trang paper | Ghi chú theo template, venue & hạng, chỉnh sửa, PDF đọc và dịch được, hỏi đáp một paper, trích dẫn theo đoạn, paper liên quan (Semantic Scholar), BibTeX, trích xuất lại. |
| So sánh & tổng hợp | Bảng chuẩn, biểu đồ metric cùng dataset, tổng hợp related work bằng AI, xuất Markdown / CSV / BibTeX / LaTeX / Word. Nút *Thông số hiển thị* chọn trong 37 thông số trích xuất (chia nhóm theo template, có *Hiện tất cả*), bảng xoay được (*Paper theo cột*), Markdown / CSV / LaTeX / Word xuất đúng các thông số đang chọn. |
| Khác | Theo dõi paper mới trên arXiv, quản lý chủ đề & tag, cập nhật số trích dẫn, thống kê token theo model (tách cache đọc/ghi) và ước tính chi phí, xuất thư mục Markdown, sao lưu JSON, dữ liệu trên OneDrive/Google Drive. |

Nguồn dữ liệu xếp hạng: [CORE Conference Portal](https://portal.core.edu.au/conf-ranks/) và [SCImago Journal & Country Rank](https://www.scimagojr.com/). Hạng chỉ mang tính tham khảo tại thời điểm của bảng.

## 1. Chạy

### Cách A — ứng dụng desktop (khuyên dùng)

Mở như một phần mềm bình thường: cửa sổ riêng mang logo PaperVault (file `static/icons/logo.svg`, `papervault.ico` cho .exe và taskbar), không thanh địa chỉ, hộp thoại chọn thư mục của Windows, nhớ kích thước cửa sổ, chỉ cho phép một bản chạy.

- **Đã có file `.exe`**: bấm đúp `dist\PaperVault\PaperVault.exe`. Không cần cài Python. Khi nằm trong dự án, bản `.exe` dùng chung dữ liệu `app\data` và `app\config.json` với bản chạy bằng Python. Copy cả thư mục `dist\PaperVault` sang máy khác vẫn chạy, khi đó dữ liệu nằm trong thư mục `data` cạnh file `.exe` (Windows 10/11 có sẵn WebView2 Runtime).
- **Chạy từ mã nguồn**: `pip install pywebview` một lần, rồi bấm đúp `PaperVault.bat` (hoặc `pythonw desktop.py`).
- **Tạo lối tắt** ngoài Desktop và Start Menu: chuột phải `create_shortcut.ps1` → *Run with PowerShell*.
- **Tự đóng gói `.exe`**: `pip install pywebview pyinstaller` rồi chạy `build_exe.bat` (khoảng 1 phút, kết quả trong `dist\PaperVault`).

Chưa cài pywebview thì `desktop.py` tự mở Chrome/Edge ở chế độ cửa sổ ứng dụng (`--app`, không thanh địa chỉ).

### Cách B — chạy trong trình duyệt

Cần Python 3.9 trở lên (Windows: cài từ python.org, tick *Add to PATH*).

```bash
python server.py
```

Hoặc bấm đúp `run.bat` / chạy `run.ps1`. Trình duyệt tự mở `http://127.0.0.1:8765`. Đổi cổng: `python server.py 9000`. Cách này hữu ích khi muốn mở app từ máy khác trong mạng LAN (đặt `"host": "0.0.0.0"` trong `config.json`).

Lần đầu: **Cài đặt** → nhập API key (Claude / OpenAI / Gemini), mô tả **đề tài của bạn**, bấm *Kiểm tra kết nối*, *Lưu cài đặt*.

Có dữ liệu từ extension? Trong extension: Thư viện → Xuất → 3 (JSON). Trong app: Cài đặt → *Nhập JSON (gộp)*.

## 2. Luồng dùng hằng ngày

1. **Thêm paper** → dán `2401.12345` / link arXiv / DOI → *Tra cứu* → xem nguồn lấy được (loại nội dung, số ký tự, có PDF không) → *Trích xuất ghi chú* → chọn thư mục → *Lưu*.
2. Đọc paper trong tab **PDF**, ghi chú ở tab **Ghi chú**, hỏi thêm ở tab **Hỏi đáp**, chuyển trạng thái *Đang đọc → Đã đọc*, chấm sao.
3. Tab **Liên quan** → gợi ý từ Semantic Scholar → *+ Thêm* các paper đáng đọc.
4. Tick chọn các paper cùng hướng → **So sánh & tổng hợp** → *Tổng hợp* → copy bản nháp Related Work + bảng so sánh vào bài.
5. **Cài đặt** → *Đồng bộ ngay* để có thư mục Markdown (mở bằng Obsidian / VS Code / Notion import).

Phím tắt: `/` tìm kiếm · `n` thêm paper · `g` rồi `d`/`l`/`c`/`t`/`s`/`f` đi tới trang · trong danh sách `j`/`k` di chuyển, `Enter` mở, `x` tick chọn · `Esc` đóng hộp thoại.

Nối với extension: trong extension mở Cài đặt → mục *PaperVault App* → *Kiểm tra*. Khi app đang chạy, popup extension có nút **→ App** (đẩy trang đang đọc hoặc kết quả đã trích xuất sang hộp thư của app, không tốn thêm token) và Thư viện extension có nút **→ Đồng bộ sang App** (nhập toàn bộ thư viện, bỏ qua paper đã có).

## 3. Cấu trúc

```
app/
  server.py              máy chủ HTTP (stdlib): static + REST API + SQLite + proxy + ghi thư mục
  rankings.py            nhận diện loại venue + so khớp bảng CORE/ICORE và Scimago SJR
  rankings/              bảng xếp hạng đóng gói sẵn (core_ICORE2026.csv, sjr_2025.csv.gz)
  desktop.py             cửa sổ desktop (pywebview): chạy server ở luồng nền, API native cho JS
                         (chọn thư mục, đổi thư mục dữ liệu, mở link ngoài, khởi động lại, thoát)
  PaperVault.bat         mở desktop không hiện console · run.bat / run.ps1: chạy bản web
  build_exe.bat          đóng gói PyInstaller -> dist/PaperVault/PaperVault.exe
  create_shortcut.ps1    tạo lối tắt Desktop + Start Menu
  config.example.json    mẫu cấu hình (thư mục dữ liệu, cổng)
  data/                  papervault.db (SQLite) + pdfs/  — tạo tự động, có thể chuyển sang cloud
  static/
    index.html           khung giao diện (SPA, hash router)
    css/theme.css        biến màu (dùng chung với extension), app.css bố cục
    js/
      main.js            router, phím tắt, giao diện sáng/tối, chế độ desktop
      desktop.js         cầu nối window.pywebview.api (trả null khi chạy trong trình duyệt)
      api.js             client gọi /api/*
      store.js           state + sự kiện thay đổi + tự động đồng bộ thư mục
      llm.js             adapter Anthropic / OpenAI / Gemini: trích xuất, hỏi đáp, tổng hợp
      prompts.js         prompt trích xuất theo template + prompt hỏi đáp + schema tổng hợp
      reextract.js       trích xuất lại hàng loạt từ Thư viện (bảng tiến trình nổi, nút Dừng)
      quality.js         đối chiếu số liệu với toàn văn, bắt câu chung chung (cho ghi chú và Chat)
      pdftext.js         đọc chữ từ PDF đã lưu bằng PDF.js
      notes-i18n.js      hiển thị ghi chú bằng tiếng Việt / tiếng Anh (dịch và lưu bản dịch theo paper)
      translate.js       dịch đoạn bôi đen theo ngữ cảnh câu (từ extension Dịch Khi Bôi Đen)
      pdf-reader.js      nút 文 + bong bóng dịch chạy trong trình đọc PDF.js (static/vendor/pdfjs)
      extract.js         luồng: nguồn → PDF/text → LLM → gợi ý chủ đề → kiểm tra trùng → lưu
      schema.js topics.js render.js pdf.js   kế thừa nguyên bản từ extension
      markdown.js        note, bảng so sánh, _index, BibTeX, file xuất thư mục, bản tổng hợp
      ui.js              toast, hộp thoại, markdown→HTML gọn, sao đánh giá
      bib.js             đọc file BibTeX / RIS
      links.js           lọc link / arXiv ID / DOI từ văn bản bất kỳ, nhận diện paper trong PDF
      venue.js           hiển thị loại venue và hạng
      views/             dashboard · library · paper · add · batch · chat · compare · topics · settings · feed · help
```

API chính (JSON, `{ok, data|error}`): `GET /api/state`, `GET /api/search?q=`, `POST /api/papers`, `POST /api/papers/bulk` (delete/restore/purge/move/status), `GET /api/papers/trash`, `GET|POST /api/papers/:id/text`, `POST /api/pdf` (raw bytes), `GET /api/pdf/:id`, `POST /api/resolve {query}`, `POST /api/fetch {url}`, `GET /api/s2/recommend/:id`, `POST /api/s2/refresh`, `GET /api/arxiv/search?q=&cats=`, `POST|GET /api/usage`, `POST|GET /api/inbox` (CORS cho extension), `GET /api/find-title?q=`, `POST /api/venue/classify`, `GET /api/venue/search?q=`, `POST /api/venue/reclassify`, `GET|POST /api/rankings[/update]`, `GET|POST|DELETE /api/chats[/:id]`, `POST /api/sync {root, files}`, `GET /api/backup`, `POST /api/import`.

## 4. Dùng dữ liệu trên cloud (OneDrive / Google Drive)

App lưu mọi thứ (SQLite + PDF) trong một thư mục. Muốn dùng trên nhiều máy, đặt thư mục đó vào nơi được client OneDrive / Google Drive đồng bộ:

Bản desktop: **Cài đặt → Dữ liệu & đồng bộ cloud → Đổi thư mục dữ liệu…**, chọn thư mục trong OneDrive/Drive; app copy dữ liệu sang, ghi `config.json` và tự khởi động lại.

Bản web (hoặc làm tay):

1. Tạo `config.json` cạnh `server.py` (với bản `.exe`: cạnh `PaperVault.exe`):
   ```json
   { "dataDir": "C:\\Users\\ban\\OneDrive\\PaperVault" }
   ```
   (hoặc đặt biến môi trường `PV_DATA`). Nếu đã có dữ liệu ở `app/data`, copy nguyên thư mục sang đó.
2. Trên máy khác: cùng `config.json`, chạy `python server.py`.

Lưu ý:
- Chỉ mở app trên **một máy tại một thời điểm**. OneDrive/Drive đồng bộ theo file, không hợp nhất được hai bản SQLite sửa đồng thời. App đã dùng chế độ journal `DELETE` (không sinh file `-wal`) để giảm rủi ro.
- Chờ đồng bộ xong (icon xanh) trước khi mở trên máy kia.
- Thư mục xuất Markdown (Cài đặt) cũng có thể đặt vào cloud; đây là dạng đọc-được, an toàn để chia sẻ với nhóm hoặc mở bằng Obsidian.
- Sao lưu định kỳ bằng *Tải file sao lưu JSON* (kèm full text) phòng khi file DB lỗi.

Nếu cần nhiều người dùng cùng lúc thì phải chuyển sang CSDL cloud thực sự (Supabase / Firebase / Postgres) — kiến trúc `api.js` đã tách riêng nên chỉ cần thay lớp máy chủ.

## 5. Ghi chú kỹ thuật

- Gọi LLM trực tiếp từ trình duyệt (như extension), key nằm trong DB cục bộ; máy chủ chỉ proxy các nguồn paper.
- Proxy `/api/fetch` chặn địa chỉ nội bộ và giới hạn 40MB; `/api/sync` làm sạch đường dẫn (không cho `..`).
- PDF gửi thẳng cho Claude/Gemini; OpenAI dùng text trích cục bộ (`pdf.js` tự viết, không phụ thuộc thư viện).
- Nội dung nguồn (full text) lưu riêng bảng `texts` + bảng FTS5 `texts_fts` để tìm toàn văn; nếu bản Python không có FTS5 thì tự rơi về LIKE.
- Xoá paper là xoá mềm (`deletedAt`); thùng rác tự dọn sau 30 ngày khi khởi động.
- arXiv API giới hạn khoảng một request mỗi ba giây; quét theo dõi tự chờ và thử lại khi bị 429.
- Semantic Scholar không có key bị giới hạn tốc độ dùng chung rất chặt. App chờ và thử lại, rồi dùng OpenAlex làm nguồn dự phòng để tìm theo tiêu đề và tìm venue. Nên nhập S2 API key (miễn phí) trong Cài đặt.
- OpenReview chặn truy cập tự động từ ứng dụng, app báo rõ và hướng dẫn dùng PDF hoặc extension.
- Chat với Claude: phần ngữ cảnh (danh sách paper) đặt `cache_control`, lượt hỏi sau chỉ trả giá đọc cache. Với model Claude có bộ lọc an toàn (Opus 5, Fable 5.x), app bật server-side fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) để yêu cầu bị từ chối được chạy lại trên model phù hợp; nếu tài khoản không hỗ trợ, app tự tắt và gửi lại.
- Semantic Scholar không cần key nhưng giới hạn tốc độ; nhập key ở Cài đặt nếu dùng nhiều.
- arXiv API đôi khi chậm; app có dự phòng đọc tiêu đề/abstract từ trang HTML/abs.

## 6. Hạn chế đã biết

- Không hỗ trợ nhiều người dùng đồng thời; không có đăng nhập.
- Bản `.exe` chỉ build cho Windows; macOS/Linux chạy `python desktop.py` (pywebview dùng WebKit/GTK).
- Nếu app bị tắt đột ngột (kill), lần mở sau tự dọn tiến trình WebView2 mồ côi; nếu vẫn thấy cửa sổ trắng, xoá thư mục `data\webview` rồi mở lại.
- PDF bản scan chỉ dùng được với Claude/Gemini.
- Bảng metric / ý tưởng trong tab Chỉnh sửa vẫn nhập theo dòng (`a | b | c`, `ý tưởng :: cách áp dụng :: công sức`).
