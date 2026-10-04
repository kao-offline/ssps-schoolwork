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
