import fs from "node:fs";


import {
  nextKrxTradingDate,
} from "../lib/trading/krx-trading-calendar";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

import {
  buildDailyPriceVolumeEvidence,
  type DailyAlphaBarLike,
} from "../lib/alpha/daily-market-adapters";

import {
  calculateMarketRegimeFeatureVectorV7,
  type MarketRegimeFeatureMarket,
  type MarketRegimeIndexBar,
  type MarketRegimeStockBar,
} from "../lib/market/market-regime-feature-engine";

export const TRUE_FORWARD_TOP1_VERSION =
  "ALPHA_V3_TRUE_FORWARD_TOP1_SESSIONS_V1" as const;

export const HISTORICAL_CUTOFF =
  "2026-10-07";

export const FROZEN_ENTRY_THRESHOLD =
  0.66;

export const FROZEN_PREMIUM_CAP =
  0.01;

const STATE_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-entry-v3-forward-shadow-oos-state.json",
  );

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-forward-top1-sessions.json",
  );

interface ActiveStock {
  stock_code: string;
  stock_name: string | null;
  market: string | null;
}

interface DailyBarRow extends DailyAlphaBarLike {
  stock_code: string;
  trading_date: string;
}

interface IndexBarRow {
  market_code: string;
  trading_date: string;
  close_value: number | string | null;
}

interface CalendarOverrideRow {
  calendar_date: string;
  is_open: boolean;
  verified: boolean;
}

function toNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function nextCalendarDayDecisionAt(
  tradingDate: string,
) {
  return new Date(
    `${tradingDate}T15:05:00.000Z`,
  ).toISOString();
}

function sqlDateAtKstTime(
  date: string,
  hhmmss: string,
) {
  return new Date(
    `${date}T${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}+09:00`,
  );
}

function addSqlDays(
  date: string,
  days: number,
) {
  const d =
    new Date(
      `${date}T00:00:00.000Z`,
    );

  d.setUTCDate(
    d.getUTCDate() +
    days,
  );

  return d
    .toISOString()
    .slice(0, 10);
}

export function nextExpectedKrxOpenDate(
  sourceTradingDate: string,
  overrides: CalendarOverrideRow[],
) {
  return nextKrxTradingDate(
    sourceTradingDate,
    overrides,
  );
}

export function classifyCaptureWindow(
  input: {
    now: Date;
    decisionAt: string;
    targetSessionDate: string;
  },
):
  | "BEFORE_DECISION_TIME"
  | "CAPTURE_WINDOW_OPEN"
  | "MISSED_CAPTURE_WINDOW" {
  const nowMs =
    input.now.getTime();

  const decisionMs =
    Date.parse(
      input.decisionAt,
    );

  const targetOpenMs =
    sqlDateAtKstTime(
      input.targetSessionDate,
      "090000",
    ).getTime();

  if (
    nowMs <
    decisionMs
  ) {
    return "BEFORE_DECISION_TIME";
  }

  if (
    nowMs >=
    targetOpenMs
  ) {
    return "MISSED_CAPTURE_WINDOW";
  }

  return "CAPTURE_WINDOW_OPEN";
}

async function fetchAllRows<T>(
  buildQuery: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: {
      message?: string;
    } | null;
  }>,
  label: string,
): Promise<T[]> {
  const pageSize =
    1000;

  const out:
    T[] = [];

  for (
    let from = 0;
    ;
    from += pageSize
  ) {
    const to =
      from +
      pageSize -
      1;

    const result =
      await buildQuery(
        from,
        to,
      );

    if (
      result.error
    ) {
      throw new Error(
        `${label}_READ_FAILED:${result.error.message ?? "UNKNOWN"}`,
      );
    }

    const rows =
      result.data ??
      [];

    out.push(
      ...rows,
    );

    if (
      rows.length <
      pageSize
    ) {
      break;
    }
  }

  return out;
}

function readFrozenState() {
  if (
    !fs.existsSync(
      STATE_FILE,
    )
  ) {
    throw new Error(
      "FORWARD_OOS_FROZEN_STATE_NOT_FOUND",
    );
  }

  const state =
    JSON.parse(
      fs.readFileSync(
        STATE_FILE,
        "utf8",
      ),
    );

  if (
    state.version !==
      "ALPHA_V3_ENTRY_V3_FORWARD_SHADOW_OOS_V1" ||
    state.historicalCutoff !==
      HISTORICAL_CUTOFF ||
    Number(
      state.selectedCap,
    ) !==
      FROZEN_PREMIUM_CAP ||
    Number(
      state.entryScoreThreshold,
    ) !==
      FROZEN_ENTRY_THRESHOLD ||
    state.frozen !==
      true
  ) {
    throw new Error(
      "FORWARD_OOS_FROZEN_CONTRACT_MISMATCH",
    );
  }

  return state;
}

function readForwardFile() {
  if (
    !fs.existsSync(
      OUTPUT_FILE,
    )
  ) {
    return {
      version:
        TRUE_FORWARD_TOP1_VERSION,

      contract: {
        historicalCutoff:
          HISTORICAL_CUTOFF,

        selectedCap:
          FROZEN_PREMIUM_CAP,

        entryScoreThreshold:
          FROZEN_ENTRY_THRESHOLD,

        retuningAllowed:
          false,

        candidateMustBeFrozenBeforeTargetOpen:
          true,

        historicalCheckpointMutable:
          false,
      },

      sessions:
        [],

      missedCaptureWindows:
        [],
    };
  }

  const parsed =
    JSON.parse(
      fs.readFileSync(
        OUTPUT_FILE,
        "utf8",
      ),
    );

  if (
    parsed.version !==
    TRUE_FORWARD_TOP1_VERSION
  ) {
    throw new Error(
      "FORWARD_TOP1_FILE_VERSION_MISMATCH",
    );
  }

  parsed.sessions =
    Array.isArray(
      parsed.sessions,
    )
      ? parsed.sessions
      : [];

  parsed.missedCaptureWindows =
    Array.isArray(
      parsed.missedCaptureWindows,
    )
      ? parsed.missedCaptureWindows
      : [];

  return parsed;
}

function writeForwardFile(
  value: any,
) {
  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE,
    ),
    {
      recursive:
        true,
    },
  );

  const temp =
    `${OUTPUT_FILE}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(
      value,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  fs.renameSync(
    temp,
    OUTPUT_FILE,
  );
}

async function readProductionQualityEvidence(
  sourceTradingDate: string,
) {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "market_data_quality_gate_observations",
      )
      .select(
        [
          "id",
          "observed_at",
          "status",
          "expected_market_date",
          "freshness_status",
          "integrity_status",
          "effective_error_count",
          "effective_warning_count",
        ].join(","),
      )
      .eq(
        "expected_market_date",
        sourceTradingDate,
      )
      .order(
        "observed_at",
        {
          ascending:
            false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    error
  ) {
    throw new Error(
      `QUALITY_EVIDENCE_READ_FAILED:${error.message}`,
    );
  }

  if (
    !data
  ) {
    return null;
  }

  const healthy =
    data.status ===
      "PASS" &&
    data.freshness_status ===
      "FRESH" &&
    data.integrity_status ===
      "CLEAN" &&
    Number(
      data.effective_error_count ??
      0,
    ) ===
      0 &&
    Number(
      data.effective_warning_count ??
      0,
    ) ===
      0;

  return {
    ...data,
    healthy,
  };
}

export async function runTrueForwardTop1Producer(
  now:
    Date = new Date(),
) {
  readFrozenState();

  const root =
    process.cwd();

  const supabase =
    createSupabaseServerClient();

  const stockResult =
    await supabase
      .from(
        "stocks",
      )
      .select(
        "stock_code,stock_name,market",
      )
      .eq(
        "is_active",
        true,
      )
      .order(
        "stock_code",
      );

  if (
    stockResult.error
  ) {
    throw new Error(
      `ACTIVE_STOCK_READ_FAILED:${stockResult.error.message}`,
    );
  }

  const stocks =
    (
      stockResult.data ??
      []
    ) as ActiveStock[];

  if (
    !stocks.length
  ) {
    throw new Error(
      "NO_ACTIVE_STOCKS",
    );
  }

  const stockCodes =
    stocks.map(
      (row) =>
        row.stock_code,
    );

  const dailyBars =
    await fetchAllRows<DailyBarRow>(
      (from, to) =>
        supabase
          .from(
            "market_daily_bars",
          )
          .select(
            "stock_code,trading_date,open_price,high_price,low_price,close_price,volume,trading_value,adjusted_price,source,updated_at",
          )
          .in(
            "stock_code",
            stockCodes,
          )
          .eq(
            "adjusted_price",
            true,
          )
          .order(
            "trading_date",
            {
              ascending:
                true,
            },
          )
          .order(
            "stock_code",
            {
              ascending:
                true,
            },
          )
          .range(
            from,
            to,
          ),

      "DAILY_BARS",
    );

  const indexBarsRaw =
    await fetchAllRows<IndexBarRow>(
      (from, to) =>
        supabase
          .from(
            "market_index_daily_bars",
          )
          .select(
            "market_code,trading_date,close_value",
          )
          .in(
            "market_code",
            [
              "KOSPI",
              "KOSDAQ",
            ],
          )
          .order(
            "trading_date",
            {
              ascending:
                true,
            },
          )
          .order(
            "market_code",
            {
              ascending:
                true,
            },
          )
          .range(
            from,
            to,
          ),

      "INDEX_BARS",
    );

  const tradingDates =
    [
      ...new Set(
        dailyBars.map(
          (row) =>
            String(
              row.trading_date,
            ),
        ),
      ),
    ].sort();

  const sourceTradingDate =
    tradingDates.at(
      -1,
    ) ??
    null;

  if (
    !sourceTradingDate
  ) {
    throw new Error(
      "NO_DAILY_TRADING_DATE",
    );
  }

  if (
    sourceTradingDate <=
    HISTORICAL_CUTOFF
  ) {
    return {
      status:
        "ALPHA_V3_TRUE_FORWARD_TOP1_WAITING_FOR_POST_CUTOFF_DATA",

      sourceTradingDate,

      historicalCutoff:
        HISTORICAL_CUTOFF,

      databaseWrites:
        0,

      ordersCreated:
        0,
    };
  }

  const qualityEvidence =
    await readProductionQualityEvidence(
      sourceTradingDate,
    );

  if (
    !qualityEvidence ||
    qualityEvidence.healthy !==
      true
  ) {
    return {
      status:
        "ALPHA_V3_TRUE_FORWARD_TOP1_BLOCKED_BY_DATA_QUALITY",

      sourceTradingDate,

      qualityEvidence,

      productionChanged:
        false,
    };
  }

  const overrideEnd =
    addSqlDays(
      sourceTradingDate,
      14,
    );

  const {
    data:
      overrideData,
    error:
      overrideError,
  } =
    await supabase
      .from(
        "market_exchange_calendar_overrides",
      )
      .select(
        "calendar_date,is_open,verified",
      )
      .eq(
        "exchange_code",
        "KRX",
      )
      .gte(
        "calendar_date",
        sourceTradingDate,
      )
      .lte(
        "calendar_date",
        overrideEnd,
      );

  if (
    overrideError
  ) {
    throw new Error(
      `KRX_OVERRIDE_READ_FAILED:${overrideError.message}`,
    );
  }

  const targetSessionDate =
    nextExpectedKrxOpenDate(
      sourceTradingDate,
      (
        overrideData ??
        []
      ) as CalendarOverrideRow[],
    );

  const decisionAt =
    nextCalendarDayDecisionAt(
      sourceTradingDate,
    );

  const captureWindow =
    classifyCaptureWindow({
      now,
      decisionAt,
      targetSessionDate,
    });

  const forward =
    readForwardFile();

  const sessionKey =
    `${sourceTradingDate}|${targetSessionDate}`;

  const existing =
    forward.sessions.find(
      (row: any) =>
        `${row.sourceTradingDate}|${row.targetSessionDate}` ===
        sessionKey,
    );

  if (
    existing
  ) {
    return {
      status:
        "ALPHA_V3_TRUE_FORWARD_TOP1_ALREADY_CAPTURED",

      sessionKey,

      session:
        existing,

      outputFile:
        "logs/alpha-v3-forward-top1-sessions.json",

      safety: {
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        productionChanged:
          false,
      },
    };
  }

  if (
    captureWindow ===
    "BEFORE_DECISION_TIME"
  ) {
    return {
      status:
        "ALPHA_V3_TRUE_FORWARD_TOP1_WAITING_FOR_DECISION_TIME",

      sourceTradingDate,
      decisionAt,
      targetSessionDate,

      now:
        now.toISOString(),

      safety: {
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
      },
    };
  }

  if (
    captureWindow ===
    "MISSED_CAPTURE_WINDOW"
  ) {
    const alreadyMissed =
      forward.missedCaptureWindows.some(
        (row: any) =>
          `${row.sourceTradingDate}|${row.targetSessionDate}` ===
          sessionKey,
      );

    if (
      !alreadyMissed
    ) {
      forward.missedCaptureWindows.push({
        sourceTradingDate,
        targetSessionDate,
        decisionAt,
        detectedAt:
          now.toISOString(),

        reason:
          "TARGET_SESSION_ALREADY_OPENED_BEFORE_CANDIDATE_WAS_FROZEN",
      });

      writeForwardFile(
        forward,
      );
    }

    return {
      status:
        "ALPHA_V3_TRUE_FORWARD_TOP1_MISSED_CAPTURE_WINDOW",

      sourceTradingDate,
      targetSessionDate,
      decisionAt,

      retrospectiveCandidateCreated:
        false,

      productionChanged:
        false,
    };
  }

  const barsByStock =
    new Map<
      string,
      DailyBarRow[]
    >();

  for (
    const stock of
      stocks
  ) {
    barsByStock.set(
      stock.stock_code,
      [],
    );
  }

  for (
    const row of
      dailyBars
  ) {
    const arr =
      barsByStock.get(
        String(
          row.stock_code,
        ),
      );

    if (
      arr
    ) {
      arr.push(
        row,
      );
    }
  }

  const indexBarsAll:
    MarketRegimeIndexBar[] =
    indexBarsRaw
      .map(
        (row) => {
          const close =
            toNumber(
              row.close_value,
            );

          const marketCode =
            String(
              row.market_code,
            );

          if (
            close === null ||
            (
              marketCode !==
                "KOSPI" &&
              marketCode !==
                "KOSDAQ"
            )
          ) {
            return null;
          }

          return {
            marketCode:
              marketCode as
                MarketRegimeFeatureMarket,

            tradingDate:
              String(
                row.trading_date,
              ),

            close,
          };
        },
      )
      .filter(
        (
          row,
        ): row is MarketRegimeIndexBar =>
          row !== null,
      );

  const asOfDailyBars =
    dailyBars.filter(
      (row) =>
        String(
          row.trading_date,
        ) <=
        sourceTradingDate,
    );

  const indexBars =
    indexBarsAll.filter(
      (row) =>
        row.tradingDate <=
        sourceTradingDate,
    );

  const stockBars:
    MarketRegimeStockBar[] =
    asOfDailyBars
      .map(
        (row) => {
          const close =
            toNumber(
              row.close_price,
            );

          if (
            close ===
            null
          ) {
            return null;
          }

          return {
            stockCode:
              String(
                row.stock_code,
              ),

            tradingDate:
              String(
                row.trading_date,
              ),

            close,
          };
        },
      )
      .filter(
        (
          row,
        ): row is MarketRegimeStockBar =>
          row !== null,
      );

  const v7Features =
    calculateMarketRegimeFeatureVectorV7({
      indexBars,
      stockBars,
    });

  const ranking:
    any[] =
    [];

  for (
    const stock of
      stocks
  ) {
    const stockRows =
      barsByStock.get(
        stock.stock_code,
      ) ??
      [];

    const evidence =
      buildDailyPriceVolumeEvidence({
        stockCode:
          stock.stock_code,

        market:
          stock.market,

        decisionAt,

        rows:
          stockRows,

        v7Features,
      });

    if (
      !evidence
    ) {
      continue;
    }

    const effectiveScore =
      0.5 +
      (
        evidence.score -
        0.5
      ) *
      evidence.confidence;

    ranking.push({
      stockCode:
        stock.stock_code,

      stockName:
        stock.stock_name,

      market:
        stock.market,

      rawPriceVolumeScore:
        evidence.score,

      confidence:
        evidence.confidence,

      effectiveScore,

      availableAt:
        evidence.availableAt,

      latestTradingDate:
        (
          evidence.metadata as
            Record<
              string,
              unknown
            >
        )
          ?.latestTradingDate ??
        null,

      metadata:
        evidence.metadata,
    });
  }

  ranking.sort(
    (a, b) =>
      b.effectiveScore -
        a.effectiveScore ||
      b.rawPriceVolumeScore -
        a.rawPriceVolumeScore ||
      a.stockCode.localeCompare(
        b.stockCode,
      ),
  );

  const top1 =
    ranking[0];

  if (
    !top1
  ) {
    throw new Error(
      "NO_PRICEVOLUME_CANDIDATE",
    );
  }

  const capturedAt =
    now.toISOString();

  const session = {
    sourceTradingDate,
    decisionAt,
    targetSessionDate,

    capturedAt,

    sourceDataCutoffAtCollection:
      sourceTradingDate,

    candidateCount:
      ranking.length,

    top1,

    top5:
      ranking.slice(
        0,
        5,
      ),

    frozen:
      true,

    frozenContract: {
      historicalCutoff:
        HISTORICAL_CUTOFF,

      entryScoreThreshold:
        FROZEN_ENTRY_THRESHOLD,

      selectedCap:
        FROZEN_PREMIUM_CAP,

      retuningAllowed:
        false,
    },

    qualityEvidence: {
      id:
        qualityEvidence.id,
      observedAt:
        qualityEvidence.observed_at,
      status:
        qualityEvidence.status,
      freshnessStatus:
        qualityEvidence.freshness_status,
      integrityStatus:
        qualityEvidence.integrity_status,
      effectiveErrors:
        qualityEvidence.effective_error_count,
      effectiveWarnings:
        qualityEvidence.effective_warning_count,
    },
  };

  forward.sessions.push(
    session,
  );

  forward.sessions.sort(
    (a: any, b: any) =>
      String(
        a.sourceTradingDate,
      ).localeCompare(
        String(
          b.sourceTradingDate,
        ),
      ),
  );

  writeForwardFile(
    forward,
  );

  return {
    status:
      "ALPHA_V3_TRUE_FORWARD_TOP1_CAPTURED",

    sessionKey,

    session,

    outputFile:
      "logs/alpha-v3-forward-top1-sessions.json",

    historicalCheckpointTouched:
      false,

    safety: {
      databaseReadsOnly:
        true,
      databaseWrites:
        0,
      kisRequests:
        0,
      ordersCreated:
        0,
      positionsChanged:
        0,
      productionChanged:
        false,
      thresholdChanged:
        false,
    },

    nextGate:
      "WAIT_FOR_TARGET_SESSION_CLOSE_THEN_COLLECT_ENTRY_OOS",
  };
}

async function main() {
  const result =
    await runTrueForwardTop1Producer();

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );
}

if (
  require.main ===
  module
) {
  main().catch(
    (error) => {
      console.error(
        JSON.stringify(
          {
            status:
              "ALPHA_V3_TRUE_FORWARD_TOP1_PRODUCER_FAILED",

            error:
              error instanceof Error
                ? error.message
                : String(
                    error,
                  ),

            safety: {
              databaseWrites:
                0,
              kisRequests:
                0,
              ordersCreated:
                0,
              positionsChanged:
                0,
              productionChanged:
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
}
