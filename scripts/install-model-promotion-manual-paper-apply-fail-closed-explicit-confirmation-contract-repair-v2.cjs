const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const TARGET = path.join(
  ROOT,
  "scripts",
  "model-promotion-manual-paper-apply-fail-closed-regression-v1.ts"
);
const BACKUP_DIR = path.join(ROOT, "scripts", "backups");
const BACKUP = path.join(
  BACKUP_DIR,
  "model-promotion-manual-paper-apply-fail-closed-regression-v1.before-explicit-confirmation-contract-repair-v2.ts"
);

const CONFIRMATION_PHRASE = "PROMOTE_SHADOW_TO_PAPER";

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "MODEL_PROMOTION_MANUAL_PAPER_APPLY_FAIL_CLOSED_EXPLICIT_CONFIRMATION_CONTRACT_REPAIR_V2_FAILED",
    reason,
    ...extra
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(TARGET)) {
  fail("TARGET_REGRESSION_SCRIPT_NOT_FOUND", {
    target:
      "scripts/model-promotion-manual-paper-apply-fail-closed-regression-v1.ts"
  });
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

if (!fs.existsSync(BACKUP)) {
  fs.copyFileSync(TARGET, BACKUP);
}

let source = fs.readFileSync(TARGET, "utf8");

const beforeCount =
  (source.match(/confirmationPhrase\s*:/g) || []).length;

let replacements = 0;

source = source.replace(
  /manualApprovalConfirmed:\s*true,\s*\n(\s*)(?!confirmationPhrase\s*:)/g,
  (match, indent) => {
    replacements += 1;
    return (
      "manualApprovalConfirmed: true,\n" +
      indent +
      `confirmationPhrase: "${CONFIRMATION_PHRASE}",\n` +
      indent
    );
  }
);

const afterCount =
  (source.match(/confirmationPhrase\s*:/g) || []).length;

if (replacements === 0 && afterCount < 2) {
  fail("NO_PATCHABLE_MANUAL_APPROVAL_INPUTS_FOUND", {
    beforeConfirmationPhraseCount: beforeCount,
    afterConfirmationPhraseCount: afterCount,
    hint:
      "The regression file may differ from the expected V1 structure."
  });
}

const exactPhraseCount =
  (
    source.match(
      /confirmationPhrase\s*:\s*"PROMOTE_SHADOW_TO_PAPER"/g
    ) || []
  ).length;

if (exactPhraseCount < 2) {
  fail("EXPLICIT_CONFIRMATION_NOT_PRESENT_ON_BOTH_REGRESSION_CALLS", {
    exactPhraseCount,
    requiredMinimum: 2
  });
}

if (
  !source.includes(
    "MODEL_PROMOTION_MANUAL_APPLY_BLOCKED:CANONICAL_OUTCOME_EVIDENCE_NOT_READY"
  )
) {
  fail("EXPECTED_CANONICAL_NOT_READY_ERROR_ASSERTION_MISSING");
}

fs.writeFileSync(TARGET, source, "utf8");

console.log(JSON.stringify({
  status:
    "MODEL_PROMOTION_MANUAL_PAPER_APPLY_FAIL_CLOSED_EXPLICIT_CONFIRMATION_CONTRACT_REPAIR_V2_INSTALLED",
  repairedFile:
    "scripts/model-promotion-manual-paper-apply-fail-closed-regression-v1.ts",
  backup:
    "scripts/backups/model-promotion-manual-paper-apply-fail-closed-regression-v1.before-explicit-confirmation-contract-repair-v2.ts",
  repair: {
    productCodeChanged: false,
    regressionContractUpdated: true,
    confirmationPhrase:
      CONFIRMATION_PHRASE,
    insertedConfirmationPhraseFields:
      replacements,
    exactConfirmationPhraseOccurrences:
      exactPhraseCount,
    expectedFailClosedReason:
      "CANONICAL_OUTCOME_EVIDENCE_NOT_READY"
  },
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    promotionApplyExecuted: false,
    orderCreation: false,
    positionChange: false,
    controlsChange: false,
    realTradingEnable: false
  },
  nextAction:
    "RUN_GOVERNANCE_REGRESSION_SUITE"
}, null, 2));
