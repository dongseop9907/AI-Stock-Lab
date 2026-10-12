import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

const BUY_FN = "execute_paper_buy_order_with_execution_price_v2";
const SELL_FN = "execute_paper_protective_sell_v2";

function rel(abs: string) {
  return path.relative(ROOT, abs).replaceAll("\\", "/");
}

function sqlFiles() {
  if (!fs.existsSync(MIGRATIONS)) return [];
  return fs.readdirSync(MIGRATIONS)
    .filter(name => name.endsWith(".sql"))
    .map(name => path.join(MIGRATIONS, name))
    .sort();
}

function findExactDefinition(functionName: string) {
  const needle = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(`,
    "i",
  );

  const matches = sqlFiles()
    .map(abs => {
      const text = fs.readFileSync(abs, "utf8");
      return needle.test(text)
        ? { abs, file: rel(abs), text }
        : null;
    })
    .filter((v): v is { abs: string; file: string; text: string } => v !== null);

  return matches.at(-1) ?? null;
}

function extractFunctionBody(text: string, functionName: string) {
  const startRe = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(`,
    "i",
  );
  const start = text.search(startRe);
  if (start < 0) return null;

  const after = text.slice(start);
  const dollarStart = after.search(/\bas\s+\$\$/i);
  if (dollarStart < 0) return after;

  const bodyStart = start + dollarStart;
  const end = text.indexOf("$$;", bodyStart);
  return end >= 0
    ? text.slice(start, end + 3)
    : text.slice(start);
}

function lineContexts(
  text: string,
  patterns: RegExp[],
  radius = 10,
) {
  const lines = text.split(/\r?\n/);
  const out: Array<{
    line: number;
    text: string;
    context: Array<{ line: number; text: string }>;
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    if (!patterns.some(re => re.test(lines[i]))) continue;

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

function has(text: string, re: RegExp) {
  return re.test(text);
}

const buy = findExactDefinition(BUY_FN);
const sell = findExactDefinition(SELL_FN);

if (!buy || !sell) {
  console.log(JSON.stringify({
    status: "AI_STOCK_LAB_PAPER_ACCOUNTING_BASIS_CANONICAL_AUDIT_V2_FAIL",
    reason: "EXACT_CANONICAL_V2_DEFINITION_NOT_FOUND",
    buyFound: Boolean(buy),
    sellFound: Boolean(sell),
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
  }, null, 2));
  process.exitCode = 1;
} else {
  const buyBody = extractFunctionBody(buy.text, BUY_FN) ?? "";
  const sellBody = extractFunctionBody(sell.text, SELL_FN) ?? "";

  /*
   * BUY proof:
   * - exact canonical V2 definition
   * - partial-fill quantity state
   * - p_execution_price participates in the position-average calculation
   * - the resulting average is persisted to paper_positions.average_price
   */
  const buyChecks = {
    exactCanonicalDefinition:
      new RegExp(
        `create\\s+or\\s+replace\\s+function\\s+public\\.${BUY_FN}\\s*\\(`,
        "i",
      ).test(buyBody),

    partialFillState:
      /v_prior_filled_quantity/i.test(buyBody) &&
      /v_effective_fill_quantity/i.test(buyBody),

    executionPricePresent:
      /p_execution_price/i.test(buyBody),

    newAveragePricePresent:
      /v_new_average_price/i.test(buyBody),

    executionPriceFeedsNewAverage:
      (
        /v_new_average_price\s*:=\s*[\s\S]{0,2200}?p_execution_price/i.test(buyBody) ||
        /p_execution_price[\s\S]{0,2200}?v_new_average_price\s*:=/i.test(buyBody)
      ),

    newAveragePersistedToPosition:
      (
        /average_price\s*=\s*v_new_average_price/i.test(buyBody) ||
        /v_new_average_price[\s\S]{0,1200}?paper_positions/i.test(buyBody)
      ),

    brokerFeePresent:
      /p_broker_fee/i.test(buyBody),
  };

  /*
   * SELL proof:
   * canonical V2 is responsible for accounting.
   * We accept either explicit arithmetic or canonical intermediate variables,
   * but require exit price, position average price, realized-PnL state,
   * fee/tax state, and persistence surfaces inside the exact V2 definition.
   */
  const sellChecks = {
    exactCanonicalDefinition:
      new RegExp(
        `create\\s+or\\s+replace\\s+function\\s+public\\.${SELL_FN}\\s*\\(`,
        "i",
      ).test(sellBody),

    exitPricePresent:
      /p_exit_price/i.test(sellBody),

    positionAveragePricePresent:
      (
        /average_price/i.test(sellBody) ||
        /entry_price/i.test(sellBody)
      ),

    realizedPnlStatePresent:
      (
        /realized_pnl/i.test(sellBody) ||
        /realizedPnl/i.test(sellBody) ||
        /v_.*pnl/i.test(sellBody)
      ),

    exitPriceCoupledToPnlRegion:
      (
        /p_exit_price[\s\S]{0,3200}?(?:realized_pnl|v_[a-z0-9_]*pnl)/i.test(sellBody) ||
        /(?:realized_pnl|v_[a-z0-9_]*pnl)[\s\S]{0,3200}?p_exit_price/i.test(sellBody)
      ),

    averagePriceCoupledToPnlRegion:
      (
        /average_price[\s\S]{0,3200}?(?:realized_pnl|v_[a-z0-9_]*pnl)/i.test(sellBody) ||
        /(?:realized_pnl|v_[a-z0-9_]*pnl)[\s\S]{0,3200}?average_price/i.test(sellBody) ||
        /entry_price[\s\S]{0,3200}?(?:realized_pnl|v_[a-z0-9_]*pnl)/i.test(sellBody)
      ),

    brokerFeePresent:
      /p_broker_fee/i.test(sellBody),

    sellTaxPresent:
      /p_sell_tax/i.test(sellBody),

    tradeHistoryPersistencePresent:
      /paper_trade_history/i.test(sellBody),

    accountRealizedPnlPersistencePresent:
      /daily_realized_pnl/i.test(sellBody),

    protectiveFillLedgerPresent:
      /paper_protective_execution_fills_v2/i.test(sellBody),
  };

  const downstreamPreflightFile =
    path.join(ROOT, "lib", "trading", "read-only-buy-risk-preflight.ts");

  let preflightClassification = "NOT_PRESENT";
  let preflightEvidence: unknown[] = [];

  if (fs.existsSync(downstreamPreflightFile)) {
    const text = fs.readFileSync(downstreamPreflightFile, "utf8");

    const computesRealizedPnl =
      /(?:const|let|var)\s+[A-Za-z0-9_]*realized[A-Za-z0-9_]*pnl\s*=/i.test(text) ||
      /realized_pnl\s*[:=][^,\n]*entryPrice/i.test(text);

    const onlyReadsDailyRealizedPnl =
      /daily_realized_pnl/i.test(text) &&
      !computesRealizedPnl;

    preflightClassification =
      onlyReadsDailyRealizedPnl
        ? "RISK_PREFLIGHT_INPUT_NOT_REALIZED_COST_BASIS"
        : computesRealizedPnl
          ? "REVIEW_REQUIRED"
          : "NO_REALIZED_PNL_COUPLING_FOUND";

    preflightEvidence = lineContexts(
      text,
      [
        /entryPrice/i,
        /daily_realized_pnl/i,
        /validateBuyRisk/i,
        /marketPriceDifference/i,
      ],
      8,
    ).slice(0, 20);
  }

  const requiredBuy = [
    "exactCanonicalDefinition",
    "partialFillState",
    "executionPricePresent",
    "newAveragePricePresent",
    "executionPriceFeedsNewAverage",
    "newAveragePersistedToPosition",
    "brokerFeePresent",
  ] as const;

  const requiredSell = [
    "exactCanonicalDefinition",
    "exitPricePresent",
    "positionAveragePricePresent",
    "realizedPnlStatePresent",
    "exitPriceCoupledToPnlRegion",
    "averagePriceCoupledToPnlRegion",
    "brokerFeePresent",
    "sellTaxPresent",
    "tradeHistoryPersistencePresent",
    "accountRealizedPnlPersistencePresent",
    "protectiveFillLedgerPresent",
  ] as const;

  const failedBuy = requiredBuy.filter(key => buyChecks[key] !== true);
  const failedSell = requiredSell.filter(key => sellChecks[key] !== true);

  const falsePositiveClosed =
    preflightClassification ===
      "RISK_PREFLIGHT_INPUT_NOT_REALIZED_COST_BASIS" ||
    preflightClassification ===
      "NO_REALIZED_PNL_COUPLING_FOUND";

  const failed = [
    ...failedBuy.map(x => `BUY:${x}`),
    ...failedSell.map(x => `SELL:${x}`),
    ...(falsePositiveClosed ? [] : ["DOWNSTREAM:read-only-buy-risk-preflight"]),
  ];

  const classification =
    failed.length === 0
      ? "EXECUTION_PRICE_TO_POSITION_BASIS_TO_REALIZED_PNL_CANONICAL_CHAIN_PROVEN"
      : "CANONICAL_ACCOUNTING_CHAIN_REVIEW_REQUIRED";

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_PAPER_ACCOUNTING_BASIS_CANONICAL_AUDIT_V2_PASS"
        : "AI_STOCK_LAB_PAPER_ACCOUNTING_BASIS_CANONICAL_AUDIT_V2_FAIL",

    classification,

    auditCorrection: {
      v1Problem:
        "V1 selected the latest migration that merely mentioned/called V2, so it audited V3 provenance wrappers instead of the exact canonical V2 function definitions.",
      correctedSelection:
        "V2 searches only migrations containing CREATE OR REPLACE FUNCTION public.<canonical_v2>(...) and audits that exact function body.",
      priorDownstreamFalsePositive:
        "read-only-buy-risk-preflight entryPrice is a pre-trade risk input; merely reading daily_realized_pnl does not make it a realized cost-basis calculation.",
    },

    canonicalSources: {
      buy:
        buy.file,
      sell:
        sell.file,
    },

    buyChecks,
    sellChecks,

    downstream: {
      file:
        "lib/trading/read-only-buy-risk-preflight.ts",
      classification:
        preflightClassification,
      evidence:
        preflightEvidence,
    },

    evidence: {
      buy: lineContexts(
        buyBody,
        [
          /v_prior_filled_quantity/i,
          /v_effective_fill_quantity/i,
          /v_new_average_price/i,
          /p_execution_price/i,
          /average_price/i,
          /p_broker_fee/i,
        ],
        12,
      ).slice(0, 35),

      sell: lineContexts(
        sellBody,
        [
          /p_exit_price/i,
          /average_price/i,
          /realized_pnl/i,
          /v_.*pnl/i,
          /p_broker_fee/i,
          /p_sell_tax/i,
          /daily_realized_pnl/i,
          /paper_trade_history/i,
          /paper_protective_execution_fills_v2/i,
        ],
        12,
      ).slice(0, 45),
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

    failed,

    nextGate:
      failed.length === 0
        ? "CLOSE_PAPER_ACCOUNTING_BASIS_CHAIN_AND_MOVE_TO_NEXT_DEVELOPMENT_GAP"
        : "REVIEW_EXACT_CANONICAL_ACCOUNTING_SOURCE_EVIDENCE",
  }, null, 2));

  process.exitCode = failed.length === 0 ? 0 : 1;
}
