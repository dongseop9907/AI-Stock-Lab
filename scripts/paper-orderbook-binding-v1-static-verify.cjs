const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const FILES = {
  kis:
    "lib/kis/client.ts",

  adapter:
    "lib/trading/resolve-paper-execution-realism-v2-orderbook-quote.ts",

  buy:
    "lib/trading/execute-paper-order.ts",

  sell:
    "lib/trading/resolve-protective-sell-execution-realism-v2.ts",

  contract:
    "scripts/paper-orderbook-binding-v1-contract-test.ts",
};

function read(rel) {
  const abs =
    path.join(
      ROOT,
      rel,
    );

  return fs.existsSync(
    abs,
  )
    ? fs.readFileSync(
        abs,
        "utf8",
      )
    : "";
}

const kis =
  read(
    FILES.kis,
  );

const adapter =
  read(
    FILES.adapter,
  );

const buy =
  read(
    FILES.buy,
  );

const sell =
  read(
    FILES.sell,
  );

const contract =
  read(
    FILES.contract,
  );

const checks = {
  allFilesExist:
    Object.values(
      FILES,
    ).every(
      rel =>
        fs.existsSync(
          path.join(
            ROOT,
            rel,
          ),
        ),
    ),

  officialKisEndpointPresent:
    kis.includes(
      "/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn",
    ),

  officialKisTrIdPresent:
    kis.includes(
      "FHKST01010200",
    ),

  topOfBookFieldsPresent:
    [
      "askp1",
      "bidp1",
      "askp_rsqn1",
      "bidp_rsqn1",
    ].every(
      field =>
        kis.includes(
          field,
        ) &&
        adapter.includes(
          field,
        ),
    ),

  adapterUsesReadOnlyKis:
    adapter.includes(
      "getDomesticStockOrderbook",
    ) &&
    adapter.includes(
      "getKisAccessToken",
    ) &&
    adapter.includes(
      "KIS_DOMESTIC_ORDERBOOK_REST",
    ),

  buyPassesQuote:
    buy.includes(
      "resolvePaperExecutionRealismV2OrderbookQuote",
    ) &&
    buy.includes(
      "quote:\n        orderbookQuote.quote",
    ),

  sellPassesQuote:
    sell.includes(
      "resolvePaperExecutionRealismV2OrderbookQuote",
    ) &&
    sell.includes(
      "quote:\n        orderbookQuote.quote",
    ),

  quoteTimeUsedAsNow:
    buy.includes(
      "orderbookQuote.quote?.observedAt",
    ) &&
    sell.includes(
      "orderbookQuote.quote?.observedAt",
    ),

  syntheticFallbackPreserved:
    adapter.includes(
      'source:\n        "KIS_ORDERBOOK_READ_FAILED"',
    ) &&
    adapter.includes(
      "quote:\n        null",
    ),

  contractHasNoNetworkCall:
    !contract.includes(
      "getDomesticStockOrderbook(",
    ) &&
    !contract.includes(
      "getKisAccessToken(",
    ),

  noTradingEnableIntroduced:
    !kis.includes(
      "REAL_TRADING_ENABLED=true",
    ) &&
    !adapter.includes(
      "REAL_TRADING_ENABLED=true",
    ) &&
    !buy.includes(
      "REAL_TRADING_ENABLED=true",
    ) &&
    !sell.includes(
      "REAL_TRADING_ENABLED=true",
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
        failed.length ===
          0
          ? "AI_STOCK_LAB_PAPER_ORDERBOOK_BINDING_V1_STATIC_PASS"
          : "AI_STOCK_LAB_PAPER_ORDERBOOK_BINDING_V1_STATIC_FAIL",

      checks,

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
        positionsChanged:
          0,
        realTradingEnabled:
          false,
      },

      failed,

      nextGate:
        failed.length ===
          0
          ? "APP_TSC_THEN_READ_ONLY_KIS_ORDERBOOK_RUNTIME_PROBE"
          : "REPAIR_PAPER_ORDERBOOK_BINDING_V1",
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length ===
    0
    ? 0
    : 1;
