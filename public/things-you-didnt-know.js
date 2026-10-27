const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const API = '/api/things-you-didnt-know';
const CONTENT_ID = 'things-you-didnt-know';
const state = { settings: null, design: null, backgroundEffects: [], contents: [], jobs: [], schedules: [], activity: [], dirty: false, loading: null, voiceProfileActive: false, highlightProfileActive: false, facebookProfileActive: false };

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function api(route, options = {}) {
  const response = await fetch(API + route, { cache: 'no-store', ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function addSelectOption(select, value, label) {
  if (!select || [...select.options].some((option) => option.value === value)) return;
  select.add(new Option(label, value));
}

function mount() {
  addSelectOption($('#content-language'), CONTENT_ID, "Things You Didn't Know · English");
  addSelectOption($('#content-language-filter'), CONTENT_ID, "Things You Didn't Know");
  addSelectOption($('#schedule-content-profile'), CONTENT_ID, "Things You Didn't Know · English");
  addSelectOption($('#background-effect-language'), CONTENT_ID, "Things You Didn't Know · English");
  addSelectOption($('#voice-highlight-content-profile'), CONTENT_ID, "Things You Didn't Know · English");
  addSelectOption($('#facebook-quick-route-language'), CONTENT_ID, "Things You Didn't Know · English");

  const createFields = document.createElement('section');
  createFields.className = 'tydk-create-fields';
  createFields.id = 'things-create-fields';
  createFields.hidden = true;
  createFields.innerHTML = `
    <p class="tydk-create-note">Mỗi lần nhấn tạo chỉ xếp đúng một Reel tiếng Anh. Nguồn được tải để kiểm tra; ứng dụng không tự tuyên bố fact đã xác minh.</p>
    <p class="tydk-create-status" id="tydk-create-status" role="status" aria-live="polite"></p>`;
  $('#mot-phut-create-fields')?.after(createFields);

  const heroControls = $('.hero-controls');
  const createNote = createFields.querySelector('.tydk-create-note');
  if (createNote) createNote.textContent = 'Each generation queues one English Reel. Review its sources before scheduling.';
  createFields.querySelectorAll('.tydk-create-note').forEach((note) => { if (note !== createNote) note.remove(); });
  if (heroControls) heroControls.after(createFields);

  const profileFragments = document.createElement('div');
  profileFragments.innerHTML = `
    <div class="vieneu-settings tts-provider-panel tydk-inline-voice" id="tydk-voice-profile-settings" data-things-you-didnt-know-settings hidden>
      <div class="vieneu-voice-grid"><label>Tiếng Anh · Kokoro<select id="tydk-voice"></select></label></div>
      <div class="vieneu-speed-grid"><div class="speed-control vieneu-speed-control"><label for="tydk-speed">Tốc độ giọng tiếng Anh <output id="tydk-speed-label">1.00×</output></label><input id="tydk-speed" type="range" min="0.75" max="1.15" step="0.05" value="1" /></div></div>
      <div class="button-row vieneu-preview-actions"><button class="button button-outline button-small" id="tydk-preview-voice" type="button">▶ Nghe thử tiếng Anh · Kokoro</button><audio id="tydk-preview-audio" controls hidden></audio></div>
      <p class="vieneu-note" id="tydk-service-status" role="status" aria-live="polite">Đang kiểm tra Kokoro.</p><p class="inline-status" id="tydk-settings-status" role="status" aria-live="polite"></p>
    </div>
      <div class="highlight-settings-grid tydk-inline-highlight" id="tydk-highlight-profile-settings" data-things-you-didnt-know-settings hidden>
      <label class="switch-row highlight-enable"><input type="checkbox" id="tydk-highlight-enabled" checked /><span class="switch"></span><span><strong>Bật highlight đồng bộ</strong><small>Chỉ áp dụng cho Things You Didn't Know.</small></span></label><label>Kiểu highlight<select id="tydk-highlight-mode"><option value="word">Từng từ</option><option value="phrase">Từng cụm từ</option></select></label>
      <label>Hiệu ứng chữ<select id="tydk-highlight-style"><option value="background">Tô nền từ đang đọc</option><option value="text-color">Đổi màu chữ đang đọc</option></select></label>
      <label><span id="tydk-highlight-color-label">Màu highlight</span><input id="tydk-highlight-color" type="color" /></label><label>Padding (px)<input id="tydk-highlight-padding" type="number" min="0" max="24" step="1" /></label><label>Bo góc (px)<input id="tydk-highlight-radius" type="number" min="0" max="32" step="1" /></label>
      <label class="highlight-preview-source">Câu nghe thử<textarea id="tydk-highlight-preview-source" rows="2">A small community habit can make a rainy day easier.</textarea></label>
      <div class="highlight-preview-actions"><button class="button button-outline button-small" id="tydk-highlight-preview-play" type="button">▶ Nghe thử Highlight</button><span class="muted-copy" id="tydk-highlight-preview-status" role="status" aria-live="polite">Kokoro đọc câu mẫu và áp hiệu ứng theo timing.</span></div>
      <div class="highlight-preview-text" id="tydk-highlight-preview-words" aria-label="Things You Didn't Know highlight preview"></div>
    </div>
    <div class="tydk-inline-schedule" id="tydk-schedule-profile-settings" data-things-you-didnt-know-settings hidden>
      <div class="tydk-schedule-status-row"><strong>Full Auto · Things You Didn't Know</strong><span class="state-pill neutral" id="tydk-auto-state">Đang tắt</span></div>
      <div class="schedule-settings-row tydk-schedule-limits"><label>Bài mỗi ngày<input id="tydk-posts-per-day" type="number" min="1" max="4" value="1" /></label><label>Dự phòng trước (ngày)<input id="tydk-prepare-days" type="number" min="1" max="30" value="3" /></label><label>Giới hạn kịch bản/ngày<input id="tydk-max-scripts" type="number" min="1" max="10" value="3" /></label></div>
      <div class="auto-options tydk-auto-options"><label class="switch-row"><input type="checkbox" id="tydk-full-auto" /><span class="switch"></span><span><strong>Full Auto</strong><small>Mặc định tắt; chỉ xếp lịch sau khi duyệt nguồn.</small></span></label><label class="switch-row"><input type="checkbox" id="tydk-auto-generation" /><span class="switch"></span><span><strong>Tự tạo video</strong><small>Tạo từng Reel theo lượt worker.</small></span></label><label class="switch-row"><input type="checkbox" id="tydk-auto-publish" /><span class="switch"></span><span><strong>Tự đăng theo lịch</strong><small>Live cần Page riêng đã xác minh.</small></span></label></div>
    </div>
    <div class="tydk-inline-facebook" id="tydk-facebook-profile-settings" data-things-you-didnt-know-settings hidden>
      <div class="mot-phut-facebook-status"><span id="tydk-page-status" class="state-pill neutral">Chưa cấu hình Page Things You Didn't Know</span><span class="muted-copy">Page ID và token được lưu riêng.</span></div>
      <div class="mot-phut-facebook-fields"><label>Chế độ đăng<select id="tydk-facebook-adapter"><option value="mock">Mock · thử nghiệm</option><option value="meta">Meta Graph API · đăng thật</option></select></label><label>Facebook Page ID<input id="tydk-page-id" inputmode="numeric" autocomplete="off" /></label><label>Page Access Token<input id="tydk-page-token" type="password" autocomplete="new-password" placeholder="Chỉ nhập khi thêm hoặc thay token" /></label></div>
      <div class="button-row mot-phut-facebook-actions"><button class="button button-outline button-small" id="tydk-save-page" type="button">Lưu thông tin</button><button class="button button-quiet button-small" id="tydk-verify-page" type="button">Kiểm tra Page</button><button class="button button-quiet button-small" id="tydk-clear-token" type="button">Xóa token đã lưu</button></div>
    </div>`;

  $('#tool-checks')?.before(profileFragments.querySelector('#tydk-voice-profile-settings'));
  $('#voice-highlight-content-selector')?.after(profileFragments.querySelector('#tydk-highlight-profile-settings'));
  $('#schedule-content-profile')?.after(profileFragments.querySelector('#tydk-schedule-profile-settings'));
  $('#facebook-quick-route-language')?.after(profileFragments.querySelector('#tydk-facebook-profile-settings'));

  const thingsSchedules = document.createElement('div');
  thingsSchedules.className = 'tydk-schedule-items';
  thingsSchedules.id = 'things-schedule-list';
  $('#schedule-list')?.append(thingsSchedules);
}

function setMode(active) {
  const createFields = $('#things-create-fields');
  if (createFields) createFields.hidden = !active;
  const heroControls = $('.hero-controls');
  heroControls?.classList.toggle('tydk-hero-controls', active);
  const topicWrap = $('#topic-select-wrap');
  const addTopic = $('#add-topic');
  if (topicWrap) topicWrap.hidden = active;
  if (addTopic) addTopic.hidden = active;
  const motPhutFields = $('#mot-phut-create-fields');
  if (motPhutFields && active) motPhutFields.hidden = true;
  syncSettingsVisibility();
  if (active) void loadStatus().then(() => loadContents());
}

function syncSettingsVisibility() {
  const effectProfile = $('#background-effect-language')?.value;
  const highlightProfile = $('#voice-highlight-content-profile')?.value;
  const scheduleProfile = $('#schedule-content-profile')?.value;
  const facebookProfile = $('#facebook-quick-route-language')?.value;
  const voice = $('#tydk-voice-profile-settings');
  const highlight = $('#tydk-highlight-profile-settings');
  const schedule = $('#tydk-schedule-profile-settings');
  const facebook = $('#tydk-facebook-profile-settings');
  if (voice) voice.hidden = !state.voiceProfileActive;
  if (highlight) highlight.hidden = highlightProfile !== CONTENT_ID;
  if (schedule) schedule.hidden = scheduleProfile !== CONTENT_ID;
  if (facebook) facebook.hidden = facebookProfile !== CONTENT_ID;

  const standardEffect = $('#standard-background-effect-control');
  if (standardEffect) standardEffect.hidden = effectProfile === 'mot-phut-vo-le';
  if (effectProfile === CONTENT_ID) syncThingsEffectProfile();
  const standardSchedule = $('#standard-schedule-settings');
  const standardScheduleState = $('#auto-state');
  if (standardSchedule) standardSchedule.hidden = scheduleProfile === CONTENT_ID || scheduleProfile === 'mot-phut-vo-le';
  if (standardScheduleState) standardScheduleState.hidden = scheduleProfile === CONTENT_ID || scheduleProfile === 'mot-phut-vo-le';
  const standardFacebook = $('#standard-facebook-settings');
  const standardFacebookStatus = $('#facebook-status-pill');
  const standardFacebookAdapter = $('#facebook-adapter-control');
  const moduleFacebook = facebookProfile === 'mot-phut-vo-le';
  if (standardFacebook) standardFacebook.hidden = facebookProfile === CONTENT_ID || moduleFacebook;
  if (standardFacebookStatus) standardFacebookStatus.hidden = facebookProfile === CONTENT_ID || moduleFacebook;
  if (standardFacebookAdapter) standardFacebookAdapter.hidden = facebookProfile === CONTENT_ID || moduleFacebook;
}

function fillSettings(settings, voices = []) {
  state.settings = { ...settings };
  const voice = $('#tydk-voice');
  if (voice && voices.length) {
    voice.innerHTML = voices.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join('');
    const wanted = voices.some((item) => item.id === settings.voice) ? settings.voice : 'af_heart';
    voice.value = [...voice.options].some((option) => option.value === wanted) ? wanted : voice.options[0]?.value || '';
  }
  $('#tydk-speed').value = String(settings.speechRate ?? 1);
  $('#tydk-speed-label').textContent = `${Number(settings.speechRate ?? 1).toFixed(2)}×`;
  $('#tydk-highlight-enabled').checked = settings.highlightEnabled !== false;
  $('#tydk-highlight-mode').value = settings.highlightMode || 'word';
  $('#tydk-highlight-style').value = settings.highlightStyle || 'background';
  $('#tydk-highlight-color').value = settings.highlightColor || '#FF8066';
  $('#tydk-highlight-padding').value = String(settings.highlightPadding ?? 6);
  $('#tydk-highlight-radius').value = String(settings.highlightRadius ?? 8);
  updateHighlightPreviewStyle();
  $('#tydk-full-auto').checked = settings.fullAutoEnabled === true;
  $('#tydk-auto-generation').checked = settings.autoGenerationEnabled === true;
  $('#tydk-auto-publish').checked = settings.autoPublishEnabled === true;
  $('#tydk-posts-per-day').value = settings.postsPerDay || 1;
  $('#tydk-prepare-days').value = settings.prepareAheadDays || 3;
  $('#tydk-max-scripts').value = settings.maxScriptsPerDay || 3;
  $('#tydk-facebook-adapter').value = settings.facebookAdapter || 'mock';
  $('#tydk-page-id').value = settings.facebookPageId || '';
  const autoState = $('#tydk-auto-state');
  const autoEnabled = settings.fullAutoEnabled === true || settings.autoGenerationEnabled === true || settings.autoPublishEnabled === true;
  if (autoState) {
    autoState.textContent = autoEnabled ? 'Đang bật' : 'Đang tắt';
    autoState.className = `state-pill ${autoEnabled ? 'ok' : 'neutral'}`;
  }
  const page = state.page || {};
  $('#tydk-page-status').textContent = page.verified
    ? `Đã xác minh · ${page.pageName || page.pageId} · token ${page.tokenSaved ? 'đã lưu' : 'thiếu'}`
    : `Chưa xác minh · token ${page.tokenSaved ? 'đã lưu' : 'chưa lưu'}`;
  const serviceStatus = $('#tydk-service-status');
  if (serviceStatus) {
    serviceStatus.textContent = `${state.chatgpt?.connected ? 'ChatGPT đã kết nối' : 'ChatGPT chưa kết nối'} · ${state.kokoro?.installed ? 'Kokoro sẵn sàng' : 'Kokoro chưa sẵn sàng'}`;
    serviceStatus.className = `vieneu-note ${(state.chatgpt?.connected && state.kokoro?.installed) ? '' : 'is-warning'}`.trim();
  }
  if ($('#background-effect-language')?.value === CONTENT_ID) syncThingsEffectProfile();
}

function syncThingsEffectProfile() {
  if ($('#background-effect-language')?.value !== CONTENT_ID || !state.settings) return;
  const selector = $('#background-effect');
  if (!selector) return;
  const effect = state.settings.backgroundEffect || 'bubbles';
  if ([...selector.options].some((option) => option.value === effect)) selector.value = effect;
  window.thingsYouDidntKnow?.syncEffectPreview?.();
}

async function loadStatus() {
  if (state.loading) return state.loading;
  state.loading = (async () => {
    const result = await api('/status');
    state.page = result.facebookPage;
    state.chatgpt = result.chatgpt;
    state.kokoro = result.kokoro;
    state.voices = result.voices || [];
    state.backgroundEffects = result.backgroundEffects || [];
    state.design = result.design;
    if (!state.dirty) fillSettings(result.settings || {}, result.voices || []);
    return result;
  })();
  try { return await state.loading; }
  finally { state.loading = null; }
}

function readSettingsForm() {
  return {
    voice: $('#tydk-voice').value,
    speechRate: Number($('#tydk-speed').value),
    highlightEnabled: $('#tydk-highlight-enabled').checked,
    highlightMode: $('#tydk-highlight-mode').value,
    highlightStyle: $('#tydk-highlight-style').value,
    highlightColor: $('#tydk-highlight-color').value,
    highlightPadding: Number($('#tydk-highlight-padding').value),
    highlightRadius: Number($('#tydk-highlight-radius').value),
    backgroundEffect: $('#background-effect-language')?.value === CONTENT_ID
      ? $('#background-effect').value : state.settings?.backgroundEffect || 'bubbles',
    backgroundEffectDensity: Number(state.settings?.backgroundEffectDensity ?? 28),
    backgroundEffectSpeed: Number(state.settings?.backgroundEffectSpeed ?? 58),
    backgroundEffectOpacity: Number(state.settings?.backgroundEffectOpacity ?? 32),
    facebookAdapter: $('#tydk-facebook-adapter').value,
    fullAutoEnabled: $('#tydk-full-auto').checked,
    autoGenerationEnabled: $('#tydk-auto-generation').checked,
    autoPublishEnabled: $('#tydk-auto-publish').checked,
    postsPerDay: Number($('#tydk-posts-per-day').value),
    prepareAheadDays: Number($('#tydk-prepare-days').value),
    maxScriptsPerDay: Number($('#tydk-max-scripts').value)
  };
}

function markDirty() {
  state.dirty = true;
  const status = $('#tydk-settings-status');
  if (status) { status.textContent = 'Có thay đổi chưa lưu.'; status.classList.remove('error'); }
}

async function saveSettings({ throwOnError = false } = {}) {
  const button = $('#tydk-save-settings');
  const status = $('#tydk-settings-status');
  if (button) button.disabled = true;
  try {
    const result = await api('/settings', { method: 'PUT', body: JSON.stringify(readSettingsForm()) });
    state.settings = result.settings;
    state.dirty = false;
    fillSettings(result.settings, state.voices || []);
    if (status) { status.textContent = 'Cài đặt Things You Didn\'t Know đã lưu.'; status.classList.remove('error'); }
    return result.settings;
  } catch (error) {
    if (status) { status.textContent = error.message; status.classList.add('error'); }
    if (throwOnError) throw error;
    window.toast?.('Không lưu được cài đặt Things You Didn\'t Know', true, error.message);
    return null;
  } finally { if (button) button.disabled = false; }
}

function createPayload() {
  const status = $('#tydk-create-status');
  if (!state.settings) throw new Error('Đang tải cài đặt Things You Didn\'t Know. Hãy thử lại sau giây lát.');
  if (!state.chatgpt?.connected) throw new Error('Hãy kết nối ChatGPT Plan trong mục Kết nối & cài đặt trước.');
  if (!state.kokoro?.installed) throw new Error('Kokoro chưa sẵn sàng. Kiểm tra cài đặt giọng local trước khi tạo Reel.');
  if (status) { status.textContent = 'Đang thêm đúng một Reel vào hàng đợi riêng…'; status.classList.remove('error'); }
  return { countryId: null, themeId: null };
}

function statusLabel(content) {
  if (content.sourceStatus === 'human-reviewed' && content.videoPath) return 'Ready · source reviewed';
  if (content.videoPath) return 'Needs source review';
  return content.status || 'processing';
}

function scheduleForContent(id) {
  const date = $(`[data-tydk-time="${CSS.escape(id)}"]`);
  return date?.value ? new Date(date.value).toISOString() : '';
}

function contentCard(content) {
  const schedule = state.schedules.find((item) => item.contentId === content.id && item.status !== 'cancelled');
  const job = state.jobs.find((item) => item.id === content.jobId);
  const date = new Date(content.createdAt);
  const canReview = content.sourceStatus !== 'human-reviewed' && (content.sources || []).length > 0;
  const canSchedule = content.videoPath && content.sourceStatus === 'human-reviewed' && !schedule;
  const jobRunning = ['pending', 'running'].includes(job?.status);
  const scheduleActive = ['scheduled', 'publishing'].includes(schedule?.status);
  const canDelete = !jobRunning && !scheduleActive;
  const status = job?.status === 'failed' ? 'Thất bại'
    : ['pending', 'running'].includes(job?.status) ? jobStatusLabel(job)
      : content.videoPath ? content.sourceStatus === 'human-reviewed' ? 'Sẵn sàng' : 'Chờ duyệt nguồn'
        : content.status || 'Đang xử lý';
  const statusClass = job?.status === 'failed' ? 'error'
    : ['pending', 'running'].includes(job?.status) ? 'neutral'
      : content.videoPath && content.sourceStatus === 'human-reviewed' ? 'ok' : 'warn';
  const thumbnail = content.thumbnailPath
    ? `<img src="${API}/files/${encodeURIComponent(content.id)}/thumbnail" alt="${escapeHtml(content.thumbnailHeadline)}" loading="lazy" />`
    : `<span class="video-placeholder">${escapeHtml(content.title)}<small>${escapeHtml(job?.lastError || (job?.status === 'running' ? 'Đang render…' : 'Chưa có thumbnail'))}</small></span>`;
  const videoLink = content.videoPath ? `${API}/files/${encodeURIComponent(content.id)}/video` : '#';
  const scheduleForm = canSchedule ? `<div class="tydk-row-schedule" data-tydk-schedule-form="${escapeHtml(content.id)}" hidden><input type="datetime-local" data-tydk-time="${escapeHtml(content.id)}" aria-label="Ngày giờ đăng" /><button class="mini-action" data-tydk-schedule="${escapeHtml(content.id)}">Xác nhận lịch</button></div>` : '';
  const scheduleStatus = schedule ? `<small class="tydk-row-schedule-status">Lịch ${escapeHtml(schedule.status)} · ${escapeHtml(new Date(schedule.scheduledAt).toLocaleString('vi-VN'))}${schedule.facebookError ? ` · ${escapeHtml(schedule.facebookError)}` : ''}</small>` : '';
  const actions = [
    canReview ? `<button class="mini-action" data-tydk-approve="${escapeHtml(content.id)}">Duyệt nguồn</button>` : '',
    `<button class="mini-action" data-tydk-script="${escapeHtml(content.id)}">Kịch bản</button>`,
    `<button class="mini-action" data-tydk-copy="${escapeHtml(content.id)}">Lưu caption</button>`,
    job?.status === 'failed' ? `<button class="mini-action" data-tydk-retry-job="${escapeHtml(job.id)}">Render lại</button>` : '',
    canSchedule ? `<button class="mini-action" data-tydk-toggle-schedule="${escapeHtml(content.id)}">Lên lịch</button>` : '',
    content.videoPath ? `<a class="mini-action" href="${videoLink}" download="things-${escapeHtml(content.id)}.mp4">MP4 ↓</a>` : '',
    content.audioPath ? `<a class="mini-action" href="${API}/files/${encodeURIComponent(content.id)}/audio" download="things-${escapeHtml(content.id)}.wav">Audio ↓</a>` : '',
    `<button class="mini-action danger-action" data-tydk-delete="${escapeHtml(content.id)}" ${canDelete ? '' : `disabled title="${jobRunning ? 'Đợi job tạo Reel kết thúc trước khi xóa.' : 'Hủy lịch đăng đang hoạt động trước khi xóa Reel.'}"`}>Xóa</button>`
  ].filter(Boolean).join('');
  return `<article class="library-row tydk-library-row" data-tydk-content="${escapeHtml(content.id)}" data-created-at="${escapeHtml(content.createdAt)}">
    <a class="video-thumb" href="${videoLink}" ${content.videoPath ? 'target="_blank" rel="noopener"' : 'aria-disabled="true"'}>${thumbnail}<span class="video-badge">${escapeHtml(status)}</span></a>
    <div class="library-main"><h3>${escapeHtml(content.title)}</h3><p class="library-caption">${escapeHtml(content.caption)}</p><div class="row-meta"><span>Things You Didn't Know · ${escapeHtml(content.country)}</span><span>•</span><span>${escapeHtml(content.theme)}</span><span>•</span><span>${Number.isFinite(date.getTime()) ? escapeHtml(date.toLocaleDateString('vi-VN')) : '—'}</span><span>•</span><span>${escapeHtml(content.durationSeconds ? `${Number(content.durationSeconds).toFixed(1)} giây` : 'Kokoro')}</span></div>
      ${thingsPipelineMarkup(job, content)}${job?.lastError ? `<p class="pipeline-error">${escapeHtml(job.lastError)}</p>` : ''}${scheduleStatus}${scheduleForm}
    </div><span class="state-pill ${statusClass}">${escapeHtml(status)}</span><div class="row-actions">${actions}</div>
  </article>`;
}

function openThingsScript(contentId) {
  const content = state.contents.find((item) => item.id === contentId);
  const dialog = $('#detail-dialog');
  const target = $('#dialog-content');
  if (!content || !dialog || !target) return;

  const sourceLinks = (content.sources || []).map((source) => {
    let href = '';
    try {
      const url = new URL(source.url);
      if (url.protocol === 'http:' || url.protocol === 'https:') href = escapeHtml(url.href);
    } catch { /* Keep invalid source URLs as plain text. */ }
    const label = escapeHtml(source.title || source.publisher || source.url || 'Nguồn tham khảo');
    const title = href
      ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : label;
    return `<li>${title}<small>${escapeHtml(source.retrievalStatus || 'Chưa kiểm tra')}</small></li>`;
  }).join('');
  const hashtags = (content.hashtags || []).map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ');
  const sourceNote = content.sourceReviewNote || 'Cần tự xem xét nguồn trước khi lên lịch.';
  const summary = content.factText || content.narration || '';
  const sourceMeta = content.sources?.length ? `${content.sources.length} nguồn tham khảo` : 'Chưa lưu nguồn tham khảo';

  target.innerHTML = `<article class="script-detail tydk-script-detail">
    <div class="eyebrow">Things You Didn't Know · ${escapeHtml(content.country)} · ${escapeHtml(content.theme)}</div>
    <h2>${escapeHtml(content.title)}</h2>
    <p>${escapeHtml(summary)} · ${escapeHtml(sourceMeta)}</p>
    <div class="dialog-lines"><div class="dialog-line"><span class="line-num">LỜI ĐỌC</span><p class="en-line">${escapeHtml(content.narration || content.factText || '')}</p></div></div>
    <div class="dialog-caption"><strong>Caption</strong><br>${escapeHtml(content.caption || '')}${hashtags ? `<br><br>${escapeHtml(hashtags)}` : ''}
      <div class="tydk-dialog-sources"><strong>Nguồn tham khảo</strong><ul>${sourceLinks || '<li>Chưa lưu nguồn.</li>'}</ul><small>${escapeHtml(sourceNote)}</small></div>
    </div>
  </article>`;
  if (!dialog.open) dialog.showModal();
}

const JOB_PHASE_TO_STEP = {
  'fact-selection': 'script', 'source-check': 'script',
  'voice-generation': 'voice', 'timing-alignment': 'voice',
  'video-render': 'render', 'thumbnail-render': 'complete', 'saved-to-library': 'complete'
};
const JOB_PHASE_LABELS = {
  'fact-selection': 'Chọn nội dung', 'source-check': 'Kiểm tra nguồn',
  'voice-generation': 'Tạo giọng đọc', 'timing-alignment': 'Căn timing',
  'video-render': 'Render video', 'thumbnail-render': 'Render thumbnail', 'saved-to-library': 'Lưu thư viện'
};
const LIBRARY_STEPS = [['script', 'Kịch bản'], ['voice', 'Giọng đọc'], ['render', 'Render video'], ['complete', 'Hoàn tất']];

function jobStatusLabel(job) {
  return ({ pending: 'Đang chờ', running: 'Đang xử lý', complete: 'Hoàn tất', failed: 'Thất bại' })[job?.status] || job?.status || 'Chưa rõ';
}

function jobPhase(job) {
  if (!job) return '';
  if (job.progress?.failedPhase) return job.progress.failedPhase;
  if (job.progress?.phase && job.progress.phase !== 'failed') return job.progress.phase;
  if (job.status === 'failed') {
    return state.activity.find((item) => item.job_id === job.id && Object.hasOwn(JOB_PHASE_TO_STEP, item.stage))?.stage || '';
  }
  return '';
}

function thingsPipelineMarkup(job, content) {
  const phase = jobPhase(job);
  const activeStep = JOB_PHASE_TO_STEP[phase] || (job?.status === 'running' || job?.status === 'pending' ? 'script' : '');
  const failed = job?.status === 'failed';
  const completed = job?.status === 'complete' || (!job && Boolean(content?.videoPath && content?.thumbnailPath));
  const activeIndex = LIBRARY_STEPS.findIndex(([key]) => key === activeStep);
  const steps = LIBRARY_STEPS.map(([key, label], index) => {
    const status = failed && key === activeStep ? 'error'
      : completed || (activeIndex >= 0 && index < activeIndex) ? 'done'
        : key === activeStep && !failed ? 'active' : '';
    return `<div class="pipeline-step ${status}" title="${label}"><span class="pipeline-light"></span><span>${label}</span></div>`;
  }).join('');
  return `<div class="video-pipeline" aria-label="Tiến trình tạo video">${steps}</div>`;
}

function jobCard(job) {
  const progress = job.progress || {};
  const country = job.payload?.country || 'Things You Didn\'t Know';
  const theme = job.payload?.theme || '';
  const createdAt = new Date(job.createdAt);
  const updatedAt = new Date(job.updatedAt);
  const dateText = Number.isFinite(createdAt.getTime()) ? createdAt.toLocaleDateString('vi-VN') : '—';
  const attempt = progress.attempt && progress.maxAttempts ? ` · Lần chọn ${progress.attempt}/${progress.maxAttempts}` : '';
  const phaseText = job.status === 'failed' ? `Lỗi tại bước: ${JOB_PHASE_LABELS[jobPhase(job)] || 'pipeline'}${attempt}`
    : job.status === 'complete' ? 'Đã render và lưu vào thư viện'
      : job.status === 'pending' ? 'Đang chờ worker'
        : `Đang thực hiện: ${JOB_PHASE_LABELS[jobPhase(job)] || 'Kịch bản'}${attempt}`;
  const status = jobStatusLabel(job);
  const statusClass = job.status === 'failed' ? 'error' : job.status === 'complete' ? 'ok' : 'neutral';
  const placeholder = `<span class="video-placeholder">Reel ${escapeHtml(country)}<small>${escapeHtml(job.status === 'failed' ? 'Chưa hoàn tất render' : phaseText)}</small></span>`;
  const error = job.lastError ? `<p class="pipeline-error">${escapeHtml(job.lastError)}</p>` : '';
  const details = `<details class="tydk-row-details" data-tydk-job-details="${escapeHtml(job.id)}"><summary>Chi tiết job</summary><p>Job ID: ${escapeHtml(job.id)}</p><p>Chủ đề: ${escapeHtml(theme || 'AI tự chọn')}</p><p>Số lần chạy: ${Number(job.attempts) || 0}${escapeHtml(attempt)}</p><p>Cập nhật: ${Number.isFinite(updatedAt.getTime()) ? escapeHtml(updatedAt.toLocaleString('vi-VN')) : '—'}</p></details>`;
  const actions = `${job.status === 'failed' ? `<button class="mini-action" data-tydk-retry-job="${escapeHtml(job.id)}">Render lại</button>` : ''}<button class="mini-action" data-tydk-toggle-job-details="${escapeHtml(job.id)}">Chi tiết</button>`;
  return `<article class="library-row tydk-library-row" data-tydk-job="${escapeHtml(job.id)}" data-created-at="${escapeHtml(job.createdAt)}"><div class="video-thumb">${placeholder}<span class="video-badge">${escapeHtml(status)}</span></div><div class="library-main"><h3>Reel ${escapeHtml(country)}</h3><p class="library-caption">${escapeHtml(theme || 'Things You Didn\'t Know')} · Job ${escapeHtml(job.id.slice(0, 8))}</p><div class="row-meta"><span>Things You Didn't Know · ${escapeHtml(country)}</span><span>•</span><span>${escapeHtml(theme || 'AI tự chọn')}</span><span>•</span><span>${escapeHtml(dateText)}</span></div><div class="tydk-job-phase">${escapeHtml(phaseText)}</div>${thingsPipelineMarkup(job, null)}${error}${details}</div><span class="state-pill ${statusClass}">${escapeHtml(status)}</span><div class="row-actions">${actions}</div></article>`;
}

function thingsLibraryRows(contents) {
  const visibleContentJobs = new Set(contents.map((content) => content.jobId).filter(Boolean));
  const jobRows = state.jobs.filter((job) => !visibleContentJobs.has(job.id)
    && (!state.contents.some((content) => content.jobId === job.id) || ['pending', 'running', 'failed'].includes(job.status)))
    .map((job) => ({ date: Date.parse(job.createdAt) || 0, html: jobCard(job) }));
  const contentRows = contents.map((content) => ({ date: Date.parse(content.createdAt) || 0, html: contentCard(content) }));
  return [...jobRows, ...contentRows].sort((left, right) => right.date - left.date).map((item) => item.html);
}

function filteredContents() {
  const filter = $('.filter-tab.active')?.dataset.filter || 'all';
  const assigned = new Set(state.schedules.filter((item) => item.status !== 'cancelled').map((item) => item.contentId));
  return state.contents.filter((item) => {
    if (item.status === 'deleted') return false;
    if (filter === 'ready') return item.videoPath && item.sourceStatus === 'human-reviewed';
    if (filter === 'scheduled') return state.schedules.some((schedule) => schedule.contentId === item.id && ['scheduled', 'publishing'].includes(schedule.status));
    if (filter === 'published') return state.schedules.some((schedule) => schedule.contentId === item.id && schedule.status === 'published');
    if (filter === 'failed') return item.status === 'failed' || state.schedules.some((schedule) => schedule.contentId === item.id && ['failed', 'uncertain'].includes(schedule.status));
    return true;
  });
}

function renderLibrary() {
  const list = $('#library-list');
  if (!list) return;
  const language = $('#content-language-filter')?.value || 'all';
  const contents = filteredContents();
  list.querySelectorAll('.tydk-job-history, .tydk-video-card, .tydk-library-row').forEach((node) => node.remove());
  if (language === CONTENT_ID) {
    const rows = thingsLibraryRows(contents);
    list.innerHTML = rows.length ? rows.join('')
      : '<div class="empty-state"><strong>Chưa có Reel trong mục này</strong>Chọn Things You Didn\'t Know ở trang Tổng quan rồi nhấn Tạo video mới.</div>';
    $('#video-count').textContent = `${contents.length} VIDEO`;
    return;
  }
  if (language !== 'all') return;
  const standardCount = list.querySelectorAll('.library-row:not(.tydk-library-row)').length;
  const rows = thingsLibraryRows(contents);
  if (rows.length) {
    if (!standardCount) list.querySelector('.empty-state')?.remove();
    list.querySelector('.empty-state')?.remove();
    list.insertAdjacentHTML('beforeend', rows.join(''));
  }
  const count = standardCount + contents.length;
  $('#video-count').textContent = `${count} VIDEO`;
}

function renderSchedules() {
  let list = $('#things-schedule-list');
  if (!list) {
    list = document.createElement('div');
    list.className = 'tydk-schedule-items';
    list.id = 'things-schedule-list';
    $('#schedule-list')?.append(list);
  }
  if (!$('#schedule-list')) return;
  const visibleSchedules = state.schedules.filter((schedule) => !['cancelled', 'published'].includes(schedule.status));
  list.innerHTML = visibleSchedules.length ? visibleSchedules.map((schedule) => {
    const content = state.contents.find((item) => item.id === schedule.contentId);
    const canCancel = ['scheduled', 'publishing'].includes(schedule.status);
    const canRetry = schedule.status === 'failed';
    const date = new Date(schedule.scheduledAt);
    const validDate = Number.isFinite(date.getTime());
    return `<article class="schedule-row${['failed', 'uncertain'].includes(schedule.status) ? ' failed' : ''}"><span class="schedule-date">${validDate ? escapeHtml(date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', month: 'short', day: 'numeric' })) : '—'}</span><div class="schedule-copy"><strong>${escapeHtml(content?.title || schedule.contentId)}</strong><small>Things You Didn't Know · ${escapeHtml(content?.country || '')} · ${escapeHtml(schedule.status)} · ${escapeHtml(schedule.facebookState)} · ${escapeHtml(schedule.adapter)}</small>${schedule.facebookError ? `<small class="schedule-error">${escapeHtml(schedule.facebookError)}</small>` : ''}</div><div class="schedule-time-actions"><span class="schedule-time">${validDate ? escapeHtml(date.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })) : ''}</span>${canRetry ? `<button class="button button-outline button-small" data-tydk-retry-schedule="${escapeHtml(schedule.id)}">Thử lại</button>` : ''}${canCancel ? `<button class="mini-action danger-action" data-tydk-cancel-schedule="${escapeHtml(schedule.id)}">Hủy lịch</button>` : ''}</div></article>`;
  }).join('') : '<div class="empty-state"><strong>Chưa có lịch đăng Things You Didn\'t Know</strong>Lịch của nội dung này sẽ xuất hiện trong danh sách lịch hiện tại.</div>';
  syncScheduleListProfile();
  renderPublishedSchedules();
}

function renderPublishedSchedules() {
  const parent = $('#published-list');
  if (!parent) return;
  parent.querySelector('#things-published-schedule-list')?.remove();
  const published = state.schedules.filter((schedule) => schedule.status === 'published');
  if (!published.length) return;
  const wrapper = document.createElement('div');
  wrapper.id = 'things-published-schedule-list';
  wrapper.className = 'tydk-published-schedule-items';
  wrapper.innerHTML = published.map((schedule) => {
    const content = state.contents.find((item) => item.id === schedule.contentId);
    return `<article class="schedule-row published-row"><span class="schedule-date">Đã đăng</span><div class="schedule-copy"><strong>${escapeHtml(content?.title || schedule.contentId)}</strong><small>${escapeHtml(content?.country || '')} · Things You Didn't Know · Facebook xác nhận ${escapeHtml(new Date(schedule.scheduledAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }))}</small></div></article>`;
  }).join('');
  parent.append(wrapper);
}

function renderActivity() {
  const list = $('#logs-list');
  if (!list) return;
  list.querySelectorAll('.things-log-row').forEach((node) => node.remove());
  if (!state.activity.length) return;
  list.querySelector('.empty-state')?.remove();
  list.insertAdjacentHTML('beforeend', state.activity.slice(0, 80).map((item) => `<div class="log-row things-log-row"><span>${escapeHtml(new Date(item.created_at).toLocaleString())}</span><span class="log-level INFO">INFO</span><strong>${escapeHtml(item.code || 'TYDK')}</strong><span>${escapeHtml(item.message)}</span></div>`).join(''));
}

function syncScheduleListProfile() {
  const parent = $('#schedule-list');
  const ownList = $('#things-schedule-list');
  if (!parent || !ownList) return;
  const active = $('#schedule-content-profile')?.value === CONTENT_ID;
  for (const child of parent.children) if (child !== ownList) child.hidden = active;
  ownList.hidden = !active;
}

async function loadContents() {
  try {
    const [contents, schedules, jobs, activity] = await Promise.all([api('/contents'), api('/schedules'), api('/jobs?limit=500'), api('/activity')]);
    state.contents = contents.contents || [];
    state.schedules = schedules.schedules || [];
    state.jobs = jobs.jobs || [];
    state.activity = activity.activity || [];
    renderLibrary();
    renderSchedules();
    renderActivity();
    if (state.jobs.some((job) => ['pending', 'running'].includes(job.status))) schedulePoll();
  } catch (error) {
    const status = $('#tydk-create-status');
    if (status) { status.textContent = error.message; status.classList.add('error'); }
  }
}

let pollTimer = null;
function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void loadContents(), 2200);
}

async function savePage() {
  const status = $('#tydk-page-status');
  try {
    const result = await api('/facebook-page', { method: 'PUT', body: JSON.stringify({ pageId: $('#tydk-page-id').value.trim(), accessToken: $('#tydk-page-token').value.trim() }) });
    $('#tydk-page-token').value = '';
    state.page = result.page;
    status.textContent = `Page ${result.page.pageId || ''} đã lưu · token ${result.page.tokenSaved ? 'đã lưu' : 'chưa lưu'} · cần xác minh.`;
    await loadStatus();
  } catch (error) { status.textContent = error.message; }
}

async function verifyPage() {
  const status = $('#tydk-page-status');
  status.textContent = 'Đang xác minh Page Things You Didn\'t Know…';
  try {
    const result = await api('/facebook-page/verify', { method: 'POST', body: '{}' });
    state.page = result.page;
    status.textContent = `Đã xác minh · ${result.page.pageName || result.page.pageId}`;
    await loadStatus();
  } catch (error) { status.textContent = error.message; }
}

async function previewVoice() {
  const button = $('#tydk-preview-voice');
  const audio = $('#tydk-preview-audio');
  button.disabled = true;
  try {
    const result = await api('/voices/preview', { method: 'POST', body: JSON.stringify({ voice: $('#tydk-voice').value, speed: Number($('#tydk-speed').value), highlightMode: $('#tydk-highlight-mode').value }) });
    audio.src = result.url;
    audio.hidden = false;
    await audio.play();
  } catch (error) { $('#tydk-settings-status').textContent = error.message; $('#tydk-settings-status').classList.add('error'); }
  finally { button.disabled = false; }
}

let highlightPreviewAudio = null;
let highlightPreviewFrame = null;
function updateHighlightPreviewStyle() {
  const preview = $('#tydk-highlight-preview-words');
  if (!preview) return;
  const textColorOnly = $('#tydk-highlight-style').value === 'text-color';
  preview.dataset.highlightStyle = textColorOnly ? 'text-color' : 'background';
  preview.style.setProperty('--highlight-color', $('#tydk-highlight-color').value || '#00C9B7');
  preview.style.setProperty('--highlight-padding', `${Number($('#tydk-highlight-padding').value) || 0}px`);
  preview.style.setProperty('--highlight-radius', `${Number($('#tydk-highlight-radius').value) || 0}px`);
  $('#tydk-highlight-color-label').textContent = textColorOnly ? 'Màu chữ đang đọc' : 'Màu highlight';
  $('#tydk-highlight-padding').closest('label').hidden = textColorOnly;
  $('#tydk-highlight-radius').closest('label').hidden = textColorOnly;
}

async function previewHighlight() {
  const button = $('#tydk-highlight-preview-play');
  const status = $('#tydk-highlight-preview-status');
  const text = $('#tydk-highlight-preview-source').value.trim();
  button.disabled = true;
  status.textContent = 'Đang tạo audio và căn timing…';
  try {
    const result = await api('/voices/preview', { method: 'POST', body: JSON.stringify({
      text, voice: $('#tydk-voice').value, speed: Number($('#tydk-speed').value), highlightMode: $('#tydk-highlight-mode').value
    }) });
    const host = $('#tydk-highlight-preview-words');
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
    highlightPreviewAudio?.pause();
    if (highlightPreviewFrame) cancelAnimationFrame(highlightPreviewFrame);
    const audio = new Audio(new URL(result.url, location.href));
    highlightPreviewAudio = audio;
    const intervals = $('#tydk-highlight-enabled').checked ? result.highlightIntervals || [] : [];
    const sync = () => {
      const time = audio.currentTime;
      const active = intervals.find((item) => time >= item.startSeconds && time < item.endSeconds);
      const activeIds = new Set(active?.tokenIds || []);
      for (const [id, span] of spans) span.classList.toggle('is-active', activeIds.has(id));
      if (!audio.paused && !audio.ended) highlightPreviewFrame = requestAnimationFrame(sync);
    };
    audio.addEventListener('play', sync);
    audio.addEventListener('pause', () => { if (highlightPreviewFrame) cancelAnimationFrame(highlightPreviewFrame); });
    audio.addEventListener('ended', () => { if (highlightPreviewFrame) cancelAnimationFrame(highlightPreviewFrame); for (const span of spans.values()) span.classList.remove('is-active'); });
    await audio.play();
    status.textContent = result.alignment?.reliable
      ? `Đang nghe thử · ${result.voice} · ${result.wordTimings?.length || 0} mốc từ`
      : `Audio đã tạo, nhưng timing chưa đủ tin cậy để tô chữ.${result.warning ? ` ${result.warning}` : ''}`;
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
}

async function onLibraryClick(event) {
  const scriptButton = event.target.closest('[data-tydk-script]');
  if (scriptButton) {
    openThingsScript(scriptButton.dataset.tydkScript);
    return;
  }
  const scheduleToggle = event.target.closest('[data-tydk-toggle-schedule]');
  if (scheduleToggle) {
    const form = $(`[data-tydk-schedule-form="${CSS.escape(scheduleToggle.dataset.tydkToggleSchedule)}"]`, scheduleToggle.closest('.tydk-library-row'));
    if (form) form.hidden = !form.hidden;
    return;
  }
  const jobDetailsToggle = event.target.closest('[data-tydk-toggle-job-details]');
  if (jobDetailsToggle) {
    const details = $(`[data-tydk-job-details="${CSS.escape(jobDetailsToggle.dataset.tydkToggleJobDetails)}"]`, jobDetailsToggle.closest('.tydk-library-row'));
    if (details) details.open = !details.open;
    return;
  }
  const approve = event.target.closest('[data-tydk-approve]');
  const schedule = event.target.closest('[data-tydk-schedule]');
  const retry = event.target.closest('[data-tydk-retry-job]');
  const cancel = event.target.closest('[data-tydk-cancel-schedule]');
  const retrySchedule = event.target.closest('[data-tydk-retry-schedule]');
  const copy = event.target.closest('[data-tydk-copy]');
  const deleteButton = event.target.closest('[data-tydk-delete]');
  try {
    if (deleteButton) {
      const content = state.contents.find((item) => item.id === deleteButton.dataset.tydkDelete);
      const title = content?.title || deleteButton.closest('.tydk-library-row')?.querySelector('h3')?.textContent || 'Reel Things You Didn\'t Know';
      const confirmed = window.confirm(`Xóa “${title}” khỏi thư viện và máy tính? MP4, thumbnail, audio và timing sẽ bị xóa. Fact, kịch bản và lịch sử chống trùng được giữ lại. Nội dung đã gửi lên Facebook sẽ không bị gỡ. Tiếp tục?`);
      if (!confirmed) return;
      deleteButton.disabled = true;
      const result = await api(`/contents/${encodeURIComponent(deleteButton.dataset.tydkDelete)}`, { method: 'DELETE' });
      const warningCount = Array.isArray(result.cleanupWarnings) ? result.cleanupWarnings.length : 0;
      window.toast?.(warningCount ? 'Đã ẩn Reel nhưng còn tệp chưa dọn được' : 'Đã xóa Reel khỏi thư viện và giữ lịch sử chống trùng', warningCount > 0);
    }
    if (approve) await api(`/contents/${encodeURIComponent(approve.dataset.tydkApprove)}/approve-sources`, { method: 'POST', body: JSON.stringify({ note: 'Nguồn và fact đã được người dùng xem xét.' }) });
    if (schedule) {
      const scheduledAt = scheduleForContent(schedule.dataset.tydkSchedule);
      if (!scheduledAt) throw new Error('Chọn ngày giờ đăng trước.');
      await api(`/contents/${encodeURIComponent(schedule.dataset.tydkSchedule)}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt, adapter: state.settings?.facebookAdapter || 'mock' }) });
    }
    if (retry) await api(`/jobs/${encodeURIComponent(retry.dataset.tydkRetryJob)}/retry`, { method: 'POST', body: '{}' });
    if (cancel) await api(`/schedules/${encodeURIComponent(cancel.dataset.tydkCancelSchedule)}`, { method: 'DELETE' });
    if (retrySchedule) await api(`/schedules/${encodeURIComponent(retrySchedule.dataset.tydkRetrySchedule)}/retry`, { method: 'POST', body: '{}' });
    if (copy) {
      const content = state.contents.find((item) => item.id === copy.dataset.tydkCopy);
      await navigator.clipboard.writeText(`${content?.caption || ''}\n\n${(content?.hashtags || []).join(' ')}`);
      window.toast?.('Đã sao chép caption', false, 'Caption và hashtag đã được đưa vào clipboard.');
    }
    await loadContents();
  } catch (error) {
    if (deleteButton) deleteButton.disabled = false;
    window.toast?.('Thao tác Things You Didn\'t Know thất bại', true, error.message);
  }
}

window.thingsYouDidntKnow = {
  createPayload,
  hasPendingSettings: () => state.dirty,
  saveSettings,
  syncFacebookSettingsProfile: () => {},
  setHighlightProfileActive: (active) => { state.highlightProfileActive = active === true; syncSettingsVisibility(); },
  setFacebookProfileActive: (active) => { state.facebookProfileActive = active === true; syncSettingsVisibility(); },
  syncEffectPreview: () => {
    const frame = $('#background-effect-preview-frame');
    if (!frame?.contentWindow) return;
    const settings = state.settings || {};
    frame.contentWindow.postMessage({
      type: 'background-effect-preview:set-effect', effectId: $('#background-effect')?.value || settings.backgroundEffect || 'bubbles',
      density: Number(settings.backgroundEffectDensity ?? 28), speed: Number(settings.backgroundEffectSpeed ?? 58),
      opacity: Number(settings.backgroundEffectOpacity ?? 32), language: 'en'
    }, location.origin);
  },
  applyEffectPreviewChange: (message) => {
    const fields = {
      'background-effect-preview:change-density': ['backgroundEffectDensity', 'density', 10, 60],
      'background-effect-preview:change-speed': ['backgroundEffectSpeed', 'speed', 25, 140],
      'background-effect-preview:change-opacity': ['backgroundEffectOpacity', 'opacity', 10, 70]
    };
    const field = fields[message?.type];
    if (!field || !state.settings) return false;
    const [key, messageKey, min, max] = field;
    const value = Number(message[messageKey]);
    if (!Number.isInteger(value) || value < min || value > max) return false;
    state.settings[key] = value;
    markDirty();
    window.thingsYouDidntKnow?.syncEffectPreview?.();
    return true;
  },
  isModeActive: () => $('#content-language')?.value === CONTENT_ID
};

mount();
$('#content-language')?.addEventListener('change', () => setMode($('#content-language').value === CONTENT_ID));
window.addEventListener('things-you-didnt-know-mode-change', (event) => setMode(event.detail?.active === true));
$('#content-language-filter')?.addEventListener('change', () => { renderLibrary(); void loadContents(); });
window.addEventListener('library:rendered', renderLibrary);
window.addEventListener('schedules:rendered', renderSchedules);
window.addEventListener('logs:rendered', renderActivity);
$('.filter-tabs')?.addEventListener('click', () => setTimeout(renderLibrary, 0));
$('#library-list')?.addEventListener('click', onLibraryClick);
$('#tydk-save-settings')?.addEventListener('click', () => void saveSettings());
document.addEventListener('input', (event) => {
  const target = event.target;
  if (!target?.closest('[data-things-you-didnt-know-settings]')) return;
  if (target.id === 'tydk-speed') $('#tydk-speed-label').textContent = `${Number(target.value).toFixed(2)}×`;
  if (target.id === 'tydk-page-id' || target.id === 'tydk-page-token') {
    $('#tydk-page-status').textContent = target.id === 'tydk-page-token' ? 'Có token chưa lưu.' : 'Có thay đổi Page chưa lưu.';
    return;
  }
  if (!target.matches('input,select')) return;
  if (target.id === 'tydk-highlight-style') updateHighlightPreviewStyle();
  state.voices = state.voices || [];
  markDirty();
});
document.addEventListener('change', (event) => {
  const target = event.target;
  if (!target?.closest('[data-things-you-didnt-know-settings]') || !target.matches('input,select')) return;
  if (target.id === 'tydk-page-id' || target.id === 'tydk-page-token') return;
  markDirty();
  if (['tydk-full-auto', 'tydk-auto-generation', 'tydk-auto-publish'].includes(target.id)) {
    const enabled = $('#tydk-full-auto').checked || $('#tydk-auto-generation').checked || $('#tydk-auto-publish').checked;
    $('#tydk-auto-state').textContent = enabled ? 'Đang bật' : 'Đang tắt';
    $('#tydk-auto-state').className = `state-pill ${enabled ? 'ok' : 'neutral'}`;
  }
});
$('#background-effect')?.addEventListener('change', () => {
  if ($('#background-effect-language')?.value !== CONTENT_ID || !state.settings) return;
  state.settings.backgroundEffect = $('#background-effect').value;
  markDirty();
  window.thingsYouDidntKnow?.syncEffectPreview?.();
});
$('#tydk-save-page')?.addEventListener('click', () => void savePage());
$('#tydk-verify-page')?.addEventListener('click', () => void verifyPage());
$('#tydk-clear-token')?.addEventListener('click', async () => {
  if (!window.confirm('Xóa Page Access Token riêng của Things You Didn\'t Know?')) return;
  try { const result = await api('/facebook-page/token', { method: 'DELETE' }); state.page = result.page; await loadStatus(); }
  catch (error) { $('#tydk-page-status').textContent = error.message; }
});
$('#tydk-preview-voice')?.addEventListener('click', () => void previewVoice());
$('#tydk-highlight-preview-play')?.addEventListener('click', () => void previewHighlight());
for (const selector of ['#tydk-highlight-style', '#tydk-highlight-color', '#tydk-highlight-padding', '#tydk-highlight-radius']) {
  $(selector)?.addEventListener('input', updateHighlightPreviewStyle);
}
$('#schedule-content-profile')?.addEventListener('change', (event) => {
  renderSchedules();
  syncSettingsVisibility();
});
for (const selector of ['#background-effect-language', '#voice-highlight-content-profile', '#facebook-quick-route-language']) {
  $(selector)?.addEventListener('change', syncSettingsVisibility);
}
$('#background-effect-language')?.addEventListener('change', () => {
  if ($('#background-effect-language').value === CONTENT_ID) syncThingsEffectProfile();
});
window.addEventListener('things-you-didnt-know-voice-profile-change', (event) => {
  state.voiceProfileActive = event.detail?.active === true;
  syncSettingsVisibility();
});
$('#schedule-list')?.addEventListener('click', onLibraryClick);
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-generate]') && $('#content-language')?.value === CONTENT_ID) {
    $('#content-language').value = CONTENT_ID;
  }
});
window.addEventListener('things-you-didnt-know-job-created', (event) => {
  const status = $('#tydk-create-status');
  if (status) status.textContent = `Job ${event.detail?.job?.id || ''} đang chạy trong worker Things You Didn't Know.`;
  void loadContents();
});
void loadStatus().then(() => loadContents()).catch((error) => {
  const status = $('#tydk-service-status');
  if (status) { status.textContent = `Things API chưa sẵn sàng · ${error.message}`; status.className = 'vieneu-note is-warning'; }
});
