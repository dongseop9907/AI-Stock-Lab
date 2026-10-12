import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");

function sqlFiles() {
  if (!fs.existsSync(MIG_DIR)) return [];

  return fs.readdirSync(MIG_DIR)
    .filter(name => name.endsWith(".sql"))
    .sort()
    .map(name => ({
      name,
      abs: path.join(MIG_DIR, name),
      text: fs.readFileSync(path.join(MIG_DIR, name), "utf8"),
    }));
}

function extractFunctionBody(text: string, fnName: string) {
  const startRe = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${fnName}\\s*\\(`,
    "i",
  );

  const m = startRe.exec(text);
  if (!m) return "";

  const tail = text.slice(m.index);
  const end = tail.search(/\$\$\s*;/);

  return end >= 0
    ? tail.slice(0, end + 3)
    : tail;
}

function ctx(text: string, patterns: RegExp[], radius = 9) {
  const lines = text.split(/\r?\n/);
  const out: any[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!patterns.some(p => p.test(lines[i]))) continue;

    const start = Math.max(0, i - radius);
    const end = Math.min(lines.length - 1, i + radius);

    out.push({
      line: i + 1,
      text: lines[i],
      context: lines.slice(start, end + 1).map((line, offset) => ({
        line: start + offset + 1,
        text: line,
      })),
    });
  }

  return out;
}

const files = sqlFiles();

const schemaFile =
  files.find(f =>
    /create\s+table\s+if\s+not\s+exists\s+public\.paper_trade_history/i.test(f.text)
  ) ?? null;

const buyV2File =
  files.find(f =>
    /create\s+or\s+replace\s+function\s+public\.execute_paper_buy_order_with_execution_price_v2\s*\(/i.test(f.text)
  ) ?? null;

const modelBindingFile =
  files.find(f =>
    /create\s+or\s+replace\s+function\s+public\.bind_model_to_filled_position\s*\(/i.test(f.text) &&
    /create\s+or\s+replace\s+function\s+public\.attach_model_to_trade_history\s*\(/i.test(f.text)
  ) ?? null;

const costFile =
  files.find(f =>
    /create\s+or\s+replace\s+function\s+public\.apply_paper_trade_cost_attribution_v1\s*\(/i.test(f.text)
  ) ?? null;

const sellV2File =
  files.find(f =>
    /create\s+or\s+replace\s+function\s+public\.execute_paper_protective_sell_v2\s*\(/i.test(f.text)
  ) ?? null;

const buyBody = buyV2File
  ? extractFunctionBody(
      buyV2File.text,
      "execute_paper_buy_order_with_execution_price_v2",
    )
  : "";

const bindBody = modelBindingFile
  ? extractFunctionBody(
      modelBindingFile.text,
      "bind_model_to_filled_position",
    )
  : "";

const attachBody = modelBindingFile
  ? extractFunctionBody(
      modelBindingFile.text,
      "attach_model_to_trade_history",
    )
  : "";

const costBody = costFile
  ? extractFunctionBody(
      costFile.text,
      "apply_paper_trade_cost_attribution_v1",
    )
  : "";

const sellBody = sellV2File
  ? extractFunctionBody(
      sellV2File.text,
      "execute_paper_protective_sell_v2",
    )
  : "";

/*
 * 1. Can paper_trade_history hold more than one row per source position?
 */
const initialUniqueSourcePosition = Boolean(
  schemaFile &&
  /source_position_id\s+uuid\s+not\s+null\s+unique/i.test(schemaFile.text),
);

const uniqueConstraintDropCandidates =
  files.filter(f =>
    /alter\s+table\s+(?:public\.)?paper_trade_history/i.test(f.text) &&
    /drop\s+constraint/i.test(f.text) &&
    (
      /source_position_id/i.test(f.text) ||
      /paper_trade_history_source_position_id/i.test(f.text)
    )
  );

const uniqueIndexDropCandidates =
  files.filter(f =>
    /drop\s+index/i.test(f.text) &&
    /source_position/i.test(f.text)
  );

const uniqueSourcePositionStillLikelyActive =
  initialUniqueSourcePosition &&
  uniqueConstraintDropCandidates.length === 0 &&
  uniqueIndexDropCandidates.length === 0;

/*
 * 2. Does BUY execution aggregate multiple fills/orders into an existing position?
 */
const buyCanUpdateExistingPosition =
  /select\s+\*[\s\S]{0,600}?from\s+public\.paper_positions[\s\S]{0,500}?for\s+update/i.test(
    buyBody,
  ) &&
  /update\s+public\.paper_positions/i.test(
    buyBody,
  );

const weightedAverageExistingPosition =
  /v_position\.average_price\s*\*\s*v_position\.quantity/i.test(
    buyBody,
  ) &&
  /p_execution_price\s*\*\s*v_effective_fill_quantity/i.test(
    buyBody,
  ) &&
  /v_new_average_price/i.test(
    buyBody,
  );

const buyOrderFeeAccumulatedOnOrder =
  /execution_broker_fee\s*=[\s\S]{0,500}?coalesce\(\s*execution_broker_fee\s*,\s*0\s*\)\s*\+\s*p_broker_fee/i.test(
    buyBody,
  );

/*
 * 3. Is position lineage singular?
 */
const positionHasEntryOrderId =
  Boolean(
    modelBindingFile &&
    /alter\s+table\s+public\.paper_positions[\s\S]{0,500}?add\s+column\s+if\s+not\s+exists\s+entry_order_id\s+uuid/i.test(
      modelBindingFile.text,
    ),
  );

const bindingPreservesFirstEntryOrder =
  /entry_order_id\s*=\s*coalesce\(\s*entry_order_id\s*,\s*new\.id\s*\)/i.test(
    bindBody,
  );

const attachTradeUsesSingularEntryOrder =
  /select[\s\S]{0,500}?entry_order_id[\s\S]{0,800}?from\s+public\.paper_positions/i.test(
    attachBody,
  ) &&
  /new\.buy_order_id\s*=\s*coalesce\([\s\S]{0,300}?v_entry_order_id/i.test(
    attachBody,
  );

/*
 * 4. Is there any cumulative entry-fee basis on paper_positions?
 */
const positionEntryFeeBasisMentions =
  files.filter(f =>
    /paper_positions/i.test(f.text) &&
    (
      /entry_broker_fee/i.test(f.text) ||
      /entry_fee_remaining/i.test(f.text) ||
      /entry_fee_total/i.test(f.text) ||
      /transaction_cost_basis/i.test(f.text)
    )
  );

const hasPositionEntryFeeBasis =
  positionEntryFeeBasisMentions.some(f =>
    /alter\s+table\s+public\.paper_positions[\s\S]{0,1000}?(?:entry_broker_fee|entry_fee_remaining|entry_fee_total|transaction_cost_basis)/i.test(
      f.text,
    ) ||
    /create\s+table[\s\S]{0,2000}?paper_positions[\s\S]{0,2000}?(?:entry_broker_fee|entry_fee_remaining|entry_fee_total|transaction_cost_basis)/i.test(
      f.text,
    )
  );

/*
 * 5. Cost attribution still reads one linked BUY order's full fee.
 */
const costReadsOneBuyOrder =
  /where\s+id\s*=\s*new\.buy_order_id/i.test(
    costBody,
  );

const costReadsFullLinkedBuyFee =
  /v_entry_broker_fee\s*:=[\s\S]{0,700}?v_buy_order\.execution_broker_fee/i.test(
    costBody,
  );

const costProratesEntryFee =
  (
    /v_entry_broker_fee\s*:=[\s\S]{0,1600}?new\.quantity[\s\S]{0,1600}?v_buy_order\.filled_quantity/i.test(
      costBody,
    ) ||
    /v_entry_broker_fee\s*:=[\s\S]{0,1800}?v_buy_order\.execution_broker_fee[\s\S]{0,1000}?\*[\s\S]{0,500}?new\.quantity[\s\S]{0,800}?\/[\s\S]{0,500}?v_buy_order\.filled_quantity/i.test(
      costBody,
    )
  );

/*
 * 6. Protective SELL really supports keeping residual quantity.
 */
const sellSupportsPartialExit =
  /p_fill_quantity\s+integer\s+default\s+null/i.test(
    sellBody,
  ) &&
  /v_remaining_position_quantity\s*:=\s*v_original_position_quantity\s*-\s*v_effective_fill_quantity/i.test(
    sellBody,
  ) &&
  /else[\s\S]{0,600}?update\s+public\.paper_positions[\s\S]{0,500}?quantity\s*=\s*v_remaining_position_quantity/i.test(
    sellBody,
  );

const structural = {
  initialUniqueSourcePosition,
  uniqueConstraintDropCandidates:
    uniqueConstraintDropCandidates.map(f => f.name),
  uniqueIndexDropCandidates:
    uniqueIndexDropCandidates.map(f => f.name),
  uniqueSourcePositionStillLikelyActive,

  buyCanUpdateExistingPosition,
  weightedAverageExistingPosition,
  buyOrderFeeAccumulatedOnOrder,

  positionHasEntryOrderId,
  bindingPreservesFirstEntryOrder,
  attachTradeUsesSingularEntryOrder,

  hasPositionEntryFeeBasis,
  positionEntryFeeBasisFiles:
    positionEntryFeeBasisMentions.map(f => f.name),

  costReadsOneBuyOrder,
  costReadsFullLinkedBuyFee,
  costProratesEntryFee,

  sellSupportsPartialExit,
};

let classification: string;
let interpretation: string;
let nextGate: string;

if (
  uniqueSourcePositionStillLikelyActive &&
  sellSupportsPartialExit &&
  buyCanUpdateExistingPosition &&
  weightedAverageExistingPosition &&
  positionHasEntryOrderId &&
  bindingPreservesFirstEntryOrder &&
  attachTradeUsesSingularEntryOrder &&
  !hasPositionEntryFeeBasis &&
  costReadsOneBuyOrder &&
  costReadsFullLinkedBuyFee &&
  !costProratesEntryFee
) {
  classification =
    "PARTIAL_EXIT_SCHEMA_AND_MULTI_BUY_ENTRY_FEE_BASIS_GAP_CONFIRMED";

  interpretation =
    "Two independent structural gaps are present: paper_trade_history still appears unique by source_position_id even though protective SELL keeps residual position quantity, and entry-fee attribution relies on one preserved entry_order_id/full BUY fee even though BUY execution can aggregate into an existing weighted-average position. A repair should address trade-history multiplicity and position-level cumulative entry-fee basis together.";
  nextGate =
    "DESIGN_ATOMIC_PARTIAL_EXIT_AND_POSITION_ENTRY_FEE_BASIS_REPAIR";
}
else if (
  uniqueSourcePositionStillLikelyActive &&
  sellSupportsPartialExit
) {
  classification =
    "PARTIAL_EXIT_TRADE_HISTORY_UNIQUE_CONSTRAINT_GAP_CONFIRMED";

  interpretation =
    "Protective SELL supports partial exits but paper_trade_history still appears to allow only one row per source position.";
  nextGate =
    "DESIGN_PARTIAL_EXIT_TRADE_HISTORY_SCHEMA_REPAIR";
}
else if (
  buyCanUpdateExistingPosition &&
  weightedAverageExistingPosition &&
  positionHasEntryOrderId &&
  bindingPreservesFirstEntryOrder &&
  !hasPositionEntryFeeBasis &&
  costReadsOneBuyOrder
) {
  classification =
    "MULTI_BUY_POSITION_ENTRY_FEE_BASIS_GAP_CONFIRMED";

  interpretation =
    "A position can aggregate additional BUY execution quantity but keeps a singular entry_order_id and has no cumulative entry-fee basis. Round-trip fee attribution can therefore miss fees from later BUYs.";
  nextGate =
    "DESIGN_POSITION_LEVEL_ENTRY_FEE_BASIS_REPAIR";
}
else {
  classification =
    "PARTIAL_EXIT_AND_MULTI_BUY_FEE_BASIS_REVIEW_REQUIRED";

  interpretation =
    "The audit could not prove all structural conditions safely. Review exact evidence before changing production migrations.";
  nextGate =
    "REVIEW_EXACT_SCHEMA_AND_LINEAGE_EVIDENCE";
}

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_AUDIT_V1_COMPLETE",

  classification,

  sourceFiles: {
    schema:
      schemaFile?.name ?? null,
    buyV2:
      buyV2File?.name ?? null,
    modelBinding:
      modelBindingFile?.name ?? null,
    costAttribution:
      costFile?.name ?? null,
    sellV2:
      sellV2File?.name ?? null,
  },

  structural,
  interpretation,

  repairInvariant: {
    tradeHistory:
      "One position must be able to produce multiple exit trade rows, each uniquely identified by its SELL execution rather than by source_position_id alone.",

    positionEntryCost:
      "A position that aggregates one or more BUY executions must retain cumulative remaining entry broker-fee basis independent of a single entry_order_id.",

    partialExitAllocation:
      "Each partial exit must consume only its proportional/remainder share of the remaining position entry-fee basis; all exits combined must consume the original cumulative entry fee exactly once.",

    finalExit:
      "The final exit should consume any rounding remainder before the position is deleted.",
  },

  evidence: {
    initialSchema:
      schemaFile
        ? ctx(
            schemaFile.text,
            [
              /source_position_id/i,
              /buy_order_id/i,
            ],
            8,
          ).slice(0, 12)
        : [],

    buyAggregation:
      ctx(
        buyBody,
        [
          /v_new_average_price/i,
          /paper_positions/i,
          /execution_broker_fee/i,
        ],
        10,
      ).slice(0, 24),

    positionLineage:
      modelBindingFile
        ? ctx(
            modelBindingFile.text,
            [
              /entry_order_id/i,
              /new\.buy_order_id/i,
              /attach_model_to_trade_history/i,
            ],
            10,
          ).slice(0, 28)
        : [],

    costAttribution:
      ctx(
        costBody,
        [
          /new\.buy_order_id/i,
          /execution_broker_fee/i,
          /v_entry_broker_fee/i,
          /new\.quantity/i,
          /filled_quantity/i,
        ],
        10,
      ).slice(0, 28),

    sellPartialExit:
      ctx(
        sellBody,
        [
          /p_fill_quantity/i,
          /v_remaining_position_quantity/i,
          /update\s+public\.paper_positions/i,
        ],
        10,
      ).slice(0, 24),
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

  nextGate,
}, null, 2));

process.exitCode = 0;
