$ErrorActionPreference = "Stop"

$root = "C:\Users\user\Desktop\ai-stock-lab"
$appRoot = Join-Path $root "app"

if (-not (Test-Path $appRoot)) {
    throw "APP_ROOT_NOT_FOUND: $appRoot"
}

# Locate the actual automation route.
$candidates =
    Get-ChildItem `
        -Path $appRoot `
        -Recurse `
        -Filter "route.ts" `
        -File |
    Where-Object {
        $text = [System.IO.File]::ReadAllText(
            $_.FullName,
            [System.Text.Encoding]::UTF8
        )

        (
            $text.Contains("trading_automation_runs") -and
            $text.Contains("/api/signals/entry/generate") -and
            $text.Contains("/api/market/disclosures/sync")
        )
    }

if ($candidates.Count -eq 0) {
    throw "AUTOMATION_ROUTE_NOT_FOUND"
}

if ($candidates.Count -gt 1) {
    Write-Host "Multiple automation route candidates:"
    $candidates | ForEach-Object {
        Write-Host " - $($_.FullName)"
    }

    throw "AUTOMATION_ROUTE_AMBIGUOUS"
}

$target = $candidates[0].FullName

$content = [System.IO.File]::ReadAllText(
    $target,
    [System.Text.Encoding]::UTF8
)

$content = $content -replace "`r`n", "`n"

if ($content.Contains("/api/market/regime/capture")) {
    Write-Host ""
    Write-Host "Regime capture is already integrated."
    Write-Host "Target: $target"
    exit 0
}

$dartPath = "/api/market/disclosures/sync"
$dartPathIndex = $content.IndexOf($dartPath)

if ($dartPathIndex -lt 0) {
    throw "DART_PATH_NOT_FOUND"
}

# Find the steps.push({ that owns the DART path.
$dartStepStart =
    $content.LastIndexOf(
        "steps.push({",
        $dartPathIndex
    )

if ($dartStepStart -lt 0) {
    throw "DART_STEP_START_NOT_FOUND"
}

# Insert at the beginning of the line containing steps.push({.
$lineStart =
    $content.LastIndexOf(
        "`n",
        $dartStepStart
    )

if ($lineStart -lt 0) {
    $lineStart = 0
}
else {
    $lineStart += 1
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$target.backup-regime-v6-7-$timestamp"

Copy-Item $target $backup -Force

$regimeBlock = @'
    /*
     * 2. Market Regime SHADOW capture
     *
     * 시세 동기화 직후 시장 상태를 저장한다.
     * Forward 검증 전용이며 실제 주문에는 반영하지 않는다.
     * 실패해도 손절/포지션 관리가 중단되지 않도록
     * non-critical 단계로 둔다.
     */
    steps.push({
      name:
        "Market Regime SHADOW Capture",

      path:
        "/api/market/regime/capture",

      body: {},

      critical: false,
    });

'@

$content =
    $content.Substring(
        0,
        $lineStart
    ) +
    $regimeBlock +
    $content.Substring(
        $lineStart
    )

# Verify ordering and safety.
$regimeIndex =
    $content.IndexOf(
        "/api/market/regime/capture"
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
    $regimeIndex -lt 0 -or
    $dartIndex -lt 0 -or
    $predictionIndex -lt 0 -or
    $entryIndex -lt 0
) {
    throw "SAFETY_CHECK_FAILED: required path missing"
}

if (
    -not (
        $regimeIndex -lt $dartIndex -and
        $dartIndex -lt $predictionIndex -and
        $predictionIndex -lt $entryIndex
    )
) {
    throw "SAFETY_CHECK_FAILED: automation order is wrong"
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
    New-Object System.Text.UTF8Encoding($false)

[System.IO.File]::WriteAllText(
    $target,
    $content,
    $utf8NoBom
)

Write-Host ""
Write-Host "Regime auto-capture v6.7 integrated."
Write-Host "Target: $target"
Write-Host "Backup: $backup"
Write-Host ""
Write-Host "Verified order:"
Write-Host "  Regime -> DART -> AI Prediction -> Entry Signal"
Write-Host ""
Write-Host "No order-blocking logic was changed."
Write-Host "Next:"
Write-Host "  npx.cmd tsc --noEmit"