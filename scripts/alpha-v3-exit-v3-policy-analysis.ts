import fs from "node:fs";
import path from "node:path";

const VERSION = "ALPHA_V3_EXIT_V3_POLICY_ANALYSIS_V1";

const INPUT_FILE = path.resolve(
  process.cwd(),
  "logs/alpha-v3-exit-v3-policy-grid.json",
);

const OUTPUT_FILE = path.resolve(
  process.cwd(),
  "logs/alpha-v3-exit-v3-policy-analysis.json",
);

function n(v: unknown): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error("EXIT_V3_POLICY_GRID_NOT_FOUND");
  }

  const grid = JSON.parse(
    fs.readFileSync(INPUT_FILE, "utf8"),
  );

  const summaries = Array.isArray(grid?.policySummary)
    ? grid.policySummary
    : [];

  const folds = Array.isArray(grid?.foldResults)
    ? grid.foldResults
    : [];

  const robustness = Array.isArray(grid?.robustness)
    ? grid.robustness
    : [];

  const baseline =
    summaries.find(
      (row: any) => row?.policy?.id === "BASELINE",
    );

  if (!baseline) {
    throw new Error("BASELINE_NOT_FOUND");
  }

  const candidates =
    summaries
      .filter(
        (row: any) =>
          row?.policy?.id &&
          row.policy.id !== "BASELINE",
      )
      .map((row: any) => {
        const id = row.policy.id;

        const robust =
          robustness.find(
            (r: any) => r?.id === id,
          ) ?? {};

        const foldRows =
          folds.map((fold: any) => {
            const item =
              Array.isArray(fold?.policies)
                ? fold.policies.find(
                    (p: any) => p?.id === id,
                  )
                : null;

            const base =
              Array.isArray(fold?.policies)
                ? fold.policies.find(
                    (p: any) => p?.id === "BASELINE",
                  )
                : null;

            return {
              fold: fold?.fold ?? null,
              firstDate: fold?.firstDate ?? null,
              lastDate: fold?.lastDate ?? null,
              meanReturn: n(item?.returns?.mean),
              positiveRate: n(item?.returns?.positiveRate),
              pairedMean: n(item?.pairedVsBaseline?.mean),
              baselineMeanReturn: n(base?.returns?.mean),
            };
          });

        const overallMean =
          n(row?.returns?.mean) ?? -Infinity;

        const positiveRate =
          n(row?.returns?.positiveRate) ?? 0;

        const pairedMean =
          n(row?.pairedVsBaseline?.mean) ?? -Infinity;

        const worstFold =
          n(robust?.worstFoldMeanImprovement) ?? -Infinity;

        const averageFold =
          n(robust?.averageFoldMeanImprovement) ?? -Infinity;

        const positiveFolds =
          Number(robust?.positiveImprovementFolds ?? 0);

        const recentFold =
          foldRows.at(-1);

        const recentPaired =
          recentFold?.pairedMean ?? -Infinity;

        /*
         * 단일 수익률 최대화가 아니라
         * 전체수익 + 승률 + 시간 안정성 + 최근구간 방어를 함께 본다.
         *
         * 순위용 점수이며 Production 정책 확정에는 사용하지 않는다.
         */
        const score =
          overallMean * 0.30 +
          pairedMean * 0.20 +
          averageFold * 0.20 +
          worstFold * 0.15 +
          recentPaired * 0.10 +
          positiveRate * 0.01 +
          positiveFolds * 0.0025;

        return {
          id,
          policy: row.policy,

          overall: {
            meanReturn: overallMean,
            medianReturn: n(row?.returns?.median),
            positiveRate,
            pairedVsBaselineMean: pairedMean,
            holdingDaysMean: n(row?.holdingDays?.mean),
            trailingActivationRate:
              n(row?.trailingActivationRate),
          },

          temporal: {
            positiveImprovementFolds: positiveFolds,
            worstFoldMeanImprovement: worstFold,
            averageFoldMeanImprovement: averageFold,
            recentFoldMeanImprovement: recentPaired,
            foldRows,
          },

          decisionScore: score,
        };
      })
      .sort(
        (a: any, b: any) =>
          b.decisionScore - a.decisionScore,
      );

  const leader = candidates[0] ?? null;
  const runnerUp = candidates[1] ?? null;

  const trend =
    candidates.find(
      (row: any) => row.id === "TREND_FOLLOW",
    );

  const later =
    candidates.find(
      (row: any) => row.id === "LATER_TRAIL",
    );

  const result = {
    status:
      "ALPHA_V3_EXIT_V3_POLICY_ANALYSIS_COMPLETE",

    version: VERSION,

    baseline: {
      meanReturn: n(baseline?.returns?.mean),
      medianReturn: n(baseline?.returns?.median),
      positiveRate: n(baseline?.returns?.positiveRate),
      holdingDaysMean: n(baseline?.holdingDays?.mean),
    },

    ranking: candidates,

    focusedComparison: {
      LATER_TRAIL: later ?? null,
      TREND_FOLLOW: trend ?? null,
    },

    decision: {
      provisionalForwardShadowPolicy:
        leader?.id ?? null,

      runnerUp:
        runnerUp?.id ?? null,

      exactProductionExitPolicyLocked: false,

      productionChanged: false,

      rationale:
        "Use the historical grid only to choose a provisional forward-shadow policy. Prefer a candidate that materially improves return and win rate while remaining reasonably stable across chronological folds; do not lock from the same sample.",

      requireForwardShadowOOS: true,
    },

    safety: {
      databaseReads: 0,
      databaseWrites: 0,
      kisRequests: 0,
      ordersCreated: 0,
      positionsChanged: 0,
      productionChanged: false,
    },

    nextGate:
      "BUILD_ALPHA_V3_EXIT_V3_FORWARD_SHADOW_OOS",

    outputFile:
      "logs/alpha-v3-exit-v3-policy-analysis.json",
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

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_EXIT_V3_POLICY_ANALYSIS_FAILED",
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
}
