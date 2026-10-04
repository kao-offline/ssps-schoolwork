import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createTui, recap, runTui, tuiEnabled } from './tui.mjs';
import { checkPrerequisites, findNpmCli } from './setup-prerequisites.mjs';
const root = resolve(import.meta.dirname, '..');
const flags = process.argv.slice(2);
const args = [`--env-file-if-exists=${join(root, '.env')}`];
const ui = !flags.includes('--detect') && !flags.includes('--help') && tuiEnabled({ force: flags.includes('--tui') }) ? createTui({ enabled: true }) : null;
let uiActive = Boolean(ui);
function run(command, parameters, input) {
  if (ui && uiActive) return runTui(spawn, ui, command, parameters, { input, cwd: root });
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, parameters, { cwd: root, stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'], windowsHide: true });
    if (input !== undefined) child.stdin.end(input);
    child.on('error', () => reject(new Error('Could not start a required setup command.')));
    child.on('close', code => code === 0 ? resolveRun() : reject(Object.assign(new Error(code === 130 ? 'Setup cancelled. Completed steps remain intact.' : `Setup phase failed (exit ${code}). Fix the error above and rerun the same command.`), { exitCode: code })));
  });
}

async function main() {
  if (flags.includes('--demo') && !flags.includes('--detect')) { await demo(); return; }
  if (Number(process.versions.node.split('.')[0]) < 22 || (Number(process.versions.node.split('.')[0]) === 22 && Number(process.versions.node.split('.')[1]) < 13)) throw new Error('Install Node.js 22.13 or later, then rerun setup.');
  if (flags.includes('--help')) {
    console.log('node scripts/setup.mjs [--detect] [--demo] [--tui] [--yes] [--agents-only] [--no-login] [--no-startup] [--apps=codex,claude,hermes] [--exclude=windsurf,kilo] [--sources=teams,bakalari,discord] [--cache-timeout=180]');
    return;
  }
  if (!flags.includes('--detect') && !flags.includes('--agents-only') && !flags.includes('--no-login') && !process.stdin.isTTY) throw new Error('Sign-in needs an interactive terminal. Run setup there, or use --no-login to reuse existing accounts.');
  const npmCli = findNpmCli();
  const systemStep = ui?.step('Check system requirements');
  ui?.run(systemStep, 'Checking Node.js, npm, Git and Google Chrome');
  const system = await checkPrerequisites({ npmCli, onCheck: (name, state, detail) => { if (ui) ui.check(name, state, detail); else if (state !== 'active') console.log(`${name}: ${detail}`); } });
  if (!system.ready) { ui?.bad(systemStep, 'Required dependencies are missing'); throw new Error(system.checks.filter(check => check.required && check.state !== 'done').map(check => `${check.name}: ${check.detail}`).join('\n')); }
  ui?.ok(systemStep, 'System ready; Chrome checked again after source selection');
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const fingerprint = createHash('sha256').update(JSON.stringify(lock)).digest('hex');
  const stamp = join(root, 'node_modules/.schoolwork-lock');
  const depsStep = ui?.step('[1/5] SETUP — dependencies');
  const buildStep = ui?.step('[1/5] SETUP — local server');
  ui?.run(depsStep, 'Verifying installed packages against package-lock.json');
  let installed = true;
  const packages = Object.keys({ ...lock.packages[''].dependencies, ...lock.packages[''].devDependencies });
  let verified = 0;
  for (const name of packages) {
    try { if (JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8')).version !== lock.packages['node_modules/' + name].version) { installed = false; ui?.log(name + ': locked version needs updating'); } } catch { installed = false; ui?.log(name + ': missing package'); }
    ui?.bar(++verified, packages.length, name);
  }
  ui?.check('Packages', installed ? 'done' : 'warn', `${verified} checked · ${installed ? 'locked versions match' : 'install required'}`);
  let oldFingerprint;
  try { oldFingerprint = await readFile(stamp, 'utf8'); } catch { /* First setup after a manual npm install. */ }
  if (!installed || oldFingerprint && oldFingerprint !== fingerprint) {
    if (!npmCli) throw new Error('npm is required. Run this command using npm run setup.');
    if (existsSync(join(root, 'dist/teams-cache-client.js'))) await run(process.execPath, [...args, join(root, 'scripts/setup-stop-workers.mjs')]);
    if (!ui) console.log('[1/5] SETUP — installing locked dependencies...');
    else ui.run(depsStep, 'locked install');
    // npm ci removes the whole tree; open agent MCP sessions can lock native DLLs.
    await run(process.execPath, [npmCli, existsSync(join(root, 'node_modules')) ? 'install' : 'ci', '--no-fund', '--no-audit', '--loglevel=error']);
    ui?.ok(depsStep, 'installed');
    ui?.check('Packages', 'done', 'Locked dependencies installed');
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
main().catch(error => { uiActive = false; ui?.stop(); console.error(error.message); process.exitCode = error.exitCode === 130 ? 130 : 1; });

// Renders the full installer dashboard with fake progress. Changes nothing:
// no installs, no builds, no writes, no logins.
async function demo() {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  if (!ui) { console.log('Demo needs an interactive terminal. Open Windows Terminal and run npm run setup -- --demo --tui.'); return; }
  const system = ui.step('Check system requirements');
  const setup = ui.step('[1/5] SETUP — dependencies');
  const build = ui.step('[1/5] SETUP — local server');
  const connect = ui.step('[2/5] CONNECT — readers + sign-in');
  const agents = ui.step('[3/5] AGENTS — servers + skills');
  const prepare = ui.step('[4/5] PREPARE — initial cache');
  ui.run(system, 'Demo only — these checks are simulated');
  for (const [name, detail] of [['Node.js', '22.13+'], ['npm', 'Ready'], ['Git', 'Ready'], ['Chrome', 'Installed']]) { ui.check(name, 'active', 'Checking…'); await sleep(250); ui.check(name, 'done', detail + ' (demo)'); }
  ui.ok(system, 'All checks passed (demo)');
  const selected = await ui.select([
    { id: 'teams', name: 'Microsoft Teams', description: 'Assignments, teacher announcements and documents through your private Chrome profile.' },
    { id: 'bakalari', name: 'Bakalari', description: 'Homework, marks, timetables and school messages. Sign in securely in the terminal.' },
    { id: 'discord', name: 'Discord', description: 'School channels and relevant conversations through a separate private Chrome profile.' },
  ], ['teams', 'bakalari', 'discord'], ' ACCOUNT SOURCES ');
  ui.log('Demo sources: ' + selected.join(', '));
  const demoApps = await ui.select([{ id: 'codex', name: 'Codex', description: 'Demo integration; no agent settings will be changed.' }, { id: 'claude', name: 'Claude Code' }, { id: 'hermes', name: 'Hermes' }], ['codex', 'claude', 'hermes'], ' AGENT APPS ', { min: 0 });
  const demoNames = demoApps.map(id => ({ codex: 'Codex', claude: 'Claude Code', hermes: 'Hermes' })[id]).join(' · ') || 'manual MCP import';
  ui.run(setup, 'locked install');
  await sleep(900);
  ui.ok(setup, 'installed');
  ui.run(build, 'tsc');
  await sleep(900);
  ui.ok(build, 'built');
  ui.run(connect, 'sign-in');
  ui.log('Demo sign-in: ' + selected.join(', ') + ' (no accounts are opened).');
  await sleep(1200);
  ui.ok(connect, 'connected');
  ui.run(agents, 'merging configs');
  await sleep(900);
  ui.ok(agents, demoNames);
  ui.run(prepare, 'warming views');
  for (let done = 0; done <= 3; done++) {
    ui.bar(done, 3, `${selected[0]} · ${done * 9} records (demo) · ${done}s`);
    await sleep(500);
  }
  ui.ok(prepare, 'views ready');
  ui.stop();
  recap([
    ['[1/5] SETUP — dependencies', 'installed'],
    ['[1/5] SETUP — local server', 'built'],
    ['[2/5] CONNECT — readers + sign-in', 'connected'],
    ['[3/5] AGENTS — servers + skills', demoNames],
    ['[4/5] PREPARE — initial cache', 'views ready'],
  ]);
  console.log(`[5/5] ASK — demo complete: ${demoApps.length} apps. No files or accounts changed.`);
  console.log('New session: “Read my schoolwork context and help me plan this week.”');
}
