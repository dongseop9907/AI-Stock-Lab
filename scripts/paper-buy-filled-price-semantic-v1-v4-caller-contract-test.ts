import fs from "node:fs";
import path from "node:path";

const ROOT =
  process.cwd();

const source =
  fs.readFileSync(
    path.join(
      ROOT,
      "lib",
      "trading",
      "execute-paper-order.ts",
    ),
    "utf8",
  );

const rpcCallMatch =
  source.match(
    /\.rpc\(\s*"execute_paper_buy_order_with_execution_price_v4"\s*,\s*\{([\s\S]*?)\}\s*,?\s*\)/m,
  );

const argsBody =
  rpcCallMatch?.[1] ??
  "";

const argNames =
  [
    ...argsBody.matchAll(
      /\b(p_[a-z0-9_]+)\s*:/gi,
    ),
  ].map(
    match =>
      match[1],
  );

const expectedArgs = [
  "p_order_id",
  "p_execution_price",
  "p_execution_observed_at",
  "p_execution_price_source",
  "p_execution_provenance",
  "p_fill_quantity",
  "p_broker_fee",
];

const checks = {
  v4RpcCallFound:
    rpcCallMatch !==
    null,

  exactSevenArgs:
    expectedArgs.every(
      arg =>
        argNames.includes(
          arg,
        ),
    ) &&
    argNames.length ===
      expectedArgs.length,

  noUnexpectedRpcArgs:
    argNames.every(
      arg =>
        expectedArgs.includes(
          arg,
        ),
    ),

  executionPriceFromRealism:
    /p_execution_price:\s*realismDecision\.executionPrice/m.test(
      argsBody,
    ),

  observedAtFromSafeExecution:
    /p_execution_observed_at:[\s\S]*safeExecution\.executionPriceObservedAt/m.test(
      argsBody,
    ),

  sourceFromRealism:
    /p_execution_price_source:[\s\S]*realismDecision\.priceSource/m.test(
      argsBody,
    ),

  provenancePresent:
    /p_execution_provenance:/m.test(
      argsBody,
    ) &&
    source.includes(
      "PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1",
    ),

  fillQuantityFromRealism:
    /p_fill_quantity:[\s\S]*realismDecision\.filledQuantity/m.test(
      argsBody,
    ),

  brokerFeeFromRealism:
    /p_broker_fee:[\s\S]*realismDecision\.brokerFee/m.test(
      argsBody,
    ),

  noV3RpcCall:
    !source.includes(
      '"execute_paper_buy_order_with_execution_price_v3"',
    ),

  noRealTradingEnable:
    !/REAL_TRADING_ENABLED\s*=\s*true|ENABLE_REAL_TRADING\s*=\s*true|ENABLE_LIVE_TRADING\s*=\s*true/.test(
      source,
    ),
};

const failed =
  Object.entries(
    checks,
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
          ? "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_V4_CALLER_CONTRACT_PASS"
          : "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_V4_CALLER_CONTRACT_FAIL",

      rpc: {
        name:
          "execute_paper_buy_order_with_execution_price_v4",

        argNames,

        expectedArgs,
      },

      checks,
      failed,

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
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
