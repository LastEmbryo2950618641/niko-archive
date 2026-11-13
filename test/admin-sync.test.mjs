import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncAdminCredentials } from '../scripts/sync-admin.mjs';
import { ADMIN_ACCOUNT } from '../niko-monitor/server/admin-account.mjs';

test('administrator sync preserves the previous verifier, is idempotent and never changes reader accounts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'niko-admin-sync-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'admin-auth.json');
  const before = { version: 1, username: 'previous-admin', salt: 'a'.repeat(32), passwordHash: 'b'.repeat(128) };
  await writeFile(file, JSON.stringify(before), { mode: 0o600 });
  const readers = join(directory, 'users.json');
  await writeFile(readers, '[{"username":"existing-reader"}]');
  const result = await syncAdminCredentials(file);
  assert.equal(result.changed, true);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), ADMIN_ACCOUNT);
  assert.deepEqual(JSON.parse(await readFile(result.backup, 'utf8')), before);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
  const count = (await readdir(directory)).length;
  assert.deepEqual(await syncAdminCredentials(file), { changed: false, username: ADMIN_ACCOUNT.username });
  assert.equal((await readdir(directory)).length, count);
  assert.equal(await readFile(readers, 'utf8'), '[{"username":"existing-reader"}]');
  await assert.rejects(syncAdminCredentials(readers), /unrecognized/);
  assert.equal(await readFile(readers, 'utf8'), '[{"username":"existing-reader"}]');
});
