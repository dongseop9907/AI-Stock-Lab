import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const resolver = read(
  "lib/trading/resolve-protective-sell-execution-realism-v2.ts",
);
const stopLoss = read(
  "lib/trading/check-stop-losses.ts",
);
const trailing = read(
  "lib/trading/update-trailing-stops.ts",
);

const checks = {
  resolverKeepsCanonicalModel:
    resolver.includes("evaluatePaperExecutionRealismV2({") &&
    /side:\s*"SELL"/m.test(resolver),

  resolverKeepsFreshnessBlock:
    resolver.includes("orderbookQuote.freshnessBlocker") &&
    resolver.includes("PROTECTIVE_SELL_ORDERBOOK_FRESHNESS_BLOCKED"),

  resolverKeepsProtectiveFallback:
    resolver.includes("protectiveFallbackUsed") &&
    resolver.includes("protectiveFallbackReason"),

  resolverProducesVersionedProvenance:
    resolver.includes("PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1") &&
    resolver.includes("executionProvenance"),

  resolverContainsFullExecutionContext:
    [
      "decision.quoteAgeMs",
      "decision.participationRate",
      "decision.liquidityQuantityCap",
      "decision.topOfBookQuantityCap",
      "decision.syntheticSpreadBps",
      "decision.marketImpactBps",
      "decision.totalAdversePriceBps",
      "decision.totalTransactionCost",
      "marketInput",
      "orderbookQuote",
    ].every((token) => resolver.includes(token)),

  bothCallersUseV3:
    [stopLoss, trailing].every(
      (source) =>
        source.includes('"execute_paper_protective_sell_v3"') &&
        !source.includes('"execute_paper_protective_sell_v2"'),
    ),

  bothCallersPassExactSource:
    [stopLoss, trailing].every((source) =>
      source.includes("protectiveExecution.executionPriceSource"),
    ),

  bothCallersPassProvenance:
    [stopLoss, trailing].every(
      (source) =>
        source.includes("p_execution_provenance:") &&
        source.includes("protectiveExecution.executionProvenance"),
    ),

  stopLossReasonPreserved: stopLoss.includes('"STOP_LOSS"'),
  trailingReasonPreserved: trailing.includes('"TRAILING_STOP"'),

  noRealTradingEnable:
    ![resolver, stopLoss, trailing].some((source) =>
      /REAL_TRADING_ENABLED\s*=\s*true|ENABLE_REAL_TRADING\s*=\s*true|ENABLE_LIVE_TRADING\s*=\s*true/.test(
        source,
      ),
    ),
};

const failed = Object.entries(checks)
  .filter(([, ok]) => ok !== true)
  .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_CALLER_BINDING_CONTRACT_PASS"
      : "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_CALLER_BINDING_CONTRACT_FAIL",
  checks,
  failed,
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

process.exitCode = failed.length === 0 ? 0 : 1;
