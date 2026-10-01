import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { PublicClientApplication } from '@azure/msal-node';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const directory = await mkdtemp(join(tmpdir(), 'schoolwork-test-'));
process.env.SCHOOLWORK_DATA_DIR = directory;
process.env.MICROSOFT_CLIENT_ID = 'test-public-client';
process.env.BAKALARI_URL = 'https://bakalari.ssps.cz';
const { saveSecret, loadSecret } = await import('../src/store.js');
const { extract, documentWindow, plain, filename } = await import('../src/documents.js');
const { createServer } = await import('../src/server.js');
const { graphList } = await import('../src/teams.js');
const { request, boundedBytes } = await import('../src/http.js');
const { bakToken } = await import('../src/auth.js');

test.after(async () => { await rm(directory, { recursive: true, force: true }); });

test('credential roundtrip protects tokens on Windows', async () => {
  await saveSecret('fixture', { accessToken: 'synthetic-test-token' });
  assert.deepEqual(await loadSecret('fixture'), { accessToken: 'synthetic-test-token' });
  if (process.platform === 'win32') assert.ok(!(await readFile(join(directory, 'fixture.json'), 'utf8')).includes('synthetic-test-token'));
  assert.equal(await loadSecret('missing'), undefined);
});

test('Office extraction preserves slide order, decodes XML and reads Word paragraphs', async () => {
  const pptx = zipSync({
    'ppt/slides/slide10.xml': strToU8('<p:sld xmlns:p="p" xmlns:a="a"><a:t>Final</a:t></p:sld>'),
    'ppt/slides/slide2.xml': strToU8('<p:sld xmlns:p="p" xmlns:a="a"><a:t>Research &amp; plan</a:t></p:sld>'),
  });
  assert.deepEqual(await extract(Buffer.from(pptx), 'brief.pptx', ''), [{ reference: 'slide 1', text: 'Research & plan' }, { reference: 'slide 2', text: 'Final' }]);
  const docx = zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Submit the source code.</w:t></w:r></w:p></w:body></w:document>'),
  });
  assert.match((await extract(Buffer.from(docx), 'requirements.docx', ''))[0].text, /Submit the source code/);
});

test('PDF extraction keeps page references', async () => {
  const stream = 'BT /F1 12 Tf 50 700 Td (Project requirements) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const parts = await extract(Buffer.from(pdf), 'project.pdf', 'application/pdf');
  assert.equal(parts[0].reference, 'page 1');
  assert.match(parts[0].text, /Project requirements/);
});

test('document chunks span references without dropping text; unsafe types fail', async () => {
  const document = { parts: [{ reference: 'page 1', text: 'abcde' }, { reference: 'page 2', text: 'fghij' }] };
  const first = documentWindow(document, 0, 7);
  assert.deepEqual(first.parts.map(p => p.text), ['abcde', 'fg']);
  assert.equal(first.nextOffset, 7);
  const second = documentWindow(document, first.nextOffset!, 7);
  assert.equal(second.parts[0].text, 'hij');
  assert.equal(second.nextOffset, null);
  assert.equal(documentWindow({ parts: [{ reference: 'page 1', text: '' }] }, 0, 100).emptyText, true);
  await assert.rejects(extract(Buffer.from('MZ'), 'program.exe', 'application/octet-stream'), /Unsupported/);
  assert.match(plain('<p>Read <a href="https://school.example/brief">the brief</a></p><script>evil()</script>'), /school.example/);
  assert.equal(filename("attachment; filename*=UTF-8''zad%C3%A1n%C3%AD.pdf"), 'zadání.pdf');
});

test('HTTP failures exclude upstream secrets and oversized downloads abort', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('secret upstream detail', { status: 403 }));
  await assert.rejects(request('https://example.com'), error => error instanceof Error && /HTTP 403/.test(error.message) && !error.message.includes('secret upstream'));
  await assert.rejects(boundedBytes(new Response('123456'), 5), /limit/);
});

test('expired Bakalari credentials refresh once and save rotated tokens without passwords', async t => {
  await saveSecret('bakalari', { base: 'https://bakalari.ssps.cz', accessToken: 'expired-test-token', refreshToken: 'old-test-refresh', expiresAt: 0 });
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    requests++;
    assert.equal(url, 'https://bakalari.ssps.cz/api/login');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>)['Accept-Language'], 'cs');
    const body = init?.body as URLSearchParams;
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'old-test-refresh');
    assert.equal(body.has('password'), false);
    await new Promise(resolve => setTimeout(resolve, 20));
    return Response.json({ access_token: 'rotated-test-token', refresh_token: 'new-test-refresh', expires_in: 3600 });
  });
  assert.deepEqual(await Promise.all([bakToken(), bakToken()]), ['rotated-test-token', 'rotated-test-token']);
  assert.equal(requests, 1);
  const saved = await loadSecret<Record<string, unknown>>('bakalari');
  assert.equal(saved?.refreshToken, 'new-test-refresh');
  assert.equal(saved?.password, undefined);
});

test('MCP tools integrate with paginated Graph and Bakalari fixtures and reject external credential forwarding', async t => {
  t.mock.method(PublicClientApplication.prototype, 'getTokenCache', () => ({ getAllAccounts: async () => [{}] }));
  t.mock.method(PublicClientApplication.prototype, 'acquireTokenSilent', async () => ({ accessToken: 'synthetic-microsoft-token' }));
  await saveSecret('bakalari', { base: 'https://bakalari.ssps.cz', accessToken: 'synthetic-bak-token', refreshToken: 'synthetic-refresh', expiresAt: Date.now() + 3_600_000 });
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const path = new URL(url).pathname;
    if (new URL(url).hostname === 'bakalari.ssps.cz' && (init?.headers as Record<string, string>)['Accept-Language'] !== 'cs') {
      return Response.json({ Message: 'An error has occurred.' }, { status: 500 });
    }
    if (path.endsWith('/assignments/a/resources')) return Response.json({ value: [{ id: 'r', resource: { displayName: 'brief.txt', fileUrl: 'https://school.sharepoint.com/brief.txt' } }] });
    if (path.endsWith('/assignments/a')) return Response.json({ id: 'a', displayName: 'Programming project', instructions: { content: '<p>Build a parser.</p>' } });
    if (path.endsWith('/assignments')) return Response.json({ value: [{ id: 'a', displayName: 'Programming project', instructions: { content: '<p>Build a parser.</p>' }, dueDateTime: '2026-10-02T22:30:00Z' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/second-page' });
    if (path.endsWith('/second-page')) return Response.json({ value: [{ id: 'b', displayName: 'Later', dueDateTime: '2026-10-08T12:00:00Z' }] });
    if (path.endsWith('/homeworks')) return Response.json({ Homeworks: [{ ID: 'h', Content: 'Read chapter one', DateEnd: '2026-10-03T00:00:00+02:00', Subject: { Name: 'Český jazyk' }, Attachments: [{ Id: 'file', Name: 'brief.txt' }] }] });
    if (path.endsWith('/messages/received')) {
      assert.equal(init?.method, 'POST');
      return Response.json({ Messages: [{ Id: 'm', Text: '<p>Deadline moved.</p>', Title: 'Project update' }] });
    }
    if (path.endsWith('/attachment/file')) return new Response('Homework document requirements', { headers: { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="brief.txt"' } });
    if (path.endsWith('/messages/m/replies')) return Response.json({ value: [{ id: 'reply', body: { content: '<p>Submit Friday.</p>' } }] });
    if (path.endsWith('/messages/m')) return Response.json({ id: 'm', body: { content: 'Project' } });
    if (path.endsWith('/items/i')) return Response.json({ name: 'brief.txt', webUrl: 'https://school.sharepoint.com/brief.txt', '@microsoft.graph.downloadUrl': 'https://school.sharepoint.com/download' });
    if (path === '/download') { assert.ok(!(init?.headers as Record<string, string>)?.Authorization); return new Response('Build and document your parser.', { headers: { 'content-type': 'text/plain' } }); }
    if (path.endsWith('/me')) return Response.json({ id: 'student' });
    if (path.endsWith('/user')) return Response.json({ UserId: 'student' });
    throw new Error('Unexpected fixture route');
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: 'integration-test', version: '1' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse((result.content as { text: string }[])[0].text).data;
  }
  try {
    assert.equal((await client.listTools()).tools.length, 10);
    const works = await call('list_schoolwork', { source: 'teams', classId: 'c', from: '2026-10-03', to: '2026-10-03' });
    assert.equal(works.items.length, 1); // Prague deadline crosses midnight from UTC.
    assert.equal(works.items[0].id, 'a');
    assert.equal(works.incomplete, false);
    const homework = await call('list_schoolwork', { source: 'bakalari', from: '2026-10-03', to: '2026-10-03' });
    assert.equal(homework.items[0].duePrecision, 'date');
    const detail = await call('get_assignment', { classId: 'c', assignmentId: 'a' });
    assert.equal(detail.resources.items[0].id, 'r');
    assert.match(detail.assignment.instructions, /Build a parser/);
    const announcement = await call('list_announcements', { source: 'bakalari', query: 'deadline' });
    assert.equal(announcement.items[0].id, 'm');
    assert.match((await call('get_thread', { teamId: 't', channelId: 'c', messageId: 'm' })).replies.items[0].text, /Friday/);
    assert.match((await call('read_document', { source: 'teams', driveId: 'd', itemId: 'i' })).parts[0].text, /parser/);
    assert.match((await call('read_document', { source: 'bakalari', attachmentId: 'file' })).parts[0].text, /requirements/);
    const status = await call('connection_status', {});
    assert.equal(status.teams.connected, true);
    assert.equal(status.bakalari.connected, true);
    const before = calls.length;
    const blocked = await client.callTool({ name: 'resolve_document_link', arguments: { url: 'https://evil.example/steal' } });
    assert.equal(blocked.isError, true);
    assert.equal(calls.length, before);
    await assert.rejects(graphList('https://evil.example/v1.0/steal'), /Invalid/);
    assert.ok(calls.every(c => c.init?.redirect === 'error'));
    t.mock.method(globalThis, 'fetch', async () => Response.json({ value: [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/loop' }));
    assert.equal((await graphList('/loop')).incomplete, true);
    t.mock.method(globalThis, 'fetch', async () => new Response('private failure', { status: 403 }));
    const failed = await client.callTool({ name: 'list_schoolwork', arguments: { source: 'teams', classId: 'c', from: '2026-10-01', to: '2026-10-07' } });
    assert.equal(failed.isError, true);
    assert.ok(!JSON.stringify(failed).includes('private failure'));
    const badDate = await client.callTool({ name: 'list_schoolwork', arguments: { source: 'bakalari', from: '2026-02-31', to: '2026-03-01' } });
    assert.equal(badDate.isError, true);
  } finally { await client.close(); await server.close(); }
});

test('built server starts over stdio and gives actionable disconnected status without credentials', async () => {
  const client = new Client({ name: 'stdio-smoke', version: '1' });
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const empty = await mkdtemp(join(tmpdir(), 'schoolwork-empty-'));
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], env: { ...env, SCHOOLWORK_DATA_DIR: empty, MICROSOFT_CLIENT_ID: '' }, stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 10);
    const result = await client.callTool({ name: 'connection_status', arguments: {} });
    const data = JSON.parse((result.content as { text: string }[])[0].text).data;
    assert.equal(data.teams.connected, false);
    assert.equal(data.bakalari.connected, false);
    assert.match(data.teams.error, /MICROSOFT_CLIENT_ID/);
    assert.match(data.bakalari.error, /login:bakalari/);
    assert.ok(!stderr.includes('synthetic'));
  } finally { await client.close(); await rm(empty, { recursive: true, force: true }); }
});
