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

$linkPath =
    "/api/market/regime/v7/outcomes/link"

$evaluatePath =
    "/api/market/regime/v7/outcomes/evaluate"

if (
    $content.Contains(
        $linkPath
    ) -or
    $content.Contains(
        $evaluatePath
    )
) {
    Write-Host ""
    Write-Host "v7.4 outcome steps already appear in automation."
    Write-Host "Target: $target"
    exit 0
}

$shadowPath =
    "/api/signals/shadow/capture"

$shadowPathIndex =
    $content.IndexOf(
        $shadowPath
    )

if ($shadowPathIndex -lt 0) {
    throw "SHADOW_CAPTURE_PATH_NOT_FOUND"
}

$shadowStepStart =
    $content.LastIndexOf(
        "steps.push({",
        $shadowPathIndex
    )

if ($shadowStepStart -lt 0) {
    throw "SHADOW_CAPTURE_STEP_START_NOT_FOUND"
}

$shadowStepEnd =
    $content.IndexOf(
        "});",
        $shadowPathIndex
    )

if ($shadowStepEnd -lt 0) {
    throw "SHADOW_CAPTURE_STEP_END_NOT_FOUND"
}

$insertAt =
    $shadowStepEnd + 3

$timestamp =
    Get-Date `
        -Format "yyyyMMdd-HHmmss"

$backup =
    "$target.backup-regime-v7-4-$timestamp"

Copy-Item `
    $target `
    $backup `
    -Force

$block = @'

    /*
     * Market Regime v7.4 Forward Outcome Attribution
     *
     * Link only fresh GENERATED shadow signals that were created
     * after the current/latest eligible v7.3 comparison.
     *
     * Then re-evaluate all pending/partial regime outcomes against
     * whatever future daily bars are currently available.
     *
     * Observation only. No production order logic is changed.
     */
    steps.push({
      name:
        "Market Regime v7.4 Outcome Link",

      path:
        "/api/market/regime/v7/outcomes/link",

      body: {},

      critical: false,
    });

    steps.push({
      name:
        "Market Regime v7.4 Outcome Evaluate",

      path:
        "/api/market/regime/v7/outcomes/evaluate",

      body: {
        limit: 300,
      },

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

$shadowIndex =
    $content.IndexOf(
        $shadowPath
    )

$linkIndex =
    $content.IndexOf(
        $linkPath
    )

$evaluateIndex =
    $content.IndexOf(
        $evaluatePath
    )

$trailingIndex =
    $content.IndexOf(
        "/api/trading/trailing-stop/update"
    )

if (
    $shadowIndex -lt 0 -or
    $linkIndex -lt 0 -or
    $evaluateIndex -lt 0 -or
    $trailingIndex -lt 0
) {
    throw "SAFETY_CHECK_FAILED: required path missing"
}

if (
    -not (
        $shadowIndex -lt $linkIndex -and
        $linkIndex -lt $evaluateIndex -and
        $evaluateIndex -lt $trailingIndex
    )
) {
    throw "SAFETY_CHECK_FAILED: v7.4 step ordering is wrong"
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
Write-Host "Market Regime v7.4 outcome automation integrated."
Write-Host "Target: $target"
Write-Host "Backup: $backup"
Write-Host ""
Write-Host "Verified order:"
Write-Host "  Shadow Capture"
Write-Host "  -> v7.4 Outcome Link"
Write-Host "  -> v7.4 Outcome Evaluate"
Write-Host "  -> Trailing Stop"
Write-Host ""
Write-Host "No production order-blocking logic was changed."
Write-Host "Next: npx.cmd tsc --noEmit"