import { PublicClientApplication } from '@azure/msal-node';
import { scopes, bakBase, bakHeaders } from './config.js';
import { loadSecret, saveSecret } from './store.js';
import { request } from './http.js';

export async function microsoftApp() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) throw new Error('Set MICROSOFT_CLIENT_ID and run npm run login:teams locally.');
  const tenant = process.env.MICROSOFT_TENANT_ID || 'organizations';
  if (!/^[a-zA-Z0-9.-]+$/.test(tenant)) throw new Error('Invalid Microsoft tenant ID.');
  const app = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenant}` }, cache: { cachePlugin: {
    beforeCacheAccess: async context => {
      const cache = await loadSecret<{ clientId: string; tenant: string; cache: string }>('microsoft');
      if (cache?.clientId === clientId && cache.tenant === tenant) context.tokenCache.deserialize(cache.cache);
    },
    afterCacheAccess: async context => {
      if (context.cacheHasChanged) await saveSecret('microsoft', { clientId, tenant, cache: context.tokenCache.serialize() });
    },
  } } });
  return app;
}
export async function microsoftToken() {
  const app = await microsoftApp();
  const accounts = await app.getTokenCache().getAllAccounts();
  if (accounts.length !== 1) throw new Error('Run npm run login:teams locally to connect one student account.');
  try {
    const result = await app.acquireTokenSilent({ account: accounts[0], scopes });
    return result.accessToken;
  } catch { throw new Error('Microsoft sign-in needs attention. Run npm run login:teams locally; school IT may need to approve permissions.'); }
}
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
