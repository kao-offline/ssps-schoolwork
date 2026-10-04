import { cacheRequest, type CacheSource } from './teams-cache-client.js';
type Request = (method: string, args: Record<string, unknown>, source: CacheSource) => Promise<any>;
export type WarmProgress = { source: CacheSource; completed: number; required: number; records: number; queued: number; elapsedSeconds: number };
export async function warmCache(source: CacheSource, onProgress: (progress: WarmProgress) => void, options: { timeoutMs?: number; request?: Request; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
  const request = options.request || cacheRequest;
  const now = options.now || Date.now;
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const started = now();
  const required = source === 'teams' ? ['assignments/upcoming', 'classes', 'activity'] : source === 'outlook' ? ['outlook/inbox'] : ['discord/navigation', 'discord/notifications'];
  for (const routeId of required) await request('refresh', { routeId }, source);
  let conversationSelected = source !== 'discord';
  while (now() - started < (options.timeoutMs || 180000)) {
    const status = await request('status', {}, source);
    if (status.authenticationUnavailable || status.paused) throw new Error(`${source} sign-in needs attention. Rerun setup in a terminal and complete the dedicated sign-in window.`);
    let completed = 0;
    for (const id of required) {
      try {
        const entry = await request('read', { id, maxCharacters: 100 }, source);
        if (Date.parse(entry.checkedAt) >= started && !entry.freshness.stale) completed++;
      } catch { /* A cold record is not ready until the worker has really read it. */ }
    }
    if (completed === required.length && !conversationSelected) {
      const routes = await request('routes', {}, source);
      const conversation = routes.items.find((route: any) => ['dm', 'channel'].includes(route.kind));
      conversationSelected = true;
      if (conversation) { required.push(conversation.id); await request('refresh', { routeId: conversation.id }, source); }
    }
    const progress = { source, completed, required: required.length, records: status.records, queued: status.queued, elapsedSeconds: Math.round((now() - started) / 1000) };
    onProgress(progress);
    if (completed === required.length && conversationSelected) return { ...progress, ready: true, coverage: 'Initial views checked and cached; remaining accessible routes continue warming in the background. Message history is partial.' };
    await sleep(2000);
  }
  throw new Error(`${source} initial cache is still warming after the setup timeout. Existing records are preserved; rerun --no-login when the connection is ready.`);
}
