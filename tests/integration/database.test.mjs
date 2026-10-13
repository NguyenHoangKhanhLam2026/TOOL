import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'aers-test-'));
process.env.AERS_DATA_DIR = tempData;
process.env.AERS_PRIVATE_DIR = path.join(tempData, 'private');
const database = await import('../../src/database/db.mjs');

test('SQLite starts in WAL mode and installs the schema migration', () => {
  assert.equal(database.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(Number(database.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version), 4);
  assert.ok(database.db.prepare('PRAGMA table_info(scripts)').all().some((column) => column.name === 'speech_segments_json'));
  assert.equal(database.listTopics().length, 100);
});

test('database job claim is atomic and completion is persisted', () => {
  const jobId = database.queueJob('unit_test', { probe: true });
  try {
    const job = database.claimJob('unit-test-worker');
    assert.equal(job.id, jobId);
    assert.equal(job.status, 'pending');
    assert.equal(job.attempts, 1);
    database.finishJob(jobId);
    assert.equal(database.db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId).status, 'completed');
  } finally {
    database.db.prepare('DELETE FROM jobs WHERE id=?').run(jobId);
  }
});

test('job payload checkpoints survive a retry claim', () => {
  const jobId = database.queueJob('create_video', { topicId: 'daily-topic' });
  try {
    database.updateJobPayload(jobId, { scriptId: 'script-1', provider: 'local-template' });
    const job = database.claimJob('retry-worker');
    assert.deepEqual(job.payload, { topicId: 'daily-topic', scriptId: 'script-1', provider: 'local-template' });
  } finally {
    database.db.prepare('DELETE FROM jobs WHERE id=?').run(jobId);
  }
});

test.after(() => {
  database.db.close();
  fs.rmSync(tempData, { recursive: true, force: true });
});
