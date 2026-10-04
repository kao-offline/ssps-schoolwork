# One-command student setup

Install Git, Node.js 22.13+ (including npm) and Google Chrome. This is a local integration: each student signs into their own Bakalari, Microsoft Teams and Discord accounts, and their agent uses their own AI provider. No classmate's credentials or caches are in GitHub.

From a terminal in the cloned repository, run:

```powershell
node scripts/setup.mjs
```

This installs locked dependencies, builds the server, preserves or creates `.env`, checks the existing Bakalari account or prompts for username and a hidden password, opens the dedicated Teams and Discord sign-in windows in sequence, starts the shared headless watchers, merges MCP entries into detected apps and installs both skills where supported. Sign-in/MFA happens directly in Chrome. The visible window closes after the app is detected. On Windows the installer also creates the hidden per-user Startup launcher; no administrator permission is needed. Other operating systems start the current workers and can restart them automatically through the live-browser proxies; login-time service installation is currently Windows-only.

Before reporting Ready, a small cache loader shows progress/counts and waits for fresh Teams assignment/class/Activity checks and Discord navigation/notification checks plus one discovered conversation. It does not display message contents. Initial views must actually be cached, even when older records already exist. Remaining channels continue warming afterward; this is not a complete archive. The default warm-up timeout is three minutes; use `--cache-timeout=300` for a slower connection. A timeout or expired sign-in reports incomplete setup, preserves completed steps and tells you to rerun. `--agents-only` deliberately skips account/cache work.

Privacy: data is stored locally, not on a class server or in GitHub. Windows uses DPAPI for persisted credentials/cache; Chrome maintains its own private sign-in profile. Other platforms use private file permissions. Requests still contact the original school/Microsoft/Discord services. An agent may send retrieved context to its chosen AI provider, according to that app's settings. The integration does not control the provider's retention policies.

Teams uses ordinary browser access only; there is no Microsoft Graph integration and nothing needs admin consent. The default school URL is `https://bakalari.ssps.cz`; change `BAKALARI_URL` in `.env` for another school before login.

Discord's default scope is all accessible servers and exposed DMs. The reader only caches observed message windows, not full history or attachment binaries. Each student's installation and private profile are independent. Omit Discord with `--sources=teams,bakalari` if it is not wanted.

## Options

```powershell
node scripts/setup.mjs --detect
node scripts/setup.mjs --apps=hermes,codex,claude,grok
node scripts/setup.mjs --sources=teams,bakalari
node scripts/setup.mjs --no-login
node scripts/setup.mjs --agents-only
node scripts/setup.mjs --no-startup
```

`--detect` lists supported app IDs and configuration paths without changing agent configurations or accounts (it can install dependencies/build if missing). `--apps` explicitly selects supported clients; otherwise all detected clients are configured. `--no-login` reuses existing profiles/accounts and does not establish new authentication. `--agents-only` only writes agent/import configurations and skills, without changing accounts or starting services. `--no-startup` omits the Windows login launcher. Reruns preserve existing accounts and are idempotent for unchanged configurations. Restart the agent or reload its MCP servers and skills afterward.

## Client adapters

| Client | User configuration | Skills |
| --- | --- | --- |
| Codex | `~/.codex/config.toml`, respecting `CODEX_HOME` | its `skills/` |
| Grok CLI | `~/.grok/config.toml`, respecting `GROK_HOME` | its `skills/` |
| Claude Code | `~/.claude.json` | `~/.claude/skills/` |
| Hermes | `HERMES_HOME/config.yaml`; existing Windows local Hermes home or `~/.hermes` | its `skills/` |
| Gemini CLI | `~/.gemini/settings.json` | `~/.gemini/skills/` |
| OpenCode | `$XDG_CONFIG_HOME/opencode/opencode.json(c)` | its `skills/` |
| Cursor | `~/.cursor/mcp.json` | `~/.cursor/skills/` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | its `skills/` |
| VS Code Copilot | default user-profile `mcp.json` | manual skill instructions |
| Copilot CLI | `COPILOT_HOME/mcp-config.json` or `~/.copilot/mcp-config.json` | manual skill instructions |
| Claude Desktop | platform Claude app-data `claude_desktop_config.json` | manual skill instructions |
| LM Studio | `~/.lmstudio/mcp.json` | manual skill instructions |
| Zed | platform Zed `settings.json`, `context_servers` | manual skill instructions |
| Cline / Roo / Kilo extension | default VS Code user-profile extension MCP settings | manual skill instructions |

Detection uses known configuration files/directories and CLI executables on PATH. Windsurf requires an executable; VS Code extension adapters require an installed extension registration and package. Old settings folders alone do not qualify for these adapters. Use `node scripts/setup.mjs --detect --exclude=windsurf,kilo` to persistently skip unwanted apps. This saves IDs in the private data directory's `setup-preferences.json`; edit `excludedApps` there to re-enable an app. Exclusion prevents future automatic setup; it does not remove existing entries. Explicit `--apps=` selection can override it.

Custom editor profiles, portable installations, policy-managed clients and unknown formats may need manual import. Muse/Dot and hosted apps do not have a verified adapter here: use the generated ignored `mcp.local.json` in an app supporting local stdio MCP. The installer never invents an undocumented configuration or claims universal app detection. Named servers are `schoolwork`, `teams_live` and `discord_live`. Proxies expose eight browser tools each; schoolwork exposes 21 tools. Clients may still require their ordinary trust/enable prompts.

Adapters follow the clients' published MCP formats: [Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Claude Code](https://code.claude.com/docs/en/mcp), [Gemini](https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html), [OpenCode](https://opencode.ai/docs/mcp-servers/), [Cursor](https://cursor.com/docs/mcp), [VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers), [LM Studio](https://lmstudio.ai/docs/app/mcp), [Zed](https://zed.dev/docs/ai/mcp). Grok's installed official README verifies its TOML MCP and user skill paths. Windsurf's legacy path is supported; the newer Devin client has a different path and currently requires manual import.

## Backups and recovery

Before changing an existing configuration or skill, setup saves a verified backup in the private schoolwork data directory. Windows backups use DPAPI; other platforms use mode-600 private files. No backup contents are logged. JSONC and YAML retain unrelated settings/comments; TOML edits replace only this project's own MCP table blocks. Invalid configurations or names belonging to unrelated servers are refused. Individual failures are reported, and the command exits unsuccessfully until resolved.

`setup-report.local.json` lists changed configurations and their protected backup names. It is ignored by Git. To restore one complete file immediately after setup:

```powershell
node --env-file-if-exists=.env dist/setup-restore.js setup-backup-EXACT-NAME-FROM-REPORT
```

Restoration replaces the whole backed-up file, so do not use an old snapshot after making unrelated settings changes. The restoration tool first backs up the current file and verifies read-back. To remove this integration selectively later, remove only its three server entries and two skills using the app's settings. Remove hidden startup with `powershell -NoProfile -File scripts/install-context-background.ps1 -RemoveStartup`, then pause workers using the [cache control commands](background-context-cache.md).

Source checkpoint before this setup feature: `59ff8d6`. Model-provider settings and credential values are preserved. School accounts, browser profiles, generated machine-specific configuration and backups stay local; the public repository contains source, templates, tests and docs.

## Verified installation

The Windows installation detected and configured 12 apps with no configuration failures. Codex accepted its TOML entry, Claude Code reported the schoolwork MCP connected, and Grok's native doctor completed a handshake and discovered all 24 tools. A real installer run reusing this student's existing sign-ins waited for fresh initial cache views: Teams completed in 24 seconds and Discord in 36 seconds. Broader Discord prefetch remained in progress afterward. These are sample timings, not guaranteed performance or complete history coverage.

Local validation passed all 32 tests, lint, typecheck/build, Chrome fixture checks and production dependency audit. CI runs Windows/Linux checks; Chrome fixture checks run on Windows. No live account credentials are needed in CI. Dependency reruns reuse the installed locked versions; when an update is needed, the installer's own readers are paused/saved, and an existing dependency tree is updated without clearing files loaded by other agent sessions.

## Interactive setup

In a terminal, setup offers numbered account-source and detected-app selections. Press Enter to keep defaults, or enter comma-separated numbers/IDs. Explicit `--sources` and `--apps` skip their respective questions; `--yes` skips both. Non-interactive runs keep the existing flag-based behavior. `--demo` previews progress without installing or changing accounts. The dashboard adapts to terminal size, hands sign-in the normal terminal, and preserves failure details after it closes. Ctrl+C exits with code 130; rerun to resume completed work.
