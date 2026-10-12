$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{
        Source =
            "evaluate-historical-market-data-coverage-v9-6.ts"
        Target =
            "lib\research\evaluate-historical-market-data-coverage-v9-6.ts"
    },
    @{
        Source =
            "validate-historical-market-data-coverage-v9-6.ts"
        Target =
            "lib\research\validate-historical-market-data-coverage-v9-6.ts"
    },
    @{
        Source =
            "historical-market-data-v9-6-evaluate-route.ts"
        Target =
            "app\api\research\data\v9\historical-market-coverage\evaluate\route.ts"
    },
    @{
        Source =
            "historical-market-data-v9-6-validate-route.ts"
        Target =
            "app\api\research\data\v9\historical-market-coverage\validate\route.ts"
    },
    @{
        Source =
            "historical-market-data-v9-6-status-route.ts"
        Target =
            "app\api\research\data\v9\historical-market-coverage\status\route.ts"
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
            "$target.backup-v9-6-$timestamp" `
            -Force
    }

    Copy-Item `
        $source `
        $target `
        -Force

    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v9.6 Historical Market Data Coverage Evaluator installed."
Write-Host "IMPORTANT: Run migration 053 in Supabase first."
Write-Host "No KRX API key is required."
Write-Host "Missing historical PIT fails closed."
Write-Host "Next: npx.cmd tsc --noEmit"
