# Quy tắc khóa luồng tiếng Anh

## Trạng thái

Luồng tạo và render nội dung tiếng Anh hiện tại được khóa. Đây là quy tắc bắt buộc cho mọi công việc tiếp theo trong repository, trừ khi người dùng nói rõ cho phép mở khóa.

## Phạm vi được khóa

Giữ nguyên hành vi tiếng Anh đang có, bao gồm:

- Tạo và kiểm tra kịch bản tiếng Anh, dữ liệu nội dung, lời thoại, chú thích và hashtag.
- Chọn nhà cung cấp giọng đọc, giọng, tốc độ và cách tạo audio cho tiếng Anh (bao gồm Kokoro và các lựa chọn hiện có).
- Tách đoạn, căn chỉnh lời nói, thời gian từ, tô sáng từ và đồng bộ âm thanh với hình ảnh.
- Bố cục, font, hiệu ứng, kích thước, tốc độ khung hình, codec, chất lượng và quy trình render video.
- Cài đặt, giá trị mặc định, xử lý lỗi, thử lại và chuyển nhà cung cấp có thể làm thay đổi đầu ra tiếng Anh.

Các khu vực mã thường dùng chung hoặc liên quan trực tiếp gồm `src/ai/`, `src/pipeline/`, `src/tts/`, `packages/audio-highlight/` và `packages/video-engine/`. Danh sách này chỉ để nhận diện rủi ro, không giới hạn phạm vi khóa: mọi mã hoặc dữ liệu khác có thể làm đổi hành vi hay đầu ra tiếng Anh cũng thuộc phạm vi khóa.

## Quy tắc khi làm tiếng Nhật hoặc tiếng Trung

- Chỉ triển khai trong nhánh, cấu hình, dữ liệu và thành phần riêng cho `ja`/`zh` khi có thể.
- Không đổi mặc định, fallback, lựa chọn provider/voice, dữ liệu, giao diện cài đặt, căn chỉnh, bố cục hoặc pipeline đang dùng cho tiếng Anh.
- Không sửa, định dạng lại, di chuyển, thay thế hay hoàn nguyên mã dùng chung nếu việc đó có thể tác động đến tiếng Anh.
- Không lấy việc sửa tiếng Nhật/Trung làm lý do để thay đổi hoặc tối ưu luồng tiếng Anh.

## Khi phát hiện cần chạm tiếng Anh

Trước khi sửa bất kỳ nội dung nào thuộc phạm vi khóa hoặc mã dùng chung có khả năng ảnh hưởng tiếng Anh:

1. Dừng trước khi chỉnh sửa.
2. Báo người dùng chính xác file/thành phần cần chạm, lý do cần chạm và hành vi tiếng Anh có thể bị ảnh hưởng.
3. Chờ người dùng nói rõ đồng ý mở khóa phần liên quan.

Không suy diễn sự đồng ý từ yêu cầu sửa tiếng Nhật/Trung, từ yêu cầu chung chung như “fix triệt để”, hoặc từ việc mã thay đổi trông có vẻ an toàn. Chỉ tiếp tục sau khi người dùng duyệt rõ ràng. Nếu chưa được duyệt, tiếp tục tìm cách cô lập thay đổi hoặc để phần việc phụ thuộc ở trạng thái chưa sửa.

## Bảo vệ trạng thái hiện tại

- Không hoàn nguyên, xóa, viết lại hoặc tối ưu mã tiếng Anh hiện có.
- Không thay đổi đầu ra tiếng Anh để làm cho nó đồng nhất với tiếng Nhật/Trung.
- Giữ nguyên các chỉnh sửa sẵn có trong workspace; kiểm tra trạng thái Git trước khi thao tác và không ghi đè thay đổi của người dùng.
- Chỉ mở khóa khi có chỉ dẫn rõ ràng từ người dùng, và chỉ trong phạm vi họ đã duyệt.
