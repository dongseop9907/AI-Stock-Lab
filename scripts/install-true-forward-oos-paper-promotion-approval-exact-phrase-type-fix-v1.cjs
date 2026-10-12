const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const targetRel = "scripts/true-forward-oos-paper-promotion-apply-approval-gate-v1-contract-test.ts";
const target = path.join(ROOT, targetRel);
const backupDir = path.join(ROOT, "scripts", "backups");
const marker = "AI_STOCK_LAB_PATCH_PAPER_PROMOTION_APPROVAL_EXACT_PHRASE_TYPE_V1";

function print(obj, error = false) {
  (error ? console.error : console.log)(JSON.stringify(obj, null, 2));
}

if (!fs.existsSync(target)) {
  print({
    status: "AI_STOCK_LAB_PAPER_PROMOTION_APPROVAL_EXACT_PHRASE_TYPE_FIX_V1_FAILED",
    message: "TARGET_FILE_NOT_FOUND",
    target: targetRel
  }, true);
  process.exitCode = 1;
  return;
}

let source = fs.readFileSync(target, "utf8");

if (source.includes(marker)) {
  print({
    status: "AI_STOCK_LAB_PAPER_PROMOTION_APPROVAL_EXACT_PHRASE_TYPE_FIX_V1_ALREADY_APPLIED",
    target: targetRel,
    runtimeLogicChanged: false,
    productSourceChanges: 0,
    nextAction: "RUN_FOCUSED_CONTRACT_AND_TARGET_TSC_CHECK"
  });
  return;
}

// Supports single-line and line-broken access:
//   result.exactApprovalPhrase
//   result
//     .exactApprovalPhrase
const pattern =
  /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*exactApprovalPhrase\b/g;

const matches = [...source.matchAll(pattern)];

if (matches.length === 0) {
  const lines = source.split(/\r?\n/);
  const context = [];
  for (let i = 0; i < lines.length; i++) {
    if (/exactApprovalPhrase/.test(lines[i])) {
      const from = Math.max(0, i - 3);
      const to = Math.min(lines.length, i + 4);
      context.push({
        aroundLine: i + 1,
        lines: lines.slice(from, to).map((text, idx) => ({
          line: from + idx + 1,
          text
        }))
      });
    }
  }

  print({
    status: "AI_STOCK_LAB_PAPER_PROMOTION_APPROVAL_EXACT_PHRASE_TYPE_FIX_V1_FAILED",
    message: "EXACT_APPROVAL_PHRASE_ACCESS_NOT_FOUND",
    target: targetRel,
    context
  }, true);
  process.exitCode = 1;
  return;
}

fs.mkdirSync(backupDir, { recursive: true });

const backup = path.join(
  backupDir,
  "true-forward-oos-paper-promotion-apply-approval-gate-v1-contract-test.before-exact-approval-phrase-type-fix-v1.ts"
);

if (!fs.existsSync(backup)) {
  fs.copyFileSync(target, backup);
}

let changed = 0;

source = source.replace(pattern, (full, objectExpr) => {
  if (/as\s*\{[^}]*exactApprovalPhrase/.test(objectExpr)) {
    return full;
  }

  changed += 1;
  const normalized = objectExpr.replace(/\s*\.\s*/g, ".");
  return `((${normalized} as { exactApprovalPhrase?: string }).exactApprovalPhrase)`;
});

source =
  `// ${marker}\n` +
  `// Contract-test-only union narrowing for exactApprovalPhrase. Runtime values and promotion behavior unchanged.\n` +
  source;

fs.writeFileSync(target, source, "utf8");

const after = fs.readFileSync(target, "utf8");
const castCount =
  (after.match(/as \{ exactApprovalPhrase\?: string \}/g) || []).length;

if (!after.includes(marker) || castCount < changed || changed === 0) {
  print({
    status: "AI_STOCK_LAB_PAPER_PROMOTION_APPROVAL_EXACT_PHRASE_TYPE_FIX_V1_FAILED",
    message: "POST_PATCH_VERIFICATION_FAILED",
    target: targetRel,
    matchedAccesses: matches.length,
    changedAccesses: changed,
    castCount,
    backup: path.relative(ROOT, backup).replace(/\\/g, "/")
  }, true);
  process.exitCode = 1;
  return;
}

print({
  status: "AI_STOCK_LAB_PAPER_PROMOTION_APPROVAL_EXACT_PHRASE_TYPE_FIX_V1_INSTALLED",
  target: targetRel,
  backup: path.relative(ROOT, backup).replace(/\\/g, "/"),
  detectedAccesses: matches.length,
  changedAccesses: changed,
  fix: "NARROW_EXACT_APPROVAL_PHRASE_UNION_ACCESS",
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
