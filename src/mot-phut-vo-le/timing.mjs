export function countVietnameseSyllables(text) {
  return String(text || '').normalize('NFC').trim().split(/\s+/u).filter(Boolean).length;
}

export function estimateVietnameseDurationSeconds(text, speed = 1) {
  const syllables = countVietnameseSyllables(text);
  const rate = Math.max(0.75, Math.min(1.25, Number(speed) || 1));
  return syllables / (4.1 * rate);
}

export function validateAudioDuration(actualSeconds) {
  const duration = Number(actualSeconds);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Audio VieNeu có thời lượng không hợp lệ.');
  return { actualSeconds: duration, valid: true };
}
