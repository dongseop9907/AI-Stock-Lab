const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const targetRel = "scripts/true-forward-oos-manual-review-decision-integrity-v1-contract-test.ts";
const target = path.join(ROOT, targetRel);
const backupDir = path.join(ROOT, "scripts", "backups");
const marker = "AI_STOCK_LAB_PATCH_MANUAL_REVIEW_DECISION_CONTINUE_FORWARD_OOS_TYPE_V1";

function fail(message, extra = {}) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_MANUAL_REVIEW_DECISION_CONTINUE_FORWARD_OOS_TYPE_FIX_V1_FAILED",
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
  console.log(JSON.stringify({
    status: "AI_STOCK_LAB_MANUAL_REVIEW_DECISION_CONTINUE_FORWARD_OOS_TYPE_FIX_V1_ALREADY_APPLIED",
    target: targetRel,
    productSourceChanges: 0,
    nextAction: "RUN_FOCUSED_CONTRACT_AND_TSC_CHECK"
  }, null, 2));
  return;
}

const rawMatches = [...source.matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.continueForwardOos\b/g)];

if (rawMatches.length < 2) {
  fail("EXPECTED_CONTINUE_FORWARD_OOS_ACCESSES_NOT_FOUND", {
    target: targetRel,
    found: rawMatches.length,
    expectedAtLeast: 2
  });
  return;
}

fs.mkdirSync(backupDir, { recursive: true });

const backup = path.join(
  backupDir,
  "true-forward-oos-manual-review-decision-integrity-v1-contract-test.before-continue-forward-oos-type-fix-v1.ts"
);

if (!fs.existsSync(backup)) {
  fs.copyFileSync(target, backup);
}

source = source.replace(
  /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.continueForwardOos\b/g,
  "($1 as { continueForwardOos?: boolean }).continueForwardOos"
);

source =
  `// ${marker}\n` +
  `// Type-only contract hardening: preserve runtime value while narrowing union access.\n` +
  source;

fs.writeFileSync(target, source, "utf8");

const after = fs.readFileSync(target, "utf8");
const unsafe = [...after.matchAll(/(?<!\})\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.continueForwardOos\b/g)];
const castCount = (after.match(/as \{ continueForwardOos\?: boolean \}/g) || []).length;

const ok = after.includes(marker) && castCount >= rawMatches.length;

if (!ok) {
  fail("POST_PATCH_VERIFICATION_FAILED", {
    target: targetRel,
    originalAccesses: rawMatches.length,
    castCount,
    unsafeCount: unsafe.length,
    backup: path.relative(ROOT, backup).replace(/\\/g, "/")
  });
  return;
}

console.log(JSON.stringify({
  status: "AI_STOCK_LAB_MANUAL_REVIEW_DECISION_CONTINUE_FORWARD_OOS_TYPE_FIX_V1_INSTALLED",
  target: targetRel,
  backup: path.relative(ROOT, backup).replace(/\\/g, "/"),
  changedAccesses: rawMatches.length,
  fix: "NARROW_CONTINUE_FORWARD_OOS_UNION_ACCESS_WITH_OPTIONAL_BOOLEAN_CAST",
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
  nextAction: "RUN_FOCUSED_CONTRACT_AND_TSC_CHECK"
}, null, 2));
