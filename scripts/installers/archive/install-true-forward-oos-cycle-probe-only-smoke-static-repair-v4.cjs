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
  "true-forward-oos-cycle-probe-only-one-shot-smoke-v1.before-approved-exec-token-repair-v4.ts"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_SMOKE_STATIC_REPAIR_V4_FAILED",
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

  const start =
    source.indexOf(
      "  const approvedExecution"
    );

  const end =
    source.indexOf(
      "\n\n  const checks =",
      start
    );

  if (
    start < 0 ||
    end < 0
  ) {
    fail(
      "APPROVED_EXECUTION_STATIC_BLOCK_NOT_FOUND",
      {
        start,
        end,
      }
    );
  } else {
    const replacement = `  const approvedExecution =
    source.indexOf(
      "executeApprovedPaperOrders",
      Math.max(
        0,
        probeMarker,
      ),
    );`;

    source =
      source.slice(
        0,
        start
      ) +
      replacement +
      source.slice(
        end
      );

    fs.writeFileSync(
      TARGET,
      source,
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_CYCLE_PROBE_ONLY_SMOKE_STATIC_REPAIR_V4_INSTALLED",

      changed:
        true,

      target:
        "scripts/true-forward-oos-cycle-probe-only-one-shot-smoke-v1.ts",

      backup:
        "scripts/backups/true-forward-oos-cycle-probe-only-one-shot-smoke-v1.before-approved-exec-token-repair-v4.ts",

      repair:
        "FIND_EXECUTE_APPROVED_PAPER_ORDERS_IDENTIFIER_AFTER_PROBE_MARKER",

      rationale:
        "IMPORT_IS_BEFORE_PROBE_MARKER_SO_FIRST_IDENTIFIER_AFTER_MARKER_IS_RUNTIME_CALL",

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
        "RERUN_PROBE_ONLY_ONE_SHOT_SMOKE"
    }, null, 2));

    process.exitCode = 0;
  }
}
