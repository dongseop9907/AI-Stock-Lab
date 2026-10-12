const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

function read(rel) {
  const abs = path.join(
    ROOT,
    rel
  );

  if (!fs.existsSync(abs)) {
    throw new Error(
      `MISSING_FILE:${rel}`
    );
  }

  return fs.readFileSync(
    abs,
    "utf8"
  );
}

const krx = read(
  "lib/trading/krx-trading-calendar.ts"
);

const adapter = read(
  "lib/trading/resolve-paper-execution-realism-v2-orderbook-quote.ts"
);

const buy = read(
  "lib/trading/execute-paper-order.ts"
);

const sell = read(
  "lib/trading/resolve-protective-sell-execution-realism-v2.ts"
);

const gateIndex =
  adapter.indexOf(
    "!session.isRegularSession"
  );

const tokenIndex =
  adapter.indexOf(
    "getKisAccessToken()"
  );

const checks = {
  krxSessionHelperPresent:
    krx.includes(
      "resolveKrxRegularTradingSessionState"
    ),

  krxSessionWindowPresent:
    krx.includes(
      '"09:00"'
    ) &&
    krx.includes(
      '"15:30"'
    ),

  adapterImportsCanonicalKrx:
    adapter.includes(
      'from "@/lib/trading/krx-trading-calendar"'
    ),

  sessionGateBeforeKisCall:
    gateIndex >= 0 &&
    tokenIndex >= 0 &&
    gateIndex <
      tokenIndex,

  serverAcceptedHourUsed:
    adapter.includes(
      "aspr_acpt_hour"
    ),

  staleQuoteFailClosed:
    adapter.includes(
      '"KIS_ORDERBOOK_STALE"'
    ),

  missingServerTimeFailClosed:
    adapter.includes(
      '"KIS_ORDERBOOK_SERVER_TIME_UNAVAILABLE"'
    ),

  buyUsesExistingFailureTransition:
    buy.includes(
      "PAPER_EXECUTION_ORDERBOOK_FRESHNESS_BLOCKED"
    ) &&
    buy.includes(
      "await failUnsafePaperBuyExecution"
    ),

  buyFreshnessGateBeforeRealismDecision:
    buy.indexOf(
      "PAPER_EXECUTION_ORDERBOOK_FRESHNESS_BLOCKED"
    ) >= 0 &&
    buy.indexOf(
      "PAPER_EXECUTION_ORDERBOOK_FRESHNESS_BLOCKED"
    ) <
      buy.indexOf(
        "const realismDecision"
      ),

  protectiveSellFreshnessGate:
    sell.includes(
      "PROTECTIVE_SELL_ORDERBOOK_FRESHNESS_BLOCKED"
    ),

  protectiveSellFreshnessGateBeforeFallback:
    sell.indexOf(
      "PROTECTIVE_SELL_ORDERBOOK_FRESHNESS_BLOCKED"
    ) >= 0 &&
    sell.indexOf(
      "PROTECTIVE_SELL_ORDERBOOK_FRESHNESS_BLOCKED"
    ) <
      sell.indexOf(
        "protectiveFallbackUsed"
      ),

  noRealTradingEnable:
    ![
      krx,
      adapter,
      buy,
      sell,
    ].some(
      text =>
        /REAL_TRADING_ENABLED\s*=\s*true|ENABLE_REAL_TRADING\s*=\s*true|ENABLE_LIVE_TRADING\s*=\s*true/.test(
          text
        )
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_ORDERBOOK_KRX_SESSION_FRESHNESS_V1_STATIC_VERIFIED"
          : "AI_STOCK_LAB_PAPER_ORDERBOOK_KRX_SESSION_FRESHNESS_V1_STATIC_FAILED",

      checks,

      safety: {
        sourceOnly:
          true,
        databaseWrites:
          0,
        ordersCreated:
          0,
        ordersExecuted:
          0,
        realTradingEnabled:
          false,
      },

      failed,
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
