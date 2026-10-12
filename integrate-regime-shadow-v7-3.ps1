$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$appRoot =
    Join-Path `
        $root `
        "app"

if (-not (Test-Path $appRoot)) {
    throw "APP_ROOT_NOT_FOUND: $appRoot"
}

$candidates =
    Get-ChildItem `
        -Path $appRoot `
        -Recurse `
        -Filter "route.ts" `
        -File |
    Where-Object {
        $text =
            [System.IO.File]::ReadAllText(
                $_.FullName,
                [System.Text.Encoding]::UTF8
            )

        (
            $text.Contains(
                "trading_automation_runs"
            ) -and
            $text.Contains(
                "/api/market/regime/capture"
            ) -and
            $text.Contains(
                "/api/market/disclosures/sync"
            ) -and
            $text.Contains(
                "/api/signals/entry/generate"
            )
        )
    }

if ($candidates.Count -eq 0) {
    throw "AUTOMATION_ROUTE_NOT_FOUND"
}

if ($candidates.Count -gt 1) {
    Write-Host "Multiple automation route candidates:"
    $candidates |
        ForEach-Object {
            Write-Host " - $($_.FullName)"
        }

    throw "AUTOMATION_ROUTE_AMBIGUOUS"
}

$target =
    $candidates[0].FullName

$content =
    [System.IO.File]::ReadAllText(
        $target,
        [System.Text.Encoding]::UTF8
    )

$content =
    $content -replace "`r`n", "`n"

$v7Path =
    "/api/market/regime/v7/shadow/capture"

if (
    $content.Contains(
        $v7Path
    )
) {
    Write-Host ""
    Write-Host "v7.3 shadow comparator is already integrated."
    Write-Host "Target: $target"
    exit 0
}

$v6Path =
    "/api/market/regime/capture"

$v6PathIndex =
    $content.IndexOf(
        $v6Path
    )

if ($v6PathIndex -lt 0) {
    throw "V6_REGIME_CAPTURE_PATH_NOT_FOUND"
}

# Find the end of the existing simple steps.push({ ... }); block.
$stepEnd =
    $content.IndexOf(
        "});",
        $v6PathIndex
    )

if ($stepEnd -lt 0) {
    throw "V6_REGIME_CAPTURE_STEP_END_NOT_FOUND"
}

$insertAt =
    $stepEnd + 3

$timestamp =
    Get-Date `
        -Format "yyyyMMdd-HHmmss"

$backup =
    "$target.backup-regime-v7-3-$timestamp"

Copy-Item `
    $target `
    $backup `
    -Force

$block = @'

    /*
     * Market Regime v7.3 Forward Shadow Comparator
     *
     * Compares the existing v6 BEAR decision with the
     * v7 BLOCK_BREADTH_OR_HIGH_VOL candidate.
     *
     * Observation only:
     * - no signal qualification changes
     * - no order blocking
     * - no production decision changes
     */
    steps.push({
      name:
        "Market Regime v7.3 Shadow Comparator",

      path:
        "/api/market/regime/v7/shadow/capture",

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

$v7Index =
    $content.IndexOf(
        $v7Path
    )

$dartIndex =
    $content.IndexOf(
        "/api/market/disclosures/sync"
    )

$predictionIndex =
    $content.IndexOf(
        "/api/predictions/generate"
    )

$entryIndex =
    $content.IndexOf(
        "/api/signals/entry/generate"
    )

if (
    $v6Index -lt 0 -or
    $v7Index -lt 0 -or
    $dartIndex -lt 0 -or
    $predictionIndex -lt 0 -or
    $entryIndex -lt 0
) {
    throw "SAFETY_CHECK_FAILED: required automation path missing"
}

if (
    -not (
        $v6Index -lt $v7Index -and
        $v7Index -lt $dartIndex -and
        $dartIndex -lt $predictionIndex -and
        $predictionIndex -lt $entryIndex
    )
) {
    throw "SAFETY_CHECK_FAILED: automation ordering is wrong"
}

if (
    -not $content.Contains(
        "/api/trading/stop-loss/check"
    )
) {
    throw "SAFETY_CHECK_FAILED: stop-loss step missing"
}

if (
    -not $content.Contains(
        "/api/trading/trailing-stop/update"
    )
) {
    throw "SAFETY_CHECK_FAILED: trailing-stop step missing"
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
Write-Host "Market Regime v7.3 shadow comparator integrated."
Write-Host "Target: $target"
Write-Host "Backup: $backup"
Write-Host ""
Write-Host "Verified order:"
Write-Host "  v6 Regime Capture"
Write-Host "  -> v7.3 Shadow Comparator"
Write-Host "  -> DART"
Write-Host "  -> AI Prediction"
Write-Host "  -> Entry Signal"
Write-Host ""
Write-Host "No order-blocking logic was changed."
Write-Host "Next: npx.cmd tsc --noEmit"