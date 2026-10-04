import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'ssps-group-setup-'));
process.env.SCHOOLWORK_DATA_DIR = directory;
const { configure2B } = await import('../scripts/setup-2b.mjs');
const { saveSecret } = await import('../dist/store.js');
const { classProfile } = await import('../dist/tasks-view.js');
test.after(async () => { await rm(directory, { recursive: true, force: true }); });

test('interactive setup searches names before reading one role profile and saves groups beyond Tasks View', async () => {
  await saveSecret('discord-cache-auth', { token: 'synthetic-local-auth' });
  await saveSecret('bakalari', { base: 'https://bakalari.ssps.cz', accessToken: 'synthetic', refreshToken: 'synthetic', expiresAt: Date.now() + 3600000 });
  const original = globalThis.fetch; const calls: string[] = [];
  const member = { name: 'Synthetic Student', username: 'student', roles: ['matika-Součková', 'Aj Novák', 'PCV | Halbych', 'PVA | Hejduk', 'SK2'], checkedAt: '2026-10-04T16:00:00Z', sourceUrl: 'https://discord.com/channels/1413121869867126856/1423979576358342666' };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('tasks-view.matejruzicka.cz')) return new Response('<h1>Tasks View - 2.B</h1><input id="filter_checkbox_group_m_fre" value="m_fre"><input id="filter_checkbox_group_aj_nov" value="aj_nov"><input id="filter_checkbox_group_sk2" value="sk2"><div class="tasks"></div>');
    if (url.includes('bakalari.ssps.cz')) return Response.json({
      Subjects: [{ Id: 'p', Abbrev: 'PDV', Name: 'Presentations' }, { Id: 'v', Abbrev: 'PVA', Name: 'Programming' }],
      Teachers: [{ Id: 'p', Name: 'Pavel Vrána' }, { Id: 'a', Name: 'Michal Hejduk' }, { Id: 'b', Name: 'Šimon Šrámek' }],
      Groups: [{ Id: 'sk', Name: '2.B SK1', Abbrev: '2.B SK1' }, { Id: 'a', Name: 'Programování 21', Abbrev: '2.B PR21' }, { Id: 'b', Name: 'Programování 22', Abbrev: '2.B PR22' }],
      Days: [{ Atoms: [{ SubjectId: 'p', TeacherId: 'p', GroupIds: ['sk'] }, { SubjectId: 'v', TeacherId: 'a', GroupIds: ['a'] }, { SubjectId: 'v', TeacherId: 'b', GroupIds: ['b'] }] }],
    });
    assert.match(url, /^http:\/\/127\.0\.0\.1:/);
    const request = JSON.parse(String(init?.body)); calls.push(request.method);
    if (request.method === 'class_members') { assert.equal(request.args.query, 'student'); return Response.json({ data: { members: [{ ...member, roles: [] }], complete: false } }); }
    assert.equal(request.method, 'class_member'); assert.equal(request.args.username, 'student');
    return Response.json({ data: { ...member, rolesCheckedAt: member.checkedAt } });
  };
  const ui = {
    step: () => 0, run() {}, ok() {}, bad() {}, log() {}, message: async () => {},
    input: async () => { calls.push('query'); return 'student'; },
    select: async (choices: { id: string }[], defaults: string[], title: string) => {
      if (title.startsWith('How would')) return ['discord'];
      if (title === 'Choose your Discord profile') return ['0'];
      calls.push(title); return defaults;
    },
  };
  try {
    await configure2B({ enabled: true, ui, sources: ['bakalari', 'discord'], flags: [] });
    const profile = await classProfile();
    assert.deepEqual(calls.slice(0, 3), ['query', 'class_members', 'class_member']);
    assert.deepEqual(profile?.groups, ['aj_nov', 'sk2']);
    assert.equal(profile?.subjectGroups?.find(g => g.subject === 'MAT')?.teacher, 'Součková');
    assert.equal(profile?.subjectGroups?.find(g => g.subject === 'PCV')?.teacher, 'Halbych');
    assert.equal(profile?.subjectGroups?.filter(g => g.subject === 'PVA').length, 1);
    assert.equal(profile?.subjectGroups?.find(g => g.subject === 'PVA')?.teacher, 'Hejduk');
    assert.equal(profile?.subjectGroups?.find(g => g.subject === 'PVA')?.groupId, 'a');
    assert.equal(profile?.subjectGroups?.find(g => g.subject === 'PDV')?.group, 'SK2');
    assert.ok(!profile?.subjectGroups?.some(g => g.teacher === 'Šrámek'));
  } finally { globalThis.fetch = original; }
});
