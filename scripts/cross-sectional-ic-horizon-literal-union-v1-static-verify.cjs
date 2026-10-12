const fs = require("fs");
const path = require("path");

const target =
  path.join(
    process.cwd(),
    "scripts",
    "alpha-v1-cross-sectional-ic-regime-timing.ts"
  );

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V1_STATIC_FAILED",
    failed: [
      "targetExists"
    ]
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const typedCount =
    (
      source.match(
        /\\[\\s*"r1",\\s*"r3",\\s*"r5",\\s*\\]\\s*as const/g
      ) || []
    ).length;

  const checks = {
    typedHorizonTupleCountAtLeastTwo:
      typedCount >= 2,

    rowHUsageStillPresent:
      source.includes(
        "row[h]"
      ),

    pearsonStillPresent:
      source.includes(
        "pearson("
      ),

    regimeTimingCorrelationStillPresent:
      source.includes(
        "regimeTimingCorrelation"
      ),

    noHAnyCast:
      !source.includes(
        "h as any"
      ),

    noRowAnyCast:
      !source.includes(
        "row as any"
      )
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
        ? "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_CROSS_SECTIONAL_IC_HORIZON_LITERAL_UNION_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      calculationLogicChanged:
        false,

      scriptExecuted:
        false,

      databaseReads:
        0,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      promotionExecuted:
        false,

      realTradingEnabled:
        false
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_DASHBOARD_CONTRACT_AND_NEXT_BUILD"
        : "REPAIR_HORIZON_LITERAL_UNION"
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
