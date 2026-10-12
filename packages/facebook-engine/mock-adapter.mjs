import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class MockFacebookAdapter {
  async checkConnection() { return { connected: true, pageId: 'mock-page', pageName: 'Trang thử nghiệm (Mock)', adapter: 'mock' }; }

  async publish({ video, script }) {
    if (!video?.video_path || !script?.caption || !fs.existsSync(video.video_path) || path.extname(video.video_path).toLowerCase() !== '.mp4' || fs.statSync(video.video_path).size <= 0) {
      throw new Error('Mock publish cần tệp MP4 không rỗng và caption hợp lệ.');
    }
    const id = `mock_reel_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    return { facebookId: id, url: `mock://facebook/reels/${id}`, status: 'published', verified: true };
  }
}
