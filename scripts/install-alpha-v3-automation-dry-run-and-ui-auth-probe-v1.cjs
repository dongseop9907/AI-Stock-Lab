const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-automation-dry-run-and-ui-auth-probe.cjs"
  );

fs.mkdirSync(
  path.dirname(
    target
  ),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst files = {\n  automationRun:\n    \"app/api/trading/automation/run/route.ts\",\n  automationCycle:\n    \"app/api/trading/automation/cycle/route.ts\",\n  automationPanel:\n    \"app/components/AutomationRunPanel.tsx\",\n  maintenanceButton:\n    \"app/components/TradingMaintenanceButton.tsx\",\n};\n\nfunction read(rel) {\n  const abs =\n    path.resolve(\n      root,\n      rel\n    );\n\n  return {\n    rel,\n    exists:\n      fs.existsSync(abs),\n    text:\n      fs.existsSync(abs)\n        ? fs.readFileSync(\n            abs,\n            \"utf8\"\n          )\n        : \"\",\n  };\n}\n\nfunction lineOf(\n  text,\n  index\n) {\n  if (\n    index < 0\n  ) {\n    return null;\n  }\n\n  return (\n    text\n      .slice(\n        0,\n        index\n      )\n      .split(/\\r?\\n/)\n      .length\n  );\n}\n\nfunction matches(\n  text,\n  regex\n) {\n  const rows = [];\n\n  for (\n    const match of\n      text.matchAll(\n        regex\n      )\n  ) {\n    rows.push({\n      line:\n        lineOf(\n          text,\n          match.index ?? -1\n        ),\n      text:\n        match[0],\n    });\n  }\n\n  return rows;\n}\n\nconst loaded =\n  Object.fromEntries(\n    Object.entries(files)\n      .map(\n        ([key, rel]) => [\n          key,\n          read(rel),\n        ]\n      )\n  );\n\nconst automationText =\n  loaded\n    .automationRun\n    .text;\n\nconst cycleText =\n  loaded\n    .automationCycle\n    .text;\n\nconst panelText =\n  loaded\n    .automationPanel\n    .text;\n\nconst dryRunEvidence = [\n  ...matches(\n    automationText,\n    /\\bdryRun\\b/g\n  ),\n\n  ...matches(\n    automationText,\n    /\\bautoOrder\\b/g\n  ),\n\n  ...matches(\n    automationText,\n    /\\bpaperOrderEnabled\\b/g\n  ),\n];\n\nconst requestBodyEvidence =\n  matches(\n    automationText,\n    /request\\.(?:json|text)\\s*\\(|JSON\\.parse\\s*\\(|triggerType|dryRun|autoOrder/g\n  );\n\nconst orderCreationEvidence =\n  matches(\n    automationText,\n    /generateEntrySignals|createPaperBuyOrder|executeApprovedPaperOrders|\\/api\\/orders\\/paper|autoOrder/g\n  );\n\nconst panelCycleCalls =\n  matches(\n    panelText,\n    /fetch\\s*\\([\\s\\S]{0,260}?\\/api\\/trading\\/automation\\/cycle[\\s\\S]{0,500}?\\)/g\n  );\n\nconst panelSecretEvidence =\n  matches(\n    panelText,\n    /x-automation-secret|TRADING_AUTOMATION_SECRET|authorization/gi\n  );\n\nconst cycleSecretEvidence =\n  matches(\n    cycleText,\n    /TRADING_AUTOMATION_SECRET|x-automation-secret|UNAUTHORIZED_AUTOMATION_CYCLE/g\n  );\n\nconst dryRunReferenced =\n  /\\bdryRun\\b/.test(\n    automationText\n  );\n\nconst dryRunControlsOrderCreation =\n  /dryRun[\\s\\S]{0,500}(?:autoOrder|createPaperBuyOrder|generateEntrySignals)|(?:autoOrder|createPaperBuyOrder|generateEntrySignals)[\\s\\S]{0,500}dryRun/.test(\n    automationText\n  );\n\nconst autoOrderReferenced =\n  /\\bautoOrder\\b/.test(\n    automationText\n  );\n\nconst panelCallsCycle =\n  /\\/api\\/trading\\/automation\\/cycle/.test(\n    panelText\n  );\n\nconst panelSendsSecret =\n  /x-automation-secret/.test(\n    panelText\n  );\n\nconst cycleRequiresSecret =\n  /TRADING_AUTOMATION_SECRET/.test(\n    cycleText\n  ) &&\n  /x-automation-secret/.test(\n    cycleText\n  );\n\nlet dryRunDecision =\n  \"NO_CONFIRMED_DRY_RUN_ORDER_SUPPRESSION\";\n\nif (\n  dryRunReferenced &&\n  dryRunControlsOrderCreation\n) {\n  dryRunDecision =\n    \"DRY_RUN_APPEARS_TO_CONTROL_ORDER_CREATION_REVIEW_EVIDENCE\";\n} else if (\n  dryRunReferenced\n) {\n  dryRunDecision =\n    \"DRY_RUN_REFERENCED_BUT_NOT_PROVEN_TO_SUPPRESS_ORDER_CREATION\";\n}\n\nlet uiAuthDecision =\n  \"NO_UI_CYCLE_CALL\";\n\nif (\n  panelCallsCycle &&\n  cycleRequiresSecret &&\n  !panelSendsSecret\n) {\n  uiAuthDecision =\n    \"UI_CALLS_SECRET_PROTECTED_CYCLE_WITHOUT_SECRET_EXPECT_401\";\n} else if (\n  panelCallsCycle &&\n  panelSendsSecret\n) {\n  uiAuthDecision =\n    \"UI_SENDS_SECRET_REVIEW_CLIENT_SECRET_EXPOSURE_RISK\";\n}\n\nconst report = {\n  status:\n    \"ALPHA_V3_AUTOMATION_DRY_RUN_AND_UI_AUTH_PROBE_COMPLETE\",\n\n  files: Object.fromEntries(\n    Object.entries(loaded)\n      .map(\n        ([key, item]) => [\n          key,\n          {\n            file:\n              item.rel,\n            exists:\n              item.exists,\n            lineCount:\n              item.exists\n                ? item.text\n                    .split(/\\r?\\n/)\n                    .length\n                : 0,\n          },\n        ]\n      )\n  ),\n\n  automationRun: {\n    dryRunReferenced,\n    autoOrderReferenced,\n    dryRunControlsOrderCreation,\n    dryRunDecision,\n\n    dryRunEvidence,\n    requestBodyEvidence,\n    orderCreationEvidence,\n  },\n\n  uiAuth: {\n    panelCallsCycle,\n    panelSendsSecret,\n    cycleRequiresSecret,\n    uiAuthDecision,\n\n    panelCycleCalls,\n    panelSecretEvidence,\n    cycleSecretEvidence,\n  },\n\n  decision: {\n    safeToUseDryRunOneShot:\n      dryRunReferenced &&\n      dryRunControlsOrderCreation,\n\n    uiManualCycleExpectedTo401:\n      panelCallsCycle &&\n      cycleRequiresSecret &&\n      !panelSendsSecret,\n\n    nextGate:\n      (\n        dryRunReferenced &&\n        dryRunControlsOrderCreation\n      )\n        ? \"BUILD_DRY_RUN_ONE_SHOT_SMOKE_TEST\"\n        : \"DO_NOT_CALL_LIVE_CYCLE_YET_REVIEW_AUTOMATION_ORDER_CREATION_SEMANTICS\",\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    cyclePostRequests: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n  },\n\n  outputFile:\n    \"logs/alpha-v3-automation-dry-run-and-ui-auth-probe.json\",\n};\n\nconst outputFile =\n  path.resolve(\n    root,\n    report.outputFile\n  );\n\nfs.mkdirSync(\n  path.dirname(\n    outputFile\n  ),\n  {\n    recursive: true,\n  }\n);\n\nfs.writeFileSync(\n  outputFile,\n  JSON.stringify(\n    report,\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    report,\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_AUTOMATION_DRY_RUN_AND_UI_AUTH_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-automation-dry-run-and-ui-auth-probe.cjs",

      checks: [
        "AUTOMATION_RUN_DRY_RUN_SEMANTICS",
        "AUTOMATION_RUN_ORDER_CREATION_SURFACE",
        "AUTOMATION_PANEL_CYCLE_CALL",
        "CYCLE_SECRET_REQUIREMENT",
        "UI_SECRET_FORWARDING"
      ],

      databaseReads: 0,
      databaseWrites: 0,
      networkCalls: 0,
      cyclePostRequests: 0,
      ordersCreated: 0,
      positionsChanged: 0,

      nextAction:
        "RUN_DRY_RUN_AND_UI_AUTH_PROBE"
    },
    null,
    2
  )
);
