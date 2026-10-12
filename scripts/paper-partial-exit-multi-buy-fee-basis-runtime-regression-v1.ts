
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
        "AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_BLOCKED",
      reason:
        "Missing Supabase URL or service role key.",
    }, null, 2));

    process.exitCode = 2;
    return;
  }

  const base =
    SUPABASE_URL.replace(/\/+$/, "") +
    "/rest/v1";

  const headers: Record<string, string> = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  async function request(url: string, init: RequestInit) {
    const response =
      await fetch(url, init);

    const text =
      await response.text();

    let json: any = null;

    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      text,
      json,
    };
  }

  const run =
    await request(
      `${base}/rpc/run_paper_fee_basis_rt_v1`,
      {
        method: "POST",
        headers,
        body: "{}",
      },
    );

  if (!run.ok) {
    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_FAILED",

      classification:
        "RUNTIME_REGRESSION_FAILED_BEFORE_FULL_ASSERTION",

      httpStatus:
        run.status,

      response:
        run.json ?? run.text,

      safety: {
        testRpcInvoked: true,
        functionCallAtomic: true,
        persistentFixtureWrites: false,
        realOrdersSent: false,
        realTradingEnabled: false,
      },
    }, null, 2));

    process.exitCode = 1;
    return;
  }

  const result =
    run.json;

  const fixture =
    result?.fixture ?? {};

  const riskIds =
    Array.isArray(fixture?.riskDecisionIds)
      ? fixture.riskDecisionIds
      : [];

  const orderIds =
    Array.isArray(fixture?.buyOrderIds)
      ? fixture.buyOrderIds
      : [];

  const tradeIds =
    Array.isArray(fixture?.tradeIds)
      ? fixture.tradeIds
      : [];

  const positionId =
    fixture?.positionId ?? null;

  function inFilter(ids: string[]) {
    return `(${ids.join(",")})`;
  }

  async function getJson(path: string) {
    return request(
      `${base}/${path}`,
      {
        method: "GET",
        headers,
      },
    );
  }

  const riskProof =
    riskIds.length === 2
      ? await getJson(
          `risk_decisions?id=in.${encodeURIComponent(inFilter(riskIds))}&select=id`,
        )
      : null;

  const orderProof =
    orderIds.length === 2
      ? await getJson(
          `paper_order_requests?id=in.${encodeURIComponent(inFilter(orderIds))}&select=id`,
        )
      : null;

  const positionProof =
    positionId
      ? await getJson(
          `paper_positions?id=eq.${encodeURIComponent(positionId)}&select=id`,
        )
      : null;

  const tradeProof =
    tradeIds.length === 3
      ? await getJson(
          `paper_trade_history?id=in.${encodeURIComponent(inFilter(tradeIds))}&select=id`,
        )
      : null;

  const checks = {
    rpcReturnedPass:
      result?.status ===
      "AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_PASS",

    classificationCorrect:
      result?.classification ===
      "MULTI_BUY_ENTRY_FEE_ACCUMULATION_AND_THREE_STAGE_PARTIAL_EXIT_ALLOCATION_RUNTIME_PROVEN",

    internalChecksAllTrue:
      result?.checks &&
      Object.values(result.checks).every(v => v === true),

    fixtureWritesRolledBack:
      result?.safety?.fixtureWritesRolledBack === true,

    riskRowsAbsentExternally:
      Boolean(riskProof?.ok) &&
      Array.isArray(riskProof?.json) &&
      riskProof.json.length === 0,

    orderRowsAbsentExternally:
      Boolean(orderProof?.ok) &&
      Array.isArray(orderProof?.json) &&
      orderProof.json.length === 0,

    positionAbsentExternally:
      Boolean(positionProof?.ok) &&
      Array.isArray(positionProof?.json) &&
      positionProof.json.length === 0,

    tradeRowsAbsentExternally:
      Boolean(tradeProof?.ok) &&
      Array.isArray(tradeProof?.json) &&
      tradeProof.json.length === 0,

    noProductionBuyRpc:
      result?.safety?.productionBuyRpcInvoked === false,

    noProductionSellRpc:
      result?.safety?.productionSellRpcInvoked === false,

    realTradingDisabled:
      result?.safety?.realTradingEnabled === false,
  };

  const failed =
    Object.entries(checks)
      .filter(([, ok]) => ok !== true)
      .map(([name]) => name);

  const pass =
    failed.length === 0;

  console.log(JSON.stringify({
    status:
      pass
        ? "AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_FULL_PASS"
        : "AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_REVIEW",

    classification:
      pass
        ? "MULTI_BUY_FEE_BASIS_AND_THREE_STAGE_PARTIAL_EXIT_RUNTIME_PROVEN_ALL_FIXTURES_ROLLED_BACK"
        : "MULTI_BUY_PARTIAL_EXIT_RUNTIME_OR_ROLLBACK_REVIEW_REQUIRED",

    runtimeResult:
      result,

    externalChecks:
      checks,

    failed,

    externalRollbackProof: {
      riskDecisionRows:
        riskProof?.json ?? null,

      orderRows:
        orderProof?.json ?? null,

      positionRows:
        positionProof?.json ?? null,

      tradeRows:
        tradeProof?.json ?? null,
    },

    safety: {
      databaseReads: 4,
      testRpcInvoked: true,
      transactionLocalFixtureWrites: true,
      fixtureWritesRolledBack:
        result?.safety?.fixtureWritesRolledBack === true,
      persistentFixtureWrites: false,
      productionBuyRpcInvoked: false,
      productionSellRpcInvoked: false,
      realOrdersSent: false,
      realTradingEnabled: false,
      secretsPrinted: false,
    },

    nextGate:
      pass
        ? "CLOSE_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_EVIDENCE"
        : "REVIEW_ONLY_FAILED_RUNTIME_OR_ROLLBACK_CHECKS",
  }, null, 2));

  process.exitCode =
    pass
      ? 0
      : 1;
}

void main();
