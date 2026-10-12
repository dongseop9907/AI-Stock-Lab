import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

import {
  buildDailyPriceVolumeEvidence,
} from "../lib/alpha/daily-market-adapters";

import {
  calculateMarketRegimeFeatureVectorV7,
} from "../lib/market/market-regime-feature-engine";

const VERSION =
  "ALPHA_V3_TRUE_FORWARD_TOP1_CAPTURE_V1";

const HISTORICAL_TARGET_CUTOFF =
  "2026-10-07";

const ROOT =
  process.cwd();

const OUTPUT =
  path.join(
    ROOT,
    "logs",
    "alpha-v3-forward-top1-sessions.json",
  );

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

function decisionAtForSource(
  tradingDate: string,
) {
  return new Date(
    `${tradingDate}T15:05:00.000Z`,
  ).toISOString();
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

  const output: T[] =
    [];

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

    output.push(
      ...rows,
    );

    if (
      rows.length <
      pageSize
    ) {
      break;
    }
  }

  return output;
}

function candidateFingerprint(
  row: any,
) {
  const compact = {
    sourceTradingDate:
      row.sourceTradingDate,

    decisionAt:
      row.decisionAt,

    candidateCount:
      row.candidateCount,

    top1: row.top1
      ? {
          stockCode:
            row.top1.stockCode,
          stockName:
            row.top1.stockName,
          market:
            row.top1.market,
          rawPriceVolumeScore:
            row.top1.rawPriceVolumeScore,
          confidence:
            row.top1.confidence,
          effectiveScore:
            row.top1.effectiveScore,
          availableAt:
            row.top1.availableAt,
          latestTradingDate:
            row.top1.latestTradingDate,
        }
      : null,

    top5:
      (row.top5 ?? [])
        .map(
          (item: any) => ({
            stockCode:
              item.stockCode,
            rawPriceVolumeScore:
              item.rawPriceVolumeScore,
            confidence:
              item.confidence,
            effectiveScore:
              item.effectiveScore,
            availableAt:
              item.availableAt,
            latestTradingDate:
              item.latestTradingDate,
          }),
        ),
  };

  return crypto
    .createHash(
      "sha256",
    )
    .update(
      JSON.stringify(
        compact,
      ),
    )
    .digest(
      "hex",
    );
}

function loadState() {
  if (
    !fs.existsSync(
      OUTPUT,
    )
  ) {
    return {
      version:
        "ALPHA_V3_TRUE_FORWARD_TOP1_SESSIONS_V1",

      contract: {
        historicalTargetCutoff:
          HISTORICAL_TARGET_CUTOFF,

        entryScoreThreshold:
          0.66,

        selectedCap:
          0.01,

        structure:
          "CORRECTED_ENTRY_GATE_PLUS_POST_SIGNAL_ANTI_CHASE_LIMIT",

        candidateSelection:
          "PRICE_VOLUME_TOP1_CONFIDENCE_SHRUNK_EFFECTIVE_SCORE",

        retuningAllowed:
          false,

        historicalFilesMutable:
          false,
      },

      sessions: [],
    };
  }

  const state =
    JSON.parse(
      fs.readFileSync(
        OUTPUT,
        "utf8",
      ),
    );

  if (
    state.version !==
    "ALPHA_V3_TRUE_FORWARD_TOP1_SESSIONS_V1"
  ) {
    throw new Error(
      "FORWARD_TOP1_STATE_VERSION_MISMATCH",
    );
  }

  return state;
}

function targetOpenUtc(
  targetSessionDate: string,
) {
  /*
   * KRX regular session 09:00 KST = 00:00 UTC.
   */
  return new Date(
    `${targetSessionDate}T00:00:00.000Z`,
  ).toISOString();
}

async function main() {
  const now =
    new Date();

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
    stockResult.data ??
    [];

  if (
    !stocks.length
  ) {
    throw new Error(
      "NO_ACTIVE_STOCKS",
    );
  }

  const stockCodes =
    stocks.map(
      (row: any) =>
        String(
          row.stock_code,
        ),
    );

  const dailyBars =
    await fetchAllRows<any>(
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
    await fetchAllRows<any>(
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
          (row: any) =>
            String(
              row.trading_date,
            ),
        ),
      ),
    ].sort();

  if (
    tradingDates.length <
    62
  ) {
    throw new Error(
      `INSUFFICIENT_DAILY_HISTORY:${tradingDates.length}`,
    );
  }

  const latestSourceTradingDate =
    tradingDates.at(
      -1,
    )!;

  const barsByStock =
    new Map<
      string,
      any[]
    >();

  for (
    const stock
    of stocks
  ) {
    barsByStock.set(
      String(
        stock.stock_code,
      ),
      [],
    );
  }

  for (
    const row
    of dailyBars
  ) {
    const code =
      String(
        row.stock_code,
      );

    const arr =
      barsByStock.get(
        code,
      );

    if (
      arr
    ) {
      arr.push(
        row,
      );
    }
  }

  const indexBarsAll =
    indexBarsRaw
      .map(
        (row: any) => {
          const close =
            toNumber(
              row.close_value,
            );

          const marketCode =
            String(
              row.market_code,
            );

          if (
            close ===
              null ||
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
            marketCode,
            tradingDate:
              String(
                row.trading_date,
              ),
            close,
          };
        },
      )
      .filter(
        Boolean,
      ) as any[];

  const state =
    loadState();

  /*
   * Bind previously frozen candidates to the first ACTUAL trading date
   * that later appeared in adjusted daily bars.
   *
   * Candidate choice is never changed here.
   */
  let newlyBoundTargets =
    0;

  let newlyExcludedLate =
    0;

  for (
    const session
    of state.sessions
  ) {
    if (
      session.targetSessionDate
    ) {
      continue;
    }

    const targetSessionDate =
      tradingDates.find(
        (date) =>
          date >
          session.sourceTradingDate,
      ) ??
      null;

    if (
      !targetSessionDate
    ) {
      continue;
    }

    const openAt =
      targetOpenUtc(
        targetSessionDate,
      );

    const captureMs =
      new Date(
        session.capturedAt,
      ).getTime();

    const openMs =
      new Date(
        openAt,
      ).getTime();

    session.targetSessionDate =
      targetSessionDate;

    session.targetOpenAt =
      openAt;

    session.targetBoundAt =
      now.toISOString();

    session.integrity =
      (
        Number.isFinite(
          captureMs,
        ) &&
        captureMs <
          openMs
      )
        ? "STRICT_TRUE_OOS"
        : "LATE_CAPTURE_EXCLUDED";

    newlyBoundTargets +=
      1;

    if (
      session.integrity ===
      "LATE_CAPTURE_EXCLUDED"
    ) {
      newlyExcludedLate +=
        1;
    }
  }

  const decisionAt =
    decisionAtForSource(
      latestSourceTradingDate,
    );

  const existing =
    state.sessions.find(
      (row: any) =>
        row.sourceTradingDate ===
        latestSourceTradingDate,
    );

  let captureStatus =
    "NO_NEW_CAPTURE";

  let capturedSession:
    any =
    null;

  if (
    latestSourceTradingDate >=
      HISTORICAL_TARGET_CUTOFF &&
    now.getTime() >=
      new Date(
        decisionAt,
      ).getTime()
  ) {
    const asOfDailyBars =
      dailyBars.filter(
        (row: any) =>
          String(
            row.trading_date,
          ) <=
          latestSourceTradingDate,
      );

    const indexBars =
      indexBarsAll.filter(
        (row: any) =>
          row.tradingDate <=
          latestSourceTradingDate,
      );

    const stockBars =
      asOfDailyBars
        .map(
          (row: any) => {
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
          Boolean,
        ) as any[];

    const v7Features =
      calculateMarketRegimeFeatureVectorV7({
        indexBars:
          indexBars as any,
        stockBars:
          stockBars as any,
      });

    const ranking:
      any[] =
      [];

    for (
      const stock
      of stocks
    ) {
      const stockCode =
        String(
          stock.stock_code,
        );

      const evidence =
        buildDailyPriceVolumeEvidence({
          stockCode,
          market:
            stock.market,
          decisionAt,
          rows:
            barsByStock.get(
              stockCode,
            ) ??
            [],
          v7Features,
        } as any);

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
        stockCode,
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
        "NO_FORWARD_PRICEVOLUME_CANDIDATE",
      );
    }

    const candidate = {
      sourceTradingDate:
        latestSourceTradingDate,

      decisionAt,

      targetSessionDate:
        existing
          ?.targetSessionDate ??
        null,

      targetOpenAt:
        existing
          ?.targetOpenAt ??
        null,

      targetBoundAt:
        existing
          ?.targetBoundAt ??
        null,

      candidateCount:
        ranking.length,

      top1,

      top5:
        ranking.slice(
          0,
          5,
        ),

      capturedAt:
        existing
          ?.capturedAt ??
        now.toISOString(),

      integrity:
        existing
          ?.integrity ??
        "PENDING_TARGET_BIND",
    };

    const fingerprint =
      candidateFingerprint(
        candidate,
      );

    if (
      existing
    ) {
      if (
        existing.candidateFingerprint !==
        fingerprint
      ) {
        throw new Error(
          `FORWARD_CANDIDATE_MUTATION_DETECTED:${latestSourceTradingDate}`,
        );
      }

      captureStatus =
        "ALREADY_FROZEN";

      capturedSession =
        existing;
    } else {
      candidate[
        "candidateFingerprint"
      ] =
        fingerprint;

      state.sessions.push(
        candidate,
      );

      state.sessions.sort(
        (
          a: any,
          b: any,
        ) =>
          String(
            a.sourceTradingDate,
          ).localeCompare(
            String(
              b.sourceTradingDate,
            ),
          ),
      );

      captureStatus =
        "NEW_CANDIDATE_FROZEN";

      capturedSession =
        candidate;
    }
  } else if (
    latestSourceTradingDate >=
    HISTORICAL_TARGET_CUTOFF
  ) {
    captureStatus =
      "WAITING_FOR_DECISION_TIME";
  } else {
    captureStatus =
      "WAITING_FOR_POST_CUTOFF_SOURCE_DATA";
  }

  fs.mkdirSync(
    path.dirname(
      OUTPUT,
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(
      state,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const strictCount =
    state.sessions.filter(
      (row: any) =>
        row.integrity ===
        "STRICT_TRUE_OOS",
    ).length;

  const pendingTargetCount =
    state.sessions.filter(
      (row: any) =>
        row.integrity ===
        "PENDING_TARGET_BIND",
    ).length;

  console.log(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_TRUE_FORWARD_TOP1_CAPTURE_COMPLETE",

        version:
          VERSION,

        latestSourceTradingDate,

        decisionAt,

        captureStatus,

        top1:
          capturedSession
            ?.top1
            ?.stockCode ??
          null,

        totalFrozenCandidates:
          state.sessions.length,

        strictTrueOosCandidates:
          strictCount,

        pendingTargetBind:
          pendingTargetCount,

        newlyBoundTargets,

        newlyExcludedLate,

        outputFile:
          "logs/alpha-v3-forward-top1-sessions.json",

        nextGate:
          captureStatus ===
            "WAITING_FOR_DECISION_TIME"
            ? "RUN_AFTER_DECISION_TIME_AND_BEFORE_TARGET_SESSION_OPEN"
            : "PREPARE_FORWARD_ENTRY_REPLAY",
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
            "ALPHA_V3_TRUE_FORWARD_TOP1_CAPTURE_FAILED",

          version:
            VERSION,

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          databaseWrites:
            0,

          ordersCreated:
            0,

          productionChanged:
            false,
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
