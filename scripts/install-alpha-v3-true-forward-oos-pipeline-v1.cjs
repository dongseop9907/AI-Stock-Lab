const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root =
  process.cwd();

const historySourcePath =
  path.resolve(
    root,
    "scripts/alpha-v3-extended-pricevolume-top1-history.ts"
  );

const batcherSourcePath =
  path.resolve(
    root,
    "scripts/alpha-v3-extended-entry-v3-replay-batcher.ts"
  );

if (
  !fs.existsSync(
    historySourcePath
  ) ||
  !fs.existsSync(
    batcherSourcePath
  )
) {
  throw new Error(
    "REQUIRED_HISTORICAL_SOURCE_SURFACE_MISSING"
  );
}

const historySource =
  fs.readFileSync(
    historySourcePath,
    "utf8"
  );

const batcherSource =
  fs.readFileSync(
    batcherSourcePath,
    "utf8"
  );

for (
  const needle of [
    "buildDailyPriceVolumeEvidence",
    "calculateMarketRegimeFeatureVectorV7",
    "rawPriceVolumeScore",
    "effectiveScore"
  ]
) {
  if (
    !historySource.includes(
      needle
    )
  ) {
    throw new Error(
      `HISTORICAL_TOP1_SOURCE_CONTRACT_MISSING:${needle}`
    );
  }
}

function extractFunction(
  source,
  name
) {
  const asyncStart =
    source.indexOf(
      `async function ${name}(`
    );

  const syncStart =
    source.indexOf(
      `function ${name}(`
    );

  const start =
    asyncStart >=
      0
      ? asyncStart
      : syncStart;

  if (
    start <
    0
  ) {
    throw new Error(
      `BATCHER_FUNCTION_NOT_FOUND:${name}`
    );
  }

  const open =
    source.indexOf(
      "{",
      start
    );

  if (
    open <
    0
  ) {
    throw new Error(
      `BATCHER_FUNCTION_BODY_NOT_FOUND:${name}`
    );
  }

  let depth =
    0;

  let quote =
    null;

  let escape =
    false;

  for (
    let i =
      open;
    i <
    source.length;
    i +=
    1
  ) {
    const ch =
      source[i];

    if (
      quote
    ) {
      if (
        escape
      ) {
        escape =
          false;
        continue;
      }

      if (
        ch ===
        "\\"
      ) {
        escape =
          true;
        continue;
      }

      if (
        ch ===
        quote
      ) {
        quote =
          null;
      }

      continue;
    }

    if (
      ch ===
        '"' ||
      ch ===
        "'" ||
      ch ===
        "`"
    ) {
      quote =
        ch;
      continue;
    }

    if (
      ch ===
      "{"
    ) {
      depth +=
        1;
    } else if (
      ch ===
      "}"
    ) {
      depth -=
        1;

      if (
        depth ===
        0
      ) {
        return source.slice(
          start,
          i +
          1
        );
      }
    }
  }

  throw new Error(
    `BATCHER_FUNCTION_UNTERMINATED:${name}`
  );
}

const copiedFunctions =
  [
    "sleep",
    "avg",
    "clamp",
    "toNumber",
    "previousMinute",
    "digitsDate",
    "toObservedAt",
    "fetchJsonWithRetry",
    "fetchPage",
    "fetchFullMinuteSession",
    "correctedSignal",
    "firstQualified",
    "simulateLimitFill"
  ].map(
    (name) =>
      extractFunction(
        batcherSource,
        name
      )
  ).join(
    "\n\n"
  );

const provenance = {
  historicalTop1Sha256:
    crypto
      .createHash(
        "sha256"
      )
      .update(
        historySource
      )
      .digest(
        "hex"
      ),

  entryBatcherSha256:
    crypto
      .createHash(
        "sha256"
      )
      .update(
        batcherSource
      )
      .digest(
        "hex"
      )
};


const producerSource = "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nimport {\n  buildDailyPriceVolumeEvidence,\n  type DailyAlphaBarLike,\n} from \"../lib/alpha/daily-market-adapters\";\n\nimport {\n  calculateMarketRegimeFeatureVectorV7,\n  type MarketRegimeFeatureMarket,\n  type MarketRegimeIndexBar,\n  type MarketRegimeStockBar,\n} from \"../lib/market/market-regime-feature-engine\";\n\nexport const TRUE_FORWARD_TOP1_VERSION =\n  \"ALPHA_V3_TRUE_FORWARD_TOP1_SESSIONS_V1\" as const;\n\nexport const HISTORICAL_CUTOFF =\n  \"2026-10-07\";\n\nexport const FROZEN_ENTRY_THRESHOLD =\n  0.66;\n\nexport const FROZEN_PREMIUM_CAP =\n  0.01;\n\nconst STATE_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs/alpha-v3-entry-v3-forward-shadow-oos-state.json\",\n  );\n\nconst OUTPUT_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs/alpha-v3-forward-top1-sessions.json\",\n  );\n\ninterface ActiveStock {\n  stock_code: string;\n  stock_name: string | null;\n  market: string | null;\n}\n\ninterface DailyBarRow extends DailyAlphaBarLike {\n  stock_code: string;\n  trading_date: string;\n}\n\ninterface IndexBarRow {\n  market_code: string;\n  trading_date: string;\n  close_value: number | string | null;\n}\n\ninterface CalendarOverrideRow {\n  calendar_date: string;\n  is_open: boolean;\n  verified: boolean;\n}\n\nfunction toNumber(\n  value: unknown,\n): number | null {\n  if (\n    value === null ||\n    value === undefined ||\n    value === \"\"\n  ) {\n    return null;\n  }\n\n  const n =\n    Number(value);\n\n  return Number.isFinite(n)\n    ? n\n    : null;\n}\n\nfunction nextCalendarDayDecisionAt(\n  tradingDate: string,\n) {\n  return new Date(\n    `${tradingDate}T15:05:00.000Z`,\n  ).toISOString();\n}\n\nfunction sqlDateAtKstTime(\n  date: string,\n  hhmmss: string,\n) {\n  return new Date(\n    `${date}T${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}+09:00`,\n  );\n}\n\nfunction addSqlDays(\n  date: string,\n  days: number,\n) {\n  const d =\n    new Date(\n      `${date}T00:00:00.000Z`,\n    );\n\n  d.setUTCDate(\n    d.getUTCDate() +\n    days,\n  );\n\n  return d\n    .toISOString()\n    .slice(0, 10);\n}\n\nexport function nextExpectedKrxOpenDate(\n  sourceTradingDate: string,\n  overrides:\n    CalendarOverrideRow[],\n): string {\n  const overrideByDate =\n    new Map(\n      overrides\n        .filter(\n          (row) =>\n            row.verified === true,\n        )\n        .map(\n          (row) => [\n            String(\n              row.calendar_date,\n            ),\n            row,\n          ],\n        ),\n    );\n\n  for (\n    let offset = 1;\n    offset <= 14;\n    offset += 1\n  ) {\n    const candidate =\n      addSqlDays(\n        sourceTradingDate,\n        offset,\n      );\n\n    const override =\n      overrideByDate.get(\n        candidate,\n      );\n\n    if (override) {\n      if (\n        override.is_open ===\n        true\n      ) {\n        return candidate;\n      }\n\n      continue;\n    }\n\n    const weekday =\n      new Date(\n        `${candidate}T00:00:00.000Z`,\n      ).getUTCDay();\n\n    if (\n      weekday !== 0 &&\n      weekday !== 6\n    ) {\n      return candidate;\n    }\n  }\n\n  throw new Error(\n    `NEXT_KRX_OPEN_DATE_NOT_FOUND:${sourceTradingDate}`,\n  );\n}\n\nexport function classifyCaptureWindow(\n  input: {\n    now: Date;\n    decisionAt: string;\n    targetSessionDate: string;\n  },\n):\n  | \"BEFORE_DECISION_TIME\"\n  | \"CAPTURE_WINDOW_OPEN\"\n  | \"MISSED_CAPTURE_WINDOW\" {\n  const nowMs =\n    input.now.getTime();\n\n  const decisionMs =\n    Date.parse(\n      input.decisionAt,\n    );\n\n  const targetOpenMs =\n    sqlDateAtKstTime(\n      input.targetSessionDate,\n      \"090000\",\n    ).getTime();\n\n  if (\n    nowMs <\n    decisionMs\n  ) {\n    return \"BEFORE_DECISION_TIME\";\n  }\n\n  if (\n    nowMs >=\n    targetOpenMs\n  ) {\n    return \"MISSED_CAPTURE_WINDOW\";\n  }\n\n  return \"CAPTURE_WINDOW_OPEN\";\n}\n\nasync function fetchAllRows<T>(\n  buildQuery: (\n    from: number,\n    to: number,\n  ) => PromiseLike<{\n    data: T[] | null;\n    error: {\n      message?: string;\n    } | null;\n  }>,\n  label: string,\n): Promise<T[]> {\n  const pageSize =\n    1000;\n\n  const out:\n    T[] = [];\n\n  for (\n    let from = 0;\n    ;\n    from += pageSize\n  ) {\n    const to =\n      from +\n      pageSize -\n      1;\n\n    const result =\n      await buildQuery(\n        from,\n        to,\n      );\n\n    if (\n      result.error\n    ) {\n      throw new Error(\n        `${label}_READ_FAILED:${result.error.message ?? \"UNKNOWN\"}`,\n      );\n    }\n\n    const rows =\n      result.data ??\n      [];\n\n    out.push(\n      ...rows,\n    );\n\n    if (\n      rows.length <\n      pageSize\n    ) {\n      break;\n    }\n  }\n\n  return out;\n}\n\nfunction readFrozenState() {\n  if (\n    !fs.existsSync(\n      STATE_FILE,\n    )\n  ) {\n    throw new Error(\n      \"FORWARD_OOS_FROZEN_STATE_NOT_FOUND\",\n    );\n  }\n\n  const state =\n    JSON.parse(\n      fs.readFileSync(\n        STATE_FILE,\n        \"utf8\",\n      ),\n    );\n\n  if (\n    state.version !==\n      \"ALPHA_V3_ENTRY_V3_FORWARD_SHADOW_OOS_V1\" ||\n    state.historicalCutoff !==\n      HISTORICAL_CUTOFF ||\n    Number(\n      state.selectedCap,\n    ) !==\n      FROZEN_PREMIUM_CAP ||\n    Number(\n      state.entryScoreThreshold,\n    ) !==\n      FROZEN_ENTRY_THRESHOLD ||\n    state.frozen !==\n      true\n  ) {\n    throw new Error(\n      \"FORWARD_OOS_FROZEN_CONTRACT_MISMATCH\",\n    );\n  }\n\n  return state;\n}\n\nfunction readForwardFile() {\n  if (\n    !fs.existsSync(\n      OUTPUT_FILE,\n    )\n  ) {\n    return {\n      version:\n        TRUE_FORWARD_TOP1_VERSION,\n\n      contract: {\n        historicalCutoff:\n          HISTORICAL_CUTOFF,\n\n        selectedCap:\n          FROZEN_PREMIUM_CAP,\n\n        entryScoreThreshold:\n          FROZEN_ENTRY_THRESHOLD,\n\n        retuningAllowed:\n          false,\n\n        candidateMustBeFrozenBeforeTargetOpen:\n          true,\n\n        historicalCheckpointMutable:\n          false,\n      },\n\n      sessions:\n        [],\n\n      missedCaptureWindows:\n        [],\n    };\n  }\n\n  const parsed =\n    JSON.parse(\n      fs.readFileSync(\n        OUTPUT_FILE,\n        \"utf8\",\n      ),\n    );\n\n  if (\n    parsed.version !==\n    TRUE_FORWARD_TOP1_VERSION\n  ) {\n    throw new Error(\n      \"FORWARD_TOP1_FILE_VERSION_MISMATCH\",\n    );\n  }\n\n  parsed.sessions =\n    Array.isArray(\n      parsed.sessions,\n    )\n      ? parsed.sessions\n      : [];\n\n  parsed.missedCaptureWindows =\n    Array.isArray(\n      parsed.missedCaptureWindows,\n    )\n      ? parsed.missedCaptureWindows\n      : [];\n\n  return parsed;\n}\n\nfunction writeForwardFile(\n  value: any,\n) {\n  fs.mkdirSync(\n    path.dirname(\n      OUTPUT_FILE,\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  const temp =\n    `${OUTPUT_FILE}.tmp`;\n\n  fs.writeFileSync(\n    temp,\n    JSON.stringify(\n      value,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  fs.renameSync(\n    temp,\n    OUTPUT_FILE,\n  );\n}\n\nasync function readProductionQualityEvidence(\n  sourceTradingDate: string,\n) {\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data,\n    error,\n  } =\n    await supabase\n      .from(\n        \"market_data_quality_gate_observations\",\n      )\n      .select(\n        [\n          \"id\",\n          \"observed_at\",\n          \"status\",\n          \"expected_market_date\",\n          \"freshness_status\",\n          \"integrity_status\",\n          \"effective_error_count\",\n          \"effective_warning_count\",\n        ].join(\",\"),\n      )\n      .eq(\n        \"expected_market_date\",\n        sourceTradingDate,\n      )\n      .order(\n        \"observed_at\",\n        {\n          ascending:\n            false,\n        },\n      )\n      .limit(1)\n      .maybeSingle();\n\n  if (\n    error\n  ) {\n    throw new Error(\n      `QUALITY_EVIDENCE_READ_FAILED:${error.message}`,\n    );\n  }\n\n  if (\n    !data\n  ) {\n    return null;\n  }\n\n  const healthy =\n    data.status ===\n      \"PASS\" &&\n    data.freshness_status ===\n      \"FRESH\" &&\n    data.integrity_status ===\n      \"CLEAN\" &&\n    Number(\n      data.effective_error_count ??\n      0,\n    ) ===\n      0 &&\n    Number(\n      data.effective_warning_count ??\n      0,\n    ) ===\n      0;\n\n  return {\n    ...data,\n    healthy,\n  };\n}\n\nexport async function runTrueForwardTop1Producer(\n  now:\n    Date = new Date(),\n) {\n  readFrozenState();\n\n  const root =\n    process.cwd();\n\n  const supabase =\n    createSupabaseServerClient();\n\n  const stockResult =\n    await supabase\n      .from(\n        \"stocks\",\n      )\n      .select(\n        \"stock_code,stock_name,market\",\n      )\n      .eq(\n        \"is_active\",\n        true,\n      )\n      .order(\n        \"stock_code\",\n      );\n\n  if (\n    stockResult.error\n  ) {\n    throw new Error(\n      `ACTIVE_STOCK_READ_FAILED:${stockResult.error.message}`,\n    );\n  }\n\n  const stocks =\n    (\n      stockResult.data ??\n      []\n    ) as ActiveStock[];\n\n  if (\n    !stocks.length\n  ) {\n    throw new Error(\n      \"NO_ACTIVE_STOCKS\",\n    );\n  }\n\n  const stockCodes =\n    stocks.map(\n      (row) =>\n        row.stock_code,\n    );\n\n  const dailyBars =\n    await fetchAllRows<DailyBarRow>(\n      (from, to) =>\n        supabase\n          .from(\n            \"market_daily_bars\",\n          )\n          .select(\n            \"stock_code,trading_date,open_price,high_price,low_price,close_price,volume,trading_value,adjusted_price,source,updated_at\",\n          )\n          .in(\n            \"stock_code\",\n            stockCodes,\n          )\n          .eq(\n            \"adjusted_price\",\n            true,\n          )\n          .order(\n            \"trading_date\",\n            {\n              ascending:\n                true,\n            },\n          )\n          .order(\n            \"stock_code\",\n            {\n              ascending:\n                true,\n            },\n          )\n          .range(\n            from,\n            to,\n          ),\n\n      \"DAILY_BARS\",\n    );\n\n  const indexBarsRaw =\n    await fetchAllRows<IndexBarRow>(\n      (from, to) =>\n        supabase\n          .from(\n            \"market_index_daily_bars\",\n          )\n          .select(\n            \"market_code,trading_date,close_value\",\n          )\n          .in(\n            \"market_code\",\n            [\n              \"KOSPI\",\n              \"KOSDAQ\",\n            ],\n          )\n          .order(\n            \"trading_date\",\n            {\n              ascending:\n                true,\n            },\n          )\n          .order(\n            \"market_code\",\n            {\n              ascending:\n                true,\n            },\n          )\n          .range(\n            from,\n            to,\n          ),\n\n      \"INDEX_BARS\",\n    );\n\n  const tradingDates =\n    [\n      ...new Set(\n        dailyBars.map(\n          (row) =>\n            String(\n              row.trading_date,\n            ),\n        ),\n      ),\n    ].sort();\n\n  const sourceTradingDate =\n    tradingDates.at(\n      -1,\n    ) ??\n    null;\n\n  if (\n    !sourceTradingDate\n  ) {\n    throw new Error(\n      \"NO_DAILY_TRADING_DATE\",\n    );\n  }\n\n  if (\n    sourceTradingDate <=\n    HISTORICAL_CUTOFF\n  ) {\n    return {\n      status:\n        \"ALPHA_V3_TRUE_FORWARD_TOP1_WAITING_FOR_POST_CUTOFF_DATA\",\n\n      sourceTradingDate,\n\n      historicalCutoff:\n        HISTORICAL_CUTOFF,\n\n      databaseWrites:\n        0,\n\n      ordersCreated:\n        0,\n    };\n  }\n\n  const qualityEvidence =\n    await readProductionQualityEvidence(\n      sourceTradingDate,\n    );\n\n  if (\n    !qualityEvidence ||\n    qualityEvidence.healthy !==\n      true\n  ) {\n    return {\n      status:\n        \"ALPHA_V3_TRUE_FORWARD_TOP1_BLOCKED_BY_DATA_QUALITY\",\n\n      sourceTradingDate,\n\n      qualityEvidence,\n\n      productionChanged:\n        false,\n    };\n  }\n\n  const overrideEnd =\n    addSqlDays(\n      sourceTradingDate,\n      14,\n    );\n\n  const {\n    data:\n      overrideData,\n    error:\n      overrideError,\n  } =\n    await supabase\n      .from(\n        \"market_exchange_calendar_overrides\",\n      )\n      .select(\n        \"calendar_date,is_open,verified\",\n      )\n      .eq(\n        \"exchange_code\",\n        \"KRX\",\n      )\n      .gte(\n        \"calendar_date\",\n        sourceTradingDate,\n      )\n      .lte(\n        \"calendar_date\",\n        overrideEnd,\n      );\n\n  if (\n    overrideError\n  ) {\n    throw new Error(\n      `KRX_OVERRIDE_READ_FAILED:${overrideError.message}`,\n    );\n  }\n\n  const targetSessionDate =\n    nextExpectedKrxOpenDate(\n      sourceTradingDate,\n      (\n        overrideData ??\n        []\n      ) as CalendarOverrideRow[],\n    );\n\n  const decisionAt =\n    nextCalendarDayDecisionAt(\n      sourceTradingDate,\n    );\n\n  const captureWindow =\n    classifyCaptureWindow({\n      now,\n      decisionAt,\n      targetSessionDate,\n    });\n\n  const forward =\n    readForwardFile();\n\n  const sessionKey =\n    `${sourceTradingDate}|${targetSessionDate}`;\n\n  const existing =\n    forward.sessions.find(\n      (row: any) =>\n        `${row.sourceTradingDate}|${row.targetSessionDate}` ===\n        sessionKey,\n    );\n\n  if (\n    existing\n  ) {\n    return {\n      status:\n        \"ALPHA_V3_TRUE_FORWARD_TOP1_ALREADY_CAPTURED\",\n\n      sessionKey,\n\n      session:\n        existing,\n\n      outputFile:\n        \"logs/alpha-v3-forward-top1-sessions.json\",\n\n      safety: {\n        databaseWrites:\n          0,\n        ordersCreated:\n          0,\n        positionsChanged:\n          0,\n        productionChanged:\n          false,\n      },\n    };\n  }\n\n  if (\n    captureWindow ===\n    \"BEFORE_DECISION_TIME\"\n  ) {\n    return {\n      status:\n        \"ALPHA_V3_TRUE_FORWARD_TOP1_WAITING_FOR_DECISION_TIME\",\n\n      sourceTradingDate,\n      decisionAt,\n      targetSessionDate,\n\n      now:\n        now.toISOString(),\n\n      safety: {\n        databaseWrites:\n          0,\n        ordersCreated:\n          0,\n        positionsChanged:\n          0,\n      },\n    };\n  }\n\n  if (\n    captureWindow ===\n    \"MISSED_CAPTURE_WINDOW\"\n  ) {\n    const alreadyMissed =\n      forward.missedCaptureWindows.some(\n        (row: any) =>\n          `${row.sourceTradingDate}|${row.targetSessionDate}` ===\n          sessionKey,\n      );\n\n    if (\n      !alreadyMissed\n    ) {\n      forward.missedCaptureWindows.push({\n        sourceTradingDate,\n        targetSessionDate,\n        decisionAt,\n        detectedAt:\n          now.toISOString(),\n\n        reason:\n          \"TARGET_SESSION_ALREADY_OPENED_BEFORE_CANDIDATE_WAS_FROZEN\",\n      });\n\n      writeForwardFile(\n        forward,\n      );\n    }\n\n    return {\n      status:\n        \"ALPHA_V3_TRUE_FORWARD_TOP1_MISSED_CAPTURE_WINDOW\",\n\n      sourceTradingDate,\n      targetSessionDate,\n      decisionAt,\n\n      retrospectiveCandidateCreated:\n        false,\n\n      productionChanged:\n        false,\n    };\n  }\n\n  const barsByStock =\n    new Map<\n      string,\n      DailyBarRow[]\n    >();\n\n  for (\n    const stock of\n      stocks\n  ) {\n    barsByStock.set(\n      stock.stock_code,\n      [],\n    );\n  }\n\n  for (\n    const row of\n      dailyBars\n  ) {\n    const arr =\n      barsByStock.get(\n        String(\n          row.stock_code,\n        ),\n      );\n\n    if (\n      arr\n    ) {\n      arr.push(\n        row,\n      );\n    }\n  }\n\n  const indexBarsAll:\n    MarketRegimeIndexBar[] =\n    indexBarsRaw\n      .map(\n        (row) => {\n          const close =\n            toNumber(\n              row.close_value,\n            );\n\n          const marketCode =\n            String(\n              row.market_code,\n            );\n\n          if (\n            close === null ||\n            (\n              marketCode !==\n                \"KOSPI\" &&\n              marketCode !==\n                \"KOSDAQ\"\n            )\n          ) {\n            return null;\n          }\n\n          return {\n            marketCode:\n              marketCode as\n                MarketRegimeFeatureMarket,\n\n            tradingDate:\n              String(\n                row.trading_date,\n              ),\n\n            close,\n          };\n        },\n      )\n      .filter(\n        (\n          row,\n        ): row is MarketRegimeIndexBar =>\n          row !== null,\n      );\n\n  const asOfDailyBars =\n    dailyBars.filter(\n      (row) =>\n        String(\n          row.trading_date,\n        ) <=\n        sourceTradingDate,\n    );\n\n  const indexBars =\n    indexBarsAll.filter(\n      (row) =>\n        row.tradingDate <=\n        sourceTradingDate,\n    );\n\n  const stockBars:\n    MarketRegimeStockBar[] =\n    asOfDailyBars\n      .map(\n        (row) => {\n          const close =\n            toNumber(\n              row.close_price,\n            );\n\n          if (\n            close ===\n            null\n          ) {\n            return null;\n          }\n\n          return {\n            stockCode:\n              String(\n                row.stock_code,\n              ),\n\n            tradingDate:\n              String(\n                row.trading_date,\n              ),\n\n            close,\n          };\n        },\n      )\n      .filter(\n        (\n          row,\n        ): row is MarketRegimeStockBar =>\n          row !== null,\n      );\n\n  const v7Features =\n    calculateMarketRegimeFeatureVectorV7({\n      indexBars,\n      stockBars,\n    });\n\n  const ranking:\n    any[] =\n    [];\n\n  for (\n    const stock of\n      stocks\n  ) {\n    const stockRows =\n      barsByStock.get(\n        stock.stock_code,\n      ) ??\n      [];\n\n    const evidence =\n      buildDailyPriceVolumeEvidence({\n        stockCode:\n          stock.stock_code,\n\n        market:\n          stock.market,\n\n        decisionAt,\n\n        rows:\n          stockRows,\n\n        v7Features,\n      });\n\n    if (\n      !evidence\n    ) {\n      continue;\n    }\n\n    const effectiveScore =\n      0.5 +\n      (\n        evidence.score -\n        0.5\n      ) *\n      evidence.confidence;\n\n    ranking.push({\n      stockCode:\n        stock.stock_code,\n\n      stockName:\n        stock.stock_name,\n\n      market:\n        stock.market,\n\n      rawPriceVolumeScore:\n        evidence.score,\n\n      confidence:\n        evidence.confidence,\n\n      effectiveScore,\n\n      availableAt:\n        evidence.availableAt,\n\n      latestTradingDate:\n        (\n          evidence.metadata as\n            Record<\n              string,\n              unknown\n            >\n        )\n          ?.latestTradingDate ??\n        null,\n\n      metadata:\n        evidence.metadata,\n    });\n  }\n\n  ranking.sort(\n    (a, b) =>\n      b.effectiveScore -\n        a.effectiveScore ||\n      b.rawPriceVolumeScore -\n        a.rawPriceVolumeScore ||\n      a.stockCode.localeCompare(\n        b.stockCode,\n      ),\n  );\n\n  const top1 =\n    ranking[0];\n\n  if (\n    !top1\n  ) {\n    throw new Error(\n      \"NO_PRICEVOLUME_CANDIDATE\",\n    );\n  }\n\n  const capturedAt =\n    now.toISOString();\n\n  const session = {\n    sourceTradingDate,\n    decisionAt,\n    targetSessionDate,\n\n    capturedAt,\n\n    sourceDataCutoffAtCollection:\n      sourceTradingDate,\n\n    candidateCount:\n      ranking.length,\n\n    top1,\n\n    top5:\n      ranking.slice(\n        0,\n        5,\n      ),\n\n    frozen:\n      true,\n\n    frozenContract: {\n      historicalCutoff:\n        HISTORICAL_CUTOFF,\n\n      entryScoreThreshold:\n        FROZEN_ENTRY_THRESHOLD,\n\n      selectedCap:\n        FROZEN_PREMIUM_CAP,\n\n      retuningAllowed:\n        false,\n    },\n\n    qualityEvidence: {\n      id:\n        qualityEvidence.id,\n      observedAt:\n        qualityEvidence.observed_at,\n      status:\n        qualityEvidence.status,\n      freshnessStatus:\n        qualityEvidence.freshness_status,\n      integrityStatus:\n        qualityEvidence.integrity_status,\n      effectiveErrors:\n        qualityEvidence.effective_error_count,\n      effectiveWarnings:\n        qualityEvidence.effective_warning_count,\n    },\n  };\n\n  forward.sessions.push(\n    session,\n  );\n\n  forward.sessions.sort(\n    (a: any, b: any) =>\n      String(\n        a.sourceTradingDate,\n      ).localeCompare(\n        String(\n          b.sourceTradingDate,\n        ),\n      ),\n  );\n\n  writeForwardFile(\n    forward,\n  );\n\n  return {\n    status:\n      \"ALPHA_V3_TRUE_FORWARD_TOP1_CAPTURED\",\n\n    sessionKey,\n\n    session,\n\n    outputFile:\n      \"logs/alpha-v3-forward-top1-sessions.json\",\n\n    historicalCheckpointTouched:\n      false,\n\n    safety: {\n      databaseReadsOnly:\n        true,\n      databaseWrites:\n        0,\n      kisRequests:\n        0,\n      ordersCreated:\n        0,\n      positionsChanged:\n        0,\n      productionChanged:\n        false,\n      thresholdChanged:\n        false,\n    },\n\n    nextGate:\n      \"WAIT_FOR_TARGET_SESSION_CLOSE_THEN_COLLECT_ENTRY_OOS\",\n  };\n}\n\nasync function main() {\n  const result =\n    await runTrueForwardTop1Producer();\n\n  console.log(\n    JSON.stringify(\n      result,\n      null,\n      2,\n    ),\n  );\n}\n\nif (\n  require.main ===\n  module\n) {\n  main().catch(\n    (error) => {\n      console.error(\n        JSON.stringify(\n          {\n            status:\n              \"ALPHA_V3_TRUE_FORWARD_TOP1_PRODUCER_FAILED\",\n\n            error:\n              error instanceof Error\n                ? error.message\n                : String(\n                    error,\n                  ),\n\n            safety: {\n              databaseWrites:\n                0,\n              kisRequests:\n                0,\n              ordersCreated:\n                0,\n              positionsChanged:\n                0,\n              productionChanged:\n                false,\n            },\n          },\n          null,\n          2,\n        ),\n      );\n\n      process.exitCode =\n        2;\n    },\n  );\n}\n";

const collectorPrefix = "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  getKisAccessToken,\n} from \"../lib/kis/client\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nconst VERSION =\n  \"ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_COLLECTOR_V1\";\n\nconst HISTORICAL_CUTOFF =\n  \"2026-10-07\";\n\nconst FROZEN_ENTRY_THRESHOLD =\n  0.66;\n\nconst FROZEN_PREMIUM_CAP =\n  0.01;\n\nconst REQUEST_DELAY_MS =\n  1200;\n\nconst MARKET_OPEN =\n  \"090000\";\n\nconst MARKET_CLOSE =\n  \"153000\";\n\nconst MAX_PAGES_PER_SESSION =\n  6;\n\nconst MAX_RETRIES =\n  3;\n\nconst FORWARD_TOP1_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs/alpha-v3-forward-top1-sessions.json\",\n  );\n\nconst FROZEN_STATE_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs/alpha-v3-entry-v3-forward-shadow-oos-state.json\",\n  );\n\nconst OBSERVATION_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs/alpha-v3-entry-v3-forward-oos-observations.json\",\n  );\n\n";

const collectorMain = "\nfunction kstClock(\n  now:\n    Date = new Date(),\n) {\n  const parts =\n    new Intl.DateTimeFormat(\n      \"en-US\",\n      {\n        timeZone:\n          \"Asia/Seoul\",\n        year:\n          \"numeric\",\n        month:\n          \"2-digit\",\n        day:\n          \"2-digit\",\n        hour:\n          \"2-digit\",\n        minute:\n          \"2-digit\",\n        hourCycle:\n          \"h23\",\n      },\n    ).formatToParts(\n      now,\n    );\n\n  const map =\n    new Map(\n      parts.map(\n        (part) => [\n          part.type,\n          part.value,\n        ],\n      ),\n    );\n\n  return {\n    date:\n      `${map.get(\"year\")}-${map.get(\"month\")}-${map.get(\"day\")}`,\n\n    hour:\n      Number(\n        map.get(\"hour\") ??\n        0,\n      ),\n\n    minute:\n      Number(\n        map.get(\"minute\") ??\n        0,\n      ),\n  };\n}\n\nexport function targetSessionReadyForEntryCollection(\n  targetSessionDate:\n    string,\n  now:\n    Date = new Date(),\n) {\n  const clock =\n    kstClock(\n      now,\n    );\n\n  if (\n    targetSessionDate <\n    clock.date\n  ) {\n    return true;\n  }\n\n  if (\n    targetSessionDate >\n    clock.date\n  ) {\n    return false;\n  }\n\n  return (\n    clock.hour * 60 +\n      clock.minute >=\n    15 * 60 +\n      40\n  );\n}\n\nfunction readJson(\n  file:\n    string,\n) {\n  return JSON.parse(\n    fs.readFileSync(\n      file,\n      \"utf8\",\n    ),\n  );\n}\n\nfunction writeJsonAtomic(\n  file:\n    string,\n  value:\n    unknown,\n) {\n  fs.mkdirSync(\n    path.dirname(\n      file,\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  const temp =\n    `${file}.tmp`;\n\n  fs.writeFileSync(\n    temp,\n    JSON.stringify(\n      value,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  fs.renameSync(\n    temp,\n    file,\n  );\n}\n\nfunction validateFrozenContract() {\n  if (\n    !fs.existsSync(\n      FROZEN_STATE_FILE,\n    )\n  ) {\n    throw new Error(\n      \"FORWARD_OOS_FROZEN_STATE_NOT_FOUND\",\n    );\n  }\n\n  const state =\n    readJson(\n      FROZEN_STATE_FILE,\n    );\n\n  if (\n    state.historicalCutoff !==\n      HISTORICAL_CUTOFF ||\n    Number(\n      state.selectedCap,\n    ) !==\n      FROZEN_PREMIUM_CAP ||\n    Number(\n      state.entryScoreThreshold,\n    ) !==\n      FROZEN_ENTRY_THRESHOLD ||\n    state.frozen !==\n      true\n  ) {\n    throw new Error(\n      \"FORWARD_OOS_FROZEN_CONTRACT_MISMATCH\",\n    );\n  }\n\n  return state;\n}\n\nfunction readObservationDataset() {\n  if (\n    !fs.existsSync(\n      OBSERVATION_FILE,\n    )\n  ) {\n    return {\n      version:\n        VERSION,\n\n      contract: {\n        historicalCutoff:\n          HISTORICAL_CUTOFF,\n\n        selectedCap:\n          FROZEN_PREMIUM_CAP,\n\n        entryScoreThreshold:\n          FROZEN_ENTRY_THRESHOLD,\n\n        retuningAllowed:\n          false,\n\n        candidateSource:\n          \"logs/alpha-v3-forward-top1-sessions.json\",\n\n        historicalCheckpointMutable:\n          false,\n      },\n\n      observations:\n        [],\n    };\n  }\n\n  const dataset =\n    readJson(\n      OBSERVATION_FILE,\n    );\n\n  if (\n    dataset.version !==\n    VERSION\n  ) {\n    throw new Error(\n      \"FORWARD_ENTRY_DATASET_VERSION_MISMATCH\",\n    );\n  }\n\n  dataset.observations =\n    Array.isArray(\n      dataset.observations,\n    )\n      ? dataset.observations\n      : [];\n\n  return dataset;\n}\n\nasync function readForwardDailyBars(\n  stockCode:\n    string,\n  targetSessionDate:\n    string,\n) {\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data,\n    error,\n  } =\n    await supabase\n      .from(\n        \"market_daily_bars\",\n      )\n      .select(\n        \"trading_date,open_price,close_price,adjusted_price\",\n      )\n      .eq(\n        \"stock_code\",\n        stockCode,\n      )\n      .eq(\n        \"adjusted_price\",\n        true,\n      )\n      .gte(\n        \"trading_date\",\n        targetSessionDate,\n      )\n      .order(\n        \"trading_date\",\n        {\n          ascending:\n            true,\n        },\n      )\n      .limit(\n        10,\n      );\n\n  if (\n    error\n  ) {\n    throw new Error(\n      `FORWARD_DAILY_BARS_READ_FAILED:${error.message}`,\n    );\n  }\n\n  return (\n    data ??\n    []\n  ).map(\n    (row: any) => ({\n      date:\n        String(\n          row.trading_date,\n        ),\n\n      open:\n        toNumber(\n          row.open_price,\n        ),\n\n      close:\n        toNumber(\n          row.close_price,\n        ),\n    }),\n  );\n}\n\nfunction computeReturn(\n  denominator:\n    number | null,\n  bar:\n    {\n      close:\n        number | null;\n    } | undefined,\n) {\n  if (\n    denominator ===\n      null ||\n    denominator <=\n      0 ||\n    !bar ||\n    bar.close ===\n      null\n  ) {\n    return null;\n  }\n\n  return (\n    bar.close /\n      denominator -\n    1\n  );\n}\n\nasync function enrichMaturedLabels(\n  observation:\n    any,\n) {\n  const bars =\n    await readForwardDailyBars(\n      String(\n        observation.stockCode,\n      ),\n      String(\n        observation.targetSessionDate,\n      ),\n    );\n\n  const b1 =\n    bars[0];\n\n  const b3 =\n    bars[2];\n\n  const b5 =\n    bars[4];\n\n  const entryPrice =\n    toNumber(\n      observation.correctedEntry\n        ?.entryPrice,\n    );\n\n  const fillPrice =\n    toNumber(\n      observation.selectedPolicy\n        ?.fillPrice,\n    );\n\n  observation.correctedEntry =\n    observation.correctedEntry ??\n    {};\n\n  observation.correctedEntry.directReturns = {\n    r1:\n      computeReturn(\n        entryPrice,\n        b1,\n      ),\n\n    r3:\n      computeReturn(\n        entryPrice,\n        b3,\n      ),\n\n    r5:\n      computeReturn(\n        entryPrice,\n        b5,\n      ),\n  };\n\n  observation.selectedPolicy =\n    observation.selectedPolicy ??\n    {};\n\n  observation.selectedPolicy.returns = {\n    r1:\n      computeReturn(\n        fillPrice,\n        b1,\n      ),\n\n    r3:\n      computeReturn(\n        fillPrice,\n        b3,\n      ),\n\n    r5:\n      computeReturn(\n        fillPrice,\n        b5,\n      ),\n  };\n\n  observation.maturity = {\n    r1:\n      Boolean(\n        b1,\n      ),\n\n    r3:\n      Boolean(\n        b3,\n      ),\n\n    r5:\n      Boolean(\n        b5,\n      ),\n\n    latestAvailableTradingDate:\n      bars.at(-1)\n        ?.date ??\n      null,\n\n    refreshedAt:\n      new Date()\n        .toISOString(),\n  };\n\n  return {\n    bars,\n    observation,\n  };\n}\n\nexport async function runTrueForwardEntryCollector(\n  now:\n    Date = new Date(),\n) {\n  validateFrozenContract();\n\n  if (\n    !fs.existsSync(\n      FORWARD_TOP1_FILE,\n    )\n  ) {\n    throw new Error(\n      \"FORWARD_TOP1_FILE_NOT_FOUND\",\n    );\n  }\n\n  const forward =\n    readJson(\n      FORWARD_TOP1_FILE,\n    );\n\n  const sessions =\n    Array.isArray(\n      forward.sessions,\n    )\n      ? forward.sessions\n      : [];\n\n  const dataset =\n    readObservationDataset();\n\n  const byKey =\n    new Map(\n      dataset.observations.map(\n        (row: any) => [\n          `${row.sourceTradingDate}|${row.targetSessionDate}|${row.stockCode}`,\n          row,\n        ],\n      ),\n    );\n\n  let labelsUpdated =\n    0;\n\n  for (\n    const observation of\n      dataset.observations\n  ) {\n    const before =\n      JSON.stringify({\n        direct:\n          observation.correctedEntry\n            ?.directReturns ??\n          null,\n\n        policy:\n          observation.selectedPolicy\n            ?.returns ??\n          null,\n\n        maturity:\n          observation.maturity ??\n          null,\n      });\n\n    await enrichMaturedLabels(\n      observation,\n    );\n\n    const after =\n      JSON.stringify({\n        direct:\n          observation.correctedEntry\n            ?.directReturns ??\n          null,\n\n        policy:\n          observation.selectedPolicy\n            ?.returns ??\n          null,\n\n        maturity:\n          observation.maturity ??\n          null,\n      });\n\n    if (\n      before !==\n      after\n    ) {\n      labelsUpdated +=\n        1;\n    }\n  }\n\n  const eligible =\n    sessions\n      .filter(\n        (session: any) =>\n          session.frozen ===\n            true &&\n          String(\n            session.sourceTradingDate,\n          ) >\n            HISTORICAL_CUTOFF &&\n          targetSessionReadyForEntryCollection(\n            String(\n              session.targetSessionDate,\n            ),\n            now,\n          ),\n      )\n      .filter(\n        (session: any) => {\n          const key =\n            `${session.sourceTradingDate}|${session.targetSessionDate}|${session.top1?.stockCode}`;\n\n          return !byKey.has(\n            key,\n          );\n        },\n      )\n      .sort(\n        (a: any, b: any) =>\n          String(\n            a.targetSessionDate,\n          ).localeCompare(\n            String(\n              b.targetSessionDate,\n            ),\n          ),\n      );\n\n  const maxSessions =\n    Math.max(\n      1,\n      Math.min(\n        5,\n        Number(\n          process.env.FORWARD_OOS_COLLECT_MAX_SESSIONS ??\n          3,\n        ) ||\n        3,\n      ),\n    );\n\n  const batch =\n    eligible.slice(\n      0,\n      maxSessions,\n    );\n\n  if (\n    batch.length ===\n    0\n  ) {\n    if (\n      labelsUpdated >\n      0\n    ) {\n      writeJsonAtomic(\n        OBSERVATION_FILE,\n        dataset,\n      );\n    }\n\n    return {\n      status:\n        \"ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_NO_ELIGIBLE_TARGET_SESSION\",\n\n      counts: {\n        frozenCandidateSessions:\n          sessions.length,\n\n        observations:\n          dataset.observations.length,\n\n        labelsUpdated,\n\n        eligibleUnobservedSessions:\n          0,\n      },\n\n      kisRequests:\n        0,\n\n      outputFile:\n        \"logs/alpha-v3-entry-v3-forward-oos-observations.json\",\n\n      nextGate:\n        sessions.length ===\n        0\n          ? \"RUN_FORWARD_TOP1_PRODUCER_IN_CAPTURE_WINDOW\"\n          : \"WAIT_FOR_TARGET_SESSION_CLOSE_OR_LABEL_MATURITY\",\n\n      safety: {\n        databaseWrites:\n          0,\n        ordersCreated:\n          0,\n        positionsChanged:\n          0,\n        productionChanged:\n          false,\n        thresholdChanged:\n          false,\n      },\n    };\n  }\n\n  const accessToken =\n    await getKisAccessToken();\n\n  let kisRequests =\n    0;\n\n  const completed:\n    any[] =\n    [];\n\n  const deferred:\n    any[] =\n    [];\n\n  for (\n    let index = 0;\n    index <\n    batch.length;\n    index += 1\n  ) {\n    const session =\n      batch[index];\n\n    const stockCode =\n      String(\n        session.top1.stockCode,\n      );\n\n    const targetSessionDate =\n      String(\n        session.targetSessionDate,\n      );\n\n    const dailyBars =\n      await readForwardDailyBars(\n        stockCode,\n        targetSessionDate,\n      );\n\n    const b1 =\n      dailyBars[0];\n\n    if (\n      !b1 ||\n      b1.date !==\n        targetSessionDate ||\n      b1.open ===\n        null\n    ) {\n      deferred.push({\n        sourceTradingDate:\n          session.sourceTradingDate,\n\n        targetSessionDate,\n\n        stockCode,\n\n        reason:\n          \"TARGET_DAILY_BAR_NOT_READY\",\n      });\n\n      continue;\n    }\n\n    const minute =\n      await fetchFullMinuteSession(\n        stockCode,\n        targetSessionDate,\n        accessToken,\n      );\n\n    kisRequests +=\n      minute.requestCount;\n\n    const fullCoverage =\n      minute.snapshots.length ===\n        381 &&\n      minute.earliestTime ===\n        \"090000\" &&\n      minute.latestTime ===\n        \"153000\";\n\n    if (\n      !fullCoverage\n    ) {\n      deferred.push({\n        sourceTradingDate:\n          session.sourceTradingDate,\n\n        targetSessionDate,\n\n        stockCode,\n\n        reason:\n          \"INCOMPLETE_381_MINUTE_COVERAGE\",\n\n        sourceRows:\n          minute.snapshots.length,\n\n        earliestTime:\n          minute.earliestTime,\n\n        latestTime:\n          minute.latestTime,\n      });\n\n      continue;\n    }\n\n    const signal =\n      firstQualified(\n        minute.snapshots,\n        FROZEN_ENTRY_THRESHOLD,\n      );\n\n    const sessionOpen =\n      b1.open;\n\n    let selectedPolicy:\n      any = {\n        maxPremium:\n          FROZEN_PREMIUM_CAP,\n\n        limitPrice:\n          null,\n\n        filled:\n          false,\n\n        fillPrice:\n          null,\n\n        observedAt:\n          null,\n\n        fillType:\n          null,\n\n        returns: {\n          r1:\n            null,\n          r3:\n            null,\n          r5:\n            null,\n        },\n      };\n\n    if (\n      signal\n    ) {\n      const limitPrice =\n        sessionOpen *\n        (\n          1 +\n          FROZEN_PREMIUM_CAP\n        );\n\n      selectedPolicy = {\n        maxPremium:\n          FROZEN_PREMIUM_CAP,\n\n        limitPrice,\n\n        ...simulateLimitFill(\n          minute.snapshots,\n          signal.observedAt,\n          limitPrice,\n        ),\n\n        returns: {\n          r1:\n            null,\n          r3:\n            null,\n          r5:\n            null,\n        },\n      };\n    }\n\n    const observation = {\n      sourceTradingDate:\n        String(\n          session.sourceTradingDate,\n        ),\n\n      targetSessionDate,\n\n      stockCode,\n\n      stockName:\n        session.top1.stockName,\n\n      candidateCapturedAt:\n        session.capturedAt,\n\n      sourceDataCutoffAtCollection:\n        session.sourceDataCutoffAtCollection,\n\n      alphaV2EffectiveScore:\n        session.top1.effectiveScore,\n\n      alphaV2RawPriceVolumeScore:\n        session.top1.rawPriceVolumeScore,\n\n      frozenEntryScoreThreshold:\n        FROZEN_ENTRY_THRESHOLD,\n\n      frozenPremiumCap:\n        FROZEN_PREMIUM_CAP,\n\n      entryObservedAt:\n        now.toISOString(),\n\n      minuteCoverage: {\n        sourceRows:\n          minute.snapshots.length,\n\n        earliestTime:\n          minute.earliestTime,\n\n        latestTime:\n          minute.latestTime,\n\n        fullCoverage:\n          true,\n      },\n\n      correctedEntry:\n        signal\n          ? {\n              qualified:\n                true,\n\n              observedAt:\n                signal.observedAt,\n\n              entryPrice:\n                signal.entryPrice,\n\n              score:\n                signal.score,\n\n              directReturns: {\n                r1:\n                  null,\n                r3:\n                  null,\n                r5:\n                  null,\n              },\n            }\n          : {\n              qualified:\n                false,\n\n              observedAt:\n                null,\n\n              entryPrice:\n                null,\n\n              score:\n                null,\n\n              directReturns: {\n                r1:\n                  null,\n                r3:\n                  null,\n                r5:\n                  null,\n              },\n            },\n\n      selectedPolicy,\n\n      maturity: {\n        r1:\n          false,\n        r3:\n          false,\n        r5:\n          false,\n        latestAvailableTradingDate:\n          null,\n        refreshedAt:\n          null,\n      },\n\n      immutableEvidence: {\n        candidateFrozenBeforeTargetOpen:\n          true,\n\n        historicalCheckpointTouched:\n          false,\n\n        retuningAllowed:\n          false,\n      },\n    };\n\n    await enrichMaturedLabels(\n      observation,\n    );\n\n    dataset.observations.push(\n      observation,\n    );\n\n    byKey.set(\n      `${observation.sourceTradingDate}|${observation.targetSessionDate}|${observation.stockCode}`,\n      observation,\n    );\n\n    completed.push(\n      observation,\n    );\n\n    writeJsonAtomic(\n      OBSERVATION_FILE,\n      dataset,\n    );\n\n    if (\n      index <\n      batch.length -\n        1\n    ) {\n      await sleep(\n        REQUEST_DELAY_MS,\n      );\n    }\n  }\n\n  writeJsonAtomic(\n    OBSERVATION_FILE,\n    dataset,\n  );\n\n  return {\n    status:\n      completed.length >\n      0\n        ? \"ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_COLLECTION_COMPLETE\"\n        : \"ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_COLLECTION_DEFERRED\",\n\n    counts: {\n      frozenCandidateSessions:\n        sessions.length,\n\n      previousObservations:\n        dataset.observations.length -\n        completed.length,\n\n      newlyObservedSessions:\n        completed.length,\n\n      deferredSessions:\n        deferred.length,\n\n      totalObservations:\n        dataset.observations.length,\n\n      labelsUpdated,\n    },\n\n    kisRequests,\n\n    completed:\n      completed.map(\n        (row) => ({\n          sourceTradingDate:\n            row.sourceTradingDate,\n\n          targetSessionDate:\n            row.targetSessionDate,\n\n          stockCode:\n            row.stockCode,\n\n          qualified:\n            row.correctedEntry\n              .qualified,\n\n          filled:\n            row.selectedPolicy\n              .filled,\n\n          maturity:\n            row.maturity,\n        }),\n      ),\n\n    deferred,\n\n    outputFile:\n      \"logs/alpha-v3-entry-v3-forward-oos-observations.json\",\n\n    safety: {\n      databaseReadsOnly:\n        true,\n\n      databaseWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionChanged:\n        false,\n\n      thresholdChanged:\n        false,\n\n      historicalCheckpointTouched:\n        false,\n    },\n\n    nextGate:\n      \"RUN_TRUE_FORWARD_OOS_EVALUATOR_AND_CONTINUE_DAILY_COLLECTION\",\n  };\n}\n\nasync function main() {\n  const result =\n    await runTrueForwardEntryCollector();\n\n  console.log(\n    JSON.stringify(\n      result,\n      null,\n      2,\n    ),\n  );\n}\n\nif (\n  require.main ===\n  module\n) {\n  main().catch(\n    (error) => {\n      console.error(\n        JSON.stringify(\n          {\n            status:\n              \"ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_COLLECTOR_FAILED\",\n\n            error:\n              error instanceof Error\n                ? error.message\n                : String(\n                    error,\n                  ),\n\n            safety: {\n              databaseWrites:\n                0,\n\n              ordersCreated:\n                0,\n\n              positionsChanged:\n                0,\n\n              productionChanged:\n                false,\n\n              historicalCheckpointTouched:\n                false,\n            },\n          },\n          null,\n          2,\n        ),\n      );\n\n      process.exitCode =\n        2;\n    },\n  );\n}\n";

const evaluatorSource = "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nconst VERSION =\n  \"ALPHA_V3_TRUE_FORWARD_OOS_EVALUATOR_V1\";\n\nconst OBSERVATION_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs/alpha-v3-entry-v3-forward-oos-observations.json\",\n  );\n\nconst OUTPUT_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs/alpha-v3-entry-v3-forward-shadow-oos.json\",\n  );\n\nconst HISTORICAL_CUTOFF =\n  \"2026-10-07\";\n\nconst FROZEN_ENTRY_THRESHOLD =\n  0.66;\n\nconst FROZEN_PREMIUM_CAP =\n  0.01;\n\nconst MIN_QUALIFIED_OBSERVATIONS =\n  80;\n\nconst MIN_CALENDAR_DAYS =\n  60;\n\nconst MIN_FILL_RATE =\n  0.90;\n\nconst MIN_PAIRED_POSITIVE_RATE =\n  0.80;\n\nfunction n(\n  value:\n    unknown,\n): number | null {\n  const x =\n    Number(value);\n\n  return Number.isFinite(x)\n    ? x\n    : null;\n}\n\nfunction stats(\n  values:\n    Array<\n      number |\n      null\n    >,\n) {\n  const xs =\n    values.filter(\n      (\n        value,\n      ): value is number =>\n        value !==\n          null &&\n        Number.isFinite(\n          value,\n        ),\n    );\n\n  const mean =\n    xs.length\n      ? xs.reduce(\n          (\n            sum,\n            value,\n          ) =>\n            sum +\n            value,\n          0,\n        ) /\n        xs.length\n      : null;\n\n  const positiveRate =\n    xs.length\n      ? xs.filter(\n          (value) =>\n            value >\n            0,\n        ).length /\n        xs.length\n      : null;\n\n  return {\n    count:\n      xs.length,\n    mean,\n    positiveRate,\n  };\n}\n\nfunction calendarSpanDays(\n  dates:\n    string[],\n) {\n  if (\n    dates.length ===\n    0\n  ) {\n    return 0;\n  }\n\n  const sorted =\n    [\n      ...dates,\n    ].sort();\n\n  const first =\n    Date.parse(\n      `${sorted[0]}T00:00:00.000Z`,\n    );\n\n  const last =\n    Date.parse(\n      `${sorted.at(-1)}T00:00:00.000Z`,\n    );\n\n  return (\n    Math.floor(\n      (\n        last -\n        first\n      ) /\n      86_400_000,\n    ) +\n    1\n  );\n}\n\nexport function evaluateForwardObservations(\n  observations:\n    any[],\n) {\n  const qualified =\n    observations.filter(\n      (row) =>\n        row.correctedEntry\n          ?.qualified ===\n        true,\n    );\n\n  const filled =\n    qualified.filter(\n      (row) =>\n        row.selectedPolicy\n          ?.filled ===\n        true,\n    );\n\n  const fillRate =\n    qualified.length >\n    0\n      ? filled.length /\n        qualified.length\n      : null;\n\n  const horizons =\n    (\n      [\n        \"r1\",\n        \"r3\",\n        \"r5\",\n      ] as const\n    ).map(\n      (horizon) => {\n        const paired =\n          filled\n            .map(\n              (row) => {\n                const direct =\n                  n(\n                    row.correctedEntry\n                      ?.directReturns\n                      ?.[horizon],\n                  );\n\n                const policy =\n                  n(\n                    row.selectedPolicy\n                      ?.returns\n                      ?.[horizon],\n                  );\n\n                if (\n                  direct ===\n                    null ||\n                  policy ===\n                    null\n                ) {\n                  return null;\n                }\n\n                return {\n                  direct,\n                  policy,\n                  improvement:\n                    policy -\n                    direct,\n                };\n              },\n            )\n            .filter(\n              Boolean,\n            ) as Array<{\n              direct: number;\n              policy: number;\n              improvement: number;\n            }>;\n\n        return {\n          horizon,\n\n          direct:\n            stats(\n              paired.map(\n                (row) =>\n                  row.direct,\n              ),\n            ),\n\n          policy:\n            stats(\n              paired.map(\n                (row) =>\n                  row.policy,\n              ),\n            ),\n\n          pairedImprovement:\n            stats(\n              paired.map(\n                (row) =>\n                  row.improvement,\n              ),\n            ),\n\n          pairedPositiveRate:\n            paired.length\n              ? paired.filter(\n                  (row) =>\n                    row.improvement >\n                    0,\n                ).length /\n                paired.length\n              : null,\n        };\n      },\n    );\n\n  const dates =\n    observations.map(\n      (row) =>\n        String(\n          row.targetSessionDate,\n        ),\n    );\n\n  const spanDays =\n    calendarSpanDays(\n      dates,\n    );\n\n  const r5 =\n    horizons.find(\n      (row) =>\n        row.horizon ===\n        \"r5\",\n    )!;\n\n  const enoughSample =\n    qualified.length >=\n      MIN_QUALIFIED_OBSERVATIONS &&\n    spanDays >=\n      MIN_CALENDAR_DAYS;\n\n  const fillPassed =\n    fillRate !==\n      null &&\n    fillRate >=\n      MIN_FILL_RATE;\n\n  const pairedPassed =\n    r5.pairedPositiveRate !==\n      null &&\n    r5.pairedPositiveRate >=\n      MIN_PAIRED_POSITIVE_RATE;\n\n  const forwardOosGatePassed =\n    enoughSample &&\n    fillPassed &&\n    pairedPassed;\n\n  return {\n    counts: {\n      observations:\n        observations.length,\n\n      qualifiedObservations:\n        qualified.length,\n\n      filledObservations:\n        filled.length,\n\n      calendarSpanDays:\n        spanDays,\n    },\n\n    fillRate,\n\n    horizons,\n\n    decision: {\n      enoughSample,\n      fillPassed,\n      pairedPassed,\n      forwardOosGatePassed,\n\n      selectedCap:\n        FROZEN_PREMIUM_CAP,\n\n      entryScoreThreshold:\n        FROZEN_ENTRY_THRESHOLD,\n\n      nextUse:\n        forwardOosGatePassed\n          ? \"READY_FOR_MANUAL_FORWARD_OOS_REVIEW\"\n          : \"CONTINUE_TRUE_FORWARD_OOS_COLLECTION\",\n    },\n  };\n}\n\nasync function main() {\n  const observations =\n    fs.existsSync(\n      OBSERVATION_FILE,\n    )\n      ? (\n          JSON.parse(\n            fs.readFileSync(\n              OBSERVATION_FILE,\n              \"utf8\",\n            ),\n          ).observations ??\n          []\n        )\n      : [];\n\n  const evaluation =\n    evaluateForwardObservations(\n      observations,\n    );\n\n  const report = {\n    status:\n      observations.length >\n      0\n        ? \"ALPHA_V3_TRUE_FORWARD_OOS_EVALUATED\"\n        : \"ALPHA_V3_TRUE_FORWARD_OOS_WAITING_FOR_OBSERVATIONS\",\n\n    version:\n      VERSION,\n\n    contract: {\n      historicalCutoff:\n        HISTORICAL_CUTOFF,\n\n      selectedCap:\n        FROZEN_PREMIUM_CAP,\n\n      entryScoreThreshold:\n        FROZEN_ENTRY_THRESHOLD,\n\n      retuningAllowed:\n        false,\n\n      minQualifiedObservations:\n        MIN_QUALIFIED_OBSERVATIONS,\n\n      minCalendarDays:\n        MIN_CALENDAR_DAYS,\n\n      minFillRate:\n        MIN_FILL_RATE,\n\n      minPairedPositiveRate:\n        MIN_PAIRED_POSITIVE_RATE,\n    },\n\n    ...evaluation,\n\n    interpretation: {\n      performanceClaimAllowed:\n        false,\n\n      reason:\n        \"True forward evidence accumulation only; passing the gate requires later manual review and does not enable live trading automatically.\",\n    },\n\n    safety: {\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      kisRequests:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionChanged:\n        false,\n\n      thresholdChanged:\n        false,\n    },\n\n    nextGate:\n      evaluation.decision\n        .forwardOosGatePassed\n        ? \"MANUAL_FORWARD_OOS_REVIEW_BEFORE_ANY_PROMOTION\"\n        : \"CONTINUE_TRUE_FORWARD_OOS_COLLECTION\",\n\n    outputFile:\n      \"logs/alpha-v3-entry-v3-forward-shadow-oos.json\",\n  };\n\n  fs.writeFileSync(\n    OUTPUT_FILE,\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n}\n\nif (\n  require.main ===\n  module\n) {\n  main().catch(\n    (error) => {\n      console.error(\n        JSON.stringify(\n          {\n            status:\n              \"ALPHA_V3_TRUE_FORWARD_OOS_EVALUATOR_FAILED\",\n\n            error:\n              error instanceof Error\n                ? error.message\n                : String(\n                    error,\n                  ),\n          },\n          null,\n          2,\n        ),\n      );\n\n      process.exitCode =\n        2;\n    },\n  );\n}\n";

const contractSource = "import {\n  strict as assert,\n} from \"node:assert\";\n\nimport {\n  classifyCaptureWindow,\n  nextExpectedKrxOpenDate,\n} from \"./alpha-v3-true-forward-top1-producer-v1\";\n\nimport {\n  targetSessionReadyForEntryCollection,\n} from \"./alpha-v3-true-entry-forward-oos-collector-v1\";\n\nimport {\n  evaluateForwardObservations,\n} from \"./alpha-v3-true-forward-oos-evaluator-v1\";\n\nasync function main() {\n  const checks:\n    Record<string, boolean> = {};\n\n  checks.nextWeekday =\n    nextExpectedKrxOpenDate(\n      \"2026-10-08\",\n      [],\n    ) ===\n      \"2026-10-09\";\n\n  checks.weekendSkipped =\n    nextExpectedKrxOpenDate(\n      \"2026-10-09\",\n      [],\n    ) ===\n      \"2026-10-12\";\n\n  checks.verifiedClosureSkipped =\n    nextExpectedKrxOpenDate(\n      \"2026-10-08\",\n      [\n        {\n          calendar_date:\n            \"2026-10-09\",\n          is_open:\n            false,\n          verified:\n            true,\n        },\n      ],\n    ) ===\n      \"2026-10-12\";\n\n  checks.beforeDecisionBlocked =\n    classifyCaptureWindow({\n      now:\n        new Date(\n          \"2026-10-08T14:59:00.000Z\",\n        ),\n      decisionAt:\n        \"2026-10-08T15:05:00.000Z\",\n      targetSessionDate:\n        \"2026-10-09\",\n    }) ===\n      \"BEFORE_DECISION_TIME\";\n\n  checks.preOpenCaptureAllowed =\n    classifyCaptureWindow({\n      now:\n        new Date(\n          \"2026-10-08T15:10:00.000Z\",\n        ),\n      decisionAt:\n        \"2026-10-08T15:05:00.000Z\",\n      targetSessionDate:\n        \"2026-10-09\",\n    }) ===\n      \"CAPTURE_WINDOW_OPEN\";\n\n  checks.afterOpenRetrospectiveBlocked =\n    classifyCaptureWindow({\n      now:\n        new Date(\n          \"2026-10-09T00:00:00.000Z\",\n        ),\n      decisionAt:\n        \"2026-10-08T15:05:00.000Z\",\n      targetSessionDate:\n        \"2026-10-09\",\n    }) ===\n      \"MISSED_CAPTURE_WINDOW\";\n\n  checks.collectorWaitsUntil1540 =\n    targetSessionReadyForEntryCollection(\n      \"2026-10-09\",\n      new Date(\n        \"2026-10-09T06:39:00.000Z\",\n      ),\n    ) ===\n      false &&\n    targetSessionReadyForEntryCollection(\n      \"2026-10-09\",\n      new Date(\n        \"2026-10-09T06:40:00.000Z\",\n      ),\n    ) ===\n      true;\n\n  const observations =\n    Array.from(\n      {\n        length:\n          80,\n      },\n      (\n        _,\n        index,\n      ) => ({\n        targetSessionDate:\n          index <\n          40\n            ? \"2026-10-09\"\n            : \"2026-12-10\",\n\n        correctedEntry: {\n          qualified:\n            true,\n\n          directReturns: {\n            r1:\n              0,\n            r3:\n              0,\n            r5:\n              0,\n          },\n        },\n\n        selectedPolicy: {\n          filled:\n            true,\n\n          returns: {\n            r1:\n              0.01,\n            r3:\n              0.01,\n            r5:\n              0.01,\n          },\n        },\n      }),\n    );\n\n  const evaluation =\n    evaluateForwardObservations(\n      observations,\n    );\n\n  checks.frozenFinalGateMath =\n    evaluation.counts\n      .qualifiedObservations ===\n      80 &&\n    evaluation.fillRate ===\n      1 &&\n    evaluation.counts\n      .calendarSpanDays >=\n      60 &&\n    evaluation.decision\n      .forwardOosGatePassed ===\n      true;\n\n  assert.equal(\n    evaluation.decision\n      .selectedCap,\n    0.01,\n  );\n\n  assert.equal(\n    evaluation.decision\n      .entryScoreThreshold,\n    0.66,\n  );\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          !value,\n      )\n      .map(\n        ([name]) =>\n          name,\n      );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          failed.length ===\n          0\n            ? \"ALPHA_V3_TRUE_FORWARD_OOS_PIPELINE_V1_CONTRACT_VERIFIED\"\n            : \"ALPHA_V3_TRUE_FORWARD_OOS_PIPELINE_V1_CONTRACT_REVIEW\",\n\n        checks,\n\n        failed,\n\n        contract: {\n          historicalCutoff:\n            \"2026-10-07\",\n\n          entryScoreThreshold:\n            0.66,\n\n          selectedCap:\n            0.01,\n\n          retrospectiveCandidateCreation:\n            false,\n\n          targetEntryCollectionAfter:\n            \"15:40 KST\",\n\n          minQualifiedObservations:\n            80,\n\n          minCalendarDays:\n            60,\n\n          minFillRate:\n            0.90,\n\n          minPairedPositiveRate:\n            0.80,\n        },\n\n        safety: {\n          databaseReads:\n            0,\n\n          databaseWrites:\n            0,\n\n          kisRequests:\n            0,\n\n          ordersCreated:\n            0,\n\n          positionsChanged:\n            0,\n\n          productionChanged:\n            false,\n        },\n\n        nextGate:\n          failed.length ===\n          0\n            ? \"STATIC_TYPESCRIPT_THEN_LIVE_PRODUCER_COLLECTOR_SMOKE\"\n            : \"REVIEW_TRUE_FORWARD_OOS_PIPELINE_V1\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  if (\n    failed.length >\n    0\n  ) {\n    process.exitCode =\n      2;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_TRUE_FORWARD_OOS_PIPELINE_V1_CONTRACT_FATAL\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(\n                  error,\n                ),\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n";

const staticVerifySource = "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root =\n  process.cwd();\n\nconst producer =\n  fs.readFileSync(\n    path.resolve(\n      root,\n      \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\"\n    ),\n    \"utf8\"\n  );\n\nconst collector =\n  fs.readFileSync(\n    path.resolve(\n      root,\n      \"scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts\"\n    ),\n    \"utf8\"\n  );\n\nconst evaluator =\n  fs.readFileSync(\n    path.resolve(\n      root,\n      \"scripts/alpha-v3-true-forward-oos-evaluator-v1.ts\"\n    ),\n    \"utf8\"\n  );\n\nconst pkg =\n  JSON.parse(\n    fs.readFileSync(\n      path.resolve(\n        root,\n        \"package.json\"\n      ),\n      \"utf8\"\n    )\n  );\n\nconst checks = {\n  cutoffFrozen:\n    producer.includes(\n      '\"2026-10-07\"'\n    ) &&\n    collector.includes(\n      '\"2026-10-07\"'\n    ) &&\n    evaluator.includes(\n      '\"2026-10-07\"'\n    ),\n\n  thresholdFrozen:\n    producer.includes(\n      \"FROZEN_ENTRY_THRESHOLD =\\n  0.66\"\n    ) &&\n    collector.includes(\n      \"FROZEN_ENTRY_THRESHOLD =\\n  0.66\"\n    ),\n\n  capFrozen:\n    producer.includes(\n      \"FROZEN_PREMIUM_CAP =\\n  0.01\"\n    ) &&\n    collector.includes(\n      \"FROZEN_PREMIUM_CAP =\\n  0.01\"\n    ),\n\n  producerUsesHistoricalRankingPrimitives:\n    producer.includes(\n      \"buildDailyPriceVolumeEvidence\"\n    ) &&\n    producer.includes(\n      \"calculateMarketRegimeFeatureVectorV7\"\n    ) &&\n    producer.includes(\n      \"evidence.score\"\n    ) &&\n    producer.includes(\n      \"evidence.confidence\"\n    ),\n\n  producerBlocksRetrospectiveCapture:\n    producer.includes(\n      \"MISSED_CAPTURE_WINDOW\"\n    ) &&\n    producer.includes(\n      \"retrospectiveCandidateCreated:\\n        false\"\n    ),\n\n  producerRequiresQualityPass:\n    producer.includes(\n      \"market_data_quality_gate_observations\"\n    ) &&\n    producer.includes(\n      'data.status ===\\n      \"PASS\"'\n    ) &&\n    producer.includes(\n      'data.freshness_status ===\\n      \"FRESH\"'\n    ) &&\n    producer.includes(\n      'data.integrity_status ===\\n      \"CLEAN\"'\n    ),\n\n  independentForwardFile:\n    producer.includes(\n      \"alpha-v3-forward-top1-sessions.json\"\n    ),\n\n  collectorIndependentDataset:\n    collector.includes(\n      \"alpha-v3-entry-v3-forward-oos-observations.json\"\n    ),\n\n  collectorUsesExactReplayPrimitives:\n    collector.includes(\n      \"function correctedSignal(\"\n    ) &&\n    collector.includes(\n      \"function firstQualified(\"\n    ) &&\n    collector.includes(\n      \"function simulateLimitFill(\"\n    ),\n\n  collectorFull381Coverage:\n    collector.includes(\n      \"minute.snapshots.length ===\\n        381\"\n    ) &&\n    collector.includes(\n      '\"090000\"'\n    ) &&\n    collector.includes(\n      '\"153000\"'\n    ),\n\n  collectorWaitsForSessionClose:\n    collector.includes(\n      \"15 * 60 +\\n      40\"\n    ),\n\n  maturityOnlyWhenBarsExist:\n    collector.includes(\n      \"const b1 =\"\n    ) &&\n    collector.includes(\n      \"const b3 =\"\n    ) &&\n    collector.includes(\n      \"const b5 =\"\n    ),\n\n  historicalCheckpointNotReferencedByRuntime:\n    !producer.includes(\n      \"extended-entry-v3-replay-checkpoint\"\n    ) &&\n    !collector.includes(\n      \"extended-entry-v3-replay-checkpoint\"\n    ) &&\n    !evaluator.includes(\n      \"extended-entry-v3-replay-checkpoint\"\n    ),\n\n  noOrders:\n    !producer.includes(\n      \"/api/orders/\"\n    ) &&\n    !collector.includes(\n      \"/api/orders/\"\n    ) &&\n    !evaluator.includes(\n      \"/api/orders/\"\n    ),\n\n  packageScripts:\n    pkg.scripts?.[\n      \"forward-oos:produce\"\n    ] ===\n      \"tsx --env-file=.env.local scripts/alpha-v3-true-forward-top1-producer-v1.ts\" &&\n    pkg.scripts?.[\n      \"forward-oos:collect\"\n    ] ===\n      \"tsx --env-file=.env.local scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts\" &&\n    pkg.scripts?.[\n      \"forward-oos:evaluate\"\n    ] ===\n      \"tsx scripts/alpha-v3-true-forward-oos-evaluator-v1.ts\" &&\n    pkg.scripts?.[\n      \"forward-oos:test\"\n    ] ===\n      \"tsx scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts\"\n};\n\nconst failed =\n  Object.entries(\n    checks\n  )\n    .filter(\n      ([, value]) =>\n        !value\n    )\n    .map(\n      ([name]) =>\n        name\n    );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length ===\n        0\n          ? \"ALPHA_V3_TRUE_FORWARD_OOS_PIPELINE_V1_STATIC_VERIFIED\"\n          : \"ALPHA_V3_TRUE_FORWARD_OOS_PIPELINE_V1_STATIC_REVIEW\",\n\n      checks,\n\n      failed,\n\n      frozenContract: {\n        historicalCutoff:\n          \"2026-10-07\",\n\n        entryScoreThreshold:\n          0.66,\n\n        selectedCap:\n          0.01,\n\n        retuningAllowed:\n          false\n      },\n\n      scientificControls: {\n        candidateFrozenBeforeTargetOpen:\n          true,\n\n        retrospectiveCandidateCreation:\n          false,\n\n        independentForwardDataset:\n          true,\n\n        labelsAppendedOnlyWhenFutureBarsExist:\n          true,\n\n        historicalCheckpointMutable:\n          false\n      },\n\n      safety: {\n        databaseWrites:\n          0,\n\n        ordersCreated:\n          0,\n\n        positionsChanged:\n          0,\n\n        productionChanged:\n          false\n      },\n\n      nextGate:\n        failed.length ===\n        0\n          ? \"CONTRACT_TYPESCRIPT_LIVE_FORWARD_SMOKE\"\n          : \"REVIEW_FORWARD_OOS_PIPELINE_V1\"\n    },\n    null,\n    2\n  )\n);\n\nif (\n  failed.length >\n  0\n) {\n  process.exitCode =\n    2;\n}\n";

const collectorSource =
  collectorPrefix +
  copiedFunctions +
  "\n\n" +
  collectorMain;

const outputs = [
  {
    rel:
      "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
    text:
      producerSource
  },
  {
    rel:
      "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
    text:
      collectorSource
  },
  {
    rel:
      "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",
    text:
      evaluatorSource
  },
  {
    rel:
      "scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts",
    text:
      contractSource
  },
  {
    rel:
      "scripts/alpha-v3-true-forward-oos-pipeline-v1-static-verify.cjs",
    text:
      staticVerifySource
  }
];

for (
  const item of
  outputs
) {
  const file =
    path.resolve(
      root,
      item.rel
    );

  fs.mkdirSync(
    path.dirname(
      file
    ),
    {
      recursive:
        true
    }
  );

  fs.writeFileSync(
    file,
    item.text,
    "utf8"
  );
}

const packagePath =
  path.resolve(
    root,
    "package.json"
  );

const pkg =
  JSON.parse(
    fs.readFileSync(
      packagePath,
      "utf8"
    )
  );

pkg.scripts =
  pkg.scripts ??
  {};

pkg.scripts[
  "forward-oos:produce"
] =
  "tsx --env-file=.env.local scripts/alpha-v3-true-forward-top1-producer-v1.ts";

pkg.scripts[
  "forward-oos:collect"
] =
  "tsx --env-file=.env.local scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts";

pkg.scripts[
  "forward-oos:evaluate"
] =
  "tsx scripts/alpha-v3-true-forward-oos-evaluator-v1.ts";

pkg.scripts[
  "forward-oos:test"
] =
  "tsx scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts";

fs.writeFileSync(
  packagePath,
  JSON.stringify(
    pkg,
    null,
    2
  ) +
  "\n",
  "utf8"
);

const provenancePath =
  path.resolve(
    root,
    "logs/alpha-v3-true-forward-oos-pipeline-v1-provenance.json"
  );

fs.mkdirSync(
  path.dirname(
    provenancePath
  ),
  {
    recursive:
      true
  }
);

fs.writeFileSync(
  provenancePath,
  JSON.stringify(
    {
      version:
        "ALPHA_V3_TRUE_FORWARD_OOS_PIPELINE_V1",

      installedAt:
        new Date()
          .toISOString(),

      provenance,

      copiedBatcherFunctions: [
        "sleep",
        "avg",
        "clamp",
        "toNumber",
        "previousMinute",
        "digitsDate",
        "toObservedAt",
        "fetchJsonWithRetry",
        "fetchPage",
        "fetchFullMinuteSession",
        "correctedSignal",
        "firstQualified",
        "simulateLimitFill"
      ],

      frozenContract: {
        historicalCutoff:
          "2026-10-07",

        entryScoreThreshold:
          0.66,

        selectedCap:
          0.01,

        retuningAllowed:
          false
      },

      historicalFilesModified:
        false
    },
    null,
    2
  ) +
  "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_TRUE_FORWARD_OOS_PIPELINE_V1_INSTALLED",

      generatedFiles:
        outputs.map(
          (item) =>
            item.rel
        ),

      provenance,

      implementation: {
        top1Ranking:
          "MATCH_HISTORICAL_PRICEVOLUME_PLUS_V7_REGIME_METHOD",

        entryLogic:
          "COPIED_FROM_CURRENT_EXTENDED_ENTRY_V3_REPLAY_BATCHER",

        candidateCapture:
          "ONLY_AFTER_DECISION_AT_AND_STRICTLY_BEFORE_TARGET_OPEN",

        retrospectiveCandidateCreation:
          false,

        entryObservation:
          "ONLY_AFTER_TARGET_SESSION_15_40_KST",

        labelMaturity:
          "R1_R3_R5_APPENDED_ONLY_WHEN_CORRESPONDING_FUTURE_DAILY_BARS_EXIST",

        historicalCheckpointTouched:
          false
      },

      frozenContract: {
        historicalCutoff:
          "2026-10-07",

        entryScoreThreshold:
          0.66,

        selectedCap:
          0.01,

        retuningAllowed:
          false
      },

      safety: {
        installerDatabaseReads:
          0,

        installerDatabaseWrites:
          0,

        installerKisRequests:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        productionChanged:
          false
      },

      nextAction:
        "STATIC_CONTRACT_TYPESCRIPT_THEN_LIVE_FORWARD_PRODUCER_COLLECTOR_SMOKE"
    },
    null,
    2
  )
);
