const API = '/api/things-you-didnt-know';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { design: null, presets: [], mode: 'content', previewUrl: null, timer: null };

async function api(route, options = {}) {
  const response = await fetch(API + route, { cache: 'no-store', ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function setStatus(message, error = false) {
  const node = $('#tydk-editor-status');
  node.textContent = message;
  node.classList.toggle('error', error);
}

function getPath(object, key) { return key.split('.').reduce((value, part) => value?.[part], object); }
function setPath(object, key, value) {
  const parts = key.split('.');
  let parent = object;
  for (const part of parts.slice(0, -1)) parent = parent[part] ||= {};
  parent[parts.at(-1)] = value;
}

function fillFields(design) {
  for (const field of $$('[data-design]')) {
    const value = getPath(design, field.dataset.design);
    if (field.type === 'checkbox') field.checked = value === true;
    else field.value = value ?? '';
  }
}

function collectDesign() {
  const design = structuredClone(state.design);
  for (const field of $$('[data-design]')) {
    let value = field.type === 'checkbox' ? field.checked : field.type === 'number' ? Number(field.value) : field.value;
    setPath(design, field.dataset.design, value);
  }
  return design;
}

async function refreshPreview() {
  const design = collectDesign();
  const response = await fetch(API + '/visual-preview.svg', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: state.mode === 'thumbnail' ? 'thumbnail' : 'content', design }), cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Preview failed (${response.status})`);
  }
  const svg = await response.text();
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  $('#tydk-design-preview').src = state.previewUrl;
}

function schedulePreview() {
  clearTimeout(state.timer);
  state.timer = setTimeout(() => refreshPreview().catch((error) => setStatus(error.message, true)), 180);
}

async function loadPresets() {
  const result = await api('/visual-design/presets');
  state.presets = result.presets || [];
  const select = $('#tydk-preset-select');
  select.innerHTML = '<option value="">Active design</option>' + state.presets.map((preset) =>
    `<option value="${preset.id}">${escapeHtml(preset.name)}${preset.isDefault ? ' · default' : ''}</option>`).join('');
  select.value = '';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function load() {
  const result = await api('/visual-design');
  state.design = result.design;
  fillFields(state.design);
  await loadPresets();
  await refreshPreview();
  setStatus('Thiết kế đang dùng được lưu riêng cho Things You Didn\'t Know.');
}

async function saveDesign() {
  try {
    const result = await api('/visual-design', { method: 'PUT', body: JSON.stringify(collectDesign()) });
    state.design = result.design;
    fillFields(state.design);
    await refreshPreview();
    setStatus('Đã lưu thiết kế đang dùng. Job đang chạy giữ nguyên snapshot lúc tạo.');
  } catch (error) { setStatus(error.message, true); }
}

async function resetDesign() {
  try {
    const result = await api('/visual-design/reset', { method: 'POST', body: '{}' });
    state.design = result.design;
    fillFields(state.design);
    await refreshPreview();
    setStatus('Đã khôi phục thiết kế mặc định riêng của Things You Didn\'t Know.');
  } catch (error) { setStatus(error.message, true); }
}

async function savePreset() {
  const name = $('#tydk-preset-name').value.trim();
  if (!name) { setStatus('Nhập tên preset trước khi lưu.', true); return; }
  try {
    const result = await api('/visual-design/presets', { method: 'POST', body: JSON.stringify({ name, design: collectDesign() }) });
    $('#tydk-preset-name').value = '';
    await loadPresets();
    if (result.preset.isDefault) {
      state.design = result.preset.design;
      fillFields(state.design);
    }
    setStatus(`Đã lưu preset “${result.preset.name}”. Chọn preset trong danh sách để đặt làm mặc định.`);
  } catch (error) { setStatus(error.message, true); }
}

async function selectPreset(id) {
  if (!id) return;
  try {
    const result = await api(`/visual-design/presets/${encodeURIComponent(id)}/select`, { method: 'POST', body: '{}' });
    state.design = result.design;
    fillFields(state.design);
    await loadPresets();
    $('#tydk-preset-select').value = id;
    await refreshPreview();
    setStatus('Đã áp dụng preset và đặt làm mặc định cho Reel tiếp theo.');
  } catch (error) { setStatus(error.message, true); }
}

function setMode(mode) {
  state.mode = mode === 'thumbnail' ? 'thumbnail' : 'content';
  const content = state.mode === 'content';
  $('#tydk-content-controls').hidden = !content;
  $('#tydk-thumbnail-controls').hidden = content;
  $('#tydk-content-tab').classList.toggle('active', content);
  $('#tydk-thumbnail-tab').classList.toggle('active', !content);
  $('#tydk-preview-title').textContent = content ? 'Preview Nội dung' : 'Preview Thumbnail';
  void refreshPreview().catch((error) => setStatus(error.message, true));
}

$('#tydk-design-save').addEventListener('click', () => void saveDesign());
$('#tydk-design-reset').addEventListener('click', () => void resetDesign());
$('#tydk-preset-save').addEventListener('click', () => void savePreset());
$('#tydk-preset-select').addEventListener('change', (event) => void selectPreset(event.currentTarget.value));
$('#tydk-preview-refresh').addEventListener('click', () => void refreshPreview().then(() => setStatus('Preview đã cập nhật.')).catch((error) => setStatus(error.message, true)));
$('#tydk-content-tab').addEventListener('click', () => setMode('content'));
$('#tydk-thumbnail-tab').addEventListener('click', () => setMode('thumbnail'));
$('#tydk-content-controls').addEventListener('input', schedulePreview);
$('#tydk-content-controls').addEventListener('change', schedulePreview);
$('#tydk-thumbnail-controls').addEventListener('input', schedulePreview);
$('#tydk-thumbnail-controls').addEventListener('change', schedulePreview);
window.addEventListener('beforeunload', () => { if (state.previewUrl) URL.revokeObjectURL(state.previewUrl); });
let loadPromise = null;
function activate() {
  if (loadPromise) return;
  loadPromise = load().catch((error) => { setStatus(error.message, true); loadPromise = null; });
}
window.addEventListener('things-visual-editor:activate', activate);
if (document.body.classList.contains('things-editor-mode')) activate();
