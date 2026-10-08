const fs = require("fs");
const path = require("path");

const TARGET =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-lock-entry-v3-structure.ts"
  );

const SOURCE =
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nconst VERSION =\n  \"ALPHA_V3_LOCK_ENTRY_V3_STRUCTURE_V1\";\n\nconst ANALYSIS_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs/alpha-v3-extended-entry-v3-analysis.json\",\n  );\n\nconst OUTPUT_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs/alpha-v3-entry-v3-structure-decision.json\",\n  );\n\nconst FROZEN_PREMIUM_CAPS = [\n  0.0025,\n  0.005,\n  0.0075,\n  0.01,\n];\n\nfunction fail(\n  message: string,\n): never {\n  throw new Error(message);\n}\n\nfunction numberOrNull(\n  value: unknown,\n): number | null {\n  const parsed =\n    Number(value);\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : null;\n}\n\nfunction readAnalysis() {\n  if (\n    !fs.existsSync(\n      ANALYSIS_FILE,\n    )\n  ) {\n    fail(\n      \"ENTRY_V3_ANALYSIS_FILE_NOT_FOUND\",\n    );\n  }\n\n  const parsed =\n    JSON.parse(\n      fs.readFileSync(\n        ANALYSIS_FILE,\n        \"utf8\",\n      ),\n    );\n\n  if (\n    parsed?.status !==\n    \"ALPHA_V3_EXTENDED_ENTRY_V3_ANALYSIS_COMPLETE\"\n  ) {\n    fail(\n      \"ENTRY_V3_ANALYSIS_NOT_COMPLETE\",\n    );\n  }\n\n  return parsed;\n}\n\nfunction policyByCap(\n  analysis: any,\n  cap: number,\n) {\n  const policies =\n    Array.isArray(\n      analysis?.limitPolicies,\n    )\n      ? analysis.limitPolicies\n      : [];\n\n  return (\n    policies.find(\n      (policy: any) => {\n        const value =\n          numberOrNull(\n            policy?.maxPremium,\n          );\n\n        return (\n          value !== null &&\n          Math.abs(\n            value - cap,\n          ) < 1e-12\n        );\n      },\n    ) ?? null\n  );\n}\n\nfunction main() {\n  const analysis =\n    readAnalysis();\n\n  const totalSessions =\n    Number(\n      analysis?.counts\n        ?.totalSessions ?? 0,\n    );\n\n  const correctedQualifiedSessions =\n    Number(\n      analysis?.counts\n        ?.correctedQualifiedSessions ??\n        0,\n    );\n\n  if (\n    totalSessions < 251\n  ) {\n    fail(\n      `ENTRY_V3_EXPECTED_251_SESSIONS_GOT_${totalSessions}`,\n    );\n  }\n\n  if (\n    correctedQualifiedSessions <= 0\n  ) {\n    fail(\n      \"NO_CORRECTED_QUALIFIED_SESSIONS\",\n    );\n  }\n\n  const missingCaps =\n    FROZEN_PREMIUM_CAPS\n      .filter(\n        (cap) =>\n          !policyByCap(\n            analysis,\n            cap,\n          ),\n      );\n\n  if (\n    missingCaps.length > 0\n  ) {\n    fail(\n      `ENTRY_V3_POLICY_CAPS_MISSING_${missingCaps.join(\n        \"_\",\n      )}`,\n    );\n  }\n\n  const robustnessPositive =\n    analysis\n      ?.robustness\n      ?.bestPolicyPairedImprovementPositiveAcrossBothHalves ===\n    true;\n\n  const structuralDirection =\n    String(\n      analysis\n        ?.decision\n        ?.structuralDirection ??\n        \"\",\n    );\n\n  const expectedDirection =\n    \"CORRECTED_ENTRY_GATE_PLUS_POST_SIGNAL_ANTI_CHASE_LIMIT\";\n\n  if (\n    !robustnessPositive\n  ) {\n    fail(\n      \"ENTRY_V3_ROBUSTNESS_GATE_FAILED\",\n    );\n  }\n\n  if (\n    structuralDirection !==\n    expectedDirection\n  ) {\n    fail(\n      `UNEXPECTED_ENTRY_V3_STRUCTURAL_DIRECTION_${structuralDirection}`,\n    );\n  }\n\n  const observedLeader =\n    numberOrNull(\n      analysis\n        ?.decision\n        ?.bestObservedPremiumCap,\n    );\n\n  const frozenPolicyEvidence =\n    FROZEN_PREMIUM_CAPS.map(\n      (cap) => {\n        const policy =\n          policyByCap(\n            analysis,\n            cap,\n          );\n\n        return {\n          maxPremium:\n            cap,\n\n          fillRate:\n            numberOrNull(\n              policy\n                ?.fillRate,\n            ),\n\n          compositeScore:\n            numberOrNull(\n              policy\n                ?.compositeScore,\n            ),\n\n          pairedVsDirectMean: {\n            r1:\n              numberOrNull(\n                policy\n                  ?.pairedVsDirect\n                  ?.r1\n                  ?.mean,\n              ),\n\n            r3:\n              numberOrNull(\n                policy\n                  ?.pairedVsDirect\n                  ?.r3\n                  ?.mean,\n              ),\n\n            r5:\n              numberOrNull(\n                policy\n                  ?.pairedVsDirect\n                  ?.r5\n                  ?.mean,\n              ),\n          },\n        };\n      },\n    );\n\n  const result = {\n    status:\n      \"ALPHA_V3_ENTRY_V3_STRUCTURE_LOCK_COMPLETE\",\n\n    version:\n      VERSION,\n\n    counts: {\n      analyzedSessions:\n        totalSessions,\n\n      correctedQualifiedSessions,\n    },\n\n    structureDecision: {\n      structureLocked:\n        true,\n\n      alphaCandidateLayerChanged:\n        false,\n\n      entrySignalGate:\n        \"CORRECTED_ENTRY_GATE\",\n\n      executionLayer:\n        \"POST_SIGNAL_ANTI_CHASE_LIMIT\",\n\n      directCorrectedEntry:\n        \"CONTROL_BASELINE\",\n\n      exactProductionPremiumCapLocked:\n        false,\n\n      productionCapSelection:\n        \"DEFER_TO_PREDECLARED_CHRONOLOGICAL_VALIDATION\",\n\n      observedSameSampleLeader:\n        observedLeader,\n\n      rationale:\n        \"251-session analysis supports the Entry V3 architecture, while the exact premium cap remains intentionally unlocked to reduce same-sample overfitting.\",\n    },\n\n    frozenValidationContract: {\n      baseline:\n        \"DIRECT_CORRECTED_ENTRY\",\n\n      premiumCaps:\n        FROZEN_PREMIUM_CAPS,\n\n      addNewPremiumCapsBeforeValidation:\n        false,\n\n      retuneEntryScoreThreshold:\n        false,\n\n      entryScoreThreshold:\n        0.66,\n\n      chronologicalEvaluation:\n        true,\n\n      compareSameSessions:\n        true,\n\n      requiredHorizons: [\n        \"r1\",\n        \"r3\",\n        \"r5\",\n      ],\n\n      requiredMetrics: [\n        \"fillRate\",\n        \"mean\",\n        \"median\",\n        \"positiveRate\",\n        \"pairedVsDirect\",\n        \"timeStability\",\n      ],\n\n      selectionPrinciple:\n        \"Prefer a cap that preserves fill availability while retaining positive paired improvement and temporal stability; do not select on a single return metric.\",\n    },\n\n    frozenPolicyEvidence,\n\n    robustness: {\n      pairedImprovementPositiveAcrossBothHalves:\n        robustnessPositive,\n\n      firstHalfSessionCount:\n        Number(\n          analysis\n            ?.robustness\n            ?.firstHalfSessionCount ??\n            0,\n        ),\n\n      secondHalfSessionCount:\n        Number(\n          analysis\n            ?.robustness\n            ?.secondHalfSessionCount ??\n            0,\n        ),\n    },\n\n    safety: {\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      kisRequests:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionChanged:\n        false,\n\n      thresholdChanged:\n        false,\n    },\n\n    nextGate:\n      \"BUILD_ENTRY_V3_CHRONOLOGICAL_CAP_VALIDATION\",\n\n    outputFile:\n      \"logs/alpha-v3-entry-v3-structure-decision.json\",\n  };\n\n  fs.mkdirSync(\n    path.dirname(\n      OUTPUT_FILE,\n    ),\n    {\n      recursive: true,\n    },\n  );\n\n  fs.writeFileSync(\n    OUTPUT_FILE,\n    JSON.stringify(\n      result,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      result,\n      null,\n      2,\n    ),\n  );\n}\n\ntry {\n  main();\n} catch (\n  error\n) {\n  console.error(\n    JSON.stringify(\n      {\n        status:\n          \"ALPHA_V3_ENTRY_V3_STRUCTURE_LOCK_FAILED\",\n\n        version:\n          VERSION,\n\n        message:\n          error instanceof Error\n            ? error.message\n            : String(\n                error,\n              ),\n\n        safety: {\n          databaseReads:\n            0,\n\n          databaseWrites:\n            0,\n\n          kisRequests:\n            0,\n\n          ordersCreated:\n            0,\n\n          positionsChanged:\n            0,\n\n          productionChanged:\n            false,\n        },\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exit(\n    1,\n  );\n}\n";

fs.mkdirSync(
  path.dirname(TARGET),
  {
    recursive: true
  }
);

fs.writeFileSync(
  TARGET,
  SOURCE,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_LOCK_ENTRY_V3_STRUCTURE_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-lock-entry-v3-structure.ts",

      productionChanged:
        false,

      thresholdChanged:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      nextAction:
        "RUN_ALPHA_V3_LOCK_ENTRY_V3_STRUCTURE"
    },
    null,
    2
  )
);
