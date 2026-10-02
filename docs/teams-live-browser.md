# Live Teams in Hermes

This mode uses Microsoft's Playwright MCP to read the ordinary Teams web app with a dedicated Chrome profile. Routine agent reads run headlessly, without opening or controlling your normal desktop browser. The login helper opens a visible dedicated window for manual sign-in. It does not use our Graph app registration. Microsoft sign-in, MFA, school access policies and document permissions still apply. The student signs in directly in Microsoft pages.

On this computer the Hermes default profile has `teams_live` enabled alongside `schoolwork`. Open a new Hermes session after completing sign-in and use:

> /class-schoolwork Use live Teams to read my assignments, deadlines and teacher announcements. Open the original instructions and relevant documents. Tell me which classes and date ranges you checked.

For another local installation:

```powershell
npm ci
npm run check
npm run test:teams-browser
npm run setup:teams-browser
npm run login:teams-browser
```

Add the `teams_live` entry from the generated `mcp.teams-live.local.json` to your agent's MCP configuration. Its command and arguments are absolute. Hermes also understands the `enabled`, `connect_timeout` and `tools.include` fields; other clients may require adapting those fields. Keep only the eight tools in the generated filter when your client supports tool filtering. Install the repository's `class-schoolwork` skill using your agent's skill conventions.

The login command opens Chrome and waits up to 15 minutes. It closes the browser after detecting Teams navigation. This detection confirms the app loaded; it does not prove any particular class or assignment is readable. Only one agent/login process can use this profile at once. Close the login helper before an agent navigates Teams. Subsequent sessions use the saved profile; expired sign-in or MFA needs another manual sign-in.

## Reading workflow

Hermes exposes `mcp__teams_live__browser_navigate`, `browser_navigate_back`, `browser_snapshot`, `browser_click`, `browser_press_key`, `browser_tabs`, `browser_wait_for` and `browser_close`. Navigate to `https://teams.microsoft.com/v2/`, inspect a fresh snapshot and open classes, channels, assignment details and replies. Navigation/click actions can return a snapshot file link; call browser_snapshot without filename to get inline readable text. Pass the exact element reference (for example f4e207) as browser_click.target. Use snapshot references and ordinary UI navigation; scroll to load more content. The schoolwork skill constrains these generic interaction tools to reading. The browser tool itself does not enforce a read-only UI.

Do not send messages, submit/undo homework, upload/edit files, answer quizzes, change grades or settings without a separate user instruction. Opening content can trigger normal Teams read receipts. Never extract cookies, storage, passwords or access tokens.

For documents, use the resource's ordinary Download action. The browser MCP saves downloads beneath its configured output directory. Pass the relative filename from its download result to `mcp__schoolwork__read_downloaded_teams_document`. The reader supports PDF, DOCX, PPTX and text, limits files to 20 MiB and rejects paths or symlinks outside that directory. Follow `nextOffset` to read remaining text. Preserve the original resource/page URL in citations; the local modification time is a download/file timestamp, not a teacher revision timestamp. Scanned PDFs, ink and images require separate visual reading.

## Feature coverage and limits

| Area | Live browser workflow | Coverage limit |
| --- | --- | --- |
| Classes and channels | Open Teams/Chat class navigation | Enumerate visible and expanded items; no structured Graph IDs guaranteed |
| Homework, project deadlines and resources | Open Assignments/Zadání and each detail | Check selected filters, class and date range; exact displayed deadline text |
| Announcements and teacher corrections | Read channel posts and expand replies | Scroll/paginate for history; unloaded posts are absent |
| Files and class materials | Open file listing and download permitted resources | Student's existing permissions; no blanket drive crawl |
| Grades, feedback and submission state | Open returned assignment or Grades | Reading only; own visible data |
| Classwork and notebooks | Expand modules/open linked pages | Frames, canvas, ink and external tabs can limit readable text |
| Calendar, meetings, activity and school chats | Open the relevant view/detail | Loaded content only; no background synchronization |
| Forms, quizzes and other apps | Inspect permitted instructions | No answering/submission; external app access may differ |

This is live UI access, not a complete structured school sync. State what was checked and any unavailable areas. The existing Graph tools remain separately disconnected while consent is blocked. `connection_status.teams.connected=false` describes Graph authentication, not the browser profile. Offline capture tools remain an optional fallback and must be identified as older partial snapshots.

## Storage and recovery

The default profile and downloads are under `~/.ssps-schoolwork/teams-browser-profile` and `teams-browser-output`; `SCHOOLWORK_DATA_DIR` overrides their parent directory. These contain private school data and authentication state. Keep them local and do not commit or upload them. Chrome manages its own authentication storage; it is separate from the server's DPAPI token store. `npm run logout` clears API tokens only and does not sign out this browser or delete downloads. Sign out using Microsoft's ordinary UI when needed.

The integration pins `@playwright/mcp` to 0.0.83 and uses the installed Chrome browser. Hermes config was backed up locally with Windows DPAPI before adding this entry. Remove only `teams_live` from Hermes to disable the browser connection; avoid restoring an old whole config after other settings change.

## Verified on this computer

On 2026-10-02 the installed Hermes runtime read live class navigation (11 teams), an upcoming assignment list (three visible entries), an assignment detail and deadline, teacher channel posts and an expanded reply thread. It downloaded an assignment PDF and extracted its first page using read_downloaded_teams_document. A separate fresh headless Hermes process reused the saved sign-in and verified school class content. Grades, calendar, notebooks, archived classes and full histories were not exhaustively checked. This is live sample verification, not a completeness claim.
