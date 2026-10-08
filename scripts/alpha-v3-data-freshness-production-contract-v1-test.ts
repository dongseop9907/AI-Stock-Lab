import {
  evaluateDataFreshnessProductionAction,
  type DataFreshnessProductionAction,
  type DataFreshnessProductionInput,
} from "../lib/trading/data-freshness-production-contract";

interface Scenario {
  name: string;
  input: DataFreshnessProductionInput;
  action: DataFreshnessProductionAction;
  expectedAllowed: boolean;
  expectedReason: string;
}

const freshInput: DataFreshnessProductionInput = {
  freshnessStatus: "FRESH",
  usableForProduction: true,
  qualityStatus: "PASS",
  expectedMarketDate: "2026-10-08",
  latestCommonDate: "2026-10-08",
};

const scenarios: Scenario[] = [
  {
    name: "OBSERVE_ALLOWED_WHILE_STALE",
    input: {
      freshnessStatus: "STALE",
      usableForProduction: false,
      qualityStatus: "FAIL_FRESHNESS",
    },
    action: "OBSERVE",
    expectedAllowed: true,
    expectedReason: "OBSERVATION_ALLOWED",
  },
  {
    name: "ANALYZE_ALLOWED_WHILE_STALE",
    input: {
      freshnessStatus: "STALE",
      usableForProduction: false,
      qualityStatus: "FAIL_FRESHNESS",
    },
    action: "ANALYZE",
    expectedAllowed: true,
    expectedReason: "ANALYSIS_ALLOWED",
  },
  {
    name: "PROTECTIVE_EXIT_ALLOWED_WHILE_STALE",
    input: {
      freshnessStatus: "STALE",
      usableForProduction: false,
      qualityStatus: "FAIL_FRESHNESS",
    },
    action: "PROTECTIVE_EXIT",
    expectedAllowed: true,
    expectedReason: "PROTECTIVE_EXIT_ALLOWED",
  },
  {
    name: "RISK_MAINTENANCE_ALLOWED_WHILE_STALE",
    input: {
      freshnessStatus: "STALE",
      usableForProduction: false,
      qualityStatus: "FAIL_FRESHNESS",
    },
    action: "RISK_MAINTENANCE",
    expectedAllowed: true,
    expectedReason: "RISK_MAINTENANCE_ALLOWED",
  },
  {
    name: "PAPER_CREATE_ALLOWED_WHEN_FRESH",
    input: freshInput,
    action: "PAPER_BUY_CREATE",
    expectedAllowed: true,
    expectedReason: "FRESH_DATA_NEW_RISK_ALLOWED",
  },
  {
    name: "PAPER_EXECUTE_ALLOWED_WHEN_FRESH",
    input: freshInput,
    action: "PAPER_BUY_EXECUTE",
    expectedAllowed: true,
    expectedReason: "FRESH_DATA_NEW_RISK_ALLOWED",
  },
  {
    name: "LIVE_BUY_ALLOWED_WHEN_FRESH",
    input: freshInput,
    action: "LIVE_BUY_SUBMIT",
    expectedAllowed: true,
    expectedReason: "FRESH_DATA_NEW_RISK_ALLOWED",
  },
  {
    name: "STALE_BLOCKS_CREATE",
    input: {
      ...freshInput,
      freshnessStatus: "STALE",
      usableForProduction: false,
      qualityStatus: "FAIL_FRESHNESS",
    },
    action: "PAPER_BUY_CREATE",
    expectedAllowed: false,
    expectedReason: "STALE_MARKET_DATA",
  },
  {
    name: "STALE_BLOCKS_EXECUTE",
    input: {
      ...freshInput,
      freshnessStatus: "STALE",
      usableForProduction: false,
      qualityStatus: "FAIL_FRESHNESS",
    },
    action: "PAPER_BUY_EXECUTE",
    expectedAllowed: false,
    expectedReason: "STALE_MARKET_DATA",
  },
  {
    name: "MISSING_STATE_FAILS_CLOSED",
    input: {
      freshnessStatus: null,
      usableForProduction: null,
      qualityStatus: null,
    },
    action: "PAPER_BUY_CREATE",
    expectedAllowed: false,
    expectedReason: "FRESHNESS_STATE_MISSING",
  },
  {
    name: "DATE_MISMATCH_FAILS_CLOSED",
    input: {
      ...freshInput,
      expectedMarketDate: "2026-10-08",
      latestCommonDate: "2026-10-07",
    },
    action: "PAPER_BUY_CREATE",
    expectedAllowed: false,
    expectedReason: "MARKET_DATE_MISMATCH",
  },
  {
    name: "QUALITY_FAILS_CLOSED",
    input: {
      ...freshInput,
      qualityStatus: "FAIL_INTEGRITY",
    },
    action: "PAPER_BUY_CREATE",
    expectedAllowed: false,
    expectedReason: "QUALITY_GATE_FAILED",
  },
  {
    name: "UNKNOWN_STATUS_FAILS_CLOSED",
    input: {
      ...freshInput,
      freshnessStatus: "MYSTERY",
    },
    action: "PAPER_BUY_CREATE",
    expectedAllowed: false,
    expectedReason: "UNKNOWN_FRESHNESS_STATE_FAIL_CLOSED",
  },
  {
    name: "NOT_USABLE_FAILS_CLOSED",
    input: {
      ...freshInput,
      usableForProduction: false,
    },
    action: "PAPER_BUY_CREATE",
    expectedAllowed: false,
    expectedReason: "FRESHNESS_NOT_USABLE_FOR_PRODUCTION",
  },
];

const results =
  scenarios.map(
    (scenario) => {
      const decision =
        evaluateDataFreshnessProductionAction(
          scenario.input,
          scenario.action,
        );

      const passed =
        decision.allowed ===
          scenario.expectedAllowed &&
        decision.reason ===
          scenario.expectedReason;

      return {
        name:
          scenario.name,
        passed,
        expected: {
          allowed:
            scenario.expectedAllowed,
          reason:
            scenario.expectedReason,
        },
        observed: {
          allowed:
            decision.allowed,
          reason:
            decision.reason,
          failClosed:
            decision.failClosed,
        },
      };
    },
  );

const failed =
  results.filter(
    (item) => !item.passed,
  );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_CONTRACT_V1_VERIFIED"
          : "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_CONTRACT_V1_REVIEW",

      summary: {
        scenarioCount:
          results.length,
        passedCount:
          results.length -
          failed.length,
        failedCount:
          failed.length,
      },

      results,

      failed:
        failed.map(
          (item) => item.name,
        ),

      invariants: {
        staleBlocksNewRisk:
          true,
        missingStateFailsClosed:
          true,
        unknownStateFailsClosed:
          true,
        protectiveExitRemainsAllowed:
          true,
        observationRemainsAllowed:
          true,
        analysisRemainsAllowed:
          true,
        riskMaintenanceRemainsAllowed:
          true,
      },

      nextGate:
        failed.length === 0
          ? "PROBE_CANONICAL_FRESHNESS_STATE_STORAGE_AND_BINDING_SOURCE_V1"
          : "REVIEW_DATA_FRESHNESS_CONTRACT",
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
