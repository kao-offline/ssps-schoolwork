import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { directBrowserConfig } from './teams-live-config.mjs';
import { cacheRequest } from '../dist/teams-cache-client.js';

// Opens the actual browser integration for manual sign-in; no password/token APIs.
const source = process.argv.includes('--discord') ? 'discord' : 'teams';
const config = directBrowserConfig(undefined, undefined, source);
let pausedWorker = false;
try { await cacheRequest('pause', {}, source); pausedWorker = true; } catch { /* Direct sign-in also works before worker setup. */ }
const client = new Client({ name: 'schoolwork-browser-login', version: '1' });
const transport = new StdioClientTransport({ command: config.command, args: config.args.filter(arg => arg !== '--headless'), stderr: 'pipe' });
transport.stderr?.resume();
try {
  await client.connect(transport);
  const result = await client.callTool({ name: 'browser_navigate', arguments: { url: source === 'teams' ? 'https://teams.microsoft.com/v2/' : 'https://discord.com/channels/@me' } });
  if (result.isError) throw new Error('Browser navigation failed.');
  console.log(`Dedicated Chrome is open. Sign in to ${source} there. Do not send passwords or codes to the agent.`);
  console.log('This process waits up to 15 minutes and then closes the browser after detecting the Teams app.');
  let ready = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    if (snapshot.isError) throw new Error('Browser snapshot failed.');
    const text = snapshot.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    const appUrl = /Page URL: https:\/\/(?:teams\.microsoft\.com|teams\.cloud\.microsoft)\/(?!error)/.test(text);
    const navigation = new Set([...text.matchAll(/(?:button|link|tab) "(Chat|Teams|Calendar|Assignments|Activity|Kalendář|Zadání|Aktivita)(?:"|\b)/g)].map(match => match[1]));
    const discordReady = /Page URL: https:\/\/discord\.com\/channels\//.test(text) && /navigation|User Settings|Servers sidebar|Direct Messages/.test(text);
    if (source === 'teams' ? appUrl && navigation.size >= 2 : discordReady) { ready = true; break; }
    if (attempt % 6 === 0) console.log(`Waiting for ${source} sign-in / app…`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (!ready) throw new Error('Sign-in was not verified before timeout.');
  console.log(`${source} app navigation detected. Saved profile is ready; content still needs a live read check.`);
} catch {
  console.error('Live Teams browser sign-in was not verified. Check the dedicated Chrome window, installed Chrome and whether another session is using this school profile. No authentication state was printed.');
  process.exitCode = 1;
} finally { await client.close(); if (pausedWorker) await cacheRequest('resume', {}, source).catch(() => undefined); }
