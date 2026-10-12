import fs from "node:fs";
import path from "node:path";

type JsonObject = Record<string, any>;

async function main() {
  const ROOT =
    process.cwd();

  const SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "";

  const SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "";

  const files = {
    migration:
      "supabase/migrations/20261011000200_paper_partial_exit_position_entry_fee_basis_v1.sql",

    buyCaller:
      "lib/trading/execute-paper-order.ts",

    protectiveResolver:
      "lib/trading/resolve-protective-sell-execution-realism-v2.ts",

    stopLoss:
      "lib/trading/check-stop-losses.ts",

    trailingStop:
      "lib/trading/update-trailing-stops.ts",

    costAttribution:
      "supabase/migrations/20261010000100_paper_execution_cost_attribution_v1.sql",
  };

  function read(rel: string) {
    const abs =
      path.join(
        ROOT,
        rel,
      );

    return fs.existsSync(abs)
      ? fs.readFileSync(abs, "utf8")
      : "";
  }

  const migration =
    read(files.migration);

  const buyCaller =
    read(files.buyCaller);

  const protectiveResolver =
    read(files.protectiveResolver);

  const stopLoss =
    read(files.stopLoss);

  const trailingStop =
    read(files.trailingStop);

  const costAttribution =
    read(files.costAttribution);

  const sourceChecks = {
    migrationExists:
      migration.length > 0,

    cleanStateGuardPresent:
      /PAPER_ENTRY_FEE_BASIS_V1_REQUIRES_EMPTY_PAPER_POSITIONS/i.test(
        migration,
      ) &&
      /PAPER_ENTRY_FEE_BASIS_V1_REQUIRES_EMPTY_TRADE_HISTORY/i.test(
        migration,
      ) &&
      /PAPER_ENTRY_FEE_BASIS_V1_REQUIRES_NO_EXECUTED_BUY_ORDERS/i.test(
        migration,
      ),

    totalAndRemainingFeeBasisPresent:
      /entry_broker_fee_basis_total/i.test(
        migration,
      ) &&
      /entry_broker_fee_basis_remaining/i.test(
        migration,
      ),

    sourcePositionUniqueRemoved:
      /PAPER_TRADE_HISTORY_SOURCE_POSITION_UNIQUE_DEPLOYMENT_CHECK_FAILED/i.test(
        migration,
      ) &&
      /drop constraint/i.test(
        migration,
      ),

    buyFeeDeltaTriggerPresent:
      /trg_accumulate_paper_position_entry_fee_basis_v1/i.test(
        migration,
      ) &&
      /new\.execution_broker_fee/i.test(
        migration,
      ) &&
      /old\.execution_broker_fee/i.test(
        migration,
      ),

    partialExitAllocatorPresent:
      /trg_zz_paper_trade_entry_fee_basis_v1/i.test(
        migration,
      ) &&
      /new\.quantity::numeric/i.test(
        migration,
      ) &&
      /v_position_quantity::numeric/i.test(
        migration,
      ),

    finalExitConsumesRemainder:
      /if new\.quantity = v_position_quantity then[\s\S]*v_fee_allocated[\s\S]*v_fee_before/i.test(
        migration,
      ),

    updateDoesNotConsumeBasisAgain:
      /if tg_op = 'UPDATE' then[\s\S]*old\.entry_broker_fee/i.test(
        migration,
      ),

    costVersionV2Present:
      /PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS/i.test(
        migration,
      ),

    existingCostAttributionStillPresent:
      /create or replace function public\.apply_paper_trade_cost_attribution_v1/i.test(
        costAttribution,
      ),

    buyCallerStillUsesV4:
      /execute_paper_buy_order_with_execution_price_v4/i.test(
        buyCaller,
      ),

    protectiveResolverStillUsesV3:
      /execute_paper_protective_sell_v3/i.test(
        protectiveResolver,
      ),

    stopLossStillUsesProtectiveResolver:
      /resolveProtectiveSellExecutionRealismV2|resolve-protective-sell-execution-realism-v2/i.test(
        stopLoss,
      ) ||
      /execute_paper_protective_sell_v3/i.test(
        stopLoss,
      ),

    trailingStopStillUsesProtectiveResolver:
      /resolveProtectiveSellExecutionRealismV2|resolve-protective-sell-execution-realism-v2/i.test(
        trailingStop,
      ) ||
      /execute_paper_protective_sell_v3/i.test(
        trailingStop,
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

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_POST_DEPLOY_REGRESSION_BLOCKED",

      reason:
        "Missing Supabase URL or service role key.",

      sourceChecks,

      failedSourceChecks:
        Object.entries(sourceChecks)
          .filter(([, ok]) => ok !== true)
          .map(([name]) => name),

      safety: {
        sourceOnlyUntilBlocked:
          true,
        databaseWrites:
          0,
        rpcInvoked:
          false,
        ordersCreated:
          0,
        ordersExecuted:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false,
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

  async function getJson(
    url: string,
    accept = "application/json",
  ) {
    const response =
      await fetch(
        url,
        {
          method:
            "GET",

          headers: {
            ...headers,
            Accept:
              accept,
          },
        },
      );

    const text =
      await response.text();

    let json: any =
      null;

    try {
      json =
        JSON.parse(text);
    }
    catch {
      json =
        null;
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

  try {
    const openApi =
      await getJson(
        `${restBase}/`,
        "application/openapi+json",
      );

    const positionProbe =
      await getJson(
        `${restBase}/paper_positions?select=id,entry_broker_fee_basis_total,entry_broker_fee_basis_remaining&limit=5`,
      );

    const tradeProbe =
      await getJson(
        `${restBase}/paper_trade_history?select=id,source_position_id,entry_broker_fee,total_transaction_cost,net_pnl,cost_model_version&limit=5`,
      );

    const orderProbe =
      await getJson(
        `${restBase}/paper_order_requests?select=id,side,status,filled_quantity,execution_broker_fee,execution_fill_count&side=eq.BUY&limit=5`,
      );

    const openApiJson =
      openApi.json as JsonObject | null;

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

    const remoteChecks = {
      openApiReachable:
        openApi.ok,

      positionColumnsQueryable:
        positionProbe.ok,

      tradeColumnsQueryable:
        tradeProbe.ok,

      buyExecutionColumnsQueryable:
        orderProbe.ok,

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
          orderProbe.json,
        ) &&
        orderProbe.json.every(
          (row: any) =>
            Number(
              row?.filled_quantity ??
              0,
            ) <= 0 &&
            Number(
              row?.execution_broker_fee ??
              0,
            ) <= 0 &&
            Number(
              row?.execution_fill_count ??
              0,
            ) <= 0 &&
            row?.status !== "FILLED",
        ),
    };

    const failedSourceChecks =
      Object.entries(
        sourceChecks,
      )
        .filter(
          ([, ok]) =>
            ok !== true,
        )
        .map(
          ([name]) =>
            name,
        );

    const failedRemoteChecks =
      Object.entries(
        remoteChecks,
      )
        .filter(
          ([, ok]) =>
            ok !== true,
        )
        .map(
          ([name]) =>
            name,
        );

    const pass =
      failedSourceChecks.length === 0 &&
      failedRemoteChecks.length === 0;

    console.log(JSON.stringify({
      status:
        pass
          ? "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_POST_DEPLOY_REGRESSION_PASS"
          : "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_POST_DEPLOY_REGRESSION_REVIEW",

      classification:
        pass
          ? "DEPLOYED_PARTIAL_EXIT_AND_POSITION_ENTRY_FEE_BASIS_CHAIN_REGRESSION_CLEAN"
          : "POST_DEPLOYMENT_PARTIAL_EXIT_FEE_BASIS_REVIEW_REQUIRED",

      sourceChecks,
      remoteChecks,

      remotePreview: {
        positionRows:
          positionProbe.json,

        tradeRows:
          tradeProbe.json,

        buyRows:
          orderProbe.json,
      },

      failedSourceChecks,
      failedRemoteChecks,

      interpretation: {
        deployment:
          "The repaired position fee-basis columns are remotely queryable after db push.",

        compatibility:
          "Existing BUY V4 and protective SELL V3 application callers remain present in source.",

        cleanState:
          "No PAPER position/trade/executed BUY rows were created by migration or proof.",

        limitation:
          "This regression does not fabricate runtime orders or partial exits. Natural PAPER evidence remains a later runtime gate.",
      },

      safety: {
        readOnly:
          true,

        httpMethod:
          "GET",

        databaseReads:
          4,

        databaseWrites:
          0,

        rpcInvoked:
          false,

        ordersCreated:
          0,

        ordersExecuted:
          0,

        positionsChanged:
          0,

        realTradingEnabled:
          false,

        secretsPrinted:
          false,
      },

      nextGate:
        pass
          ? "CLOSE_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_STRUCTURALLY_AND_MOVE_TO_NEXT_DEVELOPMENT_GAP"
          : "REVIEW_ONLY_FAILED_POST_DEPLOYMENT_CHECKS",
    }, null, 2));

    process.exitCode =
      pass
        ? 0
        : 1;
  }
  catch (error) {
    console.error(JSON.stringify({
      status:
        "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_POST_DEPLOY_REGRESSION_FAILED",

      error:
        error instanceof Error
          ? error.message
          : String(error),

      safety: {
        readOnly:
          true,

        databaseWrites:
          0,

        rpcInvoked:
          false,

        ordersCreated:
          0,

        ordersExecuted:
          0,

        positionsChanged:
          0,

        realTradingEnabled:
          false,

        secretsPrinted:
          false,
      },
    }, null, 2));

    process.exitCode = 1;
  }
}

void main();
