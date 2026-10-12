export type PaperPnlSource =
  | "NET_PNL_COST_ATTRIBUTED"
  | "LEGACY_REALIZED_PNL";

export interface PaperTradeCostViewInput {
  realized_pnl?: number | string | null;
  realized_return?: number | string | null;

  gross_pnl?: number | string | null;
  net_pnl?: number | string | null;
  net_return?: number | string | null;

  total_transaction_cost?: number | string | null;
  cost_attribution_complete?: boolean | null;
}

export interface CanonicalPaperTradePnl {
  pnl: number;
  grossPnl: number;
  totalTransactionCost: number;
  source: PaperPnlSource;
  costAttributionComplete: boolean;
}

export interface CanonicalPaperTradeReturn {
  value: number;
  source: PaperPnlSource;
}

function toFiniteNumber(
  value: number | string | null | undefined,
): number | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const numeric =
    typeof value === "number"
      ? value
      : Number(value);

  return Number.isFinite(numeric)
    ? numeric
    : null;
}

export function resolveCanonicalPaperTradePnl(
  trade: PaperTradeCostViewInput,
): CanonicalPaperTradePnl {
  const realizedPnl =
    toFiniteNumber(
      trade.realized_pnl,
    ) ?? 0;

  const grossPnl =
    toFiniteNumber(
      trade.gross_pnl,
    ) ??
    realizedPnl;

  const totalTransactionCost =
    Math.max(
      0,
      toFiniteNumber(
        trade.total_transaction_cost,
      ) ?? 0,
    );

  const netPnl =
    toFiniteNumber(
      trade.net_pnl,
    );

  const costAttributionComplete =
    trade.cost_attribution_complete ===
      true &&
    netPnl !== null;

  return {
    pnl:
      costAttributionComplete
        ? netPnl
        : realizedPnl,

    grossPnl,
    totalTransactionCost,

    source:
      costAttributionComplete
        ? "NET_PNL_COST_ATTRIBUTED"
        : "LEGACY_REALIZED_PNL",

    costAttributionComplete,
  };
}

export function resolveCanonicalPaperTradeReturn(
  trade: PaperTradeCostViewInput,
): CanonicalPaperTradeReturn {
  const pnl =
    resolveCanonicalPaperTradePnl(
      trade,
    );

  const realizedReturn =
    toFiniteNumber(
      trade.realized_return,
    ) ?? 0;

  const netReturn =
    toFiniteNumber(
      trade.net_return,
    );

  return {
    value:
      pnl.costAttributionComplete &&
      netReturn !== null
        ? netReturn
        : realizedReturn,

    source:
      pnl.source,
  };
}
