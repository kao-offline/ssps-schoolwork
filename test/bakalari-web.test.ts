import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const directory = await mkdtemp(join(tmpdir(), 'schoolwork-web-test-'));
process.env.SCHOOLWORK_DATA_DIR = directory;
process.env.BAKALARI_URL = 'https://bakalari.ssps.cz';
const { saveSecret } = await import('../src/store.js');
const { readWebArea } = await import('../src/bakalari-web.js');
test.after(async () => { await rm(directory, { recursive: true, force: true }); });

test('web-only reads establish a temporary same-school session and omit scripts/hidden credentials', async t => {
  await saveSecret('bakalari', { base: 'https://bakalari.ssps.cz', accessToken: 'synthetic-api-token', refreshToken: 'synthetic-refresh', expiresAt: Date.now() + 3600000 });
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL | string, init?: RequestInit) => {
    const parsed = new URL(url);
    calls.push(parsed.pathname);
    assert.equal(parsed.origin, 'https://bakalari.ssps.cz');
    assert.equal((init?.headers as Record<string, string>)['Accept-Language'], 'cs');
    assert.ok(init?.method === undefined || init.method === 'GET');
    assert.equal(init?.body, undefined);
    assert.ok(init?.redirect === 'manual' || init?.redirect === 'error');
    if (parsed.pathname === '/api/3/logintoken') return Response.json('synthetic-one-time-login');
    if (parsed.pathname === '/api/3/login/synthetic-one-time-login') return new Response(null, { status: 302, headers: { Location: '/dashboard', 'Set-Cookie': 'school_session=synthetic-session; Secure; HttpOnly; Path=/' } });
    assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
    assert.equal((init?.headers as Record<string, string>).Cookie, 'school_session=synthetic-session');
    if (parsed.pathname === '/next/dokumentyPrehled.aspx') return new Response('<html><script>const token="synthetic-hidden-secret"; fetch("/send");</script><input type="hidden" value="synthetic-hidden-secret"><h2>Documents</h2><p>Teacher materials</p><a href="https://storage.example/file?sig=synthetic-signed-secret">Resource file</a></html>', { headers: { 'Content-Type': 'text/html' } });
    if (parsed.pathname === '/Questionnaire/Filling/Questionnaires') return Response.json({ data: [{ Title: 'Class survey', NumberOfQuestions: 3 }], totalCount: 1 });
    throw new Error('Unexpected route');
  });
  const page = await readWebArea('documents');
  assert.equal(page.format, 'page_text');
  assert.match(page.text!, /Teacher materials/);
  assert.ok(!JSON.stringify(page).includes('synthetic-hidden-secret'));
  assert.ok(!JSON.stringify(page).includes('synthetic-session'));
  assert.ok(!JSON.stringify(page).includes('synthetic-signed-secret'));
  assert.match(page.limitation!, /JavaScript-loaded/);
  const surveys = await readWebArea('surveys_open');
  assert.equal(surveys.format, 'json');
  assert.equal((surveys.data as { data: { Title: string }[] }).data[0].Title, 'Class survey');
  assert.ok(!calls.includes('/send'));
  const count = calls.length;
  await assert.rejects(readWebArea('https://evil.example' as never), /Unsupported/);
  assert.equal(calls.length, count);
});

test('web sign-in failure is not mistaken for an empty document collection', async t => {
  t.mock.method(globalThis, 'fetch', async (url: URL | string) => new URL(url).pathname.endsWith('logintoken') ? Response.json('synthetic-one-time-login') : new Response(null, { status: 302, headers: { Location: '/login?ReturnUrl=dashboard' } }));
  await assert.rejects(readWebArea('documents'), /did not establish a session/);
});

test('web JSON application errors are reported and embedded catalogues omit signed access links', async t => {
  t.mock.method(globalThis, 'fetch', async (url: URL | string) => {
    const path = new URL(url).pathname;
    if (path.endsWith('logintoken')) return Response.json('synthetic-one-time-login');
    if (path.startsWith('/api/3/login/')) return new Response(null, { status: 302, headers: { Location: '/dashboard', 'Set-Cookie': 'school_session=synthetic-session; Secure; HttpOnly; Path=/' } });
    if (path.includes('Questionnaires')) return Response.json({ success: false, error: 'Internal application error', data: null });
    return new Response('<script>viewModel = {"levels":[{"name":"Secondary school","thumbnails":[{"fileUrl":"https://storage.example/thumbnail?sig=synthetic-secret&sp=r"}]}]};</script><p>Catalogue</p>', { headers: { 'Content-Type': 'text/html' } });
  });
  await assert.rejects(readWebArea('surveys_open'), /unsuccessful application response/);
  const catalogue = await readWebArea('teaching_resources');
  assert.equal(catalogue.format, 'embedded_json');
  assert.match(JSON.stringify(catalogue), /Secondary school/);
  assert.ok(!JSON.stringify(catalogue).includes('synthetic-secret'));
});
