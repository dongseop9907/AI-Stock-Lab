$ErrorActionPreference = "Stop"

$root = "C:\Users\user\Desktop\ai-stock-lab"

$source = Join-Path $root "validate-historical-pit-intervals-v9-3b-1.ts"
$target = Join-Path $root "lib\market\validate-historical-pit-intervals-v9-3b.ts"

if (-not (Test-Path $source)) {
    throw "SOURCE_NOT_FOUND: $source"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

if (Test-Path $target) {
    Copy-Item $target "$target.backup-v9-3b-1-$timestamp" -Force
}

Copy-Item $source $target -Force

Write-Host "PATCHED: lib\market\validate-historical-pit-intervals-v9-3b.ts"
Write-Host ""
Write-Host "v9.3B.1 validation-harness hotfix installed."
Write-Host "No database migration is required."
Write-Host "Next: npx.cmd tsc --noEmit"
