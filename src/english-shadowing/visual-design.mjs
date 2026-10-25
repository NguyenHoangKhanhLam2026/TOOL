const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{6})$/iu;

export const ENGLISH_SHADOWING_VISUAL_DESIGN_KEY = 'englishShadowingVisualDesignV1';

// v3 mirrors the ThumbnailStyle and CardStyle in auto-create-upload-video-main.
// The older fields stay available so videos already saved with v1/v2 snapshots
// continue to render with their original Shadowing appearance.
export const ENGLISH_SHADOWING_VISUAL_DESIGN_DEFAULTS = Object.freeze({
  schemaVersion: 3,
  enabled: false,
  thumbnail: Object.freeze({
    introInVideo: true,
    introSeconds: 0.5,
    paperColor: '#C8A478',
    brandColorA: '#1A2A5C',
    brandColorB: '#8B1C1C',
    textColor: '#FFFFFF',
    highlightColor: '#00C9B7',
    outlineColor: '#4A2C14',
    brandTopPct: 4.5,
    brandCenterXPct: 50,
    brandSizePx: 62,
    headlineLeftPct: 10,
    headlineTopPct: 15,
    headlineHeightPct: 30,
    headlineWidthPct: 80,
    headlineMaxPx: 190,
    headlineCase: 'uppercase',
    headlineFont: 'display',
    vignette: 0.35,
    bottomShade: 0.4,
    // v1/v2 compatibility fields.
    backgroundColor: '#E8E2D8',
    titleColor: '#292824',
    accentColor: '#A7B918',
    brandColor: '#3454B7',
    titleX: 540,
    titleY: 940,
    titleFontSize: 104,
    titleMaxWidth: 850,
    titleHeight: 680,
    titleCase: 'uppercase',
    titleFont: 'display',
    outlineWidth: 6,
    highlightWords: '',
    brandX: 540,
    brandY: 250,
    showBrand: true
  }),
  content: Object.freeze({
    paperColor: '#EFE2C4',
    vignette: 0.28,
    brandColor: '#1F4AA8',
    bodyColor: '#111111',
    brandCenterXPct: 50,
    brandTopPct: 12,
    brandSizePx: 48,
    contentLeftPct: 8,
    contentTopPct: 20,
    contentWidthPct: 84,
    contentHeightPct: 58,
    bodyMaxPx: 46,
    bodyFont: 'serif',
    highlightColor: '#FF6B6B',
    highlightOpacity: 1,
    highlightRadiusPx: 0,
    highlightPadXPct: 12,
    highlightPadYPx: 2,
    highlightUnderline: 'on',
    highlightUnderlineColor: '#E00000',
    highlightTextMode: 'keep',
    highlightTextColor: '#FFFFFF',
    // v1/v2 compatibility fields.
    useCustomBackground: true,
    backgroundColor: '#EEF4F1',
    titleColor: '#17191D',
    textColor: '#17191D',
    brandColorLegacy: '#168A78',
    titleX: 540,
    titleY: 438,
    titleFontSize: 46,
    titleMaxWidth: 900,
    titleFont: 'sans',
    textX: 540,
    textY: 1000,
    textFontSize: 60,
    textMaxWidth: 800,
    textMaxHeight: 930,
    textFont: 'sans',
    brandX: 540,
    brandY: 248,
    footerX: 540,
    footerY: 1795,
    highlightRadius: 8,
    highlightPadding: 6,
    highlightUnderlineLegacy: false,
    highlightUnderlineColorLegacy: '#E00000',
    highlightTextModeLegacy: 'keep',
    highlightTextColorLegacy: '#FFFFFF',
    showBrand: true,
    showFooter: true
  })
});

function color(value, fallback) {
  const candidate = String(value ?? '').trim();
  return HEX_COLOR.test(candidate) ? candidate.toUpperCase() : fallback;
}

function bounded(value, fallback, min, max, places = 0) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) return fallback;
  const factor = 10 ** places;
  return Math.round(Math.max(min, Math.min(max, candidate)) * factor) / factor;
}

function choice(value, fallback, options) {
  return options.includes(value) ? value : fallback;
}

function text(value, fallback, maxLength = 180) {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

export function normalizeEnglishShadowingVisualDesign(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const thumbnailInput = input.thumbnail && typeof input.thumbnail === 'object' ? input.thumbnail : {};
  const contentInput = input.content && typeof input.content === 'object' ? input.content : {};
  const defaults = ENGLISH_SHADOWING_VISUAL_DESIGN_DEFAULTS;
  const schemaVersion = Number(input.schemaVersion) >= 3 ? 3 : Number(input.schemaVersion) >= 2 ? 2 : 1;
  const legacyThumbnailBrand = color(thumbnailInput.brandColor, defaults.thumbnail.brandColor);

  return {
    schemaVersion,
    enabled: input.enabled === true,
    thumbnail: {
      // Source tool style (v3).
      introInVideo: typeof thumbnailInput.introInVideo === 'boolean'
        ? thumbnailInput.introInVideo
        : schemaVersion >= 3,
      introSeconds: bounded(thumbnailInput.introSeconds, defaults.thumbnail.introSeconds, 0, 10, 2),
      paperColor: color(thumbnailInput.paperColor, defaults.thumbnail.paperColor),
      brandColorA: color(thumbnailInput.brandColorA, defaults.thumbnail.brandColorA),
      brandColorB: color(thumbnailInput.brandColorB, defaults.thumbnail.brandColorB),
      textColor: color(thumbnailInput.textColor, defaults.thumbnail.textColor),
      highlightColor: color(thumbnailInput.highlightColor, defaults.thumbnail.highlightColor),
      outlineColor: color(thumbnailInput.outlineColor, defaults.thumbnail.outlineColor),
      brandTopPct: bounded(thumbnailInput.brandTopPct, defaults.thumbnail.brandTopPct, 0, 40, 1),
      brandCenterXPct: bounded(thumbnailInput.brandCenterXPct, defaults.thumbnail.brandCenterXPct, 0, 100, 1),
      brandSizePx: bounded(thumbnailInput.brandSizePx, defaults.thumbnail.brandSizePx, 12, 200),
      headlineLeftPct: bounded(thumbnailInput.headlineLeftPct, defaults.thumbnail.headlineLeftPct, 0, 80, 1),
      headlineTopPct: bounded(thumbnailInput.headlineTopPct, defaults.thumbnail.headlineTopPct, 0, 90, 1),
      headlineHeightPct: bounded(thumbnailInput.headlineHeightPct, defaults.thumbnail.headlineHeightPct, 5, 90, 1),
      headlineWidthPct: bounded(thumbnailInput.headlineWidthPct, defaults.thumbnail.headlineWidthPct, 20, 100, 1),
      headlineMaxPx: bounded(thumbnailInput.headlineMaxPx, defaults.thumbnail.headlineMaxPx, 40, 400),
      headlineCase: choice(thumbnailInput.headlineCase, defaults.thumbnail.headlineCase, ['uppercase', 'as written']),
      headlineFont: choice(thumbnailInput.headlineFont, defaults.thumbnail.headlineFont, ['display', 'serif']),
      vignette: bounded(thumbnailInput.vignette, defaults.thumbnail.vignette, 0, 1, 2),
      bottomShade: bounded(thumbnailInput.bottomShade, defaults.thumbnail.bottomShade, 0, 1, 2),
      // v1/v2 style, retained for old video snapshots.
      backgroundColor: color(thumbnailInput.backgroundColor, defaults.thumbnail.backgroundColor),
      titleColor: color(thumbnailInput.titleColor, defaults.thumbnail.titleColor),
      accentColor: color(thumbnailInput.accentColor, defaults.thumbnail.accentColor),
      brandColor: legacyThumbnailBrand,
      titleX: bounded(thumbnailInput.titleX, defaults.thumbnail.titleX, 440, 640),
      titleY: bounded(thumbnailInput.titleY, defaults.thumbnail.titleY, 180, 1250),
      titleFontSize: bounded(thumbnailInput.titleFontSize, defaults.thumbnail.titleFontSize, 46, 150),
      titleMaxWidth: bounded(thumbnailInput.titleMaxWidth, defaults.thumbnail.titleMaxWidth, 420, 1020),
      titleHeight: bounded(thumbnailInput.titleHeight, defaults.thumbnail.titleHeight, 180, 1100),
      titleCase: choice(thumbnailInput.titleCase, schemaVersion < 2 ? 'as written' : defaults.thumbnail.titleCase, ['uppercase', 'as written']),
      titleFont: choice(thumbnailInput.titleFont, schemaVersion < 2 ? 'sans' : defaults.thumbnail.titleFont, ['display', 'serif', 'sans']),
      outlineWidth: bounded(thumbnailInput.outlineWidth, schemaVersion < 2 ? 0 : defaults.thumbnail.outlineWidth, 0, 24, 2),
      highlightWords: text(thumbnailInput.highlightWords, defaults.thumbnail.highlightWords),
      brandX: bounded(thumbnailInput.brandX, defaults.thumbnail.brandX, 220, 860),
      brandY: bounded(thumbnailInput.brandY, defaults.thumbnail.brandY, 60, 500),
      showBrand: thumbnailInput.showBrand !== false
    },
    content: {
      // Source tool style (v3).
      paperColor: color(contentInput.paperColor, defaults.content.paperColor),
      vignette: bounded(contentInput.vignette, defaults.content.vignette, 0, 1, 2),
      brandColor: color(contentInput.brandColor, defaults.content.brandColor),
      bodyColor: color(contentInput.bodyColor, defaults.content.bodyColor),
      brandCenterXPct: bounded(contentInput.brandCenterXPct, defaults.content.brandCenterXPct, 0, 100, 1),
      brandTopPct: bounded(contentInput.brandTopPct, defaults.content.brandTopPct, 0, 40, 1),
      brandSizePx: bounded(contentInput.brandSizePx, defaults.content.brandSizePx, 12, 200),
      contentLeftPct: bounded(contentInput.contentLeftPct, defaults.content.contentLeftPct, 0, 80, 1),
      contentTopPct: bounded(contentInput.contentTopPct, defaults.content.contentTopPct, 0, 90, 1),
      contentWidthPct: bounded(contentInput.contentWidthPct, defaults.content.contentWidthPct, 20, 100, 1),
      contentHeightPct: bounded(contentInput.contentHeightPct, defaults.content.contentHeightPct, 5, 90, 1),
      bodyMaxPx: bounded(contentInput.bodyMaxPx, defaults.content.bodyMaxPx, 22, 120),
      bodyFont: choice(contentInput.bodyFont, defaults.content.bodyFont, ['serif', 'display']),
      highlightColor: color(contentInput.highlightColor, defaults.content.highlightColor),
      highlightOpacity: bounded(contentInput.highlightOpacity, defaults.content.highlightOpacity, 0.1, 1, 2),
      highlightRadiusPx: bounded(contentInput.highlightRadiusPx, defaults.content.highlightRadiusPx, 0, 60),
      highlightPadXPct: bounded(contentInput.highlightPadXPct, defaults.content.highlightPadXPct, 0, 60),
      highlightPadYPx: bounded(contentInput.highlightPadYPx, defaults.content.highlightPadYPx, 0, 30),
      highlightUnderline: choice(contentInput.highlightUnderline, defaults.content.highlightUnderline, ['on', 'off']),
      highlightUnderlineColor: color(contentInput.highlightUnderlineColor, defaults.content.highlightUnderlineColor),
      highlightTextMode: choice(contentInput.highlightTextMode, defaults.content.highlightTextMode, ['keep', 'custom']),
      highlightTextColor: color(contentInput.highlightTextColor, defaults.content.highlightTextColor),
      // v1/v2 style, retained for old video snapshots.
      useCustomBackground: contentInput.useCustomBackground === true,
      backgroundColor: color(contentInput.backgroundColor, defaults.content.backgroundColor),
      titleColor: color(contentInput.titleColor, defaults.content.titleColor),
      textColor: color(contentInput.textColor, defaults.content.textColor),
      brandColorLegacy: color(contentInput.brandColorLegacy || contentInput.brandColor, defaults.content.brandColorLegacy),
      titleX: bounded(contentInput.titleX, defaults.content.titleX, 450, 630),
      titleY: bounded(contentInput.titleY, defaults.content.titleY, 260, 760),
      titleFontSize: bounded(contentInput.titleFontSize, defaults.content.titleFontSize, 26, 64),
      titleMaxWidth: bounded(contentInput.titleMaxWidth, defaults.content.titleMaxWidth, 420, 1020),
      titleFont: choice(contentInput.titleFont, defaults.content.titleFont, ['sans', 'serif', 'display']),
      textX: bounded(contentInput.textX, defaults.content.textX, 400, 680),
      textY: bounded(contentInput.textY, defaults.content.textY, 650, 1380),
      textFontSize: bounded(contentInput.textFontSize, defaults.content.textFontSize, 42, 72),
      textMaxWidth: bounded(contentInput.textMaxWidth, defaults.content.textMaxWidth, 420, 1020),
      textMaxHeight: bounded(contentInput.textMaxHeight, defaults.content.textMaxHeight, 300, 1450),
      textFont: choice(contentInput.textFont, defaults.content.textFont, ['sans', 'serif', 'display']),
      brandX: bounded(contentInput.brandX, defaults.content.brandX, 250, 830),
      brandY: bounded(contentInput.brandY, defaults.content.brandY, 80, 380),
      footerX: bounded(contentInput.footerX, defaults.content.footerX, 120, 960),
      footerY: bounded(contentInput.footerY, defaults.content.footerY, 1560, 1880),
      highlightRadius: bounded(contentInput.highlightRadius, defaults.content.highlightRadius, 0, 32),
      highlightPadding: bounded(contentInput.highlightPadding, defaults.content.highlightPadding, 0, 24),
    highlightUnderlineLegacy: typeof contentInput.highlightUnderline === 'boolean'
      ? contentInput.highlightUnderline
      : contentInput.highlightUnderlineLegacy === true,
    highlightUnderlineColorLegacy: color(contentInput.highlightUnderlineColorLegacy ?? contentInput.highlightUnderlineColor, defaults.content.highlightUnderlineColorLegacy),
      highlightTextModeLegacy: choice(contentInput.highlightTextModeLegacy, defaults.content.highlightTextModeLegacy, ['keep', 'custom']),
      highlightTextColorLegacy: color(contentInput.highlightTextColorLegacy, defaults.content.highlightTextColorLegacy),
      showBrand: contentInput.showBrand !== false,
      showFooter: contentInput.showFooter !== false
    }
  };
}
