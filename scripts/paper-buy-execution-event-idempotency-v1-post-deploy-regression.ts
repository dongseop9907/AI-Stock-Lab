import fs from "node:fs";
import path from "node:path";

async function main() {
  const ROOT = process.cwd();

  const SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "";

  const SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "";

  function read(rel: string) {
    const abs = path.join(ROOT, rel);

    return fs.existsSync(abs)
      ? fs.readFileSync(abs, "utf8")
      : "";
  }

  function walk(dir: string): string[] {
    if (!fs.existsSync(dir)) {
      return [];
    }

    const out: string[] = [];

    for (const entry of fs.readdirSync(dir, {
      withFileTypes: true,
    })) {
      const abs = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        out.push(...walk(abs));
      }
      else if (
        entry.isFile() &&
        /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)
      ) {
        out.push(abs);
      }
    }

    return out;
  }

  function rel(abs: string) {
    return path
      .relative(ROOT, abs)
      .replaceAll("\\", "/");
  }

  const migration =
    read(
      "supabase/migrations/20261011000400_paper_buy_execution_event_idempotency_v1.sql",
    );

  const caller =
    read(
      "lib/trading/execute-paper-order.ts",
    );

  const productionFiles = [
    ...walk(path.join(ROOT, "lib")),
    ...walk(path.join(ROOT, "app")),
  ];

  const productionRows =
    productionFiles.map(abs => ({
      file: rel(abs),
      text: fs.readFileSync(abs, "utf8"),
    }));

  const v5CallSites =
    productionRows
      .filter(row =>
        /execute_paper_buy_order_with_execution_price_v5/i.test(
          row.text,
        ),
      )
      .map(row => ({
        file: row.file,
        rpcCall:
          /\.rpc\s*\(\s*['"`]execute_paper_buy_order_with_execution_price_v5['"`]/i.test(
            row.text,
          ),
      }));

  const v4DirectCallSites =
    productionRows
      .filter(row =>
        /execute_paper_buy_order_with_execution_price_v4/i.test(
          row.text,
        ),
      )
      .map(row => ({
        file: row.file,
        rpcCall:
          /\.rpc\s*\(\s*['"`]execute_paper_buy_order_with_execution_price_v4['"`]/i.test(
            row.text,
          ),
      }));

  const sourceChecks = {
    migrationExists:
      migration.length > 0,

    ledgerExists:
      /paper_buy_execution_events_v1/i.test(
        migration,
      ),

    uniqueGuardExists:
      /unique\s*\(\s*order_id\s*,\s*event_fingerprint\s*\)/i.test(
        migration,
      ),

    v5Defined:
      /execute_paper_buy_order_with_execution_price_v5/i.test(
        migration,
      ),

    v5LocksOrder:
      /from\s+public\.paper_order_requests\s+o[\s\S]{0,500}?for\s+update/i.test(
        migration,
      ),

    replayChecksLedgerBeforeV4:
      /from\s+public\.paper_buy_execution_events_v1[\s\S]{0,1500}?if\s+found\s+then[\s\S]{0,1500}?execute_paper_buy_order_with_execution_price_v4/i.test(
        migration,
      ),

    replayReturnsStoredResult:
      /execution_result[\s\S]{0,1200}?idempotentReplay[\s\S]{0,500}?true/i.test(
        migration,
      ),

    newEventDelegatesV4:
      /execute_paper_buy_order_with_execution_price_v4/i.test(
        migration,
      ),

    ledgerPersistsAfterV4:
      /execute_paper_buy_order_with_execution_price_v4[\s\S]{0,3000}?insert\s+into\s+public\.paper_buy_execution_events_v1/i.test(
        migration,
      ),

    fingerprintIncludesObservedAt:
      /p_execution_observed_at/i.test(
        migration,
      ),

    fingerprintIncludesPrice:
      /p_execution_price/i.test(
        migration,
      ),

    fingerprintIncludesSource:
      /p_execution_price_source/i.test(
        migration,
      ),

    fingerprintIncludesFillQuantity:
      /p_fill_quantity/i.test(
        migration,
      ),

    fingerprintIncludesProvenance:
      /p_execution_provenance::text/i.test(
        migration,
      ),

    productionCallerUsesV5:
      /execute_paper_buy_order_with_execution_price_v5/i.test(
        caller,
      ),

    productionCallerNoLongerUsesV4:
      !/execute_paper_buy_order_with_execution_price_v4/i.test(
        caller,
      ),

    exactlyOneV5ProductionCallSite:
      v5CallSites.length === 1,

    noDirectV4ProductionRpcCall:
      v4DirectCallSites.every(
        site => site.rpcCall !== true,
      ),

    noRealTradingEnablement:
      !/REAL_TRADING_ENABLED\s*=\s*true/i.test(
        migration,
      ) &&
      !/ENABLE_REAL_TRADING\s*=\s*true/i.test(
        migration,
      ) &&
      !/ENABLE_LIVE_TRADING\s*=\s*true/i.test(
        migration,
      ),
  };

  const failedSourceChecks =
    Object.entries(sourceChecks)
      .filter(([, ok]) => ok !== true)
      .map(([name]) => name);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_PAPER_BUY_EXECUTION_EVENT_IDEMPOTENCY_V1_POST_DEPLOY_REGRESSION_BLOCKED",

      reason:
        "Missing Supabase URL or service role key.",

      sourceChecks,
      v5CallSites,
      v4DirectCallSites,
      failedSourceChecks,

      safety: {
        sourceOnlyUntilBlocked: true,
        databaseWrites: 0,
        rpcInvoked: false,
        ordersCreated: 0,
        ordersExecuted: 0,
        positionsChanged: 0,
        realTradingEnabled: false,
      },
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
          method: "GET",
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

  try {
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
        `${base}/paper_order_requests?select=id,status,filled_quantity,execution_fill_count,execution_broker_fee&side=eq.BUY&limit=5`,
      );

    const positions =
      await get(
        `${base}/paper_positions?select=id,quantity,average_price&limit=5`,
      );

    const paths =
      openApi.json?.paths ??
      {};

    const v5Paths =
      Object.keys(paths)
        .filter(p =>
          /execute_paper_buy_order_with_execution_price_v5/i.test(
            p,
          ),
        );

    const remoteChecks = {
      openApiReachable:
        openApi.ok,

      v5RpcExposed:
        v5Paths.length > 0,

      ledgerQueryable:
        ledger.ok,

      buyOrdersQueryable:
        orders.ok,

      positionsQueryable:
        positions.ok,

      ledgerStillEmptyBeforeNaturalFill:
        Array.isArray(
          ledger.json,
        ) &&
        ledger.json.length === 0,

      noExecutedBuyRowsCreatedByRepair:
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
            Number(
              row?.execution_broker_fee ?? 0,
            ) <= 0 &&
            row?.status !== "FILLED",
        ),

      noPositionsCreatedByRepair:
        Array.isArray(
          positions.json,
        ) &&
        positions.json.length === 0,
    };

    const failedRemoteChecks =
      Object.entries(remoteChecks)
        .filter(([, ok]) => ok !== true)
        .map(([name]) => name);

    const pass =
      failedSourceChecks.length === 0 &&
      failedRemoteChecks.length === 0;

    console.log(JSON.stringify({
      status:
        pass
          ? "AI_STOCK_LAB_PAPER_BUY_EXECUTION_EVENT_IDEMPOTENCY_V1_POST_DEPLOY_REGRESSION_PASS"
          : "AI_STOCK_LAB_PAPER_BUY_EXECUTION_EVENT_IDEMPOTENCY_V1_POST_DEPLOY_REGRESSION_REVIEW",

      classification:
        pass
          ? "DEPLOYED_BUY_V5_IDEMPOTENCY_CHAIN_REGRESSION_CLEAN"
          : "BUY_V5_IDEMPOTENCY_POST_DEPLOY_REVIEW_REQUIRED",

      sourceChecks,

      productionCallGraph: {
        v5CallSites,
        v4DirectCallSites,
      },

      remoteChecks,

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

      failedSourceChecks,
      failedRemoteChecks,

      interpretation: {
        idempotency:
          "Production BUY execution now enters V5, which locks the order, checks the execution-event ledger, returns stored result on exact replay, and delegates only first-seen events to V4.",

        compatibility:
          "The validated V4 -> V3 -> V2 chain remains underneath V5, preserving filled-price, provenance, risk, fee-basis and position accounting behavior.",

        naturalEvidence:
          "No PAPER fill was fabricated. Ledger replay behavior still awaits a natural or separately controlled non-production test event.",
      },

      safety: {
        readOnly: true,
        databaseReads: 4,
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
          ? "CLOSE_BUY_EXECUTION_EVENT_IDEMPOTENCY_V1_STRUCTURALLY"
          : "REVIEW_ONLY_FAILED_POST_DEPLOY_CHECKS",
    }, null, 2));

    process.exitCode =
      pass
        ? 0
        : 1;
  }
  catch (error) {
    console.error(JSON.stringify({
      status:
        "AI_STOCK_LAB_PAPER_BUY_EXECUTION_EVENT_IDEMPOTENCY_V1_POST_DEPLOY_REGRESSION_FAILED",

      error:
        error instanceof Error
          ? error.message
          : String(error),

      safety: {
        readOnly: true,
        databaseWrites: 0,
        rpcInvoked: false,
        ordersCreated: 0,
        ordersExecuted: 0,
        positionsChanged: 0,
        realTradingEnabled: false,
      },
    }, null, 2));

    process.exitCode = 1;
  }
}

void main();
