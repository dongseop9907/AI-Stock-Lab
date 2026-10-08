import {
  createSupabaseServerClient,
} from "../lib/supabase";

import {
  refreshCorporateActionHistoryV9726,
} from "../lib/market/refresh-corporate-action-history-v9-7-26";

const THROUGH_DATE =
  "2026-10-01";

const LOOKBACK_DAYS =
  366;

const SUPPORTED_REFRESH_TYPES = [
  "STOCK_SPLIT",
  "REVERSE_SPLIT",
  "STOCK_DIVIDEND",
] as const;

async function main() {
  const supabase =
    createSupabaseServerClient();

  const {
    data: productionEvents,
    error: productionError,
  } =
    await supabase
      .from(
        "corporate_action_events",
      )
      .select(`
        id,
        stock_code,
        action_type,
        effective_date,
        provider,
        provider_event_id,
        status,
        is_validation,
        production_applied
      `)
      .eq(
        "is_validation",
        false,
      )
      .gte(
        "effective_date",
        "2025-09-30",
      )
      .lte(
        "effective_date",
        THROUGH_DATE,
      )
      .order(
        "effective_date",
        {
          ascending: true,
        },
      )
      .order(
        "stock_code",
        {
          ascending: true,
        },
      );

  if (
    productionError
  ) {
    throw new Error(
      `PRODUCTION_EVENT_READ_FAILED: ${productionError.message}`,
    );
  }

  const events =
    productionEvents ??
    [];

  const refreshSupportedEvents =
    events.filter(
      (event) =>
        SUPPORTED_REFRESH_TYPES.includes(
          event.action_type as
            (typeof SUPPORTED_REFRESH_TYPES)[number],
        ),
    );

  const providerCounts =
    new Map<
      string,
      number
    >();

  const statusCounts =
    new Map<
      string,
      number
    >();

  const actionTypeCounts =
    new Map<
      string,
      number
    >();

  for (
    const event of
    events
  ) {
    const provider =
      event.provider ??
      "NULL";

    const status =
      event.status ??
      "NULL";

    const actionType =
      event.action_type ??
      "NULL";

    providerCounts.set(
      provider,
      (
        providerCounts.get(
          provider,
        ) ??
        0
      ) +
        1,
    );

    statusCounts.set(
      status,
      (
        statusCounts.get(
          status,
        ) ??
        0
      ) +
        1,
    );

    actionTypeCounts.set(
      actionType,
      (
        actionTypeCounts.get(
          actionType,
        ) ??
        0
      ) +
        1,
    );
  }

  /*
   * Production-mode dry-run only.
   * This performs reads but never refreshes market_daily_bars.
   */
  const refreshPreflight =
    await refreshCorporateActionHistoryV9726({
      dryRun:
        true,
      includeValidationEvents:
        false,
      detectionLookbackCalendarDays:
        LOOKBACK_DAYS,
      throughDate:
        THROUGH_DATE,
    });

  const productionCanonicalEvents =
    events.filter(
      (event) =>
        event.provider ===
        "DART_KRX_CANONICAL",
    );

  const hasProductionFeed =
    productionCanonicalEvents.length >
    0;

  const status =
    hasProductionFeed
      ? "V9_7_28_PRODUCTION_EVENT_PATH_PRESENT"
      : "V9_7_28_PRODUCTION_EVENT_PATH_NOT_YET_POPULATED";

  console.log(
    JSON.stringify(
      {
        status,

        throughDate:
          THROUGH_DATE,

        lookbackDays:
          LOOKBACK_DAYS,

        productionEventsRead:
          events.length,

        productionCanonicalEvents:
          productionCanonicalEvents.length,

        refreshSupportedProductionEvents:
          refreshSupportedEvents.length,

        providerCounts:
          Object.fromEntries(
            providerCounts,
          ),

        statusCounts:
          Object.fromEntries(
            statusCounts,
          ),

        actionTypeCounts:
          Object.fromEntries(
            actionTypeCounts,
          ),

        refreshPreflight: {
          dryRun:
            refreshPreflight.dryRun,

          includeValidationEvents:
            refreshPreflight
              .includeValidationEvents,

          throughDate:
            refreshPreflight
              .throughDate,

          detectionStartDate:
            refreshPreflight
              .detectionStartDate,

          refreshEligibleThroughDate:
            refreshPreflight
              .refreshEligibleThroughDate,

          counts:
            refreshPreflight
              .counts,

          targets:
            refreshPreflight
              .targets
              .map(
                (target) => ({
                  stockCode:
                    target.stockCode,

                  actionType:
                    target.actionType,

                  effectiveDate:
                    target.effectiveDate,

                  status:
                    target.status,

                  staleEvidence:
                    target.staleEvidence,

                  refreshStartDate:
                    target.refreshStartDate,

                  refreshEndDate:
                    target.refreshEndDate,
                }),
              ),
        },

        interpretation:
          hasProductionFeed
            ? "Production canonical corporate-action events exist. EOD auto-refresh has real production events to inspect."
            : "The EOD integration is installed, but no production canonical corporate-action events exist in the inspected period. Validation rows are intentionally not consumed by production.",

        writesPerformed:
          0,
      },
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      error instanceof Error
        ? error.message
        : error,
    );

    process.exitCode =
      1;
  },
);
