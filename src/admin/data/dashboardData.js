const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const amountInRange = (rows, start, end) => rows.reduce((sum, row) => {
  const date = String(row.date ?? '').slice(0, 10);
  return date >= start && date <= end ? sum + (Number(row.amount) || 0) : sum;
}, 0);

const rangeStart = (period, today) => {
  const date = new Date(`${today}T12:00:00`);
  if (period === 'today') return today;
  if (period === 'week') date.setDate(date.getDate() - 6);
  else if (period === 'month') date.setDate(date.getDate() - 29);
  else if (period === 'year') date.setMonth(0, 1);
  else return '0000-01-01';
  return dateKey(date);
};

function buildRevenueData(payments, expenses, period, now) {
  const buckets = [];
  if (period === 'year') {
    for (let month = 0; month < 12; month += 1) {
      const start = dateKey(new Date(now.getFullYear(), month, 1));
      const end = dateKey(new Date(now.getFullYear(), month + 1, 0));
      buckets.push({ label: new Intl.DateTimeFormat('uz-UZ', { month: 'short' }).format(new Date(now.getFullYear(), month, 1)), start, end });
    }
  } else {
    const count = period === 'day' ? 1 : period === 'week' ? 7 : 30;
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      const key = dateKey(date);
      buckets.push({ label: period === 'week' ? new Intl.DateTimeFormat('uz-UZ', { weekday: 'short' }).format(date) : period === 'day' ? 'Bugun' : String(date.getDate()), start: key, end: key });
    }
  }
  return buckets.map((bucket) => ({
    label: bucket.label,
    income: Number((amountInRange(payments, bucket.start, bucket.end) / 1_000_000).toFixed(2)),
    expense: Number((amountInRange(expenses, bucket.start, bucket.end) / 1_000_000).toFixed(2)),
  }));
}

export function buildDashboardData({ students = [], payments = [], expenses = [], teachers = [], supportTeachers = [], courses = [], groups = [], period = 'month', now = new Date() }) {
  const today = dateKey(now);
  const start = rangeStart(period, today);
  const activeStudents = students.filter((student) => student.status === 'active');
  const debtors = activeStudents.filter((student) => Number(student.debt) > 0);
  const dueToday = (group) => group.status === 'active' && group.days?.includes(now.getDay());
  const todayGroups = groups.filter(dueToday).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const assigned = new Set([...teachers, ...supportTeachers].filter((teacher) => teacher.status === 'active').flatMap((teacher) => teacher.groups ?? []));
  const unassigned = groups.filter((group) => group.status === 'active' && !assigned.has(group.code));
  const availableRooms = [...new Set(groups.map((group) => group.room).filter(Boolean))];
  const occupiedRooms = new Set(todayGroups.map((group) => group.room).filter(Boolean));
  const paymentStatusCounts = { paid: 0, partial: 0, unpaid: 0 };
  for (const student of students) {
    const debt = Number(student.debt) || 0;
    if (debt <= 0) paymentStatusCounts.paid += 1;
    else if (debt < (Number(student.monthlyFee) || 0)) paymentStatusCounts.partial += 1;
    else paymentStatusCounts.unpaid += 1;
  }
  const studentTotal = students.length;
  const paymentStatus = [
    ['paid', 'To‘langan'], ['partial', 'Qisman to‘langan'], ['unpaid', 'To‘lanmagan'],
  ].map(([key, status]) => ({ status, value: studentTotal ? Math.round(paymentStatusCounts[key] * 100 / studentTotal) : 0 })).filter((row) => row.value > 0);
  const courseCounts = new Map(courses.map((course) => [course.name, 0]));
  for (const student of students) courseCounts.set(student.course || 'Kurs ko‘rsatilmagan', (courseCounts.get(student.course || 'Kurs ko‘rsatilmagan') ?? 0) + 1);
  const courseDist = [...courseCounts].map(([name, value]) => ({ name, value })).filter((row) => row.value > 0);

  const studentStats = Array.from({ length: 4 }, (_, index) => {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (3 - index) * 7);
    const begin = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
    const from = dateKey(begin);
    const through = dateKey(end);
    const cohort = students.filter((student) => String(student.enrolledAt ?? '').slice(0, 10) >= from && String(student.enrolledAt ?? '').slice(0, 10) <= through);
    return {
      name: `${String(begin.getDate()).padStart(2, '0')}.${String(begin.getMonth() + 1).padStart(2, '0')}`,
      new: cohort.length,
      active: cohort.filter((student) => student.status === 'active').length,
      inactive: cohort.filter((student) => student.status !== 'active').length,
    };
  });

  const schedule = todayGroups.map((group) => {
    const teacher = teachers.find((item) => item.status === 'active' && item.groups?.includes(group.code));
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startHour, startMinute] = String(group.start ?? '00:00').split(':').map(Number);
    const [endHour, endMinute] = String(group.end ?? '00:00').split(':').map(Number);
    const begins = startHour * 60 + startMinute;
    const finishes = endHour * 60 + endMinute;
    const status = currentMinutes < begins ? 'scheduled' : currentMinutes > finishes ? 'completed' : 'ongoing';
    return { id: group.code, time: group.start, subject: group.course, group: group.code, teacher: teacher ? `${teacher.lastName} ${teacher.firstName}` : 'Biriktirilmagan', room: group.room, status };
  });
  const alerts = [
    ...(debtors.length ? [{ id: 'debtors', level: 'warning', message: `${debtors.length} nafar faol talabada qarzdorlik bor` }] : []),
    ...(unassigned.length ? [{ id: 'unassigned', level: 'error', message: `${unassigned.length} ta faol guruhga ustoz biriktirilmagan` }] : []),
    ...(!todayGroups.length ? [{ id: 'no-lessons', level: 'info', message: 'Bugun uchun dars rejalashtirilmagan' }] : []),
  ];
  const periodIncome = amountInRange(payments, start, today);
  const todayIncome = amountInRange(payments, today, today);
  const unpaidDebts = debtors.reduce((sum, student) => sum + (Number(student.debt) || 0), 0);

  return {
    stats: {
      totalStudents: students.length,
      activeStudents: activeStudents.length,
      totalTeachers: teachers.filter((teacher) => teacher.status !== 'left').length,
      extraTeachers: supportTeachers.filter((teacher) => teacher.status !== 'left').length,
      activeGroups: groups.filter((group) => group.status === 'active').length,
      todayIncome,
      periodIncome,
      unpaidDebts,
    },
    studentStats,
    courseDist,
    paymentStatus,
    schedule,
    alerts,
    revenue: (revenuePeriod) => buildRevenueData(payments, expenses, revenuePeriod, now),
    availableRooms,
    occupiedRooms,
  };
}
