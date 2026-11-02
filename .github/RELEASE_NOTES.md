## Điểm mới

- **Bộ cài đặt như một app thật**: tải `PaperVault-Setup-1.3.3.exe`, bấm Tiếp → Tiếp → Hoàn tất. Bộ cài tiếng Việt, không cần quyền admin. Bạn chọn được thư mục cài, lối tắt Desktop / Start Menu và mở cùng Windows (chạy ẩn ở khay). Máy chưa có WebView2 thì bộ cài tự tải về. App có mục gỡ cài đặt trong Settings → Apps.
- **Dữ liệu tự chuyển sang bản cài**: dữ liệu nằm ở `%LOCALAPPDATA%\PaperVault`. Lần đầu mở, app tự chép thư viện, PDF và API key từ bản zip cũ; thư mục cũ được giữ lại làm dự phòng. Lần sau chỉ cần chạy Setup bản mới: bộ cài tự đóng app, cập nhật mà không động tới dữ liệu.
- **Hình và bảng gốc trong câu trả lời** (Chat và tab Hỏi đáp): app cắt các hình / bảng có chú thích "Figure N" / "Table N" trong PDF. AI chèn hình bằng mã P1.F3, P1.B2. Bấm ảnh để phóng to, "Trang N ↗" mở PDF đúng trang. Hỏi về một hình cụ thể thì app gửi kèm ảnh hình đó để AI đọc trực tiếp.
- **Sơ đồ và biểu đồ**: xin "vẽ sơ đồ kiến trúc / quy trình / dòng thời gian" hay "vẽ biểu đồ so sánh accuracy" thì AI vẽ ngay trong câu trả lời. Có nút phóng to và tải SVG.
- **Thu gọn thanh menu trái** thành cột icon cho rộng chỗ làm việc: nút cạnh logo hoặc `Ctrl+Shift+M`.

## Sửa lỗi

- In đậm bao quanh công thức (ví dụ `**top-$K$ …**`) hiện dấu `**` thay vì chữ đậm.
- Khung hỏi bị ẩn khi hội thoại chưa có paper, dù vẫn hỏi được.

## Cập nhật

Tải `PaperVault-Setup-1.3.3.exe` bên dưới và chạy. Đang dùng bản zip cũ (nút **Tải bản mới** của bản cũ vẫn tải file zip, hãy tải Setup ở trang này) thì cứ để app cũ đang mở khi chạy Setup. Bộ cài nhờ đó tìm ra thư mục dữ liệu, tự đóng app cũ, và lần mở đầu tiên sau khi cài app tự lấy lại thư viện. Không cần xoá gì. Windows có thể hiện cảnh báo SmartScreen vì bộ cài chưa ký số: bấm **More info → Run anyway**.

Muốn dùng bản không cài đặt (chạy từ USB, thư mục đồng bộ…) thì tải `PaperVault-windows.zip`, giải nén đè lên thư mục cũ như trước.
