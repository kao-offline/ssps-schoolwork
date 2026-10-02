import { cacheId, type Observation } from './teams-cache.js';
export const noticeReader = `() => {
  const key = '__sspsRenderedNotices';
  if (!globalThis[key]) {
    const state = { items: [], last: '', overflow: false };
    const scan = () => {
      for (const element of document.querySelectorAll('[role="alert"], [aria-live="assertive"], [data-testid*="toast"]')) {
        const text = element.innerText?.trim();
        if (!text || text === state.last || text.length > 4000) continue;
        state.last = text;
        state.items.push({ at: new Date().toISOString(), text });
        if (state.items.length > 100) { state.items.shift(); state.overflow = true; }
      }
    };
    state.observer = new MutationObserver(scan);
    state.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    globalThis[key] = state;
    scan();
  }
  const state = globalThis[key];
  return { items: state.items.splice(0), overflow: state.overflow };
}`;
export function evaluationJson(text: string) {
  const result = text.split('### Result\n')[1]?.split('\n### ')[0]?.trim().replace(/^```json\s*|\s*```$/g, '');
  if (!result) throw new Error('browser_dom_read_unavailable');
  return JSON.parse(result);
}
export function noticeObservations(result: { items: { at: string; text: string }[]; overflow?: boolean }, source: string, sourceUrl: string): Observation[] {
  return result.items.slice(0, 100).map(item => ({ id: cacheId(source + '/notice', item.at + '\n' + item.text), kind: 'notifications', title: 'Captured in-page notification', sourceUrl, text: `Observed ${item.at}\n${item.text}\n${result.overflow ? 'Some notifications exceeded the local observer buffer.' : ''}` }));
}
