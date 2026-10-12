const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const SYMBOLS = [
  "RankedAlphaCandidate",
  "rankAlphaCandidates",
  "finalScore",
  "quality",
];

const TARGET_FILE =
  "scripts/alpha-v1-5-date-full-historical-replay-read-only.ts";

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(
    dir,
    { withFileTypes: true },
  )) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === ".git"
    ) {
      continue;
    }

    const full =
      path.join(
        dir,
        entry.name,
      );

    if (entry.isDirectory()) {
      walk(
        full,
        out,
      );
    } else if (
      entry.name.endsWith(".ts") ||
      entry.name.endsWith(".tsx")
    ) {
      out.push(
        full,
      );
    }
  }

  return out;
}

function rel(file) {
  return path
    .relative(
      ROOT,
      file,
    )
    .replaceAll(
      "\\",
      "/",
    );
}

function snippets(
  source,
  needle,
  before = 20,
  after = 32,
) {
  const lines =
    source.split(/\r?\n/);

  const results = [];

  for (
    let i = 0;
    i < lines.length;
    i += 1
  ) {
    if (
      lines[i].includes(
        needle,
      )
    ) {
      const start =
        Math.max(
          0,
          i - before,
        );

      const end =
        Math.min(
          lines.length,
          i + after + 1,
        );

      results.push({
        line:
          i + 1,

        snippet:
          lines
            .slice(
              start,
              end,
            )
            .map(
              (text, offset) => ({
                line:
                  start +
                  offset +
                  1,

                text,
              }),
            ),
      });
    }
  }

  return results;
}

const files =
  walk(
    ROOT,
  );

const symbolResults = {};

for (
  const symbol of SYMBOLS
) {
  symbolResults[symbol] =
    [];

  for (
    const file of files
  ) {
    let source;

    try {
      source =
        fs.readFileSync(
          file,
          "utf8",
        );
    } catch {
      continue;
    }

    if (
      !source.includes(
        symbol,
      )
    ) {
      continue;
    }

    symbolResults[symbol].push({
      file:
        rel(
          file,
        ),

      matches:
        snippets(
          source,
          symbol,
        ),
    });
  }
}

const target =
  path.join(
    ROOT,
    TARGET_FILE,
  );

let targetContext = null;

if (
  fs.existsSync(
    target,
  )
) {
  const source =
    fs.readFileSync(
      target,
      "utf8",
    );

  targetContext = {
    file:
      TARGET_FILE,

    finalScoreUses:
      snippets(
        source,
        "row.finalScore",
        30,
        35,
      ),

    rankingAssignments:
      snippets(
        source,
        "rankAlphaCandidates(",
        28,
        40,
      ),

    scoreLabels:
      snippets(
        source,
        "score:",
        18,
        24,
      ),

    qualityUses:
      snippets(
        source,
        "row.quality",
        20,
        24,
      ),
  };
}

const report = {
  status:
    "AI_STOCK_LAB_RANKED_ALPHA_CANDIDATE_SCORE_FIELD_CONTRACT_PROBE_V1_COMPLETE",

  buildError: {
    file:
      TARGET_FILE,

    line:
      1654,

    expression:
      "row.finalScore",

    type:
      "RankedAlphaCandidate",

    problem:
      "finalScore is not declared on RankedAlphaCandidate",
  },

  symbolResults,

  targetContext,

  decisionRules: {
    ifRankedCandidateHasCanonicalScoreField:
      "USE_THE_CANONICAL_EXISTING_SCORE_FIELD_AT_REPLAY_OUTPUT_BOUNDARY",

    ifScoreIsNested:
      "READ_FROM_THE_EXISTING_NESTED_SCORE_WITHOUT_RECALCULATING",

    ifNoEquivalentFieldExists:
      "REMOVE_OR_REDEFINE_THE_REPLAY_OUTPUT_FIELD_ONLY_AFTER_CONFIRMING_INTENT",

    forbidden:
      [
        "DO_NOT_ADD_FAKE finalScore TO RankedAlphaCandidate JUST_TO_SATISFY_BUILD",
        "DO_NOT_RECOMPUTE_SCORE_WITH_DIFFERENT_FORMULA",
        "DO_NOT_USE_ANY_CAST",
      ],
  },

  safety: {
    sourceOnly:
      true,

    filesModified:
      0,

    replayExecuted:
      false,

    databaseReads:
      0,

    databaseWrites:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    promotionExecuted:
      false,

    realTradingEnabled:
      false,
  },

  nextGate:
    "PATCH_REPLAY_OUTPUT_TO_CANONICAL_RANKED_ALPHA_SCORE_FIELD",
};

fs.mkdirSync(
  path.join(
    ROOT,
    "logs",
  ),
  {
    recursive:
      true,
  },
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "ranked-alpha-candidate-score-field-contract-probe-v1.json",
  ),
  JSON.stringify(
    report,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);

process.exitCode = 0;
