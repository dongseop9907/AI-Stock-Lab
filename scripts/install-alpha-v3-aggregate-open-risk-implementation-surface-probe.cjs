const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-aggregate-open-risk-implementation-surface-probe.ts"
);

const source = "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nconst ROOT = process.cwd();\nconst VERSION =\n  \"ALPHA_V3_AGGREGATE_OPEN_RISK_IMPLEMENTATION_SURFACE_PROBE_V1\";\n\nconst FILES = [\n  \"lib/trading/policy.ts\",\n  \"lib/trading/types.ts\",\n  \"lib/trading/risk-manager.ts\",\n  \"lib/trading/paper-order-service.ts\",\n  \"lib/trading/update-trailing-stops.ts\",\n  \"lib/trading/check-stop-losses.ts\",\n  \"lib/trading/execute-paper-order.ts\",\n];\n\nconst TERMS = [\n  \"interface RiskPolicy\",\n  \"DEFAULT_RISK_POLICY\",\n  \"BuyRiskInput\",\n  \"BuyRiskResult\",\n  \"validateBuyRisk\",\n  \"paper_positions\",\n  \"stop_price\",\n  \"average_price\",\n  \"quantity\",\n  \"riskResult\",\n  \"riskInput\",\n  \"result_payload\",\n  \"highest_price\",\n  \"trailing\",\n];\n\nfunction context(\n  lines: string[],\n  index: number,\n  radius = 5,\n) {\n  const start =\n    Math.max(0, index - radius);\n\n  const end =\n    Math.min(\n      lines.length,\n      index + radius + 1,\n    );\n\n  return {\n    startLine:\n      start + 1,\n\n    endLine:\n      end,\n\n    text:\n      lines\n        .slice(start, end)\n        .join(\"\\n\"),\n  };\n}\n\nfunction scan(\n  relativePath: string,\n) {\n  const absolute =\n    path.resolve(\n      ROOT,\n      relativePath,\n    );\n\n  if (\n    !fs.existsSync(\n      absolute,\n    )\n  ) {\n    return {\n      file:\n        relativePath,\n\n      exists:\n        false,\n\n      lineCount:\n        0,\n\n      matches: [],\n    };\n  }\n\n  const text =\n    fs.readFileSync(\n      absolute,\n      \"utf8\",\n    );\n\n  const lines =\n    text.split(\n      /\\r?\\n/,\n    );\n\n  const matches: Array<{\n    term: string;\n    line: number;\n    context: ReturnType<typeof context>;\n  }> = [];\n\n  for (\n    let i = 0;\n    i < lines.length;\n    i += 1\n  ) {\n    for (\n      const term of TERMS\n    ) {\n      if (\n        lines[i].includes(\n          term,\n        )\n      ) {\n        matches.push({\n          term,\n\n          line:\n            i + 1,\n\n          context:\n            context(\n              lines,\n              i,\n            ),\n        });\n\n        break;\n      }\n    }\n\n    if (\n      matches.length >=\n      40\n    ) {\n      break;\n    }\n  }\n\n  return {\n    file:\n      relativePath,\n\n    exists:\n      true,\n\n    lineCount:\n      lines.length,\n\n    matches,\n  };\n}\n\nfunction searchRepositoryForStopPrice() {\n  const targets = [\n    \"lib\",\n    \"app\",\n    \"supabase\",\n    \"sql\",\n    \"scripts\",\n  ];\n\n  const results: Array<{\n    file: string;\n    line: number;\n    text: string;\n  }> = [];\n\n  function walk(\n    dir: string,\n  ) {\n    if (\n      !fs.existsSync(\n        dir,\n      )\n    ) {\n      return;\n    }\n\n    const entries =\n      fs.readdirSync(\n        dir,\n        {\n          withFileTypes:\n            true,\n        },\n      );\n\n    for (\n      const entry of entries\n    ) {\n      if (\n        entry.name ===\n          \"node_modules\" ||\n        entry.name ===\n          \".next\" ||\n        entry.name ===\n          \".git\"\n      ) {\n        continue;\n      }\n\n      const absolute =\n        path.join(\n          dir,\n          entry.name,\n        );\n\n      if (\n        entry.isDirectory()\n      ) {\n        walk(\n          absolute,\n        );\n\n        continue;\n      }\n\n      if (\n        !/\\.(ts|tsx|js|cjs|mjs|sql)$/i.test(\n          entry.name,\n        )\n      ) {\n        continue;\n      }\n\n      let text = \"\";\n\n      try {\n        text =\n          fs.readFileSync(\n            absolute,\n            \"utf8\",\n          );\n      } catch {\n        continue;\n      }\n\n      const lines =\n        text.split(\n          /\\r?\\n/,\n        );\n\n      for (\n        let i = 0;\n        i < lines.length;\n        i += 1\n      ) {\n        if (\n          lines[i].includes(\n            \"stop_price\",\n          ) ||\n          lines[i].includes(\n            \"paper_positions\",\n          )\n        ) {\n          results.push({\n            file:\n              path\n                .relative(\n                  ROOT,\n                  absolute,\n                )\n                .replaceAll(\n                  \"\\\\\",\n                  \"/\",\n                ),\n\n            line:\n              i + 1,\n\n            text:\n              lines[i].trim(),\n          });\n        }\n\n        if (\n          results.length >=\n          120\n        ) {\n          return;\n        }\n      }\n    }\n  }\n\n  for (\n    const target of targets\n  ) {\n    walk(\n      path.resolve(\n        ROOT,\n        target,\n      ),\n    );\n\n    if (\n      results.length >=\n      120\n    ) {\n      break;\n    }\n  }\n\n  return results;\n}\n\nconst output = {\n  status:\n    \"ALPHA_V3_AGGREGATE_OPEN_RISK_IMPLEMENTATION_SURFACE_PROBE_COMPLETE\",\n\n  version:\n    VERSION,\n\n  proposedPolicy: {\n    maxAggregateOpenRiskRate:\n      0.02,\n\n    formula:\n      \"sum(max(0, averagePrice - stopPrice) * quantity) + proposedTradeRisk <= accountEquity * 0.02\",\n\n    missingStopHandling:\n      \"REJECT_NEW_RISK_APPROVAL\",\n  },\n\n  files:\n    FILES.map(\n      scan,\n    ),\n\n  repositoryStopPriceReferences:\n    searchRepositoryForStopPrice(),\n\n  safety: {\n    databaseReads:\n      0,\n\n    databaseWrites:\n      0,\n\n    kisRequests:\n      0,\n\n    ordersCreated:\n      0,\n\n    positionsChanged:\n      0,\n\n    productionChanged:\n      false,\n  },\n\n  nextGate:\n    \"IMPLEMENT_ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET\",\n};\n\nconsole.log(\n  JSON.stringify(\n    output,\n    null,\n    2,\n  ),\n);\n";

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  source,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_AGGREGATE_OPEN_RISK_IMPLEMENTATION_SURFACE_PROBE_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-aggregate-open-risk-implementation-surface-probe.ts",

      productionChanged:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      nextAction:
        "RUN_ALPHA_V3_AGGREGATE_OPEN_RISK_IMPLEMENTATION_SURFACE_PROBE"
    },
    null,
    2
  )
);
