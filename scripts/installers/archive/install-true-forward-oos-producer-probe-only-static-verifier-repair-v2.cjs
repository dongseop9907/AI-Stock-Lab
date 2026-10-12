const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-producer-probe-only-v1-static-verify.cjs"
);

const BACKUP = path.join(
  ROOT,
  "scripts",
  "backups",
  "true-forward-oos-producer-probe-only-v1-static-verify.before-runtime-call-repair-v2.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_STATIC_VERIFIER_REPAIR_V2_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(TARGET)) {
  fail("STATIC_VERIFIER_NOT_FOUND");
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

  const oldBlock = `  const runtimeCallIndex =
    source.indexOf(
      "runTrueForwardTop1Producer(",
      Math.max(
        0,
        mainIndex
      )
    );`;

  const newBlock = `  const runtimeCallIndex =
    source.indexOf(
      "await runTrueForwardTop1Producer(",
      Math.max(
        0,
        mainIndex
      )
    );`;

  if (source.includes(newBlock)) {
    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_STATIC_VERIFIER_REPAIR_V2_INSTALLED",
      changed:
        false,
      reason:
        "ALREADY_REPAIRED",
      productSourceChanges:
        0,
      nextAction:
        "RERUN_STATIC_AND_SUBPROCESS_REGRESSION",
    }, null, 2));

    process.exitCode = 0;
  } else if (!source.includes(oldBlock)) {
    fail(
      "EXPECTED_RUNTIME_CALL_SEARCH_BLOCK_NOT_FOUND"
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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_STATIC_VERIFIER_REPAIR_V2_INSTALLED",

      changed:
        true,

      target:
        "scripts/true-forward-oos-producer-probe-only-v1-static-verify.cjs",

      backup:
        "scripts/backups/true-forward-oos-producer-probe-only-v1-static-verify.before-runtime-call-repair-v2.cjs",

      repair:
        "FIND_ACTUAL_AWAITED_PRODUCER_RUNTIME_CALL_INSTEAD_OF_COMMENT_TEXT",

      productSourceChanges:
        0,

      safety: {
        producerSourceChanged:
          false,
        producerExecuted:
          false,
        databaseReads:
          0,
        databaseWrites:
          0,
        producerFileWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false
      },

      nextAction:
        "RERUN_STATIC_AND_SUBPROCESS_REGRESSION"
    }, null, 2));

    process.exitCode = 0;
  }
}
