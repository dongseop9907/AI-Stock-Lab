const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const SEARCH_ROOTS = [
  "lib",
  "scripts",
  "app",
];

const NEEDLES = [
  "nextKrxTradingDate",
  "market_exchange_calendar_overrides",
  "is_open",
  "targetSessionDate",
  "WEEKDAY_PLUS_VERIFIED_KRX_OVERRIDES",
  "MANUAL_VERIFIED_KRX_CALENDAR",
];

const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "logs",
  "backups",
  "dist",
  "build",
  "coverage",
]);

const ALLOWED_EXT =
  /\.(ts|tsx|js|cjs|mjs)$/i;

function walk(absDir, relBase, out) {
  if (!fs.existsSync(absDir)) {
    return;
  }

  for (const entry of fs.readdirSync(absDir, {
    withFileTypes: true,
  })) {
    if (
      entry.isDirectory() &&
      IGNORE_DIRS.has(entry.name)
    ) {
      continue;
    }

    const abs =
      path.join(absDir, entry.name);

    const rel =
      path.join(relBase, entry.name)
        .replace(/\\/g, "/");

    if (entry.isDirectory()) {
      walk(abs, rel, out);
      continue;
    }

    if (
      entry.isFile() &&
      ALLOWED_EXT.test(entry.name)
    ) {
      out.push({
        abs,
        rel,
      });
    }
  }
}

const files = [];

for (const root of SEARCH_ROOTS) {
  walk(
    path.join(ROOT, root),
    root,
    files
  );
}

const matches = [];

for (const file of files) {
  let text = "";

  try {
    text =
      fs.readFileSync(
        file.abs,
        "utf8"
      );
  } catch {
    continue;
  }

  const lines =
    text.split(/\r?\n/);

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const line =
      lines[i];

    const found =
      NEEDLES.filter(
        needle =>
          line.includes(needle)
      );

    if (
      found.length === 0
    ) {
      continue;
    }

    const start =
      Math.max(
        0,
        i - 2
      );

    const end =
      Math.min(
        lines.length,
        i + 3
      );

    matches.push({
      file:
        file.rel,

      line:
        i + 1,

      needles:
        found,

      snippet:
        lines
          .slice(start, end)
          .map(
            (value, index) =>
              `${start + index + 1}: ${value}`
          ),
    });
  }
}

const definitions =
  matches.filter(
    row =>
      row.snippet.some(
        line =>
          /(function\s+nextKrxTradingDate|const\s+nextKrxTradingDate|export\s+.*nextKrxTradingDate|function\s+.*Trading.*Date|market_exchange_calendar_overrides)/i.test(
            line
          )
      )
  );

const candidateFiles =
  [...new Set(
    matches.map(
      row => row.file
    )
  )];

const likelySharedLibs =
  candidateFiles.filter(
    file =>
      file.startsWith("lib/")
  );

const producerOnly =
  candidateFiles.filter(
    file =>
      file.includes(
        "alpha-v3-true-forward-top1-producer-v1"
      )
  );

let recommendedReuseMode;

if (
  likelySharedLibs.length > 0
) {
  recommendedReuseMode =
    "REUSE_EXISTING_LIB_CALENDAR_SURFACE";
} else if (
  producerOnly.length > 0
) {
  recommendedReuseMode =
    "EXTRACT_CANONICAL_KRX_CALENDAR_SURFACE_FROM_PRODUCER_BEFORE_BINDING";
} else {
  recommendedReuseMode =
    "INSPECT_MATCHES_BEFORE_IMPLEMENTATION";
}

const report = {
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_CANONICAL_SURFACE_LOCATOR_V1_COMPLETE",

  recommendedReuseMode,

  candidateFiles,
  likelySharedLibs,

  definitionMatches:
    definitions.slice(
      0,
      20
    ),

  allMatches:
    matches.slice(
      0,
      80
    ),

  safety: {
    readOnly:
      true,

    productSourceChanges:
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
    recommendedReuseMode ===
      "REUSE_EXISTING_LIB_CALENDAR_SURFACE"
      ? "PATCH_AUTOMATION_BINDING_TO_EXISTING_LIB_KRX_CALENDAR_SURFACE"
      : recommendedReuseMode ===
        "EXTRACT_CANONICAL_KRX_CALENDAR_SURFACE_FROM_PRODUCER_BEFORE_BINDING"
      ? "EXTRACT_SHARED_KRX_CALENDAR_HELPER_THEN_BIND"
      : "REVIEW_KRX_SURFACE_MATCHES",
};

fs.mkdirSync(
  path.join(
    ROOT,
    "logs"
  ),
  {
    recursive: true
  }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "true-forward-oos-krx-canonical-surface-locator-v1.json"
  ),
  JSON.stringify(
    report,
    null,
    2
  ),
  "utf8"
);

console.log(JSON.stringify({
  status:
    report.status,

  recommendedReuseMode:
    report.recommendedReuseMode,

  candidateFiles:
    report.candidateFiles.slice(
      0,
      20
    ),

  likelySharedLibs:
    report.likelySharedLibs.slice(
      0,
      10
    ),

  definitionMatches:
    report.definitionMatches.slice(
      0,
      8
    ),

  nextGate:
    report.nextGate,
}, null, 2));

process.exitCode = 0;
