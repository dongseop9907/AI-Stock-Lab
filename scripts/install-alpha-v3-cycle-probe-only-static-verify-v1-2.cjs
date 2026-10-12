const fs = require("fs");
const path = require("path");

const root = process.cwd();

const verifierFile = path.resolve(
  root,
  "scripts/alpha-v3-cycle-probe-only-static-verify.cjs"
);

if (!fs.existsSync(verifierFile)) {
  throw new Error(
    "PROBE_ONLY_STATIC_VERIFIER_NOT_FOUND"
  );
}

const backup =
  `${verifierFile}.before-v1-2.bak`;

if (!fs.existsSync(backup)) {
  fs.copyFileSync(
    verifierFile,
    backup
  );
}

const verifier = `const fs = require("fs");
const path = require("path");

const root = process.cwd();

const routeFile = path.resolve(
  root,
  "app/api/trading/automation/cycle/route.ts"
);

if (!fs.existsSync(routeFile)) {
  throw new Error(
    "AUTOMATION_CYCLE_ROUTE_NOT_FOUND"
  );
}

const text =
  fs.readFileSync(
    routeFile,
    "utf8"
  );

const probeMarkerIndex =
  text.indexOf(
    "ALPHA_V3_PROBE_ONLY_V1"
  );

const postFunctionIndex =
  text.indexOf(
    "export async function POST"
  );

function firstCallIndexAfterPost(
  callText
) {
  if (postFunctionIndex < 0) {
    return -1;
  }

  return text.indexOf(
    callText,
    postFunctionIndex
  );
}

const maintenanceCallIndex =
  firstCallIndexAfterPost(
    "runCommittedRiskMaintenance("
  );

const executorCallIndex =
  firstCallIndexAfterPost(
    "executeApprovedPaperOrders("
  );

const automationRunIndex =
  firstCallIndexAfterPost(
    "/api/trading/automation/run"
  );

const checks = {
  postFunctionFound:
    postFunctionIndex >= 0,

  probeMarkerPresent:
    probeMarkerIndex >= 0,

  usesRequestClone:
    text.includes(
      "request\\n      .clone()"
    ) ||
    text.includes(
      "request.clone()"
    ) ||
    text.includes(
      "request\\r\\n      .clone()"
    ),

  probeOnlyStrictTrue:
    text.includes(
      ".probeOnly === true"
    ) ||
    text.includes(
      ".probeOnly\\n      === true"
    ) ||
    text.includes(
      ".probeOnly\\r\\n      === true"
    ),

  requiresTradingAutomationSecret:
    probeMarkerIndex >= 0 &&
    text.indexOf(
      "TRADING_AUTOMATION_SECRET",
      probeMarkerIndex
    ) >= 0,

  requiresSecretHeader:
    probeMarkerIndex >= 0 &&
    text.indexOf(
      "x-automation-secret",
      probeMarkerIndex
    ) >= 0,

  unauthorizedProbeReturns401:
    text.includes(
      "UNAUTHORIZED_AUTOMATION_CYCLE_PROBE"
    ) &&
    text.includes(
      "status: 401"
    ),

  probeSuccessReturns200:
    text.includes(
      "AUTOMATION_CYCLE_ROUTE_REACHABLE"
    ) &&
    text.includes(
      "status: 200"
    ),

  probeDeclaresZeroOrderSideEffects:
    text.includes(
      "ordersCreated:\\n            0"
    ) ||
    text.includes(
      "ordersCreated: 0"
    ) ||
    text.includes(
      "ordersCreated:\\r\\n            0"
    ),

  maintenanceCallFound:
    maintenanceCallIndex >= 0,

  approvedExecutorCallFound:
    executorCallIndex >= 0,

  automationRunPathFound:
    automationRunIndex >= 0,

  probeBranchBeforeMaintenanceCall:
    probeMarkerIndex >= 0 &&
    maintenanceCallIndex >= 0 &&
    probeMarkerIndex <
      maintenanceCallIndex,

  probeBranchBeforeAutomationRun:
    probeMarkerIndex >= 0 &&
    automationRunIndex >= 0 &&
    probeMarkerIndex <
      automationRunIndex,

  probeBranchBeforeApprovedExecutorCall:
    probeMarkerIndex >= 0 &&
    executorCallIndex >= 0 &&
    probeMarkerIndex <
      executorCallIndex,
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) =>
        !value
    )
    .map(
      ([key]) =>
        key
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_CYCLE_PROBE_ONLY_STATIC_VERIFIED"
          : "ALPHA_V3_CYCLE_PROBE_ONLY_STATIC_REVIEW",

      checks,
      failed,

      indexes: {
        postFunctionIndex,
        probeMarkerIndex,
        maintenanceCallIndex,
        automationRunIndex,
        executorCallIndex,
      },

      verifierFix:
        "NO_REGEX_FOR_POST_OR_CALL_POSITION_DETECTION",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        cyclePostRequests: 0,
        ordersCreated: 0,
        positionsChanged: 0,
      },

      nextGate:
        failed.length === 0
          ? "RUN_PROBE_ONLY_LIVE_SMOKE"
          : "REVIEW_PROBE_ONLY_ROUTE_STRUCTURE",
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
`;

fs.writeFileSync(
  verifierFile,
  verifier,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_CYCLE_PROBE_ONLY_STATIC_VERIFY_V1_2_INSTALLED",

      patchedFile:
        "scripts/alpha-v3-cycle-probe-only-static-verify.cjs",

      rootCause:
        "V1_1_GENERATED_DOUBLE_ESCAPED_REGEX_LITERAL",

      fix:
        "REPLACE_REGEX_POSITION_DETECTION_WITH_PLAIN_INDEXOF",

      productionRouteChanged:
        false,

      databaseWrites:
        0,

      cyclePostRequests:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      nextAction:
        "RERUN_STATIC_VERIFY_TYPECHECK_AND_LIVE_PROBE_ONLY_SMOKE"
    },
    null,
    2
  )
);
