import fs from "node:fs";
import path from "node:path";

const VERSION =
  "ALPHA_V3_ENTRY_V3_FORWARD_SHADOW_OOS_V1";

const CHECKPOINT_FILE = path.resolve(
  process.cwd(),
  "logs/alpha-v3-extended-entry-v3-replay-checkpoint.json",
);

const VALIDATION_FILE = path.resolve(
  process.cwd(),
  "logs/alpha-v3-entry-v3-chronological-cap-validation.json",
);

const STATE_FILE = path.resolve(
  process.cwd(),
  "logs/alpha-v3-entry-v3-forward-shadow-oos-state.json",
);

const OUTPUT_FILE = path.resolve(
  process.cwd(),
  "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
);

const MIN_QUALIFIED_SESSIONS = 30;
const MIN_FILL_RATE = 0.90;
const MIN_PAIRED_POSITIVE_RATE = 0.80;

type ReturnSet = {
  r1: number | null;
  r3: number | null;
  r5: number | null;
};

type ReplayRow = {
  targetSessionDate: string;
  stockCode: string;
  correctedEntry: {
    qualified: boolean;
    directReturns: ReturnSet;
  };
  limitPolicies: Array<{
    maxPremium: number;
    filled: boolean;
    returns: ReturnSet;
  }>;
};

function n(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stats(values: Array<number | null>) {
  const xs = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );

  return {
    count: xs.length,
    mean:
      xs.length > 0
        ? xs.reduce((sum, v) => sum + v, 0) / xs.length
        : null,
    positiveRate:
      xs.length > 0
        ? xs.filter((v) => v > 0).length / xs.length
        : null,
    min:
      xs.length > 0
        ? Math.min(...xs)
        : null,
    max:
      xs.length > 0
        ? Math.max(...xs)
        : null,
  };
}

function main() {
  if (!fs.existsSync(CHECKPOINT_FILE)) {
    throw new Error("CHECKPOINT_NOT_FOUND");
  }

  if (!fs.existsSync(VALIDATION_FILE)) {
    throw new Error("CHRONOLOGICAL_VALIDATION_NOT_FOUND");
  }

  const checkpoint =
    JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8"));

  const validation =
    JSON.parse(fs.readFileSync(VALIDATION_FILE, "utf8"));

  if (
    validation?.decision?.historicalStressTestPassed !== true
  ) {
    throw new Error("HISTORICAL_STRESS_TEST_NOT_PASSED");
  }

  const selectedCap =
    n(validation?.decision?.provisionalLeader);

  if (selectedCap === null) {
    throw new Error("PROVISIONAL_LEADER_NOT_FOUND");
  }

  const rows =
    Array.isArray(checkpoint?.results)
      ? (checkpoint.results as ReplayRow[])
      : [];

  if (rows.length === 0) {
    throw new Error("CHECKPOINT_RESULTS_EMPTY");
  }

  let state: any;

  if (fs.existsSync(STATE_FILE)) {
    state =
      JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } else {
    const historicalCutoff =
      rows
        .map((row) => String(row.targetSessionDate ?? ""))
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
      selectedCap,
      entryScoreThreshold: 0.66,
      frozen: true,
    };

    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(state, null, 2) + "\n",
      "utf8",
    );
  }

  if (
    Math.abs(Number(state.selectedCap) - selectedCap) > 1e-12
  ) {
    throw new Error("FORWARD_OOS_CAP_CHANGED_AFTER_FREEZE");
  }

  const oosRows =
    rows.filter(
      (row) =>
        String(row.targetSessionDate) >
        String(state.historicalCutoff),
    );

  const qualified =
    oosRows.filter(
      (row) =>
        row.correctedEntry?.qualified === true,
    );

  const policyRows =
    qualified
      .map((row) => {
        const policy =
          Array.isArray(row.limitPolicies)
            ? row.limitPolicies.find(
                (candidate) =>
                  Math.abs(
                    Number(candidate.maxPremium) -
                    selectedCap,
                  ) < 1e-12,
              )
            : null;

        return {
          row,
          policy,
        };
      })
      .filter(
        (
          item,
        ): item is {
          row: ReplayRow;
          policy: NonNullable<typeof item.policy>;
        } =>
          item.policy !== null &&
          item.policy !== undefined,
      );

  const filled =
    policyRows.filter(
      (item) =>
        item.policy.filled === true,
    );

  function paired(horizon: keyof ReturnSet) {
    return stats(
      filled.map((item) => {
        const direct =
          n(item.row.correctedEntry.directReturns[horizon]);

        const limited =
          n(item.policy.returns[horizon]);

        if (direct === null || limited === null) {
          return null;
        }

        return limited - direct;
      }),
    );
  }

  const pairedVsDirect = {
    r1: paired("r1"),
    r3: paired("r3"),
    r5: paired("r5"),
  };

  const fillRate =
    qualified.length > 0
      ? filled.length / qualified.length
      : null;

  const enoughSample =
    qualified.length >= MIN_QUALIFIED_SESSIONS;

  const pairedPositive =
    ["r1", "r3", "r5"].every((key) => {
      const value =
        pairedVsDirect[key as keyof typeof pairedVsDirect];

      return (
        value.mean !== null &&
        value.mean > 0 &&
        value.positiveRate !== null &&
        value.positiveRate >= MIN_PAIRED_POSITIVE_RATE
      );
    });

  const passed =
    enoughSample &&
    fillRate !== null &&
    fillRate >= MIN_FILL_RATE &&
    pairedPositive;

  const result = {
    status:
      oosRows.length === 0
        ? "ALPHA_V3_ENTRY_V3_FORWARD_SHADOW_OOS_INITIALIZED"
        : "ALPHA_V3_ENTRY_V3_FORWARD_SHADOW_OOS_EVALUATED",

    version: VERSION,

    contract: {
      historicalCutoff: state.historicalCutoff,
      selectedCap,
      entryScoreThreshold: state.entryScoreThreshold,
      structure:
        "CORRECTED_ENTRY_GATE_PLUS_POST_SIGNAL_ANTI_CHASE_LIMIT",
      minQualifiedSessions: MIN_QUALIFIED_SESSIONS,
      minFillRate: MIN_FILL_RATE,
      minPairedPositiveRate: MIN_PAIRED_POSITIVE_RATE,
      retuningAllowed: false,
      productionChanged: false,
    },

    counts: {
      unseenSessions: oosRows.length,
      qualifiedSessions: qualified.length,
      policyRowsFound: policyRows.length,
      filledSessions: filled.length,
    },

    performance: {
      fillRate,
      pairedVsDirect,
    },

    decision: {
      enoughSample,
      forwardShadowPassed: passed,
      exactProductionCapLocked: false,
      selectedCap,
      nextUse:
        passed
          ? "LOCK_ENTRY_V3_PRODUCTION_CAP"
          : "CONTINUE_COLLECTING_UNSEEN_FORWARD_SESSIONS",
    },

    safety: {
      databaseReads: 0,
      databaseWrites: 0,
      kisRequests: 0,
      ordersCreated: 0,
      positionsChanged: 0,
      productionChanged: false,
      thresholdChanged: false,
    },

    nextGate:
      passed
        ? "LOCK_ENTRY_V3_PRODUCTION_CAP"
        : "COLLECT_ENTRY_V3_FORWARD_SHADOW_OOS",

    outputFile:
      "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
  };

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
          "ALPHA_V3_ENTRY_V3_FORWARD_SHADOW_OOS_FAILED",
        version: VERSION,
        message:
          error instanceof Error
            ? error.message
            : String(error),
        safety: {
          databaseReads: 0,
          databaseWrites: 0,
          kisRequests: 0,
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
