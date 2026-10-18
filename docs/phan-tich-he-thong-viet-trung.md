# Phân tích hiện trạng: hệ thống nội dung Việt–Trung

**Phạm vi:** Khảo sát mã nguồn và cấu hình đang có; chưa sửa mã, chưa cài hoặc tải model, chưa chạy render hay kiểm thử. Báo cáo này hoàn tất bước phân tích được yêu cầu trong tài liệu đính kèm.

## 1. Kết luận nhanh

Ứng dụng đã có chế độ Việt–Trung ở một số phần: chọn ngôn ngữ nội dung, prompt tạo kịch bản, định tuyến CosyVoice, cấu hình giọng tham chiếu, caption cơ bản và phân đoạn CJK cho tô sáng. Đây là nền tảng, chưa phải một quy trình Việt–Trung hoàn chỉnh theo yêu cầu.

Các khoảng trống chính là dữ liệu bài học chưa có pinyin và cấu trúc kiểm tra tiếng Trung; caption chưa bảo đảm bộ hashtag/quy tắc riêng; quy tắc xuống dòng hiện thiên về văn bản cách nhau bằng dấu cách; Visual Editor chỉ lưu một template chung, có layer tên tiếng Anh và chưa có kho template độc lập cho tiếng Trung. Chưa tìm thấy video mẫu để phân tích hình ảnh, lời đọc hoặc caption.

**Khuyến nghị:** Nếu được duyệt triển khai, giữ nguyên nhánh tiếng Anh và tạo dữ liệu, template, kiểm tra chất lượng tiếng Trung theo cấu hình riêng. Các file dùng chung có khả năng ảnh hưởng tiếng Anh và mọi thay đổi màn hình Visual Editor cần được bạn duyệt trước.

## 2. Kiến trúc hiện tại

- Ứng dụng chạy bằng Node.js, giao diện tĩnh HTML/CSS/JavaScript, server HTTP riêng và cơ sở dữ liệu SQLite.
- AI tạo kịch bản/caption; TTS sinh tiếng Việt và ngôn ngữ đích; FFmpeg cùng bộ dựng video tạo MP4 dọc. Worker xử lý render, lịch đăng và đăng Facebook.
- Ngôn ngữ bài hiện được lưu theo script trong trường `content_language`; job tạo video cũng nhận ngôn ngữ. Video liên kết tới script để lấy nội dung.
- Cấu hình đang có lựa chọn nội dung Anh, Nhật, Trung. Một kết nối Facebook/Page được cấu hình chung, không có định tuyến Page theo ngôn ngữ.

## 3. Luồng xử lý hiện tại

```text
Chọn chủ đề/ngôn ngữ
  → tạo kịch bản → kiểm tra dữ liệu → lưu script và content_language
  → tạo các đoạn đọc tiếng Việt + ngôn ngữ đích
  → chọn TTS theo ngôn ngữ → căn thời gian/tô sáng
  → dựng video dọc bằng template hiện hành → lưu thư viện
  → người dùng duyệt/lên lịch → worker gửi lịch hoặc đăng qua Facebook
```

Luồng tiếng Trung đi vào cùng pipeline video và lịch đăng hiện có. Đó là điểm cần xử lý thận trọng: thêm trường hoặc nhánh Trung có thể làm được mà không đổi tiếng Anh, nhưng sửa validator, căn thời gian, dựng template, giao diện hoặc lịch dùng chung cần kiểm tra tác động và giữ đường chạy tiếng Anh nguyên trạng.

## 4. Dữ liệu bài học và kiểm tra nội dung

Script hiện lưu chủ đề, tiêu đề, hook, ba dialogue, caption, hashtag, tiêu đề thumbnail, speech segments và ngôn ngữ. Mỗi dialogue hiện có thể chứa tiếng Việt, trường `chinese`, `term`, nghĩa và ghi chú tiếng Việt. Prompt tiếng Trung yêu cầu giản thể và câu nói tự nhiên, nhưng schema hiện chưa có trường pinyin hay đánh dấu một điểm học chính.

Validator yêu cầu ba dialogue và kiểm tra trường bắt buộc, câu tiếng Việt 7–10 từ, cụm từ xuất hiện trong câu đích và trùng lặp cơ bản. Chưa thấy kiểm tra riêng chữ giản thể, pinyin, thanh điệu, tính khớp giữa pinyin với chữ Hán, một điểm học chính, hoặc cấu trúc caption/hashtag theo các điều kiện chặt trong đề bài.

Phát hiện trùng lặp đã có xử lý từ tiếng Trung bằng `Intl.Segmenter` ở mức từ; hash còn dựa trên chủ đề và nội dung lời thoại. Đây là kiểm tra nền tảng, chưa thay cho kiểm tra trùng lặp ngữ nghĩa nhiều trường của đặc tả.

## 5. TTS và giọng Trung

Luồng TTS định tuyến `vieneu-cosyvoice3` cho tiếng Trung và gọi worker CosyVoice 3.0. Có kiểm tra trạng thái model/thư viện giọng và hỗ trợ các profile AISHELL-3. Mã có thể báo model chưa sẵn sàng nếu thiếu môi trường, checkpoint hoặc tài nguyên cần thiết; chỉ đọc mã nguồn không xác nhận model và đủ sáu profile đã được cài hợp lệ trên máy đang chạy.

Khi triển khai, cần kiểm tra từng giọng bằng câu tiếng Trung có transcript phù hợp, nghe audio thật và xác minh thời lượng/căn chỉnh. Không nên đánh giá khả năng phát âm chỉ từ trạng thái “đã cài”. Thay đổi định tuyến nằm trong `src/tts/local-ai-tts.mjs` là thay đổi module dùng chung: nhánh Kokoro tiếng Anh phải được khóa và đối chiếu trước/sau theo yêu cầu của bạn.

## 6. Template video và Visual Editor

Template mặc định là `branded-dialogue-v2`, khung 1080×1920 ở 30 fps, có 12 layer bắt buộc. Một layer nội dung đích tên `english-card`; thứ tự vẽ cũng khai báo layer này. Template hiện được đọc/lưu qua một nguồn chung, và Visual Editor có một state/template đang hoạt động, chưa có bộ lưu riêng theo ngôn ngữ.

Mã dựng đã nhận biết tiếng Trung ở một số chỗ, nhưng hàm xuống dòng hiện tách từ theo khoảng trắng rồi mới chia ký tự dài theo độ rộng. Cách này chưa thể hiện đúng ranh giới từ/cụm tiếng Trung; cần thiết kế và kiểm tra riêng với Hanzi, pinyin và phụ đề. Thêm lựa chọn Việt–Trung vào Visual Editor hiện tại hoặc thay layer/nhãn của template gốc sẽ làm thay đổi giao diện/dữ liệu thiết kế dùng chung.

**Ranh giới an toàn cần duyệt:** tạo template Trung độc lập, với file lưu/đường dẫn API riêng và layer tiếng Trung/pinyin riêng; không ghi template đó vào file tiếng Anh. Nếu muốn có bộ chọn ngôn ngữ ngay trong Visual Editor V2 hiện tại, đó là thay đổi giao diện gốc và cần bạn xác nhận vị trí/cách hiển thị trước khi làm.

## 7. Caption, thư viện và lịch Facebook

Caption service có nhánh tiếng Trung cơ bản và fallback tiếng Trung. Tuy vậy, bộ quy tắc hiện tại chưa đảm bảo chính xác số hashtag, hashtag bắt buộc/bị cấm, hay toàn bộ định dạng được nêu trong yêu cầu. Sinh hashtag hiện có các fallback chung; cần thêm kiểm tra xác định sau khi AI trả kết quả để bảo đảm đầu ra.

Thư viện và lịch làm việc theo video/script, nhưng không thấy bộ lọc tiếng Trung chuyên biệt hoặc báo cáo chất lượng theo ngôn ngữ. Facebook hiện chỉ có một Page ID trong settings, một token trong `facebook-page-token.txt`, và worker khởi tạo adapter/khóa đăng theo Page ID toàn cục. Hỗ trợ Page Trung riêng và nhiều Page trong tương lai cần lưu từng Page ID/token riêng, gán Page theo ngôn ngữ nội dung và chọn đúng cấu hình từ script của bài.

Giao diện cần giữ thẻ Facebook Page cùng bố cục mẫu bạn gửi, thêm nút “+” để tạo thêm thẻ Page. Mỗi thẻ giữ các thao tác kiểu hiện tại: chọn chế độ kết nối, nhập Page ID, nhập token khi thêm/đổi token, lưu, kiểm tra Page và xóa token riêng. Token đã lưu không được hiển thị lại. Cấu hình Page đang có phải tiếp tục dùng cho tiếng Anh và không bị ghi đè khi thêm Page mới. Có thể gán thẻ mới cho tiếng Trung; sau này thêm tiếng Nhật hoặc Page khác mà không phải thay dữ liệu cũ.

Để lịch không đổi đích khi người dùng sửa mapping Page về sau, lúc duyệt/lên lịch cần chụp lại profile/Page ID được chọn vào bản ghi lịch hoặc job. Worker dùng đúng profile đã chụp cho upload, kiểm tra trạng thái Facebook, retry và khóa theo Page. Đây là yêu cầu thiết kế cần thiết vì hiện bảng lịch không lưu profile/Page đích.

Việc định tuyến đi qua `src/server.mjs`, `src/workers/worker.mjs` và `packages/facebook-engine/meta-graph-adapter.mjs`; đây là đường đăng dùng chung. Cần giữ Page/token tiếng Anh làm cấu hình hiện hành và thêm nhánh Trung riêng. Vì worker dùng chung điều phối đăng/lịch, thay đổi này phải được kiểm tra riêng và tuân thủ khóa tiếng Anh trước khi sửa.

## 8. Phân tích bốn video mẫu

Đã đọc được và xem các khung hình đại diện/phần kết của bốn file trong thư mục Downloads. Metadata của cả bốn: dọc 1080×1920, 30 fps, video VP9, audio AAC 48 kHz stereo; thời lượng lần lượt khoảng 27.10, 26.50, 39.38 và 29.67 giây. Codec quan sát được là của file mẫu; không lấy nó làm yêu cầu đổi codec xuất video trong ứng dụng.

| Mẫu | Nội dung nhìn thấy | Cách trình bày |
|---|---|---|
| Sốt ba ngày | Câu Việt về sốt/ho; câu Anh có “have had a fever”; thẻ giải nghĩa cụm từ. | Câu đích được tô sáng theo tiến trình; sau đó hiện thẻ giải thích cách dùng thì. |
| Rảnh năm phút | Đoạn hỏi–đáp ngắn Việt–Anh. | Hai câu lần lượt lên thẻ; giữ nhân vật và nhận diện cố định. |
| Xe hỏng giữa đường | Nội dung nhiều câu, đánh số; có “broke down” và “deal with” cùng phần giải thích. | Ví dụ dài nhất; dùng số thứ tự, thẻ giải thích và chuyển cảnh giữa các câu. |
| Ăn chay | Câu Việt, câu Anh với “a vegetarian” và “cannot eat any meat”; thẻ từ vựng. | Tô màu cụm trọng tâm khác nhau; kết thúc bằng CTA theo dõi. |

Các điểm chung quan sát được: nền sáng màu kem có vân nhẹ; logo cú mèo ở phía trên; nhân vật minh họa lặp lại gần nửa dưới; biểu tượng mạng xã hội và dòng nhận diện ở chân khung; câu Việt và câu đích ở các thẻ bo góc có bóng nhẹ; từ/cụm đích đổi màu khi đọc; thẻ giải thích từ vựng xuất hiện sau phần câu; cuối video có CTA. Mẫu 3 bổ sung số thứ tự rõ cho từng ví dụ.

Các mẫu đang mang thương hiệu/CTA tiếng Anh (“Tiếng Anh Chậm Mà Chắc”, “FOLLOW”, luyện tiếng Anh). Do Page Trung là Page riêng, chỉ nên xem bố cục, nền và nhân vật là tham khảo; template Trung cần cấu hình riêng cho tên Page, logo/chữ thương hiệu và CTA. Không được ghi đè template hay brand tiếng Anh. Báo cáo này phân tích hình ảnh và metadata; chưa xác minh lời thoại bằng nghe/transcription.

## 9. Khóa tiếng Anh, giao diện và vùng mã liên quan

`AGENTS.md` trong workspace ghi rõ luồng tạo/render tiếng Anh đang khóa và yêu cầu dừng, nêu file/lý do/nguy cơ rồi chờ bạn mở khóa nếu thay đổi có thể ảnh hưởng tiếng Anh. Quy tắc này trùng với chỉ dẫn trước đó của bạn. Workspace hiện cũng có nhiều thay đổi chưa commit; cần giữ nguyên và không hoàn nguyên hay ghi đè.

| Vùng | File tiêu biểu | Vì sao cần xin ý kiến/kiểm soát |
|---|---|---|
| Tạo/kiểm tra script | `src/ai/script-service.mjs`, `src/ai/validator.mjs` | Dùng chung schema và kiểm tra tiếng Anh/Trung/Nhật. |
| Caption | `src/ai/caption-service.mjs` | Có nhánh tiếng Anh hiện hành và nhánh đa ngôn ngữ. |
| TTS/căn lời | `src/tts/local-ai-tts.mjs`, `src/tts/multilingual-local-tts.mjs`, `packages/audio-highlight/highlight-engine.mjs` | Chọn model, phân đoạn, timing và highlight; có thể tác động audio/hiển thị tiếng Anh. |
| Dựng video | `packages/video-engine/visual-template-engine.mjs`, `assets/branding/visual-template.json` | Renderer và template dùng chung; template gốc có nhận diện/layer tiếng Anh. |
| DB/API/giao diện | `src/database/db.mjs`, `src/server.mjs`, `public/app.js`, `public/index.html`, `public/visual-editor.js` | Lưu mode, route template và bộ chọn có thể đổi dữ liệu hoặc giao diện hiện tại. |
| Đăng/lên lịch đa Page | `src/server.mjs`, `src/workers/worker.mjs`, `packages/facebook-engine/meta-graph-adapter.mjs` | Hiện dùng một Page ID/token chung; cần định tuyến theo ngôn ngữ, vẫn giữ nguyên cấu hình và lịch Anh. |

Đề xuất cô lập tối đa bằng nhánh điều kiện `zh`, dữ liệu/template riêng và migration cộng thêm. Nếu còn cần chỉnh file dùng chung có nguy cơ tác động tiếng Anh, dừng tại đó và xin bạn mở khóa đúng phạm vi; không tự coi yêu cầu làm tiếng Trung là cho phép sửa tiếng Anh.

Phần giao diện đã được bạn định hướng: giữ nguyên màn hình/template tiếng Anh; trong Visual Editor hiện tại bổ sung chế độ Việt–Trung bằng nút riêng cho Tiếng Việt và Tiếng Trung; để sẵn khả năng thêm Tiếng Nhật sau này. Thiết lập Pinyin và template lưu độc lập cho chế độ Trung. Trong phần kết nối Facebook, giữ thẻ hiện tại theo ảnh và thêm nút “+” cùng các thẻ cấu hình độc lập. Đây là các bổ sung bạn đã mô tả; không được thay đổi bố cục, nhãn hay hành vi của chế độ tiếng Anh.

## 10. Yêu cầu đã chốt và điểm còn chờ trước khi triển khai

**Bạn đã xác nhận:**

1. Bốn video mẫu là tư liệu tham khảo đã gửi; không cần chờ video để bắt đầu triển khai đặc tả đã nêu. Tôi đã xem các khung hình; có thể dùng mẫu để đối chiếu phong cách, nhưng chúng không phải nội dung tiếng Trung.
2. Giữ nguyên các lựa chọn Anh, Nhật, Trung. Nhật sẽ được phát triển sau Trung.
3. Visual Editor vẫn ở cùng khu vực; thêm chế độ/nút Tiếng Việt và Tiếng Trung, có thể mở rộng Tiếng Nhật. Chế độ tiếng Anh và template Anh hiện tại giữ nguyên.
4. Pinyin mặc định nằm ngay dưới Hanzi, căn giữa, chữ nhỏ hơn và màu khác. Lần đọc tiếng Trung đầu tiên chỉ hiện Hanzi; từ lần đọc lại thứ hai Pinyin xuất hiện và tiếp tục hiển thị trong phần luyện đọc.
5. Pinyin là layer độc lập trong template Trung; cho phép chỉnh X/Y, kích thước, font, màu, hiệu ứng xuất hiện và bật/tắt. Các giá trị mặc định không bị khóa và lưu trong template Trung riêng.
6. Bài Trung đăng lên một Facebook Page riêng. Phần cài đặt Facebook có nút “+” để thêm nhiều Page ID/token; mỗi Page có thẻ theo bố cục ảnh, token được giữ kín và Page tiếng Anh hiện tại được bảo toàn.

**Giả định để triển khai đúng câu “lần đọc thứ hai”:** Với mỗi câu tiếng Trung, lần trình bày/đọc đầu tiên ẩn Pinyin; khi chính câu đó được đọc lại ở lượt luyện tập thì hiện Pinyin và giữ đến hết lượt luyện. Nếu ý bạn là Pinyin chỉ xuất hiện từ lần đọc thứ hai của toàn video, hãy nói rõ trước khi chốt timeline.

**Phạm vi cần duyệt trước khi sửa mã:** phần quản lý Page yêu cầu chạm `src/server.mjs`, `src/workers/worker.mjs`, `packages/facebook-engine/meta-graph-adapter.mjs`, `src/database/db.mjs`, `public/index.html`, `public/app.js` và CSS cài đặt. Ba module server/worker/adapter hiện giữ kết nối và đăng Facebook dùng chung; thay đổi cần được giới hạn vào chọn Page theo ngôn ngữ, giữ cấu hình tiếng Anh cũ làm mặc định và lưu Page đích cho từng lịch. `AGENTS.md` cùng yêu cầu khóa tiếng Anh trước đây yêu cầu dừng và xin bạn mở đúng phạm vi trước khi sửa các module có thể ảnh hưởng đường đăng tiếng Anh.

Page Trung sẽ cần Page ID và Page Access Token riêng. Không cần gửi token trong chat; nhập token qua giao diện cài đặt khi phần này được triển khai. Trước khi kết nối thật, cần bạn gán profile Page Trung cho ngôn ngữ Trung; các bài tiếng Anh tiếp tục dùng profile hiện có.

Các nội dung trên đã đủ để lập thiết kế/schema và kế hoạch theo từng file. Theo yêu cầu ở giai đoạn phân tích, chưa có thay đổi mã hay kiểm thử nào được thực hiện; bước tiếp theo chỉ nên bắt đầu sau khi bạn duyệt kế hoạch và phạm vi file dùng chung cần mở khóa.
