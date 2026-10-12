import fs from "node:fs";
import path from "node:path";

import {
  auditEvaluatorEvidenceConsistencyV1,
} from "./true-forward-oos-evaluator-evidence-consistency-gate-v1";

const ROOT =
  process.cwd();

export const EVALUATOR_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
  );

export const SUMMARY_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-true-forward-oos-summary.json",
  );

export interface ManualReviewEvidenceInput {
  observationsDocument?: any;
  evaluatorReport?: any;
  summaryReport?: any;
}

function readJsonIfExists(
  file: string,
) {
  if (
    !fs.existsSync(file)
  ) {
    return {
      exists: false,
      value: null,
    };
  }

  try {
    return {
      exists: true,
      value: JSON.parse(
        fs.readFileSync(
          file,
          "utf8",
        ),
      ),
    };
  } catch (error) {
    return {
      exists: true,
      value: null,
      parseError:
        String(
          error instanceof Error
            ? error.message
            : error,
        ),
    };
  }
}

function injectedOrDisk(
  input: ManualReviewEvidenceInput,
  key:
    | "evaluatorReport"
    | "summaryReport",
  file: string,
) {
  const injected =
    Object.prototype.hasOwnProperty.call(
      input,
      key,
    );

  if (!injected) {
    return readJsonIfExists(
      file,
    );
  }

  const value =
    input[key];

  if (value === undefined) {
    return {
      exists: false,
      value: null,
      injected: true,
    };
  }

  return {
    exists: true,
    value,
    injected: true,
  };
}

export function auditManualForwardOosReviewEvidenceGateV1(
  input:
    ManualReviewEvidenceInput = {},
) {
  const consistency =
    auditEvaluatorEvidenceConsistencyV1({
      ...(Object.prototype.hasOwnProperty.call(
        input,
        "observationsDocument",
      )
        ? {
            observationsDocument:
              input.observationsDocument,
          }
        : {}),

      ...(Object.prototype.hasOwnProperty.call(
        input,
        "evaluatorReport",
      )
        ? {
            evaluatorReport:
              input.evaluatorReport,
          }
        : {}),

      ...(Object.prototype.hasOwnProperty.call(
        input,
        "summaryReport",
      )
        ? {
            summaryReport:
              input.summaryReport,
          }
        : {}),
    });

  if (
    consistency.gateStatus ===
      "WAITING_FOR_OBSERVATION_FILE" ||
    consistency.gateStatus ===
      "WAITING_FOR_OBSERVATIONS" ||
    consistency.gateStatus ===
      "WAITING_FOR_EVALUATOR_REPORT"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1",

      gateStatus:
        "WAITING_FOR_FORWARD_OOS_EVIDENCE",

      consistencyStatus:
        consistency.gateStatus,

      reviewReady:
        false,

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING",
    };
  }

  if (
    consistency.gateStatus !==
    "EVALUATOR_EVIDENCE_CONSISTENT"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1",

      gateStatus:
        "BLOCKED_EVIDENCE_INCONSISTENT",

      consistencyStatus:
        consistency.gateStatus,

      reviewReady:
        false,

      failed: [
        "EVALUATOR_EVIDENCE_NOT_CONSISTENT",
      ],

      safety:
        safety(),

      nextGate:
        "REPAIR_FORWARD_OOS_EVIDENCE_BEFORE_REVIEW",
    };
  }

  const evaluatorRead =
    injectedOrDisk(
      input,
      "evaluatorReport",
      EVALUATOR_FILE,
    );

  const summaryRead =
    injectedOrDisk(
      input,
      "summaryReport",
      SUMMARY_FILE,
    );

  if (
    !evaluatorRead.exists
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1",

      gateStatus:
        "WAITING_FOR_EVALUATOR_REPORT",

      reviewReady:
        false,

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING",
    };
  }

  if (
    evaluatorRead.value ===
    null
  ) {
    return blocked(
      "EVALUATOR_REPORT_INVALID",
    );
  }

  const evaluator =
    evaluatorRead.value;

  const payload =
    evaluator?.evaluation ??
    evaluator?.result ??
    evaluator?.metrics ??
    evaluator;

  const forwardOosGatePassed =
    payload
      ?.decision
      ?.forwardOosGatePassed;

  const nextUse =
    payload
      ?.decision
      ?.nextUse;

  if (
    forwardOosGatePassed !==
    true
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1",

      gateStatus:
        "NOT_READY_FOR_MANUAL_REVIEW",

      reviewReady:
        false,

      evidence: {
        forwardOosGatePassed:
          forwardOosGatePassed ??
          null,

        nextUse:
          nextUse ??
          null,
      },

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING",
    };
  }

  const checks = {
    evaluatorGatePassed:
      forwardOosGatePassed ===
      true,

    evaluatorNextUseReview:
      nextUse ===
      "READY_FOR_MANUAL_FORWARD_OOS_REVIEW",

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

    summaryPresent:
      summaryRead.exists ===
      true,

    summaryValid:
      summaryRead.value !==
      null,

    summaryCutoffConsistent:
      summaryRead.value
        ?.contract
        ?.historicalTargetCutoff ===
      "2026-10-07",

    summaryCapConsistent:
      summaryRead.value
        ?.contract
        ?.selectedCap ===
      0.01,

    summaryThresholdConsistent:
      summaryRead.value
        ?.contract
        ?.entryScoreThreshold ===
      0.66,

    summaryEvidenceGatePassed:
      summaryRead.value
        ?.decision
        ?.enoughEvidenceForFinalEntryGate ===
      true,

    productionPolicyStillUnlocked:
      summaryRead.value
        ?.decision
        ?.productionPolicyLocked ===
      false,

    noSummaryProductionWrites:
      summaryRead.value
        ?.safety
        ?.databaseWrites ===
        0,

    noSummaryOrders:
      summaryRead.value
        ?.safety
        ?.ordersCreated ===
        0,

    noSummaryPositionMutation:
      summaryRead.value
        ?.safety
        ?.positionsChanged ===
        0,
  };

  const failed =
    Object.entries(
      checks,
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
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1",

    gateStatus:
      failed.length ===
      0
        ? "READY_FOR_MANUAL_FORWARD_OOS_REVIEW"
        : "BLOCKED_MANUAL_REVIEW_EVIDENCE_INCOMPLETE",

    reviewReady:
      failed.length ===
      0,

    consistencyStatus:
      consistency.gateStatus,

    evidence: {
      evaluatorDecision: {
        forwardOosGatePassed,
        nextUse,
      },

      summaryDecision: {
        enoughEvidenceForFinalEntryGate:
          summaryRead.value
            ?.decision
            ?.enoughEvidenceForFinalEntryGate ??
          null,

        productionPolicyLocked:
          summaryRead.value
            ?.decision
            ?.productionPolicyLocked ??
          null,
      },
    },

    checks,
    failed,

    safety:
      safety(),

    nextGate:
      failed.length ===
      0
        ? "MANUAL_REVIEW_ONLY_DO_NOT_PROMOTE_AUTOMATICALLY"
        : "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING",
  };
}

function blocked(
  reason: string,
) {
  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1",

    gateStatus:
      "BLOCKED_MANUAL_REVIEW_EVIDENCE_INCOMPLETE",

    reviewReady:
      false,

    failed: [
      reason,
    ],

    safety:
      safety(),

    nextGate:
      "REPAIR_FORWARD_OOS_EVIDENCE_BEFORE_REVIEW",
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

    promotionExecuted:
      false,

    promotionRecommendedAutomatically:
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
  };
}

async function main() {
  const report =
    auditManualForwardOosReviewEvidenceGateV1();

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    (
      report.gateStatus ===
        "BLOCKED_EVIDENCE_INCONSISTENT" ||
      report.gateStatus ===
        "BLOCKED_MANUAL_REVIEW_EVIDENCE_INCOMPLETE"
    )
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-manual-review-evidence-gate-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1_ERROR",

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
