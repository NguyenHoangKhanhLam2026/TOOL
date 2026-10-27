const HEX = /^#[\da-f]{6}$/iu;
const number = (value, fallback, min, max, digits = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const factor = 10 ** digits;
  return Math.round(Math.max(min, Math.min(max, parsed)) * factor) / factor;
};
const color = (value, fallback) => HEX.test(String(value || '').trim()) ? String(value).trim().toUpperCase() : fallback;
const text = (value, fallback, max = 90) => String(value ?? fallback).trim().slice(0, max);

export const THINGS_YOU_DIDNT_KNOW_VISUAL_DESIGN_KEY = 'thingsYouDidntKnowVisualDesignV1';
export const THINGS_YOU_DIDNT_KNOW_VISUAL_DESIGN_DEFAULTS = Object.freeze({
  schemaVersion: 1,
  enabled: true,
  backgroundColor: '#EADCC0',
  paperShade: '#C8A97E',
  inkColor: '#191712',
  headerColor: '#24486B',
  headerEnabled: true,
  headerText: "THINGS YOU DIDN'T KNOW",
  headerFontSize: 32,
  highlightColor: '#00C9B7',
  highlightPadding: 5,
  highlightRadius: 8,
  headingFont: 'serif',
  bodyFont: 'serif',
  titleFontSize: 68,
  bodyFontSize: 50,
  lineHeight: 1.22,
  titleTopPct: 38,
  bodyTopPct: 49,
  bodyHeightPct: 40,
  horizontalMarginPct: 9,
  illustrationEnabled: true,
  illustrationStyle: 'auto',
  illustrationTopPct: 9,
  illustrationHeightPct: 26,
  headerTopPct: 3.8,
  handleBottomPct: 4.6,
  textAlign: 'left',
  texture: 'paper',
  effect: 'none',
  handle: '@ThingsYouDidntKnow',
  thumbnail: Object.freeze({
    backgroundColor: '#C8A97E',
    bottomColor: '#7A5A3A',
    headlineColor: '#FFFFFF',
    outlineColor: '#3B2412',
    highlightColor: '#00C9B7',
    brandColor: '#1B2A6B',
    titleFontSize: 122,
    headlineTopPct: 28,
    headlineWidthPct: 82,
    brandTopPct: 4.2
  })
});

export function normalizeThingsYouDidntKnowVisualDesign(input = {}) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const thumb = value.thumbnail && typeof value.thumbnail === 'object' ? value.thumbnail : {};
  const d = THINGS_YOU_DIDNT_KNOW_VISUAL_DESIGN_DEFAULTS;
  return Object.freeze({
    schemaVersion: 1,
    enabled: value.enabled !== false,
    backgroundColor: color(value.backgroundColor, d.backgroundColor),
    paperShade: color(value.paperShade, d.paperShade),
    inkColor: color(value.inkColor, d.inkColor),
    headerColor: color(value.headerColor, d.headerColor),
    headerEnabled: value.headerEnabled !== false,
    headerText: text(value.headerText, d.headerText, 64),
    headerFontSize: number(value.headerFontSize, d.headerFontSize, 18, 52),
    highlightColor: color(value.highlightColor, d.highlightColor),
    highlightPadding: number(value.highlightPadding, d.highlightPadding, 0, 24),
    highlightRadius: number(value.highlightRadius, d.highlightRadius, 0, 32),
    headingFont: ['serif', 'sans', 'display'].includes(value.headingFont) ? value.headingFont : d.headingFont,
    bodyFont: ['serif', 'sans'].includes(value.bodyFont) ? value.bodyFont : d.bodyFont,
    titleFontSize: number(value.titleFontSize, d.titleFontSize, 40, 110),
    bodyFontSize: number(value.bodyFontSize, d.bodyFontSize, 32, 62),
    lineHeight: number(value.lineHeight, d.lineHeight, 1, 1.6, 2),
    titleTopPct: number(value.titleTopPct, d.titleTopPct, 30, 48, 1),
    bodyTopPct: number(value.bodyTopPct, d.bodyTopPct, 44, 58, 1),
    bodyHeightPct: number(value.bodyHeightPct, d.bodyHeightPct, 25, 45, 1),
    horizontalMarginPct: number(value.horizontalMarginPct, d.horizontalMarginPct, 8, 18, 1),
    illustrationEnabled: value.illustrationEnabled !== false,
    illustrationStyle: ['auto', 'umbrella', 'food', 'transport', 'book', 'community', 'object'].includes(value.illustrationStyle) ? value.illustrationStyle : d.illustrationStyle,
    illustrationTopPct: number(value.illustrationTopPct, d.illustrationTopPct, 7, 15, 1),
    illustrationHeightPct: number(value.illustrationHeightPct, d.illustrationHeightPct, 15, 29, 1),
    headerTopPct: number(value.headerTopPct, d.headerTopPct, 2, 8, 1),
    handleBottomPct: number(value.handleBottomPct, d.handleBottomPct, 2, 8, 1),
    textAlign: ['left', 'center'].includes(value.textAlign) ? value.textAlign : d.textAlign,
    texture: ['paper', 'grain', 'plain'].includes(value.texture) ? value.texture : d.texture,
    effect: ['none', 'dust', 'slow-pan'].includes(value.effect) ? value.effect : d.effect,
    handle: text(value.handle, d.handle, 60),
    thumbnail: Object.freeze({
      backgroundColor: color(thumb.backgroundColor, d.thumbnail.backgroundColor),
      bottomColor: color(thumb.bottomColor, d.thumbnail.bottomColor),
      headlineColor: color(thumb.headlineColor, d.thumbnail.headlineColor),
      outlineColor: color(thumb.outlineColor, d.thumbnail.outlineColor),
      highlightColor: color(thumb.highlightColor, d.thumbnail.highlightColor),
      brandColor: color(thumb.brandColor, d.thumbnail.brandColor),
      titleFontSize: number(thumb.titleFontSize, d.thumbnail.titleFontSize, 56, 176),
      headlineTopPct: number(thumb.headlineTopPct, d.thumbnail.headlineTopPct, 18, 46, 1),
      headlineWidthPct: number(thumb.headlineWidthPct, d.thumbnail.headlineWidthPct, 50, 94, 1),
      brandTopPct: number(thumb.brandTopPct, d.thumbnail.brandTopPct, 2, 10, 1)
    })
  });
}

export function createThingsYouDidntKnowVisualPreset(name, design) {
  const normalizedName = String(name || '').trim().slice(0, 80);
  if (!normalizedName) throw new Error('Tên preset cần từ 1 đến 80 ký tự.');
  return { name: normalizedName, design: normalizeThingsYouDidntKnowVisualDesign(design) };
}
