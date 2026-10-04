# Installer and bulk schoolwork reads

- Repository: kao-offline/ssps-schoolwork
- Workspace: C:/Users/hrdyk/Documents/PROJEKTY-MOJE/ssps-bak-a-teams
- Branch: feat/installer-bulk-context
- Clean starting checkpoint: 7aed3777
- Scope: interactive setup, terminal lifecycle, bulk MCP reads, installed skill guidance, Windows download alias regression.
- Environment: local compiled server; isolated fixture data/ports. No school account data/configuration changed by validation.
- Recovery: revert the feature commit; rerun setup to rebuild and restart owned readers. Setup preserves protected accounts/caches and agent configuration backups.
- Validation: npm run check (37 tests), npm audit --omit=dev (zero vulnerabilities), npm run test:teams-browser (isolated Chrome fixture), site build and Wrangler deployment dry-run, syntax checks for installer scripts. Demo exercised with simulated TTY output; terminal layout/lifecycle also tested with injected output.
- Distribution: public bootstrap reads origin/main. Branch/PR must merge before public installs receive this change. No unrelated static-site deployment needed.
- Activation: rerun setup for updated skills and worker code, then start a new MCP agent session. --yes skips selection prompts; --agents-only --yes only refreshes agent configs/skills.

## Mouse terminal revision

- Checkpoint before this revision: d1a0c207
- Replaced numbered prompts in the color TTY flow with clickable source/app checklists, Continue/All/None buttons, keyboard navigation and scrollable long lists.
- Added a responsive dark terminal canvas, status colors, system checks, independent output panel, clickable step details and log scrolling.
- Preflight checks Node/npm/Git/Chrome plus Windows VT input capability and installed direct dependency versions. Chrome is enforced after selecting browser sources.
- Windows mouse support uses native VT raw input (Node 22.18+ / 24.6+); older supported runtimes get an upgrade notice and keyboard navigation.
- Validation: full npm run check, dependency audit, real Chrome fixture, site build/dry-run, syntax checks; isolated real installer run writes only a temporary Grok profile and verifies the installed configuration/skill.
- Native Windows ConPTY demo exercised: SGR row click toggled Teams off, SGR Continue advanced to app selection, arrow/Space/Enter navigation advanced to progress. Fixed a completion hang caused by initially non-flowing stdin remaining resumed.
- Optional browser layout screenshot could not be captured: T3 preview snapshot repeatedly returned PreviewAutomationExecutionError. Preview fixture was stopped; native terminal output/input were inspected instead.
- Distribution still awaits PR #1 merge. No public site changes or school account/configuration writes were needed.
- Added --tui override for terminal environments that set NO_COLOR/TERM=dumb; verified the forced demo starts in the real Windows ConPTY without environment overrides.
- Repaint only changed frames to avoid idle selector redraws. Restore initially non-flowing stdin to paused mode so completion exits successfully.
- Final local suite: 46 tests plus lint/typecheck/build passed; native Windows forced TUI demo completed with exit 0 after mouse and keyboard selection. Production audit and real Chrome fixture passed; static site build/dry-run passed.
