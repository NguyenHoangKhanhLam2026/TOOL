import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBackgroundEffectDefaults, selectRenderHighlightSettings } from '../../src/pipeline/background-effect-routing.mjs';

test('render uses the saved background effect profile for the script language', () => {
  const settings = {
    backgroundEffect: 'vocabulary',
    backgroundEffectProfiles: {
      en: { backgroundEffect: 'vocabulary', backgroundEffectDensity: 32 },
      zh: { backgroundEffect: 'bubbles', backgroundEffectDensity: 44 },
      ja: { backgroundEffect: 'petals', backgroundEffectDensity: 26 }
    }
  };
  const englishSettings = { ...settings, ...settings.backgroundEffectProfiles.en };
  const chineseRenderSettings = { ...englishSettings, ...settings.backgroundEffectProfiles.zh };
  const japaneseRenderSettings = { ...englishSettings, ...settings.backgroundEffectProfiles.ja };

  assert.strictEqual(resolveBackgroundEffectDefaults(settings, 'en'), settings.backgroundEffectProfiles.en);
  assert.strictEqual(resolveBackgroundEffectDefaults(settings, 'zh'), settings.backgroundEffectProfiles.zh);
  assert.strictEqual(resolveBackgroundEffectDefaults(settings, 'ja'), settings.backgroundEffectProfiles.ja);
  assert.strictEqual(selectRenderHighlightSettings('en', englishSettings, chineseRenderSettings), englishSettings);
  assert.strictEqual(selectRenderHighlightSettings('zh', englishSettings, chineseRenderSettings), chineseRenderSettings);
  assert.strictEqual(selectRenderHighlightSettings('ja', englishSettings, japaneseRenderSettings), japaneseRenderSettings);
});

test('an unconfigured non-English language does not inherit the English effect', () => {
  const settings = {
    backgroundEffect: 'vocabulary',
    backgroundEffectProfiles: { en: { backgroundEffect: 'vocabulary' } }
  };
  const defaults = resolveBackgroundEffectDefaults(settings, 'ko');
  const renderSettings = { ...settings, ...defaults };

  assert.equal(defaults.backgroundEffect, 'bubbles');
  assert.strictEqual(selectRenderHighlightSettings('ko', settings, renderSettings), renderSettings);
});

test('background-only rerender keeps its explicit per-video effect settings', () => {
  const settings = { backgroundEffect: 'vocabulary' };
  const perVideoSettings = { backgroundEffect: 'snow' };

  assert.strictEqual(selectRenderHighlightSettings('en', settings, perVideoSettings, true), perVideoSettings);
});
