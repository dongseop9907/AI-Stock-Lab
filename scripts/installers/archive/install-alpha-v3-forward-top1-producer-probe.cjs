const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-forward-top1-producer-probe.ts"
);

const source = "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nconst VERSION =\n  \"ALPHA_V3_FORWARD_TOP1_PRODUCER_PROBE_V1\";\n\nconst ROOT =\n  process.cwd();\n\nconst SEARCH_ROOTS = [\n  path.resolve(ROOT, \"scripts\"),\n  path.resolve(ROOT, \"lib\"),\n  path.resolve(ROOT, \"app\"),\n];\n\nconst NEEDLES = [\n  \"alpha-v3-extended-pricevolume-top1-history.json\",\n  \"top1Rows\",\n  \"reconstructedTop1\",\n  \"priceVolume Top1\",\n  \"pricevolume-top1\",\n  \"effectiveScore\",\n  \"rawPriceVolumeScore\",\n];\n\nfunction walk(\n  dir: string,\n  output: string[],\n) {\n  if (!fs.existsSync(dir)) {\n    return;\n  }\n\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    const full = path.join(dir, entry.name);\n\n    if (entry.isDirectory()) {\n      if (\n        entry.name === \"node_modules\" ||\n        entry.name === \".next\" ||\n        entry.name === \".git\"\n      ) {\n        continue;\n      }\n\n      walk(full, output);\n      continue;\n    }\n\n    if (!/\\.(?:ts|tsx|js|cjs|mjs)$/.test(entry.name)) {\n      continue;\n    }\n\n    output.push(full);\n  }\n}\n\nfunction numbered(\n  lines: string[],\n  from: number,\n  to: number,\n) {\n  return lines\n    .slice(from, to)\n    .map(\n      (line, index) =>\n        `${from + index + 1}: ${line}`,\n    )\n    .join(\"\\n\");\n}\n\nfunction inspectFile(\n  file: string,\n) {\n  const rel =\n    path.relative(ROOT, file)\n      .replace(/\\\\/g, \"/\");\n\n  const source =\n    fs.readFileSync(\n      file,\n      \"utf8\",\n    ).replace(/\\r\\n/g, \"\\n\");\n\n  const lines =\n    source.split(\"\\n\");\n\n  const hits: Array<{\n    needle: string;\n    line: number;\n    text: string;\n  }> = [];\n\n  const seen =\n    new Set<string>();\n\n  for (const needle of NEEDLES) {\n    lines.forEach((line, index) => {\n      if (\n        !line\n          .toLowerCase()\n          .includes(\n            needle.toLowerCase(),\n          )\n      ) {\n        return;\n      }\n\n      const from =\n        Math.max(0, index - 12);\n\n      const to =\n        Math.min(\n          lines.length,\n          index + 28,\n        );\n\n      const key =\n        `${from}:${to}`;\n\n      if (seen.has(key)) {\n        return;\n      }\n\n      seen.add(key);\n\n      hits.push({\n        needle,\n        line: index + 1,\n        text: numbered(\n          lines,\n          from,\n          to,\n        ),\n      });\n    });\n  }\n\n  if (hits.length === 0) {\n    return null;\n  }\n\n  const functions =\n    lines\n      .map((line, index) => ({\n        line: line.trim(),\n        index,\n      }))\n      .filter(\n        (row) =>\n          /^(export\\s+)?(async\\s+)?function\\s+\\w+/.test(row.line) ||\n          /^(export\\s+)?const\\s+\\w+\\s*=\\s*(async\\s*)?\\(/.test(row.line),\n      )\n      .map((row) => ({\n        line: row.index + 1,\n        declaration: row.line,\n      }))\n      .slice(0, 100);\n\n  return {\n    file: rel,\n    lineCount: lines.length,\n    functions,\n    hits: hits.slice(0, 100),\n  };\n}\n\nconst files: string[] = [];\n\nfor (const root of SEARCH_ROOTS) {\n  walk(root, files);\n}\n\nconst matches =\n  files\n    .map(inspectFile)\n    .filter(Boolean);\n\nconst producerCandidates =\n  matches\n    .filter((row: any) => {\n      const text =\n        JSON.stringify(row);\n\n      return (\n        /writeFileSync|appendFileSync/.test(text) &&\n        /top1Rows|extended-pricevolume-top1-history/.test(text)\n      );\n    })\n    .map((row: any) => row.file);\n\nconst report = {\n  status:\n    \"ALPHA_V3_FORWARD_TOP1_PRODUCER_PROBE_COMPLETE\",\n\n  version:\n    VERSION,\n\n  scannedFileCount:\n    files.length,\n\n  producerCandidates,\n\n  matches,\n\n  requiredForwardProducerContract: {\n    cutoff:\n      \"2026-10-07\",\n\n    mustCreateOneFrozenCandidatePerNewTradingSession:\n      true,\n\n    candidateSelectionMustUseOnlyInformationAvailableBySourceTradingDate:\n      true,\n\n    mustPersistBeforeEntryOutcomeMatures:\n      true,\n\n    mustNotUseFutureR1R3R5ToSelectCandidate:\n      true,\n\n    outputNeededByEntryCollector: [\n      \"sourceTradingDate\",\n      \"targetSessionDate\",\n      \"top1.stockCode\",\n      \"top1.stockName\",\n      \"top1.effectiveScore\",\n      \"top1.rawPriceVolumeScore\",\n    ],\n\n    historicalFileMustRemainImmutable:\n      \"logs/alpha-v3-extended-pricevolume-top1-history.json\",\n\n    recommendedForwardFile:\n      \"logs/alpha-v3-forward-top1-sessions.json\",\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    kisRequests: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    productionChanged: false,\n  },\n\n  nextGate:\n    producerCandidates.length > 0\n      ? \"BUILD_TRUE_FORWARD_TOP1_PLUS_ENTRY_COLLECTOR\"\n      : \"PROBE_ALPHA_V3_TOP1_GENERATION_SOURCE_MORE_DEEPLY\",\n};\n\nconsole.log(\n  JSON.stringify(\n    report,\n    null,\n    2,\n  ),\n);\n";

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  source,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_FORWARD_TOP1_PRODUCER_PROBE_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-forward-top1-producer-probe.ts",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        "RUN_ALPHA_V3_FORWARD_TOP1_PRODUCER_PROBE"
    },
    null,
    2
  )
);
