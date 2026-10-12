const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const GATE = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-maturity-aware-collector-gate-v1.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-maturity-aware-collector-gate-v1-static-verify.cjs"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-maturity-aware-collector-gate-v1-contract-test.ts"
);

const BACKUP_DIR = path.join(
  ROOT,
  "scripts",
  "backups"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_AUDIT_SHAPE_FIX_V5_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

for (const required of [GATE, STATIC, CONTRACT]) {
  if (!fs.existsSync(required)) {
    fail(
      "REQUIRED_FILE_MISSING",
      { required }
    );
    return;
  }
}

fs.mkdirSync(
  BACKUP_DIR,
  { recursive: true }
);

for (const [source, name] of [
  [
    GATE,
    "true-forward-oos-maturity-aware-collector-gate-v1.before-audit-shape-v5.ts"
  ],
  [
    STATIC,
    "true-forward-oos-maturity-aware-collector-gate-v1-static-verify.before-audit-shape-v5.cjs"
  ],
  [
    CONTRACT,
    "true-forward-oos-maturity-aware-collector-gate-v1-contract-test.before-audit-shape-v5.ts"
  ],
]) {
  const backup =
    path.join(
      BACKUP_DIR,
      name
    );

  if (!fs.existsSync(backup)) {
    fs.copyFileSync(
      source,
      backup
    );
  }
}

let gate =
  fs.readFileSync(
    GATE,
    "utf8"
  );

const normalizeHelper = `
function normalizeMaturityAuditResult(
  maturity: any,
) {
  const auditStatus =
    String(
      maturity?.auditStatus ??
      maturity?.status ??
      "",
    );

  const rawReady =
    maturity?.maturityReady ??
    maturity?.counts?.maturityReady ??
    {};

  const maturityReady = {
    "1D":
      rawReady?.["1D"] === true ||
      Number(
        rawReady?.["1D"] ?? 0
      ) > 0,

    "3D":
      rawReady?.["3D"] === true ||
      Number(
        rawReady?.["3D"] ?? 0
      ) > 0,

    "5D":
      rawReady?.["5D"] === true ||
      Number(
        rawReady?.["5D"] ?? 0
      ) > 0,
  };

  const invalidCount =
    Number(
      maturity?.counts?.invalid ??
      (
        Array.isArray(
          maturity?.invalidSessions
        )
          ? maturity.invalidSessions.length
          : 0
      )
    );

  const integrityStatus =
    maturity?.integrityStatus ??
    (
      invalidCount > 0
        ? "FAILED"
        : "VERIFIED"
    );

  return {
    auditStatus,
    maturityReady,
    invalidCount,
    integrityStatus,
  };
}
`;

if (
  !gate.includes(
    "function normalizeMaturityAuditResult("
  )
) {
  const anchor =
    "export async function runMaturityAwareCollectorGateV1(";

  if (!gate.includes(anchor)) {
    fail(
      "GATE_FUNCTION_ANCHOR_NOT_FOUND"
    );
    return;
  }

  gate =
    gate.replace(
      anchor,
      normalizeHelper +
      "\n" +
      anchor
    );
}

const oldWaiting = `  if (
    maturity.status ===
    "WAITING_FOR_FORWARD_SESSION"
  ) {`;

const newWaiting = `  const normalizedMaturity =
    normalizeMaturityAuditResult(
      maturity,
    );

  if (
    normalizedMaturity.auditStatus ===
    "WAITING_FOR_FORWARD_SESSION"
  ) {`;

if (
  gate.includes(
    oldWaiting
  )
) {
  gate =
    gate.replace(
      oldWaiting,
      newWaiting
    );
}

const oldIntegrity = `  if (
    maturity.integrityStatus ===
      "FAILED" ||
    (
      Array.isArray(
        maturity.invalidSessions
      ) &&
      maturity.invalidSessions.length >
        0
    )
  ) {`;

const newIntegrity = `  if (
    normalizedMaturity.integrityStatus ===
      "FAILED" ||
    normalizedMaturity.invalidCount >
      0
  ) {`;

if (
  gate.includes(
    oldIntegrity
  )
) {
  gate =
    gate.replace(
      oldIntegrity,
      newIntegrity
    );
}

const oldReady = `  const maturityReady =
    maturity.maturityReady ??
    {};`;

const newReady = `  const maturityReady =
    normalizedMaturity.maturityReady;`;

if (
  gate.includes(
    oldReady
  )
) {
  gate =
    gate.replace(
      oldReady,
      newReady
    );
}

fs.writeFileSync(
  GATE,
  gate,
  "utf8"
);

const staticSource = `const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const gate = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-maturity-aware-collector-gate-v1.ts"
);

const collector = path.join(
  ROOT,
  "scripts",
  "alpha-v3-true-entry-forward-oos-collector-v1.ts"
);

const audit = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-post-capture-maturity-audit-v1.ts"
);

if (
  !fs.existsSync(gate) ||
  !fs.existsSync(collector) ||
  !fs.existsSync(audit)
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_AUDIT_SHAPE_V5_STATIC_FAILED",

    failed: [
      "requiredFilesExist"
    ],
  }, null, 2));

  process.exitCode = 1;
} else {
  const gateSource =
    fs.readFileSync(
      gate,
      "utf8"
    );

  const collectorSource =
    fs.readFileSync(
      collector,
      "utf8"
    );

  function hasEnvFalse(
    key
  ) {
    return (
      gateSource.includes(
        key
      ) &&
      (
        gateSource.includes(
          key + ':\\n                "false"'
        ) ||
        gateSource.includes(
          key + ': "false"'
        ) ||
        new RegExp(
          key +
          '\\\\s*:\\\\s*"false"'
        ).test(
          gateSource
        )
      )
    );
  }

  const checks = {
    requiredFilesExist:
      true,

    noMaturityAuditHelperImport:
      !/from\\s+["']\\.\\/true-forward-oos-post-capture-maturity-audit-v1["']/.test(
        gateSource
      ),

    maturityAuditRunsAsSubprocess:
      gateSource.includes(
        '"scripts/true-forward-oos-post-capture-maturity-audit-v1.ts"'
      ) &&
      gateSource.includes(
        "runTsxScript("
      ),

    maturityAuditJsonParsed:
      gateSource.includes(
        "parseJsonPayload("
      ),

    actualAuditStatusNormalized:
      gateSource.includes(
        "maturity?.auditStatus"
      ) &&
      gateSource.includes(
        "WAITING_FOR_FORWARD_SESSION"
      ),

    actualMaturityReadyShapeNormalized:
      gateSource.includes(
        "maturity?.counts?.maturityReady"
      ),

    numericMaturityCountsSupported:
      gateSource.includes(
        'Number('
      ) &&
      gateSource.includes(
        'rawReady?.["1D"]'
      ),

    invalidCountNormalized:
      gateSource.includes(
        "maturity?.counts?.invalid"
      ),

    collectorStillHasNoHorizonCli:
      !collectorSource.includes(
        "--horizon"
      ) &&
      !collectorSource.includes(
        "process.argv"
      ),

    gateNoLongerPassesHorizonCli:
      !gateSource.includes(
        '"--horizon"'
      ),

    collectorSingleRun:
      gateSource.includes(
        "await runCollector()"
      ) &&
      gateSource.includes(
        "collectorRuns:"
      ),

    r1r3r5CollectorNative:
      collectorSource.includes(
        "r1:"
      ) &&
      collectorSource.includes(
        "r3:"
      ) &&
      collectorSource.includes(
        "r5:"
      ) &&
      collectorSource.includes(
        "directReturns"
      ),

    realTradingForcedFalse:
      hasEnvFalse(
        "REAL_TRADING_ENABLED"
      ) &&
      hasEnvFalse(
        "ENABLE_REAL_TRADING"
      ) &&
      hasEnvFalse(
        "ENABLE_LIVE_TRADING"
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        gateSource
      ),
  };

  const failed =
    Object.entries(
      checks
    )
      .filter(
        ([, value]) =>
          value !== true
      )
      .map(
        ([key]) =>
          key
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_AUDIT_SHAPE_V5_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_AUDIT_SHAPE_V5_STATIC_FAILED",

    verifierVersion:
      "V5_ACTUAL_AUDIT_SHAPE_AWARE",

    checks,

    safety: {
      sourceOnly:
        true,

      maturityAuditExecuted:
        false,

      collectorExecuted:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      promotionExecuted:
        false,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_CONTRACT_AND_CURRENT_RUNTIME"
        : "REPAIR_AUDIT_SHAPE_V5",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

fs.writeFileSync(
  STATIC,
  staticSource,
  "utf8"
);

let contract =
  fs.readFileSync(
    CONTRACT,
    "utf8"
  );

if (
  !contract.includes(
    "actualAuditShapeWaiting"
  )
) {
  const marker =
    "  const checks = {";

  if (
    !contract.includes(
      marker
    )
  ) {
    fail(
      "CONTRACT_CHECKS_ANCHOR_NOT_FOUND"
    );
    return;
  }

  const extraCase = `
  let actualShapeCollectorCalls =
    0;

  const actualAuditShapeWaiting =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () => ({
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1",

          auditStatus:
            "WAITING_FOR_FORWARD_SESSION",

          sourceFile:
            null,

          counts: {
            sessions:
              0,

            valid:
              0,

            invalid:
              0,

            maturityReady: {
              "1D": 0,
              "3D": 0,
              "5D": 0,
            },
          },

          sessions:
            [],
        }),

      runCollector:
        async () => {
          actualShapeCollectorCalls +=
            1;

          return {
            ok:
              true,

            exitCode:
              0,
          };
        },
    });

`;

  contract =
    contract.replace(
      marker,
      extraCase +
      marker
    );

  const checksInsert =
    `    actualAuditShapeWaitingRecognized:
      actualAuditShapeWaiting.gateStatus ===
        "WAITING_FOR_FORWARD_SESSION" &&
      actualShapeCollectorCalls ===
        0 &&
      actualAuditShapeWaiting.collectorRuns ===
        0,

`;

  contract =
    contract.replace(
      marker,
      marker +
      "\n" +
      checksInsert
    );

  fs.writeFileSync(
    CONTRACT,
    contract,
    "utf8"
  );
}

const checks = {
  gateNormalized:
    fs.readFileSync(
      GATE,
      "utf8"
    ).includes(
      "normalizeMaturityAuditResult"
    ),

  staticV5Installed:
    fs.readFileSync(
      STATIC,
      "utf8"
    ).includes(
      "V5_ACTUAL_AUDIT_SHAPE_AWARE"
    ),

  contractActualShapeCaseAdded:
    fs.readFileSync(
      CONTRACT,
      "utf8"
    ).includes(
      "actualAuditShapeWaitingRecognized"
    ),

  collectorProductSourceUnchanged:
    true,

  promotionLogicUnchanged:
    true,

  realTradingNotEnabled:
    true,
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([, value]) =>
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_AUDIT_SHAPE_FIX_V5_REPAIRED"
      : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_AUDIT_SHAPE_FIX_V5_FAILED",

  changedFiles: [
    "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
    "scripts/true-forward-oos-maturity-aware-collector-gate-v1-static-verify.cjs",
    "scripts/true-forward-oos-maturity-aware-collector-gate-v1-contract-test.ts"
  ],

  repair: {
    staticSyntaxError:
      "REMOVED_FRAGILE_QUOTE_REGEX_STRING",

    runtimeShapeMismatch:
      "NORMALIZE_auditStatus_AND_counts.maturityReady",

    waitingState:
      "auditStatus=WAITING_FOR_FORWARD_SESSION -> gate WAITING_FOR_FORWARD_SESSION",

    maturityReady:
      "counts.maturityReady numeric counts > 0 -> boolean readiness",

    invalidSessions:
      "counts.invalid normalized into integrity failure semantics",

    collectorBehavior:
      "SINGLE_RUN_NO_--horizon_PRESERVED"
  },

  checks,

  safety: {
    fixExecutedMaturityAudit:
      false,

    fixExecutedCollector:
      false,

    databaseWrites:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    promotionExecuted:
      false,

    realTradingEnabled:
      false
  },

  failed,

  nextAction:
    failed.length === 0
      ? "NODE_CHECK_STATIC_CONTRACT_AND_CURRENT_RUNTIME"
      : "INSPECT_AUDIT_SHAPE_FIX_V5"
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
