import { memoryCache, sessionIdentity } from '../../api/memoryStore.js';
import { useSyncExternalStore } from 'react';
import { formatNumber, formatPhone } from '../utils/format';
import { pushNotification } from './notificationStore';
import { hasBackendSession } from '../../api/backend';

// Server-backed data is held only in the tab-local React store.

const KEY = 'edu-activity-v1';
const MAX = 1000;

// Hozircha tizimda login yo‘q — keyinchalik haqiqiy foydalanuvchi bilan almashtiriladi.
export const getActor = () => ({
  id: sessionIdentity.getItem('educontrol_user_id') || 'U-ADMIN',
  name: sessionIdentity.getItem('educontrol_username') || 'Administrator',
  role: sessionIdentity.getItem('educontrol_role') || 'admin',
});

/* ====================== Maydonlarni o‘qiladigan ko‘rinishga keltirish ====================== */

const FIELD_LABELS = {
  firstName: 'Ism', lastName: 'Familiya', gender: 'Jinsi', birthDate: 'Tug‘ilgan sana',
  phone: 'Telefon', parentPhone: 'Ota-ona telefoni', address: 'Manzil', email: 'Email',
  course: 'Kurs', group: 'Guruh', groups: 'Guruhlar', subjects: 'Fanlar', status: 'Holati',
  monthlyFee: 'Oylik to‘lov', fee: 'Narx', debt: 'Qarz', amount: 'Summa', salaryType: 'Maosh turi',
  salaryValue: 'Maosh', enrolledAt: 'Qo‘shilgan sana', hiredAt: 'Ishga olingan sana',
  experience: 'Tajriba (yil)', education: 'Ma’lumoti', attendance: 'Davomat (%)', note: 'Izoh',
  days: 'Dars kunlari', start: 'Boshlanishi', end: 'Tugashi', room: 'Xona', capacity: 'Sig‘im',
  startDate: 'Boshlanish sanasi', name: 'Nomi', title: 'Sarlavha', category: 'Toifa', date: 'Sana',
  method: 'To‘lov usuli', roleId: 'Rol', color: 'Rang', tone: 'Rang', description: 'Tavsif',
  duration: 'Davomiyligi', durationMonths: 'Davomiyligi (oy)', lessonMinutes: 'Dars davomiyligi (daq.)',
  topics: 'Mavzular', level: 'Daraja', teacher: 'Ustoz', teachers: 'Ustozlar',
  permissions: 'Ruxsatlar', period: 'Davr', theme: 'Mavzu', density: 'Zichlik', language: 'Til',
  dateFormat: 'Sana formati', currency: 'Valyuta', timezone: 'Vaqt mintaqasi',
};

const STATUS_LABELS = {
  active: 'Faol', frozen: 'Muzlatilgan', graduated: 'Bitirgan', dropped: 'Chiqib ketgan',
  vacation: 'Ta‘tilda', left: 'Ketgan', archived: 'Arxivda', blocked: 'Bloklangan',
};

const GENDER_LABELS = { male: 'O‘g‘il bola', female: 'Qiz bola' };
const WEEKDAYS = { 0: 'Yak', 1: 'Du', 2: 'Se', 3: 'Chor', 4: 'Pay', 5: 'Juma', 6: 'Shan' };
const MONEY_KEYS = new Set(['monthlyFee', 'fee', 'debt', 'amount']);
const PHONE_KEYS = new Set(['phone', 'parentPhone']);

export const fieldLabel = (key) => FIELD_LABELS[key] ?? key;

export const formatValue = (key, value) => {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Ha' : 'Yo‘q';
  if (key === 'days' && Array.isArray(value)) return value.map((d) => WEEKDAYS[d] ?? d).join(', ') || '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'object') return 'o‘zgartirildi';
  if (key === 'status' && STATUS_LABELS[value]) return STATUS_LABELS[value];
  if (key === 'gender' && GENDER_LABELS[value]) return GENDER_LABELS[value];
  if (PHONE_KEYS.has(key)) return formatPhone(value);
  if (MONEY_KEYS.has(key) && typeof value === 'number') return `${formatNumber(value)} so‘m`;
  const text = String(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
};

const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

/** Tahrirlashda faqat haqiqatan o‘zgargan maydonlar ro‘yxati. `patch` — yangi qiymatlar. */
export const diffObjects = (before, patch, { ignore = [], labels = {} } = {}) => {
  const skip = new Set(ignore);
  return Object.keys(patch)
    .filter((k) => !skip.has(k) && !same(before?.[k], patch[k]))
    .map((k) => ({
      field: k,
      label: labels[k] ?? fieldLabel(k),
      from: formatValue(k, before?.[k]),
      to: formatValue(k, patch[k]),
    }));
};

/* ====================== Do‘kon (store) ====================== */

const uid = () => `A-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Birinchi ochilishda sahifa bo‘sh ko‘rinmasligi uchun DEMO yozuvlar (backend ulanganda olib tashlanadi)
const read = () => {
  try {
    const raw = memoryCache.getItem(KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* buzilgan ma'lumot */
  }
  return [];
};

let state = read();
const listeners = new Set();

const commit = (next) => {
  const encoded = JSON.stringify(next);
  try {
    memoryCache.setItem(KEY, encoded);
  } catch {
    // Permissions and failed sync can reject auxiliary writes without publishing.
  }
  state = read();
  listeners.forEach((l) => l());
  return memoryCache.getItem(KEY) === encoded;
};

if (typeof window !== 'undefined') {
  window.addEventListener('educontrol:collection', (e) => {
    if (e.key !== KEY) return;
    state = read();
    listeners.forEach((l) => l());
  });

}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => state;

/** Barcha yozuvlar (yangisi birinchi). O‘zgarganda komponent qayta chiziladi. */
export const useActivities = () => useSyncExternalStore(subscribe, getSnapshot);

/**
 * Faoliyatni yozib qo‘yadi. `notify` berilsa — shu bilan birga bildirishnoma ham yaratiladi:
 * notify: { category, priority, title, message, link }
 */
export const logActivity = ({
  module = 'system',
  action = 'update',
  title,
  entityId = '',
  entityName = '',
  changes = [],
  items = [],
  severity = 'info',
  meta = null,
  notify = null,
}) => {
  const entry = {
    id: uid(),
    at: new Date().toISOString(),
    actor: getActor(),
    module,
    action,
    title,
    entityId: String(entityId ?? ''),
    entityName,
    changes: changes.slice(0, 40),
    items: items.slice(0, 100),
    severity,
    meta,
  };
  if (!commit([entry, ...state].slice(0, MAX))) return null;
  if (notify) pushNotification({ module, entityId: entry.entityId, ...notify, activityId: entry.id });
  return entry;
};

/** Tarixni tozalaydi va bu haqda bitta yozuv qoldiradi (audit uchun). */
export const clearActivities = () => {
  if (hasBackendSession() && !['owner', 'admin'].includes(sessionIdentity.getItem('educontrol_role'))) return;
  const count = state.length;
  if (!commit([])) return;
  logActivity({
    module: 'system',
    action: 'system',
    title: `Faoliyat tarixi tozalandi (${count} ta yozuv)`,
    severity: 'warning',
    notify: { category: 'security', priority: 'normal', title: 'Faoliyat tarixi tozalandi', message: `${count} ta yozuv o‘chirildi`, link: '/admin/activity' },
  });
};

/* ====================== CRUD do‘konlari uchun tayyor yordamchi ====================== */

const bulkTitle = (count, noun, verb) => `${count} ta ${noun.toLowerCase()} ${verb}`;

/**
 * Har bir do‘kon (students, teachers, ...) uchun bitta marta sozlanadi:
 *   const log = createLogger({ module: 'students', noun: 'Talaba', nameOf: (s) => `${s.lastName} ${s.firstName}`, ignore: ['debt'] });
 *   log.created(item) · log.updated(before, patch) · log.deleted(items) · log.restored(items) · log.statusChanged(items, status)
 */
export const createLogger = ({ module, noun, nameOf, idOf = (x) => x.id, ignore = [], moduleFor = null, notifyCreate = null, labels = {} }) => {
  const lower = noun.toLowerCase();
  const itemsOf = (list) => list.map((x) => ({ id: String(idOf(x)), name: nameOf(x) }));

  return {
    created(item) {
      return logActivity({
        module,
        action: 'create',
        severity: 'success',
        title: `${noun} qo‘shildi: ${nameOf(item)}`,
        entityId: idOf(item),
        entityName: nameOf(item),
        notify: notifyCreate ? notifyCreate(item) : null,
      });
    },

    updated(before, patch) {
      if (!before) return null;
      const changes = diffObjects(before, patch, { ignore, labels });
      if (!changes.length) return null;
      const after = { ...before, ...patch };
      return logActivity({
        module: moduleFor ? moduleFor(patch) : module,
        action: 'update',
        title: `${noun} ma’lumotlari tahrirlandi: ${nameOf(after)}`,
        entityId: idOf(after),
        entityName: nameOf(after),
        changes,
      });
    },

    deleted(list, { notifyBulkFrom = 3 } = {}) {
      if (!list.length) return null;
      const single = list.length === 1;
      return logActivity({
        module,
        action: 'delete',
        severity: 'danger',
        title: single ? `${noun} o‘chirildi: ${nameOf(list[0])}` : bulkTitle(list.length, noun, 'o‘chirildi'),
        entityId: single ? idOf(list[0]) : '',
        entityName: single ? nameOf(list[0]) : '',
        items: single ? [] : itemsOf(list),
        notify: list.length >= notifyBulkFrom
          ? { category: 'system', priority: 'high', title: 'Ommaviy o‘chirish', message: bulkTitle(list.length, noun, 'o‘chirildi'), link: '/admin/activity' }
          : null,
      });
    },

    restored(list) {
      if (!list.length) return null;
      const single = list.length === 1;
      return logActivity({
        module,
        action: 'restore',
        severity: 'info',
        title: single ? `${noun} qaytarildi: ${nameOf(list[0])}` : bulkTitle(list.length, noun, 'qaytarildi'),
        entityId: single ? idOf(list[0]) : '',
        entityName: single ? nameOf(list[0]) : '',
        items: single ? [] : itemsOf(list),
      });
    },

    /** statusLabel — "Muzlatilgan" kabi o‘qiladigan yorliq. */
    statusChanged(list, status, statusLabel, field = 'status') {
      const changed = list.filter((x) => x[field] !== status);
      if (!changed.length) return null;
      const single = changed.length === 1;
      const label = statusLabel ?? formatValue('status', status);
      return logActivity({
        module,
        action: 'status',
        severity: status === 'blocked' || status === 'dropped' ? 'danger' : 'warning',
        title: single
          ? `${noun} holati o‘zgartirildi: ${nameOf(changed[0])} → ${label}`
          : `${changed.length} ta ${lower} holati o‘zgartirildi → ${label}`,
        entityId: single ? idOf(changed[0]) : '',
        entityName: single ? nameOf(changed[0]) : '',
        changes: single ? [{ field, label: fieldLabel(field), from: formatValue(field, changed[0][field]), to: label }] : [],
        items: single ? [] : itemsOf(changed),
      });
    },
  };
};
