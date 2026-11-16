import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('existing staff roles receive chat once; later explicit restrictions remain intact', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'edu-chat-migration-'));
  process.env.SQLITE_FILE = join(dir, 'test.sqlite');
  const { db } = await import('../database.js');
  const { writeStoredData, readStoredData } = await import('../dataStore.js');
  const { migrateEmployeeChatAccess } = await import('../migrations.js');
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  const roles = [
    { id: 'teacher', permissions: ['students.view'] },
    { id: 'reception', permissions: ['payments.create'] },
    { id: 'custom', permissions: ['dashboard.view'] },
    { id: 'read-only-chat', permissions: ['chat.view'] },
  ];
  writeStoredData('edu-roles-v1', roles, 1, 'test');
  migrateEmployeeChatAccess();
  const migrated = readStoredData('edu-roles-v1');
  assert.equal(migrated.version, 2);
  for (const role of migrated.value.slice(0, 3)) for (const permission of ['chat.view', 'chat.create', 'chat.edit']) assert.ok(role.permissions.includes(permission));
  assert.deepEqual(migrated.value[3].permissions, ['chat.view']);
  const restricted = migrated.value.map((role) => role.id === 'teacher' ? { ...role, permissions: ['students.view'] } : role);
  writeStoredData('edu-roles-v1', restricted, 3, 'admin');
  migrateEmployeeChatAccess();
  assert.equal(readStoredData('edu-roles-v1').version, 3);
  assert.deepEqual(readStoredData('edu-roles-v1').value[0].permissions, ['students.view']);
});
