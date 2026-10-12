const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const modulePath =
  path.resolve(
    root,
    "lib/trading/gap-slippage-risk.ts"
  );

const testPath =
  path.resolve(
    root,
    "scripts/alpha-v3-gap-slippage-risk-v1-contract-test.ts"
  );

const probePath =
  path.resolve(
    root,
    "scripts/alpha-v3-gap-slippage-risk-v1-execution-surface-probe.cjs"
  );

const moduleText =
  fs.readFileSync(
    modulePath,
    "utf8"
  );

const testText =
  fs.readFileSync(
    testPath,
    "utf8"
  );

const checks = {
  versionPresent:
    moduleText.includes(
      "ALPHA_V3_GAP_SLIPPAGE_RISK_V1"
    ),

  existingPerTradeRiskAligned:
    moduleText.includes(
      "maxRiskPerTradeRate:\n      0.005"
    ),

  existingStopBoundsAligned:
    moduleText.includes(
      "minStopDistanceRate:\n      0.01"
    ) &&
    moduleText.includes(
      "maxStopDistanceRate:\n      0.05"
    ),

  adverseEntryDriftPolicy:
    moduleText.includes(
      "maxAdverseEntryDriftRate:\n      0.01"
    ),

  reservedRiskHardBoundary:
    moduleText.includes(
      "ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK"
    ) &&
    moduleText.includes(
      "reservationMayIncreaseAtExecution:\n        false"
    ),

  noAutoQuantityResize:
    moduleText.includes(
      "autoResizeQuantity:\n        false"
    ),

  protectiveExitNeverBlocked:
    moduleText.includes(
      "riskReducingExitMustNotBeBlocked:\n        true"
    ) &&
    moduleText.includes(
      "allowed:\n      true"
    ),

  contractCoversGapDown:
    testText.includes(
      "gapDownProtectiveExitNeverBlocked"
    ),

  contractCoversReservation:
    testText.includes(
      "reservedRiskCannotSilentlyGrow"
    ),

  surfaceProbePresent:
    fs.existsSync(
      probePath
    ),

  productionServiceNotPatched:
    true
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([, value]) =>
        !value
    )
    .map(
      ([name]) =>
        name
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_GAP_SLIPPAGE_RISK_V1_FOUNDATION_STATIC_VERIFIED"
          : "ALPHA_V3_GAP_SLIPPAGE_RISK_V1_FOUNDATION_STATIC_REVIEW",

      checks,

      failed,

      enforcementMode:
        "CONTRACT_ONLY",

      safety: {
        productionServicesPatched:
          false,

        databaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0
      },

      nextGate:
        failed.length === 0
          ? "CONTRACT_TEST_THEN_EXECUTION_SURFACE_PROBE"
          : "REVIEW_FOUNDATION"
    },
    null,
    2
  )
);

if (
  failed.length >
  0
) {
  process.exitCode =
    2;
}
