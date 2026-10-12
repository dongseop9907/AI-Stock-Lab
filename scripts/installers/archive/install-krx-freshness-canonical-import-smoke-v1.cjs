const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/krx-freshness-canonical-import-smoke-v1.ts"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "import * as freshnessModule\n  from \"../lib/market/get-market-data-freshness-v7-7\";\n\nimport {\n  isKrxTradingDate,\n  nextKrxTradingDate,\n  previousKrxTradingDate,\n} from \"../lib/trading/krx-trading-calendar\";\n\nfunction main() {\n  const checks = {\n    freshnessModuleImport:\n      freshnessModule !== null &&\n      typeof freshnessModule ===\n        \"object\" &&\n      Object.keys(\n        freshnessModule,\n      ).length > 0,\n\n    hangeulDayClosed:\n      isKrxTradingDate(\n        \"2026-10-09\",\n      ) === false,\n\n    nextSession:\n      nextKrxTradingDate(\n        \"2026-10-08\",\n      ) ===\n        \"2026-10-12\",\n\n    previousSession:\n      previousKrxTradingDate(\n        \"2026-10-12\",\n      ) ===\n        \"2026-10-08\",\n  };\n\n  const failed =\n    Object.entries(checks)\n      .filter(\n        ([, value]) =>\n          !value,\n      )\n      .map(\n        ([name]) =>\n          name,\n      );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          failed.length === 0\n            ? \"FRESHNESS_CANONICAL_IMPORT_SMOKE_VERIFIED\"\n            : \"FRESHNESS_CANONICAL_IMPORT_SMOKE_REVIEW\",\n\n        checks,\n        failed,\n\n        exportedSymbols:\n          Object.keys(\n            freshnessModule,\n          ).slice(0, 20),\n\n        safety: {\n          databaseReads: 0,\n          databaseWrites: 0,\n          networkCalls: 0,\n          ordersCreated: 0,\n          positionsChanged: 0,\n          productionChanged: false,\n        },\n\n        nextGate:\n          failed.length === 0\n            ? \"RUN_FORWARD_CONTRACT_AND_FRESHNESS_LIVE_READ_REGRESSION\"\n            : \"REVIEW_FRESHNESS_IMPORT_BINDING\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  if (failed.length > 0) {\n    process.exitCode = 2;\n  }\n}\n\nmain();\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "KRX_FRESHNESS_CANONICAL_IMPORT_SMOKE_V1_INSTALLED",

      generatedFile:
        "scripts/krx-freshness-canonical-import-smoke-v1.ts",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        productionChanged: false
      },

      nextAction:
        "RUN_IMPORT_SMOKE_AND_FORWARD_CONTRACT"
    },
    null,
    2
  )
);
