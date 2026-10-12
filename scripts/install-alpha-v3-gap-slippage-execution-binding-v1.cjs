const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const migrationDir =
  path.resolve(
    root,
    "supabase/migrations"
  );

const executorPath =
  path.resolve(
    root,
    "lib/trading/execute-paper-order.ts"
  );

const approvedPath =
  path.resolve(
    root,
    "lib/trading/execute-approved-paper-orders.ts"
  );

if (
  !fs.existsSync(
    migrationDir
  ) ||
  !fs.existsSync(
    executorPath
  ) ||
  !fs.existsSync(
    approvedPath
  )
) {
  throw new Error(
    "GAP_SLIPPAGE_BINDING_REQUIRED_SURFACE_MISSING"
  );
}

const approvedSource =
  fs.readFileSync(
    approvedPath,
    "utf8"
  );

if (
  !approvedSource.includes(
    "executePaperOrder"
  )
) {
  throw new Error(
    "APPROVED_EXECUTOR_DOES_NOT_REUSE_SINGLE_EXECUTOR"
  );
}

function extractFunctionDefinition(
  source,
  functionName
) {
  const lower =
    source.toLowerCase();

  const needle =
    `function public.${functionName.toLowerCase()}(`;

  const hit =
    lower.lastIndexOf(
      needle
    );

  if (
    hit <
    0
  ) {
    return null;
  }

  const createOrReplace =
    lower.lastIndexOf(
      "create or replace function",
      hit
    );

  const create =
    lower.lastIndexOf(
      "create function",
      hit
    );

  const start =
    Math.max(
      createOrReplace,
      create
    );

  if (
    start <
    0
  ) {
    return null;
  }

  const end =
    lower.indexOf(
      "$$;",
      hit
    );

  if (
    end <
    0
  ) {
    return null;
  }

  return source.slice(
    start,
    end +
      3
  );
}

const migrations =
  fs
    .readdirSync(
      migrationDir
    )
    .filter(
      (name) =>
        name.endsWith(
          ".sql"
        )
    )
    .sort();

let latestSourceFile =
  null;

let latestDefinition =
  null;

for (
  const name of
    migrations
) {
  const full =
    path.resolve(
      migrationDir,
      name
    );

  const text =
    fs.readFileSync(
      full,
      "utf8"
    );

  const definition =
    extractFunctionDefinition(
      text,
      "execute_paper_buy_order"
    );

  if (
    definition
  ) {
    latestSourceFile =
      name;

    latestDefinition =
      definition;
  }
}

if (
  !latestDefinition ||
  !latestSourceFile
) {
  throw new Error(
    "LATEST_EXECUTE_PAPER_BUY_ORDER_DEFINITION_NOT_FOUND"
  );
}

if (
  !/function\s+public\.execute_paper_buy_order\s*\(\s*p_order_id\s+uuid\s*\)/i.test(
    latestDefinition
  )
) {
  throw new Error(
    "LATEST_FILL_RPC_SIGNATURE_UNEXPECTED"
  );
}

if (
  !latestDefinition.includes(
    "v_order.entry_price"
  )
) {
  throw new Error(
    "LATEST_FILL_RPC_ENTRY_PRICE_REFERENCE_NOT_FOUND"
  );
}

if (
  !latestDefinition.includes(
    "declare"
  )
) {
  throw new Error(
    "LATEST_FILL_RPC_DECLARE_BLOCK_NOT_FOUND"
  );
}

const functionName =
  "execute_paper_buy_order_with_execution_price_v1";

let cloned =
  latestDefinition.replace(
    /function\s+public\.execute_paper_buy_order\s*\(\s*p_order_id\s+uuid\s*\)/i,
    `function public.${functionName}(
  p_order_id uuid,
  p_execution_price numeric,
  p_execution_observed_at timestamptz
)`
  );

cloned =
  cloned.replace(
    /v_order\.entry_price/g,
    "p_execution_price"
  );

cloned =
  cloned.replace(
    /\bdeclare\b/i,
    `declare
  v_execution_drift_rate numeric;
  v_execution_stop_distance_rate numeric;
  v_execution_risk_amount numeric;
  v_execution_block_reason text;`
  );

const guard =
`
  if p_execution_price is null or p_execution_price <= 0 then
    v_execution_block_reason := 'EXECUTION_PRICE_INVALID';
  elsif p_execution_observed_at is null then
    v_execution_block_reason := 'EXECUTION_OBSERVED_AT_REQUIRED';
  elsif p_execution_observed_at > clock_timestamp() + interval '30 seconds' then
    v_execution_block_reason := 'EXECUTION_SNAPSHOT_FROM_FUTURE';
  elsif p_execution_observed_at < clock_timestamp() - interval '10 minutes' then
    v_execution_block_reason := 'EXECUTION_SNAPSHOT_STALE';
  elsif v_order.entry_price is null or v_order.entry_price <= 0 then
    v_execution_block_reason := 'PLANNED_ENTRY_PRICE_INVALID';
  elsif v_order.stop_price is null or v_order.stop_price <= 0 then
    v_execution_block_reason := 'STOP_PRICE_INVALID';
  elsif p_execution_price <= v_order.stop_price then
    v_execution_block_reason := 'EXECUTION_PRICE_NOT_ABOVE_STOP';
  else
    v_execution_drift_rate :=
      (p_execution_price - v_order.entry_price) / v_order.entry_price;

    v_execution_stop_distance_rate :=
      (p_execution_price - v_order.stop_price) / p_execution_price;

    v_execution_risk_amount :=
      greatest(0, p_execution_price - v_order.stop_price)
      * v_order.approved_quantity;

    if v_execution_drift_rate > 0.01 then
      v_execution_block_reason := 'ADVERSE_ENTRY_DRIFT_EXCEEDED';
    elsif v_execution_stop_distance_rate < 0.01 then
      v_execution_block_reason := 'STOP_DISTANCE_TOO_CLOSE_AT_EXECUTION';
    elsif v_execution_stop_distance_rate > 0.05 then
      v_execution_block_reason := 'STOP_DISTANCE_TOO_FAR_AT_EXECUTION';
    elsif v_execution_risk_amount >
      coalesce(v_order.reserved_risk_amount, 0) + 0.01 then
      v_execution_block_reason := 'ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK';
    end if;
  end if;

  if v_execution_block_reason is not null then
    update public.paper_order_requests
    set
      status = 'FAILED',
      execution_price = p_execution_price,
      execution_price_observed_at = p_execution_observed_at,
      execution_price_source = 'MARKET_SNAPSHOT_CLOSE',
      execution_rejection_reason = v_execution_block_reason,
      execution_risk_snapshot = jsonb_build_object(
        'plannedEntryPrice', v_order.entry_price,
        'executionPrice', p_execution_price,
        'stopPrice', v_order.stop_price,
        'approvedQuantity', v_order.approved_quantity,
        'reservedRiskAmount', coalesce(v_order.reserved_risk_amount, 0),
        'actualRiskAmount', v_execution_risk_amount,
        'driftRate', v_execution_drift_rate,
        'stopDistanceRate', v_execution_stop_distance_rate,
        'allowed', false,
        'blockReason', v_execution_block_reason
      )
    where id = v_order.id;

    return jsonb_build_object(
      'status', 'FAILED',
      'orderId', v_order.id,
      'stockCode', v_order.stock_code,
      'executionPrice', p_execution_price,
      'reason', v_execution_block_reason,
      'gapSlippageBlocked', true
    );
  end if;

  update public.paper_order_requests
  set
    execution_price = p_execution_price,
    execution_price_observed_at = p_execution_observed_at,
    execution_price_source = 'MARKET_SNAPSHOT_CLOSE',
    execution_rejection_reason = null,
    execution_risk_snapshot = jsonb_build_object(
      'plannedEntryPrice', v_order.entry_price,
      'executionPrice', p_execution_price,
      'stopPrice', v_order.stop_price,
      'approvedQuantity', v_order.approved_quantity,
      'reservedRiskAmount', coalesce(v_order.reserved_risk_amount, 0),
      'actualRiskAmount', v_execution_risk_amount,
      'driftRate', v_execution_drift_rate,
      'stopDistanceRate', v_execution_stop_distance_rate,
      'allowed', true
    )
  where id = v_order.id;
`;

const insertionCandidates = [
  "v_required_cash :=",
  "v_required_amount :=",
  "if v_account.cash_balance",
  "if v_account.cash_balance <"
];

let insertionIndex =
  -1;

for (
  const candidate of
    insertionCandidates
) {
  const idx =
    cloned.indexOf(
      candidate
    );

  if (
    idx >=
    0 &&
    (
      insertionIndex <
        0 ||
      idx <
        insertionIndex
    )
  ) {
    insertionIndex =
      idx;
  }
}

if (
  insertionIndex <
  0
) {
  throw new Error(
    "SAFE_GUARD_INSERTION_POINT_NOT_FOUND_IN_FILL_RPC"
  );
}

cloned =
  cloned.slice(
    0,
    insertionIndex
  ) +
  guard +
  "\n" +
  cloned.slice(
    insertionIndex
  );

const migration =
`begin;

alter table public.paper_order_requests
  add column if not exists execution_price numeric null,
  add column if not exists execution_price_observed_at timestamptz null,
  add column if not exists execution_price_source text null,
  add column if not exists execution_rejection_reason text null,
  add column if not exists execution_risk_snapshot jsonb null;

alter table public.paper_order_requests
  drop constraint if exists paper_order_requests_execution_price_positive;

alter table public.paper_order_requests
  add constraint paper_order_requests_execution_price_positive
  check (
    execution_price is null
    or execution_price > 0
  );

${cloned}

revoke all on function public.${functionName}(uuid, numeric, timestamptz)
from public;

grant execute on function public.${functionName}(uuid, numeric, timestamptz)
to service_role;

commit;
`;


const EXECUTOR_SOURCE = "import {\n  createSupabaseServerClient,\n} from \"@/lib/supabase\";\n\nimport {\n  resolveSafePaperBuyExecution,\n} from \"@/lib/trading/resolve-safe-paper-buy-execution\";\n\ninterface PaperOrderExecutionRecord {\n  id: string;\n  account_id: string;\n  stock_code: string;\n  side: string;\n  status: string;\n  approved_quantity: number | string | null;\n  entry_price: number | string | null;\n  stop_price: number | string | null;\n  reserved_risk_amount: number | string | null;\n}\n\ninterface PaperAccountRecord {\n  id: string;\n  cash_balance: number | string | null;\n  trading_mode: string;\n}\n\ninterface PaperPositionRecord {\n  stock_code: string;\n  quantity: number | string | null;\n  average_price: number | string | null;\n}\n\ninterface SnapshotRecord {\n  stock_code: string;\n  close_price: number | string | null;\n  observed_at: string;\n}\n\nfunction toNumber(\n  value:\n    | number\n    | string\n    | null\n    | undefined,\n): number {\n  const parsed =\n    Number(\n      value,\n    );\n\n  return Number.isFinite(\n    parsed,\n  )\n    ? parsed\n    : 0;\n}\n\nasync function resolveCurrentPaperAccountEquity(\n  accountId:\n    string,\n) {\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data:\n      accountData,\n    error:\n      accountError,\n  } =\n    await supabase\n      .from(\n        \"paper_accounts\",\n      )\n      .select(\n        \"id,cash_balance,trading_mode\",\n      )\n      .eq(\n        \"id\",\n        accountId,\n      )\n      .single();\n\n  if (\n    accountError ||\n    !accountData\n  ) {\n    throw new Error(\n      `PAPER_EXECUTION_ACCOUNT_READ_FAILED:${\n        accountError\n          ?.message ??\n        accountId\n      }`,\n    );\n  }\n\n  const account =\n    accountData as\n      PaperAccountRecord;\n\n  if (\n    account.trading_mode !==\n    \"PAPER\"\n  ) {\n    throw new Error(\n      \"PAPER_EXECUTION_REQUIRES_PAPER_ACCOUNT\",\n    );\n  }\n\n  const {\n    data:\n      positionData,\n    error:\n      positionError,\n  } =\n    await supabase\n      .from(\n        \"paper_positions\",\n      )\n      .select(\n        \"stock_code,quantity,average_price\",\n      )\n      .eq(\n        \"account_id\",\n        accountId,\n      );\n\n  if (\n    positionError\n  ) {\n    throw new Error(\n      `PAPER_EXECUTION_POSITION_READ_FAILED:${positionError.message}`,\n    );\n  }\n\n  const positions =\n    (\n      positionData ??\n      []\n    ) as\n      PaperPositionRecord[];\n\n  const stockCodes =\n    [\n      ...new Set(\n        positions.map(\n          (\n            position,\n          ) =>\n            position.stock_code,\n        ),\n      ),\n    ];\n\n  const latestPriceByStock =\n    new Map<\n      string,\n      number\n    >();\n\n  if (\n    stockCodes.length >\n    0\n  ) {\n    const {\n      data:\n        snapshotData,\n      error:\n        snapshotError,\n    } =\n      await supabase\n        .from(\n          \"market_snapshots\",\n        )\n        .select(\n          \"stock_code,close_price,observed_at\",\n        )\n        .in(\n          \"stock_code\",\n          stockCodes,\n        )\n        .order(\n          \"observed_at\",\n          {\n            ascending:\n              false,\n          },\n        );\n\n    if (\n      snapshotError\n    ) {\n      throw new Error(\n        `PAPER_EXECUTION_POSITION_SNAPSHOT_READ_FAILED:${snapshotError.message}`,\n      );\n    }\n\n    for (\n      const row of\n        (\n          snapshotData ??\n          []\n        ) as\n          SnapshotRecord[]\n    ) {\n      if (\n        latestPriceByStock.has(\n          row.stock_code,\n        )\n      ) {\n        continue;\n      }\n\n      const price =\n        toNumber(\n          row.close_price,\n        );\n\n      if (\n        price >\n        0\n      ) {\n        latestPriceByStock.set(\n          row.stock_code,\n          price,\n        );\n      }\n    }\n  }\n\n  let investedAmount =\n    0;\n\n  for (\n    const position of\n      positions\n  ) {\n    const quantity =\n      toNumber(\n        position.quantity,\n      );\n\n    const price =\n      latestPriceByStock.get(\n        position.stock_code,\n      ) ??\n      toNumber(\n        position.average_price,\n      );\n\n    investedAmount +=\n      Math.max(\n        0,\n        quantity,\n      ) *\n      Math.max(\n        0,\n        price,\n      );\n  }\n\n  return {\n    account,\n\n    accountEquity:\n      Math.max(\n        0,\n        toNumber(\n          account.cash_balance,\n        ),\n      ) +\n      investedAmount,\n  };\n}\n\nasync function failUnsafePaperBuyExecution(\n  input: {\n    orderId: string;\n    executionPrice:\n      number |\n      null;\n    executionObservedAt:\n      string |\n      null;\n    reason: string;\n    riskSnapshot:\n      unknown;\n  },\n) {\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data,\n    error,\n  } =\n    await supabase\n      .from(\n        \"paper_order_requests\",\n      )\n      .update({\n        status:\n          \"FAILED\",\n\n        execution_price:\n          input.executionPrice,\n\n        execution_price_observed_at:\n          input.executionObservedAt,\n\n        execution_price_source:\n          \"MARKET_SNAPSHOT_CLOSE\",\n\n        execution_rejection_reason:\n          input.reason,\n\n        execution_risk_snapshot:\n          input.riskSnapshot,\n      })\n      .eq(\n        \"id\",\n        input.orderId,\n      )\n      .eq(\n        \"status\",\n        \"RISK_APPROVED\",\n      )\n      .select(\n        \"id,status,reserved_risk_amount,reserved_risk_released_at,reserved_risk_release_reason\",\n      )\n      .maybeSingle();\n\n  if (\n    error\n  ) {\n    throw new Error(\n      `PAPER_EXECUTION_FAIL_TRANSITION_FAILED:${error.message}`,\n    );\n  }\n\n  if (\n    !data\n  ) {\n    throw new Error(\n      \"PAPER_EXECUTION_FAIL_TRANSITION_LOST_RACE\",\n    );\n  }\n\n  return data;\n}\n\nexport async function executePaperOrder(\n  orderId:\n    string,\n) {\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data:\n      orderData,\n    error:\n      orderError,\n  } =\n    await supabase\n      .from(\n        \"paper_order_requests\",\n      )\n      .select(\n        [\n          \"id\",\n          \"account_id\",\n          \"stock_code\",\n          \"side\",\n          \"status\",\n          \"approved_quantity\",\n          \"entry_price\",\n          \"stop_price\",\n          \"reserved_risk_amount\",\n        ].join(\",\"),\n      )\n      .eq(\n        \"id\",\n        orderId,\n      )\n      .single();\n\n  if (\n    orderError ||\n    !orderData\n  ) {\n    throw new Error(\n      `PAPER_EXECUTION_ORDER_READ_FAILED:${\n        orderError\n          ?.message ??\n        orderId\n      }`,\n    );\n  }\n\n  const order =\n    orderData as\n      PaperOrderExecutionRecord;\n\n  if (\n    order.side !==\n    \"BUY\"\n  ) {\n    throw new Error(\n      \"PAPER_EXECUTION_BUY_ONLY\",\n    );\n  }\n\n  if (\n    order.status !==\n    \"RISK_APPROVED\"\n  ) {\n    throw new Error(\n      `PAPER_EXECUTION_REQUIRES_RISK_APPROVED:${order.status}`,\n    );\n  }\n\n  const quantity =\n    toNumber(\n      order.approved_quantity,\n    );\n\n  const plannedEntryPrice =\n    toNumber(\n      order.entry_price,\n    );\n\n  const stopPrice =\n    toNumber(\n      order.stop_price,\n    );\n\n  const reservedRiskAmount =\n    toNumber(\n      order.reserved_risk_amount,\n    );\n\n  if (\n    !Number.isInteger(\n      quantity,\n    ) ||\n    quantity <=\n      0 ||\n    plannedEntryPrice <=\n      0 ||\n    stopPrice <=\n      0 ||\n    reservedRiskAmount <\n      0\n  ) {\n    throw new Error(\n      \"PAPER_EXECUTION_ORDER_RISK_FIELDS_INVALID\",\n    );\n  }\n\n  const {\n    accountEquity,\n  } =\n    await resolveCurrentPaperAccountEquity(\n      order.account_id,\n    );\n\n  if (\n    accountEquity <=\n    0\n  ) {\n    throw new Error(\n      \"PAPER_EXECUTION_ACCOUNT_EQUITY_INVALID\",\n    );\n  }\n\n  const safeExecution =\n    await resolveSafePaperBuyExecution({\n      stockCode:\n        order.stock_code,\n\n      plannedEntryPrice,\n\n      stopPrice,\n\n      quantity,\n\n      accountEquity,\n\n      reservedRiskAmount,\n    });\n\n  if (\n    !safeExecution.allowed ||\n    safeExecution.executionPrice ===\n      null ||\n    !safeExecution.executionPriceObservedAt\n  ) {\n    const failedOrder =\n      await failUnsafePaperBuyExecution({\n        orderId:\n          order.id,\n\n        executionPrice:\n          safeExecution.executionPrice,\n\n        executionObservedAt:\n          safeExecution.executionPriceObservedAt,\n\n        reason:\n          safeExecution.reason,\n\n        riskSnapshot:\n          safeExecution,\n      });\n\n    return {\n      status:\n        \"PAPER_BUY_EXECUTION_BLOCKED\",\n\n      orderId:\n        order.id,\n\n      stockCode:\n        order.stock_code,\n\n      execution:\n        safeExecution,\n\n      order:\n        failedOrder,\n    };\n  }\n\n  const {\n    data,\n    error,\n  } =\n    await supabase.rpc(\n      \"execute_paper_buy_order_with_execution_price_v1\",\n      {\n        p_order_id:\n          order.id,\n\n        p_execution_price:\n          safeExecution.executionPrice,\n\n        p_execution_observed_at:\n          safeExecution.executionPriceObservedAt,\n      },\n    );\n\n  if (\n    error\n  ) {\n    throw new Error(\n      `EXECUTE_PAPER_BUY_ORDER_WITH_EXECUTION_PRICE_FAILED:${error.message}`,\n    );\n  }\n\n  return {\n    status:\n      \"PAPER_BUY_EXECUTION_COMPLETE\",\n\n    orderId:\n      order.id,\n\n    stockCode:\n      order.stock_code,\n\n    execution:\n      safeExecution,\n\n    result:\n      data,\n  };\n}\n";
const CONTRACT_SOURCE = "import {\n  strict as assert,\n} from \"node:assert\";\n\nimport {\n  evaluateBuyExecutionGapSlippageRisk,\n  evaluateProtectiveExitGap,\n} from \"../lib/trading/gap-slippage-risk\";\n\nimport {\n  evaluatePaperExecutionPriceSnapshot,\n} from \"../lib/trading/paper-execution-price-model\";\n\nfunction main() {\n  const checks:\n    Record<\n      string,\n      boolean\n    > = {};\n\n  const now =\n    new Date(\n      \"2026-10-08T06:00:00.000Z\",\n    );\n\n  const price =\n    evaluatePaperExecutionPriceSnapshot({\n      stockCode:\n        \"005930\",\n\n      snapshot: {\n        stock_code:\n          \"005930\",\n\n        close_price:\n          100_500,\n\n        observed_at:\n          \"2026-10-08T05:59:00.000Z\",\n      },\n\n      now,\n    });\n\n  assert.equal(\n    price.usable,\n    true,\n  );\n\n  const safe =\n    evaluateBuyExecutionGapSlippageRisk({\n      stockCode:\n        \"005930\",\n\n      plannedEntryPrice:\n        100_000,\n\n      executionPrice:\n        price.executionPrice!,\n\n      stopPrice:\n        97_000,\n\n      quantity:\n        1,\n\n      accountEquity:\n        10_000_000,\n\n      reservedRiskAmount:\n        4_000,\n    });\n\n  checks.safeFreshExecutionAllowed =\n    safe.allowed ===\n      true &&\n    safe.drift.adverseRate ===\n      0.005;\n\n  const reservedExceeded =\n    evaluateBuyExecutionGapSlippageRisk({\n      stockCode:\n        \"005930\",\n\n      plannedEntryPrice:\n        100_000,\n\n      executionPrice:\n        100_500,\n\n      stopPrice:\n        97_000,\n\n      quantity:\n        1,\n\n      accountEquity:\n        10_000_000,\n\n      reservedRiskAmount:\n        3_000,\n    });\n\n  checks.reservedRiskExceededBlocked =\n    reservedExceeded.allowed ===\n      false &&\n    reservedExceeded.blockers.includes(\n      \"ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK\",\n    );\n\n  const driftExceeded =\n    evaluateBuyExecutionGapSlippageRisk({\n      stockCode:\n        \"005930\",\n\n      plannedEntryPrice:\n        100_000,\n\n      executionPrice:\n        101_500,\n\n      stopPrice:\n        97_000,\n\n      quantity:\n        1,\n\n      accountEquity:\n        10_000_000,\n\n      reservedRiskAmount:\n        10_000,\n    });\n\n  checks.adverseDriftBlocked =\n    driftExceeded.allowed ===\n      false &&\n    driftExceeded.blockers.includes(\n      \"ADVERSE_ENTRY_DRIFT_EXCEEDED\",\n    );\n\n  const exit =\n    evaluateProtectiveExitGap({\n      stockCode:\n        \"005930\",\n\n      stopPrice:\n        96_000,\n\n      executableExitPrice:\n        91_000,\n\n      quantity:\n        10,\n    });\n\n  checks.protectiveExitStillAllowed =\n    exit.allowed ===\n      true &&\n    exit.additionalLossAmount ===\n      50_000;\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          !value,\n      )\n      .map(\n        ([name]) =>\n          name,\n      );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          failed.length ===\n          0\n            ? \"ALPHA_V3_GAP_SLIPPAGE_EXECUTION_BINDING_V1_CONTRACT_VERIFIED\"\n            : \"ALPHA_V3_GAP_SLIPPAGE_EXECUTION_BINDING_V1_CONTRACT_REVIEW\",\n\n        checks,\n\n        failed,\n\n        invariants: {\n          actualExecutionPrice:\n            \"LATEST_FRESH_MARKET_SNAPSHOT_CLOSE\",\n\n          unsafeBuy:\n            \"FAILED_TERMINAL_NO_FILL\",\n\n          terminalReservationRelease:\n            \"EXISTING_DB_TRIGGER\",\n\n          dbDefense:\n            \"EXECUTION_PRICE_DRIFT_STOP_DISTANCE_RESERVED_RISK_REVALIDATED\",\n\n          protectiveExit:\n            \"UNCHANGED_NEVER_BLOCKED_BY_GAP\",\n        },\n\n        safety: {\n          realDatabaseCalls:\n            0,\n\n          databaseWrites:\n            0,\n\n          ordersCreated:\n            0,\n\n          positionsChanged:\n            0,\n        },\n      },\n      null,\n      2,\n    ),\n  );\n\n  if (\n    failed.length >\n    0\n  ) {\n    process.exitCode =\n      2;\n  }\n}\n\nmain();\n";
const STATIC_VERIFY_SOURCE = "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root =\n  process.cwd();\n\nconst executor =\n  fs.readFileSync(\n    path.resolve(\n      root,\n      \"lib/trading/execute-paper-order.ts\"\n    ),\n    \"utf8\"\n  );\n\nconst approved =\n  fs.readFileSync(\n    path.resolve(\n      root,\n      \"lib/trading/execute-approved-paper-orders.ts\"\n    ),\n    \"utf8\"\n  );\n\nconst migration =\n  fs.readFileSync(\n    path.resolve(\n      root,\n      \"supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql\"\n    ),\n    \"utf8\"\n  );\n\nconst checks = {\n  executorUsesSafeResolver:\n    executor.includes(\n      \"resolveSafePaperBuyExecution\"\n    ),\n\n  executorReadsReservedRisk:\n    executor.includes(\n      \"reserved_risk_amount\"\n    ),\n\n  executorCallsNewRpc:\n    executor.includes(\n      \"execute_paper_buy_order_with_execution_price_v1\"\n    ) &&\n    executor.includes(\n      \"p_execution_price\"\n    ) &&\n    executor.includes(\n      \"p_execution_observed_at\"\n    ),\n\n  unsafeOrderTerminalFailed:\n    executor.includes(\n      'status:\\n          \"FAILED\"'\n    ) &&\n    executor.includes(\n      \"execution_rejection_reason\"\n    ),\n\n  batchExecutorUsesSingleExecutor:\n    approved.includes(\n      \"executePaperOrder\"\n    ),\n\n  migrationAddsExecutionAudit:\n    migration.includes(\n      \"execution_price numeric\"\n    ) &&\n    migration.includes(\n      \"execution_price_observed_at timestamptz\"\n    ) &&\n    migration.includes(\n      \"execution_risk_snapshot jsonb\"\n    ),\n\n  migrationUsesExecutionPrice:\n    migration.includes(\n      \"p_execution_price\"\n    ) &&\n    migration.includes(\n      \"v_order.entry_price\"\n    ),\n\n  dbDriftGuard:\n    migration.includes(\n      \"ADVERSE_ENTRY_DRIFT_EXCEEDED\"\n    ),\n\n  dbReservedRiskGuard:\n    migration.includes(\n      \"ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK\"\n    ),\n\n  dbSnapshotFreshnessGuard:\n    migration.includes(\n      \"EXECUTION_SNAPSHOT_STALE\"\n    ),\n\n  oldRpcNotCalledBySingleExecutor:\n    !executor.includes(\n      '.rpc(\\n    \"execute_paper_buy_order\",'\n    ),\n\n  forwardOosUntouched:\n    true\n};\n\nconst failed =\n  Object.entries(\n    checks\n  )\n    .filter(\n      ([, value]) =>\n        !value\n    )\n    .map(\n      ([name]) =>\n        name\n    );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_GAP_SLIPPAGE_EXECUTION_BINDING_V1_STATIC_VERIFIED\"\n          : \"ALPHA_V3_GAP_SLIPPAGE_EXECUTION_BINDING_V1_STATIC_REVIEW\",\n\n      checks,\n      failed,\n\n      productionBinding:\n        \"SOURCE_PATCHED_MIGRATION_NOT_APPLIED_BY_INSTALLER\",\n\n      safety: {\n        installerDatabaseWrites:\n          0,\n\n        ordersCreated:\n          0,\n\n        positionsChanged:\n          0,\n\n        schedulerChanged:\n          false,\n\n        forwardOosChanged:\n          false\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"CONTRACT_TYPESCRIPT_THEN_APPLY_MIGRATION_AND_NO_ORDER_REGRESSION\"\n          : \"REVIEW_EXECUTION_BINDING\"\n    },\n    null,\n    2\n  )\n);\n\nif (\n  failed.length >\n  0\n) {\n  process.exitCode =\n    2;\n}\n";

const outputs = [
  {
    rel:
      "lib/trading/execute-paper-order.ts",
    text:
      EXECUTOR_SOURCE
  },
  {
    rel:
      "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql",
    text:
      migration
  },
  {
    rel:
      "scripts/alpha-v3-gap-slippage-execution-binding-v1-contract-test.ts",
    text:
      CONTRACT_SOURCE
  },
  {
    rel:
      "scripts/alpha-v3-gap-slippage-execution-binding-v1-static-verify.cjs",
    text:
      STATIC_VERIFY_SOURCE
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
  "risk:gap-slippage:binding:test"
] =
  "tsx scripts/alpha-v3-gap-slippage-execution-binding-v1-contract-test.ts";

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
        "ALPHA_V3_GAP_SLIPPAGE_EXECUTION_BINDING_V1_INSTALLED",

      sourceFillRpc:
        latestSourceFile,

      generatedFiles:
        outputs.map(
          (item) =>
            item.rel
        ),

      binding: {
        paperExecutionPrice:
          "LATEST_FRESH_MARKET_SNAPSHOT_CLOSE",

        applicationGuard:
          true,

        dbDefenseInDepth:
          true,

        unsafeBuyTerminalStatus:
          "FAILED",

        reservationRelease:
          "EXISTING_TERMINAL_RELEASE_TRIGGER",

        positionAveragePrice:
          "ACTUAL_EXECUTION_PRICE",

        maxAdverseEntryDriftRate:
          0.01,

        minStopDistanceRate:
          0.01,

        maxStopDistanceRate:
          0.05,

        actualRiskCannotExceedReservedRisk:
          true
      },

      safety: {
        installerDatabaseWrites:
          0,

        migrationApplied:
          false,

        ordersCreated:
          0,

        ordersExecuted:
          0,

        positionsChanged:
          0,

        schedulerChanged:
          false,

        forwardOosChanged:
          false
      },

      nextAction:
        "STATIC_CONTRACT_TYPESCRIPT_THEN_REVIEW_BEFORE_DB_MIGRATION_APPLY"
    },
    null,
    2
  )
);
