import sharp from 'sharp';
import { renderBackgroundEffectMarkup } from '../../packages/video-engine/background-effects.mjs';
import { normalizeThingsYouDidntKnowVisualDesign } from './visual-design.mjs';

const WIDTH = 1080;
const HEIGHT = 1920;
const xml = (value) => String(value ?? '').replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const family = (value) => value === 'sans' ? 'Arial, Helvetica, sans-serif' : value === 'display' ? 'Impact, Arial Narrow, sans-serif' : 'Georgia, Times New Roman, serif';
const estimate = (value, size) => [...String(value || '')].reduce((sum, ch) => sum + (/\s/u.test(ch) ? .29 : /[ilI.,'\x60:;!|]/u.test(ch) ? .27 : /[mwMW@%&]/u.test(ch) ? .82 : /[A-Z0-9]/u.test(ch) ? .62 : .52), 0) * size;
const splitWords = (text) => String(text || '').trim().split(/\s+/u).filter(Boolean);

function fitLines(words, size, width, maxLines = Infinity) {
  const result = [];
  let line = [];
  let used = 0;
  for (const word of words) {
    const next = used + (line.length ? estimate(' ', size) : 0) + estimate(word, size);
    if (line.length && next > width) { result.push(line); line = []; used = 0; }
    line.push(word);
    used += (line.length > 1 ? estimate(' ', size) : 0) + estimate(word, size);
  }
  if (line.length) result.push(line);
  return result.length <= maxLines ? result : null;
}

function bodyLayout(script, design) {
  const words = splitWords(script.imageBody);
  const width = WIDTH * (100 - 2 * design.horizontalMarginPct) / 100;
  const height = HEIGHT * design.bodyHeightPct / 100;
  for (let size = design.bodyFontSize; size >= 30; size -= 1) {
    const lines = fitLines(words, size, width);
    const lineHeight = size * design.lineHeight;
    if (lines && lines.length * lineHeight <= height) return { lines, size, lineHeight, width };
  }
  throw new Error('Image body không vừa vùng an toàn. Rút ngắn nội dung hoặc chỉnh Thiết kế Nội dung.');
}

function paper(design, seconds, effects = {}) {
  const speed = Math.max(0, Math.min(100, Number(effects.backgroundEffectSpeed) || 0));
  const density = Math.max(0, Math.min(100, Number(effects.backgroundEffectDensity) || 0));
  const opacity = Math.max(0, Math.min(60, Number(effects.backgroundEffectOpacity) || 0)) / 100;
  const drift = design.effect === 'slow-pan' ? Math.round(Math.sin(seconds / Math.max(1, 10 - speed / 12)) * 20) : 0;
  const dustCount = Math.min(30, Math.max(4, Math.round(4 + density / 4)));
  const dust = design.effect === 'dust' ? Array.from({ length: dustCount }, (_, i) => '<circle cx="' + ((i * 197 + 43) % WIDTH) + '" cy="' + ((i * 347 + Math.round(seconds * (1 + speed / 12 + i % 4))) % HEIGHT) + '" r="' + (1 + i % 3) + '" fill="#77583A" opacity="' + opacity.toFixed(2) + '"/>').join('') : '';
  const noiseOpacity = Math.max(.04, Math.min(.24, opacity + (design.texture === 'paper' ? .06 : .02)));
  const noise = ['paper', 'grain'].includes(design.texture) ? '<filter id="grain"><feTurbulence baseFrequency=".7" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values=".2 0 0 0 .8 .2 0 0 0 .7 .2 0 0 0 .55 0 0 0 .12 0"/></filter><rect width="1080" height="1920" filter="url(#grain)" opacity="' + noiseOpacity.toFixed(2) + '"/>' : '';
  const backgroundEffect = renderBackgroundEffectMarkup(effects.backgroundEffect || 'none', {
    width: WIDTH, height: HEIGHT, time: seconds, seed: 'things-you-didnt-know',
    density, speed, opacity: Number(effects.backgroundEffectOpacity) || 32, contentLanguage: 'en'
  });
  return '<defs><linearGradient id="paper" x1="' + drift + '" y1="0" x2="1080" y2="1920"><stop stop-color="' + design.backgroundColor + '"/><stop offset="1" stop-color="' + design.paperShade + '" stop-opacity=".34"/></linearGradient><radialGradient id="edge"><stop offset=".66" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#6F5235" stop-opacity=".2"/></radialGradient></defs><rect width="1080" height="1920" fill="url(#paper)"/><rect width="1080" height="1920" fill="url(#edge)"/>' + noise + dust + backgroundEffect;
}

function illustration(theme, brief, style, seconds) {
  const accent = '#A85E3B';
  const subject = `${brief || ''} ${theme || ''}`.toLowerCase();
  const resolvedStyle = style && style !== 'auto' ? style
    : /umbrella|rain|shower|parasol/.test(subject) ? 'umbrella'
      : /eating|food|table|meal|cooking/.test(subject) ? 'food'
        : /transport|train|bus|bicycle|bike|commut/.test(subject) ? 'transport'
          : /school|study|book|learn|education/.test(subject) ? 'book'
            : /housing|community|family|neighbou?r|home|doorway/.test(subject) ? 'community' : 'object';
  let icon = '<rect x="382" y="165" width="316" height="245" rx="38"/><circle cx="540" cy="286" r="76" fill="#EADCC0" stroke="#607F80" stroke-width="17"/><path d="M445 410v32m190-32v32" fill="none" stroke="#607F80" stroke-width="18" stroke-linecap="round"/>';
  if (resolvedStyle === 'umbrella') icon = '<path d="M270 286q18-102 104-153 74-43 166-43t166 43q86 51 104 153-64-36-128 0-70-38-142 0-72-38-142 0-64-36-128 0z"/><path d="M540 92v252q0 69 58 69 38 0 47-34" fill="none" stroke="#607F80" stroke-width="18" stroke-linecap="round"/><path d="M378 285q-5-79 26-133m110 135q0-100 26-197m82 197q10-80 42-135" fill="none" stroke="#EADCC0" stroke-width="10" opacity=".86"/>';
  else if (resolvedStyle === 'food') icon = '<ellipse cx="540" cy="300" rx="190" ry="130"/><ellipse cx="540" cy="300" rx="120" ry="72" fill="#EADCC0" stroke="#607F80" stroke-width="16"/><path d="M390 160v128m-22-128v73m22-73v73m278-73v128m-26-128v73" fill="none" stroke="#607F80" stroke-width="14" stroke-linecap="round"/>';
  else if (resolvedStyle === 'transport') icon = '<circle cx="410" cy="345" r="74" fill="none" stroke="#607F80" stroke-width="18"/><circle cx="670" cy="345" r="74" fill="none" stroke="#607F80" stroke-width="18"/><path d="m410 345 92-150 92 150H410l66-105h130m-104-45h66m-190 150h-38m336 0h-38" fill="none" stroke="#607F80" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><circle cx="502" cy="195" r="17"/><circle cx="594" cy="345" r="17"/>';
  else if (resolvedStyle === 'book') icon = '<path d="M330 180q105-42 210 22 105-64 210-22v250q-105-42-210 22-105-64-210-22z"/><path d="M540 202v250m-158-196q67-12 122 22m-122 36q67-12 122 22m102-58q55-34 122-22m-122 80q55-34 122-22" fill="none" stroke="#607F80" stroke-width="14" stroke-linecap="round"/>';
  else if (resolvedStyle === 'community') icon = '<path d="m320 278 220-170 220 170v184H320z"/><path d="M468 462V320h144v142M390 290h48v54h-48m204-54h48v54h-48" fill="#EADCC0" stroke="#607F80" stroke-width="16"/><path d="M495 195h90" fill="none" stroke="#607F80" stroke-width="16" stroke-linecap="round"/>';
  const y = Math.sin(seconds / 4) * 4;
  const dots = String(brief || '').split(/[,;\n]+/u).slice(0, 3).map((_, i) => '<circle cx="' + (382 + i * 158) + '" cy="448" r="7" fill="#A85E3B"/>').join('');
  return '<g transform="translate(0 ' + y + ')"><ellipse cx="540" cy="465" rx="250" ry="24" fill="#70523B" opacity=".12"/><g fill="' + accent + '" stroke="#563A2D" stroke-width="7" stroke-linejoin="round">' + icon + '</g>' + dots + '<path d="M260 155l20 42 42 20-42 20-20 42-20-42-42-20 42-20zm560 65 13 28 29 13-29 13-13 29-13-29-29-13 29-13z" fill="#D2A052" opacity=".8"/></g>';
}

export function buildThingsYouDidntKnowContentSvg({ script, design: inputDesign, tokens = null, activeTokenIds = [], seconds = 0, effects = {}, highlightSettings = null }) {
  const baseDesign = normalizeThingsYouDidntKnowVisualDesign(inputDesign);
  const design = baseDesign;
  const layout = bodyLayout(script, design);
  const headerText = String(design.headerText || '').trim();
  let headerFontSize = design.headerFontSize;
  while (headerText && estimate(headerText, headerFontSize) + Math.max(0, [...headerText].length - 1) * 3 > 940 && headerFontSize > 18) headerFontSize -= 1;
  const titleWords = splitWords(script.imageTitle || script.title);
  let title = null;
  for (let size = design.titleFontSize; size >= 36; size -= 1) {
    const lines = fitLines(titleWords, size, WIDTH * .82, 2);
    if (lines) { title = { lines, size }; break; }
  }
  if (!title) throw new Error('Tiêu đề vượt quá vùng hiển thị an toàn.');
  const titleTop = HEIGHT * design.titleTopPct / 100;
  const titleMarkup = title.lines.map((line, i) => '<text x="540" y="' + (titleTop + (i + 1) * title.size * 1.18) + '" text-anchor="middle" class="title">' + xml(line.join(' ')) + '</text>').join('');
  const words = Array.isArray(tokens) && tokens.length ? tokens : splitWords(script.imageBody).map((text, i) => ({ id: 'word-' + i, text }));
  const rows = [];
  let row = [];
  let used = 0;
  for (const token of words) {
    const next = used + (row.length ? estimate(' ', layout.size) : 0) + estimate(token.text, layout.size);
    if (row.length && next > layout.width) { rows.push(row); row = []; used = 0; }
    row.push(token);
    used += (row.length > 1 ? estimate(' ', layout.size) : 0) + estimate(token.text, layout.size);
  }
  if (row.length) rows.push(row);
  const active = new Set(highlightSettings?.highlightEnabled === true ? activeTokenIds : []);
  const requestedHighlightColor = String(highlightSettings?.highlightColor || '#FF8066');
  const highlightColor = /^#[\da-f]{6}$/iu.test(requestedHighlightColor) ? requestedHighlightColor : '#FF8066';
  const textColorOnly = highlightSettings?.highlightStyle === 'text-color';
  const requestedPadding = Number(highlightSettings?.highlightPadding ?? 6);
  const highlightPadding = Number.isFinite(requestedPadding) ? Math.max(0, Math.min(24, requestedPadding)) : 6;
  const requestedRadius = Number(highlightSettings?.highlightRadius ?? 8);
  const highlightRadius = Number.isFinite(requestedRadius) ? Math.max(0, Math.min(32, requestedRadius)) : 8;
  const top = HEIGHT * design.bodyTopPct / 100;
  const margin = WIDTH * design.horizontalMarginPct / 100;
  const body = rows.map((line, lineIndex) => {
    const lineWidth = line.reduce((sum, token, i) => sum + estimate(token.text, layout.size) + (i ? estimate(' ', layout.size) : 0), 0);
    let x = design.textAlign === 'center' ? (WIDTH - lineWidth) / 2 : margin;
    const baseline = top + (lineIndex + 1) * layout.lineHeight;
    return line.map((token) => {
      const width = estimate(token.text, layout.size);
      const on = active.has(token.id);
      const rect = on && !textColorOnly ? '<rect x="' + (x - highlightPadding).toFixed(1) + '" y="' + (baseline - layout.size * .8 - highlightPadding).toFixed(1) + '" width="' + (width + 2 * highlightPadding).toFixed(1) + '" height="' + (layout.size * .9 + 2 * highlightPadding).toFixed(1) + '" rx="' + highlightRadius + '" fill="' + highlightColor + '"/>' : '';
      const activeTextColor = on ? (textColorOnly ? highlightColor : '#FFFFFF') : design.inkColor;
      const span = rect + '<text x="' + x.toFixed(1) + '" y="' + baseline.toFixed(1) + '" fill="' + activeTextColor + '" font-weight="' + (on ? 700 : 400) + '" class="body">' + xml(token.text) + '</text>';
      x += width + estimate(' ', layout.size);
      return span;
    }).join('');
  }).join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">' + paper(design, seconds, effects)
    + (design.headerEnabled ? '<rect x="70" y="' + HEIGHT * .025 + '" width="940" height="2" fill="' + design.headerColor + '" opacity=".45"/><text x="540" y="' + (HEIGHT * design.headerTopPct / 100 + headerFontSize + 12) + '" text-anchor="middle" class="header">' + xml(headerText) + '</text>' : '')
    + (design.illustrationEnabled ? '<g transform="translate(0 ' + HEIGHT * design.illustrationTopPct / 100 + ') scale(1 ' + design.illustrationHeightPct / 26 + ')">' + illustration(script.themeId || script.theme, script.illustrationBrief, design.illustrationStyle, seconds) + '</g>' : '')
    + titleMarkup + body + '<text x="540" y="' + HEIGHT * (1 - design.handleBottomPct / 100) + '" text-anchor="middle" class="handle">' + xml(design.handle) + '</text>'
    + '<style>.header{font-family:Georgia,serif;font-size:' + headerFontSize + 'px;font-weight:700;letter-spacing:3px;fill:' + design.headerColor + '}.title{font-family:' + family(design.headingFont) + ';font-size:' + title.size + 'px;font-weight:700;fill:' + design.headerColor + '}.body{font-family:' + family(design.bodyFont) + ';font-size:' + layout.size + 'px}.handle{font-family:Arial,sans-serif;font-size:28px;letter-spacing:1px;fill:' + design.headerColor + ';opacity:.78}</style></svg>';
}

export function buildThingsYouDidntKnowThumbnailSvg({ script, design: inputDesign }) {
  const c = normalizeThingsYouDidntKnowVisualDesign(inputDesign).thumbnail;
  const words = splitWords(script.thumbnailHeadline || script.title);
  let layout = null;
  for (let size = c.titleFontSize; size >= 54; size -= 2) {
    const lines = fitLines(words, size, WIDTH * c.headlineWidthPct / 100, 5);
    if (lines) { layout = { lines, size }; break; }
  }
  if (!layout) throw new Error("Thumbnail headline không vừa template Things You Didn't Know.");
  const highlights = new Set((script.thumbnailHighlights || []).map((word) => String(word).toLowerCase()));
  const top = HEIGHT * c.headlineTopPct / 100;
  const text = layout.lines.map((line, index) => {
    let x = WIDTH / 2 - line.reduce((sum, word, i) => sum + estimate(word, layout.size) + (i ? estimate(' ', layout.size) : 0), 0) / 2;
    return line.map((word) => {
      const width = estimate(word, layout.size);
      const cleaned = word.replace(/[^\\p{L}\\p{N}]/gu, '').toLowerCase();
      const color = highlights.has(cleaned) ? c.highlightColor : c.headlineColor;
      const output = '<text x="' + x.toFixed(1) + '" y="' + (top + (index + 1) * layout.size * 1.08) + '" class="headline" fill="' + color + '" stroke="' + c.outlineColor + '">' + xml(word) + '</text>';
      x += width + estimate(' ', layout.size);
      return output;
    }).join('');
  }).join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><defs><linearGradient id="kraft" x1="0" y1="0" x2="0" y2="1"><stop stop-color="' + c.backgroundColor + '"/><stop offset=".58" stop-color="' + c.backgroundColor + '"/><stop offset="1" stop-color="' + c.bottomColor + '"/></linearGradient><filter id="shadow"><feGaussianBlur stdDeviation="5"/></filter></defs>'
    + '<rect width="1080" height="1920" fill="url(#kraft)"/><rect width="1080" height="1920" fill="#3B2412" opacity=".05"/>'
    + '<text x="540" y="' + (HEIGHT * c.brandTopPct / 100 + 35) + '" text-anchor="middle" class="brand">THINGS YOU DIDN&apos;T KNOW</text>'
    + '<text x="540" y="' + (HEIGHT * c.brandTopPct / 100 + 86) + '" text-anchor="middle" class="brand-name">' + xml(script.country || '') + '</text>'
    + '<g filter="url(#shadow)" opacity=".35">' + text + '</g>' + text + '<path d="M155 910h770" stroke="#3B2412" stroke-opacity=".2" stroke-width="2"/>'
    + '<style>.headline{font-family:Impact,Arial Narrow,sans-serif;font-size:' + layout.size + 'px;font-weight:900;stroke-width:10;stroke-linejoin:round;paint-order:stroke fill}.brand{font-family:Georgia,serif;font-size:30px;font-weight:700;letter-spacing:3px;fill:' + c.brandColor + '}.brand-name{font-family:Georgia,serif;font-size:26px;font-style:italic;fill:' + c.brandColor + ';opacity:.9}</style></svg>';
}

export async function renderThingsYouDidntKnowPng(svg) { return sharp(Buffer.from(svg)).png().toBuffer(); }
