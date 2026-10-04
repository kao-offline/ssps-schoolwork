import { createHash } from 'node:crypto';
import { loadSecret, saveSecret } from './store.js';

export const cacheKinds = ['classes', 'assignments', 'activity', 'announcements', 'assignment', 'document', 'channel', 'notifications', 'servers', 'dm', 'mailbox', 'email'] as const;
export type CacheKind = typeof cacheKinds[number];
export type Observation = { id: string; kind: CacheKind; title: string; text: string; sourceUrl: string; parentId?: string; references?: string[] };
export type CacheEntry = Observation & { contentHash: string; checkedAt: string; changedAt: string; invalidatedAt?: string; truncated?: boolean };
export function canonical(text: string) {
  return text.replace(/\s*\[ref=[^\]]+\]/g, '').replace(/\s*\[(?:active|cursor=pointer)\]/g, '')
    .replace(/\b\d+ (?:seconds?|minutes?|hours?|days?) ago\b/gi, '[relative time]').trim();
}
export function cacheId(prefix: string, value: string) { return prefix + '/' + createHash('sha256').update(value).digest('hex').slice(0, 24); }

export class TeamsCache {
  entries = new Map<string, CacheEntry>();
  accountKey?: string;
  dirty = false;
  private saving?: Promise<void>;
  constructor(private persist = true, private now = () => Date.now(), private storageName = 'teams-live-cache') {}
  async load() {
    if (!this.persist) return;
    const saved = await loadSecret<{ version: number; accountKey?: string; entries: CacheEntry[] }>(this.storageName);
    if (!saved) return;
    if (saved.version !== 1 || !Array.isArray(saved.entries) || saved.entries.length > 2000) throw new Error('Unsupported Teams cache. Keep the saved file for recovery.');
    for (const entry of saved.entries) {
      if (typeof entry.id !== 'string' || typeof entry.text !== 'string' || entry.text.length > 200000 || !Number.isFinite(Date.parse(entry.checkedAt))) throw new Error('Invalid Teams cache record.');
      this.entries.set(entry.id, entry);
    }
    this.accountKey = saved.accountKey;
  }
  bindAccount(key: string) {
    if (this.accountKey && this.accountKey !== key) this.entries.clear();
    if (this.accountKey !== key) { this.accountKey = key; this.dirty = true; }
  }
  observe(input: Observation) {
    const text = canonical(input.text).slice(0, 200000);
    const contentHash = createHash('sha256').update(text).digest('hex');
    const previous = this.entries.get(input.id);
    const time = new Date(this.now()).toISOString();
    const changed = previous?.contentHash !== contentHash;
    const entry: CacheEntry = { ...input, text, contentHash, checkedAt: time, changedAt: changed ? time : previous.changedAt, truncated: input.text.length > 200000 };
    this.entries.set(input.id, entry);
    while (this.entries.size > 2000 || [...this.entries.values()].reduce((sum, e) => sum + Buffer.byteLength(e.text), 0) > 32 * 1024 * 1024) {
      const oldest = [...this.entries.values()].filter(e => !['classes', 'activity', 'assignments'].includes(e.kind)).sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))[0];
      if (oldest) this.entries.delete(oldest.id); else break;
    }
    this.dirty = true;
    return { entry, changed, existed: !!previous };
  }
  invalidate(predicate: (entry: CacheEntry) => boolean) {
    const time = new Date(this.now()).toISOString();
    for (const entry of this.entries.values()) if (predicate(entry)) entry.invalidatedAt = time;
    this.dirty = true;
  }
  freshness(entry: CacheEntry, pending = false, offline = false) {
    const ageSeconds = Math.max(0, (this.now() - Date.parse(entry.checkedAt)) / 1000);
    // ponytail: TTLs sit ~1.5x above each kind's poll interval so an on-schedule route reads fresh.
    const ttl = ['activity', 'notifications'].includes(entry.kind) ? 90 : entry.kind === 'classes' ? 2400 : ['assignments', 'assignment'].includes(entry.kind) ? 450 : entry.kind === 'document' ? 3600 : ['dm', 'channel'].includes(entry.kind) ? 450 : 1200;
    return { checkedAt: entry.checkedAt, changedAt: entry.changedAt, ageSeconds, stale: offline || !!entry.invalidatedAt || ageSeconds > ttl, refreshPending: pending, coverage: 'loaded UI content; partial, not a complete account sync', liveRequest: false };
  }
  search(query = '', kind?: CacheKind, limit = 30, pending = false, offline = false, offset = 0) {
    const term = query.toLocaleLowerCase('cs');
    const matches = [...this.entries.values()].filter(e => (!kind || e.kind === kind) && `${e.title}\n${e.text}`.toLocaleLowerCase('cs').includes(term)).sort((a, b) => b.changedAt.localeCompare(a.changedAt));
    return { items: matches.slice(offset, offset + limit).map(e => ({ id: e.id, kind: e.kind, title: e.title, parentId: e.parentId, sourceUrl: e.sourceUrl, contentHash: e.contentHash, snippet: e.text.slice(Math.max(0, e.text.toLocaleLowerCase('cs').indexOf(term) - 100), Math.max(0, e.text.toLocaleLowerCase('cs').indexOf(term) - 100) + 500), freshness: this.freshness(e, pending, offline) })), total: matches.length, nextOffset: offset + limit < matches.length ? offset + limit : null, cached: true };
  }
  read(id: string, offset = 0, maxCharacters = 20000, expectedHash?: string, pending = false, offline = false) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Teams cache record is not available yet. Queue a refresh or use live browser tools.');
    if (expectedHash && expectedHash !== entry.contentHash) throw new Error('Cached content changed between chunks. Restart at offset 0.');
    return { ...entry, text: entry.text.slice(offset, offset + maxCharacters), totalCharacters: entry.text.length, nextOffset: offset + maxCharacters < entry.text.length ? offset + maxCharacters : null, freshness: this.freshness(entry, pending, offline), cached: true, elementRefsUsable: false };
  }
  async flush() {
    if (this.saving) { await this.saving; if (this.dirty) await this.flush(); return; }
    if (!this.persist || !this.dirty) return;
    this.dirty = false;
    const snapshot = { version: 1, accountKey: this.accountKey, entries: [...this.entries.values()] };
    this.saving = saveSecret(this.storageName, snapshot);
    try { await this.saving; } catch (error) { this.dirty = true; throw error; } finally { this.saving = undefined; }
  }
}

export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
