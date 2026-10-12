const fs = require("fs");
const path = require("path");

const root = process.cwd();

const serviceRel =
  "lib/trading/paper-order-service.ts";

const serviceFile =
  path.resolve(root, serviceRel);

if (!fs.existsSync(serviceFile)) {
  throw new Error(
    "PAPER_ORDER_SERVICE_NOT_FOUND"
  );
}

const text =
  fs.readFileSync(
    serviceFile,
    "utf8"
  );

const checks = {
  accountQueryRestored:
    /\.from\("paper_accounts"\)/.test(
      text
    ),

  modelResolutionRestored:
    /resolveOrderModel\s*\(/.test(
      text
    ),

  stockQueryRestored:
    /\.from\("stocks"\)/.test(
      text
    ),

  targetSnapshotRestored:
    /\.from\("market_snapshots"\)[\s\S]{0,1000}?input\.stockCode/.test(
      text
    ),

  positionQueryIncludesStop:
    /\.from\("paper_positions"\)[\s\S]{0,700}?current_stop_price/.test(
      text
    ),

  aggregateOpenRiskCalculated:
    /currentAggregateOpenRiskAmount\s*\+=/.test(
      text
    ) &&
    /averagePrice[\s\S]{0,180}?stopPrice/.test(
      text
    ),

  missingStopTracked:
    /hasMissingOpenPositionStop/.test(
      text
    ),


  missingStopCountProvided:
    /openPositionsMissingValidStopCount\s*,/.test(
      text
    ),
  riskPreflightRestored:
    /validateBuyRisk\s*\(\s*riskInput/.test(
      text
    ),

  riskDecisionInsertRestored:
    /\.from\(\s*["']risk_decisions["']\s*,?\s*\)[\s\S]{0,1600}?\.insert\s*\(/.test(
      text
    ),

  atomicCommittedRiskHelperUsed:
    /createPaperBuyOrderWithCommittedRisk\s*\(\s*\{/.test(
      text
    ),

  directPaperOrderInsertRemoved:
    !/\.from\(\s*"paper_order_requests"\s*\)[\s\S]{0,300}?\.insert\s*\(/.test(
      text
    ),

  atomicHelperUsesDecisionId:
    /riskDecisionId\s*:\s*[\s\S]{0,80}?decisionData\.id/.test(
      text
    ),

  atomicHelperUsesPreflight:
    /preflightApproved\s*:\s*[\s\S]{0,80}?riskResult\.approved/.test(
      text
    ),

  atomicHelperUsesEquity:
    /equity\s*:\s*[\s\S]{0,80}?accountEquity/.test(
      text
    ),

  finalApprovalUsesDbStatus:
    /approved\s*:\s*[\s\S]{0,100}?orderData\.status\s*===\s*[\s\S]{0,50}?"RISK_APPROVED"/.test(
      text
    ),

  staleFakeOrderErrorRemoved:
    !/\bconst\s+orderError\b/.test(
      text
    ),
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) =>
        value !== true
    )
    .map(
      ([name]) =>
        name
    );

const result = {
  status:
    failed.length === 0
      ? "ALPHA_V3_PAPER_ORDER_SERVICE_REPAIR_V1_VERIFIED"
      : "ALPHA_V3_PAPER_ORDER_SERVICE_REPAIR_V1_REVIEW",

  checks,
  failed,

  contract: {
    restoredFlow: [
      "ACCOUNT",
      "MODEL",
      "STOCK",
      "PRICE",
      "POSITIONS",
      "EXPOSURES",
      "AGGREGATE_OPEN_RISK",
      "VALIDATE_BUY_RISK",
      "RISK_DECISION",
      "ATOMIC_COMMITTED_RISK_ORDER_CREATE",
    ],

    directPaperOrderInsert:
      false,

    committedRiskAtomicBoundary:
      true,

    databaseWritesByVerifier:
      0,
  },

  nextGate:
    failed.length === 0
      ? "RUN_TARGETED_PRODUCTION_TYPESCRIPT_CHECK"
      : "REVIEW_PAPER_ORDER_SERVICE_REPAIR",
};

console.log(
  JSON.stringify(
    result,
    null,
    2
  )
);

if (
  failed.length > 0
) {
  process.exitCode = 2;
}
