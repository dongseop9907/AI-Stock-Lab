$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{
        Source =
            "screen-point-in-time-universe-v8-2.ts"
        Target =
            "lib\market\screen-point-in-time-universe-v8-2.ts"
    },
    @{
        Source =
            "market-universe-v8-2-screen-route.ts"
        Target =
            "app\api\market\universe\v8\screen\route.ts"
    },
    @{
        Source =
            "market-universe-v8-2-screen-status-route.ts"
        Target =
            "app\api\market\universe\v8\screen-status\route.ts"
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
            "$target.backup-v8-2-$timestamp" `
            -Force
    }

    Copy-Item `
        $source `
        $target `
        -Force

    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v8.2 Universe Eligibility + Liquidity/Data-Coverage Screen installed."
Write-Host "IMPORTANT: Run migration 042 in Supabase first."
Write-Host "This stage is observational only; no trading/risk behavior changed."
Write-Host "Next: npx.cmd tsc --noEmit"
