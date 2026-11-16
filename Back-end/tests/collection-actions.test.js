import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

test('collection callbacks use the current RAM snapshot before React effects run', async (t) => {
  globalThis.window = new EventTarget();
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
  t.after(() => vite.close());
  const memory = await vite.ssrLoadModule('/src/api/memoryStore.js');
  const fixtures = [
    ['students/useStudents.js', 'useStudents', 'edu-students-v1', 'ST-', { firstName: 'First', lastName: 'Student', status: 'active' }],
    ['teachers/teachersStore.js', 'useTeachers', 'edu-teachers-v1', 'T-', { firstName: 'First', lastName: 'Teacher', status: 'active', groups: [] }],
    ['support-teachers/supportStore.js', 'useSupportTeachers', 'edu-support-teachers-v1', 'S-', { firstName: 'First', lastName: 'Support', status: 'active', groups: [] }],
    ['courses/coursesStore.js', 'useCourses', 'edu-courses-v1', 'C-', { name: 'Course', status: 'active' }],
  ];
  const modules = [];
  for (const [path, name, key, prefix, data] of fixtures) {
    const loaded = await vite.ssrLoadModule(`/src/admin/pages/${path}`);
    modules.push({ name, key, prefix, data, hook: loaded[name] });
  }
  const { useGroups } = await vite.ssrLoadModule('/src/admin/pages/groups/groupsStore.js');
  const capture = (hook) => {
    let actions;
    function Probe() { actions = hook(); return null; }
    renderToString(createElement(Probe));
    return actions;
  };
  const allowWrites = () => memory.configureCollectionWriter(memory.publishCollection);

  for (const { name, key, prefix, data, hook } of modules) {
    await t.test(`${name}: consecutive additions and removals do not reuse stale IDs or undo records`, () => {
      memory.clearCollections();
      allowWrites();
      const actions = capture(hook);
      const first = actions.add(data);
      const second = actions.add(data);
      assert.equal(first.id, `${prefix}0001`);
      assert.equal(second.id, `${prefix}0002`);
      assert.equal(new Set(memory.readCollectionSnapshot(key).map((row) => row.id)).size, 2);
      actions.update(first.id, { note: 'freshly edited' });
      const removed = actions.remove([first.id]);
      assert.equal(removed.length, 1);
      assert.equal(removed[0].note, 'freshly edited');
      actions.restore(removed);
      assert.equal(actions.remove([first.id])[0].note, 'freshly edited');
      // Restoring an existing record must replace it without duplicating its ID.
      actions.restore([{ ...first, note: 'restored version' }]);
      actions.restore([{ ...first, note: 'latest version' }]);
      assert.equal(memory.readCollectionSnapshot(key).filter((row) => row.id === first.id).length, 1);
      if (actions.setStatus) {
        actions.setStatus([first.id], 'vacation');
        const records = memory.readCollectionSnapshot(key);
        assert.equal(records.find((row) => row.id === first.id).status, 'vacation');
        assert.equal(records.find((row) => row.id === second.id).status, 'active');
      }

      // Valid numeric record IDs from the API preserve the existing number sequence.
      memory.publishCollection(key, JSON.stringify([{ ...data, id: 42 }]));
      assert.equal(actions.add(data).id, `${prefix}0043`);
    });
  }

  const groupData = (code) => ({ code, course: 'Course', days: [1, 3, 5], start: '09:00', end: '10:00', room: 'Room', status: 'active' });
  await t.test('useGroups: immediate edit/remove returns the newest records for undo', () => {
    memory.clearCollections();
    allowWrites();
    const groups = capture(useGroups);
    groups.add(groupData('G1'));
    groups.add(groupData('G2'));
    groups.update('G1', { room: 'Changed room' });
    const removed = groups.remove(['G1']);
    assert.equal(removed.length, 1);
    assert.equal(removed[0].room, 'Changed room');
    groups.restore(removed);
    assert.equal(groups.remove(['G1'])[0].room, 'Changed room');
  });

  await t.test('rejected main setters cannot create update, status or restore audit entries', () => {
    const cases = [...modules, { name: 'useGroups', key: 'edu-groups-v1', data: groupData('G1'), hook: useGroups }];
    for (const { key, data, hook } of cases) {
      memory.clearCollections();
      const row = key === 'edu-groups-v1' ? data : { ...data, id: 'RECORD-1' };
      memory.publishCollection(key, JSON.stringify([row]));
      const actions = capture(hook);
      const id = row.id ?? row.code;
      memory.configureCollectionWriter((changed, raw) => {
        if (changed === key) throw new Error('Main collection denied');
        memory.publishCollection(changed, raw);
      });
      assert.throws(() => actions.add(data), /Main collection denied/);
      assert.throws(() => actions.update(id, { note: 'Rejected edit' }), /Main collection denied/);
      assert.throws(() => actions.restore([row]), /Main collection denied/);
      if (actions.setStatus) assert.throws(() => actions.setStatus([id], 'archived'), /Main collection denied/);
      assert.equal(memory.memoryCache.getItem('edu-activity-v1'), null);
      assert.equal(memory.memoryCache.getItem('edu-notifications-v1'), null);
      assert.deepEqual(memory.readCollectionSnapshot(key), [row]);
    }
  });
});
