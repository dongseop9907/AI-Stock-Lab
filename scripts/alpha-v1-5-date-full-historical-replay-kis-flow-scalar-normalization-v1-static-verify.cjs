const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "alpha-v1-5-date-full-historical-replay-read-only.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ALPHA_V1_5_DATE_REPLAY_KIS_FLOW_SCALAR_NORMALIZATION_V1_STATIC_FAILED",

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

  const fields = [
    "row.close_price",
    "row.accumulated_volume",
    "row.accumulated_trading_value",
    "row.individual_net_buy_quantity",
    "row.foreign_net_buy_quantity",
    "row.institution_net_buy_quantity",
    "row.individual_net_buy_amount",
    "row.foreign_net_buy_amount",
    "row.institution_net_buy_amount"
  ];

  const checks = {
    helperPresent:
      source.includes(
        "ALPHA_V1_5_DATE_REPLAY_KIS_SCALAR_NORMALIZATION_V1"
      ) &&
      source.includes(
        "function normalizeKisFlowScalar("
      ),

    scalarContract:
      source.includes(
        "): string | number | null {"
      ),

    allFieldsNormalized:
      fields.every(
        field =>
          source.includes(
            "normalizeKisFlowScalar(\n                  " +
            field +
            ","
          )
      ),

    stockFlowStillMapped:
      source.includes(
        "const stockFlow ="
      ) &&
      source.includes(
        "buildKisInvestorFlowEvidence({"
      ),

    noAnyCastShortcut:
      !source.includes(
        "stockFlow as any"
      ) &&
      !source.includes(
        "as KisDomesticInvestorTrendOutput[]"
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
        ? "AI_STOCK_LAB_ALPHA_V1_5_DATE_REPLAY_KIS_FLOW_SCALAR_NORMALIZATION_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_ALPHA_V1_5_DATE_REPLAY_KIS_FLOW_SCALAR_NORMALIZATION_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      replayExecuted:
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
        : "REPAIR_KIS_FLOW_SCALAR_NORMALIZATION"
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
