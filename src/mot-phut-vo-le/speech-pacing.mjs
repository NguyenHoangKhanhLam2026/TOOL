import fs from 'node:fs';

const TARGET_SENTENCE_PAUSE_MS = Object.freeze({
  period: 360,
  question: 460,
  exclamation: 410
});

function splitSentenceTokenRanges(scriptText) {
  const text = String(scriptText ?? '').normalize('NFC').trim();
  const sentences = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('vi', { granularity: 'sentence' }).segment(text)].map(({ segment }) => segment.trim()).filter(Boolean)
    : text.split(/(?<=[.!?…])\s+/u).map((sentence) => sentence.trim()).filter(Boolean);
  let tokenIndex = 0;
  return sentences.map((sentence) => {
    const count = sentence.match(/\S+/gu)?.length || 0;
    const range = { firstTokenIndex: tokenIndex, lastTokenIndex: tokenIndex + count - 1, sentence };
    tokenIndex += count;
    return range;
  });
}

function sentencePauseMs(sentence) {
  const ending = String(sentence).trim().match(/[.!?…]["'’”)}\]]*$/u)?.[0]?.[0];
  if (ending === '?') return TARGET_SENTENCE_PAUSE_MS.question;
  if (ending === '!') return TARGET_SENTENCE_PAUSE_MS.exclamation;
  return TARGET_SENTENCE_PAUSE_MS.period;
}

function readPcm16Wave(filePath) {
  const wave = fs.readFileSync(filePath);
  if (wave.toString('ascii', 0, 4) !== 'RIFF' || wave.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('MPVL sentence pacing requires a RIFF/WAVE audio file.');
  }
  let format = null;
  let data = null;
  for (let offset = 12; offset + 8 <= wave.length;) {
    const id = wave.toString('ascii', offset, offset + 4);
    const size = wave.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > wave.length) throw new Error('Invalid WAV chunk size in MPVL audio.');
    if (id === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV fmt chunk in MPVL audio.');
      format = {
        audioFormat: wave.readUInt16LE(start), channels: wave.readUInt16LE(start + 2),
        sampleRate: wave.readUInt32LE(start + 4), byteRate: wave.readUInt32LE(start + 8),
        blockAlign: wave.readUInt16LE(start + 12), bitsPerSample: wave.readUInt16LE(start + 14)
      };
    } else if (id === 'data') {
      data = wave.subarray(start, end);
    }
    offset = end + (size & 1);
  }
  if (!format || !data || format.audioFormat !== 1 || format.bitsPerSample !== 16 || !format.channels || !format.sampleRate) {
    throw new Error('MPVL sentence pacing supports PCM 16-bit WAV audio only.');
  }
  if (format.blockAlign !== format.channels * 2 || data.length % format.blockAlign !== 0) {
    throw new Error('MPVL WAV frame alignment is invalid.');
  }
  return { format, data };
}

function writePcm16Wave(filePath, format, data) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 4, 'ascii');
  header.write('fmt ', 12, 4, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(format.sampleRate * format.blockAlign, 28);
  header.writeUInt16LE(format.blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 4, 'ascii');
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, data]));
}

/**
 * Adds only the missing silence needed to give MPVL sentence endings a clear pause.
 * The source WAV is never modified. `alignment` must refer to that source audio.
 */
export function createMotPhutVoLeSpeechPacedAudio({ audioPath, outputPath, scriptText, alignment }) {
  if (!alignment?.reliable) return { applied: false, reason: 'alignment-unreliable' };
  if (!audioPath || !outputPath || audioPath === outputPath) throw new Error('MPVL pacing needs a separate output WAV path.');
  const ranges = splitSentenceTokenRanges(scriptText);
  const tokens = String(scriptText ?? '').normalize('NFC').trim().match(/\S+/gu) || [];
  const timings = Array.isArray(alignment.wordTimings) ? alignment.wordTimings : [];
  if (!ranges.length || ranges.at(-1)?.lastTokenIndex !== tokens.length - 1 || timings.length !== tokens.length) {
    return { applied: false, reason: 'token-alignment-mismatch' };
  }
  const byIndex = new Map(timings.map((timing) => [Number(timing.tokenIndex), timing]));
  if (tokens.some((_, index) => !byIndex.has(index))) return { applied: false, reason: 'token-alignment-mismatch' };

  const { format, data } = readPcm16Wave(audioPath);
  const boundaries = [];
  for (const range of ranges.slice(0, -1)) {
    const previous = byIndex.get(range.lastTokenIndex);
    const next = byIndex.get(range.lastTokenIndex + 1);
    const end = Number(previous?.endSeconds);
    const nextStart = Number(next?.startSeconds);
    if (!Number.isFinite(end) || !Number.isFinite(nextStart) || nextStart < end) continue;
    const existingPauseMs = (nextStart - end) * 1000;
    const extraPauseMs = Math.max(0, sentencePauseMs(range.sentence) - existingPauseMs);
    if (extraPauseMs < 1) continue;
    const frame = Math.max(0, Math.min(Math.floor(data.length / format.blockAlign), Math.round(end * format.sampleRate)));
    boundaries.push({ frame, extraFrames: Math.round(extraPauseMs * format.sampleRate / 1000) });
  }
  if (!boundaries.length) return { applied: false, reason: 'pauses-already-long-enough' };

  const silence = (frameCount) => Buffer.alloc(frameCount * format.blockAlign);
  let pacedData = data;
  for (const boundary of boundaries.sort((left, right) => right.frame - left.frame)) {
    const offset = boundary.frame * format.blockAlign;
    pacedData = Buffer.concat([
      pacedData.subarray(0, offset), silence(boundary.extraFrames), pacedData.subarray(offset)
    ]);
  }
  writePcm16Wave(outputPath, format, pacedData);
  return {
    applied: true, outputPath, insertedPauseCount: boundaries.length,
    insertedDurationSeconds: boundaries.reduce((sum, boundary) => sum + boundary.extraFrames, 0) / format.sampleRate
  };
}
