# SSPS Schoolwork

A local, read-only MCP server and agent skill that give an AI agent the context for homework and projects: Teams assignments, teacher announcements and replies, Bakaláři homework/messages, and attached documents.

Each student runs their own process and connects their own accounts. No shared class database or AI provider key is required. The agent app supplies the AI. Node.js 22.13+ and npm are required. This repository uses npm and its committed lockfile.

## Install and connect

```powershell
npm ci
npm run build
npm run setup
```

Fill in `MICROSOFT_CLIENT_ID` in `.env` using a school-approved Microsoft Entra app registration. `MICROSOFT_TENANT_ID` can be the school's tenant ID, otherwise it defaults to `organizations`. The Bakaláři default is `https://bakalari.ssps.cz`.

`npm run setup` preserves an existing `.env` and generates an ignored `mcp.local.json` with the actual Node executable and absolute project paths. Use its `mcpServers.schoolwork` entry in your client configuration.

```powershell
npm run login:teams
npm run login:bakalari
npm run doctor
```

Teams login prints a Microsoft device-login URL/code. Sign in in your browser. Bakaláři login prompts for username and a hidden password locally; it saves the returned tokens, never the password. Don't put passwords or tokens in agent chats or command arguments. Run `npm run logout` to remove both local saved accounts. Disconnecting locally does not revoke Microsoft consent; that can be managed in your Microsoft account/school tenant.

On Windows, token files under `~/.ssps-schoolwork` are encrypted using Windows DPAPI for the current Windows user. Other operating systems use private directory/file permissions (700/600); they do not use OS-backed encryption. Never share the credentials directory. Run one server process per student/data directory to avoid simultaneous token-cache writes. `SCHOOLWORK_DATA_DIR` can select a different private directory. Do not run this stdio process as a shared web service.

## Microsoft app setup

If Microsoft consent is blocked, a partial offline route is available: load the local browser extension in `browser/teams-capture`, manually open the relevant Teams page, export its rendered text, then run `npm run import:teams -- "C:/path/to/capture.json"`. Agents can search/read imported snapshots with `list_captured_teams_context` and `read_captured_teams_context`. This requests no Microsoft API consent and controls no desktop or navigation. Browser policy must allow the extension. It is not a live Teams connection or complete sync; attachments and unloaded/embedded content can be absent. See [setup, investigated alternatives and feature map](docs/teams-access-and-features.md).

The school IT administrator may need to register or approve the app in Entra. Configure a public client supporting device-code flow (Authentication → allow public client flows). No client secret is needed. Request delegated read permissions:

| Permission | Purpose |
| --- | --- |
| User.Read | Verify connected identity |
| Team.ReadBasic.All | Discover joined Teams |
| Channel.ReadBasic.All | Discover subject channels |
| EduRoster.ReadBasic | Discover the student's education classes |
| EduAssignments.Read | Read assignment instructions/resources |
| ChannelMessage.Read.All | Read channel announcements and replies |
| Files.Read.All | Read school files accessible to the signed-in student |

Tenant policy/admin consent can block these permissions or device-code flow. A token copied from another app is not a substitute for this registration. Files.Read.All is read access to files the user can access; the server retrieves only documents requested by the agent. No application permissions, submission permissions or message-send permissions are requested. If consent fails, school IT must approve the application or provide an allowed authentication configuration.

## Agent configuration

Use stdio MCP in any client that supports it. This includes compatible Codex and Claude configurations; Hermes and other clients depend on their own MCP support. Hosted/web-only clients need a separately hosted, authenticated remote server; this release is local.

Use absolute paths. A typical MCP JSON configuration is:

```json
{
  "mcpServers": {
    "schoolwork": {
      "command": "node",
      "args": [
        "--env-file-if-exists=C:/path/to/ssps-bak-a-teams/.env",
        "C:/path/to/ssps-bak-a-teams/dist/index.js"
      ]
    }
  }
}
```

Codex TOML equivalent:

```toml
[mcp_servers.schoolwork]
command = "node"
args = ["--env-file-if-exists=C:/path/to/ssps-bak-a-teams/.env", "C:/path/to/ssps-bak-a-teams/dist/index.js"]
```

Copy `skills/class-schoolwork` to the agent's supported skill directory (for Codex, `~/.codex/skills/`). Clients without skills can use that file's body as their project instructions. The portable `plugin.json` and `mcp.json` also package the skill/server together for clients supporting Agent Plugins; `${PLUGIN_ROOT}` is a plugin-host placeholder, not a normal shell variable. Build and install dependencies before using the plugin folder.

Hermes is configured on this computer's default Windows profile with 18 schoolwork MCP tools, eight live browser tools and the `class-schoolwork` skill. Start a new session and use `/class-schoolwork`. Live Teams uses a dedicated Chrome profile and ordinary Microsoft sign-in rather than our Graph app registration. See [live Teams setup and coverage](docs/teams-live-browser.md) and [installed paths and recovery](docs/hermes-setup.md). Graph consent remains separately blocked.

Try: “Find my projects due this week, read the attached requirements and relevant teacher replies, then help me start the programming project.”

## Tools and coverage

`connection_status`, `list_classes`, `list_channels`, `list_schoolwork`, `get_assignment`, `list_announcements`, `get_thread`, `get_bakalari_message`, `bakalari_capabilities`, `list_bakalari_subjects`, `list_bakalari_lesson_topics`, `read_bakalari_data`, `read_bakalari_web`, `resolve_document_link`, `read_document`.

Offline fallback tools: `list_captured_teams_context`, `read_captured_teams_context`. Snapshots carry capture time, age, source page and partial-scope metadata. Original exports are plaintext; imported copies use the existing protected local store. `logout` removes account credentials only; captures persist separately.

Bakaláři additionally exposes marks and historical report cards, absences, subject/teacher information, recorded lesson topics/descriptions, actual/permanent timetables with lesson content/plan fields, substitutions, events, profile, consents and account-permitted modules. Sent messages are supported as well as received messages and noticeboard posts. `bakalari_capabilities` discovers rights; `probe=true` verifies the read API areas live. See [verified coverage and permission limits](docs/bakalari-coverage.md).

`read_bakalari_data` and `read_bakalari_web` return bounded JSON strings with `nextOffset` and `contentHash`. Concatenate subsequent chunks using `expectedContentHash` to avoid mixing different versions of changing school data. Web reads use temporary, memory-only same-origin school sessions. Some areas provide only server-rendered page text; dynamic grids and nested file-manager folders can be missing. Those responses explicitly disclose their coverage limit. JSON application failures are reported as errors even when HTTP status is 200. Educational catalogue metadata is read without returning signed download links.

Lists support bounded output and pagination where applicable. Microsoft collections are fetched up to 20 upstream pages; `incomplete` reports that limit. Search is literal text over fetched posts, not a global semantic index. Threads are read separately. Each response includes retrieval time and the Prague timezone. Source errors are preserved instead of reporting an empty list.

Document support: PDF with page references, DOCX text, PPTX with slide references, and common text/code files. Limits: 20 MiB download, 50 MiB expanded Office archive, 300 PDF pages, 50,000 characters per tool response. Use `nextOffset` to continue. Images, scanned PDF OCR, legacy Office formats and external websites are unsupported. Downloads are processed in memory, never executed or saved as homework files. Microsoft download URLs must use supported Microsoft storage hosts; no arbitrary URL fetch tool is exposed.

Bakaláři homework deadlines are date-only. Messages are read without marking them read; the documented Komens list API uses POST for reading. No submit, send, complete, grade-edit or file-edit tools exist. Push notifications and shared hosting remain outside this release. Teacher-only modules stay blocked when the account lacks permission.

## Validation and deployment

```powershell
npm run check
npm audit
npm run doctor
```

The tests cover document extraction, pagination, access-boundary failures, source errors and an actual stdio MCP handshake/tool call. Connector integration tests use controlled HTTP fixtures, not school access. Live verification requires account setup and consent: `doctor`, then exercise an actual assignment, channel thread and attached document in your agent.

Deployment for this release is the local built stdio process (`npm start` or the absolute-path config above). There is no public endpoint. Updating: retain the previous checkout/build, run `npm ci` and `npm run check`, then restart the agent's MCP process. Roll back by reconnecting the previous build. No database or migrations are needed. No remote repository is configured yet. The included GitHub Actions workflow runs checks on Windows and Linux after pushing; its remote results have not been verified.

API references: [MCP server guide](https://modelcontextprotocol.io/docs/develop/build-server), [Graph assignments](https://learn.microsoft.com/en-us/graph/api/educationclass-list-assignments), [Graph assignment resources](https://learn.microsoft.com/en-us/graph/api/educationassignment-list-resources), [Graph channel messages](https://learn.microsoft.com/en-us/graph/api/channel-list-messages), [Graph files](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content), [Bakaláři community API v3 documentation](https://github.com/bakalari-api/bakalari-api-v3), [SSPS student portals](https://ssps.cz/skola/pro-studenty/). Bakaláři is a community-documented API; verify its behavior against the school's instance.

## Current checkpoint

Initial workspace was empty with no Git repository, remote, services or account configuration. Work is isolated on `feat/schoolwork-mcp`; the first feature commit is the recovery checkpoint (see `git log -1`). Local Windows verification on 2026-10-01: lint, typecheck, build, eight tests, skill validation and dependency audit passed. The built stdio process was verified through MCP initialization, tool discovery and a connection-status call. Setup generated local absolute paths and preserved the existing environment file.

Live verification on 2026-10-01 after local Bakaláři login: the school API returned HTTP 500 without Accept-Language, but succeeded with `Accept-Language: cs`. The connector now sends that header on login, refresh, JSON reads and attachment downloads. Regression fixtures reproduce the missing-header failure. On branch `fix/bakalari-language-header`, lint, typecheck, build and all eight tests passed again. The rebuilt stdio MCP process verified live account connectivity, six received messages, three noticeboard posts, a received-message detail and Word attachment extraction. Homework retrieval succeeded with zero matching items for 2026-09-01 through 2026-10-31. No private school content was saved to the repository.

Teams remains disconnected because MICROSOFT_CLIENT_ID is unset. Next action for Teams: configure the public Microsoft app client ID, obtain school consent if required, sign in locally, then check a real assignment/thread/document. There is no hosted endpoint, installed agent connection, pushed branch, PR or remote CI result. Existing local MCP clients use the rebuilt `dist/index.js`; restart their MCP process to pick up the fix. Keep the previous feature commit as the rollback checkpoint; reverting the language-header fix would restore the known Bakaláři failure.

Expanded read coverage on `feat/bakalari-read-coverage`: 15 MCP tools, permission discovery, marks/report cards, attendance, timetable/lesson content, substitutions, events, subject topics and read-only web sections. All 19 subjects and 192 recorded topics were verified live through MCP, alongside API-module and web-section checks. Web educational catalogue metadata and empty open/closed survey lists were verified. Read limits and permission blocks are recorded in docs/bakalari-coverage.md. The preceding commit `7c5c5c5` is the rollback checkpoint for this expansion.

## Fast background context and Discord

Teams and Discord now have shared headless background workers, protected persistent caches and cache-first MCP search/read tools. Live browser tools reserve the same worker, avoiding competing Chrome profiles. This installation is configured in Hermes with schoolwork (24 tools), teams_live (8) and discord_live (8), plus both skills and hidden Windows startup. See [background cache setup, routes and limits](docs/background-context-cache.md) and [Hermes setup](docs/hermes-setup.md).

Discord discovers the signed-in account's accessible servers and exposed DMs/channels. It caches observed messages and edits, preserving source links; unloaded history, closed DMs, threads and attachment binaries are not a complete archive. The initial crawl runs independently of cached reads.
