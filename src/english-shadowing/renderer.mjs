import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { PATHS, FFMPEG_BIN, FFPROBE_BIN, ROOT } from '../config.mjs';
import { renderSourceDesignSvg } from './source-font-renderer.mjs';
import { buildHighlightIntervals } from '../../packages/audio-highlight/highlight-engine.mjs';
import { renderBackgroundEffectMarkup } from '../../packages/video-engine/background-effects.mjs';
import { ENGLISH_SHADOWING_PROFILE } from './profile.mjs';
import { ENGLISH_SHADOWING_DEFAULT_SETTINGS } from './settings.mjs';
import { ENGLISH_SHADOWING_VISUAL_DESIGN_DEFAULTS, normalizeEnglishShadowingVisualDesign } from './visual-design.mjs';
import { buildSourceContentSvg, buildSourceThumbnailSvg } from './source-design-renderer.mjs';
import { planEnglishShadowingPace, scaleEnglishShadowingWordTimings } from './timing.mjs';
import { ENGLISH_SHADOWING_NARRATION_VERSION, getEnglishShadowingDeliveryProfile, resolveEnglishShadowingDeliveryStyle, usesEnglishShadowingSpokenFlow } from './delivery.mjs';
import {
  FIRST_ENGLISH_SHADOWING_BACKGROUND_THEME_ID,
  getEnglishShadowingBackgroundTheme
} from './background-themes.mjs';

const WIDTH = ENGLISH_SHADOWING_PROFILE.canvas.width;
const HEIGHT = ENGLISH_SHADOWING_PROFILE.canvas.height;
const FPS = ENGLISH_SHADOWING_PROFILE.canvas.fps;
const SPOKEN_FLOW_BODY_MAX_WIDTH = 850;
const LEGACY_PALETTE = Object.freeze({
  paper: '#EEF4F1',
  navy: '#285D78',
  burgundy: '#E5794F',
  gold: '#72B9A8',
  muted: '#63756E',
  brandEasy: '#168A78',
  brandEnglish: '#4761B5',
  brandShadowing: '#EB784E'
});

function resolveRenderPalette(backgroundThemeId) {
  const theme = getEnglishShadowingBackgroundTheme(backgroundThemeId);
  if (!theme) return { theme: null, ...LEGACY_PALETTE };
  return {
    theme,
    backgroundText: '#FFF5EA',
    activeText: '#FFFFFF',
    muted: '#C0CCCD',
    gold: theme.accent,
    burgundy: '#FF795F',
    brandEasy: '#39C7B5',
    brandEnglish: '#FFF5EA',
    brandShadowing: '#FF795F'
  };
}
const shadowingWordMetricsCache = new Map();

function xml(value) {
  return String(value || '').replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function run(binary, args, { timeoutMs = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-12_000); });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-24_000); });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(`${path.basename(binary)} thoát với mã ${code}: ${stderr.trim().slice(-1800)}`));
    });
  });
}

export async function getEnglishShadowingMediaDuration(filePath) {
  const result = await run(FFPROBE_BIN, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath], { timeoutMs: 30_000 });
  const duration = Number(result.stdout);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('EnglishShadowing: FFprobe không đọc được thời lượng giọng đọc.');
  return duration;
}

function estimateTextWidth(text, fontSize) {
  let units = 0;
  for (const character of String(text || '')) {
    if (/\s/u.test(character)) units += 0.29;
    else if (/[ilI.,'`:;!|]/u.test(character)) units += 0.28;
    else if (/[mwMW@%&]/u.test(character)) units += 0.82;
    else if (/[A-Z0-9]/u.test(character)) units += 0.62;
    else units += 0.52;
  }
  return units * fontSize;
}

function wrapTokens(tokens, maxWidth = 760, fontSize = 54, maxWords = 7) {
  const lines = [];
  let line = [];
  let width = 0;
  for (const token of tokens) {
    const text = String(token.text || '');
    const nextWidth = width + (line.length ? estimateTextWidth(' ', fontSize) : 0) + estimateTextWidth(text, fontSize);
    if (line.length && (line.length >= maxWords || nextWidth > maxWidth)) {
      lines.push(line);
      line = [];
      width = 0;
    }
    line.push(token);
    width += (line.length > 1 ? estimateTextWidth(' ', fontSize) : 0) + estimateTextWidth(text, fontSize);
  }
  if (line.length) lines.push(line);
  return lines;
}

function chooseLessonTextLayout(tokens, options = {}) {
  const maxWidth = options.maxWidth || 800;
  const maxHeight = options.maxHeight || 930;
  const requestedFontSize = Number(options.fontSize);
  let fontSize = requestedFontSize || (tokens.length > 76 ? 52 : tokens.length > 64 ? 56 : tokens.length > 54 ? 58 : 60);
  const lineHeightRatio = Number(options.lineHeightRatio) || 1.34;
  const minimumFontSize = requestedFontSize ? 38 : 43;
  let lines = [];
  let lineHeight = 0;
  while (fontSize >= minimumFontSize) {
    lines = wrapTokens(tokens, maxWidth, fontSize, 7);
    lineHeight = Math.round(fontSize * lineHeightRatio);
    const height = lines.length * lineHeight;
    if (height <= maxHeight) break;
    fontSize -= 1;
  }
  return {
    lines,
    fontSize,
    lineHeight,
    centerX: Number(options.centerX) || 540,
    centerY: Number(options.centerY) || 1000
  };
}

function spokenFlowFontSize(wordCount) {
  return wordCount > 74 ? 54 : wordCount > 64 ? 56 : 58;
}

function resolveSpokenFlowVisualDesign(value, script) {
  const design = normalizeEnglishShadowingVisualDesign(value);
  if (!design.enabled || !usesEnglishShadowingSpokenFlow(script)) return design;
  const content = { ...design.content };
  const defaults = ENGLISH_SHADOWING_VISUAL_DESIGN_DEFAULTS.content;
  const wordCount = String(script?.scriptText || '').match(/\S+/gu)?.length || 0;
  const bodyFontSize = spokenFlowFontSize(wordCount);
  let automaticVerticalPosition = false;
  const useIfDefault = (key, defaultValue, spokenFlowValue) => {
    if (content[key] === defaultValue) content[key] = spokenFlowValue;
  };
  if (design.schemaVersion >= 3) {
    useIfDefault('contentLeftPct', defaults.contentLeftPct, 6);
    useIfDefault('contentWidthPct', defaults.contentWidthPct, 88);
    useIfDefault('contentTopPct', defaults.contentTopPct, 12);
    useIfDefault('contentHeightPct', defaults.contentHeightPct, 66);
    useIfDefault('bodyMaxPx', defaults.bodyMaxPx, bodyFontSize);
    useIfDefault('bodyFont', defaults.bodyFont, 'sans');
  } else if (design.schemaVersion >= 2) {
    automaticVerticalPosition = content.textY === defaults.textY;
    useIfDefault('textY', defaults.textY, 960);
    useIfDefault('textFontSize', defaults.textFontSize, bodyFontSize);
    useIfDefault('textMaxWidth', defaults.textMaxWidth, SPOKEN_FLOW_BODY_MAX_WIDTH);
    useIfDefault('textMaxHeight', defaults.textMaxHeight, 1160);
  }
  return { ...design, content, automaticVerticalPosition };
}

function spokenFlowLayoutOptions(tokens) {
  const fontSize = spokenFlowFontSize(tokens.length);
  return { centerX: 540, centerY: 960, fontSize, maxWidth: SPOKEN_FLOW_BODY_MAX_WIDTH, maxHeight: 1160, lineHeightRatio: 1.44 };
}

function positionSpokenFlowBody(layout, firstBaseline = 520) {
  if (!layout?.lines?.length || !Number.isFinite(layout.lineHeight)) return layout;
  layout.centerY = Math.round(firstBaseline + ((layout.lines.length - 1) * layout.lineHeight) / 2);
  return layout;
}

function fontFamily(font) {
  if (font === 'serif') return 'Georgia, "Times New Roman", serif';
  if (font === 'display') return 'Impact, "Arial Narrow", Arial, sans-serif';
  return 'Arial, Helvetica, sans-serif';
}

function plainTitleWord(value) {
  return String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
}

const ENGLISH_THUMBNAIL_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'for', 'from', 'had', 'has', 'have',
  'he', 'her', 'hers', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or',
  'our', 'ours', 'she', 'so', 'than', 'that', 'the', 'their', 'theirs', 'them', 'then', 'there', 'these', 'they',
  'this', 'those', 'to', 'up', 'us', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with',
  'you', 'your', 'yours', 'about', 'after', 'before', 'can', 'did', 'do', 'does', 'out'
]);

function thumbnailHighlightTerms(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => String(item ?? '').split(/[\s,;]+/u))
    .map(plainTitleWord).filter(Boolean);
}

function automaticThumbnailHighlights(headline) {
  const words = thumbnailHighlightTerms(headline);
  const selected = words.filter((word) => word.length > 2 && !ENGLISH_THUMBNAIL_STOP_WORDS.has(word));
  return (selected.length ? selected : words).slice(0, 2);
}

function resolveThumbnailHighlights(headline, ...sources) {
  const explicit = [...new Set(sources.flatMap(thumbnailHighlightTerms))];
  return explicit.length ? explicit : automaticThumbnailHighlights(headline);
}

async function measureShadowingWordBoxes(tokens, fontSize, layout = chooseLessonTextLayout(tokens)) {
  const cacheKey = JSON.stringify({
    lines: layout.lines.map((line) => line.map(({ id, text }) => [id, text])),
    fontSize,
    lineHeight: layout.lineHeight
  });
  const cached = shadowingWordMetricsCache.get(cacheKey);
  if (cached) {
    shadowingWordMetricsCache.delete(cacheKey);
    shadowingWordMetricsCache.set(cacheKey, cached);
    return cached;
  }

  const rows = [];
  for (const [lineIndex, line] of layout.lines.entries()) {
    for (const token of line) rows.push({ lineIndex, token, line });
  }
  if (!rows.length) return layout.lines.map(() => []);

  const baselineOffset = Math.ceil(fontSize * 1.5);
  const rowPitch = Math.ceil(Math.max(fontSize * 2, layout.lineHeight + fontSize * 0.5));
  const height = baselineOffset + rows.length * rowPitch;
  const measuredMarkup = rows.map(({ line, token }, rowIndex) => {
    const spans = line.map((candidate, tokenIndex) => {
      const selected = candidate.id === token.id;
      const trailingSpace = tokenIndex < line.length - 1 ? '&#160;' : '';
      return '<tspan fill="' + (selected ? '#FFFFFF' : 'none') + '">' + xml(candidate.text) + trailingSpace + '</tspan>';
    }).join('');
    return '<tspan x="' + layout.centerX + '" y="' + (baselineOffset + rowIndex * rowPitch) + '">' + spans + '</tspan>';
  }).join('');
  const measurementSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + WIDTH + '" height="' + height + '" viewBox="0 0 ' + WIDTH + ' ' + height + '"><text xml:space="preserve" text-anchor="middle" font-family="Arial, sans-serif" font-size="' + fontSize + '" font-weight="700" letter-spacing=".1">' + measuredMarkup + '</text></svg>';
  const { data, info } = await sharp(Buffer.from(measurementSvg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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

  const startY = Math.round(layout.centerY - (Math.max(0, layout.lines.length - 1) * layout.lineHeight) / 2);
  const boxes = layout.lines.map(() => []);
  for (const [rowIndex, entry] of bounds.entries()) {
    const row = rows[rowIndex];
    if (entry.maxX < entry.minX || entry.maxY < entry.minY) {
      throw new Error('EnglishShadowing: không đo được vị trí chữ Highlight "' + row.token.text + '".');
    }
    boxes[row.lineIndex].push({
      tokenId: row.token.id,
      x: entry.minX,
      y: entry.minY - (baselineOffset + rowIndex * rowPitch) + startY + row.lineIndex * layout.lineHeight,
      width: entry.maxX - entry.minX + 1,
      height: entry.maxY - entry.minY + 1
    });
  }
  if (shadowingWordMetricsCache.size >= 8) shadowingWordMetricsCache.delete(shadowingWordMetricsCache.keys().next().value);
  shadowingWordMetricsCache.set(cacheKey, boxes);
  return boxes;
}

function buildShadowingHighlightRects(wordBoxes, activeTokenIds, color, paddingValue, radiusValue, design = null) {
  const active = new Set(activeTokenIds);
  if (!active.size) return '';
  const padding = Math.max(0, Math.min(24, Number(paddingValue ?? 6)));
  const radius = Math.max(0, Math.min(32, Number(radiusValue ?? 8)));
  const highlightColor = /^#[\da-f]{6}$/iu.test(String(color || '')) ? String(color).toUpperCase() : LEGACY_PALETTE.burgundy;
  return wordBoxes.flatMap((lineBoxes) => lineBoxes
    .filter((box) => active.has(box.tokenId))
    .map((box) => {
      const previous = lineBoxes
        .filter((candidate) => !active.has(candidate.tokenId) && candidate.x + candidate.width <= box.x)
        .sort((left, right) => right.x - left.x)[0];
      const next = lineBoxes
        .filter((candidate) => !active.has(candidate.tokenId) && candidate.x >= box.x + box.width)
        .sort((left, right) => left.x - right.x)[0];
      const leftGap = previous ? box.x - (previous.x + previous.width) : Infinity;
      const rightGap = next ? next.x - (box.x + box.width) : Infinity;
      const padLeft = Math.min(padding, Number.isFinite(leftGap) ? Math.max(0, leftGap / 2 - 0.5) : padding);
      const padRight = Math.min(padding, Number.isFinite(rightGap) ? Math.max(0, rightGap / 2 - 0.5) : padding);
      const x = box.x - padLeft;
      const y = box.y - padding;
      const width = Math.max(1, box.width + padLeft + padRight);
      const height = box.height + padding * 2;
      const opacity = design ? Math.max(0.1, Math.min(1, Number(design.highlightOpacity ?? 1))) : 1;
      return '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" rx="' + radius + '" fill="' + highlightColor + '"' + (design ? ' fill-opacity="' + opacity + '"' : '') + '/>';
    }).join('')).join('');
}

function editorLayerAttributes(editorMode, role, xKey, yKey) {
  return editorMode ? `data-drag-role="${role}" data-x-key="${xKey}" data-y-key="${yKey}"` : '';
}

function editorResizeHandle(editorMode, key, axis, x, y, scale = 1) {
  return editorMode
    ? `<circle cx="${x}" cy="${y}" r="18" fill="#287D7B" stroke="#FFFFFF" stroke-width="5" cursor="${axis === 'x' ? 'ew-resize' : 'ns-resize'}" data-resize-key="${key}" data-resize-axis="${axis}" data-resize-scale="${scale}"/>`
    : '';
}

function buildLessonFrameSvg({ script, tokens, activeTokenIds = [], highlightStyle = 'text', highlightColor, highlightPadding = 6, highlightRadius = 8, highlightWordBoxes = [], fontSize: requestedFontSize, backgroundEffectConfig = {}, backgroundThemeId = null, frameTime = 0, videoId = 'english-shadowing-preview', layer = 'full', visualDesign = null, lessonLayout = null, editorMode = false }) {
  if (visualDesign?.enabled && visualDesign.schemaVersion >= 3) {
    return buildSourceContentSvg({
      script,
      tokens,
      activeTokenIds,
      style: visualDesign.content,
      brand: 'Easy English Shadowing',
      editorMode,
      centerText: usesEnglishShadowingSpokenFlow(script)
    });
  }
  const palette = resolveRenderPalette(backgroundThemeId);
  const contentDesign = visualDesign?.enabled ? visualDesign.content : null;
  const v2ContentDesign = visualDesign?.schemaVersion >= 2 ? contentDesign : null;
  let backgroundMarkup = '';
  if (layer !== 'foreground') {
    const effectMarkup = renderBackgroundEffectMarkup(backgroundEffectConfig.backgroundEffect, {
      width: WIDTH,
      height: HEIGHT,
      time: frameTime,
      seed: videoId,
      density: backgroundEffectConfig.backgroundEffectDensity,
      speed: backgroundEffectConfig.backgroundEffectSpeed,
      opacity: backgroundEffectConfig.backgroundEffectOpacity,
      contentLanguage: 'en'
    });
    if (contentDesign?.useCustomBackground) {
      backgroundMarkup = `<rect width="${WIDTH}" height="${HEIGHT}" fill="${contentDesign.backgroundColor}"/>${effectMarkup}`;
    } else if (palette.theme) {
      backgroundMarkup = `<defs>
    <linearGradient id="shadowingBackground" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.theme.backgroundStart}"/><stop offset=".52" stop-color="${palette.theme.backgroundMid}"/><stop offset="1" stop-color="${palette.theme.backgroundEnd}"/></linearGradient>
    <radialGradient id="shadowingGlow"><stop stop-color="${palette.theme.glow}" stop-opacity=".28"/><stop offset="1" stop-color="${palette.theme.glow}" stop-opacity="0"/></radialGradient>
    <pattern id="shadowingGrain" width="37" height="37" patternUnits="userSpaceOnUse"><circle cx="6" cy="11" r="1" fill="#FFFFFF" opacity=".035"/><circle cx="28" cy="29" r=".8" fill="#FFFFFF" opacity=".025"/></pattern>
  </defs>
  <rect width="1080" height="1920" fill="url(#shadowingBackground)"/><rect width="1080" height="1920" fill="url(#shadowingGrain)"/>
  <ellipse cx="170" cy="370" rx="480" ry="510" fill="url(#shadowingGlow)"/><ellipse cx="960" cy="1510" rx="470" ry="520" fill="url(#shadowingGlow)"/>
  <path d="M0 330 C170 285 245 365 370 334 M810 330 C920 290 990 300 1080 330 M0 1510 C155 1468 250 1540 370 1512 M810 1510 C930 1470 1000 1480 1080 1510" fill="none" stroke="${palette.gold}" stroke-width="2" opacity=".15"/>${effectMarkup}`;
    } else {
      backgroundMarkup = `<defs><radialGradient id="paper" cx="52%" cy="44%" r="76%"><stop offset="0" stop-color="#F8FCF9"/><stop offset="1" stop-color="${palette.paper}"/></radialGradient><pattern id="grain" width="31" height="31" patternUnits="userSpaceOnUse"><circle cx="4" cy="9" r="1.2" fill="#63877D" opacity=".12"/><circle cx="23" cy="25" r=".8" fill="#FFFFFF" opacity=".7"/></pattern></defs>
  <rect width="1080" height="1920" fill="url(#paper)"/><rect width="1080" height="1920" fill="url(#grain)"/>
  <path d="M0 330 C170 285 245 365 370 334 M810 330 C920 290 990 300 1080 330 M0 1510 C155 1468 250 1540 370 1512 M810 1510 C930 1470 1000 1480 1080 1510" fill="none" stroke="${palette.gold}" stroke-width="2" opacity=".17"/>${effectMarkup}`;
    }
  }

  let foregroundMarkup = '';
  if (layer !== 'background') {
    const active = new Set(activeTokenIds);
    const layout = lessonLayout || chooseLessonTextLayout(tokens, contentDesign ? {
      centerX: contentDesign.textX,
      centerY: contentDesign.textY,
      fontSize: contentDesign.textFontSize,
      ...(v2ContentDesign ? { maxWidth: v2ContentDesign.textMaxWidth, maxHeight: v2ContentDesign.textMaxHeight } : {})
    } : {});
    const { lines, lineHeight, centerX, centerY } = layout;
    const fontSize = requestedFontSize || layout.fontSize;
    const scriptHeight = Math.max(0, lines.length - 1) * lineHeight;
    const startY = Math.round(centerY - scriptHeight / 2);
    const scriptLines = lines.map((line, lineIndex) => {
      const spans = line.map((token, tokenIndex) => {
        const isActive = active.has(token.id);
        const fill = isActive
          ? (v2ContentDesign?.highlightTextMode === 'custom'
            ? v2ContentDesign.highlightTextColor
            : highlightStyle === 'tool' ? (palette.activeText || '#FFFFFF') : (contentDesign?.highlightColor || highlightColor))
          : (contentDesign?.textColor || (palette.backgroundText ? palette.backgroundText : '#17191D'));
        // SVG collapses a normal trailing space at the end of a tspan. Use a
        // non-breaking space so adjacent word spans stay visibly separated.
        const trailingSpace = tokenIndex < line.length - 1 ? '&#160;' : '';
        const underline = isActive && v2ContentDesign?.highlightUnderlineLegacy
          ? ` text-decoration="underline" text-decoration-color="${v2ContentDesign.highlightUnderlineColorLegacy}"`
          : '';
        const opacity = isActive && v2ContentDesign && highlightStyle !== 'tool'
          ? ` fill-opacity="${v2ContentDesign.highlightOpacity}"`
          : '';
        return `<tspan fill="${xml(fill)}"${underline}${opacity}>${xml(token.text)}${trailingSpace}</tspan>`;
      }).join('');
      return `<tspan x="${centerX}" y="${startY + lineIndex * lineHeight}">${spans}</tspan>`;
    }).join('');
    if (highlightStyle === 'tool') {
      backgroundMarkup += buildShadowingHighlightRects(
        highlightWordBoxes,
        activeTokenIds,
        contentDesign?.highlightColor || highlightColor,
        v2ContentDesign?.highlightPadding ?? highlightPadding,
        v2ContentDesign?.highlightRadius ?? highlightRadius,
        v2ContentDesign
      );
    }
    const title = String(script.title || '').trim().slice(0, 72);
    const titleSize = contentDesign?.titleFontSize || (title.length > 40 ? 38 : 46);
    const titleWords = title.split(/\s+/u).filter(Boolean).map((text) => ({ text }));
    const titleMaxWidth = v2ContentDesign?.titleMaxWidth || 820;
    const titleLines = wrapTokens(titleWords, titleMaxWidth, titleSize, 7);
    const titleStartY = contentDesign?.titleY || (titleLines.length > 1 ? 420 : 438);
    const titleX = contentDesign?.titleX || 540;
    const titleFontFamily = fontFamily(v2ContentDesign?.titleFont);
    const safeTitleLines = titleLines.slice(0, 2).map((line, index) =>
      `<tspan x="${titleX}" y="${titleStartY + index * Math.round(titleSize * 1.16)}">${xml(line.map((token) => token.text).join(' '))}</tspan>`
    ).join('');
    const titleMarkup = v2ContentDesign
      ? `<g ${editorLayerAttributes(editorMode, 'title', 'titleX', 'titleY')}><text text-anchor="middle" font-family="${xml(titleFontFamily)}" font-size="${titleSize}" font-weight="700" fill="${contentDesign.titleColor}">${safeTitleLines}</text></g>${editorMode ? `<rect x="${titleX - titleMaxWidth / 2}" y="${titleStartY - titleSize}" width="${titleMaxWidth}" height="${Math.max(titleSize * 1.2, titleLines.length * titleSize * 1.2)}" fill="none" stroke="#287D7B" stroke-width="3" stroke-dasharray="12 9" pointer-events="none"/>${editorResizeHandle(editorMode, 'titleMaxWidth', 'x', titleX + titleMaxWidth / 2, titleStartY - titleSize / 2, 2)}` : ''}`
      : contentDesign
      ? `<g ${editorLayerAttributes(editorMode, 'title', 'titleX', 'titleY')}><text text-anchor="middle" font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="700" fill="${contentDesign.titleColor}">${safeTitleLines}</text></g>`
      : `<text text-anchor="middle" font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="700" fill="${palette.backgroundText || '#17191D'}">${safeTitleLines}</text>`;
    const bodyFontFamily = fontFamily(v2ContentDesign?.textFont);
    const bodyMarkup = v2ContentDesign
      ? `<g ${editorLayerAttributes(editorMode, 'body', 'textX', 'textY')}><text xml:space="preserve" text-anchor="middle" font-family="${xml(bodyFontFamily)}" font-size="${fontSize}" font-weight="700" letter-spacing=".1">${scriptLines}</text></g>${editorMode ? `<rect x="${centerX - v2ContentDesign.textMaxWidth / 2}" y="${centerY - v2ContentDesign.textMaxHeight / 2}" width="${v2ContentDesign.textMaxWidth}" height="${v2ContentDesign.textMaxHeight}" fill="none" stroke="#287D7B" stroke-width="3" stroke-dasharray="12 9" pointer-events="none"/>${editorResizeHandle(editorMode, 'textMaxWidth', 'x', centerX + v2ContentDesign.textMaxWidth / 2, centerY, 2)}${editorResizeHandle(editorMode, 'textMaxHeight', 'y', centerX, centerY + v2ContentDesign.textMaxHeight / 2, 2)}` : ''}`
      : contentDesign
      ? `<g ${editorLayerAttributes(editorMode, 'body', 'textX', 'textY')}><text xml:space="preserve" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" letter-spacing=".1">${scriptLines}</text></g>`
      : `<text xml:space="preserve" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" letter-spacing=".1" fill="#17191D">${scriptLines}</text>`;
    const brandX = contentDesign?.brandX || 540;
    const brandY = contentDesign?.brandY || 248;
    const brandColor = v2ContentDesign?.brandColorLegacy || contentDesign?.brandColor;
    const brandMarkup = contentDesign?.showBrand === false ? '' : v2ContentDesign
      ? `<g ${editorLayerAttributes(editorMode, 'brand', 'brandX', 'brandY')}><text x="${brandX}" y="${brandY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="800" letter-spacing="-1.4"><tspan fill="${brandColor}">EasyEnglish</tspan><tspan fill="${brandColor}">Shadowing</tspan></text></g>`
      : contentDesign
      ? `<g ${editorLayerAttributes(editorMode, 'brand', 'brandX', 'brandY')}><text x="${brandX}" y="${brandY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="800" letter-spacing="-1.4" fill="${brandColor}">EasyEnglishShadowing</text></g>`
      : `<text x="540" y="248" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="800" letter-spacing="-1.4"><tspan fill="${palette.brandEasy}">Easy</tspan><tspan fill="${palette.brandEnglish}">English</tspan><tspan fill="${palette.brandShadowing}">Shadowing</tspan></text>`;
    const footerMarkup = contentDesign?.showFooter === false ? '' : contentDesign
      ? `<text x="${contentDesign.footerX}" y="${contentDesign.footerY}" text-anchor="middle" fill="${brandColor}" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="700" letter-spacing=".2" opacity=".86">EasyEnglishShadowing</text>`
      : `<text x="540" y="1795" text-anchor="middle" fill="${palette.brandEasy}" font-family="Arial, Helvetica, sans-serif" font-size="23" font-weight="700" letter-spacing=".2" opacity=".86">EasyEnglishShadowing</text>`;
    foregroundMarkup = `${brandMarkup}
  ${titleMarkup}
  ${bodyMarkup}
  ${footerMarkup}`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${backgroundMarkup}${foregroundMarkup}</svg>`;
}

export async function buildEnglishShadowingVisualPreviewSvg(profile = ENGLISH_SHADOWING_DEFAULT_SETTINGS, backgroundThemeId = FIRST_ENGLISH_SHADOWING_BACKGROUND_THEME_ID, requestedVisualDesign = null, editorMode = false, sample = {}) {
  const visualDesign = resolveSpokenFlowVisualDesign(requestedVisualDesign, { speechSegments: [{ narrationVersion: ENGLISH_SHADOWING_NARRATION_VERSION }] });
  const defaultScriptText = 'A clear read-back can prevent mix-ups during a busy call. When someone lists several steps, write each one down. Repeat the order in your own words before hanging up. You might ask, “Do I send the form first, or call the office?” Confirm names, dates, and deadlines while the other person is still there. A quick check gives everyone a shared plan and can save another phone call later.';
  const scriptText = String(sample?.scriptText || defaultScriptText).trim().slice(0, 1600) || defaultScriptText;
  const title = String(sample?.title || 'Quick Check, Clear Plan').trim().slice(0, 120) || 'Quick Check, Clear Plan';
  const previewScript = {
    title,
    scriptText,
    speechSegments: [{ narrationVersion: ENGLISH_SHADOWING_NARRATION_VERSION }]
  };
  const tokens = [...scriptText.matchAll(/\S+/gu)].map((match, index) => ({
    id: `shadowing-preview:word:${index + 1}`,
    text: match[0]
  }));
  if (visualDesign.enabled && visualDesign.schemaVersion >= 3) {
    return buildSourceContentSvg({
      script: previewScript,
      tokens,
      activeTokenIds: editorMode
        ? profile.highlightMode === 'phrase'
          ? tokens.slice(1, 4).map((token) => token.id)
          : [tokens[1]?.id].filter(Boolean)
        : [],
      style: visualDesign.content,
      brand: String(sample?.brand || 'Easy English Shadowing'),
      editorMode,
      demoHighlight: editorMode,
      centerText: true
    });
  }
  const contentDesign = visualDesign.enabled && visualDesign.schemaVersion >= 2 ? visualDesign.content : null;
  let layout = chooseLessonTextLayout(tokens, visualDesign.enabled ? {
    centerX: visualDesign.content.textX,
    centerY: visualDesign.content.textY,
    fontSize: visualDesign.content.textFontSize,
    ...(contentDesign ? { maxWidth: Math.min(contentDesign.textMaxWidth, SPOKEN_FLOW_BODY_MAX_WIDTH), maxHeight: contentDesign.textMaxHeight } : {}),
    lineHeightRatio: 1.44
  } : spokenFlowLayoutOptions(tokens));
  if (!visualDesign.enabled || visualDesign.automaticVerticalPosition) layout = positionSpokenFlowBody(layout);
  const highlightWordBoxes = await measureShadowingWordBoxes(tokens, layout.fontSize, layout);
  const previewActiveTokens = profile.highlightEnabled === false
    ? []
    : profile.highlightMode === 'phrase'
      ? (sample?.scriptText ? tokens.slice(1, 4) : tokens.slice(24, 27)).map((token) => token.id)
      : [sample?.scriptText ? tokens[1]?.id : tokens[24]?.id].filter(Boolean);
  return buildLessonFrameSvg({
    script: previewScript,
    tokens,
    activeTokenIds: previewActiveTokens,
    highlightStyle: profile.highlightStyle,
    highlightColor: visualDesign.enabled ? visualDesign.content.highlightColor : profile.highlightColor,
    highlightPadding: profile.highlightPadding,
    highlightRadius: profile.highlightRadius,
    highlightWordBoxes,
    backgroundEffectConfig: profile.backgroundEffectConfig,
    backgroundThemeId,
    fontSize: layout.fontSize,
    visualDesign,
    lessonLayout: layout,
    editorMode
  });
}

export function buildEnglishShadowingThumbnailSvg(script, requestedVisualDesign = null, { editorMode = false, brand = 'Easy English Shadowing', headline = null, highlight = null } = {}) {
  const suppliedDesign = requestedVisualDesign?.thumbnail
    ? requestedVisualDesign
    : { schemaVersion: 2, enabled: true, thumbnail: requestedVisualDesign || {} };
  const visualDesign = normalizeEnglishShadowingVisualDesign({ ...suppliedDesign, enabled: true });
  const design = visualDesign.thumbnail;
  const title = String(script?.title ?? script?.thumbnailTitle ?? '');
  const sourceHeadline = headline ?? title;
  const selectedHighlights = resolveThumbnailHighlights(
    sourceHeadline, design.highlightWords, highlight, script?.thumbnailHighlightWords, script?.thumbnail?.highlight, script?.highlight
  );
  if (visualDesign.schemaVersion >= 3) {
    return buildSourceThumbnailSvg(script, design, {
      editorMode,
      brand,
      headline: sourceHeadline,
      highlight: selectedHighlights
    });
  }
  if (visualDesign.schemaVersion < 2) {
    const words = title.split(/\s+/u).filter(Boolean).map((text) => ({ text }));
    const lines = wrapTokens(words, 850, design.titleFontSize, Number.MAX_SAFE_INTEGER);
    const lineHeight = Math.round(design.titleFontSize * 1.18);
    const titleMarkup = lines.map((line, index) =>
      `<tspan x="${design.titleX}" y="${design.titleY + index * lineHeight}">${xml(line.map((token) => token.text).join(' '))}</tspan>`
    ).join('');
    const brandMarkup = design.showBrand
      ? `<g ${editorLayerAttributes(editorMode, 'brand', 'brandX', 'brandY')}><text x="${design.brandX}" y="${design.brandY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="${design.brandColor}">EasyEnglishShadowing</text></g>`
      : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs><linearGradient id="coverPaper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#FFFFFF" stop-opacity=".44"/><stop offset="1" stop-color="#756B5E" stop-opacity=".18"/></linearGradient><pattern id="coverGrain" width="31" height="31" patternUnits="userSpaceOnUse"><circle cx="5" cy="9" r="1" fill="#4D463C" opacity=".08"/><circle cx="23" cy="25" r=".8" fill="#FFFFFF" opacity=".45"/></pattern></defs>
  <rect width="1080" height="1920" fill="${design.backgroundColor}"/><rect width="1080" height="1920" fill="url(#coverPaper)"/><rect width="1080" height="1920" fill="url(#coverGrain)"/>
  ${brandMarkup}
  <g ${editorLayerAttributes(editorMode, 'title', 'titleX', 'titleY')}><rect x="${design.titleX - 410}" y="${design.titleY - 105}" width="820" height="8" rx="4" fill="${design.accentColor}" opacity=".92"/><text text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${design.titleFontSize}" font-weight="800" fill="${design.titleColor}">${titleMarkup}</text></g>
  <text x="540" y="1785" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="${design.brandColor}" opacity=".78">EASY ENGLISH SHADOWING</text>
</svg>`;
  }

  const words = title.split(/\s+/u).filter(Boolean).map((text) => ({ text }));
  const renderedSize = design.titleFontSize;
  const lines = wrapTokens(words, design.titleMaxWidth, renderedSize, Number.MAX_SAFE_INTEGER);
  const lineHeight = Math.round(renderedSize * 1.18);
  const highlightWords = new Set(selectedHighlights.map(plainTitleWord));
  const titleMarkup = lines.map((line, index) =>
    `<tspan x="${design.titleX}" y="${design.titleY + index * lineHeight}">${line.map((token, tokenIndex) => {
      const fill = highlightWords.has(plainTitleWord(token.text)) ? design.highlightColor : design.titleColor;
      return `<tspan fill="${fill}">${xml(token.text)}${tokenIndex < line.length - 1 ? '&#160;' : ''}</tspan>`;
    }).join('')}</tspan>`
  ).join('');
  const titleFont = fontFamily(design.titleFont);
  const stroke = design.outlineWidth > 0
    ? ` stroke="${design.outlineColor}" stroke-width="${design.outlineWidth}" stroke-linejoin="round" paint-order="stroke fill"`
    : '';
  const titleTop = design.titleY - renderedSize;
  const titleHeight = Math.max(lineHeight, Math.min(design.titleHeight, lines.length * lineHeight));
  const titleHandle = editorMode
    ? `<rect x="${design.titleX - design.titleMaxWidth / 2}" y="${titleTop}" width="${design.titleMaxWidth}" height="${titleHeight}" fill="none" stroke="#287D7B" stroke-width="3" stroke-dasharray="12 9" pointer-events="none"/>${editorResizeHandle(true, 'titleMaxWidth', 'x', design.titleX + design.titleMaxWidth / 2, titleTop + titleHeight / 2, 2)}${editorResizeHandle(true, 'titleFontSize', 'y', design.titleX, titleTop + titleHeight + 22, 0.5)}`
    : '';
  const brandMarkup = design.showBrand
    ? `<g ${editorLayerAttributes(editorMode, 'brand', 'brandX', 'brandY')}><text x="${design.brandX}" y="${design.brandY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700"><tspan fill="${design.brandColorA}">EasyEnglish</tspan><tspan fill="${design.brandColorB}">Shadowing</tspan></text></g>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs><linearGradient id="coverPaper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#FFFFFF" stop-opacity=".44"/><stop offset="1" stop-color="#756B5E" stop-opacity=".18"/></linearGradient><pattern id="coverGrain" width="31" height="31" patternUnits="userSpaceOnUse"><circle cx="5" cy="9" r="1" fill="#4D463C" opacity=".08"/><circle cx="23" cy="25" r=".8" fill="#FFFFFF" opacity=".45"/></pattern><radialGradient id="coverVignette"><stop offset=".45" stop-color="#34291E" stop-opacity="0"/><stop offset="1" stop-color="#34291E" stop-opacity="${design.vignette}"/></radialGradient><linearGradient id="coverBottomShade" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#34291E" stop-opacity="0"/><stop offset="1" stop-color="#34291E" stop-opacity="${design.bottomShade}"/></linearGradient></defs>
  <rect width="1080" height="1920" fill="${design.backgroundColor}"/><rect width="1080" height="1920" fill="url(#coverPaper)"/><rect width="1080" height="1920" fill="url(#coverGrain)"/><rect width="1080" height="1920" fill="url(#coverVignette)"/><rect width="1080" height="1920" fill="url(#coverBottomShade)"/>
  ${brandMarkup}
  <g ${editorLayerAttributes(editorMode, 'title', 'titleX', 'titleY')}><rect x="${design.titleX - design.titleMaxWidth / 2}" y="${titleTop - 24}" width="${design.titleMaxWidth}" height="8" rx="4" fill="${design.accentColor}" opacity=".92"/><text text-anchor="middle" font-family="${xml(titleFont)}" font-size="${renderedSize}" font-weight="${design.titleFont === 'display' ? 800 : 700}"${stroke}>${titleMarkup}</text></g>${titleHandle}
  <text x="540" y="1785" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="${design.brandColor}" opacity=".78">EASY ENGLISH SHADOWING</text>
</svg>`;
}

export async function buildEnglishShadowingVisualDesignPreviewSvg({ mode = 'content', profile = ENGLISH_SHADOWING_DEFAULT_SETTINGS, visualDesign: requestedVisualDesign = null, sample = {} } = {}) {
  const visualDesign = normalizeEnglishShadowingVisualDesign({ ...requestedVisualDesign, enabled: true });
  const editorMode = sample?.render !== true && sample?.cardPreview !== true;
  if (mode === 'thumbnail') {
    if (visualDesign.schemaVersion >= 3) {
      return buildEnglishShadowingThumbnailSvg(
        { thumbnailTitle: sample?.thumbnailTitle, title: 'Why gers filled the capital' },
        visualDesign,
        { editorMode, brand: sample?.brand || 'Things', headline: sample?.thumbnailTitle || 'Why gers filled the capital', highlight: sample?.thumbnailHighlight || 'gers capital' }
      );
    }
    return buildEnglishShadowingThumbnailSvg({ thumbnailTitle: sample?.thumbnailTitle, title: 'Quick Check, Clear Plan' }, visualDesign, { editorMode: true });
  }
  if (visualDesign.thumbnailOnly && sample?.cardPreview === true) {
    const toolContentDesign = normalizeEnglishShadowingVisualDesign({ ...visualDesign, enabled: false });
    return buildEnglishShadowingVisualPreviewSvg(profile, FIRST_ENGLISH_SHADOWING_BACKGROUND_THEME_ID, toolContentDesign, false, {
      ...sample,
      title: sample?.title || 'Quick Check, Clear Plan',
      scriptText: sample?.scriptText || 'A short line that sets the scene for the whole story. A second line, long enough to show how the text wraps and shrinks to fit.',
      brand: sample?.brand || 'Things'
    }).then((svg) => svg.replace('<svg ', '<svg data-shadowing-preview="content" '));
  }
  return buildEnglishShadowingVisualPreviewSvg(profile, FIRST_ENGLISH_SHADOWING_BACKGROUND_THEME_ID, visualDesign, editorMode, {
    ...sample,
    title: sample?.title || 'Why gers filled the capital',
    scriptText: sample?.scriptText || 'A short line that sets the scene for the whole story. A second line, long enough to show how the text wraps and shrinks to fit.',
    brand: sample?.brand || 'Things'
  }).then((svg) => svg.replace('<svg ', '<svg data-shadowing-preview="content" '));
}

export async function buildEnglishShadowingVisualDesignPreviewPng(options = {}) {
  const svg = await buildEnglishShadowingVisualDesignPreviewSvg({
    ...options,
    sample: { ...(options.sample || {}), render: true }
  });
  return renderSourceDesignSvg(svg);
}

function concatFilePath(filePath) {
  return path.resolve(filePath).replace(/\\/gu, '/').replace(/'/gu, "\\'");
}

function makeFrameSegments(intervals, frameCount) {
  const edges = new Set([0, frameCount]);
  const quantized = intervals.map((interval) => ({
    ...interval,
    startFrame: Math.max(0, Math.min(frameCount, Math.round(Number(interval.startSeconds) * FPS))),
    endFrame: Math.max(0, Math.min(frameCount, Math.round(Number(interval.endSeconds) * FPS)))
  })).filter((item) => item.endFrame > item.startFrame);
  for (const item of quantized) { edges.add(item.startFrame); edges.add(item.endFrame); }
  const sorted = [...edges].sort((left, right) => left - right);
  const segments = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const startFrame = sorted[index];
    const endFrame = sorted[index + 1];
    if (endFrame <= startFrame) continue;
    const active = quantized.find((item) => startFrame >= item.startFrame && startFrame < item.endFrame);
    const tokenIds = active?.tokenIds || [];
    const key = tokenIds.join('|');
    const last = segments.at(-1);
    if (last?.key === key) last.frameCount += endFrame - startFrame;
    else segments.push({ key, tokenIds, startFrame, frameCount: endFrame - startFrame });
  }
  return segments;
}

/** Render the isolated EnglishShadowing visual and narration composition. */
export async function renderEnglishShadowingVideo({ script, audioPath, tokens, wordTimings, profile, videoId, backgroundThemeId = null, outputFileName = '', onProgress = () => {} }) {
  const spokenFlow = usesEnglishShadowingSpokenFlow(script);
  const visualDesign = resolveSpokenFlowVisualDesign(profile?.visualDesign, script);
  const activeVisualDesign = visualDesign.enabled && !visualDesign.thumbnailOnly ? visualDesign : null;
  const activeThumbnailDesign = visualDesign.enabled ? visualDesign : null;
  const highlightStyle = profile.highlightStyle === 'tool' ? 'tool' : 'text';
  const safeId = String(videoId || '').replace(/[^\w-]/gu, '');
  if (!safeId) throw new Error('EnglishShadowing: mã video không hợp lệ.');
  const workDir = path.join(PATHS.temporary, safeId, 'english-shadowing');
  const outputDir = path.join(PATHS.output, safeId);
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const sentenceAudioDuration = await getEnglishShadowingMediaDuration(audioPath);
  const deliveryStyle = resolveEnglishShadowingDeliveryStyle(script.deliveryStyle, script);
  const delivery = getEnglishShadowingDeliveryProfile(deliveryStyle, script);
  const pace = planEnglishShadowingPace({
    text: script.scriptText,
    sourceAudioDurationSeconds: sentenceAudioDuration,
    targetWordsPerMinute: delivery.targetWordsPerMinute,
    preserveSourcePace: usesEnglishShadowingSpokenFlow(script)
  });
  const scaledTimings = scaleEnglishShadowingWordTimings(wordTimings, pace);
  const intervals = profile.highlightEnabled === false
    ? []
    : buildHighlightIntervals(scaledTimings, profile.highlightMode, { phraseSize: 3, pauseThreshold: 0.32 });
  const frameCount = Math.max(1, Math.ceil(pace.finalDurationSeconds * FPS));
  const frameSegments = makeFrameSegments(intervals, frameCount);
  const allTokens = Array.isArray(tokens) ? tokens : [];
  if (!allTokens.length) throw new Error('EnglishShadowing: Kokoro chưa trả về token để hiển thị.');
  const v2ContentDesign = activeVisualDesign?.schemaVersion === 2 ? activeVisualDesign.content : null;
  let lessonLayout = chooseLessonTextLayout(allTokens, activeVisualDesign ? {
    centerX: activeVisualDesign.content.textX,
    centerY: activeVisualDesign.content.textY,
    fontSize: activeVisualDesign.content.textFontSize,
    ...(v2ContentDesign ? { maxWidth: spokenFlow ? Math.min(v2ContentDesign.textMaxWidth, SPOKEN_FLOW_BODY_MAX_WIDTH) : v2ContentDesign.textMaxWidth, maxHeight: v2ContentDesign.textMaxHeight } : {}),
    ...(spokenFlow ? { lineHeightRatio: 1.44 } : {})
  } : spokenFlow ? spokenFlowLayoutOptions(allTokens) : {});
  if (spokenFlow && (!activeVisualDesign || visualDesign.automaticVerticalPosition)) {
    lessonLayout = positionSpokenFlowBody(lessonLayout);
  }
  const fontSize = lessonLayout.fontSize;
  const highlightWordBoxes = activeVisualDesign?.schemaVersion >= 3 || profile.highlightEnabled === false || highlightStyle !== 'tool'
    ? []
    : await measureShadowingWordBoxes(allTokens, fontSize, lessonLayout);
  const frameCache = new Map();
  const concatEntries = [];
  const thumbnailName = activeThumbnailDesign ? `thumbnail-${safeId}-${Date.now()}.png` : null;
  const thumbnailWorkPath = activeThumbnailDesign ? path.join(workDir, 'thumbnail-intro.png') : null;
  const thumbnailPath = activeThumbnailDesign ? path.join(outputDir, thumbnailName) : null;
  const introSeconds = activeThumbnailDesign?.schemaVersion >= 3
    ? activeThumbnailDesign.thumbnail.introSeconds
    : activeThumbnailDesign?.thumbnail.introInVideo
      ? activeThumbnailDesign.thumbnail.introSeconds
      : 0;
  const introFrameCount = introSeconds > 0 ? Math.max(1, Math.round(introSeconds * FPS)) : 0;
  const progressFrameTotal = frameCount + introFrameCount;
  if (thumbnailWorkPath) {
    const thumbnailSvg = buildEnglishShadowingThumbnailSvg(script, activeThumbnailDesign);
    const thumbnailPng = await renderSourceDesignSvg(thumbnailSvg);
    await fs.promises.writeFile(thumbnailWorkPath, thumbnailPng);
  }
  for (let index = 0; index < introFrameCount; index += 1) {
    concatEntries.push(
      `file '${concatFilePath(thumbnailWorkPath)}'`,
      `option framerate ${FPS}`,
      `duration ${(1 / FPS).toFixed(6)}`
    );
  }
  const animatedBackground = activeVisualDesign?.schemaVersion >= 3
    ? false
    : profile.backgroundEffectConfig?.backgroundEffect !== 'none';
  let finalFramePath = null;
  if (animatedBackground) {
    // Reuse rendered text while advancing the background on every output frame.
    const foregroundCache = new Map();
    for (const [index, segment] of frameSegments.entries()) {
      const foregroundPath = path.join(workDir, `foreground-${String(index + 1).padStart(5, '0')}.png`);
      const foregroundSvg = buildLessonFrameSvg({
        script,
        tokens: allTokens,
        activeTokenIds: segment.tokenIds,
        highlightStyle,
        highlightColor: profile.highlightColor,
        highlightPadding: profile.highlightPadding,
        highlightRadius: profile.highlightRadius,
        highlightWordBoxes,
        fontSize,
        backgroundThemeId,
        visualDesign: activeVisualDesign,
        lessonLayout,
        layer: 'foreground'
      });
      await sharp(Buffer.from(foregroundSvg)).png({ compressionLevel: 1 }).toFile(foregroundPath);
      foregroundCache.set(segment.startFrame, foregroundPath);
    }

    let segmentIndex = 0;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      while (segmentIndex < frameSegments.length - 1
        && frameIndex >= frameSegments[segmentIndex].startFrame + frameSegments[segmentIndex].frameCount) {
        segmentIndex += 1;
      }
      const segment = frameSegments[segmentIndex];
      const framePath = path.join(workDir, `frame-${String(frameIndex + 1).padStart(5, '0')}.png`);
      const backgroundSvg = buildLessonFrameSvg({
        script,
        tokens: [],
        backgroundEffectConfig: profile.backgroundEffectConfig,
        backgroundThemeId,
        frameTime: frameIndex / FPS,
        videoId: safeId,
        layer: 'background',
        visualDesign: activeVisualDesign
      });
      await sharp(Buffer.from(backgroundSvg))
        .composite([{ input: foregroundCache.get(segment.startFrame) }])
        .png({ compressionLevel: 1 })
        .toFile(framePath);
      finalFramePath = framePath;
      concatEntries.push(
        `file '${concatFilePath(framePath)}'`,
        `option framerate ${FPS}`,
        `duration ${(1 / FPS).toFixed(6)}`
      );
      if ((frameIndex + 1) % FPS === 0 || frameIndex + 1 === frameCount) {
        onProgress({ phase: 'shadowing-frames', index: introFrameCount + frameIndex + 1, total: progressFrameTotal });
      }
    }
  } else {
    let completedMainFrames = 0;
    for (const [index, segment] of frameSegments.entries()) {
      let framePath = frameCache.get(segment.key);
      if (!framePath) {
        framePath = path.join(workDir, `frame-${String(frameCache.size + 1).padStart(5, '0')}.png`);
        const svg = buildLessonFrameSvg({
          script,
          tokens: allTokens,
          activeTokenIds: segment.tokenIds,
          highlightStyle,
          highlightColor: profile.highlightColor,
          highlightPadding: profile.highlightPadding,
          highlightRadius: profile.highlightRadius,
          highlightWordBoxes,
          fontSize,
          backgroundEffectConfig: profile.backgroundEffectConfig,
          backgroundThemeId,
          frameTime: segment.startFrame / FPS,
          videoId: safeId,
          visualDesign: activeVisualDesign,
          lessonLayout
        });
        await sharp(Buffer.from(svg)).png({ compressionLevel: 7 }).toFile(framePath);
        frameCache.set(segment.key, framePath);
      }
      concatEntries.push(
        `file '${concatFilePath(framePath)}'`,
        `option framerate ${FPS}`,
        `duration ${(segment.frameCount / FPS).toFixed(6)}`
      );
      completedMainFrames += segment.frameCount;
      onProgress({ phase: 'shadowing-frames', index: introFrameCount + completedMainFrames, total: progressFrameTotal });
    }
    const lastSegment = frameSegments.at(-1);
    finalFramePath = lastSegment ? frameCache.get(lastSegment.key) : null;
  }
  if (!finalFramePath) throw new Error('EnglishShadowing: không tạo được frame video.');
  concatEntries.push(`file '${concatFilePath(finalFramePath)}'`, `option framerate ${FPS}`);
  const concatPath = path.join(workDir, 'frames.ffconcat');
  fs.writeFileSync(concatPath, `ffconcat version 1.0\n${concatEntries.join('\n')}\n`, 'utf8');

  const safeFileName = /^[\w.-]+\.mp4$/u.test(String(outputFileName)) ? String(outputFileName) : `${safeId}.mp4`;
  const videoPath = path.join(outputDir, safeFileName);
  const atempo = Number(pace.atempo.toFixed(5));
  const introDelayMs = Math.round(introFrameCount * 1000 / FPS);
  const paceFilter = pace.paceMode === 'source' ? 'anull' : `atempo=${atempo}`;
  const audioFilter = introFrameCount > 0
    ? `${paceFilter},adelay=${introDelayMs}:all=1`
    : paceFilter;
  await run(FFMPEG_BIN, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', concatPath,
    '-i', audioPath,
    '-vf', `fps=${FPS},format=yuv420p`, '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-af', audioFilter, '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', videoPath
  ]);
  const durationSeconds = await getEnglishShadowingMediaDuration(videoPath);
  if (activeThumbnailDesign) {
    fs.copyFileSync(thumbnailWorkPath, thumbnailPath);
  } else {
    // Keep the existing default Shadowing behavior for profiles without the
    // opt-in visual design.
    const legacyThumbnailPath = path.join(outputDir, 'thumbnail.png');
    if (fs.existsSync(legacyThumbnailPath)) fs.rmSync(legacyThumbnailPath, { force: true });
  }
  onProgress({ phase: 'shadowing-render-complete', durationSeconds, achievedWordsPerMinute: pace.achievedWordsPerMinute, tempoWasClamped: pace.tempoWasClamped });
  return { videoPath, thumbnailPath, durationSeconds, deliveryStyle, pace, backgroundThemeId: backgroundThemeId || null };
}
