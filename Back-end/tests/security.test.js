import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';

test('password verification rejects malformed and empty scrypt hashes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'educontrol-security-'));
  process.env.SQLITE_FILE = join(dir, 'test.sqlite');
  const { db } = await import('../database.js');
  try {
    const { hashPassword, verifyPassword } = await import('../security.js');
    const password = 'Test-password-123';
    const hash = await hashPassword(password);
    assert.equal(await verifyPassword(password, hash), true);
    assert.equal(await verifyPassword('wrong', hash), false);
    assert.equal(await verifyPassword('x'.repeat(257), hash), false);
    assert.equal(await verifyPassword(null, hash), false);
    const { accountFrom, digest } = await import('../security.js');
    const token = 'a'.repeat(43);
    db.prepare('INSERT INTO accounts (id, username, password_hash, role_id, active, created_at) VALUES (?, ?, ?, ?, 1, ?)').run('expired-test', 'expired-test', hash, 'owner', new Date().toISOString());
    db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(digest(token), 'expired-test', Date.now() + 60_000, new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString());
    assert.equal(accountFrom({ headers: { cookie: `educontrol_session=${token}` } }), null);
    assert.equal(db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(digest(token)), undefined);
    const { scopedState, mergeTeacherWrite } = await import('../permissions.js');
    const owner = { id: 'expired-test', role_id: 'owner', username: 'expired-test' };
    const { loginPasswordHash, assertAccountUnchanged } = await import('../security.js');
    assert.equal(await verifyPassword(password, loginPasswordHash(null)), false);
    assert.equal(await verifyPassword(password, loginPasswordHash({ active: 0, password_hash: hash })), false);
    assert.equal(await verifyPassword(password, loginPasswordHash({ active: 1, password_hash: hash })), true);
    assert.doesNotThrow(() => assertAccountUnchanged(owner, hash));
    db.prepare('UPDATE accounts SET active = 0 WHERE id = ?').run(owner.id);
    db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(digest(token), owner.id, Date.now() + 60_000, new Date().toISOString());
    const otherToken = 'b'.repeat(43);
    db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(digest(otherToken), owner.id, Date.now() + 60_000, new Date().toISOString());
    assert.equal(accountFrom({ headers: { cookie: `educontrol_session=${token}` } }), null);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE account_id = ?').get(owner.id).count, 0);
    assert.throws(() => assertAccountUnchanged(owner, hash), { status: 401 });
    db.prepare('UPDATE accounts SET active = 1 WHERE id = ?').run(owner.id);
    assert.equal(accountFrom({ headers: { cookie: `educontrol_session=${otherToken}` } }), null);
    assert.throws(() => assertAccountUnchanged(owner, 'stale-password-hash'), { status: 401 });
    const staff = { id: 'staff', role_id: 'staff', username: 'staff' };
    const message = { id: 'private-read', channel: 'general', fromKey: 'user:sender', text: 'Salom', readBy: ['user:expired-test', 'user:other'], reactions: {} };
    const visible = scopedState(staff, 'edu-chat-v1', [message]);
    assert.deepEqual(visible[0].readBy, ['user:other']);
    assert.deepEqual(scopedState(owner, 'edu-chat-v1', [message])[0].readBy, message.readBy);
    const saved = mergeTeacherWrite(staff, 'edu-chat-v1', [{ ...visible[0], readBy: [...visible[0].readBy, 'user:staff'] }], [message]);
    assert.ok(saved[0].readBy.includes('user:expired-test'));
    assert.deepEqual(scopedState(staff, 'edu-chat-v1', saved)[0].readBy, ['user:other', 'user:staff']);
    assert.throws(() => mergeTeacherWrite(staff, 'edu-chat-v1', [{ ...visible[0], readBy: [] }], [message]), { status: 403 });
    for (const malformed of ['scrypt$$', `scrypt$${'ab'.repeat(16)}$`, `${hash}$extra`, 'scrypt$zz$zz']) {
      assert.equal(await verifyPassword(password, malformed), false);
    }
    const { handler } = await import('../routes.js');
    for (const contentType of [undefined, 'application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data']) {
      const req = Readable.from([]);
      Object.assign(req, { method: 'POST', url: '/api/auth/logout', headers: contentType ? { 'content-type': contentType } : {}, socket: { remoteAddress: '192.0.2.200' } });
      const res = Object.assign(new EventEmitter(), { setHeader() {} });
      try { await assert.rejects(handler(req, res), { status: 415 }); }
      finally { res.emit('finish'); }
    }
    for (let attempt = 0; attempt <= 30; attempt++) {
      const req = Readable.from([Buffer.from(JSON.stringify({ username: attempt % 2 ? 'Missing-User' : 'missing-user', password }))]);
      Object.assign(req, { method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, socket: { remoteAddress: `192.0.2.${attempt + 1}` } });
      const res = Object.assign(new EventEmitter(), { setHeader() {} });
      try {
        await assert.rejects(handler(req, res), { status: attempt < 30 ? 401 : 429 });
      } finally { res.emit('finish'); }
    }
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
