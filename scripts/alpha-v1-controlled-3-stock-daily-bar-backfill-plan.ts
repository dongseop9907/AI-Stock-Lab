import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import {
  getDomesticDailyStockPrices,
  getKisAccessToken,
  type KisDomesticDailyPriceOutput,
} from "../lib/kis/client";

const VERSION =
  "ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_BACKFILL_PLAN";

const TARGETS = [
  "005930",
  "035420",
  "035720",
];

const START_DATE =
  "20260601";

const END_DATE =
  "20261002";

const START_SQL_DATE =
  "2026-06-01";

const END_SQL_DATE =
  "2026-10-02";

const EXPECTED_ROWS_PER_STOCK =
  85;

const EXPECTED_TOTAL_ROWS =
  EXPECTED_ROWS_PER_STOCK *
  TARGETS.length;

const REQUEST_DELAY_MS =
  1200;

type JsonRecord =
  Record<string, unknown>;

interface DesiredBar {
  stock_code: string;
  trading_date: string;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  volume: number;
  trading_value: number;
  source: "KIS_DAILY_V8_3";
  adjusted_price: true;
  raw_payload: KisDomesticDailyPriceOutput;
  collected_at: string;
  updated_at: string;
}

function sleep(
  milliseconds: number,
) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

function toNumber(
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

function compactDateToSql(
  value: string,
): string | null {
  if (!/^\d{8}$/.test(value)) {
    return null;
  }

  return (
    `${value.slice(0, 4)}-` +
    `${value.slice(4, 6)}-` +
    `${value.slice(6, 8)}`
  );
}

function validateOhlc(
  open: number,
  high: number,
  low: number,
  close: number,
) {
  return (
    high >= low &&
    open <= high &&
    open >= low &&
    close <= high &&
    close >= low &&
    open > 0 &&
    high > 0 &&
    low > 0 &&
    close > 0
  );
}

function convertDailyBar(
  stockCode: string,
  row: KisDomesticDailyPriceOutput,
  collectedAt: string,
): DesiredBar | null {
  const open =
    toNumber(row.stck_oprc);

  const high =
    toNumber(row.stck_hgpr);

  const low =
    toNumber(row.stck_lwpr);

  const close =
    toNumber(row.stck_clpr);

  const volume =
    toNumber(row.acml_vol);

  const tradingValue =
    toNumber(
      row.acml_tr_pbmn,
    );

  const tradingDate =
    compactDateToSql(
      String(
        row.stck_bsop_date ??
        "",
      ),
    );

  if (
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null ||
    tradingValue === null ||
    tradingDate === null
  ) {
    return null;
  }

  if (
    !validateOhlc(
      open,
      high,
      low,
      close,
    )
  ) {
    return null;
  }

  if (
    volume < 0 ||
    tradingValue < 0
  ) {
    return null;
  }

  return {
    stock_code:
      stockCode,

    trading_date:
      tradingDate,

    open_price:
      open,

    high_price:
      high,

    low_price:
      low,

    close_price:
      close,

    volume,

    trading_value:
      tradingValue,

    source:
      "KIS_DAILY_V8_3",

    adjusted_price:
      true,

    raw_payload:
      row,

    collected_at:
      collectedAt,

    updated_at:
      collectedAt,
  };
}

function semanticRow(
  row: JsonRecord,
) {
  return {
    stock_code:
      String(
        row.stock_code ??
        "",
      ),

    trading_date:
      String(
        row.trading_date ??
        "",
      ),

    open_price:
      toNumber(
        row.open_price,
      ),

    high_price:
      toNumber(
        row.high_price,
      ),

    low_price:
      toNumber(
        row.low_price,
      ),

    close_price:
      toNumber(
        row.close_price,
      ),

    volume:
      toNumber(
        row.volume,
      ),

    trading_value:
      toNumber(
        row.trading_value,
      ),

    source:
      String(
        row.source ??
        "",
      ),

    adjusted_price:
      row.adjusted_price ===
      true,
  };
}

function desiredSemanticRow(
  row: DesiredBar,
) {
  return {
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
  };
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
    Record<string, unknown>;

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

async function readExistingRows(
  supabase: SupabaseClient,
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
        TARGETS,
      )
      .gte(
        "trading_date",
        START_SQL_DATE,
      )
      .lte(
        "trading_date",
        END_SQL_DATE,
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

async function fetchDesiredRows() {
  const accessToken =
    await getKisAccessToken();

  const rows:
    DesiredBar[] = [];

  const perStock:
    Array<Record<string, unknown>> =
    [];

  for (
    let index = 0;
    index < TARGETS.length;
    index += 1
  ) {
    const stockCode =
      TARGETS[index];

    const response =
      await getDomesticDailyStockPrices(
        {
          stockCode,

          startDate:
            START_DATE,

          endDate:
            END_DATE,

          period:
            "D",

          adjustedPrice:
            true,
        },
        accessToken,
      );

    const rawRows =
      response.output2 ??
      [];

    const collectedAt =
      new Date()
        .toISOString();

    const converted =
      rawRows
        .map(
          (row) =>
            convertDailyBar(
              stockCode,
              row,
              collectedAt,
            ),
        )
        .filter(
          (
            row,
          ): row is DesiredBar =>
            row !== null,
        )
        .filter(
          (row) =>
            row.trading_date >=
              START_SQL_DATE &&
            row.trading_date <=
              END_SQL_DATE,
        );

    const uniqueDates =
      new Set(
        converted.map(
          (row) =>
            row.trading_date,
        ),
      );

    perStock.push({
      stockCode,

      providerStatus:
        response.rt_cd,

      providerMessageCode:
        response.msg_cd,

      providerMessage:
        response.msg1,

      receivedRows:
        rawRows.length,

      validConvertedRows:
        converted.length,

      uniqueDateCount:
        uniqueDates.size,

      duplicateDateCount:
        converted.length -
        uniqueDates.size,

      latestDate:
        converted
          .map(
            (row) =>
              row.trading_date,
          )
          .sort()
          .at(-1) ??
        null,

      oldestDate:
        converted
          .map(
            (row) =>
              row.trading_date,
          )
          .sort()
          .at(0) ??
        null,

      expectedRowCount:
        EXPECTED_ROWS_PER_STOCK,

      exactExpectedCount:
        converted.length ===
          EXPECTED_ROWS_PER_STOCK &&
        uniqueDates.size ===
          EXPECTED_ROWS_PER_STOCK,
    });

    rows.push(
      ...converted,
    );

    if (
      index <
      TARGETS.length - 1
    ) {
      await sleep(
        REQUEST_DELAY_MS,
      );
    }
  }

  rows.sort(
    (a, b) =>
      a.stock_code.localeCompare(
        b.stock_code,
      ) ||
      a.trading_date.localeCompare(
        b.trading_date,
      ),
  );

  return {
    rows,
    perStock,
  };
}

async function main() {
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

  const existingRows =
    await readExistingRows(
      supabase,
    );

  const desired =
    await fetchDesiredRows();

  const existingByKey =
    new Map(
      existingRows.map(
        (row) => [
          `${String(row.stock_code)}|${String(row.trading_date)}`,
          row,
        ],
      ),
    );

  let insertCount = 0;
  let noopCount = 0;
  let updateCount = 0;

  const conflicts:
    Array<Record<string, unknown>> =
    [];

  const actions =
    desired.rows.map(
      (row) => {
        const key =
          `${row.stock_code}|${row.trading_date}`;

        const existing =
          existingByKey.get(
            key,
          );

        if (!existing) {
          insertCount += 1;

          return {
            key,
            action:
              "INSERT",
          };
        }

        const existingSemantic =
          semanticRow(
            existing,
          );

        const desiredSemantic =
          desiredSemanticRow(
            row,
          );

        const equal =
          stableJson(
            existingSemantic,
          ) ===
          stableJson(
            desiredSemantic,
          );

        if (equal) {
          noopCount += 1;

          return {
            key,
            action:
              "NOOP_IDENTICAL",
          };
        }

        updateCount += 1;

        conflicts.push({
          key,

          existing:
            existingSemantic,

          desired:
            desiredSemantic,
        });

        return {
          key,
          action:
            "UPDATE_SEMANTIC_DIFFERENCE",
        };
      },
    );

  const duplicateDesiredKeys =
    desired.rows.length -
    new Set(
      desired.rows.map(
        (row) =>
          `${row.stock_code}|${row.trading_date}`,
      ),
    ).size;

  const allProviderCountsExact =
    desired.perStock.every(
      (row) =>
        row.exactExpectedCount ===
        true,
    );

  const allAdjusted =
    desired.rows.every(
      (row) =>
        row.adjusted_price ===
        true,
    );

  const allSourceCanonical =
    desired.rows.every(
      (row) =>
        row.source ===
        "KIS_DAILY_V8_3",
    );

  const safeToApply =
    desired.rows.length ===
      EXPECTED_TOTAL_ROWS &&
    duplicateDesiredKeys ===
      0 &&
    allProviderCountsExact &&
    allAdjusted &&
    allSourceCanonical &&
    updateCount ===
      0;

  const desiredSemanticManifest =
    desired.rows.map(
      desiredSemanticRow,
    );

  const report = {
    status:
      safeToApply
        ? "ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_BACKFILL_PLAN_READY"
        : "ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_BACKFILL_PLAN_REVIEW_REQUIRED",

    version:
      VERSION,

    authMode:
      config.authMode,

    scope: {
      targets:
        TARGETS,

      startDate:
        START_SQL_DATE,

      endDate:
        END_SQL_DATE,

      canonicalSource:
        "KIS_DAILY_V8_3",

      adjustedPrice:
        true,

      kisMode:
        "FID_ORG_ADJ_PRC=0",

      conflictKey:
        "stock_code,trading_date",

      writePolicy:
        "UPSERT_ONLY_NO_DELETE",
    },

    expected: {
      rowsPerStock:
        EXPECTED_ROWS_PER_STOCK,

      totalRows:
        EXPECTED_TOTAL_ROWS,
    },

    provider:
      desired.perStock,

    databaseBefore: {
      existingRowsInScope:
        existingRows.length,
    },

    plan: {
      desiredRows:
        desired.rows.length,

      insertCount,

      noopIdenticalCount:
        noopCount,

      semanticUpdateCount:
        updateCount,

      duplicateDesiredKeys,

      safeToApply,

      applyWouldPerformDeletes:
        false,

      applyWouldTouchOnlyTargets:
        true,
    },

    semanticConflicts:
      conflicts,

    actions,

    fingerprints: {
      desiredSemanticFingerprint:
        sha256(
          desiredSemanticManifest,
        ),

      existingSemanticFingerprint:
        sha256(
          existingRows
            .map(
              semanticRow,
            )
            .sort(
              (a, b) =>
                `${a.stock_code}|${a.trading_date}`
                  .localeCompare(
                    `${b.stock_code}|${b.trading_date}`,
                  ),
            ),
        ),
    },

    desiredRows:
      desired.rows,

    safety: {
      databaseReads:
        1,

      databaseWrites:
        0,

      kisDailyRequests:
        TARGETS.length,

      tokenRequest:
        "GET_KIS_ACCESS_TOKEN_MAY_ISSUE_ONE_TOKEN_REQUEST",

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionDecisionApplied:
        false,
    },

    nextGate:
      safeToApply
        ? "ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_BACKFILL_APPLY_UPSERT_ONLY"
        : "REVIEW_BACKFILL_PLAN_BEFORE_ANY_WRITE",
  };

  const outputFile =
    path.resolve(
      process.cwd(),
      "logs",
      "alpha-v1-controlled-3-stock-daily-bar-backfill-plan.json",
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
      {
        status:
          report.status,

        version:
          report.version,

        scope:
          report.scope,

        provider:
          report.provider,

        databaseBefore:
          report.databaseBefore,

        plan:
          report.plan,

        fingerprints:
          report.fingerprints,

        semanticConflictCount:
          report.semanticConflicts
            .length,

        safety:
          report.safety,

        nextGate:
          report.nextGate,

        outputFile:
          "logs/alpha-v1-controlled-3-stock-daily-bar-backfill-plan.json",
      },
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
            "ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_BACKFILL_PLAN_FAILED",

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

            ordersCreated:
              0,

            productionDecisionApplied:
              false,
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
