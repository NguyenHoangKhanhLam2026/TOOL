const port = Number(process.env.APP_PORT || 3001);
const url = `http://127.0.0.1:${port}/api/system`;
const deadline = Date.now() + 30_000;
let lastError = 'server chưa phản hồi';

while (Date.now() < deadline) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
    if (response.ok) {
      const status = await response.json().catch(() => null);
      const missingTools = ['ffmpeg', 'ffprobe'].filter((tool) => !status?.tools?.[tool]);
      console.log(`Ứng dụng đã phản hồi tại http://127.0.0.1:${port}`);
      if (missingTools.length) {
        const causes = missingTools.map((tool) => `${tool}: ${status?.tools?.errors?.[tool] || 'chưa sẵn sàng'}`).join(', ');
        console.warn(`API đã lên nhưng công cụ xử lý video chưa sẵn sàng (${causes}). Chạy start.bat trong phiên Windows thông thường.`);
      }
      process.exit(0);
    }
    lastError = `HTTP ${response.status}`;
  } catch (error) {
    lastError = error.cause?.code || error.message;
  }
  await new Promise((resolve) => setTimeout(resolve, 750));
}

console.error(`Không khởi động được ứng dụng tại cổng ${port} sau 30 giây (${lastError}). Xem data\logs\app-supervisor.log và server-supervisor.err.log.`);
process.exit(1);
