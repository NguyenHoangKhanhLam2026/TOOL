import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedLocalToDate, nextScheduledTime } from '../../src/scheduler/time.mjs';

test('Asia/Ho_Chi_Minh local appointment converts to UTC correctly', () => {
  const result = zonedLocalToDate('2026-10-12T19:30', 'Asia/Ho_Chi_Minh');
  assert.equal(result.toISOString(), '2026-10-12T12:30:00.000Z');
});

test('next post uses configured local time and moves to the next day after the slot', () => {
  const after = new Date('2026-10-12T13:00:00.000Z');
  const next = nextScheduledTime(after, '19:30', 'Asia/Ho_Chi_Minh');
  assert.equal(next.toISOString(), '2026-10-13T12:30:00.000Z');
});

test('multiple daily posts are spaced across the day', () => {
  const after = new Date('2026-10-12T13:00:00.000Z');
  const next = nextScheduledTime(after, '19:30', 'Asia/Ho_Chi_Minh', 2);
  assert.equal(next.toISOString(), '2026-10-13T00:30:00.000Z');
});

test('invalid local date/time is rejected', () => {
  assert.throws(() => zonedLocalToDate('tomorrow evening', 'Asia/Ho_Chi_Minh'), /định dạng/);
});
