import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { db } from './database.js';
import { guardTraffic } from './traffic.js';
import { syncLessonAlerts } from './lessonAlerts.js';
import { assertAttendanceSchedule } from './attendanceSchedule.js';
import { assertCanManageRole } from './accessPolicy.js';
import { COOKIE, origins } from './config.js';
import { BODY_LIMIT, json, fail, parseCookies, readBody } from './http.js';
import { collections, allPermissions, validPermissions, roleFor, accountProfile, scopedState, mergeTeacherWrite, chatActorKey, chatTeacherProfile, can } from './permissions.js';
import { digest, hashPassword, verifyPassword, accountFrom, requireAuth, setSessionCookie, sessionTtlMs, passwordMinimumLength } from './security.js';
import { loginPasswordHash, assertAccountUnchanged } from './security.js';
import { nowIso, writeAudit } from './audit.js';
import { handleRecordRequest } from './records.js';
import { validateCollection } from './validation.js';
import { readStoredData, writeStoredData } from './dataStore.js';
import { handleReportRequest } from './reports.js';
import { validateTeacherAccounts } from './teacherAccounts.js';
import { applyAccountFields, resolveAccountRole, validateMonthlySalary, assertAccountRole } from './accountFields.js';
import { buildPayroll } from '../src/admin/pages/finance/payroll.js';
import { canSeeAllSalaries, ownsSalary, redactSalary, preservePrivateSalary } from './salaryPrivacy.js';

// This is an account-consistency assertion, never an authentication credential.
// The authenticated account still comes exclusively from the server session.
function assertRequestedAccount(req, account) {
  const expected = req.headers['x-educontrol-account'];
  if (expected !== undefined && expected !== account?.id) {
    throw fail(401, 'account_changed', 'Hisob almashgan. Ma’lumotlarni qayta yuklang.');
  }
}
export async function handler(req, res) {
  guardTraffic(req, res);
  if (req.url.length > 4096) throw fail(414, 'uri_too_long', 'Request URL is too long.');
  const origin = req.headers.origin;
  if (origin && origins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  if (origin && origins.has(origin)) res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  if (origin && !origins.has(origin)) throw fail(403, 'origin_denied', 'Origin is not allowed.');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !origin && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
    throw fail(403, 'origin_denied', 'Cross-origin browser writes require an approved Origin.');
  }
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Educontrol-Account', 'Access-Control-Max-Age': '600' });
    return res.end();
  }
  if (origin && !origins.has(origin)) throw fail(403, 'origin_denied', 'Ushbu manbadan so‘rovga ruxsat yo‘q.');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && origin && !origins.has(origin)) throw fail(403, 'origin_denied', 'Manba tekshiruvi bajarilmadi.');

  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found', message: 'API manzili topilmadi.' });

  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { status: 'ok', time: nowIso() });

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    limitAuthAttempts(`login:${req.socket.remoteAddress || 'unknown'}`, 60);
    const body = await readBody(req);
    if (typeof body.username !== 'string' || typeof body.password !== 'string') throw fail(400, 'invalid_credentials', 'Login va parol matn bo‘lishi kerak.');
    const username = body.username.trim();
    const password = body.password;
    if (username.length < 1 || username.length > 120 || password.length < 1 || password.length > 256) throw fail(400, 'invalid_credentials', 'Login va parolni to‘g‘ri kiriting.');
    // Reserve attempts before awaiting crypto, shared across source addresses.
    limitAuthAttempts(`account:${username.toLowerCase()}`, 30);
    const key = `${req.socket.remoteAddress || 'unknown'}:${username.toLowerCase()}`;
    const bucket = loginAttempts.get(key) ?? { count: 0, until: 0 };
    if (bucket.until <= Date.now()) { bucket.count = 0; bucket.until = 0; }
    if (!loginAttempts.has(key) && loginAttempts.size >= 10_000) {
      for (const [attemptKey, attempt] of loginAttempts) if (attempt.until <= Date.now()) loginAttempts.delete(attemptKey);
      if (loginAttempts.size >= 10_000) loginAttempts.delete(loginAttempts.keys().next().value);
    }
    if (bucket.count >= 8 && bucket.until > Date.now()) throw fail(429, 'rate_limited', 'Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring.');
    const account = db.prepare('SELECT * FROM accounts WHERE username = ? COLLATE NOCASE').get(username);
    const passwordValid = await verifyPassword(password, loginPasswordHash(account));
    if (!account || !account.active || !passwordValid) {
      bucket.count += 1;
      bucket.until = Date.now() + 15 * 60 * 1000;
      loginAttempts.set(key, bucket);
      throw fail(401, 'invalid_credentials', 'Login yoki parol noto‘g‘ri.');
    }
    loginAttempts.delete(key);
    const upgradedHash = account.password_hash.startsWith('pbkdf2$') ? await hashPassword(password) : null;
    assertAccountUnchanged(account, account.password_hash);
    if (upgradedHash) db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(upgradedHash, account.id);
    db.prepare('UPDATE accounts SET last_login_at = ? WHERE id = ?').run(nowIso(), account.id);
    const token = randomBytes(32).toString('base64url');
    const ttlMs = sessionTtlMs();
    const oldToken = parseCookies(req.headers.cookie)[COOKIE];
    if (oldToken) db.prepare('DELETE FROM sessions WHERE token_hash = ? AND account_id = ?').run(digest(oldToken), account.id);
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    db.prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE account_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 9)').run(account.id, account.id);
    db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(digest(token), account.id, Date.now() + ttlMs, nowIso());
    writeAudit(account, 'auth', 'login', 'Tizimga kirildi');
    const role = roleFor(account);
    return json(res, 200, { user: { id: account.id, username: account.username, roleId: role.id, roleName: role.name, teacherId: accountProfile(account)?.teacherId || '', teacherType: accountProfile(account)?.teacherType || 'main', permissions: role.permissions ?? [] } }, { 'Set-Cookie': setSessionCookie(token, ttlMs / 1000) });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    // Require JSON here too: unlike other writes, logout has no readBody call.
    // HTML forms can submit credentialed requests when SameSite=None is used.
    if (!(req.headers['content-type'] || '').split(';')[0].trim().match(/^application\/json$/i)) {
      throw fail(415, 'unsupported_media_type', 'Content-Type must be application/json.');
    }
    if (req.headers['x-educontrol-account'] !== undefined) assertRequestedAccount(req, requireAuth(req));
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const account = accountFrom(req);
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));
      if (account) writeAudit(account, 'auth', 'logout', 'Tizimdan chiqildi');
    }
    return json(res, 200, { ok: true }, { 'Set-Cookie': setSessionCookie('', 0) });
  }

  const sessionCheck = req.method === 'GET' && url.pathname === '/api/auth/session';
  const account = sessionCheck ? accountFrom(req) : requireAuth(req);
  if (sessionCheck && (!account || !account.active)) {
    return json(res, 200, { user: null }, { 'Set-Cookie': setSessionCookie('', 0) });
  }
  assertRequestedAccount(req, account);
  const sessionToken = parseCookies(req.headers.cookie)[COOKIE];
  const permissionSnapshot = JSON.stringify(roleFor(account).permissions);
  req.assertAuthorized = () => {
    const fresh = requireAuth(req);
    if (fresh.id !== account.id || fresh.role_id !== account.role_id || JSON.stringify(roleFor(fresh).permissions) !== permissionSnapshot) {
      throw fail(403, 'forbidden', 'Permissions changed. Retry the request.');
    }
  };
  res.setHeader('Set-Cookie', setSessionCookie(sessionToken, sessionTtlMs() / 1000));
  if (req.method === 'GET' && url.pathname === '/api/payroll') {
    if (!can(account, 'salaries', 'view')) throw fail(403, 'forbidden', 'Ish haqini ko‘rish huquqi yo‘q.');
    const read = (key) => readStoredData(key).value ?? [];
    const month = url.searchParams.get('month') || nowIso().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail(400, 'invalid_month', 'Oy YYYY-MM formatida bo‘lishi kerak.');
    const employees = buildPayroll({ month, payments: read('edu-payments-v1'), teachers: read('edu-teachers-v1'), supportTeachers: read('edu-support-teachers-v1'), users: read('edu-users-v1'), students: read('edu-students-v1'), groups: read('edu-groups-v1'), roles: read('edu-roles-v1') });
    return json(res, 200, { employees: canSeeAllSalaries(account) ? employees : employees.filter((person) => ownsSalary(account, person.employeeType, person.recordId)) });
  }
  if (req.method === 'GET' && url.pathname === '/api/chat/ice-config') {
    if (!can(account, 'chat', 'view')) throw fail(403, 'forbidden', 'Chat view permission required.');
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    const turnUrls = (process.env.TURN_URLS || '').split(',').map((value) => value.trim()).filter(Boolean);
    const sharedSecret = process.env.TURN_SHARED_SECRET;
    if (turnUrls.length && sharedSecret) {
      const username = `${Math.floor(Date.now() / 1000) + 600}:${account.id}`;
      const credential = createHmac('sha1', sharedSecret).update(username).digest('base64');
      iceServers.push({ urls: turnUrls, username, credential });
    }
    return json(res, 200, { iceServers });
  }

  if (req.method === 'POST' && url.pathname === '/api/chat/pin') {
    if (!can(account, 'chat', 'edit')) throw fail(403, 'forbidden', 'Chat edit permission required.');
    const body = await readBody(req);
    if (typeof body.messageId !== 'string' || typeof body.pinned !== 'boolean') throw fail(400, 'invalid_pin', 'Invalid pin request.');
    const stored = readStoredData('edu-chat-v1');
    const messages = stored.value || [];
    const visible = scopedState(account, 'edu-chat-v1', messages);
    if (!visible.some((m) => m.id === body.messageId)) throw fail(404, 'not_found', 'Message not found.');
    const updated = messages.map((m) => m.id === body.messageId ? { ...m, pinned: body.pinned, pinRevision: (m.pinRevision || 0) + 1 } : m);
    writeStoredData('edu-chat-v1', updated, stored.version + 1, account.id);
    return json(res, 200, { message: scopedState(account, 'edu-chat-v1', updated).find((m) => m.id === body.messageId) });
  }
  if (req.method === 'GET' && url.pathname === '/api/chat/sync') {
    if (!can(account, 'chat', 'view')) throw fail(403, 'forbidden', 'Chat view permission required.');
    const { value: savedMessages } = readStoredData('edu-chat-v1');
    const { value: savedUsers } = readStoredData('edu-users-v1');
    const { value: savedTeachers } = readStoredData('edu-teachers-v1');
    const { value: savedSupportTeachers } = readStoredData('edu-support-teachers-v1');
    const visibleMessages = scopedState(account, 'edu-chat-v1', Array.isArray(savedMessages) ? savedMessages : []);
    const profile = accountProfile(account);
    const teachers = [
      ...(Array.isArray(savedTeachers) ? savedTeachers : []).map((item) => ({ ...item, teacherType: 'main' })),
      ...(Array.isArray(savedSupportTeachers) ? savedSupportTeachers : []).map((item) => ({ ...item, teacherType: 'support' })),
    ].filter((teacher) => teacher.status !== 'left');
    const actorTeacher = chatTeacherProfile(account);
    const actorRole = roleFor(account);
    const peers = new Map();
    const ownerIds = new Set(db.prepare("SELECT id FROM accounts WHERE role_id = 'owner'").all().map((row) => row.id));
    for (const user of Array.isArray(savedUsers) ? savedUsers : []) {
      if (user.status !== 'active' || user.roleId === 'owner' || ownerIds.has(user.id)) continue;
      const teacher = user.roleId === 'teacher'
        ? teachers.find((item) => item.id === user.teacherId && item.teacherType === (user.teacherType || 'main'))
        : null;
      const peer = teacher
        ? { key: `${teacher.teacherType === 'support' ? 'support' : 'teacher'}:${teacher.id}`, name: `${teacher.firstName} ${teacher.lastName}`, role: roleFor({ role_id: user.roleId }).name, teacherId: teacher.id }
        : { key: `user:${user.id}`, name: `${user.firstName} ${user.lastName}`.trim(), role: roleFor({ role_id: user.roleId }).name, teacherId: '' };
      peers.set(peer.key, peer);
    }
    const presence = {};
    const lastSeen = new Map(db.prepare('SELECT actor, last_seen FROM chat_last_seen').all().map((item) => [item.actor, item.last_seen]));
    for (const item of db.prepare('SELECT actor, tab_id, last_seen FROM chat_presence WHERE last_seen > ?').all(Date.now() - 20_000)) {
      (presence[item.actor] ??= {})[item.tab_id] = item.last_seen;
    }
    return json(res, 200, {
      messages: visibleMessages,
      presence,
      peers: [...peers.values()].map((peer) => ({ ...peer, lastSeen: lastSeen.get(peer.key) || 0 })),
      actor: {
        key: chatActorKey(account),
        name: actorTeacher ? `${actorTeacher.firstName} ${actorTeacher.lastName}` : profile ? `${profile.firstName} ${profile.lastName}`.trim() : account.username,
        role: actorRole.name,
        permissions: actorRole.permissions,
        teacherId: actorTeacher?.id || '',
      },
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/chat/presence') {
    if (!can(account, 'chat', 'view')) throw fail(403, 'forbidden', 'Chat view permission required.');
    const body = await readBody(req);
    if (typeof body.tabId !== 'string' || !/^TAB-[a-zA-Z0-9_-]{4,40}$/.test(body.tabId) || (body.remove !== undefined && typeof body.remove !== 'boolean')) throw fail(400, 'invalid_presence', 'Chat presence update is invalid.');
    const actor = chatActorKey(account);
    const timestamp = Date.now();
    db.prepare('INSERT INTO chat_last_seen (actor, last_seen) VALUES (?, ?) ON CONFLICT(actor) DO UPDATE SET last_seen = excluded.last_seen').run(actor, timestamp);
    if (body.remove) db.prepare('DELETE FROM chat_presence WHERE actor = ? AND tab_id = ?').run(actor, body.tabId);
    else db.prepare('INSERT INTO chat_presence (actor, tab_id, last_seen) VALUES (?, ?, ?) ON CONFLICT(actor, tab_id) DO UPDATE SET last_seen = excluded.last_seen').run(actor, body.tabId, timestamp);
    return json(res, 200, { ok: true, actor, tabId: body.tabId, timestamp });
  }

  if (url.pathname === '/api/chat/signals' && req.method === 'GET') {
    if (!can(account, 'chat', 'view')) throw fail(403, 'forbidden', 'Chat view permission required.');
    const channel = url.searchParams.get('channel') || '';
    const actor = chatActorKey(account);
    const after = Number(url.searchParams.get('after') || 0);
    if (!(channel === '*' || /^(general|direct:[^|]{1,120}\|[^|]{1,120})$/.test(channel)) || !Number.isSafeInteger(after) || after < 0) throw fail(400, 'invalid_signal_query', 'Call signal query is invalid.');
    const now = Date.now();
    const upperBound = db.prepare('SELECT COALESCE(MAX(id), ?) AS id FROM chat_call_signals').get(after).id;
    const rows = db.prepare(`SELECT id, channel, call_id AS callId, from_actor AS "from", to_actor AS "to", type, payload, created_at AS createdAt
      FROM chat_call_signals WHERE id > ? AND id <= ? AND expires_at > ? ORDER BY id LIMIT 1000`).all(after, upperBound, now);
    const visible = rows.filter((row) => (channel === '*' || row.channel === channel)
      && (row.to === null || row.to === actor)
      && (row.channel === 'general' || row.channel.slice(7).split('|').includes(actor)));
    return json(res, 200, { signals: visible.map((row) => ({ ...row, ...JSON.parse(row.payload) })), cursor: rows.length === 1000 ? rows.at(-1).id : upperBound });
  }

  if (url.pathname === '/api/chat/signals' && req.method === 'POST') {
    if (!can(account, 'chat', 'create')) throw fail(403, 'forbidden', 'Chat create permission required.');
    const actor = chatActorKey(account);
    const signalBucket = callSignalAttempts.get(actor) ?? { count: 0, since: Date.now() };
    if (Date.now() - signalBucket.since >= 10_000) { signalBucket.count = 0; signalBucket.since = Date.now(); }
    if (signalBucket.count >= 180) throw fail(429, 'rate_limited', 'Too many call signals. Wait a moment and retry.');
    signalBucket.count += 1;
    callSignalAttempts.set(actor, signalBucket);
    const body = await readBody(req);
    const channel = typeof body.channel === 'string' ? body.channel : '';
    const callId = typeof body.callId === 'string' ? body.callId : '';
    const type = typeof body.type === 'string' ? body.type : '';
    const recipient = body.to === undefined ? null : body.to;
    const allowedTypes = new Set(['invite', 'join', 'offer', 'answer', 'candidate', 'end', 'leave', 'decline']);
    if (!/^(general|direct:[^|]{1,120}\|[^|]{1,120})$/.test(channel) || !/^CALL-[a-zA-Z0-9-]{4,100}$/.test(callId) || !allowedTypes.has(type)) throw fail(400, 'invalid_signal', 'Call signal is invalid.');
    if (channel.startsWith('direct:') && !channel.slice(7).split('|').includes(actor)) throw fail(403, 'forbidden', 'This call channel is not available to this user.');
    if (recipient !== null && (typeof recipient !== 'string' || recipient.length > 150 || recipient === actor)) throw fail(400, 'invalid_signal', 'Call recipient is invalid.');
    if (recipient && channel.startsWith('direct:') && !channel.slice(7).split('|').includes(recipient)) throw fail(403, 'forbidden', 'Call recipient is not in this direct channel.');
    const profile = accountProfile(account);
    let senderName = profile ? `${profile.firstName} ${profile.lastName}`.trim() : account.username;
    const senderTeacher = chatTeacherProfile(account);
    if (senderTeacher) senderName = `${senderTeacher.firstName} ${senderTeacher.lastName}`.trim();
    const detail = { fromName: senderName, fromRole: roleFor(account).name };
    if (type === 'offer' || type === 'answer') {
      const description = body.description;
      if (!description || typeof description !== 'object' || !['offer', 'answer'].includes(description.type) || typeof description.sdp !== 'string' || description.sdp.length > 60_000) throw fail(400, 'invalid_signal', 'WebRTC description is invalid.');
      detail.description = description;
    } else if (type === 'candidate') {
      const candidate = body.candidate;
      if (!candidate || typeof candidate !== 'object' || typeof candidate.candidate !== 'string' || candidate.candidate.length > 4_000) throw fail(400, 'invalid_signal', 'ICE candidate is invalid.');
      detail.candidate = candidate;
    }
    const now = Date.now();
    const expiresAt = now + (type === 'invite' ? 30_000 : 120_000);
    const participantExpiry = now + 12 * 60 * 60 * 1000;
    db.exec('BEGIN IMMEDIATE');
    let committed = false;
    try {
      const participant = (participantActor) => db.prepare('SELECT 1 FROM chat_call_participants WHERE call_id = ? AND channel = ? AND actor = ? AND expires_at > ?').get(callId, channel, participantActor, now);
      const caller = db.prepare('SELECT actor FROM chat_call_participants WHERE call_id = ? AND channel = ? AND is_initiator = 1 AND expires_at > ?').get(callId, channel, now)?.actor;
      if (type === 'invite') {
        if (caller || db.prepare('SELECT 1 FROM chat_call_signals WHERE call_id = ? LIMIT 1').get(callId)) throw fail(409, 'call_exists', 'This call id is already in use.');
        db.prepare('INSERT INTO chat_call_participants (call_id, channel, actor, is_initiator, expires_at) VALUES (?, ?, ?, 1, ?)').run(callId, channel, actor, participantExpiry);
      } else if (type === 'join' || type === 'decline') {
        const invite = db.prepare(`SELECT 1 FROM chat_call_signals WHERE call_id = ? AND channel = ? AND type = 'invite' AND from_actor = ? AND (to_actor IS NULL OR to_actor = ?) AND expires_at > ? LIMIT 1`).get(callId, channel, recipient, actor, now);
        if (!caller || recipient !== caller || !invite) throw fail(409, 'call_expired', 'This call invitation has expired.');
        if (type === 'join') {
          db.prepare('INSERT INTO chat_call_participants (call_id, channel, actor, is_initiator, expires_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(call_id, channel, actor) DO UPDATE SET expires_at = excluded.expires_at').run(callId, channel, actor, participantExpiry);
        }
      } else if (!participant(actor)) throw fail(403, 'forbidden', 'You are not a participant in this call.');
      if (recipient && !['invite', 'join', 'decline'].includes(type) && !participant(recipient)) throw fail(403, 'forbidden', 'The call recipient is not a participant.');
      const result = db.prepare(`INSERT INTO chat_call_signals
        (channel, call_id, from_actor, to_actor, type, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(channel, callId, actor, recipient, type, JSON.stringify(detail), now, expiresAt);
      if (type !== 'invite' && type !== 'decline') db.prepare('UPDATE chat_call_participants SET expires_at = ? WHERE call_id = ? AND channel = ? AND actor = ?').run(participantExpiry, callId, channel, actor);
      if (type === 'leave') db.prepare('DELETE FROM chat_call_participants WHERE call_id = ? AND channel = ? AND actor = ?').run(callId, channel, actor);
      if (type === 'end') db.prepare('DELETE FROM chat_call_participants WHERE call_id = ? AND channel = ?').run(callId, channel);
      db.exec('COMMIT');
      committed = true;
      return json(res, 201, { id: Number(result.lastInsertRowid), ok: true });
    } finally { if (!committed) db.exec('ROLLBACK'); }
  }

  if (req.method === 'GET' && (url.pathname === '/api/auth/me' || sessionCheck)) {
    const role = roleFor(account);
    return json(res, 200, { user: { id: account.id, username: account.username, roleId: role.id, roleName: role.name, teacherId: accountProfile(account)?.teacherId || '', teacherType: accountProfile(account)?.teacherType || 'main', permissions: role.permissions ?? [] } });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/change-password') {
    limitAuthAttempts(`password:${account.id}`, 8);
    const body = await readBody(req);
    if (typeof body.newPassword !== 'string' || [...body.newPassword].length < passwordMinimumLength() || body.newPassword.length > 256) throw fail(400, 'weak_password', `Yangi parol kamida ${passwordMinimumLength()} ta belgidan iborat bo‘lsin.`);
    const current = db.prepare('SELECT password_hash FROM accounts WHERE id = ?').get(account.id);
    if (typeof body.currentPassword !== 'string' || !current || !(await verifyPassword(body.currentPassword, current.password_hash))) throw fail(400, 'invalid_password', 'Joriy parol noto‘g‘ri.');
    const passwordHash = await hashPassword(body.newPassword);
    requireAuth(req);
    assertAccountUnchanged(account, current.password_hash);
    db.exec('BEGIN IMMEDIATE');
    let committed = false;
    try {
      const userState = db.prepare("SELECT value, version FROM app_state WHERE key = 'edu-users-v1'").get();
      db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(passwordHash, account.id);
      if (userState) {
        let users;
        try { users = JSON.parse(userState.value); } catch { throw fail(409, 'invalid_state', 'Stored user profiles are invalid.'); }
        if (Array.isArray(users)) {
          const profileIndex = users.findIndex((user) => user.id === account.id);
          if (profileIndex >= 0) {
            users[profileIndex] = { ...users[profileIndex], passwordHash };
            writeStoredData('edu-users-v1', users, userState.version + 1, account.id);
          }
        }
      }
      const newToken = randomBytes(32).toString('base64url');
      const ttlMs = sessionTtlMs();
      db.prepare('DELETE FROM sessions WHERE account_id = ?').run(account.id);
      db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(digest(newToken), account.id, Date.now() + ttlMs, nowIso());
      writeAudit(account, 'auth', 'password', 'Parol yangilandi');
      db.exec('COMMIT');
      committed = true;
      return json(res, 200, { ok: true }, { 'Set-Cookie': setSessionCookie(newToken, ttlMs / 1000) });
    } finally { if (!committed) db.exec('ROLLBACK'); }
  }

  if (handleReportRequest(req, res, url, account)) return;
  const recordResponse = await handleRecordRequest(req, res, url, account);
  if (recordResponse !== null) return recordResponse;

  if (req.method === 'GET' && url.pathname === '/api/state') {
    if (['owner', 'admin'].includes(account.role_id)) syncLessonAlerts();
    const state = {};
    const versions = {};
    const writable = [];
    for (const [key, module] of collections) {
      if (key === 'edu-chat-presence-v1' || (key === 'edu-groups-v1' && can(account, 'schedule', 'edit')) || can(account, module, 'edit') || can(account, module, 'create') || can(account, module, 'delete')) writable.push(key);
      const scopedTeacherKey = account.role_id === 'teacher' && ['edu-students-v1', 'edu-teachers-v1', 'edu-support-teachers-v1', 'edu-users-v1', 'edu-groups-v1', 'edu-payments-v1', 'edu-salary-v1'].includes(key);
      if (key !== 'edu-settings-v1' && !scopedTeacherKey && !can(account, module, 'view')) continue;
      const row = db.prepare('SELECT value, version FROM app_state WHERE key = ?').get(key);
      if (!row) continue;
      const { value } = readStoredData(key);
      const visible = scopedState(account, key, value);
      if (key === 'edu-users-v1' && Array.isArray(visible)) {
        const loginTimes = new Map(db.prepare('SELECT id, last_login_at FROM accounts').all().map((item) => [item.id, item.last_login_at || '']));
        state[key] = visible.map(({ passwordHash: _passwordHash, ...user }) => ({ ...user, lastLoginAt: loginTimes.get(user.id) || user.lastLoginAt || '' }));
      } else state[key] = visible;
      versions[key] = row.version;
    }
    return json(res, 200, { state, versions, writable, empty: db.prepare('SELECT COUNT(*) AS count FROM app_state').get().count === 0 });
  }

  if (req.method === 'PUT' && url.pathname === '/api/state') {
    const body = await readBody(req);
    const key = String(body.key ?? '');
    const module = collections.get(key);
    if (!module) throw fail(400, 'unknown_collection', 'Ma’lumotlar bo‘limi noma’lum.');
    const scheduleWrite = key === 'edu-groups-v1' && can(account, 'schedule', 'edit');
    const canEdit = can(account, module, 'edit') || scheduleWrite;
    const canCreate = can(account, module, 'create');
    const canDelete = can(account, module, 'delete');
    const ownPresenceWrite = key === 'edu-chat-presence-v1' && can(account, 'chat', 'view');
    if (!canEdit && !canCreate && !canDelete && !ownPresenceWrite) throw fail(403, 'forbidden', 'Permission denied.');
    if (body.value === undefined || body.value === null || typeof body.value !== 'object') throw fail(400, 'invalid_state', 'State must be a JSON object or array.');
    validateCollection(key, body.value);
    if (key === 'edu-users-v1' && Array.isArray(body.value)) {
      const emails = new Set();
      for (const user of body.value) {
        if (user.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(user.email)) throw fail(400, 'invalid_email', 'Email address is invalid.');
        if (user.phone && !/^\d{12}$/.test(user.phone)) throw fail(400, 'invalid_phone', 'Phone must contain 12 digits.');
        const email = String(user.email ?? '').trim().toLowerCase();
        if (email && emails.has(email)) throw fail(409, 'duplicate_email', 'Email address is already in use.');
        if (email) emails.add(email);
      }
      const rolesRow = db.prepare("SELECT value FROM app_state WHERE key = 'edu-roles-v1'").get();
      if (rolesRow) {
        let roleIds;
        try { roleIds = new Set(JSON.parse(rolesRow.value).map((role) => role.id)); }
        catch { throw fail(409, 'invalid_state', 'Stored roles list is invalid.'); }
        if (body.value.some((user) => user.roleId && !roleIds.has(user.roleId))) throw fail(400, 'unknown_role', 'A user references a role that does not exist.');
      }
    }
    readStoredData(key);
    db.exec('BEGIN IMMEDIATE');
    let committed = false;
    try {
        const currentState = db.prepare('SELECT value, version FROM app_state WHERE key = ?').get(key);
        const expectedVersion = body.version ?? null;
        if ((currentState?.version ?? null) !== expectedVersion) throw fail(409, 'version_conflict', 'State changed. Reload and try again.');
        let value = body.value;
        if (account.role_id !== 'owner' && key === 'edu-users-v1') {
          const ownerAccounts = db.prepare("SELECT id FROM accounts WHERE role_id = 'owner'").all();
          const previousUsers = readStoredData(key).value ?? [];
          for (const owner of ownerAccounts) {
            const before = previousUsers.find((user) => user.id === owner.id);
            const after = value.find((user) => user.id === owner.id);
            const publicProfile = (user) => user && Object.fromEntries(Object.entries(user).filter(([field]) => field !== 'passwordHash'));
            if (after?.passwordHash || JSON.stringify(publicProfile(before)) !== JSON.stringify(publicProfile(after))) throw fail(403, 'owner_account_locked', 'Only the owner can change the owner account.');
          }
        }
        if (account.role_id !== 'owner' && key === 'edu-roles-v1') {
          const previousRoles = readStoredData(key).value ?? [];
          const granted = new Set(roleFor(account).permissions);
          if (value.some((role) => !previousRoles.some((previous) => previous.id === role.id))) {
            throw fail(403, 'role_creation_owner_only', 'Yangi rolni faqat Super admin yarata oladi.');
          }
          for (const role of value) {
            const previous = previousRoles.find((item) => item.id === role.id);
            if (previous && role.id !== 'owner' && JSON.stringify(previous) !== JSON.stringify(role)) assertCanManageRole({ ...account, permissions: [...granted] }, previous.id, previous.permissions ?? []);
            if (JSON.stringify(previous) !== JSON.stringify(role) && role.id !== 'owner' && (role.permissions ?? []).some((permission) => !granted.has(permission))) throw fail(403, 'permission_escalation', 'Cannot grant permissions you do not have.');
          }
          for (const previous of previousRoles) if (!value.some((role) => role.id === previous.id)) assertCanManageRole({ ...account, permissions: [...granted] }, previous.id, previous.permissions ?? []);
        }
        value = preservePrivateSalary(account, key, value, readStoredData(key).value);

        if (account.role_id === 'teacher' || scheduleWrite || key === 'edu-chat-presence-v1' || key === 'edu-chat-v1' || key === 'edu-notifications-v1' || key === 'edu-activity-v1') {
          const currentValue = readStoredData(key).value ?? (['edu-attendance-v1', 'edu-chat-presence-v1'].includes(key) ? {} : []);
          value = mergeTeacherWrite(account, key, value, currentValue);
        }
        if (key === 'edu-attendance-v1') assertAttendanceSchedule(value, readStoredData(key).value || {}, readStoredData('edu-groups-v1').value || []);
        if (!canEdit && key !== 'edu-chat-presence-v1') {
          let previous = [];
          try { previous = currentState ? JSON.parse(currentState.value) : []; } catch { throw fail(409, 'invalid_state', 'Stored state is invalid.'); }
          if (!Array.isArray(previous) || !Array.isArray(value)) throw fail(403, 'forbidden', 'This collection cannot be fully edited with your permission.');
          const keyOf = (item) => item && (item.id ?? item.code);
          if ([...previous, ...value].some((item) => keyOf(item) === undefined || keyOf(item) === null)) throw fail(400, 'invalid_state', 'Every record must have an id or code.');
          const previousById = new Map(previous.map((item) => [String(keyOf(item)), item]));
          const nextById = new Map(value.map((item) => [String(keyOf(item)), item]));
          const comparable = (item) => {
            if (key !== 'edu-users-v1' || !item || typeof item !== 'object') return item;
            const { passwordHash: _passwordHash, ...profile } = item;
            return profile;
          };
          if (nextById.size !== value.length) throw fail(400, 'invalid_state', 'Record ids and codes must be unique.');
          for (const [id, item] of nextById) {
            if (!previousById.has(id) && !canCreate) throw fail(403, 'forbidden', 'Create permission required.');
            if (key === 'edu-users-v1' && previousById.has(id) && item.passwordHash && item.passwordHash !== previousById.get(id).passwordHash && !canEdit) throw fail(403, 'forbidden', 'Password changes require edit permission.');
            if (previousById.has(id) && JSON.stringify(comparable(previousById.get(id))) !== JSON.stringify(comparable(item)) && !canEdit) throw fail(403, 'forbidden', 'Edit permission required.');
          }
          for (const id of previousById.keys()) if (!nextById.has(id) && !canDelete) throw fail(403, 'forbidden', 'Delete permission required.');
        }
        const encoded = JSON.stringify(value);
        if (encoded === undefined || Buffer.byteLength(encoded) > BODY_LIMIT) throw fail(413, 'payload_too_large', 'Saqlanadigan ma’lumot hajmi ruxsat etilgan chegaradan oshdi.');
        const changes = {};
        if (key === 'edu-users-v1' && Array.isArray(value)) {
          const previousProfiles = readStoredData(key).value ?? [];
          for (const user of value) {
            const previousProfile = previousProfiles.find((item) => item.id === user.id);
            const { passwordHash: _oldHash, ...oldPublic } = previousProfile ?? {};
            const { passwordHash: _newHash, ...newPublic } = user;
            if (!previousProfile || JSON.stringify(oldPublic) !== JSON.stringify(newPublic) || user.passwordHash) {
              const existingRole = db.prepare('SELECT role_id FROM accounts WHERE id = ?').get(user.id)?.role_id;
              if (existingRole) assertAccountRole(account, existingRole);
              assertAccountRole(account, user.roleId || 'admin');
            }
          }
          for (const previousProfile of previousProfiles) if (!value.some((user) => user.id === previousProfile.id)) assertAccountRole(account, previousProfile.roleId);
          value = applyAccountFields(value, readStoredData(key).value ?? [], account, changes);
          validateTeacherAccounts(value, readStoredData(key).value ?? []);
          const previous = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key);
          let hashes = new Map();
          try { hashes = new Map((previous ? JSON.parse(previous.value) : []).map((user) => [user.id, user.passwordHash]).filter(([, hash]) => hash)); } catch { /* import old data */ }
          value = value.map((user) => ({ ...user, ...(user.passwordHash ? { passwordHash: user.passwordHash } : hashes.has(user.id) ? { passwordHash: hashes.get(user.id) } : {}) }));
          const owners = db.prepare("SELECT id, username, password_hash, created_at FROM accounts WHERE role_id = 'owner' AND active = 1").all();
          for (const owner of owners) {
            if (!value.some((user) => user.id === owner.id)) value.unshift({ id: owner.id, firstName: owner.username, lastName: 'Administrator', email: '', phone: '', login: owner.username, roleId: 'owner', status: 'active', passwordHash: owner.password_hash, createdAt: owner.created_at, note: 'Tizim egasi' });
          }
          for (const user of value) {
            if (!user.login) continue;
            const existing = db.prepare('SELECT id FROM accounts WHERE id = ? OR username = ? COLLATE NOCASE').get(user.id, user.login);
            if (existing && existing.id !== user.id) throw fail(409, 'duplicate_login', `Login band: ${user.login}`);
            const existingAccount = db.prepare('SELECT id, role_id, active, password_hash FROM accounts WHERE id = ?').get(user.id);
            const passwordHash = user.passwordHash || existingAccount?.password_hash;
            if (!passwordHash) continue;
            if (!(passwordHash.startsWith('scrypt$') && /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/i.test(passwordHash))
              && !(passwordHash.startsWith('pbkdf2$') && /^pbkdf2\$\d{6}\$[0-9a-f]{32}\$[0-9a-f]{64}$/i.test(passwordHash))) {
              throw fail(400, 'invalid_password_hash', 'Parol ma’lumoti xavfsiz formatda emas.');
            }
            const isOwner = existingAccount?.role_id === 'owner';
            if (user.roleId === 'owner' && !isOwner) throw fail(403, 'owner_assignment_denied', 'Super admin rolini yangi hisobga bera olmaysiz.');
            const roleId = isOwner ? 'owner' : user.roleId || 'admin';
          const isActive = isOwner || user.status === 'active';
            db.prepare(`INSERT INTO accounts (id, username, password_hash, role_id, active, created_at)
              VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET username=excluded.username, password_hash=excluded.password_hash, role_id=excluded.role_id, active=excluded.active`)
              .run(user.id, user.login, passwordHash, roleId, isActive ? 1 : 0, user.createdAt || nowIso());
          if (existingAccount && (existingAccount.role_id !== roleId || existingAccount.active !== Number(isActive) || existingAccount.password_hash !== passwordHash)) db.prepare('DELETE FROM sessions WHERE account_id = ?').run(user.id);
          }
          const retainedIds = value.map((user) => user.id);
          if (retainedIds.length) db.prepare(`UPDATE accounts SET active = 0 WHERE role_id != 'owner' AND id NOT IN (${retainedIds.map(() => '?').join(',')})`).run(...retainedIds);
          else db.prepare("UPDATE accounts SET active = 0 WHERE role_id != 'owner'").run();
          db.prepare('DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE active = 0)').run();
        }
        if (key === 'edu-roles-v1' && Array.isArray(value)) {
          value = value.map((role) => ({ ...role, permissions: role.id === 'owner' ? allPermissions : Array.isArray(role.permissions) ? [...new Set(role.permissions.filter((item) => validPermissions.has(item)))] : [] }));
          if (!value.some((role) => role.id === 'owner')) throw fail(400, 'owner_role_required', 'Super admin roli saqlanishi shart.');
          if (!value.find((role) => role.id === 'owner')?.permissions?.length) throw fail(400, 'owner_role_locked', 'Super admin huquqlarini kamaytirib bo‘lmaydi.');
          const existing = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key);
          if (existing) {
            const previous = JSON.parse(existing.value);
            const retained = new Set(value.map((role) => role.id));
            const protectedIds = new Set(previous.filter((role) => role.system).map((role) => role.id));
            const usersRow = db.prepare("SELECT value FROM app_state WHERE key = 'edu-users-v1'").get();
            let assignedRoles = new Set();
            try { assignedRoles = new Set((usersRow ? JSON.parse(usersRow.value) : []).map((user) => user.roleId)); } catch { /* malformed legacy data */ }
            for (const role of previous) {
              if (!retained.has(role.id) && (protectedIds.has(role.id) || assignedRoles.has(role.id) || db.prepare('SELECT 1 FROM accounts WHERE role_id = ? LIMIT 1').get(role.id))) {
                throw fail(409, 'role_in_use', `Foydalanuvchi ishlatayotgan yoki tizimga tegishli rolni o‘chirib bo‘lmaydi: ${role.name}`);
              }
            }
          }
        }
        const nextVersion = (currentState?.version ?? 0) + 1;
      writeStoredData(key, value, nextVersion, account.id);
        writeAudit(account, module, 'update', `${module} ma’lumotlari yangilandi`, key);
        db.exec('COMMIT');
        committed = true;
        const safeChanges = Object.fromEntries(Object.entries(changes).map(([changeKey, change]) => [changeKey, { ...change, value: scopedState(account, changeKey, change.value) }]));
        return json(res, 200, { ok: true, key, version: nextVersion, ...(['edu-notifications-v1', 'edu-activity-v1', 'edu-roles-v1', 'edu-teachers-v1', 'edu-support-teachers-v1', 'edu-salary-v1'].includes(key) ? { value: scopedState(account, key, value) } : {}), ...(key === 'edu-users-v1' ? { value: scopedState(account, key, value).map(({ passwordHash: _passwordHash, ...profile }) => profile), changes: safeChanges } : {}) });
    } finally {
      if (!committed) db.exec('ROLLBACK');
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/audit') {
    if (!can(account, 'activity', 'view')) throw fail(403, 'forbidden', 'Faoliyat tarixini ko‘rish huquqi yo‘q.');
    const requestedLimit = Number(url.searchParams.get('limit') || 100);
    const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.trunc(requestedLimit))) : 100;
    const admin = ['owner', 'admin'].includes(account.role_id);
    const query = `SELECT id, at, actor_id AS actorId, module, action, title, detail FROM audit_events ${admin ? '' : 'WHERE actor_id = ?'} ORDER BY at DESC LIMIT ?`;
    return json(res, 200, { items: db.prepare(query).all(...(admin ? [limit] : [account.id, limit])) });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/accounts') {
    if (!can(account, 'users-roles', 'create')) throw fail(403, 'forbidden', 'Foydalanuvchi qo‘shish huquqi yo‘q.');
    const body = await readBody(req);
    for (const field of ['username', 'password', 'roleId', 'firstName', 'lastName']) {
      if (typeof body[field] !== 'string') throw fail(400, 'invalid_account', `${field} must be text.`);
    }
    for (const field of ['status', 'email', 'phone', 'teacherId', 'teacherType', 'note', 'roleName']) {
      if (body[field] !== undefined && typeof body[field] !== 'string') throw fail(400, 'invalid_account', `${field} must be text.`);
    }
    const username = body.username.trim();
    const password = body.password;
    let roleId = body.roleId.trim();
    validateMonthlySalary(body.monthlySalary);
    const status = body.status ?? 'active';
    const firstName = body.firstName.trim();
    const lastName = body.lastName.trim();
    const email = (body.email ?? '').trim().toLowerCase();
    const phone = (body.phone ?? '').trim();
    if (account.role_id !== 'owner' && !roleId && body.roleName?.trim()) throw fail(403, 'role_creation_owner_only', 'Yangi rolni faqat Super admin yarata oladi.');
    if (!['active', 'blocked'].includes(status)) throw fail(400, 'invalid_account', 'User status is invalid.');
    if (firstName.length < 2 || firstName.length > 100 || lastName.length < 2 || lastName.length > 100) throw fail(400, 'invalid_account', 'First and last name must contain 2 to 100 characters.');
    if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) throw fail(400, 'invalid_email', 'Email address is invalid.');
    if (phone && !/^\d{12}$/.test(phone)) throw fail(400, 'invalid_phone', 'Phone must contain 12 digits.');
    if (!/^[a-zA-Z0-9._-]{3,80}$/.test(username) || [...password].length < passwordMinimumLength() || password.length > 256 || (!roleId && !body.roleName) || roleId === 'owner') throw fail(400, 'invalid_account', `Login, parol (kamida ${passwordMinimumLength()} belgi) yoki rol noto‘g‘ri.`);
    const rolesRow = db.prepare("SELECT value FROM app_state WHERE key = 'edu-roles-v1'").get();
    const roles = rolesRow ? JSON.parse(rolesRow.value) : [];
    if (roleId && !roles.some((role) => role.id === roleId)) throw fail(400, 'unknown_role', 'Tanlangan rol mavjud emas.');
    const id = randomUUID();
    const createdAt = nowIso();
    const passwordHash = await hashPassword(password);
    req.assertAuthorized();
    const freshAccount = requireAuth(req);
    if (freshAccount.role_id !== account.role_id || !can(freshAccount, 'users-roles', 'create')) throw fail(403, 'forbidden', 'Account creation permission changed.');
    readStoredData('edu-users-v1');
    db.exec('BEGIN IMMEDIATE');
    let committed = false;
    try {
      if (db.prepare('SELECT 1 FROM accounts WHERE username = ? COLLATE NOCASE').get(username)) throw fail(409, 'duplicate_login', 'Login already exists.');
      const changes = {};
      roleId = resolveAccountRole(roleId, body.roleName, account, changes);
      if (roleId === 'owner') throw fail(403, 'owner_assignment_denied', 'Super admin rolini yangi hisobga bera olmaysiz.');
      const teacherId = (body.teacherId ?? '').trim().slice(0, 100);
      const teacherType = roleId === 'teacher' ? (body.teacherType || 'main') : '';
      db.prepare('INSERT INTO accounts (id, username, password_hash, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, username, passwordHash, roleId, status === 'active' ? 1 : 0, createdAt);
      const usersRow = db.prepare("SELECT version FROM app_state WHERE key = 'edu-users-v1'").get();
      let users = readStoredData('edu-users-v1').value;
      if (!Array.isArray(users)) throw fail(409, 'invalid_state', 'Stored users list is invalid.');
      const owners = db.prepare("SELECT id, username, created_at FROM accounts WHERE role_id = 'owner'").all();
      for (const owner of owners) {
        if (!users.some((user) => user.id === owner.id)) users.unshift({ id: owner.id, firstName: owner.username, lastName: 'Administrator', email: '', phone: '', login: owner.username, roleId: 'owner', status: 'active', createdAt: String(owner.created_at).slice(0, 10), lastLoginAt: '', note: 'System owner' });
      }
      if (email && users.some((user) => String(user.email ?? '').toLowerCase() === email)) throw fail(409, 'duplicate_email', 'Email address is already in use.');
      const [profile] = applyAccountFields([{ id, firstName, lastName, email, phone, login: username, roleId, teacherId: roleId === 'teacher' ? teacherId : '', teacherType, status, createdAt: createdAt.slice(0, 10), lastLoginAt: '', note: (body.note ?? '').slice(0, 1000), ...(body.monthlySalary !== undefined ? { monthlySalary: body.monthlySalary } : {}) }], [], account, changes);
      validateTeacherAccounts([profile, ...users], users);
      users.unshift(profile);
      const version = (usersRow?.version ?? 0) + 1;
      writeStoredData('edu-users-v1', users, version, account.id);
      writeAudit(account, 'users-roles', 'create', `Hisob yaratildi: ${username}`, roleId);
      db.exec('COMMIT');
      committed = true;
      const safeChanges = Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, { ...change, value: scopedState(account, key, change.value) }]));
      return json(res, 201, { user: redactSalary(account, 'edu-users-v1', [profile])[0], version, changes: safeChanges });
    } finally { if (!committed) db.exec('ROLLBACK'); }
  }

  return json(res, 404, { error: 'not_found', message: 'API manzili topilmadi.' });
}

const loginAttempts = new Map();
const authAttempts = new Map();
function limitAuthAttempts(key, limit) {
  const now = Date.now();
  for (const [id, bucket] of authAttempts) if (bucket.until <= now) authAttempts.delete(id);
  const bucket = authAttempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  if (bucket.count >= limit || (!authAttempts.has(key) && authAttempts.size >= 10_000)) throw fail(429, 'rate_limited', 'Too many authentication attempts. Try again later.');
  bucket.count += 1;
  authAttempts.set(key, bucket);
}
const callSignalAttempts = new Map();
const cleanup = setInterval(() => {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM chat_call_signals WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM chat_call_participants WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM chat_presence WHERE last_seen <= ?').run(now - 20_000);
  for (const [key, bucket] of loginAttempts) if (bucket.until < Date.now()) loginAttempts.delete(key);
  for (const [key, bucket] of callSignalAttempts) if (now - bucket.since >= 10_000) callSignalAttempts.delete(key);
}, 10 * 60 * 1000);
cleanup.unref();
