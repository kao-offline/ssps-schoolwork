import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('published bootstrap scripts parse and protect existing installations', () => {
  for (const name of ['install.ps1', 'install.sh']) {
    const text = readFileSync(new URL(`../site/public/${name}`, import.meta.url), 'utf8');
    assert.ok(text.includes('https://github.com/kao-offline/ssps-schoolwork.git'));
    assert.ok(text.includes('remote get-url origin'));
    assert.ok(text.includes('status --porcelain'));
    assert.ok(text.includes('pull --ff-only origin main'));
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
