import { classProfile, fetchTasksView, groupsFromRoles, normalizeName, saveClassProfile } from '../dist/tasks-view.js';
import { readClassMembers, searchMembers } from '../dist/discord-members.js';
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
  let subjects = values(flags, 'subjects') ?? previous?.subjects ?? [];
  let memberName = previous?.memberName;
  const subjectChoices = new Map(catalogue.items.map(item => [item.subject, { id: item.subject, name: item.subject, description: 'Read tasks for this subject. No selection means all subjects.' }]));
  const suggestions = new Set(groups);
  if (sources.includes('bakalari') && !flags.includes('--agents-only')) {
    try {
      const timetable = await bak('timetable/permanent');
      const ids = new Set((timetable.Days || []).flatMap(day => (day.Atoms || []).flatMap(atom => atom.GroupIds || [])));
      for (const group of timetable.Groups || []) if (ids.has(group.Id)) for (const code of groupsFromRoles([group.Name, group.Abbrev].filter(Boolean), catalogue.groups)) suggestions.add(code);
      for (const subject of timetable.Subjects || []) if (subject.Abbrev) subjectChoices.set(subject.Abbrev, { id: subject.Abbrev, name: subject.Abbrev + ' · ' + subject.Name, description: 'Subject from your Bakalari timetable.' });
    } catch { ui?.log('Bakalari group suggestions unavailable; choose manually.'); }
  }
  if (ui && !flags.includes('--yes')) {
    if (sources.includes('discord') && !flags.includes('--agents-only')) {
      const mode = await ui.select([{ id: 'discord', name: 'Find my name on Discord', description: 'Read rendered 2.B member names and profile roles locally. You can review every suggested group.' }], [], 'How would you like to choose groups?', { min: 0 });
      if (mode.includes('discord')) {
        const step = ui.step('Read 2B member roles'); ui.run(step, 'Reading the class server · this can take up to 3 minutes');
        let directory;
        try { directory = await readClassMembers(); if (!directory.members.length) throw new Error('empty directory'); await saveSecret('class-2b-members', directory); ui.ok(step, directory.members.length + ' rendered names'); }
        catch { directory = await loadSecret('class-2b-members'); ui.bad(step, 'Live directory unavailable; saved names may be old'); }
        if (directory?.members.length) {
          const query = await ui.input('Search your name', { required: false, description: 'Name or Discord nickname. Leave blank to browse observed members.' });
          const matches = searchMembers(directory.members, query);
          if (matches.length) {
            const choices = matches.map((member, index) => ({ id: String(index), name: member.name + ' · ' + member.username, description: member.roles.join(' · ') + ' | Checked: ' + member.checkedAt }));
            const picked = await ui.select(choices, [], 'Choose your Discord profile', { min: 0, max: 1 });
            if (picked.length > 1) throw new Error('Choose one identity only; rerun setup to correct the selection.');
            if (picked.length) { const member = matches[Number(picked[0])]; memberName = member.name; for (const code of groupsFromRoles(member.roles, catalogue.groups)) suggestions.add(code); }
          } else await ui.message('No matching observed name.', ['The directory is partial; offline members may be absent.', 'Continue with manual group selection.'], 'Choose groups');
        } else await ui.message('Discord names are unavailable.', ['Sign in to the class server, or choose groups manually.'], 'Choose groups');
      }
    }
    if (!values(flags, 'groups')) groups = await ui.select(catalogue.groups.map(code => ({ id: code, name: code, description: 'Tasks View group. Class-wide tasks are always included. Suggestions can be changed.' })), [...suggestions].filter(g => catalogue.groups.includes(g)), 'Your 2B groups', { min: 0 });
    if (!values(flags, 'subjects')) subjects = await ui.select([...subjectChoices.values()], subjects, 'Your 2B subjects · none means all', { min: 0 });
  }
  if (groups.some(g => !catalogue.groups.includes(g))) throw new Error('Unknown Tasks View group. Use the groups currently offered by Tasks View.');
  if (subjects.some(s => ![...subjectChoices.keys()].some(k => normalizeName(k) === normalizeName(s)))) throw new Error('Unknown 2B subject. Choose a listed subject.');
  const profile = { enabled: true, className: '2.B', groups, subjects, memberName, updatedAt: new Date().toISOString() };
  await saveClassProfile(profile);
  return profile;
}
