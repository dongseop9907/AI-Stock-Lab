import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const VERSION =
  "ALPHA_V3_EXIT_V3_BASELINE_REPLAY_V1";

const CHECKPOINT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json",
  );

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-exit-v3-baseline-replay.json",
  );

const ENTRY_PREMIUM_CAP =
  0.01;

/*
 * 현재 entry signal 구현의 기본 최초 손절 거리.
 */
const INITIAL_STOP_DISTANCE_RATE =
  0.025;

/*
 * 현재 trailing-stop-policy.ts 기본값.
 */
const TRAILING_ACTIVATION_RATE =
  0.03;

const TRAILING_DISTANCE_RATE =
  0.02;

const MAX_HOLDING_DAYS =
  20;

interface DailyBar {
  stock_code: string;
  trading_date: string;
  open_price: number | string | null;
  high_price: number | string | null;
  low_price: number | string | null;
  close_price: number | string | null;
  adjusted_price?: boolean | null;
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

  const parsed =
    Number(value);

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : null;
}

function median(
  values: number[],
): number | null {
  if (
    values.length === 0
  ) {
    return null;
  }

  const sorted =
    [...values].sort(
      (a, b) =>
        a - b,
    );

  const middle =
    Math.floor(
      sorted.length /
        2,
    );

  return (
    sorted.length %
      2 ===
    0
      ? (
          sorted[
            middle - 1
          ] +
          sorted[
            middle
          ]
        ) /
        2
      : sorted[
          middle
        ]
  );
}

function stats(
  values: Array<
    number | null
  >,
) {
  const usable =
    values.filter(
      (
        value,
      ): value is number =>
        value !== null &&
        Number.isFinite(
          value,
        ),
    );

  return {
    count:
      usable.length,

    mean:
      usable.length >
      0
        ? usable.reduce(
            (
              sum,
              value,
            ) =>
              sum + value,
            0,
          ) /
          usable.length
        : null,

    median:
      median(
        usable,
      ),

    positiveRate:
      usable.length >
      0
        ? usable.filter(
            (value) =>
              value > 0,
          ).length /
          usable.length
        : null,

    min:
      usable.length >
      0
        ? Math.min(
            ...usable,
          )
        : null,

    max:
      usable.length >
      0
        ? Math.max(
            ...usable,
          )
        : null,
  };
}

function addExitReason(
  map: Record<
    string,
    number
  >,
  reason: string,
) {
  map[reason] =
    (
      map[reason] ??
      0
    ) + 1;
}

async function main() {
  if (
    !fs.existsSync(
      CHECKPOINT_FILE,
    )
  ) {
    throw new Error(
      "ENTRY_V3_CHECKPOINT_NOT_FOUND",
    );
  }

  const checkpoint =
    JSON.parse(
      fs.readFileSync(
        CHECKPOINT_FILE,
        "utf8",
      ),
    );

  const sourceRows =
    Array.isArray(
      checkpoint?.results,
    )
      ? checkpoint.results
      : [];

  const entries =
    sourceRows
      .filter(
        (row: any) =>
          row?.correctedEntry
            ?.qualified ===
          true,
      )
      .map(
        (row: any) => {
          const policy =
            Array.isArray(
              row.limitPolicies,
            )
              ? row.limitPolicies
                  .find(
                    (
                      candidate: any,
                    ) =>
                      Math.abs(
                        Number(
                          candidate
                            ?.maxPremium,
                        ) -
                          ENTRY_PREMIUM_CAP,
                      ) <
                      1e-12,
                  )
              : null;

          const entryPrice =
            toNumber(
              policy
                ?.fillPrice,
            );

          return {
            sourceTradingDate:
              String(
                row.sourceTradingDate ??
                  "",
              ),

            entryDate:
              String(
                row.targetSessionDate ??
                  "",
              ),

            stockCode:
              String(
                row.stockCode ??
                  "",
              ),

            entryPrice,

            filled:
              policy
                ?.filled ===
              true,

            entryObservedAt:
              policy
                ?.observedAt ??
              null,
          };
        },
      )
      .filter(
        (
          entry,
        ) =>
          entry.filled &&
          entry.entryPrice !==
            null &&
          entry.entryPrice >
            0 &&
          entry.entryDate &&
          entry.stockCode,
      );

  const stockCodes =
    [
      ...new Set(
        entries.map(
          (entry) =>
            entry.stockCode,
        ),
      ),
    ];

  const entryDates =
    entries
      .map(
        (entry) =>
          entry.entryDate,
      )
      .sort();

  if (
    entries.length ===
      0 ||
    entryDates.length ===
      0
  ) {
    throw new Error(
      "NO_FILLED_ENTRY_V3_ROWS",
    );
  }

  const minEntryDate =
    entryDates[0];

  const supabase =
    createSupabaseServerClient();

  const barsByStock =
    new Map<
      string,
      DailyBar[]
    >();

  let databaseReads =
    0;

  for (
    const stockCode of stockCodes
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "market_daily_bars",
        )
        .select(
          [
            "stock_code",
            "trading_date",
            "open_price",
            "high_price",
            "low_price",
            "close_price",
            "adjusted_price",
          ].join(
            ",",
          ),
        )
        .eq(
          "stock_code",
          stockCode,
        )
        .eq(
          "adjusted_price",
          true,
        )
        .gte(
          "trading_date",
          minEntryDate,
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

    databaseReads +=
      1;

    if (
      error
    ) {
      throw new Error(
        `DAILY_BAR_READ_FAILED:${stockCode}:${error.message}`,
      );
    }

    const cleaned =
      (
        data ??
        []
      )
        .map(
          (
            row: any,
          ) => ({
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
              row.open_price,

            high_price:
              row.high_price,

            low_price:
              row.low_price,

            close_price:
              row.close_price,

            adjusted_price:
              row.adjusted_price,
          }),
        )
        .filter(
          (
            row: DailyBar,
          ) =>
            row
              .trading_date,
        );

    barsByStock.set(
      stockCode,
      cleaned,
    );
  }

  const results =
    entries.map(
      (entry) => {
        const stockBars =
          barsByStock.get(
            entry.stockCode,
          ) ??
          [];

        /*
         * Entry V3 진입은 장중에 발생한다.
         * 일봉의 entry-day 고가/저가는 진입 전 가격을 포함할 수 있으므로
         * 같은 날 OHLC를 exit 판단에 사용하지 않는다.
         */
        const futureBars =
          stockBars.filter(
            (bar) =>
              bar.trading_date >
              entry.entryDate,
          );

        const entryPrice =
          entry.entryPrice as number;

        const initialStopPrice =
          entryPrice *
          (
            1 -
            INITIAL_STOP_DISTANCE_RATE
          );

        const activationPrice =
          entryPrice *
          (
            1 +
            TRAILING_ACTIVATION_RATE
          );

        let currentStopPrice =
          initialStopPrice;

        let highestPrice =
          entryPrice;

        let trailingActivated =
          false;

        let trailingRaisedCount =
          0;

        let exit:
          | {
              exitDate: string;
              exitPrice: number;
              exitReason:
                | "INITIAL_OR_TRAILING_STOP_GAP"
                | "INITIAL_OR_TRAILING_STOP_TOUCH"
                | "MAX_HOLDING_DAY_CLOSE";
              holdingDays: number;
            }
          | null =
          null;

        let maxFavorableExcursion =
          0;

        let maxAdverseExcursion =
          0;

        const observedBars =
          futureBars.slice(
            0,
            MAX_HOLDING_DAYS,
          );

        for (
          let index = 0;
          index <
          observedBars.length;
          index += 1
        ) {
          const bar =
            observedBars[
              index
            ];

          const open =
            toNumber(
              bar.open_price,
            );

          const high =
            toNumber(
              bar.high_price,
            );

          const low =
            toNumber(
              bar.low_price,
            );

          const close =
            toNumber(
              bar.close_price,
            );

          if (
            open === null ||
            high === null ||
            low === null ||
            close === null ||
            open <= 0 ||
            high <= 0 ||
            low <= 0 ||
            close <= 0
          ) {
            continue;
          }

          maxFavorableExcursion =
            Math.max(
              maxFavorableExcursion,
              (
                high -
                entryPrice
              ) /
                entryPrice,
            );

          maxAdverseExcursion =
            Math.min(
              maxAdverseExcursion,
              (
                low -
                entryPrice
              ) /
                entryPrice,
            );

          /*
           * 전일까지 확정된 stop만 오늘 체결 판정에 사용한다.
           * 같은 일봉의 high를 보고 stop을 올린 뒤 같은 일봉 low에
           * 체결시키면 OHLC 순서를 모르는 상태에서 look-ahead가 생긴다.
           */
          if (
            open <=
            currentStopPrice
          ) {
            exit = {
              exitDate:
                bar
                  .trading_date,

              exitPrice:
                open,

              exitReason:
                "INITIAL_OR_TRAILING_STOP_GAP",

              holdingDays:
                index + 1,
            };

            break;
          }

          if (
            low <=
            currentStopPrice
          ) {
            exit = {
              exitDate:
                bar
                  .trading_date,

              exitPrice:
                currentStopPrice,

              exitReason:
                "INITIAL_OR_TRAILING_STOP_TOUCH",

              holdingDays:
                index + 1,
            };

            break;
          }

          highestPrice =
            Math.max(
              highestPrice,
              high,
            );

          if (
            highestPrice >=
            activationPrice
          ) {
            trailingActivated =
              true;

            const candidateStop =
              highestPrice *
              (
                1 -
                TRAILING_DISTANCE_RATE
              );

            /*
             * 기존 risk-manager의 원칙:
             * stop은 내려갈 수 없고 현재가 이상으로도 올릴 수 없다.
             * 일봉 baseline에서는 close를 현재 관측가격으로 사용한다.
             */
            if (
              candidateStop >
                currentStopPrice &&
              candidateStop <
                close
            ) {
              currentStopPrice =
                candidateStop;

              trailingRaisedCount +=
                1;
            }
          }

          if (
            index ===
              MAX_HOLDING_DAYS -
                1
          ) {
            exit = {
              exitDate:
                bar
                  .trading_date,

              exitPrice:
                close,

              exitReason:
                "MAX_HOLDING_DAY_CLOSE",

              holdingDays:
                MAX_HOLDING_DAYS,
            };
          }
        }

        const complete =
          exit !== null;

        const realizedReturn =
          exit
            ? (
                exit.exitPrice -
                entryPrice
              ) /
              entryPrice
            : null;

        const hold20Return =
          futureBars.length >=
          MAX_HOLDING_DAYS
            ? (() => {
                const price =
                  toNumber(
                    futureBars[
                      MAX_HOLDING_DAYS -
                        1
                    ]
                      ?.close_price,
                  );

                return (
                  price !==
                    null &&
                  price > 0
                    ? (
                        price -
                        entryPrice
                      ) /
                      entryPrice
                    : null
                );
              })()
            : null;

        return {
          sourceTradingDate:
            entry
              .sourceTradingDate,

          entryDate:
            entry
              .entryDate,

          stockCode:
            entry
              .stockCode,

          entryPrice,

          entryObservedAt:
            entry
              .entryObservedAt,

          initialStopPrice,
          activationPrice,

          complete,

          availableFutureBars:
            futureBars.length,

          trailingActivated,
          trailingRaisedCount,

          finalStopPrice:
            currentStopPrice,

          highestPrice,

          exit,

          realizedReturn,
          hold20Return,

          excessVsHold20:
            realizedReturn !==
              null &&
            hold20Return !==
              null
              ? realizedReturn -
                hold20Return
              : null,

          maxFavorableExcursion,
          maxAdverseExcursion,
        };
      },
    );

  const completed =
    results.filter(
      (row) =>
        row.complete,
    );

  const incomplete =
    results.filter(
      (row) =>
        !row.complete,
    );

  const reasonCounts:
    Record<
      string,
      number
    > = {};

  for (
    const row of completed
  ) {
    if (
      row.exit
    ) {
      addExitReason(
        reasonCounts,
        row.exit
          .exitReason,
      );
    }
  }

  const result = {
    status:
      "ALPHA_V3_EXIT_V3_BASELINE_REPLAY_COMPLETE",

    version:
      VERSION,

    contract: {
      entryLayer:
        "ENTRY_V3_PROVISIONAL_1PCT_ANTI_CHASE_FILL",

      entryPremiumCap:
        ENTRY_PREMIUM_CAP,

      initialStopDistanceRate:
        INITIAL_STOP_DISTANCE_RATE,

      trailingActivationRate:
        TRAILING_ACTIVATION_RATE,

      trailingDistanceRate:
        TRAILING_DISTANCE_RATE,

      maxHoldingDays:
        MAX_HOLDING_DAYS,

      entryDayExitEvaluation:
        "DISABLED_TO_AVOID_INTRADAY_OHLC_ORDER_LOOKAHEAD",

      trailingUpdateTiming:
        "END_OF_DAY_EFFECTIVE_NEXT_SESSION",

      stopDirection:
        "MAINTAIN_OR_RAISE_ONLY",

      productionChanged:
        false,
    },

    counts: {
      checkpointSessions:
        sourceRows.length,

      correctedQualifiedSessions:
        sourceRows.filter(
          (row: any) =>
            row?.correctedEntry
              ?.qualified ===
            true,
        ).length,

      filledEntrySessions:
        entries.length,

      completedExitReplays:
        completed.length,

      incompleteFutureHistory:
        incomplete.length,

      stockCount:
        stockCodes.length,

      databaseReads,
    },

    performance: {
      realizedReturn:
        stats(
          completed.map(
            (row) =>
              row
                .realizedReturn,
          ),
        ),

      hold20Return:
        stats(
          completed.map(
            (row) =>
              row
                .hold20Return,
          ),
        ),

      excessVsHold20:
        stats(
          completed.map(
            (row) =>
              row
                .excessVsHold20,
          ),
        ),

      holdingDays:
        stats(
          completed.map(
            (row) =>
              row.exit
                ?.holdingDays ??
              null,
          ),
        ),

      maxFavorableExcursion:
        stats(
          completed.map(
            (row) =>
              row
                .maxFavorableExcursion,
          ),
        ),

      maxAdverseExcursion:
        stats(
          completed.map(
            (row) =>
              row
                .maxAdverseExcursion,
          ),
        ),

      trailingActivationRate:
        completed.length >
        0
          ? completed.filter(
              (row) =>
                row
                  .trailingActivated,
            ).length /
            completed.length
          : null,

      exitReasons:
        reasonCounts,
    },

    interpretation: {
      baselineOnly:
        true,

      policySelectionAllowed:
        false,

      rationale:
        "This run establishes the current-rule Exit V3 baseline. It does not select an optimized exit policy from the same sample.",

      nextComparison:
        "Compare predeclared stop/trailing variants chronologically against this fixed baseline.",
    },

    sampleResults:
      results.slice(
        0,
        10,
      ),

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
    },

    nextGate:
      "BUILD_ALPHA_V3_EXIT_V3_POLICY_GRID",

    outputFile:
      "logs/alpha-v3-exit-v3-baseline-replay.json",
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
      result,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      result,
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
            "ALPHA_V3_EXIT_V3_BASELINE_REPLAY_FAILED",

          version:
            VERSION,

          message:
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

    process.exit(
      1,
    );
  },
);
