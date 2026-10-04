import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join, relative } from 'node:path';
import { dataDir } from './config.js';
import { cacheId, type CacheKind, type Observation } from './teams-cache.js';
import { readTeamsDownload } from './teams-downloads.js';
import { noticeReader, evaluationJson, noticeObservations } from './browser-notices.js';

export const browserTools = ['browser_navigate', 'browser_navigate_back', 'browser_snapshot', 'browser_click', 'browser_press_key', 'browser_tabs', 'browser_wait_for', 'browser_close'];
export type Route = { id: string; kind: CacheKind; title: string; intervalMs: number; className?: string; assignmentTitle?: string; tab?: 'Upcoming' | 'Past due'; assignmentKey?: string; url?: string; mailKey?: string; mailQuery?: string; foregroundOnly?: boolean };
export const initialRoutes: Route[] = [
  { id: 'assignments/upcoming', kind: 'assignments', title: 'Upcoming assignments', tab: 'Upcoming', intervalMs: 300000 },
  { id: 'classes', kind: 'classes', title: 'Class teams', intervalMs: 1800000 },
  { id: 'activity', kind: 'activity', title: 'Teams notifications / Activity', intervalMs: 30000 },
  { id: 'assignments/past_due', kind: 'assignments', title: 'Past due assignments', tab: 'Past due', intervalMs: 900000 },
];
export function snapshotYaml(text: string) { return text.match(/### Snapshot\s*```yaml\r?\n([\s\S]*?)```/)?.[1] || ''; }
function escaped(text: string) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function elementRef(text: string, role: string, name: string) {
  return text.match(new RegExp(`${role} "${escaped(name)}"[^\n]*?\\[ref=([^\\]]+)\\]`))?.[1];
}
export function classRoutes(text: string): Route[] {
  return [...text.matchAll(/- group "(.+) Team \d+ of \d+"/g)].slice(0, 50).map(match => ({ id: cacheId('announcements', match[1]), kind: 'announcements', title: `${match[1]} announcements`, className: match[1], intervalMs: 900000 }));
}
export function assignmentRows(text: string, tab: 'Upcoming' | 'Past due') {
  const starts = [...text.matchAll(/- listitem[^\n]*\[ref=([^\]]+)\][^\n]*\n/g)];
  return starts.slice(0, 50).flatMap((start, index) => {
    const block = text.slice(start.index! + start[0].length, starts[index + 1]?.index);
    const values = [...block.matchAll(/- generic[^\n]*\[ref=[^\]]+\]: (.+)/g)].map(m => m[1]);
    if (!values.length) return [];
    const dateGroup = [...text.slice(0, start.index).matchAll(/- group "([^"\n]+)"/g)].at(-1)?.[1] || '';
    const key = `${tab}\n${values[0]}\n${dateGroup}\n${values[1] || ''}`;
    return [{ ref: start[1], route: { id: cacheId('assignment', key), kind: 'assignment' as const, title: values[0], assignmentTitle: values[0], assignmentKey: key, tab, intervalMs: 900000 } }];
  });
}
export class TeamsBrowser {
  private client?: Client;
  private started = false;
  constructor(private source: 'teams' | 'discord' | 'outlook' = 'teams') {}
  private async connect() {
    if (!this.client) {
      const transport = new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dirname, '../node_modules/@playwright/mcp/cli.js'), '--browser', 'chrome', '--headless', '--user-data-dir', join(dataDir, this.source + '-browser-profile'), '--output-dir', join(dataDir, this.source + '-browser-output'), '--file-paths', 'absolute', '--codegen', 'none', '--snapshot-mode', 'full', '--console-level', 'error', '--no-webmcp'], stderr: 'pipe' });
      transport.stderr?.on('data', () => undefined);
      this.client = new Client({ name: 'schoolwork-background-browser', version: '1' });
      try { await this.client.connect(transport); } catch { this.client = undefined; throw new Error('browser_unavailable'); }
    }
    return this.client;
  }
  async tools() { return (await (await this.connect()).listTools()).tools.filter(tool => browserTools.includes(tool.name)); }
  async call(name: string, args: Record<string, unknown> = {}) {
    // ponytail: one reconnect, not a loop — a second Chrome on this profile kills the first; retrying forever would just fight it.
    try {
      await this.connect();
      const result = await this.client!.callTool({ name, arguments: args });
      if (name === 'browser_close') this.started = false;
      return result;
    } catch (error) {
      if (name === 'browser_close' || !/has been closed|connection closed|browser has disconnected/i.test(error instanceof Error ? error.message : '')) throw error;
      await this.close();
      await this.connect();
      const result = await this.client!.callTool({ name, arguments: args });
      return result;
    }
  }
  async text(name: string, args: Record<string, unknown> = {}) {
    const result = await this.call(name, args);
    if (result.isError) {
      const message = (result.content as { type: string; text?: string }[]).map(c => c.text || '').join('\n');
      const code = /Ref .+ not found/.test(message) ? 'stale_reference' : /Timeout|timed out/.test(message) ? 'ui_timeout' : /Unknown tool|not found in tool/.test(message) ? 'unsupported_tool' : 'browser_read_failed';
      throw new Error(code + '_' + name);
    }
    return (result.content as { type: string; text?: string }[]).filter(c => c.type === 'text').map(c => c.text).join('\n');
  }
  private async snapshot() {
    let result = await this.text('browser_snapshot');
    if (/Page URL: about:blank/.test(result)) {
      await this.text('browser_navigate', { url: 'https://teams.microsoft.com/v2/' });
      await this.text('browser_wait_for', { time: 8 });
      result = await this.text('browser_snapshot');
    }
    const url = result.match(/Page URL: (https:\/\/[^\s]+)/)?.[1];
    if (!url || !['teams.microsoft.com', 'teams.cloud.microsoft'].includes(new URL(url).hostname) || /\/error\//.test(url)) throw new Error('authentication_or_teams_unavailable');
    return { raw: result, yaml: snapshotYaml(result), sourceUrl: new URL(new URL(url).pathname, new URL(url).origin).href };
  }
  private async app(name: 'Teams' | 'Assignments' | 'Activity') {
    if (!this.started) {
      await this.text('browser_navigate', { url: 'https://teams.microsoft.com/v2/' });
      await this.text('browser_wait_for', { time: 8 });
      this.started = true;
    }
    let view = await this.snapshot();
    const labels = name === 'Activity' ? ['Activity', 'Aktivita'] : name === 'Assignments' ? ['Assignments', 'Zadání'] : ['Teams'];
    const ref = labels.map(label => view.yaml.match(new RegExp(`button "${escaped(label)} \\(Ctrl[^"\n]*"[^\n]*?\\[ref=([^\\]]+)\\]`))?.[1]).find(Boolean);
    if (!ref) throw new Error('teams_navigation_unavailable');
    await this.text('browser_click', { target: ref });
    await this.text('browser_press_key', { key: 'Escape' });
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.text('browser_wait_for', { time: 1 });
      view = await this.snapshot();
      if (name === 'Teams') {
        const back = elementRef(view.yaml, 'button', 'Back to All teams');
        if (back) { await this.text('browser_click', { target: back }); view = await this.snapshot(); }
      }
      const ready = name === 'Teams' ? /Team \d+ of \d+|heading "Teams"|No teams/.test(view.yaml) : name === 'Assignments' ? /Assignments List View|Assignment Viewer/.test(view.yaml) : /Activity|Aktivita/.test(view.raw) && !/progressbar/.test(view.yaml);
      if (ready) return view;
    }
    throw new Error('teams_view_not_loaded');
  }
  private async assignments(tab: 'Upcoming' | 'Past due') {
    let view = await this.app('Assignments');
    if (/Assignment Viewer/.test(view.yaml)) {
      const ref = elementRef(view.yaml, 'button', 'Back');
      if (!ref) throw new Error('assignment_list_unavailable');
      await this.text('browser_click', { target: ref });
      await this.text('browser_wait_for', { time: 1 });
      view = await this.snapshot();
    }
    const ref = elementRef(view.yaml, 'tab', tab) || (tab === 'Past due' ? elementRef(view.yaml, 'tab', 'You have past due assignments') : undefined);
    if (!ref) throw new Error('assignment_tab_unavailable');
    await this.text('browser_click', { target: ref });
    await this.text('browser_wait_for', { time: 1 });
    view = await this.snapshot();
    if (!/Assignments List View/.test(view.yaml) || /Something went wrong|Try again/.test(view.yaml)) throw new Error('assignment_list_unavailable');
    return view;
  }
  async collect(route: Route, download = false): Promise<{ observations: Observation[]; discovered: Route[]; owner?: string }> {
    let view;
    let discovered: Route[] = [];
    const documents: Observation[] = [];
    if (route.kind === 'classes') { view = await this.app('Teams'); discovered = classRoutes(view.yaml); }
    else if (route.kind === 'activity') view = await this.app('Activity');
    else if (route.kind === 'assignments' || route.kind === 'assignment') {
      view = await this.assignments(route.tab || 'Upcoming');
      const rows = assignmentRows(view.yaml, route.tab || 'Upcoming');
      if (route.kind === 'assignments') discovered = rows.map(row => row.route);
      else {
        const row = rows.find(row => row.route.assignmentKey === route.assignmentKey);
        if (!row) throw new Error('assignment_not_in_loaded_list');
        await this.text('browser_click', { target: row.ref });
        await this.text('browser_wait_for', { time: 1 });
        view = await this.snapshot();
        if (!/Assignment Viewer/.test(view.yaml)) throw new Error('assignment_detail_unavailable');
        if (download) {
          const resources = [...view.yaml.matchAll(/button "Open options for resource: ([^"\n]+)"[^\n]*?\[ref=([^\]]+)\]/g)].filter(m => /\.(pdf|docx|pptx|txt|md|csv|json)$/i.test(m[1])).slice(0, 5);
          for (const resource of resources) {
            try {
              const current = await this.snapshot();
              const options = elementRef(current.yaml, 'button', `Open options for resource: ${resource[1]}`);
              if (!options) continue;
              await this.text('browser_click', { target: options });
              const menu = await this.snapshot();
              const ref = elementRef(menu.yaml, 'menuitem', 'Download');
              if (!ref) continue;
              let events = await this.text('browser_click', { target: ref });
              for (let attempt = 0; attempt < 5 && !/Downloaded file .+ to "/.test(events); attempt++) events += await this.text('browser_wait_for', { time: 1 });
              const file = events.match(/Downloaded file .+ to "([^"]+)"/)?.[1];
              if (!file) continue;
              const document = await readTeamsDownload(relative(join(dataDir, 'teams-browser-output'), file));
              documents.push({ id: cacheId('document', route.id + '\n' + resource[1]), kind: 'document', title: resource[1], parentId: route.id, sourceUrl: view.sourceUrl, text: document.parts.map(part => `[${part.reference}]\n${part.text}`).join('\n\n'), references: document.parts.map(part => part.reference) });
            } catch { /* The assignment still lists the resource; never invent unreadable document text. */ }
          }
        }
      }
    } else if (route.kind === 'announcements') {
      view = await this.app('Teams');
      const group = view.yaml.indexOf(`group "${route.className} Team `);
      if (group < 0) throw new Error('class_not_in_loaded_list');
      const ref = elementRef(view.yaml.slice(group, view.yaml.indexOf('- group "', group + 8) < 0 ? undefined : view.yaml.indexOf('- group "', group + 8)), 'button', 'Announcements');
      if (!ref) throw new Error('class_announcements_unavailable');
      await this.text('browser_click', { target: ref });
      await this.text('browser_wait_for', { time: 1 });
      view = await this.snapshot();
      if (!/heading "General"|Posts|Příspěvky/.test(view.yaml)) throw new Error('channel_not_loaded');
    } else throw new Error('unsupported_cache_route');
    const owner = view.yaml.match(/Profile picture of ([^"\n]+)\./)?.[1];
    const app = view.yaml.match(/application \[ref=([^\]]+)\]/)?.[1];
    const notices: Observation[] = [];
    try { notices.push(...noticeObservations(evaluationJson(await this.text('browser_evaluate', { function: noticeReader, ...(app ? { target: app } : {}) })), 'teams', view.sourceUrl)); } catch { /* Activity checks remain the notification fallback. */ }
    let content = view.yaml;
    if (route.kind === 'activity') {
      const region = elementRef(view.yaml, 'region', 'Activity');
      if (!region) throw new Error('activity_region_unavailable');
      content = snapshotYaml(await this.text('browser_snapshot', { target: region }));
      if (!content) throw new Error('activity_region_unavailable');
    }
    return { observations: [{ id: route.id, kind: route.kind, title: route.title, sourceUrl: view.sourceUrl, text: content }, ...documents, ...notices], discovered, owner };
  }
  async close() {
    // Close Chrome's persistent context before terminating MCP so sign-in is flushed.
    try { await this.client?.callTool({ name: 'browser_close', arguments: {} }); } catch { /* Still release a failed transport. */ }
    await this.client?.close(); this.client = undefined; this.started = false;
  }
}
