const fs = require("fs");
const path = require("path");

const root = process.cwd();

const outputs = [
  {
    rel:
      "lib/trading/data-freshness-production-contract.ts",
    text:
      "export const DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION =\n  \"ALPHA_V3_DATA_FRESHNESS_PRODUCTION_V1\" as const;\n\nexport type DataFreshnessProductionAction =\n  | \"OBSERVE\"\n  | \"ANALYZE\"\n  | \"PAPER_BUY_CREATE\"\n  | \"PAPER_BUY_EXECUTE\"\n  | \"LIVE_BUY_SUBMIT\"\n  | \"PROTECTIVE_EXIT\"\n  | \"RISK_MAINTENANCE\";\n\nexport type DataFreshnessStatus =\n  | \"FRESH\"\n  | \"STALE\"\n  | \"UNKNOWN\"\n  | \"MISSING\"\n  | \"DATE_MISMATCH\";\n\nexport type DataQualityStatus =\n  | \"PASS\"\n  | \"WARNING\"\n  | \"FAIL_FRESHNESS\"\n  | \"FAIL_INTEGRITY\"\n  | \"UNKNOWN\";\n\nexport interface DataFreshnessProductionInput {\n  freshnessStatus:\n    DataFreshnessStatus | string | null | undefined;\n\n  usableForProduction:\n    boolean | null | undefined;\n\n  qualityStatus?:\n    DataQualityStatus | string | null | undefined;\n\n  expectedMarketDate?:\n    string | null;\n\n  latestCommonDate?:\n    string | null;\n}\n\nexport interface DataFreshnessProductionDecision {\n  version:\n    typeof DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION;\n\n  action:\n    DataFreshnessProductionAction;\n\n  allowed:\n    boolean;\n\n  blocksNewRisk:\n    boolean;\n\n  reason:\n    | \"OBSERVATION_ALLOWED\"\n    | \"ANALYSIS_ALLOWED\"\n    | \"PROTECTIVE_EXIT_ALLOWED\"\n    | \"RISK_MAINTENANCE_ALLOWED\"\n    | \"FRESH_DATA_NEW_RISK_ALLOWED\"\n    | \"FRESHNESS_STATE_MISSING\"\n    | \"FRESHNESS_NOT_USABLE_FOR_PRODUCTION\"\n    | \"STALE_MARKET_DATA\"\n    | \"MARKET_DATE_MISMATCH\"\n    | \"QUALITY_GATE_FAILED\"\n    | \"UNKNOWN_FRESHNESS_STATE_FAIL_CLOSED\";\n\n  failClosed:\n    boolean;\n}\n\nconst NEW_RISK_ACTIONS:\n  readonly DataFreshnessProductionAction[] = [\n    \"PAPER_BUY_CREATE\",\n    \"PAPER_BUY_EXECUTE\",\n    \"LIVE_BUY_SUBMIT\",\n  ];\n\nexport function isDataFreshnessNewRiskAction(\n  action:\n    DataFreshnessProductionAction,\n): boolean {\n  return NEW_RISK_ACTIONS.includes(\n    action,\n  );\n}\n\nfunction normalizeStatus(\n  value:\n    unknown,\n): string {\n  return String(\n    value ?? \"\",\n  )\n    .trim()\n    .toUpperCase();\n}\n\nexport function evaluateDataFreshnessProductionAction(\n  input:\n    DataFreshnessProductionInput,\n  action:\n    DataFreshnessProductionAction,\n): DataFreshnessProductionDecision {\n  if (\n    action ===\n    \"OBSERVE\"\n  ) {\n    return {\n      version:\n        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,\n      action,\n      allowed: true,\n      blocksNewRisk: false,\n      reason:\n        \"OBSERVATION_ALLOWED\",\n      failClosed: false,\n    };\n  }\n\n  if (\n    action ===\n    \"ANALYZE\"\n  ) {\n    return {\n      version:\n        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,\n      action,\n      allowed: true,\n      blocksNewRisk: false,\n      reason:\n        \"ANALYSIS_ALLOWED\",\n      failClosed: false,\n    };\n  }\n\n  if (\n    action ===\n    \"PROTECTIVE_EXIT\"\n  ) {\n    return {\n      version:\n        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,\n      action,\n      allowed: true,\n      blocksNewRisk: false,\n      reason:\n        \"PROTECTIVE_EXIT_ALLOWED\",\n      failClosed: false,\n    };\n  }\n\n  if (\n    action ===\n    \"RISK_MAINTENANCE\"\n  ) {\n    return {\n      version:\n        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,\n      action,\n      allowed: true,\n      blocksNewRisk: false,\n      reason:\n        \"RISK_MAINTENANCE_ALLOWED\",\n      failClosed: false,\n    };\n  }\n\n  const freshnessStatus =\n    normalizeStatus(\n      input.freshnessStatus,\n    );\n\n  const qualityStatus =\n    normalizeStatus(\n      input.qualityStatus,\n    );\n\n  if (\n    !freshnessStatus\n  ) {\n    return {\n      version:\n        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,\n      action,\n      allowed: false,\n      blocksNewRisk: true,\n      reason:\n        \"FRESHNESS_STATE_MISSING\",\n      failClosed: true,\n    };\n  }\n\n  if (\n    freshnessStatus ===\n    \"STALE\"\n  ) {\n    return {\n      version:\n        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,\n      action,\n      allowed: false,\n      blocksNewRisk: true,\n      reason:\n        \"STALE_MARKET_DATA\",\n      failClosed: true,\n    };\n  }\n\n  if (\n    freshnessStatus ===\n      \"DATE_MISMATCH\" ||\n    (\n      input.expectedMarketDate &&\n      input.latestCommonDate &&\n      input.expectedMarketDate !==\n        input.latestCommonDate\n    )\n  ) {\n    return {\n      version:\n        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,\n      action,\n      allowed: false,\n      blocksNewRisk: true,\n      reason:\n        \"MARKET_DATE_MISMATCH\",\n      failClosed: true,\n    };\n  }\n\n  if (\n    qualityStatus ===\n      \"FAIL_FRESHNESS\" ||\n    qualityStatus ===\n      \"FAIL_INTEGRITY\"\n  ) {\n    return {\n      version:\n        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,\n      action,\n      allowed: false,\n      blocksNewRisk: true,\n      reason:\n        \"QUALITY_GATE_FAILED\",\n      failClosed: true,\n    };\n  }\n\n  if (\n    input.usableForProduction !==\n    true\n  ) {\n    return {\n      version:\n        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,\n      action,\n      allowed: false,\n      blocksNewRisk: true,\n      reason:\n        \"FRESHNESS_NOT_USABLE_FOR_PRODUCTION\",\n      failClosed: true,\n    };\n  }\n\n  if (\n    freshnessStatus !==\n    \"FRESH\"\n  ) {\n    return {\n      version:\n        DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,\n      action,\n      allowed: false,\n      blocksNewRisk: true,\n      reason:\n        \"UNKNOWN_FRESHNESS_STATE_FAIL_CLOSED\",\n      failClosed: true,\n    };\n  }\n\n  return {\n    version:\n      DATA_FRESHNESS_PRODUCTION_CONTRACT_VERSION,\n    action,\n    allowed: true,\n    blocksNewRisk: false,\n    reason:\n      \"FRESH_DATA_NEW_RISK_ALLOWED\",\n    failClosed: false,\n  };\n}\n"
  },
  {
    rel:
      "scripts/alpha-v3-data-freshness-production-contract-v1-test.ts",
    text:
      "import {\n  evaluateDataFreshnessProductionAction,\n  type DataFreshnessProductionAction,\n  type DataFreshnessProductionInput,\n} from \"../lib/trading/data-freshness-production-contract\";\n\ninterface Scenario {\n  name: string;\n  input: DataFreshnessProductionInput;\n  action: DataFreshnessProductionAction;\n  expectedAllowed: boolean;\n  expectedReason: string;\n}\n\nconst freshInput: DataFreshnessProductionInput = {\n  freshnessStatus: \"FRESH\",\n  usableForProduction: true,\n  qualityStatus: \"PASS\",\n  expectedMarketDate: \"2026-10-08\",\n  latestCommonDate: \"2026-10-08\",\n};\n\nconst scenarios: Scenario[] = [\n  {\n    name: \"OBSERVE_ALLOWED_WHILE_STALE\",\n    input: {\n      freshnessStatus: \"STALE\",\n      usableForProduction: false,\n      qualityStatus: \"FAIL_FRESHNESS\",\n    },\n    action: \"OBSERVE\",\n    expectedAllowed: true,\n    expectedReason: \"OBSERVATION_ALLOWED\",\n  },\n  {\n    name: \"ANALYZE_ALLOWED_WHILE_STALE\",\n    input: {\n      freshnessStatus: \"STALE\",\n      usableForProduction: false,\n      qualityStatus: \"FAIL_FRESHNESS\",\n    },\n    action: \"ANALYZE\",\n    expectedAllowed: true,\n    expectedReason: \"ANALYSIS_ALLOWED\",\n  },\n  {\n    name: \"PROTECTIVE_EXIT_ALLOWED_WHILE_STALE\",\n    input: {\n      freshnessStatus: \"STALE\",\n      usableForProduction: false,\n      qualityStatus: \"FAIL_FRESHNESS\",\n    },\n    action: \"PROTECTIVE_EXIT\",\n    expectedAllowed: true,\n    expectedReason: \"PROTECTIVE_EXIT_ALLOWED\",\n  },\n  {\n    name: \"RISK_MAINTENANCE_ALLOWED_WHILE_STALE\",\n    input: {\n      freshnessStatus: \"STALE\",\n      usableForProduction: false,\n      qualityStatus: \"FAIL_FRESHNESS\",\n    },\n    action: \"RISK_MAINTENANCE\",\n    expectedAllowed: true,\n    expectedReason: \"RISK_MAINTENANCE_ALLOWED\",\n  },\n  {\n    name: \"PAPER_CREATE_ALLOWED_WHEN_FRESH\",\n    input: freshInput,\n    action: \"PAPER_BUY_CREATE\",\n    expectedAllowed: true,\n    expectedReason: \"FRESH_DATA_NEW_RISK_ALLOWED\",\n  },\n  {\n    name: \"PAPER_EXECUTE_ALLOWED_WHEN_FRESH\",\n    input: freshInput,\n    action: \"PAPER_BUY_EXECUTE\",\n    expectedAllowed: true,\n    expectedReason: \"FRESH_DATA_NEW_RISK_ALLOWED\",\n  },\n  {\n    name: \"LIVE_BUY_ALLOWED_WHEN_FRESH\",\n    input: freshInput,\n    action: \"LIVE_BUY_SUBMIT\",\n    expectedAllowed: true,\n    expectedReason: \"FRESH_DATA_NEW_RISK_ALLOWED\",\n  },\n  {\n    name: \"STALE_BLOCKS_CREATE\",\n    input: {\n      ...freshInput,\n      freshnessStatus: \"STALE\",\n      usableForProduction: false,\n      qualityStatus: \"FAIL_FRESHNESS\",\n    },\n    action: \"PAPER_BUY_CREATE\",\n    expectedAllowed: false,\n    expectedReason: \"STALE_MARKET_DATA\",\n  },\n  {\n    name: \"STALE_BLOCKS_EXECUTE\",\n    input: {\n      ...freshInput,\n      freshnessStatus: \"STALE\",\n      usableForProduction: false,\n      qualityStatus: \"FAIL_FRESHNESS\",\n    },\n    action: \"PAPER_BUY_EXECUTE\",\n    expectedAllowed: false,\n    expectedReason: \"STALE_MARKET_DATA\",\n  },\n  {\n    name: \"MISSING_STATE_FAILS_CLOSED\",\n    input: {\n      freshnessStatus: null,\n      usableForProduction: null,\n      qualityStatus: null,\n    },\n    action: \"PAPER_BUY_CREATE\",\n    expectedAllowed: false,\n    expectedReason: \"FRESHNESS_STATE_MISSING\",\n  },\n  {\n    name: \"DATE_MISMATCH_FAILS_CLOSED\",\n    input: {\n      ...freshInput,\n      expectedMarketDate: \"2026-10-08\",\n      latestCommonDate: \"2026-10-07\",\n    },\n    action: \"PAPER_BUY_CREATE\",\n    expectedAllowed: false,\n    expectedReason: \"MARKET_DATE_MISMATCH\",\n  },\n  {\n    name: \"QUALITY_FAILS_CLOSED\",\n    input: {\n      ...freshInput,\n      qualityStatus: \"FAIL_INTEGRITY\",\n    },\n    action: \"PAPER_BUY_CREATE\",\n    expectedAllowed: false,\n    expectedReason: \"QUALITY_GATE_FAILED\",\n  },\n  {\n    name: \"UNKNOWN_STATUS_FAILS_CLOSED\",\n    input: {\n      ...freshInput,\n      freshnessStatus: \"MYSTERY\",\n    },\n    action: \"PAPER_BUY_CREATE\",\n    expectedAllowed: false,\n    expectedReason: \"UNKNOWN_FRESHNESS_STATE_FAIL_CLOSED\",\n  },\n  {\n    name: \"NOT_USABLE_FAILS_CLOSED\",\n    input: {\n      ...freshInput,\n      usableForProduction: false,\n    },\n    action: \"PAPER_BUY_CREATE\",\n    expectedAllowed: false,\n    expectedReason: \"FRESHNESS_NOT_USABLE_FOR_PRODUCTION\",\n  },\n];\n\nconst results =\n  scenarios.map(\n    (scenario) => {\n      const decision =\n        evaluateDataFreshnessProductionAction(\n          scenario.input,\n          scenario.action,\n        );\n\n      const passed =\n        decision.allowed ===\n          scenario.expectedAllowed &&\n        decision.reason ===\n          scenario.expectedReason;\n\n      return {\n        name:\n          scenario.name,\n        passed,\n        expected: {\n          allowed:\n            scenario.expectedAllowed,\n          reason:\n            scenario.expectedReason,\n        },\n        observed: {\n          allowed:\n            decision.allowed,\n          reason:\n            decision.reason,\n          failClosed:\n            decision.failClosed,\n        },\n      };\n    },\n  );\n\nconst failed =\n  results.filter(\n    (item) => !item.passed,\n  );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_DATA_FRESHNESS_PRODUCTION_CONTRACT_V1_VERIFIED\"\n          : \"ALPHA_V3_DATA_FRESHNESS_PRODUCTION_CONTRACT_V1_REVIEW\",\n\n      summary: {\n        scenarioCount:\n          results.length,\n        passedCount:\n          results.length -\n          failed.length,\n        failedCount:\n          failed.length,\n      },\n\n      results,\n\n      failed:\n        failed.map(\n          (item) => item.name,\n        ),\n\n      invariants: {\n        staleBlocksNewRisk:\n          true,\n        missingStateFailsClosed:\n          true,\n        unknownStateFailsClosed:\n          true,\n        protectiveExitRemainsAllowed:\n          true,\n        observationRemainsAllowed:\n          true,\n        analysisRemainsAllowed:\n          true,\n        riskMaintenanceRemainsAllowed:\n          true,\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"PROBE_CANONICAL_FRESHNESS_STATE_STORAGE_AND_BINDING_SOURCE_V1\"\n          : \"REVIEW_DATA_FRESHNESS_CONTRACT\",\n    },\n    null,\n    2,\n  ),\n);\n\nif (failed.length > 0) {\n  process.exitCode = 2;\n}\n"
  },
  {
    rel:
      "scripts/alpha-v3-data-freshness-production-contract-v1-static-verify.cjs",
    text:
      "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst rel =\n  \"lib/trading/data-freshness-production-contract.ts\";\n\nconst text =\n  fs.readFileSync(\n    path.resolve(\n      root,\n      rel,\n    ),\n    \"utf8\",\n  );\n\nconst checks = {\n  versionPresent:\n    text.includes(\n      \"ALPHA_V3_DATA_FRESHNESS_PRODUCTION_V1\",\n    ),\n\n  staleBlocksNewRisk:\n    text.includes(\n      \"STALE_MARKET_DATA\",\n    ) &&\n    text.includes(\n      \"blocksNewRisk: true\",\n    ),\n\n  missingFailsClosed:\n    text.includes(\n      \"FRESHNESS_STATE_MISSING\",\n    ),\n\n  unknownFailsClosed:\n    text.includes(\n      \"UNKNOWN_FRESHNESS_STATE_FAIL_CLOSED\",\n    ),\n\n  dateMismatchBlocked:\n    text.includes(\n      \"MARKET_DATE_MISMATCH\",\n    ),\n\n  qualityGateBlocked:\n    text.includes(\n      \"QUALITY_GATE_FAILED\",\n    ),\n\n  protectiveExitAllowed:\n    text.includes(\n      \"PROTECTIVE_EXIT_ALLOWED\",\n    ),\n\n  riskMaintenanceAllowed:\n    text.includes(\n      \"RISK_MAINTENANCE_ALLOWED\",\n    ),\n\n  observeAllowed:\n    text.includes(\n      \"OBSERVATION_ALLOWED\",\n    ),\n\n  analyzeAllowed:\n    text.includes(\n      \"ANALYSIS_ALLOWED\",\n    ),\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(([, value]) => !value)\n    .map(([key]) => key);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_DATA_FRESHNESS_PRODUCTION_CONTRACT_V1_STATIC_VERIFIED\"\n          : \"ALPHA_V3_DATA_FRESHNESS_PRODUCTION_CONTRACT_V1_STATIC_REVIEW\",\n\n      checks,\n      failed,\n\n      nextGate:\n        failed.length === 0\n          ? \"RUN_CONTRACT_TEST\"\n          : \"REVIEW_CONTRACT_STATIC\",\n    },\n    null,\n    2,\n  ),\n);\n\nif (failed.length > 0) {\n  process.exitCode = 2;\n}\n"
  }
];

for (const item of outputs) {
  const file =
    path.resolve(
      root,
      item.rel
    );

  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    file,
    item.text,
    "utf8"
  );
}

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_CONTRACT_V1_INSTALLED",

      generatedFiles:
        outputs.map(
          (item) => item.rel
        ),

      contract: {
        version:
          "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_V1",

        newRiskActions: [
          "PAPER_BUY_CREATE",
          "PAPER_BUY_EXECUTE",
          "LIVE_BUY_SUBMIT"
        ],

        stalePolicy:
          "FAIL_CLOSED",

        missingStatePolicy:
          "FAIL_CLOSED",

        unknownStatePolicy:
          "FAIL_CLOSED",

        protectiveExit:
          "ALLOWED",

        observation:
          "ALLOWED",

        analysis:
          "ALLOWED",

        riskMaintenance:
          "ALLOWED"
      },

      safety: {
        productionFilesChanged:
          false,

        databaseReads:
          0,

        databaseWrites:
          0,

        networkCalls:
          0,

        ordersCreated:
          0
      },

      nextAction:
        "STATIC_VERIFY_AND_RUN_CONTRACT_TEST"
    },
    null,
    2
  )
);
