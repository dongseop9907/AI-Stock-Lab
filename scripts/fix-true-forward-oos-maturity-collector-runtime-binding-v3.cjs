const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const GATE = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-maturity-aware-collector-gate-v1.ts"
);

const AUDIT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-post-capture-maturity-audit-v1.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-maturity-aware-collector-gate-v1-static-verify.cjs"
);

const BACKUP_DIR = path.join(
  ROOT,
  "scripts",
  "backups"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_RUNTIME_BINDING_FIX_V3_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

for (const required of [GATE, AUDIT, STATIC]) {
  if (!fs.existsSync(required)) {
    fail(
      "REQUIRED_FILE_MISSING",
      { required }
    );
    return;
  }
}

const gateBefore =
  fs.readFileSync(
    GATE,
    "utf8"
  );

const auditSource =
  fs.readFileSync(
    AUDIT,
    "utf8"
  );

function exportedCallableNames(source) {
  const names =
    new Set();

  for (
    const match of source.matchAll(
      /export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g
    )
  ) {
    names.add(
      match[1]
    );
  }

  for (
    const match of source.matchAll(
      /export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g
    )
  ) {
    names.add(
      match[1]
    );
  }

  return [
    ...names,
  ];
}

function scoreCandidate(
  source,
  name,
) {
  const start =
    source.indexOf(
      name
    );

  const segment =
    start >= 0
      ? source.slice(
          start,
          Math.min(
            source.length,
            start + 12000
          )
        )
      : "";

  let score =
    0;

  if (/post.*capture/i.test(name)) {
    score += 25;
  }

  if (/maturity/i.test(name)) {
    score += 20;
  }

  if (/audit/i.test(name)) {
    score += 15;
  }

  if (/run/i.test(name)) {
    score += 5;
  }

  if (
    segment.includes(
      "WAITING_FOR_FORWARD_SESSION"
    )
  ) {
    score += 40;
  }

  if (
    segment.includes(
      "maturityReady"
    )
  ) {
    score += 40;
  }

  if (
    segment.includes(
      "maturityCounts"
    )
  ) {
    score += 15;
  }

  if (
    segment.includes(
      "nextGate"
    )
  ) {
    score += 10;
  }

  return score;
}

const exportedCallables =
  exportedCallableNames(
    auditSource
  );

const ranked =
  exportedCallables
    .map(
      name => ({
        name,
        score:
          scoreCandidate(
            auditSource,
            name
          ),
      })
    )
    .sort(
      (a, b) =>
        b.score -
        a.score
    );

if (
  ranked.length ===
  0
) {
  fail(
    "NO_EXPORTED_CALLABLE_FOUND_IN_MATURITY_AUDIT",
    {
      audit:
        "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
    }
  );
  return;
}

const selected =
  ranked[0];

if (
  selected.score <
  40
) {
  fail(
    "MATURITY_AUDIT_EXPORT_NOT_CONFIDENTLY_IDENTIFIED",
    {
      ranked,
    }
  );
  return;
}

if (
  ranked.length >
    1 &&
  ranked[1].score ===
    selected.score
) {
  fail(
    "MATURITY_AUDIT_EXPORT_AMBIGUOUS",
    {
      ranked,
    }
  );
  return;
}

const currentBadBinding =
  "auditPostCaptureMaturityV1";

let gateAfter =
  gateBefore;

if (
  selected.name !==
  currentBadBinding
) {
  gateAfter =
    gateAfter.replaceAll(
      currentBadBinding,
      selected.name
    );
}

if (
  !gateAfter.includes(
    selected.name
  )
) {
  fail(
    "SELECTED_AUDIT_EXPORT_NOT_BOUND_IN_GATE",
    {
      selected:
        selected.name,
    }
  );
  return;
}

fs.mkdirSync(
  BACKUP_DIR,
  {
    recursive:
      true,
  }
);

const gateBackup =
  path.join(
    BACKUP_DIR,
    "true-forward-oos-maturity-aware-collector-gate-v1.before-runtime-binding-v3.ts"
  );

const staticBackup =
  path.join(
    BACKUP_DIR,
    "true-forward-oos-maturity-aware-collector-gate-v1-static-verify.before-runtime-binding-v3.cjs"
  );

if (
  !fs.existsSync(
    gateBackup
  )
) {
  fs.writeFileSync(
    gateBackup,
    gateBefore,
    "utf8"
  );
}

if (
  !fs.existsSync(
    staticBackup
  )
) {
  fs.copyFileSync(
    STATIC,
    staticBackup
  );
}

fs.writeFileSync(
  GATE,
  gateAfter,
  "utf8"
);

const selectedNameJson =
  JSON.stringify(
    selected.name
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

const expectedAuditExport =
  ${selectedNameJson};

if (
  !fs.existsSync(gate) ||
  !fs.existsSync(collector) ||
  !fs.existsSync(audit)
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_SINGLE_RUN_BINDING_V3_STATIC_FAILED",

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

  const auditSource =
    fs.readFileSync(
      audit,
      "utf8"
    );

  const auditExportPattern =
    new RegExp(
      "export\\\\s+(?:async\\\\s+)?function\\\\s+" +
      expectedAuditExport +
      "\\\\s*\\\\("
    );

  const auditConstPattern =
    new RegExp(
      "export\\\\s+const\\\\s+" +
      expectedAuditExport +
      "\\\\s*="
    );

  const forcedFalseKeys = [
    "REAL_TRADING_ENABLED",
    "ENABLE_REAL_TRADING",
    "ENABLE_LIVE_TRADING",
  ];

  const realTradingForcedFalse =
    forcedFalseKeys.every(
      key => {
        const pattern =
          new RegExp(
            key +
            "\\\\s*:\\\\s*[\\\\r\\\\n\\\\t ]*[\\"']false[\\"']"
          );

        return pattern.test(
          gateSource
        );
      }
    );

  const checks = {
    requiredFilesExist:
      true,

    actualMaturityAuditExportExists:
      auditExportPattern.test(
        auditSource
      ) ||
      auditConstPattern.test(
        auditSource
      ),

    gateBindsActualMaturityAuditExport:
      gateSource.includes(
        expectedAuditExport
      ),

    obsoleteUndefinedAuditBindingRemoved:
      expectedAuditExport ===
        "auditPostCaptureMaturityV1"
        ? true
        : !gateSource.includes(
            "auditPostCaptureMaturityV1"
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
        "\\"--horizon\\""
      ),

    collectorSpawnStillPresent:
      gateSource.includes(
        "spawn("
      ),

    collectorRunsOnceContract:
      gateSource.includes(
        "collectorRuns:"
      ) &&
      gateSource.includes(
        "await runCollector()"
      ),

    maturedHorizonsTracked:
      gateSource.includes(
        "maturedHorizons"
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

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        gateSource
      ),

    realTradingForcedFalse,
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_SINGLE_RUN_BINDING_V3_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_SINGLE_RUN_BINDING_V3_STATIC_FAILED",

    verifierVersion:
      "V3_RUNTIME_EXPORT_AWARE",

    actualMaturityAuditExport:
      expectedAuditExport,

    checks,

    diagnostics: {
      realTradingForcedFalse,
      forcedFalseKeys,
    },

    safety: {
      sourceOnly:
        true,

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
        ? "RUN_SINGLE_RUN_COLLECTOR_BINDING_CONTRACT_AND_CURRENT_RUNTIME"
        : "REPAIR_SINGLE_RUN_COLLECTOR_BINDING_V3",
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

const verification = {
  actualAuditExport:
    selected.name,

  auditExportCandidates:
    ranked,

  gateBindingChanged:
    gateBefore !==
    gateAfter,

  oldUndefinedBindingStillPresent:
    selected.name ===
      currentBadBinding
      ? false
      : gateAfter.includes(
          currentBadBinding
        ),

  staticVerifierVersionInstalled:
    fs.readFileSync(
      STATIC,
      "utf8"
    ).includes(
      "V3_RUNTIME_EXPORT_AWARE"
    ),
};

const failed = [];

if (
  verification.oldUndefinedBindingStillPresent
) {
  failed.push(
    "OLD_UNDEFINED_AUDIT_BINDING_REMAINS"
  );
}

if (
  !verification.staticVerifierVersionInstalled
) {
  failed.push(
    "STATIC_VERIFIER_V3_NOT_INSTALLED"
  );
}

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_RUNTIME_BINDING_FIX_V3_REPAIRED"
      : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_RUNTIME_BINDING_FIX_V3_FAILED",

  changedFiles: [
    "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
    "scripts/true-forward-oos-maturity-aware-collector-gate-v1-static-verify.cjs"
  ],

  backups: [
    "scripts/backups/true-forward-oos-maturity-aware-collector-gate-v1.before-runtime-binding-v3.ts",
    "scripts/backups/true-forward-oos-maturity-aware-collector-gate-v1-static-verify.before-runtime-binding-v3.cjs"
  ],

  repair: {
    runtimeFailure:
      "auditMaturity is not a function",

    rootCause:
      "GATE_IMPORTED_A_GUESSED_MATURITY_AUDIT_EXPORT_NAME",

    actualAuditExport:
      selected.name,

    bindingStrategy:
      "AUTO_DISCOVER_REAL_EXPORTED_AUDIT_FUNCTION_FROM_LOCAL_SOURCE_AND_BIND_IT",

    staticFailure:
      "realTradingForcedFalse false positive",

    staticStrategy:
      "REGEX_MATCH_REAL_ENV_FALSE_ASSIGNMENTS_INDEPENDENT_OF_WHITESPACE"
  },

  verification,

  safety: {
    collectorExecutedByFix:
      false,

    evaluatorExecuted:
      false,

    summaryExecuted:
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
      : "INSPECT_RUNTIME_BINDING_FIX_V3"
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
