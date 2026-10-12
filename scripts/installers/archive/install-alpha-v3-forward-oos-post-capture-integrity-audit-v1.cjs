const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-forward-oos-post-capture-integrity-audit-v1.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst forwardPath = path.resolve(\n  root,\n  \"logs/alpha-v3-forward-top1-sessions.json\",\n);\n\nconst statePath = path.resolve(\n  root,\n  \"logs/alpha-v3-entry-v3-forward-shadow-oos-state.json\",\n);\n\nif (!fs.existsSync(forwardPath)) {\n  throw new Error(\n    \"FORWARD_TOP1_FILE_NOT_FOUND\",\n  );\n}\n\nconst forward = JSON.parse(\n  fs.readFileSync(\n    forwardPath,\n    \"utf8\",\n  ),\n);\n\nconst sessions =\n  Array.isArray(forward.sessions)\n    ? forward.sessions\n    : [];\n\nconst badOct09Targets =\n  sessions.filter(\n    (row) =>\n      row?.targetSessionDate ===\n      \"2026-10-09\",\n  );\n\nconst targetSession =\n  sessions.find(\n    (row) =>\n      row?.sourceTradingDate ===\n        \"2026-10-08\" &&\n      row?.targetSessionDate ===\n        \"2026-10-12\",\n  );\n\nlet oosState = null;\n\nif (fs.existsSync(statePath)) {\n  try {\n    oosState = JSON.parse(\n      fs.readFileSync(\n        statePath,\n        \"utf8\",\n      ),\n    );\n  } catch {\n    oosState = {\n      parseError: true,\n    };\n  }\n}\n\nconst stateRows =\n  Array.isArray(\n    oosState?.observations,\n  )\n    ? oosState.observations\n    : Array.isArray(\n        oosState?.sessions,\n      )\n      ? oosState.sessions\n      : [];\n\nconst prematureTargetRows =\n  stateRows.filter(\n    (row) =>\n      row?.targetSessionDate ===\n        \"2026-10-12\" &&\n      (\n        row?.filled === true ||\n        row?.correctedEntry ||\n        row?.returns ||\n        row?.r1 !== undefined ||\n        row?.r3 !== undefined ||\n        row?.r5 !== undefined\n      ),\n  );\n\nconst checks = {\n  forwardFileExists: true,\n\n  invalidOct09ForwardTargets:\n    badOct09Targets.length === 0,\n\n  correctedSessionExists:\n    Boolean(targetSession),\n\n  correctedSessionFrozen:\n    targetSession?.frozen === true,\n\n  correctedTop1IsSamsung:\n    targetSession?.top1?.stockCode ===\n      \"005930\",\n\n  sourceCutoffPreserved:\n    targetSession?.sourceDataCutoffAtCollection ===\n      \"2026-10-08\",\n\n  historicalContractPreserved:\n    targetSession?.frozenContract?.historicalCutoff ===\n      \"2026-10-07\",\n\n  thresholdPreserved:\n    Number(\n      targetSession?.frozenContract?.entryScoreThreshold,\n    ) === 0.66,\n\n  capPreserved:\n    Number(\n      targetSession?.frozenContract?.selectedCap,\n    ) === 0.01,\n\n  noPrematureTargetOutcome:\n    prematureTargetRows.length === 0,\n};\n\nconst failed =\n  Object.entries(\n    checks,\n  )\n    .filter(\n      ([, value]) =>\n        !value,\n    )\n    .map(\n      ([name]) =>\n        name,\n    );\n\nconst result = {\n  status:\n    failed.length === 0\n      ? \"ALPHA_V3_FORWARD_OOS_POST_CAPTURE_INTEGRITY_V1_VERIFIED\"\n      : \"ALPHA_V3_FORWARD_OOS_POST_CAPTURE_INTEGRITY_V1_REVIEW\",\n\n  checks,\n  failed,\n\n  forward: {\n    sessionCount:\n      sessions.length,\n\n    invalidOct09TargetCount:\n      badOct09Targets.length,\n\n    correctedSession:\n      targetSession\n        ? {\n            sourceTradingDate:\n              targetSession.sourceTradingDate,\n\n            targetSessionDate:\n              targetSession.targetSessionDate,\n\n            capturedAt:\n              targetSession.capturedAt,\n\n            stockCode:\n              targetSession.top1?.stockCode ??\n              null,\n\n            stockName:\n              targetSession.top1?.stockName ??\n              null,\n\n            effectiveScore:\n              targetSession.top1?.effectiveScore ??\n              null,\n\n            frozen:\n              targetSession.frozen ===\n              true,\n          }\n        : null,\n  },\n\n  oosState: {\n    exists:\n      fs.existsSync(statePath),\n\n    rowCount:\n      stateRows.length,\n\n    prematureTargetOutcomeCount:\n      prematureTargetRows.length,\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesWritten: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    productionChanged: false,\n  },\n\n  nextGate:\n    failed.length === 0\n      ? \"WAIT_FOR_2026_10_12_AFTER_1540_KST_THEN_RUN_ENTRY_OOS_COLLECTOR\"\n      : \"REVIEW_FORWARD_STATE_BEFORE_ANY_COLLECTION\",\n};\n\nconsole.log(\n  JSON.stringify(\n    result,\n    null,\n    2,\n  ),\n);\n\nif (failed.length > 0) {\n  process.exitCode = 2;\n}\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_FORWARD_OOS_POST_CAPTURE_INTEGRITY_AUDIT_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-forward-oos-post-capture-integrity-audit-v1.cjs",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        productionChanged: false
      },

      nextAction:
        "RUN_POST_CAPTURE_INTEGRITY_AUDIT"
    },
    null,
    2
  )
);
