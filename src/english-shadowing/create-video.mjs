import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PATHS, FFMPEG_BIN, ROOT } from '../config.mjs';
import {
  db, getSettings, getEnglishShadowingSettings, getScript, getVideo, insertEnglishShadowingScript,
  insertEnglishShadowingVideo, updateVideo, updateJobPayload, log
} from '../database/db.mjs';
import { buildEnglishShadowingPrompt, parseEnglishShadowingCandidate } from './prompt.mjs';
import { englishShadowingTtsSettings, normalizeEnglishShadowingSettings } from './settings.mjs';
import { normalizeEnglishShadowingVisualDesign } from './visual-design.mjs';
import { getEnglishShadowingVisualDesign } from './visual-design-store.mjs';
import { renderEnglishShadowingVideo, getEnglishShadowingMediaDuration } from './renderer.mjs';
import { buildEnglishShadowingSentencePlan, getEnglishShadowingDeliveryProfile, resolveEnglishShadowingDeliveryStyle } from './delivery.mjs';
import { generateWithChatGPT } from '../ai/chatgpt-plan.mjs';
import { KOKORO_VOICES, synthesizeKokoroSegments } from '../tts/kokoro-tts.mjs';
import { withLocalTtsModel } from '../tts/local-model-manager.mjs';

const SENTENCE_PAUSE_SECONDS = 0.63;
const KOKORO_SAMPLE_RATE = 24_000;

function run(binary, args, { timeoutMs = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(binary)} thoát với mã ${code}: ${stderr.trim().slice(-1800)}`));
    });
  });
}

function splitIntoSentences(text) {
  const sentences = String(text || '').match(/[^.!?]+[.!?]+|[^.!?]+$/gu) || [];
  return sentences.map((sentence) => sentence.trim()).filter(Boolean);
}

async function joinSentenceAudio(audioFiles, videoId) {
  const workDir = path.join(PATHS.temporary, videoId, 'english-shadowing');
  const audioPath = path.join(workDir, 'lesson-source.wav');
  fsMkdir(workDir);
  const pauseFiles = new Map();
  for (let index = 0; index < audioFiles.length - 1; index += 1) {
    const requestedPause = Number(audioFiles[index].pauseAfterSeconds);
    const pauseSeconds = Number.isFinite(requestedPause) && requestedPause > 0
      ? Math.max(0.35, Math.min(0.9, requestedPause))
      : SENTENCE_PAUSE_SECONDS;
    const pauseKey = pauseSeconds.toFixed(2);
    let silencePath = pauseFiles.get(pauseKey);
    if (!silencePath) {
      silencePath = path.join(workDir, `sentence-pause-${Math.round(pauseSeconds * 1000)}ms.wav`);
      await run(FFMPEG_BIN, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-t', pauseKey, '-i', `anullsrc=channel_layout=mono:sample_rate=${KOKORO_SAMPLE_RATE}`,
        '-c:a', 'pcm_s16le', silencePath
      ]);
      pauseFiles.set(pauseKey, silencePath);
    }
    pauseFiles.set(index, silencePath);
  }

  const inputs = [];
  const filter = [];
  const sequence = [];
  let inputIndex = 0;
  for (let index = 0; index < audioFiles.length; index += 1) {
    const file = audioFiles[index];
    inputs.push('-i', file.path);
    const label = `a${inputIndex}`;
    filter.push(`[${inputIndex}:a]aresample=${KOKORO_SAMPLE_RATE},aformat=channel_layouts=mono,asetpts=PTS-STARTPTS[${label}]`);
    sequence.push(`[${label}]`);
    inputIndex += 1;
    if (index < audioFiles.length - 1) {
      inputs.push('-i', pauseFiles.get(index));
      const pauseLabel = `p${inputIndex}`;
      filter.push(`[${inputIndex}:a]aresample=${KOKORO_SAMPLE_RATE},aformat=channel_layouts=mono,asetpts=PTS-STARTPTS[${pauseLabel}]`);
      sequence.push(`[${pauseLabel}]`);
      inputIndex += 1;
    }
  }
  filter.push(`${sequence.join('')}concat=n=${sequence.length}:v=0:a=1[out]`);
  await run(FFMPEG_BIN, [
    '-y', '-hide_banner', '-loglevel', 'error', ...inputs,
    '-filter_complex', filter.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', audioPath
  ]);
  return audioPath;
}

function fsMkdir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function timingManifestPath(videoId) {
  return path.join(PATHS.temporary, videoId, 'english-shadowing', 'lesson-timing.json');
}

function saveTimingManifest(videoId, speech) {
  const manifestPath = timingManifestPath(videoId);
  fsMkdir(path.dirname(manifestPath));
  fs.writeFileSync(manifestPath, JSON.stringify({ tokens: speech.tokens, wordTimings: speech.wordTimings }), 'utf8');
}

function readTimingManifest(videoId) {
  const manifestPath = timingManifestPath(videoId);
  if (!fs.existsSync(manifestPath)) return null;
  const audioPath = path.join(PATHS.temporary, videoId, 'english-shadowing', 'lesson-source.wav');
  if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size < 1024) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.tokens) || !manifest.tokens.length || !Array.isArray(manifest.wordTimings) || !manifest.wordTimings.length) {
    throw new Error('EnglishShadowing: dữ liệu căn chỉnh đã lưu không đầy đủ; video cũ vẫn được giữ nguyên.');
  }
  return { tokens: manifest.tokens, wordTimings: manifest.wordTimings, audioPath };
}

async function synthesizeLesson(script, videoId, profile) {
  const sentences = splitIntoSentences(script.scriptText);
  if (sentences.length < 2 || sentences.length > 8) throw new Error('EnglishShadowing: AI phải tạo bài gồm 2 đến 8 câu để giữ nhịp nghỉ như video mẫu.');
  const styleId = resolveEnglishShadowingDeliveryStyle(script.deliveryStyle, script);
  const delivery = getEnglishShadowingDeliveryProfile(styleId, script);
  const segments = buildEnglishShadowingSentencePlan(sentences, styleId);
  // The shared Kokoro cache key includes speechText and the job speed but not
  // each segment's rate. Add rate-specific trailing whitespace only to the
  // TTS request; Kokoro normalizes whitespace before phonemizing, so the audio
  // stays identical apart from its requested rate while cache entries remain
  // distinct across delivery contours.
  const ttsSegments = segments.map((segment) => ({
    ...segment,
    speechText: `${segment.text}${' '.repeat(Math.round(segment.rate * 100))}`
  }));
  // The per-job copy carries this topic's native rate without changing shared EN settings.
  const settings = englishShadowingTtsSettings(getSettings(), profile, delivery);
  const audio = await withLocalTtsModel('Kokoro TTS', (lease) => synthesizeKokoroSegments(ttsSegments, videoId, {
    settings,
    lease,
    onProgress: (progress, detail) => log('INFO', 'ENGLISH_SHADOWING_TTS_PROGRESS', JSON.stringify({ videoId, progress, ...detail }))
  }));
  const durations = await Promise.all(audio.map((file) => getEnglishShadowingMediaDuration(file.path)));
  const allTokens = [];
  const allWordTimings = [];
  let cursor = 0;
  audio.forEach((file, index) => {
    allTokens.push(...(file.tokens || []));
    for (const word of file.wordTimings || []) allWordTimings.push({ ...word, startSeconds: cursor + word.startSeconds, endSeconds: cursor + word.endSeconds });
    cursor += durations[index] + (index < audio.length - 1
      ? Number(file.pauseAfterSeconds || delivery.sentencePauseSeconds)
      : 0);
  });
  const combinedAudioPath = await joinSentenceAudio(audio, videoId);
  return { audioPath: combinedAudioPath, tokens: allTokens, wordTimings: allWordTimings, segmentCount: audio.length, deliveryStyle: styleId };
}

export async function createEnglishShadowingVideoJob(job) {
  const validVoices = KOKORO_VOICES.map((voice) => voice.id);
  const requestedProfile = job.payload.englishShadowingSettings || getEnglishShadowingSettings();
  const requestedVoice = String(requestedProfile.voice || 'af_heart');
  if (!validVoices.includes(requestedVoice)) throw new Error('EnglishShadowing: giọng Kokoro đã chọn không hợp lệ. Hãy lưu lại cài đặt giọng.');
  const requestedVisualDesign = job.payload.englishShadowingVisualDesign ?? requestedProfile.visualDesign
    ?? (job.payload.englishShadowingSettings ? undefined : getEnglishShadowingVisualDesign());
  const profile = {
    ...normalizeEnglishShadowingSettings(requestedProfile, { validVoices }),
    visualDesign: normalizeEnglishShadowingVisualDesign(requestedVisualDesign)
  };
  const savedScript = job.payload.scriptId ? getScript(job.payload.scriptId) : null;
  let script = savedScript ? {
    ...savedScript,
    scriptText: savedScript.hook,
    deliveryStyle: resolveEnglishShadowingDeliveryStyle(savedScript.speechSegments?.[0]?.deliveryStyle, {
      title: savedScript.title, topic: savedScript.topic, scriptText: savedScript.hook
    })
  } : null;
  let videoId = job.payload.videoId || null;
  let previousVideoPath = null;
  const stagedFileName = videoId && job.payload.backgroundEffectOnly
    ? `${String(videoId).replace(/[^\w-]/gu, '')}-background-${String(job.id || '').replace(/[^\w-]/gu, '')}.mp4`
    : '';

  try {
    if (!script) {
      const recentTitles = db.prepare(`SELECT title,topic FROM scripts
        WHERE content_language='english-shadowing' ORDER BY created_at DESC LIMIT 30`)
        .all()
        .map(({ title, topic }) => `${String(title || '').trim()} — ${String(topic || '').trim()}`.trim());
      const candidate = parseEnglishShadowingCandidate(await generateWithChatGPT(buildEnglishShadowingPrompt({ recentTitles })));
      const scriptText = candidate.scriptText;
      const sentences = splitIntoSentences(scriptText);
      if (sentences.length < 2 || sentences.length > 8) throw new Error('EnglishShadowing: AI phải tạo bài gồm 2 đến 8 câu để giữ nhịp nghỉ như video mẫu.');
      const sentencePlan = buildEnglishShadowingSentencePlan(sentences, candidate.deliveryStyle);
      const contentHash = crypto.createHash('sha256')
        .update(`${candidate.title}\n${candidate.topic}\n${scriptText}\n${candidate.caption}\n${candidate.hashtags.join(' ')}\n${candidate.deliveryStyle}`)
        .digest('hex');
      script = {
        id: crypto.randomUUID(),
        title: candidate.title,
        topic: candidate.topic,
        scriptText,
        hook: scriptText,
        thumbnailTitle: candidate.title,
        caption: candidate.caption,
        hashtags: candidate.hashtags,
        deliveryStyle: candidate.deliveryStyle,
        contentHash,
        createdAt: new Date().toISOString(),
        speechSegments: sentencePlan
      };
      insertEnglishShadowingScript(script);
      updateJobPayload(job.id, { scriptId: script.id, englishShadowingSettings: profile, englishShadowingVisualDesign: profile.visualDesign });
      log('INFO', 'ENGLISH_SHADOWING_SCRIPT_READY', `Đã tạo kịch bản và caption riêng cho EnglishShadowing: ${script.title}.`, job.id);
    }
    if (!videoId) {
      videoId = insertEnglishShadowingVideo(script.id, profile, 'processing');
      updateJobPayload(job.id, { videoId, scriptId: script.id, englishShadowingSettings: profile, englishShadowingVisualDesign: profile.visualDesign });
    } else {
      updateVideo(videoId, { status: 'processing', last_error: null });
    }
    const existing = getVideo(videoId);
    previousVideoPath = existing?.video_path || null;
    const renderProfile = job.payload.backgroundEffectOnly ? profile : existing?.englishShadowingProfile || profile;
    let speech;
    if (job.payload.backgroundEffectOnly) {
      speech = readTimingManifest(videoId);
      if (!speech) {
        // Older Shadowing videos predate the local timing manifest. Rebuild
        // their alignment using the video's own saved voice profile; Kokoro's
        // segment cache reuses the original audio when it is still available.
        speech = await synthesizeLesson(script, videoId, renderProfile);
        saveTimingManifest(videoId, speech);
      }
    } else {
      speech = await synthesizeLesson(script, videoId, renderProfile);
      saveTimingManifest(videoId, speech);
    }
    const result = await renderEnglishShadowingVideo({
      script,
      audioPath: speech.audioPath,
      tokens: speech.tokens,
      wordTimings: speech.wordTimings,
      profile: renderProfile,
      videoId,
      backgroundThemeId: existing?.english_shadowing_theme_id || null,
      outputFileName: stagedFileName,
      onProgress: (detail) => log('INFO', 'ENGLISH_SHADOWING_RENDER_PROGRESS', JSON.stringify({ videoId, ...detail }), job.id)
    });
    updateVideo(videoId, {
      status: 'ready',
      video_path: result.videoPath,
      thumbnail_path: result.thumbnailPath,
      duration_seconds: result.durationSeconds,
      english_shadowing_profile_json: JSON.stringify(renderProfile),
      ...(job.payload.backgroundEffectOnly ? { review_status: 'pending' } : {}),
      last_error: null
    });
    if (job.payload.backgroundEffectOnly && previousVideoPath && path.resolve(previousVideoPath) !== path.resolve(result.videoPath)) {
      const safeVideoOutputDir = path.resolve(PATHS.output, videoId);
      const previousPath = path.resolve(previousVideoPath);
      if (path.dirname(previousPath) === safeVideoOutputDir) {
        try { fs.rmSync(previousPath, { force: true }); }
        catch (error) { log('WARN', 'ENGLISH_SHADOWING_OLD_RENDER_DELETE_FAILED', `Video mới đã render xong nhưng chưa xóa được bản MP4 cũ: ${error.message}`, job.id); }
      }
    }
    log('INFO', 'ENGLISH_SHADOWING_READY', `EnglishShadowing đã render xong (${result.durationSeconds.toFixed(1)} giây, ${result.pace.achievedWordsPerMinute.toFixed(1)} từ/phút).`, job.id);
    return { scriptId: script.id, videoId, ...result, sentenceCount: speech.segmentCount };
  } catch (error) {
    if (videoId && job.payload.backgroundEffectOnly && previousVideoPath && fs.existsSync(previousVideoPath)) {
      updateVideo(videoId, { status: 'ready', last_error: null });
      const safeVideoOutputDir = path.resolve(PATHS.output, videoId);
      const stagedPath = path.resolve(safeVideoOutputDir, stagedFileName);
      if (path.dirname(stagedPath) === safeVideoOutputDir) {
        try { fs.rmSync(stagedPath, { force: true }); } catch { /* Preserve the currently published file if cleanup fails. */ }
      }
      log('WARN', 'ENGLISH_SHADOWING_BACKGROUND_EFFECT_FAILED_OLD_VIDEO_KEPT', `Không áp dụng được hiệu ứng mới; giữ nguyên video hiện có: ${error.message}`, job.id);
    } else if (videoId) {
      updateVideo(videoId, { status: 'failed', last_error: error.message });
    }
    throw error;
  }
}
