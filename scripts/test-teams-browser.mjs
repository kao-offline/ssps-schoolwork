import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { teamsLiveConfig } from './teams-live-config.mjs';

// Exercise the actual installed browser MCP in its own profile, never school accounts.
const directory = await mkdtemp(join(tmpdir(), 'schoolwork-browser-test-'));
const http = createServer((req, res) => {
  if (req.url === '/sign-in-fixture') {
    res.setHeader('Set-Cookie', 'fixture_session=synthetic; HttpOnly; Max-Age=3600; SameSite=Lax');
    res.end('<h1>Fixture sign-in complete</h1>');
  } else if (req.url === '/download') {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="brief.txt"');
    res.end('Teacher requirements: build a parser.');
  } else {
    res.end(req.headers.cookie?.includes('fixture_session=synthetic')
      ? '<h1>Fixture assignment</h1><p>Build a parser. Due Friday.</p><a href="/download">Download fixture</a>'
      : '<h1>Fixture session missing</h1>');
  }
});
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${http.address().port}`;
const config = teamsLiveConfig();
const args = [...config.args, '--headless'];
args[args.indexOf('--user-data-dir') + 1] = join(directory, 'profile');
args[args.indexOf('--output-dir') + 1] = join(directory, 'teams-browser-output');
async function navigate(path) {
  const client = new Client({ name: 'live-browser-fixture', version: '1' });
  const transport = new StdioClientTransport({ command: config.command, args, stderr: 'pipe' });
  transport.stderr?.resume();
  try {
    await client.connect(transport);
    const available = new Set((await client.listTools()).tools.map(t => t.name));
    assert.ok(config.tools.include.every(name => available.has(name)));
    const result = await client.callTool({ name: 'browser_navigate', arguments: { url: url + path } });
    assert.ok(!result.isError, 'Browser MCP navigation failed');
    const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    assert.ok(!snapshot.isError, 'Browser MCP snapshot failed');
    const text = snapshot.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    if (path === '/assignment') {
      const ref = text.match(/link "Download fixture" \[ref=(\w+)\]/)?.[1];
      assert.ok(ref, 'Fixture download link missing');
      const clicked = await client.callTool({ name: 'browser_click', arguments: { target: ref } });
      assert.ok(!clicked.isError, JSON.stringify(clicked));
      await client.callTool({ name: 'browser_wait_for', arguments: { time: 1 } });
    }
    return text;
  } finally { await client.close(); }
}
try {
  assert.match(await navigate('/sign-in-fixture'), /Fixture sign-in complete/);
  // New MCP process must reuse the existing profile's synthetic session.
  assert.match(await navigate('/assignment'), /Build a parser\. Due Friday/);
  process.env.SCHOOLWORK_DATA_DIR = directory;
  const { readTeamsDownload } = await import('../dist/teams-downloads.js');
  const document = await readTeamsDownload('brief.txt');
  assert.match(document.parts[0].text, /Teacher requirements/);
  console.log('Live Chrome MCP verified: navigation, visible assignment text, persistent session across processes and downloaded document extraction. School account access was not tested by this fixture.');
} finally {
  await new Promise(resolve => http.close(resolve));
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
