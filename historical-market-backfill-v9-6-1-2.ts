import {
  createSupabaseServerClient,
} from "@/lib/supabase";

export async function reconcileHistoricalSecurityMasterV961(
  compilationRunId: string,
) {
  const supabase =
    createSupabaseServerClient();

  const normalized =
    compilationRunId.trim();

  if (!normalized) {
    throw new Error(
      "V9_6_1_COMPILATION_RUN_ID_REQUIRED",
    );
  }

  const { data, error } =
    await supabase.rpc(
      "reconcile_historical_security_master_v9_6_1",
      {
        p_compilation_run_id:
          normalized,
      },
    );

  if (error) {
    throw new Error(
      `v9.6.1 master reconciliation failed: ${error.message}`,
    );
  }

  const result =
    Array.isArray(data)
      ? data[0] ?? null
      : data;

  if (!result) {
    throw new Error(
      "V9_6_1_RECONCILIATION_RETURNED_NO_RESULT",
    );
  }

  return {
    version:
      "HISTORICAL_SECURITY_MASTER_RECONCILIATION_V9_6_1",
    ...result,
    safety: {
      existingCurrentMasterRowsOverwritten:
        false,
      listingDateInferred:
        false,
      delistingDateInferred:
        false,
      currentUniverseMembershipChanged:
        false,
      productionApplied:
        false,
    },
  };
}

export async function createHistoricalMarketBackfillV962(
  input: {
    compilationRunId: string;
    startDate: string;
    endDate: string;
    stockCodes?: string[];
    adjustedPrice?: boolean;
    maxAttempts?: number;
    requestDelayMs?: number;
  },
) {
  const supabase =
    createSupabaseServerClient();

  const compilationRunId =
    input.compilationRunId.trim();

  if (!compilationRunId) {
    throw new Error(
      "V9_6_2_COMPILATION_RUN_ID_REQUIRED",
    );
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      input.startDate,
    ) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(
      input.endDate,
    )
  ) {
    throw new Error(
      "V9_6_2_INVALID_DATE",
    );
  }

  const stockCodes =
    input.stockCodes
      ?.map((value) =>
        value.trim(),
      )
      .filter(Boolean);

  const { data, error } =
    await supabase.rpc(
      "create_historical_market_data_backfill_v9_6_2",
      {
        p_compilation_run_id:
          compilationRunId,
        p_start_date:
          input.startDate,
        p_end_date:
          input.endDate,
        p_stock_codes:
          stockCodes &&
          stockCodes.length > 0
            ? stockCodes
            : null,
        p_adjusted_price:
          input.adjustedPrice !== false,
        p_max_attempts:
          Math.max(
            1,
            Math.min(
              10,
              Math.floor(
                input.maxAttempts ?? 3,
              ),
            ),
          ),
        p_request_delay_ms:
          Math.max(
            0,
            Math.min(
              10000,
              Math.floor(
                input.requestDelayMs ?? 1500,
              ),
            ),
          ),
      },
    );

  if (error) {
    throw new Error(
      `v9.6.2 backfill create failed: ${error.message}`,
    );
  }

  const result =
    Array.isArray(data)
      ? data[0] ?? null
      : data;

  if (!result) {
    throw new Error(
      "V9_6_2_BACKFILL_CREATE_RETURNED_NO_RESULT",
    );
  }

  return {
    version:
      "PIT_AWARE_HISTORICAL_MARKET_BACKFILL_V9_6_2",
    compilationRunId,
    requestedRange: {
      startDate: input.startDate,
      endDate: input.endDate,
    },
    requestedStockCodes:
      stockCodes ?? [],
    ...result,
    worker: {
      processEndpoint:
        "/api/market/data/v8/backfill/process",
      statusEndpoint:
        "/api/market/data/v8/backfill/status",
      runner:
        "run-market-data-backfill-v8-3.ps1",
      reusedV83LeaseRetryEngine:
        true,
    },
    safety: {
      historicalPitIntervalsUsed:
        true,
      currentUniverseSubstituted:
        false,
      numericSixDigitCodeRestriction:
        false,
      productionApplied:
        false,
    },
  };
}
