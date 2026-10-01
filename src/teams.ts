import { microsoftToken } from './auth.js';
import { request } from './http.js';
import { segment } from './config.js';
const base = 'https://graph.microsoft.com/v1.0';
export async function graph(path: string) {
  const url = new URL(path.startsWith('https:') ? path : base + path);
  if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/') || url.username || url.password) throw new Error('Invalid Microsoft Graph URL.');
  return (await request(url.href, { headers: { Authorization: `Bearer ${await microsoftToken()}` } }, 'Microsoft Graph')).json();
}
export async function graphList(path: string) {
  const items: any[] = [];
  let next: string | undefined = path;
  let pages = 0;
  while (next && pages < 20) {
    const page = await graph(next);
    if (!Array.isArray(page.value)) throw new Error('Unexpected Microsoft Graph list response.');
    items.push(...page.value);
    next = page['@odata.nextLink'];
    pages++;
  }
  return { items, incomplete: Boolean(next), nextPage: next ?? null };
}
export function classes() { return graphList('/education/me/classes'); }
export function teams() { return graphList('/me/joinedTeams'); }
export function channels(team: string) { return graphList(`/teams/${segment(team)}/channels`); }
export function assignments(classId: string) { return graphList(`/education/classes/${segment(classId)}/assignments`); }
export async function assignment(classId: string, id: string) {
  const path = `/education/classes/${segment(classId)}/assignments/${segment(id)}`;
  const [detail, resources] = await Promise.all([graph(path), graphList(path + '/resources')]);
  return { detail, resources };
}
export function messages(team: string, channel: string) { return graphList(`/teams/${segment(team)}/channels/${segment(channel)}/messages`); }
export async function thread(team: string, channel: string, id: string) {
  const path = `/teams/${segment(team)}/channels/${segment(channel)}/messages/${segment(id)}`;
  const [message, replies] = await Promise.all([graph(path), graphList(path + '/replies')]);
  return { message, replies };
}
export async function fileMetadata(driveId: string, itemId: string) { return graph(`/drives/${segment(driveId)}/items/${segment(itemId)}`); }
export async function resolveFile(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !(/(^|\.)sharepoint\.com$/.test(parsed.hostname) || parsed.hostname === '1drv.ms')) throw new Error('Only HTTPS SharePoint or OneDrive file links are supported.');
  const shareId = 'u!' + Buffer.from(parsed.href).toString('base64url');
  // No redeemSharingLink header: resolving a file must not grant persistent access.
  const item = await graph(`/shares/${shareId}/driveItem`);
  return { id: item.id, driveId: item.parentReference?.driveId, name: item.name, webUrl: item.webUrl, size: item.size };
}
