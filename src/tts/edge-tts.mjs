import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, PATHS, PYTHON_BIN } from '../config.mjs';
import { getSettings } from '../database/db.mjs';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180_000);
    child.stderr?.on('data', (data) => { stderr += data.toString(); });
    child.on('error', () => { clearTimeout(timer); reject(new Error(`${command} chưa cài hoặc không chạy được.`)); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(timedOut ? `${command} vượt quá thời gian chờ.` : `${command} kết thúc với mã ${code}: ${stderr.slice(-500)}`)); });
  });
}

function isRetryableTtsError(error) {
  return /NoAudioReceived|ConnectionResetError|ClientConnectorError|ServerDisconnectedError|TimeoutError|timed out|Cannot connect|connection reset|connection refused|network is unreachable/i.test(error.message);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function synthesizeScript(script, videoId, { onProgress = () => {} } = {}) {
  const settings = getSettings();
  const workDir = path.join(PATHS.temporary, videoId, 'audio');
  fs.mkdirSync(workDir, { recursive: true });
  const files = [];
  for (const [i, dialogue] of script.dialogues.entries()) {
    for (const [language, text, voice, rate] of [
      ['vi', dialogue.vietnamese, settings.viVoice, '+0%'],
      ['en', dialogue.english, settings.enVoice, settings.enRate]
    ]) {
      const hash = crypto.createHash('sha256').update(`${voice}|${rate}|${text}`).digest('hex');
      const cacheDir = path.join(PATHS.temporary, 'audio-cache');
      fs.mkdirSync(cacheDir, { recursive: true });
      const cached = path.join(cacheDir, `${hash}.mp3`);
      const target = path.join(workDir, `${String(i + 1).padStart(2, '0')}-${language}.mp3`);
      if (!fs.existsSync(cached) || fs.statSync(cached).size < 1024) {
        await synthesizeSpeech(text, voice, rate, cached);
      }
      fs.copyFileSync(cached, target);
      if (fs.statSync(target).size < 1024) throw new Error(`TTS tạo tệp rỗng ở câu ${i + 1} (${language}).`);
      files.push({ index: i + 1, language, text, voice, path: target });
      onProgress(files.length / 6, { index: i + 1, language });
    }
  }
  return files;
}

export async function synthesizeSpeech(text, voice, rate, output) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const partialOutput = output + '.' + process.pid + '.' + crypto.randomUUID() + '.partial.mp3';
    const requestPath = partialOutput + '.request.json';
    fs.writeFileSync(requestPath, JSON.stringify({ text, voice, rate, output: partialOutput }), 'utf8');
    try {
      await run(PYTHON_BIN, [path.join(ROOT, 'packages', 'tts-engine', 'python', 'synthesize.py'), requestPath]);
      if (!fs.existsSync(partialOutput) || fs.statSync(partialOutput).size < 1024) {
        throw new Error('Edge TTS did not create a valid audio file.');
      }
      fs.rmSync(output, { force: true });
      fs.renameSync(partialOutput, output);
      return output;
    } catch (error) {
      lastError = error;
      fs.rmSync(partialOutput, { force: true });
      if (attempt === 3 || !isRetryableTtsError(error)) break;
      await wait(attempt * 1000);
    } finally {
      fs.rmSync(requestPath, { force: true });
    }
  }
  if (/NoAudioReceived/i.test(lastError?.message ?? '')) {
    throw new Error('Edge TTS returned no audio after 3 attempts. Check the connection and try again.');
  }
  throw lastError;
}
