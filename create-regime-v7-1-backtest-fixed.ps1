$ErrorActionPreference = "Stop"

$root =
    "C:\Users\user\Desktop\ai-stock-lab"

$source =
    Join-Path `
        $root `
        "lib\backtest\run-daily-regime-backtest.ts"

$target =
    Join-Path `
        $root `
        "lib\backtest\run-daily-regime-v7-backtest.ts"

if (-not (Test-Path $source)) {
    throw "SOURCE_NOT_FOUND: $source"
}

$content =
    [System.IO.File]::ReadAllText(
        $source,
        [System.Text.Encoding]::UTF8
    )

$content =
    $content -replace "`r`n", "`n"

function Replace-Once {
    param(
        [string]$Text,
        [string]$Old,
        [string]$New,
        [string]$Label
    )

    # The source file is normalized to LF above.
    # PowerShell here-strings on Windows use CRLF,
    # so normalize patch strings too before matching.
    $oldNormalized =
        $Old -replace "`r`n", "`n"

    $newNormalized =
        $New -replace "`r`n", "`n"

    $first =
        $Text.IndexOf(
            $oldNormalized
        )

    if ($first -lt 0) {
        throw "PATCH_NOT_FOUND: $Label"
    }

    $second =
        $Text.IndexOf(
            $oldNormalized,
            $first +
              $oldNormalized.Length
        )

    if ($second -ge 0) {
        throw "PATCH_AMBIGUOUS: $Label"
    }

    return (
        $Text.Substring(
            0,
            $first
        ) +
        $newNormalized +
        $Text.Substring(
            $first +
              $oldNormalized.Length
        )
    )
}

# ------------------------------------------------------------
# 1. Imports
# ------------------------------------------------------------
$old = @'
import { createSupabaseServerClient } from "@/lib/supabase";
'@

$new = @'
import { createSupabaseServerClient } from "@/lib/supabase";

import {
  calculateMarketRegimeFeatureVectorV7,
  type MarketRegimeFeatureVectorV7,
  type MarketRegimeIndexBar,
  type MarketRegimeStockBar,
} from "@/lib/market/market-regime-feature-engine";

import {
  DEFAULT_MARKET_REGIME_V7_THRESHOLDS,
  evaluateMarketRegimeV7Policy,
  normalizeMarketRegimeV7Policy,
  type MarketRegimeV7Policy,
} from "@/lib/market/market-regime-v7-policy";
'@

$content =
    Replace-Once `
        $content `
        $old `
        $new `
        "imports"

# ------------------------------------------------------------
# 2. Input policy
# ------------------------------------------------------------
$old = @'
  regimeFilter?: "NONE" | "BLOCK_BEAR";
'@

$new = @'
  v7Policy?: MarketRegimeV7Policy;
'@

$content =
    Replace-Once `
        $content `
        $old `
        $new `
        "input-policy"

# ------------------------------------------------------------
# 3. Add index row interface
# ------------------------------------------------------------
$anchor = @'
interface DailySignal {
'@

$block = @'
interface MarketIndexDailyBarRecord {
  market_code:
    | "KOSPI"
    | "KOSDAQ";

  trading_date: string;

  close_value:
    | number
    | string;
}

'@

$content =
    Replace-Once `
        $content `
        $anchor `
        ($block + $anchor) `
        "index-row-interface"

# ------------------------------------------------------------
# 4. Add v7 index loader / feature builder
# ------------------------------------------------------------
$anchor = @'
function calculateMarketRegime(
'@

$block = @'
async function loadMarketIndexDailyBars(
  startDate: string,
  endDate: string,
): Promise<MarketIndexDailyBarRecord[]> {
  const supabase =
    createSupabaseServerClient();

  const pageSize =
    1000;

  let offset =
    0;

  const results:
    MarketIndexDailyBarRecord[] =
      [];

  while (true) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "market_index_daily_bars",
        )
        .select(`
          market_code,
          trading_date,
          close_value
        `)
        .in(
          "market_code",
          [
            "KOSPI",
            "KOSDAQ",
          ],
        )
        .gte(
          "trading_date",
          startDate,
        )
        .lte(
          "trading_date",
          endDate,
        )
        .order(
          "trading_date",
          {
            ascending: true,
          },
        )
        .order(
          "market_code",
          {
            ascending: true,
          },
        )
        .range(
          offset,
          offset +
            pageSize -
            1,
        );

    if (error) {
      throw new Error(
        `시장 지수 일봉 조회 실패: ${error.message}`,
      );
    }

    const page =
      (data ??
        []) as
        MarketIndexDailyBarRecord[];

    results.push(
      ...page,
    );

    if (
      page.length <
      pageSize
    ) {
      break;
    }

    offset +=
      pageSize;
  }

  return results;
}

function buildMarketRegimeV7Features(
  tradingDate: string,

  histories: Map<
    string,
    DailyBarRecord[]
  >,

  allIndexBars:
    MarketIndexDailyBarRecord[],
): MarketRegimeFeatureVectorV7 {
  const indexBars:
    MarketRegimeIndexBar[] =
      allIndexBars
        .filter(
          (row) =>
            row.trading_date <=
            tradingDate,
        )
        .map(
          (row) => {
            const close =
              toNumber(
                row.close_value,
              );

            if (
              close === null ||
              close <= 0
            ) {
              return null;
            }

            return {
              marketCode:
                row.market_code,

              tradingDate:
                row.trading_date,

              close,
            };
          },
        )
        .filter(
          (
            row,
          ): row is MarketRegimeIndexBar =>
            row !== null,
        );

  const stockBars:
    MarketRegimeStockBar[] =
      [];

  for (
    const [
      stockCode,
      history,
    ]
    of histories
  ) {
    for (
      const bar
      of history
    ) {
      const close =
        toNumber(
          bar.close_price,
        );

      if (
        close === null ||
        close <= 0 ||
        bar.trading_date >
          tradingDate
      ) {
        continue;
      }

      stockBars.push({
        stockCode,

        tradingDate:
          bar.trading_date,

        close,
      });
    }
  }

  return (
    calculateMarketRegimeFeatureVectorV7({
      indexBars,
      stockBars,
    })
  );
}

'@

$content =
    Replace-Once `
        $content `
        $anchor `
        ($block + $anchor) `
        "v7-feature-builder"

# ------------------------------------------------------------
# 5. Normalize policy; preserve v5 regime only as comparison
# ------------------------------------------------------------
$old = @'
  const regimeFilter =
    input.regimeFilter ===
    "BLOCK_BEAR"
      ? "BLOCK_BEAR"
      : "NONE";
'@

$new = @'
  const v7Policy =
    normalizeMarketRegimeV7Policy(
      input.v7Policy,
    );

  /*
   * v5 regime is retained only as a comparison metric.
   * It no longer blocks entries in this runner.
   */
  const regimeFilter:
    "NONE" | "BLOCK_BEAR" =
      (():
        "NONE" | "BLOCK_BEAR" =>
          "NONE")();
'@

$content =
    Replace-Once `
        $content `
        $old `
        $new `
        "normalize-v7-policy"

# ------------------------------------------------------------
# 6. Increase warmup for 60-trading-day features
# ------------------------------------------------------------
$old = @'
  const warmupStartDate =
    subtractCalendarDays(
      startDate,
      45,
    );
'@

$new = @'
  const warmupStartDate =
    subtractCalendarDays(
      startDate,
      150,
    );
'@

$content =
    Replace-Once `
        $content `
        $old `
        $new `
        "warmup-days"

# ------------------------------------------------------------
# 7. Load index history
# ------------------------------------------------------------
$anchor = @'
  const bars =
    allBars.filter(
'@

$block = @'
  const allIndexBars =
    await loadMarketIndexDailyBars(
      warmupStartDate,
      endDate,
    );

  if (
    allIndexBars.length ===
    0
  ) {
    throw new Error(
      "MARKET_INDEX_DAILY_BARS_NOT_FOUND",
    );
  }

'@

$content =
    Replace-Once `
        $content `
        $anchor `
        ($block + $anchor) `
        "load-index-history"

# ------------------------------------------------------------
# 8. Strategy identity
# ------------------------------------------------------------
$old = @'
        strategy_name:
          regimeFilter ===
          "BLOCK_BEAR"
            ? "DAILY_REGIME_FILTER"
            : "DAILY_REGIME_CONTROL",

        strategy_version:
          "v5",
'@

$new = @'
        strategy_name:
          "DAILY_REGIME_V7_POLICY",

        strategy_version:
          "v7.1",
'@

$content =
    Replace-Once `
        $content `
        $old `
        $new `
        "strategy-identity"

# ------------------------------------------------------------
# 9. Add v7 config while keeping v5 regime definition
# ------------------------------------------------------------
$old = @'
          regimeFilter,

          regimeDefinition: {
'@

$new = @'
          regimeFilter:
            "NONE_COMPARISON_ONLY",

          v7Policy,

          v7PolicyThresholds:
            DEFAULT_MARKET_REGIME_V7_THRESHOLDS,

          v7PolicyCandidates:
            [
              "CONTROL",
              "BLOCK_BREADTH20_LOW",
              "BLOCK_HIGH_VOL20",
              "BLOCK_KOSDAQ20_NEGATIVE",
              "BLOCK_BREADTH_OR_HIGH_VOL",
              "BLOCK_BREADTH_OR_KOSDAQ_WEAK",
            ],

          v7FeatureSource: {
            index:
              "market_index_daily_bars",

            breadth:
              "market_daily_bars",

            featureEngine:
              "MARKET_REGIME_FEATURES_V7",

            futureDataAllowed:
              false,
          },

          regimeDefinition: {
'@

$content =
    Replace-Once `
        $content `
        $old `
        $new `
        "v7-config"

# Update config warmup marker if present.
$content =
    $content.Replace(
        "warmupCalendarDays:`n            45,",
        "warmupCalendarDays:`n            150,"
    )

# ------------------------------------------------------------
# 10. Add counters
# ------------------------------------------------------------
$old = @'
    let blockedBearCandidates =
      0;
'@

$new = @'
    let blockedBearCandidates =
      0;

    let blockedV7Candidates =
      0;

    let v7BlockedTradingDays =
      0;

    let v7AllowedTradingDays =
      0;

    let v7MissingFeatureDays =
      0;
'@

$content =
    Replace-Once `
        $content `
        $old `
        $new `
        "v7-counters"

# ------------------------------------------------------------
# 11. Calculate v7 policy decision after today's close
# ------------------------------------------------------------
$old = @'
      regimeDayCounts[
        marketRegime.regime
      ] += 1;
'@

$new = @'
      regimeDayCounts[
        marketRegime.regime
      ] += 1;

      /*
       * v7.1 shared feature engine.
       *
       * Only data with trading_date <= signal date
       * is passed into the feature engine.
       */
      const v7Features =
        buildMarketRegimeV7Features(
          tradingDate,
          histories,
          allIndexBars,
        );

      const v7Decision =
        evaluateMarketRegimeV7Policy(
          v7Policy,
          v7Features,
        );

      if (
        !v7Decision.inputsComplete
      ) {
        v7MissingFeatureDays +=
          1;
      }

      if (
        v7Decision.blocked
      ) {
        v7BlockedTradingDays +=
          1;
      } else {
        v7AllowedTradingDays +=
          1;
      }
'@

$content =
    Replace-Once `
        $content `
        $old `
        $new `
        "v7-daily-decision"

# ------------------------------------------------------------
# 12. Replace v5 BEAR blocker with v7 policy blocker
# ------------------------------------------------------------
$old = @'
        if (
          regimeFilter ===
            "BLOCK_BEAR" &&
          marketRegime.regime ===
            "BEAR"
        ) {
          blockedBearCandidates +=
            1;

          continue;
        }
'@

$new = @'
        if (
          v7Decision.blocked
        ) {
          blockedV7Candidates +=
            1;

          continue;
        }
'@

$content =
    Replace-Once `
        $content `
        $old `
        $new `
        "replace-entry-blocker"

# ------------------------------------------------------------
# 13. Trade metadata identity
# ------------------------------------------------------------
$old = @'
          strategy:
            regimeFilter ===
            "BLOCK_BEAR"
              ? "DAILY_REGIME_FILTER_V5"
              : "DAILY_REGIME_CONTROL_V5",
'@

$new = @'
          strategy:
            "DAILY_REGIME_V7_POLICY_V7_1",

          v7Policy,
'@

$content =
    Replace-Once `
        $content `
        $old `
        $new `
        "trade-metadata"

# ------------------------------------------------------------
# 14. Metrics
# ------------------------------------------------------------
$old = @'
      blockedBearCandidates,
    };
'@

$new = @'
      blockedBearCandidates,

      v7Policy,

      v7PolicyThresholds:
        DEFAULT_MARKET_REGIME_V7_THRESHOLDS,

      blockedV7Candidates,

      v7BlockedTradingDays,
      v7AllowedTradingDays,
      v7MissingFeatureDays,

      v7IndexBarCount:
        allIndexBars.length,
    };
'@

$content =
    Replace-Once `
        $content `
        $old `
        $new `
        "v7-metrics"

# ------------------------------------------------------------
# 15. Return identity
# ------------------------------------------------------------
$old = @'
      strategy:
        regimeFilter ===
        "BLOCK_BEAR"
          ? "DAILY_REGIME_FILTER"
          : "DAILY_REGIME_CONTROL",

      version:
        "v5",
'@

$new = @'
      strategy:
        "DAILY_REGIME_V7_POLICY",

      version:
        "v7.1",
'@

$content =
    Replace-Once `
        $content `
        $old `
        $new `
        "return-identity"

# ------------------------------------------------------------
# 16. Rename exported runner
# ------------------------------------------------------------
$content =
    $content.Replace(
        "runDailyRegimeBacktest",
        "runDailyRegimeV7Backtest"
    )

# ------------------------------------------------------------
# 17. Safety checks
# ------------------------------------------------------------
$required = @(
    "runDailyRegimeV7Backtest",
    "calculateMarketRegimeFeatureVectorV7",
    "evaluateMarketRegimeV7Policy",
    "market_index_daily_bars",
    "blockedV7Candidates",
    '"v7.1"'
)

foreach ($token in $required) {
    if (-not $content.Contains($token)) {
        throw "SAFETY_CHECK_FAILED: $token"
    }
}

if (
    -not $content.Contains(
        'strategy_name:' + "`n" +
        '          "DAILY_REGIME_V7_POLICY"'
    )
) {
    throw "SAFETY_CHECK_FAILED: strategy identity"
}

if (Test-Path $target) {
    $timestamp =
        Get-Date `
            -Format "yyyyMMdd-HHmmss"

    Copy-Item `
        $target `
        "$target.backup-$timestamp" `
        -Force
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
Write-Host "Market Regime v7.1 full backtest runner created."
Write-Host "Source preserved: $source"
Write-Host "Target: $target"
Write-Host ""
Write-Host "v5 source was NOT modified."
Write-Host "Next: npx.cmd tsc --noEmit"