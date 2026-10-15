# Auto English Reels Studio

> Ứng dụng Windows chạy local để soạn kịch bản tiếng Anh Việt–Anh, tạo giọng đọc, dựng video dọc, lưu thư viện và lên lịch Facebook Page.

**Địa chỉ mặc định:** http://localhost:3001  
**Ngôn ngữ giao diện:** tiếng Việt  
**API AI trả phí:** không được cấu hình hoặc gọi.

## Tình trạng hiện tại

Đã có mã nguồn cho dashboard, SQLite WAL, thư viện 100 chủ đề, xác thực kịch bản, ChatGPT plan OAuth, Ollama, Edge TTS, FFmpeg renderer, thư viện video, lịch địa phương, worker, Facebook Mock và adapter Meta Graph API. Visual Engine V2 bổ sung nhận diện “Sinh ra để nói tiếng Anh”, scene template dùng chung, preview/editor, asset manager, upload asset cục bộ và sự kiện tiến độ qua WebSocket loopback.

Mỗi video tạo audio riêng cho từng đoạn đọc, thu WordBoundary theo giọng và căn highlight theo timeline trước khi render MP4. Số lượt hội thoại lấy từ kịch bản, không cố định ba cặp. Renderer vẫn xác minh 1080×1920, 30 FPS, H.264/AAC và thời lượng 4–60 giây bằng ffprobe. Facebook live tắt mặc định.

**Kiến trúc hiện tại:** backend dùng HTTP, WebSocket loopback và SQLite tích hợp trong Node; giao diện dùng HTML/CSS/JavaScript thuần. Sharp được dùng để rasterize scene SVG, sinh logo PNG. Dự án chưa dùng React, TypeScript, Vite, Express, Zod, Tailwind hoặc Luxon.

## Yêu cầu

- Windows 10/11.
- Node.js 22.13 trở lên (SQLite được tích hợp trong Node).
- Python 3.10 trở lên để chạy Edge TTS.
- FFmpeg và FFprobe có trong `PATH`.
- Ollama chỉ cần nếu muốn dùng mô hình AI local.

## Cài đặt lần đầu

1. Cài Node.js LTS và Python 3.
2. Cài FFmpeg có kèm FFprobe, sau đó mở terminal mới. Ví dụ: `winget install --id Gyan.FFmpeg.Shared --exact`.
3. Mở thư mục này trong VS Code.
4. Chạy PowerShell:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\setup.ps1
   npm run setup
   ```

   `setup.ps1` tạo `.venv` riêng cho dự án và cài gói mã nguồn mở `edge-tts`. `npm run setup` kiểm tra Node, Python, Edge TTS, FFmpeg và ffprobe.

   WordBoundary của Edge TTS là nguồn timestamp chính. Nếu mốc thiếu hoặc không khớp văn bản, ứng dụng thử forced alignment local bằng stable-ts nếu đã cài. Đây là phụ thuộc tùy chọn vì cần PyTorch và model tải về; cài bằng `python -m pip --python .venv\Scripts\python.exe install -r packages\tts-engine\python\requirements-alignment.txt`. Model mặc định là `base`; có thể đổi bằng `AERS_ALIGNMENT_MODEL`. Nếu không có model hoặc căn chỉnh không đáng tin, audio vẫn được giữ nguyên, highlight tắt riêng cho đoạn đó và ứng dụng ghi cảnh báo.

Trong **Cài đặt → Giọng đọc & video**, chọn giọng nữ/nam tiếng Việt hoặc một trong các giọng tiếng Anh Mỹ. Mỗi giọng tiếng Anh có nút nghe thử riêng; chọn giọng rồi bấm **Lưu cài đặt** để dùng cho video tiếp theo. Mỗi thẻ hội thoại giữ đủ thông tin khoảng 5,5 giây rồi chuyển cảnh mờ về đen trong khoảng 0,3 giây.

5. Chạy `start.bat`. Ứng dụng mở tại http://localhost:3001 cùng worker nền.

`start.bat` tự thêm thư mục FFmpeg WinGet vào `PATH` của server và worker nếu phát hiện bản đã cài. Nếu chạy `npm run dev` hoặc `npm run worker` riêng, giữ FFmpeg và FFprobe trong `PATH` của terminal.

`npm install` cài Sharp để dựng scene SVG và xử lý thumbnail. Dữ liệu video, database và log nằm trong `data/`. Thông tin ChatGPT OAuth và Facebook Page Token nằm trong `%LOCALAPPDATA%\AutoEnglishReelsStudio\private`, không lưu trong mã nguồn.

## Chạy riêng từng tiến trình

```powershell
npm run dev       # API và giao diện tại cổng 3001
npm run worker    # tiến trình queue, scheduler, render và publish
```

Chạy hai lệnh trong hai terminal riêng. `npm run start` chạy server; `start.bat` chạy cả server và worker. Dừng worker/server trước khi tắt máy. Windows Task Scheduler có thể mở `start.bat` khi đăng nhập. Máy ngủ, tắt hoặc mất mạng thì lịch local không thể chạy.

## Kết nối AI

### ChatGPT plan

Trong Cài đặt, chọn **Continue with ChatGPT**. Ứng dụng dùng Sign in with ChatGPT dành cho open-source client, OAuth Authorization Code + PKCE, callback loopback, kiểm tra ID token, refresh token và Responses API. Không dùng cookie ChatGPT, API nội bộ của trang ChatGPT hay OpenAI API key tính phí.

Tài khoản phải được OpenAI cho phép dùng ChatGPT plan trong ứng dụng này và người dùng phải chấp thuận scope `chatgpt.tokens.use.direct`. Luồng này có giới hạn preview và phụ thuộc quyền của tài khoản/workspace; nếu không được cấp quyền, dùng Ollama local. Tham khảo [OpenAI Docs: Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source), [đăng ký và đăng nhập](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), và [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

### Ollama

1. Cài Ollama và tải một model, ví dụ `ollama pull qwen2.5:7b`.
2. Giữ Ollama chạy local tại `http://127.0.0.1:11434`.
3. Nhập URL và tên model trong Cài đặt rồi bấm **Kiểm tra**.

Khi ChatGPT plan hết hạn mức hoặc không khả dụng, provider manager thử Ollama. Nếu không có provider, job báo lỗi và giữ lại kịch bản/video đã hoàn thành.

## Facebook Page

- `facebookAdapter` mặc định là **Mock**. Mock không tạo bài viết Facebook thật.
- Để đăng thật, chọn Meta Graph API, nhập Page ID và Page Access Token, rồi bấm **Kiểm tra Page**.
- Chỉ bật **Tự đăng theo lịch** sau khi Page đã được xác minh. Lệnh đăng đơn lẻ từ giao diện cũng yêu cầu xác nhận rõ ràng.
- Cần quyền Page phù hợp và quyền Meta App; Meta có thể yêu cầu app review. Adapter dùng Graph API Reels upload phases (start, binary upload, finish, status).
- Lịch đăng chạy cục bộ trên máy này. Khi máy tắt hoặc worker không chạy, bài không thể được đăng.

**LIVE FACEBOOK PUBLISH NOT YET VERIFIED** — chưa có Page ID/token thật để kiểm tra trong môi trường xây dựng.

## Tạo và đăng video

1. Kết nối ChatGPT plan hoặc Ollama; có thể bật tùy chọn mẫu cục bộ nếu chỉ muốn thử các bước sau AI.
2. Chọn chủ đề trong dashboard và tạo video.
3. Worker xác thực kịch bản có số lượt linh hoạt, gọi Edge TTS riêng theo giọng/ngôn ngữ của từng lượt, đo thời lượng bằng ffprobe và dựng video 1080×1920/30 FPS với highlight theo timeline.
4. Video hợp lệ xuất hiện trong Thư viện. Mở kịch bản để xem câu, từ khóa, giải thích và caption.
5. Lên lịch trong tab Lịch đăng. Muốn tự đăng, kết nối Meta và bật rõ ràng tùy chọn tương ứng.

Renderer xác minh H.264/AAC, 1080×1920, 30 FPS và thời lượng 4–60 giây trước khi đánh dấu sẵn sàng; không gọi Meta khi render.

## Visual Engine V2

- Mở [Visual Editor](http://localhost:3001/visual-editor) để xem 6 trạng thái, chọn/ẩn layer, sửa vị trí, kích thước, màu, chữ và timing; kéo layer ngay trên preview. Có undo, reset, save, render thử 5 giây và render đầy đủ từ kịch bản đã lưu.
- Mở [Tài nguyên thương hiệu](http://localhost:3001/assets) để xem nền, nhân vật, logo và font; tải asset lên, đặt mặc định, xóa khi không còn được template/video manifest dùng, hoặc khôi phục mặc định.
- Template dùng chung nằm ở `assets/branding/visual-template.json`; bản gốc reset ở `visual-template-default.json`. Asset PNG là tài nguyên tái sử dụng, không tạo AI riêng cho từng video.
- Be Vietnam Pro được lấy từ [Google Fonts](https://github.com/google/fonts/tree/main/ofl/bevietnampro) và phân phối theo SIL Open Font License 1.1; giấy phép đi cùng tại `assets/branding/fonts/OFL.txt`.
- noVNC/VNC chưa bật và chưa cài. Lý do kỹ thuật được ghi ở [docs/vnc-assessment.md](docs/vnc-assessment.md).

## Highlight đồng bộ giọng đọc

- Trong Cài đặt, chọn bật/tắt, từng từ/từng cụm, màu, padding, bo góc và chuyển tức thời/trượt mượt; nút nghe thử dùng audio và WordBoundary trả về cho đúng câu preview.
- Câu hiển thị được token hóa thành ID ổn định; renderer dùng cùng bộ ánh xạ timeline cho audio preview và MP4. Các câu dài được xuống dòng trước khi xác định hộp từ, nên highlight giữ đúng vị trí sau khi xuống dòng.
- WordBoundary theo từng audio clip tự phản ánh giọng và tốc độ đọc. Nếu Edge thiếu mốc, stable-ts là phương án local miễn phí có thể cài tùy chọn. Nếu cả hai nguồn không căn chỉnh được đầy đủ, đoạn vẫn có tiếng nhưng không tô từ và có log cảnh báo.
- Khi có nhiều lượt, renderer tự rút ngắn thời gian nghỉ xem từ vựng để giữ video trong giới hạn 60 giây nếu tổng audio còn vừa. Nếu riêng audio đọc đã dài hơn giới hạn, hệ thống báo rõ và không cắt mất câu.

## Lệnh dự án

| Lệnh | Hoạt động |
|---|---|
| `npm run setup` | Kiểm tra phiên bản và công cụ local |
| `npm run dev` | Chạy server local |
| `npm run build` | Kiểm tra cú pháp toàn bộ module trước khi chạy |
| `npm run start` | Chạy server local |
| `npm run worker` | Chạy worker và scheduler |
| `npm run test` | Unit và integration tests |
| `npm run lint` | Kiểm tra cú pháp và tài nguyên frontend local |
| `npm run typecheck` | Kiểm tra cú pháp JavaScript; dự án hiện chưa dùng TypeScript |

## Cấu trúc chính

```text
src/
  ai/                 ChatGPT plan, Ollama, validator
  database/           SQLite schema, migration, queue
  pipeline/           pipeline tạo video
  scheduler/          timezone và lịch local
  server.mjs          API và static UI
  workers/            queue worker
packages/
  facebook-engine/    Mock và Meta Graph API adapters
  tts-engine/         Edge TTS worker Python
  video-engine/       FFmpeg renderer và ffprobe validation
public/               Dashboard, Visual Editor và Asset Manager
assets/branding/      Logo, ảnh nền, nhân vật, font OFL và template scene
packages/video-engine/ Renderer FFmpeg, visual template engine, asset manager
data/                  SQLite, video, cache, log, backup
tests/                 Unit và integration tests
```

## Sao lưu và khôi phục

Tắt server và worker trước khi sao lưu. Sao chép `data/database/studio.sqlite`, `data/outputs/` và `data/logs/` sang ổ đĩa an toàn. Không đưa `%LOCALAPPDATA%\AutoEnglishReelsStudio\private` vào kho mã hoặc gửi cho người khác. Khi khôi phục, chép các thư mục dữ liệu về đúng vị trí rồi chạy lại `start.bat`.

## Kiểm thử và giới hạn đã xác minh

Các bài kiểm thử unit và integration bao gồm ánh xạ từ lặp, nhiều giọng, nhiều lượt, câu dài, tốc độ đọc khác nhau, khoảng nghỉ, tiếng Việt có dấu, câu đọc lại và template văn bản tùy chỉnh. Render MP4 đầy đủ cần FFmpeg/FFprobe có trong `PATH`; kiểm tra đầu ra vẫn chạy tự động sau mỗi lần render.

Ollama chưa cài. ChatGPT plan OAuth đã kết nối trên máy này; thư viện có video tạo bởi provider này ở trạng thái sẵn sàng. Video mẫu đã publish qua Facebook Mock được tạo từ mẫu cục bộ. **LIVE FACEBOOK PUBLISH NOT YET VERIFIED** vì chưa có Page ID, token và quyền Meta thật.
