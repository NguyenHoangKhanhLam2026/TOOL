import test from 'node:test';
import assert from 'node:assert/strict';
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
