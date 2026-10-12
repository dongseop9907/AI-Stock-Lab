import fs from "node:fs";
import path from "node:path";

const VERSION =
  "ALPHA_V3_LOCK_ENTRY_V3_STRUCTURE_V1";

const ANALYSIS_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-extended-entry-v3-analysis.json",
  );

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-entry-v3-structure-decision.json",
  );

const FROZEN_PREMIUM_CAPS = [
  0.0025,
  0.005,
  0.0075,
  0.01,
];

function fail(
  message: string,
): never {
  throw new Error(message);
}

function numberOrNull(
  value: unknown,
): number | null {
  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function readAnalysis() {
  if (
    !fs.existsSync(
      ANALYSIS_FILE,
    )
  ) {
    fail(
      "ENTRY_V3_ANALYSIS_FILE_NOT_FOUND",
    );
  }

  const parsed =
    JSON.parse(
      fs.readFileSync(
        ANALYSIS_FILE,
        "utf8",
      ),
    );

  if (
    parsed?.status !==
    "ALPHA_V3_EXTENDED_ENTRY_V3_ANALYSIS_COMPLETE"
  ) {
    fail(
      "ENTRY_V3_ANALYSIS_NOT_COMPLETE",
    );
  }

  return parsed;
}

function policyByCap(
  analysis: any,
  cap: number,
) {
  const policies =
    Array.isArray(
      analysis?.limitPolicies,
    )
      ? analysis.limitPolicies
      : [];

  return (
    policies.find(
      (policy: any) => {
        const value =
          numberOrNull(
            policy?.maxPremium,
          );

        return (
          value !== null &&
          Math.abs(
            value - cap,
          ) < 1e-12
        );
      },
    ) ?? null
  );
}

function main() {
  const analysis =
    readAnalysis();

  const totalSessions =
    Number(
      analysis?.counts
        ?.totalSessions ?? 0,
    );

  const correctedQualifiedSessions =
    Number(
      analysis?.counts
        ?.correctedQualifiedSessions ??
        0,
    );

  if (
    totalSessions < 251
  ) {
    fail(
      `ENTRY_V3_EXPECTED_251_SESSIONS_GOT_${totalSessions}`,
    );
  }

  if (
    correctedQualifiedSessions <= 0
  ) {
    fail(
      "NO_CORRECTED_QUALIFIED_SESSIONS",
    );
  }

  const missingCaps =
    FROZEN_PREMIUM_CAPS
      .filter(
        (cap) =>
          !policyByCap(
            analysis,
            cap,
          ),
      );

  if (
    missingCaps.length > 0
  ) {
    fail(
      `ENTRY_V3_POLICY_CAPS_MISSING_${missingCaps.join(
        "_",
      )}`,
    );
  }

  const robustnessPositive =
    analysis
      ?.robustness
      ?.bestPolicyPairedImprovementPositiveAcrossBothHalves ===
    true;

  const structuralDirection =
    String(
      analysis
        ?.decision
        ?.structuralDirection ??
        "",
    );

  const expectedDirection =
    "CORRECTED_ENTRY_GATE_PLUS_POST_SIGNAL_ANTI_CHASE_LIMIT";

  if (
    !robustnessPositive
  ) {
    fail(
      "ENTRY_V3_ROBUSTNESS_GATE_FAILED",
    );
  }

  if (
    structuralDirection !==
    expectedDirection
  ) {
    fail(
      `UNEXPECTED_ENTRY_V3_STRUCTURAL_DIRECTION_${structuralDirection}`,
    );
  }

  const observedLeader =
    numberOrNull(
      analysis
        ?.decision
        ?.bestObservedPremiumCap,
    );

  const frozenPolicyEvidence =
    FROZEN_PREMIUM_CAPS.map(
      (cap) => {
        const policy =
          policyByCap(
            analysis,
            cap,
          );

        return {
          maxPremium:
            cap,

          fillRate:
            numberOrNull(
              policy
                ?.fillRate,
            ),

          compositeScore:
            numberOrNull(
              policy
                ?.compositeScore,
            ),

          pairedVsDirectMean: {
            r1:
              numberOrNull(
                policy
                  ?.pairedVsDirect
                  ?.r1
                  ?.mean,
              ),

            r3:
              numberOrNull(
                policy
                  ?.pairedVsDirect
                  ?.r3
                  ?.mean,
              ),

            r5:
              numberOrNull(
                policy
                  ?.pairedVsDirect
                  ?.r5
                  ?.mean,
              ),
          },
        };
      },
    );

  const result = {
    status:
      "ALPHA_V3_ENTRY_V3_STRUCTURE_LOCK_COMPLETE",

    version:
      VERSION,

    counts: {
      analyzedSessions:
        totalSessions,

      correctedQualifiedSessions,
    },

    structureDecision: {
      structureLocked:
        true,

      alphaCandidateLayerChanged:
        false,

      entrySignalGate:
        "CORRECTED_ENTRY_GATE",

      executionLayer:
        "POST_SIGNAL_ANTI_CHASE_LIMIT",

      directCorrectedEntry:
        "CONTROL_BASELINE",

      exactProductionPremiumCapLocked:
        false,

      productionCapSelection:
        "DEFER_TO_PREDECLARED_CHRONOLOGICAL_VALIDATION",

      observedSameSampleLeader:
        observedLeader,

      rationale:
        "251-session analysis supports the Entry V3 architecture, while the exact premium cap remains intentionally unlocked to reduce same-sample overfitting.",
    },

    frozenValidationContract: {
      baseline:
        "DIRECT_CORRECTED_ENTRY",

      premiumCaps:
        FROZEN_PREMIUM_CAPS,

      addNewPremiumCapsBeforeValidation:
        false,

      retuneEntryScoreThreshold:
        false,

      entryScoreThreshold:
        0.66,

      chronologicalEvaluation:
        true,

      compareSameSessions:
        true,

      requiredHorizons: [
        "r1",
        "r3",
        "r5",
      ],

      requiredMetrics: [
        "fillRate",
        "mean",
        "median",
        "positiveRate",
        "pairedVsDirect",
        "timeStability",
      ],

      selectionPrinciple:
        "Prefer a cap that preserves fill availability while retaining positive paired improvement and temporal stability; do not select on a single return metric.",
    },

    frozenPolicyEvidence,

    robustness: {
      pairedImprovementPositiveAcrossBothHalves:
        robustnessPositive,

      firstHalfSessionCount:
        Number(
          analysis
            ?.robustness
            ?.firstHalfSessionCount ??
            0,
        ),

      secondHalfSessionCount:
        Number(
          analysis
            ?.robustness
            ?.secondHalfSessionCount ??
            0,
        ),
    },

    safety: {
      databaseReads:
        0,

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

      thresholdChanged:
        false,
    },

    nextGate:
      "BUILD_ENTRY_V3_CHRONOLOGICAL_CAP_VALIDATION",

    outputFile:
      "logs/alpha-v3-entry-v3-structure-decision.json",
  };

  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE,
    ),
    {
      recursive: true,
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

try {
  main();
} catch (
  error
) {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_ENTRY_V3_STRUCTURE_LOCK_FAILED",

        version:
          VERSION,

        message:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),

        safety: {
          databaseReads:
            0,

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
}
