import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const TARGETS = [
  "lib/trading/execute-paper-order.ts",
  "lib/trading/resolve-protective-sell-execution-realism-v2.ts",
  "lib/trading/paper-execution-realism-v2.ts",
] as const;

function read(rel: string) {
  const abs = path.join(ROOT, rel);

  if (!fs.existsSync(abs)) {
    return {
      exists: false,
      lines: [] as string[],
      text: "",
    };
  }

  const text = fs.readFileSync(abs, "utf8");

  return {
    exists: true,
    lines: text.split(/\r?\n/),
    text,
  };
}

function windowsAround(
  lines: string[],
  patterns: RegExp[],
  radius = 30,
) {
  const indexes: number[] = [];

  lines.forEach((line, index) => {
    if (patterns.some(pattern => pattern.test(line))) {
      indexes.push(index);
    }
  });

  const windows = indexes.map(index => ({
    start: Math.max(0, index - radius),
    end: Math.min(lines.length - 1, index + radius),
  }));

  const merged: Array<{ start: number; end: number }> = [];

  for (const current of windows) {
    const last = merged.at(-1);

    if (last && current.start <= last.end + 2) {
      last.end = Math.max(last.end, current.end);
    }
    else {
      merged.push({ ...current });
    }
  }

  return merged.map(window => ({
    startLine: window.start + 1,
    endLine: window.end + 1,
    lines: lines
      .slice(window.start, window.end + 1)
      .map((text, offset) => ({
        line: window.start + offset + 1,
        text,
      })),
  }));
}

const buy = read(TARGETS[0]);
const sell = read(TARGETS[1]);
const model = read(TARGETS[2]);

const callPatterns = [
  /evaluatePaperExecutionRealismV2/,
  /\bquote\s*:/,
  /bestBidPrice/,
  /bestAskPrice/,
  /bestBidQuantity/,
  /bestAskQuantity/,
  /referencePrice/,
  /observedAt/,
  /currentPrice/,
  /market_snapshot/,
  /latest_snapshot/,
  /snapshot/i,
];

const buyWindows = windowsAround(
  buy.lines,
  callPatterns,
  35,
);

const sellWindows = windowsAround(
  sell.lines,
  callPatterns,
  35,
);

const modelQuoteWindows = windowsAround(
  model.lines,
  [
    /export interface PaperQuoteSnapshot/,
    /bestBidPrice/,
    /bestAskPrice/,
    /REFERENCE_PLUS_SYNTHETIC_SPREAD/,
    /BEST_ASK/,
    /BEST_BID/,
  ],
  25,
);

const buyUsesQuoteObject =
  /\bquote\s*:/.test(buy.text);

const sellUsesQuoteObject =
  /\bquote\s*:/.test(sell.text);

const buyHasDirectBidAsk =
  /(bestBidPrice|bestAskPrice|bestBidQuantity|bestAskQuantity)/.test(
    buy.text,
  );

const sellHasDirectBidAsk =
  /(bestBidPrice|bestAskPrice|bestBidQuantity|bestAskQuantity)/.test(
    sell.text,
  );

const buyCallsRealism =
  /evaluatePaperExecutionRealismV2\s*\(/.test(
    buy.text,
  );

const sellCallsRealism =
  /evaluatePaperExecutionRealismV2\s*\(/.test(
    sell.text,
  );

const buyLikelyQuoteUnpopulated =
  buyCallsRealism &&
  !buyHasDirectBidAsk;

const sellLikelyQuoteUnpopulated =
  sellCallsRealism &&
  !sellHasDirectBidAsk;

const classification =
  buyLikelyQuoteUnpopulated &&
  sellLikelyQuoteUnpopulated
    ? "REALISM_V2_BOUND_BUT_BUY_AND_SELL_HAVE_NO_DIRECT_BID_ASK_POPULATION"
    : buyLikelyQuoteUnpopulated
      ? "BUY_REALISM_BOUND_BUT_BID_ASK_POPULATION_MISSING"
      : sellLikelyQuoteUnpopulated
        ? "SELL_REALISM_BOUND_BUT_BID_ASK_POPULATION_MISSING"
        : "DIRECT_BID_ASK_REFERENCES_PRESENT_REVIEW_CALL_CONTEXT";

const checks = {
  buyFileExists:
    buy.exists,

  sellFileExists:
    sell.exists,

  modelFileExists:
    model.exists,

  buyCallsRealism,
  sellCallsRealism,

  sourceOnly:
    true,
};

const failed = Object.entries(checks)
  .filter(([, ok]) => ok !== true)
  .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_ORDERBOOK_RUNTIME_INPUT_V1_FOCUSED_PROBE_PASS"
          : "AI_STOCK_LAB_PAPER_ORDERBOOK_RUNTIME_INPUT_V1_FOCUSED_PROBE_FAIL",

      classification,

      runtimeInputSurface: {
        buy: {
          callsRealism:
            buyCallsRealism,
          usesQuoteObject:
            buyUsesQuoteObject,
          hasDirectBidAskReferences:
            buyHasDirectBidAsk,
          likelyQuoteUnpopulated:
            buyLikelyQuoteUnpopulated,
        },

        protectiveSell: {
          callsRealism:
            sellCallsRealism,
          usesQuoteObject:
            sellUsesQuoteObject,
          hasDirectBidAskReferences:
            sellHasDirectBidAsk,
          likelyQuoteUnpopulated:
            sellLikelyQuoteUnpopulated,
        },
      },

      buyCallContext:
        buyWindows,

      protectiveSellCallContext:
        sellWindows,

      realismModelQuoteContract:
        modelQuoteWindows,

      interpretation: {
        ifQuoteMissing:
          "ADD_READ_ONLY_KIS_ORDERBOOK_SNAPSHOT_ADAPTER_AND_POPULATE_PaperQuoteSnapshot_BEFORE_REALISM_EVALUATION",

        ifQuotePresentButNoDirectRefs:
          "TRACE_HELPER_OR_ALIAS_SUPPLYING_QUOTE_BEFORE_ANY_PATCH",

        syntheticSpreadFallback:
          "KEEP_AS_FAILSAFE_ONLY_WHEN_REAL_QUOTE_IS_UNAVAILABLE",
      },

      safety: {
        readOnly:
          true,
        sourceFilesWritten:
          0,
        databaseReads:
          0,
        databaseWrites:
          0,
        externalApiCalls:
          0,
        paperOrdersCreated:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false,
      },

      checks,
      failed,

      nextGate:
        failed.length === 0
          ? "CONFIRM_EXACT_QUOTE_ARGUMENT_AND_IMPLEMENT_REAL_ORDERBOOK_ADAPTER_IF_MISSING"
          : "REPAIR_RUNTIME_INPUT_PROBE",
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
