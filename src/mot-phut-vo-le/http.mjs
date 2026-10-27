import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA, PORT } from '../config.mjs';
import {
  getMotPhutVoLeContent, getMotPhutVoLeJob, listMotPhutVoLeJobs, queueMotPhutVoLeJob,
  requestMotPhutVoLeJobCancellation, listMotPhutVoLeSchedules, deleteMotPhutVoLeVideo
} from './history.mjs';
import { saveMotPhutVoLeCaption } from './create-video.mjs';
import { listMotPhutVoLeVideos, listMotPhutVoLeTopics } from './catalog.mjs';
import {
  saveMotPhutVoLeVisualDesign, saveMotPhutVoLeVisualPreset, resetMotPhutVoLeVisualDesign,
  getMotPhutVoLeVisualDesign, getMotPhutVoLeVisualDesignDefaults, listMotPhutVoLeVisualPresets
} from './visual-design-store.mjs';
import { MOT_PHUT_VO_LE_VOICES, getMotPhutVoLeTtsStatus, createMotPhutVoLeVoicePreview } from './vie-tts.mjs';
import { buildMotPhutVoLeVisualPreviewSvg, MOT_PHUT_VO_LE_BACKGROUND_EFFECTS } from './renderer.mjs';
import { renderMotPhutVoLeThumbnailSvg } from './thumbnail-font-renderer.mjs';
import { MOT_PHUT_VO_LE_SUGGESTED_AREAS } from './topic-catalog.mjs';
import { getMotPhutVoLeSettings, saveMotPhutVoLeSettings, resetMotPhutVoLeSettings,
  saveMotPhutVoLeFacebookPage, motPhutVoLeFacebookTokenSaved } from './settings-store.mjs';
import { ensureMotPhutVoLeWorker } from './worker-process.mjs';
import { createMotPhutVoLeManualSchedule, deleteMotPhutVoLeScheduleFromApp, motPhutVoLeScheduleStatus } from './scheduler.mjs';
import { verifyMotPhutVoLeFacebookPage } from './facebook-publisher.mjs';
import { buildHighlightIntervals, mapWordBoundariesToTokens } from '../../packages/audio-highlight/highlight-engine.mjs';
import { logMotPhutVoLeActivity } from './activity-log.mjs';

const previewFiles = new Map();
const activeContentStreams = new Map();
const deletingContentIds = new Set();
const MODULE_OUTPUT_DIR = path.resolve(DATA, 'outputs', 'mot-phut-vo-le');
const MODULE_DATA_DIR = path.resolve(DATA, 'mot-phut-vo-le');

export async function handleMotPhutVoLeApi(req, res, url) {
  if (!url.pathname.startsWith('/api/mot-phut-vo-le/')) return false;
  if (req.method !== 'GET' && !sameOrigin(req)) return sendJson(res, 403, { error: 'Yêu cầu không cùng nguồn.' });
  const route = url.pathname.slice('/api/mot-phut-vo-le'.length);
  try {
    if (req.method === 'GET' && route === '/status') {
      const { chatgptStatus } = await import('../ai/chatgpt-plan.mjs');
      await ensureMotPhutVoLeWorker();
      const settings = getMotPhutVoLeSettings();
      return sendJson(res, 200, { module: 'mot-phut-vo-le', contentType: 'mot-phut-vo-le', jobType: 'create_mot_phut_vo_le_video',
        chatgpt: chatgptStatus(), vieneu: getMotPhutVoLeTtsStatus(), voices: MOT_PHUT_VO_LE_VOICES,
        settings, facebookPage: { pageId: settings.facebookPageId, pageName: settings.facebookPageName,
          verified: settings.facebookPageVerified, tokenSaved: motPhutVoLeFacebookTokenSaved() },
        design: getMotPhutVoLeVisualDesign(), presets: listMotPhutVoLeVisualPresets(), backgroundEffects: MOT_PHUT_VO_LE_BACKGROUND_EFFECTS,
        suggestedAreas: MOT_PHUT_VO_LE_SUGGESTED_AREAS });
    }
    if (req.method === 'PUT' && route === '/settings') {
      const settings = saveMotPhutVoLeSettings(await readJson(req));
      await ensureMotPhutVoLeWorker();
      return sendJson(res, 200, { settings });
    }
    if (req.method === 'POST' && route === '/settings/reset') return sendJson(res, 200, { settings: resetMotPhutVoLeSettings() });
    if (req.method === 'PUT' && route === '/facebook-page') {
      const body = await readJson(req);
      const settings = saveMotPhutVoLeFacebookPage({ pageId: body.pageId, accessToken: body.accessToken });
      return sendJson(res, 200, { page: { pageId: settings.facebookPageId, pageName: settings.facebookPageName,
        verified: settings.facebookPageVerified, tokenSaved: motPhutVoLeFacebookTokenSaved() } });
    }
    if (req.method === 'POST' && route === '/facebook-page/verify') {
      const pageId = getMotPhutVoLeSettings().facebookPageId;
      const page = await verifyMotPhutVoLeFacebookPage(pageId);
      return sendJson(res, 200, { page: { ...page, tokenSaved: motPhutVoLeFacebookTokenSaved() } });
    }
    if (req.method === 'GET' && route === '/schedules') {
      await ensureMotPhutVoLeWorker();
      return sendJson(res, 200, { schedules: listMotPhutVoLeSchedules(), scheduler: motPhutVoLeScheduleStatus() });
    }
    const scheduleCreate = route.match(/^\/videos\/([a-f\d-]+)\/schedule$/iu);
    if (req.method === 'POST' && scheduleCreate) {
      const body = await readJson(req);
      const schedule = createMotPhutVoLeManualSchedule(scheduleCreate[1], body.scheduledAt);
      logMotPhutVoLeActivity('INFO', 'MOT_PHUT_VO_LE_SCHEDULE_CREATED',
        'Đã thêm lịch đăng MPVL cho video ' + scheduleCreate[1].slice(0, 8) + ' vào ' + schedule.scheduledAt + '.');
      await ensureMotPhutVoLeWorker();
      return sendJson(res, 201, { schedule });
    }
    const scheduleDelete = route.match(/^\/schedules\/([a-f\d-]+)$/iu);
    if (req.method === 'DELETE' && scheduleDelete) {
      const schedule = deleteMotPhutVoLeScheduleFromApp(scheduleDelete[1]);
      if (schedule) logMotPhutVoLeActivity('INFO', 'MOT_PHUT_VO_LE_SCHEDULE_DELETED',
        'Đã xóa lịch đăng MPVL cho video ' + schedule.contentId.slice(0, 8) + '.');
      return schedule ? sendJson(res, 200, { deleted: true, schedule }) : sendJson(res, 404, { error: 'Không tìm thấy lịch MPVL.' });
    }
    if (req.method === 'GET' && route === '/visual-design/defaults') return sendJson(res, 200, { design: getMotPhutVoLeVisualDesignDefaults() });
    if (req.method === 'GET' && route === '/visual-design') return sendJson(res, 200, { design: getMotPhutVoLeVisualDesign() });
    if (req.method === 'GET' && route === '/visual-design/presets') return sendJson(res, 200, { presets: listMotPhutVoLeVisualPresets() });
    if (req.method === 'PUT' && route === '/visual-design') return sendJson(res, 200, { design: saveMotPhutVoLeVisualDesign(await readJson(req)) });
    if (req.method === 'POST' && route === '/visual-design/reset') return sendJson(res, 200, { design: resetMotPhutVoLeVisualDesign() });
    if (req.method === 'POST' && route === '/visual-design/presets') {
      const body = await readJson(req);
      return sendJson(res, 201, { preset: saveMotPhutVoLeVisualPreset(body.name, body.design) });
    }
    if (req.method === 'GET' && route === '/visual-preview.svg') {
      const content = { title: url.searchParams.get('title') || 'Vì sao ta hay ngáp?', scriptText: url.searchParams.get('text') || 'Một câu chuyện nhỏ về cách bộ não phản ứng với người xung quanh.' };
      const svg = await buildMotPhutVoLeVisualPreviewSvg({ content, design: getMotPhutVoLeVisualDesign(), backgroundEffect: getMotPhutVoLeSettings(), mode: url.searchParams.get('mode') || 'content' });
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' });
      res.end(svg);
      return true;
    }
    if (req.method === 'POST' && route === '/visual-preview.svg') {
      const body = await readJson(req);
      const svg = await buildPreviewSvg(body);
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' });
      res.end(svg);
      return true;
    }
    if (req.method === 'POST' && route === '/visual-preview.png') {
      const body = await readJson(req);
      const svg = await buildPreviewSvg(body);
      const png = await renderMotPhutVoLeThumbnailSvg(svg);
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length, 'cache-control': 'no-store' });
      res.end(png);
      return true;
    }
    if (req.method === 'GET' && route === '/videos') return sendJson(res, 200, { videos: listMotPhutVoLeVideos({ query: url.searchParams.get('q') || '', category: url.searchParams.get('category') || '', limit: url.searchParams.get('limit') || 200 }) });
    const videoDelete = route.match(/^\/videos\/([a-f\d-]+)$/iu);
    if (req.method === 'DELETE' && videoDelete) {
      const id = videoDelete[1];
      if (deletingContentIds.has(id)) return sendJson(res, 409, { error: 'Video MPVL này đang được xóa.' });
      deletingContentIds.add(id);
      try {
        await closeActiveContentStreams(id);
        const result = deleteMotPhutVoLeVideo(id);
        return result ? sendJson(res, 200, result) : sendJson(res, 404, { error: 'Không tìm thấy nội dung MPVL cần xóa.' });
      } finally {
        deletingContentIds.delete(id);
      }
    }
    if (req.method === 'GET' && route === '/history') return sendJson(res, 200, { history: listMotPhutVoLeTopics({ query: url.searchParams.get('q') || '', category: url.searchParams.get('category') || '', limit: url.searchParams.get('limit') || 200 }) });
    if (req.method === 'GET' && route === '/jobs') {
      const jobs = listMotPhutVoLeJobs();
      if (jobs.some((job) => job.status === 'pending')) await ensureMotPhutVoLeWorker();
      return sendJson(res, 200, { jobs });
    }
    if (req.method === 'GET' && route.startsWith('/jobs/')) {
      const job = getMotPhutVoLeJob(route.slice('/jobs/'.length));
      return job ? sendJson(res, 200, { job }) : sendJson(res, 404, { error: 'Không tìm thấy job.' });
    }
    if (req.method === 'POST' && route === '/jobs') {
      const body = await readJson(req);
      if (body.action !== 'create') return sendJson(res, 400, { error: 'Action tạo job không hợp lệ.' });
      const count = Math.max(1, Math.min(5, Number(body.count) || 1));
      await ensureMotPhutVoLeWorker();
      const job = queueMotPhutVoLeJob('create', { topic: String(body.topic || '').slice(0, 240), category: String(body.category || '').slice(0, 120),
        count, settings: body.settings || {}, design: getMotPhutVoLeVisualDesign() });
      logMotPhutVoLeActivity('INFO', 'MOT_PHUT_VO_LE_JOB_QUEUED',
        'Đã xếp hàng tạo ' + count + ' video MPVL' + (body.category ? ' trong lĩnh vực “' + String(body.category).slice(0, 120) + '”' : '')
          + (body.topic ? '; chủ đề gợi ý “' + String(body.topic).slice(0, 180) + '”' : '; AI sẽ chọn chủ đề'), job.id);
      return sendJson(res, 202, { job });
    }
    const cancel = route.match(/^\/jobs\/([a-f\d-]+)\/cancel$/iu);
    if (req.method === 'POST' && cancel) {
      const job = requestMotPhutVoLeJobCancellation(cancel[1]);
      if (job) logMotPhutVoLeActivity('WARN', 'MOT_PHUT_VO_LE_JOB_CANCELLATION_REQUESTED',
        'Đã nhận yêu cầu hủy job MPVL; worker sẽ dừng tại bước an toàn tiếp theo.', job.id);
      return job ? sendJson(res, 202, { job }) : sendJson(res, 404, { error: 'Không tìm thấy job.' });
    }
    const rerender = route.match(/^\/videos\/([a-f\d-]+)\/rerender$/iu);
    if (req.method === 'POST' && rerender) {
      const body = await readJson(req);
      if (!getMotPhutVoLeContent(rerender[1])) return sendJson(res, 404, { error: 'Không tìm thấy video.' });
      await ensureMotPhutVoLeWorker();
      const job = queueMotPhutVoLeJob('rerender', { contentId: rerender[1], design: body.design || null, voice: body.voice || null,
        speed: body.speed ?? null, scriptText: typeof body.scriptText === 'string' ? body.scriptText : null });
      logMotPhutVoLeActivity('INFO', 'MOT_PHUT_VO_LE_RERENDER_QUEUED',
        'Đã xếp hàng render lại video MPVL ' + rerender[1].slice(0, 8) + '.', job.id);
      return sendJson(res, 202, { job });
    }
    const caption = route.match(/^\/videos\/([a-f\d-]+)\/caption$/iu);
    if (req.method === 'PUT' && caption) {
      const body = await readJson(req);
      return sendJson(res, 200, { video: saveMotPhutVoLeCaption(caption[1], body.caption, body.hashtags) });
    }
    const asset = route.match(/^\/files\/([a-f\d-]+)\/(video|thumbnail|audio)$/iu);
    if (req.method === 'GET' && asset) return sendContentFile(res, asset[1], asset[2]);
    if (req.method === 'POST' && route === '/voices/preview') {
      const body = await readJson(req);
      const previewId = crypto.randomUUID();
      const file = path.join(DATA, 'mot-phut-vo-le', 'previews', `${previewId}.wav`);
      const text = String(body.text || '').normalize('NFC').trim().slice(0, 600);
      const previewAudio = await createMotPhutVoLeVoicePreview({ text, voice: body.voice, speed: body.speed, outputPath: file });
      let wordBoundaries = [];
      try {
        const timing = JSON.parse(fs.readFileSync(previewAudio.timingPath, 'utf8'));
        wordBoundaries = Array.isArray(timing.wordBoundaries) ? timing.wordBoundaries : [];
      } catch { }
      const mapped = mapWordBoundariesToTokens(text, wordBoundaries, `mot-phut-preview-${previewId}`, { language: 'vi' });
      const highlightMode = body.highlightMode === 'phrase' ? 'phrase' : 'word';
      previewFiles.set(previewId, file);
      const timer = setTimeout(() => {
        previewFiles.delete(previewId);
        try { fs.rmSync(file, { force: true }); } catch { }
        try { fs.rmSync(previewAudio.timingPath, { force: true }); } catch { }
      }, 30 * 60_000);
      timer.unref?.();
      return sendJson(res, 201, { previewId, url: `/api/mot-phut-vo-le/voice-preview/${previewId}`, voice: previewAudio.voice,
        tokens: mapped.tokens, wordTimings: mapped.wordTimings, alignment: mapped.alignment,
        highlightIntervals: buildHighlightIntervals(mapped.wordTimings, highlightMode) });
    }
    const preview = route.match(/^\/voice-preview\/([a-f\d-]+)$/iu);
    if (req.method === 'GET' && preview) {
      const file = previewFiles.get(preview[1]);
      if (!file || !fs.existsSync(file)) return sendJson(res, 404, { error: 'Bản nghe thử đã hết hạn.' });
      return streamFile(res, file, 'audio/wav');
    }
    return sendJson(res, 404, { error: 'Không tìm thấy API Một Phút Vỡ Lẽ.' });
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message || 'Yêu cầu Một Phút Vỡ Lẽ thất bại.', code: error.code || null });
  }
}

async function readJson(req, maxBytes = 256_000) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Object.assign(new Error('Yêu cầu vượt quá giới hạn kích thước.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('JSON gửi lên không hợp lệ.'), { statusCode: 400 }); }
}

async function buildPreviewSvg(body) {
  const content = body.content && typeof body.content === 'object' ? body.content : {};
  return buildMotPhutVoLeVisualPreviewSvg({
    content: { title: content.title || 'Vì sao ta hay ngáp?', scriptText: content.scriptText || 'Một câu chuyện nhỏ về cách bộ não phản ứng với người xung quanh.', thumbnailHighlight: content.thumbnailHighlight || '' },
    design: body.design || getMotPhutVoLeVisualDesign(), backgroundEffect: body.backgroundEffect || getMotPhutVoLeSettings(), mode: body.mode || 'content'
  });
}

function sendContentFile(res, id, kind) {
  if (deletingContentIds.has(id)) return sendJson(res, 409, { error: 'Video MPVL này đang được xóa.' });
  const content = getMotPhutVoLeContent(id);
  if (!content) return sendJson(res, 404, { error: 'Không tìm thấy nội dung.' });
  const field = kind === 'video' ? 'videoPath' : kind === 'thumbnail' ? 'thumbnailPath' : 'audioPath';
  const file = content[field];
  const root = kind === 'audio' ? MODULE_DATA_DIR : MODULE_OUTPUT_DIR;
  if (!file || !path.resolve(file).startsWith(`${root}${path.sep}`) || !fs.existsSync(file)) return sendJson(res, 404, { error: 'Không tìm thấy tệp đầu ra.' });
  const type = kind === 'video' ? 'video/mp4' : kind === 'thumbnail' ? 'image/png' : 'audio/wav';
  return streamFile(res, file, type, id);
}

function streamFile(res, file, type, contentId = null) {
  const stat = fs.statSync(file);
  const stream = fs.createReadStream(file);
  if (contentId) {
    const streams = activeContentStreams.get(contentId) || new Set();
    streams.add(stream);
    activeContentStreams.set(contentId, streams);
    stream.once('close', () => untrackContentStream(contentId, stream));
  }
  stream.once('error', (error) => {
    if (contentId) untrackContentStream(contentId, stream);
    if (!res.headersSent) sendJson(res, 500, { error: error.message || 'Không đọc được tệp video MPVL.' });
    else res.destroy();
  });
  res.once('close', () => {
    if (!res.writableFinished && !stream.destroyed) stream.destroy();
  });
  res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'cache-control': 'no-store' });
  stream.pipe(res);
  return true;
}

function untrackContentStream(id, stream) {
  const streams = activeContentStreams.get(id);
  if (!streams) return;
  streams.delete(stream);
  if (!streams.size) activeContentStreams.delete(id);
}

async function closeActiveContentStreams(id) {
  const streams = [...(activeContentStreams.get(id) || [])];
  await Promise.all(streams.map((stream) => new Promise((resolve) => {
    if (stream.closed) return resolve();
    stream.once('close', resolve);
    if (!stream.destroyed) stream.destroy();
    if (stream.closed) resolve();
  })));
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return ['127.0.0.1', 'localhost'].includes(url.hostname) && Number(url.port || 80) === PORT;
  } catch { return false; }
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
  res.end(body);
  return true;
}
