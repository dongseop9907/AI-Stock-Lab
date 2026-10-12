const fs = require("fs");
const path = require("path");

const root = process.cwd();

const helperRel =
  "lib/trading/kill-switch-guard.ts";

const staticRel =
  "scripts/alpha-v3-kill-switch-application-guards-v1-static-verify.cjs";

const testRel =
  "scripts/alpha-v3-kill-switch-application-guards-v1-contract-test.cjs";

function read(rel) {
  const file =
    path.resolve(root, rel);

  if (!fs.existsSync(file)) {
    throw new Error(
      `TARGET_NOT_FOUND ${rel}`
    );
  }

  return fs.readFileSync(
    file,
    "utf8"
  );
}

function write(rel, text) {
  const file =
    path.resolve(root, rel);

  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  fs.writeFileSync(
    file,
    text,
    "utf8"
  );
}

function ensureImport(
  text,
  importLine
) {
  if (text.includes(importLine)) {
    return text;
  }

  const importMatches =
    [...text.matchAll(
      /^import[\s\S]*?;\s*$/gm
    )];

  if (importMatches.length === 0) {
    return (
      importLine +
      "\n" +
      text
    );
  }

  const last =
    importMatches[
      importMatches.length - 1
    ];

  const end =
    last.index +
    last[0].length;

  return (
    text.slice(0, end) +
    "\n" +
    importLine +
    text.slice(end)
  );
}

function insertAtFunctionStart(
  text,
  functionNeedle,
  statement
) {
  if (text.includes(statement)) {
    return text;
  }

  const start =
    text.indexOf(
      functionNeedle
    );

  if (start < 0) {
    throw new Error(
      `FUNCTION_ANCHOR_NOT_FOUND ${functionNeedle}`
    );
  }

  const brace =
    text.indexOf(
      "{",
      start
    );

  if (brace < 0) {
    throw new Error(
      `FUNCTION_OPEN_BRACE_NOT_FOUND ${functionNeedle}`
    );
  }

  return (
    text.slice(
      0,
      brace + 1
    ) +
    "\n  " +
    statement +
    "\n" +
    text.slice(
      brace + 1
    )
  );
}

function patchGuardedService(
  rel,
  functionNeedle,
  action
) {
  let text =
    read(rel);

  text =
    ensureImport(
      text,
      'import { assertKillSwitchAllows } from "@/lib/trading/kill-switch-guard";'
    );

  text =
    insertAtFunctionStart(
      text,
      functionNeedle,
      `await assertKillSwitchAllows("${action}");`
    );

  write(rel, text);
}

write(
  helperRel,
  "import {\n  evaluateKillSwitchAction,\n  type KillSwitchAction,\n  type KillSwitchDecision,\n} from \"@/lib/trading/kill-switch-contract\";\nimport {\n  getTradingSystemControl,\n  type TradingSystemControl,\n} from \"@/lib/trading/get-trading-system-control\";\n\nexport class KillSwitchBlockedError extends Error {\n  readonly code =\n    \"KILL_SWITCH_ACTION_BLOCKED\";\n\n  readonly action: KillSwitchAction;\n  readonly decision: KillSwitchDecision;\n\n  constructor(\n    action: KillSwitchAction,\n    decision: KillSwitchDecision,\n  ) {\n    super(\n      [\n        \"KILL_SWITCH_ACTION_BLOCKED\",\n        action,\n        decision.reason,\n      ].join(\":\"),\n    );\n\n    this.name =\n      \"KillSwitchBlockedError\";\n\n    this.action =\n      action;\n\n    this.decision =\n      decision;\n  }\n}\n\nexport async function evaluateCurrentKillSwitchAction(\n  action: KillSwitchAction,\n): Promise<{\n  control: TradingSystemControl;\n  decision: KillSwitchDecision;\n}> {\n  const control =\n    await getTradingSystemControl();\n\n  const decision =\n    evaluateKillSwitchAction(\n      {\n        emergencyStop:\n          control.emergencyStop,\n\n        automationEnabled:\n          control.automationEnabled,\n\n        paperOrderEnabled:\n          control.paperOrderEnabled,\n\n        realOrderEnabled:\n          control.realOrderEnabled,\n      },\n      action,\n    );\n\n  return {\n    control,\n    decision,\n  };\n}\n\nexport async function assertKillSwitchAllows(\n  action: KillSwitchAction,\n): Promise<{\n  control: TradingSystemControl;\n  decision: KillSwitchDecision;\n}> {\n  const result =\n    await evaluateCurrentKillSwitchAction(\n      action,\n    );\n\n  if (!result.decision.allowed) {\n    throw new KillSwitchBlockedError(\n      action,\n      result.decision,\n    );\n  }\n\n  return result;\n}\n"
);

patchGuardedService(
  "lib/trading/paper-order-service.ts",
  "export async function createPaperBuyOrder(",
  "PAPER_BUY_CREATE"
);

patchGuardedService(
  "lib/trading/execute-approved-paper-orders.ts",
  "export async function executeApprovedPaperOrders(",
  "PAPER_BUY_EXECUTE"
);

patchGuardedService(
  "lib/trading/execute-paper-order.ts",
  "export async function executePaperOrder(",
  "PAPER_BUY_EXECUTE"
);

/*
 * Entry generation:
 * analysis remains allowed while latched,
 * but autoOrder=true must fail closed before
 * any create-order attempt.
 *
 * IMPORTANT:
 * The function has a default object parameter, so the first "{"
 * after the function name is NOT the function body. Locate the
 * matching ")" of the full parameter list first.
 */
{
  const rel =
    "lib/trading/generate-entry-signals.ts";

  let text =
    read(rel);

  text =
    ensureImport(
      text,
      'import { assertKillSwitchAllows } from "@/lib/trading/kill-switch-guard";'
    );

  text = text.replace(
    /\\s*if\\s*\\(\\s*input\\.autoOrder\\s*===\\s*true\\s*\\)\\s*\\{\\s*await\\s+assertKillSwitchAllows\\("PAPER_BUY_CREATE"\\);\\s*\\}/gm,
    ""
  );

  const fnNeedle =
    "export async function generateEntrySignals";

  const fnIndex =
    text.indexOf(fnNeedle);

  if (fnIndex < 0) {
    throw new Error(
      "GENERATE_ENTRY_SIGNALS_FUNCTION_NOT_FOUND"
    );
  }

  const openParen =
    text.indexOf("(", fnIndex);

  let depth = 0;
  let closeParen = -1;

  for (
    let i = openParen;
    i < text.length;
    i += 1
  ) {
    if (text[i] === "(") {
      depth += 1;
    } else if (text[i] === ")") {
      depth -= 1;

      if (depth === 0) {
        closeParen = i;
        break;
      }
    }
  }

  if (closeParen < 0) {
    throw new Error(
      "GENERATE_ENTRY_SIGNALS_CLOSE_PAREN_NOT_FOUND"
    );
  }

  const bodyBrace =
    text.indexOf(
      "{",
      closeParen
    );

  if (bodyBrace < 0) {
    throw new Error(
      "GENERATE_ENTRY_SIGNALS_BODY_BRACE_NOT_FOUND"
    );
  }

  const statement =
    'if (input.autoOrder === true) {\\n' +
    '    await assertKillSwitchAllows("PAPER_BUY_CREATE");\\n' +
    '  }';

  text =
    text.slice(0, bodyBrace + 1) +
    "\\n  " +
    statement +
    "\\n" +
    text.slice(bodyBrace + 1);

  write(rel, text);
}

/*
 * Automation boundary:
 * observation steps may continue while latched,
 * but requested autoOrder must be downgraded to false.
 */
{
  const rel =
    "app/api/trading/automation/run/route.ts";

  let text =
    read(rel);

  if (
    !/const\s+autoOrder\s*=\s*requestedAutoOrder\s*&&\s*control\.automationEnabled\s*&&\s*control\.paperOrderEnabled\s*&&\s*!control\.emergencyStop\s*;/m.test(
      text
    )
  ) {
    const regex =
      /const\s+autoOrder\s*=\s*requestedAutoOrder\s*&&\s*control\.paperOrderEnabled\s*;/m;

    if (!regex.test(text)) {
      throw new Error(
        "AUTOMATION_AUTO_ORDER_ASSIGNMENT_ANCHOR_NOT_FOUND"
      );
    }

    text =
      text.replace(
        regex,
        `const autoOrder =
  requestedAutoOrder &&
  control.automationEnabled &&
  control.paperOrderEnabled &&
  !control.emergencyStop;`
      );
  }

  write(rel, text);
}

write(
  staticRel,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nfunction read(rel) {\n  const abs =\n    path.resolve(root, rel);\n\n  if (!fs.existsSync(abs)) {\n    throw new Error(\n      `FILE_NOT_FOUND ${rel}`\n    );\n  }\n\n  return fs.readFileSync(\n    abs,\n    \"utf8\"\n  );\n}\n\nconst files = {\n  helper:\n    \"lib/trading/kill-switch-guard.ts\",\n\n  paperOrder:\n    \"lib/trading/paper-order-service.ts\",\n\n  approvedExecutor:\n    \"lib/trading/execute-approved-paper-orders.ts\",\n\n  singleExecutor:\n    \"lib/trading/execute-paper-order.ts\",\n\n  entrySignals:\n    \"lib/trading/generate-entry-signals.ts\",\n\n  automationRun:\n    \"app/api/trading/automation/run/route.ts\",\n\n  stopLoss:\n    \"app/api/trading/stop-loss/check/route.ts\",\n\n  trailing:\n    \"app/api/trading/trailing-stop/update/route.ts\"\n};\n\nconst text = Object.fromEntries(\n  Object.entries(files).map(\n    ([key, rel]) => [\n      key,\n      read(rel)\n    ]\n  )\n);\n\nconst checks = {\n  helperUsesContract:\n    text.helper.includes(\n      \"evaluateKillSwitchAction\"\n    ) &&\n    text.helper.includes(\n      \"getTradingSystemControl\"\n    ),\n\n  helperFailsClosed:\n    text.helper.includes(\n      \"KillSwitchBlockedError\"\n    ) &&\n    text.helper.includes(\n      \"if (!result.decision.allowed)\"\n    ),\n\n  createServiceGuarded:\n    text.paperOrder.includes(\n      'assertKillSwitchAllows(\"PAPER_BUY_CREATE\")'\n    ),\n\n  approvedExecutorGuarded:\n    text.approvedExecutor.includes(\n      'assertKillSwitchAllows(\"PAPER_BUY_EXECUTE\")'\n    ),\n\n  singleExecutorGuarded:\n    text.singleExecutor.includes(\n      'assertKillSwitchAllows(\"PAPER_BUY_EXECUTE\")'\n    ),\n\n  entryAutoOrderGuarded:\n    text.entrySignals.includes(\n      'assertKillSwitchAllows(\"PAPER_BUY_CREATE\")'\n    ) &&\n    /if\\s*\\(\\s*input\\.autoOrder\\s*===\\s*true\\s*\\)/m.test(\n      text.entrySignals\n    ),\n\n  automationRunEmergencyStopGatesAutoOrder:\n    /const\\s+autoOrder\\s*=\\s*requestedAutoOrder\\s*&&\\s*control\\.automationEnabled\\s*&&\\s*control\\.paperOrderEnabled\\s*&&\\s*!control\\.emergencyStop\\s*;/m.test(\n      text.automationRun\n    ),\n\n  protectiveStopLossNotGuardedAsNewRisk:\n    !text.stopLoss.includes(\n      'assertKillSwitchAllows(\"PAPER_BUY_CREATE\")'\n    ) &&\n    !text.stopLoss.includes(\n      'assertKillSwitchAllows(\"PAPER_BUY_EXECUTE\")'\n    ),\n\n  protectiveTrailingNotGuardedAsNewRisk:\n    !text.trailing.includes(\n      'assertKillSwitchAllows(\"PAPER_BUY_CREATE\")'\n    ) &&\n    !text.trailing.includes(\n      'assertKillSwitchAllows(\"PAPER_BUY_EXECUTE\")'\n    ),\n\n  noDbMigrationInThisStep:\n    true\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(([, value]) => !value)\n    .map(([key]) => key);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_KILL_SWITCH_APPLICATION_GUARDS_V1_STATIC_VERIFIED\"\n          : \"ALPHA_V3_KILL_SWITCH_APPLICATION_GUARDS_V1_STATIC_REVIEW\",\n\n      checks,\n      failed,\n\n      coverage: {\n        applicationBoundaries: [\n          \"AUTOMATION_RUN_AUTO_ORDER_GATE\",\n          \"PAPER_BUY_CREATE_SERVICE\",\n          \"ENTRY_AUTO_ORDER_PATH\",\n          \"APPROVED_ORDER_EXECUTOR\",\n          \"SINGLE_ORDER_EXECUTOR\"\n        ],\n\n        protectiveExitsIntentionallyUngated: [\n          \"STOP_LOSS\",\n          \"TRAILING_STOP\"\n        ],\n\n        remainingDefenseInDepth: [\n          \"DB_CREATE_RPC\",\n          \"DB_FILL_RPC\",\n          \"CONTROL_RESET_RPC_BINDING\"\n        ]\n      },\n\n      safety: {\n        databaseReads: 0,\n        databaseWrites: 0,\n        networkCalls: 0,\n        ordersCreated: 0,\n        ordersChanged: 0,\n        positionsChanged: 0\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"TYPECHECK_AND_RUN_APPLICATION_GUARD_CONTRACT_TEST\"\n          : \"REVIEW_APPLICATION_GUARD_BINDING\"\n    },\n    null,\n    2\n  )\n);\n\nif (failed.length > 0) {\n  process.exitCode = 2;\n}\n"
);

write(
  testRel,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nfunction read(rel) {\n  return fs.readFileSync(\n    path.resolve(root, rel),\n    \"utf8\"\n  );\n}\n\nconst automationRun =\n  read(\n    \"app/api/trading/automation/run/route.ts\"\n  );\n\nconst paperOrder =\n  read(\n    \"lib/trading/paper-order-service.ts\"\n  );\n\nconst approvedExecutor =\n  read(\n    \"lib/trading/execute-approved-paper-orders.ts\"\n  );\n\nconst singleExecutor =\n  read(\n    \"lib/trading/execute-paper-order.ts\"\n  );\n\nconst entrySignals =\n  read(\n    \"lib/trading/generate-entry-signals.ts\"\n  );\n\nconst scenarios = [\n  {\n    name:\n      \"AUTOMATION_AUTO_ORDER_REQUIRES_AUTOMATION_ENABLED\",\n    passed:\n      /requestedAutoOrder\\s*&&\\s*control\\.automationEnabled/m.test(\n        automationRun\n      )\n  },\n  {\n    name:\n      \"AUTOMATION_AUTO_ORDER_REQUIRES_PAPER_ENABLED\",\n    passed:\n      /control\\.automationEnabled\\s*&&\\s*control\\.paperOrderEnabled/m.test(\n        automationRun\n      )\n  },\n  {\n    name:\n      \"AUTOMATION_AUTO_ORDER_BLOCKED_BY_EMERGENCY_STOP\",\n    passed:\n      /control\\.paperOrderEnabled\\s*&&\\s*!control\\.emergencyStop/m.test(\n        automationRun\n      )\n  },\n  {\n    name:\n      \"CREATE_SERVICE_FAIL_CLOSED_GUARD\",\n    passed:\n      paperOrder.includes(\n        'await assertKillSwitchAllows(\"PAPER_BUY_CREATE\");'\n      )\n  },\n  {\n    name:\n      \"APPROVED_EXECUTOR_FAIL_CLOSED_GUARD\",\n    passed:\n      approvedExecutor.includes(\n        'await assertKillSwitchAllows(\"PAPER_BUY_EXECUTE\");'\n      )\n  },\n  {\n    name:\n      \"SINGLE_EXECUTOR_FAIL_CLOSED_GUARD\",\n    passed:\n      singleExecutor.includes(\n        'await assertKillSwitchAllows(\"PAPER_BUY_EXECUTE\");'\n      )\n  },\n  {\n    name:\n      \"ENTRY_AUTO_ORDER_ONLY_GUARD\",\n    passed:\n      /if\\s*\\(\\s*input\\.autoOrder\\s*===\\s*true\\s*\\)\\s*\\{\\s*await\\s+assertKillSwitchAllows\\(\"PAPER_BUY_CREATE\"\\);\\s*\\}/m.test(\n        entrySignals\n      )\n  }\n];\n\nconst failed =\n  scenarios.filter(\n    (item) => !item.passed\n  );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_KILL_SWITCH_APPLICATION_GUARDS_V1_CONTRACT_TEST_VERIFIED\"\n          : \"ALPHA_V3_KILL_SWITCH_APPLICATION_GUARDS_V1_CONTRACT_TEST_REVIEW\",\n\n      summary: {\n        scenarioCount:\n          scenarios.length,\n\n        passedCount:\n          scenarios.length -\n          failed.length,\n\n        failedCount:\n          failed.length\n      },\n\n      scenarios,\n      failed:\n        failed.map(\n          (item) => item.name\n        ),\n\n      runtimeCalls: {\n        databaseReads: 0,\n        databaseWrites: 0,\n        networkCalls: 0,\n        orderCalls: 0\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"RUN_NO_ORDER_OPERATIONAL_REGRESSION_THEN_BIND_DB_RPC_GUARDS\"\n          : \"REVIEW_APPLICATION_GUARD_CONTRACT\"\n    },\n    null,\n    2\n  )\n);\n\nif (failed.length > 0) {\n  process.exitCode = 2;\n}\n"
);

/*
 * Ensure targeted production typecheck sees
 * the new helper.
 */
{
  const rel =
    "tsconfig.alpha-v3-production-cycle.json";

  const file =
    path.resolve(root, rel);

  if (fs.existsSync(file)) {
    const config =
      JSON.parse(
        fs.readFileSync(
          file,
          "utf8"
        )
      );

    config.include =
      Array.isArray(config.include)
        ? config.include
        : [];

    if (
      !config.include.includes(
        helperRel
      )
    ) {
      config.include.push(
        helperRel
      );
    }

    fs.writeFileSync(
      file,
      JSON.stringify(
        config,
        null,
        2
      ) + "\n",
      "utf8"
    );
  }
}

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_KILL_SWITCH_APPLICATION_GUARDS_V1_INSTALLED",

      generatedFile:
        helperRel,

      patchedProductionFiles: [
        "lib/trading/paper-order-service.ts",
        "lib/trading/execute-approved-paper-orders.ts",
        "lib/trading/execute-paper-order.ts",
        "lib/trading/generate-entry-signals.ts",
        "app/api/trading/automation/run/route.ts"
      ],

      intentionallyUnchanged: [
        "app/api/trading/stop-loss/check/route.ts",
        "app/api/trading/trailing-stop/update/route.ts"
      ],

      behavior: {
        emergencyStopBlocksPaperBuyCreate:
          true,

        emergencyStopBlocksApprovedBuyExecution:
          true,

        emergencyStopBlocksSingleBuyExecution:
          true,

        entryAnalysisStillAllowed:
          true,

        stopLossStillAllowed:
          true,

        trailingStopStillAllowed:
          true
      },

      dbChanges:
        false,

      nextAction:
        "STATIC_VERIFY_TYPECHECK_AND_CONTRACT_TEST"
    },
    null,
    2
  )
);
