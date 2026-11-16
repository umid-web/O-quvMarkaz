import { db } from './database.js';
import { fail } from './http.js';
import { teacherCollection } from './teacherAccounts.js';
import { redactSalary } from './salaryPrivacy.js';

export const collections = new Map([
  ['edu-students-v1', 'students'], ['edu-teachers-v1', 'teachers'],
  ['edu-support-teachers-v1', 'support-teachers'], ['edu-courses-v1', 'courses'],
  ['edu-groups-v1', 'groups'], ['edu-schedule-rooms-v1', 'schedule'],
  ['edu-attendance-v1', 'attendance'], ['edu-payments-v1', 'payments'],
  ['edu-expenses-v1', 'expenses'], ['edu-salary-v1', 'salaries'],
  ['edu-users-v1', 'users-roles'], ['edu-roles-v1', 'users-roles'],
  ['edu-settings-v1', 'settings'], ['edu-notifications-v1', 'notifications'],
  ['edu-activity-v1', 'activity'], ['edu-chat-v1', 'chat'], ['edu-chat-presence-v1', 'chat'],
]);

export const allPermissions = [
  'dashboard.view',
  'students.view', 'students.create', 'students.edit', 'students.delete', 'students.export',
  'teachers.view', 'teachers.create', 'teachers.edit', 'teachers.delete', 'teachers.export',
  'support-teachers.view', 'support-teachers.create', 'support-teachers.edit', 'support-teachers.delete', 'support-teachers.export',
  'courses.view', 'courses.create', 'courses.edit', 'courses.delete',
  'groups.view', 'groups.create', 'groups.edit', 'groups.delete',
  'schedule.view', 'schedule.create', 'schedule.edit', 'schedule.delete',
  'attendance.view', 'attendance.edit', 'attendance.export',
  'finance.view', 'finance.export',
  'payments.view', 'payments.create', 'payments.edit', 'payments.delete', 'payments.export',
  'debts.view', 'debts.export',
  'expenses.view', 'expenses.create', 'expenses.edit', 'expenses.delete', 'expenses.export',
  'salaries.view', 'salaries.create', 'salaries.edit', 'salaries.delete',
  'reports.view', 'reports.export',
  'notifications.view', 'notifications.create', 'notifications.edit', 'notifications.delete',
  'users-roles.view', 'users-roles.create', 'users-roles.edit', 'users-roles.delete',
  'settings.view', 'settings.edit',
  'activity.view', 'activity.create', 'activity.export',
  'chat.view', 'chat.create', 'chat.edit',
];
export const validPermissions = new Set(allPermissions);

export function roleFor(account) {
  if (account.role_id === 'owner') return { id: 'owner', name: 'Super admin', permissions: allPermissions };
  const row = db.prepare("SELECT value FROM app_state WHERE key = 'edu-roles-v1'").get();
  let roles = [];
  try { roles = row ? JSON.parse(row.value) : []; } catch { /* invalid legacy record */ }
  const role = roles.find((role) => role.id === account.role_id) ?? { id: account.role_id, name: account.role_id, permissions: [] };
  return { ...role, permissions: role.permissions ?? [] };
}

export function accountProfile(account) {
  const row = db.prepare("SELECT value FROM app_state WHERE key = 'edu-users-v1'").get();
  try { return (row ? JSON.parse(row.value) : []).find((user) => user.id === account.id) ?? null; }
  catch { return null; }
}

export function chatTeacherProfile(account) {
  const profile = accountProfile(account);
  if (account.role_id !== 'teacher' || !profile) return null;
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(teacherCollection(profile.teacherType));
  try {
    const teachers = row ? JSON.parse(row.value) : [];
    return teachers.find((item) => item.id === profile.teacherId) || null;
  } catch { return null; }
}

export function teacherGroupCodes(account) {
  const profile = accountProfile(account);
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(teacherCollection(profile?.teacherType));
  try {
    const teachers = row ? JSON.parse(row.value) : [];
    return new Set(teachers.find((item) => item.id === profile?.teacherId)?.groups ?? []);
  } catch { return new Set(); }
}

export function chatActorKey(account) {
  const profile = accountProfile(account);
  const teacher = chatTeacherProfile(account);
  if (teacher) return `${profile.teacherType === 'support' ? 'support' : 'teacher'}:${teacher.id}`;
  if (profile) return `user:${account.id}`;
  return `user:${account.id}`;
}

function privateChatReaders() {
  return new Set(db.prepare("SELECT id FROM accounts WHERE role_id = 'owner'").all().map((account) => `user:${account.id}`));
}

export function scopedState(account, key, value) {
  return redactSalary(account, key, scopeCollection(account, key, value));
}

function scopeCollection(account, key, value) {
  if (key === 'edu-settings-v1' && !can(account, 'settings', 'view')) {
    return Object.fromEntries(['org', 'appearance', 'finance', 'attendance', 'meta'].filter((section) => value?.[section] !== undefined).map((section) => [section, value[section]]));
  }
  if (key === 'edu-activity-v1' && Array.isArray(value)) return value.filter((entry) => activityVisible(account, entry));
  if (key === 'edu-notifications-v1' && Array.isArray(value)) {
    return value.filter((item) => notificationVisible(account, item) && !item.hiddenFor?.includes(account.id))
      .map((item) => ({ ...item, read: item.readState?.[account.id] ?? item.read ?? false }));
  }
  if (key === 'edu-chat-v1' && Array.isArray(value)) {
    const actorKey = chatActorKey(account);
    const hidden = privateChatReaders();
    return value.filter((message) => message.channel === 'general' || (message.channel?.startsWith('direct:') && message.channel.slice(7).split('|').includes(actorKey)))
      .map((message) => ({ ...message, readBy: (message.readBy ?? []).filter((reader) => !hidden.has(reader) || reader === actorKey) }));
  }
  if (account.role_id !== 'teacher') return value;
  // These collections are also sent as private dependencies of the default
  // teacher dashboard. An explicit view grant opens their management page.
  if (['edu-teachers-v1', 'edu-support-teachers-v1', 'edu-users-v1'].includes(key)
    && can(account, collections.get(key), 'view')) return value;
  // Explicit management grants enable the same module operations as other roles.
  // Without these grants the teacher's default personal data scope stays intact.
  if (key !== 'edu-attendance-v1' && teacherManagesCollection(account, key)) return value;
  const groups = teacherGroupCodes(account);
  if (key === 'edu-attendance-v1') return Object.fromEntries(Object.entries(value ?? {}).filter(([lessonKey]) => groups.has(lessonKey.split('|')[0])));
  if (!Array.isArray(value)) return value;
  if (key === 'edu-users-v1') return value.filter((user) => user.id === account.id);
  if (key === 'edu-teachers-v1' || key === 'edu-support-teachers-v1') {
    const profile = accountProfile(account);
    if (key !== teacherCollection(profile?.teacherType)) return [];
    return value.filter((teacher) => teacher.id === profile?.teacherId).map(({ id, firstName, lastName, subjects, groups: assignedGroups, status, salary, salaryType, salaryValue, payType, payValue }) => ({ id, firstName, lastName, subjects, groups: assignedGroups, status, salary, salaryType, salaryValue, payType, payValue }));
  }
  if (key === 'edu-groups-v1') return value.filter((group) => groups.has(group.code));
  if (key === 'edu-students-v1') return value.filter((student) => groups.has(student.group));
  if (key === 'edu-payments-v1') {
    const row = db.prepare("SELECT value FROM app_state WHERE key = 'edu-students-v1'").get();
    let studentIds = new Set();
    try { studentIds = new Set((row ? JSON.parse(row.value) : []).filter((student) => groups.has(student.group)).map((student) => student.id)); } catch { /* invalid legacy record */ }
    return value.filter((payment) => studentIds.has(payment.studentId));
  }
  if (key === 'edu-salary-v1') {
    const profile = accountProfile(account);
    const type = profile?.teacherId ? profile.teacherType || 'main' : 'user';
    return value.filter((entry) => entry.teacherId === (profile?.teacherId || account.id) && (entry.employeeType || 'main') === type);
  }
  return value;
}

export function mergeTeacherWrite(account, key, incoming, current) {
  if (key === 'edu-groups-v1' && !can(account, 'groups', 'edit') && can(account, 'schedule', 'edit')) {
    if (!Array.isArray(incoming) || !Array.isArray(current)) throw fail(400, 'invalid_state', 'Groups must be a list.');
    const visible = new Set(scopedState(account, key, current).map((group) => group.code));
    const previous = new Map(current.map((group) => [group.code, group]));
    const updates = new Map();
    const metadata = ({ days: _days, start: _start, end: _end, room: _room, ...group }) => group;
    for (const group of incoming) {
      if (!visible.has(group.code) || !previous.has(group.code) || JSON.stringify(metadata(group)) !== JSON.stringify(metadata(previous.get(group.code)))) throw fail(403, 'forbidden', 'Schedule permission only allows changes to existing lesson days, times and rooms.');
      updates.set(group.code, group);
    }
    return current.map((group) => updates.get(group.code) || group);
  }
  if (key === 'edu-activity-v1') return mergeActivities(account, incoming, current);
  if (key === 'edu-notifications-v1') return mergeNotifications(account, incoming, current);
  const actorKey = chatActorKey(account);
  if (key === 'edu-chat-presence-v1') {
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) || !current || typeof current !== 'object' || Array.isArray(current)) throw fail(400, 'invalid_state', 'Invalid chat presence state.');
    for (const otherKey of new Set([...Object.keys(current), ...Object.keys(incoming)])) {
      if (otherKey !== actorKey && JSON.stringify(current[otherKey]) !== JSON.stringify(incoming[otherKey])) throw fail(403, 'forbidden', 'A user cannot change another user presence.');
    }
    const result = { ...current };
    if (Object.hasOwn(incoming, actorKey)) result[actorKey] = incoming[actorKey];
    else delete result[actorKey];
    return result;
  }
  if (key === 'edu-attendance-v1') {
    if (account.role_id !== 'teacher') return incoming;
    const groups = teacherGroupCodes(account);
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) || !current || typeof current !== 'object' || Array.isArray(current)) throw fail(400, 'invalid_state', 'Invalid attendance state.');
    const result = { ...current };
    for (const [lessonKey, value] of Object.entries(incoming)) {
      if (!groups.has(lessonKey.split('|')[0])) throw fail(403, 'forbidden', 'Teacher cannot edit attendance outside assigned groups.');
      result[lessonKey] = value;
    }
    return result;
  }
  if (key === 'edu-chat-v1') {
    if (!Array.isArray(incoming) || !Array.isArray(current)) throw fail(400, 'invalid_state', 'Invalid chat messages.');
    const hiddenReaders = privateChatReaders();
    const validChannel = (message) => {
      if (message.channel === 'general') return true;
      if (!message.channel?.startsWith('direct:')) return false;
      const participants = message.channel.slice(7).split('|');
      return participants.length === 2 && participants.includes(actorKey);
    };
    const nextById = new Map();
    for (const message of incoming) {
      if (!message || typeof message !== 'object' || !message.id || !validChannel(message)) throw fail(403, 'forbidden', 'Chat access is limited to valid channels.');
      if (nextById.has(String(message.id))) throw fail(400, 'duplicate_record', 'Duplicate chat message id.');
      nextById.set(String(message.id), message);
    }
    const result = current.map((message) => {
      const update = nextById.get(String(message.id));
      if (!update) return message;
      nextById.delete(String(message.id));
      if (update.pinned !== undefined && typeof update.pinned !== 'boolean') throw fail(400, 'invalid_pin', 'Pinned must be a boolean.');
      const pinChanged = Number(update.pinRevision || 0) > Number(message.pinRevision || 0);
      const textChanged = Number(update.editRevision || 0) > Number(message.editRevision || 0);
      if (pinChanged && (update.pinRevision !== (message.pinRevision || 0) + 1 || !can(account, 'chat', 'edit'))) throw fail(403, 'forbidden', 'Chat edit permission required to pin messages.');
      if (textChanged && (update.editRevision !== (message.editRevision || 0) + 1 || message.fromKey !== actorKey || !can(account, 'chat', 'edit') || typeof update.text !== 'string' || !update.text.trim() || update.text.length > 10000)) throw fail(403, 'forbidden', 'Only the sender can edit their message.');
      if (update.text !== message.text && !textChanged && Number(update.editRevision || 0) >= Number(message.editRevision || 0)) throw fail(403, 'forbidden', 'Invalid message edit.');
      for (const field of ['channel', 'fromKey', 'fromName', 'fromRole', 'createdAt', 'replyToId']) {
        if (JSON.stringify(update[field]) !== JSON.stringify(message[field])) throw fail(403, 'forbidden', 'Chat message content cannot be changed.');
      }
      const previousReaders = new Set(message.readBy ?? []);
      const nextReaders = new Set(update.readBy ?? message.readBy ?? []);
      const publicOthers = (readers) => [...readers].filter((key) => key !== actorKey && !hiddenReaders.has(key)).sort();
      if ([...nextReaders].some((key) => hiddenReaders.has(key) && key !== actorKey && !previousReaders.has(key))
        || JSON.stringify(publicOthers(previousReaders)) !== JSON.stringify(publicOthers(nextReaders))) throw fail(403, 'forbidden', 'A user can only change their own read status.');
      const previousReactions = message.reactions ?? {};
      const nextReactions = update.reactions ?? previousReactions;
      for (const emoji of new Set([...Object.keys(previousReactions), ...Object.keys(nextReactions)])) {
        const previousVoters = new Set(previousReactions[emoji] ?? []);
        const nextVoters = new Set(nextReactions[emoji] ?? []);
        if (JSON.stringify([...previousVoters].filter((key) => key !== actorKey).sort()) !== JSON.stringify([...nextVoters].filter((key) => key !== actorKey).sort())) throw fail(403, 'forbidden', 'A user can only change their own reaction.');
      }
      const readers = [...new Set([...nextReaders].filter((key) => !hiddenReaders.has(key) || key === actorKey).concat([...previousReaders].filter((key) => hiddenReaders.has(key) && key !== actorKey)))];
      return { ...message, ...(pinChanged ? { pinned: update.pinned, pinRevision: update.pinRevision } : {}), ...(textChanged ? { text: update.text.trim(), editRevision: update.editRevision, editedAt: new Date().toISOString() } : {}), readBy: readers, reactions: update.reactions ?? message.reactions };
    });
    for (const message of nextById.values()) {
      if (!can(account, 'chat', 'create')) throw fail(403, 'forbidden', 'Chat create permission required.');
      if (message.replyToId !== undefined && (typeof message.replyToId !== 'string' || !current.some((original) => original.id === message.replyToId && original.channel === message.channel))) throw fail(400, 'invalid_reply', 'Javob faqat shu suhbatdagi mavjud xabarga yozilishi mumkin.');
      const profile = accountProfile(account);
      const usersName = profile ? `${profile.firstName} ${profile.lastName}`.trim() : account.username;
      const teacher = chatTeacherProfile(account);
      const expectedName = teacher ? `${teacher.firstName} ${teacher.lastName}`.trim() : usersName;
      const expectedRole = roleFor(account).name;
      if (message.fromKey !== actorKey || message.fromName !== expectedName || message.fromRole !== expectedRole
        || (message.readBy?.length && message.readBy.some((reader) => reader !== actorKey))
        || Object.keys(message.reactions ?? {}).length) throw fail(403, 'forbidden', 'Users can only send a new message as themselves.');
      result.push(message);
    }
    return result;
  }
  if (account.role_id !== 'teacher') return incoming;
  if (['edu-students-v1', 'edu-teachers-v1', 'edu-support-teachers-v1', 'edu-users-v1', 'edu-groups-v1', 'edu-payments-v1', 'edu-salary-v1'].includes(key) && !teacherManagesCollection(account, key)) {
    throw fail(403, 'forbidden', 'Teacher access to this collection is read-only.');
  }
  return incoming;
}

export function teacherManagesCollection(account, key) {
  const module = collections.get(key);
  return !!module && ['create', 'edit', 'delete'].some((action) => can(account, module, action));
}

export const can = (account, module, action) => {
  const role = roleFor(account);
  if (module === 'activity' && ['edit', 'delete'].includes(action)) return role.id === 'owner' || (role.id === 'admin' && role.permissions?.includes('activity.view'));
  return role.id === 'owner' || role.permissions?.includes(`${module}.${action}`) === true;
};

export function activityVisible(account, entry) {
  if (['owner', 'admin'].includes(account.role_id) || entry.actor?.id === account.id) return true;
  const targets = [entry.entityId, ...(entry.items || []).map((item) => item.id)];
  if (['users', 'users-roles'].includes(entry.module) && targets.includes(account.id)) return true;
  if (entry.module === 'roles' && targets.includes(account.role_id)) return true;
  const reference = { module: entry.module, entityId: entry.entityId };
  if (entry.module === 'salaries') return notificationVisible(account, reference);
  // Teachers may also inspect changes to their own profile, groups and students.
  if (account.role_id === 'teacher' && !entry.items?.length) return notificationVisible(account, reference);
  return false;
}

function mergeActivities(account, incoming, current) {
  if (!Array.isArray(incoming) || !Array.isArray(current)) throw fail(400, 'invalid_state', 'Activity history must be a list.');
  if (['owner', 'admin'].includes(account.role_id)) return incoming;
  const existing = new Map(current.map((entry) => [entry.id, entry]));
  const seen = new Set();
  const added = [];
  for (const entry of incoming) {
    if (seen.has(entry.id)) throw fail(400, 'duplicate_record', 'Duplicate activity id.');
    seen.add(entry.id);
    const previous = existing.get(entry.id);
    if (previous) {
      if (!activityVisible(account, previous) || JSON.stringify(previous) !== JSON.stringify(entry)) throw fail(403, 'forbidden', 'Activity history cannot be rewritten.');
    } else {
      if (entry.actor?.id !== account.id || entry.actor?.name !== account.username || entry.actor?.role !== account.role_id) throw fail(403, 'forbidden', 'Activity can only be recorded as the current account.');
      added.push(entry);
    }
  }
  // Missing records belong to a scoped/truncated cache; preserve all history.
  return [...added, ...current];
}

function storedList(key) {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key);
  try { const value = row ? JSON.parse(row.value) : []; return Array.isArray(value) ? value : []; }
  catch { return []; }
}

// Explicit recipients take priority. Otherwise staff receive events for their
// permitted modules; teachers are additionally restricted to their own records.
export function notificationVisible(account, item) {
  if (['owner', 'admin'].includes(account.role_id)) return true;
  if (Array.isArray(item.recipientIds)) return item.recipientIds.includes(account.id);
  const activity = item.activityId ? storedList('edu-activity-v1').find((entry) => entry.id === item.activityId) : null;
  const aliases = { users: 'users-roles', roles: 'users-roles' };
  const section = item.module || activity?.module || item.link?.match(/^\/(?:admin|reception|teacher)\/([^/?#]+)/)?.[1];
  const module = aliases[section] || section;
  const entityId = item.entityId || activity?.entityId;
  if (!module || !can(account, module, 'view')) return false;
  const profile = accountProfile(account);
  if (module === 'salaries') {
    const salary = storedList('edu-salary-v1').find((entry) => entry.id === entityId);
    return !!salary && salary.teacherId === (profile?.teacherId || account.id)
      && (salary.employeeType || 'main') === (profile?.teacherId ? profile.teacherType || 'main' : 'user');
  }
  if (account.role_id !== 'teacher') return true;
  if (!entityId) return false; // Never expose aggregate alerts for other groups.
  const groups = teacherGroupCodes(account);
  if (['groups', 'attendance', 'schedule'].includes(module)) return groups.has(entityId);
  if (module === 'students') return storedList('edu-students-v1').some((entry) => entry.id === entityId && groups.has(entry.group));
  if (module === 'payments') {
    const payment = storedList('edu-payments-v1').find((entry) => entry.id === entityId);
    return !!payment && storedList('edu-students-v1').some((entry) => entry.id === payment.studentId && groups.has(entry.group));
  }
  if (['teachers', 'support-teachers'].includes(module)) return entityId === profile?.teacherId && module === (profile?.teacherType === 'support' ? 'support-teachers' : 'teachers');
  return false;
}

function mergeNotifications(account, incoming, current) {
  if (!Array.isArray(incoming) || !Array.isArray(current)) throw fail(400, 'invalid_state', 'Notifications must be a list.');
  const remaining = new Map(incoming.map((item) => [item.id, item]));
  if (remaining.size !== incoming.length) throw fail(400, 'duplicate_record', 'Duplicate notification id.');
  const content = ({ read: _read, readState: _readState, hiddenFor: _hiddenFor, ...item }) => item;
  const result = current.map((item) => {
    const update = remaining.get(item.id);
    remaining.delete(item.id);
    if (!notificationVisible(account, item)) {
      if (update) throw fail(403, 'forbidden', 'Notification is not addressed to this account.');
      return item;
    }
    if (!update) return { ...item, hiddenFor: [...new Set([...(item.hiddenFor || []), account.id])] };
    if (JSON.stringify(content(update)) !== JSON.stringify(content(item))) throw fail(403, 'forbidden', 'Notification content cannot be changed.');
    return { ...item, readState: { ...item.readState, [account.id]: !!update.read }, hiddenFor: (item.hiddenFor || []).filter((id) => id !== account.id) };
  });
  for (const item of remaining.values()) {
    if (!notificationVisible(account, item)) throw fail(403, 'forbidden', 'Notification is outside this account scope.');
    result.push({ ...content(item), read: false, readState: { [account.id]: !!item.read }, hiddenFor: [] });
  }
  return result;
}
