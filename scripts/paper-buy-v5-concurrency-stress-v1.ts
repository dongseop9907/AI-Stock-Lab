const CONCURRENCY = 8;

type HttpResult = {
  ok: boolean;
  status: number;
  json: any;
  text: string;
  elapsedMs: number;
};

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
        "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_BLOCKED",
      classification:
        "MISSING_SUPABASE_CREDENTIALS",
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
  ): Promise<HttpResult> {
    const started =
      performance.now();

    const response =
      await fetch(url, init);

    const text =
      await response.text();

    let json: any = null;

    try {
      json =
        text.length > 0
          ? JSON.parse(text)
          : null;
    } catch {
      json = null;
    }

    return {
      ok:
        response.ok,

      status:
        response.status,

      json,

      text,

      elapsedMs:
        Math.round(
          performance.now() - started
        ),
    };
  }

  async function rpc(
    name: string,
    body: Record<string, unknown> = {},
  ) {
    return request(
      `${base}/rpc/${name}`,
      {
        method:
          "POST",

        headers,

        body:
          JSON.stringify(body),
      },
    );
  }

  const readiness =
    await rpc(
      "paper_buy_v5_conc_ready_v1"
    );

  if (!readiness.ok) {
    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_BLOCKED",

      classification:
        "READINESS_RPC_FAILED",

      response:
        readiness.json ?? readiness.text,
    }, null, 2));

    process.exitCode = 2;
    return;
  }

  if (readiness.json?.ready !== true) {
    const normalWait =
      readiness.json?.classification ===
      "NORMAL_WAIT";

    console.log(JSON.stringify({
      status:
        normalWait
          ? "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_NORMAL_WAIT"
          : "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_BLOCKED",

      classification:
        normalWait
          ? "PRODUCTION_BUY_FAIL_CLOSED_GATE_CURRENTLY_CLOSED"
          : "BUY_V5_CONCURRENCY_READINESS_BLOCKED",

      readiness:
        readiness.json,

      interpretation:
        normalWait
          ? "The first-seen V5 race was not attempted because the deployed PAPER BUY safety gate is closed. This is a normal WAIT, not an idempotency failure."
          : "The concurrency harness is not ready.",

      safety: {
        fixtureCreated:
          false,

        productionV5Invoked:
          false,

        realOrdersSent:
          false,

        realTradingEnabled:
          false,
      },

      nextGate:
        normalWait
          ? "RERUN_WHEN_PAPER_BUY_GATE_IS_OPEN"
          : "REVIEW_READINESS_BLOCK",
    }, null, 2));

    process.exitCode =
      normalWait
        ? 3
        : 2;

    return;
  }

  let fixture: any = null;
  let state: any = null;
  let cleanup: any = null;
  let results: HttpResult[] = [];

  let finalStatus =
    "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_REVIEW";

  let finalClassification =
    "BUY_V5_CONCURRENCY_REVIEW_REQUIRED";

  let exitCode = 1;

  try {
    const setup =
      await rpc(
        "paper_buy_v5_conc_setup_v1"
      );

    if (!setup.ok) {
      console.log(JSON.stringify({
        status:
          "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_BLOCKED",

        classification:
          "FIXTURE_SETUP_FAILED",

        response:
          setup.json ?? setup.text,

        safety: {
          productionV5Invoked:
            false,

          realOrdersSent:
            false,

          realTradingEnabled:
            false,
        },
      }, null, 2));

      process.exitCode = 2;
      return;
    }

    fixture =
      setup.json;

    const observedAt =
      new Date().toISOString();

    const executionPayload = {
      p_order_id:
        fixture.orderId,

      p_execution_price:
        10000,

      p_execution_observed_at:
        observedAt,

      p_execution_price_source:
        "BEST_ASK",

      p_execution_provenance: {
        version:
          "BUY_V5_CONCURRENCY_STRESS_V1",

        fixtureToken:
          fixture.fixtureToken,

        syntheticTestFixture:
          true,

        naturalEvidence:
          false,
      },

      p_fill_quantity:
        1,

      p_broker_fee:
        100,
    };

    const launchBase =
      performance.now();

    const launchOffsetsMs: number[] =
      [];

    const calls =
      Array.from(
        { length: CONCURRENCY },
        (_, index) => {
          launchOffsetsMs.push(
            Math.round(
              performance.now() - launchBase
            )
          );

          return rpc(
            "execute_paper_buy_order_with_execution_price_v5",
            executionPayload,
          ).then(result => ({
            ...result,
            requestIndex:
              index,
          }));
        },
      );

    results =
      await Promise.all(calls);

    const failedHttp =
      results.filter(
        result => !result.ok
      );

    if (failedHttp.length > 0) {
      const messages =
        failedHttp.map(result =>
          String(
            result.json?.message ??
            result.text ??
            ""
          )
        );

      const safetyGatePattern =
        /(FRESHNESS|EMERGENCY_STOP|PAPER_ORDER_DISABLED|NEW_RISK|KILL_SWITCH|TRADING_CONTROL|MARKET.*CLOSED)/i;

      const allSafetyGate =
        messages.length > 0 &&
        messages.every(message =>
          safetyGatePattern.test(message)
        );

      finalStatus =
        allSafetyGate
          ? "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_NORMAL_WAIT"
          : "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_FAIL";

      finalClassification =
        allSafetyGate
          ? "PRODUCTION_BUY_GATE_CLOSED_DURING_CONCURRENT_FIRST_SEEN_ATTEMPT"
          : "CONCURRENT_V5_CALL_FAILED";

      exitCode =
        allSafetyGate
          ? 3
          : 1;

      console.log(JSON.stringify({
        status:
          finalStatus,

        classification:
          finalClassification,

        failedHttp:
          failedHttp.map(result => ({
            status:
              result.status,

            response:
              result.json ?? result.text,

            elapsedMs:
              result.elapsedMs,
          })),

        launchOffsetsMs,

        interpretation:
          allSafetyGate
            ? "The deployed fail-closed PAPER BUY safety gate changed/closed after readiness. This is a normal WAIT, not an idempotency failure."
            : "At least one concurrent production V5 call failed for a non-whitelisted reason.",
      }, null, 2));

      return;
    }

    const responseJson =
      results.map(result =>
        result.json
      );

    const newEventResponses =
      responseJson.filter(
        row =>
          row?.idempotentReplay === false
      ).length;

    const replayResponses =
      responseJson.filter(
        row =>
          row?.idempotentReplay === true
      ).length;

    const fingerprints =
      [
        ...new Set(
          responseJson
            .map(
              row =>
                row?.executionEventFingerprint
            )
            .filter(
              value =>
                typeof value === "string"
            ),
        ),
      ];

    const stateResponse =
      await rpc(
        "paper_buy_v5_conc_state_v1",
        {
          p_fixture_token:
            fixture.fixtureToken,
        },
      );

    if (!stateResponse.ok) {
      finalStatus =
        "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_FAIL";

      finalClassification =
        "POST_CONCURRENCY_STATE_READ_FAILED";

      exitCode = 1;

      console.log(JSON.stringify({
        status:
          finalStatus,

        classification:
          finalClassification,

        response:
          stateResponse.json ??
          stateResponse.text,
      }, null, 2));

      return;
    }

    state =
      stateResponse.json;

    const checks = {
      allEightCallsSucceeded:
        results.length ===
          CONCURRENCY &&
        results.every(
          result => result.ok
        ),

      exactlyOneFirstSeenEvent:
        newEventResponses === 1,

      remainingSevenAreReplays:
        replayResponses === CONCURRENCY - 1,

      oneCanonicalFingerprint:
        fingerprints.length === 1,

      oneLedgerRow:
        state?.ledger?.rows === 1,

      oneDistinctLedgerFingerprint:
        state?.ledger
          ?.distinctFingerprints === 1,

      filledExactlyOnce:
        state?.order?.filledQuantity === 1,

      executionFillCountExactlyOnce:
        state?.order
          ?.executionFillCount === 1,

      brokerFeeAppliedExactlyOnce:
        Number(
          state?.order
            ?.executionBrokerFee
        ) === 100,

      filledPriceIsExecutionPrice:
        Number(
          state?.order?.filledPrice
        ) === 10000,

      positionCreatedExactlyOnce:
        state?.position?.count === 1 &&
        state?.position?.quantity === 1,

      positionAverageCorrect:
        Number(
          state?.position?.averagePrice
        ) === 10000,

      entryFeeBasisAppliedExactlyOnce:
        Number(
          state?.position
            ?.entryFeeBasisTotal
        ) === 100 &&
        Number(
          state?.position
            ?.entryFeeBasisRemaining
        ) === 100,

      cashDebitedExactlyOnce:
        Number(
          state?.cashDelta
        ) === -10100,

      orderRemainsPartialRiskApproved:
        state?.order?.status ===
        "RISK_APPROVED",
    };

    const failed =
      Object.entries(checks)
        .filter(
          ([, ok]) => ok !== true
        )
        .map(
          ([name]) => name
        );

    const pass =
      failed.length === 0;

    finalStatus =
      pass
        ? "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_FULL_PASS"
        : "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_FAIL";

    finalClassification =
      pass
        ? "BUY_V5_PARALLEL_FIRST_SEEN_EVENT_SERIALIZED_EXACTLY_ONCE_NO_DUPLICATE_MUTATION"
        : "BUY_V5_CONCURRENCY_EXACTLY_ONCE_INVARIANT_FAILED";

    exitCode =
      pass
        ? 0
        : 1;

    console.log(JSON.stringify({
      status:
        finalStatus,

      classification:
        finalClassification,

      concurrency:
        CONCURRENCY,

      observedAt,

      responseSummary: {
        total:
          responseJson.length,

        firstSeen:
          newEventResponses,

        idempotentReplay:
          replayResponses,

        uniqueFingerprints:
          fingerprints,

        launchOffsetsMs,

        elapsedMs:
          results.map(
            result =>
              result.elapsedMs
          ),
      },

      checks,
      failed,

      state,

      evidencePolicy: {
        syntheticControlledFixture:
          true,

        naturalPaperEvidence:
          false,

        reason:
          "Committed PAPER-only fixture is required so independent PostgREST transactions can race the same first-seen event. It is cleaned immediately and is never counted as natural market evidence.",
      },

      safety: {
        productionV5Invoked:
          true,

        realBrokerApiInvoked:
          false,

        realOrdersSent:
          false,

        realTradingEnabled:
          false,

        fixtureCleanupScheduledInFinally:
          true,
      },

      nextGate:
        pass
          ? "CLEANUP_AND_CLOSE_BUY_V5_CONCURRENCY_RUNTIME_EVIDENCE"
          : "CLEANUP_AND_REVIEW_FAILED_EXACTLY_ONCE_INVARIANT",
    }, null, 2));

  } catch (error) {
    finalStatus =
      "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_FAIL";

    finalClassification =
      "UNEXPECTED_RUNNER_EXCEPTION";

    exitCode = 1;

    console.log(JSON.stringify({
      status:
        finalStatus,

      classification:
        finalClassification,

      error:
        error instanceof Error
          ? error.message
          : String(error),
    }, null, 2));

  } finally {
    if (fixture?.fixtureToken) {
      const cleanupResponse =
        await rpc(
          "paper_buy_v5_conc_cleanup_v1",
          {
            p_fixture_token:
              fixture.fixtureToken,
          },
        );

      cleanup =
        cleanupResponse.json ??
        cleanupResponse.text;

      const orderProof =
        await request(
          `${base}/paper_order_requests?id=eq.${encodeURIComponent(fixture.orderId)}&select=id`,
          {
            method:
              "GET",
            headers,
          },
        );

      const riskProof =
        await request(
          `${base}/risk_decisions?id=eq.${encodeURIComponent(fixture.riskDecisionId)}&select=id`,
          {
            method:
              "GET",
            headers,
          },
        );

      const positionProof =
        await request(
          `${base}/paper_positions?account_id=eq.${encodeURIComponent(fixture.accountId)}&stock_code=eq.${encodeURIComponent(fixture.stockCode)}&select=id`,
          {
            method:
              "GET",
            headers,
          },
        );

      const eventProof =
        await request(
          `${base}/paper_buy_execution_events_v1?order_id=eq.${encodeURIComponent(fixture.orderId)}&select=id`,
          {
            method:
              "GET",
            headers,
          },
        );

      const fixtureProof =
        await request(
          `${base}/paper_buy_v5_concurrency_fixtures_v1?fixture_token=eq.${encodeURIComponent(fixture.fixtureToken)}&select=fixture_token`,
          {
            method:
              "GET",
            headers,
          },
        );

      const cleanupChecks = {
        cleanupRpcSucceeded:
          cleanupResponse.ok,

        cashEqualsBaseline:
          cleanupResponse.json
            ?.cashEqualsBaseline === true,

        orderRemoved:
          orderProof.ok &&
          Array.isArray(orderProof.json) &&
          orderProof.json.length === 0,

        riskDecisionRemoved:
          riskProof.ok &&
          Array.isArray(riskProof.json) &&
          riskProof.json.length === 0,

        positionRemoved:
          positionProof.ok &&
          Array.isArray(positionProof.json) &&
          positionProof.json.length === 0,

        eventLedgerRemoved:
          eventProof.ok &&
          Array.isArray(eventProof.json) &&
          eventProof.json.length === 0,

        fixtureRegistryRemoved:
          fixtureProof.ok &&
          Array.isArray(fixtureProof.json) &&
          fixtureProof.json.length === 0,
      };

      const cleanupFailed =
        Object.entries(
          cleanupChecks
        )
          .filter(
            ([, ok]) =>
              ok !== true
          )
          .map(
            ([name]) => name
          );

      console.log(JSON.stringify({
        status:
          cleanupFailed.length === 0
            ? "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_CLEANUP_FULL_PASS"
            : "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_CLEANUP_REVIEW",

        cleanup,

        cleanupChecks,

        failed:
          cleanupFailed,

        persistentFixtureRowsExpected:
          0,

        realOrdersSent:
          false,

        realTradingEnabled:
          false,
      }, null, 2));

      if (
        cleanupFailed.length > 0 &&
        exitCode === 0
      ) {
        finalStatus =
          "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_REVIEW";

        finalClassification =
          "CONCURRENCY_PASS_BUT_CLEANUP_PROOF_FAILED";

        exitCode = 1;
      }
    }

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_FINAL",

      classification:
        finalClassification,

      result:
        finalStatus,

      runnerExitCode:
        exitCode,

      fixtureWasCreated:
        Boolean(
          fixture?.fixtureToken
        ),

      cleanupAttempted:
        Boolean(
          fixture?.fixtureToken
        ),

      naturalPaperEvidence:
        false,

      realOrdersSent:
        false,

      realTradingEnabled:
        false,
    }, null, 2));

    process.exitCode =
      exitCode;
  }
}

void main();
