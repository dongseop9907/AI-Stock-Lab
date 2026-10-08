#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_BACKFILL_PLAN_INSTALLER';

const script =
  'import fs from "node:fs";\nimport path from "node:path";\nimport { createHash } from "node:crypto";\n\nimport {\n  createClient,\n  type SupabaseClient,\n} from "@supabase/supabase-js";\n\nimport {\n  getDomesticDailyStockPrices,\n  getKisAccessToken,\n  type KisDomesticDailyPriceOutput,\n} from "../lib/kis/client";\n\nconst VERSION =\n  "ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_BACKFILL_PLAN";\n\nconst TARGETS = [\n  "005930",\n  "035420",\n  "035720",\n];\n\nconst START_DATE =\n  "20260601";\n\nconst END_DATE =\n  "20261002";\n\nconst START_SQL_DATE =\n  "2026-06-01";\n\nconst END_SQL_DATE =\n  "2026-10-02";\n\nconst EXPECTED_ROWS_PER_STOCK =\n  85;\n\nconst EXPECTED_TOTAL_ROWS =\n  EXPECTED_ROWS_PER_STOCK *\n  TARGETS.length;\n\nconst REQUEST_DELAY_MS =\n  1200;\n\ntype JsonRecord =\n  Record<string, unknown>;\n\ninterface DesiredBar {\n  stock_code: string;\n  trading_date: string;\n  open_price: number;\n  high_price: number;\n  low_price: number;\n  close_price: number;\n  volume: number;\n  trading_value: number;\n  source: "KIS_DAILY_V8_3";\n  adjusted_price: true;\n  raw_payload: KisDomesticDailyPriceOutput;\n  collected_at: string;\n  updated_at: string;\n}\n\nfunction sleep(\n  milliseconds: number,\n) {\n  return new Promise(\n    (resolve) => {\n      setTimeout(\n        resolve,\n        milliseconds,\n      );\n    },\n  );\n}\n\nfunction toNumber(\n  value: unknown,\n): number | null {\n  if (\n    value === null ||\n    value === undefined\n  ) {\n    return null;\n  }\n\n  const parsed =\n    Number(value);\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : null;\n}\n\nfunction compactDateToSql(\n  value: string,\n): string | null {\n  if (!/^\\d{8}$/.test(value)) {\n    return null;\n  }\n\n  return (\n    `${value.slice(0, 4)}-` +\n    `${value.slice(4, 6)}-` +\n    `${value.slice(6, 8)}`\n  );\n}\n\nfunction validateOhlc(\n  open: number,\n  high: number,\n  low: number,\n  close: number,\n) {\n  return (\n    high >= low &&\n    open <= high &&\n    open >= low &&\n    close <= high &&\n    close >= low &&\n    open > 0 &&\n    high > 0 &&\n    low > 0 &&\n    close > 0\n  );\n}\n\nfunction convertDailyBar(\n  stockCode: string,\n  row: KisDomesticDailyPriceOutput,\n  collectedAt: string,\n): DesiredBar | null {\n  const open =\n    toNumber(row.stck_oprc);\n\n  const high =\n    toNumber(row.stck_hgpr);\n\n  const low =\n    toNumber(row.stck_lwpr);\n\n  const close =\n    toNumber(row.stck_clpr);\n\n  const volume =\n    toNumber(row.acml_vol);\n\n  const tradingValue =\n    toNumber(\n      row.acml_tr_pbmn,\n    );\n\n  const tradingDate =\n    compactDateToSql(\n      String(\n        row.stck_bsop_date ??\n        "",\n      ),\n    );\n\n  if (\n    open === null ||\n    high === null ||\n    low === null ||\n    close === null ||\n    volume === null ||\n    tradingValue === null ||\n    tradingDate === null\n  ) {\n    return null;\n  }\n\n  if (\n    !validateOhlc(\n      open,\n      high,\n      low,\n      close,\n    )\n  ) {\n    return null;\n  }\n\n  if (\n    volume < 0 ||\n    tradingValue < 0\n  ) {\n    return null;\n  }\n\n  return {\n    stock_code:\n      stockCode,\n\n    trading_date:\n      tradingDate,\n\n    open_price:\n      open,\n\n    high_price:\n      high,\n\n    low_price:\n      low,\n\n    close_price:\n      close,\n\n    volume,\n\n    trading_value:\n      tradingValue,\n\n    source:\n      "KIS_DAILY_V8_3",\n\n    adjusted_price:\n      true,\n\n    raw_payload:\n      row,\n\n    collected_at:\n      collectedAt,\n\n    updated_at:\n      collectedAt,\n  };\n}\n\nfunction semanticRow(\n  row: JsonRecord,\n) {\n  return {\n    stock_code:\n      String(\n        row.stock_code ??\n        "",\n      ),\n\n    trading_date:\n      String(\n        row.trading_date ??\n        "",\n      ),\n\n    open_price:\n      toNumber(\n        row.open_price,\n      ),\n\n    high_price:\n      toNumber(\n        row.high_price,\n      ),\n\n    low_price:\n      toNumber(\n        row.low_price,\n      ),\n\n    close_price:\n      toNumber(\n        row.close_price,\n      ),\n\n    volume:\n      toNumber(\n        row.volume,\n      ),\n\n    trading_value:\n      toNumber(\n        row.trading_value,\n      ),\n\n    source:\n      String(\n        row.source ??\n        "",\n      ),\n\n    adjusted_price:\n      row.adjusted_price ===\n      true,\n  };\n}\n\nfunction desiredSemanticRow(\n  row: DesiredBar,\n) {\n  return {\n    stock_code:\n      row.stock_code,\n\n    trading_date:\n      row.trading_date,\n\n    open_price:\n      row.open_price,\n\n    high_price:\n      row.high_price,\n\n    low_price:\n      row.low_price,\n\n    close_price:\n      row.close_price,\n\n    volume:\n      row.volume,\n\n    trading_value:\n      row.trading_value,\n\n    source:\n      row.source,\n\n    adjusted_price:\n      row.adjusted_price,\n  };\n}\n\nfunction stableJson(\n  value: unknown,\n): string {\n  if (\n    value === null ||\n    typeof value !==\n      "object"\n  ) {\n    return JSON.stringify(\n      value,\n    );\n  }\n\n  if (\n    Array.isArray(\n      value,\n    )\n  ) {\n    return (\n      "[" +\n      value\n        .map(stableJson)\n        .join(",") +\n      "]"\n    );\n  }\n\n  const object =\n    value as\n    Record<string, unknown>;\n\n  return (\n    "{" +\n    Object.keys(object)\n      .sort()\n      .map(\n        (key) =>\n          JSON.stringify(key) +\n          ":" +\n          stableJson(\n            object[key],\n          ),\n      )\n      .join(",") +\n    "}"\n  );\n}\n\nfunction sha256(\n  value: unknown,\n) {\n  return createHash(\n    "sha256",\n  )\n    .update(\n      stableJson(value),\n      "utf8",\n    )\n    .digest(\n      "hex",\n    );\n}\n\nfunction resolveSupabaseConfig() {\n  const url =\n    process.env\n      .NEXT_PUBLIC_SUPABASE_URL ??\n    process.env\n      .SUPABASE_URL;\n\n  const serviceKey =\n    process.env\n      .SUPABASE_SERVICE_ROLE_KEY ??\n    process.env\n      .SUPABASE_SERVICE_KEY;\n\n  const anonKey =\n    process.env\n      .NEXT_PUBLIC_SUPABASE_ANON_KEY ??\n    process.env\n      .SUPABASE_ANON_KEY;\n\n  const key =\n    serviceKey ??\n    anonKey;\n\n  if (!url) {\n    throw new Error(\n      "SUPABASE_URL_ENV_MISSING",\n    );\n  }\n\n  if (!key) {\n    throw new Error(\n      "SUPABASE_KEY_ENV_MISSING",\n    );\n  }\n\n  return {\n    url,\n    key,\n    authMode:\n      serviceKey\n        ? "SERVICE_ROLE"\n        : "ANON",\n  };\n}\n\nasync function readExistingRows(\n  supabase: SupabaseClient,\n) {\n  const result =\n    await supabase\n      .from(\n        "market_daily_bars",\n      )\n      .select(\n        `\n          stock_code,\n          trading_date,\n          open_price,\n          high_price,\n          low_price,\n          close_price,\n          volume,\n          trading_value,\n          source,\n          adjusted_price,\n          raw_payload,\n          collected_at,\n          created_at,\n          updated_at\n        `,\n      )\n      .in(\n        "stock_code",\n        TARGETS,\n      )\n      .gte(\n        "trading_date",\n        START_SQL_DATE,\n      )\n      .lte(\n        "trading_date",\n        END_SQL_DATE,\n      )\n      .order(\n        "stock_code",\n        {\n          ascending:\n            true,\n        },\n      )\n      .order(\n        "trading_date",\n        {\n          ascending:\n            true,\n        },\n      );\n\n  if (result.error) {\n    throw new Error(\n      `MARKET_DAILY_BARS_READ_FAILED:${result.error.message}`,\n    );\n  }\n\n  return (\n    result.data ??\n    []\n  ) as JsonRecord[];\n}\n\nasync function fetchDesiredRows() {\n  const accessToken =\n    await getKisAccessToken();\n\n  const rows:\n    DesiredBar[] = [];\n\n  const perStock:\n    Array<Record<string, unknown>> =\n    [];\n\n  for (\n    let index = 0;\n    index < TARGETS.length;\n    index += 1\n  ) {\n    const stockCode =\n      TARGETS[index];\n\n    const response =\n      await getDomesticDailyStockPrices(\n        {\n          stockCode,\n\n          startDate:\n            START_DATE,\n\n          endDate:\n            END_DATE,\n\n          period:\n            "D",\n\n          adjustedPrice:\n            true,\n        },\n        accessToken,\n      );\n\n    const rawRows =\n      response.output2 ??\n      [];\n\n    const collectedAt =\n      new Date()\n        .toISOString();\n\n    const converted =\n      rawRows\n        .map(\n          (row) =>\n            convertDailyBar(\n              stockCode,\n              row,\n              collectedAt,\n            ),\n        )\n        .filter(\n          (\n            row,\n          ): row is DesiredBar =>\n            row !== null,\n        )\n        .filter(\n          (row) =>\n            row.trading_date >=\n              START_SQL_DATE &&\n            row.trading_date <=\n              END_SQL_DATE,\n        );\n\n    const uniqueDates =\n      new Set(\n        converted.map(\n          (row) =>\n            row.trading_date,\n        ),\n      );\n\n    perStock.push({\n      stockCode,\n\n      providerStatus:\n        response.rt_cd,\n\n      providerMessageCode:\n        response.msg_cd,\n\n      providerMessage:\n        response.msg1,\n\n      receivedRows:\n        rawRows.length,\n\n      validConvertedRows:\n        converted.length,\n\n      uniqueDateCount:\n        uniqueDates.size,\n\n      duplicateDateCount:\n        converted.length -\n        uniqueDates.size,\n\n      latestDate:\n        converted\n          .map(\n            (row) =>\n              row.trading_date,\n          )\n          .sort()\n          .at(-1) ??\n        null,\n\n      oldestDate:\n        converted\n          .map(\n            (row) =>\n              row.trading_date,\n          )\n          .sort()\n          .at(0) ??\n        null,\n\n      expectedRowCount:\n        EXPECTED_ROWS_PER_STOCK,\n\n      exactExpectedCount:\n        converted.length ===\n          EXPECTED_ROWS_PER_STOCK &&\n        uniqueDates.size ===\n          EXPECTED_ROWS_PER_STOCK,\n    });\n\n    rows.push(\n      ...converted,\n    );\n\n    if (\n      index <\n      TARGETS.length - 1\n    ) {\n      await sleep(\n        REQUEST_DELAY_MS,\n      );\n    }\n  }\n\n  rows.sort(\n    (a, b) =>\n      a.stock_code.localeCompare(\n        b.stock_code,\n      ) ||\n      a.trading_date.localeCompare(\n        b.trading_date,\n      ),\n  );\n\n  return {\n    rows,\n    perStock,\n  };\n}\n\nasync function main() {\n  const config =\n    resolveSupabaseConfig();\n\n  const supabase =\n    createClient(\n      config.url,\n      config.key,\n      {\n        auth: {\n          persistSession:\n            false,\n\n          autoRefreshToken:\n            false,\n        },\n      },\n    );\n\n  const existingRows =\n    await readExistingRows(\n      supabase,\n    );\n\n  const desired =\n    await fetchDesiredRows();\n\n  const existingByKey =\n    new Map(\n      existingRows.map(\n        (row) => [\n          `${String(row.stock_code)}|${String(row.trading_date)}`,\n          row,\n        ],\n      ),\n    );\n\n  let insertCount = 0;\n  let noopCount = 0;\n  let updateCount = 0;\n\n  const conflicts:\n    Array<Record<string, unknown>> =\n    [];\n\n  const actions =\n    desired.rows.map(\n      (row) => {\n        const key =\n          `${row.stock_code}|${row.trading_date}`;\n\n        const existing =\n          existingByKey.get(\n            key,\n          );\n\n        if (!existing) {\n          insertCount += 1;\n\n          return {\n            key,\n            action:\n              "INSERT",\n          };\n        }\n\n        const existingSemantic =\n          semanticRow(\n            existing,\n          );\n\n        const desiredSemantic =\n          desiredSemanticRow(\n            row,\n          );\n\n        const equal =\n          stableJson(\n            existingSemantic,\n          ) ===\n          stableJson(\n            desiredSemantic,\n          );\n\n        if (equal) {\n          noopCount += 1;\n\n          return {\n            key,\n            action:\n              "NOOP_IDENTICAL",\n          };\n        }\n\n        updateCount += 1;\n\n        conflicts.push({\n          key,\n\n          existing:\n            existingSemantic,\n\n          desired:\n            desiredSemantic,\n        });\n\n        return {\n          key,\n          action:\n            "UPDATE_SEMANTIC_DIFFERENCE",\n        };\n      },\n    );\n\n  const duplicateDesiredKeys =\n    desired.rows.length -\n    new Set(\n      desired.rows.map(\n        (row) =>\n          `${row.stock_code}|${row.trading_date}`,\n      ),\n    ).size;\n\n  const allProviderCountsExact =\n    desired.perStock.every(\n      (row) =>\n        row.exactExpectedCount ===\n        true,\n    );\n\n  const allAdjusted =\n    desired.rows.every(\n      (row) =>\n        row.adjusted_price ===\n        true,\n    );\n\n  const allSourceCanonical =\n    desired.rows.every(\n      (row) =>\n        row.source ===\n        "KIS_DAILY_V8_3",\n    );\n\n  const safeToApply =\n    desired.rows.length ===\n      EXPECTED_TOTAL_ROWS &&\n    duplicateDesiredKeys ===\n      0 &&\n    allProviderCountsExact &&\n    allAdjusted &&\n    allSourceCanonical &&\n    updateCount ===\n      0;\n\n  const desiredSemanticManifest =\n    desired.rows.map(\n      desiredSemanticRow,\n    );\n\n  const report = {\n    status:\n      safeToApply\n        ? "ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_BACKFILL_PLAN_READY"\n        : "ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_BACKFILL_PLAN_REVIEW_REQUIRED",\n\n    version:\n      VERSION,\n\n    authMode:\n      config.authMode,\n\n    scope: {\n      targets:\n        TARGETS,\n\n      startDate:\n        START_SQL_DATE,\n\n      endDate:\n        END_SQL_DATE,\n\n      canonicalSource:\n        "KIS_DAILY_V8_3",\n\n      adjustedPrice:\n        true,\n\n      kisMode:\n        "FID_ORG_ADJ_PRC=0",\n\n      conflictKey:\n        "stock_code,trading_date",\n\n      writePolicy:\n        "UPSERT_ONLY_NO_DELETE",\n    },\n\n    expected: {\n      rowsPerStock:\n        EXPECTED_ROWS_PER_STOCK,\n\n      totalRows:\n        EXPECTED_TOTAL_ROWS,\n    },\n\n    provider:\n      desired.perStock,\n\n    databaseBefore: {\n      existingRowsInScope:\n        existingRows.length,\n    },\n\n    plan: {\n      desiredRows:\n        desired.rows.length,\n\n      insertCount,\n\n      noopIdenticalCount:\n        noopCount,\n\n      semanticUpdateCount:\n        updateCount,\n\n      duplicateDesiredKeys,\n\n      safeToApply,\n\n      applyWouldPerformDeletes:\n        false,\n\n      applyWouldTouchOnlyTargets:\n        true,\n    },\n\n    semanticConflicts:\n      conflicts,\n\n    actions,\n\n    fingerprints: {\n      desiredSemanticFingerprint:\n        sha256(\n          desiredSemanticManifest,\n        ),\n\n      existingSemanticFingerprint:\n        sha256(\n          existingRows\n            .map(\n              semanticRow,\n            )\n            .sort(\n              (a, b) =>\n                `${a.stock_code}|${a.trading_date}`\n                  .localeCompare(\n                    `${b.stock_code}|${b.trading_date}`,\n                  ),\n            ),\n        ),\n    },\n\n    desiredRows:\n      desired.rows,\n\n    safety: {\n      databaseReads:\n        1,\n\n      databaseWrites:\n        0,\n\n      kisDailyRequests:\n        TARGETS.length,\n\n      tokenRequest:\n        "GET_KIS_ACCESS_TOKEN_MAY_ISSUE_ONE_TOKEN_REQUEST",\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionDecisionApplied:\n        false,\n    },\n\n    nextGate:\n      safeToApply\n        ? "ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_BACKFILL_APPLY_UPSERT_ONLY"\n        : "REVIEW_BACKFILL_PLAN_BEFORE_ANY_WRITE",\n  };\n\n  const outputFile =\n    path.resolve(\n      process.cwd(),\n      "logs",\n      "alpha-v1-controlled-3-stock-daily-bar-backfill-plan.json",\n    );\n\n  fs.mkdirSync(\n    path.dirname(\n      outputFile,\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  fs.writeFileSync(\n    outputFile,\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + "\\n",\n    "utf8",\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          report.status,\n\n        version:\n          report.version,\n\n        scope:\n          report.scope,\n\n        provider:\n          report.provider,\n\n        databaseBefore:\n          report.databaseBefore,\n\n        plan:\n          report.plan,\n\n        fingerprints:\n          report.fingerprints,\n\n        semanticConflictCount:\n          report.semanticConflicts\n            .length,\n\n        safety:\n          report.safety,\n\n        nextGate:\n          report.nextGate,\n\n        outputFile:\n          "logs/alpha-v1-controlled-3-stock-daily-bar-backfill-plan.json",\n      },\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            "ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_BACKFILL_PLAN_FAILED",\n\n          version:\n            VERSION,\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          safety: {\n            databaseWrites:\n              0,\n\n            ordersCreated:\n              0,\n\n            productionDecisionApplied:\n              false,\n          },\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n';

function atomicWrite(
  file,
  content,
) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive:
        true,
    },
  );

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    content,
    'utf8',
  );

  fs.renameSync(
    tmp,
    file,
  );
}

try {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  atomicWrite(
    path.join(
      root,
      'scripts',
      'alpha-v1-controlled-3-stock-daily-bar-backfill-plan.ts',
    ),
    script,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_BACKFILL_PLAN_INSTALLED',

        version:
          VERSION,

        file:
          'scripts/alpha-v1-controlled-3-stock-daily-bar-backfill-plan.ts',

        scope: {
          targets: [
            '005930',
            '035420',
            '035720',
          ],

          startDate:
            '2026-06-01',

          endDate:
            '2026-10-02',

          expectedRows:
            255,

          source:
            'KIS_DAILY_V8_3',

          adjustedPrice:
            true,

          writePolicy:
            'PLAN_ONLY_NO_WRITE',
        },

        safety: {
          databaseWrites:
            0,

          deletes:
            0,

          ordersCreated:
            0,
        },

        nextAction:
          'RUN_CONTROLLED_3_STOCK_BACKFILL_PLAN',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_BACKFILL_PLAN_INSTALL_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        databaseWrites:
          0,

        ordersCreated:
          0,
      },
      null,
      2,
    ),
  );

  process.exitCode =
    2;
}
