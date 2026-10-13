import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PATHS, ROOT } from '../../src/config.mjs';

export const BRANDING_DIR = path.join(ROOT, 'assets', 'branding');
export const TEMPLATE_PATH = path.join(BRANDING_DIR, 'visual-template.json');
export const TEMPLATE_VERSION = 2;
const FONT_DIR = path.join(BRANDING_DIR, 'fonts');
const FONT_CONFIG_DIR = path.join(PATHS.temporary, 'fontconfig');
const FONT_CONFIG = path.join(FONT_CONFIG_DIR, 'fonts.conf');

// Register the bundled OFL font with libvips before its first rasterization.
fs.mkdirSync(FONT_CONFIG_DIR, { recursive: true });
const fontDirXml = FONT_DIR.replace(/\\/g, '/').replaceAll('&', '&amp;');
fs.writeFileSync(FONT_CONFIG, `<?xml version="1.0"?><fontconfig><dir>${fontDirXml}</dir><dir>C:/Windows/Fonts</dir><cachedir>${path.join(FONT_CONFIG_DIR, 'cache').replace(/\\/g, '/')}</cachedir></fontconfig>`, 'utf8');
process.env.FONTCONFIG_FILE ||= FONT_CONFIG;
const { default: sharp } = await import('sharp');

const REQUIRED_LAYER_IDS = ['background', 'logo', 'facebook-logo', 'youtube-logo', 'title', 'scene-number', 'vietnamese-card', 'english-card', 'vocabulary', 'character', 'footer', 'cta'];
const VALID_SCENES = new Set(['intro', 'vietnamese', 'bilingual', 'vocabulary', 'transition', 'cta']);
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function readVisualTemplate() {
  const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  return validateVisualTemplate(template);
}

export function validateVisualTemplate(input) {
  if (!input || typeof input !== 'object' || input.version !== TEMPLATE_VERSION || input.templateId !== 'branded-dialogue-v2') {
    throw new Error('Template phải là Branded Dialogue V2.');
  }
  if (input.canvas?.width !== 1080 || input.canvas?.height !== 1920 || input.canvas?.fps !== 30) {
    throw new Error('Scene phải giữ khung 1080×1920 ở 30 FPS.');
  }
  if (!input.brand || typeof input.brand.pageName !== 'string' || input.brand.pageName.trim().length < 3 || input.brand.pageName.length > 80) {
    throw new Error('Tên Page cần từ 3 đến 80 ký tự.');
  }
  for (const key of ['primaryColor', 'secondaryColor', 'accentColor', 'bodyColor', 'backgroundColor', 'softGray']) {
    if (!COLOR_PATTERN.test(input.brand[key] || '')) throw new Error(`Màu thương hiệu ${key} không hợp lệ.`);
  }
  if (!Array.isArray(input.layers) || input.layers.length !== REQUIRED_LAYER_IDS.length) throw new Error('Template phải có đủ 12 layer chuẩn.');
  const seen = new Set();
  const layers = input.layers.map((layer) => {
    if (!REQUIRED_LAYER_IDS.includes(layer.id) || seen.has(layer.id)) throw new Error('Template có layer thiếu hoặc trùng ID.');
    seen.add(layer.id);
    const clean = { ...layer };
    for (const key of ['x', 'y', 'width', 'height']) {
      const value = Number(clean[key]);
      if (!Number.isFinite(value) || value < 0 || value > 2400 || ((key === 'width' || key === 'height') && value < 1)) throw new Error(`Tọa độ ${layer.id}.${key} không hợp lệ.`);
      clean[key] = Math.round(value);
    }
    if (clean.x + clean.width > 2160 || clean.y + clean.height > 3000) throw new Error(`Layer ${layer.id} vượt giới hạn scene.`);
    if (clean.visible !== undefined && typeof clean.visible !== 'boolean') throw new Error(`Cờ hiển thị ${layer.id} không hợp lệ.`);
    if (clean.id === 'footer' && clean.text !== undefined && (typeof clean.text !== 'string' || clean.text.length > 160)) throw new Error('Nội dung Footer tối đa 160 ký tự.');
    if (clean.fontSize !== undefined && (!Number.isFinite(Number(clean.fontSize)) || Number(clean.fontSize) < 12 || Number(clean.fontSize) > 140)) throw new Error(`Cỡ chữ ${layer.id} phải trong khoảng 12–140.`);
    for (const key of ['color', 'fill', 'stroke', 'accent', 'highlightColor']) {
      if (clean[key] !== undefined && !COLOR_PATTERN.test(clean[key])) throw new Error(`Màu ${layer.id}.${key} không hợp lệ.`);
    }
    if (clean.asset) resolveBrandingAsset(clean.asset);
    return clean;
  });
  const ids = new Set(layers.map((layer) => layer.id));
  if (REQUIRED_LAYER_IDS.some((id) => !ids.has(id))) throw new Error('Template thiếu một layer chuẩn.');
  const timing = { ...input.timing };
  if (timing.transitionFade === undefined) timing.transitionFade = timing.fade;
  for (const key of ['intro', 'vocabularyHold', 'transition', 'transitionFade', 'cta', 'fade']) {
    const value = Number(timing[key]);
    if (!Number.isFinite(value) || value < 0 || value > 8) throw new Error(`Thời gian ${key} phải trong khoảng 0–8 giây.`);
    timing[key] = value;
  }
  return { ...input, timing, layers };
}

export function saveVisualTemplate(input) {
  const template = validateVisualTemplate(input);
  const tempPath = `${TEMPLATE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, TEMPLATE_PATH);
  return template;
}

export function getLayer(template, layerId) {
  return template.layers.find((layer) => layer.id === layerId) || null;
}

export function resolveBrandingAsset(asset) {
  if (typeof asset !== 'string' || !asset || asset.includes('\0')) throw new Error('Tên asset không hợp lệ.');
  const absolute = path.resolve(BRANDING_DIR, asset);
  if (!absolute.startsWith(`${path.resolve(BRANDING_DIR)}${path.sep}`)) throw new Error('Asset phải nằm trong assets/branding.');
  return absolute;
}

export function getTemplateAssetVersions(template = readVisualTemplate()) {
  const fileNames = new Set(template.layers.filter((layer) => layer.asset).map((layer) => layer.asset));
  fileNames.add('brand-logo.svg');
  fileNames.add('brand-logo.png');
  fileNames.add('fonts/BeVietnamPro-Regular.ttf');
  fileNames.add('fonts/BeVietnamPro-SemiBold.ttf');
  fileNames.add('fonts/BeVietnamPro-Bold.ttf');
  if (template.brand.fontFile) fileNames.add(template.brand.fontFile);
  if (template.brand.iconFile) fileNames.add(template.brand.iconFile);
  if (template.brand.thumbnailFile) fileNames.add(template.brand.thumbnailFile);
  return [...fileNames].map((file) => {
    const absolute = resolveBrandingAsset(file);
    if (!fs.existsSync(absolute)) return { file, missing: true };
    const buffer = fs.readFileSync(absolute);
    return { file, bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
  });
}

function layerMap(template) { return new Map(template.layers.map((layer) => [layer.id, layer])); }
function xml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;'); }
function color(value, fallback) { return COLOR_PATTERN.test(value || '') ? value : fallback; }
function isNarrow(char) { return /[ilíìịỉĩI!|.,'’:;()\[\]{}]/u.test(char); }
function glyphWeight(char) {
  if (/\s/u.test(char)) return 0.3;
  if (isNarrow(char)) return 0.3;
  if (/[MW@%&]/u.test(char)) return 0.86;
  if (/[\u2e80-\u9fff\uac00-\ud7af]/u.test(char)) return 0.98;
  if (/[A-Z0-9]/u.test(char)) return 0.62;
  return 0.55;
}

export function wrapText(value, widthPx, fontSize) {
  const capacity = Math.max(1, widthPx / fontSize);
  const words = String(value ?? '').trim().split(/\s+/u).filter(Boolean).flatMap((word) => {
    const chunks = [];
    let chunk = '';
    let units = 0;
    for (const char of word) {
      const weight = glyphWeight(char);
      if (chunk && units + weight > capacity) {
        chunks.push(chunk);
        chunk = char;
        units = weight;
      } else {
        chunk += char;
        units += weight;
      }
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  });
  if (!words.length) return [''];
  const lines = [];
  let line = '';
  let units = 0;
  for (const word of words) {
    const wordUnits = [...word].reduce((sum, char) => sum + glyphWeight(char), 0);
    const candidateUnits = units + (line ? 0.3 : 0) + wordUnits;
    if (line && candidateUnits > capacity) { lines.push(line); line = word; units = wordUnits; }
    else { line = line ? `${line} ${word}` : word; units = candidateUnits; }
  }
  if (line) lines.push(line);
  return lines;
}

function fitDialogueText(value, layer, isVietnamese) {
  const preferredFontSize = Number(layer.fontSize || (isVietnamese ? 52 : 48));
  const minFontSize = Math.min(preferredFontSize, Math.max(30, Math.floor(preferredFontSize * 0.64)));
  const padding = Number(layer.padding || 40);
  const contentWidth = Math.max(1, Number(layer.width) - padding * 2);
  const maxHeight = Math.max(Number(layer.height || 0), 360);
  let layout;

  for (let fontSize = preferredFontSize; fontSize >= minFontSize; fontSize -= 1) {
    const lineHeight = fontSize + (isVietnamese ? 15 : 13);
    const lines = wrapText(value, contentWidth * 0.92, fontSize);
    const height = Math.max(Number(layer.height || 0), 116 + lines.length * lineHeight);
    layout = { lines, fontSize, lineHeight, height };
    if (height <= maxHeight) return layout;
  }
  return layout;
}

function highlightMarkup(line, phrase, highlightColor) {
  if (!phrase) return xml(line);
  const haystack = line.toLocaleLowerCase('vi');
  const needle = phrase.toLocaleLowerCase('vi');
  const at = haystack.indexOf(needle);
  if (at < 0) return xml(line);
  return `${xml(line.slice(0, at))}<tspan fill="${highlightColor}" font-weight="700">${xml(line.slice(at, at + phrase.length))}</tspan>${xml(line.slice(at + phrase.length))}`;
}

function textLines(lines, options = {}) {
  const { x, y, fontSize, lineHeight, color: fill, weight = 600, anchor = 'start', phrase, highlightColor, fontFamily = 'Be Vietnam Pro' } = options;
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color(fill, '#263244')}" font-family="${xml(fontFamily)}, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="${weight}" dominant-baseline="alphabetic">${lines.map((line, index) => `<tspan x="${x}" y="${y + index * lineHeight}">${highlightMarkup(line, phrase, highlightColor || '#D98B65')}</tspan>`).join('')}</text>`;
}

function layerGeometry(template, script, index) {
  const map = layerMap(template);
  const vi = map.get('vietnamese-card');
  const en = map.get('english-card');
  const vocab = map.get('vocabulary');
  const dialogue = script.dialogues?.[index] || { vietnamese: 'Hôm nay mình cùng luyện nói tiếng Anh nhé.', english: "Let's practice English together today.", term: 'practice English', meaningVi: 'luyện nói tiếng Anh' };
  const viLayout = fitDialogueText(dialogue.vietnamese, vi, true);
  const enLayout = fitDialogueText(dialogue.english, en, false);
  const termText = `${dialogue.term || ''} = ${dialogue.meaningVi || ''}`;
  const vocabLines = wrapText(termText, vocab.width - (vocab.padding || 28) * 2, Number(vocab.fontSize || 32));
  const viHeight = viLayout.height;
  const enHeight = Math.max(en.height, 110 + enLayout.lines.length * enLayout.lineHeight + 6);
  const enY = Math.max(en.y, vi.y + viHeight + 24);
  const vocabY = Math.max(vocab.y, enY + enHeight + 24);
  const vocabHeight = Math.max(vocab.height, 76 + vocabLines.length * (Number(vocab.fontSize || 32) + 10));
  return {
    dialogue,
    viLines: viLayout.lines,
    viFontSize: viLayout.fontSize,
    viLineHeight: viLayout.lineHeight,
    enLines: enLayout.lines,
    enFontSize: enLayout.fontSize,
    enLineHeight: enLayout.lineHeight,
    vocabLines,
    viHeight,
    enHeight,
    enY,
    vocabY,
    vocabHeight
  };
}

function shadowDef() {
  return '<filter id="softShadow" x="-20%" y="-20%" width="150%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="12"/><feOffset dy="10" result="offsetblur"/><feComponentTransfer><feFuncA type="linear" slope="0.18"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
}

async function imageHref(asset, embedAssets) {
  if (asset === 'brand-logo.png') await ensureLogoPng();
  const absolute = resolveBrandingAsset(asset);
  if (!fs.existsSync(absolute)) throw new Error(`Thiếu asset thương hiệu: ${asset}`);
  if (!embedAssets) return `/assets/branding/${asset.split(path.sep).join('/')}`;
  const ext = path.extname(absolute).toLowerCase();
  const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(absolute).toString('base64')}`;
}

function opacityFor(state, layerId) {
  if (state === 'transition' && ['scene-number', 'vietnamese-card', 'english-card', 'vocabulary'].includes(layerId)) return 0.28;
  return 1;
}

async function layerMarkup(layerId, context) {
  const { template, script, index, state, embedAssets, geometry } = context;
  const layer = getLayer(template, layerId);
  if (!layer || layer.visible === false) return '';
  const brand = template.brand;
  const opacity = Math.max(0, Math.min(1, Number(layer.opacity ?? 1) * opacityFor(state, layerId)));
  const pointerEvents = ['background'].includes(layerId) ? 'none' : ['facebook-logo', 'youtube-logo'].includes(layerId) ? 'all' : 'visiblePainted';
  const groupStart = `<g id="layer-${xml(layerId)}" data-layer-id="${xml(layerId)}" opacity="${opacity}" pointer-events="${pointerEvents}">`;
  if (layerId === 'background') {
    const href = await imageHref(layer.asset || 'background-main.png', embedAssets);
    return `${groupStart}<image x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" preserveAspectRatio="xMidYMid slice" href="${href}"/></g>`;
  }
  if (layerId === 'logo' || layerId === 'character') {
    const defaultAsset = layerId === 'logo' ? 'brand-logo.png' : 'teacher-female.png';
    const href = await imageHref(layer.asset || defaultAsset, embedAssets);
    const preserve = layerId === 'character' ? 'xMidYMax meet' : 'xMinYMid meet';
    return `${groupStart}<image x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" preserveAspectRatio="${preserve}" href="${href}"/></g>`;
  }
  if (layerId === 'facebook-logo') {
    const size = Math.min(layer.width, layer.height);
    return `${groupStart}<rect x="${layer.x - 6}" y="${layer.y - 6}" width="${layer.width + 12}" height="${layer.height + 12}" fill="transparent" pointer-events="all"/><rect x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" rx="${size * 0.12}" fill="#1877F2"/><text x="${layer.x + layer.width / 2}" y="${layer.y + layer.height * 0.82}" text-anchor="middle" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="${size * 0.86}" font-weight="700">f</text></g>`;
  }
  if (layerId === 'youtube-logo') {
    const radius = Math.min(layer.height * 0.22, layer.width * 0.18);
    return `${groupStart}<rect x="${layer.x - 6}" y="${layer.y - 6}" width="${layer.width + 12}" height="${layer.height + 12}" fill="transparent" pointer-events="all"/><rect x="${layer.x}" y="${layer.y + layer.height * 0.12}" width="${layer.width}" height="${layer.height * 0.76}" rx="${radius}" fill="#FF0033"/><path d="M${layer.x + layer.width * 0.43} ${layer.y + layer.height * 0.31} L${layer.x + layer.width * 0.43} ${layer.y + layer.height * 0.69} L${layer.x + layer.width * 0.69} ${layer.y + layer.height * 0.5} Z" fill="#FFFFFF"/></g>`;
  }
  if (layerId === 'title') {
    const title = String(script.title || script.topic || 'Ba câu giao tiếp hôm nay');
    const lines = wrapText(title, layer.width, Number(layer.fontSize || 34)).slice(0, 2);
    return `${groupStart}<text x="${layer.x}" y="${layer.y + Number(layer.fontSize || 34)}" fill="${color(layer.color, brand.primaryColor)}" font-family="${xml(brand.fontFamily || 'Be Vietnam Pro')}, Segoe UI, sans-serif" font-size="${layer.fontSize || 34}" font-weight="${layer.fontWeight || 700}" letter-spacing="-.3">${lines.map((line, i) => `<tspan x="${layer.x}" y="${layer.y + Number(layer.fontSize || 34) + i * 42}">${xml(line)}</tspan>`).join('')}</text></g>`;
  }
  if (layerId === 'scene-number') {
    const x = layer.x; const y = layer.y; const w = layer.width; const h = layer.height;
    return `${groupStart}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${layer.radius || 22}" fill="${color(layer.fill, '#E4F0EC')}" stroke="${color(layer.stroke, '#B9D3CD')}" stroke-width="3"/><text x="${x + w / 2}" y="${y + h / 2 + 9}" text-anchor="middle" fill="${color(layer.color, brand.primaryColor)}" font-family="Be Vietnam Pro, Segoe UI, sans-serif" font-size="${layer.fontSize || 27}" font-weight="700">${String(index + 1).padStart(2, '0')}  /  03</text></g>`;
  }
  if (layerId === 'vietnamese-card' || layerId === 'english-card') {
    const isVi = layerId === 'vietnamese-card';
    const x = layer.x; const y = isVi ? layer.y : geometry.enY; const w = layer.width; const h = isVi ? geometry.viHeight : geometry.enHeight;
    const lines = isVi ? geometry.viLines : geometry.enLines;
    const padding = Number(layer.padding || 40); const fontSize = isVi ? geometry.viFontSize : geometry.enFontSize; const lineHeight = isVi ? geometry.viLineHeight : geometry.enLineHeight;
    const fill = color(layer.fill, isVi ? '#E8E8E4' : '#E6F0EC');
    const accent = color(layer.accent, isVi ? brand.primaryColor : brand.secondaryColor);
    const label = isVi ? 'CÂU TIẾNG VIỆT' : 'SAY IT IN ENGLISH';
    const textMarkup = textLines(lines, { x: x + padding, y: y + 112, fontSize, lineHeight, color: color(layer.color, isVi ? brand.bodyColor : brand.primaryColor), weight: Number(layer.fontWeight || 700), phrase: isVi ? '' : geometry.dialogue.term, highlightColor: color(layer.highlightColor, brand.accentColor), fontFamily: brand.fontFamily });
    return `${groupStart}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${layer.radius || 28}" fill="${fill}" stroke="${color(layer.stroke, '#CFD9D6')}" stroke-width="2" filter="url(#softShadow)"/><rect x="${x + 8}" y="${y + 24}" width="10" height="${Math.max(1, h - 48)}" rx="5" fill="${accent}"/><text x="${x + padding}" y="${y + 44}" fill="${accent}" font-family="Be Vietnam Pro, Segoe UI, sans-serif" font-size="21" font-weight="700" letter-spacing="1.5">${label}</text>${textMarkup}</g>`;
  }
  if (layerId === 'vocabulary') {
    const x = layer.x; const y = geometry.vocabY; const h = geometry.vocabHeight;
    const w = Math.max(320, Math.min(layer.width, getLayer(template, 'character').x - layer.x - 38));
    const fontSize = Number(layer.fontSize || 32); const lines = wrapText(`${geometry.dialogue.term || ''}  =  ${geometry.dialogue.meaningVi || ''}`, w - Number(layer.padding || 28) * 2, fontSize);
    const textMarkup = textLines(lines, { x: x + Number(layer.padding || 28), y: y + 78, fontSize, lineHeight: fontSize + 10, color: color(layer.color, brand.secondaryColor), weight: Number(layer.fontWeight || 600), phrase: geometry.dialogue.term, highlightColor: brand.accentColor, fontFamily: brand.fontFamily });
    return `${groupStart}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${layer.radius || 26}" fill="${color(layer.fill, '#FFFFFF')}" stroke="${color(layer.stroke, '#C7DCD7')}" stroke-width="2" filter="url(#softShadow)"/><text x="${x + Number(layer.padding || 28)}" y="${y + 40}" fill="${brand.secondaryColor}" font-family="Be Vietnam Pro, Segoe UI, sans-serif" font-size="20" font-weight="700" letter-spacing="1.4">CỤM TỪ</text>${textMarkup}</g>`;
  }
  if (layerId === 'footer') {
    const x = layer.x; const y = layer.y + 30;
    const icon = brand.iconFile ? `<image x="${x - 2}" y="${y - 28}" width="30" height="30" preserveAspectRatio="xMidYMid meet" href="${await imageHref(brand.iconFile, embedAssets)}"/>` : '';
    const textX = x + (brand.iconFile ? 34 : 0);
    return `${groupStart}${icon}<text x="${textX}" y="${y}" fill="${color(layer.color, brand.primaryColor)}" font-family="${xml(brand.fontFamily)}, Segoe UI, sans-serif" font-size="${layer.fontSize || 24}" font-weight="${layer.fontWeight || 700}">${xml(layer.text?.trim() || brand.pageName)}</text></g>`;
  }
  if (layerId === 'cta') {
    const x = layer.x; const y = layer.y; const w = layer.width; const h = layer.height;
    const buttonWidth = Math.min(500, w);
    const buttonHeight = 118;
    const buttonX = x + (w - buttonWidth) / 2;
    return `${groupStart}<rect x="${buttonX}" y="${y}" width="${buttonWidth}" height="${buttonHeight}" rx="${layer.radius || 0}" fill="${color(layer.fill, brand.primaryColor)}" filter="url(#softShadow)"/><text x="${x + w / 2}" y="${y + 78}" text-anchor="middle" fill="${color(layer.color, '#FFFFFF')}" font-family="Be Vietnam Pro, Segoe UI, sans-serif" font-size="56" font-weight="700">FOLLOW</text><text x="${x + w / 2}" y="${y + 190}" text-anchor="middle" fill="#263244" font-family="Be Vietnam Pro, Segoe UI, sans-serif" font-size="40" font-weight="500">Follow kênh để luyện phản xạ</text><text x="${x + w / 2}" y="${y + 244}" text-anchor="middle" fill="#263244" font-family="Be Vietnam Pro, Segoe UI, sans-serif" font-size="40" font-weight="500">tiếng Anh mỗi ngày!</text></g>`;
  }
  return '';
}

export async function buildSceneSvg({ template = readVisualTemplate(), script, state = 'vietnamese', index = 0, embedAssets = false, includeBackground = true, forceLayer = null, includeLayers = null }) {
  if (!VALID_SCENES.has(state)) throw new Error(`Scene không hỗ trợ: ${state}`);
  const sceneScript = script || { title: 'Học tiếng Anh giao tiếp mỗi ngày', topic: 'Giao tiếp hằng ngày', dialogues: [] };
  const geometry = layerGeometry(template, sceneScript, index);
  const context = { template, script: sceneScript, state, index, embedAssets, geometry };
  const order = includeBackground ? ['background', 'character', 'logo', 'facebook-logo', 'youtube-logo', 'title', 'footer', 'scene-number', 'vietnamese-card', 'english-card', 'vocabulary', 'cta'] : ['character', 'logo', 'facebook-logo', 'youtube-logo', 'title', 'footer', 'scene-number', 'vietnamese-card', 'english-card', 'vocabulary', 'cta'];
  const activeLayers = forceLayer ? [forceLayer] : Array.isArray(includeLayers) ? order.filter((id) => includeLayers.includes(id)) : order.filter((id) => {
    if (id === 'background' || id === 'logo' || id === 'facebook-logo' || id === 'youtube-logo' || id === 'character' || id === 'footer') return true;
    if (id === 'title') return state === 'intro';
    if (id === 'scene-number' || id === 'vietnamese-card') return ['vietnamese', 'bilingual', 'vocabulary', 'transition'].includes(state);
    if (id === 'english-card') return ['bilingual', 'vocabulary', 'transition'].includes(state);
    if (id === 'vocabulary') return ['vocabulary', 'transition'].includes(state);
    if (id === 'cta') return state === 'cta';
    return false;
  });
  const width = template.canvas.width; const height = template.canvas.height;
  if (state === 'transition') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#000000"/></svg>`;
  }
  const groups = [];
  for (const id of activeLayers) {
    const markup = await layerMarkup(id, context);
    if (markup) groups.push(markup);
  }
  const selected = forceLayer ? groups[0] || '' : groups.join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${shadowDef()}</defs>${selected}</svg>`;
}

export async function rasterizeScene({ template = readVisualTemplate(), script, state = 'vietnamese', index = 0, outputPath, includeBackground = true, includeLayers = null }) {
  const svg = await buildSceneSvg({ template, script, state, index, embedAssets: true, includeBackground, includeLayers });
  const image = sharp(Buffer.from(svg)).png({ compressionLevel: 9 });
  if (outputPath) { fs.mkdirSync(path.dirname(outputPath), { recursive: true }); await image.toFile(outputPath); return outputPath; }
  return image.toBuffer();
}

export async function rasterizeLayer(layerId, { template = readVisualTemplate(), script, state = 'vietnamese', index = 0, outputPath }) {
  const svg = await buildSceneSvg({ template, script, state, index, embedAssets: true, includeBackground: false, forceLayer: layerId });
  const image = sharp(Buffer.from(svg)).png({ compressionLevel: 9 });
  if (outputPath) { fs.mkdirSync(path.dirname(outputPath), { recursive: true }); await image.toFile(outputPath); return outputPath; }
  return image.toBuffer();
}

export async function createContactSheet(imagePaths, outputPath) {
  const width = 810; const cellWidth = 270; const cellHeight = 480; const labelHeight = 36;
  const labels = ['Tiếng Việt', 'Việt + Anh', 'Từ vựng', 'Chuyển câu', 'CTA'];
  const composites = [];
  for (let index = 0; index < imagePaths.length; index++) {
    const left = (index % 3) * cellWidth;
    const top = Math.floor(index / 3) * (cellHeight + labelHeight);
    const resized = await sharp(imagePaths[index]).resize(cellWidth, cellHeight, { fit: 'cover' }).png().toBuffer();
    const labelSvg = Buffer.from(`<svg width="${cellWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#17395D"/><text x="14" y="25" fill="#fff" font-family="Be Vietnam Pro, sans-serif" font-size="17" font-weight="700">${xml(labels[index] || '')}</text></svg>`);
    const labelPng = await sharp(labelSvg).png().toBuffer();
    composites.push({ input: resized, left, top }, { input: labelPng, left, top: top + cellHeight });
  }
  const rows = Math.ceil(imagePaths.length / 3);
  return sharp({ create: { width, height: rows * (cellHeight + labelHeight), channels: 4, background: '#F6F0E5' } }).composite(composites).png({ compressionLevel: 9 }).toFile(outputPath);
}

export function getDesignPrompts() {
  const promptPath = path.join(BRANDING_DIR, 'prompts', 'branding-assets.md');
  return fs.readFileSync(promptPath, 'utf8');
}

export async function ensureLogoPng() {
  const svgPath = resolveBrandingAsset('brand-logo.svg');
  const pngPath = resolveBrandingAsset('brand-logo.png');
  if (!fs.existsSync(pngPath) || fs.statSync(pngPath).mtimeMs < fs.statSync(svgPath).mtimeMs) {
    await sharp(svgPath).png({ compressionLevel: 9 }).toFile(pngPath);
  }
  return pngPath;
}
