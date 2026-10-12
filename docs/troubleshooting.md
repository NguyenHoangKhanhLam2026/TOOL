# Xử lý sự cố

## `Worker đang tắt`

Chạy `npm run worker` trong terminal riêng hoặc mở lại `start.bat`. Worker có thể dừng nếu terminal đóng.

## `Thiếu edge-tts`

Chạy `setup.ps1`. Kiểm tra `%PROJECT%\.venv\Scripts\python.exe -c "import edge_tts"`. Nếu dùng Python khác, khai báo biến môi trường `PYTHON` trước khi chạy server và worker.

## `FFmpeg/ffprobe chưa cài`

Cài bản FFmpeg có kèm ffprobe, thêm thư mục `bin` vào PATH, mở terminal mới và chạy `npm run setup`.

## Ollama trả lỗi hoặc thiếu model

Chạy `ollama serve`, sau đó tải model đã chọn, ví dụ `ollama pull qwen2.5:7b`. URL chỉ chấp nhận localhost.

## Không kết nối được ChatGPT plan

Kiểm tra callback quay về đúng `http://127.0.0.1:3001/auth/callback`, tài khoản cho phép sử dụng ChatGPT plan trong ứng dụng và đã cấp scope Responses. Nếu bị từ chối hoặc hết hạn, thử đăng nhập lại hoặc dùng Ollama. Hết hạn mức không gọi API key có phí.

## Meta từ chối upload

Kiểm tra Page ID, Page Access Token, quyền quản lý nội dung Page, phiên bản Meta Graph API, giới hạn định dạng/độ dài Reel và quyền App Review. Mở Nhật ký hoạt động. Khi history ở trạng thái `uncertain`, kiểm tra Page trước khi đăng lại thủ công.

## Máy ngủ hoặc bị tắt

Scheduler local không chạy khi Windows ngừng thực thi. Giữ máy hoạt động, tắt sleep trong khung giờ đăng và đảm bảo worker chạy. Không có cam kết đăng nếu máy offline.
