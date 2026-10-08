import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VERSION = "ALPHA_V3_TOP1_UPSTREAM_TRACE_V1";
const SOURCE_REL = "scripts/alpha-v3-extended-pricevolume-top1-history.ts";
const SOURCE = path.resolve(ROOT, SOURCE_REL);
const OUTPUT = path.resolve(ROOT, "logs/alpha-v3-top1-upstream-trace.json");

function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error("TOP1_SOURCE_NOT_FOUND");
  }

  const text = fs.readFileSync(SOURCE, "utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const imports = lines
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter((row) => row.text.startsWith("import "))
    .slice(0, 80);

  const jsonRefs = [
    ...new Set(
      [...text.matchAll(/["']([^"']+\.json)["']/g)].map((m) => m[1]),
    ),
  ];

  const tsRefs = [
    ...new Set(
      [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]),
    ),
  ];

  const readCalls = lines
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter((row) =>
      /readFileSync|JSON\.parse|rawRanking|replay\.replay|top1Rows|ranked\s*=/.test(
        row.text,
      ),
    )
    .slice(0, 80);

  const producerHints = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (
      /rawRanking|replay\.replay|top1Rows|ranked\s*=|priceVolume/i.test(lines[i])
    ) {
      producerHints.push({
        line: i + 1,
        text: lines
          .slice(Math.max(0, i - 5), Math.min(lines.length, i + 10))
          .map((line, idx) => `${Math.max(0, i - 5) + idx + 1}: ${line}`)
          .join("\n"),
      });
    }
  }

  const historicalReplayRefs = jsonRefs.filter((x) =>
    /replay|historical|alpha-v1/i.test(x),
  );

  const likelyUpstreamHistoricalReplay =
    historicalReplayRefs[0] ?? null;

  const report = {
    status: "ALPHA_V3_TOP1_UPSTREAM_TRACE_COMPLETE",
    version: VERSION,
    sourceFile: SOURCE_REL,
    imports,
    jsonRefs,
    tsRefs,
    readCalls,
    likelyUpstreamHistoricalReplay,
    producerHints: producerHints.slice(0, 30),
    decision: {
      directRankProducer: /rankAlphaCandidates/.test(text),
      top1DerivedFromExistingReplay:
        /rawRanking|replay\.replay/.test(text),
      likelyUpstreamHistoricalReplay,
      nextUse: likelyUpstreamHistoricalReplay
        ? "TRACE_UPSTREAM_REPLAY_PRODUCER"
        : "TRACE_IMPORTED_ALPHA_SCORING_PATH",
    },
    safety: {
      databaseReads: 0,
      databaseWrites: 0,
      kisRequests: 0,
      ordersCreated: 0,
      productionChanged: false,
    },
    nextGate: likelyUpstreamHistoricalReplay
      ? "TRACE_UPSTREAM_REPLAY_PRODUCER"
      : "TRACE_IMPORTED_ALPHA_SCORING_PATH",
    outputFile: "logs/alpha-v3-top1-upstream-trace.json",
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(
    JSON.stringify(
      {
        status: report.status,
        sourceFile: report.sourceFile,
        jsonRefs: report.jsonRefs,
        directRankProducer: report.decision.directRankProducer,
        top1DerivedFromExistingReplay:
          report.decision.top1DerivedFromExistingReplay,
        likelyUpstreamHistoricalReplay:
          report.decision.likelyUpstreamHistoricalReplay,
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
        status: "ALPHA_V3_TOP1_UPSTREAM_TRACE_FAILED",
        version: VERSION,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
