import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const TARGETS = [
  "lib/trading/execute-paper-order.ts",
  "lib/trading/resolve-protective-sell-execution-realism-v2.ts",
  "lib/trading/resolve-paper-execution-realism-v2-orderbook-quote.ts",
  "lib/trading/paper-execution-realism-v2.ts",
  "lib/trading/krx-trading-calendar.ts",
] as const;

function read(rel: string) {
  const abs = path.join(ROOT, rel);

  if (!fs.existsSync(abs)) {
    return {
      file: rel,
      exists: false,
      text: "",
      lines: [] as string[],
    };
  }

  const text = fs.readFileSync(abs, "utf8");

  return {
    file: rel,
    exists: true,
    text,
    lines: text.split(/\r?\n/),
  };
}

function windows(
  lines: string[],
  patterns: RegExp[],
  radius = 38,
) {
  const indexes: number[] = [];

  lines.forEach((line, index) => {
    if (
      patterns.some(pattern =>
        pattern.test(line),
      )
    ) {
      indexes.push(index);
    }
  });

  const raw = indexes.map(index => ({
    start: Math.max(0, index - radius),
    end: Math.min(
      lines.length - 1,
      index + radius,
    ),
  }));

  const merged: Array<{
    start: number;
    end: number;
  }> = [];

  for (const current of raw) {
    const last = merged.at(-1);

    if (
      last &&
      current.start <= last.end + 2
    ) {
      last.end = Math.max(
        last.end,
        current.end,
      );
    }
    else {
      merged.push({ ...current });
    }
  }

  return merged.map(range => ({
    startLine: range.start + 1,
    endLine: range.end + 1,
    lines: lines
      .slice(range.start, range.end + 1)
      .map((text, offset) => ({
        line:
          range.start +
          offset +
          1,
        text,
      })),
  }));
}

const buy = read(TARGETS[0]);
const sell = read(TARGETS[1]);
const adapter = read(TARGETS[2]);
const realism = read(TARGETS[3]);
const krx = read(TARGETS[4]);

const rejectionPatterns = [
  /approved\s*:/,
  /rejected/i,
  /rejection/i,
  /return\s*\{/,
  /throw new Error/,
  /execution_rejection_reason/,
  /orderbookQuote/,
  /realismDecision/,
  /decision/,
  /filledQuantity/,
  /fillQuantity/,
  /status\s*:/,
  /reason\s*:/,
];

const buyContexts = windows(
  buy.lines,
  rejectionPatterns,
  42,
);

const sellContexts = windows(
  sell.lines,
  rejectionPatterns,
  42,
);

const adapterContexts = windows(
  adapter.lines,
  [
    /export type PaperExecutionOrderbookQuoteSource/,
    /export interface PaperExecutionOrderbookQuoteResult/,
    /resolvePaperExecutionRealismV2OrderbookQuote/,
    /getKisAccessToken/,
    /getDomesticStockOrderbook/,
    /return\s*\{/,
  ],
  35,
);

const realismContexts = windows(
  realism.lines,
  [
    /export interface PaperExecutionRealismV2Decision/,
    /approved/,
    /rejectionReason/,
    /filledQuantity/,
    /return\s*\{/,
  ],
  32,
);

const krxContexts = windows(
  krx.lines,
  [
    /export const KRX_TIME_ZONE/,
    /export function isKrxTradingDate/,
    /function.*Clock/i,
    /DateTimeFormat/,
    /hour/,
    /minute/,
  ],
  28,
);

const signals = {
  buy: {
    hasOrderbookQuote:
      buy.text.includes(
        "orderbookQuote",
      ),

    hasApprovedBranch:
      /approved/.test(
        buy.text,
      ),

    hasExecutionRejectionReason:
      /execution_rejection_reason/.test(
        buy.text,
      ),

    hasRejectedStatus:
      /reject/i.test(
        buy.text,
      ),
  },

  sell: {
    hasOrderbookQuote:
      sell.text.includes(
        "orderbookQuote",
      ),

    hasApprovedBranch:
      /approved/.test(
        sell.text,
      ),

    hasRejectionReason:
      /rejectionReason|reject/i.test(
        sell.text,
      ),

    hasFallbackDecision:
      /fallback/i.test(
        sell.text,
      ),
  },

  adapter: {
    hasKrxCalendar:
      /krx-trading-calendar/.test(
        adapter.text,
      ),

    hasSessionGate:
      /isKrxTradingDate/.test(
        adapter.text,
      ),

    returnsQuoteNull:
      /quote:\s*null/.test(
        adapter.text,
      ),
  },

  krx: {
    hasIsKrxTradingDate:
      /export function isKrxTradingDate/.test(
        krx.text,
      ),

    hasAsiaSeoul:
      krx.text.includes(
        "Asia/Seoul",
      ),

    hasClockParser:
      /DateTimeFormat|hour|minute/.test(
        krx.text,
      ),
  },
};

const checks = {
  buyExists: buy.exists,
  sellExists: sell.exists,
  adapterExists: adapter.exists,
  realismExists: realism.exists,
  krxCalendarExists: krx.exists,
  sourceOnly: true,
};

const failed = Object.entries(checks)
  .filter(([, ok]) => ok !== true)
  .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_ORDERBOOK_SESSION_FAIL_CLOSED_SOURCE_PROBE_PASS"
          : "AI_STOCK_LAB_PAPER_ORDERBOOK_SESSION_FAIL_CLOSED_SOURCE_PROBE_FAIL",

      purpose:
        "Find the exact fail-closed rejection path for BUY and protective SELL before adding a KRX session freshness gate.",

      signals,

      buyContexts,
      protectiveSellContexts: sellContexts,
      orderbookAdapterContexts:
        adapterContexts,
      realismDecisionContexts:
        realismContexts,
      krxCalendarContexts:
        krxContexts,

      interpretation: {
        requiredBehavior:
          "Closed/non-trading KRX session must prevent PAPER execution, not merely return quote=null and trigger synthetic fallback.",

        buy:
          "Reuse the existing approved/rejection path instead of inventing a second order-state transition.",

        protectiveSell:
          "Reuse the existing protective execution decision rejection/fallback semantics without executing a stale synthetic fill.",

        serverTime:
          "aspr_acpt_hour is diagnostic provenance only because it has no date and can be returned outside an open KRX session.",
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
        paperOrdersExecuted:
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
          ? "IMPLEMENT_KRX_SESSION_FAIL_CLOSED_ORDERBOOK_FRESHNESS_V1"
          : "REPAIR_FAIL_CLOSED_SOURCE_PROBE",
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
