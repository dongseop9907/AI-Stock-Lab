$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{
        Source =
            "build-purged-walk-forward-plan-v9-2.ts"
        Target =
            "lib\research\build-purged-walk-forward-plan-v9-2.ts"
    },
    @{
        Source =
            "alpha-v9-2-validation-plan-route.ts"
        Target =
            "app\api\research\validation\v9\purged-walk-forward\plan\route.ts"
    },
    @{
        Source =
            "alpha-v9-2-validation-status-route.ts"
        Target =
            "app\api\research\validation\v9\purged-walk-forward\status\route.ts"
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
            "$target.backup-v9-2-$timestamp" `
            -Force
    }

    Copy-Item `
        $source `
        $target `
        -Force

    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v9.2 Purged/Embargo Validation Foundation installed."
Write-Host "IMPORTANT: Run migration 048 in Supabase first."
Write-Host "This stage builds validation plans only. No historical Alpha validation is executed."
Write-Host "Next: npx.cmd tsc --noEmit"
