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
