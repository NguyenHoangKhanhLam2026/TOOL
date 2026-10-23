# Quy tắc khóa luồng tiếng Anh và tiếng Trung

## Trạng thái

Luồng tạo, lưu, xử lý, render và đăng nội dung tiếng Anh (`en`) và tiếng Trung (`zh`) hiện tại được khóa. Đây là quy tắc bắt buộc cho mọi công việc tiếp theo trong repository, trừ khi người dùng nói rõ cho phép mở khóa phạm vi cụ thể.

## Phạm vi được khóa

Giữ nguyên hành vi và đầu ra hiện có của cả tiếng Anh và tiếng Trung, bao gồm:

- Tạo và kiểm tra kịch bản, dữ liệu nội dung, lời thoại, chú thích và hashtag.
- Chọn nhà cung cấp, model, giọng đọc, tốc độ và cách tạo audio; gồm cả audio tiếng Việt đi kèm nội dung tiếng Trung.
- Chia đoạn, căn chỉnh lời nói, thời gian từ, tô sáng từ và đồng bộ âm thanh với hình ảnh.
- Bố cục, font, hiệu ứng nền, chuyển cảnh, kích thước, tốc độ khung hình, codec, chất lượng và quy trình render video.
- Cài đặt, giá trị mặc định, cấu hình riêng theo ngôn ngữ, lưu/đọc dữ liệu, giao diện, API, cơ sở dữ liệu, lịch đăng, định tuyến Page/token, xử lý lỗi, thử lại và fallback có thể làm đổi hành vi hoặc đầu ra.
- Các khác biệt đã lưu giữa cấu hình tiếng Anh và tiếng Trung; không gộp, ghi đè hoặc dùng nhầm cấu hình của ngôn ngữ này cho ngôn ngữ kia.

Các khu vực mã thường liên quan gồm `src/ai/`, `src/pipeline/`, `src/tts/`, `src/workers/`, `src/database/`, `src/scheduler/`, `src/facebook/`, `public/`, `packages/audio-highlight/` và `packages/video-engine/`. Danh sách này chỉ để nhận diện rủi ro, không giới hạn phạm vi khóa: mọi mã, giao diện, cấu hình hoặc dữ liệu có thể làm đổi hành vi hay đầu ra tiếng Anh hoặc tiếng Trung cũng thuộc phạm vi khóa.

## Quy tắc khi thêm nội dung hoặc ngôn ngữ mới

- Cô lập trong nhánh xử lý, cấu hình, dữ liệu, khóa lưu trữ và thành phần riêng cho nội dung mới khi có thể.
- Không dùng `en` hoặc `zh` làm fallback cho nội dung mới; không để lựa chọn mới tự lưu đè thiết lập hiện có.
- Không đổi mặc định, provider/voice, dữ liệu, giao diện cài đặt, căn chỉnh, bố cục, lịch đăng hoặc pipeline đang dùng cho tiếng Anh hay tiếng Trung.
- Không sửa, định dạng lại, di chuyển, thay thế hoặc hoàn nguyên mã dùng chung nếu việc đó có thể tác động đến EN hoặc ZH.

## Khi phát hiện cần chạm phạm vi bị khóa

Trước khi sửa bất kỳ nội dung nào thuộc phạm vi khóa hoặc mã dùng chung có khả năng ảnh hưởng EN/ZH:

1. Dừng trước khi chỉnh sửa.
2. Báo người dùng chính xác file/thành phần cần chạm, lý do cần chạm và hành vi EN/ZH có thể bị ảnh hưởng.
3. Chờ người dùng nói rõ đồng ý mở khóa đúng phạm vi đó.

Không suy diễn sự đồng ý từ yêu cầu chung như “fix triệt để”, “thêm ngôn ngữ mới” hoặc từ việc thay đổi trông có vẻ an toàn. Chỉ tiếp tục sau khi người dùng duyệt rõ phần cần mở khóa. Nếu chưa được duyệt, tiếp tục tìm cách cô lập thay đổi hoặc để phần việc phụ thuộc ở trạng thái chưa sửa.

## Bảo vệ trạng thái hiện tại

- Không hoàn nguyên, xóa, viết lại hoặc tối ưu mã hay dữ liệu tiếng Anh/tiếng Trung hiện có.
- Không thay đổi đầu ra EN/ZH để làm chúng giống nhau hoặc giống ngôn ngữ khác.
- Giữ nguyên các chỉnh sửa sẵn có trong workspace; kiểm tra trạng thái Git trước khi thao tác và không ghi đè thay đổi của người dùng.
- Chỉ mở khóa khi có chỉ dẫn rõ ràng từ người dùng, và chỉ trong phạm vi họ đã duyệt.

## Khóa mọi nội dung và chủ đề đã hoàn thiện

Quy tắc này áp dụng cho mọi ngôn ngữ, không chỉ EN/ZH. Mọi nội dung hoặc chủ đề đã hoàn thiện, đã được người dùng chấp nhận, hoặc đang được dùng làm mẫu chuẩn đều là trạng thái đã khóa. Khi một chủ đề mới được hoàn thiện/chấp nhận, chủ đề đó tự động thuộc phạm vi khóa này.

- Giữ nguyên nội dung, dữ liệu, thứ tự và cấu trúc chủ đề, số lượng/phân đoạn, lời thoại, bản dịch, cụm từ, lời giải thích, giọng đọc, tốc độ, thời lượng, bố cục, template và đầu ra đã hoàn thiện.
- Không sửa, ghi đè, xóa, di chuyển, đổi cấu trúc, đổi mặc định, tái tạo hoặc áp dụng migration lên nội dung/chủ đề đã khóa. Không để một cập nhật chung làm thay đổi gián tiếp các mục đó.
- Nội dung hoặc chủ đề mới phải được thêm theo ID/phiên bản riêng; không dùng chúng để ghi đè dữ liệu, cấu hình hay cấu trúc của chủ đề đã hoàn thiện.
- Trước mọi thay đổi có thể tác động đến nội dung đã khóa, dừng lại và báo chính xác file/thành phần, chủ đề bị ảnh hưởng, thay đổi dự kiến và rủi ro. Chờ người dùng duyệt rõ phạm vi đó rồi mới sửa. Yêu cầu chung như “update”, “fix” hoặc “thêm nội dung” không tự mở khóa.
- Nếu có thể cô lập thay đổi mới để không đụng nội dung đã khóa, chỉ tiến hành trong phạm vi cô lập đó. Nếu không thể bảo đảm cô lập, hỏi người dùng trước và chưa thực hiện phần phụ thuộc.
- Sau khi được duyệt và sửa, rà diff để xác nhận dữ liệu/chủ đề ngoài phạm vi được duyệt không bị thay đổi. Không chạy cập nhật hàng loạt hoặc render lại chủ đề đã hoàn thiện nếu chưa được duyệt rõ.
