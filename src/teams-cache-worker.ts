import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { TeamsCache, SerialQueue, cacheKinds } from './teams-cache.js';
import { TeamsBrowser, initialRoutes, browserTools, type Route } from './teams-cache-browser.js';
import { cacheAuth, sourcePort, type CacheSource } from './teams-cache-client.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { DiscordBrowser, discordChannel, discordInitialRoutes, mergeDiscordMessages } from './discord-cache-browser.js';
import { loadSecret, saveSecret } from './store.js';

async function saveWatchedRoutes(routes: Route[]) { await saveSecret('discord-watched-routes', routes); }
async function loadWatchedRoutes() {
  const routes = await loadSecret<Route[]>('discord-watched-routes') || [];
  return routes.filter(route => typeof route.id === 'string' && route.id.startsWith('discord/') && route.url && /^https:\/\/discord\.com\/channels\/(?:@me|\d{8,24})(?:\/\d{8,24}){1,2}$/.test(route.url) && Number.isFinite(route.intervalMs) && route.intervalMs >= 30000).slice(0, 2000);
}

export class BackgroundTeams {
  routes = new Map(initialRoutes.map(route => [route.id, route]));
  requested = new Set(initialRoutes.map(route => route.id));
  urgent = new Set<string>();
  nextCheck = new Map<string, number>();
  errors = new Map<string, string>();
  queue = new SerialQueue();
  paused = false;
  running?: string;
  leaseUntil = 0;
  authenticationUnavailable = false;
  lastActivityChangeAt?: string;
  startedAt = new Date().toISOString();
  constructor(public cache: TeamsCache, public browser: Pick<TeamsBrowser, 'collect' | 'call' | 'close' | 'tools'>, private now = () => Date.now(), public source: CacheSource = 'teams') {
    if (source === 'discord') { this.routes = new Map(discordInitialRoutes.map(r => [r.id, r])); this.requested = new Set(this.routes.keys()); }
  }
  status() {
    return { service: 'ssps-' + this.source + '-cache', version: 1, pid: process.pid, startedAt: this.startedAt, paused: this.paused, running: this.running || null, browserLeaseSeconds: Math.max(0, (this.leaseUntil - this.now()) / 1000), records: this.cache.entries.size, queued: this.requested.size, authenticationUnavailable: this.authenticationUnavailable, lastActivityChangeAt: this.lastActivityChangeAt || null, errors: Object.fromEntries(this.errors), notificationPollSeconds: 30, assignmentFallbackSeconds: 300, scope: 'rendered ' + this.source + ' UI, partial coverage' };
  }
  refresh(id?: string) {
    if (id && !this.routes.has(id)) throw new Error('Unknown prefetch route. Use teams_cache_routes to discover routes.');
    for (const key of id ? [id] : this.routes.keys()) { this.requested.add(key); this.nextCheck.set(key, 0); }
    if (id) this.urgent.add(id);
    this.cache.invalidate(entry => !id || entry.id === id || entry.parentId === id);
    return { ...this.status(), refreshQueued: true, route: id || 'all' };
  }
  async tick() {
    if (this.paused || this.running || this.leaseUntil > this.now()) return;
    const activity = this.routes.get(this.source === 'discord' ? 'discord/notifications' : 'activity');
    const route = (activity && this.cache.entries.has(activity.id) && (this.nextCheck.get(activity.id) || 0) <= this.now() ? activity : undefined)
      || [...this.urgent].map(id => this.routes.get(id)).find(r => r && (this.nextCheck.get(r.id) || 0) <= this.now())
      || [...this.routes.values()].find(r => this.requested.has(r.id) && (this.nextCheck.get(r.id) || 0) <= this.now())
      || [...this.routes.values()].find(r => (this.nextCheck.get(r.id) || 0) <= this.now());
    if (!route) return;
    this.running = route.id;
    this.requested.delete(route.id);
    this.urgent.delete(route.id);
    try {
      await this.queue.run(async () => {
        // A foreground caller can acquire its lease while this job is queued.
        if (this.paused || this.leaseUntil > this.now()) { this.requested.add(route.id); return; }
        const documents = [...this.cache.entries.values()].filter(e => e.parentId === route.id);
        const download = !documents.length || documents.some(e => this.now() - Date.parse(e.checkedAt) > 3600000) || !!this.cache.entries.get(route.id)?.invalidatedAt;
        const result = await this.browser.collect(route, download);
        if (result.owner) this.cache.bindAccount(result.owner);
        for (const observation of result.observations) {
          const previous = this.cache.entries.get(observation.id)?.text;
          if (['channel', 'dm'].includes(observation.kind)) observation.text = mergeDiscordMessages(this.cache.entries.get(observation.id)?.text, observation.text);
          const { changed, existed } = this.cache.observe(observation);
          let newNotification = changed && existed;
          if (this.source === 'discord' && observation.id === 'discord/notifications' && previous) {
            const oldUnread = new Set<string>(JSON.parse(previous).unread || []);
            newNotification = newNotification && (JSON.parse(observation.text).unread || []).some((label: string) => !oldUnread.has(label));
          }
          if (['activity', 'notifications'].includes(observation.kind) && newNotification) {
            // ponytail: no blanket invalidate — one new message must not requeue the whole backlog and keep everything stale.
            this.lastActivityChangeAt = new Date(this.now()).toISOString();
            if (this.source === 'teams') this.urgent.add('assignments/upcoming');
          }
        }
        let routesChanged = false;
        // ponytail: detail routes refresh on demand — auto-queueing every assignment/document keeps the whole cache stale.
        for (const discovered of result.discovered) if (!this.routes.has(discovered.id) && this.routes.size < (this.source === 'discord' ? 2000 : 200)) {
          this.routes.set(discovered.id, discovered);
          if (!['assignment', 'document'].includes(discovered.kind)) this.requested.add(discovered.id);
          routesChanged = true;
        }
        if (this.source === 'discord' && routesChanged) await saveWatchedRoutes([...this.routes.values()]);
        this.authenticationUnavailable = false;
        this.errors.delete(route.id);
        this.nextCheck.set(route.id, this.now() + route.intervalMs);
      });
    } catch (error) {
      const code = error instanceof Error && /^[a-z_]{1,80}$/.test(error.message) ? error.message : 'background_read_failed';
      this.errors.set(route.id, code);
      this.authenticationUnavailable = ['authentication_or_teams_unavailable', 'authentication_or_discord_unavailable', 'teams_navigation_unavailable', 'browser_unavailable'].includes(code);
      this.nextCheck.set(route.id, this.now() + (this.authenticationUnavailable ? 120000 : 300000));
      if (this.authenticationUnavailable) {
        // Avoid retrying every remaining route against an expired login.
        for (const key of this.routes.keys()) this.nextCheck.set(key, this.now() + 120000);
      }
    } finally { this.running = undefined; }
  }
  async rpc(method: string, input: Record<string, unknown>) {
    if (method === 'status') return this.status();
    if (method === 'watch' && this.source === 'discord') {
      const args = z.object({ url: z.string().max(500), title: z.string().min(1).max(120) }).parse(input);
      const channel = discordChannel(args.url);
      const route = { ...channel, title: args.title, intervalMs: 30000 };
      if (this.routes.size >= 2000 && !this.routes.has(route.id)) throw new Error('Discord watch limit is 2000 routes.');
      this.routes.set(route.id, route);
      this.requested.add(route.id);
      await saveWatchedRoutes([...this.routes.values()]);
      return { watched: true, route, ...this.status() };
    }
    if (method === 'routes') return { items: [...this.routes.values()].map(route => ({ ...route, nextCheckAt: new Date(this.nextCheck.get(route.id) || this.now()).toISOString(), error: this.errors.get(route.id) || null })), ...this.status() };
    const offline = this.paused || this.authenticationUnavailable;

    if (method === 'bundle') {
      const args = z.object({ query: z.string().max(200).default(''), kind: z.enum(cacheKinds).optional(), limit: z.number().int().min(1).max(100).default(30), offset: z.number().int().min(0).default(0), maxCharacters: z.number().int().min(100).max(500000).default(200000) }).parse(input);
      const found = this.cache.search(args.query, args.kind, args.limit, false, offline, args.offset);
      let remaining = args.maxCharacters;
      const items = [];
      for (const item of found.items) {
        if (remaining <= 0) break;
        const pending = this.requested.has(item.id) || this.running === item.id || !!item.parentId && (this.requested.has(item.parentId) || this.running === item.parentId);
        const record = this.cache.read(item.id, 0, remaining, item.contentHash, pending, offline || this.errors.has(item.id) || !!item.parentId && this.errors.has(item.parentId));
        items.push(record);
        remaining -= record.text.length;
      }
      const nextOffset = args.offset + items.length < found.total ? args.offset + items.length : null;
      return { status: this.status(), items, total: found.total, nextOffset, incomplete: nextOffset !== null || items.some(item => item.nextOffset !== null || item.truncated), cached: true, coverage: 'loaded UI content; partial, not a complete account sync' };
    }

    if (method === 'search') {
      const args = z.object({ query: z.string().max(200).default(''), kind: z.enum(cacheKinds).optional(), limit: z.number().int().min(1).max(100).default(30), offset: z.number().int().min(0).default(0) }).parse(input);
      const result = this.cache.search(args.query, args.kind, args.limit, false, offline, args.offset);
      for (const item of result.items) item.freshness.refreshPending = this.requested.has(item.id) || this.running === item.id || !!item.parentId && (this.requested.has(item.parentId) || this.running === item.parentId);
      return result;
    }
    if (method === 'read') {
      const args = z.object({ id: z.string().min(1).max(100), offset: z.number().int().min(0).default(0), maxCharacters: z.number().int().min(100).max(50000).default(20000), expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).parse(input);
      return this.cache.read(args.id, args.offset, args.maxCharacters, args.expectedContentHash, this.requested.has(args.id) || this.running === args.id, offline || this.errors.has(args.id));
    }
    if (method === 'refresh') return this.refresh(z.object({ routeId: z.string().max(100).optional() }).parse(input).routeId);
    if (method === 'pause') { this.paused = true; await this.queue.run(() => this.browser.close()); await this.cache.flush(); return this.status(); }
    if (method === 'resume') { this.paused = false; this.leaseUntil = 0; this.refresh(); return this.status(); }
    if (method === 'tools') return this.browser.tools();
    if (method === 'class_members') {
      if (this.source !== 'discord' || !(this.browser instanceof DiscordBrowser)) throw new Error('Class members require the Discord reader.');
      this.leaseUntil = this.now() + 180000;
      try { return await this.queue.run(() => (this.browser as DiscordBrowser).classMembers()); }
      finally { this.leaseUntil = 0; }
    }
    if (method === 'browser') {
      const args = z.object({ name: z.enum(browserTools as [string, ...string[]]), arguments: z.record(z.string(), z.unknown()).default({}) }).parse(input);
      // ponytail: short lease so a live browser session never starves the worker; 20s covers snapshot cadence.
      this.leaseUntil = this.now() + 20000;
      return this.queue.run(async () => {
        const result = await this.browser.call(args.name, args.arguments);
        this.leaseUntil = args.name === 'browser_close' ? 0 : this.now() + 20000;
        return result;
      });
    }
    throw new Error('Unsupported Teams cache method.');
  }
}

export function createCacheHttpServer(worker: BackgroundTeams, token: string): Server {
  const credential = Buffer.from('Bearer ' + token);
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const supplied = Buffer.from(req.headers.authorization || '');
    if (req.headers.origin || supplied.length !== credential.length || !timingSafeEqual(supplied, credential)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Local Teams worker authorization required.' })); return; }
    if (req.method !== 'POST' || req.url !== '/rpc') { res.writeHead(404); res.end('{}'); return; }
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 65536) throw new Error('Request exceeds 64 KiB.'); }
      const request = z.object({ method: z.string().max(30), args: z.record(z.string(), z.unknown()).default({}) }).parse(JSON.parse(body));
      const data = await worker.rpc(request.method, request.args);
      res.end(JSON.stringify({ data }));
    } catch (error) {
      res.writeHead(400);
      const message = error instanceof Error && !(error instanceof z.ZodError) && !/token|password|secret/i.test(error.message) && error.message.length < 200 ? error.message : 'Invalid or failed Teams cache request.';
      res.end(JSON.stringify({ error: message }));
    }
  });
}

async function main() {
  const source: CacheSource = process.argv.includes('--source=discord') ? 'discord' : 'teams';
  const credential = await cacheAuth(false, source);
  if (!credential) throw new Error('Run npm run setup:teams-cache before starting the worker.');
  const cache = new TeamsCache(true, () => Date.now(), source + '-live-cache');
  await cache.load();
  const worker = new BackgroundTeams(cache, source === 'discord' ? new DiscordBrowser() : new TeamsBrowser(), () => Date.now(), source);
  if (source === 'discord') for (const route of await loadWatchedRoutes()) { worker.routes.set(route.id, route); worker.requested.add(route.id); }
  const server = createCacheHttpServer(worker, credential.token);
  const port = sourcePort(source);
  await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveListen); });
  const poll = setInterval(() => { void worker.tick(); }, 1000);
  const persist = setInterval(() => { void cache.flush().catch(() => { worker.errors.set('persistence', 'cache_save_failed'); }); }, 15000);
  void worker.tick();
  async function stop() { clearInterval(poll); clearInterval(persist); worker.paused = true; await worker.queue.run(() => worker.browser.close()); await cache.flush(); server.close(); }
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  console.error(`${source} cache worker listening on loopback port ${port}. Source data and authentication are not logged.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('Teams cache worker could not start. Check setup, port ownership and protected local storage.'); process.exitCode = 1; });
