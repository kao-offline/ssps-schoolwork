import { cacheRequest } from './teams-cache-client.js';
import { normalizeName } from './tasks-view.js';
export const classGuild = '1413121869867126856';
export type ClassMember = { name: string; username: string; roles: string[]; sourceUrl: string; checkedAt: string; rolesCheckedAt?: string };
// Fixed class server DOM reader; no API, storage, cookies or message content.
export const memberDirectoryReader = `async () => {
  const wait = () => new Promise(r => setTimeout(r, 300));
  const show = [...document.querySelectorAll('button,[role="button"]')].find(e => /^(Show Member List|Zobrazit seznam \u010dlen\u016f)$/.test(e.getAttribute('aria-label') || ''));
  if (show) { show.click(); await wait(); }
  let list = document.querySelector('[data-list-id^="members"]');
  for (let i = 0; !list && i < 10; i++) { await wait(); list = document.querySelector('[data-list-id^="members"]'); }
  if (!list) throw new Error('member_list_unavailable');
  const label = e => [...e.querySelectorAll('[role="img"][aria-label],img[alt]')].map(img => (img.getAttribute('aria-label') || img.getAttribute('alt') || '').trim()).find(value => value && !/^(Ikona aplikace|Application icon|App icon|Ověřená aplikace|Verified App|Aplikace)$/i.test(value) && !/^(Ikona aplikace|Application icon|App icon) /i.test(value)) || '';
  const rows = () => [...document.querySelectorAll('[data-list-id^="members"] [data-list-item-id^="members-"]')].filter(e => e.getClientRects().length && label(e));
  for (let i = 0; !rows().length && i < 20; i++) await wait();
  return rows().map(e => ({ id: e.getAttribute('data-list-item-id'), label: label(e), name: e.innerText.split('\\n').map(s => s.trim()).find(Boolean) || label(e).split(',')[0].trim() }));
}`;
export function memberProfileReader(id: string, open = true, expectedUsername = '') {
  return `async () => {
    if (${open} && document.querySelector('[role="dialog"]')) throw new Error('previous_profile_still_open');
    const row = [...document.querySelectorAll('[data-list-item-id]')].find(e => e.getAttribute('data-list-item-id') === ${JSON.stringify(id)});
    if (!row) return null;
    if (${open}) row.click(); await new Promise(r => setTimeout(r, 400));
    let dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const more = [...dialog.querySelectorAll('button,[role="button"]')].find(e => /^\\+\\d+$/.test(e.textContent.trim()) || /^(Show.*more|Zobrazit o.*v\u00edce)$/.test(e.getAttribute('aria-label') || e.textContent.trim()));
    if (more) { more.click(); await new Promise(r => setTimeout(r, 200)); }
    dialog = document.querySelector('[role="dialog"]');
    const expected = ${JSON.stringify(expectedUsername)};
    if (expected && !dialog?.innerText.toLowerCase().includes(expected.toLowerCase())) return null;
    const roles = [...(dialog?.querySelectorAll('[aria-label="Roles"] [role="listitem"], [aria-label="Role"] [role="listitem"], [aria-label="Roles"] li, [aria-label="Role"] li') || [])].map(e => e.textContent.trim()).filter(Boolean);
    const name = (dialog?.querySelector('h1')?.textContent || '').replace(/^(User Profile for|Profil u\u017eivatele)\\s*/i, '').trim();
    const username = expected || [...(dialog?.querySelectorAll('img[alt]') || [])].map(e => e.getAttribute('alt').split(',')[0].trim()).find(Boolean) || name;
    return name ? { name, username, roles } : null;
  }`;
}
export const scrollMemberDirectory = `async () => {
  const list = document.querySelector('[data-list-id^="members"]');
  if (!list) return false;
  let scroll = list;
  while (scroll && !(scroll.scrollHeight > scroll.clientHeight + 20 && scroll.clientHeight > 30)) scroll = scroll.parentElement;
  if (!scroll) return false;
  const before = scroll.scrollTop;
  scroll.scrollTop += scroll.clientHeight * 0.8;
  await new Promise(r => setTimeout(r, 300));
  return scroll.scrollTop !== before;
}`;
export function searchMembers(members: ClassMember[], query: string) {
  const term = normalizeName(query);
  return members.filter(member => normalizeName(member.name + ' ' + member.username).includes(term));
}
export async function readClassMembers(query = '') {
  return await cacheRequest('class_members', { query }, 'discord') as { members: ClassMember[]; complete: false; coverage: string; warning?: string };
}
export async function readClassMember(username: string) {
  return await cacheRequest('class_member', { username }, 'discord') as ClassMember;
}
