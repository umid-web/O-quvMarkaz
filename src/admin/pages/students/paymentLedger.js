export function paymentLedger(student, payments, today = new Date()) {
  const start = /^(\d{4})-(\d{2})-\d{2}/.exec(student.enrolledAt || '');
  if (!start) return { rows: [], paid: 0, debt: 0, credit: 0 };
  const current = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit' }).formatToParts(today);
  const end = Number(current.find((p) => p.type === 'year').value) * 12 + Number(current.find((p) => p.type === 'month').value) - 1;
  const first = Number(start[1]) * 12 + Number(start[2]) - 1;
  const paid = payments.filter((p) => p.studentId === student.id).reduce((s, p) => s + Math.max(0, Number(p.amount) || 0), 0);
  let remaining = paid;
  const rows = [];
  for (let index = first; index <= end && rows.length < 1200; index++) {
    const charge = Math.max(0, Number(index === first ? student.firstCharge ?? student.monthlyFee : student.monthlyFee) || 0);
    const applied = Math.min(remaining, charge);
    remaining -= applied;
    rows.push({ month: `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`, charge, paid: applied, debt: charge - applied });
  }
  return { rows, paid, debt: rows.reduce((s, r) => s + r.debt, 0), credit: remaining };
}
