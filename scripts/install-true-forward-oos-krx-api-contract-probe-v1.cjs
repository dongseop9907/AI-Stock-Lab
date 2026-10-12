const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const SCRIPTS =
  path.join(
    ROOT,
    "scripts"
  );

const PACKAGE =
  path.join(
    ROOT,
    "package.json"
  );

const TARGET =
  path.join(
    SCRIPTS,
    "true-forward-oos-krx-api-contract-probe-v1.cjs"
  );

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_API_CONTRACT_PROBE_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "lib/trading/krx-trading-calendar.ts",
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  "package.json",
];

const missing =
  required.filter(
    rel =>
      !fs.existsSync(
        path.join(
          ROOT,
          rel
        )
      )
  );

if (missing.length > 0) {
  fail(
    "REQUIRED_FILES_MISSING",
    {
      missing,
    }
  );
} else {
  fs.writeFileSync(
    TARGET,
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst calendarRel =\n  \"lib/trading/krx-trading-calendar.ts\";\n\nconst producerRel =\n  \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\";\n\nfunction read(rel) {\n  return fs.readFileSync(\n    path.join(ROOT, rel),\n    \"utf8\"\n  );\n}\n\nfunction extractAround(text, pattern, before = 8, after = 28) {\n  const lines =\n    text.split(/\\r?\\n/);\n\n  const idx =\n    lines.findIndex(\n      line =>\n        pattern.test(line)\n    );\n\n  if (idx < 0) {\n    return [];\n  }\n\n  const start =\n    Math.max(\n      0,\n      idx - before\n    );\n\n  const end =\n    Math.min(\n      lines.length,\n      idx + after + 1\n    );\n\n  return lines\n    .slice(start, end)\n    .map(\n      (line, offset) => ({\n        line:\n          start + offset + 1,\n        text:\n          line\n      })\n    );\n}\n\nconst required = [\n  calendarRel,\n  producerRel,\n];\n\nconst missing =\n  required.filter(\n    rel =>\n      !fs.existsSync(\n        path.join(\n          ROOT,\n          rel\n        )\n      )\n  );\n\nif (missing.length > 0) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_API_CONTRACT_PROBE_V1_FAILED\",\n    reason:\n      \"REQUIRED_FILES_MISSING\",\n    missing,\n  }, null, 2));\n\n  process.exitCode = 1;\n} else {\n  const calendar =\n    read(calendarRel);\n\n  const producer =\n    read(producerRel);\n\n  const exportNames =\n    [...calendar.matchAll(\n      /export\\s+(?:async\\s+)?(?:function|const|let|class|type|interface)\\s+([A-Za-z_$][A-Za-z0-9_$]*)/g\n    )]\n      .map(match => match[1])\n      .filter(\n        (value, index, arr) =>\n          arr.indexOf(value) === index\n      );\n\n  const isTradingDateDefinition =\n    extractAround(\n      calendar,\n      /export\\s+function\\s+isKrxTradingDate\\s*\\(/\n    );\n\n  const nextTradingDateDefinition =\n    extractAround(\n      calendar,\n      /export\\s+function\\s+nextKrxTradingDate\\s*\\(/\n    );\n\n  const mergeOverridesDefinition =\n    extractAround(\n      calendar,\n      /export\\s+function\\s+mergeVerifiedKrxOverrides\\s*\\(/\n    );\n\n  const producerImport =\n    extractAround(\n      producer,\n      /from\\s+[\"'][^\"']*krx-trading-calendar[\"']/\n    );\n\n  const producerRuntimeOverride =\n    extractAround(\n      producer,\n      /market_exchange_calendar_overrides/\n    );\n\n  const producerNextDateCall =\n    extractAround(\n      producer,\n      /nextKrxTradingDate\\s*\\(/\n    );\n\n  const compact = {\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_API_CONTRACT_PROBE_V1_COMPLETE\",\n\n    exportNames,\n\n    isKrxTradingDateSignature:\n      isTradingDateDefinition.slice(0, 12),\n\n    nextKrxTradingDateSignature:\n      nextTradingDateDefinition.slice(0, 12),\n\n    mergeVerifiedKrxOverridesSignature:\n      mergeOverridesDefinition.slice(0, 12),\n\n    producerCalendarImport:\n      producerImport.slice(0, 12),\n\n    producerRuntimeOverrideUsage:\n      producerRuntimeOverride.slice(0, 18),\n\n    producerNextKrxTradingDateUsage:\n      producerNextDateCall.slice(0, 18),\n\n    safety: {\n      readOnly:\n        true,\n      filesModified:\n        0,\n      databaseReads:\n        0,\n      databaseWrites:\n        0,\n      ordersCreated:\n        0,\n      positionsChanged:\n        0,\n      realTradingEnabled:\n        false,\n    },\n\n    nextGate:\n      \"PATCH_AUTOMATION_BINDING_TO_CANONICAL_KRX_CALENDAR_V1\",\n  };\n\n  fs.mkdirSync(\n    path.join(\n      ROOT,\n      \"logs\"\n    ),\n    {\n      recursive: true\n    }\n  );\n\n  fs.writeFileSync(\n    path.join(\n      ROOT,\n      \"logs\",\n      \"true-forward-oos-krx-api-contract-probe-v1.json\"\n    ),\n    JSON.stringify(\n      compact,\n      null,\n      2\n    ),\n    \"utf8\"\n  );\n\n  console.log(JSON.stringify({\n    status:\n      compact.status,\n\n    exportNames:\n      compact.exportNames,\n\n    isKrxTradingDateSignature:\n      compact.isKrxTradingDateSignature,\n\n    mergeVerifiedKrxOverridesSignature:\n      compact.mergeVerifiedKrxOverridesSignature,\n\n    producerCalendarImport:\n      compact.producerCalendarImport,\n\n    producerRuntimeOverrideUsage:\n      compact.producerRuntimeOverrideUsage,\n\n    producerNextKrxTradingDateUsage:\n      compact.producerNextKrxTradingDateUsage,\n\n    nextGate:\n      compact.nextGate,\n  }, null, 2));\n\n  process.exitCode = 0;\n}\n",
    "utf8"
  );

  let pkg;

  try {
    pkg =
      JSON.parse(
        fs.readFileSync(
          PACKAGE,
          "utf8"
        )
      );
  } catch (error) {
    fail(
      "PACKAGE_JSON_PARSE_FAILED",
      {
        error:
          String(
            error instanceof Error
              ? error.message
              : error
          ),
      }
    );
  }

  if (pkg) {
    if (
      !pkg.scripts ||
      typeof pkg.scripts !== "object"
    ) {
      pkg.scripts = {};
    }

    pkg.scripts[
      "test:true-forward-oos-krx-api-contract"
    ] =
      "node ./scripts/true-forward-oos-krx-api-contract-probe-v1.cjs";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_API_CONTRACT_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/true-forward-oos-krx-api-contract-probe-v1.cjs",

      packageScript:
        "npm run test:true-forward-oos-krx-api-contract",

      mode:
        "READ_ONLY_EXACT_API_CONTRACT_PROBE",

      safety: {
        productSourceChanges:
          0,
        databaseReads:
          0,
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false,
      },

      nextAction:
        "RUN_EXACT_KRX_API_CONTRACT_PROBE",
    }, null, 2));
  }
}
