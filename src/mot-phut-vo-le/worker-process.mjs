import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../config.mjs';
import { listMotPhutVoLeJobs, recoverMotPhutVoLeJobs } from './history.mjs';

let worker = null;
let workerStarting = null;
let recoveryInProgress = null;

async function stopWorker(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { }
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try { child.kill('SIGKILL'); } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

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

async function superviseMotPhutVoLeWorker() {
  if (recoveryInProgress) return recoveryInProgress;
  recoveryInProgress = (async () => {
    const recovered = recoverMotPhutVoLeJobs();
    if (recovered > 0 && worker && worker.exitCode === null) {
      const staleWorker = worker;
      worker = null;
      await stopWorker(staleWorker);
    }
    if (worker && worker.exitCode === null) return;
    if (listMotPhutVoLeJobs({ limit: 200 }).some((job) => job.status === 'pending')) {
      await ensureMotPhutVoLeWorker();
    }
  })();
  try { await recoveryInProgress; }
  catch { /* The next supervisor tick retries after transient database or process errors. */ }
  finally { recoveryInProgress = null; }
}

const workerSupervisor = setInterval(() => { void superviseMotPhutVoLeWorker(); }, 15_000);
workerSupervisor.unref();

process.once('exit', () => {
  if (worker && worker.exitCode === null) worker.kill();
});
