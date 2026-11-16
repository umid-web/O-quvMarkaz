import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAttendanceSchedule } from '../attendanceSchedule.js';

test('attendance writes require a scheduled weekday; unchanged historical entries remain readable', () => {
  const groups = [{ code: 'G1', days: [2, 4, 6], start: '09:00', end: '11:00' }];
  const marks = { lessonStatus: 'held', S1: 'p' };
  const incoming = { 'G1|2026-11-12': marks };
  for (const time of ['09:00:00', '11:00:00', '14:00:00']) assert.doesNotThrow(() => assertAttendanceSchedule(incoming, {}, groups, Date.parse(`2026-11-12T${time}+05:00`)));
  for (const time of ['08:59:59', '14:00:01']) assert.throws(() => assertAttendanceSchedule(incoming, {}, groups, Date.parse(`2026-11-12T${time}+05:00`)), { code: 'attendance_closed' });
  for (const key of ['G1|2026-11-13', 'G1|2026-02-30', 'unknown|2026-11-12']) {
    assert.throws(() => assertAttendanceSchedule({ [key]: marks }, {}, groups), { code: 'not_lesson_day' });
  }
  const legacy = { 'G1|2026-11-13': marks };
  assert.doesNotThrow(() => assertAttendanceSchedule(legacy, legacy, groups));
  assert.throws(() => assertAttendanceSchedule({ 'G1|2026-11-13': { S1: 'a' } }, legacy, groups), { code: 'not_lesson_day' });
});
