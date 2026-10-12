const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const targetRel = "scripts/true-forward-oos-paper-promotion-eligibility-preflight-v1.ts";
const target = path.join(ROOT, targetRel);
const backupDir = path.join(ROOT, "scripts", "backups");
const marker = "AI_STOCK_LAB_PATCH_PAPER_PROMOTION_ELIGIBILITY_DECISION_NARROWING_V1";

function out(obj, error = false) {
  (error ? console.error : console.log)(JSON.stringify(obj, null, 2));
}

if (!fs.existsSync(target)) {
  out({
    status: "AI_STOCK_LAB_PAPER_PROMOTION_ELIGIBILITY_DECISION_NARROWING_V1_FAILED",
    message: "TARGET_FILE_NOT_FOUND",
    target: targetRel
  }, true);
  process.exitCode = 1;
  return;
}

let source = fs.readFileSync(target, "utf8");

if (source.includes(marker)) {
  out({
    status: "AI_STOCK_LAB_PAPER_PROMOTION_ELIGIBILITY_DECISION_NARROWING_V1_ALREADY_APPLIED",
    target: targetRel,
    nextAction: "RUN_FOCUSED_CONTRACT_CURRENT_PREFLIGHT_AND_TARGET_TSC_CHECK"
  });
  return;
}

const pattern =
  /decision:\s*\n\s*decisionIntegrity\.decision\s*\?\?\s*\n\s*null,/;

if (!pattern.test(source)) {
  const alt = /decision:\s*decisionIntegrity\.decision\s*\?\?\s*null,/;

  if (!alt.test(source)) {
    const lines = source.split(/\r?\n/);
    const context = [];
    for (let i = 0; i < lines.length; i++) {
      if (/decisionIntegrity\.decision/.test(lines[i])) {
        const from = Math.max(0, i - 4);
        const to = Math.min(lines.length, i + 5);
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
      status: "AI_STOCK_LAB_PAPER_PROMOTION_ELIGIBILITY_DECISION_NARROWING_V1_FAILED",
      message: "DECISION_ACCESS_PATTERN_NOT_FOUND",
      target: targetRel,
      context
    }, true);
    process.exitCode = 1;
    return;
  }
}

fs.mkdirSync(backupDir, { recursive: true });

const backup = path.join(
  backupDir,
  "true-forward-oos-paper-promotion-eligibility-preflight-v1.before-decision-narrowing-v1.ts"
);

if (!fs.existsSync(backup)) {
  fs.copyFileSync(target, backup);
}

let changed = 0;

source = source.replace(
  /decision:\s*\n\s*decisionIntegrity\.decision\s*\?\?\s*\n\s*null,/,
  () => {
    changed++;
    return `decision:
          "decision" in decisionIntegrity
            ? decisionIntegrity.decision ?? null
            : null,`;
  }
);

if (changed === 0) {
  source = source.replace(
    /decision:\s*decisionIntegrity\.decision\s*\?\?\s*null,/,
    () => {
      changed++;
      return `decision:
          "decision" in decisionIntegrity
            ? decisionIntegrity.decision ?? null
            : null,`;
    }
  );
}

source =
  `// ${marker}\n` +
  `// Type-safe union narrowing for optional decision field; promotion behavior is unchanged.\n` +
  source;

fs.writeFileSync(target, source, "utf8");

const after = fs.readFileSync(target, "utf8");

const verified =
  after.includes(marker) &&
  after.includes(`"decision" in decisionIntegrity`) &&
  after.includes(`? decisionIntegrity.decision ?? null`) &&
  changed === 1;

if (!verified) {
  out({
    status: "AI_STOCK_LAB_PAPER_PROMOTION_ELIGIBILITY_DECISION_NARROWING_V1_FAILED",
    message: "POST_PATCH_VERIFICATION_FAILED",
    target: targetRel,
    changed,
    backup: path.relative(ROOT, backup).replace(/\\/g, "/")
  }, true);
  process.exitCode = 1;
  return;
}

out({
  status: "AI_STOCK_LAB_PAPER_PROMOTION_ELIGIBILITY_DECISION_NARROWING_V1_INSTALLED",
  target: targetRel,
  backup: path.relative(ROOT, backup).replace(/\\/g, "/"),
  changedAccesses: changed,
  fix: "IN_OPERATOR_UNION_NARROWING_FOR_OPTIONAL_DECISION",
  runtimeBehaviorChanged: false,
  promotionLogicChanged: false,
  safety: {
    databaseReadsAdded: 0,
    databaseWritesAdded: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    promotionExecuted: false,
    realTradingEnabled: false
  },
  nextAction: "RUN_FOCUSED_CONTRACT_CURRENT_PREFLIGHT_AND_TARGET_TSC_CHECK"
});
