import { useEntityCollection } from '../../hooks/useEntityCollection.js';
import { createLogger } from '../../activity/activityStore';
import { STATUSES } from './studentsData';

// Server-backed data is held only in the tab-local React store.
const STORAGE_KEY = 'edu-students-v1';

// Faoliyat tarixi: talabalar ro‘yxatidagi har bir o‘zgarish shu yerda yoziladi.
// "debt" va "attendance" avtomatik hisoblanadi (to‘lov/davomat bilan), shuning uchun alohida yozilmaydi.
const log = createLogger({
  module: 'students',
  noun: 'Talaba',
  nameOf: (s) => `${s.lastName} ${s.firstName}`,
  ignore: ['debt', 'attendance'],
  notifyCreate: (s) => ({
    category: 'student',
    priority: 'low',
    title: 'Yangi talaba qo‘shildi',
    message: `${s.lastName} ${s.firstName} · ${s.course}, ${s.group}`,
    link: '/admin/students',
  }),
});

export const useStudents = () => {
  const { items, ...actions } = useEntityCollection({ storageKey: STORAGE_KEY, log, prefix: 'ST-', statuses: STATUSES });
  return { students: items, ...actions };
};
