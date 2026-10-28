import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, DEFAULTS } from '../config.mjs';
import { TOPICS } from '../topics.mjs';
import { ensureBrandHashtag, formatCaption, preserveJapaneseHashtags } from '../ai/hashtag-utils.mjs';
import { localScheduleSlot, randomNextScheduledTime } from '../scheduler/time.mjs';
import { formatEnglishShadowingCaption } from '../english-shadowing/caption.mjs';
import { normalizeEnglishShadowingSettings } from '../english-shadowing/settings.mjs';
import { normalizeEnglishShadowingVisualDesign } from '../english-shadowing/visual-design.mjs';
import {
  getEnglishShadowingBackgroundTheme,
  getNextEnglishShadowingBackgroundThemeId
} from '../english-shadowing/background-themes.mjs';

for (const dir of [path.dirname(PATHS.database), PATHS.output, PATHS.temporary, PATHS.logs, PATHS.private, PATHS.backups]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new DatabaseSync(PATHS.database);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS facebook_page_profiles (
    id TEXT PRIMARY KEY, label TEXT NOT NULL, page_id TEXT NOT NULL,
    token_file TEXT NOT NULL, page_name TEXT, connection_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS facebook_page_routes (
    content_language TEXT PRIMARY KEY, profile_id TEXT NOT NULL, updated_at TEXT NOT NULL
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
    facebook_schedule_state TEXT NOT NULL DEFAULT 'local', facebook_video_id TEXT,
    facebook_upload_session_id TEXT, facebook_upload_offset INTEGER, facebook_upload_end_offset INTEGER,
    facebook_error TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS published_schedule_history (
    id TEXT PRIMARY KEY, video_id TEXT NOT NULL, topic TEXT NOT NULL, title TEXT NOT NULL,
    caption TEXT NOT NULL, scheduled_at TEXT NOT NULL, published_at TEXT NOT NULL, adapter TEXT NOT NULL DEFAULT 'meta',
    facebook_id TEXT, url TEXT, created_at TEXT NOT NULL
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
if (!db.prepare('PRAGMA table_info(scripts)').all().some((column) => column.name === 'speech_segments_json')) {
  try { db.exec("ALTER TABLE scripts ADD COLUMN speech_segments_json TEXT NOT NULL DEFAULT '[]'"); }
  catch (error) { if (!/duplicate column name/i.test(error.message)) throw error; }
}
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(4,?)').run(new Date().toISOString());

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES(?,?,?)');
const now = new Date().toISOString();
const hadLanguageBackgroundEffectProfiles = Boolean(db.prepare("SELECT 1 FROM settings WHERE key='backgroundEffectProfiles'").get());
// Move the former shared VieNeu speed to the Vietnamese control. English gets
// the new slower default unless a separate English speed was already saved.
const legacyVieNeuSpeed = db.prepare("SELECT value FROM settings WHERE key='vieneuSpeed'").get();
if (legacyVieNeuSpeed) insertSetting.run('vieneuViSpeed', legacyVieNeuSpeed.value, now);
db.prepare("DELETE FROM settings WHERE key='vieneuSpeed'").run();
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(5,?)').run(now);
const legacyVietnameseVoice = db.prepare("SELECT value FROM settings WHERE key='vieneuViVoice'").get()?.value || JSON.stringify(DEFAULTS.vieneuViVoice);
for (const key of ['vieneuJaViVoice', 'vieneuZhViVoice']) {
  const savedVoice = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  if (!savedVoice || JSON.parse(savedVoice.value) == null) {
    db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
      .run(key, legacyVietnameseVoice, now);
  }
}
for (const [key, value] of Object.entries(DEFAULTS)) insertSetting.run(key, JSON.stringify(value), now);
db.prepare('DELETE FROM settings WHERE key IN (?,?)').run('ollamaBaseUrl', 'ollamaModel');
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(8,?)').run(now);
if (!hadLanguageBackgroundEffectProfiles) {
  const readSetting = (key, fallback) => {
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
      return row ? JSON.parse(row.value) : fallback;
    } catch { return fallback; }
  };
  const legacyEffectProfile = {
    backgroundEffect: readSetting('backgroundEffect', 'bubbles'),
    backgroundEffectDensity: readSetting('backgroundEffectDensity', 28),
    backgroundEffectSpeed: readSetting('backgroundEffectSpeed', 58),
    backgroundEffectOpacity: readSetting('backgroundEffectOpacity', 32)
  };
  const profiles = Object.fromEntries(['en', 'zh', 'ja'].map((language) => [language, { ...legacyEffectProfile }]));
  db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
    .run('backgroundEffectProfiles', JSON.stringify(profiles), now);
}
const scheduleColumns = new Set(db.prepare('PRAGMA table_info(scheduled_posts)').all().map((column) => column.name));
for (const [name, definition] of [
  ['facebook_schedule_state', "TEXT NOT NULL DEFAULT 'local'"],
  ['facebook_video_id', 'TEXT'],
  ['facebook_upload_session_id', 'TEXT'],
  ['facebook_upload_offset', 'INTEGER'],
  ['facebook_upload_end_offset', 'INTEGER'],
  ['facebook_error', 'TEXT']
]) {
  if (scheduleColumns.has(name)) continue;
  try { db.exec(`ALTER TABLE scheduled_posts ADD COLUMN ${name} ${definition}`); }
  catch (error) { if (!/duplicate column name/i.test(error.message)) throw error; }
}
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(9,?)').run(now);
if (!db.prepare('PRAGMA table_info(videos)').all().some((column) => column.name === 'review_status')) {
  try { db.exec("ALTER TABLE videos ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending'"); }
  catch (error) { if (!/duplicate column name/i.test(error.message)) throw error; }
}
db.prepare("UPDATE videos SET review_status='approved' WHERE status IN ('scheduled','publishing','published')").run();
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(10,?)').run(now);
if (!db.prepare('PRAGMA table_info(videos)').all().some((column) => column.name === 'published_files_cleanup_pending')) {
  try { db.exec('ALTER TABLE videos ADD COLUMN published_files_cleanup_pending INTEGER NOT NULL DEFAULT 0'); }
  catch (error) { if (!/duplicate column name/i.test(error.message)) throw error; }
}
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(11,?)').run(now);
if (!db.prepare('PRAGMA table_info(scripts)').all().some((column) => column.name === 'content_language')) {
  try { db.exec("ALTER TABLE scripts ADD COLUMN content_language TEXT NOT NULL DEFAULT 'en'"); }
  catch (error) { if (!/duplicate column name/i.test(error.message)) throw error; }
}
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(12,?)').run(now);
db.exec('BEGIN IMMEDIATE');
try {
  db.prepare(`INSERT OR IGNORE INTO published_schedule_history
    (id,video_id,topic,title,caption,scheduled_at,published_at,adapter,facebook_id,url,created_at)
    SELECT p.id,p.video_id,s.topic,s.title,s.caption,p.scheduled_at,COALESCE(v.updated_at,p.updated_at),
      COALESCE((SELECT h.adapter FROM publish_history h WHERE h.video_id=v.id AND h.status='published' ORDER BY h.created_at DESC LIMIT 1),'meta'),
      COALESCE(p.facebook_video_id,v.published_id),v.published_url,p.created_at
    FROM scheduled_posts p JOIN videos v ON v.id=p.video_id JOIN scripts s ON s.id=v.script_id
    WHERE v.status='published' AND v.published_id IS NOT NULL`).run();
  db.prepare(`DELETE FROM scheduled_posts WHERE video_id IN
    (SELECT id FROM videos WHERE status='published' AND published_id IS NOT NULL)`).run();
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(12,?)').run(now);
  db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }
const facebookScheduleColumns = new Set(db.prepare('PRAGMA table_info(scheduled_posts)').all().map((column) => column.name));
for (const [name, definition] of [['target_page_profile_id', 'TEXT'], ['target_page_id', 'TEXT']]) {
  if (facebookScheduleColumns.has(name)) continue;
  try { db.exec(`ALTER TABLE scheduled_posts ADD COLUMN ${name} ${definition}`); }
  catch (error) { if (!/duplicate column name/i.test(error.message)) throw error; }
}
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(13,?)').run(now);
if (!db.prepare('PRAGMA table_info(videos)').all().some((column) => column.name === 'background_effect_json')) {
  try { db.exec('ALTER TABLE videos ADD COLUMN background_effect_json TEXT'); }
  catch (error) { if (!/duplicate column name/i.test(error.message)) throw error; }
}
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(14,?)').run(now);
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(15,?)').run(now);
if (!db.prepare('PRAGMA table_info(videos)').all().some((column) => column.name === 'english_shadowing_profile_json')) {
  try { db.exec('ALTER TABLE videos ADD COLUMN english_shadowing_profile_json TEXT'); }
  catch (error) { if (!/duplicate column name/i.test(error.message)) throw error; }
}
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(16,?)').run(now);
if (!db.prepare('PRAGMA table_info(videos)').all().some((column) => column.name === 'english_shadowing_theme_id')) {
  try { db.exec('ALTER TABLE videos ADD COLUMN english_shadowing_theme_id TEXT'); }
  catch (error) { if (!/duplicate column name/i.test(error.message)) throw error; }
}
db.exec(`CREATE TABLE IF NOT EXISTS english_shadowing_state (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
)`);
db.prepare('INSERT OR IGNORE INTO english_shadowing_state(key,value,updated_at) VALUES(?,?,?)')
  .run('next_background_theme_id', getNextEnglishShadowingBackgroundThemeId(null), now);
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(17,?)').run(now);
const insertTopic = db.prepare('INSERT OR IGNORE INTO topics(id,category,title,created_at) VALUES(?,?,?,?)');
for (const topic of TOPICS) insertTopic.run(topic.id, topic.category, topic.title, now);

const legacyTtsProviderMigration = db.prepare('UPDATE settings SET value=?,updated_at=? WHERE key=? AND value=?');
for (const [key, provider] of Object.entries({ ttsProvider: 'vieneu', japaneseTtsProvider: 'vieneu-sbv2', chineseTtsProvider: 'vieneu-cosyvoice3' })) {
  legacyTtsProviderMigration.run(JSON.stringify(provider), new Date().toISOString(), key, JSON.stringify('edge'));
}

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

export function getEnglishShadowingSettings() {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get('englishShadowingProfile');
  if (!row) return normalizeEnglishShadowingSettings();
  try { return normalizeEnglishShadowingSettings(JSON.parse(row.value)); }
  catch { return normalizeEnglishShadowingSettings(); }
}

export function saveEnglishShadowingSettings(settings) {
  const normalized = normalizeEnglishShadowingSettings(settings);
  db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
    .run('englishShadowingProfile', JSON.stringify(normalized), new Date().toISOString());
  return normalized;
}

export function listFacebookPageProfiles() {
  return db.prepare('SELECT id,label,page_id,page_name,connection_verified,created_at,updated_at FROM facebook_page_profiles ORDER BY created_at').all()
    .map((row) => ({ ...row, connectionVerified: Boolean(row.connection_verified) }));
}

export function getFacebookPageProfile(profileId) {
  if (profileId === 'legacy') {
    const settings = getSettings();
    return settings.pageId ? {
      id: 'legacy', label: 'Facebook Page hiện tại', pageId: String(settings.pageId),
      tokenFile: path.join(PATHS.private, 'facebook-page-token.txt'),
      connectionVerified: Boolean(settings.facebookConnectionVerified), legacy: true
    } : null;
  }
  const row = db.prepare('SELECT id,label,page_id,token_file,page_name,connection_verified FROM facebook_page_profiles WHERE id=?').get(String(profileId || ''));
  return row ? { id: row.id, label: row.label, pageId: row.page_id, tokenFile: row.token_file, pageName: row.page_name, connectionVerified: Boolean(row.connection_verified), legacy: false } : null;
}

export function facebookPageProfileHasActiveWork(profileId) {
  const scheduleSql = profileId === 'legacy'
    ? "SELECT 1 FROM scheduled_posts WHERE status IN ('scheduled','publishing') AND (target_page_profile_id='legacy' OR target_page_profile_id IS NULL) LIMIT 1"
    : "SELECT 1 FROM scheduled_posts WHERE target_page_profile_id=? AND status IN ('scheduled','publishing') LIMIT 1";
  if (profileId === 'legacy' ? db.prepare(scheduleSql).get() : db.prepare(scheduleSql).get(String(profileId))) return true;
  return db.prepare("SELECT payload_json FROM jobs WHERE type='publish_video' AND status IN ('pending','running')").all().some(({ payload_json }) => {
    try { return JSON.parse(payload_json).targetPageProfileId === String(profileId); }
    catch { return false; }
  });
}

export function saveFacebookPageProfile({ id, label, pageId, tokenFile }) {
  const stamp = new Date().toISOString();
  const profileId = String(id || crypto.randomUUID());
  const cleanLabel = String(label || '').trim().slice(0, 80);
  const cleanPageId = String(pageId || '').trim();
  if (!/^[\w-]{8,80}$/u.test(profileId) || !cleanLabel || !/^\d{5,}$/u.test(cleanPageId) || !tokenFile) throw new Error('Thông tin Facebook Page không hợp lệ.');
  const existing = db.prepare('SELECT page_id,connection_verified,page_name FROM facebook_page_profiles WHERE id=?').get(profileId);
  if (existing && existing.page_id !== cleanPageId && facebookPageProfileHasActiveWork(profileId)) {
    throw Object.assign(new Error('Không thể đổi Page ID khi còn lịch chưa hoàn tất đang sử dụng Page này.'), { statusCode: 409 });
  }
  db.prepare(`INSERT INTO facebook_page_profiles(id,label,page_id,token_file,connection_verified,created_at,updated_at)
    VALUES(?,?,?,?,0,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,page_id=excluded.page_id,token_file=excluded.token_file,
    connection_verified=CASE WHEN facebook_page_profiles.page_id=excluded.page_id THEN facebook_page_profiles.connection_verified ELSE 0 END,
    page_name=CASE WHEN facebook_page_profiles.page_id=excluded.page_id THEN facebook_page_profiles.page_name ELSE NULL END,updated_at=excluded.updated_at`)
    .run(profileId, cleanLabel, cleanPageId, tokenFile, stamp, stamp);
  return getFacebookPageProfile(profileId);
}

export function setFacebookPageVerification(profileId, { verified, pageName = null } = {}) {
  const profile = getFacebookPageProfile(profileId);
  if (!profile) return false;
  const stamp = new Date().toISOString();
  if (profile.legacy) saveSettings({ facebookConnectionVerified: Boolean(verified) });
  else db.prepare('UPDATE facebook_page_profiles SET connection_verified=?,page_name=?,updated_at=? WHERE id=?')
    .run(verified ? 1 : 0, pageName, stamp, profile.id);
  return true;
}

export function setFacebookPageRoute(contentLanguage, profileId) {
  const language = String(contentLanguage || '');
  if (!['en', 'ja', 'zh', 'english-shadowing'].includes(language)) throw new Error('Ngôn ngữ nội dung không hợp lệ.');
  if (language === 'english-shadowing' && String(profileId) === 'legacy') throw new Error('EnglishShadowing cần Page profile riêng; không thể gắn Page dùng chung hiện tại.');
  if (profileId === 'legacy') {
    if (!getFacebookPageProfile('legacy')) throw new Error('Chưa cấu hình Facebook Page hiện tại.');
  } else if (!getFacebookPageProfile(profileId)) throw new Error('Không tìm thấy Facebook Page đã chọn.');
  const existingRoute = db.prepare('SELECT profile_id FROM facebook_page_routes WHERE content_language=?').get(language)?.profile_id;
  if (existingRoute && existingRoute !== String(profileId) && facebookPageProfileHasActiveWork(existingRoute)) {
    throw Object.assign(new Error('Không thể đổi Page của ngôn ngữ này khi còn bài đang lên lịch hoặc đang đăng.'), { statusCode: 409 });
  }
  const otherRoute = db.prepare('SELECT content_language FROM facebook_page_routes WHERE profile_id=? AND content_language<>? LIMIT 1').get(String(profileId), language)?.content_language;
  if (otherRoute && facebookPageProfileHasActiveWork(profileId)) {
    throw Object.assign(new Error('Không thể chuyển Page sang ngôn ngữ khác khi còn bài đang lên lịch hoặc đang đăng.'), { statusCode: 409 });
  }
  if (otherRoute) db.prepare('DELETE FROM facebook_page_routes WHERE profile_id=? AND content_language<>?').run(String(profileId), language);
  db.prepare(`INSERT INTO facebook_page_routes(content_language,profile_id,updated_at) VALUES(?,?,?)
    ON CONFLICT(content_language) DO UPDATE SET profile_id=excluded.profile_id,updated_at=excluded.updated_at`)
    .run(language, String(profileId), new Date().toISOString());
  return { contentLanguage: language, profileId: String(profileId) };
}

export function getFacebookPageRoutes() {
  return Object.fromEntries(db.prepare('SELECT content_language,profile_id FROM facebook_page_routes').all().map((row) => [row.content_language, row.profile_id]));
}

export function clearFacebookPageRoute(contentLanguage) {
  const language = String(contentLanguage || '');
  if (!['en', 'ja', 'zh', 'english-shadowing'].includes(language)) throw new Error('Ngôn ngữ nội dung không hợp lệ.');
  const profileId = db.prepare('SELECT profile_id FROM facebook_page_routes WHERE content_language=?').get(language)?.profile_id;
  if (profileId && facebookPageProfileHasActiveWork(profileId)) {
    throw Object.assign(new Error('Không thể gỡ Page khi còn bài đang lên lịch hoặc đang đăng.'), { statusCode: 409 });
  }
  db.prepare('DELETE FROM facebook_page_routes WHERE content_language=?').run(language);
  return { contentLanguage: language, profileId: null };
}

export function facebookPageProfileLanguage(profileId) {
  const id = String(profileId || '');
  if (!id) return null;
  if (id === 'legacy') {
    const routes = db.prepare('SELECT content_language FROM facebook_page_routes WHERE profile_id=?').all(id);
    if (routes.length === 1) return routes[0].content_language;
    if (routes.length > 1) return null;
    const savedLanguage = String(getSettings().facebookPageLanguage || 'en');
    return ['en', 'ja', 'zh'].includes(savedLanguage) ? savedLanguage : 'en';
  }
  const routes = db.prepare('SELECT content_language FROM facebook_page_routes WHERE profile_id=?').all(id);
  return routes.length === 1 ? routes[0].content_language : null;
}

export function facebookPageProfileMatchesLanguage(profileId, contentLanguage) {
  const language = String(contentLanguage || 'en');
  if (language === 'english-shadowing' && String(profileId) === 'legacy') return false;
  return ['en', 'ja', 'zh', 'english-shadowing'].includes(language) && facebookPageProfileLanguage(profileId) === language;
}

export function getFacebookPageForLanguage(contentLanguage = 'en') {
  const requestedLanguage = String(contentLanguage || 'en');
  const language = ['en', 'ja', 'zh', 'english-shadowing'].includes(requestedLanguage) ? requestedLanguage : 'en';
  const route = db.prepare('SELECT profile_id FROM facebook_page_routes WHERE content_language=?').get(language)?.profile_id;
  if (route) return facebookPageProfileMatchesLanguage(route, language) ? getFacebookPageProfile(route) : null;
  if (language === 'english-shadowing') return null;
  return facebookPageProfileMatchesLanguage('legacy', language) ? getFacebookPageProfile('legacy') : null;
}

export function deleteFacebookPageProfile(profileId) {
  const profile = getFacebookPageProfile(profileId);
  if (!profile || profile.legacy) return false;
  if (facebookPageProfileHasActiveWork(profile.id)) {
    throw Object.assign(new Error('Page đang được dùng bởi lịch chưa hoàn tất; xóa sau khi xử lý các lịch này.'), { statusCode: 409 });
  }
  db.prepare('DELETE FROM facebook_page_routes WHERE profile_id=?').run(profile.id);
  db.prepare('DELETE FROM facebook_page_profiles WHERE id=?').run(profile.id);
  return profile;
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
  const processCannotStart = error?.syscall === 'spawn' && ['EPERM', 'EACCES', 'ENOENT'].includes(error?.code);
  const retry = !processCannotStart
    && !error?.permanentMetaPermission
    && !error?.facebookOutcomeUnknown
    && !error?.permanentTtsMemory
    && job.attempts < job.max_attempts;
  const delay = Math.min(60 * 60_000, 10_000 * (2 ** Math.max(0, job.attempts - 1)));
  const status = retry ? 'pending' : 'failed';
  const when = retry ? new Date(Date.now() + delay).toISOString() : new Date().toISOString();
  db.prepare('UPDATE jobs SET status=?,scheduled_at=?,locked_by=NULL,last_error=?,updated_at=? WHERE id=?')
    .run(status, when, message.slice(0, 1000), new Date().toISOString(), job.id);
  if (job.type === 'schedule_facebook_video' && !retry) {
    const scheduleId = job.payload?.scheduleId;
    if (scheduleId) {
      const facebookScheduleState = error?.facebookOutcomeUnknown ? 'uncertain' : 'failed';
      db.prepare('UPDATE scheduled_posts SET facebook_schedule_state=?,facebook_error=?,updated_at=? WHERE id=?')
        .run(facebookScheduleState, message.slice(0, 1000), new Date().toISOString(), scheduleId);
    }
  }
  log('ERROR', 'JOB_FAILED', message, job.id);
}

export function deferJob(jobId, delayMs = 5000) {
  const when = new Date(Date.now() + delayMs).toISOString();
  db.prepare("UPDATE jobs SET status='pending',attempts=MAX(0,attempts-1),scheduled_at=?,locked_by=NULL,updated_at=? WHERE id=?")
    .run(when, new Date().toISOString(), jobId);
}

export function recoverStaleJobs() {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const now = new Date().toISOString();
  const running = db.prepare("SELECT id,attempts,max_attempts,locked_by,updated_at,last_error FROM jobs WHERE status='running'").all();
  const update = db.prepare('UPDATE jobs SET status=?,locked_by=NULL,scheduled_at=?,last_error=?,updated_at=? WHERE id=? AND status=\'running\'');
  let recovered = 0;
  for (const job of running) {
    const workerPid = Number(String(job.locked_by || '').match(/^worker-(\d+)-/)?.[1]);
    let ownerAlive = null;
    if (Number.isInteger(workerPid) && workerPid > 0) {
      try { process.kill(workerPid, 0); ownerAlive = true; }
      catch (error) { ownerAlive = error.code === 'EPERM'; }
    }
    const olderThanTimeout = job.updated_at < cutoff;
    if (ownerAlive !== false && !olderThanTimeout) continue;

    const exhausted = Number(job.attempts) >= Number(job.max_attempts);
    const failure = exhausted
      ? (job.last_error || 'Worker đã dừng trước khi hoàn tất job sau số lần thử tối đa.')
      : job.last_error;
    const result = update.run(exhausted ? 'failed' : 'pending', now, failure, now, job.id);
    recovered += Number(result.changes);
  }
  return recovered;
}

export function getOverview() {
  const count = (sql) => Number(db.prepare(sql).get().count);
  const rows = db.prepare(`SELECT v.*,s.topic,s.title,s.caption,s.hashtags_json,s.thumbnail_title,s.content_language FROM videos v
    JOIN scripts s ON s.id=v.script_id WHERE v.archived_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM scheduled_posts p WHERE p.video_id=v.id
        AND p.status='scheduled' AND p.facebook_schedule_state='scheduled')
    ORDER BY v.created_at DESC LIMIT 12`).all()
    .map((row) => {
      const contentLanguage = row.content_language || 'en';
      const storedHashtags = JSON.parse(row.hashtags_json);
      const japaneseContent = contentLanguage === 'ja';
      const hashtags = contentLanguage === 'english-shadowing'
        ? storedHashtags
        : japaneseContent ? preserveJapaneseHashtags(storedHashtags)
          : ensureBrandHashtag(storedHashtags, contentLanguage);
      const captionText = contentLanguage === 'english-shadowing'
        ? formatEnglishShadowingCaption(row.caption, hashtags)
        : formatCaption(row.caption, hashtags, contentLanguage, { preserveJapaneseTags: japaneseContent });
      return { ...row, backgroundEffectConfig: parseVideoBackgroundEffect(row.background_effect_json), hashtags, captionText };
    });
  const contentHistory = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(topic || category || level || title || hook || dialogues_json || caption || hashtags_json || thumbnail_title || content_hash AS BLOB))),0) AS bytes FROM scripts`).get();
  return {
    counts: {
      videos: count('SELECT COUNT(*) AS count FROM videos WHERE archived_at IS NULL'),
      library: count(`SELECT COUNT(*) AS count FROM videos v WHERE v.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM scheduled_posts p WHERE p.video_id=v.id
          AND p.status='scheduled' AND p.facebook_schedule_state='scheduled')`),
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
  const contentLanguage = script.contentLanguage || 'en';
  const japaneseContent = contentLanguage === 'ja';
  script.hashtags = japaneseContent
    ? preserveJapaneseHashtags(script.hashtags)
    : ensureBrandHashtag(script.hashtags, contentLanguage);
  script.caption = formatCaption(script.caption, script.hashtags, contentLanguage, { preserveJapaneseTags: japaneseContent });
  const speechSegments = Array.isArray(script.speechSegments) && script.speechSegments.length
    ? script.speechSegments
    : Array.isArray(script.audioSegments) ? script.audioSegments : [];
  const existing = db.prepare('SELECT id FROM scripts WHERE content_hash=?').get(script.contentHash);
  if (existing) throw new Error('Kịch bản trùng với nội dung đã lưu; hãy chọn chủ đề khác.');
  db.prepare(`INSERT INTO scripts(id,topic_id,topic,category,level,title,hook,dialogues_json,speech_segments_json,caption,hashtags_json,thumbnail_title,provider,content_hash,created_at,content_language)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(script.id, topicId, script.topic, script.category, script.level, script.title, script.hook,
    JSON.stringify(script.dialogues || []), JSON.stringify(speechSegments), script.caption, JSON.stringify(script.hashtags), script.thumbnailTitle, provider, script.contentHash, script.createdAt, script.contentLanguage || 'en');
  db.prepare('UPDATE topics SET used_at=? WHERE id=?').run(new Date().toISOString(), topicId);
  return script.id;
}

export function insertEnglishShadowingScript(script) {
  const hashtags = Array.isArray(script.hashtags) ? script.hashtags : [];
  const captionText = formatEnglishShadowingCaption(script.caption, hashtags);
  const normalizedTags = captionText.match(/#[\p{L}\p{N}_]+/gu) || [];
  const caption = captionText.replace(/#[\p{L}\p{N}_]+/gu, '').trim();
  const speechSegments = Array.isArray(script.speechSegments) ? script.speechSegments : [];
  const existing = db.prepare('SELECT id FROM scripts WHERE content_hash=?').get(script.contentHash);
  if (existing) throw new Error('EnglishShadowing: kịch bản đã tồn tại trong thư viện.');
  db.prepare(`INSERT INTO scripts(id,topic_id,topic,category,level,title,hook,dialogues_json,speech_segments_json,caption,hashtags_json,thumbnail_title,provider,content_hash,created_at,content_language)
    VALUES(?,NULL,?,'EnglishShadowing','shadowing',?,?,?,?,?,?,?,?,?,?,?)`).run(
    script.id, script.topic, script.title, script.scriptText, JSON.stringify([{ english: script.scriptText }]),
    JSON.stringify(speechSegments), caption, JSON.stringify(normalizedTags), script.thumbnailTitle || script.title,
    'english-shadowing-kokoro', script.contentHash, script.createdAt, 'english-shadowing'
  );
  return script.id;
}

export function insertVideo(scriptId, status = 'script_ready') {
  const id = crypto.randomUUID();
  const stamp = new Date().toISOString();
  db.prepare('INSERT INTO videos(id,script_id,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, scriptId, status, stamp, stamp);
  return id;
}

export function insertEnglishShadowingVideo(scriptId, profile = {}, status = 'processing') {
  const id = crypto.randomUUID();
  const stamp = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const script = db.prepare("SELECT content_language FROM scripts WHERE id=?").get(scriptId);
    if (script?.content_language !== 'english-shadowing') throw new Error('EnglishShadowing: video cáº§n ká»‹ch báº£n Ä‘Ãºng luá»“ng.');
    const sequenceState = db.prepare("SELECT value FROM english_shadowing_state WHERE key='next_background_theme_id'").get();
    const themeId = getEnglishShadowingBackgroundTheme(sequenceState?.value)
      ? sequenceState.value
      : getNextEnglishShadowingBackgroundThemeId(null);
    const nextThemeId = getNextEnglishShadowingBackgroundThemeId(themeId);
    const savedProfile = {
      ...normalizeEnglishShadowingSettings(profile),
      visualDesign: normalizeEnglishShadowingVisualDesign(profile.visualDesign)
    };
    db.prepare('INSERT INTO videos(id,script_id,status,english_shadowing_profile_json,english_shadowing_theme_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, scriptId, status, JSON.stringify(savedProfile), themeId, stamp, stamp);
    db.prepare(`INSERT INTO english_shadowing_state(key,value,updated_at) VALUES('next_background_theme_id',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(nextThemeId, stamp);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return id;
}

export function getScript(scriptId) {
  const row = db.prepare('SELECT * FROM scripts WHERE id=?').get(scriptId);
  if (!row) return null;
  const contentLanguage = row.content_language || 'en';
  const storedHashtags = JSON.parse(row.hashtags_json);
  const dialogues = JSON.parse(row.dialogues_json);
  const japaneseContent = contentLanguage === 'ja';
  const hashtags = contentLanguage === 'english-shadowing' ? storedHashtags
    : japaneseContent ? preserveJapaneseHashtags(storedHashtags)
      : ensureBrandHashtag(storedHashtags, contentLanguage);
  const captionText = contentLanguage === 'english-shadowing'
    ? formatEnglishShadowingCaption(row.caption, hashtags)
    : formatCaption(row.caption, hashtags, contentLanguage, { preserveJapaneseTags: japaneseContent });
  return { ...row, dialogues, speechSegments: JSON.parse(row.speech_segments_json || '[]'), hashtags, captionText, thumbnailTitle: row.thumbnail_title, createdAt: row.created_at, contentHash: row.content_hash, contentLanguage };
}

function parseVideoBackgroundEffect(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

export function getVideo(videoId) {
  const video = db.prepare('SELECT * FROM videos WHERE id=?').get(videoId);
  return video ? { ...video, backgroundEffectConfig: parseVideoBackgroundEffect(video.background_effect_json), englishShadowingProfile: parseEnglishShadowingProfile(video.english_shadowing_profile_json) } : null;
}

export function findVideoByScriptId(scriptId) {
  const video = db.prepare('SELECT * FROM videos WHERE script_id=? ORDER BY created_at DESC LIMIT 1').get(scriptId);
  return video ? { ...video, backgroundEffectConfig: parseVideoBackgroundEffect(video.background_effect_json), englishShadowingProfile: parseEnglishShadowingProfile(video.english_shadowing_profile_json) } : null;
}

function parseEnglishShadowingProfile(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return {
      ...normalizeEnglishShadowingSettings(parsed),
      visualDesign: normalizeEnglishShadowingVisualDesign(parsed.visualDesign)
    };
  } catch {
    return {
      ...normalizeEnglishShadowingSettings(),
      visualDesign: normalizeEnglishShadowingVisualDesign()
    };
  }
}

export function updateVideo(videoId, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sql = `UPDATE videos SET ${keys.map((key) => `${key}=?`).join(',')},updated_at=? WHERE id=?`;
  db.prepare(sql).run(...keys.map((key) => patch[key]), new Date().toISOString(), videoId);
}

function removeGeneratedVideoFiles(videoId) {
  const safeId = String(videoId || '');
  if (!/^[\w-]+$/.test(safeId)) throw new Error('Video ID không hợp lệ khi dọn tệp đã đăng.');
  let removed = false;
  for (const root of [PATHS.output, PATHS.temporary]) {
    const absoluteRoot = path.resolve(root);
    const target = path.resolve(absoluteRoot, safeId);
    if (path.dirname(target) !== absoluteRoot || path.basename(target) !== safeId) continue;
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    removed = true;
  }
  return removed;
}

function clearPublishedAudioCacheIfIdle() {
  const temporaryRoot = path.resolve(PATHS.temporary);
  const cacheRoot = path.resolve(temporaryRoot, 'audio-cache');
  if (path.dirname(cacheRoot) !== temporaryRoot || path.basename(cacheRoot) !== 'audio-cache') {
    throw new Error('Đường dẫn cache âm thanh không hợp lệ khi dọn tệp đã đăng.');
  }

  // Serialize the idle check and cache removal with claimJob so a new render
  // cannot start using shared audio cache files between those two operations.
  db.exec('BEGIN IMMEDIATE');
  try {
    const activeVideoJob = db.prepare("SELECT 1 FROM jobs WHERE type='create_video' AND status='running' LIMIT 1").get();
    if (activeVideoJob) {
      db.exec('COMMIT');
      return { cleaned: false, removed: false };
    }
    const removed = fs.existsSync(cacheRoot);
    if (removed) fs.rmSync(cacheRoot, { recursive: true, force: true });
    db.exec('COMMIT');
    return { cleaned: true, removed };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function archivePublishedVideo(videoId) {
  const video = db.prepare('SELECT status,published_id,archived_at FROM videos WHERE id=?').get(videoId);
  if (!video || video.status !== 'published' || !video.published_id) return false;
  const stamp = new Date().toISOString();
  const result = db.prepare("UPDATE videos SET archived_at=COALESCE(archived_at,?),published_files_cleanup_pending=1,updated_at=? WHERE id=? AND status='published' AND published_id IS NOT NULL")
    .run(stamp, stamp, videoId);
  if (Number(result.changes) !== 1) return false;
  try {
    const audioCache = clearPublishedAudioCacheIfIdle();
    if (audioCache.removed) log('INFO', 'PUBLISHED_AUDIO_CACHE_DELETED', `Đã xóa cache giọng đọc dùng chung sau khi đăng video ${videoId}.`);
    if (!audioCache.cleaned) log('INFO', 'PUBLISHED_AUDIO_CACHE_CLEANUP_DEFERRED', `Đã dọn tệp riêng của video ${videoId}; sẽ xóa cache giọng đọc sau khi các job tạo video đang chạy hoàn tất.`);
    if (removeGeneratedVideoFiles(videoId)) log('INFO', 'PUBLISHED_VIDEO_FILES_DELETED', `Đã xóa tệp video ${videoId} sau khi xác nhận đăng thành công.`);
    db.prepare('UPDATE videos SET published_files_cleanup_pending=?,updated_at=? WHERE id=?').run(audioCache.cleaned ? 0 : 1, new Date().toISOString(), videoId);
  } catch (error) {
    log('WARN', 'PUBLISHED_VIDEO_FILES_DELETE_FAILED', `Đã đăng video ${videoId} nhưng chưa dọn được tệp cục bộ: ${error.message}`);
  }
  return !video.archived_at;
}

export function cleanupArchivedPublishedVideoFiles() {
  const rows = db.prepare("SELECT id FROM videos WHERE status='published' AND published_id IS NOT NULL AND archived_at IS NOT NULL AND published_files_cleanup_pending=1").all();
  let removed = 0;
  for (const { id } of rows) {
    try {
      if (removeGeneratedVideoFiles(id)) removed += 1;
      const audioCache = clearPublishedAudioCacheIfIdle();
      if (!audioCache.cleaned) continue;
      if (audioCache.removed) log('INFO', 'PUBLISHED_AUDIO_CACHE_DELETED', 'Đã xóa cache giọng đọc dùng chung sau khi dọn các video đã đăng.');
      db.prepare('UPDATE videos SET published_files_cleanup_pending=0,updated_at=? WHERE id=?').run(new Date().toISOString(), id);
    }
    catch (error) { log('WARN', 'PUBLISHED_VIDEO_FILES_DELETE_FAILED', `Chưa dọn được tệp video đã đăng ${id}: ${error.message}`); }
  }
  return removed;
}

export function listVideos() {
  return db.prepare(`SELECT v.*,s.topic,s.title,s.caption,s.hashtags_json,s.dialogues_json,s.provider,s.content_language,
    p.facebook_schedule_state,p.facebook_video_id,p.facebook_error
    FROM videos v JOIN scripts s ON s.id=v.script_id
    LEFT JOIN scheduled_posts p ON p.video_id=v.id
    WHERE v.archived_at IS NULL ORDER BY v.created_at DESC`).all()
    .map((video) => {
      const contentLanguage = video.content_language || 'en';
      const storedHashtags = JSON.parse(video.hashtags_json);
      const dialogues = JSON.parse(video.dialogues_json);
      const japaneseContent = contentLanguage === 'ja';
      const hashtags = contentLanguage === 'english-shadowing' ? storedHashtags
        : japaneseContent ? preserveJapaneseHashtags(storedHashtags)
          : ensureBrandHashtag(storedHashtags, contentLanguage);
      const captionText = contentLanguage === 'english-shadowing'
        ? formatEnglishShadowingCaption(video.caption, hashtags)
        : formatCaption(video.caption, hashtags, contentLanguage, { preserveJapaneseTags: japaneseContent });
      return { ...video, backgroundEffectConfig: parseVideoBackgroundEffect(video.background_effect_json), englishShadowingProfile: parseEnglishShadowingProfile(video.english_shadowing_profile_json), dialogues, hashtags, captionText };
    });
}

export function deleteVideo(videoId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const video = db.prepare('SELECT v.*,s.topic FROM videos v JOIN scripts s ON s.id=v.script_id WHERE v.id=?').get(videoId);
    if (!video) { db.exec('COMMIT'); return null; }
    const facebookSchedule = db.prepare('SELECT facebook_schedule_state FROM scheduled_posts WHERE video_id=?').get(videoId);
    if (['queued', 'uploading', 'finishing', 'scheduled', 'uncertain'].includes(facebookSchedule?.facebook_schedule_state)) {
      throw Object.assign(new Error('Video đã được gửi hoặc đang được lên lịch trên Facebook. Hãy hủy lịch trong Facebook trước khi xóa khỏi ứng dụng.'), { statusCode: 409 });
    }
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
  const language = db.prepare('SELECT s.content_language FROM scripts s JOIN videos v ON v.script_id=s.id WHERE v.id=?').get(videoId)?.content_language || 'en';
  const targetPage = getFacebookPageForLanguage(language);
  db.prepare("INSERT INTO scheduled_posts(id,video_id,scheduled_at,status,target_page_profile_id,target_page_id,created_at,updated_at) VALUES(?,?,?,'scheduled',?,?,?,?)")
    .run(id, videoId, scheduledAt, targetPage?.id || null, targetPage?.pageId || null, stamp, stamp);
  updateVideo(videoId, { status: 'scheduled', scheduled_at: scheduledAt, review_status: 'approved' });
  return { id, videoId, scheduledAt, status: 'scheduled', facebookScheduleState: 'local', targetPageProfileId: targetPage?.id || null, targetPageId: targetPage?.pageId || null };
}

function videoContentLanguage(videoId) {
  return db.prepare("SELECT COALESCE(s.content_language,'en') AS content_language FROM scripts s JOIN videos v ON v.script_id=s.id WHERE v.id=?").get(videoId)?.content_language || 'en';
}

function occupiedScheduleTimes({ contentLanguage = null, excludeScheduleId = null } = {}) {
  // Keep local/in-flight/uncertain rows as reservations; known failures release the daily slot.
  const scheduled = db.prepare(`SELECT p.scheduled_at,
      CASE WHEN p.status IN ('scheduled','publishing') AND p.facebook_schedule_state<>'failed' THEN 1 ELSE 0 END AS counts_toward_limit
    FROM scheduled_posts p JOIN videos v ON v.id=p.video_id JOIN scripts s ON s.id=v.script_id
    WHERE (? IS NULL OR COALESCE(s.content_language,'en')=?) AND (? IS NULL OR p.id<>?)`)
    .all(contentLanguage, contentLanguage, excludeScheduleId, excludeScheduleId);
  const published = db.prepare(`SELECT h.scheduled_at,1 AS counts_toward_limit
    FROM published_schedule_history h JOIN videos v ON v.id=h.video_id JOIN scripts s ON s.id=v.script_id
    WHERE (? IS NULL OR COALESCE(s.content_language,'en')=?) AND (? IS NULL OR h.id<>?)`)
    .all(contentLanguage, contentLanguage, excludeScheduleId, excludeScheduleId);
  return [...scheduled, ...published];
}

function scheduledCalendarDays(timeZone, after = new Date()) {
  const firstDay = localScheduleSlot(after, timeZone).day;
  return [...new Set(occupiedScheduleTimes()
    .map((row) => localScheduleSlot(row.scheduled_at, timeZone).day)
    .filter((day) => day >= firstDay))].sort();
}

function scheduleConstraints(videoId, scheduledAt, timeZone, postsPerDay) {
  const video = db.prepare('SELECT id,status,archived_at FROM videos WHERE id=?').get(videoId);
  if (!video) throw new Error('Không tìm thấy video.');
  if (video.archived_at || !['ready', 'scheduled'].includes(video.status)) throw new Error('Video chưa sẵn sàng để lên lịch.');
  const contentLanguage = videoContentLanguage(videoId);
  if (db.prepare('SELECT 1 FROM scheduled_posts WHERE video_id=? LIMIT 1').get(videoId)) throw new Error('Video này đã có trong lịch đăng.');
  const slot = localScheduleSlot(scheduledAt, timeZone);
  const sameDay = occupiedScheduleTimes({ contentLanguage })
    .map((row) => ({ ...localScheduleSlot(row.scheduled_at, timeZone), countsTowardLimit: row.counts_toward_limit !== 0 }))
    .filter((item) => item.day === slot.day);
  if (sameDay.some((item) => item.minute === slot.minute)) {
    throw Object.assign(new Error('Ngày này đã có video được xếp ở khung giờ này.'), { statusCode: 409 });
  }
  if (sameDay.filter((item) => item.countsTowardLimit).length >= Math.max(1, Math.min(4, Number(postsPerDay) || 1))) {
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
    const contentLanguage = videoContentLanguage(videoId);
    const schedules = occupiedScheduleTimes({ contentLanguage });
    const candidateDays = scheduledCalendarDays(timeZone, after);
    const scheduledAt = randomNextScheduledTime(after, timeZone, postsPerDay, schedules, { preferUnderfilledDay: true, candidateDays }).toISOString();
    scheduleConstraints(videoId, scheduledAt, timeZone, postsPerDay);
    const schedule = insertSchedule(videoId, scheduledAt);
    db.exec('COMMIT');
    return schedule;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function approveVideoAndCreateRandomSchedule(videoId, timeZone = getSettings().timezone, postsPerDay = getSettings().postsPerDay, after = new Date()) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const video = db.prepare('SELECT id,status,archived_at FROM videos WHERE id=?').get(videoId);
    if (!video || video.archived_at) throw Object.assign(new Error('Không tìm thấy video cần duyệt.'), { statusCode: 404 });
    const existing = db.prepare('SELECT id,video_id,scheduled_at,status,facebook_schedule_state FROM scheduled_posts WHERE video_id=?').get(videoId);
    if (existing) {
      if (video.status === 'scheduled' && existing.status === 'scheduled') {
        db.prepare("UPDATE videos SET review_status='approved',updated_at=? WHERE id=?").run(new Date().toISOString(), videoId);
        db.exec('COMMIT');
        return { id: existing.id, videoId: existing.video_id, scheduledAt: existing.scheduled_at, status: existing.status, facebookScheduleState: existing.facebook_schedule_state, alreadyScheduled: true };
      }
      throw Object.assign(new Error('Video này đã có lịch đăng.'), { statusCode: 409 });
    }
    if (video.status !== 'ready') throw Object.assign(new Error('Chỉ có thể duyệt video đã render xong.'), { statusCode: 409 });
    const contentLanguage = videoContentLanguage(videoId);
    const schedules = occupiedScheduleTimes({ contentLanguage });
    const candidateDays = scheduledCalendarDays(timeZone, after);
    const scheduledAt = randomNextScheduledTime(after, timeZone, postsPerDay, schedules, { preferUnderfilledDay: true, candidateDays }).toISOString();
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
  return db.prepare(`SELECT p.*,v.status AS video_status,
    (SELECT h.status FROM publish_history h WHERE h.video_id=v.id ORDER BY h.created_at DESC LIMIT 1) AS last_publish_status,
    COALESCE(p.facebook_error,v.last_error,(SELECT h.error FROM publish_history h WHERE h.video_id=v.id ORDER BY h.created_at DESC LIMIT 1)) AS error,s.topic,s.title,s.caption,s.content_language FROM scheduled_posts p
    JOIN videos v ON v.id=p.video_id JOIN scripts s ON s.id=v.script_id WHERE p.status<>'published' ORDER BY p.scheduled_at`).all();
}

export function deleteScheduleFromApp(scheduleId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const schedule = db.prepare(`SELECT p.id,p.video_id,p.status,p.facebook_schedule_state,p.facebook_video_id,
      v.status AS video_status,s.topic FROM scheduled_posts p
      JOIN videos v ON v.id=p.video_id JOIN scripts s ON s.id=v.script_id WHERE p.id=?`).get(scheduleId);
    if (!schedule) { db.exec('COMMIT'); return null; }
    if (schedule.status === 'publishing'
      || ['queued', 'uploading', 'finishing', 'published'].includes(schedule.facebook_schedule_state)
      || (schedule.facebook_schedule_state === 'scheduled' && schedule.facebook_video_id)) {
      throw Object.assign(new Error('Lịch đang được gửi hoặc Facebook đã xác nhận lịch từ xa. Hãy xử lý lịch trên Facebook trước khi xóa khỏi tool.'), { statusCode: 409 });
    }
    const activeScheduleJob = db.prepare("SELECT payload_json FROM jobs WHERE type='schedule_facebook_video' AND status IN ('pending','running')")
      .all().some(({ payload_json }) => {
        try { return JSON.parse(payload_json).scheduleId === schedule.id; } catch { return false; }
      });
    const activePublishJob = db.prepare("SELECT payload_json FROM jobs WHERE type='publish_video' AND status IN ('pending','running')")
      .all().some(({ payload_json }) => {
        try {
          const payload = JSON.parse(payload_json);
          return payload.scheduleId === schedule.id || payload.videoId === schedule.video_id;
        } catch { return false; }
      });
    const activePublication = db.prepare('SELECT 1 FROM active_publications WHERE video_id=? LIMIT 1').get(schedule.video_id);
    if (activeScheduleJob || activePublishJob || activePublication) {
      throw Object.assign(new Error('Video đang chờ đăng hoặc đang được xử lý. Hãy thử xóa lịch lại sau khi tác vụ kết thúc.'), { statusCode: 409 });
    }
    if (schedule.video_status === 'published') {
      throw Object.assign(new Error('Video đã được xác nhận là đã đăng. Hãy quản lý thông tin đó trong lịch sử bài đăng.'), { statusCode: 409 });
    }
    db.prepare('DELETE FROM scheduled_posts WHERE id=?').run(schedule.id);
    db.prepare("UPDATE videos SET status=CASE WHEN status='scheduled' THEN 'ready' ELSE status END,scheduled_at=NULL,updated_at=? WHERE id=?")
      .run(new Date().toISOString(), schedule.video_id);
    db.exec('COMMIT');
    return schedule;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function stageGeneratedVideoFiles(videoId) {
  const safeId = String(videoId || '');
  if (!/^[\w-]+$/.test(safeId)) throw new Error('Video ID không hợp lệ khi dọn tệp.');
  const staged = [];
  try {
    for (const root of [PATHS.output, PATHS.temporary]) {
      const absoluteRoot = path.resolve(root);
      const target = path.resolve(absoluteRoot, safeId);
      if (path.dirname(target) !== absoluteRoot || path.basename(target) !== safeId || !fs.existsSync(target)) continue;
      const quarantine = path.resolve(absoluteRoot, `.purge-${safeId}-${crypto.randomUUID()}`);
      if (path.dirname(quarantine) !== absoluteRoot) throw new Error('Đường dẫn tạm để dọn tệp không hợp lệ.');
      fs.renameSync(target, quarantine);
      staged.push({ target, quarantine });
    }
    return staged;
  } catch (error) {
    const restoreErrors = restoreGeneratedVideoFiles(staged);
    if (restoreErrors.length) error.message += ` Không khôi phục được thư mục: ${restoreErrors.join(', ')}.`;
    throw error;
  }
}

function restoreGeneratedVideoFiles(staged) {
  const errors = [];
  for (const { target, quarantine } of [...staged].reverse()) {
    try {
      if (fs.existsSync(quarantine) && !fs.existsSync(target)) fs.renameSync(quarantine, target);
    } catch { errors.push(quarantine); }
  }
  return errors;
}

function removeStagedGeneratedVideoFiles(staged) {
  const errors = [];
  for (const { quarantine } of staged) {
    try { fs.rmSync(quarantine, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); }
    catch { errors.push(quarantine); }
  }
  return errors;
}

export function purgeExpiredOrFailedSchedule(scheduleId) {
  const staged = [];
  let transactionOpen = false;
  let schedule;
  let relatedJobIds = [];
  try {
    db.exec('BEGIN IMMEDIATE');
    transactionOpen = true;
    schedule = db.prepare(`SELECT p.id,p.video_id,p.scheduled_at,p.status,p.facebook_schedule_state,p.facebook_video_id,
      v.status AS video_status,v.script_id,s.topic,s.title,
      (SELECT h.status FROM publish_history h WHERE h.video_id=v.id ORDER BY h.created_at DESC LIMIT 1) AS last_publish_status
      FROM scheduled_posts p JOIN videos v ON v.id=p.video_id JOIN scripts s ON s.id=v.script_id WHERE p.id=?`).get(scheduleId);
    if (!schedule) {
      db.exec('COMMIT');
      transactionOpen = false;
      return null;
    }

    const scheduledTimestamp = Date.parse(schedule.scheduled_at);
    const expired = Number.isFinite(scheduledTimestamp) && scheduledTimestamp <= Date.now();
    const failed = ['failed', 'publish_failed'].includes(schedule.status)
      || ['failed', 'publish_failed'].includes(schedule.video_status)
      || schedule.facebook_schedule_state === 'failed'
      || schedule.last_publish_status === 'failed';
    if (!expired && !failed) {
      throw Object.assign(new Error('Chỉ có thể xóa sạch bài đã quá lịch hoặc đang báo lỗi.'), { statusCode: 409 });
    }
    if (['publishing', 'published'].includes(schedule.status)
      || ['processing', 'script_ready', 'publishing', 'published'].includes(schedule.video_status)
      || ['queued', 'uploading', 'finishing', 'published'].includes(schedule.facebook_schedule_state)) {
      throw Object.assign(new Error('Bài đang được xử lý hoặc đã đăng; không thể xóa sạch lúc này.'), { statusCode: 409 });
    }

    const scriptIsOrphaned = !db.prepare('SELECT 1 FROM videos WHERE script_id=? AND id<>? LIMIT 1').get(schedule.script_id, schedule.video_id);
    const jobs = db.prepare("SELECT id,type,status,payload_json FROM jobs WHERE type IN ('create_video','create_english_shadowing_video','schedule_facebook_video','publish_video')").all();
    const relatedJobs = [];
    for (const job of jobs) {
      let payload;
      try { payload = JSON.parse(job.payload_json); } catch { continue; }
      if (payload.videoId !== schedule.video_id && payload.scheduleId !== schedule.id
        && !(scriptIsOrphaned && payload.scriptId === schedule.script_id)) continue;
      relatedJobs.push(job);
    }
    if (relatedJobs.some((job) => ['pending', 'running'].includes(job.status))) {
      throw Object.assign(new Error('Bài vẫn còn job đang chờ hoặc đang chạy; hãy đợi job kết thúc rồi xóa.'), { statusCode: 409 });
    }
    if (db.prepare('SELECT 1 FROM active_publications WHERE video_id=? LIMIT 1').get(schedule.video_id)) {
      throw Object.assign(new Error('Bài đang được đăng; hãy thử lại sau khi tác vụ kết thúc.'), { statusCode: 409 });
    }

    relatedJobIds = relatedJobs.map((job) => job.id);
    staged.push(...stageGeneratedVideoFiles(schedule.video_id));
    if (relatedJobIds.length) {
      const placeholders = relatedJobIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM logs WHERE job_id IN (${placeholders})`).run(...relatedJobIds);
      db.prepare(`DELETE FROM jobs WHERE id IN (${placeholders})`).run(...relatedJobIds);
    }
    db.prepare('DELETE FROM scheduled_posts WHERE id=?').run(schedule.id);
    db.prepare('DELETE FROM publish_history WHERE video_id=?').run(schedule.video_id);
    db.prepare('DELETE FROM published_schedule_history WHERE video_id=?').run(schedule.video_id);
    db.prepare('DELETE FROM active_publications WHERE video_id=?').run(schedule.video_id);
    db.prepare('DELETE FROM videos WHERE id=?').run(schedule.video_id);
    if (scriptIsOrphaned) {
      db.prepare('DELETE FROM scripts WHERE id=?').run(schedule.script_id);
    }
    db.exec('COMMIT');
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try { db.exec('ROLLBACK'); } catch { /* Keep restoring staged media after a database rollback error. */ }
    }
    const restoreErrors = restoreGeneratedVideoFiles(staged);
    if (restoreErrors.length) error.message += ` Không khôi phục được thư mục: ${restoreErrors.join(', ')}.`;
    throw error;
  }

  const cleanupWarnings = removeStagedGeneratedVideoFiles(staged);
  return {
    id: schedule.id,
    videoId: schedule.video_id,
    topic: schedule.topic,
    facebookRemoteMayRemain: Boolean(schedule.facebook_video_id)
      || ['scheduled', 'uncertain'].includes(schedule.facebook_schedule_state),
    cleanupWarnings
  };
}

export function listPublishedSchedules() {
  return db.prepare(`SELECT h.*,COALESCE(s.content_language,'en') AS content_language
    FROM published_schedule_history h
    LEFT JOIN videos v ON v.id=h.video_id
    LEFT JOIN scripts s ON s.id=v.script_id
    ORDER BY h.published_at DESC,h.created_at DESC`).all();
}

export function deletePublishedSchedule(scheduleId) {
  const record = db.prepare('SELECT id FROM published_schedule_history WHERE id=?').get(scheduleId);
  if (!record) return false;
  db.prepare('DELETE FROM published_schedule_history WHERE id=?').run(scheduleId);
  return true;
}

export function completePublishedSchedule(scheduleId, { facebookId = null, url = null, publishedAt = new Date().toISOString(), adapter = 'meta', publishHistoryId = null } = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const schedule = db.prepare(`SELECT p.*,s.topic,s.title,s.caption FROM scheduled_posts p
      JOIN videos v ON v.id=p.video_id JOIN scripts s ON s.id=v.script_id WHERE p.id=?`).get(scheduleId);
    if (!schedule) { db.exec('COMMIT'); return false; }
    const finalFacebookId = facebookId || schedule.facebook_video_id;
    db.prepare(`UPDATE videos SET status='published',published_id=COALESCE(?,published_id),published_url=COALESCE(?,published_url),
      scheduled_at=?,last_error=NULL,archived_at=CASE WHEN ?='meta' THEN COALESCE(archived_at,?) ELSE archived_at END,
      published_files_cleanup_pending=CASE WHEN ?='meta' THEN 1 ELSE published_files_cleanup_pending END,updated_at=? WHERE id=?`)
      .run(finalFacebookId, url, schedule.scheduled_at, adapter, publishedAt, adapter, publishedAt, schedule.video_id);
    if (publishHistoryId) {
      db.prepare("UPDATE publish_history SET status='published',facebook_id=COALESCE(?,facebook_id),url=COALESCE(?,url),error=NULL WHERE id=?")
        .run(finalFacebookId, url, publishHistoryId);
    } else {
      const prior = finalFacebookId
        ? db.prepare("SELECT id FROM publish_history WHERE video_id=? AND status='published' AND facebook_id=? ORDER BY created_at DESC LIMIT 1").get(schedule.video_id, finalFacebookId)
        : null;
      if (!prior) {
        db.prepare('INSERT INTO publish_history(id,video_id,adapter,status,facebook_id,url,created_at) VALUES(?,?,?,\'published\',?,?,?)')
          .run(crypto.randomUUID(), schedule.video_id, adapter, finalFacebookId, url, publishedAt);
      }
    }
    db.prepare(`INSERT OR IGNORE INTO published_schedule_history
      (id,video_id,topic,title,caption,scheduled_at,published_at,adapter,facebook_id,url,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(schedule.id, schedule.video_id, schedule.topic, schedule.title, schedule.caption,
      schedule.scheduled_at, publishedAt, adapter, finalFacebookId, url, schedule.created_at);
    db.prepare('DELETE FROM scheduled_posts WHERE id=?').run(schedule.id);
    db.exec('COMMIT');
    return true;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function queueFacebookSchedule(scheduleId, { manualRetry = false, expectedFacebookId = null, expectedState = null, targetPageProfileId = null, targetPageId = null } = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    let schedule = db.prepare("SELECT id,video_id,scheduled_at,facebook_schedule_state,facebook_video_id,status,target_page_profile_id,target_page_id FROM scheduled_posts WHERE id=?").get(scheduleId);
    if (manualRetry && schedule) {
      const activeJobs = db.prepare("SELECT type,payload_json FROM jobs WHERE type IN ('schedule_facebook_video','publish_video') AND status IN ('pending','running')").all();
      const alreadyActive = activeJobs.some(({ type, payload_json }) => {
        try {
          const payload = JSON.parse(payload_json);
          return type === 'schedule_facebook_video' ? payload.scheduleId === schedule.id
            : payload.scheduleId === schedule.id || payload.videoId === schedule.video_id;
        } catch { return false; }
      });
      if (alreadyActive) { db.exec('COMMIT'); return null; }
    }
    if (manualRetry && schedule && (schedule.facebook_video_id !== expectedFacebookId || schedule.facebook_schedule_state !== expectedState)) {
      db.exec('COMMIT');
      return null;
    }
    if (manualRetry && schedule && ['scheduled', 'failed'].includes(schedule.status)) {
      db.prepare(`UPDATE scheduled_posts SET status='scheduled',facebook_schedule_state='local',facebook_video_id=NULL,
        target_page_profile_id=?,target_page_id=?,
        facebook_upload_session_id=NULL,facebook_upload_offset=NULL,facebook_upload_end_offset=NULL,facebook_error=NULL,updated_at=? WHERE id=?`)
        .run(targetPageProfileId ?? schedule.target_page_profile_id, targetPageId ?? schedule.target_page_id, new Date().toISOString(), scheduleId);
      db.prepare("UPDATE videos SET status='scheduled',last_error=NULL,updated_at=? WHERE id=? AND status='publish_failed'")
        .run(new Date().toISOString(), schedule.video_id);
      schedule = { ...schedule, status: 'scheduled', facebook_schedule_state: 'local' };
    }
    if (!schedule || schedule.status !== 'scheduled' || schedule.facebook_schedule_state !== 'local') {
      db.exec('COMMIT');
      return null;
    }
    const settings = getSettings();
    if (new Date(schedule.scheduled_at).getTime() < Date.now() + 15 * 60_000) {
      const contentLanguage = videoContentLanguage(schedule.video_id);
      const otherSchedules = occupiedScheduleTimes({ contentLanguage, excludeScheduleId: schedule.id });
      const candidateDays = scheduledCalendarDays(settings.timezone);
      const revisedAt = randomNextScheduledTime(new Date(), settings.timezone, settings.postsPerDay, otherSchedules, { preferUnderfilledDay: true, candidateDays }).toISOString();
      db.prepare('UPDATE scheduled_posts SET scheduled_at=?,updated_at=? WHERE id=?').run(revisedAt, new Date().toISOString(), schedule.id);
      db.prepare('UPDATE videos SET scheduled_at=?,updated_at=? WHERE id=?').run(revisedAt, new Date().toISOString(), schedule.video_id);
      log('WARN', 'FACEBOOK_SCHEDULE_TIME_ADJUSTED', `Lịch Facebook cũ đã quá sát giờ đăng; hệ thống chuyển lịch ${schedule.id} sang ${revisedAt} để Facebook kịp nhận.`);
    }
    const jobId = queueJob('schedule_facebook_video', { scheduleId: schedule.id, videoId: schedule.video_id, ...(manualRetry ? { manualRetry: true } : {}) });
    db.prepare("UPDATE scheduled_posts SET facebook_schedule_state='queued',facebook_error=NULL,updated_at=? WHERE id=? AND facebook_schedule_state='local'")
      .run(new Date().toISOString(), schedule.id);
    db.exec('COMMIT');
    return { jobId, scheduleId: schedule.id, videoId: schedule.video_id };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function queueUnsubmittedFacebookSchedules(limit = 3) {
  const rows = db.prepare("SELECT id FROM scheduled_posts WHERE status='scheduled' AND facebook_schedule_state='local' ORDER BY scheduled_at LIMIT ?")
    .all(Math.max(1, Math.min(20, Number(limit) || 3)));
  return rows.map(({ id }) => queueFacebookSchedule(id)).filter(Boolean);
}

export function getFacebookSchedule(scheduleId) {
  return db.prepare('SELECT * FROM scheduled_posts WHERE id=?').get(scheduleId) || null;
}

export function updateFacebookSchedule(scheduleId, patch) {
  const allowed = new Set([
    'facebook_schedule_state', 'facebook_video_id', 'facebook_upload_session_id',
    'facebook_upload_offset', 'facebook_upload_end_offset', 'facebook_error', 'scheduled_at', 'status',
    'target_page_profile_id', 'target_page_id'
  ]);
  const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
  if (!entries.length) return;
  db.prepare(`UPDATE scheduled_posts SET ${entries.map(([key]) => `${key}=?`).join(',')},updated_at=? WHERE id=?`)
    .run(...entries.map(([, value]) => value), new Date().toISOString(), scheduleId);
}

export function claimDueSchedule() {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare("SELECT * FROM scheduled_posts WHERE status='scheduled' AND facebook_schedule_state='local' AND scheduled_at<=? ORDER BY scheduled_at LIMIT 1").get(new Date().toISOString());
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
