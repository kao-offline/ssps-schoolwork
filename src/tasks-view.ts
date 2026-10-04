import { convert } from 'html-to-text';
import { createHash } from 'node:crypto';
import { request, boundedBytes } from './http.js';
import { loadSecret, saveSecret } from './store.js';

export const tasksViewUrl = 'https://tasks-view.matejruzicka.cz/';
export type ClassProfile = { enabled: boolean; className: '2.B'; groups: string[]; subjects: string[]; memberName?: string; subjectGroups?: import('./class-groups.js').SubjectGroup[]; discordRoles?: string[]; updatedAt: string };
export const groupCode = /^[a-z0-9_:-]{1,100}$/i;
const text = (html: string) => convert(html, { wordwrap: false, selectors: [{ selector: 'a', options: { ignoreHref: true } }] }).trim();
export function parseTasksView(html: string) {
  if (!/<div\s+class=["']tasks["']/.test(html) || !/Tasks View/.test(html)) throw new Error('Tasks View returned an unsupported page; tasks could not be verified.');
  const className = text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
  const groups = [...new Set([...html.matchAll(/<input\b[^>]*id=["']filter_checkbox_group_[^"']+["'][^>]*value=["']([^"']+)["']/g)].map(m => text(m[1])))];
  const items = [...html.matchAll(/<div\s+class=["']task["']\s*>([\s\S]*?)<\/div>\s*<\/div>/g)].map(m => {
    const fields = Object.fromEntries([...m[1].matchAll(/<div\s+class=["']task-(date|name|groups|description)["']\s*>([\s\S]*?)(?:<\/div>|$)/g)].map(f => [f[1], text(f[2])]));
    if (!fields.date || !fields.name || fields.description === undefined || fields.groups === undefined) throw new Error('Tasks View row format changed.');
    const date = fields.date.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!date) throw new Error('Tasks View date format changed.');
    const dueDate = `${date[3]}-${date[2].padStart(2, '0')}-${date[1].padStart(2, '0')}`;
    if (new Date(dueDate).toISOString().slice(0, 10) !== dueDate) throw new Error('Tasks View returned an invalid date.');
    return { source: 'tasks-view', id: createHash('sha256').update(JSON.stringify(fields)).digest('hex').slice(0, 20), subject: fields.name, groups: fields.groups.split(/[,\s]+/).filter(Boolean), instructions: fields.description, dueDate, originalDueAt: fields.date, duePrecision: 'date', sourceUrl: tasksViewUrl };
  });
  // A changed layout must never silently turn existing rows into an empty list.
  if ((html.match(/class=["']task["']/g) || []).length !== items.length) throw new Error('Tasks View rows could not all be read.');
  return { className, groups, items };
}
export async function fetchTasksView(groups: string[] = []) {
  if (groups.some(g => !groupCode.test(g))) throw new Error('Invalid Tasks View group code.');
  const url = new URL(tasksViewUrl);
  if (groups.length) url.searchParams.set('groups', groups.join(','));
  const html = (await boundedBytes(await request(url.href, {}, 'Tasks View'), 1024 * 1024)).toString('utf8');
  const result = parseTasksView(html);
  return { ...result, items: result.items.map(item => ({ ...item, sourceUrl: url.href })), sourceUrl: url.href, checkedAt: new Date().toISOString(), coverage: 'Public class task list maintained by classmates; separate from teacher assignments.' };
}
export async function classProfile() { return await loadSecret<ClassProfile>('class-2b-profile'); }
export async function saveClassProfile(profile: ClassProfile) { await saveSecret('class-2b-profile', profile); }
export const normalizeName = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const subjectAliases: Record<string, string> = { mat: 'm', matematika: 'm', ang: 'aj', anglickyjazyk: 'aj', cjl: 'cj', ceskyjazykaliteratura: 'cj', fyz: 'f', fyzika: 'f' };
export const subjectKey = (value: string) => subjectAliases[normalizeName(value)] || normalizeName(value);
export function groupsFromRoles(roles: string[], available: string[]) {
  return available.filter(group => roles.some(role => {
    const name = normalizeName(role);
    if (name === normalizeName(group) || /^sk[12]$/.test(group) && name.endsWith(group)) return true;
    return group === 'm_fre' && /(?:matika|matematika).*fre/.test(name) || group === 'aj_nov' && /(?:aj|anglictina).*nov/.test(name);
  }));
}
export async function listClassTasks(options: { from?: string; to?: string; groups?: string[]; subjects?: string[]; query?: string; offset: number; limit: number }) {
  const profile = await classProfile();
  if (!profile?.enabled) throw new Error('Enable the 2B module in the local installer first.');
  if (options.from && options.to && options.from > options.to) throw new Error('from must not be after to.');
  const groups = options.groups ?? profile.groups;
  const subjects = options.subjects ?? profile.subjects;
  const result = await fetchTasksView(groups);
  const items = result.items.filter(item => (!item.groups.length || item.groups.some(g => groups.includes(g))) && (!subjects.length || subjects.some(s => subjectKey(s) === subjectKey(item.subject))) && (!options.from || item.dueDate >= options.from) && (!options.to || item.dueDate <= options.to) && (!options.query || normalizeName(JSON.stringify(item)).includes(normalizeName(options.query))));
  return { ...result, groups, subjects, items: items.slice(options.offset, options.offset + options.limit), total: items.length, nextOffset: options.offset + options.limit < items.length ? options.offset + options.limit : null };
}
