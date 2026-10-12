const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const gate = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-maturity-aware-collector-gate-v1.ts"
);

const collector = path.join(
  ROOT,
  "scripts",
  "alpha-v3-true-entry-forward-oos-collector-v1.ts"
);

const audit = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-post-capture-maturity-audit-v1.ts"
);

if (
  !fs.existsSync(gate) ||
  !fs.existsSync(collector) ||
  !fs.existsSync(audit)
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_AUDIT_SUBPROCESS_BINDING_V4_STATIC_FAILED",

    failed: [
      "requiredFilesExist"
    ],
  }, null, 2));

  process.exitCode = 1;
} else {
  const gateSource =
    fs.readFileSync(
      gate,
      "utf8"
    );

  const collectorSource =
    fs.readFileSync(
      collector,
      "utf8"
    );

  const forcedFalseKeys = [
    "REAL_TRADING_ENABLED",
    "ENABLE_REAL_TRADING",
    "ENABLE_LIVE_TRADING",
  ];

  const realTradingForcedFalse =
    forcedFalseKeys.every(
      key => {
        const pattern =
          new RegExp(
            key +
            "\\\\s*:\\\\s*[\\"']false[\\"']"
          );

        return pattern.test(
          gateSource
        );
      }
    );

  const checks = {
    requiredFilesExist:
      true,

    noMaturityAuditHelperImport:
      !/from\\s+["']\\.\\/true-forward-oos-post-capture-maturity-audit-v1["']/.test(
        gateSource
      ),

    maturityAuditRunsAsSubprocess:
      gateSource.includes(
        '"scripts/true-forward-oos-post-capture-maturity-audit-v1.ts"'
      ) &&
      gateSource.includes(
        "runTsxScript("
      ),

    maturityAuditJsonParsed:
      gateSource.includes(
        "parseJsonPayload("
      ),

    maturityAuditFailureFailsClosed:
      gateSource.includes(
        "MATURITY_AUDIT_FAILED_CLOSED"
      ),

    collectorStillHasNoHorizonCli:
      !collectorSource.includes(
        "--horizon"
      ) &&
      !collectorSource.includes(
        "process.argv"
      ),

    gateNoLongerPassesHorizonCli:
      !gateSource.includes(
        '"--horizon"'
      ),

    collectorSingleRun:
      gateSource.includes(
        "await runCollector()"
      ) &&
      gateSource.includes(
        "collectorRuns:"
      ),

    maturedHorizonsTracked:
      gateSource.includes(
        "maturedHorizons"
      ),

    r1r3r5CollectorNative:
      collectorSource.includes(
        "r1:"
      ) &&
      collectorSource.includes(
        "r3:"
      ) &&
      collectorSource.includes(
        "r5:"
      ) &&
      collectorSource.includes(
        "directReturns"
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        gateSource
      ),

    realTradingForcedFalse,
  };

  const failed =
    Object.entries(
      checks
    )
      .filter(
        ([, value]) =>
          value !== true
      )
      .map(
        ([key]) =>
          key
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_AUDIT_SUBPROCESS_BINDING_V4_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_AUDIT_SUBPROCESS_BINDING_V4_STATIC_FAILED",

    verifierVersion:
      "V4_AUDIT_SUBPROCESS_BINDING",

    checks,

    diagnostics: {
      realTradingForcedFalse,
      forcedFalseKeys,
    },

    safety: {
      sourceOnly:
        true,

      maturityAuditExecuted:
        false,

      collectorExecuted:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      promotionExecuted:
        false,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_AUDIT_SUBPROCESS_BINDING_CONTRACT_AND_CURRENT_RUNTIME"
        : "REPAIR_AUDIT_SUBPROCESS_BINDING_V4",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
