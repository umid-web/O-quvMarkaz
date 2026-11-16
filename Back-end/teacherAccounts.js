import { fail } from './http.js';
import { db } from './database.js';

export const teacherCollection = (type) => type === 'support' ? 'edu-support-teachers-v1' : 'edu-teachers-v1';

export function validateTeacherAccounts(users, previous = []) {
  const linked = new Set();
  for (const user of users) {
    if (user.roleId !== 'teacher') continue;
    const type = user.teacherType || 'main';
    if (!['main', 'support'].includes(type)) throw fail(400, 'invalid_teacher_type', 'Ustoz turi noto‘g‘ri.');
    if (!user.teacherId) continue;
    const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(teacherCollection(type));
    const teacher = (row ? JSON.parse(row.value) : []).find((item) => item.id === user.teacherId);
    const unchanged = previous.some((item) => item.id === user.id && item.teacherId === user.teacherId && (item.teacherType || 'main') === type);
    if ((!teacher || teacher.status === 'left') && !unchanged) throw fail(400, 'unknown_teacher', 'Ishlayotgan ustoz profilini tanlang.');
    const key = `${type}:${user.teacherId}`;
    if (linked.has(key)) throw fail(409, 'teacher_already_registered', 'Bu ustoz uchun foydalanuvchi hisobi allaqachon mavjud.');
    linked.add(key);
  }
}
