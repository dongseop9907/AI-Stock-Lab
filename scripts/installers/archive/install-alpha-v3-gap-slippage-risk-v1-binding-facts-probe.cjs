const fs = require("fs");
const path = require("path");

const root = process.cwd();

const target = path.resolve(
  root,
  "scripts/alpha-v3-gap-slippage-risk-v1-binding-facts-probe.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst sourceFiles = [\n  \"lib/trading/execute-paper-order.ts\",\n  \"lib/trading/execute-approved-paper-orders.ts\",\n  \"app/api/orders/paper/execute/route.ts\",\n  \"app/api/orders/paper/execute-approved/route.ts\",\n];\n\nconst migrationDir = path.resolve(\n  root,\n  \"supabase/migrations\",\n);\n\nfunction readIfExists(rel) {\n  const abs = path.resolve(root, rel);\n\n  if (!fs.existsSync(abs)) {\n    return null;\n  }\n\n  return fs.readFileSync(abs, \"utf8\");\n}\n\nfunction extractSqlFunctionDefinitions(\n  text,\n  functionName,\n) {\n  const definitions = [];\n  const lower = text.toLowerCase();\n  const needle = `function public.${functionName.toLowerCase()}(`;\n\n  let cursor = 0;\n\n  while (true) {\n    const hit = lower.indexOf(\n      needle,\n      cursor,\n    );\n\n    if (hit < 0) {\n      break;\n    }\n\n    const createStartCandidates = [\n      lower.lastIndexOf(\n        \"create or replace function\",\n        hit,\n      ),\n      lower.lastIndexOf(\n        \"create function\",\n        hit,\n      ),\n    ].filter((value) => value >= 0);\n\n    const start =\n      createStartCandidates.length\n        ? Math.max(...createStartCandidates)\n        : hit;\n\n    const dollarEnd = lower.indexOf(\n      \"$$;\",\n      hit,\n    );\n\n    const semicolonEnd =\n      dollarEnd >= 0\n        ? dollarEnd + 3\n        : lower.indexOf(\";\", hit) + 1;\n\n    if (semicolonEnd <= 0) {\n      break;\n    }\n\n    definitions.push(\n      text.slice(\n        start,\n        semicolonEnd,\n      ),\n    );\n\n    cursor = semicolonEnd;\n  }\n\n  return definitions;\n}\n\nfunction findLineMatches(\n  text,\n  patterns,\n) {\n  const lines = text.split(/\\r?\\n/);\n  const out = [];\n\n  for (let i = 0; i < lines.length; i += 1) {\n    const line = lines[i];\n\n    for (const pattern of patterns) {\n      if (pattern.regex.test(line)) {\n        out.push({\n          line: i + 1,\n          key: pattern.key,\n          text: line.trim(),\n        });\n      }\n    }\n  }\n\n  return out;\n}\n\nconst migrationFiles =\n  fs.existsSync(migrationDir)\n    ? fs\n        .readdirSync(migrationDir)\n        .filter((name) =>\n          name.endsWith(\".sql\"),\n        )\n        .sort()\n    : [];\n\nconst fillDefinitions = [];\n\nfor (const name of migrationFiles) {\n  const rel =\n    `supabase/migrations/${name}`;\n\n  const text = readIfExists(rel);\n\n  if (!text) {\n    continue;\n  }\n\n  const definitions =\n    extractSqlFunctionDefinitions(\n      text,\n      \"execute_paper_buy_order\",\n    );\n\n  for (const definition of definitions) {\n    fillDefinitions.push({\n      file: rel,\n      definition,\n    });\n  }\n}\n\nconst latestFill =\n  fillDefinitions.at(-1) ?? null;\n\nconst latestText =\n  latestFill?.definition ?? \"\";\n\nconst latestLower =\n  latestText.toLowerCase();\n\nconst sqlSignals = {\n  signatureOnlyOrderId:\n    /execute_paper_buy_order\\s*\\(\\s*p_order_id\\s+uuid\\s*\\)/i.test(\n      latestText,\n    ),\n\n  hasExecutionPriceParameter:\n    /p_(execution|fill|market)_price\\s+numeric/i.test(\n      latestText,\n    ),\n\n  referencesOrderEntryPrice:\n    /\\b(v_order|order_row|v_locked_order)\\.entry_price\\b/i.test(\n      latestText,\n    ),\n\n  assignsFillPriceFromEntryPrice:\n    /(fill|execution|average|avg)[a-z0-9_]*\\s*:?=\\s*(v_order|order_row|v_locked_order)\\.entry_price/i.test(\n      latestText,\n    ),\n\n  positionAveragePriceUsesEntryPrice:\n    /average_price[\\s\\S]{0,300}(v_order|order_row|v_locked_order)\\.entry_price/i.test(\n      latestText,\n    ),\n\n  positionQuantityUsesApprovedQuantity:\n    /(quantity|filled_quantity)[\\s\\S]{0,180}(v_order|order_row|v_locked_order)\\.approved_quantity/i.test(\n      latestText,\n    ),\n\n  readsReservedRisk:\n    /reserved_risk_amount/i.test(\n      latestText,\n    ),\n\n  releasesReservedRisk:\n    /reserved_risk_released_at|reserved_risk_release_reason|reserved_risk_amount\\s*=\\s*0/i.test(\n      latestText,\n    ),\n\n  insertsOrUpdatesPosition:\n    /insert\\s+into\\s+public\\.paper_positions|update\\s+public\\.paper_positions/i.test(\n      latestText,\n    ),\n\n  marksFilled:\n    /status\\s*=\\s*'FILLED'|'FILLED'/i.test(\n      latestText,\n    ),\n};\n\nconst app = {};\n\nfor (const rel of sourceFiles) {\n  const text = readIfExists(rel);\n\n  app[rel] = {\n    exists: Boolean(text),\n    lineCount: text\n      ? text.split(/\\r?\\n/).length\n      : 0,\n    signals: text\n      ? {\n          callsExecuteRpc:\n            /rpc\\(\\s*[\"']execute_paper_buy_order[\"']/i.test(\n              text,\n            ),\n\n          passesOnlyOrderId:\n            /execute_paper_buy_order[\\s\\S]{0,300}p_order_id/i.test(\n              text,\n            ),\n\n          readsMarketSnapshot:\n            /market_snapshots/i.test(\n              text,\n            ),\n\n          readsClosePrice:\n            /close_price/i.test(\n              text,\n            ),\n\n          hasExecutionPriceVariable:\n            /(executionPrice|fillPrice|marketPrice|currentPrice)/.test(\n              text,\n            ),\n\n          invokesGapSlippageGuard:\n            /evaluateBuyExecutionGapSlippageRisk/.test(\n              text,\n            ),\n        }\n      : null,\n\n    relevantLines: text\n      ? findLineMatches(\n          text,\n          [\n            {\n              key: \"RPC\",\n              regex: /execute_paper_buy_order|\\.rpc\\(/i,\n            },\n            {\n              key: \"PRICE\",\n              regex: /executionPrice|fillPrice|marketPrice|currentPrice|close_price|entry_price/i,\n            },\n            {\n              key: \"ORDER\",\n              regex: /approved_quantity|reserved_risk_amount|stop_price|RISK_APPROVED/i,\n            },\n          ],\n        ).slice(0, 20)\n      : [],\n  };\n}\n\nlet executionPriceSource =\n  \"UNRESOLVED\";\n\nif (\n  sqlSignals.signatureOnlyOrderId &&\n  !sqlSignals.hasExecutionPriceParameter &&\n  sqlSignals.referencesOrderEntryPrice\n) {\n  executionPriceSource =\n    \"ORDER_ENTRY_PRICE_INSIDE_DB_RPC\";\n}\n\nconst fillQuantitySource =\n  sqlSignals.positionQuantityUsesApprovedQuantity\n    ? \"ORDER_APPROVED_QUANTITY\"\n    : \"UNRESOLVED\";\n\nconst averagePriceSource =\n  sqlSignals.positionAveragePriceUsesEntryPrice\n    ? \"ORDER_ENTRY_PRICE\"\n    : \"UNRESOLVED\";\n\nconst reservedRiskTransfer =\n  sqlSignals.readsReservedRisk ||\n  sqlSignals.releasesReservedRisk\n    ? \"VISIBLE_IN_LATEST_FILL_RPC\"\n    : \"NOT_VISIBLE_IN_LATEST_FILL_RPC\";\n\nconst bindingReadiness =\n  executionPriceSource ===\n    \"ORDER_ENTRY_PRICE_INSIDE_DB_RPC\"\n    ? \"PAPER_FILL_HAS_NO_REAL_SLIPPAGE_PRICE_YET\"\n    : executionPriceSource ===\n        \"UNRESOLVED\"\n      ? \"NEEDS_SOURCE_REVIEW\"\n      : \"READY_FOR_EXECUTION_PRICE_GUARD_BINDING\";\n\nconst report = {\n  status:\n    \"ALPHA_V3_GAP_SLIPPAGE_RISK_V1_BINDING_FACTS_PROBE_COMPLETE\",\n\n  latestFillRpc: latestFill\n    ? {\n        file: latestFill.file,\n        function:\n          \"execute_paper_buy_order\",\n        definitionCount:\n          fillDefinitions.length,\n      }\n    : null,\n\n  facts: {\n    executionPriceSource,\n    fillQuantitySource,\n    averagePriceSource,\n    reservedRiskTransfer,\n    bindingReadiness,\n  },\n\n  sqlSignals,\n\n  applicationSurfaces:\n    app,\n\n  interpretation: {\n    ifOrderEntryPriceIsFillPrice:\n      \"Current PAPER execution models zero execution slippage; add an explicit simulated execution price before production guard binding.\",\n\n    ifDynamicPriceExists:\n      \"Bind gap/slippage evaluator immediately before RPC and repeat defense-in-depth in DB fill function.\",\n\n    protectiveExit:\n      \"Never block risk-reducing stop/trailing exits because of adverse gap.\",\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    ordersChanged: 0,\n    positionsChanged: 0,\n    productionChanged: false,\n  },\n\n  fullLogFile:\n    \"logs/alpha-v3-gap-slippage-risk-v1-binding-facts-probe.json\",\n\n  nextGate:\n    bindingReadiness ===\n      \"PAPER_FILL_HAS_NO_REAL_SLIPPAGE_PRICE_YET\"\n      ? \"IMPLEMENT_PAPER_EXECUTION_PRICE_MODEL_BEFORE_GUARD_BINDING\"\n      : bindingReadiness ===\n          \"READY_FOR_EXECUTION_PRICE_GUARD_BINDING\"\n        ? \"BIND_GAP_SLIPPAGE_GUARD_TO_EXECUTORS_AND_DB_RPC\"\n        : \"REVIEW_LATEST_FILL_RPC_DEFINITION\",\n};\n\nfs.mkdirSync(\n  path.resolve(\n    root,\n    \"logs\",\n  ),\n  {\n    recursive: true,\n  },\n);\n\nfs.writeFileSync(\n  path.resolve(\n    root,\n    report.fullLogFile,\n  ),\n  JSON.stringify(\n    report,\n    null,\n    2,\n  ) + \"\\n\",\n  \"utf8\",\n);\n\n/*\n * Keep PowerShell output intentionally small.\n */\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        report.status,\n\n      latestFillRpc:\n        report.latestFillRpc,\n\n      facts:\n        report.facts,\n\n      sqlSignals: {\n        signatureOnlyOrderId:\n          sqlSignals.signatureOnlyOrderId,\n\n        hasExecutionPriceParameter:\n          sqlSignals.hasExecutionPriceParameter,\n\n        referencesOrderEntryPrice:\n          sqlSignals.referencesOrderEntryPrice,\n\n        positionAveragePriceUsesEntryPrice:\n          sqlSignals.positionAveragePriceUsesEntryPrice,\n\n        positionQuantityUsesApprovedQuantity:\n          sqlSignals.positionQuantityUsesApprovedQuantity,\n\n        readsReservedRisk:\n          sqlSignals.readsReservedRisk,\n\n        releasesReservedRisk:\n          sqlSignals.releasesReservedRisk,\n      },\n\n      appSummary:\n        Object.fromEntries(\n          Object.entries(app).map(\n            ([file, value]) => [\n              file,\n              {\n                exists:\n                  value.exists,\n\n                callsExecuteRpc:\n                  value.signals\n                    ?.callsExecuteRpc ??\n                  false,\n\n                readsMarketSnapshot:\n                  value.signals\n                    ?.readsMarketSnapshot ??\n                  false,\n\n                hasExecutionPriceVariable:\n                  value.signals\n                    ?.hasExecutionPriceVariable ??\n                  false,\n\n                invokesGapSlippageGuard:\n                  value.signals\n                    ?.invokesGapSlippageGuard ??\n                  false,\n              },\n            ],\n          ),\n        ),\n\n      safety:\n        report.safety,\n\n      fullLogFile:\n        report.fullLogFile,\n\n      nextGate:\n        report.nextGate,\n    },\n    null,\n    2,\n  ),\n);\n",
  "utf8"
);

const packagePath = path.resolve(
  root,
  "package.json"
);

const pkg = JSON.parse(
  fs.readFileSync(
    packagePath,
    "utf8"
  )
);

pkg.scripts = pkg.scripts ?? {};

pkg.scripts[
  "risk:gap-slippage:binding-probe"
] =
  "node scripts/alpha-v3-gap-slippage-risk-v1-binding-facts-probe.cjs";

fs.writeFileSync(
  packagePath,
  JSON.stringify(
    pkg,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_GAP_SLIPPAGE_RISK_V1_BINDING_FACTS_PROBE_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-gap-slippage-risk-v1-binding-facts-probe.cjs",

      consoleMode:
        "COMPACT",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        productionChanged: false
      },

      nextAction:
        "RUN_RISK_GAP_SLIPPAGE_BINDING_PROBE"
    },
    null,
    2
  )
);
