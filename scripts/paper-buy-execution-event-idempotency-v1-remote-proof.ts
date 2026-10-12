async function main() {
  const SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "";

  const SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "";

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(JSON.stringify({
      status:
        "AI_STOCK_LAB_PAPER_BUY_EXECUTION_EVENT_IDEMPOTENCY_V1_REMOTE_PROOF_BLOCKED",
      reason:
        "Missing Supabase URL or service role key.",
    }, null, 2));

    process.exitCode = 2;
    return;
  }

  const base =
    SUPABASE_URL.replace(/\/+$/, "") +
    "/rest/v1";

  const headers = {
    apikey:
      SERVICE_ROLE_KEY,

    Authorization:
      `Bearer ${SERVICE_ROLE_KEY}`,

    Accept:
      "application/json",
  };

  async function get(
    url: string,
    accept = "application/json",
  ) {
    const response =
      await fetch(
        url,
        {
          method:
            "GET",

          headers: {
            ...headers,
            Accept: accept,
          },
        },
      );

    const text =
      await response.text();

    let json: any = null;

    try {
      json = JSON.parse(text);
    }
    catch {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      text,
      json,
    };
  }

  const openApi =
    await get(
      `${base}/`,
      "application/openapi+json",
    );

  const ledger =
    await get(
      `${base}/paper_buy_execution_events_v1?select=id,order_id,event_fingerprint,execution_observed_at,execution_price,execution_price_source,fill_quantity,broker_fee,created_at&limit=5`,
    );

  const orders =
    await get(
      `${base}/paper_order_requests?select=id,status,filled_quantity,execution_fill_count&side=eq.BUY&limit=5`,
    );

  const positions =
    await get(
      `${base}/paper_positions?select=id&limit=5`,
    );

  const paths =
    openApi.json?.paths ??
    {};

  const v5Paths =
    Object.keys(paths)
      .filter(path =>
        /execute_paper_buy_order_with_execution_price_v5/i.test(
          path,
        ),
      );

  const checks = {
    openApiReachable:
      openApi.ok,

    buyV5RpcExposed:
      v5Paths.length > 0,

    ledgerQueryable:
      ledger.ok,

    buyOrdersQueryable:
      orders.ok,

    positionsQueryable:
      positions.ok,

    noLedgerRowsCreatedByMigration:
      Array.isArray(
        ledger.json,
      ) &&
      ledger.json.length === 0,

    noExecutedBuyRowsCreatedByMigration:
      Array.isArray(
        orders.json,
      ) &&
      orders.json.every(
        (row: any) =>
          Number(
            row?.filled_quantity ?? 0,
          ) <= 0 &&
          Number(
            row?.execution_fill_count ?? 0,
          ) <= 0 &&
          row?.status !== "FILLED",
      ),

    noPositionsCreatedByMigration:
      Array.isArray(
        positions.json,
      ) &&
      positions.json.length === 0,
  };

  const failed =
    Object.entries(checks)
      .filter(([, ok]) => ok !== true)
      .map(([name]) => name);

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_PAPER_BUY_EXECUTION_EVENT_IDEMPOTENCY_V1_REMOTE_PROOF_PASS"
        : "AI_STOCK_LAB_PAPER_BUY_EXECUTION_EVENT_IDEMPOTENCY_V1_REMOTE_PROOF_REVIEW",

    classification:
      failed.length === 0
        ? "BUY_V5_IDEMPOTENCY_REMOTE_SURFACE_READY"
        : "BUY_V5_IDEMPOTENCY_REMOTE_SURFACE_REVIEW_REQUIRED",

    checks,

    rpcEvidence: {
      v5Paths,
    },

    remotePreview: {
      ledgerRows:
        ledger.json,

      buyOrders:
        orders.json,

      positions:
        positions.json,
    },

    failed,

    safety: {
      readOnly: true,
      databaseWrites: 0,
      rpcInvoked: false,
      ordersCreated: 0,
      ordersExecuted: 0,
      positionsChanged: 0,
      realTradingEnabled: false,
      secretsPrinted: false,
    },

    nextGate:
      failed.length === 0
        ? "RUN_POST_DEPLOY_BUY_IDEMPOTENCY_SOURCE_REGRESSION"
        : "REVIEW_REMOTE_BUY_V5_DEPLOYMENT",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}

void main();
