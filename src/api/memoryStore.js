import { useCallback, useSyncExternalStore } from 'react';

export const privateKeys = new Set([
  'edu-students-v1', 'edu-teachers-v1', 'edu-support-teachers-v1', 'edu-courses-v1', 'edu-groups-v1',
  'edu-schedule-rooms-v1', 'edu-attendance-v1', 'edu-payments-v1', 'edu-expenses-v1', 'edu-salary-v1',
  'edu-users-v1', 'edu-roles-v1', 'edu-settings-v1', 'edu-notifications-v1', 'edu-activity-v1',
  'edu-chat-v1', 'edu-chat-presence-v1',
]);
const values = new Map();
const parsed = new Map();
const listeners = new Set();
let writeCollection;
let collectionEpoch = 0;
const emptyList = Object.freeze([]);
const emptyObject = Object.freeze({});
const objectKeys = new Set(['edu-attendance-v1', 'edu-settings-v1', 'edu-chat-presence-v1']);

export function publishCollection(key, raw) {
  if (values.get(key) === raw) return;
  if (raw === null) { values.delete(key); parsed.delete(key); }
  else { parsed.set(key, JSON.parse(raw)); values.set(key, raw); }
  listeners.forEach((listener) => listener(key));
  if (typeof window !== 'undefined') {
    const event = new Event('educontrol:collection');
    Object.assign(event, { key, newValue: raw });
    window.dispatchEvent(event);
  }
}

// A tab-local external React store. Never delegates to Web Storage or IndexedDB.
export const memoryCache = {
  getItem: (key) => values.get(key) ?? null,
  setItem(key, raw) {
    if (!privateKeys.has(key)) throw new Error(`Unknown collection: ${key}`);
    if (!writeCollection) throw new Error('Collection API is not ready.');
    writeCollection(key, String(raw));
  },
  removeItem: (key) => publishCollection(key, null),
};
export const configureCollectionWriter = (writer) => { writeCollection = writer; };
export const subscribeCollections = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
// Read actions from the store itself: React effects can lag behind consecutive edits.
export const readCollectionSnapshot = (key) => parsed.get(key) ?? (objectKeys.has(key) ? emptyObject : emptyList);
export function clearCollections() {
  collectionEpoch += 1;
  for (const key of privateKeys) publishCollection(key, null);
}
export function useCollectionState(key) {
  const epoch = collectionEpoch;
  const subscribe = useCallback((listener) => subscribeCollections((changed) => { if (changed === key) listener(); }), [key]);
  const getSnapshot = useCallback(() => readCollectionSnapshot(key), [key]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setValue = useCallback((update) => {
    if (epoch !== collectionEpoch) throw Object.assign(new Error('Sessiya o‘zgardi. Qayta urinib ko‘ring.'), { status: 409, code: 'session_changed' });
    const current = readCollectionSnapshot(key);
    const next = typeof update === 'function' ? update(current) : update;
    memoryCache.setItem(key, JSON.stringify(next));
  }, [key, epoch]);
  return [value, setValue];
}

// UI identity is populated only after the server verifies the HttpOnly session.
const identity = new Map();
export const sessionIdentity = {
  getItem: (key) => identity.get(key) ?? null,
  setItem: (key, value) => identity.set(key, String(value)),
  removeItem: (key) => identity.delete(key),
  clear: () => identity.clear(),
};

let legacyRecovery = null;
let migrationError = '';
export function getLegacyRecovery() { return legacyRecovery; }
export function getMigrationError() { return migrationError; }
export function discardLegacyRecovery() { legacyRecovery = null; }
export function migratePrivateCaches() {
  if (typeof window === 'undefined') return;
  migrationError = '';
  const recovered = { ...(legacyRecovery ?? {}) };
  const recover = (key, raw, source) => {
    if (recovered[key] === undefined || recovered[key] === raw) {
      recovered[key] = raw;
      return;
    }
    // A retry may discover another source after the first snapshot was deleted.
    // Keep every distinct variant, including repeated failures of the same source.
    const variant = `${source}:${key}`;
    let recoveryKey = variant;
    let suffix = 2;
    while (recovered[recoveryKey] !== undefined && recovered[recoveryKey] !== raw) {
      recoveryKey = `${variant}:${suffix++}`;
    }
    recovered[recoveryKey] = raw;
  };
  // The former write queue was RAM-only; legacy snapshots are the only recoverable drafts.
  for (const storageName of ['localStorage', 'sessionStorage']) {
    try {
      const storage = window[storageName];
      if (!storage) continue;
      for (const key of privateKeys) {
        const raw = storage.getItem(key);
        if (raw !== null) {
          recover(key, raw, storageName);
          storage.removeItem(key);
        }
      }
      for (const name of ['logged_in', 'username', 'role', 'user_id', 'teacher_id', 'teacher_type', 'permission_fingerprint']) {
        storage.removeItem(`educontrol_${name}`);
      }
    } catch {
      migrationError = 'Eski brauzer keshini tozalab bo‘lmadi. Ushbu sayt uchun brauzer saqlash joyiga ruxsatni tekshiring va qayta urinib ko‘ring.';
    }
  }
  if (Object.keys(recovered).length) legacyRecovery = recovered;
}
