const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const SERVICE = path.join(
  ROOT,
  "lib",
  "research",
  "get-forward-oos-observability-dashboard-v1.ts"
);

const READINESS = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-first-real-session-readiness-v1.ts"
);

const EVIDENCE_WRAPPER = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-controlled-producer-evidence-run-v1.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "forward-oos-controlled-evidence-source-filter-v1-static-verify.cjs"
);

const LEGACY =
  "logs/alpha-v3-forward-top1-sessions.json";

const CONTROLLED_CANDIDATES = [
  "logs/alpha-v3-true-forward-oos.json",
  "logs/alpha-v3-true-forward-oos-v1.json",
  "logs/alpha-v3-true-forward-top1-sessions-v1.json",
];

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_EVIDENCE_SOURCE_FILTER_V1_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(SERVICE)) {
  fail("DASHBOARD_SERVICE_NOT_FOUND");
  return;
}

const backupDir = path.join(
  ROOT,
  "scripts",
  "backups"
);

fs.mkdirSync(
  backupDir,
  { recursive: true }
);

const backup = path.join(
  backupDir,
  "get-forward-oos-observability-dashboard-v1.before-controlled-evidence-source-filter-v1.ts"
);

if (!fs.existsSync(backup)) {
  fs.copyFileSync(
    SERVICE,
    backup
  );
}

let source =
  fs.readFileSync(
    SERVICE,
    "utf8"
  );

const beforeHasLegacy =
  source.includes(LEGACY);

if (beforeHasLegacy) {
  source = source
    .split(/\r?\n/)
    .filter(
      line =>
        !line.includes(LEGACY)
    )
    .join("\n");

  if (
    !source.endsWith("\n")
  ) {
    source += "\n";
  }
}

fs.writeFileSync(
  SERVICE,
  source,
  "utf8"
);

const readinessText =
  fs.existsSync(READINESS)
    ? fs.readFileSync(
        READINESS,
        "utf8"
      )
    : "";

const evidenceWrapperText =
  fs.existsSync(EVIDENCE_WRAPPER)
    ? fs.readFileSync(
        EVIDENCE_WRAPPER,
        "utf8"
      )
    : "";

const remainingControlledCandidates =
  CONTROLLED_CANDIDATES.filter(
    candidate =>
      source.includes(candidate)
  );

const checks = {
  legacyFallbackRemovedFromDashboard:
    !source.includes(LEGACY),

  controlledCandidatesRemain:
    remainingControlledCandidates.length >= 1,

  readinessDoesNotUseLegacyFallback:
    !readinessText ||
    !readinessText.includes(LEGACY),

  controlledEvidenceWrapperDoesNotUseLegacyFallback:
    !evidenceWrapperText ||
    !evidenceWrapperText.includes(LEGACY),

  dashboardStillReadOnly:
    !source.includes("writeFileSync(") &&
    !source.includes(".insert(") &&
    !source.includes(".upsert(") &&
    !source.includes(".update(") &&
    !source.includes(".delete("),

  producerLogicChanged:
    false,

  collectorLogicChanged:
    false,

  legacySessionFileDeleted:
    false,
};

const failed =
  Object.entries(checks)
    .filter(
      ([key, value]) =>
        ![
          "producerLogicChanged",
          "collectorLogicChanged",
          "legacySessionFileDeleted",
        ].includes(key) &&
        value !== true
    )
    .map(([key]) => key);

if (failed.length > 0) {
  fail(
    "POST_REPAIR_CHECK_FAILED",
    {
      checks,
      failed,
      remainingControlledCandidates,
    }
  );

  return;
}

const staticSource = `const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const SERVICE =
  path.join(
    ROOT,
    "lib",
    "research",
    "get-forward-oos-observability-dashboard-v1.ts"
  );

const READINESS =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-first-real-session-readiness-v1.ts"
  );

const EVIDENCE =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-controlled-producer-evidence-run-v1.ts"
  );

const LEGACY =
  "logs/alpha-v3-forward-top1-sessions.json";

const CONTROLLED = [
  "logs/alpha-v3-true-forward-oos.json",
  "logs/alpha-v3-true-forward-oos-v1.json",
  "logs/alpha-v3-true-forward-top1-sessions-v1.json",
];

function readIfExists(file) {
  return fs.existsSync(file)
    ? fs.readFileSync(
        file,
        "utf8"
      )
    : "";
}

const service =
  readIfExists(
    SERVICE
  );

const readiness =
  readIfExists(
    READINESS
  );

const evidence =
  readIfExists(
    EVIDENCE
  );

const checks = {
  serviceExists:
    Boolean(service),

  legacyFallbackExcluded:
    Boolean(service) &&
    !service.includes(
      LEGACY
    ),

  controlledForwardCandidateStillPresent:
    CONTROLLED.some(
      candidate =>
        service.includes(
          candidate
        )
    ),

  readinessAligned:
    !readiness ||
    !readiness.includes(
      LEGACY
    ),

  controlledWrapperAligned:
    !evidence ||
    !evidence.includes(
      LEGACY
    ),

  serviceStillReadOnly:
    !service.includes(
      "writeFileSync("
    ) &&
    !service.includes(
      ".insert("
    ) &&
    !service.includes(
      ".upsert("
    ) &&
    !service.includes(
      ".update("
    ) &&
    !service.includes(
      ".delete("
    ),

  realTradingEnableAbsent:
    !service.includes(
      "REAL_TRADING_ENABLED=true"
    ) &&
    !service.includes(
      "ENABLE_REAL_TRADING=true"
    ) &&
    !service.includes(
      "ENABLE_LIVE_TRADING=true"
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

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_EVIDENCE_SOURCE_FILTER_V1_STATIC_VERIFIED"
          : "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_EVIDENCE_SOURCE_FILTER_V1_STATIC_FAILED",

      checks,

      policy: {
        excludedLegacyFile:
          LEGACY,

        dashboardEvidenceScope:
          "CONTROLLED_OR_AUTHORITATIVE_FORWARD_FILES_ONLY",

        existingLegacyFileMutation:
          "NONE",

        existingLegacySessionDeletion:
          false,

        countRule:
          "Legacy/unproven forward session files must not contribute to Controlled Forward dashboard session counts."
      },

      safety: {
        sourceOnly:
          true,

        databaseReads:
          0,

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

      nextGate:
        failed.length === 0
          ? "RUN_DASHBOARD_CONTRACT_BUILD_AND_VERIFY_CONTROLLED_SESSION_COUNT"
          : "REPAIR_CONTROLLED_EVIDENCE_SOURCE_FILTER"
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
`;

fs.writeFileSync(
  STATIC,
  staticSource,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_EVIDENCE_SOURCE_FILTER_V1_REPAIRED",

      changedFile:
        "lib/research/get-forward-oos-observability-dashboard-v1.ts",

      generatedFile:
        "scripts/forward-oos-controlled-evidence-source-filter-v1-static-verify.cjs",

      backupFile:
        "scripts/backups/get-forward-oos-observability-dashboard-v1.before-controlled-evidence-source-filter-v1.ts",

      policy: {
        excludedFromControlledDashboard:
          LEGACY,

        controlledCandidatesRemaining:
          remainingControlledCandidates,

        readinessLegacyFallback:
          false,

        controlledWrapperLegacyFallback:
          false,

        existingLegacySessionPreserved:
          true,

        producerChanged:
          false,

        collectorChanged:
          false
      },

      checks,

      safety: {
        legacyFileDeleted:
          false,

        legacySessionMutated:
          false,

        databaseReads:
          0,

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

      failed: [],

      nextAction:
        "RUN_STATIC_DASHBOARD_CONTRACT_APP_TSC_BUILD_AND_CONFIRM_SESSION_ZERO"
    },
    null,
    2
  )
);

process.exitCode = 0;
