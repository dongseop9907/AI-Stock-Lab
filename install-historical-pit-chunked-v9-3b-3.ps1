$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{
        Source =
            "create-historical-pit-chunked-compilation-v9-3b-3.ts"
        Target =
            "lib\market\create-historical-pit-chunked-compilation-v9-3b-3.ts"
    },
    @{
        Source =
            "process-historical-pit-chunked-compilation-v9-3b-3.ts"
        Target =
            "lib\market\process-historical-pit-chunked-compilation-v9-3b-3.ts"
    },
    @{
        Source =
            "historical-pit-v9-3b-3-create-route.ts"
        Target =
            "app\api\market\universe\v9\historical\compile\chunked\create\route.ts"
    },
    @{
        Source =
            "historical-pit-v9-3b-3-process-route.ts"
        Target =
            "app\api\market\universe\v9\historical\compile\chunked\process\route.ts"
    },
    @{
        Source =
            "historical-pit-v9-3b-3-status-route.ts"
        Target =
            "app\api\market\universe\v9\historical\compile\chunked\status\route.ts"
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

    $dir =
        Split-Path `
            $target `
            -Parent

    New-Item `
        -ItemType Directory `
        -Path $dir `
        -Force |
        Out-Null

    if (
        Test-Path $target
    ) {
        Copy-Item `
            $target `
            "$target.backup-v9-3b-3-$timestamp" `
            -Force
    }

    Copy-Item `
        $source `
        $target `
        -Force

    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v9.3B.3 chunked compiler installed."
Write-Host "Existing v9.3B.2 compiler remains available for small-range regression."
Write-Host "Next: npx.cmd tsc --noEmit"
