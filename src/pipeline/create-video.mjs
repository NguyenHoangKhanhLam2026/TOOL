import { insertVideo, updateVideo, log, createSchedule, listSchedules, getSettings, getScript, getVideo, findVideoByScriptId, updateJobPayload } from '../database/db.mjs';
import { createScript } from '../ai/script-service.mjs';
import { synthesizeScript } from '../tts/edge-tts.mjs';
import { renderVideo } from '../../packages/video-engine/render.mjs';
import { nextScheduledTime } from '../scheduler/time.mjs';
import fs from 'node:fs';
import path from 'node:path';

export async function createVideoJob(job) {
  let scriptId = job.payload.scriptId;
  let provider = job.payload.provider;
  let script;
  if (scriptId) {
    script = getScript(scriptId);
    if (!script) throw new Error('Kịch bản đã lưu cho job không còn tồn tại.');
    provider ||= script.provider;
  } else {
    const generated = await createScript(job.payload.topicId || null, { allowLocalTemplate: Boolean(job.payload.allowLocalTemplate) });
    ({ scriptId, provider, script } = generated);
    updateJobPayload(job.id, { scriptId, provider });
  }

  let existingVideo = job.payload.videoId ? getVideo(job.payload.videoId) : findVideoByScriptId(scriptId);
  if (job.payload.forceRender && !job.payload.videoId) existingVideo = null;
  if (existingVideo && ['ready', 'scheduled', 'published'].includes(existingVideo.status) && existingVideo.video_path && fs.existsSync(existingVideo.video_path)) {
    return { videoId: existingVideo.id, scriptId, provider, videoPath: existingVideo.video_path, thumbnailPath: existingVideo.thumbnail_path, duration: Number(existingVideo.duration_seconds), recovered: true };
  }
  const videoId = existingVideo?.id || insertVideo(scriptId, 'processing');
  if (!job.payload.videoId) updateJobPayload(job.id, { videoId });
  updateVideo(videoId, { status: 'processing', last_error: null });
  log('INFO', 'SCRIPT_READY', `Kịch bản ${script.topic} hợp lệ, provider ${provider}.`, job.id);
  try {
    const audio = await synthesizeScript(script, videoId, { onProgress: (progress, detail) => log('INFO', 'TTS_PROGRESS', JSON.stringify({ videoId, progress, ...detail }), job.id) });
    log('INFO', 'TTS_READY', 'Đã tạo đủ 6 đoạn đọc và kiểm tra kích thước tệp.', job.id);
    const result = await renderVideo(script, videoId, audio, {
      onProgress: (progress) => log('INFO', 'RENDER_PROGRESS', JSON.stringify({ videoId, progress }), job.id),
      onTimeline: (timeline) => log('INFO', 'RENDER_TIMELINE', JSON.stringify({ videoId, timeline }), job.id)
    });
    const outputDir = path.dirname(result.videoPath);
    fs.writeFileSync(path.join(outputDir, 'script.json'), JSON.stringify(script, null, 2), 'utf8');
    fs.writeFileSync(path.join(outputDir, 'caption.txt'), `${script.caption}\n\n${script.hashtags.join(' ')}`, 'utf8');
    fs.writeFileSync(path.join(outputDir, 'audio-manifest.json'), JSON.stringify(result.audioManifest, null, 2), 'utf8');
    fs.writeFileSync(path.join(outputDir, 'render-manifest.json'), JSON.stringify(result.renderManifest, null, 2), 'utf8');
    updateVideo(videoId, { status: 'ready', video_path: result.videoPath, thumbnail_path: result.thumbnailPath, duration_seconds: result.duration, last_error: null });
    log('INFO', 'VIDEO_READY', `Video ${result.width}x${result.height}, ${result.fps}, ${result.duration.toFixed(1)} giây.`, job.id);
    const settings = getSettings();
    if (job.payload.autoSchedule || settings.autoPublishEnabled) {
      const schedules = listSchedules().filter((item) => item.status === 'scheduled' || item.status === 'publishing');
      const last = schedules.reduce((best, item) => !best || item.scheduled_at > best ? item.scheduled_at : best, null);
      const scheduledAt = nextScheduledTime(last ? new Date(last) : new Date(), settings.postTime, settings.timezone, settings.postsPerDay).toISOString();
      createSchedule(videoId, scheduledAt);
      log('INFO', 'POST_SCHEDULED', `Đã xếp video vào lịch ${scheduledAt}.`, job.id);
    }
    return { videoId, scriptId, provider, ...result };
  } catch (error) {
    updateVideo(videoId, { status: 'failed', last_error: error.message });
    log('ERROR', 'VIDEO_PIPELINE_FAILED', error.message, job.id);
    throw error;
  }
}
