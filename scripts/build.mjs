import { spawnSync } from 'node:child_process';

const npmCommand = process.env.npm_execpath
  ? [process.execPath, process.env.npm_execpath]
  : [process.platform === 'win32' ? 'npm.cmd' : 'npm'];
const result = spawnSync(npmCommand[0], [...npmCommand.slice(1), 'run', 'build'], {
  cwd: new URL('../niko-wenku/', import.meta.url),
  stdio: 'inherit',
  env: { ...process.env, ARCHIVE_BASE_PATH: '/nikowenku-archive/' }
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
