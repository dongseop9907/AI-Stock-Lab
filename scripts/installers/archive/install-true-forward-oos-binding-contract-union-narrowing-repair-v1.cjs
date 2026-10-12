const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-automation-binding-v1-contract-test.ts"
);

const BACKUP = path.join(
  ROOT,
  "scripts",
  "backups",
  "true-forward-oos-automation-binding-v1-contract-test.before-union-narrowing-repair-v1.ts"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_BINDING_CONTRACT_UNION_NARROWING_REPAIR_V1_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(TARGET)) {
  fail("CONTRACT_TEST_NOT_FOUND");
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

  const replacements = [
    {
      from: `  produced.executed.join(
    ",",
  ) === "PRODUCE",`,
      to: `  "executed" in produced &&
  produced.executed.join(
    ",",
  ) === "PRODUCE",`,
      key: "producedExecutedNarrowed",
    },
    {
      from: `  collectedAndEvaluated.executed.join(
    ",",
  ) ===
    "COLLECT,EVALUATE",`,
      to: `  "executed" in collectedAndEvaluated &&
  collectedAndEvaluated.executed.join(
    ",",
  ) ===
    "COLLECT,EVALUATE",`,
      key: "collectEvaluateExecutedNarrowed",
    },
    {
      from: `  summarized.executed.join(
    ",",
  ) === "SUMMARY",`,
      to: `  "executed" in summarized &&
  summarized.executed.join(
    ",",
  ) === "SUMMARY",`,
      key: "summaryExecutedNarrowed",
    },
    {
      from: `  duplicate.executed.length === 0,`,
      to: `  "executed" in duplicate &&
  duplicate.executed.length === 0,`,
      key: "duplicateExecutedNarrowed",
    },
    {
      from: `  missed.blockedReason ===
    "FORWARD_OOS_PRODUCER_WINDOW_MISSED_FAIL_CLOSED",`,
      to: `  "blockedReason" in missed &&
  missed.blockedReason ===
    "FORWARD_OOS_PRODUCER_WINDOW_MISSED_FAIL_CLOSED",`,
      key: "missedBlockedReasonNarrowed",
    },
  ];

  const applied = [];
  const missingAnchors = [];

  for (const item of replacements) {
    if (source.includes(item.to)) {
      applied.push({
        key: item.key,
        changed: false,
        reason: "ALREADY_REPAIRED",
      });
      continue;
    }

    if (!source.includes(item.from)) {
      missingAnchors.push(item.key);
      continue;
    }

    source =
      source.replace(
        item.from,
        item.to
      );

    applied.push({
      key: item.key,
      changed: true,
    });
  }

  if (missingAnchors.length > 0) {
    fail(
      "EXPECTED_CONTRACT_ANCHORS_NOT_FOUND",
      {
        missingAnchors,
      }
    );
  } else {
    fs.writeFileSync(
      TARGET,
      source,
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_BINDING_CONTRACT_UNION_NARROWING_REPAIR_V1_INSTALLED",

      changed:
        applied.some(
          item => item.changed
        ),

      target:
        "scripts/true-forward-oos-automation-binding-v1-contract-test.ts",

      backup:
        "scripts/backups/true-forward-oos-automation-binding-v1-contract-test.before-union-narrowing-repair-v1.ts",

      repair:
        "TYPE_NARROW_NEW_KRX_SKIP_UNION_BEFORE_LEGACY_RESULT_PROPERTY_ACCESS",

      applied,

      productCodeChanged:
        false,

      safety: {
        databaseReads:
          0,
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        promotionApplied:
          false,
        realTradingEnabled:
          false,
      },

      nextAction:
        "RERUN_TYPECHECK_EXISTING_CONTRACT_KRX_CONTRACT_AND_SCHEDULER_REGRESSION",
    }, null, 2));
  }
}
