import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { detectAgents, installAgent, serverEntries } from '../dist/setup-agents.js';
import { cacheAuth, cacheRequest } from '../dist/teams-cache-client.js';
import { warmCache } from '../dist/setup-warm.js';
import { dataDir } from '../dist/config.js';
import { createTui, runTui, tuiEnabled } from './tui.mjs';
import { chooseSetup } from './setup-choices.mjs';
import { checkPrerequisites, findNpmCli, chromeCandidates } from './setup-prerequisites.mjs';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { classProfile } from '../dist/tasks-view.js';
import { configure2B } from './setup-2b.mjs';
const root = resolve(import.meta.dirname, '..');
export async function runSetup({ flags = process.argv.slice(2), ui = null } = {}) {
  const args = [`--env-file-if-exists=${join(root, '.env')}`];

  const option = (name, fallback) => flags.find(flag => flag.startsWith('--' + name + '='))?.split('=').slice(1).join('=').split(',') || fallback;
  let sources = option('sources', ['teams', 'bakalari', 'discord']);
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
  // Browser sign-in output is captured by the same installer screen.
  const runInteractive = run;
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
    const known = new Set(['--no-login', '--no-startup', '--agents-only', '--detect', '--yes', '--tui', '--2b', '--no-2b']);
    if (flags.some(flag => !known.has(flag) && !/^--(?:apps|exclude|sources|cache-timeout|groups|subjects)=/.test(flag)) || sources.some(source => !['teams', 'bakalari', 'discord'].includes(source))) throw new Error('Unknown setup option/source. Use --help.');
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
    let requested = option('apps');
    if (requested?.some(id => !apps.some(app => app.id === id))) throw new Error('Unknown app ID. Run --detect for supported IDs.');
    if (flags.includes('--detect')) {
      console.log(JSON.stringify({ apps: apps.map(({ id, name, detected, file }) => ({ id, name, detected, file })), unsupported: ['Muse/Dot or other apps without a verified local MCP configuration: use mcp.local.json with their import UI.'] }, null, 2));
      return;
    }
    if (ui) await checkPrerequisites({ npmCli: findNpmCli(), onCheck: (name, state, detail) => ui.check(name, state, detail) });
    if (process.stdin.isTTY && process.stdout.isTTY && !flags.includes('--yes')) {
      const select = async () => {
        const choose = (choices, defaults, title, options) => ui ? ui.select(choices, defaults, title, options) : chooseSetup(choices, defaults, title);
        if (!flags.some(flag => flag.startsWith('--sources='))) sources = await choose([
          { id: 'teams', name: 'Microsoft Teams', description: 'Read assignments, class announcements and documents using a dedicated local Chrome profile.' },
          { id: 'bakalari', name: 'Bakalari', description: 'Read homework, marks, timetable and school messages through the school API. Browser not required.' },
          { id: 'discord', name: 'Discord', description: 'Read accessible school conversations using a separate local Chrome profile. Coverage remains partial.' },
        ], sources, ' ACCOUNT SOURCES ');
        const detected = apps.filter(app => app.detected);
        if (!requested && detected.length) requested = await choose(detected.map(app => ({ ...app, description: `Configure ${app.name} with read-only schoolwork tools and skills. Existing model settings are preserved; changed files receive protected backups.` })), detected.map(app => app.id), ' AGENT APPS ', { min: 0 });
        if (ui) ui.log(`Selected: ${sources.join(', ')} · ${requested?.length || 0} apps`);
        else console.log(`\nSources: ${sources.join(', ')}\nApps: ${(requested || []).join(', ') || 'manual MCP import'}\n`);
      };
      await select();
    }
    let enable2B = flags.includes('--2b') || !flags.includes('--no-2b') && Boolean((await classProfile())?.enabled);
    if (ui && !flags.includes('--yes') && !flags.includes('--2b') && !flags.includes('--no-2b')) {
      enable2B = (await ui.select([{ id: '2b', name: '2B / Tasks View', description: 'Live class tasks filtered by your groups and subjects. Find yourself through Discord roles or select groups manually.' }], enable2B ? ['2b'] : [], 'Add your class module', { min: 0 })).includes('2b');
    }
    if (!flags.includes('--agents-only') && sources.some(source => ['teams', 'discord'].includes(source)) && !chromeCandidates().some(existsSync)) { ui?.check('Chrome', 'fail', 'Missing · install Google Chrome'); throw new Error('Google Chrome is required for the selected Teams/Discord sources. Install Chrome and rerun setup, or select only Bakalari.'); }
    if (!ui) {
      console.log('\nSSPS / MCP — Schoolwork, already in context.');
      console.log('Local only: accounts and cache stay on this computer.');
    }
    await writeFile(join(root, 'mcp.local.json'), JSON.stringify({ mcpServers: serverEntries(root, sources) }, null, 2) + '\n', { mode: 0o600 });
    const connectStep = ui?.step('[2/5] CONNECT — readers + sign-in');
    const agentsStep = ui?.step('[3/5] AGENTS — servers + skills');
    const prepareStep = ui?.step('[4/5] PREPARE — initial cache');
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
          if (!connected && ui) {
            const { bakLogin } = await import('../dist/auth.js');
            let password = '';
            const username = await ui.input('Connect Bakalari / username');
            try { password = await ui.input('Connect Bakalari / password', { secret: true }); await bakLogin({ grant_type: 'password', username, password }); }
            catch { throw new Error('Bakalari sign-in failed. Check your credentials and rerun setup.'); }
            finally { password = ''; }
          } else if (!connected) await run(process.execPath, [...args, join(root, 'dist/cli.js'), 'login-bakalari']);
          else if (!ui) console.log('Bakalari OK — keeping existing sign-in.');
        }
        for (const source of ['teams', 'discord'].filter(source => sources.includes(source))) { phase = source + ' sign-in'; await runInteractive(process.execPath, [...args, join(root, 'scripts/teams-browser-login.mjs'), ...(source === 'discord' ? ['--discord'] : [])]); }
      }
      ui?.ok(connectStep, 'connected');
    } else ui?.ok(connectStep, 'skipped');
    phase = 'configuring 2B';
    const profile2B = await configure2B({ enabled: enable2B, ui, sources, flags });
    if (ui && !flags.includes('--yes')) await ui.message('Your workspace is ready to install.', [
      'Sources: ' + sources.join(', '), 'Apps: ' + (requested?.join(', ') || 'manual import'), '2B module: ' + (enable2B ? 'enabled' : 'off'), 'Accounts stay on your computer.', 'Subject groups: ' + (profile2B?.subjectGroups?.map(g => g.subject + ': ' + g.group).join(', ') || 'none selected'), 'Tasks View filters: ' + (profile2B?.groups.join(', ') || 'class-wide only'), '2B subjects: ' + (profile2B?.subjects.join(', ') || 'all'), 'Existing app settings receive protected backups.'
    ], 'Install');
    ui?.screen('install');
    phase = 'installing agent integrations';
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
    localReport = { module2B: profile2B ? { enabled: profile2B.enabled, groups: profile2B.groups, subjects: profile2B.subjects, subjectGroups: profile2B.subjectGroups } : null, installed, failures, workers, warm, manualImport: join(root, 'mcp.local.json'), accountScope: 'Each student signs into their own accounts. Existing model/provider credentials are preserved.', restart: 'Start a new agent session or reload its MCP servers and skills.' };
    await writeFile(join(root, 'setup-report.local.json'), JSON.stringify(localReport, null, 2) + '\n', { mode: 0o600 });
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
    if (ui) {
      await ui.message(failures.length ? 'Installed with items needing attention.' : 'Your workspace is connected.', [
        `${installed.length} agent apps configured`,
        ...(profile2B?.enabled ? ['2B tasks: ' + (profile2B.groups.join(', ') || 'class-wide only')] : []),
        ...warm.map(w => `${w.source}: ${w.completed}/${w.required} initial views; history remains partial`),
        ...failures.map(f => f.app + ': configuration needs attention'),
        'Start a new agent session and ask what is due this week.',
        'Details: setup-report.local.json'
      ]);
      if (failures.length) process.exitCode = 1;
      return;
    }
    console.log(`[5/5] ASK — ${failures.length ? 'needs attention' : 'ready'}: ${installed.length} apps. Report: setup-report.local.json`);
    console.log('New session: “Read my schoolwork context and help me plan this week.”');
    console.log('Skills: /class-schoolwork · /discord-context. Other clients: import mcp.local.json.');
    for (const failure of failures) console.error(failure.app + ': ' + failure.error);
    if (failures.length) process.exitCode = 1;
  }
  try { await main(); } catch (error) {
    if (localReport) await writeFile(join(root, 'setup-report.local.json'), JSON.stringify({ ...localReport, incompletePhase: phase }, null, 2) + '\n', { mode: 0o600 }).catch(() => undefined);
    if (ui) { await ui.message('Setup needs attention.', ['Stopped during ' + phase, error instanceof Error ? error.message : 'Check the previous step.', 'Completed steps remain intact. Rerun setup to continue.']); process.exitCode = 1; return; }
    console.error('Setup stopped during ' + phase + '. ' + (error instanceof Error ? error.message : 'Check the previous step.') + ' Completed steps remain intact; rerun the same command to continue.'); process.exitCode = 1;

  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const ui = !process.argv.includes('--detect') && tuiEnabled({ force: process.argv.includes('--tui') }) ? createTui({ enabled: true }) : null;
  try { await runSetup({ ui }); } finally { ui?.stop(); }
}
