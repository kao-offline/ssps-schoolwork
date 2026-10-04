import { loadSecret, saveSecret } from './store.js';
import { randomBytes } from 'node:crypto';
export const cachePort = Number(process.env.SCHOOLWORK_TEAMS_CACHE_PORT || 38671);
if (!Number.isInteger(cachePort) || cachePort < 1024 || cachePort > 65535) throw new Error('SCHOOLWORK_TEAMS_CACHE_PORT must be between 1024 and 65535.');
export type CacheSource = 'teams' | 'discord';
export function sourcePort(source: CacheSource) { const port = source === 'teams' ? cachePort : Number(process.env.SCHOOLWORK_DISCORD_CACHE_PORT || 38672); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local cache port.'); return port; }
const auth = new Map<CacheSource, Promise<{ token: string } | undefined>>();
export async function cacheAuth(create = false, source: CacheSource = 'teams') {
  if (!auth.has(source)) auth.set(source, loadSecret<{ token: string }>(source + '-cache-auth'));
  let value = await auth.get(source);
  if (!value && create) {
    value = { token: randomBytes(32).toString('hex') };
    await saveSecret(source + '-cache-auth', value);
    auth.set(source, Promise.resolve(value));
  }
  return value;
}
export async function cacheRequest(method: string, args: Record<string, unknown> = {}, source: CacheSource = 'teams') {
  const credential = await cacheAuth(false, source);
  if (!credential) throw new Error('Teams background worker is not set up. Run npm run setup:teams-cache.');
  let response: Response;
  try {
      response = await fetch(`http://127.0.0.1:${sourcePort(source)}/rpc`, { method: 'POST', headers: { Authorization: `Bearer ${credential.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }), signal: AbortSignal.timeout(['class_members', 'class_member', 'browser', 'pause', 'tools'].includes(method) ? 90000 : 4000), redirect: 'error' });
  } catch { throw new Error('Teams background worker is unavailable. Run npm run start:teams-cache; cached browser data must not be assumed current.'); }
  const result = await response.json() as { data?: unknown; error?: string };
  if (!response.ok || result.error) throw new Error(result.error || 'Teams background request failed.');
  return result.data;
}
