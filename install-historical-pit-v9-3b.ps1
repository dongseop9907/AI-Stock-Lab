$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{
        Source =
            "compile-historical-universe-intervals-v9-3b.ts"
        Target =
            "lib\market\compile-historical-universe-intervals-v9-3b.ts"
    },
    @{
        Source =
            "validate-historical-pit-intervals-v9-3b.ts"
        Target =
            "lib\market\validate-historical-pit-intervals-v9-3b.ts"
    },
    @{
        Source =
            "historical-pit-v9-3b-compile-route.ts"
        Target =
            "app\api\market\universe\v9\historical\compile\route.ts"
    },
    @{
        Source =
            "historical-pit-v9-3b-validate-route.ts"
        Target =
            "app\api\market\universe\v9\historical\validate\route.ts"
    },
    @{
        Source =
            "historical-pit-v9-3b-status-route.ts"
        Target =
            "app\api\market\universe\v9\historical\compiler-status\route.ts"
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
            "$target.backup-v9-3b-$timestamp" `
            -Force
    }

    Copy-Item `
        $source `
        $target `
        -Force

    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v9.3B Historical PIT Interval Compiler installed."
Write-Host "IMPORTANT: Run migration 050 in Supabase first."
Write-Host "No KRX API key is required."
Write-Host "Canonical PIT memberships remain untouched."
Write-Host "Next: npx.cmd tsc --noEmit"
