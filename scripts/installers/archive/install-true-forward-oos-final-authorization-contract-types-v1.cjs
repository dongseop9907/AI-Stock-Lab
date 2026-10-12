const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const targetRel = "scripts/true-forward-oos-paper-promotion-final-authorization-gate-v1-contract-test.ts";
const target = path.join(ROOT, targetRel);
const backupDir = path.join(ROOT, "scripts", "backups");
const marker = "AI_STOCK_LAB_PATCH_FINAL_AUTHORIZATION_CONTRACT_TYPES_V1";

function out(obj, error = false) {
  (error ? console.error : console.log)(JSON.stringify(obj, null, 2));
}

if (!fs.existsSync(target)) {
  out({
    status: "AI_STOCK_LAB_FINAL_AUTHORIZATION_CONTRACT_TYPES_V1_FAILED",
    message: "TARGET_FILE_NOT_FOUND",
    target: targetRel
  }, true);
  process.exitCode = 1;
  return;
}

let source = fs.readFileSync(target, "utf8");

if (source.includes(marker)) {
  out({
    status: "AI_STOCK_LAB_FINAL_AUTHORIZATION_CONTRACT_TYPES_V1_ALREADY_APPLIED",
    target: targetRel,
    nextAction: "RUN_FOCUSED_CONTRACT_AND_TARGET_TSC_CHECK"
  });
  return;
}

const phrasePattern =
  /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*exactFinalAuthorizationPhrase\b/g;

const checksPattern =
  /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*checks\s*\.\s*([A-Za-z_$][\w$]*)/g;

const phraseMatches = [...source.matchAll(phrasePattern)];
const checksMatches = [...source.matchAll(checksPattern)];

if (phraseMatches.length === 0 || checksMatches.length < 2) {
  const lines = source.split(/\r?\n/);
  const context = [];
  for (let i = 0; i < lines.length; i++) {
    if (/exactFinalAuthorizationPhrase|\bchecks\b/.test(lines[i])) {
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

  out({
    status: "AI_STOCK_LAB_FINAL_AUTHORIZATION_CONTRACT_TYPES_V1_FAILED",
    message: "EXPECTED_ACCESS_PATTERNS_NOT_FOUND",
    target: targetRel,
    exactPhraseAccesses: phraseMatches.length,
    checksAccesses: checksMatches.length,
    context
  }, true);
  process.exitCode = 1;
  return;
}

fs.mkdirSync(backupDir, { recursive: true });

const backup = path.join(
  backupDir,
  "true-forward-oos-paper-promotion-final-authorization-gate-v1-contract-test.before-types-v1.ts"
);

if (!fs.existsSync(backup)) {
  fs.copyFileSync(target, backup);
}

let phraseChanged = 0;
source = source.replace(phrasePattern, (full, objectExpr) => {
  phraseChanged += 1;
  const normalized = objectExpr.replace(/\s*\.\s*/g, ".");
  return `((${normalized} as { exactFinalAuthorizationPhrase?: string }).exactFinalAuthorizationPhrase)`;
});

let checksChanged = 0;
source = source.replace(checksPattern, (full, objectExpr, key) => {
  checksChanged += 1;
  const normalized = objectExpr.replace(/\s*\.\s*/g, ".");
  return `(((${normalized} as { checks?: Record<string, boolean> }).checks ?? {}).${key})`;
});

source =
  `// ${marker}\n` +
  `// Contract-test-only union narrowing. Runtime promotion behavior is unchanged.\n` +
  source;

fs.writeFileSync(target, source, "utf8");

const after = fs.readFileSync(target, "utf8");
const phraseCastCount =
  (after.match(/as \{ exactFinalAuthorizationPhrase\?: string \}/g) || []).length;
const checksCastCount =
  (after.match(/as \{ checks\?: Record<string, boolean> \}/g) || []).length;

if (
  !after.includes(marker) ||
  phraseChanged === 0 ||
  checksChanged < 2 ||
  phraseCastCount < phraseChanged ||
  checksCastCount < checksChanged
) {
  out({
    status: "AI_STOCK_LAB_FINAL_AUTHORIZATION_CONTRACT_TYPES_V1_FAILED",
    message: "POST_PATCH_VERIFICATION_FAILED",
    target: targetRel,
    phraseChanged,
    checksChanged,
    phraseCastCount,
    checksCastCount,
    backup: path.relative(ROOT, backup).replace(/\\/g, "/")
  }, true);
  process.exitCode = 1;
  return;
}

out({
  status: "AI_STOCK_LAB_FINAL_AUTHORIZATION_CONTRACT_TYPES_V1_INSTALLED",
  target: targetRel,
  backup: path.relative(ROOT, backup).replace(/\\/g, "/"),
  changed: {
    exactFinalAuthorizationPhrase: phraseChanged,
    checks: checksChanged
  },
  fix: [
    "NARROW_EXACT_FINAL_AUTHORIZATION_PHRASE_UNION_ACCESS",
    "NARROW_FINAL_AUTHORIZATION_CHECKS_UNION_ACCESS"
  ],
  runtimeLogicChanged: false,
  promotionLogicChanged: false,
  safety: {
    databaseReadsAdded: 0,
    databaseWritesAdded: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionExecuted: false,
    realTradingEnabled: false
  },
  nextAction: "RUN_FOCUSED_CONTRACT_AND_TARGET_TSC_CHECK"
});
