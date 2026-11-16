import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTrafficGuard } from '../traffic.js';
import { readBody, parseCookies } from '../http.js';
import { Readable } from 'node:stream';

const request = (ip = '127.0.0.1') => ({ socket: { remoteAddress: ip } });
const response = () => Object.assign(new EventEmitter(), { setHeader() {} });

test('traffic limit expires; forged forwarding headers cannot bypass it', () => {
  let now = 0;
  const guard = createTrafficGuard({ limit: 2, windowMs: 1000, clock: () => now });
  for (let i = 0; i < 2; i++) { const res = response(); guard(request(), res); res.emit('finish'); }
  assert.throws(() => guard({ ...request(), headers: { 'x-forwarded-for': 'another-ip' } }, response()), { status: 429 });
  now = 1000;
  const res = response();
  guard(request(), res);
  res.emit('finish');
});

test('concurrent requests and client tracking stay bounded; aborted requests release capacity once', () => {
  const guard = createTrafficGuard({ maxInFlight: 1, maxClients: 2 });
  const res = response();
  guard(request('a'), res);
  assert.throws(() => guard(request('a'), response()), { status: 429 });
  res.emit('close');
  res.emit('finish');
  const next = response();
  guard(request('b'), next);
  assert.throws(() => guard(request('b'), response()), { status: 429 });
  next.emit('finish');
  assert.throws(() => guard(request('c'), response()), { status: 503 });
});

test('JSON parser rejects pollution keys, compressed bodies and declared oversized bodies', async () => {
  for (const payload of ['{"__proto__":{"admin":true}}', '{"nested":{"constructor":{"prototype":{"admin":true}}}}']) {
    const req = Readable.from([Buffer.from(payload)]);
    req.headers = { 'content-type': 'application/json' };
    await assert.rejects(readBody(req), { status: 400 });
  }
  for (const [headers, status] of [
    [{ 'content-encoding': 'gzip' }, 415],
    [{ 'content-length': String(3 * 1024 * 1024) }, 413],
  ]) {
    const req = Readable.from([]);
    req.headers = { 'content-type': 'application/json', ...headers };
    await assert.rejects(readBody(req), { status });
  }
  assert.equal({}.admin, undefined);
});

test('slow uploads cannot retain revoked authorization', async () => {
  let allowed = true;
  const req = Readable.from((async function* () {
    yield Buffer.from('{"value":');
    allowed = false;
    yield Buffer.from('1}');
  })());
  req.headers = { 'content-type': 'application/json' };
  req.assertAuthorized = () => {
    if (!allowed) throw Object.assign(new Error('Session revoked'), { status: 401 });
  };
  await assert.rejects(readBody(req), { status: 401 });
});

test('JSON parsing bounds nesting and values, rejects invalid UTF-8 and numeric overflow', async () => {
  const parse = (payload) => {
    const req = Readable.from([Buffer.isBuffer(payload) ? payload : Buffer.from(payload)]);
    req.headers = { 'content-type': 'application/json' };
    return readBody(req);
  };
  for (const payload of [
    '{"nested":' + '['.repeat(40) + '0' + ']'.repeat(40) + '}',
    '{"values":[' + '0,'.repeat(100_000) + '0]}',
    '{"value":1e999}',
    Buffer.from([123, 34, 120, 34, 58, 34, 0xff, 34, 125]),
  ]) await assert.rejects(parse(payload), { status: 400 });
  const valid = { text: '[{'.repeat(100) + '"\\', nested: { list: [1, 2] }, name: 'O‘quvchi' };
  assert.deepEqual(await parse(JSON.stringify(valid)), valid);
});

test('duplicate session cookies fail closed regardless of ordering', () => {
  for (const header of ['session=attacker; session=real', 'session=real; session=attacker']) {
    assert.equal(parseCookies(header).session, undefined);
  }
  const parsed = parseCookies('__proto__=safe; session=real; other=a=b');
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal(parsed.session, 'real');
  assert.equal(parsed.other, 'a=b');
});
