// Hướng dẫn sử dụng trong app: mục lục, tìm kiếm, mở đúng mục theo trang đang xem.
import { escapeHtml, norm } from '../util.js';
import { $ } from '../ui.js';

const ui = (s) => `<span class="ui">${s}</span>`;
const k = (s) => `<kbd>${s}</kbd>`;

export const SECTIONS = [
  {
    id: 'start', title: 'Bắt đầu nhanh', routes: [''],
    html: `
<p>PaperVault giúp chúng ta thu thập paper, trích xuất ghi chú của mỗi paper theo template đọc paper bằng mô hình ngôn ngữ, sắp xếp chúng thành thư viện có chủ đề và hạng venue, rồi so sánh hoặc hỏi đáp trên nhiều paper cùng lúc. Lần đầu dùng app, chúng ta cần làm theo thứ tự các bước sau:</p>
<ol>
  <li>Vào ${ui('Cài đặt')}, chọn nhà cung cấp (Claude, OpenAI hoặc Gemini), dán API key rồi bấm ${ui('Kiểm tra kết nối')}. Key chỉ lưu trong tệp dữ liệu trên máy.</li>
  <li>Cũng trong ${ui('Cài đặt')}, mô tả ngắn đề tài đang làm ở mục ${ui('Đề tài của bạn')}. App dùng mô tả này để viết phần ý tưởng áp dụng, trả lời trong Chat và soạn bản nháp Related Work, nên mô tả càng cụ thể thì các phần đó càng sát bài.</li>
  <li>Vào ${ui('Thêm paper')}, dán một arXiv ID hoặc link, bấm ${ui('Tra cứu')} rồi ${ui('Trích xuất ghi chú')} và ${ui('Lưu vào thư viện')}.</li>
  <li>Mở paper vừa lưu để đọc ghi chú, đọc PDF kèm dịch khi bôi đen, ghi chú cá nhân và hỏi đáp.</li>
</ol>
<p>Nếu đã có dữ liệu trong extension PaperVault, chúng ta xuất thư viện extension ra JSON rồi nhập vào app ở ${ui('Cài đặt')}, mục ${ui('Sao lưu & nhập dữ liệu')}. Khi app đang chạy, nút ${ui('→ Đồng bộ sang App')} trong thư viện extension làm việc này trực tiếp.</p>
<p>Ghi chú trích xuất đi theo template đọc paper. Năm mục cũ Problem, Bottleneck, Key Idea, Validation, Limitation được gộp vào các mục tương ứng nên không lặp lại:</p>
<ul>
  <li><b>1–2. Paper, Venue/Year</b> là tên, tác giả, nơi công bố và năm.</li>
  <li><b>3. Problem &amp; Motivation</b> là bài toán cụ thể (input, output, bối cảnh) và lý do bài toán quan trọng.</li>
  <li><b>4. Research Gap</b> (Bottleneck cũ) là hạn chế của các nghiên cứu trước và vấn đề còn bỏ ngỏ.</li>
  <li><b>5. Research Question/Objective</b> là mục tiêu và giả thuyết nghiên cứu.</li>
  <li><b>6. Method</b> (Key Idea cũ) gồm ý tưởng cốt lõi, các bước pipeline, mô hình và kỹ thuật, điểm khác biệt so với phương pháp trước.</li>
  <li><b>7. Contribution</b> là các đóng góp mới.</li>
  <li><b>8. Dataset</b> là bảng tên, nguồn, quy mô, đặc điểm và tiền xử lý của từng dataset.</li>
  <li><b>9. Experiments</b> và <b>10. Findings</b> (Validation cũ) gồm thiết lập thí nghiệm, baseline, metric, ablation, các con số chính, phát hiện chính và kết quả hỗ trợ contribution.</li>
  <li><b>11. Limitations</b> tách hạn chế tác giả thừa nhận với hạn chế mô hình nhận thấy khi phân tích, kèm vấn đề chưa giải quyết và chi phí tính toán.</li>
  <li><b>12. Relevance to Our Work</b> nối paper với đề tài trong ${ui('Cài đặt')}: liên quan phần nào, kế thừa được gì, mở rộng ở đâu, trích dẫn để hỗ trợ luận điểm nào.</li>
  <li><b>References</b> và <b>Important Evidence</b> gồm DOI, link code, và bảng claim kèm vị trí trong paper (Section, Table, trang) cùng mục đích trích dẫn.</li>
</ul>`,
  },
  {
    id: 'add', title: 'Thêm một paper', routes: ['add'],
    html: `
<p>Trang ${ui('Thêm paper')} có nhiều cách đưa một paper vào thư viện, tuỳ nguồn chúng ta đang có:</p>
<ul>
  <li>${ui('Link / arXiv / DOI')} nhận arXiv ID, link arXiv, DOI, link OpenReview, ACL Anthology hoặc trang paper bất kỳ. Máy chủ của app tự tải abstract, toàn văn HTML của arXiv và file PDF nếu có, nên không bị trình duyệt chặn như extension.</li>
  <li>${ui('File PDF')} nhận một file PDF từ máy. Bấm vào ô chọn file hoặc kéo PDF thả đúng vào ô đó. Chọn nhiều file cùng lúc thì app chuyển sang chế độ hàng loạt. PDF thả ở các trang khác sẽ không được nhập, để tránh thêm nhầm paper.</li>
  <li>${ui('Dán text')} dùng khi chỉ có abstract hoặc đoạn văn copy từ đâu đó. Nút ${ui('Tạo note trống')} tạo paper để tự điền tay, không gọi mô hình.</li>
  <li>${ui('Zotero / .bib / .ris')} đọc tệp xuất từ Zotero, Mendeley hoặc Google Scholar.</li>
</ul>
<p>Sau khi trích xuất, app hiện bản ghi chú để kiểm tra trước khi lưu, gợi ý thư mục chủ đề và báo nếu paper đã có trong thư viện. Khi trùng, chúng ta chọn cập nhật bản cũ (giữ ghi chú, trạng thái và đánh giá) hoặc lưu thành bản mới. Nút ${ui('Lưu chỉ metadata')} lưu ngay tiêu đề, tác giả, venue mà không tốn token, còn ghi chú có thể trích xuất sau bằng nút ${ui('Trích xuất lại')} trong trang paper.</p>
<p>Với Claude và Gemini, file PDF được gửi thẳng cho mô hình nên bảng kết quả và hình cũng được đọc. OpenAI không nhận PDF qua API này, nên app trích text từ PDF trước. PDF bản scan không có lớp chữ chỉ dùng được với Claude hoặc Gemini.</p>`,
  },
  {
    id: 'batch', title: 'Thêm hàng loạt: lọc link và nhiều PDF', routes: ['add'],
    html: `
<p>Tab ${ui('Hàng loạt')} dành cho lúc có nhiều paper cùng lúc, chẳng hạn một email reading list, một trang ghi chú hoặc một thư mục PDF. Quy trình gồm ba bước hiện ở đầu trang, mỗi bước có trạng thái riêng để chúng ta biết đang ở đâu:</p>
<ol>
  <li><b>Đưa nguồn vào.</b> Dán văn bản bất kỳ rồi bấm ${ui('Tìm paper trong văn bản')} (hoặc ${k('Ctrl')}+${k('Enter')}), hoặc thả nhiều file PDF, cả thư mục, vào ô bên phải. App nhận arXiv ID (kể cả dạng trần như 2401.12345), DOI, link OpenReview, ACL Anthology, Hugging Face Papers, link PDF, trang nhà xuất bản và mục BibTeX. Link trùng nhau được gộp, link không giống paper như GitHub hay YouTube được để riêng trong mục ${ui('link không giống paper đã được bỏ qua')} và vẫn thêm được nếu cần.</li>
  <li><b>Duyệt và chọn.</b> App tự tra tiêu đề, tác giả, năm, venue kèm hạng, số trích dẫn và đoạn tóm tắt cho từng mục, không tốn token. Mỗi paper hiện thành một thẻ có hai nút ${ui('✓ Thêm')} và ${ui('Bỏ qua')}. Paper đã có trong thư viện hoặc trùng với mục khác trong danh sách được chuyển sẵn sang ${ui('Bỏ qua')}, kèm lời giải thích trên thẻ.</li>
  <li><b>Lưu vào thư viện.</b> Thanh dưới cùng cho biết bao nhiêu paper sẽ được thêm. Bấm ${ui('Lưu … paper vào thư viện')} để lưu tất cả paper đang chọn ${ui('Thêm')}. Ô ${ui('Trích xuất ghi chú bằng AI')} bật sẵn khi đã có API key. Tắt ô này thì app chỉ lưu thông tin cơ bản, ghi chú có thể trích xuất sau trong trang paper.</li>
</ol>
<p>Các tab ${ui('Tất cả')}, ${ui('Sẽ thêm')}, ${ui('Đã có / trùng')}, ${ui('Cần xử lý')} và ${ui('Đã lưu')} giúp xem riêng từng nhóm, số đếm cạnh tên tab cho biết còn bao nhiêu mục. Nút ${ui('Thêm tất cả')}, ${ui('Bỏ qua tất cả')} và ô ${ui('Đặt thư mục cho các paper đã chọn')} tác động lên các thẻ trong tab đang mở. Mỗi thẻ đang chọn ${ui('Thêm')} có ô ${ui('Thư mục')} riêng, để nguyên thì app dùng thư mục gợi ý tự động.</p>
<p>Khi chọn ${ui('Thêm')} cho một paper đã có trong thư viện và bật trích xuất, app cập nhật bản cũ (giữ ghi chú, trạng thái, đánh giá) chứ không tạo bản thứ hai. Mục gặp lỗi nằm ở tab ${ui('Cần xử lý')} với nút ${ui('Thử lại')}. Danh sách được lưu lại, đóng app mở lại vẫn còn, và nút ${ui('Dừng')} dừng sau mục đang xử lý mà không mất kết quả đã xong.</p>`,
  },
  {
    id: 'read', title: 'Đọc, ghi chú và hỏi đáp một paper', routes: ['paper'],
    html: `
<p>Trang của một paper gồm các tab:</p>
<ul>
  <li>${ui('Ghi chú')} hiện venue và hạng, ghi chú theo template (mục 1–12, References, Important Evidence), ghi chú cá nhân và phần trích dẫn theo đoạn. Phím ${k('Ctrl')}+${k('Enter')} lưu nhanh ghi chú cá nhân. Nút ${ui('Tiếng Việt')} / ${ui('English')} ở đầu tab đổi ngôn ngữ hiển thị ghi chú, xem chi tiết bên dưới. Nút ${ui('↻')} ở góc phải tiêu đề mỗi mục trích xuất lại riêng mục đó: mô hình đọc lại paper nhưng chỉ viết lại mục được chọn, các mục khác giữ nguyên. Có thể ghi thêm yêu cầu cho mục, và sau khi xong có nút ${ui('Hoàn tác')}.</li>
  <li>${ui('Cài đặt')} → ${ui('Phông chữ & cỡ chữ')} đổi phông và cỡ chữ của giao diện, cùng phông, cỡ chữ và giãn dòng riêng cho phần nội dung để đọc (ghi chú, bài giảng, Hỏi đáp, Chat). Đổi là thấy ngay và được lưu luôn. Mục ${ui('Phông khác…')} cho gõ tên bất kỳ phông nào đã cài trên máy.</li>
  <li>Ghi chú, bài giảng, Hỏi đáp và Chat hiển thị công thức LaTeX viết trong <code>$...$</code> hoặc <code>$$...$$</code> (dựng bằng KaTeX đóng gói sẵn, không cần mạng). Ghi chú cũ viết công thức kiểu chữ thường như <code>D_Aug</code>, <code>P_θ</code>, <code>x^2</code> được hiện chỉ số dưới, chỉ số trên. Đoạn liệt kê viết liền "1) … 2) … 3) …" được tách thành danh sách đánh số, và mọi đường link đều bấm được. Ghi chú trích xuất trước khi có tính năng này chưa có LaTeX, bấm ↻ ở mục cần làm lại để mô hình viết lại công thức.</li>
  <li>Mọi bảng trong app (ghi chú, bài giảng, so sánh, câu trả lời Chat) đổi được độ rộng cột: rê chuột tới mép phải tiêu đề cột cho tới khi con trỏ thành mũi tên hai chiều rồi kéo. App nhớ độ rộng theo bộ tiêu đề cột, nên bảng cùng loại ở paper khác cũng dùng lại. Bấm đúp vào mép cột để về độ rộng tự động. Chiều cao hàng tự co giãn theo nội dung.</li>
  <li>${ui('Chỉnh sửa')} cho sửa mọi trường. Bảng metric nhập mỗi dòng dạng <code>metric | dataset | baseline | đề xuất | Δ</code>, dataset nhập dạng <code>tên | source | scale | đặc điểm | tiền xử lý</code>, Important Evidence nhập dạng <code>claim | vị trí | mục đích</code>, còn ý tưởng kế thừa nhập dạng <code>ý tưởng :: cách áp dụng :: công sức</code>.</li>
  <li>${ui('PDF')} đọc file ngay trong app, bôi đen chữ để dịch, tô sáng hoặc gạch chân. Xem mục ${ui('Dịch khi đọc PDF')} và ${ui('Tô sáng, gạch chân và tìm PDF')} bên dưới. Paper chưa có PDF thì app tự tìm bản PDF công khai để tải.</li>
  <li>Ô ${ui('Ngôn ngữ trả lời')} ở trang ${ui('Chat với paper')} (khung Nguồn) và ở đầu tab ${ui('Hỏi đáp')} chọn AI trả lời bằng tiếng Việt, tiếng Anh, theo ngôn ngữ của câu hỏi, hoặc theo ngôn ngữ trích xuất trong Cài đặt (mặc định). Hai chỗ dùng chung một lựa chọn, áp dụng từ câu hỏi tiếp theo. Thuật ngữ, tên phương pháp, dataset, metric luôn giữ tiếng Anh.</li>
  <li>${ui('Hỏi đáp')} hỏi mô hình về riêng paper này, dùng ghi chú và toàn văn đã lưu làm ngữ cảnh. Muốn hỏi trên nhiều paper thì dùng trang ${ui('Chat với paper')}.</li>
  <li>${ui('Liên quan')} gợi ý paper cùng tag hoặc dataset trong thư viện, và lấy gợi ý, danh sách trích dẫn, tài liệu tham khảo từ Semantic Scholar. Với ${ui('Trích dẫn')} và ${ui('Tài liệu tham khảo')}, mỗi paper kèm nguyên văn câu trích dẫn, mục đích trích dẫn (nền tảng, phương pháp, so sánh kết quả) và nhãn ảnh hưởng lớn. Tick ${ui('Chỉ bài có câu trích dẫn')} để lọc. Kết quả được lưu 7 ngày, bấm ${ui('Tải lại')} để lấy mới.</li>
  <li>Ba danh sách Semantic Scholar có bộ lọc chung: khoảng thời gian (6 tháng, 1 năm, 2 năm gần đây), sắp xếp (mới nhất, nhiều trích dẫn nhất, đang được chú ý tính bằng số trích dẫn mỗi tháng từ lúc đăng), và ẩn bài đã có trong thư viện hoặc đã xem. Nút ${ui('Đã xem')} dùng chung với trang Theo dõi paper mới. Mỗi bài hiện TLDR một câu của Semantic Scholar khi có, không thì hiện abstract.</li>
  <li>Thẻ ${ui('Có gì mới kể từ bài này')} nhờ mô hình đọc tóm tắt và câu trích dẫn của tối đa 30 paper dẫn bài này, rồi tổng hợp giới hạn nào của bài đã được giải quyết (dựa vào mục Limitations của ghi chú), kết quả mới trên cùng dataset, hướng mở rộng, phản biện và bài nên đọc tiếp. Mỗi ý có mã C1, C2…, bấm vào để mở thẻ chi tiết của bài đó (tác giả, năm, venue, cách dẫn bài gốc, số trích dẫn, câu trích dẫn, TLDR) kèm nút Mở link và Thêm vào thư viện. Một lượt gọi mô hình, bấm ${ui('Cập nhật')} sau vài tháng để làm mới.</li>
  <li>Nút ${ui('🕸 Đồ thị 3D')} mở đồ thị trích dẫn toàn màn hình: bài đang xem ở giữa, các bài nó dẫn (xanh dương), các bài dẫn nó (cam), bài đã có trong thư viện (tím), và cạnh tím nối hai bài trong đồ thị có dẫn nhau. Cỡ nút theo số trích dẫn. Kéo để xoay, cuộn để phóng, bấm một bài để xem chi tiết, thêm vào thư viện hoặc bay tới. Rê chuột vào một bài để xem thẻ thông tin (tác giả, năm, số trích dẫn, số bài nó dẫn và số bài dẫn nó trong đồ thị, TLDR). Mũi tên đi từ bài được dẫn sang bài dẫn nó, tức theo dòng ý tưởng được kế thừa. Khi rê chuột, mũi tên ra (bài đó được bài kia dẫn) tô xanh lá, mũi tên vào (bài đó dẫn bài kia) tô hồng, có hạt chạy theo chiều mũi tên, các bài khác mờ đi. Có lọc theo loại, chỉ giữ bài nối với nhau, ô tìm tiêu đề và nút Vừa khung. Tô màu theo loại, theo năm (chia tối đa sáu nhóm năm, mỗi nhóm một màu rõ khác nhau), hoặc theo chủ đề / từ khoá: app tự tìm tối đa bảy chủ đề từ tiêu đề và TLDR, hoặc bạn tự gõ từ khoá cách nhau bởi dấu phẩy. Bấm một chủ đề trong chú thích để làm nổi các bài thuộc chủ đề đó. Cột trái liệt kê các bài đang có trong đồ thị, sắp xếp theo trích dẫn, năm, số liên kết hoặc tên, và lọc theo ô tìm hoặc chủ đề đang chọn. Rê vào một bài trong danh sách để làm nổi nó trên đồ thị, bấm để mở chi tiết và bay tới. Phía trên danh sách có bộ lọc: gõ tên bài, năm từ – đến, chủ đề (tự tìm hoặc theo từ khoá tự đặt) và số trích dẫn tối thiểu. Có thêm ô lọc theo từ khoá / chủ đề (tìm trong tiêu đề, TLDR, tóm tắt, venue và tên chủ đề, nhiều từ cách nhau bởi dấu phẩy). Tick ${ui('Liên kết với đồ thị')} (mặc định bật) để bộ lọc áp lên cả đồ thị, khi đó danh sách và đồ thị luôn hiện cùng một tập bài và góc nhìn được giữ nguyên khi lọc. Bỏ tick thì chỉ danh sách được lọc, đồ thị giữ nguyên. Danh sách sắp xếp được theo trích dẫn, năm, số liên kết, tên hoặc hạng venue (CORE A*..C, SJR Q1..Q4, tra bằng bảng xếp hạng của app). Nút ◀ ẩn danh sách. Hàng ${ui('Mở rộng')} tăng số bài dẫn lấy về (100, 300, 500, 1000, hoặc Tự nhập từ 10 tới 5000; trên 1000 bài app lấy theo nhiều trang) và thêm bài nền chung: bài nằm ngoài đồ thị nhưng được ít nhất 2, 3, 5 hoặc 8 bài trong đồ thị cùng dẫn, thường là công trình nền tảng của cả hướng (tô vàng). Đồ thị lớn thì lần đầu tải lâu hơn, kết quả được lưu đệm 7 ngày.</li>
  <li>Nút ${ui('🔔 Theo dõi')} tạo bộ theo dõi bài mới dẫn bài này, hoặc bài mới của từng tác giả, trong trang ${ui('Theo dõi paper mới')}.</li>
  <li>Danh sách ${ui('Paper dẫn bài này')} có dòng thời gian, bấm vào một cột để chỉ hiện các bài đăng trong kỳ đó, bấm thêm cột khác để gộp nhiều kỳ, bấm lại một cột (hoặc nút ✕ của kỳ đó) để bỏ kỳ đó, và ${ui('Bỏ lọc toàn bộ')} để bỏ hết. Dòng thời gian gồm số bài dẫn theo tháng (hoặc quý, năm), mỗi màu một cách dùng bài gốc, rê chuột vào cột để xem số, có bảng thay thế.</li>
  <li>${ui('Paper dẫn bài này')} được chia theo cách họ dùng bài này: ${ui('Kế thừa phương pháp')} (dùng hoặc mở rộng cách làm), ${ui('So sánh kết quả')} (lấy bài này làm baseline, thường là chỗ có kết quả mới), ${ui('Chỉ nhắc tới')} và ${ui('Chưa rõ')} (không có câu trích dẫn). ${ui('Tài liệu tham khảo')} chia tương tự theo cách bài này dùng bài được dẫn. Nhãn dựa vào câu trích dẫn nên đôi khi sai, rê chuột vào nhãn để xem lý do.</li>
  <li>${ui('Trích dẫn')} cho BibTeX và trích dẫn APA bản thứ 7. Mục tài liệu tham khảo hiện đúng định dạng: tên tác giả dạng họ kèm chữ cái đầu, tiêu đề kiểu sentence case, in nghiêng tên tạp chí hoặc kỷ yếu (với preprint thì in nghiêng tiêu đề), thụt lề treo. ${ui('Copy có định dạng')} giữ in nghiêng khi dán vào Word hay Google Docs. Bên dưới có sẵn hai dạng trích dẫn trong bài. App chưa lưu số tập, số kỳ, số trang nên các phần đó cần bổ sung tay.</li>
  <li>${ui('Nguồn')} hiện toàn văn đã gửi cho mô hình. Bôi đen một đoạn rồi bấm ${ui('Ghi chú đoạn đã chọn')} để lưu đoạn đó kèm nhận xét và số trang.</li>
</ul>
<p>Nút ${ui('Trích xuất lại')} chạy lại phần ghi chú theo template từ toàn văn hoặc PDF đã lưu, giữ nguyên ghi chú cá nhân, trích dẫn theo đoạn, trạng thái và đánh giá. Paper trích xuất trước khi có template cũng dùng nút này để có đủ các mục mới. Đây cũng là cách hoàn thiện các paper nhập dạng metadata.</p>`,
  },
  {
    id: 'quality', title: 'Kiểm tra ghi chú: số liệu và câu chung chung', routes: [],
    html: `
<p>Đầu tab ${ui('Ghi chú')} có thẻ ${ui('Kiểm tra ghi chú')}. App tự chạy hai phép kiểm cơ học trên bản trích xuất, không gọi mô hình và không tốn token.</p>
<ul>
  <li><b>Đối chiếu số liệu.</b> Mọi con số trong ghi chú được dò trong toàn văn đã lưu. Con số không thấy được liệt kê kèm mục chứa nó. Nguyên nhân có thể là mô hình ghi nhầm, mô hình tự tính, hoặc con số nằm trong bảng mà bộ bóc chữ bỏ sót. Nên mở PDF đối chiếu trước khi trích dẫn. Tên mô hình như Qwen2.5-7B, số bảng, số mục, năm và cột Δ không bị tính là số liệu.</li>
  <li><b>Câu chung chung.</b> App bắt các câu đúng nhưng không mang thông tin, ví dụ nói "cải thiện" mà không nói bằng cách nào hay bao nhiêu, cụm kiểu "đóng vai trò quan trọng", câu dài không có cơ chế hay con số, và mô tả kỹ thuật chỉ lặp lại tên của nó.</li>
</ul>
<p>Paper có PDF mà chưa có toàn văn dạng chữ thì app tự đọc chữ từ PDF để đối chiếu, rồi lưu luôn làm toàn văn. Nhờ đó tìm kiếm toàn văn và Chat cũng dùng được paper này. Paper chỉ có abstract thì app báo rõ là không đủ để đối chiếu.</p>
<p>Trong ${ui('Chat với paper')}, mỗi câu trả lời cũng được dò số liệu với ghi chú, toàn văn và đoạn trích đã gửi cho mô hình. Con số không thấy hiện thành dòng cảnh báo dưới câu trả lời. Câu mô hình tự ghi "(ngoài tài liệu)" được bỏ qua.</p>
<p>Hai phép kiểm chỉ cảnh báo, không sửa và không chặn gì. Cuối bản ghi chú còn có hai mục do mô hình viết lúc trích xuất: ${ui('Chuỗi lập luận')} gồm 6–10 mắt xích từ tiền đề đến kết luận, và ${ui('Lưu ý khi đọc')} nêu chỗ dễ hiểu nhầm hoặc khẳng định mạnh hơn bằng chứng. Paper trích xuất trước đây cần ${ui('Trích xuất lại')} để có hai mục này.</p>
<p>Nút ${ui('Dịch bằng AI')} ở trình đọc PDF và ở phần dịch ghi chú dùng bộ luật dịch học thuật: thuật ngữ mặc định giữ tiếng Anh và gọi thống nhất, giữ đúng mức khẳng định (may là "có thể", suggests là "cho thấy"), giữ từ nối lập luận, không đổi số liệu, phủ định hay chiều so sánh.</p>`,
  },
  {
    id: 'notes-lang', title: 'Xem ghi chú bằng tiếng Việt hoặc tiếng Anh', routes: [],
    html: `
<p>Ghi chú được trích xuất một lần theo ${ui('Ngôn ngữ khi trích xuất')} trong ${ui('Cài đặt')}. Muốn đọc bằng ngôn ngữ kia, bấm ${ui('Tiếng Việt')} hoặc ${ui('English')} ở đầu tab ${ui('Ghi chú')} của paper. Lựa chọn này áp dụng cho mọi paper và cũng đổi được ở ${ui('Cài đặt')} → ${ui('Hiển thị ghi chú bằng')}.</p>
<ul>
  <li>Lần đầu xem một paper bằng ngôn ngữ khác, app dịch các trường văn bản bằng Google miễn phí, không tốn token, rồi lưu bản dịch vào paper. Lần sau mở ra là có ngay.</li>
  <li>Tên paper, tác giả, venue, tên dataset, tên thành phần, metric, con số và link được giữ nguyên. Nhãn các mục cũng đổi theo ngôn ngữ đang xem.</li>
  <li>Nút ${ui('Dịch bằng AI cho chính xác hơn')} dịch lại toàn bộ bằng mô hình đang dùng, sát văn phong học thuật hơn và có tốn token.</li>
  <li>Sửa ghi chú ở tab ${ui('Chỉnh sửa')} hoặc trích xuất lại thì bản dịch cũ tự hết hiệu lực, app dịch lại khi cần.</li>
  <li>${ui('Copy Markdown')} ở đầu trang copy theo ngôn ngữ đang hiển thị ở tab ${ui('Ghi chú')}. Xuất thư viện ra thư mục, bảng so sánh và Chat vẫn dùng bản gốc.</li>
</ul>`,
  },
  {
    id: 'lecture', title: 'Bài giảng', routes: [],
    html: `
<p>Tab ${ui('Bài giảng')} trên trang paper nhờ mô hình viết một bản giải thích dài để đọc từ đầu đến cuối là hiểu được bài. Ghi chú trích xuất trả lời câu hỏi bài này làm gì, còn bài giảng trả lời vì sao nó phải làm như vậy và nó chạy ra sao.</p>
<p>Bài giảng có tám mục theo thứ tự cố định:</p>
<ol>
  <li><b>Cần biết trước</b> là kiến thức bài giả định người đọc đã có nên không giải thích.</li>
  <li><b>Bài toán</b> kể bằng một tình huống cụ thể.</li>
  <li><b>Vì sao cách hiển nhiên không xong</b>.</li>
  <li><b>Cơ chế, chạy tay một ví dụ</b>. Mỗi bước nói nó làm gì, vì sao cần, và ký hiệu đọc thành lời.</li>
  <li><b>Đặt cạnh những bài nó dẫn</b>, dùng câu trích dẫn nguyên văn từ Semantic Scholar.</li>
  <li><b>Số liệu nói gì, và không nói gì</b>.</li>
  <li><b>Chỗ đáng ngờ</b>.</li>
  <li><b>Tự kiểm tra</b> gồm câu hỏi dạng vì sao, đáp án gập lại.</li>
</ol>
<ul>
  <li>Cần toàn văn của paper. Paper chỉ có abstract thì app báo lỗi và không gọi mô hình.</li>
  <li>Mỗi lần dựng là bốn lượt gọi mô hình, thêm tối đa hai lượt viết lại mục bị chấm là nông. Mất khoảng 2 đến 5 phút, trong lúc đó có thể sang tab khác.</li>
  <li>Dưới mỗi mục có cảnh báo nếu con số không thấy trong toàn văn hoặc còn câu nông. Hai mục Bài toán và Cơ chế không đối chiếu số vì chúng được phép dùng ví dụ giả định.</li>
  <li>${ui('Copy Markdown')} và ${ui('Tải .md')} xuất bài giảng, đáp án phần tự kiểm tra nằm ở cuối file.</li>
  <li>Bài giảng được viết theo ngôn ngữ trích xuất trong ${ui('Cài đặt')}. Nút ${ui('Tiếng Việt')} / ${ui('English')} ở đầu tab đổi ngôn ngữ hiển thị, dùng chung lựa chọn với tab Ghi chú. Bản dịch mặc định dùng Google, không tốn token, và được lưu lại. Nút ${ui('Dịch bằng AI cho chính xác hơn')} dịch lại bằng mô hình đang dùng. Tên thuật ngữ, tên bài được dẫn và con số được giữ nguyên. Xuất Markdown theo ngôn ngữ đang hiển thị.</li>
</ul>`,
  },
  {
    id: 'autohl', title: 'Tô câu đáng nhớ bằng AI', routes: [],
    html: `
<p>Nút ${ui('✦ Tô câu đáng nhớ')} trên thanh trình đọc PDF cho mô hình đọc toàn văn rồi tô những câu đáng nhớ. Mỗi loại câu một màu:</p>
<ul>
  <li><b>Luận điểm</b> (tím) là điều paper khẳng định.</li>
  <li><b>Cơ chế</b> (xanh dương) giải thích phương pháp hoạt động thế nào.</li>
  <li><b>Bằng chứng</b> (xanh lá) là con số và kết quả chống lưng cho luận điểm.</li>
  <li><b>Giới hạn</b> (hồng) là điều kiện áp dụng, điểm yếu, trường hợp thất bại.</li>
  <li><b>Thuật ngữ</b> (vàng) là chỗ định nghĩa khái niệm dùng suốt bài.</li>
</ul>
<ul>
  <li>Chọn mật độ thưa, vừa hoặc dày. Số câu tính theo số trang nội dung, không tính danh mục tham khảo.</li>
  <li>Bấm vào một nét tô để xem loại câu và lý do đáng nhớ, có nút lưu thành trích dẫn của paper.</li>
  <li>Khi paper có câu AI tô, ngay dưới thanh công cụ trình đọc có dải ${ui('Màu câu AI tô')} nhắc mỗi màu là loại nào và có bao nhiêu câu, rê chuột vào để xem giải thích. Bấm ${ui('Thu gọn')} để thu dải này thành một dòng nhỏ.</li>
  <li>Câu nào mô hình chép không khớp nguyên văn trong PDF thì bị bỏ, app không tô đoán.</li>
  <li>Tab ${ui('Ghi chú')} có thẻ ${ui('Câu đáng nhớ')} liệt kê các câu theo loại. Bấm số trang để mở PDF đúng trang đó.</li>
  <li>Chạy lại thì lượt mới thay các câu AI đã tô, nét bạn tự tô được giữ nguyên. Hoàn tác bằng ↶, hoặc mở lại hộp thoại để xoá hết câu AI đã tô.</li>
  <li>Mỗi lượt là một lần gọi mô hình với toàn văn, tốn token gần bằng một lần trích xuất.</li>
</ul>`,
  },
  {
    id: 'marks', title: 'Tô sáng, gạch chân và tìm PDF', routes: [],
    html: `
<p>Thanh công cụ của trình đọc PDF có ba nút riêng của app, nằm trước các công cụ vẽ của PDF.js:</p>
<ul>
  <li><b>Bút tô sáng</b> và <b>U gạch chân</b>. Bật một nút rồi bôi đen chữ, đoạn đó được tô hoặc gạch ngay, nút vẫn bật để đánh dấu tiếp. Bấm lại nút để tắt.</li>
  <li><b>Cục tẩy</b>. Bật rồi bôi đen phần chữ đã tô hoặc gạch để xoá đúng phần đó (tẩy ở giữa thì nét bị cắt làm đôi), hoặc giữ chuột trái rê qua các nét để xoá cả dòng. Bấm lại nút để tắt.</li>
  <li><b>Chấm màu</b> chọn màu vàng, xanh lá, xanh dương, hồng, đỏ hoặc tím.</li>
  <li><b>↶ Hoàn tác</b> và <b>↷ Làm lại</b> áp dụng cho việc tạo nét, tẩy, xoá nét và đổi màu. Phím tắt ${k('Ctrl')}+${k('Z')} để hoàn tác, ${k('Ctrl')}+${k('Y')} hoặc ${k('Ctrl')}+${k('Shift')}+${k('Z')} để làm lại. Khi đang bật công cụ vẽ hay thêm chữ của PDF.js, ${k('Ctrl')}+${k('Z')} hoàn tác nét của công cụ đó.</li>
</ul>
<p>Nét đánh dấu lưu trong paper (không sửa file PDF), mở lại hay đổi cỡ chữ vẫn đúng chỗ. Khi đã tắt công cụ, bấm vào một nét để ${ui('Dịch')}, lưu làm ${ui('+ Ghi chú')}, ${ui('Sao chép')}, đổi màu hoặc ${ui('Xoá')}.</p>
<p>Các công cụ của PDF.js như vẽ tay, thêm chữ, thêm ảnh, chữ ký chỉ giữ được khi lưu vào file. Khi có nét vẽ chưa lưu, thanh trình đọc hiện nút ${ui('Lưu nét vẽ vào PDF')}. Bấm nút này để ghi vào file PDF của paper.</p>
<p>Paper chưa có PDF thì tab ${ui('PDF')} tự tìm bản công khai qua link và DOI của paper, Semantic Scholar, OpenAlex, arXiv (theo tên), CVF, NeurIPS, PMLR, ACL Anthology. Bấm ${ui('Tải về')} ở một nguồn hoặc ${ui('Tự động tải bản tốt nhất')}. Không tìm được thì dùng các link Google Scholar, Semantic Scholar, trang nhà xuất bản để tải tay rồi chọn file. Muốn tìm cho nhiều paper, tick chọn ở Thư viện (menu cạnh ${ui('Chọn tất cả')} có ${ui('Chưa có PDF')}) rồi bấm ${ui('Khác')} → ${ui('Tìm & tải PDF')}.</p>`,
  },
  {
    id: 'translate', title: 'Dịch khi đọc PDF', routes: [],
    html: `
<p>Bôi đen để dịch giờ dùng được ở mọi trang của app (ghi chú, bài giảng, Hỏi đáp, Chat, danh sách paper…), không chỉ trong PDF. Cách dùng giống hệt: bôi đen, rê chuột hoặc bấm nút 文, bong bóng hiện bản dịch theo ngữ cảnh câu, có ${ui('Dịch bằng AI')}, ${ui('Sao chép')}, và ${ui('+ Ghi chú')} khi đang ở trang một paper. Ô nhập liệu và khối mã không bật dịch. Tắt ở ${ui('Cài đặt')} → ${ui('Dịch khi bôi đen')} → ô ${ui('Bôi đen để dịch ở mọi trang của app')}.</p>
<p>Tab ${ui('PDF')} của trang paper dùng trình đọc PDF.js, chữ trong PDF bôi đen được như trang web. Cách dùng giống extension Dịch Khi Bôi Đen:</p>
<ol>
  <li>Bôi đen một từ, cụm từ hay cả đoạn trong PDF.</li>
  <li>Rê chuột vào nút ${ui('文')} hiện cạnh đoạn đã chọn, bong bóng bản dịch mở ra. Muốn bấm thay vì rê chuột, hoặc dịch ngay khi bôi đen, đổi ở ${ui('Tuỳ chọn')} trên thanh trình đọc.</li>
  <li>${k('Esc')} đóng bong bóng, ${k('Ctrl')}+${k('Shift')}+${k('D')} dịch ngay đoạn đang chọn.</li>
</ol>
<p>Khi bật ${ui('Theo ngữ cảnh câu')}, app gửi kèm cả câu chứa đoạn đã chọn, nên từ nhiều nghĩa được dịch đúng ngữ cảnh. Câu ngữ cảnh được tô nhạt và đóng trong dấu ⟦ ⟧ ngay trên PDF, phần tương ứng trong bản dịch cả câu được tô vàng. Nhãn trên bong bóng cho biết độ tin cậy:</p>
<ul>
  <li>${ui('theo ngữ cảnh')} là đã tách được nghĩa của đoạn chọn trong câu và đối chiếu lại, đáng tin nhất.</li>
  <li>${ui('dịch riêng')} là không tách được trong câu nên hiện nghĩa khi đứng một mình, cần đọc thêm cả câu.</li>
  <li>${ui('cả câu')} là chỉ có bản dịch của cả câu.</li>
</ul>
<p>Bản dịch nhanh dùng dịch vụ Google miễn phí qua máy chủ của app, không cần API key và không tốn token. Bong bóng còn có hai nút:</p>
<ul>
  <li>${ui('Dịch bằng AI')} dịch lại bằng mô hình đang dùng trong Cài đặt, sát văn phong học thuật hơn, giữ nguyên tên phương pháp, dataset và ký hiệu.</li>
  <li>${ui('+ Ghi chú')} lưu đoạn gốc, bản dịch và số trang vào phần ${ui('Trích dẫn & nhận xét')} của paper. Các đoạn này đi kèm file Markdown khi xuất và làm ngữ cảnh cho Chat.</li>
</ul>
<p>Ngôn ngữ đích và các tuỳ chọn khác chỉnh ngay trên thanh trình đọc hoặc trong ${ui('Cài đặt')} → ${ui('Dịch khi đọc PDF')}. Dịch vụ miễn phí có thể tạm từ chối khi dùng quá nhiều trong thời gian ngắn, khi đó chờ một lúc rồi thử lại.</p>`,
  },
  {
    id: 'library', title: 'Thư viện, tìm kiếm và dọn dẹp', routes: ['library'],
    html: `
<p>Thư viện có ba kiểu xem gồm danh sách, kanban theo trạng thái đọc (kéo thẻ giữa các cột để đổi trạng thái) và bảng. Sidebar liệt kê chủ đề. Kéo một paper thả vào tên chủ đề để chuyển thư mục.</p>
<p>Ô tìm kiếm quét cả ghi chú trích xuất, ghi chú cá nhân, tag lẫn <b>toàn văn đã lưu</b>. Paper khớp trong toàn văn hiện thêm đoạn trích có từ khoá được tô sáng. Bộ lọc gồm trạng thái, đánh giá, loại venue, hạng venue, tag và năm, còn ô sắp xếp có thêm lựa chọn ${ui('Hạng venue')} và ${ui('Trích dẫn nhiều')}.</p>
<p>Ô ${ui('Chọn tất cả')} nằm ngay trên cột tick, giống Gmail. Bấm khi chưa chọn gì để chọn mọi paper trong danh sách đang xem, bấm lần nữa để bỏ chọn. Ô hiện dấu gạch ngang khi mới chọn một phần. Mũi tên bên cạnh mở menu chọn nhanh theo điều kiện như ${ui('Chưa đọc')}, ${ui('Có PDF')}, ${ui('Chưa trích xuất')} hoặc ${ui('Đảo lựa chọn')}.</p>
<p>Khi có paper được tick, thanh chọn hiện các thao tác hàng loạt gồm ${ui('Chat')}, ${ui('So sánh')}, ${ui('Chuyển thư mục')} và ${ui('Xoá')}. Nút ${ui('Khác')} chứa thêm ${ui('Đổi trạng thái')}, ${ui('Gắn nhãn phụ')} và ${ui('Xuất')}. Khi chưa tick paper nào, thanh này chỉ có ${ui('Dọn trùng')} và ${ui('Xuất danh sách')}.</p>
<p>${ui('Khác')} → ${ui('Trích xuất lại ghi chú (AI)')} chạy lại trích xuất theo template cho các paper đang tick, lần lượt từng paper, từ toàn văn hoặc PDF đã lưu. Ghi chú cá nhân, trích dẫn theo đoạn, trạng thái, đánh giá và thư mục được giữ nguyên. Hộp xác nhận cho phép bỏ qua paper đã có ghi chú theo template mới để đỡ tốn token. Bảng tiến trình ở góc dưới bên phải có nút ${ui('Dừng')}, và việc trích xuất vẫn chạy tiếp khi chuyển sang trang khác. Paper chưa có toàn văn hay PDF được liệt kê lại ở cuối. Để tick nhanh các paper cần làm, mở mũi tên cạnh ${ui('Chọn tất cả')} rồi chọn ${ui('Chưa có ghi chú theo template')}. Một paper có một chủ đề chính và có thể mang thêm nhãn phụ, nên paper vừa thuộc VQA vừa thuộc Efficiency vẫn hiện ở cả hai chủ đề.</p>
<p>${ui('Dọn trùng')} gom các paper trùng arXiv ID, DOI hoặc tên, giữ bản mới nhất và gộp ghi chú, đánh giá, PDF, nhãn từ các bản còn lại. Paper bị xoá nằm trong ${ui('Thùng rác')} 30 ngày trước khi bị xoá hẳn, và ngay sau khi xoá có nút ${ui('Hoàn tác')}.</p>`,
  },
  {
    id: 'venue', title: 'Venue và xếp hạng', routes: ['library', 'paper'],
    html: `
<p>Mỗi paper được gắn loại venue và hạng tương ứng, hiện dưới dạng nhãn như ${ui('Hội nghị · CVPR · A*')} hoặc ${ui('Tạp chí · IEEE Transactions on … · Q1')}. App phân loại tự động mỗi khi lưu paper, dựa trên tên venue, loại ấn phẩm từ Semantic Scholar và Crossref, ISSN, và ghi chú kiểu "Accepted to …" trên arXiv.</p>
<p>Các loại venue app phân biệt gồm hội nghị, workshop, Findings, tạp chí, chương sách, book series, sách, preprint và luận văn. Hạng lấy từ hai nguồn:</p>
<ul>
  <li><b>Hội nghị</b> dùng bảng CORE/ICORE của portal.core.edu.au với các hạng A*, A, B, C. Ngoài ra còn có các nhãn như National, Unranked hoặc Multiconference, là cách CORE ghi nhận những hội nghị không xếp theo thang A*–C.</li>
  <li><b>Tạp chí, book series và kỷ yếu</b> dùng Scimago Journal Rank với quartile Q1–Q4 theo lĩnh vực tốt nhất của ấn phẩm, kèm điểm SJR và H-index.</li>
</ul>
<p>CORE không xếp hạng riêng workshop và Findings. Với hai loại này, app hiện hạng của hội nghị chủ ở dạng mờ, chẳng hạn ${ui('Workshop · CVPR A*')}, để chúng ta biết bối cảnh nhưng không nhầm đó là hạng của bài. Tương tự, paper ECCV hay MICCAI được Springer in trong Lecture Notes in Computer Science, nên app ưu tiên nhận là hội nghị theo CORE thay vì chương sách.</p>
<p>Khi app nhận diện sai hoặc chưa nhận diện được, bấm ${ui('Sửa venue')} trong tab ${ui('Ghi chú')} của paper. Ô tìm kiếm trong hộp thoại tra trực tiếp bảng CORE và SJR, kể cả tên viết tắt như TPAMI hay IJCV. Venue đã sửa tay được giữ nguyên khi phân loại lại, và nút ${ui('Tự nhận diện lại')} bỏ phần sửa tay.</p>
<p>App đóng gói sẵn bảng ICORE2026 và SJR 2025. Nút ${ui('Cập nhật bảng xếp hạng trực tuyến')} trong ${ui('Cài đặt')} tải bản mới nhất từ hai trang gốc rồi phân loại lại cả thư viện. Hạng là thông tin tham khảo tại thời điểm của bảng, nên với quyết định quan trọng như chọn nơi nộp bài, cần kiểm tra lại trên trang gốc.</p>`,
  },
  {
    id: 'chat', title: 'Chat với nhiều paper', routes: ['chat'],
    html: `
<p>Trang ${ui('Chat với paper')} cho phép hỏi đáp nhiều lượt trên một nhóm paper chọn sẵn, chẳng hạn so sánh phương pháp, tổng hợp dataset hay tìm khoảng trống nghiên cứu. Trang chia ba cột gồm danh sách hội thoại, khung chat và bảng ${ui('Nguồn')} chứa các paper đang dùng.</p>
<p>Hội thoại mới chưa có paper sẽ hiện ba cách bắt đầu:</p>
<ul>
  <li>${ui('Dùng … paper đang chọn')} lấy các paper đã tick trong Thư viện hoặc trang So sánh. Nút ${ui('Chat')} ở hai trang đó cũng mở thẳng hội thoại với các paper này.</li>
  <li>${ui('Tìm và chọn từng paper')} mở bộ chọn trong bảng ${ui('Nguồn')}.</li>
  <li>${ui('Chọn cả một chủ đề')} thêm toàn bộ paper của chủ đề, sau đó có thể bỏ bớt.</li>
</ul>
<p>Bộ chọn có ô tìm theo tên, tác giả, tag, venue và ba bộ lọc gồm chủ đề, hạng venue, ${ui('có toàn văn')}. Tick hoặc bỏ tick một dòng là thêm hoặc bỏ paper ngay. Ô ${ui('Chọn tất cả')} ngay trên danh sách hoạt động như Gmail, chưa chọn gì thì bấm để thêm mọi paper đang khớp bộ lọc, đã chọn một phần thì bấm để bỏ chọn chúng. Bấm ${ui('Xong')} hoặc ${k('Esc')} để quay lại danh sách nguồn. Mỗi paper mang một nhãn cố định như P1, P2, nhãn không đổi khi bỏ bớt paper, nên các trích dẫn trong câu trả lời cũ vẫn trỏ đúng paper.</p>
<p>Thẻ paper trong bảng ${ui('Nguồn')} ghi ${ui('● toàn văn')} hoặc ${ui('○ chỉ ghi chú')}. Điều này quyết định chatbot đọc được gì, vì ô ${ui('Mức ngữ cảnh gửi cho AI')} có ba lựa chọn:</p>
<ul>
  <li>${ui('Chỉ ghi chú')} gửi ghi chú trích xuất, ghi chú cá nhân và trích dẫn bạn đánh dấu. Cách này rẻ và nhanh, đủ cho câu hỏi tổng quan và so sánh.</li>
  <li>${ui('Ghi chú + đoạn liên quan')} là mặc định. Với mỗi câu hỏi, app tìm các đoạn khớp nhất trong toàn văn đã lưu và gửi kèm. Câu hỏi tiếng Việt được đổi thành từ khoá tiếng Anh bằng một lượt gọi rất nhỏ để tìm đúng đoạn trong paper tiếng Anh. Mở mục ${ui('Đã gửi kèm … đoạn trích')} dưới câu hỏi để xem các đoạn đã dùng.</li>
  <li>${ui('Toàn văn')} gửi toàn bộ nội dung của mọi paper, tối đa khoảng 600.000 ký tự chia đều cho các paper. Cách này đầy đủ nhất nhưng tốn token nhất.</li>
</ul>
<p>Cuối bảng ${ui('Nguồn')} có ước tính số token ngữ cảnh. Với Claude, phần ngữ cảnh cố định được cache, nên từ câu hỏi thứ hai trong vòng vài phút phần này chỉ tính giá đọc cache, bằng khoảng một phần mười giá input thường. Chân mỗi câu trả lời ghi số token vào, token đọc và ghi cache, token ra.</p>
<p>Câu trả lời hiện dần trong lúc mô hình viết và gắn nhãn nguồn như P1 ngay sau ý lấy từ paper đó, bấm vào nhãn để mở paper. Nút ${ui('Dừng')} cắt ngang và giữ phần đã nhận, nút ${ui('Hỏi lại')} xuất hiện khi có lỗi, ${ui('Ẩn nguồn')} thu bảng bên phải để có thêm chỗ đọc, ${ui('Xuất .md')} lưu cả hội thoại kèm danh sách paper.</p>`,
  },
  {
    id: 'compare', title: 'So sánh và tổng hợp related work', routes: ['compare'],
    html: `
<p>Tick các paper ở cột bên phải (hoặc trong Thư viện) để đưa vào bảng so sánh. Nút ${ui('Thông số hiển thị')} mở danh sách mọi thông số đã trích xuất (kể cả chuỗi lập luận và lưu ý khi đọc), chia nhóm theo template: thông tin chung, problem và research gap, method và contribution, dataset và experiments, findings, limitations, relevance, references và evidence. Tick cả nhóm hoặc từng thông số, nút ${ui('Hiện tất cả')} bật toàn bộ, ${ui('Mặc định')} quay về ba cột Điểm mới, Dataset/Metric, Ý tưởng áp dụng.</p>
<p>${ui('Paper theo hàng')} là bảng thường. ${ui('Paper theo cột')} xoay bảng, mỗi thông số một hàng, dễ đọc hơn khi hiện nhiều thông số. Lựa chọn được nhớ lại cho lần sau. Khi chọn hiển thị ghi chú bằng ngôn ngữ khác, bảng dùng bản dịch đã lưu của từng paper và có nút dịch các paper chưa có bản dịch.</p>
<p>${ui('Copy Markdown')}, ${ui('CSV')}, ${ui('LaTeX')}, ${ui('Word')} xuất đúng các thông số đang chọn. ${ui('BibTeX')} tải trích dẫn của các paper, ${ui('Chat')} mở trang Chat với đúng các paper đang so sánh. Phần biểu đồ vẽ các metric trùng tên và dataset giữa ít nhất hai paper. Phần ${ui('Tổng hợp related work bằng AI')} viết bản nháp Related Work, có nút xuất riêng.</p>`,
  },
  {
    id: 'feed', title: 'Theo dõi paper mới', routes: ['feed'],
    html: `
<p>Trang ${ui('Theo dõi paper mới')} quét theo các bộ theo dõi do chúng ta tạo. Bộ loại từ khoá gồm từ khoá và danh mục arXiv như cs.CV hay cs.CL. Mỗi bộ có ô tick để chọn, phía trên có ${ui('Chọn tất cả')}, ${ui('Quét đã chọn')}, ${ui('Xoá đã chọn')} và ${ui('Xoá tất cả')}, xoá xong vẫn hoàn tác được. Hai loại còn lại tạo từ nút ${ui('🔔 Theo dõi')} ở tab Liên quan của trang paper: bài mới dẫn một paper, và bài mới của một tác giả (lấy từ Semantic Scholar). Paper đã có trong thư viện hoặc đã xem được làm mờ, nút ${ui('+ Thêm')} chuyển paper sang trang thêm để trích xuất.</p>
<p>arXiv giới hạn khoảng một yêu cầu mỗi ba giây và trả lỗi 429 khi bị gọi dồn. App tự chờ và thử lại, nhưng nếu vẫn báo lỗi thì chờ vài phút rồi quét lại. arXiv cập nhật theo ngày làm việc, nên quét mỗi sáng là đủ.</p>`,
  },
  {
    id: 'research', title: 'Hướng nghiên cứu', routes: ['paper'],
    html: `
<p>Tab ${ui('Hướng nghiên cứu')} của trang paper đặt bài đang xem (mã <b>P</b>) giữa các bài nó dẫn (<b>R1, R2…</b>) và các bài dẫn nó (<b>C1, C2…</b>), lấy từ Semantic Scholar, rồi nhờ mô hình lập:</p>
<ul>
  <li><b>Dòng nghiên cứu</b>: bài nền tảng đóng góp gì, các bài sau đẩy hướng này đi đâu.</li>
  <li><b>So sánh các bài</b>: quan hệ với bài gốc (nền tảng, baseline, mở rộng, áp dụng, cạnh tranh, phản biện), phương pháp, bài toán / gap, domain / dữ liệu, và điểm khác bài gốc.</li>
  <li><b>Ai cover khía cạnh nào</b>: từng khía cạnh (phương pháp, domain, dữ liệu, đánh giá, hiệu năng, độ bền vững…) bài gốc có cover không và bài nào đã cover.</li>
  <li><b>Còn bỏ ngỏ</b>: vấn đề chưa bài nào giải quyết trọn vẹn, kèm căn cứ.</li>
  <li><b>Hướng nghiên cứu tiếp theo</b>: ý tưởng, gap giải quyết, bài làm nền, bước đầu nên làm, rủi ro, và liên hệ với đề tài của bạn (nhập ở ${ui('Cài đặt')} → Đề tài của bạn).</li>
</ul>
<p>Bấm mã R / C để xem tóm tắt, câu trích dẫn và thêm bài vào thư viện. Mở nhanh từ nút ${ui('🧭 Hướng nghiên cứu')} trong tab ${ui('Liên quan')} hoặc trên thanh công cụ của ${ui('Đồ thị 3D')}. Kết quả được lưu trong paper; bấm ${ui('Cập nhật')} để làm lại, ${ui('Copy Markdown')} để mang sang tài liệu khác. Mô hình chỉ đọc tóm tắt và câu trích dẫn, chưa đọc toàn văn từng bài.</p>`,
  },
  {
    id: 'notes', title: 'Ghi chú & thẻ ghi nhớ', routes: ['notes'],
    html: `
<p>Trang ${ui('Ghi chú & thẻ ghi nhớ')} (thanh bên trái, hoặc nút 文 trên thanh đầu trang) gom mọi đoạn bạn đã lưu bằng ${ui('+ Ghi chú')} trong bong bóng dịch, cùng các trích dẫn thêm tay ở trang paper, của tất cả paper.</p>
<ul>
  <li>${ui('Danh sách')}: tìm trong đoạn gốc, bản dịch, nhận xét, tên paper; lọc theo paper, chỉ đoạn có bản dịch; sắp xếp mới nhất, cũ nhất, theo paper. Mỗi đoạn có nút sao chép, sửa, xoá (hoàn tác được) và link về paper.</li>
  <li>${ui('Thẻ ghi nhớ')}: mặt trước là đoạn gốc, lật ra bản dịch và nhận xét. Space lật thẻ, ← → chuyển thẻ, phím 1 đánh dấu ${ui('Nhớ rồi')}. Có ${ui('Chỉ thẻ chưa nhớ')} và ${ui('Trộn thẻ')}.</li>
  <li>${ui('Tải CSV (Anki)')} xuất hai cột mặt trước / mặt sau, nhập được vào Anki hoặc Quizlet. ${ui('Tải Markdown')} xuất cả danh sách.</li>
</ul>
<p>Nút 文 trên thanh đầu trang mở bảng cài đặt nhanh của dịch khi bôi đen: bật / tắt dịch ở mọi trang, ngôn ngữ đích, cách kích hoạt, cách mở bản dịch, dịch theo ngữ cảnh, hiện đoạn gốc. Đổi là lưu ngay. Nút mờ đi khi đang tắt dịch ngoài trình đọc PDF.</p>`,
  },
  {
    id: 'topics', title: 'Chủ đề và tag', routes: ['topics'],
    html: `
<p>Chủ đề là thư mục của thư viện và cũng là thư mục con khi xuất ra Markdown. Mỗi chủ đề có tên, màu, mô tả và danh sách từ khoá. App dùng từ khoá này để gợi ý chủ đề khi trích xuất, cụm từ được tính điểm cao hơn từ đơn và từ xuất hiện ở tiêu đề được cộng thêm. ${ui('Gộp')} chuyển toàn bộ paper của một chủ đề sang chủ đề khác rồi xoá chủ đề cũ.</p>
<p>Tag là từ khoá tự do mà mô hình gán khi trích xuất. Bảng tag ở cuối trang cho đổi tên, gộp hai tag hoặc xoá một tag trên toàn thư viện, hữu ích khi mô hình gán các biến thể như "vqa" và "visual qa".</p>`,
  },
  {
    id: 'settings', title: 'Cài đặt, chi phí và dữ liệu', routes: ['settings'],
    html: `
<p>Các nhóm cài đặt chính gồm:</p>
<ul>
  <li><b>Mô hình.</b> Chọn nhà cung cấp, model và key. Với Claude, mức effort điều chỉnh độ kỹ của mô hình, mức thấp rẻ và nhanh hơn. Với các model Claude có bộ lọc an toàn, app bật cơ chế chuyển model dự phòng phía máy chủ, nên khi một yêu cầu bị từ chối, API tự chạy lại trên model phù hợp thay vì trả về lỗi.</li>
  <li><b>Trích xuất.</b> Ngôn ngữ ghi chú, số ký tự tối đa gửi đi và cách xử lý PDF. Toàn văn dài hơn giới hạn sẽ bị lược phần giữa, giữ phần đầu và phần cuối vì Limitation thường nằm cuối bài.</li>
  <li><b>Bảng xếp hạng venue.</b> Xem phiên bản bảng CORE và SJR đang dùng, cập nhật trực tuyến và phân loại lại.</li>
  <li><b>Số trích dẫn.</b> Cập nhật số trích dẫn của cả thư viện từ Semantic Scholar theo lô. Tổng quan sẽ nhắc khi đã quá hai tuần chưa cập nhật.</li>
  <li><b>Sử dụng API.</b> Bảng token theo model trong tháng, tách token input thường, token đọc và ghi cache, token output. Nhập đơn giá (USD cho một triệu token) để app ước tính chi phí.</li>
  <li><b>Thư mục xuất Markdown.</b> Ghi thư viện ra một thư mục, mỗi chủ đề một thư mục con, kèm bảng so sánh và <code>references.bib</code>. Có thể bật tự ghi sau mỗi lần lưu.</li>
  <li><b>Sao lưu.</b> Tải JSON kèm toàn văn, nhập gộp hoặc nhập thay thế.</li>
</ul>
<p>Toàn bộ dữ liệu (cơ sở dữ liệu SQLite và PDF) nằm trong một thư mục. Muốn dùng trên nhiều máy qua OneDrive hoặc Google Drive, bấm ${ui('Đổi thư mục dữ liệu')} và chọn thư mục trong ổ đồng bộ, app sẽ sao chép dữ liệu sang và khởi động lại. Cần chỉ mở app trên một máy tại một thời điểm và chờ ổ đồng bộ xong trước khi mở trên máy khác, vì dịch vụ đồng bộ không hợp nhất được hai bản cơ sở dữ liệu bị sửa cùng lúc.</p>`,
  },
  {
    id: 'extension', title: 'Dùng cùng extension', routes: [],
    html: `
<p>Extension PaperVault trên Chrome hoặc Edge tiện khi đang đọc paper trên trình duyệt. Khi app đang chạy, extension có thêm hai nút:</p>
<ul>
  <li>${ui('→ App')} trong popup đẩy trang đang đọc, hoặc kết quả extension đã trích xuất, vào hộp thư của app. Hộp thư hiện ở đầu trang ${ui('Thêm paper')} và trên nhãn của mục menu, kết quả đã trích xuất sẵn thì lưu ngay không tốn thêm token.</li>
  <li>${ui('→ Đồng bộ sang App')} trong thư viện extension nhập toàn bộ thư viện, bỏ qua paper app đã có.</li>
</ul>
<p>Địa chỉ app mặc định là <code>http://127.0.0.1:8765</code>, chỉnh trong ${ui('Cài đặt')} của extension. Sau khi cập nhật extension cần tải lại nó ở trang quản lý extension của trình duyệt.</p>`,
  },
  {
    id: 'keys', title: 'Phím tắt', routes: [],
    html: `
<table class="kv">
  <tr><th>${k('/')}</th><td>Đưa con trỏ vào ô tìm kiếm</td></tr>
  <tr><th>${k('n')}</th><td>Mở trang Thêm paper</td></tr>
  <tr><th>${k('g')} rồi ${k('d')} ${k('l')} ${k('c')} ${k('t')} ${k('s')} ${k('f')} ${k('h')} ${k('a')} ${k('n')}</th><td>Đi tới Tổng quan, Thư viện, So sánh, Chủ đề, Cài đặt, Theo dõi, Hướng dẫn, Chat, Ghi chú &amp; thẻ ghi nhớ. Phím tắt của từng trang hiện mờ cạnh mục đó ở thanh bên trái.</td></tr>
  <tr><th>${k('?')}</th><td>Mở trang Hướng dẫn</td></tr>
  <tr><th>${k('Ctrl')}+${k('Shift')}+${k('D')}</th><td>Dịch ngay đoạn đang bôi đen</td></tr>
  <tr><th>${k('Space')} ${k('←')} ${k('→')} ${k('1')}</th><td>Thẻ ghi nhớ: lật thẻ, thẻ trước, thẻ sau, đánh dấu đã nhớ</td></tr>
  <tr><th>${k('j')} ${k('k')}</th><td>Di chuyển giữa các paper trong danh sách</td></tr>
  <tr><th>${k('Enter')}</th><td>Mở paper đang chọn trong danh sách</td></tr>
  <tr><th>${k('x')}</th><td>Tick hoặc bỏ tick paper đang chọn</td></tr>
  <tr><th>${k('Esc')}</th><td>Đóng hộp thoại</td></tr>
  <tr><th>${k('Enter')} trong ô chat</th><td>Gửi câu hỏi, ${k('Shift')}+${k('Enter')} để xuống dòng</td></tr>
</table>`,
  },
  {
    id: 'trouble', title: 'Xử lý sự cố', routes: [],
    html: `
<ul>
  <li><b>Báo lỗi 401 hoặc 403.</b> Key sai, hết hạn hoặc không có quyền dùng model đã chọn. Kiểm tra lại key và tên model trong ${ui('Cài đặt')}, rồi bấm ${ui('Kiểm tra kết nối')}.</li>
  <li><b>Báo lỗi 429.</b> Nhà cung cấp đang giới hạn tốc độ hoặc tài khoản hết hạn mức. App tự thử lại ba lần với thời gian chờ tăng dần. Nếu vẫn lỗi, chờ vài phút hoặc giảm số paper xử lý mỗi lần.</li>
  <li><b>Thiếu venue, số trích dẫn hoặc báo Semantic Scholar 429.</b> Semantic Scholar giới hạn tốc độ rất chặt với người dùng không có key, và giới hạn này dùng chung cho mọi người. Xin key miễn phí tại api.semanticscholar.org rồi dán vào ${ui('Cài đặt')}. Khi Semantic Scholar bị chặn, app thử OpenAlex để tìm venue và tìm theo tiêu đề, nhưng OpenAlex không có đủ mọi bài.</li>
  <li><b>Link OpenReview báo lỗi.</b> OpenReview chặn mọi truy cập tự động từ ứng dụng. Hãy tải PDF trên trang OpenReview rồi thêm qua tab ${ui('File PDF')} của trang ${ui('Thêm paper')}, hoặc mở trang bằng trình duyệt và dùng nút ${ui('→ App')} của extension.</li>
  <li><b>Phản hồi bị cắt.</b> Tăng ${ui('Max output tokens')} trong ${ui('Cài đặt')}. Trong Chat, dòng chân câu trả lời ghi rõ khi câu trả lời bị cắt vì đạt giới hạn độ dài.</li>
  <li><b>Trích xuất ra ký tự lạ.</b> PDF dùng font không kèm bảng mã ký tự nên bộ trích text cục bộ đọc sai. Chuyển sang Claude hoặc Gemini để gửi thẳng file PDF.</li>
  <li><b>Venue hiện sai hoặc trống.</b> Bấm ${ui('Sửa venue')} trong trang paper, hoặc điền đúng tên venue ở tab ${ui('Chỉnh sửa')} để app nhận diện lại.</li>
  <li><b>Chat trả lời chung chung.</b> Kiểm tra paper đã có toàn văn chưa (dòng thông tin báo các nhãn chưa có), rồi chuyển sang chế độ ${ui('Ghi chú + đoạn liên quan')} hoặc ${ui('Toàn văn')}.</li>
  <li><b>Cửa sổ app trắng sau khi tắt đột ngột.</b> App tự dọn tiến trình WebView còn sót khi mở lại. Nếu vẫn trắng, xoá thư mục <code>webview</code> trong thư mục dữ liệu rồi mở lại.</li>
  <li><b>Hai máy thấy dữ liệu khác nhau khi dùng cloud.</b> Có thể app đã mở đồng thời trên hai máy. Dịch vụ đồng bộ thường giữ cả hai bản dưới tên khác nhau, nên cần chọn bản đúng, xoá bản còn lại và chỉ mở app trên một máy mỗi lần.</li>
</ul>`,
  },
];

/** Mục hướng dẫn phù hợp với trang đang xem. */
export function sectionForRoute(name) {
  const hit = SECTIONS.find((s) => s.routes.includes(name));
  return hit ? hit.id : 'start';
}

export async function render(root, { query }) {
  const target = query.get('s') || 'start';
  root.innerHTML = `<div class="help-page">
    <aside class="help-toc">
      <input type="search" id="hp-q" placeholder="Tìm trong hướng dẫn…">
      <nav id="hp-toc">${SECTIONS.map((s) => `<a href="#/help?s=${s.id}" data-s="${s.id}">${escapeHtml(s.title)}</a>`).join('')}</nav>
    </aside>
    <div class="help-body" id="hp-body">
      <div class="page-head"><h1>Hướng dẫn sử dụng</h1></div>
      ${SECTIONS.map((s) => `<section class="card help-sec" id="help-${s.id}" data-s="${s.id}"><h2>${escapeHtml(s.title)}</h2>${s.html}</section>`).join('')}
      <div id="hp-empty" class="empty" hidden>Không tìm thấy mục nào khớp.</div>
    </div>
  </div>`;

  const focus = (id) => {
    const el = document.getElementById(`help-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    root.querySelectorAll('#hp-toc a').forEach((a) => a.classList.toggle('active', a.dataset.s === id));
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1200);
  };
  requestAnimationFrame(() => focus(target));

  root.querySelector('#hp-toc').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-s]');
    if (!a) return;
    e.preventDefault();
    history.replaceState(null, '', `#/help?s=${a.dataset.s}`);
    focus(a.dataset.s);
  });
  $('hp-q').addEventListener('input', (e) => {
    const q = norm(e.target.value.trim());
    let shown = 0;
    for (const sec of root.querySelectorAll('.help-sec')) {
      const ok = !q || norm(sec.textContent).includes(q);
      sec.hidden = !ok;
      root.querySelector(`#hp-toc a[data-s="${sec.dataset.s}"]`).hidden = !ok;
      if (ok) shown++;
    }
    $('hp-empty').hidden = shown > 0;
  });
}
