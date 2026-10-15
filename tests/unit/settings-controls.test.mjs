import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../src/config.mjs';

const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');

test('local TTS speed and preview controls have valid event targets', () => {
  const controls = [
    ['vieneu-vi-speed', 'input'],
    ['kokoro-en-speed', 'input'],
    ['preview-vieneu-vi', 'click'],
    ['preview-vieneu-en', 'click']
  ];

  for (const [id, event] of controls) {
    assert.match(html, new RegExp(`\\bid=["']${id}["']`), `Missing #${id} in settings HTML`);
    assert.match(app, new RegExp(`\\$\\('#${id}'\\)\\.addEventListener\\('${event}'`), `Missing ${event} handler for #${id}`);
  }

  assert.doesNotMatch(app, /\$\('#vieneu-en-speed'\)/, 'Removed VieNeu English slider must not stop event setup');
});

test('all static ID-based event listeners point to an element in the page', () => {
  const htmlIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
  const listenerIds = [...app.matchAll(/\$\('#([a-z0-9_-]+)'\)\.addEventListener/g)].map((match) => match[1]);

  for (const id of listenerIds) assert.ok(htmlIds.has(id), `Event listener targets missing #${id}`);
});
