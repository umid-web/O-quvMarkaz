import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

test('payroll pages show a loading state before server confirmation and navigation follows permissions', async (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  const vite = await createServer({
    configFile: false,
    plugins: [{
      name: 'payroll-test-layout-header',
      enforce: 'pre',
      // Header has its own browser-only subscriptions; this test targets the layout navigation.
      resolveId(source, importer) {
        if (source === '../admin/components/Header' && importer?.replaceAll('\\', '/').endsWith('/src/Reception/ReceptionLayout.jsx')) return '\0payroll-test-header';
      },
      load(id) { if (id === '\0payroll-test-header') return 'export default function Header() { return null; }'; },
    }, react()],
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
  });
  let api;
  t.after(async () => { api?.clearBackendSession(); await vite.close(); globalThis.window = previousWindow; });
  api = await vite.ssrLoadModule('/src/api/backend.js');
  const memory = await vite.ssrLoadModule('/src/api/memoryStore.js');
  const { default: Salaries } = await vite.ssrLoadModule('/src/admin/pages/finance/Salaries.jsx');
  const { default: TeacherPages } = await vite.ssrLoadModule('/src/Teacher/TeacherPages.jsx');
  const { default: ReceptionLayout } = await vite.ssrLoadModule('/src/Reception/ReceptionLayout.jsx');
  const { ThemeContext } = await vite.ssrLoadModule('/src/admin/themeContextValue.js');
  const render = (component, props = {}, path = '/teacher/salaries') => renderToString(
    createElement(MemoryRouter, { initialEntries: [path] },
      createElement(ThemeContext.Provider, { value: { theme: 'dark', toggleTheme() {} } },
        createElement(component, props))),
  );
  const account = (roleId, permissions) => {
    api.clearBackendSession();
    memory.publishCollection('edu-teachers-v1', JSON.stringify([{
      id: 'T-1', firstName: 'Test', lastName: 'Teacher', status: 'active',
      subjects: [], groups: [], salaryType: 'fixed', salaryValue: 0,
    }]));
    api.applySessionUser({ id: 'U-1', username: 'test', roleId, roleName: roleId, permissions, teacherId: roleId === 'teacher' ? 'T-1' : undefined });
  };

  await t.test('employee payroll does not present initial empty rows as zero financial totals', () => {
    account('owner', ['salaries.view']);
    const html = render(Salaries, {}, '/admin/salaries');
    assert.match(html, /role="status">Ish haqi yuklanmoqda/);
    assert.doesNotMatch(html, /Jami hisoblangan|Maosh olmaganlar|Ustoz topilmadi/);
    assert.match(html, /class="btn btn--secondary" disabled=""/);
  });

  await t.test('teacher salary detail waits for the API instead of treating redacted pay as zero', () => {
    account('teacher', ['dashboard.view', 'salaries.view']);
    const html = render(TeacherPages, { view: 'salaries' });
    assert.match(html, /Mening ish haqim/);
    assert.match(html, /role="status">Ish haqi yuklanmoqda/);
    assert.doesNotMatch(html, /Hisoblangan jami|teacher-salary-breakdown|teacher-salary-progress/);
  });

  await t.test('teacher dashboard salary glance also waits for server payroll', () => {
    account('teacher', ['dashboard.view', 'salaries.view']);
    const html = render(TeacherPages, { view: 'dashboard' }, '/teacher');
    assert.match(html, /teacher-salary-glance/);
    assert.match(html, /role="status">Ish haqi yuklanmoqda/);
    assert.doesNotMatch(html, /teacher-salary-glance__amounts|teacher-salary-glance__bar/);
  });

  await t.test('a teacher without salary permission has no salary summary', () => {
    account('teacher', ['dashboard.view']);
    const html = render(TeacherPages, { view: 'dashboard' }, '/teacher');
    assert.doesNotMatch(html, /teacher-salary-glance/);
  });

  await t.test('reception salary navigation is visible exactly when permitted and content is keyboard reachable', () => {
    account('reception', ['dashboard.view', 'salaries.view']);
    const permitted = render(ReceptionLayout, {}, '/reception');
    assert.match(permitted, /href="\/reception\/salaries"/);
    assert.match(permitted, /class="skip-link" href="#page-content"/);
    assert.match(permitted, /<main id="page-content"[^>]*tabindex="-1"/);
    account('reception', ['dashboard.view']);
    assert.doesNotMatch(render(ReceptionLayout, {}, '/reception'), /href="\/reception\/salaries"/);
  });
});
