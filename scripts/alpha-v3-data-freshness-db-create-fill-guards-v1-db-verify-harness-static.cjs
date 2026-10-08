const fs = require("fs");
const path = require("path");

const root = process.cwd();

const rel =
  "scripts/alpha-v3-data-freshness-db-create-fill-guards-v1-db-verify.ts";

const text =
  fs.readFileSync(
    path.resolve(root, rel),
    "utf8"
  );

const checks = {
  pureValidatorRpc:
    text.includes(
      "validate_paper_buy_data_freshness_v1"
    ),

  dbAssertionRpc:
    text.includes(
      "assert_paper_buy_data_freshness_allowed_v1"
    ),

  canonicalFreshnessRead:
    text.includes(
      "market_data_freshness_observations"
    ),

  canonicalQualityRead:
    text.includes(
      "market_data_quality_gate_observations"
    ),

  noCreateRpc:
    !text.includes(
      "create_paper_buy_order_with_committed_risk_v3"
    ),

  noFillRpc:
    !text.includes(
      'supabase.rpc(\n      "execute_paper_buy_order"'
    ),

  noMutationMethods:
    !/\.(insert|upsert|update|delete)\s*\(/m.test(
      text
    ),

  orderCountOnly:
    text.includes(
      '"paper_order_requests"'
    ),

  positionCountOnly:
    text.includes(
      '"paper_positions"'
    ),
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) => !value
    )
    .map(
      ([key]) => key
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_DATA_FRESHNESS_DB_CREATE_FILL_GUARDS_V1_DB_VERIFY_HARNESS_STATIC_VERIFIED"
          : "ALPHA_V3_DATA_FRESHNESS_DB_CREATE_FILL_GUARDS_V1_DB_VERIFY_HARNESS_STATIC_REVIEW",

      checks,
      failed,

      safety: {
        databaseWrites:
          0,

        productionCreateRpcCalled:
          false,

        productionFillRpcCalled:
          false,
      },

      nextGate:
        failed.length === 0
          ? "APPLY_01700_THEN_RUN_DB_VERIFY"
          : "REVIEW_DB_VERIFY_HARNESS",
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
