import { can, scopedState } from './permissions.js';
import { readStoredData } from './dataStore.js';
import { fail, json } from './http.js';

const rows = (account, key) => scopedState(account, key, readStoredData(key).value ?? []);
const sum = (list, field = 'amount') => list.reduce((total, item) => total + (Number(item[field]) || 0), 0);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function date(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw fail(400, 'invalid_date', 'Sana YYYY-MM-DD formatida bo‘lishi kerak.');
  }
  return value;
}

export function handleReportRequest(req, res, url, account) {
  if (!['/api/dashboard', '/api/reports/finance'].includes(url.pathname)) return false;
  if (req.method !== 'GET') throw fail(405, 'method_not_allowed', 'Faqat GET so‘roviga ruxsat beriladi.');
  const dashboard = url.pathname === '/api/dashboard';
  if (!can(account, dashboard ? 'dashboard' : 'reports', 'view')) throw fail(403, 'forbidden', 'Hisobotni ko‘rish huquqi yo‘q.');
  const to = date(url.searchParams.get('to') || today());
  const from = date(url.searchParams.get('from') || `${to.slice(0, 7)}-01`);
  if (from > to) throw fail(400, 'invalid_range', 'Boshlanish sanasi tugash sanasidan keyin bo‘lishi mumkin emas.');
  const result = { from, to };
  if (dashboard) {
    result.counts = {};
    for (const [module, key] of [['students', 'edu-students-v1'], ['teachers', 'edu-teachers-v1'], ['courses', 'edu-courses-v1'], ['groups', 'edu-groups-v1']]) {
      if (can(account, module, 'view')) {
        const list = rows(account, key);
        result.counts[module] = { total: list.length, active: list.filter((item) => item.status === 'active').length };
      }
    }
  }
  const paymentAccess = can(account, 'payments', 'view');
  const expenseAccess = can(account, 'expenses', 'view');
  if (!dashboard && !paymentAccess && !expenseAccess) throw fail(403, 'forbidden', 'Moliyaviy ma’lumotlarni ko‘rish huquqi yo‘q.');
  const inRange = (item) => typeof item.date === 'string' && item.date.slice(0, 10) >= from && item.date.slice(0, 10) <= to;
  const payments = paymentAccess ? rows(account, 'edu-payments-v1').filter(inRange) : [];
  const expenses = expenseAccess ? rows(account, 'edu-expenses-v1').filter(inRange) : [];
  result.finance = {};
  if (paymentAccess) result.finance.income = sum(payments);
  if (expenseAccess) result.finance.expenses = sum(expenses);
  if (paymentAccess && expenseAccess) result.finance.net = sum(payments) - sum(expenses);
  if (can(account, 'students', 'view') && can(account, 'debts', 'view')) result.finance.debt = sum(rows(account, 'edu-students-v1'), 'debt');
  const months = new Map();
  for (const [list, field] of [[payments, 'income'], [expenses, 'expenses']]) {
    for (const item of list) {
      const month = item.date.slice(0, 7);
      if (!months.has(month)) months.set(month, { month, ...(paymentAccess ? { income: 0 } : {}), ...(expenseAccess ? { expenses: 0 } : {}) });
      months.get(month)[field] += Number(item.amount) || 0;
    }
  }
  result.months = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  json(res, 200, result);
  return true;
}
