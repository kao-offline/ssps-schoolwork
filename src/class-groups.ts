import { normalizeName, subjectKey } from './tasks-view.js';

export type SubjectGroup = { subject: string; group: string; teacher?: string; source: 'discord' | 'bakalari' | 'manual' | 'class-catalogue'; groupId?: string; timetableGroup?: string; role?: string };
export const classRoleChoices = ['matika-Součková', 'Aj Novák', 'PCV | Halbych', 'PVA | Hejduk', 'SK1', 'SK2', 'Lineární Algebra', 'Němčina'];
const canonicalSubject = (subject: string) => ({ m: 'MAT', aj: 'ANG', cj: 'CJL', f: 'FYZ' })[subjectKey(subject)] || subject.toUpperCase();
export function roleSubjectGroups(roles: string[]): SubjectGroup[] {
  return roles.flatMap(role => {
    const cleaned = role.trim();
    if (['linearni algebra', 'nemcina'].some(name => normalizeName(name) === normalizeName(cleaned))) return [{ subject: cleaned, group: cleaned, source: 'discord' as const, role }];
    if (/^SK[12]$/i.test(cleaned)) return [{ subject: 'SK', group: cleaned.toUpperCase(), source: 'discord' as const, role }];
    const match = cleaned.match(/^(matika|matematika|aj|angličtina|[A-Z][A-Z0-9]{1,7})\s*(?:[|:-]\s*|\s+)(.+)$/i);
    if (!match) return [];
    const subject = /^(matika|matematika)$/i.test(match[1]) ? 'MAT' : /^(aj|angličtina)$/i.test(match[1]) ? 'ANG' : match[1].toUpperCase();
    // Only subject role prefixes, never social, moderation or notification roles.
    if (!['MAT', 'ANG', 'PCV', 'PVA', 'PDV', 'WBA', 'HAR', 'GRS', 'PSI', 'OSE', 'CJL', 'FYZ', 'TEV'].includes(subject)) return [];
    return [{ subject, group: cleaned, teacher: match[2].trim(), source: 'discord' as const, role }];
  });
}
export function timetableSubjectGroups(timetable: any): SubjectGroup[] {
  const subjects = new Map<string, any>((timetable.Subjects || []).map((s: any) => [s.Id, s]));
  const teachers = new Map<string, any>((timetable.Teachers || []).map((s: any) => [s.Id, s]));
  const groups = new Map<string, any>((timetable.Groups || []).map((s: any) => [s.Id, s]));
  const choices = new Map<string, SubjectGroup>();
  for (const atom of (timetable.Days || []).flatMap((d: any) => d.Atoms || [])) {
    const subject = subjects.get(atom.SubjectId)?.Abbrev;
    if (!subject) continue;
    for (const id of atom.GroupIds || []) {
      const group = groups.get(id);
      if (!group || /^2\.?\s*B$/i.test(group.Abbrev?.trim() || '')) continue;
      const choice: SubjectGroup = { subject: canonicalSubject(subject), teacher: teachers.get(atom.TeacherId)?.Name, group: group.Name || group.Abbrev, groupId: id, source: 'bakalari' };
      choices.set(JSON.stringify([choice.subject, id, choice.teacher]), choice);
    }
  }
  return [...choices.values()];
}
export function sameSubjectGroup(a: SubjectGroup, b: SubjectGroup) {
  if (a.subject !== b.subject) return false;
  const x = normalizeName(a.teacher || a.group), y = normalizeName(b.teacher || b.group);
  return x === y || !!a.teacher && !!b.teacher && (x.endsWith(y) || y.endsWith(x));
}
export function suggestedSubjectGroups(timetable: SubjectGroup[], roles: string[]) {
  const fromRoles = roleSubjectGroups(roles);
  const sk = fromRoles.find(g => g.subject === 'SK')?.group;
  for (const role of fromRoles) {
    const matches = timetable.filter(group => sameSubjectGroup(role, group));
    if (matches.length === 1) { role.groupId = matches[0].groupId; role.timetableGroup = matches[0].group; }
  }
  // Standalone teacher/elective roles are matched only against timetable evidence.
  for (const group of timetable) if (roles.some(role => {
    const value = normalizeName(role);
    return value.length >= 4 && (normalizeName(group.group) === value || !!group.teacher && normalizeName(group.teacher).endsWith(value));
  }) && !fromRoles.some(g => sameSubjectGroup(g, group))) fromRoles.push({ ...group, ...(sk && /SK[12]/i.test(group.group) ? { group: sk, groupId: undefined } : {}), source: 'discord' });
  // The timetable identifies which subjects use the common SK split. The role
  // selects that split, but does not establish the other group's teacher.
  if (sk) for (const subject of new Set(timetable.filter(g => /SK[12]/i.test(g.group)).map(g => g.subject))) {
    if (fromRoles.some(g => g.subject === subject)) continue;
    const exact = timetable.filter(g => g.subject === subject && normalizeName(g.group).endsWith(normalizeName(sk)));
    fromRoles.push(exact.length === 1 ? { ...exact[0], source: 'discord', role: sk } : { subject, group: sk, source: 'discord', role: sk });
  }
  return [...fromRoles, ...timetable.filter(group => !fromRoles.some(r => r.subject === group.subject)
    && timetable.filter(g => g.subject === group.subject).length === 1
    && (!sk || !/SK[12]/i.test(group.group) || normalizeName(group.group).endsWith(normalizeName(sk))))];
}
export function taskGroupsForSubjects(selected: SubjectGroup[], available: string[]) {
  return available.filter(code => selected.some(group => {
    if (/^sk[12]$/i.test(code)) return normalizeName(group.group).endsWith(code.toLowerCase());
    const match = code.match(/^(m|aj)_(.+)$/i);
    return !!match && subjectKey(group.subject) === match[1].toLowerCase() && (group.teacher || '').split(/\s+/).some(name => normalizeName(name).startsWith(normalizeName(match[2])));
  }));
}
