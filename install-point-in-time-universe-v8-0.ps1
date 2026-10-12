$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{
        Source =
            "bootstrap-legacy-universe-v8.ts"
        Target =
            "lib\market\bootstrap-legacy-universe-v8.ts"
    },
    @{
        Source =
            "get-point-in-time-universe-v8.ts"
        Target =
            "lib\market\get-point-in-time-universe-v8.ts"
    },
    @{
        Source =
            "market-universe-v8-bootstrap-current-route.ts"
        Target =
            "app\api\market\universe\v8\bootstrap-current\route.ts"
    },
    @{
        Source =
            "market-universe-v8-current-route.ts"
        Target =
            "app\api\market\universe\v8\current\route.ts"
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
            "$target.backup-v8-0-$timestamp" `
            -Force
    }

    Copy-Item `
        $source `
        $target `
        -Force

    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v8.0 Point-in-Time Universe Foundation files installed."
Write-Host "IMPORTANT: Run migration 040 in Supabase before calling the APIs."
Write-Host "Existing stocks.is_active consumers are intentionally unchanged."
Write-Host "Next: npx.cmd tsc --noEmit"
