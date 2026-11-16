import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('production refuses missing, wildcard and insecure origins', () => {
  for (const origin of ['', '*', 'http://example.com', 'https://example.com/path', 'https://user:password@example.com']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import './Back-end/config.js'"], { env: { ...process.env, NODE_ENV: 'production', APP_ORIGINS: origin }, encoding: 'utf8' });
    assert.notEqual(result.status, 0, origin);
  }
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import './Back-end/config.js'"], { env: { ...process.env, NODE_ENV: 'production', APP_ORIGINS: 'https://example.com' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
