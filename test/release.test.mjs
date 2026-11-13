import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';

const exec = promisify(execFile);
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'niko-release-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'source');
  for (const dir of ['scripts', 'niko-main/server', 'niko-wenku/dist/assets', 'niko-wenku/server', 'niko-wenku/shared', 'niko-wenku/deploy']) await mkdir(join(root, dir), { recursive: true });
  await cp(new URL('../scripts/release.mjs', import.meta.url), join(root, 'scripts/release.mjs'));
  await writeFile(join(root, 'niko-main/index.html'), '<html>new homepage</html>');
  await writeFile(join(root, 'niko-main/motion.css'), '.card {color:pink}');
  await writeFile(join(root, 'niko-main/server/private.js'), 'private backend');
  await writeFile(join(root, 'niko-main/.env'), 'private environment');
  await writeFile(join(root, 'niko-wenku/dist/index.html'), '<html>new library</html>');
  await writeFile(join(root, 'niko-wenku/dist/assets/new.js'), 'new asset');
  for (const name of ['server/app.mjs', 'server/read-api.mjs', 'server/library.mjs', 'server/text.mjs', 'server/captcha.mjs', 'shared/language.mjs', 'deploy/ensure-read-api.mjs', 'deploy/install-read-api.sh', 'deploy/niko-wenku-read-api.service', 'deploy/configure-read-failover.mjs', 'deploy/nginx-read-locations.conf', 'deploy/nginx-read-proxy.conf', 'deploy/nginx-read-upstream.conf']) {
    await cp(new URL('../niko-wenku/' + name, import.meta.url), join(root, 'niko-wenku', name));
  }
  for (const dir of ['niko-main', 'niko-wenku']) {
    await exec('git', ['init', '-q', join(root, dir)]);
    await exec('git', ['-C', join(root, dir), 'add', '.']);
  }
  for (const folder of ['library', '.state', 'secrets']) {
    await mkdir(join(root, 'niko-wenku', folder));
    await writeFile(join(root, 'niko-wenku', folder, 'private.json'), '{"private":"not for release"}');
  }
  await writeFile(join(root, 'niko-wenku/download-queue.json'), '{"private":"worker queue"}');
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/api/health' ? { ok: true, readOnly: true } : { total: 0, books: [] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { base, root, baseUrl: 'http://127.0.0.1:' + server.address().port };
}

test('site archive contains a runnable standby and public assets but no runtime data or homepage backend', async t => {
  const { packageRelease } = await import('../scripts/release.mjs');
  const { base, root } = await fixture(t);
  const archive = join(base, 'site.tar.gz');
  await packageRelease({ root, archive });
  const unpacked = join(base, 'unpacked');
  await mkdir(unpacked);
  await exec('tar', ['-xzf', archive, '-C', unpacked]);
  assert.equal(await readFile(join(unpacked, 'niko-main/index.html'), 'utf8'), '<html>new homepage</html>');
  await assert.rejects(access(join(unpacked, 'niko-main/server/private.js')));
  await assert.rejects(access(join(unpacked, 'niko-main/.env')));
  await assert.rejects(access(join(unpacked, 'niko-wenku/library')));
  await assert.rejects(access(join(unpacked, 'niko-wenku/secrets')));
  await assert.rejects(access(join(unpacked, 'niko-wenku/.state')));
  await assert.rejects(access(join(unpacked, 'niko-wenku/download-queue.json')));
  await access(join(unpacked, 'niko-wenku/deploy/ensure-read-api.mjs'));
  await access(join(unpacked, 'niko-wenku/deploy/install-read-api.sh'));
  await assert.rejects(exec(process.execPath, [join(unpacked, 'niko-wenku/server/read-api.mjs')], { env: { ...process.env, ARCHIVE_LIBRARY: '' } }), error => /ARCHIVE_LIBRARY/.test(error.stderr));
});

test('publishing checks standby before copying static files and keeps healthy standby and worker files unchanged', async t => {
  const { applyRelease } = await import('../scripts/release.mjs');
  const { base, root, baseUrl } = await fixture(t);
  const target = join(base, 'target');
  await mkdir(join(target, 'niko-wenku/dist/assets'), { recursive: true });
  await mkdir(join(target, 'niko-main/server'), { recursive: true });
  await mkdir(join(target, 'services/standby'), { recursive: true });
  await writeFile(join(target, 'services/standby/version'), 'keep standby version');
  await writeFile(join(target, 'niko-main/server/chat-server.mjs'), 'keep running server');
  await writeFile(join(target, 'niko-wenku/dist/assets/old.js'), 'keep cached asset');
  await writeFile(join(target, 'niko-wenku/download-queue.json'), 'keep worker queue');
  const result = await applyRelease({ sourceRoot: root, targetRoot: target, readApi: { baseUrl, install: () => writeFile(join(target, 'services/standby/version'), 'replaced') } });
  assert.equal(result.standby.action, 'skipped');
  assert.equal(await readFile(join(target, 'services/standby/version'), 'utf8'), 'keep standby version');
  assert.equal(await readFile(join(target, 'niko-wenku/download-queue.json'), 'utf8'), 'keep worker queue');
  assert.equal(await readFile(join(target, 'niko-main/server/chat-server.mjs'), 'utf8'), 'keep running server');
  assert.equal(await readFile(join(target, 'niko-main/index.html'), 'utf8'), '<html>new homepage</html>');
  assert.equal(await readFile(join(target, 'niko-wenku/dist/index.html'), 'utf8'), '<html>new library</html>');
  assert.equal(await readFile(join(target, 'niko-wenku/dist/assets/old.js'), 'utf8'), 'keep cached asset');
});

test('failed standby repair leaves the currently published site untouched', async t => {
  const { applyRelease } = await import('../scripts/release.mjs');
  const { base, root } = await fixture(t);
  const target = join(base, 'target');
  await mkdir(join(target, 'niko-main'), { recursive: true });
  await writeFile(join(target, 'niko-main/index.html'), 'existing homepage');
  const down = createServer((req, res) => { res.writeHead(503); res.end('{}'); });
  await new Promise(resolve => down.listen(0, '127.0.0.1', resolve));
  t.after(async () => { down.closeAllConnections(); await new Promise(resolve => down.close(resolve)); });
  await assert.rejects(applyRelease({ sourceRoot: root, targetRoot: target, readApi: { baseUrl: 'http://127.0.0.1:' + down.address().port, install: async () => { throw new Error('cannot repair'); } } }), /cannot repair/);
  assert.equal(await readFile(join(target, 'niko-main/index.html'), 'utf8'), 'existing homepage');
});

test('unavailable standby must recover before the new homepage is published', async t => {
  const { applyRelease } = await import('../scripts/release.mjs');
  const { base, root } = await fixture(t);
  const target = join(base, 'target');
  await mkdir(join(target, 'niko-main'), { recursive: true });
  await writeFile(join(target, 'niko-main/index.html'), 'existing homepage');
  let repaired = false;
  const standby = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (!repaired) { res.writeHead(503); return res.end('{}'); }
    res.end(JSON.stringify(req.url === '/api/health' ? { ok: true, readOnly: true } : { total: 0, books: [] }));
  });
  await new Promise(resolve => standby.listen(0, '127.0.0.1', resolve));
  t.after(async () => { standby.closeAllConnections(); await new Promise(resolve => standby.close(resolve)); });
  const result = await applyRelease({ sourceRoot: root, targetRoot: target, readApi: {
    baseUrl: 'http://127.0.0.1:' + standby.address().port,
    install: async () => {
      assert.equal(await readFile(join(target, 'niko-main/index.html'), 'utf8'), 'existing homepage');
      repaired = true;
    }
  } });
  assert.equal(result.standby.action, 'repaired');
  assert.equal(await readFile(join(target, 'niko-main/index.html'), 'utf8'), '<html>new homepage</html>');
});

test('incomplete standby sources cannot overwrite an existing release archive', async t => {
  const { packageRelease } = await import('../scripts/release.mjs');
  const { base, root } = await fixture(t);
  const archive = join(base, 'site.tar.gz');
  await writeFile(archive, 'previous release archive');
  await rm(join(root, 'niko-wenku/shared/language.mjs'));
  await assert.rejects(packageRelease({ root, archive }));
  assert.equal(await readFile(archive, 'utf8'), 'previous release archive');
});
