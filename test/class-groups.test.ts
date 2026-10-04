import test from 'node:test';
import assert from 'node:assert/strict';
import { roleSubjectGroups, timetableSubjectGroups, suggestedSubjectGroups, taskGroupsForSubjects } from '../src/class-groups.js';
import { DiscordBrowser } from '../src/discord-cache-browser.js';

const timetable = {
  Subjects: [{ Id: 'math', Abbrev: 'MAT' }, { Id: 'prog', Abbrev: 'PVA' }, { Id: 'present', Abbrev: 'PDV' }],
  Teachers: [{ Id: 'm', Name: 'Pavel Miškovský' }, { Id: 'a', Name: 'Michal Hejduk' }, { Id: 'b', Name: 'Šimon Šrámek' }, { Id: 'p', Name: 'Pavel Vrána' }],
  Groups: [{ Id: 'm', Name: 'Matematika 2', Abbrev: '2.B 2ABC' }, { Id: 'a', Name: 'Programování 21', Abbrev: '2.B PR21' }, { Id: 'b', Name: 'Programování 22', Abbrev: '2.B PR22' }, { Id: 'sk', Name: '2.B SK1', Abbrev: '2.B SK1' }],
  Days: [{ Atoms: [{ SubjectId: 'math', TeacherId: 'm', GroupIds: ['m'] }, { SubjectId: 'prog', TeacherId: 'a', GroupIds: ['a'] }, { SubjectId: 'prog', TeacherId: 'b', GroupIds: ['b'] }, { SubjectId: 'present', TeacherId: 'p', GroupIds: ['sk'] }] }],
};
test('screenshot roles map math, English, programming, presentations, electives and SK independently', () => {
  const groups = roleSubjectGroups(['Real 2.B', 'matika-Součková', 'Trusted', 'Aj Novák', 'PCV | Halbych', 'PVA | Hejduk', 'PDV | Vrána', 'SK2', 'Lineární Algebra', 'oznámení', 'Zástupce předsedy třídy']);
  assert.deepEqual(groups.map(g => g.subject), ['MAT', 'ANG', 'PCV', 'PVA', 'PDV', 'SK', 'Lineární Algebra']);
  assert.equal(groups.find(g => g.subject === 'PVA')?.teacher, 'Hejduk');
  assert.deepEqual(taskGroupsForSubjects(groups, ['m_fre', 'aj_nov', 'sk2']), ['aj_nov', 'sk2']);
  assert.deepEqual(taskGroupsForSubjects([{ subject: 'MAT', group: 'Matematika', teacher: 'Mgr. Jan Freisleben', source: 'bakalari' }], ['m_fre']), ['m_fre']);
});
test('parallel timetable groups remain choices and Discord subject roles override suggestions', () => {
  const choices = timetableSubjectGroups(timetable);
  assert.equal(choices.filter(g => g.subject === 'PVA').length, 2);
  assert.ok(!suggestedSubjectGroups(choices, []).some(g => g.subject === 'PVA'));
  const suggested = suggestedSubjectGroups(choices, ['matika-Součková', 'PVA | Hejduk', 'SK2']);
  assert.deepEqual(suggested.filter(g => g.subject === 'PVA').map(g => g.teacher), ['Hejduk']);
  assert.deepEqual(suggested.filter(g => g.subject === 'MAT').map(g => g.teacher), ['Součková']);
  assert.equal(suggested.find(g => g.subject === 'PDV')?.group, 'SK2', 'Use the SK2 role for the shared presentation split');
  assert.equal(suggested.find(g => g.subject === 'PDV')?.teacher, undefined, 'Do not invent the other group teacher');
  assert.ok(choices.some(g => g.subject === 'PDV' && g.groupId === 'sk'));
});
const page = 'Page URL: https://discord.com/channels/1413121869867126856/1423979576358342666\n';
const result = (value: unknown) => '### Result\n' + JSON.stringify(value);
test('name lookup never opens all profiles and returns observed names if later scrolling fails', async () => {
  const b = new DiscordBrowser(); const calls: string[] = [];
  b.text = async (name, args = {}) => {
    calls.push(name);
    if (name === 'browser_snapshot') return page;
    if (name === 'browser_evaluate' && String(args.function).includes('const label =')) return result([{ id: 'members-1', label: 'student, Online', name: 'Student Name' }]);
    throw new Error('transient scrolling failure');
  };
  const directory = await b.classMembers();
  assert.equal(directory.members[0].name, 'Student Name');
  assert.deepEqual(directory.members[0].roles, []);
  assert.ok(directory.warning);
  assert.ok(!calls.includes('browser_click'));
  assert.equal(directory.complete, false);
});
test('selected lookup reads one exact username and keeps roles provenance', async () => {
  const b = new DiscordBrowser(); let profiles = 0;
  b.text = async (name, args = {}) => {
    if (name === 'browser_snapshot') return page + '- img "student, Online" [ref=e1]\n';
    if (name !== 'browser_evaluate') return '';
    const fn = String(args.function);
    if (fn.includes('const label =')) return result([{ id: 'members-1', label: 'student, Online', name: 'Student' }, { id: 'members-2', label: 'another, Online', name: 'Another' }]);
    if (fn.includes('const expected =')) { profiles++; assert.ok(fn.includes('"student"')); return result({ name: 'Student', username: 'student', roles: ['PVA | Hejduk'] }); }
    return result(null);
  };
  const selected = await b.classMember('student');
  assert.equal(profiles, 1);
  assert.deepEqual(selected.roles, ['PVA | Hejduk']);
  assert.ok(selected.rolesCheckedAt);
});
