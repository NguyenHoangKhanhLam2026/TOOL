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
      { key: 'brandTopPct', label: 'Vị trí dọc (%)', type: 'number', min: 0, max: 40, step: 0.5 }
    ] },
    { title: 'Headline', fields: [
      { key: 'textColor', label: 'Màu chữ', type: 'color' },
      { key: 'highlightColor', label: 'Màu từ nổi bật', type: 'color' },
      { key: 'outlineColor', label: 'Màu viền chữ', type: 'color' },
      { key: 'headlineMaxPx', label: 'Cỡ chữ lớn nhất (px)', type: 'number', min: 40, max: 400, slider: true },
      { key: 'headlineCase', label: 'Kiểu chữ', type: 'select', options: [['uppercase', 'uppercase (viết hoa hết)'], ['as written', 'as written (giữ nguyên)']] },
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
      { key: 'brandTopPct', label: 'Vị trí dọc (%)', type: 'number', min: 0, max: 40, step: 0.5 }
    ] },
    { title: 'Nội dung', fields: [
      { key: 'bodyColor', label: 'Màu chữ', type: 'color' },
      { key: 'bodyMaxPx', label: 'Cỡ chữ lớn nhất (px)', type: 'number', min: 22, max: 120, slider: true },
      { key: 'bodyFont', label: 'Font', type: 'select', options: [['serif', 'serif (có chân)'], ['display', 'display (poster đậm)']] },
      { key: 'contentLeftPct', label: 'Trái (%)', type: 'number', min: 0, max: 80, step: 0.5, group: 'geometry' },
      { key: 'contentTopPct', label: 'Trên (%)', type: 'number', min: 0, max: 90, step: 0.5, group: 'geometry' },
      { key: 'contentWidthPct', label: 'Rộng (%)', type: 'number', min: 20, max: 100, group: 'geometry' },
      { key: 'contentHeightPct', label: 'Cao (%)', type: 'number', min: 5, max: 90, step: 0.5, group: 'geometry' }
    ] },
    { title: 'Nền giấy', fields: [
      { key: 'paperColor', label: 'Màu nền', type: 'color' },
      { key: 'vignette', label: 'Độ tối viền ảnh', type: 'number', min: 0, max: 1, step: 0.05, slider: true }
    ] },
    { title: 'Highlight chữ đang đọc (trong video)', fields: [
      { key: 'highlightColor', label: 'Màu nền', type: 'color' },
      { key: 'highlightOpacity', label: 'Độ đậm', type: 'number', min: 0.1, max: 1, step: 0.05, slider: true },
      { key: 'highlightRadiusPx', label: 'Bo góc (px)', type: 'number', min: 0, max: 60, slider: true },
      { key: 'highlightPadXPct', label: 'Lề ngang (%)', type: 'number', min: 0, max: 60 },
      { key: 'highlightPadYPx', label: 'Lề dọc (px)', type: 'number', min: 0, max: 30 },
      { key: 'highlightUnderline', label: 'Gạch chân', type: 'select', options: [['on', 'Có'], ['off', 'Không']] },
      { key: 'highlightUnderlineColor', label: 'Màu gạch chân', type: 'color', when: 'highlightUnderline=on' },
      { key: 'highlightTextMode', label: 'Màu chữ khi được đọc', type: 'select', options: [['keep', 'Giữ màu chữ gốc'], ['custom', 'Đổi màu']] },
      { key: 'highlightTextColor', label: 'Màu chữ', type: 'color', when: 'highlightTextMode=custom' },
      { type: 'note', text: 'Xem trước ở từ thứ hai của đoạn đầu. Ảnh “Render thử” là ảnh tĩnh nên không có highlight; video mới vẽ highlight này.' }
    ] }
  ]
};

const thumbnailGeometry = {
  left: 'headlineLeftPct', top: 'headlineTopPct', width: 'headlineWidthPct', height: 'headlineHeightPct', minWidth: 20, minHeight: 5
};
const contentGeometry = {
  left: 'contentLeftPct', top: 'contentTopPct', width: 'contentWidthPct', height: 'contentHeightPct', minWidth: 20, minHeight: 10
};
const handles = [
  ['nw', 'nwse-resize', 'left:-6px;top:-6px'], ['n', 'ns-resize', 'left:calc(50% - 5px);top:-6px'],
  ['ne', 'nesw-resize', 'right:-6px;top:-6px'], ['e', 'ew-resize', 'right:-6px;top:calc(50% - 5px)'],
  ['se', 'nwse-resize', 'right:-6px;bottom:-6px'], ['s', 'ns-resize', 'left:calc(50% - 5px);bottom:-6px'],
  ['sw', 'nesw-resize', 'left:-6px;bottom:-6px'], ['w', 'ew-resize', 'left:-6px;top:calc(50% - 5px)']
];

const canvas = $('#shadowing-visual-canvas');
const controlsRoot = $('#shadowing-visual-controls');
const sampleRoot = $('#shadowing-visual-samples');
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
let showSnapLine = false;
let fitResult = { fits: true, size: 0 };
let lastRender = null;
let drag = null;
let svgInstance = 0;
let contentDesignEnabled = false;
const THUMBNAIL_SAMPLE_STORAGE_KEY = 'english-shadowing.visual-thumbnail-sample.v1';
const THUMBNAIL_SAMPLE_DEFAULTS = {
  thumbnailBrand: 'Things',
  thumbnailTitle: 'Why gers filled the capital',
  thumbnailHighlight: 'gers capital'
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
  contentBrand: 'Things',
  contentTitle: 'Why gers filled the capital',
  contentParagraphs: 'A short line that sets the scene for the whole story.\nA second line, long enough to show how the text wraps and shrinks to fit.'
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
  const prefix = `shadowing-svg-${++svgInstance}-`;
  return markup
    .replace(/\bid="([^"]+)"/gu, (_match, id) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]*)\)/gu, (_match, id) => `url(#${prefix}${id})`)
    .replace(/\b(href|xlink:href)="#([^"]+)"/gu, (_match, attribute, id) => `${attribute}="#${prefix}${id}"`);
}

function setStatus(message, error = false) {
  const status = $('#shadowing-visual-status');
  status.textContent = message;
  status.classList.toggle('error', error);
}

function setPreviewTab(tab) {
  previewTab = tab;
  for (const name of ['design', 'render']) {
    const button = $(`#shadowing-visual-tab-${name}`);
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
  const tabsHeight = $('.shadowing-visual-render-tabs')?.offsetHeight || 0;
  const noteHeight = $('#shadowing-visual-fit-note')?.offsetHeight || 0;
  const scale = Math.min((area.clientWidth - 24) / 1080, (area.clientHeight - tabsHeight - noteHeight - 24) / 1920);
  if (Number.isFinite(scale) && scale > 0) {
    canvas.style.width = `${Math.round(1080 * scale)}px`;
    canvas.style.height = `${Math.round(1920 * scale)}px`;
  }
}

function updateTabs() {
  const isThumb = activeMode === 'thumbnail';
  $('#shadowing-visual-dialog-title').textContent = isThumb ? 'Thiết kế thumbnail' : 'Thiết kế nội dung';
  $('#shadowing-visual-dialog-help').textContent = isThumb
    ? 'Kéo tên Page và vùng headline trên ảnh. Bấm “Render thử” để xem ảnh do server vẽ.'
    : 'Kéo tên Page và vùng nội dung trên ảnh. Bấm “Render thử” để xem ảnh do server vẽ.';
  $('#shadowing-visual-controls-heading').textContent = isThumb ? 'Thiết kế thumbnail' : 'Thiết kế nội dung';
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
  if (field.type === 'note') return `<p class="shadowing-visual-source-note">${escapeHtml(field.text)}</p>`;
  if (!fieldVisible(field)) return '';
  const value = currentSettings()[field.key];
  const key = escapeHtml(field.key);
  const label = escapeHtml(field.label);
  if (field.type === 'checkbox') {
    return `<label class="shadowing-visual-source-checkbox"><input type="checkbox" data-design-key="${key}" ${value ? 'checked' : ''}/><span>${label}</span></label>`;
  }
  if (field.type === 'color') {
    return `<label class="shadowing-visual-source-field"><span>${label}</span><span class="shadowing-visual-color-row"><input type="color" data-design-key="${key}" value="${colorInputValue(value)}" aria-label="${label}"/><input type="text" data-design-key="${key}" data-color-text="true" value="${escapeHtml(value)}" maxlength="7" aria-label="${label} (mã màu)"/></span></label>`;
  }
  if (field.type === 'select') {
    const options = field.options.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${value === optionValue ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>`).join('');
    return `<label class="shadowing-visual-source-field"><span>${label}</span><select data-design-key="${key}">${options}</select></label>`;
  }
  const step = field.step || 1;
  const slider = field.slider
    ? `<input type="range" data-design-key="${key}" min="${field.min}" max="${field.max}" step="${step}" value="${value}" aria-label="${label}"/>`
    : '';
  const number = `<input type="number" data-design-key="${key}" min="${field.min}" max="${field.max}" step="${step}" value="${value}" aria-label="${label}"/>`;
  return `<label class="shadowing-visual-source-field"><span>${label}</span><span class="shadowing-visual-number-row">${slider}${number}</span></label>`;
}

function groupMarkup(group) {
  let markup = '';
  for (let index = 0; index < group.fields.length;) {
    if (group.fields[index].group === 'geometry') {
      const geometry = [];
      while (group.fields[index]?.group === 'geometry') geometry.push(group.fields[index++]);
      markup += `<div class="shadowing-visual-geometry-grid">${geometry.map(fieldMarkup).join('')}</div>`;
    } else {
      markup += fieldMarkup(group.fields[index++]);
    }
  }
  return `<section class="shadowing-visual-control-group"><h4>${escapeHtml(group.title)}</h4><div class="shadowing-visual-controls-grid">${markup}</div></section>`;
}

function renderControls() {
  if (!design) return;
  controlsRoot.innerHTML = fields[activeMode].map(groupMarkup).join('');
  for (const input of controlsRoot.querySelectorAll('[data-design-key]')) {
    input.addEventListener('input', handleControlChange);
    input.addEventListener('change', handleControlChange);
  }
  $('#shadowing-visual-enabled').checked = design.enabled === true;
  updateScopeLabel();
}

function updateScopeLabel() {
  const label = $('#shadowing-visual-enabled-label');
  const description = $('#shadowing-visual-tools-description');
  const caption = $('#shadowing-visual-source-caption');
  if (!design) return;
  if (label) {
    label.textContent = design.thumbnailOnly
      ? 'Dùng riêng thiết kế Thumbnail này cho video Shadowing mới'
      : 'Dùng thiết kế Thumbnail và Nội dung cho video Shadowing mới';
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
    if (caption) caption.textContent = `Đang áp dụng riêng Thumbnail cho video Shadowing mới. Nội dung giữ cấu hình của tool. Thumbnail mở đầu: ${design.thumbnail.introSeconds} giây.`;
  } else {
    if (description) description.textContent = 'Thiết kế tùy chỉnh áp dụng cho Thumbnail và Nội dung của video Shadowing mới.';
    if (caption) caption.textContent = 'Đang áp dụng thiết kế Thumbnail và Nội dung cho video Shadowing mới.';
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
  $('#shadowing-visual-enabled').checked = design.enabled === true;
  renderFitNote();
}

function renderSampleInputs() {
  if (!design) return;
  if (activeMode === 'thumbnail') {
    sampleRoot.innerHTML = `<section class="shadowing-visual-sample-group"><h4>Nội dung mẫu (chỉ để xem thử)</h4><label class="shadowing-visual-source-field"><span>Tên Page</span><input type="text" data-sample-key="thumbnailBrand" value="${escapeHtml(sample.thumbnailBrand)}" maxlength="60"/></label><label class="shadowing-visual-source-field"><span>Headline mẫu</span><input type="text" data-sample-key="thumbnailTitle" value="${escapeHtml(sample.thumbnailTitle)}" maxlength="120"/></label><label class="shadowing-visual-source-field"><span>Từ nổi bật</span><span class="shadowing-visual-source-hint">Cách nhau bằng dấu cách.</span><input type="text" data-sample-key="thumbnailHighlight" value="${escapeHtml(sample.thumbnailHighlight)}"/></label></section>`;
  } else {
    sampleRoot.innerHTML = `<section class="shadowing-visual-sample-group"><h4>Nội dung mẫu (chỉ để xem thử)</h4><label class="shadowing-visual-source-field"><span>Tên Page</span><input type="text" data-sample-key="contentBrand" value="${escapeHtml(sample.contentBrand)}" maxlength="60"/></label><label class="shadowing-visual-source-field"><span>Tiêu đề mẫu</span><input type="text" data-sample-key="contentTitle" value="${escapeHtml(sample.contentTitle)}" maxlength="120"/></label><label class="shadowing-visual-source-field"><span>Đoạn văn mẫu</span><span class="shadowing-visual-source-hint">Mỗi dòng là một đoạn.</span><textarea data-sample-key="contentParagraphs" rows="4">${escapeHtml(sample.contentParagraphs)}</textarea></label></section>`;
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

function keepBoxInside(style) {
  const box = activeMode === 'thumbnail' ? thumbnailGeometry : contentGeometry;
  style[box.left] = round(clamp(style[box.left], 0, 100 - style[box.width]));
  style[box.top] = round(clamp(style[box.top], 0, 100 - style[box.height]));
  return style;
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
    const precision = String(field.step || 1).includes('.') ? 1 : 0;
    value = precision ? round(value) : Math.round(value);
  } else if (field.type === 'color') {
    if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/iu.test(value)) {
      input.classList.add('invalid');
      return;
    }
    value = value.toUpperCase();
    input.classList.remove('invalid');
  }
  currentSettings()[key] = value;
  design.schemaVersion = 3;
  if (field.group === 'geometry') keepBoxInside(currentSettings());
  if (key === 'highlightUnderline' || key === 'highlightTextMode') renderControls();
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
  const note = $('#shadowing-visual-fit-note');
  const renderTab = $('#shadowing-visual-tab-render');
  $('#shadowing-visual-render').disabled = !fitResult.fits;
  renderTab.textContent = lastRender && lastRender.key !== currentKey() ? 'Kết quả render (cũ)' : 'Kết quả render';
  if (previewTab === 'render') {
    note.textContent = lastRender && lastRender.key !== currentKey()
      ? 'Thiết kế đã đổi sau lần render này. Bấm “Render thử” để cập nhật.'
      : 'Ảnh “Render thử” được tạo bằng renderer của video Shadowing.';
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
    note.textContent = `Chữ đang vẽ: ${fitResult.size}px (tối đa ${limit}px).${fitResult.size >= limit - 1 ? ' Chữ đã chạm cỡ tối đa: kéo nút “A↕” hoặc tăng cỡ chữ lớn nhất. Mở rộng vùng không làm chữ to thêm.' : ' Chữ tự co để vừa vùng: mở rộng vùng để chữ to hơn.'}`;
  } else {
    const limit = currentSettings().bodyMaxPx;
    note.textContent = `Chữ đang vẽ: ${fitResult.size}px (tối đa ${limit}px).${fitResult.size >= limit - 1 ? ' Chữ đã chạm cỡ tối đa: tăng cỡ chữ lớn nhất. Mở rộng vùng không làm chữ to thêm.' : ' Chữ tự co để vừa vùng: mở rộng vùng để chữ to hơn.'}`;
  }
}

async function postPreview(render = false, mode = activeMode, cardPreview = false) {
  const previewSample = { ...currentSample(mode), ...(cardPreview ? { cardPreview: true } : {}) };
  const response = await fetch('/api/english-shadowing/visual-design/preview.svg', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, visualDesign: design, sample: previewSample, render })
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
  if (!design || previewTab !== 'design' || $('#shadowing-visual-dialog').hidden) return;
  setStatus(dirty ? 'Đang cập nhật bản xem trước… Có thay đổi chưa lưu.' : 'Đang tải thiết kế…');
  try {
    const response = await postPreview(false);
    const svg = await response.text();
    canvas.innerHTML = scopeSvgMarkup(svg);
    const card = $(`#shadowing-visual-${activeMode}-card`);
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
      const card = $(`#shadowing-visual-${mode}-card`);
      if (card) card.innerHTML = scopeSvgMarkup(svg);
    } catch (error) {
      const card = $(`#shadowing-visual-${mode}-card`);
      if (card) card.innerHTML = `<p class="shadowing-visual-card-error">${escapeHtml(error.message)}</p>`;
    }
  }));
}

async function renderNow() {
  if (!design) return;
  const button = $('#shadowing-visual-render');
  button.disabled = true;
  setPreviewTabButtonsOnly('render');
  canvas.innerHTML = '<p class="shadowing-visual-loading">Đang render…</p>';
  setStatus('Đang render ảnh thử…');
  try {
    const response = await postPreview(true);
    const url = URL.createObjectURL(await response.blob());
    if (lastRender?.url) URL.revokeObjectURL(lastRender.url);
    lastRender = { url, key: currentKey(), mode: activeMode };
    showLastRender();
    setStatus('Render thử hoàn tất.');
  } catch (error) {
    canvas.innerHTML = `<p class="shadowing-visual-error">${escapeHtml(error.message)}</p>`;
    setStatus(error.message, true);
  } finally {
    button.disabled = !fitResult.fits;
  }
}

function setPreviewTabButtonsOnly(tab) {
  previewTab = tab;
  for (const name of ['design', 'render']) {
    const button = $(`#shadowing-visual-tab-${name}`);
    const active = tab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
  renderFitNote();
}

function showLastRender() {
  if (previewTab !== 'render' || $('#shadowing-visual-dialog').hidden) return;
  if (!lastRender || lastRender.mode !== activeMode) {
    canvas.innerHTML = '<p class="shadowing-visual-empty">Chưa render. Bấm “Render thử” để xem ảnh server vẽ từ thiết kế này.</p>';
  } else {
    canvas.innerHTML = `<img class="shadowing-visual-rendered-image" src="${lastRender.url}" alt="Ảnh do renderer Shadowing tạo"/>`;
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
  return `<div class="shadowing-source-drag shadowing-source-brand ${selected === 'brand' ? 'selected' : ''}" role="button" tabindex="0" aria-label="Tên Page: kéo để di chuyển" data-design-element="brand" data-brand-top-offset-pct="${topOffsetPct}" style="left:${left / 10.8}%;top:${top / 19.2}%;width:${width / 10.8}%;height:${height / 19.2}%"></div>`;
}

function geometryBoxMarkup() {
  const style = currentSettings();
  const box = activeMode === 'thumbnail' ? thumbnailGeometry : contentGeometry;
  const role = activeMode === 'thumbnail' ? 'headline' : 'content';
  const selectedBox = selected === role;
  const handlesMarkup = selectedBox ? handles.map(([id, cursor, position]) => `<span class="shadowing-source-handle" data-handle="${id}" style="${position};cursor:${cursor}" aria-label="Kéo cạnh ${id}"></span>`).join('') : '';
  const fontHandle = selectedBox && activeMode === 'thumbnail'
    ? '<span class="shadowing-source-size-handle" data-size-handle="true" role="button" tabindex="0" title="Kéo xuống: chữ to hơn. Kéo lên: chữ nhỏ hơn.">A↕</span>'
    : '';
  return `<div class="shadowing-source-drag shadowing-source-box ${selectedBox ? 'selected' : ''} ${fitResult.fits ? '' : 'not-fit'}" role="button" tabindex="0" aria-label="Vùng ${role}: kéo để di chuyển" data-design-element="${role}" style="left:${style[box.left]}%;top:${style[box.top]}%;width:${style[box.width]}%;height:${style[box.height]}%">${handlesMarkup}${fontHandle}</div>`;
}

function addDesignOverlay() {
  if (previewTab !== 'design' || !canvas.querySelector('svg')) return;
  const overlay = document.createElement('div');
  overlay.className = 'shadowing-source-overlay';
  overlay.innerHTML = `<div class="shadowing-source-center-line" ${showSnapLine ? '' : 'hidden'}></div>${brandBoxMarkup()}${geometryBoxMarkup()}`;
  canvas.append(overlay);
  overlay.addEventListener('pointerdown', beginDrag);
  overlay.addEventListener('pointermove', moveDrag);
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);
  overlay.addEventListener('keydown', nudgeSelection);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      selected = null;
      addDesignOverlayRefresh();
    }
  });
  overlay.querySelectorAll('[data-design-element]').forEach((element) => element.addEventListener('focus', () => {
    if (selected === element.dataset.designElement) return;
    selected = element.dataset.designElement;
    addDesignOverlayRefresh();
  }));
}

function addDesignOverlayRefresh() {
  const focusedElement = document.activeElement?.dataset?.designElement;
  canvas.querySelector('.shadowing-source-overlay')?.remove();
  addDesignOverlay();
  if (focusedElement) canvas.querySelector(`[data-design-element="${focusedElement}"]`)?.focus({ preventScroll: true });
}

function dragDefinition(element) {
  if (element === 'brand') return { type: 'point', xKey: 'brandCenterXPct', yKey: 'brandTopPct', yMin: 0, yMax: 40 };
  return activeMode === 'thumbnail' ? thumbnailGeometry : contentGeometry;
}

function dragResult(start, element, mode, dx, dy) {
  const next = { ...start };
  const config = dragDefinition(element);
  if (config.type === 'point') {
    const rawX = clamp(start[config.xKey] + dx, 0, 100);
    const snappedX = Math.abs(rawX - 50) <= 1.2 ? 50 : rawX;
    next[config.xKey] = round(snappedX);
    next[config.yKey] = round(clamp(start[config.yKey] + dy, config.yMin, config.yMax));
    return { style: next, snapped: snappedX === 50 };
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
    const middle = left + start[widthKey] / 2;
    const snappedX = Math.abs(middle - 50) <= 1.2 ? 50 : middle;
    left = clamp(snappedX - start[widthKey] / 2, 0, 100 - start[widthKey]);
    top = clamp(top + dy, 0, 100 - start[heightKey]);
    next[leftKey] = round(left);
    next[topKey] = round(top);
    return { style: next, snapped: snappedX === 50 };
  }
  if (mode.includes('w')) left = clamp(left + dx, 0, right - config.minWidth);
  if (mode.includes('e')) right = clamp(right + dx, left + config.minWidth, 100);
  if (mode.includes('n')) top = clamp(top + dy, 0, bottom - config.minHeight);
  if (mode.includes('s')) bottom = clamp(bottom + dy, top + config.minHeight, 100);
  next[leftKey] = round(left);
  next[topKey] = round(top);
  next[widthKey] = round(right - left);
  next[heightKey] = round(bottom - top);
  return { style: next, snapped: false };
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
  if (element === 'brand') target.parentElement.querySelectorAll('.shadowing-source-handle,.shadowing-source-size-handle').forEach((handle) => handle.remove());
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
  let snapped = false;
  if (drag.mode === 'size') {
    const min = 40;
    const max = 400;
    currentSettings().headlineMaxPx = Math.round(clamp(drag.start.headlineMaxPx + dy * 10, min, max));
  } else {
    const result = dragResult(drag.start, drag.element, drag.mode, dx, dy);
    Object.assign(currentSettings(), result.style);
    snapped = result.snapped;
  }
  const overlay = canvas.querySelector('.shadowing-source-overlay');
  showSnapLine = snapped;
  if (overlay) {
    const brandElement = overlay.querySelector('[data-design-element="brand"]');
    const brandWidth = brandElement.getBoundingClientRect().width / Math.max(1, drag.width) * 100;
    brandElement.style.left = `${currentSettings().brandCenterXPct - brandWidth / 2}%`;
    brandElement.style.top = `${currentSettings().brandTopPct + Number(brandElement.dataset.brandTopOffsetPct || 0)}%`;
    const box = activeMode === 'thumbnail' ? thumbnailGeometry : contentGeometry;
    const role = activeMode === 'thumbnail' ? 'headline' : 'content';
    const element = overlay.querySelector(`[data-design-element="${role}"]`);
    element.style.left = `${currentSettings()[box.left]}%`;
    element.style.top = `${currentSettings()[box.top]}%`;
    element.style.width = `${currentSettings()[box.width]}%`;
    element.style.height = `${currentSettings()[box.height]}%`;
    overlay.querySelector('.shadowing-source-center-line').hidden = !snapped;
  }
}

function endDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag = null;
  showSnapLine = false;
  design.schemaVersion = 3;
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
  if (selected !== 'brand') keepBoxInside(currentSettings());
  design.schemaVersion = 3;
  renderControls();
  markDirty();
  schedulePreview();
  event.preventDefault();
}

function setSampleDefaults(mode) {
  if (mode === 'thumbnail') {
    sample.thumbnailBrand = 'Things';
    sample.thumbnailTitle = 'Why gers filled the capital';
    sample.thumbnailHighlight = 'gers capital';
  } else {
    sample.contentBrand = 'Things';
    sample.contentTitle = 'Why gers filled the capital';
    sample.contentParagraphs = 'A short line that sets the scene for the whole story.\nA second line, long enough to show how the text wraps and shrinks to fit.';
  }
}

async function loadDesign() {
  try {
    const [loaded, fresh] = await Promise.all([
      api('/api/english-shadowing/visual-design'),
      api('/api/english-shadowing/visual-design/defaults')
    ]);
    defaults = fresh.visualDesign;
    const saved = loaded.visualDesign;
    if (saved.schemaVersion < 3) {
      design = clone(defaults);
      design.enabled = saved.enabled;
      design.thumbnailOnly = saved.enabled !== true;
      design.thumbnail.introSeconds = saved.thumbnail.introInVideo ? saved.thumbnail.introSeconds : 0;
    } else {
      design = saved;
    }
    contentDesignEnabled = !design.thumbnailOnly;
    savedDesign = clone(design);
    dirty = false;
    updateTabs();
    $('#shadowing-visual-enabled').checked = design.enabled === true;
    updateScopeLabel();
    await refreshCardPreviews();
    setStatus(saved.schemaVersion < 3
      ? 'Thiết kế Shadowing đã được chuyển sang cấu trúc gốc. Mở từng mục để tinh chỉnh.'
      : 'Thiết kế Shadowing đã tải.');
    return true;
  } catch (error) {
    setStatus(error.message, true);
    return false;
  }
}

async function saveDesign(enable = false, applyCurrentMode = false) {
  if (!design || saving) return;
  saving = true;
  const saveButtons = [$('#shadowing-visual-save'), $('#shadowing-visual-save-settings')].filter(Boolean);
  const lockedControls = [
    ...controlsRoot.querySelectorAll('[data-design-key]'),
    ...sampleRoot.querySelectorAll('[data-sample-key]'),
    $('#shadowing-visual-enabled'), ...saveButtons,
    $('#shadowing-visual-default'), $('#shadowing-visual-render'),
    $('#shadowing-visual-cancel'), $('#shadowing-visual-close')
  ].filter(Boolean);
  const priorDisabled = lockedControls.map((control) => control.disabled);
  const priorSaveLabels = saveButtons.map((control) => control.textContent);
  lockedControls.forEach((control) => { control.disabled = true; });
  saveButtons.forEach((control) => { control.textContent = 'Đang lưu…'; });
  const overlay = canvas.querySelector('.shadowing-source-overlay');
  const priorPointerEvents = overlay?.style.pointerEvents;
  if (overlay) overlay.style.pointerEvents = 'none';
  if (enable) {
    design.enabled = true;
    design.schemaVersion = 3;
  }
  if (applyCurrentMode) {
    design.enabled = true;
    design.thumbnailOnly = activeMode === 'thumbnail';
    design.schemaVersion = 3;
  }
  $('#shadowing-visual-enabled').checked = design.enabled === true;
  setStatus('Đang lưu thiết kế Shadowing…');
  try {
    const result = await api('/api/english-shadowing/visual-design', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(design)
    });
    const confirmed = await api('/api/english-shadowing/visual-design');
    if (JSON.stringify(confirmed.visualDesign) !== JSON.stringify(result.visualDesign)) {
      throw new Error('Máy chủ chưa xác nhận được thiết kế đã lưu. Hãy thử lưu lại.');
    }
    design = confirmed.visualDesign;
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
      ? (design.thumbnailOnly
        ? 'Đã lưu và xác nhận Thumbnail. Video Shadowing mới sẽ dùng thiết kế này; Nội dung vẫn theo cài đặt của tool. Bạn vẫn ở mục Thumbnail.'
        : 'Đã lưu và xác nhận Thumbnail và Nội dung. Bạn vẫn ở mục Nội dung.')
      : design.enabled && design.thumbnailOnly
        ? 'Đã lưu. Video Shadowing mới chỉ dùng thiết kế Thumbnail; Nội dung không thay đổi.'
        : 'Đã lưu thiết kế Shadowing.');
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
  design.schemaVersion = 3;
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
  $('#shadowing-visual-dialog').hidden = true;
  document.body.classList.remove('shadowing-design-open');
}

async function openEditor(mode) {
  if (!await loadDesign()) return;
  activeMode = mode;
  selected = mode === 'thumbnail' ? 'headline' : 'content';
  if (mode === 'content') setSampleDefaults('content');
  $('#shadowing-visual-dialog').hidden = false;
  document.body.classList.add('shadowing-design-open');
  updateTabs();
  setPreviewTab('design');
  scaleCanvas();
  $('#shadowing-visual-close').focus();
}

$('#shadowing-visual-open-thumbnail').addEventListener('click', () => void openEditor('thumbnail'));
$('#shadowing-visual-open-content').addEventListener('click', () => void openEditor('content'));
$('#shadowing-visual-tab-design').addEventListener('click', () => setPreviewTab('design'));
$('#shadowing-visual-tab-render').addEventListener('click', () => {
  setPreviewTabButtonsOnly('render');
  showLastRender();
});
$('#shadowing-visual-enabled').addEventListener('change', (event) => {
  if (!design) return;
  design.enabled = event.currentTarget.checked;
  if (design.enabled) design.thumbnailOnly = !contentDesignEnabled;
  updateScopeLabel();
  if (design.enabled) design.schemaVersion = 3;
  markDirty();
});
$('#shadowing-visual-default').addEventListener('click', () => void resetMode());
$('#shadowing-visual-render').addEventListener('click', () => void renderNow());
$('#shadowing-visual-save').addEventListener('click', () => void saveDesign(true, true));
$('#shadowing-visual-save-settings').addEventListener('click', () => void saveDesign(false));
$('#shadowing-visual-cancel').addEventListener('click', () => { if (!saving) closeEditor(true); });
$('#shadowing-visual-close').addEventListener('click', () => { if (!saving) closeEditor(true); });
$('#shadowing-visual-dialog').addEventListener('pointerdown', (event) => {
  if (event.target === event.currentTarget && !saving) closeEditor(true);
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#shadowing-visual-dialog').hidden && !saving) closeEditor(true);
});
$('#shadowing-editor-button').addEventListener('click', () => {
  if (!design) void loadDesign();
  else void refreshCardPreviews();
});
window.addEventListener('resize', scaleCanvas);
resizeObserver = new ResizeObserver(scaleCanvas);
if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
