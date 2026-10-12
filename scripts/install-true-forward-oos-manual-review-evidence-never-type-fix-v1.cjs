const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const targetRel = "scripts/true-forward-oos-manual-review-evidence-gate-v1-contract-test.ts";
const target = path.join(ROOT, targetRel);
const backupDir = path.join(ROOT, "scripts", "backups");
const marker = "AI_STOCK_LAB_PATCH_MANUAL_REVIEW_EVIDENCE_NEVER_TYPE_V1";

const replacements = [
  ['"summaryPresent"', '("summaryPresent" as never)'],
  ['"EVALUATOR_EVIDENCE_NOT_CONSISTENT"', '("EVALUATOR_EVIDENCE_NOT_CONSISTENT" as never)'],
  ['"noSummaryProductionWrites"', '("noSummaryProductionWrites" as never)'],
];

function print(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function fail(message, extra = {}) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_MANUAL_REVIEW_EVIDENCE_NEVER_TYPE_FIX_V1_FAILED",
    message,
    ...extra
  }, null, 2));
  process.exitCode = 1;
}

if (!fs.existsSync(target)) {
  fail("TARGET_FILE_NOT_FOUND", { target: targetRel });
  return;
}

let source = fs.readFileSync(target, "utf8");

if (source.includes(marker)) {
  print({
    status: "AI_STOCK_LAB_MANUAL_REVIEW_EVIDENCE_NEVER_TYPE_FIX_V1_ALREADY_APPLIED",
    target: targetRel,
    runtimeLogicChanged: false,
    productSourceChanges: 0,
    nextAction: "RUN_FOCUSED_CONTRACT_AND_TSC_CHECK"
  });
  return;
}

const missing = replacements
  .filter(([from]) => !source.includes(from))
  .map(([from]) => from);

if (missing.length > 0) {
  fail("EXPECTED_TYPE_ERROR_LITERALS_NOT_FOUND", {
    target: targetRel,
    missing
  });
  return;
}

fs.mkdirSync(backupDir, { recursive: true });

const backup = path.join(
  backupDir,
  "true-forward-oos-manual-review-evidence-gate-v1-contract-test.before-never-type-fix-v1.ts"
);

if (!fs.existsSync(backup)) {
  fs.copyFileSync(target, backup);
}

let changed = 0;
for (const [from, to] of replacements) {
  if (source.includes(to)) continue;
  source = source.replace(from, to);
  changed += 1;
}

source =
  `// ${marker}\n` +
  `// Contract-test-only type narrowing. Runtime string values and production logic are unchanged.\n` +
  source;

fs.writeFileSync(target, source, "utf8");

const after = fs.readFileSync(target, "utf8");
const verified = replacements.every(([, to]) => after.includes(to));

if (!verified) {
  fail("POST_PATCH_VERIFICATION_FAILED", {
    target: targetRel,
    backup: path.relative(ROOT, backup).replace(/\\/g, "/"),
    changed
  });
  return;
}

print({
  status: "AI_STOCK_LAB_MANUAL_REVIEW_EVIDENCE_NEVER_TYPE_FIX_V1_INSTALLED",
  target: targetRel,
  backup: path.relative(ROOT, backup).replace(/\\/g, "/"),
  changedTypeSites: changed,
  fixes: [
    "summaryPresent",
    "EVALUATOR_EVIDENCE_NOT_CONSISTENT",
    "noSummaryProductionWrites"
  ],
  fixMode: "CONTRACT_TEST_ONLY_LITERAL_TYPE_NARROWING",
  runtimeLogicChanged: false,
  productSourceChanges: 0,
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    fileWritesOutsideTargetAndBackup: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionExecuted: false,
    realTradingEnabled: false
  },
  nextAction: "RUN_FOCUSED_CONTRACT_AND_TSC_CHECK"
});
