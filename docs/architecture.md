# Kiến trúc

## Runtime

- `src/server.mjs` chạy HTTP server chỉ bind `127.0.0.1`, port mặc định 3001.
- `node:sqlite` lưu settings, 100 chủ đề, scripts, video, queue, lịch, nhật ký và trạng thái publish. Database bật WAL và foreign keys.
- `src/workers/worker.mjs` poll database queue độc lập với trình duyệt, khôi phục job stale, bổ sung stock, xử lý lịch và thực hiện publish.
- `src/pipeline/create-video.mjs` điều phối AI → script validation → Edge TTS → FFmpeg → FFprobe → thumbnail.
- AI provider gọi Responses API bằng OAuth ChatGPT plan khi người dùng cấp quyền, rồi fallback Ollama. Paid API bị chặn bằng cấu hình và không có key.
- Facebook adapter chọn riêng Mock hoặc Meta Graph API. Live mặc định tắt.

## Bất biến dữ liệu

- Content hash chuẩn hóa dấu câu và chữ hoa/thường; hash là unique trong SQLite.
- Kịch bản không qua validator thì không đến TTS.
- Job được claim trong `BEGIN IMMEDIATE` để worker dùng chung database không claim cùng job.
- Mỗi video chỉ có một `scheduled_posts` row. Publish history giữ lại trạng thái, ID, URL và lỗi.
- Sau khi có một lần bắt đầu upload Reel Meta nhưng không xác minh được kết quả, retry tự động bị chặn để tránh đăng trùng.
- API không trả Page token hoặc OAuth token về trình duyệt. Các bí mật nằm ngoài thư mục source trong LocalAppData.

## Luồng trạng thái video

`processing → ready → scheduled → publishing → published`

Lỗi render chuyển video sang `failed`, lỗi xuất bản chuyển thành `publish_failed`. Kịch bản và file tạm được giữ lại để xử lý.
