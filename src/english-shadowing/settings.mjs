import { ENGLISH_SHADOWING_PROFILE } from './profile.mjs';
import { normalizeBackgroundEffectProfile } from '../../packages/video-engine/background-effects.mjs';

/**
 * Settings owned only by EnglishShadowing. Keep these values under their own
 * database/API key; do not merge them into the shared EN/ZH settings payload.
 */
export const ENGLISH_SHADOWING_SETTINGS_KEY = 'englishShadowingProfile';
export const ENGLISH_SHADOWING_DEFAULT_SETTINGS = Object.freeze({
  voice: 'af_heart',
  speechRate: 1,
  highlightEnabled: true,
  highlightStyle: 'text',
  highlightMode: 'word',
  highlightColor: '#E5794F',
  highlightPadding: 6,
  highlightRadius: 8,
  backgroundEffectConfig: Object.freeze({
    backgroundEffect: 'bubbles',
    backgroundEffectDensity: 28,
    backgroundEffectSpeed: 58,
    backgroundEffectOpacity: 32
  })
});

const HIGHLIGHT_MODES = new Set(['word', 'phrase']);
const HIGHLIGHT_STYLES = new Set(['text', 'tool']);
const HEX_COLOR = /^#[\da-f]{6}$/iu;

export function normalizeEnglishShadowingSettings(value = {}, { validVoices = null } = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const voiceList = Array.isArray(validVoices) ? new Set(validVoices.map(String)) : null;
  const requestedVoice = String(input.voice || ENGLISH_SHADOWING_DEFAULT_SETTINGS.voice).trim();
  const voice = voiceList && !voiceList.has(requestedVoice)
    ? ENGLISH_SHADOWING_DEFAULT_SETTINGS.voice
    : requestedVoice;
  const requestedMode = String(input.highlightMode || ENGLISH_SHADOWING_DEFAULT_SETTINGS.highlightMode);
  const highlightMode = HIGHLIGHT_MODES.has(requestedMode)
    ? requestedMode
    : ENGLISH_SHADOWING_DEFAULT_SETTINGS.highlightMode;
  const requestedStyle = String(input.highlightStyle || ENGLISH_SHADOWING_DEFAULT_SETTINGS.highlightStyle);
  const highlightStyle = HIGHLIGHT_STYLES.has(requestedStyle)
    ? requestedStyle
    : ENGLISH_SHADOWING_DEFAULT_SETTINGS.highlightStyle;
  const requestedColor = String(input.highlightColor || ENGLISH_SHADOWING_DEFAULT_SETTINGS.highlightColor).trim();
  const requestedPadding = Number(input.highlightPadding ?? ENGLISH_SHADOWING_DEFAULT_SETTINGS.highlightPadding);
  const requestedRadius = Number(input.highlightRadius ?? ENGLISH_SHADOWING_DEFAULT_SETTINGS.highlightRadius);

  return Object.freeze({
    voice,
    // Speech cadence follows the sample profile and is not a user setting.
    speechRate: ENGLISH_SHADOWING_PROFILE.reading.fixedModelRate,
    highlightEnabled: input.highlightEnabled !== false,
    highlightStyle,
    highlightMode,
    highlightColor: HEX_COLOR.test(requestedColor)
      ? requestedColor.toUpperCase()
      : ENGLISH_SHADOWING_DEFAULT_SETTINGS.highlightColor,
    highlightPadding: Number.isInteger(requestedPadding) && requestedPadding >= 0 && requestedPadding <= 24
      ? requestedPadding
      : ENGLISH_SHADOWING_DEFAULT_SETTINGS.highlightPadding,
    highlightRadius: Number.isInteger(requestedRadius) && requestedRadius >= 0 && requestedRadius <= 32
      ? requestedRadius
      : ENGLISH_SHADOWING_DEFAULT_SETTINGS.highlightRadius,
    // Shadowing owns a separate effect profile. Never inherit the shared EN/ZH
    // profile or a legacy top-level effect when its own value is missing.
    backgroundEffectConfig: normalizeBackgroundEffectProfile(
      input.backgroundEffectConfig,
      ENGLISH_SHADOWING_DEFAULT_SETTINGS.backgroundEffectConfig
    )
  });
}

/**
 * Return a request-local TTS settings copy. The persisted EN settings object
 * is never mutated; only the cloned voice/rate used for this Shadowing job is
 * overridden.
 */
export function englishShadowingTtsSettings(baseSettings = {}, profile = {}, deliveryProfile = {}) {
  const normalized = normalizeEnglishShadowingSettings(profile);
  const deliveryRate = Number(deliveryProfile.modelRate);
  const speechRate = Number.isFinite(deliveryRate) && deliveryRate >= 0.5 && deliveryRate <= 1.25
    ? deliveryRate
    : normalized.speechRate;
  return {
    ...baseSettings,
    kokoroEnVoice: normalized.voice,
    kokoroEnSpeed: speechRate,
    // This isolated lesson always needs word timestamps even when the shared
    // highlight preference for another content type is disabled.
    highlightEnabled: true
  };
}

