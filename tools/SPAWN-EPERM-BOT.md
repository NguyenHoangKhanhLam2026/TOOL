# Spawn EPERM Repair Bot

Bot là tiến trình Windows độc lập, chạy nền khi mở tool bằng `start.bat` và theo dõi lỗi `spawn EPERM`, `EACCES`, `ENOENT` mới trong job database.

## Bot làm gì

- Kiểm tra Node.js, Python, FFmpeg, FFprobe, lệnh `spawn` đồng bộ/bất đồng bộ và quyền ghi thư mục làm việc.
- Khi khởi động, ghi nhận các job spawn thất bại cũ để không tự chạy lại nội dung lịch sử. Với lỗi mới, chạy thử đúng executable bị lỗi. Chỉ khi executable khởi chạy được, không còn job nào đang chạy và worker có thể khởi động lại thì bot mới retry đúng job một lần.
- Nếu executable vẫn bị Windows hoặc môi trường chạy chặn, bot giữ nguyên job lỗi, ghi nguyên nhân vào `data/logs/spawn-eperm-bot.log` và không lặp vô hạn.
- Nếu tool đang mở, không tạo thêm server hoặc worker trùng.
- Nếu worker dừng nhưng server còn mở, khởi chạy worker còn thiếu.
- Chỉ nhận dạng lỗi spawn có dạng Node.js thực sự trả về, không nhầm dòng giải thích “không phải lỗi spawn EPERM” của Edge TTS HTTP 403.

## Cách dùng

- `start.bat` tự mở bot giám sát ẩn cùng tool.
- Chỉ kiểm tra môi trường: `node tools/spawn-eperm-bot.mjs`.
- Kiểm tra và sửa một job lỗi hiện có: `tools/FIX-SPAWN-EPERM.bat`.
- Mở tool nếu tool chưa chạy: `node tools/spawn-eperm-bot.mjs --start`.

Bot bổ sung PATH/PYTHON trong phiên khởi chạy và có thể nạp lại worker sau khi phép thử spawn thành công. Bot không thể vượt chính sách chặn tiến trình của Windows/antivirus, cũng không thể sửa lỗi từ dịch vụ TTS bên ngoài. Nếu thấy HTTP 403 từ Edge TTS, mã ứng dụng đã chạy được nhưng nhà cung cấp từ chối phiên kết nối; bot không lặp lại job.
