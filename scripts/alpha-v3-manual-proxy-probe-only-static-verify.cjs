const fs = require("fs");
const path = require("path");

const root = process.cwd();

const manualFile = path.resolve(
  root,
  "app/api/trading/automation/manual/route.ts"
);

if (!fs.existsSync(manualFile)) {
  throw new Error(
    "AUTOMATION_MANUAL_PROXY_NOT_FOUND"
  );
}

const text =
  fs.readFileSync(
    manualFile,
    "utf8"
  );

const checks = {
  markerPresent:
    text.includes(
      "ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_V1"
    ),

  acceptsProbeOnlyField:
    text.includes(
      "probeOnly?: unknown"
    ),

  strictProbeOnlyTrue:
    text.includes(
      "body.probeOnly ==="
    ) &&
    text.includes(
      "true;"
    ),

  probeForcesManual:
    /probeOnly[\s\S]{0,700}?triggerType:[\s\S]{0,80}?"MANUAL"/m.test(
      text
    ),

  probeForcesAutoOrderFalse:
    /probeOnly[\s\S]{0,900}?autoOrder:[\s\S]{0,80}?false/m.test(
      text
    ),

  probeForcesMarketSyncFalse:
    /probeOnly[\s\S]{0,900}?includeMarketSync:[\s\S]{0,80}?false/m.test(
      text
    ),

  probeForwardsProbeOnlyTrue:
    /probeOnly[\s\S]{0,900}?probeOnly:[\s\S]{0,80}?true/m.test(
      text
    ),

  serverAddsSecret:
    text.includes(
      "TRADING_AUTOMATION_SECRET"
    ) &&
    text.includes(
      '"x-automation-secret"'
    ),

  forwardsToCycle:
    text.includes(
      "/api/trading/automation/cycle"
    ),

  originGuardStillPresent:
    text.includes(
      "AUTOMATION_MANUAL_ORIGIN_REJECTED"
    ),

  noClientSecretRequirement:
    !text.includes(
      "providedSecret"
    ),
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
          ? "ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_STATIC_VERIFIED"
          : "ALPHA_V3_MANUAL_PROXY_PROBE_ONLY_STATIC_REVIEW",

      checks,
      failed,

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        ordersChanged: 0,
        positionsChanged: 0
      },

      nextGate:
        failed.length === 0
          ? "RUN_MANUAL_PROXY_PROBE_ONLY_LIVE_SMOKE"
          : "REVIEW_MANUAL_PROXY_PROBE_ONLY_PATCH"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
