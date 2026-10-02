import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as httpServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const directory = await mkdtemp(join(tmpdir(), 'context-cache-test-'));
process.env.SCHOOLWORK_DATA_DIR = directory;
const reservation = httpServer();
await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = (reservation.address() as { port: number }).port;
process.env.SCHOOLWORK_TEAMS_CACHE_PORT = String(port);
await new Promise<void>(resolve => reservation.close(() => resolve()));
const { TeamsCache, SerialQueue, canonical } = await import('../src/teams-cache.js');
const { BackgroundTeams, createCacheHttpServer } = await import('../src/teams-cache-worker.js');
const { classRoutes, assignmentRows } = await import('../src/teams-cache-browser.js');
const { discordChannel, discordDiscovered, mergeDiscordMessages } = await import('../src/discord-cache-browser.js');
const { cacheAuth } = await import('../src/teams-cache-client.js');
const { createServer } = await import('../src/server.js');
const observation = { id: 'assignment/example', kind: 'assignment' as const, title: 'Parser project', text: 'Submit Friday at 18:00.', sourceUrl: 'https://teams.cloud.microsoft/' };
const fakeBrowser = { collect: async (route: { id: string; kind: any; title: string }) => ({ observations: [{ ...observation, ...route }], discovered: [] }), call: async () => ({ content: [] }), tools: async () => [], close: async () => undefined };
test.after(async () => { await rm(directory, { recursive: true, force: true }); });

test('unchanged UI keeps content version, checks advance, invalidation and chunk races are explicit', () => {
  let now = Date.parse('2026-10-02T10:00:00Z');
  const cache = new TeamsCache(false, () => now);
  const first = cache.observe({ ...observation, text: 'Friday [ref=e1] [cursor=pointer]' }).entry;
  now += 1000;
  const second = cache.observe({ ...observation, text: 'Friday [ref=e99] [active]' });
  assert.equal(second.changed, false);
  assert.equal(second.entry.changedAt, first.changedAt);
  assert.notEqual(second.entry.checkedAt, first.checkedAt);
  assert.equal(canonical('3 minutes ago [ref=f1e1]'), '[relative time]');
  cache.invalidate(() => true);
  assert.equal(cache.read(observation.id).freshness.stale, true);
  cache.observe(observation);
  assert.equal(cache.read(observation.id).freshness.stale, false);
  assert.throws(() => cache.read(observation.id, 1, 100, first.contentHash), /changed between chunks/);
  now += 901000;
  assert.equal(cache.read(observation.id).freshness.stale, true);
  cache.bindAccount('student-a');
  cache.bindAccount('student-b');
  assert.equal(cache.entries.size, 0, 'different signed-in owner cannot inherit previous content');
});

test('protected cache survives process-style reload and concurrent flush updates are retained', async () => {
  const cache = new TeamsCache();
  cache.observe(observation);
  const saving = cache.flush();
  cache.observe({ ...observation, id: 'second', text: 'new record during save' });
  await saving;
  await cache.flush();
  const reloaded = new TeamsCache();
  await reloaded.load();
  assert.equal(reloaded.entries.size, 2);
  assert.equal(reloaded.read('second').text, 'new record during save');
  if (process.platform === 'win32') assert.ok(!(await readFile(join(directory, 'teams-live-cache.json'), 'utf8')).includes('Submit Friday'));
});

test('queue serializes browser actions, survives failures, and foreground lease defers background reads', async () => {
  const queue = new SerialQueue();
  const order: number[] = [];
  const first = queue.run(async () => { order.push(1); throw new Error('fixture'); });
  const second = queue.run(async () => { order.push(2); });
  await assert.rejects(first);
  await second;
  assert.deepEqual(order, [1, 2]);
  let now = 0;
  let calls = 0;
  const worker = new BackgroundTeams(new TeamsCache(false), { ...fakeBrowser, collect: async route => { calls++; return fakeBrowser.collect(route); } }, () => now);
  await worker.rpc('browser', { name: 'browser_snapshot', arguments: {} });
  await worker.tick();
  assert.equal(calls, 0);
  now = 61000;
  await worker.tick();
  assert.equal(calls, 1);
  await assert.rejects(worker.rpc('browser', { name: 'browser_evaluate', arguments: {} }));
});

test('changed notifications record activity without invalidating the backlog; failed checks preserve last good data', async () => {
  let now = 1000;
  let text = 'old notification';
  let fail = false;
  const cache = new TeamsCache(false, () => now);
  cache.observe(observation);
  const worker = new BackgroundTeams(cache, { ...fakeBrowser, collect: async route => { if (fail) throw new Error('authentication_or_teams_unavailable'); return { observations: [{ ...observation, ...route, text }], discovered: [] }; } }, () => now);
  worker.routes = new Map([['activity', { id: 'activity', kind: 'activity', title: 'Notifications', intervalMs: 30000 }], ['assignments/upcoming', { id: 'assignments/upcoming', kind: 'assignments', title: 'Upcoming', intervalMs: 300000 }]]);
  worker.requested = new Set(['activity']);
  await worker.tick();
  now += 31000;
  text = 'teacher updated deadline';
  await worker.tick();
  assert.ok(worker.lastActivityChangeAt);
  assert.equal(cache.read(observation.id).freshness.stale, false);
  assert.ok(worker.urgent.has('assignments/upcoming'));
  now += 31000;
  fail = true;
  await worker.tick();
  assert.equal(worker.authenticationUnavailable, true);
  assert.equal(cache.read('activity').text, 'teacher updated deadline');
});

test('reading Discord unread messages does not restart the crawl; a new indicator only records activity', async () => {
  let now = 1000;
  let unread = ['unread A', 'unread B'];
  const cache = new TeamsCache(false, () => now);
  cache.observe(observation);
  const worker = new BackgroundTeams(cache, { ...fakeBrowser, collect: async route => ({ observations: [{ ...observation, ...route, text: JSON.stringify({ unread }) }], discovered: [] }) }, () => now, 'discord');
  worker.routes.delete('discord/navigation');
  worker.requested.delete('discord/navigation');
  await worker.tick();
  now += 31000; unread = ['unread B'];
  await worker.tick();
  assert.equal(worker.lastActivityChangeAt, undefined);
  assert.equal(cache.read(observation.id).freshness.stale, false);
  now += 31000; unread = ['unread B', 'unread C'];
  await worker.tick();
  assert.ok(worker.lastActivityChangeAt);
  assert.equal(cache.read(observation.id).freshness.stale, false);
});

test('HTTP/MCP cached reads do not wait for blocked prefetch; local RPC rejects web origins and missing authentication', async () => {
  const credential = (await cacheAuth(true))!;
  const cache = new TeamsCache(false);
  cache.observe({ ...observation, id: 'assignments/upcoming' });
  cache.observe(observation);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const worker = new BackgroundTeams(cache, { ...fakeBrowser, collect: async route => { calls++; await blocked; return fakeBrowser.collect(route); } });
  const http = createCacheHttpServer(worker, credential.token);
  await new Promise<void>(resolve => http.listen(port, '127.0.0.1', resolve));
  const tick = worker.tick();
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: 'cache-integration', version: '1' });
  await server.connect(b); await client.connect(a);
  try {
    assert.equal((await client.listTools()).tools.length, 19);
    const result = await client.callTool({ name: 'read_cached_context', arguments: { source: 'teams', id: 'assignments/upcoming' } });
    assert.ok(!result.isError);
    const data = JSON.parse((result.content as { text: string }[])[0].text).data;
    assert.equal(data.text, observation.text);
    assert.equal(data.freshness.refreshPending, true);
    const unrelated = await client.callTool({ name: 'read_cached_context', arguments: { id: observation.id } });
    assert.equal(JSON.parse((unrelated.content as { text: string }[])[0].text).data.freshness.refreshPending, false);
    assert.equal(calls, 1, 'cache read does not fetch Teams');
    const denied = await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', body: '{}' });
    assert.equal(denied.status, 401);
    const browserOrigin = await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { Authorization: 'Bearer ' + credential.token, Origin: 'https://evil.example' }, body: '{}' });
    assert.equal(browserOrigin.status, 401);
    const refresh = await client.callTool({ name: 'refresh_context_cache', arguments: { source: 'teams', routeId: 'assignments/upcoming' } });
    assert.ok(!refresh.isError);
    const wrong = await client.callTool({ name: 'refresh_context_cache', arguments: { routeId: 'https://evil.example' } });
    assert.equal(wrong.isError, true);
  } finally { release(); await tick; await client.close(); await server.close(); await new Promise<void>(resolve => http.close(() => resolve())); }
});

test('Discord message cache retains previously seen messages and updates edited IDs without claiming complete history', () => {
  const old = JSON.stringify({ messages: [{ id: '1', text: 'old requirement' }, { id: '2', text: 'existing conversation' }] });
  const next = JSON.stringify({ messages: [{ id: '1', text: 'corrected deadline' }, { id: '3', text: 'new message' }] });
  const merged = JSON.parse(mergeDiscordMessages(old, next));
  assert.equal(merged.messages.length, 3);
  assert.equal(merged.messages.find((m: any) => m.id === '1').text, 'corrected deadline');
  assert.equal(merged.messages.find((m: any) => m.id === '2').text, 'existing conversation');
  assert.equal(merged.historyComplete, false);
});

test('UI route discovery separates duplicate titles/date groups and Discord allows accessible channel URLs only', () => {
  const classes = classRoutes('- group "Programming Team 1 of 2" [ref=f1e1]\n- group "Math Team 2 of 2" [ref=f1e2]');
  assert.equal(classes.length, 2);
  const rows = assignmentRows('- group "Oct 4th"\n- listitem [ref=f4e1]:\n  - generic [ref=f4e2]: Project\n  - generic [ref=f4e3]: Due at 11:59 PM Class A\n- group "Oct 6th"\n- listitem [ref=f4e4]:\n  - generic [ref=f4e5]: Project\n  - generic [ref=f4e6]: Due at 11:59 PM Class B\n', 'Upcoming');
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].route.id, rows[1].route.id);
  assert.equal(discordChannel('https://discord.com/channels/@me/123456789012345678').kind, 'dm');
  assert.equal(discordChannel('https://discord.com/channels/123456789012345678/223456789012345678/323456789012345678').kind, 'channel');
  assert.throws(() => discordChannel('https://discord.com.evil.example/channels/@me/123456789012345678'));
  assert.throws(() => discordChannel('https://discord.com/channels/@me/123456789012345678?token=synthetic'));
  const discovered = discordDiscovered({ guilds: [{ id: '123456789012345678', title: 'School' }], links: [{ path: '/channels/123456789012345678/223456789012345678', title: 'homework' }, { path: '/channels/@me/323456789012345678', title: 'DM' }, { path: '/settings', title: 'Never a message route' }] });
  assert.equal(discovered.length, 3);
  assert.ok(discovered.every(route => route.url?.startsWith('https://discord.com/channels/')));
});
