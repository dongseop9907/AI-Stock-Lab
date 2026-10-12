$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{
        Source =
            "build-purged-walk-forward-plan-v9-2-1.ts"
        Target =
            "lib\research\build-purged-walk-forward-plan-v9-2-1.ts"
    },
    @{
        Source =
            "alpha-v9-2-1-historical-plan-route.ts"
        Target =
            "app\api\research\validation\v9\purged-walk-forward\historical-plan\route.ts"
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
            "$target.backup-v9-2-1-$timestamp" `
            -Force
    }

    Copy-Item `
        $source `
        $target `
        -Force

    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v9.2.1 Historical PIT binding installed."
Write-Host "Old v9.2 endpoint remains untouched."
Write-Host "IMPORTANT: Run migration 059 first."
Write-Host "Next: npx.cmd tsc --noEmit"
