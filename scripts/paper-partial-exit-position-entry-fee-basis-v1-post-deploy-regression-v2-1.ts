import fs from "node:fs";
import path from "node:path";

type JsonObject = Record<string, any>;

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
      const abs =
        path.join(dir, entry.name);

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
      "supabase/migrations/20261011000200_paper_partial_exit_position_entry_fee_basis_v1.sql",
    );

  const buyCaller =
    read(
      "lib/trading/execute-paper-order.ts",
    );

  const protectiveResolver =
    read(
      "lib/trading/resolve-protective-sell-execution-realism-v2.ts",
    );

  const stopLoss =
    read(
      "lib/trading/check-stop-losses.ts",
    );

  const trailingStop =
    read(
      "lib/trading/update-trailing-stops.ts",
    );

  const productionRoots = [
    path.join(ROOT, "lib"),
    path.join(ROOT, "app"),
  ];

  const productionFiles =
    productionRoots.flatMap(walk);

  const v3LiteralCallSites =
    productionFiles
      .map(abs => ({
        file: rel(abs),
        text: fs.readFileSync(abs, "utf8"),
      }))
      .filter(row =>
        /execute_paper_protective_sell_v3/i.test(
          row.text,
        ),
      )
      .map(row => ({
        file: row.file,
        containsLiteralV3: true,
        looksLikeRpcCall:
          /\.rpc\s*\(\s*['"`]execute_paper_protective_sell_v3['"`]/i.test(
            row.text,
          ) ||
          /execute_paper_protective_sell_v3\s*\(/i.test(
            row.text,
          ),
      }));

  const resolverBinding = {
    resolverFileExists:
      protectiveResolver.length > 0,

    stopLossReferencesResolver:
      /resolveProtectiveSellExecutionRealismV2/i.test(
        stopLoss,
      ) ||
      /resolve-protective-sell-execution-realism-v2/i.test(
        stopLoss,
      ),

    trailingStopReferencesResolver:
      /resolveProtectiveSellExecutionRealismV2/i.test(
        trailingStop,
      ) ||
      /resolve-protective-sell-execution-realism-v2/i.test(
        trailingStop,
      ),

    literalV3CallSiteCount:
      v3LiteralCallSites.length,

    literalV3CallSites:
      v3LiteralCallSites,

    v3ProductionBindingFound:
      v3LiteralCallSites.length > 0,
  };

  const sourceChecks = {
    migrationExists:
      migration.length > 0,

    totalAndRemainingFeeBasisPresent:
      /entry_broker_fee_basis_total/i.test(
        migration,
      ) &&
      /entry_broker_fee_basis_remaining/i.test(
        migration,
      ),

    sourcePositionUniqueRepairPresent:
      /source_position_id/i.test(
        migration,
      ) &&
      /drop constraint/i.test(
        migration,
      ),

    buyFeeAccumulatorPresent:
      /trg_accumulate_paper_position_entry_fee_basis_v1/i.test(
        migration,
      ),

    partialExitAllocatorPresent:
      /trg_zz_paper_trade_entry_fee_basis_v1/i.test(
        migration,
      ),

    buyCallerStillUsesV4:
      /execute_paper_buy_order_with_execution_price_v4/i.test(
        buyCaller,
      ),

    protectiveResolverFileExists:
      resolverBinding.resolverFileExists,

    stopLossStillUsesProtectiveResolver:
      resolverBinding.stopLossReferencesResolver,

    trailingStopStillUsesProtectiveResolver:
      resolverBinding.trailingStopReferencesResolver,

    protectiveSellV3ProductionBindingFound:
      resolverBinding.v3ProductionBindingFound,

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
        "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_POST_DEPLOY_REGRESSION_V2_1_BLOCKED",

      reason:
        "Missing Supabase URL or service role key.",

      sourceChecks,
      resolverBinding,
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

  const restBase =
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
        `${restBase}/`,
        "application/openapi+json",
      );

    const positionProbe =
      await get(
        `${restBase}/paper_positions?select=id,entry_broker_fee_basis_total,entry_broker_fee_basis_remaining&limit=5`,
      );

    const tradeProbe =
      await get(
        `${restBase}/paper_trade_history?select=id,source_position_id,entry_broker_fee,total_transaction_cost,net_pnl,cost_model_version&limit=5`,
      );

    const buyProbe =
      await get(
        `${restBase}/paper_order_requests?select=id,side,status,filled_quantity,execution_broker_fee,execution_fill_count&side=eq.BUY&limit=5`,
      );

    const openApiJson =
      openApi.json as JsonObject | null;

    const paths =
      openApiJson?.paths ??
      {};

    const definitions =
      openApiJson?.definitions ??
      openApiJson?.components?.schemas ??
      {};

    const positionSchema =
      definitions?.paper_positions ??
      definitions?.PaperPositions ??
      null;

    const tradeSchema =
      definitions?.paper_trade_history ??
      definitions?.PaperTradeHistory ??
      null;

    const positionProperties =
      positionSchema?.properties ??
      {};

    const tradeProperties =
      tradeSchema?.properties ??
      {};

    const rpcPathNames =
      Object.keys(paths)
        .filter(p =>
          /execute_paper_protective_sell_v3/i.test(
            p,
          ),
        );

    const remoteChecks = {
      openApiReachable:
        openApi.ok,

      protectiveSellV3RpcExposed:
        rpcPathNames.length > 0,

      positionColumnsQueryable:
        positionProbe.ok,

      tradeColumnsQueryable:
        tradeProbe.ok,

      buyExecutionColumnsQueryable:
        buyProbe.ok,

      openApiPositionFeeBasisVisible:
        Boolean(
          positionProperties
            .entry_broker_fee_basis_total,
        ) &&
        Boolean(
          positionProperties
            .entry_broker_fee_basis_remaining,
        ),

      openApiTradeSurfaceVisible:
        Boolean(
          tradeProperties
            .source_position_id,
        ) &&
        Boolean(
          tradeProperties
            .entry_broker_fee,
        ) &&
        Boolean(
          tradeProperties
            .net_pnl,
        ),

      remoteStillNoPaperPositions:
        Array.isArray(
          positionProbe.json,
        ) &&
        positionProbe.json.length === 0,

      remoteStillNoTradeHistory:
        Array.isArray(
          tradeProbe.json,
        ) &&
        tradeProbe.json.length === 0,

      remoteStillNoExecutedBuyRows:
        Array.isArray(
          buyProbe.json,
        ) &&
        buyProbe.json.every(
          (row: any) =>
            Number(
              row?.filled_quantity ?? 0,
            ) <= 0 &&
            Number(
              row?.execution_broker_fee ?? 0,
            ) <= 0 &&
            Number(
              row?.execution_fill_count ?? 0,
            ) <= 0 &&
            row?.status !== "FILLED",
        ),
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
          ? "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_POST_DEPLOY_REGRESSION_V2_1_PASS"
          : "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_POST_DEPLOY_REGRESSION_V2_1_REVIEW",

      classification:
        pass
          ? "DEPLOYED_PARTIAL_EXIT_FEE_BASIS_AND_PROTECTIVE_SELL_CALL_GRAPH_CLEAN"
          : "POST_DEPLOYMENT_CALL_GRAPH_OR_REMOTE_SURFACE_REVIEW_REQUIRED",

      v2Correction: {
        issue:
          "V2 referenced literalV3CallSites even though the declared variable name was v3LiteralCallSites.",

        correctedMethod:
          "V2.1 uses one consistent variable name while retaining the same read-only call-graph and remote-schema checks.",

        productionCodeChanged:
          false,
      },

      sourceChecks,
      resolverBinding,

      remoteChecks,

      remoteRpcEvidence: {
        protectiveSellV3Paths:
          rpcPathNames,
      },

      remotePreview: {
        positionRows:
          positionProbe.json,

        tradeRows:
          tradeProbe.json,

        buyRows:
          buyProbe.json,
      },

      failedSourceChecks,
      failedRemoteChecks,

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
          ? "CLOSE_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_STRUCTURALLY"
          : "REVIEW_ONLY_FAILED_V2_1_CHECKS",
    }, null, 2));

    process.exitCode =
      pass
        ? 0
        : 1;
  }
  catch (error) {
    console.error(JSON.stringify({
      status:
        "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_POST_DEPLOY_REGRESSION_V2_1_FAILED",

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
