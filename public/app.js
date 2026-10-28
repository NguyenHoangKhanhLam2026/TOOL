const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const labels = { overview: 'Tổng quan', library: 'Thư viện video', schedule: 'Lịch đăng', settings: 'Kết nối & cài đặt', logs: 'Nhật ký hoạt động' };
const MOT_PHUT_CONTENT = 'mot-phut-vo-le';
const THINGS_YOU_DIDNT_KNOW_CONTENT = 'things-you-didnt-know';
const autoTopicLabel = 'AI t\u1ef1 ch\u1ecdn ch\u1ee7 \u0111\u1ec1';
const state = { view: 'overview', topics: [], videos: [], schedules: [], publishedSchedules: [], motPhutSchedules: [], motPhutVideos: [], logs: [], jobs: [], filter: 'all', languageFilter: 'all', overview: null, settings: null, system: null, facebookPages: { profiles: [], routes: {} }, backgroundEffects: [], backgroundEffectEditor: null, backgroundEffectLanguage: 'en', backgroundEffectProfiles: { en: { backgroundEffect: 'bubbles', backgroundEffectDensity: 28, backgroundEffectSpeed: 58, backgroundEffectOpacity: 32 }, zh: { backgroundEffect: 'bubbles', backgroundEffectDensity: 28, backgroundEffectSpeed: 58, backgroundEffectOpacity: 32 }, ja: { backgroundEffect: 'bubbles', backgroundEffectDensity: 28, backgroundEffectSpeed: 58, backgroundEffectOpacity: 32 } }, backgroundEffectDensity: 28, backgroundEffectSpeed: 58, backgroundEffectOpacity: 32, settingsDirty: false, settingsRevision: 0, contentLanguageSavePromise: Promise.resolve(), contentLanguageRevision: 0, createLanguageSelectionTouched: false, englishShadowingSettings: null, englishShadowingSettingsDirty: false, englishShadowingSettingsRevision: 0, ttsProviderView: 'standard', voiceHighlightContentProfile: 'standard', cosyVoiceUploadedProfileId: '', cosyVoiceActiveProfileId: '', facebookPageLanguageDirty: false, facebookPageCredentialDirty: false, facebookSelectedLanguage: 'en', facebookPageLoadRevision: 0, facebookActiveProfile: null };
let logsRevision = 0;
let previewAudio = null;
let scheduleCalendarMonth = '';
let scheduleSelectedDay = '';
let scheduleDetailsOpen = false;
let scheduleLanguageFilter = 'all';
const HIGHLIGHT_PREVIEW_TEXT = {
  vi: 'Xin chào, hôm nay mình cùng luyện nói tiếng Anh nhé.',
  en: 'Hello, let us practice English together today.'
};
let highlightPreviewAudio = null;
let highlightPreviewFrame = 0;

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Máy chủ trả mã ${response.status}.`);
  return data;
}

function toast(message, isError = false, detail = '') {
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = message;
  if (detail) { const sub = document.createElement('small'); sub.textContent = detail; el.append(sub); }
  $('#toast-region').append(el);
  setTimeout(() => el.remove(), 5200);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function dateText(value, options = { dateStyle: 'medium', timeStyle: 'short' }) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { ...options, timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value));
}

function setView(view) {
  if (!labels[view]) return;
  state.view = view;
  $$('.view').forEach((item) => item.classList.toggle('active', item.id === `view-${view}`));
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  $('#page-breadcrumb').textContent = labels[view];
  if (view === 'library') loadVideos();
  if (view === 'schedule') loadSchedules();
  if (view === 'settings') {
    const previewFrame = $('#background-effect-preview-frame');
    if (previewFrame) previewFrame.loading = 'eager';
    loadSettings();
  }
  if (view === 'logs') loadLogs();
}

function statusName(status, video = null) {
  if (status === 'ready' && video?.review_status !== 'approved') return 'Ch\u1edd duy\u1ec7t';
  if (status === 'published' && String(video?.published_id || '').startsWith('mock_reel_')) return 'Đã mô phỏng';
  return ({ script_ready: 'Đang chờ render', processing: 'Đang tạo', ready: 'Sẵn sàng', scheduled: 'Đã lên lịch', publishing: 'Đang đăng', published: 'Đã xuất bản', failed: 'Tạo video lỗi', publish_failed: 'Đăng thất bại' })[status] || status || 'Chưa rõ';
}

function statusClass(status, video = null) {
  if (status === 'ready' && video?.review_status !== 'approved') return 'warn';
  if (['ready', 'published'].includes(status)) return 'ok';
  if (['scheduled', 'processing', 'script_ready', 'publishing'].includes(status)) return 'warn';
  if (['failed', 'publish_failed'].includes(status)) return 'error';
  return 'neutral';
}

function isFacebookScheduleAccepted(video) {
  return video?.status === 'scheduled' && video?.facebook_schedule_state === 'scheduled';
}

function pipelineErrorMessage(video) {
  const error = String(video.pipeline?.error || video.last_error || 'Có lỗi trong quá trình tạo video.');
  if (error.includes('NoAudioReceived')) return 'Nhà cung cấp giọng đọc không trả âm thanh. Kiểm tra model và thử lại.';
  return error.split(/\r?\n/).find(Boolean)?.slice(0, 220) || 'Có lỗi trong quá trình tạo video.';
}

function videoProgressMarkup(video) {
  if (!video.pipeline?.steps) return '';
  const steps = video.pipeline.steps.map((step) => `<div class="pipeline-step ${step.status}" title="${escapeHtml(step.label)}: ${step.status === 'done' ? 'Đã hoàn tất' : step.status === 'error' ? 'Bị lỗi' : step.status === 'active' ? 'Đang thực hiện' : 'Đang chờ'}"><span class="pipeline-light"></span><span>${escapeHtml(step.label)}</span></div>`).join('');
  const error = video.pipeline.error ? `<p class="pipeline-error">${escapeHtml(pipelineErrorMessage(video))}</p>` : '';
  return `<div class="video-pipeline" aria-label="Tiến trình tạo video">${steps}</div>${error}`;
}
function contentGroupLabel(language) {
  const groups = { en: 'Nội dung tiếng Anh', zh: 'Nội dung tiếng Trung', ja: 'Nội dung tiếng Nhật', ko: 'Nội dung tiếng Hàn' };
  if (String(language || '').toLowerCase() === 'english-shadowing') return 'EnglishShadowing';
  return groups[String(language || 'en').toLowerCase()] || groups.en;
}
function videoCard(video, compact = false) {
  const language = String(video.content_language || video.contentLanguage || '').toLowerCase();
  const missingPreviewLabel = language === 'english-shadowing' ? 'Không dùng thumbnail cho Shadowing' : 'Chưa có bản render';
  const thumb = video.thumbnail_path ? `<img src="/api/videos/${encodeURIComponent(video.id)}/thumbnail" alt="Thumbnail ${escapeHtml(video.topic)}" loading="lazy" />` : `<span class="video-placeholder">${escapeHtml(video.topic || 'Video mới')}<small>${video.status === 'processing' ? 'Đang tạo các đoạn đọc và render…' : video.last_error ? escapeHtml(video.last_error) : missingPreviewLabel}</small></span>`;
  const cardClass = compact ? 'video-card' : 'library-row';
  const facebookScheduling = ['queued', 'uploading', 'finishing', 'scheduled', 'uncertain'].includes(video.facebook_schedule_state);
  const retryPublish = video.status === 'publish_failed' && !facebookScheduling;
  const retryMayDuplicate = retryPublish && !/\(#200\).*pages_manage_posts permission/i.test(video.last_error || '');
  const actions = [
    video.status === 'ready' && video.review_status !== 'approved' ? `<button class="mini-action" data-approve-id="${escapeHtml(video.id)}">DUYỆT</button>` : '',
    `<button class="mini-action" data-script-id="${escapeHtml(video.script_id)}">Kịch bản</button>`,
    !compact && video.status === 'ready' && video.review_status !== 'approved' && !video.published_id && !facebookScheduling ? `<button class="mini-action" data-background-effect-video-id="${escapeHtml(video.id)}">Nền riêng</button>` : '',
    video.status === 'failed' ? `<button class="mini-action" data-retry-video-id="${escapeHtml(video.id)}">Thử lại</button>` : '',
    video.status === 'ready' ? `<button class="mini-action" data-schedule-id="${escapeHtml(video.id)}">Lên lịch</button>` : '',
    (['ready', 'scheduled'].includes(video.status) && !facebookScheduling) || retryPublish ? `<button class="mini-action" data-publish-id="${escapeHtml(video.id)}" ${retryPublish ? `data-retry-publish="true" data-retry-may-duplicate="${retryMayDuplicate}"` : ''}>Đăng ngay</button>` : '',
    video.video_path ? `<a class="mini-action" href="/api/videos/${encodeURIComponent(video.id)}/file" download>MP4 ↓</a>` : '',
    !compact ? `<button class="mini-action danger-action" data-delete-video-id="${escapeHtml(video.id)}" ${facebookScheduling ? 'disabled title="Hãy hủy lịch trên Facebook trước khi xóa video trong ứng dụng"' : ['processing', 'script_ready', 'publishing'].includes(video.status) ? 'disabled title="Không thể xóa khi video đang được tạo hoặc đăng"' : ''}>Xóa</button>` : ''
  ].filter(Boolean).join('');
  const caption = escapeHtml(video.captionText || video.caption || '');
  const category = contentGroupLabel(video.content_language || video.contentLanguage);
  if (compact) return `<article class="${cardClass}"><a class="video-thumb" href="${video.video_path ? `/api/videos/${encodeURIComponent(video.id)}/file` : '#'}" ${video.video_path ? 'target="_blank"' : ''}>${thumb}<span class="video-badge">${escapeHtml(statusName(video.status, video))}</span></a><div class="video-info"><h3>${escapeHtml(video.topic || video.title)}</h3><p>${caption}</p><div class="video-meta"><span class="video-category">${escapeHtml(category)}</span><div class="video-actions">${actions}</div></div></div></article>`;
  return `<article class="${cardClass}"><div class="video-thumb">${thumb}<span class="video-badge">${escapeHtml(statusName(video.status, video))}</span></div><div class="library-main"><h3>${escapeHtml(video.title || video.topic)}</h3><p class="library-caption">${caption}</p><div class="row-meta"><span>${escapeHtml(category)}</span><span>•</span><span>${dateText(video.created_at, { dateStyle: 'medium' })}</span><span>•</span><span>${escapeHtml(video.provider || 'AI')}</span>${video.duration_seconds ? `<span>•</span><span>${Number(video.duration_seconds).toFixed(1)} giây</span>` : ''}</div>${video.facebook_error ? `<p class="inline-status">${escapeHtml(video.facebook_error)}</p>` : video.last_error && !video.pipeline?.error ? `<p class="inline-status">${escapeHtml(video.last_error)}</p>` : ''}${videoProgressMarkup(video)}</div><span class="state-pill ${statusClass(video.status, video)}">${escapeHtml(statusName(video.status, video))}</span><div class="row-actions">${actions}</div></article>`;
}

function currentVideoBackgroundEffectConfig(video) {
  const language = String(video.content_language || video.contentLanguage || 'en').toLowerCase();
  const isEnglishShadowing = language === 'english-shadowing';
  const saved = isEnglishShadowing
    ? (video.englishShadowingProfile?.backgroundEffectConfig || video.backgroundEffectConfig || {})
    : (video.backgroundEffectConfig || {});
  const defaults = isEnglishShadowing
    ? (state.englishShadowingSettings?.backgroundEffectConfig || { backgroundEffect: 'bubbles', backgroundEffectDensity: 28, backgroundEffectSpeed: 58, backgroundEffectOpacity: 32 })
    : (state.settings?.backgroundEffectProfiles?.[language] || state.settings || {});
  const effects = new Set(state.backgroundEffects.map((effect) => effect.id));
  const requestedEffect = saved.backgroundEffect || defaults.backgroundEffect || 'bubbles';
  const boundedInteger = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
  };
  return {
    backgroundEffect: effects.has(requestedEffect) ? requestedEffect : effects.has(defaults.backgroundEffect) ? defaults.backgroundEffect : 'bubbles',
    backgroundEffectDensity: boundedInteger(saved.backgroundEffectDensity ?? defaults.backgroundEffectDensity, 28, 10, 60),
    backgroundEffectSpeed: boundedInteger(saved.backgroundEffectSpeed ?? defaults.backgroundEffectSpeed, 58, 25, 140),
    backgroundEffectOpacity: boundedInteger(saved.backgroundEffectOpacity ?? defaults.backgroundEffectOpacity, 32, 10, 70)
  };
}

function normalizeBackgroundEffectProfileForUi(value, fallback = {}) {
  const profile = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const defaults = fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};
  const effects = new Set(state.backgroundEffects.map((effect) => effect.id));
  const boundedInteger = (input, fallbackValue, min, max) => {
    const number = Number(input);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallbackValue;
  };
  const fallbackEffect = effects.has(defaults.backgroundEffect) ? defaults.backgroundEffect : 'bubbles';
  return {
    backgroundEffect: effects.has(profile.backgroundEffect) ? profile.backgroundEffect : fallbackEffect,
    backgroundEffectDensity: boundedInteger(profile.backgroundEffectDensity ?? defaults.backgroundEffectDensity, 28, 10, 60),
    backgroundEffectSpeed: boundedInteger(profile.backgroundEffectSpeed ?? defaults.backgroundEffectSpeed, 58, 25, 140),
    backgroundEffectOpacity: boundedInteger(profile.backgroundEffectOpacity ?? defaults.backgroundEffectOpacity, 32, 10, 70)
  };
}

function normalizeBackgroundEffectProfilesForUi(settings = {}) {
  const legacy = {
    backgroundEffect: settings.backgroundEffect || 'bubbles',
    backgroundEffectDensity: settings.backgroundEffectDensity ?? 28,
    backgroundEffectSpeed: settings.backgroundEffectSpeed ?? 58,
    backgroundEffectOpacity: settings.backgroundEffectOpacity ?? 32
  };
  const profiles = settings.backgroundEffectProfiles && typeof settings.backgroundEffectProfiles === 'object'
    ? settings.backgroundEffectProfiles
    : {};
  return Object.fromEntries(['en', 'zh', 'ja'].map((language) => [
    language,
    normalizeBackgroundEffectProfileForUi(profiles[language], legacy)
  ]));
}

function storeCurrentBackgroundEffectProfile(language = state.backgroundEffectLanguage || 'en') {
  const profile = language === 'english-shadowing'
    ? (state.englishShadowingSettings ||= {}).backgroundEffectConfig ||= {}
    : state.backgroundEffectProfiles?.[language];
  if (!profile) return;
  profile.backgroundEffect = $('#background-effect')?.value || profile.backgroundEffect;
  profile.backgroundEffectDensity = Number(state.backgroundEffectDensity);
  profile.backgroundEffectSpeed = Number(state.backgroundEffectSpeed);
  profile.backgroundEffectOpacity = Number(state.backgroundEffectOpacity);
}

function applyBackgroundEffectProfile(language) {
  const selectedLanguage = ['en', 'zh', 'ja', 'english-shadowing'].includes(language) ? language : 'en';
  state.backgroundEffectLanguage = selectedLanguage;
  const selector = $('#background-effect-language');
  if (selector) selector.value = selectedLanguage;
  const profile = selectedLanguage === 'english-shadowing'
    ? normalizeBackgroundEffectProfileForUi(state.englishShadowingSettings?.backgroundEffectConfig || {}, { backgroundEffect: 'bubbles', backgroundEffectDensity: 28, backgroundEffectSpeed: 58, backgroundEffectOpacity: 32 })
    : state.backgroundEffectProfiles[selectedLanguage];
  if (!profile) return;
  if (selectedLanguage === 'english-shadowing' && state.englishShadowingSettings) {
    state.englishShadowingSettings.backgroundEffectConfig = { ...profile };
  }
  state.backgroundEffectDensity = profile.backgroundEffectDensity;
  state.backgroundEffectSpeed = profile.backgroundEffectSpeed;
  state.backgroundEffectOpacity = profile.backgroundEffectOpacity;
  const effectSelect = $('#background-effect');
  if (effectSelect) effectSelect.value = profile.backgroundEffect;
  syncBackgroundEffectPreview();
}

function applyVoiceHighlightContentProfile(profile) {
  const selected = ['english-shadowing', 'japanese', MOT_PHUT_CONTENT, THINGS_YOU_DIDNT_KNOW_CONTENT].includes(profile) ? profile : 'standard';
  state.voiceHighlightContentProfile = selected;
  const selector = $('#voice-highlight-content-profile');
  if (selector) selector.value = selected;
  window.motPhutVoLe?.setSettingsProfile?.('highlight', selected === MOT_PHUT_CONTENT);
  const standardControls = $('#standard-highlight-controls');
  const japaneseControls = $('#japanese-highlight-controls');
  const shadowingControls = $('#english-shadowing-highlight-controls');
  const thingsControls = $('#things-highlight-settings');
  if (standardControls) standardControls.style.display = selected === 'standard' ? 'grid' : 'none';
  if (japaneseControls) japaneseControls.style.display = selected === 'japanese' ? 'block' : 'none';
  if (shadowingControls) shadowingControls.style.display = selected === 'english-shadowing' ? 'block' : 'none';
  if (thingsControls) thingsControls.hidden = selected !== THINGS_YOU_DIDNT_KNOW_CONTENT;
  window.thingsYouDidntKnow?.setHighlightProfileActive?.(selected === THINGS_YOU_DIDNT_KNOW_CONTENT);
}

function syncVideoBackgroundEffectPreview() {
  const frame = $('#video-background-effect-preview-frame');
  const config = state.backgroundEffectEditor?.config;
  if (!frame?.contentWindow || !config) return;
  frame.contentWindow.postMessage({
    type: 'background-effect-preview:set-effect',
    effectId: config.backgroundEffect,
    density: config.backgroundEffectDensity,
    speed: config.backgroundEffectSpeed,
    opacity: config.backgroundEffectOpacity
  }, location.origin);
}

async function openVideoBackgroundEffectEditor(videoId) {
  const video = state.videos.find((item) => item.id === videoId);
  if (!video) return;
  try {
    if (!state.backgroundEffects.length) state.backgroundEffects = await api('/api/background-effects');
    if (!state.settings) state.settings = await api('/api/settings');
    const config = currentVideoBackgroundEffectConfig(video);
    state.backgroundEffectEditor = { videoId: video.id, config };
    const options = state.backgroundEffects.map((effect) => `<option value="${escapeHtml(effect.id)}" ${effect.id === config.backgroundEffect ? 'selected' : ''}>${escapeHtml(effect.label)} · ${escapeHtml(effect.description)}</option>`).join('');
    const title = video.title || video.topic || 'Video này';
    $('#background-effect-dialog-content').innerHTML = `<section class="video-background-editor"><div class="video-background-editor-heading"><div><div class="eyebrow">HIỆU ỨNG RIÊNG CHO VIDEO</div><h2>${escapeHtml(title)}</h2></div><span class="state-pill ${statusClass(video.status, video)}">${escapeHtml(statusName(video.status, video))}</span></div><label class="video-background-effect-select">Hiệu ứng nền<select data-video-background-effect>${options}</select></label><iframe id="video-background-effect-preview-frame" src="/bubble-effect-preview.html" title="Xem trước hiệu ứng nền riêng cho video"></iframe><p class="video-background-editor-note">Lưu sẽ render lại video này, giữ nguyên giọng đọc và căn chỉnh. Video cần được duyệt lại trước khi lên lịch. Bài Facebook đã đăng không tự thay đổi.</p><div class="video-background-editor-actions"><button class="button button-outline" type="button" data-close-background-effect>Đóng</button><button class="button button-dark" type="button" data-save-video-background-effect>Lưu & render lại</button></div></section>`;
    $('#background-effect-dialog').showModal();
    $('#video-background-effect-preview-frame').addEventListener('load', syncVideoBackgroundEffectPreview, { once: true });
    syncVideoBackgroundEffectPreview();
  } catch (error) { toast('Không mở được hiệu ứng nền riêng', true, error.message); }
}

async function saveVideoBackgroundEffect() {
  const editor = state.backgroundEffectEditor;
  const button = $('[data-save-video-background-effect]', $('#background-effect-dialog-content'));
  if (!editor || !button) return;
  button.disabled = true;
  try {
    const result = await api(`/api/videos/${encodeURIComponent(editor.videoId)}/background-effect`, {
      method: 'POST',
      body: JSON.stringify(editor.config)
    });
    $('#background-effect-dialog').close();
    toast('Đã lưu hiệu ứng riêng cho video', false, 'Worker đang render lại. Video sẽ cần được duyệt lại trước khi lên lịch.');
    watchJob(result.jobId);
    await refreshData();
  } catch (error) {
    toast('Không lưu được hiệu ứng nền', true, error.message);
    button.disabled = false;
  }
}

function renderOverview() {
  const data = state.overview;
  if (!data) return;
  $('#metric-videos').textContent = data.counts.videos;
  $('#metric-ready').textContent = data.counts.ready;
  $('#metric-scheduled').textContent = data.counts.scheduled;
  $('#metric-published').textContent = data.counts.published;
  $('#library-count').textContent = data.counts.library ?? data.counts.videos;
  $('#worker-label').textContent = data.system.worker ? 'Worker đang hoạt động' : 'Worker đang tắt';
  $('#worker-pill').classList.toggle('offline', !data.system.worker);
  $('#worker-note').hidden = data.system.worker;
  const history = data.contentHistory || { count: 0, bytes: 0 };
  const historyBytes = Number(history.bytes) || 0;
  const historySize = historyBytes >= 1024 * 1024 ? `${(historyBytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(historyBytes / 1024)} KB`;
  const historyWarning = historyBytes >= 100 * 1024 * 1024 ? ' C\u1ea3nh b\u00e1o: l\u1ecbch s\u1eed \u0111\u00e3 v\u01b0\u1ee3t 100 MB.' : '';
  $('#content-history-note').textContent = `\u0110\u1ec3 tr\u1ed1ng ch\u1ee7 \u0111\u1ec1, ChatGPT Plan t\u1ef1 ch\u1ecdn t\u1eeb hi\u1ec3u bi\u1ebft r\u1ed9ng; ch\u1ee7 \u0111\u1ec1 trong danh s\u00e1ch ch\u1ec9 l\u00e0 g\u1ee3i \u00fd. \u0110ang gi\u1eef ${history.count} k\u1ecbch b\u1ea3n ch\u1ed1ng tr\u00f9ng (${historySize} v\u0103n b\u1ea3n); x\u00f3a MP4 kh\u00f4ng x\u00f3a l\u1ecbch s\u1eed.${historyWarning}`;
  const ready = (ok) => `<span class="status-indicator ${ok ? 'ok' : ''}"></span>`;
  const overviewTtsProvider = providerForContentLanguage(data.settings.contentLanguage || 'en', data.settings);
  const ttsKey = ({ vieneu: 'vieneuTts', 'vieneu-sbv2': 'styleBertVits2Tts', 'vieneu-cosyvoice3': 'cosyVoice3Tts' })[overviewTtsProvider] || 'vieneuTts';
  const ttsError = data.system.tools.errors?.[ttsKey];
  const ffmpegError = data.system.tools.errors?.ffmpeg;
  const ttsNames = { vieneu: 'VieNeu + Kokoro', 'vieneu-sbv2': 'VieNeu + Style-Bert-VITS2', 'vieneu-cosyvoice3': 'VieNeu + CosyVoice 3.0' };
  const ttsStatus = ttsError ? `Không khởi chạy được (${ttsError})` : (data.system.tools[ttsKey] ? `${ttsNames[overviewTtsProvider]} sẵn sàng` : `${ttsNames[overviewTtsProvider]} chưa sẵn sàng`);
  const ffmpegStatus = ffmpegError ? `FFmpeg không khởi chạy được (${ffmpegError})` : (data.system.tools.ffmpeg ? 'FFmpeg' : 'Thiếu FFmpeg');
  const rows = [
    ['SQLite', data.system.database, data.system.database ? 'Đang lưu dữ liệu local' : 'Chưa khởi tạo database'],
    ['Worker nền', data.system.worker, data.system.worker ? 'Đang lấy job từ hàng đợi' : 'Chạy npm run worker'],
    ['AI viết nội dung', data.system.aiReady, data.providers.chatgptPlan.connected ? 'ChatGPT plan đã kết nối' : 'Kết nối ChatGPT Plan để tạo nội dung'],
    ['Media engine', data.system.tools.ffmpeg && data.system.tools.ffprobe && data.system.tools[ttsKey], `${ttsStatus} · ${ffmpegStatus}`],
    ['Facebook', data.system.liveFacebookReady, data.settings.facebookAdapter === 'mock' ? 'Đang ở chế độ thử nghiệm Mock' : (data.system.liveFacebookReady ? 'Đã kiểm tra ít nhất một Page theo ngôn ngữ' : 'Chưa kiểm tra Page và token theo ngôn ngữ')]
  ];
  $('#status-grid').innerHTML = rows.map(([name, ok, detail]) => `<div class="status-card">${ready(ok)}<div class="status-copy"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></div></div>`).join('');
  const videos = data.videos || [];
  const recentVideos = videos.slice(0, 3).map((video) => videoCard(video, true));
  const latestMotPhutVideo = (state.motPhutVideos || [])
    .filter((video) => video.status === 'complete' && video.videoPath)
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))[0];
  if (latestMotPhutVideo) {
    const motPhutCard = window.motPhutVoLe?.renderRecentCard?.(latestMotPhutVideo);
    if (motPhutCard) recentVideos.push(motPhutCard);
  }
  $('#recent-videos').innerHTML = recentVideos.length ? recentVideos.join('') : data.counts.videos
    ? `<div class="empty-state" style="grid-column:1/-1"><strong>Video đã được chuyển sang lịch đăng</strong>Theo dõi các bài đang chờ Facebook đăng trong mục Lịch đăng.</div>`
    : `<div class="empty-state" style="grid-column:1/-1"><strong>Thư viện đang chờ video đầu tiên</strong>Khi AI, model giọng đọc và FFmpeg sẵn sàng, tạo video từ chủ đề phía trên.</div>`;
  state.system = data.system;
  state.settings = data.settings;
  const savedLanguage = ['en', 'ja', 'zh'].includes(data.settings.contentLanguage) ? data.settings.contentLanguage : 'en';
  const savedContentMode = localStorage.getItem('things-you-didnt-know-content-mode') === 'true' ? THINGS_YOU_DIDNT_KNOW_CONTENT
    : localStorage.getItem('mot-phut-vo-le-content-mode') === 'true' ? MOT_PHUT_CONTENT : savedLanguage;
  if (!state.createLanguageSelectionTouched && document.activeElement !== $('#content-language')) $('#content-language').value = savedContentMode;
  const visibleLanguage = state.createLanguageSelectionTouched ? $('#content-language').value : savedContentMode;
  if (visibleLanguage !== MOT_PHUT_CONTENT) {
    const topicMode = visibleLanguage === 'ja' ? 'ja' : 'topics';
    if ($('#topic-select').dataset.languageMode !== topicMode) {
      $('#content-language').value = visibleLanguage;
      renderTopics();
    }
  }
  const heroCopy = $('#content-language').closest('.hero-copy')?.querySelector(':scope > p');
  if (heroCopy) heroCopy.textContent = contentLanguageDescription(visibleLanguage);
  window.dispatchEvent(new CustomEvent('mot-phut-mode-change', { detail: { active: visibleLanguage === MOT_PHUT_CONTENT } }));
  window.dispatchEvent(new CustomEvent('things-you-didnt-know-mode-change', { detail: { active: visibleLanguage === THINGS_YOU_DIDNT_KNOW_CONTENT } }));
  renderToolChecks(data.system.tools);
  $$('.mini-action,[data-publish-id],[data-schedule-id],[data-approve-id]').forEach((button) => button.addEventListener('click', handleVideoAction));
}

function renderToolChecks(tools = {}) {
  const labels = { python: 'Python căn chỉnh', vieneuTts: 'VieNeu local', kokoroTts: 'Kokoro local', styleBertVits2Tts: 'Style-Bert-VITS2 Nhật', cosyVoice3Tts: 'CosyVoice 3.0 Trung', supertonicKoreanTts: 'Supertonic 3 tiếng Hàn', ffmpeg: 'FFmpeg', ffprobe: 'FFprobe' };
  $('#tool-checks').innerHTML = Object.entries(labels).map(([key, name]) => {
    const supported = !['vieneuTts', 'kokoroTts', 'styleBertVits2Tts', 'cosyVoice3Tts', 'supertonicKoreanTts'].includes(key) || Object.hasOwn(tools, key);
    const error = tools.errors?.[key];
    const status = !supported ? 'cần khởi động lại app' : tools[key] ? 'sẵn sàng' : error ? `không khởi chạy được (${error})` : 'chưa có';
    return `<span class="tool-chip"><span class="status-indicator ${supported && tools[key] ? 'ok' : ''}"></span>${name} ${status}</span>`;
  }).join('');
}

function renderTopics() {
  const select = $('#topic-select');
  const previousMode = select.dataset.languageMode || 'topics';
  const previousSelection = select.value;
  const japanese = $('#content-language').value === 'ja';
  if (japanese && previousMode !== 'ja') select.dataset.savedTopicId = previousSelection;
  select.dataset.languageMode = japanese ? 'ja' : 'topics';
  $('#add-topic').disabled = japanese;
  if (japanese) {
    select.innerHTML = '<option value="">AI tự chọn chủ đề tiếng Nhật mới</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  const groups = new Map();
  for (const topic of state.topics) {
    if (!groups.has(topic.category)) groups.set(topic.category, []);
    groups.get(topic.category).push(topic);
  }
  select.innerHTML = `<option value="">${autoTopicLabel}</option>` + [...groups].map(([category, topics]) => `<optgroup label="${escapeHtml(category)}">${topics.map((topic) => `<option value="${escapeHtml(topic.id)}">${escapeHtml(topic.title)}${topic.used_at && Date.now() - new Date(topic.used_at).getTime() < 14 * 86400000 ? ' · vừa dùng' : ''}</option>`).join('')}</optgroup>`).join('');
  const restoreTopicId = previousMode === 'ja' ? select.dataset.savedTopicId || '' : previousSelection;
  if (restoreTopicId && [...select.options].some((option) => option.value === restoreTopicId)) select.value = restoreTopicId;
  delete select.dataset.savedTopicId;
}

function renderLibrary() {
  const all = state.videos;
  const production = all.filter((v) => !isFacebookScheduleAccepted(v));
  const statusMatches = state.filter === 'failed' ? production.filter((v) => ['failed', 'publish_failed'].includes(v.status))
    : state.filter === 'all' ? production
      : state.filter === 'scheduled' ? all.filter((v) => v.status === 'scheduled')
        : production.filter((v) => v.status === state.filter);
  const languageFilter = $('#content-language-filter')?.value || 'all';
  const matches = statusMatches.filter((video) => languageFilter === 'all' || (video.content_language || video.contentLanguage || 'en') === languageFilter);
  $('#video-count').textContent = `${matches.length} VIDEO`;
  const emptyCopy = state.filter === 'all' && all.length && all.every(isFacebookScheduleAccepted)
    ? 'Các video đã được chuyển sang mục Lịch đăng. Chọn tab “Đã lên lịch” để xem lại.'
    : state.filter === 'all' ? 'Tạo video đầu tiên từ bảng Tổng quan.' : 'Video sẽ xuất hiện tại đây sau khi trạng thái thay đổi.';
  $('#library-list').innerHTML = matches.length ? matches.map((video) => videoCard(video)).join('') : `<div class="empty-state"><strong>Chưa có video trong mục này</strong>${emptyCopy}</div>`;
  $$('.library-row [data-script-id],.library-row [data-background-effect-video-id],.library-row [data-retry-video-id],.library-row [data-approve-id],.library-row [data-schedule-id],.library-row [data-publish-id],.library-row [data-delete-video-id]').forEach((button) => button.addEventListener('click', handleVideoAction));
  window.dispatchEvent(new Event('library:rendered'));
}

function facebookScheduleLanguage(language) {
  const key = String(language || 'en').toLowerCase();
  const known = {
    en: { name: 'Tiếng Anh', code: 'EN', short: 'EN' },
    zh: { name: 'Tiếng Trung', code: 'ZH', short: 'ZH' },
    ja: { name: 'Tiếng Nhật', code: 'JA', short: 'JA' },
    'english-shadowing': { name: 'EnglishShadowing', code: 'SH', short: 'SH' },
    'mot-phut-vo-le': { name: 'Một Phút Vỡ Lẽ', code: 'MPVL', short: 'MP' }
  };
  return known[key] || {
    name: key.replace(/[-_]+/g, ' '),
    code: key.replace(/[^a-z0-9]/g, '').slice(0, 3).toUpperCase() || '—',
    short: key.replace(/[^a-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'
  };
}

function scheduleLanguageClass(language) {
  return `lang-${String(language || 'en').toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
}

function scheduleLocalDayKey(value, timeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftScheduleDay(dayKey, offset) {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function shiftScheduleMonth(monthKey, offset) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function scheduleDayLabel(dayKey) {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', day: 'numeric', month: 'short' })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function scheduleCoverage(items) {
  if (!items.length) return { text: 'Chưa có lịch', className: 'empty' };
  const posted = items.filter((item) => item.isPublished || item.facebook_schedule_state === 'published').length;
  const scheduled = items.filter((item) => item.facebook_schedule_state === 'scheduled').length;
  const sending = items.filter((item) => ['queued', 'uploading', 'finishing'].includes(item.facebook_schedule_state)).length;
  const failed = items.filter((item) => item.status === 'failed' || item.video_status === 'publish_failed' || ['failed', 'uncertain'].includes(item.facebook_schedule_state)).length;
  const local = items.filter((item) => item.facebook_schedule_state === 'local').length;
  const parts = [];
  if (posted) parts.push(`${posted} đã đăng`);
  if (scheduled) parts.push(`${scheduled} đã lên lịch Facebook`);
  if (sending) parts.push(`${sending} đang gửi`);
  if (local) parts.push(`${local} mới lên lịch trong tool`);
  if (failed) parts.push(`${failed} cần kiểm tra`);
  return {
    text: `${items.length} bài · ${parts.join(' · ') || 'đang xử lý'}`,
    className: failed ? 'error' : posted || scheduled ? 'ok' : sending ? 'pending' : 'local'
  };
}

function scheduleItemStatusLabel(item) {
  const scheduleState = item.facebook_schedule_state;
  if (item.status === 'failed' || item.video_status === 'publish_failed' || scheduleState === 'failed') return 'Cần kiểm tra';
  if (scheduleState === 'uncertain') return 'Chưa xác minh trên Facebook';
  if (item.isPublished || scheduleState === 'published') return 'Đã đăng';
  if (scheduleState === 'scheduled') return 'Đã lên lịch Facebook';
  if (['queued', 'uploading', 'finishing'].includes(scheduleState)) return 'Đang gửi lên Facebook';
  if (scheduleState === 'local') return 'Đang chờ đăng';
  return 'Đang xử lý';
}

function renderScheduleLanguageOverview() {
  const container = $('#schedule-language-overview');
  if (!container) return;
  const timeZone = state.settings?.timezone || 'Asia/Ho_Chi_Minh';
  const todayKey = scheduleLocalDayKey(new Date(), timeZone);
  const tomorrowKey = shiftScheduleDay(todayKey, 1);
  const allSchedules = [
    ...state.schedules,
    ...state.motPhutSchedules.filter((item) => item.status !== 'cancelled').map((item) => ({
      id: item.id, content_language: 'mot-phut-vo-le', topic: item.topic, title: item.title,
      scheduled_at: item.scheduledAt, status: item.status === 'failed' ? 'failed' : item.status,
      facebook_schedule_state: item.facebookScheduleState, facebook_error: item.facebookError,
      isPublished: item.status === 'published'
    })),
    ...state.publishedSchedules.map((item) => ({ ...item, isPublished: true }))
  ];
  if (!scheduleCalendarMonth) {
    scheduleCalendarMonth = tomorrowKey.slice(0, 7);
  }
  if (scheduleSelectedDay && scheduleSelectedDay.slice(0, 7) !== scheduleCalendarMonth) {
    scheduleSelectedDay = '';
    scheduleDetailsOpen = false;
    scheduleLanguageFilter = 'all';
  }

  const [year, month] = scheduleCalendarMonth.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const leadingCells = (firstWeekday + 6) % 7;
  const monthLabel = new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 15)));
  const knownLanguages = ['en', 'zh', 'ja', 'english-shadowing', 'mot-phut-vo-le'];
  const monthLanguages = allSchedules
    .filter((item) => scheduleLocalDayKey(item.scheduled_at, timeZone).startsWith(`${scheduleCalendarMonth}-`))
    .map((item) => String(item.content_language || 'en').toLowerCase());
  const languages = [...new Set([...knownLanguages, ...monthLanguages])].sort((left, right) => {
    const leftIndex = knownLanguages.indexOf(left);
    const rightIndex = knownLanguages.indexOf(right);
    if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
    return facebookScheduleLanguage(left).name.localeCompare(facebookScheduleLanguage(right).name);
  });
  const itemsForDay = (day) => allSchedules.filter((item) =>
    scheduleLocalDayKey(item.scheduled_at, timeZone) === day
  );
  const blanks = Array.from({ length: leadingCells }, () => '<span class="schedule-calendar-blank" aria-hidden="true"></span>').join('');
  const languageLegend = languages.map((language) => {
    const info = facebookScheduleLanguage(language);
    return `<span title="${escapeHtml(info.name)}"><i class="schedule-calendar-dot ${scheduleLanguageClass(language)} filled"></i>${escapeHtml(info.short)}</span>`;
  }).join('');
  const calendarDays = Array.from({ length: daysInMonth }, (_, index) => {
    const dayNumber = index + 1;
    const dayKey = `${scheduleCalendarMonth}-${String(dayNumber).padStart(2, '0')}`;
    const dayItems = itemsForDay(dayKey);
    const hasIssue = dayItems.some((item) => item.status === 'failed' || item.video_status === 'publish_failed' || ['failed', 'uncertain'].includes(item.facebook_schedule_state));
    const activeLanguages = languages.filter((language) => dayItems.some((item) => String(item.content_language || 'en').toLowerCase() === language));
    const languageDots = activeLanguages.slice(0, 4).map((language) => {
      const languageItems = dayItems.filter((item) => String(item.content_language || 'en').toLowerCase() === language);
      const failed = languageItems.some((item) => item.status === 'failed' || item.video_status === 'publish_failed' || ['failed', 'uncertain'].includes(item.facebook_schedule_state));
      const info = facebookScheduleLanguage(language);
      return `<span class="schedule-calendar-dot ${scheduleLanguageClass(language)} filled${failed ? ' error' : ''}" title="${escapeHtml(info.name)}: ${languageItems.length} bài"></span>`;
    }).join('') + (activeLanguages.length > 4 ? `<span class="schedule-calendar-more">+${activeLanguages.length - 4}</span>` : '');
    const daySummary = dayItems.length ? `${dayItems.length} bài` : 'Chưa có lịch';
    const classes = [
      'schedule-calendar-day',
      scheduleDetailsOpen && dayKey === scheduleSelectedDay ? 'selected' : '',
      dayKey === todayKey ? 'today' : '',
      dayItems.length ? 'has-schedule' : '',
      hasIssue ? 'has-issue' : ''
    ].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-schedule-day="${dayKey}" aria-pressed="${scheduleDetailsOpen && dayKey === scheduleSelectedDay}"><span class="schedule-calendar-date">${dayNumber}</span><span class="schedule-calendar-summary">${daySummary}</span><span class="schedule-calendar-dots" aria-hidden="true">${languageDots}</span></button>`;
  }).join('');
  const selectedItems = scheduleSelectedDay ? itemsForDay(scheduleSelectedDay) : [];
  const selectedDateLabel = scheduleSelectedDay ? scheduleDayLabel(scheduleSelectedDay) : '';
  const selectedIsTomorrow = scheduleSelectedDay === tomorrowKey;
  const selectedLanguages = languages.filter((language) => selectedItems.some((item) => String(item.content_language || 'en').toLowerCase() === language));
  if (scheduleLanguageFilter !== 'all' && !selectedLanguages.includes(scheduleLanguageFilter)) scheduleLanguageFilter = 'all';
  const visibleLanguages = scheduleLanguageFilter === 'all' ? selectedLanguages : selectedLanguages.filter((language) => language === scheduleLanguageFilter);
  const filterButtons = [
    `<button type="button" class="schedule-language-filter${scheduleLanguageFilter === 'all' ? ' active' : ''}" data-schedule-language-filter="all" aria-pressed="${scheduleLanguageFilter === 'all'}">Tất cả <span>${selectedItems.length}</span></button>`,
    ...selectedLanguages.map((language) => {
      const info = facebookScheduleLanguage(language);
      const count = selectedItems.filter((item) => String(item.content_language || 'en').toLowerCase() === language).length;
      return `<button type="button" class="schedule-language-filter${scheduleLanguageFilter === language ? ' active' : ''}" data-schedule-language-filter="${escapeHtml(language)}" aria-pressed="${scheduleLanguageFilter === language}"><i class="schedule-calendar-dot ${scheduleLanguageClass(language)} filled"></i>${escapeHtml(info.name)} <span>${count}</span></button>`;
    })
  ].join('');
  const detailGroups = visibleLanguages.map((language) => {
    const info = facebookScheduleLanguage(language);
    const items = selectedItems.filter((item) => String(item.content_language || 'en').toLowerCase() === language);
    const coverage = scheduleCoverage(items);
    const rows = [...items].sort((left, right) => Date.parse(left.scheduled_at) - Date.parse(right.scheduled_at)).map((item) => {
      const timestamp = Date.parse(item.scheduled_at);
      const time = Number.isFinite(timestamp) ? dateText(item.scheduled_at, { hour: '2-digit', minute: '2-digit' }) : '—';
      const title = item.topic || item.title || 'Nội dung';
      const status = scheduleItemStatusLabel(item);
      const statusClass = ['Cần kiểm tra', 'Chưa xác minh trên Facebook'].includes(status) ? 'error' : status === 'Đã đăng' || status === 'Đã lên lịch Facebook' ? 'ok' : 'pending';
      return `<li class="schedule-detail-item"><time>${escapeHtml(time)}</time><div><strong>${escapeHtml(title)}</strong><small class="${statusClass}">${escapeHtml(status)}</small></div></li>`;
    }).join('');
    return `<section class="schedule-language-group ${coverage.className}"><header><i class="schedule-calendar-dot ${scheduleLanguageClass(language)} filled"></i><strong>${escapeHtml(info.name)} (${escapeHtml(info.code)})</strong><small>${escapeHtml(coverage.text)}</small></header><ul>${rows}</ul></section>`;
  }).join('');
  const selectedDetails = scheduleDetailsOpen ? `<div class="schedule-selected-day"><div class="schedule-selected-day-heading"><div><strong>${selectedIsTomorrow ? 'Ngày mai · ' : ''}${escapeHtml(selectedDateLabel)}</strong><small>${selectedItems.length ? `${selectedItems.length} lịch tổng cộng` : 'Ngày này chưa có lịch đăng.'}</small></div><button type="button" class="schedule-details-close" data-hide-schedule-details aria-label="Ẩn chi tiết lịch">Ẩn</button></div>${selectedItems.length ? `<div class="schedule-language-filters" aria-label="Lọc lịch theo loại nội dung">${filterButtons}</div><div class="schedule-language-groups">${detailGroups}</div>` : '<p class="schedule-details-empty">Chọn ngày có lịch để xem nội dung và trạng thái đăng.</p>'}</div>` : '';

  container.innerHTML = `<section class="schedule-language-overview"><div class="schedule-language-overview-heading"><div><strong>Tình trạng lịch theo Page</strong><small>Bấm vào một ngày để mở chi tiết lịch theo loại nội dung.</small></div></div><div class="schedule-calendar"><div class="schedule-calendar-toolbar"><button type="button" class="schedule-calendar-nav" data-schedule-month="-1" aria-label="Tháng trước">‹</button><strong>${monthLabel}</strong><button type="button" class="schedule-calendar-nav" data-schedule-month="1" aria-label="Tháng sau">›</button></div><div class="schedule-calendar-legend">${languageLegend}</div><div class="schedule-calendar-weekdays">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((day) => `<span>${day}</span>`).join('')}</div><div class="schedule-calendar-grid">${blanks}${calendarDays}</div></div>${selectedDetails}</section>`;
  $$('[data-schedule-day]', container).forEach((button) => button.addEventListener('click', () => {
    const dayKey = button.dataset.scheduleDay;
    if (scheduleDetailsOpen && scheduleSelectedDay === dayKey) scheduleDetailsOpen = false;
    else { scheduleSelectedDay = dayKey; scheduleDetailsOpen = true; }
    scheduleLanguageFilter = 'all';
    renderScheduleLanguageOverview();
  }));
  $$('[data-schedule-month]', container).forEach((button) => button.addEventListener('click', () => {
    scheduleCalendarMonth = shiftScheduleMonth(scheduleCalendarMonth, Number(button.dataset.scheduleMonth));
    scheduleSelectedDay = '';
    scheduleDetailsOpen = false;
    scheduleLanguageFilter = 'all';
    renderScheduleLanguageOverview();
  }));
  $$('[data-schedule-language-filter]', container).forEach((button) => button.addEventListener('click', () => {
    scheduleLanguageFilter = button.dataset.scheduleLanguageFilter;
    renderScheduleLanguageOverview();
  }));
  $('[data-hide-schedule-details]', container)?.addEventListener('click', () => {
    scheduleDetailsOpen = false;
    renderScheduleLanguageOverview();
  });
}

function renderSchedules() {
  if (!$('#published-list')) {
    $('#schedule-list').insertAdjacentHTML('afterend', '<div class="section-heading schedule-list-heading"><div><div class="eyebrow">LỊCH SỬ NỘI DUNG</div><h2>Đã đăng thành công</h2></div></div><div class="schedule-list" id="published-list"></div>');
  }
  const schedules = state.schedules;
  const available = state.videos.filter((v) => v.status === 'ready');
  const moduleAvailable = state.motPhutVideos.filter((video) => video.status === 'complete' && !state.motPhutSchedules.some((item) => item.contentId === video.id && item.status !== 'cancelled'));
  $('#schedule-video').innerHTML = `<option value="">Chọn video</option>${available.map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.topic)}</option>`).join('')}${moduleAvailable.length ? `<optgroup label="Một Phút Vỡ Lẽ · tiếng Việt">${moduleAvailable.map((video) => `<option value="${escapeHtml(video.id)}">${escapeHtml(video.title || video.topic)}</option>`).join('')}</optgroup>` : ''}`;
  const visible = schedules.filter((item) => item.status !== 'published');
  renderScheduleLanguageOverview();
  $('#schedule-list').innerHTML = visible.length ? visible.map((item) => {
    const failed = item.status === 'failed' || ['failed', 'publish_failed'].includes(item.video_status)
      || item.last_publish_status === 'failed' || ['failed', 'uncertain'].includes(item.facebook_schedule_state);
    const scheduleTimestamp = Date.parse(item.scheduled_at);
    const pastDue = Number.isFinite(scheduleTimestamp) && scheduleTimestamp <= Date.now();
    const purgeBlocked = item.status === 'publishing' || ['processing', 'script_ready', 'publishing', 'published'].includes(item.video_status)
      || ['queued', 'uploading', 'finishing', 'published'].includes(item.facebook_schedule_state);
    const canPurge = !purgeBlocked && item.status !== 'published' && (failed || pastDue);
    const retryableFacebookState = ['local', 'failed', 'uncertain'].includes(item.facebook_schedule_state)
      || (item.facebook_schedule_state === 'scheduled' && !item.facebook_video_id);
    const canRetry = item.status !== 'published' && item.status !== 'publishing'
      && (item.status === 'failed' || item.video_status === 'publish_failed' || retryableFacebookState);
    const stateLabel = item.facebook_schedule_state === 'scheduled' ? 'Đã lên lịch trên Facebook'
      : item.facebook_schedule_state === 'published' ? 'Đã đăng trên Facebook'
        : item.facebook_schedule_state === 'uncertain' ? 'Chưa xác minh được lịch Facebook'
          : item.facebook_schedule_state === 'failed' ? 'Gửi lịch Facebook thất bại'
            : ['queued', 'uploading', 'finishing'].includes(item.facebook_schedule_state) ? 'Đang gửi lịch lên Facebook'
              : item.facebook_schedule_state === 'local' && state.settings?.facebookAdapter === 'meta' ? 'Chưa gửi lịch lên Facebook'
                : item.status === 'publishing' ? 'Đang đăng' : 'Đã lên lịch trong ứng dụng';
    const retryHint = canRetry && !item.error && item.facebook_schedule_state === 'local' && state.settings?.facebookAdapter === 'meta'
      ? `<small class="schedule-error">Page ${escapeHtml(String(item.content_language || 'en').toUpperCase())} chưa được xác minh hoặc token chưa sẵn sàng.</small>` : '';
    const error = failed && item.error ? `<small class="schedule-error">${escapeHtml(item.error)}</small>` : retryHint;
    const retryButton = canRetry ? `<button class="button button-outline button-small schedule-retry" data-retry-schedule-id="${escapeHtml(item.id)}">Đăng lại</button>` : '';
    const purgeButton = canPurge ? `<button class="mini-action danger-action" data-purge-schedule-id="${escapeHtml(item.id)}">Xóa sạch</button>` : '';
    const deleteButton = canRetry && !canPurge ? `<button class="mini-action danger-action" data-delete-schedule-id="${escapeHtml(item.id)}">Xóa lịch</button>` : '';
    const scheduleActions = retryButton || purgeButton || deleteButton ? `<div class="button-row">${retryButton}${purgeButton || deleteButton}</div>` : '';
    const language = facebookScheduleLanguage(item.content_language || 'en');
    const languageStateLabel = item.facebook_schedule_state === 'scheduled'
      ? `Đã lên lịch nội dung Facebook ${language.name} (${language.code})`
      : `Nội dung Facebook ${language.name} (${language.code}) · ${stateLabel}`;
    return `<article class="schedule-row${failed ? ' failed' : ''}"><span class="schedule-date">${dateText(item.scheduled_at, { month: 'short', day: 'numeric' })}</span><div class="schedule-copy"><strong>${escapeHtml(item.topic)}</strong><small>${escapeHtml(item.title)} · ${languageStateLabel}</small>${error}</div><div class="schedule-time-actions"><span class="schedule-time">${dateText(item.scheduled_at, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span>${scheduleActions}</div></article>`;
  }).join('') : `<div class="empty-state"><strong>Chưa có lịch đăng</strong>Bật “Tự đăng theo lịch” trong cài đặt để xếp video sẵn sàng tự động.</div>`;
  const moduleVisible = state.motPhutSchedules.filter((item) => item.status !== 'cancelled');
  if (moduleVisible.length) {
    $('#schedule-list').querySelector('.empty-state')?.remove();
    const moduleRows = moduleVisible.map((item) => {
      const error = item.facebookError ? `<small class="${['failed', 'uncertain'].includes(item.facebookScheduleState) ? 'error' : ''}">${escapeHtml(item.facebookError)}</small>` : '';
      const remoteState = item.facebookScheduleState === 'published' ? 'Facebook MPVL đã đăng' : item.facebookScheduleState === 'scheduled' ? 'Facebook đã nhận lịch MPVL'
        : item.facebookScheduleState === 'uncertain' ? 'Chưa xác minh được lịch Facebook MPVL'
          : item.facebookScheduleState === 'failed' ? 'Gửi lịch MPVL lên Facebook thất bại'
            : item.facebookScheduleState === 'queued' || ['uploading', 'finishing'].includes(item.facebookScheduleState) ? 'Đang gửi lịch MPVL lên Facebook'
              : Date.parse(item.scheduledAt) <= Date.now() ? 'Đến giờ · lịch MPVL đang lưu trong tool' : 'Đã lên lịch MPVL trong tool';
      const canDelete = !['publishing', 'published'].includes(item.status);
      return `<article class="schedule-row mot-phut-schedule-row${['failed', 'uncertain'].includes(item.facebookScheduleState) ? ' failed' : ''}"><span class="schedule-date">${dateText(item.scheduledAt, { month: 'short', day: 'numeric' })}</span><div class="schedule-copy"><strong>${escapeHtml(item.title || item.topic || 'Một Phút Vỡ Lẽ')}</strong><small>MPVL · Tiếng Việt · ${remoteState}</small>${error}</div><div class="schedule-time-actions"><span class="schedule-time">${dateText(item.scheduledAt, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span>${canDelete ? `<button class="mini-action danger-action" data-mot-phut-delete-schedule-id="${escapeHtml(item.id)}">Xóa lịch</button>` : ''}</div></article>`;
    }).join('');
    $('#schedule-list').insertAdjacentHTML('beforeend', moduleRows);
  }
  $$('[data-retry-schedule-id]').forEach((button) => button.addEventListener('click', retryScheduledPost));
  $$('[data-delete-schedule-id]').forEach((button) => button.addEventListener('click', deleteScheduledPost));
  $$('[data-purge-schedule-id]').forEach((button) => button.addEventListener('click', purgeScheduledPost));
  $('#published-list').innerHTML = state.publishedSchedules.length ? state.publishedSchedules.map((item) => {
    const mode = item.adapter === 'mock' ? ' · Bản chạy thử' : '';
    const language = facebookScheduleLanguage(item.content_language || 'en');
    return `<article class="schedule-row published-row"><span class="schedule-date">Đã đăng</span><div class="schedule-copy"><strong>${escapeHtml(item.title || item.topic)}</strong><small>${escapeHtml(item.topic)} · Đã đăng nội dung Facebook ${language.name} (${language.code}) · Facebook xác nhận ${dateText(item.published_at, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}${mode}</small><small>Giờ đã xếp: ${dateText(item.scheduled_at, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</small><details><summary>Xem nội dung bài đăng</summary><p style="white-space:pre-wrap">${escapeHtml(item.caption || '')}</p></details></div><button class="mini-action danger-action" data-delete-published-id="${escapeHtml(item.id)}">Xóa</button></article>`;
  }).join('') : `<div class="empty-state"><strong>Chưa có bài đăng thành công</strong>Khi Facebook xác nhận đăng xong, thông tin bài viết và thời gian sẽ được lưu tại đây.</div>`;
  window.dispatchEvent(new Event('schedules:rendered'));
}

function renderLogs() {
  $('#logs-list').innerHTML = state.logs.length ? state.logs.map((item) => `<div class="log-row"><span>${dateText(item.created_at, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><span class="log-level ${escapeHtml(item.level)}">${escapeHtml(item.level)}</span><strong>${escapeHtml(item.code || 'EVENT')}</strong><span>${escapeHtml(item.message)}</span></div>`).join('') : `<div class="empty-state">Chưa có nhật ký.</div>`;
}

async function loadOverview() {
  state.overview = await api('/api/overview');
  renderOverview();
}

async function loadVideos() {
  const result = await api('/api/videos');
  state.videos = result.videos;
  renderLibrary();
  if (state.view === 'schedule') renderSchedules();
  $('#library-count').textContent = state.videos.filter((video) => !isFacebookScheduleAccepted(video)).length;
}

async function loadSchedules() {
  const [scheduleData, videoData, motPhutData] = await Promise.all([
    api('/api/schedules'), api('/api/videos'),
    Promise.all([api('/api/mot-phut-vo-le/schedules'), api('/api/mot-phut-vo-le/videos')]).catch(() => [{ schedules: [] }, { videos: [] }])
  ]);
  state.schedules = scheduleData.schedules;
  state.publishedSchedules = scheduleData.published || [];
  state.videos = videoData.videos;
  state.motPhutSchedules = motPhutData[0].schedules || [];
  state.motPhutVideos = motPhutData[1].videos || [];
  renderSchedules();
  window.dispatchEvent(new CustomEvent('mot-phut-schedule-state', { detail: { schedules: state.motPhutSchedules } }));
}

async function loadLogs() {
  const revision = logsRevision;
  const response = await api('/api/logs');
  if (revision !== logsRevision) return;
  state.logs = response.logs || [];
  renderLogs();
}

function selectSavedVoice(select, voice) {
  const value = String(voice || '');
  if (value && ![...select.options].some((option) => option.value === value)) {
    select.add(new Option(`${value} (giọng đã lưu)`, value));
  }
  if (value) select.value = value;
}

function updateTtsProviderPanels() {
  const provider = $('#tts-provider').value;
  const shadowingSelected = state.ttsProviderView === 'english-shadowing';
  const motPhutSelected = state.ttsProviderView === MOT_PHUT_CONTENT;
  const thingsSelected = state.ttsProviderView === THINGS_YOU_DIDNT_KNOW_CONTENT;
  const specialProfileSelected = shadowingSelected || motPhutSelected || thingsSelected;
  $('#vieneu-tts-settings').hidden = specialProfileSelected || !['vieneu', 'supertonic3-ko'].includes(provider);
  $('#sbv2-tts-settings').hidden = specialProfileSelected || provider !== 'vieneu-sbv2';
  $('#cosyvoice-tts-settings').hidden = specialProfileSelected || provider !== 'vieneu-cosyvoice3';
  $('#supertonic-ko-tts-settings').hidden = specialProfileSelected || provider !== 'supertonic3-ko';
  $('.english-shadowing-voice-settings').hidden = !shadowingSelected;
  renderTtsProviderMenu();
  window.dispatchEvent(new CustomEvent('things-you-didnt-know-voice-profile-change', { detail: { active: thingsSelected } }));
}

function renderTtsProviderMenu() {
  const select = $('#tts-provider');
  const shadowingSelected = state.ttsProviderView === 'english-shadowing';
  const motPhutSelected = state.ttsProviderView === MOT_PHUT_CONTENT;
  const thingsSelected = state.ttsProviderView === THINGS_YOU_DIDNT_KNOW_CONTENT;
  const selected = select.selectedOptions[0] || select.options[0];
  const shadowingLabel = 'Local AI TTS · Shadowing + Kokoro tiếng Anh';
  const motPhutLabel = 'Local AI TTS · VieNeu tiếng Việt · Một Phút Vỡ Lẽ';
  const thingsLabel = "Local AI TTS · Kokoro tiếng Anh · Things You Didn't Know";
  $('#tts-provider-value').textContent = shadowingSelected ? shadowingLabel : motPhutSelected ? motPhutLabel : thingsSelected ? thingsLabel : selected?.textContent || 'Chọn model giọng đọc';
  const options = [
    ...Array.from(select.options, (option) => ({ value: option.value, label: option.value === 'supertonic3-ko' ? 'Local AI TTS · VieNeu tiếng Việt + Supertonic 3 tiếng Hàn' : option.textContent })),
    { value: 'english-shadowing', label: shadowingLabel },
    { value: MOT_PHUT_CONTENT, label: motPhutLabel },
    { value: THINGS_YOU_DIDNT_KNOW_CONTENT, label: thingsLabel }
  ];
  $('#tts-provider-options').innerHTML = options.map((option) => {
    const selectedValue = shadowingSelected ? 'english-shadowing' : motPhutSelected ? MOT_PHUT_CONTENT : thingsSelected ? THINGS_YOU_DIDNT_KNOW_CONTENT : select.value;
    const isSelected = option.value === selectedValue;
    return `<button class="tts-provider-option" type="button" role="option" data-tts-provider="${escapeHtml(option.value)}" aria-selected="${isSelected}"><span>${escapeHtml(option.label)}</span>${isSelected ? '<span class="tts-provider-option-check" aria-hidden="true">✓</span>' : ''}</button>`;
  }).join('');
}

function selectTtsProviderView(provider) {
  if (provider === THINGS_YOU_DIDNT_KNOW_CONTENT) {
    window.motPhutVoLe?.setSettingsProfile?.('voice', false);
    state.ttsProviderView = THINGS_YOU_DIDNT_KNOW_CONTENT;
    updateTtsProviderPanels();
    return;
  }
  if (provider === MOT_PHUT_CONTENT) {
    state.ttsProviderView = MOT_PHUT_CONTENT;
    window.motPhutVoLe?.setSettingsProfile?.('voice', true);
    updateTtsProviderPanels();
    return;
  }
  window.motPhutVoLe?.setSettingsProfile?.('voice', false);
  if (provider === 'english-shadowing') {
    state.ttsProviderView = 'english-shadowing';
    updateTtsProviderPanels();
    return;
  }
  state.ttsProviderView = 'standard';
  $('#tts-provider').value = provider;
  $('#tts-provider').dispatchEvent(new Event('change', { bubbles: true }));
}

function closeTtsProviderMenu({ restoreFocus = false } = {}) {
  $('#tts-provider-options').hidden = true;
  $('#tts-provider-trigger').setAttribute('aria-expanded', 'false');
  if (restoreFocus) $('#tts-provider-trigger').focus();
}

function contentLanguageForProvider(provider, currentLanguage) {
  if (provider === 'vieneu') return 'en';
  if (provider === 'vieneu-sbv2') return 'ja';
  if (provider === 'vieneu-cosyvoice3') return 'zh';
  return currentLanguage;
}

function providerSettingKey(language) {
  return language === 'ja' ? 'japaneseTtsProvider' : language === 'zh' ? 'chineseTtsProvider' : 'ttsProvider';
}

function selectTtsProvider(provider) {
  if (provider === 'supertonic3-ko') {
    $('#tts-provider').value = provider;
    state.settings = { ...(state.settings || {}), koreanTtsProvider: provider };
    state.settingsDirty = true;
    state.settingsRevision += 1;
    updateTtsProviderPanels();
    return;
  }
  const currentLanguage = $('#content-language').value;
  const language = contentLanguageForProvider(provider, currentLanguage);
  const key = providerSettingKey(language);
  $('#tts-provider').value = provider;
  state.settings = { ...(state.settings || {}), [key]: provider };
  state.settingsDirty = true;
  state.settingsRevision += 1;
  updateTtsProviderPanels();
  if (language !== currentLanguage) {
    $('#content-language').value = language;
    void changeContentLanguage();
  }
}

function toggleTtsProviderMenu() {
  const menu = $('#tts-provider-options');
  const trigger = $('#tts-provider-trigger');
  const opening = menu.hidden;
  menu.hidden = !opening;
  trigger.setAttribute('aria-expanded', String(opening));
  if (opening) {
    const selectedOption = menu.querySelector('[aria-selected="true"]');
    (selectedOption || menu.querySelector('[role="option"]'))?.focus();
  }
}

function providerForContentLanguage(language, settings = {}) {
  if (language === 'ja') return settings.japaneseTtsProvider || 'vieneu-sbv2';
  if (language === 'zh') return settings.chineseTtsProvider || 'vieneu-cosyvoice3';
  return 'vieneu';
}

function syncTtsProviderForContentLanguage(language, settings = state.settings || {}) {
  const provider = providerForContentLanguage(language, settings);
  for (const option of $('#tts-provider').options) option.hidden = false;
  $('#tts-provider').value = provider;
  updateTtsProviderPanels();
}

function contentLanguageDescription(language) {
  if (language === THINGS_YOU_DIDNT_KNOW_CONTENT) return 'Create one English Reel from a rotating country and topic, with its own fact review, Kokoro voice, thumbnail, and content design.';
  if (language === MOT_PHUT_CONTENT) return 'Kể một kiến thức thú vị bằng tiếng Việt, với giọng đọc và thiết kế riêng.';
  if (language === 'english-shadowing') return 'EnglishShadowing dùng giọng Kokoro và preset dựng riêng theo bốn video mẫu. Caption, highlight và Page cũng được tách riêng.';
  if (language === 'ja') return 'AI tự chọn chủ đề tiếng Nhật mới, chỉ đối chiếu lịch sử JA và luân phiên 5 bố cục. Caption, hashtag và ảnh nền Nhật được tách riêng.';
  if (language === 'zh') return 'Ba câu giao tiếp thực tế. Giọng đọc tiếng Việt và tiếng Trung CosyVoice 3.0.';
  return 'Tạo video Việt–Anh theo các bố cục học tập luân phiên tự động. Giọng đọc và nội dung vẫn được kiểm tra trước khi render.';
}

async function changeContentLanguage() {
  const language = $('#content-language').value;
  state.createLanguageSelectionTouched = true;
  if (language === THINGS_YOU_DIDNT_KNOW_CONTENT) {
    selectTtsProviderView(THINGS_YOU_DIDNT_KNOW_CONTENT);
    $('#background-effect-language').value = THINGS_YOU_DIDNT_KNOW_CONTENT;
    state.backgroundEffectLanguage = THINGS_YOU_DIDNT_KNOW_CONTENT;
    window.motPhutVoLe?.setSettingsProfile?.('background', false);
    syncBackgroundEffectPreview();
    $('#voice-highlight-content-profile').value = THINGS_YOU_DIDNT_KNOW_CONTENT;
    applyVoiceHighlightContentProfile(THINGS_YOU_DIDNT_KNOW_CONTENT);
    localStorage.setItem('things-you-didnt-know-content-mode', 'true');
    localStorage.removeItem('mot-phut-vo-le-content-mode');
    window.dispatchEvent(new CustomEvent('mot-phut-mode-change', { detail: { active: false } }));
    const heroCopy = $('#content-language').closest('.hero-copy')?.querySelector(':scope > p');
    if (heroCopy) heroCopy.textContent = contentLanguageDescription(language);
    window.dispatchEvent(new CustomEvent('things-you-didnt-know-mode-change', { detail: { active: true } }));
    return true;
  }
  localStorage.removeItem('things-you-didnt-know-content-mode');
  window.dispatchEvent(new CustomEvent('things-you-didnt-know-mode-change', { detail: { active: false } }));
  if (language === MOT_PHUT_CONTENT) {
    localStorage.setItem('mot-phut-vo-le-content-mode', 'true');
    const heroCopy = $('#content-language').closest('.hero-copy')?.querySelector(':scope > p');
    if (heroCopy) heroCopy.textContent = contentLanguageDescription(language);
    window.dispatchEvent(new CustomEvent('mot-phut-mode-change', { detail: { active: true } }));
    return true;
  }
  localStorage.removeItem('mot-phut-vo-le-content-mode');
  window.dispatchEvent(new CustomEvent('mot-phut-mode-change', { detail: { active: false } }));
  renderTopics();
  if (language === 'english-shadowing') {
    const heroCopy = $('#content-language').closest('.hero-copy')?.querySelector(':scope > p');
    if (heroCopy) heroCopy.textContent = contentLanguageDescription(language);
    return true;
  }
  const oldSettings = state.settings || {};
  const revision = ++state.contentLanguageRevision;
  syncTtsProviderForContentLanguage(language, oldSettings);
  const heroCopy = $('#content-language').closest('.hero-copy')?.querySelector(':scope > p');
  if (heroCopy) heroCopy.textContent = contentLanguageDescription(language);
  state.contentLanguageSavePromise = state.contentLanguageSavePromise.catch(() => false).then(() => api('/api/settings', {
    method: 'POST', body: JSON.stringify({ contentLanguage: language })
  })).then((saved) => {
    const pendingSettings = state.settingsDirty ? state.settings || {} : {};
    state.settings = { ...saved, ...pendingSettings, contentLanguage: saved.contentLanguage };
    return true;
  })
    .catch((error) => {
      if (revision === state.contentLanguageRevision) {
        $('#content-language').value = oldSettings.contentLanguage || 'en';
        syncTtsProviderForContentLanguage(oldSettings.contentLanguage || 'en', oldSettings);
        if (heroCopy) heroCopy.textContent = contentLanguageDescription(oldSettings.contentLanguage || 'en');
        toast('Không lưu được cặp ngôn ngữ', true, error.message);
      }
      return false;
    });
  return state.contentLanguageSavePromise;
}

function updateVieNeuSpeedLabel(language) {
  const value = Number($(`#vieneu-${language}-speed`).value) || 1;
  $(`#vieneu-${language}-speed-label`).textContent = `${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
}

function updateKokoroSpeedLabel() {
  const value = Number($('#kokoro-en-speed').value) || 1;
  $('#kokoro-en-speed-label').textContent = `${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
}

function updateEnglishShadowingDeliveryLabels() {
  const rate = Number($('#english-shadowing-speech-rate').value) || 0.75;
  const pause = Number($('#english-shadowing-sentence-pause').value) || 0.62;
  $('#english-shadowing-speech-rate-label').textContent = `${rate.toFixed(2)}×`;
  $('#english-shadowing-sentence-pause-label').textContent = `${pause.toFixed(2)} giây`;
}

function updateSupertonicKoreanSpeedLabel() {
  const input = $('#supertonic-ko-speed');
  const label = $('#supertonic-ko-speed-label');
  if (!input || !label) return;
  const value = Number(input.value) || 1;
  label.textContent = `${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
}

function updateModelSpeedLabel(inputId, labelId) {
  const value = Number($(`#${inputId}`).value) || 1;
  $(`#${labelId}`).textContent = `${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
}

function syncLocalVietnameseSpeed(source) {
  const value = $(source).value;
  const controls = [
    ['vieneu-vi-speed', 'vieneu-vi-speed-label'],
    ['sbv2-vi-speed', 'sbv2-vi-speed-label'],
    ['cosyvoice-vi-speed', 'cosyvoice-vi-speed-label']
  ];
  for (const [inputId, labelId] of controls) {
    $(`#${inputId}`).value = value;
    updateModelSpeedLabel(inputId, labelId);
  }
}

function mergeCosyVoiceProfiles(savedProfiles = [], availableProfiles = []) {
  const profiles = new Map((Array.isArray(availableProfiles) ? availableProfiles : []).map((profile) => [profile.id, profile]));
  for (const profile of Array.isArray(savedProfiles) ? savedProfiles : []) {
    const available = profiles.get(profile.id);
    profiles.set(profile.id, available?.automatic
      ? { ...available, ...profile, referenceText: available.referenceText, ready: available.ready, automatic: true }
      : { ...available, ...profile });
  }
  return [...profiles.values()];
}

function updateCosyVoiceProfileDetails(profile) {
  const details = $('#cosyvoice-profile-details');
  const rename = $('#cosyvoice-rename-profile');
  const remove = $('#cosyvoice-delete-profile');
  const referenceText = $('#cosyvoice-reference-text');
  const referenceFile = $('#cosyvoice-reference-file');
  const customFields = $('#cosyvoice-custom-profile-fields');
  rename.disabled = !profile;
  remove.disabled = !profile;
  rename.hidden = Boolean(profile?.automatic);
  remove.hidden = Boolean(profile?.automatic);
  customFields.hidden = !profile || Boolean(profile.automatic);
  referenceText.readOnly = Boolean(profile?.automatic);
  referenceFile.disabled = Boolean(profile?.automatic);
  if (!profile) {
    details.textContent = 'Chọn giọng tham chiếu đã lưu hoặc thêm WAV riêng.';
    return;
  }
  if (profile.automatic) {
    details.textContent = `${profile.genderLabel || (profile.gender === 'female' ? 'Nữ' : 'Nam')} · WAV đã lưu trên máy · ${profile.source || 'AISHELL-3'}.`;
  } else {
    details.textContent = profile.ready ? 'WAV tham chiếu thủ công · transcript do người dùng cung cấp.' : 'Hồ sơ thủ công mới · thêm WAV và transcript chính xác.';
  }
}

function renderCosyVoiceProfileOptions(selectedId = $('#cosyvoice-profile').value) {
  const select = $('#cosyvoice-profile');
  const profiles = state.settings?.cosyVoiceProfiles || [];
  select.innerHTML = '<option value="">Chưa chọn giọng tham chiếu</option>' + profiles.map((profile) => {
    const description = profile.automatic ? `${profile.genderLabel || (profile.gender === 'female' ? 'Nữ' : 'Nam')} · AISHELL-3` : (profile.ready ? 'WAV đã lưu' : 'chưa hoàn tất mẫu');
    return `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name || 'Giọng chưa đặt tên')} · ${escapeHtml(description)}</option>`;
  }).join('');
  select.value = selectedId;
  updateCosyVoiceProfileDetails(profiles.find((profile) => profile.id === selectedId) || null);
}

function createCosyVoiceProfile() {
  const profiles = state.settings?.cosyVoiceProfiles || [];
  if (profiles.filter((profile) => !profile.automatic).length >= 12) { toast('Đã đủ 12 hồ sơ giọng WAV thủ công', true, 'Xóa một hồ sơ thủ công cũ trước khi thêm giọng khác.'); return; }
  const id = `voice-${crypto.randomUUID()}`;
  state.settings.cosyVoiceProfiles = [...profiles, { id, name: 'Giọng mới', referenceText: '', ready: false }];
  state.settings.cosyVoiceProfileId = id;
  state.cosyVoiceUploadedProfileId = '';
  state.cosyVoiceActiveProfileId = id;
  $('#cosyvoice-profile-name').value = 'Giọng mới';
  $('#cosyvoice-reference-text').value = '';
  $('#cosyvoice-reference-file').value = '';
  renderCosyVoiceProfileOptions(id);
  $('#cosyvoice-reference-status').textContent = 'Chọn WAV mẫu cho giọng mới';
  state.settingsDirty = true;
  state.settingsRevision += 1;
}

function selectCosyVoiceProfile(id) {
  const profile = (state.settings?.cosyVoiceProfiles || []).find((item) => item.id === id);
  state.settings.cosyVoiceProfileId = id;
  state.cosyVoiceActiveProfileId = id;
  $('#cosyvoice-profile-name').value = profile?.name || '';
  $('#cosyvoice-reference-text').value = profile?.referenceText || '';
  $('#cosyvoice-reference-file').value = '';
  $('#cosyvoice-reference-status').textContent = profile?.ready ? `${profile.name} · WAV đã lưu` : profile ? 'Hồ sơ chưa đủ WAV mẫu hoặc bản chép' : 'Chưa chọn giọng tham chiếu';
  updateCosyVoiceProfileDetails(profile || null);
  state.settingsDirty = true;
  state.settingsRevision += 1;
}

function syncActiveCosyVoiceProfileDraft() {
  const id = state.cosyVoiceActiveProfileId;
  if (!id) return;
  const profiles = state.settings?.cosyVoiceProfiles || [];
  state.settings.cosyVoiceProfiles = profiles.map((profile) => profile.id === id ? {
    ...profile, name: $('#cosyvoice-profile-name').value.trim(),
    referenceText: profile.automatic ? profile.referenceText : $('#cosyvoice-reference-text').value.trim()
  } : profile);
}

async function renameCosyVoiceProfile() {
  const id = $('#cosyvoice-profile').value;
  const name = $('#cosyvoice-profile-name').value.trim();
  if (!id || !name) return;
  try {
    await api(`/api/tts/cosyvoice-profiles/${encodeURIComponent(id)}/rename`, { method: 'POST', body: JSON.stringify({ name }) });
    state.settings.cosyVoiceProfiles = (state.settings.cosyVoiceProfiles || []).map((profile) => profile.id === id ? { ...profile, name } : profile);
    state.settings.cosyVoiceProfileName = name;
    renderCosyVoiceProfileOptions(id);
    $('#cosyvoice-profile-name').value = name;
    toast('Đã đổi tên giọng Trung', false, name);
  } catch (error) { toast('Không đổi được tên giọng', true, error.message); }
}

function applyCosyVoiceLibraryStatus(status, { mergeProfiles = true } = {}) {
  const job = status?.job || {};
  const installedProfiles = Array.isArray(status?.profiles) ? status.profiles : [];
  if (mergeProfiles && state.settings) {
    const selectedId = $('#cosyvoice-profile').value || state.settings.cosyVoiceProfileId || '';
    state.settings.cosyVoiceProfiles = mergeCosyVoiceProfiles(state.settings.cosyVoiceProfiles, installedProfiles);
    renderCosyVoiceProfileOptions(selectedId);
  }
  const installed = Number(status?.installed ?? installedProfiles.length);
  const running = Boolean(job.running);
  const expected = Number(status?.expected || 6);
  const maintenanceHidden = !running && Boolean(status?.complete || installed >= expected);
  $('#cosyvoice-library-actions').hidden = maintenanceHidden;
  $('#cosyvoice-library-status').hidden = maintenanceHidden;
  $('#cosyvoice-library-status').textContent = running
    ? `${job.message || 'Đang cài thư viện…'} · ${installed}/${expected} giọng đã cài.`
    : `${job.message || 'AISHELL-3 · Apache-2.0.'} · ${installed}/${expected} giọng hợp lệ.`;
  $('#cosyvoice-download-library').disabled = running || installed >= expected;
  $('#cosyvoice-check-library').disabled = running;
  $('#cosyvoice-retry-library').hidden = running || installed >= expected;
  $('#cosyvoice-cancel-library').hidden = !running;
  if (Array.isArray(job.failed) && job.failed.length) {
    const failures = job.failed.map((item) => `${item.name || item.stage}: ${item.message}`).join(' · ');
    $('#cosyvoice-library-status').textContent += ` Lỗi: ${failures}`;
  }
}

async function refreshCosyVoiceLibraryStatus() {
  const status = await api('/api/tts/cosyvoice-library');
  applyCosyVoiceLibraryStatus(status);
  return status;
}

async function monitorCosyVoiceLibraryInstall() {
  let finalStatus;
  while (true) {
    finalStatus = await refreshCosyVoiceLibraryStatus();
    if (!finalStatus.job?.running) break;
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  if (finalStatus.job?.status === 'complete') toast('Đã cài thư viện giọng Trung', false, `${finalStatus.installed}/6 mẫu AISHELL-3 đã sẵn sàng.`);
  else if (finalStatus.job?.status === 'partial') toast('Đã cài một phần thư viện giọng', true, `${finalStatus.installed}/6 mẫu hợp lệ; có thể bấm Tải lại giọng lỗi.`);
  else if (finalStatus.job?.status === 'failed') toast('Không tải được thư viện giọng Trung', true, finalStatus.job.message);
}

async function startCosyVoiceLibraryInstall() {
  const button = $('#cosyvoice-download-library');
  button.disabled = true;
  try {
    const result = await api('/api/tts/cosyvoice-library/install', { method: 'POST', body: '{}' });
    applyCosyVoiceLibraryStatus(result);
    await monitorCosyVoiceLibraryInstall();
  } catch (error) {
    toast('Không thể tải thư viện giọng', true, error.message);
    button.disabled = false;
    await refreshCosyVoiceLibraryStatus().catch(() => {});
  }
}

async function checkCosyVoiceLibrary() {
  const button = $('#cosyvoice-check-library');
  button.disabled = true;
  try {
    const status = await api('/api/tts/cosyvoice-library/check', { method: 'POST', body: '{}' });
    applyCosyVoiceLibraryStatus(status);
    toast('Đã kiểm tra thư viện giọng', false, `${status.valid}/6 mẫu hợp lệ.`);
  } catch (error) { toast('Không kiểm tra được thư viện', true, error.message); }
  finally { button.disabled = false; }
}

async function cancelCosyVoiceLibraryInstall() {
  try {
    await api('/api/tts/cosyvoice-library/cancel', { method: 'POST', body: '{}' });
    await refreshCosyVoiceLibraryStatus();
  } catch (error) { toast('Không hủy được lượt tải', true, error.message); }
}

async function deleteCosyVoiceProfile() {
  const id = $('#cosyvoice-profile').value;
  if (!id) return;
  const profile = (state.settings?.cosyVoiceProfiles || []).find((item) => item.id === id);
  if (!confirm(`Xóa hồ sơ giọng “${profile?.name || id}” và tệp WAV đã lưu trên máy này?`)) return;
  try {
    await api(`/api/tts/cosyvoice-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.settings.cosyVoiceProfiles = (state.settings.cosyVoiceProfiles || []).filter((item) => item.id !== id);
    if (state.settings.cosyVoiceProfileId === id) state.settings.cosyVoiceProfileId = '';
    if (state.cosyVoiceActiveProfileId === id) state.cosyVoiceActiveProfileId = '';
    state.cosyVoiceUploadedProfileId = '';
    renderCosyVoiceProfileOptions('');
    $('#cosyvoice-profile-name').value = '';
    $('#cosyvoice-reference-text').value = '';
    $('#cosyvoice-reference-file').value = '';
    $('#cosyvoice-reference-status').textContent = 'Chưa chọn giọng tham chiếu';
    state.settingsDirty = true;
    state.settingsRevision += 1;
    toast('Đã xóa hồ sơ giọng Trung', false, 'Bấm Lưu cài đặt để xác nhận lựa chọn giọng hiện tại.');
  } catch (error) { toast('Không xóa được hồ sơ giọng', true, error.message); }
}

function updateFacebookPageForm(settings, pages, language) {
  const routeProfileId = pages.routes?.[language];
  const routedProfile = routeProfileId ? (pages.profiles || []).find((item) => item.id === routeProfileId) : null;
  const profile = routeProfileId
    ? (routedProfile?.contentLanguage === language ? routedProfile : null)
    : (pages.legacyLanguage === language ? (pages.profiles || []).find((item) => item.legacy) : null);
  state.facebookActiveProfile = profile || null;
  state.facebookSelectedLanguage = language;
  $('#page-id').value = profile?.pageId || '';
  $('#page-token').value = '';
  $('#clear-facebook').hidden = !profile?.tokenSaved;
  const verified = Boolean(profile?.connectionVerified);
  const isMock = settings.facebookAdapter === 'mock';
  $('#facebook-status-pill').textContent = isMock ? 'Mock' : verified ? 'Đọc được Page' : 'Chưa xác minh';
  $('#facebook-status-pill').className = `state-pill ${verified ? 'ok' : isMock ? 'neutral' : 'warn'}`;
}

async function refreshFacebookPageForm(language = $('#facebook-quick-route-language').value) {
  const revision = ++state.facebookPageLoadRevision;
  try {
    const pages = await api('/api/facebook/pages');
    if (revision !== state.facebookPageLoadRevision || state.facebookPageCredentialDirty || $('#facebook-quick-route-language').value !== language) return;
    updateFacebookPageForm(state.settings || {}, pages, language);
  } catch (error) {
    if (revision === state.facebookPageLoadRevision) $('#facebook-status-pill').textContent = 'Không tải được Page';
  }
}

function markSettingsDirty(event) {
  const target = event.target;
  if (!target?.matches('input, select, textarea') || target.disabled) return;
  if (target.closest('[data-things-you-didnt-know-settings]')) return;
  if (target.closest('.english-shadowing-voice-settings')) {
    state.englishShadowingSettingsDirty = true;
    state.englishShadowingSettingsRevision += 1;
    return;
  }
  if (target.closest('#english-shadowing-highlight-controls')) {
    state.englishShadowingSettingsDirty = true;
    state.englishShadowingSettingsRevision += 1;
    return;
  }
  if (target.id === 'voice-highlight-content-profile') return;
  if (target.id === 'background-effect' && state.backgroundEffectLanguage === 'english-shadowing') {
    state.englishShadowingSettingsDirty = true;
    state.englishShadowingSettingsRevision += 1;
    return;
  }
  if (target.id === 'facebook-quick-route-language' || target.id === 'background-effect-language') return;
  if (target.id === 'background-effect' && state.backgroundEffectLanguage === THINGS_YOU_DIDNT_KNOW_CONTENT) return;
  if (target.id === 'page-id' || target.id === 'page-token') {
    state.facebookPageCredentialDirty = true;
    return;
  }
  state.settingsDirty = true;
  state.settingsRevision += 1;
}

function syncBackgroundEffectPreview() {
  const frame = $('#background-effect-preview-frame');
  if (window.motPhutVoLe?.isBackgroundEffectProfileActive?.()) {
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage({ type: 'background-effect-preview:set-effect',
      effectId: $('#mot-phut-setting-background-effect').value || 'bubbles',
      density: Number($('#mot-phut-setting-effect-density').value || 28),
      speed: Number($('#mot-phut-setting-effect-speed').value || 58),
      opacity: Number($('#mot-phut-setting-effect-opacity').value || 32), language: 'vi' }, location.origin);
    return;
  }
  if (state.backgroundEffectLanguage === THINGS_YOU_DIDNT_KNOW_CONTENT) {
    window.thingsYouDidntKnow?.syncEffectPreview?.();
    return;
  }
  const effectId = $('#background-effect').value;
  if (!frame?.contentWindow || !effectId) return;
  const contentLanguage = state.backgroundEffectLanguage === 'english-shadowing' ? 'en' : state.backgroundEffectLanguage || 'en';
  frame.contentWindow.postMessage({ type: 'background-effect-preview:set-effect', effectId, density: state.backgroundEffectDensity, speed: state.backgroundEffectSpeed, opacity: state.backgroundEffectOpacity, language: contentLanguage }, location.origin);
}

async function loadSettings() {
  const backgroundSettingsPromise = Promise.all([
    api('/api/settings'),
    api('/api/background-effects'),
    api('/api/english-shadowing/settings')
  ]);
  const ancillarySettingsPromise = Promise.all([
    api('/api/system'),
    api('/api/tts/cosyvoice-library').catch(() => null),
    api('/api/facebook/pages').catch(() => ({ profiles: [], routes: {} }))
  ]);
  const [settings, backgroundEffects, englishShadowing] = await backgroundSettingsPromise;
  if (!state.englishShadowingSettingsDirty) state.englishShadowingSettings = englishShadowing.settings;
  const shadowVoiceSelect = $('#english-shadowing-voice');
  const shadowVoices = Array.isArray(englishShadowing.voices) ? englishShadowing.voices : [];
  const currentShadowVoice = shadowVoiceSelect.value;
  if (shadowVoices.length) {
    shadowVoiceSelect.innerHTML = shadowVoices.map((voice) => `<option value="${escapeHtml(voice.id)}">${escapeHtml(voice.label)}</option>`).join('');
  }
  const selectedShadowVoice = state.englishShadowingSettingsDirty
    ? currentShadowVoice
    : englishShadowing.settings.voice || 'af_heart';
  if ([...shadowVoiceSelect.options].some((option) => option.value === selectedShadowVoice)) {
    shadowVoiceSelect.value = selectedShadowVoice;
  }
  state.backgroundEffects = Array.isArray(backgroundEffects) ? backgroundEffects : [];
  const backgroundEffectSelect = $('#background-effect');
  if (Array.isArray(backgroundEffects) && backgroundEffectSelect.dataset.catalogLoaded !== 'true') {
    backgroundEffectSelect.innerHTML = backgroundEffects.map((effect) => `<option value="${escapeHtml(effect.id)}">${escapeHtml(effect.label)} · ${escapeHtml(effect.description)}</option>`).join('');
    backgroundEffectSelect.dataset.catalogLoaded = 'true';
  }
  if (!state.settingsDirty) {
    state.backgroundEffectProfiles = normalizeBackgroundEffectProfilesForUi(settings);
    const selectedEffectLanguage = state.backgroundEffectLanguage || $('#background-effect-language').value || 'en';
    if (selectedEffectLanguage === MOT_PHUT_CONTENT) window.motPhutVoLe?.setSettingsProfile?.('background', true);
    else if (selectedEffectLanguage === THINGS_YOU_DIDNT_KNOW_CONTENT) {
      state.backgroundEffectLanguage = THINGS_YOU_DIDNT_KNOW_CONTENT;
      $('#background-effect-language').value = THINGS_YOU_DIDNT_KNOW_CONTENT;
      window.thingsYouDidntKnow?.syncEffectPreview?.();
    } else {
      window.motPhutVoLe?.setSettingsProfile?.('background', false);
      applyBackgroundEffectProfile(selectedEffectLanguage);
    }
    applyVoiceHighlightContentProfile(state.voiceHighlightContentProfile);
  }
  syncBackgroundEffectPreview();

  const [system, libraryStatus, facebookPages] = await ancillarySettingsPromise;
  state.settings = { ...settings, cosyVoiceProfiles: mergeCosyVoiceProfiles(settings.cosyVoiceProfiles, system.cosyVoice3?.profiles || []) };
  state.system = system;
  state.facebookPages = facebookPages;
  if (libraryStatus) applyCosyVoiceLibraryStatus(libraryStatus, { mergeProfiles: false });
  if (!state.englishShadowingSettingsDirty) {
    $('#english-shadowing-speech-rate').value = englishShadowing.settings.speechRate ?? 0.75;
    $('#english-shadowing-sentence-pause').value = englishShadowing.settings.sentencePauseSeconds ?? 0.62;
    $('#english-shadowing-highlight-enabled').checked = englishShadowing.settings.highlightEnabled !== false;
    $('#english-shadowing-highlight-style').value = englishShadowing.settings.highlightStyle || 'text';
    $('#english-shadowing-highlight-mode').value = englishShadowing.settings.highlightMode || 'word';
    $('#english-shadowing-highlight-color').value = englishShadowing.settings.highlightColor || '#E5794F';
    $('#english-shadowing-highlight-padding').value = englishShadowing.settings.highlightPadding ?? 6;
    $('#english-shadowing-highlight-radius').value = englishShadowing.settings.highlightRadius ?? 8;
  }
  updateEnglishShadowingDeliveryLabels();
  const facebookLanguageSelect = $('#facebook-quick-route-language');
  if (!state.facebookPageLanguageDirty) facebookLanguageSelect.value = ['en', 'zh', 'ja', 'english-shadowing'].includes(settings.facebookPageSelectedLanguage) ? settings.facebookPageSelectedLanguage : 'en';
  if (!state.facebookPageCredentialDirty && facebookLanguageSelect.value !== MOT_PHUT_CONTENT) updateFacebookPageForm(settings, facebookPages, facebookLanguageSelect.value);
  window.motPhutVoLe?.syncFacebookSettingsProfile?.();
  // The eight-second live refresh also calls this function. Keep in-progress
  // edits in the DOM until the user saves them; the server response is only a
  // baseline and must not overwrite a selection or text field mid-edit.
  if (state.settingsDirty) return;
  if (!state.createLanguageSelectionTouched) $('#content-language').value = localStorage.getItem('things-you-didnt-know-content-mode') === 'true' ? THINGS_YOU_DIDNT_KNOW_CONTENT
    : localStorage.getItem('mot-phut-vo-le-content-mode') === 'true' ? MOT_PHUT_CONTENT : settings.contentLanguage || 'en';
  const visibleLanguage = $('#content-language').value;
  if (visibleLanguage === THINGS_YOU_DIDNT_KNOW_CONTENT) selectTtsProviderView(THINGS_YOU_DIDNT_KNOW_CONTENT);
  else if (visibleLanguage !== 'english-shadowing' && visibleLanguage !== MOT_PHUT_CONTENT) syncTtsProviderForContentLanguage(visibleLanguage, settings);
  if (visibleLanguage === THINGS_YOU_DIDNT_KNOW_CONTENT) {
    $('#background-effect-language').value = THINGS_YOU_DIDNT_KNOW_CONTENT;
    state.backgroundEffectLanguage = THINGS_YOU_DIDNT_KNOW_CONTENT;
    $('#voice-highlight-content-profile').value = THINGS_YOU_DIDNT_KNOW_CONTENT;
    applyVoiceHighlightContentProfile(THINGS_YOU_DIDNT_KNOW_CONTENT);
  }
  const heroCopy = $('#content-language').closest('.hero-copy')?.querySelector(':scope > p');
  if (heroCopy) heroCopy.textContent = contentLanguageDescription(visibleLanguage);
  window.dispatchEvent(new CustomEvent('mot-phut-mode-change', { detail: { active: visibleLanguage === MOT_PHUT_CONTENT } }));
  window.dispatchEvent(new CustomEvent('things-you-didnt-know-mode-change', { detail: { active: visibleLanguage === THINGS_YOU_DIDNT_KNOW_CONTENT } }));
  selectSavedVoice($('#vieneu-vi-voice'), settings.vieneuViVoice || 'Hải Đăng');
  selectSavedVoice($('#sbv2-vi-voice'), settings.vieneuJaViVoice || settings.vieneuViVoice || 'Hải Đăng');
  selectSavedVoice($('#cosyvoice-vi-voice'), settings.vieneuZhViVoice || settings.vieneuViVoice || 'Hải Đăng');
  const kokoroVoices = system.kokoro?.voices;
  if (Array.isArray(kokoroVoices) && kokoroVoices.length) {
    const select = $('#kokoro-en-voice');
    const savedVoice = settings.kokoroEnVoice || 'af_heart';
    select.innerHTML = kokoroVoices.map((voice) => `<option value="${escapeHtml(voice.id)}">${escapeHtml(voice.label)}</option>`).join('');
    select.value = savedVoice;
    if (select.value !== savedVoice) select.value = 'af_heart';
  }
  $('#kokoro-en-voice').value = settings.kokoroEnVoice || 'af_heart';
  $('#vieneu-vi-speed').value = settings.vieneuViSpeed ?? 1;
  $('#sbv2-vi-speed').value = settings.vieneuViSpeed ?? 1;
  $('#cosyvoice-vi-speed').value = settings.vieneuViSpeed ?? 1;
  $('#kokoro-en-speed').value = settings.kokoroEnSpeed ?? 1;
  $('#sbv2-voice').value = settings.styleBertVits2Voice || 'jvnv-F1-jp';
  $('#sbv2-style').value = settings.styleBertVits2Style || 'Neutral';
  $('#sbv2-speed').value = settings.styleBertVits2Speed ?? 1;
  $('#supertonic-ko-voice').value = settings.supertonicKoreanVoice || 'F1';
  if ($('#supertonic-ko-speed')) $('#supertonic-ko-speed').value = settings.supertonicKoreanSpeed ?? 1;
  updateSupertonicKoreanSpeedLabel();
  const cosyVoiceStatus = system.cosyVoice3 || {};
  const cosyProfiles = state.settings.cosyVoiceProfiles || [];
  const selectedCosyProfileId = settings.cosyVoiceProfileId || '';
  const selectedCosyProfile = cosyProfiles.find((profile) => profile.id === selectedCosyProfileId)
    || cosyProfiles.find((profile) => profile.id === 'legacy')
    || null;
  renderCosyVoiceProfileOptions(selectedCosyProfile?.id || '');
  state.cosyVoiceActiveProfileId = selectedCosyProfile?.id || '';
  $('#cosyvoice-profile-name').value = selectedCosyProfile?.name || settings.cosyVoiceProfileName || '';
  $('#cosyvoice-reference-text').value = selectedCosyProfile?.referenceText || settings.cosyVoiceReferenceText || '';
  state.settings.cosyVoiceProfileId = selectedCosyProfile?.id || '';
  updateVieNeuSpeedLabel('vi');
  updateModelSpeedLabel('sbv2-vi-speed', 'sbv2-vi-speed-label');
  updateModelSpeedLabel('cosyvoice-vi-speed', 'cosyvoice-vi-speed-label');
  updateModelSpeedLabel('sbv2-speed', 'sbv2-speed-label');
  const sbv2Status = system.styleBertVits2 || {};
  const installedJapaneseVoices = (sbv2Status.voices || []).filter((voice) => voice.installed).length;
  $('#sbv2-status').textContent = `${sbv2Status.installed ? `Style-Bert-VITS2 Nhật sẵn sàng · ${installedJapaneseVoices}/4 giọng` : `Style-Bert-VITS2 Nhật chưa sẵn sàng · ${installedJapaneseVoices}/4 giọng đã cài`} · ${sbv2Status.device || 'CPU'} · RAM trống ${sbv2Status.freeRamMb ?? '?'} MB · cần tối thiểu ${sbv2Status.minimumRamMb ?? 4096} MB.`;
  $('#sbv2-status').classList.toggle('is-warning', !sbv2Status.installed || Number(sbv2Status.freeRamMb) < Number(sbv2Status.minimumRamMb));
  $('#cosyvoice-reference-status').textContent = selectedCosyProfile?.ready ? `${selectedCosyProfile.name} · WAV đã lưu` : selectedCosyProfile ? 'Hồ sơ này chưa có WAV mẫu' : `${cosyProfiles.length} giọng đã lưu · chưa chọn`;
  $('#cosyvoice-status').textContent = `${cosyVoiceStatus.installed ? `CosyVoice 3.0 sẵn sàng · ${cosyProfiles.filter((profile) => profile.ready).length} giọng đã lưu` : 'CosyVoice 3.0 chưa cài'} · ${cosyVoiceStatus.device || 'CPU'} · RAM trống ${cosyVoiceStatus.freeRamMb ?? '?'} MB · cần ${cosyVoiceStatus.minimumRamMb ?? 3072} MB.`;
  $('#cosyvoice-status').classList.toggle('is-warning', !cosyVoiceStatus.installed || !cosyVoiceStatus.referenceReady || Number(cosyVoiceStatus.freeRamMb) < Number(cosyVoiceStatus.minimumRamMb));
  const supertonicStatus = system.supertonicKorean || {};
  if ($('#supertonic-ko-status')) {
    const voiceCount = Array.isArray(supertonicStatus.voices) ? supertonicStatus.voices.length : 10;
    $('#supertonic-ko-status').textContent = `${supertonicStatus.ready ? 'Supertonic 3 tiếng Hàn sẵn sàng' : 'Supertonic 3 tiếng Hàn chưa sẵn sàng'} · ${voiceCount} giọng · CPU.`;
    $('#supertonic-ko-status').classList.toggle('is-warning', !supertonicStatus.ready);
  }
  $('#local-tts-min-free-ram').value = settings.localTtsMinFreeRamMb ?? 2560;
  $('#local-tts-min-remaining-ram').value = settings.localTtsMinRemainingRamMb ?? 1024;
  updateVieNeuSpeedLabel('vi');
  updateKokoroSpeedLabel();
  const vieneuStatus = system.vieneu || {};
  const kokoroStatus = system.kokoro || {};
  const vieneuStatusSupported = Object.hasOwn(system, 'vieneu') || Object.hasOwn(system.tools || {}, 'vieneuTts');
  const alignerNotice = $('#tts-provider').value === 'vieneu' && settings.highlightEnabled && system.tools?.localWordAlignment === false
    ? ' Chưa có stable-ts; highlight VieNeu cần bộ căn chỉnh local. Cài bằng npm run setup:alignment.'
    : '';
  const localManager = system.localTts || {};
  const modelStatus = `VieNeu ${vieneuStatus.installed ? `đã cài · RAM trống ${vieneuStatus.freeRamMb ?? '?'} MB` : 'chưa sẵn sàng'} · Kokoro ${kokoroStatus.installed ? `đã cài · CPU ONNX · VRAM ${kokoroStatus.vramMb ?? 0} MB` : 'chưa sẵn sàng'}.`;
  const ramAfter = localManager.memoryAfter?.systemRamAvailableMb ?? localManager.memoryAfter?.freeRamMb;
  const workerRss = localManager.workerMemory?.processRssMb;
  const progress = localManager.segmentCount ? ` · câu ${localManager.segmentIndex || 0}/${localManager.segmentCount}` : '';
  const memory = `${workerRss ? ` · RAM worker ${workerRss} MB` : ''}${ramAfter ? ` · RAM trống sau worker ${ramAfter} MB` : ''}`;
  const managerStatus = localManager.active
    ? ` Đang dùng ${localManager.model}: ${localManager.phase}${progress}${localManager.workerPid ? ` · worker ${localManager.workerPid}` : ''}${memory}.`
    : ` Model hiện đã unload${memory}.`;
  const setupNotice = !kokoroStatus.installed ? ' Cài Kokoro bằng npm run setup:kokoro.' : '';
  $('#local-tts-status').textContent = !vieneuStatusSupported
    ? 'Server chưa báo trạng thái TTS local; hãy khởi động lại app để nạp phiên bản mới.'
    : `${modelStatus}${managerStatus}${setupNotice}${alignerNotice} TTS local được nạp theo từng ngôn ngữ; worker phải thoát trước khi chuyển model.`;
  $('#local-tts-status').classList.toggle('is-warning', !vieneuStatusSupported || !vieneuStatus.installed || !kokoroStatus.installed || Boolean(alignerNotice));
  $('#highlight-enabled').checked = settings.highlightEnabled !== false;
  $('#japanese-highlight-enabled').checked = settings.japaneseHighlightEnabled === true;
  $('#highlight-mode').value = settings.highlightMode || 'word';
  $('#highlight-color').value = settings.highlightColor || '#FF8066';
  syncBackgroundEffectPreview();
  $('#highlight-padding').value = settings.highlightPadding ?? 6;
  $('#highlight-radius').value = settings.highlightRadius ?? 8;
  $('#highlight-transition').value = 'instant';
  updateHighlightPreviewStyle();
  $('#posts-per-day').value = settings.postsPerDay;
  $('#prepare-days').value = settings.prepareAheadDays;
  $('#max-scripts').value = settings.maxScriptsPerDay;
  $('#auto-generation').checked = settings.autoGenerationEnabled;
  $('#auto-publish').checked = settings.autoPublishEnabled;
  $('#facebook-adapter').value = settings.facebookAdapter;
  $('#ai-status-pill').textContent = system.aiReady ? 'Đã sẵn sàng' : 'Chưa kết nối';
  $('#ai-status-pill').className = `state-pill ${system.aiReady ? 'ok' : 'warn'}`;
  $('#chatgpt-detail').textContent = settings.chatgpt.connected ? `Đã kết nối${settings.chatgpt.email ? ` · ${settings.chatgpt.email}` : ''}` : 'Đăng nhập theo OAuth chính thức. Không nhập API key.';
  $('#chatgpt-disconnect').hidden = !settings.chatgpt.connected;
  $('#chatgpt-connect').hidden = settings.chatgpt.connected;
  $('#auto-state').textContent = settings.autoGenerationEnabled || settings.autoPublishEnabled ? 'Đang bật' : 'Đang tắt';
  $('#auto-state').className = `state-pill ${(settings.autoGenerationEnabled || settings.autoPublishEnabled) ? 'ok' : 'neutral'}`;
  $('#test-facebook').textContent = settings.facebookAdapter === 'mock' ? 'Thử Mock' : 'Kiểm tra Page';
  renderToolChecks(system.tools);
}

function setGenerateButtonBusy(busy) {
  const button = $('#generate-button');
  button.disabled = busy;
  button.innerHTML = busy
    ? '<span>&#9675;</span> Đang tạo video…'
    : '<span>&#10033;</span> Tạo video mới <span class="button-arrow">&#8599;</span>';
}

async function generateVideo() {
  const button = $('#generate-button');
  if (button.disabled) return;
  setGenerateButtonBusy(true);
  let jobQueued = false;
  try {
    const contentLanguage = $('#content-language').value;
    if (contentLanguage === MOT_PHUT_CONTENT) {
      const modulePayload = window.motPhutVoLe?.createPayload?.();
      if (!modulePayload) throw new Error('Bảng tạo Một Phút Vỡ Lẽ chưa sẵn sàng. Tải lại trang rồi thử lại.');
      const moduleJob = await api('/api/mot-phut-vo-le/jobs', { method: 'POST', body: JSON.stringify(modulePayload) });
      toast('Đã thêm Một Phút Vỡ Lẽ vào hàng đợi', false, `Job ${moduleJob.job.id} · dùng cấu hình riêng của nhánh nội dung này.`);
      window.dispatchEvent(new CustomEvent('mot-phut-job-created', { detail: { job: moduleJob.job } }));
      return;
    }
    if (contentLanguage === THINGS_YOU_DIDNT_KNOW_CONTENT) {
      const modulePayload = window.thingsYouDidntKnow?.createPayload?.();
      if (!modulePayload) throw new Error('The Things You Didn\'t Know form is not ready. Reload the page and try again.');
      const moduleJob = await api('/api/things-you-didnt-know/jobs', { method: 'POST', body: JSON.stringify(modulePayload) });
      toast('Reel added to the Things You Didn\'t Know queue', false, `Job ${moduleJob.job.id} · one Reel · isolated settings.`);
      window.dispatchEvent(new CustomEvent('things-you-didnt-know-job-created', { detail: { job: moduleJob.job } }));
      setView('overview');
      return;
    }
    let payload;
    if (contentLanguage === 'english-shadowing') {
      payload = { contentLanguage };
    } else {
      await state.contentLanguageSavePromise;
      syncTtsProviderForContentLanguage(contentLanguage, state.settings || {});
      payload = {
        topicId: contentLanguage === 'ja' ? null : $('#topic-select').value || null,
        contentLanguage,
        ttsProvider: $('#tts-provider').value
      };
    }
    const result = await api('/api/generate', { method: 'POST', body: JSON.stringify(payload) });
    jobQueued = true;
    toast('Đã thêm video vào hàng đợi', false, contentLanguage === 'english-shadowing'
      ? 'Nhánh EnglishShadowing sẽ tạo caption, giọng Kokoro và video theo preset riêng.'
      : 'Worker sẽ xử lý kịch bản, giọng đọc và render.');
    watchJob(result.jobId);
    setView('overview');
  } catch (error) { toast('Không tạo được job', true, error.message); }
  finally { if (!jobQueued) setGenerateButtonBusy(false); }
}

let watchedJobs = new Set();
const publishFailureNotices = new Set();
let libraryProgressTimer;
function refreshLibraryProgress() { if (state.view !== 'library') return; clearTimeout(libraryProgressTimer); libraryProgressTimer = setTimeout(() => loadVideos().catch(() => {}), 650); }
function connectRealtime() {
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    const log = message.data || {};
    if (['tts:progress', 'render:progress', 'job:status'].includes(message.type)) refreshLibraryProgress();
    if (message.type === 'tts:progress' && watchedJobs.has(log.job_id)) {
      const detail = log.detail || {};
      $('#worker-label').textContent = `Đang tạo giọng ${detail.language === 'vi' ? 'Việt' : 'Anh'} · ${Math.round(Number(log.detail?.progress || 0) * 100)}%`;
    }
    if (message.type === 'render:progress' && watchedJobs.has(log.job_id)) {
      $('#worker-label').textContent = `Đang render · ${Math.round(Number(log.detail?.progress || 0) * 100)}%`;
    }
    if (message.type === 'job:status') {
      if (log.code === 'JOB_STARTED' && watchedJobs.has(log.job_id)) $('#worker-label').textContent = 'Đang xử lý job';
      if (['JOB_COMPLETED', 'JOB_FAILED'].includes(log.code)) {
        $('#worker-label').textContent = 'Worker đang hoạt động';
        if (watchedJobs.has(log.job_id)) refreshData();
      }
    }
    if (message.type === 'facebook:publish-status') {
      if (log.code === 'PUBLISH_VERIFIED') {
        const simulated = String(log.message || '').includes('qua mock.');
        toast(simulated ? 'Đăng mô phỏng hoàn tất' : 'Đăng Facebook thành công', false, log.message);
        refreshData();
      }
      if (log.code === 'PUBLISH_FAILED') {
        if (watchedJobs.has(log.job_id)) publishFailureNotices.add(log.job_id);
        toast('Đăng không thành công', true, log.message);
        refreshData();
      }
      if (state.view === 'logs') loadLogs();
    }
  });
  socket.addEventListener('close', () => {
    $('#worker-pill').classList.add('offline');
    setTimeout(connectRealtime, 2500);
  });
}
function watchJob(jobId) {
  watchedJobs.add(jobId);
  let checks = 0;
  const timer = setInterval(async () => {
    checks++;
    try {
      const result = await api('/api/jobs');
      const job = result.jobs.find((row) => row.id === jobId);
      if (job?.status === 'completed') {
        clearInterval(timer); watchedJobs.delete(jobId);
        toast('Job đã hoàn tất', false, job.type === 'create_video' ? 'Mở thư viện để xem trạng thái video.' : 'Kiểm tra nhật ký xuất bản.');
        if (job.type === 'create_video') setGenerateButtonBusy(false);
        await refreshData();
      } else if (job?.status === 'failed') {
        clearInterval(timer);
        if (job.type === 'publish_video' && !publishFailureNotices.has(jobId)) {
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
        const publishFailureAlreadyShown = publishFailureNotices.delete(jobId);
        watchedJobs.delete(jobId);
        if (!publishFailureAlreadyShown) toast('Job gặp lỗi', true, job.last_error || 'Mở Nhật ký hoạt động để xem chi tiết.');
        if (job.type === 'create_video') setGenerateButtonBusy(false);
        await refreshData();
      } else if (checks > 360) {
        clearInterval(timer); watchedJobs.delete(jobId);
        if (job?.type === 'create_video') setGenerateButtonBusy(false);
      }
    } catch { /* The next polling attempt will reconnect. */ }
  }, 2500);
}

async function handleVideoAction(event) {
  const button = event.currentTarget;
  if (button.dataset.backgroundEffectVideoId) {
    await openVideoBackgroundEffectEditor(button.dataset.backgroundEffectVideoId);
    return;
  }
  if (button.dataset.approveId) {
    button.disabled = true;
    try {
      const result = await api(`/api/videos/${encodeURIComponent(button.dataset.approveId)}/approve`, { method: 'POST' });
      const scheduleTime = dateText(result.scheduledAt, { dateStyle: 'medium', timeStyle: 'short' });
      toast('Đã duyệt video và xếp lịch', false, result.facebookScheduleState === 'queued'
        ? `Facebook đang nhận lịch đăng ${scheduleTime}.`
        : `Lịch đăng trong ứng dụng: ${scheduleTime}.`);
      await refreshData();
    } catch (error) {
      toast('Không duyệt được video', true, error.message);
      button.disabled = false;
    }
    return;
  }
  if (button.dataset.retryVideoId) {
    button.disabled = true;
    try {
      const result = await api(`/api/videos/${encodeURIComponent(button.dataset.retryVideoId)}/retry`, { method: 'POST' });
      toast('Đã xếp tạo lại video', false, 'Đang dùng kịch bản đã lưu.');
      watchJob(result.jobId);
      await loadVideos();
    } catch (error) {
      toast('Không xếp lại được video', true, error.message);
    } finally { button.disabled = false; }
    return;
  }
  if (button.dataset.deleteVideoId) {
    const video = state.videos.find((item) => item.id === button.dataset.deleteVideoId);
    if (!video) return;
    const title = video.title || video.topic || 'video này';
    if (!window.confirm(`Xóa “${title}” khỏi thư viện? Tệp video, ảnh bìa, lịch đăng và lịch sử đăng trong ứng dụng sẽ bị xóa. Bài đã đăng trên Facebook sẽ không bị gỡ.`)) return;
    button.disabled = true;
    try {
      await api(`/api/videos/${encodeURIComponent(video.id)}`, { method: 'DELETE' });
      toast('Đã xóa video khỏi thư viện');
      await refreshData();
    } catch (error) { toast('Không xóa được video', true, error.message); }
    return;
  }
  if (button.dataset.scriptId) {
    try {
      const { script } = await api(`/api/scripts/${encodeURIComponent(button.dataset.scriptId)}`);
      const targetField = script.contentLanguage === 'ja' ? 'japanese' : script.contentLanguage === 'zh' ? 'chinese' : 'english';
      script.dialogues = script.dialogues.map((line) => ({ ...line, english: line[targetField] || line.english }));
      $('#dialog-content').innerHTML = `<article class="script-detail"><div class="eyebrow">${escapeHtml(script.category)} · ${escapeHtml(script.level)}</div><h2>${escapeHtml(script.title)}</h2><p>${escapeHtml(script.hook)} · Nguồn: ${escapeHtml(script.provider)}</p><div class="dialog-lines">${script.dialogues.map((line) => `<div class="dialog-line"><span class="line-num">CÂU 0${line.index}</span><p>${escapeHtml(line.vietnamese)}</p><p class="en-line">${escapeHtml(line.english)}</p><small><strong>${escapeHtml(line.term)}</strong> · ${escapeHtml(line.meaningVi)}. ${escapeHtml(line.noteVi)}</small></div>`).join('')}</div><div class="dialog-caption"><strong>Caption</strong><br>${escapeHtml(script.captionText || script.caption)}</div></article>`;
      $('#detail-dialog').showModal();
    } catch (error) { toast('Không mở được kịch bản', true, error.message); }
    return;
  }
  if (button.dataset.scheduleId) {
    await loadSchedules();
    $('#schedule-video').value = button.dataset.scheduleId;
    setView('schedule');
    $('#schedule-video').value = button.dataset.scheduleId;
    $('#schedule-time').focus();
    toast('Chọn ngày và giờ đăng', false, 'Sau khi lưu, lịch sẽ được xử lý khi worker chạy.');
    return;
  }
  if (button.dataset.publishId) {
    const retryPublish = button.dataset.retryPublish === 'true';
    const retryMayDuplicate = button.dataset.retryMayDuplicate === 'true';
    const live = state.settings?.facebookAdapter === 'meta';
    const video = state.videos.find((item) => item.id === button.dataset.publishId);
    const contentLanguage = String(video?.content_language || 'en').toUpperCase();
    const confirmation = [`Xác nhận đăng LIVE “${video?.topic || 'video này'}” lên Facebook Page ${contentLanguage}. Hệ thống sẽ kiểm tra Page và token ngay trước khi gửi.`];
    if (retryMayDuplicate) confirmation.push('Meta chưa xác nhận kết quả lần đăng trước. Nếu Meta đã nhận video, đăng lại có thể tạo bài trùng.');
    const confirmLive = live && window.confirm(confirmation.join('\n\n'));
    if (live && !confirmLive) return;
    button.disabled = true;
    try {
      const result = await api(`/api/videos/${encodeURIComponent(button.dataset.publishId)}/publish`, { method: 'POST', body: JSON.stringify({ confirmLive, confirmRetryUncertain: retryPublish && retryMayDuplicate && confirmLive }) });
      const profileDetail = result.profileLabel ? ` Cấu hình: ${result.profileLabel}.` : '';
      toast('Đã thêm yêu cầu đăng vào hàng đợi', false, live ? `Đăng thật lên Facebook đang được xử lý.${profileDetail}` : 'Đang dùng adapter Mock, không có bài viết thật được tạo.');
      watchJob(result.jobId);
    } catch (error) { toast('Không đăng được video', true, error.message); }
    finally { button.disabled = false; }
  }
}

async function retryScheduledPost(event) {
  const button = event.currentTarget;
  const schedule = state.schedules.find((item) => item.id === button.dataset.retryScheduleId);
  if (!schedule) return;
  const contentLanguage = String(schedule.content_language || 'en').toUpperCase();
  const isPastDue = new Date(schedule.scheduled_at).getTime() <= Date.now();
  const mayDuplicate = Boolean(schedule.facebook_video_id)
    || ['uncertain', 'finishing'].includes(schedule.facebook_schedule_state)
    || schedule.last_publish_status === 'uncertain';
  const confirmation = isPastDue
    ? [`Thời điểm của “${schedule.topic}” đã đến hoặc đã qua. Xác nhận đăng LIVE ngay lên Facebook Page ${contentLanguage}?`]
    : [`Xác nhận kiểm tra Page ${contentLanguage} và gửi lại lịch “${schedule.topic}” lên Facebook?`];
  const timeUntilSchedule = new Date(schedule.scheduled_at).getTime() - Date.now();
  if (!isPastDue && timeUntilSchedule < 15 * 60_000) confirmation.push('Facebook cần thời gian nhận lịch; ứng dụng sẽ chuyển sang khung giờ phù hợp tiếp theo.');
  if (mayDuplicate) confirmation.push('Kết quả lần gửi trước chưa chắc chắn. Hệ thống sẽ kiểm tra ID cũ trước; nếu Facebook không cho xác minh, tiếp tục có thể tạo bài trùng.');
  if (!window.confirm(confirmation.join('\n\n'))) return;
  button.disabled = true;
  try {
    const result = await api(`/api/schedules/${encodeURIComponent(schedule.id)}/retry`, {
      method: 'POST',
      body: JSON.stringify({ confirmRetry: true, confirmDuplicate: mayDuplicate, confirmLive: isPastDue })
    });
    if (result.alreadyPublished) {
      toast('Facebook đã đăng bài này', false, 'Đã đối soát ID cũ và không tạo bài mới.');
    } else if (result.alreadyScheduled) {
      toast('Lịch Facebook đã được xác nhận', false, `Page ${result.pageName || contentLanguage} vẫn đang giữ lịch này.`);
    } else {
      const scheduledTime = result.scheduledAt ? ` · ${dateText(result.scheduledAt)}` : '';
      const profileDetail = result.profileLabel ? ` · cấu hình ${result.profileLabel}` : '';
      toast(isPastDue ? 'Đã xếp đăng live' : 'Đã xếp gửi lại lịch lên Facebook', false, `Page ${result.pageName || contentLanguage}${profileDetail}${isPastDue ? '' : scheduledTime}`);
      watchJob(result.jobId);
    }
    await loadSchedules();
  } catch (error) {
    toast('Không đăng lại được lịch', true, error.message);
  } finally { button.disabled = false; }
}

async function saveSettings() {
  const button = $('#save-settings'); button.disabled = true;
  const thingsSettingsPending = window.thingsYouDidntKnow?.hasPendingSettings?.() === true;
  if (thingsSettingsPending && (state.settingsDirty || state.englishShadowingSettingsDirty)) {
    try { await window.thingsYouDidntKnow.saveSettings({ throwOnError: true }); }
    catch (error) {
      button.disabled = false;
      toast("Không lưu được cài đặt Things You Didn't Know", true, error.message);
      return;
    }
  }
  if (thingsSettingsPending && !state.settingsDirty && !state.englishShadowingSettingsDirty) {
    try {
      await window.thingsYouDidntKnow.saveSettings({ throwOnError: true });
      toast('Đã lưu cài đặt Things You Didn\'t Know', false, 'Giọng đọc, hiệu ứng, highlight và Full Auto được lưu riêng.');
    } catch (error) { toast('Không lưu được cài đặt Things You Didn\'t Know', true, error.message); }
    finally { button.disabled = false; }
    return;
  }
  const motPhutSettingsPending = window.motPhutVoLe?.hasPendingSettings?.() === true;
  if (motPhutSettingsPending && !state.settingsDirty && !state.englishShadowingSettingsDirty) {
    try {
      await window.motPhutVoLe.saveSettings({ throwOnError: true });
      toast('Đã lưu cài đặt Một Phút Vỡ Lẽ', false, 'Cấu hình giọng tiếng Việt và nội dung được lưu riêng.');
    } catch (error) { toast('Không lưu được cài đặt Một Phút Vỡ Lẽ', true, error.message); }
    finally { button.disabled = false; }
    return;
  }
  if (state.englishShadowingSettingsDirty && !state.settingsDirty && !motPhutSettingsPending) {
    const revision = state.englishShadowingSettingsRevision;
    storeCurrentBackgroundEffectProfile();
    const payload = {
      voice: $('#english-shadowing-voice').value,
      speechRate: Number($('#english-shadowing-speech-rate').value),
      sentencePauseSeconds: Number($('#english-shadowing-sentence-pause').value),
      highlightEnabled: $('#english-shadowing-highlight-enabled').checked,
      highlightStyle: $('#english-shadowing-highlight-style').value,
      highlightMode: $('#english-shadowing-highlight-mode').value,
      highlightColor: $('#english-shadowing-highlight-color').value,
      highlightPadding: Number($('#english-shadowing-highlight-padding').value),
      highlightRadius: Number($('#english-shadowing-highlight-radius').value),
      backgroundEffectConfig: state.englishShadowingSettings?.backgroundEffectConfig
        ? { ...state.englishShadowingSettings.backgroundEffectConfig }
        : undefined
    };
    try {
      const result = await api('/api/english-shadowing/settings', { method: 'POST', body: JSON.stringify(payload) });
      const editedWhileSaving = state.englishShadowingSettingsRevision !== revision;
      const latestBackgroundEffectConfig = state.englishShadowingSettings?.backgroundEffectConfig;
      state.englishShadowingSettings = {
        ...result.settings,
        ...(editedWhileSaving ? { backgroundEffectConfig: latestBackgroundEffectConfig } : {})
      };
      if (!editedWhileSaving) {
        state.englishShadowingSettingsDirty = false;
        if (state.backgroundEffectLanguage === 'english-shadowing') applyBackgroundEffectProfile('english-shadowing');
      }
      toast(editedWhileSaving ? 'Đã lưu cài đặt Shadowing trước đó' : 'Đã lưu cài đặt Shadowing', false,
        editedWhileSaving ? 'Bạn vừa thay đổi thêm; hãy lưu lần nữa để lưu các giá trị mới.' : 'Cài đặt này chỉ áp dụng cho video Shadowing mới.');
    } catch (error) {
      toast('Không lưu được cài đặt Shadowing', true, error.message);
    } finally { button.disabled = false; }
    return;
  }
  const revisionAtSave = state.settingsRevision;
  storeCurrentBackgroundEffectProfile();
  const englishShadowingRevisionAtSave = state.englishShadowingSettingsRevision;
  const englishShadowingPayloadAtSave = state.englishShadowingSettingsDirty ? {
    voice: $('#english-shadowing-voice').value,
    speechRate: Number($('#english-shadowing-speech-rate').value),
    sentencePauseSeconds: Number($('#english-shadowing-sentence-pause').value),
    highlightEnabled: $('#english-shadowing-highlight-enabled').checked,
    highlightStyle: $('#english-shadowing-highlight-style').value,
    highlightMode: $('#english-shadowing-highlight-mode').value,
    highlightColor: $('#english-shadowing-highlight-color').value,
    highlightPadding: Number($('#english-shadowing-highlight-padding').value),
    highlightRadius: Number($('#english-shadowing-highlight-radius').value),
    backgroundEffectConfig: state.englishShadowingSettings?.backgroundEffectConfig
      ? { ...state.englishShadowingSettings.backgroundEffectConfig }
      : undefined
  } : null;
  const englishBackgroundEffectProfile = state.backgroundEffectProfiles.en;
  const selectedContentLanguage = $('#content-language').value;
  const contentLanguage = ['en', 'ja', 'zh'].includes(selectedContentLanguage)
    ? selectedContentLanguage
    : (['en', 'ja', 'zh'].includes(state.settings?.contentLanguage) ? state.settings.contentLanguage : 'en');
  const selectedTtsProvider = $('#tts-provider').value;
  const separateContentModeSelected = !['en', 'ja', 'zh'].includes(selectedContentLanguage);
  const ttsProvider = separateContentModeSelected
    ? providerForContentLanguage(contentLanguage, state.settings || {})
    : selectedTtsProvider === 'supertonic3-ko'
      ? (contentLanguage === 'ja' ? (state.settings?.japaneseTtsProvider || 'vieneu-sbv2') : contentLanguage === 'zh' ? (state.settings?.chineseTtsProvider || 'vieneu-cosyvoice3') : (state.settings?.ttsProvider || 'vieneu'))
      : selectedTtsProvider;
  const ttsProviderKey = contentLanguage === 'ja' ? 'japaneseTtsProvider' : contentLanguage === 'zh' ? 'chineseTtsProvider' : 'ttsProvider';
  const vietnameseVoiceInput = contentLanguage === 'zh' ? '#cosyvoice-vi-voice' : contentLanguage === 'ja' ? '#sbv2-vi-voice' : '#vieneu-vi-voice';
  const vietnameseVoiceKey = contentLanguage === 'zh' ? 'vieneuZhViVoice' : contentLanguage === 'ja' ? 'vieneuJaViVoice' : 'vieneuViVoice';
  const cosyVoiceProfileId = $('#cosyvoice-profile').value;
  const cosyVoiceProfiles = (state.settings?.cosyVoiceProfiles || []).filter((profile) => profile.ready && String(profile.name || '').trim() && String(profile.referenceText || '').trim()).map((profile) => ({ ...profile }));
  if (cosyVoiceProfileId) {
    const name = $('#cosyvoice-profile-name').value.trim();
    const referenceText = $('#cosyvoice-reference-text').value.trim();
    const savedProfile = cosyVoiceProfiles.find((profile) => profile.id === cosyVoiceProfileId);
    if (!savedProfile && state.cosyVoiceUploadedProfileId !== cosyVoiceProfileId) {
      button.disabled = false;
      toast('Hồ sơ giọng Trung chưa có WAV', true, 'Tải WAV mẫu lên trước khi lưu hồ sơ.');
      return;
    }
    if (!name || !referenceText) {
      button.disabled = false;
      toast('Thiếu thông tin giọng Trung', true, 'Nhập tên giọng và bản chép chính xác của WAV mẫu.');
      return;
    }
    const updatedProfile = {
      ...savedProfile, id: cosyVoiceProfileId, name,
      referenceText: savedProfile.automatic ? savedProfile.referenceText : referenceText
    };
    const index = cosyVoiceProfiles.findIndex((profile) => profile.id === cosyVoiceProfileId);
    if (index >= 0) cosyVoiceProfiles[index] = updatedProfile;
    else cosyVoiceProfiles.push(updatedProfile);
  }
  const payload = {
    [ttsProviderKey]: ttsProvider,
    contentLanguage,
    koreanTtsProvider: state.settings?.koreanTtsProvider || 'supertonic3-ko',
    supertonicKoreanVoice: $('#supertonic-ko-voice').value,
    supertonicKoreanSpeed: Number($('#supertonic-ko-speed')?.value || 1),
    [vietnameseVoiceKey]: $(vietnameseVoiceInput).value,
    kokoroEnVoice: $('#kokoro-en-voice').value,
    vieneuViSpeed: Number($('#vieneu-vi-speed').value),
    kokoroEnSpeed: Number($('#kokoro-en-speed').value),
    styleBertVits2Voice: $('#sbv2-voice').value,
    styleBertVits2Style: $('#sbv2-style').value,
    styleBertVits2Speed: Number($('#sbv2-speed').value),
    cosyVoiceProfile: 'custom',
    cosyVoiceProfileId,
    cosyVoiceProfileName: $('#cosyvoice-profile-name').value.trim(),
    cosyVoiceReferenceText: $('#cosyvoice-reference-text').value.trim(),
    cosyVoiceProfiles,
    localTtsMinFreeRamMb: Number($('#local-tts-min-free-ram').value),
    localTtsMinRemainingRamMb: Number($('#local-tts-min-remaining-ram').value),
    highlightEnabled: $('#highlight-enabled').checked,
    japaneseHighlightEnabled: $('#japanese-highlight-enabled').checked,
    highlightMode: $('#highlight-mode').value,
    highlightColor: $('#highlight-color').value,
    backgroundEffectProfiles: state.backgroundEffectProfiles,
    backgroundEffect: englishBackgroundEffectProfile.backgroundEffect,
    backgroundEffectDensity: englishBackgroundEffectProfile.backgroundEffectDensity,
    backgroundEffectSpeed: englishBackgroundEffectProfile.backgroundEffectSpeed,
    backgroundEffectOpacity: englishBackgroundEffectProfile.backgroundEffectOpacity,
    highlightPadding: Number($('#highlight-padding').value),
    highlightRadius: Number($('#highlight-radius').value),
    highlightTransition: $('#highlight-transition').value,
    postsPerDay: Number($('#posts-per-day').value), prepareAheadDays: Number($('#prepare-days').value),
    maxScriptsPerDay: Number($('#max-scripts').value),
    facebookAdapter: $('#facebook-adapter').value, autoGenerationEnabled: $('#auto-generation').checked,
    autoPublishEnabled: $('#auto-publish').checked
  };
  try {
    const result = await api('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
    if (result[ttsProviderKey] !== ttsProvider) {
      throw new Error('Server không xác nhận nhà cung cấp giọng đọc đã chọn. App có thể đang chạy phiên bản cũ; hãy khởi động lại app rồi lưu lại.');
    }
    if (result[vietnameseVoiceKey] !== payload[vietnameseVoiceKey]) {
      throw new Error('Server chưa xác nhận giọng tiếng Việt riêng của ngôn ngữ đang chọn. Khởi động lại app rồi lưu lại cài đặt.');
    }
    if (Number(result.backgroundEffectDensity) !== payload.backgroundEffectDensity
      || Number(result.backgroundEffectSpeed) !== payload.backgroundEffectSpeed
      || Number(result.backgroundEffectOpacity) !== payload.backgroundEffectOpacity) {
      throw new Error('Server chưa xác nhận mật độ, tốc độ trôi hoặc độ rõ hiệu ứng đã lưu. Hãy khởi động lại app rồi lưu lại.');
    }
    const effectKeys = ['backgroundEffect', 'backgroundEffectDensity', 'backgroundEffectSpeed', 'backgroundEffectOpacity'];
    const savedEveryLanguageEffect = ['en', 'zh', 'ja'].every((language) => effectKeys.every((key) =>
      result.backgroundEffectProfiles?.[language]?.[key] === payload.backgroundEffectProfiles[language]?.[key]
    ));
    if (!savedEveryLanguageEffect) {
      throw new Error('Server chưa xác nhận đủ hiệu ứng đã lưu theo ba ngôn ngữ. Hãy khởi động lại app rồi lưu lại.');
    }
    state.settings = result;
    if (englishShadowingPayloadAtSave) {
      try {
        const shadowingResult = await api('/api/english-shadowing/settings', {
          method: 'POST',
          body: JSON.stringify(englishShadowingPayloadAtSave)
        });
        const shadowingEditedWhileSaving = state.englishShadowingSettingsRevision !== englishShadowingRevisionAtSave;
        const latestShadowingBackgroundEffectConfig = state.englishShadowingSettings?.backgroundEffectConfig;
        state.englishShadowingSettings = {
          ...shadowingResult.settings,
          ...(shadowingEditedWhileSaving ? { backgroundEffectConfig: latestShadowingBackgroundEffectConfig } : {})
        };
        if (!shadowingEditedWhileSaving) {
          state.englishShadowingSettingsDirty = false;
          if (state.backgroundEffectLanguage === 'english-shadowing') applyBackgroundEffectProfile('english-shadowing');
        }
      } catch (error) {
        state.settingsDirty = state.settingsRevision !== revisionAtSave;
        toast('Đã lưu cài đặt chung nhưng chưa lưu được cài đặt EasyEnglishShadowing', true, error.message);
        return;
      }
    }
    const standardSettingsEditedWhileSaving = state.settingsRevision !== revisionAtSave;
    const shadowingEditedWhileSaving = state.englishShadowingSettingsRevision !== englishShadowingRevisionAtSave;
    const editedWhileSaving = standardSettingsEditedWhileSaving || shadowingEditedWhileSaving;
    state.settingsDirty = standardSettingsEditedWhileSaving;
    if (motPhutSettingsPending) {
      try { await window.motPhutVoLe.saveSettings({ throwOnError: true }); }
      catch (error) { toast('Cài đặt chung đã lưu nhưng cài đặt Một Phút Vỡ Lẽ chưa lưu', true, error.message); }
    }
    toast(editedWhileSaving ? 'Đã lưu bản cài đặt trước đó' : 'Đã lưu cài đặt', false, editedWhileSaving ? 'Bạn vừa thay đổi thêm cài đặt; hãy lưu lần nữa để lưu các thay đổi mới.' : '');
    await loadOverview();
    if (!editedWhileSaving) await loadSettings();
  } catch (error) { toast('Không lưu được cài đặt', true, error.message); }
  finally { button.disabled = false; }
}

async function saveFacebook() {
  const button = $('#save-facebook');
  const contentLanguage = $('#facebook-quick-route-language').value;
  const languageName = ({ en: 'Tiếng Anh', zh: 'Tiếng Trung', ja: 'Tiếng Nhật', 'english-shadowing': 'EnglishShadowing' })[contentLanguage] || contentLanguage.toUpperCase();
  const resultEl = $('#facebook-result');
  const confirmed = window.confirm(`Bạn đang lưu Page ID và token cho ${languageName} (${contentLanguage.toUpperCase()}). Hãy kiểm tra menu Ngôn ngữ Page. Chỉ chọn OK nếu đây đúng là Page dùng để đăng nội dung ${languageName}.`);
  if (!confirmed) {
    resultEl.textContent = `Chưa lưu. Hãy chọn đúng Ngôn ngữ Page (${languageName}) rồi bấm Lưu thông tin.`;
    return;
  }
  button.disabled = true;
  try {
    const pageId = $('#page-id').value.trim();
    const pageToken = $('#page-token').value.trim();
    await api('/api/facebook/credentials', { method: 'POST', body: JSON.stringify({ pageId, pageToken, contentLanguage }) });
    state.facebookPageCredentialDirty = false;
    state.facebookPageLanguageDirty = false;
    $('#page-token').value = '';
    if (contentLanguage !== 'english-shadowing') {
      await api('/api/settings', { method: 'POST', body: JSON.stringify({ facebookAdapter: $('#facebook-adapter').value }) });
    }
    resultEl.textContent = `Đã lưu Page ${contentLanguage.toUpperCase()} riêng cho nội dung ${languageName}.`;
    toast('Đã lưu thông tin Facebook', false, `Page ${contentLanguage.toUpperCase()} đã được gắn với nội dung ${contentLanguage.toUpperCase()}. Token được lưu cục bộ và ẩn khỏi giao diện.`);
    await loadSettings(); await loadOverview();
  } catch (error) { resultEl.textContent = error.message; toast('Không lưu được Facebook', true, error.message); }
  finally { button.disabled = false; }
}

async function testFacebook() {
  if (state.facebookPageCredentialDirty) {
    toast('Hãy lưu cấu hình Page trước', true, 'Nút kiểm tra xác minh Page đã lưu cho ngôn ngữ đang chọn.');
    return;
  }
  const resultEl = $('#facebook-result'); resultEl.textContent = 'Đang kiểm tra…';
  try {
    const contentLanguage = $('#facebook-quick-route-language').value;
    const result = await api('/api/facebook/test', { method: 'POST', body: JSON.stringify({ contentLanguage }) });
    resultEl.textContent = `Kết nối thành công · ${result.pageName}`;
    toast('Kết nối Facebook thành công', false, result.pageName);
    await loadSettings(); await loadOverview();
  } catch (error) { resultEl.textContent = error.message; toast('Kiểm tra Facebook thất bại', true, error.message); }
}

async function previewVoice(language, chosenVoice = '', button = null, speedOverride = null) {
  const previewTexts = { vi: 'Xin chào, bạn có thể giúp mình được không?', en: 'Could you help me with this?', ja: 'すみません、手伝っていただけますか。', zh: '你好，欢迎来到我们的中文学习频道。今天我们一起学习中文。', ko: '안녕하세요. 오늘도 한국어를 함께 연습해요.' };
  const provider = language === 'ja' ? 'vieneu-sbv2' : language === 'zh' ? 'vieneu-cosyvoice3' : language === 'ko' ? 'supertonic3-ko' : 'vieneu';
  const text = previewTexts[language] || previewTexts.en;
  const voice = chosenVoice || (provider === 'vieneu'
    ? (language === 'vi' ? $('#vieneu-vi-voice').value : $('#kokoro-en-voice').value)
    : provider === 'vieneu-sbv2' ? $('#sbv2-voice').value
      : provider === 'supertonic3-ko' ? $('#supertonic-ko-voice').value
      : 'cosyvoice3-reference');
  const payload = { language, text, voice, ttsProvider: provider };
  if (provider === 'vieneu') payload.speed = Number.isFinite(speedOverride) ? speedOverride : Number(language === 'vi' ? $('#vieneu-vi-speed').value : $('#kokoro-en-speed').value);
  else if (provider === 'vieneu-sbv2') { payload.speed = Number($('#sbv2-speed').value); }
  else if (provider === 'vieneu-cosyvoice3') {
    payload.cosyVoiceProfileId = $('#cosyvoice-profile').value;
    payload.cosyVoiceProfileName = $('#cosyvoice-profile-name').value.trim();
    payload.cosyVoiceReferenceText = $('#cosyvoice-reference-text').value.trim();
  }
  else payload.speed = Number.isFinite(speedOverride) ? speedOverride : Number($('#supertonic-ko-speed')?.value || 1);
  if (button) button.disabled = true;
  try {
    const result = await api('/api/tts/preview', { method: 'POST', body: JSON.stringify(payload) });
    if (previewAudio) { previewAudio.pause(); previewAudio.currentTime = 0; }
    previewAudio = new Audio(new URL(result.url, window.location.href).href);
    await previewAudio.play();
    const languageName = { vi: 'tiếng Việt', en: 'tiếng Anh', ja: 'tiếng Nhật', zh: 'tiếng Trung', ko: 'tiếng Hàn' }[language] || language;
    toast(`Đang phát giọng ${languageName}`, false, result.voice);
  } catch (error) { toast('Không tạo được bản nghe thử', true, error.message); }
  finally { if (button) button.disabled = false; }
}

function updateHighlightPreviewStyle() {
  const preview = $('#highlight-preview-words');
  if (!preview) return;
  preview.style.setProperty('--highlight-color', $('#highlight-color').value || '#FF8066');
  preview.style.setProperty('--highlight-padding', `${Number($('#highlight-padding').value) || 0}px`);
  preview.style.setProperty('--highlight-radius', `${Number($('#highlight-radius').value) || 0}px`);
  preview.style.setProperty('--highlight-transition-duration', $('#highlight-transition').value === 'smooth' ? '100ms' : '0ms');
}

async function previewHighlight() {
  const button = $('#highlight-preview-play');
  const status = $('#highlight-preview-status');
  button.disabled = true;
  status.textContent = 'Đang tạo audio và lấy WordBoundary…';
  try {
    const language = $('#highlight-preview-language').value;
    const text = $('#highlight-preview-source').value.trim();
    const provider = language === 'ja' ? 'vieneu-sbv2' : language === 'zh' ? 'vieneu-cosyvoice3' : 'vieneu';
    const voice = provider === 'vieneu'
      ? (language === 'vi' ? $('#vieneu-vi-voice').value : $('#kokoro-en-voice').value)
      : provider === 'vieneu-sbv2' ? $('#sbv2-voice').value : 'cosyvoice3-reference';
    const previewSettings = provider === 'vieneu'
      ? { speed: Number(language === 'vi' ? $('#vieneu-vi-speed').value : $('#kokoro-en-speed').value) }
      : { speed: provider === 'vieneu-sbv2' ? Number($('#sbv2-speed').value) : 1 };
    const result = await api('/api/tts/preview', { method: 'POST', body: JSON.stringify({ language, text, voice, ttsProvider: provider, ...previewSettings, withWordBoundaries: true, highlightMode: $('#highlight-mode').value }) });
    const host = $('#highlight-preview-words');
    host.replaceChildren();
    let offset = 0;
    const spans = new Map();
    for (const token of result.tokens || []) {
      if (token.start > offset) host.append(document.createTextNode(text.slice(offset, token.start)));
      const span = document.createElement('span');
      span.className = 'highlight-preview-word';
      span.dataset.tokenId = token.id;
      span.textContent = token.text;
      host.append(span);
      spans.set(token.id, span);
      offset = token.end;
    }
    if (offset < text.length) host.append(document.createTextNode(text.slice(offset)));
    updateHighlightPreviewStyle();
    if (highlightPreviewAudio) {
      highlightPreviewAudio.pause();
      highlightPreviewAudio = null;
    }
    if (highlightPreviewFrame) cancelAnimationFrame(highlightPreviewFrame);
    const audio = new Audio(result.url);
    highlightPreviewAudio = audio;
    const intervals = $('#highlight-enabled').checked ? result.highlightIntervals || [] : [];
    const updateWord = () => {
      const time = audio.currentTime;
      const active = intervals.find((item) => time >= item.startSeconds && time < item.endSeconds);
      const activeIds = new Set(active?.tokenIds || []);
      for (const [tokenId, span] of spans) span.classList.toggle('is-active', activeIds.has(tokenId));
    };
    const syncPreview = () => {
      updateWord();
      if (!audio.paused && !audio.ended) highlightPreviewFrame = requestAnimationFrame(syncPreview);
    };
    audio.addEventListener('play', syncPreview);
    audio.addEventListener('pause', () => { if (highlightPreviewFrame) cancelAnimationFrame(highlightPreviewFrame); });
    audio.addEventListener('ended', () => { if (highlightPreviewFrame) cancelAnimationFrame(highlightPreviewFrame); for (const span of spans.values()) span.classList.remove('is-active'); });
    await audio.play();
    status.textContent = result.alignment?.reliable
      ? `Đang nghe thử · ${result.voice}${result.alignmentSource === 'stable-ts-local' ? ' · căn chỉnh local' : ''}${result.wordTimings.length ? ` · ${result.wordTimings.length} mốc từ` : ''}`
      : `Audio đã tạo, nhưng không có căn chỉnh đáng tin nên preview không tô từ.${result.warning ? ` ${result.warning}` : ''}`;
  } catch (error) {
    status.textContent = error.message;
    toast('Không tạo được preview highlight', true, error.message);
  } finally { button.disabled = false; }
}

async function addTopic() {
  const title = window.prompt('Tên chủ đề mới:');
  if (!title?.trim()) return;
  const category = window.prompt('Nhóm chủ đề:', 'Chủ đề tùy chỉnh');
  if (!category?.trim()) return;
  try {
    const result = await api('/api/topics', { method: 'POST', body: JSON.stringify({ title: title.trim(), category: category.trim() }) });
    const topics = await api('/api/topics'); state.topics = topics.topics; renderTopics();
    $('#topic-select').value = result.topic.id;
    toast('Đã thêm chủ đề', false, result.topic.title);
  } catch (error) { toast('Không thêm được chủ đề', true, error.message); }
}

async function createSchedule(event) {
  event.preventDefault();
  try {
    const videoId = $('#schedule-video').value;
    const scheduledAt = $('#schedule-time').value;
    const isMotPhut = state.motPhutVideos.some((video) => video.id === videoId);
    const result = isMotPhut
      ? await api(`/api/mot-phut-vo-le/videos/${encodeURIComponent(videoId)}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt }) })
      : await api(`/api/videos/${encodeURIComponent(videoId)}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt }) });
    const savedAt = isMotPhut ? result.schedule?.scheduledAt : result.scheduledAt;
    toast(isMotPhut ? 'Đã thêm lịch Một Phút Vỡ Lẽ' : result.facebookScheduleState === 'queued' ? 'Đã xếp lịch gửi lên Facebook' : 'Đã lưu lịch đăng', false, dateText(savedAt));
    $('#schedule-form').reset(); await loadSchedules(); await loadOverview();
  } catch (error) { toast('Không lưu được lịch', true, error.message); }
}

async function deleteMotPhutScheduledPost(event) {
  const button = event.target.closest('[data-mot-phut-delete-schedule-id]');
  if (!button) return;
  const schedule = state.motPhutSchedules.find((item) => item.id === button.dataset.motPhutDeleteScheduleId);
  if (!schedule) return;
  const remoteMayExist = ['scheduled', 'uncertain', 'uploading', 'finishing'].includes(schedule.facebookScheduleState);
  const prompt = remoteMayExist
    ? 'Xóa lịch MPVL khỏi tool? Lịch đã gửi lên Facebook có thể vẫn còn trong Planner.'
    : 'Xóa lịch MPVL khỏi tool? Video sẽ được giữ nguyên.';
  if (!window.confirm(prompt)) return;
  button.disabled = true;
  try {
    await api(`/api/mot-phut-vo-le/schedules/${encodeURIComponent(schedule.id)}`, { method: 'DELETE' });
    toast('Đã xóa lịch MPVL', false, remoteMayExist ? 'Hãy kiểm tra Facebook Planner nếu lịch đã được gửi.' : 'Video và file vẫn được giữ.');
    await loadSchedules();
  } catch (error) { toast('Không xóa được lịch MPVL', true, error.message); button.disabled = false; }
}

async function deletePublishedSchedule(event) {
  const button = event.target.closest('[data-delete-published-id]');
  if (!button) return;
  const record = state.publishedSchedules.find((item) => item.id === button.dataset.deletePublishedId);
  if (!record) return;
  if (!window.confirm(`Xóa thông tin lịch sử của “${record.title || record.topic}”? Bài đã đăng trên Facebook sẽ không bị gỡ.`)) return;
  button.disabled = true;
  try {
    await api(`/api/published-posts/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
    toast('Đã xóa thông tin lịch sử bài đăng');
    await loadSchedules();
  } catch (error) {
    toast('Không xóa được thông tin lịch sử', true, error.message);
    button.disabled = false;
  }
}

async function deleteScheduledPost(event) {
  const button = event.currentTarget;
  const schedule = state.schedules.find((item) => item.id === button.dataset.deleteScheduleId);
  if (!schedule) return;
  const title = schedule.title || schedule.topic || 'nội dung này';
  const remoteMayExist = Boolean(schedule.facebook_video_id) || schedule.facebook_schedule_state === 'uncertain';
  const confirmation = [
    `Xóa lịch “${title}” khỏi tool? Video và file đã tải về sẽ được giữ nguyên.`,
    'Thao tác này không gỡ bài đã đăng và không hủy lịch trực tiếp trên Facebook.'
  ];
  if (remoteMayExist) confirmation.push('Kết quả Facebook chưa chắc chắn; bài hoặc lịch Facebook có thể vẫn còn. Hãy kiểm tra Page/Planner nếu cần.');
  if (!window.confirm(confirmation.join('\n\n'))) return;
  button.disabled = true;
  try {
    await api(`/api/schedules/${encodeURIComponent(schedule.id)}`, { method: 'DELETE' });
    toast('Đã xóa lịch khỏi tool', false, 'Video và file đã tải về vẫn được giữ; Facebook không bị thay đổi.');
    await loadSchedules();
    await loadOverview();
  } catch (error) {
    toast('Không xóa được lịch', true, error.message);
    button.disabled = false;
  }
}

async function purgeScheduledPost(event) {
  const button = event.currentTarget;
  const schedule = state.schedules.find((item) => item.id === button.dataset.purgeScheduleId);
  if (!schedule) return;
  const title = schedule.title || schedule.topic || 'nội dung này';
  const remoteMayRemain = Boolean(schedule.facebook_video_id)
    || ['scheduled', 'uncertain'].includes(schedule.facebook_schedule_state);
  const confirmation = [
    `Xóa sạch “${title}” khỏi tool và máy? Lịch, video, ảnh bìa, audio và tệp tạm riêng của bài sẽ bị xóa; không thể hoàn tác.`,
    'Nút này không gỡ bài hoặc hủy lịch đã gửi lên Facebook.'
  ];
  if (remoteMayRemain) confirmation.push('Facebook đã nhận hoặc chưa xác minh được lịch này; hãy kiểm tra Planner nếu muốn xóa cả bên Facebook.');
  if (!window.confirm(confirmation.join('\n\n'))) return;
  button.disabled = true;
  try {
    const result = await api(`/api/schedules/${encodeURIComponent(schedule.id)}/purge`, { method: 'DELETE' });
    await refreshData();
    if (result.cleanupWarnings?.length) {
      toast('Đã xóa khỏi tool nhưng còn thư mục chưa dọn được trên máy', true, result.cleanupWarnings.join(' · '));
    } else {
      toast('Đã xóa sạch bài khỏi tool và máy', false, result.facebookRemoteMayRemain ? 'Lịch hoặc bài trên Facebook vẫn có thể còn; kiểm tra Planner.' : 'Đã dọn dữ liệu riêng của bài.');
    }
  } catch (error) {
    toast('Không xóa sạch được bài', true, error.message);
    button.disabled = false;
  }
}

async function refreshData() {
  try {
    const [overview, videos, topics] = await Promise.all([api('/api/overview'), api('/api/videos'), state.topics.length ? Promise.resolve(null) : api('/api/topics')]);
    state.overview = overview; state.videos = videos.videos;
    if (topics) { state.topics = topics.topics; renderTopics(); }
    renderOverview(); renderLibrary();
    if (state.view === 'schedule') await loadSchedules();
    if (state.view === 'settings') await loadSettings();
    if (state.view === 'logs') await loadLogs();
  } catch (error) { toast('Không tải được dữ liệu', true, error.message); }
}

function setupEvents() {
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  $$('[data-go]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.go)));
  $$('[data-generate]').forEach((button) => button.addEventListener('click', () => { setView('overview'); $('#generate-button').focus(); }));
  $('#generate-button').addEventListener('click', generateVideo);
  $$('.filter-tab').forEach((button) => button.addEventListener('click', () => { state.filter = button.dataset.filter; $$('.filter-tab').forEach((tab) => tab.classList.toggle('active', tab === button)); renderLibrary(); }));
  $('#content-language').addEventListener('change', changeContentLanguage);
  $('#content-language-filter').addEventListener('change', (event) => { state.languageFilter = event.currentTarget.value; renderLibrary(); });
  renderTtsProviderMenu();
  $('#tts-provider-trigger').addEventListener('click', toggleTtsProviderMenu);
  $('#tts-provider-options').addEventListener('click', (event) => {
    const option = event.target.closest('[data-tts-provider]');
    if (!option) return;
    selectTtsProviderView(option.dataset.ttsProvider);
    closeTtsProviderMenu({ restoreFocus: true });
  });
  $('#tts-provider-options').addEventListener('keydown', (event) => {
    const options = Array.from($('#tts-provider-options').querySelectorAll('[role="option"]'));
    const currentIndex = options.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTtsProviderMenu({ restoreFocus: true });
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[nextIndex]?.focus();
    } else if (event.key === 'Tab') {
      setTimeout(() => {
        if (!$('#tts-provider-combobox').contains(document.activeElement)) closeTtsProviderMenu();
      }, 0);
    }
  });
  $('#tts-provider').addEventListener('change', () => selectTtsProvider($('#tts-provider').value));
  document.addEventListener('pointerdown', (event) => {
    if (!$('#tts-provider-combobox').contains(event.target)) closeTtsProviderMenu();
  });
  $('#vieneu-vi-speed').addEventListener('input', () => updateVieNeuSpeedLabel('vi'));
  for (const id of ['vieneu-vi-speed', 'sbv2-vi-speed', 'cosyvoice-vi-speed']) {
    $(`#${id}`).addEventListener('input', () => syncLocalVietnameseSpeed(`#${id}`));
  }
  $('#preview-vieneu-vi').addEventListener('click', (event) => previewVoice('vi', '', event.currentTarget));
  $('#preview-vieneu-en').addEventListener('click', (event) => previewVoice('en', '', event.currentTarget));
  $('#preview-english-shadowing-voice').addEventListener('click', (event) => previewVoice('en', $('#english-shadowing-voice').value, event.currentTarget, Number($('#english-shadowing-speech-rate').value || 0.75)));
  $('#english-shadowing-speech-rate').addEventListener('input', updateEnglishShadowingDeliveryLabels);
  $('#english-shadowing-sentence-pause').addEventListener('input', updateEnglishShadowingDeliveryLabels);
  $('#preview-vieneu-vi-sbv2').addEventListener('click', (event) => previewVoice('vi', $('#sbv2-vi-voice').value, event.currentTarget));
  $('#preview-vieneu-vi-cosyvoice').addEventListener('click', (event) => previewVoice('vi', $('#cosyvoice-vi-voice').value, event.currentTarget));
  $('#preview-ja').addEventListener('click', (event) => previewVoice('ja', '', event.currentTarget));
  $('#preview-zh').addEventListener('click', (event) => previewVoice('zh', '', event.currentTarget));
  $('#preview-ko').addEventListener('click', (event) => previewVoice('ko', '', event.currentTarget));
  $('#cosyvoice-new-profile').addEventListener('click', createCosyVoiceProfile);
  $('#cosyvoice-rename-profile').addEventListener('click', renameCosyVoiceProfile);
  $('#cosyvoice-delete-profile').addEventListener('click', deleteCosyVoiceProfile);
  $('#cosyvoice-download-library').addEventListener('click', startCosyVoiceLibraryInstall);
  $('#cosyvoice-retry-library').addEventListener('click', startCosyVoiceLibraryInstall);
  $('#cosyvoice-check-library').addEventListener('click', checkCosyVoiceLibrary);
  $('#cosyvoice-cancel-library').addEventListener('click', cancelCosyVoiceLibraryInstall);
  $('#cosyvoice-profile').addEventListener('change', (event) => {
    syncActiveCosyVoiceProfileDraft();
    selectCosyVoiceProfile(event.currentTarget.value);
  });
  $('#cosyvoice-profile-name').addEventListener('input', syncActiveCosyVoiceProfileDraft);
  $('#cosyvoice-reference-text').addEventListener('input', syncActiveCosyVoiceProfileDraft);
  $('#cosyvoice-reference-file').addEventListener('change', async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const profileId = $('#cosyvoice-profile').value;
    if ((state.settings?.cosyVoiceProfiles || []).find((profile) => profile.id === profileId)?.automatic) {
      event.currentTarget.value = '';
      toast('Giọng AISHELL-3 không sửa WAV gốc', true, 'Bạn có thể đổi tên; transcript và dữ liệu nguồn được giữ nguyên.');
      return;
    }
    if (!profileId) {
      event.currentTarget.value = '';
      toast('Chọn hoặc thêm hồ sơ giọng trước', true, 'WAV sẽ được lưu trong hồ sơ đang chọn.');
      return;
    }
    const status = $('#cosyvoice-reference-status');
    status.textContent = 'Đang lưu WAV mẫu vào hồ sơ giọng…';
    try {
      const response = await fetch(`/api/tts/cosyvoice-reference?profileId=${encodeURIComponent(profileId)}`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: file });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Server returned ${response.status}.`);
      const profiles = state.settings.cosyVoiceProfiles || [];
      const current = profiles.find((profile) => profile.id === profileId);
      const updated = {
        ...current,
        id: profileId, name: $('#cosyvoice-profile-name').value.trim(),
        referenceText: $('#cosyvoice-reference-text').value.trim(), ready: true
      };
      state.settings.cosyVoiceProfiles = current ? profiles.map((profile) => profile.id === profileId ? updated : profile) : [...profiles, updated];
      state.settings.cosyVoiceProfileId = profileId;
      state.cosyVoiceUploadedProfileId = profileId;
      state.cosyVoiceActiveProfileId = profileId;
      renderCosyVoiceProfileOptions(profileId);
      status.textContent = `${file.name} · ${(result.bytes / 1024 / 1024).toFixed(1)} MB · đã lưu trên máy · bấm Lưu cài đặt`;
      state.settingsDirty = true;
      state.settingsRevision += 1;
      toast('Đã lưu WAV mẫu', false, 'Bấm Lưu cài đặt để lưu tên và bản chép của hồ sơ.');
    } catch (error) {
      status.textContent = 'Không lưu được WAV mẫu.';
      toast('Không lưu được giọng mẫu', true, error.message);
    }
  });
  $('#kokoro-en-speed').addEventListener('input', updateKokoroSpeedLabel);
  $('#supertonic-ko-speed')?.addEventListener('input', updateSupertonicKoreanSpeedLabel);
  $('#sbv2-speed').addEventListener('input', () => updateModelSpeedLabel('sbv2-speed', 'sbv2-speed-label'));
  $('#sbv2-vi-speed').addEventListener('input', () => updateModelSpeedLabel('sbv2-vi-speed', 'sbv2-vi-speed-label'));
  $('#cosyvoice-vi-speed').addEventListener('input', () => updateModelSpeedLabel('cosyvoice-vi-speed', 'cosyvoice-vi-speed-label'));
  $('#highlight-color').addEventListener('input', updateHighlightPreviewStyle);
  $('#highlight-padding').addEventListener('input', updateHighlightPreviewStyle);
  $('#highlight-radius').addEventListener('input', updateHighlightPreviewStyle);
  $('#highlight-transition').addEventListener('change', updateHighlightPreviewStyle);
  $('#background-effect-language').addEventListener('change', (event) => {
    storeCurrentBackgroundEffectProfile(state.backgroundEffectLanguage || 'en');
    if (event.currentTarget.value === MOT_PHUT_CONTENT) {
      state.backgroundEffectLanguage = MOT_PHUT_CONTENT;
      window.motPhutVoLe?.setSettingsProfile?.('background', true);
      return;
    }
    if (event.currentTarget.value === THINGS_YOU_DIDNT_KNOW_CONTENT) {
      state.backgroundEffectLanguage = THINGS_YOU_DIDNT_KNOW_CONTENT;
      window.motPhutVoLe?.setSettingsProfile?.('background', false);
      syncBackgroundEffectPreview();
      return;
    }
    window.motPhutVoLe?.setSettingsProfile?.('background', false);
    applyBackgroundEffectProfile(event.currentTarget.value);
    if (event.currentTarget.value === 'english-shadowing') applyVoiceHighlightContentProfile('english-shadowing');
    else if (state.voiceHighlightContentProfile === 'english-shadowing') applyVoiceHighlightContentProfile('standard');
  });
  $('#voice-highlight-content-profile').addEventListener('change', (event) => {
    applyVoiceHighlightContentProfile(event.currentTarget.value);
    if (event.currentTarget.value === THINGS_YOU_DIDNT_KNOW_CONTENT) return;
    if (event.currentTarget.value === 'english-shadowing') {
      storeCurrentBackgroundEffectProfile();
      applyBackgroundEffectProfile('english-shadowing');
    } else if (state.backgroundEffectLanguage === 'english-shadowing') {
      const selectedLanguage = ['en', 'zh', 'ja'].includes($('#content-language').value) ? $('#content-language').value : 'en';
      storeCurrentBackgroundEffectProfile();
      applyBackgroundEffectProfile(selectedLanguage);
    }
  });
  $('#background-effect').addEventListener('change', () => {
    storeCurrentBackgroundEffectProfile();
    syncBackgroundEffectPreview();
  });
  $('#background-effect-dialog-content').addEventListener('change', (event) => {
    if (!event.target.matches('[data-video-background-effect]') || !state.backgroundEffectEditor) return;
    state.backgroundEffectEditor.config.backgroundEffect = event.target.value;
    syncVideoBackgroundEffectPreview();
  });
  $('#background-effect-dialog-content').addEventListener('click', (event) => {
    if (event.target.closest('[data-close-background-effect]')) $('#background-effect-dialog').close();
    if (event.target.closest('[data-save-video-background-effect]')) saveVideoBackgroundEffect();
  });
  $('#background-effect-dialog').addEventListener('close', () => { state.backgroundEffectEditor = null; });
  const backgroundEffectPreview = $('#background-effect-preview-frame');
  backgroundEffectPreview.addEventListener('load', syncBackgroundEffectPreview);
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    const editorFrame = $('#video-background-effect-preview-frame');
    const isGlobalPreview = event.source === backgroundEffectPreview.contentWindow;
    const isVideoPreview = Boolean(editorFrame && event.source === editorFrame.contentWindow);
    if (!isGlobalPreview && !isVideoPreview) return;
    if (isGlobalPreview && window.motPhutVoLe?.isBackgroundEffectProfileActive?.()) {
      const moduleChanges = {
        'background-effect-preview:change-density': ['#mot-phut-setting-effect-density', '#mot-phut-setting-effect-density-label', 10, 60],
        'background-effect-preview:change-speed': ['#mot-phut-setting-effect-speed', '#mot-phut-setting-effect-speed-label', 25, 140],
        'background-effect-preview:change-opacity': ['#mot-phut-setting-effect-opacity', '#mot-phut-setting-effect-opacity-label', 10, 70]
      };
      const moduleChange = moduleChanges[event.data?.type];
      if (!moduleChange) return;
      const [inputSelector, outputSelector, min, max] = moduleChange;
      const key = event.data.type.endsWith('density') ? 'density' : event.data.type.endsWith('speed') ? 'speed' : 'opacity';
      const value = Number(event.data[key]);
      if (!Number.isInteger(value) || value < min || value > max) return;
      $(inputSelector).value = String(value);
      $(outputSelector).textContent = String(value);
      $(inputSelector).dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (isGlobalPreview && state.backgroundEffectLanguage === THINGS_YOU_DIDNT_KNOW_CONTENT) {
      window.thingsYouDidntKnow?.applyEffectPreviewChange?.(event.data);
      return;
    }
    const changes = {
      'background-effect-preview:change-density': ['backgroundEffectDensity', 10, 60],
      'background-effect-preview:change-speed': ['backgroundEffectSpeed', 25, 140],
      'background-effect-preview:change-opacity': ['backgroundEffectOpacity', 10, 70]
    };
    const change = changes[event.data?.type];
    if (!change) return;
    const [key, min, max] = change;
    const value = Number(event.data[key === 'backgroundEffectDensity' ? 'density' : key === 'backgroundEffectSpeed' ? 'speed' : 'opacity']);
    if (!Number.isInteger(value) || value < min || value > max) return;
    if (isVideoPreview && state.backgroundEffectEditor) {
      state.backgroundEffectEditor.config[key] = value;
      return;
    }
    if (state.backgroundEffectLanguage === 'english-shadowing') {
      const profile = normalizeBackgroundEffectProfileForUi(state.englishShadowingSettings?.backgroundEffectConfig || {}, { backgroundEffect: 'bubbles', backgroundEffectDensity: 28, backgroundEffectSpeed: 58, backgroundEffectOpacity: 32 });
      profile[key] = value;
      state.englishShadowingSettings = { ...(state.englishShadowingSettings || {}), backgroundEffectConfig: profile };
      state.englishShadowingSettingsDirty = true;
      state.englishShadowingSettingsRevision += 1;
    } else {
      const profile = state.backgroundEffectProfiles?.[state.backgroundEffectLanguage];
      if (profile) profile[key] = value;
    }
    if (state[key] === value) return;
    state[key] = value;
    if (state.backgroundEffectLanguage !== 'english-shadowing') {
      state.settingsDirty = true;
      state.settingsRevision += 1;
    }
  });
  syncBackgroundEffectPreview();
  $('#highlight-preview-language').addEventListener('change', (event) => {
    const input = $('#highlight-preview-source');
    const oldSample = HIGHLIGHT_PREVIEW_TEXT[event.target.value === 'vi' ? 'en' : 'vi'];
    if (input.value.trim() === oldSample) input.value = HIGHLIGHT_PREVIEW_TEXT[event.target.value];
  });
  $('#highlight-preview-play').addEventListener('click', previewHighlight);
  $('#clear-logs').addEventListener('click', async () => {
    if (!confirm('Xóa toàn bộ nhật ký hoạt động?')) return;
    const button = $('#clear-logs'); button.disabled = true;
    logsRevision += 1;
    try {
      const result = await api('/api/logs', { method: 'DELETE' });
      logsRevision += 1;
      state.logs = [];
      renderLogs();
      toast(`Đã xóa ${result.deleted} mục nhật ký.`);
    }
    catch (error) { toast('Không xóa được nhật ký', true, error.message); }
    finally { button.disabled = false; }
  });
  $('#save-settings').addEventListener('click', saveSettings);
  $('#view-settings').addEventListener('input', markSettingsDirty);
  $('#view-settings').addEventListener('change', markSettingsDirty);
  $('#save-facebook').addEventListener('click', saveFacebook);
  $('#test-facebook').addEventListener('click', testFacebook);
  $('#facebook-quick-route-language').addEventListener('change', async (event) => {
    const select = event.currentTarget;
    const previousLanguage = state.facebookSelectedLanguage || 'en';
    if (state.facebookPageCredentialDirty && !confirm('Thông tin Page chưa lưu. Bỏ các thay đổi này để chuyển ngôn ngữ?')) {
      select.value = previousLanguage;
      return;
    }
    state.facebookPageCredentialDirty = false;
    state.facebookPageLanguageDirty = true;
    state.facebookSelectedLanguage = select.value;
    if (select.value === THINGS_YOU_DIDNT_KNOW_CONTENT) {
      $('#page-id').value = '';
      $('#page-token').value = '';
      $('#standard-facebook-settings').hidden = true;
      window.thingsYouDidntKnow?.setFacebookProfileActive?.(true);
      $('#facebook-result').textContent = '';
      return;
    }
    $('#standard-facebook-settings').hidden = false;
    window.thingsYouDidntKnow?.setFacebookProfileActive?.(false);
    $('#page-id').value = '';
    $('#page-token').value = '';
    if (select.value === MOT_PHUT_CONTENT) {
      window.motPhutVoLe?.syncFacebookSettingsProfile?.();
      $('#facebook-result').textContent = '';
      return;
    }
    $('#facebook-result').textContent = `Đang chọn cấu hình Page ${select.value.toUpperCase()}; ID và token chỉ được lưu khi bấm Lưu thông tin.`;
    await refreshFacebookPageForm(select.value);
  });
  $('#add-topic').addEventListener('click', addTopic);
  $('#schedule-form').addEventListener('submit', createSchedule);
  $('#view-schedule').addEventListener('click', deletePublishedSchedule);
  $('#view-schedule').addEventListener('click', deleteMotPhutScheduledPost);
  window.addEventListener('mot-phut-videos-ready', (event) => {
    state.motPhutVideos = event.detail?.videos || [];
    state.motPhutSchedules = event.detail?.schedules || [];
    if (state.overview) renderOverview();
    if (state.view === 'schedule') renderSchedules();
  });
  window.addEventListener('mot-phut-open-schedule', async (event) => {
    setView('schedule');
    await loadSchedules();
    $('#schedule-video').value = event.detail?.videoId || '';
    $('#schedule-time').focus();
  });
  window.addEventListener('mot-phut-background-effect-change', syncBackgroundEffectPreview);
  $('#chatgpt-disconnect').addEventListener('click', async () => { try { const result = await api('/api/chatgpt/disconnect', { method: 'POST', body: '{}' }); toast('Đã xóa thông tin kết nối local', false, result.revocationConfirmed ? 'OpenAI xác nhận thu hồi phiên.' : 'Chưa xác nhận thu hồi phía OpenAI; bạn có thể ngắt ứng dụng trong ChatGPT Settings.'); await loadSettings(); } catch (error) { toast('Không ngắt được kết nối', true, error.message); } });
  $('#clear-facebook').addEventListener('click', async () => { try { const contentLanguage = $('#facebook-quick-route-language').value; await api('/api/facebook/clear-token', { method: 'POST', body: JSON.stringify({ contentLanguage }) }); toast('Đã xóa Page Access Token', false, `Chỉ token Page ${contentLanguage.toUpperCase()} được xóa.`); state.facebookPageCredentialDirty = false; await loadSettings(); } catch (error) { toast('Không xóa được token', true, error.message); } });
  $('#facebook-adapter').addEventListener('change', () => {
    if ($('#facebook-adapter').value === 'meta') toast('Đăng live vẫn đang tắt', false, 'Lưu Page ID và token, kiểm tra kết nối, rồi bật đăng thật khi bạn sẵn sàng.');
  });
}

async function start() {
  $('#today-date').textContent = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  setupEvents();
  connectRealtime();
  try {
    const topics = await api('/api/topics'); state.topics = topics.topics; renderTopics();
    await refreshData();
    const query = new URLSearchParams(location.search);
    if (query.get('view') && labels[query.get('view')]) setView(query.get('view'));
  } catch (error) { toast('Ứng dụng chưa tải được dữ liệu', true, error.message); }
  setInterval(() => { if (document.visibilityState === 'visible') refreshData(); }, 8000);
}

start();
