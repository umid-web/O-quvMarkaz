import { memoryCache, sessionIdentity } from '../../../api/memoryStore.js';
import { loadTeachers } from '../teachers/teachersStore';
import { loadSupportTeachers } from '../support-teachers/supportStore';
import { loadUsers } from '../users-roles/usersStore';

export const CHAT_STORAGE_KEY = 'edu-chat-v1';

export const getCurrentChatActorKey = () => {
  const role = sessionIdentity.getItem('educontrol_role') || 'admin';
  const userId = sessionIdentity.getItem('educontrol_user_id');
  const user = loadUsers().find((item) => item.id === userId);
  if (user) {
    if (user.roleId === 'teacher') {
      const support = user.teacherType === 'support';
      const teachers = support ? loadSupportTeachers() : loadTeachers();
      const teacher = teachers.find((item) => item.id === user.teacherId);
      if (teacher) return `${support ? 'support' : 'teacher'}:${teacher.id}`;
    }
    return `user:${user.id}`;
  }
  const teacherId = sessionIdentity.getItem('educontrol_teacher_id');
  if (role === 'teacher' && teacherId) return `${sessionIdentity.getItem('educontrol_teacher_type') === 'support' ? 'support' : 'teacher'}:${teacherId}`;
  if (userId) return `user:${userId}`;
  return `${role}:${sessionIdentity.getItem('educontrol_username') || role}`;
};

export const getUnreadChatCount = (actorKey) => {
  try {
    const messages = JSON.parse(memoryCache.getItem(CHAT_STORAGE_KEY)) || [];
    return messages.filter((message) => message.fromKey !== actorKey && !message.readBy?.includes(actorKey)).length;
  } catch { return 0; }
};
