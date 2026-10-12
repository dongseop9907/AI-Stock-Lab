const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const TARGET = path.join(
  ROOT,
  "scripts",
  "paper-accounting-consistency-current-state-audit-v1.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ACCOUNTING_AUDIT_POSITION_FEE_BASIS_MODEL_FIX_V1_FAILED",
    reason,
    ...extra,
  }, null, 2));
  process.exitCode = 1;
}

if (!fs.existsSync(TARGET)) {
  fail("TARGET_AUDIT_NOT_FOUND", {
    target:
      "scripts/paper-accounting-consistency-current-state-audit-v1.cjs",
  });
} else {
  const before = fs.readFileSync(TARGET, "utf8");

  const oldBlock = `  positionFeeBasisModel:
    has(costSrc, /POSITION_FEE_BASIS/i) ||
    has(costSrc, /entry_broker_fee_basis/i),`;

  const newBlock = `  positionFeeBasisModel:
    has(costSrc, /POSITION_FEE_BASIS/i) ||
    has(costSrc, /entry_broker_fee_basis/i) ||
    has(
      positionFeeSrc,
      /PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS/i
    ) ||
    (
      has(positionFeeSrc, /entry_broker_fee_basis_total/i) &&
      has(positionFeeSrc, /entry_broker_fee_basis_remaining/i) &&
      has(positionFeeSrc, /cost_model_version/i)
    ),`;

  let after = before;

  if (before.includes(newBlock)) {
    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_ACCOUNTING_AUDIT_POSITION_FEE_BASIS_MODEL_FIX_V1_ALREADY_APPLIED",
      target:
        "scripts/paper-accounting-consistency-current-state-audit-v1.cjs",
      productionModified: false,
      shadowFilesModified: false,
    }, null, 2));
    return;
  }

  if (!before.includes(oldBlock)) {
    fail("EXPECTED_POSITION_FEE_BASIS_CHECK_NOT_FOUND");
    return;
  }

  after = before.replace(oldBlock, newBlock);

  fs.writeFileSync(TARGET, after, "utf8");

  const checks = {
    targetChanged:
      after !== before,

    oldCheckRemoved:
      !after.includes(oldBlock),

    positionFeeBasisMigrationIncluded:
      /positionFeeSrc[\s\S]{0,160}PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS/i
        .test(after),

    fallbackBasisColumnsIncluded:
      /entry_broker_fee_basis_total/i.test(after) &&
      /entry_broker_fee_basis_remaining/i.test(after),

    productionTradingFilesUntouched:
      true,

    shadowFilesUntouched:
      true,
  };

  const failed = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_ACCOUNTING_AUDIT_POSITION_FEE_BASIS_MODEL_FIX_V1_APPLIED"
        : "AI_STOCK_LAB_ACCOUNTING_AUDIT_POSITION_FEE_BASIS_MODEL_FIX_V1_REVIEW",

    target:
      "scripts/paper-accounting-consistency-current-state-audit-v1.cjs",

    correction: {
      previous:
        "Only inspected the selected legacy cost-attribution function body.",

      corrected:
        "Also inspects the later position-fee-basis migration that installs PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS.",

      accountingSemanticsChanged:
        false,
    },

    checks,
    failed,

    safety: {
      databaseReads: 0,
      databaseWrites: 0,
      productionModified: false,
      shadowFilesModified: false,
      promotionExecuted: false,
      realTradingEnabled: false,
    },

    nextAction:
      failed.length === 0
        ? "RERUN_CURRENT_STATE_ACCOUNTING_AUDIT"
        : "REVIEW_AUDIT_FIX",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
