import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../config.mjs';
import {
  db, claimJob, finishJob, failJob, deferJob, recoverStaleJobs, log, getSettings,
  claimDueSchedule, markSchedule, queueJob, countFutureStock,
  updatePublishHistory, getScript, updateVideo, beginPublish, createRandomSchedule, archivePublishedVideo,
  acquirePagePublishLock, releasePagePublishLock
} from '../database/db.mjs';
import { createVideoJob } from '../pipeline/create-video.mjs';
import { renderStillPreviewVideo } from '../../packages/video-engine/render.mjs';
import { MetaGraphAdapter } from '../../packages/facebook-engine/meta-graph-adapter.mjs';
import { MockFacebookAdapter } from '../../packages/facebook-engine/mock-adapter.mjs';
import { chatgptStatus } from '../ai/chatgpt-plan.mjs';
import { startOfLocalDay } from '../scheduler/time.mjs';

const workerId = `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const heartbeatPath = path.join(PATHS.logs, 'worker-heartbeat.json');
let stopping = false;
let lastScheduleCheck = 0;

async function ensureAutoQueue() {
  const settings = getSettings();
  if (!settings.autoGenerationEnabled) return;
  if (!chatgptStatus().connected) return;
  const target = Math.max(1, Number(settings.postsPerDay) * Number(settings.prepareAheadDays));
  const dayStart = startOfLocalDay(new Date(), settings.timezone).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const queued = Number(db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE type='create_video' AND status IN ('pending','running')").get().count);
    const today = Number(db.prepare('SELECT COUNT(*) AS count FROM scripts WHERE created_at>=?').get(dayStart).count);
    const remainingToday = Math.max(0, Number(settings.maxScriptsPerDay) - today - queued);
    const deficit = Math.min(2, remainingToday, Math.max(0, target - countFutureStock() - queued));
    for (let i = 0; i < deficit; i++) queueJob('create_video', { autoSchedule: true });
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

async function enqueueDuePosts() {
  const settings = getSettings();
  if (!settings.autoPublishEnabled) return;
  while (true) {
    const item = claimDueSchedule();
    if (!item) break;
    queueJob('publish_video', { videoId: item.video_id, scheduleId: item.id });
  }
}

function scheduleDueSlots() {
  const settings = getSettings();
  if (!settings.autoPublishEnabled) return;
  const queuedJobs = Number(db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE type='create_video' AND status IN ('pending','running')").get().count);
  if (queuedJobs) return;
  const unscheduled = db.prepare("SELECT v.id FROM videos v WHERE v.status='ready' AND v.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM scheduled_posts p WHERE p.video_id=v.id) ORDER BY v.created_at ASC LIMIT 1").get();
  if (!unscheduled) return;
  try {
    const schedule = createRandomSchedule(unscheduled.id, settings.timezone, settings.postsPerDay);
    log('INFO', 'POST_SCHEDULED', `Đã xếp video cuối thư viện ${unscheduled.id} vào lịch ${schedule.scheduledAt}.`);
  } catch (error) { log('WARN', 'AUTO_SCHEDULE_CONFLICT', error.message); }
}

async function publishVideo(job) {
  const { videoId, scheduleId } = job.payload;
  const video = db.prepare('SELECT * FROM videos WHERE id=?').get(videoId);
  if (!video) throw new Error('Không tìm thấy video cần đăng.');
  if (video.status === 'published') { if (scheduleId) markSchedule(scheduleId, 'published'); return; }
  if (!video.video_path || !fs.existsSync(video.video_path)) throw new Error('Video sẵn sàng không còn trên ổ đĩa.');
  const settings = getSettings();
  const oneShotLiveAllowed = settings.facebookAdapter === 'meta' && job.payload.confirmLive === true && settings.facebookConnectionVerified;
  if (!settings.autoPublishEnabled && settings.facebookAdapter !== 'mock' && !oneShotLiveAllowed) throw new Error('Đăng live đang tắt; lịch được giữ nguyên.');
  const adapterName = settings.facebookAdapter === 'meta' ? 'meta' : 'mock';
  const script = getScript(video.script_id);
  const adapter = adapterName === 'meta' ? new MetaGraphAdapter(settings.pageId) : new MockFacebookAdapter();
  const gate = beginPublish(videoId, adapterName);
  if (gate.alreadyPublished) {
    updateVideo(videoId, { status: 'published', published_id: gate.record.facebook_id || gate.record.published_id, published_url: gate.record.url || gate.record.published_url });
    if (adapterName === 'meta') archivePublishedVideo(videoId);
    const savedSchedule = scheduleId || db.prepare("SELECT id FROM scheduled_posts WHERE video_id=? AND status IN ('scheduled','publishing')").get(videoId)?.id;
    if (savedSchedule) markSchedule(savedSchedule, 'published');
    return;
  }
  if (gate.inProgress) throw new Error(`Video đang hoặc đã từng trong luồng đăng (${gate.record.status}); không tạo lượt upload mới.`);
  const historyId = gate.historyId;
  try {
    const result = await adapter.publish({ video, script });
    if (!result.verified) throw new Error('Chưa xác minh được trạng thái đăng.');
    updatePublishHistory(historyId, { status: 'published', facebook_id: result.facebookId, url: result.url || null, error: null });
    updateVideo(videoId, { status: 'published', published_id: result.facebookId, published_url: result.url || null, last_error: null });
    const savedSchedule = scheduleId || db.prepare("SELECT id FROM scheduled_posts WHERE video_id=? AND status IN ('scheduled','publishing')").get(videoId)?.id;
    if (savedSchedule) markSchedule(savedSchedule, 'published');
    log('INFO', 'PUBLISH_VERIFIED', `Đã xác minh video bài đăng Facebook ${result.facebookId} qua ${adapterName}.`, job.id);
    if (adapterName === 'meta' && archivePublishedVideo(videoId)) log('INFO', 'VIDEO_ARCHIVED', `Đã ẩn video ${videoId} khỏi thư viện sau khi đăng Facebook thành công.`, job.id);
  } catch (error) {
    const definitePagePermissionFailure = adapterName === 'meta' && /\(#200\).*pages_manage_posts permission/i.test(String(error.message || ''));
    updatePublishHistory(historyId, { status: adapterName === 'meta' && !definitePagePermissionFailure ? 'uncertain' : 'failed', error: String(error.message).slice(0, 1000) });
    if (scheduleId) markSchedule(scheduleId, 'failed');
    updateVideo(videoId, { status: 'publish_failed', last_error: error.message });
    log('ERROR', 'PUBLISH_FAILED', error.message, job.id);
    if (definitePagePermissionFailure) error.permanentMetaPermission = true;
    throw error;
  }
}

async function processJob(job) {
  if (job.type === 'create_video') return createVideoJob(job);
  if (job.type === 'render_preview') {
    const { previewId, imagePath, videoPath, seconds } = job.payload;
    const result = await renderStillPreviewVideo(imagePath, videoPath, seconds, {
      onProgress: (progress) => log('INFO', 'RENDER_PROGRESS', JSON.stringify({ previewId, progress }), job.id)
    });
    return { ...result, previewId };
  }
  if (job.type === 'publish_video') {
    const settings = getSettings();
    const pageKey = settings.facebookAdapter === 'meta' ? `meta:${settings.pageId}` : 'mock:page';
    if (!acquirePagePublishLock(pageKey, job.id, job.payload.videoId)) {
      deferJob(job.id);
      return { deferred: true };
    }
    try { return await publishVideo(job); }
    finally { releasePagePublishLock(pageKey, job.id); }
  }
  throw new Error(`Loại job không hỗ trợ: ${job.type}`);
}

async function tick() {
  if (Date.now() - lastScheduleCheck > 30_000) {
    lastScheduleCheck = Date.now();
    await ensureAutoQueue();
    scheduleDueSlots();
    await enqueueDuePosts();
  }
  const job = claimJob(workerId);
  if (!job) return;
  log('INFO', 'JOB_STARTED', `Bắt đầu ${job.type}.`, job.id);
  try {
    const result = await processJob(job);
    if (result?.deferred) return;
    finishJob(job.id); log('INFO', 'JOB_COMPLETED', `Hoàn tất ${job.type}.`, job.id);
  }
  catch (error) {
    failJob(job, error);
  }
}

async function main() {
  const recovered = recoverStaleJobs();
  if (recovered) log('WARN', 'JOBS_RECOVERED', `Đã khôi phục ${recovered} job bị gián đoạn.`);
  log('INFO', 'WORKER_STARTED', `Worker ${workerId} đã sẵn sàng.`);
  const writeHeartbeat = () => fs.writeFileSync(heartbeatPath, JSON.stringify({ workerId, lastSeen: new Date().toISOString() }), 'utf8');
  writeHeartbeat();
  const heartbeatTimer = setInterval(writeHeartbeat, 5_000);
  heartbeatTimer.unref();
  while (!stopping) {
    try { await tick(); } catch (error) { log('ERROR', 'WORKER_TICK_FAILED', error.message); }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  clearInterval(heartbeatTimer);
  db.close();
}

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
main().catch((error) => { console.error(error); process.exitCode = 1; });
