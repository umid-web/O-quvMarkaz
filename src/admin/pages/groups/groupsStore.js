import { useEntityCollection, loadEntityCollection } from '../../hooks/useEntityCollection.js';
import { subscribeCollections } from '../../../api/memoryStore.js';
import { createLogger } from '../../activity/activityStore';
import { GROUP_STATUSES, applyGroupsRegistry } from './groupsData';

// Server-backed data is held only in the tab-local React store.
const STORAGE_KEY = 'edu-groups-v1';

export const loadGroups = () => loadEntityCollection(STORAGE_KEY);

// Dars vaqti/xonasi o‘zgarsa — "Dars jadvali" bo‘limi, qolgan hammasi — "Guruhlar"
const SCHEDULE_KEYS = new Set(['days', 'start', 'end', 'room']);
const log = createLogger({
  module: 'groups',
  noun: 'Guruh',
  nameOf: (g) => g.code,
  idOf: (g) => g.code,
  moduleFor: (patch) => (Object.keys(patch).every((k) => SCHEDULE_KEYS.has(k)) ? 'schedule' : 'groups'),
});

// Ilova ochilishi bilan (App.jsx bu faylni darhol import qiladi) umumiy guruh ro‘yxatlari yangilanadi —
// shundan keyin Talabalar, Ustozlar va Kurslar sahifalari saqlangan guruhlarni ko‘radi.
applyGroupsRegistry(loadGroups());
subscribeCollections((key) => { if (key === STORAGE_KEY) applyGroupsRegistry(loadGroups()); });

export const useGroups = () => {
  const { items, ...actions } = useEntityCollection({ storageKey: STORAGE_KEY, log, statuses: GROUP_STATUSES, idKey: 'code' });
  return { groups: items, ...actions };
};
