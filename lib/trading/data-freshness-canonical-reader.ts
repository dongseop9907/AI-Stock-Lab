import type {
  DataFreshnessProductionInput,
} from "./data-freshness-production-contract";

export const DATA_FRESHNESS_CANONICAL_READER_VERSION =
  "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_V1" as const;

export interface FreshnessObservationRow {
  observed_at:
    string | null;

  status:
    string | null;

  usable_for_shadow_comparison:
    boolean | null;

  expected_market_date:
    string | null;

  kospi_latest_date:
    string | null;

  kosdaq_latest_date:
    string | null;

  stock_latest_date:
    string | null;

  oldest_active_stock_latest_date:
    string | null;

  business_weekday_lag:
    number | null;

  index_date_aligned:
    boolean | null;

  all_source_dates_aligned:
    boolean | null;

  production_applied:
    boolean | null;

  created_at:
    string | null;
}

export interface QualityGateObservationRow {
  observed_at:
    string | null;

  status:
    string | null;

  usable_for_forward_shadow:
    boolean | null;

  expected_market_date:
    string | null;

  freshness_status:
    string | null;

  integrity_scan_id:
    string | null;

  integrity_status:
    string | null;

  integrity_window_end_date:
    string | null;

  integrity_finished_at:
    string | null;

  production_applied:
    boolean | null;

  created_at:
    string | null;
}

export interface CanonicalDataFreshnessState
  extends DataFreshnessProductionInput {
  version:
    typeof DATA_FRESHNESS_CANONICAL_READER_VERSION;

  source:
    "MARKET_DATA_OBSERVATIONS";

  freshnessObservedAt:
    string | null;

  qualityObservedAt:
    string | null;

  businessWeekdayLag:
    number | null;

  indexDateAligned:
    boolean | null;

  allSourceDatesAligned:
    boolean | null;

  freshnessUsableForShadowComparison:
    boolean | null;

  qualityUsableForForwardShadow:
    boolean | null;

  freshnessProductionApplied:
    boolean | null;

  qualityProductionApplied:
    boolean | null;

  integrityStatus:
    string | null;

  raw: {
    freshness:
      FreshnessObservationRow;

    quality:
      QualityGateObservationRow;
  };
}

type SupabaseResult<T> = {
  data:
    T | null;

  error:
    {
      message:
        string;
    } | null;
};

type QueryChain<T> = {
  select(
    columns:
      string,
  ): QueryChain<T>;

  order(
    column:
      string,
    options:
      {
        ascending:
          boolean;
      },
  ): QueryChain<T>;

  limit(
    count:
      number,
  ): QueryChain<T>;

  maybeSingle():
    Promise<
      SupabaseResult<T>
    >;
};

export interface DataFreshnessSupabaseLike {
  from<T = unknown>(
    table:
      string,
  ):
    QueryChain<T>;
}

const FRESHNESS_SELECT = [
  "observed_at",
  "status",
  "usable_for_shadow_comparison",
  "expected_market_date",
  "kospi_latest_date",
  "kosdaq_latest_date",
  "stock_latest_date",
  "oldest_active_stock_latest_date",
  "business_weekday_lag",
  "index_date_aligned",
  "all_source_dates_aligned",
  "production_applied",
  "created_at",
].join(",");

const QUALITY_SELECT = [
  "observed_at",
  "status",
  "usable_for_forward_shadow",
  "expected_market_date",
  "freshness_status",
  "integrity_scan_id",
  "integrity_status",
  "integrity_window_end_date",
  "integrity_finished_at",
  "production_applied",
  "created_at",
].join(",");

function normalize(
  value:
    unknown,
): string {
  return String(
    value ?? "",
  )
    .trim()
    .toUpperCase();
}

function deriveFreshnessStatus(
  freshness:
    FreshnessObservationRow,
  quality:
    QualityGateObservationRow,
): string {
  const explicit =
    normalize(
      freshness.status,
    );

  if (
    explicit ===
    "STALE"
  ) {
    return "STALE";
  }

  if (
    freshness.all_source_dates_aligned !==
      true ||
    freshness.index_date_aligned !==
      true
  ) {
    return "DATE_MISMATCH";
  }

  if (
    freshness.expected_market_date &&
    freshness.stock_latest_date &&
    freshness.expected_market_date !==
      freshness.stock_latest_date
  ) {
    return "DATE_MISMATCH";
  }

  const qualityFreshness =
    normalize(
      quality.freshness_status,
    );

  if (
    qualityFreshness ===
    "STALE"
  ) {
    return "STALE";
  }

  if (
    explicit ===
    "FRESH"
  ) {
    return "FRESH";
  }

  return explicit ||
    qualityFreshness ||
    "UNKNOWN";
}

export function buildCanonicalDataFreshnessState(
  freshness:
    FreshnessObservationRow,
  quality:
    QualityGateObservationRow,
): CanonicalDataFreshnessState {
  const freshnessStatus =
    deriveFreshnessStatus(
      freshness,
      quality,
    );

  const qualityStatus =
    normalize(
      quality.status,
    ) || "UNKNOWN";

  const expectedMarketDate =
    quality.expected_market_date ??
    freshness.expected_market_date ??
    null;

  const latestCommonDate =
    freshness.stock_latest_date ??
    null;

  /*
   * production_applied is retained as provenance metadata only.
   * It does not decide data usability. The production read gate is
   * intentionally derived from freshness + alignment + quality.
   */
  const usableForProduction =
    freshnessStatus ===
      "FRESH" &&
    freshness.usable_for_shadow_comparison ===
      true &&
    freshness.index_date_aligned ===
      true &&
    freshness.all_source_dates_aligned ===
      true &&
    Number(
      freshness.business_weekday_lag ??
      Number.POSITIVE_INFINITY,
    ) === 0 &&
    qualityStatus ===
      "PASS" &&
    quality.usable_for_forward_shadow ===
      true &&
    normalize(
      quality.freshness_status,
    ) ===
      "FRESH" &&
    (
      !freshness.expected_market_date ||
      !quality.expected_market_date ||
      freshness.expected_market_date ===
        quality.expected_market_date
    );

  return {
    version:
      DATA_FRESHNESS_CANONICAL_READER_VERSION,

    source:
      "MARKET_DATA_OBSERVATIONS",

    freshnessStatus,

    usableForProduction,

    qualityStatus,

    expectedMarketDate,

    latestCommonDate,

    freshnessObservedAt:
      freshness.observed_at,

    qualityObservedAt:
      quality.observed_at,

    businessWeekdayLag:
      freshness.business_weekday_lag,

    indexDateAligned:
      freshness.index_date_aligned,

    allSourceDatesAligned:
      freshness.all_source_dates_aligned,

    freshnessUsableForShadowComparison:
      freshness.usable_for_shadow_comparison,

    qualityUsableForForwardShadow:
      quality.usable_for_forward_shadow,

    freshnessProductionApplied:
      freshness.production_applied,

    qualityProductionApplied:
      quality.production_applied,

    integrityStatus:
      quality.integrity_status,

    raw: {
      freshness,
      quality,
    },
  };
}

async function readLatestFreshness(
  supabase:
    DataFreshnessSupabaseLike,
): Promise<FreshnessObservationRow> {
  const {
    data,
    error,
  } =
    await supabase
      .from<FreshnessObservationRow>(
        "market_data_freshness_observations",
      )
      .select(
        FRESHNESS_SELECT,
      )
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

  if (
    error ||
    !data
  ) {
    throw new Error(
      "DATA_FRESHNESS_CANONICAL_READER_FAIL_CLOSED:" +
      (
        error?.message ??
        "FRESHNESS_OBSERVATION_MISSING"
      ),
    );
  }

  return data;
}

async function readLatestQualityGate(
  supabase:
    DataFreshnessSupabaseLike,
): Promise<QualityGateObservationRow> {
  const {
    data,
    error,
  } =
    await supabase
      .from<QualityGateObservationRow>(
        "market_data_quality_gate_observations",
      )
      .select(
        QUALITY_SELECT,
      )
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

  if (
    error ||
    !data
  ) {
    throw new Error(
      "DATA_FRESHNESS_CANONICAL_READER_FAIL_CLOSED:" +
      (
        error?.message ??
        "QUALITY_GATE_OBSERVATION_MISSING"
      ),
    );
  }

  return data;
}

export async function readCanonicalDataFreshnessState(
  supabase:
    DataFreshnessSupabaseLike,
): Promise<CanonicalDataFreshnessState> {
  const [
    freshness,
    quality,
  ] =
    await Promise.all([
      readLatestFreshness(
        supabase,
      ),

      readLatestQualityGate(
        supabase,
      ),
    ]);

  return buildCanonicalDataFreshnessState(
    freshness,
    quality,
  );
}
