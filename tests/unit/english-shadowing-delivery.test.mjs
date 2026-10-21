import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEnglishShadowingSentencePlan,
  getEnglishShadowingDeliveryProfile,
  inferEnglishShadowingDeliveryStyle,
  resolveEnglishShadowingDeliveryStyle
} from '../../src/english-shadowing/delivery.mjs';
import { englishShadowingTtsSettings } from '../../src/english-shadowing/settings.mjs';

test('four reference topic families select their measured narration styles', () => {
  assert.equal(inferEnglishShadowingDeliveryStyle({ topic: 'Simple, sustainable wellness habits' }), 'calm');
  assert.equal(inferEnglishShadowingDeliveryStyle({ topic: 'Staying curious, learning, and enjoying life at every age' }), 'uplifting');
  assert.equal(inferEnglishShadowingDeliveryStyle({ topic: 'Measurable product and business impact in an interview' }), 'measured');
  assert.equal(inferEnglishShadowingDeliveryStyle({ topic: 'Politely slowing down a fast phone conversation' }), 'conversational');
});

test('all Shadowing topics use sample-1 pace while keeping topic-specific tone', () => {
  const profiles = ['balanced', 'calm', 'uplifting', 'measured', 'conversational']
    .map((style) => getEnglishShadowingDeliveryProfile(style));
  assert.ok(profiles.every((profile) => profile.targetWordsPerMinute === 130.2));
  assert.ok(profiles.every((profile) => profile.modelRate === 0.8));
  assert.ok(profiles.every((profile) => profile.sentencePauseSeconds === 0.54));
  assert.equal(new Set(profiles.map((profile) => profile.tone)).size, profiles.length);
  assert.equal(resolveEnglishShadowingDeliveryStyle('invalid', { topic: 'sleep and health habits' }), 'calm');
  assert.equal(resolveEnglishShadowingDeliveryStyle('uplifting', { topic: 'career interview and product impact' }), 'measured');
});

test('Shadowing applies its native model rate to a copy of TTS settings', () => {
  const sharedSettings = { kokoroEnVoice: 'af_heart', kokoroEnSpeed: 0.7 };
  const shadowing = englishShadowingTtsSettings(sharedSettings, { voice: 'af_sarah' }, getEnglishShadowingDeliveryProfile('calm'));

  assert.equal(shadowing.kokoroEnVoice, 'af_sarah');
  assert.equal(shadowing.kokoroEnSpeed, 0.8);
  assert.equal(sharedSettings.kokoroEnVoice, 'af_heart');
  assert.equal(sharedSettings.kokoroEnSpeed, 0.7);
});

test('sentence plan follows punctuation with different rests for questions and statements', () => {
  const plan = buildEnglishShadowingSentencePlan([
    'What helps you feel ready for the day?',
    'Start with water, restful sleep, and a short walk outside.',
    'Small choices can make wellness feel simple.'
  ], 'calm');

  assert.equal(plan.length, 3);
  assert.ok(plan[0].pauseAfterSeconds > plan[1].pauseAfterSeconds);
  assert.equal(plan[2].pauseAfterSeconds, 0);
  assert.ok(plan.every((item) => item.deliveryStyle === 'calm' && item.tone === 'warm and reassuring'));
  assert.equal(plan[0].sentenceIntent, 'opening-question');
  assert.equal(plan[1].sentenceIntent, 'connected-list');
  assert.equal(plan[2].sentenceIntent, 'closing-takeaway');
  assert.ok(plan.every((item) => item.narrationDirection && item.targetWordsPerMinute === 130.2));
});
