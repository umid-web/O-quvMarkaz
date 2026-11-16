import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDialogAction } from '../../src/admin/components/ui/dialogAction.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
};

const controller = () => {
  let state = { pending: false, error: '' };
  let changes = 0;
  const action = createDialogAction((next) => {
    state = typeof next === 'function' ? next(state) : next;
    changes++;
  });
  return { action, get state() { return state; }, get changes() { return changes; } };
};

test('confirmation locks immediately and repeated clicks cannot repeat a server action', async () => {
  const dialog = controller();
  const request = deferred();
  let calls = 0;
  const confirm = () => { calls++; return request.promise; };
  const first = dialog.action.run(confirm);
  assert.equal(dialog.action.pending, true);
  assert.equal(dialog.state.pending, true);
  assert.equal(await dialog.action.run(confirm), false);
  assert.equal(calls, 1);
  request.resolve();
  assert.equal(await first, true);
  assert.equal(dialog.state.pending, false);
  assert.equal(dialog.action.pending, false);
});

test('synchronous and asynchronous failures stay visible and allow a deliberate retry', async () => {
  const dialog = controller();
  assert.equal(await dialog.action.run(() => { throw new Error('Server rad etdi'); }), false);
  assert.deepEqual(dialog.state, { pending: false, error: 'Server rad etdi' });
  const request = deferred();
  const retry = dialog.action.run(() => request.promise);
  assert.deepEqual(dialog.state, { pending: true, error: '' });
  request.reject(new Error('Tarmoq xatosi'));
  assert.equal(await retry, false);
  assert.deepEqual(dialog.state, { pending: false, error: 'Tarmoq xatosi' });
  assert.equal(await dialog.action.run(() => Promise.resolve()), true);
  assert.deepEqual(dialog.state, { pending: false, error: '' });
});

test('an older closed dialog request cannot expose its error or unlock a newly opened action', async () => {
  const dialog = controller();
  const oldRequest = deferred();
  const oldRun = dialog.action.run(() => oldRequest.promise);
  dialog.action.reset();
  const newRequest = deferred();
  const newRun = dialog.action.run(() => newRequest.promise);
  oldRequest.reject(new Error('Old account private failure'));
  assert.equal(await oldRun, false);
  assert.deepEqual(dialog.state, { pending: true, error: '' });
  assert.equal(dialog.action.pending, true);
  newRequest.resolve();
  assert.equal(await newRun, true);
  assert.deepEqual(dialog.state, { pending: false, error: '' });
});

test('unmounted dialogs receive no later completion notifications', async () => {
  const dialog = controller();
  const request = deferred();
  const running = dialog.action.run(() => request.promise);
  dialog.action.invalidate();
  const before = dialog.changes;
  request.resolve();
  assert.equal(await running, false);
  assert.equal(dialog.changes, before);
});
