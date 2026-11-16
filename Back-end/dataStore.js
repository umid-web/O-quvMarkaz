import { db } from './database.js';
import { BODY_LIMIT, fail } from './http.js';
import { collections } from './permissions.js';
import { nowIso } from './audit.js';

const objectCollections = new Set(['edu-attendance-v1', 'edu-settings-v1', 'edu-chat-presence-v1']);
const scalarCollections = new Set(['edu-schedule-rooms-v1']);
const isRecordCollection = (key) => collections.has(key) && !objectCollections.has(key);
const idOf = (key, record) => scalarCollections.has(key) && typeof record === 'string' ? record : record && (record.id ?? record.code);

function migrateCollection(key, stateRow) {
  if (!isRecordCollection(key) || db.prepare('SELECT 1 FROM normalized_collections WHERE collection_key = ?').get(key)) return;
  let records = [];
  try { records = stateRow ? JSON.parse(stateRow.value) : []; }
  catch { throw fail(409, 'invalid_state', 'Stored collection is invalid.'); }
  if (!Array.isArray(records)) throw fail(409, 'invalid_state', 'Stored collection is not a list.');
  const ids = new Set();
  for (const record of records) {
    const id = idOf(key, record);
    if (id === undefined || id === null || ids.has(String(id))) throw fail(409, 'invalid_state', 'Stored records need unique ids or codes.');
    ids.add(String(id));
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const insert = db.prepare('INSERT OR IGNORE INTO collection_records (collection_key, record_id, position, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)');
    records.forEach((record, position) => insert.run(key, String(idOf(key, record)), position, JSON.stringify(record), nowIso(), 'migration'));
    db.prepare('INSERT OR IGNORE INTO normalized_collections (collection_key, normalized_at) VALUES (?, ?)').run(key, nowIso());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function readStoredData(key) {
  const stateRow = db.prepare('SELECT value, version, updated_at, updated_by FROM app_state WHERE key = ?').get(key);
  if (!isRecordCollection(key)) {
    if (!stateRow) return { value: undefined, version: 0, exists: false };
    try { return { value: JSON.parse(stateRow.value), version: stateRow.version, exists: true, row: stateRow }; }
    catch { throw fail(409, 'invalid_state', 'Stored data is invalid.'); }
  }
  migrateCollection(key, stateRow);
  if (!stateRow) return { value: [], version: 0, exists: false };
  const rows = db.prepare('SELECT record_id, value FROM collection_records WHERE collection_key = ? ORDER BY position, record_id').all(key);
  let value;
  try {
    value = rows.map((row) => {
      const record = JSON.parse(row.value);
      const id = idOf(key, record);
      if (id === undefined || id === null || String(id) !== row.record_id) throw new Error('record id mismatch');
      return record;
    });
  } catch { throw fail(409, 'invalid_state', 'Stored collection record is invalid or inconsistent.'); }
  return { value, version: stateRow.version, exists: true, row: stateRow };
}

export function writeStoredData(key, value, version, actorId) {
  const updatedAt = nowIso();
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > BODY_LIMIT) throw fail(413, 'payload_too_large', 'Saqlanadigan ma’lumot hajmi ruxsat etilgan chegaradan oshdi.');
  if (isRecordCollection(key)) {
    const records = value;
    const ids = new Set();
    for (const record of records) {
      const id = idOf(key, record);
      if (id === undefined || id === null || ids.has(String(id))) throw fail(400, 'invalid_record', 'Each record must have a unique id or code.');
      ids.add(String(id));
    }
    db.prepare('DELETE FROM collection_records WHERE collection_key = ?').run(key);
    const insert = db.prepare('INSERT INTO collection_records (collection_key, record_id, position, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)');
    records.forEach((record, position) => insert.run(key, String(idOf(key, record)), position, JSON.stringify(record), updatedAt, actorId));
    db.prepare('INSERT INTO normalized_collections (collection_key, normalized_at) VALUES (?, ?) ON CONFLICT(collection_key) DO NOTHING').run(key, updatedAt);
  }
  db.prepare(`INSERT INTO app_state (key, value, version, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, version=excluded.version, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
    .run(key, encoded, version, updatedAt, actorId);
}
