$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$target =
    Join-Path `
        $root `
        "app\api\trading\automation\run\route.ts"

if (
    -not (
        Test-Path $target
    )
) {
    throw "AUTOMATION_ROUTE_NOT_FOUND: $target"
}

$content =
    [System.IO.File]::ReadAllText(
        $target,
        [System.Text.Encoding]::UTF8
    )

$content =
    $content -replace "`r`n", "`n"

$freshnessPath =
    "/api/market/regime/v7/freshness/capture"

if (
    $content.Contains(
        $freshnessPath
    )
) {
    Write-Host ""
    Write-Host "v7.7 freshness capture already appears in automation."
    Write-Host "Target: $target"
    exit 0
}

$v6Path =
    "/api/market/regime/capture"

$v7ComparatorPath =
    "/api/market/regime/v7/shadow/capture"

$v6Index =
    $content.IndexOf(
        $v6Path
    )

if (
    $v6Index -lt
    0
) {
    throw "V6_REGIME_CAPTURE_PATH_NOT_FOUND"
}

$v6StepEnd =
    $content.IndexOf(
        "});",
        $v6Index
    )

if (
    $v6StepEnd -lt
    0
) {
    throw "V6_REGIME_CAPTURE_STEP_END_NOT_FOUND"
}

$insertAt =
    $v6StepEnd + 3

$timestamp =
    Get-Date `
        -Format "yyyyMMdd-HHmmss"

$backup =
    "$target.backup-regime-v7-7-$timestamp"

Copy-Item `
    $target `
    $backup `
    -Force

$block = @'

    /*
     * Market Regime v7.7 Data Freshness Guard
     *
     * Captures KOSPI/KOSDAQ/active-stock daily-bar freshness
     * immediately before the v7 shadow comparator runs.
     *
     * The comparator independently reads the same guard and can
     * invalidate stale/misaligned SHADOW comparisons.
     *
     * Production orders are not changed.
     */
    steps.push({
      name:
        "Market Regime v7.7 Data Freshness Guard",

      path:
        "/api/market/regime/v7/freshness/capture",

      body: {},

      critical: false,
    });
'@

$content =
    $content.Substring(
        0,
        $insertAt
    ) +
    $block +
    $content.Substring(
        $insertAt
    )

$v6Index =
    $content.IndexOf(
        $v6Path
    )

$freshnessIndex =
    $content.IndexOf(
        $freshnessPath
    )

$v7Index =
    $content.IndexOf(
        $v7ComparatorPath
    )

$dartIndex =
    $content.IndexOf(
        "/api/market/disclosures/sync"
    )

if (
    $v6Index -lt 0 -or
    $freshnessIndex -lt 0 -or
    $v7Index -lt 0 -or
    $dartIndex -lt 0
) {
    throw "SAFETY_CHECK_FAILED: required market-regime path missing"
}

if (
    -not (
        $v6Index -lt
          $freshnessIndex -and
        $freshnessIndex -lt
          $v7Index -and
        $v7Index -lt
          $dartIndex
    )
) {
    throw "SAFETY_CHECK_FAILED: v7.7 step ordering is wrong"
}

if (
    -not $content.Contains(
        "/api/market/regime/v7/outcomes/evaluate"
    )
) {
    throw "SAFETY_CHECK_FAILED: v7.4 outcome evaluator missing"
}

if (
    -not $content.Contains(
        "/api/market/regime/v7/governance/capture"
    )
) {
    throw "SAFETY_CHECK_FAILED: v7.6 governance step missing"
}

if (
    -not $content.Contains(
        "/api/trading/stop-loss/check"
    )
) {
    throw "SAFETY_CHECK_FAILED: stop-loss step missing"
}

$utf8NoBom =
    New-Object `
        System.Text.UTF8Encoding($false)

[System.IO.File]::WriteAllText(
    $target,
    $content,
    $utf8NoBom
)

Write-Host ""
Write-Host "Market Regime v7.7 freshness automation integrated."
Write-Host "Target: $target"
Write-Host "Backup: $backup"
Write-Host ""
Write-Host "Verified order:"
Write-Host "  v6 Regime Capture"
Write-Host "  -> v7.7 Data Freshness Guard"
Write-Host "  -> v7 Shadow Comparator"
Write-Host "  -> DART"
Write-Host ""
Write-Host "Stale data can invalidate shadow comparison only."
Write-Host "No production order logic was changed."
Write-Host "Next: npx.cmd tsc --noEmit"
