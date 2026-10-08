const fs = require("fs");
const path = require("path");

const root = process.cwd();

const servicePath = path.resolve(
  root,
  "lib/trading/paper-order-service.ts"
);

if (!fs.existsSync(servicePath)) {
  throw new Error(
    "PAPER_ORDER_SERVICE_NOT_FOUND"
  );
}

function write(rel, content) {
  const file = path.resolve(
    root,
    rel
  );

  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  fs.writeFileSync(
    file,
    content,
    "utf8"
  );
}

write(
  "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql",
  "-- Alpha V3 / Risk V3\n-- Committed Risk V2\n--\n-- Atomic boundary:\n--   1) serialize BUY risk commitment\n--   2) calculate OPEN_POSITION_STOP_RISK inside PostgreSQL\n--   3) sum all ACTIVE_BUY_RESERVED_RISK\n--   4) validate against equity * 2%\n--   5) create paper order + reservation in the SAME transaction\n--\n-- Historical/backtest policy is unchanged.\n\nbegin;\n\nalter table public.paper_order_requests\n  add column if not exists reserved_risk_amount numeric not null default 0,\n  add column if not exists reserved_risk_at timestamptz null,\n  add column if not exists reserved_risk_released_at timestamptz null,\n  add column if not exists reserved_risk_release_reason text null,\n  add column if not exists committed_risk_reason text null,\n  add column if not exists committed_risk_snapshot jsonb null;\n\nalter table public.paper_order_requests\n  drop constraint if exists paper_order_requests_reserved_risk_nonnegative;\n\nalter table public.paper_order_requests\n  add constraint paper_order_requests_reserved_risk_nonnegative\n  check (reserved_risk_amount >= 0);\n\ncreate index if not exists idx_paper_order_requests_active_reserved_risk\n  on public.paper_order_requests (account_id, reserved_risk_amount)\n  where reserved_risk_amount > 0;\n\ncreate or replace function public.create_paper_buy_order_with_committed_risk_v3(\n  p_account_id uuid,\n  p_stock_code text,\n  p_requested_quantity integer,\n  p_entry_price numeric,\n  p_stop_price numeric,\n  p_risk_decision_id uuid,\n  p_preflight_approved boolean,\n  p_equity numeric,\n  p_max_aggregate_open_risk_rate numeric default 0.02\n)\nreturns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path = public\nas $$\ndeclare\n  v_existing_order public.paper_order_requests%rowtype;\n  v_order public.paper_order_requests%rowtype;\n\n  v_invalid_open_stops integer := 0;\n  v_open_position_risk numeric := 0;\n  v_reserved_risk numeric := 0;\n  v_proposed_risk numeric := 0;\n  v_budget numeric := 0;\n  v_committed_before numeric := 0;\n  v_committed_after numeric := 0;\n\n  v_final_approved boolean := false;\n  v_status text := 'RISK_REJECTED';\n  v_reason text := null;\n  v_snapshot jsonb;\nbegin\n  if p_account_id is null then\n    raise exception 'ACCOUNT_ID_REQUIRED';\n  end if;\n\n  if coalesce(trim(p_stock_code), '') = '' then\n    raise exception 'STOCK_CODE_REQUIRED';\n  end if;\n\n  if p_requested_quantity is null or p_requested_quantity <= 0 then\n    raise exception 'REQUESTED_QUANTITY_INVALID';\n  end if;\n\n  if p_entry_price is null or p_entry_price <= 0 then\n    raise exception 'ENTRY_PRICE_INVALID';\n  end if;\n\n  if p_stop_price is null or p_stop_price <= 0 then\n    raise exception 'STOP_PRICE_INVALID';\n  end if;\n\n  if p_risk_decision_id is null then\n    raise exception 'RISK_DECISION_ID_REQUIRED';\n  end if;\n\n  if p_equity is null or p_equity <= 0 then\n    raise exception 'EQUITY_INVALID';\n  end if;\n\n  if (\n    p_max_aggregate_open_risk_rate is null or\n    p_max_aggregate_open_risk_rate <= 0 or\n    p_max_aggregate_open_risk_rate > 1\n  ) then\n    raise exception 'MAX_AGGREGATE_OPEN_RISK_RATE_INVALID';\n  end if;\n\n  /*\n   * One account-wide transaction lock serializes all committed BUY risk.\n   * Two simultaneous approvals cannot consume the same remaining budget.\n   */\n  perform pg_advisory_xact_lock(\n    hashtext('AI_STOCK_LAB_COMMITTED_RISK_V3:' || p_account_id::text)\n  );\n\n  /*\n   * RPC-level idempotency:\n   * if a network retry repeats the same risk_decision_id, return the already\n   * created order instead of reserving risk again.\n   */\n  select *\n  into v_existing_order\n  from public.paper_order_requests\n  where risk_decision_id = p_risk_decision_id\n  order by created_at asc\n  limit 1\n  for update;\n\n  if found then\n    return jsonb_build_object(\n      'idempotent', true,\n      'order', jsonb_build_object(\n        'id', v_existing_order.id,\n        'stock_code', v_existing_order.stock_code,\n        'side', v_existing_order.side,\n        'requested_quantity', v_existing_order.requested_quantity,\n        'approved_quantity', v_existing_order.approved_quantity,\n        'entry_price', v_existing_order.entry_price,\n        'stop_price', v_existing_order.stop_price,\n        'status', v_existing_order.status,\n        'created_at', v_existing_order.created_at\n      ),\n      'committedRisk',\n        coalesce(\n          v_existing_order.committed_risk_snapshot,\n          '{}'::jsonb\n        )\n    );\n  end if;\n\n  v_budget :=\n    p_equity *\n    p_max_aggregate_open_risk_rate;\n\n  /*\n   * Fail closed if an open position does not have a valid stop.\n   */\n  select\n    count(*) filter (\n      where current_stop_price is null\n         or current_stop_price <= 0\n         or average_price is null\n         or average_price <= 0\n         or quantity is null\n         or quantity <= 0\n    ),\n    coalesce(\n      sum(\n        greatest(\n          0,\n          (\n            average_price -\n            current_stop_price\n          ) *\n          quantity\n        )\n      ) filter (\n        where current_stop_price is not null\n          and current_stop_price > 0\n          and average_price is not null\n          and average_price > 0\n          and quantity is not null\n          and quantity > 0\n      ),\n      0\n    )\n  into\n    v_invalid_open_stops,\n    v_open_position_risk\n  from public.paper_positions\n  where account_id = p_account_id;\n\n  /*\n   * Any positive reservation counts until it is explicitly/automatically\n   * released. This intentionally fails safe even if an unusual intermediate\n   * status appears.\n   */\n  select\n    coalesce(\n      sum(\n        greatest(\n          0,\n          reserved_risk_amount\n        )\n      ),\n      0\n    )\n  into v_reserved_risk\n  from public.paper_order_requests\n  where account_id = p_account_id\n    and reserved_risk_amount > 0;\n\n  v_proposed_risk :=\n    greatest(\n      0,\n      (\n        p_entry_price -\n        p_stop_price\n      ) *\n      p_requested_quantity\n    );\n\n  v_committed_before :=\n    v_open_position_risk +\n    v_reserved_risk;\n\n  v_committed_after :=\n    v_committed_before +\n    v_proposed_risk;\n\n  if p_preflight_approved is not true then\n    v_final_approved := false;\n    v_reason := 'PREEXISTING_RISK_VALIDATION_REJECTED';\n\n  elsif v_invalid_open_stops > 0 then\n    v_final_approved := false;\n    v_reason := 'OPEN_POSITION_STOP_MISSING';\n\n  elsif p_stop_price >= p_entry_price then\n    v_final_approved := false;\n    v_reason := 'STOP_NOT_BELOW_ENTRY';\n\n  elsif v_proposed_risk <= 0 then\n    v_final_approved := false;\n    v_reason := 'PROPOSED_RISK_NOT_POSITIVE';\n\n  elsif v_committed_after > v_budget + 0.000001 then\n    v_final_approved := false;\n    v_reason := 'AGGREGATE_COMMITTED_RISK_LIMIT_EXCEEDED';\n\n  else\n    v_final_approved := true;\n    v_reason := 'COMMITTED_RISK_RESERVED';\n  end if;\n\n  if v_final_approved then\n    v_status := 'RISK_APPROVED';\n  else\n    v_status := 'RISK_REJECTED';\n  end if;\n\n  v_snapshot :=\n    jsonb_build_object(\n      'maxAggregateOpenRiskRate',\n        p_max_aggregate_open_risk_rate,\n      'riskBudgetAmount',\n        v_budget,\n      'equity',\n        p_equity,\n      'openPositionRiskAmount',\n        v_open_position_risk,\n      'activeBuyReservedRiskAmount',\n        v_reserved_risk,\n      'committedRiskBefore',\n        v_committed_before,\n      'proposedTradeRiskAmount',\n        v_proposed_risk,\n      'committedRiskAfter',\n        v_committed_after,\n      'invalidOpenPositionStopCount',\n        v_invalid_open_stops,\n      'approved',\n        v_final_approved,\n      'reason',\n        v_reason\n    );\n\n  insert into public.paper_order_requests (\n    account_id,\n    stock_code,\n    side,\n    requested_quantity,\n    approved_quantity,\n    entry_price,\n    stop_price,\n    status,\n    risk_decision_id,\n    reserved_risk_amount,\n    reserved_risk_at,\n    committed_risk_reason,\n    committed_risk_snapshot\n  )\n  values (\n    p_account_id,\n    p_stock_code,\n    'BUY',\n    p_requested_quantity,\n    case\n      when v_final_approved\n      then p_requested_quantity\n      else 0\n    end,\n    p_entry_price,\n    p_stop_price,\n    v_status,\n    p_risk_decision_id,\n    case\n      when v_final_approved\n      then v_proposed_risk\n      else 0\n    end,\n    case\n      when v_final_approved\n      then now()\n      else null\n    end,\n    v_reason,\n    v_snapshot\n  )\n  returning *\n  into v_order;\n\n  /*\n   * The original risk decision is the pre-commit decision. If committed risk\n   * rejects the order, final approval must also be false in the audit row.\n   */\n  if not v_final_approved then\n    update public.risk_decisions\n    set approved = false\n    where id = p_risk_decision_id;\n  end if;\n\n  return jsonb_build_object(\n    'idempotent', false,\n    'order', jsonb_build_object(\n      'id', v_order.id,\n      'stock_code', v_order.stock_code,\n      'side', v_order.side,\n      'requested_quantity', v_order.requested_quantity,\n      'approved_quantity', v_order.approved_quantity,\n      'entry_price', v_order.entry_price,\n      'stop_price', v_order.stop_price,\n      'status', v_order.status,\n      'created_at', v_order.created_at\n    ),\n    'committedRisk',\n      v_snapshot\n  );\nend;\n$$;\n\ncreate or replace function public.release_paper_buy_risk_v3(\n  p_order_id uuid,\n  p_reason text default 'RELEASED'\n)\nreturns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path = public\nas $$\ndeclare\n  v_order public.paper_order_requests%rowtype;\n  v_existing_reserved numeric := 0;\nbegin\n  if p_order_id is null then\n    raise exception 'ORDER_ID_REQUIRED';\n  end if;\n\n  perform pg_advisory_xact_lock(\n    hashtext('AI_STOCK_LAB_COMMITTED_RISK_V3:' || (\n      select account_id::text\n      from public.paper_order_requests\n      where id = p_order_id\n    ))\n  );\n\n  select *\n  into v_order\n  from public.paper_order_requests\n  where id = p_order_id\n  for update;\n\n  if not found then\n    raise exception 'PAPER_ORDER_NOT_FOUND:%', p_order_id;\n  end if;\n\n  v_existing_reserved :=\n    greatest(\n      0,\n      coalesce(\n        v_order.reserved_risk_amount,\n        0\n      )\n    );\n\n  if v_existing_reserved <= 0 then\n    return jsonb_build_object(\n      'released', true,\n      'idempotent', true,\n      'reason', 'NO_ACTIVE_RESERVATION',\n      'orderId', p_order_id,\n      'releasedRiskAmount', 0\n    );\n  end if;\n\n  update public.paper_order_requests\n  set\n    reserved_risk_amount = 0,\n    reserved_risk_released_at = now(),\n    reserved_risk_release_reason =\n      coalesce(\n        nullif(trim(p_reason), ''),\n        'RELEASED'\n      )\n  where id = p_order_id;\n\n  return jsonb_build_object(\n    'released', true,\n    'idempotent', false,\n    'reason',\n      coalesce(\n        nullif(trim(p_reason), ''),\n        'RELEASED'\n      ),\n    'orderId', p_order_id,\n    'releasedRiskAmount', v_existing_reserved\n  );\nend;\n$$;\n\ncreate or replace function public.release_terminal_paper_order_reserved_risk_v3()\nreturns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public\nas $$\nbegin\n  if\n    new.status::text in (\n      'FILLED',\n      'RISK_REJECTED',\n      'REJECTED',\n      'CANCELLED',\n      'CANCELED',\n      'EXPIRED',\n      'FAILED',\n      'CLOSED'\n    )\n    and coalesce(new.reserved_risk_amount, 0) > 0\n  then\n    new.reserved_risk_amount := 0;\n    new.reserved_risk_released_at :=\n      coalesce(\n        new.reserved_risk_released_at,\n        now()\n      );\n    new.reserved_risk_release_reason :=\n      coalesce(\n        new.reserved_risk_release_reason,\n        'TERMINAL_STATUS:' ||\n          new.status::text\n      );\n  end if;\n\n  return new;\nend;\n$$;\n\ndrop trigger if exists trg_release_terminal_paper_order_reserved_risk_v3\n  on public.paper_order_requests;\n\ncreate trigger trg_release_terminal_paper_order_reserved_risk_v3\nbefore update of status\non public.paper_order_requests\nfor each row\nexecute function public.release_terminal_paper_order_reserved_risk_v3();\n\ncommit;\n"
);

write(
  "lib/trading/committed-risk-reservation.ts",
  "import {\n  createSupabaseServerClient,\n} from \"@/lib/supabase\";\n\nexport interface CreateCommittedRiskPaperBuyOrderInput {\n  accountId: string;\n  stockCode: string;\n  requestedQuantity: number;\n  entryPrice: number;\n  stopPrice: number;\n  riskDecisionId: string;\n  preflightApproved: boolean;\n  equity: number;\n  maxAggregateOpenRiskRate?: number;\n}\n\nexport interface CommittedRiskSnapshot {\n  maxAggregateOpenRiskRate?: number;\n  riskBudgetAmount?: number;\n  equity?: number;\n  openPositionRiskAmount?: number;\n  activeBuyReservedRiskAmount?: number;\n  committedRiskBefore?: number;\n  proposedTradeRiskAmount?: number;\n  committedRiskAfter?: number;\n  invalidOpenPositionStopCount?: number;\n  approved?: boolean;\n  reason?: string;\n}\n\nexport interface CommittedRiskOrder {\n  id: string;\n  stock_code: string;\n  side: string;\n  requested_quantity: number;\n  approved_quantity: number;\n  entry_price: number | string;\n  stop_price: number | string | null;\n  status: string;\n  created_at: string;\n}\n\nexport interface CreateCommittedRiskPaperBuyOrderResult {\n  idempotent: boolean;\n  order: CommittedRiskOrder;\n  committedRisk: CommittedRiskSnapshot;\n}\n\nfunction assertPositive(\n  value: number,\n  label: string,\n) {\n  if (\n    !Number.isFinite(value) ||\n    value <= 0\n  ) {\n    throw new Error(\n      `${label}_INVALID`,\n    );\n  }\n}\n\nexport async function createPaperBuyOrderWithCommittedRisk(\n  input: CreateCommittedRiskPaperBuyOrderInput,\n): Promise<CreateCommittedRiskPaperBuyOrderResult> {\n  if (!input.accountId) {\n    throw new Error(\n      \"ACCOUNT_ID_REQUIRED\",\n    );\n  }\n\n  if (!input.stockCode?.trim()) {\n    throw new Error(\n      \"STOCK_CODE_REQUIRED\",\n    );\n  }\n\n  if (\n    !Number.isInteger(\n      input.requestedQuantity,\n    ) ||\n    input.requestedQuantity <= 0\n  ) {\n    throw new Error(\n      \"REQUESTED_QUANTITY_INVALID\",\n    );\n  }\n\n  assertPositive(\n    input.entryPrice,\n    \"ENTRY_PRICE\",\n  );\n\n  assertPositive(\n    input.stopPrice,\n    \"STOP_PRICE\",\n  );\n\n  assertPositive(\n    input.equity,\n    \"EQUITY\",\n  );\n\n  if (!input.riskDecisionId) {\n    throw new Error(\n      \"RISK_DECISION_ID_REQUIRED\",\n    );\n  }\n\n  const rate =\n    input.maxAggregateOpenRiskRate ??\n    0.02;\n\n  if (\n    !Number.isFinite(rate) ||\n    rate <= 0 ||\n    rate > 1\n  ) {\n    throw new Error(\n      \"MAX_AGGREGATE_OPEN_RISK_RATE_INVALID\",\n    );\n  }\n\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data,\n    error,\n  } =\n    await supabase.rpc(\n      \"create_paper_buy_order_with_committed_risk_v3\",\n      {\n        p_account_id:\n          input.accountId,\n        p_stock_code:\n          input.stockCode,\n        p_requested_quantity:\n          input.requestedQuantity,\n        p_entry_price:\n          input.entryPrice,\n        p_stop_price:\n          input.stopPrice,\n        p_risk_decision_id:\n          input.riskDecisionId,\n        p_preflight_approved:\n          input.preflightApproved,\n        p_equity:\n          input.equity,\n        p_max_aggregate_open_risk_rate:\n          rate,\n      },\n    );\n\n  if (error) {\n    throw new Error(\n      `COMMITTED_RISK_ORDER_CREATE_FAILED:${error.message}`,\n    );\n  }\n\n  if (\n    !data ||\n    typeof data !== \"object\" ||\n    Array.isArray(data)\n  ) {\n    throw new Error(\n      \"COMMITTED_RISK_ORDER_INVALID_RESPONSE\",\n    );\n  }\n\n  const result =\n    data as unknown as\n      CreateCommittedRiskPaperBuyOrderResult;\n\n  if (\n    !result.order ||\n    !result.order.id ||\n    !result.order.status\n  ) {\n    throw new Error(\n      \"COMMITTED_RISK_ORDER_RESPONSE_MISSING_ORDER\",\n    );\n  }\n\n  return result;\n}\n\nexport async function releasePaperBuyCommittedRisk(\n  orderId: string,\n  reason = \"RELEASED\",\n) {\n  if (!orderId) {\n    throw new Error(\n      \"ORDER_ID_REQUIRED\",\n    );\n  }\n\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data,\n    error,\n  } =\n    await supabase.rpc(\n      \"release_paper_buy_risk_v3\",\n      {\n        p_order_id:\n          orderId,\n        p_reason:\n          reason,\n      },\n    );\n\n  if (error) {\n    throw new Error(\n      `COMMITTED_RISK_RELEASE_FAILED:${error.message}`,\n    );\n  }\n\n  return data;\n}\n"
);

write(
  "scripts/alpha-v3-committed-risk-atomic-integration-verify.ts",
  "import fs from \"node:fs\";\nimport path from \"node:path\";\nimport ts from \"typescript\";\n\nconst ROOT =\n  process.cwd();\n\nconst MIGRATION =\n  path.resolve(\n    ROOT,\n    \"supabase/migrations/20261008000100_committed_risk_reservation_v3.sql\",\n  );\n\nconst HELPER =\n  path.resolve(\n    ROOT,\n    \"lib/trading/committed-risk-reservation.ts\",\n  );\n\nconst SERVICE =\n  path.resolve(\n    ROOT,\n    \"lib/trading/paper-order-service.ts\",\n  );\n\nfunction text(\n  file: string,\n) {\n  if (!fs.existsSync(file)) {\n    throw new Error(\n      `FILE_MISSING:${path.relative(ROOT, file)}`,\n    );\n  }\n\n  return fs.readFileSync(\n    file,\n    \"utf8\",\n  );\n}\n\nconst sql =\n  text(MIGRATION);\n\nconst helper =\n  text(HELPER);\n\nconst service =\n  text(SERVICE);\n\nconst checks = {\n  atomicCreateRpc:\n    /create_paper_buy_order_with_committed_risk_v3/i.test(sql),\n\n  accountScopedAdvisoryLock:\n    /pg_advisory_xact_lock[\\s\\S]*p_account_id/i.test(sql),\n\n  openRiskCalculatedInDb:\n    /average_price[\\s\\S]*current_stop_price[\\s\\S]*quantity/i.test(sql),\n\n  reservedRiskCalculatedInDb:\n    /sum[\\s\\S]*reserved_risk_amount/i.test(sql),\n\n  twoPctBudget:\n    /0\\.02/.test(sql),\n\n  sameTransactionOrderInsert:\n    /insert into public\\.paper_order_requests/i.test(sql),\n\n  rpcIdempotency:\n    /risk_decision_id\\s*=\\s*p_risk_decision_id/i.test(sql),\n\n  invalidStopFailClosed:\n    /OPEN_POSITION_STOP_MISSING/i.test(sql),\n\n  terminalReleaseIncludesFilled:\n    /'FILLED'/.test(sql),\n\n  terminalReleaseIncludesRiskRejected:\n    /'RISK_REJECTED'/.test(sql),\n\n  helperCallsAtomicRpc:\n    /create_paper_buy_order_with_committed_risk_v3/.test(helper),\n\n  serviceImportsHelper:\n    /createPaperBuyOrderWithCommittedRisk/.test(service),\n\n  directOrderInsertRemoved:\n    !/\\.from\\(\\s*\"paper_order_requests\"\\s*\\)\\s*\\.insert\\(/m.test(service),\n\n  servicePassesEquity:\n    /equity:\\s*accountEquity/.test(service),\n\n  servicePassesRiskDecision:\n    /riskDecisionId:\\s*decisionData\\.id/.test(service),\n\n  serviceReturnsCommittedRisk:\n    /committedRisk/.test(service),\n};\n\nconst syntacticDiagnostics = [\n  [HELPER, helper],\n  [SERVICE, service],\n].flatMap(\n  ([file, source]) =>\n    ts.transpileModule(\n      source,\n      {\n        fileName:\n          file,\n        compilerOptions: {\n          target:\n            ts.ScriptTarget.ES2022,\n          module:\n            ts.ModuleKind.ESNext,\n          jsx:\n            ts.JsxEmit.Preserve,\n        },\n        reportDiagnostics:\n          true,\n      },\n    )\n      .diagnostics ??\n    [],\n);\n\nconst syntaxErrors =\n  syntacticDiagnostics.map(\n    (diagnostic) =>\n      ts.flattenDiagnosticMessageText(\n        diagnostic.messageText,\n        \"\\n\",\n      ),\n  );\n\nconst failed =\n  Object.entries(checks)\n    .filter(\n      ([, value]) =>\n        !value,\n    )\n    .map(\n      ([key]) =>\n        key,\n    );\n\nconst ok =\n  failed.length === 0 &&\n  syntaxErrors.length === 0;\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        ok\n          ? \"ALPHA_V3_COMMITTED_RISK_ATOMIC_INTEGRATION_V2_VERIFIED\"\n          : \"ALPHA_V3_COMMITTED_RISK_ATOMIC_INTEGRATION_V2_VERIFY_FAILED\",\n\n      checks,\n      failed,\n      syntaxErrors,\n\n      contract: {\n        committedRisk:\n          \"OPEN_POSITION_STOP_RISK + ACTIVE_BUY_RESERVED_RISK\",\n\n        atomicBoundary:\n          \"POSTGRES_RPC_CREATES_ORDER_AND_RESERVATION_IN_ONE_TRANSACTION\",\n\n        maxAggregateOpenRiskRate:\n          0.02,\n\n        retryIdempotency:\n          \"RISK_DECISION_ID\",\n\n        productionPolicyChanged:\n          false,\n\n        databaseApplied:\n          false,\n      },\n\n      nextGate:\n        ok\n          ? \"APPLY_MIGRATION_052_THEN_RUN_DB_CONCURRENCY_TEST\"\n          : \"REPAIR_ATOMIC_COMMITTED_RISK_INTEGRATION\",\n    },\n    null,\n    2,\n  ),\n);\n\nif (!ok) {\n  process.exitCode =\n    2;\n}\n"
);

let service =
  fs.readFileSync(
    servicePath,
    "utf8"
  ).replace(/\r\n/g, "\n");

const backupPath =
  servicePath +
  ".before-committed-risk-v2.bak";

if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(
    backupPath,
    service,
    "utf8"
  );
}

const importLine =
  'import { createPaperBuyOrderWithCommittedRisk } from "@/lib/trading/committed-risk-reservation";';

if (
  !service.includes(
    "createPaperBuyOrderWithCommittedRisk"
  )
) {
  const importAnchor =
    'import { validateBuyRisk } from "@/lib/trading/risk-manager";';

  if (!service.includes(importAnchor)) {
    throw new Error(
      "PATCH_ANCHOR_NOT_FOUND:RISK_MANAGER_IMPORT"
    );
  }

  service =
    service.replace(
      importAnchor,
      importAnchor +
        "\n" +
        importLine
    );
}

const blockRegex =
  /  \/\*[\s\S]*?위험관리 승인을 통과한 주문만 approved_quantity를 가진다\.[\s\S]*?const \{ data: orderData, error: orderError \} =[\s\S]*?\.single\(\);/;

if (
  !service.includes(
    "const committedOrderResult ="
  )
) {
  if (!blockRegex.test(service)) {
    throw new Error(
      "PATCH_ANCHOR_NOT_FOUND:PAPER_ORDER_INSERT_BLOCK"
    );
  }

  const replacement = `  /*
   * Risk V3 committed-risk boundary.
   * PostgreSQL serializes committed BUY risk and creates the order +
   * reservation atomically. This closes the TOCTOU window that existed
   * between TypeScript validation and order creation.
   */
  const committedOrderResult =
    await createPaperBuyOrderWithCommittedRisk({
      accountId:
        account.id,

      stockCode:
        input.stockCode,

      requestedQuantity:
        input.requestedQuantity,

      entryPrice,

      stopPrice:
        input.proposedStopPrice,

      riskDecisionId:
        decisionData.id,

      preflightApproved:
        riskResult.approved,

      equity:
        accountEquity,

      maxAggregateOpenRiskRate:
        0.02,
    });

  const orderData =
    committedOrderResult.order;

  const committedRisk =
    committedOrderResult.committedRisk;

  const orderError:
    { message?: string } |
    null =
    null;`;

  service =
    service.replace(
      blockRegex,
      replacement
    );
}

if (
  service.includes(
    "risk: riskResult,"
  ) &&
  !service.includes(
    "committedRisk,"
  )
) {
  service =
    service.replace(
      "risk: riskResult,",
      `risk: {
      ...riskResult,
      approved:
        orderData.status ===
        "RISK_APPROVED",
      committedRisk,
    },`
    );
} else if (
  service.includes(
    "risk: riskResult,"
  )
) {
  service =
    service.replace(
      "risk: riskResult,",
      `risk: {
      ...riskResult,
      approved:
        orderData.status ===
        "RISK_APPROVED",
      committedRisk,
    },`
    );
}

fs.writeFileSync(
  servicePath,
  service,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_COMMITTED_RISK_ATOMIC_INTEGRATION_V2_INSTALLED",

      generatedFiles: [
        "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql",
        "lib/trading/committed-risk-reservation.ts",
        "scripts/alpha-v3-committed-risk-atomic-integration-verify.ts"
      ],

      patchedFile:
        "lib/trading/paper-order-service.ts",

      backupFile:
        "lib/trading/paper-order-service.ts.before-committed-risk-v2.bak",

      design: {
        openPositionRiskCalculatedInsideDb:
          true,

        reservationSummedInsideDb:
          true,

        orderAndReservationAtomic:
          true,

        concurrencySerialized:
          true,

        retryIdempotencyByRiskDecisionId:
          true,

        maxAggregateOpenRiskRate:
          0.02
      },

      databaseApplied:
        false,

      nextAction:
        "RUN_ATOMIC_INTEGRATION_VERIFY"
    },
    null,
    2
  )
);
