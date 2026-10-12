const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();

function loadEnvFile(rel) {
  const full = path.join(ROOT, rel);

  if (!fs.existsSync(full)) {
    return;
  }

  const text =
    fs.readFileSync(full, "utf8");

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();

    if (
      !line ||
      line.startsWith("#") ||
      !line.includes("=")
    ) {
      continue;
    }

    const idx = line.indexOf("=");

    const key =
      line.slice(0, idx).trim();

    let value =
      line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (
      key &&
      process.env[key] === undefined
    ) {
      process.env[key] = value;
    }
  }
}

for (const envFile of [
  ".env.local",
  ".env",
  ".env.test",
]) {
  loadEnvFile(envFile);
}

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "";

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

function print(value) {
  console.log(
    JSON.stringify(
      value,
      null,
      2,
    ),
  );
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? n
    : null;
}

function approxEqual(a, b, tolerance = 0.000001) {
  const na = num(a);
  const nb = num(b);

  return (
    na !== null &&
    nb !== null &&
    Math.abs(na - nb) <= tolerance
  );
}

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms),
  );
}

async function request(
  url,
  init = {},
  timeoutMs = 30000,
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs,
    );

  try {
    const response =
      await fetch(
        url,
        {
          ...init,
          signal:
            controller.signal,
        },
      );

    const text =
      await response.text();

    let json = null;

    if (text.trim()) {
      try {
        json =
          JSON.parse(text);
      }
      catch {
        json =
          text;
      }
    }

    return {
      ok:
        response.ok,

      status:
        response.status,

      json,

      text,
    };
  }
  finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (
    !SUPABASE_URL ||
    !SERVICE_ROLE_KEY
  ) {
    print({
      status:
        "AI_STOCK_LAB_PAPER_ORDER_FINAL_TWO_HTTP_CONCURRENT_DUPLICATE_FILL_STRESS_V1_BLOCKED",

      reason:
        "SUPABASE_URL_OR_SERVICE_ROLE_KEY_MISSING",

      safety: {
        databaseWrites: 0,
        realTradingEnabled: false,
      },
    });

    process.exitCode = 2;
    return;
  }

  const base =
    SUPABASE_URL
      .replace(/\/+$/, "") +
    "/rest/v1";

  const headers = {
    apikey:
      SERVICE_ROLE_KEY,

    Authorization:
      "Bearer " +
      SERVICE_ROLE_KEY,

    "Content-Type":
      "application/json",

    Accept:
      "application/json",
  };

  const preferRepresentation = {
    ...headers,
    Prefer:
      "return=representation",
  };

  async function restGet(pathname) {
    return request(
      base + "/" + pathname,
      {
        method:
          "GET",

        headers,
      },
    );
  }

  async function restPost(
    pathname,
    body,
  ) {
    return request(
      base + "/" + pathname,
      {
        method:
          "POST",

        headers:
          preferRepresentation,

        body:
          JSON.stringify(body),
      },
    );
  }

  async function restDelete(
    pathname,
  ) {
    return request(
      base + "/" + pathname,
      {
        method:
          "DELETE",

        headers: {
          ...headers,
          Prefer:
            "return=minimal",
        },
      },
    );
  }

  async function rpc(
    name,
    body,
  ) {
    return request(
      base + "/rpc/" + name,
      {
        method:
          "POST",

        headers,

        body:
          JSON.stringify(body),
      },
      45000,
    );
  }

  const stockResponse =
    await restGet(
      "stocks?select=stock_code,sector&order=stock_code.asc&limit=1",
    );

  const stock =
    Array.isArray(
      stockResponse.json,
    )
      ? stockResponse.json[0]
      : null;

  if (
    !stockResponse.ok ||
    !stock?.stock_code
  ) {
    print({
      status:
        "AI_STOCK_LAB_PAPER_ORDER_FINAL_TWO_HTTP_CONCURRENT_DUPLICATE_FILL_STRESS_V1_BLOCKED",

      reason:
        "NO_STOCK_AVAILABLE_FOR_SYNTHETIC_FIXTURE",

      stockResponse: {
        ok:
          stockResponse.ok,

        status:
          stockResponse.status,

        body:
          stockResponse.json,
      },

      safety: {
        databaseWrites: 0,
        realTradingEnabled: false,
      },
    });

    process.exitCode = 2;
    return;
  }

  const stockCode =
    stock.stock_code;

  const sector =
    stock.sector ||
    "TEST";

  const cleanupErrors = [];

  async function cleanupAccount(accountId) {
    if (!accountId) {
      return;
    }

    const encoded =
      encodeURIComponent(
        accountId,
      );

    const steps = [
      [
        "protective_fills",
        "paper_protective_execution_fills_v2?account_id=eq." +
          encoded,
      ],
      [
        "buy_ledger",
        "paper_buy_execution_events_v1?order_id=in.(select)",
      ],
    ];

    /*
     * BUY ledger has no account_id, so delete it through any fixture
     * order IDs first outside this generic helper.
     */

    const genericDeletes = [
      [
        "trade_history",
        "paper_trade_history?account_id=eq." +
          encoded,
      ],
      [
        "positions",
        "paper_positions?account_id=eq." +
          encoded,
      ],
      [
        "orders",
        "paper_order_requests?account_id=eq." +
          encoded,
      ],
      [
        "risk_decisions",
        "risk_decisions?account_id=eq." +
          encoded,
      ],
      [
        "account",
        "paper_accounts?id=eq." +
          encoded,
      ],
    ];

    for (const [
      label,
      pathName,
    ] of genericDeletes) {
      const r =
        await restDelete(
          pathName,
        );

      if (!r.ok) {
        cleanupErrors.push({
          accountId,
          label,
          status:
            r.status,
          body:
            r.json,
        });
      }
    }
  }

  async function cleanupBuy(
    accountId,
    orderId,
  ) {
    if (orderId) {
      const encodedOrder =
        encodeURIComponent(
          orderId,
        );

      const ledgerDelete =
        await restDelete(
          "paper_buy_execution_events_v1?order_id=eq." +
            encodedOrder,
        );

      if (!ledgerDelete.ok) {
        cleanupErrors.push({
          accountId,
          label:
            "buy_ledger",
          status:
            ledgerDelete.status,
          body:
            ledgerDelete.json,
        });
      }
    }

    await cleanupAccount(
      accountId,
    );
  }

  async function cleanupSell(
    accountId,
    positionId,
  ) {
    if (positionId) {
      const encodedPosition =
        encodeURIComponent(
          positionId,
        );

      const fillDelete =
        await restDelete(
          "paper_protective_execution_fills_v2?position_id=eq." +
            encodedPosition,
        );

      if (!fillDelete.ok) {
        cleanupErrors.push({
          accountId,
          label:
            "sell_fill_ledger",
          status:
            fillDelete.status,
          body:
            fillDelete.json,
        });
      }
    }

    await cleanupAccount(
      accountId,
    );
  }

  async function createTestAccount(
    label,
  ) {
    const accountId =
      randomUUID();

    const accountName =
      "ai-stock-lab-" +
      label +
      "-" +
      accountId.slice(0, 8);

    const initialCash =
      1000000000;

    const response =
      await restPost(
        "paper_accounts",
        {
          id:
            accountId,

          account_name:
            accountName,

          initial_equity:
            initialCash,

          cash_balance:
            initialCash,

          realized_pnl:
            0,

          daily_realized_pnl:
            0,

          trading_mode:
            "PAPER",
        },
      );

    if (
      !response.ok ||
      !Array.isArray(
        response.json,
      ) ||
      !response.json[0]
    ) {
      throw new Error(
        "TEST_ACCOUNT_CREATE_FAILED:" +
        JSON.stringify({
          status:
            response.status,

          body:
            response.json,
        }),
      );
    }

    return {
      accountId,
      accountName,
      initialCash,
    };
  }

  let buyFixture = null;
  let sellFixture = null;
  let buyResult = null;
  let sellResult = null;

  try {
    /*
     * ==========================================================
     * BUY V5 TRUE CONCURRENT EXACT DUPLICATE
     * ==========================================================
     */
    const buyAccount =
      await createTestAccount(
        "buy-concurrency",
      );

    const buyAccountId =
      buyAccount.accountId;

    const riskId =
      randomUUID();

    const orderId =
      randomUUID();

    const observedAt =
      new Date().toISOString();

    const executionPrice =
      10000;

    const source =
      "BEST_ASK";

    const provenance = {
      test:
        "BUY_V5_TRUE_CONCURRENT_EXACT_DUPLICATE_V1",

      synthetic:
        true,

      persistent:
        false,

      accountId:
        buyAccountId,

      orderId,
    };

    buyFixture = {
      accountId:
        buyAccountId,

      riskId,
      orderId,

      initialCash:
        buyAccount.initialCash,

      observedAt,
      executionPrice,
      source,
      provenance,
      fillQuantity:
        1,

      brokerFee:
        10,
    };

    const riskInsert =
      await restPost(
        "risk_decisions",
        {
          id:
            riskId,

          account_id:
            buyAccountId,

          stock_code:
            stockCode,

          action:
            "BUY",

          approved:
            true,

          requested_payload: {
            test:
              "BUY_V5_TRUE_CONCURRENT_EXACT_DUPLICATE_V1",

            synthetic:
              true,

            persistent:
              false,
          },

          result_payload: {
            approved:
              true,

            reason:
              "CONCURRENT_DUPLICATE_STRESS_FIXTURE",
          },
        },
      );

    if (!riskInsert.ok) {
      throw new Error(
        "BUY_RISK_FIXTURE_CREATE_FAILED:" +
        JSON.stringify({
          status:
            riskInsert.status,

          body:
            riskInsert.json,
        }),
      );
    }

    const orderInsert =
      await restPost(
        "paper_order_requests",
        {
          id:
            orderId,

          account_id:
            buyAccountId,

          stock_code:
            stockCode,

          side:
            "BUY",

          requested_quantity:
            2,

          approved_quantity:
            2,

          entry_price:
            executionPrice,

          stop_price:
            9700,

          status:
            "RISK_APPROVED",

          risk_decision_id:
            riskId,

          reserved_risk_amount:
            600,

          filled_quantity:
            0,

          execution_fill_count:
            0,

          execution_broker_fee:
            0,

          execution_transaction_cost:
            0,
        },
      );

    if (!orderInsert.ok) {
      throw new Error(
        "BUY_ORDER_FIXTURE_CREATE_FAILED:" +
        JSON.stringify({
          status:
            orderInsert.status,

          body:
            orderInsert.json,
        }),
      );
    }

    const buyBody = {
      p_order_id:
        orderId,

      p_execution_price:
        executionPrice,

      p_execution_observed_at:
        observedAt,

      p_execution_price_source:
        source,

      p_execution_provenance:
        provenance,

      p_fill_quantity:
        1,

      p_broker_fee:
        10,
    };

    const buyStart =
      Date.now();

    const [
      buyA,
      buyB,
    ] =
      await Promise.all([
        rpc(
          "execute_paper_buy_order_with_execution_price_v5",
          buyBody,
        ),
        rpc(
          "execute_paper_buy_order_with_execution_price_v5",
          buyBody,
        ),
      ]);

    const buyElapsedMs =
      Date.now() -
      buyStart;

    if (
      !buyA.ok ||
      !buyB.ok
    ) {
      throw new Error(
        "BUY_CONCURRENT_RPC_FAILED:" +
        JSON.stringify({
          a: {
            status:
              buyA.status,

            body:
              buyA.json,
          },

          b: {
            status:
              buyB.status,

            body:
              buyB.json,
          },
        }),
      );
    }

    const buyResponses = [
      buyA.json,
      buyB.json,
    ];

    const buyReplayCount =
      buyResponses.filter(
        (row) =>
          row &&
          (
            row.idempotentReplay === true ||
            row.idempotentReplay === "true"
          ),
      ).length;

    const buyNewCount =
      buyResponses.filter(
        (row) =>
          row &&
          (
            row.idempotentReplay === false ||
            row.idempotentReplay === "false"
          ),
      ).length;

    const buyNew =
      buyResponses.find(
        (row) =>
          row &&
          (
            row.idempotentReplay === false ||
            row.idempotentReplay === "false"
          ),
      ) ||
      buyResponses[0];

    const [
      buyOrderState,
      buyPositionState,
      buyLedgerState,
      buyAccountState,
    ] =
      await Promise.all([
        restGet(
          "paper_order_requests?id=eq." +
            encodeURIComponent(orderId) +
            "&select=id,status,filled_quantity,filled_price,execution_fill_count,execution_broker_fee",
        ),

        restGet(
          "paper_positions?account_id=eq." +
            encodeURIComponent(buyAccountId) +
            "&stock_code=eq." +
            encodeURIComponent(stockCode) +
            "&select=id,quantity,average_price,entry_order_id",
        ),

        restGet(
          "paper_buy_execution_events_v1?order_id=eq." +
            encodeURIComponent(orderId) +
            "&select=id,order_id,event_fingerprint,fill_quantity,broker_fee",
        ),

        restGet(
          "paper_accounts?id=eq." +
            encodeURIComponent(buyAccountId) +
            "&select=id,cash_balance",
        ),
      ]);

    const orderRow =
      Array.isArray(
        buyOrderState.json,
      )
        ? buyOrderState.json[0]
        : null;

    const positionRows =
      Array.isArray(
        buyPositionState.json,
      )
        ? buyPositionState.json
        : [];

    const ledgerRows =
      Array.isArray(
        buyLedgerState.json,
      )
        ? buyLedgerState.json
        : [];

    const accountRow =
      Array.isArray(
        buyAccountState.json,
      )
        ? buyAccountState.json[0]
        : null;

    const buyChecks = {
      bothRpcSucceeded:
        buyA.ok &&
        buyB.ok,

      exactlyOneNewEventResponse:
        buyNewCount === 1,

      exactlyOneReplayResponse:
        buyReplayCount === 1,

      exactlyOneLedgerRow:
        ledgerRows.length === 1,

      orderFilledExactlyOnce:
        num(
          orderRow?.filled_quantity,
        ) === 1,

      orderFillCountExactlyOnce:
        num(
          orderRow?.execution_fill_count,
        ) === 1,

      orderBrokerFeeExactlyOnce:
        approxEqual(
          orderRow?.execution_broker_fee,
          10,
        ),

      onePositionOnly:
        positionRows.length === 1,

      positionQuantityExactlyOne:
        num(
          positionRows[0]?.quantity,
        ) === 1,

      positionEntryOrderMatches:
        positionRows[0]?.entry_order_id ===
        orderId,

      cashMatchesSingleExecutionResult:
        buyNew &&
        buyNew.remainingCash !== undefined &&
        approxEqual(
          accountRow?.cash_balance,
          buyNew.remainingCash,
        ),

      cashChangedFromInitial:
        accountRow &&
        !approxEqual(
          accountRow.cash_balance,
          buyAccount.initialCash,
        ),
    };

    const buyFailed =
      Object.entries(
        buyChecks,
      )
        .filter(
          ([, ok]) =>
            ok !== true,
        )
        .map(
          ([name]) =>
            name,
        );

    buyResult = {
      status:
        buyFailed.length === 0
          ? "BUY_V5_TRUE_CONCURRENT_EXACT_DUPLICATE_PASS"
          : "BUY_V5_TRUE_CONCURRENT_EXACT_DUPLICATE_REVIEW",

      elapsedMs:
        buyElapsedMs,

      responses:
        buyResponses,

      checks:
        buyChecks,

      failed:
        buyFailed,

      observed: {
        order:
          orderRow,

        positions:
          positionRows,

        ledger:
          ledgerRows,

        account:
          accountRow,
      },
    };

    await cleanupBuy(
      buyAccountId,
      orderId,
    );

    /*
     * ==========================================================
     * SELL V4 TRUE CONCURRENT EXACT DUPLICATE
     * ==========================================================
     */
    const sellAccount =
      await createTestAccount(
        "sell-concurrency",
      );

    const sellAccountId =
      sellAccount.accountId;

    const positionId =
      randomUUID();

    const sellObservedAt =
      new Date().toISOString();

    sellFixture = {
      accountId:
        sellAccountId,

      positionId,

      initialCash:
        sellAccount.initialCash,

      observedAt:
        sellObservedAt,

      exitPrice:
        8900,

      fillQuantity:
        1,

      brokerFee:
        10,

      sellTax:
        5,
    };

    const positionInsert =
      await restPost(
        "paper_positions",
        {
          id:
            positionId,

          account_id:
            sellAccountId,

          stock_code:
            stockCode,

          sector,

          quantity:
            1,

          average_price:
            10000,

          current_stop_price:
            9000,

          highest_price:
            11000,

          trailing_stop_active:
            false,

          entry_broker_fee_basis_total:
            0,

          entry_broker_fee_basis_remaining:
            0,
        },
      );

    if (!positionInsert.ok) {
      throw new Error(
        "SELL_POSITION_FIXTURE_CREATE_FAILED:" +
        JSON.stringify({
          status:
            positionInsert.status,

          body:
            positionInsert.json,
        }),
      );
    }

    const sellBody = {
      p_position_id:
        positionId,

      p_exit_price:
        8900,

      p_observed_at:
        sellObservedAt,

      p_execution_source:
        "BEST_BID",

      p_execution_provenance: {
        test:
          "SELL_V4_TRUE_CONCURRENT_EXACT_DUPLICATE_V1",

        synthetic:
          true,

        persistent:
          false,

        accountId:
          sellAccountId,

        positionId,
      },

      p_fill_quantity:
        1,

      p_broker_fee:
        10,

      p_sell_tax:
        5,

      p_exit_reason:
        "STOP_LOSS",
    };

    const sellStart =
      Date.now();

    const [
      sellA,
      sellB,
    ] =
      await Promise.all([
        rpc(
          "execute_paper_protective_sell_v4",
          sellBody,
        ),
        rpc(
          "execute_paper_protective_sell_v4",
          sellBody,
        ),
      ]);

    const sellElapsedMs =
      Date.now() -
      sellStart;

    if (
      !sellA.ok ||
      !sellB.ok
    ) {
      throw new Error(
        "SELL_CONCURRENT_RPC_FAILED:" +
        JSON.stringify({
          a: {
            status:
              sellA.status,

            body:
              sellA.json,
          },

          b: {
            status:
              sellB.status,

            body:
              sellB.json,
          },
        }),
      );
    }

    const sellResponses = [
      sellA.json,
      sellB.json,
    ];

    const sellReplayCount =
      sellResponses.filter(
        (row) =>
          row &&
          (
            row.alreadyClosed === true ||
            row.alreadyClosed === "true"
          ),
      ).length;

    const sellNewCount =
      sellResponses.filter(
        (row) =>
          row &&
          !(
            row.alreadyClosed === true ||
            row.alreadyClosed === "true"
          ),
      ).length;

    const sellNew =
      sellResponses.find(
        (row) =>
          row &&
          !(
            row.alreadyClosed === true ||
            row.alreadyClosed === "true"
          ),
      ) ||
      sellResponses[0];

    const [
      sellPositionState,
      sellTradeState,
      sellFillState,
      sellOrderState,
      sellAccountState,
    ] =
      await Promise.all([
        restGet(
          "paper_positions?id=eq." +
            encodeURIComponent(positionId) +
            "&select=id,quantity",
        ),

        restGet(
          "paper_trade_history?source_position_id=eq." +
            encodeURIComponent(positionId) +
            "&select=id,source_position_id,quantity,exit_price,exit_reason,exit_broker_fee,sell_tax,total_transaction_cost",
        ),

        restGet(
          "paper_protective_execution_fills_v2?position_id=eq." +
            encodeURIComponent(positionId) +
            "&select=*",
        ),

        restGet(
          "paper_order_requests?account_id=eq." +
            encodeURIComponent(sellAccountId) +
            "&side=eq.SELL&select=id,status,filled_quantity,execution_fill_count",
        ),

        restGet(
          "paper_accounts?id=eq." +
            encodeURIComponent(sellAccountId) +
            "&select=id,cash_balance",
        ),
      ]);

    const remainingPositions =
      Array.isArray(
        sellPositionState.json,
      )
        ? sellPositionState.json
        : [];

    const tradeRows =
      Array.isArray(
        sellTradeState.json,
      )
        ? sellTradeState.json
        : [];

    const fillRows =
      Array.isArray(
        sellFillState.json,
      )
        ? sellFillState.json
        : [];

    const sellOrderRows =
      Array.isArray(
        sellOrderState.json,
      )
        ? sellOrderState.json
        : [];

    const sellAccountRow =
      Array.isArray(
        sellAccountState.json,
      )
        ? sellAccountState.json[0]
        : null;

    const sellChecks = {
      bothRpcSucceeded:
        sellA.ok &&
        sellB.ok,

      exactlyOneNewExecutionResponse:
        sellNewCount === 1,

      exactlyOneClosedReplayResponse:
        sellReplayCount === 1,

      positionClosedExactlyOnce:
        remainingPositions.length === 0,

      exactlyOneTradeRow:
        tradeRows.length === 1,

      exactlyOneProtectiveFillRow:
        fillRows.length === 1,

      exactlyOneSellOrder:
        sellOrderRows.length === 1,

      cashMatchesSingleExecutionResult:
        sellNew &&
        sellNew.remainingCash !== undefined &&
        approxEqual(
          sellAccountRow?.cash_balance,
          sellNew.remainingCash,
        ),

      cashChangedFromInitial:
        sellAccountRow &&
        !approxEqual(
          sellAccountRow.cash_balance,
          sellAccount.initialCash,
        ),

      tradeQuantityOne:
        num(
          tradeRows[0]?.quantity,
        ) === 1,

      tradeExitPricePreserved:
        approxEqual(
          tradeRows[0]?.exit_price,
          8900,
        ),
    };

    const sellFailed =
      Object.entries(
        sellChecks,
      )
        .filter(
          ([, ok]) =>
            ok !== true,
        )
        .map(
          ([name]) =>
            name,
        );

    sellResult = {
      status:
        sellFailed.length === 0
          ? "SELL_V4_TRUE_CONCURRENT_EXACT_DUPLICATE_PASS"
          : "SELL_V4_TRUE_CONCURRENT_EXACT_DUPLICATE_REVIEW",

      elapsedMs:
        sellElapsedMs,

      responses:
        sellResponses,

      checks:
        sellChecks,

      failed:
        sellFailed,

      observed: {
        positions:
          remainingPositions,

        trades:
          tradeRows,

        fills:
          fillRows,

        sellOrders:
          sellOrderRows,

        account:
          sellAccountRow,
      },
    };

    await cleanupSell(
      sellAccountId,
      positionId,
    );

    /*
     * Small delay before proof-of-cleanup reads.
     */
    await sleep(150);

    const cleanupProof = {
      buyAccount:
        buyFixture?.accountId
          ? await restGet(
              "paper_accounts?id=eq." +
                encodeURIComponent(
                  buyFixture.accountId,
                ) +
                "&select=id",
            )
          : null,

      buyOrder:
        buyFixture?.orderId
          ? await restGet(
              "paper_order_requests?id=eq." +
                encodeURIComponent(
                  buyFixture.orderId,
                ) +
                "&select=id",
            )
          : null,

      sellAccount:
        sellFixture?.accountId
          ? await restGet(
              "paper_accounts?id=eq." +
                encodeURIComponent(
                  sellFixture.accountId,
                ) +
                "&select=id",
            )
          : null,

      sellPosition:
        sellFixture?.positionId
          ? await restGet(
              "paper_positions?id=eq." +
                encodeURIComponent(
                  sellFixture.positionId,
                ) +
                "&select=id",
            )
          : null,
    };

    const cleanupChecks = {
      buyAccountRemoved:
        Array.isArray(
          cleanupProof.buyAccount?.json,
        ) &&
        cleanupProof.buyAccount.json.length === 0,

      buyOrderRemoved:
        Array.isArray(
          cleanupProof.buyOrder?.json,
        ) &&
        cleanupProof.buyOrder.json.length === 0,

      sellAccountRemoved:
        Array.isArray(
          cleanupProof.sellAccount?.json,
        ) &&
        cleanupProof.sellAccount.json.length === 0,

      sellPositionRemoved:
        Array.isArray(
          cleanupProof.sellPosition?.json,
        ) &&
        cleanupProof.sellPosition.json.length === 0,

      noCleanupErrors:
        cleanupErrors.length === 0,
    };

    const cleanupFailed =
      Object.entries(
        cleanupChecks,
      )
        .filter(
          ([, ok]) =>
            ok !== true,
        )
        .map(
          ([name]) =>
            name,
        );

    const allPass =
      buyResult?.failed?.length === 0 &&
      sellResult?.failed?.length === 0 &&
      cleanupFailed.length === 0;

    print({
      status:
        allPass
          ? "AI_STOCK_LAB_PAPER_ORDER_FINAL_TWO_HTTP_CONCURRENT_DUPLICATE_FILL_STRESS_V1_PASS"
          : "AI_STOCK_LAB_PAPER_ORDER_FINAL_TWO_HTTP_CONCURRENT_DUPLICATE_FILL_STRESS_V1_REVIEW",

      classification:
        allPass
          ? "BUY_V5_AND_SELL_V4_TRUE_CONCURRENT_EXACT_DUPLICATE_MUTATION_ONCE_PROVEN"
          : "CONCURRENT_DUPLICATE_FILL_STRESS_REVIEW_REQUIRED",

      buy:
        buyResult,

      sell:
        sellResult,

      cleanup: {
        checks:
          cleanupChecks,

        failed:
          cleanupFailed,

        errors:
          cleanupErrors,
      },

      safety: {
        syntheticDedicatedPaperAccounts:
          true,

        productionPaperBuyV5Invoked:
          true,

        productionPaperSellV4Invoked:
          true,

        realBrokerApiInvoked:
          false,

        realOrdersSent:
          false,

        fixtureAccountsRemoved:
          cleanupChecks.buyAccountRemoved &&
          cleanupChecks.sellAccountRemoved,

        fixtureRowsCleanupProven:
          cleanupFailed.length === 0,

        realTradingEnabled:
          false,
      },

      nextGate:
        allPass
          ? "CLOSE_PAPER_ORDER_EXECUTION_STRESS_HARDENING_AND_ADVANCE_TO_RISK_STRESS"
          : "REPAIR_ONLY_FAILED_CONCURRENT_INVARIANTS",
    });

    process.exitCode =
      allPass
        ? 0
        : 1;
  }
  catch (error) {
    /*
     * Best-effort cleanup on every failure path.
     */
    try {
      if (
        buyFixture?.accountId
      ) {
        await cleanupBuy(
          buyFixture.accountId,
          buyFixture.orderId,
        );
      }
    }
    catch (cleanupError) {
      cleanupErrors.push({
        phase:
          "buy_failure_cleanup",
        error:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    }

    try {
      if (
        sellFixture?.accountId
      ) {
        await cleanupSell(
          sellFixture.accountId,
          sellFixture.positionId,
        );
      }
    }
    catch (cleanupError) {
      cleanupErrors.push({
        phase:
          "sell_failure_cleanup",
        error:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      });
    }

    print({
      status:
        "AI_STOCK_LAB_PAPER_ORDER_FINAL_TWO_HTTP_CONCURRENT_DUPLICATE_FILL_STRESS_V1_FAILED",

      error:
        error instanceof Error
          ? error.message
          : String(error),

      buy:
        buyResult,

      sell:
        sellResult,

      cleanupErrors,

      safety: {
        bestEffortCleanupAttempted:
          true,

        realBrokerApiInvoked:
          false,

        realOrdersSent:
          false,

        realTradingEnabled:
          false,
      },

      nextGate:
        "REVIEW_FAILURE_AND_CLEANUP_PROOF_BEFORE_RETRY",
    });

    process.exitCode = 1;
  }
}

main();
