const WIDTH = 1080;
const HEIGHT = 1920;

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

function wrapThumbnailHeadline(words, width, fontSize) {
  return wrapWords(words.map((text) => ({ text })), width, fontSize).map((line) => line.map((token) => token.text));
}

export function buildSourceThumbnailSvg(script, style, { editorMode = false, brand = 'Easy English Shadowing', headline, highlight } = {}) {
  const sourceHeadline = String(headline ?? script?.title ?? script?.thumbnailTitle ?? '').trim();
  const brandWords = String(brand || 'Easy English Shadowing').split(/\s+/u).filter(Boolean);
  const split = Math.ceil(brandWords.length / 2);
  const words = sourceHeadline.split(/\s+/u).filter(Boolean);
  const fontSize = Number(style.headlineMaxPx) || 40;
  const boxLeft = WIDTH * style.headlineLeftPct / 100;
  const boxTop = HEIGHT * style.headlineTopPct / 100;
  const boxWidth = WIDTH * style.headlineWidthPct / 100;
  const boxHeight = HEIGHT * style.headlineHeightPct / 100;
  const lines = wrapThumbnailHeadline(words, boxWidth, fontSize);
  const marked = new Set((Array.isArray(highlight) ? highlight : String(highlight ?? '').split(/\s+/u)).flatMap((word) => String(word).split(/\s+/u)).map(plainWord));
  const lineHeight = fontSize * 1.02;
  const firstBaseline = boxTop + Math.max(0, (boxHeight - lines.length * lineHeight) / 2) + fontSize;
  const titleMarkup = lines.map((line, lineIndex) => {
    const wordGap = estimateTextWidth(' ', fontSize);
    const content = line.map((word, wordIndex) => `<tspan${wordIndex ? ` dx="${wordGap}"` : ''} fill="${marked.has(plainWord(word)) ? style.highlightColor : style.textColor}">${xml(word)}</tspan>`).join('');
    return `<text data-source-headline-line="${lineIndex}" data-source-font="${style.headlineFont}" x="${boxLeft + boxWidth / 2}" y="${firstBaseline + lineIndex * lineHeight}" text-anchor="middle" font-family="${sourceFont(style.headlineFont)}" font-size="${fontSize}" font-weight="${style.headlineFont === 'display' ? 400 : 700}" stroke="${style.outlineColor}" stroke-width="${fontSize * 0.07}" stroke-linejoin="round" paint-order="stroke fill" filter="url(#headlineShadow)">${content}</text>`;
  }).join('');
  const brandGap = estimateTextWidth(' ', style.brandSizePx);
  const brandMarkup = `<text data-source-brand="top" x="${WIDTH * style.brandCenterXPct / 100}" y="${HEIGHT * style.brandTopPct / 100 + style.brandSizePx}" text-anchor="middle" font-family="${sourceFont('serif')}" font-size="${style.brandSizePx}" font-weight="700"><tspan fill="${style.brandColorA}">${xml(brandWords.slice(0, split).join(' '))}</tspan><tspan${brandWords.length > split ? ` dx="${brandGap}"` : ''} fill="${style.brandColorB}">${xml(brandWords.slice(split).join(' '))}</tspan></text>`;
  const box = editorMode ? `<metadata data-fit="true" data-size="${Math.round(fontSize)}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" data-design-kind="thumbnail" data-fit="true" data-size="${Math.round(fontSize)}">
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

function mixWithWhite(hex, opacity) {
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? [...value].map((char) => char + char).join('') : value;
  const rgb = [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16));
  return `#${rgb.map((channel) => Math.round(255 - (255 - channel) * opacity).toString(16).padStart(2, '0')).join('')}`;
}

export function buildSourceContentSvg({ script, tokens = [], activeTokenIds = [], style, brand = 'Easy English Shadowing', editorMode = false, demoHighlight = false, centerText = false }) {
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

  const active = new Set(activeTokenIds);
  if (demoHighlight && allTokens[1]) active.add(allTokens[1].id);
  const markerColor = mixWithWhite(style.highlightColor, style.highlightOpacity);
  const bodyParts = [];
  const markerParts = [];
  let tokenCursor = 0;
  for (let paragraphIndex = 0; paragraphIndex < layout.paragraphLines.length; paragraphIndex += 1) {
    const lines = layout.paragraphLines[paragraphIndex];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const baseline = cursorY + layout.size * (0.9 + lineIndex * 1.45);
      const lineWidth = estimateTextWidth(line.map((word) => word.text).join(' '), layout.size);
      let x = centerText ? centerX - lineWidth / 2 : roomLeft;
      for (let wordIndex = 0; wordIndex < line.length; wordIndex += 1) {
        const word = line[wordIndex];
        const token = word.id ? word : allTokens[tokenCursor];
        if (word.id) tokenCursor += 1;
        const tokenId = token?.id;
        const width = estimateTextWidth(word.text, layout.size);
        if (tokenId && active.has(tokenId)) {
          const padX = layout.size * 0.9 * style.highlightPadXPct / 100;
          const top = baseline - layout.size * 0.8 - style.highlightPadYPx;
          const bottom = baseline + layout.size * 0.1 + style.highlightPadYPx;
          const xStart = x - padX;
          const xEnd = x + width + padX;
          const radius = Math.min(style.highlightRadiusPx, layout.size / 2);
          markerParts.push(`<rect x="${xStart}" y="${top}" width="${xEnd - xStart}" height="${bottom - top}" rx="${radius}" fill="${markerColor}" style="mix-blend-mode:multiply"/>`);
          if (style.highlightUnderline === 'on') {
            markerParts.push(`<rect x="${xStart}" y="${baseline + layout.size * 0.1 + style.highlightPadYPx + 2}" width="${xEnd - xStart}" height="${Math.max(3, layout.size * 0.11)}" fill="${style.highlightUnderlineColor}"/>`);
          }
        }
        const color = tokenId && active.has(tokenId) && style.highlightTextMode === 'custom' ? style.highlightTextColor : style.bodyColor;
        bodyParts.push(`<text x="${x}" y="${baseline}" font-family="${sourceFont(style.bodyFont)}" font-size="${layout.size}" fill="${color}">${xml(word.text)}</text>`);
        x += width + (wordIndex < line.length - 1 ? estimateTextWidth(' ', layout.size) : 0);
      }
    }
    cursorY += lines.length * layout.size * 1.45;
    if (paragraphIndex < layout.paragraphLines.length - 1) cursorY += layout.size * 0.8;
  }
  const brandTop = HEIGHT * style.brandTopPct / 100;
  const brandTopText = `<text data-source-brand="top" x="${WIDTH * style.brandCenterXPct / 100}" y="${brandTop + style.brandSizePx * 0.92}" text-anchor="middle" font-family="${sourceFont('serif')}" font-size="${style.brandSizePx}" font-weight="700" fill="${style.brandColor}">${xml(brand)}</text>`;
  const brandBottomText = `<text data-source-brand="bottom" x="${WIDTH * style.brandCenterXPct / 100}" y="${HEIGHT - brandTop - style.brandSizePx * 0.24}" text-anchor="middle" font-family="${sourceFont('serif')}" font-size="${style.brandSizePx}" font-weight="700" fill="${style.brandColor}">@${xml(brand)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" data-design-kind="content" data-fit="${layout.fits}" data-size="${layout.size}">
  <defs>${paperDefs({ seed: 3, vignette: style.vignette, dark: 0.35 })}</defs>
  ${paperMarkup(style.paperColor, { seed: 3, vignette: style.vignette, dark: 0.35 })}
  ${brandTopText}${titleMarkup}${markerParts.join('')}${bodyParts.join('')}${brandBottomText}
  ${editorMode ? `<metadata data-fit="${layout.fits}" data-size="${layout.size}"/>` : ''}
</svg>`;
}
