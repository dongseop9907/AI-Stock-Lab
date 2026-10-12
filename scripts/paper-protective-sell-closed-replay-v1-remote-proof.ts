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
        "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_CLOSED_REPLAY_V1_REMOTE_PROOF_BLOCKED",
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
      await fetch(url, {
        method: "GET",
        headers: {
          ...headers,
          Accept: accept,
        },
      });

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

  const positions =
    await get(
      `${base}/paper_positions?select=id&limit=5`,
    );

  const trades =
    await get(
      `${base}/paper_trade_history?select=id,source_position_id,closed_at&limit=5`,
    );

  const paths =
    openApi.json?.paths ?? {};

  const v4Paths =
    Object.keys(paths)
      .filter(path =>
        /execute_paper_protective_sell_v4/i.test(
          path,
        ),
      );

  const checks = {
    openApiReachable:
      openApi.ok,

    protectiveSellV4Exposed:
      v4Paths.length > 0,

    positionsQueryable:
      positions.ok,

    tradeHistoryQueryable:
      trades.ok,

    noPositionsCreatedByRepair:
      Array.isArray(positions.json) &&
      positions.json.length === 0,

    noTradesCreatedByRepair:
      Array.isArray(trades.json) &&
      trades.json.length === 0,
  };

  const failed =
    Object.entries(checks)
      .filter(([, ok]) => ok !== true)
      .map(([name]) => name);

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_CLOSED_REPLAY_V1_REMOTE_PROOF_PASS"
        : "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_CLOSED_REPLAY_V1_REMOTE_PROOF_REVIEW",

    classification:
      failed.length === 0
        ? "PROTECTIVE_SELL_V4_REMOTE_SURFACE_READY"
        : "PROTECTIVE_SELL_V4_REMOTE_SURFACE_REVIEW_REQUIRED",

    checks,

    rpcEvidence: {
      v4Paths,
    },

    remotePreview: {
      positions:
        positions.json,
      trades:
        trades.json,
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
        ? "CLOSE_PROTECTIVE_SELL_CLOSED_REPLAY_V1_STRUCTURALLY"
        : "REVIEW_REMOTE_V4_DEPLOYMENT",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}

void main();
