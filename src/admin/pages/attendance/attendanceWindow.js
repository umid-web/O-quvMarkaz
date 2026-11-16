export function attendanceWindow(group, date, now = Date.now()) {
  const start = Date.parse(`${date}T${group?.start}:00+05:00`);
  const end = Date.parse(`${date}T${group?.end}:00+05:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { allowed: false, message: 'Guruhning dars vaqti noto‘g‘ri.' };
  if (now < start) return { allowed: false, message: 'Dars hali boshlanmagan. Davomat dars boshlanganda ochiladi.' };
  if (now > end + 3 * 60 * 60 * 1000) return { allowed: false, message: 'Dars tugaganiga 3 soatdan oshdi. Davomat yopilgan.' };
  return { allowed: true, message: '' };
}
