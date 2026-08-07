import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  getMarketDataIntegrityV79,
} from "@/lib/market/get-market-data-integrity-v7-9";

import {
  syncDailyBars,
} from "@/lib/market/sync-daily-bars";

import {
  syncIndexDailyBars,
} from "@/lib/market/sync-index-daily-bars";

function compactDate(
  sqlDate: string,
) {
  return sqlDate.replaceAll(
    "-",
    "",
  );
}

export async function runMarketDataIntegrityV79(
  input: {
    windowCalendarDays?:
      number;

    repair?:
      boolean;
  } = {},
) {
  const supabase =
    createSupabaseServerClient();

  const startedAt =
    new Date()
      .toISOString();

  const before =
    await getMarketDataIntegrityV79({
      windowCalendarDays:
        input
          .windowCalendarDays,
    });

  const {
    data: scanData,
    error: scanError,
  } =
    await supabase
      .from(
        "market_data_integrity_scans",
      )
      .insert({
        started_at:
          startedAt,

        status:
          "RUNNING",

        window_start_date:
          before.window
            .startDate,

        window_end_date:
          before.window
            .endDate,

        canonical_trading_days:
          before.window
            .canonicalTradingDays,

        active_stock_count:
          before.universe
            .activeStockCount,

        checked_index_rows:
          before.checked
            .indexRows,

        checked_stock_rows:
          before.checked
            .stockRows,

        issue_count:
          before.counts
            .issues,

        error_count:
          before.counts
            .errors,

        warning_count:
          before.counts
            .warnings,

        repair_requested:
          input.repair ===
          true,

        before_summary:
          before,

        production_applied:
          false,
      })
      .select(
        "id",
      )
      .single();

  if (
    scanError ||
    !scanData
  ) {
    throw new Error(
      `Integrity scan creation failed: ${
        scanError
          ?.message ??
        "NO_SCAN_ID"
      }`,
    );
  }

  const scanId =
    String(
      scanData.id,
    );

  if (
    before.issues.length >
    0
  ) {
    const issueRows =
      before.issues.map(
        (issue) => ({
          scan_id:
            scanId,

          severity:
            issue.severity,

          issue_type:
            issue.issueType,

          market_code:
            issue.marketCode ??
            null,

          stock_code:
            issue.stockCode ??
            null,

          trading_date:
            issue.tradingDate ??
            null,

          repairable:
            issue.repairable,

          repaired:
            false,

          details:
            issue.details,
        }),
      );

    const {
      error: issueInsertError,
    } =
      await supabase
        .from(
          "market_data_integrity_issues",
        )
        .insert(
          issueRows,
        );

    if (
      issueInsertError
    ) {
      throw new Error(
        `Integrity issues save failed: ${issueInsertError.message}`,
      );
    }
  }

  let repairAttempted =
    false;

  let repairSucceeded:
    boolean | null =
      null;

  let repairResult:
    Record<
      string,
      unknown
    > = {};

  let after =
    before;

  if (
    input.repair ===
      true &&
    before.counts
      .repairable >
      0
  ) {
    repairAttempted =
      true;

    const startDate =
      compactDate(
        before.window
          .startDate,
      );

    const endDate =
      compactDate(
        before.window
          .endDate,
      );

    const indexResult =
      await syncIndexDailyBars({
        markets: [
          "KOSPI",
          "KOSDAQ",
        ],

        startDate,
        endDate,

        chunkDays:
          30,
      });

    const stockResult =
      await syncDailyBars({
        startDate,
        endDate,

        adjustedPrice:
          true,

        chunkDays:
          30,
      });

    after =
      await getMarketDataIntegrityV79({
        windowCalendarDays:
          before.window
            .calendarDays,
      });

    repairSucceeded =
      after.counts
        .errors ===
      0;

    repairResult = {
      index:
        indexResult,

      stocks:
        stockResult,

      beforeRepairable:
        before.counts
          .repairable,

      afterErrors:
        after.counts
          .errors,

      afterWarnings:
        after.counts
          .warnings,
    };

    if (
      repairSucceeded
    ) {
      await supabase
        .from(
          "market_data_integrity_issues",
        )
        .update({
          repaired:
            true,
        })
        .eq(
          "scan_id",
          scanId,
        )
        .eq(
          "repairable",
          true,
        );
    }
  }

  let finalStatus:
    | "CLEAN"
    | "WARNING"
    | "ERROR"
    | "REPAIRED"
    | "REPAIR_PARTIAL";

  if (
    repairAttempted
  ) {
    finalStatus =
      after.counts
        .errors ===
      0
        ? "REPAIRED"
        : "REPAIR_PARTIAL";
  } else {
    finalStatus =
        before.status === "ERROR"
            ? "ERROR"
            : before.status === "WARNING"
            ? "WARNING"
            : "CLEAN";
  }

  const finishedAt =
    new Date()
      .toISOString();

  const {
    error: updateError,
  } =
    await supabase
      .from(
        "market_data_integrity_scans",
      )
      .update({
        finished_at:
          finishedAt,

        status:
          finalStatus,

        repair_attempted:
          repairAttempted,

        repair_succeeded:
          repairSucceeded,

        after_summary:
          after,

        repair_result:
          repairResult,

        production_applied:
          false,
      })
      .eq(
        "id",
        scanId,
      );

  if (
    updateError
  ) {
    throw new Error(
      `Integrity scan finalize failed: ${updateError.message}`,
    );
  }

  return {
    version:
      "MARKET_DATA_INTEGRITY_RUN_V7_9",

    scanId,

    startedAt,
    finishedAt,

    status:
      finalStatus,

    repairRequested:
      input.repair ===
      true,

    repairAttempted,
    repairSucceeded,

    before,

    after,

    repairResult,

    productionApplied:
      false,
  };
}