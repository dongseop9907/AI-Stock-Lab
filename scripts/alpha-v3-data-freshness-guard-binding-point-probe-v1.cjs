const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  {
    file: "lib/trading/generate-entry-signals.ts",
    labels: [
      /export\s+async\s+function\s+generateEntrySignals/,
      /createSupabase/i,
      /supabase/i,
      /autoOrder/i,
      /createPaperBuyOrder/i
    ]
  },
  {
    file: "lib/trading/paper-order-service.ts",
    labels: [
      /export\s+async\s+function/i,
      /createSupabase/i,
      /supabase/i,
      /create_paper_buy_order_with_committed_risk_v3/i,
      /\.rpc\(/i
    ]
  },
  {
    file: "lib/trading/execute-approved-paper-orders.ts",
    labels: [
      /export\s+async\s+function/i,
      /createSupabase/i,
      /supabase/i,
      /executePaperOrder/i,
      /RISK_APPROVED/i
    ]
  },
  {
    file: "lib/trading/execute-paper-order.ts",
    labels: [
      /export\s+async\s+function/i,
      /createSupabase/i,
      /supabase/i,
      /execute_paper_buy_order/i,
      /\.rpc\(/i
    ]
  },
  {
    file: "app/api/trading/automation/run/route.ts",
    labels: [
      /generateEntrySignals/i,
      /autoOrder/i,
      /emergencyStop/i,
      /paperOrderEnabled/i
    ]
  }
];

function excerpt(text, lineIndex, radius = 7) {
  const lines = text.split(/\r?\n/);
  const start = Math.max(0, lineIndex - radius);
  const end = Math.min(lines.length, lineIndex + radius + 1);

  return lines
    .slice(start, end)
    .map(
      (line, index) =>
        `${start + index + 1}: ${line}`
    )
    .join("\n");
}

const report = {
  status:
    "ALPHA_V3_DATA_FRESHNESS_GUARD_BINDING_POINT_PROBE_V1_COMPLETE",

  files: [],

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    positionsChanged: 0
  },

  logFile:
    "logs/alpha-v3-data-freshness-guard-binding-point-probe-v1.json",

  nextGate:
    "PATCH_ENTRY_CREATE_FILL_WITH_CANONICAL_FRESHNESS_GUARD_V1"
};

for (const target of targets) {
  const abs =
    path.resolve(
      root,
      target.file
    );

  if (!fs.existsSync(abs)) {
    report.files.push({
      file: target.file,
      exists: false,
      hits: []
    });

    continue;
  }

  const text =
    fs.readFileSync(
      abs,
      "utf8"
    );

  const lines =
    text.split(/\r?\n/);

  const hits = [];

  for (
    let i = 0;
    i < lines.length;
    i += 1
  ) {
    const matched =
      target.labels
        .filter(
          (pattern) =>
            pattern.test(
              lines[i]
            )
        )
        .map(
          (pattern) =>
            String(pattern)
        );

    if (matched.length > 0) {
      hits.push({
        line: i + 1,
        matched,
        excerpt:
          excerpt(
            text,
            i,
            6
          )
      });
    }
  }

  const imports =
    lines
      .filter(
        (line) =>
          /^\s*import\s/.test(
            line
          )
      )
      .slice(0, 40);

  const functionDeclarations =
    lines
      .map(
        (line, index) => ({
          line: index + 1,
          text: line.trim()
        })
      )
      .filter(
        (item) =>
          /\b(?:async\s+)?function\b|\bexport\s+async\s+function\b/.test(
            item.text
          )
      )
      .slice(0, 30);

  const supabaseIdentifiers = [
    ...new Set(
      [
        ...text.matchAll(
          /\b(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:await\s+)?(?:createSupabase[A-Za-z0-9_$]*|getSupabase[A-Za-z0-9_$]*|supabase)/g
        )
      ].map(
        (match) =>
          match[1]
      )
    )
  ];

  report.files.push({
    file: target.file,
    exists: true,
    imports,
    functionDeclarations,
    supabaseIdentifiers,
    hits
  });
}

fs.mkdirSync(
  path.resolve(
    root,
    "logs"
  ),
  {
    recursive: true
  }
);

fs.writeFileSync(
  path.resolve(
    root,
    report.logFile
  ),
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
      status:
        report.status,

      bindingSummary:
        report.files.map(
          (item) => ({
            file:
              item.file,

            exists:
              item.exists,

            supabaseIdentifiers:
              item.supabaseIdentifiers ?? [],

            functions:
              (
                item.functionDeclarations ?? []
              ).slice(0, 8),

            hitLines:
              (
                item.hits ?? []
              )
                .slice(0, 12)
                .map(
                  (hit) =>
                    hit.line
                )
          })
        ),

      logFile:
        report.logFile,

      nextGate:
        report.nextGate
    },
    null,
    2
  )
);
