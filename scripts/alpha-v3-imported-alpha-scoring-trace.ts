import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VERSION = "ALPHA_V3_IMPORTED_ALPHA_SCORING_TRACE_V1";

const SOURCE_REL =
  "scripts/alpha-v3-extended-pricevolume-top1-history.ts";

const SOURCE =
  path.resolve(ROOT, SOURCE_REL);

const OUTPUT =
  path.resolve(
    ROOT,
    "logs/alpha-v3-imported-alpha-scoring-trace.json",
  );

function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(
      "TOP1_HISTORY_SOURCE_NOT_FOUND",
    );
  }

  const text =
    fs.readFileSync(
      SOURCE,
      "utf8",
    ).replace(/\r\n/g, "\n");

  const lines =
    text.split("\n");

  const importBlocks: Array<{
    line: number;
    text: string;
    module: string | null;
    symbols: string[];
  }> = [];

  let buffer: string[] = [];
  let startLine = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (
      buffer.length === 0 &&
      line.trim().startsWith("import ")
    ) {
      buffer = [line];
      startLine = i + 1;

      if (line.includes(";")) {
        const block = buffer.join("\n");
        const module =
          block.match(/from\s+["']([^"']+)["']/)?.[1] ??
          block.match(/import\s+["']([^"']+)["']/)?.[1] ??
          null;

        const symbolBody =
          block.match(/\{([\s\S]*?)\}/)?.[1] ?? "";

        const symbols =
          symbolBody
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
            .map((x) => x.split(/\s+as\s+/)[1] ?? x.split(/\s+as\s+/)[0]);

        importBlocks.push({
          line: startLine,
          text: block,
          module,
          symbols,
        });

        buffer = [];
      }

      continue;
    }

    if (buffer.length > 0) {
      buffer.push(line);

      if (line.includes(";")) {
        const block = buffer.join("\n");
        const module =
          block.match(/from\s+["']([^"']+)["']/)?.[1] ??
          null;

        const symbolBody =
          block.match(/\{([\s\S]*?)\}/)?.[1] ?? "";

        const symbols =
          symbolBody
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
            .map((x) => {
              const parts = x.split(/\s+as\s+/);
              return parts[1] ?? parts[0];
            });

        importBlocks.push({
          line: startLine,
          text: block,
          module,
          symbols,
        });

        buffer = [];
      }
    }
  }

  const localModules =
    importBlocks.filter((row) =>
      row.module?.startsWith("."),
    );

  const symbolUsage =
    localModules.map((row) => ({
      module:
        row.module,
      symbols:
        row.symbols.map((symbol) => {
          const escaped =
            symbol.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            );

          const regex =
            new RegExp(
              `\\b${escaped}\\b`,
              "g",
            );

          const matches =
            [...text.matchAll(regex)]
              .map((match) => {
                const before =
                  text.slice(
                    0,
                    match.index ?? 0,
                  );

                const line =
                  before.split("\n").length;

                return line;
              })
              .filter((line) =>
                line !== row.line,
              );

          return {
            symbol,
            usageLines:
              [...new Set(matches)].slice(0, 30),
          };
        }),
    }));

  const top1Lines =
    lines
      .map((line, index) => ({
        line: index + 1,
        text: line.trim(),
      }))
      .filter((row) =>
        /top1Rows|top1\s*=|sort\(|effectiveScore|rawPriceVolumeScore|candidate|score/i.test(
          row.text,
        ),
      )
      .slice(0, 160);

  const likelyScoringImports =
    symbolUsage
      .flatMap((row) =>
        row.symbols
          .filter((symbol) =>
            symbol.usageLines.some((line) => {
              const sourceLine =
                lines[line - 1] ?? "";

              return /score|rank|candidate|feature|alpha|top1|dimension|quality/i.test(
                sourceLine,
              );
            }),
          )
          .map((symbol) => ({
            module:
              row.module,
            symbol:
              symbol.symbol,
            usageLines:
              symbol.usageLines,
          })),
      );

  const likelyModules =
    [
      ...new Set(
        likelyScoringImports
          .map((row) => row.module)
          .filter(Boolean),
      ),
    ];

  const report = {
    status:
      "ALPHA_V3_IMPORTED_ALPHA_SCORING_TRACE_COMPLETE",

    version:
      VERSION,

    sourceFile:
      SOURCE_REL,

    localImports:
      localModules,

    symbolUsage,

    likelyScoringImports,

    likelyModules,

    top1ConstructionLines:
      top1Lines,

    decision: {
      scoringPathFound:
        likelyModules.length > 0,

      candidateModules:
        likelyModules,

      nextUse:
        likelyModules.length > 0
          ? "TRACE_CANDIDATE_MODULE_IMPLEMENTATION"
          : "TRACE_TOP1_CONSTRUCTION_BLOCK_MANUALLY",
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
      likelyModules.length > 0
        ? "TRACE_CANDIDATE_MODULE_IMPLEMENTATION"
        : "TRACE_TOP1_CONSTRUCTION_BLOCK_MANUALLY",

    outputFile:
      "logs/alpha-v3-imported-alpha-scoring-trace.json",
  };

  fs.mkdirSync(
    path.dirname(OUTPUT),
    { recursive: true },
  );

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(
      report,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        sourceFile:
          report.sourceFile,

        candidateModules:
          report.decision.candidateModules,

        scoringPathFound:
          report.decision.scoringPathFound,

        likelyScoringImports:
          report.likelyScoringImports.map(
            (row) => ({
              module: row.module,
              symbol: row.symbol,
              usageLines: row.usageLines,
            }),
          ),

        nextGate:
          report.nextGate,

        outputFile:
          report.outputFile,
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
        status:
          "ALPHA_V3_IMPORTED_ALPHA_SCORING_TRACE_FAILED",

        version:
          VERSION,

        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
}
