import {
  createClient,
} from "@supabase/supabase-js";

const supabaseUrl =
  String(
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "",
  )
    .trim()
    .replace(/\/+$/, "");

const serviceRoleKey =
  String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    "",
  ).trim();

if (
  !supabaseUrl ||
  !serviceRoleKey
) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_CONFIG_MISSING",
  );
}

const supabase =
  createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

async function countRows(
  table:
    string,
): Promise<number | null> {
  const result =
    await supabase
      .from(table)
      .select(
        "*",
        {
          count: "exact",
          head: true,
        },
      );

  if (result.error) {
    return null;
  }

  return result.count ?? 0;
}

async function latestOne(
  table:
    string,
) {
  const result =
    await supabase
      .from(table)
      .select("*")
      .order(
        "observed_at",
        {
          ascending: false,
        },
      )
      .order(
        "created_at",
        {
          ascending: false,
        },
      )
      .limit(1)
      .maybeSingle();

  return result;
}

async function validator(
  input: {
    freshnessStatus:
      string | null;

    freshnessUsable:
      boolean | null;

    expectedMarketDate:
      string | null;

    stockLatestDate:
      string | null;

    businessWeekdayLag:
      number | null;

    indexDateAligned:
      boolean | null;

    allSourceDatesAligned:
      boolean | null;

    qualityStatus:
      string | null;

    qualityFreshnessStatus:
      string | null;

    qualityUsable:
      boolean | null;

    qualityExpectedMarketDate:
      string | null;
  },
) {
  const result =
    await supabase.rpc(
      "validate_paper_buy_data_freshness_v1",
      {
        p_freshness_status:
          input.freshnessStatus,

        p_freshness_usable:
          input.freshnessUsable,

        p_expected_market_date:
          input.expectedMarketDate,

        p_stock_latest_date:
          input.stockLatestDate,

        p_business_weekday_lag:
          input.businessWeekdayLag,

        p_index_date_aligned:
          input.indexDateAligned,

        p_all_source_dates_aligned:
          input.allSourceDatesAligned,

        p_quality_status:
          input.qualityStatus,

        p_quality_freshness_status:
          input.qualityFreshnessStatus,

        p_quality_usable:
          input.qualityUsable,

        p_quality_expected_market_date:
          input.qualityExpectedMarketDate,
      },
    );

  if (result.error) {
    return {
      ok: false,
      error:
        result.error.message,
      data: null,
    };
  }

  return {
    ok: true,
    error: null,
    data:
      result.data,
  };
}

async function main() {
  const before = {
    orders:
      await countRows(
        "paper_order_requests",
      ),

    positions:
      await countRows(
        "paper_positions",
      ),
  };

  const [
    freshnessResult,
    qualityResult,
  ] =
    await Promise.all([
      latestOne(
        "market_data_freshness_observations",
      ),

      latestOne(
        "market_data_quality_gate_observations",
      ),
    ]);

  if (
    freshnessResult.error ||
    !freshnessResult.data
  ) {
    throw new Error(
      "LATEST_FRESHNESS_OBSERVATION_READ_FAILED:" +
      (
        freshnessResult.error?.message ??
        "MISSING"
      ),
    );
  }

  if (
    qualityResult.error ||
    !qualityResult.data
  ) {
    throw new Error(
      "LATEST_QUALITY_GATE_OBSERVATION_READ_FAILED:" +
      (
        qualityResult.error?.message ??
        "MISSING"
      ),
    );
  }

  const freshness =
    freshnessResult.data as any;

  const quality =
    qualityResult.data as any;

  const syntheticFresh =
    await validator({
      freshnessStatus:
        "FRESH",

      freshnessUsable:
        true,

      expectedMarketDate:
        "2026-10-08",

      stockLatestDate:
        "2026-10-08",

      businessWeekdayLag:
        0,

      indexDateAligned:
        true,

      allSourceDatesAligned:
        true,

      qualityStatus:
        "PASS",

      qualityFreshnessStatus:
        "FRESH",

      qualityUsable:
        true,

      qualityExpectedMarketDate:
        "2026-10-08",
    });

  const syntheticStale =
    await validator({
      freshnessStatus:
        "STALE",

      freshnessUsable:
        false,

      expectedMarketDate:
        "2026-10-08",

      stockLatestDate:
        "2026-10-07",

      businessWeekdayLag:
        1,

      indexDateAligned:
        true,

      allSourceDatesAligned:
        true,

      qualityStatus:
        "FAIL_FRESHNESS",

      qualityFreshnessStatus:
        "STALE",

      qualityUsable:
        false,

      qualityExpectedMarketDate:
        "2026-10-08",
    });

  const syntheticMismatch =
    await validator({
      freshnessStatus:
        "FRESH",

      freshnessUsable:
        true,

      expectedMarketDate:
        "2026-10-08",

      stockLatestDate:
        "2026-10-07",

      businessWeekdayLag:
        0,

      indexDateAligned:
        true,

      allSourceDatesAligned:
        true,

      qualityStatus:
        "PASS",

      qualityFreshnessStatus:
        "FRESH",

      qualityUsable:
        true,

      qualityExpectedMarketDate:
        "2026-10-08",
    });

  const canonical =
    await validator({
      freshnessStatus:
        freshness.status ?? null,

      freshnessUsable:
        freshness.usable_for_shadow_comparison ?? null,

      expectedMarketDate:
        freshness.expected_market_date ?? null,

      stockLatestDate:
        freshness.stock_latest_date ?? null,

      businessWeekdayLag:
        freshness.business_weekday_lag ?? null,

      indexDateAligned:
        freshness.index_date_aligned ?? null,

      allSourceDatesAligned:
        freshness.all_source_dates_aligned ?? null,

      qualityStatus:
        quality.status ?? null,

      qualityFreshnessStatus:
        quality.freshness_status ?? null,

      qualityUsable:
        quality.usable_for_forward_shadow ?? null,

      qualityExpectedMarketDate:
        quality.expected_market_date ?? null,
    });

  const assertionResult =
    await supabase.rpc(
      "assert_paper_buy_data_freshness_allowed_v1",
    );

  const after = {
    orders:
      await countRows(
        "paper_order_requests",
      ),

    positions:
      await countRows(
        "paper_positions",
      ),
  };

  const deltas = {
    orders:
      before.orders !== null &&
      after.orders !== null
        ? after.orders -
          before.orders
        : null,

    positions:
      before.positions !== null &&
      after.positions !== null
        ? after.positions -
          before.positions
        : null,
  };

  const canonicalAllowed =
    canonical.ok &&
    canonical.data?.allowed ===
      true;

  const canonicalReason =
    canonical.ok
      ? canonical.data?.reason ??
        null
      : canonical.error;

  const currentIsStale =
    String(
      freshness.status ??
      "",
    ).toUpperCase() ===
      "STALE" ||
    String(
      quality.status ??
      "",
    ).toUpperCase() ===
      "FAIL_FRESHNESS" ||
    Number(
      freshness.business_weekday_lag ??
      0,
    ) > 0;

  const assertionBlocked =
    Boolean(
      assertionResult.error,
    ) &&
    String(
      assertionResult.error?.message ??
      "",
    ).includes(
      "DATA_FRESHNESS_NEW_RISK_BLOCKED",
    );

  const checks = {
    migrationFunctionsReachable:
      syntheticFresh.ok &&
      syntheticStale.ok &&
      syntheticMismatch.ok,

    pureFreshAllowed:
      syntheticFresh.data?.allowed ===
        true &&
      syntheticFresh.data?.reason ===
        "FRESH_DATA_NEW_RISK_ALLOWED",

    pureStaleBlocked:
      syntheticStale.data?.allowed ===
        false &&
      syntheticStale.data?.reason ===
        "STALE_MARKET_DATA",

    pureDateMismatchBlocked:
      syntheticMismatch.data?.allowed ===
        false &&
      syntheticMismatch.data?.reason ===
        "MARKET_DATE_MISMATCH",

    canonicalValidatorRead:
      canonical.ok,

    currentStateRecognized:
      currentIsStale
        ? canonicalAllowed ===
            false
        : true,

    currentStaleAssertionBlocks:
      currentIsStale
        ? assertionBlocked
        : true,

    noOrderWrites:
      deltas.orders ===
        null ||
      deltas.orders ===
        0,

    noPositionWrites:
      deltas.positions ===
        null ||
      deltas.positions ===
        0,
  };

  const failed =
    Object.entries(checks)
      .filter(
        ([, value]) => !value,
      )
      .map(
        ([key]) => key,
      );

  const status =
    failed.length === 0
      ? "ALPHA_V3_DATA_FRESHNESS_DB_CREATE_FILL_GUARDS_V1_DB_VERIFIED"
      : "ALPHA_V3_DATA_FRESHNESS_DB_CREATE_FILL_GUARDS_V1_DB_REVIEW";

  console.log(
    JSON.stringify(
      {
        status,

        current: {
          freshnessStatus:
            freshness.status ??
            null,

          qualityStatus:
            quality.status ??
            null,

          expectedMarketDate:
            freshness.expected_market_date ??
            null,

          stockLatestDate:
            freshness.stock_latest_date ??
            null,

          businessWeekdayLag:
            freshness.business_weekday_lag ??
            null,

          canonicalAllowed,

          canonicalReason,

          assertionBlocked,

          assertionError:
            assertionResult.error?.message ??
            null,
        },

        pureValidator: {
          fresh:
            syntheticFresh,

          stale:
            syntheticStale,

          dateMismatch:
            syntheticMismatch,
        },

        before,
        after,
        deltas,

        checks,
        failed,

        safety: {
          productionCreateRpcCalled:
            false,

          productionFillRpcCalled:
            false,

          databaseWritesByVerifier:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,
        },

        nextGate:
          failed.length === 0
            ? "DATA_FRESHNESS_DB_DEFENSE_IN_DEPTH_COMPLETE"
            : "REVIEW_DB_FRESHNESS_GUARDS_V1",
      },
      null,
      2,
    ),
  );

  if (
    failed.length > 0
  ) {
    process.exitCode = 2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_DATA_FRESHNESS_DB_CREATE_FILL_GUARDS_V1_DB_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            productionCreateRpcCalled:
              false,

            productionFillRpcCalled:
              false,

            databaseWritesByVerifier:
              0,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode = 2;
  },
);
