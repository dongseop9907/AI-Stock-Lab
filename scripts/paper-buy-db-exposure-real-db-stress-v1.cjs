const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function loadEnv(file) {
  if (!fs.existsSync(file)) {
    return;
  }

  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const idx = line.indexOf("=");

    if (idx <= 0) {
      continue;
    }

    const key =
      line.slice(0, idx).trim();

    let value =
      line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value =
        value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv(path.join(process.cwd(), ".env.local"));

const BASE =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!BASE || !KEY) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_BUY_DB_EXPOSURE_REAL_DB_STRESS_V1_FAILED",
        error:
          "SUPABASE_ENV_MISSING",
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
  return;
}

const headers = {
  apikey: KEY,
  Authorization: "Bearer " + KEY,
  "Content-Type": "application/json",
};

function uid() {
  return crypto.randomUUID();
}

async function req(
  method,
  pathname,
  body = null,
  prefer = null,
) {
  const res =
    await fetch(
      BASE + pathname,
      {
        method,
        headers: {
          ...headers,
          ...(prefer
            ? { Prefer: prefer }
            : {}),
        },
        body:
          body === null
            ? undefined
            : JSON.stringify(body),
      },
    );

  const text =
    await res.text();

  let parsed = null;

  if (text) {
    try {
      parsed =
        JSON.parse(text);
    }
    catch {
      parsed = text;
    }
  }

  return {
    ok: res.ok,
    status: res.status,
    body: parsed,
  };
}

function enc(value) {
  return encodeURIComponent(value);
}

function errorMessage(result) {
  if (!result) {
    return "";
  }

  if (
    result.body &&
    typeof result.body === "object"
  ) {
    return String(
      result.body.message ||
      result.body.details ||
      "",
    );
  }

  return String(
    result.body || "",
  );
}

async function insertOne(
  table,
  row,
) {
  const result =
    await req(
      "POST",
      "/rest/v1/" + table,
      row,
      "return=representation",
    );

  if (
    !result.ok ||
    !Array.isArray(result.body) ||
    !result.body[0]
  ) {
    throw new Error(
      "INSERT_" +
      table +
      "_FAILED:" +
      JSON.stringify(result),
    );
  }

  return result.body[0];
}

async function deleteBy(
  table,
  column,
  value,
) {
  return req(
    "DELETE",
    "/rest/v1/" +
      table +
      "?" +
      column +
      "=eq." +
      enc(value),
    null,
    "return=minimal",
  );
}

async function selectBy(
  table,
  select,
  column,
  value,
) {
  return req(
    "GET",
    "/rest/v1/" +
      table +
      "?select=" +
      enc(select) +
      "&" +
      column +
      "=eq." +
      enc(value),
  );
}

async function rpc(body) {
  return req(
    "POST",
    "/rest/v1/rpc/run_paper_buy_exposure_stress_commit_v1",
    body,
  );
}

async function createAccount(label) {
  return insertOne(
    "paper_accounts",
    {
      account_name:
        "AI_STOCK_LAB_STRESS_" +
        label +
        "_" +
        uid(),

      initial_equity:
        100000,

      initial_cash:
        100000,

      cash_balance:
        100000,

      realized_pnl:
        0,

      daily_realized_pnl:
        0,

      trading_mode:
        "PAPER",
    },
  );
}

async function seedPosition(
  accountId,
  stock,
  quantity,
) {
  return insertOne(
    "paper_positions",
    {
      account_id:
        accountId,

      stock_code:
        stock.stock_code,

      sector:
        stock.sector,

      quantity,

      average_price:
        100,

      current_stop_price:
        97,

      highest_price:
        100,

      trailing_stop_active:
        false,
    },
  );
}

async function discoverStocks() {
  const result =
    await req(
      "GET",
      "/rest/v1/stocks?select=stock_code,sector&sector=not.is.null&order=stock_code.asc&limit=500",
    );

  if (
    !result.ok ||
    !Array.isArray(result.body)
  ) {
    throw new Error(
      "STOCK_DISCOVERY_FAILED:" +
      JSON.stringify(result),
    );
  }

  const usable =
    result.body.filter(
      (x) =>
        x &&
        x.stock_code &&
        typeof x.sector === "string" &&
        x.sector.trim(),
    );

  const bySector =
    new Map();

  for (const stock of usable) {
    const sector =
      stock.sector.trim();

    if (!bySector.has(sector)) {
      bySector.set(sector, []);
    }

    bySector.get(sector).push({
      stock_code:
        stock.stock_code,

      sector,
    });
  }

  for (const stocks of bySector.values()) {
    if (stocks.length >= 2) {
      return {
        a: stocks[0],
        b: stocks[1],
      };
    }
  }

  throw new Error(
    "NO_TWO_STOCKS_IN_SAME_SECTOR",
  );
}

async function cleanupAccount(
  accountId,
) {
  const errors = [];

  const steps = [
    ["paper_order_requests", "account_id"],
    ["paper_positions", "account_id"],
    ["risk_decisions", "account_id"],
    ["paper_accounts", "id"],
  ];

  for (const [
    table,
    column,
  ] of steps) {
    const r =
      await deleteBy(
        table,
        column,
        accountId,
      );

    if (!r.ok) {
      errors.push({
        table,
        status: r.status,
        body: r.body,
      });
    }
  }

  return errors;
}

const accounts = [];
const cleanupErrors = [];

async function makeScenarioAccount(label) {
  const account =
    await createAccount(label);

  accounts.push(
    account.id,
  );

  return account;
}

function baseBody(
  accountId,
  stockCode,
  quantity,
  limits,
  holdMs = 0,
) {
  return {
    p_account_id:
      accountId,

    p_stock_code:
      stockCode,

    p_requested_quantity:
      quantity,

    p_entry_price:
      100,

    p_equity:
      100000,

    p_max_position_rate:
      limits.position,

    p_max_portfolio_exposure_rate:
      limits.portfolio,

    p_max_sector_exposure_rate:
      limits.sector,

    p_hold_ms:
      holdMs,
  };
}

(async () => {
  let output = null;

  try {
    const stocks =
      await discoverStocks();

    /*
     * 1) Ticker: 9,000 current + 2,000 new > 10,000 (10%)
     */
    const tickerAccount =
      await makeScenarioAccount(
        "TICKER",
      );

    await seedPosition(
      tickerAccount.id,
      stocks.a,
      90,
    );

    const tickerResult =
      await rpc(
        baseBody(
          tickerAccount.id,
          stocks.a.stock_code,
          20,
          {
            position: 0.10,
            portfolio: 1.00,
            sector: 1.00,
          },
        ),
      );

    const tickerPass =
      !tickerResult.ok &&
      errorMessage(
        tickerResult,
      ).includes(
        "POSITION_LIMIT_EXCEEDED",
      );

    /*
     * 2) Portfolio: 59,000 current + 2,000 new > 60,000 (60%)
     * Isolate portfolio by setting ticker/sector thresholds to 100%.
     */
    const portfolioAccount =
      await makeScenarioAccount(
        "PORTFOLIO",
      );

    await seedPosition(
      portfolioAccount.id,
      stocks.a,
      590,
    );

    const portfolioResult =
      await rpc(
        baseBody(
          portfolioAccount.id,
          stocks.b.stock_code,
          20,
          {
            position: 1.00,
            portfolio: 0.60,
            sector: 1.00,
          },
        ),
      );

    const portfolioPass =
      !portfolioResult.ok &&
      errorMessage(
        portfolioResult,
      ).includes(
        "PORTFOLIO_LIMIT_EXCEEDED",
      );

    /*
     * 3) Sector: same sector 24,000 current + 2,000 new > 25,000 (25%)
     */
    const sectorAccount =
      await makeScenarioAccount(
        "SECTOR",
      );

    await seedPosition(
      sectorAccount.id,
      stocks.a,
      240,
    );

    const sectorResult =
      await rpc(
        baseBody(
          sectorAccount.id,
          stocks.b.stock_code,
          20,
          {
            position: 1.00,
            portfolio: 1.00,
            sector: 0.25,
          },
        ),
      );

    const sectorPass =
      !sectorResult.ok &&
      errorMessage(
        sectorResult,
      ).includes(
        "SECTOR_LIMIT_EXCEEDED",
      );

    /*
     * 4) Real two-HTTP race:
     * each BUY = 6,000.
     * Alone each is <= 10,000.
     * Together = 12,000 > 10,000.
     * Exactly one transaction may commit.
     */
    const raceAccount =
      await makeScenarioAccount(
        "RACE",
      );

    const raceBody =
      baseBody(
        raceAccount.id,
        stocks.a.stock_code,
        60,
        {
          position: 0.10,
          portfolio: 1.00,
          sector: 1.00,
        },
        150,
      );

    const startedAt =
      Date.now();

    const [
      raceA,
      raceB,
    ] =
      await Promise.all([
        rpc(raceBody),
        rpc(raceBody),
      ]);

    const elapsedMs =
      Date.now() - startedAt;

    const raceResponses =
      [raceA, raceB];

    const successes =
      raceResponses.filter(
        (x) => x.ok,
      );

    const positionBlocks =
      raceResponses.filter(
        (x) =>
          !x.ok &&
          errorMessage(x).includes(
            "POSITION_LIMIT_EXCEEDED",
          ),
      );

    const raceOrders =
      await selectBy(
        "paper_order_requests",
        "id,status,stock_code,requested_quantity,approved_quantity,entry_price,reserved_risk_amount",
        "account_id",
        raceAccount.id,
      );

    const raceDecisions =
      await selectBy(
        "risk_decisions",
        "id,stock_code,action,approved",
        "account_id",
        raceAccount.id,
      );

    const racePass =
      successes.length === 1 &&
      positionBlocks.length === 1 &&
      raceOrders.ok &&
      Array.isArray(
        raceOrders.body,
      ) &&
      raceOrders.body.length === 1 &&
      raceDecisions.ok &&
      Array.isArray(
        raceDecisions.body,
      ) &&
      raceDecisions.body.length === 1;

    const checks = {
      ticker10PercentFailClosed:
        tickerPass,

      portfolio60PercentFailClosed:
        portfolioPass,

      sector25PercentFailClosed:
        sectorPass,

      concurrentTwoHttpExactlyOneCommit:
        racePass,
    };

    const failed =
      Object.entries(checks)
        .filter(
          ([, ok]) =>
            ok !== true,
        )
        .map(
          ([name]) =>
            name,
        );

    output = {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_BUY_DB_EXPOSURE_REAL_DB_STRESS_V1_PASS"
          : "AI_STOCK_LAB_PAPER_BUY_DB_EXPOSURE_REAL_DB_STRESS_V1_REVIEW",

      classification:
        failed.length === 0
          ? "TICKER_PORTFOLIO_SECTOR_AND_CONCURRENT_EXPOSURE_FAIL_CLOSED_PROVEN"
          : "EXPOSURE_STRESS_REVIEW_REQUIRED",

      stocks,

      scenarios: {
        ticker: {
          expected:
            "POSITION_LIMIT_EXCEEDED",
          response:
            tickerResult,
          pass:
            tickerPass,
        },

        portfolio: {
          expected:
            "PORTFOLIO_LIMIT_EXCEEDED",
          response:
            portfolioResult,
          pass:
            portfolioPass,
        },

        sector: {
          expected:
            "SECTOR_LIMIT_EXCEEDED",
          response:
            sectorResult,
          pass:
            sectorPass,
        },

        concurrentRace: {
          elapsedMs,
          responses:
            raceResponses,
          successCount:
            successes.length,
          positionLimitBlockCount:
            positionBlocks.length,
          observedOrders:
            raceOrders.body,
          observedRiskDecisions:
            raceDecisions.body,
          pass:
            racePass,
        },
      },

      checks,
      failed,

      safety: {
        syntheticDedicatedPaperAccounts:
          true,

        stressAccountPrefixRequired:
          true,

        productionExposureGuardInvoked:
          true,

        realBrokerApiInvoked:
          false,

        realOrdersSent:
          false,

        realTradingEnabled:
          false,
      },

      nextGate:
        failed.length === 0
          ? "CLEANUP_AND_CLOSE_EXPOSURE_STRESS"
          : "REVIEW_ONLY_FAILED_EXPOSURE_INVARIANTS",
    };
  }
  catch (error) {
    output = {
      status:
        "AI_STOCK_LAB_PAPER_BUY_DB_EXPOSURE_REAL_DB_STRESS_V1_FAILED",

      error:
        error instanceof Error
          ? error.message
          : String(error),

      safety: {
        cleanupWillBeAttempted:
          true,
        realBrokerApiInvoked:
          false,
        realOrdersSent:
          false,
        realTradingEnabled:
          false,
      },

      nextGate:
        "REVIEW_FAILURE_AFTER_CLEANUP",
    };
  }
  finally {
    for (
      const accountId
      of accounts.reverse()
    ) {
      const errors =
        await cleanupAccount(
          accountId,
        );

      cleanupErrors.push(
        ...errors,
      );
    }

    if (output) {
      output.cleanup = {
        attemptedAccounts:
          accounts.length,

        errors:
          cleanupErrors,

        noCleanupErrors:
          cleanupErrors.length === 0,
      };

      if (
        cleanupErrors.length > 0
      ) {
        output.status =
          "AI_STOCK_LAB_PAPER_BUY_DB_EXPOSURE_REAL_DB_STRESS_V1_CLEANUP_REVIEW";

        output.nextGate =
          "STOP_AND_REPAIR_SYNTHETIC_FIXTURE_CLEANUP";
      }

      console.log(
        JSON.stringify(
          output,
          null,
          2,
        ),
      );

      const pass =
        output.status ===
          "AI_STOCK_LAB_PAPER_BUY_DB_EXPOSURE_REAL_DB_STRESS_V1_PASS" &&
        cleanupErrors.length === 0;

      process.exitCode =
        pass
          ? 0
          : 1;
    }
  }
})();
