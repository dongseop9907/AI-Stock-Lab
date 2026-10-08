import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VERSION = "ALPHA_V3_TOP1_EVIDENCE_PRODUCER_TRACE_V1";

const HISTORY_REL =
  "scripts/alpha-v3-extended-pricevolume-top1-history.ts";

const ADAPTER_REL =
  "lib/alpha/daily-market-adapters.ts";

const HISTORY =
  path.resolve(ROOT, HISTORY_REL);

const ADAPTER =
  path.resolve(ROOT, ADAPTER_REL);

const OUTPUT =
  path.resolve(
    ROOT,
    "logs/alpha-v3-top1-evidence-producer-trace.json",
  );

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

function functionBlock(
  source: string,
  name: string,
) {
  const lines =
    source
      .replace(/\r\n/g, "\n")
      .split("\n");

  const start =
    lines.findIndex((line) =>
      new RegExp(
        `(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b|(?:export\\s+)?const\\s+${name}\\s*=`,
      ).test(line),
    );

  if (start < 0) {
    return null;
  }

  let depth = 0;
  let seenBrace = false;
  let end = Math.min(
    lines.length,
    start + 250,
  );

  for (
    let i = start;
    i < Math.min(
      lines.length,
      start + 250,
    );
    i += 1
  ) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth += 1;
        seenBrace = true;
      } else if (ch === "}") {
        depth -= 1;
      }
    }

    if (
      seenBrace &&
      depth <= 0 &&
      i > start
    ) {
      end = i + 1;
      break;
    }
  }

  return {
    startLine:
      start + 1,
    endLine:
      end,
    text:
      numbered(
        lines,
        start,
        end,
      ),
  };
}

function main() {
  if (!fs.existsSync(HISTORY)) {
    throw new Error(
      "TOP1_HISTORY_SOURCE_NOT_FOUND",
    );
  }

  if (!fs.existsSync(ADAPTER)) {
    throw new Error(
      "DAILY_MARKET_ADAPTER_SOURCE_NOT_FOUND",
    );
  }

  const historyText =
    fs.readFileSync(
      HISTORY,
      "utf8",
    ).replace(
      /\r\n/g,
      "\n",
    );

  const adapterText =
    fs.readFileSync(
      ADAPTER,
      "utf8",
    ).replace(
      /\r\n/g,
      "\n",
    );

  const historyLines =
    historyText.split("\n");

  const evidenceFunction =
    functionBlock(
      adapterText,
      "buildDailyPriceVolumeEvidence",
    );

  const callIndexes =
    historyLines
      .map(
        (line, index) => ({
          line,
          index,
        }),
      )
      .filter((row) =>
        row.line.includes(
          "buildDailyPriceVolumeEvidence",
        ),
      )
      .map((row) =>
        row.index,
      );

  const evidenceCallContexts =
    callIndexes.map((index) => ({
      line:
        index + 1,
      text:
        numbered(
          historyLines,
          Math.max(
            0,
            index - 18,
          ),
          Math.min(
            historyLines.length,
            index + 40,
          ),
        ),
    }));

  const top1Index =
    historyLines.findIndex((line) =>
      /\btop1Rows\b/.test(
        line,
      ),
    );

  const top1Context =
    top1Index >= 0
      ? {
          startLine:
            Math.max(
              0,
              top1Index - 120,
            ) + 1,
          endLine:
            Math.min(
              historyLines.length,
              top1Index + 260,
            ),
          text:
            numbered(
              historyLines,
              Math.max(
                0,
                top1Index - 120,
              ),
              Math.min(
                historyLines.length,
                top1Index + 260,
              ),
            ),
        }
      : null;

  const scoreRelevantLines =
    historyLines
      .map(
        (line, index) => ({
          line:
            index + 1,
          text:
            line.trim(),
        }),
      )
      .filter((row) =>
        /effectiveScore|rawScore|rawPriceVolumeScore|quality|contribution|priceVolume|sort\(|rank|top1/i.test(
          row.text,
        ),
      )
      .slice(
        0,
        260,
      );

  const hasPriceVolumeEvidenceCall =
    callIndexes.length > 0;

  const hasExplicitSort =
    /sort\s*\(/.test(
      top1Context?.text ??
      "",
    );

  const hasEffectiveScore =
    /effectiveScore/.test(
      top1Context?.text ??
      "",
    );

  const hasRawPriceVolumeScore =
    /rawPriceVolumeScore/.test(
      top1Context?.text ??
      "",
    );

  const hasTop1Selection =
    /(?:\[0\]|at\(0\)|slice\(0,\s*1\))/.test(
      top1Context?.text ??
      "",
    );

  const hardcodedDates =
    [
      ...new Set(
        historyText.match(
          /20\d{2}-\d{2}-\d{2}/g,
        ) ??
        [],
      ),
    ];

  const forwardReusableSurface =
    hasPriceVolumeEvidenceCall &&
    hasExplicitSort &&
    hasEffectiveScore &&
    hasTop1Selection;

  const report = {
    status:
      "ALPHA_V3_TOP1_EVIDENCE_PRODUCER_TRACE_COMPLETE",

    version:
      VERSION,

    files: {
      history:
        HISTORY_REL,
      adapter:
        ADAPTER_REL,
    },

    evidenceFunction,

    evidenceCallContexts,

    top1Context,

    scoreRelevantLines,

    signals: {
      hasPriceVolumeEvidenceCall,
      hasExplicitSort,
      hasEffectiveScore,
      hasRawPriceVolumeScore,
      hasTop1Selection,
      hardcodedDates,
      forwardReusableSurface,
    },

    decision: {
      forwardReusableSurface,

      recommendedApproach:
        forwardReusableSurface
          ? "REUSE_BUILD_DAILY_PRICE_VOLUME_EVIDENCE_AND_FROZEN_TOP1_SORT_FOR_FORWARD_PRODUCER"
          : "REVIEW_TOP1_SCORE_FORMULA_BEFORE_FORWARD_IMPLEMENTATION",

      nextUse:
        forwardReusableSurface
          ? "BUILD_TRUE_FORWARD_TOP1_PLUS_ENTRY_COLLECTOR"
          : "REVIEW_TOP1_EVIDENCE_TRACE",
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
      forwardReusableSurface
        ? "BUILD_TRUE_FORWARD_TOP1_PLUS_ENTRY_COLLECTOR"
        : "REVIEW_TOP1_EVIDENCE_TRACE",

    outputFile:
      "logs/alpha-v3-top1-evidence-producer-trace.json",
  };

  fs.mkdirSync(
    path.dirname(
      OUTPUT,
    ),
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

        evidenceFunctionFound:
          Boolean(
            report.evidenceFunction,
          ),

        evidenceCallCount:
          report.evidenceCallContexts.length,

        hasExplicitSort:
          report.signals.hasExplicitSort,

        hasEffectiveScore:
          report.signals.hasEffectiveScore,

        hasRawPriceVolumeScore:
          report.signals.hasRawPriceVolumeScore,

        hasTop1Selection:
          report.signals.hasTop1Selection,

        hardcodedDates:
          report.signals.hardcodedDates,

        forwardReusableSurface:
          report.signals.forwardReusableSurface,

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
          "ALPHA_V3_TOP1_EVIDENCE_PRODUCER_TRACE_FAILED",

        version:
          VERSION,

        error:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
}
