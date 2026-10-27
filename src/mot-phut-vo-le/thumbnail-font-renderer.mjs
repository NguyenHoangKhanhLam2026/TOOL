import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { ROOT } from '../config.mjs';

const WINDOWS_FONTS = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
// Scale each typeface to Arial's measured cap-height for the Vietnamese brand line.
const FONT_CONFIGS = Object.freeze({
  display: { family: 'Be Vietnam Pro Black', cssFamily: 'MPVL Display', file: path.join(ROOT, 'public', 'fonts', 'render', 'BeVietnamPro-Black-Vietnamese.ttf'), serif: false, brandOpticalScale: 0.837 },
  arial: { family: 'Arial', cssFamily: 'Arial', file: path.join(WINDOWS_FONTS, 'arialbd.ttf'), serif: false, brandOpticalScale: 1 },
  times: { family: 'Times New Roman', cssFamily: 'Times New Roman', file: path.join(WINDOWS_FONTS, 'timesbd.ttf'), serif: true, brandOpticalScale: 0.946 },
  georgia: { family: 'Georgia', cssFamily: 'Georgia', file: path.join(WINDOWS_FONTS, 'georgiab.ttf'), serif: true, brandOpticalScale: 0.861 },
  serif: { family: 'Tinos Bold', cssFamily: 'MPVL Tinos', file: path.join(ROOT, 'public', 'fonts', 'render', 'Tinos-Bold.ttf'), serif: true, brandOpticalScale: 0.967 },
  tahoma: { family: 'Tahoma', cssFamily: 'Tahoma', file: path.join(WINDOWS_FONTS, 'tahomabd.ttf'), serif: false, brandOpticalScale: 0.861 },
  trebuchet: { family: 'Trebuchet MS', cssFamily: 'Trebuchet MS', file: path.join(WINDOWS_FONTS, 'trebucbd.ttf'), serif: false, brandOpticalScale: 0.861 },
  verdana: { family: 'Verdana', cssFamily: 'Verdana', file: path.join(WINDOWS_FONTS, 'verdanab.ttf'), serif: false, brandOpticalScale: 0.861 },
  calibri: { family: 'Calibri', cssFamily: 'Calibri', file: path.join(WINDOWS_FONTS, 'calibrib.ttf'), serif: false, brandOpticalScale: 1.074 },
  segoe: { family: 'Segoe UI', cssFamily: 'Segoe UI', file: path.join(WINDOWS_FONTS, 'segoeuib.ttf'), serif: false, brandOpticalScale: 0.956 },
  cambria: { family: 'Cambria', cssFamily: 'Cambria', file: path.join(WINDOWS_FONTS, 'cambriab.ttf'), serif: true, brandOpticalScale: 0.989 },
  garamond: { family: 'Garamond', cssFamily: 'Garamond', file: path.join(WINDOWS_FONTS, 'GARABD.TTF'), serif: true, brandOpticalScale: 0.946 },
  bookman: { family: 'Bookman Old Style', cssFamily: 'Bookman Old Style', file: path.join(WINDOWS_FONTS, 'BOOKOSB.TTF'), serif: true, brandOpticalScale: 1 },
  palatino: { family: 'Palatino Linotype', cssFamily: 'Palatino Linotype', file: path.join(WINDOWS_FONTS, 'palab.ttf'), serif: true, brandOpticalScale: 0.956 },
  'book-antiqua': { family: 'Book Antiqua', cssFamily: 'Book Antiqua', file: path.join(WINDOWS_FONTS, 'ANTQUAB.TTF'), serif: true, brandOpticalScale: 0.861 },
  century: { family: 'Century', cssFamily: 'Century', file: path.join(WINDOWS_FONTS, 'CENTURY.TTF'), serif: true, brandOpticalScale: 0.967 },
  impact: { family: 'Impact', cssFamily: 'Impact', file: path.join(WINDOWS_FONTS, 'impact.ttf'), serif: false, brandOpticalScale: 0.879 },
  comic: { family: 'Comic Sans MS', cssFamily: 'Comic Sans MS', file: path.join(WINDOWS_FONTS, 'comicbd.ttf'), serif: false, brandOpticalScale: 0.897 },
  consolas: { family: 'Consolas', cssFamily: 'Consolas', file: path.join(WINDOWS_FONTS, 'consolab.ttf'), serif: false, brandOpticalScale: 0.989 },
  courier: { family: 'Courier New', cssFamily: 'Courier New', file: path.join(WINDOWS_FONTS, 'courbd.ttf'), serif: true, brandOpticalScale: 1.074 }
});
const FALLBACK_FONT = FONT_CONFIGS.display;
const CONTENT_FONTS = Object.freeze({
  sans: { family: 'Arial', file: path.join(WINDOWS_FONTS, 'arial.ttf'), fallback: FALLBACK_FONT.file },
  serif: { family: 'Georgia', file: path.join(WINDOWS_FONTS, 'georgia.ttf'), fallback: FONT_CONFIGS.serif.file }
});
const spaceWidthCache = new Map();
const headlineMetricsCache = new Map();

export function getMotPhutVoLeHeadlineFont(mode = 'display') {
  const config = FONT_CONFIGS[mode] || FALLBACK_FONT;
  return fs.existsSync(config.file) ? config : FALLBACK_FONT;
}

function attribute(markup, name) {
  const match = String(markup).match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'u'));
  return match?.[1] ?? null;
}

function decodeXml(value) {
  return String(value ?? '').replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/giu, (entity) => {
    const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    if (named[entity]) return named[entity];
    const code = entity.startsWith('&#x') || entity.startsWith('&#X')
      ? Number.parseInt(entity.slice(3, -1), 16)
      : Number.parseInt(entity.slice(2, -1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  });
}

function escapePango(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character]);
}

async function renderText(markup, font, fontFile, fontSize) {
  return sharp({
    text: {
      text: markup,
      font: `${font} ${fontSize}`,
      fontfile: fontFile,
      dpi: 72,
      rgba: true,
      wrap: 'none'
    }
  }).png().toBuffer();
}

async function naturalSpaceWidth(font, fontFile, fontSize) {
  const key = `${font}|${fontFile}|${fontSize}`;
  if (spaceWidthCache.has(key)) return spaceWidthCache.get(key);
  const [joined, spaced] = await Promise.all([
    renderText('AA', font, fontFile, fontSize),
    renderText('A A', font, fontFile, fontSize)
  ]);
  const [joinedInfo, spacedInfo] = await Promise.all([
    sharp(joined).metadata(), sharp(spaced).metadata()
  ]);
  const result = Math.max(0, spacedInfo.width - joinedInfo.width);
  spaceWidthCache.set(key, result);
  return result;
}

export async function measureMotPhutVoLeHeadlineLine(words, mode = 'display') {
  const fontConfig = getMotPhutVoLeHeadlineFont(mode);
  const { family: font, file: fontFile } = fontConfig;
  if (!font || !fontFile || !fs.existsSync(fontFile)) {
    throw new Error(`MPVL headline font is unavailable: ${mode}`);
  }
  const normalizedWords = (Array.isArray(words) ? words : [words]).map((word) => String(word ?? ''));
  const cacheKey = `${fontConfig.family}|${fontFile}|${normalizedWords.join('\u0000')}`;
  if (headlineMetricsCache.has(cacheKey)) return headlineMetricsCache.get(cacheKey);

  const fontSize = 100;
  const spaceWidth = await naturalSpaceWidth(font, fontFile, fontSize);
  const spans = normalizedWords.map((text) => ({ text, color: '#000000' }));
  const markup = pangoMarkup(spans, fontSize * 0.28, spaceWidth);
  const buffer = await renderText(markup, font, fontFile, fontSize);
  const metadata = await sharp(buffer).metadata();
  const metrics = {
    widthPerPixel: Number(metadata.width) / fontSize,
    heightPerPixel: Number(metadata.height) / fontSize
  };
  headlineMetricsCache.set(cacheKey, metrics);
  return metrics;
}

function pangoMarkup(spans, gap, spaceWidth, colorOverride = null, tracking = 0, bold = false) {
  const extraSpacePx = Math.max(0, gap - spaceWidth);
  const letterSpacing = Math.round(extraSpacePx * 1024);
  return spans.map((span, index) => (
    `<span foreground="${colorOverride || span.color}"${bold ? ' weight="bold"' : ''}${tracking ? ` letter_spacing="${Math.round(tracking * 1024)}"` : ''}>${escapePango(span.text)}</span>`
      + (index < spans.length - 1 ? `<span letter_spacing="${letterSpacing}"> </span>` : '')
  )).join('');
}

async function outlinedLine(fillMarkup, outlineMarkup, font, fontFile, fontSize, strokeWidth) {
  const [fillBuffer, outlineBuffer] = await Promise.all([
    renderText(fillMarkup, font, fontFile, fontSize),
    renderText(outlineMarkup, font, fontFile, fontSize)
  ]);
  const [fillInfo, outlineInfo] = await Promise.all([
    sharp(fillBuffer).metadata(), sharp(outlineBuffer).metadata()
  ]);
  if (fillInfo.width !== outlineInfo.width || fillInfo.height !== outlineInfo.height) {
    throw new Error('MPVL headline fill and outline metrics do not match.');
  }

  const radius = Math.max(1, Number(strokeWidth) / 2);
  const pad = Math.ceil(radius) + 2;
  const width = fillInfo.width + pad * 2;
  const height = fillInfo.height + pad * 2;
  const outlineOffsets = Array.from({ length: 20 }, (_unused, index) => {
    const angle = (Math.PI * 2 * index) / 20;
    return {
      input: outlineBuffer,
      left: pad + Math.round(Math.cos(angle) * radius),
      top: pad + Math.round(Math.sin(angle) * radius)
    };
  });
  const outlineLayer = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite(outlineOffsets).png().toBuffer();
  const shadowLayer = await sharp(outlineLayer).blur(5).png().toBuffer();
  const buffer = await sharp({
    create: { width, height: height + 6, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite([
    { input: shadowLayer, left: 0, top: 6, opacity: 0.45 },
    { input: outlineLayer, left: 0, top: 0 },
    { input: fillBuffer, left: pad, top: pad }
  ]).png().toBuffer();
  return { buffer, width: fillInfo.width, height: fillInfo.height, pad };
}

async function renderHeadlineElement(attributes, body) {
  const mode = attribute(attributes, 'data-mpvl-font');
  const fontConfig = getMotPhutVoLeHeadlineFont(mode);
  const font = fontConfig.family;
  const fontFile = fontConfig.file;
  const fontSizeValue = attribute(attributes, 'font-size');
  const fontSize = fontSizeValue === null ? Number.NaN : Number(fontSizeValue);
  const centerX = Number(attribute(attributes, 'x'));
  const baseline = Number(attribute(attributes, 'y'));
  const textAnchor = attribute(attributes, 'text-anchor') || 'middle';
  const outline = attribute(attributes, 'stroke') || '#000000';
  const strokeWidth = Number(attribute(attributes, 'stroke-width')) || 0;
  if (!font || !fontFile || !Number.isFinite(fontSize) || fontSize <= 0 || !Number.isFinite(centerX) || !Number.isFinite(baseline)) {
    throw new Error('MPVL headline SVG font metadata is invalid.');
  }
  const spans = [...body.matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/gu)].map((match) => ({
    text: decodeXml(match[2]),
    color: attribute(match[1], 'fill') || '#FFFFFF',
    gap: Number(attribute(match[1], 'dx'))
  }));
  if (!spans.length) return null;
  const nextSpan = spans.find((span) => Number.isFinite(span.gap) && span.gap > 0);
  const spaceWidth = await naturalSpaceWidth(font, fontFile, fontSize);
  const gap = nextSpan?.gap ?? spaceWidth;
  const fillMarkup = pangoMarkup(spans, gap, spaceWidth);
  const outlineMarkup = pangoMarkup(spans, gap, spaceWidth, outline);
  const layer = await outlinedLine(fillMarkup, outlineMarkup, font, fontFile, fontSize, strokeWidth);
  return {
    input: layer.buffer,
    left: Math.round((textAnchor === 'start' ? centerX : textAnchor === 'end' ? centerX - layer.width : centerX - layer.width / 2) - layer.pad),
    top: Math.round(baseline - layer.height - layer.pad)
  };
}

async function renderContentTextElement(attributes, body) {
  const role = attribute(attributes, 'data-mpvl-content-font');
  const fontConfig = CONTENT_FONTS[role];
  const font = fontConfig?.family;
  const fontFile = fontConfig && fs.existsSync(fontConfig.file) ? fontConfig.file : fontConfig?.fallback;
  const fontSizeValue = attribute(attributes, 'font-size');
  const fontSize = fontSizeValue === null ? Number.NaN : Number(fontSizeValue);
  const centerX = Number(attribute(attributes, 'x'));
  const baseline = Number(attribute(attributes, 'y'));
  const textAnchor = attribute(attributes, 'text-anchor') || 'middle';
  const tracking = Number(attribute(attributes, 'data-mpvl-letter-spacing')) || 0;
  if (!font || !fontFile || !Number.isFinite(fontSize) || fontSize <= 0 || !Number.isFinite(centerX) || !Number.isFinite(baseline)) {
    throw new Error('MPVL content SVG font metadata is invalid.');
  }
  const spans = [...body.matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/gu)].map((match) => ({
    text: decodeXml(match[2]),
    color: attribute(match[1], 'fill') || '#080808',
    gap: Number(attribute(match[1], 'dx'))
  }));
  if (!spans.length) return null;
  const nextSpan = spans.find((span) => Number.isFinite(span.gap) && span.gap > 0);
  const spaceWidth = await naturalSpaceWidth(font, fontFile, fontSize);
  const gap = nextSpan?.gap ?? spaceWidth;
  const markup = pangoMarkup(spans, gap, spaceWidth, null, tracking, true);
  const buffer = await renderText(markup, font, fontFile, fontSize);
  const info = await sharp(buffer).metadata();
  return {
    input: buffer,
    left: Math.round(textAnchor === 'start' ? centerX : textAnchor === 'end' ? centerX - info.width : centerX - info.width / 2),
    top: Math.round(baseline - info.height)
  };
}

async function renderBrandElement(attributes, body) {
  const fontConfig = getMotPhutVoLeHeadlineFont(attribute(attributes, 'data-mpvl-brand-font'));
  const font = fontConfig.family;
  const fontFile = fontConfig.file;
  const fontSizeValue = attribute(attributes, 'font-size');
  const fontSize = fontSizeValue === null ? Number.NaN : Number(fontSizeValue);
  const centerX = Number(attribute(attributes, 'x'));
  const baseline = Number(attribute(attributes, 'y'));
  const textAnchor = attribute(attributes, 'text-anchor') || 'middle';
  const tracking = Number(attribute(attributes, 'data-mpvl-letter-spacing')) || 0;
  if (!font || !fontFile || !Number.isFinite(fontSize) || fontSize <= 0 || !Number.isFinite(centerX) || !Number.isFinite(baseline)) {
    throw new Error('MPVL brand SVG font metadata is invalid.');
  }
  const spans = [...body.matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/gu)].map((match) => ({
    text: decodeXml(match[2]),
    color: attribute(match[1], 'fill') || '#22211F',
    gap: Number(attribute(match[1], 'dx'))
  }));
  if (!spans.length) return null;
  const nextSpan = spans.find((span) => Number.isFinite(span.gap) && span.gap > 0);
  const spaceWidth = await naturalSpaceWidth(font, fontFile, fontSize);
  const gap = nextSpan?.gap ?? spaceWidth;
  const markup = pangoMarkup(spans, gap, spaceWidth, null, tracking, true);
  const buffer = await renderText(markup, font, fontFile, fontSize);
  const info = await sharp(buffer).metadata();
  return {
    input: buffer,
    left: Math.round(textAnchor === 'start' ? centerX : textAnchor === 'end' ? centerX - info.width : centerX - info.width / 2),
    top: Math.round(baseline - info.height)
  };
}

export async function renderMotPhutVoLeThumbnailSvg(svg) {
  const overlays = [];
  const backgroundSvg = String(svg).replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/gu, (element, attributes, body) => {
    if (attribute(attributes, 'data-mpvl-brand-font')) overlays.push(renderBrandElement(attributes, body));
    else if (attribute(attributes, 'data-mpvl-content-text')) overlays.push(renderContentTextElement(attributes, body));
    else if (attribute(attributes, 'data-mpvl-headline-line') || attribute(attributes, 'data-mpvl-body-line')) overlays.push(renderHeadlineElement(attributes, body));
    else return element;
    return '';
  });
  if (!overlays.length) return sharp(Buffer.from(svg)).png({ compressionLevel: 7 }).toBuffer();
  const [background, ...textLayers] = await Promise.all([
    sharp(Buffer.from(backgroundSvg)).png({ compressionLevel: 7 }).toBuffer(),
    ...overlays
  ]);
  return sharp(background).composite(textLayers.filter(Boolean)).png({ compressionLevel: 7 }).toBuffer();
}
