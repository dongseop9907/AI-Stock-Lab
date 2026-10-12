$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{
        Source =
            "evaluate-corporate-action-dataset-coverage-v9-7.ts"
        Target =
            "lib\research\evaluate-corporate-action-dataset-coverage-v9-7.ts"
    },
    @{
        Source =
            "validate-corporate-action-dataset-coverage-v9-7.ts"
        Target =
            "lib\research\validate-corporate-action-dataset-coverage-v9-7.ts"
    },
    @{
        Source =
            "corporate-action-dataset-v9-7-evaluate-route.ts"
        Target =
            "app\api\research\data\v9\corporate-action-coverage\evaluate\route.ts"
    },
    @{
        Source =
            "corporate-action-dataset-v9-7-validate-route.ts"
        Target =
            "app\api\research\data\v9\corporate-action-coverage\validate\route.ts"
    },
    @{
        Source =
            "corporate-action-dataset-v9-7-status-route.ts"
        Target =
            "app\api\research\data\v9\corporate-action-coverage\status\route.ts"
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
            "$target.backup-v9-7-$timestamp" `
            -Force
    }

    Copy-Item `
        $source `
        $target `
        -Force

    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v9.7 Corporate Action Dataset Coverage Evaluator installed."
Write-Host "IMPORTANT: Run migration 054 in Supabase first."
Write-Host "No KRX API key is required for the foundation/validator."
Write-Host "Missing PIT or source-coverage evidence fails closed."
Write-Host "Next: npx.cmd tsc --noEmit"
