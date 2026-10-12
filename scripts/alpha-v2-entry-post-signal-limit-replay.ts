import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

function avg(values: number[]): number | null {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function simulateLimitFill(
  snapshots: any[],
  signalObservedAt: string,
  limitPrice: number,
) {
  const signalMs =
    new Date(signalObservedAt).getTime();

  for (const row of snapshots) {
    const observedMs =
      new Date(
        String(row.observed_at),
      ).getTime();

    if (observedMs < signalMs) {
      continue;
    }

    const minute =
      row.raw_payload
        ?.minute_bar;

    if (!minute) {
      continue;
    }

    const minuteOpen =
      toNumber(
        minute.stck_oprc,
      );

    const minuteLow =
      toNumber(
        minute.stck_lwpr,
      );

    if (
      minuteOpen === null ||
      minuteLow === null
    ) {
      continue;
    }

    if (minuteOpen <= limitPrice) {
      return {
        filled: true,
        observedAt:
          String(
            row.observed_at,
          ),
        fillPrice:
          minuteOpen,
        fillType:
          "OPEN_AT_OR_BELOW_LIMIT",
      };
    }

    if (minuteLow <= limitPrice) {
      return {
        filled: true,
        observedAt:
          String(
            row.observed_at,
          ),
        fillPrice:
          limitPrice,
        fillType:
          "INTRAMINUTE_LIMIT_TOUCH",
      };
    }
  }

  return {
    filled: false,
    observedAt: null,
    fillPrice: null,
    fillType: null,
  };
}

async function main() {
  const root = process.cwd();

  const expandedPath =
    path.join(
      root,
      "logs",
      "alpha-v2-expanded-entry-comparison.json",
    );

  if (!fs.existsSync(expandedPath)) {
    throw new Error(
      "EXPANDED_ENTRY_COMPARISON_LOG_NOT_FOUND",
    );
  }

  const expanded =
    JSON.parse(
      fs.readFileSync(
        expandedPath,
        "utf8",
      ),
    );

  const candidates =
    (expanded.results ?? [])
      .filter(
        (row: any) =>
          row.snapshotCount === 381 &&
          row.correctedEntry?.qualified === true &&
          row.correctedEntry?.observedAt,
      );

  if (!candidates.length) {
    throw new Error(
      "NO_FULL381_CORRECTED_QUALIFIED_SESSIONS",
    );
  }

  const supabase =
    createSupabaseServerClient();

  const premiumCaps = [
    0.0025,
    0.005,
    0.0075,
    0.01,
  ];

  const sessions: any[] = [];

  for (const candidate of candidates) {
    const start =
      `${candidate.targetSessionDate}T00:00:00+09:00`;

    const end =
      `${candidate.targetSessionDate}T23:59:59+09:00`;

    const snapshotResult =
      await supabase
        .from("market_snapshots")
        .select(
          "stock_code,observed_at,raw_payload",
        )
        .eq(
          "stock_code",
          candidate.stockCode,
        )
        .gte(
          "observed_at",
          start,
        )
        .lte(
          "observed_at",
          end,
        )
        .order(
          "observed_at",
          { ascending: true },
        )
        .limit(1000);

    if (snapshotResult.error) {
      throw snapshotResult.error;
    }

    const barResult =
      await supabase
        .from("market_daily_bars")
        .select(
          "stock_code,trading_date,open_price,close_price,adjusted_price",
        )
        .eq(
          "stock_code",
          candidate.stockCode,
        )
        .eq(
          "adjusted_price",
          true,
        )
        .gte(
          "trading_date",
          candidate.targetSessionDate,
        )
        .order(
          "trading_date",
          { ascending: true },
        )
        .limit(5);

    if (barResult.error) {
      throw barResult.error;
    }

    const bars =
      (barResult.data ?? [])
        .map(
          (row: any) => ({
            date:
              String(
                row.trading_date,
              ),
            open:
              Number(
                row.open_price,
              ),
            close:
              Number(
                row.close_price,
              ),
          }),
        )
        .filter(
          (row: any) =>
            Number.isFinite(
              row.open,
            ) &&
            Number.isFinite(
              row.close,
            ) &&
            row.open > 0 &&
            row.close > 0,
        );

    const b1 = bars[0];
    const b3 = bars[2];
    const b5 = bars[4];

    if (!b1) {
      continue;
    }

    const sessionOpen =
      b1.open;

    const snapshots =
      snapshotResult.data ?? [];

    const policies =
      premiumCaps.map(
        (cap) => {
          const limitPrice =
            sessionOpen *
            (1 + cap);

          const fill =
            simulateLimitFill(
              snapshots,
              candidate.correctedEntry.observedAt,
              limitPrice,
            );

          const ret = (
            bar: any,
          ) =>
            fill.filled &&
            fill.fillPrice &&
            bar
              ? bar.close /
                  fill.fillPrice -
                1
              : null;

          return {
            maxPremium:
              cap,

            limitPrice,

            ...fill,

            returns: {
              r1:
                ret(b1),
              r3:
                ret(b3),
              r5:
                ret(b5),
            },
          };
        },
      );

    sessions.push({
      alphaDate:
        candidate.alphaDate,

      stockCode:
        candidate.stockCode,

      targetSessionDate:
        candidate.targetSessionDate,

      signalObservedAt:
        candidate.correctedEntry.observedAt,

      signalEntryPrice:
        candidate.correctedEntry.entryPrice,

      sessionOpen,

      signalPremiumOverOpen:
        candidate.correctedEntry.entryPrice /
          sessionOpen -
        1,

      policies,
    });
  }

  const summaries =
    premiumCaps.map(
      (cap) => {
        const rows =
          sessions
            .map(
              (session) => ({
                session,
                policy:
                  session.policies.find(
                    (policy: any) =>
                      policy.maxPremium ===
                      cap,
                  ),
              }),
            )
            .filter(
              (row) =>
                row.policy,
            );

        const filled =
          rows.filter(
            (row) =>
              row.policy.filled,
          );

        const meanReturn = (
          horizon:
            | "r1"
            | "r3"
            | "r5",
        ) =>
          avg(
            filled
              .map(
                (row) =>
                  row.policy
                    .returns[
                    horizon
                  ],
              )
              .filter(
                Number.isFinite,
              ),
          );

        const positiveRate = (
          horizon:
            | "r1"
            | "r3"
            | "r5",
        ) => {
          const values =
            filled
              .map(
                (row) =>
                  row.policy
                    .returns[
                    horizon
                  ],
              )
              .filter(
                Number.isFinite,
              ) as number[];

          return values.length
            ? values.filter(
                (value) =>
                  value > 0,
              ).length /
                values.length
            : null;
        };

        return {
          maxPremium:
            cap,

          candidateSessions:
            rows.length,

          filledSessions:
            filled.length,

          fillRate:
            rows.length
              ? filled.length /
                rows.length
              : null,

          meanReturn: {
            r1:
              meanReturn("r1"),
            r3:
              meanReturn("r3"),
            r5:
              meanReturn("r5"),
          },

          positiveRate: {
            r1:
              positiveRate("r1"),
            r3:
              positiveRate("r3"),
            r5:
              positiveRate("r5"),
          },
        };
      },
    );

  const directSignalBaseline = {
    sessionCount:
      candidates.length,

    meanReturn: {
      r1:
        avg(
          candidates
            .map(
              (row: any) =>
                row.correctedEntry
                  .returns.r1,
            )
            .filter(
              Number.isFinite,
            ),
        ),

      r3:
        avg(
          candidates
            .map(
              (row: any) =>
                row.correctedEntry
                  .returns.r3,
            )
            .filter(
              Number.isFinite,
            ),
        ),

      r5:
        avg(
          candidates
            .map(
              (row: any) =>
                row.correctedEntry
                  .returns.r5,
            )
            .filter(
              Number.isFinite,
            ),
        ),
    },
  };

  const result = {
    status:
      "ALPHA_V2_ENTRY_POST_SIGNAL_LIMIT_REPLAY_COMPLETE",

    counts: {
      full381CorrectedQualifiedSessions:
        sessions.length,
    },

    directSignalBaseline,

    limitPolicies:
      summaries,

    perSession:
      sessions,

    methodology: {
      gate:
        "corrected Entry qualifies=true",

      execution:
        "after signal, place buy limit at sessionOpen * (1 + premiumCap)",

      fillRule:
        "minute open <= limit => fill at minute open; otherwise minute low <= limit => fill at limit",

      minuteData:
        "raw_payload.minute_bar from KIS historical 1-minute bars",

      productionParameterSelectionAllowed:
        false,

      reason:
        "Only 9 qualified full-minute sessions; directional diagnostic only.",
    },

    safety: {
      databaseReadsOnly:
        true,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionChanged:
        false,
    },

    nextGate:
      "DECIDE_ENTRY_V3_GATE_PLUS_LIMIT_EXECUTION_DIRECTION",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-entry-post-signal-limit-replay.json",
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

        counts:
          result.counts,

        directSignalBaseline:
          result.directSignalBaseline,

        limitPolicies:
          result.limitPolicies,

        nextGate:
          result.nextGate,

        outputFile:
          "logs/alpha-v2-entry-post-signal-limit-replay.json",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V2_ENTRY_POST_SIGNAL_LIMIT_REPLAY_FAILED",

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
});
