export const employeeKey = (type, id) => type === 'main' ? String(id) : `${type}:${id}`;
export const entryMatchesEmployee = (entry, person) => String(entry.teacherId) === String(person.recordId ?? person.id) && (entry.employeeType || 'main') === (person.employeeType || 'main');

export function buildPayroll({ teachers = [], supportTeachers = [], users = [], students = [], groups = [], roles = [], payments = [], month = new Date().toISOString().slice(0, 7) }) {
  const result = [];
  for (const [list, type] of [[teachers, 'main'], [supportTeachers, 'support']]) {
    for (const person of list.filter((item) => item.status !== 'left')) {
      const assigned = person.groups || [];
      const revenue = payments.filter((payment) => String(payment.date || '').slice(0, 7) === month && assigned.includes(payment.group || students.find((s) => s.id === payment.studentId)?.group)).reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) || 0), 0);
      const lessons = assigned.reduce((sum, code) => sum + (groups.find((group) => group.code === code)?.days?.length || 0), 0) * 4;
      const base = type === 'support'
        ? (Number(person.payValue) || 0) * (person.payType === 'perLesson' ? lessons : 1)
        : person.salaryType === 'percent' ? Math.round(revenue * (Number(person.salaryValue) || 0) / 100) : Number(person.salaryValue) || 0;
      result.push({ id: employeeKey(type, person.id), recordId: person.id, employeeType: type, firstName: person.firstName, lastName: person.lastName, subjects: person.subjects || [], salaryType: type === 'main' ? person.salaryType : person.payType, salaryValue: type === 'main' ? person.salaryValue : person.payValue, base, roleName: type === 'main' ? 'O‘qituvchi' : 'Qo‘shimcha o‘qituvchi' });
    }
  }
  for (const user of users) {
    if (user.status !== 'active' || user.roleId === 'owner' || user.monthlySalary === undefined) continue;
    const linked = user.roleId === 'teacher' && result.some((item) => item.recordId === user.teacherId && item.employeeType === (user.teacherType || 'main'));
    if (linked || (user.roleId === 'teacher' && user.teacherId)) continue;
    result.push({ id: employeeKey('user', user.id), recordId: user.id, employeeType: 'user', firstName: user.firstName, lastName: user.lastName, subjects: [], salaryType: 'fixed', salaryValue: user.monthlySalary, base: user.monthlySalary, roleName: roles.find((role) => role.id === user.roleId)?.name || user.roleId });
  }
  return result;
}
