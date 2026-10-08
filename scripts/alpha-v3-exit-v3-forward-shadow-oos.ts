import fs from "node:fs";
import path from "node:path";
import { createSupabaseServerClient } from "../lib/supabase";

const VERSION = "ALPHA_V3_EXIT_V3_FORWARD_SHADOW_OOS_V1";

const CHECKPOINT_FILE = path.resolve(
  process.cwd(),
  "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json",
);

const ANALYSIS_FILE = path.resolve(
  process.cwd(),
  "logs/alpha-v3-exit-v3-policy-analysis.json",
);

const STATE_FILE = path.resolve(
  process.cwd(),
  "logs/alpha-v3-exit-v3-forward-shadow-oos-state.json",
);

const OUTPUT_FILE = path.resolve(
  process.cwd(),
  "logs/alpha-v3-exit-v3-forward-shadow-oos.json",
);

const ENTRY_PREMIUM_CAP = 0.01;
const MIN_COMPLETED_TRADES = 30;

const POLICIES = [
  {
    id: "BASELINE",
    initialStop: 0.025,
    activation: 0.03,
    trailing: 0.02,
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

function replay(
  entryPrice: number,
  entryDate: string,
  bars: DailyBar[],
  policy: Policy,
) {
  const future =
    bars.filter((bar) => bar.trading_date > entryDate);

  let stop =
    entryPrice * (1 - policy.initialStop);

  const activationPrice =
    entryPrice * (1 + policy.activation);

  let highest = entryPrice;
  let trailingActivated = false;

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

    if (open <= stop) {
      return {
        complete: true,
        exitDate: bar.trading_date,
        exitPrice: open,
        exitReason: "STOP_GAP",
        holdingDays: i + 1,
        realizedReturn:
          (open - entryPrice) / entryPrice,
        trailingActivated,
      };
    }

    if (low <= stop) {
      return {
        complete: true,
        exitDate: bar.trading_date,
        exitPrice: stop,
        exitReason: "STOP_TOUCH",
        holdingDays: i + 1,
        realizedReturn:
          (stop - entryPrice) / entryPrice,
        trailingActivated,
      };
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
      return {
        complete: true,
        exitDate: bar.trading_date,
        exitPrice: close,
        exitReason: "MAX_HOLD_CLOSE",
        holdingDays: policy.maxHoldingDays,
        realizedReturn:
          (close - entryPrice) / entryPrice,
        trailingActivated,
      };
    }
  }

  return {
    complete: false,
    exitDate: null,
    exitPrice: null,
    exitReason: null,
    holdingDays: null,
    realizedReturn: null,
    trailingActivated,
  };
}

async function main() {
  if (!fs.existsSync(CHECKPOINT_FILE)) {
    throw new Error("ENTRY_V3_CHECKPOINT_NOT_FOUND");
  }

  if (!fs.existsSync(ANALYSIS_FILE)) {
    throw new Error("EXIT_V3_POLICY_ANALYSIS_NOT_FOUND");
  }

  const checkpoint =
    JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8"));

  const analysis =
    JSON.parse(fs.readFileSync(ANALYSIS_FILE, "utf8"));

  if (
    analysis?.decision?.requireForwardShadowOOS !== true
  ) {
    throw new Error("FORWARD_SHADOW_NOT_REQUIRED_BY_ANALYSIS");
  }

  const rows =
    Array.isArray(checkpoint?.results)
      ? checkpoint.results
      : [];

  let state: any;

  if (fs.existsSync(STATE_FILE)) {
    state = JSON.parse(
      fs.readFileSync(STATE_FILE, "utf8"),
    );
  } else {
    const historicalCutoff =
      rows
        .map((row: any) => String(row?.targetSessionDate ?? ""))
        .filter(Boolean)
        .sort()
        .at(-1);

    if (!historicalCutoff) {
      throw new Error("HISTORICAL_CUTOFF_NOT_FOUND");
    }

    state = {
      version: VERSION,
      initializedAt: new Date().toISOString(),
      historicalCutoff,
      entryPremiumCap: ENTRY_PREMIUM_CAP,
      policies: POLICIES,
      minCompletedTrades: MIN_COMPLETED_TRADES,
      frozen: true,
    };

    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(state, null, 2) + "\n",
      "utf8",
    );
  }

  if (
    Number(state.entryPremiumCap) !== ENTRY_PREMIUM_CAP
  ) {
    throw new Error("ENTRY_CAP_CHANGED_AFTER_FREEZE");
  }

  const oosSourceRows =
    rows.filter(
      (row: any) =>
        String(row?.targetSessionDate ?? "") >
        String(state.historicalCutoff),
    );

  const entries =
    oosSourceRows
      .filter(
        (row: any) =>
          row?.correctedEntry?.qualified === true,
      )
      .map((row: any) => {
        const policy =
          Array.isArray(row?.limitPolicies)
            ? row.limitPolicies.find(
                (x: any) =>
                  Math.abs(
                    Number(x?.maxPremium) -
                      ENTRY_PREMIUM_CAP,
                  ) < 1e-12,
              )
            : null;

        return {
          entryDate: String(row?.targetSessionDate ?? ""),
          stockCode: String(row?.stockCode ?? ""),
          filled: policy?.filled === true,
          entryPrice: n(policy?.fillPrice),
        };
      })
      .filter(
        (row: any) =>
          row.filled &&
          row.entryDate &&
          row.stockCode &&
          row.entryPrice !== null &&
          row.entryPrice > 0,
      );

  const codes =
    [...new Set(entries.map((e: any) => e.stockCode))];

  const barsByStock =
    new Map<string, DailyBar[]>();

  let databaseReads = 0;

  for (const code of codes) {
    const { data, error } =
      await createSupabaseServerClient()
        .from("market_daily_bars")
        .select(
          "stock_code,trading_date,open_price,high_price,low_price,close_price,adjusted_price",
        )
        .eq("stock_code", code)
        .eq("adjusted_price", true)
        .gt("trading_date", state.historicalCutoff)
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

  const evaluated =
    entries.map((entry: any) => ({
      ...entry,
      policies: Object.fromEntries(
        POLICIES.map((policy) => [
          policy.id,
          replay(
            entry.entryPrice,
            entry.entryDate,
            barsByStock.get(entry.stockCode) ?? [],
            policy,
          ),
        ]),
      ),
    }));

  const comparable =
    evaluated.filter((row: any) =>
      POLICIES.every(
        (policy) =>
          row.policies?.[policy.id]?.complete === true,
      ),
    );

  const policyPerformance =
    POLICIES.map((policy) => {
      const usable =
        comparable.map(
          (row: any) =>
            n(row.policies?.[policy.id]?.realizedReturn),
        );

      const baselineDiff =
        comparable.map((row: any) => {
          const base =
            n(row.policies?.BASELINE?.realizedReturn);

          const test =
            n(row.policies?.[policy.id]?.realizedReturn);

          if (base === null || test === null) return null;
          return test - base;
        });

      const holdingDays =
        comparable.map(
          (row: any) =>
            n(row.policies?.[policy.id]?.holdingDays),
        );

      return {
        id: policy.id,
        policy,
        returns: stats(usable),
        pairedVsBaseline: stats(baselineDiff),
        holdingDays: stats(holdingDays),
      };
    });

  const enoughSample =
    comparable.length >= MIN_COMPLETED_TRADES;

  const trend =
    policyPerformance.find(
      (row) => row.id === "TREND_FOLLOW",
    );

  const fixed =
    policyPerformance.find(
      (row) => row.id === "FIXED_STOP_4PCT",
    );

  let provisionalWinner: string | null = null;

  if (enoughSample && trend && fixed) {
    /*
     * 사전 규칙:
     * 평균수익 하나만 보지 않는다.
     * 1) 평균수익
     * 2) 중앙값
     * 3) 승률
     * 세 항목 중 2개 이상 우위인 정책을 후보로 선택한다.
     */
    let trendWins = 0;
    let fixedWins = 0;

    const comparisons: Array<[number | null, number | null]> = [
      [trend.returns.mean, fixed.returns.mean],
      [trend.returns.median, fixed.returns.median],
      [trend.returns.positiveRate, fixed.returns.positiveRate],
    ];

    for (const [a, b] of comparisons) {
      if (a === null || b === null) continue;
      if (a > b) trendWins += 1;
      else if (b > a) fixedWins += 1;
    }

    if (trendWins >= 2) provisionalWinner = "TREND_FOLLOW";
    else if (fixedWins >= 2) provisionalWinner = "FIXED_STOP_4PCT";
  }

  const result = {
    status:
      oosSourceRows.length === 0
        ? "ALPHA_V3_EXIT_V3_FORWARD_SHADOW_OOS_INITIALIZED"
        : "ALPHA_V3_EXIT_V3_FORWARD_SHADOW_OOS_EVALUATED",

    version: VERSION,

    contract: {
      historicalCutoff: state.historicalCutoff,
      entryPremiumCap: ENTRY_PREMIUM_CAP,
      policies: POLICIES,
      minCompletedTrades: MIN_COMPLETED_TRADES,
      selectionRule:
        "After >=30 comparable completed OOS trades, choose the policy winning at least 2 of mean return, median return, and positive rate.",
      retuningAllowed: false,
      productionChanged: false,
    },

    counts: {
      unseenEntrySessions: oosSourceRows.length,
      filledOosEntries: entries.length,
      comparableCompletedTrades: comparable.length,
      incompleteTrades:
        evaluated.length - comparable.length,
      databaseReads,
    },

    policyPerformance,

    decision: {
      enoughSample,
      forwardShadowPassed:
        enoughSample && provisionalWinner !== null,
      provisionalWinner,
      exactProductionExitPolicyLocked: false,
      nextUse:
        enoughSample && provisionalWinner
          ? "REVIEW_EXIT_V3_FORWARD_OOS_FOR_POLICY_LOCK"
          : "CONTINUE_COLLECTING_EXIT_V3_FORWARD_OOS",
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
      enoughSample && provisionalWinner
        ? "REVIEW_EXIT_V3_FORWARD_OOS_FOR_POLICY_LOCK"
        : "COLLECT_ALPHA_V3_EXIT_V3_FORWARD_SHADOW_OOS",

    outputFile:
      "logs/alpha-v3-exit-v3-forward-shadow-oos.json",
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
        status:
          "ALPHA_V3_EXIT_V3_FORWARD_SHADOW_OOS_FAILED",
        version: VERSION,
        message:
          error instanceof Error
            ? error.message
            : String(error),
        safety: {
          databaseWrites: 0,
          ordersCreated: 0,
          productionChanged: false,
        },
      },
      null,
      2,
    ),
  );

  process.exit(1);
});
