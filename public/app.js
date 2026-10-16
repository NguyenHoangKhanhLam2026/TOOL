const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const labels = { overview: 'Tổng quan', library: 'Thư viện video', schedule: 'Lịch đăng', settings: 'Kết nối & cài đặt', logs: 'Nhật ký hoạt động' };
const autoTopicLabel = 'AI t\u1ef1 ch\u1ecdn ch\u1ee7 \u0111\u1ec1';
const state = { view: 'overview', topics: [], videos: [], schedules: [], logs: [], jobs: [], filter: 'all', overview: null, settings: null, system: null, settingsDirty: false, settingsRevision: 0 };
let previewAudio = null;
const EN_US_VOICES = [
  { id: 'en-US-AvaNeural', name: 'Ava', gender: 'Nữ' },
  { id: 'en-US-AndrewNeural', name: 'Andrew', gender: 'Nam' },
  { id: 'en-US-EmmaNeural', name: 'Emma', gender: 'Nữ' },
  { id: 'en-US-BrianNeural', name: 'Brian', gender: 'Nam' },
  { id: 'en-US-AnaNeural', name: 'Ana', gender: 'Nữ' },
  { id: 'en-US-AndrewMultilingualNeural', name: 'AndrewMultilingual', gender: 'Nam' },
  { id: 'en-US-AriaNeural', name: 'Aria', gender: 'Nữ' },
  { id: 'en-US-AvaMultilingualNeural', name: 'AvaMultilingual', gender: 'Nữ' },
  { id: 'en-US-BrianMultilingualNeural', name: 'BrianMultilingual', gender: 'Nam' },
  { id: 'en-US-ChristopherNeural', name: 'Christopher', gender: 'Nam' },
  { id: 'en-US-EmmaMultilingualNeural', name: 'EmmaMultilingual', gender: 'Nữ' },
  { id: 'en-US-EricNeural', name: 'Eric', gender: 'Nam' },
  { id: 'en-US-GuyNeural', name: 'Guy', gender: 'Nam' },
  { id: 'en-US-JennyNeural', name: 'Jenny', gender: 'Nữ' },
  { id: 'en-US-MichelleNeural', name: 'Michelle', gender: 'Nữ' },
  { id: 'en-US-RogerNeural', name: 'Roger', gender: 'Nam' },
  { id: 'en-US-SteffanNeural', name: 'Steffan', gender: 'Nam' }
];
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
  if (view === 'settings') loadSettings();
  if (view === 'logs') loadLogs();
}

function statusName(status, video = null) {
  if (status === 'published' && String(video?.published_id || '').startsWith('mock_reel_')) return 'Đã mô phỏng';
  return ({ script_ready: 'Đang chờ render', processing: 'Đang tạo', ready: 'Sẵn sàng', scheduled: 'Đã lên lịch', publishing: 'Đang đăng', published: 'Đã xuất bản', failed: 'Tạo video lỗi', publish_failed: 'Đăng thất bại' })[status] || status || 'Chưa rõ';
}

function statusClass(status) {
  if (['ready', 'published'].includes(status)) return 'ok';
  if (['scheduled', 'processing', 'script_ready', 'publishing'].includes(status)) return 'warn';
  if (['failed', 'publish_failed'].includes(status)) return 'error';
  return 'neutral';
}

function pipelineErrorMessage(video) {
  const error = String(video.pipeline?.error || video.last_error || 'Có lỗi trong quá trình tạo video.');
  if (error.includes('NoAudioReceived')) return 'Edge TTS không trả âm thanh. Thử lại hoặc đổi giọng đọc.';
  return error.split(/\r?\n/).find(Boolean)?.slice(0, 220) || 'Có lỗi trong quá trình tạo video.';
}

function videoProgressMarkup(video) {
  if (!video.pipeline?.steps) return '';
  const steps = video.pipeline.steps.map((step) => `<div class="pipeline-step ${step.status}" title="${escapeHtml(step.label)}: ${step.status === 'done' ? 'Đã hoàn tất' : step.status === 'error' ? 'Bị lỗi' : step.status === 'active' ? 'Đang thực hiện' : 'Đang chờ'}"><span class="pipeline-light"></span><span>${escapeHtml(step.label)}</span></div>`).join('');
  const error = video.pipeline.error ? `<p class="pipeline-error">${escapeHtml(pipelineErrorMessage(video))}</p>` : '';
  return `<div class="video-pipeline" aria-label="Tiến trình tạo video">${steps}</div>${error}`;
}
function videoCard(video, compact = false) {
  const thumb = video.thumbnail_path ? `<img src="/api/videos/${encodeURIComponent(video.id)}/thumbnail" alt="Thumbnail ${escapeHtml(video.topic)}" loading="lazy" />` : `<span class="video-placeholder">${escapeHtml(video.topic || 'Video mới')}<small>${video.status === 'processing' ? 'Đang tạo các đoạn đọc và render…' : video.last_error ? escapeHtml(video.last_error) : 'Chưa có bản render'}</small></span>`;
  const cardClass = compact ? 'video-card' : 'library-row';
  const actions = [
    `<button class="mini-action" data-script-id="${escapeHtml(video.script_id)}">Kịch bản</button>`,
    video.status === 'ready' ? `<button class="mini-action" data-schedule-id="${escapeHtml(video.id)}">Lên lịch</button>` : '',
    ['ready', 'scheduled'].includes(video.status) ? `<button class="mini-action" data-publish-id="${escapeHtml(video.id)}">Đăng ngay</button>` : '',
    video.video_path ? `<a class="mini-action" href="/api/videos/${encodeURIComponent(video.id)}/file" download>MP4 ↓</a>` : '',
    !compact ? `<button class="mini-action danger-action" data-delete-video-id="${escapeHtml(video.id)}" ${['processing', 'script_ready', 'publishing'].includes(video.status) ? 'disabled title="Không thể xóa khi video đang được tạo hoặc đăng"' : ''}>Xóa</button>` : ''
  ].filter(Boolean).join('');
  const caption = escapeHtml(video.captionText || video.caption || '');
  const category = video.category || video.provider || 'Video học tiếng Anh';
  if (compact) return `<article class="${cardClass}"><a class="video-thumb" href="${video.video_path ? `/api/videos/${encodeURIComponent(video.id)}/file` : '#'}" ${video.video_path ? 'target="_blank"' : ''}>${thumb}<span class="video-badge">${escapeHtml(statusName(video.status, video))}</span></a><div class="video-info"><h3>${escapeHtml(video.topic || video.title)}</h3><p>${caption}</p><div class="video-meta"><span class="video-category">${escapeHtml(category)}</span><div class="video-actions">${actions}</div></div></div></article>`;
  return `<article class="${cardClass}"><div class="video-thumb">${thumb}<span class="video-badge">${escapeHtml(statusName(video.status, video))}</span></div><div class="library-main"><h3>${escapeHtml(video.title || video.topic)}</h3><p class="library-caption">${caption}</p><div class="row-meta"><span>${escapeHtml(video.category || 'Chưa phân nhóm')}</span><span>•</span><span>${dateText(video.created_at, { dateStyle: 'medium' })}</span><span>•</span><span>${escapeHtml(video.provider || 'AI')}</span>${video.duration_seconds ? `<span>•</span><span>${Number(video.duration_seconds).toFixed(1)} giây</span>` : ''}</div>${video.last_error && !video.pipeline?.error ? `<p class="inline-status">${escapeHtml(video.last_error)}</p>` : ''}${videoProgressMarkup(video)}</div><span class="state-pill ${statusClass(video.status)}">${escapeHtml(statusName(video.status, video))}</span><div class="row-actions">${actions}</div></article>`;
}

function renderOverview() {
  const data = state.overview;
  if (!data) return;
  $('#metric-videos').textContent = data.counts.videos;
  $('#metric-ready').textContent = data.counts.ready;
  $('#metric-scheduled').textContent = data.counts.scheduled;
  $('#metric-published').textContent = data.counts.published;
  $('#library-count').textContent = data.counts.videos;
  $('#worker-label').textContent = data.system.worker ? 'Worker đang hoạt động' : 'Worker đang tắt';
  $('#worker-pill').classList.toggle('offline', !data.system.worker);
  $('#worker-note').hidden = data.system.worker;
  const history = data.contentHistory || { count: 0, bytes: 0 };
  const historyBytes = Number(history.bytes) || 0;
  const historySize = historyBytes >= 1024 * 1024 ? `${(historyBytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(historyBytes / 1024)} KB`;
  const historyWarning = historyBytes >= 100 * 1024 * 1024 ? ' C\u1ea3nh b\u00e1o: l\u1ecbch s\u1eed \u0111\u00e3 v\u01b0\u1ee3t 100 MB.' : '';
  $('#content-history-note').textContent = `\u0110\u1ec3 tr\u1ed1ng ch\u1ee7 \u0111\u1ec1, AI t\u1ef1 ch\u1ecdn. \u0110ang gi\u1eef ${history.count} k\u1ecbch b\u1ea3n ch\u1ed1ng tr\u00f9ng (${historySize} v\u0103n b\u1ea3n); x\u00f3a MP4 kh\u00f4ng x\u00f3a l\u1ecbch s\u1eed.${historyWarning}`;
  const ready = (ok) => `<span class="status-indicator ${ok ? 'ok' : ''}"></span>`;
  const ttsKey = data.settings.ttsProvider === 'vieneu' ? 'vieneuTts' : 'edgeTts';
  const ttsError = data.system.tools.errors?.[ttsKey];
  const ffmpegError = data.system.tools.errors?.ffmpeg;
  const ttsStatus = ttsError ? `Không khởi chạy được (${ttsError})` : (data.settings.ttsProvider === 'vieneu' ? (data.system.tools.vieneuTts ? 'VieNeu local sẵn sàng' : 'Chưa cài VieNeu') : (data.system.tools.edgeTts ? 'Microsoft Edge TTS sẵn sàng' : 'Thiếu edge-tts'));
  const ffmpegStatus = ffmpegError ? `FFmpeg không khởi chạy được (${ffmpegError})` : (data.system.tools.ffmpeg ? 'FFmpeg' : 'Thiếu FFmpeg');
  const rows = [
    ['SQLite', data.system.database, data.system.database ? 'Đang lưu dữ liệu local' : 'Chưa khởi tạo database'],
    ['Worker nền', data.system.worker, data.system.worker ? 'Đang lấy job từ hàng đợi' : 'Chạy npm run worker'],
    ['AI viết nội dung', data.system.aiReady, data.providers.chatgptPlan.connected ? 'ChatGPT plan đã kết nối' : 'Kết nối ChatGPT Plan để tạo nội dung'],
    ['Media engine', data.system.tools.ffmpeg && data.system.tools.ffprobe && data.system.tools[ttsKey], `${ttsStatus} · ${ffmpegStatus}`],
    ['Facebook', data.system.liveFacebookReady, data.settings.facebookAdapter === 'mock' ? 'Đang ở chế độ thử nghiệm Mock' : (data.system.liveFacebookReady ? `Page ${data.settings.pageId} đã kiểm tra` : 'Chưa kiểm tra Page và token')]
  ];
  $('#status-grid').innerHTML = rows.map(([name, ok, detail]) => `<div class="status-card">${ready(ok)}<div class="status-copy"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></div></div>`).join('');
  const videos = data.videos || [];
  $('#recent-videos').innerHTML = videos.length ? videos.slice(0, 3).map((video) => videoCard(video, true)).join('') : `<div class="empty-state" style="grid-column:1/-1"><strong>Thư viện đang chờ video đầu tiên</strong>Khi AI, Edge TTS và FFmpeg sẵn sàng, tạo video từ chủ đề phía trên.</div>`;
  state.system = data.system;
  state.settings = data.settings;
  renderToolChecks(data.system.tools);
  $$('.mini-action,[data-publish-id],[data-schedule-id]').forEach((button) => button.addEventListener('click', handleVideoAction));
}

function renderToolChecks(tools = {}) {
  const labels = { python: 'Python', edgeTts: 'Microsoft Edge TTS', vieneuTts: 'VieNeu local', kokoroTts: 'Kokoro local', ffmpeg: 'FFmpeg', ffprobe: 'FFprobe' };
  $('#tool-checks').innerHTML = Object.entries(labels).map(([key, name]) => {
    const supported = !['vieneuTts', 'kokoroTts'].includes(key) || Object.hasOwn(tools, key);
    const error = tools.errors?.[key];
    const status = !supported ? 'cần khởi động lại app' : tools[key] ? 'sẵn sàng' : error ? `không khởi chạy được (${error})` : 'chưa có';
    return `<span class="tool-chip"><span class="status-indicator ${supported && tools[key] ? 'ok' : ''}"></span>${name} ${status}</span>`;
  }).join('');
}

function renderTopics() {
  const select = $('#topic-select');
  const groups = new Map();
  for (const topic of state.topics) {
    if (!groups.has(topic.category)) groups.set(topic.category, []);
    groups.get(topic.category).push(topic);
  }
  select.innerHTML = `<option value="">${autoTopicLabel}</option>` + [...groups].map(([category, topics]) => `<optgroup label="${escapeHtml(category)}">${topics.map((topic) => `<option value="${escapeHtml(topic.id)}">${escapeHtml(topic.title)}${topic.used_at && Date.now() - new Date(topic.used_at).getTime() < 14 * 86400000 ? ' · vừa dùng' : ''}</option>`).join('')}</optgroup>`).join('');
}

function renderLibrary() {
  const all = state.videos;
  const matches = state.filter === 'failed' ? all.filter((v) => ['failed', 'publish_failed'].includes(v.status)) : state.filter === 'all' ? all : all.filter((v) => v.status === state.filter);
  $('#video-count').textContent = `${matches.length} VIDEO`;
  $('#library-list').innerHTML = matches.length ? matches.map((video) => videoCard(video)).join('') : `<div class="empty-state"><strong>Chưa có video trong mục này</strong>${state.filter === 'all' ? 'Tạo video đầu tiên từ bảng Tổng quan.' : 'Video sẽ xuất hiện tại đây sau khi trạng thái thay đổi.'}</div>`;
  $$('.library-row [data-script-id],.library-row [data-schedule-id],.library-row [data-publish-id],.library-row [data-delete-video-id]').forEach((button) => button.addEventListener('click', handleVideoAction));
}

function renderSchedules() {
  const schedules = state.schedules;
  const available = state.videos.filter((v) => v.status === 'ready');
  $('#schedule-video').innerHTML = `<option value="">Chọn video</option>${available.map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(v.topic)}</option>`).join('')}`;
  const visible = schedules.filter((item) => item.status !== 'published');
  $('#schedule-list').innerHTML = visible.length ? visible.map((item) => {
    const failed = item.status === 'failed';
    const stateLabel = failed ? 'Đăng thất bại' : item.status === 'publishing' ? 'Đang đăng' : 'Đã lên lịch';
    const error = failed && item.error ? `<small class="schedule-error">${escapeHtml(item.error)}</small>` : '';
    return `<article class="schedule-row${failed ? ' failed' : ''}"><span class="schedule-date">${dateText(item.scheduled_at, { month: 'short', day: 'numeric' })}</span><div class="schedule-copy"><strong>${escapeHtml(item.topic)}</strong><small>${escapeHtml(item.title)} · ${stateLabel}</small>${error}</div><span class="schedule-time">${dateText(item.scheduled_at, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span></article>`;
  }).join('') : `<div class="empty-state"><strong>Chưa có lịch đăng</strong>Bật “Tự đăng theo lịch” trong cài đặt để xếp video sẵn sàng tự động.</div>`;
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
  $('#library-count').textContent = state.videos.length;
}

async function loadSchedules() {
  const [scheduleData, videoData] = await Promise.all([api('/api/schedules'), api('/api/videos')]);
  state.schedules = scheduleData.schedules;
  state.videos = videoData.videos;
  renderSchedules();
}

async function loadLogs() { state.logs = (await api('/api/logs')).logs; renderLogs(); }

function selectSavedVoice(select, voice) {
  const value = String(voice || '');
  if (value && ![...select.options].some((option) => option.value === value)) {
    select.add(new Option(`${value} (giọng đã lưu)`, value));
  }
  if (value) select.value = value;
}

function renderEnglishVoices() {
  const selectedId = $('#en-voice').value || 'en-US-JennyNeural';
  const selection = $('#en-voice-selection');
  const list = $('#en-voice-list');
  const voices = EN_US_VOICES.some((voice) => voice.id === selectedId)
    ? EN_US_VOICES
    : [{ id: selectedId, name: selectedId, gender: 'đã lưu' }, ...EN_US_VOICES];
  selection.textContent = `Đang chọn ${selectedId}`;
  list.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const voice of voices) {
    const item = document.createElement('div');
    item.className = 'english-voice-item';
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = `english-voice-choice${voice.id === selectedId ? ' is-selected' : ''}`;
    choose.dataset.selectEnglishVoice = voice.id;
    choose.setAttribute('aria-pressed', String(voice.id === selectedId));
    choose.textContent = `${voice.name} · ${voice.gender}`;
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'english-voice-preview';
    preview.dataset.previewEnglishVoice = voice.id;
    preview.setAttribute('aria-label', `Nghe thử ${voice.name}, giọng ${voice.gender.toLowerCase()}`);
    preview.title = `Nghe thử ${voice.name}`;
    preview.textContent = '▶';
    item.append(choose, preview);
    fragment.append(item);
  }
  list.append(fragment);
}

function syncEnglishRateControls(rate) {
  const input = $('#en-rate');
  if (rate !== undefined) input.value = rate;
  const match = String(input.value).match(/^([+-])(\d{1,3})%$/);
  if (!match) return;
  const slider = $('#en-rate-slider');
  slider.value = Math.max(Number(slider.min), Math.min(Number(slider.max), 100 + (match[1] === '-' ? -1 : 1) * Number(match[2])));
  $('#en-rate-label').textContent = `${(Number(slider.value) / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
}

function setEnglishRateFromSlider() {
  const speed = Number($('#en-rate-slider').value);
  const percent = speed - 100;
  $('#en-rate').value = `${percent > 0 ? '+' : ''}${percent}%`;
  $('#en-rate-label').textContent = `${(speed / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
}

function updateTtsProviderPanels() {
  const vieneuSelected = $('#tts-provider').value === 'vieneu';
  $('#edge-tts-settings').hidden = vieneuSelected;
  $('#vieneu-tts-settings').hidden = !vieneuSelected;
}

function updateVieNeuSpeedLabel(language) {
  const value = Number($(`#vieneu-${language}-speed`).value) || 1;
  $(`#vieneu-${language}-speed-label`).textContent = `${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
}

function updateKokoroSpeedLabel() {
  const value = Number($('#kokoro-en-speed').value) || 1;
  $('#kokoro-en-speed-label').textContent = `${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
}

function markSettingsDirty(event) {
  const target = event.target;
  if (!target?.matches('input, select, textarea') || target.disabled) return;
  state.settingsDirty = true;
  state.settingsRevision += 1;
}

async function loadSettings() {
  const [settings, system] = await Promise.all([api('/api/settings'), api('/api/system')]);
  state.settings = settings; state.system = system;
  // The eight-second live refresh also calls this function. Keep in-progress
  // edits in the DOM until the user saves them; the server response is only a
  // baseline and must not overwrite a selection or text field mid-edit.
  if (state.settingsDirty) return;
  $('#tts-provider').value = settings.ttsProvider || 'edge';
  updateTtsProviderPanels();
  selectSavedVoice($('#vi-voice'), settings.viVoice);
  $('#en-voice').value = settings.enVoice || 'en-US-JennyNeural';
  selectSavedVoice($('#vieneu-vi-voice'), settings.vieneuViVoice || 'Hải Đăng');
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
  $('#kokoro-en-speed').value = settings.kokoroEnSpeed ?? 1;
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
  renderEnglishVoices();
  syncEnglishRateControls(settings.enRate);
  $('#highlight-enabled').checked = settings.highlightEnabled !== false;
  $('#highlight-mode').value = settings.highlightMode || 'word';
  $('#highlight-color').value = settings.highlightColor || '#FF8066';
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
  $('#page-id').value = settings.pageId || '';
  $('#page-token').value = '';
  $('#clear-facebook').hidden = !settings.facebookTokenSaved;
  $('#facebook-status-pill').textContent = settings.facebookAdapter === 'mock' ? 'Mock' : (settings.facebookConnectionVerified ? 'Đã kiểm tra' : 'Chưa xác minh');
  $('#facebook-status-pill').className = `state-pill ${settings.facebookConnectionVerified ? 'ok' : settings.facebookAdapter === 'mock' ? 'neutral' : 'warn'}`;
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
    const result = await api('/api/generate', { method: 'POST', body: JSON.stringify({ topicId: $('#topic-select').value || null, allowLocalTemplate: $('#local-template').checked }) });
    jobQueued = true;
    toast('Đã thêm video vào hàng đợi', false, 'Worker sẽ xử lý kịch bản, giọng đọc và render.');
    watchJob(result.jobId);
    setView('overview');
  } catch (error) { toast('Không tạo được job', true, error.message); }
  finally { if (!jobQueued) setGenerateButtonBusy(false); }
}

let watchedJobs = new Set();
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
        clearInterval(timer); watchedJobs.delete(jobId);
        toast('Job gặp lỗi', true, job.last_error || 'Mở Nhật ký hoạt động để xem chi tiết.');
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
    const live = state.settings?.facebookAdapter === 'meta';
    const confirmLive = live && window.confirm('Bạn sắp đăng video thật lên Facebook Page đã kết nối. Tiếp tục?');
    if (live && !confirmLive) return;
    button.disabled = true;
    try {
      const result = await api(`/api/videos/${encodeURIComponent(button.dataset.publishId)}/publish`, { method: 'POST', body: JSON.stringify({ confirmLive }) });
      toast('Đã thêm yêu cầu đăng vào hàng đợi', false, live ? 'Đăng thật lên Facebook đang được xử lý.' : 'Đang dùng adapter Mock, không có bài viết thật được tạo.');
      watchJob(result.jobId);
    } catch (error) { toast('Không đăng được video', true, error.message); }
    finally { button.disabled = false; }
  }
}

async function saveSettings() {
  const button = $('#save-settings'); button.disabled = true;
  const revisionAtSave = state.settingsRevision;
  const payload = {
    ttsProvider: $('#tts-provider').value,
    viVoice: $('#vi-voice').value.trim(), enVoice: $('#en-voice').value.trim(), enRate: $('#en-rate').value.trim(),
    vieneuViVoice: $('#vieneu-vi-voice').value, kokoroEnVoice: $('#kokoro-en-voice').value,
    vieneuViSpeed: Number($('#vieneu-vi-speed').value),
    kokoroEnSpeed: Number($('#kokoro-en-speed').value),
    localTtsMinFreeRamMb: Number($('#local-tts-min-free-ram').value),
    localTtsMinRemainingRamMb: Number($('#local-tts-min-remaining-ram').value),
    highlightEnabled: $('#highlight-enabled').checked,
    highlightMode: $('#highlight-mode').value,
    highlightColor: $('#highlight-color').value,
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
    if (result.ttsProvider !== payload.ttsProvider) {
      throw new Error('Server không xác nhận nhà cung cấp giọng đọc đã chọn. App có thể đang chạy phiên bản cũ; hãy khởi động lại app rồi lưu lại.');
    }
    state.settings = result;
    const editedWhileSaving = state.settingsRevision !== revisionAtSave;
    state.settingsDirty = editedWhileSaving;
    toast(editedWhileSaving ? 'Đã lưu bản cài đặt trước đó' : 'Đã lưu cài đặt', false, editedWhileSaving ? 'Bạn vừa thay đổi thêm cài đặt; hãy lưu lần nữa để lưu các thay đổi mới.' : '');
    await loadOverview();
    if (!editedWhileSaving) await loadSettings();
  } catch (error) { toast('Không lưu được cài đặt', true, error.message); }
  finally { button.disabled = false; }
}

async function saveFacebook() {
  const button = $('#save-facebook'); button.disabled = true;
  try {
    const pageId = $('#page-id').value.trim();
    const pageToken = $('#page-token').value.trim();
    const data = await api('/api/facebook/credentials', { method: 'POST', body: JSON.stringify({ pageId, pageToken }) });
    $('#page-token').value = '';
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ facebookAdapter: $('#facebook-adapter').value }) });
    toast('Đã lưu thông tin Facebook', false, data.tokenSaved ? 'Token được lưu cục bộ và ẩn khỏi giao diện.' : 'Đã lưu Page ID; bạn có thể thêm token sau.');
    await loadSettings(); await loadOverview();
  } catch (error) { toast('Không lưu được Facebook', true, error.message); }
  finally { button.disabled = false; }
}

async function testFacebook() {
  const resultEl = $('#facebook-result'); resultEl.textContent = 'Đang kiểm tra…';
  try {
    const result = await api('/api/facebook/test', { method: 'POST', body: '{}' });
    resultEl.textContent = `Kết nối thành công · ${result.pageName}`;
    toast('Kết nối Facebook thành công', false, result.pageName);
    await loadSettings(); await loadOverview();
  } catch (error) { resultEl.textContent = error.message; toast('Kiểm tra Facebook thất bại', true, error.message); }
}

async function previewVoice(language, chosenVoice = '', button = null) {
  const text = language === 'vi' ? 'Xin chào, bạn có thể giúp mình được không?' : 'Could you help me with this?';
  const provider = $('#tts-provider').value;
  const voice = chosenVoice || (provider === 'vieneu'
    ? (language === 'vi' ? $('#vieneu-vi-voice').value : $('#kokoro-en-voice').value)
    : (language === 'vi' ? $('#vi-voice').value : $('#en-voice').value));
  const payload = { language, text, voice, ttsProvider: provider };
  if (provider === 'vieneu') payload.speed = Number(language === 'vi' ? $('#vieneu-vi-speed').value : $('#kokoro-en-speed').value);
  else payload.rate = language === 'vi' ? '+0%' : $('#en-rate').value.trim();
  if (button) button.disabled = true;
  try {
    const result = await api('/api/tts/preview', { method: 'POST', body: JSON.stringify(payload) });
    if (previewAudio) { previewAudio.pause(); previewAudio.currentTime = 0; }
    previewAudio = new Audio(new URL(result.url, window.location.href).href);
    await previewAudio.play();
    toast(`Đang phát giọng ${language === 'vi' ? 'tiếng Việt' : 'tiếng Anh'}`, false, result.voice);
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
    const provider = $('#tts-provider').value;
    const voice = provider === 'vieneu'
      ? (language === 'vi' ? $('#vieneu-vi-voice').value : $('#kokoro-en-voice').value)
      : (language === 'vi' ? $('#vi-voice').value : $('#en-voice').value);
    const previewSettings = provider === 'vieneu'
      ? { speed: Number(language === 'vi' ? $('#vieneu-vi-speed').value : $('#kokoro-en-speed').value) }
      : { rate: language === 'vi' ? '+0%' : $('#en-rate').value.trim() };
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
    const result = await api(`/api/videos/${encodeURIComponent($('#schedule-video').value)}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt: $('#schedule-time').value }) });
    toast('Đã lưu lịch đăng', false, dateText(result.scheduledAt));
    $('#schedule-form').reset(); await loadSchedules(); await loadOverview();
  } catch (error) { toast('Không lưu được lịch', true, error.message); }
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
  $('#en-rate-slider').addEventListener('input', setEnglishRateFromSlider);
  $('#en-rate').addEventListener('input', () => syncEnglishRateControls());
  $('#tts-provider').addEventListener('change', updateTtsProviderPanels);
  $('#vieneu-vi-speed').addEventListener('input', () => updateVieNeuSpeedLabel('vi'));
  $('#preview-vieneu-vi').addEventListener('click', (event) => previewVoice('vi', '', event.currentTarget));
  $('#preview-vieneu-en').addEventListener('click', (event) => previewVoice('en', '', event.currentTarget));
  $('#kokoro-en-speed').addEventListener('input', updateKokoroSpeedLabel);
  $('#highlight-color').addEventListener('input', updateHighlightPreviewStyle);
  $('#highlight-padding').addEventListener('input', updateHighlightPreviewStyle);
  $('#highlight-radius').addEventListener('input', updateHighlightPreviewStyle);
  $('#highlight-transition').addEventListener('change', updateHighlightPreviewStyle);
  $('#highlight-preview-language').addEventListener('change', (event) => {
    const input = $('#highlight-preview-source');
    const oldSample = HIGHLIGHT_PREVIEW_TEXT[event.target.value === 'vi' ? 'en' : 'vi'];
    if (input.value.trim() === oldSample) input.value = HIGHLIGHT_PREVIEW_TEXT[event.target.value];
  });
  $('#highlight-preview-play').addEventListener('click', previewHighlight);
  $('#clear-logs').addEventListener('click', async () => {
    if (!confirm('Xóa toàn bộ nhật ký hoạt động?')) return;
    const button = $('#clear-logs'); button.disabled = true;
    try { const result = await api('/api/logs', { method: 'DELETE' }); state.logs = []; renderLogs(); toast(`Đã xóa ${result.deleted} mục nhật ký.`); }
    catch (error) { toast('Không xóa được nhật ký', true, error.message); }
    finally { button.disabled = false; }
  });
  $('#save-settings').addEventListener('click', saveSettings);
  $('#view-settings').addEventListener('input', markSettingsDirty);
  $('#view-settings').addEventListener('change', markSettingsDirty);
  $('#save-facebook').addEventListener('click', saveFacebook);
  $('#test-facebook').addEventListener('click', testFacebook);
  $('#preview-vi').addEventListener('click', (event) => previewVoice('vi', '', event.currentTarget));
  $('#en-voice-list').addEventListener('click', (event) => {
    const preview = event.target.closest('[data-preview-english-voice]');
    if (preview) { previewVoice('en', preview.dataset.previewEnglishVoice, preview); return; }
    const choose = event.target.closest('[data-select-english-voice]');
    if (choose) {
      $('#en-voice').value = choose.dataset.selectEnglishVoice;
      state.settingsDirty = true;
      state.settingsRevision += 1;
      renderEnglishVoices();
    }
  });
  $('#add-topic').addEventListener('click', addTopic);
  $('#schedule-form').addEventListener('submit', createSchedule);
  $('#chatgpt-disconnect').addEventListener('click', async () => { try { const result = await api('/api/chatgpt/disconnect', { method: 'POST', body: '{}' }); toast('Đã xóa thông tin kết nối local', false, result.revocationConfirmed ? 'OpenAI xác nhận thu hồi phiên.' : 'Chưa xác nhận thu hồi phía OpenAI; bạn có thể ngắt ứng dụng trong ChatGPT Settings.'); await loadSettings(); } catch (error) { toast('Không ngắt được kết nối', true, error.message); } });
  $('#clear-facebook').addEventListener('click', async () => { try { await api('/api/facebook/clear-token', { method: 'POST', body: '{}' }); toast('Đã xóa Page Access Token'); await loadSettings(); } catch (error) { toast('Không xóa được token', true, error.message); } });
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
