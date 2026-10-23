import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, PORT, HOST, PATHS, PYTHON_BIN, FFMPEG_BIN, FFPROBE_BIN, COSYVOICE_REFERENCE_PATH, COSYVOICE_PROFILES_DIR } from './config.mjs';
import {
  db, getSettings, saveSettings, getOverview, listTopics, listVideos, listJobs,
  listPublishHistory, listSchedules, listPublishedSchedules, deletePublishedSchedule, deleteScheduleFromApp, queueJob, createSchedule, approveVideoAndCreateRandomSchedule, queueFacebookSchedule, completePublishedSchedule, log, getScript, updateVideo, addTopic, deleteVideo,
  listFacebookPageProfiles, getFacebookPageProfile, getFacebookPageForLanguage, facebookPageProfileLanguage, facebookPageProfileMatchesLanguage, facebookPageProfileHasActiveWork, saveFacebookPageProfile, setFacebookPageVerification, setFacebookPageRoute, clearFacebookPageRoute, getFacebookPageRoutes, deleteFacebookPageProfile,
  getEnglishShadowingSettings, saveEnglishShadowingSettings
} from './database/db.mjs';
import { providerStatus } from './ai/script-service.mjs';
import { beginChatGPTSignIn, completeChatGPTSignIn, chatgptStatus, disconnectChatGPT } from './ai/chatgpt-plan.mjs';
import { facebookTokenSaved, saveFacebookToken, clearFacebookToken, facebookPageTokenPath, MetaGraphAdapter } from '../packages/facebook-engine/meta-graph-adapter.mjs';
import { facebookPageHasSavedToken, verifyFacebookPageTarget } from './facebook/page-profile-resolver.mjs';
import { MockFacebookAdapter } from '../packages/facebook-engine/mock-adapter.mjs';
import { zonedLocalToDate } from './scheduler/time.mjs';
import { alignSpeechLocally } from './tts/local-alignment.mjs';
import { synthesizeVieNeuPreview, vieneuModelStatus, VIENEU_VOICES } from './tts/vieneu-tts.mjs';
import { KOKORO_VOICES, kokoroModelStatus, synthesizeKokoroPreview } from './tts/kokoro-tts.mjs';
import { getLocalTtsManagerStatus, withLocalTtsModel } from './tts/local-model-manager.mjs';
import { styleBertVits2Status, cosyVoice3Status, STYLE_BERT_VITS2_VOICES, synthesizeMultilingualSegments } from './tts/multilingual-local-tts.mjs';
import { SUPERTONIC_KOREAN_VOICES, supertonicKoreanStatus, synthesizeSupertonicKoreanPreview } from './tts/supertonic-korean-tts.mjs';
import { cancelCosyVoiceLibraryInstall, cosyVoiceLibraryStatus, deleteCosyVoiceLibraryProfile, isCosyVoiceLibraryId, renameCosyVoiceLibraryProfile, startCosyVoiceLibraryInstall } from './tts/cosyvoice-voice-library.mjs';
import { buildHighlightIntervals, mapWordBoundariesToTokens, normalizeLanguage, prepareSpeechText } from '../packages/audio-highlight/highlight-engine.mjs';
import { BRANDING_DIR, buildSceneSvg, rasterizeScene, readVisualTemplate, saveVisualTemplate, resetChineseVisualTemplate, resetJapaneseVisualTemplate, getDesignPrompts } from '../packages/video-engine/visual-template-engine.mjs';
import { BACKGROUND_EFFECTS, BACKGROUND_EFFECT_LANGUAGES, normalizeBackgroundEffectProfiles } from '../packages/video-engine/background-effects.mjs';
import { deleteAsset, listAssets, resetBrandAssets, saveUploadedAsset, setDefaultAsset } from '../packages/video-engine/asset-manager.mjs';
import { normalizeEnglishShadowingSettings } from './english-shadowing/settings.mjs';
import { buildEnglishShadowingVisualPreviewSvg } from './english-shadowing/renderer.mjs';

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

function latestPreviewScript(scriptId = '', contentLanguage = '') {
  if (scriptId) return getScript(scriptId) || null;
  const row = contentLanguage
    ? db.prepare('SELECT s.id AS script_id FROM scripts s JOIN videos v ON v.script_id=s.id WHERE s.content_language=? ORDER BY v.created_at DESC LIMIT 1').get(contentLanguage)
    : db.prepare("SELECT script_id FROM videos WHERE script_id IS NOT NULL ORDER BY created_at DESC LIMIT 1").get();
  return row ? getScript(row.script_id) : null;
}

function visualPreviewScript(contentLanguage = 'en', scriptId = '') {
  const existing = latestPreviewScript(scriptId, contentLanguage);
  if (existing) return existing;
  if (contentLanguage === 'ja') return {
    id: 'ja-visual-preview', contentLanguage: 'ja', presentationStyle: 'ja-en-v1-dialogue-cards',
    title: 'Gọi món ở nhà hàng Nhật', topic: 'Nhà hàng · A2–B1',
    dialogues: [{
      index: 1, vietnamese: 'Cho mình một suất cơm cá nướng với ít cơm.',
      japanese: '焼き魚の定食をお願いします。', romaji: 'Yakizakana no teishoku o onegaishimasu.',
      term: '焼き魚の定食', meaningVi: 'suất cơm cá nướng',
      vocabularyCards: [{ sourceVi: 'suất cơm cá nướng', term: '焼き魚の定食', meaningVi: 'suất cơm cá nướng' }]
    }], speechSegments: []
  };
  if (contentLanguage !== 'zh') return latestPreviewScript(scriptId, 'en') || undefined;
  return {
    id: 'zh-visual-preview', contentLanguage: 'zh', title: 'Làm quen bằng tiếng Trung', topic: 'Chào hỏi',
    dialogues: [{ index: 1, vietnamese: 'Xin chào, rất vui được gặp bạn.', chinese: '你好，很高兴认识你。', pinyin: 'Nǐ hǎo, hěn gāoxìng rènshi nǐ.', term: '很高兴', termPinyin: 'hěn gāoxìng', meaningVi: 'rất vui', noteVi: 'Dùng để thể hiện niềm vui khi làm quen hoặc gặp ai đó.' }],
    speechSegments: []
  };
}

const JAPANESE_VISUAL_PREVIEW_STYLES = new Set(['legacy', 'dialogue-cards', 'numbered-scenario', 'inline-meaning', 'inline-keyphrase']);
function japaneseVisualPreviewStyle(script, style) {
  if (script?.contentLanguage !== 'ja' || !JAPANESE_VISUAL_PREVIEW_STYLES.has(style)) return script;
  return { ...script, presentationStyle: `ja-en-v1-${style}` };
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
  const fallback = {
    backgroundEffect: settings.backgroundEffect,
    backgroundEffectDensity: settings.backgroundEffectDensity,
    backgroundEffectSpeed: settings.backgroundEffectSpeed,
    backgroundEffectOpacity: settings.backgroundEffectOpacity
  };
  settings.backgroundEffectProfiles = normalizeBackgroundEffectProfiles(settings.backgroundEffectProfiles, fallback);
  Object.assign(settings, settings.backgroundEffectProfiles.en);
  return { ...settings, allowPaidAiApi: false, facebookTokenSaved: facebookTokenSaved(), chatgpt: chatgptStatus() };
}

function validateBackgroundEffectProfiles(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Cấu hình hiệu ứng theo ngôn ngữ không hợp lệ.' };
  const profiles = {};
  const languageNames = { en: 'tiếng Anh', zh: 'tiếng Trung', ja: 'tiếng Nhật' };
  for (const language of BACKGROUND_EFFECT_LANGUAGES) {
    const profile = value[language];
    const label = languageNames[language];
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return { error: `Thiếu cấu hình hiệu ứng ${label}.` };
    if (!BACKGROUND_EFFECTS.some((effect) => effect.id === String(profile.backgroundEffect || ''))) return { error: `Hiệu ứng nền ${label} không nằm trong danh sách hỗ trợ.` };
    if (!Number.isInteger(Number(profile.backgroundEffectDensity)) || Number(profile.backgroundEffectDensity) < 10 || Number(profile.backgroundEffectDensity) > 60) return { error: `Mật độ hiệu ứng ${label} phải từ 10 đến 60.` };
    if (!Number.isInteger(Number(profile.backgroundEffectSpeed)) || Number(profile.backgroundEffectSpeed) < 25 || Number(profile.backgroundEffectSpeed) > 140) return { error: `Tốc độ hiệu ứng ${label} phải từ 25 đến 140.` };
    if (!Number.isInteger(Number(profile.backgroundEffectOpacity)) || Number(profile.backgroundEffectOpacity) < 10 || Number(profile.backgroundEffectOpacity) > 70) return { error: `Độ rõ hiệu ứng ${label} phải từ 10 đến 70.` };
    profiles[language] = {
      backgroundEffect: String(profile.backgroundEffect),
      backgroundEffectDensity: Number(profile.backgroundEffectDensity),
      backgroundEffectSpeed: Number(profile.backgroundEffectSpeed),
      backgroundEffectOpacity: Number(profile.backgroundEffectOpacity)
    };
  }
  return { profiles };
}

function hasVerifiedFacebookPageProfile() {
  return ['en', 'zh', 'ja'].some((language) => isFacebookPageReady(getFacebookPageForLanguage(language)));
}

function isFacebookPageReady(profile) {
  return Boolean(profile?.pageId && profile.connectionVerified && facebookTokenSaved(profile.tokenFile));
}

function contentLanguageForVideo(videoId) {
  return db.prepare('SELECT s.content_language FROM scripts s JOIN videos v ON v.script_id=s.id WHERE v.id=?').get(videoId)?.content_language || 'en';
}

function facebookPageForVideo(videoId, schedule = null) {
  const contentLanguage = contentLanguageForVideo(videoId);
  const profileId = schedule?.target_page_profile_id || schedule?.targetPageProfileId;
  if (profileId && !facebookPageProfileMatchesLanguage(profileId, contentLanguage)) return null;
  const profile = profileId ? getFacebookPageProfile(profileId) : getFacebookPageForLanguage(contentLanguage);
  return profile ? { ...profile, pageId: schedule?.target_page_id || schedule?.targetPageId || profile.pageId } : null;
}

function facebookPageLanguageMismatch(videoId, schedule = null) {
  const profileId = schedule?.target_page_profile_id || schedule?.targetPageProfileId;
  if (!profileId) return null;
  const contentLanguage = contentLanguageForVideo(videoId);
  const assignedLanguage = facebookPageProfileLanguage(profileId);
  if (assignedLanguage === contentLanguage) return null;
  return `Video ${contentLanguage.toUpperCase()} đang gắn với Page ${profileId} thuộc ${assignedLanguage?.toUpperCase() || 'ngôn ngữ chưa xác định'}. Hãy gán Page đúng ngôn ngữ rồi thử lại.`;
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
  const styleBertVits2 = styleBertVits2Status();
  const cosyVoice3 = cosyVoice3Status(settings);
  const supertonicKorean = supertonicKoreanStatus();
  const localTts = getLocalTtsManagerStatus();
  const [python, alignment, vieneuPython, kokoroPython, sbv2Python, cosyVoicePython, supertonicPython, ffmpeg, ffprobe] = await Promise.all([
    runCommand(PYTHON_BIN, ['--version'], 6000),
    runCommand(PYTHON_BIN, ['-c', "import importlib.util; print('yes' if importlib.util.find_spec('stable_whisper') else 'no')"], 6000),
    vieneu.installed ? runCommand(vieneu.python, ['--version'], 6000) : null,
    kokoro.installed ? runCommand(kokoro.python, ['--version'], 6000) : null,
    styleBertVits2.installed ? runCommand(styleBertVits2.python, ['-c', "from importlib.metadata import version; from packaging.version import Version; from transformers.utils import is_torch_available; import pkg_resources, pyopenjtalk; torch=Version(version('torch').split('+')[0]); torchaudio=Version(version('torchaudio').split('+')[0]); numpy=Version(version('numpy')); assert torch >= Version('2.6.0'); assert torchaudio == torch; assert numpy < Version('2'); assert is_torch_available()"], 6000) : null,
    cosyVoice3.installed ? runCommand(cosyVoice3.python, ['--version'], 6000) : null,
    supertonicKorean.installed ? runCommand(supertonicKorean.python, ['-c', "from importlib.metadata import version; import supertonic; assert version('supertonic') == '1.3.1'; print('ready')"], 6000) : null,
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
      vieneuTts: Boolean(vieneu.ready && vieneuPython && !vieneuPython.error && vieneuPython.status === 0),
      kokoroTts: Boolean(kokoro.ready && kokoroPython && !kokoroPython.error && kokoroPython.status === 0),
      styleBertVits2Tts: Boolean(styleBertVits2.ready && sbv2Python && !sbv2Python.error && sbv2Python.status === 0),
      cosyVoice3Tts: Boolean(cosyVoice3.ready && cosyVoicePython && !cosyVoicePython.error && cosyVoicePython.status === 0),
      supertonicKoreanTts: Boolean(supertonicKorean.ready && supertonicPython && !supertonicPython.error && supertonicPython.status === 0),
      localWordAlignment,
      errors: {
        python: python.error?.code || (python.status === 0 ? null : 'EXIT'),
        ffmpeg: ffmpeg.errorCode,
        ffprobe: ffprobe.errorCode,
        vieneuTts: vieneuPython?.error?.code || (vieneuPython && vieneuPython.status !== 0 ? 'EXIT' : null),
        kokoroTts: kokoroPython?.error?.code || (kokoroPython && kokoroPython.status !== 0 ? 'EXIT' : null),
        styleBertVits2Tts: sbv2Python?.error?.code || (sbv2Python && sbv2Python.status !== 0 ? 'EXIT' : null),
        cosyVoice3Tts: cosyVoicePython?.error?.code || (cosyVoicePython && cosyVoicePython.status !== 0 ? 'EXIT' : null),
        supertonicKoreanTts: supertonicPython?.error?.code || (supertonicPython && supertonicPython.status !== 0 ? 'EXIT' : null)
      }
    },
    vieneu,
    kokoro: { ...kokoro, voices: KOKORO_VOICES },
    styleBertVits2,
    cosyVoice3,
    supertonicKorean: { ...supertonicKorean, ready: Boolean(supertonicKorean.ready && supertonicPython && !supertonicPython.error && supertonicPython.status === 0) },
    localTts,
    aiReady: chatgpt.connected,
    liveFacebookReady: hasVerifiedFacebookPageProfile()
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

function hasReusableBackgroundEffectAudio(videoId) {
  try {
    const outputDir = path.resolve(PATHS.output, videoId);
    const audioManifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'audio-manifest.json'), 'utf8'));
    const renderManifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'render-manifest.json'), 'utf8'));
    if (!Array.isArray(audioManifest) || !audioManifest.length || !renderManifest?.highlightSettings || !renderManifest?.template?.canvas || !Array.isArray(renderManifest.template.layers)) return false;
    const tempDir = path.resolve(PATHS.temporary, videoId);
    return audioManifest.every((item) => {
      const audioPath = path.resolve(String(item.audioPath || ''));
      return Boolean(item.segmentId) && audioPath.startsWith(`${tempDir}${path.sep}`) && fs.existsSync(audioPath) && fs.statSync(audioPath).isFile();
    });
  } catch { return false; }
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
  if (route === 'GET /api/visual-template') {
    const requestedLanguage = url.searchParams.get('lang');
    const contentLanguage = ['zh', 'ja'].includes(requestedLanguage) ? requestedLanguage : 'en';
    return json(res, 200, { template: readVisualTemplate({ contentLanguage }), contentLanguage });
  }
  if (route === 'PUT /api/visual-template') {
    const requestedLanguage = url.searchParams.get('lang');
    const contentLanguage = ['zh', 'ja'].includes(requestedLanguage) ? requestedLanguage : 'en';
    const template = saveVisualTemplate(await readJson(req), { contentLanguage });
    broadcast('template:saved', { templateId: template.templateId, version: template.version, contentLanguage });
    return json(res, 200, { template });
  }
  if (route === 'POST /api/visual-template/reset') {
    if (url.searchParams.get('lang') === 'ja') {
      const template = resetJapaneseVisualTemplate();
      broadcast('template:saved', { templateId: template.templateId, version: template.version, contentLanguage: 'ja', reset: true });
      return json(res, 200, { template });
    }
    if (url.searchParams.get('lang') === 'zh') {
      const template = resetChineseVisualTemplate();
      broadcast('template:saved', { templateId: template.templateId, version: template.version, contentLanguage: 'zh', reset: true });
      return json(res, 200, { template });
    }
    const result = resetBrandAssets();
    broadcast('template:saved', { templateId: result.template.templateId, version: result.template.version, reset: true });
    broadcast('asset:updated', { reset: true });
    return json(res, 200, result);
  }
  if (route === 'GET /api/visual-template/preview.svg' || route === 'GET /api/visual-template/preview.png') {
    const state = url.searchParams.get('state') || 'vietnamese';
    const requestedLanguage = url.searchParams.get('lang');
    const contentLanguage = ['zh', 'ja'].includes(requestedLanguage) ? requestedLanguage : 'en';
    const effectLanguage = BACKGROUND_EFFECT_LANGUAGES.includes(requestedLanguage) ? requestedLanguage : contentLanguage;
    const index = contentLanguage === 'zh' ? 0 : Math.max(0, Math.min(2, Number(url.searchParams.get('index') || 0)));
    let script = visualPreviewScript(contentLanguage, url.searchParams.get('scriptId') || '');
    if (contentLanguage === 'ja') script = japaneseVisualPreviewStyle(script, url.searchParams.get('jaStyle'));
    const template = readVisualTemplate({ contentLanguage });
    const settings = getSettings();
    const backgroundEffectConfig = normalizeBackgroundEffectProfiles(settings.backgroundEffectProfiles, settings)[effectLanguage];
    const { backgroundEffect, backgroundEffectDensity, backgroundEffectSpeed, backgroundEffectOpacity } = backgroundEffectConfig;
    const highlightSettings = contentLanguage === 'ja' ? { ...settings, highlightEnabled: settings.japaneseHighlightEnabled === true } : undefined;
    if (route.endsWith('.svg')) return sendBuffer(res, 200, 'image/svg+xml; charset=utf-8', Buffer.from(await buildSceneSvg({ template, script, state, index, embedAssets: false, backgroundEffect, backgroundEffectDensity, backgroundEffectSpeed, backgroundEffectOpacity, effectSeed: script?.id || state, ...(highlightSettings ? { highlightSettings } : {}) })));
    return sendBuffer(res, 200, 'image/png', await rasterizeScene({ template, script, state, index, backgroundEffect, backgroundEffectDensity, backgroundEffectSpeed, backgroundEffectOpacity, effectSeed: script?.id || state, ...(highlightSettings ? { highlightSettings } : {}) }));
  }
  if (route === 'POST /api/visual-template/render-test') {
    const body = await readJson(req, 100_000);
    const id = crypto.randomUUID();
    const imagePath = path.join(PATHS.temporary, 'visual-previews', `${id}.png`);
    const videoPath = path.join(PATHS.temporary, 'visual-previews', `${id}.mp4`);
    const settings = getSettings();
    const contentLanguage = ['zh', 'ja'].includes(body.contentLanguage) ? body.contentLanguage : 'en';
    const effectLanguage = BACKGROUND_EFFECT_LANGUAGES.includes(body.contentLanguage) ? body.contentLanguage : contentLanguage;
    const backgroundEffectConfig = normalizeBackgroundEffectProfiles(settings.backgroundEffectProfiles, settings)[effectLanguage];
    const template = readVisualTemplate({ contentLanguage });
    const highlightSettings = contentLanguage === 'ja' ? { ...settings, highlightEnabled: settings.japaneseHighlightEnabled === true } : undefined;
    const previewScript = contentLanguage === 'ja'
      ? japaneseVisualPreviewStyle(visualPreviewScript(contentLanguage, body.scriptId || ''), body.jaStyle)
      : visualPreviewScript(contentLanguage, body.scriptId || '');
    await rasterizeScene({ template, state: body.state || 'bilingual', index: contentLanguage === 'zh' ? 0 : Number(body.index || 0), script: previewScript, outputPath: imagePath, ...backgroundEffectConfig, effectSeed: id, ...(highlightSettings ? { highlightSettings } : {}) });
    const jobId = queueJob('render_preview', { previewId: id, imagePath, videoPath, seconds: 5 });
    log('INFO', 'PREVIEW_RENDER_QUEUED', `Đã xếp render thử scene ${body.state || 'bilingual'}.`, jobId);
    return json(res, 202, { id, jobId, status: 'pending', url: `/api/visual-template/test-video/${id}` });
  }
  if (route === 'POST /api/visual-template/render-full') {
    const body = await readJson(req, 100_000);
    const contentLanguage = ['zh', 'ja'].includes(body.contentLanguage) ? body.contentLanguage : 'en';
    const script = body.scriptId ? latestPreviewScript(body.scriptId, contentLanguage) : latestPreviewScript('', contentLanguage);
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
  if (route === 'GET /api/english-shadowing/settings') return json(res, 200, { settings: getEnglishShadowingSettings(), voices: KOKORO_VOICES });
  if (route === 'GET /api/english-shadowing/visual-preview.svg') {
    res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    return res.end(await buildEnglishShadowingVisualPreviewSvg(getEnglishShadowingSettings()));
  }
  if (route === 'GET /api/facebook/pages') {
    const legacy = getFacebookPageProfile('legacy');
    const profiles = [
      ...(legacy ? [{ id: legacy.id, label: legacy.label, pageId: legacy.pageId, pageName: null, connectionVerified: legacy.connectionVerified, tokenSaved: facebookTokenSaved(legacy.tokenFile), contentLanguage: facebookPageProfileLanguage(legacy.id), legacy: true }] : []),
      ...listFacebookPageProfiles().map((item) => {
        const profile = getFacebookPageProfile(item.id);
        return { id: item.id, label: item.label, pageId: item.page_id, pageName: item.page_name, connectionVerified: Boolean(item.connection_verified), tokenSaved: Boolean(profile && facebookTokenSaved(profile.tokenFile)), contentLanguage: facebookPageProfileLanguage(item.id), legacy: false };
      })
    ];
    return json(res, 200, { profiles, routes: getFacebookPageRoutes(), legacyLanguage: facebookPageProfileLanguage('legacy') });
  }
  if (route === 'POST /api/facebook/pages') {
    const body = await readJson(req);
    const pageId = String(body.pageId || '').trim();
    const label = String(body.label || '').trim();
    if (!/^\d{5,}$/u.test(pageId)) return json(res, 400, { error: 'Facebook Page ID phải gồm ít nhất 5 chữ số.' });
    if (!label || label.length > 80) return json(res, 400, { error: 'Tên Page cần từ 1 đến 80 ký tự.' });
    const profileId = String(body.id || crypto.randomUUID());
    if (!/^[\w-]{8,80}$/u.test(profileId) || profileId === 'legacy') return json(res, 400, { error: 'Facebook Page profile ID không hợp lệ.' });
    let tokenFile;
    try { tokenFile = facebookPageTokenPath(profileId); }
    catch (error) { return json(res, 400, { error: error.message }); }
    const previous = getFacebookPageProfile(profileId);
    if (previous && previous.pageId !== pageId && facebookPageProfileHasActiveWork(profileId)) {
      return json(res, 409, { error: 'Không thể đổi Page ID khi còn lịch chưa hoàn tất đang sử dụng Page này.' });
    }
    const hasNewToken = Boolean(String(body.pageToken || '').trim());
    if (hasNewToken) {
      try { saveFacebookToken(body.pageToken, tokenFile); }
      catch (error) { return json(res, 400, { error: error.message }); }
    } else if (!previous || !facebookTokenSaved(tokenFile)) {
      return json(res, 400, { error: 'Nhập Page Access Token trước khi lưu Page lần đầu.' });
    }
    try {
      const profile = saveFacebookPageProfile({ id: profileId, label, pageId, tokenFile });
      if (hasNewToken) setFacebookPageVerification(profile.id, { verified: false });
      const safe = { id: profile.id, label: profile.label, pageId: profile.pageId, pageName: hasNewToken ? null : profile.pageName, connectionVerified: hasNewToken ? false : profile.connectionVerified, tokenSaved: true, legacy: false };
      return json(res, 200, { saved: true, profile: safe });
    } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
  }
  if (route === 'POST /api/facebook/pages/test') {
    const body = await readJson(req);
    const profileId = String(body.profileId || '');
    const profile = getFacebookPageProfile(profileId);
    if (!profile || !facebookTokenSaved(profile.tokenFile)) return json(res, 400, { connected: false, error: 'Page chưa có token đã lưu.' });
    try {
      const result = await new MetaGraphAdapter(profile.pageId, { tokenFile: profile.tokenFile }).checkConnection();
      setFacebookPageVerification(profile.id, { verified: true, pageName: result.pageName });
      log('INFO', 'FACEBOOK_PAGE_PROFILE_OK', `Đã xác minh Page profile ${profile.id} (${result.pageName}); token không được ghi log.`);
      return json(res, 200, { ...result, profileId: profile.id });
    } catch (error) {
      setFacebookPageVerification(profile.id, { verified: false });
      log('WARN', 'FACEBOOK_PAGE_PROFILE_FAILED', `Không xác minh được Page profile ${profile.id}: ${error.message}`);
      return json(res, 400, { connected: false, error: error.message });
    }
  }
  if (route === 'POST /api/facebook/pages/route') {
    const body = await readJson(req);
    try {
      const result = String(body.profileId || '').trim()
        ? setFacebookPageRoute(body.contentLanguage, body.profileId)
        : clearFacebookPageRoute(body.contentLanguage);
      return json(res, 200, { route: result });
    }
    catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
  }
  const deleteFacebookPageMatch = url.pathname.match(/^\/api\/facebook\/pages\/([\w-]+)$/u);
  if (req.method === 'DELETE' && deleteFacebookPageMatch) {
    try {
      const removed = deleteFacebookPageProfile(decodeURIComponent(deleteFacebookPageMatch[1]));
      if (!removed) return json(res, 404, { error: 'Không tìm thấy Page cần xóa.' });
      clearFacebookToken(removed.tokenFile);
      return json(res, 200, { deleted: true });
    } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
  }
  if (route === 'POST /api/english-shadowing/settings') {
    const body = await readJson(req);
    const allowed = new Set(['voice', 'highlightEnabled', 'highlightStyle', 'highlightMode', 'highlightColor', 'highlightPadding', 'highlightRadius', 'backgroundEffectConfig']);
    if (Object.keys(body).some((key) => !allowed.has(key))) return json(res, 400, { error: 'Chỉ có thể lưu giọng, Highlight và hiệu ứng nền riêng của EnglishShadowing.' });
    const merged = { ...getEnglishShadowingSettings(), ...body };
    if (!KOKORO_VOICES.some((voice) => voice.id === String(merged.voice))) return json(res, 400, { error: 'Giọng Kokoro EnglishShadowing không hợp lệ.' });
    if (typeof merged.highlightEnabled !== 'boolean') return json(res, 400, { error: 'Trạng thái Highlight EnglishShadowing không hợp lệ.' });
    if (!['text', 'tool'].includes(String(merged.highlightStyle))) return json(res, 400, { error: 'Kiểu hiệu ứng Highlight EnglishShadowing không hợp lệ.' });
    if (!['word', 'phrase'].includes(String(merged.highlightMode))) return json(res, 400, { error: 'Kiểu Highlight EnglishShadowing không hợp lệ.' });
    if (!/^#[\da-f]{6}$/iu.test(String(merged.highlightColor))) return json(res, 400, { error: 'Màu Highlight cần là mã hex 6 chữ số.' });
    if (!Number.isInteger(Number(merged.highlightPadding)) || Number(merged.highlightPadding) < 0 || Number(merged.highlightPadding) > 24) return json(res, 400, { error: 'Padding Highlight Shadowing phải từ 0 đến 24 px.' });
    if (!Number.isInteger(Number(merged.highlightRadius)) || Number(merged.highlightRadius) < 0 || Number(merged.highlightRadius) > 32) return json(res, 400, { error: 'Bo góc Highlight Shadowing phải từ 0 đến 32 px.' });
    const backgroundEffectConfig = merged.backgroundEffectConfig;
    if (!backgroundEffectConfig || typeof backgroundEffectConfig !== 'object' || Array.isArray(backgroundEffectConfig)
      || !BACKGROUND_EFFECTS.some((effect) => effect.id === String(backgroundEffectConfig.backgroundEffect || ''))
      || !Number.isInteger(Number(backgroundEffectConfig.backgroundEffectDensity)) || Number(backgroundEffectConfig.backgroundEffectDensity) < 10 || Number(backgroundEffectConfig.backgroundEffectDensity) > 60
      || !Number.isInteger(Number(backgroundEffectConfig.backgroundEffectSpeed)) || Number(backgroundEffectConfig.backgroundEffectSpeed) < 25 || Number(backgroundEffectConfig.backgroundEffectSpeed) > 140
      || !Number.isInteger(Number(backgroundEffectConfig.backgroundEffectOpacity)) || Number(backgroundEffectConfig.backgroundEffectOpacity) < 10 || Number(backgroundEffectConfig.backgroundEffectOpacity) > 70) {
      return json(res, 400, { error: 'Cấu hình hiệu ứng nền EnglishShadowing không hợp lệ.' });
    }
    const saved = saveEnglishShadowingSettings(normalizeEnglishShadowingSettings(merged, { validVoices: KOKORO_VOICES.map((voice) => voice.id) }));
    return json(res, 200, { saved: true, settings: saved });
  }
  if (route === 'POST /api/settings') {
    const body = await readJson(req);
    const currentSettings = getSettings();
    const next = { ...currentSettings, ...body };
    if (next.contentLanguage === 'ko') next.contentLanguage = currentSettings.contentLanguage === 'ko' ? 'en' : currentSettings.contentLanguage;
    const migrateRemovedBackgroundEffect = body.backgroundEffectProfiles === undefined && body.backgroundEffect === undefined
      && !BACKGROUND_EFFECTS.some((effect) => effect.id === String(next.backgroundEffect || ''));
    if (migrateRemovedBackgroundEffect) next.backgroundEffect = 'bubbles';
    const legacyBackgroundEffect = {
      backgroundEffect: currentSettings.backgroundEffect,
      backgroundEffectDensity: currentSettings.backgroundEffectDensity,
      backgroundEffectSpeed: currentSettings.backgroundEffectSpeed,
      backgroundEffectOpacity: currentSettings.backgroundEffectOpacity
    };
    const currentEffectProfiles = normalizeBackgroundEffectProfiles(currentSettings.backgroundEffectProfiles, legacyBackgroundEffect);
    const effectProfileKeys = ['backgroundEffect', 'backgroundEffectDensity', 'backgroundEffectSpeed', 'backgroundEffectOpacity'];
    let changedBackgroundEffectProfiles = body.backgroundEffectProfiles !== undefined;
    if (body.backgroundEffectProfiles !== undefined) {
      const validation = validateBackgroundEffectProfiles(body.backgroundEffectProfiles);
      if (validation.error) return json(res, 400, { error: validation.error });
      next.backgroundEffectProfiles = validation.profiles;
      Object.assign(next, next.backgroundEffectProfiles.en);
    } else {
      const englishProfile = { ...currentEffectProfiles.en };
      for (const key of effectProfileKeys) {
        if (Object.hasOwn(body, key)) {
          englishProfile[key] = body[key];
          changedBackgroundEffectProfiles = true;
        }
      }
      next.backgroundEffectProfiles = { ...currentEffectProfiles, en: englishProfile };
    }
    if (body.allowPaidAiApi === true) return json(res, 400, { error: 'Ứng dụng không hỗ trợ API AI trả phí.' });
    if (next.pageId && !/^\d{5,}$/.test(String(next.pageId))) return json(res, 400, { error: 'Facebook Page ID phải gồm ít nhất 5 chữ số.' });
    if (!/^\d{2}:\d{2}$/.test(String(next.postTime)) || Number(next.postTime.slice(0, 2)) > 23 || Number(next.postTime.slice(3)) > 59) return json(res, 400, { error: 'Giờ đăng phải có dạng HH:mm.' });
    if (!Number.isInteger(Number(next.postsPerDay)) || Number(next.postsPerDay) < 1 || Number(next.postsPerDay) > 4) return json(res, 400, { error: 'Tần suất phải từ 1 đến 4 bài mỗi ngày.' });
    if (!Number.isInteger(Number(next.prepareAheadDays)) || Number(next.prepareAheadDays) < 1 || Number(next.prepareAheadDays) > 30) return json(res, 400, { error: 'Số ngày dự phòng phải từ 1 đến 30.' });
    if (!Number.isInteger(Number(next.maxScriptsPerDay)) || Number(next.maxScriptsPerDay) < 1 || Number(next.maxScriptsPerDay) > 30) return json(res, 400, { error: 'Giới hạn kịch bản phải từ 1 đến 30 mỗi ngày.' });
    try { new Intl.DateTimeFormat('en-US', { timeZone: next.timezone }); } catch { return json(res, 400, { error: 'Múi giờ không hợp lệ.' }); }
    if (next.ttsProvider !== 'vieneu') return json(res, 400, { error: 'English content uses the VieNeu + Kokoro local TTS provider.' });
    if (next.japaneseTtsProvider !== 'vieneu-sbv2') return json(res, 400, { error: 'Japanese content uses Style-Bert-VITS2.' });
    if (next.chineseTtsProvider !== 'vieneu-cosyvoice3') return json(res, 400, { error: 'Chinese content uses CosyVoice 3.0.' });
    if (next.koreanTtsProvider !== 'supertonic3-ko') return json(res, 400, { error: 'Tiếng Hàn dùng Supertonic 3.' });
    if (!SUPERTONIC_KOREAN_VOICES.some((voice) => voice.id === String(next.supertonicKoreanVoice))) return json(res, 400, { error: 'Unsupported Supertonic Korean voice.' });
    if (!Number.isFinite(Number(next.supertonicKoreanSpeed)) || Number(next.supertonicKoreanSpeed) < 0.7 || Number(next.supertonicKoreanSpeed) > 1.4) return json(res, 400, { error: 'Tốc độ Supertonic 3 phải từ 0,7x đến 1,4x.' });
    if (!['en', 'ja', 'zh'].includes(String(next.contentLanguage))) return json(res, 400, { error: 'Content language must be English, Japanese, or Chinese.' });
    const vietnameseVoices = [next.vieneuViVoice, next.vieneuJaViVoice || next.vieneuViVoice, next.vieneuZhViVoice || next.vieneuViVoice];
    if (vietnameseVoices.some((voice) => !VIENEU_VOICES.includes(String(voice))) || !VIENEU_VOICES.includes(String(next.vieneuEnVoice))) return json(res, 400, { error: 'Giọng VieNeu không nằm trong danh sách được hỗ trợ.' });
    if (!Number.isFinite(Number(next.vieneuViSpeed)) || Number(next.vieneuViSpeed) < 0.75 || Number(next.vieneuViSpeed) > 1.25) return json(res, 400, { error: 'Tốc độ VieNeu tiếng Việt phải từ 0,75x đến 1,25x.' });
    if (!Number.isFinite(Number(next.vieneuEnSpeed)) || Number(next.vieneuEnSpeed) < 0.5 || Number(next.vieneuEnSpeed) > 1.25) return json(res, 400, { error: 'Tốc độ VieNeu tiếng Anh phải từ 0,5x đến 1,25x.' });
    if (!KOKORO_VOICES.some((voice) => voice.id === String(next.kokoroEnVoice))) return json(res, 400, { error: 'Giọng Kokoro tiếng Anh không nằm trong danh sách model.' });
    if (!Number.isFinite(Number(next.kokoroEnSpeed)) || Number(next.kokoroEnSpeed) < 0.5 || Number(next.kokoroEnSpeed) > 1.25) return json(res, 400, { error: 'Tốc độ Kokoro tiếng Anh phải từ 0,5x đến 1,25x.' });
    if (!STYLE_BERT_VITS2_VOICES.some((voice) => voice.id === String(next.styleBertVits2Voice))) return json(res, 400, { error: 'Unsupported Style-Bert-VITS2 Japanese speaker.' });
    if (!['Neutral', 'Happy', 'Angry', 'Disgust', 'Fear', 'Sad', 'Surprise'].includes(String(next.styleBertVits2Style))) return json(res, 400, { error: 'Unsupported Japanese speech style.' });
    if (!Number.isFinite(Number(next.styleBertVits2Speed)) || Number(next.styleBertVits2Speed) < 0.7 || Number(next.styleBertVits2Speed) > 1.4) return json(res, 400, { error: 'Japanese TTS speed must be 0.7x-1.4x.' });
    if (String(next.cosyVoiceProfile) !== 'custom' || String(next.cosyVoiceProfileName || '').length > 80) return json(res, 400, { error: 'Invalid CosyVoice profile.' });
    if (String(next.cosyVoiceReferenceText || '').length > 1000) return json(res, 400, { error: 'CosyVoice reference transcript must be at most 1000 characters.' });
    if (!Array.isArray(next.cosyVoiceProfiles) || next.cosyVoiceProfiles.length > 18) return json(res, 400, { error: 'CosyVoice supports up to 12 manual profiles and 6 AISHELL-3 library voices.' });
    const profileIds = new Set();
    let manualProfileCount = 0;
    const installedLibraryProfiles = new Map(cosyVoiceLibraryStatus().profiles.map((profile) => [profile.id, profile]));
    const validatedCosyVoiceProfiles = [];
    for (const profile of next.cosyVoiceProfiles) {
      const id = String(profile?.id || '');
      const name = String(profile?.name || '').trim();
      const referenceText = String(profile?.referenceText || '').trim();
      if (!/^[a-z0-9][a-z0-9-]{1,63}$/i.test(id) || profileIds.has(id) || !name || name.length > 80 || !referenceText || referenceText.length > 1000) {
        return json(res, 400, { error: 'Each CosyVoice profile needs a unique ID, a name, and an exact sample transcript.' });
      }
      profileIds.add(id);
      if (isCosyVoiceLibraryId(id)) {
        const installed = installedLibraryProfiles.get(id);
        if (!installed || referenceText !== installed.referenceText) return json(res, 400, { error: `AISHELL-3 profile ${id} is not installed or its source transcript was changed.` });
        validatedCosyVoiceProfiles.push({ ...installed, name });
      } else {
        manualProfileCount += 1;
        validatedCosyVoiceProfiles.push({ id, name, referenceText });
      }
    }
    if (manualProfileCount > 12) return json(res, 400, { error: 'CosyVoice supports up to 12 manual voice profiles.' });
    next.cosyVoiceProfiles = validatedCosyVoiceProfiles;
    if (next.cosyVoiceProfileId && !profileIds.has(String(next.cosyVoiceProfileId))) return json(res, 400, { error: 'Select one of the saved CosyVoice profiles.' });
    if (next.cosyVoiceProfileId) {
      const activeProfile = next.cosyVoiceProfiles.find((profile) => profile.id === String(next.cosyVoiceProfileId));
      next.cosyVoiceProfileName = activeProfile.name;
      next.cosyVoiceReferenceText = activeProfile.referenceText;
    }
    if (!Number.isInteger(Number(next.localTtsMinFreeRamMb)) || Number(next.localTtsMinFreeRamMb) < 512 || Number(next.localTtsMinFreeRamMb) > 65536) return json(res, 400, { error: 'Ngưỡng RAM trống trước khi nạp phải từ 512 đến 65536 MB.' });
    if (!Number.isInteger(Number(next.localTtsMinRemainingRamMb)) || Number(next.localTtsMinRemainingRamMb) < 256 || Number(next.localTtsMinRemainingRamMb) > 32768) return json(res, 400, { error: 'Ngưỡng RAM dự trữ sau khi nạp phải từ 256 đến 32768 MB.' });
    if (typeof next.highlightEnabled !== 'boolean') return json(res, 400, { error: 'Trạng thái highlight không hợp lệ.' });
    if (typeof next.japaneseHighlightEnabled !== 'boolean') return json(res, 400, { error: 'Trạng thái highlight tiếng Nhật không hợp lệ.' });
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
    if (changedBackgroundEffectProfiles || migrateRemovedBackgroundEffect) {
      patch.backgroundEffectProfiles = next.backgroundEffectProfiles;
      Object.assign(patch, next.backgroundEffectProfiles.en);
    }
    patch.cosyVoiceProfiles = validatedCosyVoiceProfiles;
    const facebookModeChanged = body.facebookAdapter && body.facebookAdapter !== currentSettings.facebookAdapter;
    if (body.autoPublishEnabled === true && next.facebookAdapter === 'meta' && !facebookModeChanged && !hasVerifiedFacebookPageProfile()) return json(res, 409, { error: 'Hãy kiểm tra ít nhất một Page đã được xác minh trước khi bật đăng live.' });
    if (facebookModeChanged) { patch.facebookConnectionVerified = false; patch.autoPublishEnabled = false; }
    for (const key of ['allowPaidAiApi', 'facebookConnectionVerified', 'facebookPageLanguage', 'facebookPageSelectedLanguage', 'pageId', 'appName', 'host', 'port', 'timezone', 'videoWidth', 'videoHeight', 'videoFps', 'template']) delete patch[key];
    for (const profile of validatedCosyVoiceProfiles) {
      if (isCosyVoiceLibraryId(profile.id)) {
        const installed = installedLibraryProfiles.get(profile.id);
        if (installed && installed.name !== profile.name) renameCosyVoiceLibraryProfile(profile.id, profile.name);
      }
    }
    const saved = saveSettings(patch);
    log('INFO', 'SETTINGS_SAVED', 'Đã lưu cài đặt ứng dụng.');
    return json(res, 200, { ...saved, allowPaidAiApi: false, facebookTokenSaved: facebookTokenSaved(), chatgpt: chatgptStatus() });
  }
  if (route === 'POST /api/tts/cosyvoice-reference') {
    const audio = await readBuffer(req, 15 * 1024 * 1024);
    if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
      return json(res, 400, { error: 'CosyVoice voice sample must be a valid WAV file under 15 MB.' });
    }
    const profileId = String(url.searchParams.get('profileId') || '');
    if (profileId && !/^[a-z0-9][a-z0-9-]{1,63}$/i.test(profileId)) return json(res, 400, { error: 'CosyVoice profile ID is invalid.' });
    if (isCosyVoiceLibraryId(profileId)) return json(res, 400, { error: 'AISHELL-3 voice samples are managed by the library and cannot be overwritten as manual WAV profiles.' });
    const targetPath = profileId
      ? path.join(COSYVOICE_PROFILES_DIR, `${profileId}.wav`)
      : COSYVOICE_REFERENCE_PATH;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.${process.pid}.tmp`;
    try { fs.writeFileSync(tempPath, audio); fs.renameSync(tempPath, targetPath); }
    finally { fs.rmSync(tempPath, { force: true }); }
    log('INFO', 'COSYVOICE_REFERENCE_SAVED', profileId ? `Saved CosyVoice voice profile ${profileId} locally.` : 'Saved the CosyVoice reference audio locally.');
    return json(res, 200, { saved: true, bytes: audio.length });
  }
  if (route === 'GET /api/tts/cosyvoice-library') return json(res, 200, cosyVoiceLibraryStatus());
  if (route === 'POST /api/tts/cosyvoice-library/check') {
    const status = cosyVoiceLibraryStatus();
    return json(res, 200, { ...status, valid: status.profiles.length, missing: status.expected - status.installed });
  }
  if (route === 'POST /api/tts/cosyvoice-library/install') {
    const started = startCosyVoiceLibraryInstall({
      onProfile: async (profile) => {
        const currentSettings = getSettings();
        const profiles = Array.isArray(currentSettings.cosyVoiceProfiles) ? currentSettings.cosyVoiceProfiles : [];
        const index = profiles.findIndex((item) => item.id === profile.id);
        const persisted = {
          id: profile.id, name: profile.name, referenceText: profile.referenceText,
          automatic: true, source: profile.source, gender: profile.gender,
          genderLabel: profile.genderLabel, speakerId: profile.speakerId, recordId: profile.recordId,
          language: profile.language, sampleRate: profile.sampleRate, durationSeconds: profile.durationSeconds,
          license: profile.license, ready: true
        };
        if (index >= 0) profiles[index] = { ...profiles[index], ...persisted };
        else profiles.push(persisted);
        saveSettings({ cosyVoiceProfiles: profiles });
      }
    });
    if (!started.started) return json(res, 409, { error: 'Thư viện giọng đang được tải.', ...cosyVoiceLibraryStatus() });
    log('INFO', 'COSYVOICE_LIBRARY_INSTALL_STARTED', 'Started installing AISHELL-3 Chinese voice profiles locally.');
    return json(res, 202, { started: true, ...cosyVoiceLibraryStatus() });
  }
  if (route === 'POST /api/tts/cosyvoice-library/cancel') {
    const cancelled = cancelCosyVoiceLibraryInstall();
    return json(res, cancelled ? 200 : 409, { cancelled, ...cosyVoiceLibraryStatus() });
  }
  const deleteCosyVoiceProfileMatch = url.pathname.match(/^\/api\/tts\/cosyvoice-profiles\/([a-z0-9-]+)$/i);
  if (req.method === 'DELETE' && deleteCosyVoiceProfileMatch) {
    const profileId = deleteCosyVoiceProfileMatch[1];
    const profilePath = path.join(COSYVOICE_PROFILES_DIR, `${profileId}.wav`);
    try {
      if (isCosyVoiceLibraryId(profileId)) deleteCosyVoiceLibraryProfile(profileId);
      else fs.rmSync(profilePath, { force: true });
    }
    catch (error) { return json(res, 500, { error: `Could not delete the local voice sample: ${error.message}` }); }
    if (profileId === 'legacy') {
      try { fs.rmSync(COSYVOICE_REFERENCE_PATH, { force: true }); }
      catch (error) { return json(res, 500, { error: `Could not delete the older local voice sample: ${error.message}` }); }
    }
    const current = getSettings();
    const selected = String(current.cosyVoiceProfileId || '') === profileId;
    saveSettings({
      cosyVoiceProfiles: (current.cosyVoiceProfiles || []).filter((profile) => String(profile.id) !== profileId),
      ...(selected ? { cosyVoiceProfileId: '', cosyVoiceProfileName: '', cosyVoiceReferenceText: '' } : {})
    });
    log('INFO', 'COSYVOICE_PROFILE_DELETED', `Deleted CosyVoice voice profile ${profileId} from this computer.`);
    return json(res, 200, { deleted: true, profileId });
  }
  const renameCosyVoiceProfileMatch = url.pathname.match(/^\/api\/tts\/cosyvoice-profiles\/([a-z0-9-]+)\/rename$/i);
  if (req.method === 'POST' && renameCosyVoiceProfileMatch) {
    const profileId = renameCosyVoiceProfileMatch[1];
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    if (!name || name.length > 80) return json(res, 400, { error: 'Tên giọng cần có từ 1 đến 80 ký tự.' });
    const current = getSettings();
    const profiles = Array.isArray(current.cosyVoiceProfiles) ? [...current.cosyVoiceProfiles] : [];
    const index = profiles.findIndex((profile) => String(profile.id) === profileId);
    if (isCosyVoiceLibraryId(profileId)) {
      try { renameCosyVoiceLibraryProfile(profileId, name); }
      catch (error) { return json(res, 400, { error: error.message }); }
      const installed = cosyVoiceLibraryStatus().profiles.find((profile) => profile.id === profileId);
      const updated = { ...installed, name };
      if (index >= 0) profiles[index] = updated;
      else profiles.push(updated);
      saveSettings({
        cosyVoiceProfiles: profiles,
        ...(String(current.cosyVoiceProfileId || '') === profileId ? { cosyVoiceProfileName: name } : {})
      });
    } else {
      if (index < 0) return json(res, 404, { error: 'Không tìm thấy hồ sơ giọng.' });
      profiles[index] = { ...profiles[index], name };
      saveSettings({
        cosyVoiceProfiles: profiles,
        ...(String(current.cosyVoiceProfileId || '') === profileId ? { cosyVoiceProfileName: name } : {})
      });
    }
    log('INFO', 'COSYVOICE_PROFILE_RENAMED', `Renamed CosyVoice profile ${profileId}.`);
    return json(res, 200, { renamed: true, profileId, name });
  }
  if (route === 'GET /api/topics') return json(res, 200, { topics: listTopics(), count: listTopics().length });
  if (route === 'POST /api/topics') {
    const body = await readJson(req);
    try { const topic = addTopic(body.category, body.title); log('INFO', 'TOPIC_ADDED', `Đã thêm chủ đề ${topic.title}.`); return json(res, 201, { topic }); }
    catch (error) { return json(res, 400, { error: /UNIQUE constraint failed/i.test(error.message) ? 'Chủ đề này đã có trong thư viện.' : error.message }); }
  }
  if (route === 'GET /api/videos') return json(res, 200, { videos: attachVideoProgress(listVideos()) });
  const backgroundEffectMatch = url.pathname.match(/^\/api\/videos\/([\w-]+)\/background-effect$/);
  if (req.method === 'POST' && backgroundEffectMatch) {
    const body = await readJson(req);
    const effect = String(body.backgroundEffect || '');
    const density = Number(body.backgroundEffectDensity);
    const speed = Number(body.backgroundEffectSpeed);
    const opacity = Number(body.backgroundEffectOpacity);
    if (!BACKGROUND_EFFECTS.some((item) => item.id === effect)) return json(res, 400, { error: 'Hiệu ứng nền không nằm trong danh sách hỗ trợ.' });
    if (!Number.isInteger(density) || density < 10 || density > 60) return json(res, 400, { error: 'Mật độ hiệu ứng phải là số nguyên từ 10 đến 60.' });
    if (!Number.isInteger(speed) || speed < 25 || speed > 140) return json(res, 400, { error: 'Tốc độ trôi phải là số nguyên từ 25 đến 140.' });
    if (!Number.isInteger(opacity) || opacity < 10 || opacity > 70) return json(res, 400, { error: 'Độ rõ hiệu ứng phải là số nguyên từ 10 đến 70.' });
    const backgroundEffectConfig = { backgroundEffect: effect, backgroundEffectDensity: density, backgroundEffectSpeed: speed, backgroundEffectOpacity: opacity };
    db.exec('BEGIN IMMEDIATE');
    let transactionOpen = true;
    try {
      const video = db.prepare('SELECT id,script_id,status,review_status,published_id,english_shadowing_profile_json FROM videos WHERE id=?').get(backgroundEffectMatch[1]);
      if (!video) { db.exec('ROLLBACK'); return json(res, 404, { error: 'Không tìm thấy video.' }); }
      const contentLanguage = db.prepare('SELECT content_language FROM scripts WHERE id=?').get(video.script_id)?.content_language;
      if (video.status !== 'ready' || video.published_id || video.review_status === 'approved') {
        db.exec('ROLLBACK');
        return json(res, 409, { error: 'Chỉ có thể đổi hiệu ứng khi video đang chờ duyệt và chưa lên lịch hoặc đăng.' });
      }
      if (contentLanguage !== 'english-shadowing' && !hasReusableBackgroundEffectAudio(video.id)) {
        db.exec('ROLLBACK');
        return json(res, 409, { error: 'Không còn đủ audio, căn chỉnh hoặc mẫu bố cục gốc để chỉ đổi nền an toàn. Hãy tạo lại video từ kịch bản trước.' });
      }
      if (db.prepare('SELECT 1 FROM scheduled_posts WHERE video_id=? LIMIT 1').get(video.id)) {
        db.exec('ROLLBACK');
        return json(res, 409, { error: 'Video này đã có lịch đăng; hãy hủy lịch trước khi thay hiệu ứng.' });
      }
      if (contentLanguage === 'english-shadowing') {
        const activeJobs = db.prepare("SELECT payload_json FROM jobs WHERE type IN ('create_english_shadowing_video','create_video') AND status IN ('pending','running')").all();
        const hasActiveJob = activeJobs.some(({ payload_json }) => {
          try {
            const payload = JSON.parse(payload_json);
            return payload.videoId === video.id || payload.scriptId === video.script_id;
          } catch { return false; }
        });
        if (hasActiveJob) {
          db.exec('ROLLBACK');
          return json(res, 409, { error: 'Video EnglishShadowing này đang được tạo hoặc render lại. Hãy đợi job hiện tại hoàn tất.' });
        }
        let savedProfile = {};
        try { savedProfile = JSON.parse(video.english_shadowing_profile_json || '{}'); } catch { savedProfile = {}; }
        const englishShadowingSettings = normalizeEnglishShadowingSettings({ ...savedProfile, backgroundEffectConfig }, { validVoices: KOKORO_VOICES.map((voice) => voice.id) });
        const jobId = queueJob('create_english_shadowing_video', {
          scriptId: video.script_id,
          videoId: video.id,
          backgroundEffectOnly: true,
          englishShadowingSettings
        });
        db.prepare("UPDATE videos SET status='processing',last_error=NULL,updated_at=? WHERE id=?")
          .run(new Date().toISOString(), video.id);
        db.exec('COMMIT');
        transactionOpen = false;
        log('INFO', 'ENGLISH_SHADOWING_BACKGROUND_EFFECT_RENDER_QUEUED', `Đã xếp render hiệu ứng riêng cho video EnglishShadowing ${video.id}.`, jobId);
        return json(res, 202, { jobId, status: 'pending', videoId: video.id, backgroundEffectConfig });
      }
      const activeJobs = db.prepare("SELECT payload_json FROM jobs WHERE type='create_video' AND status IN ('pending','running')").all();
      const hasActiveJob = activeJobs.some(({ payload_json }) => {
        try {
          const payload = JSON.parse(payload_json);
          return payload.videoId === video.id || payload.scriptId === video.script_id;
        } catch { return false; }
      });
      if (hasActiveJob) {
        db.exec('ROLLBACK');
        return json(res, 409, { error: 'Video này đang được tạo hoặc render lại. Hãy đợi job hiện tại hoàn tất.' });
      }
      const jobId = queueJob('create_video', { scriptId: video.script_id, videoId: video.id, forceRender: true, backgroundEffectOnly: true, backgroundEffectConfig });
      db.prepare("UPDATE videos SET status='processing',last_error=NULL,updated_at=? WHERE id=?")
        .run(new Date().toISOString(), video.id);
      db.exec('COMMIT');
      transactionOpen = false;
      log('INFO', 'VIDEO_BACKGROUND_EFFECT_RENDER_QUEUED', `Đã lưu hiệu ứng nền riêng và xếp render lại video ${video.id}.`, jobId);
      return json(res, 202, { jobId, status: 'pending', videoId: video.id, backgroundEffectConfig });
    } catch (error) {
      if (transactionOpen) db.exec('ROLLBACK');
      return json(res, 500, { error: error.message });
    }
  }
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
  const deleteScheduleMatch = url.pathname.match(/^\/api\/schedules\/([\w-]+)$/u);
  if (req.method === 'DELETE' && deleteScheduleMatch) {
    try {
      const schedule = deleteScheduleFromApp(deleteScheduleMatch[1]);
      if (!schedule) return json(res, 404, { error: 'Không tìm thấy lịch cần xóa.' });
      log('INFO', 'SCHEDULE_REMOVED_FROM_APP', `Đã xóa lịch ${schedule.id} khỏi tool; video ${schedule.video_id} vẫn được giữ.`);
      return json(res, 200, { deleted: true, id: schedule.id, videoId: schedule.video_id });
    } catch (error) {
      return json(res, error.statusCode || 409, { error: error.message });
    }
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
    const settings = getSettings();
    // Older clients omit contentLanguage. Use the last language selected in
    // the Page form so their credentials still go into that language's profile.
    const contentLanguage = String(body.contentLanguage ?? settings.facebookPageSelectedLanguage ?? 'en');
    const nextPageId = String(body.pageId || '').trim();
    if (!['en', 'zh', 'ja', 'english-shadowing'].includes(contentLanguage)) return json(res, 400, { error: 'Chọn ngôn ngữ Page hợp lệ trước khi lưu.' });
    if (!/^\d{5,}$/u.test(nextPageId)) return json(res, 400, { error: 'Facebook Page ID phải gồm ít nhất 5 chữ số.' });
    const currentProfile = getFacebookPageForLanguage(contentLanguage);
    const useLegacy = currentProfile?.legacy === true;
    const profileId = useLegacy ? 'legacy' : (currentProfile?.id || `language-${contentLanguage}`);
    const profile = currentProfile || getFacebookPageProfile(profileId);
    if (!useLegacy && profile && facebookPageProfileLanguage(profile.id) && facebookPageProfileLanguage(profile.id) !== contentLanguage) {
      return json(res, 409, { error: 'Page đã được gắn cho ngôn ngữ khác. Hãy kiểm tra lại cấu hình Page.' });
    }
    if (profile && profile.pageId !== nextPageId && facebookPageProfileHasActiveWork(profileId)) {
      return json(res, 409, { error: 'Page này còn lịch chưa hoàn tất. Lịch cũ vẫn được giữ riêng; hãy kiểm tra lại ID của ngôn ngữ đang chọn.' });
    }
    const tokenFile = useLegacy ? currentProfile.tokenFile : (profile?.tokenFile || facebookPageTokenPath(profileId));
    const hasNewToken = Boolean(String(body.pageToken || '').trim());
    if (hasNewToken) {
      try { saveFacebookToken(body.pageToken, tokenFile); }
      catch (error) { return json(res, 400, { error: error.message }); }
    } else if (!facebookTokenSaved(tokenFile)) {
      return json(res, 400, { error: `Nhập Page Access Token cho Page ${contentLanguage.toUpperCase()} trước khi lưu lần đầu.` });
    }
    try {
      if (useLegacy) {
        saveSettings({ pageId: nextPageId, facebookPageLanguage: contentLanguage, facebookPageSelectedLanguage: contentLanguage, facebookConnectionVerified: false, ...(contentLanguage === 'english-shadowing' ? {} : { autoPublishEnabled: false }) });
      } else {
        saveFacebookPageProfile({ id: profileId, label: `Facebook Page ${contentLanguage.toUpperCase()}`, pageId: nextPageId, tokenFile });
        setFacebookPageRoute(contentLanguage, profileId);
        if (hasNewToken) setFacebookPageVerification(profileId, { verified: false });
        saveSettings({ facebookPageSelectedLanguage: contentLanguage, ...(contentLanguage === 'english-shadowing' ? {} : { autoPublishEnabled: false }) });
      }
    } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
    log('INFO', 'FACEBOOK_CREDENTIALS_SAVED', `Đã lưu cấu hình Facebook cho Page ${contentLanguage.toUpperCase()}; token được lưu cục bộ và không ghi vào log.`);
    return json(res, 200, { saved: true, pageId: nextPageId, contentLanguage, profileId, tokenSaved: true, connectionVerified: false });
  }
  if (route === 'POST /api/facebook/test') {
    const settings = getSettings();
    const body = await readJson(req);
    if (body.contentLanguage !== undefined) {
      const contentLanguage = String(body.contentLanguage || '');
      if (!['en', 'zh', 'ja', 'english-shadowing'].includes(contentLanguage)) return json(res, 400, { error: 'Ngôn ngữ Page không hợp lệ.' });
      const profile = getFacebookPageForLanguage(contentLanguage);
      if (settings.facebookAdapter === 'mock') return json(res, 200, await new MockFacebookAdapter().checkConnection());
      if (!profile?.pageId || !facebookTokenSaved(profile.tokenFile)) return json(res, 409, { connected: false, error: `Page ${contentLanguage.toUpperCase()} chưa có ID và token đã lưu.` });
      try {
        const result = await new MetaGraphAdapter(profile.pageId, { tokenFile: profile.tokenFile }).checkConnection();
        setFacebookPageVerification(profile.id, { verified: true, pageName: result.pageName });
        log('INFO', 'FACEBOOK_CONNECTION_OK', `Đã xác minh Page ${contentLanguage.toUpperCase()} (${result.pageName}); token không ghi vào log.`);
        return json(res, 200, { ...result, contentLanguage, profileId: profile.id });
      } catch (error) {
        setFacebookPageVerification(profile.id, { verified: false });
        if (contentLanguage !== 'english-shadowing') saveSettings({ autoPublishEnabled: false });
        log('WARN', 'FACEBOOK_CONNECTION_FAILED', error.message);
        return json(res, 400, { connected: false, error: error.message });
      }
    }
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
    const language = normalizeLanguage(body.language || 'vi');
    const settings = getSettings();
    if (!['vi', 'en', 'ja', 'zh', 'ko'].includes(language)) return json(res, 400, { error: 'Unsupported preview language.' });
    if (!text || text.length > 2000) return json(res, 400, { error: 'Câu nghe thử phải có từ 1 đến 2000 ký tự.' });
    if (body.highlightMode !== undefined && !['word', 'phrase'].includes(body.highlightMode)) return json(res, 400, { error: 'Kiểu highlight preview không hợp lệ.' });
    const ttsProvider = body.ttsProvider || (language === 'ja' ? 'vieneu-sbv2' : language === 'zh' ? 'vieneu-cosyvoice3' : language === 'ko' ? 'supertonic3-ko' : 'vieneu');
    if (!['vieneu', 'vieneu-sbv2', 'vieneu-cosyvoice3', 'supertonic3-ko'].includes(ttsProvider)) return json(res, 400, { error: 'Invalid TTS provider.' });
    if (ttsProvider === 'supertonic3-ko' && language !== 'ko') return json(res, 400, { error: 'Supertonic 3 chỉ dùng cho giọng tiếng Hàn.' });
    const providerLanguage = { vieneu: 'en', 'vieneu-sbv2': 'ja', 'vieneu-cosyvoice3': 'zh', 'supertonic3-ko': 'ko' }[ttsProvider];
    const multilingualProvider = ['vieneu-sbv2', 'vieneu-cosyvoice3'].includes(ttsProvider);
    if (ttsProvider === 'vieneu' && !['vi', 'en'].includes(language)) return json(res, 400, { error: 'VieNeu local mode supports Vietnamese and English.' });
    const configuredVoice = ttsProvider === 'vieneu'
      ? (language === 'vi' ? settings.vieneuViVoice : settings.kokoroEnVoice)
      : ttsProvider === 'vieneu-sbv2' ? settings.styleBertVits2Voice : ttsProvider === 'supertonic3-ko' ? settings.supertonicKoreanVoice : 'cosyvoice3-reference';
    const voice = String(body.voice || configuredVoice).trim();
    const localVoiceValid = ttsProvider === 'vieneu'
      ? (language === 'vi' ? VIENEU_VOICES.includes(voice) : KOKORO_VOICES.some((item) => item.id === voice))
      : ttsProvider === 'vieneu-sbv2' ? STYLE_BERT_VITS2_VOICES.some((item) => item.id === voice)
        : ttsProvider === 'supertonic3-ko' ? SUPERTONIC_KOREAN_VOICES.some((item) => item.id === voice)
          : voice === 'cosyvoice3-reference';
    if (!localVoiceValid) return json(res, 400, { error: 'Invalid selected TTS voice.' });
    const configuredSpeed = ttsProvider === 'vieneu'
      ? (language === 'vi' ? settings.vieneuViSpeed : settings.kokoroEnSpeed)
      : ttsProvider === 'vieneu-sbv2' ? settings.styleBertVits2Speed
        : 1;
    const speed = ttsProvider === 'vieneu-cosyvoice3' ? 1 : Number(body.speed ?? (ttsProvider === 'supertonic3-ko' ? settings.supertonicKoreanSpeed : configuredSpeed));
    if (ttsProvider === 'vieneu' && (!Number.isFinite(speed) || speed < (language === 'vi' ? 0.75 : 0.5) || speed > 1.25)) return json(res, 400, { error: 'Tốc độ nghe thử nằm ngoài giới hạn model.' });
    if (multilingualProvider && (!Number.isFinite(speed) || speed < 0.7 || speed > 1.4)) return json(res, 400, { error: 'TTS preview speed must be 0.7x-1.4x.' });
    const id = crypto.randomUUID();
    const speechText = prepareSpeechText(text, language);
    const output = path.join(PATHS.temporary, 'voice-previews', `${id}.wav`);
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
      } else if (multilingualProvider) {
        const modelName = language === 'ja' ? 'Style-Bert-VITS2 Japanese' : 'CosyVoice 3.0 Chinese';
        const selectedSettings = {
          ...settings,
          styleBertVits2Voice: language === 'ja' ? voice : settings.styleBertVits2Voice,
          styleBertVits2Speed: language === 'ja' ? speed : settings.styleBertVits2Speed,
          cosyVoiceSpeed: language === 'zh' ? 1 : settings.cosyVoiceSpeed
        };
        if (language === 'zh' && body.cosyVoiceProfileId) {
          const profile = {
            id: String(body.cosyVoiceProfileId), name: String(body.cosyVoiceProfileName || '').slice(0, 80),
            referenceText: String(body.cosyVoiceReferenceText || '').slice(0, 1000)
          };
          const profiles = Array.isArray(settings.cosyVoiceProfiles) ? [...settings.cosyVoiceProfiles] : [];
          const profileIndex = profiles.findIndex((item) => item.id === profile.id);
          if (profileIndex >= 0) profiles[profileIndex] = profile;
          else profiles.push(profile);
          selectedSettings.cosyVoiceProfileId = profile.id;
          selectedSettings.cosyVoiceProfileName = profile.name;
          selectedSettings.cosyVoiceReferenceText = profile.referenceText;
          selectedSettings.cosyVoiceProfiles = profiles;
        }
        await withLocalTtsModel(modelName, (lease) => synthesizeMultilingualSegments([{
          segmentId: `preview-${id}`, language, text, speechText, order: 0, rate: speed, outputPath: output
        }], `preview-${id}`, { provider: ttsProvider, settings: selectedSettings, lease }));
      } else if (ttsProvider === 'supertonic3-ko') {
        await withLocalTtsModel('Supertonic 3 Korean', (lease) => synthesizeSupertonicKoreanPreview({
          text: speechText, voice, outputPath: output, settings,
          onProgress: (progress, detail) => lease.update({ phase: detail?.phase || 'supertonic-preview', progress })
        }));
      }
      if (!wordTimingsPath) {
        fs.rmSync(`${output}.wordtimings.json`, { force: true });
        return json(res, 200, { url: `/api/tts-preview/${id}`, language, voice });
      }
      const timingData = JSON.parse(fs.readFileSync(wordTimingsPath, 'utf8'));
      let mapped = mapWordBoundariesToTokens(text, timingData.wordBoundaries, `preview-${id}`, { language });
      let alignmentSource = timingData.source || (timingData.wordBoundaries.length ? (multilingualProvider ? `${ttsProvider}-alignment` : language === 'en' ? 'kokoro-word-boundary' : 'vieneu-word-boundary') : null);
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
    const body = await readJson(req);
    if (body.contentLanguage !== undefined) {
      const contentLanguage = String(body.contentLanguage || '');
      if (!['en', 'zh', 'ja', 'english-shadowing'].includes(contentLanguage)) return json(res, 400, { error: 'Ngôn ngữ Page không hợp lệ.' });
      const profile = getFacebookPageForLanguage(contentLanguage);
      if (!profile) return json(res, 200, { tokenSaved: false });
      clearFacebookToken(profile.tokenFile);
      setFacebookPageVerification(profile.id, { verified: false });
      if (contentLanguage !== 'english-shadowing') saveSettings({ autoPublishEnabled: false });
      return json(res, 200, { tokenSaved: false, contentLanguage });
    }
    clearFacebookToken(); saveSettings({ facebookConnectionVerified: false, autoPublishEnabled: false });
    return json(res, 200, { tokenSaved: false });
  }
  if (route === 'POST /api/generate') {
    const body = await readJson(req);
    const contentLanguage = String(body.contentLanguage || getSettings().contentLanguage || 'en');
    if (contentLanguage === 'english-shadowing') {
      const system = await systemStatus();
      const blockers = [];
      if (!system.aiReady) blockers.push('ChatGPT Plan chưa kết nối. Hãy kết nối lại trong Kết nối & cài đặt để tạo nội dung EnglishShadowing.');
      if (!system.worker) blockers.push('Worker nền đang ngoại tuyến. Hãy khởi động worker để xử lý video.');
      if (!system.tools.kokoroTts) blockers.push('Kokoro chưa sẵn sàng; kiểm tra model và môi trường TTS trong Cài đặt.');
      if (!system.tools.ffmpeg || !system.tools.ffprobe) blockers.push('FFmpeg và FFprobe cần sẵn sàng để dựng video EnglishShadowing.');
      if (blockers.length) return json(res, 503, { error: blockers.join(' ') });
      const activeJob = db.prepare("SELECT id FROM jobs WHERE type='create_english_shadowing_video' AND status IN ('pending','running') ORDER BY created_at DESC LIMIT 1").get();
      if (activeJob) return json(res, 409, { error: `EnglishShadowing đang được xử lý (${activeJob.id}); chờ job hiện tại xong rồi hãy tạo tiếp.` });
      const id = queueJob('create_english_shadowing_video', { englishShadowingSettings: getEnglishShadowingSettings() });
      log('INFO', 'ENGLISH_SHADOWING_JOB_QUEUED', 'Đã thêm video EnglishShadowing vào hàng đợi.', id);
      return json(res, 202, { jobId: id, status: 'pending', contentLanguage });
    }
    const ttsProvider = String(body.ttsProvider || getSettings().ttsProvider || 'vieneu');
    if (!['en', 'ja', 'zh'].includes(contentLanguage)) return json(res, 400, { error: 'Content language must be English, Japanese, or Chinese.' });
    const requestedPresentationStyle = String(body.presentationStyle || '');
    const presentationStyle = contentLanguage === 'zh' ? requestedPresentationStyle : '';
    const allowedPresentationStyles = contentLanguage === 'zh'
      ? ['dialogue-cards', 'numbered-scenario', 'inline-meaning', 'inline-keyphrase']
      : [];
    if (presentationStyle && !allowedPresentationStyles.includes(presentationStyle)) {
      return json(res, 400, { error: `Kiểu trình bày ${contentLanguage === 'zh' ? 'tiếng Trung' : 'tiếng Anh'} không hợp lệ.` });
    }
    if (!['vieneu', 'vieneu-sbv2', 'vieneu-cosyvoice3'].includes(ttsProvider)) return json(res, 400, { error: 'Invalid TTS provider.' });
    const providerLanguage = { vieneu: 'en', 'vieneu-sbv2': 'ja', 'vieneu-cosyvoice3': 'zh' }[ttsProvider];
    if (providerLanguage !== contentLanguage) return json(res, 400, { error: 'Selected local TTS model does not match the chosen content language.' });
    if (body.topicId && !db.prepare('SELECT id FROM topics WHERE id=?').get(body.topicId)) return json(res, 400, { error: 'Chủ đề không tồn tại.' });
    const system = await systemStatus();
    const blockers = [];
    if (['en', 'zh'].includes(contentLanguage) && !system.aiReady) {
      blockers.push('ChatGPT Plan chưa kết nối. Hãy kết nối lại trong Kết nối & cài đặt để tạo nội dung; hệ thống không dùng nội dung cục bộ thay thế.');
    }
    if (ttsProvider === 'vieneu-sbv2') {
      if (!system.tools.styleBertVits2Tts) blockers.push('Style-Bert-VITS2 tiếng Nhật chưa sẵn sàng; xem trạng thái model trong Kết nối & cài đặt.');
      else if (Number(system.styleBertVits2?.freeRamMb) < Number(system.styleBertVits2?.minimumRamMb)) blockers.push(`Style-Bert-VITS2 cần ít nhất ${system.styleBertVits2.minimumRamMb} MB RAM trống trước khi tạo giọng.`);
    }
    if (ttsProvider === 'vieneu-cosyvoice3') {
      if (!system.tools.cosyVoice3Tts) blockers.push('CosyVoice 3.0 tiếng Trung chưa sẵn sàng; xem trạng thái model trong Kết nối & cài đặt.');
      else if (!system.cosyVoice3?.referenceReady) blockers.push('CosyVoice cần WAV giọng mẫu và bản chép chính xác. Hãy lưu mẫu trong Kết nối & cài đặt trước khi tạo nội dung tiếng Trung.');
      else if (Number(system.cosyVoice3?.freeRamMb) < Number(system.cosyVoice3?.minimumRamMb)) blockers.push(`CosyVoice 3.0 cần ít nhất ${system.cosyVoice3.minimumRamMb} MB RAM trống trước khi tạo giọng.`);
    }
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
    const topicId = contentLanguage === 'ja' ? null : body.topicId || null;
    const id = queueJob('create_video', { topicId, contentLanguage, ttsProvider, ...(presentationStyle ? { presentationStyle } : {}) });
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
      if (settings.facebookAdapter === 'meta' && settings.autoPublishEnabled && isFacebookPageReady(getFacebookPageProfile(schedule.targetPageProfileId))) {
        const queued = queueFacebookSchedule(schedule.id);
        if (queued) facebookScheduleState = 'queued';
      }
      log('INFO', 'POST_SCHEDULED', `Đã lên lịch đăng video vào ${when.toISOString()}.`);
      return json(res, 201, { ...schedule, facebookScheduleState });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  const retryScheduleMatch = url.pathname.match(/^\/api\/schedules\/([\w-]+)\/retry$/u);
  if (req.method === 'POST' && retryScheduleMatch) {
    const body = await readJson(req);
    if (body.confirmRetry !== true) return json(res, 409, { error: 'Xác nhận Đăng lại lịch trước khi gửi yêu cầu.' });
    const scheduleId = retryScheduleMatch[1];
    const schedule = db.prepare('SELECT * FROM scheduled_posts WHERE id=?').get(scheduleId);
    if (!schedule || !['scheduled', 'failed'].includes(schedule.status)) return json(res, 404, { error: 'Không tìm thấy lịch còn có thể đăng lại.' });
    const settings = getSettings();
    if (settings.facebookAdapter !== 'meta') return json(res, 409, { error: 'Hãy chọn Meta Graph API trong Kết nối & cài đặt để gửi lịch lên Facebook.' });
    const video = db.prepare('SELECT id,status,published_id,published_url FROM videos WHERE id=?').get(schedule.video_id);
    if (!video) return json(res, 404, { error: 'Không tìm thấy video của lịch này.' });
    if (video.status === 'published') {
      completePublishedSchedule(schedule.id, { facebookId: video.published_id || schedule.facebook_video_id, url: video.published_url, adapter: 'meta', publishedAt: video.updated_at });
      return json(res, 200, { alreadyPublished: true, status: 'published' });
    }
    const contentLanguage = contentLanguageForVideo(schedule.video_id);
    const routeMismatch = facebookPageLanguageMismatch(schedule.video_id, schedule);
    if (routeMismatch) return json(res, 409, { error: routeMismatch });
    const profile = facebookPageForVideo(schedule.video_id, schedule);
    if (!profile?.pageId || !facebookPageHasSavedToken(profile.pageId, contentLanguage)) {
      return json(res, 409, { error: `Page ${contentLanguage.toUpperCase()} chưa có Page ID và token đã lưu. Lưu thông tin trong Kết nối & cài đặt rồi kiểm tra Page trước khi đăng lại.` });
    }
    let pageCheck;
    let postingProfile = profile;
    try {
      const verified = await verifyFacebookPageTarget(profile, { contentLanguage });
      postingProfile = verified.profile;
      pageCheck = verified.pageCheck;
      if (verified.usedFallback) {
        log('WARN', 'FACEBOOK_PAGE_TOKEN_FALLBACK', `Token của cấu hình ${profile.label} hết hạn; đã xác minh và chuyển lịch sang cấu hình ${postingProfile.label} cùng Page ID ${profile.pageId}.`);
      }
    } catch (error) {
      log('WARN', 'FACEBOOK_RETRY_PAGE_CHECK_FAILED', `Không xác minh được Page ${contentLanguage.toUpperCase()} trước khi đăng lại lịch ${schedule.id}: ${error.message}`);
      return json(res, 409, { error: `Không xác minh được Page ${contentLanguage.toUpperCase()} bằng token hiện tại: ${error.message} Mở Kết nối & cài đặt, cập nhật token rồi kiểm tra lại Page.` });
    }

    const activeScheduleJob = db.prepare("SELECT payload_json FROM jobs WHERE type='schedule_facebook_video' AND status IN ('pending','running')")
      .all().some(({ payload_json }) => { try { return JSON.parse(payload_json).scheduleId === schedule.id; } catch { return false; } });
    const activePublishJob = db.prepare("SELECT payload_json FROM jobs WHERE type='publish_video' AND status IN ('pending','running')")
      .all().some(({ payload_json }) => {
        try { const payload = JSON.parse(payload_json); return payload.scheduleId === schedule.id || payload.videoId === schedule.video_id; }
        catch { return false; }
      });
    if (activeScheduleJob || activePublishJob) return json(res, 409, { error: 'Yêu cầu đăng lại lịch này đang chờ hoặc đang được xử lý.' });

    let knownRemoteFailure = !schedule.facebook_video_id;
    let unknownRemoteOutcome = ['uncertain', 'finishing'].includes(schedule.facebook_schedule_state);
    if (schedule.facebook_video_id) {
      try {
        const remote = await new MetaGraphAdapter(profile.pageId, { tokenFile: profile.tokenFile }).getVideoStatus(schedule.facebook_video_id);
        const remoteStatus = String(remote.status?.video_status || remote.status?.publishing_phase?.status || '').toLowerCase();
        const remoteScheduledAt = Number(remote.scheduled_publish_time);
        if (remote.published === true || ['published', 'complete'].includes(remoteStatus)) {
          completePublishedSchedule(schedule.id, { facebookId: schedule.facebook_video_id, url: remote.permalink_url || null, adapter: 'meta' });
          log('INFO', 'FACEBOOK_RETRY_FOUND_PUBLISHED', `Đối soát thấy Facebook đã đăng video ${schedule.facebook_video_id}; không tạo bài mới.`);
          return json(res, 200, { alreadyPublished: true, status: 'published', facebookId: schedule.facebook_video_id });
        }
        if (remote.published === false && Number.isFinite(remoteScheduledAt) && Math.abs(remoteScheduledAt * 1000 - new Date(schedule.scheduled_at).getTime()) < 60_000) {
          db.prepare("UPDATE scheduled_posts SET facebook_schedule_state='scheduled',facebook_error=NULL,updated_at=? WHERE id=?")
            .run(new Date().toISOString(), schedule.id);
          return json(res, 200, { alreadyScheduled: true, status: 'scheduled', facebookId: schedule.facebook_video_id, pageName: pageCheck.pageName });
        }
        knownRemoteFailure = ['error', 'failed'].includes(remoteStatus);
        unknownRemoteOutcome = !knownRemoteFailure;
      } catch (error) {
        knownRemoteFailure = false;
        unknownRemoteOutcome = true;
        log('WARN', 'FACEBOOK_RETRY_REMOTE_CHECK_FAILED', `Không đối soát được ID ${schedule.facebook_video_id} trước khi đăng lại lịch ${schedule.id}: ${error.message}`);
      }
    }
    const lastPublish = db.prepare('SELECT id,status FROM publish_history WHERE video_id=? ORDER BY created_at DESC LIMIT 1').get(schedule.video_id);
    if (lastPublish?.status === 'uploading') return json(res, 409, { error: 'Facebook vẫn đang có một lượt tải video chưa kết thúc. Hãy đợi lượt đó hoàn tất rồi thử lại.' });
    unknownRemoteOutcome ||= lastPublish?.status === 'uncertain';
    if (unknownRemoteOutcome && body.confirmDuplicate !== true) {
      return json(res, 409, { error: 'Chưa xác minh được lượt gửi trước. Hãy kiểm tra Facebook Planner; nếu vẫn muốn gửi lại, xác nhận có thể tạo bài trùng.' });
    }

    const isPastDue = new Date(schedule.scheduled_at).getTime() <= Date.now();
    if (isPastDue) {
      if (body.confirmLive !== true) return json(res, 409, { error: 'Thời điểm đã lên lịch đã qua. Xác nhận đăng live ngay lên Facebook để tiếp tục.' });
      db.exec('BEGIN IMMEDIATE');
      try {
        const latest = db.prepare('SELECT status,facebook_schedule_state,facebook_video_id FROM scheduled_posts WHERE id=?').get(schedule.id);
        if (!latest || !['scheduled', 'failed'].includes(latest.status)) throw Object.assign(new Error('Lịch đã thay đổi trạng thái; hãy tải lại danh sách.'), { statusCode: 409 });
        if (latest.facebook_schedule_state !== schedule.facebook_schedule_state || latest.facebook_video_id !== schedule.facebook_video_id) {
          throw Object.assign(new Error('Facebook vừa cập nhật trạng thái lịch này. Tải lại danh sách để đối soát trước khi thử lại.'), { statusCode: 409 });
        }
        const activePublish = db.prepare("SELECT payload_json FROM jobs WHERE type='publish_video' AND status IN ('pending','running')")
          .all().some(({ payload_json }) => {
            try { const payload = JSON.parse(payload_json); return payload.scheduleId === schedule.id || payload.videoId === schedule.video_id; }
            catch { return false; }
          });
        const activeSchedule = db.prepare("SELECT payload_json FROM jobs WHERE type='schedule_facebook_video' AND status IN ('pending','running')")
          .all().some(({ payload_json }) => { try { return JSON.parse(payload_json).scheduleId === schedule.id; } catch { return false; } });
        if (activePublish || activeSchedule) throw Object.assign(new Error('Đã có yêu cầu đăng video này đang chờ; không xếp thêm lượt mới.'), { statusCode: 409 });
        if (unknownRemoteOutcome && lastPublish?.id) db.prepare("UPDATE publish_history SET status='failed' WHERE id=? AND status='uncertain'").run(lastPublish.id);
        db.prepare(`UPDATE scheduled_posts SET status='scheduled',facebook_schedule_state='local',facebook_video_id=NULL,
          target_page_profile_id=?,target_page_id=?,
          facebook_upload_session_id=NULL,facebook_upload_offset=NULL,facebook_upload_end_offset=NULL,facebook_error=NULL,updated_at=? WHERE id=?`)
          .run(postingProfile.id, postingProfile.pageId, new Date().toISOString(), schedule.id);
        db.prepare("UPDATE videos SET status='scheduled',last_error=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), schedule.video_id);
        const jobId = queueJob('publish_video', { videoId: schedule.video_id, scheduleId: schedule.id, confirmLive: true, confirmRetryUncertain: unknownRemoteOutcome });
        db.exec('COMMIT');
        log('INFO', 'FACEBOOK_SCHEDULE_RETRY_QUEUED', `Đã xếp đăng live video theo lịch ${schedule.id} lên Page ${pageCheck.pageName}.`, jobId);
        return json(res, 202, { jobId, status: 'pending', mode: 'live', pageName: pageCheck.pageName, profileLabel: postingProfile.label });
      } catch (error) { db.exec('ROLLBACK'); return json(res, error.statusCode || 409, { error: error.message }); }
    }

    const queued = queueFacebookSchedule(schedule.id, {
      manualRetry: true,
      expectedFacebookId: schedule.facebook_video_id || null,
      expectedState: schedule.facebook_schedule_state,
      targetPageProfileId: postingProfile.id,
      targetPageId: postingProfile.pageId
    });
    if (!queued) return json(res, 409, { error: 'Không thể xếp lại lịch ở trạng thái hiện tại. Tải lại danh sách rồi thử lại.' });
    const retriedSchedule = db.prepare('SELECT scheduled_at FROM scheduled_posts WHERE id=?').get(schedule.id);
    log('INFO', 'FACEBOOK_SCHEDULE_RETRY_QUEUED', `Đã xếp gửi lại lịch ${schedule.id} lên Page ${pageCheck.pageName}.`, queued.jobId);
    return json(res, 202, { jobId: queued.jobId, status: 'pending', mode: 'schedule', pageName: pageCheck.pageName, profileLabel: postingProfile.label, scheduledAt: retriedSchedule?.scheduled_at, remoteFailure: knownRemoteFailure });
  }
  const approveMatch = url.pathname.match(/^\/api\/videos\/([\w-]+)\/approve$/);
  if (req.method === 'POST' && approveMatch) {
    const settings = getSettings();
    try {
      const schedule = approveVideoAndCreateRandomSchedule(approveMatch[1], settings.timezone, settings.postsPerDay);
      let facebookScheduleState = schedule.facebookScheduleState || 'local';
      if (settings.facebookAdapter === 'meta' && settings.autoPublishEnabled && isFacebookPageReady(getFacebookPageProfile(schedule.targetPageProfileId)) && facebookScheduleState === 'local') {
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
    const video = db.prepare('SELECT id,status,last_error FROM videos WHERE id=?').get(publishMatch[1]);
    const contentLanguage = contentLanguageForVideo(publishMatch[1]);
    const facebookSchedule = db.prepare('SELECT * FROM scheduled_posts WHERE video_id=?').get(publishMatch[1]);
    const routeMismatch = settings.facebookAdapter === 'meta' ? facebookPageLanguageMismatch(publishMatch[1], facebookSchedule) : null;
    if (routeMismatch) return json(res, 409, { error: routeMismatch });
    let targetPage = settings.facebookAdapter === 'meta' ? facebookPageForVideo(publishMatch[1], facebookSchedule) : null;
    if (settings.facebookAdapter === 'meta' && !body.confirmLive) return json(res, 409, { error: `Cần xác nhận rõ ràng trước khi đăng live lên Page ${contentLanguage.toUpperCase()}.` });
    if (settings.facebookAdapter === 'meta') {
      if (!targetPage?.pageId || !facebookPageHasSavedToken(targetPage.pageId, contentLanguage)) return json(res, 409, { error: `Page ${contentLanguage.toUpperCase()} chưa có Page ID và token đã lưu.` });
      try {
        const selectedProfile = targetPage;
        const verified = await verifyFacebookPageTarget(targetPage, { contentLanguage });
        targetPage = verified.profile;
        if (verified.usedFallback) {
          if (facebookSchedule) {
            db.prepare('UPDATE scheduled_posts SET target_page_profile_id=?,target_page_id=?,updated_at=? WHERE id=?')
              .run(targetPage.id, targetPage.pageId, new Date().toISOString(), facebookSchedule.id);
          }
          log('WARN', 'FACEBOOK_PAGE_TOKEN_FALLBACK', `Token của cấu hình ${selectedProfile.label} hết hạn; đăng live sẽ dùng cấu hình ${targetPage.label} đã xác minh cho cùng Page ID ${targetPage.pageId}.`);
        }
      } catch (error) {
        log('WARN', 'FACEBOOK_LIVE_PAGE_CHECK_FAILED', `Không xác minh được Page ${contentLanguage.toUpperCase()} trước khi đăng live: ${error.message}`);
        return json(res, 409, { error: `Không thể đăng live: Page ${contentLanguage.toUpperCase()} chưa được kiểm tra thành công bằng token hiện tại. ${error.message} Cập nhật token và kiểm tra lại Page.` });
      }
    }
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
    const id = queueJob('publish_video', {
      videoId: video.id, confirmLive: body.confirmLive === true,
      ...(targetPage ? { targetPageProfileId: targetPage.id, targetPageId: targetPage.pageId } : {})
    });
    log('INFO', 'PUBLISH_JOB_QUEUED', `Đã đưa video vào hàng đợi đăng ${settings.facebookAdapter}.`, id);
    return json(res, 202, { jobId: id, status: 'pending', profileLabel: targetPage?.label || null });
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
    const selectedTts = currentVideoTtsSelection({ scriptId: video.script_id });

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
      const retryPayload = { ...failedJob.payload, ...selectedTts };
      db.prepare("UPDATE jobs SET payload_json=?,status='pending',attempts=0,last_error=NULL,scheduled_at=?,locked_by=NULL,updated_at=? WHERE id=? AND status='failed'")
        .run(JSON.stringify(retryPayload), stamp, stamp, failedJob.id);
      jobId = failedJob.id;
    } else {
      jobId = queueJob('create_video', { scriptId: video.script_id, videoId: video.id, ...selectedTts });
    }
    log('INFO', 'VIDEO_RETRY_QUEUED', `Đã xếp tạo lại video ${video.id} từ kịch bản đã lưu.`, jobId);
    return json(res, 202, { jobId, status: 'pending' });
  }
  const retryMatch = url.pathname.match(/^\/api\/jobs\/([\w-]+)\/retry$/);
  if (req.method === 'POST' && retryMatch) {
    const failedJob = db.prepare("SELECT id,type,payload_json FROM jobs WHERE id=? AND status='failed'").get(retryMatch[1]);
    if (!failedJob) return json(res, 409, { error: 'Job không ở trạng thái lỗi để chạy lại.' });
    const stamp = new Date().toISOString();
    let result;
    if (failedJob.type === 'create_video') {
      let payload = null;
      try { payload = JSON.parse(failedJob.payload_json); } catch { /* Keep malformed legacy payloads untouched. */ }
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const selectedTts = currentVideoTtsSelection({ scriptId: payload.scriptId, contentLanguageHint: payload.contentLanguage });
        payload = { ...payload, ...selectedTts };
        result = db.prepare("UPDATE jobs SET payload_json=?,status='pending',attempts=0,last_error=NULL,scheduled_at=?,updated_at=? WHERE id=? AND status='failed'")
          .run(JSON.stringify(payload), stamp, stamp, retryMatch[1]);
      } else {
        result = db.prepare("UPDATE jobs SET status='pending',attempts=0,last_error=NULL,scheduled_at=?,updated_at=? WHERE id=? AND status='failed'")
          .run(stamp, stamp, retryMatch[1]);
      }
    } else {
      result = db.prepare("UPDATE jobs SET status='pending',attempts=0,last_error=NULL,scheduled_at=?,updated_at=? WHERE id=? AND status='failed'")
        .run(stamp, stamp, retryMatch[1]);
    }
    if (Number(result.changes) !== 1) return json(res, 409, { error: 'Job không ở trạng thái lỗi để chạy lại.' });
    return json(res, 202, { jobId: retryMatch[1], status: 'pending' });
  }
  return json(res, 404, { error: 'Không tìm thấy API.' });
}

function currentVideoTtsSelection({ scriptId = null, contentLanguageHint = null } = {}) {
  const settings = getSettings();
  const script = scriptId ? getScript(scriptId) : null;
  const languageValue = script?.contentLanguage || contentLanguageHint || settings.contentLanguage || 'en';
  const contentLanguage = ['en', 'ja', 'zh'].includes(String(languageValue)) ? String(languageValue) : 'en';
  const ttsProvider = contentLanguage === 'ja'
    ? settings.japaneseTtsProvider || 'vieneu-sbv2'
    : contentLanguage === 'zh'
      ? settings.chineseTtsProvider || 'vieneu-cosyvoice3'
      : settings.ttsProvider || 'vieneu';
  return { contentLanguage, ttsProvider };
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
