$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$source =
    Join-Path `
        $root `
        "validate-historical-market-data-coverage-v9-6-1.ts"

$targets = @(
    (
        Join-Path `
            $root `
            "validate-historical-market-data-coverage-v9-6.ts"
    ),
    (
        Join-Path `
            $root `
            "lib\research\validate-historical-market-data-coverage-v9-6.ts"
    )
)

if (
    -not (
        Test-Path $source
    )
) {
    throw "SOURCE_NOT_FOUND: $source"
}

$timestamp =
    Get-Date `
        -Format "yyyyMMdd-HHmmss"

foreach (
    $target
    in $targets
) {
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
            "$target.backup-v9-6-1-$timestamp" `
            -Force
    }

    Copy-Item `
        $source `
        $target `
        -Force

    Write-Host "PATCHED: $target"
}

Write-Host ""
Write-Host "v9.6.1 TypeScript union-narrowing hotfix installed."
Write-Host "No database migration is required."
Write-Host "Both root source and lib/research copy were patched because tsconfig is compiling both."
Write-Host "Next: npx.cmd tsc --noEmit"
