#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();

const sourceBatcher = path.resolve(
  root,
  "scripts/alpha-v3-extended-entry-v3-replay-batcher.ts"
);

if (!fs.existsSync(sourceBatcher)) {
  throw new Error(
    "SOURCE_BATCHER_NOT_FOUND:scripts/alpha-v3-extended-entry-v3-replay-batcher.ts"
  );
}

function write(rel, content) {
  const target = path.resolve(
    root,
    rel
  );

  fs.mkdirSync(
    path.dirname(target),
    { recursive: true }
  );

  fs.writeFileSync(
    target,
    content,
    "utf8"
  );
}

write(
  "scripts/alpha-v3-forward-top1-capture.ts",
  "import fs from \"node:fs\";\nimport path from \"node:path\";\nimport crypto from \"node:crypto\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nimport {\n  buildDailyPriceVolumeEvidence,\n} from \"../lib/alpha/daily-market-adapters\";\n\nimport {\n  calculateMarketRegimeFeatureVectorV7,\n} from \"../lib/market/market-regime-feature-engine\";\n\nconst VERSION =\n  \"ALPHA_V3_TRUE_FORWARD_TOP1_CAPTURE_V1\";\n\nconst HISTORICAL_TARGET_CUTOFF =\n  \"2026-10-07\";\n\nconst ROOT =\n  process.cwd();\n\nconst OUTPUT =\n  path.join(\n    ROOT,\n    \"logs\",\n    \"alpha-v3-forward-top1-sessions.json\",\n  );\n\nfunction toNumber(\n  value: unknown,\n): number | null {\n  if (\n    value === null ||\n    value === undefined ||\n    value === \"\"\n  ) {\n    return null;\n  }\n\n  const n =\n    Number(value);\n\n  return Number.isFinite(n)\n    ? n\n    : null;\n}\n\nfunction decisionAtForSource(\n  tradingDate: string,\n) {\n  return new Date(\n    `${tradingDate}T15:05:00.000Z`,\n  ).toISOString();\n}\n\nasync function fetchAllRows<T>(\n  buildQuery: (\n    from: number,\n    to: number,\n  ) => PromiseLike<{\n    data: T[] | null;\n    error: {\n      message?: string;\n    } | null;\n  }>,\n  label: string,\n): Promise<T[]> {\n  const pageSize =\n    1000;\n\n  const output: T[] =\n    [];\n\n  for (\n    let from = 0;\n    ;\n    from += pageSize\n  ) {\n    const to =\n      from +\n      pageSize -\n      1;\n\n    const result =\n      await buildQuery(\n        from,\n        to,\n      );\n\n    if (\n      result.error\n    ) {\n      throw new Error(\n        `${label}_READ_FAILED:${result.error.message ?? \"UNKNOWN\"}`,\n      );\n    }\n\n    const rows =\n      result.data ??\n      [];\n\n    output.push(\n      ...rows,\n    );\n\n    if (\n      rows.length <\n      pageSize\n    ) {\n      break;\n    }\n  }\n\n  return output;\n}\n\nfunction candidateFingerprint(\n  row: any,\n) {\n  const compact = {\n    sourceTradingDate:\n      row.sourceTradingDate,\n\n    decisionAt:\n      row.decisionAt,\n\n    candidateCount:\n      row.candidateCount,\n\n    top1: row.top1\n      ? {\n          stockCode:\n            row.top1.stockCode,\n          stockName:\n            row.top1.stockName,\n          market:\n            row.top1.market,\n          rawPriceVolumeScore:\n            row.top1.rawPriceVolumeScore,\n          confidence:\n            row.top1.confidence,\n          effectiveScore:\n            row.top1.effectiveScore,\n          availableAt:\n            row.top1.availableAt,\n          latestTradingDate:\n            row.top1.latestTradingDate,\n        }\n      : null,\n\n    top5:\n      (row.top5 ?? [])\n        .map(\n          (item: any) => ({\n            stockCode:\n              item.stockCode,\n            rawPriceVolumeScore:\n              item.rawPriceVolumeScore,\n            confidence:\n              item.confidence,\n            effectiveScore:\n              item.effectiveScore,\n            availableAt:\n              item.availableAt,\n            latestTradingDate:\n              item.latestTradingDate,\n          }),\n        ),\n  };\n\n  return crypto\n    .createHash(\n      \"sha256\",\n    )\n    .update(\n      JSON.stringify(\n        compact,\n      ),\n    )\n    .digest(\n      \"hex\",\n    );\n}\n\nfunction loadState() {\n  if (\n    !fs.existsSync(\n      OUTPUT,\n    )\n  ) {\n    return {\n      version:\n        \"ALPHA_V3_TRUE_FORWARD_TOP1_SESSIONS_V1\",\n\n      contract: {\n        historicalTargetCutoff:\n          HISTORICAL_TARGET_CUTOFF,\n\n        entryScoreThreshold:\n          0.66,\n\n        selectedCap:\n          0.01,\n\n        structure:\n          \"CORRECTED_ENTRY_GATE_PLUS_POST_SIGNAL_ANTI_CHASE_LIMIT\",\n\n        candidateSelection:\n          \"PRICE_VOLUME_TOP1_CONFIDENCE_SHRUNK_EFFECTIVE_SCORE\",\n\n        retuningAllowed:\n          false,\n\n        historicalFilesMutable:\n          false,\n      },\n\n      sessions: [],\n    };\n  }\n\n  const state =\n    JSON.parse(\n      fs.readFileSync(\n        OUTPUT,\n        \"utf8\",\n      ),\n    );\n\n  if (\n    state.version !==\n    \"ALPHA_V3_TRUE_FORWARD_TOP1_SESSIONS_V1\"\n  ) {\n    throw new Error(\n      \"FORWARD_TOP1_STATE_VERSION_MISMATCH\",\n    );\n  }\n\n  return state;\n}\n\nfunction targetOpenUtc(\n  targetSessionDate: string,\n) {\n  /*\n   * KRX regular session 09:00 KST = 00:00 UTC.\n   */\n  return new Date(\n    `${targetSessionDate}T00:00:00.000Z`,\n  ).toISOString();\n}\n\nasync function main() {\n  const now =\n    new Date();\n\n  const supabase =\n    createSupabaseServerClient();\n\n  const stockResult =\n    await supabase\n      .from(\n        \"stocks\",\n      )\n      .select(\n        \"stock_code,stock_name,market\",\n      )\n      .eq(\n        \"is_active\",\n        true,\n      )\n      .order(\n        \"stock_code\",\n      );\n\n  if (\n    stockResult.error\n  ) {\n    throw new Error(\n      `ACTIVE_STOCK_READ_FAILED:${stockResult.error.message}`,\n    );\n  }\n\n  const stocks =\n    stockResult.data ??\n    [];\n\n  if (\n    !stocks.length\n  ) {\n    throw new Error(\n      \"NO_ACTIVE_STOCKS\",\n    );\n  }\n\n  const stockCodes =\n    stocks.map(\n      (row: any) =>\n        String(\n          row.stock_code,\n        ),\n    );\n\n  const dailyBars =\n    await fetchAllRows<any>(\n      (from, to) =>\n        supabase\n          .from(\n            \"market_daily_bars\",\n          )\n          .select(\n            \"stock_code,trading_date,open_price,high_price,low_price,close_price,volume,trading_value,adjusted_price,source,updated_at\",\n          )\n          .in(\n            \"stock_code\",\n            stockCodes,\n          )\n          .eq(\n            \"adjusted_price\",\n            true,\n          )\n          .order(\n            \"trading_date\",\n            {\n              ascending:\n                true,\n            },\n          )\n          .order(\n            \"stock_code\",\n            {\n              ascending:\n                true,\n            },\n          )\n          .range(\n            from,\n            to,\n          ),\n\n      \"DAILY_BARS\",\n    );\n\n  const indexBarsRaw =\n    await fetchAllRows<any>(\n      (from, to) =>\n        supabase\n          .from(\n            \"market_index_daily_bars\",\n          )\n          .select(\n            \"market_code,trading_date,close_value\",\n          )\n          .in(\n            \"market_code\",\n            [\n              \"KOSPI\",\n              \"KOSDAQ\",\n            ],\n          )\n          .order(\n            \"trading_date\",\n            {\n              ascending:\n                true,\n            },\n          )\n          .order(\n            \"market_code\",\n            {\n              ascending:\n                true,\n            },\n          )\n          .range(\n            from,\n            to,\n          ),\n\n      \"INDEX_BARS\",\n    );\n\n  const tradingDates =\n    [\n      ...new Set(\n        dailyBars.map(\n          (row: any) =>\n            String(\n              row.trading_date,\n            ),\n        ),\n      ),\n    ].sort();\n\n  if (\n    tradingDates.length <\n    62\n  ) {\n    throw new Error(\n      `INSUFFICIENT_DAILY_HISTORY:${tradingDates.length}`,\n    );\n  }\n\n  const latestSourceTradingDate =\n    tradingDates.at(\n      -1,\n    )!;\n\n  const barsByStock =\n    new Map<\n      string,\n      any[]\n    >();\n\n  for (\n    const stock\n    of stocks\n  ) {\n    barsByStock.set(\n      String(\n        stock.stock_code,\n      ),\n      [],\n    );\n  }\n\n  for (\n    const row\n    of dailyBars\n  ) {\n    const code =\n      String(\n        row.stock_code,\n      );\n\n    const arr =\n      barsByStock.get(\n        code,\n      );\n\n    if (\n      arr\n    ) {\n      arr.push(\n        row,\n      );\n    }\n  }\n\n  const indexBarsAll =\n    indexBarsRaw\n      .map(\n        (row: any) => {\n          const close =\n            toNumber(\n              row.close_value,\n            );\n\n          const marketCode =\n            String(\n              row.market_code,\n            );\n\n          if (\n            close ===\n              null ||\n            (\n              marketCode !==\n                \"KOSPI\" &&\n              marketCode !==\n                \"KOSDAQ\"\n            )\n          ) {\n            return null;\n          }\n\n          return {\n            marketCode,\n            tradingDate:\n              String(\n                row.trading_date,\n              ),\n            close,\n          };\n        },\n      )\n      .filter(\n        Boolean,\n      ) as any[];\n\n  const state =\n    loadState();\n\n  /*\n   * Bind previously frozen candidates to the first ACTUAL trading date\n   * that later appeared in adjusted daily bars.\n   *\n   * Candidate choice is never changed here.\n   */\n  let newlyBoundTargets =\n    0;\n\n  let newlyExcludedLate =\n    0;\n\n  for (\n    const session\n    of state.sessions\n  ) {\n    if (\n      session.targetSessionDate\n    ) {\n      continue;\n    }\n\n    const targetSessionDate =\n      tradingDates.find(\n        (date) =>\n          date >\n          session.sourceTradingDate,\n      ) ??\n      null;\n\n    if (\n      !targetSessionDate\n    ) {\n      continue;\n    }\n\n    const openAt =\n      targetOpenUtc(\n        targetSessionDate,\n      );\n\n    const captureMs =\n      new Date(\n        session.capturedAt,\n      ).getTime();\n\n    const openMs =\n      new Date(\n        openAt,\n      ).getTime();\n\n    session.targetSessionDate =\n      targetSessionDate;\n\n    session.targetOpenAt =\n      openAt;\n\n    session.targetBoundAt =\n      now.toISOString();\n\n    session.integrity =\n      (\n        Number.isFinite(\n          captureMs,\n        ) &&\n        captureMs <\n          openMs\n      )\n        ? \"STRICT_TRUE_OOS\"\n        : \"LATE_CAPTURE_EXCLUDED\";\n\n    newlyBoundTargets +=\n      1;\n\n    if (\n      session.integrity ===\n      \"LATE_CAPTURE_EXCLUDED\"\n    ) {\n      newlyExcludedLate +=\n        1;\n    }\n  }\n\n  const decisionAt =\n    decisionAtForSource(\n      latestSourceTradingDate,\n    );\n\n  const existing =\n    state.sessions.find(\n      (row: any) =>\n        row.sourceTradingDate ===\n        latestSourceTradingDate,\n    );\n\n  let captureStatus =\n    \"NO_NEW_CAPTURE\";\n\n  let capturedSession:\n    any =\n    null;\n\n  if (\n    latestSourceTradingDate >=\n      HISTORICAL_TARGET_CUTOFF &&\n    now.getTime() >=\n      new Date(\n        decisionAt,\n      ).getTime()\n  ) {\n    const asOfDailyBars =\n      dailyBars.filter(\n        (row: any) =>\n          String(\n            row.trading_date,\n          ) <=\n          latestSourceTradingDate,\n      );\n\n    const indexBars =\n      indexBarsAll.filter(\n        (row: any) =>\n          row.tradingDate <=\n          latestSourceTradingDate,\n      );\n\n    const stockBars =\n      asOfDailyBars\n        .map(\n          (row: any) => {\n            const close =\n              toNumber(\n                row.close_price,\n              );\n\n            if (\n              close ===\n              null\n            ) {\n              return null;\n            }\n\n            return {\n              stockCode:\n                String(\n                  row.stock_code,\n                ),\n              tradingDate:\n                String(\n                  row.trading_date,\n                ),\n              close,\n            };\n          },\n        )\n        .filter(\n          Boolean,\n        ) as any[];\n\n    const v7Features =\n      calculateMarketRegimeFeatureVectorV7({\n        indexBars:\n          indexBars as any,\n        stockBars:\n          stockBars as any,\n      });\n\n    const ranking:\n      any[] =\n      [];\n\n    for (\n      const stock\n      of stocks\n    ) {\n      const stockCode =\n        String(\n          stock.stock_code,\n        );\n\n      const evidence =\n        buildDailyPriceVolumeEvidence({\n          stockCode,\n          market:\n            stock.market,\n          decisionAt,\n          rows:\n            barsByStock.get(\n              stockCode,\n            ) ??\n            [],\n          v7Features,\n        } as any);\n\n      if (\n        !evidence\n      ) {\n        continue;\n      }\n\n      const effectiveScore =\n        0.5 +\n        (\n          evidence.score -\n          0.5\n        ) *\n          evidence.confidence;\n\n      ranking.push({\n        stockCode,\n        stockName:\n          stock.stock_name,\n        market:\n          stock.market,\n\n        rawPriceVolumeScore:\n          evidence.score,\n\n        confidence:\n          evidence.confidence,\n\n        effectiveScore,\n\n        availableAt:\n          evidence.availableAt,\n\n        latestTradingDate:\n          (\n            evidence.metadata as\n              Record<\n                string,\n                unknown\n              >\n          )\n            ?.latestTradingDate ??\n          null,\n\n        metadata:\n          evidence.metadata,\n      });\n    }\n\n    ranking.sort(\n      (a, b) =>\n        b.effectiveScore -\n          a.effectiveScore ||\n        b.rawPriceVolumeScore -\n          a.rawPriceVolumeScore ||\n        a.stockCode.localeCompare(\n          b.stockCode,\n        ),\n    );\n\n    const top1 =\n      ranking[0];\n\n    if (\n      !top1\n    ) {\n      throw new Error(\n        \"NO_FORWARD_PRICEVOLUME_CANDIDATE\",\n      );\n    }\n\n    const candidate = {\n      sourceTradingDate:\n        latestSourceTradingDate,\n\n      decisionAt,\n\n      targetSessionDate:\n        existing\n          ?.targetSessionDate ??\n        null,\n\n      targetOpenAt:\n        existing\n          ?.targetOpenAt ??\n        null,\n\n      targetBoundAt:\n        existing\n          ?.targetBoundAt ??\n        null,\n\n      candidateCount:\n        ranking.length,\n\n      top1,\n\n      top5:\n        ranking.slice(\n          0,\n          5,\n        ),\n\n      capturedAt:\n        existing\n          ?.capturedAt ??\n        now.toISOString(),\n\n      integrity:\n        existing\n          ?.integrity ??\n        \"PENDING_TARGET_BIND\",\n    };\n\n    const fingerprint =\n      candidateFingerprint(\n        candidate,\n      );\n\n    if (\n      existing\n    ) {\n      if (\n        existing.candidateFingerprint !==\n        fingerprint\n      ) {\n        throw new Error(\n          `FORWARD_CANDIDATE_MUTATION_DETECTED:${latestSourceTradingDate}`,\n        );\n      }\n\n      captureStatus =\n        \"ALREADY_FROZEN\";\n\n      capturedSession =\n        existing;\n    } else {\n      candidate[\n        \"candidateFingerprint\"\n      ] =\n        fingerprint;\n\n      state.sessions.push(\n        candidate,\n      );\n\n      state.sessions.sort(\n        (\n          a: any,\n          b: any,\n        ) =>\n          String(\n            a.sourceTradingDate,\n          ).localeCompare(\n            String(\n              b.sourceTradingDate,\n            ),\n          ),\n      );\n\n      captureStatus =\n        \"NEW_CANDIDATE_FROZEN\";\n\n      capturedSession =\n        candidate;\n    }\n  } else if (\n    latestSourceTradingDate >=\n    HISTORICAL_TARGET_CUTOFF\n  ) {\n    captureStatus =\n      \"WAITING_FOR_DECISION_TIME\";\n  } else {\n    captureStatus =\n      \"WAITING_FOR_POST_CUTOFF_SOURCE_DATA\";\n  }\n\n  fs.mkdirSync(\n    path.dirname(\n      OUTPUT,\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  fs.writeFileSync(\n    OUTPUT,\n    JSON.stringify(\n      state,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  const strictCount =\n    state.sessions.filter(\n      (row: any) =>\n        row.integrity ===\n        \"STRICT_TRUE_OOS\",\n    ).length;\n\n  const pendingTargetCount =\n    state.sessions.filter(\n      (row: any) =>\n        row.integrity ===\n        \"PENDING_TARGET_BIND\",\n    ).length;\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          \"ALPHA_V3_TRUE_FORWARD_TOP1_CAPTURE_COMPLETE\",\n\n        version:\n          VERSION,\n\n        latestSourceTradingDate,\n\n        decisionAt,\n\n        captureStatus,\n\n        top1:\n          capturedSession\n            ?.top1\n            ?.stockCode ??\n          null,\n\n        totalFrozenCandidates:\n          state.sessions.length,\n\n        strictTrueOosCandidates:\n          strictCount,\n\n        pendingTargetBind:\n          pendingTargetCount,\n\n        newlyBoundTargets,\n\n        newlyExcludedLate,\n\n        outputFile:\n          \"logs/alpha-v3-forward-top1-sessions.json\",\n\n        nextGate:\n          captureStatus ===\n            \"WAITING_FOR_DECISION_TIME\"\n            ? \"RUN_AFTER_DECISION_TIME_AND_BEFORE_TARGET_SESSION_OPEN\"\n            : \"PREPARE_FORWARD_ENTRY_REPLAY\",\n      },\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_TRUE_FORWARD_TOP1_CAPTURE_FAILED\",\n\n          version:\n            VERSION,\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          databaseWrites:\n            0,\n\n          ordersCreated:\n            0,\n\n          productionChanged:\n            false,\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n"
);

write(
  "scripts/alpha-v3-forward-entry-prep.ts",
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nconst ROOT =\n  process.cwd();\n\nconst SOURCE =\n  path.join(\n    ROOT,\n    \"logs\",\n    \"alpha-v3-forward-top1-sessions.json\",\n  );\n\nconst HISTORY =\n  path.join(\n    ROOT,\n    \"logs\",\n    \"alpha-v3-forward-entry-compatible-history.json\",\n  );\n\nconst BOUNDARY =\n  path.join(\n    ROOT,\n    \"logs\",\n    \"alpha-v3-forward-entry-compatible-boundary.json\",\n  );\n\nconst STATE =\n  path.join(\n    ROOT,\n    \"logs\",\n    \"alpha-v3-forward-entry-prep-state.json\",\n  );\n\nasync function main() {\n  if (\n    !fs.existsSync(\n      SOURCE,\n    )\n  ) {\n    const result = {\n      status:\n        \"ALPHA_V3_FORWARD_ENTRY_PREP_WAITING\",\n\n      readyForBatcher:\n        false,\n\n      reason:\n        \"FORWARD_TOP1_STATE_NOT_FOUND\",\n\n      eligibleSessions:\n        0,\n    };\n\n    fs.writeFileSync(\n      STATE,\n      JSON.stringify(\n        result,\n        null,\n        2,\n      ) + \"\\n\",\n      \"utf8\",\n    );\n\n    console.log(\n      JSON.stringify(\n        result,\n        null,\n        2,\n      ),\n    );\n\n    return;\n  }\n\n  const source =\n    JSON.parse(\n      fs.readFileSync(\n        SOURCE,\n        \"utf8\",\n      ),\n    );\n\n  const strict =\n    (\n      source.sessions ??\n      []\n    )\n      .filter(\n        (row: any) =>\n          row.integrity ===\n            \"STRICT_TRUE_OOS\" &&\n          row.targetSessionDate &&\n          String(\n            row.targetSessionDate,\n          ) >\n            \"2026-10-07\",\n      )\n      .sort(\n        (\n          a: any,\n          b: any,\n        ) =>\n          `${a.targetSessionDate}|${a.top1?.stockCode ?? \"\"}`\n            .localeCompare(\n              `${b.targetSessionDate}|${b.top1?.stockCode ?? \"\"}`,\n            ),\n      );\n\n  if (\n    !strict.length\n  ) {\n    const result = {\n      status:\n        \"ALPHA_V3_FORWARD_ENTRY_PREP_WAITING\",\n\n      readyForBatcher:\n        false,\n\n      reason:\n        \"NO_STRICT_BOUND_TARGET_SESSION_YET\",\n\n      eligibleSessions:\n        0,\n    };\n\n    fs.mkdirSync(\n      path.dirname(\n        STATE,\n      ),\n      {\n        recursive:\n          true,\n      },\n    );\n\n    fs.writeFileSync(\n      STATE,\n      JSON.stringify(\n        result,\n        null,\n        2,\n      ) + \"\\n\",\n      \"utf8\",\n    );\n\n    console.log(\n      JSON.stringify(\n        result,\n        null,\n        2,\n      ),\n    );\n\n    return;\n  }\n\n  const supabase =\n    createSupabaseServerClient();\n\n  const targetDates =\n    [\n      ...new Set(\n        strict.map(\n          (row: any) =>\n            String(\n              row.targetSessionDate,\n            ),\n        ),\n      ),\n    ];\n\n  const stockCodes =\n    [\n      ...new Set(\n        strict.map(\n          (row: any) =>\n            String(\n              row.top1.stockCode,\n            ),\n        ),\n      ),\n    ];\n\n  const {\n    data:\n      availableBars,\n    error:\n      barError,\n  } =\n    await supabase\n      .from(\n        \"market_daily_bars\",\n      )\n      .select(\n        \"stock_code,trading_date,adjusted_price\",\n      )\n      .in(\n        \"stock_code\",\n        stockCodes,\n      )\n      .in(\n        \"trading_date\",\n        targetDates,\n      )\n      .eq(\n        \"adjusted_price\",\n        true,\n      )\n      .limit(\n        10000,\n      );\n\n  if (\n    barError\n  ) {\n    throw barError;\n  }\n\n  const available =\n    new Set(\n      (\n        availableBars ??\n        []\n      ).map(\n        (row: any) =>\n          `${String(row.trading_date)}|${String(row.stock_code)}`,\n      ),\n    );\n\n  const readySessions =\n    strict.filter(\n      (row: any) =>\n        available.has(\n          `${String(row.targetSessionDate)}|${String(row.top1.stockCode)}`,\n        ),\n    );\n\n  if (\n    !readySessions.length\n  ) {\n    const result = {\n      status:\n        \"ALPHA_V3_FORWARD_ENTRY_PREP_WAITING\",\n\n      readyForBatcher:\n        false,\n\n      reason:\n        \"TARGET_SESSION_DAILY_BAR_NOT_MATURE_YET\",\n\n      eligibleSessions:\n        strict.length,\n\n      matureTargetSessions:\n        0,\n    };\n\n    fs.writeFileSync(\n      STATE,\n      JSON.stringify(\n        result,\n        null,\n        2,\n      ) + \"\\n\",\n      \"utf8\",\n    );\n\n    console.log(\n      JSON.stringify(\n        result,\n        null,\n        2,\n      ),\n    );\n\n    return;\n  }\n\n  const start =\n    String(\n      readySessions[0]\n        .targetSessionDate,\n    );\n\n  const end =\n    String(\n      readySessions.at(\n        -1,\n      )\n        .targetSessionDate,\n    );\n\n  const history = {\n    status:\n      \"ALPHA_V3_TRUE_FORWARD_TOP1_COMPATIBLE_HISTORY_READY\",\n\n    version:\n      \"ALPHA_V3_TRUE_FORWARD_TOP1_COMPATIBLE_HISTORY_V1\",\n\n    contract:\n      source.contract,\n\n    top1Rows:\n      readySessions,\n  };\n\n  const boundary = {\n    status:\n      \"ALPHA_V3_KIS_INTRADAY_RETENTION_BOUNDARY_COMPLETE\",\n\n    version:\n      \"ALPHA_V3_TRUE_FORWARD_COMPATIBLE_BOUNDARY_V1\",\n\n    boundary: {\n      monotonicBoundaryValid:\n        true,\n\n      source:\n        \"TRUE_FORWARD_STRICT_OOS_TARGETS\",\n    },\n\n    usableRange: {\n      start,\n      end,\n      top1SessionCount:\n        readySessions.length,\n    },\n  };\n\n  const result = {\n    status:\n      \"ALPHA_V3_FORWARD_ENTRY_PREP_READY\",\n\n    readyForBatcher:\n      true,\n\n    eligibleSessions:\n      strict.length,\n\n    matureTargetSessions:\n      readySessions.length,\n\n    start,\n    end,\n\n    historyFile:\n      \"logs/alpha-v3-forward-entry-compatible-history.json\",\n\n    boundaryFile:\n      \"logs/alpha-v3-forward-entry-compatible-boundary.json\",\n  };\n\n  fs.writeFileSync(\n    HISTORY,\n    JSON.stringify(\n      history,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  fs.writeFileSync(\n    BOUNDARY,\n    JSON.stringify(\n      boundary,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  fs.writeFileSync(\n    STATE,\n    JSON.stringify(\n      result,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      result,\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_FORWARD_ENTRY_PREP_FAILED\",\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          databaseWrites:\n            0,\n\n          ordersCreated:\n            0,\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n"
);

write(
  "scripts/alpha-v3-forward-entry-maturity-update.ts",
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nconst ROOT =\n  process.cwd();\n\nconst CHECKPOINT =\n  path.join(\n    ROOT,\n    \"logs\",\n    \"alpha-v3-true-forward-entry-v3-checkpoint.json\",\n  );\n\nfunction finite(\n  value: unknown,\n): value is number {\n  return (\n    typeof value ===\n      \"number\" &&\n    Number.isFinite(\n      value,\n    )\n  );\n}\n\nasync function main() {\n  if (\n    !fs.existsSync(\n      CHECKPOINT,\n    )\n  ) {\n    console.log(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_FORWARD_ENTRY_MATURITY_WAITING\",\n\n          reason:\n            \"FORWARD_ENTRY_CHECKPOINT_NOT_FOUND\",\n\n          updatedLabels:\n            0,\n        },\n        null,\n        2,\n      ),\n    );\n\n    return;\n  }\n\n  const checkpoint =\n    JSON.parse(\n      fs.readFileSync(\n        CHECKPOINT,\n        \"utf8\",\n      ),\n    );\n\n  const rows =\n    checkpoint.results ??\n    [];\n\n  if (\n    !rows.length\n  ) {\n    console.log(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_FORWARD_ENTRY_MATURITY_WAITING\",\n\n          reason:\n            \"NO_FORWARD_ENTRY_RESULTS\",\n\n          updatedLabels:\n            0,\n        },\n        null,\n        2,\n      ),\n    );\n\n    return;\n  }\n\n  const stockCodes =\n    [\n      ...new Set(\n        rows.map(\n          (row: any) =>\n            String(\n              row.stockCode,\n            ),\n        ),\n      ),\n    ];\n\n  const firstDate =\n    rows\n      .map(\n        (row: any) =>\n          String(\n            row.targetSessionDate,\n          ),\n      )\n      .sort()[0];\n\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data,\n    error,\n  } =\n    await supabase\n      .from(\n        \"market_daily_bars\",\n      )\n      .select(\n        \"stock_code,trading_date,close_price,adjusted_price\",\n      )\n      .in(\n        \"stock_code\",\n        stockCodes,\n      )\n      .eq(\n        \"adjusted_price\",\n        true,\n      )\n      .gte(\n        \"trading_date\",\n        firstDate,\n      )\n      .lte(\n        \"trading_date\",\n        new Date()\n          .toISOString()\n          .slice(\n            0,\n            10,\n          ),\n      )\n      .order(\n        \"stock_code\",\n      )\n      .order(\n        \"trading_date\",\n      )\n      .limit(\n        10000,\n      );\n\n  if (\n    error\n  ) {\n    throw error;\n  }\n\n  const barsByStock =\n    new Map<\n      string,\n      Array<{\n        date: string;\n        close: number;\n      }>\n    >();\n\n  for (\n    const bar\n    of data ??\n      []\n  ) {\n    const close =\n      Number(\n        bar.close_price,\n      );\n\n    if (\n      !Number.isFinite(\n        close,\n      ) ||\n      close <=\n        0\n    ) {\n      continue;\n    }\n\n    const code =\n      String(\n        bar.stock_code,\n      );\n\n    const arr =\n      barsByStock.get(\n        code,\n      ) ??\n      [];\n\n    arr.push({\n      date:\n        String(\n          bar.trading_date,\n        ),\n      close,\n    });\n\n    barsByStock.set(\n      code,\n      arr,\n    );\n  }\n\n  let updatedLabels =\n    0;\n\n  const matured = {\n    r1: 0,\n    r3: 0,\n    r5: 0,\n  };\n\n  const horizonIndex = {\n    r1: 0,\n    r3: 2,\n    r5: 4,\n  } as const;\n\n  for (\n    const row\n    of rows\n  ) {\n    const bars =\n      (\n        barsByStock.get(\n          String(\n            row.stockCode,\n          ),\n        ) ??\n        []\n      ).filter(\n        (bar) =>\n          bar.date >=\n          String(\n            row.targetSessionDate,\n          ),\n      );\n\n    const applyReturns = (\n      target:\n        Record<\n          \"r1\" |\n          \"r3\" |\n          \"r5\",\n          number | null\n        >,\n      entryPrice:\n        number,\n    ) => {\n      for (\n        const horizon\n        of [\n          \"r1\",\n          \"r3\",\n          \"r5\",\n        ] as const\n      ) {\n        if (\n          finite(\n            target[\n              horizon\n            ],\n          )\n        ) {\n          matured[\n            horizon\n          ] +=\n            1;\n\n          continue;\n        }\n\n        const bar =\n          bars[\n            horizonIndex[\n              horizon\n            ]\n          ];\n\n        if (\n          !bar\n        ) {\n          continue;\n        }\n\n        target[\n          horizon\n        ] =\n          bar.close /\n            entryPrice -\n          1;\n\n        matured[\n          horizon\n        ] +=\n          1;\n\n        updatedLabels +=\n          1;\n      }\n    };\n\n    if (\n      row.correctedEntry\n        ?.qualified ===\n        true &&\n      finite(\n        row.correctedEntry\n          ?.entryPrice,\n      ) &&\n      row.correctedEntry\n        .entryPrice >\n        0\n    ) {\n      row.correctedEntry\n        .directReturns ??= {\n          r1: null,\n          r3: null,\n          r5: null,\n        };\n\n      applyReturns(\n        row.correctedEntry\n          .directReturns,\n\n        row.correctedEntry\n          .entryPrice,\n      );\n    }\n\n    for (\n      const policy\n      of row.limitPolicies ??\n        []\n    ) {\n      if (\n        Number(\n          policy.maxPremium,\n        ) !==\n          0.01 ||\n        policy.filled !==\n          true ||\n        !finite(\n          policy.fillPrice,\n        ) ||\n        policy.fillPrice <=\n          0\n      ) {\n        continue;\n      }\n\n      policy.returns ??= {\n        r1: null,\n        r3: null,\n        r5: null,\n      };\n\n      applyReturns(\n        policy.returns,\n        policy.fillPrice,\n      );\n    }\n\n    row.forwardMaturity = {\n      checkedAt:\n        new Date()\n          .toISOString(),\n\n      availableTradingBars:\n        bars.length,\n    };\n  }\n\n  fs.writeFileSync(\n    CHECKPOINT,\n    JSON.stringify(\n      checkpoint,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          \"ALPHA_V3_FORWARD_ENTRY_MATURITY_UPDATE_COMPLETE\",\n\n        resultRows:\n          rows.length,\n\n        updatedLabels,\n\n        matured,\n\n        checkpointFile:\n          \"logs/alpha-v3-true-forward-entry-v3-checkpoint.json\",\n      },\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_FORWARD_ENTRY_MATURITY_UPDATE_FAILED\",\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          databaseWrites:\n            0,\n\n          ordersCreated:\n            0,\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n"
);

write(
  "scripts/alpha-v3-true-forward-oos-summary.ts",
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nconst ROOT =\n  process.cwd();\n\nconst TOP1 =\n  path.join(\n    ROOT,\n    \"logs\",\n    \"alpha-v3-forward-top1-sessions.json\",\n  );\n\nconst CHECKPOINT =\n  path.join(\n    ROOT,\n    \"logs\",\n    \"alpha-v3-true-forward-entry-v3-checkpoint.json\",\n  );\n\nfunction finite(\n  value: unknown,\n): value is number {\n  return (\n    typeof value ===\n      \"number\" &&\n    Number.isFinite(\n      value,\n    )\n  );\n}\n\nfunction stats(\n  values: number[],\n) {\n  if (\n    !values.length\n  ) {\n    return {\n      count: 0,\n      mean: null,\n      positiveRate:\n        null,\n    };\n  }\n\n  return {\n    count:\n      values.length,\n\n    mean:\n      values.reduce(\n        (\n          sum,\n          value,\n        ) =>\n          sum +\n          value,\n        0,\n      ) /\n      values.length,\n\n    positiveRate:\n      values.filter(\n        (value) =>\n          value >\n          0,\n      ).length /\n      values.length,\n  };\n}\n\nfunction daysBetween(\n  a: string,\n  b: string,\n) {\n  return Math.floor(\n    (\n      new Date(\n        `${b}T00:00:00Z`,\n      ).getTime() -\n      new Date(\n        `${a}T00:00:00Z`,\n      ).getTime()\n    ) /\n    86_400_000,\n  );\n}\n\nfunction main() {\n  const top1 =\n    fs.existsSync(\n      TOP1,\n    )\n      ? JSON.parse(\n          fs.readFileSync(\n            TOP1,\n            \"utf8\",\n          ),\n        )\n      : {\n          sessions:\n            [],\n        };\n\n  const checkpoint =\n    fs.existsSync(\n      CHECKPOINT,\n    )\n      ? JSON.parse(\n          fs.readFileSync(\n            CHECKPOINT,\n            \"utf8\",\n          ),\n        )\n      : {\n          results:\n            [],\n        };\n\n  const sessions =\n    top1.sessions ??\n    [];\n\n  const strict =\n    sessions.filter(\n      (row: any) =>\n        row.integrity ===\n        \"STRICT_TRUE_OOS\",\n    );\n\n  const results =\n    checkpoint.results ??\n    [];\n\n  const full =\n    results.filter(\n      (row: any) =>\n        row.minuteCoverage\n          ?.fullCoverage ===\n          true &&\n        row.minuteCoverage\n          ?.sourceRows ===\n          381,\n    );\n\n  const qualified =\n    full.filter(\n      (row: any) =>\n        row.correctedEntry\n          ?.qualified ===\n        true,\n    );\n\n  const filled =\n    qualified\n      .map(\n        (row: any) => ({\n          row,\n          policy:\n            (\n              row.limitPolicies ??\n              []\n            ).find(\n              (policy: any) =>\n                Number(\n                  policy.maxPremium,\n                ) ===\n                0.01,\n            ),\n        }),\n      )\n      .filter(\n        (item: any) =>\n          item.policy\n            ?.filled ===\n          true,\n      );\n\n  const paired:\n    Record<\n      \"r1\" |\n      \"r3\" |\n      \"r5\",\n      number[]\n    > = {\n      r1: [],\n      r3: [],\n      r5: [],\n    };\n\n  const direct:\n    Record<\n      \"r1\" |\n      \"r3\" |\n      \"r5\",\n      number[]\n    > = {\n      r1: [],\n      r3: [],\n      r5: [],\n    };\n\n  const limit:\n    Record<\n      \"r1\" |\n      \"r3\" |\n      \"r5\",\n      number[]\n    > = {\n      r1: [],\n      r3: [],\n      r5: [],\n    };\n\n  for (\n    const item\n    of filled\n  ) {\n    for (\n      const horizon\n      of [\n        \"r1\",\n        \"r3\",\n        \"r5\",\n      ] as const\n    ) {\n      const d =\n        item.row\n          .correctedEntry\n          ?.directReturns\n          ?.[\n            horizon\n          ];\n\n      const l =\n        item.policy\n          ?.returns\n          ?.[\n            horizon\n          ];\n\n      if (\n        finite(\n          d,\n        )\n      ) {\n        direct[\n          horizon\n        ].push(\n          d,\n        );\n      }\n\n      if (\n        finite(\n          l,\n        )\n      ) {\n        limit[\n          horizon\n        ].push(\n          l,\n        );\n      }\n\n      if (\n        finite(\n          d,\n        ) &&\n        finite(\n          l,\n        )\n      ) {\n        paired[\n          horizon\n        ].push(\n          l -\n          d,\n        );\n      }\n    }\n  }\n\n  const targetDates =\n    strict\n      .map(\n        (row: any) =>\n          row.targetSessionDate,\n      )\n      .filter(\n        Boolean,\n      )\n      .sort();\n\n  const calendarDays =\n    targetDates.length >=\n      2\n      ? daysBetween(\n          targetDates[0],\n          targetDates.at(\n            -1,\n          ),\n        )\n      : 0;\n\n  const fillRate =\n    qualified.length\n      ? filled.length /\n        qualified.length\n      : null;\n\n  const pairedStats = {\n    r1:\n      stats(\n        paired.r1,\n      ),\n    r3:\n      stats(\n        paired.r3,\n      ),\n    r5:\n      stats(\n        paired.r5,\n      ),\n  };\n\n  const finalGate = {\n    qualifiedAtLeast80:\n      qualified.length >=\n      80,\n\n    calendarDaysAtLeast60:\n      calendarDays >=\n      60,\n\n    fillRateAtLeast90Pct:\n      fillRate !==\n        null &&\n      fillRate >=\n        0.90,\n\n    pairedPositiveR1:\n      pairedStats.r1\n        .mean !==\n        null &&\n      pairedStats.r1\n        .mean >\n        0,\n\n    pairedPositiveR3:\n      pairedStats.r3\n        .mean !==\n        null &&\n      pairedStats.r3\n        .mean >\n        0,\n\n    pairedPositiveR5:\n      pairedStats.r5\n        .mean !==\n        null &&\n      pairedStats.r5\n        .mean >\n        0,\n  };\n\n  const result = {\n    status:\n      \"ALPHA_V3_TRUE_FORWARD_OOS_SUMMARY_COMPLETE\",\n\n    contract: {\n      historicalTargetCutoff:\n        \"2026-10-07\",\n\n      selectedCap:\n        0.01,\n\n      entryScoreThreshold:\n        0.66,\n\n      retuningAllowed:\n        false,\n    },\n\n    counts: {\n      frozenCandidates:\n        sessions.length,\n\n      strictTrueOosCandidates:\n        strict.length,\n\n      pendingTargetBind:\n        sessions.filter(\n          (row: any) =>\n            row.integrity ===\n            \"PENDING_TARGET_BIND\",\n        ).length,\n\n      lateCaptureExcluded:\n        sessions.filter(\n          (row: any) =>\n            row.integrity ===\n            \"LATE_CAPTURE_EXCLUDED\",\n        ).length,\n\n      entryResults:\n        results.length,\n\n      full381Sessions:\n        full.length,\n\n      qualifiedSessions:\n        qualified.length,\n\n      filledSessions:\n        filled.length,\n    },\n\n    span: {\n      firstTargetDate:\n        targetDates[0] ??\n        null,\n\n      lastTargetDate:\n        targetDates.at(\n          -1,\n        ) ??\n        null,\n\n      calendarDays,\n    },\n\n    performance: {\n      fillRate,\n\n      direct: {\n        r1:\n          stats(\n            direct.r1,\n          ),\n        r3:\n          stats(\n            direct.r3,\n          ),\n        r5:\n          stats(\n            direct.r5,\n          ),\n      },\n\n      limit: {\n        r1:\n          stats(\n            limit.r1,\n          ),\n        r3:\n          stats(\n            limit.r3,\n          ),\n        r5:\n          stats(\n            limit.r5,\n          ),\n      },\n\n      pairedVsDirect:\n        pairedStats,\n    },\n\n    finalGate,\n\n    decision: {\n      trueForwardReady:\n        true,\n\n      productionPolicyLocked:\n        false,\n\n      enoughEvidenceForFinalEntryGate:\n        Object.values(\n          finalGate,\n        ).every(\n          Boolean,\n        ),\n\n      nextUse:\n        Object.values(\n          finalGate,\n        ).every(\n          Boolean,\n        )\n          ? \"REVIEW_TRUE_FORWARD_OOS_AND_THEN_EXIT_CHALLENGERS\"\n          : \"CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING\",\n    },\n\n    safety: {\n      databaseWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionChanged:\n        false,\n    },\n  };\n\n  fs.writeFileSync(\n    path.join(\n      ROOT,\n      \"logs\",\n      \"alpha-v3-true-forward-oos-summary.json\",\n    ),\n    JSON.stringify(\n      result,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      result,\n      null,\n      2,\n    ),\n  );\n}\n\ntry {\n  main();\n} catch (error) {\n  console.error(\n    JSON.stringify(\n      {\n        status:\n          \"ALPHA_V3_TRUE_FORWARD_OOS_SUMMARY_FAILED\",\n\n        error:\n          String(\n            error instanceof Error\n              ? error.message\n              : error,\n          ),\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode =\n    2;\n}\n"
);

let batcher = fs
  .readFileSync(
    sourceBatcher,
    "utf8"
  )
  .replace(/\r\n/g, "\n");

const replacements = [
  [
    /alpha-v3-extended-pricevolume-top1-history\.json/g,
    "alpha-v3-forward-entry-compatible-history.json"
  ],
  [
    /alpha-v3-kis-intraday-retention-boundary\.json/g,
    "alpha-v3-forward-entry-compatible-boundary.json"
  ],
  [
    /alpha-v3-extended-entry-v3-replay-checkpoint\.json/g,
    "alpha-v3-true-forward-entry-v3-checkpoint.json"
  ],
  [
    /ALPHA_V3_EXTENDED_ENTRY_V3_REPLAY_CHECKPOINT_V1/g,
    "ALPHA_V3_TRUE_FORWARD_ENTRY_V3_CHECKPOINT_V1"
  ],
  [
    /ALPHA_V3_EXTENDED_ENTRY_V3_REPLAY/g,
    "ALPHA_V3_TRUE_FORWARD_ENTRY_V3"
  ]
];

for (const [pattern, value] of replacements) {
  batcher = batcher.replace(
    pattern,
    value
  );
}

const thresholdPattern =
  /const threshold =\s*normalizeThreshold\(\s*await getActiveEntryThreshold\(\),\s*\);/;

if (!thresholdPattern.test(batcher)) {
  throw new Error(
    "PATCH_ANCHOR_NOT_FOUND:FROZEN_THRESHOLD"
  );
}

batcher = batcher.replace(
  thresholdPattern,
  `const threshold =
    0.66;`
);

const premiumCapsPattern =
  /premiumCaps:\s*\[\s*0\.0025,\s*0\.005,\s*0\.0075,\s*0\.01,?\s*\],/;

if (!premiumCapsPattern.test(batcher)) {
  throw new Error(
    "PATCH_ANCHOR_NOT_FOUND:PREMIUM_CAPS"
  );
}

batcher = batcher.replace(
  premiumCapsPattern,
  `premiumCaps: [
        0.01,
      ],`
);

const rangePattern =
  /if \(\s*checkpoint\.usableRange\s*\?\.start !==\s*startDate \|\|\s*checkpoint\.usableRange\s*\?\.end !==\s*endDate\s*\) \{\s*throw new Error\(\s*"CHECKPOINT_RANGE_MISMATCH",?\s*\);\s*\}/;

if (!rangePattern.test(batcher)) {
  throw new Error(
    "PATCH_ANCHOR_NOT_FOUND:CHECKPOINT_RANGE"
  );
}

batcher = batcher.replace(
  rangePattern,
  `if (
      checkpoint.usableRange
        ?.start !==
      startDate
    ) {
      throw new Error(
        "CHECKPOINT_START_RANGE_MISMATCH",
      );
    }

    if (
      String(
        checkpoint.usableRange
          ?.end ??
          "",
      ) >
      endDate
    ) {
      throw new Error(
        "CHECKPOINT_END_RANGE_REGRESSION",
      );
    }

    checkpoint.usableRange = {
      start:
        startDate,
      end:
        endDate,
    };`
);

batcher = batcher.replaceAll(
  `"2026-10-31"`,
  `new Date().toISOString().slice(0, 10)`
);

write(
  "scripts/alpha-v3-true-forward-entry-v3-batcher.ts",
  batcher
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_TRUE_FORWARD_OOS_COLLECTOR_V1_INSTALLED",

      generatedFiles: [
        "scripts/alpha-v3-forward-top1-capture.ts",
        "scripts/alpha-v3-forward-entry-prep.ts",
        "scripts/alpha-v3-true-forward-entry-v3-batcher.ts",
        "scripts/alpha-v3-forward-entry-maturity-update.ts",
        "scripts/alpha-v3-true-forward-oos-summary.ts"
      ],

      frozenContract: {
        historicalTargetCutoff:
          "2026-10-07",

        entryScoreThreshold:
          0.66,

        selectedCap:
          0.01,

        retuningAllowed:
          false
      },

      safety: {
        historicalCheckpointModified:
          false,

        databaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        productionChanged:
          false
      },

      nextAction:
        "RUN_FORWARD_TOP1_CAPTURE"
    },
    null,
    2
  )
);
