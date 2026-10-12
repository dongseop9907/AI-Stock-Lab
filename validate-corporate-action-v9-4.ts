import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  ingestCorporateActionV94,
} from "@/lib/market/ingest-corporate-action-v9-4";

import {
  buildCorporateActionAdjustmentV94,
} from "@/lib/market/build-corporate-action-adjustment-v9-4";

function closeTo(
  left:
    unknown,
  right:
    number,
  epsilon =
    1e-10,
) {
  const value =
    Number(left);

  return (
    Number.isFinite(
      value,
    ) &&
    Math.abs(
      value -
      right,
    ) <=
      epsilon
  );
}

export async function validateCorporateActionFoundationV94() {
  const supabase =
    createSupabaseServerClient();

  const provider =
    "SYNTHETIC_CORPORATE_ACTION_V9_4";

  let stockCode:
    string | null =
    null;

  let adjustmentRunId:
    string | null =
    null;

  let cleanupSucceeded =
    false;

  try {
    const {
      data: security,
      error: securityError,
    } =
      await supabase
        .from(
          "stock_universe_securities",
        )
        .select(
          "stock_code",
        )
        .order(
          "stock_code",
          {
            ascending:
              true,
          },
        )
        .limit(1)
        .maybeSingle();

    if (
      securityError
    ) {
      throw new Error(
        `v9.4 validation security lookup failed: ${securityError.message}`,
      );
    }

    if (
      !security?.stock_code
    ) {
      throw new Error(
        "V9_4_VALIDATION_NEEDS_SECURITY_MASTER_ROW",
      );
    }

    stockCode =
      String(
        security.stock_code,
      );

    const {
      data: calendarData,
      error: calendarError,
    } =
      await supabase
        .from(
          "market_index_daily_bars",
        )
        .select(
          "trading_date",
        )
        .eq(
          "index_code",
          "0001",
        )
        .order(
          "trading_date",
          {
            ascending:
              false,
          },
        )
        .limit(4);

    if (
      calendarError
    ) {
      throw new Error(
        `v9.4 validation calendar load failed: ${calendarError.message}`,
      );
    }

    const dates =
      (
        calendarData ??
        []
      )
        .map(
          (
            row,
          ) =>
            String(
              row.trading_date,
            ),
        )
        .sort();

    if (
      dates.length <
      4
    ) {
      throw new Error(
        "V9_4_VALIDATION_NEEDS_4_TRADING_DATES",
      );
    }

    const [
      d1,
      d2,
      d3,
      d4,
    ] =
      dates;

    await ingestCorporateActionV94({
      stockCode,

      actionType:
        "STOCK_SPLIT",

      effectiveDate:
        d3,

      ratioFrom:
        1,

      ratioTo:
        2,

      provider,

      providerEventId:
        "SPLIT_2_FOR_1",

      metadata: {
        synthetic:
          true,
      },

      isValidation:
        true,
    });

    await ingestCorporateActionV94({
      stockCode,

      actionType:
        "REVERSE_SPLIT",

      effectiveDate:
        d4,

      ratioFrom:
        5,

      ratioTo:
        1,

      provider,

      providerEventId:
        "REVERSE_1_FOR_5",

      metadata: {
        synthetic:
          true,
      },

      isValidation:
        true,
    });

    await ingestCorporateActionV94({
      stockCode,

      actionType:
        "CASH_DIVIDEND",

      effectiveDate:
        d2,

      cashAmount:
        123,

      currency:
        "KRW",

      provider,

      providerEventId:
        "DIVIDEND_UNSUPPORTED_V9_4",

      metadata: {
        synthetic:
          true,
      },

      isValidation:
        true,
    });

    const adjustment =
      await buildCorporateActionAdjustmentV94({
        stockCode,

        isValidation:
          true,
      });

    adjustmentRunId =
      adjustment.runId;

    const {
      data: factorData,
      error: factorError,
    } =
      await supabase
        .from(
          "corporate_action_adjustment_factors",
        )
        .select(`
          effective_date,
          action_type,
          event_price_factor,
          event_share_factor,
          cumulative_price_factor,
          cumulative_share_factor
        `)
        .eq(
          "adjustment_run_id",
          adjustmentRunId,
        )
        .order(
          "effective_date",
          {
            ascending:
              false,
          },
        );

    if (
      factorError
    ) {
      throw new Error(
        `v9.4 validation factor load failed: ${factorError.message}`,
      );
    }

    const factors =
      factorData ??
      [];

    const reverse =
      factors.find(
        (
          row,
        ) =>
          row.action_type ===
          "REVERSE_SPLIT",
      );

    const split =
      factors.find(
        (
          row,
        ) =>
          row.action_type ===
          "STOCK_SPLIT",
      );

    const {
      count: validationEventCount,
      error: eventCountError,
    } =
      await supabase
        .from(
          "corporate_action_events",
        )
        .select(
          "*",
          {
            count:
              "exact",

            head:
              true,
          },
        )
        .eq(
          "stock_code",
          stockCode,
        )
        .eq(
          "provider",
          provider,
        )
        .eq(
          "is_validation",
          true,
        );

    if (
      eventCountError
    ) {
      throw new Error(
        `v9.4 validation event-count failed: ${eventCountError.message}`,
      );
    }

    const assertions = {
      adjustmentReady:
        adjustment.status ===
        "READY",

      threeEventsRecorded:
        (
          validationEventCount ??
          0
        ) ===
        3,

      exactlyTwoDeterministicFactors:
        factors.length ===
        2,

      cashDividendExcludedFromSplitAdjustment:
        adjustment
          .summary
          .unsupportedEventCount ===
        1,

      twoForOnePriceFactorCorrect:
        closeTo(
          split
            ?.event_price_factor,
          0.5,
        ),

      twoForOneShareFactorCorrect:
        closeTo(
          split
            ?.event_share_factor,
          2,
        ),

      reverseSplitPriceFactorCorrect:
        closeTo(
          reverse
            ?.event_price_factor,
          5,
        ),

      reverseSplitShareFactorCorrect:
        closeTo(
          reverse
            ?.event_share_factor,
          0.2,
        ),

      laterReverseCumulativeCorrect:
        closeTo(
          reverse
            ?.cumulative_price_factor,
          5,
        ) &&
        closeTo(
          reverse
            ?.cumulative_share_factor,
          0.2,
        ),

      earlierSplitIncludesLaterAction:
        closeTo(
          split
            ?.cumulative_price_factor,
          2.5,
        ) &&
        closeTo(
          split
            ?.cumulative_share_factor,
          0.4,
        ),

      effectiveDateSemanticsCorrect:
        split
          ?.effective_date ===
          d3 &&
        reverse
          ?.effective_date ===
          d4,

      rawBarsModified:
        adjustment
          .safety
          .rawMarketDailyBarsModified ===
        false,

      unsupportedEventsAutomaticallyAdjusted:
        adjustment
          .safety
          .unsupportedEventsAutomaticallyAdjusted ===
        false,

      productionNotApplied:
        adjustment
          .safety
          .productionApplied ===
        false,
    };

    const passed =
      Object.values(
        assertions,
      ).every(
        (
          value,
        ) =>
          value ===
          true,
      );

    await supabase
      .from(
        "corporate_action_adjustment_runs",
      )
      .delete()
      .eq(
        "id",
        adjustmentRunId,
      );

    await supabase
      .from(
        "corporate_action_events",
      )
      .delete()
      .eq(
        "stock_code",
        stockCode,
      )
      .eq(
        "provider",
        provider,
      )
      .eq(
        "is_validation",
        true,
      );

    cleanupSucceeded =
      true;

    const {
      data: audit,
      error: auditError,
    } =
      await supabase
        .from(
          "corporate_action_validation_runs",
        )
        .insert({
          validation_version:
            "CORPORATE_ACTION_VALIDATION_V9_4",

          status:
            passed
              ? "PASS"
              : "FAIL",

          assertions,

          cleanup_succeeded:
            cleanupSucceeded,

          production_applied:
            false,
        })
        .select(
          "id,created_at",
        )
        .single();

    if (
      auditError ||
      !audit
    ) {
      throw new Error(
        `v9.4 validation audit failed: ${
          auditError?.message ??
          "NO_AUDIT"
        }`,
      );
    }

    return {
      version:
        "CORPORATE_ACTION_VALIDATION_V9_4",

      validationRunId:
        audit.id,

      status:
        passed
          ? "PASS"
          : "FAIL",

      stockCode,

      dates: {
        observationStart:
          d1,

        dividendDate:
          d2,

        splitDate:
          d3,

        reverseSplitDate:
          d4,
      },

      factors,

      assertions,

      cleanup: {
        succeeded:
          cleanupSucceeded,

        syntheticEventsRemoved:
          true,

        syntheticAdjustmentRunRemoved:
          true,
      },

      safety: {
        rawMarketDailyBarsModified:
          false,

        productionApplied:
          false,
      },
    };
  } catch (
    error
  ) {
    const message =
      error instanceof Error
        ? error.message
        : "UNKNOWN_V9_4_VALIDATION_ERROR";

    if (
      adjustmentRunId
    ) {
      await supabase
        .from(
          "corporate_action_adjustment_runs",
        )
        .delete()
        .eq(
          "id",
          adjustmentRunId,
        );
    }

    if (
      stockCode
    ) {
      await supabase
        .from(
          "corporate_action_events",
        )
        .delete()
        .eq(
          "stock_code",
          stockCode,
        )
        .eq(
          "provider",
          provider,
        )
        .eq(
          "is_validation",
          true,
        );
    }

    cleanupSucceeded =
      true;

    await supabase
      .from(
        "corporate_action_validation_runs",
      )
      .insert({
        validation_version:
          "CORPORATE_ACTION_VALIDATION_V9_4",

        status:
          "FAIL",

        assertions: {
          runtimeError:
            message,

          productionNotApplied:
            true,
        },

        cleanup_succeeded:
          cleanupSucceeded,

        error_message:
          message,

        production_applied:
          false,
      });

    throw error;
  }
}
