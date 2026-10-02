import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseJson } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { parseDocument } from 'yaml';
const directory = await mkdtemp(join(tmpdir(), 'schoolwork-setup-'));
process.env.SCHOOLWORK_DATA_DIR = join(directory, 'protected');
const { detectAgents, mergedConfig, serverEntries, installAgent } = await import('../src/setup-agents.js');
const { loadSecret } = await import('../src/store.js');
const root = join(directory, 'school project');
const entries = serverEntries(root);
test.after(() => rm(directory, { recursive: true, force: true }));

test('detects installed profiles including actual Hermes home, Grok and extension without inventing unknown app formats', async () => {
  const home = join(directory, 'home'); const local = join(directory, 'local'); const roaming = join(directory, 'roaming'); const config = join(directory, 'config');
  for (const file of [join(home, '.grok/config.toml'), join(local, 'hermes/config.yaml'), join(roaming, 'Code/User/globalStorage/kilocode.kilo-code/settings/mcp_settings.json')]) {
    await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, '{}');
  }
  const apps = detectAgents({ home, local, roaming, config, platform: 'win32', env: { PATH: '' } });
  assert.equal(apps.find(app => app.id === 'hermes')?.file, join(local, 'hermes/config.yaml'));
  assert.equal(apps.find(app => app.id === 'grok')?.detected, true);
  assert.equal(apps.find(app => app.id === 'kilo')?.detected, false, 'leftover extension settings are not an installed extension');
  assert.equal(apps.find(app => app.id === 'claude')?.detected, false);
  assert.equal(apps.some(app => app.id === 'muse'), false);
});
test('editor detection requires an installed app/extension and respects persistent exclusions', async () => {
  const home = join(directory, 'editor-home'); const local = join(directory, 'editor-local'); const roaming = join(directory, 'editor-roaming'); const config = join(directory, 'editor-config');
  const paths = { home, local, roaming, config, platform: 'win32' as const, env: { PATH: '' } };
  for (const file of [join(home, '.codeium/windsurf/mcp_config.json'), join(roaming, 'Code/User/globalStorage/kilocode.kilo-code/settings/mcp_settings.json')]) {
    await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, '{}');
  }
  assert.equal(detectAgents(paths).find(app => app.id === 'windsurf')?.detected, false);
  assert.equal(detectAgents(paths).find(app => app.id === 'kilo')?.detected, false);
  const executable = join(local, 'Programs/Windsurf/Windsurf.exe');
  await mkdir(join(executable, '..'), { recursive: true }); await writeFile(executable, 'fixture');
  const extension = join(home, '.vscode/extensions');
  await mkdir(join(extension, 'kilo-fixture'), { recursive: true });
  await writeFile(join(extension, 'kilo-fixture/package.json'), '{}');
  await writeFile(join(extension, 'extensions.json'), JSON.stringify([{ identifier: { id: 'kilocode.kilo-code' }, relativeLocation: 'kilo-fixture' }]));
  for (const id of ['windsurf', 'kilo']) assert.equal(detectAgents(paths).find(app => app.id === id)?.detected, true);
  await mkdir(join(home, '.ssps-schoolwork'), { recursive: true });
  await writeFile(join(home, '.ssps-schoolwork/setup-preferences.json'), JSON.stringify({ excludedApps: ['windsurf', 'kilo'] }));
  for (const id of ['windsurf', 'kilo']) assert.equal(detectAgents(paths).find(app => app.id === id)?.detected, false);
});
test('JSONC retains comments, provider settings and other servers; each client gets its native transport shape', () => {
  const input = '{\n// student preferences\n"provider":{"key":"synthetic-fixture-value"},"mcpServers":{"other":{"url":"https://example.test/mcp"}},\n}\n';
  const output = mergedConfig(input, 'json', entries);
  const parsed = parseJson(output);
  assert.ok(output.includes('// student preferences'));
  assert.deepEqual(parsed.provider, parseJson(input).provider);
  assert.deepEqual(parsed.mcpServers.other, parseJson(input).mcpServers.other);
  assert.equal(mergedConfig(output, 'json', entries), output, 'reruns are idempotent');
  assert.equal(parseJson(mergedConfig('{}', 'opencode', entries)).mcp.schoolwork.type, 'local');
  assert.equal(parseJson(mergedConfig('{}', 'vscode', entries)).servers.schoolwork.type, 'stdio');
  assert.equal(parseJson(mergedConfig('{}', 'zed', entries)).context_servers.schoolwork.command, process.execPath);
  assert.throws(() => mergedConfig('{broken', 'json', entries));
  assert.throws(() => mergedConfig('{"mcpServers":{"schoolwork":{"command":"unrelated"}}}', 'json', entries), /different server/);
});
test('TOML rewrites only owned MCP tables and keeps unrelated tables/comments; refuses inline ambiguity', () => {
  const input = '# keep this comment\nmodel = "fixture"\n[mcp_servers.other]\nurl = "https://example.test/mcp"\n[profiles.school]\nmodel = "another"\n';
  const output = mergedConfig(input, 'toml', entries);
  const parsed = parseToml(output) as any;
  assert.deepEqual(parsed.profiles, (parseToml(input) as any).profiles);
  assert.ok(output.startsWith(input.trimEnd()));
  assert.equal(parsed.mcp_servers.teams_live.enabled_tools.length, 8);
  assert.equal(mergedConfig(output, 'toml', entries), output);
  assert.equal((parseToml(mergedConfig('', 'grok', entries)) as any).mcp_servers.teams_live.enabled_tools, undefined);
  assert.throws(() => mergedConfig(`mcp_servers = {schoolwork = {command = ${JSON.stringify(entries.schoolwork.command)}, args = ${JSON.stringify(entries.schoolwork.args)}}}`, 'toml', entries), /Inline/);
});
test('Hermes YAML preserves model configuration and installs filtered tools with correct account-source selection', () => {
  const output = mergedConfig('# keep\nmodel:\n  provider: fixture\nmcp_servers:\n  unrelated:\n    url: https://example.test/mcp\n', 'yaml', entries);
  const parsed = parseDocument(output).toJS();
  assert.equal(parsed.model.provider, 'fixture');
  assert.equal(parsed.mcp_servers.unrelated.url, 'https://example.test/mcp');
  assert.equal(parsed.mcp_servers.discord_live.tools.include.length, 8);
  assert.deepEqual(Object.keys(serverEntries(root, ['bakalari'])), ['schoolwork']);
});
test('installation verifies protected backup, read-back, skill copies and unchanged second run', async () => {
  for (const name of ['class-schoolwork', 'discord-context']) {
    await mkdir(join(root, 'skills', name), { recursive: true });
    await writeFile(join(root, 'skills', name, 'SKILL.md'), '---\nname: '+name+'\n---\nFixture instructions.');
  }
  const file = join(directory, 'agent/settings.json');
  await mkdir(join(file, '..'), { recursive: true });
  const original = '{"model":"fixture","mcpServers":{"other":{"command":"fixture"}}}';
  await writeFile(file, original);
  const agent = { id: 'fixture', name: 'Fixture', format: 'json' as const, file, detected: true, skills: join(directory, 'agent/skills') };
  const result = await installAgent(agent, root);
  assert.ok(result.backup);
  const backup = await loadSecret<{ path: string; contentBase64: string }>(result.backup!);
  assert.equal(Buffer.from(backup!.contentBase64, 'base64').toString(), original);
  const config = parseJson(await readFile(file, 'utf8'));
  assert.equal(Object.keys(config.mcpServers).length, 4);
  assert.equal(config.model, 'fixture');
  assert.equal((await installAgent(agent, root)).changed, false);
  assert.equal(await readFile(join(agent.skills, 'discord-context/SKILL.md'), 'utf8'), await readFile(join(root, 'skills/discord-context/SKILL.md'), 'utf8'));
  if (process.platform === 'win32') assert.ok(!(await readFile(join(directory, 'protected', result.backup+'.json'), 'utf8')).includes(original));
});
