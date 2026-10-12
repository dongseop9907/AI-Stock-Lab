$ErrorActionPreference = "Stop"
$root = "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{ Source="historical-universe-provider-v9-3a.ts"; Target="lib\market\historical-universe-provider-v9-3a.ts" },
    @{ Source="ingest-historical-universe-snapshot-v9-3a.ts"; Target="lib\market\ingest-historical-universe-snapshot-v9-3a.ts" },
    @{ Source="historical-universe-v9-3a-import-route.ts"; Target="app\api\market\universe\v9\historical\import\route.ts" },
    @{ Source="historical-universe-v9-3a-status-route.ts"; Target="app\api\market\universe\v9\historical\status\route.ts" }
)

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

foreach ($item in $copies) {
    $source = Join-Path $root $item.Source
    $target = Join-Path $root $item.Target
    if (-not (Test-Path $source)) { throw "SOURCE_NOT_FOUND: $source" }

    $dir = Split-Path $target -Parent
    New-Item -ItemType Directory -Path $dir -Force | Out-Null

    if (Test-Path $target) {
        Copy-Item $target "$target.backup-v9-3a-$timestamp" -Force
    }

    Copy-Item $source $target -Force
    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v9.3A Historical PIT Ingestion Foundation installed."
Write-Host "Run migration 049 in Supabase first."
Write-Host "No KRX API key is required."
Write-Host "Canonical PIT memberships are NOT modified."
Write-Host "Next: npx.cmd tsc --noEmit"
