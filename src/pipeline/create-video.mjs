import { insertVideo, updateVideo, log, createRandomSchedule, getSettings, getScript, getVideo, findVideoByScriptId, updateJobPayload } from '../database/db.mjs';
import { createScript } from '../ai/script-service.mjs';
import { formatCaption } from '../ai/hashtag-utils.mjs';
import { synthesizeScript } from '../tts/edge-tts.mjs';
import { synthesizeLocalAiScript } from '../tts/local-ai-tts.mjs';
import { renderVideo } from '../../packages/video-engine/render.mjs';
import fs from 'node:fs';
import path from 'node:path';

function hasRenderedFile(videoPath) {
  if (!videoPath) return false;
  try {
    const stat = fs.statSync(videoPath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export async function createVideoJob(job) {
  const settings = getSettings();
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
  if (existingVideo && hasRenderedFile(existingVideo.video_path)) {
    if (!['ready', 'scheduled', 'published', 'publish_failed'].includes(existingVideo.status)) {
      updateVideo(existingVideo.id, { status: 'ready', last_error: null });
    }
    return { videoId: existingVideo.id, scriptId, provider, videoPath: existingVideo.video_path, thumbnailPath: existingVideo.thumbnail_path, duration: Number(existingVideo.duration_seconds), recovered: true };
  }
  const videoId = existingVideo?.id || insertVideo(scriptId, 'processing');
  if (!job.payload.videoId) updateJobPayload(job.id, { videoId });
  updateVideo(videoId, { status: 'processing', last_error: null });
  log('INFO', 'SCRIPT_READY', `Kịch bản ${script.topic} hợp lệ, provider ${provider}.`, job.id);
  try {
    const onTtsProgress = (progress, detail) => log('INFO', 'TTS_PROGRESS', JSON.stringify({ videoId, progress, ...detail }), job.id);
    const audio = settings.ttsProvider === 'vieneu'
      ? await synthesizeLocalAiScript(script, videoId, { settings, onProgress: onTtsProgress })
      : await synthesizeScript(script, videoId, { onProgress: onTtsProgress });
    log('INFO', 'TTS_READY', `Đã tạo ${audio.length} đoạn đọc, thu WordBoundary và thử căn chỉnh local khi cần.`, job.id);
    const result = await renderVideo(script, videoId, audio, {
      onProgress: (progress) => log('INFO', 'RENDER_PROGRESS', JSON.stringify({ videoId, progress }), job.id),
      onTimeline: (timeline) => log('INFO', 'RENDER_TIMELINE', JSON.stringify({ videoId, timeline }), job.id),
      onAlignmentWarning: (warning) => log('WARN', 'WORD_HIGHLIGHT_ALIGNMENT', JSON.stringify({ videoId, ...warning }), job.id),
      highlightSettings: settings
    });
    // Rendering is complete once renderVideo returns a usable MP4. Persist that
    // fact before writing auxiliary manifests so a later retry cannot render it
    // again because an unrelated sidecar write failed.
    updateVideo(videoId, { status: 'ready', video_path: result.videoPath, thumbnail_path: result.thumbnailPath || null, duration_seconds: result.duration, last_error: null });
    const outputDir = path.dirname(result.videoPath);
    try {
      fs.writeFileSync(path.join(outputDir, 'script.json'), JSON.stringify(script, null, 2), 'utf8');
      fs.writeFileSync(path.join(outputDir, 'caption.txt'), formatCaption(script.caption, script.hashtags), 'utf8');
      fs.writeFileSync(path.join(outputDir, 'audio-manifest.json'), JSON.stringify(result.audioManifest, null, 2), 'utf8');
      fs.writeFileSync(path.join(outputDir, 'render-manifest.json'), JSON.stringify(result.renderManifest, null, 2), 'utf8');
    } catch (error) {
      log('WARN', 'VIDEO_SIDECAR_WRITE_FAILED', `MP4 đã render xong; không ghi được metadata phụ: ${error.message}`, job.id);
    }
    log('INFO', 'VIDEO_READY', `Video ${result.width}x${result.height}, ${result.fps}, ${result.duration.toFixed(1)} giây.`, job.id);
    if (job.payload.autoSchedule || settings.autoPublishEnabled) {
      try {
        const schedule = createRandomSchedule(videoId, settings.timezone, settings.postsPerDay);
        log('INFO', 'POST_SCHEDULED', `Đã xếp video vào lịch ${schedule.scheduledAt}.`, job.id);
      } catch (error) {
        log('ERROR', 'AUTO_SCHEDULE_FAILED', error.message, job.id);
      }
    }
    return { videoId, scriptId, provider, ...result };
  } catch (error) {
    const completedVideo = getVideo(videoId);
    if (completedVideo && hasRenderedFile(completedVideo.video_path)) {
      if (!['ready', 'scheduled', 'published', 'publish_failed'].includes(completedVideo.status)) {
        updateVideo(videoId, { status: 'ready', last_error: null });
      }
      log('WARN', 'VIDEO_POST_RENDER_STEP_FAILED', `MP4 đã render xong; giữ nguyên video và bỏ qua lỗi bước phụ: ${error.message}`, job.id);
      return {
        videoId,
        scriptId,
        provider,
        videoPath: completedVideo.video_path,
        thumbnailPath: completedVideo.thumbnail_path,
        duration: Number(completedVideo.duration_seconds),
        recovered: true
      };
    }
    updateVideo(videoId, { status: 'failed', last_error: error.message });
    log('ERROR', 'VIDEO_PIPELINE_FAILED', error.message, job.id);
    throw error;
  }
}
