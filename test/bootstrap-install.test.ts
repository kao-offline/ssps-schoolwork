import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('published bootstrap scripts parse and protect existing installations', () => {
  for (const name of ['install.ps1', 'install.sh']) {
    const text = readFileSync(new URL(`../site/public/${name}`, import.meta.url), 'utf8');
    assert.ok(text.includes('https://github.com/kao-offline/ssps-schoolwork.git'));
    assert.ok(text.includes('remote get-url origin'));
    assert.ok(text.includes('status --porcelain'));
    assert.ok(text.includes('pull --quiet --ff-only origin main'));
    assert.ok(!/reset --hard|git clean|Remove-Item|rm -rf/.test(text));
  }
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', "$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'site/public/install.ps1'), [ref]$tokens, [ref]$errors); if ($errors.Count) { $errors | Out-String | Write-Output; exit 1 }"], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } else {
    const result = spawnSync('bash', ['-n', 'site/public/install.sh'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  assert.ok(readFileSync('site/public/install.sh', 'utf8').includes('</dev/tty'));
});

test('published assets pin both installers to the same revision as their health check', () => {
  execFileSync(process.execPath, ['site/build.mjs']);
  const health = JSON.parse(readFileSync('site/build/health.json', 'utf8'));
  assert.match(health.revision, /^[a-f0-9]{40}$/);
  for (const name of ['install.ps1', 'install.sh']) {
    const text = readFileSync('site/build/' + name, 'utf8');
    assert.ok(text.includes(health.revision));
    assert.ok(text.includes('checkout --quiet --detach'));
    assert.ok(text.includes('status --porcelain'));
  }
});

test('Windows one-command updater advances an older installation, preserves local data and refuses modified source', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ssps-update-'));
  const repository = join(directory, 'releases');
  const base = join(directory, 'local-app-data');
  const target = join(base, 'SSPSMCP/ssps-schoolwork');
  const git = (args: string[], cwd = repository) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
  try {
    await mkdir(join(repository, 'scripts'), { recursive: true });
    git(['init', '-b', 'main']); git(['config', 'user.name', 'Installer test']); git(['config', 'user.email', 'installer@example.invalid']);
    await writeFile(join(repository, '.gitignore'), '.env\n.schoolwork/\nsetup-ran.local\n');
    await writeFile(join(repository, 'scripts/setup.mjs'), "console.log('old installer');\n");
    git(['add', '.gitignore', 'scripts/setup.mjs']); git(['commit', '-m', 'test: old release']);
    git(['switch', '-c', 'release']);
    await writeFile(join(repository, 'scripts/setup.mjs'), "import {writeFileSync} from 'node:fs'; writeFileSync('setup-ran.local','new installer');\n");
    git(['add', 'scripts/setup.mjs']); git(['commit', '-m', 'test: new release']);
    const revision = git(['rev-parse', 'HEAD']);
    await mkdir(join(base, 'SSPSMCP'), { recursive: true });
    const remote = repository.replaceAll('\\', '/');
    git(['clone', '--quiet', '--branch', 'main', remote, target], directory);
    await writeFile(join(target, '.env'), 'SYNTHETIC_ACCOUNT_REFERENCE=preserved\n');
    await mkdir(join(target, '.schoolwork'));
    await writeFile(join(target, '.schoolwork/profile.json'), '{"groups":["sk2"]}');
    const source = readFileSync('site/public/install.ps1', 'utf8')
      .replace("$SspsBase = [Environment]::GetFolderPath('LocalApplicationData')", "$SspsBase = $env:SSPS_TEST_BASE")
      .replace('https://github.com/kao-offline/ssps-schoolwork.git', remote)
      .replace("$SspsRevision = 'main'", "$SspsRevision = '" + revision + "'");
    const script = join(directory, 'update.ps1'); await writeFile(script, source);
    const run = () => spawnSync('powershell.exe', ['-NoProfile', '-File', script], { env: { ...process.env, SSPS_TEST_BASE: base }, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    const updated = run(); assert.equal(updated.status, 0, updated.stdout + updated.stderr);
    assert.equal(git(['rev-parse', 'HEAD'], target), revision);
    assert.equal(await readFile(join(target, 'setup-ran.local'), 'utf8'), 'new installer');
    assert.equal(await readFile(join(target, '.env'), 'utf8'), 'SYNTHETIC_ACCOUNT_REFERENCE=preserved\n');
    assert.equal(await readFile(join(target, '.schoolwork/profile.json'), 'utf8'), '{"groups":["sk2"]}');
    assert.equal(run().status, 0, 'Updating the same release must be idempotent');
    await writeFile(join(target, 'scripts/setup.mjs'), '// local source edit\n');
    const blocked = run(); assert.notEqual(blocked.status, 0); assert.match(blocked.stderr, /local changes/);
    assert.equal(await readFile(join(target, 'scripts/setup.mjs'), 'utf8'), '// local source edit\n');
    assert.equal(git(['rev-parse', 'HEAD'], target), revision);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
