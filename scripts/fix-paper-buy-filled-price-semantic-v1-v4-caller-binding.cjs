const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET =
  path.join(
    ROOT,
    "lib",
    "trading",
    "execute-paper-order.ts"
  );

const BACKUP_DIR =
  path.join(
    ROOT,
    "scripts",
    "backups",
    "paper-buy-filled-price-semantic-v1-v4-caller-binding"
  );

const OLD_RPC =
  '"execute_paper_buy_order_with_execution_price_v3"';

const NEW_RPC =
  '"execute_paper_buy_order_with_execution_price_v4"';

function fail(reason, details = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_V4_CALLER_BINDING_FAIL",
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
        "lib/trading/execute-paper-order.ts",
    }
  );
}

const before =
  fs.readFileSync(
    TARGET,
    "utf8"
  );

const oldCount =
  before.split(
    OLD_RPC
  ).length - 1;

const newCountBefore =
  before.split(
    NEW_RPC
  ).length - 1;

if (newCountBefore > 0) {
  fail(
    "V4_ALREADY_BOUND",
    {
      v4Count:
        newCountBefore,
      sourceWrites:
        0,
    }
  );
}

if (oldCount !== 1) {
  fail(
    "V3_CALL_COUNT_UNEXPECTED",
    {
      expected:
        1,
      actual:
        oldCount,
      sourceWrites:
        0,
    }
  );
}

const requiredBefore = {
  executionPrice:
    before.includes(
      "p_execution_price:"
    ) &&
    before.includes(
      "realismDecision.executionPrice"
    ),

  observedAt:
    before.includes(
      "p_execution_observed_at:"
    ) &&
    before.includes(
      "safeExecution.executionPriceObservedAt"
    ),

  executionSource:
    before.includes(
      "p_execution_price_source:"
    ) &&
    before.includes(
      "realismDecision.priceSource"
    ),

  provenance:
    before.includes(
      "p_execution_provenance:"
    ) &&
    before.includes(
      "PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1"
    ),

  fillQuantity:
    before.includes(
      "p_fill_quantity:"
    ) &&
    before.includes(
      "realismDecision.filledQuantity"
    ),

  brokerFee:
    before.includes(
      "p_broker_fee:"
    ) &&
    before.includes(
      "realismDecision.brokerFee"
    ),

  orderbook:
    before.includes(
      "orderbookQuote"
    ),

  freshness:
    before.includes(
      "freshnessBlocker"
    ),

  marketImpact:
    before.includes(
      "marketImpactBps"
    ),

  topOfBook:
    before.includes(
      "topOfBookQuantityCap"
    ),

  noRealTradingEnable:
    !/REAL_TRADING_ENABLED\s*=\s*true|ENABLE_REAL_TRADING\s*=\s*true|ENABLE_LIVE_TRADING\s*=\s*true/.test(
      before
    ),
};

const missingBefore =
  Object.entries(
    requiredBefore
  )
    .filter(
      ([, ok]) =>
        ok !== true
    )
    .map(
      ([name]) =>
        name
    );

if (missingBefore.length > 0) {
  fail(
    "PRE_BINDING_CONTRACT_NOT_PROVEN",
    {
      checks:
        requiredBefore,
      failed:
        missingBefore,
      sourceWrites:
        0,
    }
  );
}

const after =
  before.replace(
    OLD_RPC,
    NEW_RPC
  );

const checks = {
  v4BoundExactlyOnce:
    (
      after.split(
        NEW_RPC
      ).length - 1
    ) === 1,

  v3CallerRemoved:
    !after.includes(
      OLD_RPC
    ),

  executionPricePreserved:
    after.includes(
      "p_execution_price:"
    ) &&
    after.includes(
      "realismDecision.executionPrice"
    ),

  observedAtPreserved:
    after.includes(
      "p_execution_observed_at:"
    ) &&
    after.includes(
      "safeExecution.executionPriceObservedAt"
    ),

  executionSourcePreserved:
    after.includes(
      "p_execution_price_source:"
    ) &&
    after.includes(
      "realismDecision.priceSource"
    ),

  provenancePreserved:
    after.includes(
      "p_execution_provenance:"
    ) &&
    after.includes(
      "PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1"
    ),

  fillQuantityPreserved:
    after.includes(
      "p_fill_quantity:"
    ) &&
    after.includes(
      "realismDecision.filledQuantity"
    ),

  brokerFeePreserved:
    after.includes(
      "p_broker_fee:"
    ) &&
    after.includes(
      "realismDecision.brokerFee"
    ),

  orderbookPreserved:
    after.includes(
      "orderbookQuote"
    ),

  freshnessPreserved:
    after.includes(
      "freshnessBlocker"
    ),

  marketImpactPreserved:
    after.includes(
      "marketImpactBps"
    ),

  topOfBookPreserved:
    after.includes(
      "topOfBookQuantityCap"
    ),

  onlyRpcIdentifierChanged:
    after ===
      before.replace(
        OLD_RPC,
        NEW_RPC
      ),

  noRealTradingEnable:
    !/REAL_TRADING_ENABLED\s*=\s*true|ENABLE_REAL_TRADING\s*=\s*true|ENABLE_LIVE_TRADING\s*=\s*true/.test(
      after
    ),
};

const failed =
  Object.entries(
    checks
  )
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
    "POST_BINDING_CONTRACT_FAILED",
    {
      checks,
      failed,
      sourceWrites:
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
        "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_V4_CALLER_BOUND",

      changedFile:
        "lib/trading/execute-paper-order.ts",

      rpc: {
        from:
          "execute_paper_buy_order_with_execution_price_v3",

        to:
          "execute_paper_buy_order_with_execution_price_v4",
      },

      mutationScope: {
        rpcIdentifierOnly:
          true,

        provenancePayloadModified:
          false,

        realismLogicModified:
          false,

        orderbookLogicModified:
          false,

        freshnessLogicModified:
          false,

        riskLogicModified:
          false,
      },

      checks,

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
        "RUN_BUY_V4_CALLER_STATIC_CONTRACT_TSC",
    },
    null,
    2
  )
);

process.exitCode = 0;
