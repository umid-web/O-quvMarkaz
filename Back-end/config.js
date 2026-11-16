import { resolve } from 'node:path';

export const PORT = Number(process.env.API_PORT || 3001);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error('API_PORT must be an integer from 0 to 65535.');
export const HOST = process.env.API_HOST || '127.0.0.1';
export const COOKIE = 'educontrol_session';
export const COOKIE_SAME_SITE = (process.env.COOKIE_SAME_SITE || 'Lax').trim();
if (!['Strict', 'Lax', 'None'].includes(COOKIE_SAME_SITE)) throw new Error('COOKIE_SAME_SITE must be Strict, Lax, or None.');
export const origins = new Set((process.env.APP_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174').split(',').map((value) => value.trim()).filter(Boolean));
if (process.env.NODE_ENV === 'production') {
  if (!process.env.APP_ORIGINS || !origins.size) throw new Error('Production requires explicit HTTPS APP_ORIGINS.');
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.username || parsed.password) throw new Error('APP_ORIGINS must contain exact HTTPS origins in production.');
  }
}
export const databasePath = resolve(process.env.SQLITE_FILE || 'Back-end/data/educontrol.sqlite');
