import { TeamsBrowser, elementRef, snapshotYaml, type Route } from './teams-cache-browser.js';
import { cacheId, type Observation } from './teams-cache.js';
import { evaluationJson } from './browser-notices.js';
import { dataDir } from './config.js';
import { relative, join } from 'node:path';

export const outlookInboxUrl = 'https://outlook.office.com/mail/inbox';
export const outlookInitialRoutes: Route[] = [{ id: 'outlook/inbox', kind: 'mailbox', title: 'Outlook inbox', url: outlookInboxUrl, intervalMs: 300000 }];
export const outlookInboxReader = String.raw`() => {
  const visible = e => !!e && e.getClientRects().length && !e.closest('[aria-hidden="true"]');
  const account = Array.from(document.querySelectorAll('button,[role="button"],#mectrl_headerPicture,#O365_MainLink_Me')).find(e => visible(e) && /account manager|správce účtu/i.test(e.getAttribute('aria-label') || '') || visible(e) && /mectrl|O365_MainLink_Me/.test(e.id));
  const titleOwner = document.title.match(/(?:–|-)\s*(.+?)\s*(?:–|-)\s*Outlook$/)?.[1];
  const owner = account && (account.getAttribute('aria-label') || account.getAttribute('title') || account.innerText) || titleOwner;
  const section = document.querySelector('[data-app-section="MessageList"]');
  const list = section || Array.from(document.querySelectorAll('[role="listbox"]')).find(e => visible(e) && e.querySelector('[role="option"]'));
  const rows = list ? Array.from(list.querySelectorAll('[role="option"],[data-itemid]')).filter(visible).slice(0,30) : [];
  const messages = rows.flatMap(row => {
    const label = row.getAttribute('aria-label') || row.innerText || '';
    const key = row.getAttribute('data-itemid') || row.getAttribute('data-convid') || row.id;
    const lines = (row.innerText || '').split('\n').filter(Boolean);
    if (/^[A-ZČŠŽŘĎŤŇÁÉÍÓÚÝ]{1,3}$/.test(lines[0] || '')) lines.shift();
    return key && label.trim() ? [{ key, label: label.slice(0,1500), sender: (lines[0] || '').slice(0,200), subject: (lines[1] || '').slice(0,300), displayedAt: (lines[2] || '').slice(0,100), preview: (row.innerText || '').slice(0,1500) }] : [];
  });
  const empty = /no messages|nothing in your inbox|žádné zprávy|složka je prázdná/i.test((document.querySelector('[role="main"]') || document.body).innerText || '');
  return { owner: owner || null, messages, listLoaded: !!list || empty, empty, coverage: 'Visible inbox rows only; Focused/Other tabs, folders and virtualized history may be absent.' };
}`;
export const outlookBodyReader = String.raw`() => {
  const expectedKey = null;
  const visible = e => !!e && e.getClientRects().length && !e.closest('[aria-hidden="true"]');
  const selected = Array.from(document.querySelectorAll('[role="option"][aria-selected="true"]')).find(e => (e.getAttribute('data-itemid') || e.getAttribute('data-convid') || e.id) === expectedKey);
  const reading = document.querySelector('[data-app-section="MailReadCompose"]') || document.querySelector('[role="main"]');
  const primary = reading ? Array.from(reading.querySelectorAll('[data-testid="message-body"],[role="document"]')).filter(visible) : [];
  const candidates = primary.length ? primary : reading ? Array.from(reading.querySelectorAll('.allowTextSelection')).filter(visible) : [];
  const bodies = candidates.filter(e => !e.closest('[contenteditable="true"]')).filter(e => !candidates.some(parent => parent !== e && parent.contains(e)));
  const text = bodies.map(e => e.innerText || '').filter(Boolean).join('\n\n');
  const attachmentLists = reading ? Array.from(reading.querySelectorAll('[role="listbox"]')).filter(e => /attachment|příloh/i.test(e.getAttribute('aria-label') || '')) : [];
  const attachments = attachmentLists.flatMap(list => Array.from(list.querySelectorAll('[role="option"]')).filter(visible).map(row => ({ name: row.querySelector('[title]')?.getAttribute('title') || (row.innerText || '').split('\n')[0], label: row.getAttribute('aria-label'), size: (row.innerText || '').split('\n')[1] || null }))).filter(a => a.name && a.label).slice(0,30);
  return { body: text.slice(0,80000), truncated: text.length > 80000, headers: reading ? (reading.innerText || '').replace(text,'').slice(0,8000) : '', bodyLoaded: !!selected && (!!text.trim() || attachments.length > 0), attachments, attachmentsDownloaded: false };
}`;
type Inbox = { owner: string | null; messages: { key: string; label: string; preview: string }[]; listLoaded: boolean; empty: boolean; coverage: string };
export class OutlookBrowser extends TeamsBrowser {
  constructor() { super('outlook'); }
  private async inbox(query?: string) {
    await this.text('browser_navigate', { url: outlookInboxUrl });
    for (let attempt = 0; attempt < 8; attempt++) {
      await this.text('browser_wait_for', { time: 1 });
      const snapshot = await this.text('browser_snapshot');
      const url = snapshot.match(/Page URL: (https:\/\/[^\s]+)/)?.[1];
      if (url && !['outlook.office.com', 'outlook.office365.com'].includes(new URL(url).hostname)) throw new Error('authentication_or_outlook_unavailable');
      const data = evaluationJson(await this.text('browser_evaluate', { function: outlookInboxReader })) as Inbox;
      if (data.listLoaded && data.owner) {
        if (!query) return { data, snapshot };
        const search = evaluationJson(await this.text('browser_evaluate', { function: '() => ({label: document.querySelector("#topSearchInput")?.getAttribute("aria-label")})' })) as { label?: string };
        const ref = search.label && elementRef(snapshotYaml(snapshot), 'combobox', search.label);
        if (!ref) throw new Error('outlook_search_reference_unavailable');
        await this.text('browser_type', { target: ref, text: query, submit: true });
        let previous = '';
        for (let check = 0; check < 10; check++) {
          await this.text('browser_wait_for', { time: 1 });
          const state = evaluationJson(await this.text('browser_evaluate', { function: '() => ({query: document.querySelector("#topSearchInput")?.value, busy: !!document.querySelector("[data-app-section=MessageList] [aria-busy=true],[data-app-section=MessageList] [role=progressbar]"), heading: /results|výsledky/i.test(document.querySelector("[data-app-section=MessageList]")?.innerText || "")})' })) as { query?: string; busy: boolean; heading: boolean };
          const found = evaluationJson(await this.text('browser_evaluate', { function: outlookInboxReader })) as Inbox;
          const signature = JSON.stringify(found.messages);
          if (check >= 2 && state.query === query && state.heading && !state.busy && found.owner === data.owner && previous === signature) return { data: { ...found, coverage: 'Visible Outlook search results only; folders, result limits and virtualized history may be absent.' }, snapshot: await this.text('browser_snapshot') };
          previous = signature;
        }
        throw new Error('outlook_search_results_unavailable');
      }
    }
    throw new Error('outlook_inbox_or_account_unavailable');
  }
  override async collect(route: Route): Promise<{ observations: Observation[]; discovered: Route[]; owner?: string }> {
    if (!['mailbox', 'email'].includes(route.kind)) throw new Error('unsupported_outlook_route');
    const { data, snapshot } = await this.inbox(route.mailQuery);
    if (route.kind === 'email') {
      const row = data.messages.find(m => m.key === route.mailKey);
      if (!row) throw new Error('email_not_in_loaded_inbox');
      const ref = elementRef(snapshotYaml(snapshot), 'option', row.label);
      if (!ref) throw new Error('outlook_message_reference_unavailable');
      await this.text('browser_click', { target: ref });
      let body;
      let previousBody;
      for (let attempt = 0; attempt < 5; attempt++) {
        await this.text('browser_wait_for', { time: 1 });
        body = evaluationJson(await this.text('browser_evaluate', { function: outlookBodyReader.replace('const expectedKey = null;', 'const expectedKey = ' + JSON.stringify(row.key) + ';') })) as { body: string; headers: string; bodyLoaded: boolean; truncated: boolean };
        if (body.bodyLoaded && previousBody === JSON.stringify(body)) break;
        previousBody = JSON.stringify(body);
      }
      if (!body?.bodyLoaded) throw new Error('outlook_message_body_unavailable');
      const current = await this.text('browser_snapshot');
      const currentUrl = current.match(/Page URL: (https:\/\/[^\s]+)/)?.[1];
      const sourceUrl = currentUrl && ['outlook.office.com', 'outlook.office365.com'].includes(new URL(currentUrl).hostname) ? new URL(new URL(currentUrl).pathname, new URL(currentUrl).origin).href : outlookInboxUrl;
      return { owner: data.owner!, discovered: [], observations: [{ id: route.id, kind: 'email', title: row.label, parentId: 'outlook/inbox', sourceUrl, text: JSON.stringify({ ...row, ...body, coverage: 'Rendered message/conversation only; collapsed replies and attachment contents may be absent.', readSideEffect: 'Outlook may mark opened mail as read according to account settings.' }) }] };
    }
    return { owner: data.owner!, observations: [{ id: route.id, kind: 'mailbox', title: route.title, sourceUrl: outlookInboxUrl, text: JSON.stringify({ messages: data.messages.map(m => ({ ...m, id: cacheId('email', m.key), bodyLoaded: false })), query: route.mailQuery, coverage: data.coverage, historyComplete: false }) }], discovered: data.messages.map(m => ({ id: cacheId('email', m.key), kind: 'email', title: m.label, mailKey: m.key, mailQuery: route.mailQuery, intervalMs: 900000, foregroundOnly: true })) };
  }
  async downloadAttachment(route: Route, name: string) {
    const message = await this.collect(route);
    const data = JSON.parse(message.observations[0].text);
    const attachments = (data.attachments || []).filter((a: { name: string }) => a.name.normalize('NFC') === name.normalize('NFC'));
    if (attachments.length !== 1) throw new Error('Attachment name is absent or ambiguous in the selected mail. Read the mail first.');
    const snapshot = snapshotYaml(await this.text('browser_snapshot'));
    const rowRef = elementRef(snapshot, 'option', attachments[0].label);
    if (!rowRef) throw new Error('outlook_attachment_reference_unavailable');
    // The installed MCP's targeted snapshot can fail on element refs. Scope
    // the fresh accessibility tree by indentation instead of reusing a global
    // More actions button that might belong to a different attachment.
    const lines = snapshot.split('\n');
    const start = lines.findIndex(line => line.includes('[ref=' + rowRef + ']'));
    const indent = lines[start]?.match(/^\s*/)?.[0].length || 0;
    let end = start + 1;
    while (end < lines.length && (!lines[end].trim() || (lines[end].match(/^\s*/)?.[0].length || 0) > indent)) end++;
    const row = lines.slice(start, end).join('\n');
    const more = ['More actions', 'Další akce'].map(label => elementRef(row, 'button', label)).find(Boolean);
    if (!more) throw new Error('outlook_attachment_download_menu_unavailable');
    await this.text('browser_click', { target: more });
    const menu = snapshotYaml(await this.text('browser_snapshot'));
    const download = ['Download', 'Stáhnout'].map(label => elementRef(menu, 'menuitem', label)).find(Boolean);
    if (!download) throw new Error('outlook_attachment_download_unavailable');
    let events = await this.text('browser_click', { target: download });
    for (let attempt = 0; attempt < 10 && !/Downloaded file .+ to "/.test(events); attempt++) events += await this.text('browser_wait_for', { time: 1 });
    const file = events.match(/Downloaded file .+ to "([^"]+)"/)?.[1];
    if (!file) throw new Error('outlook_attachment_download_not_verified');
    return { owner: message.owner, mailId: route.id, name: attachments[0].name, downloadFile: relative(join(dataDir, 'outlook-browser-output'), file), sourceUrl: message.observations[0].sourceUrl, source: 'outlook-browser-download', downloadedAt: new Date().toISOString() };
  }
}
