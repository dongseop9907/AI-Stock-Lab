import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const migrationPath = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011000300_paper_protective_sell_closed_replay_v1.sql",
);

const stopLossPath = path.join(
  ROOT,
  "lib",
  "trading",
  "check-stop-losses.ts",
);

const trailingPath = path.join(
  ROOT,
  "lib",
  "trading",
  "update-trailing-stops.ts",
);

function read(file: string) {
  return fs.existsSync(file)
    ? fs.readFileSync(file, "utf8")
    : "";
}

const migration = read(migrationPath);
const stopLoss = read(stopLossPath);
const trailing = read(trailingPath);

const checks = {
  migrationExists:
    migration.length > 0,

  v4Defined:
    /create\s+or\s+replace\s+function\s+public\.execute_paper_protective_sell_v4\s*\(/i.test(
      migration,
    ),

  activePositionLocked:
    /from\s+public\.paper_positions[\s\S]{0,400}?where\s+p\.id\s*=\s*p_position_id[\s\S]{0,200}?for\s+update/i.test(
      migration,
    ),

  activePathDelegatesV3:
    /if\s+found\s+then[\s\S]{0,2200}?execute_paper_protective_sell_v3/i.test(
      migration,
    ),

  deterministicClosedReplay:
    /from\s+public\.paper_trade_history\s+t[\s\S]{0,500}?where\s+t\.source_position_id\s*=\s*p_position_id[\s\S]{0,500}?order\s+by[\s\S]{0,300}?t\.closed_at\s+desc\s+nulls\s+last[\s\S]{0,300}?t\.id\s+desc[\s\S]{0,200}?limit\s+1/i.test(
      migration,
    ),

  replayReturnsAlreadyClosed:
    /'alreadyClosed'\s*,\s*true/i.test(
      migration,
    ),

  replayTagged:
    /PAPER_PROTECTIVE_SELL_CLOSED_REPLAY_V1/i.test(
      migration,
    ),

  missingPositionFallsBackToV3:
    (migration.match(/execute_paper_protective_sell_v3/gi) ?? []).length >= 2,

  serviceRoleOnly:
    /revoke\s+all[\s\S]{0,500}?execute_paper_protective_sell_v4/i.test(
      migration,
    ) &&
    /grant\s+execute[\s\S]{0,500}?to\s+service_role/i.test(
      migration,
    ),

  stopLossUsesV4:
    /execute_paper_protective_sell_v4/i.test(
      stopLoss,
    ),

  trailingStopUsesV4:
    /execute_paper_protective_sell_v4/i.test(
      trailing,
    ),

  stopLossNoLongerUsesV3:
    !/execute_paper_protective_sell_v3/i.test(
      stopLoss,
    ),

  trailingStopNoLongerUsesV3:
    !/execute_paper_protective_sell_v3/i.test(
      trailing,
    ),

  noLiveTradingEnablement:
    !/REAL_TRADING_ENABLED\s*=\s*true/i.test(
      migration,
    ) &&
    !/ENABLE_REAL_TRADING\s*=\s*true/i.test(
      migration,
    ) &&
    !/ENABLE_LIVE_TRADING\s*=\s*true/i.test(
      migration,
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_CLOSED_REPLAY_V1_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_CLOSED_REPLAY_V1_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "DETERMINISTIC_PROTECTIVE_SELL_CLOSED_REPLAY_REPAIR_STRUCTURALLY_READY"
      : "PROTECTIVE_SELL_CLOSED_REPLAY_REPAIR_REVIEW_REQUIRED",

  checks,
  failed,

  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    rpcInvoked: false,
    ordersCreated: 0,
    ordersExecuted: 0,
    positionsChanged: 0,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "APPLY_CLOSED_REPLAY_V1_MIGRATION"
      : "REVIEW_FAILED_SOURCE_CHECKS",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
