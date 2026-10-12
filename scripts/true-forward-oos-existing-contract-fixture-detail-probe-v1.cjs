const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const TARGET = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-automation-binding-v1-contract-test.ts"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_TRUE_FORWARD_OOS_EXISTING_CONTRACT_FIXTURE_DETAIL_PROBE_V1_FAILED",
    reason,
    ...extra,
  }, null, 2));
  process.exitCode = 1;
}

if (!fs.existsSync(TARGET)) {
  fail("CONTRACT_TEST_NOT_FOUND");
} else {
  const lines = fs.readFileSync(TARGET, "utf8").split(/\r?\n/);

  const interesting = [];
  const patterns = [
    /new Date\s*\(/,
    /Date\.UTC\s*\(/,
    /\bnow\s*:/,
    /\brunStep\s*:/,
    /\bloadState\s*:/,
    /\bsaveState\s*:/,
    /executed\.join\s*\(/,
    /status\s*===/,
    /const\s+(produced|collectedAndEvaluated|summarized|missed|failedProduce|disabled)\b/,
  ];

  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((re) => re.test(lines[i]))) {
      const start = Math.max(0, i - 4);
      const end = Math.min(lines.length, i + 9);

      interesting.push({
        anchorLine: i + 1,
        snippet: lines.slice(start, end).map((text, offset) => ({
          line: start + offset + 1,
          text,
        })),
      });
    }
  }

  const report = {
    status: "AI_STOCK_LAB_TRUE_FORWARD_OOS_EXISTING_CONTRACT_FIXTURE_DETAIL_PROBE_V1_COMPLETE",
    interesting: interesting.slice(0, 24),
    safety: {
      readOnly: true,
      productSourceChanges: 0,
      databaseReads: 0,
      databaseWrites: 0,
      ordersCreated: 0,
      positionsChanged: 0,
      realTradingEnabled: false,
    },
    nextGate: "REPAIR_EXISTING_CONTRACT_FIXTURES_ONLY",
  };

  fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });

  fs.writeFileSync(
    path.join(
      ROOT,
      "logs",
      "true-forward-oos-existing-contract-fixture-detail-probe-v1.json"
    ),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log(JSON.stringify({
    status: report.status,
    interesting: report.interesting,
    nextGate: report.nextGate,
  }, null, 2));

  process.exitCode = 0;
}
