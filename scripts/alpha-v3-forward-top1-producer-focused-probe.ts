import fs from "node:fs";
import path from "node:path";

const VERSION =
  "ALPHA_V3_FORWARD_TOP1_PRODUCER_FOCUSED_PROBE_V1";

const ROOT =
  process.cwd();

const SOURCE_REL =
  "scripts/alpha-v3-extended-pricevolume-top1-history.ts";

const SOURCE =
  path.resolve(
    ROOT,
    SOURCE_REL,
  );

const OUTPUT =
  path.resolve(
    ROOT,
    "logs/alpha-v3-forward-top1-producer-focused-probe.json",
  );

function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(
      "TOP1_PRODUCER_SOURCE_NOT_FOUND",
    );
  }

  const text =
    fs.readFileSync(
      SOURCE,
      "utf8",
    ).replace(
      /\r\n/g,
      "\n",
    );

  const lines =
    text.split("\n");

  const imports =
    lines
      .filter(
        (line) =>
          line.trim().startsWith("import "),
      )
      .slice(
        0,
        80,
      );

  const functions =
    lines
      .map(
        (line, index) => ({
          index,
          line:
            line.trim(),
        }),
      )
      .filter(
        (row) =>
          /^(export\s+)?(async\s+)?function\s+\w+/.test(
            row.line,
          ) ||
          /^(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/.test(
            row.line,
          ),
      )
      .map(
        (row) => ({
          line:
            row.index + 1,
          declaration:
            row.line,
        }),
      );

  const constants =
    lines
      .map(
        (line, index) => ({
          index,
          line:
            line.trim(),
        }),
      )
      .filter(
        (row) =>
          /^const\s+[A-Z0-9_]+\s*=/.test(
            row.line,
          ),
      )
      .slice(
        0,
        100,
      )
      .map(
        (row) => ({
          line:
            row.index + 1,
          declaration:
            row.line,
        }),
      );

  const tables =
    [
      ...new Set(
        [...text.matchAll(
          /\.from\(\s*["']([^"']+)["']\s*\)/g,
        )].map(
          (match) =>
            match[1],
        ),
      ),
    ];

  const fileReads =
    [
      ...new Set(
        [...text.matchAll(
          /readFileSync\([\s\S]{0,300}?["']([^"']+\.(?:json|ts|txt))["']/g,
        )].map(
          (match) =>
            match[1],
        ),
      ),
    ];

  const fileWrites =
    [
      ...new Set(
        [...text.matchAll(
          /writeFileSync\([\s\S]{0,300}?["']([^"']+\.(?:json|ts|txt))["']/g,
        )].map(
          (match) =>
            match[1],
        ),
      ),
    ];

  const hasRankAlphaCandidates =
    /rankAlphaCandidates/.test(
      text,
    );

  const hasScoreAlphaCandidate =
    /scoreAlphaCandidate/.test(
      text,
    );

  const hasRawRanking =
    /rawRanking/.test(
      text,
    );

  const hasTop1Rows =
    /top1Rows/.test(
      text,
    );

  const hasTargetSessionDate =
    /targetSessionDate/.test(
      text,
    );

  const hasSourceTradingDate =
    /sourceTradingDate/.test(
      text,
    );

  const hasDecisionAt =
    /decisionAt/.test(
      text,
    );

  const hardcodedDates =
    [
      ...new Set(
        text.match(
          /20\d{2}-\d{2}-\d{2}/g,
        ) ??
        [],
      ),
    ];

  const relevantTerms = [
    "rankAlphaCandidates",
    "rawRanking",
    "top1Rows",
    "sourceTradingDate",
    "targetSessionDate",
    "decisionAt",
    "effectiveScore",
    "rawPriceVolumeScore",
    "market_daily_bars",
    "alpha-v1-alpha-only-historical-replay-read-only.json",
    "writeFileSync",
  ];

  const snippets = [];

  for (const term of relevantTerms) {
    const indexes =
      lines
        .map(
          (line, index) => ({
            line,
            index,
          }),
        )
        .filter(
          (row) =>
            row.line.includes(
              term,
            ),
        )
        .slice(
          0,
          8,
        );

    for (const hit of indexes) {
      const from =
        Math.max(
          0,
          hit.index - 6,
        );

      const to =
        Math.min(
          lines.length,
          hit.index + 14,
        );

      snippets.push({
        term,
        line:
          hit.index + 1,
        text:
          lines
            .slice(
              from,
              to,
            )
            .map(
              (line, offset) =>
                `${from + offset + 1}: ${line}`,
            )
            .join("\n"),
      });
    }
  }

  const likelyHistoricalOnly =
    hardcodedDates.length > 0 &&
    (
      /historical/i.test(
        SOURCE_REL,
      ) ||
      /historical/i.test(
        text,
      )
    );

  const reusableForForward =
    hasRankAlphaCandidates &&
    hasTop1Rows &&
    hasSourceTradingDate &&
    hasTargetSessionDate;

  const report = {
    status:
      "ALPHA_V3_FORWARD_TOP1_PRODUCER_FOCUSED_PROBE_COMPLETE",

    version:
      VERSION,

    sourceFile:
      SOURCE_REL,

    lineCount:
      lines.length,

    structure: {
      imports,
      functions,
      constants,
      tables,
      fileReads,
      fileWrites,
    },

    signals: {
      hasRankAlphaCandidates,
      hasScoreAlphaCandidate,
      hasRawRanking,
      hasTop1Rows,
      hasSourceTradingDate,
      hasTargetSessionDate,
      hasDecisionAt,
      hardcodedDates,
      likelyHistoricalOnly,
      reusableForForward,
    },

    snippets,

    decision: {
      sourceConfirmedAsTop1Producer:
        reusableForForward,

      recommendedApproach:
        reusableForForward
          ? "EXTRACT_AND_REUSE_FROZEN_TOP1_SELECTION_LOGIC_FOR_FORWARD_ONLY_DATASET"
          : "REVIEW_PRODUCER_SOURCE_MANUALLY",

      historicalOutputMustRemainImmutable:
        true,

      forwardOutput:
        "logs/alpha-v3-forward-top1-sessions.json",

      frozenCutoff:
        "2026-10-07",

      nextUse:
        reusableForForward
          ? "BUILD_TRUE_FORWARD_TOP1_PLUS_ENTRY_COLLECTOR"
          : "REVIEW_TOP1_PRODUCER_FOCUSED_PROBE",
    },

    safety: {
      databaseReads:
        0,
      databaseWrites:
        0,
      kisRequests:
        0,
      ordersCreated:
        0,
      positionsChanged:
        0,
      productionChanged:
        false,
    },

    nextGate:
      reusableForForward
        ? "BUILD_TRUE_FORWARD_TOP1_PLUS_ENTRY_COLLECTOR"
        : "REVIEW_TOP1_PRODUCER_FOCUSED_PROBE",

    outputFile:
      "logs/alpha-v3-forward-top1-producer-focused-probe.json",
  };

  fs.mkdirSync(
    path.dirname(OUTPUT),
    {
      recursive: true,
    },
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

        lineCount:
          report.lineCount,

        tables:
          report.structure.tables,

        hardcodedDates:
          report.signals.hardcodedDates,

        hasRankAlphaCandidates:
          report.signals.hasRankAlphaCandidates,

        hasTop1Rows:
          report.signals.hasTop1Rows,

        hasSourceTradingDate:
          report.signals.hasSourceTradingDate,

        hasTargetSessionDate:
          report.signals.hasTargetSessionDate,

        reusableForForward:
          report.signals.reusableForForward,

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
          "ALPHA_V3_FORWARD_TOP1_PRODUCER_FOCUSED_PROBE_FAILED",

        version:
          VERSION,

        error:
          error instanceof Error
            ? error.message
            : String(error),

        nextGate:
          "REVIEW_TOP1_PRODUCER_FOCUSED_PROBE_FAILURE",
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
}
