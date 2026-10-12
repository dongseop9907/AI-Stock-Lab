const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const outRel =
  "scripts/paper-order-regression-shape-probe-v2.cjs";
const outPath =
  path.join(ROOT, outRel);

const probe = String.raw`const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const targets = [
  "scripts/paper-buy-execution-event-idempotency-v1-post-deploy-regression.ts",
  "scripts/paper-protective-sell-v4-runtime-replay-regression-v1.ts",
];

function read(rel) {
  const full = path.join(ROOT, rel);

  return fs.existsSync(full)
    ? fs.readFileSync(full, "utf8")
    : "";
}

function contexts(source, regex, radius = 3, max = 20) {
  const lines = source.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    if (!regex.test(lines[i])) {
      regex.lastIndex = 0;
      continue;
    }

    regex.lastIndex = 0;

    const start =
      Math.max(0, i - radius);

    const end =
      Math.min(
        lines.length - 1,
        i + radius,
      );

    out.push({
      line: i + 1,
      context: lines
        .slice(start, end + 1)
        .map((text, idx) => ({
          line: start + idx + 1,
          text,
        })),
    });

    if (out.length >= max) {
      break;
    }
  }

  return out;
}

function findFunctions(source) {
  const names = new Set();

  const patterns = [
    /function\s+([A-Za-z0-9_]+)\s*\(/g,
    /const\s+([A-Za-z0-9_]+)\s*=\s*async\s*\(/g,
    /async\s+function\s+([A-Za-z0-9_]+)\s*\(/g,
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.exec(source))) {
      names.add(match[1]);
    }
  }

  return [...names];
}

function extractUrls(source) {
  const urls = new Set();

  const patterns = [
    /["'`](\/rest\/v1\/[^"'`]+)["'`]/g,
    /["'`](\/rpc\/[^"'`]+)["'`]/g,
    /["'`](https?:\/\/[^"'`]+)["'`]/g,
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.exec(source))) {
      urls.add(match[1]);
    }
  }

  return [...urls];
}

function extractEnvRefs(source) {
  return [
    ...new Set(
      [...source.matchAll(
        /process\.env\.([A-Z0-9_]+)/g
      )].map((m) => m[1]),
    ),
  ];
}

const results = [];

for (const rel of targets) {
  const source = read(rel);

  results.push({
    file: rel,
    exists: source.length > 0,
    functions: findFunctions(source),
    envRefs: extractEnvRefs(source),
    literalUrls: extractUrls(source),

    signals: {
      fetch:
        /\bfetch\s*\(/.test(source),

      createClient:
        /\bcreateClient\s*\(/.test(source),

      rpcMethod:
        /\.rpc\s*\(/.test(source),

      restRpc:
        /rest\/v1\/rpc|\/rpc\//i.test(source),

      restTable:
        /rest\/v1\//i.test(source),

      authorizationBearer:
        /Authorization|Bearer/i.test(source),

      serviceRole:
        /SUPABASE_SERVICE_ROLE_KEY/.test(source),

      insert:
        /\binsert\b|POST/i.test(source),

      delete:
        /\bdelete\b|DELETE/i.test(source),

      rollback:
        /rollback/i.test(source),

      buyV5:
        /execute_paper_buy_order_with_execution_price_v5/.test(source),

      sellV4:
        /execute_paper_protective_sell_v4/.test(source),

      accountTable:
        /paper_accounts/.test(source),

      orderTable:
        /paper_order_requests/.test(source),

      positionTable:
        /paper_positions/.test(source),

      tradeTable:
        /paper_trade_history/.test(source),

      buyLedger:
        /paper_buy_execution_events_v1/.test(source),

      sellLedger:
        /paper_protective_execution_fills_v2/.test(source),
    },

    importantContexts: {
      fetch:
        contexts(
          source,
          /\bfetch\s*\(/,
          4,
          12,
        ),

      rpc:
        contexts(
          source,
          /execute_paper_buy_order_with_execution_price_v5|execute_paper_protective_sell_v4|rest\/v1\/rpc|\/rpc\//i,
          5,
          20,
        ),

      fixture:
        contexts(
          source,
          /paper_accounts|paper_order_requests|paper_positions|paper_trade_history|paper_buy_execution_events_v1|paper_protective_execution_fills_v2/i,
          4,
          30,
        ),

      cleanup:
        contexts(
          source,
          /DELETE|cleanup|delete|rollback/i,
          4,
          20,
        ),

      payload:
        contexts(
          source,
          /body\s*:|JSON\.stringify|headers\s*:|method\s*:/i,
          4,
          25,
        ),
    },
  });
}

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_PAPER_ORDER_REGRESSION_SHAPE_PROBE_V2_COMPLETE",

      results,

      interpretation: {
        goal:
          "Extract exact existing HTTP/RPC fixture and cleanup shapes without connecting to DB.",

        next:
          "Generate final two-client concurrent BUY V5 / SELL V4 stress harness from these exact shapes.",
      },

      safety: {
        readOnly: true,
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        rpcInvoked: false,
        secretsPrinted: false,
        ordersCreated: 0,
        positionsChanged: 0,
        realTradingEnabled: false,
      },
    },
    null,
    2,
  ),
);

process.exitCode = 0;
`;

fs.mkdirSync(
  path.dirname(outPath),
  { recursive: true },
);

fs.writeFileSync(
  outPath,
  probe,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_PAPER_ORDER_REGRESSION_SHAPE_PROBE_V2_INSTALLED",

      generatedFile:
        outRel,

      reads: [
        "paper-buy-execution-event-idempotency-v1-post-deploy-regression.ts",
        "paper-protective-sell-v4-runtime-replay-regression-v1.ts",
      ],

      productSourceChanges: 0,

      safety: {
        sourceOnly: true,
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        rpcInvoked: false,
        secretsPrinted: false,
        realTradingEnabled: false,
      },

      nextAction:
        "RUN_SHAPE_PROBE_AND_FULL_TSC",
    },
    null,
    2,
  ),
);
