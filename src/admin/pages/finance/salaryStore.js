import { useCollectionState } from '../../../api/memoryStore.js';
import { useCallback, useEffect } from 'react';



import { hasBackendSession, saveBackendCollection } from '../../../api/backend';
import { useRef } from 'react';

// DEMO: memoryCache. Backend ulanganda faqat shu fayl almashtiriladi.
const KEY = 'edu-salary-v1';

export const KINDS = {
  pay: { label: 'Maosh to‘lovi', sign: -1, tone: 'success' },
  advance: { label: 'Avans', sign: -1, tone: 'info' },
  bonus: { label: 'Mukofot (bonus)', sign: 1, tone: 'primary' },
  penalty: { label: 'Ushlanma (jarima)', sign: 1, tone: 'danger' },
};
export const SALARY_STATUSES = {
  paid: { label: 'To‘langan', tone: 'success' },
  partial: { label: 'Qisman', tone: 'warning' },
  unpaid: { label: 'Berilmagan', tone: 'danger' },
};

export const calcSalary = (base, entries) => {
  const sum = (kinds) => entries.filter((e) => kinds.includes(e.kind)).reduce((t, e) => t + e.amount, 0);
  const bonus = sum(['bonus']);
  const penalty = sum(['penalty']);
  const paid = sum(['pay', 'advance']);
  const due = Math.max(0, base + bonus - penalty);
  const left = due - paid;
  const status = paid > 0 && paid >= due ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return { base, bonus, penalty, due, paid, left, status, pct: due ? Math.min(100, Math.round((paid / due) * 100)) : 0 };
};

export const useSalary = () => {
  const saving = useRef(false);
  const [entries, setEntries] = useCollectionState(KEY);
  const latest = useRef(entries);
  useEffect(() => { latest.current = entries; }, [entries]);
  const save = useCallback(async (update) => {
    if (saving.current) throw new Error('Ish haqi saqlanmoqda. Bir oz kuting.');
    saving.current = true;
    try {
      const value = update(latest.current);
      const saved = hasBackendSession() ? await saveBackendCollection(KEY, value) : value;
      latest.current = saved;
      setEntries(saved);
    } finally { saving.current = false; }
  }, [setEntries]);
  const add = useCallback((e) => save((list) => [{ ...e, id: `SAL-${crypto.randomUUID()}` }, ...list]), [save]);
  const remove = useCallback((id) => save((list) => list.filter((e) => e.id !== id)), [save]);
  const restore = useCallback((e) => save((list) => [e, ...list.filter((item) => item.id !== e.id)]), [save]);
  return { entries, add, remove, restore };
};
