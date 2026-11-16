import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('state hydration and serialized writes preserve newer edits and account binding', async (t) => {
  globalThis.window = new EventTarget();
  const originalFetch = globalThis.fetch;
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
  const api = await vite.ssrLoadModule('/src/api/backend.js');
  const { memoryCache } = await vite.ssrLoadModule('/src/api/memoryStore.js');
  t.after(async () => { api.clearBackendSession(); await vite.close(); globalThis.fetch = originalFetch; });
  const students = 'edu-students-v1';
  const users = 'edu-users-v1';
  const user = { id: 'verified-account', username: 'verified', roleId: 'staff', roleName: 'Staff', permissions: [] };
  let state;
  let versions;
  let requests;
  let intercept;
  const stateResponse = () => Response.json({ state, versions, writable: [students, users], empty: false });
  const serve = async (path, options = {}) => {
    requests.push({ path, options });
    if (intercept) {
      const response = intercept(path, options);
      if (response) return response;
    }
    if (path.endsWith('/auth/logout')) return Response.json({ ok: true });
    if (path.endsWith('/admin/accounts')) {
      const profile = JSON.parse(options.body);
      state[users] = [profile, ...state[users]];
      return Response.json({ user: profile, version: ++versions[users] });
    }
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      if (body.version !== versions[body.key]) return Response.json({ error: 'version_conflict' }, { status: 409 });
      state[body.key] = body.value;
      return Response.json({ version: ++versions[body.key] });
    }
    return stateResponse();
  };
  const reset = async () => {
    api.clearBackendSession();
    state = { [students]: [{ id: 'base' }], [users]: [{ id: 'existing-user' }] };
    versions = { [students]: 1, [users]: 1 };
    requests = [];
    intercept = null;
    globalThis.fetch = serve;
    await api.hydrateBackendState({ expectedAccountId: user.id });
    api.applySessionUser(user);
  };

  await t.test('a read started before an optimistic edit cannot overwrite its draft', async () => {
    await reset();
    const oldResponse = stateResponse();
    const read = deferred();
    intercept = (path, options) => path.endsWith('/state') && !options.method ? read.promise : null;
    const hydration = api.hydrateBackendState();
    memoryCache.setItem(students, JSON.stringify([{ id: 'base' }, { id: 'draft' }]));
    read.resolve(oldResponse);
    assert.equal(await hydration, false);
    assert.equal(JSON.parse(memoryCache.getItem(students)).at(-1).id, 'draft');
    intercept = null;
    await api.flushPending();
    assert.equal(state[students].at(-1).id, 'draft');
  });

  await t.test('a stale read cannot regress an acknowledged write or its version', async () => {
    await reset();
    const oldResponse = stateResponse();
    const read = deferred();
    intercept = (path, options) => path.endsWith('/state') && !options.method ? read.promise : null;
    const hydration = api.hydrateBackendState();
    memoryCache.setItem(students, JSON.stringify([{ id: 'base' }, { id: 'saved' }]));
    await api.flushPending();
    read.resolve(oldResponse);
    assert.equal(await hydration, false);
    assert.equal(JSON.parse(memoryCache.getItem(students)).at(-1).id, 'saved');
    intercept = null;
    memoryCache.setItem(students, JSON.stringify([...state[students], { id: 'next' }]));
    await api.flushPending();
    const writes = requests.filter(({ options }) => options.method === 'PUT').map(({ options }) => JSON.parse(options.body));
    assert.deepEqual(writes.map((body) => body.version), [1, 2]);
  });

  await t.test('only the newest overlapping hydration request publishes', async () => {
    await reset();
    const first = deferred();
    const second = deferred();
    let count = 0;
    intercept = (path, options) => path.endsWith('/state') && !options.method ? (++count === 1 ? first.promise : second.promise) : null;
    const older = api.hydrateBackendState();
    const newer = api.hydrateBackendState();
    second.resolve(Response.json({ state: { [students]: [{ id: 'newest' }] }, versions: { [students]: 3 }, writable: [students] }));
    assert.equal(await newer, true);
    first.resolve(Response.json({ state: { [students]: [{ id: 'old' }] }, versions: { [students]: 2 }, writable: [students] }));
    assert.equal(await older, false);
    assert.equal(JSON.parse(memoryCache.getItem(students))[0].id, 'newest');
  });

  await t.test('overlapping direct saves merge independent records instead of deleting the first save', async () => {
    await reset();
    const started = deferred();
    const release = deferred();
    let held = false;
    intercept = (_path, options) => {
      if (options.method !== 'PUT' || held) return null;
      held = true;
      const body = JSON.parse(options.body);
      state[body.key] = body.value;
      const response = Response.json({ version: ++versions[body.key] });
      started.resolve();
      return release.promise.then(() => response);
    };
    const first = api.saveBackendCollection(students, [{ id: 'base' }, { id: 'first' }]);
    const second = api.saveBackendCollection(students, [{ id: 'base' }, { id: 'second' }]);
    await started.promise;
    release.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(state[students].map((row) => row.id).sort(), ['base', 'first', 'second']);
  });

  await t.test('a queued user edit cannot drop an account created while that edit was pending', async () => {
    await reset();
    const started = deferred();
    const release = deferred();
    intercept = (path, options) => {
      if (!path.endsWith('/admin/accounts')) return null;
      const profile = JSON.parse(options.body);
      state[users] = [profile, ...state[users]];
      const response = Response.json({ user: profile, version: ++versions[users] });
      started.resolve();
      return release.promise.then(() => response);
    };
    const create = api.createBackendAccount({ id: 'created-account' });
    await started.promise;
    memoryCache.setItem(users, JSON.stringify([{ id: 'existing-user' }, { id: 'queued-user' }]));
    const flush = api.flushPending();
    release.resolve();
    await Promise.all([create, flush]);
    assert.deepEqual(state[users].map((row) => row.id).sort(), ['created-account', 'existing-user', 'queued-user']);
  });

  await t.test('hydration and logout bind requests to the server-verified account', async () => {
    await reset();
    assert.equal(requests[0].options.headers['X-Educontrol-Account'], user.id);
    await api.apiRequest('/auth/me');
    assert.equal(requests.at(-1).options.headers['X-Educontrol-Account'], user.id);
    await api.logoutFromBackend();
    assert.equal(requests.at(-1).options.headers['X-Educontrol-Account'], user.id);
    assert.equal(api.hasBackendSession(), false);
  });

  await t.test('refresh cannot trigger a reload after an intervening unsaved edit', async () => {
    await reset();
    const started = deferred();
    const read = deferred();
    const oldResponse = stateResponse();
    intercept = (path, options) => {
      if (!path.endsWith('/state') || options.method) return null;
      started.resolve();
      return read.promise;
    };
    const refresh = api.refreshBackendState();
    const rejected = assert.rejects(refresh, { code: 'refresh_interrupted' });
    await started.promise;
    memoryCache.setItem(students, JSON.stringify([{ id: 'base' }, { id: 'do-not-lose' }]));
    read.resolve(oldResponse);
    await rejected;
    assert.equal(JSON.parse(memoryCache.getItem(students)).at(-1).id, 'do-not-lose');
    intercept = null;
    await api.flushPending();
  });
});
