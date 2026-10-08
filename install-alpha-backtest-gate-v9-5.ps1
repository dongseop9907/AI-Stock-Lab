$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{
        Source =
            "evaluate-alpha-backtest-research-gate-v9-5.ts"
        Target =
            "lib\research\evaluate-alpha-backtest-research-gate-v9-5.ts"
    },
    @{
        Source =
            "alpha-v9-5-research-gate-route.ts"
        Target =
            "app\api\research\alpha\v9\backtest-gate\evaluate\route.ts"
    },
    @{
        Source =
            "alpha-v9-5-research-gate-status-route.ts"
        Target =
            "app\api\research\alpha\v9\backtest-gate\status\route.ts"
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
            "$target.backup-v9-5-$timestamp" `
            -Force
    }

    Copy-Item `
        $source `
        $target `
        -Force

    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v9.5 Historical Alpha Backtest Research Gate installed."
Write-Host "IMPORTANT: Run migration 052 in Supabase first."
Write-Host "This does NOT run a backtest."
Write-Host "Missing evidence fails closed."
Write-Host "Next: npx.cmd tsc --noEmit"
