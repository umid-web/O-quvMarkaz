import { useEntityCollection, loadEntityCollection } from '../../hooks/useEntityCollection.js';
import { createLogger } from '../../activity/activityStore';
import { SUPPORT_STATUSES } from './supportData';

// Server-backed data is held only in the tab-local React store.
const STORAGE_KEY = 'edu-support-teachers-v1';

/** Qo‘shimcha ustozlarni bir marta o‘qiydi (boshqa sahifalar ko‘rsatish uchun ishlatishi mumkin). */
export const loadSupportTeachers = () => loadEntityCollection(STORAGE_KEY);

/** Guruhga biriktirilgan (ishlayotgan va ta‘tildagi) qo‘shimcha ustozlar. */
export const findSupportByGroup = (list, code) => list.filter((p) => p.status !== 'left' && p.groups.includes(code));

const log = createLogger({ module: 'support', noun: 'Qo‘shimcha ustoz', nameOf: (p) => `${p.lastName} ${p.firstName}` });

export const useSupportTeachers = () => {
  const { items, ...actions } = useEntityCollection({ storageKey: STORAGE_KEY, log, prefix: 'S-', statuses: SUPPORT_STATUSES });
  return { supportTeachers: items, ...actions };
};
