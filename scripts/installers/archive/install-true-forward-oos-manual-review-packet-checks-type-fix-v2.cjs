const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const targetRel = "scripts/true-forward-oos-manual-review-packet-integrity-v1-contract-test.ts";
const target = path.join(ROOT, targetRel);
const backupDir = path.join(ROOT, "scripts", "backups");
const marker = "AI_STOCK_LAB_PATCH_MANUAL_REVIEW_PACKET_CHECKS_TYPE_V2";

function out(obj, error = false) {
  const text = JSON.stringify(obj, null, 2);
  (error ? console.error : console.log)(text);
}

if (!fs.existsSync(target)) {
  out({
    status: "AI_STOCK_LAB_MANUAL_REVIEW_PACKET_CHECKS_TYPE_FIX_V2_FAILED",
    message: "TARGET_FILE_NOT_FOUND",
    target: targetRel
  }, true);
  process.exitCode = 1;
  return;
}

let source = fs.readFileSync(target, "utf8");

if (source.includes(marker)) {
  out({
    status: "AI_STOCK_LAB_MANUAL_REVIEW_PACKET_CHECKS_TYPE_FIX_V2_ALREADY_APPLIED",
    target: targetRel,
    nextAction: "RUN_FOCUSED_CONTRACT_AND_TSC_CHECK"
  });
  return;
}

const lines = source.split(/\r?\n/);
const checkLines = [];
for (let i = 0; i < lines.length; i++) {
  if (/\bchecks\b/.test(lines[i])) {
    checkLines.push({
      line: i + 1,
      text: lines[i]
    });
  }
}

// Allows:
//   ready.checks.foo
//   ready
//     .checks
//     .foo
//   result.packet.checks.foo
const checksAccessPattern =
  /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*checks\b/g;

const matches = [...source.matchAll(checksAccessPattern)];

if (matches.length === 0) {
  const context = [];
  for (const item of checkLines) {
    const from = Math.max(1, item.line - 2);
    const to = Math.min(lines.length, item.line + 2);
    context.push({
      aroundLine: item.line,
      lines: lines.slice(from - 1, to).map((text, idx) => ({
        line: from + idx,
        text
      }))
    });
  }

  out({
    status: "AI_STOCK_LAB_MANUAL_REVIEW_PACKET_CHECKS_TYPE_FIX_V2_FAILED",
    message: "NO_CHECKS_ACCESS_PATTERN_MATCH",
    target: targetRel,
    checksOccurrences: checkLines.length,
    context
  }, true);
  process.exitCode = 1;
  return;
}

fs.mkdirSync(backupDir, { recursive: true });

const backup = path.join(
  backupDir,
  "true-forward-oos-manual-review-packet-integrity-v1-contract-test.before-checks-type-fix-v2.ts"
);

if (!fs.existsSync(backup)) {
  fs.copyFileSync(target, backup);
}

let changed = 0;

source = source.replace(checksAccessPattern, (full, objectExpr) => {
  // Avoid re-patching an already narrowed expression if user manually changed it.
  if (/as\s*\{[^}]*checks/.test(objectExpr)) {
    return full;
  }

  changed += 1;
  const normalizedObjectExpr = objectExpr.replace(/\s*\.\s*/g, ".");
  return `((${normalizedObjectExpr} as { checks?: Record<string, boolean> }).checks ?? {})`;
});

if (changed === 0) {
  out({
    status: "AI_STOCK_LAB_MANUAL_REVIEW_PACKET_CHECKS_TYPE_FIX_V2_FAILED",
    message: "MATCHED_BUT_NOT_CHANGED",
    target: targetRel,
    matches: matches.length
  }, true);
  process.exitCode = 1;
  return;
}

source =
  `// ${marker}\n` +
  `// Contract-test-only union narrowing for optional checks; runtime production logic unchanged.\n` +
  source;

fs.writeFileSync(target, source, "utf8");

const after = fs.readFileSync(target, "utf8");
const narrowedCount =
  (after.match(/as \{ checks\?: Record<string, boolean> \}/g) || []).length;

if (!after.includes(marker) || narrowedCount < changed) {
  out({
    status: "AI_STOCK_LAB_MANUAL_REVIEW_PACKET_CHECKS_TYPE_FIX_V2_FAILED",
    message: "POST_PATCH_VERIFICATION_FAILED",
    target: targetRel,
    changed,
    narrowedCount,
    backup: path.relative(ROOT, backup).replace(/\\/g, "/")
  }, true);
  process.exitCode = 1;
  return;
}

out({
  status: "AI_STOCK_LAB_MANUAL_REVIEW_PACKET_CHECKS_TYPE_FIX_V2_INSTALLED",
  target: targetRel,
  backup: path.relative(ROOT, backup).replace(/\\/g, "/"),
  detectedChecksAccesses: matches.length,
  changedAccesses: changed,
  fix: "NEWLINE_TOLERANT_OPTIONAL_CHECKS_UNION_NARROWING",
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
