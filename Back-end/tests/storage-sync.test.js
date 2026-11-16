import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('read-only teacher caches do not attempt writes; authorized changes still sync', async (t) => {
  class MemoryStorage {
    values = new Map();
    getItem(key) { return this.values.get(String(key)) ?? null; }
    setItem(key, value) { this.values.set(String(key), String(value)); }
    removeItem(key) { this.values.delete(String(key)); }
  }
  class CacheEvent extends Event {
    constructor(type, init) { super(type); Object.assign(this, init); }
  }
  globalThis.Storage = MemoryStorage;
  globalThis.localStorage = new MemoryStorage();
  globalThis.sessionStorage = new MemoryStorage();
  globalThis.StorageEvent = CacheEvent;
  globalThis.window = new EventTarget();
  window.localStorage = localStorage;
  const errors = [];
  window.addEventListener('educontrol:sync-error', (event) => errors.push(event.detail));
  const serverState = { 'edu-students-v1': [{ id: 'S1', firstName: 'Ali', lastName: 'Valiyev', group: 'G1', status: 'active', debt: 50000, attendance: 20 }], 'edu-payments-v1': [], 'edu-roles-v1': [{ id: 'teacher', name: 'Ustoz', permissions: ['attendance.view'] }] };
  const versions = { 'edu-students-v1': 1, 'edu-payments-v1': 1 };
  let writable = [];
  const writes = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (path, options = {}) => {
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      writes.push(body);
      assert.ok(writable.includes(body.key));
      serverState[body.key] = body.value;
      versions[body.key] += 1;
      return Response.json({ version: versions[body.key] });
    }
    if (path.endsWith('/auth/logout')) return Response.json({ ok: true });
    return Response.json({ state: serverState, versions, writable, empty: false });
  };
  const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
  t.after(async () => { await vite.close(); globalThis.fetch = realFetch; });
  const api = await vite.ssrLoadModule('/src/api/backend.js');
  const { memoryCache, sessionIdentity, publishCollection } = await vite.ssrLoadModule('/src/api/memoryStore.js');
  const originalSetItem = Storage.prototype.setItem;
  api.initializeClientData();
  assert.equal(Storage.prototype.setItem, originalSetItem);
  await api.hydrateBackendState();
  const roleHelpers = await vite.ssrLoadModule('/src/admin/pages/users-roles/usersData.js');
  const normalizedRoles = roleHelpers.normalizeRoles([{ id: 'custom', name: 'Custom', permissions: [] }]);
  assert.deepEqual(normalizedRoles.find((role) => role.id === 'custom').permissions, []);
  assert.equal(normalizedRoles.find((role) => role.id === 'owner').permissions.length, roleHelpers.ALL_PERMISSIONS.length);
  const adminPermissions = roleHelpers.defaultPermissions('admin');
  assert.ok(adminPermissions.includes('users-roles.view'));
  assert.ok(adminPermissions.includes('users-roles.create'));
  assert.ok(!adminPermissions.includes('users-roles.edit'));
  assert.ok(!adminPermissions.includes('users-roles.delete'));
  assert.deepEqual(roleHelpers.USER_STATUS_OPTIONS.map((option) => option.value), ['active', 'blocked']);
  const enabled = roleHelpers.togglePermission([], 'students', 'create');
  assert.ok(enabled.includes('students.view') && enabled.includes('students.create'));
  assert.deepEqual(roleHelpers.togglePermission(enabled, 'students', 'view'), []);
  const column = roleHelpers.setActionPermissions([], 'edit', true);
  assert.ok(column.includes('students.edit') && column.includes('students.view'));
  assert.deepEqual(roleHelpers.setModulePermissions(column.filter((permission) => permission.startsWith('students.')), 'students', false), []);
  sessionIdentity.setItem('educontrol_logged_in', 'true');
  sessionIdentity.setItem('educontrol_role', 'teacher');
  // Simulate the effects mounted by the teacher dashboard, including a missing salary list.
  for (const key of Object.keys({ ...serverState, 'edu-salary-v1': [], 'edu-attendance-v1': {} })) {
    assert.equal(api.canWriteBackendCollection(key), false);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  assert.equal(memoryCache.getItem('edu-salary-v1'), null);
  assert.deepEqual(JSON.parse(memoryCache.getItem('edu-students-v1')), serverState['edu-students-v1']);
  const { syncSystemAlerts } = await vite.ssrLoadModule('/src/admin/activity/systemAlerts.js');
  syncSystemAlerts();
  const { loadRoles } = await vite.ssrLoadModule('/src/admin/pages/users-roles/usersStore.js');
  loadRoles();
  assert.deepEqual(errors, []);
  assert.equal(memoryCache.getItem('edu-notifications-v1'), null);
  assert.equal(memoryCache.getItem('edu-activity-v1'), null);
  assert.deepEqual(JSON.parse(memoryCache.getItem('edu-roles-v1')), serverState['edu-roles-v1']);
  // A genuine unauthorized mutation still produces the permission error.
  assert.throws(() => memoryCache.setItem('edu-payments-v1', JSON.stringify([{ id: 'denied' }])), { status: 403 });
  assert.equal(errors.length, 1);
  assert.deepEqual(writes, []);
  assert.deepEqual(JSON.parse(memoryCache.getItem('edu-payments-v1')), []);
  // An account with write access can continue saving changes normally.
  writable = ['edu-payments-v1'];
  await api.hydrateBackendState();
  const payment = { id: 'P1', amount: 100000 };
  memoryCache.setItem('edu-payments-v1', JSON.stringify([payment]));
  memoryCache.setItem('edu-payments-v1', '[]');
  await api.refreshBackendState();
  assert.equal(writes.length, 0);
  memoryCache.setItem('edu-payments-v1', JSON.stringify([payment]));
  await api.refreshBackendState();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].value, [payment]);
  assert.equal(writes[0].version, 1);
  assert.deepEqual(serverState['edu-payments-v1'], [payment]);
  // A poll response must not overwrite a reaction edited while it was loading.
  writable.push('edu-chat-v1');
  serverState['edu-chat-v1'] = [];
  versions['edu-chat-v1'] = 1;
  await api.hydrateBackendState();
  const fetchBeforeChat = globalThis.fetch;
  const editedChat = [{ id: 'MSG-race', text: 'Salom', reactions: { '👍': ['user:1'] } }];
  globalThis.fetch = async (path, options) => {
    if (path.endsWith('/chat/sync')) {
      memoryCache.setItem('edu-chat-v1', JSON.stringify(editedChat));
      return Response.json({ messages: [], presence: {}, peers: [] });
    }
    return fetchBeforeChat(path, options);
  };
  const chatSync = await api.syncChatBackend();
  assert.deepEqual(chatSync.messages, editedChat);
  assert.deepEqual(JSON.parse(memoryCache.getItem('edu-chat-v1')), editedChat);
  globalThis.fetch = fetchBeforeChat;
  await api.refreshBackendState();
  assert.deepEqual(serverState['edu-chat-v1'], editedChat);
  // A delayed response from the old session must not restore private caches.
  let releaseOldState;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  globalThis.fetch = async (path, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    if (path.endsWith('/state')) {
      markStarted();
      return new Promise((resolve) => { releaseOldState = () => resolve(Response.json({ state: serverState, versions, writable, empty: false })); });
    }
    return fetchBeforeChat(path, options);
  };
  localStorage.setItem('preferred-theme', 'dark');
  const oldHydration = api.hydrateBackendState();
  const rejectedHydration = assert.rejects(oldHydration, { code: 'session_changed' });
  await started;
  await api.logoutFromBackend();
  assert.equal(api.hasBackendSession(), false);
  assert.equal(memoryCache.getItem('edu-students-v1'), null);
  assert.equal(memoryCache.getItem('edu-chat-v1'), null);
  assert.equal(localStorage.getItem('preferred-theme'), 'dark');
  releaseOldState();
  await rejectedHydration;
  assert.equal(memoryCache.getItem('edu-students-v1'), null);
  // Unauthorized responses clear both identity and data, and notify the router.
  let expired = 0;
  window.addEventListener('educontrol:session-expired', () => { expired += 1; });
  sessionIdentity.setItem('educontrol_logged_in', 'true');
  sessionIdentity.setItem('educontrol_teacher_id', 'private-id');
  publishCollection('edu-students-v1', '[]');
  globalThis.fetch = async () => Response.json({ error: 'unauthorized' }, { status: 401 });
  await assert.rejects(api.apiRequest('/state'), { status: 401 });
  assert.equal(api.hasBackendSession(), false);
  assert.equal(sessionIdentity.getItem('educontrol_teacher_id'), null);
  assert.equal(memoryCache.getItem('edu-students-v1'), null);
  assert.equal(expired, 1);
  // Login cannot silently import legacy browser data into an empty database.
  const importedKeys = [];
  globalThis.fetch = async (path, options = {}) => {
    if (path.endsWith('/auth/login')) return Response.json({ user: { id: 'owner', username: 'owner', roleId: 'owner', roleName: 'Owner', permissions: [] } });
    if (options.method === 'PUT') {
      importedKeys.push(JSON.parse(options.body).key);
      return Response.json({ version: 1 });
    }
    return Response.json({ state: {}, versions: {}, writable: ['edu-students-v1', 'edu-roles-v1'], empty: true });
  };
  localStorage.setItem('edu-students-v1', JSON.stringify([{ id: 'legacy-private-student' }]));
  await api.loginToBackend('owner', 'test-password');
  assert.deepEqual(importedKeys, ['edu-roles-v1']);
  assert.equal(memoryCache.getItem('edu-students-v1'), null);
  api.clearBackendSession();
});
