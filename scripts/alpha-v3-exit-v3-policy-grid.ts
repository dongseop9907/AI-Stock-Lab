import fs from "node:fs";
import path from "node:path";
import { createSupabaseServerClient } from "../lib/supabase";

const VERSION = "ALPHA_V3_EXIT_V3_POLICY_GRID_V1";

const CHECKPOINT_FILE = path.resolve(
  process.cwd(),
  "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json",
);

const OUTPUT_FILE = path.resolve(
  process.cwd(),
  "logs/alpha-v3-exit-v3-policy-grid.json",
);

const ENTRY_PREMIUM_CAP = 0.01;
const FOLD_COUNT = 4;

const POLICIES = [
  {
    id: "BASELINE",
    initialStop: 0.025,
    activation: 0.03,
    trailing: 0.02,
    maxHoldingDays: 20,
  },
  {
    id: "WIDER_STOP",
    initialStop: 0.04,
    activation: 0.03,
    trailing: 0.02,
    maxHoldingDays: 20,
  },
  {
    id: "LATER_TRAIL",
    initialStop: 0.025,
    activation: 0.05,
    trailing: 0.02,
    maxHoldingDays: 20,
  },
  {
    id: "WIDER_TRAIL",
    initialStop: 0.025,
    activation: 0.03,
    trailing: 0.035,
    maxHoldingDays: 20,
  },
  {
    id: "BALANCED",
    initialStop: 0.04,
    activation: 0.05,
    trailing: 0.035,
    maxHoldingDays: 20,
  },
  {
    id: "TREND_FOLLOW",
    initialStop: 0.05,
    activation: 0.08,
    trailing: 0.05,
    maxHoldingDays: 20,
  },
  {
    id: "FIXED_STOP_4PCT",
    initialStop: 0.04,
    activation: 99,
    trailing: 0,
    maxHoldingDays: 20,
  },
] as const;

type Policy = (typeof POLICIES)[number];

type DailyBar = {
  stock_code: string;
  trading_date: string;
  open_price: number | string | null;
  high_price: number | string | null;
  low_price: number | string | null;
  close_price: number | string | null;
};

type Entry = {
  entryDate: string;
  stockCode: string;
  entryPrice: number;
};

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2
    ? s[m]
    : (s[m - 1] + s[m]) / 2;
}

function stats(values: Array<number | null>) {
  const xs = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );

  return {
    count: xs.length,
    mean:
      xs.length
        ? xs.reduce((a, b) => a + b, 0) / xs.length
        : null,
    median: median(xs),
    positiveRate:
      xs.length
        ? xs.filter((v) => v > 0).length / xs.length
        : null,
    min: xs.length ? Math.min(...xs) : null,
    max: xs.length ? Math.max(...xs) : null,
  };
}

function splitIntoFolds<T>(rows: T[], count: number): T[][] {
  const folds: T[][] = [];
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor((i * rows.length) / count);
    const end = Math.floor(((i + 1) * rows.length) / count);
    folds.push(rows.slice(start, end));
  }
  return folds;
}

function replay(
  entry: Entry,
  bars: DailyBar[],
  policy: Policy,
) {
  const future = bars.filter(
    (bar) => bar.trading_date > entry.entryDate,
  );

  let stop =
    entry.entryPrice * (1 - policy.initialStop);

  const activationPrice =
    entry.entryPrice * (1 + policy.activation);

  let highest = entry.entryPrice;
  let trailingActivated = false;
  let exit: null | {
    exitDate: string;
    exitPrice: number;
    exitReason: string;
    holdingDays: number;
  } = null;

  let mfe = 0;
  let mae = 0;

  const observed =
    future.slice(0, policy.maxHoldingDays);

  for (let i = 0; i < observed.length; i += 1) {
    const bar = observed[i];

    const open = n(bar.open_price);
    const high = n(bar.high_price);
    const low = n(bar.low_price);
    const close = n(bar.close_price);

    if (
      open === null ||
      high === null ||
      low === null ||
      close === null
    ) {
      continue;
    }

    mfe = Math.max(
      mfe,
      (high - entry.entryPrice) / entry.entryPrice,
    );

    mae = Math.min(
      mae,
      (low - entry.entryPrice) / entry.entryPrice,
    );

    if (open <= stop) {
      exit = {
        exitDate: bar.trading_date,
        exitPrice: open,
        exitReason: "STOP_GAP",
        holdingDays: i + 1,
      };
      break;
    }

    if (low <= stop) {
      exit = {
        exitDate: bar.trading_date,
        exitPrice: stop,
        exitReason: "STOP_TOUCH",
        holdingDays: i + 1,
      };
      break;
    }

    highest = Math.max(highest, high);

    if (
      policy.trailing > 0 &&
      highest >= activationPrice
    ) {
      trailingActivated = true;

      const candidate =
        highest * (1 - policy.trailing);

      if (
        candidate > stop &&
        candidate < close
      ) {
        stop = candidate;
      }
    }

    if (i === policy.maxHoldingDays - 1) {
      exit = {
        exitDate: bar.trading_date,
        exitPrice: close,
        exitReason: "MAX_HOLD_CLOSE",
        holdingDays: policy.maxHoldingDays,
      };
    }
  }

  return {
    complete: exit !== null,
    return:
      exit
        ? (exit.exitPrice - entry.entryPrice) /
          entry.entryPrice
        : null,
    holdingDays: exit?.holdingDays ?? null,
    exitReason: exit?.exitReason ?? null,
    trailingActivated,
    mfe,
    mae,
  };
}

async function main() {
  if (!fs.existsSync(CHECKPOINT_FILE)) {
    throw new Error("CHECKPOINT_NOT_FOUND");
  }

  const checkpoint =
    JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8"));

  const rows =
    Array.isArray(checkpoint.results)
      ? checkpoint.results
      : [];

  const entries: Entry[] =
    rows
      .filter(
        (row: any) =>
          row?.correctedEntry?.qualified === true,
      )
      .map((row: any) => {
        const p =
          Array.isArray(row.limitPolicies)
            ? row.limitPolicies.find(
                (x: any) =>
                  Math.abs(
                    Number(x?.maxPremium) -
                      ENTRY_PREMIUM_CAP,
                  ) < 1e-12,
              )
            : null;

        return {
          entryDate: String(row.targetSessionDate ?? ""),
          stockCode: String(row.stockCode ?? ""),
          entryPrice: n(p?.fillPrice),
          filled: p?.filled === true,
        };
      })
      .filter(
        (x: any) =>
          x.filled &&
          x.entryPrice !== null &&
          x.entryPrice > 0 &&
          x.entryDate &&
          x.stockCode,
      )
      .map(
        (x: any) => ({
          entryDate: x.entryDate,
          stockCode: x.stockCode,
          entryPrice: x.entryPrice,
        }),
      );

  const codes = [...new Set(entries.map((e) => e.stockCode))];
  const minDate =
    [...entries]
      .map((e) => e.entryDate)
      .sort()[0];

  if (!entries.length || !minDate) {
    throw new Error("NO_ENTRY_ROWS");
  }

  const supabase = createSupabaseServerClient();
  const barsByStock = new Map<string, DailyBar[]>();

  let databaseReads = 0;

  for (const code of codes) {
    const { data, error } =
      await supabase
        .from("market_daily_bars")
        .select(
          "stock_code,trading_date,open_price,high_price,low_price,close_price,adjusted_price",
        )
        .eq("stock_code", code)
        .eq("adjusted_price", true)
        .gte("trading_date", minDate)
        .order("trading_date", { ascending: true })
        .limit(1000);

    databaseReads += 1;

    if (error) {
      throw new Error(
        `DAILY_BAR_READ_FAILED:${code}:${error.message}`,
      );
    }

    barsByStock.set(
      code,
      (data ?? []) as DailyBar[],
    );
  }

  const byEntry =
    entries
      .map((entry) => ({
        ...entry,
        policies: Object.fromEntries(
          POLICIES.map((policy) => [
            policy.id,
            replay(
              entry,
              barsByStock.get(entry.stockCode) ?? [],
              policy,
            ),
          ]),
        ),
      }))
      .sort((a, b) => {
        const d = a.entryDate.localeCompare(b.entryDate);
        return d !== 0
          ? d
          : a.stockCode.localeCompare(b.stockCode);
      });

  const baselineId = "BASELINE";

  const policySummary =
    POLICIES.map((policy) => {
      const rowsForPolicy =
        byEntry.filter(
          (row) =>
            row.policies[policy.id]?.complete === true,
        );

      const paired =
        byEntry
          .map((row) => {
            const base =
              row.policies[baselineId];
            const test =
              row.policies[policy.id];

            if (
              !base?.complete ||
              !test?.complete ||
              base.return === null ||
              test.return === null
            ) {
              return null;
            }

            return test.return - base.return;
          });

      const reasonCounts: Record<string, number> = {};

      for (const row of rowsForPolicy) {
        const reason =
          row.policies[policy.id]?.exitReason;

        if (reason) {
          reasonCounts[reason] =
            (reasonCounts[reason] ?? 0) + 1;
        }
      }

      return {
        policy,
        completed: rowsForPolicy.length,
        returns:
          stats(
            rowsForPolicy.map(
              (row) =>
                row.policies[policy.id]?.return ?? null,
            ),
          ),
        holdingDays:
          stats(
            rowsForPolicy.map(
              (row) =>
                row.policies[policy.id]?.holdingDays ?? null,
            ),
          ),
        pairedVsBaseline:
          stats(paired),
        trailingActivationRate:
          rowsForPolicy.length
            ? rowsForPolicy.filter(
                (row) =>
                  row.policies[policy.id]?.trailingActivated === true,
              ).length / rowsForPolicy.length
            : null,
        exitReasons: reasonCounts,
      };
    });

  const comparable =
    byEntry.filter(
      (row) =>
        POLICIES.every(
          (policy) =>
            row.policies[policy.id]?.complete === true,
        ),
    );

  const folds =
    splitIntoFolds(comparable, FOLD_COUNT);

  const foldResults =
    folds.map((fold, index) => ({
      fold: index + 1,
      firstDate: fold[0]?.entryDate ?? null,
      lastDate: fold.at(-1)?.entryDate ?? null,
      count: fold.length,
      policies:
        POLICIES.map((policy) => {
          const returns =
            fold.map(
              (row) =>
                row.policies[policy.id]?.return ?? null,
            );

          const paired =
            fold.map((row) => {
              const base =
                row.policies[baselineId]?.return;
              const test =
                row.policies[policy.id]?.return;

              if (
                base === null ||
                base === undefined ||
                test === null ||
                test === undefined
              ) {
                return null;
              }

              return test - base;
            });

          return {
            id: policy.id,
            returns: stats(returns),
            pairedVsBaseline: stats(paired),
          };
        }),
    }));

  const robustness =
    POLICIES
      .filter((policy) => policy.id !== baselineId)
      .map((policy) => {
        const foldMeans =
          foldResults.map((fold) => {
            const row =
              fold.policies.find(
                (x) => x.id === policy.id,
              );

            return row?.pairedVsBaseline.mean ?? null;
          });

        const usable =
          foldMeans.filter(
            (v): v is number => v !== null,
          );

        return {
          id: policy.id,
          positiveImprovementFolds:
            usable.filter((v) => v > 0).length,
          allFourFoldsPositive:
            usable.length === FOLD_COUNT &&
            usable.every((v) => v > 0),
          worstFoldMeanImprovement:
            usable.length
              ? Math.min(...usable)
              : null,
          averageFoldMeanImprovement:
            usable.length
              ? usable.reduce((a, b) => a + b, 0) /
                usable.length
              : null,
        };
      });

  const ranked =
    robustness
      .filter((r) => r.positiveImprovementFolds >= 3)
      .sort((a, b) => {
        if (
          b.positiveImprovementFolds !==
          a.positiveImprovementFolds
        ) {
          return (
            b.positiveImprovementFolds -
            a.positiveImprovementFolds
          );
        }

        return (
          (b.worstFoldMeanImprovement ?? -Infinity) -
          (a.worstFoldMeanImprovement ?? -Infinity)
        );
      });

  const result = {
    status: "ALPHA_V3_EXIT_V3_POLICY_GRID_COMPLETE",
    version: VERSION,

    contract: {
      policyCount: POLICIES.length,
      entryPremiumCap: ENTRY_PREMIUM_CAP,
      chronologicalFolds: FOLD_COUNT,
      sameSampleOptimizationWarning: true,
      productionPolicyLocked: false,
      productionChanged: false,
    },

    counts: {
      filledEntrySessions: entries.length,
      comparableAllPolicies: comparable.length,
      stockCount: codes.length,
      databaseReads,
    },

    policySummary,
    foldResults,
    robustness,

    decision: {
      provisionalLeader:
        ranked[0]?.id ?? null,
      exactProductionExitPolicyLocked: false,
      selectionAllowedForForwardShadowOnly: true,
      rationale:
        "Historical same-sample grid is used only to choose a provisional Exit V3 candidate. Production locking requires forward shadow OOS.",
    },

    safety: {
      databaseReadsOnly: true,
      databaseWrites: 0,
      kisRequests: 0,
      ordersCreated: 0,
      positionsChanged: 0,
      productionChanged: false,
    },

    nextGate:
      "ANALYZE_ALPHA_V3_EXIT_V3_POLICY_GRID",

    outputFile:
      "logs/alpha-v3-exit-v3-policy-grid.json",
  };

  fs.mkdirSync(
    path.dirname(OUTPUT_FILE),
    { recursive: true },
  );

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(result, null, 2) + "\n",
    "utf8",
  );

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "ALPHA_V3_EXIT_V3_POLICY_GRID_FAILED",
        version: VERSION,
        message:
          error instanceof Error
            ? error.message
            : String(error),
        safety: {
          databaseWrites: 0,
          kisRequests: 0,
          ordersCreated: 0,
          positionsChanged: 0,
          productionChanged: false,
        },
      },
      null,
      2,
    ),
  );

  process.exit(1);
});
