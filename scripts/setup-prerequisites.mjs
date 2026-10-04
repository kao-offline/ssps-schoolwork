import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, realpathSync } from 'node:fs';
import { join, dirname, delimiter } from 'node:path';
const execute = promisify(execFile);

export function findNpmCli() {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  if (process.platform !== 'win32') for (const dir of (process.env.PATH || '').split(delimiter)) {
    try { candidates.push(realpathSync(join(dir, 'npm'))); } catch { /* Next standard npm location. */ }
  }
  return candidates.find(candidate => candidate && existsSync(candidate));
}

export function supportedNode(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major > 22 || major === 22 && minor >= 13;
}

// These LTS releases enable Windows VT input in ReadStream.setRawMode().
export function supportedMouse(version = process.versions.node, platform = process.platform) {
  if (platform !== 'win32') return true;
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major === 22 && minor >= 18 || major === 24 && minor >= 6 || major > 24;
}

export function chromeCandidates(platform = process.platform, env = process.env) {
  if (platform === 'win32') return [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean).map(base => join(base, 'Google/Chrome/Application/chrome.exe'));
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ...(env.HOME ? [join(env.HOME, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')] : [])];
  return ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
}

export async function checkPrerequisites({ npmCli, requireChrome = false, onCheck = () => {}, run = execute, exists = existsSync, platform = process.platform, env = process.env, version = process.versions.node } = {}) {
  const results = [];
  const report = (name, state, detail, required) => {
    const check = { name, state, detail, required };
    results.push(check); onCheck(name, state, detail); return check;
  };
  for (const name of ['Node.js', 'npm', 'Git', 'Chrome']) onCheck(name, 'active', 'Checking…');
  report('Node.js', supportedNode(version) ? 'done' : 'fail', `${version} · requires 22.13+`, true);
  if (platform === 'win32') report('Mouse', supportedMouse(version, platform) ? 'done' : 'warn', supportedMouse(version, platform) ? 'VT input ready · use Windows Terminal' : 'Keyboard only · upgrade Node to 22.18+ / 24.6+', false);
  await Promise.all([
    (async () => {
      if (!npmCli) { report('npm', 'fail', 'Missing · reinstall Node.js with npm', true); return; }
      try { const result = await run(process.execPath, [npmCli, '--version'], { timeout: 10000, windowsHide: true }); report('npm', 'done', result.stdout.trim(), true); }
      catch { report('npm', 'fail', 'Cannot run · reinstall Node.js with npm', true); }
    })(),
    (async () => {
      try { const result = await run('git', ['--version'], { timeout: 10000, windowsHide: true }); report('Git', 'done', result.stdout.trim().replace(/^git version /, ''), true); }
      catch { report('Git', 'fail', 'Missing · install Git and reopen the terminal', true); }
    })(),
    (async () => {
      const found = chromeCandidates(platform, env).find(exists);
      report('Chrome', found ? 'done' : requireChrome ? 'fail' : 'warn', found ? 'Installed · Teams / Discord browser' : 'Install Google Chrome for Teams / Discord', requireChrome);
    })(),
  ]);
  return { checks: results, ready: results.every(check => !check.required || check.state === 'done') };
}
