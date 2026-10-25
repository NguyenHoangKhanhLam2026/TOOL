import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../config.mjs';
import {
  db, claimJob, finishJob, failJob, deferJob, recoverStaleJobs, log, getSettings,
  claimDueSchedule, markSchedule, queueJob, countFutureStock,
  updatePublishHistory, getScript, getFacebookSchedule, updateFacebookSchedule, completePublishedSchedule,
  queueFacebookSchedule, updateVideo, beginPublish, createRandomSchedule, archivePublishedVideo, cleanupArchivedPublishedVideoFiles,
  acquirePagePublishLock, releasePagePublishLock, getFacebookPageForLanguage, getFacebookPageProfile, facebookPageProfileMatchesLanguage
} from '../database/db.mjs';
import { createVideoJob } from '../pipeline/create-video.mjs';
import { renderStillPreviewVideo } from '../../packages/video-engine/render.mjs';
import { MetaGraphAdapter } from '../../packages/facebook-engine/meta-graph-adapter.mjs';
import { facebookPageHasSavedToken, verifyFacebookPageTarget } from '../facebook/page-profile-resolver.mjs';
import { MockFacebookAdapter } from '../../packages/facebook-engine/mock-adapter.mjs';
import { chatgptStatus } from '../ai/chatgpt-plan.mjs';
import { startOfLocalDay } from '../scheduler/time.mjs';
import { runEnglishShadowingFontTask } from '../english-shadowing/font-render-process.mjs';

const workerId = `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const heartbeatPath = path.join(PATHS.logs, 'worker-heartbeat.json');
let stopping = false;
let lastScheduleCheck = 0;

function facebookTargetFor(contentLanguage = 'en', schedule = null) {
  const profileId = schedule?.target_page_profile_id || schedule?.targetPageProfileId;
  if (profileId && !facebookPageProfileMatchesLanguage(profileId, contentLanguage)) return null;
  const profile = profileId ? getFacebookPageProfile(profileId) : getFacebookPageForLanguage(contentLanguage);
  if (!profile) return null;
  return { ...profile, pageId: schedule?.target_page_id || schedule?.targetPageId || profile.pageId };
}

function facebookProfileConfigured(profile, contentLanguage = 'en') {
  return Boolean(profile?.pageId && facebookPageProfileMatchesLanguage(profile.id, contentLanguage) && facebookPageHasSavedToken(profile.pageId, contentLanguage));
}

function pageLockKeyForJob(job) {
  if (job.type === 'schedule_facebook_video') {
    const schedule = db.prepare('SELECT * FROM scheduled_posts WHERE id=?').get(job.payload.scheduleId);
    const language = db.prepare('SELECT s.content_language FROM scripts s JOIN videos v ON v.script_id=s.id WHERE v.id=?').get(job.payload.videoId)?.content_language || 'en';
    return `meta:${facebookTargetFor(language, schedule)?.pageId || 'unconfigured'}`;
  }
  const language = db.prepare('SELECT s.content_language FROM scripts s JOIN videos v ON v.script_id=s.id WHERE v.id=?').get(job.payload.videoId)?.content_language || 'en';
  const schedule = job.payload.scheduleId ? db.prepare('SELECT * FROM scheduled_posts WHERE id=?').get(job.payload.scheduleId) : null;
  return `meta:${facebookTargetFor(language, schedule || job.payload)?.pageId || 'unconfigured'}`;
}

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
    if (settings.facebookAdapter === 'meta') {
      const contentLanguage = db.prepare('SELECT s.content_language FROM scripts s JOIN videos v ON v.script_id=s.id WHERE v.id=?').get(item.video_id)?.content_language || 'en';
      const profile = facebookTargetFor(contentLanguage, item);
      if (!facebookProfileConfigured(profile, contentLanguage)) {
        markSchedule(item.id, 'scheduled');
        const message = `Lịch ${item.id} đến giờ nhưng chưa có token đã lưu cho Page ${profile?.pageId || item.target_page_id || ''}.`;
        updateFacebookSchedule(item.id, { facebook_schedule_state: 'failed', facebook_error: message });
        log('WARN', 'FACEBOOK_DUE_PAGE_NOT_READY', message);
        break;
      }
      let postingProfile;
      try {
        const verified = await verifyFacebookPageTarget(profile, { contentLanguage });
        postingProfile = verified.profile;
        if (postingProfile.id !== profile.id) {
          updateFacebookSchedule(item.id, { target_page_profile_id: postingProfile.id, target_page_id: postingProfile.pageId });
          log('WARN', 'FACEBOOK_PAGE_TOKEN_FALLBACK', `Token của cấu hình ${profile.label} hết hạn; lịch ${item.id} chuyển sang cấu hình ${postingProfile.label} cùng Page ID ${profile.pageId}.`);
        }
      } catch (error) {
        markSchedule(item.id, 'scheduled');
        updateFacebookSchedule(item.id, { facebook_schedule_state: 'failed', facebook_error: error.message });
        log('WARN', 'FACEBOOK_DUE_PAGE_NOT_READY', `Lịch ${item.id} đến giờ nhưng chưa xác minh được token Page: ${error.message}`);
        break;
      }
      queueJob('publish_video', { videoId: item.video_id, scheduleId: item.id, targetPageProfileId: postingProfile.id, targetPageId: postingProfile.pageId });
      continue;
    }
    queueJob('publish_video', { videoId: item.video_id, scheduleId: item.id });
  }
}

function enqueueFacebookSchedules() {
  const settings = getSettings();
  if (!settings.autoPublishEnabled || settings.facebookAdapter !== 'meta') return;
  const due = db.prepare("SELECT p.id,p.video_id,p.target_page_profile_id,p.target_page_id,s.content_language FROM scheduled_posts p JOIN videos v ON v.id=p.video_id JOIN scripts s ON s.id=v.script_id WHERE p.status='scheduled' AND p.facebook_schedule_state='local' ORDER BY p.scheduled_at LIMIT 10").all();
  for (const schedule of due) {
    const profile = facebookTargetFor(schedule.content_language || 'en', schedule);
    if (!facebookProfileConfigured(profile, schedule.content_language || 'en')) continue;
    const item = queueFacebookSchedule(schedule.id);
    if (item) log('INFO', 'FACEBOOK_SCHEDULE_QUEUED', `Đã xếp upload video ${item.videoId} để gửi lịch đăng lên Facebook.`, item.jobId);
  }
}

function scheduleDueSlots() {
  const settings = getSettings();
  if (!settings.autoPublishEnabled) return;
  // A ready video can fill a Page/day gap while other videos are still rendering.
  const unscheduled = db.prepare("SELECT v.id,s.content_language FROM videos v JOIN scripts s ON s.id=v.script_id WHERE v.status='ready' AND v.review_status='approved' AND v.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM scheduled_posts p WHERE p.video_id=v.id) ORDER BY v.created_at ASC LIMIT 1").get();
  if (!unscheduled) return;
  try {
    const schedule = createRandomSchedule(unscheduled.id, settings.timezone, settings.postsPerDay);
    if (settings.facebookAdapter === 'meta') {
      const profile = facebookTargetFor(unscheduled.content_language || 'en', schedule);
      if (!facebookProfileConfigured(profile, unscheduled.content_language || 'en')) {
        log('WARN', 'FACEBOOK_SCHEDULE_PAGE_NOT_READY', `Chưa xác minh Page đích cho video ${unscheduled.id}; lịch vẫn được giữ trong tool.`);
      } else {
      const queued = queueFacebookSchedule(schedule.id);
      if (queued) log('INFO', 'FACEBOOK_SCHEDULE_QUEUED', `Đã xếp upload video ${unscheduled.id} để gửi lịch đăng lên Facebook.`, queued.jobId);
      }
    }
    log('INFO', 'POST_SCHEDULED', `Đã xếp video cuối thư viện ${unscheduled.id} vào lịch ${schedule.scheduledAt}.`);
  } catch (error) { log('WARN', 'AUTO_SCHEDULE_CONFLICT', error.message); }
}

async function scheduleFacebookVideo(job) {
  const scheduleId = job.payload.scheduleId;
  const schedule = getFacebookSchedule(scheduleId);
  if (!schedule) throw Object.assign(new Error('Không tìm thấy lịch cần gửi lên Facebook.'), { permanentMetaPermission: true });
  if (['scheduled', 'published'].includes(schedule.facebook_schedule_state)) return { alreadyScheduled: true };
  const settings = getSettings();
  if (settings.facebookAdapter !== 'meta' || (!settings.autoPublishEnabled && job.payload.manualRetry !== true)) {
    updateFacebookSchedule(scheduleId, { facebook_schedule_state: 'local' });
    return { inactive: true };
  }
  const video = db.prepare('SELECT * FROM videos WHERE id=?').get(schedule.video_id);
  if (!video) throw new Error('Video của lịch Facebook không còn tồn tại.');
  if (!video.video_path || !fs.existsSync(video.video_path)) throw new Error('Không tìm thấy tệp video để gửi lịch lên Facebook.');
  const script = getScript(video.script_id);
  if (!script) throw new Error('Không tìm thấy kịch bản của video cần gửi lên Facebook.');
  let profile = facebookTargetFor(script.contentLanguage || 'en', schedule);
  if (!facebookProfileConfigured(profile, script.contentLanguage || 'en')) throw Object.assign(new Error(`Facebook Page cho nội dung ${script.contentLanguage || 'en'} chưa có Page ID hoặc token đã lưu.`), { permanentMetaPermission: true });
  try {
    const verified = await verifyFacebookPageTarget(profile, { contentLanguage: script.contentLanguage || 'en' });
    profile = verified.profile;
    if (verified.usedFallback) {
      log('WARN', 'FACEBOOK_PAGE_TOKEN_FALLBACK', `Token của cấu hình ${schedule.target_page_profile_id || 'Page EN'} hết hạn; lịch ${schedule.id} chuyển sang cấu hình ${profile.label} cùng Page ID ${profile.pageId}.`, job.id);
    }
  } catch (error) {
    if (Number(error.code) === 190) error.permanentMetaPermission = true;
    throw error;
  }
  if (schedule.target_page_profile_id !== profile.id || schedule.target_page_id !== profile.pageId) {
    updateFacebookSchedule(scheduleId, { target_page_profile_id: profile.id, target_page_id: profile.pageId });
  }
  const adapter = new MetaGraphAdapter(profile.pageId, { tokenFile: profile.tokenFile });
  try {
    const result = await adapter.schedule({
      video, script, scheduledAt: schedule.scheduled_at, uploadSession: schedule,
      onUploadSession: (patch) => updateFacebookSchedule(scheduleId, patch),
      onFinishing: (patch) => updateFacebookSchedule(scheduleId, patch)
    });
    if (!result.verified) throw new Error('Meta chưa xác nhận lịch đăng video.');
    updateFacebookSchedule(scheduleId, {
      facebook_schedule_state: 'scheduled', facebook_video_id: result.facebookId,
      facebook_upload_session_id: null, facebook_upload_offset: null, facebook_upload_end_offset: null,
      facebook_error: null
    });
    log('INFO', 'FACEBOOK_SCHEDULED', `Facebook đã nhận video ${result.facebookId} đăng lúc ${schedule.scheduled_at}.`, job.id);
    return { facebookVideoId: result.facebookId, scheduledAt: schedule.scheduled_at };
  } catch (error) {
    if (/(#200).*pages_manage_posts permission/i.test(String(error.message || ''))) {
      error.permanentMetaPermission = true;
      error.message = 'Meta từ chối quyền pages_manage_posts. Tạo Page Access Token có quyền đăng bài, lưu token mới, kiểm tra Page EN rồi nhấn Đăng lại.';
    }
    throw error;
  }
}

async function syncCompletedFacebookSchedules() {
  const settings = getSettings();
  if (settings.facebookAdapter !== 'meta') return;
  const due = db.prepare("SELECT * FROM scheduled_posts WHERE status='scheduled' AND ((facebook_schedule_state='scheduled' AND scheduled_at<=?) OR facebook_schedule_state='uncertain') ORDER BY scheduled_at LIMIT 5")
    .all(new Date().toISOString());
  if (!due.length) return;
  for (const schedule of due) {
    if (!schedule.facebook_video_id) continue;
    const scriptRow = db.prepare('SELECT s.content_language FROM scripts s JOIN videos v ON v.script_id=s.id WHERE v.id=?').get(schedule.video_id);
    let profile = facebookTargetFor(scriptRow?.content_language || 'en', schedule);
    if (!facebookProfileConfigured(profile, scriptRow?.content_language || 'en')) {
      const message = `Facebook Page của lịch ${schedule.target_page_id || profile?.pageId || ''} chưa có token đã lưu.`;
      const shouldLog = schedule.facebook_schedule_state !== 'uncertain' || schedule.facebook_error !== message;
      updateFacebookSchedule(schedule.id, { facebook_schedule_state: 'uncertain', facebook_error: message });
      if (shouldLog) log('WARN', 'FACEBOOK_SCHEDULE_STATUS_CHECK_FAILED', `Không xác minh được video ${schedule.facebook_video_id}: ${message}`);
      continue;
    }
    try {
      const verified = await verifyFacebookPageTarget(profile, { contentLanguage: scriptRow?.content_language || 'en' });
      profile = verified.profile;
      if (schedule.target_page_profile_id !== profile.id || schedule.target_page_id !== profile.pageId) {
        updateFacebookSchedule(schedule.id, { target_page_profile_id: profile.id, target_page_id: profile.pageId });
      }
      const adapter = new MetaGraphAdapter(profile.pageId, { tokenFile: profile.tokenFile });
      const remote = await adapter.getVideoStatus(schedule.facebook_video_id);
      const remoteStatus = String(remote.status?.video_status || remote.status?.publishing_phase?.status || '').toLowerCase();
      const remoteScheduledAt = Number(remote.scheduled_publish_time);
      if (schedule.facebook_schedule_state === 'uncertain' && remote.published === false && Number.isFinite(remoteScheduledAt) && Math.abs(remoteScheduledAt * 1000 - new Date(schedule.scheduled_at).getTime()) < 60_000) {
        updateFacebookSchedule(schedule.id, { facebook_schedule_state: 'scheduled', facebook_error: null });
        log('INFO', 'FACEBOOK_SCHEDULE_CONFIRMED', `Facebook Planner ya confirma la publicación ${schedule.facebook_video_id}.`);
        if (new Date(schedule.scheduled_at) > new Date()) continue;
      }
      if (remote.published === true || remoteStatus === 'published') {
        const publishedAt = new Date().toISOString();
        const completed = completePublishedSchedule(schedule.id, {
          facebookId: schedule.facebook_video_id, url: remote.permalink_url || null, publishedAt, adapter: 'meta'
        });
        if (completed) archivePublishedVideo(schedule.video_id);
        if (completed) log('INFO', 'FACEBOOK_SCHEDULE_PUBLISHED', `Facebook đã đăng video ${schedule.facebook_video_id}; nội dung và thời điểm đã được chuyển vào lịch sử.`);
      } else if (['error', 'failed'].includes(remoteStatus)) {
        const message = `Facebook báo video đã lên lịch bị lỗi (${remoteStatus}).`;
        db.exec('BEGIN IMMEDIATE');
        try {
          updateFacebookSchedule(schedule.id, { status: 'failed', facebook_schedule_state: 'failed', facebook_error: message });
          updateVideo(schedule.video_id, { status: 'publish_failed', last_error: message });
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        log('ERROR', 'FACEBOOK_SCHEDULE_FAILED', message);
      }
    } catch (error) {
      const rawMessage = String(error?.message || error);
      const tokenExpired = /error validating access token|session has expired|oauth exception.*\b190\b/i.test(rawMessage);
      const message = tokenExpired
        ? 'Facebook Page Access Token \u0111\u00e3 h\u1ebft h\u1ea1n ho\u1eb7c kh\u00f4ng c\u00f2n h\u1ee3p l\u1ec7. L\u00e0m m\u1edbi token trong K\u1ebft n\u1ed1i & c\u00e0i \u0111\u1eb7t \u0111\u1ec3 x\u00e1c minh b\u00e0i \u0111\u00e3 \u0111\u0103ng.'
        : rawMessage.slice(0, 900);
      const shouldLog = schedule.facebook_schedule_state !== 'uncertain' || schedule.facebook_error !== message;
      updateFacebookSchedule(schedule.id, { facebook_schedule_state: 'uncertain', facebook_error: message });
      if (shouldLog) log('WARN', 'FACEBOOK_SCHEDULE_STATUS_CHECK_FAILED', `Ch\u01b0a x\u00e1c minh \u0111\u01b0\u1ee3c video ${schedule.facebook_video_id}: ${message}`);
    }
  }
}

async function publishVideo(job) {
  const { videoId, scheduleId } = job.payload;
  const video = db.prepare('SELECT * FROM videos WHERE id=?').get(videoId);
  if (!video) throw new Error('Không tìm thấy video cần đăng.');
  if (video.status === 'published') {
    const savedSchedule = scheduleId || db.prepare("SELECT id FROM scheduled_posts WHERE video_id=? AND status IN ('scheduled','publishing','published')").get(videoId)?.id;
    if (savedSchedule) {
      completePublishedSchedule(savedSchedule, { facebookId: video.published_id, url: video.published_url, adapter: getSettings().facebookAdapter, publishedAt: video.updated_at });
      if (getSettings().facebookAdapter === 'meta') archivePublishedVideo(videoId);
    }
    return;
  }
  if (!video.video_path || !fs.existsSync(video.video_path)) throw new Error('Video sẵn sàng không còn trên ổ đĩa.');
  const settings = getSettings();
  const script = getScript(video.script_id);
  const schedule = scheduleId ? db.prepare('SELECT * FROM scheduled_posts WHERE id=?').get(scheduleId) : null;
  let profile = settings.facebookAdapter === 'meta' ? facebookTargetFor(script?.contentLanguage || 'en', schedule || job.payload) : null;
  const contentLanguage = script?.contentLanguage || 'en';
  const pageConfigured = settings.facebookAdapter === 'meta' && facebookProfileConfigured(profile, contentLanguage);
  const oneShotLiveAllowed = pageConfigured && job.payload.confirmLive === true;
  if (!settings.autoPublishEnabled && settings.facebookAdapter !== 'mock' && !oneShotLiveAllowed) throw new Error('Đăng live đang tắt; lịch được giữ nguyên.');
  const adapterName = settings.facebookAdapter === 'meta' ? 'meta' : 'mock';
  if (adapterName === 'meta' && !pageConfigured) throw Object.assign(new Error(`Facebook Page cho nội dung ${script?.contentLanguage || 'en'} chưa có Page ID.`), { permanentMetaPermission: true });
  const gate = beginPublish(videoId, adapterName);
  if (gate.alreadyPublished) {
    const facebookId = gate.record.facebook_id || gate.record.published_id;
    const url = gate.record.url || gate.record.published_url;
    const savedSchedule = scheduleId || db.prepare("SELECT id FROM scheduled_posts WHERE video_id=? AND status IN ('scheduled','publishing','published')").get(videoId)?.id;
    if (savedSchedule) completePublishedSchedule(savedSchedule, { facebookId, url, adapter: adapterName, publishedAt: video.updated_at });
    else updateVideo(videoId, { status: 'published', published_id: facebookId, published_url: url });
    if (adapterName === 'meta') archivePublishedVideo(videoId);
    return;
  }
  if (gate.inProgress) throw new Error(`Video đang hoặc đã từng trong luồng đăng (${gate.record.status}); không tạo lượt upload mới.`);
  const historyId = gate.historyId;
  try {
    let adapter;
    if (adapterName === 'meta') {
      const originalProfile = profile;
      try {
        const verified = await verifyFacebookPageTarget(profile, { contentLanguage });
        profile = verified.profile;
        if (schedule && (schedule.target_page_profile_id !== profile.id || schedule.target_page_id !== profile.pageId)) {
          updateFacebookSchedule(schedule.id, { target_page_profile_id: profile.id, target_page_id: profile.pageId });
        }
        if (verified.usedFallback) {
          log('WARN', 'FACEBOOK_PAGE_TOKEN_FALLBACK', `Token của cấu hình ${originalProfile.label} hết hạn; video ${videoId} chuyển sang cấu hình ${profile.label} đã xác minh cho cùng Page ID ${profile.pageId}.`, job.id);
        }
      } catch (error) {
        if (Number(error.code) === 190 || error.permanentMetaPermission) error.permanentMetaPermission = true;
        throw error;
      }
      adapter = new MetaGraphAdapter(profile.pageId, { tokenFile: profile.tokenFile });
    } else adapter = new MockFacebookAdapter();
    const result = await adapter.publish({ video, script });
    if (!result.verified) throw new Error('Chưa xác minh được trạng thái đăng.');
    const savedSchedule = scheduleId || db.prepare("SELECT id FROM scheduled_posts WHERE video_id=? AND status IN ('scheduled','publishing')").get(videoId)?.id;
    const publishedAt = new Date().toISOString();
    if (savedSchedule) {
      completePublishedSchedule(savedSchedule, { facebookId: result.facebookId, url: result.url || null, adapter: adapterName, publishHistoryId: historyId, publishedAt });
    } else {
      updatePublishHistory(historyId, { status: 'published', facebook_id: result.facebookId, url: result.url || null, error: null });
      updateVideo(videoId, { status: 'published', published_id: result.facebookId, published_url: result.url || null, last_error: null });
    }
    log('INFO', 'PUBLISH_VERIFIED', `Đã xác minh video bài đăng Facebook ${result.facebookId} qua ${adapterName}.`, job.id);
    if (adapterName === 'meta' && archivePublishedVideo(videoId)) log('INFO', 'VIDEO_ARCHIVED', `Đã ẩn video ${videoId} khỏi thư viện sau khi đăng Facebook thành công.`, job.id);
  } catch (error) {
    const expiredPageToken = adapterName === 'meta' && Number(error.code) === 190;
    const definitePagePermissionFailure = adapterName === 'meta' && /\(#200\).*pages_manage_posts permission/i.test(String(error.message || ''));
    if (expiredPageToken) error.permanentMetaPermission = true;
    if (definitePagePermissionFailure) {
      error.permanentMetaPermission = true;
      error.message = 'Meta từ chối quyền pages_manage_posts. Tạo Page Access Token có quyền đăng bài, lưu token mới, kiểm tra Page EN rồi nhấn Đăng lại.';
    }
    updatePublishHistory(historyId, { status: adapterName === 'meta' && !definitePagePermissionFailure && !expiredPageToken ? 'uncertain' : 'failed', error: String(error.message).slice(0, 1000) });
    if (scheduleId) markSchedule(scheduleId, 'failed');
    updateVideo(videoId, { status: 'publish_failed', last_error: error.message });
    log('ERROR', 'PUBLISH_FAILED', error.message, job.id);
    throw error;
  }
}

async function processJob(job) {
  if (job.type === 'create_video') return createVideoJob(job);
  if (job.type === 'create_english_shadowing_video') return runEnglishShadowingFontTask('video-job', job);
  if (job.type === 'render_preview') {
    const { previewId, imagePath, videoPath, seconds } = job.payload;
    const result = await renderStillPreviewVideo(imagePath, videoPath, seconds, {
      onProgress: (progress) => log('INFO', 'RENDER_PROGRESS', JSON.stringify({ previewId, progress }), job.id)
    });
    return { ...result, previewId };
  }
  if (job.type === 'publish_video') {
    const settings = getSettings();
    const pageKey = settings.facebookAdapter === 'meta' ? pageLockKeyForJob(job) : 'mock:page';
    if (!acquirePagePublishLock(pageKey, job.id, job.payload.videoId)) {
      deferJob(job.id);
      return { deferred: true };
    }
    try { return await publishVideo(job); }
    finally { releasePagePublishLock(pageKey, job.id); }
  }
  if (job.type === 'schedule_facebook_video') {
    const pageKey = pageLockKeyForJob(job);
    if (!acquirePagePublishLock(pageKey, job.id, job.payload.videoId)) {
      deferJob(job.id);
      return { deferred: true };
    }
    try { return await scheduleFacebookVideo(job); }
    finally { releasePagePublishLock(pageKey, job.id); }
  }
  throw new Error(`Loại job không hỗ trợ: ${job.type}`);
}

async function tick() {
  if (Date.now() - lastScheduleCheck > 30_000) {
    lastScheduleCheck = Date.now();
    cleanupArchivedPublishedVideoFiles();
    await ensureAutoQueue();
    scheduleDueSlots();
    enqueueFacebookSchedules();
    await enqueueDuePosts();
    await syncCompletedFacebookSchedules();
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
