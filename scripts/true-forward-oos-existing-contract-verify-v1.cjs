const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();
const LOGS = path.join(ROOT, "logs");

const TARGETS = {
  contract:
    "scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts",
  staticVerify:
    "scripts/alpha-v3-true-forward-oos-pipeline-v1-static-verify.cjs",
  evaluator:
    "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",
  summary:
    "scripts/alpha-v3-true-forward-oos-summary.ts",
  collector:
    "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts"
};

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return "";
  }
}

function run(rel) {
  const full = path.join(ROOT, rel);

  if (!fs.existsSync(full)) {
    return {
      rel,
      exitCode: 1,
      stdout: "",
      stderr: "",
      error: "TARGET_NOT_FOUND"
    };
  }

  let args;

  if (rel.endsWith(".ts") || rel.endsWith(".tsx")) {
    args = [
      "--env-file=.env.local",
      "--import",
      "tsx",
      rel
    ];
  } else {
    args = [rel];
  }

  const result = spawnSync(
    process.execPath,
    args,
    {
      cwd: ROOT,
      encoding: "utf8",
      shell: false,
      env: {
        ...process.env,
        REAL_TRADING_ENABLED: "false",
        ENABLE_REAL_TRADING: "false",
        ENABLE_LIVE_TRADING: "false"
      },
      maxBuffer: 24 * 1024 * 1024
    }
  );

  return {
    rel,
    exitCode:
      typeof result.status === "number"
        ? result.status
        : 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error:
      result.error
        ? String(result.error.message || result.error)
        : null
  };
}

function parseStatusText(text) {
  const statuses =
    [...text.matchAll(/"status"\s*:\s*"([^"]+)"/g)]
      .map(m => m[1]);

  return [...new Set(statuses)];
}

function scanSafety(rel) {
  const text = read(rel);

  return {
    file: rel,
    exists: !!text,
    mentionsRealOrderEnable:
      /real_order_enabled\s*[:=]\s*true|ENABLE_REAL_TRADING\s*=\s*true/i.test(text),
    mentionsPromotionApply:
      /applyManualPaperPromotion|promotion\/apply|promotionApplyExecuted\s*:\s*true/i.test(text),
    mentionsOrderCreation:
      /createPaperBuyOrder|createLiveOrder|placeOrder|submitOrder/i.test(text),
    mentionsPositionMutation:
      /updatePosition|createPosition|closePosition/i.test(text),
    mentionsChildProcess:
      /spawnSync|spawn\(|execSync|exec\(/.test(text),
    mentionsWriteFile:
      /writeFileSync|writeFile\(/.test(text),
    mentionsDatabaseMutation:
      /\.insert\(|\.upsert\(|\.update\(|\.delete\(/.test(text)
  };
}

const safetyScans =
  Object.values(TARGETS).map(scanSafety);

const unsafeTarget =
  safetyScans.find(
    item =>
      item.mentionsRealOrderEnable === true ||
      item.mentionsPromotionApply === true
  ) || null;

let staticRun = null;
let contractRun = null;

if (!unsafeTarget) {
  staticRun = run(TARGETS.staticVerify);

  if (staticRun.exitCode === 0) {
    contractRun = run(TARGETS.contract);
  }
}

const evaluatorText = read(TARGETS.evaluator);
const summaryText = read(TARGETS.summary);

const evaluatorSemanticEvidence = {
  arithmeticOperations:
    /Math\.|reduce\(|filter\(|sort\(|\/|\*|\+|-/.test(evaluatorText),

  comparesObservedVsEntry:
    /(entry|baseline|start|open).{0,80}(price|value)|(price|value).{0,80}(entry|baseline|start|open)/is.test(evaluatorText),

  returnLikeNames:
    [...new Set(
      [...evaluatorText.matchAll(
        /\b([A-Za-z_][A-Za-z0-9_]*(?:return|pnl|profit|loss|performance|outcome|change|delta|gain)[A-Za-z0-9_]*)\b/gi
      )].map(m => m[1])
    )].slice(0, 40),

  percentageLikeLogic:
    /100|percent|percentage|pct|rate|ratio/i.test(evaluatorText),

  horizonTerms:
    /1d|3d|5d|day1|day3|day5|horizon|forwardDays|daysForward/i.test(evaluatorText)
};

const summarySemanticEvidence = {
  metricTerms:
    [...new Set(
      [...summaryText.matchAll(
        /\b([A-Za-z_][A-Za-z0-9_]*(?:return|pnl|profit|loss|performance|outcome|win|drawdown|expectancy|rate|ratio)[A-Za-z0-9_]*)\b/gi
      )].map(m => m[1])
    )].slice(0, 40),

  aggregates:
    /reduce\(|average|mean|median|sum|count|winRate|win_rate/i.test(summaryText)
};

const checks = {
  allTargetsExist:
    Object.values(TARGETS).every(exists),

  noExplicitRealTradingEnable:
    safetyScans.every(x => !x.mentionsRealOrderEnable),

  noPromotionApplySurfaceInTargets:
    safetyScans.every(x => !x.mentionsPromotionApply),

  staticVerifierExecuted:
    !!staticRun,

  staticVerifierPassed:
    staticRun?.exitCode === 0,

  contractExecuted:
    !!contractRun,

  contractPassed:
    contractRun?.exitCode === 0,

  evaluatorHasOutcomeSemantics:
    evaluatorSemanticEvidence.returnLikeNames.length > 0 ||
    (
      evaluatorSemanticEvidence.arithmeticOperations &&
      evaluatorSemanticEvidence.comparesObservedVsEntry
    ),

  evaluatorHasHorizonSemantics:
    evaluatorSemanticEvidence.horizonTerms,

  summaryHasMetricSemantics:
    summarySemanticEvidence.metricTerms.length > 0 ||
    summarySemanticEvidence.aggregates
};

const hardRequired = [
  "allTargetsExist",
  "noExplicitRealTradingEnable",
  "noPromotionApplySurfaceInTargets",
  "staticVerifierExecuted",
  "staticVerifierPassed",
  "contractExecuted",
  "contractPassed",
  "evaluatorHasOutcomeSemantics"
];

const hardFailures =
  hardRequired.filter(k => checks[k] !== true);

const warnings = [];

if (!checks.evaluatorHasHorizonSemantics) {
  warnings.push("EVALUATOR_HORIZON_TERMS_NOT_OBVIOUS");
}

if (!checks.summaryHasMetricSemantics) {
  warnings.push("SUMMARY_METRIC_SEMANTICS_NOT_OBVIOUS");
}

let readiness;
let nextGate;

if (hardFailures.length > 0) {
  readiness = "CONTRACT_OR_STATIC_VERIFICATION_FAILED";
  nextGate = "INSPECT_FAILED_FORWARD_OOS_VERIFIER_BEFORE_PATCH";
} else if (warnings.length > 0) {
  readiness = "CONTRACT_VERIFIED_WITH_WARNINGS";
  nextGate = "HARDEN_FORWARD_OOS_METRIC_CONTRACT";
} else {
  readiness = "CONTRACT_AND_STATIC_PATH_VERIFIED";
  nextGate = "AUDIT_FORWARD_OOS_AUTOMATION_BINDING";
}

const report = {
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_EXISTING_CONTRACT_VERIFY_V1_COMPLETED",

  mode:
    "EXISTING_STATIC_AND_CONTRACT_VERIFIER_EXECUTION",

  readiness,

  runs: {
    staticVerify: staticRun
      ? {
          file: staticRun.rel,
          exitCode: staticRun.exitCode,
          statuses:
            parseStatusText(staticRun.stdout + "\n" + staticRun.stderr),
          stdoutTail:
            staticRun.stdout.trim().split(/\r?\n/).slice(-30),
          stderrTail:
            staticRun.stderr.trim().split(/\r?\n/).filter(Boolean).slice(-20),
          error: staticRun.error
        }
      : null,

    contract: contractRun
      ? {
          file: contractRun.rel,
          exitCode: contractRun.exitCode,
          statuses:
            parseStatusText(contractRun.stdout + "\n" + contractRun.stderr),
          stdoutTail:
            contractRun.stdout.trim().split(/\r?\n/).slice(-30),
          stderrTail:
            contractRun.stderr.trim().split(/\r?\n/).filter(Boolean).slice(-20),
          error: contractRun.error
        }
      : null
  },

  safetyScans,

  evaluatorSemanticEvidence,
  summarySemanticEvidence,

  checks,

  hardFailures,

  warnings,

  safety: {
    databaseWritesIntroducedByVerifier:
      0,
    productSourceChanges:
      0,
    explicitRealTradingEnable:
      false,
    explicitPromotionApply:
      false,
    verifierDirectOrderCreation:
      false,
    verifierDirectPositionMutation:
      false
  },

  nextGate
};

fs.mkdirSync(LOGS, { recursive: true });

fs.writeFileSync(
  path.join(
    LOGS,
    "true-forward-oos-existing-contract-verify-v1.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify(report, null, 2));

process.exitCode =
  hardFailures.length === 0 ? 0 : 1;
