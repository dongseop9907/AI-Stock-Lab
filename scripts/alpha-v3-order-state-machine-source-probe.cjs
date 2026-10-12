const fs = require("fs");
const path = require("path");

const root = process.cwd();

const scanRoots = [
  "app",
  "lib",
  "supabase/migrations"
];

const excludedDirs = new Set([
  "node_modules",
  ".next",
  ".git",
  "logs",
  "dist",
  "build"
]);

const allowedExt = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".cjs",
  ".mjs",
  ".sql"
]);

function walk(dir) {
  const abs =
    path.resolve(root, dir);

  if (!fs.existsSync(abs)) {
    return [];
  }

  const out = [];

  for (
    const entry of
      fs.readdirSync(
        abs,
        {
          withFileTypes: true
        }
      )
  ) {
    if (
      entry.isDirectory() &&
      excludedDirs.has(
        entry.name
      )
    ) {
      continue;
    }

    const full =
      path.join(
        abs,
        entry.name
      );

    if (entry.isDirectory()) {
      out.push(
        ...walk(
          path.relative(
            root,
            full
          )
        )
      );

      continue;
    }

    if (
      allowedExt.has(
        path.extname(
          entry.name
        )
      )
    ) {
      out.push(
        full
      );
    }
  }

  return out;
}

function lineOf(
  text,
  index
) {
  return text
    .slice(
      0,
      Math.max(
        0,
        index
      )
    )
    .split("\n")
    .length;
}

function excerpt(
  lines,
  line,
  radius = 5
) {
  const start =
    Math.max(
      1,
      line - radius
    );

  const end =
    Math.min(
      lines.length,
      line + radius
    );

  return {
    startLine: start,
    endLine: end,
    text:
      lines
        .slice(
          start - 1,
          end
        )
        .map(
          (
            value,
            index
          ) =>
            `${start + index}: ${value}`
        )
        .join("\n")
  };
}

const files =
  scanRoots
    .flatMap(
      walk
    );

const references = [];

const statusTokens =
  new Set();

const transitionHints = [];

const terminalTokens =
  new Set([
    "FILLED",
    "CANCELLED",
    "CANCELED",
    "EXPIRED",
    "FAILED",
    "REJECTED",
    "RISK_REJECTED",
    "CLOSED"
  ]);

const tokenRegex =
  /["']([A-Z][A-Z0-9_]{2,40})["']/g;

for (
  const abs of
    files
) {
  const text =
    fs.readFileSync(
      abs,
      "utf8"
    )
      .replace(
        /\r\n/g,
        "\n"
      );

  const rel =
    path.relative(
      root,
      abs
    )
      .replace(
        /\\/g,
        "/"
      );

  if (
    !text.includes(
      "paper_order_requests"
    ) &&
    !text.includes(
      "RISK_APPROVED"
    ) &&
    !text.includes(
      "RISK_REJECTED"
    ) &&
    !text.includes(
      "execute_paper_buy_order"
    )
  ) {
    continue;
  }

  const lines =
    text.split("\n");

  references.push({
    file:
      rel,

    lineCount:
      lines.length,

    hasPaperOrderRequests:
      text.includes(
        "paper_order_requests"
      ),

    hasExecutePaperBuyOrder:
      text.includes(
        "execute_paper_buy_order"
      ),

    hasCommittedRiskRpc:
      text.includes(
        "create_paper_buy_order_with_committed_risk_v3"
      ),

    hasStatusUpdate:
      /\.update\s*\(\s*\{[\s\S]{0,500}?status\s*:/m.test(
        text
      ) ||
      /\bstatus\s*=\s*['"][A-Z_]+['"]/m.test(
        text
      )
  });

  for (
    const match of
      text.matchAll(
        tokenRegex
      )
  ) {
    const token =
      match[1];

    if (
      token.includes(
        "ORDER"
      ) ||
      token.includes(
        "RISK"
      ) ||
      terminalTokens.has(
        token
      ) ||
      [
        "PENDING",
        "CREATED",
        "APPROVED",
        "SUBMITTED",
        "EXECUTING",
        "PARTIALLY_FILLED",
        "FILLED",
        "OPEN"
      ].includes(
        token
      )
    ) {
      statusTokens.add(
        token
      );
    }
  }

  const patterns = [
    {
      kind:
        "TS_STATUS_UPDATE",
      regex:
        /\.update\s*\(\s*\{[\s\S]{0,600}?status\s*:\s*["']([A-Z][A-Z0-9_]+)["'][\s\S]{0,600}?\}\s*\)/gm
    },
    {
      kind:
        "TS_STATUS_FILTER",
      regex:
        /\.eq\s*\(\s*["']status["']\s*,\s*["']([A-Z][A-Z0-9_]+)["']\s*\)/gm
    },
    {
      kind:
        "SQL_STATUS_ASSIGN",
      regex:
        /\bstatus\s*=\s*['"]([A-Z][A-Z0-9_]+)['"]/gm
    },
    {
      kind:
        "SQL_STATUS_IN",
      regex:
        /\bstatus\s+in\s*\(([^)]+)\)/gim
    },
    {
      kind:
        "RPC_REFERENCE",
      regex:
        /\b(create_paper_buy_order_with_committed_risk_v3|execute_paper_buy_order(?:_v\d+)?)\b/gm
    }
  ];

  for (
    const pattern of
      patterns
  ) {
    for (
      const match of
        text.matchAll(
          pattern.regex
        )
    ) {
      const index =
        match.index ??
        0;

      const line =
        lineOf(
          text,
          index
        );

      transitionHints.push({
        file:
          rel,

        kind:
          pattern.kind,

        line,

        value:
          match[1] ??
          match[0],

        excerpt:
          excerpt(
            lines,
            line,
            6
          )
      });
    }
  }
}

const knownStates =
  [...statusTokens]
    .filter(
      (token) =>
        ![
          "ORDER",
          "ORDERS",
          "ORDER_STATUS",
          "RISK",
          "RISK_MANAGER",
          "RISK_LIMIT"
        ].includes(
          token
        )
    )
    .sort();

const likelyOrderStates =
  knownStates.filter(
    (token) =>
      [
        "PENDING",
        "CREATED",
        "RISK_APPROVED",
        "RISK_REJECTED",
        "APPROVED",
        "SUBMITTED",
        "EXECUTING",
        "PARTIALLY_FILLED",
        "FILLED",
        "REJECTED",
        "CANCELLED",
        "CANCELED",
        "EXPIRED",
        "FAILED",
        "CLOSED",
        "OPEN"
      ].includes(
        token
      )
  );

const directStatusUpdates =
  transitionHints.filter(
    (item) =>
      item.kind ===
        "TS_STATUS_UPDATE" ||
      item.kind ===
        "SQL_STATUS_ASSIGN"
  );

const report = {
  status:
    "ALPHA_V3_ORDER_STATE_MACHINE_SOURCE_PROBE_COMPLETE",

  scan: {
    roots:
      scanRoots,

    scannedFileCount:
      files.length,

    relevantFileCount:
      references.length
  },

  summary: {
    likelyOrderStates,

    terminalStatesObserved:
      likelyOrderStates.filter(
        (state) =>
          terminalTokens.has(
            state
          )
      ),

    directStatusUpdateCount:
      directStatusUpdates.length,

    transitionHintCount:
      transitionHints.length,

    relevantFiles:
      references.map(
        (item) =>
          item.file
      )
  },

  references,

  transitionHints,

  recommendedNextStep:
    "BUILD_CANONICAL_ORDER_STATE_MACHINE_CONTRACT_THEN_PATCH_WRITERS",

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    ordersChanged: 0,
    positionsChanged: 0
  }
};

const logsDir =
  path.resolve(
    root,
    "logs"
  );

fs.mkdirSync(
  logsDir,
  {
    recursive: true
  }
);

fs.writeFileSync(
  path.join(
    logsDir,
    "alpha-v3-order-state-machine-source-probe.json"
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

      scan:
        report.scan,

      summary:
        report.summary,

      safety:
        report.safety,

      logFile:
        "logs/alpha-v3-order-state-machine-source-probe.json",

      nextGate:
        report.recommendedNextStep
    },
    null,
    2
  )
);
