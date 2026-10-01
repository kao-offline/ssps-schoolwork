import { bak } from './bakalari.js';
import { bakBase, bakHeaders } from './config.js';
import { ApiError, boundedBytes } from './http.js';
import { convert } from 'html-to-text';

// Fixed pages/data sources discovered from the authenticated school web app.
// No forms, consent changes, message sends, report generation or arbitrary URL requests.
export const webAreas = {
  documents: 'next/dokumentyPrehled.aspx', surveys: 'Questionnaire/Filling?mode=Ankety',
  surveys_open: 'Questionnaire/Filling/Questionnaires?filter=0',
  surveys_closed: 'Questionnaire/Filling/Questionnaires?filter=2',
  confirmations: 'core/Reports/Confirmations', teaching_resources: 'core/TeachingResources',
  meetings: 'Collaboration/OnlineMeeting/MeetingsOverview', retake_exams: 'next/opravne.aspx',
  draft_messages: 'next/komens.aspx?l=Concept', portal_messages: 'PortalMessages',
} as const;
export type WebArea = keyof typeof webAreas;

function withoutSignedLinks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSignedLinks);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, withoutSignedLinks(child)]));
  if (typeof value === 'string' && /^https?:\/\//.test(value)) {
    try {
      const url = new URL(value);
      if ([...url.searchParams.keys()].some(key => /^(sig|signature|token|access_token|key|secret|code)$/i.test(key))) return '[signed download link omitted]';
    } catch { /* Ordinary text is retained. */ }
  }
  return value;
}

class WebSession {
  private cookies = new Map<string, string>();
  private root = bakBase();
  async get(path: string) {
    const url = new URL(path, this.root + '/');
    if (url.origin !== new URL(this.root).origin || url.protocol !== 'https:') throw new Error('Cross-origin Bakalari web requests are blocked.');
    try {
      const response = await fetch(url, { headers: { ...bakHeaders(), Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ') }, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      // Session cookies are memory-only, always sent to this same school origin.
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0];
        const separator = pair.indexOf('=');
        if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
      return response;
    } catch (error) { throw new Error('Bakalari web request failed or timed out.', { cause: error }); }
  }
  async login() {
    const token = await bak('logintoken');
    if (typeof token !== 'string' || !token) throw new Error('Bakalari web sign-in is unavailable.');
    const response = await this.get(`api/3/login/${encodeURIComponent(token)}?returnUrl=dashboard`);
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (response.status !== 302 || !location || /\/login(?:[/?]|$)/i.test(location) || !this.cookies.size) throw new Error('Bakalari web sign-in did not establish a session.');
  }
}
export async function readWebArea(area: WebArea) {
  if (!Object.hasOwn(webAreas, area)) throw new Error('Unsupported Bakalari web read area.');
  const session = new WebSession();
  await session.login();
  const response = await session.get(webAreas[area]);
  if (!response.ok) { await response.body?.cancel(); throw new ApiError(response.status, 'Bakalari web'); }
  const bytes = await boundedBytes(response, 5 * 1024 * 1024);
  const content = bytes.toString('utf8');
  if (response.headers.get('content-type')?.includes('json')) {
    const data = JSON.parse(content);
    if (data?.success === false || data?.Success === false) throw new Error(`Bakalari web ${area} returned an unsuccessful application response. This is unavailable data, not an empty list.`);
    return { sourceUrl: new URL(webAreas[area], bakBase() + '/').href, format: 'json', data: withoutSignedLinks(data) };
  }
  if (/id=["']formlogin["']/i.test(content)) throw new Error('Bakalari web session expired or this page requires another sign-in.');
  if (area === 'teaching_resources') {
    const embedded = content.match(/\bviewModel\s*=\s*(\{[^\r\n]*\})\s*;/)?.[1];
    if (embedded) return { sourceUrl: new URL(webAreas[area], bakBase() + '/').href, format: 'embedded_json', data: withoutSignedLinks(JSON.parse(embedded)), limitation: 'Embedded teaching-resource catalogue metadata. Signed file links are omitted; resource binaries and JavaScript interactions were not fetched.' };
  }
  // Strip scripts/styles before conversion. Never return hidden tokens or raw HTML.
  const html = content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const text = convert(html, { wordwrap: false, limits: { maxInputLength: 5 * 1024 * 1024 }, selectors: [{ selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' }] });
  return { sourceUrl: new URL(webAreas[area], bakBase() + '/').href, format: 'page_text', text, limitation: 'Server-rendered page text only. JavaScript-loaded grids, forms and download actions may not be included. No scripts or forms were executed.' };
}
