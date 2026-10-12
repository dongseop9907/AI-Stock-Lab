import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const CANDIDATES = [
  "lib/trading/resolve-protective-sell-execution-realism-v2.ts",
  "lib/trading/execute-approved-paper-orders.ts",
  "lib/trading/execute-paper-order.ts",
  "lib/trading/paper-execution-realism-v2.ts",
] as const;

function read(rel: string) {
  const abs =
    path.join(
      ROOT,
      rel,
    );

  if (!fs.existsSync(abs)) {
    return {
      file:
        rel,
      exists:
        false,
      text:
        "",
      lines:
        [] as string[],
    };
  }

  const text =
    fs.readFileSync(
      abs,
      "utf8",
    );

  return {
    file:
      rel,
    exists:
      true,
    text,
    lines:
      text.split(/\r?\n/),
  };
}

function hits(
  lines: string[],
  patterns: RegExp[],
) {
  return lines
    .map(
      (
        text,
        index,
      ) => ({
        line:
          index + 1,
        text:
          text.trim(),
        matched:
          patterns
            .filter(
              pattern =>
                pattern.test(
                  text,
                ),
            )
            .map(
              pattern =>
                pattern.source,
            ),
      }),
    )
    .filter(
      row =>
        row.matched.length >
        0,
    );
}

const sources =
  CANDIDATES.map(read);

const patterns = [
  /BEST_BID/,
  /REFERENCE_MINUS_SYNTHETIC_SPREAD/,
  /marketImpactBps/,
  /syntheticSpreadBps/,
  /topOfBookQuantityCap/,
  /orderbookQuote/,
  /serverQuoteAgeMs/,
  /protectiveFallbackUsed/,
  /execution_price_source/i,
  /execution_risk_snapshot/i,
  /realized_pnl/i,
  /paper_trade/i,
  /paper_position/i,
  /sell/i,
];

const scanned =
  sources.map(
    source => ({
      file:
        source.file,
      exists:
        source.exists,
      hitCount:
        source.exists
          ? hits(
              source.lines,
              patterns,
            ).length
          : 0,
      hits:
        source.exists
          ? hits(
              source.lines,
              patterns,
            ).slice(
              0,
              220,
            )
          : [],
      text:
        source.text,
    }),
  );

const sell =
  scanned.find(
    row =>
      row.file ===
      "lib/trading/resolve-protective-sell-execution-realism-v2.ts",
  );

const realism =
  scanned.find(
    row =>
      row.file ===
      "lib/trading/paper-execution-realism-v2.ts",
  );

const sellUsesBestBid =
  Boolean(
    realism?.text.includes(
      '"BEST_BID"',
    ),
  ) &&
  Boolean(
    sell?.text.includes(
      'side: "SELL"',
    ),
  );

const sellHasOrderbook =
  Boolean(
    sell?.text.includes(
      "orderbookQuote",
    ),
  );

const sellHasMarketImpact =
  Boolean(
    sell?.text.includes(
      "marketImpactBps",
    ),
  ) ||
  Boolean(
    realism?.text.includes(
      "marketImpactBps",
    ),
  );

const sellHasSyntheticSpread =
  Boolean(
    sell?.text.includes(
      "syntheticSpreadBps",
    ),
  ) ||
  Boolean(
    realism?.text.includes(
      "syntheticSpreadBps",
    ),
  );

const sellHasTopOfBookCap =
  Boolean(
    sell?.text.includes(
      "topOfBookQuantityCap",
    ),
  ) ||
  Boolean(
    realism?.text.includes(
      "topOfBookQuantityCap",
    ),
  );

const sellHasFreshness =
  Boolean(
    sell?.text.includes(
      "freshnessBlocker",
    ),
  ) &&
  Boolean(
    sell?.text.includes(
      "serverQuoteAgeMs",
    ),
  );

const sellReturnsDecision =
  Boolean(
    sell?.text.includes(
      "decision",
    ),
  ) ||
  Boolean(
    sell?.text.includes(
      "realism",
    ),
  );

const allRepoFiles: string[] = [];

function walk(dir: string) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (
    const entry of
      fs.readdirSync(
        dir,
        {
          withFileTypes: true,
        },
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

      walk(abs);
      continue;
    }

    if (
      entry.isFile() &&
      /\.(ts|tsx|js|cjs|mjs|sql)$/.test(
        entry.name,
      )
    ) {
      allRepoFiles.push(
        abs,
      );
    }
  }
}

walk(
  path.join(
    ROOT,
    "lib",
  ),
);

walk(
  path.join(
    ROOT,
    "app",
  ),
);

walk(
  path.join(
    ROOT,
    "supabase",
    "migrations",
  ),
);

const persistenceCandidates =
  allRepoFiles
    .map(
      abs => {
        const text =
          fs.readFileSync(
            abs,
            "utf8",
          );

        const relevant =
          /SELL|sell|protective/i.test(
            text,
          ) &&
          /execution_price_source|execution_risk_snapshot|marketImpactBps|syntheticSpreadBps|serverQuoteAgeMs|BEST_BID/.test(
            text,
          );

        if (!relevant) {
          return null;
        }

        const lines =
          text.split(/\r?\n/);

        return {
          file:
            path
              .relative(
                ROOT,
                abs,
              )
              .replaceAll(
                "\\",
                "/",
              ),
          hitCount:
            hits(
              lines,
              patterns,
            ).length,
          hits:
            hits(
              lines,
              patterns,
            ).slice(
              0,
              120,
            ),
        };
      },
    )
    .filter(
      (
        row,
      ): row is {
        file: string;
        hitCount: number;
        hits: Array<{
          line: number;
          text: string;
          matched: string[];
        }>;
      } =>
        row !==
        null,
    )
    .sort(
      (
        left,
        right,
      ) =>
        right.hitCount -
        left.hitCount,
    );

const explicitSellProvenancePersistence =
  persistenceCandidates.some(
    row => {
      const joined =
        row.hits
          .map(
            hit =>
              hit.text,
          )
          .join(
            "\n",
          );

      return (
        /execution_price_source/i.test(
          joined,
        ) ||
        /execution_risk_snapshot/i.test(
          joined,
        )
      ) &&
      (
        /BEST_BID/.test(
          joined,
        ) ||
        /marketImpactBps/.test(
          joined,
        ) ||
        /serverQuoteAgeMs/.test(
          joined,
        )
      );
    },
  );

const classification =
  sellUsesBestBid &&
  sellHasOrderbook &&
  sellHasMarketImpact &&
  sellHasSyntheticSpread &&
  sellHasTopOfBookCap &&
  !explicitSellProvenancePersistence
    ? "SELL_REALISM_COMPLETE_BUT_PROVENANCE_PERSISTENCE_MISSING_OR_UNBOUND"
    : sellUsesBestBid &&
      explicitSellProvenancePersistence
      ? "SELL_PROVENANCE_PERSISTENCE_PRESENT_REVIEW_EXACT_BINDING"
      : "SELL_EXECUTION_PROVENANCE_INCONCLUSIVE";

const checks = {
  protectiveSellFileFound:
    Boolean(
      sell?.exists,
    ),

  realismFileFound:
    Boolean(
      realism?.exists,
    ),

  sellUsesBestBid,
  sellHasOrderbook,
  sellReturnsDecision,

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
          ? "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_SOURCE_PROBE_PASS"
          : "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_SOURCE_PROBE_FAIL",

      classification,

      sellRealism: {
        usesBestBid:
          sellUsesBestBid,

        hasOrderbook:
          sellHasOrderbook,

        hasMarketImpact:
          sellHasMarketImpact,

        hasSyntheticSpread:
          sellHasSyntheticSpread,

        hasTopOfBookQuantityCap:
          sellHasTopOfBookCap,

        hasFreshnessMetadata:
          sellHasFreshness,

        returnsDecision:
          sellReturnsDecision,
      },

      persistence: {
        explicitSellProvenancePersistence,
      },

      primaryFiles:
        scanned.map(
          row => ({
            file:
              row.file,
            exists:
              row.exists,
            hitCount:
              row.hitCount,
            hits:
              row.hits,
          }),
        ),

      persistenceCandidates:
        persistenceCandidates.slice(
          0,
          20,
        ),

      interpretation: {
        target:
          "Protective PAPER SELL should preserve the execution source and realism/orderbook provenance used to simulate the exit.",

        ifMissing:
          "Add SELL provenance persistence without changing protective exit decision semantics.",

        ifPresent:
          "Trace the exact persistence surface and verify it read-only before modifying production code.",
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
        ordersCreated:
          0,
        ordersExecuted:
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
          ? "DESIGN_OR_VERIFY_PROTECTIVE_SELL_EXECUTION_PROVENANCE_BINDING"
          : "REPAIR_PROTECTIVE_SELL_PROVENANCE_SOURCE_PROBE",
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
