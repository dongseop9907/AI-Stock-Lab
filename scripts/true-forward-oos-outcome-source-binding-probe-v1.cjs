const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGETS = [
  "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",
  "scripts/alpha-v3-true-forward-oos-summary.ts",
];

const NEEDLES = [
  "writeFileSync",
  "readFileSync",
  "outcome",
  "outcomes",
  "sessions",
  "correctedEntry",
  "targetSessionDate",
  "sourceTradingDate",
  "qualified",
  "returnRate",
  "evaluatedAt",
  "resultTable",
  "forward",
  ".json",
];

function collect(
  lines,
  needle,
  limit = 12
) {
  const out = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    if (
      !lines[i]
        .toLowerCase()
        .includes(
          needle.toLowerCase()
        )
    ) {
      continue;
    }

    const start =
      Math.max(
        0,
        i - 5
      );

    const end =
      Math.min(
        lines.length - 1,
        i + 10
      );

    out.push({
      line:
        i + 1,

      needle,

      snippet:
        lines
          .slice(
            start,
            end + 1
          )
          .map(
            (text, offset) => ({
              line:
                start +
                offset +
                1,

              text,
            })
          ),
    });

    if (
      out.length >=
      limit
    ) {
      break;
    }
  }

  return out;
}

const files = [];

for (
  const rel of TARGETS
) {
  const abs =
    path.join(
      ROOT,
      rel
    );

  const source =
    fs.readFileSync(
      abs,
      "utf8"
    );

  const lines =
    source.split(/\r?\n/);

  const hits = {};

  for (
    const needle of NEEDLES
  ) {
    const rows =
      collect(
        lines,
        needle
      );

    if (
      rows.length > 0
    ) {
      hits[needle] =
        rows;
    }
  }

  const stringLiterals =
    Array.from(
      source.matchAll(
        /["'`]([^"'`\r\n]{1,180}\.json[^"'`\r\n]*)["'`]/g
      )
    )
      .map(
        match =>
          match[1]
      )
      .slice(
        0,
        40
      );

  files.push({
    file:
      rel,

    lineCount:
      lines.length,

    hits,

    jsonStringLiterals:
      stringLiterals,

    contains: {
      writeFileSync:
        source.includes(
          "writeFileSync"
        ),

      readFileSync:
        source.includes(
          "readFileSync"
        ),

      sessions:
        /\bsessions\b/i.test(
          source
        ),

      outcomes:
        /\boutcomes?\b/i.test(
          source
        ),

      correctedEntry:
        source.includes(
          "correctedEntry"
        ),

      resultTable:
        source.includes(
          "resultTable"
        ),

      qualified:
        source.includes(
          "qualified"
        ),

      evaluatedAt:
        source.includes(
          "evaluatedAt"
        ),

      returnRate:
        source.includes(
          "returnRate"
        ),
    },
  });
}

const report = {
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_OUTCOME_SOURCE_BINDING_PROBE_V1_COMPLETE",

  mode:
    "READ_ONLY_SOURCE_SHAPE_PROBE",

  files,

  safety: {
    sourceOnly:
      true,

    collectorExecuted:
      false,

    evaluatorExecuted:
      false,

    summaryExecuted:
      false,

    databaseReads:
      0,

    databaseWrites:
      0,

    fileWrites:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    realTradingEnabled:
      false,
  },

  nextGate:
    "PATCH_OUTCOME_INTEGRITY_GATE_TO_ACTUAL_COLLECTOR_EVALUATOR_SOURCE",
};

fs.mkdirSync(
  path.join(
    ROOT,
    "logs"
  ),
  {
    recursive:
      true,
  }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "true-forward-oos-outcome-source-binding-probe-v1.json"
  ),
  JSON.stringify(
    report,
    null,
    2
  ),
  "utf8"
);

console.log(
  JSON.stringify(
    report,
    null,
    2
  )
);

process.exitCode = 0;
