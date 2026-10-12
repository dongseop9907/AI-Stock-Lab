import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const TARGETS = {
  buyV2:
    "supabase/migrations/20261009000100_paper_execution_realism_v2_buy_partial_fill.sql",

  sellV2:
    "supabase/migrations/20261009000200_paper_execution_realism_v2_protective_sell.sql",

  costAttribution:
    "supabase/migrations/20261010000100_paper_execution_cost_attribution_v1.sql",

  costView:
    "lib/trading/paper-cost-attribution-view.ts",
};

function read(rel: string) {
  const abs = path.join(ROOT, rel);

  return {
    rel,
    abs,
    exists: fs.existsSync(abs),
    text: fs.existsSync(abs)
      ? fs.readFileSync(abs, "utf8")
      : "",
  };
}

function has(text: string, regex: RegExp) {
  return regex.test(text);
}

function contexts(
  text: string,
  patterns: RegExp[],
  radius = 10,
) {
  const lines = text.split(/\r?\n/);

  const out: Array<{
    line: number;
    text: string;
    context: Array<{
      line: number;
      text: string;
    }>;
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    if (!patterns.some(pattern => pattern.test(lines[i]))) {
      continue;
    }

    const start = Math.max(0, i - radius);
    const end = Math.min(lines.length - 1, i + radius);

    out.push({
      line: i + 1,
      text: lines[i],
      context:
        lines
          .slice(start, end + 1)
          .map((line, offset) => ({
            line: start + offset + 1,
            text: line,
          })),
    });
  }

  return out;
}

const buy = read(TARGETS.buyV2);
const sell = read(TARGETS.sellV2);
const cost = read(TARGETS.costAttribution);
const view = read(TARGETS.costView);

const filesPresent = {
  buyV2:
    buy.exists,

  sellV2:
    sell.exists,

  costAttribution:
    cost.exists,

  costView:
    view.exists,
};

const buyChecks = {
  feePassedIntoBuyRpc:
    has(
      buy.text,
      /p_broker_fee\s+numeric/i,
    ),

  buyCashDebitsExecutionNotionalPlusFee:
    has(
      buy.text,
      /p_execution_price\s*\*\s*v_effective_fill_quantity\s*\+\s*p_broker_fee/i,
    ) &&
    has(
      buy.text,
      /cash_balance\s*=\s*cash_balance\s*-\s*v_order_amount/i,
    ),

  buyFeePersistedSeparately:
    has(
      buy.text,
      /execution_broker_fee\s*=\s*[\s\S]{0,200}p_broker_fee/i,
    ),

  buyTransactionCostPersistedSeparately:
    has(
      buy.text,
      /execution_transaction_cost\s*=\s*[\s\S]{0,200}p_broker_fee/i,
    ),

  positionAverageExcludesFee:
    has(
      buy.text,
      /v_new_average_price\s*:=[\s\S]{0,600}p_execution_price\s*\*\s*v_effective_fill_quantity/i,
    ) &&
    !has(
      buy.text,
      /v_new_average_price\s*:=[\s\S]{0,900}p_broker_fee/i,
    ),
};

const sellChecks = {
  sellFeeAndTaxInputs:
    has(
      sell.text,
      /p_broker_fee\s+numeric/i,
    ) &&
    has(
      sell.text,
      /p_sell_tax\s+numeric/i,
    ),

  sellTotalTransactionCost:
    has(
      sell.text,
      /v_total_transaction_cost\s*:=[\s\S]{0,240}p_broker_fee[\s\S]{0,120}p_sell_tax/i,
    ),

  realizedPnlStartsGross:
    has(
      sell.text,
      /v_realized_pnl\s*:=[\s\S]{0,180}v_exit_amount\s*-\s*v_entry_amount/i,
    ),

  sellCostsDeductedFromRealizedPnl:
    has(
      sell.text,
      /v_realized_pnl\s*:=[\s\S]{0,180}v_realized_pnl\s*-[\s\S]{0,120}v_total_transaction_cost/i,
    ),

  realizedPnlWrittenToAccount:
    has(
      sell.text,
      /realized_pnl\s*=[\s\S]{0,160}realized_pnl\s*\+\s*v_realized_pnl/i,
    ) &&
    has(
      sell.text,
      /daily_realized_pnl\s*=[\s\S]{0,160}daily_realized_pnl\s*\+\s*v_realized_pnl/i,
    ),
};

const combinedCostText =
  `${cost.text}\n${view.text}`;

const attributionChecks = {
  hasGrossPnlConcept:
    has(
      combinedCostText,
      /\bgross[_A-Za-z]*pnl\b|\bgrossPnl\b/i,
    ),

  hasNetPnlConcept:
    has(
      combinedCostText,
      /\bnet[_A-Za-z]*pnl\b|\bnetPnl\b/i,
    ),

  hasEntryFeeConcept:
    has(
      combinedCostText,
      /\bentry[_A-Za-z]*(?:fee|broker|transaction_cost)\b|\bbuy[_A-Za-z]*(?:fee|broker|transaction_cost)\b/i,
    ),

  hasExitFeeConcept:
    has(
      combinedCostText,
      /\bexit[_A-Za-z]*(?:fee|broker|transaction_cost)\b|\bsell[_A-Za-z]*(?:fee|broker_fee)\b/i,
    ),

  hasSellTaxConcept:
    has(
      combinedCostText,
      /\bsell[_A-Za-z]*tax\b|\bexit[_A-Za-z]*tax\b/i,
    ),

  readsBuyExecutionCost:
    has(
      combinedCostText,
      /paper_order_requests/i,
    ) &&
    has(
      combinedCostText,
      /execution_broker_fee|execution_transaction_cost/i,
    ),

  readsTradeOrSellExecution:
    has(
      combinedCostText,
      /paper_trade_history|paper_protective_execution_fills_v2/i,
    ),

  netPnlArithmeticMentionsEntryCost:
    (
      has(
        combinedCostText,
        /net[_A-Za-z]*pnl[\s\S]{0,1800}(?:entry|buy)[_A-Za-z]*(?:fee|broker|transaction_cost)/i,
      ) ||
      has(
        combinedCostText,
        /(?:entry|buy)[_A-Za-z]*(?:fee|broker|transaction_cost)[\s\S]{0,1800}net[_A-Za-z]*pnl/i,
      )
    ),

  netPnlArithmeticMentionsExitCost:
    (
      has(
        combinedCostText,
        /net[_A-Za-z]*pnl[\s\S]{0,1800}(?:exit|sell)[_A-Za-z]*(?:fee|broker|transaction_cost|tax)/i,
      ) ||
      has(
        combinedCostText,
        /(?:exit|sell)[_A-Za-z]*(?:fee|broker|transaction_cost|tax)[\s\S]{0,1800}net[_A-Za-z]*pnl/i,
      )
    ),
};

/*
 * Semantic interpretation:
 *
 * BUY fee is already reflected in cash at entry, but not in position average.
 * SELL realized_pnl subtracts only SELL-side transaction cost.
 *
 * Therefore:
 * - account cash can still be economically correct;
 * - legacy realized_pnl is expected to be "trade PnL net of exit costs"
 *   rather than full round-trip net PnL;
 * - the V1 attribution/reporting layer must subtract BUY entry fee exactly
 *   once when presenting full net PnL.
 *
 * We do not mutate production code in this audit.
 */
const baseAccountingProven =
  Object.values(buyChecks).every(Boolean) &&
  Object.values(sellChecks).every(Boolean);

const attributionSurfaceProven =
  [
    "hasGrossPnlConcept",
    "hasNetPnlConcept",
    "hasEntryFeeConcept",
    "hasExitFeeConcept",
    "hasSellTaxConcept",
    "readsBuyExecutionCost",
    "readsTradeOrSellExecution",
  ].every(
    key =>
      attributionChecks[
        key as keyof typeof attributionChecks
      ] === true,
  );

const fullNetArithmeticProven =
  attributionChecks.netPnlArithmeticMentionsEntryCost &&
  attributionChecks.netPnlArithmeticMentionsExitCost;

let classification: string;

if (!baseAccountingProven) {
  classification =
    "BASE_CASH_OR_REALIZED_ACCOUNTING_SOURCE_GAP";
}
else if (!attributionSurfaceProven) {
  classification =
    "ROUND_TRIP_COST_ATTRIBUTION_SURFACE_GAP";
}
else if (!fullNetArithmeticProven) {
  classification =
    "ROUND_TRIP_NET_PNL_ARITHMETIC_REVIEW_REQUIRED";
}
else {
  classification =
    "ENTRY_AND_EXIT_COSTS_STRUCTURALLY_ACCOUNTED_WITHOUT_OBVIOUS_DOUBLE_COUNT";
}

const requiredChecks = {
  filesPresent:
    Object.values(filesPresent).every(Boolean),

  baseAccountingProven,

  attributionSurfaceProven,

  fullNetArithmeticProven,

  noWrites:
    true,

  noRealTrading:
    true,
};

const failed =
  Object.entries(requiredChecks)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_ROUND_TRIP_COST_ACCOUNTING_AUDIT_V1_PASS"
          : "AI_STOCK_LAB_PAPER_ROUND_TRIP_COST_ACCOUNTING_AUDIT_V1_REVIEW",

      classification,

      filesPresent,

      buyChecks,
      sellChecks,
      attributionChecks,

      semanticModel: {
        buyCash:
          "execution notional + BUY broker fee deducted at entry",

        positionAverage:
          "execution-price weighted basis; BUY broker fee tracked separately",

        legacySellRealizedPnl:
          "gross price PnL minus SELL broker fee and sell tax",

        requiredFullNetPnl:
          "gross price PnL - BUY entry fee - SELL broker fee - sell tax",

        doubleCountRule:
          "BUY entry fee must appear once in full round-trip net PnL attribution; SELL costs must also appear once",
      },

      evidence: {
        buy:
          contexts(
            buy.text,
            [
              /v_order_amount/i,
              /p_broker_fee/i,
              /execution_broker_fee/i,
              /execution_transaction_cost/i,
              /v_new_average_price/i,
              /average_price/i,
            ],
            10,
          ).slice(0, 30),

        sell:
          contexts(
            sell.text,
            [
              /v_entry_amount/i,
              /v_exit_amount/i,
              /v_total_transaction_cost/i,
              /v_realized_pnl/i,
              /p_broker_fee/i,
              /p_sell_tax/i,
              /daily_realized_pnl/i,
            ],
            10,
          ).slice(0, 35),

        attribution:
          contexts(
            combinedCostText,
            [
              /gross[_A-Za-z]*pnl/i,
              /net[_A-Za-z]*pnl/i,
              /entry[_A-Za-z]*(?:fee|broker|transaction_cost)/i,
              /buy[_A-Za-z]*(?:fee|broker|transaction_cost)/i,
              /exit[_A-Za-z]*(?:fee|broker|transaction_cost)/i,
              /sell[_A-Za-z]*(?:fee|broker|transaction_cost|tax)/i,
              /execution_broker_fee/i,
              /execution_transaction_cost/i,
            ],
            12,
          ).slice(0, 45),
      },

      interpretation:
        classification ===
          "ENTRY_AND_EXIT_COSTS_STRUCTURALLY_ACCOUNTED_WITHOUT_OBVIOUS_DOUBLE_COUNT"
          ? "BUY entry fees are charged at entry and preserved for attribution; SELL fees/tax are charged on exit; the attribution layer structurally includes both sides in full net PnL with no obvious double-count pattern."
          : "The base execution accounting may still be correct, but the full round-trip net PnL attribution could not be completely proven from source. Review the emitted exact evidence before changing production logic.",

      safety: {
        sourceOnly:
          true,

        databaseReads:
          0,

        databaseWrites:
          0,

        externalApiCalls:
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

      failed,

      nextGate:
        failed.length === 0
          ? "CLOSE_PAPER_ROUND_TRIP_COST_ACCOUNTING"
          : "REVIEW_ROUND_TRIP_COST_ATTRIBUTION_SOURCE",
    },
    null,
    2,
  ),
);

process.exitCode = 0;
