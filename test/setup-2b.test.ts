import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'ssps-group-setup-'));
process.env.SCHOOLWORK_DATA_DIR = directory;
const { configure2B } = await import('../scripts/setup-2b.mjs');
const { saveSecret } = await import('../dist/store.js');
const { classProfile, saveClassProfile } = await import('../dist/tasks-view.js');
test.after(async () => { await rm(directory, { recursive: true, force: true }); });

test('interactive setup searches names before reading one role profile and saves groups beyond Tasks View', async () => {
  await saveSecret('discord-cache-auth', { token: 'synthetic-local-auth' });
  await saveSecret('bakalari', { base: 'https://bakalari.ssps.cz', accessToken: 'synthetic', refreshToken: 'synthetic', expiresAt: Date.now() + 3600000 });
  const original = globalThis.fetch; const calls: string[] = [];
  const member = { name: 'Synthetic Student', username: 'student', roles: ['matika-Součková', 'Aj Novák', 'PCV | Halbych', 'PVA | Hejduk', 'SK2', 'Němčina', 'Lineární Algebra'], checkedAt: '2026-10-04T16:00:00Z', sourceUrl: 'https://discord.com/channels/1413121869867126856/1423979576358342666' };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('tasks-view.matejruzicka.cz')) return new Response('<h1>Tasks View - 2.B</h1><input id="filter_checkbox_group_m_fre" value="m_fre"><input id="filter_checkbox_group_aj_nov" value="aj_nov"><input id="filter_checkbox_group_sk2" value="sk2"><div class="tasks"></div>');
    if (url.includes('bakalari.ssps.cz')) return Response.json({
      Subjects: [{ Id: 'p', Abbrev: 'PDV', Name: 'Presentations' }, { Id: 'v', Abbrev: 'PVA', Name: 'Programming' }, { Id: 'o', Abbrev: 'OSE1', Name: 'Odborný seminář' }],
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
    select: async (choices: { id: string; name: string }[], defaults: string[], title: string, options?: { max: number }) => {
      if (title.startsWith('How would')) return ['discord'];
      if (title === 'Choose your Discord profile') return ['0'];
      if (title === 'Your class half') { assert.deepEqual(choices.map(g => g.id), ['SK1', 'SK2']); assert.equal(options?.max, 1); }
      if (title === 'Your language') { assert.deepEqual(choices.map(g => g.name), ['Němčina', 'Španělština']); assert.equal(options?.max, 1); }
      assert.ok(!choices.some(g => /OSE|Lineární Algebra|seminář/.test(g.name)));
      calls.push(title); return defaults;
    },
  };
  try {
    await configure2B({ enabled: true, ui, sources: ['bakalari', 'discord'], flags: [] });
    const profile = await classProfile();
    assert.deepEqual(calls.slice(0, 3), ['query', 'class_members', 'class_member']);
    assert.deepEqual(profile?.groups, ['aj_nov', 'sk2']);
    assert.equal(profile?.subjectGroups?.find(g => g.subject === 'MAT')?.teacher, 'Součková');
    assert.equal(profile?.classHalf, 'SK2');
    assert.equal(profile?.subjectGroups?.find(g => g.subject === 'PCV')?.group, 'SK2');
    assert.equal(profile?.subjectGroups?.find(g => g.subject === 'PCV')?.teacher, undefined);
    assert.equal(profile?.subjectGroups?.filter(g => g.subject === 'PVA').length, 1);
    assert.equal(profile?.subjectGroups?.find(g => g.subject === 'PVA')?.teacher, 'Hejduk');
    assert.equal(profile?.subjectGroups?.find(g => g.subject === 'PVA')?.groupId, 'a');
    assert.equal(profile?.subjectGroups?.find(g => g.subject === 'PDV')?.group, 'SK2');
    assert.equal(profile?.subjectGroups?.find(g => g.subject === 'NJ')?.group, 'Němčina');
    assert.ok(!calls.some(title => /^Your (PCV|PDV|HAR|WBA|GRS|TEV|PSI|OSE)/.test(title)));
    assert.ok(!profile?.subjectGroups?.some(g => g.subject.startsWith('OSE')));
    assert.ok(!profile?.subjectGroups?.some(g => g.teacher === 'Šrámek'));
  } finally { globalThis.fetch = original; }
});
test('older profiles migrate shared membership and language labels on unattended upgrades', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<h1>Tasks View - 2.B</h1><input id="filter_checkbox_group_sk2" value="sk2"><div class="tasks"></div>');
  try {
    await saveClassProfile({ enabled: true, className: '2.B', groups: ['sk2'], subjects: ['OSE1'], updatedAt: '2026-10-04', subjectGroups: [
      { subject: 'SK', group: 'SK2', source: 'manual' },
      { subject: 'PCV', group: 'PCV | Halbych', teacher: 'Halbych', source: 'discord' },
      { subject: 'PDV', group: 'SK2', teacher: 'Unconfirmed teacher', source: 'manual' },
      { subject: 'Němčina', group: 'Němčina', source: 'manual' },
      { subject: 'Lineární Algebra', group: 'Lineární Algebra', source: 'manual' },
    ] });
    await configure2B({ enabled: true, ui: null, sources: [], flags: ['--yes'] });
    const profile = await classProfile();
    assert.equal(profile?.classHalf, 'SK2');
    assert.equal(profile?.subjectGroups?.filter(g => g.subject === 'SK' || ['HAR', 'WBA', 'PCV', 'GRS', 'TEV', 'PDV', 'PSI'].includes(g.subject)).length, 8);
    assert.ok(profile?.subjectGroups?.every(g => !g.teacher));
    assert.ok(profile?.subjectGroups?.some(g => g.subject === 'NJ' && g.group === 'Němčina'));
    assert.ok(!profile?.subjectGroups?.some(g => /OSE|Algebra/.test(g.subject)));
    assert.deepEqual(profile?.subjects, []);
  } finally { globalThis.fetch = original; }
});
test('manual class-half and Spanish selections override previous membership for every shared subject', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<h1>Tasks View - 2.B</h1><input id="filter_checkbox_group_sk2" value="sk2"><div class="tasks"></div>');
  const ui = {
    input: async () => { throw new Error('Unexpected teacher prompt'); },
    select: async (_choices: unknown[], defaults: string[], title: string) => title === 'Your class half' ? ['SK1'] : title === 'Your language' ? ['SJ'] : defaults,
  };
  try {
    await configure2B({ enabled: true, ui, sources: [], flags: [] });
    const profile = await classProfile();
    assert.equal(profile?.classHalf, 'SK1');
    assert.ok(profile?.subjectGroups?.filter(g => g.subject !== 'SJ').every(g => g.group === 'SK1'));
    assert.equal(profile?.subjectGroups?.find(g => g.subject === 'SJ')?.group, 'Španělština');
    assert.ok(!profile?.subjectGroups?.some(g => g.subject === 'NJ'));
    assert.deepEqual(profile?.groups, []);
  } finally { globalThis.fetch = original; }
});

test('installer shows one Černovická choice when old Čer. roles and timetable overlap', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => String(input).includes('tasks-view')
    ? new Response('<h1>Tasks View - 2.B</h1><div class="tasks"></div>')
    : Response.json({
      Subjects: [{ Id: 'eng', Abbrev: 'ANG' }],
      Teachers: [{ Id: 'cer', Name: 'Mgr. Veronika Černovická' }],
      Groups: [{ Id: 'SC', Name: '2.B BLOK ANG21' }],
      Days: [{ Atoms: [{ SubjectId: 'eng', TeacherId: 'cer', GroupIds: ['SC'] }] }],
    });
  let englishScreen = false;
  const ui = {
    log() {},
    select: async (choices: { id: string; name: string }[], defaults: string[], title: string) => {
      if (title === 'Your ANG group') {
        englishScreen = true;
        assert.equal(choices.length, 3, 'Černovická, Novák and manual entry only');
        assert.equal(choices.filter(g => g.name.includes('Černovická')).length, 1);
        assert.equal(defaults.length, 1);
      }
      return defaults;
    },
  };
  try {
    await saveClassProfile({ enabled: true, className: '2.B', groups: [], subjects: [], updatedAt: '2026-10-04', discordRoles: ['Aj Čer.'], subjectGroups: [
      { subject: 'SK', group: 'SK1', source: 'manual' },
      { subject: 'ANG', group: 'Aj Čer.', teacher: 'Čer.', source: 'discord', role: 'Aj Čer.' },
      { subject: 'ANG', group: '2.B BLOK ANG21', teacher: 'Mgr. Veronika Černovická', source: 'bakalari', groupId: 'SC' },
    ] });
    await configure2B({ enabled: true, ui: null, sources: [], flags: ['--yes'] });
    assert.equal((await classProfile())?.subjectGroups?.filter(g => g.subject === 'ANG').length, 1, 'Unattended upgrades repair old duplicates');
    await configure2B({ enabled: true, ui, sources: ['bakalari'], flags: [] });
    assert.ok(englishScreen);
    const english = (await classProfile())?.subjectGroups?.filter(g => g.subject === 'ANG');
    assert.equal(english?.length, 1);
    assert.equal(english?.[0].teacher, 'Mgr. Veronika Černovická');
    assert.equal(english?.[0].groupId, 'SC');
  } finally { globalThis.fetch = original; }
});
