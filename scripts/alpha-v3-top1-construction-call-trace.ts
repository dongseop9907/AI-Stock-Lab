import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VERSION = "ALPHA_V3_TOP1_CONSTRUCTION_CALL_TRACE_V1";
const SOURCE_REL = "scripts/alpha-v3-extended-pricevolume-top1-history.ts";
const SOURCE = path.resolve(ROOT, SOURCE_REL);
const OUTPUT = path.resolve(
  ROOT,
  "logs/alpha-v3-top1-construction-call-trace.json",
);

function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error("TOP1_HISTORY_SOURCE_NOT_FOUND");
  }

  const text = fs.readFileSync(SOURCE, "utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const top1Index = lines.findIndex((line) =>
    /\btop1Rows\b/.test(line),
  );

  if (top1Index < 0) {
    throw new Error("TOP1_ROWS_BLOCK_NOT_FOUND");
  }

  const blockStart = Math.max(0, top1Index - 80);
  const blockEnd = Math.min(lines.length, top1Index + 220);
  const block = lines.slice(blockStart, blockEnd).join("\n");

  const localFunctionDefs = lines
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter((row) =>
      /^(async\s+)?function\s+[A-Za-z_$][\w$]*/.test(row.text),
    )
    .map((row) => {
      const name =
        row.text.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)?.[1] ??
        null;

      return {
        name,
        line: row.line,
        declaration: row.text,
      };
    })
    .filter((row) => row.name);

  const importedSymbols: Array<{
    symbol: string;
    module: string;
  }> = [];

  const importRegex =
    /import\s+\{([\s\S]*?)\}\s+from\s+["']([^"']+)["'];/g;

  for (const match of text.matchAll(importRegex)) {
    const module = match[2];
    const rawSymbols = match[1]
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    for (const raw of rawSymbols) {
      if (/^type\s+/.test(raw)) {
        continue;
      }

      const cleaned = raw.replace(/^type\s+/, "");
      const parts = cleaned.split(/\s+as\s+/);
      const symbol = (parts[1] ?? parts[0]).trim();

      if (symbol) {
        importedSymbols.push({
          symbol,
          module,
        });
      }
    }
  }

  const calls = [
    ...new Set(
      [...block.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
        .map((m) => m[1])
        .filter((name) =>
          ![
            "if",
            "for",
            "while",
            "switch",
            "catch",
            "map",
            "filter",
            "sort",
            "find",
            "reduce",
            "push",
            "slice",
            "String",
            "Number",
            "Math",
            "Date",
            "Set",
            "Map",
            "Object",
            "JSON",
            "Array",
            "Boolean",
          ].includes(name),
        ),
    ),
  ];

  const localCalls = calls
    .map((name) => {
      const def = localFunctionDefs.find((row) => row.name === name);
      return def
        ? {
            name,
            definitionLine: def.line,
            declaration: def.declaration,
          }
        : null;
    })
    .filter(Boolean);

  const importedCalls = calls
    .map((name) => {
      const imp = importedSymbols.find((row) => row.symbol === name);
      return imp
        ? {
            name,
            module: imp.module,
          }
        : null;
    })
    .filter(Boolean);

  const scoreTerms = lines
    .map((line, index) => ({
      line: index + 1,
      text: line.trim(),
    }))
    .filter((row) =>
      /effectiveScore|rawPriceVolumeScore|priceVolume|quality|rank|top1/i.test(
        row.text,
      ),
    )
    .slice(0, 220);

  const producerLikeLocalCalls = localCalls.filter((row: any) =>
    /score|rank|candidate|feature|alpha|history|top1|build|reconstruct/i.test(
      row.name,
    ),
  );

  const producerLikeImportedCalls = importedCalls.filter((row: any) =>
    /score|rank|candidate|feature|alpha|history|top1|build|reconstruct/i.test(
      row.name,
    ),
  );

  const report = {
    status: "ALPHA_V3_TOP1_CONSTRUCTION_CALL_TRACE_COMPLETE",
    version: VERSION,
    sourceFile: SOURCE_REL,

    top1Block: {
      startLine: blockStart + 1,
      endLine: blockEnd,
      text: lines
        .slice(blockStart, blockEnd)
        .map((line, i) => `${blockStart + i + 1}: ${line}`)
        .join("\n"),
    },

    callsInTop1Block: calls,
    localCalls,
    importedCalls,
    producerLikeLocalCalls,
    producerLikeImportedCalls,
    scoreTerms,

    decision: {
      likelyLocalProducerFunctions: producerLikeLocalCalls,
      likelyImportedProducerFunctions: producerLikeImportedCalls,
      localProducerFound: producerLikeLocalCalls.length > 0,
      importedProducerFound: producerLikeImportedCalls.length > 0,
      nextUse:
        producerLikeLocalCalls.length > 0
          ? "TRACE_LOCAL_TOP1_PRODUCER_FUNCTION"
          : producerLikeImportedCalls.length > 0
            ? "TRACE_IMPORTED_TOP1_PRODUCER_FUNCTION"
            : "REVIEW_TOP1_BLOCK_DATAFLOW",
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
      producerLikeLocalCalls.length > 0
        ? "TRACE_LOCAL_TOP1_PRODUCER_FUNCTION"
        : producerLikeImportedCalls.length > 0
          ? "TRACE_IMPORTED_TOP1_PRODUCER_FUNCTION"
          : "REVIEW_TOP1_BLOCK_DATAFLOW",

    outputFile:
      "logs/alpha-v3-top1-construction-call-trace.json",
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(
    JSON.stringify(
      {
        status: report.status,
        top1BlockRange:
          `${report.top1Block.startLine}-${report.top1Block.endLine}`,
        likelyLocalProducerFunctions:
          report.decision.likelyLocalProducerFunctions,
        likelyImportedProducerFunctions:
          report.decision.likelyImportedProducerFunctions,
        nextGate: report.nextGate,
        outputFile: report.outputFile,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status: "ALPHA_V3_TOP1_CONSTRUCTION_CALL_TRACE_FAILED",
        version: VERSION,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
