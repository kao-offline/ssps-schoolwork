# Hermes setup on this computer

Configured and verified on 2026-10-02 for the local Windows Hermes default profile. No AI-provider credentials or school tokens were copied into Hermes config. Each new session connects to the existing local MCP using the same Windows user and protected school-account store.

## Installed configuration

- Hermes executable: C:/Users/hrdyk/AppData/Local/hermes/hermes-agent/venv/Scripts/hermes.exe.
- Actual Hermes home: C:/Users/hrdyk/AppData/Local/hermes (not ~/.hermes on this installation).
- Config: C:/Users/hrdyk/AppData/Local/hermes/config.yaml, mcp_servers.schoolwork, enabled=true, all 18 tools enabled; mcp_servers.teams_live enables eight browser tools.
- Node command: C:/Program Files/nodejs/node.exe.
- Arguments: --env-file-if-exists=C:/Users/hrdyk/Documents/PROJEKTY-MOJE/ssps-bak-a-teams/.env and C:/Users/hrdyk/Documents/PROJEKTY-MOJE/ssps-bak-a-teams/dist/index.js.
- Installed skill: C:/Users/hrdyk/AppData/Local/hermes/skills/class-schoolwork/SKILL.md, byte-for-byte verified against the repository skill.

The absolute paths work independently of the session's working folder. This setup applies to the default profile; named profiles, other computers and other Windows users need their own configuration/accounts. Custom tool filters can exclude schoolwork even though it is enabled globally.

## Start a new session

Start Hermes normally and send:

> /class-schoolwork Check my connected sources and help me plan this week's schoolwork. Read the original instructions and tell me if anything is unavailable.

Hermes discovers the MCP tools with names such as mcp__schoolwork__connection_status and mcp__schoolwork__list_bakalari_subjects. The portable skill uses their base names. You can also ask for schoolwork naturally; the skill is discoverable on demand. An already-running session may need a new session or /reload-mcp and /reload-skills.

For live Teams without our Graph app consent, complete `npm run login:teams-browser` and use the [live browser workflow](teams-live-browser.md). Microsoft sign-in/MFA has been completed on this computer. Live class navigation, an assignment detail and deadline, a teacher channel post with expanded replies, and an attached PDF downloaded/read through schoolwork MCP were verified through the installed Hermes runtime. The default profile reuses this private Chrome profile headlessly in new sessions.

For an optional offline fallback, export a capture using browser/teams-capture and import it from the repository:

```powershell
npm run import:teams -- "C:/path/to/teams-capture.json"
```

The capture tools read those imported partial snapshots. Microsoft API consent remains blocked; configuring Hermes does not grant it. At verification time there were no imported captures. Bakalari remains connected and available live.

## Verification and recovery

The initial schoolwork installation used real Hermes discovery: 17 tools, the installed skill and a live 19-subject Bakalari collection were verified. The live-browser addition subsequently used Hermes's native discovery/save functions: the Playwright MCP advertised 25 tools and all eight requested tools were present before the filtered connection was saved. The schoolwork server now adds the eighteenth tool, read_downloaded_teams_document. Tool discovery alone does not establish account access; the subsequent live checks below verified it separately. No paid model chat was run.

A fresh Hermes runtime then registered exactly 18 schoolwork tools and eight filtered browser tools, dispatched connection_status (Bakalari connected, Graph disconnected) and verified the installed skill matches the repository. The actual installed Chrome MCP passed a separate local fixture test for navigation, inline snapshots, persistent synthetic sign-in across new processes, resource download and document extraction. The full repository check passed all 16 tests; dependency audit reported zero vulnerabilities. The first school login attempt timed out; the second completed. A fresh Hermes browser connection then read 11 class teams and three visible upcoming assignment entries, opened an assignment detail, downloaded its PDF and extracted page 1 through the schoolwork MCP. It also read a teacher channel announcement and opened a reply thread. This was a sample traversal, not a full account/history sync. A further fresh headless Hermes process reused sign-in and verified school class content without opening a desktop window.

Before the config change, the entire original config was encrypted with Windows DPAPI to C:/Users/hrdyk/AppData/Local/hermes/config.schoolwork-before-20261002.dpapi. Decryption was verified byte-for-byte. The backup is local and readable only through DPAPI by this Windows user. Do not upload config, its backup, school tokens or capture files.

Before adding live Teams, the existing config was also encrypted and byte-for-byte verified at config.teams-live-before-20261002.dpapi in the same Hermes home. Disable just the browser connection with hermes mcp remove teams_live if needed.

For a narrow rollback, use hermes mcp remove schoolwork and remove only the installed class-schoolwork skill you no longer want. Avoid restoring the entire old config after unrelated settings change. Repository recovery point: cea3d97, before this setup documentation. The project remains a local stdio service; no remote endpoint, Git remote, PR or remote CI exists.

After updating MCP source, run npm run check and start a new Hermes session. After changing the portable skill, update the installed skill copy deliberately; it is not an automatic symlink.
