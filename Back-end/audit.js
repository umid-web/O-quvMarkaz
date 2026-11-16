import { randomUUID } from 'node:crypto';
import { db } from './database.js';

export const nowIso = () => new Date().toISOString();

export function writeAudit(actor, module, action, title, detail = '') {
  db.prepare('INSERT INTO audit_events (id, at, actor_id, module, action, title, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), nowIso(), actor.id, module, action, title.slice(0, 240), String(detail).slice(0, 1000));
}
