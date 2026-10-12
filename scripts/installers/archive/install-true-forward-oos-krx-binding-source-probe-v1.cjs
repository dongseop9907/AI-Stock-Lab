const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, "scripts");
const PACKAGE = path.join(ROOT, "package.json");
const BACKUPS = path.join(SCRIPTS, "backups");

const TARGET =
  path.join(
    SCRIPTS,
    "true-forward-oos-krx-binding-source-probe-v1.cjs"
  );

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_BINDING_SOURCE_PROBE_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "lib/research/run-true-forward-oos-automation-binding-v1.ts",
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  "scripts/alpha-v3-forward-oos-krx-calendar-binding-probe-v1.cjs",
  "package.json",
];

const missing =
  required.filter(rel =>
    !fs.existsSync(
      path.join(ROOT, rel)
    )
  );

if (missing.length > 0) {
  fail(
    "REQUIRED_FILES_MISSING",
    { missing }
  );
} else {
  fs.mkdirSync(
    BACKUPS,
    { recursive: true }
  );

  const packageBackup =
    path.join(
      BACKUPS,
      "package.before-true-forward-oos-krx-binding-source-probe-v1.json"
    );

  if (!fs.existsSync(packageBackup)) {
    fs.copyFileSync(
      PACKAGE,
      packageBackup
    );
  }

  fs.writeFileSync(
    TARGET,
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst targets = {\n  binding:\n    \"lib/research/run-true-forward-oos-automation-binding-v1.ts\",\n\n  producer:\n    \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\",\n\n  collector:\n    \"scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts\",\n\n  krxProbe:\n    \"scripts/alpha-v3-forward-oos-krx-calendar-binding-probe-v1.cjs\",\n};\n\nfunction read(rel) {\n  return fs.readFileSync(\n    path.join(ROOT, rel),\n    \"utf8\"\n  );\n}\n\nfunction extractSignals(text) {\n  const lines =\n    text.split(/\\r?\\n/);\n\n  const imports =\n    lines.filter(line =>\n      /^\\s*import\\b/.test(line) ||\n      /^\\s*const\\s+.*require\\(/.test(line)\n    );\n\n  const calendarLines =\n    lines.filter(line =>\n      /(krx|calendar|holiday|weekend|trading.?day|market.?day|session.?date|isTrading|isMarket|\ud734\uc7a5|\uacf5\ud734\uc77c)/i.test(line)\n    );\n\n  const identifiers = new Set();\n\n  for (const line of calendarLines) {\n    for (const match of line.matchAll(/\\b[A-Za-z_$][A-Za-z0-9_$]*\\b/g)) {\n      const id = match[0];\n\n      if (\n        /(krx|calendar|holiday|weekend|trading|market|session|business|open|close|day)/i.test(id)\n      ) {\n        identifiers.add(id);\n      }\n    }\n  }\n\n  return {\n    imports: imports.slice(0, 30),\n    calendarLines: calendarLines.slice(0, 60),\n    identifiers: [...identifiers].slice(0, 40),\n  };\n}\n\nconst missing =\n  Object.entries(targets)\n    .filter(([, rel]) =>\n      !fs.existsSync(\n        path.join(ROOT, rel)\n      )\n    )\n    .map(([key]) => key);\n\nif (missing.length > 0) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_BINDING_SOURCE_PROBE_V1_FAILED\",\n    reason:\n      \"REQUIRED_FILES_MISSING\",\n    missing,\n  }, null, 2));\n\n  process.exitCode = 1;\n} else {\n  const result = {};\n\n  for (const [key, rel] of Object.entries(targets)) {\n    result[key] =\n      extractSignals(\n        read(rel)\n      );\n  }\n\n  const reusableCandidates = [\n    ...result.producer.identifiers,\n    ...result.collector.identifiers,\n    ...result.krxProbe.identifiers,\n  ].filter((value, index, arr) =>\n    arr.indexOf(value) === index\n  );\n\n  const report = {\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_BINDING_SOURCE_PROBE_V1_COMPLETE\",\n\n    reusableCandidates,\n\n    producer: result.producer,\n    collector: result.collector,\n    krxProbe: result.krxProbe,\n\n    binding: {\n      identifiers:\n        result.binding.identifiers,\n      hasDirectCalendarGuard:\n        result.binding.calendarLines.length > 0,\n    },\n\n    safety: {\n      readOnly: true,\n      productSourceChanges: 0,\n      databaseWrites: 0,\n      ordersCreated: 0,\n      positionsChanged: 0,\n      realTradingEnabled: false,\n    },\n\n    nextGate:\n      \"IMPLEMENT_BINDING_KRX_GUARD_USING_DISCOVERED_EXISTING_CALENDAR_SURFACE\",\n  };\n\n  fs.mkdirSync(\n    path.join(ROOT, \"logs\"),\n    { recursive: true }\n  );\n\n  fs.writeFileSync(\n    path.join(\n      ROOT,\n      \"logs\",\n      \"true-forward-oos-krx-binding-source-probe-v1.json\"\n    ),\n    JSON.stringify(report, null, 2),\n    \"utf8\"\n  );\n\n  console.log(JSON.stringify({\n    status:\n      report.status,\n\n    reusableCandidates:\n      reusableCandidates.slice(0, 15),\n\n    producerCalendarIdentifiers:\n      result.producer.identifiers.slice(0, 12),\n\n    collectorCalendarIdentifiers:\n      result.collector.identifiers.slice(0, 12),\n\n    krxProbeIdentifiers:\n      result.krxProbe.identifiers.slice(0, 12),\n\n    bindingHasDirectCalendarGuard:\n      report.binding.hasDirectCalendarGuard,\n\n    nextGate:\n      report.nextGate,\n  }, null, 2));\n\n  process.exitCode = 0;\n}\n",
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
      "test:true-forward-oos-krx-binding-source-probe"
    ] =
      "node ./scripts/true-forward-oos-krx-binding-source-probe-v1.cjs";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(pkg, null, 2) + "\n",
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_BINDING_SOURCE_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/true-forward-oos-krx-binding-source-probe-v1.cjs",

      packageScript:
        "npm run test:true-forward-oos-krx-binding-source-probe",

      mode:
        "READ_ONLY_SOURCE_DISCOVERY",

      safety: {
        productSourceChanges: 0,
        databaseWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        realTradingEnabled: false,
      },

      nextAction:
        "RUN_COMPACT_KRX_SOURCE_PROBE",
    }, null, 2));
  }
}
