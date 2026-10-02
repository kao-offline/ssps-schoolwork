import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { detectAgents, installAgent, serverEntries } from '../dist/setup-agents.js';
import { cacheAuth, cacheRequest } from '../dist/teams-cache-client.js';
import { warmCache } from '../dist/setup-warm.js';
import { dataDir } from '../dist/config.js';
import { createTui, recap, runTui, tuiEnabled } from './tui.mjs';
const root = resolve(import.meta.dirname, '..');
const flags = process.argv.slice(2);
const args = [`--env-file-if-exists=${join(root, '.env')}`];
const ui = !flags.includes('--detect') && tuiEnabled() ? createTui() : null;
const option = (name, fallback) => flags.find(flag => flag.startsWith('--' + name + '='))?.split('=').slice(1).join('=').split(',') || fallback;
const sources = option('sources', ['teams', 'bakalari', 'discord']);
let phase = 'checking options';
let localReport;
function run(command, parameters) {
  if (ui) return runTui(spawn, ui, command, parameters, { cwd: root });
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, parameters, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.on('error', () => reject(new Error('Could not start setup phase.')));
    child.on('close', code => code === 0 ? resolveRun() : reject(new Error('Setup phase failed; accounts/config already completed are preserved. Rerun to continue.')));
  });
}
// Sign-in needs the real terminal (password prompt, Chrome instructions).
function runInteractive(command, parameters) {
  if (!ui) return run(command, parameters);
  return ui.suspend(() => new Promise((resolveRun, reject) => {
    const child = spawn(command, parameters, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.on('error', () => reject(new Error('Could not start setup phase.')));
    child.on('close', code => code === 0 ? resolveRun() : reject(new Error('Setup phase failed; accounts/config already completed are preserved. Rerun to continue.')));
  }));
}
async function worker(source) {
  await cacheAuth(true, source);
  try { await cacheRequest('status', {}, source); return; } catch { /* Configured worker can be started. */ }
  const child = spawn(process.execPath, [...args, join(root, 'dist/teams-cache-worker.js'), '--source=' + source], { detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
    try { await cacheRequest('status', {}, source); return; } catch { /* Wait for protected cache load. */ }
  }
  throw new Error(source + ' background worker did not start. Check local cache port/profile ownership.');
}
async function main() {
  const known = new Set(['--no-login', '--no-startup', '--agents-only', '--detect']);
  if (flags.some(flag => !known.has(flag) && !/^--(?:apps|exclude|sources|cache-timeout)=/.test(flag)) || sources.some(source => !['teams', 'bakalari', 'discord'].includes(source))) throw new Error('Unknown setup option/source. Use --help.');
  const timeout = Number(option('cache-timeout', ['180'])[0]);
  if (!Number.isInteger(timeout) || timeout < 10 || timeout > 900) throw new Error('Cache timeout must be 10–900 seconds.');
  let apps = detectAgents();
  const excluded = option('exclude');
  if (excluded) {
    if (excluded.some(id => !apps.some(app => app.id === id))) throw new Error('Unknown excluded app ID. Run --detect for supported IDs.');
    const file = join(dataDir, 'setup-preferences.json');
    let previous = { excludedApps: [] };
    try { previous = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await writeFile(file, JSON.stringify({ ...previous, excludedApps: [...new Set([...previous.excludedApps, ...excluded])] }, null, 2) + '\n', { mode: 0o600 });
    apps = detectAgents();
  }
  const requested = option('apps');
  if (requested?.some(id => !apps.some(app => app.id === id))) throw new Error('Unknown app ID. Run --detect for supported IDs.');
  if (flags.includes('--detect')) {
    console.log(JSON.stringify({ apps: apps.map(({ id, name, detected, file }) => ({ id, name, detected, file })), unsupported: ['Muse/Dot or other apps without a verified local MCP configuration: use mcp.local.json with their import UI.'] }, null, 2));
    return;
  }
  if (!ui) {
    console.log('\nSSPS / MCP — Schoolwork, already in context.');
    console.log('Local only: accounts and cache stay on this computer.');
  }
  await writeFile(join(root, 'mcp.local.json'), JSON.stringify({ mcpServers: serverEntries(root, sources) }, null, 2) + '\n', { mode: 0o600 });
  const connectStep = ui?.step('[2/5] CONNECT — readers + sign-in');
  if (!flags.includes('--agents-only')) {
    phase = 'starting local readers';
    if (!ui) console.log('[2/5] CONNECT — starting local readers...');
    else ui.run(connectStep, 'starting readers');
    for (const source of ['teams', 'discord'].filter(source => sources.includes(source))) await worker(source);
    if (!flags.includes('--no-login')) {
      if (!ui) console.log('CONNECT — Bakalari here, then Teams + Discord in Chrome (windows close when done).');
      else ui.run(connectStep, 'sign-in');
      if (sources.includes('bakalari')) {
        phase = 'Bakalari sign-in';
        const { bakToken } = await import('../dist/auth.js');
        let connected = false;
        try { const { bak } = await import('../dist/bakalari.js'); await bakToken(); await bak('user'); connected = true; } catch { /* Interactive CLI reconnects below. */ }
        if (!connected) await runInteractive(process.execPath, [...args, join(root, 'dist/cli.js'), 'login-bakalari']);
        else if (!ui) console.log('Bakalari OK — keeping existing sign-in.');
      }
      for (const source of ['teams', 'discord'].filter(source => sources.includes(source))) { phase = source + ' sign-in'; await runInteractive(process.execPath, [...args, join(root, 'scripts/teams-browser-login.mjs'), ...(source === 'discord' ? ['--discord'] : [])]); }
    }
    ui?.ok(connectStep, 'connected');
  } else ui?.ok(connectStep, 'skipped');
  phase = 'installing agent integrations';
  const agentsStep = ui?.step('[3/5] AGENTS — servers + skills');
  if (!ui) console.log('[3/5] AGENTS — adding MCP servers + skills (backups kept)...');
  else ui.run(agentsStep, 'merging configs');
  const installed = []; const failures = []; const installedNames = [];
  let previousReport;
  try { previousReport = JSON.parse(await readFile(join(root, 'setup-report.local.json'), 'utf8')); } catch { /* First setup. */ }
  for (const app of apps.filter(app => requested ? requested.includes(app.id) : app.detected)) {
    try {
      const result = await installAgent(app, root, sources);
      if (!result.backup && !result.changed) result.backup = previousReport?.installed?.find(entry => entry.config === result.config)?.backup;
      installed.push(result); installedNames.push(app.name);
    }
    catch { failures.push({ app: app.name, config: app.file, error: 'Could not merge this configuration or install its skills; no conflicting MCP entry was replaced. Check file validity, permissions and existing schoolwork names.' }); }
  }
  if (installedNames.length && !ui) console.log('  ✓ ' + installedNames.join(' · '));
  ui?.ok(agentsStep, installedNames.length ? installedNames.join(' · ').slice(0, 52) : 'nothing detected');
  if (!flags.includes('--agents-only') && !flags.includes('--no-startup') && sources.some(source => ['teams', 'discord'].includes(source)) && process.platform === 'win32') { phase = 'installing hidden Windows startup'; await run('powershell.exe', ['-NoProfile', '-File', join(root, 'scripts/install-context-background.ps1'), ...(sources.includes('teams') ? [] : ['-SkipTeams']), ...(sources.includes('discord') ? [] : ['-SkipDiscord'])]); }
  const workers = [];
  const warm = [];
  localReport = { installed, failures, workers, warm, manualImport: join(root, 'mcp.local.json'), accountScope: 'Each student signs into their own accounts. Existing model/provider credentials are preserved.', restart: 'Start a new agent session or reload its MCP servers and skills.' };
  await writeFile(join(root, 'setup-report.local.json'), JSON.stringify(localReport, null, 2) + '\n', { mode: 0o600 });
  const prepareStep = ui?.step('[4/5] PREPARE — initial cache');
  if (!flags.includes('--agents-only')) {
    if (!ui) console.log('[4/5] PREPARE — warming initial views; rest loads in background (partial history).');
    else ui.run(prepareStep, 'warming views');
    for (const source of ['teams', 'discord'].filter(source => sources.includes(source))) {
      phase = source + ' cache warm-up';
      warm.push(await warmCache(source, progress => {
        if (!ui) {
          const line = `  ${source}: ${progress.completed}/${progress.required} views · ${progress.records} records · ${progress.elapsedSeconds}s`;
          if (process.stdout.isTTY) process.stdout.write('\r' + line.padEnd(105)); else console.log(line);
        } else ui.bar(progress.completed, progress.required, `${source} · ${progress.records} records · ${progress.elapsedSeconds}s`);
      }, { timeoutMs: timeout * 1000 }));
      if (!ui && process.stdout.isTTY) process.stdout.write('\n');
    }
    ui?.ok(prepareStep, 'views ready');
  } else ui?.ok(prepareStep, 'skipped');
  if (!flags.includes('--agents-only')) for (const source of ['teams', 'discord'].filter(source => sources.includes(source))) {
    const status = await cacheRequest('status', {}, source);
    workers.push({ source, records: status.records, authenticationUnavailable: status.authenticationUnavailable, paused: status.paused });
  }
  await writeFile(join(root, 'setup-report.local.json'), JSON.stringify(localReport, null, 2) + '\n', { mode: 0o600 });
  ui?.stop();
  if (ui) recap([
    ['[2/5] CONNECT — readers + sign-in', flags.includes('--agents-only') ? 'skipped' : 'connected'],
    ['[3/5] AGENTS — servers + skills', installedNames.length ? installedNames.join(' · ').slice(0, 52) : 'nothing detected'],
    ['[4/5] PREPARE — initial cache', flags.includes('--agents-only') ? 'skipped' : warm.map(w => `${w.source} ${w.completed}/${w.required}`).join(' · ') || 'skipped'],
  ]);
  console.log(`[5/5] ASK — ${failures.length ? 'needs attention' : 'ready'}: ${installed.length} apps. Report: setup-report.local.json`);
  console.log('New session: “Read my schoolwork context and help me plan this week.”');
  console.log('Skills: /class-schoolwork · /discord-context. Other clients: import mcp.local.json.');
  for (const failure of failures) console.error(failure.app + ': ' + failure.error);
  if (failures.length) process.exitCode = 1;
}
main().catch(async error => {
  if (localReport) await writeFile(join(root, 'setup-report.local.json'), JSON.stringify({ ...localReport, incompletePhase: phase }, null, 2) + '\n', { mode: 0o600 }).catch(() => undefined);
  ui?.stop();
  console.error('Setup stopped during ' + phase + '. ' + (error instanceof Error ? error.message : 'Check the previous step.') + ' Completed steps remain intact; rerun the same command to continue.'); process.exitCode = 1;
});
