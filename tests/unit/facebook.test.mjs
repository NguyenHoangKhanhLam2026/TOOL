import test from 'node:test';
import assert from 'node:assert/strict';
import { MockFacebookAdapter } from '../../packages/facebook-engine/mock-adapter.mjs';

test('Mock Facebook adapter clearly identifies the local test page', async () => {
  const result = await new MockFacebookAdapter().checkConnection();
  assert.equal(result.connected, true);
  assert.equal(result.adapter, 'mock');
  assert.match(result.pageName, /thử nghiệm/);
});
