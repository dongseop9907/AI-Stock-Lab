const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const stopRel =
  "lib/trading/check-stop-losses.ts";

const trailingRel =
  "lib/trading/update-trailing-stops.ts";

const originalSqlRel =
  "supabase/migrations/004_stop_loss_execution.sql";

const migrationRel =
  "supabase/migrations/20261009000200_paper_execution_realism_v2_protective_sell.sql";

const helperRel =
  "lib/trading/resolve-protective-sell-execution-realism-v2.ts";

const contractRel =
  "scripts/paper-execution-realism-v2-protective-sell-contract-test.ts";

const staticRel =
  "scripts/paper-execution-realism-v2-protective-sell-static-verify.cjs";

const embedded = {
  helper:
    "import {\n  evaluatePaperExecutionRealismV2,\n  type PaperExecutionRealismDecision,\n} from \"@/lib/trading/paper-execution-realism-v2\";\n\nimport {\n  resolvePaperExecutionRealismV2MarketInput,\n} from \"@/lib/trading/resolve-paper-execution-realism-v2-market-input\";\n\nexport interface ProtectiveSellExecutionRealismV2Input {\n  supabase: any;\n  stockCode: string;\n  requestedQuantity: number;\n  referencePrice: number;\n  observedAt: string;\n}\n\nexport interface ProtectiveSellExecutionRealismV2Result\n  extends PaperExecutionRealismDecision {\n  protectiveFallbackUsed: boolean;\n  protectiveFallbackReason: string | null;\n  marketInputSource: string;\n}\n\n/*\n * Protective exits are risk-reducing actions.\n *\n * Normal path:\n *   - SELL-side spread / impact / participation model\n *   - partial fill is allowed\n *\n * Fail-open-for-protection path:\n *   - if the realism model would block solely because the observed\n *     interval has no executable liquidity, retry without the\n *     interval-volume cap.\n *\n * Invalid quantity or invalid reference price remain programming/data\n * errors and are not silently converted into an execution.\n */\nexport async function resolveProtectiveSellExecutionRealismV2(\n  input: ProtectiveSellExecutionRealismV2Input,\n): Promise<ProtectiveSellExecutionRealismV2Result> {\n  const marketInput =\n    await resolvePaperExecutionRealismV2MarketInput({\n      supabase:\n        input.supabase,\n      stockCode:\n        input.stockCode,\n      observedAt:\n        input.observedAt,\n    });\n\n  let decision =\n    evaluatePaperExecutionRealismV2({\n      side:\n        \"SELL\",\n      requestedQuantity:\n        input.requestedQuantity,\n      referencePrice:\n        input.referencePrice,\n      now:\n        input.observedAt,\n      intervalVolume:\n        marketInput.intervalVolume,\n    });\n\n  let protectiveFallbackUsed =\n    false;\n\n  let protectiveFallbackReason:\n    string | null =\n      null;\n\n  if (\n    !decision.approved ||\n    decision.executionPrice ===\n      null ||\n    decision.filledQuantity <=\n      0\n  ) {\n    if (\n      decision.blocker ===\n        \"INVALID_REQUESTED_QUANTITY\" ||\n      decision.blocker ===\n        \"INVALID_REFERENCE_PRICE\" ||\n      decision.blocker ===\n        \"INVALID_POLICY\"\n    ) {\n      throw new Error(\n        `PROTECTIVE_SELL_REALISM_INVALID_INPUT:${decision.blocker}`,\n      );\n    }\n\n    protectiveFallbackUsed =\n      true;\n\n    protectiveFallbackReason =\n      decision.blocker ??\n      \"NO_EXECUTABLE_FILL\";\n\n    decision =\n      evaluatePaperExecutionRealismV2({\n        side:\n          \"SELL\",\n        requestedQuantity:\n          input.requestedQuantity,\n        referencePrice:\n          input.referencePrice,\n        now:\n          input.observedAt,\n        intervalVolume:\n          null,\n      });\n  }\n\n  if (\n    !decision.approved ||\n    decision.executionPrice ===\n      null ||\n    decision.filledQuantity <=\n      0\n  ) {\n    throw new Error(\n      `PROTECTIVE_SELL_REALISM_FALLBACK_FAILED:${decision.blocker ?? \"UNKNOWN\"}`,\n    );\n  }\n\n  return {\n    ...decision,\n    protectiveFallbackUsed,\n    protectiveFallbackReason,\n    marketInputSource:\n      marketInput.source,\n  };\n}\n",
  contract:
    "import assert from \"node:assert/strict\";\n\nimport {\n  evaluatePaperExecutionRealismV2,\n} from \"../lib/trading/paper-execution-realism-v2\";\n\n{\n  const result =\n    evaluatePaperExecutionRealismV2({\n      side: \"SELL\",\n      requestedQuantity: 100,\n      referencePrice: 100_000,\n      now:\n        \"2026-10-09T06:00:00.000Z\",\n      intervalVolume: 1_000,\n    });\n\n  assert.equal(\n    result.approved,\n    true,\n  );\n\n  assert.equal(\n    result.filledQuantity,\n    50,\n  );\n\n  assert.equal(\n    result.unfilledQuantity,\n    50,\n  );\n\n  assert.ok(\n    result.executionPrice !==\n      null,\n  );\n\n  assert.ok(\n    result.executionPrice! <\n      100_000,\n  );\n\n  assert.ok(\n    result.brokerFee > 0,\n  );\n\n  assert.ok(\n    result.sellTax > 0,\n  );\n\n  assert.equal(\n    result.totalTransactionCost,\n    result.brokerFee +\n      result.sellTax,\n  );\n}\n\n{\n  const blocked =\n    evaluatePaperExecutionRealismV2({\n      side: \"SELL\",\n      requestedQuantity: 5,\n      referencePrice: 50_000,\n      now:\n        \"2026-10-09T06:00:00.000Z\",\n      intervalVolume: 0,\n    });\n\n  assert.equal(\n    blocked.approved,\n    false,\n  );\n\n  assert.equal(\n    blocked.blocker,\n    \"NO_EXECUTABLE_LIQUIDITY\",\n  );\n\n  const protectiveFallback =\n    evaluatePaperExecutionRealismV2({\n      side: \"SELL\",\n      requestedQuantity: 5,\n      referencePrice: 50_000,\n      now:\n        \"2026-10-09T06:00:00.000Z\",\n      intervalVolume: null,\n    });\n\n  assert.equal(\n    protectiveFallback.approved,\n    true,\n  );\n\n  assert.equal(\n    protectiveFallback.filledQuantity,\n    5,\n  );\n}\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        \"PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_CONTRACT_VERIFIED\",\n      cases: 2,\n      invariants: [\n        \"SELL_PARTIAL_FILL_BY_VOLUME_CAP\",\n        \"SELL_ADVERSE_EXECUTION_PRICE\",\n        \"SELL_BROKER_FEE_AND_TAX\",\n        \"PROTECTIVE_ZERO_LIQUIDITY_FALLBACK_CAN_EXECUTE\",\n      ],\n    },\n    null,\n    2,\n  ),\n);\n",
  staticVerify:
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root =\n  process.cwd();\n\nfunction read(rel) {\n  return fs.readFileSync(\n    path.resolve(\n      root,\n      rel,\n    ),\n    \"utf8\",\n  );\n}\n\nconst stop =\n  read(\n    \"lib/trading/check-stop-losses.ts\",\n  );\n\nconst trailing =\n  read(\n    \"lib/trading/update-trailing-stops.ts\",\n  );\n\nconst helper =\n  read(\n    \"lib/trading/resolve-protective-sell-execution-realism-v2.ts\",\n  );\n\nconst migration =\n  read(\n    \"supabase/migrations/20261009000200_paper_execution_realism_v2_protective_sell.sql\",\n  );\n\nconst checks = {\n  stopImportsProtectiveRealism:\n    stop.includes(\n      \"resolveProtectiveSellExecutionRealismV2\",\n    ),\n\n  trailingImportsProtectiveRealism:\n    trailing.includes(\n      \"resolveProtectiveSellExecutionRealismV2\",\n    ),\n\n  stopUsesV2Rpc:\n    stop.includes(\n      \"execute_paper_protective_sell_v2\",\n    ),\n\n  trailingUsesV2Rpc:\n    trailing.includes(\n      \"execute_paper_protective_sell_v2\",\n    ),\n\n  stopPassesFillQuantity:\n    stop.includes(\n      \"p_fill_quantity:\",\n    ),\n\n  trailingPassesFillQuantity:\n    trailing.includes(\n      \"p_fill_quantity:\",\n    ),\n\n  stopPassesCosts:\n    stop.includes(\n      \"p_broker_fee:\",\n    ) &&\n    stop.includes(\n      \"p_sell_tax:\",\n    ),\n\n  trailingPassesCosts:\n    trailing.includes(\n      \"p_broker_fee:\",\n    ) &&\n    trailing.includes(\n      \"p_sell_tax:\",\n    ),\n\n  helperUsesSellSide:\n    helper.includes(\n      'side:\\n        \"SELL\"',\n    ) ||\n    helper.includes(\n      'side: \"SELL\"',\n    ),\n\n  helperHasProtectiveFallback:\n    helper.includes(\n      \"protectiveFallbackUsed\",\n    ) &&\n    helper.includes(\n      \"intervalVolume:\\n          null\",\n    ),\n\n  migrationHasV2Rpc:\n    migration.includes(\n      \"execute_paper_protective_sell_v2\",\n    ),\n\n  migrationHasAuditTable:\n    migration.includes(\n      \"paper_protective_execution_fills_v2\",\n    ),\n\n  migrationHasPartialPositionUpdate:\n    migration.includes(\n      \"v_remaining_position_quantity\",\n    ) &&\n    migration.includes(\n      \"update public.paper_positions\",\n    ) &&\n    migration.includes(\n      \"delete from public.paper_positions\",\n    ),\n\n  migrationHasTransactionCosts:\n    migration.includes(\n      \"p_broker_fee\",\n    ) &&\n    migration.includes(\n      \"p_sell_tax\",\n    ) &&\n    migration.includes(\n      \"v_total_transaction_cost\",\n    ),\n\n  migrationAdjustsRealizedPnl:\n    migration.includes(\n      \"v_realized_pnl :=\\n    v_realized_pnl -\\n    v_total_transaction_cost\",\n    ),\n\n  protectiveExitNotKillSwitchBlocked:\n    !migration.includes(\n      \"EMERGENCY_STOP_ACTIVE\",\n    ) &&\n    !migration.includes(\n      \"PAPER_ORDER_DISABLED\",\n    ),\n\n  noRealTradingEnable:\n    !/real_order_enabled\\s*=\\s*true/i.test(\n      stop +\n      \"\\n\" +\n      trailing +\n      \"\\n\" +\n      migration,\n    ),\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(([, ok]) =>\n      !ok,\n    )\n    .map(([name]) =>\n      name,\n    );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_STATIC_VERIFIED\"\n          : \"PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_STATIC_FAILED\",\n      checks,\n      failed,\n      databaseApplied:\n        false,\n    },\n    null,\n    2,\n  ),\n);\n\nif (failed.length > 0) {\n  process.exitCode = 1;\n}\n",
};

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

function statementAt(
  source,
  startIndex,
  label,
) {
  if (startIndex < 0) {
    throw new Error(
      `STATEMENT_START_NOT_FOUND:${label}`,
    );
  }

  const end =
    source.indexOf(
      ";",
      startIndex,
    );

  if (end < 0) {
    throw new Error(
      `STATEMENT_END_NOT_FOUND:${label}`,
    );
  }

  return {
    start:
      startIndex,
    end:
      end + 1,
    text:
      source.slice(
        startIndex,
        end + 1,
      ),
  };
}

function patchStopFunction(
  original,
) {
  let fn =
    original;

  if (
    !/for\s+update/i.test(
      fn,
    )
  ) {
    throw new Error(
      "STOP_FUNCTION_POSITION_ROW_LOCK_MISSING",
    );
  }

  if (
    !fn.includes(
      "delete from public.paper_positions",
    )
  ) {
    throw new Error(
      "STOP_FUNCTION_POSITION_DELETE_MISSING",
    );
  }

  if (
    !/v_realized_pnl\s*:=/i.test(
      fn,
    )
  ) {
    throw new Error(
      "STOP_FUNCTION_REALIZED_PNL_ASSIGNMENT_MISSING",
    );
  }

  if (
    !/update\s+public\.paper_accounts/i.test(
      fn,
    )
  ) {
    throw new Error(
      "STOP_FUNCTION_ACCOUNT_UPDATE_MISSING",
    );
  }

  fn =
    fn.replace(
      "execute_paper_stop_loss",
      "execute_paper_protective_sell_v2",
    );

  const signatureRe =
    /(create\s+or\s+replace\s+function\s+public\.execute_paper_protective_sell_v2\s*\()([\s\S]*?)(\)\s*returns\b)/i;

  const sig =
    signatureRe.exec(
      fn,
    );

  if (!sig) {
    throw new Error(
      "PROTECTIVE_SELL_SIGNATURE_NOT_FOUND",
    );
  }

  if (
    !/p_position_id\s+uuid/i.test(
      sig[2],
    ) ||
    !/p_exit_price\s+numeric/i.test(
      sig[2],
    ) ||
    !/p_observed_at\s+timestamptz/i.test(
      sig[2],
    )
  ) {
    throw new Error(
      "PROTECTIVE_SELL_ORIGINAL_SIGNATURE_UNEXPECTED",
    );
  }

  const params =
    sig[2]
      .trimEnd()
      .replace(
        /,\s*$/,
        "",
      );

  const newSignature =
    `${sig[1]}${params},
  p_fill_quantity integer default null,
  p_broker_fee numeric default 0,
  p_sell_tax numeric default 0,
  p_execution_source text default 'PAPER_EXECUTION_REALISM_V2',
  p_exit_reason text default 'PROTECTIVE_STOP'
${sig[3]}`;

  fn =
    fn.slice(
      0,
      sig.index,
    ) +
    newSignature +
    fn.slice(
      sig.index +
        sig[0].length,
    );

  const declarationRe =
    /(\bv_position\s+public\.paper_positions%rowtype\s*;)/i;

  if (
    !declarationRe.test(
      fn,
    )
  ) {
    throw new Error(
      "PROTECTIVE_SELL_POSITION_DECLARATION_NOT_FOUND",
    );
  }

  fn =
    fn.replace(
      declarationRe,
      `$1
  v_original_position_quantity integer := 0;
  v_effective_fill_quantity integer := 0;
  v_remaining_position_quantity integer := 0;
  v_total_transaction_cost numeric := 0;`,
    );

  const triggerGuard =
    /if\s+p_exit_price\s*>\s*v_position\.current_stop_price\s+then[\s\S]*?end\s+if\s*;/i;

  const guard =
    triggerGuard.exec(
      fn,
    );

  if (!guard) {
    throw new Error(
      "PROTECTIVE_SELL_TRIGGER_GUARD_NOT_FOUND",
    );
  }

  const quantityBlock =
    `

  v_original_position_quantity :=
    greatest(
      0,
      coalesce(v_position.quantity, 0)
    );

  if v_original_position_quantity <= 0 then
    raise exception 'PROTECTIVE_SELL_POSITION_QUANTITY_INVALID';
  end if;

  if p_fill_quantity is null or p_fill_quantity <= 0 then
    raise exception 'PROTECTIVE_SELL_FILL_QUANTITY_INVALID';
  end if;

  if p_fill_quantity > v_original_position_quantity then
    raise exception 'PROTECTIVE_SELL_FILL_EXCEEDS_POSITION';
  end if;

  if p_broker_fee is null or p_broker_fee < 0 then
    raise exception 'PROTECTIVE_SELL_BROKER_FEE_INVALID';
  end if;

  if p_sell_tax is null or p_sell_tax < 0 then
    raise exception 'PROTECTIVE_SELL_TAX_INVALID';
  end if;

  v_effective_fill_quantity :=
    p_fill_quantity;

  v_remaining_position_quantity :=
    v_original_position_quantity -
    v_effective_fill_quantity;

  v_total_transaction_cost :=
    p_broker_fee +
    p_sell_tax;
`;

  const insertionPoint =
    guard.index +
    guard[0].length;

  fn =
    fn.slice(
      0,
      insertionPoint,
    ) +
    quantityBlock +
    fn.slice(
      insertionPoint,
    );

  /*
   * Downstream monetary/order/history calculations in the legacy
   * stop function are quantity-based.  From this point forward,
   * the execution quantity must be the actual partial fill.
   */
  const prefix =
    fn.slice(
      0,
      insertionPoint +
        quantityBlock.length,
    );

  let tail =
    fn.slice(
      insertionPoint +
        quantityBlock.length,
    );

  tail =
    tail.replace(
      /v_position\.quantity/g,
      "v_effective_fill_quantity",
    );

  fn =
    prefix +
    tail;

  /*
   * Net realized PnL must include SELL transaction costs.
   */
  const pnlAssignment =
    /v_realized_pnl\s*:=\s*[\s\S]*?;/i;

  const pnl =
    pnlAssignment.exec(
      fn,
    );

  if (!pnl) {
    throw new Error(
      "PROTECTIVE_SELL_REALIZED_PNL_ASSIGNMENT_NOT_FOUND_AFTER_PATCH",
    );
  }

  const pnlCostAdjustment =
    `

  v_realized_pnl :=
    v_realized_pnl -
    v_total_transaction_cost;`;

  fn =
    fn.slice(
      0,
      pnl.index +
        pnl[0].length,
    ) +
    pnlCostAdjustment +
    fn.slice(
      pnl.index +
        pnl[0].length,
    );

  /*
   * The legacy account update credits gross sale proceeds.
   * Subtract transaction costs atomically in the same RPC.
   */
  const accountStart =
    fn.search(
      /update\s+public\.paper_accounts/i,
    );

  const accountStmt =
    statementAt(
      fn,
      accountStart,
      "PAPER_ACCOUNT_UPDATE",
    );

  const cashCostAdjustment =
    `

  if v_total_transaction_cost > 0 then
    update public.paper_accounts
    set cash_balance =
      cash_balance -
      v_total_transaction_cost
    where id =
      v_position.account_id;
  end if;`;

  fn =
    fn.slice(
      0,
      accountStmt.end,
    ) +
    cashCostAdjustment +
    fn.slice(
      accountStmt.end,
    );

  /*
   * Partial fill keeps the remaining position open.
   * Final fill preserves the original delete statement exactly.
   */
  const deleteStart =
    fn.search(
      /delete\s+from\s+public\.paper_positions/i,
    );

  const deleteStmt =
    statementAt(
      fn,
      deleteStart,
      "PAPER_POSITION_DELETE",
    );

  const auditAndPositionMutation =
    `
  insert into public.paper_protective_execution_fills_v2 (
    position_id,
    account_id,
    stock_code,
    requested_quantity,
    filled_quantity,
    remaining_quantity,
    execution_price,
    broker_fee,
    sell_tax,
    total_transaction_cost,
    execution_source,
    exit_reason,
    observed_at
  )
  values (
    p_position_id,
    v_position.account_id,
    v_position.stock_code,
    v_original_position_quantity,
    v_effective_fill_quantity,
    v_remaining_position_quantity,
    p_exit_price,
    p_broker_fee,
    p_sell_tax,
    v_total_transaction_cost,
    coalesce(
      nullif(trim(p_execution_source), ''),
      'PAPER_EXECUTION_REALISM_V2'
    ),
    coalesce(
      nullif(trim(p_exit_reason), ''),
      'PROTECTIVE_STOP'
    ),
    p_observed_at
  );

  if v_remaining_position_quantity <= 0 then
    ${deleteStmt.text}
  else
    update public.paper_positions
    set quantity =
      v_remaining_position_quantity
    where id =
      p_position_id;
  end if;`;

  fn =
    fn.slice(
      0,
      deleteStmt.start,
    ) +
    auditAndPositionMutation +
    fn.slice(
      deleteStmt.end,
    );

  if (
    fn.includes(
      "EMERGENCY_STOP_ACTIVE",
    ) ||
    fn.includes(
      "PAPER_ORDER_DISABLED",
    )
  ) {
    throw new Error(
      "PROTECTIVE_SELL_MUST_NOT_BIND_NEW_RISK_KILL_SWITCH_BLOCK",
    );
  }

  return fn;
}

function addImports(
  source,
) {
  if (
    source.includes(
      "resolveProtectiveSellExecutionRealismV2",
    )
  ) {
    return source;
  }

  const importBlock =
    `import {
  resolveProtectiveSellExecutionRealismV2,
} from "@/lib/trading/resolve-protective-sell-execution-realism-v2";

`;

  return (
    importBlock +
    source
  );
}

function patchRpcCall(
  source,
  exitReason,
  label,
) {
  let src =
    addImports(
      source,
    );

  const callRe =
    /const\s+\{\s*data\s*,\s*error\s*\}\s*=\s*await\s+supabase\.rpc\(\s*"execute_paper_stop_loss"\s*,/m;

  const call =
    callRe.exec(
      src,
    );

  if (!call) {
    throw new Error(
      `${label}_STOP_RPC_CALL_NOT_FOUND`,
    );
  }

  const injection =
    `const protectiveExecution =
      await resolveProtectiveSellExecutionRealismV2({
        supabase,
        stockCode:
          position.stock_code,
        requestedQuantity:
          position.quantity,
        referencePrice:
          currentPrice,
        observedAt:
          snapshot.observed_at,
      });

    `;

  src =
    src.slice(
      0,
      call.index,
    ) +
    injection +
    src.slice(
      call.index,
    );

  const callAfter =
    callRe.exec(
      src,
    );

  if (!callAfter) {
    throw new Error(
      `${label}_STOP_RPC_CALL_LOST_AFTER_INJECTION`,
    );
  }

  const rpcStart =
    callAfter.index;

  const rpcEnd =
    src.indexOf(
      ");",
      rpcStart,
    );

  if (rpcEnd < 0) {
    throw new Error(
      `${label}_STOP_RPC_END_NOT_FOUND`,
    );
  }

  let rpc =
    src.slice(
      rpcStart,
      rpcEnd + 2,
    );

  rpc =
    rpc.replace(
      '"execute_paper_stop_loss"',
      '"execute_paper_protective_sell_v2"',
    );

  if (
    !/p_exit_price\s*:\s*currentPrice/.test(
      rpc,
    )
  ) {
    throw new Error(
      `${label}_EXIT_PRICE_ARGUMENT_NOT_FOUND`,
    );
  }

  rpc =
    rpc.replace(
      /p_exit_price\s*:\s*currentPrice/,
      "p_exit_price: protectiveExecution.executionPrice",
    );

  const observedRe =
    /(p_observed_at\s*:\s*snapshot\.observed_at\s*,?)/;

  if (
    !observedRe.test(
      rpc,
    )
  ) {
    throw new Error(
      `${label}_OBSERVED_AT_ARGUMENT_NOT_FOUND`,
    );
  }

  rpc =
    rpc.replace(
      observedRe,
      `$1
        p_fill_quantity:
          protectiveExecution.filledQuantity,
        p_broker_fee:
          protectiveExecution.brokerFee,
        p_sell_tax:
          protectiveExecution.sellTax,
        p_execution_source:
          protectiveExecution.priceSource ??
          "PAPER_EXECUTION_REALISM_V2",
        p_exit_reason:
          "${exitReason}",`,
    );

  src =
    src.slice(
      0,
      rpcStart,
    ) +
    rpc +
    src.slice(
      rpcEnd + 2,
    );

  return src;
}

function patchTrailingPositionQuantity(
  source,
) {
  let src =
    source;

  const interfaceRe =
    /(interface\s+PositionRecord\s*\{[\s\S]*?\bstock_code\s*:\s*string\s*;)([\s\S]*?\})/m;

  const interfaceMatch =
    interfaceRe.exec(
      src,
    );

  if (!interfaceMatch) {
    throw new Error(
      "TRAILING_POSITION_INTERFACE_NOT_FOUND",
    );
  }

  if (
    !/\bquantity\s*:\s*number\s*;/.test(
      interfaceMatch[0],
    )
  ) {
    const replacement =
      `${interfaceMatch[1]}
  quantity: number;${interfaceMatch[2]}`;

    src =
      src.slice(
        0,
        interfaceMatch.index,
      ) +
      replacement +
      src.slice(
        interfaceMatch.index +
          interfaceMatch[0].length,
      );
  }

  const positionQueryIndex =
    src.indexOf(
      '.from("paper_positions")',
    );

  if (positionQueryIndex < 0) {
    throw new Error(
      "TRAILING_POSITION_QUERY_NOT_FOUND",
    );
  }

  const selectStart =
    src.indexOf(
      ".select(`",
      positionQueryIndex,
    );

  const selectEnd =
    src.indexOf(
      "`)",
      selectStart,
    );

  if (
    selectStart < 0 ||
    selectEnd < 0
  ) {
    throw new Error(
      "TRAILING_POSITION_SELECT_BLOCK_NOT_FOUND",
    );
  }

  let selectBlock =
    src.slice(
      selectStart,
      selectEnd + 2,
    );

  if (
    !/\bquantity\b/.test(
      selectBlock,
    )
  ) {
    if (
      !/\bstock_code\b/.test(
        selectBlock,
      )
    ) {
      throw new Error(
        "TRAILING_POSITION_STOCK_CODE_SELECT_NOT_FOUND",
      );
    }

    selectBlock =
      selectBlock.replace(
        /(\bstock_code\b)(\s*)/,
        `$1,$2        quantity
`,
      );
  }

  src =
    src.slice(
      0,
      selectStart,
    ) +
    selectBlock +
    src.slice(
      selectEnd + 2,
    );

  return src;
}

const originalSql =
  readRequired(
    originalSqlRel,
  );

const stopOriginal =
  readRequired(
    stopRel,
  );

const trailingOriginal =
  readRequired(
    trailingRel,
  );

readRequired(
  "lib/trading/paper-execution-realism-v2.ts",
);

readRequired(
  "lib/trading/resolve-paper-execution-realism-v2-market-input.ts",
);

const legacyFunction =
  functionBlock(
    originalSql,
    "execute_paper_stop_loss",
  );

const protectiveFunction =
  patchStopFunction(
    legacyFunction,
  );

const migration =
  `-- PAPER EXECUTION REALISM V2 PROTECTIVE SELL BINDING
-- Protective exits remain risk-reducing actions and are intentionally
-- not blocked by the new-risk kill switch.
begin;

create table if not exists public.paper_protective_execution_fills_v2 (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null,
  account_id uuid not null,
  stock_code text not null,
  requested_quantity integer not null,
  filled_quantity integer not null,
  remaining_quantity integer not null,
  execution_price numeric not null,
  broker_fee numeric not null default 0,
  sell_tax numeric not null default 0,
  total_transaction_cost numeric not null default 0,
  execution_source text not null,
  exit_reason text not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (requested_quantity > 0),
  check (filled_quantity > 0),
  check (remaining_quantity >= 0),
  check (execution_price > 0),
  check (broker_fee >= 0),
  check (sell_tax >= 0),
  check (total_transaction_cost >= 0)
);

create index if not exists idx_paper_protective_execution_fills_v2_position
  on public.paper_protective_execution_fills_v2(position_id, observed_at desc);

create index if not exists idx_paper_protective_execution_fills_v2_stock
  on public.paper_protective_execution_fills_v2(stock_code, observed_at desc);

${protectiveFunction}

commit;
`;

let stopPatched =
  patchRpcCall(
    stopOriginal,
    "STOP_LOSS",
    "STOP_LOSS_SERVICE",
  );

let trailingPatched =
  patchTrailingPositionQuantity(
    trailingOriginal,
  );

trailingPatched =
  patchRpcCall(
    trailingPatched,
    "TRAILING_STOP",
    "TRAILING_SERVICE",
  );

const writes = {
  [helperRel]:
    embedded.helper,
  [contractRel]:
    embedded.contract,
  [staticRel]:
    embedded.staticVerify,
  [migrationRel]:
    migration,
  [stopRel]:
    stopPatched,
  [trailingRel]:
    trailingPatched,
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
    rel === stopRel ||
    rel === trailingRel
  ) {
    const backup =
      `${target}.pre-paper-execution-realism-v2-protective-sell`;

    if (
      !fs.existsSync(
        backup,
      )
    ) {
      fs.writeFileSync(
        backup,
        rel === stopRel
          ? stopOriginal
          : trailingOriginal,
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
        "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_BINDING_SOURCE_V1_INSTALLED",
      changed: [
        stopRel,
        trailingRel,
        helperRel,
        migrationRel,
      ],
      generatedTests: [
        contractRel,
        staticRel,
      ],
      databaseApplied:
        false,
      protectiveSemantics: {
        partialFillAllowed:
          true,
        remainingPositionPreserved:
          true,
        transactionCostsApplied:
          true,
        zeroLiquidityFallback:
          true,
        killSwitchBlocksProtectiveExit:
          false,
      },
      safety: {
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        realTradingChanged:
          false,
      },
      nextAction:
        "RUN_PROTECTIVE_SELL_CONTRACT_STATIC_AND_IMPORT_SMOKE",
    },
    null,
    2,
  ),
);
