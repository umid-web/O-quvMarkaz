import { fail } from './http.js';

const objectCollections = new Set(['edu-attendance-v1', 'edu-settings-v1', 'edu-chat-presence-v1']);
const scalarCollections = new Set(['edu-schedule-rooms-v1']);
const statuses = {
  'edu-students-v1': new Set(['active', 'frozen', 'graduated', 'dropped']),
  'edu-teachers-v1': new Set(['active', 'vacation', 'left']),
  'edu-support-teachers-v1': new Set(['active', 'vacation', 'left']),
  'edu-courses-v1': new Set(['active', 'archived']),
  'edu-groups-v1': new Set(['active', 'archived']),
};

function validateShape(value) {
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    if (++nodes > 100_000) throw fail(400, 'invalid_state', 'State contains too many values.');
    if (current.depth > 32) throw fail(400, 'invalid_state', 'State nesting is too deep.');
    if (!current.value || typeof current.value !== 'object') continue;
    const entries = Array.isArray(current.value) ? current.value : Object.entries(current.value);
    if (entries.length > 20_000) throw fail(400, 'invalid_state', 'A state section contains too many values.');
    for (const entry of entries) {
      const child = Array.isArray(current.value) ? entry : entry[1];
      if (typeof child === 'string' && child.length > 100_000) throw fail(400, 'invalid_state', 'A text value is too long.');
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function optionalString(record, field, max = 500) {
  const value = record[field];
  if (value !== undefined && (typeof value !== 'string' || value.length > max)) throw fail(400, 'invalid_record', `Field ${field} must be a string of at most ${max} characters.`);
}

function optionalNumber(record, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = record[field];
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)) throw fail(400, 'invalid_record', `Field ${field} must be a number between ${min} and ${max}.`);
}

function validateDomainRecord(key, record) {
  if (['edu-teachers-v1', 'edu-support-teachers-v1'].includes(key)) optionalString(record, 'level', 100);
  if (key === 'edu-chat-v1') {
    for (const field of ['channel', 'fromKey', 'fromName', 'fromRole']) {
      if (typeof record[field] !== 'string' || !record[field].trim() || record[field].length > 300) throw fail(400, 'invalid_message', `Chat field ${field} must be non-empty text.`);
    }
    if (typeof record.text !== 'string' || !record.text.trim() || record.text.length > 10_000) throw fail(400, 'invalid_message', 'Chat text must contain 1 to 10000 characters.');
    if (typeof record.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(record.createdAt) || !Number.isFinite(Date.parse(record.createdAt))) throw fail(400, 'invalid_message', 'Chat date must be a valid ISO timestamp.');
    const actorList = (list) => Array.isArray(list) && list.every((actor) => typeof actor === 'string' && actor.length > 0 && actor.length <= 300) && new Set(list).size === list.length;
    if (record.readBy !== undefined && !actorList(record.readBy)) throw fail(400, 'invalid_message', 'Chat readers must be unique actor keys.');
    if (record.reactions !== undefined && (!record.reactions || typeof record.reactions !== 'object' || Array.isArray(record.reactions) || Object.entries(record.reactions).some(([emoji, voters]) => !emoji.trim() || emoji.length > 32 || !actorList(voters)))) throw fail(400, 'invalid_message', 'Chat reactions must contain lists of unique actor keys.');
    optionalString(record, 'replyToId', 100);
  }
  optionalString(record, 'teacherType', 20);
  optionalString(record, 'newRoleName', 80);
  if (key === 'edu-salary-v1') {
    if (record.employeeType !== undefined && !['main', 'support', 'user'].includes(record.employeeType)) throw fail(400, 'invalid_record', 'Invalid employee type.');
    if (!['pay', 'advance', 'bonus', 'penalty'].includes(record.kind) || !Number.isSafeInteger(record.amount) || record.amount <= 0 || !record.teacherId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(record.month || '')) throw fail(400, 'invalid_record', 'Salary entries require an employee, month, kind and positive integer amount.');
  }
  optionalNumber(record, 'monthlySalary', { max: 1_000_000_000 });
  optionalString(record, 'subject', 300);
  for (const field of ['name', 'title', 'firstName', 'lastName', 'phone', 'parentPhone', 'address', 'course', 'group', 'note', 'date', 'period', 'method', 'category', 'room', 'start', 'end', 'email', 'login', 'roleId', 'teacherId', 'studentId', 'description', 'color', 'kind', 'month']) optionalString(record, field, field === 'note' || field === 'address' ? 2000 : 300);
  if (statuses[key] && record.status !== undefined && !statuses[key].has(record.status)) throw fail(400, 'invalid_record', `Invalid status for ${key}.`);
  if (key === 'edu-users-v1') {
    if (record.status !== undefined && !['active', 'blocked'].includes(record.status)) throw fail(400, 'invalid_record', 'User status must be active or blocked.');
    if (record.login && !/^[a-zA-Z0-9._-]{3,80}$/.test(record.login)) throw fail(400, 'invalid_record', 'User login format is invalid.');
  }
  if (key === 'edu-roles-v1' && record.permissions !== undefined && (!Array.isArray(record.permissions) || record.permissions.some((permission) => typeof permission !== 'string'))) throw fail(400, 'invalid_record', 'Role permissions must be a list of strings.');

  for (const field of ['id', 'code']) {
    const value = record[field];
    if (value !== undefined && !((typeof value === 'string' && value.length <= 100) || (typeof value === 'number' && Number.isSafeInteger(value)))) throw fail(400, 'invalid_record', `Field ${field} must be a string or safe integer of at most 100 characters.`);
  }

  for (const field of ['amount', 'fee', 'monthlyFee', 'debt', 'salaryValue', 'experience', 'capacity', 'attendance']) {
    optionalNumber(record, field, { max: field === 'attendance' ? 100 : Number.MAX_SAFE_INTEGER });
  }
  for (const field of ['groups', 'subjects']) {
    if (record[field] !== undefined && (!Array.isArray(record[field]) || record[field].some((item) => typeof item !== 'string' || !item.trim() || item.length > 300) || new Set(record[field]).size !== record[field].length)) throw fail(400, 'invalid_record', `Field ${field} must be a list of unique non-empty strings.`);
  }
  if (key === 'edu-students-v1' && record.gender !== undefined && !['male', 'female'].includes(record.gender)) throw fail(400, 'invalid_record', 'Student gender must be male or female.');
  if (key === 'edu-groups-v1' && record.days !== undefined && (!Array.isArray(record.days) || record.days.some((day) => !Number.isInteger(day) || day < 1 || day > 6) || new Set(record.days).size !== record.days.length)) throw fail(400, 'invalid_record', 'Group days must be unique weekdays from 1 to 6.');
  if (key === 'edu-payments-v1' && record.amount !== undefined && record.amount <= 0) throw fail(400, 'invalid_record', 'Payment amount must be greater than zero.');
  if (key === 'edu-expenses-v1' && record.amount !== undefined && record.amount <= 0) throw fail(400, 'invalid_record', 'Expense amount must be greater than zero.');
}

export function validateCollection(key, value) {
  validateShape(value);
  if (objectCollections.has(key)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'invalid_state', 'This collection must be a JSON object.');
    if (key === 'edu-settings-v1' && value.security !== undefined) {
      const security = value.security;
      if (!security || typeof security !== 'object' || Array.isArray(security)) throw fail(400, 'invalid_state', 'Security settings must be an object.');
      if (security.sessionMinutes !== undefined && (!Number.isInteger(security.sessionMinutes) || security.sessionMinutes < 15 || security.sessionMinutes > 480)) throw fail(400, 'invalid_state', 'Session timeout must be 15 to 480 minutes.');
      if (security.passwordMinLength !== undefined && (!Number.isInteger(security.passwordMinLength) || security.passwordMinLength < 6 || security.passwordMinLength > 16)) throw fail(400, 'invalid_state', 'Minimum password length must be 6 to 16 characters.');
      for (const field of ['twoFactor', 'loginAlerts']) if (security[field] !== undefined && typeof security[field] !== 'boolean') throw fail(400, 'invalid_state', `${field} must be a boolean.`);
    }
    return value;
  }
  if (!Array.isArray(value)) throw fail(400, 'invalid_state', 'This collection must be a list.');
  if (scalarCollections.has(key)) {
    if (value.some((item) => typeof item !== 'string' || item.trim() === '') || new Set(value).size !== value.length) throw fail(400, 'invalid_state', 'Room names must be non-empty and unique.');
    return value;
  }
  const ids = new Set();
  for (const record of value) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw fail(400, 'invalid_record', 'Each collection item must be an object.');
    const id = record.id ?? record.code;
    if ((typeof id !== 'string' && typeof id !== 'number') || String(id).trim() === '') throw fail(400, 'invalid_record', 'Each record must have a non-empty id or code.');
    const normalizedId = String(id);
    if (ids.has(normalizedId)) throw fail(400, 'duplicate_record', 'Record ids and codes must be unique.');
    ids.add(normalizedId);
    validateDomainRecord(key, record);
  }
  return value;
}
