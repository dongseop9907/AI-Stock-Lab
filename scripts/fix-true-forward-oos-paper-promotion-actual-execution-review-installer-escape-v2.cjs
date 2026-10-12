const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "install-true-forward-oos-paper-promotion-actual-execution-review-gate-v1.cjs"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_ACTUAL_EXECUTION_REVIEW_INSTALLER_ESCAPE_FIX_V2_FAILED",
    reason: "TARGET_INSTALLER_NOT_FOUND",
    target,
  }, null, 2));
  process.exitCode = 1;
} else {
  const before = fs.readFileSync(target, "utf8");

  const replacements = [
    {
      from: '"MANUAL_APPLY_APPROVED:${"',
      to: '"MANUAL_APPLY_APPROVED:\\${"',
    },
    {
      from: '"MANUAL_APPLY:${"',
      to: '"MANUAL_APPLY:\\${"',
    },
  ];

  let after = before;
  const changed = [];

  for (const item of replacements) {
    if (after.includes(item.from)) {
      after = after.replaceAll(item.from, item.to);
      changed.push({
        from: item.from,
        to: item.to,
      });
    }
  }

  const backupDir = path.join(
    process.cwd(),
    "scripts",
    "backups"
  );

  fs.mkdirSync(
    backupDir,
    { recursive: true }
  );

  const backup = path.join(
    backupDir,
    "install-true-forward-oos-paper-promotion-actual-execution-review-gate-v1.before-escape-fix-v2.cjs"
  );

  if (!fs.existsSync(backup)) {
    fs.writeFileSync(
      backup,
      before,
      "utf8"
    );
  }

  fs.writeFileSync(
    target,
    after,
    "utf8"
  );

  const remainingUnsafe = [
    '"MANUAL_APPLY_APPROVED:${"',
    '"MANUAL_APPLY:${"',
  ].filter(x => after.includes(x));

  const escapedPresent = [
    '"MANUAL_APPLY_APPROVED:\\${"',
    '"MANUAL_APPLY:\\${"',
  ].every(x => after.includes(x));

  const failed = [];

  if (changed.length !== 2) {
    failed.push("EXPECTED_TWO_ESCAPE_REPLACEMENTS");
  }

  if (remainingUnsafe.length > 0) {
    failed.push("UNESCAPED_TEMPLATE_INTERPOLATION_REMAINS");
  }

  if (!escapedPresent) {
    failed.push("ESCAPED_TEMPLATE_LITERALS_NOT_FOUND");
  }

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_ACTUAL_EXECUTION_REVIEW_INSTALLER_ESCAPE_FIX_V2_REPAIRED"
        : "AI_STOCK_LAB_ACTUAL_EXECUTION_REVIEW_INSTALLER_ESCAPE_FIX_V2_FAILED",
    target:
      "scripts/install-true-forward-oos-paper-promotion-actual-execution-review-gate-v1.cjs",
    backup:
      "scripts/backups/install-true-forward-oos-paper-promotion-actual-execution-review-gate-v1.before-escape-fix-v2.cjs",
    problem:
      "UNESCAPED_${}_SEQUENCE_INSIDE_OUTER_CJS_TEMPLATE_LITERAL",
    changed,
    checks: {
      expectedTwoReplacements:
        changed.length === 2,
      noUnsafeInterpolationRemaining:
        remainingUnsafe.length === 0,
      escapedLiteralsPresent:
        escapedPresent,
      productSourceChanges:
        0,
      tradingLogicChanges:
        0,
    },
    safety: {
      generatedProductFilesExecuted: false,
      promotionExecuted: false,
      databaseWrites: 0,
      ordersCreated: 0,
      positionsChanged: 0,
      realTradingEnabled: false,
    },
    failed,
    nextAction:
      failed.length === 0
        ? "NODE_CHECK_THEN_RERUN_ORIGINAL_INSTALLER_AND_TESTS"
        : "INSPECT_INSTALLER_ESCAPE_FIX",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
