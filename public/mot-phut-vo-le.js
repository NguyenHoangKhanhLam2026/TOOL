const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const API = '/api/mot-phut-vo-le';
const MODE_KEY = 'mot-phut-vo-le-content-mode';
const moduleState = { status: null, settings: null, design: null, settingsDirty: false, settingsRevision: 0, pageDirty: false, pageRevision: 0, pageSavedId: '', page: null, schedules: [], videos: [], progressJobs: [], pollTimer: null, jobs: new Set(), loading: null, highlightPreviewAudio: null, highlightPreviewFrame: null };
const moduleSettingsProfiles = { voice: false, background: false, highlight: false };

async function api(route, options = {}) {
  const response = await fetch(`${API}${route}`, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers }
  });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data?.error || `Máy chủ trả mã ${response.status}.`);
  return data;
}

function setStatus(message, error = false, target = '#mot-phut-settings-status') {
  const node = $(target);
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('error', error);
}

function moduleModeActive() {
  return $('#content-language')?.value === 'mot-phut-vo-le';
}

function syncModuleMode(event) {
  const active = event?.detail?.active ?? moduleModeActive();
  const voiceActive = moduleSettingsProfiles.voice;
  const backgroundActive = moduleSettingsProfiles.background;
  const highlightActive = moduleSettingsProfiles.highlight;
  const createFields = $('#mot-phut-create-fields');
  if (createFields) createFields.hidden = !active;
  const topicWrap = $('#topic-select-wrap');
  if (topicWrap) topicWrap.hidden = active;
  const addTopic = $('#add-topic');
  if (addTopic) addTopic.hidden = active;
  const settingsPanel = $('#mot-phut-inline-settings');
  if (settingsPanel) settingsPanel.hidden = !voiceActive;
  const backgroundSettings = $('#mot-phut-background-settings');
  if (backgroundSettings) backgroundSettings.hidden = true;
  const backgroundStandard = $('#background-effect-standard-controls');
  if (backgroundStandard) backgroundStandard.hidden = false;
  const standardBackgroundEffect = $('#standard-background-effect-control');
  if (standardBackgroundEffect) standardBackgroundEffect.hidden = backgroundActive;
  const moduleBackgroundEffect = $('#mot-phut-background-effect-control');
  if (moduleBackgroundEffect) moduleBackgroundEffect.hidden = !backgroundActive;
  const moduleHighlight = $('#mot-phut-inline-highlight');
  if (moduleHighlight) moduleHighlight.hidden = !highlightActive;
  const highlightSelector = $('#voice-highlight-content-selector');
  if (highlightSelector) highlightSelector.hidden = false;
  for (const selector of ['#standard-highlight-controls', '#japanese-highlight-controls', '#english-shadowing-highlight-controls']) {
    const controls = $(selector);
    if (controls) controls.hidden = highlightActive;
  }
  if (active) localStorage.setItem(MODE_KEY, 'true');
  syncScheduleSettingsProfile();
  window.dispatchEvent(new CustomEvent('mot-phut-module-visibility', { detail: { active, voiceActive, backgroundActive, highlightActive } }));
}

function updateMotPhutScheduleStatus() {
  const node = $('#mot-phut-auto-state');
  if (!node) return;
  const enabled = $('#mot-phut-auto-generation')?.checked === true
    || $('#mot-phut-auto-schedule')?.checked === true
    || $('#mot-phut-auto-publish')?.checked === true;
  node.textContent = enabled ? 'Đang bật' : 'Đang tắt';
  node.className = `state-pill ${enabled ? 'ok' : 'neutral'}`;
}

function syncScheduleSettingsProfile() {
  const moduleActive = $('#schedule-content-profile')?.value === 'mot-phut-vo-le';
  const standard = $('#standard-schedule-settings');
  const module = $('#mot-phut-schedule-settings');
  const standardState = $('#auto-state');
  const moduleStatePill = $('#mot-phut-auto-state');
  if (standard) standard.hidden = moduleActive;
  if (module) module.hidden = !moduleActive;
  if (standardState) standardState.hidden = moduleActive;
  if (moduleStatePill) moduleStatePill.hidden = !moduleActive;
  updateMotPhutScheduleStatus();
}

function syncFacebookSettingsProfile() {
  const moduleActive = $('#facebook-quick-route-language')?.value === 'mot-phut-vo-le';
  const standard = $('#standard-facebook-settings');
  const module = $('#mot-phut-facebook-page-settings');
  const standardStatus = $('#facebook-status-pill');
  const standardAdapter = $('#facebook-adapter-control');
  if (standard) standard.hidden = moduleActive;
  if (module) module.hidden = !moduleActive;
  if (standardStatus) standardStatus.hidden = moduleActive;
  if (standardAdapter) standardAdapter.hidden = moduleActive;
}

function setSettingsProfile(section, active) {
  if (!Object.hasOwn(moduleSettingsProfiles, section)) return false;
  moduleSettingsProfiles[section] = active === true;
  syncModuleMode();
  if (section === 'background') {
    if (active && moduleState.settings) $('#mot-phut-setting-background-effect').value = moduleState.settings.backgroundEffect || 'bubbles';
    window.dispatchEvent(new CustomEvent('mot-phut-background-effect-change'));
  }
  return true;
}

function fillSettings(settings) {
  const visualPreset = moduleState.design?.preset || settings.visualPreset || 'vintage-paper';
  moduleState.settings = { ...settings, visualPreset };
  $('#mot-phut-setting-speed').value = settings.speed ?? 1;
  $('#mot-phut-setting-speed-label').textContent = `${Number(settings.speed ?? 1).toFixed(2)}×`;
  $('#mot-phut-setting-highlight').value = settings.highlightMode || 'syllable';
  $('#mot-phut-setting-highlight-enabled').checked = settings.highlightEnabled !== false;
  $('#mot-phut-setting-highlight-color').value = settings.highlightColor || '#FF8066';
  $('#mot-phut-setting-highlight-padding').value = settings.highlightPadding ?? 6;
  $('#mot-phut-setting-highlight-radius').value = settings.highlightRadius ?? 8;
  $('#mot-phut-setting-highlight-transition').value = 'instant';
  renderMotPhutHighlightPreviewText($('#mot-phut-highlight-preview-source').value);
  updateMotPhutHighlightPreviewStyle();
  $('#mot-phut-setting-background-effect').value = settings.backgroundEffect || 'bubbles';
  for (const [setting, output, label] of [
    ['backgroundEffectDensity', '#mot-phut-setting-effect-density', '#mot-phut-setting-effect-density-label'],
    ['backgroundEffectSpeed', '#mot-phut-setting-effect-speed', '#mot-phut-setting-effect-speed-label'],
    ['backgroundEffectOpacity', '#mot-phut-setting-effect-opacity', '#mot-phut-setting-effect-opacity-label']
  ]) { $(output).value = settings[setting] ?? 28; $(label).textContent = String(settings[setting] ?? 28); }
  $('#mot-phut-posts-per-day').value = settings.postsPerDay ?? 3;
  $('#mot-phut-prepare-days').value = settings.prepareAheadDays ?? 7;
  $('#mot-phut-max-scripts').value = settings.maxScriptsPerDay ?? 10;
  $('#mot-phut-auto-generation').checked = settings.autoGenerationEnabled === true;
  $('#mot-phut-auto-schedule').checked = settings.autoScheduleEnabled === true;
  $('#mot-phut-auto-publish').checked = settings.autoPublishEnabled === true;
  if (!moduleState.pageDirty) {
    $('#mot-phut-facebook-page-id').value = settings.facebookPageId || '';
    moduleState.pageSavedId = settings.facebookPageId || '';
    moduleState.page = moduleState.status?.facebookPage || null;
    updateMotPhutPageStatus(moduleState.page);
  }
  updateMotPhutScheduleStatus();
  const effectsSelect = $('#mot-phut-setting-background-effect');
  if (Array.isArray(moduleState.status?.backgroundEffects) && effectsSelect.dataset.loaded !== 'true') {
    effectsSelect.innerHTML = moduleState.status.backgroundEffects.map((effect) => `<option value="${escapeHtml(effect.id)}">${escapeHtml(effect.label)}${effect.description ? ` · ${escapeHtml(effect.description)}` : ''}</option>`).join('');
    effectsSelect.dataset.loaded = 'true';
    effectsSelect.value = settings.backgroundEffect || 'bubbles';
  }
  window.dispatchEvent(new CustomEvent('mot-phut-background-effect-change'));
  const voiceSelect = $('#mot-phut-setting-voice');
  const voices = moduleState.status?.voices || [];
  if (voices.length && voiceSelect.dataset.loaded !== 'true') {
    voiceSelect.innerHTML = voices.map((voice) => `<option value="${escapeHtml(voice)}">${escapeHtml(voice)}</option>`).join('');
    voiceSelect.dataset.loaded = 'true';
  }
  voiceSelect.value = settings.voice || voices[0] || '';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function readSettingsForm() {
  const savedSettings = { ...(moduleState.settings || {}) };
  return {
    ...savedSettings,
    voice: $('#mot-phut-setting-voice').value,
    speed: Number($('#mot-phut-setting-speed').value),
    visualPreset: moduleState.design?.preset || moduleState.settings?.visualPreset || 'vintage-paper',
    highlightMode: $('#mot-phut-setting-highlight').value,
    highlightEnabled: $('#mot-phut-setting-highlight-enabled').checked,
    highlightColor: $('#mot-phut-setting-highlight-color').value,
    highlightPadding: Number($('#mot-phut-setting-highlight-padding').value),
    highlightRadius: Number($('#mot-phut-setting-highlight-radius').value),
    highlightTransition: 'instant',
    backgroundEffect: $('#mot-phut-setting-background-effect').value,
    backgroundEffectDensity: Number($('#mot-phut-setting-effect-density').value),
    backgroundEffectSpeed: Number($('#mot-phut-setting-effect-speed').value),
    backgroundEffectOpacity: Number($('#mot-phut-setting-effect-opacity').value),
    autoGenerationEnabled: $('#mot-phut-auto-generation').checked,
    autoScheduleEnabled: $('#mot-phut-auto-schedule').checked,
    autoPublishEnabled: $('#mot-phut-auto-publish').checked,
    postsPerDay: Number($('#mot-phut-posts-per-day').value),
    prepareAheadDays: Number($('#mot-phut-prepare-days').value),
    maxScriptsPerDay: Number($('#mot-phut-max-scripts').value),
    facebookPageId: $('#mot-phut-facebook-page-id').value.trim()
  };
}

function updateMotPhutPageStatus(page) {
  const node = $('#mot-phut-page-status');
  if (!node) return;
  const ready = Boolean(page?.verified && page?.tokenSaved);
  node.textContent = ready ? `Page ${page.pageName || page.pageId} đã xác minh` : page?.tokenSaved ? `Page ${page.pageId || ''} cần xác minh` : 'Chưa cấu hình Page MPVL';
  node.className = `state-pill ${ready ? 'ok' : page?.tokenSaved ? 'warn' : 'neutral'}`;
}

async function loadModuleStatus() {
  if (moduleState.loading) return moduleState.loading;
  moduleState.loading = (async () => {
    try {
      const data = await api('/status');
      moduleState.status = data;
      moduleState.settings = data.settings;
      moduleState.design = data.design;
      moduleState.page = data.facebookPage || null;
      fillSettings(data.settings);
      const status = $('#mot-phut-service-status');
      if (status) {
        status.textContent = data.vieneu?.ready ? 'VieNeu sẵn sàng' : 'VieNeu chưa sẵn sàng';
        status.className = `state-pill ${data.vieneu?.ready ? 'ok' : 'warn'}`;
      }
      return data;
    } catch (error) {
      setStatus(error.message, true);
      const status = $('#mot-phut-service-status');
      if (status) { status.textContent = 'Không kết nối'; status.className = 'state-pill error'; }
      throw error;
    } finally { moduleState.loading = null; }
  })();
  return moduleState.loading;
}

function createPayload() {
  const status = $('#mot-phut-create-status');
  if (!moduleState.settings || !moduleState.design) throw new Error('Đang tải cài đặt Một Phút Vỡ Lẽ. Vui lòng thử lại sau giây lát.');
  status.textContent = 'Đang thêm video vào hàng đợi riêng…';
  status.classList.remove('error');
  const settings = readSettingsForm();
  return { action: 'create', settings };
}

function moduleStatusFilter(status) {
  return status === 'complete' ? 'ready' : status === 'failed' ? 'failed' : ['script_ready', 'processing'].includes(status) ? 'processing' : status;
}

function motPhutCaptionParts({ caption = '', hashtags = [] } = {}) {
  const text = String(caption || '').normalize('NFC').trim();
  const hashtagPattern = /#[\p{L}\p{M}\p{N}_]+/gu;
  const inlineHashtags = text.match(hashtagPattern) || [];
  const cleanCaption = text.replace(hashtagPattern, ' ').replace(/[\s\u00a0]+/gu, ' ').trim();
  const storedHashtags = (Array.isArray(hashtags) ? hashtags : []).flatMap((tag) => {
    const value = String(tag || '').normalize('NFC').trim();
    const matches = value.match(hashtagPattern);
    return matches?.length ? matches : value ? [`#${value.replace(/^[#\s]+/u, '').replace(/[^\p{L}\p{M}\p{N}_]/gu, '')}`] : [];
  });
  const uniqueHashtags = [...inlineHashtags, ...storedHashtags].filter((tag, index, values) => tag.length > 1
    && values.findIndex((other) => other.toLocaleLowerCase('vi-VN') === tag.toLocaleLowerCase('vi-VN')) === index);
  return { caption: cleanCaption, hashtags: uniqueHashtags };
}

function motPhutCaptionText(video) {
  const parts = motPhutCaptionParts(video);
  return [parts.caption, parts.hashtags.join(' ')].filter(Boolean).join('\n');
}

function motPhutPipelineState(video) {
  const stages = ['Kịch bản', 'Giọng đọc', 'Render video', 'Hoàn tất'];
  const job = moduleState.progressJobs
    .filter((item) => item.progress?.contentId === video.id || item.payload?.contentId === video.id)
    .sort((left, right) => Number(right.status === 'running') - Number(left.status === 'running'))[0];
  const jobActive = ['pending', 'running'].includes(job?.status);
  if (video.status === 'complete' && !jobActive) return stages.map((label) => ({ label, status: 'done' }));
  const phase = String(job?.progress?.phase || '');
  const phaseStage = {
    'topic-discovery': 0, 'script-generation': 0, 'script-review-started': 0,
    'script-ready': 1, 'script-revised': 1, 'script-updated': 1, 'voice-updated': 1,
    'vieneu-synthesis': 1, 'vieneu-cache-hit': 1, 'audio-ready': 1,
    'alignment-script-revision': 1, 'local-alignment-started': 1, 'local-alignment-retry': 1,
    'local-alignment-complete': job?.progress?.reliable ? 2 : 1,
    'thumbnail-ready': 2, 'render-started': 2, 'frame-render': 2, 'ffmpeg-render': 2
  };

  let current = Number.isInteger(phaseStage[phase]) ? phaseStage[phase] : null;
  if (video.status === 'script_ready') current = 1;
  if (video.status === 'processing' && current === null) {
    current = video.thumbnailPath ? 2 : video.audioPath ? 1 : video.scriptText ? 1 : 0;
  }
  if (jobActive && current === null) current = job.type === 'rerender' && video.audioPath ? 2 : 0;
  if (video.status === 'failed' && !jobActive) {
    const failedStage = video.videoPath ? 3 : video.audioPath ? 2 : video.scriptText ? 1 : 0;
    return stages.map((label, index) => ({ label, status: index < failedStage ? 'done' : index === failedStage ? 'error' : 'pending' }));
  }
  if (phase === 'complete') return stages.map((label) => ({ label, status: 'done' }));
  current = Math.max(0, Math.min(2, current ?? 0));
  return stages.map((label, index) => ({ label, status: index < current ? 'done' : index === current ? 'active' : 'pending' }));
}

function motPhutPipelineMarkup(video) {
  const steps = motPhutPipelineState(video).map((step) => {
    const stateLabel = step.status === 'done' ? 'Đã hoàn tất' : step.status === 'error' ? 'Bị lỗi' : step.status === 'active' ? 'Đang thực hiện' : 'Đang chờ';
    return `<div class="pipeline-step ${step.status}" title="${escapeHtml(step.label)}: ${stateLabel}"><span class="pipeline-light"></span><span>${escapeHtml(step.label)}</span></div>`;
  }).join('');
  return `<div class="video-pipeline mot-phut-video-pipeline" data-mot-phut-pipeline="${escapeHtml(video.id)}" aria-label="Tiến trình tạo video">${steps}</div>`;
}

function refreshMotPhutPipelineMarkup() {
  for (const video of moduleState.videos) {
    const row = $(`[data-mot-phut-video="${CSS.escape(video.id)}"]`);
    const pipeline = row && $('.mot-phut-video-pipeline', row);
    if (pipeline) pipeline.outerHTML = motPhutPipelineMarkup(video);
  }
}

function moduleVideoCard(video) {
  const title = video.title || video.topic || 'Video M\u1ed9t Ph\u00fat V\u1ee1 L\u1ebd';
  const downloadFilename = `${String(title).normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 90) || 'video-mpvl'}.mp4`;
  const statusLabels = { complete: 'S\u1eb5n s\u00e0ng', processing: '\u0110ang t\u1ea1o', script_ready: 'Ch\u1edd render', failed: 'T\u1ea1o video l\u1ed7i' };
  const videoUrl = `${API}/files/${encodeURIComponent(video.id)}/video`;
  const thumbnailUrl = `${API}/files/${encodeURIComponent(video.id)}/thumbnail`;
  const error = video.lastError ? `<p class="mot-phut-video-error">${escapeHtml(video.lastError)}</p>` : '';
  const hasSchedule = moduleState.schedules.some((item) => item.contentId === video.id && item.status !== 'cancelled');
  const statusLabel = statusLabels[video.status] || video.status;
  const statusClass = video.status === 'complete' ? 'ok' : video.status === 'failed' ? 'error' : 'warn';
  const thumbnail = video.thumbnailPath
    ? `<img src="${thumbnailUrl}" alt="Thumbnail ${escapeHtml(title)}" loading="lazy" />`
    : `<span class="video-placeholder">${escapeHtml(title)}<small>${escapeHtml(statusLabel)}</small></span>`;
  const media = video.videoPath
    ? `<a class="video-thumb mot-phut-video-media" href="${videoUrl}" target="_blank" rel="noopener" aria-label="M\u1edf video ${escapeHtml(title)}">${thumbnail}<span class="video-badge">${escapeHtml(statusLabel)}</span><span class="mot-phut-video-play" aria-hidden="true">\u25b6</span></a>`
    : `<div class="video-thumb mot-phut-video-media">${thumbnail}<span class="video-badge">${escapeHtml(statusLabel)}</span></div>`;
  const caption = motPhutCaptionText(video);
  const scriptPanelId = `mot-phut-script-panel-${video.id}`;
  return `<article class="library-row mot-phut-video-row" data-mot-phut-video="${escapeHtml(video.id)}">
    ${media}
    <div class="library-main mot-phut-video-main"><h3>${escapeHtml(title)}</h3><p class="library-caption mot-phut-video-summary">${escapeHtml(caption)}</p><div class="row-meta"><span>${escapeHtml(video.category || 'M\u1ed9t Ph\u00fat V\u1ee1 L\u1ebd')}</span><span>\u00b7</span><span>${new Date(video.createdAt).toLocaleDateString('vi-VN')}</span></div>
      ${motPhutPipelineMarkup(video)}${error}
      <p class="mot-phut-video-action-status" data-mot-phut-delete-status role="status" aria-live="polite" hidden></p>
    </div><span class="state-pill ${statusClass}">${escapeHtml(statusLabel)}</span>
    <div class="row-actions mot-phut-video-actions"><button class="mini-action" type="button" data-mot-phut-toggle-script aria-expanded="false" aria-controls="${escapeHtml(scriptPanelId)}">K\u1ecbch b\u1ea3n</button><button class="mini-action" type="button" data-mot-phut-save-caption="${escapeHtml(video.id)}">L\u01b0u caption</button><button class="mini-action" type="button" data-mot-phut-rerender="${escapeHtml(video.id)}" ${video.status === 'processing' ? 'disabled' : ''}>Render l\u1ea1i</button>${video.status === 'complete' && !hasSchedule ? `<button class="mini-action" type="button" data-mot-phut-schedule="${escapeHtml(video.id)}">L\u00ean l\u1ecbch</button>` : hasSchedule ? '<span class="state-pill ok">\u0110\u00e3 c\u00f3 l\u1ecbch MPVL</span>' : ''}${video.videoPath ? `<a class="mini-action" href="${videoUrl}" download="${escapeHtml(downloadFilename)}">MP4 \u2193</a>` : ''}${video.audioPath ? `<a class="mini-action" href="${API}/files/${encodeURIComponent(video.id)}/audio" download>Audio \u2193</a>` : ''}<button class="mini-action danger-action" type="button" data-mot-phut-delete-video="${escapeHtml(video.id)}">X\u00f3a</button></div>
    <section class="mot-phut-script-panel" id="${escapeHtml(scriptPanelId)}" data-mot-phut-script-panel hidden><div class="mot-phut-script-fields"><label class="mot-phut-script-field"><span>N\u1ed9i dung k\u1ecbch b\u1ea3n</span><textarea data-mot-phut-script aria-label="N\u1ed9i dung k\u1ecbch b\u1ea3n" ${video.status === 'processing' ? 'disabled' : ''}>${escapeHtml(video.scriptText || '')}</textarea></label><label class="mot-phut-caption-field"><span>Caption v\u00e0 hashtag</span><textarea data-mot-phut-caption aria-label="Caption v\u00e0 hashtag">${escapeHtml(caption)}</textarea></label></div></section>
  </article>`;
}

function motPhutRecentCard(video) {
  if (video?.status !== 'complete' || !video.videoPath) return '';
  const title = video.title || video.topic || 'Video M\u1ed9t Ph\u00fat V\u1ee1 L\u1ebd';
  const videoUrl = `${API}/files/${encodeURIComponent(video.id)}/video`;
  const thumbnailUrl = `${API}/files/${encodeURIComponent(video.id)}/thumbnail`;
  const thumbnail = video.thumbnailPath
    ? `<img src="${thumbnailUrl}" alt="Thumbnail ${escapeHtml(title)}" loading="lazy" />`
    : `<span class="video-placeholder">${escapeHtml(title)}<small>MPVL · S\u1eb5n s\u00e0ng</small></span>`;
  const caption = motPhutCaptionText(video);
  const hasSchedule = moduleState.schedules.some((item) => item.contentId === video.id && item.status !== 'cancelled');
  const downloadFilename = `${String(title).normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 90) || 'video-mpvl'}.mp4`;
  return `<article class="video-card mot-phut-recent-card">
    <a class="video-thumb" href="${videoUrl}" target="_blank" rel="noopener" aria-label="M\u1edf video ${escapeHtml(title)}">${thumbnail}<span class="video-badge">S\u1eb5n s\u00e0ng</span></a>
    <div class="video-info"><h3>${escapeHtml(title)}</h3><p class="mot-phut-recent-caption">${escapeHtml(caption)}</p>
      <div class="video-meta"><span class="video-category">${escapeHtml(video.category || 'M\u1ed9t Ph\u00fat V\u1ee1 L\u1ebd')}</span><div class="video-actions">${!hasSchedule ? `<button class="mini-action" type="button" data-mot-phut-recent-schedule="${escapeHtml(video.id)}">L\u00ean l\u1ecbch</button>` : '<span class="state-pill ok">\u0110\u00e3 l\u00ean l\u1ecbch</span>'}<a class="mini-action" href="${videoUrl}" download="${escapeHtml(downloadFilename)}">MP4 \u2193</a></div></div>
    </div>
  </article>`;
}

async function loadModuleVideos() {
  try {
    const [result, scheduleResult, jobResult] = await Promise.all([
      api('/videos'), api('/schedules'), api('/jobs').catch(() => ({ jobs: [] }))
    ]);
    moduleState.videos = Array.isArray(result.videos) ? result.videos : [];
    moduleState.schedules = Array.isArray(scheduleResult.schedules) ? scheduleResult.schedules : [];
    moduleState.progressJobs = Array.isArray(jobResult.jobs) ? jobResult.jobs : [];
    renderModuleLibrary();
    window.dispatchEvent(new CustomEvent('mot-phut-videos-ready', { detail: { videos: moduleState.videos, schedules: moduleState.schedules } }));
    if (moduleState.progressJobs.some((job) => ['pending', 'running'].includes(job.status))) startJobPolling();
  } catch (error) {
    const status = $('#mot-phut-create-status');
    if (status) { status.textContent = error.message; status.classList.add('error'); }
  }
}

function renderModuleLibrary() {
  const list = $('#library-list');
  if (!list) return;
  list.querySelectorAll('.mot-phut-video-row, .mot-phut-empty-state').forEach((node) => node.remove());
  const languageFilter = $('#content-language-filter')?.value || 'all';
  const moduleOnly = languageFilter === 'mot-phut-vo-le';
  const rows = [...list.querySelectorAll('.library-row:not(.mot-phut-video-row)')];
  rows.forEach((row) => { row.hidden = moduleOnly; });
  if (moduleOnly) list.querySelectorAll('.empty-state:not(.mot-phut-empty-state)').forEach((node) => node.remove());

  const statusFilter = $('.filter-tab.active')?.dataset.filter || 'all';
  const videos = moduleState.videos.filter((video) => statusFilter === 'all' || (statusFilter === 'ready' && video.status === 'complete') || (statusFilter === 'failed' && video.status === 'failed') || (statusFilter === 'processing' && ['processing', 'script_ready'].includes(video.status)));
  const showingModule = moduleOnly || languageFilter === 'all';
  const visibleVideos = showingModule ? videos : [];
  if (visibleVideos.length) {
    list.querySelectorAll('.empty-state:not(.mot-phut-empty-state)').forEach((node) => node.remove());
    list.insertAdjacentHTML('beforeend', visibleVideos.map(moduleVideoCard).join(''));
  } else if (moduleOnly) {
    list.insertAdjacentHTML('beforeend', '<div class="empty-state mot-phut-empty-state"><strong>Chưa có video Một Phút Vỡ Lẽ</strong>Tạo video từ lựa chọn nội dung ở trang Tổng quan.</div>');
  }
  const standardCount = moduleOnly ? 0 : rows.filter((row) => !row.hidden).length;
  $('#video-count').textContent = `${standardCount + visibleVideos.length} VIDEO`;
}

async function handleModuleLibraryAction(event) {
  const scriptToggleButton = event.target.closest('[data-mot-phut-toggle-script]');
  const captionButton = event.target.closest('[data-mot-phut-save-caption]');
  const rerenderButton = event.target.closest('[data-mot-phut-rerender]');
  const scheduleButton = event.target.closest('[data-mot-phut-schedule]');
  const deleteButton = event.target.closest('[data-mot-phut-delete-video]');
  if (scriptToggleButton) {
    const row = scriptToggleButton.closest('.mot-phut-video-row');
    const panel = row && $('[data-mot-phut-script-panel]', row);
    if (!panel) return;
    panel.hidden = !panel.hidden;
    scriptToggleButton.setAttribute('aria-expanded', String(!panel.hidden));
    return;
  }
  if (!captionButton && !rerenderButton && !scheduleButton && !deleteButton) return;
  const id = captionButton?.dataset.motPhutSaveCaption || rerenderButton?.dataset.motPhutRerender || scheduleButton?.dataset.motPhutSchedule || deleteButton?.dataset.motPhutDeleteVideo;
  if (scheduleButton) {
    window.dispatchEvent(new CustomEvent('mot-phut-open-schedule', { detail: { videoId: id } }));
    return;
  }
  if (deleteButton) {
    const row = deleteButton.closest('.mot-phut-video-row');
    const video = moduleState.videos.find((item) => item.id === id);
    if (!row || !id) return;
    const title = video?.title || video?.topic || row.querySelector('h3')?.textContent || 'video MPVL này';
    const confirmed = window.confirm(`Xóa “${title}” khỏi thư viện MPVL và xóa video, thumbnail, audio, lịch cùng dữ liệu căn chỉnh trên máy? Kịch bản sẽ được giữ trong lịch sử chống trùng để không tạo lại nội dung này; bài đã đăng trên Facebook không bị gỡ. Tiếp tục?`);
    if (!confirmed) return;
    const actionStatus = row.querySelector('[data-mot-phut-delete-status]');
    if (actionStatus) {
      actionStatus.textContent = 'Đang xóa video và các tệp liên quan…';
      actionStatus.hidden = false;
      actionStatus.classList.remove('error');
    }
    deleteButton.disabled = true;
    try {
      const result = await api(`/videos/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (result.deleted) row.remove();
      await loadModuleVideos();
      const warningCount = Array.isArray(result.cleanupWarnings) ? result.cleanupWarnings.length : 0;
      setStatus(warningCount
        ? `Đã xóa khỏi thư viện; còn ${warningCount} mục tệp chưa dọn được do máy đang khóa tệp.`
        : 'Đã xóa video và các tệp liên quan; lịch sử chống trùng vẫn được giữ.', warningCount > 0, '#mot-phut-create-status');
    } catch (error) {
      if (actionStatus) {
        actionStatus.textContent = error.message || 'Không xóa được video MPVL.';
        actionStatus.hidden = false;
        actionStatus.classList.add('error');
      }
      deleteButton.disabled = false;
    }
    return;
  }
  const row = $(`[data-mot-phut-video="${CSS.escape(id)}"]`);
  try {
    if (captionButton) {
      const captionParts = motPhutCaptionParts({ caption: $('[data-mot-phut-caption]', row).value });
      const result = await api(`/videos/${encodeURIComponent(id)}/caption`, { method: 'PUT', body: JSON.stringify(captionParts) });
      const savedVideo = result.video || { ...moduleState.videos.find((item) => item.id === id), ...captionParts };
      moduleState.videos = moduleState.videos.map((item) => item.id === id ? savedVideo : item);
      const summary = $('.mot-phut-video-summary', row);
      if (summary) summary.textContent = motPhutCaptionText(savedVideo);
      window.dispatchEvent(new CustomEvent('mot-phut-videos-ready', { detail: { videos: moduleState.videos, schedules: moduleState.schedules } }));
      captionButton.textContent = 'Đã lưu';
      setTimeout(() => { captionButton.textContent = 'Lưu caption'; }, 1500);
    } else {
      const scriptText = $('[data-mot-phut-script]', row).value;
      rerenderButton.disabled = true;
      const result = await api(`/videos/${encodeURIComponent(id)}/rerender`, { method: 'POST', body: JSON.stringify({ scriptText }) });
      moduleState.jobs.add(result.job.id);
      setStatus(`Đã xếp render lại · Job ${result.job.id}.`, false, '#mot-phut-create-status');
      startJobPolling();
    }
  } catch (error) {
    const status = captionButton ? '#mot-phut-settings-status' : '#mot-phut-create-status';
    setStatus(error.message, true, status);
    if (rerenderButton) rerenderButton.disabled = false;
  }
}

async function pollModuleJobs() {
  try {
    const result = await api('/jobs');
    const jobs = result.jobs || [];
    moduleState.progressJobs = jobs;
    refreshMotPhutPipelineMarkup();
    const active = jobs.filter((job) => moduleState.jobs.has(job.id) || ['pending', 'running'].includes(job.status));
    if (!active.length) { stopJobPolling(); return; }
    const current = active.find((job) => ['pending', 'running'].includes(job.status));
    if (current) {
      const phase = current.progress?.phase ? ` · ${current.progress.phase}` : '';
      setStatus(`Đang xử lý video riêng${phase}…`, false, '#mot-phut-create-status');
    }
    const finished = active.some((job) => ['complete', 'completed'].includes(job.status));
    const failed = active.find((job) => job.status === 'failed');
    if (finished || failed) {
      if (failed) setStatus(failed.lastError || 'Tạo video thất bại.', true, '#mot-phut-create-status');
      else setStatus('Video đã hoàn tất và có trong thư viện.', false, '#mot-phut-create-status');
      active.forEach((job) => { if (!['pending', 'running'].includes(job.status)) moduleState.jobs.delete(job.id); });
      await loadModuleVideos();
    }
  } catch (error) { setStatus(error.message, true, '#mot-phut-create-status'); }
}

function startJobPolling() {
  if (moduleState.pollTimer) return;
  void pollModuleJobs();
  moduleState.pollTimer = setInterval(pollModuleJobs, 2500);
}
function stopJobPolling() { clearInterval(moduleState.pollTimer); moduleState.pollTimer = null; }

async function saveSettings({ throwOnError = false } = {}) {
  const pageId = $('#mot-phut-facebook-page-id').value.trim();
  const accessToken = $('#mot-phut-facebook-page-token').value.trim();
  const shouldSavePage = moduleState.pageDirty || pageId !== moduleState.pageSavedId || Boolean(accessToken);
  if (!moduleState.settingsDirty && !shouldSavePage) return true;
  const revisionAtSave = moduleState.settingsRevision;
  const pageRevisionAtSave = moduleState.pageRevision;
  try {
    if (shouldSavePage) {
      const pageResult = await api('/facebook-page', { method: 'PUT', body: JSON.stringify({ pageId, accessToken }) });
      moduleState.page = pageResult.page;
      if (moduleState.status) moduleState.status.facebookPage = pageResult.page;
      moduleState.pageSavedId = pageResult.page.pageId || '';
      moduleState.settings = { ...(moduleState.settings || {}), facebookPageId: moduleState.pageSavedId };
      if (moduleState.pageRevision === pageRevisionAtSave) {
        moduleState.pageDirty = false;
        $('#mot-phut-facebook-page-token').value = '';
      }
      updateMotPhutPageStatus(moduleState.page);
    }
    if (moduleState.settingsDirty) {
      const savedSettings = await api('/settings', { method: 'PUT', body: JSON.stringify(readSettingsForm()) });
      moduleState.settings = savedSettings.settings;
      if (moduleState.settingsRevision === revisionAtSave) {
        fillSettings(savedSettings.settings);
        moduleState.settingsDirty = false;
      }
    }
    if (moduleState.settingsDirty || moduleState.pageDirty) setStatus('Một số cài đặt MPVL vừa thay đổi, hãy lưu lại.');
    else if (shouldSavePage && !moduleState.settingsDirty) setStatus('Đã lưu thông tin Page MPVL.', false, '#mot-phut-facebook-status');
    else setStatus('Đã lưu cài đặt riêng cho Một Phút Vỡ Lẽ.');
    return true;
  } catch (error) {
    setStatus(error.message, true);
    if (throwOnError) throw error;
    return false;
  }
}

async function persistMotPhutFacebookPage() {
  const pageId = $('#mot-phut-facebook-page-id').value.trim();
  const accessToken = $('#mot-phut-facebook-page-token').value.trim();
  const pageRevisionAtSave = moduleState.pageRevision;
  const saved = await api('/facebook-page', { method: 'PUT', body: JSON.stringify({ pageId, accessToken }) });
  moduleState.page = saved.page;
  if (moduleState.status) moduleState.status.facebookPage = saved.page;
  moduleState.pageSavedId = saved.page.pageId || '';
  moduleState.settings = { ...(moduleState.settings || {}), facebookPageId: moduleState.pageSavedId };
  if (moduleState.pageRevision === pageRevisionAtSave) {
    moduleState.pageDirty = false;
    $('#mot-phut-facebook-page-token').value = '';
  }
  updateMotPhutPageStatus(moduleState.page);
  return saved.page;
}

async function saveMotPhutFacebookPage() {
  const button = $('#mot-phut-save-facebook-page');
  button.disabled = true;
  setStatus('Đang lưu thông tin Page MPVL…', false, '#mot-phut-facebook-status');
  try {
    await persistMotPhutFacebookPage();
    setStatus('Đã lưu thông tin Page riêng cho Một Phút Vỡ Lẽ.', false, '#mot-phut-facebook-status');
  } catch (error) { setStatus(error.message, true, '#mot-phut-facebook-status'); }
  finally { button.disabled = false; }
}

async function verifyMotPhutPage() {
  const button = $('#mot-phut-verify-page');
  button.disabled = true;
  setStatus('Đang lưu và xác minh Page MPVL…', false, '#mot-phut-facebook-status');
  try {
    await persistMotPhutFacebookPage();
    const result = await api('/facebook-page/verify', { method: 'POST', body: '{}' });
    moduleState.page = result.page;
    if (moduleState.status) moduleState.status.facebookPage = result.page;
    updateMotPhutPageStatus(moduleState.page);
    setStatus(`Đã xác minh Page MPVL: ${result.page.pageName || result.page.pageId}.`, false, '#mot-phut-facebook-status');
  } catch (error) { setStatus(error.message, true, '#mot-phut-facebook-status'); }
  finally { button.disabled = false; }
}

async function previewVoice() {
  const button = $('#mot-phut-preview-voice');
  const audio = $('#mot-phut-preview-audio');
  button.disabled = true;
  setStatus('Đang tạo audio nghe thử…');
  try {
    const result = await api('/voices/preview', { method: 'POST', body: JSON.stringify({ text: 'Xin chào, mình cùng khám phá một điều thú vị nhé.', voice: $('#mot-phut-setting-voice').value, speed: Number($('#mot-phut-setting-speed').value) }) });
    audio.src = result.url;
    audio.hidden = false;
    await audio.play();
    setStatus('Đang phát giọng VieNeu đã chọn.');
  } catch (error) { setStatus(error.message, true); }
  finally { button.disabled = false; }
}

function renderMotPhutHighlightPreviewText(text, tokens = null) {
  const host = $('#mot-phut-highlight-preview-words');
  if (!host) return new Map();
  const tokenList = Array.isArray(tokens) ? tokens : [...String(text).matchAll(/\S+/gu)].map((match, index) => ({
    id: `mot-phut-preview:${index + 1}`, start: match.index, end: match.index + match[0].length
  }));
  host.replaceChildren();
  let offset = 0;
  const spans = new Map();
  for (const token of tokenList) {
    const start = Number(token.start), end = Number(token.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < offset || end <= start || end > text.length) continue;
    if (start > offset) host.append(document.createTextNode(text.slice(offset, start)));
    const span = document.createElement('span');
    span.className = 'highlight-preview-word';
    span.dataset.tokenId = token.id;
    span.textContent = text.slice(start, end);
    host.append(span);
    spans.set(token.id, span);
    offset = end;
  }
  if (offset < text.length) host.append(document.createTextNode(text.slice(offset)));
  return spans;
}

function updateMotPhutHighlightPreviewStyle() {
  const host = $('#mot-phut-highlight-preview-words');
  if (!host) return;
  host.style.setProperty('--highlight-color', $('#mot-phut-setting-highlight-color').value || '#FF8066');
  host.style.setProperty('--highlight-padding', `${Number($('#mot-phut-setting-highlight-padding').value) || 0}px`);
  host.style.setProperty('--highlight-radius', `${Number($('#mot-phut-setting-highlight-radius').value) || 0}px`);
  host.style.setProperty('--highlight-transition-duration', '0ms');
}

async function previewMotPhutHighlight() {
  const button = $('#mot-phut-highlight-preview-play');
  const status = $('#mot-phut-highlight-preview-status');
  const text = $('#mot-phut-highlight-preview-source').value.trim();
  button.disabled = true;
  status.textContent = 'Đang tạo audio và lấy căn chỉnh…';
  try {
    const result = await api('/voices/preview', { method: 'POST', body: JSON.stringify({
      text, voice: $('#mot-phut-setting-voice').value, speed: Number($('#mot-phut-setting-speed').value),
      highlightMode: $('#mot-phut-setting-highlight').value
    }) });
    const spans = renderMotPhutHighlightPreviewText(text, result.tokens);
    updateMotPhutHighlightPreviewStyle();
    if (moduleState.highlightPreviewAudio) {
      moduleState.highlightPreviewAudio.pause();
      moduleState.highlightPreviewAudio.currentTime = 0;
    }
    if (moduleState.highlightPreviewFrame) cancelAnimationFrame(moduleState.highlightPreviewFrame);
    const audio = new Audio(new URL(result.url, location.href).href);
    moduleState.highlightPreviewAudio = audio;
    const intervals = $('#mot-phut-setting-highlight-enabled').checked ? result.highlightIntervals || [] : [];
    const updateWord = () => {
      const active = intervals.find((item) => audio.currentTime >= item.startSeconds && audio.currentTime < item.endSeconds);
      const activeIds = new Set(active?.tokenIds || []);
      for (const [tokenId, span] of spans) span.classList.toggle('is-active', activeIds.has(tokenId));
    };
    const syncPreview = () => {
      updateWord();
      if (!audio.paused && !audio.ended) moduleState.highlightPreviewFrame = requestAnimationFrame(syncPreview);
    };
    audio.addEventListener('play', syncPreview);
    audio.addEventListener('pause', () => { if (moduleState.highlightPreviewFrame) cancelAnimationFrame(moduleState.highlightPreviewFrame); });
    audio.addEventListener('ended', () => {
      if (moduleState.highlightPreviewFrame) cancelAnimationFrame(moduleState.highlightPreviewFrame);
      for (const span of spans.values()) span.classList.remove('is-active');
    });
    await audio.play();
    status.textContent = result.alignment?.reliable
      ? `Đang nghe thử · ${result.voice} · ${result.wordTimings?.length || 0} mốc từ`
      : `Audio đã tạo, nhưng chưa có căn chỉnh từ đáng tin nên preview không tô từ.${result.alignment?.warning ? ` ${result.alignment.warning}` : ''}`;
  } catch (error) {
    status.textContent = error.message;
  } finally { button.disabled = false; }
}

function setGenerateStatusFromJob(event) {
  const job = event.detail?.job;
  if (job?.id) moduleState.jobs.add(job.id);
  setStatus('Video đã vào hàng đợi Một Phút Vỡ Lẽ.', false, '#mot-phut-create-status');
  startJobPolling();
}

function markModuleSettingsDirty(event) {
  if (event.target?.id === 'mot-phut-highlight-preview-source') { event.stopPropagation(); return; }
  if (event.target?.matches('input, select, textarea') && !event.target.disabled) {
    moduleState.settingsDirty = true;
    moduleState.settingsRevision += 1;
    updateMotPhutScheduleStatus();
    const saveButton = $('#save-settings');
    if (saveButton) saveButton.disabled = false;
    setStatus('Có cài đặt Một Phút Vỡ Lẽ chưa lưu. Dùng nút “Lưu cài đặt” ở cuối trang.');
  }
  event.stopPropagation();
}

function markMotPhutPageDirty(event) {
  if (event.target?.matches('input, select, textarea') && !event.target.disabled) {
    moduleState.pageDirty = true;
    moduleState.pageRevision += 1;
    const saveButton = $('#save-settings');
    if (saveButton) saveButton.disabled = false;
    setStatus('Thông tin Page MPVL chưa lưu.', false, '#mot-phut-facebook-status');
  }
  event.stopPropagation();
}

window.motPhutVoLe = { createPayload, hasPendingSettings: () => moduleState.settingsDirty || moduleState.pageDirty, isActive: moduleModeActive,
  setSettingsProfile, isBackgroundEffectProfileActive: () => moduleSettingsProfiles.background,
  getVideos: () => moduleState.videos, getSchedules: () => moduleState.schedules, renderRecentCard: motPhutRecentCard, saveSettings,
  syncFacebookSettingsProfile };
window.addEventListener('mot-phut-mode-change', syncModuleMode);
window.addEventListener('mot-phut-job-created', setGenerateStatusFromJob);
window.addEventListener('mot-phut-schedule-state', (event) => {
  moduleState.schedules = Array.isArray(event.detail?.schedules) ? event.detail.schedules : [];
  renderModuleLibrary();
});
window.addEventListener('library:rendered', renderModuleLibrary);
$('#library-list')?.addEventListener('click', handleModuleLibraryAction);
$('#recent-videos')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-mot-phut-recent-schedule]');
  if (!button) return;
  window.dispatchEvent(new CustomEvent('mot-phut-open-schedule', { detail: { videoId: button.dataset.motPhutRecentSchedule } }));
});
$('#content-language-filter')?.addEventListener('change', renderModuleLibrary);
$('#mot-phut-setting-speed')?.addEventListener('input', (event) => { $('#mot-phut-setting-speed-label').textContent = `${Number(event.currentTarget.value).toFixed(2)}×`; });
$('#mot-phut-inline-settings')?.addEventListener('input', markModuleSettingsDirty);
$('#mot-phut-inline-settings')?.addEventListener('change', markModuleSettingsDirty);
$('#mot-phut-inline-highlight')?.addEventListener('input', markModuleSettingsDirty);
$('#mot-phut-inline-highlight')?.addEventListener('change', markModuleSettingsDirty);
$('#mot-phut-background-settings')?.addEventListener('input', markModuleSettingsDirty);
$('#mot-phut-background-settings')?.addEventListener('change', markModuleSettingsDirty);
$('#mot-phut-schedule-settings')?.addEventListener('input', markModuleSettingsDirty);
$('#mot-phut-schedule-settings')?.addEventListener('change', markModuleSettingsDirty);
$('#schedule-content-profile')?.addEventListener('change', (event) => {
  syncScheduleSettingsProfile();
  event.stopPropagation();
});
$('#facebook-quick-route-language')?.addEventListener('change', syncFacebookSettingsProfile);
$('#mot-phut-facebook-page-settings')?.addEventListener('input', markMotPhutPageDirty);
$('#mot-phut-facebook-page-settings')?.addEventListener('change', markMotPhutPageDirty);
for (const [input, output] of [
  ['#mot-phut-setting-effect-density', '#mot-phut-setting-effect-density-label'],
  ['#mot-phut-setting-effect-speed', '#mot-phut-setting-effect-speed-label'],
  ['#mot-phut-setting-effect-opacity', '#mot-phut-setting-effect-opacity-label']
]) $(input)?.addEventListener('input', (event) => { $(output).textContent = event.currentTarget.value; window.dispatchEvent(new CustomEvent('mot-phut-background-effect-change')); });
$('#mot-phut-setting-background-effect')?.addEventListener('change', (event) => {
  markModuleSettingsDirty(event);
  window.dispatchEvent(new CustomEvent('mot-phut-background-effect-change'));
});
for (const selector of ['#mot-phut-setting-highlight-color', '#mot-phut-setting-highlight-padding', '#mot-phut-setting-highlight-radius']) {
  $(selector)?.addEventListener('input', updateMotPhutHighlightPreviewStyle);
}
$('#mot-phut-highlight-preview-source')?.addEventListener('input', (event) => {
  renderMotPhutHighlightPreviewText(event.currentTarget.value);
  updateMotPhutHighlightPreviewStyle();
});
$('#mot-phut-highlight-preview-play')?.addEventListener('click', () => void previewMotPhutHighlight());
$('#mot-phut-save-facebook-page')?.addEventListener('click', () => void saveMotPhutFacebookPage());
$('#mot-phut-verify-page')?.addEventListener('click', () => void verifyMotPhutPage());
$('#mot-phut-reset-settings')?.addEventListener('click', async () => {
  const button = $('#mot-phut-reset-settings'); button.disabled = true;
  try { const result = await api('/settings/reset', { method: 'POST', body: '{}' }); moduleState.status = null; moduleState.page = null; fillSettings(result.settings); moduleState.settingsDirty = false; moduleState.settingsRevision += 1; setStatus('Đã khôi phục cài đặt mặc định của nhánh này.'); }
  catch (error) { setStatus(error.message, true); }
  finally { button.disabled = false; }
});
$('#mot-phut-preview-voice')?.addEventListener('click', () => void previewVoice());
document.addEventListener('DOMContentLoaded', () => {
  syncModuleMode();
  syncFacebookSettingsProfile();
  void loadModuleStatus().then(() => { void loadModuleVideos(); }).catch(() => {});
  if ($('#content-language-filter')?.value === 'mot-phut-vo-le') void loadModuleVideos();
});
