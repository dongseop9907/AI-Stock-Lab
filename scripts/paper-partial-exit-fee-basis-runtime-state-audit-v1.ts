type JsonRow = Record<string, any>;

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  "";

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_FEE_BASIS_RUNTIME_STATE_AUDIT_V1_BLOCKED",
    reason:
      "Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    safety: {
      readOnly: true,
      databaseWrites: 0,
      rpcInvoked: false,
      ordersCreated: 0,
      ordersExecuted: 0,
      positionsChanged: 0,
      realTradingEnabled: false,
      secretsPrinted: false
    }
  }, null, 2));
  process.exitCode = 2;
}
else {
  const base =
    SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1";

  const headers: Record<string, string> = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    Accept: "application/json"
  };

  async function getAll(
    table: string,
    select: string,
    extra: Record<string, string> = {}
  ): Promise<JsonRow[]> {
    const pageSize = 1000;
    const rows: JsonRow[] = [];

    for (let offset = 0; ; offset += pageSize) {
      const params = new URLSearchParams({
        select,
        ...extra
      });

      const url =
        `${base}/${table}?${params.toString()}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          ...headers,
          Range: `${offset}-${offset + pageSize - 1}`
        }
      });

      if (!response.ok) {
        const body = await response.text();

        throw new Error(
          `${table} GET failed: HTTP ${response.status} ` +
          body.slice(0, 500)
        );
      }

      const page = await response.json();

      if (!Array.isArray(page)) {
        throw new Error(
          `${table} GET did not return an array`
        );
      }

      rows.push(...page);

      if (page.length < pageSize) {
        break;
      }
    }

    return rows;
  }

  function n(value: any): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function keyOf(row: JsonRow): string {
    return `${row.account_id ?? ""}::${row.stock_code ?? ""}`;
  }

  try {
    const [
      positions,
      buyOrders,
      trades
    ] = await Promise.all([
      getAll(
        "paper_positions",
        [
          "id",
          "account_id",
          "stock_code",
          "quantity",
          "average_price",
          "entry_order_id",
          "model_id",
          "created_at",
          "updated_at"
        ].join(",")
      ),

      getAll(
        "paper_order_requests",
        [
          "id",
          "account_id",
          "stock_code",
          "side",
          "status",
          "requested_quantity",
          "approved_quantity",
          "filled_quantity",
          "entry_price",
          "filled_price",
          "execution_price",
          "execution_broker_fee",
          "execution_transaction_cost",
          "execution_fill_count",
          "executed_at",
          "created_at"
        ].join(","),
        {
          side: "eq.BUY"
        }
      ),

      getAll(
        "paper_trade_history",
        [
          "id",
          "account_id",
          "stock_code",
          "source_position_id",
          "buy_order_id",
          "sell_order_id",
          "quantity",
          "entry_price",
          "exit_price",
          "entry_broker_fee",
          "exit_broker_fee",
          "sell_tax",
          "total_transaction_cost",
          "gross_pnl",
          "net_pnl",
          "cost_attribution_complete",
          "cost_model_version",
          "closed_at",
          "created_at"
        ].join(",")
      )
    ]);

    const executedBuys =
      buyOrders.filter(row =>
        n(row.filled_quantity) > 0 ||
        n(row.execution_broker_fee) > 0 ||
        n(row.execution_fill_count) > 0 ||
        row.status === "FILLED"
      );

    const buyById =
      new Map(
        buyOrders.map(row => [
          String(row.id),
          row
        ])
      );

    const executedByAccountStock =
      new Map<string, JsonRow[]>();

    for (const order of executedBuys) {
      const key = keyOf(order);
      const current =
        executedByAccountStock.get(key) ?? [];
      current.push(order);
      executedByAccountStock.set(
        key,
        current
      );
    }

    const tradeByPosition =
      new Map<string, JsonRow[]>();

    for (const trade of trades) {
      const id =
        String(trade.source_position_id ?? "");

      if (!id) continue;

      const current =
        tradeByPosition.get(id) ?? [];
      current.push(trade);
      tradeByPosition.set(
        id,
        current
      );
    }

    const openPositionAnalysis =
      positions.map(position => {
        const candidates =
          executedByAccountStock.get(
            keyOf(position)
          ) ?? [];

        const entryOrderId =
          position.entry_order_id
            ? String(position.entry_order_id)
            : null;

        const entryOrder =
          entryOrderId
            ? buyById.get(entryOrderId) ?? null
            : null;

        const historicalTrades =
          tradeByPosition.get(
            String(position.id)
          ) ?? [];

        const candidateSummary =
          candidates.map(order => ({
            id: order.id,
            status: order.status,
            filledQuantity:
              n(order.filled_quantity),
            executionBrokerFee:
              n(order.execution_broker_fee),
            executionFillCount:
              n(order.execution_fill_count),
            executedAt:
              order.executed_at ?? null,
            createdAt:
              order.created_at ?? null
          }));

        return {
          positionId: position.id,
          accountId: position.account_id,
          stockCode: position.stock_code,
          quantity: n(position.quantity),
          averagePrice:
            n(position.average_price),
          entryOrderId,
          entryOrderResolved:
            Boolean(entryOrder),
          entryOrderExecutionBrokerFee:
            entryOrder
              ? n(entryOrder.execution_broker_fee)
              : null,
          executedBuyCandidateCount:
            candidates.length,
          executedBuyCandidates:
            candidateSummary,
          priorTradeRowsForSamePosition:
            historicalTrades.length,
          backfillClassification:
            candidates.length === 0
              ? "NO_EXECUTED_BUY_CANDIDATE"
              : candidates.length === 1 &&
                entryOrderId ===
                  String(candidates[0].id)
                ? "SINGLE_MATCHING_BUY_CANDIDATE"
                : "AMBIGUOUS_MULTI_OR_HISTORICAL_BUY_CANDIDATES"
        };
      });

    const positionsWithoutBuyCandidate =
      openPositionAnalysis.filter(
        row =>
          row.executedBuyCandidateCount === 0
      );

    const positionsWithAmbiguousCandidates =
      openPositionAnalysis.filter(
        row =>
          row.backfillClassification ===
          "AMBIGUOUS_MULTI_OR_HISTORICAL_BUY_CANDIDATES"
      );

    const positionsWithPriorTrades =
      openPositionAnalysis.filter(
        row =>
          row.priorTradeRowsForSamePosition > 0
      );

    const sourcePositionTradeCounts =
      new Map<string, number>();

    for (const trade of trades) {
      const sourcePositionId =
        String(
          trade.source_position_id ?? ""
        );

      if (!sourcePositionId) continue;

      sourcePositionTradeCounts.set(
        sourcePositionId,
        (
          sourcePositionTradeCounts.get(
            sourcePositionId
          ) ?? 0
        ) + 1
      );
    }

    const sourcePositionsWithMultipleTrades =
      [...sourcePositionTradeCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([sourcePositionId, count]) => ({
          sourcePositionId,
          tradeCount: count
        }));

    const historyRowsWithEntryFee =
      trades.filter(
        row =>
          n(row.entry_broker_fee) > 0
      );

    const historyRowsIncompleteCost =
      trades.filter(
        row =>
          row.cost_attribution_complete !== true
      );

    let classification: string;
    let nextGate: string;

    if (
      positions.length === 0 &&
      executedBuys.length === 0 &&
      trades.length === 0
    ) {
      classification =
        "CLEAN_EMPTY_PAPER_STATE_SAFE_FOR_ATOMIC_REPAIR";
      nextGate =
        "BUILD_ATOMIC_PARTIAL_EXIT_AND_POSITION_ENTRY_FEE_BASIS_MIGRATION";
    }
    else if (
      positions.length === 0
    ) {
      classification =
        "NO_OPEN_POSITION_BACKFILL_REQUIRED_HISTORY_PRESERVATION_ONLY";
      nextGate =
        "BUILD_REPAIR_WITH_NO_OPEN_POSITION_BACKFILL_AND_PRESERVE_HISTORY";
    }
    else if (
      positionsWithoutBuyCandidate.length > 0 ||
      positionsWithAmbiguousCandidates.length > 0 ||
      positionsWithPriorTrades.length > 0
    ) {
      classification =
        "OPEN_POSITION_FEE_BASIS_BACKFILL_AMBIGUOUS_REVIEW_REQUIRED";
      nextGate =
        "DO_NOT_DEPLOY_REPAIR_UNTIL_OPEN_POSITION_BASIS_IS_RESOLVED";
    }
    else {
      classification =
        "OPEN_POSITION_SINGLE_BUY_BACKFILL_POSSIBLE_REVIEW_BEFORE_DEPLOY";
      nextGate =
        "BUILD_REPAIR_WITH_EXPLICIT_SINGLE_BUY_OPEN_POSITION_BACKFILL";
    }

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_FEE_BASIS_RUNTIME_STATE_AUDIT_V1_COMPLETE",

      classification,

      counts: {
        openPositions:
          positions.length,
        buyOrdersChecked:
          buyOrders.length,
        executedBuyOrders:
          executedBuys.length,
        tradeHistoryRows:
          trades.length,
        positionsWithoutBuyCandidate:
          positionsWithoutBuyCandidate.length,
        positionsWithAmbiguousCandidates:
          positionsWithAmbiguousCandidates.length,
        positionsWithPriorTrades:
          positionsWithPriorTrades.length,
        sourcePositionsWithMultipleTrades:
          sourcePositionsWithMultipleTrades.length,
        historyRowsWithEntryFee:
          historyRowsWithEntryFee.length,
        historyRowsIncompleteCost:
          historyRowsIncompleteCost.length
      },

      openPositionAnalysis,
      sourcePositionsWithMultipleTrades,

      interpretation: {
        uniqueConstraint:
          "The source-only audit already proved the schema/migration gap. This runtime audit does not mutate or introspect constraints; it checks whether existing rows require a data backfill before that structural repair is deployed.",

        feeBasis:
          positions.length === 0
            ? "No currently open PAPER position requires reconstruction of a remaining entry-fee basis."
            : "At least one open PAPER position exists. Its fee basis must be reconstructed or explicitly reviewed before enabling position-level fee consumption.",

        history:
          trades.length === 0
            ? "No historical PAPER trade rows require preservation decisions."
            : "Historical PAPER trade rows exist. The repair should preserve them and should not silently rewrite past cost attribution without a separate migration decision."
      },

      safety: {
        readOnly: true,
        httpMethod: "GET",
        databaseReads:
          3,
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
          false
      },

      nextGate
    }, null, 2));

    process.exitCode = 0;
  }
  catch (error) {
    console.error(JSON.stringify({
      status:
        "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_FEE_BASIS_RUNTIME_STATE_AUDIT_V1_FAILED",

      error:
        error instanceof Error
          ? error.message
          : String(error),

      safety: {
        readOnly: true,
        httpMethod: "GET",
        databaseWrites: 0,
        rpcInvoked: false,
        ordersCreated: 0,
        ordersExecuted: 0,
        positionsChanged: 0,
        realTradingEnabled: false,
        secretsPrinted: false
      },

      nextGate:
        "REVIEW_READ_ONLY_RUNTIME_QUERY_FAILURE"
    }, null, 2));

    process.exitCode = 1;
  }
}
