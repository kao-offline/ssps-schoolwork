param([switch]$RemoveStartup, [switch]$SkipTeams, [switch]$SkipDiscord)
$ErrorActionPreference = 'Stop'
$ContextRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$ContextNode = (Get-Command node -ErrorAction Stop).Source
$ContextStartup = [Environment]::GetFolderPath('Startup')
$ContextAppData = [Environment]::GetFolderPath('ApplicationData')
if (!$ContextStartup -or !$ContextStartup.StartsWith($ContextAppData, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected per-user Startup directory.' }
$ContextLauncher = Join-Path $ContextStartup 'SSPSContextCache.vbs'
if ($RemoveStartup) {
  if (Test-Path -LiteralPath $ContextLauncher) {
    if (!(Get-Content -LiteralPath $ContextLauncher -Raw).StartsWith("' SSPS local context watchers")) { throw 'Existing startup file is not owned by this installer.' }
    Remove-Item -LiteralPath $ContextLauncher
  }
  Write-Output 'Removed the context cache startup launcher. Existing workers can be paused with the cache CLI.'
  exit
}
$ContextWorker = Join-Path $ContextRoot 'dist/teams-cache-worker.js'
$ContextControl = Join-Path $ContextRoot 'dist/teams-cache-control.js'
if (!(Test-Path -LiteralPath $ContextWorker) -or !(Test-Path -LiteralPath $ContextControl)) { throw 'Run npm run build first.' }
if ((Test-Path -LiteralPath $ContextLauncher) -and !(Get-Content -LiteralPath $ContextLauncher -Raw).StartsWith("' SSPS local context watchers")) { throw 'Existing startup file is not owned by this installer.' }
$ContextBaseCommand = '"' + $ContextNode + '" "--env-file-if-exists=' + (Join-Path $ContextRoot '.env') + '" "' + $ContextWorker + '"'
$ContextScript = "' SSPS local context watchers`r`nSet shell = CreateObject(""WScript.Shell"")`r`n"
$ContextSources = @()
if (!$SkipTeams) { $ContextSources += 'teams' }
if (!$SkipDiscord) { $ContextSources += 'discord' }
foreach ($ContextSource in $ContextSources) {
  $ContextCommand = $ContextBaseCommand + ' --source=' + $ContextSource
  $ContextScript += 'shell.Run "' + $ContextCommand.Replace('"', '""') + '", 0, False' + "`r`n"
  & $ContextNode "--env-file-if-exists=$(Join-Path $ContextRoot '.env')" $ContextControl setup "--source=$ContextSource"
  if ($LASTEXITCODE -ne 0) { throw 'Protected worker setup failed.' }
  $ContextProbe = [Diagnostics.ProcessStartInfo]::new()
  $ContextProbe.FileName = $ContextNode
  $ContextProbe.Arguments = '"--env-file-if-exists=' + (Join-Path $ContextRoot '.env') + '" "' + $ContextControl + '" status --source=' + $ContextSource
  $ContextProbe.UseShellExecute = $false
  $ContextProbe.CreateNoWindow = $true
  $ContextProbe.RedirectStandardOutput = $true
  $ContextProbe.RedirectStandardError = $true
  $ContextProbeProcess = [Diagnostics.Process]::Start($ContextProbe)
  $null = $ContextProbeProcess.StandardOutput.ReadToEnd()
  $null = $ContextProbeProcess.StandardError.ReadToEnd()
  $ContextProbeProcess.WaitForExit()
  if ($ContextProbeProcess.ExitCode -ne 0) {
    Start-Process -FilePath $ContextNode -ArgumentList @('"--env-file-if-exists=' + (Join-Path $ContextRoot '.env') + '"', '"' + $ContextWorker + '"', '--source=' + $ContextSource) -WindowStyle Hidden
  }
}
[IO.File]::WriteAllText($ContextLauncher, $ContextScript, [Text.Encoding]::Unicode)
if ([IO.File]::ReadAllText($ContextLauncher) -ne $ContextScript) { throw 'Startup launcher verification failed.' }
Write-Output "Installed and verified per-user hidden startup launcher: $ContextLauncher"
