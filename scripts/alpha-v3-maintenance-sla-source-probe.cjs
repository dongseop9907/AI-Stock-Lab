const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  "app/api/trading/automation/run/route.ts",
  "app/api/orders/paper/execute/route.ts",
  "app/api/orders/paper/execute-approved/route.ts",
  "lib/trading/execute-approved-paper-orders.ts",
  "lib/trading/execute-paper-order.ts",
  "app/components/AutomationRunPanel.tsx",
  "app/page.tsx",
];

const reportFile =
  path.resolve(
    root,
    "logs/alpha-v3-maintenance-sla-source-probe.json"
  );

function read(rel) {
  const file = path.resolve(root, rel);

  if (!fs.existsSync(file)) {
    return {
      file: rel,
      exists: false,
      text: null,
    };
  }

  return {
    file: rel,
    exists: true,
    text: fs.readFileSync(file, "utf8"),
  };
}

function snippets(text, regex, radius = 5, max = 30) {
  if (!text) {
    return [];
  }

  const normalized =
    text.replace(/\r\n/g, "\n");

  const lines =
    normalized.split("\n");

  const rows = [];
  let match;

  while (
    (match = regex.exec(normalized)) &&
    rows.length < max
  ) {
    const line =
      normalized
        .slice(0, match.index)
        .split("\n")
        .length;

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

    rows.push({
      match:
        match[0],

      line,

      snippet:
        lines
          .slice(
            start - 1,
            end
          )
          .map(
            (value, offset) =>
              `${start + offset}: ${value}`
          )
          .join("\n"),
    });
  }

  return rows;
}

function numbersFromText(text) {
  if (!text) {
    return [];
  }

  const patterns = [
    {
      kind: "setIntervalMs",
      regex: /setInterval\s*\([\s\S]{0,500}?,\s*(\d[\d_]*)\s*\)/gi,
      scale: 1,
    },
    {
      kind: "setTimeoutMs",
      regex: /setTimeout\s*\([\s\S]{0,500}?,\s*(\d[\d_]*)\s*\)/gi,
      scale: 1,
    },
    {
      kind: "pollMinutes",
      regex: /\bpoll(?:ing)?Minutes?\b\s*[:=]\s*(\d+(?:\.\d+)?)/gi,
      scale: 60000,
    },
    {
      kind: "intervalMinutes",
      regex: /\bintervalMinutes?\b\s*[:=]\s*(\d+(?:\.\d+)?)/gi,
      scale: 60000,
    },
    {
      kind: "pollSeconds",
      regex: /\bpoll(?:ing)?Seconds?\b\s*[:=]\s*(\d+(?:\.\d+)?)/gi,
      scale: 1000,
    },
    {
      kind: "intervalSeconds",
      regex: /\bintervalSeconds?\b\s*[:=]\s*(\d+(?:\.\d+)?)/gi,
      scale: 1000,
    },
  ];

  const rows = [];

  for (const spec of patterns) {
    let match;

    while (
      (match = spec.regex.exec(text))
    ) {
      const raw =
        String(match[1])
          .replace(/_/g, "");

      const number =
        Number(raw);

      if (
        Number.isFinite(number) &&
        number > 0
      ) {
        rows.push({
          kind:
            spec.kind,

          raw:
            match[0],

          value:
            number,

          milliseconds:
            number *
            spec.scale,
        });
      }
    }
  }

  return rows;
}

const files =
  targets.map(read);

const evidence =
  files.map((row) => {
    const text = row.text;

    return {
      file:
        row.file,

      exists:
        row.exists,

      cadence:
        snippets(
          text,
          /\b(setInterval|setTimeout|poll(?:ing)?Minutes?|poll(?:ing)?Seconds?|intervalMinutes?|intervalSeconds?|cron|schedule|AUTOMATION|POLL)\b/gi,
          6,
          30
        ),

      approvedSelection:
        snippets(
          text,
          /RISK_APPROVED|paper_order_requests|executeApprovedPaperOrders|executePaperOrder|execute_paper_buy_order/gi,
          7,
          40
        ),

      batchAndLimit:
        snippets(
          text,
          /\.limit\s*\(|batchSize|batch_size|maxOrders|max_orders|concurrency|Promise\.all|Promise\.allSettled/gi,
          5,
          30
        ),

      retryAndError:
        snippets(
          text,
          /\bretry\b|\bretries\b|FAILED|CANCELLED|CANCELED|EXPIRED|catch\s*\(|throw\s+new\s+Error/gi,
          5,
          30
        ),

      timeFilters:
        snippets(
          text,
          /created_at|updated_at|reserved_risk_at|expires?_at|older|stale|timeout/gi,
          6,
          30
        ),

      numericCadenceCandidates:
        numbersFromText(text),
    };
  });

const allCadenceNumbers =
  evidence.flatMap(
    (row) =>
      row.numericCadenceCandidates.map(
        (candidate) => ({
          file: row.file,
          ...candidate,
        })
      )
  );

const explicitCadenceMs =
  allCadenceNumbers
    .map(
      (row) =>
        row.milliseconds
    )
    .filter(
      (value) =>
        Number.isFinite(value) &&
        value >= 1000 &&
        value <= 60 * 60 * 1000
    );

const maxExplicitCadenceMs =
  explicitCadenceMs.length
    ? Math.max(
        ...explicitCadenceMs
      )
    : null;

const executorPresent =
  evidence.some(
    (row) =>
      row.approvedSelection.some(
        (hit) =>
          /RISK_APPROVED|executeApprovedPaperOrders/i.test(
            hit.match +
            "\n" +
            hit.snippet
          )
      )
  );

const hasTimeBasedApprovedFilter =
  evidence.some(
    (row) =>
      row.timeFilters.some(
        (hit) =>
          /reserved_risk_at|created_at|expires?_at|stale|older|timeout/i.test(
            hit.match +
            "\n" +
            hit.snippet
          )
      )
  );

let recommendation;

if (maxExplicitCadenceMs != null) {
  const recommendedMs =
    Math.max(
      2 * 60 * 1000,
      maxExplicitCadenceMs * 3
    );

  const cappedMs =
    Math.min(
      recommendedMs,
      15 * 60 * 1000
    );

  recommendation = {
    evidenceSufficient:
      true,

    basis:
      "MAX_EXPLICIT_EXECUTION_OR_AUTOMATION_CADENCE_X3_WITH_MIN_2M_AND_MAX_15M",

    maxExplicitCadenceMs,

    recommendedStaleAfterMs:
      cappedMs,

    recommendedStaleAfterSeconds:
      Math.round(
        cappedMs / 1000
      ),

    recommendedStaleAfterMinutes:
      Number(
        (
          cappedMs /
          60000
        ).toFixed(2)
      ),
  };
} else {
  recommendation = {
    evidenceSufficient:
      false,

    basis:
      "NO_RELIABLE_EXPLICIT_EXECUTION_CADENCE_FOUND",

    maxExplicitCadenceMs:
      null,

    recommendedStaleAfterMs:
      null,

    recommendedStaleAfterSeconds:
      null,

    recommendedStaleAfterMinutes:
      null,
  };
}

const report = {
  status:
    "ALPHA_V3_MAINTENANCE_SLA_SOURCE_PROBE_COMPLETE",

  files:
    evidence,

  summary: {
    executorPresent,

    explicitCadenceCandidates:
      allCadenceNumbers,

    hasTimeBasedApprovedFilter,

    recommendation,
  },

  decision: {
    safeToIntegrateMaintenanceCaller:
      executorPresent &&
      recommendation.evidenceSufficient,

    nextGate:
      executorPresent &&
      recommendation.evidenceSufficient
        ? "BUILD_MAINTENANCE_CALLER_WITH_EVIDENCE_BASED_EXPIRY_SLA"
        : "REVIEW_AUTOMATION_EXECUTION_CADENCE_BEFORE_CHOOSING_SLA",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersChanged: 0,
    positionsChanged: 0,
  },

  outputFile:
    "logs/alpha-v3-maintenance-sla-source-probe.json",
};

fs.mkdirSync(
  path.dirname(reportFile),
  {
    recursive: true,
  }
);

fs.writeFileSync(
  reportFile,
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

      files:
        report.files.map(
          (row) => ({
            file:
              row.file,

            exists:
              row.exists,

            cadenceHits:
              row.cadence.length,

            approvedSelectionHits:
              row.approvedSelection.length,

            batchAndLimitHits:
              row.batchAndLimit.length,

            retryAndErrorHits:
              row.retryAndError.length,

            timeFilterHits:
              row.timeFilters.length,

            numericCadenceCandidates:
              row.numericCadenceCandidates,
          })
        ),

      summary:
        report.summary,

      databaseWrites:
        0,

      nextGate:
        report.decision.nextGate,

      outputFile:
        report.outputFile,
    },
    null,
    2
  )
);
