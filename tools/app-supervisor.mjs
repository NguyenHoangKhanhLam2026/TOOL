import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGS = path.join(ROOT, 'data', 'logs');
const LOCK = path.join(LOGS, 'app-supervisor.lock');
const SUPERVISOR_LOG = path.join(LOGS, 'app-supervisor.log');
const port = Number(process.env.APP_PORT || 3001);
const services = new Map();
let stopping = false;
let lockFd = null;

fs.mkdirSync(LOGS, { recursive: true });

function log(message) {
  fs.appendFileSync(SUPERVISOR_LOG, `${new Date().toISOString()} ${message}\n`, 'utf8');
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

function liveWorkerPid() {
  try {
    const heartbeat = JSON.parse(fs.readFileSync(path.join(LOGS, 'worker-heartbeat.json'), 'utf8'));
    const pid = Number(String(heartbeat.workerId || '').match(/^worker-(\d+)-/)?.[1]);
    if (Date.now() - new Date(heartbeat.lastSeen).getTime() >= 30_000) return null;
    return pidIsAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lockFd = fs.openSync(LOCK, 'wx');
      fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8');
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let pid = 0;
      try { pid = Number(JSON.parse(fs.readFileSync(LOCK, 'utf8')).pid); } catch { }
      if (pidIsAlive(pid)) return false;
      try { fs.rmSync(LOCK, { force: true }); } catch { return false; }
    }
  }
  return false;
}

function launch(name, entry) {
  if (stopping || services.has(name)) return;
  if (name === 'worker') {
    const pid = liveWorkerPid();
    if (pid) {
      log(`worker already active outside this supervisor (pid ${pid}); will check again.`);
      scheduleRestart(name, entry, 5_000);
      return;
    }
  }
  const stdoutFd = fs.openSync(path.join(LOGS, `${name}-supervisor.out.log`), 'a');
  const stderrFd = fs.openSync(path.join(LOGS, `${name}-supervisor.err.log`), 'a');
  let child;
  try {
    child = spawn(process.execPath, [path.join(ROOT, entry)], {
      cwd: ROOT,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', stdoutFd, stderrFd]
    });
  } catch (error) {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
    log(`${name}: spawn threw ${error.code || error.message}`);
    scheduleRestart(name, entry, 5_000);
    return;
  }

  const state = { child, stdoutFd, stderrFd, entry, restartDelay: 2_000 };
  services.set(name, state);
  child.once('spawn', () => log(`${name} started (pid ${child.pid}).`));
  child.once('error', (error) => log(`${name} process error: ${error.code || error.message}`));
  child.once('exit', (code, signal) => {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
    if (services.get(name) !== state) return;
    services.delete(name);
    log(`${name} exited (code ${code ?? 'null'}, signal ${signal || 'none'}).`);
    if (!stopping) scheduleRestart(name, entry, state.restartDelay);
  });
}

function scheduleRestart(name, entry, delay) {
  if (stopping) return;
  log(`${name} will restart in ${delay}ms.`);
  setTimeout(() => launch(name, entry), delay).unref();
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`stopping on ${signal}.`);
  for (const [name, state] of services) {
    try { state.child.kill(); }
    catch (error) { log(`${name} stop error: ${error.code || error.message}`); }
  }
  const finish = () => {
    if (services.size) return setTimeout(finish, 100);
    try { if (lockFd !== null) fs.closeSync(lockFd); } catch { }
    try { fs.rmSync(LOCK, { force: true }); } catch { }
    process.exit(0);
  };
  finish();
}

if (!acquireLock()) {
  log('another supervisor is already active; this instance exits.');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  log(`supervisor uncaught exception: ${error.stack || error.message}`);
});

log(`supervisor started (pid ${process.pid}).`);
launch('server', 'src/server.mjs');
launch('worker', 'src/workers/worker.mjs');

// Keep a live supervisor even while both children are temporarily restarting.
setInterval(() => {}, 60_000);
