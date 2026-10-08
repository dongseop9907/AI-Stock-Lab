$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$source =
    Join-Path `
        $root `
        "compile-historical-universe-intervals-v9-3b-2.patch.ts.txt"

$target =
    Join-Path `
        $root `
        "lib\market\compile-historical-universe-intervals-v9-3b.ts"

if (-not (Test-Path $source)) {
    throw "SOURCE_NOT_FOUND: $source"
}

if (-not (Test-Path $target)) {
    throw "TARGET_NOT_FOUND: $target"
}

$timestamp =
    Get-Date `
        -Format "yyyyMMdd-HHmmss"

$backup =
    "$target.backup-v9-3b-2-$timestamp"

Copy-Item `
    $target `
    $backup `
    -Force

Copy-Item `
    $source `
    $target `
    -Force

Write-Host "BACKUP: $backup"
Write-Host "PATCHED: $target"
Write-Host ""
Write-Host "v9.3B.2 DB-side Historical PIT compiler installed."
Write-Host "Existing route and exported function name remain unchanged."
Write-Host "Next: npx.cmd tsc --noEmit"
