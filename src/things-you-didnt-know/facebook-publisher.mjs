import fs from 'node:fs';
import path from 'node:path';
import { GRAPH_VERSION } from '../config.mjs';
import { thingsYouDidntKnowFacebookTokenPath, thingsYouDidntKnowFacebookTokenSaved, getThingsYouDidntKnowSettings, setThingsYouDidntKnowFacebookVerification } from './settings-store.mjs';

function readToken() {
  const file = thingsYouDidntKnowFacebookTokenPath();
  if (!thingsYouDidntKnowFacebookTokenSaved()) throw new Error("Chưa lưu Page Access Token riêng cho Things You Didn't Know.");
  return fs.readFileSync(file, 'utf8').trim();
}

function validatePageId(value) {
  const id = String(value || '').trim();
  if (!/^\d{5,}$/u.test(id)) throw new Error("Facebook Page ID Things You Didn't Know không hợp lệ.");
  return id;
}

async function graph(pathname, fields = null, { upload = false, method = 'POST' } = {}) {
  const token = readToken();
  const host = upload ? 'graph-video.facebook.com' : 'graph.facebook.com';
  const url = 'https://' + host + '/' + GRAPH_VERSION + '/' + pathname.replace(/^\//u, '');
  const response = await fetch(url, fields ? {
    method, headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...fields, access_token: token }), signal: AbortSignal.timeout(30_000)
  } : { method: 'GET', headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = data.error || {};
    const failure = new Error('Meta Graph API ' + (error.code || response.status) + ': ' + (error.message || response.statusText));
    failure.code = error.code || response.status;
    failure.metaResponse = true;
    throw failure;
  }
  return data;
}

async function uploadChunk(pageId, sessionId, offset, chunk, filename) {
  const form = new FormData();
  form.set('upload_phase', 'transfer');
  form.set('upload_session_id', sessionId);
  form.set('start_offset', String(offset));
  form.set('access_token', readToken());
  form.set('video_file_chunk', new Blob([chunk], { type: 'application/octet-stream' }), filename);
  const response = await fetch('https://graph-video.facebook.com/' + GRAPH_VERSION + '/' + encodeURIComponent(pageId) + '/videos', {
    method: 'POST', body: form, signal: AbortSignal.timeout(10 * 60_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = data.error || {};
    const failure = new Error('Meta upload ' + (error.code || response.status) + ': ' + (error.message || response.statusText));
    failure.code = error.code || response.status;
    failure.metaResponse = true;
    throw failure;
  }
  return data;
}

export async function verifyThingsYouDidntKnowFacebookPage() {
  const settings = getThingsYouDidntKnowSettings();
  const pageId = validatePageId(settings.facebookPageId);
  const result = await graph(encodeURIComponent(pageId) + '?fields=id,name', null, { method: 'GET' });
  if (String(result.id) !== pageId) throw new Error("Page ID Meta trả về không khớp Page Things You Didn't Know.");
  const next = setThingsYouDidntKnowFacebookVerification({ verified: true, pageName: result.name });
  return { pageId, pageName: next.facebookPageName, verified: true };
}

export async function getThingsYouDidntKnowFacebookVideoStatus(videoId) {
  if (!videoId) throw new Error('Lịch chưa có Facebook video ID.');
  return graph(encodeURIComponent(String(videoId)) + '?fields=status,published,scheduled_publish_time,permalink_url', null, { method: 'GET' });
}

export async function scheduleThingsYouDidntKnowOnFacebook(schedule, { onUpload = async () => {}, onFinishing = async () => {} } = {}) {
  const settings = getThingsYouDidntKnowSettings();
  const pageId = validatePageId(schedule.targetPageId || settings.facebookPageId);
  if (pageId !== settings.facebookPageId || !settings.facebookPageVerified) throw new Error("Page đã cấu hình chưa được xác minh hoặc không khớp với lịch Things You Didn't Know.");
  const content = schedule.content;
  if (!content?.videoPath || !fs.existsSync(content.videoPath) || !content.durationSeconds) throw new Error('Không tìm thấy Reel hợp lệ để tải lên Facebook.');
  if (content.sourceStatus !== 'human-reviewed') throw new Error('Fact và nguồn chưa được người dùng duyệt.');
  const at = new Date(schedule.scheduledAt);
  if (!Number.isFinite(at.getTime()) || at.getTime() < Date.now() + 10 * 60_000) throw new Error('Facebook cần nhận lịch trước ít nhất 10 phút.');
  const size = fs.statSync(content.videoPath).size;
  if (size <= 0 || size > 0xffffffff) throw new Error('Kích thước video không hợp lệ để tải lên Meta.');
  const endpoint = encodeURIComponent(pageId) + '/videos';
  let upload = schedule.upload || {};
  let videoId = upload.videoId || schedule.facebookVideoId || null;
  let sessionId = upload.sessionId || null;
  let offset = Number(upload.startOffset || 0);
  let endOffset = Number(upload.endOffset || size);

  if (upload.state === 'finishing' && videoId) {
    try {
      const remote = await getThingsYouDidntKnowFacebookVideoStatus(videoId);
      const remoteTime = Number(remote.scheduled_publish_time);
      if (remote.published === false && Number.isFinite(remoteTime) && Math.abs(remoteTime * 1000 - at.getTime()) < 60_000) return { facebookVideoId: videoId, state: 'scheduled' };
    } catch { }
    const error = new Error('Meta có thể đã nhận Reel nhưng chưa xác minh được lịch; kiểm tra Planner trước khi thử lại.');
    error.facebookOutcomeUnknown = true;
    throw error;
  }

  if (!sessionId || !videoId) {
    const started = await graph(endpoint, { upload_phase: 'start', file_size: String(size) }, { upload: true });
    if (!started.video_id || !started.upload_session_id) throw new Error('Meta không trả về phiên tải Reel hợp lệ.');
    videoId = String(started.video_id);
    sessionId = String(started.upload_session_id);
    offset = Number(started.start_offset || 0);
    endOffset = Number(started.end_offset || size);
    upload = { videoId, sessionId, startOffset: offset, endOffset, state: 'uploading' };
    await onUpload(upload);
  } else {
    const status = await graph(endpoint, { upload_phase: 'status', upload_session_id: sessionId }, { upload: true });
    const remoteOffset = Number(status.start_offset);
    const remoteEnd = Number(status.end_offset);
    if (Number.isSafeInteger(remoteOffset) && Number.isSafeInteger(remoteEnd) && remoteOffset >= 0 && remoteEnd >= remoteOffset && remoteEnd <= size) {
      offset = remoteOffset;
      endOffset = remoteEnd;
    }
  }

  const handle = await fs.promises.open(content.videoPath, 'r');
  try {
    while (offset < size) {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(endOffset) || endOffset <= offset || endOffset > size) throw new Error('Meta trả về offset upload không hợp lệ.');
      const chunk = Buffer.alloc(endOffset - offset);
      const read = await handle.read(chunk, 0, chunk.length, offset);
      if (read.bytesRead !== chunk.length) throw new Error('Không đọc đủ dữ liệu Reel để tải lên Meta.');
      const transferred = await uploadChunk(pageId, sessionId, offset, chunk, path.basename(content.videoPath));
      const nextOffset = Number(transferred.start_offset);
      const nextEnd = Number(transferred.end_offset);
      if (!Number.isSafeInteger(nextOffset) || !Number.isSafeInteger(nextEnd) || nextOffset <= offset || nextEnd < nextOffset || nextEnd > size) throw new Error('Meta không xác nhận được đoạn Reel vừa tải lên.');
      offset = nextOffset;
      endOffset = nextEnd;
      upload = { videoId, sessionId, startOffset: offset, endOffset, state: 'uploading' };
      await onUpload(upload);
    }
  } finally { await handle.close(); }

  const caption = content.caption + '\\n\\n' + content.hashtags.join(' ');
  await onFinishing({ ...upload, state: 'finishing' });
  await graph(endpoint, {
    upload_phase: 'finish', upload_session_id: sessionId, title: content.title,
    description: caption, scheduled_publish_time: String(Math.floor(at.getTime() / 1000)), published: 'false'
  }, { upload: true });
  const remote = await getThingsYouDidntKnowFacebookVideoStatus(videoId);
  const remoteTime = Number(remote.scheduled_publish_time);
  if (remote.published !== false || !Number.isFinite(remoteTime) || Math.abs(remoteTime * 1000 - at.getTime()) >= 60_000) {
    const error = new Error('Meta đã nhận Reel nhưng chưa xác nhận đúng lịch đăng.');
    error.facebookOutcomeUnknown = true;
    throw error;
  }
  return { facebookVideoId: videoId, state: 'scheduled', url: remote.permalink_url || '' };
}
