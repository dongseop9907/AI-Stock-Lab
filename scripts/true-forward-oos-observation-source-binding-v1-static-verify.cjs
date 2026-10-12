const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-observation-source-binding-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_OBSERVATION_SOURCE_BINDING_V1_STATIC_FAILED",

    failed:
      ["bindingExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    bindingExists:
      true,

    actualObservationFile:
      source.includes(
        "logs/alpha-v3-entry-v3-forward-oos-observations.json"
      ),

    directReturnsSource:
      source.includes(
        "directReturns"
      ),

    r1R3R5:
      source.includes(
        '"r1"'
      ) &&
      source.includes(
        '"r3"'
      ) &&
      source.includes(
        '"r5"'
      ),

    canonical1D3D5D:
      source.includes(
        '"1D"'
      ) &&
      source.includes(
        '"3D"'
      ) &&
      source.includes(
        '"5D"'
      ),

    qualifiedSource:
      source.includes(
        "correctedEntry"
      ) &&
      source.includes(
        "qualified"
      ),

    policyReturnSource:
      source.includes(
        "selectedPolicy"
      ) &&
      source.includes(
        "returns"
      ),

    stockCodeInKey:
      source.includes(
        "row.stockCode"
      ),

    duplicateFailClosed:
      source.includes(
        "DUPLICATE_CANONICAL_OUTCOME_KEYS"
      ),

    orderingFailClosed:
      source.includes(
        "CANONICAL_HORIZON_ORDERING_VIOLATION"
      ),

    actualSchemaDocumentsNoEvaluatedAt:
      source.includes(
        '"evaluatedAt"'
      ) &&
      source.includes(
        '"returnRate"'
      ) &&
      source.includes(
        "unsupportedLegacyAssumptions"
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

    noRealTradingEnable:
      !/(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)\s*[:=]\s*["']true["']/i.test(
        source
      ),
  };

  const failed =
    Object.entries(checks)
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_OBSERVATION_SOURCE_BINDING_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_OBSERVATION_SOURCE_BINDING_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      collectorExecuted:
        false,

      evaluatorExecuted:
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
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_OBSERVATION_SOURCE_BINDING_CONTRACT"
        : "REPAIR_OBSERVATION_SOURCE_BINDING_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
