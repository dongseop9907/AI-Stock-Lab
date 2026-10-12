const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-evaluator-evidence-consistency-gate-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1_STATIC_FAILED",

    failed:
      ["gateExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    gateExists:
      true,

    canonicalBindingUsed:
      source.includes(
        "bindActualForwardObservations"
      ),

    actualObservationFile:
      source.includes(
        "alpha-v3-entry-v3-forward-oos-observations.json"
      ),

    actualEvaluatorFile:
      source.includes(
        "alpha-v3-entry-v3-forward-shadow-oos.json"
      ),

    summaryFile:
      source.includes(
        "alpha-v3-true-forward-oos-summary.json"
      ),

    observationCountConsistency:
      source.includes(
        "evaluatorObservationCountMatches"
      ),

    qualifiedCountConsistency:
      source.includes(
        "evaluatorQualifiedCountMatches"
      ),

    filledCountConsistency:
      source.includes(
        "evaluatorFilledCountMatches"
      ),

    frozenCutoff:
      source.includes(
        '"2026-10-07"'
      ),

    frozenCap:
      source.includes(
        "0.01"
      ),

    frozenThreshold:
      source.includes(
        "0.66"
      ),

    retuningDisabled:
      source.includes(
        "retuningDisabled"
      ),

    failClosed:
      source.includes(
        "EVALUATOR_EVIDENCE_INCONSISTENT"
      ),

    noEvaluatorExecution:
      !/spawn\s*\(|execSync\s*\(|spawnSync\s*\(/.test(
        source
      ),

    readOnlyDisk:
      source.includes(
        "readFileSync"
      ) &&
      !source.includes(
        "writeFileSync"
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        source
      ),

    noPromotionExecution:
      !/applyPromotion|promoteModel|executePromotion/i.test(
        source
      ),

    noRealTradingEnable:
      !/(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)\s*[:=]\s*["']true["']/i.test(
        source
      ),
  };

  const failed =
    Object.entries(checks)
      .filter(
        ([, value]) =>
          value !==
          true
      )
      .map(
        ([key]) =>
          key
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      evaluatorExecuted:
        false,

      summaryExecuted:
        false,

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
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_EVALUATOR_EVIDENCE_CONSISTENCY_CONTRACT"
        : "REPAIR_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
