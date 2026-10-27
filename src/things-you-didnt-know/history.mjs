import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA } from '../config.mjs';
import { COUNTRY_CATALOG, TOPIC_GROUPS } from './catalog.mjs';
import { THINGS_YOU_DIDNT_KNOW_JOB_TYPE } from './settings.mjs';

const STORE_DIR = path.join(DATA, 'things-you-didnt-know');
const DATABASE_PATH = path.join(STORE_DIR, 'history.sqlite');
let connection;

function db() {
  if (connection) return connection;
  fs.mkdirSync(STORE_DIR, { recursive: true });
  connection = new DatabaseSync(DATABASE_PATH);
  connection.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  connection.exec(`
    CREATE TABLE IF NOT EXISTS catalog_countries (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, continent TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS module_state (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS module_jobs (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, payload_json TEXT NOT NULL,
      status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      progress_json TEXT, error_code TEXT, last_error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tydk_jobs_due_idx ON module_jobs(status, created_at);
    CREATE TABLE IF NOT EXISTS contents (
      id TEXT PRIMARY KEY, job_id TEXT, country_id TEXT NOT NULL, country_name TEXT NOT NULL,
      continent TEXT NOT NULL, cycle_no INTEGER NOT NULL, theme_id TEXT NOT NULL, theme_name TEXT NOT NULL,
      fact_key TEXT NOT NULL, fact_text TEXT NOT NULL, fact_fingerprint TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL, hook TEXT NOT NULL, narration TEXT NOT NULL, caption TEXT NOT NULL,
      interaction_question TEXT NOT NULL, hashtags_json TEXT NOT NULL, image_title TEXT NOT NULL,
      image_body TEXT NOT NULL, illustration_brief TEXT NOT NULL, thumbnail_headline TEXT NOT NULL,
      thumbnail_highlights_json TEXT NOT NULL, sources_json TEXT NOT NULL, voice_style TEXT NOT NULL,
      source_status TEXT NOT NULL DEFAULT 'needs_review', source_review_note TEXT,
      script_json TEXT NOT NULL, settings_snapshot_json TEXT NOT NULL, design_snapshot_json TEXT NOT NULL,
      audio_path TEXT, timing_path TEXT, video_path TEXT, thumbnail_path TEXT, duration_seconds REAL,
      status TEXT NOT NULL DEFAULT 'script_ready', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tydk_contents_created_idx ON contents(created_at DESC);
    CREATE INDEX IF NOT EXISTS tydk_contents_country_idx ON contents(country_id, cycle_no);
    CREATE TABLE IF NOT EXISTS fact_history (
      id TEXT PRIMARY KEY, content_id TEXT NOT NULL UNIQUE REFERENCES contents(id) ON DELETE CASCADE,
      country_id TEXT NOT NULL, cycle_no INTEGER NOT NULL, theme_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL UNIQUE, normalized_fact TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tydk_facts_country_idx ON fact_history(country_id, cycle_no);
    CREATE TABLE IF NOT EXISTS country_reservations (
      job_id TEXT PRIMARY KEY REFERENCES module_jobs(id) ON DELETE CASCADE,
      country_id TEXT NOT NULL, cycle_no INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'reserved',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS module_schedules (
      id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES contents(id), scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled', facebook_state TEXT NOT NULL DEFAULT 'local',
      facebook_video_id TEXT, facebook_error TEXT, target_page_id TEXT, adapter TEXT NOT NULL DEFAULT 'mock',
      upload_json TEXT, facebook_checked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tydk_schedules_due_idx ON module_schedules(status, scheduled_at);
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY, job_id TEXT, content_id TEXT, stage TEXT NOT NULL,
      severity TEXT NOT NULL, code TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tydk_activity_created_idx ON activity_log(created_at DESC);
  `);
  const addCountry = dbInsertCountry();
  for (const country of COUNTRY_CATALOG) addCountry.run(country.id, country.name, country.continent);
  connection.prepare("INSERT OR IGNORE INTO module_state(key,value,updated_at) VALUES('country_cycle','1',?)").run(now());
  const scheduleColumns = new Set(connection.prepare('PRAGMA table_info(module_schedules)').all().map((column) => column.name));
  for (const [name, definition] of [['target_page_id', 'TEXT'], ['adapter', "TEXT NOT NULL DEFAULT 'mock'"], ['upload_json', 'TEXT'], ['facebook_checked_at', 'TEXT']]) {
    if (!scheduleColumns.has(name)) connection.exec('ALTER TABLE module_schedules ADD COLUMN ' + name + ' ' + definition);
  }
  recoverThingsYouDidntKnowJobs(connection);
  return connection;
}

function dbInsertCountry() {
  return connection.prepare('INSERT OR IGNORE INTO catalog_countries(id,name,continent) VALUES(?,?,?)');
}
const now = () => new Date().toISOString();
const parse = (value, fallback = null) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };

function mapContent(row) {
  if (!row) return null;
  return {
    id: row.id, jobId: row.job_id, countryId: row.country_id, country: row.country_name,
    continent: row.continent, cycle: row.cycle_no, themeId: row.theme_id, theme: row.theme_name,
    factKey: row.fact_key, factText: row.fact_text, factFingerprint: row.fact_fingerprint,
    title: row.title, hook: row.hook, narration: row.narration, caption: row.caption,
    interactionQuestion: row.interaction_question, hashtags: parse(row.hashtags_json, []),
    imageTitle: row.image_title, imageBody: row.image_body, illustrationBrief: row.illustration_brief,
    thumbnailHeadline: row.thumbnail_headline, thumbnailHighlights: parse(row.thumbnail_highlights_json, []),
    sources: parse(row.sources_json, []), voiceStyle: row.voice_style, sourceStatus: row.source_status,
    sourceReviewNote: row.source_review_note, script: parse(row.script_json, {}),
    settingsSnapshot: parse(row.settings_snapshot_json, {}), designSnapshot: parse(row.design_snapshot_json, {}),
    audioPath: row.audio_path, timingPath: row.timing_path, videoPath: row.video_path,
    thumbnailPath: row.thumbnail_path, durationSeconds: row.duration_seconds, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function mapJob(row) {
  return row ? { id: row.id, type: row.type, payload: parse(row.payload_json, {}), status: row.status,
    attempts: row.attempts, progress: parse(row.progress_json, {}), errorCode: row.error_code,
    lastError: row.last_error, createdAt: row.created_at, updatedAt: row.updated_at } : null;
}

export function queueThingsYouDidntKnowJob(payload = {}) {
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const active = database.prepare("SELECT id FROM module_jobs WHERE type=? AND status IN ('pending','running') LIMIT 1")
      .get(THINGS_YOU_DIDNT_KNOW_JOB_TYPE);
    if (active) throw Object.assign(new Error(`Things You Didn't Know đang có job ${active.id} chờ hoặc chạy.`), { statusCode: 409 });
    const id = crypto.randomUUID();
    const stamp = now();
    const cycle = Number(database.prepare("SELECT value FROM module_state WHERE key='country_cycle'").get()?.value || 1);
    let country;
    if (payload.countryId) country = database.prepare('SELECT * FROM catalog_countries WHERE id=?').get(String(payload.countryId).toUpperCase());
    else {
      const currentFacts = database.prepare('SELECT country_id,COUNT(*) AS count FROM fact_history WHERE cycle_no=? GROUP BY country_id').all(cycle);
      const reserved = new Set(database.prepare("SELECT country_id FROM country_reservations WHERE status='reserved'").all().map((item) => item.country_id));
      const used = new Set([...currentFacts.map((item) => item.country_id), ...reserved]);
      let available = database.prepare('SELECT * FROM catalog_countries ORDER BY id').all().filter((item) => !used.has(item.id));
      if (!available.length) {
        const completedInCycle = Number(database.prepare('SELECT COUNT(DISTINCT country_id) AS count FROM fact_history WHERE cycle_no=?').get(cycle)?.count || 0);
        if (completedInCycle < COUNTRY_CATALOG.length) throw Object.assign(new Error('Các quốc gia còn lại trong vòng hiện tại đang được giữ chỗ bởi job khác.'), { statusCode: 409 });
        database.prepare("UPDATE module_state SET value=?,updated_at=? WHERE key='country_cycle'").run(String(cycle + 1), stamp);
        available = database.prepare('SELECT * FROM catalog_countries ORDER BY id').all();
      }
      const recent = database.prepare('SELECT c.continent FROM fact_history f JOIN catalog_countries c ON c.id=f.country_id ORDER BY f.created_at DESC LIMIT 18').all();
      const continentUse = new Map();
      for (const item of recent) continentUse.set(item.continent, (continentUse.get(item.continent) || 0) + 1);
      available.sort((left, right) => (continentUse.get(left.continent) || 0) - (continentUse.get(right.continent) || 0) || left.id.localeCompare(right.id));
      country = available[0];
    }
    if (!country) throw new Error('Không tìm thấy quốc gia trong catalog Things You Didn\'t Know.');
    const themeRows = database.prepare('SELECT theme_id,MAX(created_at) AS used_at FROM contents GROUP BY theme_id').all();
    const usedThemes = new Map(themeRows.map((item) => [item.theme_id, item.used_at]));
    const requestedThemeId = payload.themeId && TOPIC_GROUPS.some((item) => item.id === payload.themeId) ? payload.themeId : null;
    const selectedTheme = requestedThemeId
      ? TOPIC_GROUPS.find((item) => item.id === requestedThemeId)
      : TOPIC_GROUPS.slice().sort((left, right) =>
        (usedThemes.get(left.id) ? Date.parse(usedThemes.get(left.id)) : -1)
          - (usedThemes.get(right.id) ? Date.parse(usedThemes.get(right.id)) : -1)
        || left.id.localeCompare(right.id))[0];
    const insert = database.prepare('INSERT INTO module_jobs(id,type,payload_json,status,created_at,updated_at) VALUES(?,?,?,\'pending\',?,?)');
    const finalPayload = { ...payload, countryId: country.id, country: country.name, continent: country.continent, cycle,
      themeId: selectedTheme.id, theme: selectedTheme.name, createdAt: stamp };
    insert.run(id, THINGS_YOU_DIDNT_KNOW_JOB_TYPE, JSON.stringify(finalPayload), stamp, stamp);
    database.prepare('INSERT INTO country_reservations(job_id,country_id,cycle_no,status,created_at,updated_at) VALUES(?,?,?,\'reserved\',?,?)')
      .run(id, country.id, cycle, stamp, stamp);
    logThingsYouDidntKnowActivity({ jobId: id, stage: 'queued', code: 'TYDK_JOB_QUEUED', message: 'Đã xếp hàng tạo một Reel Things You Didn\'t Know.' });
    database.exec('COMMIT');
    const job = getThingsYouDidntKnowJob(id);
    return { ...job, country, selectedTheme };
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

export function claimNextThingsYouDidntKnowJob() {
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const row = database.prepare("SELECT * FROM module_jobs WHERE type=? AND status='pending' ORDER BY created_at LIMIT 1")
      .get(THINGS_YOU_DIDNT_KNOW_JOB_TYPE);
    if (!row) { database.exec('COMMIT'); return null; }
    const stamp = now();
    database.prepare("UPDATE module_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE id=? AND status='pending'").run(stamp, row.id);
    database.exec('COMMIT');
    return getThingsYouDidntKnowJob(row.id);
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

export function updateThingsYouDidntKnowJob(id, patch = {}) {
  const database = db();
  const current = getThingsYouDidntKnowJob(id);
  if (!current) return null;
  const status = patch.status || current.status;
  database.prepare('UPDATE module_jobs SET status=?,payload_json=?,progress_json=?,error_code=?,last_error=?,updated_at=? WHERE id=?')
    .run(status, JSON.stringify(patch.payload || current.payload), JSON.stringify(patch.progress || current.progress || {}),
      patch.errorCode ?? current.errorCode ?? null, patch.lastError ?? current.lastError ?? null, now(), id);
  return getThingsYouDidntKnowJob(id);
}

export function getThingsYouDidntKnowJob(id) { return mapJob(db().prepare('SELECT * FROM module_jobs WHERE id=?').get(id)); }
export function listThingsYouDidntKnowJobs(limit = 100) {
  return db().prepare('SELECT * FROM module_jobs WHERE type=? ORDER BY created_at DESC LIMIT ?')
    .all(THINGS_YOU_DIDNT_KNOW_JOB_TYPE, Math.max(1, Math.min(500, Number(limit) || 100))).map(mapJob);
}

export function retryThingsYouDidntKnowJob(id) {
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const job = getThingsYouDidntKnowJob(id);
    if (!job || job.status !== 'failed') throw new Error('Chỉ có thể thử lại job Things You Didn\'t Know đã thất bại.');
    if (job.payload.contentId && getThingsYouDidntKnowContent(job.payload.contentId)?.status === 'deleted') {
      throw Object.assign(new Error('Reel đã xóa khỏi thư viện; lịch sử chống trùng vẫn được giữ nên không thể render lại nội dung này.'), { statusCode: 409 });
    }
    const stamp = now();
    if (!job.payload.contentId) database.prepare("UPDATE country_reservations SET status='reserved',updated_at=? WHERE job_id=?").run(stamp, id);
    database.prepare("UPDATE module_jobs SET status='pending',error_code=NULL,last_error=NULL,updated_at=? WHERE id=?").run(stamp, id);
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
  return getThingsYouDidntKnowJob(id);
}

export function releaseThingsYouDidntKnowReservation(jobId) {
  db().prepare("UPDATE country_reservations SET status='released',updated_at=? WHERE job_id=? AND status='reserved'").run(now(), jobId);
}
export function completeThingsYouDidntKnowReservation(jobId) {
  db().prepare("UPDATE country_reservations SET status='used',updated_at=? WHERE job_id=? AND status='reserved'").run(now(), jobId);
}

export function getThingsYouDidntKnowRecentFormatHistory(limit = 20) {
  return db().prepare("SELECT script_json FROM contents WHERE status<>'deleted' ORDER BY created_at DESC LIMIT ?")
    .all(Math.max(1, Math.min(100, Number(limit) || 20))).map((row) => {
      const script = parse(row.script_json, {});
      return [
        ...(Number.isInteger(script.openingStyleIndex) ? [{ kind: 'opening', index: script.openingStyleIndex }] : []),
        ...(Number.isInteger(script.interactionStyleIndex) ? [{ kind: 'interaction', index: script.interactionStyleIndex }] : [])
      ];
    }).flat();
}

export function listThingsYouDidntKnowFactKeys(limit = 500) {
  return db().prepare('SELECT normalized_fact FROM fact_history ORDER BY created_at DESC LIMIT ?')
    .all(Math.max(1, Math.min(2000, Number(limit) || 500))).map((item) => item.normalized_fact);
}

export function recoverThingsYouDidntKnowJobs(database = db()) {
  const stamp = new Date(Date.now() - 5 * 60_000).toISOString();
  database.prepare("UPDATE module_jobs SET status='pending',updated_at=? WHERE type=? AND status='running' AND updated_at<?")
    .run(now(), THINGS_YOU_DIDNT_KNOW_JOB_TYPE, stamp);
}

export function logThingsYouDidntKnowActivity({ jobId = null, contentId = null, stage, severity = 'INFO', code, message }) {
  const database = db();
  database.prepare('INSERT INTO activity_log(id,job_id,content_id,stage,severity,code,message,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(crypto.randomUUID(), jobId, contentId, String(stage || 'unknown').slice(0, 80), String(severity || 'INFO').slice(0, 12),
      String(code || 'TYDK_EVENT').slice(0, 100), String(message || '').replace(/[\u0000-\u001f]+/gu, ' ').slice(0, 900), now());
}
export function listThingsYouDidntKnowActivity(limit = 200) {
  return db().prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(Math.max(1, Math.min(1000, Number(limit) || 200)));
}

function factFingerprint(countryId, themeId, factText) {
  const normalized = `${countryId}|${themeId}|${String(factText || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

const FACT_STOP_WORDS = new Set('about after again against among and are around because been before being between but came can could did does each from had has have her here him his how into its just more most other our out over said same some such than that the their them then there these they this those through too under until very was were what when where which while who will with would you your country people habit custom'.split(' '));
function semanticTokens(value) {
  return new Set(String(value || '').normalize('NFKD').toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}]{3,}/gu)?.filter((word) => !FACT_STOP_WORDS.has(word)) || []);
}
function semanticDuplicate(candidate, previous) {
  const left = semanticTokens(candidate);
  const right = semanticTokens(previous);
  if (left.size < 5 || right.size < 5) return false;
  let overlap = 0;
  for (const word of left) if (right.has(word)) overlap += 1;
  return overlap / Math.max(1, Math.min(left.size, right.size)) >= 0.78;
}

export function createThingsYouDidntKnowContent({ jobId, payload, script, sourceStatus = 'needs_review', sourceReviewNote = '', settingsSnapshot, designSnapshot }) {
  const database = db();
  const country = database.prepare('SELECT * FROM catalog_countries WHERE id=?').get(payload.countryId);
  if (!country) throw new Error('Quốc gia của nội dung không còn trong catalog.');
  const fingerprint = factFingerprint(country.id, payload.themeId, script.factKey || script.factText);
  const factKey = String(script.factKey || '').trim();
  const factText = String(script.factText || script.factKey || '').trim();
  if (!factText || !factKey) throw new Error('Thiếu factKey hoặc factText.');
  const existing = database.prepare('SELECT id FROM fact_history WHERE fingerprint=?').get(fingerprint);
  if (existing) throw Object.assign(new Error('Fact này đã có trong lịch sử Things You Didn\'t Know.'), { code: 'TYDK_DUPLICATE_FACT' });
  const previousFacts = database.prepare('SELECT normalized_fact FROM fact_history').all();
  if (previousFacts.some((row) => semanticDuplicate(factText, row.normalized_fact))) {
    throw Object.assign(new Error('Fact có mức trùng ngữ nghĩa cao với lịch sử Things You Didn\'t Know.'), { code: 'TYDK_DUPLICATE_FACT' });
  }
  const id = crypto.randomUUID();
  const stamp = now();
  const themeName = script.theme || payload.theme || 'Daily life';
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare(`INSERT INTO contents(id,job_id,country_id,country_name,continent,cycle_no,theme_id,theme_name,
      fact_key,fact_text,fact_fingerprint,title,hook,narration,caption,interaction_question,hashtags_json,image_title,image_body,
      illustration_brief,thumbnail_headline,thumbnail_highlights_json,sources_json,voice_style,source_status,source_review_note,
      script_json,settings_snapshot_json,design_snapshot_json,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'script_ready',?,?)`).run(
      id, jobId, country.id, country.name, country.continent, Number(payload.cycle) || 1, String(payload.themeId || 'daily-life'), themeName,
      factKey, factText, fingerprint, script.title, script.hook, script.narration, script.caption, script.interactionQuestion,
      JSON.stringify(script.hashtags), script.imageTitle, script.imageBody, script.illustrationBrief, script.thumbnailHeadline,
      JSON.stringify(script.thumbnailHighlights || []), JSON.stringify(script.sources || []), script.voiceStyle || 'warm, curious, conversational',
      sourceStatus, String(sourceReviewNote || ''), JSON.stringify(script), JSON.stringify(settingsSnapshot), JSON.stringify(designSnapshot), stamp, stamp
    );
    database.prepare('INSERT INTO fact_history(id,content_id,country_id,cycle_no,theme_id,fingerprint,normalized_fact,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(crypto.randomUUID(), id, country.id, Number(payload.cycle) || 1, String(payload.themeId || 'daily-life'), fingerprint,
        factText.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(), 'scripted', stamp, stamp);
    database.prepare("UPDATE country_reservations SET status='used',updated_at=? WHERE job_id=?").run(stamp, jobId);
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
  return getThingsYouDidntKnowContent(id);
}

export function getThingsYouDidntKnowContent(id) { return mapContent(db().prepare('SELECT * FROM contents WHERE id=?').get(id)); }
export function updateThingsYouDidntKnowContent(id, patch = {}) {
  const current = getThingsYouDidntKnowContent(id);
  if (!current) return null;
  if (patch.sourceStatus === 'human-reviewed' && current.videoPath && !Object.hasOwn(patch, 'status')) patch = { ...patch, status: 'ready' };
  const columns = new Map([
    ['status', 'status'], ['audioPath', 'audio_path'], ['timingPath', 'timing_path'], ['videoPath', 'video_path'],
    ['thumbnailPath', 'thumbnail_path'], ['durationSeconds', 'duration_seconds'], ['sourceStatus', 'source_status'],
    ['sourceReviewNote', 'source_review_note']
  ]);
  const entries = [...columns].filter(([key]) => key in patch);
  if (entries.length) {
    const values = entries.map(([key]) => patch[key]);
    db().prepare(`UPDATE contents SET ${entries.map(([, column]) => `${column}=?`).join(',')},updated_at=? WHERE id=?`)
      .run(...values, now(), id);
  }
  if ('sourceStatus' in patch) db().prepare('UPDATE fact_history SET status=?,updated_at=? WHERE content_id=?').run(patch.sourceStatus, now(), id);
  return getThingsYouDidntKnowContent(id);
}

export function deleteThingsYouDidntKnowVideo(id) {
  const contentId = String(id || '');
  if (!/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/iu.test(contentId)) {
    throw Object.assign(new Error('Mã Reel Things You Didn\'t Know không hợp lệ.'), { statusCode: 400 });
  }

  const database = db();
  const staged = [];
  let committed = false;
  database.exec('BEGIN IMMEDIATE');
  try {
    const row = database.prepare('SELECT * FROM contents WHERE id=?').get(contentId);
    if (!row) { database.exec('COMMIT'); committed = true; return null; }
    if (row.status === 'deleted') { database.exec('COMMIT'); committed = true; return { id: contentId, deleted: true, removedFileCount: 0, cleanupWarnings: [] }; }

    const activeJobs = database.prepare("SELECT payload_json,progress_json FROM module_jobs WHERE type=? AND status IN ('pending','running')")
      .all(THINGS_YOU_DIDNT_KNOW_JOB_TYPE);
    const belongsToActiveJob = activeJobs.some((job) => {
      const payload = parse(job.payload_json, {});
      const progress = parse(job.progress_json, {});
      return payload.contentId === contentId || progress.contentId === contentId;
    });
    if (belongsToActiveJob) throw Object.assign(new Error('Reel đang được xử lý. Hãy đợi job kết thúc rồi xóa.'), { statusCode: 409 });

    const schedules = database.prepare('SELECT status,facebook_state FROM module_schedules WHERE content_id=?').all(contentId);
    const hasActiveSchedule = schedules.some((schedule) => ['scheduled', 'publishing', 'uncertain'].includes(schedule.status)
      || ['uploading', 'finishing'].includes(schedule.facebook_state));
    if (hasActiveSchedule) throw Object.assign(new Error('Reel đang có lịch đăng chưa kết thúc. Hãy hủy lịch trước khi xóa.'), { statusCode: 409 });

    const outputRoot = path.resolve(DATA, 'outputs', 'things-you-didnt-know');
    const contentOutput = path.resolve(outputRoot, contentId);
    if (path.dirname(contentOutput) !== outputRoot || path.basename(contentOutput) !== contentId) {
      throw new Error('Thư mục media Things You Didn\'t Know không hợp lệ.');
    }
    for (const file of [row.audio_path, row.timing_path, row.video_path, row.thumbnail_path].filter(Boolean)) {
      const absolute = path.resolve(file);
      if (!absolute.startsWith(contentOutput + path.sep)) {
        throw new Error('Đường dẫn media nằm ngoài thư mục của Reel; đã dừng để bảo vệ tệp khác.');
      }
    }

    if (fs.existsSync(contentOutput)) {
      const stagedPath = path.resolve(outputRoot, `.things-delete-${crypto.randomUUID()}`);
      if (path.dirname(stagedPath) !== outputRoot) throw new Error('Thư mục tạm xóa Things You Didn\'t Know không hợp lệ.');
      fs.renameSync(contentOutput, stagedPath);
      staged.push({ original: contentOutput, staged: stagedPath });
    }

    database.prepare(`UPDATE contents SET status='deleted',audio_path=NULL,timing_path=NULL,video_path=NULL,
      thumbnail_path=NULL,duration_seconds=NULL,updated_at=? WHERE id=?`).run(now(), contentId);
    logThingsYouDidntKnowActivity({ jobId: row.job_id, contentId, stage: 'video-deleted', code: 'TYDK_VIDEO_DELETED',
      message: 'Đã xóa tệp media khỏi máy và ẩn Reel khỏi thư viện; kịch bản, fact và lịch sử chống trùng được giữ nguyên.' });
    database.exec('COMMIT');
    committed = true;

    const cleanupWarnings = [];
    for (const artifact of staged) {
      try { fs.rmSync(artifact.staged, { recursive: true, force: true }); }
      catch { cleanupWarnings.push(path.basename(artifact.original)); }
    }
    return { id: contentId, deleted: true, removedFileCount: staged.length, cleanupWarnings, historyRetained: true };
  } catch (error) {
    if (!committed) {
      try { database.exec('ROLLBACK'); } catch { }
      for (const artifact of [...staged].reverse()) {
        try { if (fs.existsSync(artifact.staged) && !fs.existsSync(artifact.original)) fs.renameSync(artifact.staged, artifact.original); } catch { }
      }
    }
    throw error;
  }
}

export function listThingsYouDidntKnowContents({ limit = 250, status = '' } = {}) {
  const cap = Math.max(1, Math.min(1000, Number(limit) || 250));
  return (status
    ? db().prepare('SELECT * FROM contents WHERE status=? ORDER BY created_at DESC LIMIT ?').all(status, cap)
    : db().prepare('SELECT * FROM contents ORDER BY created_at DESC LIMIT ?').all(cap)).map(mapContent);
}
export function approveThingsYouDidntKnowSources(id, note = '') {
  const content = getThingsYouDidntKnowContent(id);
  if (!content) throw new Error('Không tìm thấy Reel cần duyệt nguồn.');
  if (!content.sources.length) throw new Error('Không thể duyệt nguồn khi Reel không có nguồn tham chiếu.');
  return updateThingsYouDidntKnowContent(id, { sourceStatus: 'human-reviewed', sourceReviewNote: String(note || 'Nguồn và fact đã được người dùng xem xét.').slice(0, 500) });
}

export function createThingsYouDidntKnowSchedule(contentId, scheduledAt, { adapter = 'mock', targetPageId = '' } = {}) {
  const content = getThingsYouDidntKnowContent(contentId);
  if (!content?.videoPath) throw new Error('Reel chưa có video hợp lệ để lên lịch.');
  if (content.sourceStatus !== 'human-reviewed') throw Object.assign(new Error('Cần duyệt fact và nguồn trước khi lên lịch Reel.'), { statusCode: 409 });
  const selectedAdapter = adapter === 'meta' ? 'meta' : 'mock';
    const date = new Date(scheduledAt);
    const minimumLeadMs = selectedAdapter === 'meta' ? 15 * 60_000 : 60_000;
    if (!Number.isFinite(date.getTime()) || date.getTime() < Date.now() + minimumLeadMs) {
      throw new Error(selectedAdapter === 'meta'
        ? 'Lịch Live cần cách thời điểm hiện tại ít nhất 15 phút để Meta xử lý upload.'
        : 'Thời điểm đăng Mock phải nằm trong tương lai ít nhất một phút.');
    }
    const id = crypto.randomUUID();
    const stamp = now();
  db().prepare('INSERT INTO module_schedules(id,content_id,scheduled_at,status,facebook_state,adapter,target_page_id,created_at,updated_at) VALUES(?,?,?,\'scheduled\',?,?,?,?,?)')
    .run(id, contentId, date.toISOString(), selectedAdapter === 'mock' ? 'mock-scheduled' : 'local',
      selectedAdapter, targetPageId || null, stamp, stamp);
  logThingsYouDidntKnowActivity({ contentId, stage: 'schedule', code: 'TYDK_SCHEDULE_CREATED', message: `Đã tạo lịch đăng cho Reel ${contentId.slice(0, 8)}.` });
  return getThingsYouDidntKnowSchedule(id);
}
export function getThingsYouDidntKnowSchedule(id) {
  const row = db().prepare('SELECT * FROM module_schedules WHERE id=?').get(id);
  return row ? { id: row.id, contentId: row.content_id, scheduledAt: row.scheduled_at, status: row.status,
    facebookState: row.facebook_state, facebookVideoId: row.facebook_video_id, facebookError: row.facebook_error,
    targetPageId: row.target_page_id, adapter: row.adapter || 'mock', upload: parse(row.upload_json, {}),
    facebookCheckedAt: row.facebook_checked_at,
    createdAt: row.created_at, updatedAt: row.updated_at } : null;
}
export function listThingsYouDidntKnowSchedules() {
  return db().prepare('SELECT * FROM module_schedules ORDER BY scheduled_at').all().map((row) => ({
    id: row.id, contentId: row.content_id, scheduledAt: row.scheduled_at, status: row.status,
    facebookState: row.facebook_state, facebookVideoId: row.facebook_video_id, facebookError: row.facebook_error,
    targetPageId: row.target_page_id, adapter: row.adapter || 'mock', upload: parse(row.upload_json, {}),
    facebookCheckedAt: row.facebook_checked_at,
    createdAt: row.created_at, updatedAt: row.updated_at
  }));
}
export function updateThingsYouDidntKnowSchedule(id, patch = {}) {
    const columns = new Map([['status', 'status'], ['scheduledAt', 'scheduled_at'], ['facebookState', 'facebook_state'], ['facebookVideoId', 'facebook_video_id'], ['facebookError', 'facebook_error'],
    ['targetPageId', 'target_page_id'], ['adapter', 'adapter'], ['facebookCheckedAt', 'facebook_checked_at']]);
  const entries = [...columns].filter(([key]) => key in patch);
  if (!entries.length) return getThingsYouDidntKnowSchedule(id);
  const assignments = entries.map(([, column]) => column + '=?');
  const values = entries.map(([key]) => patch[key]);
  if ('upload' in patch) { assignments.push('upload_json=?'); values.push(JSON.stringify(patch.upload || {})); }
  db().prepare('UPDATE module_schedules SET ' + assignments.join(',') + ',updated_at=? WHERE id=?').run(...values, now(), id);
  return getThingsYouDidntKnowSchedule(id);
}
export function cancelThingsYouDidntKnowSchedule(id) {
  return updateThingsYouDidntKnowSchedule(id, { status: 'cancelled', facebookState: 'cancelled' });
}
export function getThingsYouDidntKnowDueSchedule() {
  const row = db().prepare("SELECT * FROM module_schedules WHERE status='scheduled' AND facebook_state='local' AND scheduled_at<=? ORDER BY scheduled_at LIMIT 1").get(now());
  return row ? { ...getThingsYouDidntKnowSchedule(row.id), content: getThingsYouDidntKnowContent(row.content_id) } : null;
}
export function getNextThingsYouDidntKnowUploadSchedule() {
  const earliest = new Date(Date.now() + 10 * 60_000).toISOString();
  const row = db().prepare("SELECT * FROM module_schedules WHERE status='scheduled' AND adapter='meta' AND facebook_state IN ('local','uploading','finishing') AND scheduled_at>? ORDER BY scheduled_at LIMIT 1").get(earliest);
  return row ? { ...getThingsYouDidntKnowSchedule(row.id), content: getThingsYouDidntKnowContent(row.content_id) } : null;
}
export function getNextThingsYouDidntKnowStatusCheck() {
  const stale = new Date(Date.now() - 60_000).toISOString();
  const row = db().prepare("SELECT * FROM module_schedules WHERE status='scheduled' AND adapter='meta' AND facebook_state='scheduled' AND scheduled_at<=? AND (facebook_checked_at IS NULL OR facebook_checked_at<?) ORDER BY scheduled_at LIMIT 1").get(now(), stale);
  return row ? { ...getThingsYouDidntKnowSchedule(row.id), content: getThingsYouDidntKnowContent(row.content_id) } : null;
}
export function claimThingsYouDidntKnowUploadSchedule(id) {
  const result = db().prepare("UPDATE module_schedules SET status='publishing',facebook_error=NULL,updated_at=? WHERE id=? AND status='scheduled' AND facebook_state IN ('local','uploading','finishing')").run(now(), id);
  return result.changes ? getThingsYouDidntKnowSchedule(id) : null;
}

export function getThingsYouDidntKnowDatabasePath() { db(); return DATABASE_PATH; }
export function closeThingsYouDidntKnowDatabase() { if (connection) { connection.close(); connection = null; } }
