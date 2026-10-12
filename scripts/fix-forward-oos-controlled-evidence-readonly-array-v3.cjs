const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const SERVICE = path.join(
  ROOT,
  "lib",
  "research",
  "get-forward-oos-observability-dashboard-v1.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "forward-oos-controlled-evidence-readonly-array-v3-static-verify.cjs"
);

const LEGACY =
  "logs/alpha-v3-forward-top1-sessions.json";

const CONTROLLED = [
  "logs/alpha-v3-true-forward-oos.json",
  "logs/alpha-v3-true-forward-oos-v1.json",
  "logs/alpha-v3-true-forward-top1-sessions-v1.json",
];

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_EVIDENCE_READONLY_ARRAY_V3_FAILED",
        reason,
        ...extra,
      },
      null,
      2
    )
  );

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
  "get-forward-oos-observability-dashboard-v1.before-readonly-array-v3.ts"
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

const functionStart =
  source.indexOf(
    "function firstExisting"
  );

if (functionStart < 0) {
  fail("FIRST_EXISTING_FUNCTION_NOT_FOUND");
  return;
}

const bodyStart =
  source.indexOf(
    "{",
    functionStart
  );

if (bodyStart < 0) {
  fail("FIRST_EXISTING_HEADER_END_NOT_FOUND");
  return;
}

const header =
  source.slice(
    functionStart,
    bodyStart
  );

let nextHeader =
  header;

if (
  header.includes(
    "readonly string[]"
  )
) {
  nextHeader =
    header;
}
else if (
  header.includes(
    "string[]"
  )
) {
  nextHeader =
    header.replace(
      "string[]",
      "readonly string[]"
    );
}
else {
  fail(
    "FIRST_EXISTING_STRING_ARRAY_PARAMETER_NOT_FOUND",
    {
      header
    }
  );

  return;
}

source =
  source.slice(
    0,
    functionStart
  ) +
  nextHeader +
  source.slice(
    bodyStart
  );

fs.writeFileSync(
  SERVICE,
  source,
  "utf8"
);

const written =
  fs.readFileSync(
    SERVICE,
    "utf8"
  );

const writtenStart =
  written.indexOf(
    "function firstExisting"
  );

const writtenBodyStart =
  written.indexOf(
    "{",
    writtenStart
  );

const writtenHeader =
  writtenStart >= 0 &&
  writtenBodyStart >= 0
    ? written.slice(
        writtenStart,
        writtenBodyStart
      )
    : "";

const checks = {
  firstExistingAcceptsReadonlyStringArray:
    writtenHeader.includes(
      "readonly string[]"
    ),

  allControlledCandidatesPreserved:
    CONTROLLED.every(
      candidate =>
        written.includes(
          candidate
        )
    ),

  legacyFallbackStillAbsent:
    !written.includes(
      LEGACY
    ),

  dashboardStillReadOnly:
    !written.includes(
      "writeFileSync("
    ) &&
    !written.includes(
      ".insert("
    ) &&
    !written.includes(
      ".upsert("
    ) &&
    !written.includes(
      ".update("
    ) &&
    !written.includes(
      ".delete("
    ),

  evidencePolicyChanged:
    false,

  producerLogicChanged:
    false,

  collectorLogicChanged:
    false,
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([key, value]) =>
        ![
          "evidencePolicyChanged",
          "producerLogicChanged",
          "collectorLogicChanged",
        ].includes(
          key
        ) &&
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

if (
  failed.length > 0
) {
  fail(
    "POST_REPAIR_CHECK_FAILED",
    {
      checks,
      failed,
      firstExistingHeader:
        writtenHeader,
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

const CONTROLLED = [
  "logs/alpha-v3-true-forward-oos.json",
  "logs/alpha-v3-true-forward-oos-v1.json",
  "logs/alpha-v3-true-forward-top1-sessions-v1.json",
];

const LEGACY =
  "logs/alpha-v3-forward-top1-sessions.json";

const service =
  fs.readFileSync(
    SERVICE,
    "utf8"
  );

const start =
  service.indexOf(
    "function firstExisting"
  );

const end =
  service.indexOf(
    "{",
    start
  );

const header =
  start >= 0 &&
  end >= 0
    ? service.slice(
        start,
        end
      )
    : "";

const checks = {
  firstExistingPresent:
    start >= 0,

  readonlyParameter:
    header.includes(
      "readonly string[]"
    ),

  controlledCandidate1:
    service.includes(
      CONTROLLED[0]
    ),

  controlledCandidate2:
    service.includes(
      CONTROLLED[1]
    ),

  controlledCandidate3:
    service.includes(
      CONTROLLED[2]
    ),

  legacyExcluded:
    !service.includes(
      LEGACY
    ),

  readOnlyService:
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
          ? "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_EVIDENCE_READONLY_ARRAY_V3_STATIC_VERIFIED"
          : "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_EVIDENCE_READONLY_ARRAY_V3_STATIC_FAILED",

      checks,

      firstExistingHeader:
        header.trim(),

      interpretation: {
        change:
          "firstExisting now accepts readonly string arrays",

        controlledEvidenceFilter:
          "PRESERVED",

        legacySessionExclusion:
          "PRESERVED",

        runtimeLogic:
          "UNCHANGED"
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
          ? "RUN_DASHBOARD_CONTRACT_APP_TSC_BUILD_FORWARD_OPERATIONAL_TSC"
          : "REPAIR_READONLY_ARRAY_TYPE"
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
        "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_EVIDENCE_READONLY_ARRAY_V3_REPAIRED",

      changedFile:
        "lib/research/get-forward-oos-observability-dashboard-v1.ts",

      generatedFile:
        "scripts/forward-oos-controlled-evidence-readonly-array-v3-static-verify.cjs",

      backupFile:
        "scripts/backups/get-forward-oos-observability-dashboard-v1.before-readonly-array-v3.ts",

      repair: {
        firstExistingParameter:
          "string[] -> readonly string[]",

        forwardFilesAsConst:
          "PRESERVED",

        controlledEvidenceFilter:
          "PRESERVED",

        legacyFallback:
          "EXCLUDED",

        runtimeBehavior:
          "UNCHANGED"
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
        "RUN_STATIC_DASHBOARD_CONTRACT_APP_TSC_BUILD_FORWARD_OPERATIONAL_TSC"
    },
    null,
    2
  )
);

process.exitCode = 0;
