import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, resolve, delimiter } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parse, modify, applyEdits, type ParseError } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { parseDocument } from 'yaml';
import { saveSecret, loadSecret } from './store.js';
import { browserTools } from './teams-cache-browser.js';

type Format = 'json' | 'toml' | 'grok' | 'yaml' | 'opencode' | 'vscode' | 'zed';
export type Agent = { id: string; name: string; file: string; format: Format; skills?: string; detected: boolean };
export type SetupPaths = { home: string; roaming: string; local: string; config: string; platform: NodeJS.Platform; env: NodeJS.ProcessEnv };
export const defaultPaths = (): SetupPaths => {
  const home = homedir();
  return { home, roaming: process.env.APPDATA || join(home, 'Library/Application Support'), local: process.env.LOCALAPPDATA || join(home, '.local/share'), config: process.env.XDG_CONFIG_HOME || join(home, '.config'), platform: process.platform, env: process.env };
};
function hasCommand(name: string, paths: SetupPaths) {
  return (paths.env.PATH || '').split(delimiter).some(dir => (paths.platform === 'win32' ? ['', '.exe', '.cmd', '.ps1'] : ['']).some(ext => existsSync(join(dir, name + ext))));
}
export function detectAgents(p = defaultPaths()): Agent[] {
  const home = p.home;
  const code = p.platform === 'win32' ? join(p.roaming, 'Code/User') : p.platform === 'darwin' ? join(p.roaming, 'Code/User') : join(p.config, 'Code/User');
  const hermes = p.env.HERMES_HOME || (existsSync(join(p.local, 'hermes/config.yaml')) ? join(p.local, 'hermes') : join(home, '.hermes'));
  const codex = p.env.CODEX_HOME || join(home, '.codex');
  const specifications: Omit<Agent, 'detected'>[] = [
    { id: 'codex', name: 'Codex', file: join(codex, 'config.toml'), format: 'toml', skills: join(codex, 'skills') },
    { id: 'grok', name: 'Grok', file: join(p.env.GROK_HOME || join(home, '.grok'), 'config.toml'), format: 'grok', skills: join(p.env.GROK_HOME || join(home, '.grok'), 'skills') },
    { id: 'claude', name: 'Claude Code', file: join(home, '.claude.json'), format: 'json', skills: join(home, '.claude/skills') },
    { id: 'hermes', name: 'Hermes', file: join(hermes, 'config.yaml'), format: 'yaml', skills: join(hermes, 'skills') },
    { id: 'gemini', name: 'Gemini CLI', file: join(home, '.gemini/settings.json'), format: 'json', skills: join(home, '.gemini/skills') },
    { id: 'opencode', name: 'OpenCode', file: join(p.config, 'opencode', existsSync(join(p.config, 'opencode/opencode.jsonc')) ? 'opencode.jsonc' : 'opencode.json'), format: 'opencode', skills: join(p.config, 'opencode/skills') },
    { id: 'cursor', name: 'Cursor', file: join(home, '.cursor/mcp.json'), format: 'json', skills: join(home, '.cursor/skills') },
    { id: 'windsurf', name: 'Windsurf', file: join(home, '.codeium/windsurf/mcp_config.json'), format: 'json', skills: join(home, '.codeium/windsurf/skills') },
    { id: 'vscode', name: 'VS Code Copilot', file: join(code, 'mcp.json'), format: 'vscode' },
    { id: 'copilot', name: 'Copilot CLI', file: join(p.env.COPILOT_HOME || join(home, '.copilot'), 'mcp-config.json'), format: 'json' },
    { id: 'claude-desktop', name: 'Claude Desktop', file: join(p.platform === 'linux' ? p.config : p.roaming, 'Claude/claude_desktop_config.json'), format: 'json' },
    { id: 'lmstudio', name: 'LM Studio', file: join(home, '.lmstudio/mcp.json'), format: 'json' },
    { id: 'zed', name: 'Zed', file: join(p.platform === 'win32' ? p.roaming : p.config, 'Zed/settings.json'), format: 'zed' },
  ];
  for (const [id, folder, filename] of [['cline', 'saoudrizwan.claude-dev', 'cline_mcp_settings.json'], ['roo', 'rooveterinaryinc.roo-cline', 'mcp_settings.json'], ['kilo', 'kilocode.kilo-code', 'mcp_settings.json']]) {
    specifications.push({ id, name: id, file: join(code, 'globalStorage', folder, 'settings', filename), format: 'json' });
  }
  let excluded: string[] = [];
  try {
    const preferences = JSON.parse(readFileSync(join(p.env.SCHOOLWORK_DATA_DIR || join(home, '.ssps-schoolwork'), 'setup-preferences.json'), 'utf8'));
    if (!Array.isArray(preferences.excludedApps) || preferences.excludedApps.some((id: unknown) => typeof id !== 'string')) throw new Error('Invalid excludedApps');
    excluded = preferences.excludedApps;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Invalid setup-preferences.json; correct it before rerunning setup.', { cause: error }); }
  const extensions: Record<string, string> = { cline: 'saoudrizwan.claude-dev', roo: 'rooveterinaryinc.roo-cline', kilo: 'kilocode.kilo-code' };
  function editorExtensionInstalled(id: string) {
    try {
      const base = join(home, '.vscode/extensions');
      const installed = JSON.parse(readFileSync(join(base, 'extensions.json'), 'utf8'));
      return installed.some((entry: any) => entry.identifier?.id === extensions[id] && typeof entry.relativeLocation === 'string' && existsSync(join(base, entry.relativeLocation, 'package.json')));
    } catch { return false; }
  }
  const windsurfInstalled = hasCommand('windsurf', p) || (p.platform === 'win32'
    ? [join(p.local, 'Programs/Windsurf/Windsurf.exe'), ...[p.env.ProgramFiles, p.env['ProgramFiles(x86)']].filter((dir): dir is string => !!dir).map(dir => join(dir, 'Windsurf/Windsurf.exe'))].some(existsSync)
    : p.platform === 'darwin' && [join('/Applications', 'Windsurf.app/Contents/MacOS/Electron'), join(home, 'Applications/Windsurf.app/Contents/MacOS/Electron')].some(existsSync));
  return specifications.map(agent => ({ ...agent, detected: !excluded.includes(agent.id) && (agent.id === 'windsurf' ? !!windsurfInstalled : agent.id in extensions ? editorExtensionInstalled(agent.id) : existsSync(agent.file) || dirname(agent.file) !== home && existsSync(dirname(agent.file)) || hasCommand(agent.id === 'vscode' ? 'code' : agent.id, p) || (agent.id === 'claude' && existsSync(join(home, '.claude')))) }));
}
export function serverEntries(root: string, sources = ['teams', 'bakalari', 'discord', 'outlook']) {
  const args = [`--env-file-if-exists=${join(root, '.env')}`];
  const entries: Record<string, any> = { schoolwork: { command: process.execPath, args: [...args, join(root, 'dist/index.js')], env: { SCHOOLWORK_SOURCES: sources.join(',') } } };
  for (const source of ['teams', 'discord']) if (sources.includes(source)) entries[source + '_live'] = { command: process.execPath, args: [...args, join(root, 'dist/teams-browser-proxy.js'), '--source=' + source] };
  return entries;
}
function assertOwned(existing: any, incoming: any, name: string) {
  if (!existing) return;
  const oldArgs = Array.isArray(existing.command) ? existing.command.slice(1) : existing.args;
  const expected = incoming.args.find((arg: string) => /dist[/\\].+\.js$/.test(arg));
  const owned = Array.isArray(oldArgs) && oldArgs.some((arg: unknown) => typeof arg === 'string' && (arg === expected || /[/\\]ssps-(?:schoolwork|bak-a-teams)[/\\](?:dist[/\\](?:index|teams-browser-proxy)\.js|node_modules[/\\]@playwright[/\\]mcp[/\\]cli\.js)$/.test(arg)));
  if (!owned) throw new Error(`Existing ${name} belongs to a different server; left unchanged.`);
}
export function mergedConfig(text: string, format: Format, entries: Record<string, any>): string {
  if (format === 'toml' || format === 'grok') {
    const parsed = parseToml(text || '') as any;
    let result = text;
    for (const [name, entry] of Object.entries(entries)) {
      assertOwned(parsed.mcp_servers?.[name], entry, name);
      const header = new RegExp(`^\\[mcp_servers\\.(?:${name}|"${name}"|'${name}')(?:\\.[^\\]]+)?\\]\\s*(?:#.*)?$`);
      let remove = false; let found = false;
      result = result.split(/\r?\n/).filter(line => {
        if (/^\s*\[/.test(line)) { remove = header.test(line.trim()); found ||= remove; }
        return !remove;
      }).join('\n');
      if (parsed.mcp_servers?.[name] && !found) throw new Error('Inline MCP tables need manual migration; configuration was not modified.');
      result = result.trimEnd() + `\n\n[mcp_servers.${name}]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\nenabled = true\nstartup_timeout_sec = 60\ntool_timeout_sec = 120\n`;
      if (entry.env) result += `env = { SCHOOLWORK_SOURCES = ${JSON.stringify(entry.env.SCHOOLWORK_SOURCES)} }\n`;
      if (format === 'toml' && name.endsWith('_live')) result += `enabled_tools = ${JSON.stringify(browserTools)}\n`;
    }
    parseToml(result);
    return result;
  }
  if (format === 'yaml') {
    const doc = parseDocument(text || '{}');
    if (doc.errors.length) throw new Error('Invalid YAML; configuration was not modified.');
    const parsed = doc.toJS();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a configuration object.');
    for (const [name, entry] of Object.entries(entries)) {
      assertOwned(parsed.mcp_servers?.[name], entry, name);
      doc.setIn(['mcp_servers', name], { ...entry, enabled: true, connect_timeout: 60, ...(name.endsWith('_live') ? { tools: { include: browserTools } } : {}) });
    }
    return doc.toString();
  }
  const errors: ParseError[] = [];
  const parsed = parse(text || '{}', errors, { allowTrailingComma: true });
  if (errors.length || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JSON/JSONC; configuration was not modified.');
  const key = format === 'opencode' ? 'mcp' : format === 'vscode' ? 'servers' : format === 'zed' ? 'context_servers' : 'mcpServers';
  if (parsed[key] && (typeof parsed[key] !== 'object' || Array.isArray(parsed[key]))) throw new Error('Expected an MCP configuration object.');
  let result = text || '{}\n';
  for (const [name, entry] of Object.entries(entries)) {
    assertOwned(parsed[key]?.[name], entry, name);
    const value = format === 'opencode' ? { type: 'local', command: [entry.command, ...entry.args], enabled: true, timeout: 120000 }
      : format === 'zed' ? { ...entry, env: entry.env || {} } : format === 'vscode' ? { type: 'stdio', ...entry } : entry;
    result = applyEdits(result, modify(result, [key, name], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  }
  return result;
}
export async function protectedBackup(file: string, bytes: Buffer) {
  const name = 'setup-backup-' + createHash('sha256').update(file).digest('hex').slice(0, 16) + '-' + Date.now() + '-' + randomUUID().slice(0, 8);
  await saveSecret(name, { path: resolve(file), contentBase64: bytes.toString('base64') });
  const check = await loadSecret<{ path: string; contentBase64: string }>(name);
  if (!check || !Buffer.from(check.contentBase64, 'base64').equals(bytes)) throw new Error('Configuration backup verification failed.');
  return name;
}
async function replaceFile(file: string, content: string) {
  let previous: Buffer | undefined;
  try { previous = await readFile(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const bytes = Buffer.from(content);
  if (previous?.equals(bytes)) return { changed: false };
  const backup = previous ? await protectedBackup(file, previous) : undefined;
  // Refuse to overwrite a concurrent edit after backing up the earlier state.
  if (previous && !(await readFile(file)).equals(previous)) throw new Error('Configuration changed during setup; retry after the app finishes saving.');
  if (!previous && existsSync(file)) throw new Error('Configuration was created during setup; retry.');
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomUUID();
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, file);
  if (!(await readFile(file)).equals(bytes)) throw new Error('Configuration read-back failed.');
  return { changed: true, backup };
}
export async function installAgent(agent: Agent, root: string, sources?: string[]) {
  let text = '';
  try { text = await readFile(agent.file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const result = await replaceFile(agent.file, mergedConfig(text, agent.format, serverEntries(root, sources)));
  const skillNames = ['class-schoolwork', ...(sources?.includes('discord') === false ? [] : ['discord-context'])];
  if (agent.skills) for (const name of skillNames) await replaceFile(join(agent.skills, name, 'SKILL.md'), await readFile(join(root, 'skills', name, 'SKILL.md'), 'utf8'));
  return { app: agent.name, config: agent.file, ...result, skills: agent.skills ? skillNames : [], restartRequired: true };
}
