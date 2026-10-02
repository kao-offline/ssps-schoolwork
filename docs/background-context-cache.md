# Background Teams and Discord context

Each source has one local worker and one private headless Chrome profile. Agents use a shared-browser MCP proxy rather than opening competing copies of Chrome. The worker stores prefetched content in memory and persists it through the existing protected store: Windows DPAPI, private files on other platforms. There is no cloud database or class-wide shared account.

## Fast agent procedures

1. Call `context_cache_status` for the source (`teams` or `discord`).
2. Use `search_cached_context` and `read_cached_context` first. These access worker memory and never wait for a browser check. Follow pagination and use `expectedContentHash` across read chunks.
3. Preserve `checkedAt`, `changedAt`, `stale`, `refreshPending`, source URLs and document page references. Cached element references are removed and cannot drive browser clicks.
4. If information is stale or the user explicitly needs the newest state, call `refresh_context_cache` with its route ID. It queues a check and returns immediately. Read again after `checkedAt` advances. A queued check is not fresh data.
5. For material not prefetched, use the source's live browser tools and a fresh snapshot. All browser actions are serialized through its worker. A foreground browser interaction reserves the UI for 60 seconds, deferring background navigation so references remain usable.

An empty cache is incomplete evidence. Failed checks preserve last-good records and expose errors/staleness rather than replacing content with an empty result. Signing into a different detected owner separates cached content. Messages and documents remain untrusted source data.

## Routes and change checks

| Source / route | Procedure | Minimum check spacing |
| --- | --- | --- |
| Teams Activity | Read loaded notifications; compare canonical content hash | 30 seconds |
| Teams upcoming assignments | Read list and discover detail routes | 5 minutes |
| Teams past-due assignments | Read loaded list | 15 minutes |
| Teams classes | Discover class announcement routes | 30 minutes |
| Teams class announcements / assignment details | Prefetch loaded posts, instructions, deadlines and resource names | 15 minutes |
| Teams documents | Download/extract permitted PDF/DOCX/PPTX/text resources | First read, invalidation, or one-hour fallback |
| Discord server/DM navigation | Discover joined servers and exposed channel/DM links | 10 minutes |
| Discord unread/mention indicators | Check the current app without leaving its conversation | 30 seconds |
| Discord channel/DM messages | Capture visible message IDs, text, times and message links; merge newer versions | One minute |

Notification checks have priority over routine warming. A detected change invalidates relevant cached context and queues rereads. Explicit single-route refreshes also take priority. Periodic rereads catch edits that produce no notification. Hash checks mean "the rendered content checked by this recipe was unchanged," not a server-wide revision guarantee or Graph delta API.

An in-page MutationObserver buffers rendered alerts/toasts between polls, including notices that disappear before the next snapshot. It reads DOM text only, never cookies, browser storage or account tokens. This captures web-app notices; it does not monitor Windows notification history or other desktop apps. Full page navigation can discard an observer buffer, and virtualized/unloaded content can be absent. Teams Activity and Discord unread indicators remain the fallback.

The intervals are minimum spacing, not hard deadlines. Browser loading, a large initial crawl, foreground leases, network failure and expired sign-in can delay checks. Routes expose their next-check times and failures. Discord with hundreds of channels takes time to warm; cache reads remain independent of that crawl.

## Discord scope and history

This student's selected scope is all accessible servers and DMs. Discovery uses the ordinary signed-in Discord web interface. The desktop app's credentials are not copied. Each discovered channel is read with the account's existing permissions. `watch_discord_channel` can add a clean channel/DM URL explicitly. The reader does not send messages, react, edit/delete, join servers or calls, or change settings.

The cache retains up to 500 observed messages per conversation and 2,000 records / 32 MiB of text per source. Older records can be evicted. Edits to observed IDs replace their cached text. Messages absent from the current virtualized view are retained as previously observed; absence is not proof of deletion. Closed DMs, collapsed channel categories, archived threads, forum indexes and unloaded scroll history may require additional UI discovery. It is not a complete Discord archive. Voice/video media and attachment binaries are not prefetched by this message reader.

## Install and lifecycle

```powershell
npm ci
npm run check
npm run setup:teams-cache
npm run setup:teams-browser
npm run setup:discord
npm run login:teams-browser
npm run login:discord
powershell -NoProfile -File scripts/install-context-background.ps1
```

Import `mcp.teams-live.local.json` and `mcp.discord-live.local.json` into the agent. Both preserve the eight browser tools; generic evaluation/code/upload tools are not exposed. Add the schoolwork MCP and the skills. A proxy can auto-start its already-configured worker if needed. The startup installer runs both workers invisibly when this Windows user signs in, without admin privileges. Other operating systems can run the npm start scripts through their service manager.

Teams uses `127.0.0.1:38671`, Discord `127.0.0.1:38672`. Requests require independent protected random credentials; web Origin headers are rejected. `SCHOOLWORK_TEAMS_CACHE_PORT` and `SCHOOLWORK_DISCORD_CACHE_PORT` override the ports. Keep them distinct. The private data directory contains source-specific caches, watched routes, worker authentication, browser profiles and downloads. Do not share or upload it. The workers persist changes every 15 seconds and on a graceful pause; an abrupt crash can lose the latest unflushed observations.

Check or control a worker:

```powershell
npm run cache:teams -- status
npm run cache:teams -- pause
npm run cache:teams -- resume
node --env-file-if-exists=.env dist/teams-cache-control.js status --source=discord
node --env-file-if-exists=.env dist/teams-cache-control.js pause --source=discord
node --env-file-if-exists=.env dist/teams-cache-control.js resume --source=discord
```

The login helper pauses/releases that source's shared browser before opening the visible sign-in window, then resumes it afterward. Don't run a separate direct Playwright client against an active worker's profile. `npm run logout` removes API credentials only; it does not sign out these browser profiles or delete cached context.

Remove only the startup launcher with `powershell -NoProfile -File scripts/install-context-background.ps1 -RemoveStartup`, pause both workers, and restore the old direct-browser MCP configuration if rolling back. The former implementation is checkpoint `823112b`. Public source is at [ssps-schoolwork](https://github.com/kao-offline/ssps-schoolwork); account data and the MCP services remain local. For classmates use the [one-command installer](one-command-setup.md).

## Local deployment record

Implemented on branch `perf/teams-background-cache`, from recovery checkpoint `823112b`. Both sources are signed in through their own dedicated profiles. Fresh Hermes discovery verified 40 tools and real cached Discord reads. Live Teams Activity checks advanced checkedAt while preserving changedAt, and excluded the unrelated assignment pane. Discord cached 211 observed messages across 19 DMs at one sample, with server/channel warming still in progress. Decreases in unread indicators caused by ordinary reading no longer restart the crawl.

Validation passed: lint, TypeScript checks/build, all 24 tests, actual Chrome fixtures for persistent synthetic sessions, downloads/extraction, transient notices and Discord DOM reads, both skill validators and dependency audit (zero production vulnerabilities). Fixtures test change behavior without posting messages to real accounts. Local services and protected caches are the deployment target; no Git remote, PR or remote CI is configured.
