const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const RESOLVER = path.join(ROOT, "lib", "trading", "resolve-protective-sell-execution-realism-v2.ts");
const CALLERS = [
  { file: path.join(ROOT, "lib", "trading", "check-stop-losses.ts"), exitReason: "STOP_LOSS" },
  { file: path.join(ROOT, "lib", "trading", "update-trailing-stops.ts"), exitReason: "TRAILING_STOP" },
];
const BACKUP_DIR = path.join(ROOT, "scripts", "backups", "paper-protective-sell-execution-provenance-v1-caller-binding");

function rel(abs) {
  return path.relative(ROOT, abs).replaceAll("\\", "/");
}

function fail(reason, details = {}) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_CALLER_BINDING_FAIL",
    reason,
    ...details,
  }, null, 2));
  process.exitCode = 1;
  throw new Error(reason);
}

for (const file of [RESOLVER, ...CALLERS.map((row) => row.file)]) {
  if (!fs.existsSync(file)) fail("TARGET_NOT_FOUND", { target: rel(file) });
}

const resolverBefore = fs.readFileSync(RESOLVER, "utf8");

if (
  resolverBefore.includes("executionProvenance:") ||
  resolverBefore.includes("executionPriceSource:")
) {
  fail("RESOLVER_ALREADY_HAS_PROVENANCE_BINDING");
}

const interfaceAnchor = `  marketInputSource: string;\n}`;

if (!resolverBefore.includes(interfaceAnchor)) {
  fail("RESOLVER_INTERFACE_ANCHOR_NOT_FOUND");
}

let resolverAfter = resolverBefore.replace(
  interfaceAnchor,
  `  marketInputSource: string;

  executionPriceSource:
    | "BEST_BID"
    | "REFERENCE_MINUS_SYNTHETIC_SPREAD";

  executionProvenance:
    Record<string, unknown>;
}`
);

const returnAnchor = `  return {
    ...decision,
    protectiveFallbackUsed,
    protectiveFallbackReason,
    marketInputSource:
      marketInput.source,
  };`;

if (!resolverAfter.includes(returnAnchor)) {
  fail("RESOLVER_RETURN_ANCHOR_NOT_FOUND");
}

const returnReplacement = `  const executionPriceSource =
    decision.priceSource;

  if (
    executionPriceSource !== "BEST_BID" &&
    executionPriceSource !==
      "REFERENCE_MINUS_SYNTHETIC_SPREAD"
  ) {
    throw new Error(
      \`PROTECTIVE_SELL_REALISM_INVALID_PRICE_SOURCE:\${executionPriceSource ?? "NULL"}\`,
    );
  }

  const executionProvenance:
    Record<string, unknown> = {
    version:
      "PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1",

    side:
      "SELL",

    execution: {
      referencePrice:
        decision.referencePrice,
      executionPrice:
        decision.executionPrice,
      priceSource:
        executionPriceSource,
      requestedQuantity:
        decision.requestedQuantity,
      filledQuantity:
        decision.filledQuantity,
      unfilledQuantity:
        decision.unfilledQuantity,
      fillRate:
        decision.fillRate,
      quoteAgeMs:
        decision.quoteAgeMs,
      participationRate:
        decision.participationRate,
      liquidityQuantityCap:
        decision.liquidityQuantityCap,
      topOfBookQuantityCap:
        decision.topOfBookQuantityCap,
      syntheticSpreadBps:
        decision.syntheticSpreadBps,
      marketImpactBps:
        decision.marketImpactBps,
      totalAdversePriceBps:
        decision.totalAdversePriceBps,
      grossNotional:
        decision.grossNotional,
      brokerFee:
        decision.brokerFee,
      sellTax:
        decision.sellTax,
      totalTransactionCost:
        decision.totalTransactionCost,
      netCashFlow:
        decision.netCashFlow,
      assumptions:
        decision.assumptions,
    },

    protective: {
      fallbackUsed:
        protectiveFallbackUsed,
      fallbackReason:
        protectiveFallbackReason,
    },

    marketInput,
    orderbook:
      orderbookQuote,
  };

  return {
    ...decision,
    protectiveFallbackUsed,
    protectiveFallbackReason,
    marketInputSource:
      marketInput.source,
    executionPriceSource,
    executionProvenance,
  };`;

resolverAfter = resolverAfter.replace(returnAnchor, returnReplacement);

const resolverChecks = {
  hasExecutionPriceSourceResult: resolverAfter.includes("executionPriceSource:"),
  hasExecutionProvenanceResult: resolverAfter.includes("executionProvenance:"),
  exactSellSourceGuard:
    resolverAfter.includes('executionPriceSource !== "BEST_BID"') &&
    resolverAfter.includes('"REFERENCE_MINUS_SYNTHETIC_SPREAD"'),
  provenanceVersioned:
    resolverAfter.includes("PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1"),
  provenanceContainsDecisionMetrics: [
    "decision.marketImpactBps",
    "decision.syntheticSpreadBps",
    "decision.topOfBookQuantityCap",
    "decision.totalTransactionCost",
    "decision.sellTax",
    "decision.quoteAgeMs",
  ].every((token) => resolverAfter.includes(token)),
  provenanceContainsMarketInput: resolverAfter.includes("marketInput,"),
  provenanceContainsOrderbook:
    resolverAfter.includes("orderbook:") &&
    resolverAfter.includes("orderbookQuote,"),
};

const resolverFailed = Object.entries(resolverChecks)
  .filter(([, ok]) => ok !== true)
  .map(([name]) => name);

if (resolverFailed.length > 0) {
  fail("RESOLVER_MEMORY_GUARD_FAILED", {
    checks: resolverChecks,
    failed: resolverFailed,
    productionSourceWrites: 0,
  });
}

const callerResults = [];

for (const caller of CALLERS) {
  const before = fs.readFileSync(caller.file, "utf8");
  const oldRpc = '"execute_paper_protective_sell_v2"';
  const newRpc = '"execute_paper_protective_sell_v3"';
  const oldCount = before.split(oldRpc).length - 1;

  if (oldCount !== 1) {
    fail("SELL_V2_RPC_CALL_COUNT_UNEXPECTED", {
      file: rel(caller.file),
      count: oldCount,
    });
  }

  if (before.includes(newRpc)) {
    fail("SELL_V3_RPC_ALREADY_BOUND", { file: rel(caller.file) });
  }

  const oldSourceBlock = `        p_execution_source:
          protectiveExecution.priceSource ??
          "PAPER_EXECUTION_REALISM_V2",
        p_exit_reason:
          "${caller.exitReason}",`;

  const newSourceBlock = `        p_execution_source:
          protectiveExecution.executionPriceSource,

        p_execution_provenance: {
          ...protectiveExecution.executionProvenance,
          exitReason:
            "${caller.exitReason}",
        },

        p_exit_reason:
          "${caller.exitReason}",`;

  if (!before.includes(oldSourceBlock)) {
    fail("CALLER_ARGUMENT_ANCHOR_NOT_FOUND", {
      file: rel(caller.file),
      exitReason: caller.exitReason,
    });
  }

  let after = before.replace(oldRpc, newRpc);
  after = after.replace(oldSourceBlock, newSourceBlock);

  const checks = {
    v3Bound: after.includes(newRpc),
    v2Removed: !after.includes(oldRpc),
    exactSourcePassed: after.includes("protectiveExecution.executionPriceSource"),
    provenancePassed:
      after.includes("p_execution_provenance:") &&
      after.includes("protectiveExecution.executionProvenance"),
    exitReasonPreserved: after.includes(`"${caller.exitReason}"`),
    legacyFallbackSourceRemoved: !after.includes('"PAPER_EXECUTION_REALISM_V2",'),
    noRealTradingEnable:
      !/REAL_TRADING_ENABLED\s*=\s*true|ENABLE_REAL_TRADING\s*=\s*true|ENABLE_LIVE_TRADING\s*=\s*true/.test(after),
  };

  const failed = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

  if (failed.length > 0) {
    fail("CALLER_MEMORY_GUARD_FAILED", {
      file: rel(caller.file),
      checks,
      failed,
      productionSourceWrites: 0,
    });
  }

  callerResults.push({ file: caller.file, before, after, checks });
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const resolverBackup = path.join(
  BACKUP_DIR,
  "resolve-protective-sell-execution-realism-v2.ts"
);

if (!fs.existsSync(resolverBackup)) {
  fs.writeFileSync(resolverBackup, resolverBefore, "utf8");
}

for (const row of callerResults) {
  const backup = path.join(BACKUP_DIR, path.basename(row.file));
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, row.before, "utf8");
}

fs.writeFileSync(RESOLVER, resolverAfter, "utf8");

for (const row of callerResults) {
  fs.writeFileSync(row.file, row.after, "utf8");
}

console.log(JSON.stringify({
  status: "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_CALLER_BOUND",
  changedFiles: [
    "lib/trading/resolve-protective-sell-execution-realism-v2.ts",
    "lib/trading/check-stop-losses.ts",
    "lib/trading/update-trailing-stops.ts",
  ],
  rpc: {
    from: "execute_paper_protective_sell_v2",
    to: "execute_paper_protective_sell_v3",
  },
  resolver: {
    exactSuccessfulSellSources: [
      "BEST_BID",
      "REFERENCE_MINUS_SYNTHETIC_SPREAD",
    ],
    returns: [
      "executionPriceSource",
      "executionProvenance",
    ],
    provenanceIncludes: [
      "reference/execution price",
      "requested/filled/unfilled quantity",
      "fill rate",
      "quote age",
      "participation rate",
      "liquidity quantity cap",
      "top-of-book quantity cap",
      "synthetic spread bps",
      "market impact bps",
      "total adverse price bps",
      "gross notional",
      "broker fee",
      "sell tax",
      "total transaction cost",
      "net cash flow",
      "assumptions",
      "protective fallback state",
      "market input",
      "orderbook source/quote/session/freshness metadata"
    ],
  },
  callerChecks: Object.fromEntries(
    callerResults.map((row) => [rel(row.file), row.checks])
  ),
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    externalApiCalls: 0,
    ordersCreated: 0,
    ordersExecuted: 0,
    positionsChanged: 0,
    realTradingEnabled: false,
  },
  nextGate: "RUN_SELL_CALLER_CONTRACT_STATIC_TSC",
}, null, 2));

process.exitCode = 0;
