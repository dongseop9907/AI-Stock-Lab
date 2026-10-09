export interface PaperExecutionRealismV2MarketInput {
  intervalVolume: number | null;
  latestObservedAt: string | null;
  previousObservedAt: string | null;
  source:
    | "MARKET_SNAPSHOT_VOLUME_DELTA"
    | "NO_USABLE_VOLUME_DELTA"
    | "MARKET_SNAPSHOT_READ_FAILED";
}

function toFiniteNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

export async function resolvePaperExecutionRealismV2MarketInput(
  input: {
    supabase: any;
    stockCode: string;
    observedAt: string;
  },
): Promise<PaperExecutionRealismV2MarketInput> {
  const {
    data,
    error,
  } =
    await input.supabase
      .from("market_snapshots")
      .select(
        "observed_at,volume",
      )
      .eq(
        "stock_code",
        input.stockCode,
      )
      .lte(
        "observed_at",
        input.observedAt,
      )
      .order(
        "observed_at",
        {
          ascending: false,
        },
      )
      .limit(2);

  if (error) {
    return {
      intervalVolume: null,
      latestObservedAt: null,
      previousObservedAt: null,
      source:
        "MARKET_SNAPSHOT_READ_FAILED",
    };
  }

  const rows =
    (data ?? []) as Array<{
      observed_at:
        | string
        | null;
      volume:
        | number
        | string
        | null;
    }>;

  const latest =
    rows[0] ?? null;

  const previous =
    rows[1] ?? null;

  const latestVolume =
    toFiniteNumber(
      latest?.volume,
    );

  const previousVolume =
    toFiniteNumber(
      previous?.volume,
    );

  if (
    latestVolume === null ||
    previousVolume === null
  ) {
    return {
      intervalVolume: null,
      latestObservedAt:
        latest?.observed_at ??
        null,
      previousObservedAt:
        previous?.observed_at ??
        null,
      source:
        "NO_USABLE_VOLUME_DELTA",
    };
  }

  const delta =
    latestVolume -
    previousVolume;

  return {
    intervalVolume:
      delta >= 0
        ? delta
        : null,
    latestObservedAt:
      latest?.observed_at ??
      null,
    previousObservedAt:
      previous?.observed_at ??
      null,
    source:
      delta >= 0
        ? "MARKET_SNAPSHOT_VOLUME_DELTA"
        : "NO_USABLE_VOLUME_DELTA",
  };
}
