import { memoryCache } from '../../../api/memoryStore.js';
import { saveBackendCollection } from '../../../api/backend.js';
// Server-backed data is held only in the tab-local React store.

export const STORAGE_KEY = 'edu-settings-v1';

export const WEEK_DAYS = [
  { value: 1, label: 'Du', full: 'Dushanba' },
  { value: 2, label: 'Se', full: 'Seshanba' },
  { value: 3, label: 'Ch', full: 'Chorshanba' },
  { value: 4, label: 'Pa', full: 'Payshanba' },
  { value: 5, label: 'Ju', full: 'Juma' },
  { value: 6, label: 'Sh', full: 'Shanba' },
  { value: 0, label: 'Ya', full: 'Yakshanba' },
];

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Naqd' },
  { value: 'click', label: 'Click' },
];

export const DEFAULT_SETTINGS = {
  org: {
    name: 'EduControl Pro',
    legalName: '',
    phone: '',
    email: '',
    website: '',
    address: '',
    inn: '',
    director: '',
    timezone: 'Asia/Tashkent',
    workStart: '09:00',
    workEnd: '20:00',
    workDays: [1, 2, 3, 4, 5, 6],
    logo: '',
  },
  appearance: {
    theme: 'dark',
    density: 'comfortable',
    language: 'uz',
    dateFormat: 'dd.mm.yyyy',
  },
  finance: {
    currency: 'UZS',
    invoicePrefix: 'INV',
    dueDay: 10,
    paymentMethods: ['cash', 'click'],
    fiscalYearStart: 1,
  },
  attendance: {
    notifyParents: true,
  },
  notifications: {
    email: true,
    sms: false,
    telegram: true,
    paymentReminders: true,
    attendanceAlerts: true,
    birthdayReminders: true,
    digest: 'weekly',
  },
  security: {
    sessionMinutes: 60,
    twoFactor: false,
    passwordMinLength: 8,
    loginAlerts: true,
  },
  meta: {
    updatedAt: null,
  },
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const merge = (base, patch) => {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  Object.keys(base).forEach((key) => {
    if (key in patch) {
      out[key] = Array.isArray(base[key]) ? (Array.isArray(patch[key]) ? patch[key] : base[key]) : merge(base[key], patch[key]);
    }
  });
  return out;
};

export const cloneSettings = (value) => JSON.parse(JSON.stringify(value));

/** Noma’lum JSON ni standart sxema bilan birlashtiradi (import uchun). */
export const hydrateSettings = (parsed) => {
  const settings = merge(cloneSettings(DEFAULT_SETTINGS), parsed);
  const methods = settings.finance.paymentMethods.filter((method) => ['cash', 'click'].includes(method));
  settings.finance.paymentMethods = methods.length ? [...new Set(methods)] : ['cash', 'click'];
  return settings;
};

export const loadSettings = () => {
  try {
    const parsed = JSON.parse(memoryCache.getItem(STORAGE_KEY));
    if (isPlainObject(parsed)) return hydrateSettings(parsed);
  } catch {
    /* buzilgan yoki mavjud bo‘lmagan */
  }
  return cloneSettings(DEFAULT_SETTINGS);
};

export const saveSettings = async (settings) => {
  const next = { ...settings, meta: { ...settings.meta, updatedAt: new Date().toISOString() } };
  return saveBackendCollection(STORAGE_KEY, next);
};

export const settingsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
