const $ = (selector) => document.querySelector(selector);
const labels = { intro: 'Mở đầu', vietnamese: 'Tiếng Việt', bilingual: 'Việt + Anh', vocabulary: 'Từ vựng', transition: 'Chuyển cảnh', cta: 'Kêu gọi theo dõi' };
const chineseLabels = { intro: 'Mở đầu', vietnamese: 'Tiếng Việt', bilingual: 'Việt + Trung', vocabulary: 'Từ vựng', transition: 'Chuyển cảnh', cta: 'Kêu gọi theo dõi' };
const japaneseLabels = { intro: 'Mở đầu', vietnamese: 'Thẻ tiếng Việt', 'japanese-typing-1': 'Chấm 1 · đang chờ', 'japanese-typing-2': 'Chấm 2 · đang chờ', 'japanese-typing-3': 'Chấm 3 · sắp hiện câu Nhật', bilingual: 'Thẻ câu tiếng Nhật', vocabulary: 'Cụm từ', transition: 'Chuyển cảnh' };
const japaneseVideoStyles = [
  { value: 'legacy', label: '01 · Thẻ cổ điển' },
  { value: 'dialogue-cards', label: '02 · Thẻ màu dịu' },
  { value: 'numbered-scenario', label: '03 · Viền nhấn vàng' },
  { value: 'inline-meaning', label: '05 · Thẻ nổi' },
  { value: 'inline-keyphrase', label: '10 · Thẻ cao cấp' }
];
const japaneseLayerLabels = {
  background: 'Nền Nhật Bản', logo: 'Logo hoa anh đào và cờ Việt Nam', 'facebook-logo': 'Biểu tượng Facebook',
  'youtube-logo': 'Biểu tượng YouTube', title: 'Tiêu đề', 'scene-number': 'Số câu',
  'vietnamese-card': 'Thẻ tiếng Việt', 'english-card': 'Thẻ tiếng Nhật', vocabulary: 'Thẻ cụm từ',
  character: 'Nhân vật', footer: 'Tên trang', cta: 'Lời kêu gọi theo dõi'
};
const japaneseFieldLabels = {
  x: 'Vị trí ngang', y: 'Vị trí dọc', width: 'Chiều rộng', height: 'Chiều cao', opacity: 'Độ trong suốt',
  fontSize: 'Cỡ chữ', fontWeight: 'Độ đậm chữ', radius: 'Độ bo góc', padding: 'Lề trong', color: 'Màu chữ',
  fill: 'Màu nền', stroke: 'Màu viền', accent: 'Màu nhấn', highlightColor: 'Màu tô sáng', asset: 'Hình ảnh đang dùng',
  pageName: 'Tên trang', tagline: 'Khẩu hiệu', fontFamily: 'Phông chữ', primaryColor: 'Màu chính',
  secondaryColor: 'Màu phụ', accentColor: 'Màu nhấn', bodyColor: 'Màu chữ phụ', backgroundColor: 'Màu nền',
  intro: 'Thời lượng mở đầu', vocabularyHold: 'Thời lượng thẻ cụm từ', transition: 'Thời lượng chuyển cảnh',
  transitionFade: 'Độ mờ chuyển cảnh', cta: 'Thời lượng lời kêu gọi', fade: 'Độ mờ mở đầu',
  text: 'Chữ hiển thị', softGray: 'Màu nền phụ'
};
const japaneseChrome = {
  'editor-back-link': '← Trở về', 'editor-title': 'Trình chỉnh sửa video',
  'states-heading': 'Trạng thái cảnh', 'layers-heading': 'Các lớp nội dung', 'properties-heading': 'Thuộc tính lớp',
  'brand-heading': 'Thương hiệu', 'timing-heading': 'Thời lượng (giây)', 'alignment-heading': 'Thước và căn chỉnh',
  'alignment-subtitle': 'Công cụ căn chỉnh chỉ hiển thị trong trình chỉnh sửa',
  'alignment-help': 'Kéo từ thước vào khung để thêm đường căn · chọn đường căn rồi nhấn phím Xóa để gỡ · giữ Shift hoặc Ctrl khi bấm để chọn nhiều lớp.',
  'alignment-readout': 'Chọn lớp để xem khoảng cách tới hai mép. Giữ Shift hoặc Ctrl khi bấm để chọn nhiều lớp.',
  'preview-subtitle': 'Kéo thả lớp để di chuyển · lăn con lăn giữa để phóng to hoặc thu nhỏ',
  'editor-hint': 'Bản xem trước và video dùng cùng mẫu. Video đầy đủ dùng kịch bản đã lưu gần nhất, không tạo lại nội dung.'
};
const englishChrome = {
  'editor-back-link': '← Studio', 'editor-title': 'Visual Editor',
  'states-heading': 'Trạng thái scene', 'layers-heading': 'Layers', 'properties-heading': 'Thuộc tính layer',
  'brand-heading': 'Thương hiệu', 'timing-heading': 'Nhịp dựng (giây)', 'alignment-heading': 'Rulers, Guides & Smart Alignment',
  'alignment-subtitle': 'Bộ thước đo và căn chỉnh thông minh · chỉ hiển thị trong Visual Editor',
  'alignment-help': 'Kéo từ thước vào canvas để thêm guide · chọn guide rồi nhấn Delete để xóa · Shift/Ctrl/Cmd + bấm layer để chọn nhiều.',
  'alignment-readout': 'Chọn layer để xem khoảng cách mép trái/phải. Shift hoặc Ctrl/Cmd + bấm để chọn nhiều layer.',
  'preview-subtitle': 'Kéo layer trên canvas để chỉnh vị trí',
  'editor-hint': 'Preview và video được dựng từ cùng template với renderer. Video đầy đủ dùng kịch bản đã lưu gần nhất, không gọi AI.'
};
let template; let assets = []; let selectedId = 'vietnamese-card'; let selectedIds = new Set(['vietnamese-card']); let activeState = 'bilingual'; let activeLanguage = 'en'; let undoStack = []; let drag = null; let guideDrag = null; let selectedGuideId = null; let guides = []; let showRulers = true; let showGuides = true; let showGrid = false; let guidesLocked = false; let previewTimer; let fullRenderJobId = null; const templateCache = new Map(); const savedTemplateCache = new Map(); const undoCache = new Map();
let activeJapaneseStyle = 'legacy'; let wheelSnapshotActive = false; let wheelSnapshotTimer = null;
const clone = (value) => JSON.parse(JSON.stringify(value));
async function api(url, options = {}) { const response = await fetch(url, options); const data = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text(); if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`); return data; }
function status(message, error = false) { $('#status').textContent = message; $('#status').classList.toggle('error', error); }
function templateApiPath() { return `/api/visual-template?lang=${activeLanguage}`; }
function templateResetPath() { return `/api/visual-template/reset?lang=${activeLanguage}`; }
const japaneseStyleLayerIds = new Set(['scene-number', 'vietnamese-card', 'english-card', 'vocabulary']);
function styleLayerMap(source = template, style = activeJapaneseStyle) { return activeLanguage === 'ja' ? source?.japaneseStyleLayouts?.[style]?.layers : null; }
function editableLayer(layerId, source = template, style = activeJapaneseStyle) { return (activeLanguage === 'ja' && japaneseStyleLayerIds.has(layerId) ? styleLayerMap(source, style)?.[layerId] : null) || source?.layers.find((layer) => layer.id === layerId) || null; }
function layerDisplayName(layer) { return activeLanguage === 'ja' ? japaneseLayerLabels[layer?.id] || layer?.label || layer?.id : layer?.label || layer?.id; }
function fieldDisplayName(key, fallback = key) { return activeLanguage === 'ja' ? japaneseFieldLabels[key] || fallback : fallback; }
function applyEditorLanguageChrome() {
  const ja = activeLanguage === 'ja';
  document.body.dataset.editorLanguage = activeLanguage;
  const textMap = ja ? japaneseChrome : englishChrome;
  for (const [id, text] of Object.entries(textMap)) { const element = document.getElementById(id); if (element) element.textContent = text; }
  document.title = ja ? 'Trình chỉnh sửa video tiếng Nhật' : 'Visual Editor · Auto English Reels Studio';
  $('#template-language-label').textContent = ja ? 'Mẫu video tiếng Nhật · khung dọc 1080 × 1920' : ({ zh: 'Template Việt–Trung · Hanzi + Pinyin · 1080 × 1920', en: 'Branded Dialogue V2 · 1080 × 1920' })[activeLanguage];
  $('#shadowing-editor-button').textContent = ja ? 'Luyện nhại' : 'Shadowing';
  $('#undo').textContent = ja ? '↶ Hoàn tác' : '↶ Hoàn tác';
  $('#reset').textContent = ja ? 'Khôi phục mẫu' : 'Đặt lại';
  $('#save').textContent = ja ? 'Lưu mẫu' : 'Lưu template';
  $('#asset-link-text').textContent = ja ? 'Quản lý hình ảnh và tệp' : 'Quản lý tài nguyên';
  $('#japanese-layout-map').hidden = !ja;
  $('#japanese-style-select').value = activeJapaneseStyle;
  const sceneLabel = $('#scene-index-label');
  if (sceneLabel.firstChild?.nodeType === Node.TEXT_NODE) sceneLabel.firstChild.textContent = ja ? 'Cảnh ' : 'Câu ';
  $('#toggle-rulers').textContent = ja ? 'Thước' : 'Rulers';
  $('#toggle-guides').textContent = ja ? 'Đường căn' : 'Guides';
  $('#toggle-grid').textContent = ja ? 'Lưới' : 'Grid';
  $('#lock-guides').textContent = guidesLocked ? (ja ? '🔒 Mở khóa đường căn' : '🔒 Mở khóa Guides') : (ja ? '🔓 Khóa đường căn' : '🔓 Khóa Guides');
  $('#center-object').textContent = ja ? 'Căn giữa' : 'Tự căn giữa';
  $('#align-left').textContent = ja ? 'Căn trái' : 'Align Left';
  $('#align-center').textContent = ja ? 'Căn giữa ngang' : 'Align Center';
  $('#align-right').textContent = ja ? 'Căn phải' : 'Align Right';
  $('#distribute-vertically').textContent = ja ? 'Chia đều theo chiều dọc' : 'Distribute Vertically';
  $('#preview').textContent = ja ? '↻ Cập nhật bản xem trước' : '↻ Cập nhật preview';
  $('#render-test').textContent = ja ? '▶ Tạo video xem thử 5 giây' : '▶ Render thử 5 giây';
  $('#render-full').textContent = ja ? 'Tạo video đầy đủ' : 'Render video đầy đủ';
  $('#alignment-toolbar').setAttribute('aria-label', ja ? 'Thước và căn chỉnh' : 'Rulers, Guides & Smart Alignment');
  $('#editor-language-select').setAttribute('aria-label', ja ? 'Chọn ngôn ngữ nội dung' : 'Chọn ngôn ngữ');
  $('#editor-language-select').closest('[role="group"]')?.setAttribute('aria-label', ja ? 'Chọn ngôn ngữ nội dung' : 'Ngôn ngữ template');
  $('#canvas').setAttribute('aria-label', ja ? 'Khung xem trước video' : 'Canvas xem trước');
  $('#guide-lines').setAttribute('aria-label', ja ? 'Các đường căn chỉnh' : 'Guides');
  $('#center-object').title = ja ? 'Căn đối tượng hoặc nhóm đang chọn vào giữa khung xem trước' : 'Căn đối tượng hoặc nhóm đã chọn vào giữa canvas';
  $('#align-left').title = ja ? 'Căn lề trái' : 'Căn mép trái';
  $('#align-center').title = ja ? 'Căn giữa theo chiều ngang' : 'Căn giữa theo chiều ngang';
  $('#align-right').title = ja ? 'Căn lề phải' : 'Căn mép phải';
  $('#distribute-vertically').title = ja ? 'Chia đều khoảng cách dọc khi chọn từ ba lớp trở lên' : 'Chia đều khoảng cách dọc cho từ ba layer trở lên';
  if (ja) {
    $('#shadowing-title').textContent = 'Mẫu dựng video luyện nhại';
    $('#shadowing-description').textContent = 'Khu vực luyện nhại có mẫu hình ảnh riêng. Phần này không dùng các lớp chỉnh sửa tiếng Nhật.';
    $('#shadowing-preview-image').alt = 'Bản xem trước mẫu hình ảnh luyện nhại';
    $('#shadowing-editor-status').textContent = 'Mẫu tự động đang sẵn sàng. Tùy chỉnh nền, chữ và tiêu đề sẽ được bổ sung tại đây.';
  } else {
    $('#shadowing-title').textContent = 'Preset dựng video EnglishShadowing';
    $('#shadowing-description').textContent = 'Shadowing dùng preset riêng: nền giấy ấm, tiêu đề navy và burgundy, toàn bộ đoạn tiếng Anh luôn hiển thị, từ đang đọc được tô nổi bật. Đây là khu vực riêng; các layer EN/ZH bên cạnh không được dùng cho video Shadowing.';
    $('#shadowing-preview-image').alt = 'Xem trước preset hình ảnh EnglishShadowing';
  }
}
async function switchEditorLanguage(language) {
  if (!['en','zh','ja'].includes(language)) return;
  $('#editor-language-select').value = language;
  document.body.classList.remove('shadowing-mode');
  $('#workspace').hidden = false;
  $('#shadowing-workspace').hidden = true;
  if (language === activeLanguage) {
    $('#shadowing-editor-button').classList.remove('active');
    applyEditorLanguageChrome();
    return;
  }
  templateCache.set(activeLanguage, clone(template)); undoCache.set(activeLanguage, undoStack);
  activeLanguage = language; activeState = 'bilingual'; selectedId = language === 'zh' ? 'chinese-card' : 'english-card'; selectedIds = new Set([selectedId]);
  const cached = templateCache.get(language);
  if (cached) { template = clone(cached); undoStack = undoCache.get(language) || []; }
  else { const result = await api(templateApiPath()); template = result.template; savedTemplateCache.set(language, clone(template)); undoStack = []; }
  $('#shadowing-editor-button').classList.remove('active');
  applyEditorLanguageChrome();
  $('#scene-index').innerHTML = language === 'zh' ? '<option value="0">01</option>' : '<option value="0">01</option><option value="1">02</option><option value="2">03</option>';
  renderAll(); status(({ zh: 'Đã mở template tiếng Trung riêng.', ja: 'Đã mở mẫu và cài đặt riêng cho tiếng Nhật.', en: 'Đã mở template tiếng Anh hiện tại.' })[language]);
}
function openShadowingEditor() {
  document.body.classList.add('shadowing-mode');
  $('#workspace').hidden = true;
  $('#shadowing-workspace').hidden = false;
  $('#shadowing-editor-button').classList.add('active');
  $('#template-language-label').textContent = activeLanguage === 'ja' ? 'Mẫu luyện nhại · khung dọc 1080 × 1920' : 'EnglishShadowing · preset riêng · 1080 × 1920';
  $('#shadowing-editor-status').textContent = 'Preset hiện tại vẫn là quy trình mặc định. Dùng phần mở rộng bên dưới để thiết kế Thumbnail và Nội dung.';
}
function snapshot() { undoStack.push(clone(template)); if (undoStack.length > 40) undoStack.shift(); $('#undo').disabled = !undoStack.length; }
function debouncePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 120); }
function selectedLayers() { return template?.layers.map((layer) => activeLanguage === 'ja' ? editableLayer(layer.id) : layer).filter((layer) => layer && selectedIds.has(layer.id) && layer.id !== 'background') || []; }
function canvasPosition(event, axis) { const rect = $('#canvas').getBoundingClientRect(); return axis === 'x' ? ((event.clientX - rect.left) / rect.width) * Number(template.canvas.width) : ((event.clientY - rect.top) / rect.height) * Number(template.canvas.height); }
function renderRulers() {
  const createTicks = (host, axis, length) => {
    host.replaceChildren();
    for (let value = 0; value <= length; value += 20) {
      const tick = document.createElement('span'); tick.className = `ruler-tick${value % 100 === 0 ? ' major' : ''}`;
      tick.style[axis === 'x' ? 'left' : 'top'] = `${(value / length) * 100}%`;
      const mark = document.createElement('i'); tick.append(mark);
      if (value % 100 === 0) { const label = document.createElement('b'); label.textContent = String(value); tick.append(label); }
      host.append(tick);
    }
  };
  createTicks($('#ruler-top'), 'x', Number(template.canvas.width));
  createTicks($('#ruler-left'), 'y', Number(template.canvas.height));
  $('#ruler-top').title = activeLanguage === 'ja' ? 'Kéo thước ngang để tạo đường căn dọc' : 'Kéo từ thước ngang để tạo guide dọc'; $('#ruler-left').title = activeLanguage === 'ja' ? 'Kéo thước dọc để tạo đường căn ngang' : 'Kéo từ thước dọc để tạo guide ngang';
}
function renderGuides() {
  const host = $('#guide-lines'); host.replaceChildren();
  $('#center-guides').classList.toggle('visible', showGuides);
  $('#grid-minor-overlay').classList.toggle('visible', showGrid);
  $('#grid-major-overlay').classList.toggle('visible', showGrid);
  $('#ruler-top').hidden = !showRulers; $('#ruler-left').hidden = !showRulers; $('.ruler-corner').hidden = !showRulers;
  $('#canvas-frame').classList.toggle('rulers-hidden', !showRulers);
  $('#toggle-rulers').classList.toggle('active', showRulers); $('#toggle-rulers').setAttribute('aria-pressed', String(showRulers));
  $('#toggle-guides').classList.toggle('active', showGuides); $('#toggle-guides').setAttribute('aria-pressed', String(showGuides));
  $('#toggle-grid').classList.toggle('active', showGrid); $('#toggle-grid').setAttribute('aria-pressed', String(showGrid));
  $('#lock-guides').classList.toggle('active', guidesLocked); $('#lock-guides').setAttribute('aria-pressed', String(guidesLocked));
  $('#lock-guides').textContent = guidesLocked
    ? (activeLanguage === 'ja' ? '🔒 Mở khóa đường căn' : '🔒 Mở khóa Guides')
    : (activeLanguage === 'ja' ? '🔓 Khóa đường căn' : '🔓 Khóa Guides');
  if (showGuides) for (const guide of guides) {
    const line = document.createElement('div'); line.className = `custom-guide ${guide.orientation}${selectedGuideId === guide.id ? ' selected' : ''}`;
    line.style[guide.orientation === 'vertical' ? 'left' : 'top'] = `${(guide.position / (guide.orientation === 'vertical' ? template.canvas.width : template.canvas.height)) * 100}%`;
    const guideName = activeLanguage === 'ja' ? (guide.orientation === 'vertical' ? 'Đường căn dọc' : 'Đường căn ngang') : (guide.orientation === 'vertical' ? 'Guide dọc' : 'Guide ngang');
    line.title = `${guideName} · ${Math.round(guide.position)} px${guidesLocked ? ' · đã khóa' : activeLanguage === 'ja' ? ' · kéo để di chuyển' : ' · kéo để di chuyển'}`;
    line.addEventListener('pointerdown', (event) => startGuideMove(event, guide)); host.append(line);
  }
}
function renderAlignmentUi() {
  const layers = selectedLayers();
  for (const id of ['center-object', 'align-left', 'align-center', 'align-right']) $(`#${id}`).disabled = layers.length === 0;
  $('#distribute-vertically').disabled = layers.length < 3;
  document.querySelectorAll('.layer-item').forEach((row) => row.classList.toggle('selected', selectedIds.has(row.dataset.layerId)));
  const canvasRect = $('#canvas').getBoundingClientRect();
  const scaleX = canvasRect.width ? Number(template.canvas.width) / canvasRect.width : 1;
  const metrics = [];
  const host = $('#selection-overlays'); host.replaceChildren();
  const root = $('#canvas-content').querySelector('svg');
  root?.querySelectorAll('[data-layer-id]').forEach((group) => group.classList.remove('editor-selected'));
  for (const layer of layers) {
    const group = root?.querySelector(`[data-layer-id="${CSS.escape(layer.id)}"]`);
    if (group) group.classList.add('editor-selected');
    const rect = group?.getBoundingClientRect();
    const left = Math.round(rect && canvasRect.width ? (rect.left - canvasRect.left) * scaleX : Number(layer.x) || 0);
    const width = rect && canvasRect.width ? rect.width * scaleX : Number(layer.width) || 0;
    const right = Math.round(Number(template.canvas.width) - left - width);
    metrics.push(`${layerDisplayName(layer)}: trái ${left} px · phải ${right} px`);
    if (!rect || !canvasRect.width || !canvasRect.height) continue;
    const outline = document.createElement('div'); outline.className = 'selection-outline';
    outline.style.left = `${(rect.left - canvasRect.left) / canvasRect.width * 100}%`;
    outline.style.top = `${(rect.top - canvasRect.top) / canvasRect.height * 100}%`;
    outline.style.width = `${rect.width / canvasRect.width * 100}%`; outline.style.height = `${rect.height / canvasRect.height * 100}%`;
    host.append(outline);
  }
  $('#alignment-readout').textContent = metrics.length ? metrics.join('  |  ') : activeLanguage === 'ja'
    ? 'Chọn lớp để xem khoảng cách tới hai mép. Giữ Shift hoặc Ctrl khi bấm để chọn nhiều lớp.'
    : 'Chọn layer để xem khoảng cách mép trái/phải. Shift hoặc Ctrl/Cmd + bấm để chọn nhiều layer.';
}
function renderEditorChrome() { if (!template) return; renderRulers(); renderGuides(); renderAlignmentUi(); }
function beginGuideDrag(event, guide, source) {
  if (!showGuides || guidesLocked) return;
  event.preventDefault(); event.stopPropagation(); selectedGuideId = guide.id; guideDrag = { id: guide.id, orientation: guide.orientation, source };
  window.addEventListener('pointermove', moveGuideDrag); window.addEventListener('pointerup', endGuideDrag, { once: true }); window.addEventListener('pointercancel', endGuideDrag, { once: true }); renderGuides();
}
function startGuideMove(event, guide) { beginGuideDrag(event, guide, 'move'); }
function startGuideCreation(event, orientation) {
  if (!showGuides || guidesLocked) return;
  const guide = { id: `guide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, orientation, position: canvasPosition(event, orientation === 'vertical' ? 'x' : 'y') };
  guides.push(guide); beginGuideDrag(event, guide, 'create');
}
function moveGuideDrag(event) {
  if (!guideDrag) return;
  const guide = guides.find((item) => item.id === guideDrag.id); if (!guide) return;
  guide.position = canvasPosition(event, guide.orientation === 'vertical' ? 'x' : 'y'); renderGuides();
}
function endGuideDrag() {
  if (!guideDrag) return;
  const guide = guides.find((item) => item.id === guideDrag.id);
  const limit = guide?.orientation === 'vertical' ? Number(template.canvas.width) : Number(template.canvas.height);
  if (guideDrag.source === 'create' && guide && (guide.position < 0 || guide.position > limit)) guides = guides.filter((item) => item.id !== guide.id);
  guideDrag = null; window.removeEventListener('pointermove', moveGuideDrag); window.removeEventListener('pointerup', endGuideDrag); window.removeEventListener('pointercancel', endGuideDrag); renderGuides();
}
function applyAlignment(mode) {
  const layers = selectedLayers(); if (!layers.length) return;
  const boxes = layers.map((layer) => ({ layer, x: Number(layer.x) || 0, y: Number(layer.y) || 0, width: Number(layer.width) || 0, height: Number(layer.height) || 0 }));
  const canvasWidth = Number(template.canvas.width); const canvasHeight = Number(template.canvas.height);
  snapshot();
  if (mode === 'center-object') {
    const left = Math.min(...boxes.map((box) => box.x)); const top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width)); const bottom = Math.max(...boxes.map((box) => box.y + box.height));
    const dx = (canvasWidth - (right - left)) / 2 - left; const dy = (canvasHeight - (bottom - top)) / 2 - top;
    for (const box of boxes) { box.layer.x = Math.round(box.x + dx); box.layer.y = Math.round(box.y + dy); }
  } else if (mode === 'align-left') {
    const edge = boxes.length === 1 ? 0 : Math.min(...boxes.map((box) => box.x));
    for (const box of boxes) box.layer.x = Math.round(edge);
  } else if (mode === 'align-center') {
    const center = boxes.length === 1 ? canvasWidth / 2 : (Math.min(...boxes.map((box) => box.x)) + Math.max(...boxes.map((box) => box.x + box.width))) / 2;
    for (const box of boxes) box.layer.x = Math.round(center - box.width / 2);
  } else if (mode === 'align-right') {
    const edge = boxes.length === 1 ? canvasWidth : Math.max(...boxes.map((box) => box.x + box.width));
    for (const box of boxes) box.layer.x = Math.round(edge - box.width);
  } else if (mode === 'distribute-vertically' && boxes.length >= 3) {
    boxes.sort((a, b) => a.y - b.y);
    const start = boxes[0].y; const end = boxes.at(-1).y + boxes.at(-1).height;
    const totalHeight = boxes.reduce((sum, box) => sum + box.height, 0); const gap = (end - start - totalHeight) / (boxes.length - 1);
    let cursor = start;
    for (const [index, box] of boxes.entries()) { if (index > 0 && index < boxes.length - 1) box.layer.y = Math.round(cursor); cursor += box.height + gap; }
  }
  renderAll(); status(activeLanguage === 'ja' ? 'Đã căn chỉnh lớp. Hãy lưu mẫu để dùng bố cục này khi dựng video.' : 'Đã căn chỉnh layer. Lưu template để dùng bố cục mới khi render.');
}
function addField(parent, key, value, { label = key, type = 'text', min, max, step, wide = false, options, target } = {}) {
  const wrapper = document.createElement('div'); wrapper.className = `field${wide ? ' wide' : ''}`;
  const title = document.createElement('label'); title.textContent = label; title.htmlFor = `field-${key}`;
  const input = options ? document.createElement('select') : document.createElement('input'); input.id = `field-${key}`; input.dataset.key = key;
  if (options) { for (const option of options) { const item = document.createElement('option'); item.value = option.value; item.textContent = option.label; input.append(item); } input.value = value ?? ''; }
  else { input.type = type; if (min !== undefined) input.min = min; if (max !== undefined) input.max = max; if (step !== undefined) input.step = step; input.value = value ?? ''; }
  input.addEventListener('focus', () => { input.dataset.seed = JSON.stringify(template); });
  input.addEventListener('change', () => { if (input.dataset.seed) { undoStack.push(JSON.parse(input.dataset.seed)); input.dataset.seed = ''; $('#undo').disabled = !undoStack.length; } const found = target || (activeLanguage === 'ja' ? editableLayer(selectedId) : template.layers.find((item) => item.id === selectedId)); if (found && (key in found || (found.id === 'footer' && key === 'text'))) found[key] = type === 'number' ? Number(input.value) : input.value; else if (selectedId === '@brand') template.brand[key] = input.value; else if (selectedId === '@timing') template.timing[key] = Number(input.value); renderLayers(); renderProperties(); debouncePreview(); status(activeLanguage === 'ja' ? 'Có thay đổi chưa lưu.' : 'Có thay đổi chưa lưu.'); });
  wrapper.append(title, input); parent.append(wrapper); return input;
}
function renderStates() { const host = $('#states'); host.replaceChildren(); const sceneLabels = activeLanguage === 'ja' ? japaneseLabels : activeLanguage === 'zh' ? chineseLabels : labels; for (const [id, label] of Object.entries(sceneLabels)) { const button = document.createElement('button'); button.className = `state-button${activeState === id ? ' active' : ''}`; button.textContent = label; button.addEventListener('click', () => { activeState = id; renderStates(); renderPreview(); }); host.append(button); } }
function renderLayers() { const host = $('#layers'); host.replaceChildren(); $('#layer-count').textContent = `${template.layers.length} ${activeLanguage === 'ja' ? 'lớp' : 'layers'}`; for (const baseLayer of template.layers) { const layer = activeLanguage === 'ja' ? editableLayer(baseLayer.id) : baseLayer; const row = document.createElement('div'); row.dataset.layerId = layer.id; row.className = `layer-item${selectedId === layer.id ? ' selected' : ''}`; const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = layer.visible !== false; checkbox.title = activeLanguage === 'ja' ? 'Hiển thị lớp' : 'Hiện layer'; checkbox.addEventListener('click', (event) => event.stopPropagation()); checkbox.addEventListener('change', () => { snapshot(); layer.visible = checkbox.checked; renderPreview(); status(activeLanguage === 'ja' ? 'Có thay đổi chưa lưu.' : 'Có thay đổi chưa lưu.'); }); const name = document.createElement('span'); name.textContent = layerDisplayName(layer); const dimensions = document.createElement('small'); dimensions.textContent = `${layer.x}, ${layer.y}`; row.append(checkbox, name, dimensions); row.addEventListener('click', (event) => { if (event.shiftKey || event.ctrlKey || event.metaKey) { if (selectedIds.has(layer.id) && selectedIds.size > 1) { selectedIds.delete(layer.id); selectedId = [...selectedIds].at(-1) || layer.id; } else { selectedIds.add(layer.id); selectedId = layer.id; } } else { selectedId = layer.id; selectedIds = new Set([layer.id]); } renderLayers(); renderProperties(); renderAlignmentUi(); }); host.append(row); } }
function renderProperties() {
  const host = $('#properties');
  host.replaceChildren();
  const layer = activeLanguage === 'ja' ? editableLayer(selectedId) : template.layers.find((item) => item.id === selectedId);
  $('#selected-name').textContent = layer ? layerDisplayName(layer) : selectedId === '@brand' ? 'Nhận diện trang' : 'Thiết lập nhịp dựng';
  if (layer) {
    for (const key of ['x', 'y', 'width', 'height']) addField(host, key, layer[key], { label: fieldDisplayName(key, ({ x: 'Vị trí X', y: 'Vị trí Y', width: 'Rộng', height: 'Cao' })[key]), type: 'number', min: 0, max: 2400, step: 1 });
    addField(host, 'opacity', layer.opacity ?? 1, { label: fieldDisplayName('opacity', 'Độ mờ'), type: 'number', min: 0, max: 1, step: 0.05 });
    for (const key of ['fontSize', 'fontWeight', 'radius', 'padding']) if (key in layer) addField(host, key, layer[key], { label: fieldDisplayName(key), type: 'number', min: 0, max: 200, step: 1 });
    if (layer.id === 'pinyin') {
      addField(host, 'fontFamily', layer.fontFamily || template.brand.fontFamily, { label: 'Font chữ Pinyin', wide: true });
      addField(host, 'appearanceEffect', layer.appearanceEffect || 'none', { label: 'Hiệu ứng xuất hiện', options: [{ value: 'none', label: 'Không hiệu ứng' }, { value: 'fade', label: 'Mờ nhẹ' }, { value: 'rise', label: 'Trượt lên' }, { value: 'pop', label: 'Phóng nhẹ' }] });
    }
    if (layer.id === 'footer') addField(host, 'text', layer.text ?? '', { label: fieldDisplayName('text', 'Nội dung Footer'), wide: true });
    for (const key of ['color', 'fill', 'stroke', 'accent', 'highlightColor']) if (key in layer && /^#[0-9a-f]{6}$/i.test(layer[key])) addField(host, key, layer[key], { type: 'color', label: fieldDisplayName(key) });
    if (layer.asset) {
      const family = layer.id === 'background' ? 'background' : layer.id === 'character' ? 'character' : layer.id === 'logo' ? 'logo' : null;
      if (family) {
        const options = [{ value: layer.asset, label: activeLanguage === 'ja' ? 'Đang dùng' : 'Hiện tại' }];
        for (const item of assets.filter((asset) => asset.type === family)) if (!options.some((entry) => entry.value === item.file)) {
          const assetLabel = activeLanguage === 'ja' && item.file === 'background-vietnamese-japanese.png' ? 'Nền Nhật Bản'
            : activeLanguage === 'ja' && item.file === 'brand-logo-japanese.png' ? 'Logo hoa anh đào và cờ Việt Nam'
              : item.name;
          options.push({ value: item.file, label: assetLabel });
        }
        addField(host, 'asset', layer.asset, { label: fieldDisplayName('asset', 'Asset mặc định'), options });
      }
    }
  } else if (selectedId === '@brand') {
    addField(host, 'pageName', template.brand.pageName, { label: fieldDisplayName('pageName', 'Tên Page'), wide: true, target: template.brand });
    addField(host, 'tagline', template.brand.tagline, { label: fieldDisplayName('tagline', 'Tagline'), wide: true, target: template.brand });
    addField(host, 'fontFamily', template.brand.fontFamily, { label: fieldDisplayName('fontFamily', 'Font family'), wide: true, target: template.brand });
    for (const key of ['primaryColor', 'secondaryColor', 'accentColor', 'bodyColor', 'backgroundColor']) addField(host, key, template.brand[key], { type: 'color', label: fieldDisplayName(key), target: template.brand });
  } else {
    for (const key of ['intro', 'vocabularyHold', 'transition', 'transitionFade', 'cta', 'fade']) addField(host, key, template.timing[key], { label: fieldDisplayName(key, ({ transition: 'Giữ màn hình đen', transitionFade: 'Fade chuyển cảnh' })[key] || key), type: 'number', min: 0, max: 8, step: 0.01, target: template.timing });
  }
}
function renderBrandTiming() { const brandHost = $('#brand-properties'); brandHost.replaceChildren(); addField(brandHost,'pageName',template.brand.pageName,{label:fieldDisplayName('pageName','Tên Page'),wide:true,target:template.brand}); addField(brandHost,'tagline',template.brand.tagline,{label:fieldDisplayName('tagline','Tagline'),wide:true,target:template.brand}); addField(brandHost,'fontFamily',template.brand.fontFamily,{label:fieldDisplayName('fontFamily','Font family'),wide:true,target:template.brand}); for (const key of ['primaryColor','secondaryColor','accentColor','bodyColor']) addField(brandHost,key,template.brand[key],{type:'color',label:fieldDisplayName(key),target:template.brand}); const timingHost=$('#timing-properties');timingHost.replaceChildren(); for(const key of ['intro','vocabularyHold','transition','transitionFade','cta','fade'])addField(timingHost,key,template.timing[key],{type:'number',min:0,max:8,step:.01,label:fieldDisplayName(key,({intro:'Intro',vocabularyHold:'Giữ từ vựng',transition:'Giữ màn hình đen',transitionFade:'Fade chuyển cảnh',cta:'CTA',fade:'Fade intro'})[key]),target:template.timing}); }
function restoreUnsavedLayerPositions(root) {
  const saved = savedTemplateCache.get(activeLanguage);
  if (!saved) return;
  for (const baseLayer of template.layers) {
    const layer = activeLanguage === 'ja' ? editableLayer(baseLayer.id) : baseLayer;
    const baseline = activeLanguage === 'ja' ? editableLayer(baseLayer.id, saved, activeJapaneseStyle) : saved.layers.find((item) => item.id === layer.id);
    if (!baseline) continue;
    const dx = (Number(layer.x) || 0) - (Number(baseline.x) || 0);
    const dy = (Number(layer.y) || 0) - (Number(baseline.y) || 0);
    const scaleX = activeLanguage === 'ja' ? (Number(layer.width) || 1) / (Number(baseline.width) || 1) : 1;
    const scaleY = activeLanguage === 'ja' ? (Number(layer.height) || 1) / (Number(baseline.height) || 1) : 1;
    if (!dx && !dy && scaleX === 1 && scaleY === 1) continue;
    const group = root.querySelector('[data-layer-id="' + CSS.escape(layer.id) + '"]');
    if (!group) continue;
    const existing = group.getAttribute('transform');
    if (activeLanguage === 'ja') {
      const translateX = Number(layer.x) - Number(baseline.x) * scaleX;
      const translateY = Number(layer.y) - Number(baseline.y) * scaleY;
      group.setAttribute('transform', `translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})${existing ? ` ${existing}` : ''}`);
    } else group.setAttribute('transform', `translate(${dx} ${dy})${existing ? ` ${existing}` : ''}`);
  }
}
async function renderPreview() { if (!template) return; try { const params = new URLSearchParams({state:activeState,index:$('#scene-index').value,lang:activeLanguage}); if(activeLanguage==='ja')params.set('jaStyle',activeJapaneseStyle); const response=await fetch(`/api/visual-template/preview.svg?${params}`); const svg=await response.text(); if(!response.ok)throw new Error(svg); const content=$('#canvas-content'); content.innerHTML=svg; const root=content.querySelector('svg'); restoreUnsavedLayerPositions(root); root.addEventListener('pointerdown',startDrag); root.addEventListener('pointermove',moveDrag); root.addEventListener('pointerup',endDrag); root.addEventListener('pointercancel',endDrag); root.addEventListener('wheel',resizeLayerWithWheel,{passive:false}); renderAlignmentUi(); const sceneLabels=activeLanguage==='ja'?japaneseLabels:activeLanguage==='zh'?chineseLabels:labels; $('#preview-title').textContent=sceneLabels[activeState]; status(activeLanguage==='ja'?'Bản xem trước đã cập nhật.':'Preview đã cập nhật.'); }catch(error){status(error.message,true);} }
function resizeLayerWithWheel(event) {
  if (activeLanguage !== 'ja') return;
  const group = event.target.closest?.('[data-layer-id]');
  const layerId = group?.dataset.layerId || selectedId;
  if (!layerId || layerId === 'background') return;
  const layer = editableLayer(layerId);
  if (!layer) return;
  const previewGroup = group || $('#canvas-content').querySelector(`[data-layer-id="${CSS.escape(layer.id)}"]`);
  if (!previewGroup) return;
  event.preventDefault(); event.stopPropagation();
  if (!wheelSnapshotActive) { snapshot(); wheelSnapshotActive = true; }
  clearTimeout(wheelSnapshotTimer);
  wheelSnapshotTimer = setTimeout(() => { wheelSnapshotActive = false; }, 350);
  selectedId = layer.id; selectedIds = new Set([layer.id]);
  const factor = Math.max(.88, Math.min(1.14, Math.pow(1.06, -event.deltaY / 100)));
  const oldWidth = Number(layer.width) || 1; const oldHeight = Number(layer.height) || 1;
  const centerX = Number(layer.x) + oldWidth / 2; const centerY = Number(layer.y) + oldHeight / 2;
  const maxWidth = 2160; const maxHeight = 2400;
  const newWidth = Math.max(24, Math.min(maxWidth, Math.round(oldWidth * factor)));
  const newHeight = Math.max(24, Math.min(maxHeight, Math.round(oldHeight * factor)));
  const actualScale = Math.sqrt((newWidth / oldWidth) * (newHeight / oldHeight));
  layer.width = newWidth; layer.height = newHeight;
  layer.x = Math.max(0, Math.min(2160 - newWidth, Math.round(centerX - newWidth / 2)));
  layer.y = Math.max(0, Math.min(3000 - newHeight, Math.round(centerY - newHeight / 2)));
  for (const key of ['fontSize', 'padding', 'radius', 'lineHeight']) {
    if (!Number.isFinite(Number(layer[key]))) continue;
    const minimum = key === 'fontSize' ? 12 : 0;
    const maximum = key === 'fontSize' ? 140 : 200;
    layer[key] = Math.max(minimum, Math.min(maximum, Math.round(Number(layer[key]) * actualScale)));
  }
  const saved = savedTemplateCache.get('ja');
  const baseline = editableLayer(layer.id, saved, activeJapaneseStyle) || layer;
  const scaleX = Number(layer.width) / (Number(baseline.width) || 1); const scaleY = Number(layer.height) / (Number(baseline.height) || 1);
  const translateX = Number(layer.x) - Number(baseline.x) * scaleX; const translateY = Number(layer.y) - Number(baseline.y) * scaleY;
  previewGroup.setAttribute('transform', `translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})`);
  renderLayers(); renderProperties(); renderAlignmentUi();
  status(factor > 1 ? 'Đã phóng to lớp. Hãy lưu mẫu để dùng trong video.' : 'Đã thu nhỏ lớp. Hãy lưu mẫu để dùng trong video.');
  debouncePreview();
}
function startDrag(event) {
  const group = event.target.closest?.('[data-layer-id]'); if (!group || group.dataset.layerId === 'background') return;
  const id = group.dataset.layerId; const additive = event.shiftKey || event.ctrlKey || event.metaKey;
  if (additive) {
    if (selectedIds.has(id) && selectedIds.size > 1) { selectedIds.delete(id); selectedId = [...selectedIds].at(-1) || null; }
    else { selectedIds.add(id); selectedId = id; }
  } else if (!selectedIds.has(id)) { selectedIds = new Set([id]); selectedId = id; }
  else selectedId = id;
  if (!selectedIds.has(id)) { renderLayers(); renderProperties(); renderAlignmentUi(); return; }
  const root = event.currentTarget;
  const items = selectedLayers().map((layer) => ({
    layer, group: root.querySelector('[data-layer-id="' + CSS.escape(layer.id) + '"]'),
    originX: Number(layer.x) || 0, originY: Number(layer.y) || 0, baseTransform: ''
  })).filter((item) => item.group);
  if (!items.length) return;
  for (const item of items) item.baseTransform = item.group.getAttribute('transform') || '';
  snapshot(); drag = { items, startX: event.clientX, startY: event.clientY, scale: Number(template.canvas.width) / $('#canvas').getBoundingClientRect().width };
  event.currentTarget.setPointerCapture?.(event.pointerId); renderLayers(); renderProperties(); renderAlignmentUi();
}
function moveDrag(event) {
  if (!drag) return;
  const dx = (event.clientX - drag.startX) * drag.scale; const dy = (event.clientY - drag.startY) * drag.scale;
  for (const item of drag.items) {
    if (activeLanguage === 'ja') {
      const maxX = Math.max(0, 2160 - (Number(item.layer.width) || 0));
      const maxY = Math.max(0, 3000 - (Number(item.layer.height) || 0));
      item.layer.x = Math.max(0, Math.min(maxX, Math.round(item.originX + dx)));
      item.layer.y = Math.max(0, Math.min(maxY, Math.round(item.originY + dy)));
    } else {
      item.layer.x = Math.max(0, Math.round(item.originX + dx));
      item.layer.y = Math.max(0, Math.round(item.originY + dy));
    }
    const movement = 'translate(' + (item.layer.x - item.originX) + ' ' + (item.layer.y - item.originY) + ')';
    item.group.setAttribute('transform', movement + (item.baseTransform ? ' ' + item.baseTransform : ''));
  }
  renderAlignmentUi(); status(activeLanguage === 'ja' ? 'Đã đổi vị trí lớp. Hãy lưu mẫu.' : 'Vị trí layer đã đổi; hãy lưu template.');
}
function endDrag() { if (!drag) return; drag = null; renderLayers(); renderProperties(); renderAlignmentUi(); }
$('#save').addEventListener('click',async()=>{try{const result=await api(templateApiPath(),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(template)});template=result.template;templateCache.set(activeLanguage,clone(template));savedTemplateCache.set(activeLanguage,clone(template));status(({zh:'Đã lưu riêng template tiếng Trung.',ja:'Đã lưu mẫu tiếng Nhật riêng.',en:'Đã lưu template thương hiệu.'})[activeLanguage]);}catch(error){status(error.message,true);}});
$('#undo').addEventListener('click',()=>{if(!undoStack.length)return;template=undoStack.pop();renderAll();status('Đã hoàn tác.');});
$('#reset').addEventListener('click',async()=>{if(!confirm(({zh:'Đặt lại template tiếng Trung về mẫu mặc định?',ja:'Khôi phục mẫu tiếng Nhật về thiết kế ban đầu?',en:'Đưa template và asset mặc định về thiết kế V2 ban đầu?'})[activeLanguage]))return;try{const result=await api(templateResetPath(),{method:'POST'});template=result.template;templateCache.set(activeLanguage,clone(template));savedTemplateCache.set(activeLanguage,clone(template));undoStack=[];renderAll();status('Đã khôi phục mẫu mặc định.');}catch(error){status(error.message,true);}});
$('#scene-index').addEventListener('change',renderPreview);$('#preview').addEventListener('click',renderPreview);
$('#render-test').addEventListener('click',async()=>{const button=$('#render-test');button.disabled=true;try{const result=await api('/api/visual-template/render-test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({state:activeState,index:Number($('#scene-index').value),contentLanguage:activeLanguage,...(activeLanguage==='ja'?{jaStyle:activeJapaneseStyle}:{})})});status(activeLanguage==='ja'?'Đang tạo video xem thử 5 giây…':'Đang render video test 5 giây qua worker…');let job;for(let attempt=0;attempt<120;attempt++){await new Promise(resolve=>setTimeout(resolve,500));job=await api(`/api/visual-template/render-test/status/${result.jobId}`);if(job.status==='completed')break;if(job.status==='failed')throw new Error(job.error||'Worker không render được preview.');}if(job?.status!=='completed')throw new Error('Render thử vượt quá 60 giây. Kiểm tra trạng thái worker.');const host=$('#test-output');host.hidden=false;host.innerHTML=`<video controls playsinline src="${result.url}"></video><a href="${result.url}" download="visual-test.mp4">${activeLanguage==='ja'?'Tải video xem thử 5 giây':'Tải video test 5 giây'}</a>`;status(activeLanguage==='ja'?'Đã tạo video xem thử H.264/AAC 1080×1920.':'Đã render video test H.264/AAC 1080×1920.');}catch(error){status(error.message,true);}finally{button.disabled=false;}});
$('#render-full').addEventListener('click',async()=>{try{const result=await api('/api/visual-template/render-full',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contentLanguage:activeLanguage})});fullRenderJobId=result.jobId;$('#render-progress').hidden=false;$('#progress-bar').style.width='0%';$('#progress-label').textContent=activeLanguage==='ja'?'Tiến độ dựng video: 0%':'Render: 0%';status(activeLanguage==='ja'?`Đã xếp lịch dựng video. Mã công việc ${result.jobId}. Theo dõi tiến độ tại đây hoặc trong Nhật ký.`:`Đã xếp render đầy đủ. Job ${result.jobId}. Theo dõi tiến độ ở đây hoặc trong Nhật ký.`);}catch(error){status(error.message,true);}});
function renderAll(){applyEditorLanguageChrome();renderStates();renderLayers();renderProperties();renderBrandTiming();renderPreview();renderEditorChrome();$('#undo').disabled=!undoStack.length;}
async function init(){try{const [templateResponse,assetResponse]=await Promise.all([api(templateApiPath()),api('/api/assets')]);template=templateResponse.template;templateCache.set(activeLanguage,clone(template));savedTemplateCache.set(activeLanguage,clone(template));assets=assetResponse.assets;renderAll();status(activeLanguage==='ja'?'Đã tải mẫu.':'Template đã tải.');const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);ws.addEventListener('open',()=>$('#connection').classList.add('online'));ws.addEventListener('close',()=>{$('#connection').classList.remove('online');$('#connection').textContent='Mất kết nối';});ws.addEventListener('message',(event)=>{const message=JSON.parse(event.data);if(message.type==='render:progress'){const value=Math.round(Number(message.data?.detail?.progress||0)*100);$('#render-progress').hidden=false;$('#progress-bar').style.width=`${value}%`;$('#progress-label').textContent=activeLanguage==='ja'?`Tiến độ dựng video: ${value}%`:`Render: ${value}%`;}if(message.type==='job:status'&&message.data?.job_id===fullRenderJobId){if(message.data.code==='JOB_COMPLETED')status(activeLanguage==='ja'?'Dựng video hoàn tất; video đã có trong thư viện.':'Render đầy đủ hoàn tất; video đã vào thư viện.');if(message.data.code==='JOB_FAILED')status(message.data.message||'Render đầy đủ thất bại.',true);}if(message.type==='template:saved'&&(!message.data?.contentLanguage||message.data.contentLanguage===activeLanguage))api(templateApiPath()).then((result)=>{template=result.template;savedTemplateCache.set(activeLanguage,clone(template));templateCache.set(activeLanguage,clone(template));renderAll();}).catch(()=>{});if(message.type==='asset:updated')api('/api/assets').then((result)=>{assets=result.assets;renderProperties();}).catch(()=>{});});}catch(error){status(error.message,true);}}
document.addEventListener('keydown',(event)=>{const editingField=['INPUT','TEXTAREA','SELECT'].includes(event.target?.tagName);if(event.key==='Delete'&&selectedGuideId&&!guidesLocked&&!editingField){guides=guides.filter((guide)=>guide.id!==selectedGuideId);selectedGuideId=null;renderGuides();status(activeLanguage==='ja'?'Đã xóa đường căn.':'Đã xóa guide khỏi editor.');event.preventDefault();return;}if(event.key==='Escape'&&selectedGuideId){selectedGuideId=null;renderGuides();return;}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();$('#undo').click();}});
$('#editor-language-select').addEventListener('change',(event)=>switchEditorLanguage(event.currentTarget.value).catch((error)=>status(error.message,true)));
$('#japanese-style-select').addEventListener('change',(event)=>{activeJapaneseStyle=event.currentTarget.value;renderAll();status(`Đang xem ${japaneseVideoStyles.find((item)=>item.value===activeJapaneseStyle)?.label||'mẫu tiếng Nhật'}.`);});
$('#shadowing-editor-button').addEventListener('click', openShadowingEditor);
$('#toggle-rulers').addEventListener('click',()=>{showRulers=!showRulers;renderGuides();});
$('#toggle-guides').addEventListener('click',()=>{showGuides=!showGuides;renderGuides();});
$('#toggle-grid').addEventListener('click',()=>{showGrid=!showGrid;renderGuides();});
$('#lock-guides').addEventListener('click',()=>{guidesLocked=!guidesLocked;if(guidesLocked)selectedGuideId=null;renderGuides();status(activeLanguage==='ja'?(guidesLocked?'Đã khóa đường căn. Mở khóa trước khi kéo, xóa hoặc thêm đường căn.':'Đã mở khóa đường căn. Kéo từ thước để thêm đường căn.'):(guidesLocked?'Đã khóa guides; mở khóa trước khi kéo, xóa hoặc thêm guide.':'Đã mở khóa guides; kéo từ thước để thêm đường căn.'));});
$('#center-object').addEventListener('click',()=>applyAlignment('center-object'));
$('#align-left').addEventListener('click',()=>applyAlignment('align-left'));
$('#align-center').addEventListener('click',()=>applyAlignment('align-center'));
$('#align-right').addEventListener('click',()=>applyAlignment('align-right'));
$('#distribute-vertically').addEventListener('click',()=>applyAlignment('distribute-vertically'));
$('#ruler-top').addEventListener('pointerdown',(event)=>startGuideCreation(event,'vertical'));
$('#ruler-left').addEventListener('pointerdown',(event)=>startGuideCreation(event,'horizontal'));
window.addEventListener('resize',renderAlignmentUi);
init();
