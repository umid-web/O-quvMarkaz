import { useEntityCollection, loadEntityCollection } from '../../hooks/useEntityCollection.js';
import { getCourse } from '../students/studentsData';
import { createLogger } from '../../activity/activityStore';

// Server-backed data is held only in the tab-local React store.
const STORAGE_KEY = 'edu-courses-v1';

export const loadCourses = () => loadEntityCollection(STORAGE_KEY);

/** Kursning joriy oylik narxi (Kurslar sahifasida o‘zgartirilgan bo‘lsa — shu, aks holda boshlang‘ich narx). */
export const getCourseFee = (name) => loadCourses().find((c) => c.name === name)?.fee ?? getCourse(name)?.fee ?? 0;

const log = createLogger({ module: 'courses', noun: 'Kurs', nameOf: (c) => c.name });

export const useCourses = () => {
  const { items, ...actions } = useEntityCollection({ storageKey: STORAGE_KEY, log, prefix: 'C-' });
  return { courses: items, ...actions };
};
