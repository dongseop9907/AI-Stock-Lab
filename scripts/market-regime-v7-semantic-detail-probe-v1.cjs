const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  {
    file: "lib/market/evaluate-regime-shadow-outcomes-v7-4.ts",
    anchors: [
      "function decisionScore(",
      "const v6Score",
      "const v7Score",
      "disagreementWinner",
      "v6_decision_score_5d",
      "v7_decision_score_5d",
    ],
  },
  {
    file: "lib/market/market-regime-shadow-comparator-v7-3.ts",
    anchors: [
      "function",
      "v6WouldBlock",
      "v7WouldBlock",
      "agreementState",
      "BLOCK_BREADTH_OR_HIGH_VOL",
    ],
  },
  {
    file: "lib/market/get-regime-forward-evidence-v7-5.ts",
    anchors: [
      "correctRate",
      "v6HeadToHeadWins",
      "v7HeadToHeadWins",
      "v7HeadToHeadWinRate",
      "decisionScore",
    ],
  },
  {
    file: "lib/market/capture-market-regime-shadow-comparison-v7-3.ts",
    anchors: [
      "agreementState",
      "v6_would_block",
      "v7_would_block",
    ],
  },
];

function around(lines, needle, before = 10, after = 28) {
  const matches = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes(needle)) {
      continue;
    }

    const start = Math.max(0, i - before);
    const end = Math.min(lines.length, i + after + 1);

    matches.push({
      anchor: needle,
      line: i + 1,
      excerpt: lines
        .slice(start, end)
        .map((text, offset) => ({
          line: start + offset + 1,
          text: text.slice(0, 280),
        })),
    });

    if (matches.length >= 3) {
      break;
    }
  }

  return matches;
}

function functionBlock(lines, functionNeedle) {
  const startLineIndex = lines.findIndex((line) =>
    line.includes(functionNeedle),
  );

  if (startLineIndex < 0) {
    return null;
  }

  let text = "";
  let depth = 0;
  let started = false;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = startLineIndex; i < lines.length; i += 1) {
    const line = lines[i];
    text += line + "\n";

    for (let j = 0; j < line.length; j += 1) {
      const ch = line[j];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (!inDouble && !inTemplate && ch === "'") {
        inSingle = !inSingle;
        continue;
      }

      if (!inSingle && !inTemplate && ch === '"') {
        inDouble = !inDouble;
        continue;
      }

      if (!inSingle && !inDouble && ch === "`") {
        inTemplate = !inTemplate;
        continue;
      }

      if (inSingle || inDouble || inTemplate) {
        continue;
      }

      if (ch === "{") {
        depth += 1;
        started = true;
      } else if (ch === "}") {
        depth -= 1;

        if (started && depth === 0) {
          return {
            startLine: startLineIndex + 1,
            endLine: i + 1,
            text: text.trimEnd(),
          };
        }
      }
    }
  }

  return {
    startLine: startLineIndex + 1,
    endLine: null,
    text: text.trimEnd(),
  };
}

const details = [];

for (const target of targets) {
  const abs = path.resolve(root, target.file);

  if (!fs.existsSync(abs)) {
    details.push({
      file: target.file,
      exists: false,
      sections: [],
    });
    continue;
  }

  const source = fs.readFileSync(abs, "utf8");
  const lines = source.split(/\r?\n/);

  const sections = target.anchors.flatMap((anchor) =>
    around(lines, anchor),
  );

  const specialBlocks = [];

  if (
    target.file.endsWith("evaluate-regime-shadow-outcomes-v7-4.ts")
  ) {
    const block = functionBlock(lines, "function decisionScore(");

    if (block) {
      specialBlocks.push({
        name: "decisionScore",
        ...block,
      });
    }
  }

  details.push({
    file: target.file,
    exists: true,
    sections,
    specialBlocks,
  });
}

const output = {
  status:
    "MARKET_REGIME_V7_SEMANTIC_DETAIL_PROBE_V1_COMPLETE",

  details,

  auditQuestions: [
    "Does decisionScore reward BLOCK when return_5d is negative and ALLOW when return_5d is positive?",
    "Are v6WouldBlock and v7WouldBlock stored with the same boolean meaning?",
    "Do V6_BLOCK_V7_ALLOW and V6_ALLOW_V7_BLOCK match the actual booleans?",
    "Does disagreementWinner choose the model with the larger decision score?",
    "Does forward evidence count score > 0 as correct consistently for both models?",
  ],

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
    "logs/market-regime-v7-semantic-detail-probe-v1.json",

  nextGate:
    "BUILD_ROW_LEVEL_READ_ONLY_SEMANTIC_RECALC_AUDIT",
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

const compact = {
  status: output.status,
  details: details.map((entry) => ({
    file: entry.file,
    exists: entry.exists,
    specialBlocks: entry.specialBlocks,
    sections: entry.sections.map((section) => ({
      anchor: section.anchor,
      line: section.line,
      excerpt: section.excerpt,
    })),
  })),
  auditQuestions: output.auditQuestions,
  safety: output.safety,
  fullDetails: output.fullDetails,
  nextGate: output.nextGate,
};

console.log(JSON.stringify(compact, null, 2));
