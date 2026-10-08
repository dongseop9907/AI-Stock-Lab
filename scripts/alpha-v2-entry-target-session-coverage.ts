import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

function kstParts(iso: string) {
  const d =
    new Date(
      new Date(iso).getTime() +
      9 * 60 * 60 * 1000,
    );

  return {
    date:
      d.toISOString().slice(0, 10),
    hour:
      d.getUTCHours(),
    minute:
      d.getUTCMinutes(),
  };
}

function priceVolumeScore(
  row: any,
): number | null {
  const dim =
    (row.dimensions ?? []).find(
      (item: any) =>
        item.dimension ===
        "priceVolume",
    );

  const effective =
    Number(
      dim?.effectiveScore,
    );

  const quality =
    Number(
      row.quality,
    );

  if (
    !Number.isFinite(effective) ||
    !Number.isFinite(quality)
  ) {
    return null;
  }

  return (
    0.5 +
    (effective - 0.5) *
      quality
  );
}

async function main() {
  const root =
    process.cwd();

  const replay =
    JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          "logs",
          "alpha-v1-alpha-only-historical-replay-read-only.json",
        ),
        "utf8",
      ),
    );

  const top1Rows =
    (replay.replay ?? [])
      .map(
        (day: any) => {
          const ranked =
            (day.rawRanking ?? [])
              .map(
                (row: any) => ({
                  stockCode:
                    String(
                      row.stockCode,
                    ),
                  v2Score:
                    priceVolumeScore(
                      row,
                    ),
                }),
              )
              .filter(
                (row: any) =>
                  Number.isFinite(
                    row.v2Score,
                  ),
              )
              .sort(
                (a: any, b: any) =>
                  b.v2Score -
                  a.v2Score,
              );

          return ranked[0]
            ? {
                alphaDate:
                  String(
                    day.date,
                  ),
                decisionAt:
                  String(
                    day.decisionAt,
                  ),
                stockCode:
                  ranked[0]
                    .stockCode,
                v2Score:
                  ranked[0]
                    .v2Score,
              }
            : null;
        },
      )
      .filter(Boolean) as Array<{
        alphaDate: string;
        decisionAt: string;
        stockCode: string;
        v2Score: number;
      }>;

  const stockCodes =
    [
      ...new Set(
        top1Rows.map(
          (row) =>
            row.stockCode,
        ),
      ),
    ];

  const supabase =
    createSupabaseServerClient();

  /*
   * Trading calendar only.
   * This result set is small enough that no pagination issue exists here.
   */
  const {
    data:
      dailyBarData,
    error:
      dailyBarError,
  } =
    await supabase
      .from(
        "market_daily_bars",
      )
      .select(
        "stock_code,trading_date,adjusted_price",
      )
      .in(
        "stock_code",
        stockCodes,
      )
      .eq(
        "adjusted_price",
        true,
      )
      .gte(
        "trading_date",
        "2026-07-30",
      )
      .lte(
        "trading_date",
        "2026-10-31",
      )
      .order(
        "trading_date",
      )
      .limit(
        10000,
      );

  if (
    dailyBarError
  ) {
    throw dailyBarError;
  }

  const tradingDates =
    [
      ...new Set(
        (dailyBarData ?? [])
          .map(
            (row: any) =>
              String(
                row.trading_date,
              ),
          ),
      ),
    ].sort();

  const targetRows =
    top1Rows.map(
      (alpha) => {
        const kst =
          kstParts(
            alpha.decisionAt,
          );

        const sameDayIsTradingDay =
          tradingDates.includes(
            kst.date,
          );

        let targetSessionDate:
          string |
          null =
            null;

        if (
          sameDayIsTradingDay &&
          kst.hour < 9
        ) {
          targetSessionDate =
            kst.date;
        } else {
          targetSessionDate =
            tradingDates.find(
              (date) =>
                date >
                kst.date,
            ) ??
            null;
        }

        return {
          ...alpha,

          decisionDateKst:
            kst.date,

          decisionTimeKst:
            `${String(
              kst.hour,
            ).padStart(
              2,
              "0",
            )}:${String(
              kst.minute,
            ).padStart(
              2,
              "0",
            )}`,

          sameDayIsTradingDay,

          targetSessionDate,
        };
      },
    );

  /*
   * IMPORTANT:
   * Do NOT fetch all snapshots in one large query.
   * PostgREST/Supabase may cap a response around 1000 rows.
   *
   * Coverage only needs exact counts, so count each target session
   * independently with head:true.
   */
  const rows =
    [];

  for (
    const target
    of targetRows
  ) {
    if (
      !target.targetSessionDate
    ) {
      rows.push({
        ...target,
        targetSessionSnapshotCount:
          0,
        replayable:
          false,
      });

      continue;
    }

    const start =
      `${target.targetSessionDate}T00:00:00+09:00`;

    const end =
      `${target.targetSessionDate}T23:59:59+09:00`;

    const countResult =
      await supabase
        .from(
          "market_snapshots",
        )
        .select(
          "stock_code,observed_at",
          {
            count:
              "exact",
            head:
              true,
          },
        )
        .eq(
          "stock_code",
          target.stockCode,
        )
        .gte(
          "observed_at",
          start,
        )
        .lte(
          "observed_at",
          end,
        );

    if (
      countResult.error
    ) {
      throw countResult.error;
    }

    const count =
      countResult.count ??
      0;

    rows.push({
      ...target,

      targetSessionSnapshotCount:
        count,

      replayable:
        count >
        0,
    });
  }

  const replayableRows =
    rows.filter(
      (row: any) =>
        row.replayable,
    );

  const missingRows =
    rows.filter(
      (row: any) =>
        !row.replayable,
    );

  const uniqueReplayableSessions =
    new Set(
      replayableRows.map(
        (row: any) =>
          `${row.targetSessionDate}|${row.stockCode}`,
      ),
    );

  const uniqueMissingSessions =
    new Set(
      missingRows
        .filter(
          (row: any) =>
            row.targetSessionDate,
        )
        .map(
          (row: any) =>
            `${row.targetSessionDate}|${row.stockCode}`,
        ),
    );

  const result = {
    status:
      "ALPHA_V2_ENTRY_TARGET_SESSION_COVERAGE_COMPLETE",

    version:
      "V2_EXACT_COUNT_PER_TARGET_SESSION",

    policy: {
      preOpenTradingDay:
        "same trading session",

      atOrAfterOpenWeekendHoliday:
        "next trading session",

      arbitraryFutureSnapshotJump:
        false,

      snapshotCoverageQuery:
        "EXACT_COUNT_PER_STOCK_AND_TARGET_SESSION_NO_GLOBAL_ROW_CAP",
    },

    counts: {
      alphaTop1Dates:
        rows.length,

      replayableTargetSessions:
        replayableRows.length,

      missingTargetSessionSnapshots:
        missingRows.length,

      uniqueReplayableTargetSessions:
        uniqueReplayableSessions.size,

      uniqueMissingTargetSessions:
        uniqueMissingSessions.size,
    },

    replayableRows,

    missingRows,

    safety: {
      databaseReadsOnly:
        true,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },

    nextGate:
      replayableRows.length >=
        20
        ? "RUN_ALPHA_V2_ENTRY_REPLAY_ON_TARGET_SESSIONS"
        : "REVIEW_REMAINING_TARGET_SESSION_GAPS",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-entry-target-session-coverage.json",
    ),
    JSON.stringify(
      result,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          result.status,

        version:
          result.version,

        counts:
          result.counts,

        replayableRows:
          result.replayableRows,

        missingRows:
          result.missingRows,

        nextGate:
          result.nextGate,

        outputFile:
          "logs/alpha-v2-entry-target-session-coverage.json",
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
            "ALPHA_V2_ENTRY_TARGET_SESSION_COVERAGE_FAILED",

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
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
