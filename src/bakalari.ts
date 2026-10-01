import { bakBase, bakHeaders, segment } from './config.js';
import { bakToken } from './auth.js';
import { request } from './http.js';
export async function bak(path: string, method = 'GET') {
  return (await request(bakBase() + '/api/3/' + path, { method, headers: { ...bakHeaders(await bakToken()), ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, ...(method === 'POST' ? { body: '' } : {}) }, 'Bakaláři')).json();
}
export async function homeworks(from: string, to: string) {
  const result = await bak('homeworks?' + new URLSearchParams({ from, to }));
  if (!Array.isArray(result.Homeworks)) throw new Error('Unexpected Bakaláři homework response.');
  return result.Homeworks;
}
export async function announcements(kind: 'received' | 'noticeboard' | 'sent' | 'apology' | 'rating') {
  // This documented POST only reads the message list. Never mark messages read.
  const result = await bak('komens/messages/' + kind, 'POST');
  if (!Array.isArray(result.Messages)) throw new Error('Unexpected Bakaláři message response.');
  return result.Messages;
}
export function message(id: string, kind: 'received' | 'sent' = 'received') { return bak('komens/messages/' + kind + '/' + segment(id)); }
export async function attachment(id: string) {
  return request(bakBase() + '/api/3/komens/attachment/' + segment(id), { headers: bakHeaders(await bakToken()) }, 'Bakaláři attachment');
}

// Only documented read endpoints. Never accept an arbitrary path or HTTP method from an agent.
export const readAreas = {
  profile: 'user', subjects: 'subjects', marks: 'marks', report_cards: 'marks/final',
  disciplinary_measures: 'marks/measures', absences: 'absence/student',
  timetable_actual: 'timetable/actual', timetable_permanent: 'timetable/permanent',
  substitutions: 'substitutions', events: 'events', events_my: 'events/my', events_public: 'events/public',
  homeworks: 'homeworks', classbook: 'classbook', lesson_tags: 'classbook/lessonTags',
  class_fund: 'payments/classfund', class_fund_summary: 'payments/classfund/summary',
  consents: 'gdpr/consents/person', commissioners: 'gdpr/commissioners', web_modules: 'webmodule',
} as const;
export type ReadArea = keyof typeof readAreas;
export async function readArea(area: ReadArea, options: { from?: string; to?: string; date?: string } = {}) {
  if (!Object.hasOwn(readAreas, area)) throw new Error('Unsupported Bakalari read area.');
  const params = new URLSearchParams();
  if (area === 'timetable_actual') {
    if (!options.date) throw new Error('date is required for the actual timetable.');
    params.set('date', options.date);
  }
  if (area === 'homeworks' || area === 'classbook') {
    if (!options.from || !options.to) throw new Error('from and to are required for homework or classbook reads.');
    if (options.from > options.to) throw new Error('from must not be after to.');
    params.set('from', area === 'classbook' ? options.from + 'T00:00:00.000' : options.from);
    params.set('to', area === 'classbook' ? options.to + 'T23:59:59.999' : options.to);
  }
  if ((area.startsWith('events') || area === 'substitutions') && options.from) params.set('from', options.from);
  return bak(readAreas[area] + (params.size ? '?' + params : ''));
}
export async function lessonTopics(subjectId: string) {
  const result = await bak('subjects/themes/' + segment(subjectId));
  if (!Array.isArray(result.Themes)) throw new Error('Unexpected Bakalari lesson topics response.');
  return result;
}
