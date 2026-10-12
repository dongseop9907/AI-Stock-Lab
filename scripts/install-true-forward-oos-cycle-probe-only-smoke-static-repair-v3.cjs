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
  "true-forward-oos-cycle-probe-only-one-shot-smoke-v1.before-approved-exec-regex-repair-v3.ts"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_SMOKE_STATIC_REPAIR_V3_FAILED",
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
    fs.copyFileSync(
      TARGET,
      BACKUP
    );
  }

  let source =
    fs.readFileSync(
      TARGET,
      "utf8"
    );

  const oldBlockA = `  const approvedExecution =
    source.indexOf(
      "executeApprovedPaperOrders(",
      Math.max(
        0,
        probeMarker,
      ),
    );`;

  const oldBlockB = `  const approvedExecution =
    source.indexOf(
      "executeApprovedPaperOrders(",
    );`;

  const newBlock = `  const approvedExecutionRelative =
    source
      .slice(
        Math.max(
          0,
          probeMarker,
        ),
      )
      .search(
        /executeApprovedPaperOrders\\s*\\(/,
      );

  const approvedExecution =
    approvedExecutionRelative >=
    0
      ? Math.max(
          0,
          probeMarker,
        ) +
        approvedExecutionRelative
      : -1;`;

  if (source.includes(newBlock)) {
    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_SMOKE_STATIC_REPAIR_V3_INSTALLED",
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
  } else {
    let changed = false;

    if (source.includes(oldBlockA)) {
      source =
        source.replace(
          oldBlockA,
          newBlock
        );
      changed = true;
    } else if (source.includes(oldBlockB)) {
      source =
        source.replace(
          oldBlockB,
          newBlock
        );
      changed = true;
    }

    if (!changed) {
      fail(
        "EXPECTED_APPROVED_EXECUTION_STATIC_CHECK_ANCHOR_NOT_FOUND"
      );
    } else {
      fs.writeFileSync(
        TARGET,
        source,
        "utf8"
      );

      console.log(JSON.stringify({
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_SMOKE_STATIC_REPAIR_V3_INSTALLED",

        changed:
          true,

        target:
          "scripts/true-forward-oos-cycle-probe-only-one-shot-smoke-v1.ts",

        backup:
          "scripts/backups/true-forward-oos-cycle-probe-only-one-shot-smoke-v1.before-approved-exec-regex-repair-v3.ts",

        repair:
          "REGEX_FIND_APPROVED_EXECUTION_CALL_AFTER_PROBE_MARKER_ALLOWING_WHITESPACE",

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
}
