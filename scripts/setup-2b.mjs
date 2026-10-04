import { classProfile, fetchTasksView, groupsFromRoles, normalizeName, saveClassProfile } from '../dist/tasks-view.js';
import { readClassMembers, readClassMember, searchMembers } from '../dist/discord-members.js';
import { classRoleChoices, roleSubjectGroups, timetableSubjectGroups, suggestedSubjectGroups, sameSubjectGroup, mergeSubjectGroups, taskGroupsForSubjects, splitSubjects, languageGroups, isOseSubject, classHalfFromGroups, groupsForClassHalf } from '../dist/class-groups.js';
import { bak } from '../dist/bakalari.js';
import { loadSecret, saveSecret } from '../dist/store.js';
const values = (flags, name) => flags.find(f => f.startsWith('--' + name + '='))?.slice(name.length + 3).split(',').filter(Boolean);
export async function configure2B({ enabled, ui, sources, flags }) {
  const previous = await classProfile();
  if (!enabled) { if (previous?.enabled) await saveClassProfile({ ...previous, enabled: false, updatedAt: new Date().toISOString() }); return null; }
  let catalogue;
  try { catalogue = await fetchTasksView(); }
  catch { throw new Error('2B: Tasks View could not be loaded. Check your connection and rerun setup; existing profile was preserved.'); }
  if (!/2\.?\s*B/i.test(catalogue.className)) throw new Error('Tasks View no longer identifies class 2.B. Existing profile preserved.');
  let groups = values(flags, 'groups') ?? previous?.groups ?? [];
  let subjects = values(flags, 'subjects') ?? (previous?.subjects || []).filter(s => !isOseSubject(s));
  let memberName = previous?.memberName;
  let discordRoles = previous?.discordRoles || [];
  let subjectGroups = mergeSubjectGroups((previous?.subjectGroups || []).map(group => {
    const language = roleSubjectGroups([group.group]).find(g => ['NJ', 'SJ'].includes(g.subject));
    return language ? { ...group, subject: language.subject, group: language.group, teacher: undefined } : group;
  }).filter(g => !isOseSubject(g.subject)));
  let timetableGroups = [];
  const groupChoices = roleSubjectGroups(classRoleChoices).map(group => ({ ...group, source: 'class-catalogue' }));
  const subjectChoices = new Map(catalogue.items.filter(item => !isOseSubject(item.subject)).map(item => [item.subject, { id: item.subject, name: item.subject, description: 'Read tasks for this subject. No selection means all subjects.' }]));
  const suggestions = new Set(groups);
  if (sources.includes('bakalari') && !flags.includes('--agents-only')) {
    try {
      const timetable = await bak('timetable/permanent');
      timetableGroups = timetableSubjectGroups(timetable);
      groupChoices.push(...timetableGroups);
      const ids = new Set((timetable.Days || []).flatMap(day => (day.Atoms || []).flatMap(atom => atom.GroupIds || [])));
      for (const group of timetable.Groups || []) if (ids.has(group.Id)) for (const code of groupsFromRoles([group.Name, group.Abbrev].filter(Boolean), catalogue.groups)) suggestions.add(code);
      for (const subject of timetable.Subjects || []) if (subject.Abbrev && !isOseSubject(subject.Abbrev)) subjectChoices.set(subject.Abbrev, { id: subject.Abbrev, name: subject.Abbrev + ' · ' + subject.Name, description: 'Subject from your Bakalari timetable.' });
    } catch { ui?.log('Bakalari group suggestions unavailable; choose manually.'); }
  }
  if (ui && !flags.includes('--yes')) {
    if (sources.includes('discord') && !flags.includes('--agents-only')) {
      const mode = await ui.select([{ id: 'discord', name: 'Find my name on Discord', description: 'Read rendered 2.B member names and profile roles locally. You can review every suggested group.' }], [], 'How would you like to choose groups?', { min: 0 });
      if (mode.includes('discord')) {
        const query = await ui.input('Search your name', { required: false, description: 'Name or Discord nickname. Leave blank to browse observed members.' });
        const step = ui.step('Find 2B members'); ui.run(step, 'Loading names only; roles are read after you choose a person');
        let directory;
        try { directory = await readClassMembers(query); if (!directory.members.length) throw new Error('empty directory'); await saveSecret('class-2b-members', directory); ui.ok(step, directory.members.length + ' rendered names'); }
        catch { directory = await loadSecret('class-2b-members'); ui.bad(step, 'Live directory unavailable; saved names may be old'); }
        if (directory?.members.length) {
          const matches = searchMembers(directory.members, query);
          if (matches.length) {
            const choices = matches.map((member, index) => ({ id: String(index), name: member.name + ' · ' + member.username, description: member.roles.join(' · ') + ' | Checked: ' + member.checkedAt }));
            const picked = await ui.select(choices, [], 'Choose your Discord profile', { min: 0, max: 1 });
            if (picked.length > 1) throw new Error('Choose one identity only; rerun setup to correct the selection.');
            if (picked.length) {
              let member = matches[Number(picked[0])];
              const rolesStep = ui.step('Read selected profile roles'); ui.run(rolesStep, 'Reading one profile');
              try {
                member = await readClassMember(member.username);
                const index = directory.members.findIndex(m => m.username === member.username);
                if (index >= 0) directory.members[index] = member;
                await saveSecret('class-2b-members', directory);
                ui.ok(rolesStep, member.roles.length + ' roles verified');
              } catch {
                ui.bad(rolesStep, 'Live roles unavailable; review groups manually');
                await ui.message('Profile roles could not be loaded.', ['Choose your subject groups below.', 'Saved role suggestions, when present, may be old.'], 'Choose groups');
              }
              memberName = member.name; discordRoles = member.roles;
              for (const code of groupsFromRoles(member.roles, catalogue.groups)) suggestions.add(code);
            }
          } else await ui.message('No matching observed name.', ['The directory is partial; offline members may be absent.', 'Continue with manual group selection.'], 'Choose groups');
        } else await ui.message('Discord names are unavailable.', ['Sign in to the class server, or choose groups manually.'], 'Choose groups');
      }
    }
    const suggested = suggestedSubjectGroups(timetableGroups, discordRoles);
    groupChoices.push(...suggested, ...subjectGroups);
    const defaultHalf = classHalfFromGroups(subjectGroups) || classHalfFromGroups(suggested) || classHalfFromGroups(timetableGroups);
    const half = await ui.select([
      { id: 'SK1', name: 'SK1', description: 'First half · HAR, WBA, PCV, GRS, TEV, PDV and PSI' },
      { id: 'SK2', name: 'SK2', description: 'Second half · HAR, WBA, PCV, GRS, TEV, PDV and PSI' },
    ], defaultHalf ? [defaultHalf] : [], 'Your class half', { min: 1, max: 1 });
    if (half.length !== 1 || !['SK1', 'SK2'].includes(half[0])) throw new Error('Choose exactly one class half: SK1 or SK2.');
    const selectedGroups = groupsForClassHalf(half[0], 'manual', timetableGroups);
    const languageDefaults = [...new Set((subjectGroups.some(g => ['NJ', 'SJ'].includes(g.subject)) ? subjectGroups : suggested).filter(g => ['NJ', 'SJ'].includes(g.subject)).map(g => g.subject))];
    const language = await ui.select(languageGroups.map(g => ({ id: g.subject, name: g.group, description: 'Language group' })), languageDefaults.length === 1 ? languageDefaults : [], 'Your language', { min: 0, max: 1 });
    if (language.length > 1 || language.some(id => !['NJ', 'SJ'].includes(id))) throw new Error('Choose Němčina or Španělština.');
    for (const id of language) selectedGroups.push({ ...languageGroups.find(g => g.subject === id), source: 'manual' });
    for (const subject of [...new Set(['MAT', 'ANG', 'PVA', ...groupChoices.map(g => g.subject)])].filter(subject => subject !== 'SK' && !splitSubjects.includes(subject) && !['NJ', 'SJ'].includes(subject) && !isOseSubject(subject))) {
      const choices = mergeSubjectGroups([...suggested, ...subjectGroups, ...groupChoices].filter(g => g.subject === subject));
      const defaults = choices.flatMap((g, index) => (subjectGroups.length ? subjectGroups : suggested).some(s => sameSubjectGroup(s, g)) ? [String(index)] : []);
      const picked = await ui.select([...choices.map((g, index) => ({ id: String(index), name: (g.teacher ? g.teacher + ' · ' : '') + g.group, description: 'Source: ' + g.source + '. Review the suggestion; timetable can contain parallel groups.' })), { id: 'manual', name: 'Enter another teacher or group', description: 'Use your actual group when it is absent from the sources.' }], defaults, 'Your ' + subject + ' group', { min: 0 });
      for (const id of picked) {
        if (id === 'manual') {
          const group = await ui.input(subject + ' teacher / group', { required: true });
          selectedGroups.push({ subject, group, teacher: subject === 'SK' ? undefined : group, source: 'manual' });
        }
        else selectedGroups.push(choices[Number(id)]);
      }
    }
    subjectGroups = selectedGroups;
    if (!values(flags, 'groups')) {
      const mapped = taskGroupsForSubjects(subjectGroups, catalogue.groups);
      groups = await ui.select(catalogue.groups.map(code => ({ id: code, name: code, description: 'Tasks View filter only. It does not list every school group. Class-wide tasks are included.' })), subjectGroups.length ? mapped : [...suggestions].filter(g => catalogue.groups.includes(g)), 'Tasks View filters for your groups', { min: 0 });
    }
    if (!values(flags, 'subjects')) subjects = await ui.select([...subjectChoices.values()], subjects, 'Your 2B subjects · none means all', { min: 0 });
  }
  // Older profiles used teacher-based records for shared subjects. Keep one
  // consistent class-half membership when rerunning unattended upgrades too.
  const classHalf = classHalfFromGroups(subjectGroups);
  const halfSource = subjectGroups.find(g => g.subject === 'SK')?.source || 'manual';
  subjectGroups = [...subjectGroups.filter(g => g.subject !== 'SK' && !splitSubjects.includes(g.subject) && !isOseSubject(g.subject)), ...(classHalf ? groupsForClassHalf(classHalf, halfSource, timetableGroups) : [])];
  if (groups.some(g => !catalogue.groups.includes(g))) throw new Error('Unknown Tasks View group. Use the groups currently offered by Tasks View.');
  if (subjects.some(s => ![...subjectChoices.keys()].some(k => normalizeName(k) === normalizeName(s)))) throw new Error('Unknown 2B subject. Choose a listed subject.');
  const profile = { enabled: true, className: '2.B', groups, subjects, memberName, classHalf, subjectGroups, discordRoles, updatedAt: new Date().toISOString() };
  await saveClassProfile(profile);
  return profile;
}
