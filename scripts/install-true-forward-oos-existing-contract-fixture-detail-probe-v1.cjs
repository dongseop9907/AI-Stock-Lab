const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const TARGET = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-existing-contract-fixture-detail-probe-v1.cjs"
);
const PACKAGE = path.join(ROOT, "package.json");

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_TRUE_FORWARD_OOS_EXISTING_CONTRACT_FIXTURE_DETAIL_PROBE_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));
  process.exitCode = 1;
}

if (!fs.existsSync(PACKAGE)) {
  fail("PACKAGE_JSON_NOT_FOUND");
} else {
  fs.writeFileSync(TARGET, "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\nconst TARGET = path.join(\n  ROOT,\n  \"scripts\",\n  \"true-forward-oos-automation-binding-v1-contract-test.ts\"\n);\n\nfunction fail(reason, extra = {}) {\n  console.error(JSON.stringify({\n    status: \"AI_STOCK_LAB_TRUE_FORWARD_OOS_EXISTING_CONTRACT_FIXTURE_DETAIL_PROBE_V1_FAILED\",\n    reason,\n    ...extra,\n  }, null, 2));\n  process.exitCode = 1;\n}\n\nif (!fs.existsSync(TARGET)) {\n  fail(\"CONTRACT_TEST_NOT_FOUND\");\n} else {\n  const lines = fs.readFileSync(TARGET, \"utf8\").split(/\\r?\\n/);\n\n  const interesting = [];\n  const patterns = [\n    /new Date\\s*\\(/,\n    /Date\\.UTC\\s*\\(/,\n    /\\bnow\\s*:/,\n    /\\brunStep\\s*:/,\n    /\\bloadState\\s*:/,\n    /\\bsaveState\\s*:/,\n    /executed\\.join\\s*\\(/,\n    /status\\s*===/,\n    /const\\s+(produced|collectedAndEvaluated|summarized|missed|failedProduce|disabled)\\b/,\n  ];\n\n  for (let i = 0; i < lines.length; i++) {\n    if (patterns.some((re) => re.test(lines[i]))) {\n      const start = Math.max(0, i - 4);\n      const end = Math.min(lines.length, i + 9);\n\n      interesting.push({\n        anchorLine: i + 1,\n        snippet: lines.slice(start, end).map((text, offset) => ({\n          line: start + offset + 1,\n          text,\n        })),\n      });\n    }\n  }\n\n  const report = {\n    status: \"AI_STOCK_LAB_TRUE_FORWARD_OOS_EXISTING_CONTRACT_FIXTURE_DETAIL_PROBE_V1_COMPLETE\",\n    interesting: interesting.slice(0, 24),\n    safety: {\n      readOnly: true,\n      productSourceChanges: 0,\n      databaseReads: 0,\n      databaseWrites: 0,\n      ordersCreated: 0,\n      positionsChanged: 0,\n      realTradingEnabled: false,\n    },\n    nextGate: \"REPAIR_EXISTING_CONTRACT_FIXTURES_ONLY\",\n  };\n\n  fs.mkdirSync(path.join(ROOT, \"logs\"), { recursive: true });\n\n  fs.writeFileSync(\n    path.join(\n      ROOT,\n      \"logs\",\n      \"true-forward-oos-existing-contract-fixture-detail-probe-v1.json\"\n    ),\n    JSON.stringify(report, null, 2),\n    \"utf8\"\n  );\n\n  console.log(JSON.stringify({\n    status: report.status,\n    interesting: report.interesting,\n    nextGate: report.nextGate,\n  }, null, 2));\n\n  process.exitCode = 0;\n}\n", "utf8");

  const pkg = JSON.parse(fs.readFileSync(PACKAGE, "utf8"));
  pkg.scripts ||= {};
  pkg.scripts["test:true-forward-oos-existing-contract-fixture-detail"] =
    "node ./scripts/true-forward-oos-existing-contract-fixture-detail-probe-v1.cjs";

  fs.writeFileSync(
    PACKAGE,
    JSON.stringify(pkg, null, 2) + "\n",
    "utf8"
  );

  console.log(JSON.stringify({
    status: "AI_STOCK_LAB_TRUE_FORWARD_OOS_EXISTING_CONTRACT_FIXTURE_DETAIL_PROBE_V1_INSTALLED",
    generatedFile: "scripts/true-forward-oos-existing-contract-fixture-detail-probe-v1.cjs",
    packageScript: "npm run test:true-forward-oos-existing-contract-fixture-detail",
    safety: {
      productSourceChanges: 0,
      databaseWrites: 0,
      ordersCreated: 0,
      positionsChanged: 0,
      realTradingEnabled: false
    },
    nextAction: "RUN_COMPACT_FIXTURE_DETAIL_PROBE"
  }, null, 2));
}
