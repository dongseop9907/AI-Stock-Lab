async function main() {
  const SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "";

  const SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "";

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_BLOCKED",
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
    apikey:
      SERVICE_ROLE_KEY,

    Authorization:
      `Bearer ${SERVICE_ROLE_KEY}`,

    "Content-Type":
      "application/json",

    Accept:
      "application/json",
  };

  async function request(
    url: string,
    init: RequestInit,
  ) {
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
      ok:
        response.ok,

      status:
        response.status,

      text,
      json,
    };
  }

  const run =
    await request(
      `${base}/rpc/run_paper_sell_v4_replay_rt_v1`,
      {
        method:
          "POST",

        headers,

        body:
          "{}",
      },
    );

  if (!run.ok) {
    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_FAILED",

      classification:
        "SELL_V4_REPLAY_RUNTIME_REGRESSION_FAILED_BEFORE_FULL_ASSERTION",

      httpStatus:
        run.status,

      response:
        run.json ?? run.text,

      safety: {
        testRpcInvoked:
          true,

        functionCallAtomic:
          true,

        persistentFixtureWrites:
          false,

        realOrdersSent:
          false,

        realTradingEnabled:
          false,
      },
    }, null, 2));

    process.exitCode = 1;
    return;
  }

  const result =
    run.json;

  const fixture =
    result?.fixture ?? {};

  const positionId =
    fixture?.positionId ?? null;

  const tradeIds =
    [
      fixture?.olderTradeId,
      fixture?.latestTradeId,
    ].filter(
      (x): x is string =>
        typeof x === "string" &&
        x.length > 0
    );

  async function get(path: string) {
    return request(
      `${base}/${path}`,
      {
        method:
          "GET",
        headers,
      },
    );
  }

  const positionProof =
    positionId
      ? await get(
          `paper_positions?id=eq.${encodeURIComponent(positionId)}&select=id`,
        )
      : null;

  const tradeProof =
    tradeIds.length === 2
      ? await get(
          `paper_trade_history?id=in.${encodeURIComponent(`(${tradeIds.join(",")})`)}&select=id`,
        )
      : null;

  const checks = {
    rpcReturnedPass:
      result?.status ===
      "AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_PASS",

    classificationCorrect:
      result?.classification ===
      "SELL_V4_CLOSED_REPLAY_DETERMINISTIC_LATEST_TRADE_RETURNED_WITH_ZERO_DUPLICATE_MUTATION",

    allInternalChecksTrue:
      result?.checks &&
      Object.values(
        result.checks
      ).every(
        value => value === true
      ),

    replayWasAlreadyClosed:
      result?.observed?.replayResult?.alreadyClosed === true,

    externalPositionAbsent:
      Boolean(positionProof?.ok) &&
      Array.isArray(positionProof?.json) &&
      positionProof.json.length === 0,

    externalTradesAbsent:
      Boolean(tradeProof?.ok) &&
      Array.isArray(tradeProof?.json) &&
      tradeProof.json.length === 0,

    fixtureWritesRolledBack:
      result?.safety?.fixtureWritesRolledBack === true,

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
        ? "AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_FULL_PASS"
        : "AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_REVIEW",

    classification:
      pass
        ? "SELL_V4_EXACT_CLOSED_REPLAY_RUNTIME_PROVEN_NO_DUPLICATE_MUTATION_ALL_FIXTURES_ROLLED_BACK"
        : "SELL_V4_REPLAY_RUNTIME_OR_ROLLBACK_REVIEW_REQUIRED",

    runtimeResult:
      result,

    externalChecks:
      checks,

    failed,

    externalRollbackProof: {
      positionRows:
        positionProof?.json ?? null,

      tradeRows:
        tradeProof?.json ?? null,
    },

    safety: {
      databaseReads:
        2,

      testRpcInvoked:
        true,

      productionSellV4Invoked:
        true,

      closedReplayBranchExpected:
        true,

      newSellExecutionExpected:
        false,

      transactionLocalFixtureWrites:
        true,

      persistentFixtureWrites:
        false,

      realOrdersSent:
        false,

      realTradingEnabled:
        false,

      secretsPrinted:
        false,
    },

    nextGate:
      pass
        ? "CLOSE_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_EVIDENCE"
        : "REVIEW_ONLY_FAILED_REPLAY_OR_ROLLBACK_CHECKS",
  }, null, 2));

  process.exitCode =
    pass
      ? 0
      : 1;
}

void main();
