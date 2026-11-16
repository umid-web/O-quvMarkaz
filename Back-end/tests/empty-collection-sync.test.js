import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('polling an absent activity or notification list permits its first save', async (t) => {
  globalThis.window = new EventTarget();
  const realFetch = globalThis.fetch;
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
  const api = await vite.ssrLoadModule('/src/api/backend.js');
  const { memoryCache } = await vite.ssrLoadModule('/src/api/memoryStore.js');
  t.after(async () => { api.clearBackendSession(); globalThis.fetch = realFetch; await vite.close(); });
  for (const [key, poll] of [
    ['edu-activity-v1', api.syncActivityBackend],
    ['edu-notifications-v1', api.syncNotificationsBackend],
  ]) {
    await t.test(key, async () => {
      api.clearBackendSession();
      let version = null;
      let saved = [];
      const writes = [];
      globalThis.fetch = async (url, options = {}) => {
        if (url.includes('/records/')) return Response.json({ records: saved, version: version ?? 0 });
        if (options.method === 'PUT') {
          const body = JSON.parse(options.body);
          writes.push(body);
          if (body.version !== version) return Response.json({ error: 'version_conflict' }, { status: 409 });
          saved = body.value;
          version = (version ?? 0) + 1;
          return Response.json({ version, value: saved });
        }
        return Response.json({ state: version === null ? {} : { [key]: saved }, versions: version === null ? {} : { [key]: version }, writable: [key], empty: false });
      };
      await api.hydrateBackendState({ expectedAccountId: 'test-owner' });
      api.applySessionUser({ id: 'test-owner', username: 'owner', roleId: 'owner', permissions: [] });
      await poll();
      memoryCache.setItem(key, JSON.stringify([{ id: 'first', title: 'First entry' }]));
      await api.flushPending();
      assert.equal(writes[0].version, null);
      assert.equal(saved[0].id, 'first');
      await poll();
      memoryCache.setItem(key, JSON.stringify([...saved, { id: 'second', title: 'Second entry' }]));
      await api.flushPending();
      assert.deepEqual(writes.map((item) => item.version), [null, 1]);
      assert.equal(api.getSyncError(), null);
    });
  }
});
