import { VIENEU_VOICES } from '../tts/vieneu-tts.mjs';
import { normalizeBackgroundEffect } from '../../packages/video-engine/background-effects.mjs';

export const MOT_PHUT_VO_LE_ID = 'mot-phut-vo-le';
export const MOT_PHUT_VO_LE_CONTENT_TYPE = 'mot-phut-vo-le';
export const MOT_PHUT_VO_LE_JOB_TYPE = 'create_mot_phut_vo_le_video';
export const MOT_PHUT_VO_LE_VISUAL_DESIGN_KEY = 'motPhutVoLeVisualDesignV1';

export const MOT_PHUT_VO_LE_DEFAULTS = Object.freeze({
  language: 'vi',
  voice: 'Hải Đăng',
  speed: 1,
  topicMode: 'unlimited',
  visualPreset: 'vintage-paper',
  highlightEnabled: true,
  highlightMode: 'syllable',
  highlightColor: '#FF8066',
  highlightPadding: 6,
  highlightRadius: 8,
  highlightTransition: 'instant',
  backgroundEffect: 'bubbles',
  backgroundEffectDensity: 28,
  backgroundEffectSpeed: 58,
  backgroundEffectOpacity: 32,
  autoGenerationEnabled: false,
  autoScheduleEnabled: false,
  autoPublishEnabled: false,
  postsPerDay: 3,
  prepareAheadDays: 7,
  maxScriptsPerDay: 10,
  facebookPageId: '',
  facebookPageName: '',
  facebookPageVerified: false,
  allowStaticOnAlignmentFailure: false,
  maxTopicRetries: 3,
  useThumbnailIntro: false,
  designEnabled: true
});

const VISUAL_PRESETS = new Set(['vintage-paper', 'dark-knowledge']);
const HIGHLIGHT_MODES = new Set(['syllable', 'phrase']);

export function normalizeMotPhutVoLeSettings(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const voice = String(value.voice || MOT_PHUT_VO_LE_DEFAULTS.voice).trim();
  const speed = Number(value.speed ?? MOT_PHUT_VO_LE_DEFAULTS.speed);
  const retries = Number(value.maxTopicRetries ?? MOT_PHUT_VO_LE_DEFAULTS.maxTopicRetries);
  const visualPreset = String(value.visualPreset || MOT_PHUT_VO_LE_DEFAULTS.visualPreset);
  const highlightMode = String(value.highlightMode || MOT_PHUT_VO_LE_DEFAULTS.highlightMode);
  const highlightColor = String(value.highlightColor || MOT_PHUT_VO_LE_DEFAULTS.highlightColor);
  const postsPerDay = Number(value.postsPerDay ?? MOT_PHUT_VO_LE_DEFAULTS.postsPerDay);
  const prepareAheadDays = Number(value.prepareAheadDays ?? MOT_PHUT_VO_LE_DEFAULTS.prepareAheadDays);
  const maxScriptsPerDay = Number(value.maxScriptsPerDay ?? MOT_PHUT_VO_LE_DEFAULTS.maxScriptsPerDay);

  return Object.freeze({
    language: 'vi',
    voice: VIENEU_VOICES.includes(voice) ? voice : MOT_PHUT_VO_LE_DEFAULTS.voice,
    speed: Number.isFinite(speed) ? Math.max(0.75, Math.min(1.25, speed)) : 1,
    topicMode: 'unlimited',
    visualPreset: VISUAL_PRESETS.has(visualPreset) ? visualPreset : MOT_PHUT_VO_LE_DEFAULTS.visualPreset,
    highlightEnabled: value.highlightEnabled !== false,
    highlightMode: HIGHLIGHT_MODES.has(highlightMode) ? highlightMode : 'syllable',
    highlightColor: /^#[\da-f]{6}$/iu.test(highlightColor) ? highlightColor.toUpperCase() : MOT_PHUT_VO_LE_DEFAULTS.highlightColor,
    highlightPadding: clampInteger(value.highlightPadding, MOT_PHUT_VO_LE_DEFAULTS.highlightPadding, 0, 24),
    highlightRadius: clampInteger(value.highlightRadius, MOT_PHUT_VO_LE_DEFAULTS.highlightRadius, 0, 32),
    highlightTransition: 'instant',
    backgroundEffect: value.backgroundEffect === 'vocabulary' ? MOT_PHUT_VO_LE_DEFAULTS.backgroundEffect
      : normalizeBackgroundEffect(value.backgroundEffect || MOT_PHUT_VO_LE_DEFAULTS.backgroundEffect),
    backgroundEffectDensity: clampInteger(value.backgroundEffectDensity, 28, 10, 60),
    backgroundEffectSpeed: clampInteger(value.backgroundEffectSpeed, 58, 25, 140),
    backgroundEffectOpacity: clampInteger(value.backgroundEffectOpacity, 32, 10, 70),
    autoGenerationEnabled: value.autoGenerationEnabled === true,
    autoScheduleEnabled: value.autoScheduleEnabled === true,
    autoPublishEnabled: value.autoPublishEnabled === true,
    postsPerDay: Number.isFinite(postsPerDay) ? Math.max(1, Math.min(4, Math.floor(postsPerDay))) : 3,
    prepareAheadDays: Number.isFinite(prepareAheadDays) ? Math.max(1, Math.min(30, Math.floor(prepareAheadDays))) : 7,
    maxScriptsPerDay: Number.isFinite(maxScriptsPerDay) ? Math.max(1, Math.min(30, Math.floor(maxScriptsPerDay))) : 10,
    facebookPageId: /^\d{5,}$/.test(String(value.facebookPageId || '').trim()) ? String(value.facebookPageId).trim() : '',
    facebookPageName: String(value.facebookPageName || '').trim().slice(0, 160),
    facebookPageVerified: value.facebookPageVerified === true,
    allowStaticOnAlignmentFailure: value.allowStaticOnAlignmentFailure === true,
    maxTopicRetries: Number.isFinite(retries) ? Math.max(1, Math.min(5, Math.floor(retries))) : 3,
    useThumbnailIntro: value.useThumbnailIntro === true,
    designEnabled: value.designEnabled !== false
  });
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

export function assertMotPhutVoLeSettings(settings) {
  const normalized = normalizeMotPhutVoLeSettings(settings);
  if (!VIENEU_VOICES.includes(normalized.voice)) throw new Error('Giọng VieNeu không nằm trong danh sách voice hiện có.');
  return normalized;
}
