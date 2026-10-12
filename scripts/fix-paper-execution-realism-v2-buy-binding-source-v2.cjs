const fs = require("fs");
const path = require("path");

const root = process.cwd();

const executorRel =
  "lib/trading/execute-paper-order.ts";

const migrationV1Rel =
  "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql";

const migrationV2Rel =
  "supabase/migrations/20261009000100_paper_execution_realism_v2_buy_partial_fill.sql";

const helperRel =
  "lib/trading/resolve-paper-execution-realism-v2-market-input.ts";

const contractRel =
  "scripts/paper-execution-realism-v2-buy-binding-contract-test.ts";

const staticRel =
  "scripts/paper-execution-realism-v2-buy-binding-static-verify.cjs";

const embedded = {"helper": "export interface PaperExecutionRealismV2MarketInput {\n  intervalVolume: number | null;\n  latestObservedAt: string | null;\n  previousObservedAt: string | null;\n  source:\n    | \"MARKET_SNAPSHOT_VOLUME_DELTA\"\n    | \"NO_USABLE_VOLUME_DELTA\"\n    | \"MARKET_SNAPSHOT_READ_FAILED\";\n}\n\nfunction toFiniteNumber(\n  value: unknown,\n): number | null {\n  if (\n    value === null ||\n    value === undefined ||\n    value === \"\"\n  ) {\n    return null;\n  }\n\n  const parsed =\n    Number(value);\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : null;\n}\n\nexport async function resolvePaperExecutionRealismV2MarketInput(\n  input: {\n    supabase: any;\n    stockCode: string;\n    observedAt: string;\n  },\n): Promise<PaperExecutionRealismV2MarketInput> {\n  const {\n    data,\n    error,\n  } =\n    await input.supabase\n      .from(\"market_snapshots\")\n      .select(\n        \"observed_at,volume\",\n      )\n      .eq(\n        \"stock_code\",\n        input.stockCode,\n      )\n      .lte(\n        \"observed_at\",\n        input.observedAt,\n      )\n      .order(\n        \"observed_at\",\n        {\n          ascending: false,\n        },\n      )\n      .limit(2);\n\n  if (error) {\n    return {\n      intervalVolume: null,\n      latestObservedAt: null,\n      previousObservedAt: null,\n      source:\n        \"MARKET_SNAPSHOT_READ_FAILED\",\n    };\n  }\n\n  const rows =\n    (data ?? []) as Array<{\n      observed_at:\n        | string\n        | null;\n      volume:\n        | number\n        | string\n        | null;\n    }>;\n\n  const latest =\n    rows[0] ?? null;\n\n  const previous =\n    rows[1] ?? null;\n\n  const latestVolume =\n    toFiniteNumber(\n      latest?.volume,\n    );\n\n  const previousVolume =\n    toFiniteNumber(\n      previous?.volume,\n    );\n\n  if (\n    latestVolume === null ||\n    previousVolume === null\n  ) {\n    return {\n      intervalVolume: null,\n      latestObservedAt:\n        latest?.observed_at ??\n        null,\n      previousObservedAt:\n        previous?.observed_at ??\n        null,\n      source:\n        \"NO_USABLE_VOLUME_DELTA\",\n    };\n  }\n\n  const delta =\n    latestVolume -\n    previousVolume;\n\n  return {\n    intervalVolume:\n      delta >= 0\n        ? delta\n        : null,\n    latestObservedAt:\n      latest?.observed_at ??\n      null,\n    previousObservedAt:\n      previous?.observed_at ??\n      null,\n    source:\n      delta >= 0\n        ? \"MARKET_SNAPSHOT_VOLUME_DELTA\"\n        : \"NO_USABLE_VOLUME_DELTA\",\n  };\n}\n", "contract": "import assert from \"node:assert/strict\";\n\nimport {\n  evaluatePaperExecutionRealismV2,\n} from \"../lib/trading/paper-execution-realism-v2\";\n\n{\n  const result =\n    evaluatePaperExecutionRealismV2({\n      side: \"BUY\",\n      requestedQuantity: 100,\n      referencePrice: 100_000,\n      now:\n        \"2026-10-09T04:00:00.000Z\",\n      intervalVolume: 1_000,\n    });\n\n  assert.equal(\n    result.approved,\n    true,\n  );\n\n  assert.equal(\n    result.filledQuantity,\n    50,\n  );\n\n  assert.equal(\n    result.unfilledQuantity,\n    50,\n  );\n\n  assert.ok(\n    result.executionPrice !==\n      null,\n  );\n\n  assert.ok(\n    result.brokerFee > 0,\n  );\n}\n\n{\n  const result =\n    evaluatePaperExecutionRealismV2({\n      side: \"BUY\",\n      requestedQuantity: 7,\n      referencePrice: 50_000,\n      now:\n        \"2026-10-09T04:00:00.000Z\",\n      intervalVolume: null,\n    });\n\n  assert.equal(\n    result.approved,\n    true,\n  );\n\n  assert.equal(\n    result.filledQuantity,\n    7,\n  );\n\n  assert.equal(\n    result.priceSource,\n    \"REFERENCE_PLUS_SYNTHETIC_SPREAD\",\n  );\n}\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        \"PAPER_EXECUTION_REALISM_V2_BUY_BINDING_CONTRACT_VERIFIED\",\n      cases: 2,\n      invariants: [\n        \"PARTIAL_FILL_BY_VOLUME_CAP\",\n        \"SYNTHETIC_SPREAD_FALLBACK\",\n        \"BUY_BROKER_FEE\",\n      ],\n    },\n    null,\n    2,\n  ),\n);\n", "staticVerify": "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst executorPath =\n  path.resolve(\n    root,\n    \"lib/trading/execute-paper-order.ts\",\n  );\n\nconst migrationPath =\n  path.resolve(\n    root,\n    \"supabase/migrations/20261009000100_paper_execution_realism_v2_buy_partial_fill.sql\",\n  );\n\nconst helperPath =\n  path.resolve(\n    root,\n    \"lib/trading/resolve-paper-execution-realism-v2-market-input.ts\",\n  );\n\nconst executor =\n  fs.readFileSync(\n    executorPath,\n    \"utf8\",\n  );\n\nconst migration =\n  fs.readFileSync(\n    migrationPath,\n    \"utf8\",\n  );\n\nconst helper =\n  fs.readFileSync(\n    helperPath,\n    \"utf8\",\n  );\n\nconst checks = {\n  executorImportsRealism:\n    executor.includes(\n      \"paper-execution-realism-v2\",\n    ),\n\n  executorImportsMarketInput:\n    executor.includes(\n      \"resolve-paper-execution-realism-v2-market-input\",\n    ),\n\n  executorEvaluatesRealism:\n    executor.includes(\n      \"evaluatePaperExecutionRealismV2\",\n    ),\n\n  executorUsesV2Rpc:\n    executor.includes(\n      \"execute_paper_buy_order_with_execution_price_v2\",\n    ),\n\n  executorPassesFillQuantity:\n    executor.includes(\n      \"p_fill_quantity:\",\n    ),\n\n  executorPassesBrokerFee:\n    executor.includes(\n      \"p_broker_fee:\",\n    ),\n\n  migrationHasV2Rpc:\n    migration.includes(\n      \"execute_paper_buy_order_with_execution_price_v2\",\n    ),\n\n  migrationPreservesAdvisoryLock:\n    migration.includes(\n      \"pg_advisory_xact_lock\",\n    ),\n\n  migrationPreservesFreshness:\n    /freshness|quality_gate|data_quality/i.test(\n      migration,\n    ),\n\n  migrationPreservesKillSwitch:\n    migration.includes(\n      \"emergency_stop\",\n    ),\n\n  migrationHasPartialFillState:\n    migration.includes(\n      \"v_is_final_fill\",\n    ) &&\n    migration.includes(\n      \"'RISK_APPROVED'\",\n    ),\n\n  migrationHasRiskTransfer:\n    migration.includes(\n      \"reserved_risk_amount\",\n    ) &&\n    migration.includes(\n      \"v_actual_trade_risk\",\n    ),\n\n  migrationHasTransactionCost:\n    migration.includes(\n      \"execution_broker_fee\",\n    ) &&\n    migration.includes(\n      \"execution_transaction_cost\",\n    ),\n\n  helperUsesVolumeDelta:\n    helper.includes(\n      \"MARKET_SNAPSHOT_VOLUME_DELTA\",\n    ),\n\n  noRealTradingEnable:\n    !/real_order_enabled\\s*=\\s*true/i.test(\n      executor + \"\\n\" + migration,\n    ),\n};\n\nconst ok =\n  Object.values(\n    checks,\n  ).every(Boolean);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: ok\n        ? \"PAPER_EXECUTION_REALISM_V2_BUY_BINDING_STATIC_VERIFIED\"\n        : \"PAPER_EXECUTION_REALISM_V2_BUY_BINDING_STATIC_FAILED\",\n      checks,\n      databaseApplied: false,\n    },\n    null,\n    2,\n  ),\n);\n\nif (!ok) {\n  process.exitCode = 1;\n}\n"};

function abs(rel) {
  return path.resolve(
    root,
    rel,
  );
}

function readRequired(rel) {
  const target =
    abs(rel);

  if (!fs.existsSync(target)) {
    throw new Error(
      `REQUIRED_FILE_MISSING:${rel}`,
    );
  }

  return fs.readFileSync(
    target,
    "utf8",
  );
}

function functionBlock(
  sql,
  functionName,
) {
  const startRe =
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(`,
      "i",
    );

  const match =
    startRe.exec(sql);

  if (!match) {
    throw new Error(
      `FUNCTION_NOT_FOUND:${functionName}`,
    );
  }

  const start =
    match.index;

  const rest =
    sql.slice(start);

  const delimiterMatch =
    /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(
      rest,
    );

  if (!delimiterMatch) {
    throw new Error(
      `FUNCTION_DELIMITER_NOT_FOUND:${functionName}`,
    );
  }

  const delimiter =
    delimiterMatch[1];

  const bodyStart =
    start +
    delimiterMatch.index +
    delimiterMatch[0].length;

  const endToken =
    `${delimiter};`;

  const endIndex =
    sql.indexOf(
      endToken,
      bodyStart,
    );

  if (endIndex < 0) {
    throw new Error(
      `FUNCTION_END_NOT_FOUND:${functionName}`,
    );
  }

  return sql.slice(
    start,
    endIndex +
      endToken.length,
  );
}

function insertAfterBlock(
  source,
  re,
  insertion,
  label,
) {
  const match =
    re.exec(source);

  if (!match) {
    throw new Error(
      `PATCH_ANCHOR_NOT_FOUND:${label}`,
    );
  }

  return (
    source.slice(
      0,
      match.index +
        match[0].length,
    ) +
    insertion +
    source.slice(
      match.index +
        match[0].length,
    )
  );
}

function patchSqlFunction(
  originalFunction,
) {
  let fn =
    originalFunction;

  if (
    !fn.includes(
      "pg_advisory_xact_lock",
    )
  ) {
    throw new Error(
      "V1_FUNCTION_MISSING_ADVISORY_LOCK",
    );
  }

  if (
    !/freshness|quality_gate|data_quality/i.test(
      fn,
    )
  ) {
    throw new Error(
      "V1_FUNCTION_MISSING_FRESHNESS_GUARD",
    );
  }

  const v1HasDirectKillSwitchGuard =
    fn.includes(
      "emergency_stop",
    );

  fn =
    fn.replace(
      "execute_paper_buy_order_with_execution_price_v1",
      "execute_paper_buy_order_with_execution_price_v2",
    );

  const observedParamRe =
    /(p_execution_observed_at\s+timestamptz\s*,)/i;

  if (
    !observedParamRe.test(fn)
  ) {
    throw new Error(
      "SQL_SIGNATURE_OBSERVED_AT_ANCHOR_NOT_FOUND",
    );
  }

  fn =
    fn.replace(
      observedParamRe,
      `$1
  p_fill_quantity integer,
  p_broker_fee numeric default 0,`,
    );

  const declarationAnchor =
    /(\bv_new_average_price\s+numeric(?:\([^)]+\))?\s*;)/i;

  if (
    !declarationAnchor.test(fn)
  ) {
    throw new Error(
      "SQL_DECLARATION_ANCHOR_NOT_FOUND",
    );
  }

  fn =
    fn.replace(
      declarationAnchor,
      `$1
  v_prior_filled_quantity integer := 0;
  v_remaining_quantity integer := 0;
  v_effective_fill_quantity integer := 0;
  v_is_final_fill boolean := false;
  v_emergency_stop boolean := null;
  v_paper_order_enabled boolean := null;`,
    );

  const advisoryLockGuard =
    /perform\s+pg_catalog\.pg_advisory_xact_lock\s*\([\s\S]{0,1200}?\)\s*;/i;

  fn =
    insertAfterBlock(
      fn,
      advisoryLockGuard,
      `

  /*
   * PAPER EXECUTION REALISM V2:
   * Explicitly re-bind the authoritative DB kill switch.
   * The execution-price V1 RPC was created after the earlier
   * kill-switch migration and does not have to contain that
   * guard literally.
   */
  select
    emergency_stop,
    paper_order_enabled
  into
    v_emergency_stop,
    v_paper_order_enabled
  from public.trading_system_controls
  where control_key = 'global'
  for share;

  if not found then
    raise exception 'TRADING_CONTROL_ROW_MISSING';
  end if;

  if coalesce(v_emergency_stop, false) = true then
    raise exception 'EMERGENCY_STOP_ACTIVE';
  end if;

  if coalesce(v_paper_order_enabled, false) = false then
    raise exception 'PAPER_ORDER_DISABLED';
  end if;`,
      "SQL_ADVISORY_LOCK_FOR_KILL_SWITCH_REBIND",
    );

  const approvedGuard =
    /if\s+v_order\.approved_quantity\s*<=\s*0\s+then[\s\S]*?end\s+if\s*;/i;

  fn =
    insertAfterBlock(
      fn,
      approvedGuard,
      `

  if p_fill_quantity is null or p_fill_quantity <= 0 then
    raise exception 'INVALID_FILL_QUANTITY';
  end if;

  if p_broker_fee is null or p_broker_fee < 0 then
    raise exception 'INVALID_BROKER_FEE';
  end if;

  v_prior_filled_quantity :=
    greatest(0, coalesce(v_order.filled_quantity, 0));

  v_remaining_quantity :=
    greatest(
      0,
      v_order.approved_quantity - v_prior_filled_quantity
    );

  if v_remaining_quantity <= 0 then
    raise exception 'NO_REMAINING_APPROVED_QUANTITY';
  end if;

  if p_fill_quantity > v_remaining_quantity then
    raise exception 'FILL_QUANTITY_EXCEEDS_REMAINING_APPROVED_QUANTITY';
  end if;

  v_effective_fill_quantity := p_fill_quantity;

  v_is_final_fill :=
    (
      v_prior_filled_quantity +
      v_effective_fill_quantity
    ) >= v_order.approved_quantity;`,
      "SQL_APPROVED_QUANTITY_GUARD",
    );

  fn =
    fn.replace(
      /p_execution_price\s*\*\s*v_order\.approved_quantity/g,
      "p_execution_price * v_effective_fill_quantity",
    );

  fn =
    fn.replace(
      /v_position\.quantity\s*\+\s*v_order\.approved_quantity/g,
      "v_position.quantity + v_effective_fill_quantity",
    );

  fn =
    fn.replace(
      /v_order\.approved_quantity\s*\+\s*v_position\.quantity/g,
      "v_effective_fill_quantity + v_position.quantity",
    );

  const insertPositionIndex =
    fn.indexOf(
      "insert into public.paper_positions",
    );

  if (
    insertPositionIndex >= 0
  ) {
    const semicolon =
      fn.indexOf(
        ";",
        insertPositionIndex,
      );

    if (
      semicolon < 0
    ) {
      throw new Error(
        "SQL_POSITION_INSERT_END_NOT_FOUND",
      );
    }

    const statement =
      fn.slice(
        insertPositionIndex,
        semicolon + 1,
      );

    const patched =
      statement.replace(
        /v_order\.approved_quantity/g,
        "v_effective_fill_quantity",
      );

    fn =
      fn.slice(
        0,
        insertPositionIndex,
      ) +
      patched +
      fn.slice(
        semicolon + 1,
      );
  }

  fn =
    fn.replace(
      /(v_order_amount\s*:=\s*p_execution_price\s*\*\s*v_effective_fill_quantity)\s*;/i,
      "$1 + p_broker_fee;",
    );

  const updates = [];

  let searchFrom = 0;

  while (true) {
    const idx =
      fn.indexOf(
        "update public.paper_order_requests",
        searchFrom,
      );

    if (
      idx < 0
    ) {
      break;
    }

    updates.push(idx);
    searchFrom =
      idx + 1;
  }

  if (
    updates.length < 2
  ) {
    throw new Error(
      "SQL_EXPECTED_MULTIPLE_ORDER_UPDATES_NOT_FOUND",
    );
  }

  const successUpdateStart =
    updates.at(-1);

  const successUpdateEnd =
    fn.indexOf(
      ";",
      successUpdateStart,
    );

  if (
    successUpdateEnd < 0
  ) {
    throw new Error(
      "SQL_SUCCESS_UPDATE_END_NOT_FOUND",
    );
  }

  let successUpdate =
    fn.slice(
      successUpdateStart,
      successUpdateEnd + 1,
    );

  if (
    !/status\s*=\s*'FILLED'/i.test(
      successUpdate,
    )
  ) {
    throw new Error(
      "SQL_SUCCESS_STATUS_ASSIGNMENT_NOT_FOUND",
    );
  }

  successUpdate =
    successUpdate.replace(
      /status\s*=\s*'FILLED'/i,
      `status =
      case
        when v_is_final_fill then 'FILLED'
        else 'RISK_APPROVED'
      end`,
    );

  if (
    /filled_quantity\s*=/i.test(
      successUpdate,
    )
  ) {
    successUpdate =
      successUpdate.replace(
        /filled_quantity\s*=\s*[^,\n]+/i,
        "filled_quantity = v_prior_filled_quantity + v_effective_fill_quantity",
      );
  } else {
    successUpdate =
      successUpdate.replace(
        /\bset\b/i,
        `set
    filled_quantity =
      v_prior_filled_quantity + v_effective_fill_quantity,`,
      );
  }

  if (
    /reserved_risk_amount\s*=/i.test(
      successUpdate,
    )
  ) {
    successUpdate =
      successUpdate.replace(
        /reserved_risk_amount\s*=\s*[^,\n]+/i,
        `reserved_risk_amount =
      case
        when v_is_final_fill then 0
        else greatest(
          0,
          coalesce(v_order.reserved_risk_amount, 0) - v_actual_trade_risk
        )
      end`,
      );
  } else {
    successUpdate =
      successUpdate.replace(
        /\bset\b/i,
        `set
    reserved_risk_amount =
      case
        when v_is_final_fill then 0
        else greatest(
          0,
          coalesce(v_order.reserved_risk_amount, 0) - v_actual_trade_risk
        )
      end,`,
      );
  }

  successUpdate =
    successUpdate.replace(
      /execution_price_source\s*=\s*'[^']*'/i,
      "execution_price_source = 'PAPER_EXECUTION_REALISM_V2'",
    );

  successUpdate =
    successUpdate.replace(
      /\bwhere\b/i,
      `,
    execution_broker_fee =
      coalesce(execution_broker_fee, 0) + p_broker_fee,
    execution_transaction_cost =
      coalesce(execution_transaction_cost, 0) + p_broker_fee,
    execution_fill_count =
      coalesce(execution_fill_count, 0) + 1
  where`,
    );

  fn =
    fn.slice(
      0,
      successUpdateStart,
    ) +
    successUpdate +
    fn.slice(
      successUpdateEnd + 1,
    );

  const finalTailStart =
    successUpdateStart +
    successUpdate.length;

  let finalTail =
    fn.slice(
      finalTailStart,
    );

  finalTail =
    finalTail.replace(
      /'status'\s*,\s*'FILLED'/i,
      `'status',
      case
        when v_is_final_fill then 'FILLED'
        else 'RISK_APPROVED'
      end`,
    );

  finalTail =
    finalTail.replace(
      /'filledQuantity'\s*,\s*v_order\.approved_quantity/i,
      `'filledQuantity',
      v_prior_filled_quantity + v_effective_fill_quantity`,
    );

  fn =
    fn.slice(
      0,
      finalTailStart,
    ) +
    finalTail;

  if (
    !fn.includes(
      "v_effective_fill_quantity",
    ) ||
    !fn.includes(
      "v_is_final_fill",
    )
  ) {
    throw new Error(
      "SQL_PARTIAL_FILL_PATCH_INCOMPLETE",
    );
  }

  return fn;
}

function patchExecutor(
  original,
) {
  let src =
    original;

  if (
    src.includes(
      "execute_paper_buy_order_with_execution_price_v2",
    )
  ) {
    return src;
  }

  const importAnchor =
    /^(import[\s\S]*?;\s*)+/;

  const importMatch =
    importAnchor.exec(src);

  if (
    !importMatch
  ) {
    throw new Error(
      "EXECUTOR_IMPORT_BLOCK_NOT_FOUND",
    );
  }

  const extraImports =
    `
import {
  evaluatePaperExecutionRealismV2,
} from "@/lib/trading/paper-execution-realism-v2";
import {
  resolvePaperExecutionRealismV2MarketInput,
} from "@/lib/trading/resolve-paper-execution-realism-v2-market-input";
`;

  src =
    src.slice(
      0,
      importMatch[0].length,
    ) +
    extraImports +
    src.slice(
      importMatch[0].length,
    );

  if (
    src.includes(
      "approved_quantity: number | string | null;",
    ) &&
    !src.includes(
      "filled_quantity: number | string | null;",
    )
  ) {
    src =
      src.replace(
        "approved_quantity: number | string | null;",
        `approved_quantity: number | string | null;
  filled_quantity: number | string | null;`,
      );
  }

  const selectQuoted =
    /"approved_quantity",/;

  if (
    selectQuoted.test(src) &&
    !/"filled_quantity",/.test(src)
  ) {
    src =
      src.replace(
        selectQuoted,
        `"approved_quantity",
          "filled_quantity",`,
      );
  }

  const safeAssignmentRe =
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+resolveSafePaperBuyExecution\s*\(/;

  const safeMatch =
    safeAssignmentRe.exec(src);

  if (
    !safeMatch
  ) {
    throw new Error(
      "EXECUTOR_SAFE_EXECUTION_ASSIGNMENT_NOT_FOUND",
    );
  }

  const safeVar =
    safeMatch[1];

  const safeStatementStart =
    safeMatch.index;

  const safeStatementEnd =
    src.indexOf(
      ");",
      safeStatementStart,
    );

  if (
    safeStatementEnd < 0
  ) {
    throw new Error(
      "EXECUTOR_SAFE_EXECUTION_STATEMENT_END_NOT_FOUND",
    );
  }

  const rpcName =
    '"execute_paper_buy_order_with_execution_price_v1"';

  const rpcIndex =
    src.indexOf(
      rpcName,
      safeStatementEnd,
    );

  if (
    rpcIndex < 0
  ) {
    throw new Error(
      "EXECUTOR_V1_RPC_CALL_NOT_FOUND",
    );
  }

  const rpcSlice =
    src.slice(
      rpcIndex,
      Math.min(
        src.length,
        rpcIndex + 2400,
      ),
    );

  const observedMatch =
    /p_execution_observed_at\s*:\s*([^,\n}]+)/.exec(
      rpcSlice,
    );

  const priceMatch =
    /p_execution_price\s*:\s*([^,\n}]+)/.exec(
      rpcSlice,
    );

  if (
    !observedMatch ||
    !priceMatch
  ) {
    throw new Error(
      "EXECUTOR_RPC_ARGUMENTS_NOT_FOUND",
    );
  }

  const observedExpression =
    observedMatch[1].trim();

  const priceExpression =
    priceMatch[1].trim();

  const injection =
    `

  const realismRemainingQuantity =
    Math.max(
      0,
      Number(order.approved_quantity ?? 0) -
        Number((order as any).filled_quantity ?? 0),
    );

  if (realismRemainingQuantity <= 0) {
    throw new Error(
      "PAPER_EXECUTION_REALISM_V2_NO_REMAINING_QUANTITY",
    );
  }

  const realismMarketInput =
    await resolvePaperExecutionRealismV2MarketInput({
      supabase,
      stockCode: order.stock_code,
      observedAt: ${observedExpression},
    });

  const realismDecision =
    evaluatePaperExecutionRealismV2({
      side: "BUY",
      requestedQuantity:
        realismRemainingQuantity,
      referencePrice:
        ${priceExpression},
      now:
        ${observedExpression},
      intervalVolume:
        realismMarketInput.intervalVolume,
    });

  if (
    !realismDecision.approved ||
    realismDecision.executionPrice === null ||
    realismDecision.filledQuantity <= 0
  ) {
    throw new Error(
      \`PAPER_EXECUTION_REALISM_V2_BLOCKED:\${realismDecision.blocker ?? "UNKNOWN"}\`,
    );
  }
`;

  src =
    src.slice(
      0,
      safeStatementEnd + 2,
    ) +
    injection +
    src.slice(
      safeStatementEnd + 2,
    );

  src =
    src.replace(
      rpcName,
      '"execute_paper_buy_order_with_execution_price_v2"',
    );

  const newRpcIndex =
    src.indexOf(
      '"execute_paper_buy_order_with_execution_price_v2"',
    );

  const afterRpc =
    src.slice(
      newRpcIndex,
      Math.min(
        src.length,
        newRpcIndex + 2800,
      ),
    );

  const patchedRpc =
    afterRpc
      .replace(
        /p_execution_price\s*:\s*([^,\n}]+)/,
        "p_execution_price: realismDecision.executionPrice",
      )
      .replace(
        /(p_execution_observed_at\s*:\s*[^,\n}]+,?)/,
        `$1
        p_fill_quantity:
          realismDecision.filledQuantity,
        p_broker_fee:
          realismDecision.brokerFee,`,
      );

  src =
    src.slice(
      0,
      newRpcIndex,
    ) +
    patchedRpc +
    src.slice(
      newRpcIndex +
        afterRpc.length,
    );

  if (
    !src.includes(
      "realismDecision.filledQuantity",
    ) ||
    !src.includes(
      "realismDecision.brokerFee",
    )
  ) {
    throw new Error(
      "EXECUTOR_REALISM_RPC_BINDING_INCOMPLETE",
    );
  }

  return src;
}

const executorOriginal =
  readRequired(
    executorRel,
  );

const migrationV1 =
  readRequired(
    migrationV1Rel,
  );

readRequired(
  "lib/trading/paper-execution-realism-v2.ts",
);

const v1Function =
  functionBlock(
    migrationV1,
    "execute_paper_buy_order_with_execution_price_v1",
  );

const v2Function =
  patchSqlFunction(
    v1Function,
  );

const migrationV2 =
  `-- PAPER EXECUTION REALISM V2 BUY PARTIAL FILL
-- Generated from the already-verified V1 fill RPC so kill-switch,
-- data-freshness and gap/slippage fail-closed guards are preserved.
begin;

alter table public.paper_order_requests
  add column if not exists execution_broker_fee numeric not null default 0,
  add column if not exists execution_transaction_cost numeric not null default 0,
  add column if not exists execution_fill_count integer not null default 0;

alter table public.paper_order_requests
  drop constraint if exists paper_order_requests_execution_broker_fee_nonnegative;

alter table public.paper_order_requests
  add constraint paper_order_requests_execution_broker_fee_nonnegative
  check (execution_broker_fee >= 0);

alter table public.paper_order_requests
  drop constraint if exists paper_order_requests_execution_transaction_cost_nonnegative;

alter table public.paper_order_requests
  add constraint paper_order_requests_execution_transaction_cost_nonnegative
  check (execution_transaction_cost >= 0);

alter table public.paper_order_requests
  drop constraint if exists paper_order_requests_execution_fill_count_nonnegative;

alter table public.paper_order_requests
  add constraint paper_order_requests_execution_fill_count_nonnegative
  check (execution_fill_count >= 0);

${v2Function}

commit;
`;

const executorPatched =
  patchExecutor(
    executorOriginal,
  );

const writes = {
  [helperRel]:
    embedded.helper,
  [contractRel]:
    embedded.contract,
  [staticRel]:
    embedded.staticVerify,
  [migrationV2Rel]:
    migrationV2,
  [executorRel]:
    executorPatched,
};

for (
  const [
    rel,
    content,
  ] of Object.entries(
    writes,
  )
) {
  const target =
    abs(rel);

  fs.mkdirSync(
    path.dirname(target),
    {
      recursive: true,
    },
  );

  if (
    rel === executorRel
  ) {
    const backup =
      `${target}.pre-paper-execution-realism-v2`;

    if (
      !fs.existsSync(backup)
    ) {
      fs.writeFileSync(
        backup,
        executorOriginal,
        "utf8",
      );
    }
  }

  fs.writeFileSync(
    target,
    content,
    "utf8",
  );
}

console.log(
  JSON.stringify(
    {
      status:
        "PAPER_EXECUTION_REALISM_V2_BUY_BINDING_SOURCE_V2_INSTALLED",
      changed: [
        executorRel,
        helperRel,
        migrationV2Rel,
      ],
      generatedTests: [
        contractRel,
        staticRel,
      ],
      databaseApplied: false,
      killSwitchReboundDirectlyInV2Rpc: true,
      v1DirectKillSwitchGuardRequired: false,
      ordersCreated: 0,
      positionsChanged: 0,
      realTradingChanged: false,
      rollbackBackup:
        `${executorRel}.pre-paper-execution-realism-v2`,
      nextAction:
        "RUN_BINDING_CONTRACT_STATIC_AND_TYPESCRIPT_IMPORT_SMOKE",
    },
    null,
    2,
  ),
);
