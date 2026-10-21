import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BACKGROUND_EFFECTS, renderBackgroundEffectMarkup } from '../../packages/video-engine/background-effects.mjs';

test('background effect speed changes only the time scale, consistently across the full slider range', () => {
  const referenceTime = 3.25;
  const options = { width: 360, height: 640, seed: 'effect-speed-regression' };

  for (const { id } of BACKGROUND_EFFECTS) {
    const reference = renderBackgroundEffectMarkup(id, { ...options, time: referenceTime, speed: 58 });
    for (let speed = 25; speed <= 140; speed += 1) {
      const equivalentTime = referenceTime * 58 / speed;
      const actual = renderBackgroundEffectMarkup(id, { ...options, time: equivalentTime, speed });
      assert.equal(actual, reference, `${id} at speed ${speed} must preserve the same motion phase`);
    }
  }
});

test('localized vocabulary background uses ZH/JA words while English markup remains byte-for-byte stable', () => {
  const options = { width: 1080, height: 1920, time: 2.5, seed: 'en-lock', density: 6, speed: 58, opacity: 32 };
  const originalEnglishMarkup = renderBackgroundEffectMarkup('vocabulary', options);
  const explicitEnglishMarkup = renderBackgroundEffectMarkup('vocabulary', { ...options, contentLanguage: 'en' });
  const englishHash = createHash('sha256').update(originalEnglishMarkup).digest('hex');

  assert.equal(explicitEnglishMarkup, originalEnglishMarkup);
  assert.equal(englishHash, 'f83ca2e2ec6244b24c03e67fbe695e47ab30f68f0763341d09028c3ec089dce8');

  const vocabularies = {
    zh: new Set(['你好', '学习', '表达', '梦想', '成长', '中文', '词语', '坚持']),
    ja: new Set(['こんにちは', '学ぶ', '会話', '夢', '成長', '日本語', '言葉', '挑戦'])
  };
  for (const [contentLanguage, allowedWords] of Object.entries(vocabularies)) {
    const markup = renderBackgroundEffectMarkup('vocabulary', { ...options, contentLanguage });
    const renderedWords = [...markup.matchAll(/<text\b[^>]*>([^<]*)<\/text>/gu)].map((match) => match[1]);
    assert.equal(renderedWords.length, Math.max(10, options.density));
    assert.ok(renderedWords.every((word) => allowedWords.has(word)), `${contentLanguage} background must only contain its own vocabulary`);
    assert.doesNotMatch(markup, />(?:hello|learn|speak|dream|grow|A2)<\/text>/u);
  }
});
