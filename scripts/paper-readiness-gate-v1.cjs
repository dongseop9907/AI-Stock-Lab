const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, "scripts");
const LOGS = path.join(ROOT, "logs");

const GOVERNANCE_RUNNER = path.join(
  SCRIPTS,
  "governance-regression-suite-v1.cjs"
);

const GOVERNANCE_LOG = path.join(
  LOGS,
  "governance-regression-suite-v1.json"
);

const READINESS_LOG = path.join(
  LOGS,
  "paper-readiness-gate-v1.json"
);

function readText(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    return {
      exists: false,
      text: "",
      full
    };
  }

  return {
    exists: true,
    text: fs.readFileSync(full, "utf8"),
    full
  };
}

function runGovernance() {
  if (!fs.existsSync(GOVERNANCE_RUNNER)) {
    return {
      exitCode: 1,
      error: "GOVERNANCE_RUNNER_NOT_FOUND"
    };
  }

  const result = spawnSync(
    process.execPath,
    [GOVERNANCE_RUNNER],
    {
      cwd: ROOT,
      encoding: "utf8",
      shell: false,
      env: process.env,
      maxBuffer: 24 * 1024 * 1024
    }
  );

  return {
    exitCode:
      typeof result.status === "number"
        ? result.status
        : 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error
      ? String(result.error.message || result.error)
      : null
  };
}

const governanceRun = runGovernance();

let governance = null;

if (fs.existsSync(GOVERNANCE_LOG)) {
  try {
    governance = JSON.parse(
      fs.readFileSync(GOVERNANCE_LOG, "utf8")
    );
  } catch {
    governance = null;
  }
}

const governanceResults =
  Array.isArray(governance?.results)
    ? governance.results
    : [];

function resultById(id) {
  return governanceResults.find(
    (item) => item && item.id === id
  ) || null;
}

const files = {
  paperOrderRoute:
    readText("app/api/orders/paper/route.ts"),
  riskValidateRoute:
    readText("app/api/risk/validate/route.ts"),
  automationRoute:
    readText("app/api/trading/automation/run/route.ts"),
  promotionApplyRoute:
    readText("app/api/models/promotion/apply/route.ts"),
  manualApplyService:
    readText("lib/models/model-promotion-manual-apply.ts"),
  promotionDecisionService:
    readText("lib/models/model-promotion-decision-service.ts")
};

const manualSurfaceText =
  files.manualApplyService.text +
  "\n" +
  files.promotionApplyRoute.text;

const requiredPhrase =
  "PROMOTE_SHADOW_TO_PAPER";

const staticChecks = {
  governanceSuiteExecuted:
    governanceRun.exitCode === 0 &&
    !!governance,

  governanceSystemSafe:
    governance?.summary?.systemStatus === "SAFE" &&
    Number(governance?.summary?.fail ?? 999) === 0,

  purposeGatePass:
    resultById("PURPOSE_GATE")?.verdict === "PASS",

  shadowSignalReadinessPass:
    resultById("SHADOW_SIGNAL_READINESS")?.verdict === "PASS",

  canonicalEvidenceFailClosedPass:
    resultById("CANONICAL_EVIDENCE_FAIL_CLOSED")?.verdict === "PASS",

  shadowToPaperRuntimeFailClosedPass:
    resultById("SHADOW_TO_PAPER_RUNTIME_FAIL_CLOSED")?.verdict === "PASS",

  recommendationRecordingSafetyPass:
    resultById("RECOMMENDATION_RECORDING_SAFETY")?.verdict === "PASS",

  paperPromotionApplyBoundaryPass:
    resultById("PAPER_PROMOTION_APPLY_BOUNDARY")?.verdict === "PASS",

  manualPaperApplyFailClosedPass:
    resultById("MANUAL_PAPER_APPLY_FAIL_CLOSED")?.verdict === "PASS",

  manualExplicitConfirmationPass:
    resultById("MANUAL_EXPLICIT_CONFIRMATION")?.verdict === "PASS",

  manualApplyRouteDryRunPass:
    resultById("MANUAL_APPLY_ROUTE_DRY_RUN")?.verdict === "PASS",

  manualPaperApplyTypecheckPass:
    resultById("MANUAL_PAPER_APPLY_TYPECHECK")?.verdict === "PASS",

  paperOrderRouteExists:
    files.paperOrderRoute.exists,

  riskValidateRouteExists:
    files.riskValidateRoute.exists,

  automationRouteExists:
    files.automationRoute.exists,

  promotionApplyRouteExists:
    files.promotionApplyRoute.exists,

  manualApplyServiceExists:
    files.manualApplyService.exists,

  explicitConfirmationPhrasePresent:
    manualSurfaceText.includes(requiredPhrase),

  manualApprovalBooleanPresent:
    /manualApprovalConfirmed/.test(manualSurfaceText),

  featureFlagPresent:
    manualSurfaceText.includes(
      "ENABLE_MANUAL_MODEL_PROMOTION_APPLY"
    ),

  paperTargetPresent:
    /PAPER/.test(manualSurfaceText),

  entryTimingPurposeGuardPresent:
    /ENTRY_TIMING/.test(manualSurfaceText)
};

const lifecycle =
  resultById("REAL_SHADOW_CANONICAL_LIFECYCLE");

const evidenceChecks = {
  lifecycleScriptExecuted:
    lifecycle?.verdict === "WAIT" ||
    lifecycle?.verdict === "PASS",

  lifecycleState:
    lifecycle?.state || null,

  realShadowEvidenceComplete:
    lifecycle?.verdict === "PASS" &&
    lifecycle?.state === "FIRST_OUTCOME_COMPLETED"
};

const staticFailed =
  Object.entries(staticChecks)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);

const staticReady =
  staticFailed.length === 0;

const evidenceReady =
  evidenceChecks.realShadowEvidenceComplete === true;

const overallReady =
  staticReady && evidenceReady;

let status;
let nextGate;

if (!staticReady) {
  status =
    "AI_STOCK_LAB_PAPER_READINESS_GATE_V1_STATIC_GAP";
  nextGate =
    "FIX_STATIC_PAPER_READINESS_GAPS_BEFORE_ADVANCING";
} else if (!evidenceReady) {
  status =
    "AI_STOCK_LAB_PAPER_READINESS_GATE_V1_WAITING_FOR_CANONICAL_EVIDENCE";
  nextGate =
    "KEEP_SHADOW_AND_WAIT_FOR_REAL_CANONICAL_EVIDENCE";
} else {
  status =
    "AI_STOCK_LAB_PAPER_READINESS_GATE_V1_READY_FOR_MANUAL_PROMOTION_REVIEW";
  nextGate =
    "RUN_MANUAL_PROMOTION_READY_DRY_RUN_ONLY";
}

const report = {
  status,

  readiness: {
    staticReady,
    evidenceReady,
    overallReady,
    paperPromotionCanBeConsidered:
      overallReady
  },

  governance: {
    exitCode:
      governanceRun.exitCode,
    status:
      governance?.status || null,
    pass:
      governance?.summary?.pass ?? null,
    wait:
      governance?.summary?.wait ?? null,
    fail:
      governance?.summary?.fail ?? null,
    systemStatus:
      governance?.summary?.systemStatus ?? null
  },

  staticChecks,

  evidenceChecks,

  failedStaticChecks:
    staticFailed,

  contract: {
    requiredPromotionStage:
      "SHADOW",
    targetPromotionStage:
      "PAPER",
    requiredModelPurpose:
      "ENTRY_TIMING",
    manualApprovalRequired:
      true,
    exactConfirmationPhrase:
      requiredPhrase,
    canonicalEvidenceRequired:
      true,
    featureFlagRequiredForActualApply:
      true,
    actualApplyExecutedByThisGate:
      false
  },

  safety: {
    mode:
      "READ_ONLY_READINESS_AUDIT",
    databaseWrites:
      0,
    syntheticSignals:
      0,
    promotionApplyExecuted:
      false,
    orderCreation:
      false,
    positionChange:
      false,
    controlsChange:
      false,
    realTradingEnable:
      false
  },

  nextGate
};

fs.mkdirSync(LOGS, { recursive: true });

fs.writeFileSync(
  READINESS_LOG,
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(
  JSON.stringify(report, null, 2)
);

process.exitCode =
  staticReady ? 0 : 1;
