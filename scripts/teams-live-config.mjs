import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const liveBrowserTools = ['browser_navigate', 'browser_navigate_back', 'browser_snapshot', 'browser_click', 'browser_press_key', 'browser_tabs', 'browser_wait_for', 'browser_close'];
export function teamsLiveConfig(root = resolve(import.meta.dirname, '..'), home = homedir()) {
  const privateRoot = process.env.SCHOOLWORK_DATA_DIR || join(home, '.ssps-schoolwork');
  return {
    command: process.execPath,
    args: [join(root, 'node_modules/@playwright/mcp/cli.js'), '--browser', 'chrome',
      '--user-data-dir', join(privateRoot, 'teams-browser-profile'),
      '--output-dir', join(privateRoot, 'teams-browser-output'),
      '--file-paths', 'absolute', '--codegen', 'none', '--snapshot-mode', 'full', '--console-level', 'error'],
    enabled: true, connect_timeout: 30, tools: { include: liveBrowserTools },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = teamsLiveConfig();
  for (const flag of ['--user-data-dir', '--output-dir']) mkdirSync(config.args[config.args.indexOf(flag) + 1], { recursive: true, mode: 0o700 });
  writeFileSync(resolve(import.meta.dirname, '../mcp.teams-live.local.json'), JSON.stringify({ mcpServers: { teams_live: config } }, null, 2) + '\n');
  console.log('Created mcp.teams-live.local.json. Dedicated Chrome profile and browser output stay outside the repository.');
}
