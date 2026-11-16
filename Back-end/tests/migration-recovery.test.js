import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('partial migration failures keep recovered drafts exportable while blocking entry', async (t) => {
  const previousWindow = globalThis.window;
  t.after(() => { globalThis.window = previousWindow; });
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
  t.after(() => vite.close());
  const memory = await vite.ssrLoadModule('/src/api/memoryStore.js');
  const { default: Recovery } = await vite.ssrLoadModule('/src/api/LegacyCacheRecovery.jsx');
  const storage = new Map([['edu-students-v1', '[{"id":"UNSENT"}]']]);
  let blocked = true;
  globalThis.window = {
    localStorage: { getItem: (key) => storage.get(key) ?? null, removeItem: (key) => storage.delete(key) },
    get sessionStorage() { if (blocked) throw new Error('Storage blocked'); return { getItem: () => null, removeItem() {} }; },
  };
  const render = () => renderToStaticMarkup(createElement(Recovery, null, createElement('p', null, 'PRIVATE APP')));
  memory.migratePrivateCaches();
  const partial = render();
  assert.match(partial, /Qayta urinish/);
  assert.match(partial, /JSON nusxani yuklab olish/);
  assert.doesNotMatch(partial, /Eski nusxani bekor qilish|PRIVATE APP/);
  assert.equal(memory.getLegacyRecovery()['edu-students-v1'], '[{"id":"UNSENT"}]');
  blocked = false;
  memory.migratePrivateCaches();
  const complete = render();
  assert.doesNotMatch(complete, /Qayta urinish|PRIVATE APP/);
  assert.match(complete, /JSON nusxani yuklab olish/);
  assert.match(complete, /Eski nusxani bekor qilish/);
  memory.discardLegacyRecovery();
  assert.match(render(), /PRIVATE APP/);
});

test('migration retries retain distinct recovered snapshots after partial cleanup failures', async (t) => {
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
  t.after(() => vite.close());
  const memory = await vite.ssrLoadModule('/src/api/memoryStore.js');
  const key = 'edu-students-v1';
  const localDraft = JSON.stringify([{ id: 'LOCAL-UNSENT' }]);
  const sessionDraft = JSON.stringify([{ id: 'SESSION-UNSENT' }]);
  const newerSessionDraft = JSON.stringify([{ id: 'NEWER-SESSION-UNSENT' }]);
  const local = new Map([[key, localDraft], ['admin-theme', 'dark']]);
  const session = new Map([[key, sessionDraft]]);
  let sessionBlocked = true;
  let removalBlocked = true;
  globalThis.window = {
    localStorage: { getItem: (name) => local.get(name) ?? null, removeItem: (name) => local.delete(name) },
    sessionStorage: {
      getItem(name) { if (sessionBlocked) throw new Error('Storage blocked'); return session.get(name) ?? null; },
      removeItem(name) { if (removalBlocked) throw new Error('Removal blocked'); return session.delete(name); },
    },
  };
  memory.migratePrivateCaches();
  assert.equal(memory.getLegacyRecovery()[key], localDraft);
  assert.ok(memory.getMigrationError());
  assert.equal(local.has(key), false);

  sessionBlocked = false;
  memory.migratePrivateCaches();
  assert.deepEqual(new Set(Object.values(memory.getLegacyRecovery())), new Set([localDraft, sessionDraft]));
  assert.ok(memory.getMigrationError());
  session.set(key, newerSessionDraft);
  removalBlocked = false;
  memory.migratePrivateCaches();
  assert.deepEqual(new Set(Object.values(memory.getLegacyRecovery())), new Set([localDraft, sessionDraft, newerSessionDraft]));
  assert.equal(memory.getMigrationError(), '');
  assert.equal(session.has(key), false);
  assert.equal(local.get('admin-theme'), 'dark');
  memory.migratePrivateCaches();
  assert.equal(Object.keys(memory.getLegacyRecovery()).length, 3);
  memory.discardLegacyRecovery();
});

test('rejected auxiliary writes cannot leave phantom notification or activity snapshots', async (t) => {
  globalThis.window = new EventTarget();
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
  t.after(() => vite.close());
  const memory = await vite.ssrLoadModule('/src/api/memoryStore.js');
  const notifications = await vite.ssrLoadModule('/src/admin/activity/notificationStore.js');
  const activity = await vite.ssrLoadModule('/src/admin/activity/activityStore.js');
  memory.clearCollections();
  memory.configureCollectionWriter(() => {});
  assert.equal(notifications.pushNotification({ key: 'only-once', title: 'Rejected notification' }), null);
  assert.equal(activity.logActivity({ title: 'Rejected activity' }), null);
  assert.equal(memory.memoryCache.getItem('edu-notifications-v1'), null);
  assert.equal(memory.memoryCache.getItem('edu-activity-v1'), null);

  memory.configureCollectionWriter(() => { throw new Error('Write failed'); });
  assert.equal(notifications.pushNotification({ key: 'only-once', title: 'Failed notification' }), null);
  assert.equal(activity.logActivity({ title: 'Failed activity' }), null);
  memory.configureCollectionWriter(memory.publishCollection);
  const created = notifications.pushNotification({ key: 'only-once', title: 'Accepted notification' });
  assert.ok(created);
  assert.equal(JSON.parse(memory.memoryCache.getItem('edu-notifications-v1')).length, 1);
  assert.equal(JSON.parse(memory.memoryCache.getItem('edu-notifications-v1'))[0].title, 'Accepted notification');
  assert.ok(activity.logActivity({ title: 'Accepted activity' }));
  const savedActivities = JSON.parse(memory.memoryCache.getItem('edu-activity-v1'));
  assert.equal(savedActivities.length, 1);
  assert.equal(savedActivities[0].title, 'Accepted activity');
});
