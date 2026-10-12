const fs = require("fs");
const path = require("path");

const root = process.cwd();

const contractRel =
  "lib/trading/kill-switch-contract.ts";

const testRel =
  "scripts/alpha-v3-kill-switch-contract-v1-test.ts";

const verifyRel =
  "scripts/alpha-v3-kill-switch-contract-v1-static-verify.cjs";

const tsconfigRel =
  "tsconfig.alpha-v3-production-cycle.json";

const contractFile =
  path.resolve(root, contractRel);

const testFile =
  path.resolve(root, testRel);

const verifyFile =
  path.resolve(root, verifyRel);

fs.mkdirSync(
  path.dirname(contractFile),
  { recursive: true }
);

if (fs.existsSync(contractFile)) {
  const backup =
    `${contractFile}.before-v1.bak`;

  if (!fs.existsSync(backup)) {
    fs.copyFileSync(
      contractFile,
      backup
    );
  }
}

fs.writeFileSync(
  contractFile,
  "export const KILL_SWITCH_CONTRACT_VERSION =\n  \"ALPHA_V3_KILL_SWITCH_V1\" as const;\n\nexport type KillSwitchAction =\n  | \"DATA_COLLECTION\"\n  | \"MODEL_EVALUATION\"\n  | \"ENTRY_ANALYSIS\"\n  | \"RISK_MAINTENANCE\"\n  | \"PROTECTIVE_STOP_LOSS_EXIT\"\n  | \"PROTECTIVE_TRAILING_EXIT\"\n  | \"PAPER_BUY_CREATE\"\n  | \"PAPER_BUY_EXECUTE\"\n  | \"LIVE_ORDER_SUBMIT\";\n\nexport type KillSwitchControl = {\n  emergencyStop: boolean;\n  automationEnabled: boolean;\n  paperOrderEnabled: boolean;\n  realOrderEnabled: boolean;\n};\n\nexport type KillSwitchDecision = {\n  allowed: boolean;\n  mode:\n    | \"NORMAL\"\n    | \"PROTECTIVE_ONLY\"\n    | \"DISABLED\";\n  reason:\n    | \"ALLOWED_NORMAL\"\n    | \"ALLOWED_OBSERVATION_DURING_KILL_SWITCH\"\n    | \"ALLOWED_PROTECTIVE_EXIT_DURING_KILL_SWITCH\"\n    | \"ALLOWED_RISK_MAINTENANCE_DURING_KILL_SWITCH\"\n    | \"BLOCKED_KILL_SWITCH_NEW_RISK\"\n    | \"BLOCKED_AUTOMATION_DISABLED\"\n    | \"BLOCKED_PAPER_ORDER_DISABLED\"\n    | \"BLOCKED_REAL_ORDER_DISABLED\";\n};\n\nexport const KILL_SWITCH_BLOCKED_NEW_RISK_ACTIONS =\n  [\n    \"PAPER_BUY_CREATE\",\n    \"PAPER_BUY_EXECUTE\",\n    \"LIVE_ORDER_SUBMIT\",\n  ] as const satisfies readonly KillSwitchAction[];\n\nexport const KILL_SWITCH_PROTECTIVE_ACTIONS =\n  [\n    \"PROTECTIVE_STOP_LOSS_EXIT\",\n    \"PROTECTIVE_TRAILING_EXIT\",\n    \"RISK_MAINTENANCE\",\n  ] as const satisfies readonly KillSwitchAction[];\n\nexport const KILL_SWITCH_OBSERVATION_ACTIONS =\n  [\n    \"DATA_COLLECTION\",\n    \"MODEL_EVALUATION\",\n    \"ENTRY_ANALYSIS\",\n  ] as const satisfies readonly KillSwitchAction[];\n\nconst blockedNewRiskSet =\n  new Set<KillSwitchAction>(\n    KILL_SWITCH_BLOCKED_NEW_RISK_ACTIONS,\n  );\n\nconst protectiveSet =\n  new Set<KillSwitchAction>(\n    KILL_SWITCH_PROTECTIVE_ACTIONS,\n  );\n\nconst observationSet =\n  new Set<KillSwitchAction>(\n    KILL_SWITCH_OBSERVATION_ACTIONS,\n  );\n\nexport function evaluateKillSwitchAction(\n  control: KillSwitchControl,\n  action: KillSwitchAction,\n): KillSwitchDecision {\n  if (control.emergencyStop) {\n    if (blockedNewRiskSet.has(action)) {\n      return {\n        allowed: false,\n        mode: \"PROTECTIVE_ONLY\",\n        reason: \"BLOCKED_KILL_SWITCH_NEW_RISK\",\n      };\n    }\n\n    if (protectiveSet.has(action)) {\n      if (action === \"RISK_MAINTENANCE\") {\n        return {\n          allowed: true,\n          mode: \"PROTECTIVE_ONLY\",\n          reason:\n            \"ALLOWED_RISK_MAINTENANCE_DURING_KILL_SWITCH\",\n        };\n      }\n\n      return {\n        allowed: true,\n        mode: \"PROTECTIVE_ONLY\",\n        reason:\n          \"ALLOWED_PROTECTIVE_EXIT_DURING_KILL_SWITCH\",\n      };\n    }\n\n    if (observationSet.has(action)) {\n      return {\n        allowed: true,\n        mode: \"PROTECTIVE_ONLY\",\n        reason:\n          \"ALLOWED_OBSERVATION_DURING_KILL_SWITCH\",\n      };\n    }\n  }\n\n  if (\n    !control.automationEnabled &&\n    (\n      action === \"ENTRY_ANALYSIS\" ||\n      action === \"PAPER_BUY_CREATE\" ||\n      action === \"PAPER_BUY_EXECUTE\" ||\n      action === \"LIVE_ORDER_SUBMIT\"\n    )\n  ) {\n    return {\n      allowed: false,\n      mode: \"DISABLED\",\n      reason: \"BLOCKED_AUTOMATION_DISABLED\",\n    };\n  }\n\n  if (\n    (\n      action === \"PAPER_BUY_CREATE\" ||\n      action === \"PAPER_BUY_EXECUTE\"\n    ) &&\n    !control.paperOrderEnabled\n  ) {\n    return {\n      allowed: false,\n      mode: \"DISABLED\",\n      reason: \"BLOCKED_PAPER_ORDER_DISABLED\",\n    };\n  }\n\n  if (\n    action === \"LIVE_ORDER_SUBMIT\" &&\n    !control.realOrderEnabled\n  ) {\n    return {\n      allowed: false,\n      mode: \"DISABLED\",\n      reason: \"BLOCKED_REAL_ORDER_DISABLED\",\n    };\n  }\n\n  return {\n    allowed: true,\n    mode: \"NORMAL\",\n    reason: \"ALLOWED_NORMAL\",\n  };\n}\n\nexport const KILL_SWITCH_V1 = {\n  version: KILL_SWITCH_CONTRACT_VERSION,\n\n  authoritativeSource:\n    \"trading_system_control.emergency_stop\",\n\n  latchPolicy: {\n    automaticTripAllowed: true,\n    automaticResetAllowed: false,\n    manualResetRequired: true,\n    resetRequiresReason: true,\n    resetRequiresActor: true,\n    resetRequiresTimestamp: true,\n    resetRequiresAudit: true,\n  },\n\n  semantics: {\n    emergencyStopTrue:\n      \"BLOCK_ALL_NEW_RISK_BUT_KEEP_RISK_REDUCING_AND_OBSERVATIONAL_WORK\",\n\n    schedulerPolicy:\n      \"SCHEDULER_MAY_CONTINUE_CALLING_CYCLE_BUT_NEW_RISK_ACTIONS_MUST_FAIL_CLOSED_AT_MULTIPLE_BOUNDARIES\",\n\n    automationCyclePolicy:\n      \"WHEN_LATCHED_RUN_MAINTENANCE_OBSERVATION_AND_PROTECTIVE_EXITS_ONLY\",\n\n    stopLossPolicy:\n      \"ALWAYS_ALLOW_PROTECTIVE_STOP_LOSS_EXIT_WHILE_KILL_SWITCH_IS_LATCHED\",\n\n    trailingStopPolicy:\n      \"ALWAYS_ALLOW_PROTECTIVE_TRAILING_EXIT_WHILE_KILL_SWITCH_IS_LATCHED\",\n\n    hardShutdownMode:\n      \"NOT_PART_OF_V1\",\n  },\n\n  defenseInDepthRequiredAt: [\n    \"AUTOMATION_RUN_BOUNDARY\",\n    \"PAPER_ORDER_CREATE_SERVICE\",\n    \"APPROVED_ORDER_EXECUTOR\",\n    \"SINGLE_ORDER_EXECUTOR\",\n    \"DB_CREATE_RPC\",\n    \"DB_FILL_RPC\",\n  ],\n\n  knownProductionGuardGapsFromProbeV2: [\n    \"app/api/trading/automation/cycle/route.ts\",\n    \"app/api/trading/automation/manual/route.ts\",\n    \"app/api/orders/paper/route.ts\",\n    \"app/api/orders/paper/execute/route.ts\",\n    \"app/api/orders/paper/execute-approved/route.ts\",\n    \"lib/trading/paper-order-service.ts\",\n    \"lib/trading/committed-risk-reservation.ts\",\n    \"lib/trading/execute-approved-paper-orders.ts\",\n    \"lib/trading/execute-paper-order.ts\",\n    \"lib/trading/generate-entry-signals.ts\",\n    \"scripts/alpha-v3-automation-cycle-scheduler.ts\",\n  ],\n\n  protectiveExitSurfaces: [\n    \"app/api/trading/stop-loss/check/route.ts\",\n    \"app/api/trading/trailing-stop/update/route.ts\",\n  ],\n\n  invariants: [\n    \"KILL_SWITCH_CAN_AUTO_TRIP_BUT_CAN_NEVER_AUTO_RESET\",\n    \"KILL_SWITCH_BLOCKS_NEW_RISK_AT_APPLICATION_AND_DATABASE_BOUNDARIES\",\n    \"KILL_SWITCH_DOES_NOT_BLOCK_STOP_LOSS_OR_TRAILING_PROTECTIVE_EXITS\",\n    \"KILL_SWITCH_DOES_NOT_BLOCK_RISK_RECONCILIATION_OR_RESERVATION_RELEASE\",\n    \"OBSERVATIONAL_DATA_AND_MODEL_EVALUATION_MAY_CONTINUE_WHILE_LATCHED\",\n    \"MANUAL_RESET_REQUIRES_REASON_ACTOR_TIMESTAMP_AND_AUDIT\",\n    \"DIRECT_ORDER_ENDPOINTS_MUST_NOT_BYPASS_THE_KILL_SWITCH\",\n    \"DB_CREATE_AND_FILL_RPCS_MUST_FAIL_CLOSED_WHEN_LATCHED\",\n  ],\n} as const;\n",
  "utf8"
);

fs.mkdirSync(
  path.dirname(testFile),
  { recursive: true }
);

fs.writeFileSync(
  testFile,
  "import {\n  KILL_SWITCH_V1,\n  evaluateKillSwitchAction,\n  type KillSwitchAction,\n  type KillSwitchControl,\n} from \"../lib/trading/kill-switch-contract\";\n\ntype Scenario = {\n  name: string;\n  control: KillSwitchControl;\n  action: KillSwitchAction;\n  allowed: boolean;\n  reason: string;\n  mode: string;\n};\n\nconst normal: KillSwitchControl = {\n  emergencyStop: false,\n  automationEnabled: true,\n  paperOrderEnabled: true,\n  realOrderEnabled: false,\n};\n\nconst latched: KillSwitchControl = {\n  emergencyStop: true,\n  automationEnabled: true,\n  paperOrderEnabled: true,\n  realOrderEnabled: false,\n};\n\nconst scenarios: Scenario[] = [\n  {\n    name: \"NORMAL_PAPER_BUY_CREATE_ALLOWED\",\n    control: normal,\n    action: \"PAPER_BUY_CREATE\",\n    allowed: true,\n    reason: \"ALLOWED_NORMAL\",\n    mode: \"NORMAL\",\n  },\n  {\n    name: \"NORMAL_PAPER_BUY_EXECUTE_ALLOWED\",\n    control: normal,\n    action: \"PAPER_BUY_EXECUTE\",\n    allowed: true,\n    reason: \"ALLOWED_NORMAL\",\n    mode: \"NORMAL\",\n  },\n  {\n    name: \"REAL_ORDER_DISABLED_BLOCKS_LIVE\",\n    control: normal,\n    action: \"LIVE_ORDER_SUBMIT\",\n    allowed: false,\n    reason: \"BLOCKED_REAL_ORDER_DISABLED\",\n    mode: \"DISABLED\",\n  },\n  {\n    name: \"KILL_SWITCH_BLOCKS_PAPER_CREATE\",\n    control: latched,\n    action: \"PAPER_BUY_CREATE\",\n    allowed: false,\n    reason: \"BLOCKED_KILL_SWITCH_NEW_RISK\",\n    mode: \"PROTECTIVE_ONLY\",\n  },\n  {\n    name: \"KILL_SWITCH_BLOCKS_PAPER_EXECUTE\",\n    control: latched,\n    action: \"PAPER_BUY_EXECUTE\",\n    allowed: false,\n    reason: \"BLOCKED_KILL_SWITCH_NEW_RISK\",\n    mode: \"PROTECTIVE_ONLY\",\n  },\n  {\n    name: \"KILL_SWITCH_BLOCKS_LIVE_SUBMIT\",\n    control: latched,\n    action: \"LIVE_ORDER_SUBMIT\",\n    allowed: false,\n    reason: \"BLOCKED_KILL_SWITCH_NEW_RISK\",\n    mode: \"PROTECTIVE_ONLY\",\n  },\n  {\n    name: \"KILL_SWITCH_ALLOWS_STOP_LOSS\",\n    control: latched,\n    action: \"PROTECTIVE_STOP_LOSS_EXIT\",\n    allowed: true,\n    reason:\n      \"ALLOWED_PROTECTIVE_EXIT_DURING_KILL_SWITCH\",\n    mode: \"PROTECTIVE_ONLY\",\n  },\n  {\n    name: \"KILL_SWITCH_ALLOWS_TRAILING_EXIT\",\n    control: latched,\n    action: \"PROTECTIVE_TRAILING_EXIT\",\n    allowed: true,\n    reason:\n      \"ALLOWED_PROTECTIVE_EXIT_DURING_KILL_SWITCH\",\n    mode: \"PROTECTIVE_ONLY\",\n  },\n  {\n    name: \"KILL_SWITCH_ALLOWS_MAINTENANCE\",\n    control: latched,\n    action: \"RISK_MAINTENANCE\",\n    allowed: true,\n    reason:\n      \"ALLOWED_RISK_MAINTENANCE_DURING_KILL_SWITCH\",\n    mode: \"PROTECTIVE_ONLY\",\n  },\n  {\n    name: \"KILL_SWITCH_ALLOWS_DATA_COLLECTION\",\n    control: latched,\n    action: \"DATA_COLLECTION\",\n    allowed: true,\n    reason:\n      \"ALLOWED_OBSERVATION_DURING_KILL_SWITCH\",\n    mode: \"PROTECTIVE_ONLY\",\n  },\n  {\n    name: \"KILL_SWITCH_ALLOWS_MODEL_EVALUATION\",\n    control: latched,\n    action: \"MODEL_EVALUATION\",\n    allowed: true,\n    reason:\n      \"ALLOWED_OBSERVATION_DURING_KILL_SWITCH\",\n    mode: \"PROTECTIVE_ONLY\",\n  },\n  {\n    name: \"KILL_SWITCH_ALLOWS_ENTRY_ANALYSIS_ONLY\",\n    control: latched,\n    action: \"ENTRY_ANALYSIS\",\n    allowed: true,\n    reason:\n      \"ALLOWED_OBSERVATION_DURING_KILL_SWITCH\",\n    mode: \"PROTECTIVE_ONLY\",\n  },\n  {\n    name: \"AUTOMATION_DISABLED_BLOCKS_ENTRY\",\n    control: {\n      ...normal,\n      automationEnabled: false,\n    },\n    action: \"ENTRY_ANALYSIS\",\n    allowed: false,\n    reason: \"BLOCKED_AUTOMATION_DISABLED\",\n    mode: \"DISABLED\",\n  },\n  {\n    name: \"PAPER_DISABLED_BLOCKS_CREATE\",\n    control: {\n      ...normal,\n      paperOrderEnabled: false,\n    },\n    action: \"PAPER_BUY_CREATE\",\n    allowed: false,\n    reason: \"BLOCKED_PAPER_ORDER_DISABLED\",\n    mode: \"DISABLED\",\n  },\n  {\n    name: \"PAPER_DISABLED_BLOCKS_EXECUTE\",\n    control: {\n      ...normal,\n      paperOrderEnabled: false,\n    },\n    action: \"PAPER_BUY_EXECUTE\",\n    allowed: false,\n    reason: \"BLOCKED_PAPER_ORDER_DISABLED\",\n    mode: \"DISABLED\",\n  },\n];\n\nconst results = scenarios.map(\n  (scenario) => {\n    const observed =\n      evaluateKillSwitchAction(\n        scenario.control,\n        scenario.action,\n      );\n\n    return {\n      name: scenario.name,\n      passed:\n        observed.allowed === scenario.allowed &&\n        observed.reason === scenario.reason &&\n        observed.mode === scenario.mode,\n      expected: {\n        allowed: scenario.allowed,\n        reason: scenario.reason,\n        mode: scenario.mode,\n      },\n      observed,\n    };\n  },\n);\n\nconst failed =\n  results.filter(\n    (item) => !item.passed,\n  );\n\nconst invariantChecks = {\n  autoResetForbidden:\n    KILL_SWITCH_V1\n      .latchPolicy\n      .automaticResetAllowed === false,\n\n  manualResetRequired:\n    KILL_SWITCH_V1\n      .latchPolicy\n      .manualResetRequired === true,\n\n  resetAuditRequired:\n    KILL_SWITCH_V1\n      .latchPolicy\n      .resetRequiresAudit === true,\n\n  stopLossProtected:\n    KILL_SWITCH_V1\n      .protectiveExitSurfaces\n      .some(\n        (value) =>\n          value.includes(\"stop-loss\"),\n      ),\n\n  trailingProtected:\n    KILL_SWITCH_V1\n      .protectiveExitSurfaces\n      .some(\n        (value) =>\n          value.includes(\"trailing-stop\"),\n      ),\n\n  dbCreateGuardRequired:\n    KILL_SWITCH_V1\n      .defenseInDepthRequiredAt\n      .includes(\"DB_CREATE_RPC\"),\n\n  dbFillGuardRequired:\n    KILL_SWITCH_V1\n      .defenseInDepthRequiredAt\n      .includes(\"DB_FILL_RPC\"),\n};\n\nconst invariantFailures =\n  Object.entries(invariantChecks)\n    .filter(([, value]) => !value)\n    .map(([key]) => key);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0 &&\n        invariantFailures.length === 0\n          ? \"ALPHA_V3_KILL_SWITCH_CONTRACT_V1_VERIFIED\"\n          : \"ALPHA_V3_KILL_SWITCH_CONTRACT_V1_REVIEW\",\n\n      contract:\n        KILL_SWITCH_V1,\n\n      summary: {\n        scenarioCount: results.length,\n        passedCount:\n          results.length - failed.length,\n        failedCount: failed.length,\n        invariantFailureCount:\n          invariantFailures.length,\n      },\n\n      invariantChecks,\n      invariantFailures,\n      scenarios: results,\n\n      safety: {\n        databaseReads: 0,\n        databaseWrites: 0,\n        networkCalls: 0,\n        ordersCreated: 0,\n        ordersChanged: 0,\n        positionsChanged: 0,\n      },\n\n      nextGate:\n        failed.length === 0 &&\n        invariantFailures.length === 0\n          ? \"BUILD_KILL_SWITCH_DB_LATCH_AND_AUDIT_FOUNDATION_V1\"\n          : \"REVIEW_KILL_SWITCH_CONTRACT_V1\",\n    },\n    null,\n    2,\n  ),\n);\n\nif (\n  failed.length > 0 ||\n  invariantFailures.length > 0\n) {\n  process.exitCode = 2;\n}\n",
  "utf8"
);

fs.writeFileSync(
  verifyFile,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst file = path.resolve(\n  root,\n  \"lib/trading/kill-switch-contract.ts\"\n);\n\nif (!fs.existsSync(file)) {\n  throw new Error(\n    \"KILL_SWITCH_CONTRACT_NOT_FOUND\"\n  );\n}\n\nconst text =\n  fs.readFileSync(file, \"utf8\");\n\nconst checks = {\n  versionPresent:\n    text.includes(\n      \"ALPHA_V3_KILL_SWITCH_V1\"\n    ),\n\n  authoritativeSource:\n    text.includes(\n      \"trading_system_control.emergency_stop\"\n    ),\n\n  blocksPaperCreate:\n    text.includes(\n      '\"PAPER_BUY_CREATE\"'\n    ),\n\n  blocksPaperExecute:\n    text.includes(\n      '\"PAPER_BUY_EXECUTE\"'\n    ),\n\n  blocksLiveSubmit:\n    text.includes(\n      '\"LIVE_ORDER_SUBMIT\"'\n    ),\n\n  protectiveStopLoss:\n    text.includes(\n      '\"PROTECTIVE_STOP_LOSS_EXIT\"'\n    ),\n\n  protectiveTrailing:\n    text.includes(\n      '\"PROTECTIVE_TRAILING_EXIT\"'\n    ),\n\n  maintenanceAllowed:\n    text.includes(\n      '\"RISK_MAINTENANCE\"'\n    ),\n\n  autoResetForbidden:\n    /automaticResetAllowed:\\s*false/m.test(\n      text\n    ),\n\n  manualResetRequired:\n    /manualResetRequired:\\s*true/m.test(\n      text\n    ),\n\n  resetReasonRequired:\n    /resetRequiresReason:\\s*true/m.test(\n      text\n    ),\n\n  resetActorRequired:\n    /resetRequiresActor:\\s*true/m.test(\n      text\n    ),\n\n  resetAuditRequired:\n    /resetRequiresAudit:\\s*true/m.test(\n      text\n    ),\n\n  dbCreateGuardRequired:\n    text.includes(\n      '\"DB_CREATE_RPC\"'\n    ),\n\n  dbFillGuardRequired:\n    text.includes(\n      '\"DB_FILL_RPC\"'\n    ),\n\n  noHardShutdownV1:\n    text.includes(\n      '\"NOT_PART_OF_V1\"'\n    ),\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(([, value]) => !value)\n    .map(([key]) => key);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_KILL_SWITCH_CONTRACT_V1_STATIC_VERIFIED\"\n          : \"ALPHA_V3_KILL_SWITCH_CONTRACT_V1_STATIC_REVIEW\",\n\n      checks,\n      failed,\n\n      enforcementMode:\n        \"CONTRACT_ONLY\",\n\n      productionWritersChanged:\n        false,\n\n      safety: {\n        databaseReads: 0,\n        databaseWrites: 0,\n        networkCalls: 0,\n        ordersCreated: 0,\n        ordersChanged: 0,\n        positionsChanged: 0,\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"RUN_TYPECHECK_AND_KILL_SWITCH_CONTRACT_TEST\"\n          : \"REVIEW_KILL_SWITCH_CONTRACT_V1_STATIC\",\n    },\n    null,\n    2,\n  ),\n);\n\nif (failed.length > 0) {\n  process.exitCode = 2;\n}\n",
  "utf8"
);

const tsconfigFile =
  path.resolve(
    root,
    tsconfigRel
  );

if (fs.existsSync(tsconfigFile)) {
  const tsconfig =
    JSON.parse(
      fs.readFileSync(
        tsconfigFile,
        "utf8"
      )
    );

  tsconfig.include =
    Array.isArray(tsconfig.include)
      ? tsconfig.include
      : [];

  if (
    !tsconfig.include.includes(
      contractRel
    )
  ) {
    tsconfig.include.push(
      contractRel
    );
  }

  fs.writeFileSync(
    tsconfigFile,
    JSON.stringify(
      tsconfig,
      null,
      2
    ) + "\n",
    "utf8"
  );
}

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_KILL_SWITCH_CONTRACT_V1_INSTALLED",

      generatedFiles: [
        contractRel,
        testRel,
        verifyRel
      ],

      enforcementMode:
        "CONTRACT_ONLY",

      productionWritersChanged:
        false,

      corePolicy: {
        authoritativeSource:
          "trading_system_control.emergency_stop",

        emergencyStopTrue:
          "BLOCK_NEW_RISK_ALLOW_PROTECTIVE_AND_OBSERVATIONAL_WORK",

        protectiveExitsRemainAllowed:
          true,

        schedulerMayContinue:
          true,

        automaticTripAllowed:
          true,

        automaticResetAllowed:
          false,

        manualResetAuditRequired:
          true
      },

      nextAction:
        "STATIC_VERIFY_TYPECHECK_AND_RUN_KILL_SWITCH_CONTRACT_TEST"
    },
    null,
    2
  )
);
