import { db } from './database.js';
import { writeStoredData } from './dataStore.js';
import { withEmployeeChat } from '../src/auth/chatPermissions.js';
import { ensureAdminAccountCreation } from '../src/auth/adminAccountPermissions.js';
import { ensureTeacherGroupAccess } from '../src/auth/teacherGroupPermissions.js';

// A one-time repair for roles created before employee chat was enabled.
export function migrateEmployeeChatAccess() {
  const name = 'employee-chat-access-v1';
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(name)) {
      const row = db.prepare("SELECT value, version FROM app_state WHERE key = 'edu-roles-v1'").get();
      if (row) {
        const roles = JSON.parse(row.value);
        const next = roles.map((role) => role.permissions?.some((permission) => permission.startsWith('chat.')) ? role : { ...role, permissions: withEmployeeChat(role.permissions) });
        if (JSON.stringify(roles) !== JSON.stringify(next)) writeStoredData('edu-roles-v1', next, row.version + 1, 'migration');
      }
      db.prepare('INSERT INTO app_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

// Existing installations created the standard admin role with read-only account access.
// Grant only account creation; editing permissions and deletion remain owner-controlled.
export function migrateAdminAccountCreation() {
  const name = 'admin-account-creation-v1';
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(name)) {
      const row = db.prepare("SELECT value, version FROM app_state WHERE key = 'edu-roles-v1'").get();
      if (row) {
        const roles = JSON.parse(row.value);
        const next = ensureAdminAccountCreation(roles);
        if (JSON.stringify(roles) !== JSON.stringify(next)) writeStoredData('edu-roles-v1', next, row.version + 1, 'migration');
      }
      db.prepare('INSERT INTO app_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

// Invitation-only accounts were never backed by an email invitation flow.
// Convert any legacy rows to normal active accounts before removing the state.
export function migrateInvitedAccountsToActive() {
  const name = 'remove-invited-account-status-v1';
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(name)) {
      const row = db.prepare("SELECT value, version FROM app_state WHERE key = 'edu-users-v1'").get();
      if (row) {
        const users = JSON.parse(row.value);
        const invitedIds = users.filter((user) => user.status === 'invited').map((user) => user.id);
        if (invitedIds.length) {
          const next = users.map((user) => user.status === 'invited' ? { ...user, status: 'active' } : user);
          writeStoredData('edu-users-v1', next, row.version + 1, 'migration');
          db.prepare(`UPDATE accounts SET active = 1 WHERE id IN (${invitedIds.map(() => '?').join(',')})`).run(...invitedIds);
        }
      }
      db.prepare('INSERT INTO app_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

// Add the groups page to existing teacher roles. Collection scoping still
// limits every teacher to the groups assigned to their own profile.
export function migrateTeacherGroupAccess() {
  const name = 'teacher-group-access-v1';
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(name)) {
      const row = db.prepare("SELECT value, version FROM app_state WHERE key = 'edu-roles-v1'").get();
      if (row) {
        const roles = JSON.parse(row.value);
        const next = ensureTeacherGroupAccess(roles);
        if (JSON.stringify(roles) !== JSON.stringify(next)) writeStoredData('edu-roles-v1', next, row.version + 1, 'migration');
      }
      db.prepare('INSERT INTO app_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
