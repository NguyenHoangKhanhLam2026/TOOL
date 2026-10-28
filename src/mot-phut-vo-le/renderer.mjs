import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { DATA, FFMPEG_BIN, FFPROBE_BIN, ROOT } from '../config.mjs';
import { DEFAULT_HIGHLIGHT_SETTINGS } from '../../packages/audio-highlight/highlight-engine.mjs';
import { BACKGROUND_EFFECTS, renderBackgroundEffectMarkup } from '../../packages/video-engine/background-effects.mjs';
import { normalizeMotPhutVoLeVisualDesign, MOT_PHUT_VO_LE_PRESETS } from './visual-design.mjs';
import { validateMotPhutVoLeAlignment } from './alignment.mjs';
import { getMotPhutVoLeHeadlineFont, measureMotPhutVoLeHeadlineLine, renderMotPhutVoLeThumbnailSvg } from './thumbnail-font-renderer.mjs';

export const MOT_PHUT_VO_LE_VIDEO_PROFILE = Object.freeze({ width: 1080, height: 1920, fps: 30, videoCodec: 'h264', audioCodec: 'aac', pixelFormat: 'yuv420p' });
export const MOT_PHUT_VO_LE_BACKGROUND_EFFECTS = Object.freeze(BACKGROUND_EFFECTS.filter((effect) => effect.id !== 'vocabulary'));
const OUTPUT_DIR = path.join(DATA, 'outputs', 'mot-phut-vo-le');
const FRAME_DIR = path.join(DATA, 'temporary', 'mot-phut-vo-le', 'frames');

export async function createMotPhutVoLeThumbnail({ content, design = {}, outputPath } = {}) {
  if (!content?.title) throw new Error('Thiếu tiêu đề để tạo thumbnail.');
  const normalizedDesign = effectiveDesign(design);
  const pathOut = outputPath || path.join(OUTPUT_DIR, String(content.id || 'draft'), 'thumbnail.png');
  const svg = normalizedDesign.schemaVersion >= 2
    ? await buildThumbnailPreviewSvg(content, normalizedDesign)
    : buildLegacyThumbnailSvg(content, normalizedDesign);
  return normalizedDesign.schemaVersion >= 2
    ? rasterizeThumbnailSvg(svg, pathOut)
    : rasterizeSvg(svg, pathOut);
}

export async function renderMotPhutVoLeVideo({ content, audioPath, alignment, design = {}, backgroundEffect = {}, highlightMode = 'syllable', outputPath, allowPartialAlignment = false, onProgress = () => {} } = {}) {
  if (!content?.title || !content?.scriptText) throw new Error('Thiếu tiêu đề hoặc kịch bản để render video.');
  if (!fs.existsSync(audioPath)) throw new Error('Không tìm thấy audio VieNeu để render.');
  const isReliable = validateMotPhutVoLeAlignment(alignment, { allowPartial: allowPartialAlignment });
  const normalizedDesign = effectiveDesign(design);
  const contentDir = path.dirname(outputPath || path.join(OUTPUT_DIR, String(content.id || 'draft'), 'video-v1.mp4'));
  const pathOut = outputPath || path.join(contentDir, `video-${Date.now()}.mp4`);
  const buildDir = path.join(FRAME_DIR, `${safeDirectoryToken(content.id || 'draft')}-${Date.now()}`);
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(path.dirname(pathOut), { recursive: true });
  try {
  const audioInfo = await probeMedia(audioPath);
  const audioDuration = Number(audioInfo.format?.duration);
  if (!Number.isFinite(audioDuration) || audioDuration <= 0) throw new Error('Không đọc được thời lượng audio VieNeu.');

  const tokenLayout = normalizedDesign.schemaVersion >= 2
    ? fitScriptLayout(alignment?.tokens || [], content.scriptText, normalizedDesign, content.title)
    : fitScriptLayoutLegacy(alignment?.tokens || [], content.scriptText, normalizedDesign);
  const introSeconds = normalizedDesign.schemaVersion >= 2 ? normalizedDesign.thumbnail.introSeconds : 0;
  const audioTimeline = createHighlightTimeline(alignment, audioDuration, isReliable, highlightMode, backgroundEffect.highlightEnabled !== false);
  const timeline = [
    ...(introSeconds > 0 ? [{ startSeconds: 0, endSeconds: introSeconds, durationSeconds: introSeconds, activeTokenIndexes: new Set(), type: 'thumbnail-intro' }] : []),
    ...audioTimeline.map((item) => ({ ...item, startSeconds: item.startSeconds + introSeconds, endSeconds: item.endSeconds + introSeconds, contentStartSeconds: item.startSeconds, type: 'content' }))
  ];
  const concatPath = path.join(buildDir, 'frames.ffconcat');
  const concatRows = ['ffconcat version 1.0'];
  for (let index = 0; index < timeline.length; index += 1) {
    const item = timeline[index];
    const imagePath = path.join(buildDir, `frame-${String(index).padStart(4, '0')}.png`);
    if (item.type === 'thumbnail-intro') {
      const introSvg = normalizedDesign.schemaVersion >= 2
        ? await buildThumbnailPreviewSvg(content, normalizedDesign)
        : buildLegacyThumbnailSvg(content, normalizedDesign);
      const introImage = normalizedDesign.schemaVersion >= 2
        ? await renderMotPhutVoLeThumbnailSvg(introSvg)
        : await sharp(Buffer.from(introSvg)).png().toBuffer();
      await sharp(introImage).resize(1080, 1920, { fit: 'contain', background: parseHexColor(normalizedDesign.thumbnail.paperColor) }).png().toFile(imagePath);
    } else {
      const svg = buildContentSvg({ content, design: normalizedDesign, tokenLayout, activeTokenIndexes: item.activeTokenIndexes,
        backgroundEffect, highlightMode, effectTime: item.contentStartSeconds });
      const frameImage = normalizedDesign.schemaVersion >= 4
        ? await renderMotPhutVoLeThumbnailSvg(svg)
        : await sharp(Buffer.from(svg)).png().toBuffer();
      await sharp(frameImage).png().toFile(imagePath);
    }
    concatRows.push(`file '${ffconcatQuote(imagePath)}'`, `duration ${Math.max(0.001, item.durationSeconds).toFixed(6)}`);
    onProgress({ phase: 'frame-render', current: index + 1, total: timeline.length });
  }
  if (!timeline.length) throw new Error('Không có mốc thời gian để dựng video.');
  concatRows.push(`file '${ffconcatQuote(path.join(buildDir, `frame-${String(timeline.length - 1).padStart(4, '0')}.png`))}'`);
  fs.writeFileSync(concatPath, concatRows.join('\n'), 'utf8');
  onProgress({ phase: 'ffmpeg-render', progress: 0 });
  await run(FFMPEG_BIN, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
    ...(introSeconds > 0 ? ['-itsoffset', introSeconds.toFixed(6)] : []), '-i', audioPath, '-shortest', '-r', String(MOT_PHUT_VO_LE_VIDEO_PROFILE.fps), '-vf', 'format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', pathOut
  ], { timeoutMs: 20 * 60_000 });
  onProgress({ phase: 'ffmpeg-render', progress: 1 });
  const result = await probeMedia(pathOut);
  validateRenderedVideo(result, audioDuration + introSeconds);
  return {
    videoPath: pathOut,
    durationSeconds: Number(result.format.duration),
    profile: { ...MOT_PHUT_VO_LE_VIDEO_PROFILE },
    audioDurationSeconds: audioDuration,
    synchronization: { checked: true, source: introSeconds > 0 ? 'thumbnail-intro-and-audio-duration-trim' : 'audio-duration-trim', driftSeconds: Number((Number(result.format.duration) - audioDuration - introSeconds).toFixed(3)) },
    alignment: { status: alignment?.status || 'unavailable', reliable: Boolean(alignment?.reliable), source: alignment?.source || null, warning: alignment?.warning || null },
    timeline,
    renderManifest: { module: 'mot-phut-vo-le', design: normalizedDesign, backgroundEffect, highlightMode, tokenLayout, createdAt: new Date().toISOString() }
  };
  } finally {
    const root = path.resolve(FRAME_DIR);
    const target = path.resolve(buildDir);
    if (target.startsWith(`${root}${path.sep}`)) fs.rmSync(target, { recursive: true, force: true });
  }
}

export async function buildMotPhutVoLeVisualPreviewSvg({ content, design = {}, backgroundEffect = {}, mode = 'content' } = {}) {
  const normalizedDesign = normalizeMotPhutVoLeVisualDesign(design);
  if (mode === 'thumbnail') return normalizedDesign.schemaVersion >= 2
    ? await buildThumbnailPreviewSvg(content, normalizedDesign)
    : buildLegacyThumbnailPreviewSvg(content, normalizedDesign);
  const fakeTokens = (String(content?.scriptText || 'Một nội dung mẫu để xem trước highlight.').match(/\S+/gu) || []).map((text, index) => ({ id: `preview:word:${index + 1}`, index, text }));
  const text = content?.scriptText || 'Một nội dung mẫu để xem trước highlight.';
  const tokenLayout = normalizedDesign.schemaVersion >= 2
    ? fitScriptLayout(fakeTokens, text, normalizedDesign, content?.title)
    : fitScriptLayoutLegacy(fakeTokens, text, normalizedDesign);
  return buildContentSvg({ content: { title: content?.title || 'Một câu hỏi thú vị', scriptText: text }, design: normalizedDesign, tokenLayout, activeTokenIndexes: new Set([1]), backgroundEffect, highlightMode: backgroundEffect.highlightMode || 'syllable' });
}

function createHighlightTimeline(alignment, duration, reliable, highlightMode = 'syllable', highlightEnabled = true) {
  const events = (highlightEnabled ? alignment?.wordTimings || [] : []).filter((item) => Number.isFinite(Number(item.startSeconds)) && Number(item.startSeconds) >= 0 && Number(item.startSeconds) < duration)
    .map((item) => ({ index: Number(item.tokenIndex), start: Number(item.startSeconds) }))
    .filter((item) => Number.isInteger(item.index)).sort((a, b) => a.start - b.start || a.index - b.index);
  const groups = [];
  if (highlightMode === 'phrase') {
    let phrase = null;
    for (const event of events) {
      if (!phrase || phrase.activeTokenIndexes.size >= 3 || event.start - phrase.lastStart > 0.55) {
        phrase = { start: event.start, lastStart: event.start, activeTokenIndexes: new Set() };
        groups.push(phrase);
      }
      phrase.lastStart = event.start;
      phrase.activeTokenIndexes.add(event.index);
    }
  } else {
    for (const event of events) {
      const previous = groups.at(-1);
      if (previous && Math.abs(previous.start - event.start) < 0.015) previous.activeTokenIndexes.add(event.index);
      else groups.push({ start: event.start, activeTokenIndexes: new Set([event.index]) });
    }
  }
  const timeline = [];
  let cursor = 0;
  if (!groups.length) return [{ startSeconds: 0, endSeconds: duration, durationSeconds: duration, activeTokenIndexes: new Set() }];
  if (groups[0].start > 0) timeline.push({ startSeconds: 0, endSeconds: groups[0].start, durationSeconds: groups[0].start, activeTokenIndexes: new Set() });
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const end = Math.min(duration, groups[index + 1]?.start ?? duration);
    if (end <= group.start) continue;
    timeline.push({ startSeconds: group.start, endSeconds: end, durationSeconds: end - group.start, activeTokenIndexes: reliable ? group.activeTokenIndexes : new Set() });
    cursor = end;
  }
  if (cursor < duration) timeline.push({ startSeconds: cursor, endSeconds: duration, durationSeconds: duration - cursor, activeTokenIndexes: new Set() });
  return timeline;
}

function fitScriptLayout(tokens, scriptText, design, title = '') {
  const body = design.content;
  const sourceTokens = tokens.length ? tokens : (String(scriptText).match(/\S+/gu) || []).map((text, index) => ({ id: `word-${index}`, index, text }));
  const maxWidth = Math.max(1, Math.min(1080 * body.contentWidthPct / 100, 1080 - 1080 * body.contentLeftPct / 100));
  const posterFrame = design.schemaVersion >= 4 ? posterBodyFrame(body) : null;
  const maxHeight = posterFrame?.height ?? Math.max(1, Math.min(1920 * body.contentHeightPct / 100, 1920 - 1920 * body.contentTopPct / 100));
  const measureFont = design.schemaVersion >= 4
    ? 'MPVL Arial Bold'
    : body.bodyFont || body.fontFamily;
  for (let size = Math.min(120, body.bodyMaxPx || body.bodyFontSize); size >= 22; size -= 1) {
    const lineHeight = size * body.lineSpacing;
    const lines = wrapTokens(sourceTokens, size, maxWidth, measureFont);
    if (lines.length * lineHeight <= maxHeight) return { tokens: sourceTokens, lines, fontSize: size, lineHeight, maxWidth, lineCount: lines.length };
  }
  throw new Error('Kịch bản quá dài để hiển thị rõ trong video dọc. Hãy rút gọn nội dung rồi render lại.');
}

function fitScriptLayoutLegacy(tokens, scriptText, design) {
  const body = design.content;
  const sourceTokens = tokens.length ? tokens : (String(scriptText).match(/\S+/gu) || []).map((text, index) => ({ id: `word-${index}`, index, text }));
  const maxWidth = 1080 - body.padding * 2;
  const maxHeight = 830;
  for (let size = Math.min(70, body.bodyFontSize); size >= 34; size -= 1) {
    const lineHeight = size * body.lineSpacing;
    const lines = wrapTokens(sourceTokens, size, maxWidth, body.fontFamily);
    if (lines.length * lineHeight <= maxHeight) return { tokens: sourceTokens, lines, fontSize: size, lineHeight, maxWidth, lineCount: lines.length };
  }
  throw new Error('Kịch bản quá dài để hiển thị rõ trong video dọc. Hãy rút gọn nội dung rồi render lại.');
}

function wrapTokens(tokens, fontSize, maxWidth, fontFamily) {
  const lines = [];
  let line = [];
  let width = 0;
  const space = fontSize * 0.28;
  for (const token of tokens) {
    const chunks = splitLongToken(token, maxWidth, fontSize, fontFamily);
    for (const chunk of chunks) {
      const itemWidth = measureText(chunk.text, fontSize, fontFamily);
      const gap = line.length && !chunk.joinPrevious ? space : 0;
      if (line.length && width + gap + itemWidth > maxWidth) {
        lines.push(line);
        line = [];
        width = 0;
      }
      line.push({ ...chunk, width: itemWidth });
      width += itemWidth + (line.length > 1 && !chunk.joinPrevious ? space : 0);
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

function splitLongToken(token, maxWidth, fontSize, fontFamily) {
  if (measureText(token.text, fontSize, fontFamily) <= maxWidth) return [token];
  const parts = Array.from(String(token.text));
  const chunks = [];
  let current = '';
  for (const part of parts) {
    if (current && measureText(current + part, fontSize, fontFamily) > maxWidth) {
      chunks.push({ ...token, text: current, joinPrevious: chunks.length > 0 });
      current = '';
    }
    current += part;
  }
  if (current) chunks.push({ ...token, text: current, joinPrevious: chunks.length > 0 });
  return chunks;
}

function measureText(text, fontSize, fontFamily = 'Arial, sans-serif') {
  const widths = {
    a: 0.51, b: 0.55, c: 0.46, d: 0.55, e: 0.50, f: 0.34, g: 0.55, h: 0.55, i: 0.25, j: 0.29,
    k: 0.50, l: 0.25, m: 0.82, n: 0.55, o: 0.55, p: 0.55, q: 0.55, r: 0.36, s: 0.45, t: 0.34,
    u: 0.55, v: 0.49, w: 0.75, x: 0.49, y: 0.49, z: 0.45
  };
  const uppercaseWidths = {
    A: 0.67, B: 0.67, C: 0.70, D: 0.72, E: 0.61, F: 0.59, G: 0.73, H: 0.72, I: 0.31, J: 0.53,
    K: 0.68, L: 0.58, M: 0.91, N: 0.72, O: 0.75, P: 0.66, Q: 0.75, R: 0.68, S: 0.64, T: 0.62,
    U: 0.72, V: 0.68, W: 0.96, X: 0.68, Y: 0.67, Z: 0.62
  };
  const family = String(fontFamily || '').toLowerCase();
  const serif = /georgia|serif|times|cambria/u.test(family);
  const posterDisplay = /mpvl display/u.test(family);
  const posterArial = /mpvl arial/u.test(family);
  const upperAdjustment = serif ? 0.01 : 0;
  let units = 0;
  for (const char of Array.from(String(text).normalize('NFC').normalize('NFD'))) {
    if (/\p{M}/u.test(char)) continue;
    if (/\s/u.test(char)) units += 0.28;
    else if (/\p{N}/u.test(char)) units += 0.55;
    else if (/\p{Ll}/u.test(char)) units += widths[char] ?? 0.53;
    else if (/\p{Lu}/u.test(char)) units += (uppercaseWidths[char] ?? 0.62) + upperAdjustment;
    else if (/[.,:;!'|]/u.test(char)) units += 0.28;
    else if (/[MW@#%&]/u.test(char)) units += 0.84;
    else if (/[()\[\]{}]/u.test(char)) units += 0.32;
    else if (/[—–]/u.test(char)) units += 0.62;
    else units += 0.5;
  }
  return units * fontSize * (posterDisplay ? 1.12 : posterArial ? 1.06 : 1);
}

function buildLegacyThumbnailSvg(content, design) {
  const thumb = design.thumbnail;
  const sourceTitle = String(content.title ?? '');
  const fontSize = Number(thumb.headlineMaxPx || thumb.fontSize) || 60;
  const titleLines = wrapTextAtFixedSize(sourceTitle, fontSize, 850);
  const titleLineHeight = Math.round(fontSize * 1.22);
  const blockHeight = titleLines.length * titleLineHeight;
  const startY = thumb.titlePosition === 'top' ? 560 : thumb.titlePosition === 'bottom' ? 1740 - blockHeight : 1150 - blockHeight / 2;
  const titleSvg = thumb.headlineVisible ? `<g data-source-headline="top">${titleLines.map((line, index) => `<text x="540" y="${startY + (index + 1) * titleLineHeight}" text-anchor="middle" class="title">${escapeXml(line)}</text>`).join('')}</g>` : '';
  const headlineFamily = thumb.headlineFont === 'serif' ? 'Georgia, serif' : 'Arial Black, Arial, sans-serif';
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
      ${backgroundSvg(thumb.background, design.preset)}
      ${thumb.brandVisible ? `<text x="${thumb.brandCenterXPct * 10.8}" y="${thumb.brandTopPct * 19.2 + thumb.brandSizePx}" text-anchor="middle" class="brand" data-source-brand="top">${escapeXml(thumb.brand)}</text>` : ''}
      ${titleSvg}
      ${thumb.watermarkVisible ? `<text x="${thumb.watermarkCenterXPct * 10.8}" y="${thumb.watermarkTopPct * 19.2}" text-anchor="middle" class="watermark" data-source-watermark="top">${escapeXml(thumb.watermark)}</text>` : ''}
      <style>.brand{font-family:${escapeCssFont(thumb.fontFamily)};font-size:${thumb.brandSizePx}px;font-weight:700;letter-spacing:2px;fill:${thumb.textColor}}.watermark{font-family:${escapeCssFont(thumb.watermarkFontFamily)};font-size:${thumb.watermarkSizePx}px;fill:${thumb.watermarkColor};opacity:${thumb.watermarkOpacity}}.title{font-family:${escapeCssFont(headlineFamily)};font-size:${fontSize}px;font-weight:900;fill:${thumb.textColor};stroke:${thumb.outlineColor};stroke-width:4;paint-order:stroke;stroke-linejoin:round}</style>
    </svg>`;
}

function buildLegacyThumbnailPreviewSvg(content, design) {
  const c = design.thumbnail;
  const sourceTitle = String(content?.title ?? 'Một câu hỏi thú vị');
  const fontSize = Number(c.headlineMaxPx || c.fontSize) || 60;
  const titleLines = wrapTextAtFixedSize(sourceTitle, fontSize, 850);
  const lines = titleLines.map((line, index) => `<text x="540" y="${920 + index * fontSize * 1.2}" text-anchor="middle" class="title">${escapeXml(line)}</text>`).join('');
  const headlineFamily = c.headlineFont === 'serif' ? 'Georgia, serif' : 'Arial Black, Arial, sans-serif';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920" data-fit="true" data-size="${fontSize}">${backgroundSvg(c.background, design.preset)}${c.brandVisible ? `<text x="${c.brandCenterXPct * 10.8}" y="${c.brandTopPct * 19.2 + c.brandSizePx}" text-anchor="middle" class="brand" data-source-brand="top">${escapeXml(c.brand)}</text>` : ''}${c.headlineVisible ? `<g data-source-headline="top">${lines}</g>` : ''}${c.watermarkVisible ? `<text x="${c.watermarkCenterXPct * 10.8}" y="${c.watermarkTopPct * 19.2}" text-anchor="middle" class="watermark" data-source-watermark="top">${escapeXml(c.watermark)}</text>` : ''}<style>.brand{font-family:${escapeCssFont(c.fontFamily)};fill:${c.textColor};font-size:${c.brandSizePx}px;font-weight:700}.title{font-family:${escapeCssFont(headlineFamily)};fill:${c.textColor};font-size:${fontSize}px;font-weight:900;stroke:${c.outlineColor};stroke-width:4;paint-order:stroke;stroke-linejoin:round}.watermark{font-family:${escapeCssFont(c.watermarkFontFamily)};font-size:${c.watermarkSizePx}px;fill:${c.watermarkColor};opacity:${c.watermarkOpacity}}</style></svg>`;
}

function buildContentSvg({ content, design, tokenLayout, activeTokenIndexes = new Set(), backgroundEffect = {}, highlightMode = 'syllable', effectTime = 0 }) {
  if (design.schemaVersion < 2) return buildContentSvgLegacy({ content, design, tokenLayout, activeTokenIndexes, backgroundEffect, highlightMode, effectTime });
  if (design.schemaVersion >= 4) return buildPosterContentSvg({ content, design, tokenLayout, activeTokenIndexes, backgroundEffect, effectTime });
  const theme = MOT_PHUT_VO_LE_PRESETS[design.preset];
  const c = design.content;
  const highlightEnabled = backgroundEffect.highlightEnabled !== false;
  const highlightColor = /^#[\da-f]{6}$/iu.test(String(backgroundEffect.highlightColor || ''))
    ? String(backgroundEffect.highlightColor).toUpperCase() : DEFAULT_HIGHLIGHT_SETTINGS.highlightColor;
  const highlightPadding = clampInteger(backgroundEffect.highlightPadding, DEFAULT_HIGHLIGHT_SETTINGS.highlightPadding, 0, 24);
  const highlightRadius = clampInteger(backgroundEffect.highlightRadius, DEFAULT_HIGHLIGHT_SETTINGS.highlightRadius, 0, 32);
  const title = fitTextLines(content.title, c.titleFontSize, Math.min(840, 1080 - c.padding * 2), 3, 42);
  const titleY = 455;
  const titleMarkup = title.lines.map((line, index) => `<text x="540" y="${titleY + (index + 1) * title.fontSize * 1.16}" text-anchor="middle" class="title">${escapeXml(line)}</text>`).join('');
  const bodyLeft = 1080 * c.contentLeftPct / 100;
  const bodyTop = 1920 * c.contentTopPct / 100;
  const bodyWidth = Math.max(1, Math.min(1080 * c.contentWidthPct / 100, 1080 - bodyLeft));
  const bodyBoxHeight = Math.max(1, Math.min(1920 * c.contentHeightPct / 100, 1920 - bodyTop));
  const bodyHeight = tokenLayout.lines.length * tokenLayout.lineHeight;
  const top = bodyTop + Math.max(0, Math.floor((bodyBoxHeight - bodyHeight) / 2));
  const bodyMarkup = tokenLayout.lines.map((line, lineIndex) => {
    const rowWidth = line.reduce((total, token, index) => total + token.width + (index ? tokenLayout.fontSize * 0.28 : 0), 0);
    let x = c.layout === 'left' ? bodyLeft : bodyLeft + Math.max(0, (bodyWidth - rowWidth) / 2);
    const y = top + (lineIndex + 1) * tokenLayout.lineHeight;
    const positions = line.map((token) => {
      const position = { token, x, y, width: token.width };
      x += token.width + tokenLayout.fontSize * 0.28;
      return position;
    });
    const highlights = positions.map(({ token, x: tokenX, y: baseline, width }, index) => {
      if (!highlightEnabled || !activeTokenIndexes.has(Number(token.index))) return '';
      const previous = positions[index - 1];
      const next = positions[index + 1];
      const horizontal = highlightPadding;
      const leftGap = previous ? tokenX - (previous.x + previous.width) : Infinity;
      const rightGap = next ? next.x - (tokenX + width) : Infinity;
      const padLeft = Math.min(horizontal, Number.isFinite(leftGap) ? Math.max(0, leftGap / 2 - 0.5) : horizontal);
      const padRight = Math.min(horizontal, Number.isFinite(rightGap) ? Math.max(0, rightGap / 2 - 0.5) : horizontal);
      const vertical = highlightPadding;
      const boxHeight = tokenLayout.fontSize * 1.14;
      const boxY = baseline - tokenLayout.fontSize * 0.87 - vertical;
      return `<rect x="${(tokenX - padLeft).toFixed(1)}" y="${boxY.toFixed(1)}" width="${(width + padLeft + padRight).toFixed(1)}" height="${(boxHeight + vertical * 2).toFixed(1)}" rx="${highlightRadius}" fill="${highlightColor}"/>`;
    }).join('');
    const textX = c.layout === 'left' ? bodyLeft : bodyLeft + bodyWidth / 2;
    const textAnchor = c.layout === 'left' ? 'start' : 'middle';
    const items = `<text x="${textX.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${textAnchor}" class="body">${line.map((token, index) => {
      const isActive = highlightEnabled && activeTokenIndexes.has(Number(token.index));
      const dx = index && !token.joinPrevious ? ` dx="${(tokenLayout.fontSize * 0.28).toFixed(1)}"` : '';
      return `<tspan${dx} fill="${isActive ? '#FFFFFF' : c.bodyColor}"${isActive ? ' font-weight="700"' : ''}>${escapeXml(token.text)}</tspan>`;
    }).join('')}</text>`;
    return `${highlights}${items}`;
  }).join('');
  const brandX = 1080 * c.brandCenterXPct / 100;
  const brandY = 1920 * c.brandTopPct / 100 + c.brandSizePx;
  const effectMarkup = renderBackgroundEffectMarkup(backgroundEffect.backgroundEffect || 'bubbles', {
    width: 1080, height: 1920, time: effectTime, seed: content?.id || content?.title || 'mot-phut-vo-le',
    density: backgroundEffect.backgroundEffectDensity, speed: backgroundEffect.backgroundEffectSpeed,
    opacity: backgroundEffect.backgroundEffectOpacity, contentLanguage: 'vi'
  });
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920" data-fit="true" data-size="${tokenLayout.fontSize}">
      ${backgroundSvg(c.paperColor, design.preset)}
      ${backgroundAdjustments(c.vignette, 0, 1080, 1920)}
      ${effectMarkup}
      <rect x="${c.padding}" y="92" width="${1080 - c.padding * 2}" height="1728" rx="30" fill="none" stroke="${c.accent}" stroke-opacity=".22" stroke-width="2"/>
      <rect x="${c.padding + 8}" y="${c.padding + 8}" width="92" height="8" rx="4" fill="${c.accent}"/>
      <text x="${brandX}" y="${brandY}" text-anchor="middle" class="brand" data-source-brand="top">${escapeXml(c.brand)}</text>
      ${titleMarkup}
      ${bodyMarkup}
      <line x1="${c.padding + 36}" y1="1712" x2="${1080 - c.padding - 36}" y2="1712" stroke="${theme.mutedColor}" stroke-opacity=".32" stroke-width="2"/>
      <text x="540" y="1786" text-anchor="middle" class="watermark">${escapeXml(c.watermark)}</text>
      <style>.brand,.title,.watermark{font-family:${escapeCssFont(c.fontFamily)}}.brand{font-size:${c.brandSizePx}px;font-weight:700;letter-spacing:2px;fill:${c.brandColor}}.title{font-size:${title.fontSize}px;font-weight:700;fill:${c.textColor}}.body{font-family:${escapeCssFont(c.bodyFont)};font-size:${tokenLayout.fontSize}px}.watermark{font-size:27px;fill:${c.mutedColor}}</style>
    </svg>`;
}

function buildPosterContentSvg({ content, design, tokenLayout, activeTokenIndexes = new Set(), backgroundEffect = {}, effectTime = 0 }) {
  const c = design.content;
  const brandX = 1080 * c.brandCenterXPct / 100;
  const brandY = 1920 * c.brandTopPct / 100 + c.brandSizePx;
  const brandSegments = splitBrand(c.brand);
  const brandMarkup = c.brandVisible
    ? `<text x="${brandX}" y="${brandY}" font-size="${c.brandSizePx}" text-anchor="middle" class="brand" data-source-brand="top" data-mpvl-content-text="brand" data-mpvl-content-font="serif" data-mpvl-letter-spacing="1"><tspan fill="${c.brandColorA}">${escapeXml(brandSegments[0].trimEnd())}</tspan><tspan dx="${(c.brandSizePx * 0.28).toFixed(1)}" fill="${c.brandColorB}">${escapeXml(brandSegments[1])}</tspan></text>`
    : '';
  const title = fitPosterContentTitle(content?.title, c);
  const titleLineHeight = title.fontSize * 1.12;
  const titleTop = 1920 * c.titleTopPct / 100;
  const fontRole = c.bodyFont.toLowerCase().includes('georgia') ? 'serif' : 'sans';
  const fontFamily = fontRole === 'serif' ? 'Georgia,serif' : 'Arial,sans-serif';
  const titleMarkup = title.lines.map((line, index) => {
    const baseline = titleTop + title.fontSize + index * titleLineHeight;
    return `<text class="title" data-mpvl-content-text="title" data-mpvl-content-font="${fontRole}" font-size="${title.fontSize}" x="540" y="${baseline.toFixed(1)}" text-anchor="middle"><tspan fill="${c.titleColor}">${escapeXml(line)}</tspan></text>`;
  }).join('');
  const frame = posterBodyFrame(c);
  const bodyTop = frame.top;
  const bodyLeft = 1080 * c.contentLeftPct / 100;
  const bodyWidth = Math.max(1, Math.min(1080 * c.contentWidthPct / 100, 1080 - bodyLeft));
  const bodyCenter = bodyLeft + bodyWidth / 2;
  const highlightEnabled = backgroundEffect.highlightEnabled !== false;
  const highlightColor = /^#[\da-f]{6}$/iu.test(String(backgroundEffect.highlightColor || ''))
    ? String(backgroundEffect.highlightColor).toUpperCase() : c.brandColorB;
  const bodyMarkup = tokenLayout.lines.map((line, lineIndex) => {
    const baseline = bodyTop + tokenLayout.fontSize + lineIndex * tokenLayout.lineHeight;
    const spans = line.map((token, index) => {
      const isActive = highlightEnabled && activeTokenIndexes.has(Number(token.index));
      const gap = index && !token.joinPrevious ? ` dx="${(tokenLayout.fontSize * 0.28).toFixed(1)}"` : '';
      return `<tspan${gap} fill="${isActive ? highlightColor : c.bodyColor}">${escapeXml(token.text)}</tspan>`;
    }).join('');
    return `<text class="body" data-mpvl-body-line="${lineIndex}" data-mpvl-content-text="body" data-mpvl-content-font="${fontRole}" font-size="${tokenLayout.fontSize}" x="${bodyCenter.toFixed(1)}" y="${baseline.toFixed(1)}" text-anchor="middle">${spans}</text>`;
  }).join('');
  const effectMarkup = renderBackgroundEffectMarkup(backgroundEffect.backgroundEffect || 'bubbles', {
    width: 1080, height: 1920, time: effectTime, seed: content?.id || content?.title || 'mot-phut-vo-le',
    density: backgroundEffect.backgroundEffectDensity, speed: backgroundEffect.backgroundEffectSpeed,
    opacity: backgroundEffect.backgroundEffectOpacity, contentLanguage: 'vi'
  });
  const paper = { paperColor: c.paperColor, vignette: c.vignette, bottomShade: c.bottomShade };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920" data-fit="true" data-size="${tokenLayout.fontSize}">${posterPaperSvg(paper)}${effectMarkup}${brandMarkup}${titleMarkup}${bodyMarkup}<style>.brand{font-family:Georgia,serif;font-size:${c.brandSizePx}px;font-weight:700;letter-spacing:1px}.body,.title{font-family:${fontFamily};font-weight:700}.body{font-size:${tokenLayout.fontSize}px}.title{font-size:${title.fontSize}px}</style></svg>`;
}

function fitPosterContentTitle(value, contentStyle) {
  const words = String(value || '').normalize('NFC').trim().split(/\s+/u).filter(Boolean);
  const maxWidth = Math.min(1080 * contentStyle.titleWidthPct / 100, 1080);
  const maxLines = 2;
  const fits = (size) => {
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && measureText(next, size, 'MPVL Arial Bold') > maxWidth) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
    return lines.length <= maxLines && lines.every((item) => measureText(item, size, 'MPVL Arial Bold') <= maxWidth) ? lines : null;
  };
  for (let size = Math.min(100, Math.max(46, contentStyle.titleFontSize)); size >= 44; size -= 1) {
    const lines = fits(size);
    if (lines) return { lines, fontSize: size };
  }
  throw new Error('Tiêu đề nội dung MPVL quá dài để hiển thị trên khung 9:16.');
}

function buildContentSvgLegacy({ content, design, tokenLayout, activeTokenIndexes = new Set(), backgroundEffect = {}, effectTime = 0 }) {
  const theme = MOT_PHUT_VO_LE_PRESETS[design.preset];
  const c = design.content;
  const highlightEnabled = backgroundEffect.highlightEnabled !== false;
  const highlightColor = /^#[\da-f]{6}$/iu.test(String(backgroundEffect.highlightColor || ''))
    ? String(backgroundEffect.highlightColor).toUpperCase() : DEFAULT_HIGHLIGHT_SETTINGS.highlightColor;
  const highlightPadding = clampInteger(backgroundEffect.highlightPadding, DEFAULT_HIGHLIGHT_SETTINGS.highlightPadding, 0, 24);
  const highlightRadius = clampInteger(backgroundEffect.highlightRadius, DEFAULT_HIGHLIGHT_SETTINGS.highlightRadius, 0, 32);
  const title = fitTextLines(content.title, c.titleFontSize, 840, 3, 42);
  const titleY = 455;
  const titleMarkup = title.lines.map((line, index) => `<text x="540" y="${titleY + (index + 1) * title.fontSize * 1.16}" text-anchor="middle" class="title">${escapeXml(line)}</text>`).join('');
  const titleBottom = titleY + title.lines.length * title.fontSize * 1.16;
  const bodyStartY = Math.max(650, titleBottom + 45);
  const bodyHeight = tokenLayout.lines.length * tokenLayout.lineHeight;
  const top = Math.max(bodyStartY, bodyStartY + Math.floor((Math.min(850, 1580 - bodyStartY) - bodyHeight) / 2));
  const bodyMarkup = tokenLayout.lines.map((line, lineIndex) => {
    const rowWidth = line.reduce((total, token, index) => total + token.width + (index ? tokenLayout.fontSize * 0.28 : 0), 0);
    let x = (1080 - rowWidth) / 2;
    const y = top + (lineIndex + 1) * tokenLayout.lineHeight;
    const positions = line.map((token) => {
      const position = { token, x, y, width: token.width };
      x += token.width + tokenLayout.fontSize * 0.28;
      return position;
    });
    const highlights = positions.map(({ token, x: tokenX, y: baseline, width }, index) => {
      if (!highlightEnabled || !activeTokenIndexes.has(Number(token.index))) return '';
      const previous = positions[index - 1];
      const next = positions[index + 1];
      const leftGap = previous ? tokenX - (previous.x + previous.width) : Infinity;
      const rightGap = next ? next.x - (tokenX + width) : Infinity;
      const padLeft = Math.min(highlightPadding, Number.isFinite(leftGap) ? Math.max(0, leftGap / 2 - 0.5) : highlightPadding);
      const padRight = Math.min(highlightPadding, Number.isFinite(rightGap) ? Math.max(0, rightGap / 2 - 0.5) : highlightPadding);
      const boxHeight = tokenLayout.fontSize * 1.14;
      const boxY = baseline - tokenLayout.fontSize * 0.87 - highlightPadding;
      return `<rect x="${(tokenX - padLeft).toFixed(1)}" y="${boxY.toFixed(1)}" width="${(width + padLeft + padRight).toFixed(1)}" height="${(boxHeight + highlightPadding * 2).toFixed(1)}" rx="${highlightRadius}" fill="${highlightColor}"/>`;
    }).join('');
    const textX = c.layout === 'left' ? bodyLeft : 540;
    const textAnchor = c.layout === 'left' ? 'start' : 'middle';
    const items = `<text x="${textX.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${textAnchor}" class="body">${line.map((token, index) => {
      const isActive = highlightEnabled && activeTokenIndexes.has(Number(token.index));
      const dx = index && !token.joinPrevious ? ` dx="${(tokenLayout.fontSize * 0.28).toFixed(1)}"` : '';
      return `<tspan${dx} fill="${isActive ? '#FFFFFF' : c.textColor}"${isActive ? ' font-weight="700"' : ''}>${escapeXml(token.text)}</tspan>`;
    }).join('')}</text>`;
    return `${highlights}${items}`;
  }).join('');
  const effectMarkup = renderBackgroundEffectMarkup(backgroundEffect.backgroundEffect || 'bubbles', {
    width: 1080, height: 1920, time: effectTime, seed: content?.id || content?.title || 'mot-phut-vo-le',
    density: backgroundEffect.backgroundEffectDensity, speed: backgroundEffect.backgroundEffectSpeed,
    opacity: backgroundEffect.backgroundEffectOpacity, contentLanguage: 'vi'
  });
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
      ${backgroundSvg(c.background, design.preset)}${effectMarkup}
      <rect x="${c.padding}" y="92" width="${1080 - c.padding * 2}" height="1728" rx="30" fill="none" stroke="${c.accent}" stroke-opacity=".22" stroke-width="2"/>
      <rect x="${c.padding + 8}" y="${c.padding + 8}" width="92" height="8" rx="4" fill="${c.accent}"/>
      <text x="540" y="${c.padding + 68}" text-anchor="middle" class="brand">${escapeXml(c.brand)}</text>
      ${titleMarkup}${bodyMarkup}
      <line x1="${c.padding + 36}" y1="1712" x2="${1080 - c.padding - 36}" y2="1712" stroke="${theme.mutedColor}" stroke-opacity=".32" stroke-width="2"/>
      <text x="540" y="1786" text-anchor="middle" class="watermark">${escapeXml(c.watermark)}</text>
      <style>.brand,.title,.body,.watermark{font-family:${escapeCssFont(c.fontFamily)}}.brand{font-size:28px;font-weight:700;letter-spacing:2px;fill:${theme.brandColor}}.title{font-size:${title.fontSize}px;font-weight:700;fill:${c.textColor}}.body{font-size:${tokenLayout.fontSize}px}.watermark{font-size:27px;fill:${c.mutedColor}}</style>
    </svg>`;
}

const MOT_PHUT_THUMBNAIL_STOP_WORDS = new Set([
  'a', 'anh', 'bao', 'b\u1ecb', 'b\u1edfi', 'c\u00e1c', 'c\u00e1i', 'cho', 'ch\u1ec9', 'ch\u00ednh', 'ch\u1ee9',
  'c\u00f3', 'c\u00f9ng', 'c\u0169ng', 'c\u1ee7a', '\u0111\u00e3', '\u0111\u1ec3', '\u0111\u1ebfn', '\u0111\u00f3',
  '\u0111\u01b0\u1ee3c', 'g\u00ec', 'hay', 'ho\u1eb7c', 'khi', 'kh\u00f4ng', 'l\u00e0', 'l\u00e0m', 'm\u00e0',
  'm\u1ed7i', 'm\u1ed9t', 'n\u00e0o', 'n\u00e0y', 'nh\u01b0', 'nh\u1eefng', '\u1edf', 'qua', 'r\u1ea5t', 'r\u1eb1ng',
  'sao', 'sau', 's\u1ebd', 't\u1ea1i', 'theo', 'th\u00ec', 'tr\u00ean', 't\u1eeb', 'v\u00e0', 'v\u1ec1', 'v\u00ec',
  'v\u1edbi', 'v\u1eeba'
]);

function normalizeMotPhutHeadlineWord(value) {
  return String(value ?? '').normalize('NFC').toLocaleLowerCase('vi-VN').replace(/[^\p{L}\p{N}]/gu, '');
}

function resolveMotPhutThumbnailHighlights(title, requested) {
  const explicit = String(requested || '').normalize('NFC').split(/[\s,;]+/u)
    .map(normalizeMotPhutHeadlineWord).filter(Boolean);
  if (explicit.length) return new Set(explicit);
  const words = String(title || '').normalize('NFC').split(/\s+/u).map(normalizeMotPhutHeadlineWord).filter(Boolean);
  const selected = words.filter((word) => word.length > 1 && !MOT_PHUT_THUMBNAIL_STOP_WORDS.has(word));
  const candidates = selected.length ? selected : words;
  return new Set(candidates.slice().sort((left, right) => right.length - left.length).slice(0, 1));
}

async function buildThumbnailPreviewSvg(content, design) {
  const c = design.thumbnail;
  const width = 1080;
  const height = 1920;
  const highlights = resolveMotPhutThumbnailHighlights(content?.title, content?.thumbnailHighlight);
  const title = await posterHeadlineLayout(content?.title, c);
  const lines = posterHeadlineMarkup(title, c, highlights);
  const brandX = width * c.brandCenterXPct / 100;
  const brandFont = getMotPhutVoLeHeadlineFont(c.brandFont);
  const brandFontSize = Number((c.brandSizePx * brandFont.brandOpticalScale).toFixed(2));
  const brandY = height * c.brandTopPct / 100 + brandFontSize;
  const brandSegments = splitBrand(c.brand);
  const brandFallback = brandFont.serif ? 'serif' : 'sans-serif';
  const brandMarkup = c.brandVisible ? `<text x="${brandX}" y="${brandY}" font-size="${brandFontSize}" text-anchor="middle" class="brand" data-source-brand="top" data-mpvl-brand-font="${c.brandFont}" data-mpvl-letter-spacing="2" style="font-family:${escapeCssFont(brandFont.cssFamily)},${brandFallback}"><tspan fill="${c.brandColorA}">${escapeXml(brandSegments[0].trimEnd())}</tspan><tspan dx="${(brandFontSize * 0.28).toFixed(1)}" fill="${c.brandColorB}">${escapeXml(brandSegments[1])}</tspan></text>` : '';
  const watermarkX = width * c.watermarkCenterXPct / 100;
  const watermarkY = height * c.watermarkTopPct / 100;
  const watermarkMarkup = c.watermarkVisible ? `<text x="${watermarkX}" y="${watermarkY}" text-anchor="middle" class="watermark" data-source-watermark="top">${escapeXml(c.watermark)}</text>` : '';
  const headlineMarkup = c.headlineVisible ? `<g data-source-headline="top">${lines}</g>` : '';
  const headlineFont = getMotPhutVoLeHeadlineFont(c.headlineFont);
  const headlineFamily = headlineFont.cssFamily;
  const headlineFallback = headlineFont.serif ? 'serif' : 'sans-serif';
  const outlineWidth = title.fontSize * 0.07;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-fit="${title.fits}" data-size="${Math.round(title.fontSize)}">${thumbnailPaperSvg(c)}${brandMarkup}${headlineMarkup}${watermarkMarkup}<style>.brand{font-family:${escapeCssFont(brandFont.cssFamily)},${brandFallback};font-size:${brandFontSize}px;font-weight:700;letter-spacing:2px}.watermark{font-family:${escapeCssFont(c.watermarkFontFamily)};font-size:${c.watermarkSizePx}px;fill:${c.watermarkColor};opacity:${c.watermarkOpacity}}.headline{font-family:${escapeCssFont(headlineFamily)},${headlineFallback};font-size:${title.fontSize}px;font-weight:${headlineFont.serif ? 700 : 900};stroke:${c.outlineColor};stroke-width:${outlineWidth}px;stroke-linejoin:round;paint-order:stroke fill;filter:url(#mpvl-headline-shadow)}</style></svg>`;
}

async function posterHeadlineLayout(value, style) {
  const left = 1080 * style.headlineLeftPct / 100;
  const top = 1920 * style.headlineTopPct / 100;
  const boxWidth = Math.max(1, Math.min(1080 * style.headlineWidthPct / 100, 1080 - left));
  const boxHeight = Math.max(1, Math.min(1920 * style.headlineHeightPct / 100, 1920 - top));
  const sourceTitle = String(value ?? '');
  const words = sourceTitle.trim().split(/\s+/u).filter(Boolean);
  const fitted = style.headlineVisible
    ? await layoutPosterHeadline(words, style)
    : { lines: [], fontSize: style.headlineMaxPx, fits: true, lineHeight: 0, textHeights: [], outlinePadding: 0, blockHeight: 0 };
  return { ...fitted, left, top, boxWidth, boxHeight };
}

function posterHeadlineMarkup(title, style, highlights = new Set()) {
  const wordGap = estimateHeadlineWidth(' ', title.fontSize);
  return title.lines.map((line, index) => {
    const pieces = line.map((word, wordIndex) => {
      const normalized = normalizeMotPhutHeadlineWord(word);
      const fill = highlights.has(normalized) ? style.highlightColor : style.textColor;
      return `<tspan${wordIndex ? ` dx="${wordGap}"` : ''} fill="${fill}">${escapeXml(word)}</tspan>`;
    }).join('');
    const lineTop = title.top + Math.max(0, (title.boxHeight - title.blockHeight) / 2) + index * title.lineHeight;
    const baseline = lineTop + title.outlinePadding + title.textHeights[index];
    return `<text data-mpvl-headline-line="${index}" data-mpvl-font="${style.headlineFont}" font-size="${title.fontSize}" x="${title.left + title.boxWidth / 2}" y="${baseline}" text-anchor="middle" class="headline">${pieces}</text>`;
  }).join('');
}

function posterBodyFrame(contentStyle) {
  const top = 1920 * contentStyle.contentTopPct / 100;
  const bottom = 1920 * 0.96;
  const configuredHeight = 1920 * contentStyle.contentHeightPct / 100;
  return { top, height: Math.max(1, Math.min(configuredHeight, bottom - top)) };
}

function estimateHeadlineWidth(value, fontSize) {
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

async function layoutPosterHeadline(words, style) {
  const roomWidth = 1080 * style.headlineWidthPct / 100;
  const fontSize = Number(style.headlineMaxPx) || 40;
  const fontMode = style.headlineFont;
  const outlinePadding = Math.ceil(fontSize * 0.035) + 2;
  const lineGap = Math.max(8, fontSize * 0.055);
  const lines = [];
  let line = [];
  for (const word of words) {
    const candidate = [...line, word];
    const metrics = await measureMotPhutVoLeHeadlineLine(candidate, fontMode);
    if (line.length && metrics.widthPerPixel * fontSize + outlinePadding * 2 > roomWidth) {
      lines.push(line);
      line = [word];
    } else {
      line = candidate;
    }
  }
  if (line.length) lines.push(line);
  const metricsPerLine = await Promise.all(lines.map((items) => measureMotPhutVoLeHeadlineLine(items, fontMode)));
  const textHeights = metricsPerLine.map((metrics) => metrics.heightPerPixel * fontSize);
  const rowHeight = lines.length ? Math.max(...textHeights) + outlinePadding * 2 + 6 : 0;
  const lineHeight = rowHeight + lineGap;
  const blockHeight = lines.length ? rowHeight * lines.length + lineGap * Math.max(0, lines.length - 1) : 0;
  return { lines, fontSize, fits: true, lineHeight, textHeights, outlinePadding, blockHeight };
}

function thumbnailPaperSvg(style) {
  const seed = 21;
  return `<defs>
    <filter id="mpvl-paper-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9 0.5" numOctaves="3" seed="${seed}"/><feColorMatrix type="matrix" values="0 0 0 0 0.3 0 0 0 0 0.3 0 0 0 0 0.3 0 0 0 0.55 -0.12"/></filter>
    <filter id="mpvl-paper-stains" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.004 0.006" numOctaves="2" seed="${seed + 7}"/><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1.4 -0.45"/></filter>
    <radialGradient id="mpvl-paper-vignette" cx="50%" cy="45%" r="71%"><stop offset="55%" stop-color="#000000" stop-opacity="0"/><stop offset="100%" stop-color="#3C230A" stop-opacity="${style.vignette}"/></radialGradient>
    ${style.bottomShade > 0 ? `<linearGradient id="mpvl-paper-bottom" x1="0" y1="0" x2="0" y2="1"><stop offset="50%" stop-color="#3C230A" stop-opacity="0"/><stop offset="100%" stop-color="#3C230A" stop-opacity="${style.bottomShade}"/></linearGradient>` : ''}
    <filter id="mpvl-headline-shadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#281405" flood-opacity=".45"/></filter>
  </defs>
  <rect width="1080" height="1920" fill="${style.paperColor}"/>
  <rect width="1080" height="1920" filter="url(#mpvl-paper-stains)" opacity=".3"/>
  <rect width="1080" height="1920" filter="url(#mpvl-paper-grain)" opacity=".5"/>
  <rect width="1080" height="1920" fill="url(#mpvl-paper-vignette)"/>
  ${style.bottomShade > 0 ? '<rect width="1080" height="1920" fill="url(#mpvl-paper-bottom)"/>' : ''}`;
}

const posterPaperTextureCache = new Map();

function posterPaperSvg(style) {
  const cacheKey = JSON.stringify([style.paperColor, style.vignette, style.bottomShade]);
  if (posterPaperTextureCache.has(cacheKey)) return posterPaperTextureCache.get(cacheKey);
  let seed = 0x51a7;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const patches = Array.from({ length: 90 }, () => {
    const x = random() * 1080;
    const y = random() * 1920;
    const rx = 28 + random() * 105;
    const ry = 15 + random() * 72;
    const angle = Math.round((random() - 0.5) * 70);
    const tone = random() > 0.34 ? '#765333' : '#F5DDB9';
    const opacity = (0.018 + random() * 0.035).toFixed(3);
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${tone}" opacity="${opacity}" transform="rotate(${angle} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }).join('');
  const fibers = Array.from({ length: 1800 }, () => {
    const x = random() * 1080;
    const y = random() * 1920;
    const radius = 0.35 + random() * 1.75;
    const tone = random() > 0.28 ? '#704C2E' : '#F6E2C4';
    const opacity = (0.045 + random() * 0.1).toFixed(3);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(2)}" fill="${tone}" opacity="${opacity}"/>`;
  }).join('');
  const vignette = Math.max(0, Math.min(1, Number(style.vignette) || 0));
  const bottom = Math.max(0, Math.min(1, Number(style.bottomShade) || 0));
  const svg = `<defs><filter id="poster-paper-stain-blur"><feGaussianBlur stdDeviation="27"/></filter><radialGradient id="poster-paper-vignette" cx="50%" cy="46%" r="72%"><stop offset="50%" stop-color="#000000" stop-opacity="0"/><stop offset="100%" stop-color="#3C230A" stop-opacity="${vignette}"/></radialGradient>${bottom > 0 ? `<linearGradient id="poster-paper-bottom" x1="0" y1="0" x2="0" y2="1"><stop offset="55%" stop-color="#3C230A" stop-opacity="0"/><stop offset="100%" stop-color="#3C230A" stop-opacity="${bottom}"/></linearGradient>` : ''}</defs><rect width="1080" height="1920" fill="${style.paperColor}"/><rect width="1080" height="1920" fill="#765333" opacity=".055"/><g filter="url(#poster-paper-stain-blur)">${patches}</g>${fibers}<rect width="1080" height="1920" fill="url(#poster-paper-vignette)"/>${bottom > 0 ? '<rect width="1080" height="1920" fill="url(#poster-paper-bottom)"/>' : ''}`;
  posterPaperTextureCache.set(cacheKey, svg);
  return svg;
}

function fitTextBlock(value, maxSize, maxWidth, maxHeight, lineHeightFactor, minSize = 32) {
  for (let fontSize = Math.max(minSize, Math.min(400, Number(maxSize) || 60)); fontSize >= minSize; fontSize -= 1) {
    const lines = wrapText(value, fontSize, maxWidth);
    if (lines.length * fontSize * lineHeightFactor <= maxHeight && lines.every((line) => measureText(line, fontSize) <= maxWidth)) return { lines, fontSize };
  }
  throw new Error('Tiêu đề mẫu không vừa vùng thiết kế. Hãy mở rộng vùng hoặc rút gọn tiêu đề.');
}

function wrapText(value, fontSize, maxWidth) {
  const words = String(value || '').normalize('NFC').trim().split(/\s+/u).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measureText(next, fontSize) > maxWidth) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function splitBrand(value) {
  const words = String(value || '').trim().split(/\s+/u).filter(Boolean);
  const split = Math.ceil(words.length / 2);
  return [`${words.slice(0, split).join(' ')}${words.length ? ' ' : ''}`, words.slice(split).join(' ')];
}

function backgroundAdjustments(vignette, bottomShade, width, height) {
  const vignetteOpacity = Math.max(0, Math.min(1, Number(vignette) || 0));
  const shadeOpacity = Math.max(0, Math.min(1, Number(bottomShade) || 0));
  const vignetteMarkup = vignetteOpacity > 0
    ? `<defs><radialGradient id="mot-vignette" cx="50%" cy="50%" r="72%"><stop offset="56%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="${vignetteOpacity}"/></radialGradient></defs><rect width="${width}" height="${height}" fill="url(#mot-vignette)"/>` : '';
  const shadeMarkup = shadeOpacity > 0
    ? `<defs><linearGradient id="mot-bottom-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="52%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="${shadeOpacity}"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#mot-bottom-shade)"/>` : '';
  return `${vignetteMarkup}${shadeMarkup}`;
}

function wrapTextAtFixedSize(value, fontSize, maxWidth) {
  const words = String(value ?? '').split(/\s+/u).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measureText(next, fontSize) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitTextLines(value, initialSize, maxWidth, maxLines, minSize) {
  const words = String(value || '').normalize('NFC').trim().split(/\s+/u).filter(Boolean);
  for (let fontSize = Math.max(minSize, Math.min(132, Number(initialSize) || 60)); fontSize >= minSize; fontSize -= 1) {
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && measureText(next, fontSize) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines && lines.every((item) => measureText(item, fontSize) <= maxWidth)) return { lines, fontSize };
  }
  const fallbackSize = minSize;
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measureText(next, fallbackSize) > maxWidth) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) throw new Error('Tiêu đề quá dài để hiển thị mà không bị cắt; hãy rút gọn tiêu đề.');
  return { lines, fontSize: fallbackSize };
}

function backgroundSvg(color, preset) {
  if (preset === 'dark-knowledge') return `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#202C4C"/></linearGradient><radialGradient id="glow"><stop offset="0" stop-color="#58D8F0" stop-opacity=".12"/><stop offset="1" stop-color="#58D8F0" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/><ellipse cx="810" cy="280" rx="520" ry="450" fill="url(#glow)"/>`;
  return `<defs><linearGradient id="paper" x1="0" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#F3EADB"/></linearGradient><pattern id="grain" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="3" cy="7" r=".7" fill="#8E795C" opacity=".07"/><circle cx="17" cy="16" r=".6" fill="#8E795C" opacity=".05"/></pattern></defs><rect width="100%" height="100%" fill="url(#paper)"/><rect width="100%" height="100%" fill="url(#grain)"/>`;
}

function parseHexColor(value) {
  const match = /^#([\da-f]{6})$/iu.exec(String(value || ''));
  if (!match) return { r: 233, g: 223, b: 200, alpha: 1 };
  return {
    r: Number.parseInt(match[1].slice(0, 2), 16),
    g: Number.parseInt(match[1].slice(2, 4), 16),
    b: Number.parseInt(match[1].slice(4, 6), 16),
    alpha: 1
  };
}

function escapeXml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function escapeCssFont(value) {
  return String(value || 'Arial, sans-serif').replace(/[{}<>;]/gu, '');
}

async function rasterizeSvg(svg, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return outputPath;
}

async function rasterizeThumbnailSvg(svg, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const image = await renderMotPhutVoLeThumbnailSvg(svg);
  await sharp(image).png().toFile(outputPath);
  return outputPath;
}

function ffconcatQuote(value) {
  return path.resolve(value).replace(/\\/gu, '/').replace(/'/gu, "'\\''");
}

function safeDirectoryToken(value) {
  return String(value || 'draft').replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, 100) || 'draft';
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function effectiveDesign(value) {
  const normalized = normalizeMotPhutVoLeVisualDesign(value);
  return normalized.enabled ? normalized : normalizeMotPhutVoLeVisualDesign({ preset: normalized.preset, schemaVersion: normalized.schemaVersion });
}

function run(command, args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(command)} exceeded ${timeoutMs} ms.`)); }, timeoutMs);
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

async function probeMedia(file) {
  const output = await runCapture(FFPROBE_BIN, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,pix_fmt,sample_rate', '-of', 'json', file]);
  try { return JSON.parse(output); }
  catch { throw new Error('FFprobe trả về metadata không hợp lệ.'); }
}

function runCapture(command, args, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(command)} timed out.`)); }, timeoutMs);
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`${path.basename(command)} failed: ${stderr.slice(-600)}`)); });
  });
}

function validateRenderedVideo(metadata, expectedAudioDuration) {
  const video = metadata.streams?.find((stream) => Number(stream.width) > 0);
  const audio = metadata.streams?.find((stream) => stream.codec_name === 'aac');
  if (!video || video.codec_name !== 'h264' || Number(video.width) !== 1080 || Number(video.height) !== 1920 || video.pix_fmt !== 'yuv420p' || !audio) {
    throw new Error('FFprobe xác nhận video không đúng thông số MP4/H.264/AAC/1080×1920/yuv420p.');
  }
  const duration = Number(metadata.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || Math.abs(duration - expectedAudioDuration) > 0.12) {
    throw new Error(`Thời lượng video/audio lệch quá 0,12 giây (video ${duration}, audio ${expectedAudioDuration}).`);
  }
}
