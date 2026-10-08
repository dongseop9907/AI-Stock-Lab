const fs = require("fs");
const path = require("path");

const root = process.cwd();

const collectorPath = path.resolve(
  root,
  "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
);

const installerPath = path.resolve(
  root,
  "scripts/install-alpha-v3-true-forward-oos-pipeline-v1.cjs",
);

if (!fs.existsSync(collectorPath)) {
  throw new Error(
    "FORWARD_OOS_COLLECTOR_NOT_FOUND:" + collectorPath,
  );
}

const collectorBefore = fs.readFileSync(
  collectorPath,
  "utf8",
);

let collectorAfter = collectorBefore;

const asyncFunctions = [
  "fetchJsonWithRetry",
  "fetchPage",
  "fetchFullMinuteSession",
];

const collectorChanges = [];

for (const name of asyncFunctions) {
  const asyncNeedle = `async function ${name}(`;
  const syncNeedle = `function ${name}(`;

  if (collectorAfter.includes(asyncNeedle)) {
    collectorChanges.push({
      function: name,
      action: "ALREADY_ASYNC",
    });
    continue;
  }

  if (!collectorAfter.includes(syncNeedle)) {
    throw new Error(
      `COLLECTOR_FUNCTION_NOT_FOUND:${name}`,
    );
  }

  collectorAfter = collectorAfter.replace(
    syncNeedle,
    asyncNeedle,
  );

  collectorChanges.push({
    function: name,
    action: "RESTORED_ASYNC",
  });
}

if (collectorAfter !== collectorBefore) {
  fs.writeFileSync(
    collectorPath,
    collectorAfter,
    "utf8",
  );
}

let installerPatched = false;
let installerAction = "INSTALLER_NOT_FOUND";

if (fs.existsSync(installerPath)) {
  const installerBefore = fs.readFileSync(
    installerPath,
    "utf8",
  );

  let installerAfter = installerBefore;

  const oldBlock = [
    "  const start =",
    "    source.indexOf(",
    "      `function ${name}(`",
    "    );",
    "",
    "  if (",
    "    start <",
    "    0",
    "  ) {",
  ].join("\n");

  const newBlock = [
    "  const asyncStart =",
    "    source.indexOf(",
    "      `async function ${name}(`",
    "    );",
    "",
    "  const syncStart =",
    "    source.indexOf(",
    "      `function ${name}(`",
    "    );",
    "",
    "  const start =",
    "    asyncStart >=",
    "      0",
    "      ? asyncStart",
    "      : syncStart;",
    "",
    "  if (",
    "    start <",
    "    0",
    "  ) {",
  ].join("\n");

  if (installerAfter.includes(oldBlock)) {
    installerAfter = installerAfter.replace(
      oldBlock,
      newBlock,
    );

    installerPatched = true;
    installerAction =
      "ASYNC_PREFIX_PRESERVATION_PATCHED";
  } else if (
    installerAfter.includes(
      "const asyncStart =",
    ) &&
    installerAfter.includes(
      "`async function ${name}(`",
    )
  ) {
    installerAction =
      "ASYNC_PREFIX_PRESERVATION_ALREADY_PATCHED";
  } else {
    installerAction =
      "INSTALLER_EXTRACTION_BLOCK_SHAPE_NOT_MATCHED";
  }

  if (installerAfter !== installerBefore) {
    fs.writeFileSync(
      installerPath,
      installerAfter,
      "utf8",
    );
  }
}

const collectorFinal = fs.readFileSync(
  collectorPath,
  "utf8",
);

const checks = {
  fetchJsonWithRetryAsync:
    collectorFinal.includes(
      "async function fetchJsonWithRetry(",
    ),

  fetchPageAsync:
    collectorFinal.includes(
      "async function fetchPage(",
    ),

  fetchFullMinuteSessionAsync:
    collectorFinal.includes(
      "async function fetchFullMinuteSession(",
    ),

  noSyncFetchJsonWithRetry:
    !collectorFinal.includes(
      "\nfunction fetchJsonWithRetry(",
    ),

  noSyncFetchPage:
    !collectorFinal.includes(
      "\nfunction fetchPage(",
    ),

  noSyncFetchFullMinuteSession:
    !collectorFinal.includes(
      "\nfunction fetchFullMinuteSession(",
    ),

  orderEndpointsAbsent:
    !collectorFinal.includes("/api/orders/") &&
    !collectorFinal.includes("/api/trading/automation/"),
};

const failed = Object.entries(checks)
  .filter(([, value]) => !value)
  .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_TRUE_FORWARD_OOS_PIPELINE_V1_ASYNC_EXTRACTION_FIXED"
          : "ALPHA_V3_TRUE_FORWARD_OOS_PIPELINE_V1_ASYNC_EXTRACTION_REVIEW",

      diagnosis:
        "INSTALLER_EXTRACT_FUNCTION_STARTED_AT_FUNCTION_KEYWORD_AND_DROPPED_ASYNC_PREFIX",

      collectorChanges,

      installer: {
        found: fs.existsSync(installerPath),
        patched: installerPatched,
        action: installerAction,
      },

      checks,
      failed,

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        kisRequests: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        productionChanged: false,
      },

      nextGate:
        failed.length === 0
          ? "RERUN_STATIC_CONTRACT_TYPESCRIPT_AND_LIVE_FORWARD_SMOKE"
          : "REVIEW_COLLECTOR_SOURCE",
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
