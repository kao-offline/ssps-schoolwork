import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { detectAgents, installAgent, serverEntries } from '../dist/setup-agents.js';
import { cacheAuth, cacheRequest } from '../dist/teams-cache-client.js';
import { warmCache } from '../dist/setup-warm.js';
import { dataDir } from '../dist/config.js';
const root = resolve(import.meta.dirname, '..');
const flags = process.argv.slice(2);
const args = [`--env-file-if-exists=${join(root, '.env')}`];
const option = (name, fallback) => flags.find(flag => flag.startsWith('--' + name + '='))?.split('=').slice(1).join('=').split(',') || fallback;
const sources = option('sources', ['teams', 'bakalari', 'discord']);
let phase = 'checking options';
let localReport;
function run(command, parameters) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, parameters, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.on('error', () => reject(new Error('Could not start setup phase.')));
    child.on('close', code => code === 0 ? resolveRun() : reject(new Error('Setup phase failed; accounts/config already completed are preserved. Rerun to continue.')));
  });
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
  console.log('\nSSPS Schoolwork — your accounts, your computer.');
  console.log('Credentials and cached schoolwork/messages stay locally; setup does not upload them to GitHub or a shared server.');
  console.log('Your agent may send retrieved context to its configured AI provider. Chrome sign-in contacts the original services.');
  console.log('Windows protects saved credentials/cache with DPAPI. Other systems use private file permissions.');
  await writeFile(join(root, 'mcp.local.json'), JSON.stringify({ mcpServers: serverEntries(root, sources) }, null, 2) + '\n', { mode: 0o600 });
  if (!flags.includes('--agents-only')) {
    phase = 'starting local readers';
    console.log('[2/5] Starting the private background readers...');
    for (const source of ['teams', 'discord'].filter(source => sources.includes(source))) await worker(source);
    if (!flags.includes('--no-login')) {
      console.log('[2/5] Sign in: Bakalari in this terminal, then Teams and Discord in Chrome. Each window closes when ready.');
      if (sources.includes('bakalari')) {
        phase = 'Bakalari sign-in';
        const { bakToken } = await import('../dist/auth.js');
        let connected = false;
        try { const { bak } = await import('../dist/bakalari.js'); await bakToken(); await bak('user'); connected = true; } catch { /* Interactive CLI reconnects below. */ }
        if (!connected) await run(process.execPath, [...args, join(root, 'dist/cli.js'), 'login-bakalari']);
        else console.log('Bakalari account verified; keeping existing sign-in.');
      }
      for (const source of ['teams', 'discord'].filter(source => sources.includes(source))) { phase = source + ' sign-in'; await run(process.execPath, [...args, join(root, 'scripts/teams-browser-login.mjs'), ...(source === 'discord' ? ['--discord'] : [])]); }
    }
  }
  phase = 'installing agent integrations';
  console.log('[3/5] Adding MCP servers and skills to detected apps (existing settings are backed up)...');
  const installed = []; const failures = [];
  let previousReport;
  try { previousReport = JSON.parse(await readFile(join(root, 'setup-report.local.json'), 'utf8')); } catch { /* First setup. */ }
  for (const app of apps.filter(app => requested ? requested.includes(app.id) : app.detected)) {
    try {
      const result = await installAgent(app, root, sources);
      if (!result.backup && !result.changed) result.backup = previousReport?.installed?.find(entry => entry.config === result.config)?.backup;
      installed.push(result); console.log('  ✓ ' + app.name);
    }
    catch { failures.push({ app: app.name, config: app.file, error: 'Could not merge this configuration or install its skills; no conflicting MCP entry was replaced. Check file validity, permissions and existing schoolwork names.' }); }
  }
  if (!flags.includes('--agents-only') && !flags.includes('--no-startup') && sources.some(source => ['teams', 'discord'].includes(source)) && process.platform === 'win32') { phase = 'installing hidden Windows startup'; await run('powershell.exe', ['-NoProfile', '-File', join(root, 'scripts/install-context-background.ps1'), ...(sources.includes('teams') ? [] : ['-SkipTeams']), ...(sources.includes('discord') ? [] : ['-SkipDiscord'])]); }
  const workers = [];
  const warm = [];
  localReport = { installed, failures, workers, warm, manualImport: join(root, 'mcp.local.json'), accountScope: 'Each student signs into their own accounts. Existing model/provider credentials are preserved.', restart: 'Start a new agent session or reload its MCP servers and skills.' };
  await writeFile(join(root, 'setup-report.local.json'), JSON.stringify(localReport, null, 2) + '\n', { mode: 0o600 });
  if (!flags.includes('--agents-only')) {
    console.log('[4/5] Preparing your initial cache. Counts only; message contents are not shown.');
    for (const source of ['teams', 'discord'].filter(source => sources.includes(source))) {
      phase = source + ' cache warm-up';
      warm.push(await warmCache(source, progress => {
        const line = `  ${source}: ${progress.completed}/${progress.required} initial views ready · ${progress.records} cached records · ${progress.elapsedSeconds}s`;
        if (process.stdout.isTTY) process.stdout.write('\r' + line.padEnd(105)); else console.log(line);
      }, { timeoutMs: timeout * 1000 }));
      if (process.stdout.isTTY) process.stdout.write('\n');
    }
  }
  if (!flags.includes('--agents-only')) for (const source of ['teams', 'discord'].filter(source => sources.includes(source))) {
    const status = await cacheRequest('status', {}, source);
    workers.push({ source, records: status.records, authenticationUnavailable: status.authenticationUnavailable, paused: status.paused });
  }
  await writeFile(join(root, 'setup-report.local.json'), JSON.stringify(localReport, null, 2) + '\n', { mode: 0o600 });
  console.log(`[5/5] ${failures.length ? 'Setup needs attention' : 'Ready'} — ${installed.length} apps configured. Details/backups: setup-report.local.json`);
  console.log('Open a new agent session and ask: “Read my schoolwork context and help me plan this week.”');
  console.log('Skills: /class-schoolwork and /discord-context. More channels keep caching in the background; history is partial.');
  console.log('Unknown clients (including Muse/Dot): import mcp.local.json through their MCP settings.');
  for (const failure of failures) console.error(failure.app + ': ' + failure.error);
  if (failures.length) process.exitCode = 1;
}
main().catch(async error => {
  if (localReport) await writeFile(join(root, 'setup-report.local.json'), JSON.stringify({ ...localReport, incompletePhase: phase }, null, 2) + '\n', { mode: 0o600 }).catch(() => undefined);
  console.error('Setup stopped during ' + phase + '. ' + (error instanceof Error ? error.message : 'Check the previous step.') + ' Completed steps remain intact; rerun the same command to continue.'); process.exitCode = 1;
});
