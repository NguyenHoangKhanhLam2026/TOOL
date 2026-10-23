import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FFMPEG_BIN, FFPROBE_BIN, ROOT, PATHS } from '../../src/config.mjs';
import { describeSpawnError } from '../../src/utils/process-errors.mjs';
import {
  getTemplateAssetVersions, rasterizeScene, readVisualTemplate
} from './visual-template-engine.mjs';
import { normalizeBackgroundEffect, normalizeBackgroundEffectDensity, normalizeBackgroundEffectSpeed, normalizeBackgroundEffectOpacity, renderBackgroundEffectMarkup } from './background-effects.mjs';
import {
  DEFAULT_HIGHLIGHT_SETTINGS, buildAudioTimeline, buildHighlightIntervals, normalizeLanguage
} from '../audio-highlight/highlight-engine.mjs';

const { default: sharp } = await import('sharp');
const OUTPUT_FRAME_RATE = 30;

export function filterChineseCtaAudioFiles(script, audioFiles) {
  if (script?.contentLanguage !== 'zh') return audioFiles;
  const ctaSegmentIds = new Set((Array.isArray(script.speechSegments) ? script.speechSegments : [])
    .filter((segment) => segment.state === 'cta' || segment.target?.layerId === 'cta' || segment.segmentId === 'zh-cta-vi')
    .flatMap((segment) => [segment.segmentId, segment.id].filter(Boolean).map(String)));
  return (Array.isArray(audioFiles) ? audioFiles : []).filter((item) => item.state !== 'cta'
    && item.target?.layerId !== 'cta'
    && !ctaSegmentIds.has(String(item.segmentId || item.id || ''))
    && String(item.segmentId || item.id || '') !== 'zh-cta-vi');
}

export function filterJapaneseCtaAudioFiles(script, audioFiles) {
  if (script?.contentLanguage !== 'ja') return audioFiles;
  const ctaSegmentIds = new Set((Array.isArray(script.speechSegments) ? script.speechSegments : [])
    .filter((segment) => segment.state === 'cta' || segment.target?.layerId === 'cta')
    .flatMap((segment) => [segment.segmentId, segment.id].filter(Boolean).map(String)));
  return audioFiles.filter((item) => item.state !== 'cta'
    && item.target?.layerId !== 'cta'
    && !ctaSegmentIds.has(String(item.segmentId || item.id || '')));
}

export function assertChineseRenderQuality(script, result) {
  if (script?.contentLanguage !== 'zh') return result;
  const timeline = result?.renderManifest?.timeline;
  const audioManifest = result?.audioManifest;
  if (!Array.isArray(timeline) || !Array.isArray(audioManifest)) {
    throw new Error('Không xác minh được timeline audio/video tiếng Trung sau render.');
  }
  const ctaInTimeline = timeline.some((item) => item.state === 'cta'
    && (item.type === 'speech' || Number(item.end) - Number(item.start) > 0.0001));
  if (ctaInTimeline || audioManifest.some((item) => item.segmentId === 'zh-cta-vi')) {
    throw new Error('Timeline render tiếng Trung vẫn chứa đoạn kêu gọi theo dõi.');
  }
  const expectedSegments = (Array.isArray(script.speechSegments) ? script.speechSegments : [])
    .filter((item) => item.state !== 'cta' && item.target?.layerId !== 'cta' && item.segmentId !== 'zh-cta-vi');
  const expectedIds = expectedSegments.map((item) => String(item.segmentId || item.id || ''));
  const timelineSpeech = timeline.filter((item) => item.type === 'speech');
  const timelineIds = timelineSpeech.map((item) => String(item.segmentId || ''));
  const audioIds = audioManifest.map((item) => String(item.segmentId || ''));
  const audioContentMismatch = expectedSegments.some((segment, index) =>
    String(audioManifest[index]?.text || '').trim() !== String(segment.text || '').trim()
      || normalizeLanguage(audioManifest[index]?.language) !== normalizeLanguage(segment.language));
  if (!expectedIds.length || expectedIds.some((id) => !id)
    || expectedIds.length !== timelineIds.length || expectedIds.some((id, index) => id !== timelineIds[index])
    || expectedIds.length !== audioIds.length || expectedIds.some((id, index) => id !== audioIds[index])
    || audioContentMismatch) {
    throw new Error('Nội dung, ngôn ngữ hoặc thứ tự các đoạn voice tiếng Trung không khớp kịch bản đã kiểm định.');
  }
  const lastSpeech = timelineSpeech.at(-1);
  const videoDuration = Number(result.duration ?? result.renderManifest.durationSeconds);
  const sync = result.renderManifest.synchronization;
  if (!lastSpeech || !Number.isFinite(videoDuration) || !Number.isFinite(Number(lastSpeech.end))
    || Math.abs(videoDuration - Number(lastSpeech.end)) > 0.09) {
    throw new Error('Video tiếng Trung còn phần đuôi sau khi voice nội dung kết thúc.');
  }
  if (sync?.checked !== true || !Number.isFinite(Number(sync.driftSeconds)) || Math.abs(Number(sync.driftSeconds)) > 0.09) {
    throw new Error('Không xác minh được đồng bộ audio/video tiếng Trung sau render.');
  }
  return result;
}
const BACKGROUND_EFFECT_FRAME_SECONDS = 1 / OUTPUT_FRAME_RATE;

function alignUpToFrame(seconds, frameRate = OUTPUT_FRAME_RATE) {
  const frame = Math.ceil(Number(seconds) * frameRate - 1e-7);
  return frame / frameRate;
}

async function createCrossfadeFrames(previousPath, nextPath, duration, outputDir, prefix) {
  const frameCount = Math.max(1, Math.round(duration * OUTPUT_FRAME_RATE));
  const frames = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const file = path.join(outputDir, `${prefix}-${String(frame + 1).padStart(2, '0')}.png`);
    const opacity = (frame + 1) / frameCount;
    await sharp(previousPath)
      .ensureAlpha()
      .composite([{ input: nextPath, blend: 'over', opacity }])
      .png({ compressionLevel: 9 })
      .toFile(file);
    frames.push({ file, duration: 1 / OUTPUT_FRAME_RATE });
  }
  return frames;
}

export function sequentialTransitionOpacities(frameIndex, frameCount) {
  const count = Math.max(1, Math.floor(Number(frameCount) || 1));
  const index = Math.max(0, Math.min(count - 1, Math.floor(Number(frameIndex) || 0)));
  if (count === 1) return { previous: 0, next: 1 };

  const fadeOutFrames = Math.ceil(count / 2);
  const fadeInFrames = count - fadeOutFrames;
  if (index < fadeOutFrames) {
    return {
      previous: fadeOutFrames === 1 ? 1 : 1 - index / (fadeOutFrames - 1),
      next: 0
    };
  }

  const fadeInIndex = index - fadeOutFrames;
  return {
    previous: 0,
    next: fadeInFrames === 1 ? 1 : fadeInIndex / (fadeInFrames - 1)
  };
}

export async function createSequentialTransitionFrames(previousPath, nextPath, basePath, duration, outputDir, prefix) {
  const frameCount = Math.max(1, Math.round(duration * OUTPUT_FRAME_RATE));
  const frames = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const file = path.join(outputDir, `${prefix}-${String(frame + 1).padStart(2, '0')}.png`);
    const opacities = sequentialTransitionOpacities(frame, frameCount);
    const overlays = [];
    if (opacities.previous > 0) overlays.push({ input: previousPath, blend: 'over', opacity: opacities.previous });
    if (opacities.next > 0) overlays.push({ input: nextPath, blend: 'over', opacity: opacities.next });
    await sharp(basePath)
      .composite(overlays)
      .png({ compressionLevel: 9 })
      .toFile(file);
    frames.push({ file, duration: 1 / OUTPUT_FRAME_RATE });
  }
  return frames;
}

function launch(command, args, options = {}) {
  try {
    return spawn(command, args, { cwd: ROOT, windowsHide: true, ...options });
  } catch (error) {
    throw describeSpawnError(command, error);
  }
}

function run(command, args, { onProgress = () => {}, totalSeconds = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const child = launch(command, args);
    let stderr = '';
    let stdout = '';
    let timedOut = false;
    let lastProgress = -1;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180_000);
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); if (stderr.length > 100_000) stderr = stderr.slice(-60_000); });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const matches = [...stdout.matchAll(/out_time_ms=(\d+)/g)];
      stdout = stdout.slice(-12_000);
      const latest = matches.at(-1);
      if (latest) {
        const progress = Math.min(0.995, Number(latest[1]) / 1_000_000 / totalSeconds);
        if (progress - lastProgress >= 0.02) { lastProgress = progress; onProgress(progress); }
      }
    });
    child.on('error', (error) => { clearTimeout(timer); reject(describeSpawnError(command, error)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) { onProgress(1); resolve(); }
      else reject(new Error(timedOut ? `${command} vượt quá thời gian chờ.` : `${command} lỗi (${code}): ${stderr.slice(-900)}`));
    });
  });
}

function majorVersion(command) {
  return new Promise((resolve, reject) => {
    const child = launch(command, ['-version']);
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', (error) => reject(describeSpawnError(command, error)));
    child.on('close', (code) => {
      const match = output.match(/ffmpeg version\s+(\d+)/i);
      if (code !== 0 || !match) reject(new Error('Không xác định được phiên bản FFmpeg.'));
      else resolve(Number(match[1]));
    });
  });
}

export async function probeMedia(file) {
  const result = await new Promise((resolve, reject) => {
    const child = launch(FFPROBE_BIN, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,duration', '-of', 'json', file]);
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => reject(describeSpawnError(FFPROBE_BIN, error)));
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `ffprobe lỗi ${code}`)));
  });
  const data = JSON.parse(result);
  return { duration: Number(data.format?.duration || 0), streams: (data.streams || []).map((stream) => ({ ...stream, duration: Number(stream.duration || 0) })) };
}

export async function renderStillPreviewVideo(imagePath, outputPath, seconds = 5, { onProgress = () => {} } = {}) {
  const duration = Math.max(1, Math.min(5, Number(seconds) || 5));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await run(FFMPEG_BIN, [
    '-y', '-loop', '1', '-framerate', '30', '-i', imagePath,
    '-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(duration), '-vf', 'scale=1080:1920:flags=lanczos,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25', '-c:a', 'aac', '-b:a', '96k',
    '-shortest', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outputPath
  ], { onProgress, totalSeconds: duration });
  const media = await probeMedia(outputPath);
  const video = media.streams.find((stream) => stream.codec_type === 'video');
  const audio = media.streams.find((stream) => stream.codec_type === 'audio');
  if (video?.codec_name !== 'h264' || audio?.codec_name !== 'aac' || video.width !== 1080 || video.height !== 1920) {
    throw new Error('Bản render thử phải là H.264/AAC 1080×1920.');
  }
  return { path: outputPath, duration: media.duration, width: video.width, height: video.height };
}

async function probeAudio(file) {
  const result = await new Promise((resolve, reject) => {
    const child = launch(FFPROBE_BIN, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => reject(describeSpawnError(FFPROBE_BIN, error)));
    child.on('close', (code) => code === 0 ? resolve(Number(stdout.trim())) : reject(new Error(stderr || `ffprobe lỗi ${code}`)));
  });
  if (!Number.isFinite(result) || result <= 0) throw new Error(`Không đọc được thời lượng âm thanh: ${file}`);
  return result;
}

export async function renderVideo(script, videoId, audioFiles, {
  onProgress = () => {}, onTimeline = () => {}, onAlignmentWarning = () => {}, highlightSettings = {}, templateSnapshot = null, outputFileName = 'final.mp4'
} = {}) {
  const template = templateSnapshot && typeof templateSnapshot === 'object'
    ? templateSnapshot
    : readVisualTemplate({
      contentLanguage: script.contentLanguage || 'en',
      japaneseV1: script.contentLanguage === 'ja'
        && String(script.presentationStyle || script.dialogues?.[0]?.presentationStyle || '').startsWith('ja-en-v1-')
    });
  const tempDir = path.join(PATHS.temporary, videoId);
  const layerDir = path.join(tempDir, 'visual-layers-v2');
  const outDir = path.join(PATHS.output, videoId);
  fs.mkdirSync(layerDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  if (!Array.isArray(audioFiles) || audioFiles.length === 0) throw new Error('Kịch bản không có đoạn audio TTS nào để render.');
  const settings = { ...DEFAULT_HIGHLIGHT_SETTINGS, ...highlightSettings, highlightTransition: 'instant' };
  if (script.contentLanguage === 'zh') settings.highlightEnabled = false;
  const requestedEnglishPresentationStyle = script.presentationStyle || script.dialogues?.[0]?.presentationStyle;
  const englishPresentationStyle = script.contentLanguage === 'en'
    && ['dialogue-cards', 'numbered-scenario', 'inline-meaning', 'inline-keyphrase'].includes(requestedEnglishPresentationStyle)
    ? requestedEnglishPresentationStyle
    : null;
  const japanesePresentationStyle = script.contentLanguage === 'ja'
    && String(requestedEnglishPresentationStyle || '').startsWith('ja-en-v1-');
  settings.backgroundEffect = normalizeBackgroundEffect(settings.backgroundEffect);
  settings.backgroundEffectDensity = normalizeBackgroundEffectDensity(settings.backgroundEffectDensity);
  settings.backgroundEffectSpeed = normalizeBackgroundEffectSpeed(settings.backgroundEffectSpeed);
  settings.backgroundEffectOpacity = normalizeBackgroundEffectOpacity(settings.backgroundEffectOpacity);
  const renderAudioFiles = script.contentLanguage === 'ja'
    ? filterJapaneseCtaAudioFiles(script, audioFiles)
    : filterChineseCtaAudioFiles(script, audioFiles);
  const durations = [];
  for (const [audioIndex, item] of renderAudioFiles.entries()) {
    if (!fs.existsSync(item.path)) throw new Error(`Thiếu audio cho đoạn ${item.segmentId || item.index || '?'} (${item.language || 'không rõ ngôn ngữ'}).`);
    const duration = await probeAudio(item.path);
    const source = script.contentLanguage === 'zh' || englishPresentationStyle || japanesePresentationStyle
      ? (script.speechSegments || []).find((segment) => String(segment.segmentId || segment.id || '') === String(item.segmentId || item.id || ''))
      : null;
    const requestedPause = Number(item.pauseAfterSeconds ?? source?.pauseAfterSeconds);
    const isJapaneseLead = script.contentLanguage === 'ja' && item.target?.layerId === 'vietnamese-card';
    const dialogueIndex = Number(item.target?.dialogueIndex ?? source?.target?.dialogueIndex);
    const isJapaneseSentenceWithPhrase = script.contentLanguage === 'ja'
      && japanesePresentationStyle
      && item.language === 'ja'
      && item.target?.layerId === 'english-card'
      && Number.isInteger(dialogueIndex)
      && (script.speechSegments || []).some((segment) => Number(segment.target?.dialogueIndex) === dialogueIndex
        && segment.target?.layerId === 'vocabulary');
    const isFinalChineseSpeech = script.contentLanguage === 'zh' && audioIndex === renderAudioFiles.length - 1;
    const supportsSpeechPauses = script.contentLanguage === 'zh' || Boolean(englishPresentationStyle) || japanesePresentationStyle;
    const pauseAfterSeconds = isJapaneseLead && japanesePresentationStyle
      ? 1
      : isJapaneseSentenceWithPhrase
        ? 3
      : supportsSpeechPauses && Number.isFinite(requestedPause)
        ? isFinalChineseSpeech ? 0 : Math.max(0, Math.min(2, requestedPause))
        : 0;
    durations.push({ ...item, target: resolveSpeechTarget(template, item), duration, pauseAfterSeconds });
  }

  const ctaItems = durations.filter((item) => item.state === 'cta' || item.target?.layerId === 'cta');
  const dialogueDurations = durations.filter((item) => item.state !== 'cta' && item.target?.layerId !== 'cta');
  const groups = [];
  for (const item of dialogueDurations) {
    const turnId = String(item.turnId || item.segmentId || item.index);
    let group = groups.at(-1);
    if (!group || group.turnId !== turnId) {
      group = { turnId, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  const totalCount = Math.max(Number(script.dialogues?.length || 0), groups.length, 1);
  const timing = { ...template.timing };
  const configuredTransition = Number(timing.transition) || 0;
  const transitionFrames = configuredTransition > 0
    ? Math.max(1, Math.round(configuredTransition * OUTPUT_FRAME_RATE))
    : 0;
  timing.transition = transitionFrames / OUTPUT_FRAME_RATE;
  const ctaSpeechDuration = ctaItems.reduce((sum, item) => sum + item.duration, 0);
  const ctaDuration = ['zh', 'ja'].includes(script.contentLanguage) ? 0 : Math.max(0, Number(timing.cta) || 0, ctaSpeechDuration);
  timing.cta = ctaDuration;
  const speechDuration = dialogueDurations.reduce((sum, item) => sum + item.duration + item.pauseAfterSeconds, 0);
  const configuredVocabularyHold = Math.max(0, Number(timing.vocabularyHold) || 0);
  const vocabularyHold = fitVocabularyHold({
    configuredHold: configuredVocabularyHold,
    groupCount: script.contentLanguage === 'zh' || englishPresentationStyle || japanesePresentationStyle ? Math.max(0, groups.length - 1) : groups.length,
    speechDuration,
    intro: Number(timing.intro),
    cta: Number(timing.cta),
    transition: Number(timing.transition),
    safetyMargin: 0.1 + groups.length / OUTPUT_FRAME_RATE
  });
  const sequence = [{ type: 'silence', state: 'intro', index: 0, duration: Number(timing.intro) }];
  let sequenceCursor = Number(timing.intro);
  groups.forEach((group, groupIndex) => {
    if (script.contentLanguage === 'zh') {
      // Chinese lesson clips keep the generated speech order: Vietnamese source,
      // Chinese first read, second read, then the spoken explanation/practice.
      // English retains its existing dialogue/vocabulary grouping below.
      for (const item of group.items) {
        const requestedIndex = Number(item.target?.dialogueIndex);
        const index = Array.isArray(script.dialogues) && script.dialogues.length
          ? Math.max(0, Math.min(script.dialogues.length - 1, Number.isInteger(requestedIndex) ? requestedIndex : groupIndex))
          : groupIndex;
        const state = ['vietnamese', 'bilingual', 'vocabulary'].includes(item.state)
          ? item.state
          : item.target?.layerId === 'vietnamese-card' ? 'vietnamese' : 'bilingual';
        sequence.push({ ...item, type: 'speech', state, index, target: { ...(item.target || {}), dialogueIndex: index }, duration: item.duration });
        sequenceCursor += item.duration;
        if (item.pauseAfterSeconds > 0.0001) {
          sequence.push({ type: 'silence', state, index, duration: item.pauseAfterSeconds });
          sequenceCursor += item.pauseAfterSeconds;
        }
      }
    } else if (englishPresentationStyle || japanesePresentationStyle) {
      for (const item of group.items) {
        const requestedIndex = Number(item.target?.dialogueIndex);
        const index = Array.isArray(script.dialogues) && script.dialogues.length
          ? Math.max(0, Math.min(script.dialogues.length - 1, Number.isInteger(requestedIndex) ? requestedIndex : groupIndex))
          : groupIndex;
        const state = ['vietnamese', 'bilingual', 'vocabulary'].includes(item.state)
          ? item.state
          : item.target?.layerId === 'vietnamese-card' ? 'vietnamese' : 'bilingual';
        sequence.push({ ...item, type: 'speech', state, index, target: { ...(item.target || {}), dialogueIndex: index }, duration: item.duration });
        sequenceCursor += item.duration;
        if (item.pauseAfterSeconds > 0.0001) {
          const isJapaneseLeadPause = japanesePresentationStyle
            && item.target?.layerId === 'vietnamese-card'
            && Number(item.target?.dialogueIndex) === index;
          if (isJapaneseLeadPause) {
            const phaseDuration = item.pauseAfterSeconds / 3;
            for (let phase = 1; phase <= 3; phase += 1) {
              sequence.push({ type: 'silence', state: `japanese-typing-${phase}`, index, duration: phaseDuration });
            }
          } else {
            sequence.push({ type: 'silence', state, index, duration: item.pauseAfterSeconds });
          }
          sequenceCursor += item.pauseAfterSeconds;
        }
      }
    } else {
      const dialogueItems = group.items.filter((item) => item.target?.layerId !== 'vocabulary' && item.state !== 'vocabulary');
      const vocabularyItems = group.items.filter((item) => item.target?.layerId === 'vocabulary' || item.state === 'vocabulary');
      for (const item of dialogueItems) {
        const requestedIndex = Number(item.target?.dialogueIndex);
        const index = Array.isArray(script.dialogues) && script.dialogues.length
          ? Math.max(0, Math.min(script.dialogues.length - 1, Number.isInteger(requestedIndex) ? requestedIndex : groupIndex))
          : groupIndex;
        const state = ['vietnamese', 'bilingual', 'vocabulary'].includes(item.state)
          ? item.state
          : item.target?.layerId === 'vietnamese-card' ? 'vietnamese' : 'bilingual';
        sequence.push({ ...item, type: 'speech', state, index, target: { ...(item.target || {}), dialogueIndex: index }, duration: item.duration });
        sequenceCursor += item.duration;
      }
      const requestedIndex = Number(group.items[0]?.target?.dialogueIndex);
      const index = Array.isArray(script.dialogues) && script.dialogues.length && Number.isInteger(requestedIndex)
        ? Math.max(0, Math.min(script.dialogues.length - 1, requestedIndex))
        : groupIndex;
      for (const item of vocabularyItems) {
        sequence.push({ ...item, type: 'speech', state: 'vocabulary', index, target: { ...(item.target || {}), dialogueIndex: index }, duration: item.duration });
        sequenceCursor += item.duration;
      }
    }
    const requestedIndex = Number(group.items[0]?.target?.dialogueIndex);
    const index = Array.isArray(script.dialogues) && script.dialogues.length && Number.isInteger(requestedIndex)
      ? Math.max(0, Math.min(script.dialogues.length - 1, requestedIndex))
      : groupIndex;
    const hasNextPresentationGroup = script.contentLanguage === 'zh' || englishPresentationStyle || japanesePresentationStyle
      ? groupIndex < groups.length - 1
      : true;
    const groupVocabularyHold = hasNextPresentationGroup ? vocabularyHold : 0;
    const groupTransitionFrames = hasNextPresentationGroup ? transitionFrames : 0;
    const transitionStart = groupTransitionFrames > 0
      ? alignUpToFrame(sequenceCursor + groupVocabularyHold)
      : sequenceCursor + groupVocabularyHold;
    const vocabularySilenceDuration = Math.max(0, transitionStart - sequenceCursor);
    sequence.push({ type: 'silence', state: 'vocabulary', index, duration: vocabularySilenceDuration });
    sequenceCursor += vocabularySilenceDuration;
    if (groupTransitionFrames > 0) {
      sequence.push({ type: 'silence', state: 'transition', index, duration: groupTransitionFrames / OUTPUT_FRAME_RATE });
      sequenceCursor += groupTransitionFrames / OUTPUT_FRAME_RATE;
    }
  });
  const ctaIndex = Math.max(0, totalCount - 1);
  for (const item of ctaItems) {
    sequence.push({
      ...item,
      type: 'speech',
      state: 'cta',
      index: ctaIndex,
      target: { ...(item.target || {}), dialogueIndex: ctaIndex },
      duration: item.duration
    });
  }
  sequence.push({ type: 'silence', state: 'cta', index: ctaIndex, duration: Math.max(0, ctaDuration - ctaSpeechDuration) });

  const audioTimeline = buildAudioTimeline(sequence);
  const total = audioTimeline.duration;
  if (total < 4 || total > 60) throw new Error(`Timeline dài ${total.toFixed(1)} giây; video Reels phải từ 4 đến 60 giây.`);
  const highlightTimeline = [];
  const visualPlan = [];
  const addVisual = (entry, duration, highlight = null) => {
    if (!(duration > 0.0001)) return;
    visualPlan.push({ entry, duration, highlight });
  };

  for (const entry of audioTimeline.entries) {
    if (entry.type !== 'speech') {
      addVisual(entry, entry.duration);
      continue;
    }

    if (entry.state === 'cta') {
      addVisual(entry, entry.duration);
      continue;
    }
    const enabled = settings.highlightEnabled !== false && script.contentLanguage !== 'zh';
    if (!enabled) {
      addVisual(entry, entry.duration);
      continue;
    }
    if (!entry.alignment?.reliable) {
      onAlignmentWarning({
        segmentId: entry.segmentId,
        speakerId: entry.speakerId,
        voiceName: entry.voiceName || entry.voice,
        language: entry.language,
        status: entry.alignment?.status || 'unavailable',
        warning: entry.alignmentWarning || 'Một phần lời thoại chưa căn chỉnh được; chỉ dùng những từ có mốc thời gian xác định.'
      });
    }
    if (!entry.wordTimings?.length) {
      addVisual(entry, entry.duration);
      continue;
    }

    const intervals = buildHighlightIntervals(entry.wordTimings, settings.highlightMode);
    const cues = intervals.map((interval, index) => {
      const next = intervals[index + 1];
      const rawStart = Math.max(0, Math.min(entry.duration, Number(interval.startSeconds)));
      const rawEnd = Math.max(rawStart, Math.min(entry.duration, Number(interval.endSeconds), next ? Number(next.startSeconds) : entry.duration));
      // A cue shorter than one output frame can disappear between frame samples.
      // Snap cues outwards to the 30 FPS grid, then the cursor below resolves
      // adjacent cues without overlap while keeping every spoken word visible.
      const absoluteStart = entry.startTime + rawStart;
      const absoluteEnd = entry.startTime + rawEnd;
      const startSeconds = Math.max(0, Math.min(entry.duration, Math.max(
        0, Math.floor(absoluteStart * OUTPUT_FRAME_RATE) / OUTPUT_FRAME_RATE - entry.startTime
      )));
      const endSeconds = Math.max(startSeconds, Math.min(entry.duration, Math.ceil(absoluteEnd * OUTPUT_FRAME_RATE) / OUTPUT_FRAME_RATE - entry.startTime));
      return { ...interval, startSeconds, endSeconds };
    }).filter((interval) => interval.endSeconds > interval.startSeconds);

    let cursor = 0;
    for (const cue of cues) {
      if (cue.startSeconds > cursor) addVisual(entry, cue.startSeconds - cursor);
      const cueStart = Math.max(cursor, cue.startSeconds);
      const cueEnd = Math.max(cueStart, cue.endSeconds);
      addVisual(entry, cueEnd - cueStart, { segmentId: entry.segmentId, tokenIds: cue.tokenIds });
      if (cueEnd > cueStart) {
        highlightTimeline.push({
          id: cue.id,
          segmentId: entry.segmentId,
          speakerId: entry.speakerId,
          voiceName: entry.voiceName || entry.voice,
          language: entry.language,
          tokenIds: cue.tokenIds,
          words: cue.words,
          startTime: entry.startTime + cueStart,
          endTime: entry.startTime + cueEnd
        });
      }
      cursor = cueEnd;
    }
    if (entry.duration > cursor) addVisual(entry, entry.duration - cursor);
  }

  const plannedDuration = visualPlan.reduce((sum, item) => sum + item.duration, 0);
  if (Math.abs(plannedDuration - total) > 0.05) throw new Error(`Timeline hình ảnh lệch ${Math.abs(plannedDuration - total).toFixed(3)} giây so với audio.`);
  const timeline = audioTimeline.entries.map((entry) => ({
    state: entry.state,
    index: entry.index,
    type: entry.type,
    start: entry.startTime,
    end: entry.endTime,
    segmentId: entry.segmentId,
    speakerId: entry.speakerId,
    voiceName: entry.voiceName || entry.voice,
    language: entry.language,
    speechSpeed: entry.rate ?? null,
    wordBoundaryCount: entry.wordTimings?.length || 0,
    alignment: entry.alignment?.status || null,
    alignmentSource: entry.alignmentSource || null
  }));
  onTimeline(timeline);

  const persistentLayers = [
    'background',
    ...(script.contentLanguage === 'zh' ? ['chinese-plum-blossom', 'chinese-bamboo'] : []),
    'character', 'logo', 'facebook-logo', 'youtube-logo', 'footer'
  ];
  const targetCardLayer = script.contentLanguage === 'zh' ? 'chinese-card' : 'english-card';
  const pinyinLayer = script.contentLanguage === 'zh' ? ['pinyin'] : [];
  const hasExplicitPinyinSequence = script.contentLanguage === 'zh' && durations.some((item) =>
    item.target?.layerId === 'chinese-card' && typeof item.target.pinyinVisible === 'boolean'
  );
  let pinyinVisibleForTimeline = !hasExplicitPinyinSequence;
  const japaneseTypingLayers = {
    'japanese-typing-1': [...persistentLayers, 'scene-number', 'vietnamese-card'],
    'japanese-typing-2': [...persistentLayers, 'scene-number', 'vietnamese-card'],
    'japanese-typing-3': [...persistentLayers, 'scene-number', 'vietnamese-card']
  };
  const stateLayers = {
    intro: [...persistentLayers, 'title'],
    vietnamese: [...persistentLayers, ...(englishPresentationStyle && ['dialogue-cards', 'inline-meaning', 'inline-keyphrase'].includes(englishPresentationStyle) ? [] : ['scene-number']), 'vietnamese-card'],
    bilingual: [...persistentLayers, ...(englishPresentationStyle && ['dialogue-cards', 'inline-meaning', 'inline-keyphrase'].includes(englishPresentationStyle) ? [] : ['scene-number']), 'vietnamese-card', targetCardLayer, ...pinyinLayer],
    vocabulary: [...persistentLayers, ...(englishPresentationStyle && ['dialogue-cards', 'inline-meaning', 'inline-keyphrase'].includes(englishPresentationStyle) ? [] : ['scene-number']), 'vietnamese-card', targetCardLayer, ...pinyinLayer, 'vocabulary'],
    ...japaneseTypingLayers,
    transition: [],
    cta: [...persistentLayers, 'cta']
  };
  const imageEntries = [];
  let visualCursor = 0;
  let backgroundBaseFile = null;
  let transitionBaseFile = null;
  if (settings.backgroundEffect !== 'none') {
    backgroundBaseFile = path.join(layerDir, 'background-base.png');
    await rasterizeScene({ template, script, state: 'intro', index: 0, outputPath: backgroundBaseFile, includeLayers: ['background'] });
  } else if (script.contentLanguage === 'en' && transitionFrames > 0 && groups.length > 1) {
    transitionBaseFile = path.join(layerDir, 'transition-base.png');
    await rasterizeScene({ template, script, state: 'intro', index: 0, outputPath: transitionBaseFile, includeLayers: persistentLayers });
  }
  const pinyinAnimationElapsed = new Map();
  for (let index = 0; index < visualPlan.length; index += 1) {
    const visual = visualPlan[index];
    const entry = visual.entry;
    const sceneIndex = Math.max(0, Math.min(totalCount - 1, Number(entry.index || 0)));
    if (entry.state === 'transition') {
      imageEntries.push({ file: null, duration: visual.duration, transition: true });
      visualCursor += visual.duration;
      continue;
    }
    let includeLayers = [...(stateLayers[entry.state] || stateLayers.bilingual)];
    const speechSegment = entry.type === 'speech'
      ? { ...entry, target: { ...(entry.target || {}), dialogueIndex: sceneIndex } }
      : null;
    if (script.contentLanguage === 'zh' && speechSegment?.target?.layerId === 'chinese-card'
      && typeof speechSegment.target.pinyinVisible === 'boolean') {
      pinyinVisibleForTimeline = speechSegment.target.pinyinVisible;
    }
    const sceneDialogue = script.dialogues?.[sceneIndex];
    if (speechSegment && !sceneDialogue?.vietnamese && !sceneDialogue?.english) {
      includeLayers = includeLayers.filter((layerId) => !['vietnamese-card', 'english-card'].includes(layerId) || layerId === speechSegment.target.layerId);
    }
    if (speechSegment?.target?.layerId && !includeLayers.includes(speechSegment.target.layerId)) includeLayers.push(speechSegment.target.layerId);
    if (script.contentLanguage === 'zh' && !pinyinVisibleForTimeline) includeLayers = includeLayers.filter((layerId) => layerId !== 'pinyin');
    const pinyinLayer = template.layers.find((layer) => layer.id === 'pinyin');
    const animatedPinyin = script.contentLanguage === 'zh' && pinyinLayer?.visible !== false
      && pinyinLayer?.appearanceEffect !== 'none' && speechSegment?.target?.layerId === 'chinese-card'
      && speechSegment.target?.pinyinVisible !== false;
    const animationKey = String(speechSegment?.segmentId || '');
    const elapsed = animationKey ? (pinyinAnimationElapsed.get(animationKey) || 0) : 0;
    const animatedPinyinDuration = animatedPinyin ? Math.min(visual.duration, Math.max(0, 0.2 - elapsed)) : 0;
    const animatedDuration = animatedPinyinDuration;
    const requests = [];
    if (animatedDuration > 0.0001) {
      const frames = Math.max(1, Math.ceil(animatedDuration * OUTPUT_FRAME_RATE));
      for (let frame = 0; frame < frames; frame += 1) {
        const duration = animatedDuration / frames;
        const progressed = duration * (frame + 1);
        requests.push({
          duration,
          pinyinProgress: animatedPinyin ? Math.min(1, (elapsed + progressed) / 0.2) : 1,
          frame
        });
      }
      if (animatedPinyinDuration > 0.0001) pinyinAnimationElapsed.set(animationKey, elapsed + animatedPinyinDuration);
    }
    const remaining = Math.max(0, visual.duration - animatedDuration);
    if (remaining > 0.0001 || !requests.length) requests.push({ duration: remaining || visual.duration, pinyinProgress: 1, layerProgress: 1, frame: 'rest' });
    for (const request of requests) {
      const suffix = request.frame === 'rest' ? '' : `-py${request.frame}`;
      const frameFile = path.join(layerDir, `highlight-${String(index + 1).padStart(5, '0')}-${entry.state}${suffix}.png`);
      if (settings.backgroundEffect === 'none') {
        await rasterizeScene({
          template, script, state: entry.state, index: sceneIndex, outputPath: frameFile,
          includeBackground: true, includeLayers, highlight: visual.highlight,
          highlightSettings: settings, speechSegment, totalCount,
          pinyinEffectProgress: request.pinyinProgress
        });
        imageEntries.push({ file: frameFile, duration: request.duration });
      } else {
        const foregroundFile = path.join(layerDir, `foreground-${String(index + 1).padStart(5, '0')}-${entry.state}${suffix}.png`);
        await rasterizeScene({
          template, script, state: entry.state, index: sceneIndex, outputPath: foregroundFile,
          includeBackground: false, includeLayers: includeLayers.filter((layerId) => layerId !== 'background'),
          highlight: visual.highlight, highlightSettings: settings, speechSegment, totalCount,
          pinyinEffectProgress: request.pinyinProgress
        });
        imageEntries.push({ file: foregroundFile, duration: request.duration, foreground: true });
      }
    }
    visualCursor += visual.duration;
    if (index % Math.max(1, Math.floor(visualPlan.length / 20)) === 0) onProgress(0.02 + 0.18 * ((index + 1) / visualPlan.length));
  }

  const renderedImageEntries = [];
  const chineseEffectFrames = script.contentLanguage === 'zh' && settings.backgroundEffect !== 'none';
  if (settings.backgroundEffect !== 'none') {
    // Render every effect frame against the absolute video clock, including
    // scene transitions. This prevents the effect from freezing at each cut.
    const outputFrameCount = Math.max(1, Math.round(total * OUTPUT_FRAME_RATE));
    const effectFrameConcurrency = script.contentLanguage === 'zh' ? 2 : 1;
    let effectFramesCompleted = 0;
    let lastEffectProgress = 0.2;
    let visualStart = 0;
    for (let index = 0; index < imageEntries.length; index += 1) {
      const item = imageEntries[index];
      const visualEnd = visualStart + item.duration;
      const firstOutputFrame = Math.ceil(visualStart * OUTPUT_FRAME_RATE - 1e-7);
      const endOutputFrame = Math.min(outputFrameCount, Math.ceil(visualEnd * OUTPUT_FRAME_RATE - 1e-7));
      let previous = null;
      let next = null;
      if (item.transition) {
        previous = [...imageEntries.slice(0, index)].reverse().find((candidate) => candidate.foreground && candidate.file);
        next = imageEntries.slice(index + 1).find((candidate) => candidate.foreground && candidate.file);
      }
      const renderEffectFrame = async (frameIndex) => {
        const frameTime = frameIndex * BACKGROUND_EFFECT_FRAME_SECONDS;
        const effectMarkup = renderBackgroundEffectMarkup(settings.backgroundEffect, {
          width: template.canvas.width,
          height: template.canvas.height,
          time: frameTime,
          seed: videoId,
          density: settings.backgroundEffectDensity,
          speed: settings.backgroundEffectSpeed,
          opacity: settings.backgroundEffectOpacity,
          contentLanguage: script.contentLanguage || 'en'
        });
        const effectSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${template.canvas.width}" height="${template.canvas.height}" viewBox="0 0 ${template.canvas.width} ${template.canvas.height}">${effectMarkup}</svg>`);
        const overlays = [{ input: effectSvg, blend: 'over' }];
        if (item.transition && previous?.file && next?.file) {
          if (script.contentLanguage === 'en') {
            const frameCount = Math.max(1, endOutputFrame - firstOutputFrame);
            const opacities = sequentialTransitionOpacities(frameIndex - firstOutputFrame, frameCount);
            if (opacities.previous > 0) overlays.push({ input: previous.file, blend: 'over', opacity: opacities.previous });
            if (opacities.next > 0) overlays.push({ input: next.file, blend: 'over', opacity: opacities.next });
          } else {
            const progress = Math.max(0, Math.min(1, (frameTime - visualStart) / Math.max(item.duration, 1e-9)));
            overlays.push(
              { input: previous.file, blend: 'over', opacity: 1 - progress },
              { input: next.file, blend: 'over', opacity: progress }
            );
          }
        } else if (item.file) {
          overlays.push({ input: item.file, blend: 'over' });
        } else if (previous?.file || next?.file) {
          overlays.push({ input: previous?.file || next.file, blend: 'over' });
        }
        const frameFile = path.join(layerDir, `effect-frame-${String(frameIndex + 1).padStart(5, '0')}.png`);
        await sharp(backgroundBaseFile)
          .composite(overlays)
          .png({ compressionLevel: 9 })
          .toFile(frameFile);
        return { file: frameFile, duration: BACKGROUND_EFFECT_FRAME_SECONDS };
      };
      for (let batchStart = firstOutputFrame; batchStart < endOutputFrame; batchStart += effectFrameConcurrency) {
        const batchEnd = Math.min(endOutputFrame, batchStart + effectFrameConcurrency);
        const batch = await Promise.all(Array.from({ length: batchEnd - batchStart }, (_, offset) => renderEffectFrame(batchStart + offset)));
        renderedImageEntries.push(...batch);
        effectFramesCompleted += batch.length;
        if (chineseEffectFrames) {
          const progress = 0.2 + 0.3 * (effectFramesCompleted / outputFrameCount);
          if (progress - lastEffectProgress >= 0.02 || effectFramesCompleted === outputFrameCount) {
            lastEffectProgress = progress;
            onProgress(progress);
          }
        }
      }
      visualStart = visualEnd;
    }
  } else {
    for (let index = 0; index < imageEntries.length; index += 1) {
      const item = imageEntries[index];
      if (!item.transition) {
        renderedImageEntries.push(item);
        continue;
      }
      const previous = [...renderedImageEntries].reverse().find((entry) => entry.file);
      const next = imageEntries.slice(index + 1).find((entry) => entry.file);
      if (previous?.file && next?.file) {
        const prefix = `transition-${String(index + 1).padStart(4, '0')}`;
        if (script.contentLanguage === 'en' && transitionBaseFile) {
          renderedImageEntries.push(...await createSequentialTransitionFrames(previous.file, next.file, transitionBaseFile, item.duration, layerDir, prefix));
        } else {
          renderedImageEntries.push(...await createCrossfadeFrames(previous.file, next.file, item.duration, layerDir, prefix));
        }
      } else if (previous?.file || next?.file) {
        renderedImageEntries.push({ file: previous?.file || next.file, duration: item.duration });
      }
    }
  }

  const visualListPath = path.join(layerDir, 'visual-timeline.ffconcat');
  const visualList = [];
  for (const item of renderedImageEntries) {
    // PNG-pipe defaults to a 25 FPS timebase. Pin it to the output rate so the
    // concat demuxer does not quantize scene boundaries before fps=30 resamples.
    visualList.push(concatFileLine(item.file), `option framerate ${OUTPUT_FRAME_RATE}`, `duration ${item.duration.toFixed(6)}`);
  }
  visualList.push(concatFileLine(renderedImageEntries.at(-1).file), `option framerate ${OUTPUT_FRAME_RATE}`);
  fs.writeFileSync(visualListPath, `${visualList.join('\n')}\n`, 'utf8');

  const audioItems = audioTimeline.entries.filter((item) => item.duration > 0.0001);
  const inputs = [];
  for (const item of audioItems) {
    if (item.type === 'silence') inputs.push('-f', 'lavfi', '-t', item.duration.toFixed(6), '-i', 'anullsrc=r=44100:cl=stereo');
    else inputs.push('-i', item.path);
  }
  const visualInputIndex = audioItems.length;
  inputs.push('-f', 'concat', '-safe', '0', '-i', visualListPath);

  const filters = [];
  const audioFilters = [];
  for (let index = 0; index < audioItems.length; index += 1) {
    const item = audioItems[index];
    const chain = ['aresample=44100:async=0:first_pts=0', 'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo'];
    if (item.type === 'speech') {
      const fadeDuration = Math.min(0.012, item.duration / 2);
      chain.push('deesser=i=0.3:m=0.5:f=0.5', 'afade=t=in:st=0:d=0.008', `afade=t=out:st=${Math.max(0, item.duration - fadeDuration).toFixed(3)}:d=${fadeDuration.toFixed(3)}`);
    }
    audioFilters.push(`[${index}:a]${chain.join(',')}[a${index}]`);
  }
  audioFilters.push(`${audioItems.map((_, index) => `[a${index}]`).join('')}concat=n=${audioItems.length}:v=0:a=1[aout]`);
  filters.push(...audioFilters);

  // Scene transitions are assembled above; avoid adding another global fade here,
  // which would dim the full frame on top of the transition.
  filters.push(`[${visualInputIndex}:v]fps=30,scale=1080:1920:flags=lanczos,setsar=1,format=yuv420p,trim=duration=${total.toFixed(3)},setpts=PTS-STARTPTS[vbase]`);
  filters.push('[vbase]format=yuv420p[vout]');

  const filterFile = path.join(tempDir, 'render-highlight.filter');
  fs.writeFileSync(filterFile, filters.join(';\n'), 'utf8');
  const outputName = String(outputFileName || 'final.mp4');
  if (path.basename(outputName) !== outputName) throw new Error('Tên tệp đầu ra video không hợp lệ.');
  const output = path.join(outDir, outputName);
  const filterOption = await majorVersion(FFMPEG_BIN) >= 7 ? '-/filter_complex' : '-filter_complex_script';
  const ffmpegArgs = ['-y', ...inputs, filterOption, filterFile, '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(3), '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-crf', '22', '-threads', '4', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output];
  const ffmpegProgressStart = chineseEffectFrames ? 0.5 : 0.2;
  await run(FFMPEG_BIN, ffmpegArgs, { onProgress: (progress) => onProgress(ffmpegProgressStart + (1 - ffmpegProgressStart) * progress), totalSeconds: total });
  const check = await probeMedia(output);
  const videoStream = check.streams.find((stream) => stream.codec_type === 'video');
  const audioStream = check.streams.find((stream) => stream.codec_type === 'audio');
  const [fpsNumerator, fpsDenominator] = String(videoStream?.r_frame_rate || '').split('/').map(Number);
  const fps = fpsDenominator ? fpsNumerator / fpsDenominator : Number(videoStream?.r_frame_rate);
  const videoDuration = Number(videoStream?.duration || check.duration);
  const audioDuration = Number(audioStream?.duration || check.duration);
  const syncDriftSeconds = audioDuration - videoDuration;
  if (!videoStream || !audioStream || videoStream.codec_name !== 'h264' || videoStream.width !== 1080 || videoStream.height !== 1920 || Math.round(fps) !== 30 || audioStream.codec_name !== 'aac' || check.duration < 4 || check.duration > 60) {
    throw new Error('Video không đạt yêu cầu H.264 1080×1920, 30 FPS, AAC hoặc thời lượng Reels 4–60 giây.');
  }
  if (Math.abs(syncDriftSeconds) > 0.09) throw new Error(`Audio/video lệch ${Math.abs(syncDriftSeconds).toFixed(3)} giây sau render.`);
  const assetVersions = getTemplateAssetVersions(template);
  const renderManifest = {
    templateId: template.templateId,
    templateVersion: template.version,
    template: JSON.parse(JSON.stringify(template)),
    pageName: template.brand.pageName,
    palette: template.brand,
    assetVersions,
    fonts: { family: template.brand.fontFamily, license: 'SIL Open Font License 1.1', files: ['fonts/BeVietnamPro-Regular.ttf', 'fonts/BeVietnamPro-SemiBold.ttf', 'fonts/BeVietnamPro-Bold.ttf'] },
    canvas: template.canvas,
    timeline,
    highlightSettings: settings,
    backgroundEffect: settings.backgroundEffect,
    backgroundEffectDensity: settings.backgroundEffectDensity,
    backgroundEffectSpeed: settings.backgroundEffectSpeed,
    backgroundEffectOpacity: settings.backgroundEffectOpacity,
    effectiveTiming: { ...timing, vocabularyHold, cta: ctaDuration },
    highlightTimeline,
    synchronization: { audioDuration, videoDuration, driftSeconds: syncDriftSeconds, checked: true },
    durationSeconds: check.duration,
    videoCodec: videoStream.codec_name,
    audioCodec: audioStream.codec_name,
    createdAt: new Date().toISOString()
  };
  return {
    videoPath: output,
    duration: check.duration,
    width: videoStream.width,
    height: videoStream.height,
    fps: videoStream.r_frame_rate,
    audioManifest: audioTimeline.entries.filter((item) => item.type === 'speech').map((item) => ({
      segmentId: item.segmentId,
      speakerId: item.speakerId,
      voiceName: item.voiceName || item.voice,
      language: item.language,
      speechSpeed: item.rate ?? null,
      text: item.text,
      speechText: item.speechText || item.text,
      audioPath: item.path,
      startTime: item.startTime,
      endTime: item.endTime,
      duration: item.duration,
      alignmentSource: item.alignmentSource || null,
      alignment: item.alignment,
      wordTimings: item.wordTimings
    })),
    renderManifest
  };
}

function concatFileLine(file) {
  const absolute = path.resolve(file).replace(/\\/gu, '/');
  return `file '${absolute.replaceAll("'", "'\\''")}'`;
}

export function resolveSpeechTarget(template, item) {
  const target = item.target && typeof item.target === 'object' ? item.target : {};
  const requestedLayer = template.layers.find((layer) => layer.id === target.layerId);
  const requestedIsText = requestedLayer?.kind === 'text' || requestedLayer?.kind === 'cta' || ['vietnamese-card', 'english-card', 'chinese-card', 'vocabulary'].includes(requestedLayer?.id);
  if (requestedLayer && requestedLayer.visible !== false && requestedIsText) return target;

  const language = normalizeLanguage(item.language);
  const textLayers = template.layers.filter((layer) => layer.kind === 'text' && layer.visible !== false);
  const matches = textLayers.find((layer) => {
    const speakerIds = [layer.speakerId, ...(Array.isArray(layer.speakerIds) ? layer.speakerIds : [])].filter(Boolean).map(String);
    const languages = [layer.language, ...(Array.isArray(layer.languages) ? layer.languages : [])].filter(Boolean).map(normalizeLanguage);
    const targetIds = [layer.targetId, ...(Array.isArray(layer.targetIds) ? layer.targetIds : [])].filter(Boolean).map(String);
    const segmentIds = [item.segmentId, target.id].filter(Boolean).map(String);
    const targetMatches = !targetIds.length || targetIds.some((id) => segmentIds.includes(id));
    const speakerMatches = !speakerIds.length || speakerIds.includes(String(item.speakerId));
    const languageMatches = !languages.length || languages.includes(language);
    return (targetIds.length || speakerIds.length || languages.length) && targetMatches && speakerMatches && languageMatches;
  });
  const fallback = matches || textLayers.find((layer) => layer.id !== 'title') || textLayers[0];
  return fallback ? { ...target, layerId: fallback.id } : target;
}

export function fitVocabularyHold({ configuredHold, groupCount, speechDuration, intro, cta, transition, maxDuration = 60, safetyMargin = 0.1 }) {
  const groups = Math.max(0, Number(groupCount) || 0);
  const configured = Math.max(0, Number(configuredHold) || 0);
  if (!groups) return 0;
  const fixedDuration = Math.max(0, Number(speechDuration) || 0)
    + Math.max(0, Number(intro) || 0)
    + Math.max(0, Number(cta) || 0)
    + groups * Math.max(0, Number(transition) || 0);
  const availablePerGroup = Math.max(0, (Math.max(0, Number(maxDuration) - Math.max(0, Number(safetyMargin))) - fixedDuration) / groups);
  return Math.min(configured, availablePerGroup);
}
