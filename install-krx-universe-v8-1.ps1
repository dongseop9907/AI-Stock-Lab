$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{
        Source =
            "sync-krx-point-in-time-universe-v8-1.ts"
        Target =
            "lib\market\sync-krx-point-in-time-universe-v8-1.ts"
    },
    @{
        Source =
            "market-universe-v8-1-sync-route.ts"
        Target =
            "app\api\market\universe\v8\sync\route.ts"
    },
    @{
        Source =
            "market-universe-v8-1-status-route.ts"
        Target =
            "app\api\market\universe\v8\status\route.ts"
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
            "$target.backup-v8-1-$timestamp" `
            -Force
    }

    Copy-Item `
        $source `
        $target `
        -Force

    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v8.1 KRX/KIS Point-in-Time Universe Collector installed."
Write-Host "IMPORTANT: Run migration 041 in Supabase first."
Write-Host "No trading/risk/automation behavior was changed."
Write-Host "Next: npx.cmd tsc --noEmit"
