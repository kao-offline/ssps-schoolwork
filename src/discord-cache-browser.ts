import { TeamsBrowser, snapshotYaml, elementRef, type Route } from './teams-cache-browser.js';
import { cacheId, type Observation } from './teams-cache.js';
import { noticeReader, evaluationJson, noticeObservations } from './browser-notices.js';
import { classGuild, memberDirectoryReader, memberProfileReader, scrollMemberDirectory, type ClassMember } from './discord-members.js';
export const discordInitialRoutes: Route[] = [
  { id: 'discord/navigation', kind: 'servers', title: 'Accessible Discord servers and DMs', url: 'https://discord.com/channels/@me', intervalMs: 600000 },
  { id: 'discord/notifications', kind: 'notifications', title: 'Discord unread and mention indicators', url: 'https://discord.com/channels/@me', intervalMs: 30000 },
];
// Only rendered DOM: no Discord API, network interception, cookies or storage.
export const discordDomReader = `() => {
  const links = [...document.querySelectorAll('a[href^="/channels/"]')].filter(a => !/^(?:Voice channel|Hlasový kanál|Stage channel)/i.test(a.getAttribute('aria-label') || '')).map(a => ({ path: a.getAttribute('href'), title: a.getAttribute('aria-label') || a.textContent || '' }));
  const guilds = [...document.querySelectorAll('[data-list-item-id^="guildsnav___"]')].map(e => ({ id: e.getAttribute('data-list-item-id')?.match(/guildsnav___(\\d{8,24})/)?.[1], title: e.getAttribute('aria-label') || e.textContent || '' })).filter(g => g.id);
  const unread = [...document.querySelectorAll('[aria-label*="unread" i],[aria-label*="mention" i],[aria-label*="nepřečten" i],[aria-label*="zmín" i]')].map(e => e.getAttribute('aria-label')).slice(0, 2000);
  const list = document.querySelector('[data-list-id="chat-messages"]');
  const messages = list ? [...list.querySelectorAll('li[id^="chat-messages-"]')].map(e => ({ id: e.id, text: e.innerText, at: e.querySelector('time')?.getAttribute('datetime') })) : [];
  const owner = document.querySelector('[aria-label="User area"], [aria-label="Stav a nastavení uživatele"]')?.innerText?.split('\\n').slice(0, 2).join('\\n');
  return { links, guilds, unread, messages, owner, hasMessageList: !!list, channelTitle: document.querySelector('h1')?.innerText };
}`;
export const discordDirectoryReader = `async () => {
  const collected = new Map();
  const gather = () => { for (const a of document.querySelectorAll('a[href^="/channels/"]')) if (!/^(?:Voice channel|Stage channel)/i.test(a.getAttribute('aria-label') || '')) collected.set(a.getAttribute('href'), { path: a.getAttribute('href'), title: a.getAttribute('aria-label') || a.textContent || '' }); };
  for (const e of document.querySelectorAll('[data-list-item-id^="guildsnav___"][aria-expanded="false"], [data-list-item-id^="channels___"][aria-expanded="false"], [data-list-item-id^="channels___"] [aria-expanded="false"]')) { if (e.getClientRects().length) e.click(); }
  await new Promise(resolve => setTimeout(resolve, 200));
  gather();
  for (const nav of document.querySelectorAll('nav[aria-label="Private channels"], nav[aria-label="Soukromé kanály"], nav[aria-label="Servers sidebar"], nav[aria-label="Postranní panel se servery"]')) {
    const scroll = [nav, ...nav.querySelectorAll('div')].find(e => e.clientHeight > 30 && e.scrollHeight > e.clientHeight + 20);
    if (!scroll) continue;
    for (let i = 0; i < 20; i++) { const before = scroll.scrollTop; scroll.scrollTop += scroll.clientHeight * 0.9; await new Promise(resolve => setTimeout(resolve, 100)); gather(); if (scroll.scrollTop === before) break; }
    scroll.scrollTop = 0;
  }
  return [...collected.values()];
}`;
type DiscordDom = { links: { path: string; title: string }[]; guilds: { id: string; title: string }[]; unread: string[]; messages: { id: string; text: string; at?: string }[]; owner?: string; hasMessageList: boolean; channelTitle?: string };
export function mergeDiscordMessages(previous: string | undefined, current: string) {
  try {
    const next = JSON.parse(current);
    if (!Array.isArray(next.messages)) return current;
    const old = previous ? JSON.parse(previous) : { messages: [] };
    const messages = new Map<string, any>((old.messages || []).map((m: any) => [m.id, m]));
    for (const message of next.messages) messages.set(message.id, message);
    next.messages = [...messages.values()].slice(-500);
    next.historyComplete = false;
    next.retentionTruncated = messages.size > 500;
    while (JSON.stringify(next).length > 180000 && next.messages.length > 1) { next.messages.shift(); next.retentionTruncated = true; }
    return JSON.stringify(next);
  } catch { return current; }
}
export function discordDiscovered(dom: Pick<DiscordDom, 'links' | 'guilds'>): Route[] {
  const routes = new Map<string, Route>();
  for (const guild of dom.guilds) if (/^\d{8,24}$/.test(guild.id)) {
    const route = { id: cacheId('discord/server', guild.id), kind: 'servers' as const, title: guild.title || guild.id, url: `https://discord.com/channels/${guild.id}`, intervalMs: 600000 };
    routes.set(route.id, route);
  }
  for (const link of dom.links) {
    try {
      const channel = discordChannel('https://discord.com' + link.path);
      // ponytail: 5-minute poll — 60s never drains with hundreds of channels, so everything read stale.
      routes.set(channel.id, { ...channel, title: link.title.trim() || channel.id, intervalMs: 300000 });
    } catch { /* Only channel/DM links are eligible, never arbitrary URLs. */ }
  }
  return [...routes.values()];
}
export function discordChannel(url: string) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://discord.com' || parsed.search || parsed.hash || !/^\/channels\/(?:@me|\d{8,24})\/\d{8,24}(?:\/\d{8,24})?\/?$/.test(parsed.pathname)) throw new Error('Use a discord.com/channels/server/channel URL of an accessible channel or DM. Thread links work too; the thread itself is watched.');
  return { id: 'discord' + parsed.pathname.replace(/\/$/, ''), url: parsed.origin + parsed.pathname.replace(/\/$/, ''), kind: parsed.pathname.includes('/@me/') ? 'dm' as const : 'channel' as const };
}
export class DiscordBrowser extends TeamsBrowser {
  constructor() { super('discord'); }
  async classMembers() {
    const url = `https://discord.com/channels/${classGuild}/1423979576358342666`;
    await this.text('browser_navigate', { url });
    await this.text('browser_wait_for', { text: 'rules' });
    const snapshot = await this.text('browser_snapshot');
    if (!snapshot.includes(`Page URL: https://discord.com/channels/${classGuild}/`)) throw new Error('class_server_unavailable');
    const dismissRef = elementRef(snapshot, 'heading', 'Diddy party 2.B: rules') || elementRef(snapshot, 'heading', 'Chat rules');
    if (!dismissRef) throw new Error('class_channel_heading_unavailable');
    const members = new Map<string, ClassMember>();
    const observed = new Set<string>();
    const started = Date.now();
    for (let page = 0; page < 30 && Date.now() - started < 140000; page++) {
      let ids: { id: string; label: string }[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        try { ids = evaluationJson(await this.text('browser_evaluate', { function: memberDirectoryReader })); break; }
        catch (error) { if (attempt === 2) throw error; await this.text('browser_wait_for', { time: 1 }); }
      }
      for (const { id, label } of ids) {
        if (observed.has(id) || Date.now() - started >= 140000) continue;
        observed.add(id);
        try {
          const view = await this.text('browser_snapshot');
          const ref = label && elementRef(view, 'img', label);
          if (!ref) continue;
          await this.text('browser_click', { target: ref });
          const member = evaluationJson(await this.text('browser_evaluate', { function: memberProfileReader(id, false, label.split(',')[0].trim()) }));
          if (member) members.set(id, { ...member, sourceUrl: url, checkedAt: new Date().toISOString() });
        } finally {
          await this.text('browser_press_key', { key: 'Escape' });
          // Discord profile popouts can ignore Escape when opened without focus.
          // A real click on the channel heading dismisses them without a composer.
          await this.text('browser_click', { target: dismissRef });
        }
      }
      if (!evaluationJson(await this.text('browser_evaluate', { function: scrollMemberDirectory }))) break;
    }
    return { members: [...members.values()], complete: false, coverage: 'Rendered class members and profile roles; hidden/offline members may be absent.' };
  }
  async collect(route: Route): Promise<{ observations: Observation[]; discovered: Route[]; owner?: string }> {
    if (!route.url) throw new Error('discord_channel_not_configured');
    let text = await this.text('browser_snapshot');
    const notices: Observation[] = [];
    if (/Page URL: https:\/\/discord\.com\/channels\//.test(text)) {
      try { notices.push(...noticeObservations(evaluationJson(await this.text('browser_evaluate', { function: noticeReader })), 'discord', route.url)); } catch { /* Unread indicator checks remain the fallback. */ }
    }
    // Notifications inspect the currently loaded app without leaving its channel.
    if (route.kind !== 'notifications' && !text.includes('Page URL: ' + route.url + '\n') || !/Page URL: https:\/\/discord\.com\/channels\//.test(text)) {
      await this.text('browser_navigate', { url: route.url });
      await this.text('browser_wait_for', { time: 3 });
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      text = await this.text('browser_snapshot');
      const url = text.match(/Page URL: (https:\/\/[^\s]+)/)?.[1];
      if (url && new URL(url).hostname === 'discord.com' && new URL(url).pathname.startsWith('/channels/')) {
        const yaml = snapshotYaml(text);
        if (/navigation|application|Messages|Chat content/.test(yaml) && !/heading "(?:Log In|Welcome back)/i.test(yaml)) {
          let extraLinks: DiscordDom['links'] = [];
          if (route.kind === 'servers') extraLinks = evaluationJson(await this.text('browser_evaluate', { function: discordDirectoryReader }));
          const result = await this.text('browser_evaluate', { function: discordDomReader });
          const dom = evaluationJson(result) as DiscordDom;
          dom.links = [...new Map([...extraLinks, ...dom.links].map(link => [link.path, link])).values()];
          if (['channel', 'dm'].includes(route.kind) && new URL(url).pathname.replace(/\/$/, '') !== new URL(route.url).pathname.replace(/\/$/, '')) throw new Error('discord_channel_unavailable');
          const content = route.kind === 'notifications' ? JSON.stringify({ unread: dom.unread })
            : route.kind === 'servers' ? JSON.stringify({ servers: dom.guilds, channels: dom.links, unread: dom.unread })
              : dom.hasMessageList ? JSON.stringify({ title: dom.channelTitle, messages: dom.messages.map(m => ({ ...m, sourceUrl: route.url + '/' + m.id.match(/(\d+)$/)?.[1] })) }) : yaml;
          try { notices.push(...noticeObservations(evaluationJson(await this.text('browser_evaluate', { function: noticeReader })), 'discord', route.url)); } catch { /* Preserve successfully read messages. */ }
          return { observations: [{ id: route.id, kind: route.kind, title: route.title, sourceUrl: route.url, text: content }, ...notices], discovered: discordDiscovered(dom), owner: dom.owner };
        }
      }
      await this.text('browser_wait_for', { time: 1 });
    }
    throw new Error('authentication_or_discord_unavailable');
  }
}
