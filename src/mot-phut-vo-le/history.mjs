import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA } from '../config.mjs';
import { hashContent, normalizeTitle } from './content-validator.mjs';
import { findIdeaDuplicate, normalizeForComparison } from './topic-engine.mjs';
import { motPhutVoLeAudioCacheKey } from './vie-tts.mjs';

const HISTORY_DIR = path.join(DATA, 'mot-phut-vo-le');
const HISTORY_DB = path.join(HISTORY_DIR, 'history.sqlite');
let connection;

function database() {
  if (connection) return connection;
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  connection = new DatabaseSync(HISTORY_DB);
  connection.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  connection.exec(`
    CREATE TABLE IF NOT EXISTS content_records (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      topic TEXT NOT NULL,
      angle TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      thumbnail_highlight TEXT NOT NULL DEFAULT '',
      title_key TEXT UNIQUE,
      script_text TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      content_hash TEXT UNIQUE,
      candidate_key TEXT NOT NULL UNIQUE,
      caption TEXT NOT NULL DEFAULT '',
      hashtags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      published_at TEXT,
      facebook_post_id TEXT,
      voice_profile_json TEXT,
      audio_path TEXT,
      alignment_manifest_json TEXT,
      video_path TEXT,
      thumbnail_path TEXT,
      visual_design_json TEXT,
      validation_json TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS content_records_created_idx ON content_records(created_at DESC);
    CREATE INDEX IF NOT EXISTS content_records_topic_idx ON content_records(category, subcategory, topic);
    CREATE TABLE IF NOT EXISTS module_jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      progress_json TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS module_jobs_due_idx ON module_jobs(status, created_at);
    CREATE TABLE IF NOT EXISTS module_schedules (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL REFERENCES content_records(id),
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      facebook_schedule_state TEXT NOT NULL DEFAULT 'local',
      facebook_video_id TEXT,
      facebook_upload_session_id TEXT,
      facebook_upload_offset INTEGER,
      facebook_upload_end_offset INTEGER,
      facebook_error TEXT,
      published_at TEXT,
      facebook_checked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS module_schedules_due_idx ON module_schedules(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS module_schedules_content_idx ON module_schedules(content_id, status);
  `);
  const contentColumns = new Set(connection.prepare('PRAGMA table_info(content_records)').all().map((column) => column.name));
  if (!contentColumns.has('thumbnail_highlight')) connection.exec("ALTER TABLE content_records ADD COLUMN thumbnail_highlight TEXT NOT NULL DEFAULT ''");
  const scheduleColumns = new Set(connection.prepare('PRAGMA table_info(module_schedules)').all().map((column) => column.name));
  if (!scheduleColumns.has('facebook_checked_at')) connection.exec('ALTER TABLE module_schedules ADD COLUMN facebook_checked_at TEXT');
  return connection;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id, category: row.category, subcategory: row.subcategory, topic: row.topic, angle: row.angle,
    title: row.title, thumbnailHighlight: row.thumbnail_highlight || '', scriptText: row.script_text, summary: row.summary, contentHash: row.content_hash,
    caption: row.caption, hashtags: parseJson(row.hashtags_json, []), status: row.status, createdAt: row.created_at,
    publishedAt: row.published_at, facebookPostId: row.facebook_post_id, voiceProfile: parseJson(row.voice_profile_json, null),
    audioPath: row.audio_path, alignmentManifest: parseJson(row.alignment_manifest_json, null), videoPath: row.video_path,
    thumbnailPath: row.thumbnail_path, visualDesign: parseJson(row.visual_design_json, null),
    validation: parseJson(row.validation_json, null), lastError: row.last_error, updatedAt: row.updated_at
  };
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function ideaKey(candidate) {
  const normalized = normalizeForComparison(`${candidate.topic || ''} ${candidate.angle || ''}`);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function listMotPhutVoLeHistory({ query = '', category = '', limit = 200, offset = 0 } = {}) {
  const db = database();
  const search = String(query || '').trim();
  const cap = Math.max(1, Math.min(1000, Number(limit) || 200));
  const start = Math.max(0, Number(offset) || 0);
  const rows = db.prepare(`
    SELECT * FROM content_records
    WHERE (? = '' OR category = ?)
      AND (? = '' OR title LIKE '%' || ? || '%' OR topic LIKE '%' || ? || '%' OR angle LIKE '%' || ? || '%' OR summary LIKE '%' || ? || '%')
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(String(category || ''), String(category || ''), search, search, search, search, search, cap, start);
  return rows.map(mapRow);
}

export function getAllMotPhutVoLeHistoryForDeduplication({ excludeId = '' } = {}) {
  return database().prepare('SELECT id,category,subcategory,topic,angle,title,summary,script_text,content_hash,status FROM content_records WHERE status != ? AND id != ? ORDER BY created_at DESC').all('discarded', String(excludeId))
    .map((row) => ({
      id: row.id, category: row.category, subcategory: row.subcategory, topic: row.topic, angle: row.angle,
      title: row.title, summary: row.summary, scriptText: row.script_text, contentHash: row.content_hash
    }));
}

export function reserveMotPhutVoLeIdea(candidate, { threshold = 0.78 } = {}) {
  const db = database();
  db.exec('BEGIN IMMEDIATE');
  try {
    const history = db.prepare('SELECT id,category,subcategory,topic,angle,title,summary,script_text,content_hash FROM content_records WHERE status != ?').all('discarded')
      .map((row) => ({ id: row.id, category: row.category, subcategory: row.subcategory, topic: row.topic, angle: row.angle, title: row.title, summary: row.summary, scriptText: row.script_text, contentHash: row.content_hash }));
    const duplicate = findIdeaDuplicate(candidate, history, threshold);
    if (duplicate.duplicate) {
      const error = new Error(`Ý tưởng quá giống nội dung đã có (độ tương đồng văn bản ${duplicate.score}; lý do: ${duplicate.reason}).`);
      error.code = 'MOT_PHUT_VO_LE_DUPLICATE_IDEA';
      error.matchId = duplicate.matchId;
      throw error;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO content_records
      (id,category,subcategory,topic,angle,title,title_key,script_text,summary,content_hash,candidate_key,status,created_at,updated_at)
      VALUES(?,?,?,?,?,'',NULL,'','',NULL,?,'reserved',?,?)`)
      .run(id, String(candidate.category), String(candidate.subcategory), String(candidate.topic), String(candidate.angle), ideaKey(candidate), now, now);
    db.exec('COMMIT');
    return id;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { }
    if (/UNIQUE constraint failed: content_records\.candidate_key/u.test(error.message || '')) {
      error.code = 'MOT_PHUT_VO_LE_DUPLICATE_IDEA';
      error.message = 'Một job khác vừa đặt trước cùng chủ đề và góc khai thác.';
    }
    throw error;
  }
}

export function saveMotPhutVoLeScript(id, content, { validation = null } = {}) {
  const db = database();
  const now = new Date().toISOString();
  const titleKey = normalizeTitle(content.title);
  const contentHash = content.contentHash || hashContent(content.scriptText);
  try {
    const result = db.prepare(`UPDATE content_records SET category=?,subcategory=?,topic=?,angle=?,title=?,thumbnail_highlight=?,title_key=?,script_text=?,summary=?,content_hash=?,caption=?,hashtags_json=?,status='script_ready',validation_json=?,last_error=NULL,updated_at=? WHERE id=?`)
      .run(content.category, content.subcategory, content.topic, content.angle, content.title, String(content.thumbnailHighlight || ''), titleKey, content.scriptText, content.summary, contentHash, content.caption,
        JSON.stringify(content.hashtags), validation ? JSON.stringify(validation) : null, now, id);
    if (!result.changes) throw new Error(`Không tìm thấy reservation của nội dung ${id}.`);
    return getMotPhutVoLeContent(id);
  } catch (error) {
    if (/UNIQUE constraint failed: content_records\.(title_key|content_hash)/u.test(error.message || '')) {
      error.code = 'MOT_PHUT_VO_LE_DUPLICATE_CONTENT';
      error.message = 'Tiêu đề hoặc nội dung vừa trùng với một mục đã lưu.';
    }
    throw error;
  }
}

const PATCH_COLUMNS = Object.freeze({
  status: 'status', publishedAt: 'published_at', facebookPostId: 'facebook_post_id', thumbnailHighlight: 'thumbnail_highlight', audioPath: 'audio_path',
  alignmentManifest: 'alignment_manifest_json', videoPath: 'video_path', thumbnailPath: 'thumbnail_path',
  visualDesign: 'visual_design_json', voiceProfile: 'voice_profile_json', caption: 'caption', hashtags: 'hashtags_json',
  validation: 'validation_json', lastError: 'last_error'
});

export function updateMotPhutVoLeContent(id, patch = {}) {
  const db = database();
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (['alignmentManifest', 'visualDesign', 'voiceProfile', 'validation'].includes(key)) value = value == null ? null : JSON.stringify(value);
    if (key === 'hashtags') value = JSON.stringify(Array.isArray(value) ? value : []);
    sets.push(`${column}=?`);
    values.push(value);
  }
  if (!sets.length) return getMotPhutVoLeContent(id);
  sets.push('updated_at=?');
  values.push(new Date().toISOString(), id);
  const result = db.prepare(`UPDATE content_records SET ${sets.join(',')} WHERE id=?`).run(...values);
  if (!result.changes) throw new Error(`Không tìm thấy nội dung ${id}.`);
  return getMotPhutVoLeContent(id);
}

export function getMotPhutVoLeContent(id) {
  return mapRow(database().prepare('SELECT * FROM content_records WHERE id=?').get(id));
}

export function deleteMotPhutVoLeVideo(id) {
  const videoId = String(id || '');
  if (!/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/iu.test(videoId)) {
    throw Object.assign(new Error('Mã video MPVL không hợp lệ.'), { statusCode: 400 });
  }

  const db = database();
  const staged = [];
  let committed = false;
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT * FROM content_records WHERE id=?').get(videoId);
    if (!row) { db.exec('COMMIT'); committed = true; return null; }
    if (['processing', 'script_ready', 'publishing'].includes(row.status)) {
      throw Object.assign(new Error('Không thể xóa khi MPVL đang được tạo hoặc đăng.'), { statusCode: 409 });
    }

    const schedules = db.prepare('SELECT status,facebook_schedule_state FROM module_schedules WHERE content_id=?').all(videoId);
    const remoteStates = new Set(['queued', 'uploading', 'finishing', 'scheduled', 'uncertain']);
    if (schedules.some((item) => item.status === 'publishing' || remoteStates.has(item.facebook_schedule_state))) {
      throw Object.assign(new Error('Video đã được gửi hoặc đang lên lịch trên Facebook. Hãy hủy lịch tại Facebook trước khi xóa.'), { statusCode: 409 });
    }

    const jobs = db.prepare('SELECT id,type,status,payload_json,progress_json FROM module_jobs').all();
    const relatedJobs = jobs.filter((job) => {
      const payload = parseJson(job.payload_json, {});
      const progress = parseJson(job.progress_json, {});
      return payload.contentId === videoId || progress.contentId === videoId;
    });
    if (relatedJobs.some((job) => ['pending', 'running'].includes(job.status))) {
      throw Object.assign(new Error('Video đang được xử lý. Hãy đợi job kết thúc rồi xóa.'), { statusCode: 409 });
    }

    const contentRoot = path.resolve(DATA, 'mot-phut-vo-le', 'content');
    const outputRoot = path.resolve(DATA, 'outputs', 'mot-phut-vo-le');
    const frameRoot = path.resolve(DATA, 'temporary', 'mot-phut-vo-le', 'frames');
    const cacheRoot = path.resolve(DATA, 'mot-phut-vo-le', 'audio-cache');
    stageArtifact(contentRoot, videoId, staged);
    stageArtifact(outputRoot, videoId, staged);
    if (fs.existsSync(frameRoot)) {
      for (const entry of fs.readdirSync(frameRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !new RegExp(`^${escapeRegExp(videoId)}-\\d+$`, 'u').test(entry.name)) continue;
        stageArtifact(frameRoot, entry.name, staged);
      }
    }

    const profile = parseJson(row.voice_profile_json, null);
    if (row.script_text && profile?.voice && !jobs.some((job) => ['pending', 'running'].includes(job.status))) {
      const cacheKey = motPhutVoLeAudioCacheKey(row.script_text, { voice: profile.voice, speed: profile.speed });
      const otherRecords = db.prepare('SELECT script_text,voice_profile_json FROM content_records WHERE id<>? AND audio_path IS NOT NULL').all(videoId);
      const cacheIsShared = otherRecords.some((other) => {
        const otherProfile = parseJson(other.voice_profile_json, null);
        return Boolean(otherProfile?.voice)
          && motPhutVoLeAudioCacheKey(other.script_text, { voice: otherProfile.voice, speed: otherProfile.speed }) === cacheKey;
      });
      if (!cacheIsShared) {
        stageArtifact(cacheRoot, `${cacheKey}.wav`, staged);
        stageArtifact(cacheRoot, `${cacheKey}.json`, staged);
      }
    }

    db.prepare('DELETE FROM module_schedules WHERE content_id=?').run(videoId);
    for (const job of relatedJobs) db.prepare('DELETE FROM module_jobs WHERE id=?').run(job.id);
    db.prepare('DELETE FROM content_records WHERE id=?').run(videoId);
    db.exec('COMMIT');
    committed = true;

    const cleanupWarnings = [];
    for (const artifact of staged) {
      try { fs.rmSync(artifact.staged, { recursive: true, force: true }); }
      catch { cleanupWarnings.push(path.basename(artifact.target)); }
    }
    return { id: videoId, deleted: true, removedFileCount: staged.length, cleanupWarnings };
  } catch (error) {
    if (!committed) {
      try { db.exec('ROLLBACK'); } catch { }
      restoreStagedArtifacts(staged);
    }
    throw error;
  }
}

function stageArtifact(root, name, staged) {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, name);
  if (path.dirname(target) !== absoluteRoot || path.basename(target) !== name) {
    throw new Error('Đường dẫn tệp MPVL không hợp lệ khi xóa.');
  }
  if (!fs.existsSync(target)) return;
  const stagingName = `.mot-phut-delete-${crypto.randomUUID()}`;
  const stagingPath = path.resolve(absoluteRoot, stagingName);
  if (path.dirname(stagingPath) !== absoluteRoot) throw new Error('Thư mục tạm xóa MPVL không hợp lệ.');
  fs.renameSync(target, stagingPath);
  staged.push({ target, staged: stagingPath });
}

function restoreStagedArtifacts(staged) {
  for (const artifact of [...staged].reverse()) {
    try {
      if (!fs.existsSync(artifact.staged) || fs.existsSync(artifact.target)) continue;
      fs.renameSync(artifact.staged, artifact.target);
    } catch { }
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function mapScheduleRow(row) {
  if (!row) return null;
  return {
    id: row.id, contentId: row.content_id, scheduledAt: row.scheduled_at, status: row.status,
    facebookScheduleState: row.facebook_schedule_state, facebookVideoId: row.facebook_video_id,
    facebookUploadSessionId: row.facebook_upload_session_id, facebookUploadOffset: row.facebook_upload_offset,
    facebookUploadEndOffset: row.facebook_upload_end_offset,
    facebookError: row.facebook_error, publishedAt: row.published_at, facebookCheckedAt: row.facebook_checked_at, createdAt: row.created_at,
    updatedAt: row.updated_at, topic: row.topic, title: row.title, caption: row.caption,
    hashtags: parseJson(row.hashtags_json, []), videoPath: row.video_path, thumbnailPath: row.thumbnail_path,
    validation: parseJson(row.validation_json, null), durationSeconds: Number(parseJson(row.validation_json, null)?.audioDuration?.actualSeconds || 0),
    countsTowardLimit: ['scheduled', 'publishing', 'published'].includes(row.status)
  };
}

const SCHEDULE_SELECT = `SELECT p.*,c.topic,c.title,c.caption,c.hashtags_json,c.video_path,c.thumbnail_path,c.validation_json
  FROM module_schedules p JOIN content_records c ON c.id=p.content_id`;

export function listMotPhutVoLeSchedules({ includeCancelled = false, limit = 500 } = {}) {
  const cap = Math.max(1, Math.min(1000, Number(limit) || 500));
  const filter = includeCancelled ? '' : "WHERE p.status<>'cancelled'";
  return database().prepare(`${SCHEDULE_SELECT} ${filter} ORDER BY p.scheduled_at ASC LIMIT ?`).all(cap).map(mapScheduleRow);
}

export function getMotPhutVoLeSchedule(id) {
  return mapScheduleRow(database().prepare(`${SCHEDULE_SELECT} WHERE p.id=?`).get(id));
}

export function createMotPhutVoLeSchedule(contentId, scheduledAt) {
  const db = database();
  const content = getMotPhutVoLeContent(contentId);
  if (!content) throw new Error('Không tìm thấy video Một Phút Vỡ Lẽ.');
  if (content.status !== 'complete' || !content.videoPath) throw new Error('Video Một Phút Vỡ Lẽ chưa sẵn sàng để lên lịch.');
  if (db.prepare("SELECT 1 FROM module_schedules WHERE content_id=? AND status IN ('scheduled','publishing','published') LIMIT 1").get(contentId)) {
    throw Object.assign(new Error('Video Một Phút Vỡ Lẽ này đã có trong lịch.'), { statusCode: 409 });
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO module_schedules(id,content_id,scheduled_at,status,facebook_schedule_state,created_at,updated_at) VALUES(?,?,?,'scheduled','local',?,?)")
    .run(id, contentId, new Date(scheduledAt).toISOString(), now, now);
  return getMotPhutVoLeSchedule(id);
}

export function updateMotPhutVoLeSchedule(id, patch = {}) {
  const fields = {
    scheduledAt: 'scheduled_at', status: 'status', facebookScheduleState: 'facebook_schedule_state',
    facebookVideoId: 'facebook_video_id', facebookUploadSessionId: 'facebook_upload_session_id',
    facebookUploadOffset: 'facebook_upload_offset', facebookUploadEndOffset: 'facebook_upload_end_offset',
    facebookError: 'facebook_error', publishedAt: 'published_at', facebookCheckedAt: 'facebook_checked_at'
  };
  const entries = Object.entries(fields).filter(([key]) => key in patch);
  if (!entries.length) return getMotPhutVoLeSchedule(id);
  const values = entries.map(([key]) => patch[key]);
  const result = database().prepare(`UPDATE module_schedules SET ${entries.map(([, column]) => `${column}=?`).join(',')},updated_at=? WHERE id=?`)
    .run(...values, new Date().toISOString(), id);
  if (!result.changes) return null;
  return getMotPhutVoLeSchedule(id);
}

export function deleteMotPhutVoLeSchedule(id) {
  const schedule = getMotPhutVoLeSchedule(id);
  if (!schedule) return null;
  if (['publishing', 'published'].includes(schedule.status)) throw Object.assign(new Error('Lịch đang được gửi hoặc đã đăng nên không thể xóa.'), { statusCode: 409 });
  return updateMotPhutVoLeSchedule(id, { status: 'cancelled', facebookError: null });
}

export function recoverMotPhutVoLeSchedules({ staleAfterMs = 15 * 60_000 } = {}) {
  const cutoff = new Date(Date.now() - Math.max(60_000, staleAfterMs)).toISOString();
  const stale = database().prepare("SELECT id,facebook_schedule_state FROM module_schedules WHERE status='publishing' AND updated_at<?").all(cutoff);
  for (const schedule of stale) {
    const uncertain = schedule.facebook_schedule_state === 'finishing';
    updateMotPhutVoLeSchedule(schedule.id, {
      status: uncertain ? 'failed' : 'scheduled',
      facebookScheduleState: uncertain ? 'uncertain' : 'local',
      facebookError: uncertain ? 'Worker dừng sau khi gửi yêu cầu lên Facebook; hãy kiểm tra Planner trước khi thử lại.' : 'Worker đã khởi động lại; lịch MPVL đã được khôi phục để tiếp tục gửi.'
    });
  }
  return stale.length;
}

export function closeMotPhutVoLeHistory() {
  if (connection) {
    connection.close();
    connection = null;
  }
}

export function queueMotPhutVoLeJob(type, payload = {}) {
  if (!['create', 'rerender'].includes(type)) throw new Error('Loại job Một Phút Vỡ Lẽ không hợp lệ.');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = database();
  db.prepare('INSERT INTO module_jobs(id,type,payload_json,status,created_at,updated_at) VALUES(?,?,?,\'pending\',?,?)')
    .run(id, type, JSON.stringify(payload), now, now);
  return { id, type, status: 'pending', createdAt: now };
}

export function listMotPhutVoLeJobs({ limit = 50 } = {}) {
  const cap = Math.max(1, Math.min(200, Number(limit) || 50));
  return database().prepare('SELECT * FROM module_jobs ORDER BY created_at DESC LIMIT ?').all(cap).map(mapJobRow);
}

export function getMotPhutVoLeJob(id) {
  return mapJobRow(database().prepare('SELECT * FROM module_jobs WHERE id=?').get(id));
}

export function claimNextMotPhutVoLeJob() {
  const db = database();
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare("SELECT * FROM module_jobs WHERE status='pending' ORDER BY created_at LIMIT 1").get();
    if (!row) { db.exec('COMMIT'); return null; }
    const now = new Date().toISOString();
    db.prepare("UPDATE module_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE id=? AND status='pending'").run(now, row.id);
    db.exec('COMMIT');
    return mapJobRow(db.prepare('SELECT * FROM module_jobs WHERE id=?').get(row.id));
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { }
    throw error;
  }
}

export function updateMotPhutVoLeJob(id, patch = {}) {
  const db = database();
  const sets = [];
  const values = [];
  for (const key of ['status', 'lastError']) {
    if (!(key in patch)) continue;
    sets.push(`${key === 'lastError' ? 'last_error' : key}=?`);
    values.push(patch[key]);
  }
  if ('progress' in patch) { sets.push('progress_json=?'); values.push(JSON.stringify(patch.progress)); }
  if ('cancelRequested' in patch) { sets.push('cancel_requested=?'); values.push(patch.cancelRequested ? 1 : 0); }
  if (!sets.length) return getMotPhutVoLeJob(id);
  sets.push('updated_at=?'); values.push(new Date().toISOString(), id);
  const result = db.prepare(`UPDATE module_jobs SET ${sets.join(',')} WHERE id=?`).run(...values);
  if (!result.changes) throw new Error(`Không tìm thấy job ${id}.`);
  return getMotPhutVoLeJob(id);
}

export function requestMotPhutVoLeJobCancellation(id) {
  const job = getMotPhutVoLeJob(id);
  if (!job) return null;
  if (job.status === 'pending') return updateMotPhutVoLeJob(id, { status: 'cancelled', cancelRequested: true });
  if (job.status === 'running') return updateMotPhutVoLeJob(id, { cancelRequested: true });
  return job;
}

export function isMotPhutVoLeJobCancellationRequested(id) {
  return Boolean(database().prepare('SELECT cancel_requested FROM module_jobs WHERE id=?').get(id)?.cancel_requested);
}

export function recoverMotPhutVoLeJobs({ staleAfterMs = 45 * 60_000 } = {}) {
  const cutoff = new Date(Date.now() - Math.max(5 * 60_000, staleAfterMs)).toISOString();
  const result = database().prepare("UPDATE module_jobs SET status=CASE WHEN attempts < 2 THEN 'pending' ELSE 'failed' END,last_error=CASE WHEN attempts < 2 THEN 'Worker trước đó dừng giữa chừng; job được xếp lại.' ELSE 'Job dừng giữa chừng quá số lần phục hồi.' END,updated_at=? WHERE status='running' AND updated_at < ?")
    .run(new Date().toISOString(), cutoff);
  return result.changes;
}

function mapJobRow(row) {
  if (!row) return null;
  return { id: row.id, type: row.type, payload: parseJson(row.payload_json, {}), status: row.status, attempts: row.attempts,
    cancelRequested: Boolean(row.cancel_requested), progress: parseJson(row.progress_json, null), lastError: row.last_error,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

export const MOT_PHUT_VO_LE_HISTORY_DATABASE_PATH = HISTORY_DB;
