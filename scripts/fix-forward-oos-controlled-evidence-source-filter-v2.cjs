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
  "forward-oos-controlled-evidence-source-filter-v2-static-verify.cjs"
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
          "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_EVIDENCE_SOURCE_FILTER_V2_FAILED",
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
  "get-forward-oos-observability-dashboard-v1.before-controlled-evidence-source-filter-v2.ts"
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

const lines =
  source.split(/\r?\n/);

const start =
  lines.findIndex(
    line =>
      line.includes(
        "const FORWARD_FILES = ["
      )
  );

if (start < 0) {
  fail(
    "FORWARD_FILES_START_NOT_FOUND"
  );
  return;
}

let end = -1;

for (
  let index = start + 1;
  index < lines.length;
  index += 1
) {
  const trimmed =
    lines[index].trim();

  if (
    trimmed === "];" ||
    trimmed === "] as const;" ||
    trimmed === "] as const"
  ) {
    end = index;
    break;
  }
}

if (end < 0) {
  fail(
    "FORWARD_FILES_END_NOT_FOUND",
    {
      startLine:
        start + 1
    }
  );
  return;
}

const canonicalBlock = [
  "const FORWARD_FILES = [",
  '  "logs/alpha-v3-true-forward-oos.json",',
  '  "logs/alpha-v3-true-forward-oos-v1.json",',
  '  "logs/alpha-v3-true-forward-top1-sessions-v1.json",',
  "] as const;",
];

const nextLines = [
  ...lines.slice(0, start),
  ...canonicalBlock,
  ...lines.slice(end + 1),
];

source =
  nextLines.join("\n");

if (!source.endsWith("\n")) {
  source += "\n";
}

fs.writeFileSync(
  SERVICE,
  source,
  "utf8"
);

function extractForwardBlock(text) {
  const rows =
    text.split(/\r?\n/);

  const s =
    rows.findIndex(
      line =>
        line.includes(
          "const FORWARD_FILES = ["
        )
    );

  if (s < 0) {
    return null;
  }

  let e = -1;

  for (
    let i = s + 1;
    i < rows.length;
    i += 1
  ) {
    const trimmed =
      rows[i].trim();

    if (
      trimmed === "];" ||
      trimmed === "] as const;" ||
      trimmed === "] as const"
    ) {
      e = i;
      break;
    }
  }

  if (e < 0) {
    return null;
  }

  return rows
    .slice(s, e + 1)
    .join("\n");
}

const written =
  fs.readFileSync(
    SERVICE,
    "utf8"
  );

const block =
  extractForwardBlock(
    written
  );

const checks = {
  forwardFilesBlockPresent:
    Boolean(block),

  allControlledCandidatesPresent:
    Boolean(block) &&
    CONTROLLED.every(
      candidate =>
        block.includes(candidate)
    ),

  exactlyThreeControlledEntries:
    Boolean(block) &&
    CONTROLLED.filter(
      candidate =>
        block.includes(candidate)
    ).length === 3,

  legacyFallbackAbsentFromForwardFiles:
    Boolean(block) &&
    !block.includes(LEGACY),

  legacyFallbackAbsentFromService:
    !written.includes(LEGACY),

  serviceStillReadOnly:
    !written.includes("writeFileSync(") &&
    !written.includes(".insert(") &&
    !written.includes(".upsert(") &&
    !written.includes(".update(") &&
    !written.includes(".delete("),

  producerChanged:
    false,

  collectorChanged:
    false,

  legacyFileDeleted:
    false,
};

const failed =
  Object.entries(checks)
    .filter(
      ([key, value]) =>
        ![
          "producerChanged",
          "collectorChanged",
          "legacyFileDeleted",
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
      forwardFilesBlock:
        block,
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

const LEGACY =
  "logs/alpha-v3-forward-top1-sessions.json";

const CONTROLLED = [
  "logs/alpha-v3-true-forward-oos.json",
  "logs/alpha-v3-true-forward-oos-v1.json",
  "logs/alpha-v3-true-forward-top1-sessions-v1.json",
];

function extractForwardBlock(text) {
  const rows =
    text.split(/\\r?\\n/);

  const start =
    rows.findIndex(
      line =>
        line.includes(
          "const FORWARD_FILES = ["
        )
    );

  if (start < 0) {
    return null;
  }

  let end = -1;

  for (
    let index = start + 1;
    index < rows.length;
    index += 1
  ) {
    const trimmed =
      rows[index].trim();

    if (
      trimmed === "];" ||
      trimmed === "] as const;" ||
      trimmed === "] as const"
    ) {
      end = index;
      break;
    }
  }

  if (end < 0) {
    return null;
  }

  return rows
    .slice(
      start,
      end + 1
    )
    .join("\\n");
}

const service =
  fs.existsSync(
    SERVICE
  )
    ? fs.readFileSync(
        SERVICE,
        "utf8"
      )
    : "";

const block =
  extractForwardBlock(
    service
  );

const checks = {
  serviceExists:
    Boolean(service),

  forwardFilesBlockPresent:
    Boolean(block),

  controlledCandidate1:
    Boolean(block) &&
    block.includes(
      CONTROLLED[0]
    ),

  controlledCandidate2:
    Boolean(block) &&
    block.includes(
      CONTROLLED[1]
    ),

  controlledCandidate3:
    Boolean(block) &&
    block.includes(
      CONTROLLED[2]
    ),

  legacyFallbackExcluded:
    Boolean(block) &&
    !block.includes(
      LEGACY
    ),

  legacyNotReferencedAnywhereInDashboardService:
    !service.includes(
      LEGACY
    ),

  readOnly:
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
          ? "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_EVIDENCE_SOURCE_FILTER_V2_STATIC_VERIFIED"
          : "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_EVIDENCE_SOURCE_FILTER_V2_STATIC_FAILED",

      checks,

      forwardFilesBlock:
        block,

      policy: {
        controlledCandidates:
          CONTROLLED,

        excludedLegacyFile:
          LEGACY,

        existingLegacyFileMutation:
          "NONE",

        dashboardScope:
          "CONTROLLED_FORWARD_FILES_ONLY"
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
          ? "RUN_DASHBOARD_CONTRACT_APP_TSC_BUILD"
          : "REPAIR_CONTROLLED_EVIDENCE_SOURCE_FILTER_V2"
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
        "AI_STOCK_LAB_FORWARD_OOS_CONTROLLED_EVIDENCE_SOURCE_FILTER_V2_REPAIRED",

      changedFile:
        "lib/research/get-forward-oos-observability-dashboard-v1.ts",

      generatedFile:
        "scripts/forward-oos-controlled-evidence-source-filter-v2-static-verify.cjs",

      backupFile:
        "scripts/backups/get-forward-oos-observability-dashboard-v1.before-controlled-evidence-source-filter-v2.ts",

      repair: {
        strategy:
          "REPLACE_ENTIRE_FORWARD_FILES_BLOCK",

        controlledCandidates:
          CONTROLLED,

        legacyFallback:
          "REMOVED",

        handlesPartiallyAppliedV1:
          true,

        legacySessionPreserved:
          true,

        producerLogicChanged:
          false,

        collectorLogicChanged:
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
        "RUN_STATIC_DASHBOARD_CONTRACT_APP_TSC_BUILD_AND_INSPECT_SESSION_COUNT"
    },
    null,
    2
  )
);

process.exitCode = 0;
