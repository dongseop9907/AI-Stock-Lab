$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{
        Source =
            "corporate-action-provider-v9-4.ts"
        Target =
            "lib\market\corporate-action-provider-v9-4.ts"
    },
    @{
        Source =
            "ingest-corporate-action-v9-4.ts"
        Target =
            "lib\market\ingest-corporate-action-v9-4.ts"
    },
    @{
        Source =
            "build-corporate-action-adjustment-v9-4.ts"
        Target =
            "lib\market\build-corporate-action-adjustment-v9-4.ts"
    },
    @{
        Source =
            "validate-corporate-action-v9-4.ts"
        Target =
            "lib\market\validate-corporate-action-v9-4.ts"
    },
    @{
        Source =
            "corporate-action-v9-4-ingest-route.ts"
        Target =
            "app\api\market\corporate-actions\v9\ingest\route.ts"
    },
    @{
        Source =
            "corporate-action-v9-4-build-route.ts"
        Target =
            "app\api\market\corporate-actions\v9\build\route.ts"
    },
    @{
        Source =
            "corporate-action-v9-4-validate-route.ts"
        Target =
            "app\api\market\corporate-actions\v9\validate\route.ts"
    },
    @{
        Source =
            "corporate-action-v9-4-status-route.ts"
        Target =
            "app\api\market\corporate-actions\v9\status\route.ts"
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
            "$target.backup-v9-4-$timestamp" `
            -Force
    }

    Copy-Item `
        $source `
        $target `
        -Force

    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v9.4 Corporate Action Foundation installed."
Write-Host "IMPORTANT: Run migration 051 in Supabase first."
Write-Host "No KRX API key is required."
Write-Host "Raw market_daily_bars are NEVER overwritten."
Write-Host "Next: npx.cmd tsc --noEmit"
