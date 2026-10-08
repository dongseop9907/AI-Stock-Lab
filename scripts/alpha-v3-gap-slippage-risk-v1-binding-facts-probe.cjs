const fs = require("fs");
const path = require("path");

const root = process.cwd();

const sourceFiles = [
  "lib/trading/execute-paper-order.ts",
  "lib/trading/execute-approved-paper-orders.ts",
  "app/api/orders/paper/execute/route.ts",
  "app/api/orders/paper/execute-approved/route.ts",
];

const migrationDir = path.resolve(
  root,
  "supabase/migrations",
);

function readIfExists(rel) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    return null;
  }

  return fs.readFileSync(abs, "utf8");
}

function extractSqlFunctionDefinitions(
  text,
  functionName,
) {
  const definitions = [];
  const lower = text.toLowerCase();
  const needle = `function public.${functionName.toLowerCase()}(`;

  let cursor = 0;

  while (true) {
    const hit = lower.indexOf(
      needle,
      cursor,
    );

    if (hit < 0) {
      break;
    }

    const createStartCandidates = [
      lower.lastIndexOf(
        "create or replace function",
        hit,
      ),
      lower.lastIndexOf(
        "create function",
        hit,
      ),
    ].filter((value) => value >= 0);

    const start =
      createStartCandidates.length
        ? Math.max(...createStartCandidates)
        : hit;

    const dollarEnd = lower.indexOf(
      "$$;",
      hit,
    );

    const semicolonEnd =
      dollarEnd >= 0
        ? dollarEnd + 3
        : lower.indexOf(";", hit) + 1;

    if (semicolonEnd <= 0) {
      break;
    }

    definitions.push(
      text.slice(
        start,
        semicolonEnd,
      ),
    );

    cursor = semicolonEnd;
  }

  return definitions;
}

function findLineMatches(
  text,
  patterns,
) {
  const lines = text.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        out.push({
          line: i + 1,
          key: pattern.key,
          text: line.trim(),
        });
      }
    }
  }

  return out;
}

const migrationFiles =
  fs.existsSync(migrationDir)
    ? fs
        .readdirSync(migrationDir)
        .filter((name) =>
          name.endsWith(".sql"),
        )
        .sort()
    : [];

const fillDefinitions = [];

for (const name of migrationFiles) {
  const rel =
    `supabase/migrations/${name}`;

  const text = readIfExists(rel);

  if (!text) {
    continue;
  }

  const definitions =
    extractSqlFunctionDefinitions(
      text,
      "execute_paper_buy_order",
    );

  for (const definition of definitions) {
    fillDefinitions.push({
      file: rel,
      definition,
    });
  }
}

const latestFill =
  fillDefinitions.at(-1) ?? null;

const latestText =
  latestFill?.definition ?? "";

const latestLower =
  latestText.toLowerCase();

const sqlSignals = {
  signatureOnlyOrderId:
    /execute_paper_buy_order\s*\(\s*p_order_id\s+uuid\s*\)/i.test(
      latestText,
    ),

  hasExecutionPriceParameter:
    /p_(execution|fill|market)_price\s+numeric/i.test(
      latestText,
    ),

  referencesOrderEntryPrice:
    /\b(v_order|order_row|v_locked_order)\.entry_price\b/i.test(
      latestText,
    ),

  assignsFillPriceFromEntryPrice:
    /(fill|execution|average|avg)[a-z0-9_]*\s*:?=\s*(v_order|order_row|v_locked_order)\.entry_price/i.test(
      latestText,
    ),

  positionAveragePriceUsesEntryPrice:
    /average_price[\s\S]{0,300}(v_order|order_row|v_locked_order)\.entry_price/i.test(
      latestText,
    ),

  positionQuantityUsesApprovedQuantity:
    /(quantity|filled_quantity)[\s\S]{0,180}(v_order|order_row|v_locked_order)\.approved_quantity/i.test(
      latestText,
    ),

  readsReservedRisk:
    /reserved_risk_amount/i.test(
      latestText,
    ),

  releasesReservedRisk:
    /reserved_risk_released_at|reserved_risk_release_reason|reserved_risk_amount\s*=\s*0/i.test(
      latestText,
    ),

  insertsOrUpdatesPosition:
    /insert\s+into\s+public\.paper_positions|update\s+public\.paper_positions/i.test(
      latestText,
    ),

  marksFilled:
    /status\s*=\s*'FILLED'|'FILLED'/i.test(
      latestText,
    ),
};

const app = {};

for (const rel of sourceFiles) {
  const text = readIfExists(rel);

  app[rel] = {
    exists: Boolean(text),
    lineCount: text
      ? text.split(/\r?\n/).length
      : 0,
    signals: text
      ? {
          callsExecuteRpc:
            /rpc\(\s*["']execute_paper_buy_order["']/i.test(
              text,
            ),

          passesOnlyOrderId:
            /execute_paper_buy_order[\s\S]{0,300}p_order_id/i.test(
              text,
            ),

          readsMarketSnapshot:
            /market_snapshots/i.test(
              text,
            ),

          readsClosePrice:
            /close_price/i.test(
              text,
            ),

          hasExecutionPriceVariable:
            /(executionPrice|fillPrice|marketPrice|currentPrice)/.test(
              text,
            ),

          invokesGapSlippageGuard:
            /evaluateBuyExecutionGapSlippageRisk/.test(
              text,
            ),
        }
      : null,

    relevantLines: text
      ? findLineMatches(
          text,
          [
            {
              key: "RPC",
              regex: /execute_paper_buy_order|\.rpc\(/i,
            },
            {
              key: "PRICE",
              regex: /executionPrice|fillPrice|marketPrice|currentPrice|close_price|entry_price/i,
            },
            {
              key: "ORDER",
              regex: /approved_quantity|reserved_risk_amount|stop_price|RISK_APPROVED/i,
            },
          ],
        ).slice(0, 20)
      : [],
  };
}

let executionPriceSource =
  "UNRESOLVED";

if (
  sqlSignals.signatureOnlyOrderId &&
  !sqlSignals.hasExecutionPriceParameter &&
  sqlSignals.referencesOrderEntryPrice
) {
  executionPriceSource =
    "ORDER_ENTRY_PRICE_INSIDE_DB_RPC";
}

const fillQuantitySource =
  sqlSignals.positionQuantityUsesApprovedQuantity
    ? "ORDER_APPROVED_QUANTITY"
    : "UNRESOLVED";

const averagePriceSource =
  sqlSignals.positionAveragePriceUsesEntryPrice
    ? "ORDER_ENTRY_PRICE"
    : "UNRESOLVED";

const reservedRiskTransfer =
  sqlSignals.readsReservedRisk ||
  sqlSignals.releasesReservedRisk
    ? "VISIBLE_IN_LATEST_FILL_RPC"
    : "NOT_VISIBLE_IN_LATEST_FILL_RPC";

const bindingReadiness =
  executionPriceSource ===
    "ORDER_ENTRY_PRICE_INSIDE_DB_RPC"
    ? "PAPER_FILL_HAS_NO_REAL_SLIPPAGE_PRICE_YET"
    : executionPriceSource ===
        "UNRESOLVED"
      ? "NEEDS_SOURCE_REVIEW"
      : "READY_FOR_EXECUTION_PRICE_GUARD_BINDING";

const report = {
  status:
    "ALPHA_V3_GAP_SLIPPAGE_RISK_V1_BINDING_FACTS_PROBE_COMPLETE",

  latestFillRpc: latestFill
    ? {
        file: latestFill.file,
        function:
          "execute_paper_buy_order",
        definitionCount:
          fillDefinitions.length,
      }
    : null,

  facts: {
    executionPriceSource,
    fillQuantitySource,
    averagePriceSource,
    reservedRiskTransfer,
    bindingReadiness,
  },

  sqlSignals,

  applicationSurfaces:
    app,

  interpretation: {
    ifOrderEntryPriceIsFillPrice:
      "Current PAPER execution models zero execution slippage; add an explicit simulated execution price before production guard binding.",

    ifDynamicPriceExists:
      "Bind gap/slippage evaluator immediately before RPC and repeat defense-in-depth in DB fill function.",

    protectiveExit:
      "Never block risk-reducing stop/trailing exits because of adverse gap.",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    ordersChanged: 0,
    positionsChanged: 0,
    productionChanged: false,
  },

  fullLogFile:
    "logs/alpha-v3-gap-slippage-risk-v1-binding-facts-probe.json",

  nextGate:
    bindingReadiness ===
      "PAPER_FILL_HAS_NO_REAL_SLIPPAGE_PRICE_YET"
      ? "IMPLEMENT_PAPER_EXECUTION_PRICE_MODEL_BEFORE_GUARD_BINDING"
      : bindingReadiness ===
          "READY_FOR_EXECUTION_PRICE_GUARD_BINDING"
        ? "BIND_GAP_SLIPPAGE_GUARD_TO_EXECUTORS_AND_DB_RPC"
        : "REVIEW_LATEST_FILL_RPC_DEFINITION",
};

fs.mkdirSync(
  path.resolve(
    root,
    "logs",
  ),
  {
    recursive: true,
  },
);

fs.writeFileSync(
  path.resolve(
    root,
    report.fullLogFile,
  ),
  JSON.stringify(
    report,
    null,
    2,
  ) + "\n",
  "utf8",
);

/*
 * Keep PowerShell output intentionally small.
 */
console.log(
  JSON.stringify(
    {
      status:
        report.status,

      latestFillRpc:
        report.latestFillRpc,

      facts:
        report.facts,

      sqlSignals: {
        signatureOnlyOrderId:
          sqlSignals.signatureOnlyOrderId,

        hasExecutionPriceParameter:
          sqlSignals.hasExecutionPriceParameter,

        referencesOrderEntryPrice:
          sqlSignals.referencesOrderEntryPrice,

        positionAveragePriceUsesEntryPrice:
          sqlSignals.positionAveragePriceUsesEntryPrice,

        positionQuantityUsesApprovedQuantity:
          sqlSignals.positionQuantityUsesApprovedQuantity,

        readsReservedRisk:
          sqlSignals.readsReservedRisk,

        releasesReservedRisk:
          sqlSignals.releasesReservedRisk,
      },

      appSummary:
        Object.fromEntries(
          Object.entries(app).map(
            ([file, value]) => [
              file,
              {
                exists:
                  value.exists,

                callsExecuteRpc:
                  value.signals
                    ?.callsExecuteRpc ??
                  false,

                readsMarketSnapshot:
                  value.signals
                    ?.readsMarketSnapshot ??
                  false,

                hasExecutionPriceVariable:
                  value.signals
                    ?.hasExecutionPriceVariable ??
                  false,

                invokesGapSlippageGuard:
                  value.signals
                    ?.invokesGapSlippageGuard ??
                  false,
              },
            ],
          ),
        ),

      safety:
        report.safety,

      fullLogFile:
        report.fullLogFile,

      nextGate:
        report.nextGate,
    },
    null,
    2,
  ),
);
