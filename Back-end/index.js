import { randomUUID } from 'node:crypto';
import { db } from './database.js';
import { PORT, HOST } from './config.js';
import { hashPassword } from './security.js';
import { nowIso } from './audit.js';
import { handler } from './routes.js';
import { migrateAdminAccountCreation, migrateEmployeeChatAccess, migrateInvitedAccountsToActive, migrateTeacherGroupAccess } from './migrations.js';
import { createApplicationServer, safeErrorDetails } from './serverLifecycle.js';
const bootstrap = async () => {
  const owner = db.prepare("SELECT id FROM accounts WHERE role_id = 'owner' LIMIT 1").get();
  if (owner) return;
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password || password.length < 10) {
    console.error('First run: set BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD (at least 10 characters).');
    throw Object.assign(new Error('Initial administrator configuration is missing.'), { code: 'ERR_BOOTSTRAP_CONFIG' });
  }
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(username)) {
    console.error('BOOTSTRAP_ADMIN_USERNAME must be 3–80 letters, digits, dot, underscore, or hyphen.');
    throw Object.assign(new Error('Initial administrator username is invalid.'), { code: 'ERR_BOOTSTRAP_CONFIG' });
  }
  db.prepare('INSERT INTO accounts (id, username, password_hash, role_id, active, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(randomUUID(), username, await hashPassword(password), 'owner', nowIso());
  console.log('Created the initial administrator account.');
};

const application = createApplicationServer({ handler, closeResources: () => db.close(), onFatalError: () => finish(1, 'server_error') });
let finishing;
function finish(exitCode, reason) {
  if (!finishing) {
    finishing = application.shutdown(reason).then(() => process.exit(exitCode), () => process.exit(1));
  }
  return finishing;
}
process.on('SIGINT', () => { void finish(0, 'SIGINT'); });
process.on('SIGTERM', () => { void finish(0, 'SIGTERM'); });

try {
  await bootstrap();
  migrateEmployeeChatAccess();
  migrateAdminAccountCreation();
  migrateInvitedAccountsToActive();
  migrateTeacherGroupAccess();
  // A fresh application run must require a fresh sign-in, rather than reuse
  // cookies issued by an earlier server process.
  db.prepare('DELETE FROM sessions').run();
  const address = await application.listen({ port: PORT, host: HOST });
  console.log(`EduControl API listening on http://${HOST}:${address.port}`);
} catch (error) {
  console.error(JSON.stringify({ time: new Date().toISOString(), event: 'startup_failed', ...safeErrorDetails(error) }));
  await finish(1, 'startup_failure');
}
