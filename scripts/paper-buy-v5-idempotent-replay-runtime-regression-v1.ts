async function main() {
  const SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "";

  const SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "";

  if (
    !SUPABASE_URL ||
    !SERVICE_ROLE_KEY
  ) {
    console.error(JSON.stringify({
      status:
        "AI_STOCK_LAB_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_BLOCKED",

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
      await fetch(
        url,
        init,
      );

    const text =
      await response.text();

    let json: any = null;

    try {
      json =
        JSON.parse(text);
    }
    catch {
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
      `${base}/rpc/run_paper_buy_v5_idempotent_replay_runtime_regression_v1`,
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
        "AI_STOCK_LAB_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_FAILED",

      classification:
        "RUNTIME_REGRESSION_FAILED_BEFORE_FULL_ASSERTION",

      httpStatus:
        run.status,

      response:
        run.json ??
        run.text,

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
    result?.fixture ??
    {};

  const riskDecisionId =
    fixture?.riskDecisionId ??
    null;

  const orderId =
    fixture?.orderId ??
    null;

  const positionId =
    fixture?.positionId ??
    null;

  const fingerprint =
    fixture?.eventFingerprint ??
    null;

  async function getJson(
    path: string,
  ) {
    return request(
      `${base}/${path}`,
      {
        method:
          "GET",

        headers,
      },
    );
  }

  const riskProof =
    riskDecisionId
      ? await getJson(
          `risk_decisions?id=eq.${encodeURIComponent(riskDecisionId)}&select=id`,
        )
      : null;

  const orderProof =
    orderId
      ? await getJson(
          `paper_order_requests?id=eq.${encodeURIComponent(orderId)}&select=id`,
        )
      : null;

  const positionProof =
    positionId
      ? await getJson(
          `paper_positions?id=eq.${encodeURIComponent(positionId)}&select=id`,
        )
      : null;

  const ledgerProof =
    orderId && fingerprint
      ? await getJson(
          `paper_buy_execution_events_v1?order_id=eq.${encodeURIComponent(orderId)}&event_fingerprint=eq.${encodeURIComponent(fingerprint)}&select=id`,
        )
      : null;

  const externalChecks = {
    rpcReturnedPass:
      result?.status ===
      "AI_STOCK_LAB_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_PASS",

    classificationCorrect:
      result?.classification ===
      "BUY_V5_EXACT_REPLAY_RUNTIME_IDEMPOTENCY_AND_ROLLBACK_PROVEN",

    internalChecksAllTrue:
      result?.checks &&
      Object.values(
        result.checks,
      ).every(
        value =>
          value === true,
      ),

    internalSafetySaysRolledBack:
      result?.safety?.fixtureWritesRolledBack ===
        true,

    internalPersistentRiskDecisionRowsZero:
      Number(
        result?.safety?.persistentRiskDecisionRows ??
        -1,
      ) === 0,

    internalPersistentOrderRowsZero:
      Number(
        result?.safety?.persistentOrderRows ??
        -1,
      ) === 0,

    internalPersistentPositionRowsZero:
      Number(
        result?.safety?.persistentPositionRows ??
        -1,
      ) === 0,

    internalPersistentLedgerRowsZero:
      Number(
        result?.safety?.persistentLedgerRows ??
        -1,
      ) === 0,

    externalFixtureRiskDecisionAbsent:
      Boolean(
        riskProof?.ok,
      ) &&
      Array.isArray(
        riskProof?.json,
      ) &&
      riskProof.json.length === 0,

    externalFixtureOrderAbsent:
      Boolean(
        orderProof?.ok,
      ) &&
      Array.isArray(
        orderProof?.json,
      ) &&
      orderProof.json.length === 0,

    externalFixturePositionAbsent:
      Boolean(
        positionProof?.ok,
      ) &&
      Array.isArray(
        positionProof?.json,
      ) &&
      positionProof.json.length === 0,

    externalFixtureLedgerAbsent:
      Boolean(
        ledgerProof?.ok,
      ) &&
      Array.isArray(
        ledgerProof?.json,
      ) &&
      ledgerProof.json.length === 0,

    realTradingStillDisabled:
      result?.safety?.realTradingEnabled ===
        false,
  };

  const failed =
    Object.entries(
      externalChecks,
    )
      .filter(([, ok]) =>
        ok !== true
      )
      .map(([name]) =>
        name
      );

  const pass =
    failed.length === 0;

  console.log(JSON.stringify({
    status:
      pass
        ? "AI_STOCK_LAB_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_FULL_PASS"
        : "AI_STOCK_LAB_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_REVIEW",

    classification:
      pass
        ? "BUY_V5_RUNTIME_EXACT_REPLAY_PROVEN_NO_DUPLICATE_MUTATION_AND_ALL_FIXTURES_ROLLED_BACK"
        : "BUY_V5_RUNTIME_REPLAY_OR_ROLLBACK_REVIEW_REQUIRED",

    runtimeResult:
      result,

    externalChecks,
    failed,

    externalRollbackProof: {
      riskDecisionRows:
        riskProof?.json ??
        null,

      orderRows:
        orderProof?.json ??
        null,

      positionRows:
        positionProof?.json ??
        null,

      ledgerRows:
        ledgerProof?.json ??
        null,
    },

    safety: {
      databaseReads:
        4,

      testRpcInvoked:
        true,

      transactionLocalFixtureWrites:
        true,

      fixtureWritesRolledBack:
        result?.safety?.fixtureWritesRolledBack ===
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
        ? "CLOSE_BUY_V5_RUNTIME_EXACT_REPLAY_IDEMPOTENCY_EVIDENCE"
        : "REVIEW_ONLY_FAILED_RUNTIME_OR_ROLLBACK_CHECKS",
  }, null, 2));

  process.exitCode =
    pass
      ? 0
      : 1;
}

void main();
