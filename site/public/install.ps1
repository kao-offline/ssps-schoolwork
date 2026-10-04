& {
  $ErrorActionPreference = 'Stop'
  foreach ($SspsCommand in @('node','git')) { if (!(Get-Command $SspsCommand -ErrorAction SilentlyContinue)) { throw "Install $SspsCommand first, then rerun this command." } }
  $SspsBase = [Environment]::GetFolderPath('LocalApplicationData')
  if (!$SspsBase) { throw 'Cannot locate your local application directory.' }
  $SspsTarget = Join-Path $SspsBase 'SSPSMCP/ssps-schoolwork'
  $SspsRepo = 'https://github.com/kao-offline/ssps-schoolwork.git'
  $SspsRevision = 'main'
  if (Test-Path -LiteralPath $SspsTarget) {
    if (!(Test-Path -LiteralPath (Join-Path $SspsTarget '.git'))) { throw 'Installation folder already exists and is not this Git repository. Nothing was overwritten.' }
    $SspsRemote = git -C $SspsTarget remote get-url origin
    if ($LASTEXITCODE -ne 0 -or $SspsRemote -ne $SspsRepo) { throw 'Existing folder belongs to another repository. Nothing was overwritten.' }
    $SspsDirty = git -C $SspsTarget status --porcelain
    if ($LASTEXITCODE -ne 0 -or $SspsDirty) { throw 'Existing source has local changes. Commit them or install from your existing folder.' }
    if ($SspsRevision -eq 'main') { git -C $SspsTarget pull --quiet --ff-only origin main }
    else {
      git -C $SspsTarget fetch --quiet origin $SspsRevision
      if ($LASTEXITCODE -ne 0) { throw 'Release download failed. Existing files were preserved.' }
      git -C $SspsTarget checkout --quiet --detach $SspsRevision
    }
    if ($LASTEXITCODE -ne 0) { throw 'Update failed. Existing accounts and files were preserved.' }
  } else {
    $null = New-Item -ItemType Directory -Path (Split-Path $SspsTarget) -Force
    git clone --quiet $SspsRepo $SspsTarget
    if ($LASTEXITCODE -ne 0) { throw 'Download failed. Check your connection and retry.' }
    if ($SspsRevision -ne 'main') {
      git -C $SspsTarget fetch --quiet origin $SspsRevision
      if ($LASTEXITCODE -ne 0) { throw 'Release download failed. Rerun to continue.' }
      git -C $SspsTarget checkout --quiet --detach $SspsRevision
      if ($LASTEXITCODE -ne 0) { throw 'Release checkout failed. Rerun to continue.' }
    }
  }
  Push-Location -LiteralPath $SspsTarget
  try { node scripts/setup.mjs --tui; if ($LASTEXITCODE -ne 0) { throw "Setup needs attention. Run node scripts/setup.mjs --tui from $SspsTarget to continue." } }
  finally { Pop-Location }
}
