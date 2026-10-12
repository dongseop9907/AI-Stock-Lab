const fs = require("fs");
const path = require("path");

const root = process.cwd();
const scriptsDir = path.join(root, "scripts");
const packageJsonPath = path.join(root, "package.json");

const target = path.join(
  scriptsDir,
  "true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1.cjs",
);

const requiredFiles = [
  path.join(
    scriptsDir,
    "true-forward-oos-paper-promotion-apply-approval-gate-v1.ts",
  ),
  path.join(
    scriptsDir,
    "model-promotion-manual-apply-route-dry-run-contract-v1.ts",
  ),
  path.join(
    root,
    "app",
    "api",
    "models",
    "promotion",
    "apply",
    "route.ts",
  ),
  path.join(
    root,
    "lib",
    "models",
    "model-promotion-manual-apply.ts",
  ),
];

const missing = requiredFiles
  .filter((file) => !fs.existsSync(file))
  .map((file) => path.relative(root, file).replaceAll("\\", "/"));

if (missing.length > 0) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_INSTALL_FAILED",
        reason: "REQUIRED_FILES_MISSING",
        missing,
        safety: {
          productSourceChanges: 0,
          databaseReads: 0,
          databaseWrites: 0,
          promotionExecuted: false,
          ordersCreated: 0,
          positionsChanged: 0,
          realTradingEnabled: false,
        },
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

if (!fs.existsSync(packageJsonPath)) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_INSTALL_FAILED",
        reason: "PACKAGE_JSON_NOT_FOUND",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

fs.mkdirSync(scriptsDir, { recursive: true });

const source = String.raw`const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = process.cwd();

function commandName(base) {
  return process.platform === "win32"
    ? base + ".cmd"
    : base;
}

function run(command, args) {
  const result = spawnSync(
    command,
    args,
    {
      cwd: root,
      env: process.env,
      encoding: "utf8",
      windowsHide: false,
      shell: false,
    },
  );

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";

  if (stdout) {
    process.stdout.write(stdout);
  }

  if (stderr) {
    process.stderr.write(stderr);
  }

  return {
    command,
    args,
    exitCode:
      typeof result.status === "number"
        ? result.status
        : 1,
    stdout,
    stderr,
    error:
      result.error
        ? String(result.error.message || result.error)
        : null,
  };
}

function parseLastJson(text) {
  const lines = String(text)
    .replace(/\r/g, "")
    .split("\n");

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() !== "{") {
      continue;
    }

    const candidate =
      lines.slice(i).join("\n").trim();

    try {
      return JSON.parse(candidate);
    } catch {
      // keep scanning backward
    }
  }

  return null;
}

function safeObject(value) {
  return value && typeof value === "object"
    ? value
    : {};
}

function fail(reason, details = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_FAILED",
        reason,
        ...details,
        safety: {
          promotionApplyExecuted: false,
          actualPromotionExecuted: false,
          modelStageChangedByGate: false,
          databaseWritesByGate: 0,
          ordersCreatedByGate: 0,
          positionsChangedByGate: 0,
          realTradingEnabledByGate: false,
        },
        nextGate:
          "STOP_AND_INSPECT_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE",
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
}

const approvalScript =
  path.join(
    root,
    "scripts",
    "true-forward-oos-paper-promotion-apply-approval-gate-v1.ts",
  );

const dryRunContractScript =
  path.join(
    root,
    "scripts",
    "model-promotion-manual-apply-route-dry-run-contract-v1.ts",
  );

if (
  !fs.existsSync(approvalScript) ||
  !fs.existsSync(dryRunContractScript)
) {
  fail(
    "RUNTIME_DEPENDENCY_MISSING",
    {
      approvalScriptExists:
        fs.existsSync(approvalScript),
      dryRunContractScriptExists:
        fs.existsSync(dryRunContractScript),
    },
  );
  return;
}

const approvalRun = run(
  commandName("npm"),
  [
    "run",
    "forward-oos:paper-promotion-apply-approval",
  ],
);

if (
  approvalRun.error ||
  approvalRun.exitCode !== 0
) {
  fail(
    "APPROVAL_GATE_EXECUTION_FAILED",
    {
      approvalGateExitCode:
        approvalRun.exitCode,
      spawnError:
        approvalRun.error,
    },
  );
  return;
}

const approval =
  parseLastJson(
    approvalRun.stdout,
  );

if (!approval) {
  fail(
    "APPROVAL_GATE_JSON_NOT_FOUND",
  );
  return;
}

const approvalObj =
  safeObject(approval);

const ready =
  approvalObj.readyForPromotionApplyDryRun ===
  true;

if (!ready) {
  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_WAIT",
        gateStatus:
          "WAITING_FOR_EXPLICIT_PAPER_PROMOTION_APPLY_APPROVAL_READY",
        approvalStatus:
          approvalObj.approvalStatus ?? null,
        readyForPromotionApplyDryRun:
          false,
        promotionApplyExecuted:
          false,
        dryRunExecuted:
          false,
        approval: {
          status:
            approvalObj.status ?? null,
          required:
            approvalObj.required ?? null,
          eligibility:
            approvalObj.eligibility ?? null,
          failed:
            Array.isArray(approvalObj.failed)
              ? approvalObj.failed
              : [],
        },
        safety: {
          approvalGateExecuted:
            true,
          dryRunOnly:
            true,
          routeHandlerExecutedByThisGate:
            false,
          actualPromotionExecuted:
            false,
          modelStageChangedByGate:
            false,
          databaseWritesByGate:
            0,
          ordersCreatedByGate:
            0,
          positionsChangedByGate:
            0,
          realTradingEnabledByGate:
            false,
        },
        nextGate:
          "KEEP_SHADOW_WAIT_FOR_APPROVAL_READY_AND_REAL_FORWARD_OOS_EVIDENCE",
      },
      null,
      2,
    ),
  );

  process.exitCode = 0;
  return;
}

const dryRun = run(
  commandName("npx"),
  [
    "tsx",
    "--env-file=.env.local",
    "./scripts/model-promotion-manual-apply-route-dry-run-contract-v1.ts",
  ],
);

if (
  dryRun.error ||
  dryRun.exitCode !== 0
) {
  fail(
    "DRY_RUN_CONTRACT_EXECUTION_FAILED",
    {
      dryRunExitCode:
        dryRun.exitCode,
      spawnError:
        dryRun.error,
    },
  );
  return;
}

const dryRunReport =
  parseLastJson(
    dryRun.stdout,
  );

if (!dryRunReport) {
  fail(
    "DRY_RUN_CONTRACT_JSON_NOT_FOUND",
  );
  return;
}

const report =
  safeObject(dryRunReport);

const safety =
  safeObject(
    report.safety,
  );

const checks = {
  approvalReady:
    ready === true,

  dryRunContractVerified:
    report.status ===
    "MODEL_PROMOTION_MANUAL_APPLY_ROUTE_DRY_RUN_CONTRACT_V1_VERIFIED",

  dryRunOnly:
    safety.dryRunOnly ===
    true,

  noPromotionApplied:
    safety.promotionApplied ===
    false,

  noPromotionEventsCreated:
    Number(
      safety.promotionEventsCreated ?? 0,
    ) === 0,

  noOrdersCreated:
    Number(
      safety.ordersCreated ?? 0,
    ) === 0,

  noPositionsChanged:
    Number(
      safety.positionsChanged ?? 0,
    ) === 0,

  controlsUnchanged:
    safety.controlsChanged ===
    false,

  realTradingNotEnabled:
    safety.realTradingEnabledByScript ===
    false,
};

const failed =
  Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([key]) => key);

const finalStatus =
  failed.length === 0
    ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_VERIFIED"
    : "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_FAILED";

console.log(
  JSON.stringify(
    {
      status:
        finalStatus,
      gateStatus:
        failed.length === 0
          ? "PAPER_PROMOTION_APPLY_DRY_RUN_VERIFIED"
          : "PAPER_PROMOTION_APPLY_DRY_RUN_REJECTED",
      approvalStatus:
        approvalObj.approvalStatus ?? null,
      readyForPromotionApplyDryRun:
        ready,
      dryRunExecuted:
        true,
      promotionApplyExecuted:
        false,
      checks,
      failed,
      model:
        report.model ?? null,
      routeDryRunContract: {
        status:
          report.status ?? null,
        nextGate:
          report.nextGate ?? null,
      },
      safety: {
        approvalGateExecuted:
          true,
        routeDryRunContractExecuted:
          true,
        dryRunOnly:
          true,
        actualPromotionExecuted:
          false,
        modelStageChangedByGate:
          false,
        databaseWritesByGate:
          0,
        promotionEventsCreated:
          Number(
            safety.promotionEventsCreated ?? 0,
          ),
        ordersCreated:
          Number(
            safety.ordersCreated ?? 0,
          ),
        positionsChanged:
          Number(
            safety.positionsChanged ?? 0,
          ),
        controlsChanged:
          safety.controlsChanged ?? null,
        realTradingEnabledByGate:
          false,
      },
      nextGate:
        failed.length === 0
          ? "REVIEW_FINAL_PAPER_PROMOTION_AUTHORIZATION_ONLY_AFTER_REAL_FORWARD_OOS_EVIDENCE_IS_MATURE"
          : "STOP_AND_INSPECT_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE",
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
`;

fs.writeFileSync(
  target,
  source,
  "utf8",
);

const packageJson =
  JSON.parse(
    fs.readFileSync(
      packageJsonPath,
      "utf8",
    ),
  );

packageJson.scripts =
  packageJson.scripts || {};

packageJson.scripts[
  "forward-oos:paper-promotion-apply-dry-run-only"
] =
  "node ./scripts/true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1.cjs";

fs.writeFileSync(
  packageJsonPath,
  JSON.stringify(
    packageJson,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_INSTALLED",
      generatedFile:
        "scripts/true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1.cjs",
      packageScript:
        "forward-oos:paper-promotion-apply-dry-run-only",
      purpose:
        "RUN_PROMOTION_APPLY_ROUTE_DRY_RUN_ONLY_AFTER_EXPLICIT_APPROVAL_GATE_IS_READY",
      behavior: {
        approvalNotReady:
          "WAIT_WITHOUT_CALLING_DRY_RUN_ROUTE",
        approvalReady:
          "RUN_EXISTING_MANUAL_PROMOTION_ROUTE_DRY_RUN_CONTRACT_ONLY",
        actualPromotion:
          false,
      },
      safety: {
        installerExecutedGate:
          false,
        productSourceChanges:
          0,
        databaseReads:
          0,
        databaseWrites:
          0,
        promotionExecuted:
          false,
        modelStageChanged:
          false,
        ordersCreated:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false,
      },
      nextAction:
        "RUN_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE",
    },
    null,
    2,
  ),
);
