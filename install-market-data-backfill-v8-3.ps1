$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{
        Source =
            "create-market-data-backfill-v8-3.ts"
        Target =
            "lib\market\create-market-data-backfill-v8-3.ts"
    },
    @{
        Source =
            "process-market-data-backfill-v8-3.ts"
        Target =
            "lib\market\process-market-data-backfill-v8-3.ts"
    },
    @{
        Source =
            "market-data-v8-3-create-route.ts"
        Target =
            "app\api\market\data\v8\backfill\create\route.ts"
    },
    @{
        Source =
            "market-data-v8-3-process-route.ts"
        Target =
            "app\api\market\data\v8\backfill\process\route.ts"
    },
    @{
        Source =
            "market-data-v8-3-status-route.ts"
        Target =
            "app\api\market\data\v8\backfill\status\route.ts"
    }
)

$timestamp =
    Get-Date `
        -Format "yyyyMMdd-HHmmss"

foreach (
    $item
    in $copies
) {
    $source =
        Join-Path `
            $root `
            $item.Source

    $target =
        Join-Path `
            $root `
            $item.Target

    if (
        -not (
            Test-Path $source
        )
    ) {
        throw "SOURCE_NOT_FOUND: $source"
    }

    $targetDirectory =
        Split-Path `
            $target `
            -Parent

    New-Item `
        -ItemType Directory `
        -Path $targetDirectory `
        -Force |
        Out-Null

    if (
        Test-Path $target
    ) {
        Copy-Item `
            $target `
            "$target.backup-v8-3-$timestamp" `
            -Force
    }

    Copy-Item `
        $source `
        $target `
        -Force

    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v8.3 Scalable Market Data Backfill installed."
Write-Host "IMPORTANT: Run migration 044 in Supabase first."
Write-Host "Existing v7 automation and stocks.is_active behavior are unchanged."
Write-Host "Next: npx.cmd tsc --noEmit"
