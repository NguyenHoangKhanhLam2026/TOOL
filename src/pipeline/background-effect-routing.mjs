const DEFAULT_BACKGROUND_EFFECT_PROFILE = Object.freeze({
  backgroundEffect: 'bubbles',
  backgroundEffectDensity: 28,
  backgroundEffectSpeed: 58,
  backgroundEffectOpacity: 32
});

function normalizeLanguage(contentLanguage) {
  return String(contentLanguage || 'en').trim().toLowerCase() || 'en';
}

export function resolveBackgroundEffectDefaults(settings, contentLanguage) {
  const language = normalizeLanguage(contentLanguage);
  const profile = settings?.backgroundEffectProfiles?.[language];
  if (profile && typeof profile === 'object' && !Array.isArray(profile)) return profile;
  return language === 'en' ? settings : DEFAULT_BACKGROUND_EFFECT_PROFILE;
}

export function selectRenderHighlightSettings(contentLanguage, settings, renderSettings, backgroundEffectOnly = false) {
  return backgroundEffectOnly || normalizeLanguage(contentLanguage) !== 'en' ? renderSettings : settings;
}
