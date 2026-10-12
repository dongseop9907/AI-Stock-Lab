param(
  [string]$ProjectPath = ""
)

$ErrorActionPreference = "Stop"

if (
  [string]::IsNullOrWhiteSpace(
    $ProjectPath
  )
) {
  $ProjectPath = (
    Resolve-Path (
      Join-Path $PSScriptRoot ".."
    )
  ).Path
}

$logDirectory =
  Join-Path $ProjectPath "logs"

if (
  -not (
    Test-Path $logDirectory
  )
) {
  New-Item `
    -ItemType Directory `
    -Force `
    -Path $logDirectory |
    Out-Null
}

$logPath =
  Join-Path `
    $logDirectory `
    "server.log"

function Write-ServerLog {
  param(
    [string]$Message
  )

  $line =
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"

  Write-Host $line

  $line |
    Out-File `
      -FilePath $logPath `
      -Append `
      -Encoding utf8
}

Set-Location $ProjectPath

Write-ServerLog `
  "Preparing server startup"

$existingServer =
  Get-NetTCPConnection `
    -LocalPort 3000 `
    -State Listen `
    -ErrorAction SilentlyContinue

if ($existingServer) {
  Write-ServerLog `
    "Server is already listening on port 3000"

  exit 0
}

$nextPath =
  Join-Path $ProjectPath ".next"

if (
  -not (
    Test-Path $nextPath
  )
) {
  Write-ServerLog `
    "Build directory not found. Running npm run build"

  & npm.cmd run build `
    >> $logPath `
    2>&1

  if ($LASTEXITCODE -ne 0) {
    throw "Next.js build failed"
  }
}

Write-ServerLog `
  "Starting npm start"

& npm.cmd start `
  >> $logPath `
  2>&1

if ($LASTEXITCODE -ne 0) {
  throw (
    "npm start exited with code " +
    $LASTEXITCODE
  )
}