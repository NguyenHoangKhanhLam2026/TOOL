import fs from 'node:fs';
import path from 'node:path';
import { GRAPH_VERSION } from '../config.mjs';
import { motPhutVoLeFacebookTokenPath, motPhutVoLeFacebookTokenSaved, setMotPhutVoLeFacebookPageVerification } from './settings-store.mjs';

function token() {
  const file = motPhutVoLeFacebookTokenPath();
  if (!motPhutVoLeFacebookTokenSaved()) throw new Error('Chưa lưu Page Access Token riêng cho Một Phút Vỡ Lẽ.');
  return fs.readFileSync(file, 'utf8').trim();
}

async function graph(pathname, fields = {}, { upload = false } = {}) {
  const accessToken = token();
  const host = upload ? 'graph-video.facebook.com' : 'graph.facebook.com';
  const response = await fetch(`https://${host}/${GRAPH_VERSION}/${pathname.replace(/^\//, '')}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...fields, access_token: accessToken }),
    signal: AbortSignal.timeout(30_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = data.error || {};
    const failure = new Error(`Meta Graph API ${error.code || response.status}: ${error.message || response.statusText}`);
    failure.code = error.code || response.status;
    throw failure;
  }
  return data;
}

async function uploadChunk(pathname, fields, chunk, fileName) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  form.set('access_token', token());
  form.set('video_file_chunk', new Blob([chunk], { type: 'application/octet-stream' }), fileName);
  const response = await fetch(`https://graph-video.facebook.com/${GRAPH_VERSION}/${pathname.replace(/^\//, '')}`, {
    method: 'POST', body: form, signal: AbortSignal.timeout(10 * 60_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = data.error || {};
    const failure = new Error(`Meta Graph API ${error.code || response.status}: ${error.message || response.statusText}`);
    failure.code = error.code || response.status;
    throw failure;
  }
  return data;
}

export async function verifyMotPhutVoLeFacebookPage(pageId) {
  const id = String(pageId || '').trim();
  if (!/^\d{5,}$/.test(id)) throw new Error('Nhập Page ID MPVL gồm ít nhất 5 chữ số.');
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(id)}?fields=id,name`, {
    headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(30_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(`Không xác minh được Page MPVL: ${data.error?.message || response.statusText || response.status}`);
  if (String(data.id) !== id) throw new Error('Page ID Meta trả về không khớp Page MPVL đã nhập.');
  setMotPhutVoLeFacebookPageVerification({ verified: true, pageName: data.name });
  return { pageId: id, pageName: data.name || '', verified: true };
}

export async function getMotPhutVoLeFacebookVideoStatus(videoId) {
  if (!videoId) throw new Error('Lịch MPVL chưa có Facebook video ID.');
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(String(videoId))}?fields=status,published,scheduled_publish_time,permalink_url`, {
    headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(30_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(`Không đọc được trạng thái video MPVL trên Meta: ${data.error?.message || response.statusText || response.status}`);
  return data;
}

export async function scheduleMotPhutVoLeOnFacebook(schedule, { pageId, onUploadSession = async () => {}, onFinishing = async () => {} } = {}) {
  const id = String(pageId || '').trim();
  if (!/^\d{5,}$/.test(id)) throw new Error('Chưa cấu hình Page ID MPVL.');
  if (!schedule?.videoPath || !fs.existsSync(schedule.videoPath)) throw new Error('Không tìm thấy video MPVL để gửi lên Facebook.');
  if (!Number.isFinite(Number(schedule.durationSeconds)) || Number(schedule.durationSeconds) <= 0) throw new Error('Video MPVL chưa có thời lượng hợp lệ.');
  const scheduledAt = new Date(schedule.scheduledAt);
  if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() + 10 * 60_000) {
    throw new Error('Facebook cần nhận lịch MPVL trước ít nhất 10 phút.');
  }
  const fileSize = fs.statSync(schedule.videoPath).size;
  if (fileSize <= 0 || fileSize > 0xffffffff) throw new Error('Kích thước video MPVL không hợp lệ để tải lên Meta.');
  const endpoint = `${encodeURIComponent(id)}/videos`;
  let videoId = schedule.facebookVideoId || null;
  let uploadSessionId = schedule.facebookUploadSessionId || null;
  let offset = Number(schedule.facebookUploadOffset || 0);
  let endOffset = Number(schedule.facebookUploadEndOffset || fileSize);

  if (schedule.facebookScheduleState === 'finishing' && videoId) {
    try {
      const remote = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(videoId)}?fields=status,published,scheduled_publish_time`, {
        headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(30_000)
      }).then((response) => response.json());
      const remoteTime = Number(remote.scheduled_publish_time);
      if (!remote.error && remote.published === false && Number.isFinite(remoteTime) && Math.abs(remoteTime * 1000 - scheduledAt.getTime()) < 60_000) {
        return { facebookVideoId: videoId, status: 'scheduled' };
      }
    } catch { }
    const error = new Error('Meta có thể đã nhận lịch nhưng chưa xác minh được trong Planner. Kiểm tra Page trước khi thử gửi lại.');
    error.facebookOutcomeUnknown = true;
    throw error;
  }

  if (!videoId || !uploadSessionId) {
    const start = await graph(endpoint, { upload_phase: 'start', file_size: String(fileSize) }, { upload: true });
    if (!start.video_id || !start.upload_session_id) throw new Error('Meta không trả về phiên tải video MPVL hợp lệ.');
    videoId = String(start.video_id);
    uploadSessionId = String(start.upload_session_id);
    offset = Number(start.start_offset ?? 0);
    endOffset = Number(start.end_offset ?? fileSize);
    await onUploadSession({ facebookVideoId: videoId, facebookUploadSessionId: uploadSessionId, facebookUploadOffset: offset,
      facebookUploadEndOffset: endOffset, facebookScheduleState: 'uploading' });
  } else {
    const progress = await graph(endpoint, { upload_phase: 'status', upload_session_id: uploadSessionId }, { upload: true });
    const remoteOffset = Number(progress.start_offset);
    const remoteEndOffset = Number(progress.end_offset);
    if (!Number.isSafeInteger(remoteOffset) || !Number.isSafeInteger(remoteEndOffset) || remoteOffset < 0 || remoteEndOffset < remoteOffset || remoteEndOffset > fileSize) {
      throw new Error('Meta không trả về vị trí tiếp tục tải video MPVL hợp lệ.');
    }
    offset = remoteOffset;
    endOffset = remoteEndOffset;
    await onUploadSession({ facebookUploadOffset: offset, facebookUploadEndOffset: endOffset, facebookScheduleState: 'uploading' });
  }

  const file = await fs.promises.open(schedule.videoPath, 'r');
  try {
    while (offset < fileSize) {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(endOffset) || offset < 0 || endOffset <= offset || endOffset > fileSize) {
        throw new Error('Meta trả về vị trí tải video MPVL không hợp lệ.');
      }
      const chunk = Buffer.alloc(endOffset - offset);
      const { bytesRead } = await file.read(chunk, 0, chunk.length, offset);
      if (bytesRead !== chunk.length) throw new Error('Không đọc đủ dữ liệu video MPVL để tải lên.');
      const transfer = await uploadChunk(endpoint, { upload_phase: 'transfer', upload_session_id: uploadSessionId, start_offset: offset }, chunk, path.basename(schedule.videoPath));
      const nextOffset = Number(transfer.start_offset);
      const nextEndOffset = Number(transfer.end_offset);
      if (!Number.isSafeInteger(nextOffset) || !Number.isSafeInteger(nextEndOffset) || nextOffset <= offset || nextEndOffset < nextOffset || nextEndOffset > fileSize) {
        throw new Error('Meta không xác nhận được chunk video MPVL vừa tải lên.');
      }
      offset = nextOffset;
      endOffset = nextEndOffset;
      await onUploadSession({ facebookUploadOffset: offset, facebookUploadEndOffset: endOffset, facebookScheduleState: 'uploading' });
    }
  } finally { await file.close(); }

  await onFinishing({ facebookScheduleState: 'finishing' });
  const description = [String(schedule.caption || '').trim(), Array.isArray(schedule.hashtags) ? schedule.hashtags.join(' ') : '']
    .filter(Boolean).join('\n\n');
  try {
    await graph(endpoint, {
      upload_phase: 'finish', upload_session_id: uploadSessionId,
      title: String(schedule.title || schedule.topic || 'Một Phút Vỡ Lẽ'), description,
      published: 'false', scheduled_publish_time: String(Math.floor(scheduledAt.getTime() / 1000))
    }, { upload: true });
  } catch (error) {
    if (!error.code) error.facebookOutcomeUnknown = true;
    throw error;
  }
  return { facebookVideoId: videoId, status: 'scheduled' };
}
