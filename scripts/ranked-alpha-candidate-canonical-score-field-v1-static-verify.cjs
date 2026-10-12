const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const targets = [
  "scripts/alpha-v1-5-date-full-historical-replay-read-only.ts",
  "scripts/alpha-v1-full-window-historical-replay-read-only.ts"
];

const checks = {};

for (const rel of targets) {
  const file =
    path.join(
      ROOT,
      rel
    );

  if (!fs.existsSync(file)) {
    checks[rel + ":exists"] =
      false;
    continue;
  }

  const source =
    fs.readFileSync(
      file,
      "utf8"
    );

  checks[rel + ":exists"] =
    true;

  checks[rel + ":noRowFinalScore"] =
    !source.includes(
      "row.finalScore"
    );

  checks[rel + ":rowScorePresent"] =
    source.includes(
      "row.score"
    );

  checks[rel + ":topAlphaStillPresent"] =
    source.includes(
      "topAlpha:"
    );
}

const candidateScoring =
  path.join(
    ROOT,
    "lib",
    "alpha",
    "candidate-scoring.ts"
  );

if (fs.existsSync(candidateScoring)) {
  const source =
    fs.readFileSync(
      candidateScoring,
      "utf8"
    );

  checks.canonicalReturnMapsFinalScoreToScore =
    source.includes(
      "score:"
    ) &&
    source.includes(
      "round6(finalScore)"
    );

  checks.rankUsesScore =
    source.includes(
      "right.score"
    ) &&
    source.includes(
      "left.score"
    );
} else {
  checks.canonicalReturnMapsFinalScoreToScore =
    false;

  checks.rankUsesScore =
    false;
}

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([, value]) =>
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_RANKED_ALPHA_CANDIDATE_CANONICAL_SCORE_FIELD_V1_STATIC_VERIFIED"
      : "AI_STOCK_LAB_RANKED_ALPHA_CANDIDATE_CANONICAL_SCORE_FIELD_V1_STATIC_FAILED",

  checks,

  safety: {
    sourceOnly:
      true,

    scoreFormulaChanged:
      false,

    candidateScoringChanged:
      false,

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
      false
  },

  failed,

  nextGate:
    failed.length === 0
      ? "RUN_DASHBOARD_CONTRACT_AND_NEXT_BUILD"
      : "REPAIR_CANONICAL_SCORE_FIELD"
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
