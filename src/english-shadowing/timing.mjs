import { ENGLISH_SHADOWING_PROFILE } from './profile.mjs';

const ENGLISH_WORD = /[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/gu;

export function countEnglishShadowingWords(text) {
  return (String(text || '').match(ENGLISH_WORD) || []).length;
}

/**
 * Convert a sample-based words-per-minute target into a stable 30 fps duration
 * and a request-local FFmpeg atempo factor. Word boundaries must be divided by
 * atempo after the audio is stretched/compressed so highlight stays in sync.
 */
export function planEnglishShadowingPace({
  text,
  sourceAudioDurationSeconds,
  targetWordsPerMinute = ENGLISH_SHADOWING_PROFILE.reading.targetWordsPerMinute,
  fps = ENGLISH_SHADOWING_PROFILE.canvas.fps,
  minAtempo = 0.75,
  maxAtempo = 1.33
} = {}) {
  const wordCount = countEnglishShadowingWords(text);
  const duration = Number(sourceAudioDurationSeconds);
  const rate = Number(targetWordsPerMinute);
  const frameRate = Number(fps);
  if (!wordCount) throw new Error('EnglishShadowing: không thể căn tốc độ cho kịch bản rỗng.');
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('EnglishShadowing: thời lượng audio không hợp lệ.');
  if (!Number.isFinite(rate) || rate < 80 || rate > 220) throw new Error('EnglishShadowing: WPM mục tiêu ngoài giới hạn.');
  if (!Number.isFinite(frameRate) || frameRate < 1 || frameRate > 60) throw new Error('EnglishShadowing: frame rate không hợp lệ.');

  const targetDurationSeconds = wordCount * 60 / rate;
  const targetFrames = Math.max(1, Math.round(targetDurationSeconds * frameRate));
  const frameAlignedDurationSeconds = targetFrames / frameRate;
  const requestedAtempo = duration / frameAlignedDurationSeconds;
  const atempo = Math.max(minAtempo, Math.min(maxAtempo, requestedAtempo));
  const finalDurationSeconds = duration / atempo;

  return Object.freeze({
    wordCount,
    targetWordsPerMinute: rate,
    sourceAudioDurationSeconds: duration,
    frameRate,
    targetFrames,
    targetDurationSeconds: frameAlignedDurationSeconds,
    requestedAtempo,
    atempo,
    tempoWasClamped: atempo !== requestedAtempo,
    finalDurationSeconds,
    achievedWordsPerMinute: wordCount * 60 / finalDurationSeconds,
    wordTimeScale: 1 / atempo
  });
}

export function scaleEnglishShadowingWordTimings(wordTimings, pacePlan) {
  const scale = Number(pacePlan?.wordTimeScale);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('EnglishShadowing: hệ số đồng bộ highlight không hợp lệ.');
  return (Array.isArray(wordTimings) ? wordTimings : []).map((word) => ({
    ...word,
    startSeconds: Math.max(0, Number(word.startSeconds || 0) * scale),
    endSeconds: Math.max(0, Number(word.endSeconds || 0) * scale)
  }));
}
