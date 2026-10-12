const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const FILES = {
  resolver: "lib/trading/resolve-protective-sell-execution-realism-v2.ts",
  stopLoss: "lib/trading/check-stop-losses.ts",
  trailing: "lib/trading/update-trailing-stops.ts",
};

const text = Object.fromEntries(
  Object.entries(FILES).map(([key, file]) => [
    key,
    fs.readFileSync(path.join(ROOT, file), "utf8"),
  ])
);

function callerChecks(source, exitReason) {
  return {
    v3RpcBound: source.includes('"execute_paper_protective_sell_v3"'),
    v2RpcRemoved: !source.includes('"execute_paper_protective_sell_v2"'),
    exactExecutionSource:
      source.includes("p_execution_source:") &&
      source.includes("protectiveExecution.executionPriceSource"),
    provenancePassed:
      source.includes("p_execution_provenance:") &&
      source.includes("protectiveExecution.executionProvenance"),
    exitReasonPreserved: source.includes(`"${exitReason}"`),
  };
}

const checks = {
  resolverProvenanceVersion:
    text.resolver.includes("PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1"),
  resolverExactSellSourceGuard:
    text.resolver.includes('executionPriceSource !== "BEST_BID"') &&
    text.resolver.includes('"REFERENCE_MINUS_SYNTHETIC_SPREAD"'),
  resolverReturnsProvenance:
    text.resolver.includes("executionProvenance,") &&
    text.resolver.includes("executionPriceSource,"),
  resolverIncludesMarketInput: text.resolver.includes("marketInput,"),
  resolverIncludesOrderbook:
    text.resolver.includes("orderbook:") &&
    text.resolver.includes("orderbookQuote,"),
  resolverIncludesCoreRealism: [
    "decision.marketImpactBps",
    "decision.syntheticSpreadBps",
    "decision.topOfBookQuantityCap",
    "decision.totalTransactionCost",
    "decision.sellTax",
    "decision.quoteAgeMs",
  ].every((token) => text.resolver.includes(token)),
  stopLoss: Object.values(callerChecks(text.stopLoss, "STOP_LOSS")).every(Boolean),
  trailing: Object.values(callerChecks(text.trailing, "TRAILING_STOP")).every(Boolean),
  noV2CallerSurface:
    !text.stopLoss.includes('"execute_paper_protective_sell_v2"') &&
    !text.trailing.includes('"execute_paper_protective_sell_v2"'),
  noRealTradingEnable:
    !Object.values(text).some((source) =>
      /REAL_TRADING_ENABLED\s*=\s*true|ENABLE_REAL_TRADING\s*=\s*true|ENABLE_LIVE_TRADING\s*=\s*true/.test(source)
    ),
};

const detail = {
  stopLoss: callerChecks(text.stopLoss, "STOP_LOSS"),
  trailing: callerChecks(text.trailing, "TRAILING_STOP"),
};

const failed = Object.entries(checks)
  .filter(([, ok]) => ok !== true)
  .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_CALLER_BINDING_STATIC_PASS"
      : "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_CALLER_BINDING_STATIC_FAIL",
  checks,
  detail,
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
  nextGate:
    failed.length === 0
      ? "APP_TSC_THEN_REMOTE_V3_SCHEMA_PROBE"
      : "REPAIR_SELL_CALLER_BINDING",
}, null, 2));

process.exitCode = failed.length === 0 ? 0 : 1;
