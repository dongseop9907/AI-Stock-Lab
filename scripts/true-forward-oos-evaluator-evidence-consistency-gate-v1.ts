import fs from "node:fs";
import path from "node:path";

import {
  bindActualForwardObservations,
} from "./true-forward-oos-observation-source-binding-v1";

const ROOT =
  process.cwd();

export const TRUE_FORWARD_OBSERVATION_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-entry-v3-forward-oos-observations.json",
  );

export const TRUE_FORWARD_EVALUATOR_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
  );

export const TRUE_FORWARD_SUMMARY_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-true-forward-oos-summary.json",
  );

export interface EvidenceConsistencyInput {
  observationsDocument?: any;
  evaluatorReport?: any;
  summaryReport?: any;
}

interface ForwardObservationForConsistency {
  correctedEntry?: {
    qualified?: boolean | null;
  } | null;

  selectedPolicy?: {
    filled?: boolean | null;
  } | null;
}

function readJsonIfExists(
  file: string,
) {
  if (
    !fs.existsSync(file)
  ) {
    return {
      exists:
        false,
      value:
        null,
    };
  }

  try {
    return {
      exists:
        true,
      value:
        JSON.parse(
          fs.readFileSync(
            file,
            "utf8",
          ),
        ),
    };
  } catch (error) {
    return {
      exists:
        true,
      value:
        null,
      parseError:
        String(
          error instanceof Error
            ? error.message
            : error,
        ),
    };
  }
}

function readEvidenceSource(
  input: EvidenceConsistencyInput,
  key:
    | "observationsDocument"
    | "evaluatorReport"
    | "summaryReport",
  diskFile: string,
) {
  const injected =
    Object.prototype.hasOwnProperty.call(
      input,
      key,
    );

  if (!injected) {
    return readJsonIfExists(
      diskFile,
    );
  }

  const value =
    input[key];

  if (value === undefined) {
    return {
      exists:
        false,
      value:
        null,
      injected:
        true,
    };
  }

  return {
    exists:
      true,
    value,
    injected:
      true,
  };
}

function finite(
  value: unknown,
): number | null {
  return (
    typeof value ===
      "number" &&
    Number.isFinite(value)
  )
    ? value
    : null;
}

function findEvaluationPayload(
  report: any,
) {
  const candidates = [
    report?.evaluation,
    report?.result,
    report?.metrics,
    report,
  ];

  for (
    const candidate of candidates
  ) {
    if (
      candidate &&
      typeof candidate ===
        "object" &&
      candidate.counts &&
      typeof candidate.counts ===
        "object"
    ) {
      return candidate;
    }
  }

  return null;
}

export function auditEvaluatorEvidenceConsistencyV1(
  input:
    EvidenceConsistencyInput = {},
) {
  const observationRead =
    readEvidenceSource(
      input,
      "observationsDocument",
      TRUE_FORWARD_OBSERVATION_FILE,
    );

  const evaluatorRead =
    readEvidenceSource(
      input,
      "evaluatorReport",
      TRUE_FORWARD_EVALUATOR_FILE,
    );

  const summaryRead =
    readEvidenceSource(
      input,
      "summaryReport",
      TRUE_FORWARD_SUMMARY_FILE,
    );

  const observations:
    ForwardObservationForConsistency[] =
    Array.isArray(
      observationRead.value
        ?.observations,
    )
      ? observationRead.value
          .observations
      : [];

  const canonical =
    bindActualForwardObservations({
      observations,
    });

  if (
    !observationRead.exists
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1",

      gateStatus:
        "WAITING_FOR_OBSERVATION_FILE",

      failed:
        [],

      canonical,

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_REAL_FORWARD_OBSERVATION",
    };
  }

  if (
    observationRead.value ===
    null
  ) {
    return failReport(
      "OBSERVATION_JSON_INVALID",
      canonical,
    );
  }

  if (
    canonical.bindingStatus ===
    "OUTCOME_SOURCE_BINDING_FAILED"
  ) {
    return failReport(
      "CANONICAL_OUTCOME_BINDING_FAILED",
      canonical,
    );
  }

  if (
    observations.length ===
    0
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1",

      gateStatus:
        "WAITING_FOR_OBSERVATIONS",

      failed:
        [],

      canonical,

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_REAL_FORWARD_OBSERVATION",
    };
  }

  if (
    !evaluatorRead.exists
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1",

      gateStatus:
        "WAITING_FOR_EVALUATOR_REPORT",

      failed:
        [],

      observationCounts: {
        observations:
          observations.length,

        qualified:
          observations.filter(
            row =>
              row?.correctedEntry
                ?.qualified ===
              true,
          ).length,

        canonicalOutcomeRows:
          canonical.counts
            .canonicalOutcomeRows,
      },

      safety:
        safety(),

      nextGate:
        "RUN_TRUE_FORWARD_OOS_EVALUATOR",
    };
  }

  if (
    evaluatorRead.value ===
    null
  ) {
    return failReport(
      "EVALUATOR_JSON_INVALID",
      canonical,
    );
  }

  const evaluator =
    evaluatorRead.value;

  const payload =
    findEvaluationPayload(
      evaluator,
    );

  const expectedObservations =
    observations.length;

  const expectedQualified =
    observations.filter(
      row =>
        row?.correctedEntry
          ?.qualified ===
        true,
    ).length;

  const expectedFilled =
    observations.filter(
      row =>
        row?.correctedEntry
          ?.qualified ===
          true &&
        row?.selectedPolicy
          ?.filled ===
          true,
    ).length;

  const actualObservations =
    finite(
      payload
        ?.counts
        ?.observations,
    );

  const actualQualified =
    finite(
      payload
        ?.counts
        ?.qualifiedObservations,
    );

  const actualFilled =
    finite(
      payload
        ?.counts
        ?.filledObservations,
    );

  const checks = {
    evaluatorStatusValid:
      evaluator.status ===
        "ALPHA_V3_TRUE_FORWARD_OOS_EVALUATED" ||
      evaluator.status ===
        "ALPHA_V3_TRUE_FORWARD_OOS_WAITING_FOR_OBSERVATIONS",

    evaluationPayloadFound:
      payload !==
      null,

    evaluatorObservationCountPresent:
      actualObservations !==
      null,

    evaluatorObservationCountMatches:
      actualObservations ===
      expectedObservations,

    evaluatorQualifiedCountPresent:
      actualQualified !==
      null,

    evaluatorQualifiedCountMatches:
      actualQualified ===
      expectedQualified,

    evaluatorFilledCountPresent:
      actualFilled !==
      null,

    evaluatorFilledCountMatches:
      actualFilled ===
      expectedFilled,

    historicalCutoffFrozen:
      evaluator.contract
        ?.historicalCutoff ===
      "2026-10-07",

    selectedCapFrozen:
      evaluator.contract
        ?.selectedCap ===
      0.01,

    entryThresholdFrozen:
      evaluator.contract
        ?.entryScoreThreshold ===
      0.66,

    retuningDisabled:
      evaluator.contract
        ?.retuningAllowed ===
      false,

    evaluatorDecisionPresent:
      typeof payload
        ?.decision
        ?.forwardOosGatePassed ===
      "boolean",

    outputFileCorrect:
      evaluator.outputFile ===
      "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
  };

  const summaryChecks = {
    summaryOptional:
      true,

    summaryContractConsistent:
      !summaryRead.exists ||
      summaryRead.value ===
        null ||
      (
        summaryRead.value
          ?.contract
          ?.historicalTargetCutoff ===
          "2026-10-07" &&
        summaryRead.value
          ?.contract
          ?.selectedCap ===
          0.01 &&
        summaryRead.value
          ?.contract
          ?.entryScoreThreshold ===
          0.66
      ),

    summaryProductionStillUnlocked:
      !summaryRead.exists ||
      summaryRead.value ===
        null ||
      summaryRead.value
        ?.decision
        ?.productionPolicyLocked ===
        false,

    summaryNoProductionMutation:
      !summaryRead.exists ||
      summaryRead.value ===
        null ||
      (
        summaryRead.value
          ?.safety
          ?.databaseWrites ===
          0 &&
        summaryRead.value
          ?.safety
          ?.ordersCreated ===
          0 &&
        summaryRead.value
          ?.safety
          ?.positionsChanged ===
          0
      ),
  };

  const allChecks = {
    ...checks,
    ...summaryChecks,
  };

  const failed =
    Object.entries(
      allChecks,
    )
      .filter(
        ([, value]) =>
          value !==
          true,
      )
      .map(
        ([key]) =>
          key,
      );

  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1",

    gateStatus:
      failed.length ===
      0
        ? "EVALUATOR_EVIDENCE_CONSISTENT"
        : "EVALUATOR_EVIDENCE_INCONSISTENT",

    observationCounts: {
      observations:
        expectedObservations,

      qualified:
        expectedQualified,

      filled:
        expectedFilled,

      canonicalOutcomeRows:
        canonical.counts
          .canonicalOutcomeRows,

      byHorizon:
        canonical.counts
          .byHorizon,
    },

    evaluatorCounts: {
      observations:
        actualObservations,

      qualified:
        actualQualified,

      filled:
        actualFilled,
    },

    checks:
      allChecks,

    evaluatorDecision: {
      enoughSample:
        payload
          ?.decision
          ?.enoughSample ??
        null,

      fillPassed:
        payload
          ?.decision
          ?.fillPassed ??
        null,

      pairedPassed:
        payload
          ?.decision
          ?.pairedPassed ??
        null,

      forwardOosGatePassed:
        payload
          ?.decision
          ?.forwardOosGatePassed ??
        null,

      nextUse:
        payload
          ?.decision
          ?.nextUse ??
        null,
    },

    summary: {
      exists:
        summaryRead.exists,

      treatedAs:
        "OPTIONAL_CONTRACT_LEVEL_CROSS_CHECK_ONLY",
    },

    safety:
      safety(),

    failed,

    nextGate:
      failed.length ===
      0
        ? (
            payload
              ?.decision
              ?.forwardOosGatePassed ===
            true
              ? "BUILD_MANUAL_FORWARD_OOS_REVIEW_EVIDENCE_GATE"
              : "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING"
          )
        : "REPAIR_EVALUATOR_OR_SOURCE_EVIDENCE_BEFORE_ANY_PROMOTION",
  };
}

function failReport(
  reason: string,
  canonical: any,
) {
  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1",

    gateStatus:
      "EVALUATOR_EVIDENCE_INCONSISTENT",

    canonical,

    failed: [
      reason,
    ],

    safety:
      safety(),

    nextGate:
      "REPAIR_EVIDENCE_BEFORE_ANY_PROMOTION",
  };
}

function safety() {
  return {
    readOnly:
      true,

    evaluatorExecuted:
      false,

    summaryExecuted:
      false,

    databaseReads:
      0,

    databaseWrites:
      0,

    fileWrites:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    realTradingEnabled:
      false,

    promotionExecuted:
      false,
  };
}

async function main() {
  const report =
    auditEvaluatorEvidenceConsistencyV1();

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    report.gateStatus ===
      "EVALUATOR_EVIDENCE_INCONSISTENT"
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-evaluator-evidence-consistency-gate-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1_ERROR",

            error:
              String(
                error instanceof Error
                  ? error.stack ??
                    error.message
                  : error
              ),
          },
          null,
          2,
        ),
      );

      process.exitCode = 1;
    },
  );
}
