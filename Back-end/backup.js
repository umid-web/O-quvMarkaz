import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, mkdtemp, chmod, link, realpath, rm, rmdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function backupDatabase({ sourcePath, outputPath }) {
  if (!sourcePath || !outputPath) throw new Error('Source and output paths are required.');
  const source = await realpath(resolve(sourcePath));
  if (!(await stat(source)).isFile()) throw new Error('Source must be an existing SQLite file.');
  const requestedOutput = resolve(outputPath);
  await mkdir(dirname(requestedOutput), { recursive: true, mode: 0o700 });
  const parent = await realpath(dirname(requestedOutput));
  const output = join(parent, basename(requestedOutput));
  const normalize = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  if (normalize(source) === normalize(output)) throw new Error('Backup cannot overwrite its source database.');
  // A private same-volume staging directory prevents partial public backups.
  const stage = await mkdtemp(join(parent, '.educontrol-backup-'));
  await chmod(stage, 0o700);
  const snapshot = join(stage, 'snapshot.sqlite');
  let sourceDb;
  let pages;
  try {
    sourceDb = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
    pages = await backup(sourceDb, snapshot, { rate: 100 });
    const verification = new DatabaseSync(snapshot, { readOnly: true });
    try {
      const rows = verification.prepare('PRAGMA quick_check').all();
      if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') throw new Error('Backup verification failed.');
    } finally { verification.close(); }
    await chmod(snapshot, 0o600);
    // Unlike rename, link atomically refuses an existing destination on all platforms.
    await link(snapshot, output);
    return { path: output, pages, verified: true };
  } finally {
    sourceDb?.close();
    for (const file of [snapshot, `${snapshot}-wal`, `${snapshot}-shm`, `${snapshot}-journal`]) await rm(file, { force: true });
    await rmdir(stage);
  }
}

export async function runBackupCli(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--output' || !args[1]) {
    throw new Error('Usage: npm run db:backup -- --output <new-backup.sqlite>. Source: SQLITE_FILE from Back-end/.env.');
  }
  return backupDatabase({ sourcePath: process.env.SQLITE_FILE || 'Back-end/data/educontrol.sqlite', outputPath: args[1] });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runBackupCli();
    console.log(JSON.stringify({ event: 'backup_complete', ...result }));
  } catch (error) {
    console.error(`Backup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
