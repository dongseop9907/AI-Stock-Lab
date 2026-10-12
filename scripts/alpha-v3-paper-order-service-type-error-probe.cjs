const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targetRel =
  "lib/trading/paper-order-service.ts";

const targetFile =
  path.resolve(root, targetRel);

const reportFile =
  path.resolve(
    root,
    "logs/alpha-v3-paper-order-service-type-error-probe.json"
  );

if (!fs.existsSync(targetFile)) {
  throw new Error(
    `TARGET_NOT_FOUND:${targetRel}`
  );
}

const text =
  fs.readFileSync(
    targetFile,
    "utf8"
  );

const lines =
  text.replace(/\r\n/g, "\n")
    .split("\n");

function range(start, end) {
  return lines
    .slice(start - 1, end)
    .map(
      (line, index) =>
        `${start + index}: ${line}`
    )
    .join("\n");
}

function findAll(regex) {
  const rows = [];
  let match;

  while (
    (match = regex.exec(text))
  ) {
    const line =
      text
        .slice(0, match.index)
        .split(/\r?\n/)
        .length;

    rows.push({
      line,
      match: match[0],
    });
  }

  return rows;
}

const identifiers = [
  "account",
  "accountEquity",
  "cashBalance",
  "stock",
  "entryPrice",
  "decisionData",
  "riskResult",
  "orderError",
  "createPaperBuyOrderWithCommittedRisk",
];

const identifierEvidence =
  Object.fromEntries(
    identifiers.map(
      (name) => [
        name,
        findAll(
          new RegExp(
            `\\b${name}\\b`,
            "g"
          )
        ),
      ]
    )
  );

const functions =
  findAll(
    /(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(|(?:export\s+)?const\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*async\s*\(/g
  );

const imports =
  [
    ...text.matchAll(
      /import[\s\S]*?from\s+["'][^"']+["'];?/g
    ),
  ].map(
    (match) => ({
      line:
        text
          .slice(0, match.index)
          .split(/\r?\n/)
          .length,
      text:
        match[0],
    })
  );

const helperCallIndex =
  text.indexOf(
    "createPaperBuyOrderWithCommittedRisk"
  );

const helperCallLine =
  helperCallIndex >= 0
    ? text
        .slice(0, helperCallIndex)
        .split(/\r?\n/)
        .length
    : null;

const report = {
  status:
    "ALPHA_V3_PAPER_ORDER_SERVICE_TYPE_ERROR_PROBE_COMPLETE",

  file:
    targetRel,

  lineCount:
    lines.length,

  imports,

  functions,

  identifierEvidence,

  focusedRanges: {
    startTo180:
      range(
        1,
        Math.min(
          180,
          lines.length
        )
      ),

    helperArea:
      helperCallLine
        ? range(
            Math.max(
              1,
              helperCallLine - 35
            ),
            Math.min(
              lines.length,
              helperCallLine + 75
            )
          )
        : null,
  },

  diagnosisHints: {
    helperCallLine,

    likelyScopeBreak:
      [
        "account",
        "entryPrice",
        "decisionData",
        "riskResult",
        "accountEquity",
        "cashBalance",
        "stock",
      ].some(
        (name) =>
          (
            identifierEvidence[
              name
            ] ?? []
          ).length > 0
      ),

    nextGate:
      "REPAIR_PAPER_ORDER_SERVICE_SCOPE_AND_ATOMIC_HELPER_INTEGRATION",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    filesChanged: 0,
  },

  outputFile:
    "logs/alpha-v3-paper-order-service-type-error-probe.json",
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

      file:
        report.file,

      lineCount:
        report.lineCount,

      helperCallLine:
        report.diagnosisHints
          .helperCallLine,

      imports:
        report.imports,

      functions:
        report.functions,

      identifierEvidence:
        report.identifierEvidence,

      focusedRanges:
        report.focusedRanges,

      databaseWrites:
        0,

      nextGate:
        report.diagnosisHints
          .nextGate,

      outputFile:
        report.outputFile,
    },
    null,
    2
  )
);
