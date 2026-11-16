import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligiblePeople, parseSubjects } from '../../src/admin/pages/teachers/teacherAssignment.js';

test('English teachers remain assignable to IELTS and CEFR courses, including custom subjects', () => {
  const englishTeacher = { id: 'english', status: 'active', subjects: ['Ingliz tili'] };
  const customTeacher = { id: 'custom', status: 'vacation', subjects: ['Business English'] };
  const departed = { id: 'left', status: 'left', subjects: ['IELTS'] };
  for (const course of ['IELTS', 'CEFR', 'Sefr']) {
    assert.deepEqual(eligiblePeople([englishTeacher, customTeacher, departed], course), [englishTeacher, customTeacher]);
  }
});

test('typed subjects retain custom labels and reject empty or duplicate entries', () => {
  assert.deepEqual(parseSubjects(' Ingliz tili, IELTS; CEFR\nBusiness English, ielts, , '), ['Ingliz tili', 'IELTS', 'CEFR', 'Business English']);
  assert.deepEqual(parseSubjects(' , ; \n '), []);
});
