const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  "app/api/market/regime/v7/freshness/capture/route.ts",
  "app/api/market/regime/v7/quality-gate/capture/route.ts",
  "app/api/signals/entry/generate/route.ts",
  "app/api/trading/automation/run/route.ts",
  "lib/trading/generate-entry-signals.ts",
  "lib/trading/paper-order-service.ts",
  "lib/trading/execute-approved-paper-orders.ts",
  "lib/trading/execute-paper-order.ts",
  "lib/trading/kill-switch-guard.ts"
];

function read(rel) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    return null;
  }

  return fs.readFileSync(abs, "utf8");
}

function contexts(text, patterns, radius = 10) {
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  const hits = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (
      patterns.some(
        (pattern) => pattern.test(line)
      )
    ) {
      const start =
        Math.max(0, i - radius);

      const end =
        Math.min(
          lines.length,
          i + radius + 1
        );

      hits.push({
        line: i + 1,
        excerpt:
          lines
            .slice(start, end)
            .map(
              (value, index) =>
                `${start + index + 1}: ${value}`
            )
            .join("\n")
      });
    }
  }

  return hits;
}

const report = {
  status:
    "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_PATH_PROBE_V1_COMPLETE",

  files: [],

  summary: {
    targetCount:
      targets.length,

    existingCount:
      0,

    missingCount:
      0,

    freshnessAwareCount:
      0,

    productionBlockingAwareCount:
      0
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    positionsChanged: 0
  },

  logFile:
    "logs/alpha-v3-data-freshness-production-path-probe-v1.json",

  nextGate:
    "DEFINE_DATA_FRESHNESS_PRODUCTION_CONTRACT_V1"
};

for (const rel of targets) {
  const text = read(rel);

  const item = {
    file: rel,
    exists: Boolean(text),
    flags: {
      freshness:
        Boolean(
          text &&
          /freshness|STALE|usableForShadowComparison|expectedMarketDate/i.test(
            text
          )
        ),

      qualityGate:
        Boolean(
          text &&
          /quality-gate|qualityGate|FAIL_FRESHNESS|usableForForwardShadow/i.test(
            text
          )
        ),

      productionApplied:
        Boolean(
          text &&
          /productionApplied|autoOrder|paperOrderEnabled|emergencyStop/i.test(
            text
          )
        ),

      newRiskWrite:
        Boolean(
          text &&
          /createPaperBuyOrder|create_paper_buy_order|executePaperOrder|execute_paper_buy_order|RISK_APPROVED/i.test(
            text
          )
        ),

      staleBlocksNewRisk:
        Boolean(
          text &&
          /STALE[\s\S]{0,500}(block|reject|deny|throw|return)/i.test(
            text
          )
        )
    },

    contexts: contexts(
      text,
      [
        /freshness/i,
        /FAIL_FRESHNESS/i,
        /productionApplied/i,
        /usableForShadowComparison/i,
        /usableForForwardShadow/i,
        /autoOrder/i,
        /createPaperBuyOrder/i,
        /executePaperOrder/i
      ],
      8
    )
  };

  report.files.push(item);

  if (item.exists) {
    report.summary.existingCount += 1;
  } else {
    report.summary.missingCount += 1;
  }

  if (
    item.flags.freshness ||
    item.flags.qualityGate
  ) {
    report.summary.freshnessAwareCount += 1;
  }

  if (
    item.flags.productionApplied ||
    item.flags.staleBlocksNewRisk
  ) {
    report.summary.productionBlockingAwareCount += 1;
  }
}

const logPath =
  path.resolve(
    root,
    report.logFile
  );

fs.mkdirSync(
  path.dirname(logPath),
  { recursive: true }
);

fs.writeFileSync(
  logPath,
  JSON.stringify(
    report,
    null,
    2
  ) + "\n",
  "utf8"
);

const concise = {
  status:
    report.status,

  summary:
    report.summary,

  likelyProductionGaps:
    report.files
      .filter(
        (item) =>
          item.exists &&
          (
            item.flags.newRiskWrite ||
            item.flags.productionApplied
          ) &&
          !item.flags.staleBlocksNewRisk
      )
      .map(
        (item) => item.file
      ),

  freshnessSources:
    report.files
      .filter(
        (item) =>
          item.exists &&
          (
            item.flags.freshness ||
            item.flags.qualityGate
          )
      )
      .map(
        (item) => item.file
      ),

  logFile:
    report.logFile,

  nextGate:
    report.nextGate
};

console.log(
  JSON.stringify(
    concise,
    null,
    2
  )
);
