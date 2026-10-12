const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const targetRel = "scripts/true-forward-oos-manual-review-packet-integrity-v1-contract-test.ts";
const target = path.join(ROOT, targetRel);
const backupDir = path.join(ROOT, "scripts", "backups");
const marker = "AI_STOCK_LAB_PATCH_MANUAL_REVIEW_PACKET_CHECKS_TYPE_V1";

function print(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function fail(message, extra = {}) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_MANUAL_REVIEW_PACKET_CHECKS_TYPE_FIX_V1_FAILED",
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
    status: "AI_STOCK_LAB_MANUAL_REVIEW_PACKET_CHECKS_TYPE_FIX_V1_ALREADY_APPLIED",
    target: targetRel,
    runtimeLogicChanged: false,
    productSourceChanges: 0,
    nextAction: "RUN_FOCUSED_CONTRACT_AND_TSC_CHECK"
  });
  return;
}

const pattern = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.checks\.([A-Za-z_$][\w$]*)/g;
const matches = [...source.matchAll(pattern)];

if (matches.length < 4) {
  fail("EXPECTED_CHECKS_ACCESSES_NOT_FOUND", {
    target: targetRel,
    found: matches.length,
    expectedAtLeast: 4
  });
  return;
}

fs.mkdirSync(backupDir, { recursive: true });

const backup = path.join(
  backupDir,
  "true-forward-oos-manual-review-packet-integrity-v1-contract-test.before-checks-type-fix-v1.ts"
);

if (!fs.existsSync(backup)) {
  fs.copyFileSync(target, backup);
}

source = source.replace(
  pattern,
  "(($1 as { checks: Record<string, boolean> }).checks).$2"
);

source =
  `// ${marker}\n` +
  `// Contract-test-only union narrowing for checks. Runtime access semantics are unchanged.\n` +
  source;

fs.writeFileSync(target, source, "utf8");

const after = fs.readFileSync(target, "utf8");
const castCount = (after.match(/as \{ checks: Record<string, boolean> \}/g) || []).length;

if (!after.includes(marker) || castCount < matches.length) {
  fail("POST_PATCH_VERIFICATION_FAILED", {
    target: targetRel,
    originalAccesses: matches.length,
    castCount,
    backup: path.relative(ROOT, backup).replace(/\\/g, "/")
  });
  return;
}

print({
  status: "AI_STOCK_LAB_MANUAL_REVIEW_PACKET_CHECKS_TYPE_FIX_V1_INSTALLED",
  target: targetRel,
  backup: path.relative(ROOT, backup).replace(/\\/g, "/"),
  changedAccesses: matches.length,
  fix: "NARROW_CHECKS_UNION_ACCESS_WITH_RECORD_BOOLEAN_CAST",
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
});
