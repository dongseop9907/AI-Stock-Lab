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

$qualityPath =
    "/api/market/regime/v7/quality-gate/capture"

if (
    $content.Contains(
        $qualityPath
    )
) {
    Write-Host ""
    Write-Host "v7.10 data quality gate already appears in automation."
    Write-Host "Target: $target"
    exit 0
}

$freshnessPath =
    "/api/market/regime/v7/freshness/capture"

$comparatorPath =
    "/api/market/regime/v7/shadow/capture"

$freshnessIndex =
    $content.IndexOf(
        $freshnessPath
    )

if (
    $freshnessIndex -lt
    0
) {
    throw "V7_7_FRESHNESS_PATH_NOT_FOUND"
}

$freshnessStepEnd =
    $content.IndexOf(
        "});",
        $freshnessIndex
    )

if (
    $freshnessStepEnd -lt
    0
) {
    throw "V7_7_FRESHNESS_STEP_END_NOT_FOUND"
}

$insertAt =
    $freshnessStepEnd + 3

$timestamp =
    Get-Date `
        -Format "yyyyMMdd-HHmmss"

$backup =
    "$target.backup-regime-v7-10-$timestamp"

Copy-Item `
    $target `
    $backup `
    -Force

$block = @'

    /*
     * Market Regime v7.10 Data Quality Gate
     *
     * Requires both fresh market data and a current v7.9 integrity
     * scan with zero effective errors before forward-shadow evidence
     * can be accepted.
     *
     * Production orders are not changed.
     */
    steps.push({
      name:
        "Market Regime v7.10 Data Quality Gate",

      path:
        "/api/market/regime/v7/quality-gate/capture",

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

$freshnessIndex =
    $content.IndexOf(
        $freshnessPath
    )

$qualityIndex =
    $content.IndexOf(
        $qualityPath
    )

$comparatorIndex =
    $content.IndexOf(
        $comparatorPath
    )

$dartIndex =
    $content.IndexOf(
        "/api/market/disclosures/sync"
    )

if (
    $freshnessIndex -lt 0 -or
    $qualityIndex -lt 0 -or
    $comparatorIndex -lt 0 -or
    $dartIndex -lt 0
) {
    throw "SAFETY_CHECK_FAILED: required v7 path missing"
}

if (
    -not (
        $freshnessIndex -lt
          $qualityIndex -and
        $qualityIndex -lt
          $comparatorIndex -and
        $comparatorIndex -lt
          $dartIndex
    )
) {
    throw "SAFETY_CHECK_FAILED: v7.10 step ordering is wrong"
}

if (
    -not $content.Contains(
        "/api/market/regime/v7/governance/capture"
    )
) {
    throw "SAFETY_CHECK_FAILED: governance step missing"
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
Write-Host "Market Regime v7.10 quality gate integrated."
Write-Host "Target: $target"
Write-Host "Backup: $backup"
Write-Host ""
Write-Host "Verified order:"
Write-Host "  v7.7 Freshness"
Write-Host "  -> v7.10 Data Quality Gate"
Write-Host "  -> v7 Comparator"
Write-Host "  -> DART"
Write-Host ""
Write-Host "Forward-shadow eligibility is gated."
Write-Host "Production order logic was not changed."
Write-Host "Next: npx.cmd tsc --noEmit"