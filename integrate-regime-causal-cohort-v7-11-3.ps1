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

$timestamp =
    Get-Date `
        -Format "yyyyMMdd-HHmmss"

$backup =
    "$target.backup-regime-v7-11-3-$timestamp"

Copy-Item `
    $target `
    $backup `
    -Force

# ------------------------------------------------------------
# 1) Import causal binder
# ------------------------------------------------------------

$binderImport =
    'import { bindMarketRegimeCausalArtifactV711 } from "@/lib/market/bind-market-regime-causal-artifact-v7-11";'

if (
    -not $content.Contains(
        "bindMarketRegimeCausalArtifactV711"
    )
) {
    $supabaseImport =
        'import { createSupabaseServerClient } from "@/lib/supabase";'

    $supabaseImportIndex =
        $content.IndexOf(
            $supabaseImport
        )

    if (
        $supabaseImportIndex -lt 0
    ) {
        throw "SUPABASE_IMPORT_NOT_FOUND"
    }

    $insertAt =
        $supabaseImportIndex +
        $supabaseImport.Length

    $content =
        $content.Insert(
            $insertAt,
            "`n$binderImport"
        )
}

# ------------------------------------------------------------
# 2) Pass automationRunId to v7 outcome linker
# ------------------------------------------------------------

$outcomePath =
    "/api/market/regime/v7/outcomes/link"

$outcomeIndex =
    $content.IndexOf(
        $outcomePath
    )

if (
    $outcomeIndex -lt 0
) {
    throw "OUTCOME_LINK_STEP_NOT_FOUND"
}

$outcomeWindowLength =
    [Math]::Min(
        1200,
        $content.Length -
        $outcomeIndex
    )

$outcomeWindow =
    $content.Substring(
        $outcomeIndex,
        $outcomeWindowLength
    )

if (
    -not $outcomeWindow.Contains(
        "automationRunId"
    )
) {
    $bodyIndex =
        $content.IndexOf(
            "body: {}",
            $outcomeIndex
        )

    if (
        $bodyIndex -lt 0 -or
        $bodyIndex -gt (
            $outcomeIndex + 1000
        )
    ) {
        throw "OUTCOME_LINK_EMPTY_BODY_NOT_FOUND"
    }

    $replacement = @'
body: {
        automationRunId:
          runId,
      }
'@

    $content =
        $content.Remove(
            $bodyIndex,
            "body: {}".Length
        ).Insert(
            $bodyIndex,
            $replacement
        )
}

# ------------------------------------------------------------
# 3) Insert causal binding into the actual step loop.
#    Do NOT depend on exact results.push formatting.
# ------------------------------------------------------------

if (
    -not $content.Contains(
        "causalBindingResult"
    )
) {
    $loopIndex =
        $content.IndexOf(
            "for (const step of steps)"
        )

    if (
        $loopIndex -lt 0
    ) {
        throw "AUTOMATION_STEP_LOOP_NOT_FOUND"
    }

    $criticalConditionIndex =
        $content.IndexOf(
            "!result.ok",
            $loopIndex
        )

    if (
        $criticalConditionIndex -lt 0
    ) {
        throw "AUTOMATION_CRITICAL_CONDITION_NOT_FOUND"
    }

    $criticalIfIndex =
        $content.LastIndexOf(
            "      if (",
            $criticalConditionIndex
        )

    if (
        $criticalIfIndex -lt $loopIndex
    ) {
        throw "AUTOMATION_CRITICAL_IF_START_NOT_FOUND"
    }

    $resultsPushIndex =
        $content.LastIndexOf(
            "results.push",
            $criticalIfIndex
        )

    if (
        $resultsPushIndex -lt $loopIndex
    ) {
        throw "AUTOMATION_RESULTS_PUSH_NOT_FOUND"
    }

    if (
        $content -notmatch
        '(?m)\b(?:let|const)\s+runStartedAt\b'
    ) {
        throw "RUN_STARTED_AT_NOT_FOUND"
    }

    $bindingBlock = @'
      /*
       * v7.11 causal cohort binding.
       *
       * Observation-only:
       * binding errors never alter production order/risk behavior.
       * The v7.11 outcome linker fails closed when no valid run-bound
       * batch/event exists.
       */
      try {
        const causalBindingResult =
          await bindMarketRegimeCausalArtifactV711({
            automationRunId:
              runId!,

            automationStartedAt:
              runStartedAt,

            stepPath:
              result.path,

            stepOk:
              result.ok,

            payload:
              result.payload,
          });

        if (
          causalBindingResult.relevant &&
          result.payload &&
          typeof result.payload === "object" &&
          !Array.isArray(result.payload)
        ) {
          (
            result.payload as Record<
              string,
              unknown
            >
          ).causalBinding =
            causalBindingResult;
        }
      } catch (
        causalBindingError
      ) {
        console.error(
          "v7.11 causal binding failed:",
          causalBindingError,
        );

        if (
          result.payload &&
          typeof result.payload === "object" &&
          !Array.isArray(result.payload)
        ) {
          (
            result.payload as Record<
              string,
              unknown
            >
          ).causalBinding = {
            relevant:
              true,

            bound:
              false,

            error:
              causalBindingError instanceof Error
                ? causalBindingError.message
                : "UNKNOWN_CAUSAL_BINDING_ERROR",
          };
        }
      }

'@

    $content =
        $content.Insert(
            $criticalIfIndex,
            $bindingBlock
        )
}

# ------------------------------------------------------------
# 4) Safety checks
# ------------------------------------------------------------

if (
    -not $content.Contains(
        $binderImport
    )
) {
    throw "SAFETY_CHECK_FAILED: binder import missing"
}

$outcomeIndex =
    $content.IndexOf(
        $outcomePath
    )

$outcomeWindowLength =
    [Math]::Min(
        1200,
        $content.Length -
        $outcomeIndex
    )

$outcomeWindow =
    $content.Substring(
        $outcomeIndex,
        $outcomeWindowLength
    )

if (
    -not $outcomeWindow.Contains(
        "automationRunId"
    )
) {
    throw "SAFETY_CHECK_FAILED: outcome linker does not receive automationRunId"
}

if (
    -not $content.Contains(
        "causalBindingResult"
    )
) {
    throw "SAFETY_CHECK_FAILED: causal binding block missing"
}

$requiredPaths = @(
    "/api/market/regime/v7/quality-gate/capture",
    "/api/market/regime/v7/shadow/capture",
    "/api/signals/entry/generate",
    "/api/signals/shadow/capture",
    "/api/market/regime/v7/outcomes/link"
)

foreach (
    $requiredPath in $requiredPaths
) {
    if (
        -not $content.Contains(
            $requiredPath
        )
    ) {
        throw "SAFETY_CHECK_FAILED: missing path $requiredPath"
    }
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
Write-Host "Market Regime v7.11.3 causal cohort binding integrated."
Write-Host "Target: $target"
Write-Host "Backup: $backup"
Write-Host ""
Write-Host "Verified:"
Write-Host "  binder import present"
Write-Host "  outcome linker receives automationRunId"
Write-Host "  causal binder executes inside the real automation step loop"
Write-Host ""
Write-Host "No production order/risk behavior changed."
Write-Host "Next: npx.cmd tsc --noEmit"