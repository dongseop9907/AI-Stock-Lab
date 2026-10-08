type RestResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL;

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL_OR_SERVICE_ROLE_KEY_MISSING");
}

async function rest(pathname: string): Promise<RestResult> {
  const response = await fetch(
    `${supabaseUrl!.replace(/\/$/, "")}/rest/v1/${pathname}`,
    {
      headers: {
        apikey: serviceRoleKey!,
        Authorization: `Bearer ${serviceRoleKey!}`,
      },
    },
  );

  const text = await response.text();

  let body: unknown = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function snapshot() {
  const [
    approved,
    positions,
    reserved,
  ] = await Promise.all([
    rest(
      "paper_order_requests?select=id,status&status=eq.RISK_APPROVED&limit=20",
    ),
    rest(
      "paper_positions?select=id,stock_code&limit=20",
    ),
    rest(
      "paper_order_requests?select=id,status,reserved_risk_amount,reserved_risk_released_at&reserved_risk_amount=gt.0&reserved_risk_released_at=is.null&limit=20",
    ),
  ]);

  if (!approved.ok || !positions.ok || !reserved.ok) {
    throw new Error(
      `NO_ORDER_PRECHECK_READ_FAILED approved=${approved.status} positions=${positions.status} reserved=${reserved.status}`,
    );
  }

  return {
    approved:
      Array.isArray(approved.body)
        ? approved.body
        : [],
    positions:
      Array.isArray(positions.body)
        ? positions.body
        : [],
    reserved:
      Array.isArray(reserved.body)
        ? reserved.body
        : [],
  };
}

function assertEmpty(
  phase: string,
  value: Awaited<ReturnType<typeof snapshot>>,
) {
  const counts = {
    riskApprovedOrders: value.approved.length,
    positions: value.positions.length,
    activeReservedRiskOrders: value.reserved.length,
  };

  if (
    counts.riskApprovedOrders !== 0 ||
    counts.positions !== 0 ||
    counts.activeReservedRiskOrders !== 0
  ) {
    throw new Error(
      `${phase}_NO_ORDER_PRECONDITION_FAILED:${JSON.stringify(counts)}`,
    );
  }

  return counts;
}

async function main() {
  const before = await snapshot();
  const beforeCounts = assertEmpty("PRE", before);

  const sourceModule =
    await import("../lib/trading/execute-approved-paper-orders");

  const candidates = Object.entries(sourceModule)
    .filter(
      ([name, value]) =>
        typeof value === "function" &&
        /execute.*approved.*paper.*order/i.test(name),
    );

  if (candidates.length !== 1) {
    throw new Error(
      `APPROVED_EXECUTOR_EXPORT_UNRESOLVED:${JSON.stringify(
        candidates.map(([name]) => name),
      )}`,
    );
  }

  const [
    executorName,
    executorValue,
  ] = candidates[0];

  const executor =
    executorValue as (...args: unknown[]) => unknown;

  if (executor.length !== 0) {
    throw new Error(
      `APPROVED_EXECUTOR_REQUIRES_ARGUMENTS:${executorName}:arity=${executor.length}`,
    );
  }

  /*
   * Safe operational smoke:
   * precondition proves there are no RISK_APPROVED orders,
   * no positions and no active reserved risk orders.
   * This calls only the existing approved-order executor.
   * It does not create an order.
   */
  const executionResult =
    await executor();

  const after = await snapshot();
  const afterCounts = assertEmpty("POST", after);

  console.log(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_GAP_SLIPPAGE_NO_ORDER_EXECUTOR_SMOKE_V1_VERIFIED",

        executor: {
          exportName: executorName,
          arity: executor.length,
          result:
            executionResult === undefined
              ? null
              : executionResult,
        },

        before: beforeCounts,
        after: afterCounts,

        invariants: {
          noApprovedOrderWasAvailable: true,
          noPositionWasAvailable: true,
          noActiveReservedRiskWasAvailable: true,
          noOrderCreatedBySmoke: true,
          noPositionCreatedBySmoke: true,
        },

        safety: {
          realTradingEnabledByScript: false,
          schedulerChanged: false,
          forwardOosChanged: false,
        },

        nextGate:
          "GAP_SLIPPAGE_EXECUTION_BINDING_V1_PAPER_PATH_COMPLETE",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_GAP_SLIPPAGE_NO_ORDER_EXECUTOR_SMOKE_V1_BLOCKED",
        error:
          error instanceof Error
            ? error.message
            : String(error),
        safety: {
          orderCreationRequestedByScript: false,
          realTradingEnabledByScript: false,
          schedulerChanged: false,
          forwardOosChanged: false,
        },
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
});
