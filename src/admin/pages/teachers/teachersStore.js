import { useEntityCollection, loadEntityCollection } from '../../hooks/useEntityCollection.js';
import { createLogger } from '../../activity/activityStore';
import { TEACHER_STATUSES } from './teachersData';

// Server-backed data is held only in the tab-local React store.
const STORAGE_KEY = 'edu-teachers-v1';

/** Ustozlarni bir marta o‘qiydi (talabalar formasi/profili ustoz nomini ko‘rsatish uchun ishlatadi). */
export const loadTeachers = () => loadEntityCollection(STORAGE_KEY);

/** Guruh kodiga ko‘ra ustozni topadi (yo‘q bo‘lsa — null). */
export const findTeacherByGroup = (teachers, code) => teachers.find((t) => t.groups.includes(code)) ?? null;

const log = createLogger({ module: 'teachers', noun: 'Ustoz', nameOf: (t) => `${t.lastName} ${t.firstName}` });

export const useTeachers = () => {
  const { items, ...actions } = useEntityCollection({ storageKey: STORAGE_KEY, log, prefix: 'T-', statuses: TEACHER_STATUSES });
  return { teachers: items, ...actions };
};
