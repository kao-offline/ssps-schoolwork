import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const liveBrowserTools = ['browser_navigate', 'browser_navigate_back', 'browser_snapshot', 'browser_click', 'browser_press_key', 'browser_tabs', 'browser_wait_for', 'browser_close'];
export function directBrowserConfig(root = resolve(import.meta.dirname, '..'), home = homedir(), source = 'teams') {
  const privateRoot = process.env.SCHOOLWORK_DATA_DIR || join(home, '.ssps-schoolwork');
  return {
    command: process.execPath,
    args: [join(root, 'node_modules/@playwright/mcp/cli.js'), '--browser', 'chrome', '--headless',
      '--user-data-dir', join(privateRoot, source + '-browser-profile'),
      '--output-dir', join(privateRoot, source + '-browser-output'),
      '--file-paths', 'absolute', '--codegen', 'none', '--snapshot-mode', 'full', '--console-level', 'error'],
    enabled: true, connect_timeout: 30, tools: { include: liveBrowserTools },
  };
}
export function teamsLiveConfig(root = resolve(import.meta.dirname, '..'), source = 'teams') {
  return { command: process.execPath, args: [`--env-file-if-exists=${join(root, '.env')}`, join(root, 'dist/teams-browser-proxy.js'), '--source=' + source], enabled: true, connect_timeout: 30, tools: { include: liveBrowserTools } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = process.argv.includes('--discord') ? 'discord' : 'teams';
  const config = teamsLiveConfig(undefined, source);
  const direct = directBrowserConfig(undefined, undefined, source);
  for (const flag of ['--user-data-dir', '--output-dir']) mkdirSync(direct.args[direct.args.indexOf(flag) + 1], { recursive: true, mode: 0o700 });
  writeFileSync(resolve(import.meta.dirname, `../mcp.${source}-live.local.json`), JSON.stringify({ mcpServers: { [source + '_live']: config } }, null, 2) + '\n');
  console.log(`Created mcp.${source}-live.local.json using the shared background browser worker.`);
}
