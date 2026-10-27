import { MOT_PHUT_VO_LE_DEFAULTS } from './settings.mjs';

export const MOT_PHUT_VO_LE_HEADLINE_FONT_IDS = Object.freeze([
  'display', 'arial', 'times', 'georgia', 'serif', 'tahoma', 'trebuchet', 'verdana', 'calibri', 'segoe',
  'cambria', 'garamond', 'bookman', 'palatino', 'book-antiqua', 'century', 'impact', 'comic', 'consolas', 'courier'
]);
export const MOT_PHUT_VO_LE_BRAND_FONT_IDS = MOT_PHUT_VO_LE_HEADLINE_FONT_IDS;

export const MOT_PHUT_VO_LE_PRESETS = Object.freeze({
  'vintage-paper': Object.freeze({
    id: 'vintage-paper', name: 'Vintage Paper', background: '#E9DFC8', backgroundAccent: '#F7F0E2',
    textColor: '#22211F', mutedColor: '#6D6457', highlightColor: '#A63F36', brandColor: '#59473A',
    fontFamily: 'Arial, Segoe UI, sans-serif', titleFontSize: 76, bodyFontSize: 54, lineHeight: 1.42,
    thumbnailAccent: '#A63F36', motion: 'none'
  }),
  'dark-knowledge': Object.freeze({
    id: 'dark-knowledge', name: 'Dark Knowledge', background: '#11172B', backgroundAccent: '#202C4C',
    textColor: '#F6F7FB', mutedColor: '#AAB4CC', highlightColor: '#58D8F0', brandColor: '#92E9F4',
    fontFamily: 'Arial, Segoe UI, sans-serif', titleFontSize: 76, bodyFontSize: 54, lineHeight: 1.42,
    thumbnailAccent: '#58D8F0', motion: 'none'
  })
});

export const MOT_PHUT_VO_LE_VISUAL_DESIGN_DEFAULTS = Object.freeze({
  schemaVersion: 4,
  enabled: true,
  preset: MOT_PHUT_VO_LE_DEFAULTS.visualPreset,
  thumbnail: Object.freeze({
    introSeconds: 0,
    brandVisible: true, headlineVisible: true, watermarkVisible: true,
    background: '#E9DFC8', accent: '#A63F36', textColor: '#22211F', fontFamily: 'Arial, Segoe UI, sans-serif',
    fontSize: 88, brand: 'Một Phút Vỡ Lẽ', watermark: '@MotPhutVoLe', padding: 100, titlePosition: 'center',
    brandColorA: '#59473A', brandColorB: '#A63F36', brandSizePx: 34, brandCenterXPct: 50, brandTopPct: 18,
    brandFont: 'arial',
    headlineMaxPx: 190, headlineCase: 'uppercase', headlineFont: 'display', headlineLeftPct: 10, headlineTopPct: 26.3,
    headlineWidthPct: 80, headlineHeightPct: 30, outlineColor: '#4A2C14', highlightColor: '#A63F36',
    watermarkCenterXPct: 50, watermarkTopPct: 94.8, watermarkSizePx: 28,
    watermarkColor: '#FFFFFF', watermarkOpacity: 0.72, watermarkFontFamily: 'Arial, Segoe UI, sans-serif',
    paperColor: '#E9DFC8', vignette: 0.15, bottomShade: 0.08
  }),
  content: Object.freeze({
    background: '#E9DFC8', accent: '#A63F36', textColor: '#22211F', mutedColor: '#6D6457',
    fontFamily: 'Arial, Segoe UI, sans-serif', titleFontSize: 64, bodyFontSize: 54, lineSpacing: 1.5,
    brand: 'Một Phút Vỡ Lẽ', watermark: '@MotPhutVoLe', padding: 108, layout: 'centered', motion: 'none',
    brandVisible: true, brandColor: '#59473A', brandColorA: '#1A2A5C', brandColorB: '#8B1C1C',
    brandSizePx: 47, brandCenterXPct: 50, brandTopPct: 10.3,
    titleColor: '#080808', titleTopPct: 18.8, titleWidthPct: 90,
    bodyColor: '#080808', bodyMaxPx: 58, bodyFont: 'Arial, sans-serif', contentLeftPct: 10, contentTopPct: 26.5,
    contentWidthPct: 80, contentHeightPct: 60, paperColor: '#C8A478', vignette: 0.3, bottomShade: 0.1
  }),
  useThumbnailIntro: false,
  introDurationSeconds: 0.5
});

function color(value, fallback) {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/iu.test(text) ? text : fallback;
}

function bounded(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function font(value, fallback) {
  const text = String(value || '').trim();
  return text && text.length <= 100 && !/[<>"'`;{}]/u.test(text) ? text : fallback;
}

export function normalizeMotPhutVoLeVisualDesign(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const schemaVersion = Number(source.schemaVersion) >= 4 ? 4 : Number(source.schemaVersion) >= 3 ? 3 : Number(source.schemaVersion) === 2 ? 2 : 1;
  const presetId = MOT_PHUT_VO_LE_PRESETS[source.preset] ? source.preset : MOT_PHUT_VO_LE_VISUAL_DESIGN_DEFAULTS.preset;
  const preset = MOT_PHUT_VO_LE_PRESETS[presetId];
  const baseThumb = MOT_PHUT_VO_LE_VISUAL_DESIGN_DEFAULTS.thumbnail;
  const baseContent = schemaVersion >= 4
    ? MOT_PHUT_VO_LE_VISUAL_DESIGN_DEFAULTS.content
    : { ...MOT_PHUT_VO_LE_VISUAL_DESIGN_DEFAULTS.content, contentTopPct: 35, contentHeightPct: 43 };
  const presetThumb = { ...baseThumb, background: preset.background, accent: preset.thumbnailAccent, textColor: preset.textColor, fontFamily: preset.fontFamily, fontSize: preset.titleFontSize };
  const presetContent = { ...baseContent, background: preset.background, accent: preset.highlightColor, textColor: preset.textColor, mutedColor: preset.mutedColor,
    fontFamily: preset.fontFamily, titleFontSize: schemaVersion >= 4 ? 64 : preset.titleFontSize, bodyFontSize: preset.bodyFontSize, lineSpacing: schemaVersion >= 4 ? 1.5 : preset.lineHeight };
  const thumbnail = { ...presetThumb, ...(source.thumbnail || {}) };
  const content = { ...presetContent, ...(source.content || {}) };
  const headlineLeftPct = bounded(thumbnail.headlineLeftPct, baseThumb.headlineLeftPct, 0, 80);
  const headlineTopPct = bounded(thumbnail.headlineTopPct, baseThumb.headlineTopPct, 0, 90);
  const contentLeftPct = bounded(content.contentLeftPct, baseContent.contentLeftPct, 0, 80);
  const contentTopPct = bounded(content.contentTopPct, baseContent.contentTopPct, 0, 90);
  return Object.freeze({
    schemaVersion,
    enabled: source.enabled !== false,
    preset: presetId,
    thumbnail: Object.freeze({
      introSeconds: bounded(source.thumbnail?.introSeconds ?? (source.useThumbnailIntro === true ? source.introDurationSeconds : baseThumb.introSeconds), baseThumb.introSeconds, 0, 10),
      brandVisible: source.thumbnail?.brandVisible !== false,
      headlineVisible: source.thumbnail?.headlineVisible !== false,
      watermarkVisible: source.thumbnail?.watermarkVisible !== false,
      background: color(thumbnail.background, preset.background), accent: color(thumbnail.accent, preset.thumbnailAccent),
      textColor: color(thumbnail.textColor, preset.textColor), fontFamily: font(thumbnail.fontFamily, preset.fontFamily),
      fontSize: bounded(thumbnail.fontSize, baseThumb.fontSize, 38, 132), brand: String(thumbnail.brand || baseThumb.brand).slice(0, 50),
      watermark: String(thumbnail.watermark || baseThumb.watermark).slice(0, 80), padding: bounded(thumbnail.padding, baseThumb.padding, 48, 180),
      titlePosition: ['center', 'top', 'bottom'].includes(thumbnail.titlePosition) ? thumbnail.titlePosition : 'center',
      brandColorA: color(thumbnail.brandColorA, preset.brandColor), brandColorB: color(thumbnail.brandColorB, preset.thumbnailAccent),
      brandFont: MOT_PHUT_VO_LE_BRAND_FONT_IDS.includes(thumbnail.brandFont) ? thumbnail.brandFont : baseThumb.brandFont,
      brandSizePx: bounded(thumbnail.brandSizePx, baseThumb.brandSizePx, 12, 200),
      brandCenterXPct: bounded(thumbnail.brandCenterXPct, baseThumb.brandCenterXPct, 0, 100),
      brandTopPct: bounded(thumbnail.brandTopPct, baseThumb.brandTopPct, 0, 96),
      headlineMaxPx: bounded(source.thumbnail?.headlineMaxPx ?? source.thumbnail?.fontSize ?? thumbnail.headlineMaxPx, baseThumb.headlineMaxPx, 40, 400),
      headlineCase: ['uppercase', 'as written'].includes(thumbnail.headlineCase) ? thumbnail.headlineCase : baseThumb.headlineCase,
      headlineFont: MOT_PHUT_VO_LE_HEADLINE_FONT_IDS.includes(thumbnail.headlineFont) ? thumbnail.headlineFont : baseThumb.headlineFont,
      headlineLeftPct,
      headlineTopPct,
      headlineWidthPct: Math.min(bounded(thumbnail.headlineWidthPct, baseThumb.headlineWidthPct, 20, 100), 100 - headlineLeftPct),
      headlineHeightPct: Math.min(bounded(thumbnail.headlineHeightPct, baseThumb.headlineHeightPct, 5, 90), 100 - headlineTopPct),
      outlineColor: color(thumbnail.outlineColor, baseThumb.outlineColor), highlightColor: color(thumbnail.highlightColor, preset.thumbnailAccent),
      watermarkCenterXPct: bounded(thumbnail.watermarkCenterXPct, baseThumb.watermarkCenterXPct, 0, 100),
      watermarkTopPct: bounded(thumbnail.watermarkTopPct, baseThumb.watermarkTopPct, 0, 100),
      watermarkSizePx: bounded(thumbnail.watermarkSizePx, baseThumb.watermarkSizePx, 10, 120),
      watermarkColor: color(thumbnail.watermarkColor, baseThumb.watermarkColor),
      watermarkOpacity: bounded(thumbnail.watermarkOpacity, baseThumb.watermarkOpacity, 0, 1),
      watermarkFontFamily: font(thumbnail.watermarkFontFamily, baseThumb.watermarkFontFamily),
      paperColor: color(source.thumbnail?.paperColor ?? source.thumbnail?.background ?? thumbnail.paperColor, preset.background),
      vignette: bounded(thumbnail.vignette, baseThumb.vignette, 0, 1), bottomShade: bounded(thumbnail.bottomShade, baseThumb.bottomShade, 0, 1)
    }),
    content: Object.freeze({
      background: color(content.background, preset.background), accent: color(content.accent, preset.highlightColor),
      textColor: color(content.textColor, preset.textColor), mutedColor: color(content.mutedColor, preset.mutedColor),
      fontFamily: font(content.fontFamily, preset.fontFamily), titleFontSize: bounded(content.titleFontSize, preset.titleFontSize, 38, 100),
      bodyFontSize: bounded(content.bodyFontSize, preset.bodyFontSize, 34, 70), lineSpacing: bounded(content.lineSpacing, preset.lineHeight, 1.2, 1.8),
      brand: String(content.brand || baseContent.brand).slice(0, 50), watermark: String(content.watermark || baseContent.watermark).slice(0, 80),
      padding: bounded(content.padding, baseContent.padding, 72, 180), layout: ['centered', 'left'].includes(content.layout) ? content.layout : 'centered',
      motion: content.motion === 'subtle' ? 'subtle' : 'none',
      brandVisible: content.brandVisible !== false,
      brandColor: color(content.brandColor, preset.brandColor), brandColorA: color(content.brandColorA, baseContent.brandColorA),
      brandColorB: color(content.brandColorB, baseContent.brandColorB), brandSizePx: bounded(content.brandSizePx, baseContent.brandSizePx, 12, 120),
      brandCenterXPct: bounded(content.brandCenterXPct, baseContent.brandCenterXPct, 0, 100),
      brandTopPct: bounded(content.brandTopPct, baseContent.brandTopPct, 0, 40),
      titleColor: color(content.titleColor, baseContent.titleColor),
      titleTopPct: bounded(content.titleTopPct, baseContent.titleTopPct, 10, 35),
      titleWidthPct: bounded(content.titleWidthPct, baseContent.titleWidthPct, 30, 100),
      bodyColor: color(content.bodyColor || content.textColor, preset.textColor),
      bodyMaxPx: bounded(source.content?.bodyMaxPx ?? source.content?.bodyFontSize ?? content.bodyMaxPx, baseContent.bodyMaxPx, 22, 120),
      bodyFont: ['Arial, sans-serif', 'Georgia, serif'].includes(source.content?.bodyFont ?? content.bodyFont)
        ? (source.content?.bodyFont ?? content.bodyFont) : baseContent.bodyFont,
      contentLeftPct,
      contentTopPct,
      contentWidthPct: Math.min(bounded(content.contentWidthPct, baseContent.contentWidthPct, 20, 100), 100 - contentLeftPct),
      contentHeightPct: Math.min(bounded(content.contentHeightPct, baseContent.contentHeightPct, 5, 90), 100 - contentTopPct),
      paperColor: color(content.paperColor, baseContent.paperColor), vignette: bounded(content.vignette, baseContent.vignette, 0, 1),
      bottomShade: bounded(content.bottomShade, baseContent.bottomShade, 0, 1)
    }),
    useThumbnailIntro: source.useThumbnailIntro === true,
    introDurationSeconds: bounded(source.introDurationSeconds, 0.5, 0, 2)
  });
}

export function migrateMotPhutVoLeVisualDesignToPoster(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  if (Number(source.schemaVersion) >= 4) return normalizeMotPhutVoLeVisualDesign(source);
  const thumbnail = { ...MOT_PHUT_VO_LE_VISUAL_DESIGN_DEFAULTS.thumbnail, ...(source.thumbnail || {}) };
  const oldContent = source.content || {};
  return normalizeMotPhutVoLeVisualDesign({
    ...source,
    schemaVersion: 4,
    thumbnail,
    content: {
      ...oldContent,
      bodyMaxPx: oldContent.bodyMaxPx ?? oldContent.bodyFontSize ?? 54,
      lineSpacing: 1.22,
      layout: 'centered',
      contentLeftPct: thumbnail.headlineLeftPct,
      contentTopPct: 26.5,
      contentWidthPct: thumbnail.headlineWidthPct,
      contentHeightPct: 60
    }
  });
}

export function createMotPhutVoLeDesignSnapshot(value = {}) {
  return JSON.parse(JSON.stringify(normalizeMotPhutVoLeVisualDesign(value)));
}
