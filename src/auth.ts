import { bakBase, bakHeaders } from './config.js';
import { loadSecret, saveSecret } from './store.js';
import { request } from './http.js';

// ponytail: Teams reads through dedicated Chrome + local cache, so no Microsoft API auth lives here.
type BakCredentials = { base: string; accessToken: string; refreshToken: string; expiresAt: number };
export async function bakLogin(parameters: Record<string, string>) {
  const base = bakBase();
  const response = await request(base + '/api/login', { method: 'POST', headers: { ...bakHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: 'ANDR', ...parameters }) }, 'Bakaláři login');
  const token = await response.json();
  if (!token.access_token || !token.refresh_token || !Number.isFinite(Number(token.expires_in))) throw new Error('Bakaláři returned an invalid token response.');
  const credentials: BakCredentials = { base, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + Number(token.expires_in) * 1000 };
  await saveSecret('bakalari', credentials);
  return credentials.accessToken;
}
let refresh: Promise<string> | undefined;
export async function bakToken() {
  const saved = await loadSecret<BakCredentials>('bakalari');
  if (!saved || saved.base !== bakBase()) throw new Error('Run npm run login:bakalari locally for this school.');
  if (saved.expiresAt > Date.now() + 60_000) return saved.accessToken;
  refresh ??= bakLogin({ grant_type: 'refresh_token', refresh_token: saved.refreshToken }).finally(() => { refresh = undefined; });
  return refresh;
}
