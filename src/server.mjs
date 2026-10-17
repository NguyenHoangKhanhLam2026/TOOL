import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, PORT, HOST, PATHS, PYTHON_BIN, FFMPEG_BIN, FFPROBE_BIN } from './config.mjs';
import {
  db, getSettings, saveSettings, getOverview, listTopics, listVideos, listJobs,
  listPublishHistory, listSchedules, listPublishedSchedules, deletePublishedSchedule, queueJob, createSchedule, approveVideoAndCreateRandomSchedule, queueFacebookSchedule, log, getScript, updateVideo, addTopic, deleteVideo
} from './database/db.mjs';
import { providerStatus } from './ai/script-service.mjs';
import { beginChatGPTSignIn, completeChatGPTSignIn, chatgptStatus, disconnectChatGPT } from './ai/chatgpt-plan.mjs';
import { facebookTokenSaved, saveFacebookToken, clearFacebookToken, MetaGraphAdapter } from '../packages/facebook-engine/meta-graph-adapter.mjs';
import { MockFacebookAdapter } from '../packages/facebook-engine/mock-adapter.mjs';
import { zonedLocalToDate } from './scheduler/time.mjs';
import { alignSpeechLocally, synthesizeSpeech } from './tts/edge-tts.mjs';
import { synthesizeVieNeuPreview, vieneuModelStatus, VIENEU_VOICES } from './tts/vieneu-tts.mjs';
import { KOKORO_VOICES, kokoroModelStatus, synthesizeKokoroPreview } from './tts/kokoro-tts.mjs';
import { getLocalTtsManagerStatus, withLocalTtsModel } from './tts/local-model-manager.mjs';
import { buildHighlightIntervals, mapWordBoundariesToTokens, normalizeLanguage, prepareSpeechText } from '../packages/audio-highlight/highlight-engine.mjs';
import { BRANDING_DIR, buildSceneSvg, rasterizeScene, readVisualTemplate, saveVisualTemplate, getDesignPrompts } from '../packages/video-engine/visual-template-engine.mjs';
import { BACKGROUND_EFFECTS } from '../packages/video-engine/background-effects.mjs';
import { deleteAsset, listAssets, resetBrandAssets, saveUploadedAsset, setDefaultAsset } from '../packages/video-engine/asset-manager.mjs';

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2' };

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function html(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

async function readJson(req, maxBytes = 1_000_000) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes) throw Object.assign(new Error('Yêu cầu quá lớn.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw Object.assign(new Error('JSON không hợp lệ.'), { statusCode: 400 }); }
}

async function readBuffer(req, maxBytes = 15 * 1024 * 1024) {
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes) throw Object.assign(new Error('Tệp tải lên vượt quá 15 MB.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendBuffer(res, status, type, buffer) {
  res.writeHead(status, { 'content-type': type, 'content-length': buffer.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(buffer);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return ['127.0.0.1', 'localhost'].includes(url.hostname) && Number(url.port || 80) === PORT;
  } catch { return false; }
}

function latestPreviewScript(scriptId = '') {
  if (scriptId) return getScript(scriptId) || null;
  const row = db.prepare("SELECT script_id FROM videos WHERE script_id IS NOT NULL ORDER BY created_at DESC LIMIT 1").get();
  return row ? getScript(row.script_id) : null;
}

const websocketClients = new Set();
function websocketFrame(value, opcode = 1) {
  const payload = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  let header;
  if (payload.length < 126) { header = Buffer.from([0x80 | opcode, payload.length]); }
  else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  return Buffer.concat([header, payload]);
}
function broadcast(type, data) {
  const frame = websocketFrame({ type, data, at: new Date().toISOString() });
  for (const socket of websocketClients) {
    if (socket.destroyed || !socket.writable) websocketClients.delete(socket);
    else socket.write(frame);
  }
}

let logCursor = Number(db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM logs').get().id);
setInterval(() => {
  try {
    const rows = db.prepare('SELECT id,level,code,message,job_id,created_at FROM logs WHERE id>? ORDER BY id LIMIT 200').all(logCursor);
    for (const row of rows) {
      logCursor = Math.max(logCursor, Number(row.id));
      let data = row;
      if (['TTS_PROGRESS', 'RENDER_PROGRESS', 'RENDER_TIMELINE'].includes(row.code)) {
        try { data = { ...row, detail: JSON.parse(row.message) }; } catch { /* retain the raw log if malformed */ }
      }
      if (row.code === 'TTS_PROGRESS') broadcast('tts:progress', data);
      if (row.code === 'RENDER_PROGRESS') broadcast('render:progress', data);
      if (['JOB_STARTED', 'JOB_COMPLETED', 'JOB_FAILED'].includes(row.code)) broadcast('job:status', data);
      if (/^PUBLISH_|^FACEBOOK_/.test(row.code)) broadcast('facebook:publish-status', data);
    }
  } catch (error) { console.warn('WebSocket log poll failed:', error.message); }
}, 500).unref();

function publicSettings() {
  const settings = getSettings();
  if (!BACKGROUND_EFFECTS.some((effect) => effect.id === String(settings.backgroundEffect || ''))) {
    settings.backgroundEffect = 'bubbles';
  }
  return { ...settings, allowPaidAiApi: false, facebookTokenSaved: facebookTokenSaved(), chatgpt: chatgptStatus() };
}

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let settled = false;
    let timeout;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ stdout, ...result });
    };
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (error) {
      finish({ status: null, error });
      return;
    }
    timeout = setTimeout(() => {
      try { child.kill(); } catch { /* the process may already have exited */ }
      finish({ status: null, error: Object.assign(new Error('Process probe timed out.'), { code: 'ETIMEDOUT' }) });
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout = `${stdout}${chunk.toString('utf8')}`.slice(-4096); });
    child.once('error', (error) => finish({ status: null, error }));
    child.once('close', (status) => finish({ status, error: null }));
  });
}

async function checkTool(command, args = ['-version']) {
  const result = await runCommand(command, args, 2500);
  return { ready: !result.error && result.status === 0, errorCode: result.error?.code || (result.status === 0 ? null : 'EXIT') };
}

async function systemStatus() {
  const settings = getSettings();
  const vieneu = vieneuModelStatus(settings);
  const kokoro = kokoroModelStatus(settings);
  const localTts = getLocalTtsManagerStatus();
  const [python, edgeTts, alignment, vieneuPython, kokoroPython, ffmpeg, ffprobe] = await Promise.all([
    runCommand(PYTHON_BIN, ['--version'], 6000),
    runCommand(PYTHON_BIN, ['-c', 'import edge_tts'], 6000),
    runCommand(PYTHON_BIN, ['-c', "import importlib.util; print('yes' if importlib.util.find_spec('stable_whisper') else 'no')"], 6000),
    vieneu.installed ? runCommand(vieneu.python, ['--version'], 6000) : null,
    kokoro.installed ? runCommand(kokoro.python, ['--version'], 6000) : null,
    checkTool(FFMPEG_BIN, ['-version']),
    checkTool(FFPROBE_BIN, ['-version'])
  ]);
  const localWordAlignment = alignment.status === 0 && alignment.stdout.trim() === 'yes';
  let worker = false;
  let workerLastSeen = null;
  try {
    const heartbeat = JSON.parse(fs.readFileSync(path.join(PATHS.logs, 'worker-heartbeat.json'), 'utf8'));
    workerLastSeen = heartbeat.lastSeen;
    worker = Date.now() - new Date(heartbeat.lastSeen).getTime() < 30_000;
  } catch { /* worker has not started */ }
  const chatgpt = chatgptStatus();
  return {
    node: process.version,
    database: true,
    worker,
    workerLastSeen,
    tools: {
      ffmpeg: ffmpeg.ready,
      ffprobe: ffprobe.ready,
      python: python.status === 0,
      edgeTts: edgeTts.status === 0,
      vieneuTts: Boolean(vieneu.ready && vieneuPython && !vieneuPython.error && vieneuPython.status === 0),
      kokoroTts: Boolean(kokoro.ready && kokoroPython && !kokoroPython.error && kokoroPython.status === 0),
      localWordAlignment,
      errors: {
        python: python.error?.code || (python.status === 0 ? null : 'EXIT'),
        edgeTts: edgeTts.error?.code || (edgeTts.status === 0 ? null : 'EXIT'),
        ffmpeg: ffmpeg.errorCode,
        ffprobe: ffprobe.errorCode,
        vieneuTts: vieneuPython?.error?.code || (vieneuPython && vieneuPython.status !== 0 ? 'EXIT' : null),
        kokoroTts: kokoroPython?.error?.code || (kokoroPython && kokoroPython.status !== 0 ? 'EXIT' : null)
      }
    },
    vieneu,
    kokoro: { ...kokoro, voices: KOKORO_VOICES },
    localTts,
    aiReady: chatgpt.connected,
    liveFacebookReady: Boolean(settings.facebookConnectionVerified && facebookTokenSaved() && settings.pageId)
  };
}

function serveFile(req, res, absolutePath) {
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return json(res, 404, { error: 'Không tìm thấy tệp.' });
  const ext = path.extname(absolutePath).toLowerCase();
  const size = fs.statSync(absolutePath).size;
  const isPublicAsset = path.resolve(absolutePath).startsWith(`${path.resolve(PATHS.public)}${path.sep}`);
  const range = req.headers.range;
  if (range && ext === '.mp4') {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (!match) return json(res, 416, { error: 'Range không hợp lệ.' });
    const start = Number(match[1] || 0); const end = Math.min(Number(match[2] || size - 1), size - 1);
    if (start > end || start >= size) return json(res, 416, { error: 'Range ngoài tệp.' });
    res.writeHead(206, { 'content-type': 'video/mp4', 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' });
    fs.createReadStream(absolutePath, { start, end }).pipe(res); return;
  }
  res.writeHead(200, { 'content-type': mimeTypes[ext] || 'application/octet-stream', 'content-length': size, 'x-content-type-options': 'nosniff', 'accept-ranges': ext === '.mp4' ? 'bytes' : 'none', ...(isPublicAsset ? { 'cache-control': 'no-store' } : {}) });
  fs.createReadStream(absolutePath).pipe(res);
}

function safeOutputPath(value) {
  if (typeof value !== 'string' || !value) return null;
  const resolved = path.resolve(value);
  return resolved.startsWith(`${path.resolve(PATHS.output)}${path.sep}`) ? resolved : null;
}

function hasRenderedOutput(value) {
  const outputPath = safeOutputPath(value);
  if (!outputPath) return false;
  try {
    const stat = fs.statSync(outputPath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function isDefinitePagePermissionFailure(message) {
  return /\(#200\).*pages_manage_posts permission/i.test(String(message || ''));
}

function releaseDefinitePagePermissionFailure(videoId) {
  db.prepare("UPDATE publish_history SET status='failed' WHERE video_id=? AND status='uncertain' AND error LIKE '%(#200)%pages_manage_posts permission%'")
    .run(videoId);
}

function attachVideoProgress(videos) {
  const jobs = db.prepare("SELECT id,status,payload_json FROM jobs WHERE type='create_video' ORDER BY created_at DESC LIMIT 100").all().map((job) => {
    try { return { ...job, payload: JSON.parse(job.payload_json) }; } catch { return { ...job, payload: {} }; }
  });
  const logs = db.prepare('SELECT job_id,code,message FROM logs WHERE id IN (SELECT id FROM logs ORDER BY id DESC LIMIT 1500) ORDER BY id').all();
  const logsByJob = new Map();
  for (const row of logs) {
    if (!logsByJob.has(row.job_id)) logsByJob.set(row.job_id, []);
    logsByJob.get(row.job_id).push(row);
  }
  return videos.map((video) => {
    const job = jobs.find((item) => item.payload.videoId === video.id || item.payload.scriptId === video.script_id);
    const events = job ? logsByJob.get(job.id) || [] : [];
    const lastAttempt = events.findLastIndex((item) => item.code === 'JOB_STARTED');
    const currentEvents = events.slice(Math.max(0, lastAttempt));
    const scriptReady = currentEvents.some((item) => item.code === 'SCRIPT_READY');
    const ttsReady = currentEvents.some((item) => item.code === 'TTS_READY');
    const videoReady = hasRenderedOutput(video.video_path);
    const failed = video.status === 'failed' && !videoReady;
    const failedStep = failed ? !scriptReady ? 'script' : !ttsReady ? 'voice' : 'render' : null;
    const steps = [
      { id: 'script', label: 'Kịch bản', status: scriptReady || videoReady ? 'done' : failedStep === 'script' ? 'error' : 'active' },
      { id: 'voice', label: 'Giọng đọc', status: ttsReady || videoReady ? 'done' : failedStep === 'voice' ? 'error' : scriptReady ? 'active' : 'waiting' },
      { id: 'render', label: 'Render video', status: videoReady ? 'done' : failedStep === 'render' ? 'error' : ttsReady ? 'active' : 'waiting' },
      { id: 'complete', label: 'Hoàn tất', status: videoReady ? 'done' : 'waiting' }
    ];
    return { ...video, pipeline: { steps, error: failed ? video.last_error : null } };
  });
}

async function handleApi(req, res, url) {
  if (req.method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'Yêu cầu không cùng nguồn.' });
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /api/visual-template') return json(res, 200, { template: readVisualTemplate() });
  if (route === 'PUT /api/visual-template') {
    const template = saveVisualTemplate(await readJson(req));
    broadcast('template:saved', { templateId: template.templateId, version: template.version });
    return json(res, 200, { template });
  }
  if (route === 'POST /api/visual-template/reset') {
    const result = resetBrandAssets();
    broadcast('template:saved', { templateId: result.template.templateId, version: result.template.version, reset: true });
    broadcast('asset:updated', { reset: true });
    return json(res, 200, result);
  }
  if (route === 'GET /api/visual-template/preview.svg' || route === 'GET /api/visual-template/preview.png') {
    const state = url.searchParams.get('state') || 'vietnamese';
    const index = Math.max(0, Math.min(2, Number(url.searchParams.get('index') || 0)));
    const script = latestPreviewScript(url.searchParams.get('scriptId') || '') || undefined;
    const settings = getSettings();
    const backgroundEffect = settings.backgroundEffect;
    const backgroundEffectDensity = settings.backgroundEffectDensity;
    const backgroundEffectSpeed = settings.backgroundEffectSpeed;
    const backgroundEffectOpacity = settings.backgroundEffectOpacity;
    if (route.endsWith('.svg')) return sendBuffer(res, 200, 'image/svg+xml; charset=utf-8', Buffer.from(await buildSceneSvg({ script, state, index, embedAssets: false, backgroundEffect, backgroundEffectDensity, backgroundEffectSpeed, backgroundEffectOpacity, effectSeed: script?.id || state })));
    return sendBuffer(res, 200, 'image/png', await rasterizeScene({ script, state, index, backgroundEffect, backgroundEffectDensity, backgroundEffectSpeed, backgroundEffectOpacity, effectSeed: script?.id || state }));
  }
  if (route === 'POST /api/visual-template/render-test') {
    const body = await readJson(req, 100_000);
    const id = crypto.randomUUID();
    const imagePath = path.join(PATHS.temporary, 'visual-previews', `${id}.png`);
    const videoPath = path.join(PATHS.temporary, 'visual-previews', `${id}.mp4`);
    const settings = getSettings();
    await rasterizeScene({ state: body.state || 'bilingual', index: Number(body.index || 0), script: latestPreviewScript(body.scriptId || '') || undefined, outputPath: imagePath, backgroundEffect: settings.backgroundEffect, backgroundEffectDensity: settings.backgroundEffectDensity, backgroundEffectSpeed: settings.backgroundEffectSpeed, backgroundEffectOpacity: settings.backgroundEffectOpacity, effectSeed: id });
    const jobId = queueJob('render_preview', { previewId: id, imagePath, videoPath, seconds: 5 });
    log('INFO', 'PREVIEW_RENDER_QUEUED', `Đã xếp render thử scene ${body.state || 'bilingual'}.`, jobId);
    return json(res, 202, { id, jobId, status: 'pending', url: `/api/visual-template/test-video/${id}` });
  }
  if (route === 'POST /api/visual-template/render-full') {
    const body = await readJson(req, 100_000);
    const script = latestPreviewScript(body.scriptId || '');
    if (!script) return json(res, 404, { error: 'Chưa có kịch bản đã lưu để render.' });
    const jobId = queueJob('create_video', { scriptId: script.id, provider: script.provider, forceRender: true });
    log('INFO', 'VISUAL_RENDER_QUEUED', `Đã xếp render thương hiệu cho kịch bản ${script.id}.`, jobId);
    return json(res, 202, { jobId, scriptId: script.id, status: 'pending' });
  }
  const testVideoMatch = url.pathname.match(/^\/api\/visual-template\/test-video\/([\w-]+)$/);
  if (req.method === 'GET' && testVideoMatch) {
    const videoPath = path.join(PATHS.temporary, 'visual-previews', `${testVideoMatch[1]}.mp4`);
    if (!videoPath.startsWith(`${path.resolve(PATHS.temporary)}${path.sep}`)) return json(res, 403, { error: 'Đường dẫn không hợp lệ.' });
    return serveFile(req, res, videoPath);
  }
  const previewStatusMatch = url.pathname.match(/^\/api\/visual-template\/render-test\/status\/([\w-]+)$/);
  if (req.method === 'GET' && previewStatusMatch) {
    const job = db.prepare("SELECT status,last_error FROM jobs WHERE id=? AND type='render_preview'").get(previewStatusMatch[1]);
    return job ? json(res, 200, { jobId: previewStatusMatch[1], status: job.status, error: job.last_error }) : json(res, 404, { error: 'Không tìm thấy job render thử.' });
  }
  if (route === 'GET /api/assets') return json(res, 200, { assets: await listAssets() });
  if (route === 'POST /api/assets/reset') {
    const result = resetBrandAssets(); broadcast('template:saved', { reset: true }); broadcast('asset:updated', { reset: true });
    return json(res, 200, result);
  }
  if (route === 'GET /api/design-prompts') return json(res, 200, { prompts: getDesignPrompts() });
  const uploadMatch = url.pathname.match(/^\/api\/assets\/(background|character|logo|font|icon|thumbnail)$/);
  if (req.method === 'POST' && uploadMatch) {
    const decodeHeader = (value, fallback) => { try { return decodeURIComponent(String(value || fallback)); } catch { return fallback; } };
    const result = await saveUploadedAsset({ type: uploadMatch[1], fileName: decodeHeader(req.headers['x-asset-name'], 'asset'), fontFamily: decodeHeader(req.headers['x-asset-family'], ''), mimeType: req.headers['content-type'], buffer: await readBuffer(req) });
    broadcast('asset:updated', { id: result.id, type: result.type, duplicate: Boolean(result.duplicate) });
    return json(res, result.duplicate ? 200 : 201, { asset: result });
  }
  const assetAction = url.pathname.match(/^\/api\/assets\/([\w-]+)(?:\/(default))?$/);
  if (req.method === 'POST' && assetAction?.[2] === 'default') {
    const asset = setDefaultAsset(assetAction[1]); broadcast('template:saved', { assetId: asset.id }); broadcast('asset:updated', { id: asset.id, default: true });
    return json(res, 200, { asset });
  }
  if (req.method === 'DELETE' && assetAction && !assetAction[2]) {
    const result = deleteAsset(assetAction[1]); broadcast('asset:updated', result); return json(res, 200, result);
  }
  if (req.method === 'GET' && route === 'GET /api/visual-template/test-video') return json(res, 404, { error: 'Không tìm thấy bản render thử.' });
  if (route === 'GET /api/health') return json(res, 200, { ok: true, database: true, app: 'Auto English Reels Studio' });
  if (route === 'GET /api/system') return json(res, 200, await systemStatus());
  if (route === 'GET /api/overview') return json(res, 200, { ...getOverview(), system: await systemStatus(), providers: providerStatus(), settings: publicSettings(), schedules: listSchedules().slice(0, 8) });
  if (route === 'GET /api/background-effects') return json(res, 200, BACKGROUND_EFFECTS);
  if (route === 'GET /api/settings') return json(res, 200, publicSettings());
  if (route === 'POST /api/settings') {
    const body = await readJson(req);
    const next = { ...getSettings(), ...body };
    const migrateRemovedBackgroundEffect = body.backgroundEffect === undefined
      && !BACKGROUND_EFFECTS.some((effect) => effect.id === String(next.backgroundEffect || ''));
    if (migrateRemovedBackgroundEffect) next.backgroundEffect = 'bubbles';
    if (body.allowPaidAiApi === true) return json(res, 400, { error: 'Ứng dụng không hỗ trợ API AI trả phí.' });
    if (next.pageId && !/^\d{5,}$/.test(String(next.pageId))) return json(res, 400, { error: 'Facebook Page ID phải gồm ít nhất 5 chữ số.' });
    if (!/^\d{2}:\d{2}$/.test(String(next.postTime)) || Number(next.postTime.slice(0, 2)) > 23 || Number(next.postTime.slice(3)) > 59) return json(res, 400, { error: 'Giờ đăng phải có dạng HH:mm.' });
    if (!Number.isInteger(Number(next.postsPerDay)) || Number(next.postsPerDay) < 1 || Number(next.postsPerDay) > 4) return json(res, 400, { error: 'Tần suất phải từ 1 đến 4 bài mỗi ngày.' });
    if (!Number.isInteger(Number(next.prepareAheadDays)) || Number(next.prepareAheadDays) < 1 || Number(next.prepareAheadDays) > 30) return json(res, 400, { error: 'Số ngày dự phòng phải từ 1 đến 30.' });
    if (!Number.isInteger(Number(next.maxScriptsPerDay)) || Number(next.maxScriptsPerDay) < 1 || Number(next.maxScriptsPerDay) > 30) return json(res, 400, { error: 'Giới hạn kịch bản phải từ 1 đến 30 mỗi ngày.' });
    try { new Intl.DateTimeFormat('en-US', { timeZone: next.timezone }); } catch { return json(res, 400, { error: 'Múi giờ không hợp lệ.' }); }
    if (!/^[\w-]{2,100}$/.test(String(next.viVoice)) || !/^[\w-]{2,100}$/.test(String(next.enVoice))) return json(res, 400, { error: 'Tên giọng đọc không hợp lệ.' });
    if (!/^[+-]\d{1,3}%$/.test(String(next.enRate))) return json(res, 400, { error: 'Tốc độ giọng tiếng Anh phải có dạng -8% hoặc +0%.' });
    if (!['edge', 'vieneu'].includes(next.ttsProvider)) return json(res, 400, { error: 'Chế độ TTS phải là Microsoft Edge TTS hoặc Local AI TTS.' });
    if (!VIENEU_VOICES.includes(String(next.vieneuViVoice)) || !VIENEU_VOICES.includes(String(next.vieneuEnVoice))) return json(res, 400, { error: 'Giọng VieNeu không nằm trong danh sách được hỗ trợ.' });
    if (!Number.isFinite(Number(next.vieneuViSpeed)) || Number(next.vieneuViSpeed) < 0.75 || Number(next.vieneuViSpeed) > 1.25) return json(res, 400, { error: 'Tốc độ VieNeu tiếng Việt phải từ 0,75x đến 1,25x.' });
    if (!Number.isFinite(Number(next.vieneuEnSpeed)) || Number(next.vieneuEnSpeed) < 0.5 || Number(next.vieneuEnSpeed) > 1.25) return json(res, 400, { error: 'Tốc độ VieNeu tiếng Anh phải từ 0,5x đến 1,25x.' });
    if (!KOKORO_VOICES.some((voice) => voice.id === String(next.kokoroEnVoice))) return json(res, 400, { error: 'Giọng Kokoro tiếng Anh không nằm trong danh sách model.' });
    if (!Number.isFinite(Number(next.kokoroEnSpeed)) || Number(next.kokoroEnSpeed) < 0.5 || Number(next.kokoroEnSpeed) > 1.25) return json(res, 400, { error: 'Tốc độ Kokoro tiếng Anh phải từ 0,5x đến 1,25x.' });
    if (!Number.isInteger(Number(next.localTtsMinFreeRamMb)) || Number(next.localTtsMinFreeRamMb) < 512 || Number(next.localTtsMinFreeRamMb) > 65536) return json(res, 400, { error: 'Ngưỡng RAM trống trước khi nạp phải từ 512 đến 65536 MB.' });
    if (!Number.isInteger(Number(next.localTtsMinRemainingRamMb)) || Number(next.localTtsMinRemainingRamMb) < 256 || Number(next.localTtsMinRemainingRamMb) > 32768) return json(res, 400, { error: 'Ngưỡng RAM dự trữ sau khi nạp phải từ 256 đến 32768 MB.' });
    if (typeof next.highlightEnabled !== 'boolean') return json(res, 400, { error: 'Trạng thái highlight không hợp lệ.' });
    if (!['word', 'phrase'].includes(next.highlightMode)) return json(res, 400, { error: 'Kiểu highlight phải là từng từ hoặc từng cụm từ.' });
    if (!/^#[0-9a-f]{6}$/i.test(String(next.highlightColor))) return json(res, 400, { error: 'Màu highlight phải là mã hex 6 ký tự.' });
    if (!Number.isInteger(Number(next.highlightPadding)) || Number(next.highlightPadding) < 0 || Number(next.highlightPadding) > 24) return json(res, 400, { error: 'Padding highlight phải từ 0 đến 24 px.' });
    if (!Number.isInteger(Number(next.highlightRadius)) || Number(next.highlightRadius) < 0 || Number(next.highlightRadius) > 32) return json(res, 400, { error: 'Bo góc highlight phải từ 0 đến 32 px.' });
    if (body.highlightTransition !== undefined && body.highlightTransition !== 'instant') return json(res, 400, { error: 'Highlight chuyển tức thời để khớp thời điểm đọc.' });
    if (!BACKGROUND_EFFECTS.some((effect) => effect.id === String(next.backgroundEffect))) return json(res, 400, { error: 'Hiệu ứng nền không nằm trong danh sách hỗ trợ.' });
    if (!Number.isInteger(Number(next.backgroundEffectDensity)) || Number(next.backgroundEffectDensity) < 10 || Number(next.backgroundEffectDensity) > 60) return json(res, 400, { error: 'Mật độ hiệu ứng phải là số nguyên từ 10 đến 60.' });
    if (!Number.isInteger(Number(next.backgroundEffectSpeed)) || Number(next.backgroundEffectSpeed) < 25 || Number(next.backgroundEffectSpeed) > 140) return json(res, 400, { error: 'Tốc độ trôi phải là số nguyên từ 25 đến 140.' });
    if (!['mock', 'meta'].includes(next.facebookAdapter)) return json(res, 400, { error: 'Facebook adapter phải là Mock hoặc Meta Graph API.' });
    if (body.autoGenerationEnabled === true && !chatgptStatus().connected) return json(res, 409, { error: 'Hãy kết nối ChatGPT Plan trước khi bật tự tạo.' });
    if (!Number.isInteger(Number(next.backgroundEffectOpacity)) || Number(next.backgroundEffectOpacity) < 10 || Number(next.backgroundEffectOpacity) > 70) return json(res, 400, { error: 'Độ rõ hiệu ứng phải là số nguyên từ 10 đến 70.' });
    const patch = { ...body, ...(migrateRemovedBackgroundEffect ? { backgroundEffect: 'bubbles' } : {}) };
    const currentSettings = getSettings();
    const facebookModeChanged = body.facebookAdapter && body.facebookAdapter !== currentSettings.facebookAdapter;
    if (body.autoPublishEnabled === true && next.facebookAdapter === 'meta' && !facebookModeChanged && !currentSettings.facebookConnectionVerified) return json(res, 409, { error: 'Hãy kiểm tra Page và token thành công trước khi bật đăng live.' });
    if (facebookModeChanged) { patch.facebookConnectionVerified = false; patch.autoPublishEnabled = false; }
    for (const key of ['allowPaidAiApi', 'facebookConnectionVerified', 'pageId', 'appName', 'host', 'port', 'timezone', 'videoWidth', 'videoHeight', 'videoFps', 'template']) delete patch[key];
    const saved = saveSettings(patch);
    log('INFO', 'SETTINGS_SAVED', 'Đã lưu cài đặt ứng dụng.');
    return json(res, 200, { ...saved, allowPaidAiApi: false, facebookTokenSaved: facebookTokenSaved(), chatgpt: chatgptStatus() });
  }
  if (route === 'GET /api/topics') return json(res, 200, { topics: listTopics(), count: listTopics().length });
  if (route === 'POST /api/topics') {
    const body = await readJson(req);
    try { const topic = addTopic(body.category, body.title); log('INFO', 'TOPIC_ADDED', `Đã thêm chủ đề ${topic.title}.`); return json(res, 201, { topic }); }
    catch (error) { return json(res, 400, { error: /UNIQUE constraint failed/i.test(error.message) ? 'Chủ đề này đã có trong thư viện.' : error.message }); }
  }
  if (route === 'GET /api/videos') return json(res, 200, { videos: attachVideoProgress(listVideos()) });
  const deleteVideoMatch = url.pathname.match(/^\/api\/videos\/([\w-]+)$/);
  if (req.method === 'DELETE' && deleteVideoMatch) {
    let video;
    try { video = deleteVideo(deleteVideoMatch[1]); }
    catch (error) { return json(res, error.statusCode || 500, { error: error.message }); }
    if (!video) return json(res, 404, { error: 'Không tìm thấy video.' });
    const outputDir = path.resolve(PATHS.output, video.id);
    if (path.dirname(outputDir) === path.resolve(PATHS.output)) {
      try { fs.rmSync(outputDir, { recursive: true, force: true }); }
      catch (error) { log('WARN', 'VIDEO_FILES_DELETE_FAILED', `Không xóa được tệp video ${video.id}: ${error.message}`); }
    }
    const temporaryDir = path.resolve(PATHS.temporary, video.id);
    if (path.dirname(temporaryDir) === path.resolve(PATHS.temporary)) {
      try { fs.rmSync(temporaryDir, { recursive: true, force: true }); }
      catch (error) { log('WARN', 'VIDEO_TEMP_DELETE_FAILED', `Không xóa được tệp tạm ${video.id}: ${error.message}`); }
    }
    log('INFO', 'VIDEO_DELETED', `Đã xóa video ${video.topic} khỏi thư viện.`);
    return json(res, 200, { deleted: true, videoId: video.id });
  }
  if (route === 'GET /api/jobs') return json(res, 200, { jobs: listJobs() });
  if (route === 'GET /api/schedules') return json(res, 200, { schedules: listSchedules(), published: listPublishedSchedules() });
  const publishedScheduleMatch = url.pathname.match(/^\/api\/published-posts\/([\w-]+)$/);
  if (req.method === 'DELETE' && publishedScheduleMatch) {
    const deleted = deletePublishedSchedule(publishedScheduleMatch[1]);
    return deleted ? json(res, 200, { deleted: true, id: publishedScheduleMatch[1] }) : json(res, 404, { error: 'KhÃ´ng tÃ¬m tháº¥y thÃ´ng tin bÃ i Ä‘Ã£ Ä‘Äƒng.' });
  }
  if (route === 'GET /api/publish-history') return json(res, 200, { history: listPublishHistory() });
  if (route === 'GET /api/logs') return json(res, 200, { logs: db.prepare('SELECT level,code,message,job_id,created_at FROM logs ORDER BY id DESC LIMIT 100').all() });
  if (route === 'DELETE /api/logs') {
    const count = db.prepare('SELECT COUNT(*) AS count FROM logs').get().count;
    db.prepare('DELETE FROM logs').run();
    return json(res, 200, { deleted: count });
  }
  if (route === 'GET /api/logs/export') {
    const lines = db.prepare('SELECT level,code,message,job_id,created_at FROM logs ORDER BY id').all();
    const safe = lines.map((item) => ({ ...item, message: item.message.replace(/(access_token|refresh_token|Authorization)\s*[:=]\s*[^\s,&]+/gi, '$1=[ẩn]') }));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="auto-english-reels-logs.json"' });
    res.end(JSON.stringify(safe, null, 2)); return;
  }
  if (route === 'GET /api/chatgpt/connect') {
    res.writeHead(302, { location: beginChatGPTSignIn(), 'cache-control': 'no-store' }); res.end(); return;
  }
  if (route === 'GET /api/chatgpt/status') return json(res, 200, chatgptStatus());
  if (route === 'POST /api/chatgpt/disconnect') { const result = await disconnectChatGPT(); return json(res, 200, { connected: false, ...result }); }
  if (route === 'GET /auth/callback') {
    try {
      const result = await completeChatGPTSignIn(url);
      log('INFO', 'CHATGPT_CONNECTED', 'Đã xác minh kết nối ChatGPT plan.');
      html(res, 200, `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Kết nối hoàn tất</title><style>body{font:16px system-ui;background:#f5f1e9;color:#263344;padding:48px;max-width:680px;margin:auto}main{background:#fff;border-radius:24px;padding:32px}a{color:#315b50}</style><main><h1>Đã kết nối ChatGPT</h1><p>Tài khoản ${escapeHtml(result.email || '')} đã xác minh quyền dùng ChatGPT plan.</p><a href="/">Quay lại Auto English Reels Studio</a></main></html>`);
    } catch (error) {
      log('WARN', 'CHATGPT_CONNECT_FAILED', error.message);
      html(res, 400, `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Kết nối chưa xong</title><style>body{font:16px system-ui;background:#f5f1e9;color:#263344;padding:48px;max-width:680px;margin:auto}main{background:#fff;border-radius:24px;padding:32px}a{color:#315b50}</style><main><h1>Chưa kết nối được</h1><p>${escapeHtml(error.message)}</p><a href="/">Quay lại cài đặt</a></main></html>`);
    }
    return;
  }
  if (route === 'POST /api/facebook/credentials') {
    const body = await readJson(req);
    if (!/^\d{5,}$/.test(String(body.pageId || ''))) return json(res, 400, { error: 'Facebook Page ID phải gồm ít nhất 5 chữ số.' });
    if (body.pageToken?.trim()) {
      try { saveFacebookToken(body.pageToken); }
      catch (error) { return json(res, 400, { error: error.message }); }
    } else if (!facebookTokenSaved()) return json(res, 400, { error: 'Nhập Page Access Token trước khi lưu lần đầu.' });
    saveSettings({ pageId: String(body.pageId), facebookConnectionVerified: false, autoPublishEnabled: false });
    log('INFO', 'FACEBOOK_CREDENTIALS_SAVED', 'Đã lưu Facebook Page ID và token cục bộ; giá trị bí mật không được ghi vào log.');
    return json(res, 200, { saved: true, pageId: String(body.pageId), tokenSaved: true, connectionVerified: false });
  }
  if (route === 'POST /api/facebook/test') {
    const settings = getSettings();
    try {
      const result = settings.facebookAdapter === 'mock'
        ? await new MockFacebookAdapter().checkConnection()
        : await new MetaGraphAdapter(settings.pageId).checkConnection();
      if (settings.facebookAdapter === 'meta') saveSettings({ facebookConnectionVerified: true });
      log('INFO', 'FACEBOOK_CONNECTION_OK', `Kết nối ${result.pageName} qua ${result.adapter}.`);
      return json(res, 200, result);
    } catch (error) {
      saveSettings({ facebookConnectionVerified: false, autoPublishEnabled: false });
      log('WARN', 'FACEBOOK_CONNECTION_FAILED', error.message);
      return json(res, 400, { connected: false, error: error.message });
    }
  }
  if (route === 'POST /api/tts/preview') {
    const body = await readJson(req);
    const text = String(body.text || '').trim();
    const language = normalizeLanguage(body.language === 'en' ? 'en' : 'vi');
    const settings = getSettings();
    if (!text || text.length > 2000) return json(res, 400, { error: 'Câu nghe thử phải có từ 1 đến 2000 ký tự.' });
    if (body.highlightMode !== undefined && !['word', 'phrase'].includes(body.highlightMode)) return json(res, 400, { error: 'Kiểu highlight preview không hợp lệ.' });
    const ttsProvider = body.ttsProvider || settings.ttsProvider;
    if (!['edge', 'vieneu'].includes(ttsProvider)) return json(res, 400, { error: 'Chế độ TTS không hợp lệ.' });
    const configuredVoice = ttsProvider === 'vieneu'
      ? (language === 'vi' ? settings.vieneuViVoice : settings.kokoroEnVoice)
      : (language === 'vi' ? settings.viVoice : settings.enVoice);
    const voice = String(body.voice || configuredVoice).trim();
    const localVoiceValid = language === 'vi' ? VIENEU_VOICES.includes(voice) : KOKORO_VOICES.some((item) => item.id === voice);
    if (ttsProvider === 'vieneu' ? !localVoiceValid : !/^[a-z]{2,3}-[A-Z]{2,4}-[\w-]{2,100}$/.test(voice)) return json(res, 400, { error: ttsProvider === 'vieneu' ? `Giọng Local AI tiếng ${language === 'vi' ? 'Việt' : 'Anh'} không hợp lệ.` : 'Tên giọng Edge TTS không hợp lệ.' });
    const speed = Number(body.speed ?? (language === 'vi' ? settings.vieneuViSpeed : settings.kokoroEnSpeed));
    if (ttsProvider === 'vieneu' && (!Number.isFinite(speed) || speed < (language === 'vi' ? 0.75 : 0.5) || speed > 1.25)) return json(res, 400, { error: 'Tốc độ nghe thử nằm ngoài giới hạn model.' });
    const rate = String(body.rate ?? (language === 'vi' ? '+0%' : settings.enRate));
    if (ttsProvider === 'edge' && !/^[+-]\d{1,3}%$/.test(rate)) return json(res, 400, { error: 'Tốc độ Edge TTS phải có dạng -8% hoặc +0%.' });
    const id = crypto.randomUUID();
    const speechText = prepareSpeechText(text, language);
    const output = path.join(PATHS.temporary, 'voice-previews', `${id}.${ttsProvider === 'vieneu' ? 'wav' : 'mp3'}`);
    const wordTimingsPath = body.withWordBoundaries === true ? `${output}.wordtimings.json` : null;
    try {
      if (ttsProvider === 'vieneu') {
        const timingPath = `${output}.wordtimings.json`;
        if (language === 'vi') {
          await withLocalTtsModel('VieNeu-TTS v3 Turbo', (lease) => synthesizeVieNeuPreview({
            text, language, voice, speed, outputPath: output, timingPath, settings,
            onProgress: (kind, value = {}) => {
              if (kind === 'VIENEU_WORKER') lease.update({ phase: 'vieneu-worker-started', workerPid: value.pid, workerExited: false });
              else if (kind === 'VIENEU_WORKER_EXITED') lease.update({ phase: 'vieneu-worker-exited', workerPid: null, workerExited: true, memoryAfter: { systemRamAvailableMb: value.availableRamMb } });
              else if (kind === 'VIENEU_MEMORY') lease.update({ phase: `vieneu-${value.phase}`, workerMemory: value });
            }
          }));
        } else {
          await withLocalTtsModel('Kokoro TTS', (lease) => synthesizeKokoroPreview({ text: speechText, language, voice, speed, outputPath: output, timingPath, settings, lease }));
        }
        if (!wordTimingsPath) fs.rmSync(`${output}.wordtimings.json`, { force: true });
      } else {
        await synthesizeSpeech(speechText, voice, rate, output, { wordTimingsPath, language });
      }
      if (!wordTimingsPath) return json(res, 200, { url: `/api/tts-preview/${id}`, language, voice });
      const timingData = JSON.parse(fs.readFileSync(wordTimingsPath, 'utf8'));
      let mapped = mapWordBoundariesToTokens(text, timingData.wordBoundaries, `preview-${id}`, { language });
      let alignmentSource = timingData.source || (timingData.wordBoundaries.length ? (ttsProvider === 'edge' ? 'edge-word-boundary' : language === 'en' ? 'kokoro-word-boundary' : 'vieneu-word-boundary') : null);
      let warning = timingData.warning || null;
      if (!mapped.alignment.reliable) {
        const local = await alignSpeechLocally(output, speechText, language);
        if (local.wordBoundaries.length) {
          const localMapped = mapWordBoundariesToTokens(text, local.wordBoundaries, `preview-${id}`, { language });
          if (localMapped.alignment.mappedTokenCount > mapped.alignment.mappedTokenCount) {
            mapped = localMapped;
            alignmentSource = local.source || 'stable-ts-local';
            warning = localMapped.alignment.reliable ? null : local.warning || `Còn ${localMapped.alignment.unmatchedTokenCount} từ chưa căn chỉnh.`;
          } else {
            warning = `${local.warning || 'Local forced alignment không khớp đầy đủ với văn bản.'} Còn ${localMapped.alignment.unmatchedTokenCount} từ chưa căn chỉnh.`;
          }
        } else {
          warning = [warning, local.warning].filter(Boolean).join(' ');
        }
      }
      const highlightMode = body.highlightMode || settings.highlightMode;
      const highlightIntervals = buildHighlightIntervals(mapped.wordTimings, highlightMode);
      return json(res, 200, {
        url: `/api/tts-preview/${id}`, language, voice, provider: ttsProvider,
        tokens: mapped.tokens,
        wordTimings: mapped.wordTimings,
        highlightIntervals,
        highlightMode,
        alignment: mapped.alignment,
        alignmentSource,
        warning
      });
    } catch (error) {
      fs.rmSync(output, { force: true });
      fs.rmSync(`${output}.wordtimings.json`, { force: true });
      return json(res, 503, { error: error.message });
    }
  }
  if (route === 'POST /api/facebook/clear-token') {
    clearFacebookToken(); saveSettings({ facebookConnectionVerified: false, autoPublishEnabled: false });
    return json(res, 200, { tokenSaved: false });
  }
  if (route === 'POST /api/generate') {
    const body = await readJson(req);
    if (body.topicId && !db.prepare('SELECT id FROM topics WHERE id=?').get(body.topicId)) return json(res, 400, { error: 'Chủ đề không tồn tại.' });
    const system = await systemStatus();
    const blockers = [];
    if (!system.worker) blockers.push('Worker nền đang ngoại tuyến. Hãy khởi động worker để xử lý video.');
    if (!system.tools.ffmpeg || !system.tools.ffprobe) {
      const errors = system.tools.errors;
      const spawnDenied = [errors.ffmpeg, errors.ffprobe].some((code) => code === 'EPERM' || code === 'EACCES');
      blockers.push(spawnDenied
        ? 'Windows hoặc môi trường chạy ứng dụng đang từ chối tạo tiến trình FFmpeg/FFprobe (EPERM); đây không phải lỗi thiếu PATH. Hãy khởi động ứng dụng từ start.bat trong phiên Windows thông thường.'
        : 'Không tìm thấy hoặc không chạy được FFmpeg/FFprobe; hãy cài FFmpeg đầy đủ hoặc thêm thư mục chứa cả hai vào PATH.');
    }
    if (blockers.length) return json(res, 503, { error: blockers.join(' ') });
    const activeJob = db.prepare("SELECT id FROM jobs WHERE type='create_video' AND status IN ('pending','running') ORDER BY created_at DESC LIMIT 1").get();
    if (activeJob) return json(res, 409, { error: `Đang có video chờ xử lý (${activeJob.id}); chờ job hiện tại xong rồi hãy tạo tiếp.` });
    const id = queueJob('create_video', { topicId: body.topicId || null, allowLocalTemplate: body.allowLocalTemplate === true });
    log('INFO', 'VIDEO_JOB_QUEUED', 'Đã thêm yêu cầu tạo video vào hàng đợi.', id);
    return json(res, 202, { jobId: id, status: 'pending' });
  }
  const scheduleMatch = url.pathname.match(/^\/api\/videos\/([\w-]+)\/schedule$/);
  if (req.method === 'POST' && scheduleMatch) {
    const body = await readJson(req);
    const settings = getSettings();
    const when = zonedLocalToDate(body.scheduledAt, settings.timezone);
    if (!Number.isFinite(when.getTime()) || when <= new Date()) return json(res, 400, { error: 'Thời điểm đăng phải ở tương lai.' });
    if (settings.facebookAdapter === 'meta' && settings.autoPublishEnabled && when.getTime() < Date.now() + 15 * 60_000) {
      return json(res, 400, { error: 'Facebook cần nhận lịch đăng trước ít nhất 15 phút. Hãy chọn giờ muộn hơn.' });
    }
    try {
      const schedule = createSchedule(scheduleMatch[1], when.toISOString());
      let facebookScheduleState = 'local';
      if (settings.facebookAdapter === 'meta' && settings.autoPublishEnabled && settings.facebookConnectionVerified) {
        const queued = queueFacebookSchedule(schedule.id);
        if (queued) facebookScheduleState = 'queued';
      }
      log('INFO', 'POST_SCHEDULED', `Đã lên lịch đăng video vào ${when.toISOString()}.`);
      return json(res, 201, { ...schedule, facebookScheduleState });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  const approveMatch = url.pathname.match(/^\/api\/videos\/([\w-]+)\/approve$/);
  if (req.method === 'POST' && approveMatch) {
    const settings = getSettings();
    try {
      const schedule = approveVideoAndCreateRandomSchedule(approveMatch[1], settings.timezone, settings.postsPerDay);
      let facebookScheduleState = schedule.facebookScheduleState || 'local';
      if (settings.facebookAdapter === 'meta' && settings.autoPublishEnabled && settings.facebookConnectionVerified && facebookScheduleState === 'local') {
        const queued = queueFacebookSchedule(schedule.id);
        if (queued) facebookScheduleState = 'queued';
      }
      log('INFO', 'VIDEO_APPROVED', `Video ${approveMatch[1]} approved and scheduled for ${schedule.scheduledAt}.`);
      return json(res, 201, { ...schedule, facebookScheduleState });
    } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
  }
  const scriptMatch = url.pathname.match(/^\/api\/scripts\/([\w-]+)$/);
  if (req.method === 'GET' && scriptMatch) {
    const script = getScript(scriptMatch[1]);
    return script ? json(res, 200, { script }) : json(res, 404, { error: 'Không tìm thấy kịch bản.' });
  }
  const publishMatch = url.pathname.match(/^\/api\/videos\/([\w-]+)\/publish$/);
  if (req.method === 'POST' && publishMatch) {
    const body = await readJson(req);
    const settings = getSettings();
    if (settings.facebookAdapter === 'meta' && (!body.confirmLive || !settings.facebookConnectionVerified)) return json(res, 409, { error: 'Đăng live cần xác nhận rõ ràng và kiểm tra Page thành công.' });
    const video = db.prepare('SELECT id,status,last_error FROM videos WHERE id=?').get(publishMatch[1]);
    const facebookSchedule = db.prepare('SELECT facebook_schedule_state FROM scheduled_posts WHERE video_id=?').get(publishMatch[1]);
    if (['queued', 'uploading', 'finishing', 'scheduled', 'uncertain'].includes(facebookSchedule?.facebook_schedule_state)) {
      return json(res, 409, { error: 'Video này đã hoặc đang được lên lịch trên Facebook. Hãy kiểm tra Facebook Planner trước khi đăng ngay để tránh tạo bài trùng.' });
    }
    const retryFailedPublish = video?.status === 'publish_failed';
    const retryablePermissionFailure = video?.status === 'publish_failed' && isDefinitePagePermissionFailure(video.last_error);
    if (!video || (!['ready', 'scheduled'].includes(video.status) && !retryFailedPublish)) return json(res, 409, { error: 'Video chưa sẵn sàng để đăng.' });
    const activePublishJob = db.prepare("SELECT payload_json FROM jobs WHERE type='publish_video' AND status IN ('pending','running')")
      .all().some(({ payload_json }) => {
        try { return JSON.parse(payload_json).videoId === video.id; } catch { return false; }
      });
    if (activePublishJob) return json(res, 409, { error: 'Yêu cầu đăng video này đang chờ hoặc đang được xử lý.' });
    const lastPublishAttempt = retryFailedPublish ? db.prepare('SELECT status,error FROM publish_history WHERE video_id=? ORDER BY created_at DESC LIMIT 1').get(video.id) : null;
    const uncertainPublish = retryFailedPublish && lastPublishAttempt?.status === 'uncertain' && !isDefinitePagePermissionFailure(lastPublishAttempt.error);
    if (uncertainPublish && body.confirmRetryUncertain !== true) return json(res, 409, { error: 'Lần đăng trước chưa xác minh được kết quả. Hãy xác nhận có thể tạo bài trùng trước khi đăng lại.' });
    if (retryablePermissionFailure) releaseDefinitePagePermissionFailure(video.id);
    else if (uncertainPublish) db.prepare("UPDATE publish_history SET status='failed' WHERE video_id=? AND status='uncertain'").run(video.id);
    if (settings.facebookAdapter === 'meta' && !settings.autoPublishEnabled) {
      // A direct user action permits this single live publish without enabling future auto-publishing.
    }
    const id = queueJob('publish_video', { videoId: video.id, confirmLive: body.confirmLive === true });
    log('INFO', 'PUBLISH_JOB_QUEUED', `Đã đưa video vào hàng đợi đăng ${settings.facebookAdapter}.`, id);
    return json(res, 202, { jobId: id, status: 'pending' });
  }
  const fileMatch = url.pathname.match(/^\/api\/videos\/([\w-]+)\/(file|thumbnail)$/);
  if (req.method === 'GET' && fileMatch) {
    const video = db.prepare('SELECT video_path,thumbnail_path FROM videos WHERE id=?').get(fileMatch[1]);
    if (!video) return json(res, 404, { error: 'Không tìm thấy video.' });
    const filePath = safeOutputPath(fileMatch[2] === 'thumbnail' ? video.thumbnail_path : video.video_path);
    if (!filePath) return json(res, 404, { error: 'Tệp chưa được tạo.' });
    return serveFile(req, res, filePath);
  }
  const previewMatch = url.pathname.match(/^\/api\/tts-preview\/([\w-]+)$/);
  if (req.method === 'GET' && previewMatch) {
    const previewDir = path.join(PATHS.temporary, 'voice-previews');
    const mp3Path = path.join(previewDir, `${previewMatch[1]}.mp3`);
    const wavPath = path.join(previewDir, `${previewMatch[1]}.wav`);
    const filePath = fs.existsSync(mp3Path) ? mp3Path : wavPath;
    if (!fs.existsSync(filePath)) return json(res, 404, { error: 'Không tìm thấy bản thử giọng.' });
    res.writeHead(200, { 'content-type': filePath.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg', 'content-length': fs.statSync(filePath).size, 'cache-control': 'no-store' });
    fs.createReadStream(filePath).pipe(res); return;
  }
  const videoRetryMatch = url.pathname.match(/^\/api\/videos\/([\w-]+)\/retry$/);
  if (req.method === 'POST' && videoRetryMatch) {
    const video = db.prepare('SELECT id,script_id,status FROM videos WHERE id=?').get(videoRetryMatch[1]);
    if (!video) return json(res, 404, { error: 'Không tìm thấy video cần tạo lại.' });
    if (video.status !== 'failed') return json(res, 409, { error: 'Chỉ có thể tạo lại video đang ở trạng thái lỗi.' });

    const relatedJobs = db.prepare("SELECT id,status,payload_json FROM jobs WHERE type='create_video' ORDER BY created_at DESC").all()
      .map((job) => {
        try { return { ...job, payload: JSON.parse(job.payload_json) }; }
        catch { return { ...job, payload: {} }; }
      })
      .filter((job) => job.payload.videoId === video.id || job.payload.scriptId === video.script_id);
    const activeJob = relatedJobs.find((job) => ['pending', 'running'].includes(job.status));
    if (activeJob) return json(res, 409, { error: 'Video này đã có job đang chờ hoặc đang chạy.' });

    const failedJob = relatedJobs.find((job) => job.status === 'failed');
    let jobId;
    if (failedJob) {
      const stamp = new Date().toISOString();
      db.prepare("UPDATE jobs SET status='pending',attempts=0,last_error=NULL,scheduled_at=?,locked_by=NULL,updated_at=? WHERE id=? AND status='failed'")
        .run(stamp, stamp, failedJob.id);
      jobId = failedJob.id;
    } else {
      jobId = queueJob('create_video', { scriptId: video.script_id, videoId: video.id });
    }
    log('INFO', 'VIDEO_RETRY_QUEUED', `Đã xếp tạo lại video ${video.id} từ kịch bản đã lưu.`, jobId);
    return json(res, 202, { jobId, status: 'pending' });
  }
  const retryMatch = url.pathname.match(/^\/api\/jobs\/([\w-]+)\/retry$/);
  if (req.method === 'POST' && retryMatch) {
    const result = db.prepare("UPDATE jobs SET status='pending',attempts=0,last_error=NULL,scheduled_at=?,updated_at=? WHERE id=? AND status='failed'")
      .run(new Date().toISOString(), new Date().toISOString(), retryMatch[1]);
    if (Number(result.changes) !== 1) return json(res, 409, { error: 'Job không ở trạng thái lỗi để chạy lại.' });
    return json(res, 202, { jobId: retryMatch[1], status: 'pending' });
  }
  return json(res, 404, { error: 'Không tìm thấy API.' });
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }

const server = http.createServer(async (req, res) => {
  try {
    const host = String(req.headers.host || '').toLowerCase();
    if (host && !['127.0.0.1', 'localhost'].includes(host.split(':')[0]) && !host.startsWith('127.0.0.1:')) return json(res, 403, { error: 'Chỉ cho phép truy cập từ máy này.' });
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (url.pathname.startsWith('/api/') || url.pathname === '/auth/callback') return await handleApi(req, res, url);
    if (url.pathname === '/visual-editor') return serveFile(req, res, path.join(PATHS.public, 'visual-editor.html'));
    if (url.pathname === '/assets') return serveFile(req, res, path.join(PATHS.public, 'assets.html'));
    if (url.pathname.startsWith('/assets/branding/')) {
      let relative;
      try { relative = decodeURIComponent(url.pathname.slice('/assets/branding/'.length)); }
      catch { return json(res, 400, { error: 'Đường dẫn asset không hợp lệ.' }); }
      const absolute = path.resolve(BRANDING_DIR, relative);
      if (!absolute.startsWith(`${path.resolve(BRANDING_DIR)}${path.sep}`)) return json(res, 403, { error: 'Đường dẫn asset không hợp lệ.' });
      return serveFile(req, res, absolute);
    }
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const absolute = path.resolve(PATHS.public, relative);
    if (!absolute.startsWith(`${path.resolve(PATHS.public)}${path.sep}`)) return json(res, 403, { error: 'Đường dẫn không hợp lệ.' });
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return serveFile(req, res, absolute);
    return serveFile(req, res, path.join(PATHS.public, 'index.html'));
  } catch (error) {
    log('ERROR', 'HTTP_REQUEST_FAILED', error.message);
    if (!res.headersSent) json(res, error.statusCode || 500, { error: error.message || 'Lỗi máy chủ.' });
    else res.end();
  }
});

server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws' || !sameOrigin(req) || !['127.0.0.1', 'localhost'].includes(String(req.headers.host || '').split(':')[0]) || req.headers.upgrade?.toLowerCase() !== 'websocket' || !req.headers['sec-websocket-key']) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
  }
  const accept = crypto.createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  websocketClients.add(socket);
  socket.write(websocketFrame({ type: 'connection:ready', data: { port: PORT }, at: new Date().toISOString() }));
  socket.on('data', (data) => {
    if (data.length < 2) return;
    const opcode = data[0] & 0x0f;
    if (opcode === 8) { socket.end(websocketFrame('', 8)); websocketClients.delete(socket); }
    else if (opcode === 9) socket.write(websocketFrame(data.subarray(2), 10));
  });
  socket.on('close', () => websocketClients.delete(socket));
  socket.on('error', () => websocketClients.delete(socket));
});

server.listen(PORT, HOST, () => {
  log('INFO', 'SERVER_STARTED', `Ứng dụng chạy tại http://${HOST}:${PORT}.`);
  console.log(`Auto English Reels Studio: http://${HOST}:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
