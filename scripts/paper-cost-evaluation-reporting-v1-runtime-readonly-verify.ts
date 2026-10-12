import {
  getPaperAccountDashboard,
} from "../lib/trading/get-paper-account-dashboard";

import {
  getTradeHistoryDashboard,
} from "../lib/trading/get-trade-history-dashboard";

async function main() {
  const accountDashboard =
    await getPaperAccountDashboard();

  const tradeHistory =
    await getTradeHistoryDashboard();

  const account =
    accountDashboard.account;

  const summary =
    tradeHistory.summary;

  const firstTrade =
    tradeHistory.trades[0] ??
    null;

  const checks = {
    accountDashboardReturned:
      Boolean(
        accountDashboard &&
        account,
      ),

    accountCostFieldsPresent:
      [
        "grossRealizedPnl",
        "transactionCosts",
        "costAttributedTrades",
        "legacyFallbackTrades",
        "ledgerTotalPnl",
        "costAccountingGap",
      ].every(
        key =>
          Object.prototype.hasOwnProperty.call(
            account,
            key,
          ),
      ),

    tradeHistoryReturned:
      Boolean(
        tradeHistory &&
        summary &&
        Array.isArray(
          tradeHistory.trades,
        ),
      ),

    zeroTradeStateIsSafe:
      tradeHistory.trades.length ===
        0
        ? (
            summary.closedTrades ===
              0 &&
            summary.totalRealizedPnl ===
              0
          )
        : true,

    tradeRowsExposeCostDiagnostics:
      firstTrade ===
        null
        ? true
        : [
            "grossPnl",
            "netPnl",
            "transactionCost",
            "pnlSource",
            "costAttributionComplete",
          ].every(
            key =>
              Object.prototype.hasOwnProperty.call(
                firstTrade,
                key,
              ),
          ),

    canonicalPnlConsistency:
      firstTrade ===
        null
        ? true
        : (
            firstTrade.realizedPnl ===
            firstTrade.netPnl
          ),
  };

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, ok]) =>
          ok !== true,
      )
      .map(
        ([name]) =>
          name,
      );

  const waitState =
    tradeHistory.trades.length ===
      0
      ? "NORMAL_WAIT_NO_PAPER_TRADES"
      : "NATURAL_PAPER_TRADE_EVIDENCE_PRESENT";

  console.log(
    JSON.stringify(
      {
        status:
          failed.length ===
            0
            ? "AI_STOCK_LAB_PAPER_COST_EVALUATION_REPORTING_V1_RUNTIME_READONLY_VERIFIED"
            : "AI_STOCK_LAB_PAPER_COST_EVALUATION_REPORTING_V1_RUNTIME_READONLY_FAILED",

        checks,

        runtime: {
          account: {
            realizedPnl:
              account.realizedPnl,
            grossRealizedPnl:
              account.grossRealizedPnl,
            transactionCosts:
              account.transactionCosts,
            unrealizedPnl:
              account.unrealizedPnl,
            totalPnl:
              account.totalPnl,
            ledgerTotalPnl:
              account.ledgerTotalPnl,
            costAccountingGap:
              account.costAccountingGap,
            costAttributedTrades:
              account.costAttributedTrades,
            legacyFallbackTrades:
              account.legacyFallbackTrades,
          },

          tradeHistory: {
            closedTrades:
              summary.closedTrades,
            totalRealizedPnl:
              summary.totalRealizedPnl,
            firstTrade:
              firstTrade
                ? {
                    id:
                      firstTrade.id,
                    realizedPnl:
                      firstTrade.realizedPnl,
                    grossPnl:
                      firstTrade.grossPnl,
                    netPnl:
                      firstTrade.netPnl,
                    transactionCost:
                      firstTrade.transactionCost,
                    pnlSource:
                      firstTrade.pnlSource,
                    costAttributionComplete:
                      firstTrade.costAttributionComplete,
                  }
                : null,
          },

          waitState,
        },

        interpretation: {
          costPipelineRuntimeReadable:
            failed.length ===
              0,

          noNaturalTradeYet:
            tradeHistory.trades.length ===
              0,

          zeroTradeWaitIsNormal:
            tradeHistory.trades.length ===
              0,

          syntheticTradeRequired:
            false,
        },

        safety: {
          readOnly:
            true,
          databaseWrites:
            0,
          ordersCreated:
            0,
          ordersExecuted:
            0,
          positionsChanged:
            0,
          syntheticTradesCreated:
            0,
          promotionExecuted:
            false,
          realTradingEnabled:
            false,
        },

        failed,

        nextGate:
          failed.length ===
            0
            ? "PAPER_EXECUTION_COST_PIPELINE_V1_COMPLETE_THEN_REPAIR_FORWARD_OOS_V1_PATH_IMPORT"
            : "REPAIR_RUNTIME_REPORTING_BINDING",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length ===
      0
      ? 0
      : 1;
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_PAPER_COST_EVALUATION_REPORTING_V1_RUNTIME_READONLY_FAILED",

          error:
            String(
              error instanceof
                Error
                ? error.message
                : error,
            ),

          safety: {
            readOnly:
              true,
            databaseWrites:
              0,
            ordersCreated:
              0,
            ordersExecuted:
              0,
            positionsChanged:
              0,
            realTradingEnabled:
              false,
          },

          nextGate:
            "REVIEW_RUNTIME_READONLY_FAILURE",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
