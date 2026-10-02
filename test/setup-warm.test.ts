import test from 'node:test';
import assert from 'node:assert/strict';
import { warmCache, type WarmProgress } from '../src/setup-warm.js';
test('initial cache loader waits for real fresh checks rather than accepting previously cached content', async () => {
  let now = 100000;
  const progress: WarmProgress[] = [];
  const refreshed: string[] = [];
  const result = await warmCache('teams', value => progress.push(value), {
    now: () => now, sleep: async ms => { now += ms; },
    request: async (method, args) => {
      if (method === 'refresh') { refreshed.push(String(args.routeId)); return {}; }
      if (method === 'status') return { records: 50, queued: 20, paused: false, authenticationUnavailable: false };
      if (method === 'read') return { checkedAt: new Date(now === 100000 ? 50000 : now).toISOString(), freshness: { stale: false }, text: 'private fixture message' };
      throw new Error('Unexpected call');
    },
  });
  assert.deepEqual(refreshed, ['assignments/upcoming', 'classes', 'activity']);
  assert.equal(progress[0].completed, 0);
  assert.equal(result.ready, true);
  assert.equal(result.elapsedSeconds, 2);
  assert.ok(!JSON.stringify(progress).includes('private fixture message'));
});
test('Discord loader includes a discovered conversation before reporting ready', async () => {
  let now = 100000;
  const refreshed: string[] = [];
  const result = await warmCache('discord', () => undefined, {
    now: () => now, sleep: async ms => { now += ms; },
    request: async (method, args) => {
      if (method === 'refresh') { refreshed.push(String(args.routeId)); return {}; }
      if (method === 'status') return { records: 3, queued: 10 };
      if (method === 'routes') return { items: [{ id: 'dm/example', kind: 'dm' }] };
      if (method === 'read') return { checkedAt: new Date(now).toISOString(), freshness: { stale: false } };
      throw new Error('Unexpected call');
    },
  });
  assert.deepEqual(refreshed, ['discord/navigation', 'discord/notifications', 'dm/example']);
  assert.equal(result.required, 3);
  assert.equal(result.completed, 3);
});
test('cache loader reports authentication failures and incomplete warm-up without claiming success', async () => {
  await assert.rejects(warmCache('teams', () => undefined, { request: async method => method === 'status' ? { authenticationUnavailable: true } : {} }), /sign-in/);
  let now = 100000;
  await assert.rejects(warmCache('teams', () => undefined, {
    timeoutMs: 10000, now: () => now, sleep: async ms => { now += ms; },
    request: async method => method === 'status' ? { records: 500, queued: 20 } : method === 'read' ? { checkedAt: new Date(0).toISOString(), freshness: { stale: true } } : {},
  }), /still warming/);
});
