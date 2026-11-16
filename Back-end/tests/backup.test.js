import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupDatabase, runBackupCli } from '../backup.js';

test('online backup includes WAL records, verifies output, and never overwrites existing files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'educontrol-backup-test-'));
  const source = join(directory, 'live.sqlite');
  const output = join(directory, 'backup.sqlite');
  const writer = new DatabaseSync(source);
  t.after(async () => { writer.close(); await rm(directory, { recursive: true, force: true }); });
  writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT);');
  writer.prepare('INSERT INTO entries (value) VALUES (?)').run('committed-in-wal');
  const result = await backupDatabase({ sourcePath: source, outputPath: output });
  assert.equal(result.verified, true);
  assert.ok(result.pages > 0);
  const saved = new DatabaseSync(output, { readOnly: true });
  try { assert.equal(saved.prepare('SELECT value FROM entries').get().value, 'committed-in-wal'); }
  finally { saved.close(); }
  const originalBackup = await readFile(output);
  await assert.rejects(backupDatabase({ sourcePath: source, outputPath: output }), { code: 'EEXIST' });
  assert.deepEqual(await readFile(output), originalBackup);
  await assert.rejects(backupDatabase({ sourcePath: source, outputPath: source }), /cannot overwrite/);
  writer.prepare('INSERT INTO entries (value) VALUES (?)').run('still-writable');
  assert.equal(writer.prepare('SELECT COUNT(*) AS count FROM entries').get().count, 2);
  assert.ok(!(await readdir(directory)).some((name) => name.startsWith('.educontrol-backup-')));
});

test('backup rejects missing sources and ambiguous CLI input without creating a database', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'educontrol-backup-missing-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(backupDatabase({ sourcePath: join(directory, 'missing.sqlite'), outputPath: join(directory, 'result.sqlite') }), { code: 'ENOENT' });
  await assert.rejects(runBackupCli(['--output']), /Usage/);
  assert.deepEqual(await readdir(directory), []);
});
