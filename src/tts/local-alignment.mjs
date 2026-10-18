import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, ROOT, PYTHON_BIN } from '../config.mjs';
import { describeSpawnError } from '../utils/process-errors.mjs';

let localAlignmentUnavailable = false;

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
      if (timedOut) { reject(new Error(`${command} timed out.`)); return; }
      reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
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
  if (localAlignmentUnavailable) return items.map(() => ({ status: 'unavailable', wordBoundaries: [], warning: 'stable-ts is not installed; local alignment was skipped.' }));
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
    if (result.status === 'unavailable' || (result.results || []).some((item) => item.status === 'unavailable' || /No module named ['"]?stable_whisper|stable-ts .*not installed/i.test(item.warning || ''))) localAlignmentUnavailable = true;
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
    const message = error.message || 'Local alignment failed.';
    if (/No module named ['"]?stable_whisper|stable-ts .*not installed/i.test(message)) localAlignmentUnavailable = true;
    return items.map(() => ({ status: 'failed', wordBoundaries: [], warning: `Local alignment failed: ${message.slice(-400)}` }));
  } finally {
    fs.rmSync(requestPath, { force: true });
    fs.rmSync(outputPath, { force: true });
  }
}
