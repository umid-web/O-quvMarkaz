import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentLedger } from '../../src/admin/pages/students/paymentLedger.js';

test('unpaid months accumulate; installments close oldest months and retain advance credit', () => {
  const student = { id: 'S1', enrolledAt: '2026-09-15', monthlyFee: 300000, firstCharge: 150000 };
  const today = new Date('2026-11-13T07:00:00Z');
  assert.equal(paymentLedger(student, [], today).debt, 750000);
  const payments = [{ studentId: 'S1', amount: 50000 }, { studentId: 'S1', amount: 100000 }, { studentId: 'other', amount: 999999 }];
  let ledger = paymentLedger(student, payments, today);
  assert.equal(ledger.rows[0].debt, 0);
  assert.equal(ledger.rows[0].paid, 150000);
  assert.equal(ledger.debt, 600000);
  ledger = paymentLedger(student, [...payments, { studentId: 'S1', amount: 650000 }], today);
  assert.equal(ledger.debt, 0);
  assert.equal(ledger.credit, 50000);
});
