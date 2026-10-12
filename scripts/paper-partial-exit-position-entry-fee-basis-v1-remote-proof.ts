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
        "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_REMOTE_PROOF_BLOCKED",
      reason:
        "Missing Supabase URL or service role key.",
    }, null, 2));

    process.exitCode = 2;
    return;
  }

  const base =
    SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1";

  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    Accept: "application/json",
  };

  async function probe(url: string) {
    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    return {
      ok: response.ok,
      status: response.status,
      body: (await response.text()).slice(0, 1000),
    };
  }

  const positionColumns =
    await probe(
      `${base}/paper_positions?select=id,entry_broker_fee_basis_total,entry_broker_fee_basis_remaining&limit=1`,
    );

  const tradeSurface =
    await probe(
      `${base}/paper_trade_history?select=id,source_position_id,entry_broker_fee,total_transaction_cost,net_pnl,cost_model_version&limit=1`,
    );

  const pass =
    positionColumns.ok &&
    tradeSurface.ok;

  console.log(JSON.stringify({
    status:
      pass
        ? "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_REMOTE_PROOF_PASS"
        : "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_REMOTE_PROOF_FAIL",

    classification:
      pass
        ? "REMOTE_SCHEMA_SURFACE_READY"
        : "REMOTE_SCHEMA_SURFACE_NOT_READY",

    probes: {
      positionColumns: {
        ok: positionColumns.ok,
        httpStatus: positionColumns.status,
        bodyPreview: positionColumns.body,
      },

      tradeSurface: {
        ok: tradeSurface.ok,
        httpStatus: tradeSurface.status,
        bodyPreview: tradeSurface.body,
      },
    },

    note:
      "The migration itself contains transactional PostgreSQL deployment assertions for UNIQUE removal, functions and triggers. A successful db push plus this PostgREST column proof establishes deployment readiness without creating orders or positions.",

    safety: {
      readOnly: true,
      httpMethod: "GET",
      databaseWrites: 0,
      rpcInvoked: false,
      ordersCreated: 0,
      ordersExecuted: 0,
      positionsChanged: 0,
      realTradingEnabled: false,
      secretsPrinted: false,
    },

    nextGate:
      pass
        ? "RUN_POST_DEPLOYMENT_SOURCE_AND_REMOTE_REGRESSION"
        : "REVIEW_DB_PUSH_OR_SCHEMA_RELOAD",
  }, null, 2));

  process.exitCode =
    pass
      ? 0
      : 1;
}

void main();
