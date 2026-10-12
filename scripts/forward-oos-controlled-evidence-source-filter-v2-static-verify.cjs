const fs = require("fs");
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
    text.split(/\r?\n/);

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
    .join("\n");
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
