import { readStoredData, writeStoredData } from './dataStore.js';

export function lessonAlerts(groups, attendance, now = new Date()) {
  const local = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const day = local.toISOString().slice(0, 10);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return groups.filter((g) => g.status === 'active' && g.days?.includes(local.getUTCDay())).flatMap((g) => {
    const record = attendance[`${g.code}|${day}`];
    const status = record?.lessonStatus;
    const marks = Object.values(record || {}).filter((v) => v === 'p' || v === 'a');
    const end = /^(\d{2}):(\d{2})$/.exec(g.end || '');
    const overdue = end && minutes >= Number(end[1]) * 60 + Number(end[2]);
    const outcome = status === 'not_held' ? 'not_held' : status === 'held' ? (marks.length ? 'held' : overdue ? 'missing' : null) : overdue ? 'missing' : null;
    if (!outcome) return [];
    const title = { held: 'Dars o‘tildi, davomat olindi', not_held: 'Dars o‘tilmadi', missing: 'Davomat olinmagan yoki dars holati tasdiqlanmagan' }[outcome];
    return [{ id: `lesson:${g.code}:${day}:${outcome}`, key: `lesson:${g.code}:${day}:${outcome}`, at: now.toISOString(), category: 'attendance', module: 'attendance', entityId: g.code, recipientIds: [], priority: outcome === 'held' ? 'normal' : 'high', title, message: `${g.code} · ${day} · ${g.start}–${g.end}`, link: '/admin/attendance', read: false }];
  });
}

export function syncLessonAlerts() {
  const groups = readStoredData('edu-groups-v1').value || [];
  const attendance = readStoredData('edu-attendance-v1').value || {};
  const stored = readStoredData('edu-notifications-v1');
  const existing = stored.value || [];
  const known = new Set(existing.map((n) => n.key));
  const added = lessonAlerts(groups, attendance).filter((n) => !known.has(n.key));
  if (added.length) writeStoredData('edu-notifications-v1', [...added, ...existing].slice(0, 200), stored.version + 1, 'system');
}
