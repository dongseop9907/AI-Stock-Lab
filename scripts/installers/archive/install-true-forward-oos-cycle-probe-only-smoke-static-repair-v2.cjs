const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-cycle-probe-only-one-shot-smoke-v1.ts"
);

const BACKUP = path.join(
  ROOT,
  "scripts",
  "backups",
  "true-forward-oos-cycle-probe-only-one-shot-smoke-v1.before-approved-exec-static-repair-v2.ts"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_SMOKE_STATIC_REPAIR_V2_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(TARGET)) {
  fail("SMOKE_TEST_NOT_FOUND");
} else {
  fs.mkdirSync(
    path.dirname(BACKUP),
    { recursive: true }
  );

  if (!fs.existsSync(BACKUP)) {
    fs.copyFileSync(TARGET, BACKUP);
  }

  let source =
    fs.readFileSync(TARGET, "utf8");

  const oldBlock = `  const approvedExecution =
    source.indexOf(
      "executeApprovedPaperOrders(",
    );`;

  const newBlock = `  const approvedExecution =
    source.indexOf(
      "executeApprovedPaperOrders(",
      Math.max(
        0,
        probeMarker,
      ),
    );`;

  if (source.includes(newBlock)) {
    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_SMOKE_STATIC_REPAIR_V2_INSTALLED",
      changed:
        false,
      reason:
        "ALREADY_REPAIRED",
      productSourceChanges:
        0,
      nextAction:
        "RERUN_PROBE_ONLY_ONE_SHOT_SMOKE",
    }, null, 2));

    process.exitCode = 0;
  } else if (!source.includes(oldBlock)) {
    fail(
      "EXPECTED_STATIC_CHECK_ANCHOR_NOT_FOUND"
    );
  } else {
    source =
      source.replace(
        oldBlock,
        newBlock
      );

    fs.writeFileSync(
      TARGET,
      source,
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_SMOKE_STATIC_REPAIR_V2_INSTALLED",

      changed:
        true,

      target:
        "scripts/true-forward-oos-cycle-probe-only-one-shot-smoke-v1.ts",

      backup:
        "scripts/backups/true-forward-oos-cycle-probe-only-one-shot-smoke-v1.before-approved-exec-static-repair-v2.ts",

      repair:
        "SEARCH_APPROVED_EXECUTION_CALL_ONLY_AFTER_PROBE_MARKER",

      productSourceChanges:
        0,

      safety: {
        routeSourceChanged:
          false,
        routeCalledByInstaller:
          false,
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false
      },

      nextAction:
        "RERUN_PROBE_ONLY_ONE_SHOT_SMOKE",
    }, null, 2));

    process.exitCode = 0;
  }
}
