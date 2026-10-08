import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  createClient,
} from "@supabase/supabase-js";

const VERSION =
  "ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_INSERT_ONLY";

const PLAN_FILE =
  path.resolve(
    process.cwd(),
    "logs",
    "alpha-v1-controlled-3-stock-daily-bar-backfill-plan.json",
  );

const TARGETS = [
  "005930",
  "035420",
  "035720",
] as const;

const START_DATE =
  "2026-06-01";

const END_DATE =
  "2026-10-02";

const EXPECTED_DESIRED_ROWS =
  255;

const EXPECTED_EXISTING_ROWS_BEFORE =
  222;

const EXPECTED_INSERT_ROWS =
  33;

const EXPECTED_INSERT_ROWS_PER_STOCK =
  11;

const EXPECTED_FINAL_ROWS_PER_STOCK =
  85;

const PRESERVED_CONFLICT_KEY =
  "035720|2026-10-02";

const PRESERVED_CONFLICT_CLOSE =
  33400;

type JsonRecord =
  Record<string, any>;

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

function stableJson(
  value: unknown,
): string {
  if (
    value === null ||
    typeof value !==
      "object"
  ) {
    return JSON.stringify(
      value,
    );
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    return (
      "[" +
      value
        .map(stableJson)
        .join(",") +
      "]"
    );
  }

  const object =
    value as
      Record<
        string,
        unknown
      >;

  return (
    "{" +
    Object.keys(object)
      .sort()
      .map(
        (key) =>
          JSON.stringify(key) +
          ":" +
          stableJson(
            object[key],
          ),
      )
      .join(",") +
    "}"
  );
}

function sha256(
  value: unknown,
) {
  return createHash(
    "sha256",
  )
    .update(
      stableJson(value),
      "utf8",
    )
    .digest(
      "hex",
    );
}

function keyOf(
  row: JsonRecord,
) {
  return (
    `${String(row.stock_code)}|` +
    `${String(row.trading_date)}`
  );
}

function semanticRow(
  row: JsonRecord,
) {
  return {
    stock_code:
      String(
        row.stock_code,
      ),

    trading_date:
      String(
        row.trading_date,
      ),

    open_price:
      Number(
        row.open_price,
      ),

    high_price:
      Number(
        row.high_price,
      ),

    low_price:
      Number(
        row.low_price,
      ),

    close_price:
      Number(
        row.close_price,
      ),

    volume:
      Number(
        row.volume,
      ),

    trading_value:
      Number(
        row.trading_value,
      ),

    source:
      String(
        row.source,
      ),

    adjusted_price:
      row.adjusted_price ===
      true,
  };
}

function sortedSemanticRows(
  rows: JsonRecord[],
) {
  return rows
    .map(
      semanticRow,
    )
    .sort(
      (a, b) =>
        (
          `${a.stock_code}|${a.trading_date}`
        ).localeCompare(
          `${b.stock_code}|${b.trading_date}`,
        ),
    );
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

  if (!url) {
    throw new Error(
      "SUPABASE_URL_ENV_MISSING",
    );
  }

  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY_REQUIRED_FOR_CONTROLLED_APPLY",
    );
  }

  return {
    url,
    key:
      serviceKey,
  };
}

async function readScopeRows(
  supabase:
    ReturnType<
      typeof createClient
    >,
) {
  const result =
    await supabase
      .from(
        "market_daily_bars",
      )
      .select(
        `
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
      .in(
        "stock_code",
        TARGETS as unknown as string[],
      )
      .gte(
        "trading_date",
        START_DATE,
      )
      .lte(
        "trading_date",
        END_DATE,
      )
      .order(
        "stock_code",
        {
          ascending:
            true,
        },
      )
      .order(
        "trading_date",
        {
          ascending:
            true,
        },
      )
      .limit(
        1000,
      );

  if (result.error) {
    throw new Error(
      `MARKET_DAILY_BARS_READ_FAILED:${result.error.message}`,
    );
  }

  return (
    result.data ??
    []
  ) as JsonRecord[];
}

function countByStock(
  rows: JsonRecord[],
) {
  return Object.fromEntries(
    TARGETS.map(
      (stockCode) => [
        stockCode,
        rows.filter(
          (row) =>
            String(
              row.stock_code,
            ) ===
            stockCode,
        ).length,
      ],
    ),
  );
}

function validatePlanRows(
  desiredRows: JsonRecord[],
) {
  if (
    desiredRows.length !==
    EXPECTED_DESIRED_ROWS
  ) {
    throw new Error(
      `DESIRED_ROW_COUNT_MISMATCH:${desiredRows.length}`,
    );
  }

  const keys =
    new Set(
      desiredRows.map(
        keyOf,
      ),
    );

  if (
    keys.size !==
    desiredRows.length
  ) {
    throw new Error(
      "DESIRED_ROWS_CONTAIN_DUPLICATE_KEYS",
    );
  }

  for (
    const row
    of desiredRows
  ) {
    if (
      !TARGETS.includes(
        String(
          row.stock_code,
        ) as
          typeof TARGETS[
            number
          ],
      )
    ) {
      throw new Error(
        `OUT_OF_SCOPE_STOCK:${row.stock_code}`,
      );
    }

    if (
      String(
        row.trading_date,
      ) < START_DATE ||
      String(
        row.trading_date,
      ) > END_DATE
    ) {
      throw new Error(
        `OUT_OF_SCOPE_DATE:${keyOf(row)}`,
      );
    }

    if (
      row.source !==
      "KIS_DAILY_V8_3"
    ) {
      throw new Error(
        `NON_CANONICAL_SOURCE:${keyOf(row)}:${row.source}`,
      );
    }

    if (
      row.adjusted_price !==
      true
    ) {
      throw new Error(
        `NON_ADJUSTED_ROW:${keyOf(row)}`,
      );
    }
  }
}

async function main() {
  if (
    !fs.existsSync(
      PLAN_FILE,
    )
  ) {
    throw new Error(
      `PLAN_FILE_NOT_FOUND:${PLAN_FILE}`,
    );
  }

  const plan =
    readJson(
      PLAN_FILE,
    );

  const desiredRows =
    Array.isArray(
      plan.desiredRows,
    )
      ? (
          plan.desiredRows as
            JsonRecord[]
        )
      : [];

  validatePlanRows(
    desiredRows,
  );

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

  const before =
    await readScopeRows(
      supabase,
    );

  if (
    before.length !==
    EXPECTED_EXISTING_ROWS_BEFORE
  ) {
    throw new Error(
      `PRE_APPLY_EXISTING_ROW_COUNT_CHANGED:${before.length}:EXPECTED_${EXPECTED_EXISTING_ROWS_BEFORE}`,
    );
  }

  const beforeByKey =
    new Map(
      before.map(
        (row) => [
          keyOf(row),
          row,
        ],
      ),
    );

  const preservedConflict =
    beforeByKey.get(
      PRESERVED_CONFLICT_KEY,
    );

  if (
    !preservedConflict
  ) {
    throw new Error(
      `PRESERVED_CONFLICT_ROW_MISSING:${PRESERVED_CONFLICT_KEY}`,
    );
  }

  if (
    Number(
      preservedConflict.close_price,
    ) !==
    PRESERVED_CONFLICT_CLOSE
  ) {
    throw new Error(
      `PRESERVED_CONFLICT_ROW_CHANGED:${preservedConflict.close_price}:EXPECTED_${PRESERVED_CONFLICT_CLOSE}`,
    );
  }

  const missingRows =
    desiredRows.filter(
      (row) =>
        !beforeByKey.has(
          keyOf(row),
        ),
    );

  if (
    missingRows.length !==
    EXPECTED_INSERT_ROWS
  ) {
    throw new Error(
      `MISSING_ROW_COUNT_CHANGED:${missingRows.length}:EXPECTED_${EXPECTED_INSERT_ROWS}`,
    );
  }

  const missingByStock =
    countByStock(
      missingRows,
    );

  for (
    const stockCode
    of TARGETS
  ) {
    if (
      missingByStock[
        stockCode
      ] !==
      EXPECTED_INSERT_ROWS_PER_STOCK
    ) {
      throw new Error(
        `MISSING_ROW_COUNT_PER_STOCK_CHANGED:${stockCode}:${missingByStock[stockCode]}:EXPECTED_${EXPECTED_INSERT_ROWS_PER_STOCK}`,
      );
    }
  }

  const existingFingerprintBefore =
    sha256(
      sortedSemanticRows(
        before,
      ),
    );

  const insertPayload =
    missingRows.map(
      (row) => ({
        stock_code:
          row.stock_code,

        trading_date:
          row.trading_date,

        open_price:
          row.open_price,

        high_price:
          row.high_price,

        low_price:
          row.low_price,

        close_price:
          row.close_price,

        volume:
          row.volume,

        trading_value:
          row.trading_value,

        source:
          row.source,

        adjusted_price:
          row.adjusted_price,

        raw_payload:
          row.raw_payload,

        collected_at:
          row.collected_at,

        updated_at:
          row.updated_at,
      }),
    );

  const insertResult =
    await supabase
      .from(
        "market_daily_bars",
      )
      .insert(
        insertPayload,
      )
      .select(
        "stock_code,trading_date",
      );

  if (
    insertResult.error
  ) {
    throw new Error(
      `INSERT_ONLY_APPLY_FAILED:${insertResult.error.message}`,
    );
  }

  const insertedRows =
    (
      insertResult.data ??
      []
    ) as JsonRecord[];

  if (
    insertedRows.length !==
    EXPECTED_INSERT_ROWS
  ) {
    throw new Error(
      `INSERTED_ROW_COUNT_MISMATCH:${insertedRows.length}:EXPECTED_${EXPECTED_INSERT_ROWS}`,
    );
  }

  const after =
    await readScopeRows(
      supabase,
    );

  const afterByKey =
    new Map(
      after.map(
        (row) => [
          keyOf(row),
          row,
        ],
      ),
    );

  const preservedAfter =
    before.map(
      (row) =>
        afterByKey.get(
          keyOf(row),
        ),
    );

  if (
    preservedAfter.some(
      (row) =>
        !row,
    )
  ) {
    throw new Error(
      "PRE_EXISTING_ROW_DISAPPEARED_AFTER_INSERT",
    );
  }

  const existingFingerprintAfter =
    sha256(
      sortedSemanticRows(
        preservedAfter as
          JsonRecord[],
      ),
    );

  const existingRowsPreserved =
    existingFingerprintBefore ===
    existingFingerprintAfter;

  const finalCounts =
    countByStock(
      after,
    );

  const finalCoverageComplete =
    TARGETS.every(
      (stockCode) =>
        finalCounts[
          stockCode
        ] ===
        EXPECTED_FINAL_ROWS_PER_STOCK,
    );

  const conflictAfter =
    afterByKey.get(
      PRESERVED_CONFLICT_KEY,
    );

  const conflictPreserved =
    Boolean(
      conflictAfter &&
      Number(
        conflictAfter.close_price,
      ) ===
        PRESERVED_CONFLICT_CLOSE &&
      String(
        conflictAfter.source,
      ) ===
        "KIS_DAILY",
    );

  const insertedKeys =
    new Set(
      insertedRows.map(
        keyOf,
      ),
    );

  const allInsertedRowsCanonical =
    after
      .filter(
        (row) =>
          insertedKeys.has(
            keyOf(row),
          ),
      )
      .every(
        (row) =>
          row.source ===
            "KIS_DAILY_V8_3" &&
          row.adjusted_price ===
            true,
      );

  if (
    !existingRowsPreserved ||
    !finalCoverageComplete ||
    !conflictPreserved ||
    !allInsertedRowsCanonical ||
    after.length !==
      EXPECTED_DESIRED_ROWS
  ) {
    throw new Error(
      [
        "POST_APPLY_VERIFICATION_FAILED",
        `existingRowsPreserved=${existingRowsPreserved}`,
        `finalCoverageComplete=${finalCoverageComplete}`,
        `conflictPreserved=${conflictPreserved}`,
        `allInsertedRowsCanonical=${allInsertedRowsCanonical}`,
        `finalRows=${after.length}`,
      ].join(":"),
    );
  }

  const report = {
    status:
      "ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_INSERT_ONLY_COMPLETE",

    version:
      VERSION,

    policy: {
      mode:
        "INSERT_ONLY",

      existingRows:
        "PRESERVE_ALL",

      metadataOnlyRows:
        "PRESERVE",

      providerRevisionConflict:
        "PRESERVE_EXISTING",

      deletes:
        0,

      updates:
        0,
    },

    scope: {
      targets:
        TARGETS,

      startDate:
        START_DATE,

      endDate:
        END_DATE,
    },

    before: {
      rowCount:
        before.length,

      countsByStock:
        countByStock(
          before,
        ),

      existingSemanticFingerprint:
        existingFingerprintBefore,
    },

    apply: {
      requestedInsertRows:
        insertPayload.length,

      insertedRows:
        insertedRows.length,

      insertedRowsByStock:
        missingByStock,

      databaseWriteRequests:
        1,

      updates:
        0,

      deletes:
        0,
    },

    after: {
      rowCount:
        after.length,

      countsByStock:
        finalCounts,

      existingSemanticFingerprintAfter:
        existingFingerprintAfter,

      existingRowsPreserved,

      finalCoverageComplete,

      allInsertedRowsCanonical,

      preservedProviderRevisionConflict: {
        key:
          PRESERVED_CONFLICT_KEY,

        closePrice:
          conflictAfter
            ?.close_price ??
          null,

        source:
          conflictAfter
            ?.source ??
          null,

        preserved:
          conflictPreserved,
      },
    },

    safety: {
      databaseReads:
        2,

      databaseWriteRequests:
        1,

      databaseRowsInserted:
        EXPECTED_INSERT_ROWS,

      databaseRowsUpdated:
        0,

      databaseRowsDeleted:
        0,

      kisRequests:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionTradingDecisionApplied:
        false,
    },

    nextGate:
      "ALPHA_V1_BUILD_DAILY_BAR_ALPHA_PRICE_VOLUME_AND_V7_REGIME_ADAPTERS",
  };

  const outputFile =
    path.resolve(
      process.cwd(),
      "logs",
      "alpha-v1-controlled-3-stock-daily-bar-insert-only-result.json",
    );

  fs.mkdirSync(
    path.dirname(
      outputFile,
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    outputFile,
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
            "ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_INSERT_ONLY_FAILED",

          version:
            VERSION,

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          policy:
            "FAIL_CLOSED_NO_UPDATE_NO_DELETE",

          nextGate:
            "REVIEW_FAILURE_BEFORE_ANY_RETRY",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
