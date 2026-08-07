import {
  createSupabaseServerClient,
} from "@/lib/supabase";

interface MembershipRow {
  universe_code:
    string;

  stock_code:
    string;

  stock_name:
    string;

  market:
    string | null;

  sector:
    string | null;

  security_type:
    string;

  valid_from:
    string;

  valid_to:
    string | null;

  listed:
    boolean;

  tradable:
    boolean;

  pit_eligible:
    boolean;

  evidence_type:
    string;

  source:
    string;

  source_snapshot_id:
    string | null;

  coverage_status:
    string;
}

function getKoreanDate() {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Seoul",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      },
    )
      .formatToParts(
        new Date(),
      );

  const map =
    Object.fromEntries(
      parts.map(
        (part) => [
          part.type,
          part.value,
        ],
      ),
    );

  return `${map.year}-${map.month}-${map.day}`;
}

function normalizeDate(
  value:
    string | undefined,
) {
  const result =
    value ??
    getKoreanDate();

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      result,
    )
  ) {
    throw new Error(
      "INVALID_UNIVERSE_DATE",
    );
  }

  return result;
}

export async function getPointInTimeUniverseV80(
  input: {
    universeCode?:
      string;

    asOfDate?:
      string;

    requirePitEligible?:
      boolean;

    requireTradable?:
      boolean;
  } = {},
) {
  const supabase =
    createSupabaseServerClient();

  const universeCode =
    input
      .universeCode
      ?.trim() ||
    "LEGACY_ACTIVE_STOCKS";

  const asOfDate =
    normalizeDate(
      input.asOfDate,
    );

  const requirePitEligible =
    input
      .requirePitEligible !==
    false;

  const requireTradable =
    input
      .requireTradable !==
    false;

  const {
    data: definition,
    error: definitionError,
  } =
    await supabase
      .from(
        "stock_universe_definitions",
      )
      .select(`
        universe_code,
        display_name,
        description,
        universe_type,
        markets,
        point_in_time_required,
        requires_complete_coverage,
        is_ready,
        metadata
      `)
      .eq(
        "universe_code",
        universeCode,
      )
      .maybeSingle();

  if (
    definitionError
  ) {
    throw new Error(
      `v8.0 universe definition load failed: ${definitionError.message}`,
    );
  }

  if (
    !definition
  ) {
    throw new Error(
      `UNIVERSE_DEFINITION_NOT_FOUND: ${universeCode}`,
    );
  }

  let query =
    supabase
      .from(
        "stock_universe_memberships",
      )
      .select(`
        universe_code,
        stock_code,
        stock_name,
        market,
        sector,
        security_type,
        valid_from,
        valid_to,
        listed,
        tradable,
        pit_eligible,
        evidence_type,
        source,
        source_snapshot_id,
        coverage_status
      `)
      .eq(
        "universe_code",
        universeCode,
      )
      .lte(
        "valid_from",
        asOfDate,
      )
      .or(
        `valid_to.is.null,valid_to.gt.${asOfDate}`,
      );

  if (
    requirePitEligible
  ) {
    query =
      query.eq(
        "pit_eligible",
        true,
      );
  }

  if (
    requireTradable
  ) {
    query =
      query
        .eq(
          "listed",
          true,
        )
        .eq(
          "tradable",
          true,
        );
  }

  const {
    data,
    error,
  } =
    await query
      .order(
        "market",
        {
          ascending:
            true,

          nullsFirst:
            false,
        },
      )
      .order(
        "stock_code",
        {
          ascending:
            true,
        },
      );

  if (
    error
  ) {
    throw new Error(
      `v8.0 universe resolve failed: ${error.message}`,
    );
  }

  const rows =
    (
      data ??
      []
    ) as MembershipRow[];

  const byMarket:
    Record<
      string,
      number
    > = {};

  const coverageStatuses =
    new Set<
      string
    >();

  for (
    const row
    of rows
  ) {
    const market =
      row.market ??
      "UNKNOWN";

    byMarket[market] =
      (
        byMarket[market] ??
        0
      ) +
      1;

    coverageStatuses.add(
      row.coverage_status,
    );
  }

  const completeCoverage =
    rows.length >
      0 &&
    [
      ...coverageStatuses,
    ].every(
      (
        value,
      ) =>
        value ===
        "COMPLETE",
    );

  return {
    version:
      "POINT_IN_TIME_UNIVERSE_RESOLVER_V8_0",

    universeCode,

    asOfDate,

    definition,

    filters: {
      requirePitEligible,
      requireTradable,
    },

    counts: {
      total:
        rows.length,

      byMarket,
    },

    coverage: {
      statuses:
        [
          ...coverageStatuses,
        ].sort(),

      complete:
        completeCoverage,

      satisfiesDefinitionRequirement:
        definition
          .requires_complete_coverage
          ? completeCoverage
          : true,
    },

    members:
      rows,

    safety: {
      usesCurrentStocksTableDirectly:
        false,

      historicalDateResolvedFromMembershipIntervals:
        true,

      futureMembershipCanLeakIntoPast:
        false,

      missingHistoricalCoverageReturnsEmptyRatherThanBackfillingFromToday:
        true,

      productionApplied:
        false,
    },
  };
}
