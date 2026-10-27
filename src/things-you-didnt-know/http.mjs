import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA, PORT } from '../config.mjs';
import { chatgptStatus } from '../ai/chatgpt-plan.mjs';
import { KOKORO_VOICES, kokoroModelStatus, synthesizeKokoroPreview } from '../tts/kokoro-tts.mjs';
import { buildHighlightIntervals, mapWordBoundariesToTokens } from '../../packages/audio-highlight/highlight-engine.mjs';
import { BACKGROUND_EFFECTS } from '../../packages/video-engine/background-effects.mjs';
import { COUNTRY_CATALOG, COUNTRY_CATALOG_SOURCE, TOPIC_GROUPS } from './catalog.mjs';
import { approveThingsYouDidntKnowSources, cancelThingsYouDidntKnowSchedule, getThingsYouDidntKnowContent,
  deleteThingsYouDidntKnowVideo,
  getThingsYouDidntKnowJob, listThingsYouDidntKnowActivity, listThingsYouDidntKnowContents,
  listThingsYouDidntKnowJobs, listThingsYouDidntKnowSchedules, logThingsYouDidntKnowActivity,
  queueThingsYouDidntKnowJob, retryThingsYouDidntKnowJob, updateThingsYouDidntKnowContent,
  updateThingsYouDidntKnowSchedule } from './history.mjs';
import { inspectThingsYouDidntKnowSources } from './fact-check.mjs';
import { getThingsYouDidntKnowSettings, saveThingsYouDidntKnowFacebookPage,
  saveThingsYouDidntKnowSettings,
  thingsYouDidntKnowFacebookTokenSaved, clearThingsYouDidntKnowFacebookToken } from './settings-store.mjs';
import { assertThingsYouDidntKnowSettings } from './settings.mjs';
import { getThingsYouDidntKnowSourceVisualDesign, listThingsYouDidntKnowSourceVisualPresets,
  resetThingsYouDidntKnowSourceVisualDesign, saveThingsYouDidntKnowSourceVisualDesign,
  saveThingsYouDidntKnowSourceVisualPreset, selectThingsYouDidntKnowSourceVisualPreset } from './source-visual-design-store.mjs';
import { THINGS_YOU_DIDNT_KNOW_SOURCE_VISUAL_DESIGN_DEFAULTS } from './source-visual-design.mjs';
import { buildThingsYouDidntKnowSourcePreviewSvg } from './source-visual-renderer.mjs';
import { renderSourceDesignSvg } from './source-font-renderer.mjs';
import { createThingsYouDidntKnowManualSchedule } from './scheduler.mjs';
import { verifyThingsYouDidntKnowFacebookPage } from './facebook-publisher.mjs';
import { ensureThingsYouDidntKnowWorker } from './worker-process.mjs';

const PREFIX = '/api/things-you-didnt-know';
const previewFiles = new Map();
const activeContentStreams = new Map();
const deletingContentIds = new Set();
const MODULE_DATA_DIR = path.resolve(DATA, 'things-you-didnt-know');
const MODULE_OUTPUT_DIR = path.resolve(DATA, 'outputs', 'things-you-didnt-know');

export async function handleThingsYouDidntKnowApi(req, res, url) {
  if (!url.pathname.startsWith(PREFIX + '/')) return false;
  if (req.method !== 'GET' && !sameOrigin(req)) return sendJson(res, 403, { error: 'Yêu cầu không cùng nguồn.' });
  const route = url.pathname.slice(PREFIX.length);
  try {
    if (req.method === 'GET' && route === '/status') {
      const settings = getThingsYouDidntKnowSettings();
      await ensureThingsYouDidntKnowWorker();
      return sendJson(res, 200, {
        module: 'things-you-didnt-know', contentType: 'things-you-didnt-know', jobType: 'create_tydk_reel',
        chatgpt: chatgptStatus(), kokoro: kokoroModelStatus(settings), voices: KOKORO_VOICES,
        settings, facebookPage: { pageId: settings.facebookPageId, pageName: settings.facebookPageName,
          verified: settings.facebookPageVerified, tokenSaved: thingsYouDidntKnowFacebookTokenSaved() },
        countries: COUNTRY_CATALOG, countryCatalogSource: COUNTRY_CATALOG_SOURCE, topics: TOPIC_GROUPS,
        backgroundEffects: BACKGROUND_EFFECTS,
        design: getThingsYouDidntKnowSourceVisualDesign(), presets: listThingsYouDidntKnowSourceVisualPresets()
      });
    }
    if (req.method === 'PUT' && route === '/settings') {
      const body = await readJson(req);
      const allowed = new Set(['voice', 'speechRate', 'highlightEnabled', 'highlightMode', 'highlightStyle', 'highlightColor',
        'highlightPadding', 'highlightRadius', 'backgroundEffect',
        'backgroundEffectDensity', 'backgroundEffectSpeed', 'backgroundEffectOpacity', 'facebookAdapter',
        'fullAutoEnabled', 'autoGenerationEnabled', 'autoPublishEnabled', 'postsPerDay', 'prepareAheadDays', 'maxScriptsPerDay']);
      if (Object.keys(body).some((key) => !allowed.has(key))) return sendJson(res, 400, { error: 'Chỉ có thể lưu thiết lập giọng, hiệu ứng, highlight và Full Auto Things You Didn\'t Know.' });
      const current = getThingsYouDidntKnowSettings();
      const settings = assertThingsYouDidntKnowSettings({ ...current, ...body }, {
        validVoices: KOKORO_VOICES.map((voice) => voice.id)
      });
      const saved = saveThingsYouDidntKnowSettings(settings);
      await ensureThingsYouDidntKnowWorker();
      return sendJson(res, 200, { settings: saved });
    }
    if (req.method === 'PUT' && route === '/facebook-page') {
      const body = await readJson(req);
      const settings = saveThingsYouDidntKnowFacebookPage({ pageId: body.pageId, accessToken: body.accessToken });
      return sendJson(res, 200, { page: pageStatus(settings) });
    }
    if (req.method === 'POST' && route === '/facebook-page/verify') {
      const page = await verifyThingsYouDidntKnowFacebookPage();
      return sendJson(res, 200, { page: { ...page, tokenSaved: thingsYouDidntKnowFacebookTokenSaved() } });
    }
    if (req.method === 'DELETE' && route === '/facebook-page/token') {
      clearThingsYouDidntKnowFacebookToken();
      const settings = saveThingsYouDidntKnowSettings({ facebookPageVerified: false, facebookPageName: '', autoPublishEnabled: false });
      return sendJson(res, 200, { page: pageStatus(settings) });
    }
    if (req.method === 'GET' && route === '/visual-design/defaults') return sendJson(res, 200, { design: THINGS_YOU_DIDNT_KNOW_SOURCE_VISUAL_DESIGN_DEFAULTS });
    if (req.method === 'GET' && route === '/visual-design') return sendJson(res, 200, { design: getThingsYouDidntKnowSourceVisualDesign() });
    if ((req.method === 'PUT' || req.method === 'POST') && route === '/visual-design') {
      const design = saveThingsYouDidntKnowSourceVisualDesign(await readJson(req));
      return sendJson(res, 200, { design });
    }
    if (req.method === 'POST' && route === '/visual-design/reset') {
      const design = resetThingsYouDidntKnowSourceVisualDesign();
      return sendJson(res, 200, { design });
    }
    if (req.method === 'GET' && route === '/visual-design/presets') return sendJson(res, 200, { presets: listThingsYouDidntKnowSourceVisualPresets() });
    if (req.method === 'POST' && route === '/visual-design/presets') {
      const body = await readJson(req);
      const preset = saveThingsYouDidntKnowSourceVisualPreset(body.name, body.design);
      const isDefault = listThingsYouDidntKnowSourceVisualPresets().some((item) => item.id === preset.id && item.isDefault);
      return sendJson(res, 201, { preset: { ...preset, isDefault } });
    }
    const selectPreset = route.match(/^\/visual-design\/presets\/([a-f\d-]+)\/select$/iu);
    if (req.method === 'POST' && selectPreset) {
      const design = selectThingsYouDidntKnowSourceVisualPreset(selectPreset[1]);
      return sendJson(res, 200, { design });
    }
    if (req.method === 'GET' && route === '/visual-preview.svg') {
      const mode = url.searchParams.get('mode') === 'thumbnail' ? 'thumbnail' : 'content';
      const svg = previewSvg(mode, getThingsYouDidntKnowSourceVisualDesign());
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(svg);
      return true;
    }
    if (req.method === 'POST' && route === '/visual-preview.svg') {
      const body = await readJson(req);
      const mode = body.mode === 'thumbnail' ? 'thumbnail' : 'content';
      const sample = { ...(body.sample || body.script || {}), ...(body.render === true ? { render: true } : {}) };
      const svg = previewSvg(mode, body.design || getThingsYouDidntKnowSourceVisualDesign(), sample);
      if (body.render === true) {
        const png = await renderSourceDesignSvg(svg);
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(png);
        return true;
      }
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(svg);
      return true;
    }
    if (req.method === 'POST' && route === '/jobs') {
      const body = await readJson(req);
      const chatgpt = chatgptStatus();
      if (!chatgpt.connected) return sendJson(res, 409, { error: 'Hãy kết nối ChatGPT Plan trước khi tạo Reel Things You Didn\'t Know.' });
      const job = queueThingsYouDidntKnowJob({
        countryId: body.countryId || null, themeId: body.themeId || null,
        settingsSnapshot: getThingsYouDidntKnowSettings(), designSnapshot: getThingsYouDidntKnowSourceVisualDesign()
      });
      await ensureThingsYouDidntKnowWorker();
      return sendJson(res, 202, { job });
    }
    if (req.method === 'GET' && route === '/jobs') {
      const jobs = listThingsYouDidntKnowJobs(url.searchParams.get('limit') || 100);
      if (jobs.some((job) => job.status === 'pending')) await ensureThingsYouDidntKnowWorker();
      return sendJson(res, 200, { jobs });
    }
    const jobRoute = route.match(/^\/jobs\/([a-f\d-]+)(?:\/(retry))?$/iu);
    if (req.method === 'GET' && jobRoute && !jobRoute[2]) {
      const job = getThingsYouDidntKnowJob(jobRoute[1]);
      return job ? sendJson(res, 200, { job }) : sendJson(res, 404, { error: 'Không tìm thấy job Things You Didn\'t Know.' });
    }
    if (req.method === 'POST' && jobRoute?.[2]) {
      const job = retryThingsYouDidntKnowJob(jobRoute[1]);
      await ensureThingsYouDidntKnowWorker();
      return sendJson(res, 202, { job });
    }
    if (req.method === 'GET' && route === '/contents') return sendJson(res, 200, { contents: listThingsYouDidntKnowContents({ limit: url.searchParams.get('limit') || 500 }) });
    const contentRoute = route.match(/^\/contents\/([a-f\d-]+)(?:\/(approve-sources|recheck-sources|schedule|retry-schedule))?$/iu);
    if (req.method === 'DELETE' && contentRoute && !contentRoute[2]) {
      const id = contentRoute[1];
      if (deletingContentIds.has(id)) return sendJson(res, 409, { error: 'Reel Things You Didn\'t Know này đang được xóa.' });
      deletingContentIds.add(id);
      try {
        await closeActiveContentStreams(id);
        const result = deleteThingsYouDidntKnowVideo(id);
        return result ? sendJson(res, 200, result) : sendJson(res, 404, { error: 'Không tìm thấy Reel Things You Didn\'t Know cần xóa.' });
      } finally {
        deletingContentIds.delete(id);
      }
    }
    if (req.method === 'GET' && contentRoute && !contentRoute[2]) {
      const content = getThingsYouDidntKnowContent(contentRoute[1]);
      return content ? sendJson(res, 200, { content }) : sendJson(res, 404, { error: 'Không tìm thấy Reel Things You Didn\'t Know.' });
    }
    if (req.method === 'POST' && contentRoute?.[2] === 'approve-sources') {
      const body = await readJson(req);
      return sendJson(res, 200, { content: approveThingsYouDidntKnowSources(contentRoute[1], body.note || '') });
    }
    if (req.method === 'POST' && contentRoute?.[2] === 'recheck-sources') {
      const content = getThingsYouDidntKnowContent(contentRoute[1]);
      if (!content) return sendJson(res, 404, { error: 'Không tìm thấy Reel.' });
      const review = await inspectThingsYouDidntKnowSources(content.sources);
      return sendJson(res, 200, { review });
    }
    if (req.method === 'POST' && contentRoute?.[2] === 'schedule') {
      const body = await readJson(req);
      const schedule = createThingsYouDidntKnowManualSchedule(contentRoute[1], body.scheduledAt, { adapter: body.adapter || null });
      await ensureThingsYouDidntKnowWorker();
      return sendJson(res, 201, { schedule });
    }
    const scheduleRoute = route.match(/^\/schedules\/([a-f\d-]+)(?:\/(retry))?$/iu);
    if (req.method === 'DELETE' && scheduleRoute && !scheduleRoute[2]) {
      const schedule = cancelThingsYouDidntKnowSchedule(scheduleRoute[1]);
      return schedule ? sendJson(res, 200, { schedule }) : sendJson(res, 404, { error: 'Không tìm thấy lịch Things You Didn\'t Know.' });
    }
    if (req.method === 'POST' && scheduleRoute?.[2]) {
      const schedule = listThingsYouDidntKnowSchedules().find((item) => item.id === scheduleRoute[1]);
      if (!schedule || !['failed', 'uncertain'].includes(schedule.status)) return sendJson(res, 409, { error: 'Chỉ có thể thử lại lịch đăng đã thất bại hoặc chưa rõ kết quả.' });
      if (schedule.status === 'uncertain') return sendJson(res, 409, { error: 'Lịch Meta chưa rõ kết quả. Hãy kiểm tra Facebook Planner trước để tránh đăng trùng.' });
      if (schedule.adapter === 'meta') {
        const settings = getThingsYouDidntKnowSettings();
        if (!settings.facebookPageVerified || settings.facebookPageId !== schedule.targetPageId) {
          return sendJson(res, 409, { error: 'Hãy xác minh lại đúng Facebook Page của lịch này trước khi thử gửi lại.' });
        }
      }
      const minimumLeadMs = schedule.adapter === 'meta' ? 15 * 60_000 : 60_000;
      const scheduledAt = new Date(Math.max(Date.now() + minimumLeadMs, Date.parse(schedule.scheduledAt) || 0)).toISOString();
      const next = updateThingsYouDidntKnowSchedule(schedule.id, {
        status: 'scheduled', scheduledAt, facebookState: 'local', facebookError: null, facebookVideoId: null, upload: {}
      });
      await ensureThingsYouDidntKnowWorker();
      return sendJson(res, 202, { schedule: next });
    }
    if (req.method === 'GET' && route === '/schedules') return sendJson(res, 200, { schedules: listThingsYouDidntKnowSchedules() });
    if (req.method === 'GET' && route === '/activity') return sendJson(res, 200, { activity: listThingsYouDidntKnowActivity(300) });
    if (req.method === 'POST' && route === '/voices/preview') return await voicePreview(req, res);
    const voiceFile = route.match(/^\/voice-preview\/([a-f\d-]+)$/iu);
    if (req.method === 'GET' && voiceFile) return streamPreview(res, voiceFile[1]);
    const asset = route.match(/^\/files\/([a-f\d-]+)\/(video|thumbnail|audio)$/iu);
    if (req.method === 'GET' && asset) return sendContentFile(res, asset[1], asset[2]);
    return sendJson(res, 404, { error: 'Không tìm thấy API Things You Didn\'t Know.' });
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message || 'Yêu cầu Things You Didn\'t Know thất bại.', code: error.code || null });
  }
}

function pageStatus(settings) {
  return { pageId: settings.facebookPageId, pageName: settings.facebookPageName,
    verified: settings.facebookPageVerified, tokenSaved: thingsYouDidntKnowFacebookTokenSaved() };
}

function sampleScript() {
  return {
    country: 'Japan', theme: 'daily-life', title: 'A Quiet Daily Custom', imageTitle: 'A Quiet Daily Custom',
    imageBody: 'In some neighborhoods, people leave small umbrellas near community entrances for anyone caught in the rain. The shared umbrellas are meant to be borrowed and returned when convenient, turning an ordinary rainy day into a small act of trust. The custom is not universal, and local versions differ, but it offers a gentle reminder that public spaces can encourage everyday kindness.',
    illustrationBrief: 'umbrella, doorway, rain', thumbnailHeadline: 'A Small Umbrella Surprise', thumbnailHighlights: ['Umbrella', 'Surprise']
  };
}

function previewSvg(mode, design, incomingSample = null) {
  const sample = incomingSample && typeof incomingSample === 'object' ? { ...sampleScript(), ...incomingSample } : sampleScript();
  return buildThingsYouDidntKnowSourcePreviewSvg({ mode, design, sample, effects: getThingsYouDidntKnowSettings() });
}

async function voicePreview(req, res) {
  const body = await readJson(req);
  const id = crypto.randomUUID();
  const directory = path.join(MODULE_DATA_DIR, 'previews');
  const outputPath = path.join(directory, id + '.wav');
  const timingPath = outputPath + '.wordtimings.json';
  const settings = getThingsYouDidntKnowSettings();
  const voice = KOKORO_VOICES.some((item) => item.id === body.voice) ? body.voice : settings.voice;
  const text = String(body.text || 'Here is a short Things You Didn\'t Know voice preview.').normalize('NFC').trim().slice(0, 600);
  const preview = await synthesizeKokoroPreview({ text, voice, speed: Number(body.speed ?? settings.speechRate), outputPath, timingPath,
    settings: { kokoroEnVoice: voice, kokoroEnSpeed: Number(body.speed ?? settings.speechRate) } });
  let wordBoundaries = [];
  try { wordBoundaries = JSON.parse(fs.readFileSync(timingPath, 'utf8')).wordBoundaries || []; } catch { }
  const mapped = mapWordBoundariesToTokens(text, wordBoundaries, 'tydk-preview-' + id, { language: 'en' });
  previewFiles.set(id, { outputPath, timingPath });
  const timer = setTimeout(() => { previewFiles.delete(id); fs.rmSync(outputPath, { force: true }); fs.rmSync(timingPath, { force: true }); }, 30 * 60_000);
  timer.unref?.();
  return sendJson(res, 201, { previewId: id, url: PREFIX + '/voice-preview/' + id, voice,
    tokens: mapped.tokens, wordTimings: mapped.wordTimings, alignment: mapped.alignment,
    highlightIntervals: buildHighlightIntervals(mapped.wordTimings, body.highlightMode === 'phrase' ? 'phrase' : 'word') });
}

function streamPreview(res, id) {
  const file = previewFiles.get(id)?.outputPath;
  if (!file || !fs.existsSync(file)) return sendJson(res, 404, { error: 'Bản nghe thử đã hết hạn.' });
  return streamFile(res, file, 'audio/wav');
}

function sendContentFile(res, id, kind) {
  if (deletingContentIds.has(id)) return sendJson(res, 409, { error: 'Reel Things You Didn\'t Know này đang được xóa.' });
  const content = getThingsYouDidntKnowContent(id);
  if (!content) return sendJson(res, 404, { error: 'Không tìm thấy Reel.' });
  const field = kind === 'video' ? 'videoPath' : kind === 'thumbnail' ? 'thumbnailPath' : 'audioPath';
  const file = content[field];
  const root = MODULE_OUTPUT_DIR;
  if (!file || !path.resolve(file).startsWith(root + path.sep) || !fs.existsSync(file)) return sendJson(res, 404, { error: 'Không tìm thấy tệp đầu ra.' });
  const type = kind === 'video' ? 'video/mp4' : kind === 'thumbnail' ? 'image/png' : 'audio/wav';
  res.setHeader('content-disposition', 'inline; filename="' + id + (kind === 'video' ? '.mp4' : kind === 'thumbnail' ? '.png' : '.wav') + '"');
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
    if (!res.headersSent) sendJson(res, 500, { error: error.message || 'Không đọc được tệp Reel Things You Didn\'t Know.' });
    else res.destroy();
  });
  res.once('close', () => { if (!res.writableFinished && !stream.destroyed) stream.destroy(); });
  res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
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

async function readJson(req, maxBytes = 512_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Yêu cầu vượt giới hạn kích thước.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('JSON gửi lên không hợp lệ.'), { statusCode: 400 }); }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { const parsed = new URL(origin); return ['127.0.0.1', 'localhost'].includes(parsed.hostname) && Number(parsed.port || 80) === PORT; }
  catch { return false; }
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
  return true;
}
