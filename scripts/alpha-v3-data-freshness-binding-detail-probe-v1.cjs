const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  {
    file: "lib/trading/generate-entry-signals.ts",
    anchors: [
      "export async function generateEntrySignals",
      "assertKillSwitchAllows",
      "createPaperBuyOrder",
      "const supabase"
    ]
  },
  {
    file: "lib/trading/paper-order-service.ts",
    anchors: [
      "export async function createPaperBuyOrder",
      "assertKillSwitchAllows",
      "const supabase",
      "create_paper_buy_order_with_committed_risk_v3"
    ]
  },
  {
    file: "lib/trading/execute-approved-paper-orders.ts",
    anchors: [
      "export async function executeApprovedPaperOrders",
      "assertKillSwitchAllows",
      "const supabase",
      "executePaperOrder"
    ]
  },
  {
    file: "lib/trading/execute-paper-order.ts",
    anchors: [
      "export async function executePaperOrder",
      "assertKillSwitchAllows",
      "const supabase",
      "execute_paper_buy_order"
    ]
  },
  {
    file: "app/api/trading/automation/run/route.ts",
    anchors: [
      "export async function POST",
      "const autoOrder",
      "generateEntrySignals",
      "emergencyStop",
      "paperOrderEnabled"
    ]
  }
];

function excerpt(lines, index, before = 8, after = 14) {
  const start = Math.max(0, index - before);
  const end = Math.min(lines.length, index + after + 1);

  return lines
    .slice(start, end)
    .map(
      (line, offset) =>
        `${start + offset + 1}: ${line}`
    )
    .join("\n");
}

const report = {
  status:
    "ALPHA_V3_DATA_FRESHNESS_BINDING_DETAIL_PROBE_V1_COMPLETE",
  files: [],
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    positionsChanged: 0
  },
  logFile:
    "logs/alpha-v3-data-freshness-binding-detail-probe-v1.json",
  nextGate:
    "PATCH_CANONICAL_FRESHNESS_GUARD_TO_PRODUCTION_PATHS_V1"
};

for (const target of targets) {
  const abs = path.resolve(root, target.file);

  if (!fs.existsSync(abs)) {
    report.files.push({
      file: target.file,
      exists: false,
      anchors: []
    });
    continue;
  }

  const text = fs.readFileSync(abs, "utf8");
  const lines = text.split(/\r?\n/);

  const anchorResults = [];

  for (const anchor of target.anchors) {
    const index =
      lines.findIndex(
        (line) => line.includes(anchor)
      );

    anchorResults.push({
      anchor,
      line:
        index >= 0
          ? index + 1
          : null,
      excerpt:
        index >= 0
          ? excerpt(lines, index)
          : null
    });
  }

  report.files.push({
    file: target.file,
    exists: true,
    anchors: anchorResults
  });
}

const logAbs =
  path.resolve(root, report.logFile);

fs.mkdirSync(
  path.dirname(logAbs),
  { recursive: true }
);

fs.writeFileSync(
  logAbs,
  JSON.stringify(
    report,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status: report.status,
      files:
        report.files.map(
          (item) => ({
            file: item.file,
            anchors:
              item.anchors.map(
                (a) => ({
                  anchor: a.anchor,
                  line: a.line
                })
              )
          })
        ),
      logFile: report.logFile,
      nextGate: report.nextGate
    },
    null,
    2
  )
);
