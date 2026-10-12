const fs = require("fs");
const path = require("path");

const root = process.cwd();

const files = {
  automationRun:
    "app/api/trading/automation/run/route.ts",
  automationCycle:
    "app/api/trading/automation/cycle/route.ts",
  automationPanel:
    "app/components/AutomationRunPanel.tsx",
  maintenanceButton:
    "app/components/TradingMaintenanceButton.tsx",
};

function read(rel) {
  const abs =
    path.resolve(
      root,
      rel
    );

  return {
    rel,
    exists:
      fs.existsSync(abs),
    text:
      fs.existsSync(abs)
        ? fs.readFileSync(
            abs,
            "utf8"
          )
        : "",
  };
}

function lineOf(
  text,
  index
) {
  if (
    index < 0
  ) {
    return null;
  }

  return (
    text
      .slice(
        0,
        index
      )
      .split(/\r?\n/)
      .length
  );
}

function matches(
  text,
  regex
) {
  const rows = [];

  for (
    const match of
      text.matchAll(
        regex
      )
  ) {
    rows.push({
      line:
        lineOf(
          text,
          match.index ?? -1
        ),
      text:
        match[0],
    });
  }

  return rows;
}

const loaded =
  Object.fromEntries(
    Object.entries(files)
      .map(
        ([key, rel]) => [
          key,
          read(rel),
        ]
      )
  );

const automationText =
  loaded
    .automationRun
    .text;

const cycleText =
  loaded
    .automationCycle
    .text;

const panelText =
  loaded
    .automationPanel
    .text;

const dryRunEvidence = [
  ...matches(
    automationText,
    /\bdryRun\b/g
  ),

  ...matches(
    automationText,
    /\bautoOrder\b/g
  ),

  ...matches(
    automationText,
    /\bpaperOrderEnabled\b/g
  ),
];

const requestBodyEvidence =
  matches(
    automationText,
    /request\.(?:json|text)\s*\(|JSON\.parse\s*\(|triggerType|dryRun|autoOrder/g
  );

const orderCreationEvidence =
  matches(
    automationText,
    /generateEntrySignals|createPaperBuyOrder|executeApprovedPaperOrders|\/api\/orders\/paper|autoOrder/g
  );

const panelCycleCalls =
  matches(
    panelText,
    /fetch\s*\([\s\S]{0,260}?\/api\/trading\/automation\/cycle[\s\S]{0,500}?\)/g
  );

const panelSecretEvidence =
  matches(
    panelText,
    /x-automation-secret|TRADING_AUTOMATION_SECRET|authorization/gi
  );

const cycleSecretEvidence =
  matches(
    cycleText,
    /TRADING_AUTOMATION_SECRET|x-automation-secret|UNAUTHORIZED_AUTOMATION_CYCLE/g
  );

const dryRunReferenced =
  /\bdryRun\b/.test(
    automationText
  );

const dryRunControlsOrderCreation =
  /dryRun[\s\S]{0,500}(?:autoOrder|createPaperBuyOrder|generateEntrySignals)|(?:autoOrder|createPaperBuyOrder|generateEntrySignals)[\s\S]{0,500}dryRun/.test(
    automationText
  );

const autoOrderReferenced =
  /\bautoOrder\b/.test(
    automationText
  );

const panelCallsCycle =
  /\/api\/trading\/automation\/cycle/.test(
    panelText
  );

const panelSendsSecret =
  /x-automation-secret/.test(
    panelText
  );

const cycleRequiresSecret =
  /TRADING_AUTOMATION_SECRET/.test(
    cycleText
  ) &&
  /x-automation-secret/.test(
    cycleText
  );

let dryRunDecision =
  "NO_CONFIRMED_DRY_RUN_ORDER_SUPPRESSION";

if (
  dryRunReferenced &&
  dryRunControlsOrderCreation
) {
  dryRunDecision =
    "DRY_RUN_APPEARS_TO_CONTROL_ORDER_CREATION_REVIEW_EVIDENCE";
} else if (
  dryRunReferenced
) {
  dryRunDecision =
    "DRY_RUN_REFERENCED_BUT_NOT_PROVEN_TO_SUPPRESS_ORDER_CREATION";
}

let uiAuthDecision =
  "NO_UI_CYCLE_CALL";

if (
  panelCallsCycle &&
  cycleRequiresSecret &&
  !panelSendsSecret
) {
  uiAuthDecision =
    "UI_CALLS_SECRET_PROTECTED_CYCLE_WITHOUT_SECRET_EXPECT_401";
} else if (
  panelCallsCycle &&
  panelSendsSecret
) {
  uiAuthDecision =
    "UI_SENDS_SECRET_REVIEW_CLIENT_SECRET_EXPOSURE_RISK";
}

const report = {
  status:
    "ALPHA_V3_AUTOMATION_DRY_RUN_AND_UI_AUTH_PROBE_COMPLETE",

  files: Object.fromEntries(
    Object.entries(loaded)
      .map(
        ([key, item]) => [
          key,
          {
            file:
              item.rel,
            exists:
              item.exists,
            lineCount:
              item.exists
                ? item.text
                    .split(/\r?\n/)
                    .length
                : 0,
          },
        ]
      )
  ),

  automationRun: {
    dryRunReferenced,
    autoOrderReferenced,
    dryRunControlsOrderCreation,
    dryRunDecision,

    dryRunEvidence,
    requestBodyEvidence,
    orderCreationEvidence,
  },

  uiAuth: {
    panelCallsCycle,
    panelSendsSecret,
    cycleRequiresSecret,
    uiAuthDecision,

    panelCycleCalls,
    panelSecretEvidence,
    cycleSecretEvidence,
  },

  decision: {
    safeToUseDryRunOneShot:
      dryRunReferenced &&
      dryRunControlsOrderCreation,

    uiManualCycleExpectedTo401:
      panelCallsCycle &&
      cycleRequiresSecret &&
      !panelSendsSecret,

    nextGate:
      (
        dryRunReferenced &&
        dryRunControlsOrderCreation
      )
        ? "BUILD_DRY_RUN_ONE_SHOT_SMOKE_TEST"
        : "DO_NOT_CALL_LIVE_CYCLE_YET_REVIEW_AUTOMATION_ORDER_CREATION_SEMANTICS",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    cyclePostRequests: 0,
    ordersCreated: 0,
    positionsChanged: 0,
  },

  outputFile:
    "logs/alpha-v3-automation-dry-run-and-ui-auth-probe.json",
};

const outputFile =
  path.resolve(
    root,
    report.outputFile
  );

fs.mkdirSync(
  path.dirname(
    outputFile
  ),
  {
    recursive: true,
  }
);

fs.writeFileSync(
  outputFile,
  JSON.stringify(
    report,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    report,
    null,
    2
  )
);
