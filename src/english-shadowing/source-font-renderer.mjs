import path from 'node:path';
import sharp from 'sharp';
import { ROOT } from '../config.mjs';

const FONT_FILES = Object.freeze({
  display: path.join(ROOT, 'public', 'fonts', 'render', 'LilitaOne-Regular.ttf'),
  serif: path.join(ROOT, 'public', 'fonts', 'render', 'Tinos-Bold.ttf')
});
const FONT_FAMILIES = Object.freeze({ display: 'Lilita One', serif: 'Tinos Bold' });
const spaceWidthCache = new Map();

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

function pangoMarkup(spans, gap, spaceWidth, colorOverride = null) {
  const extraSpacePx = Math.max(0, gap - spaceWidth);
  const letterSpacing = Math.round(extraSpacePx * 1024);
  return spans.map((span, index) => (
    `<span foreground="${colorOverride || span.color}">${escapePango(span.text)}</span>`
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
    throw new Error('Shadowing headline fill and outline metrics do not match.');
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
  const mode = attribute(attributes, 'data-source-font');
  const font = FONT_FAMILIES[mode];
  const fontFile = FONT_FILES[mode];
  const fontSize = Number(attribute(attributes, 'font-size'));
  const centerX = Number(attribute(attributes, 'x'));
  const baseline = Number(attribute(attributes, 'y'));
  const outline = attribute(attributes, 'stroke') || '#000000';
  const strokeWidth = Number(attribute(attributes, 'stroke-width')) || 0;
  if (!font || !fontFile || !Number.isFinite(fontSize) || !Number.isFinite(centerX) || !Number.isFinite(baseline)) {
    throw new Error('Shadowing headline SVG font metadata is invalid.');
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
    left: Math.round(centerX - layer.width / 2 - layer.pad),
    top: Math.round(baseline - layer.height - layer.pad)
  };
}

export async function renderSourceDesignSvg(svg) {
  const overlays = [];
  const backgroundSvg = String(svg).replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/gu, (element, attributes, body) => {
    if (!attribute(attributes, 'data-source-headline-line')) return element;
    overlays.push(renderHeadlineElement(attributes, body));
    return '';
  });
  if (!overlays.length) return sharp(Buffer.from(svg)).png({ compressionLevel: 7 }).toBuffer();
  const [background, ...textLayers] = await Promise.all([
    sharp(Buffer.from(backgroundSvg)).png({ compressionLevel: 7 }).toBuffer(),
    ...overlays
  ]);
  return sharp(background).composite(textLayers.filter(Boolean)).png({ compressionLevel: 7 }).toBuffer();
}
