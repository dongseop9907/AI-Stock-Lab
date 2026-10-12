const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "lib",
  "trading",
  "execute-paper-order.ts"
);

const BACKUP_DIR = path.join(
  ROOT,
  "scripts",
  "backups",
  "paper-orderbook-execution-provenance-v1-caller-binding"
);

function fail(reason, details = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_CALLER_BINDING_FAIL",
        reason,
        ...details,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
  throw new Error(reason);
}

if (!fs.existsSync(TARGET)) {
  fail(
    "TARGET_NOT_FOUND",
    {
      target:
        path.relative(
          ROOT,
          TARGET
        ),
    }
  );
}

const before =
  fs.readFileSync(
    TARGET,
    "utf8"
  );

const oldRpcName =
  '"execute_paper_buy_order_with_execution_price_v2"';

const newRpcName =
  '"execute_paper_buy_order_with_execution_price_v3"';

const rpcNameCount =
  before.split(
    oldRpcName
  ).length - 1;

if (rpcNameCount !== 1) {
  fail(
    "V2_RPC_CALL_COUNT_UNEXPECTED",
    {
      count:
        rpcNameCount,
    }
  );
}

if (
  before.includes(
    newRpcName
  )
) {
  fail(
    "V3_RPC_ALREADY_BOUND"
  );
}

const oldArgs = `        p_execution_observed_at:
          safeExecution.executionPriceObservedAt,
        p_fill_quantity:
          realismDecision.filledQuantity,
        p_broker_fee:
          realismDecision.brokerFee,`;

const newArgs = `        p_execution_observed_at:
          safeExecution.executionPriceObservedAt,

        p_execution_price_source:
          realismDecision.priceSource,

        p_execution_provenance: {
          version:
            "PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1",

          side:
            "BUY",

          stockCode:
            order.stock_code,

          execution: {
            price:
              realismDecision.executionPrice,

            priceSource:
              realismDecision.priceSource,

            filledQuantity:
              realismDecision.filledQuantity,

            brokerFee:
              realismDecision.brokerFee,

            syntheticSpreadBps:
              realismDecision.syntheticSpreadBps,

            marketImpactBps:
              realismDecision.marketImpactBps,

            totalAdversePriceBps:
              realismDecision.totalAdversePriceBps,

            topOfBookQuantityCap:
              realismDecision.topOfBookQuantityCap,
          },

          orderbook: {
            source:
              orderbookQuote.source,

            quote:
              orderbookQuote.quote,

            session:
              orderbookQuote.session,

            freshnessBlocker:
              orderbookQuote.freshnessBlocker,

            serverAcceptedHour:
              orderbookQuote.serverAcceptedHour,

            serverQuoteAgeMs:
              orderbookQuote.serverQuoteAgeMs,
          },

          marketInput: {
            intervalVolume:
              realismMarketInput.intervalVolume,
          },
        },

        p_fill_quantity:
          realismDecision.filledQuantity,

        p_broker_fee:
          realismDecision.brokerFee,`;

if (!before.includes(oldArgs)) {
  fail(
    "RPC_ARGUMENT_ANCHOR_NOT_FOUND"
  );
}

let after =
  before.replace(
    oldRpcName,
    newRpcName
  );

after =
  after.replace(
    oldArgs,
    newArgs
  );

const checks = {
  v3RpcBound:
    after.includes(
      newRpcName
    ),

  v2RpcCallRemoved:
    !after.includes(
      oldRpcName
    ),

  actualPriceSourcePassed:
    after.includes(
      "p_execution_price_source:"
    ) &&
    after.includes(
      "realismDecision.priceSource"
    ),

  provenancePassed:
    after.includes(
      "p_execution_provenance:"
    ),

  provenanceVersioned:
    after.includes(
      "PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1"
    ),

  orderbookIncluded:
    after.includes(
      "orderbookQuote.source"
    ) &&
    after.includes(
      "orderbookQuote.quote"
    ) &&
    after.includes(
      "orderbookQuote.serverQuoteAgeMs"
    ),

  realismIncluded:
    after.includes(
      "realismDecision.marketImpactBps"
    ) &&
    after.includes(
      "realismDecision.syntheticSpreadBps"
    ) &&
    after.includes(
      "realismDecision.topOfBookQuantityCap"
    ),

  marketInputIncluded:
    after.includes(
      "realismMarketInput.intervalVolume"
    ),

  noTradingEnable:
    !/REAL_TRADING_ENABLED\s*=\s*true|ENABLE_REAL_TRADING\s*=\s*true|ENABLE_LIVE_TRADING\s*=\s*true/.test(
      after
    ),
};

const failed =
  Object.entries(checks)
    .filter(
      ([, ok]) =>
        ok !== true
    )
    .map(
      ([name]) =>
        name
    );

if (failed.length > 0) {
  fail(
    "MEMORY_GUARD_FAILED",
    {
      checks,
      failed,
      targetWrites:
        0,
    }
  );
}

fs.mkdirSync(
  BACKUP_DIR,
  {
    recursive:
      true,
  }
);

const backup =
  path.join(
    BACKUP_DIR,
    "execute-paper-order.ts"
  );

if (!fs.existsSync(backup)) {
  fs.writeFileSync(
    backup,
    before,
    "utf8"
  );
}

fs.writeFileSync(
  TARGET,
  after,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_CALLER_BOUND",

      changedFile:
        "lib/trading/execute-paper-order.ts",

      rpc: {
        from:
          "execute_paper_buy_order_with_execution_price_v2",

        to:
          "execute_paper_buy_order_with_execution_price_v3",
      },

      provenance: {
        priceSource:
          "realismDecision.priceSource",

        includes: [
          "execution price",
          "filled quantity",
          "broker fee",
          "synthetic spread bps",
          "market impact bps",
          "total adverse price bps",
          "top-of-book quantity cap",
          "orderbook source",
          "normalized quote",
          "KRX session state",
          "freshness blocker",
          "KIS server accepted hour",
          "server quote age ms",
          "interval volume"
        ],
      },

      checks,
      failed,

      safety: {
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
        "RUN_CALLER_BINDING_STATIC_AND_TSC",
    },
    null,
    2
  )
);

process.exitCode = 0;
