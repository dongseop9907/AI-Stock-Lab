import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

type AnyRow = Record<string, any>;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stats(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);

  const q = (p: number) => {
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor((sorted.length - 1) * p)),
    );
    return sorted[index];
  };

  return {
    n: values.length,
    min: sorted[0],
    p25: q(0.25),
    median: q(0.5),
    p75: q(0.75),
    max: sorted[sorted.length - 1],
    avg: sum / values.length,
  };
}

function extractPolicyFacts(source: string) {
  const lines = source.split(/\r?\n/);

  const interesting = lines
    .map((text, index) => ({
      line: index + 1,
      text: text.trim(),
    }))
    .filter((row) =>
      /breadth20Max|highVolatility20Min|breadthLow|highVolatility|thresholds\s*=|DEFAULT|BLOCK_BREADTH_OR_HIGH_VOL/.test(
        row.text,
      ),
    )
    .slice(0, 40);

  return interesting;
}

async function main() {
  const root = process.cwd();

  const policyFile =
    path.resolve(
      root,
      "lib/market/market-regime-v7-policy.ts",
    );

  const policySource =
    fs.readFileSync(policyFile, "utf8");

  const policyFacts =
    extractPolicyFacts(policySource);

  const supabase =
    createSupabaseServerClient();

  const {
    data: outcomeData,
    error: outcomeError,
  } =
    await supabase
      .from("market_regime_shadow_outcomes")
      .select("*")
      .eq("evaluation_status", "COMPLETED")
      .limit(1000);

  if (outcomeError) {
    throw new Error(
      `OUTCOME_READ_FAILED:${outcomeError.message}`,
    );
  }

  const outcomes =
    ((outcomeData ?? []) as AnyRow[])
      .filter((row) => row.is_validation !== true);

  const outcomeCounts = {
    rows: outcomes.length,
    v6BlockTrue: outcomes.filter((row) => Boolean(row.v6_would_block)).length,
    v6BlockFalse: outcomes.filter((row) => !Boolean(row.v6_would_block)).length,
    v7BlockTrue: outcomes.filter((row) => Boolean(row.v7_would_block)).length,
    v7BlockFalse: outcomes.filter((row) => !Boolean(row.v7_would_block)).length,
    positiveReturn5d: outcomes.filter((row) => {
      const r = num(row.return_5d);
      return r !== null && r > 0;
    }).length,
    negativeReturn5d: outcomes.filter((row) => {
      const r = num(row.return_5d);
      return r !== null && r < 0;
    }).length,
    flatReturn5d: outcomes.filter((row) => {
      const r = num(row.return_5d);
      return r !== null && r === 0;
    }).length,
  };

  const {
    data: comparisonData,
    error: comparisonError,
  } =
    await supabase
      .from("market_regime_shadow_comparisons")
      .select("*")
      .eq("comparison_eligible", true)
      .limit(1000);

  if (comparisonError) {
    throw new Error(
      `COMPARISON_READ_FAILED:${comparisonError.message}`,
    );
  }

  const comparisons =
    (comparisonData ?? []) as AnyRow[];

  const allKeys =
    [...new Set(
      comparisons.flatMap((row) =>
        Object.keys(row),
      ),
    )];

  const featureKeys =
    allKeys.filter((key) =>
      /breadth|volatility|vol_20|realized/i.test(key),
    );

  const featureStats:
    Record<string, ReturnType<typeof stats>> = {};

  for (const key of featureKeys) {
    const values =
      comparisons
        .map((row) => num(row[key]))
        .filter((value): value is number => value !== null);

    featureStats[key] = stats(values);
  }

  const output = {
    status:
      "MARKET_REGIME_V7_THRESHOLD_SCALE_AUDIT_V1_COMPLETE",

    outcomeCounts,

    blockRates: {
      v6:
        outcomeCounts.rows > 0
          ? outcomeCounts.v6BlockTrue / outcomeCounts.rows
          : null,
      v7:
        outcomeCounts.rows > 0
          ? outcomeCounts.v7BlockTrue / outcomeCounts.rows
          : null,
    },

    returnSignRates: {
      positive:
        outcomeCounts.rows > 0
          ? outcomeCounts.positiveReturn5d / outcomeCounts.rows
          : null,
      negative:
        outcomeCounts.rows > 0
          ? outcomeCounts.negativeReturn5d / outcomeCounts.rows
          : null,
    },

    policyFacts,
    comparisonFeatureKeys: featureKeys,
    featureStats,

    diagnosisHint:
      outcomeCounts.v7BlockTrue >= Math.max(1, outcomeCounts.rows - 1)
        ? "V7_IS_EFFECTIVELY_ALWAYS_BLOCKING"
        : "V7_NOT_ALWAYS_BLOCKING",

    safety: {
      databaseReads: true,
      databaseWrites: 0,
      sourceFilesModified: 0,
      regimePolicyChanged: false,
      forwardEvidenceChanged: false,
      ordersCreated: 0,
      positionsChanged: 0,
      realTradingChanged: false,
    },

    fullDetails:
      "logs/market-regime-v7-threshold-scale-audit-v1.json",

    nextGate:
      "IDENTIFY_THRESHOLD_OR_FEATURE_SCALE_ROOT_CAUSE",
  };

  fs.mkdirSync(
    path.resolve(root, "logs"),
    { recursive: true },
  );

  fs.writeFileSync(
    path.resolve(root, output.fullDetails),
    JSON.stringify(output, null, 2) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status: output.status,
        rows: outcomeCounts.rows,
        blockRates: output.blockRates,
        returns: output.returnSignRates,
        diagnosisHint: output.diagnosisHint,
        policyFacts: policyFacts.slice(0, 14),
        featureKeys,
        featureStats,
        nextGate: output.nextGate,
        details: output.fullDetails,
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
          "MARKET_REGIME_V7_THRESHOLD_SCALE_AUDIT_V1_ERROR",
        error:
          error instanceof Error
            ? error.message
            : String(error),
        safety: {
          databaseWrites: 0,
          sourceFilesModified: 0,
          ordersCreated: 0,
          positionsChanged: 0,
        },
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
});
