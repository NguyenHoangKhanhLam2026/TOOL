import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PATHS } from '../config.mjs';

let activityDb;

function database() {
  if (activityDb) return activityDb;
  fs.mkdirSync(path.dirname(PATHS.database), { recursive: true });
  activityDb = new DatabaseSync(PATHS.database);
  activityDb.exec(`
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL, code TEXT,
      message TEXT NOT NULL, job_id TEXT, created_at TEXT NOT NULL
    );
  `);
  return activityDb;
}

export function logMotPhutVoLeActivity(level, code, message, jobId = null) {
  try {
    const safeMessage = String(message)
      .replace(/(access[_-]?token\s*[=:]\s*)[^&,\s]+/giu, '$1[đã ẩn]')
      .replace(/Bearer\s+\S+/giu, 'Bearer [đã ẩn]')
      .slice(0, 1000);
    database().prepare('INSERT INTO logs(level,code,message,job_id,created_at) VALUES(?,?,?,?,?)')
      .run(String(level || 'INFO').toUpperCase(), String(code || 'MOT_PHUT_VO_LE_EVENT'), safeMessage,
        jobId ? String(jobId) : null, new Date().toISOString());
  } catch {
    // Logging must never stop an MPVL job from creating or rendering its video.
  }
}
