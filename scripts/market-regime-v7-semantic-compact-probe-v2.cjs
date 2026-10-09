const fs = require("fs");
const path = require("path");

const root = process.cwd();

const evalFile = path.resolve(
  root,
  "lib/market/evaluate-regime-shadow-outcomes-v7-4.ts"
);

const comparatorFile = path.resolve(
  root,
  "lib/market/market-regime-shadow-comparator-v7-3.ts"
);

function read(rel) {
  return fs.readFileSync(rel, "utf8");
}

function extractFunction(source, name) {
  const needle = `function ${name}(`;
  const start = source.indexOf(needle);

  if (start < 0) {
    return null;
  }

  const braceStart = source.indexOf("{", start);
  let depth = 0;

  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;

      if (depth === 0) {
        return source
          .slice(start, i + 1)
          .replace(/\r/g, "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
      }
    }
  }

  return null;
}

const evalSource = read(evalFile);
const comparatorSource = read(comparatorFile);

const decisionScore =
  extractFunction(
    evalSource,
    "decisionScore",
  );

const resolveAgreementState =
  extractFunction(
    comparatorSource,
    "resolveAgreementState",
  );

const interestingEvalLines =
  evalSource
    .split(/\r?\n/)
    .map((line, index) => ({
      line: index + 1,
      text: line.trim(),
    }))
    .filter((row) =>
      row.text.includes("const v6Score") ||
      row.text.includes("const v7Score") ||
      row.text.includes("disagreementWinner") ||
      row.text.includes("v6_decision_score_5d") ||
      row.text.includes("v7_decision_score_5d")
    )
    .slice(0, 20);

const output = {
  status:
    "MARKET_REGIME_V7_SEMANTIC_COMPACT_PROBE_V2_COMPLETE",

  decisionScore,
  resolveAgreementState,
  scoringUse:
    interestingEvalLines,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesModified: 0,
  },

  fullDetails:
    "logs/market-regime-v7-semantic-compact-probe-v2.json",

  nextGate:
    "ROW_LEVEL_READ_ONLY_RECALC_AUDIT",
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

/* Keep console deliberately short. */
console.log(
  JSON.stringify(
    {
      status: output.status,
      decisionScore,
      resolveAgreementState,
      scoringUse:
        interestingEvalLines.slice(0, 8),
      nextGate: output.nextGate,
    },
    null,
    2,
  ),
);
