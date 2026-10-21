import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, PATHS, VIENEU_PYTHON_BIN, VIENEU_MODEL_DIR, VIENEU_MODEL_MARKER, VIENEU_ONNX_DIR, VIENEU_CODEC_DIR, VIENEU_HF_HOME } from '../config.mjs';
import { createSpeechSegments, mapWordBoundariesToTokens, prepareSpeechText } from '../../packages/audio-highlight/highlight-engine.mjs';
import { alignSpeechBatchLocally } from './local-alignment.mjs';
import { describeSpawnError } from '../utils/process-errors.mjs';

export const VIENEU_VOICES = Object.freeze([
  'Hải Đăng', 'Trúc Ly', 'Thiện Minh', 'Mai Anh', 'Thùy Dung', 'Thiền Tâm Đức', 'Ngọc Huyền', 'Quang Sơn', 'Ngọc Trân',
  'Adam bựa', 'Minh Đức', 'Phạm Tuyên', 'Xuân Vĩnh', 'Thanh Bình', 'Ngọc Linh', 'Đoan Trang', 'Quỳnh Anh', 'Quốc Tuấn',
  'Adam', 'Thái Sơn', 'Thục Đoan', 'Minh Triết', 'Mỹ Duyên', 'Đức Trí', 'Kim Thanh'
]);

// Keep the inter-process lock beside the installed model. The private AppData
// directory is user-managed and has produced EPERM errors in this project.
const MODEL_LOCK = path.join(VIENEU_MODEL_DIR, '.model.lock');
const PYTHON_SCRIPT = path.join(ROOT, 'packages', 'tts-engine', 'python', 'synthesize_vieneu.py');
const MINIMUM_RAM_MB = 2560;
const MINIMUM_REMAINING_RAM_MB = 1024;
const MODEL_VERSION = 'vieneu-v3-turbo-onnx-fp32-v1';

function hasNonEmptyFile(directory, name) {
  try {
    const stat = fs.statSync(path.join(directory, name));
    return stat.isFile() && stat.size > 0;
  } catch { return false; }
}

export function vieneuModelStatus(settings = {}) {
  let installed = false;
  try {
    const marker = JSON.parse(fs.readFileSync(VIENEU_MODEL_MARKER, 'utf8'));
    const backboneFiles = [
      'vieneu_prefill.onnx', 'vieneu_decode_step.onnx', 'vieneu_acoustic_cached.onnx',
      'vieneu_backbone_shared.data', 'vieneu_v3_heads.npz', 'config.json', 'tokenizer.json'
    ];
    const codecFiles = [
      'moss_audio_tokenizer_decode_full.onnx', 'moss_audio_tokenizer_decode_shared.data',
      'moss_audio_tokenizer_decode_step.onnx', 'moss_audio_tokenizer_encode.onnx', 'moss_audio_tokenizer_encode.data'
    ];
    installed = marker.provider === 'vieneu-v3-turbo'
      && marker.backend === 'onnx-cpu'
      && marker.precision === 'fp32'
      && fs.existsSync(VIENEU_PYTHON_BIN)
      && backboneFiles.every((name) => hasNonEmptyFile(VIENEU_ONNX_DIR, name))
      && codecFiles.every((name) => hasNonEmptyFile(VIENEU_CODEC_DIR, name));
  } catch { installed = false; }
  return {
    installed,
    ready: installed,
    python: VIENEU_PYTHON_BIN,
    modelDir: VIENEU_MODEL_DIR,
    minimumRamMb: Number(settings.localTtsMinFreeRamMb) || MINIMUM_RAM_MB,
    minimumRemainingRamMb: Number(settings.localTtsMinRemainingRamMb) || MINIMUM_REMAINING_RAM_MB,
    freeRamMb: Math.round(os.freemem() / (1024 * 1024)),
  };
}

function run(command, args, { timeoutMs = 30 * 60_000, onEvent = () => {}, onSpawn = () => {}, ...spawnOptions } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { cwd: ROOT, windowsHide: true, ...spawnOptions });
    } catch (error) {
      reject(describeSpawnError(command, error));
      return;
    }
    onSpawn(child.pid || null);
    let stderr = '';
    let pending = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('VieNeu TTS vượt quá thời gian tối đa 30 phút.'));
    }, timeoutMs);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    child.stderr?.on('data', (chunk) => {
      const value = chunk.toString();
      stderr += value;
      pending += value;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        const eventAt = line.indexOf('VIENEU_');
        if (eventAt >= 0) {
          const separator = line.indexOf(':', eventAt);
          const kind = line.slice(eventAt, separator);
          try { onEvent(kind, JSON.parse(line.slice(separator + 1))); }
          catch { /* Preserve unknown diagnostics in the process error. */ }
        }
      }
    });
    child.once('error', (error) => finish(describeSpawnError(command, error)));
    child.once('close', (code) => {
      if (code === 0) { finish(); return; }
      finish(new Error(`VieNeu TTS tiến trình kết thúc mã ${code}: ${stderr.slice(-900)}`));
    });
  });
}

async function runFfmpegSpeed(inputPath, outputPath, speed) {
  const filter = `atempo=${Number(speed).toFixed(2)}`;
  await run('ffmpeg', ['-y', '-v', 'error', '-i', inputPath, '-filter:a', filter, '-ar', '48000', '-c:a', 'pcm_s16le', outputPath], { timeoutMs: 180_000 });
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) throw new Error('FFmpeg không điều chỉnh được tốc độ audio VieNeu.');
}

function scaleTimingForSpeed(timingPath, speed) {
  const factor = 1 / speed;
  const timing = JSON.parse(fs.readFileSync(timingPath, 'utf8'));
  timing.wordBoundaries = (Array.isArray(timing.wordBoundaries) ? timing.wordBoundaries : []).map((boundary) => {
    const scaled = { ...boundary };
    for (const key of ['offsetTicks', 'offset', 'durationTicks', 'duration']) {
      if (Number.isFinite(Number(scaled[key]))) scaled[key] = Math.round(Number(scaled[key]) * factor);
    }
    for (const key of ['startSeconds', 'endSeconds']) {
      if (Number.isFinite(Number(scaled[key]))) scaled[key] = Number(scaled[key]) * factor;
    }
    return scaled;
  });
  fs.writeFileSync(timingPath, JSON.stringify(timing), 'utf8');
}

async function synthesizeMissing(items, onEvent = () => {}, settings = {}) {
  if (!items.length) return;
  const status = vieneuModelStatus(settings);
  if (!status.installed) throw new Error('VieNeu-TTS chưa được cài đầy đủ. Chạy `npm run setup:vieneu` để cài model và gói CPU/ONNX.');
  const requestPath = path.join(PATHS.temporary, `vieneu-${process.pid}-${crypto.randomUUID()}.request.json`);
  const request = {
    modelDir: VIENEU_MODEL_DIR,
    onnxDir: VIENEU_ONNX_DIR,
    codecDir: VIENEU_CODEC_DIR,
    lockPath: MODEL_LOCK,
    minimumAvailableRamMb: status.minimumRamMb,
    minimumRemainingRamMb: status.minimumRemainingRamMb,
    items: items.map((item) => ({
      text: item.speechText || item.text,
      voice: item.voice,
      outputPath: item.rawPath,
      timingPath: item.rawTimingPath
    }))
  };
  fs.mkdirSync(PATHS.temporary, { recursive: true });
  fs.writeFileSync(requestPath, JSON.stringify(request), 'utf8');
  try {
    let workerPid = null;
    await run(VIENEU_PYTHON_BIN, [PYTHON_SCRIPT, requestPath], {
      timeoutMs: 30 * 60_000,
      env: { ...process.env, HF_HOME: VIENEU_HF_HOME, HF_HUB_OFFLINE: '1', PYTHONUTF8: '1' },
      onSpawn: (pid) => { workerPid = pid; onEvent('VIENEU_WORKER', { pid }); },
      onEvent: (kind, value) => onEvent(kind, value)
    });
    onEvent('VIENEU_WORKER_EXITED', { pid: workerPid, workerExited: true, availableRamMb: Math.round(os.freemem() / (1024 * 1024)) });
    for (const item of items) {
      if (!fs.existsSync(item.rawPath) || fs.statSync(item.rawPath).size < 1024) throw new Error(`VieNeu không tạo được audio cho đoạn ${item.segmentId || 'preview'}.`);
      if (!fs.existsSync(item.rawTimingPath)) throw new Error(`VieNeu thiếu metadata audio cho đoạn ${item.segmentId || 'preview'}.`);
      const minimumSpeed = item.language === 'en' ? 0.5 : 0.75;
      const speed = Math.min(1.25, Math.max(minimumSpeed, Number(item.speed) || 1));
      if (Math.abs(speed - 1) > 0.001) {
        await runFfmpegSpeed(item.rawPath, item.finalPath, speed);
        scaleTimingForSpeed(item.rawTimingPath, speed);
      }
      else fs.copyFileSync(item.rawPath, item.finalPath);
      fs.copyFileSync(item.rawTimingPath, item.finalTimingPath);
      fs.rmSync(item.rawPath, { force: true });
      fs.rmSync(item.rawTimingPath, { force: true });
    }
  } finally {
    fs.rmSync(requestPath, { force: true });
    for (const item of items) {
      fs.rmSync(item.rawPath, { force: true });
      fs.rmSync(item.rawTimingPath, { force: true });
    }
  }
}

function readTiming(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      wordBoundaries: Array.isArray(value.wordBoundaries) ? value.wordBoundaries : [],
      warning: value.warning || null,
      source: value.source || null
    };
  } catch {
    return { wordBoundaries: [], warning: 'Không đọc được metadata canh thời gian audio VieNeu.' };
  }
}

async function alignFiles(files, alignmentQueue, onProgress, progressStart, progressEnd) {
  if (!alignmentQueue.length) return;
  const localResults = await alignSpeechBatchLocally(alignmentQueue);
  for (const [index, queued] of alignmentQueue.entries()) {
    const localMetadata = localResults[index] || { wordBoundaries: [], warning: 'Không nhận được kết quả forced alignment local.' };
    const file = files.find((item) => item.segmentId === queued.segmentId);
    if (!file) continue;
    const localMapped = mapWordBoundariesToTokens(file.text, localMetadata.wordBoundaries, file.segmentId, { language: file.language });
    const hasBetterMapping = localMapped.alignment.mappedTokenCount > (file.alignment?.mappedTokenCount || 0)
      || (localMapped.alignment.reliable && !file.alignment?.reliable);
    if (localMetadata.source === 'stable-ts-local' && hasBetterMapping) {
      file.wordTimings = localMapped.wordTimings;
      file.tokens = localMapped.tokens;
      file.alignment = localMapped.alignment;
      file.alignmentSource = localMetadata.source;
      file.alignmentWarning = localMapped.alignment.reliable ? null : localMetadata.warning || `Căn chỉnh local còn thiếu ${localMapped.alignment.unmatchedTokenCount} từ.`;
      fs.writeFileSync(queued.cachedTimingPath, JSON.stringify({
        provider: MODEL_VERSION,
        source: localMetadata.source,
        wordBoundaries: localMetadata.wordBoundaries,
        warning: file.alignmentWarning,
        alignment: localMapped.alignment
      }, null, 2), 'utf8');
    } else if (!file.wordTimings.length) {
      file.alignmentWarning = [file.alignmentWarning, localMetadata.warning].filter(Boolean).join(' ')
        || `Chưa căn chỉnh được WordBoundary cho đoạn ${file.segmentId}.`;
    }
    onProgress(progressStart + ((index + 1) / alignmentQueue.length) * (progressEnd - progressStart), {
      index: index + 1, total: alignmentQueue.length, segmentId: queued.segmentId, phase: 'local-alignment'
    });
  }
}

export async function synthesizeVieNeuScript(script, videoId, { settings, onProgress = () => {}, segments: suppliedSegments } = {}) {
  const workDir = path.join(PATHS.temporary, videoId, 'audio');
  const stagingDir = path.join(PATHS.temporary, videoId, 'vieneu-staging');
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  const cacheDir = path.join(PATHS.temporary, 'audio-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const baseSegments = suppliedSegments || createSpeechSegments(script, settings);
  const segments = baseSegments.map((segment) => {
    const baseRate = Number(segment.language === 'en' ? settings.vieneuEnSpeed : settings.vieneuViSpeed)
      || (segment.language === 'en' ? 0.9 : 1);
    const requestedSegmentRate = Number(segment.ttsSpeed);
    return {
      ...segment,
      voiceName: segment.language === 'en' ? settings.vieneuEnVoice : settings.vieneuViVoice,
      rate: Number.isFinite(requestedSegmentRate) && requestedSegmentRate > 0 ? requestedSegmentRate : baseRate
    };
  });
  const files = [];
  const alignmentQueue = [];
  const pending = [];
  const pendingBySegment = new Map();
  for (const [index, segment] of segments.entries()) {
    const minimumSpeed = segment.language === 'en' ? 0.5 : 0.75;
    const speed = Math.min(1.25, Math.max(minimumSpeed, Number(segment.rate) || 1));
    const hash = crypto.createHash('sha256')
      .update(`${MODEL_VERSION}|number-words-v1|${segment.voiceName}|${speed}|${segment.language}|${segment.speechText}`)
      .digest('hex');
    const cached = path.join(cacheDir, `${hash}.wav`);
    const cachedTiming = path.join(cacheDir, `${hash}.wordtimings.json`);
    const target = path.join(workDir, `${String(index + 1).padStart(3, '0')}-${segment.segmentId}.wav`);
    const needsGeneration = !fs.existsSync(cached) || fs.statSync(cached).size < 1024;
    if (needsGeneration) {
      const rawPath = path.join(stagingDir, `${String(index + 1).padStart(3, '0')}-${crypto.randomUUID()}.raw.wav`);
      const rawTimingPath = `${rawPath}.wordtimings.json`;
      const finalPath = path.join(stagingDir, `${String(index + 1).padStart(3, '0')}-${crypto.randomUUID()}.ready.wav`);
      const finalTimingPath = `${finalPath}.wordtimings.json`;
      const item = { text: segment.text, speechText: segment.speechText, language: segment.language, voice: segment.voiceName, speed, segmentId: segment.segmentId, rawPath, rawTimingPath, finalPath, finalTimingPath, cachePath: cached, cacheTimingPath: cachedTiming };
      pending.push(item);
      pendingBySegment.set(segment.segmentId, item);
    }
    files.push({
      ...segment,
      index: index + 1,
      voice: segment.voiceName,
      path: target,
      audioPath: target,
      cachePath: cached,
      cacheTimingPath: cachedTiming,
      wordTimings: [],
      tokens: [],
      alignment: null,
      alignmentSource: null,
      alignmentWarning: null
    });
  }

  if (pending.length) {
    let generatedCount = 0;
    await synthesizeMissing(pending, (kind, value) => {
      if (kind === 'VIENEU_PROGRESS') {
        generatedCount = Number(value.index) || generatedCount + 1;
        onProgress(Math.min(0.65, (generatedCount / pending.length) * 0.65), {
          index: generatedCount, total: pending.length, phase: 'vieneu-synthesis'
        });
      }
      if (kind === 'VIENEU_MEMORY') onProgress(0, { phase: 'vieneu-memory', ...value });
      if (kind === 'VIENEU_WORKER') onProgress(0, { phase: 'vieneu-worker-started', ...value });
      if (kind === 'VIENEU_WORKER_EXITED') onProgress(0, { phase: 'vieneu-worker-exited', ...value });
    }, settings);
    for (const item of pending) {
      fs.copyFileSync(item.finalPath, item.cachePath);
      fs.copyFileSync(item.finalTimingPath, item.cacheTimingPath);
      fs.rmSync(item.finalPath, { force: true });
      fs.rmSync(item.finalTimingPath, { force: true });
    }
  }

  for (const file of files) {
    const staged = pendingBySegment.get(file.segmentId);
    const audioSource = staged?.cachePath || file.cachePath;
    if (!fs.existsSync(audioSource) || fs.statSync(audioSource).size < 1024) throw new Error(`Không có audio VieNeu hợp lệ ở đoạn ${file.index} (${file.language}).`);
    fs.copyFileSync(audioSource, file.path);
    const metadata = readTiming(file.cacheTimingPath);
    const mapped = mapWordBoundariesToTokens(file.text, metadata.wordBoundaries, file.segmentId, { language: file.language });
    file.wordTimings = mapped.wordTimings;
    file.tokens = mapped.tokens;
    file.alignment = mapped.alignment;
    file.alignmentSource = metadata.source;
    file.alignmentWarning = metadata.warning || (mapped.alignment.reliable ? null : 'VieNeu chưa trả WordBoundary; đang thử forced alignment local.');
    if (file.state !== 'cta' && !mapped.alignment.reliable) alignmentQueue.push({
      segmentId: file.segmentId,
      audioPath: file.path,
      text: file.speechText,
      language: file.language,
      cachedTimingPath: file.cacheTimingPath
    });
  }

  onProgress(0.68, { total: segments.length, phase: 'audio-cache-ready' });
  await alignFiles(files, alignmentQueue, onProgress, 0.68, 0.98);
  for (const [index, file] of files.entries()) {
    onProgress(1, {
      index: index + 1, total: files.length, language: file.language,
      speakerId: file.speakerId, segmentId: file.segmentId, phase: 'audio'
    });
  }
  return files;
}

export async function synthesizeVieNeuPreview({ text, language, voice, speed, outputPath, timingPath, settings = {}, onProgress = () => {} }) {
  const id = crypto.randomUUID();
  const rawPath = `${outputPath}.${id}.raw.wav`;
  const rawTimingPath = `${rawPath}.wordtimings.json`;
  const normalizedSpeed = Math.min(1.25, Math.max(language === 'en' ? 0.5 : 0.75, Number(speed) || 1));
  const item = {
    text,
    speechText: prepareSpeechText(text, language),
    language,
    voice,
    speed: normalizedSpeed,
    segmentId: `preview-${id}`,
    rawPath,
    rawTimingPath,
    finalPath: outputPath,
    finalTimingPath: timingPath
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await synthesizeMissing([item], onProgress, settings);
  return { outputPath, timingPath, voice, language };
}
