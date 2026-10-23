// Hướng dẫn sử dụng trong app: mục lục theo nhóm, tìm kiếm, ảnh minh hoạ có đánh số bước, mở đúng mục theo trang đang xem.
// Ảnh nằm ở static/img/help/ (chụp từ dữ liệu mẫu, số ①②③ trên ảnh khớp với danh sách bước bên dưới ảnh).
import { escapeHtml, norm } from '../util.js';
import { $ } from '../ui.js';

const ui = (s) => `<span class="ui">${s}</span>`;
const k = (s) => `<kbd>${s}</kbd>`;
/** Ảnh minh hoạ; bấm để phóng to. */
const fig = (name, caption) => `<figure class="hp-fig"><img src="img/help/${name}.webp" alt="${escapeHtml(caption)}" loading="lazy" data-zoom><figcaption>${caption}</figcaption></figure>`;
/** Danh sách bước, số khớp với số đánh dấu trên ảnh ngay phía trên. */
const steps = (list) => `<ol class="hp-steps">${list.map((s, i) => `<li><span class="hp-n">${i + 1}</span><div>${s}</div></li>`).join('')}</ol>`;
const step = (n, title) => `<h3 class="hp-step"><span class="hp-badge">Bước ${n}</span>${title}</h3>`;

export const GROUPS = [
  ['start', 'Bắt đầu'],
  ['lib', 'Thư viện'],
  ['explore', 'Khám phá & phân tích'],
  ['me', 'Cá nhân'],
  ['tools', 'Công cụ & cài đặt'],
];

export const SECTIONS = [
  /* ============================== Bắt đầu ============================== */
  {
    id: 'start', group: 'start', title: 'Bắt đầu nhanh', routes: [''],
    html: `
<p>PaperVault giúp thu thập paper, để AI đọc và viết ghi chú theo template, sắp xếp thành thư viện có chủ đề và hạng venue, rồi so sánh, hỏi đáp, ghi chép và lên kế hoạch đọc. Lần đầu dùng app, làm theo ba bước dưới đây.</p>
${step(1, 'Nhập API key và mô tả đề tài')}
<p>Mở ${ui('Cài đặt')} ở cuối thanh bên trái.</p>
${fig('settings', 'Trang Cài đặt, thẻ Mô hình và Đề tài của bạn')}
${steps([
    `Chọn <b>nhà cung cấp</b>: Claude (Anthropic), OpenAI hoặc Google Gemini.`,
    `Gõ tên <b>model</b> mà key của bạn dùng được (dòng gợi ý bên dưới ô có vài tên phổ biến).`,
    `Dán <b>API key</b>. Key chỉ lưu trong tệp dữ liệu trên máy bạn, app không gửi đi đâu khác ngoài nhà cung cấp đã chọn.`,
    `Bấm ${ui('Kiểm tra kết nối')}: app gọi thử một câu rất ngắn, báo "Kết nối OK" nếu key và model đúng.`,
    `Viết 2–3 câu về <b>đề tài của bạn</b>. App dùng đoạn này để viết mục "liên quan tới bài của tôi", trả lời trong Chat và gợi ý hướng nghiên cứu, nên càng cụ thể càng tốt.`,
    `Bấm ${ui('Lưu cài đặt')}.`,
  ])}
${step(2, 'Thêm paper đầu tiên')}
<p>Bấm ${ui('Thêm paper')} (góc trên bên phải, hoặc phím ${k('N')}).</p>
${fig('add', 'Trang Thêm paper')}
${steps([
    `Chọn cách thêm: link / arXiv / DOI, file PDF, dán text, hàng loạt, hoặc nhập từ Zotero (.bib / .ris).`,
    `Dán arXiv ID (ví dụ <code>2006.11239</code>), link arXiv, DOI hoặc link trang paper.`,
    `Bấm ${ui('Tra cứu')}. App tự lấy tiêu đề, tác giả, venue, số trích dẫn, toàn văn và PDF nếu có.`,
  ])}
${fig('add-result', 'Kết quả tra cứu, sẵn sàng trích xuất ghi chú')}
${steps([
    `Xem lại thông tin: tiêu đề, tác giả, năm, venue, loại toàn văn tìm được, TL;DR.`,
    `Bấm ${ui('Trích xuất ghi chú')}: AI đọc paper (10–90 giây) và điền ghi chú theo template. Xem lại bản ghi chú, chọn chủ đề rồi bấm ${ui('Lưu vào thư viện')}.`,
    `Hoặc ${ui('Lưu chỉ metadata')} để lưu ngay mà không tốn token; ghi chú trích xuất sau bằng nút ${ui('Trích xuất lại')} trong trang paper.`,
  ])}
${step(3, 'Đọc và làm việc với paper')}
<p>Mở paper vừa lưu từ ${ui('Thư viện')}: đọc ghi chú, đọc PDF kèm dịch khi bôi đen, hỏi đáp, xem bản đồ tài liệu, ghi chép vào Sổ tay. Xem mục <a href="#/help?s=paper">Trang paper</a>.</p>
<p class="hint">Đã có dữ liệu trong extension PaperVault? Trong thư viện extension bấm ${ui('→ Đồng bộ sang App')} khi app đang chạy, hoặc xuất JSON rồi nhập ở ${ui('Cài đặt')} → ${ui('Sao lưu & nhập dữ liệu')}.</p>
<details class="hp-more"><summary>Ghi chú theo template gồm những mục nào?</summary>
<ul>
  <li><b>1–2. Paper, Venue/Year</b>: tên, tác giả, nơi công bố và năm.</li>
  <li><b>3. Problem &amp; Motivation</b>: bài toán cụ thể (input, output, bối cảnh) và lý do bài toán quan trọng.</li>
  <li><b>4. Research Gap</b>: hạn chế của các nghiên cứu trước và vấn đề còn bỏ ngỏ.</li>
  <li><b>5. Research Question/Objective</b>: mục tiêu và giả thuyết nghiên cứu.</li>
  <li><b>6. Method</b>: ý tưởng cốt lõi, các bước pipeline, mô hình và kỹ thuật, điểm khác biệt so với phương pháp trước.</li>
  <li><b>7. Contribution</b>: các đóng góp mới.</li>
  <li><b>8. Dataset</b>: bảng tên, nguồn, quy mô, đặc điểm và tiền xử lý của từng dataset.</li>
  <li><b>9. Experiments</b> và <b>10. Findings</b>: thiết lập thí nghiệm, baseline, metric, ablation, các con số chính và phát hiện chính.</li>
  <li><b>11. Limitations</b>: hạn chế tác giả thừa nhận và hạn chế mô hình nhận thấy, vấn đề chưa giải quyết, chi phí tính toán.</li>
  <li><b>12. Relevance to Our Work</b>: liên hệ với đề tài trong Cài đặt: liên quan phần nào, kế thừa được gì, mở rộng ở đâu.</li>
  <li><b>References</b> và <b>Important Evidence</b>: DOI, link code, bảng claim kèm vị trí trong paper và mục đích trích dẫn.</li>
</ul></details>`,
  },
  {
    id: 'ui', group: 'start', title: 'Làm quen giao diện', routes: [],
    html: `
${fig('overview', 'Thanh bên trái và thanh trên cùng')}
${steps([
    `<b>Thư viện</b>: ${ui('Tổng quan')} (số liệu, paper gần đây, hàng đợi đọc), ${ui('Thư viện')}, ${ui('Thêm paper')}, ${ui('Chủ đề')}.`,
    `<b>Khám phá &amp; phân tích</b>: ${ui('Paper mới')} (theo dõi arXiv), ${ui('Chat với paper')}, ${ui('So sánh')}.`,
    `<b>Cá nhân</b>: ${ui('Sổ tay')} nghiên cứu, ${ui('Lịch')} kế hoạch, ${ui('Thẻ ghi nhớ')}.`,
    `<b>Tìm nhanh</b> (${k('Ctrl')}+${k('K')} hoặc ${k('/')}): một ô tìm mọi thứ, gồm paper, nội dung PDF, trang Sổ tay, cuộc trò chuyện, việc trong Lịch và các lệnh (gõ ${k('>')} để chỉ tìm lệnh). ${k('↑')} ${k('↓')} chọn, ${k('Enter')} mở; khi chia đôi màn hình, ${k('Alt')}+${k('Enter')} mở ở khung bên kia. Cuối danh sách có ${ui('Lọc Thư viện theo …')} và ${ui('Tạo trang sổ tay …')}.`,
    `<b>Chia đôi màn hình</b>: mở hai chức năng cạnh nhau (xem mục <a href="#/help?s=split">Chia đôi màn hình</a>).`,
    `<b>Dịch khi bôi đen</b>: cài đặt nhanh ngôn ngữ đích, cách bật, và mở trang Thẻ ghi nhớ.`,
    `<b>Hướng dẫn</b> cho đúng trang đang xem (phím ${k('?')}).`,
    `<b>Thêm paper</b> (phím ${k('N')}).`,
  ])}
<p>Mỗi mục ở thanh bên có phím tắt hiện mờ bên cạnh: gõ ${k('G')} rồi một phím, ví dụ ${k('G')} ${k('L')} mở Thư viện, ${k('G')} ${k('B')} mở Sổ tay, ${k('G')} ${k('K')} mở Lịch. Danh sách đầy đủ ở mục <a href="#/help?s=keys">Phím tắt</a>.</p>`,
  },

  /* ============================== Thư viện ============================== */
  {
    id: 'add', group: 'lib', title: 'Thêm một paper', routes: ['add'],
    html: `
<p>Trang ${ui('Thêm paper')} có nhiều cách đưa một paper vào thư viện, tuỳ nguồn đang có (ảnh minh hoạ ở mục <a href="#/help?s=start">Bắt đầu nhanh</a>, bước 2):</p>
<ul>
  <li>${ui('Link / arXiv / DOI')} nhận arXiv ID, link arXiv, DOI, link OpenReview, ACL Anthology hoặc trang paper bất kỳ. Máy chủ của app tự tải abstract, toàn văn HTML của arXiv và file PDF nếu có.</li>
  <li>${ui('File PDF')} nhận một file PDF từ máy: bấm vào ô chọn file hoặc kéo PDF thả đúng vào ô đó. Chọn nhiều file cùng lúc thì app chuyển sang chế độ hàng loạt. PDF thả ở trang khác không được nhập, để tránh thêm nhầm.</li>
  <li>${ui('Dán text')} dùng khi chỉ có abstract hoặc một đoạn văn. Nút ${ui('Tạo note trống')} tạo paper để tự điền tay, không gọi mô hình.</li>
  <li>${ui('Zotero / .bib / .ris')}: ${ui('Đọc thư viện Zotero')} đọc thẳng thư viện Zotero trên máy (tên, tác giả, năm, DOI, abstract, tag, collection, ghi chú, highlight và file PDF), không cần xuất file và không gọi mô hình. Chọn mục, chọn ${ui('Theo collection')} để mỗi collection thành một chủ đề, rồi ${ui('Nhập mục đã chọn')}. Thư viện ở chỗ khác thì dán đường dẫn thư mục dữ liệu (Zotero: Edit → Settings → Advanced → Files and Folders). Zotero đang mở vẫn đọc được. Mendeley: <i>File → Export</i> ra BibTeX, RIS hoặc CSL JSON rồi chọn file ở ô bên dưới.</li>
</ul>
<p>Sau khi trích xuất, app hiện bản ghi chú để kiểm tra trước khi lưu, gợi ý thư mục chủ đề và báo nếu paper đã có trong thư viện. Khi trùng, chọn cập nhật bản cũ (giữ ghi chú, trạng thái, đánh giá) hoặc lưu thành bản mới.</p>
<p>Với Claude và Gemini, file PDF được gửi thẳng cho mô hình nên bảng kết quả và hình cũng được đọc. OpenAI không nhận PDF qua API này, nên app trích text từ PDF trước. PDF bản scan không có lớp chữ chỉ dùng được với Claude hoặc Gemini.</p>`,
  },
  {
    id: 'batch', group: 'lib', title: 'Thêm hàng loạt', routes: ['add'],
    html: `
<p>Tab ${ui('Hàng loạt')} dành cho lúc có nhiều paper cùng lúc: một email reading list, một trang ghi chú hoặc một thư mục PDF. Quy trình có ba bước hiện ở đầu trang:</p>
${steps([
    `<b>Đưa nguồn vào.</b> Dán văn bản bất kỳ rồi bấm ${ui('Tìm paper trong văn bản')} (hoặc ${k('Ctrl')}+${k('Enter')}), hoặc thả nhiều file PDF, cả thư mục, vào ô bên phải. App nhận arXiv ID (kể cả dạng trần như 2401.12345), DOI, link OpenReview, ACL Anthology, Hugging Face Papers, link PDF, trang nhà xuất bản và mục BibTeX. Link không giống paper (GitHub, YouTube) được để riêng, vẫn thêm được nếu cần.`,
    `<b>Duyệt và chọn.</b> App tự tra tiêu đề, tác giả, năm, venue kèm hạng, số trích dẫn cho từng mục, không tốn token. Mỗi paper là một thẻ có ${ui('✓ Thêm')} và ${ui('Bỏ qua')}. Paper đã có trong thư viện được chuyển sẵn sang ${ui('Bỏ qua')}, kèm lời giải thích.`,
    `<b>Lưu vào thư viện.</b> Thanh dưới cùng cho biết bao nhiêu paper sẽ được thêm. Ô ${ui('Trích xuất ghi chú bằng AI')} bật sẵn khi đã có API key; tắt thì app chỉ lưu thông tin cơ bản.`,
  ])}
<p>Các tab ${ui('Tất cả')}, ${ui('Sẽ thêm')}, ${ui('Đã có / trùng')}, ${ui('Cần xử lý')}, ${ui('Đã lưu')} giúp xem riêng từng nhóm. Mục lỗi nằm ở ${ui('Cần xử lý')} với nút ${ui('Thử lại')}. Danh sách được lưu lại, đóng app mở lại vẫn còn; ${ui('Dừng')} dừng sau mục đang xử lý mà không mất kết quả đã xong.</p>`,
  },
  {
    id: 'library', group: 'lib', title: 'Thư viện, tìm kiếm và dọn dẹp', routes: ['library'],
    html: `
${fig('library', 'Trang Thư viện')}
${steps([
    `<b>Chủ đề</b>: bấm để lọc. Kéo một paper thả vào tên chủ đề để chuyển thư mục. Cuối danh sách là ${ui('Thùng rác')} (giữ 30 ngày).`,
    `<b>Lọc và tìm</b>: ô lọc tìm cả trong ghi chú, ghi chú cá nhân, tag và <b>toàn văn đã lưu</b> (đoạn khớp được tô sáng). Các ô bên cạnh lọc theo trạng thái, loại venue, hạng, đánh giá; ô sắp xếp có ${ui('Hạng venue')} và ${ui('Trích dẫn nhiều')}.`,
    `<b>Kiểu xem</b>: danh sách, kanban theo trạng thái đọc (kéo thẻ giữa các cột để đổi trạng thái) và bảng.`,
    `<b>Chọn tất cả</b> kiểu Gmail. Mũi tên bên cạnh chọn nhanh theo điều kiện: ${ui('Chưa đọc')}, ${ui('Có PDF')}, ${ui('Chưa trích xuất')}, ${ui('Đảo lựa chọn')}…`,
    `<b>Thẻ paper</b>: bấm để mở; ô vuông để tick. Phím ${k('j')} ${k('k')} di chuyển, ${k('Enter')} mở, ${k('x')} tick.`,
  ])}
<p>Khi có paper được tick, thanh chọn hiện ${ui('Chat')}, ${ui('So sánh')}, ${ui('Chuyển thư mục')}, ${ui('Xoá')}, và ${ui('Khác')} gồm ${ui('Đổi trạng thái')}, ${ui('Gắn nhãn phụ')}, ${ui('Xuất')}, ${ui('Tìm & tải PDF')}, ${ui('Trích xuất lại ghi chú (AI)')}. Trích xuất lại chạy lần lượt từng paper, có bảng tiến trình và nút ${ui('Dừng')} ở góc dưới, vẫn chạy tiếp khi sang trang khác; ghi chú cá nhân, trạng thái, đánh giá được giữ nguyên.</p>
<p>${ui('Dọn trùng')} gom các paper trùng arXiv ID, DOI hoặc tên, giữ bản mới nhất và gộp ghi chú, đánh giá, PDF, nhãn từ các bản còn lại. Một paper có một chủ đề chính và có thể mang thêm nhãn phụ, nên hiện ở cả hai chủ đề.</p>`,
  },
  {
    id: 'paper', group: 'lib', title: 'Trang paper và ghi chú', routes: ['paper'],
    html: `
${fig('paper', 'Trang của một paper, tab Ghi chú')}
${steps([
    `<b>Tên paper</b>: bấm để sửa. Phía trên có ${ui('Copy Markdown')}, ${ui('Trích xuất lại')}, ${ui('Xoá')}, và ${ui('▴ Thu gọn')} để ẩn tác giả, tag (hữu ích khi chia đôi màn hình).`,
    `<b>Chủ đề và trạng thái đọc</b> (Chưa đọc, Đang đọc, Đã đọc), thêm nhãn phụ, đánh giá sao.`,
    `<b>Các tab</b>: Ghi chú, PDF, Bài giảng, Hỏi đáp, Liên quan, Hướng nghiên cứu, Trích dẫn, Chỉnh sửa, Nguồn. Khung hẹp thì lăn chuột trên thanh tab để cuộn ngang.`,
    `<b>Ngôn ngữ ghi chú</b>: xem bằng tiếng Việt hoặc tiếng Anh (xem mục <a href="#/help?s=notes-lang">Ghi chú hai ngôn ngữ</a>).`,
    `<b>Kiểm tra ghi chú</b>: đối chiếu số liệu với toàn văn và bắt câu chung chung (xem mục <a href="#/help?s=quality">Kiểm tra ghi chú</a>).`,
    `<b>↻ ở góc mỗi mục</b>: trích xuất lại riêng mục đó, có thể ghi thêm yêu cầu; các mục khác giữ nguyên, có ${ui('Hoàn tác')}.`,
  ])}
<p>Các tab:</p>
<ul>
  <li>${ui('Ghi chú')}: venue và hạng, ghi chú theo template, ghi chú cá nhân (${k('Ctrl')}+${k('Enter')} lưu nhanh), trích dẫn theo đoạn, câu đáng nhớ, và thẻ ${ui('📓 Trong sổ tay nghiên cứu')} liệt kê các trang nhắc tới bài này.</li>
  <li>${ui('PDF')}: đọc file ngay trong app, bôi đen để dịch, tô sáng, gạch chân, AI tô câu đáng nhớ. Paper chưa có PDF thì app tự tìm bản công khai. Xem các mục <a href="#/help?s=translate">Dịch khi đọc PDF</a>, <a href="#/help?s=marks">Tô sáng và tìm PDF</a>, <a href="#/help?s=autohl">Tô câu đáng nhớ</a>.</li>
  <li>${ui('Bài giảng')}: bản giải thích dài tám phần (xem mục <a href="#/help?s=lecture">Bài giảng</a>).</li>
  <li>${ui('Hỏi đáp')}: hỏi mô hình về riêng paper này, dùng ghi chú và toàn văn đã lưu. Đính kèm được ảnh (hình, bảng, ảnh chụp màn hình) và file như ở Chat: nút ${ui('📎 Đính kèm')}, dán ${k('Ctrl')}+${k('V')} hoặc kéo thả. Dưới mỗi câu trả lời có ${ui('📓 Lưu vào Sổ tay')} và ${ui('Copy')}. Ô ${ui('Ngôn ngữ trả lời')} dùng chung với Chat.</li>
  <li>${ui('Liên quan')}: Semantic Scholar, bản đồ tài liệu, đồ thị 3D, Có gì mới, Theo dõi (xem mục <a href="#/help?s=related">Liên quan, bản đồ, đồ thị</a>).</li>
  <li>${ui('Hướng nghiên cứu')}: đặt bài giữa các bài nó dẫn và các bài dẫn nó, chỉ ra phần còn bỏ ngỏ (xem mục <a href="#/help?s=research">Hướng nghiên cứu</a>).</li>
  <li>${ui('Trích dẫn')}: BibTeX và APA bản thứ 7; ${ui('Copy có định dạng')} giữ in nghiêng khi dán vào Word hay Google Docs. App chưa lưu số tập, số kỳ, số trang nên phần đó cần bổ sung tay.</li>
  <li>${ui('Chỉnh sửa')}: sửa mọi trường. Bảng metric nhập mỗi dòng <code>metric | dataset | baseline | đề xuất | Δ</code>, dataset nhập <code>tên | source | scale | đặc điểm | tiền xử lý</code>, Important Evidence nhập <code>claim | vị trí | mục đích</code>.</li>
  <li>${ui('Nguồn')}: toàn văn đã gửi cho mô hình. Bôi đen một đoạn rồi ${ui('Ghi chú đoạn đã chọn')} để lưu kèm nhận xét và số trang.</li>
</ul>
<p>Ghi chú, bài giảng, Hỏi đáp và Chat hiển thị công thức LaTeX trong <code>$...$</code> / <code>$$...$$</code> (KaTeX, chạy offline), đoạn liệt kê viết liền "1) … 2) …" được tách thành danh sách, mọi link đều bấm được. Mọi bảng đổi được độ rộng cột: kéo mép phải tiêu đề cột, bấm đúp để về tự động. Phông và cỡ chữ đổi ở ${ui('Cài đặt')} → ${ui('Phông chữ & cỡ chữ')}.</p>`,
  },
  {
    id: 'quality', group: 'lib', title: 'Kiểm tra ghi chú', routes: [],
    html: `
<p>Đầu tab ${ui('Ghi chú')} có thẻ ${ui('Kiểm tra ghi chú')} (số ⑤ ở ảnh trang paper). App tự chạy hai phép kiểm cơ học, không gọi mô hình và không tốn token:</p>
<ul>
  <li><b>Đối chiếu số liệu.</b> Mọi con số trong ghi chú được dò trong toàn văn đã lưu. Con số không thấy được liệt kê kèm mục chứa nó: có thể mô hình ghi nhầm, tự tính, hoặc con số nằm trong bảng mà bộ bóc chữ bỏ sót. Nên mở PDF đối chiếu trước khi trích dẫn. Tên mô hình như Qwen2.5-7B, số bảng, năm và cột Δ không bị tính là số liệu.</li>
  <li><b>Câu chung chung.</b> Bắt các câu đúng nhưng không mang thông tin: nói "cải thiện" mà không nói bằng cách nào hay bao nhiêu, cụm kiểu "đóng vai trò quan trọng", câu dài không có cơ chế hay con số, mô tả chỉ lặp lại tên kỹ thuật.</li>
</ul>
<p>Paper có PDF mà chưa có toàn văn dạng chữ thì app tự đọc chữ từ PDF để đối chiếu rồi lưu luôn làm toàn văn. Trong ${ui('Chat với paper')}, mỗi câu trả lời cũng được dò số liệu, con số không thấy hiện thành dòng cảnh báo. Cuối bản ghi chú còn có ${ui('Chuỗi lập luận')} (6–10 mắt xích từ tiền đề đến kết luận) và ${ui('Lưu ý khi đọc')} (chỗ dễ hiểu nhầm hoặc khẳng định mạnh hơn bằng chứng).</p>`,
  },
  {
    id: 'notes-lang', group: 'lib', title: 'Ghi chú hai ngôn ngữ', routes: [],
    html: `
<p>Ghi chú được trích xuất một lần theo ${ui('Ngôn ngữ khi trích xuất')} trong ${ui('Cài đặt')}. Muốn đọc bằng ngôn ngữ kia, bấm ${ui('Tiếng Việt')} hoặc ${ui('English')} ở đầu tab ${ui('Ghi chú')} (số ④ ở ảnh trang paper). Lựa chọn áp dụng cho mọi paper.</p>
<ul>
  <li>Lần đầu xem bằng ngôn ngữ khác, app dịch bằng Google miễn phí, không tốn token, rồi lưu bản dịch vào paper.</li>
  <li>Tên paper, tác giả, venue, tên dataset, metric, con số và link được giữ nguyên.</li>
  <li>${ui('Dịch bằng AI cho chính xác hơn')} dịch lại bằng mô hình đang dùng, sát văn phong học thuật hơn và có tốn token.</li>
  <li>Sửa ghi chú hoặc trích xuất lại thì bản dịch cũ tự hết hiệu lực. ${ui('Copy Markdown')} copy theo ngôn ngữ đang hiển thị.</li>
</ul>`,
  },
  {
    id: 'lecture', group: 'lib', title: 'Bài giảng', routes: [],
    html: `
<p>Tab ${ui('Bài giảng')} nhờ mô hình viết một bản giải thích dài để đọc từ đầu đến cuối là hiểu được bài. Ghi chú trả lời "bài này làm gì", còn bài giảng trả lời "vì sao phải làm vậy và nó chạy ra sao". Tám mục theo thứ tự cố định:</p>
<ol>
  <li><b>Cần biết trước</b>: kiến thức bài giả định người đọc đã có.</li>
  <li><b>Bài toán</b>, kể bằng một tình huống cụ thể.</li>
  <li><b>Vì sao cách hiển nhiên không xong</b>.</li>
  <li><b>Cơ chế, chạy tay một ví dụ</b>: mỗi bước nói nó làm gì, vì sao cần, ký hiệu đọc thành lời.</li>
  <li><b>Đặt cạnh những bài nó dẫn</b>, dùng câu trích dẫn nguyên văn từ Semantic Scholar.</li>
  <li><b>Số liệu nói gì, và không nói gì</b>.</li>
  <li><b>Chỗ đáng ngờ</b>.</li>
  <li><b>Tự kiểm tra</b>: câu hỏi dạng vì sao, đáp án gập lại.</li>
</ol>
<ul>
  <li>Cần toàn văn của paper; paper chỉ có abstract thì app báo lỗi và không gọi mô hình.</li>
  <li>Bốn lượt gọi mô hình, thêm tối đa hai lượt viết lại mục bị chấm là nông. Mất khoảng 2–5 phút, trong lúc đó có thể sang trang khác.</li>
  <li>Dưới mỗi mục có cảnh báo nếu con số không thấy trong toàn văn hoặc còn câu nông.</li>
  <li>${ui('Copy Markdown')} và ${ui('Tải .md')} xuất bài giảng. Nút ${ui('Tiếng Việt')} / ${ui('English')} đổi ngôn ngữ hiển thị như tab Ghi chú.</li>
</ul>`,
  },
  {
    id: 'translate', group: 'lib', title: 'Dịch khi đọc PDF', routes: [],
    html: `
<p>Tab ${ui('PDF')} dùng trình đọc PDF.js, chữ bôi đen được như trang web. Bôi đen để dịch cũng dùng được ở mọi trang khác của app (ghi chú, bài giảng, Hỏi đáp, Chat…).</p>
${steps([
    `Bôi đen một từ, cụm từ hay cả đoạn.`,
    `Rê chuột vào nút ${ui('文')} hiện cạnh đoạn đã chọn, bong bóng bản dịch mở ra. Muốn bấm thay vì rê, hoặc dịch ngay khi bôi đen, đổi ở ${ui('Tuỳ chọn')} trên thanh trình đọc hoặc nút 文 trên thanh trên cùng.`,
    `${k('Esc')} đóng bong bóng, ${k('Ctrl')}+${k('Shift')}+${k('D')} dịch ngay đoạn đang chọn.`,
  ])}
<p>Khi bật ${ui('Theo ngữ cảnh câu')}, app gửi kèm cả câu chứa đoạn đã chọn nên từ nhiều nghĩa được dịch đúng ngữ cảnh. Câu ngữ cảnh được đóng trong dấu ⟦ ⟧ trên PDF. Nhãn trên bong bóng: ${ui('theo ngữ cảnh')} (đáng tin nhất), ${ui('dịch riêng')} (nghĩa khi đứng một mình), ${ui('cả câu')} (chỉ có bản dịch cả câu).</p>
<p>Bản dịch nhanh dùng Google miễn phí, không cần API key. Bong bóng có ${ui('Dịch bằng AI')} (mô hình đang dùng, văn phong học thuật, giữ thuật ngữ) và ${ui('+ Ghi chú')} (lưu đoạn gốc, bản dịch, số trang vào Trích dẫn của paper, ôn lại ở <a href="#/help?s=notes">Thẻ ghi nhớ</a>).</p>`,
  },
  {
    id: 'marks', group: 'lib', title: 'Tô sáng, gạch chân và tìm PDF', routes: [],
    html: `
<p>Thanh công cụ của trình đọc PDF có ba nút riêng của app, nằm trước các công cụ vẽ của PDF.js:</p>
<ul>
  <li><b>Bút tô sáng</b> và <b>U gạch chân</b>: bật rồi bôi đen chữ là đánh dấu ngay; bấm lại nút để tắt.</li>
  <li><b>Cục tẩy</b>: bôi đen phần chữ đã đánh dấu để xoá đúng phần đó, hoặc giữ chuột trái rê qua các nét để xoá cả dòng.</li>
  <li><b>Chấm màu</b>: vàng, xanh lá, xanh dương, hồng, đỏ, tím. ${ui('↶')} / ${ui('↷')} hoàn tác / làm lại (${k('Ctrl')}+${k('Z')}, ${k('Ctrl')}+${k('Y')}).</li>
</ul>
<p>Nét đánh dấu lưu trong paper (không sửa file PDF). Khi đã tắt công cụ, bấm vào một nét để ${ui('Dịch')}, ${ui('+ Ghi chú')}, ${ui('Sao chép')}, đổi màu hoặc ${ui('Xoá')}. Nét vẽ tay, chữ, chữ ký của PDF.js chỉ giữ được khi bấm ${ui('Lưu nét vẽ vào PDF')}.</p>
<p>Paper chưa có PDF thì tab ${ui('PDF')} tự tìm bản công khai (link và DOI của paper, Semantic Scholar, OpenAlex, arXiv theo tên, CVF, NeurIPS, PMLR, ACL Anthology): bấm ${ui('Tải về')} ở một nguồn hoặc ${ui('Tự động tải bản tốt nhất')}. Tìm cho nhiều paper: tick ở Thư viện (menu cạnh ${ui('Chọn tất cả')} có ${ui('Chưa có PDF')}) rồi ${ui('Khác')} → ${ui('Tìm & tải PDF')}.</p>`,
  },
  {
    id: 'autohl', group: 'lib', title: 'Tô câu đáng nhớ bằng AI', routes: [],
    html: `
<p>Nút ${ui('✦ Tô câu đáng nhớ')} trên thanh trình đọc PDF cho mô hình đọc toàn văn rồi tô những câu đáng nhớ, mỗi loại một màu: <b>Luận điểm</b> (tím), <b>Cơ chế</b> (xanh dương), <b>Bằng chứng</b> (xanh lá), <b>Giới hạn</b> (hồng), <b>Thuật ngữ</b> (vàng).</p>
<ul>
  <li>Chọn mật độ thưa, vừa hoặc dày; số câu tính theo số trang nội dung.</li>
  <li>Bấm vào một nét để xem loại câu và lý do đáng nhớ, có nút lưu thành trích dẫn.</li>
  <li>Câu mô hình chép không khớp nguyên văn trong PDF thì bị bỏ, app không tô đoán.</li>
  <li>Tab ${ui('Ghi chú')} có thẻ ${ui('Câu đáng nhớ')} liệt kê theo loại; bấm số trang để mở đúng trang.</li>
  <li>Chạy lại thì lượt mới thay các câu AI đã tô, nét bạn tự tô được giữ nguyên. Mỗi lượt tốn token gần bằng một lần trích xuất.</li>
</ul>`,
  },
  {
    id: 'venue', group: 'lib', title: 'Venue và xếp hạng', routes: [],
    html: `
<p>Mỗi paper được gắn loại venue và hạng, hiện thành nhãn như ${ui('Hội nghị · CVPR · A*')} hoặc ${ui('Tạp chí · IEEE Transactions on … · Q1')}. App phân loại tự động mỗi khi lưu paper, dựa trên tên venue, loại ấn phẩm từ Semantic Scholar và Crossref, ISSN, và ghi chú kiểu "Accepted to …" trên arXiv.</p>
<ul>
  <li><b>Hội nghị</b>: bảng CORE/ICORE (A*, A, B, C).</li>
  <li><b>Tạp chí, book series, kỷ yếu</b>: Scimago Journal Rank (Q1–Q4, điểm SJR, H-index).</li>
  <li><b>Workshop và Findings</b>: CORE không xếp riêng, app hiện hạng hội nghị chủ ở dạng mờ, ví dụ ${ui('Workshop · CVPR A*')}.</li>
</ul>
<p>Nhận diện sai thì bấm ${ui('Sửa venue')} trong tab ${ui('Ghi chú')}: ô tìm tra trực tiếp bảng CORE và SJR, kể cả tên viết tắt như TPAMI. ${ui('Cập nhật bảng xếp hạng trực tuyến')} trong ${ui('Cài đặt')} tải bản mới nhất rồi phân loại lại cả thư viện. Hạng chỉ để tham khảo; với quyết định quan trọng như chọn nơi nộp bài, kiểm tra lại trên trang gốc.</p>`,
  },

  /* ============================== Khám phá & phân tích ============================== */
  {
    id: 'related', group: 'explore', title: 'Liên quan, bản đồ tài liệu, đồ thị 3D', routes: [],
    html: `
${fig('related', 'Tab Liên quan của trang paper')}
${steps([
    `<b>Mục lục của tab</b>: nhảy tới Khám phá qua Semantic Scholar, Có gì mới kể từ bài này, Trong thư viện, Hướng nghiên cứu.`,
    `${ui('🧭 Hướng nghiên cứu')}: mở tab Hướng nghiên cứu.`,
    `${ui('🗺 Bản đồ tài liệu')}: bản đồ 2D các bài liên quan (bên dưới).`,
    `${ui('🕸 Đồ thị 3D')}: đồ thị trích dẫn toàn màn hình.`,
    `${ui('🔔 Theo dõi')}: báo khi có bài mới dẫn bài này, hoặc bài mới của từng tác giả (trang Paper mới).`,
  ])}
${fig('litmap', 'Bản đồ tài liệu 2D')}
${steps([
    `<b>Cụm tương đồng</b> (kiểu Connected Papers): hai bài gần nhau khi dẫn nhiều bài chung hoặc hay được cùng một bài dẫn. <b>Dòng thời gian</b> (kiểu Litmaps): trục ngang là ngày đăng, trục dọc là số trích dẫn.`,
    `<b>Bộ lọc</b>: số bài hiện (40–300), khoảng năm, ${ui('Liên kết ≥')} để bớt các liên kết yếu. Bên phải có ô tìm, ${ui('Ẩn bài đã có')}, ${ui('Vừa khung')}, ${ui('Ảnh PNG')}.`,
    `<b>Bài gốc</b> (kiểu ResearchRabbit): bấm một bài trên bản đồ rồi ${ui('🌱 Thêm làm bài gốc')} để mở rộng bản đồ theo hướng đó.`,
    `<b>Danh sách</b>: ${ui('Liên quan nhất')}, ${ui('Nền tảng')} (bài được nhiều bài trên bản đồ cùng dẫn), ${ui('Phát triển')} (bài dẫn nhiều bài trên bản đồ), ${ui('Trong thư viện')}. Bấm một bài để xem chi tiết, thêm vào thư viện.`,
    `<b>Chú giải</b>: màu theo năm (xanh tím là cũ, cam là mới), cỡ nút theo số trích dẫn, viền xanh lá là bài đã có trong thư viện, viền đậm là bài gốc.`,
  ])}
<p>${k('Esc')} bỏ chọn, ${k('Shift')}+${k('Esc')} đóng bản đồ. Bài gốc và chế độ xem được lưu theo paper.</p>
<p><b>Đồ thị 3D</b>: bài đang xem ở giữa, các bài nó dẫn (xanh dương), các bài dẫn nó (cam), bài đã có trong thư viện (tím). Kéo để xoay, cuộn để phóng, bấm một bài để xem chi tiết hoặc bay tới. Rê chuột vào một bài để thấy mũi tên ra / vào. Tô màu theo loại, theo năm hoặc theo chủ đề (app tự tìm tối đa bảy chủ đề, hoặc bạn tự gõ từ khoá). Cột trái liệt kê các bài, lọc theo tên, năm, chủ đề, số trích dẫn; tick ${ui('Liên kết với đồ thị')} để bộ lọc áp lên cả đồ thị. Hàng ${ui('Mở rộng')} lấy thêm bài dẫn (tới 5000) và bài nền chung (bài ngoài đồ thị được nhiều bài trong đồ thị cùng dẫn, tô vàng).</p>
<p><b>Khám phá qua Semantic Scholar</b>: ba danh sách Gợi ý, Tài liệu tham khảo, Paper dẫn bài này; lọc theo thời gian, sắp xếp mới nhất / nhiều trích dẫn / đang được chú ý, ẩn bài đã có hoặc đã xem. Paper dẫn bài này được chia theo cách họ dùng bài: ${ui('Kế thừa phương pháp')}, ${ui('So sánh kết quả')}, ${ui('Chỉ nhắc tới')}, kèm câu trích dẫn nguyên văn và dòng thời gian số bài dẫn theo tháng (bấm một cột để lọc).</p>
<p><b>Có gì mới kể từ bài này</b>: mô hình đọc tóm tắt và câu trích dẫn của tối đa 30 paper dẫn bài, tổng hợp giới hạn nào đã được giải quyết, kết quả mới, hướng mở rộng, phản biện, bài nên đọc tiếp; mỗi ý có mã C1, C2… bấm để mở chi tiết.</p>`,
  },
  {
    id: 'research', group: 'explore', title: 'Hướng nghiên cứu', routes: [],
    html: `
<p>Tab ${ui('Hướng nghiên cứu')} đặt bài đang xem (<b>P</b>) giữa các bài nó dẫn (<b>R1, R2…</b>) và các bài dẫn nó (<b>C1, C2…</b>), lấy từ Semantic Scholar, rồi nhờ mô hình lập:</p>
<ul>
  <li><b>Dòng nghiên cứu</b>: bài nền tảng đóng góp gì, các bài sau đẩy hướng này đi đâu.</li>
  <li><b>So sánh các bài</b>: quan hệ với bài gốc (nền tảng, baseline, mở rộng, áp dụng, cạnh tranh, phản biện), phương pháp, bài toán, domain, điểm khác bài gốc.</li>
  <li><b>Ai cover khía cạnh nào</b>: phương pháp, domain, dữ liệu, đánh giá, hiệu năng, độ bền vững…</li>
  <li><b>Còn bỏ ngỏ</b>: vấn đề chưa bài nào giải quyết trọn vẹn, kèm căn cứ.</li>
  <li><b>Hướng nghiên cứu tiếp theo</b>: ý tưởng, gap giải quyết, bài làm nền, bước đầu nên làm, rủi ro, liên hệ với đề tài của bạn.</li>
</ul>
<p>Bấm mã R / C để xem tóm tắt, câu trích dẫn và thêm bài vào thư viện. Kết quả lưu trong paper; ${ui('Cập nhật')} để làm lại, ${ui('Copy Markdown')} để mang đi. Mô hình chỉ đọc tóm tắt và câu trích dẫn, chưa đọc toàn văn từng bài.</p>`,
  },
  {
    id: 'chat', group: 'explore', title: 'Chat với nhiều paper', routes: ['chat'],
    html: `
${fig('chat', 'Trang Chat với paper')}
${steps([
    `<b>Hội thoại</b>: danh sách các cuộc chat đã lưu; ${ui('+ Mới')} để bắt đầu cuộc mới.`,
    `<b>Nguồn</b>: các paper đang dùng, mỗi paper một nhãn cố định P1, P2… (không đổi khi bỏ bớt paper). ${ui('+ Thêm')} mở bộ chọn: tìm theo tên, tác giả, tag, venue; lọc theo chủ đề, hạng, có toàn văn.`,
    `<b>Mức ngữ cảnh gửi cho AI</b>: ${ui('Chỉ ghi chú')} (rẻ, nhanh), ${ui('Ghi chú + đoạn liên quan')} (mặc định: mỗi câu hỏi tìm thêm các đoạn khớp nhất trong toàn văn), ${ui('Toàn văn')} (đầy đủ nhất, tốn token nhất). Ô dưới chọn ngôn ngữ trả lời.`,
    `<b>Nhãn nguồn</b> sau mỗi ý: bấm để mở paper đó. Con số không thấy trong tài liệu hiện thành cảnh báo dưới câu trả lời.`,
    `<b>Ô hỏi</b>: ${k('Enter')} gửi, ${k('Shift')}+${k('Enter')} xuống dòng. Phía trên có các câu hỏi gợi ý (so sánh phương pháp, bảng dataset và kết quả, hạn chế và khoảng trống…).`,
  ])}
<p><b>Đính kèm ảnh và file</b>: nút ${ui('📎 Đính kèm')} dưới ô hỏi, dán (${k('Ctrl')}+${k('V')}) hoặc kéo thả vào khung hỏi, tối đa 6 tệp mỗi câu hỏi.</p>
<ul>
  <li><b>Ảnh</b> (PNG, JPG, GIF, WebP): hình trong paper, biểu đồ, ảnh chụp màn hình… gửi thẳng cho model (cần model đọc được ảnh, ví dụ Claude, GPT-4o, Gemini). Ảnh lớn được thu nhỏ còn cạnh dài 1600px cho đỡ tốn token.</li>
  <li><b>PDF</b>: app đọc chữ trong PDF rồi gửi kèm câu hỏi (tối đa khoảng 80.000 ký tự mỗi file). PDF bản scan không có lớp chữ thì gửi nguyên file cho model.</li>
  <li><b>File chữ</b>: .txt, .md, .csv, .json, .tex, .bib, .ipynb, file code (.py, .js, .cpp…). File Word hãy lưu thành PDF trước.</li>
  <li>Có thể chỉ gửi tệp mà không gõ câu hỏi: app hỏi model tóm tắt và giải thích tệp, liên hệ với các paper đang chọn. Hỏi về ảnh / file thì không bắt buộc phải chọn paper.</li>
  <li>Các câu hỏi tiếp theo vẫn gửi kèm ảnh và file của các lượt trước (tối đa 12 ảnh / PDF gần nhất), nên có thể hỏi tiếp về chúng. Ảnh và file được lưu cùng hội thoại; bấm ảnh trong tin nhắn để phóng to.</li>
</ul>
<p><b>Lưu vào Sổ tay</b>: nút ${ui('📓 Lưu vào Sổ tay')} dưới mỗi câu trả lời chép câu trả lời vào <b>nhật ký hôm nay</b>, <b>cuối một trang có sẵn</b> hoặc <b>một trang mới</b>, dạng khối ✨ AI (thu gọn được) hoặc đoạn văn thường, có thể kèm câu hỏi. Nhãn nguồn [P1], [P2] thành liên kết <code>[[@paper]]</code>, nên trang đó hiện ở thẻ ${ui('📓 Trong sổ tay nghiên cứu')} của paper.</p>
<p>Hội thoại mới chưa có paper hiện ba cách bắt đầu: dùng các paper đang tick ở Thư viện / So sánh, tìm và chọn từng paper, hoặc chọn cả một chủ đề. Thẻ paper trong Nguồn ghi ${ui('● toàn văn')} hoặc ${ui('○ chỉ ghi chú')}, quyết định chatbot đọc được gì.</p>
<p>Cuối bảng Nguồn có ước tính số token. Với Claude, phần ngữ cảnh cố định được cache nên từ câu thứ hai chỉ tính giá đọc cache (khoảng một phần mười). ${ui('Dừng')} cắt ngang và giữ phần đã nhận, ${ui('Ẩn nguồn')} thu bảng bên phải, ${ui('Xuất .md')} lưu cả hội thoại. Khung hẹp (ví dụ khi chia đôi màn hình) thì bảng Nguồn là ngăn trượt, mở bằng nút ${ui('📚 Nguồn')}.</p>`,
  },
  {
    id: 'compare', group: 'explore', title: 'So sánh và tổng hợp related work', routes: ['compare'],
    html: `
${fig('compare', 'Trang So sánh & tổng hợp')}
${steps([
    `<b>Chọn paper</b>: tick ở cột này (hoặc ở Thư viện) để đưa vào bảng.`,
    `${ui('Thông số hiển thị')}: chọn thông số theo nhóm của template (thông tin chung, problem, method, dataset, findings, limitations…). ${ui('Hiện tất cả')} bật toàn bộ, ${ui('Mặc định')} quay về ba cột Điểm mới, Dataset/Metric, Ý tưởng áp dụng.`,
    `${ui('Paper theo hàng')} là bảng thường; ${ui('Paper theo cột')} xoay bảng, dễ đọc khi hiện nhiều thông số.`,
    `<b>Xuất bảng</b>: Markdown, CSV, BibTeX, LaTeX, Word, đúng các thông số đang chọn.`,
    `${ui('Chat với các paper này')}: mở trang Chat với đúng các paper đang so sánh.`,
  ])}
<p>Phía dưới có biểu đồ các metric trùng tên và dataset giữa ít nhất hai paper, và ${ui('Tổng hợp related work bằng AI')} viết bản nháp Related Work, có nút xuất riêng.</p>`,
  },
  {
    id: 'feed', group: 'explore', title: 'Theo dõi paper mới', routes: ['feed'],
    html: `
<p>Trang ${ui('Paper mới')} quét theo các bộ theo dõi bạn tạo:</p>
<ul>
  <li><b>Từ khoá</b>: từ khoá và danh mục arXiv như cs.CV hay cs.CL (nút ${ui('+ Bộ theo dõi')}).</li>
  <li><b>Bài mới dẫn một paper</b> và <b>bài mới của một tác giả</b>: tạo từ nút ${ui('🔔 Theo dõi')} ở tab Liên quan của trang paper.</li>
</ul>
<p>Mỗi bộ có ô tick; ${ui('Quét bộ đang chọn')}, ${ui('Quét tất cả')}, xoá xong vẫn hoàn tác được. Paper đã có trong thư viện hoặc đã xem được làm mờ, ${ui('+ Thêm')} chuyển paper sang trang thêm để trích xuất. arXiv giới hạn khoảng một yêu cầu mỗi ba giây; app tự chờ và thử lại, nếu vẫn báo lỗi 429 thì chờ vài phút. arXiv cập nhật theo ngày làm việc, quét mỗi sáng là đủ.</p>`,
  },

  /* ============================== Cá nhân ============================== */
  {
    id: 'notebook', group: 'me', title: 'Sổ tay nghiên cứu', routes: ['notebook'],
    html: `
<p>${ui('Sổ tay')} (${k('G')} ${k('B')}) là nơi ghi chép tự do, kết hợp cách làm của Notion (cây trang, khối, bảng dữ liệu) và Obsidian (liên kết hai chiều, đồ thị), nối thẳng với thư viện paper. Hướng dẫn cú pháp đầy đủ trong Sổ tay: nút ❔ hoặc ${k('Ctrl')}+${k('/')}.</p>
${fig('notebook', 'Sổ tay ở chế độ Chia đôi')}
${steps([
    `<b>Cây trang</b>: trang lồng trong trang, kéo thả để đổi trang cha; ô tìm tìm cả tên, nội dung và <code>#tag</code>. ${ui('☑ Chọn')} để chọn nhiều trang rồi di chuyển / xoá; ${ui('Thùng rác')} khôi phục được. Khung hẹp thì nút ☰ mở / đóng danh sách này.`,
    `${ui('+ Trang mới')} mở bộ chọn mẫu (trang trống, ghi chú đọc paper, tổng quan một chủ đề, kế hoạch thí nghiệm, nhật ký); ${ui('📅 Hôm nay')} mở trang nhật ký của ngày.`,
    `<b>Ba chế độ</b>: ${ui('Viết')}, ${ui('Chia đôi')} (soạn và xem cạnh nhau, giống Overleaf), ${ui('Xem')}.`,
    `${ui('✨ AI')}: hỏi AI dựa trên paper và ghi chú bạn chọn (xem mục <a href="#/help?s=notebook-ai">AI trong Sổ tay</a>).`,
    `<b>Khung viết</b> Markdown: gõ <code>/</code> để chèn khối, <code>[[</code> để liên kết trang, <code>[[@</code> để nhắc tới paper. Tự lưu sau khi ngừng gõ, ${k('Ctrl')}+${k('S')} lưu ngay.`,
    `<b>Phần xem</b>: công thức, code tô màu, callout, bảng paper. Bấm đúp một chữ để nhảy tới đúng chữ đó ở phần viết; rê chuột vào một đoạn rồi bấm ✨ để dùng AI cho đoạn đó.`,
    `<b>Nút đồng bộ</b>: ▶ / ◀ nhảy tới chỗ tương ứng bên kia, ⇅ bật / tắt cuộn đồng bộ hai bên.`,
  ])}
${fig('nb-slash', 'Menu chèn khối khi gõ /')}
${steps([
    `Gõ tiếp sau <code>/</code> để tìm: phím tắt (<code>/h2</code>), chữ đầu của tên (<code>/tieu</code>), từ khoá (<code>/callout</code>) hoặc gõ tắt chữ đầu (<code>/dsds</code> → Danh sách đánh số).`,
    `Khối chia nhóm: Cơ bản, Callout, Paper &amp; liên kết, Chèn (bảng, code, công thức, ảnh, ngày, hạn chót), AI. ${k('↑')} ${k('↓')} chọn, ${k('Enter')} chèn.`,
    `Bên phải mỗi khối là phím tắt và cú pháp Markdown tương đương, gõ thẳng cũng được.`,
  ])}
<ul>
  <li><b>Liên kết hai chiều</b>: cuối mỗi trang có ${ui('Liên kết tới trang này')}, ${ui('Có nhắc tên nhưng chưa liên kết')}, các paper trong trang và trang con. Đổi tên trang thì liên kết ở trang khác tự đổi theo.</li>
  <li><b>Gắn với thư viện</b>: <code>![[@id]]</code> nhúng thẻ paper; khối <code>\`\`\`papers</code> (gõ <code>/papers</code>) dựng bảng paper lấy trực tiếp từ thư viện theo tag, chủ đề, trạng thái, năm, có trình dựng bảng và nút ${ui('⚙ Chỉnh bảng')}.</li>
  <li><b>Code</b> (<code>/code</code>): chọn ngôn ngữ, tô màu, nút Copy. <b>Công thức</b> (<code>/ct</code>): bảng ký hiệu, xem trước, báo lỗi; ${ui('📐 Thư viện LaTeX')} (cuối thanh bên) lưu macro như <code>\\R</code>, nhập từ file <code>.tex</code> / <code>.sty</code>.</li>
  <li><b>Ảnh</b>: dán (${k('Ctrl')}+${k('V')}), kéo thả file, hoặc <code>/anh</code>. <code>![mô tả|400](link)</code> đặt độ rộng; bấm ảnh ở phần xem để phóng to.</li>
  <li><b>Việc có hạn</b>: <code>- [ ] việc 📅 2026-10-30</code> hiện trên Lịch (xem mục <a href="#/help?s=calendar">Lịch</a>).</li>
  <li><b>🕸 Đồ thị</b>: mọi trang và paper nối theo liên kết (nét đứt là quan hệ trang cha / con).</li>
</ul>
<p><b>Xuất trang</b> (nút ${ui('⋯')} cạnh tên trang):</p>
<ul>
  <li>${ui('Xuất PDF')}: giữ nguyên công thức, code tô màu, ảnh, callout, bảng như ở phần xem, khổ A4. App in bằng Edge (Windows luôn có sẵn) chạy ẩn; máy không có Edge / Chrome thì mở hộp thoại In, chọn "Lưu thành PDF".</li>
  <li>${ui('Xuất Word (.docx)')}: tiêu đề, danh sách, bảng, trích dẫn, ảnh; mở được bằng Word, Google Docs, LibreOffice. Công thức giữ dạng mã LaTeX (<code>$E = mc^2$</code>).</li>
  <li>${ui('Tải file .md')} và ${ui('Copy Markdown')} lấy nguyên văn bản gốc.</li>
  <li>${ui('Xuất cả nhánh / cả sổ tay…')}: xuất trang này cùng mọi trang con, cháu (hoặc cả sổ tay) một lần. <b>PDF</b> và <b>Word</b> có mục lục đánh số 1, 1.1…, mỗi trang bắt đầu ở trang giấy mới, liên kết <code>[[…]]</code> giữa các trang bấm được trong PDF. <b>Markdown (.zip)</b> cho Obsidian / Logseq: thư mục theo cây trang, giữ <code>[[liên kết]]</code> và <code>#tag</code>, ảnh trong <code>attachments/</code>, liên kết paper thành link arXiv / DOI. Giải nén vào vault là dùng được.</li>
</ul>
<p><b>Sửa cùng một trang ở hai nơi</b> (hai khung chia đôi, hai tab): nếu trang đã được lưu ở nơi khác trong lúc bạn đang sửa, app không ghi đè mà hiện thanh cảnh báo và hộp thoại so sánh từng dòng, với ba cách: ${ui('Dùng bản kia')}, ${ui('Ghép hai bản')} (thêm các dòng chỉ có ở bản kia vào cuối, trong một callout) hoặc ${ui('Giữ bản của tôi')}. Bản bị thay luôn còn trong Lịch sử phiên bản.</p>
<p><b>Lịch sử phiên bản</b> (${ui('⋯')} → ${ui('Lịch sử phiên bản…')}): app tự lưu một bản mỗi khi bạn sửa trang (các lần sửa liên tục trong 10 phút gộp làm một), giữ 80 bản gần nhất mỗi trang.</p>
<ul>
  <li>Bên trái là danh sách bản theo thời gian. ${ui('So với hiện tại')} tô đỏ dòng chỉ có ở bản cũ, tô xanh dòng chỉ có ở bản hiện tại; ${ui('Xem bản này')} hiện như phần xem; ${ui('Markdown')} hiện văn bản gốc.</li>
  <li>${ui('Khôi phục bản này')} đưa trang về bản đó. Bản hiện tại được lưu lại trước khi khôi phục, nên luôn quay lại được.</li>
</ul>`,
  },
  {
    id: 'notebook-ai', group: 'me', title: 'AI trong Sổ tay', routes: [],
    html: `
<p><b>AI nhanh</b> làm việc ngay trên một đoạn (giống Notion AI). Mở bằng một trong ba cách: bôi đen chữ rồi bấm nút ✨ AI nổi cạnh đó; đặt con trỏ trong một đoạn rồi ${k('Ctrl')}+${k('J')} (app tự chọn cả đoạn, dừng ở dòng trống hoặc tiêu đề); rê chuột vào một đoạn ở phần xem rồi bấm ✨ bên trái.</p>
${fig('nb-inline', 'Menu AI nhanh trên một đoạn')}
${steps([
    `<b>Ô yêu cầu</b>: gõ để lọc lệnh, hoặc gõ yêu cầu riêng rồi ${k('Enter')}. ${ui('⭐ Lưu thành prompt nhanh')} giữ yêu cầu hay dùng trong nhóm "Prompt của tôi".`,
    `<b>Đoạn đang chọn</b>: số từ và nội dung (đã bỏ ký hiệu Markdown) để chắc AI làm đúng đoạn.`,
    `<b>Lệnh</b>: chỉnh đoạn (cải thiện văn phong, sửa chính tả, viết ngắn / dài hơn, giọng học thuật, dễ hiểu hơn), tạo từ đoạn (tóm tắt, giải thích, rút ý chính, chuyển thành bảng, câu hỏi ôn tập, phản biện, dẫn chứng từ paper trong trang), dịch Anh / Việt. ${k('↑')} ${k('↓')} chọn, ${k('Enter')} chạy.`,
    `${ui('📚 Hỏi với nguồn')}: mở hộp thoại hỏi AI dựa trên paper và ghi chú (bên dưới).`,
  ])}
${fig('nb-inline-result', 'Kết quả của AI nhanh')}
${steps([
    `Tên thao tác và số từ; trong lúc AI viết có nút ${ui('■ Dừng')}.`,
    `<b>Kết quả</b> hiện dần, khung giữ nguyên chỗ và cuộn bên trong khi dài.`,
    `${ui('⇄ Thay thế')} đoạn gốc bằng kết quả (${k('Ctrl')}+${k('Z')} để hoàn tác).`,
    `${ui('↓ Chèn bên dưới')} giữ đoạn gốc, thêm kết quả ngay sau.`,
    `${ui('↻ Thử lại')} viết lại; ${ui('Copy')} lấy Markdown.`,
    `<b>Bảo AI sửa tiếp</b>: ví dụ "ngắn hơn", "thêm ví dụ", rồi ${k('Enter')}.`,
  ])}
<p><b>Lỡ bấm ra ngoài cũng không mất</b>: khi AI đang viết hoặc đã có kết quả, bấm ra ngoài khung, nhấn ${k('Esc')} hay chuyển sang trang khác chỉ <b>thu nhỏ</b> khung. AI viết tiếp ở nền, góc dưới bên phải có thẻ tiến độ; viết xong thẻ vẫn ở đó, bấm ${ui('Mở')} để quay về đúng trang và mở lại kết quả. Chèn / thay thế tìm lại đoạn gốc theo nội dung, nên vẫn đúng chỗ dù bạn đã sửa trang trong lúc chờ. Muốn bỏ hẳn: nút ✕ trong khung, hoặc ✕ trên thẻ khi đã viết xong. Hộp thoại Hỏi AI với nguồn (bên dưới) cũng vậy; nút ${ui('Đóng')} mới bỏ hẳn.</p>
<p>Trên <b>dòng trống</b>, ${k('Ctrl')}+${k('J')} hoặc <code>/ai</code> mở menu viết mới: viết tiếp, lập dàn ý, tóm tắt cả trang, brainstorm, bảng so sánh paper trong trang, danh sách việc cần làm.</p>
<p><b>Hỏi AI với nguồn</b> (kiểu RAG): nút ${ui('✨ AI')} trên đầu trang hoặc <code>/hoi</code>.</p>
${fig('nb-ask', 'Hộp thoại Hỏi AI dựa trên paper và ghi chú')}
${steps([
    `<b>Yêu cầu có sẵn</b>: trả lời câu hỏi, tóm tắt nguồn, bảng so sánh, Related Work, giải thích đoạn chọn, viết tiếp trang, câu hỏi mở. Hoặc tự gõ vào ô phía trên.`,
    `${ui('✨ Tạo câu trả lời')} (${k('Ctrl')}+${k('Enter')}); sau lần đầu thành ${ui('Hỏi tiếp')}, giữ cùng nguồn.`,
    `<b>Câu trả lời</b> ghi nguồn sau từng ý; nguồn là liên kết tới paper / trang. Bên dưới có ${ui('Chèn vào trang')} (khối ✨ AI hoặc văn bản thường), ${ui('Thay đoạn đã chọn')} (khi đã bôi đen trước), ${ui('Copy')}.`,
    `<b>Paper nguồn</b>: mặc định là paper nhắc trong trang; thêm bằng ô tìm hoặc lấy paper đang tick ở Thư viện. Paper viền nét đứt là app tự tìm; bấm ${ui('Giữ')} để dùng tiếp.`,
    `<b>Tự tìm thêm paper liên quan</b> trong thư viện (tối đa 5). Phía dưới chọn thêm trang ghi chú làm nguồn (mặc định là trang đang viết).`,
    `<b>Mức ngữ cảnh</b>: ${ui('Chỉ ghi chú')}, ${ui('Ghi chú + đoạn liên quan')} (khuyên dùng: tìm đoạn khớp nhất trong toàn văn), ${ui('Toàn văn')}.`,
  ])}
<p><b>Đính kèm</b>: dưới ô yêu cầu có ${ui('📎 Đính kèm')}; dán (${k('Ctrl')}+${k('V')}) hoặc kéo thả ảnh (hình, bảng kết quả, ảnh chụp màn hình), PDF, file chữ vào khung. AI đọc tệp cùng các nguồn đã chọn, ví dụ "đối chiếu bảng kết quả này với các paper trong trang". Chỉ đính kèm mà không chọn nguồn nào cũng được. ${ui('↻ Tạo lại')} dùng lại tệp của lần hỏi trước.</p>
<p class="hint">Model dùng cho AI trong Sổ tay chỉnh riêng được ở ${ui('Cài đặt')} → ${ui('Model riêng cho từng việc')} (ví dụ model rẻ, nhanh cho viết lại đoạn).</p>`,
  },
  {
    id: 'calendar', group: 'me', title: 'Lịch kế hoạch', routes: ['calendar'],
    html: `
${fig('calendar', 'Lịch ở chế độ Tuần')}
${steps([
    `<b>Chế độ xem</b>: Tháng, Tuần (lưới giờ), Danh sách (60 ngày tới, kèm mục Quá hạn). Nút ‹ › và ${ui('Hôm nay')} để đi lại; nút ◧ ẩn / hiện bảng ngày.`,
    `${ui('+ Kế hoạch')}: thêm kế hoạch có giờ bắt đầu / kết thúc, loại (mỗi loại một màu), lặp lại hằng ngày / tuần / tháng, gắn một paper và một trang Sổ tay.`,
    `<b>Khối kế hoạch</b>: kéo để dời giờ hoặc sang ngày khác, kéo mép dưới để đổi giờ kết thúc, bấm để sửa. Ở chế độ Tuần, bấm một ô 30 phút trống để thêm việc vào đúng giờ đó.`,
    `<b>Tổng quan ngày</b>: số việc đã xong, số kế hoạch, tổng thời gian đã xếp lịch.`,
    `<b>Khoảng trống</b> (8–22h): bấm một khoảng để thêm việc vào đó.`,
    `<b>Gợi ý lên lịch đọc</b>: các paper "Đang đọc"; ${ui('Lên lịch')} thêm 1 giờ đọc vào khoảng trống sớm nhất.`,
  ])}
<ul>
  <li><b>Nhật ký</b>: ngày có nhật ký hiện 📓; bảng ngày có ${ui('Mở')} / ${ui('+ Tạo nhật ký')}. Trang nhật ký trong Sổ tay có thẻ Lịch của ngày đó, đánh dấu xong và thêm kế hoạch ngay trong trang.</li>
  <li><b>Việc có hạn trong Sổ tay</b>: viết <code>- [ ] việc 📅 2026-10-25</code> ở bất kỳ trang nào, việc đó hiện trên Lịch; đánh dấu xong ở Lịch thì trang nguồn cũng được đánh dấu.</li>
  <li><b>Lọc</b>: bấm các nhãn loại để ẩn / hiện, nhãn ${ui('Việc trong Sổ tay')} để ẩn / hiện việc có hạn.</li>
  <li><b>Âm lịch và ngày lễ Việt Nam</b> (tính sẵn trong app, không cần mạng): cạnh tên tháng là năm âm lịch theo can chi và con giáp (ví dụ 🐴 năm Bính Ngọ), tháng âm của khoảng đang xem; khoảng vắt qua Tết thì ghi cả hai năm. Mỗi ô ngày có ngày âm nhỏ ở góc (mùng 1 ghi cả tháng, có đánh dấu tháng nhuận). Ngày lễ, Tết dương và âm lịch (Tết Nguyên đán, Giỗ Tổ, Trung thu, Vu Lan…) hiện thành dòng đỏ, ngày nghỉ lễ tô đỏ số ngày. Bảng ngày bên phải ghi đủ ngày âm, can chi của ngày và tháng. Hai nhãn ${ui('Ngày lễ Việt Nam')} và ${ui('Âm lịch')} trong hàng lọc để bật / tắt.</li>
  <li><b>Thẻ ghi nhớ</b>: ngày hôm nay có thẻ ${ui('🗂 N thẻ ghi nhớ cần ôn hôm nay')}, bấm để vào lượt ôn (xem mục <a href="#/help?s=notes">Ghi chú &amp; thẻ ghi nhớ</a>).</li>
</ul>
<p><b>Nhắc việc</b>: ô ${ui('Nhắc việc')} trong hộp thoại kế hoạch chọn nhắc đúng giờ, trước 5 / 10 / 15 / 30 phút, 1 / 2 giờ hoặc 1 ngày. Kế hoạch cả ngày (không có giờ) tính mốc 8:00 sáng. Kế hoạch có nhắc hiện 🔔 trên lịch.</p>
<ul>
  <li>Tới giờ, góc dưới bên phải hiện thẻ nhắc kèm tiếng chuông: ${ui('Mở Lịch')} hoặc ${ui('Báo lại sau 10 phút')}. Bản desktop còn nháy nút PaperVault trên thanh tác vụ và hiện <b>thông báo của Windows</b> khi cửa sổ đang ở sau hoặc đã thu xuống khay; bấm thông báo để mở đúng ngày.</li>
  <li>Bản desktop: bấm ✕ thì app hỏi ${ui('Thu xuống khay')} (app vẫn chạy ở biểu tượng cạnh đồng hồ và vẫn nhắc việc) hay ${ui('Thoát')}. Tick ${ui('Ghi nhớ lựa chọn')} để không hỏi lại; đổi lại ở Cài đặt → Ứng dụng → <i>Khi bấm ✕ đóng cửa sổ</i>. Đang ở khay thì bấm biểu tượng để mở lại, chuột phải → ${ui('Thoát PaperVault')} để tắt hẳn.</li>
  <li>Mở app muộn hơn giờ nhắc thì vẫn nhắc nếu việc chưa kết thúc; việc đã đánh dấu xong thì không nhắc.</li>
</ul>
<p><b>Đăng ký lịch qua link</b> (${ui('⋯')} → ${ui('Đăng ký lịch qua link (Google Calendar…)…')}): dán link .ics (Google Calendar: ⚙ Cài đặt → chọn lịch → Tích hợp lịch → <i>Địa chỉ bí mật ở định dạng iCal</i>; Outlook: Phát hành lịch → link ICS). Sự kiện hiện cùng kế hoạch với màu riêng và nhãn 🔗 để lọc, chỉ đọc (bấm để xem hoặc ${ui('Chép thành kế hoạch của tôi')}), được tính khi tìm khoảng trống trong ngày và tự tải lại mỗi 30 phút. Mỗi lịch đổi được tên, màu, ẩn / hiện, tải lại ngay hoặc bỏ đăng ký.</p>
<p><b>Xuất / nhập .ics</b> (nút ${ui('⋯')} cạnh ${ui('+ Kế hoạch')}):</p>
<ul>
  <li>${ui('Xuất lịch ra file .ics')}: mọi kế hoạch, kèm lặp lại, ngày bỏ qua, nhắc việc. Nhập file vào Google Calendar (Cài đặt → Nhập và xuất), Outlook hoặc Apple Calendar.</li>
  <li>${ui('Nhập file .ics…')}: lấy lịch từ Google Calendar, Outlook… (xuất ra .ics trước). App báo số sự kiện mới và số sự kiện đã có; nhập lại cùng file thì cập nhật thay vì tạo trùng. Lặp hằng ngày / tuần / tháng được giữ; lặp phức tạp hơn (ví dụ cách hai tuần) chỉ nhập lần đầu, kèm ghi chú.</li>
</ul>`,
  },
  {
    id: 'notes', group: 'me', title: 'Ghi chú & thẻ ghi nhớ', routes: ['notes'],
    html: `
<p>Trang ${ui('Thẻ ghi nhớ')} gom mọi đoạn bạn đã lưu bằng ${ui('+ Ghi chú')} trong bong bóng dịch, cùng các trích dẫn thêm tay ở trang paper, của tất cả paper.</p>
<ul>
  <li>${ui('Danh sách')}: tìm trong đoạn gốc, bản dịch, nhận xét, tên paper; lọc theo paper; sắp xếp mới nhất, cũ nhất, theo paper. Mỗi đoạn có sao chép, sửa, xoá (hoàn tác được) và link về paper.</li>
  <li>${ui('Ôn thẻ')} (số bên cạnh là số thẻ cần ôn hôm nay): mặt trước là đoạn gốc, lật ra bản dịch và nhận xét. Nhớ lại nghĩa rồi mới lật (${k('Space')}), sau đó chấm mức nhớ: ${k('1')} ${ui('Quên')}, ${k('2')} ${ui('Khó')}, ${k('3')} ${ui('Nhớ')}, ${k('4')} ${ui('Dễ')}. Mỗi nút ghi sẵn bao lâu nữa thẻ quay lại.</li>
  <li><b>Lặp lại ngắt quãng</b> (thuật toán SM-2, như Anki): thẻ nhớ tốt được giãn dần 1 ngày → 3 ngày → vài tuần → vài tháng; thẻ ${ui('Quên')} quay lại ngay trong lượt ôn và bắt đầu lại từ đầu; với thẻ mới, ${ui('Khó')} cũng cho thẻ quay lại cuối lượt (nhưng không tính là quên). Ở danh sách, mỗi đoạn ghi "thẻ mới", "cần ôn hôm nay" hoặc ngày ôn tới.</li>
  <li>${ui('⚙ Nhịp ôn')} chỉnh số thẻ mới mỗi ngày, khoảng ôn lần đầu khi chấm Nhớ / Dễ, hệ số giãn và khoảng ôn tối đa (mặc định 1 năm), kèm ví dụ các mốc ôn. Sau mỗi lần chấm, app báo ngày ôn tới. Ở ${ui('Tất cả thẻ')}, chấm một thẻ chưa tới hạn chỉ là ôn thử, không đổi lịch (trừ ${ui('Quên')}).</li>
  <li>${ui('Cần ôn hôm nay')} gồm thẻ tới hạn và số thẻ mới mỗi ngày (mặc định 20); ${ui('Tất cả thẻ')} để lướt mọi thẻ (có ${ui('Trộn thẻ')}, ${k('←')} ${k('→')}). Ô ${ui('thẻ cần ôn hôm nay')} ở Tổng quan và thẻ 🗂 trong Lịch mở thẳng lượt ôn.</li>
  <li><b>Phát âm</b>: đoạn gốc tiếng Anh có hai dòng UK / US kèm phiên âm IPA (với từ, cụm ngắn) và nút ${ui('▶ Nghe')}, cùng bộ phát âm của bong bóng dịch; phím ${k('P')} nghe theo giọng bạn chọn lần trước. Ở danh sách, nút ▶ cạnh mỗi đoạn.</li>
  <li>${ui('Tải CSV (Anki)')} xuất hai cột mặt trước / mặt sau, nhập được vào Anki hoặc Quizlet. ${ui('Tải Markdown')} xuất cả danh sách.</li>
</ul>`,
  },
  {
    id: 'topics', group: 'me', title: 'Chủ đề và tag', routes: ['topics'],
    html: `
<p>Chủ đề là thư mục của thư viện và là thư mục con khi xuất Markdown. Mỗi chủ đề có tên, màu, mô tả và từ khoá; app dùng từ khoá để gợi ý chủ đề khi trích xuất. ${ui('Gộp')} chuyển toàn bộ paper sang chủ đề khác rồi xoá chủ đề cũ.</p>
<p>Tag là từ khoá tự do mô hình gán khi trích xuất. Bảng tag ở cuối trang cho đổi tên, gộp hai tag hoặc xoá một tag trên toàn thư viện, hữu ích khi có các biến thể như "vqa" và "visual qa".</p>`,
  },

  /* ============================== Công cụ & cài đặt ============================== */
  {
    id: 'split', group: 'tools', title: 'Chia đôi màn hình', routes: [],
    html: `
<p>Mở hai chức năng cùng lúc: đọc paper bên trái và viết Sổ tay bên phải, hoặc Thư viện ở trên và Chat ở dưới.</p>
${fig('split', 'Hai khung: paper bên trái, Sổ tay bên phải')}
${steps([
    `Nút <b>Chia đôi</b> trên thanh trên cùng (hoặc ${k('Ctrl')}+${k('\\')}) mở bảng chia đôi (bên dưới).`,
    `<b>Khung đang chọn</b> có viền màu ở trên và số khung tô màu. Bấm vào khung nào thì khung đó được chọn; thanh bên trái, ô tìm kiếm, ${ui('Thêm paper')}, nút <b>?</b> và phím tắt đều điều khiển khung đang chọn.`,
    `${ui('Đổi ▾')}: mở chức năng khác hoặc một paper gần đây trong khung đó. Bên cạnh có ⤢ (chỉ giữ khung này) và ✕ (đóng khung).`,
    `<b>Thanh chia</b>: kéo để đổi tỉ lệ, bấm đúp để về 50 : 50, hoặc chọn rồi dùng phím mũi tên (mỗi lần 5%).`,
  ])}
${fig('split-panel', 'Bảng chia đôi màn hình')}
${steps([
    `<b>Bố cục nhanh</b>: Đọc paper + ghi chép, Đọc paper + Chat, Thư viện + Chat, Lịch + Sổ tay. Một lần bấm là đặt cả chiều chia, tỉ lệ và trang của hai khung.`,
    `${ui('Một khung')} (thoát chia đôi), ${ui('Chia dọc')} (trái | phải), ${ui('Chia ngang')} (trên / dưới).`,
    `${ui('Khung kia mở')}: chọn chức năng cho khung không được chọn.`,
    `<b>Tỉ lệ</b>: nhập % chính xác cho khung trái / trên.`,
    `Các mức có sẵn: 50 : 50, 60 : 40, 70 : 30…`,
    `${ui('⇄ Đổi chỗ hai khung')}.`,
  ])}
<ul>
  <li><b>Alt + bấm</b> một link (paper, trang Sổ tay…) để mở nó ở khung bên kia.</li>
  <li><b>Tìm nhanh</b> (${k('Ctrl')}+${k('K')}) trong một khung mở bảng tìm ở giữa cửa sổ; kết quả mở ở khung vừa bấm, ${k('Alt')}+${k('Enter')} mở ở khung kia. Mỗi khung luôn rộng ít nhất khoảng 300px để hộp thoại trong khung vẫn đọc được.</li>
  <li><b>Dữ liệu dùng chung</b>: lưu ở khung này thì khung kia tự cập nhật; cùng một trang Sổ tay mở ở hai khung cũng tự đồng bộ. Paper tick ở Thư viện khung này dùng được ngay ở So sánh khung kia.</li>
  <li>Mọi trang tự co giãn khi khung hẹp hoặc thấp: bảng Nguồn của Chat, bảng ngày của Lịch, danh sách trang của Sổ tay thành ngăn trượt; đầu trang paper tự thu gọn.</li>
  <li>Bố cục được nhớ, mở lại app vẫn giữ nguyên. Đóng khung khi còn việc chạy nền (trích xuất, bài giảng…) thì app hỏi lại trước.</li>
</ul>`,
  },
  {
    id: 'settings', group: 'tools', title: 'Cài đặt, chi phí và dữ liệu', routes: ['settings'],
    html: `
<p>Thẻ <b>Mô hình</b> (xem ảnh ở mục <a href="#/help?s=start">Bắt đầu nhanh</a>) chọn nhà cung cấp, model và key chính. Muốn dùng model khác cho từng việc, mở ${ui('Model riêng cho từng việc')} ngay bên dưới:</p>
${fig('settings-models', 'Model riêng cho từng việc')}
${steps([
    `Khi một việc dùng nhà cung cấp khác với mặc định, ô <b>API key</b> của nhà cung cấp đó hiện ra, kèm nhãn "dùng cho: …". Ô còn trống được tô cảnh báo.`,
    `<b>Nhà cung cấp</b> riêng cho việc đó (Trích xuất, Chat &amp; Hỏi đáp, AI trong Sổ tay, Bài giảng, Phân tích &amp; tổng hợp, Tô câu đáng nhớ, Dịch bằng AI). "Như mặc định" dùng model chính.`,
    `<b>Model</b>: gõ tên hoặc chọn gợi ý; để trống thì dùng model đang đặt cho nhà cung cấp đó.`,
    `${ui('Thử')}: gọi thử đúng model của việc đó, kết quả hiện ngay dưới ô Model.`,
  ])}
<p>Các nhóm cài đặt khác:</p>
<ul>
  <li><b>Trích xuất</b>: ngôn ngữ ghi chú, effort (Claude), số ký tự tối đa gửi đi, max output tokens, cách xử lý PDF, Semantic Scholar API key (tuỳ chọn, giúp tránh lỗi 429).</li>
  <li><b>Dịch khi bôi đen</b>, <b>Phông chữ &amp; cỡ chữ</b>.</li>
  <li><b>Bảng xếp hạng venue</b> và <b>Số trích dẫn</b>: cập nhật trực tuyến, phân loại lại.</li>
  <li><b>Sử dụng API &amp; chi phí</b>: token theo model trong tháng; nhập đơn giá để app ước tính chi phí. <b>Ngân sách AI / tháng</b>: app báo khi chạm mức cảnh báo (mặc định 80%); khi vượt thì tuỳ chọn ${ui('Chỉ cảnh báo')}, ${ui('Đổi sang model rẻ')} (Haiku, GPT-4o mini, Gemini Flash của cùng nhà cung cấp) hoặc ${ui('Chặn gọi AI')} tới hết tháng. Thanh màu cho biết đã dùng bao nhiêu.</li>
  <li><b>Ứng dụng</b> (bản desktop): khi bấm ✕ thì hỏi mỗi lần, thu xuống khay hệ thống hay thoát hẳn; khởi động lại, thoát.</li>
  <li><b>Xuất thư viện ra thư mục Markdown</b>: mỗi chủ đề một thư mục con, kèm bảng so sánh và <code>references.bib</code>; có thể tự ghi sau mỗi lần lưu.</li>
  <li><b>Sao lưu &amp; khôi phục</b>: ${ui('Sao lưu đầy đủ ngay')} tạo một file <b>.zip</b> chứa paper, toàn văn, Sổ tay, Lịch, Chat, cài đặt (trừ API key), mọi <b>file PDF</b> và <b>ảnh</b> của Sổ tay. ${ui('Khôi phục từ file .zip…')} hoặc nút ${ui('Khôi phục')} ở từng bản: chọn <b>Gộp</b> (thêm phần chưa có, giữ dữ liệu hiện tại) hoặc <b>Thay thế toàn bộ</b> (nạp lại cả cài đặt, giữ API key đang có trên máy).</li>
  <li><b>Tự sao lưu</b> mỗi ngày hoặc mỗi tuần khi app đang mở, giữ N bản tự động gần nhất (bản bạn tự tạo không bị xoá). Nên đặt <b>Thư mục sao lưu</b> ở ổ khác hoặc trong OneDrive / Google Drive để phòng hỏng ổ.</li>
  <li>Sao lưu dạng JSON (cách cũ, không kèm PDF, ảnh) vẫn còn trong mục thu gọn bên dưới; nhận cả file sao lưu của extension.</li>
  <li><b>Phiên bản &amp; cập nhật</b>: ${ui('Kiểm tra bản mới')} hỏi trang GitHub Releases. Khi bật tự kiểm tra (mặc định), mỗi ngày app hỏi một lần; có bản mới thì góc dưới bên phải hiện thẻ kèm điểm mới, ${ui('Tải bản mới')} (bản desktop tải thẳng file .zip), ${ui('Bỏ qua bản này')} hoặc ${ui('Tắt tự kiểm tra')}. Cập nhật bản desktop: tải file .zip, đóng app, giải nén đè lên thư mục cũ; thư mục <code>data</code> và <code>config.json</code> không có trong file tải về nên được giữ nguyên. Nên sao lưu đầy đủ trước khi cập nhật.</li>
</ul>
<p>Toàn bộ dữ liệu nằm trong một thư mục. Muốn dùng trên nhiều máy qua OneDrive hoặc Google Drive, bấm ${ui('Đổi thư mục dữ liệu')} và chọn thư mục trong ổ đồng bộ. Chỉ mở app trên một máy tại một thời điểm và chờ đồng bộ xong trước khi mở trên máy khác.</p>`,
  },
  {
    id: 'extension', group: 'tools', title: 'Dùng cùng extension', routes: [],
    html: `
<p>Extension PaperVault trên Chrome hoặc Edge tiện khi đang đọc paper trên trình duyệt. Khi app đang chạy, extension có thêm hai nút:</p>
<ul>
  <li>${ui('→ App')} trong popup đẩy trang đang đọc, hoặc kết quả extension đã trích xuất, vào hộp thư của app (hiện ở đầu trang ${ui('Thêm paper')}).</li>
  <li>${ui('→ Đồng bộ sang App')} trong thư viện extension nhập toàn bộ thư viện, bỏ qua paper app đã có.</li>
</ul>
<p>Địa chỉ app mặc định là <code>http://127.0.0.1:8765</code> (bản desktop cũng chạy ở địa chỉ này), chỉnh trong Cài đặt của extension. Sau khi cập nhật extension cần tải lại nó ở trang quản lý extension của trình duyệt.</p>`,
  },
  {
    id: 'keys', group: 'tools', title: 'Phím tắt', routes: [],
    html: `
<table class="kv">
  <tr><th>${k('Ctrl')}+${k('K')} · ${k('/')}</th><td>Tìm nhanh khắp app: lệnh, paper, nội dung PDF, trang sổ tay, chat, lịch. Gõ ${k('>')} để chỉ tìm lệnh</td></tr>
  <tr><th>${k('N')}</th><td>Mở trang Thêm paper</td></tr>
  <tr><th>${k('G')} rồi ${k('D')} ${k('L')} ${k('T')} ${k('F')} ${k('A')} ${k('C')} ${k('B')} ${k('K')} ${k('N')} ${k('S')} ${k('H')}</th><td>Tổng quan, Thư viện, Chủ đề, Paper mới, Chat, So sánh, Sổ tay, Lịch, Thẻ ghi nhớ, Cài đặt, Hướng dẫn (phím hiện mờ cạnh mục ở thanh bên)</td></tr>
  <tr><th>${k('?')}</th><td>Mở Hướng dẫn</td></tr>
  <tr><th>${k('Ctrl')}+${k('\\')}</th><td>Bật / tắt chia đôi màn hình</td></tr>
  <tr><th>${k('Alt')} + bấm link</th><td>Khi chia đôi: mở ở khung bên kia</td></tr>
  <tr><th>${k('Ctrl')}+${k('Shift')}+${k('D')}</th><td>Dịch ngay đoạn đang bôi đen</td></tr>
  <tr><th>${k('j')} ${k('k')} · ${k('Enter')} · ${k('x')}</th><td>Thư viện: di chuyển giữa các paper · mở · tick</td></tr>
  <tr><th>${k('Enter')} trong ô chat</th><td>Gửi câu hỏi; ${k('Shift')}+${k('Enter')} xuống dòng</td></tr>
  <tr><th>${k('Ctrl')}+${k('O')}</th><td>Sổ tay: mở nhanh một trang (Enter khi không có thì tạo trang mới)</td></tr>
  <tr><th>${k('Ctrl')}+${k('J')}</th><td>Sổ tay: AI nhanh cho đoạn đang chọn / đoạn có con trỏ; dòng trống: AI viết mới</td></tr>
  <tr><th>${k('Ctrl')}+${k('/')}</th><td>Sổ tay: hướng dẫn cú pháp</td></tr>
  <tr><th>${k('Ctrl')}+${k('S')} · ${k('Ctrl')}+${k('B')} · ${k('Ctrl')}+${k('I')}</th><td>Sổ tay: lưu · in đậm · in nghiêng</td></tr>
  <tr><th>${k('Space')} ${k('←')} ${k('→')} ${k('1')}–${k('4')} ${k('P')}</th><td>Thẻ ghi nhớ: lật thẻ, thẻ trước, thẻ sau, chấm mức nhớ, nghe đoạn gốc</td></tr>
  <tr><th>${k('Esc')} · ${k('Shift')}+${k('Esc')}</th><td>Đóng hộp thoại, bỏ chọn · đóng bản đồ / đồ thị</td></tr>
</table>`,
  },
  {
    id: 'trouble', group: 'tools', title: 'Xử lý sự cố', routes: [],
    html: `
<ul>
  <li><b>Lỗi 401 hoặc 403.</b> Key sai, hết hạn hoặc không có quyền dùng model đã chọn. Kiểm tra lại key và tên model trong ${ui('Cài đặt')}, bấm ${ui('Kiểm tra kết nối')} (hoặc ${ui('Thử')} ở hàng của việc đó nếu đang dùng model riêng).</li>
  <li><b>Lỗi 429.</b> Nhà cung cấp đang giới hạn tốc độ hoặc tài khoản hết hạn mức. App tự thử lại ba lần; nếu vẫn lỗi, chờ vài phút hoặc giảm số paper xử lý mỗi lần.</li>
  <li><b>Thiếu venue, số trích dẫn, hoặc Semantic Scholar báo 429.</b> Xin key miễn phí tại api.semanticscholar.org rồi dán vào ${ui('Cài đặt')}. Khi Semantic Scholar bị chặn, app thử OpenAlex.</li>
  <li><b>Link OpenReview báo lỗi.</b> OpenReview chặn truy cập tự động. Tải PDF trên trang OpenReview rồi thêm qua tab ${ui('File PDF')}, hoặc dùng nút ${ui('→ App')} của extension.</li>
  <li><b>Phản hồi bị cắt.</b> Tăng ${ui('Max output tokens')} trong ${ui('Cài đặt')}.</li>
  <li><b>Trích xuất ra ký tự lạ.</b> PDF dùng font không kèm bảng mã ký tự. Chuyển sang Claude hoặc Gemini để gửi thẳng file PDF.</li>
  <li><b>Chat trả lời chung chung.</b> Kiểm tra paper đã có toàn văn chưa, rồi chuyển sang ${ui('Ghi chú + đoạn liên quan')} hoặc ${ui('Toàn văn')}.</li>
  <li><b>Cửa sổ app trắng sau khi tắt đột ngột.</b> App tự dọn tiến trình WebView còn sót khi mở lại. Nếu vẫn trắng, xoá thư mục <code>webview</code> trong thư mục dữ liệu rồi mở lại.</li>
  <li><b>Hai máy thấy dữ liệu khác nhau khi dùng cloud.</b> Có thể app đã mở đồng thời trên hai máy. Chọn bản đúng, xoá bản còn lại và chỉ mở app trên một máy mỗi lần.</li>
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
  const toc = GROUPS.map(([g, label]) => `<div class="hp-g">${escapeHtml(label)}</div>${SECTIONS.filter((s) => s.group === g).map((s) => `<a href="#/help?s=${s.id}" data-s="${s.id}">${escapeHtml(s.title)}</a>`).join('')}`).join('');
  root.innerHTML = `<div class="help-page">
    <aside class="help-toc">
      <input type="search" id="hp-q" placeholder="Tìm trong hướng dẫn…">
      <nav id="hp-toc">${toc}</nav>
    </aside>
    <div class="help-body" id="hp-body">
      <div class="page-head"><h1>Hướng dẫn sử dụng</h1><span class="hint">Số ①②③ trên ảnh khớp với các bước ngay bên dưới ảnh. Bấm vào ảnh để phóng to.</span></div>
      ${GROUPS.map(([g, label]) => `<div class="hp-gh" data-g="${g}">${escapeHtml(label)}</div>${SECTIONS.filter((s) => s.group === g).map((s) => `<section class="card help-sec" id="help-${s.id}" data-s="${s.id}"><h2>${escapeHtml(s.title)}</h2>${s.html}</section>`).join('')}`).join('')}
      <div id="hp-empty" class="empty" hidden>Không tìm thấy mục nào khớp.</div>
    </div>
  </div>`;

  const tocEl = root.querySelector('.help-toc');
  let activeId = '';
  /** Tô mục đang đọc ở mục lục và giữ nó trong tầm nhìn của mục lục (mục lục cuộn riêng). */
  const setActive = (id) => {
    if (!id || id === activeId) return;
    activeId = id;
    let link = null;
    root.querySelectorAll('#hp-toc a').forEach((a) => { const on = a.dataset.s === id; a.classList.toggle('active', on); if (on) link = a; });
    if (link) {
      const lr = link.getBoundingClientRect();
      const tr = tocEl.getBoundingClientRect();
      if (lr.top < tr.top + 56) tocEl.scrollTop -= tr.top + 56 - lr.top;
      else if (lr.bottom > tr.bottom - 12) tocEl.scrollTop += lr.bottom - (tr.bottom - 12);
    }
    if (location.hash !== `#/help?s=${id}`) history.replaceState(null, '', `#/help?s=${id}`);
  };
  const focus = (id) => {
    const el = document.getElementById(`help-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1200);
  };
  requestAnimationFrame(() => focus(target));

  // Mục lục đi theo khi cuộn: mục đang đọc là mục cuối cùng có đầu đã qua mép trên vùng xem.
  let raf = 0;
  const spy = () => {
    raf = 0;
    const secs = [...root.querySelectorAll('.help-sec')].filter((s) => !s.hidden);
    if (!secs.length) return;
    let cur = secs[0];
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) cur = secs[secs.length - 1];
    else {
      const line = root.getBoundingClientRect().top + 110;
      for (const s of secs) { if (s.getBoundingClientRect().top <= line) cur = s; else break; }
    }
    setActive(cur.dataset.s);
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(spy); };
  root.addEventListener('scroll', onScroll);

  // Liên kết giữa các mục (#/help?s=…) trong cùng trang: cuộn tới mục thay vì dựng lại trang.
  const onClick = (e) => {
    const a = e.target.closest('a[href^="#/help?s="]');
    if (a) {
      e.preventDefault();
      const id = a.getAttribute('href').split('s=')[1];
      history.replaceState(null, '', `#/help?s=${id}`);
      focus(id);
      return;
    }
    const img = e.target.closest('img[data-zoom]');
    if (img) zoom(img);
  };
  root.addEventListener('click', onClick);

  // Phóng to ảnh minh hoạ: bấm ra ngoài hoặc Esc để đóng.
  function zoom(img) {
    const ov = document.createElement('div');
    ov.className = 'hp-lb';
    ov.innerHTML = `<img src="${img.getAttribute('src')}" alt="${escapeHtml(img.alt)}"><div class="hp-lb-cap">${img.closest('figure')?.querySelector('figcaption')?.innerHTML || ''} · bấm để đóng</div>`;
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    ov.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
  }

  $('hp-q').addEventListener('input', (e) => {
    const q = norm(e.target.value.trim());
    let shown = 0;
    for (const sec of root.querySelectorAll('.help-sec')) {
      const ok = !q || norm(sec.textContent).includes(q);
      sec.hidden = !ok;
      root.querySelector(`#hp-toc a[data-s="${sec.dataset.s}"]`).hidden = !ok;
      if (ok) shown++;
    }
    // ẩn tiêu đề nhóm không còn mục nào
    for (const [g] of GROUPS) {
      const any = [...root.querySelectorAll('.help-sec')].some((s) => !s.hidden && SECTIONS.find((x) => x.id === s.dataset.s)?.group === g);
      root.querySelector(`.hp-gh[data-g="${g}"]`).hidden = !any;
    }
    root.querySelectorAll('.hp-g').forEach((h) => {
      let n = h.nextElementSibling;
      let any = false;
      while (n && !n.classList.contains('hp-g')) { if (!n.hidden) any = true; n = n.nextElementSibling; }
      h.hidden = !any;
    });
    $('hp-empty').hidden = shown > 0;
    spy();
  });

  // root là khung chung của mọi trang: gỡ sự kiện khi rời trang Hướng dẫn.
  return () => { root.removeEventListener('scroll', onScroll); root.removeEventListener('click', onClick); if (raf) cancelAnimationFrame(raf); };
}
