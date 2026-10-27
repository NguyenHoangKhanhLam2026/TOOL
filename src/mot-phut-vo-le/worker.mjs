import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMotPhutVoLeVideo, createMotPhutVoLeVideos, rerenderMotPhutVoLeVideo } from './create-video.mjs';
import { logMotPhutVoLeActivity } from './activity-log.mjs';
import {
  claimNextMotPhutVoLeJob, getMotPhutVoLeJob, recoverMotPhutVoLeJobs,
  updateMotPhutVoLeJob, updateMotPhutVoLeContent
} from './history.mjs';
import { motPhutVoLeSchedulerShouldStayAwake, processMotPhutVoLeScheduleTick } from './scheduler.mjs';

let stopping = false;

function safeActivityMessage(value) {
  return String(value || '').replace(/[\u0000-\u001f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 240);
}

function progressReporter(job) {
  const loggedBuckets = new Set();
  const activeTtsAttempts = new Map();
  const batchLabel = (progress) => Number(progress.batchTotal) > 1
    ? `Video ${progress.batchIndex || 1}/${progress.batchTotal}: ` : '';
  const contentLabel = (progress) => progress.contentId ? `Nội dung ${String(progress.contentId).slice(0, 8)}: ` : '';
  const write = (level, code, message, progress = {}) => logMotPhutVoLeActivity(level, code,
    `${batchLabel(progress)}${contentLabel(progress)}${message}`, job.id);
  const rememberBucket = (key, bucket) => {
    const id = `${key}:${bucket}`;
    if (loggedBuckets.has(id)) return false;
    loggedBuckets.add(id);
    return true;
  };

  return (progress = {}) => {
    try { updateMotPhutVoLeJob(job.id, { progress }); } catch { }
    const phase = String(progress.phase || '');
    const topic = safeActivityMessage(progress.topic);
    const duration = Number(progress.durationSeconds || progress.actualSeconds);
    const contentKey = String(progress.contentId || job.payload.contentId || 'job');

    switch (phase) {
      case 'topic-discovery':
        write('INFO', 'MOT_PHUT_VO_LE_TOPIC_DISCOVERY', `Đang tìm chủ đề mới và rà trùng lặp (lần ${progress.attempt || 1}/${progress.maxAttempts || 1}).`, progress);
        break;
      case 'script-generation':
        write('INFO', 'MOT_PHUT_VO_LE_SCRIPT_GENERATION', `Bắt đầu viết và kiểm tra kịch bản${topic ? ` cho chủ đề “${topic}”` : ''}.`, progress);
        break;
      case 'script-review-started':
        write('INFO', 'MOT_PHUT_VO_LE_SCRIPT_REVIEW_STARTED', 'Đang kiểm tra độ dài, nội dung trùng lặp và thông tin của kịch bản.', progress);
        break;
      case 'script-ready':
        write('INFO', 'MOT_PHUT_VO_LE_SCRIPT_READY', `Kịch bản đã qua kiểm tra${Number.isFinite(Number(progress.wordCount)) ? ` (${progress.wordCount} từ)` : ''}${topic ? `: “${topic}”` : ''}.`, progress);
        break;
      case 'script-revised':
        write('INFO', 'MOT_PHUT_VO_LE_SCRIPT_REVISED', `Đã điều chỉnh kịch bản để cải thiện căn chỉnh lời đọc${Number.isFinite(Number(progress.wordCount)) ? ` (${progress.wordCount} từ)` : ''}.`, progress);
        break;
      case 'vieneu-synthesis': {
        const attempt = Number(progress.attempt) || activeTtsAttempts.get(contentKey) || 1;
        if (Number.isFinite(Number(progress.progress))) {
          const raw = Number(progress.progress);
          const percent = Math.max(0, Math.min(100, Math.round(raw <= 1 ? raw * 100 : raw)));
          const bucket = Math.floor(percent / 25) * 25;
          if (bucket < 100 && rememberBucket(`tts:${contentKey}:${attempt}`, bucket)) {
            write('INFO', 'MOT_PHUT_VO_LE_TTS_PROGRESS', `VieNeu đang tạo giọng đọc: ${bucket}% (lượt ${attempt}).`, progress);
          }
        } else {
          activeTtsAttempts.set(contentKey, attempt);
          if (rememberBucket(`tts-start:${contentKey}`, attempt)) {
            write('INFO', 'MOT_PHUT_VO_LE_TTS_STARTED', `Bắt đầu tổng hợp giọng đọc tiếng Việt VieNeu (lượt ${attempt}).`, progress);
          }
        }
        break;
      }
      case 'vieneu-cache-hit':
        write('INFO', 'MOT_PHUT_VO_LE_TTS_CACHE_HIT', 'Đã dùng lại audio VieNeu đã lưu trong bộ nhớ đệm.', progress);
        break;
      case 'audio-ready':
        write('INFO', 'MOT_PHUT_VO_LE_AUDIO_READY', `Audio tiếng Việt đã sẵn sàng${Number.isFinite(duration) && duration > 0 ? ` (${duration.toFixed(1)} giây)` : ''}${progress.reused ? ' (dùng lại cache)' : ''}.`, progress);
        break;
      case 'alignment-script-revision':
        write('WARN', 'MOT_PHUT_VO_LE_ALIGNMENT_REVISION', `Đang viết lại câu để sửa căn chỉnh lời đọc (còn ${progress.unmatchedTokenCount ?? '?'} từ chưa khớp).`, progress);
        break;
      case 'local-alignment-started':
        write('INFO', 'MOT_PHUT_VO_LE_ALIGNMENT_STARTED', 'Bắt đầu căn chỉnh lời đọc tiếng Việt với audio.', progress);
        break;
      case 'local-alignment-retry':
        write('WARN', 'MOT_PHUT_VO_LE_ALIGNMENT_RETRY', `Căn chỉnh chưa đạt; đang thử lại${progress.warning ? `: ${safeActivityMessage(progress.warning)}` : '.'}`, progress);
        break;
      case 'local-alignment-complete':
        write(progress.reliable ? 'INFO' : 'WARN', 'MOT_PHUT_VO_LE_ALIGNMENT_COMPLETED', `Căn chỉnh ${progress.reliable ? 'hoàn tất' : 'chưa đầy đủ'}: ${progress.mappedTokenCount ?? 0} từ đã khớp, ${progress.unmatchedTokenCount ?? 0} từ chưa khớp.`, progress);
        break;
      case 'thumbnail-ready':
        write('INFO', 'MOT_PHUT_VO_LE_THUMBNAIL_READY', 'Đã tạo thumbnail cho video.', progress);
        break;
      case 'render-started':
        write('INFO', 'MOT_PHUT_VO_LE_RENDER_STARTED', progress.rerender ? 'Bắt đầu render lại video theo thiết kế hiện tại.' : 'Bắt đầu dựng các khung hình và hiệu ứng video.', progress);
        break;
      case 'frame-render': {
        const current = Number(progress.current);
        const total = Number(progress.total);
        if (current > 0 && total > 0) {
          const percent = Math.min(100, Math.floor(current * 100 / total));
          const bucket = Math.floor(percent / 25) * 25;
          if (bucket > 0 && bucket < 100 && rememberBucket(`frames:${contentKey}`, bucket)) {
            write('INFO', 'MOT_PHUT_VO_LE_FRAME_PROGRESS', `Đang dựng khung hình: ${bucket}%.`, progress);
          }
        }
        break;
      }
      case 'ffmpeg-render': {
        const raw = Number(progress.progress);
        if (Number.isFinite(raw)) {
          const percent = Math.max(0, Math.min(100, Math.round(raw <= 1 ? raw * 100 : raw)));
          if (percent === 0) write('INFO', 'MOT_PHUT_VO_LE_ENCODING_STARTED', 'Bắt đầu mã hóa video MP4.', progress);
          else if (percent === 100) write('INFO', 'MOT_PHUT_VO_LE_ENCODING_COMPLETED', 'Đã mã hóa xong video MP4.', progress);
          else {
            const bucket = Math.floor(percent / 25) * 25;
            if (bucket > 0 && bucket < 100 && rememberBucket(`encode:${contentKey}`, bucket)) {
              write('INFO', 'MOT_PHUT_VO_LE_ENCODING_PROGRESS', `Đang mã hóa video MP4: ${bucket}%.`, progress);
            }
          }
        }
        break;
      }
      case 'script-updated':
        write('INFO', 'MOT_PHUT_VO_LE_SCRIPT_UPDATED', 'Đã lưu kịch bản chỉnh sửa; đang tạo lại audio và video.', progress);
        break;
      case 'voice-updated':
        write('INFO', 'MOT_PHUT_VO_LE_VOICE_UPDATED', 'Đang cập nhật giọng đọc và dựng lại video.', progress);
        break;
      case 'complete':
        write('INFO', 'MOT_PHUT_VO_LE_VIDEO_READY', `Video đã render hoàn tất${Number.isFinite(duration) && duration > 0 ? ` (${duration.toFixed(1)} giây)` : ''}.`, progress);
        break;
      default:
        break;
    }
  };
}

export async function processMotPhutVoLeJob(job) {
  const report = progressReporter(job);
  try {
    updateMotPhutVoLeJob(job.id, { status: 'running', progress: { phase: 'started', at: new Date().toISOString() } });
    logMotPhutVoLeActivity('INFO', 'MOT_PHUT_VO_LE_JOB_STARTED', job.type === 'rerender'
      ? `Bắt đầu render lại video MPVL ${String(job.payload.contentId || '').slice(0, 8)}.`
      : `Bắt đầu quy trình tạo ${Math.max(1, Number(job.payload.count) || 1)} video MPVL${job.payload.autoGenerated ? ' tự động' : ''}.`, job.id);
    let result;
    if (job.type === 'create') result = Number(job.payload.count) > 1
      ? await createMotPhutVoLeVideos({ ...job.payload, onProgress: report })
      : await createMotPhutVoLeVideo({ ...job.payload, onProgress: report });
    else if (job.type === 'rerender') result = await rerenderMotPhutVoLeVideo(job.payload.contentId, {
      design: job.payload.design, voice: job.payload.voice, speed: job.payload.speed, scriptText: job.payload.scriptText, onProgress: report
    });
    else throw new Error(`Loại job Một Phút Vỡ Lẽ không hỗ trợ: ${job.type}`);
    const latest = getMotPhutVoLeJob(job.id);
    const lastResult = Array.isArray(result) ? result.at(-1) : result;
    updateMotPhutVoLeJob(job.id, { status: latest?.cancelRequested ? 'cancelled' : 'complete', progress: { phase: latest?.cancelRequested ? 'cancelled-after-current-step' : 'complete', contentId: lastResult?.id || job.payload.contentId || null } });
    logMotPhutVoLeActivity(latest?.cancelRequested ? 'WARN' : 'INFO', latest?.cancelRequested ? 'MOT_PHUT_VO_LE_JOB_CANCELLED' : 'MOT_PHUT_VO_LE_JOB_COMPLETED',
      latest?.cancelRequested ? 'Job MPVL đã dừng sau khi hoàn tất bước đang chạy.'
        : `Quy trình MPVL đã hoàn tất${Array.isArray(result) ? ` (${result.length} video)` : ''}.`, job.id);
    return result;
  } catch (error) {
    const latest = getMotPhutVoLeJob(job.id);
    const cancelled = latest?.cancelRequested === true;
    if (job.type === 'rerender' && job.payload.contentId) {
      try { updateMotPhutVoLeContent(job.payload.contentId, { status: 'failed', lastError: error.message }); } catch { }
    }
    updateMotPhutVoLeJob(job.id, { status: cancelled ? 'cancelled' : 'failed', lastError: error.message, progress: { phase: cancelled ? 'cancelled' : 'failed', errorCode: error.code || null } });
    logMotPhutVoLeActivity(cancelled ? 'WARN' : 'ERROR', cancelled ? 'MOT_PHUT_VO_LE_JOB_CANCELLED' : 'MOT_PHUT_VO_LE_JOB_FAILED',
      cancelled ? 'Job MPVL đã được hủy.' : `Quy trình MPVL thất bại${error.code ? ` (${error.code})` : ''}: ${safeActivityMessage(error.message) || 'Lỗi không rõ.'}`, job.id);
    throw error;
  }
}

export async function runMotPhutVoLeWorker({ pollIntervalMs = 5000, idleExitMs = 0, onError = console.error } = {}) {
  recoverMotPhutVoLeJobs();
  let idleSince = Date.now();
  while (!stopping) {
    try {
      const job = claimNextMotPhutVoLeJob();
      if (job) {
        idleSince = Date.now();
        try { await processMotPhutVoLeJob(job); }
        catch (error) { onError(error); }
        try { await processMotPhutVoLeScheduleTick({ onError }); }
        catch (error) { onError(error); }
        continue;
      }
      await processMotPhutVoLeScheduleTick({ onError });
    } catch (error) { onError(error); }
    if (Number(idleExitMs) > 0 && Date.now() - idleSince >= Number(idleExitMs) && !motPhutVoLeSchedulerShouldStayAwake()) break;
    await new Promise((resolve) => setTimeout(resolve, Math.max(1000, Number(pollIntervalMs) || 5000)));
  }
}

function stop() { stopping = true; }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const idleExitMs = Math.max(0, Number(process.env.MOT_PHUT_VO_LE_WORKER_IDLE_EXIT_MS) || 0);
  runMotPhutVoLeWorker({ idleExitMs }).catch((error) => { console.error(error); process.exitCode = 1; });
}
