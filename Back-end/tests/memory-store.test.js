import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';

test('private data migration, API hydration, optimistic rollback, logout and account switching use RAM only', async (t) => {
  class BrowserStorage {
    values = new Map();
    privateWritesForbidden = false;
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) {
      if (this.privateWritesForbidden) assert.ok(!key.startsWith('edu-') && !key.startsWith('educontrol_'), `Private browser write: ${key}`);
      this.values.set(key, String(value));
    }
    removeItem(key) { this.values.delete(key); }
    clear() { assert.fail('Storage.clear must never be called'); }
  }
  globalThis.window = new EventTarget();
  globalThis.localStorage = window.localStorage = new BrowserStorage();
  globalThis.sessionStorage = window.sessionStorage = new BrowserStorage();
  const realFetch = globalThis.fetch;
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
  t.after(async () => { await vite.close(); globalThis.fetch = realFetch; });
  const memory = await vite.ssrLoadModule('/src/api/memoryStore.js');
  const api = await vite.ssrLoadModule('/src/api/backend.js');
  t.after(() => api.clearBackendSession());
  const { memoryCache, sessionIdentity, privateKeys } = memory;
  const key = 'edu-students-v1';
  const user = { id: 'one', username: 'one', roleId: 'staff', roleName: 'Staff', permissions: ['students.view', 'students.create', 'students.edit', 'students.delete'] };
  let serverRows = [{ id: 'S1', firstName: 'Server' }];
  let version = 1;
  let failWrite = false;
  const writes = [];
  const serve = async (path, options = {}) => {
    assert.equal(options.credentials, 'include');
    assert.ok(options.signal instanceof AbortSignal);
    if (path.endsWith('/auth/login') || path.endsWith('/auth/session')) return Response.json({ user });
    if (path.endsWith('/auth/logout')) return Response.json({ ok: true });
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      writes.push(body);
      if (failWrite) return Response.json({ message: 'Write rejected', error: 'forbidden' }, { status: 403 });
      assert.equal(body.version, version);
      serverRows = body.value;
      version += 1;
      return Response.json({ version });
    }
    return Response.json({ state: { [key]: serverRows }, versions: { [key]: version }, writable: [key], empty: false });
  };
  globalThis.fetch = serve;

  await t.test('targeted cleanup preserves settings and offers legacy drafts without uploading', async () => {
    for (const privateKey of privateKeys) {
      localStorage.setItem(privateKey, JSON.stringify([{ id: 'old-unsent-draft' }]));
      sessionStorage.setItem(privateKey, '[]');
    }
    localStorage.setItem('admin-theme', 'dark');
    localStorage.setItem('other-app-key', 'keep');
    sessionStorage.setItem('educontrol_logged_in', 'true');
    sessionStorage.setItem('educontrol_role', 'owner');
    api.initializeClientData();
    for (const privateKey of privateKeys) {
      assert.equal(localStorage.getItem(privateKey), null);
      assert.equal(sessionStorage.getItem(privateKey), null);
      assert.ok(memory.getLegacyRecovery()[privateKey].includes('old-unsent-draft'));
    }
    assert.equal(localStorage.getItem('admin-theme'), 'dark');
    assert.equal(localStorage.getItem('other-app-key'), 'keep');
    assert.equal(api.hasBackendSession(), false);
    assert.equal(memoryCache.getItem(key), null);
    assert.equal(writes.length, 0);
    memory.discardLegacyRecovery();
    localStorage.privateWritesForbidden = sessionStorage.privateWritesForbidden = true;
  });

  await t.test('login loads server data without uploading old snapshots', async () => {
    await api.loginToBackend('one', 'password-only-in-request');
    assert.equal(api.hasBackendSession(), true);
    assert.equal(sessionIdentity.getItem('educontrol_user_id'), 'one');
    assert.deepEqual(JSON.parse(memoryCache.getItem(key)), serverRows);
    assert.equal(writes.length, 0);
    assert.equal(localStorage.getItem(key), null);
    assert.equal(sessionStorage.getItem('educontrol_user_id'), null);
  });

  await t.test('create, edit and delete are acknowledged by the API', async () => {
    const created = [...serverRows, { id: 'S2', firstName: 'New' }];
    memoryCache.setItem(key, JSON.stringify(created));
    await api.flushPending();
    assert.deepEqual(serverRows, created);
    memoryCache.setItem(key, JSON.stringify(serverRows.map((row) => row.id === 'S2' ? { ...row, firstName: 'Edited' } : row)));
    await api.flushPending();
    assert.equal(serverRows[1].firstName, 'Edited');
    memoryCache.setItem(key, JSON.stringify(serverRows.filter((row) => row.id !== 'S2')));
    await api.flushPending();
    assert.equal(serverRows.length, 1);
    assert.equal(writes.length, 3);
  });

  await t.test('API failure rolls shared state back and keeps a RAM-only retry draft', async () => {
    const previous = memoryCache.getItem(key);
    const draft = JSON.stringify([...serverRows, { id: 'retry-me' }]);
    failWrite = true;
    memoryCache.setItem(key, draft);
    assert.equal(memoryCache.getItem(key), draft);
    await assert.rejects(api.flushPending(), { status: 403 });
    assert.equal(memoryCache.getItem(key), previous);
    assert.equal(api.hasUnsavedChanges(), true);
    assert.equal(localStorage.getItem(key), null);
    failWrite = false;
    await api.retryFailedChanges();
    assert.equal(serverRows.at(-1).id, 'retry-me');
    assert.equal(api.hasUnsavedChanges(), false);
  });

  await t.test('refresh restores identity and authorized data only after server verification', async () => {
    api.clearBackendSession();
    assert.equal(api.hasBackendSession(), false);
    assert.equal(memoryCache.getItem(key), null);
    const { user: verifiedUser } = await api.apiRequest('/auth/session');
    await api.hydrateBackendState();
    api.applySessionUser(verifiedUser);
    assert.deepEqual(JSON.parse(memoryCache.getItem(key)), serverRows);
    assert.equal(sessionStorage.getItem('educontrol_role'), null);
  });

  await t.test('logout aborts old reads; delayed old responses cannot contaminate a new account', async () => {
    let resolveOld;
    let oldSignal;
    globalThis.fetch = async (path, options) => {
      if (path.endsWith('/state')) {
        oldSignal = options.signal;
        return new Promise((resolve) => { resolveOld = resolve; });
      }
      return serve(path, options);
    };
    const oldRead = api.hydrateBackendState();
    const rejected = assert.rejects(oldRead, { code: 'session_changed' });
    await api.logoutFromBackend();
    assert.equal(oldSignal.aborted, true);
    assert.equal(memoryCache.getItem(key), null);
    assert.equal(api.hasBackendSession(), false);
    globalThis.fetch = serve;
    user.id = 'two'; user.username = 'two';
    serverRows = [{ id: 'SECOND-ACCOUNT' }];
    await api.loginToBackend('two', 'second-password');
    resolveOld(Response.json({ state: { [key]: [{ id: 'FIRST-ACCOUNT-SECRET' }] }, versions: { [key]: 999 }, writable: [key] }));
    await rejected;
    assert.equal(JSON.parse(memoryCache.getItem(key))[0].id, 'SECOND-ACCOUNT');
    assert.equal(sessionIdentity.getItem('educontrol_user_id'), 'two');
  });

  await t.test('failed pending work blocks logout until retried or explicitly discarded', async () => {
    failWrite = true;
    memoryCache.setItem(key, JSON.stringify([...serverRows, { id: 'UNSENT' }]));
    await assert.rejects(api.logoutFromBackend(), { status: 403 });
    assert.equal(api.hasBackendSession(), true);
    assert.equal(api.hasUnsavedChanges(), true);
    api.discardFailedChanges();
    failWrite = false;
    assert.equal(api.hasUnsavedChanges(), false);
  });

  await t.test('a delayed old logout cannot clear a newly verified account', async () => {
    let resolveLogout;
    let started;
    const requested = new Promise((resolve) => { started = resolve; });
    globalThis.fetch = async (path, options) => {
      if (path.endsWith('/auth/logout')) {
        started();
        return new Promise((resolve) => { resolveLogout = resolve; });
      }
      return serve(path, options);
    };
    const oldLogout = api.logoutFromBackend();
    const rejected = assert.rejects(oldLogout, { code: 'session_changed' });
    await requested;
    globalThis.fetch = serve;
    user.id = 'three'; user.username = 'three';
    await api.loginToBackend('three', 'third-password');
    resolveLogout(Response.json({ ok: true }));
    await rejected;
    assert.equal(sessionIdentity.getItem('educontrol_user_id'), 'three');
    assert.equal(api.hasBackendSession(), true);
  });

  await t.test('401 destroys private memory and identity', async () => {
    globalThis.fetch = async () => Response.json({ error: 'unauthorized' }, { status: 401 });
    await assert.rejects(api.apiRequest('/state'), { status: 401 });
    for (const privateKey of privateKeys) assert.equal(memoryCache.getItem(privateKey), null);
    assert.equal(api.hasBackendSession(), false);
    assert.equal(localStorage.getItem('admin-theme'), 'dark');
  });

  await t.test('blocked legacy storage reports a retryable migration error', () => {
    const read = localStorage.getItem;
    localStorage.getItem = () => { throw new Error('Storage disabled'); };
    memory.migratePrivateCaches();
    assert.ok(memory.getMigrationError());
    localStorage.getItem = read;
    memory.migratePrivateCaches();
    assert.equal(memory.getMigrationError(), '');
    assert.equal(localStorage.getItem('admin-theme'), 'dark');
  });
});

test('application has no private disk persistence or native Storage monkeypatch', async () => {
  async function files(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
  }
  for (const path of await files('src')) {
    if (!/\.(jsx?|tsx?)$/.test(path)) continue;
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /indexedDB|redux-persist|localforage|Storage\.prototype/);
    if (!path.endsWith('ThemeContext.jsx') && !path.endsWith('memoryStore.js')) assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage)\s*(?:\.|\[)/, path);
  }
});
