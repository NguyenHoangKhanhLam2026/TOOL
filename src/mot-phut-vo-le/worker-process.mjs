import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../config.mjs';

let worker = null;
let workerStarting = null;

export async function ensureMotPhutVoLeWorker() {
  if (worker && worker.exitCode === null && !worker.killed) return { running: true, pid: worker.pid };
  if (workerStarting) return workerStarting;

  workerStarting = new Promise((resolve, reject) => {
    const workerPath = fileURLToPath(new URL('./worker.mjs', import.meta.url));
    let child;
    try {
      child = spawn(process.execPath, [workerPath], {
        cwd: ROOT,
        windowsHide: true,
        stdio: 'ignore',
        env: { ...process.env, MOT_PHUT_VO_LE_WORKER_IDLE_EXIT_MS: '30000' }
      });
    } catch (error) {
      reject(error);
      return;
    }

    child.once('error', (error) => {
      if (worker === child) worker = null;
      reject(error);
    });
    child.once('spawn', () => {
      worker = child;
      child.once('exit', () => { if (worker === child) worker = null; });
      resolve({ running: true, pid: child.pid });
    });
  });

  try {
    return await workerStarting;
  } finally {
    workerStarting = null;
  }
}

process.once('exit', () => {
  if (worker && worker.exitCode === null) worker.kill();
});
