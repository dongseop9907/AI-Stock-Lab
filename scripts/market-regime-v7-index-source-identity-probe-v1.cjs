const fs = require("fs");
const path = require("path");

const root = process.cwd();

const scanRoots = [
  "lib/market",
  "lib/trading",
  "scripts",
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(abs));
    else if (/\.(ts|tsx|js|cjs)$/i.test(entry.name)) found.push(abs);
  }
  return found;
}

const needles = [
  "kospi",
  "kosdaq",
  "KOSPI",
  "KOSDAQ",
  "indexCode",
  "index_code",
  "indexBars",
  "index_bars",
  "MarketRegimeIndex",
];

const hits = [];

for (const abs of scanRoots.flatMap((r) => walk(path.resolve(root, r)))) {
  const rel = path.relative(root, abs).replaceAll("\\", "/");

  if (
    rel.includes("install-") ||
    rel.includes("fix-") ||
    rel.includes("probe") ||
    rel.includes("contract-test") ||
    rel.includes("static-verify")
  ) continue;

  let source;
  try {
    source = fs.readFileSync(abs, "utf8");
  } catch {
    continue;
  }

  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const matched = needles.filter((needle) =>
      lines[i].includes(needle)
    );

    if (!matched.length) continue;

    hits.push({
      file: rel,
      line: i + 1,
      matched,
      text: lines[i].trim().slice(0, 260),
    });
  }
}

const rankedFiles = [...new Set(
  hits
    .filter((hit) =>
      hit.file.includes("market-regime")
    )
    .map((hit) => hit.file)
)];

const compact = hits
  .filter((hit) =>
    hit.file.includes("market-regime") &&
    (
      /kospi|kosdaq/i.test(hit.text) ||
      /index/i.test(hit.text)
    )
  )
  .slice(0, 28);

const output = {
  status:
    "MARKET_REGIME_V7_INDEX_SOURCE_IDENTITY_PROBE_V1_COMPLETE",

  matchedFiles: rankedFiles,
  sourceSurface: compact,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesModified: 0,
    regimePolicyChanged: false,
    forwardEvidenceChanged: false,
  },

  fullDetails:
    "logs/market-regime-v7-index-source-identity-probe-v1.json",

  nextGate:
    "CONFIRM_KOSPI_KOSDAQ_SOURCE_CODES_AND_SERIES",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true },
);

fs.writeFileSync(
  path.resolve(root, output.fullDetails),
  JSON.stringify({ ...output, allHits: hits }, null, 2) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status: output.status,
      matchedFiles: output.matchedFiles,
      sourceSurface: output.sourceSurface,
      nextGate: output.nextGate,
      details: output.fullDetails,
    },
    null,
    2,
  ),
);
