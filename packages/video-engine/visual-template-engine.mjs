import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PATHS, ROOT } from '../../src/config.mjs';
import { defaultDialogueSegmentId, normalizeLanguage, tokenizeText } from '../audio-highlight/highlight-engine.mjs';
import { normalizeBackgroundEffectSpeed, normalizeBackgroundEffectDensity, normalizeBackgroundEffectOpacity, renderBackgroundEffectMarkup } from './background-effects.mjs';

export const BRANDING_DIR = path.join(ROOT, 'assets', 'branding');
export const TEMPLATE_PATH = path.join(BRANDING_DIR, 'visual-template.json');
export const CHINESE_TEMPLATE_PATH = path.join(BRANDING_DIR, 'visual-template-zh.json');
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
const CHINESE_PRESENTATION_LAYOUTS = {
  'dialogue-cards': {
    inlineTarget: false,
    layers: {
      'vietnamese-card': { x: 69, y: 458, width: 941, height: 200, fontSize: 54, padding: 42, textAlign: 'center' },
      'chinese-card': { x: 69, y: 689, width: 941, height: 280, fontSize: 52, padding: 42, textAlign: 'center' },
      pinyin: { x: 80, y: 750, width: 918, height: 44, fontSize: 29, align: 'center' },
      vocabulary: { x: 79, y: 1024, width: 924, height: 190, fontSize: 28, padding: 30, visible: true }
    }
  },
  'numbered-scenario': {
    inlineTarget: false,
    layers: {
      'scene-number': { visible: true, x: 78, y: 408, width: 100, height: 54, fontSize: 23 },
      'vietnamese-card': { x: 79, y: 487, width: 924, height: 206, fontSize: 52, padding: 43 },
      'chinese-card': { x: 79, y: 792, width: 924, height: 210, fontSize: 50, padding: 43 },
      pinyin: { x: 95, y: 900, width: 892, height: 42, fontSize: 27, align: 'center' },
      vocabulary: { x: 79, y: 1024, width: 924, height: 152, fontSize: 28, padding: 30 },
      character: { x: 550, y: 1210, width: 488, height: 690 }
    }
  },
  'inline-meaning': {
    inlineTarget: true,
    layers: {
      'vietnamese-card': { x: 76, y: 378, width: 930, height: 190, fontSize: 52, padding: 42 },
      'chinese-card': { x: 76, y: 598, width: 930, height: 160, fontSize: 52, padding: 0, textAlign: 'start' },
      pinyin: { x: 76, y: 666, width: 930, height: 40, fontSize: 28, align: 'start' },
      vocabulary: { x: 76, y: 780, width: 900, height: 190, fontSize: 28, padding: 28 }
    }
  },
  'inline-keyphrase': {
    inlineTarget: true,
    layers: {
      'vietnamese-card': { x: 76, y: 378, width: 930, height: 190, fontSize: 52, padding: 42 },
      'chinese-card': { x: 76, y: 598, width: 930, height: 160, fontSize: 52, padding: 0, textAlign: 'start', highlightColor: '#C9933D' },
      pinyin: { x: 76, y: 666, width: 930, height: 40, fontSize: 28, align: 'start' },
      vocabulary: { x: 76, y: 780, width: 900, height: 190, fontSize: 28, padding: 28 }
    }
  }
};
const ENGLISH_PRESENTATION_LAYOUTS = {
  'dialogue-cards': {
    inlineTarget: false,
    layers: {
      'scene-number': { visible: false },
      'vietnamese-card': { x: 80, y: 475, width: 920, height: 210, fontSize: 51, padding: 42, textAlign: 'center', accentBar: false, fill: '#E1E1DE', stroke: '#C8C8C4' },
      'english-card': { x: 80, y: 735, width: 920, height: 230, fontSize: 48, padding: 42, textAlign: 'center', accentBar: false, fill: '#DEE4F0', stroke: '#BCC6D8', color: '#1D355A' },
      vocabulary: { visible: false }
    }
  },
  'numbered-scenario': {
    inlineTarget: false,
    layers: {
      'scene-number': { visible: true, x: 80, y: 410, width: 70, height: 48, fontSize: 22, fill: '#DDE2E9', stroke: '#C3CAD4', color: '#33445F' },
      'vietnamese-card': { x: 80, y: 480, width: 920, height: 210, fontSize: 50, padding: 42, fill: '#E1E1DE', stroke: '#C8C8C4', accent: '#193C74' },
      'english-card': { x: 80, y: 730, width: 920, height: 205, fontSize: 47, padding: 42, fill: '#DEE4F0', stroke: '#BCC6D8', color: '#1D355A', accent: '#193C74' },
      vocabulary: { x: 80, y: 1000, width: 920, height: 180, fontSize: 29, padding: 28, fill: '#E1E1DE', stroke: '#C8C8C4' }
    }
  },
  'inline-meaning': {
    inlineTarget: true,
    layers: {
      'scene-number': { visible: false },
      'vietnamese-card': { x: 80, y: 385, width: 920, height: 205, fontSize: 50, padding: 38, fill: '#E1E1DE', stroke: '#C8C8C4', accent: '#E2860B' },
      'english-card': { x: 80, y: 615, width: 920, height: 90, fontSize: 46, padding: 0, textAlign: 'start' },
      vocabulary: { x: 80, y: 790, width: 920, height: 180, fontSize: 27, padding: 24, color: '#263244', fill: '#DEDEDC', stroke: '#C3C3C0' }
    }
  },
  'inline-keyphrase': {
    inlineTarget: true,
    layers: {
      'scene-number': { visible: false },
      'vietnamese-card': { x: 80, y: 385, width: 920, height: 205, fontSize: 50, padding: 38, fill: '#E1E1DE', stroke: '#C8C8C4', accent: '#E2860B' },
      'english-card': { x: 80, y: 615, width: 920, height: 90, fontSize: 46, padding: 0, textAlign: 'start' },
      vocabulary: { x: 80, y: 790, width: 920, height: 180, fontSize: 27, padding: 24, color: '#263244', fill: '#DEDEDC', stroke: '#C3C3C0' }
    }
  }
};
const ENGLISH_PHRASE_COLORS = { orange: '#E78300', blue: '#55A9EC' };

function chinesePresentationStyle(script) {
  const requested = String(script?.presentationStyle || script?.dialogues?.[0]?.presentationStyle || 'inline-meaning');
  return CHINESE_PRESENTATION_LAYOUTS[requested] ? requested : 'inline-meaning';
}

function englishPresentationStyle(script) {
  const requested = String(script?.presentationStyle || script?.dialogues?.[0]?.presentationStyle || 'legacy');
  return ENGLISH_PRESENTATION_LAYOUTS[requested] ? requested : null;
}

function presentationLayer(template, script, layerId) {
  const layer = getLayer(template, layerId);
  if (!layer) return layer;
  const style = script?.contentLanguage === 'zh'
    ? CHINESE_PRESENTATION_LAYOUTS[chinesePresentationStyle(script)]
    : script?.contentLanguage === 'en'
      ? ENGLISH_PRESENTATION_LAYOUTS[englishPresentationStyle(script)]
      : null;
  return style ? { ...layer, ...(style.layers[layerId] || {}) } : layer;
}

export function makeDefaultChineseTemplate() {
  const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  template.templateId = 'branded-dialogue-zh-v1';
  template.name = 'Vietnamese–Chinese Pinyin V1';
  template.brand = {
    ...template.brand,
    pageName: 'Cô Nơ Tiếng Trung',
    tagline: 'Tiếng Trung Chậm Mà Chắc · Luyện phản xạ giao tiếp mỗi ngày',
    primaryColor: '#8F241B',
    secondaryColor: '#70523A',
    accentColor: '#C9933D',
    bodyColor: '#332820',
    backgroundColor: '#FBF3E5',
    softGray: '#EFE2CE'
  };
  template.layers = template.layers.map((layer) => {
    if (layer.id === 'background') return { ...layer, asset: 'background-chinese-page.png' };
    if (layer.id === 'logo') return { ...layer, asset: 'brand-logo-chinese.png', x: 465, y: 20, width: 150, height: 150 };
    if (layer.id === 'title') return { ...layer, color: '#8F241B' };
    if (layer.id === 'scene-number') return { ...layer, color: '#8F241B', fill: '#F6E8C9', stroke: '#D9B76E' };
    if (layer.id === 'vietnamese-card') return {
      ...layer, x: 76, y: 378, width: 930, height: 190, fontSize: 52, padding: 42,
      color: '#332820', fill: '#FFF9EF', stroke: '#E5D5BB', accent: '#8F241B',
      shadow: { ...layer.shadow, color: '#6C4029' }
    };
    if (layer.id === 'vocabulary') return {
      ...layer, x: 76, y: 780, width: 900, height: 190, fontSize: 28, padding: 28,
      color: '#8F241B', fill: '#FFF9EF', stroke: '#D9B76E',
      shadow: { ...layer.shadow, color: '#6C4029' }
    };
    if (layer.id === 'cta') return { ...layer, fill: '#8F241B', accent: '#C9933D', shadow: { ...layer.shadow, color: '#6C4029' } };
    if (layer.id === 'english-card') return {
      ...layer, id: 'chinese-card', label: 'Câu tiếng Trung', kind: 'card',
      x: 76, y: 598, width: 930, height: 160, fontSize: 52, padding: 0,
      color: '#76231C', highlightColor: '#B67927', fill: '#F9EFDF', stroke: '#D8B96F', accent: '#9B3023',
      shadow: { ...layer.shadow, color: '#6C4029' }
    };
    if (layer.id === 'footer') return { ...layer, text: 'Cô Nơ Tiếng Trung', color: '#8F241B' };
    return { ...layer };
  });
  template.layers.splice(1, 0,
    {
      id: 'chinese-plum-blossom', label: 'Nhánh hoa đào', kind: 'image', visible: true,
      asset: 'chinese-plum-blossom.png', x: 40, y: 60, width: 460, height: 440, opacity: 0.9
    },
    {
      id: 'chinese-bamboo', label: 'Bụi tre', kind: 'image', visible: true,
      asset: 'chinese-bamboo.png', x: 520, y: 0, width: 560, height: 580, opacity: 0.9
    }
  );
  const targetIndex = template.layers.findIndex((layer) => layer.id === 'chinese-card');
  template.layers.splice(targetIndex + 1, 0, {
    id: 'pinyin', label: 'Pinyin', kind: 'text', visible: true, text: '',
    x: 76, y: 666, width: 930, height: 40, fontSize: 28, fontWeight: 500,
    color: '#287D7B', lineHeight: 36, align: 'center', fontFamily: 'Be Vietnam Pro', appearanceEffect: 'fade'
  });
  return validateVisualTemplate(template);
}

export function readVisualTemplate({ contentLanguage = 'en' } = {}) {
  const isChinese = contentLanguage === 'zh';
  const template = isChinese
    ? fs.existsSync(CHINESE_TEMPLATE_PATH) ? JSON.parse(fs.readFileSync(CHINESE_TEMPLATE_PATH, 'utf8')) : makeDefaultChineseTemplate()
    : JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  return validateVisualTemplate(template);
}

export function validateVisualTemplate(input) {
  if (!input || typeof input !== 'object' || input.version !== TEMPLATE_VERSION || typeof input.templateId !== 'string' || !input.templateId.trim()) {
    throw new Error('Template cần có ID và dùng phiên bản scene hiện hành.');
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
  const brandedTemplate = input.templateId === 'branded-dialogue-v2';
  if (!Array.isArray(input.layers) || input.layers.length < 1 || input.layers.length > 64) throw new Error('Template cần có từ 1 đến 64 layer.');
  const seen = new Set();
  const layers = input.layers.map((layer) => {
    const validId = typeof layer?.id === 'string' && /^[\w-]{1,80}$/u.test(layer.id);
    if (!validId || (brandedTemplate && !REQUIRED_LAYER_IDS.includes(layer.id)) || seen.has(layer.id)) throw new Error('Template có layer ID không hợp lệ hoặc bị trùng.');
    seen.add(layer.id);
    const clean = { ...layer };
    if (clean.kind === 'image' && (typeof clean.asset !== 'string' || !clean.asset.trim())) throw new Error(`Layer ảnh ${layer.id} cần có asset.`);
    for (const key of ['x', 'y', 'width', 'height']) {
      const value = Number(clean[key]);
      if (!Number.isFinite(value) || value < 0 || value > 2400 || ((key === 'width' || key === 'height') && value < 1)) throw new Error(`Tọa độ ${layer.id}.${key} không hợp lệ.`);
      clean[key] = Math.round(value);
    }
    if (clean.x + clean.width > 2160 || clean.y + clean.height > 3000) throw new Error(`Layer ${layer.id} vượt giới hạn scene.`);
    if (clean.visible !== undefined && typeof clean.visible !== 'boolean') throw new Error(`Cờ hiển thị ${layer.id} không hợp lệ.`);
    if (clean.fontFamily !== undefined && (typeof clean.fontFamily !== 'string' || clean.fontFamily.length > 120)) throw new Error(`Font chữ ${layer.id} không hợp lệ.`);
    if (clean.id === 'footer' && clean.text !== undefined && (typeof clean.text !== 'string' || clean.text.length > 160)) throw new Error('Nội dung Footer tối đa 160 ký tự.');
    if (clean.fontSize !== undefined && (!Number.isFinite(Number(clean.fontSize)) || Number(clean.fontSize) < 12 || Number(clean.fontSize) > 140)) throw new Error(`Cỡ chữ ${layer.id} phải trong khoảng 12–140.`);
    for (const key of ['color', 'fill', 'stroke', 'accent', 'highlightColor']) {
      if (clean[key] !== undefined && !COLOR_PATTERN.test(clean[key])) throw new Error(`Màu ${layer.id}.${key} không hợp lệ.`);
    }
    if (clean.asset) resolveBrandingAsset(clean.asset);
    return clean;
  });
  const ids = new Set(layers.map((layer) => layer.id));
  if (brandedTemplate && (input.layers.length !== REQUIRED_LAYER_IDS.length || REQUIRED_LAYER_IDS.some((id) => !ids.has(id)))) throw new Error('Template Branded Dialogue V2 cần đủ 12 layer chuẩn.');
  if (!brandedTemplate && !layers.some((layer) => layer.kind === 'text' && layer.id !== 'title')) throw new Error('Template tổng quát cần một layer kind="text" dành cho nội dung để gắn lời đọc và highlight.');
  const timing = { intro: 0, vocabularyHold: 1.5, transition: 0.3, transitionFade: 0.25, cta: 2.2, fade: 0.25, ...input.timing };
  if (timing.transitionFade === undefined) timing.transitionFade = timing.fade;
  for (const key of ['intro', 'vocabularyHold', 'transition', 'transitionFade', 'cta', 'fade']) {
    const value = Number(timing[key]);
    if (!Number.isFinite(value) || value < 0 || value > 8) throw new Error(`Thời gian ${key} phải trong khoảng 0–8 giây.`);
    timing[key] = value;
  }
  return { ...input, timing, layers };
}

export function saveVisualTemplate(input, { contentLanguage = 'en' } = {}) {
  const template = validateVisualTemplate(input);
  const targetPath = contentLanguage === 'zh' ? CHINESE_TEMPLATE_PATH : TEMPLATE_PATH;
  const tempPath = `${targetPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, targetPath);
  return template;
}

export function resetChineseVisualTemplate() {
  const template = makeDefaultChineseTemplate();
  const tempPath = `${CHINESE_TEMPLATE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, CHINESE_TEMPLATE_PATH);
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

function fitChineseDialogueText(value, layer, isVietnamese, inlineTarget = false) {
  const preferredFontSize = Number(layer.fontSize || (isVietnamese ? 52 : 48));
  const minFontSize = Math.min(preferredFontSize, Math.max(30, Math.floor(preferredFontSize * 0.64)));
  const padding = inlineTarget ? 0 : Number(layer.padding || 40);
  const contentWidth = Math.max(1, Number(layer.width) - padding * 2);
  const fixedHeight = Math.max(1, Number(layer.height || 160));
  let layout;
  for (let fontSize = preferredFontSize; fontSize >= minFontSize; fontSize -= 1) {
    const lineHeight = fontSize + (isVietnamese ? 15 : 13);
    const lines = wrapText(value, contentWidth * 0.96, fontSize);
    const textHeight = Math.max(fontSize, lines.length * lineHeight);
    const height = Math.max(fixedHeight, textHeight + (inlineTarget ? 0 : 64));
    layout = { lines, fontSize, lineHeight, height, textHeight };
    if (height <= fixedHeight) return layout;
  }
  return layout;
}

function layoutWordLines(value, widthPx, fontSize, segmentId, language = 'und') {
  const text = String(value ?? '').trim();
  const tokens = tokenizeText(text, segmentId, language);
  const cjk = ['ja', 'zh'].includes(normalizeLanguage(language)) && /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  const tokenByStart = new Map(tokens.map((token) => [token.start, token]));
  const capacity = Math.max(1, widthPx / fontSize);
  const lines = [{ fragments: [], units: 0 }];
  let tokenIndex = 0;

  const newLine = () => lines.push({ fragments: [], units: 0 });
  const items = cjk
    ? tokens.map((token, index) => ({ 0: `${index === 0 ? text.slice(0, token.start) : ''}${text.slice(token.start, tokens[index + 1]?.start ?? text.length)}`, token }))
    : [...text.matchAll(/\S+/gu)].map((match) => ({ 0: match[0], token: tokenByStart.get(match.index) || null }));
  for (const match of items) {
    const word = match[0];
    const token = match.token;
    const tokenId = token?.id || null;
    if (token) tokenIndex += 1;
    const units = [...word].reduce((sum, char) => sum + glyphWeight(char), 0);
    let line = lines.at(-1);
    if (line.fragments.length && line.units + 0.3 + units > capacity) {
      newLine();
      line = lines.at(-1);
    }
    if (!line.fragments.length && units > capacity) {
      let chunk = '';
      let chunkUnits = 0;
      for (const char of word) {
        const weight = glyphWeight(char);
        if (chunk && chunkUnits + weight > capacity) {
          line.fragments.push({ text: chunk, tokenId });
          line.units += chunkUnits;
          newLine();
          line = lines.at(-1);
          chunk = '';
          chunkUnits = 0;
        }
        chunk += char;
        chunkUnits += weight;
      }
      if (chunk) {
        line.fragments.push({ text: chunk, tokenId });
        line.units += chunkUnits;
      }
      continue;
    }
    if (line.fragments.length && !cjk) {
      line.fragments.push({ text: ' ', tokenId: null });
      line.units += 0.3;
    }
    line.fragments.push({ text: word, tokenId });
    line.units += units;
  }

  if (!tokenIndex && !text) return { segmentId, lines: [{ fragments: [{ text: '', tokenId: null }] }] };
  return { segmentId, lines: lines.map(({ fragments }) => ({ fragments })) };
}

const wordMetricsCache = new Map();
const WORD_METRICS_CACHE_LIMIT = 256;

function rememberWordMetrics(key, value) {
  wordMetricsCache.delete(key);
  wordMetricsCache.set(key, value);
  if (wordMetricsCache.size > WORD_METRICS_CACHE_LIMIT) {
    wordMetricsCache.delete(wordMetricsCache.keys().next().value);
  }
  return value;
}

function tokenFragmentMarkup(fragment, activeIds, fill = null) {
  if (!fragment.tokenId) return xml(fragment.text);
  const attributes = [`data-token-id="${xml(fragment.tokenId)}"`];
  const active = activeIds.has(fragment.tokenId);
  if (fill) attributes.push(`fill="${fill}"`);
  else if (active) attributes.push('fill="#FFFFFF"');
  if (active) attributes.push('font-weight="700"');
  return `<tspan ${attributes.join(' ')}>${xml(fragment.text)}</tspan>`;
}

async function measureWordBoxes(layout, { fontSize, lineHeight, weight, fontFamily }) {
  const cacheKey = JSON.stringify({
    lines: layout.lines.map((line) => line.fragments.map(({ text, tokenId }) => [text, tokenId])),
    fontSize, lineHeight, weight, fontFamily
  });
  const cached = wordMetricsCache.get(cacheKey);
  if (cached) {
    wordMetricsCache.delete(cacheKey);
    wordMetricsCache.set(cacheKey, cached);
    return cached;
  }

  // Give each token its own transparent raster row. One visible mask per row
  // avoids color-tag bleed between adjacent glyphs in the old shared raster.
  const rows = [];
  for (const [lineIndex, line] of layout.lines.entries()) {
    const tokenIds = [...new Set(line.fragments.map((fragment) => fragment.tokenId).filter(Boolean))];
    for (const tokenId of tokenIds) rows.push({ lineIndex, tokenId, line });
  }
  if (!rows.length) return rememberWordMetrics(cacheKey, layout.lines.map(() => []));

  const marginX = 8;
  const baselineOffset = Math.ceil(fontSize * 1.5);
  const rowPitch = Math.ceil(Math.max(fontSize * 2.4, lineHeight + fontSize * 0.7));
  const maxChars = Math.max(1, ...layout.lines.map((line) => [...line.fragments.map((fragment) => fragment.text).join('')].length));
  const width = Math.ceil(marginX * 2 + maxChars * fontSize * 1.5);
  const height = Math.ceil(baselineOffset + rows.length * rowPitch);
  const linesMarkup = rows.map(({ line, tokenId }, rowIndex) => {
    const fragments = line.fragments.map((fragment) => {
      if (!fragment.tokenId) return xml(fragment.text);
      const selected = fragment.tokenId === tokenId;
      return `<tspan fill="${selected ? '#FFFFFF' : 'none'}"${selected ? ' font-weight="700"' : ''}>${xml(fragment.text)}</tspan>`;
    }).join('');
    return `<tspan x="${marginX}" y="${baselineOffset + rowIndex * rowPitch}">${fragments}</tspan>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><text fill="#FFFFFF" font-family="${xml(fontFamily)}, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="${weight}" dominant-baseline="alphabetic">${linesMarkup}</text></svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = rows.map(() => ({ minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 }));
  for (let pixel = 0; pixel < data.length; pixel += info.channels) {
    if (data[pixel + 3] === 0) continue;
    const x = (pixel / info.channels) % info.width;
    const y = Math.floor(pixel / info.channels / info.width);
    const rowIndex = Math.round((y - baselineOffset) / rowPitch);
    if (rowIndex < 0 || rowIndex >= rows.length) continue;
    const entry = bounds[rowIndex];
    entry.minX = Math.min(entry.minX, x);
    entry.minY = Math.min(entry.minY, y);
    entry.maxX = Math.max(entry.maxX, x);
    entry.maxY = Math.max(entry.maxY, y);
  }

  const measured = layout.lines.map(() => []);
  for (const [rowIndex, entry] of bounds.entries()) {
    const row = rows[rowIndex];
    if (entry.maxX >= entry.minX && entry.maxY >= entry.minY) {
      measured[row.lineIndex].push({
        tokenId: row.tokenId,
        x: entry.minX - marginX,
        y: entry.minY - (baselineOffset + rowIndex * rowPitch) + row.lineIndex * lineHeight,
        width: entry.maxX - entry.minX + 1,
        height: entry.maxY - entry.minY + 1
      });
      continue;
    }
    throw new Error(`Could not measure exact glyph bounds for ${row.tokenId} on line ${row.lineIndex + 1}; stop rendering to avoid misplaced highlights.`);
  }
  return rememberWordMetrics(cacheKey, measured);
}

async function dialogueTextMarkup(layout, { x, y, fontSize, lineHeight, color: fill, weight = 700, fontFamily = 'Be Vietnam Pro', highlight, highlightSettings, anchor = 'start', staticHighlightTokenIds = null, staticHighlightColor = null, staticHighlightColorByTokenId = null, staticHighlightActive = false }) {
  const activeIds = new Set(highlightSettings?.highlightEnabled === false || highlight?.segmentId !== layout.segmentId ? [] : highlight.tokenIds || []);
  const staticIds = staticHighlightTokenIds instanceof Set ? staticHighlightTokenIds : new Set(staticHighlightTokenIds || []);
  const staticColors = staticHighlightColorByTokenId instanceof Map ? staticHighlightColorByTokenId : new Map();
  const settings = highlightSettings || {};
  const padding = Math.max(0, Math.min(24, Number(settings.highlightPadding ?? 6)));
  const radius = Math.max(0, Math.min(32, Number(settings.highlightRadius ?? 8)));
  const highlightColor = color(settings.highlightColor, '#FF8066');
  const boxesFor = (lines, tokenIds) => {
    const ids = new Set(tokenIds || []);
    return lines.flatMap((boxes, lineIndex) => boxes
      .filter((box) => ids.has(box.tokenId))
      .map((box) => ({ ...box, lineIndex })));
  };
  const selectedMetrics = activeIds.size ? await measureWordBoxes(layout, { fontSize, lineHeight, weight, fontFamily }) : [];
  const selectedBoxes = boxesFor(selectedMetrics, activeIds);
  const lineWidths = selectedMetrics.map((boxes) => boxes.reduce((width, box) => Math.max(width, box.x + box.width), 0));
  const rects = selectedBoxes.map((box) => {
    const lineBoxes = selectedMetrics[box.lineIndex] || [];
    const anchorOffset = anchor === 'center' ? Number(lineWidths[box.lineIndex] || 0) / 2 : 0;
    const previous = lineBoxes
      .filter((candidate) => !activeIds.has(candidate.tokenId) && candidate.x + candidate.width <= box.x)
      .sort((left, right) => right.x - left.x)[0];
    const next = lineBoxes
      .filter((candidate) => !activeIds.has(candidate.tokenId) && candidate.x >= box.x + box.width)
      .sort((left, right) => left.x - right.x)[0];
    const leftGap = previous ? box.x - (previous.x + previous.width) : Infinity;
    const rightGap = next ? next.x - (box.x + box.width) : Infinity;
    const padLeft = Math.min(padding, Number.isFinite(leftGap) ? Math.max(0, leftGap / 2 - 0.5) : padding);
    const padRight = Math.min(padding, Number.isFinite(rightGap) ? Math.max(0, rightGap / 2 - 0.5) : padding);
    return `<rect x="${x + box.x - anchorOffset - padLeft}" y="${y + box.y - padding}" width="${Math.max(1, box.width + padLeft + padRight)}" height="${box.height + padding * 2}" rx="${radius}" fill="${highlightColor}"/>`;
  }).join('');
  const anchorAttribute = anchor === 'center' ? ' text-anchor="middle"' : '';
  const text = `<text x="${x}" y="${y}"${anchorAttribute} fill="${color(fill, '#263244')}" font-family="${xml(fontFamily)}, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="${weight}" dominant-baseline="alphabetic">${layout.lines.map((line, index) => `<tspan x="${x}" y="${y + index * lineHeight}">${line.fragments.map((fragment) => {
    const phraseColor = staticColors.get(fragment.tokenId) || staticHighlightColor;
    const useStaticColor = staticIds.has(fragment.tokenId) && phraseColor && (!staticHighlightActive || !activeIds.has(fragment.tokenId));
    return tokenFragmentMarkup(fragment, activeIds, useStaticColor ? phraseColor : null);
  }).join('')}</tspan>`).join('')}</text>`;
  return `${rects}${text}`;
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

function layerGeometry(template, script, index, speechSegment = null) {
  const map = layerMap(template);
  const contentLanguage = script.contentLanguage === 'ja' || script.contentLanguage === 'zh' ? script.contentLanguage : 'en';
  const styleName = contentLanguage === 'zh' ? chinesePresentationStyle(script) : contentLanguage === 'en' ? englishPresentationStyle(script) : null;
  const style = styleName
    ? contentLanguage === 'zh' ? CHINESE_PRESENTATION_LAYOUTS[styleName] : ENGLISH_PRESENTATION_LAYOUTS[styleName]
    : null;
  const hasPresentationLayout = contentLanguage === 'zh' || Boolean(style);
  const vi = (hasPresentationLayout ? presentationLayer(template, script, 'vietnamese-card') : map.get('vietnamese-card')) || { x: 0, y: 0, width: 920, height: 202, fontSize: 53, padding: 43 };
  const en = (contentLanguage === 'zh' ? presentationLayer(template, script, 'chinese-card') : style ? presentationLayer(template, script, 'english-card') : null) || map.get('english-card') || { x: 0, y: 0, width: 920, height: 220, fontSize: 49, padding: 42 };
  const vocab = (hasPresentationLayout ? presentationLayer(template, script, 'vocabulary') : map.get('vocabulary')) || { x: 0, y: 0, width: 800, height: 190, fontSize: 25, padding: 28 };
  const dialogue = { ...(script.dialogues?.[index] || { vietnamese: 'Hôm nay mình cùng luyện nói tiếng Anh nhé.', english: "Let's practice English together today.", term: 'practice English', meaningVi: 'luyện nói tiếng Anh' }) };
  const targetField = contentLanguage === 'ja' ? 'japanese' : contentLanguage === 'zh' ? 'chinese' : 'english';
  if (targetField !== 'english') dialogue.english = dialogue[targetField] || '';
  if (contentLanguage === 'en' && speechSegment?.target?.layerId === 'vocabulary' && Array.isArray(dialogue.vocabularyCards)) {
    const vocabularyIndex = Number(speechSegment.target?.vocabularyIndex);
    const vocabularyCard = Number.isInteger(vocabularyIndex) ? dialogue.vocabularyCards[vocabularyIndex] : null;
    if (vocabularyCard) {
      dialogue.term = vocabularyCard.term || '';
      dialogue.meaningVi = vocabularyCard.meaningVi || '';
    }
  }
  if (speechSegment && Number(speechSegment.target?.dialogueIndex) === index) {
    if (speechSegment.target.layerId === 'vietnamese-card') dialogue.vietnamese = speechSegment.text;
    if (speechSegment.target.layerId === 'english-card' || speechSegment.target.layerId === 'chinese-card') dialogue.english = speechSegment.text;
  }
  const viTarget = speechSegment?.target?.layerId === 'vietnamese-card' && Number(speechSegment.target?.dialogueIndex) === index;
  const enTarget = ['english-card', 'chinese-card'].includes(speechSegment?.target?.layerId) && Number(speechSegment.target?.dialogueIndex) === index;
  const viSegmentId = viTarget ? speechSegment.segmentId : defaultDialogueSegmentId(index, 'vi', dialogue);
  const enSegmentId = enTarget ? speechSegment.segmentId : defaultDialogueSegmentId(index, contentLanguage, dialogue);
  const inlineTarget = Boolean(style?.inlineTarget);
  const viLayout = contentLanguage === 'zh' ? fitChineseDialogueText(dialogue.vietnamese, vi, true) : fitDialogueText(dialogue.vietnamese, vi, true);
  const enLayout = contentLanguage === 'zh' ? fitChineseDialogueText(dialogue.english, en, false, inlineTarget) : fitDialogueText(dialogue.english, en, false);
  const viText = layoutWordLines(dialogue.vietnamese, (Number(vi.width) - Number(vi.padding || 40) * 2) * (contentLanguage === 'zh' ? 0.96 : 0.92), viLayout.fontSize, viSegmentId, contentLanguage === 'en' ? 'en' : 'vi');
  const enTextWidth = inlineTarget ? Number(en.width) * 0.96 : (Number(en.width) - Number(en.padding || 40) * 2) * (contentLanguage === 'zh' ? 0.96 : 0.92);
  const enText = layoutWordLines(dialogue.english, enTextWidth, enLayout.fontSize, enSegmentId, contentLanguage);
  const termText = `${dialogue.term || ''} = ${dialogue.meaningVi || ''}`;
  const vocabularyPadding = Number(vocab.padding || 28);
  const vocabularyInnerWidth = Math.max(1, Number(vocab.width) - Number(vocab.padding || (contentLanguage === 'zh' ? 28 : 24)) * 2);
  const vocabLines = wrapText(termText, vocabularyInnerWidth * (contentLanguage === 'zh' ? 0.94 : 1), Number(vocab.fontSize || 32));
  const chineseVocabularyCardLayout = contentLanguage === 'zh'
    ? (() => {
      const termFontSize = Number(vocab.fontSize || 28);
      const termLineHeight = termFontSize + 10;
      const explanationFontSize = 22;
      const explanationLineHeight = 30;
      const termBaselineOffset = 78;
      let nextBaselineOffset = termBaselineOffset + vocabLines.length * termLineHeight + 6;
      const explanationBlocks = [dialogue.noteVi, dialogue.grammarNote]
        .map((text) => String(text || '').trim())
        .filter(Boolean)
        .map((text) => {
          const block = {
            text,
            lines: wrapText(text, vocabularyInnerWidth * 0.94, explanationFontSize),
            baselineOffset: nextBaselineOffset
          };
          nextBaselineOffset += block.lines.length * explanationLineHeight + 8;
          return block;
        });
      return {
        termLines: vocabLines,
        termFontSize,
        termLineHeight,
        termBaselineOffset,
        explanationBlocks,
        explanationFontSize,
        explanationLineHeight,
        labelBaselineOffset: 42,
        height: Math.max(Number(vocab.height || 0), nextBaselineOffset + 24)
      };
    })()
    : null;
  const viHeight = viLayout.height;
  const enHeight = contentLanguage === 'zh'
    ? Math.max(en.height, enLayout.textHeight + (inlineTarget ? 0 : 64 + 40))
    : contentLanguage === 'en' && inlineTarget
      ? enLayout.lines.length * enLayout.lineHeight + 4
    : Math.max(en.height, 110 + enLayout.lines.length * enLayout.lineHeight + 6);
  const enY = Math.max(en.y, vi.y + viHeight + (contentLanguage === 'zh' ? 30 : 24));
  const vocabGap = contentLanguage === 'zh' ? (inlineTarget ? 48 : 22) : 24;
  const vocabY = Math.max(vocab.y, enY + enHeight + vocabGap);
  const inlineVocabularyStyle = contentLanguage === 'en' && ['inline-meaning', 'inline-keyphrase'].includes(styleName);
  const vocabularyCardLayouts = inlineVocabularyStyle
    ? (Array.isArray(dialogue.vocabularyCards) ? dialogue.vocabularyCards : []).map((card, cardIndex) => {
      const sourceFontSize = 26;
      const termFontSize = 27;
      const explanationFontSize = 22;
      const sourceLineHeight = 30;
      const termLineHeight = 31;
      const explanationLineHeight = 25;
      const sourceLines = wrapText(card.sourceVi || '', vocabularyInnerWidth, sourceFontSize);
      const termLines = wrapText(card.term || '', vocabularyInnerWidth, termFontSize);
      const explanationLines = wrapText(card.meaningVi || '', vocabularyInnerWidth, explanationFontSize);
      const sourceBaselineOffset = 16 + sourceFontSize;
      const arrowBaselineOffset = sourceBaselineOffset + (sourceLines.length - 1) * sourceLineHeight + 22;
      const termBaselineOffset = arrowBaselineOffset + 13 + termFontSize;
      const explanationBaselineOffset = termBaselineOffset + Math.max(termFontSize, termLines.length * termLineHeight) + 5 + explanationFontSize;
      const height = explanationBaselineOffset + Math.max(0, explanationLines.length - 1) * explanationLineHeight + 16;
      return {
        sourceVi: card.sourceVi || '', term: card.term || '', meaningVi: card.meaningVi || '', cardIndex,
        sourceLines, termLines, explanationLines,
        sourceFontSize, termFontSize, explanationFontSize,
        sourceLineHeight, termLineHeight, explanationLineHeight,
        sourceBaselineOffset, arrowBaselineOffset, termBaselineOffset, explanationBaselineOffset,
        height
      };
    })
    : [];
  const activeVocabularyIndex = Number(speechSegment?.target?.vocabularyIndex);
  const visibleVocabularyCount = inlineVocabularyStyle && Number.isInteger(activeVocabularyIndex)
    ? Math.min(vocabularyCardLayouts.length, Math.max(0, activeVocabularyIndex) + 1)
    : vocabularyCardLayouts.length;
  let vocabularyCardY = vocabY;
  for (const card of vocabularyCardLayouts) {
    card.y = vocabularyCardY;
    vocabularyCardY += card.height + 14;
  }
  const scenarioMeaningLines = contentLanguage === 'en' && styleName === 'numbered-scenario'
    ? wrapText(dialogue.meaningVi || '', vocabularyInnerWidth, 22)
    : [];
  const scenarioVocabularyHeight = scenarioMeaningLines.length ? 24 + 27 + 8 + scenarioMeaningLines.length * 25 + 18 : 120;
  const vocabHeight = contentLanguage === 'zh'
    ? chineseVocabularyCardLayout.height
    : inlineVocabularyStyle
      ? Math.max(Number(vocab.height || 0), vocabularyCardLayouts.reduce((sum, card, index) => sum + card.height + (index ? 14 : 0), 0))
      : contentLanguage === 'en' && styleName === 'numbered-scenario'
        ? Math.max(Number(vocab.height || 0), scenarioVocabularyHeight)
        : Math.max(vocab.height, 76 + vocabLines.length * (Number(vocab.fontSize || 32) + 10));
  const pinyinLayer = contentLanguage === 'zh' ? presentationLayer(template, script, 'pinyin') : null;
  const pinyinFontSize = Number(pinyinLayer?.fontSize || 28);
  const cardTextHeight = Math.max(enLayout.fontSize, enLayout.lines.length * enLayout.lineHeight);
  const cardTextTop = enY + (enHeight - cardTextHeight - (inlineTarget ? 0 : pinyinFontSize + 32)) / 2;
  const chineseTextFirstBaseline = inlineTarget
    ? enY + enLayout.fontSize + (contentLanguage === 'zh' ? 0 : 12)
    : cardTextTop + enLayout.fontSize;
  const chineseTextLastBaseline = chineseTextFirstBaseline + Math.max(0, enLayout.lines.length - 1) * enLayout.lineHeight;
  const pinyinBaseline = contentLanguage === 'zh'
    ? chineseTextLastBaseline + pinyinFontSize + (inlineTarget ? 12 : 18)
    : null;
  const staticHighlightTokenIds = new Set();
  const staticHighlightColorByTokenId = new Map();
  const staticHighlightColor = contentLanguage === 'en' && ['inline-meaning', 'inline-keyphrase', 'numbered-scenario'].includes(styleName)
    ? ENGLISH_PHRASE_COLORS.blue
    : null;
  if (contentLanguage === 'en' && ['inline-meaning', 'inline-keyphrase', 'numbered-scenario'].includes(styleName)) {
    const keyphrases = styleName === 'numbered-scenario'
      ? [String(dialogue.term || '').trim()].filter(Boolean)
      : Array.isArray(dialogue.vocabularyCards)
        ? dialogue.vocabularyCards.map((card) => String(card?.term || '').trim()).filter(Boolean)
        : [String(dialogue.term || '').trim()].filter(Boolean);
    const englishText = String(dialogue.english || '');
    const lowerEnglish = englishText.toLocaleLowerCase('en-US');
    const tokens = tokenizeText(englishText, enSegmentId, 'en');
    for (const [phraseIndex, keyphrase] of keyphrases.entries()) {
      const phraseColor = styleName === 'inline-keyphrase' && phraseIndex === 0
        ? ENGLISH_PHRASE_COLORS.orange
        : ENGLISH_PHRASE_COLORS.blue;
      const lowerKeyphrase = keyphrase.toLocaleLowerCase('en-US');
      let phraseStart = lowerEnglish.indexOf(lowerKeyphrase);
      while (phraseStart >= 0) {
        const phraseEnd = phraseStart + lowerKeyphrase.length;
        const previousCharacter = Array.from(englishText.slice(0, phraseStart)).at(-1) || '';
        const nextCharacter = Array.from(englishText.slice(phraseEnd))[0] || '';
        const hasWordBoundary = (!previousCharacter || !/[\p{L}\p{N}]/u.test(previousCharacter))
          && (!nextCharacter || !/[\p{L}\p{N}]/u.test(nextCharacter));
        if (hasWordBoundary) {
          for (const token of tokens) {
            if (token.start < phraseEnd && token.end > phraseStart) {
              staticHighlightTokenIds.add(token.id);
              if (!staticHighlightColorByTokenId.has(token.id)) staticHighlightColorByTokenId.set(token.id, phraseColor);
            }
          }
        }
        phraseStart = lowerEnglish.indexOf(lowerKeyphrase, phraseStart + lowerKeyphrase.length);
      }
    }
  }
  return {
    dialogue,
    styleName,
    inlineTarget,
    viText,
    viFontSize: viLayout.fontSize,
    viLineHeight: viLayout.lineHeight,
    viHeight,
    viY: vi.y,
    viTextBaseline: vi.y + (viHeight - Math.max(viLayout.fontSize, viLayout.lines.length * viLayout.lineHeight)) / 2 + viLayout.fontSize,
    enText,
    enFontSize: enLayout.fontSize,
    enLineHeight: enLayout.lineHeight,
    enX: inlineTarget ? en.x : en.x + Number(en.padding || 40),
    enTextFirstBaseline: chineseTextFirstBaseline,
    pinyinBaseline,
    pinyinFontSize,
    staticHighlightTokenIds,
    staticHighlightColor,
    staticHighlightColorByTokenId,
    vocabLines,
    chineseVocabularyCardLayout,
    enHeight,
    enY,
    vocabY,
    vocabHeight,
    vocabularyCardLayouts,
    visibleVocabularyCount,
    scenarioMeaningLines,
    scenarioVocabularyHeight
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
  const { template, script, index, state, embedAssets, geometry, highlight, highlightSettings, speechSegment, totalCount } = context;
  const layer = presentationLayer(template, script, layerId);
  if (!layer || layer.visible === false) return '';
  const brand = template.brand;
  const contentLanguage = script.contentLanguage === 'ja' || script.contentLanguage === 'zh' ? script.contentLanguage : 'en';
  const inlineChinese = contentLanguage === 'zh' && Boolean(geometry.inlineTarget);
  const faintChineseLead = inlineChinese && layerId === 'chinese-card' && state === 'vietnamese'
    && speechSegment?.target?.layerId === 'vietnamese-card';
  const opacity = Math.max(0, Math.min(1, Number(layer.opacity ?? 1) * opacityFor(state, layerId) * (faintChineseLead ? 0.3 : 1)));
  const pointerEvents = ['background'].includes(layerId) ? 'none' : ['facebook-logo', 'youtube-logo'].includes(layerId) ? 'all' : 'visiblePainted';
  const groupStart = `<g id="layer-${xml(layerId)}" data-layer-id="${xml(layerId)}" opacity="${opacity}" pointer-events="${pointerEvents}">`;
  if (layerId === 'pinyin') {
    const activeChineseSegment = speechSegment?.target?.layerId === 'chinese-card' ? speechSegment : null;
    if (activeChineseSegment && activeChineseSegment.target?.pinyinVisible === false) return '';
    const dialogue = script.dialogues?.[index] || {};
    const pinyin = String(activeChineseSegment?.target?.pinyin || dialogue.pinyin || '');
    if (!pinyin.trim()) return '';
    const fontSize = Number(layer.fontSize || 28);
    const appearanceEffect = String(layer.appearanceEffect || 'none');
    const progress = Math.max(0, Math.min(1, Number(context.pinyinEffectProgress ?? 1)));
    const opacityValue = appearanceEffect === 'none' ? 1 : progress;
    const translateY = appearanceEffect === 'rise' ? 10 * (1 - progress) : 0;
    const scale = appearanceEffect === 'pop' ? 0.84 + 0.16 * progress : 1;
    const baseline = Number(geometry.pinyinBaseline || Number(layer.y) + fontSize);
    const centerX = Number(layer.x) + Number(layer.width) / 2;
    const transform = `translate(${centerX} ${baseline}) scale(${scale}) translate(${-centerX} ${-baseline + translateY})`;
    const textAnchor = layer.align === 'start' ? 'start' : 'middle';
    const textX = layer.align === 'start' ? Number(layer.x) : centerX;
    return `${groupStart}<text x="${textX}" y="${baseline}" text-anchor="${textAnchor}" opacity="${opacityValue}" fill="${color(layer.color, '#287D7B')}" font-family="${xml(layer.fontFamily || brand.fontFamily || 'Be Vietnam Pro')}, Microsoft YaHei, sans-serif" font-size="${fontSize}" font-weight="${Number(layer.fontWeight || 500)}" transform="${transform}" data-appearance="${xml(appearanceEffect)}">${xml(pinyin)}</text></g>`;
  }
  if (layer.kind === 'text' && layerId !== 'title') {
    const activeSpeech = speechSegment?.target?.layerId === layerId ? speechSegment : null;
    const text = String(activeSpeech?.text ?? layer.text ?? script.textLayers?.[layerId] ?? '');
    if (!text.trim()) return '';
    const fontSize = Number(layer.fontSize || 48);
    const segmentId = activeSpeech?.segmentId || `text-${layerId}`;
    const layout = layoutWordLines(text, Math.max(1, Number(layer.width)), fontSize, segmentId, contentLanguage);
    const markup = await dialogueTextMarkup(layout, {
      x: Number(layer.x), y: Number(layer.y) + fontSize, fontSize, lineHeight: Number(layer.lineHeight || fontSize * 1.25),
      color: color(layer.color, brand.bodyColor), weight: Number(layer.fontWeight || 700), fontFamily: brand.fontFamily,
      highlight, highlightSettings
    });
    return `${groupStart}${markup}</g>`;
  }
  if (layer.kind === 'image' && !['background', 'character'].includes(layerId)) {
    const href = await imageHref(layer.asset, embedAssets);
    return `${groupStart}<image x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" preserveAspectRatio="xMidYMid meet" href="${href}"/></g>`;
  }
  if (layerId === 'background') {
    const href = await imageHref(layer.asset || 'background-main.png', embedAssets);
    return `${groupStart}<image x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" preserveAspectRatio="xMidYMid slice" href="${href}"/></g>`;
  }
  if (layerId === 'logo' || layerId === 'character') {
    const defaultAsset = layerId === 'logo' ? 'brand-logo.png' : 'teacher-female.png';
    const href = await imageHref(layer.asset || defaultAsset, embedAssets);
    const preserve = layerId === 'character' ? 'xMidYMax meet' : 'xMinYMid meet';
    const image = `<image x="${layer.x}" y="${layer.y}" width="${layer.width}" height="${layer.height}" preserveAspectRatio="${preserve}" href="${href}"/>`;
    if (layerId === 'logo' && contentLanguage === 'zh') {
      if (brand.logoLayout === 'left-lockup') {
        const textX = Number(layer.x) + Number(layer.width) + 18;
        const titleY = Number(layer.y) + 37;
        const taglineY = Number(layer.y) + 67;
        const fontFamily = `${xml(brand.fontFamily || 'Be Vietnam Pro')}, Microsoft YaHei, sans-serif`;
        return groupStart + image
          + '<text x="' + textX + '" y="' + titleY + '" text-anchor="start" fill="' + color(brand.primaryColor, '#8F241B') + '" font-family="' + fontFamily + '" font-size="29" font-weight="700">' + xml(brand.pageName) + '</text>'
          + '<text x="' + textX + '" y="' + taglineY + '" text-anchor="start" fill="' + color(brand.secondaryColor, '#70523A') + '" font-family="' + fontFamily + '" font-size="17" font-weight="500">' + xml(brand.tagline) + '</text></g>';
      }
      const centerX = template.canvas.width / 2;
      const titleY = Number(layer.y) + Number(layer.height) + 36;
      const taglineY = titleY + 36;
      const fontFamily = `${xml(brand.fontFamily || 'Be Vietnam Pro')}, Microsoft YaHei, sans-serif`;
      return `${groupStart}${image}<text x="${centerX}" y="${titleY}" text-anchor="middle" fill="${color(brand.primaryColor, '#8F241B')}" font-family="${fontFamily}" font-size="42" font-weight="700">${xml(brand.pageName)}</text><text x="${centerX}" y="${taglineY}" text-anchor="middle" fill="${color(brand.secondaryColor, '#70523A')}" font-family="${fontFamily}" font-size="21" font-weight="500">${xml(brand.tagline)}</text></g>`;
    }
    return `${groupStart}${image}</g>`;
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
    const label = contentLanguage === 'en' && geometry.styleName === 'numbered-scenario'
      ? String(index + 1)
      : `${String(index + 1).padStart(2, '0')}  /  ${String(totalCount || 1).padStart(2, '0')}`;
    return `${groupStart}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${layer.radius || 22}" fill="${color(layer.fill, '#E4F0EC')}" stroke="${color(layer.stroke, '#B9D3CD')}" stroke-width="3"/><text x="${x + w / 2}" y="${y + h / 2 + 9}" text-anchor="middle" fill="${color(layer.color, brand.primaryColor)}" font-family="Be Vietnam Pro, Segoe UI, sans-serif" font-size="${layer.fontSize || 27}" font-weight="700">${xml(label)}</text></g>`;
  }
  if (layerId === 'vietnamese-card' || layerId === 'english-card' || layerId === 'chinese-card') {
    const isVi = layerId === 'vietnamese-card';
    const isChineseCard = layerId === 'chinese-card';
    const x = layer.x; const y = isVi ? layer.y : geometry.enY; const w = layer.width; const h = isVi ? geometry.viHeight : geometry.enHeight;
    const textLayout = isVi ? geometry.viText : geometry.enText;
    const padding = Number(layer.padding || 40); const fontSize = isVi ? geometry.viFontSize : geometry.enFontSize; const lineHeight = isVi ? geometry.viLineHeight : geometry.enLineHeight;
    const fill = color(layer.fill, isVi ? '#E8E8E4' : '#E6F0EC');
    const accent = color(layer.accent, isVi ? brand.primaryColor : brand.secondaryColor);
    const targetLanguage = contentLanguage === 'ja' ? 'JAPANESE' : contentLanguage === 'zh' ? 'CHINESE' : 'ENGLISH';
    let label = isVi ? 'CÂU TIẾNG VIỆT' : isChineseCard ? 'CÂU TIẾNG TRUNG' : `SAY IT IN ${targetLanguage}`;
    if (contentLanguage === 'en' && geometry.styleName) label = '';
    if (contentLanguage === 'zh' && brand.sampleStyle === true) label = '';
    const fallbackFonts = contentLanguage === 'ja' ? ', Yu Gothic UI, Meiryo' : contentLanguage === 'zh' ? ', Microsoft YaHei' : '';
    const dialogueFontFamily = contentLanguage === 'en' ? brand.fontFamily : `${brand.fontFamily || 'Be Vietnam Pro'}${fallbackFonts}`;
    const defaultSegmentId = isVi ? defaultDialogueSegmentId(index, 'vi', geometry.dialogue) : defaultDialogueSegmentId(index, contentLanguage, geometry.dialogue);
    const centered = contentLanguage === 'zh' && layer.textAlign === 'center'
      || contentLanguage === 'en' && geometry.styleName === 'dialogue-cards';
    const isInlineTarget = Boolean(geometry.inlineTarget
      && (isChineseCard && contentLanguage === 'zh' || !isVi && !isChineseCard && contentLanguage === 'en'));
    const textX = isInlineTarget ? Number(geometry.enX) : centered ? x + w / 2 : x + padding;
    const textY = contentLanguage === 'zh'
      ? isVi ? geometry.viTextBaseline : geometry.enTextFirstBaseline
      : isInlineTarget ? geometry.enTextFirstBaseline
        : contentLanguage === 'en' && geometry.styleName ? isVi ? geometry.viTextBaseline : geometry.enTextFirstBaseline
          : y + 112;
    const textMarkup = await dialogueTextMarkup(textLayout, {
      x: textX, y: textY, fontSize, lineHeight,
      color: color(layer.color, isVi ? brand.bodyColor : brand.primaryColor),
      weight: Number(layer.fontWeight || 700), fontFamily: dialogueFontFamily,
      highlight: highlight || (highlightSettings?.highlightEnabled ? null : { segmentId: defaultSegmentId, tokenIds: [] }),
      highlightSettings,
      anchor: centered ? 'center' : 'start',
      staticHighlightTokenIds: isChineseCard && contentLanguage === 'zh'
        || contentLanguage === 'en' && ['inline-meaning', 'inline-keyphrase', 'numbered-scenario'].includes(geometry.styleName)
        ? geometry.staticHighlightTokenIds
        : null,
      staticHighlightColor: contentLanguage === 'en' && geometry.styleName === 'inline-keyphrase'
        ? geometry.staticHighlightColor
        : isChineseCard && contentLanguage === 'zh' ? geometry.staticHighlightColor : null,
      staticHighlightColorByTokenId: contentLanguage === 'en' ? geometry.staticHighlightColorByTokenId : null,
      staticHighlightActive: contentLanguage === 'en' && ['inline-meaning', 'inline-keyphrase', 'numbered-scenario'].includes(geometry.styleName)
    });
    if (isInlineTarget) return `${groupStart}${textMarkup}</g>`;
    const accentRail = layer.accentBar === false ? '' : `<rect x="${x + 8}" y="${y + 24}" width="10" height="${Math.max(1, h - 48)}" rx="5" fill="${accent}"/>`;
    const cardLabel = label ? `<text x="${centered ? x + w / 2 : x + padding}" y="${y + 44}"${centered ? ' text-anchor="middle"' : ''} fill="${accent}" font-family="Be Vietnam Pro, Segoe UI, sans-serif" font-size="21" font-weight="700" letter-spacing="1.5">${label}</text>` : '';
    return `${groupStart}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${layer.radius || 28}" fill="${fill}" stroke="${color(layer.stroke, '#CFD9D6')}" stroke-width="2" filter="url(#softShadow)"/>${accentRail}${cardLabel}${textMarkup}</g>`;
  }
  if (layerId === 'vocabulary') {
    const x = layer.x; const y = geometry.vocabY; const h = geometry.vocabHeight;
    const character = presentationLayer(template, script, 'character');
    const rightEdge = contentLanguage === 'zh' || (contentLanguage === 'en' && geometry.styleName)
      ? template.canvas.width - 32
      : character ? character.x : template.canvas.width - 32;
    const w = Math.max(1, Math.min(layer.width, rightEdge - layer.x - 38));
    if (contentLanguage === 'zh') {
      const padding = Number(layer.padding || 28);
      const textX = x + padding;
      const layout = geometry.chineseVocabularyCardLayout;
      const termMarkup = textLines(layout.termLines, {
        x: textX, y: y + layout.termBaselineOffset, fontSize: layout.termFontSize,
        lineHeight: layout.termLineHeight, color: color(layer.color, brand.secondaryColor), weight: Number(layer.fontWeight || 700), fontFamily: brand.fontFamily
      });
      const explanationMarkup = layout.explanationBlocks.map((block) => textLines(block.lines, {
        x: textX, y: y + block.baselineOffset, fontSize: layout.explanationFontSize,
        lineHeight: layout.explanationLineHeight, color: '#565C62', weight: 400, fontFamily: brand.fontFamily
      })).join('');
      return `${groupStart}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${layer.radius || 26}" fill="${color(layer.fill, '#FFFFFF')}" stroke="${color(layer.stroke, '#C7DCD7')}" stroke-width="2" filter="url(#softShadow)"/><text x="${textX}" y="${y + layout.labelBaselineOffset}" fill="${color(brand.secondaryColor, '#70523A')}" font-family="Be Vietnam Pro, Segoe UI, sans-serif" font-size="20" font-weight="700" letter-spacing="1.4">CỤM TỪ</text>${termMarkup}${explanationMarkup}</g>`;
    }
    if (contentLanguage === 'en' && ['inline-meaning', 'inline-keyphrase'].includes(geometry.styleName)) {
      const padding = Number(layer.padding || 24);
      const textX = x + padding;
      const cards = geometry.vocabularyCardLayouts.slice(0, geometry.visibleVocabularyCount);
      const markup = cards.map((card) => {
        const cardIndex = card.cardIndex;
        const cardY = card.y;
        const termColor = geometry.styleName === 'inline-keyphrase' && cardIndex === 0
          ? ENGLISH_PHRASE_COLORS.orange
          : ENGLISH_PHRASE_COLORS.blue;
        const sourceMarkup = textLines(card.sourceLines, {
          x: textX, y: cardY + card.sourceBaselineOffset, fontSize: card.sourceFontSize,
          lineHeight: card.sourceLineHeight, color: color(layer.color, brand.bodyColor), weight: 500, fontFamily: brand.fontFamily
        });
        const arrowMarkup = textLines(['→'], {
          x: textX, y: cardY + card.arrowBaselineOffset, fontSize: 22, lineHeight: 24,
          color: '#73777A', weight: 500, fontFamily: brand.fontFamily
        });
        const termMarkup = textLines(card.termLines, {
          x: textX, y: cardY + card.termBaselineOffset, fontSize: card.termFontSize,
          lineHeight: card.termLineHeight, color: termColor, weight: 600, fontFamily: brand.fontFamily
        });
        const explanationMarkup = textLines(card.explanationLines, {
          x: textX, y: cardY + card.explanationBaselineOffset, fontSize: card.explanationFontSize,
          lineHeight: card.explanationLineHeight, color: '#565C62', weight: 400, fontFamily: brand.fontFamily
        });
        return `<g data-vocabulary-card="${cardIndex}"><rect x="${x}" y="${cardY}" width="${w}" height="${card.height}" rx="${layer.radius || 22}" fill="${color(layer.fill, '#DEDEDC')}" stroke="${color(layer.stroke, '#C3C3C0')}" stroke-width="2" filter="url(#softShadow)"/>${sourceMarkup}${arrowMarkup}${termMarkup}${explanationMarkup}</g>`;
      }).join('');
      return `${groupStart}${markup}</g>`;
    }
    if (contentLanguage === 'en' && geometry.styleName === 'numbered-scenario') {
      const padding = Number(layer.padding || 28);
      const textX = x + padding;
      const meaningLines = geometry.scenarioMeaningLines;
      const termLines = wrapText(geometry.dialogue.term || '', w - padding * 2, 27);
      const termMarkup = textLines(termLines, {
        x: textX, y: y + 50, fontSize: 27, lineHeight: 31,
        color: ENGLISH_PHRASE_COLORS.blue, weight: 600, fontFamily: brand.fontFamily
      });
      const meaningMarkup = textLines(meaningLines, {
        x: textX, y: y + 82, fontSize: 22, lineHeight: 25,
        color: '#565C62', weight: 400, fontFamily: brand.fontFamily
      });
      return `${groupStart}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${layer.radius || 22}" fill="${color(layer.fill, '#E1E1DE')}" stroke="${color(layer.stroke, '#C8C8C4')}" stroke-width="2" filter="url(#softShadow)"/>${termMarkup}${meaningMarkup}</g>`;
    }
    const fontSize = Number(layer.fontSize || 32); const lines = wrapText(`${geometry.dialogue.term || ''}  =  ${geometry.dialogue.meaningVi || ''}`, w - Number(layer.padding || 28) * 2, fontSize);
    const textMarkup = textLines(lines, { x: x + Number(layer.padding || 28), y: y + 78, fontSize, lineHeight: fontSize + 10, color: color(layer.color, brand.secondaryColor), weight: Number(layer.fontWeight || 600), phrase: contentLanguage === 'zh' ? '' : geometry.dialogue.term, highlightColor: brand.accentColor, fontFamily: brand.fontFamily });
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
    const practiceLanguage = script.contentLanguage === 'ja' ? 'tiếng Nhật' : script.contentLanguage === 'zh' ? 'tiếng Trung' : 'tiếng Anh';
    const ctaTitle = script.contentLanguage === 'zh' ? 'THEO DÕI' : 'FOLLOW';
    const ctaLine = script.contentLanguage === 'zh' ? `Theo dõi ${brand.pageName || 'Cô Nói Tiếng Trung'}` : 'Follow kênh để luyện phản xạ';
    return `${groupStart}<rect x="${buttonX}" y="${y}" width="${buttonWidth}" height="${buttonHeight}" rx="${layer.radius || 0}" fill="${color(layer.fill, brand.primaryColor)}" filter="url(#softShadow)"/><text x="${x + w / 2}" y="${y + 78}" text-anchor="middle" fill="${color(layer.color, '#FFFFFF')}" font-family="Be Vietnam Pro, Segoe UI, sans-serif" font-size="56" font-weight="700">${ctaTitle}</text><text x="${x + w / 2}" y="${y + 190}" text-anchor="middle" fill="#263244" font-family="Be Vietnam Pro, Segoe UI, sans-serif" font-size="40" font-weight="500">${xml(ctaLine)}</text><text x="${x + w / 2}" y="${y + 244}" text-anchor="middle" fill="#263244" font-family="Be Vietnam Pro, Segoe UI, sans-serif" font-size="40" font-weight="500">${xml(practiceLanguage)} mỗi ngày!</text></g>`;
  }
  return '';
}

export async function buildSceneSvg({ template = readVisualTemplate(), script, state = 'vietnamese', index = 0, embedAssets = false, includeBackground = true, forceLayer = null, includeLayers = null, highlight = null, highlightSettings = null, speechSegment = null, totalCount = null, backgroundEffect = 'none', backgroundEffectDensity = 28, backgroundEffectSpeed = 58, backgroundEffectOpacity = 32, effectTime = 0, effectSeed = 'preview', pinyinEffectProgress = 1, chineseTextEffectProgress = 1 }) {
  if (!VALID_SCENES.has(state)) throw new Error(`Scene không hỗ trợ: ${state}`);
  const sceneScript = script || { title: 'Học tiếng Anh giao tiếp mỗi ngày', topic: 'Giao tiếp hằng ngày', dialogues: [] };
  const geometry = layerGeometry(template, sceneScript, index, speechSegment);
  const context = { template, script: sceneScript, state, index, embedAssets, geometry, highlight, highlightSettings, speechSegment, totalCount: totalCount || sceneScript.dialogues?.length || 3, pinyinEffectProgress, chineseTextEffectProgress };
  const contentCardId = sceneScript.contentLanguage === 'zh' && getLayer(template, 'chinese-card') ? 'chinese-card' : 'english-card';
  const fixedOrder = ['background', 'chinese-plum-blossom', 'chinese-bamboo', 'character', 'logo', 'facebook-logo', 'youtube-logo', 'title', 'footer', 'scene-number', 'vietnamese-card', contentCardId, ...(contentCardId === 'chinese-card' ? ['pinyin'] : []), 'vocabulary', 'cta'];
  const extras = template.layers.map((layer) => layer.id).filter((id) => !fixedOrder.includes(id));
  const order = [...(includeBackground ? fixedOrder : fixedOrder.filter((id) => id !== 'background')), ...extras];
  const activeLayers = forceLayer ? [forceLayer] : Array.isArray(includeLayers) ? order.filter((id) => includeLayers.includes(id)) : order.filter((id) => {
    if (id === 'background' || id === 'logo' || id === 'facebook-logo' || id === 'youtube-logo' || id === 'character' || id === 'footer') return true;
    if (['chinese-plum-blossom', 'chinese-bamboo'].includes(id)) return sceneScript.contentLanguage === 'zh' && Boolean(getLayer(template, id));
    if (id === 'title') return state === 'intro';
    if (id === 'scene-number' || id === 'vietnamese-card') return ['vietnamese', 'bilingual', 'vocabulary', 'transition'].includes(state);
    if (id === 'english-card') return ['bilingual', 'vocabulary', 'transition'].includes(state);
    if (id === 'chinese-card') return ['bilingual', 'vocabulary', 'transition'].includes(state);
    if (id === 'pinyin') return ['bilingual', 'vocabulary'].includes(state)
      && (speechSegment?.target?.layerId !== 'chinese-card' || speechSegment.target?.pinyinVisible !== false);
    if (id === 'vocabulary') {
      const dialogue = sceneScript.dialogues?.[index] || {};
      const hasChinesePhrase = sceneScript.contentLanguage !== 'zh'
        || Boolean(String(dialogue.term || '').trim() && String(dialogue.meaningVi || '').trim());
      return hasChinesePhrase && ['vocabulary', 'transition'].includes(state);
    }
    if (id === 'cta') return sceneScript.contentLanguage !== 'zh' && state === 'cta';
    if (getLayer(template, id)?.kind === 'text') return ['vietnamese', 'bilingual', 'vocabulary'].includes(state);
    return false;
  });
  const width = template.canvas.width; const height = template.canvas.height;
  const groups = [];
  for (const id of activeLayers) {
    const markup = await layerMarkup(id, context);
    if (markup) groups.push({ id, markup });
  }
  if (!forceLayer && includeBackground && backgroundEffect !== 'none') {
    const effect = renderBackgroundEffectMarkup(backgroundEffect, { width, height, time: effectTime, seed: effectSeed, density: backgroundEffectDensity, speed: backgroundEffectSpeed, opacity: backgroundEffectOpacity, contentLanguage: sceneScript.contentLanguage || 'en' });
    if (effect) {
      const backgroundIndex = groups.findIndex((group) => group.id === 'background');
      groups.splice(backgroundIndex < 0 ? 0 : backgroundIndex + 1, 0, { id: 'background-effect', markup: effect });
    }
  }
  const selected = forceLayer ? groups[0]?.markup || '' : groups.map((group) => group.markup).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${shadowDef()}</defs>${selected}</svg>`;
}

export async function rasterizeScene({ template = readVisualTemplate(), script, state = 'vietnamese', index = 0, outputPath, includeBackground = true, includeLayers = null, highlight = null, highlightSettings = null, speechSegment = null, totalCount = null, backgroundEffect = 'none', backgroundEffectDensity = 28, backgroundEffectSpeed = 58, backgroundEffectOpacity = 32, effectTime = 0, effectSeed = 'preview', pinyinEffectProgress = 1, chineseTextEffectProgress = 1 }) {
  const svg = await buildSceneSvg({ template, script, state, index, embedAssets: true, includeBackground, includeLayers, highlight, highlightSettings, speechSegment, totalCount, backgroundEffect, backgroundEffectDensity: normalizeBackgroundEffectDensity(backgroundEffectDensity), backgroundEffectSpeed: normalizeBackgroundEffectSpeed(backgroundEffectSpeed), backgroundEffectOpacity: normalizeBackgroundEffectOpacity(backgroundEffectOpacity), effectTime, effectSeed, pinyinEffectProgress, chineseTextEffectProgress });
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
