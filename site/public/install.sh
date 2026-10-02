#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' 'SSPS MCP — your school accounts, on your computer.' 'Requirements: Node.js 22.13+, Git and Google Chrome.'
command -v node >/dev/null || { printf '%s\n' 'Install Node.js first, then rerun.'; exit 1; }
command -v git >/dev/null || { printf '%s\n' 'Install Git first, then rerun.'; exit 1; }
ssps_target="${XDG_DATA_HOME:-$HOME/.local/share}/sspsmcp/ssps-schoolwork"
ssps_repo='https://github.com/kao-offline/ssps-schoolwork.git'
if [ -e "$ssps_target" ]; then
  [ -d "$ssps_target/.git" ] || { printf '%s\n' 'Existing folder is not this repository. Nothing was overwritten.'; exit 1; }
  [ "$(git -C "$ssps_target" remote get-url origin)" = "$ssps_repo" ] || { printf '%s\n' 'Existing folder belongs to another repository.'; exit 1; }
  [ -z "$(git -C "$ssps_target" status --porcelain)" ] || { printf '%s\n' 'Local source changes exist. Run setup in the existing folder.'; exit 1; }
  git -C "$ssps_target" pull --ff-only origin main
else
  mkdir -p "$(dirname "$ssps_target")"
  git clone "$ssps_repo" "$ssps_target"
fi
printf '%s\n' 'Sign-in is local. Initial cache progress follows before setup finishes.'
cd "$ssps_target"
# The downloaded wrapper may be piped; read sign-in prompts from the terminal.
exec node scripts/setup.mjs </dev/tty
