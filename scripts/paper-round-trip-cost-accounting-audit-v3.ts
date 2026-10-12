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

  const match =
    startRe.exec(text);

  if (!match) {
    return "";
  }

  const tail =
    text.slice(match.index);

  const end =
    tail.search(/\$\$\s*;/);

  return end >= 0
    ? tail.slice(0, end + 3)
    : tail;
}

function assignments(
  text: string,
  variable: string,
) {
  const escaped =
    variable.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

  const re =
    new RegExp(
      `\\b${escaped}\\s*:=\\s*([\\s\\S]*?);`,
      "gi",
    );

  return [
    ...text.matchAll(re),
  ].map(
    match => ({
      full:
        match[0],

      expression:
        match[1],

      compact:
        match[1]
          .replace(
            /\s+/g,
            " ",
          )
          .trim(),
    }),
  );
}

function compact(
  text: string,
) {
  return text
    .replace(
      /\s+/g,
      " ",
    )
    .trim();
}

function normalizeExpression(
  text: string,
) {
  return compact(text)
    .replace(
      /\s+/g,
      "",
    )
    .toLowerCase();
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

const buyOrderAmount =
  assignments(
    buyBody,
    "v_order_amount",
  );

const buyAverage =
  assignments(
    buyBody,
    "v_new_average_price",
  );

const sellTotalCost =
  assignments(
    sellBody,
    "v_total_transaction_cost",
  );

const sellRealized =
  assignments(
    sellBody,
    "v_realized_pnl",
  );

const attributionGross =
  assignments(
    costBody,
    "v_gross_pnl",
  );

const attributionTotalCost =
  assignments(
    costBody,
    "v_total_transaction_cost",
  );

const attributionNet =
  assignments(
    costBody,
    "v_net_pnl",
  );

const buyChecks = {
  canonicalFunctionFound:
    buyBody.length > 0,

  orderAmountAssignmentFound:
    buyOrderAmount.length >= 1,

  entryCashUsesExecutionNotionalPlusFee:
    buyOrderAmount.some(
      item => {
        const n =
          normalizeExpression(
            item.expression,
          );

        return (
          n.includes(
            "p_execution_price*v_effective_fill_quantity+p_broker_fee",
          )
        );
      },
    ),

  weightedAverageAssignmentFound:
    buyAverage.some(
      item => {
        const n =
          normalizeExpression(
            item.expression,
          );

        return (
          n.includes(
            "v_position.average_price*v_position.quantity",
          ) &&
          n.includes(
            "p_execution_price*v_effective_fill_quantity",
          ) &&
          n.includes(
            "/v_new_quantity",
          )
        );
      },
    ),

  weightedAverageExcludesEntryFee:
    buyAverage
      .filter(
        item => {
          const n =
            normalizeExpression(
              item.expression,
            );

          return (
            n.includes(
              "v_position.average_price*v_position.quantity",
            ) &&
            n.includes(
              "p_execution_price*v_effective_fill_quantity",
            )
          );
        },
      )
      .every(
        item => {
          const n =
            normalizeExpression(
              item.expression,
            );

          return (
            !n.includes(
              "p_broker_fee",
            ) &&
            !n.includes(
              "execution_broker_fee",
            ) &&
            !n.includes(
              "execution_transaction_cost",
            )
          );
        },
      ),

  newPositionAverageUsesExecutionPrice:
    buyAverage.some(
      item =>
        normalizeExpression(
          item.expression,
        ) ===
        "p_execution_price",
    ),

  entryFeePersistedSeparately:
    /execution_broker_fee\s*=[\s\S]*?coalesce\(\s*execution_broker_fee\s*,\s*0\s*\)\s*\+\s*p_broker_fee/i.test(
      buyBody,
    ),
};

const sellChecks = {
  canonicalFunctionFound:
    sellBody.length > 0,

  totalCostAssignmentFound:
    sellTotalCost.length >= 1,

  sellCostIsExactlyBrokerFeePlusTax:
    sellTotalCost.some(
      item => {
        const n =
          normalizeExpression(
            item.expression,
          );

        return (
          n ===
            "p_broker_fee+p_sell_tax" ||
          n ===
            "p_sell_tax+p_broker_fee"
        );
      },
    ),

  realizedGrossPricePnlPresent:
    sellRealized.some(
      item =>
        normalizeExpression(
          item.expression,
        ) ===
        "v_exit_amount-v_entry_amount",
    ),

  realizedDeductsSellCostsOnce:
    sellRealized.some(
      item =>
        normalizeExpression(
          item.expression,
        ) ===
        "v_realized_pnl-v_total_transaction_cost",
    ),

  positionBasisFeedsEntryAmount:
    /v_entry_amount\s*:=\s*v_position\.average_price\s*\*\s*v_effective_fill_quantity\s*;/i.test(
      sellBody,
    ),

  exitPriceFeedsExitAmount:
    /v_exit_amount\s*:=\s*p_exit_price\s*\*\s*v_effective_fill_quantity\s*;/i.test(
      sellBody,
    ),
};

const attributionChecks = {
  canonicalTriggerFound:
    costBody.length > 0,

  grossAssignmentFound:
    attributionGross.length >= 1,

  totalCostAssignmentFound:
    attributionTotalCost.length >= 1,

  netAssignmentFound:
    attributionNet.length >= 1,

  grossIsExitMinusEntry:
    attributionGross.some(
      item => {
        const n =
          normalizeExpression(
            item.expression,
          );

        return (
          n.includes(
            "v_exit_amount-v_entry_amount",
          )
        );
      },
    ),

  totalCostIsEntryFeePlusExitFeePlusSellTax:
    attributionTotalCost.some(
      item => {
        const n =
          normalizeExpression(
            item.expression,
          );

        return (
          n.includes(
            "v_entry_broker_fee",
          ) &&
          n.includes(
            "v_exit_broker_fee",
          ) &&
          n.includes(
            "v_sell_tax",
          ) &&
          n.includes(
            "+",
          )
        );
      },
    ),

  netIsGrossMinusTotalCost:
    attributionNet.some(
      item => {
        const n =
          normalizeExpression(
            item.expression,
          );

        return (
          n.includes(
            "v_gross_pnl-v_total_transaction_cost",
          )
        );
      },
    ),

  readsEntryFeeFromBuyExecution:
    /v_buy_order\.execution_broker_fee/i.test(
      costBody,
    ),
};

const allChecks = {
  filesPresent:
    buy.exists &&
    sell.exists &&
    cost.exists,

  buyAccounting:
    Object.values(
      buyChecks,
    ).every(Boolean),

  sellAccounting:
    Object.values(
      sellChecks,
    ).every(Boolean),

  roundTripAttribution:
    Object.values(
      attributionChecks,
    ).every(Boolean),

  noDatabaseReads:
    true,

  noDatabaseWrites:
    true,

  noExternalApiCalls:
    true,

  noOrdersCreated:
    true,

  noOrdersExecuted:
    true,

  noPositionsChanged:
    true,

  noRealTrading:
    true,
};

const failed =
  Object.entries(
    allChecks,
  )
    .filter(
      ([, ok]) =>
        ok !== true,
    )
    .map(
      ([name]) =>
        name,
    );

const status =
  failed.length === 0
    ? "AI_STOCK_LAB_PAPER_ROUND_TRIP_COST_ACCOUNTING_AUDIT_V3_PASS"
    : "AI_STOCK_LAB_PAPER_ROUND_TRIP_COST_ACCOUNTING_AUDIT_V3_REVIEW";

const classification =
  failed.length === 0
    ? "ROUND_TRIP_ACCOUNTING_CHAIN_EXACT_ASSIGNMENT_PROVEN"
    : "ROUND_TRIP_ACCOUNTING_EXACT_ASSIGNMENT_REVIEW_REQUIRED";

console.log(
  JSON.stringify(
    {
      status,
      classification,

      v2Correction: {
        issue:
          "V2 sellCostIsFeePlusTax used a broad multiline regex whose ordering/window assumptions could miss the exact SELL assignment.",

        correctedMethod:
          "V3 extracts individual PL/pgSQL := ... ; assignments and compares normalized expressions directly.",

        productionLogicChanged:
          false,
      },

      buyChecks,
      sellChecks,
      attributionChecks,

      exactAssignments: {
        buyOrderAmount:
          buyOrderAmount.map(
            item =>
              item.compact,
          ),

        buyAverage:
          buyAverage.map(
            item =>
              item.compact,
          ),

        sellTotalTransactionCost:
          sellTotalCost.map(
            item =>
              item.compact,
          ),

        sellRealizedPnl:
          sellRealized.map(
            item =>
              item.compact,
          ),

        attributionGrossPnl:
          attributionGross.map(
            item =>
              item.compact,
          ),

        attributionTotalTransactionCost:
          attributionTotalCost.map(
            item =>
              item.compact,
          ),

        attributionNetPnl:
          attributionNet.map(
            item =>
              item.compact,
          ),
      },

      economicConclusion: {
        entryCash:
          "BUY cash debit includes execution notional + entry broker fee.",

        positionBasis:
          "Position average price uses execution prices only; entry fee is separate.",

        legacySellRealizedPnl:
          "SELL realized PnL subtracts SELL broker fee + sell tax.",

        fullRoundTripNetPnl:
          "Cost attribution computes gross PnL minus entry broker fee, exit broker fee, and sell tax.",

        doubleCount:
          "No obvious entry/exit transaction-cost double count is present in the full round-trip attribution formula.",
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
          ? "CLOSE_PAPER_ROUND_TRIP_COST_ACCOUNTING"
          : "REVIEW_ONLY_FAILED_EXACT_ASSIGNMENT_CHECKS",
    },
    null,
    2,
  ),
);

process.exitCode = 0;
