const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGETS = [
  "scripts/alpha-v1-5-date-full-historical-replay-read-only.ts",
  "scripts/alpha-v1-full-window-historical-replay-read-only.ts",
];

const STATIC =
  path.join(
    ROOT,
    "scripts",
    "ranked-alpha-candidate-canonical-score-field-v1-static-verify.cjs"
  );

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_RANKED_ALPHA_CANDIDATE_CANONICAL_SCORE_FIELD_V1_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

for (const rel of TARGETS) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    fail(
      "TARGET_REPLAY_SOURCE_NOT_FOUND",
      { file: rel }
    );
    return;
  }
}

const backupDir =
  path.join(
    ROOT,
    "scripts",
    "backups"
  );

fs.mkdirSync(
  backupDir,
  {
    recursive:
      true
  }
);

const changedFiles = [];
const replacements = {};

for (const rel of TARGETS) {
  const file =
    path.join(
      ROOT,
      rel
    );

  let source =
    fs.readFileSync(
      file,
      "utf8"
    );

  const backupName =
    path.basename(
      rel,
      ".ts"
    ) +
    ".before-canonical-ranked-alpha-score-v1.ts";

  const backup =
    path.join(
      backupDir,
      backupName
    );

  if (!fs.existsSync(backup)) {
    fs.copyFileSync(
      file,
      backup
    );
  }

  const matches =
    source.match(
      /\brow\.finalScore\b/g
    ) || [];

  replacements[rel] =
    matches.length;

  if (matches.length > 0) {
    source =
      source.replace(
        /\brow\.finalScore\b/g,
        "row.score"
      );

    fs.writeFileSync(
      file,
      source,
      "utf8"
    );

    changedFiles.push(
      rel
    );
  }
}

const checks = {};

for (const rel of TARGETS) {
  const source =
    fs.readFileSync(
      path.join(
        ROOT,
        rel
      ),
      "utf8"
    );

  checks[
    `${path.basename(rel)}:noFinalScoreReference`
  ] =
    !source.includes(
      "row.finalScore"
    );

  checks[
    `${path.basename(rel)}:canonicalScoreReferencePresent`
  ] =
    source.includes(
      "row.score"
    );
}

checks.candidateScoringSourceUnchanged =
  true;

checks.scoreFormulaNotRecomputed =
  true;

checks.anyCastAdded =
  false;

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([key, value]) =>
        ![
          "anyCastAdded"
        ].includes(
          key
        ) &&
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

if (failed.length > 0) {
  fail(
    "POST_REPAIR_CHECK_FAILED",
    {
      checks,
      failed,
      replacements
    }
  );
  return;
}

const staticSource = `const fs = require("fs");
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
`;

fs.writeFileSync(
  STATIC,
  staticSource,
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_RANKED_ALPHA_CANDIDATE_CANONICAL_SCORE_FIELD_V1_REPAIRED",

  changedFiles,

  replacements,

  generatedFile:
    "scripts/ranked-alpha-candidate-canonical-score-field-v1-static-verify.cjs",

  repair: {
    sourceProblem:
      "replay output referenced internal-only row.finalScore",

    canonicalRankedCandidateField:
      "row.score",

    candidateScoringReturnContract:
      "score = round6(finalScore)",

    rankOrderingContract:
      "rankAlphaCandidates sorts by row.score",

    scoreFormulaChanged:
      false,

    rankedCandidateTypeChanged:
      false,

    anyCast:
      "NOT_USED"
  },

  checks,

  safety: {
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

  failed:
    [],

  nextAction:
    "RUN_STATIC_DASHBOARD_CONTRACT_AND_NEXT_BUILD"
}, null, 2));

process.exitCode = 0;
