const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");
const SCRIPT_DIR = path.join(ROOT, "scripts");

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_DB_EXPOSURE_STRESS_HARNESS_V1_INSTALL_FAILED",
        reason,
        ...extra,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}

if (!fs.existsSync(MIG_DIR)) {
  fail("MIGRATION_DIRECTORY_NOT_FOUND");
}
else {
  const sqlFiles =
    fs.readdirSync(MIG_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort();

  const exposureMigration =
    sqlFiles
      .filter(
        (name) =>
          name.endsWith(
            "_paper_buy_db_exposure_defense_in_depth_v1.sql",
          ),
      )
      .pop();

  if (!exposureMigration) {
    fail("EXPOSURE_DEFENSE_MIGRATION_NOT_FOUND");
  }
  else {
    const exposureSource =
      fs.readFileSync(
        path.join(
          MIG_DIR,
          exposureMigration,
        ),
        "utf8",
      );

    if (
      !/create or replace function public\.assert_paper_buy_exposure_limits_v1\s*\(/i
        .test(exposureSource)
    ) {
      fail(
        "EXPOSURE_GUARD_HELPER_NOT_FOUND_IN_SOURCE",
        {
          exposureMigration,
        },
      );
      return;
    }

    let maxStamp = 20261011001900;

    for (const name of sqlFiles) {
      if (!/^\d{14}_/.test(name)) {
        continue;
      }

      const stamp =
        Number(name.slice(0, 14));

      if (
        Number.isFinite(stamp) &&
        stamp > maxStamp
      ) {
        maxStamp = stamp;
      }
    }

    const stamp =
      Math.max(
        20261011002000,
        maxStamp + 100,
      );

    const migrationName =
      String(stamp) +
      "_paper_buy_db_exposure_stress_harness_v1.sql";

    const migrationRel =
      path.join(
        "supabase",
        "migrations",
        migrationName,
      );

    const migrationFull =
      path.join(
        ROOT,
        migrationRel,
      );

    const migrationSql =
`-- AI Stock Lab
-- PAPER BUY DB Exposure Stress Harness V1
--
-- Test-only RPC surface for service_role.
-- It is intentionally restricted to accounts whose account_name begins
-- with AI_STOCK_LAB_STRESS_. It does not call any broker/external API.
--
-- Purpose:
--   1. exercise assert_paper_buy_exposure_limits_v1 through real DB RPC
--   2. insert one synthetic RISK_APPROVED pending BUY on success
--   3. allow two independent HTTP transactions to prove the account-row
--      lock closes concurrent exposure races
--
-- Production trading functions are not modified.

begin;

create or replace function public.run_paper_buy_exposure_stress_commit_v1(
  p_account_id uuid,
  p_stock_code text,
  p_requested_quantity integer,
  p_entry_price numeric,
  p_equity numeric,
  p_max_position_rate numeric,
  p_max_portfolio_exposure_rate numeric,
  p_max_sector_exposure_rate numeric,
  p_hold_ms integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_name text;
  v_risk_decision_id uuid;
  v_order_id uuid := gen_random_uuid();
  v_stop_price numeric;
  v_reserved_risk numeric;
begin
  select a.account_name
  into v_account_name
  from public.paper_accounts a
  where a.id = p_account_id;

  if not found then
    raise exception 'STRESS_ACCOUNT_NOT_FOUND';
  end if;

  if
    v_account_name is null or
    v_account_name not like 'AI_STOCK_LAB_STRESS_%'
  then
    raise exception 'STRESS_ACCOUNT_PREFIX_REQUIRED';
  end if;

  if p_hold_ms is null or p_hold_ms < 0 or p_hold_ms > 500 then
    raise exception 'STRESS_HOLD_MS_INVALID';
  end if;

  /*
   * Authoritative production exposure helper.
   * It locks paper_accounts FOR UPDATE and therefore holds the account
   * serialization lock until this wrapper transaction commits/rolls back.
   */
  perform public.assert_paper_buy_exposure_limits_v1(
    p_account_id,
    p_stock_code,
    p_requested_quantity,
    p_entry_price,
    p_equity,
    p_max_position_rate,
    p_max_portfolio_exposure_rate,
    p_max_sector_exposure_rate
  );

  v_stop_price :=
    round(
      p_entry_price * 0.97,
      6
    );

  v_reserved_risk :=
    greatest(
      p_entry_price - v_stop_price,
      0
    ) *
    p_requested_quantity;

  insert into public.risk_decisions (
    account_id,
    stock_code,
    action,
    approved,
    requested_payload,
    result_payload
  )
  values (
    p_account_id,
    p_stock_code,
    'BUY',
    true,
    jsonb_build_object(
      'test',
        'PAPER_BUY_DB_EXPOSURE_STRESS_V1',
      'synthetic',
        true,
      'persistent',
        false,
      'requestedQuantity',
        p_requested_quantity,
      'entryPrice',
        p_entry_price
    ),
    jsonb_build_object(
      'approved',
        true,
      'reason',
        'DB_EXPOSURE_STRESS_SYNTHETIC'
    )
  )
  returning id
  into v_risk_decision_id;

  insert into public.paper_order_requests (
    id,
    account_id,
    stock_code,
    side,
    requested_quantity,
    approved_quantity,
    entry_price,
    stop_price,
    status,
    risk_decision_id,
    filled_quantity,
    reserved_risk_amount,
    reserved_risk_at,
    committed_risk_reason,
    committed_risk_snapshot
  )
  values (
    v_order_id,
    p_account_id,
    p_stock_code,
    'BUY',
    p_requested_quantity,
    p_requested_quantity,
    p_entry_price,
    v_stop_price,
    'RISK_APPROVED',
    v_risk_decision_id,
    0,
    v_reserved_risk,
    now(),
    'DB_EXPOSURE_STRESS_SYNTHETIC',
    jsonb_build_object(
      'test',
        'PAPER_BUY_DB_EXPOSURE_STRESS_V1',
      'synthetic',
        true,
      'persistent',
        false
    )
  );

  if p_hold_ms > 0 then
    perform pg_sleep(
      p_hold_ms::numeric / 1000.0
    );
  end if;

  return jsonb_build_object(
    'status',
      'STRESS_ORDER_CREATED',
    'orderId',
      v_order_id,
    'riskDecisionId',
      v_risk_decision_id,
    'accountId',
      p_account_id,
    'stockCode',
      p_stock_code,
    'requestedQuantity',
      p_requested_quantity,
    'entryPrice',
      p_entry_price,
    'orderAmount',
      p_requested_quantity * p_entry_price
  );
end;
$$;

revoke all on function
  public.run_paper_buy_exposure_stress_commit_v1(
    uuid,
    text,
    integer,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric,
    integer
  )
from public, anon, authenticated;

grant execute on function
  public.run_paper_buy_exposure_stress_commit_v1(
    uuid,
    text,
    integer,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric,
    integer
  )
to service_role;

comment on function
  public.run_paper_buy_exposure_stress_commit_v1(
    uuid,
    text,
    integer,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric,
    integer
  )
is
  'Service-role-only synthetic DB exposure stress RPC. Restricted to AI_STOCK_LAB_STRESS_* PAPER accounts. Calls the production exposure guard and inserts one synthetic pending BUY only when the guard permits it.';

commit;
`;

    if (fs.existsSync(migrationFull)) {
      const existing =
        fs.readFileSync(
          migrationFull,
          "utf8",
        );

      if (existing !== migrationSql) {
        fail(
          "TARGET_MIGRATION_EXISTS_WITH_DIFFERENT_CONTENT",
          {
            target:
              migrationRel.replace(/\\/g, "/"),
          },
        );
        return;
      }
    }
    else {
      fs.writeFileSync(
        migrationFull,
        migrationSql,
        "utf8",
      );
    }

    fs.mkdirSync(
      SCRIPT_DIR,
      {
        recursive: true,
      },
    );

    const verifierRel =
      "scripts/paper-buy-db-exposure-stress-harness-v1-verify.cjs";

    const verifierFull =
      path.join(
        ROOT,
        verifierRel,
      );

    const verifierSource = String.raw`const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR =
  path.join(ROOT, "supabase", "migrations");

const files =
  fs.existsSync(MIG_DIR)
    ? fs.readdirSync(MIG_DIR)
        .filter(
          (name) =>
            name.endsWith(
              "_paper_buy_db_exposure_stress_harness_v1.sql",
            ),
        )
        .sort()
    : [];

const target =
  files.length
    ? files[files.length - 1]
    : null;

const source =
  target
    ? fs.readFileSync(
        path.join(MIG_DIR, target),
        "utf8",
      )
    : "";

const checks = {
  migrationFound:
    Boolean(target),

  stressRpcPresent:
    /create or replace function public\.run_paper_buy_exposure_stress_commit_v1\s*\(/i
      .test(source),

  callsProductionExposureGuard:
    /perform public\.assert_paper_buy_exposure_limits_v1\s*\(/i
      .test(source),

  syntheticAccountPrefixRequired:
    /AI_STOCK_LAB_STRESS_%/
      .test(source) &&
    /STRESS_ACCOUNT_PREFIX_REQUIRED/
      .test(source),

  insertsSyntheticRiskDecision:
    /insert into public\.risk_decisions/i
      .test(source),

  insertsPendingBuy:
    /insert into public\.paper_order_requests/i
      .test(source) &&
    /'RISK_APPROVED'/i
      .test(source),

  pendingExposureVisibleBeforeCommit:
    /insert into public\.paper_order_requests[\s\S]*?if p_hold_ms > 0 then[\s\S]*?pg_sleep/i
      .test(source),

  boundedHold:
    /p_hold_ms > 500/i
      .test(source),

  serviceRoleGranted:
    /grant execute on function[\s\S]*?to service_role;/i
      .test(source),

  publicRevoked:
    /revoke all on function[\s\S]*?from public, anon, authenticated;/i
      .test(source),

  productionFunctionsNotReplaced:
    !/create or replace function public\.create_paper_buy_order_with_committed_risk_v3\s*\(/i
      .test(source) &&
    !/create or replace function public\.assert_paper_buy_exposure_limits_v1\s*\(/i
      .test(source),

  noHistoricalDataRewrite:
    !/\bupdate\s+public\./i.test(source) &&
    !/\bdelete\s+from\s+public\./i.test(source),

  transactionWrapped:
    /\bbegin\s*;/i.test(source) &&
    /\bcommit\s*;/i.test(source),

  noRealTradingEnable:
    !/REAL_TRADING_ENABLED\s*=\s*true/i
      .test(source),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_BUY_DB_EXPOSURE_STRESS_HARNESS_V1_VERIFIED"
          : "AI_STOCK_LAB_PAPER_BUY_DB_EXPOSURE_STRESS_HARNESS_V1_VERIFY_FAILED",

      migration:
        target
          ? "supabase/migrations/" +
            target
          : null,

      checks,
      failed,

      safety: {
        sourceOnly:
          true,
        databaseReads:
          0,
        databaseWrites:
          0,
        migrationApplied:
          false,
        syntheticAccountOnly:
          true,
        serviceRoleOnly:
          true,
        realBrokerApiInvoked:
          false,
        realTradingEnabled:
          false,
      },

      nextGate:
        failed.length === 0
          ? "SUPABASE_DB_PUSH_DRY_RUN_FOR_EXPOSURE_STRESS_HARNESS"
          : "REPAIR_SOURCE_BEFORE_DB_APPLY",
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
`;

    fs.writeFileSync(
      verifierFull,
      verifierSource,
      "utf8",
    );

    const runnerRel =
      "scripts/paper-buy-db-exposure-real-db-stress-v1.cjs";

    const runnerFull =
      path.join(
        ROOT,
        runnerRel,
      );

    const runnerSource = String.raw`const fs = require("fs");
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
`;

    fs.writeFileSync(
      runnerFull,
      runnerSource,
      "utf8",
    );

    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_DB_EXPOSURE_STRESS_HARNESS_V1_INSTALLED",

          sourceExposureMigration:
            "supabase/migrations/" +
            exposureMigration,

          generatedMigration:
            migrationRel.replace(/\\/g, "/"),

          generatedVerifier:
            verifierRel,

          generatedStressRunner:
            runnerRel,

          stressPlan: {
            ticker:
              "9000 existing + 2000 new > 10000 = 10% limit",

            portfolio:
              "59000 existing + 2000 new > 60000 = 60% limit",

            sector:
              "24000 same-sector existing + 2000 new > 25000 = 25% limit",

            concurrentRace:
              "two independent HTTP BUY commits of 6000 each; exactly one may commit under 10% ticker limit",
          },

          safety: {
            syntheticDedicatedPaperAccounts:
              true,

            testRpcServiceRoleOnly:
              true,

            productionTradingFunctionsModified:
              false,

            historicalMigrationsModified:
              false,

            databaseWrites:
              0,

            migrationApplied:
              false,

            realBrokerApiInvoked:
              false,

            realTradingEnabled:
              false,
          },

          nextAction:
            "VERIFY_SOURCE_AND_SUPABASE_DB_PUSH_DRY_RUN",
        },
        null,
        2,
      ),
    );
  }
}
