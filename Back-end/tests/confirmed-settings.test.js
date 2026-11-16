import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

test('settings confirmation and financial callbacks preserve server state across errors and session changes', async (t) => {
  globalThis.window = new EventTarget();
  const realFetch = globalThis.fetch;
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
  t.after(async () => { await vite.close(); globalThis.fetch = realFetch; });
  const memory = await vite.ssrLoadModule('/src/api/memoryStore.js');
  const api = await vite.ssrLoadModule('/src/api/backend.js');
  const settings = await vite.ssrLoadModule('/src/admin/pages/settings/settingsStore.js');
  const finance = await vite.ssrLoadModule('/src/admin/pages/finance/financeStore.js');
  const accounts = await vite.ssrLoadModule('/src/admin/pages/users-roles/usersStore.js');
  t.after(() => api.clearBackendSession());
  const key = 'edu-settings-v1';
  const serverState = {
    [key]: settings.cloneSettings(settings.DEFAULT_SETTINGS),
    'edu-payments-v1': [], 'edu-expenses-v1': [], 'edu-users-v1': [],
    'edu-roles-v1': [{ id: 'owner', name: 'Owner', permissions: [] }, { id: 'staff', name: 'Staff', permissions: [] }],
    'edu-activity-v1': [], 'edu-notifications-v1': [],
  };
  serverState[key].org.name = 'Confirmed server name';
  const versions = Object.fromEntries(Object.keys(serverState).map((collection) => [collection, 1]));
  const writes = [];
  const serve = async (path, options = {}) => {
    if (path.endsWith('/admin/accounts')) {
      const user = { id: 'NEW-USER', login: 'new-user', firstName: 'New', lastName: 'User', roleId: 'staff', status: 'active', createdAt: '2026-11-09', lastLoginAt: '' };
      serverState['edu-users-v1'] = [user, ...serverState['edu-users-v1']];
      return Response.json({ user, version: ++versions['edu-users-v1'], changes: {} });
    }
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      writes.push(body);
      assert.equal(body.version, versions[body.key]);
      serverState[body.key] = body.value;
      return Response.json({ version: ++versions[body.key] });
    }
    return Response.json({ state: serverState, versions, writable: [...memory.privateKeys], empty: false });
  };
  globalThis.fetch = serve;
  await api.hydrateBackendState();
  api.applySessionUser({ id: 'A', username: 'A', roleId: 'staff', permissions: [] });
  const capture = (hook) => {
    let result;
    function Probe() { result = hook(); return null; }
    renderToString(createElement(Probe));
    return result;
  };

  await t.test('settings remain unmodified until the server acknowledges the save', async () => {
    let acknowledge;
    let started;
    const requested = new Promise((resolve) => { started = resolve; });
    globalThis.fetch = async (path, options) => {
      if (options.method === 'PUT') {
        started();
        return new Promise((resolve) => { acknowledge = async () => resolve(await serve(path, options)); });
      }
      return serve(path, options);
    };
    const next = settings.loadSettings();
    next.org.name = 'Acknowledged name';
    let completed = false;
    const saving = settings.saveSettings(next).then((value) => { completed = true; return value; });
    await requested;
    assert.equal(completed, false);
    assert.equal(settings.loadSettings().org.name, 'Confirmed server name');
    await acknowledge();
    assert.equal((await saving).org.name, 'Acknowledged name');
    assert.equal(settings.loadSettings().org.name, 'Acknowledged name');
    globalThis.fetch = serve;
  });

  await t.test('a rejected settings save cannot claim or retain a changed organization', async () => {
    const next = settings.loadSettings();
    next.org.name = 'Rejected name';
    globalThis.fetch = async () => Response.json({ error: 'forbidden', message: 'Denied' }, { status: 403 });
    await assert.rejects(settings.saveSettings(next), { status: 403 });
    assert.equal(settings.loadSettings().org.name, 'Acknowledged name');
    globalThis.fetch = serve;
  });

  await t.test('rapid financial additions have unique IDs and immediate removals use current rows', async () => {
    const payments = capture(() => finance.usePayments([]));
    const first = payments.add({ studentId: 'S1', name: 'Test', amount: 10, date: '2026-11-09' });
    const second = payments.add({ studentId: 'S1', name: 'Test', amount: 20, date: '2026-11-09' });
    assert.notEqual(first.id, second.id);
    assert.equal(payments.removeForStudent('S1').length, 2);
    payments.restore(first);
    payments.restore(first);
    assert.equal(memory.readCollectionSnapshot('edu-payments-v1').length, 1);
    await api.flushPending();
    assert.equal(serverState['edu-payments-v1'].length, 1);
  });

  await t.test('confirmed account insertion is idempotent and does not resend the users list', async () => {
    const actions = capture(accounts.useAccess);
    const created = await api.createBackendAccount({ username: 'new-user' });
    actions.addUser(created);
    await api.flushPending();
    assert.equal(memory.readCollectionSnapshot('edu-users-v1').filter((user) => user.id === created.id).length, 1);
    assert.equal(writes.filter((write) => write.key === 'edu-users-v1').length, 0);
  });

  await t.test('callbacks captured by the previous account cannot write to the next account store', () => {
    const oldActions = capture(() => finance.usePayments([]));
    api.clearBackendSession();
    api.applySessionUser({ id: 'B', username: 'B', roleId: 'staff', permissions: [] });
    memory.publishCollection('edu-payments-v1', JSON.stringify([{ id: 'B-PRIVATE' }]));
    assert.throws(() => oldActions.add({ name: 'A-old', studentId: 'A', amount: 1 }), { code: 'session_changed' });
    assert.deepEqual(memory.readCollectionSnapshot('edu-payments-v1'), [{ id: 'B-PRIVATE' }]);
  });
});
