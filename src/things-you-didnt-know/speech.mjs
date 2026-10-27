import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../config.mjs';
import { synthesizeKokoroSegments } from '../tts/kokoro-tts.mjs';

const PERIOD_PAUSE_MS = 360;
const QUESTION_PAUSE_MS = 460;

function splitNarrationSentences(value) {
  const text = String(value ?? '').normalize('NFC').trim();
  if (!text) throw new Error('Things narration không có nội dung để tạo giọng đọc.');
  const sentences = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)].map((item) => item.segment.trim()).filter(Boolean)
    : text.split(/(?<=[.!?])\s+/u).map((item) => item.trim()).filter(Boolean);
  if (!sentences.length) throw new Error('Không tách được câu Things narration để tạo giọng đọc.');
  return sentences;
}

function readPcm16Wav(filePath) {
  const wav = fs.readFileSync(filePath);
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Kokoro trả về WAV không hợp lệ khi ghép giọng Things.');
  }
  let format = null;
  let data = null;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > wav.length) throw new Error('WAV Kokoro bị thiếu dữ liệu khi ghép giọng Things.');
    if (id === 'fmt ') {
      if (size < 16) throw new Error('Thông tin định dạng WAV Kokoro không đầy đủ.');
      format = {
        codec: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2),
        sampleRate: wav.readUInt32LE(start + 4), byteRate: wav.readUInt32LE(start + 8),
        blockAlign: wav.readUInt16LE(start + 12), bitsPerSample: wav.readUInt16LE(start + 14)
      };
    } else if (id === 'data') data = wav.subarray(start, end);
    offset = end + (size % 2);
  }
  if (!format || !data || format.codec !== 1 || format.bitsPerSample !== 16) {
    throw new Error('Giọng Things cần WAV PCM 16-bit để ghép khoảng nghỉ an toàn.');
  }
  return { ...format, data };
}

function buildPcm16Wav(data, format) {
  if (data.length > 0xffffffff - 36) throw new Error('Audio Things vượt giới hạn WAV PCM.');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(format.sampleRate * format.blockAlign, 28);
  header.writeUInt16LE(format.blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function sentencePause(sentence, index, count) {
  if (index === count - 1) return 0;
  return /[!?]["')\]]*$/u.test(sentence) ? QUESTION_PAUSE_MS : PERIOD_PAUSE_MS;
}

/** Generate Things narration in sentence-sized Kokoro units, then join it with short, predictable rests.
 * The generic EN/ZH TTS path is intentionally untouched. Word timings are aligned once on the final audio.
 */
export async function synthesizeThingsNarration({ text, voice, speed, outputPath, timingPath, settings = {} }) {
  const sentences = splitNarrationSentences(text);
  const batchId = 'things-speech-' + crypto.randomUUID();
  const batchSettings = {
    ...settings,
    kokoroEnVoice: voice,
    kokoroEnSpeed: speed,
    // Align once after joining, so the added pauses are reflected in the final word timings.
    highlightEnabled: false
  };
  try {
    const files = await synthesizeKokoroSegments(sentences.map((sentence, order) => ({
      segmentId: `sentence-${order + 1}`,
      order,
      text: sentence,
      speechText: sentence
    })), batchId, { settings: batchSettings });
    const chunks = files.map((file) => readPcm16Wav(file.path));
    const format = chunks[0];
    for (const chunk of chunks.slice(1)) {
      if (chunk.codec !== format.codec || chunk.channels !== format.channels
        || chunk.sampleRate !== format.sampleRate || chunk.bitsPerSample !== format.bitsPerSample) {
        throw new Error('Các câu Kokoro có định dạng WAV khác nhau, không thể ghép audio Things.');
      }
    }
    const parts = [];
    for (const [index, chunk] of chunks.entries()) {
      parts.push(chunk.data);
      const pauseMs = sentencePause(sentences[index], index, sentences.length);
      if (pauseMs > 0) {
        const frames = Math.round(format.sampleRate * pauseMs / 1000);
        parts.push(Buffer.alloc(frames * format.blockAlign));
      }
    }
    const data = Buffer.concat(parts);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buildPcm16Wav(data, format));
    fs.writeFileSync(timingPath, JSON.stringify({
      provider: 'kokoro-onnx-cpu', source: 'things-sentence-paced-v1', wordBoundaries: [],
      warning: 'Things narration được tổng hợp theo câu; cần căn timing trên audio đã ghép.'
    }, null, 2), 'utf8');
    return { outputPath, timingPath, sentenceCount: sentences.length, pauseAfterSentenceMs: PERIOD_PAUSE_MS };
  } finally {
    fs.rmSync(path.join(PATHS.temporary, batchId), { recursive: true, force: true });
  }
}
