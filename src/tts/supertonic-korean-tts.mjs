import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ROOT, SUPERTONIC_MODEL_DIR, SUPERTONIC_PYTHON_BIN } from '../config.mjs';
import { describeSpawnError } from '../utils/process-errors.mjs';

const MODEL_VERSION = 'supertonic-3-1.3.1';
const PYTHON_WORKER = path.join(ROOT, 'packages', 'tts-engine', 'python', 'synthesize_supertonic.py');
const REQUIRED_MODEL_FILES = [
  path.join(SUPERTONIC_MODEL_DIR, 'config.json'),
  path.join(SUPERTONIC_MODEL_DIR, 'onnx', 'text_encoder.onnx'),
  path.join(SUPERTONIC_MODEL_DIR, 'onnx', 'duration_predictor.onnx'),
  path.join(SUPERTONIC_MODEL_DIR, 'onnx', 'vector_estimator.onnx'),
  path.join(SUPERTONIC_MODEL_DIR, 'onnx', 'vocoder.onnx'),
  ...['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'].map((voice) => path.join(SUPERTONIC_MODEL_DIR, 'voice_styles', `${voice}.json`))
];

export const SUPERTONIC_KOREAN_VOICES = Object.freeze([
  ...['F1', 'F2', 'F3', 'F4', 'F5'].map((id, index) => ({ id, label: `${id} · Nữ ${index + 1}` })),
  ...['M1', 'M2', 'M3', 'M4', 'M5'].map((id, index) => ({ id, label: `${id} · Nam ${index + 1}` }))
]);

function isFile(file, minimumBytes = 1) {
  try { return fs.statSync(file).isFile() && fs.statSync(file).size >= minimumBytes; }
  catch { return false; }
}

export function supertonicKoreanStatus() {
  const missingFiles = REQUIRED_MODEL_FILES.filter((file) => !isFile(file, file.endsWith('.onnx') ? 1_000_000 : 1));
  const installed = isFile(SUPERTONIC_PYTHON_BIN) && missingFiles.length === 0;
  return {
    installed,
    ready: installed,
    model: 'Supertonic 3 · tiếng Hàn · CPU',
    modelDir: SUPERTONIC_MODEL_DIR,
    python: SUPERTONIC_PYTHON_BIN,
    version: MODEL_VERSION,
    voices: SUPERTONIC_KOREAN_VOICES,
    missingFiles
  };
}

function safeId(value) { return String(value || 'segment').replace(/[^\w-]+/gu, '-').slice(0, 100) || 'segment'; }

function runWorker(requestPath, { onEvent = () => {}, onSpawn = () => {}, timeoutMs = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(SUPERTONIC_PYTHON_BIN, [PYTHON_WORKER, requestPath], {
        cwd: ROOT,
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          SUPERTONIC_CACHE_DIR: SUPERTONIC_MODEL_DIR,
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
          CUDA_VISIBLE_DEVICES: ''
        }
      });
    } catch (error) { reject(describeSpawnError(SUPERTONIC_PYTHON_BIN, error)); return; }
    onSpawn(child.pid || null);
    let stderr = '';
    let pending = '';
    let workerFailure = null;
    let settled = false;
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* Worker may already be gone. */ }
    }, timeoutMs);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    child.stderr?.on('data', (chunk) => {
      const value = chunk.toString();
      stderr = `${stderr}${value}`.slice(-12_000);
      pending += value;
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() || '';
      for (const line of lines) {
        const marker = line.indexOf('SUPERTONIC_');
        if (marker < 0) continue;
        const separator = line.indexOf(':', marker);
        if (separator < 0) continue;
        try {
          const kind = line.slice(marker, separator);
          const value = JSON.parse(line.slice(separator + 1));
          if (kind === 'SUPERTONIC_ERROR') workerFailure = value;
          onEvent(kind, value);
        } catch { /* Preserve diagnostics when an event line is malformed. */ }
      }
    });
    child.once('error', (error) => finish(describeSpawnError(SUPERTONIC_PYTHON_BIN, error)));
    child.once('close', (code) => {
      if (code === 0) return finish();
      const detail = workerFailure?.message || stderr.slice(-3000) || `exit ${code}`;
      finish(new Error(`Supertonic 3 Korean worker failed: ${detail}`));
    });
  });
}

export async function synthesizeSupertonicKoreanSegments(segments, videoId, {
  settings = {}, lease = null, onProgress = () => {}
} = {}) {
  const status = supertonicKoreanStatus();
  if (!status.ready) throw new Error(`Supertonic 3 chưa sẵn sàng. Kiểm tra Python và model tại ${SUPERTONIC_MODEL_DIR}.`);
  const voice = String(settings.supertonicKoreanVoice || 'F1');
  if (!SUPERTONIC_KOREAN_VOICES.some((item) => item.id === voice)) throw new Error('Giọng Supertonic tiếng Hàn không hợp lệ.');
  const speed = Math.min(1.4, Math.max(0.7, Number(settings.supertonicKoreanSpeed) || 1));
  if (segments.some((segment) => segment.language !== 'ko')) throw new Error('Supertonic 3 Korean chỉ đọc các đoạn tiếng Hàn.');

  const workDir = path.join(PATHS.temporary, videoId, 'audio');
  const cacheDir = path.join(PATHS.temporary, 'audio-cache');
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const items = [];
  const pending = [];

  for (const [index, segment] of segments.entries()) {
    const text = String(segment.speechText || segment.text || '').trim();
    if (!text) throw new Error(`Đoạn tiếng Hàn ${segment.segmentId} không có nội dung để đọc.`);
    const hash = crypto.createHash('sha256').update(JSON.stringify([MODEL_VERSION, voice, speed, text])).digest('hex');
    const cachePath = path.join(cacheDir, `${hash}.supertonic-ko.wav`);
    const cacheTimingPath = `${cachePath}.wordtimings.json`;
    const outputPath = segment.outputPath || segment.rawPath || path.join(workDir, `${String(segment.order + 1).padStart(3, '0')}-${safeId(segment.segmentId)}.wav`);
    const timingPath = `${outputPath}.wordtimings.json`;
    const item = {
      ...segment,
      text,
      speechText: text,
      voiceName: voice,
      rate: speed,
      path: outputPath,
      audioPath: outputPath,
      cachePath,
      cacheTimingPath,
      timingPath
    };
    items.push(item);
    if (isFile(cachePath, 1024) && isFile(cacheTimingPath)) {
      fs.copyFileSync(cachePath, outputPath);
      fs.copyFileSync(cacheTimingPath, timingPath);
    } else {
      pending.push({ segment, item, index });
    }
  }

  if (pending.length) {
    const requestPath = path.join(PATHS.temporary, `supertonic-ko-${process.pid}-${crypto.randomUUID()}.request.json`);
    const requestItems = pending.map(({ segment, item }) => ({
      segmentId: segment.segmentId,
      text: item.text,
      voice,
      speed,
      outputPath: item.cachePath,
      timingPath: item.cacheTimingPath
    }));
    try {
      fs.writeFileSync(requestPath, JSON.stringify({ modelDir: SUPERTONIC_MODEL_DIR, threads: 4, items: requestItems }), 'utf8');
      await runWorker(requestPath, {
        onSpawn: (pid) => lease?.update({ phase: 'supertonic-worker-started', workerPid: pid, workerExited: false }),
        onEvent: (kind, detail) => {
          if (kind === 'SUPERTONIC_MEMORY') lease?.update({ phase: `supertonic-${detail.phase || 'running'}`, workerMemory: detail });
          if (kind === 'SUPERTONIC_PROGRESS') {
            const done = Number(detail.index) || 0;
            lease?.update({ phase: 'supertonic-synthesis', segmentIndex: done, segmentCount: pending.length, workerPid: null, workerExited: true });
            onProgress(done / pending.length, { phase: 'supertonic-synthesis', index: done, total: pending.length, language: 'ko', segmentId: detail.segmentId });
          }
        }
      });
      for (const { item } of pending) {
        if (!isFile(item.cachePath, 1024) || !isFile(item.cacheTimingPath)) throw new Error('Supertonic 3 không tạo đủ WAV và thông tin thời gian cho đoạn tiếng Hàn.');
        fs.copyFileSync(item.cachePath, item.path);
        fs.copyFileSync(item.cacheTimingPath, item.timingPath);
      }
    } finally {
      fs.rmSync(requestPath, { force: true });
    }
  }

  return items;
}

export async function synthesizeSupertonicKoreanPreview({ text, voice = 'F1', outputPath, settings = {}, onProgress = () => {} }) {
  const segment = {
    segmentId: `ko-preview-${crypto.randomUUID()}`,
    language: 'ko',
    text: String(text || '').trim(),
    speechText: String(text || '').trim(),
    order: 0,
    outputPath
  };
  const audio = await synthesizeSupertonicKoreanSegments([segment], 'voice-previews', {
    settings: { ...settings, supertonicKoreanVoice: voice },
    onProgress
  });
  return audio[0];
}
