import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, DEFAULTS } from '../config.mjs';
import { TOPICS } from '../topics.mjs';
import { ensureBrandHashtag, formatCaption } from '../ai/hashtag-utils.mjs';
import { localScheduleSlot, randomNextScheduledTime } from '../scheduler/time.mjs';

for (const dir of [path.dirname(PATHS.database), PATHS.output, PATHS.temporary, PATHS.logs, PATHS.private, PATHS.backups]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new DatabaseSync(PATHS.database);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY, category TEXT NOT NULL, title TEXT NOT NULL UNIQUE,
    used_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scripts (
    id TEXT PRIMARY KEY, topic_id TEXT REFERENCES topics(id), topic TEXT NOT NULL,
    category TEXT NOT NULL, level TEXT NOT NULL, title TEXT NOT NULL, hook TEXT NOT NULL,
    dialogues_json TEXT NOT NULL, caption TEXT NOT NULL, hashtags_json TEXT NOT NULL,
    thumbnail_title TEXT NOT NULL, provider TEXT NOT NULL, content_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY, script_id TEXT NOT NULL REFERENCES scripts(id), status TEXT NOT NULL,
    video_path TEXT, thumbnail_path TEXT, duration_seconds REAL,
    scheduled_at TEXT, published_id TEXT, published_url TEXT, last_error TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3, scheduled_at TEXT NOT NULL,
    locked_by TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS jobs_due_idx ON jobs(status, scheduled_at, created_at);
  CREATE TABLE IF NOT EXISTS publish_history (
    id TEXT PRIMARY KEY, video_id TEXT NOT NULL REFERENCES videos(id), adapter TEXT NOT NULL,
    status TEXT NOT NULL, facebook_id TEXT, url TEXT, error TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scheduled_posts (
    id TEXT PRIMARY KEY, video_id TEXT NOT NULL UNIQUE REFERENCES videos(id),
    scheduled_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS active_publications (
    page_key TEXT PRIMARY KEY, job_id TEXT NOT NULL, video_id TEXT NOT NULL,
    acquired_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL, code TEXT,
    message TEXT NOT NULL, job_id TEXT, created_at TEXT NOT NULL
  );
`);
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,?)').run(new Date().toISOString());
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(2,?)').run(new Date().toISOString());
if (!db.prepare('PRAGMA table_info(videos)').all().some((column) => column.name === 'archived_at')) {
  try { db.exec('ALTER TABLE videos ADD COLUMN archived_at TEXT'); }
  catch (error) { if (!/duplicate column name/i.test(error.message)) throw error; }
}
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(3,?)').run(new Date().toISOString());

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES(?,?,?)');
const now = new Date().toISOString();
for (const [key, value] of Object.entries(DEFAULTS)) insertSetting.run(key, JSON.stringify(value), now);
const insertTopic = db.prepare('INSERT OR IGNORE INTO topics(id,category,title,created_at) VALUES(?,?,?,?)');
for (const topic of TOPICS) insertTopic.run(topic.id, topic.category, topic.title, now);

export function getSettings() {
  const values = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map((row) => [row.key, JSON.parse(row.value)]));
  return { ...DEFAULTS, ...values };
}

export function saveSettings(patch) {
  const allowed = new Set(Object.keys(DEFAULTS));
  const upsert = db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at');
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key) || key === 'allowPaidAiApi') continue;
    upsert.run(key, JSON.stringify(value), new Date().toISOString());
  }
  return getSettings();
}

export function log(level, code, message, jobId = null) {
  db.prepare('INSERT INTO logs(level,code,message,job_id,created_at) VALUES(?,?,?,?,?)')
    .run(level, code, String(message).slice(0, 1000), jobId, new Date().toISOString());
}

export function queueJob(type, payload, scheduledAt = new Date().toISOString()) {
  const id = crypto.randomUUID();
  const stamp = new Date().toISOString();
  db.prepare('INSERT INTO jobs(id,type,payload_json,status,scheduled_at,created_at,updated_at) VALUES(?,?,?,\'pending\',?,?,?)')
    .run(id, type, JSON.stringify(payload), scheduledAt, stamp, stamp);
  return id;
}

export function updateJobPayload(jobId, patch) {
  const row = db.prepare('SELECT payload_json FROM jobs WHERE id=?').get(jobId);
  if (!row) throw new Error('Không tìm thấy job cần cập nhật.');
  const payload = { ...JSON.parse(row.payload_json), ...patch };
  db.prepare('UPDATE jobs SET payload_json=?,updated_at=? WHERE id=?')
    .run(JSON.stringify(payload), new Date().toISOString(), jobId);
  return payload;
}

export function claimJob(workerId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare("SELECT * FROM jobs WHERE status='pending' AND scheduled_at<=? ORDER BY scheduled_at,created_at LIMIT 1").get(new Date().toISOString());
    if (!row) { db.exec('COMMIT'); return null; }
    const stamp = new Date().toISOString();
    const result = db.prepare("UPDATE jobs SET status='running',locked_by=?,attempts=attempts+1,updated_at=? WHERE id=? AND status='pending'").run(workerId, stamp, row.id);
    db.exec('COMMIT');
    if (Number(result.changes) !== 1) return null;
    return { ...row, attempts: Number(row.attempts) + 1, payload: JSON.parse(row.payload_json) };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function finishJob(jobId) {
  db.prepare("UPDATE jobs SET status='completed',locked_by=NULL,last_error=NULL,updated_at=? WHERE id=?")
    .run(new Date().toISOString(), jobId);
}

export function failJob(job, error) {
  const message = String(error?.message || error);
  const retry = job.attempts < job.max_attempts;
  const delay = Math.min(60 * 60_000, 10_000 * (2 ** Math.max(0, job.attempts - 1)));
  const status = retry ? 'pending' : 'failed';
  const when = retry ? new Date(Date.now() + delay).toISOString() : new Date().toISOString();
  db.prepare('UPDATE jobs SET status=?,scheduled_at=?,locked_by=NULL,last_error=?,updated_at=? WHERE id=?')
    .run(status, when, message.slice(0, 1000), new Date().toISOString(), job.id);
  log('ERROR', 'JOB_FAILED', message, job.id);
}

export function deferJob(jobId, delayMs = 5000) {
  const when = new Date(Date.now() + delayMs).toISOString();
  db.prepare("UPDATE jobs SET status='pending',attempts=MAX(0,attempts-1),scheduled_at=?,locked_by=NULL,updated_at=? WHERE id=?")
    .run(when, new Date().toISOString(), jobId);
}

export function recoverStaleJobs() {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const result = db.prepare("UPDATE jobs SET status='pending',locked_by=NULL,scheduled_at=?,updated_at=? WHERE status='running' AND updated_at<?")
    .run(new Date().toISOString(), new Date().toISOString(), cutoff);
  return Number(result.changes);
}

export function getOverview() {
  const count = (sql) => Number(db.prepare(sql).get().count);
  const rows = db.prepare('SELECT v.*,s.topic,s.title,s.caption,s.hashtags_json,s.thumbnail_title FROM videos v JOIN scripts s ON s.id=v.script_id WHERE v.archived_at IS NULL ORDER BY v.created_at DESC LIMIT 12').all()
    .map((row) => {
      const hashtags = ensureBrandHashtag(JSON.parse(row.hashtags_json));
      return { ...row, hashtags, captionText: formatCaption(row.caption, hashtags) };
    });
  const contentHistory = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(topic || category || level || title || hook || dialogues_json || caption || hashtags_json || thumbnail_title || content_hash AS BLOB))),0) AS bytes FROM scripts`).get();
  return {
    counts: {
      videos: count('SELECT COUNT(*) AS count FROM videos WHERE archived_at IS NULL'),
      ready: count("SELECT COUNT(*) AS count FROM videos WHERE archived_at IS NULL AND status='ready'"),
      scheduled: count("SELECT COUNT(*) AS count FROM videos WHERE archived_at IS NULL AND status='scheduled'"),
      published: count("SELECT COUNT(*) AS count FROM videos WHERE status='published'"),
      queued: count("SELECT COUNT(*) AS count FROM jobs WHERE status IN ('pending','running')")
    },
    contentHistory: { count: Number(contentHistory.count), bytes: Number(contentHistory.bytes) },
    videos: rows,
    logs: db.prepare('SELECT level,code,message,job_id,created_at FROM logs ORDER BY id DESC LIMIT 8').all()
  };
}

export function listTopics() {
  return db.prepare('SELECT id,category,title,used_at FROM topics ORDER BY category,title').all();
}

export function addTopic(category, title) {
  const cleanCategory = String(category || '').trim();
  const cleanTitle = String(title || '').trim();
  if (cleanCategory.length < 2 || cleanCategory.length > 80 || cleanTitle.length < 3 || cleanTitle.length > 120) throw new Error('Nhập nhóm 2–80 ký tự và chủ đề 3–120 ký tự.');
  const id = `custom-${crypto.randomUUID()}`;
  db.prepare('INSERT INTO topics(id,category,title,created_at) VALUES(?,?,?,?)').run(id, cleanCategory, cleanTitle, new Date().toISOString());
  return { id, category: cleanCategory, title: cleanTitle, used_at: null };
}

export function pickTopic(requestedId = null) {
  const exclusion = new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString();
  if (requestedId) return db.prepare('SELECT * FROM topics WHERE id=?').get(requestedId) || null;
  return db.prepare('SELECT * FROM topics WHERE used_at IS NULL OR used_at<? ORDER BY used_at IS NOT NULL, used_at, random() LIMIT 1').get(exclusion)
    || db.prepare('SELECT * FROM topics ORDER BY used_at, random() LIMIT 1').get();
}

export function insertScript(script, topicId, provider) {
  script.hashtags = ensureBrandHashtag(script.hashtags);
  script.caption = formatCaption(script.caption, script.hashtags);
  const existing = db.prepare('SELECT id FROM scripts WHERE content_hash=?').get(script.contentHash);
  if (existing) throw new Error('Kịch bản trùng với nội dung đã lưu; hãy chọn chủ đề khác.');
  db.prepare(`INSERT INTO scripts(id,topic_id,topic,category,level,title,hook,dialogues_json,caption,hashtags_json,thumbnail_title,provider,content_hash,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(script.id, topicId, script.topic, script.category, script.level, script.title, script.hook,
    JSON.stringify(script.dialogues), script.caption, JSON.stringify(script.hashtags), script.thumbnailTitle, provider, script.contentHash, script.createdAt);
  db.prepare('UPDATE topics SET used_at=? WHERE id=?').run(new Date().toISOString(), topicId);
  return script.id;
}

export function insertVideo(scriptId, status = 'script_ready') {
  const id = crypto.randomUUID();
  const stamp = new Date().toISOString();
  db.prepare('INSERT INTO videos(id,script_id,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, scriptId, status, stamp, stamp);
  return id;
}

export function getScript(scriptId) {
  const row = db.prepare('SELECT * FROM scripts WHERE id=?').get(scriptId);
  if (!row) return null;
  const hashtags = ensureBrandHashtag(JSON.parse(row.hashtags_json));
  return { ...row, dialogues: JSON.parse(row.dialogues_json), hashtags, captionText: formatCaption(row.caption, hashtags), thumbnailTitle: row.thumbnail_title, createdAt: row.created_at, contentHash: row.content_hash };
}

export function getVideo(videoId) {
  return db.prepare('SELECT * FROM videos WHERE id=?').get(videoId) || null;
}

export function findVideoByScriptId(scriptId) {
  return db.prepare('SELECT * FROM videos WHERE script_id=? ORDER BY created_at DESC LIMIT 1').get(scriptId) || null;
}

export function updateVideo(videoId, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sql = `UPDATE videos SET ${keys.map((key) => `${key}=?`).join(',')},updated_at=? WHERE id=?`;
  db.prepare(sql).run(...keys.map((key) => patch[key]), new Date().toISOString(), videoId);
}

export function archivePublishedVideo(videoId) {
  const stamp = new Date().toISOString();
  const result = db.prepare("UPDATE videos SET archived_at=?,updated_at=? WHERE id=? AND status='published' AND archived_at IS NULL")
    .run(stamp, stamp, videoId);
  return Number(result.changes) === 1;
}

export function listVideos() {
  return db.prepare('SELECT v.*,s.topic,s.title,s.caption,s.hashtags_json,s.dialogues_json,s.provider FROM videos v JOIN scripts s ON s.id=v.script_id WHERE v.archived_at IS NULL ORDER BY v.created_at DESC').all()
    .map((video) => {
      const hashtags = ensureBrandHashtag(JSON.parse(video.hashtags_json));
      return { ...video, dialogues: JSON.parse(video.dialogues_json), hashtags, captionText: formatCaption(video.caption, hashtags) };
    });
}

export function deleteVideo(videoId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const video = db.prepare('SELECT v.*,s.topic FROM videos v JOIN scripts s ON s.id=v.script_id WHERE v.id=?').get(videoId);
    if (!video) { db.exec('COMMIT'); return null; }
    if (['processing', 'script_ready', 'publishing'].includes(video.status)) {
      throw Object.assign(new Error('Không thể xóa video khi đang được tạo hoặc đăng.'), { statusCode: 409 });
    }
    const activePublication = db.prepare('SELECT 1 FROM active_publications WHERE video_id=? LIMIT 1').get(videoId);
    const queuedPublication = db.prepare("SELECT payload_json FROM jobs WHERE type='publish_video' AND status IN ('pending','running')")
      .all().some(({ payload_json }) => {
        try { return JSON.parse(payload_json).videoId === videoId; } catch { return false; }
      });
    if (activePublication || queuedPublication) {
      throw Object.assign(new Error('Video đang chờ đăng hoặc đang được đăng. Hãy thử xóa lại sau khi tác vụ kết thúc.'), { statusCode: 409 });
    }
    db.prepare('DELETE FROM scheduled_posts WHERE video_id=?').run(videoId);
    db.prepare('DELETE FROM publish_history WHERE video_id=?').run(videoId);
    db.prepare('DELETE FROM active_publications WHERE video_id=?').run(videoId);
    db.prepare('DELETE FROM videos WHERE id=?').run(videoId);
    db.exec('COMMIT');
    return video;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listJobs() { return db.prepare('SELECT id,type,status,attempts,scheduled_at,last_error,created_at FROM jobs ORDER BY created_at DESC LIMIT 50').all(); }

export function listPublishHistory() { return db.prepare('SELECT * FROM publish_history ORDER BY created_at DESC LIMIT 50').all(); }

export function insertPublishHistory(record) {
  db.prepare('INSERT INTO publish_history(id,video_id,adapter,status,facebook_id,url,error,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(crypto.randomUUID(), record.videoId, record.adapter, record.status, record.facebookId || null, record.url || null, record.error || null, new Date().toISOString());
}

export function updatePublishHistory(id, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.prepare(`UPDATE publish_history SET ${keys.map((key) => `${key}=?`).join(',')} WHERE id=?`)
    .run(...keys.map((key) => patch[key]), id);
}

function insertSchedule(videoId, scheduledAt) {
  const stamp = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO scheduled_posts(id,video_id,scheduled_at,status,created_at,updated_at) VALUES(?,?,?,'scheduled',?,?)")
    .run(id, videoId, scheduledAt, stamp, stamp);
  updateVideo(videoId, { status: 'scheduled', scheduled_at: scheduledAt });
  return { id, videoId, scheduledAt, status: 'scheduled' };
}

function scheduleConstraints(videoId, scheduledAt, timeZone, postsPerDay) {
  const video = db.prepare('SELECT id,status,archived_at FROM videos WHERE id=?').get(videoId);
  if (!video) throw new Error('Không tìm thấy video.');
  if (video.archived_at || !['ready', 'scheduled'].includes(video.status)) throw new Error('Video chưa sẵn sàng để lên lịch.');
  if (db.prepare('SELECT 1 FROM scheduled_posts WHERE video_id=? LIMIT 1').get(videoId)) throw new Error('Video này đã có trong lịch đăng.');
  const slot = localScheduleSlot(scheduledAt, timeZone);
  const sameDay = db.prepare('SELECT scheduled_at FROM scheduled_posts').all()
    .map((row) => localScheduleSlot(row.scheduled_at, timeZone))
    .filter((item) => item.day === slot.day);
  if (sameDay.some((item) => item.minute === slot.minute)) {
    throw Object.assign(new Error('Ngày này đã có video được xếp ở khung giờ này.'), { statusCode: 409 });
  }
  if (sameDay.length >= Math.max(1, Math.min(4, Number(postsPerDay) || 1))) {
    throw Object.assign(new Error('Ngày này đã đủ số video theo giới hạn đăng mỗi ngày.'), { statusCode: 409 });
  }
}

export function createSchedule(videoId, scheduledAt) {
  const settings = getSettings();
  db.exec('BEGIN IMMEDIATE');
  try {
    scheduleConstraints(videoId, scheduledAt, settings.timezone, settings.postsPerDay);
    const schedule = insertSchedule(videoId, scheduledAt);
    db.exec('COMMIT');
    return schedule;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function createRandomSchedule(videoId, timeZone = getSettings().timezone, postsPerDay = getSettings().postsPerDay, after = new Date()) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const schedules = db.prepare('SELECT scheduled_at FROM scheduled_posts').all();
    const scheduledAt = randomNextScheduledTime(after, timeZone, postsPerDay, schedules).toISOString();
    scheduleConstraints(videoId, scheduledAt, timeZone, postsPerDay);
    const schedule = insertSchedule(videoId, scheduledAt);
    db.exec('COMMIT');
    return schedule;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listSchedules() {
  return db.prepare(`SELECT p.*,v.status AS video_status,COALESCE(v.last_error,(SELECT h.error FROM publish_history h WHERE h.video_id=v.id ORDER BY h.created_at DESC LIMIT 1)) AS error,s.topic,s.title,s.caption FROM scheduled_posts p
    JOIN videos v ON v.id=p.video_id JOIN scripts s ON s.id=v.script_id ORDER BY p.scheduled_at`).all();
}

export function claimDueSchedule() {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare("SELECT * FROM scheduled_posts WHERE status='scheduled' AND scheduled_at<=? ORDER BY scheduled_at LIMIT 1").get(new Date().toISOString());
    if (!row) { db.exec('COMMIT'); return null; }
    const update = db.prepare("UPDATE scheduled_posts SET status='publishing',updated_at=? WHERE id=? AND status='scheduled'")
      .run(new Date().toISOString(), row.id);
    db.exec('COMMIT');
    return Number(update.changes) === 1 ? row : null;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function countFutureStock() {
  const row = db.prepare(`SELECT
    (SELECT COUNT(*) FROM scheduled_posts WHERE status IN ('scheduled','publishing')) +
    (SELECT COUNT(*) FROM videos WHERE status IN ('ready','script_ready','processing')) AS count`).get();
  return Number(row.count);
}

export function markSchedule(id, status) {
  db.prepare('UPDATE scheduled_posts SET status=?,updated_at=? WHERE id=?').run(status, new Date().toISOString(), id);
}

export function beginPublish(videoId, adapter) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const video = db.prepare('SELECT status,published_id,published_url FROM videos WHERE id=?').get(videoId);
    if (!video) throw new Error('Không tìm thấy video cần đăng.');
    if (video.status === 'published') { db.exec('COMMIT'); return { alreadyPublished: true, record: video }; }
    const prior = db.prepare("SELECT * FROM publish_history WHERE video_id=? AND status IN ('uploading','uncertain','published') ORDER BY created_at DESC LIMIT 1").get(videoId);
    if (prior?.status === 'published') { db.exec('COMMIT'); return { alreadyPublished: true, record: prior }; }
    if (prior) { db.exec('COMMIT'); return { inProgress: true, record: prior }; }
    const historyId = crypto.randomUUID();
    db.prepare("INSERT INTO publish_history(id,video_id,adapter,status,created_at) VALUES(?,?,?,'uploading',?)")
      .run(historyId, videoId, adapter, new Date().toISOString());
    db.prepare("UPDATE videos SET status='publishing',updated_at=? WHERE id=?").run(new Date().toISOString(), videoId);
    db.exec('COMMIT');
    return { historyId };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function acquirePagePublishLock(pageKey, jobId, videoId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const now = Date.now();
    db.prepare('DELETE FROM active_publications WHERE acquired_at<?').run(new Date(now - 20 * 60_000).toISOString());
    const prior = db.prepare('SELECT job_id FROM active_publications WHERE page_key=?').get(pageKey);
    if (prior && prior.job_id !== jobId) { db.exec('COMMIT'); return false; }
    db.prepare('INSERT INTO active_publications(page_key,job_id,video_id,acquired_at) VALUES(?,?,?,?) ON CONFLICT(page_key) DO UPDATE SET job_id=excluded.job_id,video_id=excluded.video_id,acquired_at=excluded.acquired_at')
      .run(pageKey, jobId, videoId, new Date().toISOString());
    db.exec('COMMIT');
    return true;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function releasePagePublishLock(pageKey, jobId) {
  db.prepare('DELETE FROM active_publications WHERE page_key=? AND job_id=?').run(pageKey, jobId);
}
