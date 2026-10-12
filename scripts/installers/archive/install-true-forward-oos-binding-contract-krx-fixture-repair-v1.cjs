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
  "true-forward-oos-automation-binding-v1-contract-test.before-krx-fixture-repair-v1.ts"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_BINDING_CONTRACT_KRX_FIXTURE_REPAIR_V1_FAILED",
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
      from: '"2026-10-09"',
      to: '"2026-10-08"',
      reason:
        "MAIN_SEQUENCE_FIXTURE_MOVED_FROM_HANGEUL_DAY_TO_TRADING_DAY",
    },
    {
      from: '"2026-10-10"',
      to: '"2026-10-12"',
      reason:
        "MISSED_WINDOW_FIXTURE_MOVED_FROM_SATURDAY_TO_TRADING_DAY",
    },
    {
      from: '"2026-10-11"',
      to: '"2026-10-13"',
      reason:
        "SUBPROCESS_FAILURE_FIXTURE_MOVED_FROM_SUNDAY_TO_TRADING_DAY",
    },
  ];

  const applied = [];

  for (const item of replacements) {
    const count =
      source.split(item.from).length - 1;

    if (count < 1) {
      fail(
        "EXPECTED_FIXTURE_NOT_FOUND",
        {
          fixture: item.from,
        }
      );
      break;
    }

    source =
      source.split(item.from).join(
        item.to
      );

    applied.push({
      ...item,
      occurrences: count,
    });
  }

  if (process.exitCode !== 1) {
    fs.writeFileSync(
      TARGET,
      source,
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_BINDING_CONTRACT_KRX_FIXTURE_REPAIR_V1_INSTALLED",

      changed:
        true,

      target:
        "scripts/true-forward-oos-automation-binding-v1-contract-test.ts",

      backup:
        "scripts/backups/true-forward-oos-automation-binding-v1-contract-test.before-krx-fixture-repair-v1.ts",

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
        "RERUN_EXISTING_CONTRACT_KRX_CONTRACT_TYPECHECK_AND_SCHEDULER_REGRESSION",
    }, null, 2));
  }
}
