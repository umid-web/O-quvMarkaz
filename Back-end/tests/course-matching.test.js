import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingStudentGroups, matchesCourse, activeCourseNames } from '../../src/admin/pages/courses/courseMatching.js';

test('typing a subject finds active IELTS/CEFR groups from saved course metadata', () => {
  const courses = [
    { name: 'IELTS', subject: 'Ingliz tili', status: 'active' },
    { name: 'CEFR', subject: 'Ingliz tili', status: 'active' },
    { name: 'Old English', subject: 'Ingliz tili', status: 'archived' },
  ];
  const groups = [
    { code: 'IELTS-A', course: 'IELTS', status: 'active' },
    { code: 'CEFR-B', course: 'CEFR', status: 'active' },
    { code: 'IELTS-OLD', course: 'IELTS', status: 'archived' },
    { code: 'MATH-A', course: 'Matematika', status: 'active' },
    { code: 'OLD-A', course: 'Old English', status: 'active' },
  ];
  assert.deepEqual(matchingStudentGroups(' ingliz   TILI ', courses, groups).map((group) => group.code), ['IELTS-A', 'CEFR-B']);
  assert.deepEqual(matchingStudentGroups('ielts', courses, groups).map((group) => group.code), ['IELTS-A']);
  assert.deepEqual(matchingStudentGroups('unknown', courses, groups), []);
  assert.deepEqual(matchingStudentGroups('', courses, groups), []);
});

test('legacy course groups work without subject metadata or static course definitions', () => {
  const group = { code: 'NEW-1', course: 'Custom English', status: 'active' };
  assert.deepEqual(matchingStudentGroups('custom english', [], [group]), [group]);
  assert.deepEqual(matchingStudentGroups("San'at", [{ name: 'Art', subject: 'San’at' }], [{ code: 'ART-1', course: 'Art' }]).map((item) => item.code), ['ART-1']);
});

test('teacher course filters share subject matching and active course names', () => {
  const courses = [
    { name: 'IELTS', subject: 'Ingliz tili', status: 'active' },
    { name: 'IELTS', subject: 'Ingliz tili', status: 'active' },
    { name: 'Old', status: 'archived' },
    { name: '', status: 'active' },
  ];
  assert.deepEqual(activeCourseNames(courses), ['IELTS']);
  assert.equal(matchesCourse({ subjects: [' ingliz   TILI '] }, 'IELTS', courses), true);
  assert.equal(matchesCourse({ subjects: ['ielts'] }, 'IELTS', courses), true);
  assert.equal(matchesCourse({ subjects: ['Matematika'] }, 'IELTS', courses), false);
  assert.equal(matchesCourse({ subjects: [] }, 'Missing', courses), false);
});
