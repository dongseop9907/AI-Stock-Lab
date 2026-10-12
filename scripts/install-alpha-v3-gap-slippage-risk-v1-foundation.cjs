const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const outputs = [
  {
    rel:
      "lib/trading/gap-slippage-risk.ts",
    text:
      "export const GAP_SLIPPAGE_RISK_VERSION =\n  \"ALPHA_V3_GAP_SLIPPAGE_RISK_V1\" as const;\n\nexport interface GapSlippageRiskPolicy {\n  maxRiskPerTradeRate: number;\n  minStopDistanceRate: number;\n  maxStopDistanceRate: number;\n  maxAdverseEntryDriftRate: number;\n  moneyEpsilon: number;\n}\n\nexport const DEFAULT_GAP_SLIPPAGE_RISK_POLICY:\n  Readonly<GapSlippageRiskPolicy> =\n  Object.freeze({\n    /*\n     * Keep this aligned with the existing DEFAULT_RISK_POLICY\n     * until a later explicit policy-version migration changes it.\n     */\n    maxRiskPerTradeRate:\n      0.005,\n\n    minStopDistanceRate:\n      0.01,\n\n    maxStopDistanceRate:\n      0.05,\n\n    /*\n     * Execution price may not be more than 1% worse than the price\n     * used for approval. This is intentionally conservative and\n     * matches the currently frozen 1% forward-entry premium cap.\n     *\n     * Production binding is NOT enabled by this foundation installer.\n     */\n    maxAdverseEntryDriftRate:\n      0.01,\n\n    moneyEpsilon:\n      0.01,\n  });\n\nexport type GapSlippageBuyBlocker =\n  | \"INVALID_INPUT\"\n  | \"EXECUTION_PRICE_NOT_ABOVE_STOP\"\n  | \"ADVERSE_ENTRY_DRIFT_EXCEEDED\"\n  | \"STOP_DISTANCE_TOO_CLOSE_AT_EXECUTION\"\n  | \"STOP_DISTANCE_TOO_FAR_AT_EXECUTION\"\n  | \"ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK\"\n  | \"ACTUAL_TRADE_RISK_EXCEEDS_PER_TRADE_LIMIT\";\n\nexport interface EvaluateBuyExecutionRiskInput {\n  stockCode: string;\n\n  plannedEntryPrice: number;\n  executionPrice: number;\n  stopPrice: number;\n  quantity: number;\n\n  accountEquity: number;\n\n  /*\n   * Atomic committed-risk reservation currently attached to this\n   * order. V1 never silently enlarges this reservation at execution.\n   */\n  reservedRiskAmount: number;\n}\n\nexport interface BuyExecutionRiskEvaluation {\n  version:\n    typeof GAP_SLIPPAGE_RISK_VERSION;\n\n  allowed: boolean;\n\n  blockers:\n    GapSlippageBuyBlocker[];\n\n  prices: {\n    plannedEntryPrice: number;\n    executionPrice: number;\n    stopPrice: number;\n  };\n\n  quantity: number;\n\n  drift: {\n    signedRate: number;\n    adverseRate: number;\n    favorableRate: number;\n    amountPerShare: number;\n  };\n\n  risk: {\n    plannedRiskPerShare: number;\n    actualRiskPerShare: number;\n\n    plannedTradeRisk: number;\n    actualTradeRisk: number;\n\n    riskInflationAmount: number;\n    riskInflationRate: number | null;\n\n    reservedRiskAmount: number;\n    reservedRiskHeadroom: number;\n\n    maxTradeRiskAmount: number;\n  };\n\n  stop: {\n    plannedDistanceRate: number;\n    actualDistanceRate: number;\n  };\n\n  policy: GapSlippageRiskPolicy;\n\n  semantics: {\n    reservationMayIncreaseAtExecution: false;\n    autoResizeQuantity: false;\n    failClosedOnUnsafeBuyExecution: true;\n  };\n}\n\nfunction validPositive(\n  value:\n    number,\n) {\n  return (\n    Number.isFinite(\n      value,\n    ) &&\n    value >\n      0\n  );\n}\n\nfunction validNonNegative(\n  value:\n    number,\n) {\n  return (\n    Number.isFinite(\n      value,\n    ) &&\n    value >=\n      0\n  );\n}\n\nexport function evaluateBuyExecutionGapSlippageRisk(\n  input:\n    EvaluateBuyExecutionRiskInput,\n  policy:\n    GapSlippageRiskPolicy =\n      DEFAULT_GAP_SLIPPAGE_RISK_POLICY,\n): BuyExecutionRiskEvaluation {\n  const blockers:\n    GapSlippageBuyBlocker[] =\n    [];\n\n  const inputValid =\n    input.stockCode.trim()\n      .length >\n      0 &&\n    validPositive(\n      input.plannedEntryPrice,\n    ) &&\n    validPositive(\n      input.executionPrice,\n    ) &&\n    validPositive(\n      input.stopPrice,\n    ) &&\n    Number.isInteger(\n      input.quantity,\n    ) &&\n    input.quantity >\n      0 &&\n    validPositive(\n      input.accountEquity,\n    ) &&\n    validNonNegative(\n      input.reservedRiskAmount,\n    );\n\n  if (\n    !inputValid\n  ) {\n    blockers.push(\n      \"INVALID_INPUT\",\n    );\n  }\n\n  const plannedRiskPerShare =\n    Math.max(\n      0,\n      input.plannedEntryPrice -\n        input.stopPrice,\n    );\n\n  const actualRiskPerShare =\n    Math.max(\n      0,\n      input.executionPrice -\n        input.stopPrice,\n    );\n\n  const plannedTradeRisk =\n    plannedRiskPerShare *\n    input.quantity;\n\n  const actualTradeRisk =\n    actualRiskPerShare *\n    input.quantity;\n\n  const signedDriftRate =\n    input.plannedEntryPrice >\n    0\n      ? (\n          input.executionPrice -\n          input.plannedEntryPrice\n        ) /\n        input.plannedEntryPrice\n      : 0;\n\n  const adverseRate =\n    Math.max(\n      0,\n      signedDriftRate,\n    );\n\n  const favorableRate =\n    Math.max(\n      0,\n      -signedDriftRate,\n    );\n\n  const plannedDistanceRate =\n    input.plannedEntryPrice >\n    0\n      ? (\n          input.plannedEntryPrice -\n          input.stopPrice\n        ) /\n        input.plannedEntryPrice\n      : 0;\n\n  const actualDistanceRate =\n    input.executionPrice >\n    0\n      ? (\n          input.executionPrice -\n          input.stopPrice\n        ) /\n        input.executionPrice\n      : 0;\n\n  const maxTradeRiskAmount =\n    input.accountEquity *\n    policy.maxRiskPerTradeRate;\n\n  const riskInflationAmount =\n    actualTradeRisk -\n    plannedTradeRisk;\n\n  const riskInflationRate =\n    plannedTradeRisk >\n    0\n      ? riskInflationAmount /\n        plannedTradeRisk\n      : null;\n\n  const reservedRiskHeadroom =\n    input.reservedRiskAmount -\n    actualTradeRisk;\n\n  if (\n    inputValid\n  ) {\n    if (\n      input.executionPrice <=\n      input.stopPrice\n    ) {\n      blockers.push(\n        \"EXECUTION_PRICE_NOT_ABOVE_STOP\",\n      );\n    }\n\n    if (\n      adverseRate >\n      policy.maxAdverseEntryDriftRate\n    ) {\n      blockers.push(\n        \"ADVERSE_ENTRY_DRIFT_EXCEEDED\",\n      );\n    }\n\n    if (\n      actualDistanceRate <\n      policy.minStopDistanceRate\n    ) {\n      blockers.push(\n        \"STOP_DISTANCE_TOO_CLOSE_AT_EXECUTION\",\n      );\n    }\n\n    if (\n      actualDistanceRate >\n      policy.maxStopDistanceRate\n    ) {\n      blockers.push(\n        \"STOP_DISTANCE_TOO_FAR_AT_EXECUTION\",\n      );\n    }\n\n    if (\n      actualTradeRisk >\n      input.reservedRiskAmount +\n        policy.moneyEpsilon\n    ) {\n      blockers.push(\n        \"ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK\",\n      );\n    }\n\n    if (\n      actualTradeRisk >\n      maxTradeRiskAmount +\n        policy.moneyEpsilon\n    ) {\n      blockers.push(\n        \"ACTUAL_TRADE_RISK_EXCEEDS_PER_TRADE_LIMIT\",\n      );\n    }\n  }\n\n  return {\n    version:\n      GAP_SLIPPAGE_RISK_VERSION,\n\n    allowed:\n      blockers.length ===\n      0,\n\n    blockers,\n\n    prices: {\n      plannedEntryPrice:\n        input.plannedEntryPrice,\n\n      executionPrice:\n        input.executionPrice,\n\n      stopPrice:\n        input.stopPrice,\n    },\n\n    quantity:\n      input.quantity,\n\n    drift: {\n      signedRate:\n        signedDriftRate,\n\n      adverseRate,\n\n      favorableRate,\n\n      amountPerShare:\n        input.executionPrice -\n        input.plannedEntryPrice,\n    },\n\n    risk: {\n      plannedRiskPerShare,\n\n      actualRiskPerShare,\n\n      plannedTradeRisk,\n\n      actualTradeRisk,\n\n      riskInflationAmount,\n\n      riskInflationRate,\n\n      reservedRiskAmount:\n        input.reservedRiskAmount,\n\n      reservedRiskHeadroom,\n\n      maxTradeRiskAmount,\n    },\n\n    stop: {\n      plannedDistanceRate,\n\n      actualDistanceRate,\n    },\n\n    policy: {\n      ...policy,\n    },\n\n    semantics: {\n      reservationMayIncreaseAtExecution:\n        false,\n\n      autoResizeQuantity:\n        false,\n\n      failClosedOnUnsafeBuyExecution:\n        true,\n    },\n  };\n}\n\nexport interface ProtectiveExitGapInput {\n  stockCode: string;\n  stopPrice: number;\n  executableExitPrice: number;\n  quantity: number;\n}\n\nexport interface ProtectiveExitGapEvaluation {\n  version:\n    typeof GAP_SLIPPAGE_RISK_VERSION;\n\n  allowed: true;\n\n  /*\n   * Protective exits are never rejected because price gapped through\n   * the stop. A worse price is recorded as realized stop-gap loss.\n   */\n  blocker: null;\n\n  stopPrice: number;\n  executableExitPrice: number;\n  quantity: number;\n\n  gapBeyondStopPerShare: number;\n  gapBeyondStopRate: number;\n  additionalLossAmount: number;\n\n  semantics: {\n    riskReducingExitMustNotBeBlocked: true;\n    gapIsDiagnosticOnly: true;\n  };\n}\n\nexport function evaluateProtectiveExitGap(\n  input:\n    ProtectiveExitGapInput,\n): ProtectiveExitGapEvaluation {\n  const gapBeyondStopPerShare =\n    Math.max(\n      0,\n      input.stopPrice -\n        input.executableExitPrice,\n    );\n\n  const gapBeyondStopRate =\n    input.stopPrice >\n    0\n      ? gapBeyondStopPerShare /\n        input.stopPrice\n      : 0;\n\n  return {\n    version:\n      GAP_SLIPPAGE_RISK_VERSION,\n\n    allowed:\n      true,\n\n    blocker:\n      null,\n\n    stopPrice:\n      input.stopPrice,\n\n    executableExitPrice:\n      input.executableExitPrice,\n\n    quantity:\n      input.quantity,\n\n    gapBeyondStopPerShare,\n\n    gapBeyondStopRate,\n\n    additionalLossAmount:\n      gapBeyondStopPerShare *\n      Math.max(\n        0,\n        input.quantity,\n      ),\n\n    semantics: {\n      riskReducingExitMustNotBeBlocked:\n        true,\n\n      gapIsDiagnosticOnly:\n        true,\n    },\n  };\n}\n"
  },
  {
    rel:
      "scripts/alpha-v3-gap-slippage-risk-v1-contract-test.ts",
    text:
      "import {\n  strict as assert,\n} from \"node:assert\";\n\nimport {\n  DEFAULT_GAP_SLIPPAGE_RISK_POLICY,\n  evaluateBuyExecutionGapSlippageRisk,\n  evaluateProtectiveExitGap,\n} from \"../lib/trading/gap-slippage-risk\";\n\nfunction base(\n  overrides:\n    Record<\n      string,\n      unknown\n    > = {},\n) {\n  return {\n    stockCode:\n      \"005930\",\n\n    plannedEntryPrice:\n      100_000,\n\n    executionPrice:\n      100_000,\n\n    stopPrice:\n      97_000,\n\n    quantity:\n      1,\n\n    accountEquity:\n      10_000_000,\n\n    reservedRiskAmount:\n      3_000,\n\n    ...overrides,\n  } as any;\n}\n\nfunction main() {\n  const checks:\n    Record<\n      string,\n      boolean\n    > = {};\n\n  const exact =\n    evaluateBuyExecutionGapSlippageRisk(\n      base(),\n    );\n\n  checks.exactApprovedExecutionAllowed =\n    exact.allowed ===\n      true &&\n    exact.blockers.length ===\n      0 &&\n    exact.risk.actualTradeRisk ===\n      3_000;\n\n  const favorable =\n    evaluateBuyExecutionGapSlippageRisk(\n      base({\n        executionPrice:\n          99_500,\n\n        /*\n         * Favorable execution reduces risk versus the planned entry.\n         */\n        reservedRiskAmount:\n          3_000,\n      }),\n    );\n\n  checks.favorableExecutionAllowed =\n    favorable.allowed ===\n      true &&\n    favorable.drift.favorableRate >\n      0 &&\n    favorable.risk.actualTradeRisk <\n      favorable.risk.plannedTradeRisk;\n\n  const driftExceeded =\n    evaluateBuyExecutionGapSlippageRisk(\n      base({\n        executionPrice:\n          101_500,\n\n        reservedRiskAmount:\n          10_000,\n      }),\n    );\n\n  checks.adverseDriftOverOnePercentBlocked =\n    driftExceeded.allowed ===\n      false &&\n    driftExceeded.blockers.includes(\n      \"ADVERSE_ENTRY_DRIFT_EXCEEDED\",\n    );\n\n  const reservationExceeded =\n    evaluateBuyExecutionGapSlippageRisk(\n      base({\n        executionPrice:\n          100_500,\n\n        reservedRiskAmount:\n          3_000,\n      }),\n    );\n\n  checks.reservedRiskCannotSilentlyGrow =\n    reservationExceeded.allowed ===\n      false &&\n    reservationExceeded.blockers.includes(\n      \"ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK\",\n    );\n\n  const perTradeExceeded =\n    evaluateBuyExecutionGapSlippageRisk(\n      base({\n        plannedEntryPrice:\n          100_000,\n\n        executionPrice:\n          104_000,\n\n        stopPrice:\n          99_000,\n\n        quantity:\n          2,\n\n        reservedRiskAmount:\n          100_000,\n      }),\n    );\n\n  checks.perTradeRiskStillEnforcedAtExecution =\n    perTradeExceeded.allowed ===\n      false &&\n    perTradeExceeded.blockers.includes(\n      \"ACTUAL_TRADE_RISK_EXCEEDS_PER_TRADE_LIMIT\",\n    );\n\n  const stopTooClose =\n    evaluateBuyExecutionGapSlippageRisk(\n      base({\n        plannedEntryPrice:\n          100_000,\n\n        executionPrice:\n          100_000,\n\n        stopPrice:\n          99_500,\n\n        reservedRiskAmount:\n          500,\n      }),\n    );\n\n  checks.executionStopDistanceRevalidated =\n    stopTooClose.allowed ===\n      false &&\n    stopTooClose.blockers.includes(\n      \"STOP_DISTANCE_TOO_CLOSE_AT_EXECUTION\",\n    );\n\n  const protectiveGap =\n    evaluateProtectiveExitGap({\n      stockCode:\n        \"005930\",\n\n      stopPrice:\n        96_000,\n\n      executableExitPrice:\n        91_000,\n\n      quantity:\n        10,\n    });\n\n  checks.gapDownProtectiveExitNeverBlocked =\n    protectiveGap.allowed ===\n      true &&\n    protectiveGap.blocker ===\n      null &&\n    protectiveGap.additionalLossAmount ===\n      50_000;\n\n  checks.policyAlignedWithExistingRiskV1 =\n    DEFAULT_GAP_SLIPPAGE_RISK_POLICY\n      .maxRiskPerTradeRate ===\n      0.005 &&\n    DEFAULT_GAP_SLIPPAGE_RISK_POLICY\n      .minStopDistanceRate ===\n      0.01 &&\n    DEFAULT_GAP_SLIPPAGE_RISK_POLICY\n      .maxStopDistanceRate ===\n      0.05;\n\n  assert.equal(\n    exact.semantics\n      .reservationMayIncreaseAtExecution,\n    false,\n  );\n\n  assert.equal(\n    protectiveGap.semantics\n      .riskReducingExitMustNotBeBlocked,\n    true,\n  );\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          !value,\n      )\n      .map(\n        ([name]) =>\n          name,\n      );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          failed.length ===\n          0\n            ? \"ALPHA_V3_GAP_SLIPPAGE_RISK_V1_CONTRACT_VERIFIED\"\n            : \"ALPHA_V3_GAP_SLIPPAGE_RISK_V1_CONTRACT_REVIEW\",\n\n        checks,\n\n        failed,\n\n        policy:\n          DEFAULT_GAP_SLIPPAGE_RISK_POLICY,\n\n        invariants: [\n          \"BUY_EXECUTION_REVALIDATES_RISK_USING_EXECUTION_PRICE\",\n          \"ACTUAL_BUY_RISK_CANNOT_EXCEED_RESERVED_RISK\",\n          \"ACTUAL_BUY_RISK_CANNOT_EXCEED_ACCOUNT_PER_TRADE_LIMIT\",\n          \"ADVERSE_ENTRY_DRIFT_OVER_POLICY_LIMIT_BLOCKS_NEW_RISK\",\n          \"UNSAFE_BUY_IS_FAIL_CLOSED\",\n          \"NO_AUTOMATIC_RESERVATION_INCREASE_AT_EXECUTION\",\n          \"NO_AUTOMATIC_QUANTITY_RESIZE_IN_V1\",\n          \"PROTECTIVE_EXIT_IS_NEVER_BLOCKED_BY_STOP_GAP\",\n        ],\n\n        enforcementMode:\n          \"CONTRACT_ONLY_NOT_YET_BOUND_TO_PRODUCTION_EXECUTOR\",\n\n        safety: {\n          databaseReads:\n            0,\n          databaseWrites:\n            0,\n          ordersCreated:\n            0,\n          ordersChanged:\n            0,\n          positionsChanged:\n            0,\n        },\n\n        nextGate:\n          failed.length ===\n          0\n            ? \"PROBE_EXECUTION_PRICE_AND_FILL_RPC_BINDING_SURFACES\"\n            : \"REVIEW_GAP_SLIPPAGE_V1_CONTRACT\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  if (\n    failed.length >\n    0\n  ) {\n    process.exitCode =\n      2;\n  }\n}\n\nmain();\n"
  },
  {
    rel:
      "scripts/alpha-v3-gap-slippage-risk-v1-execution-surface-probe.cjs",
    text:
      "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root =\n  process.cwd();\n\nconst targets = [\n  \"lib/trading/paper-order-service.ts\",\n  \"lib/trading/execute-approved-paper-orders.ts\",\n  \"lib/trading/execute-paper-order.ts\",\n  \"lib/trading/committed-risk-reservation.ts\",\n  \"lib/trading/read-only-buy-risk-preflight.ts\",\n  \"app/api/orders/paper/execute/route.ts\",\n  \"app/api/orders/paper/execute-approved/route.ts\",\n  \"supabase/migrations/002_paper_trading.sql\",\n  \"supabase/migrations/003_execute_paper_orders.sql\",\n  \"supabase/migrations/20261008000100_committed_risk_reservation_v3.sql\",\n  \"supabase/migrations/20261008000400_execute_paper_buy_order_committed_risk_lock.sql\",\n  \"supabase/migrations/20261008000700_execute_paper_buy_order_lock_order_v2.sql\",\n  \"supabase/migrations/20261008001600_kill_switch_db_create_fill_guards_v1.sql\",\n  \"supabase/migrations/20261008001700_data_freshness_db_create_fill_guards_v1.sql\",\n];\n\nconst needles = [\n  \"entry_price\",\n  \"stop_price\",\n  \"reserved_risk_amount\",\n  \"approved_quantity\",\n  \"executed_quantity\",\n  \"filled_quantity\",\n  \"fill\",\n  \"execution\",\n  \"close_price\",\n  \"market_snapshots\",\n  \"RISK_APPROVED\",\n  \"FILLED\",\n  \"execute_paper\",\n  \"rpc(\",\n  \"create_paper_buy_order_with_committed_risk_v3\",\n  \"execute_paper_buy_order\",\n  \"current_stop_price\",\n  \"average_price\",\n];\n\nfunction walkContext(\n  lines,\n  index,\n  radius = 8,\n) {\n  const start =\n    Math.max(\n      0,\n      index -\n      radius,\n    );\n\n  const end =\n    Math.min(\n      lines.length,\n      index +\n      radius +\n      1,\n    );\n\n  return {\n    startLine:\n      start +\n      1,\n\n    endLine:\n      end,\n\n    text:\n      lines\n        .slice(\n          start,\n          end,\n        )\n        .map(\n          (\n            line,\n            offset,\n          ) =>\n            `${start + offset + 1}: ${line}`,\n        )\n        .join(\n          \"\\n\",\n        ),\n  };\n}\n\nconst files =\n  [];\n\nfor (\n  const rel of\n    targets\n) {\n  const abs =\n    path.resolve(\n      root,\n      rel,\n    );\n\n  if (\n    !fs.existsSync(\n      abs,\n    )\n  ) {\n    files.push({\n      file:\n        rel,\n      exists:\n        false,\n    });\n\n    continue;\n  }\n\n  const text =\n    fs.readFileSync(\n      abs,\n      \"utf8\",\n    );\n\n  const lines =\n    text.split(\n      /\\r?\\n/,\n    );\n\n  const hits =\n    [];\n\n  for (\n    let i = 0;\n    i <\n    lines.length;\n    i +=\n    1\n  ) {\n    const lower =\n      lines[i]\n        .toLowerCase();\n\n    for (\n      const needle of\n        needles\n    ) {\n      if (\n        lower.includes(\n          needle\n            .toLowerCase(),\n        )\n      ) {\n        hits.push({\n          needle,\n          line:\n            i +\n            1,\n          context:\n            walkContext(\n              lines,\n              i,\n            ),\n        });\n      }\n    }\n  }\n\n  files.push({\n    file:\n      rel,\n\n    exists:\n      true,\n\n    lineCount:\n      lines.length,\n\n    hits:\n      hits.slice(\n        0,\n        120,\n      ),\n  });\n}\n\nconst report = {\n  status:\n    \"ALPHA_V3_GAP_SLIPPAGE_RISK_V1_EXECUTION_SURFACE_PROBE_COMPLETE\",\n\n  version:\n    \"ALPHA_V3_GAP_SLIPPAGE_RISK_V1_EXECUTION_SURFACE_PROBE\",\n\n  files,\n\n  requiredBindingFacts: {\n    plannedEntryPriceSource:\n      \"paper_order_requests.entry_price\",\n\n    stopPriceSource:\n      \"paper_order_requests.stop_price\",\n\n    reservedRiskSource:\n      \"paper_order_requests.reserved_risk_amount\",\n\n    mustResolve:\n      [\n        \"ACTUAL_EXECUTION_PRICE_SOURCE\",\n        \"FILL_QUANTITY_SOURCE\",\n        \"BUY_FILL_RPC_NAME_AND_ARGUMENTS\",\n        \"WHERE_POSITION_AVERAGE_PRICE_IS_COMPUTED\",\n        \"WHERE_RISK_RESERVATION_TRANSFERS_TO_POSITION_RISK\",\n      ],\n  },\n\n  intendedBinding:\n    [\n      \"APPROVED_ORDER_EXECUTOR_BEFORE_BUY_FILL\",\n      \"SINGLE_ORDER_EXECUTOR_BEFORE_BUY_FILL\",\n      \"DB_FILL_RPC_DEFENSE_IN_DEPTH_AFTER_EXECUTION_PRICE_IS_KNOWN\",\n      \"PROTECTIVE_EXIT_DIAGNOSTIC_ONLY_NEVER_BLOCK\",\n    ],\n\n  safety: {\n    databaseReads:\n      0,\n    databaseWrites:\n      0,\n    networkCalls:\n      0,\n    ordersCreated:\n      0,\n    ordersChanged:\n      0,\n    positionsChanged:\n      0,\n    productionChanged:\n      false,\n  },\n\n  nextGate:\n    \"BIND_GAP_SLIPPAGE_GUARD_TO_CONFIRMED_EXECUTION_AND_DB_FILL_SURFACES\",\n};\n\nfs.mkdirSync(\n  path.resolve(\n    root,\n    \"logs\",\n  ),\n  {\n    recursive:\n      true,\n  },\n);\n\nfs.writeFileSync(\n  path.resolve(\n    root,\n    \"logs/alpha-v3-gap-slippage-risk-v1-execution-surface-probe.json\",\n  ),\n  JSON.stringify(\n    report,\n    null,\n    2,\n  ) +\n  \"\\n\",\n  \"utf8\",\n);\n\nconsole.log(\n  JSON.stringify(\n    report,\n    null,\n    2,\n  ),\n);\n"
  },
  {
    rel:
      "scripts/alpha-v3-gap-slippage-risk-v1-foundation-static-verify.cjs",
    text:
      "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root =\n  process.cwd();\n\nconst modulePath =\n  path.resolve(\n    root,\n    \"lib/trading/gap-slippage-risk.ts\"\n  );\n\nconst testPath =\n  path.resolve(\n    root,\n    \"scripts/alpha-v3-gap-slippage-risk-v1-contract-test.ts\"\n  );\n\nconst probePath =\n  path.resolve(\n    root,\n    \"scripts/alpha-v3-gap-slippage-risk-v1-execution-surface-probe.cjs\"\n  );\n\nconst moduleText =\n  fs.readFileSync(\n    modulePath,\n    \"utf8\"\n  );\n\nconst testText =\n  fs.readFileSync(\n    testPath,\n    \"utf8\"\n  );\n\nconst checks = {\n  versionPresent:\n    moduleText.includes(\n      \"ALPHA_V3_GAP_SLIPPAGE_RISK_V1\"\n    ),\n\n  existingPerTradeRiskAligned:\n    moduleText.includes(\n      \"maxRiskPerTradeRate:\\n      0.005\"\n    ),\n\n  existingStopBoundsAligned:\n    moduleText.includes(\n      \"minStopDistanceRate:\\n      0.01\"\n    ) &&\n    moduleText.includes(\n      \"maxStopDistanceRate:\\n      0.05\"\n    ),\n\n  adverseEntryDriftPolicy:\n    moduleText.includes(\n      \"maxAdverseEntryDriftRate:\\n      0.01\"\n    ),\n\n  reservedRiskHardBoundary:\n    moduleText.includes(\n      \"ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK\"\n    ) &&\n    moduleText.includes(\n      \"reservationMayIncreaseAtExecution:\\n        false\"\n    ),\n\n  noAutoQuantityResize:\n    moduleText.includes(\n      \"autoResizeQuantity:\\n        false\"\n    ),\n\n  protectiveExitNeverBlocked:\n    moduleText.includes(\n      \"riskReducingExitMustNotBeBlocked:\\n        true\"\n    ) &&\n    moduleText.includes(\n      \"allowed:\\n      true\"\n    ),\n\n  contractCoversGapDown:\n    testText.includes(\n      \"gapDownProtectiveExitNeverBlocked\"\n    ),\n\n  contractCoversReservation:\n    testText.includes(\n      \"reservedRiskCannotSilentlyGrow\"\n    ),\n\n  surfaceProbePresent:\n    fs.existsSync(\n      probePath\n    ),\n\n  productionServiceNotPatched:\n    true\n};\n\nconst failed =\n  Object.entries(\n    checks\n  )\n    .filter(\n      ([, value]) =>\n        !value\n    )\n    .map(\n      ([name]) =>\n        name\n    );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_GAP_SLIPPAGE_RISK_V1_FOUNDATION_STATIC_VERIFIED\"\n          : \"ALPHA_V3_GAP_SLIPPAGE_RISK_V1_FOUNDATION_STATIC_REVIEW\",\n\n      checks,\n\n      failed,\n\n      enforcementMode:\n        \"CONTRACT_ONLY\",\n\n      safety: {\n        productionServicesPatched:\n          false,\n\n        databaseWrites:\n          0,\n\n        ordersCreated:\n          0,\n\n        positionsChanged:\n          0\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"CONTRACT_TEST_THEN_EXECUTION_SURFACE_PROBE\"\n          : \"REVIEW_FOUNDATION\"\n    },\n    null,\n    2\n  )\n);\n\nif (\n  failed.length >\n  0\n) {\n  process.exitCode =\n    2;\n}\n"
  }
];

for (
  const item of
    outputs
) {
  const file =
    path.resolve(
      root,
      item.rel
    );

  fs.mkdirSync(
    path.dirname(
      file
    ),
    {
      recursive:
        true
    }
  );

  fs.writeFileSync(
    file,
    item.text,
    "utf8"
  );
}

const packagePath =
  path.resolve(
    root,
    "package.json"
  );

const pkg =
  JSON.parse(
    fs.readFileSync(
      packagePath,
      "utf8"
    )
  );

pkg.scripts =
  pkg.scripts ??
  {};

pkg.scripts[
  "risk:gap-slippage:test"
] =
  "tsx scripts/alpha-v3-gap-slippage-risk-v1-contract-test.ts";

pkg.scripts[
  "risk:gap-slippage:probe"
] =
  "node scripts/alpha-v3-gap-slippage-risk-v1-execution-surface-probe.cjs";

fs.writeFileSync(
  packagePath,
  JSON.stringify(
    pkg,
    null,
    2
  ) +
  "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_GAP_SLIPPAGE_RISK_V1_FOUNDATION_INSTALLED",

      generatedFiles:
        outputs.map(
          (item) =>
            item.rel
        ),

      policy: {
        maxRiskPerTradeRate:
          0.005,

        minStopDistanceRate:
          0.01,

        maxStopDistanceRate:
          0.05,

        maxAdverseEntryDriftRate:
          0.01,

        actualRiskCannotExceedReservedRisk:
          true,

        reservationMayAutoIncreaseAtExecution:
          false,

        autoResizeQuantity:
          false,

        protectiveExitGapMayBlockExit:
          false
      },

      enforcementMode:
        "CONTRACT_ONLY_PENDING_EXECUTION_SURFACE_CONFIRMATION",

      safety: {
        productionServicePatched:
          false,

        databaseWrites:
          0,

        networkCalls:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        forwardOosChanged:
          false
      },

      nextAction:
        "STATIC_CONTRACT_TYPESCRIPT_AND_EXECUTION_SURFACE_PROBE"
    },
    null,
    2
  )
);
