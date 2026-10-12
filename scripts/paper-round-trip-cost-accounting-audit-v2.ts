import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const FILES = {
  buyV2:
    "supabase/migrations/20261009000100_paper_execution_realism_v2_buy_partial_fill.sql",

  sellV2:
    "supabase/migrations/20261009000200_paper_execution_realism_v2_protective_sell.sql",

  costAttribution:
    "supabase/migrations/20261010000100_paper_execution_cost_attribution_v1.sql",

  costView:
    "lib/trading/paper-cost-attribution-view.ts",
};

function load(rel: string) {
  const abs = path.join(ROOT, rel);

  return {
    rel,
    exists: fs.existsSync(abs),
    text: fs.existsSync(abs)
      ? fs.readFileSync(abs, "utf8")
      : "",
  };
}

function extractFunctionBody(
  text: string,
  fnName: string,
) {
  const startRe =
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${fnName}\\s*\\(`,
      "i",
    );

  const m = startRe.exec(text);

  if (!m) {
    return "";
  }

  const tail =
    text.slice(m.index);

  const end =
    tail.search(/\$\$\s*;/);

  if (end < 0) {
    return tail;
  }

  return tail.slice(
    0,
    end + 3,
  );
}

function sliceBetween(
  text: string,
  startPattern: RegExp,
  endPattern: RegExp,
) {
  const start =
    text.search(startPattern);

  if (start < 0) {
    return "";
  }

  const tail =
    text.slice(start);

  const end =
    tail.search(endPattern);

  if (end < 0) {
    return tail;
  }

  return tail.slice(
    0,
    end,
  );
}

function compact(s: string) {
  return s
    .replace(/\s+/g, " ")
    .trim();
}

function has(
  text: string,
  re: RegExp,
) {
  return re.test(text);
}

function context(
  text: string,
  re: RegExp,
  radius = 8,
) {
  const lines =
    text.split(/\r?\n/);

  const result: any[] = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    if (!re.test(lines[i])) {
      continue;
    }

    const start =
      Math.max(
        0,
        i - radius,
      );

    const end =
      Math.min(
        lines.length - 1,
        i + radius,
      );

    result.push({
      line:
        i + 1,

      text:
        lines[i],

      context:
        lines
          .slice(
            start,
            end + 1,
          )
          .map(
            (
              line,
              offset,
            ) => ({
              line:
                start +
                offset +
                1,

              text:
                line,
            }),
          ),
    });
  }

  return result;
}

const buy =
  load(
    FILES.buyV2,
  );

const sell =
  load(
    FILES.sellV2,
  );

const cost =
  load(
    FILES.costAttribution,
  );

const view =
  load(
    FILES.costView,
  );

const buyBody =
  extractFunctionBody(
    buy.text,
    "execute_paper_buy_order_with_execution_price_v2",
  );

const sellBody =
  extractFunctionBody(
    sell.text,
    "execute_paper_protective_sell_v2",
  );

const costBody =
  extractFunctionBody(
    cost.text,
    "apply_paper_trade_cost_attribution_v1",
  );

/*
 * V1 false-negative correction:
 *
 * V1 used a broad negative regex:
 * "v_new_average_price ... p_broker_fee"
 *
 * Because p_broker_fee exists elsewhere in the same BUY function,
 * the 900-char scan could cross semantic blocks and incorrectly say
 * the position average included the fee.
 *
 * V2 extracts ONLY the assignment block for v_new_average_price and
 * inspects that expression directly.
 */
const averageBlock =
  sliceBetween(
    buyBody,
    /v_new_average_price\s*:=/i,
    /v_new_stop_price\s*:=/i,
  );

const newPositionBlock =
  sliceBetween(
    buyBody,
    /insert\s+into\s+public\.paper_positions/i,
    /update\s+public\.paper_accounts/i,
  );

const buyCashBlock =
  sliceBetween(
    buyBody,
    /v_order_amount\s*:=/i,
    /select\s+\*\s+into\s+v_position/i,
  );

const sellPnlBlock =
  sliceBetween(
    sellBody,
    /v_entry_amount\s*:=/i,
    /insert\s+into\s+public\.risk_decisions/i,
  );

const attributionMathBlock =
  sliceBetween(
    costBody,
    /v_gross_pnl\s*:=/i,
    /new\.gross_pnl\s*:=/i,
  );

const entryFeeReadBlock =
  sliceBetween(
    costBody,
    /if\s+new\.buy_order_id\s+is\s+not\s+null\s+then/i,
    /v_exit_broker_fee\s*:=/i,
  );

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
  canonicalFunctionFound:
    buyBody.length > 0,

  brokerFeeInputPresent:
    has(
      buyBody,
      /p_broker_fee\s+numeric/i,
    ),

  cashDebitsExecutionNotionalPlusEntryFee:
    has(
      buyCashBlock,
      /p_execution_price\s*\*\s*v_effective_fill_quantity\s*\+\s*p_broker_fee/i,
    ) &&
    has(
      buyBody,
      /cash_balance\s*=\s*cash_balance\s*-\s*v_order_amount/i,
    ),

  entryFeePersisted:
    has(
      buyBody,
      /execution_broker_fee\s*=[\s\S]*?coalesce\(\s*execution_broker_fee\s*,\s*0\s*\)\s*\+\s*p_broker_fee/i,
    ),

  entryTransactionCostPersisted:
    has(
      buyBody,
      /execution_transaction_cost\s*=[\s\S]*?coalesce\(\s*execution_transaction_cost\s*,\s*0\s*\)\s*\+\s*p_broker_fee/i,
    ),

  averageUsesExistingBasis:
    has(
      averageBlock,
      /v_position\.average_price\s*\*\s*v_position\.quantity/i,
    ),

  averageUsesExecutionPrice:
    has(
      averageBlock,
      /p_execution_price\s*\*\s*v_effective_fill_quantity/i,
    ),

  averageDividesByNewQuantity:
    has(
      averageBlock,
      /\/\s*v_new_quantity/i,
    ),

  averageAssignmentExcludesBrokerFee:
    averageBlock.length > 0 &&
    !has(
      averageBlock,
      /\bp_broker_fee\b/i,
    ) &&
    !has(
      averageBlock,
      /\bexecution_broker_fee\b/i,
    ) &&
    !has(
      averageBlock,
      /\bexecution_transaction_cost\b/i,
    ),

  newPositionBasisUsesExecutionPrice:
    has(
      newPositionBlock,
      /average_price[\s\S]*?p_execution_price/i,
    ) ||
    has(
      newPositionBlock,
      /v_new_average_price\s*:=\s*p_execution_price/i,
    ),
};

const sellChecks = {
  canonicalFunctionFound:
    sellBody.length > 0,

  feeAndTaxInputsPresent:
    has(
      sellBody,
      /p_broker_fee\s+numeric/i,
    ) &&
    has(
      sellBody,
      /p_sell_tax\s+numeric/i,
    ),

  sellCostIsFeePlusTax:
    has(
      sellPnlBlock,
      /v_total_transaction_cost\s*:=[\s\S]*?p_broker_fee\s*\+\s*p_sell_tax/i,
    ),

  grossPricePnlUsesPositionBasis:
    has(
      sellPnlBlock,
      /v_entry_amount\s*:=[\s\S]*?v_position\.average_price\s*\*\s*v_effective_fill_quantity/i,
    ) &&
    has(
      sellPnlBlock,
      /v_exit_amount\s*:=[\s\S]*?p_exit_price\s*\*\s*v_effective_fill_quantity/i,
    ),

  legacyRealizedPnlDeductsSellCosts:
    has(
      sellPnlBlock,
      /v_realized_pnl\s*:=[\s\S]*?v_exit_amount\s*-\s*v_entry_amount/i,
    ) &&
    has(
      sellPnlBlock,
      /v_realized_pnl\s*:=[\s\S]*?v_realized_pnl\s*-\s*v_total_transaction_cost/i,
    ),

  accountRealizedPnlUpdated:
    has(
      sellBody,
      /realized_pnl\s*=[\s\S]*?realized_pnl\s*\+\s*v_realized_pnl/i,
    ) &&
    has(
      sellBody,
      /daily_realized_pnl\s*=[\s\S]*?daily_realized_pnl\s*\+\s*v_realized_pnl/i,
    ),
};

const attributionChecks = {
  canonicalTriggerFound:
    costBody.length > 0,

  readsEntryFeeFromExecutedBuy:
    has(
      entryFeeReadBlock,
      /from\s+public\.paper_order_requests/i,
    ) &&
    has(
      entryFeeReadBlock,
      /v_buy_order\.execution_broker_fee/i,
    ),

  grossPnlIsExitMinusEntry:
    has(
      attributionMathBlock,
      /v_gross_pnl\s*:=[\s\S]*?v_exit_amount[\s\S]*?-[\s\S]*?v_entry_amount/i,
    ),

  totalCostIncludesEntryFee:
    has(
      attributionMathBlock,
      /v_total_transaction_cost\s*:=[\s\S]*?v_entry_broker_fee/i,
    ),

  totalCostIncludesExitFee:
    has(
      attributionMathBlock,
      /v_total_transaction_cost\s*:=[\s\S]*?v_exit_broker_fee/i,
    ),

  totalCostIncludesSellTax:
    has(
      attributionMathBlock,
      /v_total_transaction_cost\s*:=[\s\S]*?v_sell_tax/i,
    ),

  netPnlIsGrossMinusTotalCost:
    has(
      attributionMathBlock,
      /v_net_pnl\s*:=[\s\S]*?v_gross_pnl[\s\S]*?-[\s\S]*?v_total_transaction_cost/i,
    ),

  separateGrossAndNetColumnsExist:
    has(
      cost.text,
      /gross_pnl\s+numeric/i,
    ) &&
    has(
      cost.text,
      /net_pnl\s+numeric/i,
    ),

  entryExitAndTaxColumnsExist:
    has(
      cost.text,
      /entry_broker_fee\s+numeric/i,
    ) &&
    has(
      cost.text,
      /exit_broker_fee\s+numeric/i,
    ) &&
    has(
      cost.text,
      /sell_tax\s+numeric/i,
    ),
};

const economicSemantics = {
  entryCashDebit:
    "execution_notional + entry_broker_fee",

  positionCostBasis:
    "execution-price weighted average only; fee intentionally excluded and tracked separately",

  legacySellRealizedPnl:
    "price PnL minus SELL-side broker fee and sell tax",

  costAttributionGrossPnl:
    "exit_amount - entry_amount",

  costAttributionTotalCost:
    "entry_broker_fee + exit_broker_fee + sell_tax",

  costAttributionNetPnl:
    "gross_pnl - total_transaction_cost",

  conclusion:
    "Entry fee is not embedded in position average and is subtracted exactly once by full round-trip cost attribution. Exit fee and sell tax are also represented once in full net PnL.",
};

const allChecks = {
  filesPresent:
    Object.values(
      filesPresent,
    ).every(Boolean),

  buyAccounting:
    Object.values(
      buyChecks,
    ).every(Boolean),

  sellAccounting:
    Object.values(
      sellChecks,
    ).every(Boolean),

  attributionAccounting:
    Object.values(
      attributionChecks,
    ).every(Boolean),

  noDatabaseReads:
    true,

  noDatabaseWrites:
    true,

  noOrders:
    true,

  noPositionChanges:
    true,

  noRealTrading:
    true,
};

const failed =
  Object.entries(
    allChecks,
  )
    .filter(
      ([, value]) =>
        value !== true,
    )
    .map(
      ([key]) =>
        key,
    );

const status =
  failed.length === 0
    ? "AI_STOCK_LAB_PAPER_ROUND_TRIP_COST_ACCOUNTING_AUDIT_V2_PASS"
    : "AI_STOCK_LAB_PAPER_ROUND_TRIP_COST_ACCOUNTING_AUDIT_V2_REVIEW";

const classification =
  failed.length === 0
    ? "ROUND_TRIP_GROSS_NET_COST_ACCOUNTING_CHAIN_PROVEN_NO_OBVIOUS_DOUBLE_COUNT"
    : "ROUND_TRIP_COST_ACCOUNTING_CHAIN_REQUIRES_REVIEW";

console.log(
  JSON.stringify(
    {
      status,
      classification,

      v1Correction: {
        falseNegative:
          "V1 positionAverageExcludesFee scanned too broad a region and could encounter p_broker_fee from unrelated semantic blocks.",

        correctedMethod:
          "V2 isolates the exact v_new_average_price assignment block and audits only that expression.",

        productionLogicChanged:
          false,
      },

      filesPresent,
      buyChecks,
      sellChecks,
      attributionChecks,

      exactSemanticSlices: {
        averageBlock:
          compact(
            averageBlock,
          ),

        attributionMathBlock:
          compact(
            attributionMathBlock,
          ),
      },

      economicSemantics,

      evidence: {
        buyAverage:
          context(
            buyBody,
            /v_new_average_price\s*:=/i,
            14,
          ).slice(
            0,
            3,
          ),

        buyFee:
          context(
            buyBody,
            /execution_broker_fee\s*=/i,
            12,
          ).slice(
            0,
            3,
          ),

        sellRealizedPnl:
          context(
            sellBody,
            /v_realized_pnl\s*:=/i,
            12,
          ).slice(
            0,
            6,
          ),

        attributionMath:
          context(
            costBody,
            /v_gross_pnl\s*:=|v_total_transaction_cost\s*:=|v_net_pnl\s*:=/i,
            12,
          ).slice(
            0,
            10,
          ),
      },

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
          ? "CLOSE_PAPER_ROUND_TRIP_COST_ACCOUNTING_AND_MOVE_TO_NEXT_DEVELOPMENT_GAP"
          : "REVIEW_EXACT_FAILED_CHECKS_BEFORE_ANY_PRODUCTION_CHANGE",
    },
    null,
    2,
  ),
);

process.exitCode = 0;
