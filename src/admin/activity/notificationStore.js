import { memoryCache, sessionIdentity } from '../../api/memoryStore.js';
import { useSyncExternalStore } from 'react';


// Server-backed data is held only in the tab-local React store.

const KEY = 'edu-notifications-v1';
const MAX = 200;

export const notificationPath = (path) => {
  const role = sessionIdentity.getItem('educontrol_role');
  if (!['teacher', 'reception'].includes(role) || !path?.startsWith('/admin/')) return path;
  const section = path.slice('/admin/'.length).split('/')[0];
  const allowed = role === 'teacher'
    ? ['students', 'schedule', 'payments', 'salaries', 'chat', 'notifications']
    : ['debts', 'attendance', 'students', 'payments', 'groups', 'courses', 'schedule', 'notifications'];
  return allowed.includes(section) ? `/${role}/${section}` : `/${role}`;
};

const uid = () => `N-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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

const buildSnapshot = (items) => ({
  items,
  unread: items.reduce((n, x) => n + (x.read ? 0 : 1), 0),
  urgent: items.reduce((n, x) => n + (!x.read && x.priority === 'high' ? 1 : 0), 0),
});

let snapshot = buildSnapshot(read());
const listeners = new Set();

const commit = (items) => {
  const encoded = JSON.stringify(items.slice(0, MAX));
  try {
    memoryCache.setItem(KEY, encoded);
  } catch {
    // A rejected write must not create an independent, unsaved UI snapshot.
  }
  snapshot = buildSnapshot(read());
  listeners.forEach((l) => l());
  return memoryCache.getItem(KEY) === encoded;
};

// Boshqa oynada (tab) o‘zgarsa — shu yerda ham yangilanadi
if (typeof window !== 'undefined') {
  window.addEventListener('educontrol:collection', (e) => {
    if (e.key !== KEY) return;
    snapshot = buildSnapshot(read());
    listeners.forEach((l) => l());
  });
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => snapshot;

/** { items, unread, urgent } — o‘zgarganda komponent qayta chiziladi. */
export const useNotifications = () => useSyncExternalStore(subscribe, getSnapshot);

/** Yangi bildirishnoma. `key` berilsa va shunday bildirishnoma mavjud bo‘lsa — qo‘shilmaydi. */
export const pushNotification = ({ category = 'system', priority = 'normal', title, message = '', link = '', key, activityId, module, entityId, recipientIds }) => {
  if (key && snapshot.items.some((n) => n.key === key)) return null;
  const created = { id: uid(), at: new Date().toISOString(), category, priority, title, message, link, read: false, key, activityId, module, entityId, recipientIds };
  return commit([created, ...snapshot.items]) ? created : null;
};

export const markRead = (ids, value = true) => {
  const set = new Set([].concat(ids));
  commit(snapshot.items.map((n) => (set.has(n.id) && n.read !== value ? { ...n, read: value } : n)));
};

export const markAllRead = () => commit(snapshot.items.map((n) => (n.read ? n : { ...n, read: true })));

/** O‘chirilgan yozuvlarni qaytaradi — "Qaytarish" (undo) uchun. */
export const removeNotifications = (ids) => {
  const set = new Set([].concat(ids));
  const removed = snapshot.items.filter((n) => set.has(n.id));
  return commit(snapshot.items.filter((n) => !set.has(n.id))) ? removed : [];
};

export const restoreNotifications = (items) => {
  const have = new Set(snapshot.items.map((n) => n.id));
  const merged = [...snapshot.items, ...items.filter((n) => !have.has(n.id))];
  commit(merged.sort((a, b) => b.at.localeCompare(a.at)));
};

export const clearRead = () => {
  const removed = snapshot.items.filter((n) => n.read);
  return commit(snapshot.items.filter((n) => !n.read)) ? removed : [];
};
