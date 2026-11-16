import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';

test('teacher controls follow granted attendance, payment and salary permissions', async (t) => {
  const cache = new Map();
  globalThis.localStorage = { getItem: (key) => cache.get(key) ?? null };
  globalThis.sessionStorage = { getItem: (key) => ({ educontrol_logged_in: 'true', educontrol_role: 'teacher' })[key] ?? null };
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
  t.after(() => vite.close());
  const { publishCollection, sessionIdentity } = await vite.ssrLoadModule('/src/api/memoryStore.js');
  sessionIdentity.setItem('educontrol_logged_in', 'true');
  sessionIdentity.setItem('educontrol_role', 'teacher');
  const { default: usePermissions } = await vite.ssrLoadModule('/src/Reception/useReceptionPermissions.js');
  function Probe() {
    const can = usePermissions();
    return createElement('span', null, ['attendance.edit', 'payments.create', 'salaries.create'].map((permission) => {
      const [module, action] = permission.split('.');
      return `${permission}:${can(module, action)}`;
    }).join('|'));
  }
  const render = () => renderToString(createElement(MemoryRouter, { initialEntries: ['/teacher/attendance'] }, createElement(Probe)));
  publishCollection('edu-roles-v1', JSON.stringify([{ id: 'teacher', name: 'Ustoz', permissions: ['attendance.view'] }]));
  assert.match(render(), /attendance.edit:false\|payments.create:false\|salaries.create:false/);
  publishCollection('edu-roles-v1', JSON.stringify([{ id: 'teacher', name: 'Ustoz', permissions: ['attendance.view', 'attendance.edit', 'payments.view', 'payments.create', 'salaries.view', 'salaries.create'] }]));
  assert.match(render(), /attendance.edit:true\|payments.create:true\|salaries.create:true/);
  publishCollection('edu-roles-v1', JSON.stringify([{ id: 'teacher', name: 'Ustoz', permissions: [] }]));
  assert.match(render(), /attendance.edit:false\|payments.create:false\|salaries.create:false/);
});
