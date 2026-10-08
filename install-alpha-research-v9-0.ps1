$ErrorActionPreference = "Stop"

$root = "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{
        Source = "run-baseline-momentum-alpha-v9-0.ts"
        Target = "lib\research\run-baseline-momentum-alpha-v9-0.ts"
    },
    @{
        Source = "alpha-v9-0-run-route.ts"
        Target = "app\api\research\alpha\v9\baseline-momentum\run\route.ts"
    },
    @{
        Source = "alpha-v9-0-status-route.ts"
        Target = "app\api\research\alpha\v9\baseline-momentum\status\route.ts"
    }
)

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

foreach ($item in $copies) {
    $source = Join-Path $root $item.Source
    $target = Join-Path $root $item.Target

    if (-not (Test-Path $source)) {
        throw "SOURCE_NOT_FOUND: $source"
    }

    $targetDirectory = Split-Path $target -Parent
    New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null

    if (Test-Path $target) {
        Copy-Item $target "$target.backup-v9-0-$timestamp" -Force
    }

    Copy-Item $source $target -Force
    Write-Host "COPIED: $($item.Target)"
}

Write-Host ""
Write-Host "v9.0 Alpha Research Foundation installed."
Write-Host "IMPORTANT: Run migration 046 in Supabase first."
Write-Host "Research-only: no order, Risk Engine, or Production model behavior changed."
Write-Host "Next: npx.cmd tsc --noEmit"
