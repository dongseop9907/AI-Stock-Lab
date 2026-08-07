$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$target =
    Join-Path `
        $root `
        "app\api\trading\automation\run\route.ts"

if (-not (Test-Path $target)) {
    throw "AUTOMATION_ROUTE_NOT_FOUND: $target"
}

$content =
    [System.IO.File]::ReadAllText(
        $target,
        [System.Text.Encoding]::UTF8
    )

$content =
    $content -replace "`r`n", "`n"

$governancePath =
    "/api/market/regime/v7/governance/capture"

if (
    $content.Contains(
        $governancePath
    )
) {
    Write-Host ""
    Write-Host "v7.6 governance capture already appears in automation."
    Write-Host "Target: $target"
    exit 0
}

$outcomeEvaluatePath =
    "/api/market/regime/v7/outcomes/evaluate"

$outcomeIndex =
    $content.IndexOf(
        $outcomeEvaluatePath
    )

if ($outcomeIndex -lt 0) {
    throw "V7_4_OUTCOME_EVALUATE_PATH_NOT_FOUND"
}

$outcomeStepEnd =
    $content.IndexOf(
        "});",
        $outcomeIndex
    )

if ($outcomeStepEnd -lt 0) {
    throw "V7_4_OUTCOME_EVALUATE_STEP_END_NOT_FOUND"
}

$insertAt =
    $outcomeStepEnd + 3

$timestamp =
    Get-Date `
        -Format "yyyyMMdd-HHmmss"

$backup =
    "$target.backup-regime-v7-6-$timestamp"

Copy-Item `
    $target `
    $backup `
    -Force

$block = @'

    /*
     * Market Regime v7.6 Governance Review
     *
     * Captures a recommendation-only governance snapshot after
     * forward outcomes have been evaluated.
     *
     * Duplicate evidence fingerprints are suppressed.
     * No production promotion or order blocking is performed here.
     */
    steps.push({
      name:
        "Market Regime v7.6 Governance Review",

      path:
        "/api/market/regime/v7/governance/capture",

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

$linkIndex =
    $content.IndexOf(
        "/api/market/regime/v7/outcomes/link"
    )

$evaluateIndex =
    $content.IndexOf(
        $outcomeEvaluatePath
    )

$governanceIndex =
    $content.IndexOf(
        $governancePath
    )

$trailingIndex =
    $content.IndexOf(
        "/api/trading/trailing-stop/update"
    )

if (
    $linkIndex -lt 0 -or
    $evaluateIndex -lt 0 -or
    $governanceIndex -lt 0 -or
    $trailingIndex -lt 0
) {
    throw "SAFETY_CHECK_FAILED: required path missing"
}

if (
    -not (
        $linkIndex -lt
            $evaluateIndex -and
        $evaluateIndex -lt
            $governanceIndex -and
        $governanceIndex -lt
            $trailingIndex
    )
) {
    throw "SAFETY_CHECK_FAILED: v7.6 step ordering is wrong"
}

if (
    -not $content.Contains(
        "/api/market/regime/v7/shadow/capture"
    )
) {
    throw "SAFETY_CHECK_FAILED: v7.3 comparison step missing"
}

if (
    -not $content.Contains(
        "/api/signals/shadow/capture"
    )
) {
    throw "SAFETY_CHECK_FAILED: shadow signal capture step missing"
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
Write-Host "Market Regime v7.6 governance automation integrated."
Write-Host "Target: $target"
Write-Host "Backup: $backup"
Write-Host ""
Write-Host "Verified order:"
Write-Host "  v7.4 Outcome Link"
Write-Host "  -> v7.4 Outcome Evaluate"
Write-Host "  -> v7.6 Governance Review"
Write-Host "  -> Trailing Stop"
Write-Host ""
Write-Host "No production order-blocking or automatic promotion logic was changed."
Write-Host "Next: npx.cmd tsc --noEmit"