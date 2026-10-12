import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const FILES = {
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

function normalized(text: string) {
  return text
    .replace(/\s+/g, "")
    .toLowerCase();
}

function context(
  text: string,
  patterns: RegExp[],
  radius = 12,
) {
  const lines = text.split(/\r?\n/);
  const out: any[] = [];

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

const sell = load(FILES.sellV2);
const cost = load(FILES.costAttribution);

if (!sell.exists || !cost.exists) {
  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_ENTRY_FEE_ALLOCATION_AUDIT_V1_FAIL",

        reason:
          "SOURCE_FILE_NOT_FOUND",

        files: {
          sellV2:
            sell.exists,

          costAttribution:
            cost.exists,
        },

        safety: {
          sourceOnly: true,
          databaseReads: 0,
          databaseWrites: 0,
          externalApiCalls: 0,
          ordersCreated: 0,
          ordersExecuted: 0,
          positionsChanged: 0,
          realTradingEnabled: false,
        },
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
}
else {
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

  const entryFeeAssignments =
    assignments(
      costBody,
      "v_entry_broker_fee",
    );

  const entryExecutionValueAssignments =
    assignments(
      costBody,
      "v_entry_execution_value",
    );

  const totalCostAssignments =
    assignments(
      costBody,
      "v_total_transaction_cost",
    );

  const sellChecks = {
    canonicalSellFound:
      sellBody.length > 0,

    supportsExplicitFillQuantity:
      /p_fill_quantity\s+integer\s+default\s+null/i.test(
        sellBody,
      ),

    effectiveFillQuantityExists:
      /v_effective_fill_quantity/i.test(
        sellBody,
      ),

    partialExitCanLeavePositionOpen:
      (
        /v_effective_fill_quantity\s*<\s*v_position\.quantity/i.test(
          sellBody,
        ) ||
        /v_position\.quantity\s*-\s*v_effective_fill_quantity/i.test(
          sellBody,
        ) ||
        /quantity\s*=\s*quantity\s*-\s*v_effective_fill_quantity/i.test(
          sellBody,
        )
      ),

    writesTradeHistory:
      /insert\s+into\s+public\.paper_trade_history/i.test(
        sellBody,
      ),

    tradeHistoryUsesEffectiveFillQuantity:
      (
        /paper_trade_history[\s\S]{0,4000}v_effective_fill_quantity/i.test(
          sellBody,
        )
      ),
  };

  const entryFeeAssignmentTexts =
    entryFeeAssignments.map(
      item =>
        normalized(
          item.expression,
        ),
    );

  const allocationChecks = {
    readsBuyOrder:
      /from\s+public\.paper_order_requests/i.test(
        costBody,
      ) &&
      /new\.buy_order_id/i.test(
        costBody,
      ),

    readsFullBuyExecutionFee:
      /v_buy_order\.execution_broker_fee/i.test(
        costBody,
      ),

    entryFeeAssignmentFound:
      entryFeeAssignments.length > 0,

    fullFeeAssignmentDetected:
      entryFeeAssignmentTexts.some(
        expr =>
          expr.includes(
            "v_buy_order.execution_broker_fee",
          ),
      ),

    tradeQuantityAvailable:
      /new\.quantity/i.test(
        costBody,
      ),

    buyFilledQuantityAvailable:
      /v_buy_order\.filled_quantity/i.test(
        costBody,
      ),

    entryFeeProratedByQuantity:
      entryFeeAssignments.some(
        item => {
          const n =
            normalized(
              item.expression,
            );

          return (
            (
              n.includes(
                "new.quantity",
              ) &&
              n.includes(
                "v_buy_order.filled_quantity",
              )
            ) ||
            (
              n.includes(
                "new.quantity",
              ) &&
              n.includes(
                "v_entry_execution_value",
              )
            )
          );
        },
      ) ||
      /v_entry_broker_fee\s*:=[\s\S]{0,1200}new\.quantity[\s\S]{0,1200}v_buy_order\.filled_quantity/i.test(
        costBody,
      ),

    laterEntryFeeScalingDetected:
      /v_entry_broker_fee\s*:=\s*v_entry_broker_fee\s*\*/i.test(
        costBody,
      ) ||
      /v_entry_broker_fee\s*:=\s*round\([\s\S]{0,800}new\.quantity/i.test(
        costBody,
      ),

    totalCostConsumesEntryFee:
      totalCostAssignments.some(
        item =>
          normalized(
            item.expression,
          ).includes(
            "v_entry_broker_fee",
          ),
      ),
  };

  const partialExitSupported =
    sellChecks.supportsExplicitFillQuantity &&
    sellChecks.effectiveFillQuantityExists &&
    sellChecks.partialExitCanLeavePositionOpen &&
    sellChecks.writesTradeHistory &&
    sellChecks.tradeHistoryUsesEffectiveFillQuantity;

  const fullEntryFeePerTradeRow =
    allocationChecks.readsFullBuyExecutionFee &&
    allocationChecks.fullFeeAssignmentDetected &&
    allocationChecks.totalCostConsumesEntryFee;

  const hasProration =
    allocationChecks.entryFeeProratedByQuantity ||
    allocationChecks.laterEntryFeeScalingDetected;

  let classification: string;
  let interpretation: string;

  if (
    partialExitSupported &&
    fullEntryFeePerTradeRow &&
    !hasProration
  ) {
    classification =
      "PARTIAL_EXIT_ENTRY_FEE_DOUBLE_COUNT_RISK_CONFIRMED";

    interpretation =
      "Protective SELL supports partial exits and creates trade-history rows per executed quantity, while cost attribution appears to load the full BUY execution broker fee into each trade row without quantity proration. Multiple partial exits linked to the same BUY order can therefore over-attribute entry fees in summed net PnL.";
  }
  else if (
    partialExitSupported &&
    hasProration
  ) {
    classification =
      "PARTIAL_EXIT_ENTRY_FEE_PRORATION_STRUCTURALLY_PROVEN";

    interpretation =
      "Partial exits are supported and the source contains an entry-fee allocation mechanism tied to trade quantity, so repeated full entry-fee attribution was not detected.";
  }
  else {
    classification =
      "PARTIAL_EXIT_ENTRY_FEE_ALLOCATION_INCONCLUSIVE";

    interpretation =
      "The exact combination of partial-exit behavior and entry-fee allocation could not be proven from source. Review the emitted evidence before modifying production code.";
  }

  const auditChecks = {
    canonicalSourcesFound:
      sellBody.length > 0 &&
      costBody.length > 0,

    partialExitSemanticsInspected:
      sellChecks.supportsExplicitFillQuantity &&
      sellChecks.effectiveFillQuantityExists,

    entryFeeAllocationInspected:
      allocationChecks.entryFeeAssignmentFound &&
      allocationChecks.readsBuyOrder,

    noWrites:
      true,

    noRealTrading:
      true,
  };

  const failed =
    Object.entries(
      auditChecks,
    )
      .filter(
        ([, ok]) =>
          ok !== true,
      )
      .map(
        ([name]) =>
          name,
      );

  console.log(
    JSON.stringify(
      {
        status:
          failed.length === 0
            ? "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_ENTRY_FEE_ALLOCATION_AUDIT_V1_PASS"
            : "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_ENTRY_FEE_ALLOCATION_AUDIT_V1_FAIL",

        classification,

        sellChecks,
        allocationChecks,

        exactAssignments: {
          entryBrokerFee:
            entryFeeAssignments.map(
              item =>
                item.compact,
            ),

          entryExecutionValue:
            entryExecutionValueAssignments.map(
              item =>
                item.compact,
            ),

          totalTransactionCost:
            totalCostAssignments.map(
              item =>
                item.compact,
            ),
        },

        interpretation,

        accountingInvariant: {
          desired:
            "Across all partial exit trade rows for one completed position, allocated entry broker fees should sum to the original BUY entry broker fee exactly once.",

          dangerousCase:
            "If each partial exit row receives the full BUY entry broker fee, summing row-level net_pnl double-counts or multi-counts the entry fee.",

          safeExamples: [
            "allocate entry fee proportional to exited quantity",
            "allocate cumulative remainder on the final exit to eliminate rounding drift",
          ],
        },

        evidence: {
          sellPartialExit:
            context(
              sellBody,
              [
                /p_fill_quantity/i,
                /v_effective_fill_quantity/i,
                /paper_trade_history/i,
              ],
              12,
            ).slice(
              0,
              30,
            ),

          entryFeeAttribution:
            context(
              costBody,
              [
                /v_entry_broker_fee/i,
                /v_buy_order\.execution_broker_fee/i,
                /new\.quantity/i,
                /v_buy_order\.filled_quantity/i,
                /v_total_transaction_cost/i,
              ],
              12,
            ).slice(
              0,
              35,
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
          classification ===
            "PARTIAL_EXIT_ENTRY_FEE_DOUBLE_COUNT_RISK_CONFIRMED"
            ? "DESIGN_PARTIAL_EXIT_ENTRY_FEE_PRORATION_REPAIR"
            : classification ===
                "PARTIAL_EXIT_ENTRY_FEE_PRORATION_STRUCTURALLY_PROVEN"
              ? "CLOSE_PARTIAL_EXIT_ENTRY_FEE_ALLOCATION"
              : "REVIEW_PARTIAL_EXIT_ENTRY_FEE_SOURCE_EVIDENCE",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
