# Hermes setup on this computer

Configured and verified on 2026-10-02 for the local Windows Hermes default profile. No AI-provider credentials or school tokens were copied into Hermes config. Each new session connects to the existing local MCP using the same Windows user and protected school-account store.

## Installed configuration

- Hermes executable: C:/Users/hrdyk/AppData/Local/hermes/hermes-agent/venv/Scripts/hermes.exe.
- Actual Hermes home: C:/Users/hrdyk/AppData/Local/hermes (not ~/.hermes on this installation).
- Config: C:/Users/hrdyk/AppData/Local/hermes/config.yaml, mcp_servers.schoolwork, enabled=true, all 17 tools enabled.
- Node command: C:/Program Files/nodejs/node.exe.
- Arguments: --env-file-if-exists=C:/Users/hrdyk/Documents/PROJEKTY-MOJE/ssps-bak-a-teams/.env and C:/Users/hrdyk/Documents/PROJEKTY-MOJE/ssps-bak-a-teams/dist/index.js.
- Installed skill: C:/Users/hrdyk/AppData/Local/hermes/skills/class-schoolwork/SKILL.md, byte-for-byte verified against the repository skill.

The absolute paths work independently of the session's working folder. This setup applies to the default profile; named profiles, other computers and other Windows users need their own configuration/accounts. Custom tool filters can exclude schoolwork even though it is enabled globally.

## Start a new session

Start Hermes normally and send:

> /class-schoolwork Check my connected sources and help me plan this week's schoolwork. Read the original instructions and tell me if anything is unavailable.

Hermes discovers the MCP tools with names such as mcp__schoolwork__connection_status and mcp__schoolwork__list_bakalari_subjects. The portable skill uses their base names. You can also ask for schoolwork naturally; the skill is discoverable on demand. An already-running session may need a new session or /reload-mcp and /reload-skills.

For Teams without Graph consent, first export a capture using browser/teams-capture and import it from the repository:

```powershell
npm run import:teams -- "C:/path/to/teams-capture.json"
```

The capture tools read those imported partial snapshots. Microsoft API consent remains blocked; configuring Hermes does not grant it. At verification time there were no imported captures. Bakalari remains connected and available live.

## Verification and recovery

hermes mcp add performed real discovery and saved the connection using Hermes's own CLI. hermes mcp test schoolwork connected and discovered 17 tools. A separate fresh Python process using the installed Hermes runtime discovered/registered all 17 namespaced tools, listed and loaded the skill, dispatched connection_status, retrieved the 19-subject Bakalari collection and searched the empty capture collection. Default CLI platform settings include schoolwork. This verifies discovery and tool execution without making a paid model request; an AI-generated end-to-end chat was not run.

Before the config change, the entire original config was encrypted with Windows DPAPI to C:/Users/hrdyk/AppData/Local/hermes/config.schoolwork-before-20261002.dpapi. Decryption was verified byte-for-byte. The backup is local and readable only through DPAPI by this Windows user. Do not upload config, its backup, school tokens or capture files.

For a narrow rollback, use hermes mcp remove schoolwork and remove only the installed class-schoolwork skill you no longer want. Avoid restoring the entire old config after unrelated settings change. Repository recovery point: cea3d97, before this setup documentation. The project remains a local stdio service; no remote endpoint, Git remote, PR or remote CI exists.

After updating MCP source, run npm run check and start a new Hermes session. After changing the portable skill, update the installed skill copy deliberately; it is not an automatic symlink.
