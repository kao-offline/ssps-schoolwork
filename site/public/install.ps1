& {
  $ErrorActionPreference = 'Stop'
  Write-Host 'SSPS MCP — one local setup, your own school accounts.'
  Write-Host 'Requirements: Node.js 22.13+, Git and Google Chrome.'
  foreach ($SspsCommand in @('node','git')) { if (!(Get-Command $SspsCommand -ErrorAction SilentlyContinue)) { throw "Install $SspsCommand first, then rerun this command." } }
  $SspsBase = [Environment]::GetFolderPath('LocalApplicationData')
  if (!$SspsBase) { throw 'Cannot locate your local application directory.' }
  $SspsTarget = Join-Path $SspsBase 'SSPSMCP/ssps-schoolwork'
  $SspsRepo = 'https://github.com/kao-offline/ssps-schoolwork.git'
  if (Test-Path -LiteralPath $SspsTarget) {
    if (!(Test-Path -LiteralPath (Join-Path $SspsTarget '.git'))) { throw 'Installation folder already exists and is not this Git repository. Nothing was overwritten.' }
    $SspsRemote = git -C $SspsTarget remote get-url origin
    if ($LASTEXITCODE -ne 0 -or $SspsRemote -ne $SspsRepo) { throw 'Existing folder belongs to another repository. Nothing was overwritten.' }
    $SspsDirty = git -C $SspsTarget status --porcelain
    if ($LASTEXITCODE -ne 0 -or $SspsDirty) { throw 'Existing source has local changes. Commit them or install from your existing folder.' }
    git -C $SspsTarget pull --quiet --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'Update failed. Existing accounts and files were preserved.' }
  } else {
    $null = New-Item -ItemType Directory -Path (Split-Path $SspsTarget) -Force
    git clone $SspsRepo $SspsTarget
    if ($LASTEXITCODE -ne 0) { throw 'Download failed. Check your connection and retry.' }
  }
  Write-Host 'Passwords stay in the sign-in flow. Cached content stays on your computer.'
  Push-Location -LiteralPath $SspsTarget
  try { node scripts/setup.mjs; if ($LASTEXITCODE -ne 0) { throw "Setup needs attention. Run node scripts/setup.mjs from $SspsTarget to continue." } }
  finally { Pop-Location }
}
