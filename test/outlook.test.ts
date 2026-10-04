import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const directory = await mkdtemp(join(tmpdir(), 'outlook-reader-'));
process.env.SCHOOLWORK_DATA_DIR = directory;
const { OutlookBrowser, outlookInitialRoutes } = await import('../src/outlook-browser.js');
const { TeamsCache, cacheId } = await import('../src/teams-cache.js');
const { BackgroundTeams, createCacheHttpServer } = await import('../src/teams-cache-worker.js');
const { cacheAuth } = await import('../src/teams-cache-client.js');
const { createServer } = await import('../src/server.js');
const { saveClassProfile } = await import('../src/tasks-view.js');
test.after(async () => { await rm(directory, { recursive: true, force: true }); });

test('attachments extract once, delete originals, continue coherent chunks and expire unsupported downloads', async () => {
  const root = join(directory, 'outlook-browser-output');
  await mkdir(root, { recursive: true });
  const browser = new OutlookBrowser();
  let downloads = 0; let now = Date.now();
  const cache = new TeamsCache(false); cache.bindAccount('Student');
  const worker = new BackgroundTeams(cache, browser, () => now, 'outlook');
  const id = cacheId('email', 'attachment-fixture');
  worker.routes.set(id, { id, kind: 'email', title: 'Files', mailKey: 'attachment-fixture', intervalMs: 900000 });
  browser.downloadAttachment = async (_route, name) => {
    downloads++;
    await writeFile(join(root, name), name.endsWith('.txt') ? 'Weekly information '.repeat(50) : 'invalid or unsupported bytes');
    return { owner: 'Student', mailId: id, name, downloadFile: name, sourceUrl: 'https://outlook.office.com/mail/inbox/id/fixture', source: 'outlook-browser-download', downloadedAt: new Date(now).toISOString() };
  };
  const first = await worker.rpc('read_attachment', { id, name: 'meeting.txt', maxCharacters: 100 }) as any;
  assert.equal(first.parts[0].text.length, 100); assert.equal(first.nextOffset, 100);
  assert.equal(first.originalFileRetained, false); assert.equal(first.localPath, undefined);
  await assert.rejects(access(join(root, 'meeting.txt')));
  const next = await worker.rpc('read_attachment', { id, name: 'meeting.txt', offset: first.nextOffset, maxCharacters: 100, expectedContentHash: first.contentHash }) as any;
  assert.equal(next.cachedText, true); assert.equal(downloads, 1);
  await assert.rejects(worker.rpc('read_attachment', { id, name: 'meeting.txt', expectedContentHash: '0'.repeat(64) }), /changed between chunks/);
  assert.equal(worker.leaseUntil, 0);
  const image = await worker.rpc('read_attachment', { id, name: 'image.png' }) as any;
  assert.equal(image.originalFileRetained, true); assert.match(image.extractionError, /Unsupported/);
  await access(image.localPath);
  now += 16 * 60000; await worker.pruneAttachments();
  assert.equal(worker.attachments.size, 0); await assert.rejects(access(image.localPath));
  await assert.rejects(worker.rpc('read_attachment', { id, name: 'corrupt.docx' }));
  await assert.rejects(access(join(root, 'corrupt.docx')), 'Failed extraction also removes its temporary original');
  const { readBrowserDownload, removeBrowserDownload } = await import('../src/teams-downloads.js');
  const outside = join(directory, 'outside.txt'); await writeFile(outside, 'private');
  await assert.rejects(readBrowserDownload(outside, 'outlook'), /outside/);
  await assert.rejects(removeBrowserDownload(outside, 'outlook'), /outside/);
  await access(outside);
});

test('attachment download uses only the selected attachment submenu and requires a verified download event', async () => {
  const browser = new OutlookBrowser();
  const route = { id: cacheId('email', 'one'), kind: 'email' as const, title: 'Mail', mailKey: 'one', intervalMs: 900000 };
  browser.collect = async () => ({ owner: 'Student', discovered: [], observations: [{ id: route.id, kind: 'email', title: 'Mail', sourceUrl: 'https://outlook.office.com/mail/inbox/id/one', text: JSON.stringify({ attachments: [{ name: 'brief.txt', label: 'brief.txt Open 1 kB' }] }) }] });
  const clicks: string[] = []; let menu = false; let verified = true;
  browser.text = async (name, args = {}) => {
    if (name === 'browser_snapshot') return '### Snapshot\n```yaml\n' + (menu ? '- menuitem "Download" [ref=e3]' : '- option "brief.txt Open 1 kB" [ref=e1]\n  - button "More actions" [ref=e2]') + '\n```';
    if (name === 'browser_click') { clicks.push(String(args.target)); menu = true; return args.target === 'e3' && verified ? 'Downloaded file brief.txt to "' + join(directory, 'outlook-browser-output', 'brief.txt') + '"' : ''; }
    return '';
  };
  assert.equal((await browser.downloadAttachment(route, 'brief.txt')).downloadFile, 'brief.txt');
  assert.deepEqual(clicks, ['e2', 'e3']);
  await assert.rejects(browser.downloadAttachment(route, 'other.txt'), /absent or ambiguous/);
  verified = false; menu = false;
  await assert.rejects(browser.downloadAttachment(route, 'brief.txt'), /not_verified/);
});

test('Outlook fixed reader discovers previews then reads exactly one observed mail; auth walls fail', async () => {
  const browser = new OutlookBrowser();
  const calls: { name: string; args: any }[] = [];
  let authenticated = true;
  browser.text = async (name, args = {}) => {
    calls.push({ name, args });
    if (name === 'browser_snapshot') return 'Page URL: ' + (authenticated ? 'https://outlook.office.com/mail/inbox' : 'https://login.microsoftonline.com/') + '\n### Snapshot\n```yaml\n- option "Teacher Project Friday" [ref=e1]\n```';
    if (name === 'browser_evaluate') {
      const body = String(args.function).includes('const expectedKey');
      if (body) assert.ok(String(args.function).includes('"conversation-1"'));
      return '### Result\n' + JSON.stringify(body ? { body: 'Build a parser. Due Friday.', bodyLoaded: true, headers: 'Teacher', truncated: false } : { owner: 'Fixture Student', listLoaded: true, messages: [{ key: 'conversation-1', label: 'Teacher Project Friday', preview: 'Project preview' }], coverage: 'loaded rows' });
    }
    return '';
  };
  const inbox = await browser.collect(outlookInitialRoutes[0]);
  assert.equal(inbox.discovered.length, 1);
  assert.equal(inbox.discovered[0].foregroundOnly, true);
  assert.equal(calls.filter(c => c.name === 'browser_click').length, 0);
  assert.equal(JSON.parse(inbox.observations[0].text).messages[0].bodyLoaded, false);
  const message = await browser.collect(inbox.discovered[0]);
  assert.match(message.observations[0].text, /Build a parser/);
  assert.equal(calls.filter(c => c.name === 'browser_click').length, 1);
  assert.equal(calls.find(c => c.name === 'browser_click')?.args.target, 'e1');
  authenticated = false;
  await assert.rejects(browser.collect(outlookInitialRoutes[0]), /authentication_or_outlook/);
});

test('Porada vedeni arrives in one call: live search plus latest bodies, no disk sync', async () => {
  const cache = new TeamsCache(false);
  const first = cacheId('email', 'porada-40');
  const second = cacheId('email', 'porada-39');
  const inboxUrl = 'https://outlook.office.com/mail/inbox';
  let searches = 0;
  const worker = new BackgroundTeams(cache, {
    call: async () => ({}), close: async () => {}, tools: async () => [],
    collect: async route => {
      if (route.kind === 'mailbox') {
        searches++;
        assert.equal(route.mailQuery, 'Porada');
        return {
          owner: 'Fixture Student',
          observations: [{ id: route.id, kind: 'mailbox' as const, title: 'search', sourceUrl: inboxUrl, text: JSON.stringify({ messages: [{ id: first, sender: 'Vedeni', subject: 'Porada vedeni 40', bodyLoaded: false }, { id: second, sender: 'Vedeni', subject: 'Porada vedeni 39', bodyLoaded: false }], coverage: 'test search' }) }],
          discovered: [
            { id: first, kind: 'email' as const, title: 'Porada vedeni 40', mailKey: 'porada-40', intervalMs: 900000, foregroundOnly: true },
            { id: second, kind: 'email' as const, title: 'Porada vedeni 39', mailKey: 'porada-39', intervalMs: 900000, foregroundOnly: true },
          ],
        };
      }
      return { owner: 'Fixture Student', observations: [{ id: route.id, kind: 'email' as const, title: route.title, sourceUrl: inboxUrl + '/id/fixture', text: JSON.stringify({ body: 'Weekly notes for ' + route.title + '.', bodyLoaded: true, attachments: [{ name: 'porada-tyden.docx', label: 'porada-tyden.docx Open 2 MB' }] }) }], discovered: [] };
    },
  }, () => Date.now(), 'outlook');
  cache.bindAccount('Fixture Student');
  const credential = (await cacheAuth(true, 'outlook'))!;
  const http = createCacheHttpServer(worker, credential.token);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  process.env.SCHOOLWORK_OUTLOOK_CACHE_PORT = String((http.address() as { port: number }).port);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer(); const client = new Client({ name: 'porada-test', version: '1' });
  await server.connect(b); await client.connect(a);
  try {
    const result = await client.callTool({ name: 'read_porada_vedeni', arguments: { query: 'Porada', mails: 2 } });
    assert.ok(!result.isError, JSON.stringify(result));
    const data = JSON.parse((result.content as { text: string }[])[0].text).data;
    assert.equal(searches, 1);
    assert.equal(data.previews.length, 2);
    assert.equal(data.items.length, 2);
    assert.match(data.items[0].text, /Weekly notes for Porada vedeni 40/);
    assert.match(data.items[0].text, /porada-tyden.docx/);
    assert.equal(worker.leaseUntil, 0);
    const leftovers = await import('node:fs/promises').then(fs => fs.readdir(join(directory, 'outlook-browser-output')).catch(() => []));
    assert.deepEqual(leftovers, [], 'Porada search stores no documents on disk');
    const again = await client.callTool({ name: 'read_outlook_mail', arguments: { ids: [first] } });
    assert.ok(!again.isError, 'Search-discovered mails stay openable');
  } finally { await client.close(); await server.close(); await new Promise<void>(resolve => http.close(() => resolve())); }
});

test('Outlook HTTP/MCP mail access and one-call context retain errors and bound requests', async () => {
  const cache = new TeamsCache(false);
  const mailId = cacheId('email', 'conversation-1');
  let opened = 0;
  const worker = new BackgroundTeams(cache, {
    call: async () => ({}), close: async () => {}, tools: async () => [],
    collect: async route => {
      opened++;
      return { owner: 'Fixture Student', observations: [{ id: route.id, kind: 'email' as const, title: 'School project', parentId: 'outlook/inbox', sourceUrl: 'https://outlook.office.com/mail/inbox/id/fixture', text: JSON.stringify({ body: 'Build a parser.', bodyLoaded: true, attachmentsDownloaded: false }) }], discovered: [] };
    },
  }, () => Date.now(), 'outlook');
  cache.bindAccount('Fixture Student');
  cache.observe({ id: 'outlook/inbox', kind: 'mailbox', title: 'Inbox', sourceUrl: 'https://outlook.office.com/mail/inbox', text: JSON.stringify({ messages: [{ id: mailId, sender: 'Teacher', subject: 'School project', preview: 'Build a parser', bodyLoaded: false }], coverage: 'visible inbox only' }) });
  worker.routes.set(mailId, { id: mailId, kind: 'email', title: 'School project', mailKey: 'conversation-1', intervalMs: 900000, foregroundOnly: true });
  worker.requested.clear(); worker.nextCheck.set('outlook/inbox', Date.now() + 100000);
  await worker.tick();
  assert.equal(opened, 0, 'Inbox polling never opens bodies automatically');
  await assert.rejects(worker.rpc('browser', { name: 'browser_click', arguments: {} }), /fixed mail reads/);
  await assert.rejects(worker.rpc('read_mail', { ids: ['https://evil.example'] }), /Invalid/);
  const credential = (await cacheAuth(true, 'outlook'))!;
  const http = createCacheHttpServer(worker, credential.token);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  process.env.SCHOOLWORK_OUTLOOK_CACHE_PORT = String((http.address() as { port: number }).port);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer(); const client = new Client({ name: 'outlook-test', version: '1' });
  await server.connect(b); await client.connect(a);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse((result.content as { text: string }[])[0].text).data;
  };
  try {
    const listed = await call('list_outlook_mail', { query: 'project' });
    assert.equal(listed.items.length, 1); assert.equal(listed.items[0].id, mailId);
    assert.equal(listed.historyComplete, false); assert.equal(listed.freshness.stale, false);
    const read = await call('read_outlook_mail', { ids: [mailId, 'email/' + '0'.repeat(24)] });
    assert.match(read.items[0].text, /Build a parser/); assert.equal(read.items[1].isError, true);
    assert.equal(opened, 1); assert.equal(worker.leaseUntil, 0);
    await call('read_outlook_mail', { ids: [mailId, mailId] });
    assert.equal(opened, 1, 'Fresh cached bodies and duplicate IDs do not reopen messages');
    const originalFetch = globalThis.fetch;
    let rpc = 0;
    globalThis.fetch = async (input, options) => { rpc++; return originalFetch(input, options); };
    try {
      const context = await call('read_school_context', { sources: ['outlook', 'discord'], maxCharacters: 5000 });
      assert.equal(context.sections.length, 2);
      assert.equal(context.sections[0].source, 'outlook');
      assert.equal(context.sections[1].isError, true, 'Missing source does not discard mail or pretend to be empty');
      assert.equal(rpc, 1, 'Health and complete cached mail arrive in one worker request');
      assert.equal(opened, 1, 'Aggregate cache reads never reopen mail');
      const large = 'x'.repeat(20000);
      cache.observe({ id: mailId, kind: 'email', title: 'Large mail', sourceUrl: 'https://outlook.office.com/mail/inbox', text: large });
      const limited = await call('read_school_context', { sources: ['outlook'], maxCharacters: 2000 });
      assert.ok(limited.truncated || limited.sections[0].data.incomplete);
    } finally { globalThis.fetch = originalFetch; }
    await saveClassProfile({ enabled: false, className: '2.B', groups: [], subjects: [], updatedAt: '2026-10-04' });
    process.env.SCHOOLWORK_SOURCES = 'outlook';
    const selected = await call('read_school_context', {});
    assert.deepEqual(selected.sections.map((section: any) => section.source), ['outlook']);
    const batch = await call('read_schoolwork_batch', { requests: [{ tool: 'list_outlook_mail' }, { tool: 'read_2b_profile' }] });
    assert.equal(batch.results.length, 2);
    const savedFetch = globalThis.fetch;
    let active = 0; let peak = 0;
    globalThis.fetch = async (_input, options) => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active--;
      return Response.json({ data: { query: JSON.parse(String(options?.body)).args.query } });
    };
    try {
      const parallel = await call('read_schoolwork_batch', { requests: Array.from({ length: 6 }, (_, index) => ({ tool: 'read_context_bundle', arguments: { source: 'outlook', query: String(index) } })) });
      assert.equal(peak, 3, 'Independent reads run concurrently with at most three upstream requests');
      assert.deepEqual(parallel.results.map((r: any) => r.data.query), ['0', '1', '2', '3', '4', '5']);
    } finally { globalThis.fetch = savedFetch; }
  } finally { delete process.env.SCHOOLWORK_SOURCES; await client.close(); await server.close(); await new Promise<void>(resolve => http.close(() => resolve())); }
});
