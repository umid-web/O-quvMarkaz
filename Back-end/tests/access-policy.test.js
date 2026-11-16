import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertCanManageRole } from '../accessPolicy.js';
import { ensureAdminAccountCreation } from '../../src/auth/adminAccountPermissions.js';
import { ensureTeacherGroupAccess } from '../../src/auth/teacherGroupPermissions.js';

test('staff cannot assign or take over higher privilege accounts', () => {
  const actor = { role_id: 'staff', permissions: ['users-roles.create', 'users-roles.edit', 'chat.view'] };
  assert.throws(() => assertCanManageRole(actor, 'admin', ['settings.edit']), { status: 403 });
  assert.throws(() => assertCanManageRole(actor, 'owner', []), { status: 403 });
  assert.doesNotThrow(() => assertCanManageRole(actor, 'peer', ['chat.view']));
  assert.doesNotThrow(() => assertCanManageRole({ role_id: 'owner' }, 'admin', ['settings.edit']));
});

test('standard admin can create users without receiving edit or delete access', () => {
  const roles = [
    { id: 'admin', name: 'Administrator', permissions: ['dashboard.view'] },
    { id: 'custom', name: 'Custom', permissions: [] },
  ];
  const migrated = ensureAdminAccountCreation(roles);
  assert.deepEqual(migrated[0].permissions, ['dashboard.view', 'users-roles.view', 'users-roles.create']);
  assert.equal(migrated[1], roles[1]);
  assert.deepEqual(ensureAdminAccountCreation(migrated), migrated);
});

test('teacher receives read-only access to assigned groups', () => {
  const roles = [{ id: 'teacher', permissions: ['students.view'] }, { id: 'admin', permissions: [] }];
  const migrated = ensureTeacherGroupAccess(roles);
  assert.deepEqual(migrated[0].permissions, ['students.view', 'groups.view']);
  assert.deepEqual(migrated[1].permissions, []);
  assert.deepEqual(ensureTeacherGroupAccess(migrated), migrated);
});
