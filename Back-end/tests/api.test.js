import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('API: authentication, CRUD, conflicts, reports, roles and teacher isolation', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'educontrol-test-'));
  const child = spawn(process.execPath, ['Back-end/index.js'], {
    env: { ...process.env, API_PORT: '0', API_HOST: '127.0.0.1', SQLITE_FILE: join(dir, 'test.sqlite'), BOOTSTRAP_ADMIN_USERNAME: 'testadmin', BOOTSTRAP_ADMIN_PASSWORD: 'Test-password-123' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
    await rm(dir, { recursive: true, force: true });
  });
  let output = '';
  child.stderr.on('data', (chunk) => { output += chunk; });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 15000);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/listening on (http:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  async function request(path, { method = 'GET', body, cookie, origin, expectedAccountId } = {}) {
    const response = await fetch(`${base}/api${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}), ...(expectedAccountId ? { 'X-Educontrol-Account': expectedAccountId } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  assert.equal((await request('/health')).status, 200);
  const headers = (await fetch(`${base}/api/health`)).headers;
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.match(headers.get('content-security-policy'), /default-src 'none'/);
  for (const [extraHeaders, expected] of [
    [{ 'Content-Type': 'text/plain' }, 415],
    [{ 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, 403],
    [{ 'Content-Type': 'application/json', Origin: 'null' }, 403],
  ]) {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: extraHeaders, body: JSON.stringify({ username: 'testadmin', password: 'Test-password-123' }) });
    assert.equal(response.status, expected);
  }
  assert.equal((await fetch(`${base}/api/health`, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' } })).status, 403);
  assert.equal((await request('/state')).status, 401);
  assert.deepEqual((await request('/auth/session')).data, { user: null });
  const invalidSession = await request('/auth/session', { cookie: 'educontrol_session=invalid' });
  assert.equal(invalidSession.status, 200);
  assert.deepEqual(invalidSession.data, { user: null });
  assert.equal((await request('/auth/me')).status, 401);
  assert.equal((await request('/auth/login', { method: 'POST', body: { username: 'testadmin', password: 'wrong' } })).status, 401);
  const login = await request('/auth/login', { method: 'POST', body: { username: 'testadmin', password: 'Test-password-123' } });
  assert.equal(login.status, 200);
  const cookie = login.cookie;
  assert.ok(cookie);
  const session = await request('/auth/session', { cookie });
  assert.equal(session.status, 200);
  assert.deepEqual(session.data.user, login.data.user);
  const preflight = await fetch(`${base}/api/state`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Headers': 'x-educontrol-account,content-type' } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /X-Educontrol-Account/i);
  assert.equal((await request('/state', { cookie, expectedAccountId: login.data.user.id })).status, 200);
  for (const options of [
    {},
    { method: 'PUT', body: { key: 'edu-students-v1', value: [{ id: 'wrong-account-write' }], version: null } },
  ]) {
    const mismatch = await request('/state', { ...options, cookie, expectedAccountId: 'previous-account' });
    assert.equal(mismatch.status, 401);
    assert.equal(mismatch.data.error, 'account_changed');
  }
  assert.equal((await request('/auth/logout', { method: 'POST', body: {}, cookie, expectedAccountId: 'previous-account' })).status, 401);
  assert.equal((await request('/auth/me', { cookie })).status, 200);
  assert.equal((await request('/state', { cookie, origin: 'https://untrusted.example' })).status, 403);
  const create = (key, record) => request(`/records/${key}`, { method: 'POST', cookie, body: { record } });
  const student = { id: 'S1', firstName: 'Ali', lastName: 'Valiyev', group: 'G1', status: 'active', debt: 50000 };
  const created = await create('edu-students-v1', student);
  assert.equal(created.status, 201);
  assert.equal((await create('edu-students-v1', student)).status, 409);
  assert.deepEqual((await request('/records/edu-students-v1/S1', { cookie })).data.record, student);
  const page = await request('/records/edu-students-v1?q=ali%20valiyev&status=active&page=1&limit=1', { cookie });
  assert.equal(page.status, 200);
  assert.deepEqual(page.data.records, [student]);
  assert.deepEqual(page.data.pagination, { page: 1, limit: 1, total: 1, totalPages: 1 });
  assert.equal(page.data.version, created.data.version);
  assert.deepEqual((await request('/records/edu-students-v1?page=2&limit=1', { cookie })).data.records, []);
  assert.deepEqual((await request('/records/edu-students-v1?status=frozen', { cookie })).data.records, []);
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'limit=201', 'limit=', 'page=9007199254740992']) {
    assert.equal((await request(`/records/edu-students-v1?${query}`, { cookie })).status, 400);
  }
  assert.equal((await request('/records/edu-students-v1/S1', { method: 'PUT', cookie, body: { record: student, version: 0 } })).status, 409);
  assert.equal((await create('edu-payments-v1', { id: 'P0', amount: -5 })).status, 400);
  assert.equal((await create('edu-payments-v1', { id: 'P1', studentId: 'S1', amount: 100000, date: '2026-11-01' })).status, 201);
  assert.equal((await create('edu-expenses-v1', { id: 'E1', amount: 20000, date: '2026-11-02' })).status, 201);
  assert.equal((await create('edu-courses-v1', { id: 'C-IELTS', name: 'IELTS', subject: 'Ingliz tili', fee: 500000, status: 'active' })).status, 201);
  assert.equal((await request('/records/edu-courses-v1/C-IELTS', { cookie })).data.record.subject, 'Ingliz tili');
  assert.equal((await create('edu-courses-v1', { id: 'C-invalid', name: 'Invalid', subject: { name: 'Ingliz tili' } })).status, 400);
  for (const fee of [-1, '500000', {}]) {
    assert.equal((await create('edu-courses-v1', { id: 'C-bad-fee', name: 'Invalid', fee })).status, 400);
  }
  for (const groups of ['G1', {}, ['G1', 'G1'], [null]]) {
    assert.equal((await create('edu-teachers-v1', { id: 'T-invalid', groups })).status, 400);
  }
  const report = await request('/reports/finance?from=2026-11-01&to=2026-11-30', { cookie });
  assert.equal(report.status, 200);
  assert.deepEqual(report.data.finance, { income: 100000, expenses: 20000, net: 80000, debt: 50000 });
  assert.equal((await request('/reports/finance?from=2026-13-01', { cookie })).status, 400);
  const stateWrite = (key, value, version = null) => request('/state', { method: 'PUT', cookie, body: { key, value, version } });
  const employeeHistoryPermissions = ['notifications.view', 'notifications.create', 'notifications.edit', 'notifications.delete', 'activity.view', 'activity.create', 'activity.export'];
  assert.equal((await stateWrite('edu-settings-v1', { org: { name: 'INFINITY' }, appearance: { theme: 'dark' }, security: { sessionMinutes: 60 } })).status, 200);
  assert.equal((await stateWrite('edu-roles-v1', [{ id: 'owner', name: 'Owner', permissions: [] }, { id: 'admin', name: 'Admin', permissions: [...employeeHistoryPermissions, 'users-roles.view', 'users-roles.create'] }, { id: 'teacher', name: 'Teacher', permissions: [...employeeHistoryPermissions, 'attendance.view', 'attendance.edit', 'dashboard.view', 'groups.view', 'chat.view', 'chat.create', 'salaries.view'] }, { id: 'viewer', name: 'Viewer', permissions: [...employeeHistoryPermissions, 'payments.view'] }])).status, 200);
  assert.equal((await create('edu-teachers-v1', { id: 'T1', firstName: 'Test', lastName: 'Teacher', groups: ['G1'], status: 'active' })).status, 201);
  assert.equal((await stateWrite('edu-groups-v1', [{ code: 'G1', days: [1, 5], status: 'active' }, { code: 'G2', days: [1, 5], status: 'active' }])).status, 200);
  const fixtureDb = new DatabaseSync(join(dir, 'test.sqlite'));
  fixtureDb.prepare('INSERT INTO app_state (key, value, version, updated_at, updated_by) VALUES (?, ?, 1, ?, ?)').run('edu-attendance-v1', JSON.stringify({ 'G1|2026-11-02': { S1: 'present' }, 'G2|2026-11-02': { S2: 'absent' } }), new Date().toISOString(), 'test-fixture');
  fixtureDb.close();
  for (const roleId of ['teacher', 'viewer']) {
    const account = await request('/admin/accounts', { method: 'POST', cookie, body: { username: `test-${roleId}`, password: 'Account-password-123', firstName: 'Test', lastName: 'User', roleId, teacherId: roleId === 'teacher' ? 'T1' : '' } });
    assert.equal(account.status, 201);
    const session = await request('/auth/login', { method: 'POST', body: { username: `test-${roleId}`, password: 'Account-password-123' } });
    assert.equal(session.status, 200);
    const otherCookie = session.cookie;
    const sharedSettings = (await request('/state', { cookie: otherCookie })).data.state['edu-settings-v1'];
    assert.equal(sharedSettings.org.name, 'INFINITY');
    assert.equal(sharedSettings.security, undefined);
    assert.equal((await request('/records/edu-students-v1', { method: 'POST', cookie: otherCookie, body: { record: { id: 'denied' } } })).status, 403);
    assert.equal((await request('/reports/finance', { cookie: otherCookie })).status, 403);
    if (roleId === 'teacher') {
      const state = await request('/state', { cookie: otherCookie });
      assert.deepEqual(Object.keys(state.data.state['edu-attendance-v1']), ['G1|2026-11-02']);
      assert.equal((await request('/records/edu-students-v1/S1', { cookie: otherCookie })).status, 200);
    }
  }
  const state = await request('/state', { cookie });
  assert.ok(state.data.state['edu-users-v1'].every((user) => !Object.hasOwn(user, 'passwordHash')));
  // Notification audiences are enforced on both APIs, with private read/delete state.
  const teacherLogin = await request('/auth/login', { method: 'POST', body: { username: 'test-teacher', password: 'Account-password-123' } });
  const viewerLogin = await request('/auth/login', { method: 'POST', body: { username: 'test-viewer', password: 'Account-password-123' } });
  const teacherCookie = teacherLogin.cookie;
  const viewerCookie = viewerLogin.cookie;
  const ownerCallActor = `user:${login.data.user.id}`;
  const teacherCallActor = 'teacher:T1';
  const signal = (signalCookie, body) => request('/chat/signals', { method: 'POST', cookie: signalCookie, body });
  // Targeted invitations must reach users who have not joined yet.
  assert.equal((await signal(cookie, { channel: 'general', callId: 'CALL-targeted-test', type: 'invite', to: teacherCallActor })).status, 201);
  assert.equal((await signal(teacherCookie, { channel: 'general', callId: 'CALL-targeted-test', type: 'join', to: ownerCallActor })).status, 201);
  // Another chat-enabled account cannot join an invitation addressed to the owner.
  assert.equal((await signal(cookie, { channel: 'general', callId: 'CALL-private-test', type: 'invite', to: 'user:someone-else' })).status, 201);
  assert.equal((await signal(teacherCookie, { channel: 'general', callId: 'CALL-private-test', type: 'join', to: ownerCallActor })).status, 409);
  const notificationsKey = 'edu-notifications-v1';
  const notifications = [
    { id: 'N-security', title: 'Security', link: '/admin/users-roles', read: false },
    { id: 'N-G1', title: 'Own group', module: 'attendance', entityId: 'G1', read: false },
    { id: 'N-G2', title: 'Other group', module: 'attendance', entityId: 'G2', read: false },
    { id: 'N-viewer', title: 'Private staff notification', recipientIds: [viewerLogin.data.user.id], read: false },
    { id: 'N-teacher', title: 'Private teacher notification', recipientIds: [teacherLogin.data.user.id], read: false },
    { id: 'N-payment', title: 'Payment module', link: '/admin/payments', read: false },
  ];
  assert.equal((await stateWrite(notificationsKey, notifications)).status, 200);
  const teacherNotifications = await request('/state', { cookie: teacherCookie });
  assert.deepEqual(teacherNotifications.data.state[notificationsKey].map((item) => item.id), ['N-G1', 'N-teacher']);
  assert.deepEqual((await request(`/records/${notificationsKey}`, { cookie: viewerCookie })).data.records.map((item) => item.id), ['N-viewer', 'N-payment']);
  assert.equal((await request('/admin/accounts', { method: 'POST', cookie, body: { username: 'notification-admin', password: 'Account-password-123', firstName: 'Notification', lastName: 'Admin', roleId: 'admin' } })).status, 201);
  const adminLogin = await request('/auth/login', { method: 'POST', body: { username: 'notification-admin', password: 'Account-password-123' } });
  const adminCreated = await request('/admin/accounts', { method: 'POST', cookie: adminLogin.cookie, body: { username: 'created-by-admin', password: 'Account-password-123', firstName: 'Created', lastName: 'ByAdmin', roleId: 'admin' } });
  assert.equal(adminCreated.status, 201);
  assert.equal(adminCreated.data.user.roleId, 'admin');
  const adminState = (await request('/state', { cookie: adminLogin.cookie })).data;
  const adminRoleCreation = await request('/state', { method: 'PUT', cookie: adminLogin.cookie, body: {
    key: 'edu-roles-v1',
    value: [...adminState.state['edu-roles-v1'], { id: 'admin-created-role', name: 'Admin created role', permissions: [] }],
    version: adminState.versions['edu-roles-v1'],
  } });
  assert.equal(adminRoleCreation.status, 403);
  assert.equal(adminRoleCreation.data.error, 'role_creation_owner_only');
  const adminTypedRole = await request('/admin/accounts', { method: 'POST', cookie: adminLogin.cookie, body: { username: 'custom-role-by-admin', password: 'Account-password-123', firstName: 'Custom', lastName: 'Denied', roleId: '', roleName: 'Custom admin role' } });
  assert.equal(adminTypedRole.status, 403);
  assert.equal(adminTypedRole.data.error, 'role_creation_owner_only');
  const ownerDenied = await request('/admin/accounts', { method: 'POST', cookie: adminLogin.cookie, body: { username: 'owner-by-admin', password: 'Account-password-123', firstName: 'Owner', lastName: 'Denied', roleId: 'owner' } });
  assert.equal(ownerDenied.status, 400);
  assert.equal((await request(`/records/${notificationsKey}`, { cookie: adminLogin.cookie })).data.records.length, 6);
  assert.equal((await request(`/records/${notificationsKey}/N-security`, { cookie: teacherCookie })).status, 404);
  const updateNotifications = (value, version, userCookie = teacherCookie) => request('/state', { method: 'PUT', cookie: userCookie, body: { key: notificationsKey, value, version } });
  const marked = await updateNotifications(teacherNotifications.data.state[notificationsKey].map((item) => ({ ...item, read: true })), teacherNotifications.data.versions[notificationsKey]);
  assert.equal(marked.status, 200);
  assert.ok(marked.data.value.every((item) => item.read));
  const ownerNotifications = await request(`/records/${notificationsKey}`, { cookie });
  assert.equal(ownerNotifications.data.records.length, 6);
  assert.ok(ownerNotifications.data.records.every((item) => !item.read));
  assert.equal((await updateNotifications([], marked.data.version)).status, 200);
  assert.equal((await request(`/records/${notificationsKey}`, { cookie: teacherCookie })).data.records.length, 0);
  const stillVisible = await request(`/records/${notificationsKey}`, { cookie });
  assert.equal(stillVisible.data.records.length, 6);
  assert.equal((await updateNotifications([notifications[0]], stillVisible.data.version)).status, 403);
  assert.equal((await request(`/records/${notificationsKey}/N-viewer`, { method: 'DELETE', cookie: viewerCookie, body: { version: stillVisible.data.version } })).status, 409);
  const restore = await updateNotifications(marked.data.value, stillVisible.data.version);
  assert.equal(restore.status, 200);
  assert.equal(restore.data.value.length, 2);
  const changedContent = restore.data.value.map((item) => ({ ...item, title: 'Forged notification' }));
  assert.equal((await updateNotifications(changedContent, restore.data.version)).status, 403);
  // Staff history is scoped even when their roles can view the affected module.
  const activityKey = 'edu-activity-v1';
  const viewerActor = { id: viewerLogin.data.user.id, name: 'test-viewer', role: 'viewer' };
  const teacherActor = { id: teacherLogin.data.user.id, name: 'test-teacher', role: 'teacher' };
  const ownerActor = { id: login.data.user.id, name: 'testadmin', role: 'owner' };
  const activity = (id, actor, module, entityId = '') => ({ id, actor, module, entityId, title: id, at: new Date().toISOString(), action: 'update', changes: [], items: [], severity: 'info' });
  const activityRows = [
    activity('A-owner', ownerActor, 'settings'),
    activity('A-viewer', viewerActor, 'system'),
    activity('A-teacher', teacherActor, 'system'),
    activity('A-own-account', ownerActor, 'users', viewerActor.id),
    activity('A-group-G1', ownerActor, 'attendance', 'G1'),
    activity('A-group-G2', ownerActor, 'attendance', 'G2'),
    activity('A-other-payment', ownerActor, 'payments', 'P1'),
  ];
  assert.equal((await stateWrite(activityKey, activityRows)).status, 200);
  const viewerHistory = await request('/state', { cookie: viewerCookie });
  assert.deepEqual(viewerHistory.data.state[activityKey].map((entry) => entry.id), ['A-viewer', 'A-own-account']);
  assert.deepEqual((await request(`/records/${activityKey}`, { cookie: teacherCookie })).data.records.map((entry) => entry.id), ['A-teacher', 'A-group-G1']);
  assert.equal((await request(`/records/${activityKey}`, { cookie: adminLogin.cookie })).data.records.length, 7);
  assert.equal((await request(`/records/${activityKey}/A-owner`, { cookie: viewerCookie })).status, 404);
  const writeHistory = (value, version) => request('/state', { method: 'PUT', cookie: viewerCookie, body: { key: activityKey, value, version } });
  const historyVersion = viewerHistory.data.versions[activityKey];
  assert.equal((await writeHistory([activity('A-forged', ownerActor, 'system')], historyVersion)).status, 403);
  assert.equal((await writeHistory(viewerHistory.data.state[activityKey].map((entry) => ({ ...entry, title: 'Changed history' })), historyVersion)).status, 403);
  const addedHistory = await writeHistory([activity('A-new', viewerActor, 'system')], historyVersion);
  assert.equal(addedHistory.status, 200);
  assert.deepEqual(addedHistory.data.value.map((entry) => entry.id), ['A-new', 'A-viewer', 'A-own-account']);
  assert.equal((await request(`/records/${activityKey}`, { cookie })).data.records.length, 8);
  assert.equal((await writeHistory([], addedHistory.data.version)).status, 200);
  assert.equal((await request(`/records/${activityKey}`, { cookie })).data.records.length, 8);
  assert.equal((await request(`/records/${activityKey}/A-owner`, { method: 'DELETE', cookie: viewerCookie, body: { version: addedHistory.data.version + 1 } })).status, 409);
  const ownAudit = await request('/audit', { cookie: viewerCookie });
  assert.equal(ownAudit.status, 200);
  assert.ok(ownAudit.data.items.length > 0);
  assert.ok(ownAudit.data.items.every((entry) => entry.actorId === viewerActor.id));
  const adminAudit = await request('/audit', { cookie: adminLogin.cookie });
  assert.ok(adminAudit.data.items.some((entry) => entry.actorId === viewerActor.id));
  assert.ok(adminAudit.data.items.some((entry) => entry.actorId === ownerActor.id));
  // The support and main collections can contain the same ID: links include the source.
  assert.equal((await create('edu-support-teachers-v1', { id: 'T1', firstName: 'Support', lastName: 'Teacher', groups: ['G2'], status: 'active', payType: 'fixed', payValue: 1000000 })).status, 201);
  const accountBody = { username: 'support-teacher', password: 'Account-password-123', firstName: 'Support', lastName: 'Teacher', roleId: 'teacher', teacherType: 'support', teacherId: 'T1' };
  const supportAccount = await request('/admin/accounts', { method: 'POST', cookie, body: accountBody });
  assert.equal(supportAccount.status, 201);
  const duplicate = await request('/admin/accounts', { method: 'POST', cookie, body: { ...accountBody, username: 'duplicate-support' } });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error, 'teacher_already_registered');
  assert.equal((await request('/auth/login', { method: 'POST', body: { username: 'duplicate-support', password: accountBody.password } })).status, 401);
  assert.equal((await request('/admin/accounts', { method: 'POST', cookie, body: { ...accountBody, username: 'unknown-profile', teacherId: 'missing' } })).status, 400);
  const supportSession = await request('/auth/login', { method: 'POST', body: { username: accountBody.username, password: accountBody.password } });
  assert.equal(supportSession.status, 200);
  assert.equal(supportSession.data.user.teacherType, 'support');
  const supportState = await request('/state', { cookie: supportSession.cookie });
  assert.deepEqual(Object.keys(supportState.data.state['edu-attendance-v1']), ['G2|2026-11-02']);
  assert.deepEqual(supportState.data.state['edu-teachers-v1'], []);
  assert.equal(supportState.data.state['edu-support-teachers-v1'][0].id, 'T1');
  assert.deepEqual(supportState.data.state['edu-students-v1'], []);
  const hiddenSearch = await request('/records/edu-students-v1?q=Ali&page=1', { cookie: supportSession.cookie });
  assert.equal(hiddenSearch.status, 200);
  assert.deepEqual(hiddenSearch.data.records, []);
  assert.equal(hiddenSearch.data.pagination.total, 0);
  const supportChat = await request('/chat/sync', { cookie: supportSession.cookie });
  assert.equal(supportChat.status, 200);
  assert.equal(supportChat.data.actor.key, 'support:T1');
  assert.ok(supportChat.data.peers.some((peer) => peer.key === 'teacher:T1'));
  assert.ok(supportChat.data.peers.some((peer) => peer.key === 'support:T1'));
  // Names may be entered manually, without granting access to any teacher's groups.
  const manual = await request('/admin/accounts', { method: 'POST', cookie, body: { ...accountBody, username: 'manual-teacher', teacherId: '', teacherType: 'main', email: '' } });
  assert.equal(manual.status, 201);
  const manualLogin = await request('/auth/login', { method: 'POST', body: { username: 'manual-teacher', password: accountBody.password } });
  assert.equal(manualLogin.status, 200);
  assert.deepEqual((await request('/state', { cookie: manualLogin.cookie })).data.state['edu-students-v1'], []);
  const current = await request('/state', { cookie });
  const profiles = current.data.state['edu-users-v1'];
  const updatedUsers = profiles.map((item) => item.id === manual.data.user.id ? { ...item, teacherId: 'T1', teacherType: 'support' } : item);
  const invalidEdit = await stateWrite('edu-users-v1', updatedUsers, current.data.versions['edu-users-v1']);
  assert.equal(invalidEdit.status, 409);
  assert.equal(invalidEdit.data.error, 'teacher_already_registered');
  const changedLogin = profiles.map((item) => item.id === manual.data.user.id ? { ...item, login: 'manual-renamed', status: 'blocked' } : item);
  assert.equal((await stateWrite('edu-users-v1', changedLogin, current.data.versions['edu-users-v1'])).status, 200);
  assert.equal((await request('/auth/me', { cookie: manualLogin.cookie })).status, 401);
  assert.deepEqual((await request('/auth/session', { cookie: manualLogin.cookie })).data, { user: null });
  assert.equal((await request('/auth/login', { method: 'POST', body: { username: 'manual-renamed', password: accountBody.password } })).status, 401);
  const blockedState = await request('/state', { cookie });
  const activeUsers = blockedState.data.state['edu-users-v1'].map((item) => item.id === manual.data.user.id ? { ...item, status: 'active' } : item);
  assert.equal((await stateWrite('edu-users-v1', activeUsers, blockedState.data.versions['edu-users-v1'])).status, 200);
  assert.equal((await request('/auth/login', { method: 'POST', body: { username: 'manual-renamed', password: accountBody.password } })).status, 200);
  const beforeDelete = await request('/state', { cookie });
  assert.equal((await stateWrite('edu-users-v1', beforeDelete.data.state['edu-users-v1'].filter((item) => item.id !== supportAccount.data.user.id), beforeDelete.data.versions['edu-users-v1'])).status, 200);
  assert.equal((await request('/auth/me', { cookie: supportSession.cookie })).status, 401);
  const deletedState = await request('/state', { cookie });
  assert.equal((await stateWrite('edu-users-v1', beforeDelete.data.state['edu-users-v1'], deletedState.data.versions['edu-users-v1'])).status, 200);
  assert.equal((await request('/auth/login', { method: 'POST', body: { username: accountBody.username, password: accountBody.password } })).status, 200);
  // A typed role and its employee salary are committed together with the account.
  const newEmployee = { username: 'new-employee', password: accountBody.password, firstName: 'Office', lastName: 'Employee', roleId: '', roleName: 'Kutubxonachi', monthlySalary: 2500000, email: 'employee@example.test' };
  const employee = await request('/admin/accounts', { method: 'POST', cookie, body: newEmployee });
  assert.equal(employee.status, 201);
  assert.equal((await request('/admin/accounts', { method: 'POST', cookie, body: { ...newEmployee, username: 'invited-is-removed', email: '', status: 'invited' } })).status, 400);
  assert.equal(employee.data.user.monthlySalary, 2500000);
  const afterEmployee = await request('/state', { cookie });
  const newRole = afterEmployee.data.state['edu-roles-v1'].find((item) => item.id === employee.data.user.roleId);
  assert.equal(newRole.name, 'Kutubxonachi');
  assert.deepEqual(newRole.permissions, ['dashboard.view', 'chat.view', 'chat.create', 'chat.edit', ...employeeHistoryPermissions]);
  assert.equal((await request('/admin/accounts', { method: 'POST', cookie, body: { ...newEmployee, username: 'new-employee-2', roleName: 'kutubxonachi', email: '' } })).data.user.roleId, newRole.id);
  assert.equal((await request('/admin/accounts', { method: 'POST', cookie, body: { ...newEmployee, username: 'negative-salary', monthlySalary: -1 } })).status, 400);
  const failedCreation = await request('/admin/accounts', { method: 'POST', cookie, body: { ...newEmployee, username: 'must-roll-back', roleName: 'Should roll back' } });
  assert.equal(failedCreation.status, 409);
  assert.ok(!(await request('/state', { cookie })).data.state['edu-roles-v1'].some((item) => item.name === 'Should roll back'));
  assert.equal((await request('/auth/login', { method: 'POST', body: { username: 'must-roll-back', password: accountBody.password } })).status, 401);
  // The form can fill a teacher salary that is missing, without creating a duplicate employee.
  assert.equal((await create('edu-teachers-v1', { id: 'T-SALARY', firstName: 'Salary', lastName: 'Teacher', groups: [], status: 'active', salaryValue: 0 })).status, 201);
  const salariedTeacher = await request('/admin/accounts', { method: 'POST', cookie, body: { ...accountBody, username: 'salaried-teacher', teacherType: 'main', teacherId: 'T-SALARY', monthlySalary: 3200000 } });
  assert.equal(salariedTeacher.status, 201);
  assert.equal(salariedTeacher.data.changes['edu-teachers-v1'].value.find((item) => item.id === 'T-SALARY').salaryValue, 3200000);
  const payroll = await request('/payroll', { cookie });
  assert.equal(payroll.status, 200);
  assert.equal(payroll.data.employees.find((item) => item.recordId === employee.data.user.id).base, 2500000);
  assert.equal(payroll.data.employees.filter((item) => item.recordId === 'T-SALARY').length, 1);
  assert.ok(!payroll.data.employees.some((item) => Object.hasOwn(item, 'passwordHash') || Object.hasOwn(item, 'login')));
  assert.equal((await request('/payroll')).status, 401);
  const beforeEdit = await request('/state', { cookie });
  const customEdit = await stateWrite('edu-users-v1', beforeEdit.data.state['edu-users-v1'].map((item) => item.id === employee.data.user.id ? { ...item, roleId: '', newRoleName: 'Laborant', monthlySalary: 2700000 } : item), beforeEdit.data.versions['edu-users-v1']);
  assert.equal(customEdit.status, 200);
  const editedEmployee = customEdit.data.value.find((item) => item.id === employee.data.user.id);
  assert.equal(editedEmployee.monthlySalary, 2700000);
  assert.ok(editedEmployee.roleId);
  assert.ok(!Object.hasOwn(editedEmployee, 'newRoleName'));
  assert.ok(customEdit.data.value.every((item) => !Object.hasOwn(item, 'passwordHash')));
  const beforeOverwrite = await request('/state', { cookie });
  assert.equal((await stateWrite('edu-users-v1', beforeOverwrite.data.state['edu-users-v1'].map((item) => item.id === salariedTeacher.data.user.id ? { ...item, monthlySalary: 1 } : item), beforeOverwrite.data.versions['edu-users-v1'])).data.error, 'salary_already_set');
  // Matching IDs from different employee sources must never mix salary payments.
  for (const [id, employeeType] of [['SAL-MAIN', 'main'], ['SAL-SUPPORT', 'support']]) assert.equal((await create('edu-salary-v1', { id, employeeType, teacherId: 'T1', month: '2026-11', date: '2026-11-04', kind: 'pay', amount: 100000 })).status, 201);
  const supportAgain = await request('/auth/login', { method: 'POST', body: { username: accountBody.username, password: accountBody.password } });
  const supportSalaries = (await request('/state', { cookie: supportAgain.cookie })).data.state['edu-salary-v1'];
  assert.deepEqual(supportSalaries.map((item) => item.id), ['SAL-SUPPORT']);
  const ownPayroll = await request('/payroll', { cookie: supportAgain.cookie });
  assert.equal(ownPayroll.data.employees.length, 1);
  assert.equal(ownPayroll.data.employees[0].employeeType, 'support');
  const staffLogin = await request('/auth/login', { method: 'POST', body: { username: 'new-employee', password: accountBody.password } });
  const staff2Login = await request('/auth/login', { method: 'POST', body: { username: 'new-employee-2', password: accountBody.password } });
  assert.ok(staffLogin.data.user.permissions.includes('chat.create'));
  let messageNumber = 0;
  const chatWrite = async (chatCookie, text, channel = 'general', overrides = {}) => {
    const sync = await request('/chat/sync', { cookie: chatCookie });
    assert.equal(sync.status, 200);
    const saved = await request('/state', { cookie: chatCookie });
    const actor = sync.data.actor;
    const message = { id: `CHAT-TEST-${++messageNumber}`, channel, fromKey: actor.key, fromName: actor.name, fromRole: actor.role, text, createdAt: new Date().toISOString(), readBy: [], ...overrides };
    const response = await request('/state', { method: 'PUT', cookie: chatCookie, body: { key: 'edu-chat-v1', value: [...(saved.data.state['edu-chat-v1'] || []), message], version: saved.data.versions['edu-chat-v1'] ?? null } });
    return { response, message };
  };
  assert.equal((await chatWrite(supportAgain.cookie, 'Hello from support teacher')).response.status, 200);
  const ownerSync = await request('/chat/sync', { cookie });
  const supportActor = (await request('/chat/sync', { cookie: supportAgain.cookie })).data.actor;
  const staffActor = (await request('/chat/sync', { cookie: staffLogin.cookie })).data.actor;
  const staff2Actor = (await request('/chat/sync', { cookie: staff2Login.cookie })).data.actor;
  const privateChannel = `direct:${[ownerSync.data.actor.key, supportActor.key].sort().join('|')}`;
  const privateMessage = await chatWrite(cookie, 'Owner and support only', privateChannel);
  assert.equal(privateMessage.response.status, 200);
  const privateReply = await chatWrite(supportAgain.cookie, 'Reply to owner', privateChannel, { replyToId: privateMessage.message.id });
  assert.equal(privateReply.response.status, 200);
  assert.equal((await request('/chat/sync', { cookie })).data.messages.find((item) => item.id === privateReply.message.id).replyToId, privateMessage.message.id);
  assert.equal((await chatWrite(staffLogin.cookie, 'Cross-channel reply', 'general', { replyToId: privateMessage.message.id })).response.status, 400);
  assert.equal((await chatWrite(staffLogin.cookie, 'Missing reply', 'general', { replyToId: 'missing-message' })).response.status, 400);
  assert.ok(!(await request('/chat/sync', { cookie: staffLogin.cookie })).data.messages.some((item) => item.id === privateMessage.message.id));
  assert.ok(!(await request('/state', { cookie: staffLogin.cookie })).data.state['edu-chat-v1'].some((item) => item.id === privateMessage.message.id));
  // Saving a visible chat must preserve messages in other people's private conversations.
  assert.equal((await chatWrite(staffLogin.cookie, 'Hello from the new employee')).response.status, 200);
  assert.ok((await request('/chat/sync', { cookie })).data.messages.some((item) => item.id === privateMessage.message.id));
  const staffChannel = `direct:${[staffActor.key, staff2Actor.key].sort().join('|')}`;
  const directMessage = await chatWrite(staffLogin.cookie, 'Private staff message', staffChannel);
  assert.equal(directMessage.response.status, 200);
  assert.ok((await request('/chat/sync', { cookie: staff2Login.cookie })).data.messages.some((item) => item.id === directMessage.message.id));
  assert.ok(!(await request('/chat/sync', { cookie: supportAgain.cookie })).data.messages.some((item) => item.id === directMessage.message.id));
  assert.equal((await chatWrite(staffLogin.cookie, 'Forged sender', 'general', { fromKey: ownerSync.data.actor.key })).response.status, 403);
  for (const invalid of [{ createdAt: 'invalid' }, { text: {} }, { readBy: 'user:1' }, { reactions: { '👍': 'user:1' } }]) {
    assert.equal((await chatWrite(staffLogin.cookie, 'Invalid chat payload', 'general', invalid)).response.status, 400);
  }
  assert.equal((await request('/chat/presence', { method: 'POST', cookie: staffLogin.cookie, body: { tabId: 'TAB-teststaff' } })).status, 200);
  const onlineStaff = await request('/chat/sync', { cookie });
  const staffActorKey = (await request('/chat/sync', { cookie: staffLogin.cookie })).data.actor.key;
  assert.ok(onlineStaff.data.presence[staffActorKey]['TAB-teststaff'] > 0);
  const lastOnline = onlineStaff.data.peers.find((peer) => peer.key === staffActorKey).lastSeen;
  assert.ok(lastOnline > 0);
  assert.equal((await request('/chat/presence', { method: 'POST', cookie: staffLogin.cookie, body: { tabId: 'TAB-teststaff', remove: true } })).status, 200);
  const offlineStaff = await request('/chat/sync', { cookie });
  assert.equal(offlineStaff.data.presence[staffActorKey], undefined);
  assert.ok(offlineStaff.data.peers.find((peer) => peer.key === staffActorKey).lastSeen >= lastOnline);
  assert.equal((await request('/chat/ice-config', { cookie: staffLogin.cookie })).status, 200);
  // Role checkbox changes apply immediately to existing sessions and stay revoked.
  const beforePermissionEdit = await request('/state', { cookie });
  const rolesKey = 'edu-roles-v1';
  const replaceViewerPermissions = (roles, permissions) => roles.map((role) => role.id === 'viewer' ? { ...role, permissions } : role);
  const revoked = await stateWrite(rolesKey, replaceViewerPermissions(beforePermissionEdit.data.state[rolesKey], []), beforePermissionEdit.data.versions[rolesKey]);
  assert.equal(revoked.status, 200);
  assert.deepEqual(revoked.data.value.find((role) => role.id === 'viewer').permissions, []);
  assert.deepEqual((await request('/auth/session', { cookie: viewerCookie })).data.user.permissions, []);
  assert.equal((await request('/records/edu-payments-v1', { cookie: viewerCookie })).status, 403);
  assert.equal((await request('/records/edu-notifications-v1', { cookie: viewerCookie })).status, 403);
  assert.equal((await request('/records/edu-activity-v1', { cookie: viewerCookie })).status, 403);
  assert.equal((await request('/audit', { cookie: viewerCookie })).status, 403);
  const readOnly = await stateWrite(rolesKey, replaceViewerPermissions(revoked.data.value, ['payments.view']), revoked.data.version);
  assert.equal(readOnly.status, 200);
  assert.equal((await request('/records/edu-payments-v1', { cookie: viewerCookie })).status, 200);
  assert.equal((await request('/records/edu-payments-v1', { method: 'POST', cookie: viewerCookie, body: { record: { id: 'P-role-test', amount: 1 } } })).status, 403);
  const createAllowed = await stateWrite(rolesKey, replaceViewerPermissions(readOnly.data.value, ['payments.view', 'payments.create']), readOnly.data.version);
  assert.equal(createAllowed.status, 200);
  assert.equal((await request('/records/edu-payments-v1', { method: 'POST', cookie: viewerCookie, body: { record: { id: 'P-role-test', amount: 1 } } })).status, 201);
  const revokeAgain = await stateWrite(rolesKey, replaceViewerPermissions(createAllowed.data.value, []), createAllowed.data.version);
  assert.equal(revokeAgain.status, 200);
  assert.equal((await request('/records/edu-payments-v1', { cookie: viewerCookie })).status, 403);
  assert.ok(revokeAgain.data.value.find((role) => role.id === 'owner').permissions.includes('users-roles.edit'));
  assert.equal((await request('/audit', { cookie })).status, 200);
  assert.equal((await request('/records/edu-students-v1/S1', { method: 'DELETE', cookie, body: { version: created.data.version } })).status, 200);
  assert.equal((await request('/records/edu-students-v1/S1', { cookie })).status, 404);
  // Teacher management grants must work without changing the account's role.
  const teacherBefore = await request('/state', { cookie });
  const teacherRoles = teacherBefore.data.state[rolesKey];
  const teacherOriginal = teacherRoles.find((role) => role.id === 'teacher').permissions;
  const teacherGranted = await stateWrite(rolesKey, teacherRoles.map((role) => role.id === 'teacher' ? { ...role, permissions: [...teacherOriginal, 'students.view', 'students.create', 'students.edit', 'students.delete', 'schedule.view', 'schedule.edit'] } : role), teacherBefore.data.versions[rolesKey]);
  assert.equal(teacherGranted.status, 200);
  assert.ok((await request('/auth/session', { cookie: teacherCookie })).data.user.permissions.includes('students.create'));
  const teacherRecord = { id: 'S-granted', firstName: 'Created', lastName: 'ByTeacher', group: 'G1', status: 'active' };
  const teacherCreated = await request('/records/edu-students-v1', { method: 'POST', cookie: teacherCookie, body: { record: teacherRecord } });
  assert.equal(teacherCreated.status, 201);
  const teacherEdited = await request('/records/edu-students-v1/S-granted', { method: 'PUT', cookie: teacherCookie, body: { record: { ...teacherRecord, firstName: 'Edited' }, version: teacherCreated.data.version } });
  assert.equal(teacherEdited.status, 200);
  const teacherAttendance = await request('/state', { cookie: teacherCookie });
  const teacherSavedAttendance = await request('/state', { method: 'PUT', cookie: teacherCookie, body: { key: 'edu-attendance-v1', value: { 'G1|2026-11-06': { 'S-granted': 'p' } }, version: teacherAttendance.data.versions['edu-attendance-v1'] } });
  assert.equal(teacherSavedAttendance.status, 403);
  assert.equal((await request('/state', { method: 'PUT', cookie: teacherCookie, body: { key: 'edu-attendance-v1', value: { 'G2|2026-11-06': { 'S2': 'p' } }, version: teacherAttendance.data.versions['edu-attendance-v1'] } })).status, 403);
  assert.ok(Object.hasOwn((await request('/state', { cookie })).data.state['edu-attendance-v1'], 'G2|2026-11-02'));
  const groupRows = [{ code: 'G1', course: 'Math', days: [1], start: '09:00', end: '10:00', room: '1', status: 'active' }, { code: 'G2', course: 'Other', days: [2], start: '10:00', end: '11:00', room: '2', status: 'active' }];
  assert.equal((await stateWrite('edu-groups-v1', groupRows, (await request('/state', { cookie })).data.versions['edu-groups-v1'])).status, 200);
  assert.deepEqual((await request('/state', { cookie: teacherCookie })).data.state['edu-groups-v1'].map((group) => group.code), ['G1']);
  const scheduleState = await request('/state', { cookie: teacherCookie });
  assert.ok(scheduleState.data.writable.includes('edu-groups-v1'));
  const scheduleSaved = await request('/state', { method: 'PUT', cookie: teacherCookie, body: { key: 'edu-groups-v1', value: [{ ...groupRows[0], room: '3' }], version: scheduleState.data.versions['edu-groups-v1'] } });
  assert.equal(scheduleSaved.status, 200);
  const groupsAfterSchedule = (await request('/state', { cookie })).data.state['edu-groups-v1'];
  assert.equal(groupsAfterSchedule.length, 2);
  assert.equal(groupsAfterSchedule.find((group) => group.code === 'G1').room, '3');
  assert.equal((await request('/state', { method: 'PUT', cookie: teacherCookie, body: { key: 'edu-groups-v1', value: [{ ...groupRows[0], course: 'Forged' }], version: scheduleSaved.data.version } })).status, 403);
  const teacherRevoked = await stateWrite(rolesKey, teacherGranted.data.value.map((role) => role.id === 'teacher' ? { ...role, permissions: teacherOriginal } : role), teacherGranted.data.version);
  assert.equal(teacherRevoked.status, 200);
  assert.equal((await request('/records/edu-students-v1/S-granted', { method: 'PUT', cookie: teacherCookie, body: { record: teacherRecord, version: teacherEdited.data.version } })).status, 403);
  // Even a staff role with salary and employee-list permissions only sees its own pay.
  const beforeSalaryPrivacy = await request('/state', { cookie });
  assert.equal((await stateWrite('edu-users-v1', beforeSalaryPrivacy.data.state['edu-users-v1'].map((user) => user.id === viewerActor.id ? { ...user, monthlySalary: 900000 } : user), beforeSalaryPrivacy.data.versions['edu-users-v1'])).status, 200);
  const privacyRoles = beforeSalaryPrivacy.data.state[rolesKey].map((role) => role.id === 'viewer' ? { ...role, permissions: ['salaries.view', 'salaries.create', 'salaries.edit', 'salaries.delete', 'teachers.view', 'teachers.edit', 'support-teachers.view', 'users-roles.view'] } : role.id === 'admin' ? { ...role, permissions: [...role.permissions, 'salaries.view'] } : role);
  assert.equal((await stateWrite(rolesKey, privacyRoles, beforeSalaryPrivacy.data.versions[rolesKey])).status, 200);
  assert.equal((await create('edu-salary-v1', { id: 'SAL-VIEWER', employeeType: 'user', teacherId: viewerActor.id, month: '2026-11', date: '2026-11-06', kind: 'pay', amount: 70000 })).status, 201);
  const privatePayroll = await request('/payroll', { cookie: viewerCookie });
  assert.equal(privatePayroll.status, 200);
  assert.equal(privatePayroll.data.employees.length, 1);
  assert.equal(privatePayroll.data.employees[0].recordId, viewerActor.id);
  assert.equal(privatePayroll.data.employees[0].base, 900000);
  const privateState = await request('/state', { cookie: viewerCookie });
  assert.deepEqual(privateState.data.state['edu-salary-v1'].map((entry) => entry.id), ['SAL-VIEWER']);
  assert.ok(privateState.data.state['edu-teachers-v1'].every((teacher) => !Object.hasOwn(teacher, 'salaryValue') && !Object.hasOwn(teacher, 'salaryType')));
  assert.ok(privateState.data.state['edu-support-teachers-v1'].every((teacher) => !Object.hasOwn(teacher, 'payValue')));
  assert.ok(privateState.data.state['edu-users-v1'].filter((user) => user.id !== viewerActor.id).every((user) => !Object.hasOwn(user, 'monthlySalary')));
  assert.equal(privateState.data.state['edu-users-v1'].find((user) => user.id === viewerActor.id).monthlySalary, 900000);
  assert.equal((await request('/records/edu-salary-v1/SAL-MAIN', { cookie: viewerCookie })).status, 404);
  assert.equal((await request('/records/edu-salary-v1/SAL-MAIN', { method: 'DELETE', cookie: viewerCookie, body: { version: privateState.data.versions['edu-salary-v1'] } })).status, 403);
  assert.equal((await request('/records/edu-salary-v1', { method: 'POST', cookie: viewerCookie, body: { record: { id: 'SAL-NOT-MINE', teacherId: 'T1', employeeType: 'main', kind: 'pay', month: '2026-11', amount: 1 } } })).status, 403);
  const salaryWrite = await request('/state', { method: 'PUT', cookie: viewerCookie, body: { key: 'edu-salary-v1', value: privateState.data.state['edu-salary-v1'], version: privateState.data.versions['edu-salary-v1'] } });
  assert.equal(salaryWrite.status, 200);
  assert.deepEqual(salaryWrite.data.value.map((entry) => entry.id), ['SAL-VIEWER']);
  assert.ok((await request('/records/edu-salary-v1', { cookie })).data.records.some((entry) => entry.id === 'SAL-MAIN'));
  const maskedTeacher = privateState.data.state['edu-teachers-v1'].find((teacher) => teacher.id === 'T-SALARY');
  const safeTeacherEdit = await request('/records/edu-teachers-v1/T-SALARY', { method: 'PUT', cookie: viewerCookie, body: { record: { ...maskedTeacher, note: 'Staff profile edit', salaryValue: 1 }, version: privateState.data.versions['edu-teachers-v1'] } });
  assert.equal(safeTeacherEdit.status, 200);
  assert.ok(!Object.hasOwn(safeTeacherEdit.data.record, 'salaryValue'));
  assert.equal((await request('/records/edu-teachers-v1/T-SALARY', { cookie })).data.record.salaryValue, 3200000);
  assert.ok((await request('/payroll', { cookie: adminLogin.cookie })).data.employees.length > 1);
  const accessState = (await request('/state', { cookie })).data;
  assert.equal((await stateWrite(rolesKey, accessState.state[rolesKey].map((role) => role.id === 'viewer' ? { ...role, permissions: ['users-roles.view', 'users-roles.create', 'users-roles.edit'] } : role), accessState.versions[rolesKey])).status, 200);
  const higherRole = await request('/admin/accounts', { method: 'POST', cookie: viewerCookie, body: { username: 'escalation-test', password: 'Test-password-123', firstName: 'Test', lastName: 'User', roleId: 'admin' } });
  assert.equal(higherRole.status, 403);
  const escalationProfiles = accessState.state['edu-users-v1'].map((user) => user.id === viewerActor.id ? { ...user, roleId: 'admin' } : user);
  assert.equal((await request('/state', { method: 'PUT', cookie: viewerCookie, body: { key: 'edu-users-v1', value: escalationProfiles, version: accessState.versions['edu-users-v1'] } })).status, 403);
  const secondViewerSession = await request('/auth/login', { method: 'POST', body: { username: 'test-viewer', password: 'Account-password-123' } });
  assert.equal(secondViewerSession.status, 200);
  const changedPassword = await request('/auth/change-password', { method: 'POST', cookie: viewerCookie, body: { currentPassword: 'Account-password-123', newPassword: 'New-account-password-456' } });
  assert.equal(changedPassword.status, 200);
  assert.ok(changedPassword.cookie);
  assert.notEqual(changedPassword.cookie, viewerCookie);
  assert.equal((await request('/auth/me', { cookie: viewerCookie })).status, 401);
  assert.equal((await request('/auth/me', { cookie: secondViewerSession.cookie })).status, 401);
  assert.equal((await request('/auth/me', { cookie: changedPassword.cookie })).status, 200);
  assert.equal((await request('/auth/login', { method: 'POST', body: { username: 'test-viewer', password: 'Account-password-123' } })).status, 401);
  assert.equal((await request('/auth/login', { method: 'POST', body: { username: 'test-viewer', password: 'New-account-password-456' } })).status, 200);
  assert.equal((await request('/auth/logout', { method: 'POST', body: {}, cookie })).status, 200);
  assert.equal((await request('/auth/me', { cookie })).status, 401);
  // Changing usernames must not bypass the per-IP login limit.
  let blocked = false;
  for (let i = 0; i < 61; i++) {
    const attempt = await request('/auth/login', { method: 'POST', body: { username: `missing-user-${i}`, password: 'wrong' } });
    if (attempt.status === 429) { blocked = true; break; }
    assert.equal(attempt.status, 401);
  }
  assert.equal(blocked, true);
});

