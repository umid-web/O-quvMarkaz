import { randomBytes, createHash, scrypt as scryptCallback, pbkdf2 as pbkdf2Callback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './database.js';
import { COOKIE, COOKIE_SAME_SITE } from './config.js';
import { fail, parseCookies } from './http.js';

const scrypt = promisify(scryptCallback);
const pbkdf2 = promisify(pbkdf2Callback);
// Unknown and disabled users must still pay the password derivation cost.
const dummyPasswordHash = `scrypt$${randomBytes(16).toString('hex')}$${randomBytes(64).toString('hex')}`;
export const loginPasswordHash = (account) => account?.active ? account.password_hash : dummyPasswordHash;

export function assertAccountUnchanged(account, passwordHash) {
  const current = db.prepare('SELECT active, role_id, password_hash FROM accounts WHERE id = ?').get(account.id);
  if (!current?.active || current.role_id !== account.role_id || current.password_hash !== passwordHash) {
    throw fail(401, 'unauthorized', 'Account changed. Sign in again.');
  }
}
let passwordJobs = 0;
async function derivePassword(job) {
  if (passwordJobs >= 8) throw fail(503, 'server_busy', 'Authentication busy. Retry later.');
  passwordJobs += 1;
  try { return await job(); }
  finally { passwordJobs -= 1; }
}
export const digest = (value) => createHash('sha256').update(value).digest('hex');

export function sessionTtlMs() {
  const row = db.prepare("SELECT value FROM app_state WHERE key = 'edu-settings-v1'").get();
  let minutes = 60;
  try {
    const value = row ? JSON.parse(row.value)?.security?.sessionMinutes : undefined;
    if (Number.isInteger(value) && value >= 15 && value <= 480) minutes = value;
  } catch { /* use the secure default */ }
  return minutes * 60 * 1000;
}

export function passwordMinimumLength() {
  const row = db.prepare("SELECT value FROM app_state WHERE key = 'edu-settings-v1'").get();
  try {
    const value = row ? JSON.parse(row.value)?.security?.passwordMinLength : undefined;
    return Number.isInteger(value) && value >= 6 && value <= 16 ? value : 8;
  } catch { return 8; }
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await derivePassword(() => scrypt(password, salt, 64));
  return `scrypt$${salt.toString('hex')}$${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256) return false;
  try {
    const [scheme, saltHex, hashHex] = String(encoded).split('$');
    if (scheme === 'scrypt') {
      if (!/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/i.test(String(encoded))) return false;
      const expected = Buffer.from(hashHex, 'hex');
      const actual = Buffer.from(await derivePassword(() => scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)));
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    }
    const [legacyScheme, rounds, salt, hash] = String(encoded).split('$');
    const iterations = Number(rounds);
    if (legacyScheme !== 'pbkdf2' || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 500_000 || !/^[0-9a-f]{32}$/i.test(salt) || !/^[0-9a-f]{64}$/i.test(hash)) return false;
    const expected = Buffer.from(hash, 'hex');
    if (String(encoded).split('$').length !== 4) return false;
    const actual = await derivePassword(() => pbkdf2(password, Buffer.from(salt, 'hex'), iterations, expected.length, 'sha256'));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch (error) { if (error.status === 503) throw error; return false; }
}

export function accountFrom(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = digest(token);
  const session = db.prepare('SELECT account_id, expires_at, created_at FROM sessions WHERE token_hash = ?').get(tokenHash);
  const absoluteExpiry = session ? Date.parse(session.created_at) + 12 * 60 * 60 * 1000 : 0;
  if (!session || session.expires_at <= Date.now() || !Number.isFinite(absoluteExpiry) || absoluteExpiry <= Date.now()) {
    if (session) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  const account = db.prepare('SELECT id, username, role_id, active FROM accounts WHERE id = ?').get(session.account_id);
  if (!account?.active) {
    db.prepare('DELETE FROM sessions WHERE account_id = ?').run(session.account_id);
    return null;
  }
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Math.min(absoluteExpiry, Date.now() + sessionTtlMs()), tokenHash);
  return account;
}

export function requireAuth(req) {
  const account = accountFrom(req);
  if (!account || !account.active) throw fail(401, 'unauthorized', 'Sessiya tugagan. Qayta tizimga kiring.');
  return account;
}

export const setSessionCookie = (token, maxAgeSeconds) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=${COOKIE_SAME_SITE}; Max-Age=${maxAgeSeconds}${process.env.NODE_ENV === 'production' || COOKIE_SAME_SITE === 'None' ? '; Secure' : ''}`;
