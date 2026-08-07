$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$copies = @(
    @{
        Source =
            "link-regime-shadow-outcomes-v7-13.ts"
        Target =
            "lib\market\link-regime-shadow-outcomes-v7-4.ts"
    },
    @{
        Source =
            "evaluate-regime-shadow-outcomes-v7-13.ts"
        Target =
            "lib\market\evaluate-regime-shadow-outcomes-v7-4.ts"
    },
    @{
        Source =
            "get-current-forward-causal-cohort-v7-13.ts"
        Target =
            "lib\market\get-current-forward-causal-cohort-v7-11.ts"
    },
    @{
        Source =
            "run-market-regime-positive-path-validation-v7-13.ts"
        Target =
            "lib\market\run-market-regime-positive-path-validation-v7-13.ts"
    },
    @{
        Source =
            "market-regime-v7-13-positive-path-route.ts"
        Target =
            "app\api\market\regime\v7\validation\positive-path\route.ts"
    }
)

$timestamp =
    Get-Date `
        -Format "yyyyMMdd-HHmmss"

foreach (
    $item
    in $copies
) {
    $source =
        Join-Path `
            $root `
            $item.Source

    $target =
        Join-Path `
            $root `
            $item.Target

    if (
        -not (
            Test-Path $source
        )
    ) {
        throw "SOURCE_NOT_FOUND: $source"
    }

    $targetDirectory =
        Split-Path `
            $target `
            -Parent

    New-Item `
        -ItemType Directory `
        -Path $targetDirectory `
        -Force |
        Out-Null

    if (
        Test-Path $target
    ) {
        Copy-Item `
            $target `
            "$target.backup-v7-13-$timestamp" `
            -Force
    }

    Copy-Item `
        $source `
        $target `
        -Force

    Write-Host "COPIED: $($item.Target)"
}

$evidenceTarget =
    Join-Path `
        $root `
        "lib\market\get-regime-forward-evidence-v7-5.ts"

if (
    -not (
        Test-Path $evidenceTarget
    )
) {
    throw "EVIDENCE_FILE_NOT_FOUND: $evidenceTarget"
}

$evidence =
    [System.IO.File]::ReadAllText(
        $evidenceTarget,
        [System.Text.Encoding]::UTF8
    )

$evidence =
    $evidence -replace "`r`n", "`n"

if (
    $evidence -notmatch
    '\.eq\(\s*"is_validation",\s*false'
) {
    $pattern =
        '(?s)(\.from\(\s*"market_regime_shadow_outcomes",?\s*\)\s*\.select\(`.*?`\)\s*)(\.order\()'

    $regex =
        [regex]::new(
            $pattern
        )

    $matches =
        $regex.Matches(
            $evidence
        )

    if (
        $matches.Count -ne
        1
    ) {
        throw "EVIDENCE_PATCH_TARGET_COUNT: $($matches.Count)"
    }

    $replacement = @'
$1.eq(
          "is_validation",
          false,
        )
        $2
'@

    $evidence =
        $regex.Replace(
            $evidence,
            $replacement,
            1
        )

    Copy-Item `
        $evidenceTarget `
        "$evidenceTarget.backup-v7-13-$timestamp" `
        -Force

    $utf8NoBom =
        New-Object `
            System.Text.UTF8Encoding($false)

    [System.IO.File]::WriteAllText(
        $evidenceTarget,
        $evidence,
        $utf8NoBom
    )

    Write-Host "PATCHED: lib\market\get-regime-forward-evidence-v7-5.ts"
}
else {
    Write-Host "SKIP: forward evidence already excludes validation rows."
}

Write-Host ""
Write-Host "Market Regime v7.13 positive-path validation installed."
Write-Host "Run migration 039 in Supabase before server start."
Write-Host "Next: npx.cmd tsc --noEmit"
