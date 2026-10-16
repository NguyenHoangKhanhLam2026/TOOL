import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, ROOT, PATHS, PYTHON_BIN } from '../config.mjs';
import { getSettings } from '../database/db.mjs';
import { createSpeechSegments, mapWordBoundariesToTokens } from '../../packages/audio-highlight/highlight-engine.mjs';
import { describeSpawnError } from '../utils/process-errors.mjs';

let localAlignmentUnavailable = false;
const MAX_TTS_ATTEMPTS = 4;
const TTS_RETRY_DELAYS_MS = [1500, 3000, 6000];

function run(command, args, { timeoutMs = 180_000, ...spawnOptions } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { cwd: ROOT, windowsHide: true, ...spawnOptions });
    } catch (error) {
      reject(describeSpawnError(command, error));
      return;
    }
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(describeSpawnError(command, error)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) { resolve(); return; }
      if (timedOut) { reject(new Error(`${command} vượt quá thời gian chờ.`)); return; }
      if (/WSServerHandshakeError: 403|403, message=['"]Invalid response status/i.test(stderr)) {
        const error = new Error('Microsoft Edge TTS từ chối kết nối WebSocket (HTTP 403). Python đã khởi chạy thành công; đây không phải lỗi spawn EPERM.');
        error.code = 'EDGE_TTS_FORBIDDEN';
        error.syscall = 'tts-service';
        reject(error);
        return;
      }
      reject(new Error(`${command} kết thúc với mã ${code}: ${stderr.slice(-500)}`));
    });
  });
}

function isRetryableTtsError(error) {
  return /NoAudioReceived|No audio was received|ConnectionResetError|ClientConnectorError|ServerDisconnectedError|ServerTimeoutError|TimeoutError|timed out|Cannot connect|connection reset|connection refused|network is unreachable/i.test(error.message);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function synthesizeScript(script, videoId, { onProgress = () => {} } = {}) {
  const settings = getSettings();
  const workDir = path.join(PATHS.temporary, videoId, 'audio');
  fs.mkdirSync(workDir, { recursive: true });
  const files = [];
  const segments = createSpeechSegments(script, settings);
  const cacheDir = path.join(PATHS.temporary, 'audio-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const localAlignmentQueue = [];
  for (const [i, segment] of segments.entries()) {
    const hash = crypto.createHash('sha256')
      .update(`edge-word-boundary-v3-number-words|${segment.voiceName}|${segment.rate}|${segment.language}|${segment.speechText}`)
      .digest('hex');
    const cached = path.join(cacheDir, `${hash}.mp3`);
    const cachedTiming = path.join(cacheDir, `${hash}.wordtimings.json`);
    const target = path.join(workDir, `${String(i + 1).padStart(3, '0')}-${segment.segmentId}.mp3`);
    if (!fs.existsSync(cached) || fs.statSync(cached).size < 1024 || !fs.existsSync(cachedTiming)) {
      const partialTiming = `${cached}.${process.pid}.${crypto.randomUUID()}.partial.wordtimings.json`;
      await synthesizeSpeech(segment.speechText, segment.voiceName, segment.rate, cached, { wordTimingsPath: partialTiming, language: segment.language });
      if (fs.existsSync(cachedTiming)) fs.rmSync(cachedTiming, { force: true });
      fs.renameSync(partialTiming, cachedTiming);
    }
    fs.copyFileSync(cached, target);
    if (fs.statSync(target).size < 1024) throw new Error(`TTS tạo tệp rỗng ở đoạn ${i + 1} (${segment.language}).`);
    const cachedMetadata = readWordTimingFile(cachedTiming);
    let mapped = mapWordBoundariesToTokens(segment.text, cachedMetadata.wordBoundaries, segment.segmentId, { language: segment.language });
    let alignmentSource = cachedMetadata.source || (cachedMetadata.wordBoundaries.length ? 'edge-word-boundary' : null);
    let alignmentWarning = cachedMetadata.warning || null;
    files.push({
      ...segment,
      index: i + 1,
      voice: segment.voiceName,
      path: target,
      audioPath: target,
      wordTimings: mapped.wordTimings,
      tokens: mapped.tokens,
      alignment: mapped.alignment,
      alignmentSource,
      alignmentWarning: alignmentWarning || (mapped.alignment.reliable ? null : `Không căn chỉnh được WordBoundary cho đoạn ${segment.segmentId}.`)
    });
    if (segment.state !== 'cta' && !mapped.alignment.reliable && !localAlignmentUnavailable) {
      localAlignmentQueue.push({
        segmentId: segment.segmentId,
        audioPath: target,
        text: segment.speechText,
        language: segment.language,
        cachedTimingPath: cachedTiming
      });
    }
    onProgress((files.length / segments.length) * (localAlignmentQueue.length ? 0.75 : 1), {
      index: i + 1, total: segments.length, language: segment.language,
      speakerId: segment.speakerId, segmentId: segment.segmentId, phase: 'audio'
    });
  }
  if (localAlignmentQueue.length) {
    const localResults = await alignSpeechBatchLocally(localAlignmentQueue);
    for (const [index, queued] of localAlignmentQueue.entries()) {
      const localMetadata = localResults[index] || { wordBoundaries: [], warning: 'Không nhận được kết quả forced alignment local.' };
      if (localMetadata.status === 'unavailable') localAlignmentUnavailable = true;
      const file = files.find((item) => item.segmentId === queued.segmentId);
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
          source: localMetadata.source,
          wordBoundaries: localMetadata.wordBoundaries,
          warning: file.alignmentWarning,
          alignment: localMapped.alignment
        }, null, 2), 'utf8');
      } else if (!file.wordTimings.length) {
        file.alignmentWarning = [file.alignmentWarning, localMetadata.warning].filter(Boolean).join(' ')
          || `Không căn chỉnh được WordBoundary cho đoạn ${file.segmentId}.`;
      }
      onProgress(0.75 + ((index + 1) / localAlignmentQueue.length) * 0.25, {
        index: index + 1, total: localAlignmentQueue.length,
        segmentId: queued.segmentId, phase: 'local-alignment'
      });
    }
  }
  return files;
}

export async function synthesizeSpeech(text, voice, rate, output, { wordTimingsPath = null, language = null } = {}) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  let lastError;
  for (let attempt = 1; attempt <= MAX_TTS_ATTEMPTS; attempt += 1) {
    const partialOutput = output + '.' + process.pid + '.' + crypto.randomUUID() + '.partial.mp3';
    const partialTiming = wordTimingsPath ? `${wordTimingsPath}.${process.pid}.${crypto.randomUUID()}.partial` : null;
    const requestPath = partialOutput + '.request.json';
    fs.writeFileSync(requestPath, JSON.stringify({ text, voice, rate, language, output: partialOutput, wordTimingsPath: partialTiming }), 'utf8');
    try {
      await run(PYTHON_BIN, [path.join(ROOT, 'packages', 'tts-engine', 'python', 'synthesize.py'), requestPath]);
      if (!fs.existsSync(partialOutput) || fs.statSync(partialOutput).size < 1024) {
        throw new Error('Edge TTS did not create a valid audio file.');
      }
      if (wordTimingsPath && (!partialTiming || !fs.existsSync(partialTiming))) {
        throw new Error('Edge TTS không tạo được metadata WordBoundary.');
      }
      fs.rmSync(output, { force: true });
      fs.renameSync(partialOutput, output);
      if (wordTimingsPath) {
        fs.rmSync(wordTimingsPath, { force: true });
        fs.renameSync(partialTiming, wordTimingsPath);
      }
      return output;
    } catch (error) {
      lastError = error;
      fs.rmSync(partialOutput, { force: true });
      if (partialTiming) fs.rmSync(partialTiming, { force: true });
      if (attempt === MAX_TTS_ATTEMPTS || !isRetryableTtsError(error)) break;
      await wait(TTS_RETRY_DELAYS_MS[attempt - 1] ?? TTS_RETRY_DELAYS_MS.at(-1));
    } finally {
      fs.rmSync(requestPath, { force: true });
    }
  }
  if (/NoAudioReceived|No audio was received/i.test(lastError?.message ?? '')) {
    const detail = String(lastError.message).split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 500)
      || String(lastError.message).slice(-500);
    throw new Error(`Edge TTS did not return audio after ${MAX_TTS_ATTEMPTS} attempts for voice ${voice}. Last error: ${detail}`, { cause: lastError });
  }
  throw lastError;
}

function readWordTimingFile(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      wordBoundaries: Array.isArray(value.wordBoundaries) ? value.wordBoundaries : [],
      warning: value.warning || null,
      source: value.source || null
    };
  } catch {
    return { wordBoundaries: [], warning: 'Không đọc được metadata WordBoundary đã lưu.' };
  }
}

export async function alignSpeechLocally(audioPath, text, language) {
    const [result] = await alignSpeechBatchLocally([{
    segmentId: `preview-${crypto.randomUUID()}`,
    audioPath,
    text,
    language
  }]);
  return result;
}

export async function alignSpeechBatchLocally(items) {
  if (!items.length) return [];
  if (localAlignmentUnavailable) return items.map(() => ({ status: 'unavailable', wordBoundaries: [], warning: 'stable-ts chưa được cài; bỏ qua căn chỉnh local.' }));
  const requestPath = `${items[0].audioPath}.${process.pid}.${crypto.randomUUID()}.align-request.json`;
  const outputPath = `${requestPath}.result.json`;
  try {
    const payload = items.map(({ segmentId, audioPath, text, language }) => ({ segmentId, audioPath, text, language }));
    fs.writeFileSync(requestPath, JSON.stringify({ items: payload, outputPath }), 'utf8');
    await run(PYTHON_BIN, [path.join(ROOT, 'packages', 'tts-engine', 'python', 'align_local.py'), requestPath], {
      timeoutMs: 600_000,
      env: { ...process.env, AERS_ALIGNMENT_MODEL_DIR: path.join(DATA, 'models', 'whisper') }
    });
    const result = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    if ((result.results || []).some((item) => /No module named ['"]?stable_whisper|stable-ts chÆ°a Ä‘Æ°á»£c cÃ i/i.test(item.warning || ''))) localAlignmentUnavailable = true;
    const bySegment = new Map((Array.isArray(result.results) ? result.results : []).map((item) => [item.segmentId, item]));
    return items.map((item) => {
      const matched = bySegment.get(item.segmentId) || {};
      return {
        status: matched.status || result.status || 'failed',
        wordBoundaries: Array.isArray(matched.wordBoundaries) ? matched.wordBoundaries : [],
        warning: matched.warning || null,
        source: matched.source || null
      };
    });
  } catch (error) {
    const message = error.message || 'Lỗi căn chỉnh local.';
    if (/No module named ['"]?stable_whisper|stable-ts chưa được cài/i.test(message)) localAlignmentUnavailable = true;
    return items.map(() => ({ status: 'failed', wordBoundaries: [], warning: `Căn chỉnh local thất bại: ${message.slice(-400)}` }));
  } finally {
    fs.rmSync(requestPath, { force: true });
    fs.rmSync(outputPath, { force: true });
  }
}
