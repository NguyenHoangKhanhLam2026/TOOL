import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../config.mjs';

const helperPath = path.join(ROOT, 'src', 'english-shadowing', 'font-render-child.mjs');

export function runEnglishShadowingFontTask(mode, payload) {
  if (!['preview', 'video-job'].includes(mode)) throw new TypeError(`Unsupported English Shadowing font task: ${mode}`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helperPath, mode], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdout = [];
    let stdoutBytes = 0;
    let stderr = '';
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.once('error', fail);
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 64 * 1024 * 1024) {
        child.kill();
        fail(new Error('English Shadowing font renderer returned too much data.'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-12_000);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      const output = Buffer.concat(stdout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `English Shadowing font renderer exited with code ${code}.`));
        return;
      }
      if (mode === 'preview') {
        resolve(output);
        return;
      }
      try {
        resolve(JSON.parse(output.toString('utf8')));
      } catch (error) {
        reject(new Error(`English Shadowing font renderer returned invalid job data: ${error.message}`));
      }
    });
    child.stdin.once('error', (error) => {
      if (error.code !== 'EPIPE') fail(error);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
