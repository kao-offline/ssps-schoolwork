#!/usr/bin/env bash
set -euo pipefail
command -v node >/dev/null || { printf '%s\n' 'Install Node.js first, then rerun.'; exit 1; }
command -v git >/dev/null || { printf '%s\n' 'Install Git first, then rerun.'; exit 1; }
ssps_target="${XDG_DATA_HOME:-$HOME/.local/share}/sspsmcp/ssps-schoolwork"
ssps_repo='https://github.com/kao-offline/ssps-schoolwork.git'
ssps_revision='main'
if [ -e "$ssps_target" ]; then
  [ -d "$ssps_target/.git" ] || { printf '%s\n' 'Existing folder is not this repository. Nothing was overwritten.'; exit 1; }
  [ "$(git -C "$ssps_target" remote get-url origin)" = "$ssps_repo" ] || { printf '%s\n' 'Existing folder belongs to another repository.'; exit 1; }
  [ -z "$(git -C "$ssps_target" status --porcelain)" ] || { printf '%s\n' 'Local source changes exist. Run setup in the existing folder.'; exit 1; }
  if [ "$ssps_revision" = 'main' ]; then
    git -C "$ssps_target" pull --quiet --ff-only origin main
  else
    git -C "$ssps_target" fetch --quiet origin "$ssps_revision"
    git -C "$ssps_target" checkout --quiet --detach "$ssps_revision"
  fi
else
  mkdir -p "$(dirname "$ssps_target")"
  git clone --quiet "$ssps_repo" "$ssps_target"
  if [ "$ssps_revision" != 'main' ]; then
    git -C "$ssps_target" fetch --quiet origin "$ssps_revision"
    git -C "$ssps_target" checkout --quiet --detach "$ssps_revision"
  fi
fi
cd "$ssps_target"
# The downloaded wrapper may be piped; read sign-in prompts from the terminal.
exec node scripts/setup.mjs --tui </dev/tty
