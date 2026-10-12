type JsonRow = Record<string, any>;

async function main() {
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
        "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_FEE_BASIS_RUNTIME_STATE_AUDIT_V1_2_BLOCKED",
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
    return;
  }

  const base =
    SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1";

  const headers: Record<string, string> = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    Accept: "application/json"
  };

  async function getAll(
    table: string,
    extra: Record<string, string> = {}
  ): Promise<JsonRow[]> {
    const pageSize = 1000;
    const rows: JsonRow[] = [];

    for (let offset = 0; ; offset += pageSize) {
      const params = new URLSearchParams({
        select: "*",
        ...extra
      });

      const response = await fetch(
        `${base}/${table}?${params.toString()}`,
        {
          method: "GET",
          headers: {
            ...headers,
            Range: `${offset}-${offset + pageSize - 1}`
          }
        }
      );

      if (!response.ok) {
        const body = await response.text();

        throw new Error(
          `${table} GET failed: HTTP ${response.status} ` +
          body.slice(0, 800)
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

  function n(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? parsed
      : 0;
  }

  function s(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const text = String(value).trim();

    return text.length > 0
      ? text
      : null;
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
        "paper_positions"
      ),

      getAll(
        "paper_order_requests",
        {
          side: "eq.BUY"
        }
      ),

      getAll(
        "paper_trade_history"
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
      new Map<string, JsonRow>();

    for (const row of buyOrders) {
      const id = s(row.id);

      if (id) {
        buyById.set(
          id,
          row
        );
      }
    }

    const executedByAccountStock =
      new Map<string, JsonRow[]>();

    for (const order of executedBuys) {
      const key =
        keyOf(order);

      const list =
        executedByAccountStock.get(key) ?? [];

      list.push(order);

      executedByAccountStock.set(
        key,
        list
      );
    }

    const tradeByPosition =
      new Map<string, JsonRow[]>();

    for (const trade of trades) {
      const sourcePositionId =
        s(trade.source_position_id);

      if (!sourcePositionId) {
        continue;
      }

      const list =
        tradeByPosition.get(sourcePositionId) ?? [];

      list.push(trade);

      tradeByPosition.set(
        sourcePositionId,
        list
      );
    }

    const openPositionAnalysis =
      positions.map(position => {
        const positionId =
          s(position.id);

        const candidates =
          executedByAccountStock.get(
            keyOf(position)
          ) ?? [];

        const entryOrderId =
          s(position.entry_order_id);

        const entryOrder =
          entryOrderId
            ? buyById.get(entryOrderId) ?? null
            : null;

        const historicalTrades =
          positionId
            ? tradeByPosition.get(positionId) ?? []
            : [];

        const candidateSummary =
          candidates.map(order => ({
            id:
              s(order.id),

            status:
              order.status ?? null,

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

        let backfillClassification:
          string;

        if (candidates.length === 0) {
          backfillClassification =
            "NO_EXECUTED_BUY_CANDIDATE";
        }
        else if (
          candidates.length === 1 &&
          entryOrderId !== null &&
          entryOrderId === s(candidates[0].id)
        ) {
          backfillClassification =
            "SINGLE_MATCHING_BUY_CANDIDATE";
        }
        else {
          backfillClassification =
            "AMBIGUOUS_MULTI_OR_HISTORICAL_BUY_CANDIDATES";
        }

        return {
          positionId,

          accountId:
            s(position.account_id),

          stockCode:
            s(position.stock_code),

          quantity:
            n(position.quantity),

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

          backfillClassification
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
        s(trade.source_position_id);

      if (!sourcePositionId) {
        continue;
      }

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
          Object.prototype.hasOwnProperty.call(
            row,
            "cost_attribution_complete"
          ) &&
          row.cost_attribution_complete !== true
      );

    const schemaObserved = {
      paperPositionsColumns:
        positions.length > 0
          ? Object.keys(positions[0]).sort()
          : [],

      paperOrderRequestColumns:
        buyOrders.length > 0
          ? Object.keys(buyOrders[0]).sort()
          : [],

      paperTradeHistoryColumns:
        trades.length > 0
          ? Object.keys(trades[0]).sort()
          : []
    };

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
        "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_FEE_BASIS_RUNTIME_STATE_AUDIT_V1_2_COMPLETE",

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

      schemaObserved,

      openPositionAnalysis,
      sourcePositionsWithMultipleTrades,

      interpretation: {
        previousV1_1Failure:
          "V1.1 assumed paper_positions.created_at exists. V1.2 uses select=* and performs field access locally, avoiding schema-column guess failures.",

        uniqueConstraint:
          "The structural source audit already confirmed the source_position_id uniqueness gap. This runtime audit only determines whether existing PAPER data requires backfill before repair.",

        feeBasis:
          positions.length === 0
            ? "No open PAPER position requires reconstruction of remaining entry-fee basis."
            : "Open PAPER positions exist and must be classified before position-level entry-fee basis is introduced.",

        history:
          trades.length === 0
            ? "No historical PAPER trade rows need preservation/backfill decisions."
            : "Historical PAPER trade rows exist and should be preserved; this audit does not rewrite them."
      },

      safety: {
        readOnly: true,
        httpMethod: "GET",
        databaseReads: 3,
        databaseWrites: 0,
        rpcInvoked: false,
        ordersCreated: 0,
        ordersExecuted: 0,
        positionsChanged: 0,
        realTradingEnabled: false,
        secretsPrinted: false
      },

      nextGate
    }, null, 2));

    process.exitCode = 0;
  }
  catch (error) {
    console.error(JSON.stringify({
      status:
        "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_FEE_BASIS_RUNTIME_STATE_AUDIT_V1_2_FAILED",

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

void main();
