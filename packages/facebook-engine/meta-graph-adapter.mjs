import fs from 'node:fs';
import { PATHS, GRAPH_VERSION } from '../../src/config.mjs';

const tokenFile = `${PATHS.private}/facebook-page-token.txt`;

export function facebookTokenSaved() {
  return fs.existsSync(tokenFile) && fs.readFileSync(tokenFile, 'utf8').trim().length > 20;
}

export function saveFacebookToken(token) {
  if (typeof token !== 'string' || token.trim().length < 20) throw new Error('Page Access Token không hợp lệ.');
  fs.writeFileSync(tokenFile, token.trim(), { mode: 0o600 });
  try { fs.chmodSync(tokenFile, 0o600); } catch { /* Windows ACLs govern this file. */ }
}

export function clearFacebookToken() { fs.rmSync(tokenFile, { force: true }); }

function getToken() {
  if (!facebookTokenSaved()) throw new Error('Chưa lưu Facebook Page Access Token.');
  return fs.readFileSync(tokenFile, 'utf8').trim();
}

async function graph(path, form = null) {
  const token = getToken();
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path.replace(/^\//, '')}`);
  const response = await fetch(url, form ? {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...form, access_token: token }), signal: AbortSignal.timeout(30_000)
  } : { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = data.error || {};
    const err = new Error(`Meta Graph API ${error.code || response.status}: ${error.message || response.statusText}`);
    err.code = error.code || response.status;
    err.subcode = error.error_subcode;
    throw err;
  }
  return data;
}

export class MetaGraphAdapter {
  constructor(pageId) { this.pageId = String(pageId || '').trim(); }

  async checkConnection() {
    if (!/^\d{5,}$/.test(this.pageId)) throw new Error('Facebook Page ID phải là số.');
    const page = await graph(`${encodeURIComponent(this.pageId)}?fields=id,name`);
    if (String(page.id) !== this.pageId) throw new Error('Page ID trả về không khớp Page đã cấu hình.');
    return { connected: true, pageId: page.id, pageName: page.name, adapter: 'meta-graph-api' };
  }

  async publish({ video, script }) {
    if (!this.pageId) throw new Error('Chưa cấu hình Facebook Page ID.');
    const filePath = video?.video_path;
    if (!filePath || !fs.existsSync(filePath)) throw new Error('Không tìm thấy tệp video để tải lên.');
    if (Number(video.duration_seconds) < 4 || Number(video.duration_seconds) > 60) throw new Error('Reel phải dài từ 4 đến 60 giây.');
    const size = fs.statSync(filePath).size;
    if (size <= 0) throw new Error('Tệp video rỗng.');
    const start = await graph(`${encodeURIComponent(this.pageId)}/video_reels`, { upload_phase: 'start' });
    if (!start.video_id || !start.upload_url) throw new Error('Meta không trả về upload session hợp lệ.');
    if (new URL(start.upload_url).hostname !== 'rupload.facebook.com') throw new Error('Meta trả về upload host không hợp lệ.');
    const upload = await fetch(start.upload_url, {
      method: 'POST',
      headers: { authorization: `OAuth ${getToken()}`, offset: '0', file_size: String(size), 'content-type': 'application/octet-stream' },
      body: fs.createReadStream(filePath), duplex: 'half', signal: AbortSignal.timeout(10 * 60_000)
    });
    const uploadBody = await upload.json().catch(() => ({}));
    if (!upload.ok || uploadBody.error || uploadBody.success === false) throw new Error(`Meta tải Reel lên thất bại (${upload.status}).`);
    await graph(`${encodeURIComponent(this.pageId)}/video_reels`, {
      upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED',
      title: script.title, description: `${script.caption}\n\n${script.hashtags.join(' ')}`
    });
    const status = await this.#waitUntilPublished(start.video_id);
    if (!status.verified) throw new Error('Meta đã nhận lệnh đăng nhưng chưa xác minh trạng thái xuất bản.');
    return { facebookId: start.video_id, url: status.url || '', status: 'published', verified: true };
  }

  async #waitUntilPublished(videoId) {
    const deadline = Date.now() + 10 * 60_000;
    let last = null;
    while (Date.now() < deadline) {
      last = await graph(`${encodeURIComponent(videoId)}?fields=status,permalink_url`);
      const value = String(last.status?.video_status || last.status?.publishing_phase?.status || '').toLowerCase();
      if (value === 'published' || value === 'complete' || last.permalink_url) {
        return { verified: true, url: last.permalink_url || '' };
      }
      if (value === 'error' || value === 'failed') throw new Error('Meta báo trạng thái xử lý Reel thất bại.');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return { verified: false, last };
  }
}
