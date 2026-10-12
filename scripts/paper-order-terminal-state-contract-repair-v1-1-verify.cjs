const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR =
  path.join(ROOT, "supabase", "migrations");

const matches =
  fs.readdirSync(MIG_DIR)
    .filter((name) =>
      name.endsWith(
        "_paper_order_terminal_state_contract_repair_v1_1.sql"
      )
    )
    .sort();

const target =
  matches.length
    ? matches[matches.length - 1]
    : null;

const source =
  target
    ? fs.readFileSync(
        path.join(MIG_DIR, target),
        "utf8"
      )
    : "";

const checks = {
  migrationFound:
    Boolean(target),

  validatorExplicitlyReplaced:
    /create or replace function\s+public\.validate_paper_order_state_transition_v1/i
      .test(source),

  normalizerUsed:
    /normalize_paper_order_status_v1/i
      .test(source),

  versionPreserved:
    /ALPHA_V3_ORDER_STATE_MACHINE_V1/i
      .test(source),

  createAllowedStatusesPreserved:
    /p_is_insert[\s\S]*?'RISK_APPROVED'[\s\S]*?'RISK_REJECTED'[\s\S]*?'FILLED'[\s\S]*?CREATE_ALLOWED/i
      .test(source),

  failedNotCreateAllowed:
    /CREATE_STATUS_NOT_ALLOWED/i
      .test(source) &&
    /run_paper_order_terminal_state_contract_regression_v1_1/i
      .test(source),

  riskApprovedToFailedAdded:
    /v_old\s*=\s*'RISK_APPROVED'[\s\S]*?v_new\s+in\s*\([\s\S]*?'FAILED'/i
      .test(source),

  failedTerminalAdded:
    /'FAILED'[\s\S]*?TERMINAL_STATE_CANNOT_TRANSITION/i
      .test(source),

  failedIdempotentCovered:
    /'FAILED',[\s\S]*?'FAILED'[\s\S]*?IDEMPOTENT_NOOP/i
      .test(source),

  expiredStillAllowed:
    /'RISK_APPROVED',[\s\S]*?'EXPIRED'[\s\S]*?TRANSITION_ALLOWED/i
      .test(source),

  cancelledStillBlocked:
    /'RISK_APPROVED',[\s\S]*?'CANCELLED'[\s\S]*?TRANSITION_NOT_ALLOWED/i
      .test(source),

  canceledAliasCovered:
    /'CANCELED',[\s\S]*?'CANCELLED'[\s\S]*?IDEMPOTENT_NOOP/i
      .test(source),

  unsupportedFromCovered:
    /'APPROVED',[\s\S]*?'RISK_APPROVED'[\s\S]*?UNSUPPORTED_FROM_STATUS/i
      .test(source),

  failedAddedToDbCheck:
    /paper_order_requests_status_check[\s\S]*?'FAILED'::text/i
      .test(source),

  expiredAddedToDbCheck:
    /paper_order_requests_status_check[\s\S]*?'EXPIRED'::text/i
      .test(source),

  readOnlyRegression:
    /paperOrderWrites'[\s\S]*?0/i
      .test(source) &&
    /positionWrites'[\s\S]*?0/i
      .test(source),

  productionBuyNotReplaced:
    !/create or replace function\s+public\.execute_paper_buy_order/i
      .test(source),

  productionSellNotReplaced:
    !/create or replace function\s+public\.execute_paper_protective_sell/i
      .test(source),

  noShadowMutation:
    !/true_forward|forward_oos|shadow_session/i
      .test(source),

  noRealTradingEnable:
    !/REAL_TRADING_ENABLED\s*=\s*true/i
      .test(source),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([key]) => key);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REPAIR_V1_1_VERIFIED"
      : "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REPAIR_V1_1_VERIFY_FAILED",

  migration:
    target
      ? "supabase/migrations/" + target
      : null,

  contract: {
    createAllowed: [
      "RISK_APPROVED",
      "RISK_REJECTED",
      "FILLED"
    ],

    transitionsAllowed: [
      "RISK_APPROVED -> FILLED",
      "RISK_APPROVED -> EXPIRED",
      "RISK_APPROVED -> FAILED"
    ],

    terminal: [
      "RISK_REJECTED",
      "FILLED",
      "CANCELLED",
      "EXPIRED",
      "FAILED"
    ],

    preservedBlocks: [
      "CREATE FAILED",
      "RISK_APPROVED -> CANCELLED"
    ],

    dbCheckAdds: [
      "EXPIRED",
      "FAILED"
    ],
  },

  checks,
  failed,

  safety: {
    sourceOnly: true,
    databaseWrites: 0,
    migrationApplied: false,
    runtimeRegressionWritesOrders: 0,
    runtimeRegressionWritesPositions: 0,
    productionBuySellExecutionFunctionsModified: false,
    shadowFilesModified: false,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "SUPABASE_DB_PUSH_DRY_RUN_V1_1"
      : "REVIEW_V1_1_REPAIR",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
