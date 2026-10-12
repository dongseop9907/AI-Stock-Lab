const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const SEARCH_ROOTS = [
  "lib",
  "app",
  "scripts",
];

const KEYWORDS = [
  "PROMOTE_SHADOW_TO_PAPER",
  "ENABLE_MANUAL_MODEL_PROMOTION_APPLY",
  "CANONICAL_OUTCOME_EVIDENCE_NOT_READY",
  "MANUAL_APPROVAL_REQUIRED",
  "EXPLICIT_CONFIRMATION_REQUIRED",
  "SHADOW",
  "PAPER",
  "ENTRY_TIMING",
  "promotion",
  "canonical",
];

const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".cjs",
  ".mjs",
]);

const MAX_FILE_BYTES =
  1024 * 1024;

function walk(dir) {
  const out = [];

  if (!fs.existsSync(dir)) {
    return out;
  }

  for (
    const entry of fs.readdirSync(
      dir,
      {
        withFileTypes: true,
      },
    )
  ) {
    const abs =
      path.join(
        dir,
        entry.name,
      );

    if (
      entry.isDirectory()
    ) {
      if (
        entry.name ===
          "node_modules" ||
        entry.name ===
          ".next" ||
        entry.name ===
          ".git" ||
        entry.name ===
          "dist" ||
        entry.name ===
          "coverage"
      ) {
        continue;
      }

      out.push(
        ...walk(abs),
      );

      continue;
    }

    if (
      !entry.isFile()
    ) {
      continue;
    }

    if (
      !EXTENSIONS.has(
        path.extname(
          entry.name,
        ),
      )
    ) {
      continue;
    }

    const stat =
      fs.statSync(abs);

    if (
      stat.size >
      MAX_FILE_BYTES
    ) {
      continue;
    }

    out.push(abs);
  }

  return out;
}

function snippet(
  lines,
  lineIndex,
  radius = 5,
) {
  const start =
    Math.max(
      0,
      lineIndex - radius,
    );

  const end =
    Math.min(
      lines.length - 1,
      lineIndex + radius,
    );

  return lines
    .slice(
      start,
      end + 1,
    )
    .map(
      (text, offset) => ({
        line:
          start +
          offset +
          1,
        text,
      }),
    );
}

const files =
  SEARCH_ROOTS
    .flatMap(
      rel =>
        walk(
          path.join(
            ROOT,
            rel,
          ),
        ),
    );

const hits = [];

for (
  const abs of files
) {
  let source = "";

  try {
    source =
      fs.readFileSync(
        abs,
        "utf8",
      );
  } catch {
    continue;
  }

  const lower =
    source.toLowerCase();

  if (
    !KEYWORDS.some(
      keyword =>
        lower.includes(
          keyword.toLowerCase(),
        ),
    )
  ) {
    continue;
  }

  const lines =
    source.split(/\r?\n/);

  const keywordHits = {};

  for (
    const keyword of KEYWORDS
  ) {
    const rows = [];

    for (
      let i = 0;
      i < lines.length;
      i++
    ) {
      if (
        !lines[i]
          .toLowerCase()
          .includes(
            keyword.toLowerCase(),
          )
      ) {
        continue;
      }

      rows.push({
        line:
          i + 1,
        snippet:
          snippet(
            lines,
            i,
            5,
          ),
      });

      if (
        rows.length >=
        12
      ) {
        break;
      }
    }

    if (
      rows.length > 0
    ) {
      keywordHits[keyword] =
        rows;
    }
  }

  const rel =
    path
      .relative(
        ROOT,
        abs,
      )
      .replace(
        /\\/g,
        "/",
      );

  hits.push({
    file:
      rel,

    contains: {
      manualApplyFlag:
        source.includes(
          "ENABLE_MANUAL_MODEL_PROMOTION_APPLY",
        ),

      exactPhrase:
        source.includes(
          "PROMOTE_SHADOW_TO_PAPER",
        ),

      canonicalEvidenceReason:
        source.includes(
          "CANONICAL_OUTCOME_EVIDENCE_NOT_READY",
        ),

      manualApprovalReason:
        source.includes(
          "MANUAL_APPROVAL_REQUIRED",
        ),

      explicitConfirmationReason:
        source.includes(
          "EXPLICIT_CONFIRMATION_REQUIRED",
        ),

      shadow:
        /\bSHADOW\b/.test(
          source,
        ),

      paper:
        /\bPAPER\b/.test(
          source,
        ),

      entryTiming:
        source.includes(
          "ENTRY_TIMING",
        ),

      databaseWriteLike:
        /\.(insert|update|upsert|delete)\s*\(/.test(
          source,
        ),

      routeHandler:
        /export\s+async\s+function\s+(POST|GET|PUT|PATCH|DELETE)/.test(
          source,
        ),
    },

    keywordHits,
  });
}

hits.sort(
  (a, b) => {
    const score = item =>
      Object.values(
        item.contains,
      )
        .filter(Boolean)
        .length;

    return (
      score(b) -
      score(a)
    );
  },
);

const focused =
  hits.filter(
    item =>
      item.contains.manualApplyFlag ||
      item.contains.exactPhrase ||
      item.contains.canonicalEvidenceReason ||
      (
        item.contains.shadow &&
        item.contains.paper &&
        (
          item.file.includes(
            "promotion",
          ) ||
          item.file.includes(
            "model",
          )
        )
      ),
  );

const knownFiles = [
  "lib/models/model-promotion-decision-service.ts",
  "lib/models/model-shadow-outcome-storage.ts",
  "lib/models/model-shadow-outcome-pipeline-binding.ts",
  "app/api/models/promote/route.ts",
  "app/api/models/promotion/route.ts",
  "app/api/models/manual-promotion/route.ts",
]
  .map(
    rel => ({
      file:
        rel,

      exists:
        fs.existsSync(
          path.join(
            ROOT,
            rel,
          ),
        ),
    }),
  );

const report = {
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_SURFACE_PROBE_V1_COMPLETE",

  mode:
    "READ_ONLY_SOURCE_SURFACE_PROBE",

  knownFiles,

  counts: {
    scannedFiles:
      files.length,

    keywordHitFiles:
      hits.length,

    focusedPromotionFiles:
      focused.length,
  },

  promotionSurface:
    focused.slice(
      0,
      30,
    ),

  broadCandidates:
    hits.slice(
      0,
      40,
    )
      .map(
        item => ({
          file:
            item.file,

          contains:
            item.contains,
        }),
      ),

  safety: {
    sourceOnly:
      true,

    routesExecuted:
      false,

    promotionExecuted:
      false,

    promotionApproved:
      false,

    modelStageChanged:
      false,

    databaseReads:
      0,

    databaseWrites:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    realTradingEnabled:
      false,
  },

  nextGate:
    focused.length > 0
      ? "BUILD_READ_ONLY_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_FROM_ACTUAL_SURFACE"
      : "EXPAND_PROMOTION_SURFACE_DISCOVERY_BEFORE_BUILDING_PREFLIGHT",
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
    "true-forward-oos-paper-promotion-eligibility-surface-probe-v1.json",
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
