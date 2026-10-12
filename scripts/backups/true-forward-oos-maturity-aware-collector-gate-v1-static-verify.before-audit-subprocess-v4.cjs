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

const expectedAuditExport =
  "buildMaturitySchedule";

if (
  !fs.existsSync(gate) ||
  !fs.existsSync(collector) ||
  !fs.existsSync(audit)
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_SINGLE_RUN_BINDING_V3_STATIC_FAILED",

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

  const auditSource =
    fs.readFileSync(
      audit,
      "utf8"
    );

  const auditExportPattern =
    new RegExp(
      "export\\s+(?:async\\s+)?function\\s+" +
      expectedAuditExport +
      "\\s*\\("
    );

  const auditConstPattern =
    new RegExp(
      "export\\s+const\\s+" +
      expectedAuditExport +
      "\\s*="
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
            "\\s*:\\s*[\\r\\n\\t ]*[\"']false[\"']"
          );

        return pattern.test(
          gateSource
        );
      }
    );

  const checks = {
    requiredFilesExist:
      true,

    actualMaturityAuditExportExists:
      auditExportPattern.test(
        auditSource
      ) ||
      auditConstPattern.test(
        auditSource
      ),

    gateBindsActualMaturityAuditExport:
      gateSource.includes(
        expectedAuditExport
      ),

    obsoleteUndefinedAuditBindingRemoved:
      expectedAuditExport ===
        "auditPostCaptureMaturityV1"
        ? true
        : !gateSource.includes(
            "auditPostCaptureMaturityV1"
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
        "\"--horizon\""
      ),

    collectorSpawnStillPresent:
      gateSource.includes(
        "spawn("
      ),

    collectorRunsOnceContract:
      gateSource.includes(
        "collectorRuns:"
      ) &&
      gateSource.includes(
        "await runCollector()"
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_SINGLE_RUN_BINDING_V3_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_SINGLE_RUN_BINDING_V3_STATIC_FAILED",

    verifierVersion:
      "V3_RUNTIME_EXPORT_AWARE",

    actualMaturityAuditExport:
      expectedAuditExport,

    checks,

    diagnostics: {
      realTradingForcedFalse,
      forcedFalseKeys,
    },

    safety: {
      sourceOnly:
        true,

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
        ? "RUN_SINGLE_RUN_COLLECTOR_BINDING_CONTRACT_AND_CURRENT_RUNTIME"
        : "REPAIR_SINGLE_RUN_COLLECTOR_BINDING_V3",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
