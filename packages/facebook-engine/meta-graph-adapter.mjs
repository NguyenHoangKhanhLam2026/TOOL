import fs from 'node:fs';
import { PATHS, GRAPH_VERSION } from '../../src/config.mjs';
import { formatCaption } from '../../src/ai/hashtag-utils.mjs';

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

async function graph(path, form = null, host = 'graph.facebook.com') {
  const token = getToken();
  const url = new URL(`https://${host}/${GRAPH_VERSION}/${path.replace(/^\//, '')}`);
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

async function uploadVideoChunk(path, fields, fileName, chunk) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  form.set('access_token', getToken());
  form.set('video_file_chunk', new Blob([chunk], { type: 'application/octet-stream' }), fileName);
  const response = await fetch(`https://graph-video.facebook.com/${GRAPH_VERSION}/${path.replace(/^\//, '')}`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(10 * 60_000)
  });
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
    if (!Number.isFinite(Number(video.duration_seconds)) || Number(video.duration_seconds) <= 0) throw new Error('Video chưa có thời lượng hợp lệ.');
    const size = fs.statSync(filePath).size;
    if (size <= 0) throw new Error('Tệp video rỗng.');
    if (size > 0xffffffff) throw new Error('Video vượt quá giới hạn dung lượng upload của Meta.');
    const endpoint = `${encodeURIComponent(this.pageId)}/videos`;
    const uploadHost = 'graph-video.facebook.com';
    const start = await graph(endpoint, { upload_phase: 'start', file_size: String(size) }, uploadHost);
    if (!start.video_id || !start.upload_session_id) throw new Error('Meta không trả về phiên upload video hợp lệ.');

    const file = await fs.promises.open(filePath, 'r');
    try {
      let offset = Number(start.start_offset ?? 0);
      let endOffset = Number(start.end_offset ?? size);
      while (!start.skip_upload && offset < size) {
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(endOffset) || offset < 0 || endOffset <= offset || endOffset > size) {
          throw new Error('Meta trả về vị trí upload video không hợp lệ.');
        }
        const chunk = Buffer.alloc(endOffset - offset);
        const { bytesRead } = await file.read(chunk, 0, chunk.length, offset);
        if (bytesRead !== chunk.length) throw new Error('Không đọc đủ dữ liệu video để upload.');
        const transfer = await uploadVideoChunk(endpoint, {
          upload_phase: 'transfer', upload_session_id: start.upload_session_id, start_offset: offset
        }, filePath.split(/[\\/]/).at(-1), chunk);
        const nextOffset = Number(transfer.start_offset);
        const nextEndOffset = Number(transfer.end_offset);
        if (!Number.isSafeInteger(nextOffset) || !Number.isSafeInteger(nextEndOffset) || nextOffset <= offset || nextEndOffset < nextOffset || nextEndOffset > size) {
          throw new Error('Meta không xác nhận được chunk video vừa tải lên.');
        }
        offset = nextOffset;
        endOffset = nextEndOffset;
      }
    } finally {
      await file.close();
    }

    const finish = await graph(endpoint, {
      upload_phase: 'finish', upload_session_id: start.upload_session_id,
      title: script.title, description: formatCaption(script.caption, script.hashtags), published: 'true'
    }, uploadHost);
    const videoId = String(finish.video_id || finish.id || start.video_id);
    const status = await this.#waitUntilPublished(videoId);
    if (!status.verified) throw new Error('Meta đã nhận lệnh đăng nhưng chưa xác minh trạng thái xuất bản.');
    return { facebookId: videoId, url: status.url || '', status: 'published', verified: true };
  }

  async #waitUntilPublished(videoId) {
    const deadline = Date.now() + 10 * 60_000;
    let last = null;
    while (Date.now() < deadline) {
      last = await graph(`${encodeURIComponent(videoId)}?fields=status,published,permalink_url`);
      const value = String(last.status?.video_status || last.status?.publishing_phase?.status || '').toLowerCase();
      const publishPhase = String(last.status?.publishing_phase?.status || '').toLowerCase();
      if (last.published === true || value === 'published' || value === 'complete' || publishPhase === 'complete' || Boolean(last.permalink_url)) {
        return { verified: true, url: last.permalink_url || '' };
      }
      if (['error', 'failed'].includes(value) || ['error', 'failed'].includes(publishPhase)) throw new Error('Meta báo trường video Facebook thất bại.');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return { verified: false, last };
  }
}
