import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../../src/config.mjs';
import { getLocalTtsManagerStatus, withLocalTtsModel } from '../../src/tts/local-model-manager.mjs';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('local TTS manager serializes model workers across Node processes', async (context) => {
  let releasedAt = 0;
  const holder = withLocalTtsModel('test-holder', async (lease) => {
    lease.update({ phase: 'test-holding', workerPid: process.pid, workerExited: false });
    await delay(700);
    releasedAt = Date.now();
  });
  await delay(75);
  const moduleUrl = pathToFileURL(path.join(ROOT, 'src', 'tts', 'local-model-manager.mjs')).href;
  const childCode = `import { withLocalTtsModel } from ${JSON.stringify(moduleUrl)}; await withLocalTtsModel('test-child', async () => { console.log('CHILD_ACQUIRED_AT:' + Date.now()); });`;
  let child;
  try {
    child = spawn(process.execPath, ['--input-type=module', '-e', childCode], { cwd: ROOT, windowsHide: true });
  } catch (error) {
    if (error.code === 'EPERM') {
      await holder;
      context.skip('The environment denied child-process creation; cross-process locking was not exercised.');
      return;
    }
    throw error;
  }
  let output = '';
  let errorOutput = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
  const childDone = new Promise((resolve, reject) => {
    child.once('error', (error) => {
      if (error.code === 'EPERM') resolve({ spawnDenied: true });
      else reject(error);
    });
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(errorOutput || `child exited ${code}`)));
  });
  const [, childResult] = await Promise.all([holder, childDone]);
  if (childResult?.spawnDenied) {
    context.skip('The environment denied child-process creation; cross-process locking was not exercised.');
    return;
  }
  const acquiredAt = Number(output.match(/CHILD_ACQUIRED_AT:(\d+)/)?.[1]);
  assert.ok(Number.isFinite(acquiredAt), `child did not report lock acquisition: ${output} ${errorOutput}`);
  assert.ok(acquiredAt >= releasedAt, `second process entered before the first released its lock (${acquiredAt} < ${releasedAt})`);
  const status = getLocalTtsManagerStatus();
  assert.equal(status.active, false);
  assert.equal(status.workerExited, true);
});
