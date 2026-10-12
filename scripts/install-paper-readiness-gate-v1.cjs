const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, "scripts");
const PACKAGE = path.join(ROOT, "package.json");
const BACKUPS = path.join(SCRIPTS, "backups");

const TARGET = path.join(
  SCRIPTS,
  "paper-readiness-gate-v1.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_READINESS_GATE_V1_INSTALL_FAILED",
    reason,
    ...extra
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(SCRIPTS)) {
  fail("SCRIPTS_DIRECTORY_NOT_FOUND");
}

if (!fs.existsSync(PACKAGE)) {
  fail("PACKAGE_JSON_NOT_FOUND");
}

const requiredFiles = [
  "scripts/governance-regression-suite-v1.cjs",
  "scripts/model-shadow-canonical-lifecycle-watch-v1.ts",
  "scripts/model-promotion-manual-paper-apply-fail-closed-regression-v1.ts",
  "scripts/model-promotion-manual-explicit-confirmation-regression-v1.ts",
  "scripts/model-promotion-manual-apply-route-dry-run-contract-v1.ts",
  "scripts/model-promotion-manual-paper-apply-typecheck-v1.cjs"
];

const missing = requiredFiles.filter(
  (rel) => !fs.existsSync(path.join(ROOT, rel))
);

if (missing.length > 0) {
  fail("REQUIRED_GOVERNANCE_ARTIFACTS_MISSING", {
    missing
  });
}

fs.mkdirSync(BACKUPS, { recursive: true });

const packageBackup = path.join(
  BACKUPS,
  "package.before-paper-readiness-gate-v1.json"
);

if (!fs.existsSync(packageBackup)) {
  fs.copyFileSync(PACKAGE, packageBackup);
}

const runnerSource = "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst { spawnSync } = require(\"child_process\");\n\nconst ROOT = process.cwd();\nconst SCRIPTS = path.join(ROOT, \"scripts\");\nconst LOGS = path.join(ROOT, \"logs\");\n\nconst GOVERNANCE_RUNNER = path.join(\n  SCRIPTS,\n  \"governance-regression-suite-v1.cjs\"\n);\n\nconst GOVERNANCE_LOG = path.join(\n  LOGS,\n  \"governance-regression-suite-v1.json\"\n);\n\nconst READINESS_LOG = path.join(\n  LOGS,\n  \"paper-readiness-gate-v1.json\"\n);\n\nfunction readText(rel) {\n  const full = path.join(ROOT, rel);\n  if (!fs.existsSync(full)) {\n    return {\n      exists: false,\n      text: \"\",\n      full\n    };\n  }\n\n  return {\n    exists: true,\n    text: fs.readFileSync(full, \"utf8\"),\n    full\n  };\n}\n\nfunction runGovernance() {\n  if (!fs.existsSync(GOVERNANCE_RUNNER)) {\n    return {\n      exitCode: 1,\n      error: \"GOVERNANCE_RUNNER_NOT_FOUND\"\n    };\n  }\n\n  const result = spawnSync(\n    process.execPath,\n    [GOVERNANCE_RUNNER],\n    {\n      cwd: ROOT,\n      encoding: \"utf8\",\n      shell: false,\n      env: process.env,\n      maxBuffer: 24 * 1024 * 1024\n    }\n  );\n\n  return {\n    exitCode:\n      typeof result.status === \"number\"\n        ? result.status\n        : 1,\n    stdout: result.stdout || \"\",\n    stderr: result.stderr || \"\",\n    error: result.error\n      ? String(result.error.message || result.error)\n      : null\n  };\n}\n\nconst governanceRun = runGovernance();\n\nlet governance = null;\n\nif (fs.existsSync(GOVERNANCE_LOG)) {\n  try {\n    governance = JSON.parse(\n      fs.readFileSync(GOVERNANCE_LOG, \"utf8\")\n    );\n  } catch {\n    governance = null;\n  }\n}\n\nconst governanceResults =\n  Array.isArray(governance?.results)\n    ? governance.results\n    : [];\n\nfunction resultById(id) {\n  return governanceResults.find(\n    (item) => item && item.id === id\n  ) || null;\n}\n\nconst files = {\n  paperOrderRoute:\n    readText(\"app/api/orders/paper/route.ts\"),\n  riskValidateRoute:\n    readText(\"app/api/risk/validate/route.ts\"),\n  automationRoute:\n    readText(\"app/api/trading/automation/run/route.ts\"),\n  promotionApplyRoute:\n    readText(\"app/api/models/promotion/apply/route.ts\"),\n  manualApplyService:\n    readText(\"lib/models/model-promotion-manual-apply.ts\"),\n  promotionDecisionService:\n    readText(\"lib/models/model-promotion-decision-service.ts\")\n};\n\nconst manualSurfaceText =\n  files.manualApplyService.text +\n  \"\\n\" +\n  files.promotionApplyRoute.text;\n\nconst requiredPhrase =\n  \"PROMOTE_SHADOW_TO_PAPER\";\n\nconst staticChecks = {\n  governanceSuiteExecuted:\n    governanceRun.exitCode === 0 &&\n    !!governance,\n\n  governanceSystemSafe:\n    governance?.summary?.systemStatus === \"SAFE\" &&\n    Number(governance?.summary?.fail ?? 999) === 0,\n\n  purposeGatePass:\n    resultById(\"PURPOSE_GATE\")?.verdict === \"PASS\",\n\n  shadowSignalReadinessPass:\n    resultById(\"SHADOW_SIGNAL_READINESS\")?.verdict === \"PASS\",\n\n  canonicalEvidenceFailClosedPass:\n    resultById(\"CANONICAL_EVIDENCE_FAIL_CLOSED\")?.verdict === \"PASS\",\n\n  shadowToPaperRuntimeFailClosedPass:\n    resultById(\"SHADOW_TO_PAPER_RUNTIME_FAIL_CLOSED\")?.verdict === \"PASS\",\n\n  recommendationRecordingSafetyPass:\n    resultById(\"RECOMMENDATION_RECORDING_SAFETY\")?.verdict === \"PASS\",\n\n  paperPromotionApplyBoundaryPass:\n    resultById(\"PAPER_PROMOTION_APPLY_BOUNDARY\")?.verdict === \"PASS\",\n\n  manualPaperApplyFailClosedPass:\n    resultById(\"MANUAL_PAPER_APPLY_FAIL_CLOSED\")?.verdict === \"PASS\",\n\n  manualExplicitConfirmationPass:\n    resultById(\"MANUAL_EXPLICIT_CONFIRMATION\")?.verdict === \"PASS\",\n\n  manualApplyRouteDryRunPass:\n    resultById(\"MANUAL_APPLY_ROUTE_DRY_RUN\")?.verdict === \"PASS\",\n\n  manualPaperApplyTypecheckPass:\n    resultById(\"MANUAL_PAPER_APPLY_TYPECHECK\")?.verdict === \"PASS\",\n\n  paperOrderRouteExists:\n    files.paperOrderRoute.exists,\n\n  riskValidateRouteExists:\n    files.riskValidateRoute.exists,\n\n  automationRouteExists:\n    files.automationRoute.exists,\n\n  promotionApplyRouteExists:\n    files.promotionApplyRoute.exists,\n\n  manualApplyServiceExists:\n    files.manualApplyService.exists,\n\n  explicitConfirmationPhrasePresent:\n    manualSurfaceText.includes(requiredPhrase),\n\n  manualApprovalBooleanPresent:\n    /manualApprovalConfirmed/.test(manualSurfaceText),\n\n  featureFlagPresent:\n    manualSurfaceText.includes(\n      \"ENABLE_MANUAL_MODEL_PROMOTION_APPLY\"\n    ),\n\n  paperTargetPresent:\n    /PAPER/.test(manualSurfaceText),\n\n  entryTimingPurposeGuardPresent:\n    /ENTRY_TIMING/.test(manualSurfaceText)\n};\n\nconst lifecycle =\n  resultById(\"REAL_SHADOW_CANONICAL_LIFECYCLE\");\n\nconst evidenceChecks = {\n  lifecycleScriptExecuted:\n    lifecycle?.verdict === \"WAIT\" ||\n    lifecycle?.verdict === \"PASS\",\n\n  lifecycleState:\n    lifecycle?.state || null,\n\n  realShadowEvidenceComplete:\n    lifecycle?.verdict === \"PASS\" &&\n    lifecycle?.state === \"FIRST_OUTCOME_COMPLETED\"\n};\n\nconst staticFailed =\n  Object.entries(staticChecks)\n    .filter(([, value]) => value !== true)\n    .map(([key]) => key);\n\nconst staticReady =\n  staticFailed.length === 0;\n\nconst evidenceReady =\n  evidenceChecks.realShadowEvidenceComplete === true;\n\nconst overallReady =\n  staticReady && evidenceReady;\n\nlet status;\nlet nextGate;\n\nif (!staticReady) {\n  status =\n    \"AI_STOCK_LAB_PAPER_READINESS_GATE_V1_STATIC_GAP\";\n  nextGate =\n    \"FIX_STATIC_PAPER_READINESS_GAPS_BEFORE_ADVANCING\";\n} else if (!evidenceReady) {\n  status =\n    \"AI_STOCK_LAB_PAPER_READINESS_GATE_V1_WAITING_FOR_CANONICAL_EVIDENCE\";\n  nextGate =\n    \"KEEP_SHADOW_AND_WAIT_FOR_REAL_CANONICAL_EVIDENCE\";\n} else {\n  status =\n    \"AI_STOCK_LAB_PAPER_READINESS_GATE_V1_READY_FOR_MANUAL_PROMOTION_REVIEW\";\n  nextGate =\n    \"RUN_MANUAL_PROMOTION_READY_DRY_RUN_ONLY\";\n}\n\nconst report = {\n  status,\n\n  readiness: {\n    staticReady,\n    evidenceReady,\n    overallReady,\n    paperPromotionCanBeConsidered:\n      overallReady\n  },\n\n  governance: {\n    exitCode:\n      governanceRun.exitCode,\n    status:\n      governance?.status || null,\n    pass:\n      governance?.summary?.pass ?? null,\n    wait:\n      governance?.summary?.wait ?? null,\n    fail:\n      governance?.summary?.fail ?? null,\n    systemStatus:\n      governance?.summary?.systemStatus ?? null\n  },\n\n  staticChecks,\n\n  evidenceChecks,\n\n  failedStaticChecks:\n    staticFailed,\n\n  contract: {\n    requiredPromotionStage:\n      \"SHADOW\",\n    targetPromotionStage:\n      \"PAPER\",\n    requiredModelPurpose:\n      \"ENTRY_TIMING\",\n    manualApprovalRequired:\n      true,\n    exactConfirmationPhrase:\n      requiredPhrase,\n    canonicalEvidenceRequired:\n      true,\n    featureFlagRequiredForActualApply:\n      true,\n    actualApplyExecutedByThisGate:\n      false\n  },\n\n  safety: {\n    mode:\n      \"READ_ONLY_READINESS_AUDIT\",\n    databaseWrites:\n      0,\n    syntheticSignals:\n      0,\n    promotionApplyExecuted:\n      false,\n    orderCreation:\n      false,\n    positionChange:\n      false,\n    controlsChange:\n      false,\n    realTradingEnable:\n      false\n  },\n\n  nextGate\n};\n\nfs.mkdirSync(LOGS, { recursive: true });\n\nfs.writeFileSync(\n  READINESS_LOG,\n  JSON.stringify(report, null, 2),\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(report, null, 2)\n);\n\nprocess.exitCode =\n  staticReady ? 0 : 1;\n";

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
  fail("GENERATED_READINESS_GATE_SYNTAX_ERROR", {
    error:
      error instanceof Error
        ? error.message
        : String(error)
  });
}

fs.writeFileSync(
  TARGET,
  runnerSource,
  "utf8"
);

let pkg;

try {
  pkg = JSON.parse(
    fs.readFileSync(PACKAGE, "utf8")
  );
} catch (error) {
  fail("PACKAGE_JSON_PARSE_FAILED", {
    error:
      error instanceof Error
        ? error.message
        : String(error)
  });
}

if (!pkg.scripts || typeof pkg.scripts !== "object") {
  pkg.scripts = {};
}

pkg.scripts["test:paper-readiness"] =
  "node ./scripts/paper-readiness-gate-v1.cjs";

fs.writeFileSync(
  PACKAGE,
  JSON.stringify(pkg, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_PAPER_READINESS_GATE_V1_INSTALLED",

  generatedFile:
    "scripts/paper-readiness-gate-v1.cjs",

  packageScript:
    "npm run test:paper-readiness",

  backup:
    "scripts/backups/package.before-paper-readiness-gate-v1.json",

  checks: [
    "GOVERNANCE_SUITE_SAFE",
    "PURPOSE_GATE",
    "CANONICAL_FAIL_CLOSED",
    "SHADOW_TO_PAPER_FAIL_CLOSED",
    "MANUAL_APPLY_BOUNDARY",
    "EXPLICIT_CONFIRMATION",
    "API_DRY_RUN",
    "TYPECHECK",
    "PAPER_ORDER_ROUTE",
    "RISK_VALIDATE_ROUTE",
    "AUTOMATION_ROUTE",
    "MANUAL_APPLY_SURFACE",
    "FEATURE_FLAG",
    "REAL_SHADOW_CANONICAL_EVIDENCE"
  ],

  safety: {
    databaseWrites: 0,
    promotionApplyExecuted: false,
    orderCreation: false,
    positionChange: false,
    realTradingEnable: false
  },

  nextAction:
    "RUN_PAPER_READINESS_GATE"
}, null, 2));
