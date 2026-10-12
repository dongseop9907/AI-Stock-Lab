const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const targets = [
  "scripts/alpha-v1-alpha-only-historical-replay-read-only.ts",
  "scripts/alpha-v1-full-window-historical-replay-read-only.ts"
];

const fields = [
  ["stck_clpr", "row.close_price"],
  ["acml_vol", "row.accumulated_volume"],
  ["acml_tr_pbmn", "row.accumulated_trading_value"],
  ["prsn_ntby_qty", "row.individual_net_buy_quantity"],
  ["frgn_ntby_qty", "row.foreign_net_buy_quantity"],
  ["orgn_ntby_qty", "row.institution_net_buy_quantity"],
  ["prsn_ntby_tr_pbmn", "row.individual_net_buy_amount"],
  ["frgn_ntby_tr_pbmn", "row.foreign_net_buy_amount"],
  ["orgn_ntby_tr_pbmn", "row.institution_net_buy_amount"]
];

const checks = {};

for (const rel of targets) {
  const file =
    path.join(
      ROOT,
      rel
    );

  if (!fs.existsSync(file)) {
    checks[rel + ":exists"] =
      false;
    continue;
  }

  const source =
    fs.readFileSync(
      file,
      "utf8"
    );

  checks[rel + ":exists"] =
    true;

  checks[rel + ":helperPresent"] =
    source.includes(
      "function normalizeKisFlowScalar("
    );

  checks[rel + ":scalarContract"] =
    source.includes(
      "): string | number | null {"
    );

  const relevant =
    source.includes(
      "buildKisInvestorFlowEvidence({"
    );

  if (relevant) {
    checks[rel + ":allNineFieldsNormalized"] =
      fields.every(
        ([property, expression]) =>
          source.includes(
            property +
            ":\n                normalizeKisFlowScalar(\n                  " +
            expression +
            ","
          ) ||
          source.includes(
            property +
            ":\r\n                normalizeKisFlowScalar(\r\n                  " +
            expression +
            ","
          )
      );
  }

  checks[rel + ":noAnyCastShortcut"] =
    !source.includes(
      "as any"
    ) &&
    !source.includes(
      "as KisDomesticInvestorTrendOutput[]"
    );
}

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
      ? "AI_STOCK_LAB_HISTORICAL_REPLAY_KIS_FLOW_SCALAR_NORMALIZATION_V2_STATIC_VERIFIED"
      : "AI_STOCK_LAB_HISTORICAL_REPLAY_KIS_FLOW_SCALAR_NORMALIZATION_V2_STATIC_FAILED",

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
      : "REPAIR_HISTORICAL_REPLAY_KIS_FLOW_NORMALIZATION"
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
