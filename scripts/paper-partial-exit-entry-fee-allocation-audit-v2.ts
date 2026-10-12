import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const SELL_FILE =
  "supabase/migrations/20261009000200_paper_execution_realism_v2_protective_sell.sql";

const COST_FILE =
  "supabase/migrations/20261010000100_paper_execution_cost_attribution_v1.sql";

const MIGRATION_DIR =
  path.join(
    ROOT,
    "supabase",
    "migrations",
  );

function read(rel: string) {
  const abs =
    path.join(
      ROOT,
      rel,
    );

  return {
    rel,
    exists:
      fs.existsSync(
        abs,
      ),
    text:
      fs.existsSync(
        abs,
      )
        ? fs.readFileSync(
            abs,
            "utf8",
          )
        : "",
  };
}

function normalize(
  s: string,
) {
  return s
    .replace(
      /\s+/g,
      " ",
    )
    .trim();
}

function allSqlMigrations() {
  if (
    !fs.existsSync(
      MIGRATION_DIR,
    )
  ) {
    return [];
  }

  return fs
    .readdirSync(
      MIGRATION_DIR,
    )
    .filter(
      name =>
        name.endsWith(
          ".sql",
        ),
    )
    .sort()
    .map(
      name => ({
        name,
        text:
          fs.readFileSync(
            path.join(
              MIGRATION_DIR,
              name,
            ),
            "utf8",
          ),
      }),
    );
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

  const m =
    startRe.exec(
      text,
    );

  if (!m) {
    return "";
  }

  const tail =
    text.slice(
      m.index,
    );

  const end =
    tail.search(
      /\$\$\s*;/,
    );

  return end >= 0
    ? tail.slice(
        0,
        end + 3,
      )
    : tail;
}

function extractInsert(
  text: string,
  table: string,
) {
  const escaped =
    table.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

  const re =
    new RegExp(
      `insert\\s+into\\s+public\\.${escaped}\\s*\\(([\\s\\S]*?)\\)\\s*values\\s*\\(([\\s\\S]*?)\\)`,
      "i",
    );

  const m =
    re.exec(
      text,
    );

  if (!m) {
    return null;
  }

  const cols =
    m[1]
      .split(",")
      .map(
        s =>
          s
            .replace(
              /--.*$/gm,
              "",
            )
            .trim(),
      )
      .filter(Boolean);

  const values =
    m[2]
      .split(",")
      .map(
        s =>
          normalize(
            s,
          ),
      )
      .filter(Boolean);

  return {
    columns:
      cols,

    values,
  };
}

function context(
  text: string,
  patterns: RegExp[],
  radius = 10,
) {
  const lines =
    text.split(
      /\r?\n/,
    );

  const out: any[] =
    [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    if (
      !patterns.some(
        p =>
          p.test(
            lines[i],
          ),
      )
    ) {
      continue;
    }

    const start =
      Math.max(
        0,
        i -
          radius,
      );

    const end =
      Math.min(
        lines.length -
          1,
        i +
          radius,
      );

    out.push({
      line:
        i +
        1,

      text:
        lines[i],

      context:
        lines
          .slice(
            start,
            end +
              1,
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

  return out;
}

const sell =
  read(
    SELL_FILE,
  );

const cost =
  read(
    COST_FILE,
  );

if (
  !sell.exists ||
  !cost.exists
) {
  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_ENTRY_FEE_ALLOCATION_AUDIT_V2_FAIL",

        reason:
          "CANONICAL_SOURCE_NOT_FOUND",

        files: {
          sell:
            sell.exists,

          cost:
            cost.exists,
        },
      },
      null,
      2,
    ),
  );

  process.exitCode =
    1;
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

  const tradeInsert =
    extractInsert(
      sellBody,
      "paper_trade_history",
    );

  const migrationCorpus =
    allSqlMigrations();

  const tradeHistoryBuyOrderMentions =
    migrationCorpus
      .filter(
        row =>
          /paper_trade_history/i.test(
            row.text,
          ) &&
          /buy_order_id/i.test(
            row.text,
          ),
      )
      .map(
        row =>
          row.name,
      );

  /*
   * Prove partial exit behavior by exact mutation branches.
   */
  const computesRemaining =
    /v_remaining_position_quantity\s*:=\s*v_original_position_quantity\s*-\s*v_effective_fill_quantity\s*;/i.test(
      sellBody,
    );

  const deletesOnlyAtZero =
    /if\s+v_remaining_position_quantity\s*<=?\s*0\s+then[\s\S]{0,1200}?delete\s+from\s+public\.paper_positions/i.test(
      sellBody,
    ) ||
    /if\s+v_remaining_position_quantity\s*=\s*0\s+then[\s\S]{0,1200}?delete\s+from\s+public\.paper_positions/i.test(
      sellBody,
    );

  const updatesRemainingQuantity =
    /update\s+public\.paper_positions[\s\S]{0,1000}?quantity\s*=\s*v_remaining_position_quantity/i.test(
      sellBody,
    );

  const hasElseBranchAfterDelete =
    /if\s+v_remaining_position_quantity[\s\S]{0,1400}?delete\s+from\s+public\.paper_positions[\s\S]{0,500}?else[\s\S]{0,1200}?update\s+public\.paper_positions/i.test(
      sellBody,
    );

  const partialExitLeavesPositionOpen =
    computesRemaining &&
    updatesRemainingQuantity &&
    (
      deletesOnlyAtZero ||
      hasElseBranchAfterDelete
    );

  /*
   * Trace BUY-order linkage into paper_trade_history.
   */
  const tradeColumns =
    tradeInsert?.columns ??
    [];

  const tradeValues =
    tradeInsert?.values ??
    [];

  const buyOrderColumnIndex =
    tradeColumns.findIndex(
      c =>
        /^buy_order_id$/i.test(
          c,
        ),
    );

  const sellOrderColumnIndex =
    tradeColumns.findIndex(
      c =>
        /^sell_order_id$/i.test(
          c,
        ),
    );

  const sourcePositionColumnIndex =
    tradeColumns.findIndex(
      c =>
        /^source_position_id$/i.test(
          c,
        ),
    );

  const tradeInsertHasBuyOrderId =
    buyOrderColumnIndex >=
    0;

  const tradeInsertBuyOrderValue =
    buyOrderColumnIndex >=
      0
      ? tradeValues[
          buyOrderColumnIndex
        ] ??
        null
      : null;

  const tradeInsertHasSellOrderId =
    sellOrderColumnIndex >=
    0;

  const tradeInsertHasSourcePositionId =
    sourcePositionColumnIndex >=
    0;

  /*
   * Does another trigger/default populate buy_order_id?
   * We intentionally do not assume it does.
   */
  const explicitTradeHistoryBuyOrderPopulation =
    migrationCorpus
      .filter(
        row =>
          (
            /update\s+public\.paper_trade_history[\s\S]{0,1500}?buy_order_id\s*=/i.test(
              row.text,
            ) ||
            /insert\s+into\s+public\.paper_trade_history[\s\S]{0,1200}?buy_order_id/i.test(
              row.text,
            ) ||
            /new\.buy_order_id\s*:=/i.test(
              row.text,
            )
          ),
      )
      .map(
        row =>
          row.name,
      );

  const costNeedsBuyOrderId =
    /if\s+new\.buy_order_id\s+is\s+not\s+null\s+then/i.test(
      costBody,
    ) &&
    /where\s+id\s*=\s*new\.buy_order_id/i.test(
      costBody,
    );

  const costReadsFullEntryFee =
    /v_entry_broker_fee\s*:=[\s\S]{0,500}?v_buy_order\.execution_broker_fee/i.test(
      costBody,
    );

  const costUsesTradeQuantity =
    /new\.quantity/i.test(
      costBody,
    );

  const costUsesBuyFilledQuantity =
    /v_buy_order\.filled_quantity/i.test(
      costBody,
    );

  const entryFeeProrated =
    (
      /v_entry_broker_fee\s*:=[\s\S]{0,1400}?new\.quantity[\s\S]{0,1400}?v_buy_order\.filled_quantity/i.test(
        costBody,
      ) ||
      /v_entry_broker_fee\s*:=[\s\S]{0,1200}?v_buy_order\.execution_broker_fee[\s\S]{0,1200}?\*[\s\S]{0,400}?new\.quantity[\s\S]{0,600}?\/[\s\S]{0,400}?v_buy_order\.filled_quantity/i.test(
        costBody,
      ) ||
      /v_entry_broker_fee\s*:=\s*round\([\s\S]{0,1400}?new\.quantity/i.test(
        costBody,
      )
    );

  const buyOrderLinkProven =
    tradeInsertHasBuyOrderId &&
    Boolean(
      tradeInsertBuyOrderValue,
    );

  const externalBuyOrderPopulationProven =
    explicitTradeHistoryBuyOrderPopulation.length >
    0;

  let classification:
    string;

  let interpretation:
    string;

  if (
    partialExitLeavesPositionOpen &&
    costNeedsBuyOrderId &&
    !buyOrderLinkProven &&
    !externalBuyOrderPopulationProven
  ) {
    classification =
      "PARTIAL_EXIT_ENTRY_FEE_LINKAGE_GAP_CONFIRMED";

    interpretation =
      "Protective SELL structurally supports partial exits, but the canonical trade-history insert does not prove buy_order_id propagation and no separate population path was found. The cost-attribution trigger therefore may be unable to recover the executed BUY entry fee from new.buy_order_id.";
  }
  else if (
    partialExitLeavesPositionOpen &&
    (
      buyOrderLinkProven ||
      externalBuyOrderPopulationProven
    ) &&
    costReadsFullEntryFee &&
    !entryFeeProrated
  ) {
    classification =
      "PARTIAL_EXIT_ENTRY_FEE_DOUBLE_COUNT_RISK_CONFIRMED";

    interpretation =
      "Partial exits are structurally supported and BUY fee linkage exists, but each trade row appears to consume the full original BUY execution broker fee without quantity allocation. Aggregated net PnL can over-count the entry fee across multiple partial exits.";
  }
  else if (
    partialExitLeavesPositionOpen &&
    (
      buyOrderLinkProven ||
      externalBuyOrderPopulationProven
    ) &&
    entryFeeProrated
  ) {
    classification =
      "PARTIAL_EXIT_ENTRY_FEE_ALLOCATION_STRUCTURALLY_SAFE";

    interpretation =
      "Partial exits, BUY-order linkage, and quantity-based entry-fee allocation are all structurally present.";
  }
  else if (
    !partialExitLeavesPositionOpen
  ) {
    classification =
      "PARTIAL_EXIT_POSITION_MUTATION_NOT_PROVEN";

    interpretation =
      "The canonical SELL RPC accepts a fill quantity and computes a remaining quantity, but this audit still could not prove the exact branch that preserves a non-zero remainder. Do not infer fee double-count until the position mutation is proven.";
  }
  else {
    classification =
      "PARTIAL_EXIT_ENTRY_FEE_ALLOCATION_STILL_INCONCLUSIVE";

    interpretation =
      "The exact fee-linkage/allocation invariant could not be classified safely from source.";
  }

  const checks = {
    canonicalSellFound:
      sellBody.length >
      0,

    canonicalCostAttributionFound:
      costBody.length >
      0,

    computesRemaining,

    partialExitLeavesPositionOpen,

    tradeHistoryInsertFound:
      tradeInsert !==
      null,

    tradeInsertHasSellOrderId,

    tradeInsertHasSourcePositionId,

    costNeedsBuyOrderId,

    costReadsFullEntryFee,

    sourceOnly:
      true,
  };

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_ENTRY_FEE_ALLOCATION_AUDIT_V2_COMPLETE",

        classification,

        checks,

        positionMutation: {
          computesRemaining,
          deletesOnlyAtZero,
          updatesRemainingQuantity,
          hasElseBranchAfterDelete,
          partialExitLeavesPositionOpen,
        },

        tradeHistoryLinkage: {
          columns:
            tradeColumns,

          values:
            tradeValues,

          hasBuyOrderId:
            tradeInsertHasBuyOrderId,

          buyOrderValue:
            tradeInsertBuyOrderValue,

          hasSellOrderId:
            tradeInsertHasSellOrderId,

          hasSourcePositionId:
            tradeInsertHasSourcePositionId,

          migrationsMentioningTradeHistoryAndBuyOrderId:
            tradeHistoryBuyOrderMentions,

          explicitPopulationMigrations:
            explicitTradeHistoryBuyOrderPopulation,
        },

        costAttribution: {
          requiresNewBuyOrderId:
            costNeedsBuyOrderId,

          readsFullExecutedBuyEntryFee:
            costReadsFullEntryFee,

          seesTradeQuantity:
            costUsesTradeQuantity,

          seesBuyFilledQuantity:
            costUsesBuyFilledQuantity,

          entryFeeProrated,
        },

        interpretation,

        invariant: {
          required:
            "Across all trade-history rows generated from one BUY position, entry broker fee attribution must total the original BUY fee exactly once.",

          linkageRequirement:
            "Every trade row requiring BUY cost attribution must retain a reliable link to its originating BUY order.",

          partialExitRequirement:
            "If exits can be split, entry fee must be allocated proportionally or by cumulative remainder rather than copied in full to every row.",
        },

        evidence: {
          position:
            context(
              sellBody,
              [
                /v_remaining_position_quantity/i,
                /delete\s+from\s+public\.paper_positions/i,
                /update\s+public\.paper_positions/i,
              ],
              14,
            ).slice(
              0,
              35,
            ),

          tradeInsert:
            context(
              sellBody,
              [
                /insert\s+into\s+public\.paper_trade_history/i,
                /buy_order_id/i,
                /sell_order_id/i,
                /source_position_id/i,
              ],
              15,
            ).slice(
              0,
              35,
            ),

          attribution:
            context(
              costBody,
              [
                /new\.buy_order_id/i,
                /v_buy_order\.execution_broker_fee/i,
                /new\.quantity/i,
                /v_buy_order\.filled_quantity/i,
                /v_entry_broker_fee/i,
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

        nextGate:
          classification ===
            "PARTIAL_EXIT_ENTRY_FEE_LINKAGE_GAP_CONFIRMED"
            ? "DESIGN_TRADE_HISTORY_BUY_ORDER_LINKAGE_REPAIR"
            : classification ===
                "PARTIAL_EXIT_ENTRY_FEE_DOUBLE_COUNT_RISK_CONFIRMED"
              ? "DESIGN_PARTIAL_EXIT_ENTRY_FEE_PRORATION_REPAIR"
              : classification ===
                  "PARTIAL_EXIT_ENTRY_FEE_ALLOCATION_STRUCTURALLY_SAFE"
                ? "CLOSE_PARTIAL_EXIT_ENTRY_FEE_ALLOCATION"
                : "REVIEW_EXACT_POSITION_AND_LINKAGE_EVIDENCE",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    0;
}
