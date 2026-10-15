# Spawn EPERM Repair Bot

Bot này là công cụ Windows độc lập để kiểm tra tiến trình của project và tự xử lý lỗi `spawn EPERM` đã được ghi vào log. Bot không phải dịch vụ chạy nền; mở `tools/FIX-SPAWN-EPERM.bat` sau khi gặp lỗi.

## Bot làm gì

- Kiểm tra Node.js, Python, FFmpeg, FFprobe, lệnh `spawn` đồng bộ/bất đồng bộ và quyền ghi thư mục làm việc.
- Nếu lỗi job mới nhất là `spawn EPERM`, xác nhận không có job nào đang chạy, khởi động lại đúng worker cũ rồi đưa lại chính job lỗi vào hàng đợi một lần. Bot giữ nguyên payload để không tạo video trùng.
- Nếu tool đang mở, không tạo thêm server hoặc worker trùng.
- Nếu worker dừng nhưng server còn mở, khởi chạy worker còn thiếu.
- Không tự khởi động lại worker khi job mới nhất lỗi do dịch vụ khác, chẳng hạn Edge TTS trả HTTP 403.

## Cách dùng

- Chạy `tools/FIX-SPAWN-EPERM.bat` sau khi tool báo lỗi.
- Chỉ kiểm tra môi trường, không sửa worker: `node tools/spawn-eperm-bot.mjs`.
- Mở tool nếu tool chưa chạy: `node tools/spawn-eperm-bot.mjs --start`.

Bot sửa PATH/PYTHON trong phiên khởi chạy và có thể nạp lại worker. Bot không thể vượt chính sách chặn tiến trình của Windows/antivirus, cũng không thể sửa lỗi từ dịch vụ TTS bên ngoài. Nếu thấy HTTP 403 từ Edge TTS, mã ứng dụng đã chạy được nhưng nhà cung cấp từ chối phiên kết nối; bot sẽ báo rõ và không lặp lại job.
