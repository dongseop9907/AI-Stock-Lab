$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{ Source="krx-historical-universe-provider-v9-3c.ts"; Target="lib\market\krx-historical-universe-provider-v9-3c.ts" },
    @{ Source="ingest-krx-historical-pit-date-v9-3c.ts"; Target="lib\market\ingest-krx-historical-pit-date-v9-3c.ts" },
    @{ Source="create-krx-historical-pit-import-run-v9-3c.ts"; Target="lib\market\create-krx-historical-pit-import-run-v9-3c.ts" },
    @{ Source="process-krx-historical-pit-import-run-v9-3c.ts"; Target="lib\market\process-krx-historical-pit-import-run-v9-3c.ts" },
    @{ Source="validate-krx-historical-pit-provider-v9-3c.ts"; Target="lib\market\validate-krx-historical-pit-provider-v9-3c.ts" },
    @{ Source="krx-historical-pit-v9-3c-create-route.ts"; Target="app\api\market\universe\v9\historical\krx\create\route.ts" },
    @{ Source="krx-historical-pit-v9-3c-process-route.ts"; Target="app\api\market\universe\v9\historical\krx\process\route.ts" },
    @{ Source="krx-historical-pit-v9-3c-status-route.ts"; Target="app\api\market\universe\v9\historical\krx\status\route.ts" },
    @{ Source="krx-historical-pit-v9-3c-validate-route.ts"; Target="app\api\market\universe\v9\historical\krx\validate\route.ts" }
)

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

foreach ($item in $copies) {
    $source = Join-Path $root $item.Source
    $target = Join-Path $root $item.Target

    if (-not (Test-Path $source)) {
        throw "SOURCE_NOT_FOUND: $source"
    }

    $dir = Split-Path $target -Parent
    New-Item -ItemType Directory -Path $dir -Force | Out-Null

    if (Test-Path $target) {
        Copy-Item $target "$target.backup-v9-3c-$timestamp" -Force
    }

    Copy-Item $source $target -Force
    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v9.3C KRX Historical PIT Provider installed."
Write-Host "IMPORTANT: Run migration 056 in Supabase first."
Write-Host "KRX_OPEN_API_KEY remains only in .env.local."
Write-Host "Canonical PIT memberships are NOT modified."
Write-Host "Next: npx.cmd tsc --noEmit"
