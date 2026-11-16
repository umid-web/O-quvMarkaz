import { db } from './database.js';
import { BODY_LIMIT, fail, json, readBody } from './http.js';
import { collections, can, scopedState } from './permissions.js';
import { writeAudit } from './audit.js';
import { validateCollection } from './validation.js';
import { readStoredData, writeStoredData } from './dataStore.js';
import { preservePrivateSalary, ownsSalary, canSeeAllSalaries } from './salaryPrivacy.js';

const getRows = (key) => db.prepare('SELECT version FROM app_state WHERE key = ?').get(key);
const recordId = (record) => record && (record.id ?? record.code);
const nonRecordKeys = new Set(['edu-attendance-v1', 'edu-settings-v1', 'edu-chat-presence-v1', 'edu-schedule-rooms-v1']);
const decodeSegment = (value) => {
  try { return decodeURIComponent(value); }
  catch { throw fail(400, 'invalid_path', 'Collection path is invalid.'); }
};

function listRecords(records, params) {
  const query = params.get('q')?.trim().toLocaleLowerCase() || '';
  const status = params.get('status');
  if (query.length > 300) throw fail(400, 'invalid_query', 'Search must be at most 300 characters.');
  const integerParam = (name, fallback, max) => {
    if (!params.has(name)) return fallback;
    const raw = params.get(name);
    const value = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(value) || value > max) throw fail(400, 'invalid_query', `${name} must be an integer between 1 and ${max}.`);
    return value;
  };
  const paginated = params.has('page') || params.has('limit');
  const page = integerParam('page', 1, Number.MAX_SAFE_INTEGER);
  const limit = integerParam('limit', 50, 200);
  const filtered = records.filter((record) => {
    if (status !== null && record.status !== status) return false;
    if (!query) return true;
    return ['id', 'code', 'name', 'title', 'firstName', 'lastName', 'phone', 'parentPhone', 'email', 'group', 'course', 'studentId', 'teacherId', 'description', 'category']
      .some((field) => record[field] !== undefined && String(record[field]).toLocaleLowerCase().includes(query))
      || `${record.firstName || ''} ${record.lastName || ''}`.toLocaleLowerCase().includes(query);
  });
  if (!paginated) return { records: filtered };
  const offset = (page - 1) * limit;
  return {
    records: filtered.slice(offset, offset + limit),
    pagination: { page, limit, total: filtered.length, totalPages: Math.ceil(filtered.length / limit) },
  };
}
function saveRows(key, rows, version, actor, module, action, id) {
  const nextVersion = version + 1;
  const encoded = JSON.stringify(rows);
  if (Buffer.byteLength(encoded) > BODY_LIMIT) throw fail(413, 'payload_too_large', 'Collection is too large.');
  writeStoredData(key, rows, nextVersion, actor.id);
  writeAudit(actor, module, action, `${module} record ${action}`, String(id));
  return nextVersion;
}

export async function handleRecordRequest(req, res, url, account) {
  const match = url.pathname.match(/^\/api\/records\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return null;
  const key = decodeSegment(match[1]);
  const id = match[2] === undefined ? undefined : decodeSegment(match[2]);
  const module = collections.get(key);
  if (!module) throw fail(404, 'unknown_collection', 'Collection not found.');
  if (nonRecordKeys.has(key)) throw fail(409, 'not_a_record_list', 'This collection uses the state API, not record CRUD.');
  if (key === 'edu-users-v1' || key === 'edu-roles-v1') throw fail(409, 'managed_collection', 'Accounts and roles must be changed through /api/state.');
  if (key === 'edu-chat-v1' && req.method !== 'GET') throw fail(409, 'managed_collection', 'Chat messages must be changed through /api/state.');
  if (key === 'edu-notifications-v1' && req.method !== 'GET') throw fail(409, 'managed_collection', 'Notifications must be changed through /api/state.');
  if (key === 'edu-activity-v1' && req.method !== 'GET') throw fail(409, 'managed_collection', 'Activity history must be changed through /api/state.');

  if (req.method === 'GET') {
    const teacherScoped = account.role_id === 'teacher' && ['edu-students-v1', 'edu-teachers-v1', 'edu-support-teachers-v1', 'edu-groups-v1', 'edu-payments-v1', 'edu-salary-v1'].includes(key);
    if (!can(account, module, 'view') && !teacherScoped) throw fail(403, 'forbidden', 'View permission required.');
    const { value: records, version } = readStoredData(key);
    if (!Array.isArray(records)) throw fail(409, 'invalid_state', 'Stored collection is not a list.');
    const visible = scopedState(account, key, records);
    if (id !== undefined) {
      const record = visible.find((item) => String(recordId(item)) === id);
      if (!record) throw fail(404, 'record_not_found', 'Record not found.');
      return json(res, 200, { record, version });
    }
    return json(res, 200, { ...listRecords(visible, url.searchParams), version });
  }

  if (req.method === 'POST' && id === undefined) {
    if (!can(account, module, 'create')) throw fail(403, 'forbidden', 'Create permission required.');
    let { record } = await readBody(req);
    if (!record || typeof record !== 'object' || Array.isArray(record) || recordId(record) === undefined || recordId(record) === null) throw fail(400, 'invalid_record', 'Record must be an object with an id or code.');
    validateCollection(key, [record]);
    readStoredData(key);
    db.exec('BEGIN IMMEDIATE');
    let committed = false;
    try {
      const row = getRows(key);
      const current = readStoredData(key).value;
      if (!Array.isArray(current)) throw fail(409, 'invalid_state', 'Stored collection is not a list.');
      record = preservePrivateSalary(account, key, [record], [])[0];
      if (current.some((item) => String(recordId(item)) === String(recordId(record)))) throw fail(409, 'duplicate_record', 'Record id already exists.');
      const version = saveRows(key, [...current, record], row?.version ?? 0, account, module, 'create', recordId(record));
      db.exec('COMMIT');
      committed = true;
      return json(res, 201, { record: scopedState(account, key, [record])[0], version });
    } finally { if (!committed) db.exec('ROLLBACK'); }
  }

  if (req.method === 'PUT' && id !== undefined) {
    if (!can(account, module, 'edit')) throw fail(403, 'forbidden', 'Edit permission required.');
    let { record, version } = await readBody(req);
    if (!record || typeof record !== 'object' || Array.isArray(record) || String(recordId(record)) !== id) throw fail(400, 'invalid_record', 'Record id must match the URL.');
    validateCollection(key, [record]);
    readStoredData(key);
    db.exec('BEGIN IMMEDIATE');
    let committed = false;
    try {
      const row = getRows(key);
      if ((row?.version ?? 0) !== version) throw fail(409, 'version_conflict', 'Collection changed. Reload and try again.');
      const current = readStoredData(key).value;
      if (!Array.isArray(current)) throw fail(409, 'invalid_state', 'Stored collection is not a list.');
      const index = current.findIndex((item) => String(recordId(item)) === id);
      if (index < 0) throw fail(404, 'record_not_found', 'Record not found.');
      record = preservePrivateSalary(account, key, [record], [current[index]])[0];
      const next = current.slice();
      next[index] = record;
      const nextVersion = saveRows(key, next, row.version, account, module, 'update', id);
      db.exec('COMMIT');
      committed = true;
      return json(res, 200, { record: scopedState(account, key, [record])[0], version: nextVersion });
    } finally { if (!committed) db.exec('ROLLBACK'); }
  }

  if (req.method === 'DELETE' && id !== undefined) {
    if (!can(account, module, 'delete')) throw fail(403, 'forbidden', 'Delete permission required.');
    const { version } = await readBody(req);
    readStoredData(key);
    db.exec('BEGIN IMMEDIATE');
    let committed = false;
    try {
      const row = getRows(key);
      if ((row?.version ?? 0) !== version) throw fail(409, 'version_conflict', 'Collection changed. Reload and try again.');
      const current = readStoredData(key).value;
      if (!Array.isArray(current)) throw fail(409, 'invalid_state', 'Stored collection is not a list.');
      const target = current.find((item) => String(recordId(item)) === id);
      if (key === 'edu-salary-v1' && target && !canSeeAllSalaries(account) && !ownsSalary(account, target.employeeType || 'main', target.teacherId)) throw fail(403, 'forbidden', 'Other employees salary records are private.');
      const next = current.filter((item) => String(recordId(item)) !== id);
      if (next.length === current.length) throw fail(404, 'record_not_found', 'Record not found.');
      const nextVersion = saveRows(key, next, row.version, account, module, 'delete', id);
      db.exec('COMMIT');
      committed = true;
      return json(res, 200, { ok: true, version: nextVersion });
    } finally { if (!committed) db.exec('ROLLBACK'); }
  }

  throw fail(405, 'method_not_allowed', 'Method not allowed for this collection route.');
}
