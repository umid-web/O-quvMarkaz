import { randomUUID } from 'node:crypto';
import { db } from './database.js';
import { fail } from './http.js';
import { writeStoredData } from './dataStore.js';
import { teacherCollection } from './teacherAccounts.js';
import { DEFAULT_EMPLOYEE_PERMISSIONS } from '../src/auth/chatPermissions.js';
import { roleFor } from './permissions.js';
import { assertCanManageRole } from './accessPolicy.js';

export function assertAccountRole(actor, roleId) {
  assertCanManageRole({ ...actor, permissions: roleFor(actor).permissions }, roleId, roleFor({ role_id: roleId }).permissions);
}

const read = (key) => {
  const row = db.prepare('SELECT value, version FROM app_state WHERE key = ?').get(key);
  return { value: row ? JSON.parse(row.value) : [], version: row?.version ?? 0 };
};
const write = (key, value, actor, changes) => {
  const version = read(key).version + 1;
  writeStoredData(key, value, version, actor.id);
  changes[key] = { value, version };
};

export function resolveAccountRole(roleId, roleName, actor, changes) {
  const roles = read('edu-roles-v1').value;
  if (roleName !== undefined && (typeof roleName !== 'string' || roleName.trim().length < 2 || roleName.trim().length > 80)) throw fail(400, 'invalid_role_name', 'Rol nomi 2–80 belgidan iborat bo‘lsin.');
  if (roleId) {
    if (!roles.some((role) => role.id === roleId)) throw fail(400, 'unknown_role', 'Tanlangan rol mavjud emas.');
    assertAccountRole(actor, roleId);
    return roleId;
  }
  if (!roleName) throw fail(400, 'unknown_role', 'Rolni tanlang yoki nomini yozing.');
  const name = roleName.trim();
  const existing = roles.find((role) => role.name.toLocaleLowerCase('uz') === name.toLocaleLowerCase('uz'));
  if (existing) { assertAccountRole(actor, existing.id); return existing.id; }
  const role = { id: `custom-${randomUUID()}`, name, description: 'Foydalanuvchi qo‘shishda yaratilgan rol', tone: 'primary', system: false, locked: false, permissions: [...DEFAULT_EMPLOYEE_PERMISSIONS] };
  assertCanManageRole({ ...actor, permissions: roleFor(actor).permissions }, role.id, role.permissions);
  write('edu-roles-v1', [...roles, role], actor, changes);
  return role.id;
}

export function validateMonthlySalary(value) {
  if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000)) throw fail(400, 'invalid_salary', 'Oylik maosh 0–1 000 000 000 oralig‘idagi butun son bo‘lsin.');
}

// Called inside the same transaction as the account write.
export function applyAccountFields(users, previous, actor, changes) {
  return users.map((user) => {
    const { newRoleName, ...profile } = user;
    if (newRoleName) profile.roleId = resolveAccountRole(profile.roleId, newRoleName, actor, changes);
    validateMonthlySalary(profile.monthlySalary);
    if (profile.roleId !== 'teacher') {
      profile.teacherId = '';
      profile.teacherType = '';
      return profile;
    }
    const old = previous.find((item) => item.id === profile.id);
    const unchanged = old?.monthlySalary === profile.monthlySalary && old?.teacherId === profile.teacherId && (old?.teacherType || 'main') === (profile.teacherType || 'main');
    if (!profile.teacherId || !profile.monthlySalary || unchanged) return profile;
    const key = teacherCollection(profile.teacherType);
    const teachers = read(key).value;
    const teacher = teachers.find((item) => item.id === profile.teacherId);
    if (!teacher) throw fail(400, 'unknown_teacher', 'Ustoz profili topilmadi.');
    const support = profile.teacherType === 'support';
    const amountField = support ? 'payValue' : 'salaryValue';
    const typeField = support ? 'payType' : 'salaryType';
    if (Number(teacher[amountField]) > 0) throw fail(409, 'salary_already_set', 'Bu ustozning maoshi belgilangan. Uni ustoz profilida tahrirlang.');
    write(key, teachers.map((item) => item.id === teacher.id ? { ...item, [typeField]: 'fixed', [amountField]: profile.monthlySalary } : item), actor, changes);
    return profile;
  });
}
