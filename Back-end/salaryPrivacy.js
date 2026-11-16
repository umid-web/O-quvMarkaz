import { db } from './database.js';
import { fail } from './http.js';

export const canSeeAllSalaries = (account) => ['owner', 'admin'].includes(account.role_id);

export function ownsSalary(account, type, id) {
  if (type === 'user') return String(id) === String(account.id);
  const row = db.prepare("SELECT value FROM app_state WHERE key = 'edu-users-v1'").get();
  let profile;
  try { profile = (row ? JSON.parse(row.value) : []).find((user) => user.id === account.id); } catch { return false; }
  return profile?.roleId === 'teacher' && type === (profile.teacherType || 'main') && String(id) === String(profile.teacherId);
}

const employeeTypes = { 'edu-users-v1': 'user', 'edu-teachers-v1': 'main', 'edu-support-teachers-v1': 'support' };
const salaryFields = ['monthlySalary', 'salary', 'salaryType', 'salaryValue', 'payType', 'payValue', 'payStatus', 'base'];

export function redactSalary(account, key, value) {
  if (canSeeAllSalaries(account) || !Array.isArray(value)) return value;
  if (['edu-activity-v1', 'edu-notifications-v1'].includes(key)) {
    return value.filter((entry) => {
      if (entry.module !== 'salaries' && !entry.link?.endsWith('/salaries')) return true;
      const id = String(entry.entityId || '');
      if (id.startsWith('user:')) return ownsSalary(account, 'user', id.slice(5));
      if (id.startsWith('support:')) return ownsSalary(account, 'support', id.slice(8));
      const row = db.prepare("SELECT value FROM app_state WHERE key = 'edu-salary-v1'").get();
      let payment;
      try { payment = (row ? JSON.parse(row.value) : []).find((item) => item.id === id); } catch { /* legacy history */ }
      return payment ? ownsSalary(account, payment.employeeType || 'main', payment.teacherId) : ownsSalary(account, 'main', id);
    }).map((entry) => {
      const type = { teachers: 'main', 'support-teachers': 'support', users: 'user', 'users-roles': 'user' }[entry.module];
      if (!type || ownsSalary(account, type, entry.entityId) || !Array.isArray(entry.changes)) return entry;
      return { ...entry, changes: entry.changes.filter((change) => !salaryFields.includes(change.field)) };
    });
  }
  if (key === 'edu-salary-v1') return value.filter((entry) => ownsSalary(account, entry.employeeType || 'main', entry.teacherId));
  const type = employeeTypes[key];
  if (!type) return value;
  return value.map((record) => {
    if (ownsSalary(account, type, record.id)) return record;
    const safe = { ...record };
    salaryFields.forEach((field) => delete safe[field]);
    return safe;
  });
}

export function preservePrivateSalary(account, key, incoming, current) {
  if (canSeeAllSalaries(account) || !Array.isArray(incoming)) return incoming;
  const previous = new Map((current || []).map((entry) => [entry.id, entry]));
  if (key === 'edu-salary-v1') {
    for (const entry of incoming) {
      const old = previous.get(entry.id);
      if (!ownsSalary(account, entry.employeeType || 'main', entry.teacherId)
        || (old && !ownsSalary(account, old.employeeType || 'main', old.teacherId))) throw fail(403, 'forbidden', 'Other employees salary records are private.');
    }
    return [...(current || []).filter((entry) => !ownsSalary(account, entry.employeeType || 'main', entry.teacherId)), ...incoming];
  }
  const type = employeeTypes[key];
  if (!type) return incoming;
  return incoming.map((entry) => {
    if (ownsSalary(account, type, entry.id)) return entry;
    const safe = { ...entry };
    for (const field of salaryFields) {
      if (previous.get(entry.id)?.[field] !== undefined) safe[field] = previous.get(entry.id)[field];
      else delete safe[field];
    }
    return safe;
  });
}
