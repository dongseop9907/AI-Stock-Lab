import {
  createHash,
} from "crypto";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

interface LegacyStockRow {
  stock_code: string;

  stock_name:
    string;

  market:
    string | null;

  sector:
    string | null;

  is_active:
    boolean;

  created_at:
    string;
}

interface OpenMembershipRow {
  id: string;

  stock_code: string;

  valid_from:
    string;
}

function getKoreanDate(
  now =
    new Date(),
) {
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
        now,
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

function normalizeMarket(
  value:
    string | null,
) {
  const normalized =
    (
      value ??
      ""
    )
      .trim()
      .toUpperCase();

  if (
    normalized.includes(
      "KOSDAQ",
    )
  ) {
    return "KOSDAQ";
  }

  if (
    normalized.includes(
      "KOSPI",
    )
  ) {
    return "KOSPI";
  }

  return normalized ||
    null;
}

function normalizeAsOfDate(
  value:
    string | undefined,
) {
  if (
    !value
  ) {
    return getKoreanDate();
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    throw new Error(
      "INVALID_UNIVERSE_AS_OF_DATE",
    );
  }

  return value;
}

function buildFingerprint(
  asOfDate:
    string,

  rows:
    LegacyStockRow[],
) {
  const canonical =
    rows
      .map(
        (row) => ({
          stockCode:
            row.stock_code,

          stockName:
            row.stock_name,

          market:
            normalizeMarket(
              row.market,
            ),

          sector:
            row.sector,
        }),
      )
      .sort(
        (
          left,
          right,
        ) =>
          left.stockCode
            .localeCompare(
              right.stockCode,
            ),
      );

  return createHash(
    "sha256",
  )
    .update(
      JSON.stringify({
        universeCode:
          "LEGACY_ACTIVE_STOCKS",

        asOfDate,

        members:
          canonical,
      }),
    )
    .digest(
      "hex",
    );
}

export async function bootstrapLegacyUniverseV80(
  input: {
    asOfDate?:
      string;
  } = {},
) {
  const supabase =
    createSupabaseServerClient();

  const asOfDate =
    normalizeAsOfDate(
      input.asOfDate,
    );

  const {
    data: stockData,
    error: stockError,
  } =
    await supabase
      .from(
        "stocks",
      )
      .select(`
        stock_code,
        stock_name,
        market,
        sector,
        is_active,
        created_at
      `)
      .eq(
        "is_active",
        true,
      )
      .order(
        "stock_code",
        {
          ascending:
            true,
        },
      );

  if (
    stockError
  ) {
    throw new Error(
      `v8.0 legacy stock load failed: ${stockError.message}`,
    );
  }

  const stocks =
    (
      stockData ??
      []
    ) as LegacyStockRow[];

  if (
    stocks.length ===
      0
  ) {
    return {
      version:
        "POINT_IN_TIME_UNIVERSE_FOUNDATION_V8_0",

      universeCode:
        "LEGACY_ACTIVE_STOCKS",

      asOfDate,

      saved:
        false,

      memberCount:
        0,

      reason:
        "NO_ACTIVE_LEGACY_STOCKS",

      productionApplied:
        false,
    };
  }

  const securities =
    stocks.map(
      (
        stock,
      ) => ({
        stock_code:
          stock.stock_code,

        stock_name:
          stock.stock_name,

        market:
          normalizeMarket(
            stock.market,
          ),

        sector:
          stock.sector,

        security_type:
          "UNKNOWN",

        first_seen_date:
          asOfDate,

        last_seen_date:
          asOfDate,

        source:
          "LEGACY_STOCKS_TABLE",

        source_version:
          "V8_0_BOOTSTRAP",

        metadata: {
          legacyCreatedAt:
            stock.created_at,

          historicalListingDateKnown:
            false,
        },

        updated_at:
          new Date()
            .toISOString(),
      }),
    );

  const {
    error: securityError,
  } =
    await supabase
      .from(
        "stock_universe_securities",
      )
      .upsert(
        securities,
        {
          onConflict:
            "stock_code",
        },
      );

  if (
    securityError
  ) {
    throw new Error(
      `v8.0 security master bootstrap failed: ${securityError.message}`,
    );
  }

  const evidenceFingerprint =
    buildFingerprint(
      asOfDate,
      stocks,
    );

  const {
    data: existingSnapshot,
    error: existingSnapshotError,
  } =
    await supabase
      .from(
        "stock_universe_snapshots",
      )
      .select(
        "id,member_count",
      )
      .eq(
        "evidence_fingerprint",
        evidenceFingerprint,
      )
      .maybeSingle();

  if (
    existingSnapshotError
  ) {
    throw new Error(
      `v8.0 snapshot duplicate check failed: ${existingSnapshotError.message}`,
    );
  }

  let snapshotId:
    string;

  let snapshotSaved:
    boolean;

  if (
    existingSnapshot
  ) {
    snapshotId =
      String(
        existingSnapshot.id,
      );

    snapshotSaved =
      false;
  } else {
    const {
      data: snapshot,
      error: snapshotError,
    } =
      await supabase
        .from(
          "stock_universe_snapshots",
        )
        .insert({
          universe_code:
            "LEGACY_ACTIVE_STOCKS",

          as_of_date:
            asOfDate,

          source:
            "LEGACY_STOCKS_TABLE",

          source_version:
            "V8_0_BOOTSTRAP",

          /*
           * This is intentionally PARTIAL.
           * The legacy stocks table contains only the project's
           * existing research set, not the whole KRX market.
           */
          coverage_status:
            "PARTIAL",

          member_count:
            stocks.length,

          evidence_fingerprint:
            evidenceFingerprint,

          metadata: {
            scope:
              "EXISTING_PROJECT_RESEARCH_SET",

            completeKrxCoverage:
              false,

            historicalBackfill:
              false,
          },

          production_applied:
            false,
        })
        .select(
          "id",
        )
        .single();

    if (
      snapshotError ||
      !snapshot
    ) {
      throw new Error(
        `v8.0 snapshot insert failed: ${
          snapshotError?.message ??
          "NO_SNAPSHOT"
        }`,
      );
    }

    snapshotId =
      String(
        snapshot.id,
      );

    snapshotSaved =
      true;

    const snapshotMembers =
      stocks.map(
        (
          stock,
        ) => ({
          snapshot_id:
            snapshotId,

          stock_code:
            stock.stock_code,

          stock_name:
            stock.stock_name,

          market:
            normalizeMarket(
              stock.market,
            ),

          sector:
            stock.sector,

          security_type:
            "UNKNOWN",

          listed:
            true,

          tradable:
            true,

          flags: {
            legacyIsActive:
              stock.is_active,

            marketCoverage:
              "PARTIAL_RESEARCH_SET",
          },

          source_payload: {
            source:
              "stocks",

            createdAt:
              stock.created_at,
          },
        }),
      );

    const {
      error: snapshotMemberError,
    } =
      await supabase
        .from(
          "stock_universe_snapshot_members",
        )
        .insert(
          snapshotMembers,
        );

    if (
      snapshotMemberError
    ) {
      throw new Error(
        `v8.0 snapshot member insert failed: ${snapshotMemberError.message}`,
      );
    }
  }

  const {
    data: openMembershipData,
    error: openMembershipError,
  } =
    await supabase
      .from(
        "stock_universe_memberships",
      )
      .select(`
        id,
        stock_code,
        valid_from
      `)
      .eq(
        "universe_code",
        "LEGACY_ACTIVE_STOCKS",
      )
      .is(
        "valid_to",
        null,
      );

  if (
    openMembershipError
  ) {
    throw new Error(
      `v8.0 open membership load failed: ${openMembershipError.message}`,
    );
  }

  const openMemberships =
    (
      openMembershipData ??
      []
    ) as OpenMembershipRow[];

  const activeCodes =
    new Set(
      stocks.map(
        (
          stock,
        ) =>
          stock.stock_code,
      ),
    );

  let closedMemberships =
    0;

  for (
    const membership
    of openMemberships
  ) {
    if (
      activeCodes.has(
        membership
          .stock_code,
      )
    ) {
      continue;
    }

    /*
     * A row that started on the same date cannot be closed with
     * valid_to == valid_from because the interval would be empty.
     * In that rare same-day flip, keep the row and wait for the next
     * observed date rather than inventing intraday membership history.
     */
    if (
      membership
        .valid_from >=
      asOfDate
    ) {
      continue;
    }

    const {
      error,
    } =
      await supabase
        .from(
          "stock_universe_memberships",
        )
        .update({
          valid_to:
            asOfDate,

          updated_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          membership.id,
        );

    if (
      error
    ) {
      throw new Error(
        `v8.0 membership close failed (${membership.stock_code}): ${error.message}`,
      );
    }

    closedMemberships +=
      1;
  }

  const openByCode =
    new Set(
      openMemberships.map(
        (
          membership,
        ) =>
          membership
            .stock_code,
      ),
    );

  const newMembershipRows =
    stocks
      .filter(
        (
          stock,
        ) =>
          !openByCode.has(
            stock.stock_code,
          ),
      )
      .map(
        (
          stock,
        ) => ({
          universe_code:
            "LEGACY_ACTIVE_STOCKS",

          stock_code:
            stock.stock_code,

          stock_name:
            stock.stock_name,

          market:
            normalizeMarket(
              stock.market,
            ),

          sector:
            stock.sector,

          security_type:
            "UNKNOWN",

          valid_from:
            asOfDate,

          valid_to:
            null,

          listed:
            true,

          tradable:
            true,

          /*
           * PIT-valid only FROM this observed date forward.
           * We do not backdate membership to stock.created_at
           * or to an assumed listing date.
           */
          pit_eligible:
            true,

          evidence_type:
            "OBSERVED_SNAPSHOT",

          source:
            "LEGACY_STOCKS_TABLE",

          source_version:
            "V8_0_BOOTSTRAP",

          source_snapshot_id:
            snapshotId,

          coverage_status:
            "PARTIAL",

          metadata: {
            completeKrxCoverage:
              false,

            historicalMembershipBeforeValidFromKnown:
              false,
          },
        }),
      );

  if (
    newMembershipRows.length >
      0
  ) {
    const {
      error: membershipInsertError,
    } =
      await supabase
        .from(
          "stock_universe_memberships",
        )
        .insert(
          newMembershipRows,
        );

    if (
      membershipInsertError
    ) {
      throw new Error(
        `v8.0 membership insert failed: ${membershipInsertError.message}`,
      );
    }
  }

  return {
    version:
      "POINT_IN_TIME_UNIVERSE_FOUNDATION_V8_0",

    universeCode:
      "LEGACY_ACTIVE_STOCKS",

    asOfDate,

    snapshotId,

    snapshotSaved,

    coverageStatus:
      "PARTIAL",

    completeKrxCoverage:
      false,

    memberCount:
      stocks.length,

    openedMemberships:
      newMembershipRows.length,

    closedMemberships,

    historicalBackfillPerformed:
      false,

    warning:
      "LEGACY_ACTIVE_STOCKS is only the existing project research set. Do not treat it as the historical KOSPI/KOSDAQ universe.",

    productionApplied:
      false,
  };
}
