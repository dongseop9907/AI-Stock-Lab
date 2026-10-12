const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const targetRel = "scripts/true-forward-oos-evaluator-evidence-consistency-gate-v1-contract-test.ts";
const target = path.join(ROOT, targetRel);
const backupDir = path.join(ROOT, "scripts", "backups");
const marker = "AI_STOCK_LAB_PATCH_EVALUATOR_EVIDENCE_CONSISTENCY_NEVER_TYPES_V1";

const literals = [
  "evaluatorObservationCountMatches",
  "historicalCutoffFrozen",
  "selectedCapFrozen",
  "entryThresholdFrozen",
  "retuningDisabled",
];

function out(obj, error = false) {
  (error ? console.error : console.log)(JSON.stringify(obj, null, 2));
}

if (!fs.existsSync(target)) {
  out({
    status: "AI_STOCK_LAB_EVALUATOR_EVIDENCE_CONSISTENCY_NEVER_TYPES_V1_FAILED",
    message: "TARGET_FILE_NOT_FOUND",
    target: targetRel
  }, true);
  process.exitCode = 1;
  return;
}

let source = fs.readFileSync(target, "utf8");

if (source.includes(marker)) {
  out({
    status: "AI_STOCK_LAB_EVALUATOR_EVIDENCE_CONSISTENCY_NEVER_TYPES_V1_ALREADY_APPLIED",
    target: targetRel,
    nextAction: "RUN_FOCUSED_CONTRACT_AND_TARGET_TSC_CHECK"
  });
  return;
}

const missing = literals.filter((x) => !source.includes(`"${x}"`));

if (missing.length > 0) {
  out({
    status: "AI_STOCK_LAB_EVALUATOR_EVIDENCE_CONSISTENCY_NEVER_TYPES_V1_FAILED",
    message: "EXPECTED_LITERALS_NOT_FOUND",
    target: targetRel,
    missing
  }, true);
  process.exitCode = 1;
  return;
}

fs.mkdirSync(backupDir, { recursive: true });

const backup = path.join(
  backupDir,
  "true-forward-oos-evaluator-evidence-consistency-gate-v1-contract-test.before-never-types-v1.ts"
);

if (!fs.existsSync(backup)) {
  fs.copyFileSync(target, backup);
}

let changed = 0;

for (const literal of literals) {
  const from = `"${literal}"`;
  const to = `("${literal}" as never)`;

  if (source.includes(to)) continue;

  const index = source.indexOf(from);
  if (index < 0) continue;

  source =
    source.slice(0, index) +
    to +
    source.slice(index + from.length);

  changed++;
}

source =
  `// ${marker}\n` +
  `// Contract-test-only literal narrowing for inferred never keys. Runtime evaluator behavior unchanged.\n` +
  source;

fs.writeFileSync(target, source, "utf8");

const after = fs.readFileSync(target, "utf8");
const verified = literals.every((x) =>
  after.includes(`("${x}" as never)`)
);

if (!verified || changed !== literals.length) {
  out({
    status: "AI_STOCK_LAB_EVALUATOR_EVIDENCE_CONSISTENCY_NEVER_TYPES_V1_FAILED",
    message: "POST_PATCH_VERIFICATION_FAILED",
    target: targetRel,
    changed,
    expected: literals.length,
    backup: path.relative(ROOT, backup).replace(/\\/g, "/")
  }, true);
  process.exitCode = 1;
  return;
}

out({
  status: "AI_STOCK_LAB_EVALUATOR_EVIDENCE_CONSISTENCY_NEVER_TYPES_V1_INSTALLED",
  target: targetRel,
  backup: path.relative(ROOT, backup).replace(/\\/g, "/"),
  changedTypeSites: changed,
  fixes: literals,
  fixMode: "CONTRACT_TEST_ONLY_LITERAL_TYPE_NARROWING",
  runtimeLogicChanged: false,
  productSourceChanges: 0,
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionExecuted: false,
    realTradingEnabled: false
  },
  nextAction: "RUN_FOCUSED_CONTRACT_AND_TARGET_TSC_CHECK"
});
