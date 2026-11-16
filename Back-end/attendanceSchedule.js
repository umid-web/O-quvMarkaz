import { fail } from './http.js';
import { attendanceWindow } from '../src/admin/pages/attendance/attendanceWindow.js';

export function assertAttendanceSchedule(incoming, previous, groups, now = Date.now()) {
  for (const [key, record] of Object.entries(incoming)) {
    if (JSON.stringify(record) === JSON.stringify(previous[key])) continue;
    const split = key.lastIndexOf('|');
    const code = key.slice(0, split);
    const date = key.slice(split + 1);
    const parsed = new Date(`${date}T00:00:00Z`);
    const group = groups.find((g) => g.code === code);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || !group?.days?.includes(parsed.getUTCDay())) {
      throw fail(400, 'not_lesson_day', 'Faqat guruhning dars kunlarida davomat va dars holatini belgilash mumkin.');
    }
    const window = attendanceWindow(group, date, now);
    if (!window.allowed) throw fail(403, 'attendance_closed', window.message);
  }
}
