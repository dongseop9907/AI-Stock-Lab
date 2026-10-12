import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const TARGET_REALISM =
  "lib/trading/paper-execution-realism-v2.ts";

const TARGET_KIS =
  "lib/kis/client.ts";

const EXECUTION_CHAIN = [
  "lib/trading/paper-execution-price-model.ts",
  "lib/trading/paper-execution-price-resolver.ts",
  "lib/trading/resolve-safe-paper-buy-execution.ts",
  "lib/trading/execute-paper-order.ts",
  "lib/trading/execute-approved-paper-orders.ts",
] as const;

const SEARCH_ROOTS = [
  "lib",
  "app",
  "scripts",
] as const;

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const out: string[] = [];

  for (
    const entry of fs.readdirSync(
      dir,
      { withFileTypes: true },
    )
  ) {
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
          "backups",
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

function readRel(file: string) {
  const abs =
    path.join(
      ROOT,
      file,
    );

  return fs.existsSync(abs)
    ? fs.readFileSync(
        abs,
        "utf8",
      )
    : "";
}

function lineMatches(
  text: string,
  patterns: RegExp[],
) {
  const lines =
    text.split(/\r?\n/);

  const rows: Array<{
    line: number;
    text: string;
    matched: string[];
  }> = [];

  lines.forEach(
    (
      line,
      index,
    ) => {
      const matched =
        patterns
          .filter(
            pattern =>
              pattern.test(
                line,
              ),
          )
          .map(
            pattern =>
              pattern.source,
          );

      if (
        matched.length >
        0
      ) {
        rows.push({
          line:
            index + 1,
          text:
            line.trim(),
          matched,
        });
      }
    },
  );

  return rows;
}

const realismText =
  readRel(
    TARGET_REALISM,
  );

const kisText =
  readRel(
    TARGET_KIS,
  );

const exportedFunctions =
  [
    ...realismText.matchAll(
      /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
    ),
  ].map(
    match =>
      match[1],
  );

const exportedInterfaces =
  [
    ...realismText.matchAll(
      /export\s+interface\s+([A-Za-z0-9_]+)/g,
    ),
  ].map(
    match =>
      match[1],
  );

const exportedConsts =
  [
    ...realismText.matchAll(
      /export\s+const\s+([A-Za-z0-9_]+)/g,
    ),
  ].map(
    match =>
      match[1],
  );

const repoFiles =
  SEARCH_ROOTS.flatMap(
    root =>
      walk(
        path.join(
          ROOT,
          root,
        ),
      ),
  );

const realismRefs =
  repoFiles
    .filter(
      abs =>
        rel(abs) !==
        TARGET_REALISM,
    )
    .map(
      abs => {
        const text =
          fs.readFileSync(
            abs,
            "utf8",
          );

        const importsModule =
          text.includes(
            "paper-execution-realism-v2",
          );

        const symbolHits =
          [
            ...exportedFunctions,
            ...exportedConsts,
          ].filter(
            symbol =>
              text.includes(
                symbol,
              ),
          );

        return {
          file:
            rel(abs),
          importsModule,
          symbolHits,
        };
      },
    )
    .filter(
      row =>
        row.importsModule ||
        row.symbolHits.length >
          0,
    );

const executionChain =
  EXECUTION_CHAIN.map(
    file => {
      const text =
        readRel(file);

      return {
        file,
        exists:
          text.length >
          0,
        importsRealismV2:
          text.includes(
            "paper-execution-realism-v2",
          ),
        exportedFunctionRefs:
          exportedFunctions.filter(
            symbol =>
              text.includes(
                symbol,
              ),
          ),
        bidAskRefs:
          lineMatches(
            text,
            [
              /bestBid/i,
              /bestAsk/i,
              /\bbid\b/i,
              /\bask\b/i,
              /spread/i,
              /orderbook/i,
            ],
          ).slice(
            0,
            40,
          ),
      };
    },
  );

const kisOrderbookPatterns = [
  /inquire-asking-price/i,
  /asking-price/i,
  /orderbook/i,
  /best.?bid/i,
  /best.?ask/i,
  /bidp/i,
  /askp/i,
  /bid_price/i,
  /ask_price/i,
  /매수호가/,
  /매도호가/,
  /호가/,
  /FHKST01010200/,
];

const kisOrderbookHits =
  lineMatches(
    kisText,
    kisOrderbookPatterns,
  );

const kisFetchPaths =
  lineMatches(
    kisText,
    [
      /\/uapi\//i,
      /tr_id/i,
      /fetch\(/i,
    ],
  ).slice(
    0,
    200,
  );

const quoteInputFields =
  [
    "bestBidPrice",
    "bestAskPrice",
    "bestBidQuantity",
    "bestAskQuantity",
  ].map(
    field => ({
      field,
      presentInRealismV2:
        realismText.includes(
          field,
        ),
    }),
  );

const reusableRealismModelExists =
  realismText.length >
    0 &&
  quoteInputFields.every(
    row =>
      row.presentInRealismV2,
  );

const boundIntoExecutionChain =
  executionChain.some(
    row =>
      row.importsRealismV2 ||
      row.exportedFunctionRefs.length >
        0,
  );

const reusableKisOrderbookEndpointExists =
  kisOrderbookHits.length >
  0;

const classification =
  reusableRealismModelExists &&
  !boundIntoExecutionChain &&
  !reusableKisOrderbookEndpointExists
    ? "REALISM_MODEL_EXISTS_BUT_NO_EXECUTION_BINDING_AND_NO_KIS_ORDERBOOK_ADAPTER"
    : reusableRealismModelExists &&
      !boundIntoExecutionChain &&
      reusableKisOrderbookEndpointExists
      ? "REALISM_MODEL_EXISTS_AND_KIS_ORDERBOOK_SOURCE_EXISTS_BUT_NOT_BOUND"
      : reusableRealismModelExists &&
        boundIntoExecutionChain
        ? "REALISM_MODEL_ALREADY_REFERENCED_BY_EXECUTION_CHAIN_REVIEW_RUNTIME_INPUTS"
        : "INCONCLUSIVE";

const checks = {
  realismFileExists:
    realismText.length >
    0,

  kisClientExists:
    kisText.length >
    0,

  executionChainScanned:
    executionChain.some(
      row =>
        row.exists,
    ),

  sourceOnly:
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
          ? "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_BINDING_V1_FOCUSED_PROBE_PASS"
          : "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_BINDING_V1_FOCUSED_PROBE_FAIL",

      realismV2: {
        file:
          TARGET_REALISM,
        exportedFunctions,
        exportedInterfaces,
        exportedConsts,
        quoteInputFields,
        reusableRealismModelExists,
      },

      repositoryReferences: {
        count:
          realismRefs.length,
        rows:
          realismRefs.slice(
            0,
            100,
          ),
      },

      executionChain: {
        boundIntoExecutionChain,
        files:
          executionChain,
      },

      kisOrderbookSource: {
        file:
          TARGET_KIS,
        reusableKisOrderbookEndpointExists,
        orderbookHits:
          kisOrderbookHits.slice(
            0,
            100,
          ),
        endpointContext:
          kisFetchPaths,
      },

      classification,

      interpretation: {
        ifNoKisOrderbookAdapter:
          "ADD_READ_ONLY_KIS_DOMESTIC_ORDERBOOK_SNAPSHOT_ADAPTER_THEN_BIND_TO_PAPER_EXECUTION_REALISM_V2",

        ifKisOrderbookExists:
          "REUSE_EXISTING_KIS_ORDERBOOK_SOURCE_AND_BIND_REAL_BID_ASK_TO_REALISM_V2",

        ifAlreadyBound:
          "VERIFY_RUNTIME_QUOTE_POPULATION_AND_SPREAD_USAGE_BEFORE_CHANGING_CODE",
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
        failed.length ===
          0
          ? "SELECT_ORDERBOOK_ADAPTER_OR_BINDING_IMPLEMENTATION_PATH"
          : "REPAIR_FOCUSED_BINDING_PROBE",
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
