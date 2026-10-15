import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOCAL_TTS_LOCK_DB, LOCAL_TTS_STATUS_PATH } from '../config.mjs';

const WAIT_MS = 500;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;

function memorySnapshot() {
  return {
    systemRamTotalMb: Math.round(os.totalmem() / (1024 * 1024)),
    systemRamAvailableMb: Math.round(os.freemem() / (1024 * 1024)),
    managerProcessRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024))
  };
}

function writeStatus(record) {
  fs.mkdirSync(path.dirname(LOCAL_TTS_STATUS_PATH), { recursive: true });
  const temporary = `${LOCAL_TTS_STATUS_PATH}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(record)}\n`, 'utf8');
    fs.renameSync(temporary, LOCAL_TTS_STATUS_PATH);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function processExists(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) < 1) return false;
  try { process.kill(Number(pid), 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

function isLockBusy(error) {
  return /SQLITE_BUSY|database is locked|database table is locked/i.test(`${error?.code || ''} ${error?.message || ''}`);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function withLocalTtsModel(model, action, { timeoutMs = DEFAULT_TIMEOUT_MS, onPhase = () => {} } = {}) {
  fs.mkdirSync(path.dirname(LOCAL_TTS_LOCK_DB), { recursive: true });
  const lock = new DatabaseSync(LOCAL_TTS_LOCK_DB);
  lock.exec('PRAGMA busy_timeout=0');
  const requestedAt = Date.now();
  let acquired = false;
  let status = {
    active: true,
    model,
    phase: 'waiting-for-model-lock',
    ownerPid: process.pid,
    workerPid: null,
    requestedAt: new Date(requestedAt).toISOString(),
    startedAt: null,
    updatedAt: new Date().toISOString(),
    memoryBefore: memorySnapshot(),
    memoryAfter: null,
    workerMemory: null,
    workerExited: false
  };
  const publish = (patch = {}) => {
    status = { ...status, ...patch, updatedAt: new Date().toISOString() };
    writeStatus(status);
    onPhase(status);
  };

  try {
    while (!acquired) {
      try {
        lock.exec('BEGIN EXCLUSIVE');
        acquired = true;
      } catch (error) {
        if (!isLockBusy(error)) throw error;
        if (Date.now() - requestedAt >= timeoutMs) {
          const current = getLocalTtsManagerStatus();
          throw new Error(`Hết thời gian chờ TTS local đang chạy${current.model ? ` (${current.model})` : ''}. Hãy đợi tác vụ giọng đọc hiện tại hoàn tất rồi thử lại.`);
        }
        await wait(WAIT_MS);
      }
    }
    publish({ phase: 'checking-memory', startedAt: new Date().toISOString(), ...memorySnapshot() });
    const result = await action({
      update: (patch) => publish(patch),
      memorySnapshot
    });
    publish({ phase: 'worker-exited', workerExited: true, memoryAfter: memorySnapshot() });
    return result;
  } catch (error) {
    if (acquired) publish({ phase: 'failed', workerExited: true, memoryAfter: memorySnapshot(), error: String(error?.message || error).slice(0, 500) });
    throw error;
  } finally {
    if (acquired) {
      publish({ active: false, model: null, workerPid: null, phase: 'unloaded', workerExited: true, memoryAfter: memorySnapshot() });
      try { lock.exec('ROLLBACK'); } catch { /* No transaction remains. */ }
    }
    lock.close();
  }
}

export function getLocalTtsManagerStatus() {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(LOCAL_TTS_STATUS_PATH, 'utf8')); }
  catch { return { active: false, model: null, phase: 'unloaded', workerExited: true, memory: memorySnapshot() }; }
  const ownerAlive = processExists(saved.ownerPid);
  if (!saved.active || !ownerAlive) {
    return {
      ...saved,
      active: false,
      model: null,
      phase: 'unloaded',
      workerPid: null,
      workerExited: true,
      staleOwner: Boolean(saved.active && !ownerAlive),
      memory: memorySnapshot()
    };
  }
  return { ...saved, memory: memorySnapshot() };
}
