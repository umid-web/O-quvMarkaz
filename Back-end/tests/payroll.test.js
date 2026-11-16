import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPayroll, entryMatchesEmployee } from '../../src/admin/pages/finance/payroll.js';
import { ACCOUNT_OPTIONS, accountOptionLabel, resolveAccountOption } from '../../src/admin/pages/users-roles/accountOptions.js';

test('account suggestions distinguish main/support teachers and accept typed roles', () => {
  assert.equal(ACCOUNT_OPTIONS.length, 4);
  const roles = [{ id: 'manager', name: 'Menejer' }, { id: 'teacher', name: 'Ustoz' }];
  assert.deepEqual(resolveAccountOption("Qo'shimcha o'qituvchi", roles), { name: 'Qo‘shimcha o‘qituvchi', roleId: 'teacher', teacherType: 'support' });
  assert.equal(resolveAccountOption('menejer', roles).roleId, 'manager');
  assert.equal(resolveAccountOption('Kutubxonachi', roles).newRoleName, 'Kutubxonachi');
  assert.equal(accountOptionLabel({ roleId: 'teacher', teacherType: 'support' }, roles), 'Qo‘shimcha o‘qituvchi');
});

test('payroll includes staff, excludes duplicates and separates matching employee IDs', () => {
  const employees = buildPayroll({
    month: '2026-11',
    payments: [{ studentId: 'S1', group: 'G1', date: '2026-11-13', amount: 500000 }],
    teachers: [{ id: '1', firstName: 'Main', groups: ['G1'], salaryType: 'percent', salaryValue: 40, status: 'active' }],
    supportTeachers: [{ id: '1', firstName: 'Support', groups: ['G1'], payType: 'perLesson', payValue: 50000, status: 'active' }],
    users: [{ id: 'U1', firstName: 'Admin', roleId: 'admin', status: 'active', monthlySalary: 3000000 }, { id: 'U2', roleId: 'teacher', teacherId: '1', teacherType: 'support', status: 'active', monthlySalary: 9999999 }, { id: 'U3', status: 'blocked', monthlySalary: 1000000 }],
    students: [{ group: 'G1', status: 'active', monthlyFee: 500000 }, { group: 'G1', status: 'dropped', monthlyFee: 9999999 }],
    groups: [{ code: 'G1', days: [1, 3, 5] }],
  });
  assert.equal(employees.length, 3);
  assert.deepEqual(employees.map((person) => person.base), [200000, 600000, 3000000]);
  assert.equal(new Set(employees.map((person) => person.id)).size, 3);
  const legacyPayment = { teacherId: '1', amount: 100000 };
  assert.equal(entryMatchesEmployee(legacyPayment, employees[0]), true);
  assert.equal(entryMatchesEmployee(legacyPayment, employees[1]), false);
  assert.equal(entryMatchesEmployee({ ...legacyPayment, employeeType: 'support' }, employees[1]), true);
});

test('percentage salary uses received installments in selected month, without rounding to ten thousand', () => {
  const input = { teachers: [{ id: 'T1', groups: ['G1'], salaryType: 'percent', salaryValue: 40 }], students: [{ id: 'S1', group: 'G1', monthlyFee: 500000 }], payments: [
    { studentId: 'S1', group: 'G1', date: '2026-11-15', amount: 100000 },
    { studentId: 'S1', group: 'G1', date: '2026-11-20', amount: 51250 },
    { group: 'G2', date: '2026-11-20', amount: 900000 },
    { group: 'G1', date: '2026-10-20', amount: 250000 },
  ] };
  assert.equal(buildPayroll({ ...input, month: '2026-11' })[0].base, 60500);
  assert.equal(buildPayroll({ ...input, month: '2026-10' })[0].base, 100000);
  assert.equal(buildPayroll({ ...input, month: '2026-12' })[0].base, 0);
});
