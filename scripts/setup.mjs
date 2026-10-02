import { existsSync, realpathSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, resolve, dirname, delimiter } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const flags = process.argv.slice(2);
const args = [`--env-file-if-exists=${join(root, '.env')}`];
function run(command, parameters, input) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, parameters, { cwd: root, stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'], windowsHide: true });
    if (input !== undefined) child.stdin.end(input);
    child.on('error', () => reject(new Error('Could not start a required setup command.')));
    child.on('close', code => code === 0 ? resolveRun() : reject(new Error(`Setup phase failed (exit ${code}). Fix the error above and rerun the same command.`)));
  });
}
async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22 || (Number(process.versions.node.split('.')[0]) === 22 && Number(process.versions.node.split('.')[1]) < 13)) throw new Error('Install Node.js 22.13 or later, then rerun setup.');
  if (flags.includes('--help')) {
    console.log('node scripts/setup.mjs [--detect] [--agents-only] [--no-login] [--no-startup] [--apps=codex,claude,hermes] [--exclude=windsurf,kilo] [--sources=teams,bakalari,discord] [--cache-timeout=180]');
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
  if (!installed || oldFingerprint && oldFingerprint !== fingerprint) {
    if (!npmCli) throw new Error('npm is required. Run this command using npm run setup.');
    if (existsSync(join(root, 'dist/teams-cache-client.js'))) await run(process.execPath, [...args, join(root, 'scripts/setup-stop-workers.mjs')]);
    console.log('[1/5] Installing the locked dependencies...');
    // npm ci removes the whole tree; open agent MCP sessions can lock native DLLs.
    await run(process.execPath, [npmCli, existsSync(join(root, 'node_modules')) ? 'install' : 'ci', '--no-fund']);
  } else console.log('[1/5] Dependencies are already current.');
  await writeFile(stamp, fingerprint);
  if (!flags.includes('--agents-only') && !flags.includes('--detect') || !existsSync(join(root, 'dist/setup-agents.js'))) {
    if (!npmCli) throw new Error('npm is required to build. Run this command using npm run setup.');
    console.log('[1/5] Building the local server...');
    await run(process.execPath, [npmCli, 'run', 'build']);
  }
  if (!flags.includes('--detect') && !existsSync(join(root, '.env'))) await copyFile(join(root, '.env.example'), join(root, '.env'));
  // Start a new Node process so .env is loaded before importing account/store modules.
  await run(process.execPath, [...args, join(root, 'scripts/setup-runner.mjs'), ...flags]);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
