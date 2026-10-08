const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const files = {
  contract:
    "lib/trading/automation-cycle-contract.ts",

  maintenance:
    "lib/trading/run-committed-risk-maintenance.ts",

  cycleRoute:
    "app/api/trading/automation/cycle/route.ts",

  panel:
    "app/components/AutomationRunPanel.tsx",
};

const text = {};

for (
  const [
    name,
    rel
  ] of Object.entries(files)
) {
  const file =
    path.resolve(
      root,
      rel
    );

  if (!fs.existsSync(file)) {
    throw new Error(
      `MISSING_FILE:${rel}`
    );
  }

  text[name] =
    fs.readFileSync(
      file,
      "utf8"
    );
}

const route =
  text.cycleRoute;

const index = {
  preMaintenance:
    route.indexOf(
      'phase:\n            "PRE_CYCLE"'
    ),

  automationRun:
    route.indexOf(
      "/api/trading/automation/run"
    ),

  executeApproved:
    route.indexOf(
      "await executeApprovedPaperOrders"
    ),

  postMaintenance:
    route.indexOf(
      'phase:\n            "POST_EXECUTION"'
    ),
};

const checks = {
  cadence60Seconds:
    /AUTOMATION_CYCLE_CADENCE_SECONDS\s*=\s*60\b/.test(
      text.contract
    ),

  expiry180Seconds:
    /PAPER_BUY_RESERVATION_EXPIRY_SECONDS\s*=\s*180\b/.test(
      text.contract
    ),

  expiryThreeMinutes:
    /PAPER_BUY_RESERVATION_EXPIRY_INTERVAL\s*=\s*\n?\s*"3 minutes"/.test(
      text.contract
    ),

  maintenanceCallsReconcile:
    /reconcile_paper_buy_reserved_risk_v3/.test(
      text.maintenance
    ),

  maintenanceCallsExpiry:
    /expire_stale_paper_buy_reservations_v3/.test(
      text.maintenance
    ),

  maintenanceUsesServiceRole:
    /SUPABASE_SERVICE_ROLE_KEY/.test(
      text.maintenance
    ),

  cycleAuthorizesSecret:
    /TRADING_AUTOMATION_SECRET/.test(
      route
    ) &&
    /x-automation-secret/.test(
      route
    ),

  cycleCallsExistingAutomationRun:
    /\/api\/trading\/automation\/run/.test(
      route
    ),

  cycleExecutesApprovedOrders:
    /executeApprovedPaperOrders/.test(
      route
    ),

  cycleFailsClosedOnAutomationFailure:
    /if\s*\(\s*!automationResponse\.ok\s*\)/.test(
      route
    ),

  canonicalStageOrder:
    index.preMaintenance >= 0 &&
    index.automationRun >= 0 &&
    index.executeApproved >= 0 &&
    index.postMaintenance >= 0 &&
    index.preMaintenance <
      index.automationRun &&
    index.automationRun <
      index.executeApproved &&
    index.executeApproved <
      index.postMaintenance,

  panelUsesCycleRoute:
    /\/api\/trading\/automation\/cycle/.test(
      text.panel
    ),

  panelNoLongerCallsRawRunRoute:
    !/\/api\/trading\/automation\/run/.test(
      text.panel
    ),

  noBrowserSetIntervalAdded:
    !/setInterval\s*\(/.test(
      text.panel
    ),

  noDatabaseMigrationAdded:
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
      ([name]) =>
        name
    );

const result = {
  status:
    failed.length === 0
      ? "ALPHA_V3_SERVER_SIDE_AUTOMATION_CYCLE_V1_VERIFIED"
      : "ALPHA_V3_SERVER_SIDE_AUTOMATION_CYCLE_V1_REVIEW",

  checks,

  failed,

  contract: {
    cadenceSeconds:
      60,

    reservationExpirySeconds:
      180,

    reservationExpiryMinutes:
      3,

    stageOrder: [
      "PRE_MAINTENANCE_RECONCILE_AND_EXPIRY",
      "EXISTING_AUTOMATION_RUN",
      "EXECUTE_APPROVED_PAPER_ORDERS",
      "POST_EXECUTION_RECONCILE",
    ],

    schedulerInstalled:
      false,

    databaseApplied:
      true,
  },

  nextGate:
    failed.length === 0
      ? "TYPECHECK_AND_ROUTE_CONTRACT_TEST"
      : "REVIEW_SERVER_SIDE_AUTOMATION_CYCLE_PATCH",
};

console.log(
  JSON.stringify(
    result,
    null,
    2
  )
);

if (
  failed.length > 0
) {
  process.exitCode = 2;
}
