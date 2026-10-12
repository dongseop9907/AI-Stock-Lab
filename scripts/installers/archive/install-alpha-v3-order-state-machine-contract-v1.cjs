const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const contractRel =
  "lib/trading/order-state-machine.ts";

const testRel =
  "scripts/alpha-v3-order-state-machine-contract-v1-test.ts";

const verifyRel =
  "scripts/alpha-v3-order-state-machine-contract-v1-static-verify.cjs";

const tsconfigRel =
  "tsconfig.alpha-v3-production-cycle.json";

const contractFile =
  path.resolve(
    root,
    contractRel
  );

const testFile =
  path.resolve(
    root,
    testRel
  );

const verifyFile =
  path.resolve(
    root,
    verifyRel
  );

fs.mkdirSync(
  path.dirname(
    contractFile
  ),
  {
    recursive: true
  }
);

if (
  fs.existsSync(
    contractFile
  )
) {
  const backup =
    `${contractFile}.before-v1.bak`;

  if (
    !fs.existsSync(
      backup
    )
  ) {
    fs.copyFileSync(
      contractFile,
      backup
    );
  }
}

fs.writeFileSync(
  contractFile,
  "export const CANONICAL_ORDER_STATUSES = [\n  \"RISK_APPROVED\",\n  \"RISK_REJECTED\",\n  \"FILLED\",\n  \"EXPIRED\",\n  \"CANCELLED\",\n  \"FAILED\",\n] as const;\n\nexport type CanonicalOrderStatus =\n  (typeof CANONICAL_ORDER_STATUSES)[number];\n\nexport const LEGACY_ORDER_STATUS_ALIASES = {\n  CANCELED:\n    \"CANCELLED\",\n} as const;\n\nexport type LegacyOrderStatusAlias =\n  keyof typeof LEGACY_ORDER_STATUS_ALIASES;\n\nexport const LEGACY_OR_UNSUPPORTED_ORDER_STATUSES = [\n  \"APPROVED\",\n  \"PENDING\",\n  \"REJECTED\",\n  \"CLOSED\",\n] as const;\n\nexport type LegacyOrUnsupportedOrderStatus =\n  (typeof LEGACY_OR_UNSUPPORTED_ORDER_STATUSES)[number];\n\nexport const TERMINAL_ORDER_STATUSES = [\n  \"RISK_REJECTED\",\n  \"FILLED\",\n  \"EXPIRED\",\n  \"CANCELLED\",\n  \"FAILED\",\n] as const satisfies\n  readonly CanonicalOrderStatus[];\n\nexport const ORDER_CREATE_STATUSES = [\n  /*\n   * Committed-risk BUY creation path.\n   */\n  \"RISK_APPROVED\",\n  \"RISK_REJECTED\",\n\n  /*\n   * Existing system-executed order paths can insert\n   * an already-filled paper order directly.\n   */\n  \"FILLED\",\n] as const satisfies\n  readonly CanonicalOrderStatus[];\n\nexport const ORDER_STATE_TRANSITIONS:\n  Readonly<\n    Record<\n      CanonicalOrderStatus,\n      readonly CanonicalOrderStatus[]\n    >\n  > = {\n  /*\n   * Current production BUY lifecycle proven by:\n   * - committed-risk reservation creation\n   * - fill RPC\n   * - expiry/reconciliation layer\n   */\n  RISK_APPROVED: [\n    \"FILLED\",\n    \"EXPIRED\",\n  ],\n\n  /*\n   * Terminal states do not transition further.\n   * Same-state retries are handled separately as\n   * idempotent no-ops by validateOrderTransition().\n   */\n  RISK_REJECTED: [],\n  FILLED: [],\n  EXPIRED: [],\n  CANCELLED: [],\n  FAILED: [],\n};\n\nexport const RESERVED_FUTURE_TRANSITIONS = {\n  /*\n   * These states are intentionally recognized but are NOT\n   * enabled as transitions in V1 until their production\n   * writers are explicitly implemented/audited.\n   */\n  RISK_APPROVED: [\n    \"CANCELLED\",\n    \"FAILED\",\n  ],\n} as const;\n\nconst canonicalSet =\n  new Set<string>(\n    CANONICAL_ORDER_STATUSES,\n  );\n\nconst terminalSet =\n  new Set<string>(\n    TERMINAL_ORDER_STATUSES,\n  );\n\nconst createSet =\n  new Set<string>(\n    ORDER_CREATE_STATUSES,\n  );\n\nconst unsupportedSet =\n  new Set<string>(\n    LEGACY_OR_UNSUPPORTED_ORDER_STATUSES,\n  );\n\nexport type OrderStatusClassification =\n  | {\n      kind:\n        \"CANONICAL\";\n      input:\n        string;\n      canonical:\n        CanonicalOrderStatus;\n      legacyAlias:\n        false;\n    }\n  | {\n      kind:\n        \"LEGACY_ALIAS\";\n      input:\n        string;\n      canonical:\n        CanonicalOrderStatus;\n      legacyAlias:\n        true;\n    }\n  | {\n      kind:\n        \"LEGACY_UNSUPPORTED\";\n      input:\n        string;\n      canonical:\n        null;\n      legacyAlias:\n        false;\n    }\n  | {\n      kind:\n        \"UNKNOWN\";\n      input:\n        string;\n      canonical:\n        null;\n      legacyAlias:\n        false;\n    };\n\nexport function classifyOrderStatus(\n  value: unknown,\n): OrderStatusClassification {\n  const input =\n    typeof value ===\n    \"string\"\n      ? value\n          .trim()\n          .toUpperCase()\n      : \"\";\n\n  if (\n    canonicalSet.has(\n      input,\n    )\n  ) {\n    return {\n      kind:\n        \"CANONICAL\",\n      input,\n      canonical:\n        input as CanonicalOrderStatus,\n      legacyAlias:\n        false,\n    };\n  }\n\n  if (\n    Object.prototype.hasOwnProperty.call(\n      LEGACY_ORDER_STATUS_ALIASES,\n      input,\n    )\n  ) {\n    return {\n      kind:\n        \"LEGACY_ALIAS\",\n      input,\n      canonical:\n        LEGACY_ORDER_STATUS_ALIASES[\n          input as LegacyOrderStatusAlias\n        ],\n      legacyAlias:\n        true,\n    };\n  }\n\n  if (\n    unsupportedSet.has(\n      input,\n    )\n  ) {\n    return {\n      kind:\n        \"LEGACY_UNSUPPORTED\",\n      input,\n      canonical:\n        null,\n      legacyAlias:\n        false,\n    };\n  }\n\n  return {\n    kind:\n      \"UNKNOWN\",\n    input,\n    canonical:\n      null,\n    legacyAlias:\n      false,\n  };\n}\n\nexport function normalizeOrderStatus(\n  value: unknown,\n): CanonicalOrderStatus | null {\n  return classifyOrderStatus(\n    value,\n  ).canonical;\n}\n\nexport function isTerminalOrderStatus(\n  value: unknown,\n) {\n  const normalized =\n    normalizeOrderStatus(\n      value,\n    );\n\n  return (\n    normalized !== null &&\n    terminalSet.has(\n      normalized,\n    )\n  );\n}\n\nexport type OrderStateValidation =\n  | {\n      allowed:\n        true;\n      idempotent:\n        boolean;\n      from:\n        CanonicalOrderStatus | \"__CREATE__\";\n      to:\n        CanonicalOrderStatus;\n      reason:\n        \"CREATE_ALLOWED\" |\n        \"TRANSITION_ALLOWED\" |\n        \"IDEMPOTENT_NOOP\";\n    }\n  | {\n      allowed:\n        false;\n      idempotent:\n        false;\n      from:\n        CanonicalOrderStatus | \"__CREATE__\" | null;\n      to:\n        CanonicalOrderStatus | null;\n      reason:\n        \"UNSUPPORTED_FROM_STATUS\" |\n        \"UNSUPPORTED_TO_STATUS\" |\n        \"CREATE_STATUS_NOT_ALLOWED\" |\n        \"TERMINAL_STATE_CANNOT_TRANSITION\" |\n        \"TRANSITION_NOT_ALLOWED\";\n    };\n\nexport function validateOrderTransition(\n  fromValue:\n    unknown,\n  toValue:\n    unknown,\n): OrderStateValidation {\n  const to =\n    normalizeOrderStatus(\n      toValue,\n    );\n\n  if (!to) {\n    return {\n      allowed:\n        false,\n      idempotent:\n        false,\n      from:\n        null,\n      to:\n        null,\n      reason:\n        \"UNSUPPORTED_TO_STATUS\",\n    };\n  }\n\n  if (\n    fromValue ===\n    \"__CREATE__\"\n  ) {\n    if (\n      createSet.has(\n        to,\n      )\n    ) {\n      return {\n        allowed:\n          true,\n        idempotent:\n          false,\n        from:\n          \"__CREATE__\",\n        to,\n        reason:\n          \"CREATE_ALLOWED\",\n      };\n    }\n\n    return {\n      allowed:\n        false,\n      idempotent:\n        false,\n      from:\n        \"__CREATE__\",\n      to,\n      reason:\n        \"CREATE_STATUS_NOT_ALLOWED\",\n    };\n  }\n\n  const from =\n    normalizeOrderStatus(\n      fromValue,\n    );\n\n  if (!from) {\n    return {\n      allowed:\n        false,\n      idempotent:\n        false,\n      from:\n        null,\n      to,\n      reason:\n        \"UNSUPPORTED_FROM_STATUS\",\n    };\n  }\n\n  if (\n    from === to\n  ) {\n    return {\n      allowed:\n        true,\n      idempotent:\n        true,\n      from,\n      to,\n      reason:\n        \"IDEMPOTENT_NOOP\",\n    };\n  }\n\n  if (\n    terminalSet.has(\n      from,\n    )\n  ) {\n    return {\n      allowed:\n        false,\n      idempotent:\n        false,\n      from,\n      to,\n      reason:\n        \"TERMINAL_STATE_CANNOT_TRANSITION\",\n    };\n  }\n\n  const allowedTargets =\n    ORDER_STATE_TRANSITIONS[\n      from\n    ];\n\n  if (\n    allowedTargets.includes(\n      to,\n    )\n  ) {\n    return {\n      allowed:\n        true,\n      idempotent:\n        false,\n      from,\n      to,\n      reason:\n        \"TRANSITION_ALLOWED\",\n    };\n  }\n\n  return {\n    allowed:\n      false,\n    idempotent:\n      false,\n    from,\n    to,\n    reason:\n      \"TRANSITION_NOT_ALLOWED\",\n  };\n}\n\nexport const ORDER_STATE_MACHINE_V1 = {\n  version:\n    \"ALPHA_V3_ORDER_STATE_MACHINE_V1\",\n\n  enforcementMode:\n    \"CONTRACT_ONLY\",\n\n  canonicalStatuses:\n    CANONICAL_ORDER_STATUSES,\n\n  terminalStatuses:\n    TERMINAL_ORDER_STATUSES,\n\n  createStatuses:\n    ORDER_CREATE_STATUSES,\n\n  transitions:\n    ORDER_STATE_TRANSITIONS,\n\n  legacyAliases:\n    LEGACY_ORDER_STATUS_ALIASES,\n\n  legacyOrUnsupportedStatuses:\n    LEGACY_OR_UNSUPPORTED_ORDER_STATUSES,\n\n  reservedFutureTransitions:\n    RESERVED_FUTURE_TRANSITIONS,\n\n  invariants: [\n    \"TERMINAL_STATES_NEVER_TRANSITION_TO_A_DIFFERENT_STATE\",\n    \"SAME_STATE_RETRY_IS_IDEMPOTENT_NOOP\",\n    \"CANCELED_READS_AS_CANCELLED_BUT_NEW_WRITES_USE_CANCELLED\",\n    \"APPROVED_PENDING_REJECTED_CLOSED_ARE_NOT_CANONICAL_V1_ORDER_WRITES\",\n    \"RISK_APPROVED_CAN_ONLY_FILL_OR_EXPIRE_IN_V1\",\n    \"CANCELLED_AND_FAILED_ARE_RECOGNIZED_BUT_NOT_REACHABLE_UNTIL_WRITERS_ARE_AUDITED\",\n  ],\n} as const;\n",
  "utf8"
);

fs.mkdirSync(
  path.dirname(
    testFile
  ),
  {
    recursive: true
  }
);

fs.writeFileSync(
  testFile,
  "import {\n  ORDER_STATE_MACHINE_V1,\n  classifyOrderStatus,\n  isTerminalOrderStatus,\n  normalizeOrderStatus,\n  validateOrderTransition,\n} from \"../lib/trading/order-state-machine\";\n\ntype Scenario = {\n  name: string;\n  passed: boolean;\n  observed: unknown;\n};\n\nconst scenarios:\n  Scenario[] = [];\n\nfunction add(\n  name: string,\n  passed: boolean,\n  observed: unknown,\n) {\n  scenarios.push({\n    name,\n    passed,\n    observed,\n  });\n}\n\nconst createApproved =\n  validateOrderTransition(\n    \"__CREATE__\",\n    \"RISK_APPROVED\",\n  );\n\nadd(\n  \"CREATE_RISK_APPROVED_ALLOWED\",\n  createApproved.allowed ===\n    true &&\n    createApproved.reason ===\n      \"CREATE_ALLOWED\",\n  createApproved,\n);\n\nconst createRejected =\n  validateOrderTransition(\n    \"__CREATE__\",\n    \"RISK_REJECTED\",\n  );\n\nadd(\n  \"CREATE_RISK_REJECTED_ALLOWED\",\n  createRejected.allowed ===\n    true,\n  createRejected,\n);\n\nconst createFilled =\n  validateOrderTransition(\n    \"__CREATE__\",\n    \"FILLED\",\n  );\n\nadd(\n  \"DIRECT_CREATE_FILLED_ALLOWED\",\n  createFilled.allowed ===\n    true,\n  createFilled,\n);\n\nconst fill =\n  validateOrderTransition(\n    \"RISK_APPROVED\",\n    \"FILLED\",\n  );\n\nadd(\n  \"RISK_APPROVED_TO_FILLED_ALLOWED\",\n  fill.allowed ===\n    true &&\n    fill.reason ===\n      \"TRANSITION_ALLOWED\",\n  fill,\n);\n\nconst expire =\n  validateOrderTransition(\n    \"RISK_APPROVED\",\n    \"EXPIRED\",\n  );\n\nadd(\n  \"RISK_APPROVED_TO_EXPIRED_ALLOWED\",\n  expire.allowed ===\n    true,\n  expire,\n);\n\nconst cancelNotYetEnabled =\n  validateOrderTransition(\n    \"RISK_APPROVED\",\n    \"CANCELLED\",\n  );\n\nadd(\n  \"CANCEL_TRANSITION_RESERVED_NOT_ENABLED\",\n  cancelNotYetEnabled.allowed ===\n    false &&\n    cancelNotYetEnabled.reason ===\n      \"TRANSITION_NOT_ALLOWED\",\n  cancelNotYetEnabled,\n);\n\nconst failureNotYetEnabled =\n  validateOrderTransition(\n    \"RISK_APPROVED\",\n    \"FAILED\",\n  );\n\nadd(\n  \"FAILED_TRANSITION_RESERVED_NOT_ENABLED\",\n  failureNotYetEnabled.allowed ===\n    false &&\n    failureNotYetEnabled.reason ===\n      \"TRANSITION_NOT_ALLOWED\",\n  failureNotYetEnabled,\n);\n\nconst terminalCannotMove =\n  validateOrderTransition(\n    \"FILLED\",\n    \"EXPIRED\",\n  );\n\nadd(\n  \"TERMINAL_CANNOT_TRANSITION\",\n  terminalCannotMove.allowed ===\n    false &&\n    terminalCannotMove.reason ===\n      \"TERMINAL_STATE_CANNOT_TRANSITION\",\n  terminalCannotMove,\n);\n\nconst retry =\n  validateOrderTransition(\n    \"FILLED\",\n    \"FILLED\",\n  );\n\nadd(\n  \"SAME_STATE_RETRY_IDEMPOTENT\",\n  retry.allowed ===\n    true &&\n    retry.idempotent ===\n      true,\n  retry,\n);\n\nconst legacyAlias =\n  classifyOrderStatus(\n    \"CANCELED\",\n  );\n\nadd(\n  \"CANCELED_NORMALIZES_TO_CANCELLED\",\n  legacyAlias.kind ===\n    \"LEGACY_ALIAS\" &&\n    legacyAlias.canonical ===\n      \"CANCELLED\" &&\n    normalizeOrderStatus(\n      \"CANCELED\",\n    ) ===\n      \"CANCELLED\",\n  legacyAlias,\n);\n\nfor (\n  const unsupported of\n    [\n      \"APPROVED\",\n      \"PENDING\",\n      \"REJECTED\",\n      \"CLOSED\",\n    ]\n) {\n  const classification =\n    classifyOrderStatus(\n      unsupported,\n    );\n\n  add(\n    `LEGACY_UNSUPPORTED_${unsupported}`,\n    classification.kind ===\n      \"LEGACY_UNSUPPORTED\" &&\n    classification.canonical ===\n      null,\n    classification,\n  );\n}\n\nadd(\n  \"TERMINAL_RECOGNITION\",\n  [\n    \"RISK_REJECTED\",\n    \"FILLED\",\n    \"EXPIRED\",\n    \"CANCELLED\",\n    \"CANCELED\",\n    \"FAILED\",\n  ].every(\n    (status) =>\n      isTerminalOrderStatus(\n        status,\n      ),\n  ),\n  ORDER_STATE_MACHINE_V1\n    .terminalStatuses,\n);\n\nconst failed =\n  scenarios.filter(\n    (scenario) =>\n      !scenario.passed,\n  );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_ORDER_STATE_MACHINE_CONTRACT_V1_VERIFIED\"\n          : \"ALPHA_V3_ORDER_STATE_MACHINE_CONTRACT_V1_REVIEW\",\n\n      contract:\n        ORDER_STATE_MACHINE_V1,\n\n      summary: {\n        scenarioCount:\n          scenarios.length,\n\n        passedCount:\n          scenarios.length -\n          failed.length,\n\n        failedCount:\n          failed.length,\n      },\n\n      scenarios,\n\n      safety: {\n        databaseReads: 0,\n        databaseWrites: 0,\n        networkCalls: 0,\n        ordersCreated: 0,\n        ordersChanged: 0,\n        positionsChanged: 0,\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"AUDIT_AND_BIND_PRODUCTION_ORDER_WRITERS_TO_STATE_MACHINE\"\n          : \"REVIEW_ORDER_STATE_MACHINE_CONTRACT_V1\",\n    },\n    null,\n    2,\n  ),\n);\n\nif (\n  failed.length > 0\n) {\n  process.exitCode =\n    2;\n}\n",
  "utf8"
);

fs.writeFileSync(
  verifyFile,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst file = path.resolve(\n  root,\n  \"lib/trading/order-state-machine.ts\"\n);\n\nif (!fs.existsSync(file)) {\n  throw new Error(\n    \"ORDER_STATE_MACHINE_CONTRACT_NOT_FOUND\"\n  );\n}\n\nconst text =\n  fs.readFileSync(\n    file,\n    \"utf8\"\n  );\n\nconst checks = {\n  contractVersionPresent:\n    text.includes(\n      \"ALPHA_V3_ORDER_STATE_MACHINE_V1\"\n    ),\n\n  contractOnlyMode:\n    text.includes(\n      'enforcementMode:' +\n      '\\n    \"CONTRACT_ONLY\"'\n    ) ||\n    text.includes(\n      '\"CONTRACT_ONLY\"'\n    ),\n\n  riskApprovedCanonical:\n    text.includes(\n      '\"RISK_APPROVED\"'\n    ),\n\n  riskRejectedCanonical:\n    text.includes(\n      '\"RISK_REJECTED\"'\n    ),\n\n  filledCanonical:\n    text.includes(\n      '\"FILLED\"'\n    ),\n\n  expiredCanonical:\n    text.includes(\n      '\"EXPIRED\"'\n    ),\n\n  cancelledCanonical:\n    text.includes(\n      '\"CANCELLED\"'\n    ),\n\n  canceledLegacyAlias:\n    text.includes(\n      'CANCELED:' +\n      '\\n    \"CANCELLED\"'\n    ),\n\n  createRiskApproved:\n    /ORDER_CREATE_STATUSES[\\s\\S]{0,500}?\"RISK_APPROVED\"/m.test(\n      text\n    ),\n\n  createRiskRejected:\n    /ORDER_CREATE_STATUSES[\\s\\S]{0,500}?\"RISK_REJECTED\"/m.test(\n      text\n    ),\n\n  createFilled:\n    /ORDER_CREATE_STATUSES[\\s\\S]{0,500}?\"FILLED\"/m.test(\n      text\n    ),\n\n  riskApprovedToFilled:\n    /RISK_APPROVED:\\s*\\[[\\s\\S]{0,200}?\"FILLED\"/m.test(\n      text\n    ),\n\n  riskApprovedToExpired:\n    /RISK_APPROVED:\\s*\\[[\\s\\S]{0,200}?\"EXPIRED\"/m.test(\n      text\n    ),\n\n  cancelReservedNotEnabled:\n    /RESERVED_FUTURE_TRANSITIONS[\\s\\S]{0,300}?RISK_APPROVED:[\\s\\S]{0,200}?\"CANCELLED\"/m.test(\n      text\n    ),\n\n  failedReservedNotEnabled:\n    /RESERVED_FUTURE_TRANSITIONS[\\s\\S]{0,300}?RISK_APPROVED:[\\s\\S]{0,200}?\"FAILED\"/m.test(\n      text\n    ),\n\n  validatorPresent:\n    text.includes(\n      \"validateOrderTransition\"\n    ),\n\n  terminalGuardPresent:\n    text.includes(\n      \"TERMINAL_STATE_CANNOT_TRANSITION\"\n    ),\n\n  idempotentRetryPresent:\n    text.includes(\n      \"IDEMPOTENT_NOOP\"\n    ),\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(\n      ([, value]) =>\n        !value\n    )\n    .map(\n      ([key]) =>\n        key\n    );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_ORDER_STATE_MACHINE_CONTRACT_V1_STATIC_VERIFIED\"\n          : \"ALPHA_V3_ORDER_STATE_MACHINE_CONTRACT_V1_STATIC_REVIEW\",\n\n      checks,\n      failed,\n\n      enforcementMode:\n        \"CONTRACT_ONLY\",\n\n      productionWritersChanged:\n        false,\n\n      safety: {\n        databaseReads: 0,\n        databaseWrites: 0,\n        networkCalls: 0,\n        ordersCreated: 0,\n        ordersChanged: 0,\n        positionsChanged: 0,\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"RUN_TYPECHECK_AND_CONTRACT_TEST\"\n          : \"REVIEW_ORDER_STATE_MACHINE_CONTRACT_V1_STATIC\",\n    },\n    null,\n    2,\n  ),\n);\n\nif (\n  failed.length > 0\n) {\n  process.exitCode =\n    2;\n}\n",
  "utf8"
);

const tsconfigFile =
  path.resolve(
    root,
    tsconfigRel
  );

if (
  fs.existsSync(
    tsconfigFile
  )
) {
  const tsconfig =
    JSON.parse(
      fs.readFileSync(
        tsconfigFile,
        "utf8"
      )
    );

  tsconfig.include =
    Array.isArray(
      tsconfig.include
    )
      ? tsconfig.include
      : [];

  for (
    const rel of
      [
        contractRel
      ]
  ) {
    if (
      !tsconfig.include.includes(
        rel
      )
    ) {
      tsconfig.include.push(
        rel
      );
    }
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
        "ALPHA_V3_ORDER_STATE_MACHINE_CONTRACT_V1_INSTALLED",

      generatedFiles: [
        contractRel,
        testRel,
        verifyRel
      ],

      enforcementMode:
        "CONTRACT_ONLY",

      productionWritersChanged:
        false,

      canonicalPolicy: {
        createStatuses: [
          "RISK_APPROVED",
          "RISK_REJECTED",
          "FILLED"
        ],

        activeTransition: {
          RISK_APPROVED: [
            "FILLED",
            "EXPIRED"
          ]
        },

        cancellationWrite:
          "CANCELLED",

        cancellationReadAlias:
          "CANCELED",

        unsupportedLegacyStates: [
          "APPROVED",
          "PENDING",
          "REJECTED",
          "CLOSED"
        ],

        reservedButNotEnabledYet: {
          RISK_APPROVED: [
            "CANCELLED",
            "FAILED"
          ]
        }
      },

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        ordersChanged: 0,
        positionsChanged: 0
      },

      nextAction:
        "STATIC_VERIFY_TYPECHECK_AND_RUN_CONTRACT_TEST"
    },
    null,
    2
  )
);
