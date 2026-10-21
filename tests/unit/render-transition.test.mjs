import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sequentialTransitionOpacities, createSequentialTransitionFrames } from '../../packages/video-engine/render.mjs';
const { default: sharp } = await import('sharp');

test('sequential transition fades the outgoing scene out before the incoming scene appears', () => {
  const frames = Array.from({ length: 9 }, (_, index) => sequentialTransitionOpacities(index, 9));

  assert.deepEqual(frames[0], { previous: 1, next: 0 });
  assert.deepEqual(frames.at(-1), { previous: 0, next: 1 });
  assert.ok(frames.some(({ previous, next }) => previous === 0 && next === 0), 'Transition includes a clean background beat.');
  assert.ok(frames.every(({ previous, next }) => previous === 0 || next === 0), 'Outgoing and incoming content never appear together.');
});

test('one-frame transition cuts to the incoming scene without blending both scenes', () => {
  assert.deepEqual(sequentialTransitionOpacities(0, 1), { previous: 0, next: 1 });
});

test('transition frames show outgoing or incoming pixels separately over the shared background', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aers-transition-test-'));
  const previousPath = path.join(directory, 'previous.png');
  const nextPath = path.join(directory, 'next.png');
  const basePath = path.join(directory, 'base.png');
  try {
    const createSolid = async (file, background) => sharp({
      create: { width: 16, height: 16, channels: 3, background }
    }).png().toFile(file);
    await Promise.all([
      createSolid(previousPath, { r: 255, g: 0, b: 0 }),
      createSolid(nextPath, { r: 0, g: 0, b: 255 }),
      createSolid(basePath, { r: 128, g: 128, b: 128 })
    ]);

    const frames = await createSequentialTransitionFrames(previousPath, nextPath, basePath, 0.3, directory, 'transition');
    assert.equal(frames.length, 9);
    const pixel = async (file) => {
      const { data } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
      return [...data.subarray(0, 3)];
    };
    assert.deepEqual(await pixel(frames[0].file), [255, 0, 0]);
    assert.deepEqual(await pixel(frames.at(-1).file), [0, 0, 255]);
    for (const frame of frames) {
      const [red, , blue] = await pixel(frame.file);
      assert.ok(!(red > 128 && blue > 128), 'An output frame must not blend old red content with new blue content.');
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
