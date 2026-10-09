const fs = require("fs");
const path = require("path");

const root = process.cwd();

const roots = [
  "lib",
  "app",
  "scripts",
  "supabase/migrations",
];

const excludedNameFragments = [
  "install-",
  "fix-",
  "probe",
  "static-verify",
  "contract-test",
  ".bak",
];

const terms = [
  "BLOCK_BREADTH_OR_HIGH_VOL",
  "v6_would_block",
  "v7_would_block",
  "v6WouldBlock",
  "v7WouldBlock",
  "decision_score",
  "decisionScore",
  "agreement_state",
  "agreementState",
  "V6_BLOCK_V7_ALLOW",
  "V6_ALLOW_V7_BLOCK",
  "positive5d",
  "return5d",
  "return_5d",
  "is_correct",
  "correctRate",
  "v7CorrectRate",
  "headToHead",
  "would_block",
  "wouldBlock",
];

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === ".git" ||
        entry.name === "logs"
      ) {
        continue;
      }

      out.push(...walk(abs));
      continue;
    }

    if (
      !/\.(ts|tsx|js|cjs|mjs|sql)$/i.test(entry.name)
    ) {
      continue;
    }

    const rel = path.relative(root, abs).replaceAll("\\", "/");

    if (
      rel.startsWith("scripts/") &&
      excludedNameFragments.some((fragment) =>
        entry.name.includes(fragment),
      )
    ) {
      continue;
    }

    out.push({ abs, rel });
  }

  return out;
}

function lineContext(lines, index, radius = 3) {
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length, index + radius + 1);

  return lines
    .slice(start, end)
    .map((text, offset) => ({
      line: start + offset + 1,
      text: text.slice(0, 260),
    }));
}

const files = roots.flatMap((rel) =>
  walk(path.resolve(root, rel)),
);

const hitsByFile = [];

for (const file of files) {
  let source;

  try {
    source = fs.readFileSync(file.abs, "utf8");
  } catch {
    continue;
  }

  const lines = source.split(/\r?\n/);
  const hits = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const matchedTerms =
      terms.filter((term) =>
        line.includes(term),
      );

    if (matchedTerms.length === 0) {
      continue;
    }

    hits.push({
      line: i + 1,
      terms: matchedTerms,
      text: line.slice(0, 280),
    });
  }

  if (hits.length === 0) {
    continue;
  }

  const score =
    hits.reduce(
      (sum, hit) =>
        sum +
        hit.terms.length,
      0,
    );

  hitsByFile.push({
    file: file.rel,
    score,
    hitCount: hits.length,
    terms: [
      ...new Set(
        hits.flatMap((hit) => hit.terms),
      ),
    ],
    hits,
    lines,
  });
}

hitsByFile.sort(
  (a, b) =>
    b.score - a.score ||
    b.hitCount - a.hitCount ||
    a.file.localeCompare(b.file),
);

const top =
  hitsByFile.slice(0, 12);

const compactFiles =
  top.map((row) => {
    const selected = [];

    const priorityTerms = [
      "decision_score",
      "decisionScore",
      "is_correct",
      "v7CorrectRate",
      "V6_BLOCK_V7_ALLOW",
      "V6_ALLOW_V7_BLOCK",
      "BLOCK_BREADTH_OR_HIGH_VOL",
      "v6_would_block",
      "v7_would_block",
      "agreement_state",
      "positive5d",
      "return5d",
      "return_5d",
    ];

    for (const term of priorityTerms) {
      const hit =
        row.hits.find((item) =>
          item.terms.includes(term),
        );

      if (!hit) {
        continue;
      }

      if (
        selected.some((item) =>
          Math.abs(item.line - hit.line) <= 2,
        )
      ) {
        continue;
      }

      selected.push({
        line: hit.line,
        term,
        context: lineContext(
          row.lines,
          hit.line - 1,
          4,
        ),
      });

      if (selected.length >= 5) {
        break;
      }
    }

    return {
      file: row.file,
      score: row.score,
      hitCount: row.hitCount,
      terms: row.terms,
      selected,
    };
  });

const result = {
  status:
    "MARKET_REGIME_V7_SEMANTIC_AUDIT_SURFACE_PROBE_V1_COMPLETE",

  hypothesis: [
    "V7_BLOCK_ALLOW_SEMANTIC_INVERSION",
    "OUTCOME_SIGN_OR_CORRECTNESS_MAPPING_INVERSION",
    "HEAD_TO_HEAD_WINNER_MAPPING_INVERSION",
    "GENUINELY_BAD_V7_POLICY",
  ],

  observedGovernanceEvidence: {
    completedSample: 219,
    disagreementSample: 193,
    v6CorrectRate: 0.8767123287671232,
    v7CorrectRate: 0.0045662100456621,
    v6HeadToHeadWins: 192,
    v7HeadToHeadWins: 1,
    v7HeadToHeadWinRate: 0.0051813471502590676,
  },

  candidateFiles:
    compactFiles,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesModified: 0,
    productionApplied: false,
    ordersCreated: 0,
    positionsChanged: 0,
    regimePolicyChanged: false,
    forwardEvidenceChanged: false,
  },

  fullDetails:
    "logs/market-regime-v7-semantic-audit-surface-probe-v1.json",

  nextGate:
    "IDENTIFY_EXACT_V6_V7_DECISION_AND_OUTCOME_SEMANTICS_THEN_RUN_ROW_LEVEL_READ_ONLY_AUDIT",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true },
);

const full = {
  ...result,
  allMatchedFiles:
    hitsByFile.map((row) => ({
      file: row.file,
      score: row.score,
      hitCount: row.hitCount,
      terms: row.terms,
      hits: row.hits.slice(0, 100),
    })),
};

fs.writeFileSync(
  path.resolve(
    root,
    result.fullDetails,
  ),
  JSON.stringify(full, null, 2) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status: result.status,
      observedGovernanceEvidence:
        result.observedGovernanceEvidence,
      candidateFiles:
        compactFiles.map((row) => ({
          file: row.file,
          score: row.score,
          hitCount: row.hitCount,
          terms: row.terms,
          selected: row.selected.map((item) => ({
            line: item.line,
            term: item.term,
            context: item.context,
          })),
        })),
      safety: result.safety,
      fullDetails: result.fullDetails,
      nextGate: result.nextGate,
    },
    null,
    2,
  ),
);
