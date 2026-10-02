// Self-contained: Chrome serializes this function into the user's active tab.
export function capturePage() {
  const url = new URL(location.href);
  const host = url.hostname;
  if (url.protocol !== 'https:' || !(['teams.microsoft.com', 'teams.cloud.microsoft', 'www.onenote.com', 'onenote.com', 'onenote.officeapps.live.com'].includes(host) || host.endsWith('.sharepoint.com'))) {
    throw new Error('Open Teams, your school SharePoint page, or OneNote first. Sign-in pages are not captured.');
  }
  if (/^\/(?:error|login|signin)(?:\/|$)/i.test(url.pathname)) throw new Error('Open a schoolwork page after signing in.');
  const selection = window.getSelection()?.toString().trim();
  const root = document.querySelector('main, [role="main"]') || document.body;
  const text = selection || root?.innerText?.trim() || '';
  if (!text) throw new Error('No rendered text found. Open the assignment or select its text first.');
  // Drop URL queries/fragments, which can contain authentication or signed links.
  const sourceUrl = url.origin + url.pathname;
  return {
    schemaVersion: 1, source: 'teams-web-capture', capturedAt: new Date().toISOString(),
    sourceUrl, title: document.title.slice(0, 500), text: text.slice(0, 100000),
    scope: selection ? 'selected-text' : 'rendered-main-frame', truncated: text.length > 100000,
    complete: false,
  };
}
