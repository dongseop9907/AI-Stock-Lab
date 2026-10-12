import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const TARGET_FILES = [
  "lib/trading/paper-execution-price-model.ts",
  "lib/trading/paper-execution-price-resolver.ts",
  "lib/trading/resolve-safe-paper-buy-execution.ts",
  "lib/trading/execute-paper-order.ts",
  "lib/trading/gap-slippage-risk.ts",
  "lib/alpha/feature-adapters.ts",
] as const;

const SEARCH_ROOTS = [
  "lib",
  "app",
] as const;

const KEYWORDS = [
  "orderbook",
  "order_book",
  "bid",
  "ask",
  "best_bid",
  "best_ask",
  "spread",
  "호가",
  "매수호가",
  "매도호가",
  "kis",
  "inquire-asking-price",
  "asking-price",
  "askp",
  "bidp",
] as const;

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const out: string[] = [];

  for (const entry of fs.readdirSync(dir, {
    withFileTypes: true,
  })) {
    const abs =
      path.join(
        dir,
        entry.name,
      );

    if (
      entry.isDirectory()
    ) {
      if (
        [
          "node_modules",
          ".next",
          ".git",
          "dist",
          "build",
        ].includes(
          entry.name,
        )
      ) {
        continue;
      }

      out.push(
        ...walk(abs),
      );
      continue;
    }

    if (
      entry.isFile() &&
      /\.(ts|tsx|js|cjs|mjs)$/.test(
        entry.name,
      )
    ) {
      out.push(abs);
    }
  }

  return out;
}

function rel(abs: string) {
  return path
    .relative(
      ROOT,
      abs,
    )
    .replaceAll(
      "\\",
      "/",
    );
}

function scanFile(
  abs: string,
) {
  const text =
    fs.readFileSync(
      abs,
      "utf8",
    );

  const lines =
    text.split(/\r?\n/);

  const hits: Array<{
    line: number;
    text: string;
    matched: string[];
  }> = [];

  lines.forEach(
    (
      line,
      index,
    ) => {
      const lower =
        line.toLowerCase();

      const matched =
        KEYWORDS.filter(
          keyword =>
            lower.includes(
              keyword.toLowerCase(),
            ),
        );

      if (
        matched.length >
        0
      ) {
        hits.push({
          line:
            index + 1,
          text:
            line.trim(),
          matched:
            [...matched],
        });
      }
    },
  );

  return {
    file:
      rel(abs),
    hitCount:
      hits.length,
    hits:
      hits.slice(
        0,
        80,
      ),
  };
}

const explicitTargets =
  TARGET_FILES.map(
    target => {
      const abs =
        path.join(
          ROOT,
          target,
        );

      return {
        file:
          target,
        exists:
          fs.existsSync(
            abs,
          ),
        scan:
          fs.existsSync(
            abs,
          )
            ? scanFile(
                abs,
              )
            : null,
      };
    },
  );

const discoveredFiles =
  SEARCH_ROOTS.flatMap(
    root =>
      walk(
        path.join(
          ROOT,
          root,
        ),
      ),
  );

const discovered =
  discoveredFiles
    .map(
      scanFile,
    )
    .filter(
      row =>
        row.hitCount >
        0,
    )
    .sort(
      (
        left,
        right,
      ) =>
        right.hitCount -
        left.hitCount,
    )
    .slice(
      0,
      40,
    );

const executionFiles =
  explicitTargets
    .filter(
      row =>
        row.exists,
    )
    .map(
      row =>
        row.scan!,
    );

const executionText =
  executionFiles
    .flatMap(
      row =>
        row.hits,
    );

const hasOrderbookExecutionInput =
  executionText.some(
    hit =>
      hit.matched.some(
        keyword =>
          [
            "orderbook",
            "order_book",
            "best_bid",
            "best_ask",
            "askp",
            "bidp",
            "호가",
          ].includes(
            keyword,
          ),
      ),
  );

const hasSpreadExecutionInput =
  executionText.some(
    hit =>
      hit.matched.includes(
        "spread",
      ),
  );

const discoveredOrderbookCandidates =
  discovered.filter(
    row =>
      row.hits.some(
        hit =>
          hit.matched.some(
            keyword =>
              [
                "orderbook",
                "order_book",
                "best_bid",
                "best_ask",
                "askp",
                "bidp",
                "호가",
                "매수호가",
                "매도호가",
                "inquire-asking-price",
                "asking-price",
              ].includes(
                keyword,
              ),
          ),
      ),
  );

const checks = {
  coreExecutionFilesPresent:
    TARGET_FILES
      .slice(
        0,
        5,
      )
      .every(
        target =>
          explicitTargets.some(
            row =>
              row.file ===
                target &&
              row.exists,
          ),
      ),

  repositoryScanCompleted:
    discoveredFiles.length >
    0,

  noSourceWrites:
    true,
};

const failed =
  Object.entries(
    checks,
  )
    .filter(
      ([, ok]) =>
        ok !== true,
    )
    .map(
      ([name]) =>
        name,
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length ===
          0
          ? "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_INPUT_V1_SOURCE_PROBE_PASS"
          : "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_INPUT_V1_SOURCE_PROBE_FAIL",

      purpose:
        "Map whether PAPER execution currently consumes real bid/ask/orderbook/spread inputs and identify reusable KIS orderbook sources.",

      currentExecutionSurface: {
        hasOrderbookExecutionInput,
        hasSpreadExecutionInput,
      },

      explicitTargets,

      discoveredOrderbookCandidates,

      topKeywordFiles:
        discovered.slice(
          0,
          20,
        ),

      interpretation: {
        nextIfReusableOrderbookExists:
          "BIND_EXISTING_ORDERBOOK_TO_PAPER_EXECUTION_PRICE_MODEL",

        nextIfNoReusableOrderbookExists:
          "ADD_READ_ONLY_KIS_ORDERBOOK_SNAPSHOT_ADAPTER_FIRST",

        syntheticOrderbookRequired:
          false,
      },

      checks,

      safety: {
        readOnly:
          true,
        sourceFilesWritten:
          0,
        databaseReads:
          0,
        databaseWrites:
          0,
        externalOrders:
          0,
        paperOrdersCreated:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false,
      },

      failed,

      nextGate:
        failed.length ===
          0
          ? "CLASSIFY_EXISTING_ORDERBOOK_DATA_SOURCE_AND_EXECUTION_BINDING_GAP"
          : "REPAIR_ORDERBOOK_SOURCE_PROBE",
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length ===
    0
    ? 0
    : 1;
