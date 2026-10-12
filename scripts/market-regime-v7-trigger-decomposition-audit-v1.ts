import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

type Row = Record<string, any>;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const supabase = createSupabaseServerClient();

  const {
    data,
    error,
  } = await supabase
    .from("market_regime_shadow_comparisons")
    .select(`
      id,
      comparison_eligible,
      v7_would_block,
      v7_breadth_20,
      v7_average_volatility_20
    `)
    .eq("comparison_eligible", true)
    .limit(5000);

  if (error) {
    throw new Error(`COMPARISON_READ_FAILED:${error.message}`);
  }

  const rows = (data ?? []) as Row[];

  const breadthThreshold = 0.40;
  const volThreshold = 0.30;

  let usable = 0;
  let breadthOnly = 0;
  let volOnly = 0;
  let both = 0;
  let neither = 0;
  let storedBlockMismatch = 0;

  for (const row of rows) {
    const breadth = num(row.v7_breadth_20);
    const vol = num(row.v7_average_volatility_20);

    if (breadth === null || vol === null) continue;

    usable += 1;

    const breadthLow = breadth <= breadthThreshold;
    const highVol = vol >= volThreshold;
    const expectedBlocked = breadthLow || highVol;

    if (Boolean(row.v7_would_block) !== expectedBlocked) {
      storedBlockMismatch += 1;
    }

    if (breadthLow && highVol) both += 1;
    else if (breadthLow) breadthOnly += 1;
    else if (highVol) volOnly += 1;
    else neither += 1;
  }

  const pct = (n: number) =>
    usable > 0 ? n / usable : null;

  const output = {
    status:
      "MARKET_REGIME_V7_TRIGGER_DECOMPOSITION_AUDIT_V1_COMPLETE",

    rows: {
      comparisonEligible: rows.length,
      usable,
    },

    thresholds: {
      breadth20Max: breadthThreshold,
      highVolatility20Min: volThreshold,
    },

    triggers: {
      breadthOnly,
      volOnly,
      both,
      neither,
      breadthTriggeredRate:
        pct(breadthOnly + both),
      volatilityTriggeredRate:
        pct(volOnly + both),
      anyBlockTriggeredRate:
        pct(breadthOnly + volOnly + both),
    },

    consistency: {
      storedBlockMismatch,
    },

    interpretation:
      usable > 0 &&
      (volOnly + both) / usable >= 0.9
        ? "HIGH_VOL_THRESHOLD_DOMINATES_POLICY"
        : usable > 0 &&
          (breadthOnly + both) / usable >= 0.9
          ? "BREADTH_THRESHOLD_DOMINATES_POLICY"
          : usable > 0 &&
            (breadthOnly + volOnly + both) / usable >= 0.95
            ? "COMBINED_OR_POLICY_EFFECTIVELY_ALWAYS_BLOCKS"
            : "NO_SINGLE_DOMINANT_TRIGGER",

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
      "logs/market-regime-v7-trigger-decomposition-audit-v1.json",

    nextGate:
      "DECIDE_IF_POLICY_THRESHOLDS_REQUIRE_DESIGN_REVIEW_WITHOUT_OOS_RETUNING",
  };

  fs.mkdirSync(
    path.resolve(process.cwd(), "logs"),
    { recursive: true },
  );

  fs.writeFileSync(
    path.resolve(process.cwd(), output.fullDetails),
    JSON.stringify(output, null, 2) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status: output.status,
        rows: output.rows,
        triggers: output.triggers,
        consistency: output.consistency,
        interpretation: output.interpretation,
        nextGate: output.nextGate,
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
          "MARKET_REGIME_V7_TRIGGER_DECOMPOSITION_AUDIT_V1_ERROR",
        error:
          error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
});
