import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { KOKORO_MODEL_DIR, KOKORO_MODEL_MARKER, KOKORO_MODEL_PATH, KOKORO_PYTHON_BIN, KOKORO_VOICES_PATH, PATHS, ROOT } from '../config.mjs';
import { alignSpeechBatchLocally } from './local-alignment.mjs';
import { mapWordBoundariesToTokens } from '../../packages/audio-highlight/highlight-engine.mjs';
import { describeSpawnError } from '../utils/process-errors.mjs';

export const KOKORO_VOICES = Object.freeze([
  { id: 'af_heart', label: 'Heart · Nữ · Mỹ' },
  { id: 'af_bella', label: 'Bella · Nữ · Mỹ' },
  { id: 'af_nicole', label: 'Nicole · Nữ · Mỹ' },
  { id: 'af_sarah', label: 'Sarah · Nữ · Mỹ' },
  { id: 'af_aoede', label: 'Aoede · Nữ · Mỹ' },
  { id: 'af_kore', label: 'Kore · Nữ · Mỹ' },
  { id: 'af_alloy', label: 'Alloy · Nữ · Mỹ' },
  { id: 'af_jessica', label: 'Jessica · Nữ · Mỹ' },
  { id: 'af_nova', label: 'Nova · Nữ · Mỹ' },
  { id: 'af_river', label: 'River · Nữ · Mỹ' },
  { id: 'af_sky', label: 'Sky · Nữ · Mỹ' },
  { id: 'am_michael', label: 'Michael · Nam · Mỹ' },
  { id: 'am_fenrir', label: 'Fenrir · Nam · Mỹ' },
  { id: 'am_puck', label: 'Puck · Nam · Mỹ' },
  { id: 'am_adam', label: 'Adam · Nam · Mỹ' },
  { id: 'am_echo', label: 'Echo · Nam · Mỹ' },
  { id: 'am_eric', label: 'Eric · Nam · Mỹ' },
  { id: 'am_liam', label: 'Liam · Nam · Mỹ' },
  { id: 'am_onyx', label: 'Onyx · Nam · Mỹ' },
  { id: 'am_santa', label: 'Santa · Nam · Mỹ' },
  { id: 'bf_emma', label: 'Emma · Nữ · Anh' },
  { id: 'bf_isabella', label: 'Isabella · Nữ · Anh' },
  { id: 'bf_alice', label: 'Alice · Nữ · Anh' },
  { id: 'bf_lily', label: 'Lily · Nữ · Anh' },
  { id: 'bm_fable', label: 'Fable · Nam · Anh' },
  { id: 'bm_george', label: 'George · Nam · Anh' },
  { id: 'bm_daniel', label: 'Daniel · Nam · Anh' },
  { id: 'bm_lewis', label: 'Lewis · Nam · Anh' }
]);

const MODEL_VERSION = 'kokoro-onnx-0.6.1-kokoro-v1.0';
const PYTHON_SCRIPT = path.join(ROOT, 'packages', 'tts-engine', 'python', 'synthesize_kokoro.py');
const MINIMUM_RAM_MB = 2560;
const MINIMUM_REMAINING_RAM_MB = 1024;
const MEMORY_WAIT_TIMEOUT_SECONDS = 5 * 60;

function hasFile(file, minimumBytes = 1) {
  try { return fs.statSync(file).isFile() && fs.statSync(file).size >= minimumBytes; }
  catch { return false; }
}

export function kokoroModelStatus(settings = {}) {
  let marker = {};
  try { marker = JSON.parse(fs.readFileSync(KOKORO_MODEL_MARKER, 'utf8')); }
  catch { /* Install marker not written yet. */ }
  const installed = marker.provider === 'kokoro-82m'
    && marker.backend === 'onnxruntime-cpu'
    && fs.existsSync(KOKORO_PYTHON_BIN)
    && hasFile(KOKORO_MODEL_PATH, 100_000_000)
    && hasFile(KOKORO_VOICES_PATH, 10_000_000);
  return {
    installed,
    ready: installed,
    model: 'Kokoro-82M · ONNX CPU',
    modelDir: KOKORO_MODEL_DIR,
    python: KOKORO_PYTHON_BIN,
    version: marker.version || MODEL_VERSION,
    modelBytes: hasFile(KOKORO_MODEL_PATH) ? fs.statSync(KOKORO_MODEL_PATH).size : 0,
    minimumRamMb: Number(settings.localTtsMinFreeRamMb) || MINIMUM_RAM_MB,
    minimumRemainingRamMb: Number(settings.localTtsMinRemainingRamMb) || MINIMUM_REMAINING_RAM_MB,
    freeRamMb: Math.round(os.freemem() / (1024 * 1024)),
    device: 'CPUExecutionProvider',
    vramMb: 0
  };
}

function runWorker(requestPath, { onEvent = () => {}, onSpawn = () => {}, timeoutMs = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(KOKORO_PYTHON_BIN, [PYTHON_SCRIPT, requestPath], {
        cwd: ROOT, windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1', CUDA_VISIBLE_DEVICES: '' }
      });
    } catch (error) { reject(describeSpawnError(KOKORO_PYTHON_BIN, error)); return; }
    onSpawn(child.pid || null);
    let stderr = '';
    let pending = '';
    let workerFailure = null;
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stderr?.on('data', (chunk) => {
      const value = chunk.toString();
      stderr += value;
      pending += value;
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() || '';
      for (const line of lines) {
        const eventAt = line.indexOf('KOKORO_');
        if (eventAt < 0) continue;
        const separator = line.indexOf(':', eventAt);
        if (separator < 0) continue;
        try {
          const kind = line.slice(eventAt, separator);
          const value = JSON.parse(line.slice(separator + 1));
          if (kind === 'KOKORO_ERROR') workerFailure = value;
          onEvent(kind, value);
        }
        catch { /* Keep malformed diagnostics in stderr. */ }
      }
    });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    child.once('error', (error) => finish(describeSpawnError(KOKORO_PYTHON_BIN, error)));
    child.once('close', (code) => {
      if (code !== 0 && workerFailure?.code === 'INSUFFICIENT_RAM') {
        const error = new Error(workerFailure.message || 'Kokoro TTS bị dừng vì không đủ RAM.');
        error.code = 'KOKORO_INSUFFICIENT_RAM';
        error.permanentTtsMemory = workerFailure.retryable === false;
        error.memory = workerFailure.memory || null;
        finish(error);
        return;
      }
      if (code === 0) finish();
      else finish(new Error(timedOut
        ? 'Kokoro TTS vượt quá thời gian tối đa 30 phút; worker đã được dừng.'
        : `Kokoro TTS worker kết thúc mã ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

function readTiming(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { wordBoundaries: Array.isArray(value.wordBoundaries) ? value.wordBoundaries : [], source: value.source || null, warning: value.warning || null };
  } catch { return { wordBoundaries: [], source: null, warning: 'Không đọc được metadata căn chỉnh Kokoro.' }; }
}

async function makeAudio(items, { settings = {}, onProgress = () => {}, onWorkerPid = () => {} } = {}) {
  const status = kokoroModelStatus(settings);
  if (!status.installed) throw new Error('Kokoro chưa được cài đủ. Chạy `npm run setup:kokoro` để cài worker ONNX và model vào ổ đĩa.');
  const requestPath = path.join(PATHS.temporary, `kokoro-${process.pid}-${crypto.randomUUID()}.request.json`);
  const request = {
    modelPath: KOKORO_MODEL_PATH,
    voicesPath: KOKORO_VOICES_PATH,
    modelVersion: MODEL_VERSION,
    minimumAvailableRamMb: status.minimumRamMb,
    minimumRemainingRamMb: status.minimumRemainingRamMb,
    memoryWaitTimeoutSeconds: MEMORY_WAIT_TIMEOUT_SECONDS,
    items: items.map((item) => ({
      text: item.speechText || item.text,
      voice: item.voiceName || item.voice || settings.kokoroEnVoice || 'af_heart',
      speed: Math.max(0.5, Math.min(1.25, Number(item.rate ?? settings.kokoroEnSpeed) || 1)),
      outputPath: item.rawPath || item.outputPath,
      timingPath: item.rawTimingPath || item.timingPath
    }))
  };
  fs.writeFileSync(requestPath, JSON.stringify(request), 'utf8');
  try {
    onProgress({ phase: 'kokoro-before-load', memoryBefore: { freeRamMb: status.freeRamMb } });
    await runWorker(requestPath, {
      onSpawn: (pid) => { onWorkerPid(pid); onProgress({ phase: 'kokoro-worker-started', workerPid: pid }); },
      onEvent: (kind, value) => {
        if (kind === 'KOKORO_PROGRESS') onProgress({ phase: 'kokoro-synthesis', ...value });
        if (kind === 'KOKORO_MEMORY') onProgress({ phase: `kokoro-${value.phase}`, workerMemory: value });
      }
    });
    for (const item of items) {
      const audioPath = item.rawPath || item.outputPath;
      const timingPath = item.rawTimingPath || item.timingPath;
      if (!hasFile(audioPath, 1024)) throw new Error(`Kokoro không tạo được audio cho đoạn ${item.segmentId || 'preview'}.`);
      if (!hasFile(timingPath, 1)) throw new Error(`Kokoro thiếu metadata audio cho đoạn ${item.segmentId || 'preview'}.`);
    }
    onProgress({ phase: 'kokoro-worker-exited', workerExited: true, memoryAfter: { freeRamMb: Math.round(os.freemem() / (1024 * 1024)) } });
  } finally {
    fs.rmSync(requestPath, { force: true });
  }
}

export async function synthesizeKokoroSegments(segments, videoId, { settings = {}, onProgress = () => {}, lease = null } = {}) {
  const workDir = path.join(PATHS.temporary, videoId, 'audio');
  const stagingDir = path.join(PATHS.temporary, videoId, 'kokoro-staging');
  const cacheDir = path.join(PATHS.temporary, 'audio-cache');
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const voice = String(settings.kokoroEnVoice || 'af_heart');
  if (!KOKORO_VOICES.some((item) => item.id === voice)) throw new Error(`Giọng Kokoro không hợp lệ: ${voice}.`);
  const speed = Math.max(0.5, Math.min(1.25, Number(settings.kokoroEnSpeed) || 1));
  const modelStatus = kokoroModelStatus(settings);
  const files = [];
  const pending = [];
  const pendingBySegment = new Map();
  for (const [index, segment] of segments.entries()) {
    const hash = crypto.createHash('sha256')
      .update(`${MODEL_VERSION}|${voice}|${speed}|${segment.speechText || segment.text}`)
      .digest('hex');
    const cached = path.join(cacheDir, `${hash}.kokoro.wav`);
    const cachedTiming = `${cached}.wordtimings.json`;
    const target = path.join(workDir, `${String(segment.order + 1).padStart(3, '0')}-${segment.segmentId}.wav`);
    if (!hasFile(cached, 1024) || !hasFile(cachedTiming, 1)) {
      const token = crypto.randomUUID();
      const rawPath = path.join(stagingDir, `${String(index + 1).padStart(3, '0')}-${token}.raw.wav`);
      const rawTimingPath = `${rawPath}.wordtimings.json`;
      const item = { ...segment, voiceName: voice, rate: speed, rawPath, rawTimingPath, cachePath: cached, cacheTimingPath: cachedTiming };
      pending.push(item);
      pendingBySegment.set(segment.segmentId, item);
    }
    files.push({
      ...segment, index: segment.order + 1, voice: voice, voiceName: voice, rate: speed,
      path: target, audioPath: target, cachePath: cached, cacheTimingPath: cachedTiming,
      wordTimings: [], tokens: [], alignment: null, alignmentSource: null,
      alignmentWarning: null, modelVersion: modelStatus.version
    });
  }

  if (pending.length) {
    try {
      await makeAudio(pending, {
        settings,
        onProgress: (detail) => {
          if (detail.phase.startsWith('kokoro-')) lease?.update({
            phase: detail.phase,
          ...(detail.index ? { segmentIndex: Number(detail.index), segmentCount: pending.length } : {}),
            ...(detail.workerMemory ? { workerMemory: detail.workerMemory } : {}),
            ...(detail.memoryBefore ? { memoryBefore: detail.memoryBefore } : {}),
            ...(detail.memoryAfter ? { memoryAfter: detail.memoryAfter, workerExited: true } : {})
          });
          if (detail.phase === 'kokoro-synthesis') onProgress(Math.min(0.62, (Number(detail.index) / Math.max(1, pending.length)) * 0.62), { ...detail, total: pending.length });
          else onProgress(0, detail);
        },
        onWorkerPid: (workerPid) => lease?.update({ phase: 'kokoro-worker-started', workerPid, workerExited: false })
      });
      for (const item of pending) {
        fs.copyFileSync(item.rawPath, item.cachePath);
        fs.copyFileSync(item.rawTimingPath, item.cacheTimingPath);
      }
    } finally {
      for (const item of pending) {
        fs.rmSync(item.rawPath, { force: true });
        fs.rmSync(item.rawTimingPath, { force: true });
      }
    }
  }

  const alignmentQueue = [];
  for (const file of files) {
    const staged = pendingBySegment.get(file.segmentId);
    const source = staged?.cachePath || file.cachePath;
    if (!hasFile(source, 1024)) throw new Error(`Không có audio Kokoro hợp lệ cho đoạn ${file.segmentId}.`);
    fs.copyFileSync(source, file.path);
    const metadata = readTiming(file.cacheTimingPath);
    const mapped = mapWordBoundariesToTokens(file.text, metadata.wordBoundaries, file.segmentId, { language: 'en' });
    file.wordTimings = mapped.wordTimings;
    file.tokens = mapped.tokens;
    file.alignment = mapped.alignment;
    file.alignmentSource = metadata.source;
    file.alignmentWarning = metadata.warning || (mapped.alignment.reliable ? null : 'Kokoro không trả WordBoundary; đang dùng forced alignment local.');
    if (settings.highlightEnabled !== false && !mapped.alignment.reliable) alignmentQueue.push({
      segmentId: file.segmentId, audioPath: file.path, text: file.speechText || file.text, language: 'en', cachedTimingPath: file.cacheTimingPath
    });
  }

  if (alignmentQueue.length) {
    lease?.update({ phase: 'kokoro-local-alignment', workerPid: null, workerExited: true });
    const aligned = await alignSpeechBatchLocally(alignmentQueue);
    for (const [index, queued] of alignmentQueue.entries()) {
      const file = files.find((candidate) => candidate.segmentId === queued.segmentId);
      const metadata = aligned[index] || { wordBoundaries: [], warning: 'Không nhận được kết quả căn chỉnh Kokoro.' };
      const mapped = mapWordBoundariesToTokens(file.text, metadata.wordBoundaries, file.segmentId, { language: 'en' });
      if (mapped.alignment.mappedTokenCount > file.alignment.mappedTokenCount) {
        file.wordTimings = mapped.wordTimings;
        file.tokens = mapped.tokens;
        file.alignment = mapped.alignment;
        file.alignmentSource = metadata.source || 'stable-ts-local';
        file.alignmentWarning = mapped.alignment.reliable ? null : metadata.warning || `Forced alignment còn thiếu ${mapped.alignment.unmatchedTokenCount} từ.`;
        fs.writeFileSync(queued.cachedTimingPath, JSON.stringify({ source: file.alignmentSource, wordBoundaries: metadata.wordBoundaries, warning: file.alignmentWarning, alignment: mapped.alignment }, null, 2), 'utf8');
      } else if (metadata.warning) file.alignmentWarning = metadata.warning;
      onProgress(0.62 + (index + 1) / alignmentQueue.length * 0.36, { phase: 'kokoro-local-alignment', index: index + 1, total: alignmentQueue.length, segmentId: file.segmentId });
    }
  }
  files.forEach((file, index) => onProgress(1, { phase: 'audio', index: index + 1, total: files.length, language: 'en', segmentId: file.segmentId }));
  return files;
}

export async function synthesizeKokoroPreview({ text, voice, speed, outputPath, timingPath, settings = {}, lease = null }) {
  const status = kokoroModelStatus(settings);
  if (!status.installed) throw new Error('Kokoro chưa được cài đủ. Chạy `npm run setup:kokoro`.');
  if (!KOKORO_VOICES.some((item) => item.id === voice)) throw new Error(`Giọng Kokoro không hợp lệ: ${voice}.`);
  const id = `preview-${crypto.randomUUID()}`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const previewItem = {
    text, speechText: text, voiceName: voice, rate: Math.max(0.5, Math.min(1.25, Number(speed) || 1)), segmentId: id,
    rawPath: outputPath, rawTimingPath: timingPath
  };
  try {
    await makeAudio([previewItem], { settings, onWorkerPid: (workerPid) => lease?.update({ phase: 'kokoro-worker-started', workerPid, workerExited: false }), onProgress: (detail) => {
      if (detail.phase.startsWith('kokoro-')) lease?.update({ phase: detail.phase, ...(detail.workerMemory ? { workerMemory: detail.workerMemory } : {}), ...(detail.memoryAfter ? { memoryAfter: detail.memoryAfter, workerExited: true } : {}) });
    } });
  } catch (error) {
    fs.rmSync(outputPath, { force: true });
    fs.rmSync(timingPath, { force: true });
    throw error;
  }
  return { outputPath, timingPath, voice, model: 'kokoro-82m' };
}
