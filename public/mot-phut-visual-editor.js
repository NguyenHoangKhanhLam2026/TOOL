const $ = (selector, root = document) => root.querySelector(selector);
const API = '/api/mot-phut-vo-le';
const defaultsByPreset = {
  'vintage-paper': { background: '#E9DFC8', accent: '#A63F36', textColor: '#22211F', mutedColor: '#6D6457', brandColor: '#59473A', highlightColor: '#A63F36' },
  'dark-knowledge': { background: '#11172B', accent: '#58D8F0', textColor: '#F6F7FB', mutedColor: '#AAB4CC', brandColor: '#92E9F4', highlightColor: '#58D8F0' }
};
const fontOptions = [['Arial, Segoe UI, sans-serif', 'Arial'], ['Georgia, serif', 'Georgia'], ['Verdana, sans-serif', 'Verdana']];
const contentFontOptions = [['Arial, sans-serif', 'Arial đậm (theo mẫu)'], ['Georgia, serif', 'Georgia đậm']];
const headlineFontOptions = [
  ['display', 'Be Vietnam Pro Black · đậm hiện đại'], ['arial', 'Arial Bold · gọn, rõ'],
  ['times', 'Times New Roman Bold · cổ điển'], ['georgia', 'Georgia Bold · kiểu tạp chí'],
  ['serif', 'Tinos Bold · serif poster'], ['tahoma', 'Tahoma Bold · gọn nét'],
  ['trebuchet', 'Trebuchet MS Bold · mềm hơn'], ['verdana', 'Verdana Bold · thoáng, rõ'],
  ['calibri', 'Calibri Bold · hiện đại'], ['segoe', 'Segoe UI Bold · tối giản']
];
const brandFontOptions = [
  ['arial', 'Arial Bold - clean'], ['times', 'Times New Roman Bold - classic serif'],
  ['georgia', 'Georgia Bold - editorial serif'], ['cambria', 'Cambria Bold - book serif'],
  ['garamond', 'Garamond Bold - elegant serif'], ['bookman', 'Bookman Old Style Bold - rounded'],
  ['palatino', 'Palatino Linotype Bold - book'], ['book-antiqua', 'Book Antiqua Bold - elegant'],
  ['impact', 'Impact - heavy poster'], ['comic', 'Comic Sans MS Bold - casual'],
  ['consolas', 'Consolas Bold - monospace'], ['courier', 'Courier New Bold - typewriter'],
  ['display', 'Be Vietnam Pro Black - modern'], ['serif', 'Tinos Bold - poster serif'],
  ['century', 'Century - traditional serif'], ['tahoma', 'Tahoma Bold'],
  ['trebuchet', 'Trebuchet MS Bold'], ['verdana', 'Verdana Bold'],
  ['calibri', 'Calibri Bold'], ['segoe', 'Segoe UI Bold']
];
const fields = {
  thumbnail: [
    { title: 'Thumbnail đầu video', fields: [
      { key: 'introSeconds', label: 'Thời lượng Thumbnail đầu video (giây, 0 = không có)', type: 'number', min: 0, max: 10, step: 0.1 }
    ] },
    { title: 'Tên Page', fields: [
      { key: 'brandColorA', label: 'Màu nửa đầu', type: 'color' }, { key: 'brandColorB', label: 'Màu nửa sau', type: 'color' },
      { key: 'brandSizePx', label: 'Cỡ chữ (px)', type: 'number', min: 12, max: 200, slider: true },
      { key: 'brandCenterXPct', label: 'Vị trí ngang (%)', type: 'number', min: 0, max: 100, step: 0.5 },
      { key: 'brandTopPct', label: 'Vị trí dọc (%)', type: 'number', min: 0, max: 96, step: 0.5 }
    ] },
    { title: 'Tên Page · Font chữ', fields: [
      { key: 'brandFont', label: 'Font', type: 'select', options: brandFontOptions }
    ] },
    { title: 'Headline', fields: [
      { key: 'headlineFont', label: 'Font chữ', type: 'select', options: brandFontOptions },
      { key: 'textColor', label: 'Màu chữ', type: 'color' }, { key: 'highlightColor', label: 'Màu từ nổi bật', type: 'color' }, { key: 'outlineColor', label: 'Màu viền chữ', type: 'color' },
      { key: 'headlineMaxPx', label: 'Cỡ chữ lớn nhất (px)', type: 'number', min: 40, max: 400, slider: true },
      { key: 'headlineCase', label: 'Kiểu chữ', type: 'select', options: [['uppercase', 'uppercase (viết hoa hết)'], ['as written', 'as written (giữ nguyên)']] },
      { key: 'headlineLeftPct', label: 'Trái (%)', type: 'number', min: 0, max: 80, step: 0.5, group: 'geometry' },
      { key: 'headlineTopPct', label: 'Trên (%)', type: 'number', min: 0, max: 90, step: 0.5, group: 'geometry' },
      { key: 'headlineWidthPct', label: 'Rộng (%)', type: 'number', min: 20, max: 100, group: 'geometry' },
      { key: 'headlineHeightPct', label: 'Cao (%)', type: 'number', min: 5, max: 90, step: 0.5, group: 'geometry' }
    ] },
    { title: 'Watermark', fields: [
      { key: 'watermark', label: 'Nội dung', type: 'text' },
      { key: 'watermarkColor', label: 'Màu chữ', type: 'color' }, { key: 'watermarkOpacity', label: 'Độ đậm', type: 'number', min: 0, max: 1, step: 0.05, slider: true },
      { key: 'watermarkSizePx', label: 'Cỡ chữ (px)', type: 'number', min: 10, max: 120, slider: true },
      { key: 'watermarkFontFamily', label: 'Font', type: 'select', options: fontOptions },
      { key: 'watermarkCenterXPct', label: 'Vị trí ngang (%)', type: 'number', min: 0, max: 100, step: 0.5 },
      { key: 'watermarkTopPct', label: 'Vị trí dọc (%)', type: 'number', min: 0, max: 100, step: 0.5 }
    ] },
    { title: 'Nền giấy', fields: [
      { key: 'paperColor', label: 'Màu nền', type: 'color' },
      { key: 'vignette', label: 'Độ tối viền ảnh', type: 'number', min: 0, max: 1, step: 0.05, slider: true },
      { key: 'bottomShade', label: 'Độ tối phía dưới', type: 'number', min: 0, max: 1, step: 0.05, slider: true }
    ] }
  ],
  content: [
    { title: 'Thương hiệu', fields: [
      { key: 'brand', label: 'Tên thương hiệu', type: 'text' }, { key: 'brandVisible', label: 'Hiện thương hiệu', type: 'checkbox' },
      { key: 'brandColorA', label: 'Màu nửa đầu', type: 'color' }, { key: 'brandColorB', label: 'Màu nửa sau', type: 'color' },
      { key: 'brandSizePx', label: 'Cỡ chữ (px)', type: 'number', min: 12, max: 120, slider: true },
      { key: 'brandCenterXPct', label: 'Vị trí ngang (%)', type: 'number', min: 0, max: 100, step: 0.5 },
      { key: 'brandTopPct', label: 'Vị trí dọc (%)', type: 'number', min: 0, max: 40, step: 0.5 }
    ] },
    { title: 'Tiêu đề', fields: [
      { type: 'note', text: 'Tiêu đề dùng Arial đậm, màu đen, căn giữa như mẫu Shadowing.' },
      { key: 'titleFontSize', label: 'Cỡ chữ (px)', type: 'number', min: 44, max: 100, slider: true },
      { key: 'titleColor', label: 'Màu chữ', type: 'color' },
      { key: 'titleTopPct', label: 'Vị trí dọc (%)', type: 'number', min: 10, max: 35, step: 0.5 },
      { key: 'titleWidthPct', label: 'Rộng (%)', type: 'number', min: 30, max: 100, step: 0.5 }
    ] },
    { title: 'Lời thoại', fields: [
      { type: 'note', text: 'Chữ đậm căn giữa; màu từ đang đọc lấy từ mục Highlight. Lời thoại bắt đầu cố định dưới tiêu đề.' },
      { key: 'bodyFont', label: 'Font chữ', type: 'select', options: contentFontOptions },
      { key: 'bodyColor', label: 'Màu chữ', type: 'color' },
      { key: 'bodyMaxPx', label: 'Cỡ chữ lớn nhất (px)', type: 'number', min: 34, max: 80, slider: true },
      { key: 'lineSpacing', label: 'Giãn dòng', type: 'number', min: 1.2, max: 1.7, step: 0.05 },
      { key: 'contentLeftPct', label: 'Trái (%)', type: 'number', min: 0, max: 80, step: 0.5, group: 'geometry' },
      { key: 'contentTopPct', label: 'Trên (%)', type: 'number', min: 0, max: 90, step: 0.5, group: 'geometry' },
      { key: 'contentWidthPct', label: 'Rộng (%)', type: 'number', min: 20, max: 100, group: 'geometry' },
      { key: 'contentHeightPct', label: 'Cao (%)', type: 'number', min: 5, max: 90, step: 0.5, group: 'geometry' }
    ] },
    { title: 'Nền giấy', fields: [
      { key: 'paperColor', label: 'Màu nền', type: 'color' },
      { key: 'vignette', label: 'Độ tối viền ảnh', type: 'number', min: 0, max: 1, step: 0.05, slider: true },
      { key: 'bottomShade', label: 'Độ tối phía dưới', type: 'number', min: 0, max: 1, step: 0.05, slider: true }
    ] }
  ]
};
const handles = [
  ['nw', 'nwse-resize', 'left:-6px;top:-6px'], ['n', 'ns-resize', 'left:calc(50% - 5px);top:-6px'],
  ['ne', 'nesw-resize', 'right:-6px;top:-6px'], ['e', 'ew-resize', 'right:-6px;top:calc(50% - 5px)'],
  ['se', 'nwse-resize', 'right:-6px;bottom:-6px'], ['s', 'ns-resize', 'left:calc(50% - 5px);bottom:-6px'],
  ['sw', 'nesw-resize', 'left:-6px;bottom:-6px'], ['w', 'ew-resize', 'left:-6px;top:calc(50% - 5px)']
];
const PREVIEW_SAMPLE_STORAGE_KEY = 'mot-phut-vo-le.visual-preview-samples.v1';
const SAMPLE_DEFAULTS = {
  thumbnailBrand: 'Một Phút Vỡ Lẽ', thumbnailTitle: 'Mùi hương gợi ký ức?', thumbnailHighlight: 'ký ức mùi hương',
  contentBrand: 'Một Phút Vỡ Lẽ', contentTitle: 'Mùi hương gợi ký ức?',
  contentParagraphs: 'Mùi hương có thể đánh thức ký ức vì khứu giác kết nối trực tiếp với những vùng não lưu giữ cảm xúc. Một mùi quen thuộc đôi khi đưa ta trở lại căn bếp cũ, con đường đến trường hoặc một ngày mưa đã xa. Ký ức ấy không chỉ nằm trong mùi hương; nó còn gắn với hoàn cảnh, cảm xúc và những chi tiết đã qua.'
};
function readPreviewSamples() {
  try {
    const stored = JSON.parse(localStorage.getItem(PREVIEW_SAMPLE_STORAGE_KEY) || 'null');
    if (!stored || typeof stored !== 'object') return { ...SAMPLE_DEFAULTS };
    return Object.fromEntries(Object.entries(SAMPLE_DEFAULTS).map(([key, fallback]) => [
      key,
      typeof stored[key] === 'string'
        ? stored[key].slice(0, key === 'contentParagraphs' ? 10000 : key.includes('Title') ? 120 : 80)
        : fallback
    ]));
  } catch { return { ...SAMPLE_DEFAULTS }; }
}
const sample = readPreviewSamples();
const editorState = {
  profile: 'english-shadowing', design: null, savedDesign: null, defaults: null, activeMode: 'thumbnail', loading: null,
  previewUrls: new Set(), previewTimer: null, previewSequence: 0, cardPreviewSequence: 0, previewTab: 'design', dirty: false,
  lastRender: null, selected: 'headline', showSnapLine: false, fitResult: { fits: true, size: 0 }, drag: null, svgInstance: 0, saving: false,
  savedSample: { ...sample }
};

function persistPreviewSamples() {
  try { localStorage.setItem(PREVIEW_SAMPLE_STORAGE_KEY, JSON.stringify(sample)); } catch { /* Preview-only state is optional if browser storage is unavailable. */ }
  editorState.savedSample = { ...sample };
}

function restorePreviewSamples() {
  Object.assign(sample, editorState.savedSample || SAMPLE_DEFAULTS);
}

async function api(route, options = {}) {
  const response = await fetch(`${API}${route}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data?.error || `Máy chủ trả mã ${response.status}.`);
  return data;
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 10) / 10;
const currentSettings = () => editorState.design?.[editorState.activeMode];
const elementSettings = (element) => element === 'brand' && editorState.activeMode === 'content'
  ? editorState.design?.content
  : ['brand', 'watermark', 'headline'].includes(element) ? editorState.design?.thumbnail : currentSettings();
function status(message, error = false, target = '#mot-phut-visual-status') {
  const node = $(target);
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('error', error);
}

function setProfile(value) {
  editorState.profile = value === 'mot-phut-vo-le' ? 'mot-phut-vo-le' : 'english-shadowing';
  $('#shadowing-content-profile').value = editorState.profile;
  const active = editorState.profile === 'mot-phut-vo-le';
  document.body.classList.toggle('mot-phut-visual-profile-active', active);
  $('#mot-phut-visual-profile').hidden = !active;
  ['#shadowing-title', '#shadowing-description', '#shadowing-preview-image', '#shadowing-editor-status', '#shadowing-visual-tools', '.shadowing-visual-footnote'].forEach((selector) => {
    const node = $(selector);
    if (node) node.hidden = active;
  });
  $('#template-language-label').textContent = active
    ? 'Một Phút Vỡ Lẽ · thiết kế riêng · 1080 × 1920'
    : 'EnglishShadowing · preset riêng · 1080 × 1920';
  if (active) void loadDesign();
}

async function loadDesign(force = false) {
  if (editorState.design && !force) { void refreshCardPreviews(); return true; }
  if (editorState.loading) return editorState.loading;
  editorState.loading = (async () => {
    try {
      const [result, defaults] = await Promise.all([api('/visual-design'), api('/visual-design/defaults')]);
      editorState.design = result.design;
      editorState.savedDesign = clone(result.design);
      editorState.dirty = false;
      editorState.defaults = defaults.design;
      $('#mot-phut-visual-enabled').checked = result.design.enabled !== false;
      $('#mot-phut-visual-preset').value = result.design.preset;
      void refreshCardPreviews();
      status('Thiết kế và cài đặt riêng của Một Phút Vỡ Lẽ đã tải.');
      return true;
    } catch (error) { status(error.message, true); return false; }
    finally { editorState.loading = null; }
  })();
  return editorState.loading;
}

function imageContent(mode) {
  if (mode === 'thumbnail') return {
    title: sample.thumbnailTitle, thumbnailHighlight: sample.thumbnailHighlight,
    brand: sample.thumbnailBrand, scriptText: ''
  };
  return {
    title: sample.contentTitle,
    scriptText: sample.contentParagraphs.split('\n').filter((line) => line.trim()).join(' '),
    brand: sample.contentBrand
  };
}

function sampleDesign(mode) {
  const design = clone(editorState.design);
  design.schemaVersion = 4;
  if (mode === 'thumbnail') design.thumbnail.brand = sample.thumbnailBrand;
  else design.content.brand = sample.contentBrand;
  return design;
}

function currentKey(mode = editorState.activeMode) {
  return JSON.stringify([mode, editorState.design?.[mode], imageContent(mode)]);
}

async function requestPreview(mode = editorState.activeMode) {
  const response = await fetch(`${API}/visual-preview.svg`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ design: sampleDesign(mode), mode, content: imageContent(mode) })
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text || `Không tạo được preview (${response.status}).`;
    try { message = JSON.parse(text).error || message; } catch { /* Plain text error response. */ }
    throw new Error(message);
  }
  return response.text();
}

async function requestRasterPreview(mode = editorState.activeMode) {
  const response = await fetch(`${API}/visual-preview.png`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ design: sampleDesign(mode), mode, content: imageContent(mode) })
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text || `Không render được ảnh (${response.status}).`;
    try { message = JSON.parse(text).error || message; } catch { /* Plain text error response. */ }
    throw new Error(message);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith('image/png')) throw new Error('Renderer MPVL không trả về ảnh PNG hợp lệ.');
  const url = URL.createObjectURL(blob);
  editorState.previewUrls.add(url);
  return url;
}

function scopeSvgMarkup(markup) {
  const prefix = `mot-phut-svg-${++editorState.svgInstance}-`;
  return markup
    .replace(/\bid="([^"]+)"/gu, (_match, id) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]*)\)/gu, (_match, id) => `url(#${prefix}${id})`)
    .replace(/\b(href|xlink:href)="#([^"]+)"/gu, (_match, attribute, id) => `${attribute}="#${prefix}${id}"`);
}

function releasePreviewUrl(url) {
  if (!url) return;
  URL.revokeObjectURL(url);
  editorState.previewUrls.delete(url);
}

async function refreshCardPreviews() {
  if (!editorState.design) return;
  const sequence = ++editorState.cardPreviewSequence;
  await Promise.all(['thumbnail', 'content'].map(async (mode) => {
    const image = $(`#mot-phut-visual-${mode}-card`);
    try {
      const svg = await requestPreview(mode);
      if (sequence !== editorState.cardPreviewSequence) return;
      image.innerHTML = scopeSvgMarkup(svg);
    } catch (error) {
      if (sequence !== editorState.cardPreviewSequence) return;
      if (!image.querySelector('svg')) image.textContent = 'Chưa tải được ảnh mẫu.';
      status(error.message, true);
    }
  }));
}

function colorInputValue(value) {
  const color = String(value || '#000000');
  if (/^#[\da-f]{3}$/iu.test(color)) return `#${[...color.slice(1)].map((part) => part + part).join('')}`;
  return /^#[\da-f]{6}$/iu.test(color) ? color : '#000000';
}

function fieldMarkup(field) {
  if (field.type === 'note') return `<p class="mot-phut-visual-source-note">${escapeHtml(field.text)}</p>`;
  const value = currentSettings()[field.key];
  const key = escapeHtml(field.key);
  const label = escapeHtml(field.label);
  if (field.type === 'checkbox') return `<label class="mot-phut-visual-source-checkbox"><input type="checkbox" data-design-key="${key}" ${value ? 'checked' : ''}/><span>${label}</span></label>`;
  if (field.type === 'color') return `<label class="mot-phut-visual-source-field"><span>${label}</span><span class="mot-phut-visual-color-row"><input type="color" data-design-key="${key}" value="${colorInputValue(value)}" aria-label="${label}"/><input type="text" data-design-key="${key}" data-color-text="true" value="${escapeHtml(value)}" maxlength="7" aria-label="${label} (mã màu)"/></span></label>`;
  if (field.type === 'select') {
    const options = field.options.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${value === optionValue ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>`).join('');
    return `<label class="mot-phut-visual-source-field"><span>${label}</span><select data-design-key="${key}">${options}</select></label>`;
  }
  if (field.type === 'text') return `<label class="mot-phut-visual-source-field"><span>${label}</span><input type="text" data-design-key="${key}" value="${escapeHtml(value)}" maxlength="80" aria-label="${label}"/></label>`;
  const step = field.step || 1;
  const slider = field.slider ? `<input type="range" data-design-key="${key}" min="${field.min}" max="${field.max}" step="${step}" value="${value}" aria-label="${label}"/>` : '';
  const number = `<input type="number" data-design-key="${key}" min="${field.min}" max="${field.max}" step="${step}" value="${value}" aria-label="${label}"/>`;
  return `<label class="mot-phut-visual-source-field"><span>${label}</span><span class="mot-phut-visual-number-row">${slider}${number}</span></label>`;
}

function groupMarkup(group) {
  let markup = '';
  for (let index = 0; index < group.fields.length;) {
    if (group.fields[index].group === 'geometry') {
      const geometry = [];
      while (group.fields[index]?.group === 'geometry') geometry.push(group.fields[index++]);
      markup += `<div class="mot-phut-visual-geometry-grid">${geometry.map(fieldMarkup).join('')}</div>`;
    } else markup += fieldMarkup(group.fields[index++]);
  }
  return `<section class="mot-phut-visual-control-group"><h4>${escapeHtml(group.title)}</h4><div class="mot-phut-visual-controls-grid">${markup}</div></section>`;
}

function renderControls() {
  if (!editorState.design) return;
  $('#mot-phut-visual-controls-root').innerHTML = fields[editorState.activeMode].map(groupMarkup).join('');
  for (const input of $('#mot-phut-visual-controls-root').querySelectorAll('[data-design-key]')) {
    input.addEventListener('input', handleControlChange);
    input.addEventListener('change', handleControlChange);
  }
  $('#mot-phut-visual-enabled').checked = editorState.design.enabled === true;
  renderLayerList();
}

function syncControlsFromDesign() {
  const settings = currentSettings();
  if (!settings) return;
  for (const input of $('#mot-phut-visual-controls-root').querySelectorAll('[data-design-key]')) {
    const value = settings[input.dataset.designKey];
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else if (document.activeElement !== input) input.value = value;
  }
  renderFitNote();
}

const thumbnailLayerDefinitions = [
  { id: 'brand', label: 'Tên Page', visibleKey: 'brandVisible' },
  { id: 'headline', label: 'Headline', visibleKey: 'headlineVisible' },
  { id: 'watermark', label: 'Watermark', visibleKey: 'watermarkVisible' }
];

function renderLayerList() {
  const root = $('#mot-phut-visual-layer-list');
  if (!root) return;
  const isThumbnail = editorState.activeMode === 'thumbnail';
  root.hidden = !isThumbnail;
  if (!isThumbnail || !editorState.design) { root.replaceChildren(); return; }
  const settings = editorState.design.thumbnail;
  root.innerHTML = `<h4>Lớp thumbnail · kéo trong ảnh để di chuyển</h4>${thumbnailLayerDefinitions.map((layer) => {
    const visible = settings[layer.visibleKey] !== false;
    const selected = editorState.selected === layer.id;
    return `<div class="mot-phut-visual-layer-row"><button type="button" class="mot-phut-visual-layer-select ${selected ? 'active' : ''}" data-layer-select="${layer.id}" aria-pressed="${selected}" ${visible ? '' : 'disabled'}>${escapeHtml(layer.label)}</button><button type="button" class="mot-phut-visual-layer-action" data-layer-action="${visible ? 'delete' : 'restore'}" data-layer-id="${layer.id}">${visible ? 'Xóa' : 'Khôi phục'}</button></div>`;
  }).join('')}`;
}

function visibleThumbnailLayer(id) {
  const layer = thumbnailLayerDefinitions.find((item) => item.id === id);
  return Boolean(layer && editorState.design?.thumbnail?.[layer.visibleKey] !== false);
}

function firstVisibleThumbnailLayer() {
  return thumbnailLayerDefinitions.find((layer) => visibleThumbnailLayer(layer.id))?.id || null;
}

function changeThumbnailLayerVisibility(id, visible) {
  const layer = thumbnailLayerDefinitions.find((item) => item.id === id);
  if (!layer || !editorState.design) return;
  editorState.design.thumbnail[layer.visibleKey] = visible;
  if (!visible && editorState.selected === id) editorState.selected = firstVisibleThumbnailLayer();
  if (visible) editorState.selected = id;
  renderLayerList();
  markDirty();
  schedulePreview();
}

function renderSampleInputs() {
  const root = $('#mot-phut-visual-samples');
  if (editorState.activeMode === 'thumbnail') {
    root.innerHTML = `<section class="mot-phut-visual-sample-group"><h4>Nội dung mẫu (chỉ để xem thử)</h4><label class="mot-phut-visual-source-field"><span>Tên Page</span><input type="text" data-sample-key="thumbnailBrand" value="${escapeHtml(sample.thumbnailBrand)}" maxlength="60"/></label><label class="mot-phut-visual-source-field"><span>Headline mẫu</span><input type="text" data-sample-key="thumbnailTitle" value="${escapeHtml(sample.thumbnailTitle)}" maxlength="120"/></label><label class="mot-phut-visual-source-field"><span>Từ nổi bật</span><span class="mot-phut-visual-source-hint">Cách nhau bằng dấu cách.</span><input type="text" data-sample-key="thumbnailHighlight" value="${escapeHtml(sample.thumbnailHighlight)}"/></label></section>`;
  } else {
    root.innerHTML = `<section class="mot-phut-visual-sample-group"><h4>Nội dung mẫu (chỉ để xem thử)</h4><label class="mot-phut-visual-source-field"><span>Tên thương hiệu</span><input type="text" data-sample-key="contentBrand" value="${escapeHtml(sample.contentBrand)}" maxlength="60"/></label><label class="mot-phut-visual-source-field"><span>Tiêu đề mẫu</span><input type="text" data-sample-key="contentTitle" value="${escapeHtml(sample.contentTitle)}" maxlength="120"/></label><label class="mot-phut-visual-source-field"><span>Lời thoại mẫu</span><span class="mot-phut-visual-source-hint">Mỗi dòng là một đoạn.</span><textarea data-sample-key="contentParagraphs" rows="4">${escapeHtml(sample.contentParagraphs)}</textarea></label></section>`;
  }
  for (const input of root.querySelectorAll('[data-sample-key]')) {
    input.addEventListener('input', (event) => {
      sample[event.currentTarget.dataset.sampleKey] = event.currentTarget.value;
      schedulePreview();
      renderFitNote();
    });
  }
}

function updateTabs() {
  const isThumbnail = editorState.activeMode === 'thumbnail';
  $('#mot-phut-visual-dialog-title').textContent = isThumbnail ? 'Thiết kế thumbnail' : 'Thiết kế nội dung';
  $('#mot-phut-visual-dialog-help').textContent = isThumbnail
    ? 'Chọn từng lớp để kéo di chuyển; có thể xóa hoặc khôi phục lớp ở danh sách bên phải. Bấm “Render thử” để xem ảnh 9:16 do renderer MPVL vẽ.'
    : 'Bố cục 9:16 gồm thương hiệu, tiêu đề và lời thoại như mẫu Shadowing. Có thể chỉnh cỡ chữ, màu, vị trí và nền giấy; highlight lấy từ cài đặt MPVL.';
  $('#mot-phut-visual-controls-heading').textContent = isThumbnail ? 'Thiết kế thumbnail' : 'Thiết kế nội dung';
  renderSampleInputs();
  renderControls();
}

function rangeDefinition(key) {
  return fields[editorState.activeMode].flatMap((group) => group.fields).find((field) => field.key === key);
}

function keepBoxInside(style) {
  const box = editorState.activeMode === 'thumbnail'
    ? { left: 'headlineLeftPct', top: 'headlineTopPct', width: 'headlineWidthPct', height: 'headlineHeightPct' }
    : { left: 'contentLeftPct', top: 'contentTopPct', width: 'contentWidthPct', height: 'contentHeightPct' };
  style[box.width] = clamp(style[box.width], 20, 100);
  style[box.height] = clamp(style[box.height], 5, 90);
  style[box.left] = round(clamp(style[box.left], 0, 100 - style[box.width]));
  style[box.top] = round(clamp(style[box.top], 0, 100 - style[box.height]));
  return style;
}

function handleControlChange(event) {
  const input = event.currentTarget;
  const key = input.dataset.designKey;
  const field = rangeDefinition(key);
  if (!field) return;
  let value = input.type === 'checkbox' ? input.checked : input.value;
  if (field.type === 'number') {
    if (value === '') return;
    value = Number(value);
    if (!Number.isFinite(value)) return;
    value = clamp(value, field.min, field.max);
    const precision = String(field.step || 1).split('.')[1]?.length || 0;
    const factor = 10 ** precision;
    value = Math.round(value * factor) / factor;
  } else if (field.type === 'color') {
    if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/iu.test(value)) { input.classList.add('invalid'); return; }
    value = colorInputValue(value).toUpperCase();
    input.classList.remove('invalid');
  }
  currentSettings()[key] = value;
  if (editorState.activeMode === 'thumbnail' && key === 'brandFont') {
    editorState.selected = 'brand';
    renderLayerList();
  } else if (editorState.activeMode === 'thumbnail' && key === 'headlineFont') {
    editorState.selected = 'headline';
    renderLayerList();
  }
  if (key === 'paperColor') currentSettings().background = value;
  if (field.group === 'geometry') {
    keepBoxInside(currentSettings());
    for (const geometryField of fields[editorState.activeMode].flatMap((group) => group.fields).filter((item) => item.group === 'geometry')) {
      syncPairedInputs(geometryField.key, currentSettings()[geometryField.key]);
    }
  } else syncPairedInputs(key, value);
  markDirty();
  schedulePreview();
}

function syncPairedInputs(key, value) {
  for (const input of $('#mot-phut-visual-controls-root').querySelectorAll(`[data-design-key="${key}"]`)) {
    if (document.activeElement !== input) input.value = value;
  }
}

function markDirty() {
  editorState.design.schemaVersion = 4;
  editorState.dirty = true;
  renderFitNote();
  status('Có thay đổi chưa lưu.', false, '#mot-phut-visual-dialog-status');
}

function schedulePreview() {
  clearTimeout(editorState.previewTimer);
  editorState.previewTimer = setTimeout(() => {
    if (editorState.previewTab === 'design') void renderDesignPreview();
  }, 160);
}

function setPreviewTab(tab) {
  editorState.previewTab = tab;
  for (const name of ['design', 'render']) {
    const button = $(`#mot-phut-visual-tab-${name}`);
    const active = tab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
  if (tab === 'design') void renderDesignPreview();
  else showLastRender();
}

function setPreviewTabButtonsOnly(tab) {
  editorState.previewTab = tab;
  for (const name of ['design', 'render']) {
    const button = $(`#mot-phut-visual-tab-${name}`);
    const active = tab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
  renderFitNote();
}

function scaleCanvas() {
  const panel = $('#mot-phut-visual-canvas').parentElement;
  if (!panel) return;
  const tabsHeight = $('.mot-phut-visual-render-tabs')?.offsetHeight || 0;
  const noteHeight = $('#mot-phut-visual-fit-note')?.offsetHeight || 0;
  const width = 1080;
  const height = 1920;
  const scale = Math.min((panel.clientWidth - 24) / width, (panel.clientHeight - tabsHeight - noteHeight - 24) / height);
  const canvas = $('#mot-phut-visual-canvas');
  if (Number.isFinite(scale) && scale > 0) {
    canvas.style.width = `${Math.round(width * scale)}px`;
    canvas.style.height = `${Math.round(height * scale)}px`;
  }
}

function updateFitFromSvg() {
  const svg = $('#mot-phut-visual-canvas').querySelector('svg');
  if (!svg) return;
  editorState.fitResult = { fits: svg.dataset.fit !== 'false', size: Number(svg.dataset.size || 0) };
  renderFitNote();
}

function renderFitNote() {
  const note = $('#mot-phut-visual-fit-note');
  const renderTab = $('#mot-phut-visual-tab-render');
  if (!note || !renderTab) return;
  $('#mot-phut-visual-render').disabled = !editorState.fitResult.fits;
  renderTab.textContent = editorState.lastRender && editorState.lastRender.key !== currentKey() ? 'Kết quả render (cũ)' : 'Kết quả render';
  if (editorState.previewTab === 'render') {
    note.classList.remove('warning');
    note.textContent = editorState.lastRender && editorState.lastRender.key !== currentKey()
      ? 'Thiết kế hoặc nội dung mẫu đã đổi sau lần render này. Bấm “Render thử” để cập nhật.'
      : 'Ảnh kết quả được tạo bằng renderer của video Một Phút Vỡ Lẽ; hiệu ứng highlight lấy từ cài đặt của tool.';
    return;
  }
  if (editorState.activeMode === 'thumbnail' && currentSettings().headlineVisible === false) {
    note.classList.remove('warning');
    note.textContent = 'Headline đang ẩn. Có thể khôi phục ở danh sách lớp thumbnail.';
    return;
  }
  if (!editorState.fitResult.fits) {
    note.classList.add('warning');
    note.textContent = editorState.activeMode === 'thumbnail'
      ? 'Headline mẫu không vừa vùng này. Mở rộng vùng headline hoặc rút ngắn headline mẫu.'
      : 'Nội dung mẫu không vừa vùng này. Mở rộng vùng nội dung hoặc rút gọn nội dung mẫu.';
    return;
  }
  note.classList.remove('warning');
  const limit = editorState.activeMode === 'thumbnail' ? currentSettings().headlineMaxPx : currentSettings().bodyMaxPx;
  const textType = editorState.activeMode === 'thumbnail' ? 'Headline' : 'Nội dung';
  note.textContent = `${textType} đang vẽ: ${editorState.fitResult.size}px (tối đa ${limit}px). Chữ tự co để vừa vùng; kéo rộng vùng để chữ có thêm chỗ.`;
}

async function renderDesignPreview() {
  if (!editorState.design || editorState.previewTab !== 'design' || $('#mot-phut-visual-dialog').hidden) return;
  const sequence = ++editorState.previewSequence;
  status(editorState.dirty ? 'Đang cập nhật preview… Có thay đổi chưa lưu.' : 'Đang tải thiết kế…', false, '#mot-phut-visual-dialog-status');
  try {
    const svg = await requestPreview();
    if (sequence !== editorState.previewSequence || editorState.previewTab !== 'design') {
      return;
    }
    const canvas = $('#mot-phut-visual-canvas');
    releaseDesignRasterPreview();
    canvas.innerHTML = scopeSvgMarkup(svg);
    await document.fonts?.ready;
    scaleCanvas();
    updateFitFromSvg();
    addDesignOverlay();
    status(editorState.dirty ? 'Preview đã cập nhật. Có thay đổi chưa lưu.' : 'Thiết kế đã tải.', false, '#mot-phut-visual-dialog-status');
  } catch (error) {
    if (sequence !== editorState.previewSequence) return;
    releaseDesignRasterPreview();
    $('#mot-phut-visual-canvas').innerHTML = `<p class="mot-phut-visual-error">${escapeHtml(error.message)}</p>`;
    status(error.message, true, '#mot-phut-visual-dialog-status');
  }
}

function releaseDesignRasterPreview() {
  const image = $('#mot-phut-visual-canvas [data-mpvl-raster-preview]');
  if (image) releasePreviewUrl(image.src);
}

function showLastRender() {
  if (editorState.previewTab !== 'render' || $('#mot-phut-visual-dialog').hidden) return;
  const canvas = $('#mot-phut-visual-canvas');
  releaseDesignRasterPreview();
  if (!editorState.lastRender || editorState.lastRender.mode !== editorState.activeMode) {
    canvas.innerHTML = '<p class="mot-phut-visual-empty">Chưa render. Bấm “Render thử” để xem ảnh do renderer MPVL tạo.</p>';
  } else if (editorState.lastRender.imageUrl) {
    canvas.innerHTML = `<img alt="Ảnh render thử MPVL" src="${escapeHtml(editorState.lastRender.imageUrl)}">`;
  } else canvas.innerHTML = scopeSvgMarkup(editorState.lastRender.svg);
  scaleCanvas();
  renderFitNote();
}

function brandBoxMarkup() {
  const isThumbnail = editorState.activeMode === 'thumbnail';
  const style = currentSettings();
  if (isThumbnail ? !visibleThumbnailLayer('brand') : style.brandVisible === false) return '';
  const name = editorState.activeMode === 'thumbnail' ? sample.thumbnailBrand : sample.contentBrand;
  const size = style.brandSizePx;
  let box = null;
  try {
    const measured = $('#mot-phut-visual-canvas svg [data-source-brand="top"]')?.getBBox();
    if (measured && measured.width > 0 && measured.height > 0) box = measured;
  } catch { /* Use the text estimate before the SVG font is measurable. */ }
  const left = box ? box.x - 6 : style.brandCenterXPct * 10.8 - clamp(name.length * size * 0.57 + 18, 75, 1040) / 2;
  const top = box ? box.y - 3 : style.brandTopPct * 19.2;
  const topOffsetPct = top / 19.2 - style.brandTopPct;
  const width = box ? box.width + 12 : clamp(name.length * size * 0.48 + 18, 75, 1040);
  const height = box ? box.height + 4 : Math.max(size * 1.2, 25);
  const selected = editorState.selected === 'brand';
  const sizeHandle = selected ? '<span class="mot-phut-source-size-handle" data-size-handle="true" role="button" tabindex="0" title="Kéo xuống: chữ to hơn. Kéo lên: chữ nhỏ hơn.">A↕</span>' : '';
  return `<div class="mot-phut-source-drag mot-phut-source-brand ${selected ? 'selected' : ''}" role="button" tabindex="0" aria-label="Tên Page: kéo để di chuyển" data-design-element="brand" data-font-key="brandSizePx" data-brand-top-offset-pct="${topOffsetPct}" style="left:${left / 10.8}%;top:${top / 19.2}%;width:${width / 10.8}%;height:${height / 19.2}%">${sizeHandle}</div>`;
}

function watermarkBoxMarkup() {
  if (editorState.activeMode !== 'thumbnail' || !visibleThumbnailLayer('watermark')) return '';
  const style = editorState.design.thumbnail;
  let box = null;
  try {
    const measured = $('#mot-phut-visual-canvas svg [data-source-watermark="top"]')?.getBBox();
    if (measured && measured.width > 0 && measured.height > 0) box = measured;
  } catch { /* Use the configured position until SVG text measurement is available. */ }
  const sampleName = editorState.activeMode === 'thumbnail' ? sample.thumbnailBrand : sample.contentBrand;
  const width = box ? box.width + 12 : clamp(sampleName.length * style.watermarkSizePx * 0.54 + 18, 75, 1040);
  const height = box ? box.height + 6 : Math.max(style.watermarkSizePx * 1.25, 20);
  const left = box ? box.x - 6 : style.watermarkCenterXPct * 10.8 - width / 2;
  const top = box ? box.y - 3 : style.watermarkTopPct * 19.2 - height / 2;
  const topOffsetPct = top / 19.2 - style.watermarkTopPct;
  const selected = editorState.selected === 'watermark';
  const sizeHandle = selected ? '<span class="mot-phut-source-size-handle" data-size-handle="true" role="button" tabindex="0" title="Kéo xuống: chữ to hơn. Kéo lên: chữ nhỏ hơn.">A↕</span>' : '';
  return `<div class="mot-phut-source-drag mot-phut-source-brand ${selected ? 'selected' : ''}" role="button" tabindex="0" aria-label="Watermark: kéo để di chuyển" data-design-element="watermark" data-font-key="watermarkSizePx" data-brand-top-offset-pct="${topOffsetPct}" style="left:${left / 10.8}%;top:${top / 19.2}%;width:${width / 10.8}%;height:${height / 19.2}%">${sizeHandle}</div>`;
}

function geometryBoxMarkup() {
  const style = currentSettings();
  const isThumbnail = editorState.activeMode === 'thumbnail';
  if (isThumbnail && !visibleThumbnailLayer('headline')) return '';
  const box = isThumbnail
    ? { left: 'headlineLeftPct', top: 'headlineTopPct', width: 'headlineWidthPct', height: 'headlineHeightPct' }
    : { left: 'contentLeftPct', top: 'contentTopPct', width: 'contentWidthPct', height: 'contentHeightPct' };
  const role = isThumbnail ? 'headline' : 'content';
  const selected = editorState.selected === role;
  const handlesMarkup = selected ? handles.map(([id, cursor, position]) => `<span class="mot-phut-source-handle" data-handle="${id}" style="${position};cursor:${cursor}" aria-label="Kéo cạnh ${id}"></span>`).join('') : '';
  const fontKey = isThumbnail ? 'headlineMaxPx' : 'bodyMaxPx';
  const fontHandle = selected ? `<span class="mot-phut-source-size-handle" data-size-handle="true" role="button" tabindex="0" title="Kéo xuống: chữ to hơn. Kéo lên: chữ nhỏ hơn.">A↕</span>` : '';
  return `<div class="mot-phut-source-drag mot-phut-source-box ${selected ? 'selected' : ''} ${editorState.fitResult.fits ? '' : 'not-fit'}" role="button" tabindex="0" aria-label="Vùng ${role}: kéo để di chuyển" data-design-element="${role}" data-font-key="${fontKey}" style="left:${style[box.left]}%;top:${style[box.top]}%;width:${style[box.width]}%;height:${style[box.height]}%">${handlesMarkup}${fontHandle}</div>`;
}

function addDesignOverlay() {
  const canvas = $('#mot-phut-visual-canvas');
  if (editorState.previewTab !== 'design' || !canvas.querySelector('svg')) return;
  const overlay = document.createElement('div');
  overlay.className = 'mot-phut-source-overlay';
  overlay.innerHTML = `<div class="mot-phut-source-center-line" ${editorState.showSnapLine ? '' : 'hidden'}></div>${brandBoxMarkup()}${geometryBoxMarkup()}${watermarkBoxMarkup()}`;
  canvas.append(overlay);
  overlay.addEventListener('pointerdown', beginDrag);
  overlay.addEventListener('pointermove', moveDrag);
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);
  overlay.addEventListener('keydown', nudgeSelection);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) { editorState.selected = null; renderLayerList(); addDesignOverlayRefresh(); }
  });
  overlay.querySelectorAll('[data-design-element]').forEach((element) => element.addEventListener('focus', () => {
    if (editorState.selected === element.dataset.designElement) return;
    editorState.selected = element.dataset.designElement;
    renderLayerList();
    addDesignOverlayRefresh();
  }));
}

function addDesignOverlayRefresh() {
  const focusedElement = document.activeElement?.dataset?.designElement;
  $('#mot-phut-visual-canvas .mot-phut-source-overlay')?.remove();
  addDesignOverlay();
  if (focusedElement) $(`#mot-phut-visual-canvas [data-design-element="${focusedElement}"]`)?.focus({ preventScroll: true });
}

function geometryDefinition() {
  return editorState.activeMode === 'thumbnail'
    ? { left: 'headlineLeftPct', top: 'headlineTopPct', width: 'headlineWidthPct', height: 'headlineHeightPct', minWidth: 20, minHeight: 5 }
    : { left: 'contentLeftPct', top: 'contentTopPct', width: 'contentWidthPct', height: 'contentHeightPct', minWidth: 20, minHeight: 5 };
}

function dragResult(start, element, mode, dx, dy) {
  const next = { ...start };
  if (element === 'brand' || element === 'watermark') {
    const centerKey = element === 'brand' ? 'brandCenterXPct' : 'watermarkCenterXPct';
    const topKey = element === 'brand' ? 'brandTopPct' : 'watermarkTopPct';
    const rawX = clamp(start[centerKey] + dx, 2, 98);
    const snappedX = Math.abs(rawX - 50) <= 1.2 ? 50 : rawX;
    next[centerKey] = round(snappedX);
    const maxTop = element === 'brand' && editorState.activeMode === 'content' ? 40 : element === 'brand' ? 96 : 98;
    next[topKey] = round(clamp(start[topKey] + dy, 2, maxTop));
    return { style: next, snapped: snappedX === 50 };
  }
  const config = geometryDefinition();
  let left = start[config.left]; let top = start[config.top];
  let right = left + start[config.width]; let bottom = top + start[config.height];
  if (mode === 'move') {
    left = clamp(left + dx, 0, 100 - start[config.width]);
    const center = left + start[config.width] / 2;
    const snappedX = Math.abs(center - 50) <= 1.2 ? 50 : center;
    left = clamp(snappedX - start[config.width] / 2, 0, 100 - start[config.width]);
    top = clamp(top + dy, 0, 100 - start[config.height]);
    next[config.left] = round(left); next[config.top] = round(top);
    return { style: next, snapped: snappedX === 50 };
  }
  if (mode.includes('w')) left = clamp(left + dx, 0, right - config.minWidth);
  if (mode.includes('e')) right = clamp(right + dx, left + config.minWidth, 100);
  if (mode.includes('n')) top = clamp(top + dy, 0, bottom - config.minHeight);
  if (mode.includes('s')) bottom = clamp(bottom + dy, top + config.minHeight, 100);
  next[config.left] = round(left); next[config.top] = round(top);
  next[config.width] = round(right - left); next[config.height] = round(bottom - top);
  return { style: next, snapped: false };
}

function beginDrag(event) {
  const target = event.target.closest('[data-design-element]');
  if (!target) return;
  const element = target.dataset.designElement;
  const handle = event.target.closest('[data-handle]')?.dataset.handle;
  const sizeHandle = Boolean(event.target.closest('[data-size-handle]'));
  editorState.selected = element;
  renderLayerList();
  target.setPointerCapture?.(event.pointerId);
  for (const selectable of target.parentElement.querySelectorAll('[data-design-element]')) selectable.classList.toggle('selected', selectable === target);
  const box = $('#mot-phut-visual-canvas').getBoundingClientRect();
  editorState.drag = {
    pointerId: event.pointerId, element, fontKey: target.dataset.fontKey, mode: sizeHandle ? 'size' : handle || 'move',
    x: event.clientX, y: event.clientY, width: box.width, height: box.height, start: clone(elementSettings(element))
  };
  event.preventDefault(); event.stopPropagation(); target.classList.add('selected');
}

function moveDrag(event) {
  const drag = editorState.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dx = (event.clientX - drag.x) / drag.width * 100;
  const dy = (event.clientY - drag.y) / drag.height * 100;
  const settings = elementSettings(drag.element);
  let snapped = false;
  if (drag.mode === 'size') {
    const key = drag.fontKey || (drag.element === 'headline' ? 'headlineMaxPx' : 'bodyMaxPx');
    const limits = key === 'brandSizePx' ? [12, editorState.activeMode === 'content' ? 120 : 200] : key === 'watermarkSizePx' ? [10, 120] : key === 'bodyMaxPx' ? [34, 80] : [40, 300];
    settings[key] = Math.round(clamp(drag.start[key] + dy * 10, limits[0], limits[1]));
  } else {
    const result = dragResult(drag.start, drag.element, drag.mode, dx, dy);
    Object.assign(settings, result.style);
    snapped = result.snapped;
  }
  editorState.showSnapLine = snapped;
  const overlay = $('#mot-phut-visual-canvas .mot-phut-source-overlay');
  const sharedSettings = currentSettings();
  for (const [id, centerKey, topKey] of [['brand', 'brandCenterXPct', 'brandTopPct'], ['watermark', 'watermarkCenterXPct', 'watermarkTopPct']]) {
    const textLayer = overlay.querySelector(`[data-design-element="${id}"]`);
    if (!textLayer) continue;
    const widthPct = textLayer.getBoundingClientRect().width / Math.max(1, drag.width) * 100;
    textLayer.style.left = `${sharedSettings[centerKey] - widthPct / 2}%`;
    textLayer.style.top = `${sharedSettings[topKey] + Number(textLayer.dataset.brandTopOffsetPct || 0)}%`;
  }
  const config = geometryDefinition();
  const role = editorState.activeMode === 'thumbnail' ? 'headline' : 'content';
  const element = overlay.querySelector(`[data-design-element="${role}"]`);
  if (element) {
    element.style.left = `${currentSettings()[config.left]}%`;
    element.style.top = `${currentSettings()[config.top]}%`;
    element.style.width = `${currentSettings()[config.width]}%`;
    element.style.height = `${currentSettings()[config.height]}%`;
  }
  const centerLine = overlay.querySelector('.mot-phut-source-center-line');
  if (centerLine) centerLine.hidden = !snapped;
}

function endDrag(event) {
  if (!editorState.drag || editorState.drag.pointerId !== event.pointerId) return;
  editorState.drag = null;
  editorState.showSnapLine = false;
  if (editorState.selected === 'headline' || editorState.selected === 'content') keepBoxInside(currentSettings());
  renderControls();
  markDirty();
  schedulePreview();
}

function nudgeSelection(event) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !editorState.selected) return;
  const step = event.shiftKey ? 2 : 0.2;
  const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
  const settings = elementSettings(editorState.selected);
  const result = dragResult(clone(settings), editorState.selected, 'move', dx, dy);
  Object.assign(settings, result.style);
  if (editorState.selected === 'headline' || editorState.selected === 'content') keepBoxInside(settings);
  renderControls(); markDirty(); event.preventDefault();
}

async function openEditor(mode) {
  if (!await loadDesign(true)) return;
  editorState.activeMode = mode;
  editorState.selected = mode === 'thumbnail'
    ? (visibleThumbnailLayer('headline') ? 'headline' : firstVisibleThumbnailLayer())
    : 'content';
  editorState.previewTab = 'design';
  clearLastRender();
  $('#mot-phut-visual-dialog').hidden = false;
  document.body.classList.add('mot-phut-visual-dialog-open');
  updateTabs();
  setPreviewTabButtonsOnly('design');
  await renderDesignPreview();
  scaleCanvas();
  $('#mot-phut-visual-close').focus();
}

function closeEditor(discard = true) {
  clearTimeout(editorState.previewTimer);
  editorState.previewSequence += 1;
  if (discard && editorState.savedDesign) {
    editorState.design = clone(editorState.savedDesign);
    editorState.dirty = false;
    renderControls();
  }
  if (discard) restorePreviewSamples();
  clearLastRender();
  releaseDesignRasterPreview();
  editorState.previewTab = 'design';
  $('#mot-phut-visual-dialog').hidden = true;
  document.body.classList.remove('mot-phut-visual-dialog-open');
  if (editorState.design) {
    $('#mot-phut-visual-preset').value = editorState.design.preset;
    $('#mot-phut-visual-enabled').checked = editorState.design.enabled !== false;
    void refreshCardPreviews();
  }
}

function clearLastRender() {
  if (editorState.lastRender?.imageUrl) releasePreviewUrl(editorState.lastRender.imageUrl);
  editorState.lastRender = null;
}

async function saveDesign(useForNewVideos = false) {
  if (!editorState.design || editorState.saving) return;
  editorState.saving = true;
  const submittedDesign = clone(editorState.design);
  const dialog = $('#mot-phut-visual-dialog');
  dialog?.setAttribute('aria-busy', 'true');
  const lockedControls = [
    $('#mot-phut-visual-preset'), $('#mot-phut-visual-enabled'),
    ...$('#mot-phut-visual-controls-root').querySelectorAll('[data-design-key]'),
    ...$('#mot-phut-visual-layer-list').querySelectorAll('button'),
    $('#mot-phut-visual-save'), $('#mot-phut-visual-save-settings'),
    $('#mot-phut-visual-default'), $('#mot-phut-visual-render'), $('#mot-phut-visual-cancel'), $('#mot-phut-visual-close')
  ].filter(Boolean);
  const priorDisabled = lockedControls.map((control) => control.disabled);
  lockedControls.forEach((control) => { control.disabled = true; });
  const saveButtons = [$('#mot-phut-visual-save'), $('#mot-phut-visual-save-settings')].filter(Boolean);
  const priorSaveLabels = saveButtons.map((control) => control.textContent);
  saveButtons.forEach((control) => { control.textContent = 'Đang lưu…'; });
  const overlay = $('#mot-phut-visual-canvas .mot-phut-source-overlay');
  const priorPointerEvents = overlay?.style.pointerEvents;
  if (overlay) overlay.style.pointerEvents = 'none';
  editorState.design.schemaVersion = 4;
  editorState.design.enabled = useForNewVideos ? true : $('#mot-phut-visual-enabled').checked;
  submittedDesign.schemaVersion = 4;
  submittedDesign.enabled = editorState.design.enabled;
  try {
    const result = await api('/visual-design', { method: 'PUT', body: JSON.stringify(submittedDesign) });
    const persisted = await api('/visual-design');
    if (JSON.stringify(persisted.design) !== JSON.stringify(result.design)) {
      throw new Error('Máy chủ chưa xác nhận được thiết kế đã lưu. Hãy thử lưu lại.');
    }
    editorState.design = persisted.design;
    editorState.savedDesign = clone(persisted.design);
    editorState.dirty = false;
    persistPreviewSamples();
    $('#mot-phut-visual-preset').value = persisted.design.preset;
    $('#mot-phut-visual-enabled').checked = persisted.design.enabled;
    syncControlsFromDesign();
    await refreshCardPreviews();
    if (editorState.previewTab === 'design' && !$('#mot-phut-visual-dialog').hidden) await renderDesignPreview();
    status(
      useForNewVideos
        ? 'Đã lưu thiết kế đang mở và bật áp dụng cho video Một Phút Vỡ Lẽ mới. Bạn vẫn ở đúng mục để xem lại hoặc chỉnh tiếp.'
        : 'Đã lưu thiết kế Thumbnail và Nội dung cho video Một Phút Vỡ Lẽ mới.',
      false,
      useForNewVideos ? '#mot-phut-visual-dialog-status' : '#mot-phut-visual-status'
    );
  } catch (error) { status(error.message, true, useForNewVideos ? '#mot-phut-visual-dialog-status' : '#mot-phut-visual-status'); }
  finally {
    dialog?.removeAttribute('aria-busy');
    lockedControls.forEach((control, index) => { control.disabled = priorDisabled[index]; });
    saveButtons.forEach((control, index) => { control.textContent = priorSaveLabels[index]; });
    if (overlay) overlay.style.pointerEvents = priorPointerEvents;
    editorState.saving = false;
  }
}

async function renderNow() {
  const button = $('#mot-phut-visual-render');
  button.disabled = true;
  editorState.previewSequence += 1;
  setPreviewTabButtonsOnly('render');
  releaseDesignRasterPreview();
  $('#mot-phut-visual-canvas').innerHTML = '<p class="mot-phut-visual-loading">Đang render bằng renderer MPVL…</p>';
  status('Đang render ảnh thử…', false, '#mot-phut-visual-dialog-status');
  try {
    const imageUrl = await requestRasterPreview();
    clearLastRender();
    editorState.lastRender = { imageUrl, key: currentKey(), mode: editorState.activeMode };
    showLastRender();
    status('Render thử hoàn tất.', false, '#mot-phut-visual-dialog-status');
  } catch (error) {
    $('#mot-phut-visual-canvas').innerHTML = `<p class="mot-phut-visual-error">${escapeHtml(error.message)}</p>`;
    status(error.message, true, '#mot-phut-visual-dialog-status');
  } finally { button.disabled = !editorState.fitResult.fits; }
}

function applyPresetToDesign(design, presetId) {
  const colors = defaultsByPreset[presetId] || defaultsByPreset['vintage-paper'];
  design.preset = presetId;
  for (const mode of ['thumbnail', 'content']) {
    design[mode].background = colors.background;
    design[mode].paperColor = colors.background;
    design[mode].accent = colors.accent;
    design[mode].textColor = colors.textColor;
  }
  Object.assign(design.thumbnail, { brandColorA: colors.brandColor, brandColorB: colors.accent, highlightColor: colors.highlightColor });
  Object.assign(design.content, { mutedColor: colors.mutedColor, brandColor: colors.brandColor, bodyColor: colors.textColor });
  return design;
}

function applyPreset(presetId) {
  if (!editorState.design) return;
  applyPresetToDesign(editorState.design, presetId);
  renderControls();
  markDirty();
  schedulePreview();
  void refreshCardPreviews();
}

function resetMode() {
  if (!editorState.design || !editorState.defaults) return;
  const base = applyPresetToDesign(clone(editorState.defaults), editorState.design.preset);
  editorState.design[editorState.activeMode] = clone(base[editorState.activeMode]);
  renderControls();
  markDirty();
  schedulePreview();
}

function normalizeColor(value) { return /^#[0-9a-f]{6}$/iu.test(String(value || '')) ? value : '#ffffff'; }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }

$('#shadowing-content-profile').addEventListener('change', (event) => setProfile(event.currentTarget.value));
$('#mot-phut-visual-preset').addEventListener('change', (event) => applyPreset(event.currentTarget.value));
$('#mot-phut-visual-enabled').addEventListener('change', () => { if (editorState.design) editorState.design.enabled = $('#mot-phut-visual-enabled').checked; });
$('#mot-phut-visual-save-settings').addEventListener('click', () => void saveDesign(false));
$('#mot-phut-visual-save').addEventListener('click', () => void saveDesign(true));
$('#mot-phut-visual-render').addEventListener('click', () => void renderNow());
$('#mot-phut-visual-default').addEventListener('click', resetMode);
$('#mot-phut-visual-cancel').addEventListener('click', () => { if (!editorState.saving) closeEditor(true); });
$('#mot-phut-visual-close').addEventListener('click', () => { if (!editorState.saving) closeEditor(true); });
$('#mot-phut-visual-tab-design').addEventListener('click', () => setPreviewTab('design'));
$('#mot-phut-visual-tab-render').addEventListener('click', () => setPreviewTab('render'));
$('#mot-phut-visual-dialog').addEventListener('pointerdown', (event) => { if (event.target === event.currentTarget && !editorState.saving) closeEditor(true); });
$('#mot-phut-visual-layer-list').addEventListener('click', (event) => {
  const select = event.target.closest('[data-layer-select]');
  if (select && !select.disabled) {
    editorState.selected = select.dataset.layerSelect;
    renderLayerList();
    addDesignOverlayRefresh();
    return;
  }
  const action = event.target.closest('[data-layer-action]');
  if (action) changeThumbnailLayerVisibility(action.dataset.layerId, action.dataset.layerAction === 'restore');
});
document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-mot-phut-edit]');
  if (button) void openEditor(button.dataset.motPhutEdit);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#mot-phut-visual-dialog').hidden) { if (!editorState.saving) closeEditor(true); return; }
  if (!['Delete', 'Backspace'].includes(event.key) || $('#mot-phut-visual-dialog').hidden || editorState.activeMode !== 'thumbnail') return;
  if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (editorState.selected && visibleThumbnailLayer(editorState.selected)) {
    event.preventDefault();
    changeThumbnailLayerVisibility(editorState.selected, false);
  }
});
window.addEventListener('resize', () => { if (!$('#mot-phut-visual-dialog').hidden) scaleCanvas(); });
window.addEventListener('beforeunload', () => editorState.previewUrls.forEach(URL.revokeObjectURL));
document.addEventListener('DOMContentLoaded', () => {
  if (new URLSearchParams(location.search).get('scope') === 'mot-phut-vo-le') {
    $('#shadowing-editor-button').click();
    requestAnimationFrame(() => setProfile('mot-phut-vo-le'));
  }
});
