const fs = require("fs");
const path = require("path");

const root = process.cwd();

const candidates = [
  "lib/market/market-regime-v7-policy.ts",
  "lib/market/market-regime-policy-v7.ts",
];

const target = candidates.find((rel) =>
  fs.existsSync(path.resolve(root, rel))
);

if (!target) {
  throw new Error("V7_POLICY_SOURCE_NOT_FOUND");
}

const abs = path.resolve(root, target);
const source = fs.readFileSync(abs, "utf8");
const lines = source.split(/\r?\n/);

const anchors = [
  "evaluateMarketRegimeV7Policy",
  "BLOCK_BREADTH_OR_HIGH_VOL",
  "blocked",
  "breadth",
  "vol",
  "reason",
];

const hits = [];

for (let i = 0; i < lines.length; i += 1) {
  const text = lines[i];

  const matched =
    anchors.filter((anchor) =>
      text.includes(anchor)
    );

  if (matched.length === 0) {
    continue;
  }

  hits.push({
    line: i + 1,
    matched,
    text: text.trim().slice(0, 240),
  });
}

const relevant =
  hits.filter((hit) =>
    hit.matched.includes("blocked") ||
    hit.matched.includes("BLOCK_BREADTH_OR_HIGH_VOL") ||
    hit.matched.includes("evaluateMarketRegimeV7Policy")
  );

const compact =
  relevant.slice(0, 18);

const output = {
  status:
    "MARKET_REGIME_V7_POLICY_BLOCKED_SOURCE_PROBE_V1_COMPLETE",
  policyFile: target,
  compact,
  allHits: hits,
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesModified: 0,
    regimePolicyChanged: false,
    forwardEvidenceChanged: false,
    ordersCreated: 0,
    positionsChanged: 0,
  },
  fullDetails:
    "logs/market-regime-v7-policy-blocked-source-probe-v1.json",
  nextGate:
    "CONFIRM_BLOCKED_BOOLEAN_INVERSION_AND_PATCH_WITH_REGRESSION_TEST",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true },
);

fs.writeFileSync(
  path.resolve(root, output.fullDetails),
  JSON.stringify(output, null, 2) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status: output.status,
      policyFile: output.policyFile,
      blockedSurface: compact,
      nextGate: output.nextGate,
      details: output.fullDetails,
    },
    null,
    2,
  ),
);
