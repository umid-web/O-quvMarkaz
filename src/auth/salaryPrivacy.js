import { sessionIdentity } from '../api/memoryStore.js';
export function canSeeEmployeeSalary(type, id) {
  if (sessionIdentity.getItem('educontrol_logged_in') !== 'true') return true;
  if (['owner', 'admin'].includes(sessionIdentity.getItem('educontrol_role'))) return true;
  if (type === 'user') return !!id && id === sessionIdentity.getItem('educontrol_user_id');
  return !!id && sessionIdentity.getItem('educontrol_role') === 'teacher'
    && type === (sessionIdentity.getItem('educontrol_teacher_type') || 'main')
    && id === sessionIdentity.getItem('educontrol_teacher_id');
}
