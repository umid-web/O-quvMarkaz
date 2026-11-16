import { memoryCache, useCollectionState } from '../../../api/memoryStore.js';
import { useCallback } from 'react';
import { diffObjects, logActivity } from '../../activity/activityStore';
import { formatSom } from '../../utils/format';




// DEMO: memoryCache. Backend ulanganda faqat shu fayl API so‘rovlariga almashtiriladi.
const PAY_KEY = 'edu-payments-v1';
const EXP_KEY = 'edu-expenses-v1';

export const METHODS = ['Naqd', 'Click'];
export const EXPENSE_CATEGORIES = [
  { value: 'rent', label: 'Ijara' },
  { value: 'salary', label: 'Ish haqi' },
  { value: 'utilities', label: 'Kommunal' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'supplies', label: 'Jihozlar' },
  { value: 'other', label: 'Boshqa' },
];
export const categoryLabel = (v) => EXPENSE_CATEGORIES.find((c) => c.value === v)?.label ?? v;

export const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const readRows = (key) => JSON.parse(memoryCache.getItem(key) ?? '[]');
const useSaved = (key) => useCollectionState(key);

const payTitle = (p) => `${p.name} — ${formatSom(p.amount)}`;
const expTitle = (e) => `${e.title} — ${formatSom(e.amount)}`;

export const usePayments = (students) => {
  const [payments, setPayments] = useSaved(PAY_KEY);


  const add = useCallback((p) => {
    const student = students.find((item) => item.id === p.studentId);
    const created = { ...p, group: p.group || student?.group || '', course: p.course || student?.course || '', id: `PAY-${crypto.randomUUID()}` };
    setPayments((l) => [created, ...l]);
    logActivity({
      module: 'payments',
      action: 'payment',
      severity: 'success',
      title: `To‘lov qabul qilindi: ${payTitle(created)}`,
      entityId: created.id,
      entityName: created.name,
      meta: { Usul: created.method, Guruh: created.group, Davr: created.period ?? created.date?.slice(0, 7), Sana: created.date },
      notify: { category: 'payment', priority: 'normal', title: 'To‘lov qabul qilindi', message: `${created.name} · ${formatSom(created.amount)}${created.method ? ` (${created.method})` : ''}`, link: '/admin/payments' },
    });
    return created;
  }, [setPayments, students]);
  const remove = useCallback((id) => {
    const removed = readRows(PAY_KEY).find((p) => p.id === id);
    setPayments((l) => l.filter((p) => p.id !== id));
    if (removed) {
      logActivity({
        module: 'payments',
        action: 'delete',
        severity: 'danger',
        title: `To‘lov bekor qilindi: ${payTitle(removed)}`,
        entityId: removed.id,
        entityName: removed.name,
        meta: { Usul: removed.method, Guruh: removed.group, Sana: removed.date },
        notify: { category: 'payment', priority: 'high', title: 'To‘lov bekor qilindi', message: `${payTitle(removed)} — summa qarzga qaytarildi`, link: '/admin/payments' },
      });
    }
  }, [setPayments]);
  const removeForStudent = useCallback((studentId) => {
    const removed = readRows(PAY_KEY).filter((payment) => payment.studentId === studentId);
    if (!removed.length) return [];
    setPayments((list) => list.filter((payment) => payment.studentId !== studentId));
    logActivity({
      module: 'payments',
      action: 'delete',
      severity: 'warning',
      title: `${removed.length} ta to‘lov yozuvi talabalar bazasi bilan birga o‘chirildi`,
      entityId: studentId,
      entityName: removed[0].name,
    });
    return removed;
  }, [setPayments]);
  const restore = useCallback((p) => {
    setPayments((l) => [p, ...l.filter((item) => item.id !== p.id)].sort((a, b) => b.date.localeCompare(a.date)));
    logActivity({ module: 'payments', action: 'restore', severity: 'info', title: `To‘lov qaytarildi: ${payTitle(p)}`, entityId: p.id, entityName: p.name });
  }, [setPayments]);
  return { payments, add, remove, removeForStudent, restore };
};

export const useExpenses = () => {
  const [expenses, setExpenses] = useSaved(EXP_KEY);

  const add = useCallback((e) => {
    const created = { ...e, id: `EXP-${crypto.randomUUID()}` };
    setExpenses((l) => [created, ...l].sort((a, b) => b.date.localeCompare(a.date)));
    logActivity({
      module: 'expenses',
      action: 'create',
      severity: 'success',
      title: `Xarajat qo‘shildi: ${expTitle(created)}`,
      entityId: created.id,
      entityName: created.title,
      meta: { Toifa: categoryLabel(created.category), Sana: created.date },
    });
  }, [setExpenses]);
  const remove = useCallback((id) => {
    const removed = readRows(EXP_KEY).find((e) => e.id === id);
    setExpenses((l) => l.filter((e) => e.id !== id));
    if (removed) {
      logActivity({ module: 'expenses', action: 'delete', severity: 'danger', title: `Xarajat o‘chirildi: ${expTitle(removed)}`, entityId: removed.id, entityName: removed.title });
    }
  }, [setExpenses]);
  const update = useCallback((id, patch) => {
    const before = readRows(EXP_KEY).find((e) => e.id === id);
    setExpenses((l) => l.map((e) => (e.id === id ? { ...e, ...patch } : e)).sort((a, b) => b.date.localeCompare(a.date)));
    if (before) {
      const changes = diffObjects(before, patch);
      if (changes.length) {
        logActivity({ module: 'expenses', action: 'update', title: `Xarajat tahrirlandi: ${patch.title ?? before.title}`, entityId: id, entityName: patch.title ?? before.title, changes });
      }
    }
  }, [setExpenses]);
  const restore = useCallback((e) => {
    setExpenses((l) => [e, ...l.filter((item) => item.id !== e.id)].sort((a, b) => b.date.localeCompare(a.date)));
    logActivity({ module: 'expenses', action: 'restore', severity: 'info', title: `Xarajat qaytarildi: ${expTitle(e)}`, entityId: e.id, entityName: e.title });
  }, [setExpenses]);
  return { expenses, add, remove, update, restore };
};
