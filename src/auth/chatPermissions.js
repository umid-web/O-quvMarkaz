export const CHAT_PERMISSIONS = ['chat.view', 'chat.create', 'chat.edit'];
export const DEFAULT_EMPLOYEE_PERMISSIONS = ['dashboard.view', ...CHAT_PERMISSIONS,
  'notifications.view', 'notifications.create', 'notifications.edit', 'notifications.delete',
  'activity.view', 'activity.create', 'activity.export'];
export const withEmployeeChat = (permissions = []) => [...new Set([...permissions, ...CHAT_PERMISSIONS])];
