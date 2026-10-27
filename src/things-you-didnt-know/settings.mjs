import {
  normalizeBackgroundEffect, normalizeBackgroundEffectDensity, normalizeBackgroundEffectOpacity,
  normalizeBackgroundEffectSpeed
} from '../../packages/video-engine/background-effects.mjs';

export const THINGS_YOU_DIDNT_KNOW_ID = 'things-you-didnt-know';
export const THINGS_YOU_DIDNT_KNOW_JOB_TYPE = 'create_tydk_reel';
export const THINGS_YOU_DIDNT_KNOW_NAME = "Things You Didn't Know";

export const THINGS_YOU_DIDNT_KNOW_DEFAULTS = Object.freeze({
  voice: 'af_heart',
  speechRate: 1,
  highlightEnabled: true,
  highlightMode: 'word',
  highlightStyle: 'background',
  highlightColor: '#FF8066',
  highlightPadding: 6,
  highlightRadius: 8,
  backgroundEffect: 'bubbles',
  backgroundEffectDensity: 28,
  backgroundEffectSpeed: 58,
  backgroundEffectOpacity: 32,
  facebookAdapter: 'mock',
  facebookPageId: '',
  facebookPageName: '',
  facebookPageVerified: false,
  fullAutoEnabled: false,
  autoGenerationEnabled: false,
  autoPublishEnabled: false,
  postsPerDay: 1,
  prepareAheadDays: 3,
  maxScriptsPerDay: 3
});

const color = /^#[\da-f]{6}$/iu;

export function normalizeThingsYouDidntKnowSettings(input = {}, { validVoices = null } = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const voiceSet = Array.isArray(validVoices) ? new Set(validVoices.map(String)) : null;
  const requestedVoice = String(source.voice || THINGS_YOU_DIDNT_KNOW_DEFAULTS.voice).trim();
  const requestedColor = String(source.highlightColor || THINGS_YOU_DIDNT_KNOW_DEFAULTS.highlightColor).trim();
  const rate = Number(source.speechRate ?? THINGS_YOU_DIDNT_KNOW_DEFAULTS.speechRate);
  const integer = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
  };
  return Object.freeze({
    voice: voiceSet && !voiceSet.has(requestedVoice) ? THINGS_YOU_DIDNT_KNOW_DEFAULTS.voice : requestedVoice,
    speechRate: Number.isFinite(rate) ? Math.max(0.75, Math.min(1.15, rate)) : 1,
    highlightEnabled: source.highlightEnabled !== false,
    highlightMode: source.highlightMode === 'phrase' ? 'phrase' : 'word',
    highlightStyle: source.highlightStyle === 'text-color' ? 'text-color' : 'background',
    highlightColor: color.test(requestedColor) ? requestedColor.toUpperCase() : THINGS_YOU_DIDNT_KNOW_DEFAULTS.highlightColor,
    highlightPadding: integer(source.highlightPadding, 6, 0, 24),
    highlightRadius: integer(source.highlightRadius, 8, 0, 32),
    backgroundEffect: normalizeBackgroundEffect(source.backgroundEffect || THINGS_YOU_DIDNT_KNOW_DEFAULTS.backgroundEffect),
    backgroundEffectDensity: normalizeBackgroundEffectDensity(source.backgroundEffectDensity),
    backgroundEffectSpeed: normalizeBackgroundEffectSpeed(source.backgroundEffectSpeed),
    backgroundEffectOpacity: normalizeBackgroundEffectOpacity(source.backgroundEffectOpacity),
    facebookAdapter: source.facebookAdapter === 'meta' ? 'meta' : 'mock',
    facebookPageId: /^\d{5,}$/.test(String(source.facebookPageId || '').trim()) ? String(source.facebookPageId).trim() : '',
    facebookPageName: String(source.facebookPageName || '').trim().slice(0, 160),
    facebookPageVerified: source.facebookPageVerified === true,
    fullAutoEnabled: source.fullAutoEnabled === true,
    autoGenerationEnabled: source.autoGenerationEnabled === true,
    autoPublishEnabled: source.autoPublishEnabled === true,
    postsPerDay: integer(source.postsPerDay, 1, 1, 4),
    prepareAheadDays: integer(source.prepareAheadDays, 3, 1, 30),
    maxScriptsPerDay: integer(source.maxScriptsPerDay, 3, 1, 10)
  });
}

export function assertThingsYouDidntKnowSettings(settings, { validVoices = null } = {}) {
  const normalized = normalizeThingsYouDidntKnowSettings(settings, { validVoices });
  if (settings?.facebookAdapter === 'meta' && !normalized.facebookPageId) {
    throw new Error('Cần cấu hình Facebook Page ID riêng cho Things You Didn\'t Know trước khi chọn Live.');
  }
  if (normalized.autoPublishEnabled && (!normalized.fullAutoEnabled || (normalized.facebookAdapter === 'meta' && !normalized.facebookPageVerified))) {
    throw new Error('Full Auto chỉ được đăng khi đã bật chế độ, xác minh Page và duyệt nguồn của từng Reel.');
  }
  return normalized;
}
