const $ = (selector) => document.querySelector(selector);
const labels = { intro: 'Mở đầu', vietnamese: 'Tiếng Việt', bilingual: 'Việt + Anh', vocabulary: 'Từ vựng', transition: 'Chuyển cảnh', cta: 'Kêu gọi theo dõi' };
const chineseLabels = { intro: 'Mở đầu', vietnamese: 'Tiếng Việt', bilingual: 'Việt + Trung', vocabulary: 'Từ vựng', transition: 'Chuyển cảnh', cta: 'Kêu gọi theo dõi' };
let template; let assets = []; let selectedId = 'vietnamese-card'; let selectedIds = new Set(['vietnamese-card']); let activeState = 'bilingual'; let activeLanguage = 'en'; let undoStack = []; let drag = null; let guideDrag = null; let selectedGuideId = null; let guides = []; let showRulers = true; let showGuides = true; let showGrid = false; let guidesLocked = false; let previewTimer; let fullRenderJobId = null; const templateCache = new Map(); const savedTemplateCache = new Map(); const undoCache = new Map();
const clone = (value) => JSON.parse(JSON.stringify(value));
async function api(url, options = {}) { const response = await fetch(url, options); const data = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text(); if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`); return data; }
function status(message, error = false) { $('#status').textContent = message; $('#status').classList.toggle('error', error); }
function templateApiPath() { return `/api/visual-template?lang=${activeLanguage}`; }
function templateResetPath() { return `/api/visual-template/reset?lang=${activeLanguage}`; }
async function switchEditorLanguage(language) {
  if (!['en','zh'].includes(language)) return;
  document.body.classList.remove('shadowing-mode');
  $('#workspace').hidden = false;
  $('#shadowing-workspace').hidden = true;
  if (language === activeLanguage) {
    for (const button of document.querySelectorAll('[data-editor-language]')) button.classList.toggle('active', button.dataset.editorLanguage === language);
    $('#shadowing-editor-button').classList.remove('active');
    $('#template-language-label').textContent = language === 'zh' ? 'Template Việt–Trung · Hanzi + Pinyin · 1080 × 1920' : 'Branded Dialogue V2 · 1080 × 1920';
    return;
  }
  templateCache.set(activeLanguage, clone(template)); undoCache.set(activeLanguage, undoStack);
  activeLanguage = language; activeState = 'bilingual'; selectedId = language === 'zh' ? 'chinese-card' : 'english-card'; selectedIds = new Set([selectedId]);
  const cached = templateCache.get(language);
  if (cached) { template = clone(cached); undoStack = undoCache.get(language) || []; }
  else { const result = await api(templateApiPath()); template = result.template; savedTemplateCache.set(language, clone(template)); undoStack = []; }
  for (const button of document.querySelectorAll('[data-editor-language]')) button.classList.toggle('active', button.dataset.editorLanguage === language);
  $('#shadowing-editor-button').classList.remove('active');
  $('#template-language-label').textContent = language === 'zh' ? 'Template Việt–Trung · Hanzi + Pinyin · 1080 × 1920' : 'Branded Dialogue V2 · 1080 × 1920';
  $('#scene-index').innerHTML = language === 'zh' ? '<option value="0">01</option>' : '<option value="0">01</option><option value="1">02</option><option value="2">03</option>';
  renderAll(); status(language === 'zh' ? 'Đã mở template tiếng Trung riêng.' : 'Đã mở template tiếng Anh hiện tại.');
}
function openShadowingEditor() {
  document.body.classList.add('shadowing-mode');
  $('#workspace').hidden = true;
  $('#shadowing-workspace').hidden = false;
  for (const button of document.querySelectorAll('[data-editor-language]')) button.classList.remove('active');
  $('#shadowing-editor-button').classList.add('active');
  $('#template-language-label').textContent = 'EnglishShadowing · preset riêng · 1080 × 1920';
  $('#shadowing-editor-status').textContent = 'Preset tự động đang hoạt động. Các tùy chỉnh riêng sẽ được thêm tại đây sau.';
}
function snapshot() { undoStack.push(clone(template)); if (undoStack.length > 40) undoStack.shift(); $('#undo').disabled = !undoStack.length; }
function debouncePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 120); }
function selectedLayers() { return template?.layers.filter((layer) => selectedIds.has(layer.id) && layer.id !== 'background') || []; }
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
  $('#ruler-top').title = 'Kéo từ thước ngang để tạo guide dọc'; $('#ruler-left').title = 'Kéo từ thước dọc để tạo guide ngang';
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
  $('#lock-guides').textContent = guidesLocked ? '🔒 Mở khóa Guides' : '🔓 Khóa Guides';
  if (showGuides) for (const guide of guides) {
    const line = document.createElement('div'); line.className = `custom-guide ${guide.orientation}${selectedGuideId === guide.id ? ' selected' : ''}`;
    line.style[guide.orientation === 'vertical' ? 'left' : 'top'] = `${(guide.position / (guide.orientation === 'vertical' ? template.canvas.width : template.canvas.height)) * 100}%`;
    line.title = `${guide.orientation === 'vertical' ? 'Guide dọc' : 'Guide ngang'} · ${Math.round(guide.position)} px${guidesLocked ? ' · đã khóa' : ' · kéo để di chuyển'}`;
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
    metrics.push(`${layer.label || layer.id}: trái ${left} px · phải ${right} px`);
    if (!rect || !canvasRect.width || !canvasRect.height) continue;
    const outline = document.createElement('div'); outline.className = 'selection-outline';
    outline.style.left = `${(rect.left - canvasRect.left) / canvasRect.width * 100}%`;
    outline.style.top = `${(rect.top - canvasRect.top) / canvasRect.height * 100}%`;
    outline.style.width = `${rect.width / canvasRect.width * 100}%`; outline.style.height = `${rect.height / canvasRect.height * 100}%`;
    host.append(outline);
  }
  $('#alignment-readout').textContent = metrics.length ? metrics.join('  |  ') : 'Chọn layer để xem khoảng cách mép trái/phải. Shift hoặc Ctrl/Cmd + bấm để chọn nhiều layer.';
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
  renderAll(); status('Đã căn chỉnh layer. Lưu template để dùng bố cục mới khi render.');
}
function addField(parent, key, value, { label = key, type = 'text', min, max, step, wide = false, options, target } = {}) {
  const wrapper = document.createElement('div'); wrapper.className = `field${wide ? ' wide' : ''}`;
  const title = document.createElement('label'); title.textContent = label; title.htmlFor = `field-${key}`;
  const input = options ? document.createElement('select') : document.createElement('input'); input.id = `field-${key}`; input.dataset.key = key;
  if (options) { for (const option of options) { const item = document.createElement('option'); item.value = option.value; item.textContent = option.label; input.append(item); } input.value = value ?? ''; }
  else { input.type = type; if (min !== undefined) input.min = min; if (max !== undefined) input.max = max; if (step !== undefined) input.step = step; input.value = value ?? ''; }
  input.addEventListener('focus', () => { input.dataset.seed = JSON.stringify(template); });
  input.addEventListener('change', () => { if (input.dataset.seed) { undoStack.push(JSON.parse(input.dataset.seed)); input.dataset.seed = ''; $('#undo').disabled = !undoStack.length; } const found = target || template.layers.find((item) => item.id === selectedId); if (found && (key in found || (found.id === 'footer' && key === 'text'))) found[key] = type === 'number' ? Number(input.value) : input.value; else if (selectedId === '@brand') template.brand[key] = input.value; else if (selectedId === '@timing') template.timing[key] = Number(input.value); renderLayers(); renderProperties(); debouncePreview(); status('Có thay đổi chưa lưu.'); });
  wrapper.append(title, input); parent.append(wrapper); return input;
}
function renderStates() { const host = $('#states'); host.replaceChildren(); for (const [id, label] of Object.entries(activeLanguage === 'zh' ? chineseLabels : labels)) { const button = document.createElement('button'); button.className = `state-button${activeState === id ? ' active' : ''}`; button.textContent = label; button.addEventListener('click', () => { activeState = id; renderStates(); renderPreview(); }); host.append(button); } }
function renderLayers() { const host = $('#layers'); host.replaceChildren(); $('#layer-count').textContent = `${template.layers.length} layers`; for (const layer of template.layers) { const row = document.createElement('div'); row.dataset.layerId = layer.id; row.className = `layer-item${selectedId === layer.id ? ' selected' : ''}`; const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = layer.visible !== false; checkbox.title = 'Hiện layer'; checkbox.addEventListener('click', (event) => event.stopPropagation()); checkbox.addEventListener('change', () => { snapshot(); layer.visible = checkbox.checked; renderPreview(); status('Có thay đổi chưa lưu.'); }); const name = document.createElement('span'); name.textContent = layer.label || layer.id; const dimensions = document.createElement('small'); dimensions.textContent = `${layer.x}, ${layer.y}`; row.append(checkbox, name, dimensions); row.addEventListener('click', (event) => { if (event.shiftKey || event.ctrlKey || event.metaKey) { if (selectedIds.has(layer.id) && selectedIds.size > 1) { selectedIds.delete(layer.id); selectedId = [...selectedIds].at(-1) || layer.id; } else { selectedIds.add(layer.id); selectedId = layer.id; } } else { selectedId = layer.id; selectedIds = new Set([layer.id]); } renderLayers(); renderProperties(); renderAlignmentUi(); }); host.append(row); } }
function renderProperties() {
  const host = $('#properties');
  host.replaceChildren();
  const layer = template.layers.find((item) => item.id === selectedId);
  $('#selected-name').textContent = layer ? layer.label : selectedId === '@brand' ? 'Nhận diện trang' : 'Thiết lập nhịp dựng';
  if (layer) {
    for (const key of ['x', 'y', 'width', 'height']) addField(host, key, layer[key], { label: ({ x: 'Vị trí X', y: 'Vị trí Y', width: 'Rộng', height: 'Cao' })[key], type: 'number', min: 0, max: 2400, step: 1 });
    addField(host, 'opacity', layer.opacity ?? 1, { label: 'Độ mờ', type: 'number', min: 0, max: 1, step: 0.05 });
    for (const key of ['fontSize', 'fontWeight', 'radius', 'padding']) if (key in layer) addField(host, key, layer[key], { type: 'number', min: 0, max: 200, step: 1 });
    if (layer.id === 'pinyin') {
      addField(host, 'fontFamily', layer.fontFamily || template.brand.fontFamily, { label: 'Font chữ Pinyin', wide: true });
      addField(host, 'appearanceEffect', layer.appearanceEffect || 'none', { label: 'Hiệu ứng xuất hiện', options: [{ value: 'none', label: 'Không hiệu ứng' }, { value: 'fade', label: 'Mờ nhẹ' }, { value: 'rise', label: 'Trượt lên' }, { value: 'pop', label: 'Phóng nhẹ' }] });
    }
    if (layer.id === 'footer') addField(host, 'text', layer.text ?? '', { label: 'Nội dung Footer', wide: true });
    for (const key of ['color', 'fill', 'stroke', 'accent', 'highlightColor']) if (key in layer && /^#[0-9a-f]{6}$/i.test(layer[key])) addField(host, key, layer[key], { type: 'color', label: key });
    if (layer.asset) {
      const family = layer.id === 'background' ? 'background' : layer.id === 'character' ? 'character' : layer.id === 'logo' ? 'logo' : null;
      if (family) {
        const options = [{ value: layer.asset, label: 'Hiện tại' }];
        for (const item of assets.filter((asset) => asset.type === family)) if (!options.some((entry) => entry.value === item.file)) options.push({ value: item.file, label: item.name });
        addField(host, 'asset', layer.asset, { label: 'Asset mặc định', options });
      }
    }
  } else if (selectedId === '@brand') {
    addField(host, 'pageName', template.brand.pageName, { label: 'Tên Page', wide: true, target: template.brand });
    addField(host, 'tagline', template.brand.tagline, { label: 'Tagline', wide: true, target: template.brand });
    addField(host, 'fontFamily', template.brand.fontFamily, { label: 'Font family', wide: true, target: template.brand });
    for (const key of ['primaryColor', 'secondaryColor', 'accentColor', 'bodyColor', 'backgroundColor']) addField(host, key, template.brand[key], { type: 'color', label: key, target: template.brand });
  } else {
    for (const key of ['intro', 'vocabularyHold', 'transition', 'transitionFade', 'cta', 'fade']) addField(host, key, template.timing[key], { label: ({ transition: 'Giữ màn hình đen', transitionFade: 'Fade chuyển cảnh' })[key] || key, type: 'number', min: 0, max: 8, step: 0.01, target: template.timing });
  }
}
function renderBrandTiming() { const brandHost = $('#brand-properties'); brandHost.replaceChildren(); addField(brandHost,'pageName',template.brand.pageName,{label:'Tên Page',wide:true,target:template.brand}); addField(brandHost,'tagline',template.brand.tagline,{label:'Tagline',wide:true,target:template.brand}); addField(brandHost,'fontFamily',template.brand.fontFamily,{label:'Font family',wide:true,target:template.brand}); for (const key of ['primaryColor','secondaryColor','accentColor','bodyColor']) addField(brandHost,key,template.brand[key],{type:'color',label:key,target:template.brand}); const timingHost=$('#timing-properties');timingHost.replaceChildren(); for(const key of ['intro','vocabularyHold','transition','transitionFade','cta','fade'])addField(timingHost,key,template.timing[key],{type:'number',min:0,max:8,step:.01,label:({intro:'Intro',vocabularyHold:'Giữ từ vựng',transition:'Giữ màn hình đen',transitionFade:'Fade chuyển cảnh',cta:'CTA',fade:'Fade intro'})[key],target:template.timing}); }
function restoreUnsavedLayerPositions(root) {
  const saved = savedTemplateCache.get(activeLanguage);
  if (!saved) return;
  for (const layer of template.layers) {
    const baseline = saved.layers.find((item) => item.id === layer.id);
    if (!baseline) continue;
    const dx = (Number(layer.x) || 0) - (Number(baseline.x) || 0);
    const dy = (Number(layer.y) || 0) - (Number(baseline.y) || 0);
    if (!dx && !dy) continue;
    const group = root.querySelector('[data-layer-id="' + CSS.escape(layer.id) + '"]');
    if (!group) continue;
    const existing = group.getAttribute('transform');
    group.setAttribute('transform', `translate(${dx} ${dy})${existing ? ` ${existing}` : ''}`);
  }
}
async function renderPreview() { if (!template) return; try { const params = new URLSearchParams({state:activeState,index:$('#scene-index').value,lang:activeLanguage}); const response=await fetch(`/api/visual-template/preview.svg?${params}`); const svg=await response.text(); if(!response.ok)throw new Error(svg); const canvas=$('#canvas'); const content=$('#canvas-content'); content.innerHTML=svg; const root=content.querySelector('svg'); restoreUnsavedLayerPositions(root); root.addEventListener('pointerdown',startDrag); root.addEventListener('pointermove',moveDrag); root.addEventListener('pointerup',endDrag); root.addEventListener('pointercancel',endDrag); renderAlignmentUi(); $('#preview-title').textContent=(activeLanguage==='zh'?chineseLabels:labels)[activeState]; status('Preview đã cập nhật.'); }catch(error){status(error.message,true);} }
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
    item.layer.x = Math.max(0, Math.round(item.originX + dx)); item.layer.y = Math.max(0, Math.round(item.originY + dy));
    const movement = 'translate(' + (item.layer.x - item.originX) + ' ' + (item.layer.y - item.originY) + ')';
    item.group.setAttribute('transform', movement + (item.baseTransform ? ' ' + item.baseTransform : ''));
  }
  renderAlignmentUi(); status('Vị trí layer đã đổi; hãy lưu template.');
}
function endDrag() { if (!drag) return; drag = null; renderLayers(); renderProperties(); renderAlignmentUi(); }
$('#save').addEventListener('click',async()=>{try{const result=await api(templateApiPath(),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(template)});template=result.template;templateCache.set(activeLanguage,clone(template));savedTemplateCache.set(activeLanguage,clone(template));status(activeLanguage==='zh'?'Đã lưu riêng template tiếng Trung.':'Đã lưu template thương hiệu.');}catch(error){status(error.message,true);}});
$('#undo').addEventListener('click',()=>{if(!undoStack.length)return;template=undoStack.pop();renderAll();status('Đã hoàn tác.');});
$('#reset').addEventListener('click',async()=>{if(!confirm(activeLanguage==='zh'?'Đặt lại template tiếng Trung về mẫu mặc định?':'Đưa template và asset mặc định về thiết kế V2 ban đầu?'))return;try{const result=await api(templateResetPath(),{method:'POST'});template=result.template;templateCache.set(activeLanguage,clone(template));savedTemplateCache.set(activeLanguage,clone(template));undoStack=[];renderAll();status('Đã khôi phục template mặc định.');}catch(error){status(error.message,true);}});
$('#scene-index').addEventListener('change',renderPreview);$('#preview').addEventListener('click',renderPreview);
$('#render-test').addEventListener('click',async()=>{const button=$('#render-test');button.disabled=true;try{const result=await api('/api/visual-template/render-test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({state:activeState,index:Number($('#scene-index').value),contentLanguage:activeLanguage})});status('Đang render video test 5 giây qua worker…');let job;for(let attempt=0;attempt<120;attempt++){await new Promise(resolve=>setTimeout(resolve,500));job=await api(`/api/visual-template/render-test/status/${result.jobId}`);if(job.status==='completed')break;if(job.status==='failed')throw new Error(job.error||'Worker không render được preview.');}if(job?.status!=='completed')throw new Error('Render thử vượt quá 60 giây. Kiểm tra trạng thái worker.');const host=$('#test-output');host.hidden=false;host.innerHTML=`<video controls playsinline src="${result.url}"></video><a href="${result.url}" download="visual-test.mp4">Tải video test 5 giây</a>`;status('Đã render video test H.264/AAC 1080×1920.');}catch(error){status(error.message,true);}finally{button.disabled=false;}});
$('#render-full').addEventListener('click',async()=>{try{const result=await api('/api/visual-template/render-full',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({contentLanguage:activeLanguage})});fullRenderJobId=result.jobId;$('#render-progress').hidden=false;$('#progress-bar').style.width='0%';$('#progress-label').textContent='Render: 0%';status(`Đã xếp render đầy đủ. Job ${result.jobId}. Theo dõi tiến độ ở đây hoặc trong Nhật ký.`);}catch(error){status(error.message,true);}});
function renderAll(){renderStates();renderLayers();renderProperties();renderBrandTiming();renderPreview();renderEditorChrome();$('#undo').disabled=!undoStack.length;}
async function init(){try{const [templateResponse,assetResponse]=await Promise.all([api(templateApiPath()),api('/api/assets')]);template=templateResponse.template;templateCache.set(activeLanguage,clone(template));savedTemplateCache.set(activeLanguage,clone(template));assets=assetResponse.assets;renderAll();status('Template đã tải.');const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);ws.addEventListener('open',()=>$('#connection').classList.add('online'));ws.addEventListener('close',()=>{$('#connection').classList.remove('online');$('#connection').textContent='Mất kết nối';});ws.addEventListener('message',(event)=>{const message=JSON.parse(event.data);if(message.type==='render:progress'){const value=Math.round(Number(message.data?.detail?.progress||0)*100);$('#render-progress').hidden=false;$('#progress-bar').style.width=`${value}%`;$('#progress-label').textContent=`Render: ${value}%`;}if(message.type==='job:status'&&message.data?.job_id===fullRenderJobId){if(message.data.code==='JOB_COMPLETED')status('Render đầy đủ hoàn tất; video đã vào thư viện.');if(message.data.code==='JOB_FAILED')status(message.data.message||'Render đầy đủ thất bại.',true);}if(message.type==='template:saved'&&(!message.data?.contentLanguage||message.data.contentLanguage===activeLanguage))api(templateApiPath()).then((result)=>{template=result.template;savedTemplateCache.set(activeLanguage,clone(template));templateCache.set(activeLanguage,clone(template));renderAll();}).catch(()=>{});if(message.type==='asset:updated')api('/api/assets').then((result)=>{assets=result.assets;renderProperties();}).catch(()=>{});});}catch(error){status(error.message,true);}}
document.addEventListener('keydown',(event)=>{const editingField=['INPUT','TEXTAREA','SELECT'].includes(event.target?.tagName);if(event.key==='Delete'&&selectedGuideId&&!guidesLocked&&!editingField){guides=guides.filter((guide)=>guide.id!==selectedGuideId);selectedGuideId=null;renderGuides();status('Đã xóa guide khỏi editor.');event.preventDefault();return;}if(event.key==='Escape'&&selectedGuideId){selectedGuideId=null;renderGuides();return;}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();$('#undo').click();}});
for (const button of document.querySelectorAll('[data-editor-language]')) button.addEventListener('click',()=>switchEditorLanguage(button.dataset.editorLanguage).catch((error)=>status(error.message,true)));
$('#shadowing-editor-button').addEventListener('click', openShadowingEditor);
$('#toggle-rulers').addEventListener('click',()=>{showRulers=!showRulers;renderGuides();});
$('#toggle-guides').addEventListener('click',()=>{showGuides=!showGuides;renderGuides();});
$('#toggle-grid').addEventListener('click',()=>{showGrid=!showGrid;renderGuides();});
$('#lock-guides').addEventListener('click',()=>{guidesLocked=!guidesLocked;if(guidesLocked)selectedGuideId=null;renderGuides();status(guidesLocked?'Đã khóa guides; mở khóa trước khi kéo, xóa hoặc thêm guide.':'Đã mở khóa guides; kéo từ thước để thêm đường căn.');});
$('#center-object').addEventListener('click',()=>applyAlignment('center-object'));
$('#align-left').addEventListener('click',()=>applyAlignment('align-left'));
$('#align-center').addEventListener('click',()=>applyAlignment('align-center'));
$('#align-right').addEventListener('click',()=>applyAlignment('align-right'));
$('#distribute-vertically').addEventListener('click',()=>applyAlignment('distribute-vertically'));
$('#ruler-top').addEventListener('pointerdown',(event)=>startGuideCreation(event,'vertical'));
$('#ruler-left').addEventListener('pointerdown',(event)=>startGuideCreation(event,'horizontal'));
window.addEventListener('resize',renderAlignmentUi);
init();
