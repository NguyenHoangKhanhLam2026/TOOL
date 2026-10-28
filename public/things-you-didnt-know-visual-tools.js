const $ = (selector) => document.querySelector(selector);
const api = async (url, options = {}) => {
  const response = await fetch(url, options);
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
};

const fields = {
  thumbnail: [
    { title: 'Thumbnail đầu video', fields: [
      { key: 'introSeconds', label: 'Thời lượng Thumbnail đầu video (giây, 0 = không có)', type: 'number', min: 0, max: 10, step: 0.1 }
    ] },
    { title: 'Tên Page', fields: [
      { key: 'brandColorA', label: 'Màu nửa đầu', type: 'color' },
      { key: 'brandColorB', label: 'Màu nửa sau', type: 'color' },
      { key: 'brandSizePx', label: 'Cỡ chữ (px)', type: 'number', min: 12, max: 200, slider: true },
      { key: 'brandCenterXPct', label: 'Vị trí ngang (%)', type: 'number', min: 0, max: 100, step: 0.5 },
      { key: 'brandTopPct', label: 'Vị trí dọc (%)', type: 'number', min: 0, max: 100, step: 0.5 }
    ] },
    { title: 'Headline', fields: [
      { key: 'textColor', label: 'Màu chữ', type: 'color' },
      { key: 'highlightColor', label: 'Màu từ nổi bật', type: 'color' },
      { key: 'outlineColor', label: 'Màu viền chữ', type: 'color' },
      { key: 'headlineMaxPx', label: 'Cỡ chữ cố định (px)', type: 'number', min: 40, max: 400, slider: true },
      { key: 'headlineFont', label: 'Font', type: 'select', options: [['display', 'display (poster đậm)'], ['serif', 'serif (có chân)']] },
      { key: 'headlineLeftPct', label: 'Trái (%)', type: 'number', min: 0, max: 80, step: 0.5, group: 'geometry' },
      { key: 'headlineTopPct', label: 'Trên (%)', type: 'number', min: 0, max: 90, step: 0.5, group: 'geometry' },
      { key: 'headlineWidthPct', label: 'Rộng (%)', type: 'number', min: 20, max: 100, group: 'geometry' },
      { key: 'headlineHeightPct', label: 'Cao (%)', type: 'number', min: 5, max: 90, step: 0.5, group: 'geometry' }
    ] },
    { title: 'Nền giấy', fields: [
      { key: 'paperColor', label: 'Màu nền', type: 'color' },
      { key: 'vignette', label: 'Độ tối viền ảnh', type: 'number', min: 0, max: 1, step: 0.05, slider: true },
      { key: 'bottomShade', label: 'Độ tối phía dưới', type: 'number', min: 0, max: 1, step: 0.05, slider: true }
    ] }
  ],
  content: [
    { title: 'Tên Page', fields: [
      { key: 'brandColor', label: 'Màu chữ', type: 'color' },
      { key: 'brandSizePx', label: 'Cỡ chữ (px)', type: 'number', min: 12, max: 200, slider: true },
      { key: 'brandCenterXPct', label: 'Vị trí ngang (%)', type: 'number', min: 0, max: 100, step: 0.5 },
      { key: 'brandTopPct', label: 'Vị trí dọc (%)', type: 'number', min: 0, max: 100, step: 0.5 }
    ] },
    { title: 'Tiêu đề', fields: [
      { key: 'contentTitleMaxPx', label: 'Cỡ chữ lớn nhất (px)', type: 'number', min: 22, max: 240, slider: true },
      { key: 'contentTitleFont', label: 'Font chữ', type: 'select', options: [['serif', 'serif (có chân)'], ['sans', 'Arial (không chân)'], ['display', 'display (poster đậm)']] },
      { key: 'contentTitleLeftPct', label: 'Trái (%)', type: 'number', min: 0, max: 80, step: 0.5, group: 'geometry' },
      { key: 'contentTitleTopPct', label: 'Trên (%)', type: 'number', min: 0, max: 90, step: 0.5, group: 'geometry' },
      { key: 'contentTitleWidthPct', label: 'Rộng (%)', type: 'number', min: 20, max: 100, step: 0.5, group: 'geometry' },
      { key: 'contentTitleHeightPct', label: 'Cao (%)', type: 'number', min: 5, max: 50, step: 0.5, group: 'geometry' }
    ] },
    { title: 'Nội dung', fields: [
      { key: 'bodyColor', label: 'Màu chữ', type: 'color' },
      { key: 'bodyMaxPx', label: 'Cỡ chữ lớn nhất (px)', type: 'number', min: 22, max: 120, slider: true },
      { key: 'bodyFont', label: 'Font', type: 'select', options: [['sans', 'Arial đậm'], ['serif', 'serif (có chân)'], ['display', 'display (poster đậm)']] },
      { key: 'bodyLineSpacing', label: 'Khoảng cách dòng (× cỡ chữ)', type: 'number', min: 1.1, max: 2, step: 0.01, slider: true },
      { key: 'bodyWordSpacingEm', label: 'Khoảng cách từ (em)', type: 'number', min: 0.1, max: 0.6, step: 0.01, slider: true },
      { key: 'contentLeftPct', label: 'Trái (%)', type: 'number', min: 0, max: 80, step: 0.5, group: 'geometry' },
      { key: 'contentTopPct', label: 'Trên (%)', type: 'number', min: 0, max: 90, step: 0.5, group: 'geometry' },
      { key: 'contentWidthPct', label: 'Rộng (%)', type: 'number', min: 20, max: 100, group: 'geometry' },
      { key: 'contentHeightPct', label: 'Cao (%)', type: 'number', min: 5, max: 90, step: 0.5, group: 'geometry' }
    ] },
    { title: 'Tên Page cuối video', fields: [
      { key: 'footerSizePx', label: 'Cỡ chữ (px)', type: 'number', min: 12, max: 200, slider: true },
      { key: 'footerCenterXPct', label: 'Vị trí ngang (%)', type: 'number', min: 0, max: 100, step: 0.5 },
      { key: 'footerTopPct', label: 'Vị trí dọc (%)', type: 'number', min: 0, max: 100, step: 0.5 }
    ] },
    { title: 'Nền giấy', fields: [
      { key: 'paperColor', label: 'Màu nền', type: 'color' },
      { key: 'vignette', label: 'Độ tối viền ảnh', type: 'number', min: 0, max: 1, step: 0.05, slider: true }
    ] }
  ]
};

const thumbnailGeometry = {
  left: 'headlineLeftPct', top: 'headlineTopPct', width: 'headlineWidthPct', height: 'headlineHeightPct', minWidth: 20, minHeight: 5
};
const contentGeometry = {
  left: 'contentLeftPct', top: 'contentTopPct', width: 'contentWidthPct', height: 'contentHeightPct', minWidth: 20, minHeight: 10
};
const titleGeometry = {
  left: 'contentTitleLeftPct', top: 'contentTitleTopPct', width: 'contentTitleWidthPct', height: 'contentTitleHeightPct', minWidth: 20, minHeight: 5
};
const handles = [
  ['nw', 'nwse-resize', 'left:-6px;top:-6px'], ['n', 'ns-resize', 'left:calc(50% - 5px);top:-6px'],
  ['ne', 'nesw-resize', 'right:-6px;top:-6px'], ['e', 'ew-resize', 'right:-6px;top:calc(50% - 5px)'],
  ['se', 'nwse-resize', 'right:-6px;bottom:-6px'], ['s', 'ns-resize', 'left:calc(50% - 5px);bottom:-6px'],
  ['sw', 'nesw-resize', 'left:-6px;bottom:-6px'], ['w', 'ew-resize', 'left:-6px;top:calc(50% - 5px)']
];

const canvas = $('#tydk-shadowing-visual-canvas');
const controlsRoot = $('#tydk-shadowing-visual-controls');
const sampleRoot = $('#tydk-shadowing-visual-samples');
let design = null;
let defaults = null;
let savedDesign = null;
let activeMode = 'thumbnail';
let previewTab = 'design';
let previewTimer = null;
let resizeObserver = null;
let dirty = false;
let saving = false;
let selected = 'headline';
let fitResult = { fits: true, size: 0 };
let lastRender = null;
let drag = null;
let svgInstance = 0;
let contentDesignEnabled = false;
const THUMBNAIL_SAMPLE_STORAGE_KEY = 'things-you-didnt-know.visual-thumbnail-sample.v1';
const THUMBNAIL_SAMPLE_DEFAULTS = {
  thumbnailBrand: "Things You Didn\'t Know",
  thumbnailTitle: 'A Quiet Umbrella Custom',
  thumbnailHighlight: 'umbrella custom'
};
function readThumbnailSample() {
  try {
    const stored = JSON.parse(localStorage.getItem(THUMBNAIL_SAMPLE_STORAGE_KEY) || 'null');
    if (!stored || typeof stored !== 'object') return { ...THUMBNAIL_SAMPLE_DEFAULTS };
    return Object.fromEntries(Object.entries(THUMBNAIL_SAMPLE_DEFAULTS).map(([key, fallback]) => [
      key,
      typeof stored[key] === 'string'
        ? stored[key].slice(0, key === 'thumbnailTitle' ? 120 : key === 'thumbnailBrand' ? 60 : 200)
        : fallback
    ]));
  } catch { return { ...THUMBNAIL_SAMPLE_DEFAULTS }; }
}
const sample = {
  ...readThumbnailSample(),
  contentBrand: "Things You Didn\'t Know",
  contentTitle: 'A Quiet Umbrella Custom',
  contentParagraphs: 'In some neighborhoods, shared umbrellas wait near community entrances for anyone caught in the rain.\nA person can borrow one and return it later, making a sudden shower easier to manage.\nThe practice turns an ordinary object into a small sign of trust between neighbors.'
};
let savedThumbnailSample = {
  thumbnailBrand: sample.thumbnailBrand,
  thumbnailTitle: sample.thumbnailTitle,
  thumbnailHighlight: sample.thumbnailHighlight
};

function persistThumbnailSample() {
  savedThumbnailSample = {
    thumbnailBrand: sample.thumbnailBrand,
    thumbnailTitle: sample.thumbnailTitle,
    thumbnailHighlight: sample.thumbnailHighlight
  };
  try { localStorage.setItem(THUMBNAIL_SAMPLE_STORAGE_KEY, JSON.stringify(savedThumbnailSample)); } catch { /* Keep the design usable if browser storage is unavailable. */ }
}

function restoreThumbnailSample() { Object.assign(sample, savedThumbnailSample); }

const clone = (value) => JSON.parse(JSON.stringify(value));
const currentSettings = () => design?.[activeMode];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 10) / 10;
const currentSample = (mode = activeMode) => mode === 'thumbnail'
  ? { brand: sample.thumbnailBrand, thumbnailTitle: sample.thumbnailTitle, thumbnailHighlight: sample.thumbnailHighlight }
  : { brand: sample.contentBrand, title: sample.contentTitle, scriptText: sample.contentParagraphs.split('\n').filter((line) => line.trim()).join(' ') };
const currentKey = (mode = activeMode) => JSON.stringify([mode, design?.[mode], currentSample(mode)]);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function scopeSvgMarkup(markup) {
  const prefix = `tydk-svg-${++svgInstance}-`;
  return markup
    .replace(/\bid="([^"]+)"/gu, (_match, id) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]*)\)/gu, (_match, id) => `url(#${prefix}${id})`)
    .replace(/\b(href|xlink:href)="#([^"]+)"/gu, (_match, attribute, id) => `${attribute}="#${prefix}${id}"`);
}

function setStatus(message, error = false) {
  const status = $('#tydk-shadowing-visual-status');
  status.textContent = message;
  status.classList.toggle('error', error);
}

function setPreviewTab(tab) {
  previewTab = tab;
  for (const name of ['design', 'render']) {
    const button = $(`#tydk-shadowing-visual-tab-${name}`);
    const active = tab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
  if (tab === 'design') void renderDesignPreview();
  else showLastRender();
}

function scaleCanvas() {
  const area = canvas.parentElement;
  if (!area) return;
  const tabsHeight = $('.tydk-shadowing-visual-render-tabs')?.offsetHeight || 0;
  const noteHeight = $('#tydk-shadowing-visual-fit-note')?.offsetHeight || 0;
  const scale = Math.min((area.clientWidth - 24) / 1080, (area.clientHeight - tabsHeight - noteHeight - 24) / 1920);
  if (Number.isFinite(scale) && scale > 0) {
    canvas.style.width = `${Math.round(1080 * scale)}px`;
    canvas.style.height = `${Math.round(1920 * scale)}px`;
  }
}

function updateTabs() {
  const isThumb = activeMode === 'thumbnail';
  $('#tydk-shadowing-visual-dialog-title').textContent = isThumb ? 'Thiết kế thumbnail' : 'Thiết kế nội dung';
  $('#tydk-shadowing-visual-dialog-help').textContent = isThumb
    ? 'Kéo tên Page và vùng headline trên ảnh. Bấm “Render thử” để xem ảnh do server vẽ.'
    : 'Kéo tên Page và vùng nội dung trên ảnh. Bấm “Render thử” để xem ảnh do server vẽ.';
  $('#tydk-shadowing-visual-controls-heading').textContent = isThumb ? 'Thiết kế thumbnail' : 'Thiết kế nội dung';
  renderSampleInputs();
  renderControls();
}

function colorInputValue(value) {
  const hex = String(value || '#000000');
  if (/^#[\da-f]{3}$/iu.test(hex)) return `#${[...hex.slice(1)].map((part) => part + part).join('')}`;
  return /^#[\da-f]{6}$/iu.test(hex) ? hex : '#000000';
}

function fieldVisible(field) {
  if (!field.when) return true;
  const [key, expected] = field.when.split('=');
  return String(currentSettings()?.[key]) === expected;
}

function fieldMarkup(field) {
  if (field.type === 'note') return `<p class="tydk-shadowing-visual-source-note">${escapeHtml(field.text)}</p>`;
  if (!fieldVisible(field)) return '';
  const value = currentSettings()[field.key];
  const key = escapeHtml(field.key);
  const label = escapeHtml(field.label);
  if (field.type === 'checkbox') {
    return `<label class="tydk-shadowing-visual-source-checkbox"><input type="checkbox" data-design-key="${key}" ${value ? 'checked' : ''}/><span>${label}</span></label>`;
  }
  if (field.type === 'color') {
    return `<label class="tydk-shadowing-visual-source-field"><span>${label}</span><span class="tydk-shadowing-visual-color-row"><input type="color" data-design-key="${key}" value="${colorInputValue(value)}" aria-label="${label}"/><input type="text" data-design-key="${key}" data-color-text="true" value="${escapeHtml(value)}" maxlength="7" aria-label="${label} (mã màu)"/></span></label>`;
  }
  if (field.type === 'select') {
    const options = field.options.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${value === optionValue ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>`).join('');
    return `<label class="tydk-shadowing-visual-source-field"><span>${label}</span><select data-design-key="${key}">${options}</select></label>`;
  }
  const step = field.step || 1;
  const slider = field.slider
    ? `<input type="range" data-design-key="${key}" min="${field.min}" max="${field.max}" step="${step}" value="${value}" aria-label="${label}"/>`
    : '';
  const number = `<input type="number" data-design-key="${key}" min="${field.min}" max="${field.max}" step="${step}" value="${value}" aria-label="${label}"/>`;
  return `<label class="tydk-shadowing-visual-source-field"><span>${label}</span><span class="tydk-shadowing-visual-number-row">${slider}${number}</span></label>`;
}

function groupMarkup(group) {
  let markup = '';
  for (let index = 0; index < group.fields.length;) {
    if (group.fields[index].group === 'geometry') {
      const geometry = [];
      while (group.fields[index]?.group === 'geometry') geometry.push(group.fields[index++]);
      markup += `<div class="tydk-shadowing-visual-geometry-grid">${geometry.map(fieldMarkup).join('')}</div>`;
    } else {
      markup += fieldMarkup(group.fields[index++]);
    }
  }
  return `<section class="tydk-shadowing-visual-control-group"><h4>${escapeHtml(group.title)}</h4><div class="tydk-shadowing-visual-controls-grid">${markup}</div></section>`;
}

function layerOptions() {
  return activeMode === 'thumbnail'
    ? [['brand', 'Tên Page'], ['headline', 'Headline']]
    : [['brand', 'Tên Page đầu'], ['title', 'Tiêu đề'], ['content', 'Thân nội dung'], ['footer', 'Tên Page cuối']];
}

function layerSelectorMarkup() {
  const layers = layerOptions();
  if (!layers.some(([value]) => value === selected)) selected = activeMode === 'thumbnail' ? 'headline' : 'content';
  return `<section class="tydk-shadowing-visual-layer-picker"><label for="tydk-shadowing-visual-layer">Layer đang chọn</label><select id="tydk-shadowing-visual-layer">${layers.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('')}</select><small>Kéo layer để di chuyển. Lăn chuột để phóng to hoặc thu nhỏ layer đang chọn.</small></section>`;
}

function renderControls() {
  if (!design) return;
  controlsRoot.innerHTML = `${layerSelectorMarkup()}${fields[activeMode].map(groupMarkup).join('')}`;
  $('#tydk-shadowing-visual-layer').addEventListener('change', (event) => {
    selected = event.currentTarget.value;
    addDesignOverlayRefresh();
  });
  for (const input of controlsRoot.querySelectorAll('[data-design-key]')) {
    input.addEventListener('input', handleControlChange);
    input.addEventListener('change', handleControlChange);
  }
  $('#tydk-shadowing-visual-enabled').checked = design.enabled === true;
  updateScopeLabel();
}

function updateScopeLabel() {
  const label = $('#tydk-shadowing-visual-enabled-label');
  const description = $('#tydk-shadowing-visual-tools-description');
  const caption = $('#tydk-shadowing-visual-source-caption');
  if (!design) return;
  if (label) {
    label.textContent = design.thumbnailOnly
      ? 'Dùng riêng thiết kế Thumbnail này cho video Things You Didn\'t Know mới'
      : 'Dùng thiết kế Thumbnail và Nội dung cho video Things You Didn\'t Know mới';
  }
  if (!design.enabled) {
    if (description) description.textContent = design.thumbnailOnly
      ? 'Thiết kế Thumbnail đang tắt. Bật để áp dụng riêng Thumbnail; Nội dung giữ cấu hình có sẵn của tool.'
      : 'Thiết kế Thumbnail và Nội dung đang tắt. Bật để áp dụng thiết kế đã lưu cho video mới.';
    if (caption) caption.textContent = design.thumbnailOnly
      ? 'Thiết kế Thumbnail đã lưu riêng nhưng chưa áp dụng cho video mới.'
      : 'Thiết kế Thumbnail và Nội dung đã lưu nhưng chưa áp dụng cho video mới.';
  } else if (design.thumbnailOnly) {
    if (description) description.textContent = 'Thiết kế tùy chỉnh chỉ áp dụng cho Thumbnail. Nội dung tiếp tục dùng cấu hình có sẵn của tool.';
    if (caption) caption.textContent = `Đang áp dụng riêng Thumbnail cho video Things You Didn\'t Know mới. Nội dung giữ cấu hình của tool. Thumbnail mở đầu: ${design.thumbnail.introSeconds} giây.`;
  } else {
    if (description) description.textContent = 'Thiết kế tùy chỉnh áp dụng cho Thumbnail và Nội dung của video Things You Didn\'t Know mới.';
    if (caption) caption.textContent = 'Đang áp dụng thiết kế Thumbnail và Nội dung cho video Things You Didn\'t Know mới.';
  }
}

function syncControlsFromDesign() {
  const settings = currentSettings();
  if (!settings) return;
  for (const input of controlsRoot.querySelectorAll('[data-design-key]')) {
    const value = settings[input.dataset.designKey];
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else if (document.activeElement !== input) input.value = value;
  }
  $('#tydk-shadowing-visual-enabled').checked = design.enabled === true;
  renderFitNote();
}

function renderSampleInputs() {
  if (!design) return;
  if (activeMode === 'thumbnail') {
    sampleRoot.innerHTML = `<section class="tydk-shadowing-visual-sample-group"><h4>Nội dung mẫu (chỉ để xem thử)</h4><label class="tydk-shadowing-visual-source-field"><span>Tên Page</span><input type="text" data-sample-key="thumbnailBrand" value="${escapeHtml(sample.thumbnailBrand)}" maxlength="60"/></label><label class="tydk-shadowing-visual-source-field"><span>Headline mẫu</span><input type="text" data-sample-key="thumbnailTitle" value="${escapeHtml(sample.thumbnailTitle)}" maxlength="120"/></label><label class="tydk-shadowing-visual-source-field"><span>Từ nổi bật</span><span class="tydk-shadowing-visual-source-hint">Cách nhau bằng dấu cách.</span><input type="text" data-sample-key="thumbnailHighlight" value="${escapeHtml(sample.thumbnailHighlight)}"/></label></section>`;
  } else {
    sampleRoot.innerHTML = `<section class="tydk-shadowing-visual-sample-group"><h4>Nội dung mẫu (chỉ để xem thử)</h4><label class="tydk-shadowing-visual-source-field"><span>Tên Page</span><input type="text" data-sample-key="contentBrand" value="${escapeHtml(sample.contentBrand)}" maxlength="60"/></label><label class="tydk-shadowing-visual-source-field"><span>Tiêu đề mẫu</span><input type="text" data-sample-key="contentTitle" value="${escapeHtml(sample.contentTitle)}" maxlength="120"/></label><label class="tydk-shadowing-visual-source-field"><span>Đoạn văn mẫu</span><span class="tydk-shadowing-visual-source-hint">Nội dung tự xuống dòng theo vùng thiết kế; dấu câu được giữ liền với từ.</span><textarea data-sample-key="contentParagraphs" rows="4">${escapeHtml(sample.contentParagraphs)}</textarea></label></section>`;
  }
  for (const input of sampleRoot.querySelectorAll('[data-sample-key]')) {
    input.addEventListener('input', (event) => {
      sample[event.currentTarget.dataset.sampleKey] = event.currentTarget.value;
      schedulePreview();
      renderFitNote();
    });
  }
}

function rangeDefinition(key) {
  return fields[activeMode].flatMap((group) => group.fields).find((field) => field.key === key);
}

function upgradeDesignToIndependentLayers(value) {
  const upgraded = clone(value);
  const content = upgraded.content;
  const previousTop = Number(content.contentTopPct);
  const previousHeight = Number(content.contentHeightPct);
  content.contentTitleLeftPct = content.contentLeftPct;
  content.contentTitleTopPct = round(previousTop + previousHeight * 0.1);
  content.contentTitleWidthPct = content.contentWidthPct;
  content.contentTitleHeightPct = round(clamp(previousHeight * 0.14, 5, 50));
  content.contentTitleMaxPx = Math.round(content.bodyMaxPx * 1.45);
  content.contentTopPct = round(previousTop + previousHeight * 0.24);
  content.contentHeightPct = round(previousHeight * 0.76);
  content.footerCenterXPct = content.brandCenterXPct;
  content.footerTopPct = round(100 - content.brandTopPct - (content.brandSizePx * 1.16) / 19.2);
  content.footerSizePx = content.brandSizePx;
  upgraded.schemaVersion = 4;
  return upgraded;
}

function keepBoxInside(style, box = activeMode === 'thumbnail' ? thumbnailGeometry : contentGeometry) {
  style[box.left] = round(clamp(style[box.left], 0, 100 - style[box.width]));
  style[box.top] = round(clamp(style[box.top], 0, 100 - style[box.height]));
  return style;
}

function geometryForKey(key) {
  return [thumbnailGeometry, titleGeometry, contentGeometry].find((box) => Object.values(box).includes(key)) || null;
}

function handleControlChange(event) {
  const input = event.currentTarget;
  const key = input.dataset.designKey;
  const field = rangeDefinition(key);
  if (!field) return;
  let value = input.value;
  if (field.type === 'checkbox') {
    value = input.checked;
  } else if (field.type === 'number') {
    if (value === '') return;
    value = Number(value);
    if (!Number.isFinite(value)) return;
    value = clamp(value, field.min, field.max);
    const precision = (String(field.step || 1).split('.')[1] || '').length;
    const factor = 10 ** precision;
    value = Math.round(value * factor) / factor;
  } else if (field.type === 'color') {
    if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/iu.test(value)) {
      input.classList.add('invalid');
      return;
    }
    value = value.toUpperCase();
    input.classList.remove('invalid');
  }
  currentSettings()[key] = value;
  design.schemaVersion = 5;
  if (field.group === 'geometry') keepBoxInside(currentSettings(), geometryForKey(key));
  syncPairedInputs(key, value);
  markDirty();
  schedulePreview();
}

function syncPairedInputs(key, value) {
  for (const input of controlsRoot.querySelectorAll(`[data-design-key="${key}"]`)) {
    if (document.activeElement !== input) input.value = value;
  }
}

function markDirty() {
  dirty = true;
  renderFitNote();
  setStatus('Có thay đổi chưa lưu.');
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    if (previewTab === 'design') void renderDesignPreview();
  }, 160);
}

function updateFitFromSvg() {
  const svg = canvas.querySelector('svg');
  if (!svg) return;
  fitResult = { fits: svg.dataset.fit !== 'false', size: Number(svg.dataset.size || 0) };
  renderFitNote();
}

function renderFitNote() {
  const note = $('#tydk-shadowing-visual-fit-note');
  const renderTab = $('#tydk-shadowing-visual-tab-render');
  $('#tydk-shadowing-visual-render').disabled = !fitResult.fits;
  renderTab.textContent = lastRender && lastRender.key !== currentKey() ? 'Kết quả render (cũ)' : 'Kết quả render';
  if (previewTab === 'render') {
    note.textContent = lastRender && lastRender.key !== currentKey()
      ? 'Thiết kế đã đổi sau lần render này. Bấm “Render thử” để cập nhật.'
      : 'Ảnh “Render thử” được tạo bằng renderer của video Things You Didn\'t Know.';
    return;
  }
  if (!fitResult.fits) {
    note.classList.add('warning');
    note.textContent = activeMode === 'thumbnail'
      ? 'Headline mẫu không vừa vùng này kể cả ở cỡ nhỏ nhất. Mở rộng vùng headline hoặc rút ngắn headline mẫu.'
      : 'Nội dung mẫu không vừa vùng này kể cả ở cỡ nhỏ nhất. Mở rộng vùng nội dung hoặc rút ngắn nội dung mẫu.';
    return;
  }
  note.classList.remove('warning');
  if (activeMode === 'thumbnail') {
    const limit = currentSettings().headlineMaxPx;
    note.textContent = `Tựa đề gốc được giữ nguyên; cỡ chữ cố định ${fitResult.size || limit}px và chỉ xuống dòng.`;
  } else {
    const limit = currentSettings().bodyMaxPx;
    note.textContent = `Chữ đang vẽ: ${fitResult.size}px (tối đa ${limit}px).${fitResult.size >= limit - 1 ? ' Chữ đã chạm cỡ tối đa: tăng cỡ chữ lớn nhất. Mở rộng vùng không làm chữ to thêm.' : ' Chữ tự co để vừa vùng: mở rộng vùng để chữ to hơn.'}`;
  }
}

async function postPreview(render = false, mode = activeMode, cardPreview = false) {
  const previewSample = { ...currentSample(mode), ...(cardPreview ? { cardPreview: true } : {}) };
  const response = await fetch('/api/things-you-didnt-know/visual-preview.svg', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, design: design, sample: previewSample, render })
  });
  if (!response.ok) {
    const data = await response.text();
    let message = data || `HTTP ${response.status}`;
    try { message = JSON.parse(data).error || message; } catch { /* Plain text error response. */ }
    throw new Error(message);
  }
  return response;
}

async function renderDesignPreview() {
  if (!design || previewTab !== 'design' || $('#tydk-shadowing-visual-dialog').hidden) return;
  setStatus(dirty ? 'Đang cập nhật bản xem trước… Có thay đổi chưa lưu.' : 'Đang tải thiết kế…');
  try {
    const response = await postPreview(false);
    const svg = await response.text();
    canvas.innerHTML = scopeSvgMarkup(svg);
    const card = $(`#tydk-shadowing-visual-${activeMode}-card`);
    if (card) card.innerHTML = scopeSvgMarkup(svg);
    await document.fonts?.ready;
    scaleCanvas();
    updateFitFromSvg();
    addDesignOverlay();
    setStatus(dirty ? 'Bản xem trước đã cập nhật. Thay đổi chưa lưu.' : 'Thiết kế đã tải.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function refreshCardPreviews() {
  if (!design) return;
  await Promise.all(['thumbnail', 'content'].map(async (mode) => {
    try {
      const response = await postPreview(false, mode, true);
      const svg = await response.text();
      const card = $(`#tydk-shadowing-visual-${mode}-card`);
      if (card) card.innerHTML = scopeSvgMarkup(svg);
    } catch (error) {
      const card = $(`#tydk-shadowing-visual-${mode}-card`);
      if (card) card.innerHTML = `<p class="tydk-shadowing-visual-card-error">${escapeHtml(error.message)}</p>`;
    }
  }));
}

async function renderNow() {
  if (!design) return;
  const button = $('#tydk-shadowing-visual-render');
  button.disabled = true;
  setPreviewTabButtonsOnly('render');
  canvas.innerHTML = '<p class="tydk-shadowing-visual-loading">Đang render…</p>';
  setStatus('Đang render ảnh thử…');
  try {
    const response = await postPreview(true);
    const url = URL.createObjectURL(await response.blob());
    if (lastRender?.url) URL.revokeObjectURL(lastRender.url);
    lastRender = { url, key: currentKey(), mode: activeMode };
    showLastRender();
    setStatus('Render thử hoàn tất.');
  } catch (error) {
    canvas.innerHTML = `<p class="tydk-shadowing-visual-error">${escapeHtml(error.message)}</p>`;
    setStatus(error.message, true);
  } finally {
    button.disabled = !fitResult.fits;
  }
}

function setPreviewTabButtonsOnly(tab) {
  previewTab = tab;
  for (const name of ['design', 'render']) {
    const button = $(`#tydk-shadowing-visual-tab-${name}`);
    const active = tab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
  renderFitNote();
}

function showLastRender() {
  if (previewTab !== 'render' || $('#tydk-shadowing-visual-dialog').hidden) return;
  if (!lastRender || lastRender.mode !== activeMode) {
    canvas.innerHTML = '<p class="tydk-shadowing-visual-empty">Chưa render. Bấm “Render thử” để xem ảnh server vẽ từ thiết kế này.</p>';
  } else {
    canvas.innerHTML = `<img class="tydk-shadowing-visual-rendered-image" src="${lastRender.url}" alt="Ảnh do renderer Things You Didn\'t Know tạo"/>`;
  }
  scaleCanvas();
  renderFitNote();
}

function brandBoxMarkup() {
  const style = currentSettings();
  const name = activeMode === 'thumbnail' ? sample.thumbnailBrand : sample.contentBrand;
  const size = style.brandSizePx;
  const renderedBrand = canvas.querySelector('svg [data-source-brand="top"]');
  let box = null;
  try {
    const measured = renderedBrand?.getBBox();
    if (measured && measured.width > 0 && measured.height > 0) box = measured;
  } catch { /* Fall back until the SVG font is measurable. */ }
  const left = box ? box.x - 6 : style.brandCenterXPct * 10.8 - clamp(name.length * size * 0.57 + 18, 75, 1040) / 2;
  const top = box ? box.y - 3 : style.brandTopPct * 19.2;
  const topOffsetPct = top / 19.2 - style.brandTopPct;
  const width = box ? box.width + 12 : clamp(name.length * size * 0.57 + 18, 75, 1040);
  const height = box ? box.height + 4 : Math.max(size * 1.2, 25);
  return `<div class="tydk-shadowing-source-drag tydk-shadowing-source-brand ${selected === 'brand' ? 'selected' : ''}" role="button" tabindex="0" aria-label="Tên Page: kéo để di chuyển" data-design-element="brand" data-brand-top-offset-pct="${topOffsetPct}" style="left:${left / 10.8}%;top:${top / 19.2}%;width:${width / 10.8}%;height:${height / 19.2}%"></div>`;
}

function geometryBoxMarkup() {
  const style = currentSettings();
  const box = activeMode === 'thumbnail' ? thumbnailGeometry : contentGeometry;
  const role = activeMode === 'thumbnail' ? 'headline' : 'content';
  const selectedBox = selected === role;
  const handlesMarkup = selectedBox ? handles.map(([id, cursor, position]) => `<span class="tydk-shadowing-source-handle" data-handle="${id}" style="${position};cursor:${cursor}" aria-label="Kéo cạnh ${id}"></span>`).join('') : '';
  const fontHandle = selectedBox && activeMode === 'thumbnail'
    ? '<span class="tydk-shadowing-source-size-handle" data-size-handle="true" role="button" tabindex="0" title="Kéo xuống: chữ to hơn. Kéo lên: chữ nhỏ hơn.">A↕</span>'
    : '';
  return `<div class="tydk-shadowing-source-drag tydk-shadowing-source-box ${selectedBox ? 'selected' : ''} ${fitResult.fits ? '' : 'not-fit'}" role="button" tabindex="0" aria-label="Vùng ${role}: kéo để di chuyển" data-design-element="${role}" style="left:${style[box.left]}%;top:${style[box.top]}%;width:${style[box.width]}%;height:${style[box.height]}%">${handlesMarkup}${fontHandle}</div>`;
}

function independentBrandBoxMarkup(element = 'brand') {
  const style = currentSettings();
  const isFooter = element === 'footer';
  const name = `${isFooter ? '@' : ''}${activeMode === 'thumbnail' ? sample.thumbnailBrand : sample.contentBrand}`;
  const size = isFooter ? style.footerSizePx : style.brandSizePx;
  const xKey = isFooter ? 'footerCenterXPct' : 'brandCenterXPct';
  const yKey = isFooter ? 'footerTopPct' : 'brandTopPct';
  const source = canvas.querySelector(`svg [data-source-brand="${isFooter ? 'bottom' : 'top'}"]`);
  let box = null;
  try {
    const measured = source?.getBBox();
    if (measured?.width > 0 && measured?.height > 0) box = measured;
  } catch { /* Use the saved layer position until SVG metrics are available. */ }
  const width = box?.width + 12 || clamp(name.length * size * 0.57 + 18, 75, 1040);
  const height = box?.height + 4 || Math.max(size * 1.2, 25);
  const left = box ? box.x - 6 : style[xKey] * 10.8 - width / 2;
  const top = box ? box.y - 3 : style[yKey] * 19.2;
  const offset = top / 19.2 - style[yKey];
  return `<div class="tydk-shadowing-source-drag tydk-shadowing-source-brand ${selected === element ? 'selected' : ''}" role="button" tabindex="0" aria-label="${element} layer" data-design-element="${element}" data-layer-top-offset-pct="${offset}" style="left:${left / 10.8}%;top:${top / 19.2}%;width:${width / 10.8}%;height:${height / 19.2}%"></div>`;
}

function independentGeometryBoxMarkup(element) {
  const style = currentSettings();
  const box = element === 'headline' ? thumbnailGeometry : element === 'title' ? titleGeometry : contentGeometry;
  const selectedBox = selected === element;
  const handlesMarkup = selectedBox
    ? handles.map(([id, cursor, position]) => `<span class="tydk-shadowing-source-handle" data-handle="${id}" style="${position};cursor:${cursor}" aria-label="Resize ${id}"></span>`).join('')
    : '';
  const fontHandle = selectedBox && element === 'headline'
    ? '<span class="tydk-shadowing-source-size-handle" data-size-handle="true" role="button" tabindex="0" title="Drag to resize headline text">A↕</span>'
    : '';
  return `<div class="tydk-shadowing-source-drag tydk-shadowing-source-box ${selectedBox ? 'selected' : ''} ${fitResult.fits ? '' : 'not-fit'}" role="button" tabindex="0" aria-label="${element} layer" data-design-element="${element}" style="left:${style[box.left]}%;top:${style[box.top]}%;width:${style[box.width]}%;height:${style[box.height]}%">${handlesMarkup}${fontHandle}</div>`;
}

function addDesignOverlay() {
  if (previewTab !== 'design' || !canvas.querySelector('svg')) return;
  const overlay = document.createElement('div');
  overlay.className = 'tydk-shadowing-source-overlay';
  overlay.innerHTML = activeMode === 'thumbnail'
    ? `${independentBrandBoxMarkup()}${independentGeometryBoxMarkup('headline')}`
    : `${independentBrandBoxMarkup('brand')}${independentGeometryBoxMarkup('title')}${independentGeometryBoxMarkup('content')}${independentBrandBoxMarkup('footer')}`;
  canvas.append(overlay);
  overlay.addEventListener('pointerdown', beginDrag);
  overlay.addEventListener('pointermove', moveDrag);
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);
  overlay.addEventListener('wheel', zoomLayer, { passive: false });
  overlay.addEventListener('keydown', nudgeSelection);
  overlay.querySelectorAll('[data-design-element]').forEach((element) => element.addEventListener('focus', () => {
    if (selected === element.dataset.designElement) return;
    selected = element.dataset.designElement;
    const picker = $('#tydk-shadowing-visual-layer');
    if (picker) picker.value = selected;
    addDesignOverlayRefresh();
  }));
}

function addDesignOverlayRefresh() {
  const focusedElement = document.activeElement?.dataset?.designElement;
  canvas.querySelector('.tydk-shadowing-source-overlay')?.remove();
  addDesignOverlay();
  if (focusedElement) canvas.querySelector(`[data-design-element="${focusedElement}"]`)?.focus({ preventScroll: true });
}

function dragDefinition(element) {
  if (element === 'brand') return { type: 'point', xKey: 'brandCenterXPct', yKey: 'brandTopPct', sizeKey: 'brandSizePx', minSize: 12, maxSize: 200 };
  if (element === 'footer') return { type: 'point', xKey: 'footerCenterXPct', yKey: 'footerTopPct', sizeKey: 'footerSizePx', minSize: 12, maxSize: 200 };
  if (element === 'headline') return { ...thumbnailGeometry, type: 'box', sizeKey: 'headlineMaxPx', minSize: 40, maxSize: 400 };
  if (element === 'title') return { ...titleGeometry, type: 'box', sizeKey: 'contentTitleMaxPx', minSize: 22, maxSize: 240 };
  return { ...contentGeometry, type: 'box', sizeKey: 'bodyMaxPx', minSize: 22, maxSize: 120 };
}

function dragResult(start, element, mode, dx, dy) {
  const next = { ...start };
  const config = dragDefinition(element);
  if (config.type === 'point') {
    next[config.xKey] = round(clamp(start[config.xKey] + dx, 0, 100));
    const maxY = Math.max(0, 100 - Number(start[config.sizeKey] || 48) / 19.2);
    next[config.yKey] = round(clamp(start[config.yKey] + dy, 0, maxY));
    return { style: next };
  }
  const leftKey = config.left;
  const topKey = config.top;
  const widthKey = config.width;
  const heightKey = config.height;
  let left = start[leftKey];
  let top = start[topKey];
  let right = left + start[widthKey];
  let bottom = top + start[heightKey];
  if (mode === 'move') {
    left = clamp(left + dx, 0, 100 - start[widthKey]);
    top = clamp(top + dy, 0, 100 - start[heightKey]);
    next[leftKey] = round(left);
    next[topKey] = round(top);
    return { style: next };
  }
  if (mode.includes('w')) left = clamp(left + dx, 0, right - config.minWidth);
  if (mode.includes('e')) right = clamp(right + dx, left + config.minWidth, 100);
  if (mode.includes('n')) top = clamp(top + dy, 0, bottom - config.minHeight);
  if (mode.includes('s')) bottom = clamp(bottom + dy, top + config.minHeight, 100);
  next[leftKey] = round(left);
  next[topKey] = round(top);
  next[widthKey] = round(right - left);
  next[heightKey] = round(bottom - top);
  return { style: next };
}

function zoomLayer(event) {
  const hovered = event.target.closest('[data-design-element]')?.dataset.designElement;
  const element = hovered || selected;
  if (!element) return;
  const config = dragDefinition(element);
  const factor = Math.exp(-clamp(event.deltaY, -120, 120) * 0.0009);
  if (!Number.isFinite(factor) || Math.abs(factor - 1) < 0.005) return;
  event.preventDefault();
  event.stopPropagation();
  selected = element;
  const style = currentSettings();
  const previousSize = Number(style[config.sizeKey]);
  const nextSize = Math.round(clamp(previousSize * factor, config.minSize, config.maxSize));
  const layerFactor = previousSize > 0 ? nextSize / previousSize : 1;
  style[config.sizeKey] = nextSize;
  if (config.type === 'box') {
    const centerX = style[config.left] + style[config.width] / 2;
    const centerY = style[config.top] + style[config.height] / 2;
    const nextWidth = clamp(style[config.width] * layerFactor, config.minWidth, 100);
    const nextHeight = clamp(style[config.height] * layerFactor, config.minHeight, 100);
    style[config.width] = round(nextWidth);
    style[config.height] = round(nextHeight);
    style[config.left] = round(clamp(centerX - nextWidth / 2, 0, 100 - nextWidth));
    style[config.top] = round(clamp(centerY - nextHeight / 2, 0, 100 - nextHeight));
  }
  design.schemaVersion = 5;
  renderControls();
  markDirty();
  schedulePreview();
}

function beginDrag(event) {
  const target = event.target.closest('[data-design-element]');
  if (!target) return;
  const element = target.dataset.designElement;
  const handle = event.target.closest('[data-handle]')?.dataset.handle;
  const sizeHandle = Boolean(event.target.closest('[data-size-handle]'));
  selected = element;
  target.setPointerCapture?.(event.pointerId);
  for (const selectable of target.parentElement.querySelectorAll('[data-design-element]')) {
    selectable.classList.toggle('selected', selectable === target);
  }
  const picker = $('#tydk-shadowing-visual-layer');
  if (picker) picker.value = element;
  const box = canvas.getBoundingClientRect();
  drag = {
    pointerId: event.pointerId,
    element,
    mode: sizeHandle ? 'size' : handle || 'move',
    x: event.clientX,
    y: event.clientY,
    width: box.width,
    height: box.height,
    start: clone(currentSettings())
  };
  event.preventDefault();
  event.stopPropagation();
  target.classList.add('selected');
}

function moveDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dx = (event.clientX - drag.x) / drag.width * 100;
  const dy = (event.clientY - drag.y) / drag.height * 100;
  const config = dragDefinition(drag.element);
  if (drag.mode === 'size') {
    currentSettings()[config.sizeKey] = Math.round(clamp(drag.start[config.sizeKey] + dy * 10, config.minSize, config.maxSize));
  } else {
    const result = dragResult(drag.start, drag.element, drag.mode, dx, dy);
    Object.assign(currentSettings(), result.style);
  }
  const overlay = canvas.querySelector('.tydk-shadowing-source-overlay');
  const element = overlay?.querySelector(`[data-design-element="${drag.element}"]`);
  if (element) {
    if (config.type === 'point') {
      const elementWidth = element.getBoundingClientRect().width / Math.max(1, drag.width) * 100;
      element.style.left = `${currentSettings()[config.xKey] - elementWidth / 2}%`;
      element.style.top = `${currentSettings()[config.yKey] + Number(element.dataset.layerTopOffsetPct || 0)}%`;
    } else {
      element.style.left = `${currentSettings()[config.left]}%`;
      element.style.top = `${currentSettings()[config.top]}%`;
      element.style.width = `${currentSettings()[config.width]}%`;
      element.style.height = `${currentSettings()[config.height]}%`;
    }
  }
}

function endDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag = null;
  design.schemaVersion = 5;
  renderControls();
  markDirty();
  schedulePreview();
}

function nudgeSelection(event) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !selected) return;
  const step = event.shiftKey ? 2 : 0.2;
  const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
  const result = dragResult(clone(currentSettings()), selected, 'move', ...delta);
  Object.assign(currentSettings(), result.style);
  if (dragDefinition(selected).type === 'box') keepBoxInside(currentSettings(), dragDefinition(selected));
  design.schemaVersion = 5;
  renderControls();
  markDirty();
  schedulePreview();
  event.preventDefault();
}

function setSampleDefaults(mode) {
  if (mode === 'thumbnail') {
    sample.thumbnailBrand = "Things You Didn\'t Know";
    sample.thumbnailTitle = 'A Quiet Umbrella Custom';
    sample.thumbnailHighlight = 'umbrella custom';
  } else {
    sample.contentBrand = "Things You Didn\'t Know";
    sample.contentTitle = 'A Quiet Umbrella Custom';
    sample.contentParagraphs = 'In some neighborhoods, shared umbrellas wait near community entrances for anyone caught in the rain.\nA person can borrow one and return it later, making a sudden shower easier to manage.\nThe practice turns an ordinary object into a small sign of trust between neighbors.';
  }
}

async function loadDesign() {
  try {
    const [loaded, fresh] = await Promise.all([
      api('/api/things-you-didnt-know/visual-design'),
      api('/api/things-you-didnt-know/visual-design/defaults')
    ]);
    defaults = fresh.design;
    const saved = loaded.design;
    if (saved.schemaVersion < 3) {
      design = clone(defaults);
      design.enabled = saved.enabled !== false;
      design.thumbnailOnly = false;
      design.thumbnail.introSeconds = saved.thumbnail.introInVideo ? saved.thumbnail.introSeconds : 0;
      savedDesign = clone(saved);
      dirty = true;
    } else {
      savedDesign = clone(saved);
      design = saved.schemaVersion < 4 ? upgradeDesignToIndependentLayers(saved) : saved;
      design.thumbnailOnly = false;
      dirty = saved.schemaVersion < 4;
    }
    contentDesignEnabled = !design.thumbnailOnly;
    updateTabs();
    $('#tydk-shadowing-visual-enabled').checked = design.enabled === true;
    updateScopeLabel();
    await refreshCardPreviews();
    setStatus(saved.schemaVersion < 3
      ? 'Thiết kế Things You Didn\'t Know đã được chuyển sang cấu trúc gốc. Mở từng mục để tinh chỉnh.'
      : 'Thiết kế Things You Didn\'t Know đã tải.');
    return true;
  } catch (error) {
    setStatus(error.message, true);
    return false;
  }
}

async function saveDesign(enable = false, applyCurrentMode = false) {
  if (!design || saving) return;
  saving = true;
  const saveButtons = [$('#tydk-shadowing-visual-save'), $('#tydk-shadowing-visual-save-settings')].filter(Boolean);
  const lockedControls = [
    ...controlsRoot.querySelectorAll('[data-design-key]'),
    ...sampleRoot.querySelectorAll('[data-sample-key]'),
    $('#tydk-shadowing-visual-enabled'), ...saveButtons,
    $('#tydk-shadowing-visual-default'), $('#tydk-shadowing-visual-render'),
    $('#tydk-shadowing-visual-cancel'), $('#tydk-shadowing-visual-close')
  ].filter(Boolean);
  const priorDisabled = lockedControls.map((control) => control.disabled);
  const priorSaveLabels = saveButtons.map((control) => control.textContent);
  lockedControls.forEach((control) => { control.disabled = true; });
  saveButtons.forEach((control) => { control.textContent = 'Đang lưu…'; });
  const overlay = canvas.querySelector('.tydk-shadowing-source-overlay');
  const priorPointerEvents = overlay?.style.pointerEvents;
  if (overlay) overlay.style.pointerEvents = 'none';
  if (enable) {
    design.enabled = true;
      design.schemaVersion = 5;
  }
  if (applyCurrentMode) {
    design.enabled = true;
    design.thumbnailOnly = false;
      design.schemaVersion = 5;
  }
  $('#tydk-shadowing-visual-enabled').checked = design.enabled === true;
  setStatus('Đang lưu thiết kế Things You Didn\'t Know…');
  try {
    const result = await api('/api/things-you-didnt-know/visual-design', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(design)
    });
    const confirmed = await api('/api/things-you-didnt-know/visual-design');
    if (JSON.stringify(confirmed.design) !== JSON.stringify(result.design)) {
      throw new Error('Máy chủ chưa xác nhận được thiết kế đã lưu. Hãy thử lưu lại.');
    }
    design = confirmed.design;
    contentDesignEnabled = !design.thumbnailOnly;
    savedDesign = clone(design);
    dirty = false;
    syncControlsFromDesign();
    updateScopeLabel();
    if (applyCurrentMode && activeMode === 'thumbnail') persistThumbnailSample();
    await refreshCardPreviews();
    if (previewTab === 'design') await renderDesignPreview();
    updateScopeLabel();
    setStatus(applyCurrentMode
      ? 'Đã lưu và xác nhận thiết kế Thumbnail cùng Nội dung cho Reel Things You Didn\'t Know mới.'
      : 'Đã lưu thiết kế Things You Didn\'t Know.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    lockedControls.forEach((control, index) => { control.disabled = priorDisabled[index]; });
    saveButtons.forEach((control, index) => { control.textContent = priorSaveLabels[index]; });
    if (overlay) overlay.style.pointerEvents = priorPointerEvents;
    saving = false;
  }
}

async function resetMode() {
  if (!design || !defaults) return;
  if (activeMode === 'thumbnail') {
    design.thumbnail = clone(defaults.thumbnail);
  } else {
    design.content = clone(defaults.content);
  }
  design.schemaVersion = 5;
  renderControls();
  markDirty();
  await renderDesignPreview();
}

function closeEditor(discard = true) {
  if (discard && savedDesign) {
    design = clone(savedDesign);
    dirty = false;
    renderControls();
  }
  restoreThumbnailSample();
  setSampleDefaults('content');
  void refreshCardPreviews();
  if (lastRender?.url) URL.revokeObjectURL(lastRender.url);
  lastRender = null;
  previewTab = 'design';
  $('#tydk-shadowing-visual-dialog').hidden = true;
  document.body.classList.remove('things-design-open');
}

async function openEditor(mode) {
  if (!await loadDesign()) return;
  activeMode = mode;
  selected = mode === 'thumbnail' ? 'headline' : 'content';
  if (mode === 'content') setSampleDefaults('content');
  $('#tydk-shadowing-visual-dialog').hidden = false;
  document.body.classList.add('things-design-open');
  updateTabs();
  setPreviewTab('design');
  scaleCanvas();
  $('#tydk-shadowing-visual-close').focus();
}

$('#tydk-shadowing-visual-open-thumbnail').addEventListener('click', () => void openEditor('thumbnail'));
$('#tydk-shadowing-visual-open-content').addEventListener('click', () => void openEditor('content'));
$('#tydk-shadowing-visual-tab-design').addEventListener('click', () => setPreviewTab('design'));
$('#tydk-shadowing-visual-tab-render').addEventListener('click', () => {
  setPreviewTabButtonsOnly('render');
  showLastRender();
});
$('#tydk-shadowing-visual-enabled').addEventListener('change', (event) => {
  if (!design) return;
  design.enabled = event.currentTarget.checked;
  design.thumbnailOnly = false;
  updateScopeLabel();
  if (design.enabled) design.schemaVersion = 5;
  markDirty();
});
$('#tydk-shadowing-visual-default').addEventListener('click', () => void resetMode());
$('#tydk-shadowing-visual-render').addEventListener('click', () => void renderNow());
$('#tydk-shadowing-visual-save').addEventListener('click', () => void saveDesign(true, true));
$('#tydk-shadowing-visual-save-settings').addEventListener('click', () => void saveDesign(false));
$('#tydk-shadowing-visual-cancel').addEventListener('click', () => { if (!saving) closeEditor(true); });
$('#tydk-shadowing-visual-close').addEventListener('click', () => { if (!saving) closeEditor(true); });
$('#tydk-shadowing-visual-dialog').addEventListener('pointerdown', (event) => {
  if (event.target === event.currentTarget && !saving) closeEditor(true);
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#tydk-shadowing-visual-dialog').hidden && !saving) closeEditor(true);
});
window.addEventListener('things-visual-editor:activate', () => {
  if (!design) void loadDesign();
  else void refreshCardPreviews();
});
window.addEventListener('resize', scaleCanvas);
resizeObserver = new ResizeObserver(scaleCanvas);
if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
if (document.body.classList.contains('things-editor-mode')) void loadDesign();
