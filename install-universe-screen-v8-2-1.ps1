$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$source =
    Join-Path `
        $root `
        "screen-point-in-time-universe-v8-2-1.ts"

$target =
    Join-Path `
        $root `
        "lib\market\screen-point-in-time-universe-v8-2.ts"

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

if (
    Test-Path $target
) {
    Copy-Item `
        $target `
        "$target.backup-v8-2-1-$timestamp" `
        -Force
}

Copy-Item `
    $source `
    $target `
    -Force

Write-Host "COPIED: lib\market\screen-point-in-time-universe-v8-2.ts"
Write-Host ""
Write-Host "v8.2.1 pagination-safe screening patch installed."
Write-Host "IMPORTANT: Run migration 043 in Supabase first."
Write-Host "No trading/risk/order behavior was changed."
Write-Host "Next: npx.cmd tsc --noEmit"
