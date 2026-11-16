import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createApplicationServer } from '../serverLifecycle.js';

const silent = { info() {}, warn() {}, error() {} };
const start = async (application) => {
  const address = await application.listen({ host: '127.0.0.1', port: 0 });
  return `http://127.0.0.1:${address.port}`;
};

test('request IDs correlate sanitized failures without logging credentials or personal request data', async (t) => {
  const logs = [];
  const logger = Object.fromEntries(['info', 'warn', 'error'].map((level) => [level, (line) => logs.push(JSON.parse(line))]));
  const application = createApplicationServer({ logger, handler: () => { throw Object.assign(new Error('secret-password /private-name.js:1:2'), { code: 'ERR_TEST_FAILURE' }); } });
  t.after(() => application.shutdown());
  const base = await start(application);
  const response = await fetch(`${base}/api/private-person?password=secret-password`, { method: 'POST', headers: { Cookie: 'secret-cookie', 'X-Request-ID': 'untrusted-id' }, body: 'private-body' });
  const body = await response.json();
  assert.equal(response.status, 500);
  const requestId = response.headers.get('x-request-id');
  assert.match(requestId, /^[0-9a-f-]{36}$/);
  assert.equal(body.requestId, requestId);
  assert.equal(body.error, 'internal_error');
  assert.equal(response.headers.get('access-control-expose-headers'), 'X-Request-ID');
  const error = logs.find((log) => log.event === 'request_error');
  const complete = logs.filter((log) => log.event === 'request_complete');
  assert.equal(error.requestId, requestId);
  assert.equal(error.code, 'ERR_TEST_FAILURE');
  assert.equal(complete.length, 1);
  assert.equal(complete[0].requestId, requestId);
  assert.equal(complete[0].status, 500);
  assert.ok(complete[0].durationMs >= 0);
  for (const secret of ['secret-password', 'private-name', 'private-person', 'secret-cookie', 'untrusted-id', 'private-body']) assert.ok(!JSON.stringify(logs).includes(secret), secret);
});

test('graceful shutdown is idempotent and waits for an active handler before closing resources', async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let closed = 0;
  const application = createApplicationServer({
    logger: silent,
    closeResources: () => { closed += 1; },
    handler: async (_req, res) => { entered.resolve(); await release.promise; res.end('saved'); },
  });
  const responsePromise = fetch(await start(application));
  await entered.promise;
  const stopping = application.shutdown('SIGTERM');
  assert.equal(application.shutdown('SIGINT'), stopping);
  await new Promise(setImmediate);
  assert.equal(closed, 0);
  release.resolve();
  assert.equal(await (await responsePromise).text(), 'saved');
  assert.deepEqual(await stopping, { forced: false });
  assert.equal(closed, 1);
  await application.shutdown();
  assert.equal(closed, 1);
});

test('shutdown deadline terminates stalled uploads and closes resources once', async (t) => {
  const entered = Promise.withResolvers();
  let closed = 0;
  const application = createApplicationServer({
    logger: silent,
    shutdownGraceMs: 50,
    closeResources: () => { closed += 1; },
    handler: async (req, res) => { entered.resolve(); for await (const _chunk of req) { /* Wait for the incomplete upload. */ } res.end('done'); },
  });
  t.after(() => application.shutdown());
  const upload = request(await start(application), { method: 'POST', headers: { 'Content-Length': '1000' } });
  upload.on('error', () => {});
  t.after(() => upload.destroy());
  const disconnected = new Promise((resolve) => upload.once('close', resolve));
  upload.write('unfinished');
  await entered.promise;
  const began = performance.now();
  assert.deepEqual(await application.shutdown(), { forced: true });
  assert.ok(performance.now() - began < 2000);
  await disconnected;
  assert.equal(closed, 1);
});

test('a listen failure closes resources and rejects with its original technical error', async (t) => {
  const owner = createApplicationServer({ logger: silent, handler: (_req, res) => res.end() });
  t.after(() => owner.shutdown());
  await start(owner);
  let closed = 0;
  const application = createApplicationServer({ logger: silent, handler: () => {}, closeResources: () => { closed += 1; } });
  await assert.rejects(application.listen({ host: '127.0.0.1', port: owner.server.address().port }), { code: 'EADDRINUSE' });
  assert.equal(closed, 1);
  await application.shutdown();
  assert.equal(closed, 1);
  await assert.rejects(application.listen({ port: 0 }), /Cannot listen after shutdown/);
});

test('resource cleanup failures are reported and are never retried concurrently', async () => {
  let closed = 0;
  const application = createApplicationServer({ logger: silent, handler: () => {}, closeResources: () => { closed += 1; throw new Error('unavailable'); } });
  const stopping = application.shutdown();
  assert.equal(stopping, application.shutdown());
  await assert.rejects(stopping, /unavailable/);
  assert.equal(closed, 1);
});
