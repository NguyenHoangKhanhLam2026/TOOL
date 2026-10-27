import { renderBackgroundEffectMarkup } from '../../packages/video-engine/background-effects.mjs';

const WIDTH = 1080;
const HEIGHT = 1920;

function thingsBackgroundEffect(effects = {}, seconds = 0) {
  return renderBackgroundEffectMarkup(effects.backgroundEffect || 'none', {
    width: WIDTH, height: HEIGHT, time: seconds, seed: 'things-you-didnt-know',
    density: effects.backgroundEffectDensity, speed: effects.backgroundEffectSpeed,
    opacity: effects.backgroundEffectOpacity, contentLanguage: 'en'
  });
}

const xml = (value) => String(value ?? '').replace(/[&<>"']/gu, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
})[character]);

const plainWord = (value) => String(value ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

function estimateTextWidth(value, fontSize) {
  let units = 0;
  for (const character of String(value ?? '')) {
    if (/\s/u.test(character)) units += 0.28;
    else if (/[ilI.,'`:;!|]/u.test(character)) units += 0.28;
    else if (/[mwMW@%&]/u.test(character)) units += 0.82;
    else if (/[A-Z0-9]/u.test(character)) units += 0.62;
    else units += 0.52;
  }
  return units * fontSize;
}

function wrapWords(words, maxWidth, fontSize) {
  const lines = [];
  let line = [];
  let width = 0;
  for (const word of words) {
    const next = width + (line.length ? estimateTextWidth(' ', fontSize) : 0) + estimateTextWidth(word.text, fontSize);
    if (line.length && next > maxWidth) {
      lines.push(line);
      line = [];
      width = 0;
    }
    line.push(word);
    width += (line.length > 1 ? estimateTextWidth(' ', fontSize) : 0) + estimateTextWidth(word.text, fontSize);
  }
  if (line.length) lines.push(line);
  return lines;
}

function posterLines(words) {
  const count = Math.min(words.length, words.length >= 7 ? 4 : 3);
  const lines = [];
  let taken = 0;
  for (let line = 0; line < count; line += 1) {
    const size = Math.ceil((words.length - taken) / (count - line));
    lines.push(words.slice(taken, taken + size));
    taken += size;
  }
  return lines;
}

function paperDefs({ seed, vignette, bottomShade = 0, dark = 0.3 }) {
  return `<filter id="paperGrain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9 0.5" numOctaves="3" seed="${seed}"/><feColorMatrix type="matrix" values="0 0 0 0 ${dark} 0 0 0 0 ${dark} 0 0 0 0 ${dark} 0 0 0 0.55 -0.12"/></filter>
  <filter id="paperStains" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.004 0.006" numOctaves="2" seed="${seed + 7}"/><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1.4 -0.45"/></filter>
  <radialGradient id="paperVignette" cx="50%" cy="45%" r="71%"><stop offset="55%" stop-color="#000000" stop-opacity="0"/><stop offset="100%" stop-color="#3C230A" stop-opacity="${vignette}"/></radialGradient>
  ${bottomShade > 0 ? `<linearGradient id="paperBottomShade" x1="0" y1="0" x2="0" y2="1"><stop offset="50%" stop-color="#3C230A" stop-opacity="0"/><stop offset="100%" stop-color="#3C230A" stop-opacity="${bottomShade}"/></linearGradient>` : ''}`;
}

function paperMarkup(base, { seed, vignette, bottomShade = 0, dark = 0.3 }) {
  return `<rect width="${WIDTH}" height="${HEIGHT}" fill="${base}"/>
  <rect width="${WIDTH}" height="${HEIGHT}" filter="url(#paperStains)" opacity=".3"/>
  <rect width="${WIDTH}" height="${HEIGHT}" filter="url(#paperGrain)" opacity=".5"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#paperVignette)"/>
  ${bottomShade > 0 ? `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#paperBottomShade)"/>` : ''}`;
}

function sourceFont(font) {
  if (font === 'display') return "'Lilita One', Impact, sans-serif";
  if (font === 'sans') return 'Arial, Helvetica, sans-serif';
  return "'Tinos', Georgia, serif";
}

function fitThumbnailHeadline(words, style) {
  const lines = posterLines(words);
  const roomWidth = WIDTH * style.headlineWidthPct / 100;
  const roomHeight = HEIGHT * style.headlineHeightPct / 100;
  const min = Math.min(40, style.headlineMaxPx);
  const fits = (size) => lines.every((line) => estimateTextWidth(line.join(' '), size) <= roomWidth)
    && lines.length * size * 1.02 <= roomHeight;
  if (!fits(min)) return { lines, size: min, fits: false };
  let low = min;
  let high = style.headlineMaxPx;
  while (high - low > 0.5) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return { lines, size: low, fits: true };
}

export function buildSourceThumbnailSvg(script, style, { editorMode = false, brand = 'Things You Didn\'t Know', headline, highlight } = {}) {
  const sourceHeadline = String(headline ?? script?.thumbnailTitle ?? script?.title ?? '').trim().slice(0, 120);
  const shownHeadline = style.headlineCase === 'uppercase' ? sourceHeadline.toLocaleUpperCase() : sourceHeadline;
  const brandWords = String(brand || 'Things You Didn\'t Know').split(/\s+/u).filter(Boolean);
  const split = Math.ceil(brandWords.length / 2);
  const words = shownHeadline.split(/\s+/u).filter(Boolean);
  const lines = posterLines(words);
  const marked = new Set((Array.isArray(highlight) ? highlight : String(highlight ?? '').split(/\s+/u)).flatMap((word) => String(word).split(/\s+/u)).map(plainWord));
  const fit = fitThumbnailHeadline(words, style);
  const fontSize = fit.size;
  const lineHeight = fontSize * 1.02;
  const boxLeft = WIDTH * style.headlineLeftPct / 100;
  const boxTop = HEIGHT * style.headlineTopPct / 100;
  const boxWidth = WIDTH * style.headlineWidthPct / 100;
  const boxHeight = HEIGHT * style.headlineHeightPct / 100;
  const firstBaseline = boxTop + (boxHeight - lines.length * lineHeight) / 2 + fontSize;
  const titleMarkup = lines.map((line, lineIndex) => {
    const wordGap = estimateTextWidth(' ', fontSize);
    const content = line.map((word, wordIndex) => `<tspan${wordIndex ? ` dx="${wordGap}"` : ''} fill="${marked.has(plainWord(word)) ? style.highlightColor : style.textColor}">${xml(word)}</tspan>`).join('');
    return `<text data-source-headline-line="${lineIndex}" data-source-font="${style.headlineFont}" x="${boxLeft + boxWidth / 2}" y="${firstBaseline + lineIndex * lineHeight}" text-anchor="middle" font-family="${sourceFont(style.headlineFont)}" font-size="${fontSize}" font-weight="${style.headlineFont === 'display' ? 400 : 700}" stroke="${style.outlineColor}" stroke-width="${fontSize * 0.07}" stroke-linejoin="round" paint-order="stroke fill" filter="url(#headlineShadow)">${content}</text>`;
  }).join('');
  const brandGap = estimateTextWidth(' ', style.brandSizePx);
  const brandMarkup = `<text data-source-brand="top" x="${WIDTH * style.brandCenterXPct / 100}" y="${HEIGHT * style.brandTopPct / 100 + style.brandSizePx}" text-anchor="middle" font-family="${sourceFont('serif')}" font-size="${style.brandSizePx}" font-weight="700"><tspan fill="${style.brandColorA}">${xml(brandWords.slice(0, split).join(' '))}</tspan><tspan${brandWords.length > split ? ` dx="${brandGap}"` : ''} fill="${style.brandColorB}">${xml(brandWords.slice(split).join(' '))}</tspan></text>`;
  const box = editorMode ? `<metadata data-fit="${fit.fits}" data-size="${Math.round(fontSize)}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" data-design-kind="thumbnail" data-fit="${fit.fits}" data-size="${Math.round(fontSize)}">
  <defs>${paperDefs({ seed: 21, vignette: style.vignette, bottomShade: style.bottomShade })}<filter id="headlineShadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#281405" flood-opacity=".45"/></filter></defs>
  ${paperMarkup(style.paperColor, { seed: 21, vignette: style.vignette, bottomShade: style.bottomShade })}
  ${brandMarkup}${titleMarkup}${box}
</svg>`;
}
function splitSentences(textValue, tokens) {
  const sentences = String(textValue ?? '').trim().split(/(?<=[.!?])\s+/u).filter(Boolean);
  if (sentences.length <= 1) return [tokens];
  let cursor = 0;
  const paragraphs = sentences.map((sentence) => {
    const count = (sentence.match(/\S+/gu) || []).length;
    const paragraph = tokens.slice(cursor, cursor + count);
    cursor += count;
    return paragraph;
  }).filter((paragraph) => paragraph.length);
  return cursor === tokens.length ? paragraphs : [tokens];
}

function layoutContent(title, paragraphs, style, tokens) {
  const roomWidth = WIDTH * style.contentWidthPct / 100;
  const roomHeight = HEIGHT * style.contentHeightPct / 100;
  const titleWords = String(title ?? '').split(/\s+/u).filter(Boolean).map((text, index) => ({ id: `title:${index}`, text }));
  for (let size = style.bodyMaxPx; size >= 22; size -= 1) {
    const titleSize = size * 1.45;
    const titleLines = wrapWords(titleWords, roomWidth, titleSize);
    const paragraphLines = paragraphs.map((paragraph) => wrapWords(paragraph, roomWidth, size));
    const titleHeight = titleLines.length * titleSize * 1.1;
    const bodyHeight = paragraphLines.reduce((sum, lines) => sum + lines.length * size * 1.45, 0)
      + Math.max(0, paragraphLines.length - 1) * size * 0.8;
    const totalHeight = titleHeight + size * 0.9 + bodyHeight;
    const titleTooWide = titleLines.some((line) => estimateTextWidth(line.map((word) => word.text).join(' '), titleSize) > roomWidth + 1);
    const bodyTooWide = paragraphLines.flat().some((line) => estimateTextWidth(line.map((word) => word.text).join(' '), size) > roomWidth + 1);
    if (totalHeight <= roomHeight && !titleTooWide && !bodyTooWide) {
      return { size, titleSize, titleLines, paragraphLines, totalHeight, fits: true, tokens };
    }
  }
  const size = 22;
  const titleSize = size * 1.45;
  const titleLines = wrapWords(titleWords, roomWidth, titleSize);
  const paragraphLines = paragraphs.map((paragraph) => wrapWords(paragraph, roomWidth, size));
  const titleHeight = titleLines.length * titleSize * 1.1;
  const bodyHeight = paragraphLines.reduce((sum, lines) => sum + lines.length * size * 1.45, 0)
    + Math.max(0, paragraphLines.length - 1) * size * 0.8;
  return { size, titleSize, titleLines, paragraphLines, totalHeight: titleHeight + size * 0.9 + bodyHeight, fits: false, tokens };
}

function layoutIndependentContent(title, paragraphs, style) {
  const titleWidth = WIDTH * style.contentTitleWidthPct / 100;
  const titleHeight = HEIGHT * style.contentTitleHeightPct / 100;
  const bodyWidth = WIDTH * style.contentWidthPct / 100;
  const bodyHeightLimit = HEIGHT * style.contentHeightPct / 100;
  const titleWords = String(title ?? '').split(/\s+/u).filter(Boolean).map((text, index) => ({ id: `title:${index}`, text }));
  let titleLayout = null;
  for (let size = style.contentTitleMaxPx; size >= 22; size -= 1) {
    const lines = wrapWords(titleWords, titleWidth, size);
    const height = lines.length * size * 1.1;
    const fitsWidth = lines.every((line) => estimateTextWidth(line.map((word) => word.text).join(' '), size) <= titleWidth + 1);
    if (fitsWidth && height <= titleHeight) { titleLayout = { size, lines, height, fits: true }; break; }
  }
  if (!titleLayout) {
    const size = 22;
    const lines = wrapWords(titleWords, titleWidth, size);
    titleLayout = { size, lines, height: lines.length * size * 1.1, fits: false };
  }

  let bodyLayout = null;
  for (let size = style.bodyMaxPx; size >= 22; size -= 1) {
    const lines = paragraphs.map((paragraph) => wrapWords(paragraph, bodyWidth, size));
    const height = lines.reduce((sum, paragraphLines) => sum + paragraphLines.length * size * 1.45, 0)
      + Math.max(0, lines.length - 1) * size * 0.8;
    const fitsWidth = lines.flat().every((line) => estimateTextWidth(line.map((word) => word.text).join(' '), size) <= bodyWidth + 1);
    if (fitsWidth && height <= bodyHeightLimit) { bodyLayout = { size, lines, height, fits: true }; break; }
  }
  if (!bodyLayout) {
    const size = 22;
    const lines = paragraphs.map((paragraph) => wrapWords(paragraph, bodyWidth, size));
    const height = lines.reduce((sum, paragraphLines) => sum + paragraphLines.length * size * 1.45, 0)
      + Math.max(0, lines.length - 1) * size * 0.8;
    bodyLayout = { size, lines, height, fits: false };
  }
  return { titleLayout, bodyLayout, fits: titleLayout.fits && bodyLayout.fits };
}

const ARIAL_BOLD_WIDTHS = Object.freeze({
  a: 0.556, b: 0.611, c: 0.556, d: 0.611, e: 0.556, f: 0.333, g: 0.611, h: 0.611, i: 0.278, j: 0.278,
  k: 0.556, l: 0.278, m: 0.889, n: 0.611, o: 0.611, p: 0.611, q: 0.611, r: 0.389, s: 0.5, t: 0.333,
  u: 0.611, v: 0.556, w: 0.778, x: 0.556, y: 0.556, z: 0.5,
  A: 0.667, B: 0.667, C: 0.722, D: 0.722, E: 0.611, F: 0.556, G: 0.778, H: 0.722, I: 0.278, J: 0.5,
  K: 0.667, L: 0.556, M: 0.833, N: 0.722, O: 0.778, P: 0.611, Q: 0.778, R: 0.667, S: 0.556, T: 0.611,
  U: 0.722, V: 0.667, W: 0.944, X: 0.667, Y: 0.667, Z: 0.611,
  '0': 0.611, '1': 0.611, '2': 0.611, '3': 0.611, '4': 0.611, '5': 0.611, '6': 0.611, '7': 0.611, '8': 0.611, '9': 0.611,
  '.': 0.278, ',': 0.278, ':': 0.333, ';': 0.333, '!': 0.333, '?': 0.5, "'": 0.222, '’': 0.222, '‘': 0.222,
  '"': 0.333, '“': 0.333, '”': 0.333, '-': 0.333, '–': 0.556, '—': 1, '(': 0.333, ')': 0.333,
  '[': 0.333, ']': 0.333, '/': 0.333, '&': 0.722, '%': 0.889, '+': 0.584, '=': 0.584, '$': 0.611,
  '#': 0.611, '*': 0.389, '_': 0.611
});

function estimateArialBoldWidth(value, fontSize) {
  let units = 0;
  for (const character of String(value ?? '')) {
    if (/\p{M}/u.test(character)) continue;
    if (/\s/u.test(character)) { units += 0.28; continue; }
    const decomposed = character.normalize('NFD').replace(/\p{M}/gu, '');
    for (const base of decomposed) units += ARIAL_BOLD_WIDTHS[base] ?? (/\p{L}/u.test(base) ? 0.611 : 0.556);
  }
  return units * fontSize;
}

function estimateBodyWordWidth(value, fontSize, font) {
  return font === 'sans' ? estimateArialBoldWidth(value, fontSize) : estimateTextWidth(value, fontSize);
}

function wrapBodyWords(words, maxWidth, fontSize, wordSpacingEm, font) {
  const gap = fontSize * wordSpacingEm;
  const lines = [];
  let line = [];
  let width = 0;
  for (const word of words) {
    const wordWidth = estimateBodyWordWidth(word.text, fontSize, font);
    const next = width + (line.length ? gap : 0) + wordWidth;
    if (line.length && next > maxWidth) {
      lines.push(line);
      line = [];
      width = 0;
    }
    if (line.length) width += gap;
    line.push(word);
    width += wordWidth;
  }
  if (line.length) lines.push(line);
  return lines;
}

function layoutIndependentTitle(title, style) {
  const titleWidth = WIDTH * style.contentTitleWidthPct / 100;
  const titleHeight = HEIGHT * style.contentTitleHeightPct / 100;
  const titleWords = String(title ?? '').split(/\s+/u).filter(Boolean).map((text, index) => ({ id: `title:${index}`, text }));
  for (let size = style.contentTitleMaxPx; size >= 22; size -= 1) {
    const lines = wrapWords(titleWords, titleWidth, size);
    if (lines.length !== 1) continue;
    const height = lines.length * size * 1.1;
    const fitsWidth = lines.every((line) => estimateTextWidth(line.map((word) => word.text).join(' '), size) <= titleWidth + 1);
    if (fitsWidth && height <= titleHeight) return { size, lines, height, fits: true };
  }
  const size = 22;
  const lines = [titleWords];
  return { size, lines, height: lines.length * size * 1.1, fits: false };
}

function layoutThingsBody(words, style) {
  const bodyWidth = WIDTH * style.contentWidthPct / 100;
  const bodyHeightLimit = HEIGHT * style.contentHeightPct / 100;
  const lineSpacing = style.bodyLineSpacing;
  const wordSpacingEm = style.bodyWordSpacingEm;
  for (let size = style.bodyMaxPx; size >= 22; size -= 1) {
    const lines = wrapBodyWords(words, bodyWidth, size, wordSpacingEm, style.bodyFont);
    const height = lines.length * size * lineSpacing;
    const fitsWidth = lines.every((line) => line.reduce((sum, word) => sum + estimateBodyWordWidth(word.text, size, style.bodyFont), 0)
      + Math.max(0, line.length - 1) * size * wordSpacingEm <= bodyWidth + 1);
    if (fitsWidth && height <= bodyHeightLimit) return { size, lines, height, fits: true };
  }
  const size = 22;
  const lines = wrapBodyWords(words, bodyWidth, size, wordSpacingEm, style.bodyFont);
  return { size, lines, height: lines.length * size * lineSpacing, fits: false };
}

function buildThingsSourceContentSvg({ script, tokens, activeTokenIds, style, highlightSettings, brand, effects, seconds, editorMode }) {
  const title = String(script?.title ?? '').trim();
  const titleLayout = layoutIndependentTitle(title, style);
  if (!titleLayout.fits) throw Object.assign(new Error('Title Things cần tối đa 5 từ và phải vừa trên một dòng.'), { code: 'TYDK_TITLE_LAYOUT' });
  const words = (tokens.length ? tokens : (String(script?.scriptText ?? '').match(/\S+/gu) || []).map((text, index) => ({ id: `things-body:${index}`, text })))
    .map((word, index) => ({ id: word.id ?? `things-body:${index}`, text: String(word.text ?? '') }))
    .filter((word) => word.text);
  const hasTimedTokens = tokens.length > 0;
  const bodyLayout = layoutThingsBody(words, style);

  const titleLeft = WIDTH * style.contentTitleLeftPct / 100;
  const titleTop = HEIGHT * style.contentTitleTopPct / 100;
  const titleWidth = WIDTH * style.contentTitleWidthPct / 100;
  const titleHeight = HEIGHT * style.contentTitleHeightPct / 100;
  const titleCenterX = titleLeft + titleWidth / 2;
  const titleFirstBaseline = titleTop + (titleHeight - titleLayout.height) / 2 + titleLayout.size * 0.9;
  const titleMarkup = titleLayout.lines.map((line, lineIndex) => {
    const gap = estimateTextWidth(' ', titleLayout.size);
    const spans = line.map((word, wordIndex) => `<tspan${wordIndex ? ` dx="${gap}"` : ''}>${xml(word.text)}</tspan>`).join('');
    return `<text data-source-layer="content-title" x="${titleCenterX}" y="${titleFirstBaseline + lineIndex * titleLayout.size * 1.1}" text-anchor="middle" font-family="${sourceFont(style.contentTitleFont)}" font-size="${titleLayout.size}" font-weight="700" fill="${style.bodyColor}">${spans}</text>`;
  }).join('');

  const bodyLeft = WIDTH * style.contentLeftPct / 100;
  const bodyWidth = WIDTH * style.contentWidthPct / 100;
  const centerX = bodyLeft + bodyWidth / 2;
  const bodyTop = HEIGHT * style.contentTopPct / 100;
  const lineSpacing = style.bodyLineSpacing;
  const gap = bodyLayout.size * style.bodyWordSpacingEm;
  const active = new Set(highlightSettings?.highlightEnabled === true ? activeTokenIds : []);
  const requestedColor = String(highlightSettings?.highlightColor || '#FF8066');
  const markerColor = /^#[\da-f]{6}$/iu.test(requestedColor) ? requestedColor : '#FF8066';
  const textColorOnly = highlightSettings?.highlightStyle === 'text-color';
  const paddingValue = Number(highlightSettings?.highlightPadding ?? 6);
  const padding = Number.isFinite(paddingValue) ? Math.max(0, Math.min(24, paddingValue)) : 6;
  const radiusValue = Number(highlightSettings?.highlightRadius ?? 8);
  const radius = Number.isFinite(radiusValue) ? Math.max(0, Math.min(32, radiusValue)) : 8;
  const bodyParts = [];
  const markerParts = [];
  let tokenCursor = 0;
  for (const [lineIndex, line] of bodyLayout.lines.entries()) {
    const baseline = bodyTop + bodyLayout.size * 0.9 + lineIndex * bodyLayout.size * lineSpacing;
    const lineItems = line.map((word) => {
      const token = hasTimedTokens ? tokens[tokenCursor++] : word;
      return { text: word.text, tokenId: token?.id, width: estimateBodyWordWidth(word.text, bodyLayout.size, style.bodyFont) };
    });
    const lineWidth = lineItems.reduce((sum, item) => sum + item.width, 0) + Math.max(0, lineItems.length - 1) * gap;
    let x = centerX - lineWidth / 2;
    lineItems.forEach((item, itemIndex) => {
      item.x = x;
      x += item.width + gap;
    });
    lineItems.forEach((item, itemIndex) => {
      const on = Boolean(item.tokenId && active.has(item.tokenId));
      if (on && !textColorOnly) {
        const previous = lineItems.slice(0, itemIndex).filter((entry) => !active.has(entry.tokenId)).at(-1);
        const next = lineItems.slice(itemIndex + 1).find((entry) => !active.has(entry.tokenId));
        const leftGap = previous ? item.x - (previous.x + previous.width) : Infinity;
        const rightGap = next ? next.x - (item.x + item.width) : Infinity;
        const padLeft = Math.min(padding, Number.isFinite(leftGap) ? Math.max(0, leftGap / 2 - 0.5) : padding);
        const padRight = Math.min(padding, Number.isFinite(rightGap) ? Math.max(0, rightGap / 2 - 0.5) : padding);
        const glyphTop = baseline - bodyLayout.size * 0.8;
        const glyphHeight = bodyLayout.size * 0.9;
        markerParts.push(`<rect x="${item.x - padLeft}" y="${glyphTop - padding}" width="${Math.max(1, item.width + padLeft + padRight)}" height="${glyphHeight + padding * 2}" rx="${radius}" fill="${markerColor}"/>`);
      }
    });
    const spans = lineItems.map((item, itemIndex) => {
      const on = Boolean(item.tokenId && active.has(item.tokenId));
      const textColor = on ? (textColorOnly ? markerColor : '#FFFFFF') : style.bodyColor;
      return `<tspan${itemIndex ? ` dx="${gap}"` : ''} fill="${textColor}">${xml(item.text)}</tspan>`;
    }).join('');
    bodyParts.push(`<text data-source-layer="content-body" x="${centerX}" y="${baseline}" text-anchor="middle" font-family="${sourceFont(style.bodyFont)}" font-size="${bodyLayout.size}" font-weight="700" fill="${style.bodyColor}">${spans}</text>`);
  }

  const brandTop = HEIGHT * style.brandTopPct / 100;
  const brandTopText = `<text data-source-brand="top" data-source-layer="brand" x="${WIDTH * style.brandCenterXPct / 100}" y="${brandTop + style.brandSizePx * 0.92}" text-anchor="middle" font-family="${sourceFont('serif')}" font-size="${style.brandSizePx}" font-weight="700" fill="${style.brandColor}">${xml(brand)}</text>`;
  const footerBaseline = HEIGHT * style.footerTopPct / 100 + style.footerSizePx * 0.92;
  const footerText = `<text data-source-brand="bottom" data-source-layer="footer" x="${WIDTH * style.footerCenterXPct / 100}" y="${footerBaseline}" text-anchor="middle" font-family="${sourceFont('serif')}" font-size="${style.footerSizePx}" font-weight="700" fill="${style.brandColor}">@${xml(brand)}</text>`;
  const fit = titleLayout.fits && bodyLayout.fits ? 'true' : 'false';
  const effectMarkup = thingsBackgroundEffect(effects, seconds);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" data-design-kind="content" data-schema-version="5" data-fit="${fit}" data-size="${bodyLayout.size}">
  <defs>${paperDefs({ seed: 3, vignette: style.vignette, dark: 0.35 })}</defs>
  ${paperMarkup(style.paperColor, { seed: 3, vignette: style.vignette, dark: 0.35 })}
  ${effectMarkup}
  ${brandTopText}${titleMarkup}${markerParts.join('')}${bodyParts.join('')}${footerText}
  ${editorMode ? `<metadata data-fit="${fit}" data-size="${bodyLayout.size}"/>` : ''}
</svg>`;
}

function buildIndependentSourceContentSvg({ script, tokens, activeTokenIds, style, highlightSettings, brand, effects, seconds, editorMode }) {
  const paragraphs = splitSentences(script?.scriptText, tokens);
  const title = String(script?.title ?? '').trim();
  const layout = layoutIndependentContent(title, paragraphs, style);
  const titleLeft = WIDTH * style.contentTitleLeftPct / 100;
  const titleTop = HEIGHT * style.contentTitleTopPct / 100;
  const titleWidth = WIDTH * style.contentTitleWidthPct / 100;
  const titleHeight = HEIGHT * style.contentTitleHeightPct / 100;
  const titleCenterX = titleLeft + titleWidth / 2;
  const titleFirstBaseline = titleTop + (titleHeight - layout.titleLayout.height) / 2 + layout.titleLayout.size * 0.9;
  const titleMarkup = layout.titleLayout.lines.map((line, lineIndex) => {
    const gap = estimateTextWidth(' ', layout.titleLayout.size);
    const words = line.map((word, wordIndex) => `<tspan${wordIndex ? ` dx="${gap}"` : ''}>${xml(word.text)}</tspan>`).join('');
    return `<text data-source-layer="content-title" x="${titleCenterX}" y="${titleFirstBaseline + lineIndex * layout.titleLayout.size * 1.1}" text-anchor="middle" font-family="${sourceFont(style.bodyFont)}" font-size="${layout.titleLayout.size}" font-weight="700" fill="${style.bodyColor}">${words}</text>`;
  }).join('');

  const bodyLeft = WIDTH * style.contentLeftPct / 100;
  const bodyTop = HEIGHT * style.contentTopPct / 100;
  let cursorY = bodyTop + layout.bodyLayout.size * 0.9;
  const active = new Set(highlightSettings?.highlightEnabled === true ? activeTokenIds : []);
  const requestedColor = String(highlightSettings?.highlightColor || '#FF8066');
  const markerColor = /^#[\da-f]{6}$/iu.test(requestedColor) ? requestedColor : '#FF8066';
  const paddingValue = Number(highlightSettings?.highlightPadding ?? 6);
  const padding = Number.isFinite(paddingValue) ? Math.max(0, Math.min(24, paddingValue)) : 6;
  const radiusValue = Number(highlightSettings?.highlightRadius ?? 8);
  const radius = Number.isFinite(radiusValue) ? Math.max(0, Math.min(32, radiusValue)) : 8;
  const bodyParts = [];
  const markerParts = [];
  let tokenCursor = 0;
  for (let paragraphIndex = 0; paragraphIndex < layout.bodyLayout.lines.length; paragraphIndex += 1) {
    const lines = layout.bodyLayout.lines[paragraphIndex];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const baseline = cursorY + lineIndex * layout.bodyLayout.size * 1.45;
      let x = bodyLeft;
      const lineItems = line.map((word, wordIndex) => {
        const token = word.id ? word : tokens[tokenCursor++];
        const width = estimateTextWidth(word.text, layout.bodyLayout.size);
        const item = { text: word.text, tokenId: token?.id, x, width };
        x += width + (wordIndex < line.length - 1 ? estimateTextWidth(' ', layout.bodyLayout.size) : 0);
        return item;
      });
      lineItems.forEach((item, itemIndex) => {
        const on = Boolean(item.tokenId && active.has(item.tokenId));
        if (on) {
          const previous = lineItems.slice(0, itemIndex).filter((entry) => !active.has(entry.tokenId)).at(-1);
          const next = lineItems.slice(itemIndex + 1).find((entry) => !active.has(entry.tokenId));
          const leftGap = previous ? item.x - (previous.x + previous.width) : Infinity;
          const rightGap = next ? next.x - (item.x + item.width) : Infinity;
          const padLeft = Math.min(padding, Number.isFinite(leftGap) ? Math.max(0, leftGap / 2 - 0.5) : padding);
          const padRight = Math.min(padding, Number.isFinite(rightGap) ? Math.max(0, rightGap / 2 - 0.5) : padding);
          const glyphTop = baseline - layout.bodyLayout.size * 0.8;
          const glyphHeight = layout.bodyLayout.size * 0.9;
          markerParts.push(`<rect x="${item.x - padLeft}" y="${glyphTop - padding}" width="${Math.max(1, item.width + padLeft + padRight)}" height="${glyphHeight + padding * 2}" rx="${radius}" fill="${markerColor}"/>`);
        }
        bodyParts.push(`<text data-source-layer="content-body" x="${item.x}" y="${baseline}" font-family="${sourceFont(style.bodyFont)}" font-size="${layout.bodyLayout.size}" fill="${on ? '#FFFFFF' : style.bodyColor}"${on ? ' font-weight="700"' : ''}>${xml(item.text)}</text>`);
      });
    }
    cursorY += lines.length * layout.bodyLayout.size * 1.45;
    if (paragraphIndex < layout.bodyLayout.lines.length - 1) cursorY += layout.bodyLayout.size * 0.8;
  }

  const brandTop = HEIGHT * style.brandTopPct / 100;
  const brandTopText = `<text data-source-brand="top" data-source-layer="brand" x="${WIDTH * style.brandCenterXPct / 100}" y="${brandTop + style.brandSizePx * 0.92}" text-anchor="middle" font-family="${sourceFont('serif')}" font-size="${style.brandSizePx}" font-weight="700" fill="${style.brandColor}">${xml(brand)}</text>`;
  const footerBaseline = HEIGHT * style.footerTopPct / 100 + style.footerSizePx * 0.92;
  const footerText = `<text data-source-brand="bottom" data-source-layer="footer" x="${WIDTH * style.footerCenterXPct / 100}" y="${footerBaseline}" text-anchor="middle" font-family="${sourceFont('serif')}" font-size="${style.footerSizePx}" font-weight="700" fill="${style.brandColor}">@${xml(brand)}</text>`;
  const fit = layout.fits ? 'true' : 'false';
  const effectMarkup = thingsBackgroundEffect(effects, seconds);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" data-design-kind="content" data-schema-version="4" data-fit="${fit}" data-size="${layout.bodyLayout.size}">
  <defs>${paperDefs({ seed: 3, vignette: style.vignette, dark: 0.35 })}</defs>
  ${paperMarkup(style.paperColor, { seed: 3, vignette: style.vignette, dark: 0.35 })}
  ${effectMarkup}
  ${brandTopText}${titleMarkup}${markerParts.join('')}${bodyParts.join('')}${footerText}
  ${editorMode ? `<metadata data-fit="${fit}" data-size="${layout.bodyLayout.size}"/>` : ''}
</svg>`;
}

export function buildSourceContentSvg({ script, tokens = [], activeTokenIds = [], style, highlightSettings = null, effects = {}, seconds = 0, brand = 'Things You Didn\'t Know', editorMode = false, schemaVersion = 3 }) {
  if (Number(schemaVersion) >= 5) {
    return buildThingsSourceContentSvg({ script, tokens, activeTokenIds, style, highlightSettings, brand, effects, seconds, editorMode });
  }
  if (Number(schemaVersion) >= 4) {
    return buildIndependentSourceContentSvg({ script, tokens, activeTokenIds, style, highlightSettings, brand, effects, seconds, editorMode });
  }
  const allTokens = Array.isArray(tokens) ? tokens : [];
  const paragraphs = splitSentences(script?.scriptText, allTokens);
  const title = String(script?.title ?? '').trim();
  const layout = layoutContent(title, paragraphs, style, allTokens);
  const roomLeft = WIDTH * style.contentLeftPct / 100;
  const roomTop = HEIGHT * style.contentTopPct / 100;
  const roomHeight = HEIGHT * style.contentHeightPct / 100;
  let cursorY = roomTop + (roomHeight - layout.totalHeight) / 2;
  const centerX = roomLeft + WIDTH * style.contentWidthPct / 200;
  const titleMarkup = layout.titleLines.map((line, index) => {
    const baseline = cursorY + layout.titleSize * (index + 0.9);
    const wordsMarkup = line.map((word, wordIndex) => `<tspan>${xml(word.text)}${wordIndex < line.length - 1 ? '&#160;' : ''}</tspan>`).join('');
    return `<text x="${centerX}" y="${baseline}" text-anchor="middle" font-family="${sourceFont(style.bodyFont)}" font-size="${layout.titleSize}" font-weight="700" fill="${style.bodyColor}">${wordsMarkup}</text>`;
  }).join('');
  cursorY += layout.titleSize * 1.1 * layout.titleLines.length + layout.size * 0.9;

  const active = new Set(highlightSettings?.highlightEnabled === true ? activeTokenIds : []);
  const requestedColor = String(highlightSettings?.highlightColor || '#FF8066');
  const markerColor = /^#[\da-f]{6}$/iu.test(requestedColor) ? requestedColor : '#FF8066';
  const paddingValue = Number(highlightSettings?.highlightPadding ?? 6);
  const padding = Number.isFinite(paddingValue) ? Math.max(0, Math.min(24, paddingValue)) : 6;
  const radiusValue = Number(highlightSettings?.highlightRadius ?? 8);
  const radius = Number.isFinite(radiusValue) ? Math.max(0, Math.min(32, radiusValue)) : 8;
  const bodyParts = [];
  const markerParts = [];
  let tokenCursor = 0;
  for (let paragraphIndex = 0; paragraphIndex < layout.paragraphLines.length; paragraphIndex += 1) {
    const lines = layout.paragraphLines[paragraphIndex];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const baseline = cursorY + layout.size * (0.9 + lineIndex * 1.45);
      let x = roomLeft;
      const lineItems = [];
      for (let wordIndex = 0; wordIndex < line.length; wordIndex += 1) {
        const word = line[wordIndex];
        const token = word.id ? word : allTokens[tokenCursor];
        if (word.id) tokenCursor += 1;
        const width = estimateTextWidth(word.text, layout.size);
        lineItems.push({ text: word.text, tokenId: token?.id, x, width });
        x += width + (wordIndex < line.length - 1 ? estimateTextWidth(' ', layout.size) : 0);
      }
      lineItems.forEach((item, itemIndex) => {
        const on = Boolean(item.tokenId && active.has(item.tokenId));
        if (on) {
          const previous = lineItems.slice(0, itemIndex).filter((entry) => !active.has(entry.tokenId)).at(-1);
          const next = lineItems.slice(itemIndex + 1).find((entry) => !active.has(entry.tokenId));
          const leftGap = previous ? item.x - (previous.x + previous.width) : Infinity;
          const rightGap = next ? next.x - (item.x + item.width) : Infinity;
          const padLeft = Math.min(padding, Number.isFinite(leftGap) ? Math.max(0, leftGap / 2 - 0.5) : padding);
          const padRight = Math.min(padding, Number.isFinite(rightGap) ? Math.max(0, rightGap / 2 - 0.5) : padding);
          const glyphTop = baseline - layout.size * 0.8;
          const glyphHeight = layout.size * 0.9;
          markerParts.push(`<rect x="${item.x - padLeft}" y="${glyphTop - padding}" width="${Math.max(1, item.width + padLeft + padRight)}" height="${glyphHeight + padding * 2}" rx="${radius}" fill="${markerColor}"/>`);
        }
        bodyParts.push(`<text x="${item.x}" y="${baseline}" font-family="${sourceFont(style.bodyFont)}" font-size="${layout.size}" fill="${on ? '#FFFFFF' : style.bodyColor}"${on ? ' font-weight="700"' : ''}>${xml(item.text)}</text>`);
      });
    }
    cursorY += lines.length * layout.size * 1.45;
    if (paragraphIndex < layout.paragraphLines.length - 1) cursorY += layout.size * 0.8;
  }
  const brandTop = HEIGHT * style.brandTopPct / 100;
  const brandTopText = `<text data-source-brand="top" x="${WIDTH * style.brandCenterXPct / 100}" y="${brandTop + style.brandSizePx * 0.92}" text-anchor="middle" font-family="${sourceFont('serif')}" font-size="${style.brandSizePx}" font-weight="700" fill="${style.brandColor}">${xml(brand)}</text>`;
  const brandBottomText = `<text data-source-brand="bottom" x="${WIDTH * style.brandCenterXPct / 100}" y="${HEIGHT - brandTop - style.brandSizePx * 0.24}" text-anchor="middle" font-family="${sourceFont('serif')}" font-size="${style.brandSizePx}" font-weight="700" fill="${style.brandColor}">@${xml(brand)}</text>`;
  const effectMarkup = thingsBackgroundEffect(effects, seconds);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" data-design-kind="content" data-fit="${layout.fits}" data-size="${layout.size}">
  <defs>${paperDefs({ seed: 3, vignette: style.vignette, dark: 0.35 })}</defs>
  ${paperMarkup(style.paperColor, { seed: 3, vignette: style.vignette, dark: 0.35 })}
  ${effectMarkup}
  ${brandTopText}${titleMarkup}${markerParts.join('')}${bodyParts.join('')}${brandBottomText}
  ${editorMode ? `<metadata data-fit="${layout.fits}" data-size="${layout.size}"/>` : ''}
</svg>`;
}
