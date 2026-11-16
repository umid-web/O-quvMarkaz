export const ACCOUNT_OPTIONS = [
  { name: 'Admin', roleId: 'admin', teacherType: '' },
  { name: 'O‘qituvchi', roleId: 'teacher', teacherType: 'main' },
  { name: 'Qo‘shimcha o‘qituvchi', roleId: 'teacher', teacherType: 'support' },
  { name: 'Qabul xodimi', roleId: 'reception', teacherType: '' },
];
const normalized = (value) => String(value || '').trim().toLocaleLowerCase('uz').replace(/[‘’ʻʼ`]/g, "'");
export function resolveAccountOption(text, roles) {
  const choice = ACCOUNT_OPTIONS.find((item) => normalized(item.name) === normalized(text));
  if (choice) return choice;
  const role = roles.find((item) => normalized(item.name) === normalized(text) || normalized(item.id) === normalized(text));
  return role ? { name: role.name, roleId: role.id, teacherType: role.id === 'teacher' ? 'main' : '' } : { name: text.trim(), roleId: '', teacherType: '', newRoleName: text.trim() };
}
export function accountOptionLabel(user, roles) {
  if (!user) return 'Admin';
  return ACCOUNT_OPTIONS.find((item) => item.roleId === user.roleId && (user.roleId !== 'teacher' || item.teacherType === (user.teacherType || 'main')))?.name || roles.find((item) => item.id === user.roleId)?.name || '';
}
