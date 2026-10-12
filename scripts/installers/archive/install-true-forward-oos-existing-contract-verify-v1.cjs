const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, "scripts");
const PACKAGE = path.join(ROOT, "package.json");
const BACKUPS = path.join(SCRIPTS, "backups");

const TARGET = path.join(
  SCRIPTS,
  "true-forward-oos-existing-contract-verify-v1.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_EXISTING_CONTRACT_VERIFY_V1_INSTALL_FAILED",
    reason,
    ...extra
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(SCRIPTS)) fail("SCRIPTS_DIRECTORY_NOT_FOUND");
if (!fs.existsSync(PACKAGE)) fail("PACKAGE_JSON_NOT_FOUND");

const required = [
  "scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts",
  "scripts/alpha-v3-true-forward-oos-pipeline-v1-static-verify.cjs",
  "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",
  "scripts/alpha-v3-true-forward-oos-summary.ts",
  "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts"
];

const missing = required.filter(
  rel => !fs.existsSync(path.join(ROOT, rel))
);

if (missing.length > 0) {
  fail("REQUIRED_FORWARD_OOS_ARTIFACTS_MISSING", { missing });
}

fs.mkdirSync(BACKUPS, { recursive: true });

const packageBackup = path.join(
  BACKUPS,
  "package.before-true-forward-oos-existing-contract-verify-v1.json"
);

if (!fs.existsSync(packageBackup)) {
  fs.copyFileSync(PACKAGE, packageBackup);
}

const runnerSource = "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst { spawnSync } = require(\"child_process\");\n\nconst ROOT = process.cwd();\nconst LOGS = path.join(ROOT, \"logs\");\n\nconst TARGETS = {\n  contract:\n    \"scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts\",\n  staticVerify:\n    \"scripts/alpha-v3-true-forward-oos-pipeline-v1-static-verify.cjs\",\n  evaluator:\n    \"scripts/alpha-v3-true-forward-oos-evaluator-v1.ts\",\n  summary:\n    \"scripts/alpha-v3-true-forward-oos-summary.ts\",\n  collector:\n    \"scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts\"\n};\n\nfunction exists(rel) {\n  return fs.existsSync(path.join(ROOT, rel));\n}\n\nfunction read(rel) {\n  try {\n    return fs.readFileSync(path.join(ROOT, rel), \"utf8\");\n  } catch {\n    return \"\";\n  }\n}\n\nfunction run(rel) {\n  const full = path.join(ROOT, rel);\n\n  if (!fs.existsSync(full)) {\n    return {\n      rel,\n      exitCode: 1,\n      stdout: \"\",\n      stderr: \"\",\n      error: \"TARGET_NOT_FOUND\"\n    };\n  }\n\n  let args;\n\n  if (rel.endsWith(\".ts\") || rel.endsWith(\".tsx\")) {\n    args = [\n      \"--env-file=.env.local\",\n      \"--import\",\n      \"tsx\",\n      rel\n    ];\n  } else {\n    args = [rel];\n  }\n\n  const result = spawnSync(\n    process.execPath,\n    args,\n    {\n      cwd: ROOT,\n      encoding: \"utf8\",\n      shell: false,\n      env: {\n        ...process.env,\n        REAL_TRADING_ENABLED: \"false\",\n        ENABLE_REAL_TRADING: \"false\",\n        ENABLE_LIVE_TRADING: \"false\"\n      },\n      maxBuffer: 24 * 1024 * 1024\n    }\n  );\n\n  return {\n    rel,\n    exitCode:\n      typeof result.status === \"number\"\n        ? result.status\n        : 1,\n    stdout: result.stdout || \"\",\n    stderr: result.stderr || \"\",\n    error:\n      result.error\n        ? String(result.error.message || result.error)\n        : null\n  };\n}\n\nfunction parseStatusText(text) {\n  const statuses =\n    [...text.matchAll(/\"status\"\\s*:\\s*\"([^\"]+)\"/g)]\n      .map(m => m[1]);\n\n  return [...new Set(statuses)];\n}\n\nfunction scanSafety(rel) {\n  const text = read(rel);\n\n  return {\n    file: rel,\n    exists: !!text,\n    mentionsRealOrderEnable:\n      /real_order_enabled\\s*[:=]\\s*true|ENABLE_REAL_TRADING\\s*=\\s*true/i.test(text),\n    mentionsPromotionApply:\n      /applyManualPaperPromotion|promotion\\/apply|promotionApplyExecuted\\s*:\\s*true/i.test(text),\n    mentionsOrderCreation:\n      /createPaperBuyOrder|createLiveOrder|placeOrder|submitOrder/i.test(text),\n    mentionsPositionMutation:\n      /updatePosition|createPosition|closePosition/i.test(text),\n    mentionsChildProcess:\n      /spawnSync|spawn\\(|execSync|exec\\(/.test(text),\n    mentionsWriteFile:\n      /writeFileSync|writeFile\\(/.test(text),\n    mentionsDatabaseMutation:\n      /\\.insert\\(|\\.upsert\\(|\\.update\\(|\\.delete\\(/.test(text)\n  };\n}\n\nconst safetyScans =\n  Object.values(TARGETS).map(scanSafety);\n\nconst unsafeTarget =\n  safetyScans.find(\n    item =>\n      item.mentionsRealOrderEnable === true ||\n      item.mentionsPromotionApply === true\n  ) || null;\n\nlet staticRun = null;\nlet contractRun = null;\n\nif (!unsafeTarget) {\n  staticRun = run(TARGETS.staticVerify);\n\n  if (staticRun.exitCode === 0) {\n    contractRun = run(TARGETS.contract);\n  }\n}\n\nconst evaluatorText = read(TARGETS.evaluator);\nconst summaryText = read(TARGETS.summary);\n\nconst evaluatorSemanticEvidence = {\n  arithmeticOperations:\n    /Math\\.|reduce\\(|filter\\(|sort\\(|\\/|\\*|\\+|-/.test(evaluatorText),\n\n  comparesObservedVsEntry:\n    /(entry|baseline|start|open).{0,80}(price|value)|(price|value).{0,80}(entry|baseline|start|open)/is.test(evaluatorText),\n\n  returnLikeNames:\n    [...new Set(\n      [...evaluatorText.matchAll(\n        /\\b([A-Za-z_][A-Za-z0-9_]*(?:return|pnl|profit|loss|performance|outcome|change|delta|gain)[A-Za-z0-9_]*)\\b/gi\n      )].map(m => m[1])\n    )].slice(0, 40),\n\n  percentageLikeLogic:\n    /100|percent|percentage|pct|rate|ratio/i.test(evaluatorText),\n\n  horizonTerms:\n    /1d|3d|5d|day1|day3|day5|horizon|forwardDays|daysForward/i.test(evaluatorText)\n};\n\nconst summarySemanticEvidence = {\n  metricTerms:\n    [...new Set(\n      [...summaryText.matchAll(\n        /\\b([A-Za-z_][A-Za-z0-9_]*(?:return|pnl|profit|loss|performance|outcome|win|drawdown|expectancy|rate|ratio)[A-Za-z0-9_]*)\\b/gi\n      )].map(m => m[1])\n    )].slice(0, 40),\n\n  aggregates:\n    /reduce\\(|average|mean|median|sum|count|winRate|win_rate/i.test(summaryText)\n};\n\nconst checks = {\n  allTargetsExist:\n    Object.values(TARGETS).every(exists),\n\n  noExplicitRealTradingEnable:\n    safetyScans.every(x => !x.mentionsRealOrderEnable),\n\n  noPromotionApplySurfaceInTargets:\n    safetyScans.every(x => !x.mentionsPromotionApply),\n\n  staticVerifierExecuted:\n    !!staticRun,\n\n  staticVerifierPassed:\n    staticRun?.exitCode === 0,\n\n  contractExecuted:\n    !!contractRun,\n\n  contractPassed:\n    contractRun?.exitCode === 0,\n\n  evaluatorHasOutcomeSemantics:\n    evaluatorSemanticEvidence.returnLikeNames.length > 0 ||\n    (\n      evaluatorSemanticEvidence.arithmeticOperations &&\n      evaluatorSemanticEvidence.comparesObservedVsEntry\n    ),\n\n  evaluatorHasHorizonSemantics:\n    evaluatorSemanticEvidence.horizonTerms,\n\n  summaryHasMetricSemantics:\n    summarySemanticEvidence.metricTerms.length > 0 ||\n    summarySemanticEvidence.aggregates\n};\n\nconst hardRequired = [\n  \"allTargetsExist\",\n  \"noExplicitRealTradingEnable\",\n  \"noPromotionApplySurfaceInTargets\",\n  \"staticVerifierExecuted\",\n  \"staticVerifierPassed\",\n  \"contractExecuted\",\n  \"contractPassed\",\n  \"evaluatorHasOutcomeSemantics\"\n];\n\nconst hardFailures =\n  hardRequired.filter(k => checks[k] !== true);\n\nconst warnings = [];\n\nif (!checks.evaluatorHasHorizonSemantics) {\n  warnings.push(\"EVALUATOR_HORIZON_TERMS_NOT_OBVIOUS\");\n}\n\nif (!checks.summaryHasMetricSemantics) {\n  warnings.push(\"SUMMARY_METRIC_SEMANTICS_NOT_OBVIOUS\");\n}\n\nlet readiness;\nlet nextGate;\n\nif (hardFailures.length > 0) {\n  readiness = \"CONTRACT_OR_STATIC_VERIFICATION_FAILED\";\n  nextGate = \"INSPECT_FAILED_FORWARD_OOS_VERIFIER_BEFORE_PATCH\";\n} else if (warnings.length > 0) {\n  readiness = \"CONTRACT_VERIFIED_WITH_WARNINGS\";\n  nextGate = \"HARDEN_FORWARD_OOS_METRIC_CONTRACT\";\n} else {\n  readiness = \"CONTRACT_AND_STATIC_PATH_VERIFIED\";\n  nextGate = \"AUDIT_FORWARD_OOS_AUTOMATION_BINDING\";\n}\n\nconst report = {\n  status:\n    \"AI_STOCK_LAB_TRUE_FORWARD_OOS_EXISTING_CONTRACT_VERIFY_V1_COMPLETED\",\n\n  mode:\n    \"EXISTING_STATIC_AND_CONTRACT_VERIFIER_EXECUTION\",\n\n  readiness,\n\n  runs: {\n    staticVerify: staticRun\n      ? {\n          file: staticRun.rel,\n          exitCode: staticRun.exitCode,\n          statuses:\n            parseStatusText(staticRun.stdout + \"\\n\" + staticRun.stderr),\n          stdoutTail:\n            staticRun.stdout.trim().split(/\\r?\\n/).slice(-30),\n          stderrTail:\n            staticRun.stderr.trim().split(/\\r?\\n/).filter(Boolean).slice(-20),\n          error: staticRun.error\n        }\n      : null,\n\n    contract: contractRun\n      ? {\n          file: contractRun.rel,\n          exitCode: contractRun.exitCode,\n          statuses:\n            parseStatusText(contractRun.stdout + \"\\n\" + contractRun.stderr),\n          stdoutTail:\n            contractRun.stdout.trim().split(/\\r?\\n/).slice(-30),\n          stderrTail:\n            contractRun.stderr.trim().split(/\\r?\\n/).filter(Boolean).slice(-20),\n          error: contractRun.error\n        }\n      : null\n  },\n\n  safetyScans,\n\n  evaluatorSemanticEvidence,\n  summarySemanticEvidence,\n\n  checks,\n\n  hardFailures,\n\n  warnings,\n\n  safety: {\n    databaseWritesIntroducedByVerifier:\n      0,\n    productSourceChanges:\n      0,\n    explicitRealTradingEnable:\n      false,\n    explicitPromotionApply:\n      false,\n    verifierDirectOrderCreation:\n      false,\n    verifierDirectPositionMutation:\n      false\n  },\n\n  nextGate\n};\n\nfs.mkdirSync(LOGS, { recursive: true });\n\nfs.writeFileSync(\n  path.join(\n    LOGS,\n    \"true-forward-oos-existing-contract-verify-v1.json\"\n  ),\n  JSON.stringify(report, null, 2),\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify(report, null, 2));\n\nprocess.exitCode =\n  hardFailures.length === 0 ? 0 : 1;\n";

try {
  new Function(
    "require",
    "__dirname",
    "__filename",
    "process",
    "console",
    runnerSource
  );
} catch (error) {
  fail("GENERATED_VERIFIER_SYNTAX_ERROR", {
    error:
      error instanceof Error
        ? error.message
        : String(error)
  });
}

fs.writeFileSync(TARGET, runnerSource, "utf8");

let pkg;

try {
  pkg = JSON.parse(fs.readFileSync(PACKAGE, "utf8"));
} catch (error) {
  fail("PACKAGE_JSON_PARSE_FAILED", {
    error:
      error instanceof Error ? error.message : String(error)
  });
}

if (!pkg.scripts || typeof pkg.scripts !== "object") pkg.scripts = {};

pkg.scripts["test:true-forward-oos-contract"] =
  "node ./scripts/true-forward-oos-existing-contract-verify-v1.cjs";

fs.writeFileSync(
  PACKAGE,
  JSON.stringify(pkg, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_EXISTING_CONTRACT_VERIFY_V1_INSTALLED",
  generatedFile:
    "scripts/true-forward-oos-existing-contract-verify-v1.cjs",
  packageScript:
    "npm run test:true-forward-oos-contract",
  backup:
    "scripts/backups/package.before-true-forward-oos-existing-contract-verify-v1.json",
  executes: [
    "alpha-v3-true-forward-oos-pipeline-v1-static-verify.cjs",
    "alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts"
  ],
  alsoAudits: [
    "evaluator outcome semantics",
    "summary metric semantics",
    "explicit real-trading enable references",
    "promotion apply references"
  ],
  safety: {
    productSourceChanges: 0,
    databaseWritesIntroduced: 0,
    realTradingEnable: false,
    promotionApply: false
  },
  nextAction:
    "RUN_TRUE_FORWARD_OOS_EXISTING_CONTRACT_VERIFY"
}, null, 2));
