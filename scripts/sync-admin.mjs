import { readFile, lstat, copyFile, chmod, chown, open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ADMIN_ACCOUNT } from '../niko-monitor/server/admin-account.mjs';

// Deliberate one-time administration action, never run by static-site deployment.
export async function syncAdminCredentials(file) {
  file = resolve(file);
  const metadata = await lstat(file);
  if (!metadata.isFile()) throw new Error('Administrator configuration must be an existing regular file');
  const current = JSON.parse(await readFile(file, 'utf8'));
  if (current.version !== 1 || typeof current.username !== 'string' || !/^[a-f0-9]{32}$/.test(current.salt) || !/^[a-f0-9]{128}$/.test(current.passwordHash))
    throw new Error('Refusing to overwrite an unrecognized administrator configuration');
  if (['version', 'username', 'salt', 'passwordHash'].every(key => current[key] === ADMIN_ACCOUNT[key]))
    return { changed: false, username: ADMIN_ACCOUNT.username };
  const backup = file + '.before-niko-admin-' + randomUUID();
  await copyFile(file, backup, constants.COPYFILE_EXCL);
  await chmod(backup, 0o600);
  if (process.platform !== 'win32') await chown(backup, metadata.uid, metadata.gid);
  const temporary = file + '.pending-' + randomUUID();
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(ADMIN_ACCOUNT, null, 2) + '\n');
      if (process.platform !== 'win32') await handle.chown(metadata.uid, metadata.gid);
      await handle.sync();
    } finally { await handle.close(); }
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return { changed: true, username: ADMIN_ACCOUNT.username, backup };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'auth-file': { type: 'string' } } });
  if (!values['auth-file']) throw new Error('Usage: node scripts/sync-admin.mjs --auth-file /path/to/admin-auth.json');
  console.log(JSON.stringify(await syncAdminCredentials(values['auth-file'])));
}
