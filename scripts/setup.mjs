import { existsSync, realpathSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, resolve, dirname, delimiter } from 'node:path';
import { createTui, recap, runTui, tuiEnabled } from './tui.mjs';
const root = resolve(import.meta.dirname, '..');
const flags = process.argv.slice(2);
const args = [`--env-file-if-exists=${join(root, '.env')}`];
const ui = !flags.includes('--detect') && !flags.includes('--help') && tuiEnabled() ? createTui() : null;
let uiActive = Boolean(ui);
function run(command, parameters, input) {
  if (ui && uiActive) return runTui(spawn, ui, command, parameters, { input, cwd: root });
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, parameters, { cwd: root, stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'], windowsHide: true });
    if (input !== undefined) child.stdin.end(input);
    child.on('error', () => reject(new Error('Could not start a required setup command.')));
    child.on('close', code => code === 0 ? resolveRun() : reject(new Error(`Setup phase failed (exit ${code}). Fix the error above and rerun the same command.`)));
  });
}

async function main() {
  if (flags.includes('--demo') && !flags.includes('--detect')) { await demo(); return; }
  if (Number(process.versions.node.split('.')[0]) < 22 || (Number(process.versions.node.split('.')[0]) === 22 && Number(process.versions.node.split('.')[1]) < 13)) throw new Error('Install Node.js 22.13 or later, then rerun setup.');
  if (flags.includes('--help')) {
    console.log('node scripts/setup.mjs [--detect] [--demo] [--yes] [--agents-only] [--no-login] [--no-startup] [--apps=codex,claude,hermes] [--exclude=windsurf,kilo] [--sources=teams,bakalari,discord] [--cache-timeout=180]');
    return;
  }
  if (!flags.includes('--detect') && !flags.includes('--agents-only') && !flags.includes('--no-login') && !process.stdin.isTTY) throw new Error('Sign-in needs an interactive terminal. Run setup there, or use --no-login to reuse existing accounts.');
  const npmCandidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  if (process.platform !== 'win32') for (const dir of (process.env.PATH || '').split(delimiter)) {
    try { npmCandidates.push(realpathSync(join(dir, 'npm'))); } catch { /* Check the next standard npm location. */ }
  }
  const npmCli = npmCandidates.find(candidate => candidate && existsSync(candidate));
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const fingerprint = createHash('sha256').update(JSON.stringify(lock)).digest('hex');
  const stamp = join(root, 'node_modules/.schoolwork-lock');
  let installed = true;
  for (const name of Object.keys({ ...lock.packages[''].dependencies, ...lock.packages[''].devDependencies })) {
    try { if (JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8')).version !== lock.packages['node_modules/' + name].version) installed = false; } catch { installed = false; }
  }
  let oldFingerprint;
  try { oldFingerprint = await readFile(stamp, 'utf8'); } catch { /* First setup after a manual npm install. */ }
  const depsStep = ui?.step('[1/5] SETUP — dependencies');
  const buildStep = ui?.step('[1/5] SETUP — local server');
  if (!installed || oldFingerprint && oldFingerprint !== fingerprint) {
    if (!npmCli) throw new Error('npm is required. Run this command using npm run setup.');
    if (existsSync(join(root, 'dist/teams-cache-client.js'))) await run(process.execPath, [...args, join(root, 'scripts/setup-stop-workers.mjs')]);
    if (!ui) console.log('[1/5] SETUP — installing locked dependencies...');
    else ui.run(depsStep, 'locked install');
    // npm ci removes the whole tree; open agent MCP sessions can lock native DLLs.
    await run(process.execPath, [npmCli, existsSync(join(root, 'node_modules')) ? 'install' : 'ci', '--no-fund', '--no-audit', '--loglevel=error']);
    ui?.ok(depsStep, 'installed');
  } else if (!ui) console.log('[1/5] SETUP — dependencies already current.');
  else ui.ok(depsStep, 'already current');
  await writeFile(stamp, fingerprint);
  if (!flags.includes('--agents-only') && !flags.includes('--detect') || !existsSync(join(root, 'dist/setup-agents.js'))) {
    if (!npmCli) throw new Error('npm is required to build. Run this command using npm run setup.');
    if (!ui) console.log('[1/5] SETUP — building local server...');
    else ui.run(buildStep, 'tsc');
    // Existing readers must reload newly built RPC methods on a source-only update.
    if (!flags.includes('--detect') && !flags.includes('--agents-only') && existsSync(join(root, 'dist/teams-cache-client.js'))) await run(process.execPath, [...args, join(root, 'scripts/setup-stop-workers.mjs')]);
    await run(process.execPath, [npmCli, 'run', 'build', '--silent']);
    ui?.ok(buildStep, 'built');
  } else ui?.ok(buildStep, 'already built');
  if (!flags.includes('--detect') && !existsSync(join(root, '.env'))) await copyFile(join(root, '.env.example'), join(root, '.env'));
  // Start a new Node process so .env is loaded before importing account/store modules.
  // The runner owns its own dashboard; hand the terminal back first.
  uiActive = false;
  ui?.stop();
  if (ui) recap([['Dependencies', 'ready'], ['Local server', 'ready']]);
  await run(process.execPath, [...args, join(root, 'scripts/setup-runner.mjs'), ...flags]);
}
main().catch(error => { uiActive = false; ui?.stop(); console.error(error.message); process.exitCode = 1; });

// Renders the full installer dashboard with fake progress. Changes nothing:
// no installs, no builds, no writes, no logins.
async function demo() {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  if (!ui) { console.log('Demo needs an interactive terminal (TTY).'); return; }
  const setup = ui.step('[1/5] SETUP — dependencies');
  const build = ui.step('[1/5] SETUP — local server');
  const connect = ui.step('[2/5] CONNECT — readers + sign-in');
  const agents = ui.step('[3/5] AGENTS — servers + skills');
  const prepare = ui.step('[4/5] PREPARE — initial cache');
  ui.run(setup, 'locked install');
  await sleep(900);
  ui.ok(setup, 'installed');
  ui.run(build, 'tsc');
  await sleep(900);
  ui.ok(build, 'built');
  ui.run(connect, 'sign-in');
  ui.log('Chrome is open — sign in to teams there (15 min max).');
  await sleep(1200);
  ui.ok(connect, 'connected');
  ui.run(agents, 'merging configs');
  await sleep(900);
  ui.ok(agents, 'Codex · Claude · Hermes');
  ui.run(prepare, 'warming views');
  for (let done = 0; done <= 3; done++) {
    ui.bar(done, 3, `teams · ${done * 9} records · ${done}s`);
    await sleep(500);
  }
  ui.ok(prepare, 'views ready');
  ui.stop();
  recap([
    ['[1/5] SETUP — dependencies', 'installed'],
    ['[1/5] SETUP — local server', 'built'],
    ['[2/5] CONNECT — readers + sign-in', 'connected'],
    ['[3/5] AGENTS — servers + skills', 'Codex · Claude · Hermes'],
    ['[4/5] PREPARE — initial cache', 'views ready'],
  ]);
  console.log('[5/5] ASK — ready: 3 apps. Report: setup-report.local.json');
  console.log('New session: “Read my schoolwork context and help me plan this week.”');
}
