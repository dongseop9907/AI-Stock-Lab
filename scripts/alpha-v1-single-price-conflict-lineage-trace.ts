import fs from "node:fs";
import path from "node:path";

import {
  createClient,
} from "@supabase/supabase-js";

const VERSION =
  "ALPHA_V1_SINGLE_PRICE_CONFLICT_LINEAGE_TRACE";

const ANALYSIS_FILE =
  path.resolve(
    process.cwd(),
    "logs",
    "alpha-v1-controlled-3-stock-daily-bar-backfill-conflict-analysis.json",
  );

const PLAN_FILE =
  path.resolve(
    process.cwd(),
    "logs",
    "alpha-v1-controlled-3-stock-daily-bar-backfill-plan.json",
  );

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs",
    "alpha-v1-single-price-conflict-lineage-trace.json",
  );

function readJson(
  file: string,
) {
  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8",
    ),
  );
}

function asNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function resolveSupabaseConfig() {
  const url =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL ??
    process.env
      .SUPABASE_URL;

  const serviceKey =
    process.env
      .SUPABASE_SERVICE_ROLE_KEY ??
    process.env
      .SUPABASE_SERVICE_KEY;

  const anonKey =
    process.env
      .NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env
      .SUPABASE_ANON_KEY;

  const key =
    serviceKey ??
    anonKey;

  if (!url) {
    throw new Error(
      "SUPABASE_URL_ENV_MISSING",
    );
  }

  if (!key) {
    throw new Error(
      "SUPABASE_KEY_ENV_MISSING",
    );
  }

  return {
    url,
    key,
    authMode:
      serviceKey
        ? "SERVICE_ROLE"
        : "ANON",
  };
}

function rawPayloadSummary(
  payload: unknown,
) {
  if (
    !payload ||
    typeof payload !==
      "object"
  ) {
    return null;
  }

  const row =
    payload as
    Record<string, unknown>;

  return {
    stck_bsop_date:
      row.stck_bsop_date ??
      null,

    stck_oprc:
      asNumber(
        row.stck_oprc,
      ),

    stck_hgpr:
      asNumber(
        row.stck_hgpr,
      ),

    stck_lwpr:
      asNumber(
        row.stck_lwpr,
      ),

    stck_clpr:
      asNumber(
        row.stck_clpr,
      ),

    acml_vol:
      asNumber(
        row.acml_vol,
      ),

    acml_tr_pbmn:
      asNumber(
        row.acml_tr_pbmn,
      ),

    mod_yn:
      row.mod_yn ??
      null,

    prdy_vrss:
      row.prdy_vrss ??
      null,

    prdy_vrss_sign:
      row.prdy_vrss_sign ??
      null,

    revl_issu_reas:
      row.revl_issu_reas ??
      null,
  };
}

async function main() {
  if (
    !fs.existsSync(
      ANALYSIS_FILE,
    )
  ) {
    throw new Error(
      `ANALYSIS_FILE_NOT_FOUND:${ANALYSIS_FILE}`,
    );
  }

  if (
    !fs.existsSync(
      PLAN_FILE,
    )
  ) {
    throw new Error(
      `PLAN_FILE_NOT_FOUND:${PLAN_FILE}`,
    );
  }

  const analysis =
    readJson(
      ANALYSIS_FILE,
    );

  const plan =
    readJson(
      PLAN_FILE,
    );

  const conflicts =
    Array.isArray(
      analysis.allConflicts,
    )
      ? analysis.allConflicts
      : [];

  const priceConflicts =
    conflicts.filter(
      (
        row:
        Record<string, unknown>,
      ) =>
        row.category ===
          "PRICE_VALUE_DIFFERENCE",
    );

  if (
    priceConflicts.length !==
    1
  ) {
    throw new Error(
      `EXPECTED_EXACTLY_ONE_PRICE_CONFLICT_GOT_${priceConflicts.length}`,
    );
  }

  const conflict =
    priceConflicts[0] as
      Record<string, any>;

  const key =
    String(
      conflict.key,
    );

  const [
    stockCode,
    tradingDate,
  ] =
    key.split("|");

  if (
    !stockCode ||
    !tradingDate
  ) {
    throw new Error(
      `INVALID_CONFLICT_KEY:${key}`,
    );
  }

  const desiredRows =
    Array.isArray(
      plan.desiredRows,
    )
      ? plan.desiredRows
      : [];

  const desiredRow =
    desiredRows.find(
      (
        row:
        Record<string, unknown>,
      ) =>
        String(
          row.stock_code,
        ) ===
          stockCode &&
        String(
          row.trading_date,
        ) ===
          tradingDate,
    );

  if (!desiredRow) {
    throw new Error(
      `DESIRED_ROW_NOT_FOUND:${key}`,
    );
  }

  const config =
    resolveSupabaseConfig();

  const supabase =
    createClient(
      config.url,
      config.key,
      {
        auth: {
          persistSession:
            false,

          autoRefreshToken:
            false,
        },
      },
    );

  const result =
    await supabase
      .from(
        "market_daily_bars",
      )
      .select(
        `
          id,
          stock_code,
          trading_date,
          open_price,
          high_price,
          low_price,
          close_price,
          volume,
          trading_value,
          source,
          adjusted_price,
          raw_payload,
          collected_at,
          created_at,
          updated_at
        `,
      )
      .eq(
        "stock_code",
        stockCode,
      )
      .eq(
        "trading_date",
        tradingDate,
      );

  if (result.error) {
    throw new Error(
      `CONFLICT_ROW_READ_FAILED:${result.error.message}`,
    );
  }

  const dbRows =
    result.data ??
    [];

  const existingRow =
    dbRows[0] ??
    null;

  const existingClose =
    existingRow
      ? asNumber(
          existingRow
            .close_price,
        )
      : null;

  const desiredClose =
    asNumber(
      desiredRow
        .close_price,
    );

  const existingRaw =
    rawPayloadSummary(
      existingRow
        ?.raw_payload,
    );

  const desiredRaw =
    rawPayloadSummary(
      desiredRow
        .raw_payload,
    );

  const dbColumnMatchesDbRaw =
    existingClose !==
      null &&
    existingRaw
      ?.stck_clpr !==
      null &&
    existingClose ===
      existingRaw
        ?.stck_clpr;

  const desiredColumnMatchesDesiredRaw =
    desiredClose !==
      null &&
    desiredRaw
      ?.stck_clpr !==
      null &&
    desiredClose ===
      desiredRaw
        ?.stck_clpr;

  const rawProviderCloseChanged =
    existingRaw
      ?.stck_clpr !==
      null &&
    desiredRaw
      ?.stck_clpr !==
      null &&
    existingRaw
      ?.stck_clpr !==
      desiredRaw
        ?.stck_clpr;

  let interpretation:
    Record<
      string,
      unknown
    >;

  if (
    dbColumnMatchesDbRaw &&
    desiredColumnMatchesDesiredRaw &&
    rawProviderCloseChanged
  ) {
    interpretation = {
      classification:
        "KIS_PROVIDER_HISTORY_VALUE_CHANGED_BETWEEN_COLLECTIONS",

      existingRowInternallyConsistent:
        true,

      desiredRowInternallyConsistent:
        true,

      safeToBlindOverwrite:
        false,

      recommendedPolicy:
        "PRESERVE_EXISTING_ROW_AND_INSERT_ONLY_MISSING_ROWS_UNTIL_PROVIDER_REVISION_POLICY_IS_EXPLICIT",
    };
  } else if (
    !dbColumnMatchesDbRaw &&
    desiredColumnMatchesDesiredRaw
  ) {
    interpretation = {
      classification:
        "EXISTING_DB_COLUMN_RAW_PAYLOAD_INCONSISTENCY",

      existingRowInternallyConsistent:
        false,

      desiredRowInternallyConsistent:
        true,

      safeToBlindOverwrite:
        false,

      recommendedPolicy:
        "REVIEW_EXISTING_DB_CORRUPTION_OR_LEGACY_TRANSFORM_BEFORE_REPAIR",
    };
  } else if (
    dbColumnMatchesDbRaw &&
    !desiredColumnMatchesDesiredRaw
  ) {
    interpretation = {
      classification:
        "DESIRED_PLAN_CONVERSION_INCONSISTENCY",

      existingRowInternallyConsistent:
        true,

      desiredRowInternallyConsistent:
        false,

      safeToBlindOverwrite:
        false,

      recommendedPolicy:
        "FIX_PLAN_CONVERSION_DO_NOT_WRITE",
    };
  } else {
    interpretation = {
      classification:
        "UNRESOLVED_SINGLE_ROW_CONFLICT",

      existingRowInternallyConsistent:
        dbColumnMatchesDbRaw,

      desiredRowInternallyConsistent:
        desiredColumnMatchesDesiredRaw,

      safeToBlindOverwrite:
        false,

      recommendedPolicy:
        "DO_NOT_WRITE_CONFLICTING_ROW",
    };
  }

  const report = {
    status:
      "ALPHA_V1_SINGLE_PRICE_CONFLICT_LINEAGE_TRACE_COMPLETE",

    version:
      VERSION,

    authMode:
      config.authMode,

    conflictKey:
      key,

    stockCode,
    tradingDate,

    classifierConflict: {
      differingFields:
        conflict
          .differingFields ??
        null,

      existingSemantic:
        conflict.existing ??
        null,

      desiredSemantic:
        conflict.desired ??
        null,
    },

    database: {
      rowCount:
        dbRows.length,

      row:
        existingRow
          ? {
              id:
                existingRow.id,

              stock_code:
                existingRow
                  .stock_code,

              trading_date:
                existingRow
                  .trading_date,

              open_price:
                asNumber(
                  existingRow
                    .open_price,
                ),

              high_price:
                asNumber(
                  existingRow
                    .high_price,
                ),

              low_price:
                asNumber(
                  existingRow
                    .low_price,
                ),

              close_price:
                existingClose,

              volume:
                asNumber(
                  existingRow
                    .volume,
                ),

              trading_value:
                asNumber(
                  existingRow
                    .trading_value,
                ),

              source:
                existingRow
                  .source,

              adjusted_price:
                existingRow
                  .adjusted_price,

              collected_at:
                existingRow
                  .collected_at,

              created_at:
                existingRow
                  .created_at,

              updated_at:
                existingRow
                  .updated_at,

              rawPayload:
                existingRaw,
            }
          : null,
    },

    desiredFromPlan: {
      stock_code:
        desiredRow
          .stock_code,

      trading_date:
        desiredRow
          .trading_date,

      open_price:
        asNumber(
          desiredRow
            .open_price,
        ),

      high_price:
        asNumber(
          desiredRow
            .high_price,
        ),

      low_price:
        asNumber(
          desiredRow
            .low_price,
        ),

      close_price:
        desiredClose,

      volume:
        asNumber(
          desiredRow
            .volume,
        ),

      trading_value:
        asNumber(
          desiredRow
            .trading_value,
        ),

      source:
        desiredRow
          .source,

      adjusted_price:
        desiredRow
          .adjusted_price,

      collected_at:
        desiredRow
          .collected_at,

      updated_at:
        desiredRow
          .updated_at,

      rawPayload:
        desiredRaw,
    },

    consistency: {
      dbColumnMatchesDbRaw,
      desiredColumnMatchesDesiredRaw,
      rawProviderCloseChanged,

      closeDifference:
        existingClose !==
          null &&
        desiredClose !==
          null
          ? desiredClose -
            existingClose
          : null,

      closeDifferenceRate:
        existingClose !==
          null &&
        desiredClose !==
          null &&
        existingClose !==
          0
          ? (
              desiredClose -
              existingClose
            ) /
            existingClose
          : null,
    },

    interpretation,

    safeApplyPolicyCandidate: {
      missingRowsOnly:
        true,

      metadataOnlyExistingRows:
        "PRESERVE",

      conflictingExistingRow:
        "PRESERVE_PENDING_EXPLICIT_PROVIDER_REVISION_POLICY",

      deletes:
        0,

      overwrites:
        0,

      expectedInsertRows:
        plan.plan
          ?.insertCount ??
        null,
    },

    safety: {
      databaseReads:
        1,

      databaseWrites:
        0,

      networkRequests:
        1,

      kisRequests:
        0,

      deletes:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionDecisionApplied:
        false,
    },

    nextGate:
      "ALPHA_V1_DECIDE_INSERT_ONLY_33_ROWS_AFTER_SINGLE_CONFLICT_LINEAGE_REVIEW",
  };

  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE,
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      report,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V1_SINGLE_PRICE_CONFLICT_LINEAGE_TRACE_FAILED",

          version:
            VERSION,

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          safety: {
            databaseWrites:
              0,

            kisRequests:
              0,

            ordersCreated:
              0,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
