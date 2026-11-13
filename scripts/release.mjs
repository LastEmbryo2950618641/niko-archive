import { spawn, execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { mkdtemp, mkdir, readdir, copyFile, chmod, rename, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const exec = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const standbyFiles = [
  'server/app.mjs', 'server/read-api.mjs', 'server/library.mjs', 'server/text.mjs',
  'server/captcha.mjs', 'shared/language.mjs', 'deploy/ensure-read-api.mjs',
  'deploy/install-read-api.sh', 'deploy/niko-wenku-read-api.service',
  'deploy/configure-read-failover.mjs', 'deploy/nginx-read-upstream.conf',
  'deploy/nginx-read-proxy.conf', 'deploy/nginx-read-locations.conf'
];
function publicHomeFile(name) {
  if (name.split('/').some(part => part.startsWith('.') || ['server', 'test', 'deploy', 'node_modules'].includes(part))) return false;
  return name.startsWith('licenses/') || /\.(html|css|js|svg|png|jpe?g|webp|avif|ico|woff2?|ttf|otf|txt)$/i.test(name);
}
async function filesAt(root, prefix = '') {
  const files = [];
  for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix + item.name;
    if (item.isSymbolicLink()) throw new Error('发布包不接受符号链接：' + name);
    if (item.isDirectory()) files.push(...await filesAt(root, name + '/'));
    else if (item.isFile()) files.push(name);
  }
  return files;
}
async function requireFiles(root, names) {
  for (const name of names) if (!(await lstat(join(root, name))).isFile()) throw new Error('发布缺少普通文件：' + name);
}
async function copy(root, target, name) {
  const destination = join(target, name);
  await mkdir(dirname(destination), { recursive: true });
  const temp = destination + '.release-' + randomUUID();
  try {
    await copyFile(join(root, name), temp);
    await chmod(temp, 0o644);
    await rename(temp, destination);
  } finally { await rm(temp, { force: true }); }
}

export async function packageRelease({ root = repositoryRoot, archive }) {
  archive = resolve(archive);
  const { stdout } = await exec('git', ['-C', join(root, 'niko-main'), 'ls-files', '-z']);
  const homepage = stdout.split('\0').filter(name => name && publicHomeFile(name));
  await exec('git', ['-C', join(root, 'niko-wenku'), 'ls-files', '--error-unmatch', '--', ...standbyFiles]);
  const files = ['scripts/release.mjs', ...homepage.map(name => 'niko-main/' + name),
    ...standbyFiles.map(name => 'niko-wenku/' + name),
    ...(await filesAt(join(root, 'niko-wenku/dist'))).map(name => 'niko-wenku/dist/' + name)];
  await requireFiles(root, [...files, 'niko-main/index.html', 'niko-wenku/dist/index.html']);
  const stage = await mkdtemp(join(tmpdir(), 'niko-site-package-'));
  const pending = archive + '.pending-' + randomUUID();
  try {
    for (const name of files) await copy(root, stage, name);
    await mkdir(dirname(archive), { recursive: true });
    await exec('tar', ['-czf', pending, '-C', stage, '.']);
    await rename(pending, archive);
  } finally { await rm(stage, { recursive: true, force: true }); await rm(pending, { force: true }); }
  return { archive, files: files.length };
}

export async function applyRelease({ sourceRoot, targetRoot, readApi = {} }) {
  sourceRoot = resolve(sourceRoot);
  targetRoot = resolve(targetRoot);
  if (targetRoot === dirname(targetRoot) || targetRoot === sourceRoot || !isAbsolute(targetRoot)) throw new Error('请指定独立的站点部署目录');
  const names = [
    ...(await filesAt(join(sourceRoot, 'niko-main'))).filter(publicHomeFile).map(name => 'niko-main/' + name),
    ...(await filesAt(join(sourceRoot, 'niko-wenku/dist'))).map(name => 'niko-wenku/dist/' + name)
  ];
  await requireFiles(sourceRoot, [...standbyFiles.map(name => 'niko-wenku/' + name), 'niko-main/index.html', 'niko-wenku/dist/index.html']);
  const { ensureReadApi } = await import(pathToFileURL(join(sourceRoot, 'niko-wenku/deploy/ensure-read-api.mjs')).href);
  const standby = await ensureReadApi(readApi);
  // Publish assets before HTML; retain earlier hashed assets for existing tabs.
  names.sort((a, b) => Number(a.endsWith('/index.html')) - Number(b.endsWith('/index.html')) || a.localeCompare(b));
  for (const name of names) await copy(sourceRoot, targetRoot, name);
  return { targetRoot, files: names.length, standby };
}

function run(command, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(command + ' 退出码：' + code)));
  });
}
const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
async function main() {
  const [mode, ...args] = process.argv.slice(2);
  const { values } = parseArgs({ args, options: {
    archive: { type: 'string' }, host: { type: 'string', default: 'ubuntu@111.229.32.85' },
    target: { type: 'string', default: '/srv/niko-archive' },
    'service-user': { type: 'string', default: 'liuqi' },
    library: { type: 'string', default: '/home/liuqi/.local/share/wenku-archive/library' },
    origin: { type: 'string', default: 'http://111.229.32.85' },
    'nginx-site': { type: 'string', default: '/etc/nginx/sites-enabled/worldseed' }
  } });
  if (!['package', 'deploy', 'apply'].includes(mode)) throw new Error('用法：node scripts/release.mjs package|deploy [--archive PATH] [--host USER@HOST] [--target PATH]');
  const readApi = { serviceUser: values['service-user'], libraryRoot: values.library, publicOrigin: values.origin, sitePath: values['nginx-site'] };
  if (mode === 'apply') {
    if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('远端发布需要 Linux 和 sudo');
    console.log(JSON.stringify(await applyRelease({ sourceRoot: repositoryRoot, targetRoot: values.target, readApi })));
    return;
  }
  const archive = resolve(values.archive || join(repositoryRoot, 'output/site-release.tar.gz'));
  if (mode === 'package' || !values.archive) {
    await run(process.execPath, [join(repositoryRoot, 'scripts/build.mjs')], { cwd: repositoryRoot });
    console.log(JSON.stringify(await packageRelease({ archive })));
  }
  if (mode === 'package') return;
  if (!/^(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(values.host)) throw new Error('SSH 主机格式必须是 USER@HOST');
  const remote = '/tmp/niko-site-' + randomUUID();
  const sshOptions = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3'];
  try {
    await run('scp', [...sshOptions, archive, values.host + ':' + remote + '.tar.gz']);
    const apply = ['sudo', '-n', 'flock', '-w', '180', '/run/lock/niko-archive-deploy.lock', '/usr/bin/node', remote + '/scripts/release.mjs', 'apply', '--target', values.target,
      '--service-user', readApi.serviceUser, '--library', readApi.libraryRoot, '--origin', readApi.publicOrigin, '--nginx-site', readApi.sitePath];
    await run('ssh', [...sshOptions, values.host, 'mkdir -p ' + quote(remote) + ' && tar -xzf ' + quote(remote + '.tar.gz') + ' -C ' + quote(remote) + ' && ' + apply.map(quote).join(' ')]);
  } finally {
    try { await run('ssh', [...sshOptions, values.host, 'rm -rf -- ' + quote(remote) + ' ' + quote(remote + '.tar.gz')]); }
    catch (error) { console.error('远端临时发布文件清理失败：' + error.message); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
