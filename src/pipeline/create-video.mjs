import { insertVideo, updateVideo, log, getSettings, getScript, getVideo, findVideoByScriptId, updateJobPayload } from '../database/db.mjs';
import { createScript, reviewChineseScript } from '../ai/script-service.mjs';
import { validateScript } from '../ai/validator.mjs';
import { validateChineseCaption } from '../ai/caption-service.mjs';
import { formatCaption } from '../ai/hashtag-utils.mjs';
import { synthesizeLocalAiScript } from '../tts/local-ai-tts.mjs';
import { PATHS } from '../config.mjs';
import { resolveBackgroundEffectDefaults, selectRenderHighlightSettings } from './background-effect-routing.mjs';
import { assertChineseRenderQuality, renderVideo } from '../../packages/video-engine/render.mjs';
import { normalizeBackgroundEffect, normalizeBackgroundEffectDensity, normalizeBackgroundEffectSpeed, normalizeBackgroundEffectOpacity } from '../../packages/video-engine/background-effects.mjs';
import { createSpeechSegments } from '../../packages/audio-highlight/highlight-engine.mjs';
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

function videoBackgroundEffectConfig(source, fallback) {
  const value = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  return {
    backgroundEffect: normalizeBackgroundEffect(value.backgroundEffect ?? fallback.backgroundEffect),
    backgroundEffectDensity: normalizeBackgroundEffectDensity(value.backgroundEffectDensity ?? fallback.backgroundEffectDensity),
    backgroundEffectSpeed: normalizeBackgroundEffectSpeed(value.backgroundEffectSpeed ?? fallback.backgroundEffectSpeed),
    backgroundEffectOpacity: normalizeBackgroundEffectOpacity(value.backgroundEffectOpacity ?? fallback.backgroundEffectOpacity)
  };
}

function loadBackgroundOnlyRenderContext(videoId, script) {
  const outputDir = path.resolve(PATHS.output, videoId);
  const audioManifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'audio-manifest.json'), 'utf8'));
  const renderManifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'render-manifest.json'), 'utf8'));
  const highlightSettings = renderManifest?.highlightSettings;
  const template = renderManifest?.template;
  if (!Array.isArray(audioManifest) || !audioManifest.length || !highlightSettings || typeof highlightSettings !== 'object' || !template?.canvas || !Array.isArray(template.layers)) {
    throw new Error('Không tìm thấy đủ audio, căn chỉnh hoặc mẫu bố cục gốc để chỉ đổi hiệu ứng nền an toàn.');
  }
  const tempDir = path.resolve(PATHS.temporary, videoId);
  const speechById = new Map(createSpeechSegments(script, highlightSettings).map((segment) => [segment.segmentId, segment]));
  const audio = audioManifest.map((item) => {
    const segment = speechById.get(String(item.segmentId || ''));
    const audioPath = path.resolve(String(item.audioPath || ''));
    if (!segment || path.dirname(audioPath) === audioPath || !audioPath.startsWith(`${tempDir}${path.sep}`) || !fs.existsSync(audioPath) || !fs.statSync(audioPath).isFile()) {
      throw new Error('Thiếu tệp giọng đọc hoặc dữ liệu căn chỉnh cần để giữ nguyên âm thanh khi đổi nền.');
    }
    return { ...segment, ...item, path: audioPath, audioPath };
  });
  return { audio, highlightSettings, template };
}

function backgroundEffectOutputName(jobId) {
  const safeJobId = String(jobId || '').replace(/[^\w-]/gu, '');
  return `background-${safeJobId || 'render'}.mp4`;
}

export async function createVideoJob(job) {
  const settings = getSettings();
  let scriptId = job.payload.scriptId;
  let provider = job.payload.provider;
  let script;
  let loadedChineseScript = false;
  if (scriptId) {
    script = getScript(scriptId);
    if (!script) throw new Error('Kịch bản đã lưu cho job không còn tồn tại.');
    provider ||= script.provider;
    loadedChineseScript = script.contentLanguage === 'zh';
  } else {
    const requestedLanguage = job.payload.contentLanguage || settings.contentLanguage || 'en';
    const generated = await createScript(requestedLanguage === 'ja' ? null : job.payload.topicId || null, {
      contentLanguage: requestedLanguage,
      ...(['en', 'zh'].includes(job.payload.contentLanguage) && job.payload.presentationStyle ? { presentationStyle: job.payload.presentationStyle } : {})
    });
    ({ scriptId, provider, script } = generated);
    updateJobPayload(job.id, { scriptId, provider });
  }

  let existingVideo = job.payload.videoId ? getVideo(job.payload.videoId) : findVideoByScriptId(scriptId);
  if (job.payload.forceRender && !job.payload.videoId) existingVideo = null;
  if (existingVideo && hasRenderedFile(existingVideo.video_path) && !job.payload.forceRender) {
    if (!['ready', 'scheduled', 'published', 'publish_failed'].includes(existingVideo.status)) {
      updateVideo(existingVideo.id, { status: 'ready', last_error: null });
    }
    return { videoId: existingVideo.id, scriptId, provider, videoPath: existingVideo.video_path, thumbnailPath: existingVideo.thumbnail_path, duration: Number(existingVideo.duration_seconds), recovered: true };
  }
  if (loadedChineseScript && !job.payload.backgroundEffectOnly) {
    script = validateScript(script, { contentLanguage: 'zh', requireChineseScenes: false });
    const captionBody = String(script.caption || '')
      .replace(/#[\p{L}\p{N}_]+/gu, '')
      .replace(/[ \t]+\n/gu, '\n')
      .replace(/\n{3,}/gu, '\n\n')
      .trim();
    const captionIssue = validateChineseCaption(captionBody);
    if (captionIssue) throw new Error(`Kịch bản tiếng Trung đã lưu không qua kiểm tra caption trước khi render: ${captionIssue}`);
    script.caption = captionBody;
    await reviewChineseScript(script);
  }
  const videoId = existingVideo?.id || insertVideo(scriptId, 'processing');
  const backgroundEffectDefaults = resolveBackgroundEffectDefaults(settings, script.contentLanguage);
  const backgroundEffectConfig = videoBackgroundEffectConfig(
    job.payload.backgroundEffectConfig || existingVideo?.backgroundEffectConfig,
    backgroundEffectDefaults
  );
  if (!job.payload.videoId) updateJobPayload(job.id, { videoId });
  updateVideo(videoId, {
    status: 'processing',
    last_error: null,
    ...(!job.payload.backgroundEffectOnly ? { background_effect_json: JSON.stringify(backgroundEffectConfig) } : {})
  });
  log('INFO', 'SCRIPT_READY', `Kịch bản ${script.topic} hợp lệ, provider ${provider}.`, job.id);
  try {
    const backgroundOnlyContext = job.payload.backgroundEffectOnly
      ? loadBackgroundOnlyRenderContext(videoId, script)
      : null;
    const onTtsProgress = (progress, detail) => log('INFO', 'TTS_PROGRESS', JSON.stringify({ videoId, progress, ...detail }), job.id);
    const contentLanguage = script.contentLanguage || 'en';
    const languageProvider = { en: 'vieneu', ja: 'vieneu-sbv2', zh: 'vieneu-cosyvoice3' };
    const expectedTtsProvider = languageProvider[contentLanguage] || 'vieneu';
    const requestedTtsProvider = job.payload.ttsProvider || settings.ttsProvider;
    const ttsProvider = requestedTtsProvider === expectedTtsProvider ? requestedTtsProvider : expectedTtsProvider;
    const renderSettings = backgroundOnlyContext
      ? { ...backgroundOnlyContext.highlightSettings, ...backgroundEffectConfig }
      : { ...settings, ...backgroundEffectConfig, ttsProvider, contentLanguage: script.contentLanguage || 'en' };
    // Legacy top-level effect values mirror EN. Keep that path unchanged while
    // other languages receive the effect profile resolved for their own script.
    const selectedHighlightSettings = selectRenderHighlightSettings(contentLanguage, settings, renderSettings, Boolean(backgroundOnlyContext));
    const renderHighlightSettings = contentLanguage === 'ja'
      ? { ...selectedHighlightSettings, highlightEnabled: settings.japaneseHighlightEnabled === true }
      : selectedHighlightSettings;
    const audio = backgroundOnlyContext?.audio || await synthesizeLocalAiScript(script, videoId, { settings: renderSettings, provider: ttsProvider, onProgress: onTtsProgress });
    log('INFO', 'TTS_READY', backgroundOnlyContext
      ? `Đã khôi phục ${audio.length} đoạn giọng đọc và căn chỉnh hiện có để chỉ render lại nền.`
      : `Đã tạo ${audio.length} đoạn đọc, thu WordBoundary và thử căn chỉnh local khi cần.`, job.id);
    const result = await renderVideo(script, videoId, audio, {
      onProgress: (progress) => log('INFO', 'RENDER_PROGRESS', JSON.stringify({ videoId, progress }), job.id),
      onTimeline: (timeline) => log('INFO', 'RENDER_TIMELINE', JSON.stringify({ videoId, timeline }), job.id),
      onAlignmentWarning: (warning) => log('WARN', 'WORD_HIGHLIGHT_ALIGNMENT', JSON.stringify({ videoId, ...warning }), job.id),
      highlightSettings: renderHighlightSettings,
      ...(backgroundOnlyContext ? {
        templateSnapshot: backgroundOnlyContext.template,
        outputFileName: backgroundEffectOutputName(job.id)
      } : {})
    });
    assertChineseRenderQuality(script, result);
    // Rendering is complete once renderVideo returns a usable MP4. Persist that
    // fact before writing auxiliary manifests so a later retry cannot render it
    // again because an unrelated sidecar write failed.
    updateVideo(videoId, {
      status: 'ready', video_path: result.videoPath,
      thumbnail_path: result.thumbnailPath || (backgroundOnlyContext ? existingVideo?.thumbnail_path || null : null),
      duration_seconds: result.duration, last_error: null,
      background_effect_json: JSON.stringify(backgroundEffectConfig),
      ...(backgroundOnlyContext ? { review_status: 'pending' } : {})
    });
    const outputDir = path.dirname(result.videoPath);
    try {
      fs.writeFileSync(path.join(outputDir, 'script.json'), JSON.stringify(script, null, 2), 'utf8');
      const preserveJapaneseTags = script.contentLanguage === 'ja';
      fs.writeFileSync(path.join(outputDir, 'caption.txt'), formatCaption(script.caption, script.hashtags, script.contentLanguage || 'en', { preserveJapaneseTags }), 'utf8');
      fs.writeFileSync(path.join(outputDir, 'audio-manifest.json'), JSON.stringify(result.audioManifest, null, 2), 'utf8');
      fs.writeFileSync(path.join(outputDir, 'render-manifest.json'), JSON.stringify(result.renderManifest, null, 2), 'utf8');
    } catch (error) {
      log('WARN', 'VIDEO_SIDECAR_WRITE_FAILED', `MP4 đã render xong; không ghi được metadata phụ: ${error.message}`, job.id);
    }
    if (backgroundOnlyContext && existingVideo?.video_path) {
      const previousPath = path.resolve(existingVideo.video_path);
      const safeVideoOutputDir = path.resolve(PATHS.output, videoId);
      if (path.dirname(previousPath) === safeVideoOutputDir && previousPath !== path.resolve(result.videoPath)) {
        try { fs.rmSync(previousPath, { force: true }); }
        catch (error) { log('WARN', 'VIDEO_OLD_RENDER_DELETE_FAILED', `Video mới đã render xong nhưng không xóa được bản MP4 cũ: ${error.message}`, job.id); }
      }
    }
    log('INFO', 'VIDEO_READY', `Video ${result.width}x${result.height}, ${result.fps}, ${result.duration.toFixed(1)} giây.`, job.id);
    log('INFO', 'VIDEO_AWAITING_REVIEW', `Video ${videoId} rendered and awaits approval before scheduling.`, job.id);
    return { videoId, scriptId, provider, ...result };
  } catch (error) {
    const completedVideo = getVideo(videoId);
    if (job.payload.backgroundEffectOnly) {
      const stagedPath = path.join(PATHS.output, videoId, backgroundEffectOutputName(job.id));
      if (completedVideo && path.resolve(completedVideo.video_path || '') === path.resolve(stagedPath) && hasRenderedFile(stagedPath)) {
        updateVideo(videoId, { status: 'ready', last_error: null });
        log('WARN', 'BACKGROUND_EFFECT_RENDER_COMPLETE_WITH_FINALIZATION_ERROR', `Video mới đã render xong; bỏ qua lỗi bước cuối và giữ nguyên bản mới: ${error.message}`, job.id);
        return {
          videoId, scriptId, provider, videoPath: stagedPath,
          thumbnailPath: completedVideo.thumbnail_path,
          duration: Number(completedVideo.duration_seconds), recovered: true
        };
      }
      try { fs.rmSync(stagedPath, { force: true }); } catch { /* Keep the prior render available if cleanup is blocked. */ }
      if (completedVideo && hasRenderedFile(completedVideo.video_path)) {
        updateVideo(videoId, { status: 'ready', last_error: null });
        log('WARN', 'BACKGROUND_EFFECT_RENDER_FAILED_OLD_VIDEO_KEPT', `Không áp dụng được hiệu ứng mới; giữ nguyên video và âm thanh hiện có: ${error.message}`, job.id);
      } else {
        updateVideo(videoId, { status: 'failed', last_error: error.message });
      }
      log('ERROR', 'VIDEO_PIPELINE_FAILED', error.message, job.id);
      throw error;
    }
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
