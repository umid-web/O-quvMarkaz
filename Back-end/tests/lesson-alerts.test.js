import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('lesson alerts distinguish confirmed lessons, cancellations and missing attendance in Tashkent time', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lesson-alerts-'));
  process.env.SQLITE_FILE = join(dir, 'test.sqlite');
  const { lessonAlerts, syncLessonAlerts } = await import('../lessonAlerts.js');
  const { db } = await import('../database.js');
  try {
    const groups = [{ code: 'G1', status: 'active', days: [5], start: '10:00', end: '11:00' }];
    const before = new Date('2026-11-13T05:30:00Z');
    const after = new Date('2026-11-13T06:00:00Z');
    assert.deepEqual(lessonAlerts(groups, {}, before), []);
    assert.match(lessonAlerts(groups, {}, after)[0].key, /missing$/);
    const held = lessonAlerts(groups, { 'G1|2026-11-13': { lessonStatus: 'held', S1: 'p' } }, after);
    assert.match(held[0].key, /held$/);
    assert.deepEqual(held[0].recipientIds, []);
    assert.match(lessonAlerts(groups, { 'G1|2026-11-13': { lessonStatus: 'not_held' } }, before)[0].key, /not_held$/);
    assert.match(lessonAlerts(groups, { 'G1|2026-11-13': { lessonStatus: 'held' } }, after)[0].key, /missing$/);
    assert.deepEqual(lessonAlerts(groups, {}, new Date('2026-11-14T06:00:00Z')), []);
    assert.doesNotThrow(syncLessonAlerts);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});
