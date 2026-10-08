import fs from "node:fs";
import path from "node:path";

const VERSION =
  "ALPHA_V3_FORWARD_TOP1_PRODUCER_PROBE_V1";

const ROOT =
  process.cwd();

const SEARCH_ROOTS = [
  path.resolve(ROOT, "scripts"),
  path.resolve(ROOT, "lib"),
  path.resolve(ROOT, "app"),
];

const NEEDLES = [
  "alpha-v3-extended-pricevolume-top1-history.json",
  "top1Rows",
  "reconstructedTop1",
  "priceVolume Top1",
  "pricevolume-top1",
  "effectiveScore",
  "rawPriceVolumeScore",
];

function walk(
  dir: string,
  output: string[],
) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === ".git"
      ) {
        continue;
      }

      walk(full, output);
      continue;
    }

    if (!/\.(?:ts|tsx|js|cjs|mjs)$/.test(entry.name)) {
      continue;
    }

    output.push(full);
  }
}

function numbered(
  lines: string[],
  from: number,
  to: number,
) {
  return lines
    .slice(from, to)
    .map(
      (line, index) =>
        `${from + index + 1}: ${line}`,
    )
    .join("\n");
}

function inspectFile(
  file: string,
) {
  const rel =
    path.relative(ROOT, file)
      .replace(/\\/g, "/");

  const source =
    fs.readFileSync(
      file,
      "utf8",
    ).replace(/\r\n/g, "\n");

  const lines =
    source.split("\n");

  const hits: Array<{
    needle: string;
    line: number;
    text: string;
  }> = [];

  const seen =
    new Set<string>();

  for (const needle of NEEDLES) {
    lines.forEach((line, index) => {
      if (
        !line
          .toLowerCase()
          .includes(
            needle.toLowerCase(),
          )
      ) {
        return;
      }

      const from =
        Math.max(0, index - 12);

      const to =
        Math.min(
          lines.length,
          index + 28,
        );

      const key =
        `${from}:${to}`;

      if (seen.has(key)) {
        return;
      }

      seen.add(key);

      hits.push({
        needle,
        line: index + 1,
        text: numbered(
          lines,
          from,
          to,
        ),
      });
    });
  }

  if (hits.length === 0) {
    return null;
  }

  const functions =
    lines
      .map((line, index) => ({
        line: line.trim(),
        index,
      }))
      .filter(
        (row) =>
          /^(export\s+)?(async\s+)?function\s+\w+/.test(row.line) ||
          /^(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/.test(row.line),
      )
      .map((row) => ({
        line: row.index + 1,
        declaration: row.line,
      }))
      .slice(0, 100);

  return {
    file: rel,
    lineCount: lines.length,
    functions,
    hits: hits.slice(0, 100),
  };
}

const files: string[] = [];

for (const root of SEARCH_ROOTS) {
  walk(root, files);
}

const matches =
  files
    .map(inspectFile)
    .filter(Boolean);

const producerCandidates =
  matches
    .filter((row: any) => {
      const text =
        JSON.stringify(row);

      return (
        /writeFileSync|appendFileSync/.test(text) &&
        /top1Rows|extended-pricevolume-top1-history/.test(text)
      );
    })
    .map((row: any) => row.file);

const report = {
  status:
    "ALPHA_V3_FORWARD_TOP1_PRODUCER_PROBE_COMPLETE",

  version:
    VERSION,

  scannedFileCount:
    files.length,

  producerCandidates,

  matches,

  requiredForwardProducerContract: {
    cutoff:
      "2026-10-07",

    mustCreateOneFrozenCandidatePerNewTradingSession:
      true,

    candidateSelectionMustUseOnlyInformationAvailableBySourceTradingDate:
      true,

    mustPersistBeforeEntryOutcomeMatures:
      true,

    mustNotUseFutureR1R3R5ToSelectCandidate:
      true,

    outputNeededByEntryCollector: [
      "sourceTradingDate",
      "targetSessionDate",
      "top1.stockCode",
      "top1.stockName",
      "top1.effectiveScore",
      "top1.rawPriceVolumeScore",
    ],

    historicalFileMustRemainImmutable:
      "logs/alpha-v3-extended-pricevolume-top1-history.json",

    recommendedForwardFile:
      "logs/alpha-v3-forward-top1-sessions.json",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    kisRequests: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    productionChanged: false,
  },

  nextGate:
    producerCandidates.length > 0
      ? "BUILD_TRUE_FORWARD_TOP1_PLUS_ENTRY_COLLECTOR"
      : "PROBE_ALPHA_V3_TOP1_GENERATION_SOURCE_MORE_DEEPLY",
};

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);
