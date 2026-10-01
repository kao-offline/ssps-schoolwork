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
export async function announcements(kind: 'received' | 'noticeboard') {
  // This documented POST only reads the message list. Never mark messages read.
  const result = await bak('komens/messages/' + kind, 'POST');
  if (!Array.isArray(result.Messages)) throw new Error('Unexpected Bakaláři message response.');
  return result.Messages;
}
export function message(id: string) { return bak('komens/messages/received/' + segment(id)); }
export async function attachment(id: string) {
  return request(bakBase() + '/api/3/komens/attachment/' + segment(id), { headers: bakHeaders(await bakToken()) }, 'Bakaláři attachment');
}
