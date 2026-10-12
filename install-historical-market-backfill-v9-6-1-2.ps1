$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{
        Source =
            "historical-market-backfill-v9-6-1-2.ts"
        Target =
            "lib\research\historical-market-backfill-v9-6-1-2.ts"
    },
    @{
        Source =
            "historical-market-backfill-reconcile-route-v9-6-1.ts"
        Target =
            "app\api\research\data\v9\historical-market-backfill\reconcile-master\route.ts"
    },
    @{
        Source =
            "historical-market-backfill-create-route-v9-6-2.ts"
        Target =
            "app\api\research\data\v9\historical-market-backfill\create\route.ts"
    }
)

$timestamp =
    Get-Date `
        -Format "yyyyMMdd-HHmmss"

foreach ($item in $copies) {
    $source =
        Join-Path $root $item.Source

    $target =
        Join-Path $root $item.Target

    if (-not (Test-Path $source)) {
        throw "SOURCE_NOT_FOUND: $source"
    }

    $targetDirectory =
        Split-Path $target -Parent

    New-Item `
        -ItemType Directory `
        -Path $targetDirectory `
        -Force |
        Out-Null

    if (Test-Path $target) {
        Copy-Item `
            $target `
            "$target.backup-v9-6-1-2-$timestamp" `
            -Force
    }

    Copy-Item `
        $source `
        $target `
        -Force

    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v9.6.1 / v9.6.2 historical market-data package installed."
Write-Host "Existing v8.3 worker is intentionally reused and not replaced."
Write-Host "IMPORTANT: Run migration 060 first."
Write-Host "Next: npx.cmd tsc --noEmit"
