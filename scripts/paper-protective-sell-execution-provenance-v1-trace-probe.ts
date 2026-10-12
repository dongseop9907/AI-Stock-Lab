import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const RESOLVER_FILE =
  "lib/trading/resolve-protective-sell-execution-realism-v2.ts";

const REALISM_FILE =
  "lib/trading/paper-execution-realism-v2.ts";

const SYMBOL =
  "resolveProtectiveSellExecutionRealismV2";

function walk(
  dir: string,
): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const out: string[] = [];

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

    if (entry.isDirectory()) {
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
      /\.(ts|tsx|js|cjs|mjs|sql)$/.test(
        entry.name,
      )
    ) {
      out.push(abs);
    }
  }

  return out;
}

function rel(
  abs: string,
) {
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

function readRel(
  file: string,
) {
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

function contextWindows(
  text: string,
  needles: RegExp[],
  radius = 45,
) {
  const lines =
    text.split(/\r?\n/);

  const indexes =
    lines
      .map(
        (
          line,
          index,
        ) =>
          needles.some(
            regex =>
              regex.test(
                line,
              ),
          )
            ? index
            : -1,
      )
      .filter(
        index =>
          index >= 0,
      );

  const ranges:
    Array<{
      start: number;
      end: number;
    }> = [];

  for (const index of indexes) {
    const start =
      Math.max(
        0,
        index - radius,
      );

    const end =
      Math.min(
        lines.length - 1,
        index + radius,
      );

    const last =
      ranges.at(-1);

    if (
      last &&
      start <=
        last.end + 2
    ) {
      last.end =
        Math.max(
          last.end,
          end,
        );
    }
    else {
      ranges.push({
        start,
        end,
      });
    }
  }

  return ranges.map(
    range => ({
      startLine:
        range.start + 1,

      endLine:
        range.end + 1,

      lines:
        lines
          .slice(
            range.start,
            range.end + 1,
          )
          .map(
            (
              line,
              offset,
            ) => ({
              line:
                range.start +
                offset +
                1,

              text:
                line,
            }),
          ),
    }),
  );
}

const resolverText =
  readRel(
    RESOLVER_FILE,
  );

const realismText =
  readRel(
    REALISM_FILE,
  );

const resolverExists =
  resolverText.length >
  0;

const realismExists =
  realismText.length >
  0;

/*
 * Correct BEST_BID proof:
 * - the protective resolver invokes the canonical model as side SELL
 * - it passes the normalized orderbook quote
 * - the canonical model maps SELL quote path to BEST_BID
 */
const resolverPassesSellSide =
  /evaluatePaperExecutionRealismV2\s*\(\s*\{[\s\S]*?side:\s*"SELL"/m.test(
    resolverText,
  );

const resolverPassesQuote =
  /quote:\s*orderbookQuote\.quote/m.test(
    resolverText,
  );

const canonicalModelHasBestBid =
  realismText.includes(
    '"BEST_BID"',
  );

const canonicalModelHasSellSyntheticFallback =
  realismText.includes(
    '"REFERENCE_MINUS_SYNTHETIC_SPREAD"',
  );

const canonicalModelSelectsBidForSell =
  /\?\s*quote\.bestAskPrice\s*:\s*quote\.bestBidPrice/m.test(
    realismText,
  ) ||
  /input\.side\s*===\s*"BUY"[\s\S]*?quote\.bestAskPrice[\s\S]*?:\s*quote\.bestBidPrice/m.test(
    realismText,
  );

const sellUsesBestBidByCanonicalChain =
  resolverPassesSellSide &&
  resolverPassesQuote &&
  canonicalModelHasBestBid &&
  canonicalModelSelectsBidForSell;

const resolverHasFreshnessGate =
  resolverText.includes(
    "orderbookQuote.freshnessBlocker",
  ) &&
  resolverText.includes(
    "PROTECTIVE_SELL_ORDERBOOK_FRESHNESS_BLOCKED",
  );

const resultInterfaceMatch =
  resolverText.match(
    /export interface ProtectiveSellExecutionRealismV2Result[\s\S]*?\{([\s\S]*?)\n\}/m,
  );

const resultInterfaceBody =
  resultInterfaceMatch?.[1] ??
  "";

const resultReturnsOrderbookMetadata =
  /orderbook|serverQuoteAgeMs|serverAcceptedHour|session|freshnessBlocker/i.test(
    resultInterfaceBody,
  );

const returnBlockMatch =
  resolverText.match(
    /return\s*\{([\s\S]*?)\};\s*\n\}/m,
  );

const returnBlock =
  returnBlockMatch?.[1] ??
  "";

const returnBlockHasOrderbookMetadata =
  /orderbookQuote|serverQuoteAgeMs|serverAcceptedHour|freshnessBlocker|session/i.test(
    returnBlock,
  );

const roots = [
  "lib",
  "app",
  "supabase/migrations",
];

const allFiles =
  roots.flatMap(
    root =>
      walk(
        path.join(
          ROOT,
          root,
        ),
      ),
  );

const callerRows =
  allFiles
    .map(
      abs => {
        const file =
          rel(abs);

        if (
          file ===
          RESOLVER_FILE
        ) {
          return null;
        }

        const text =
          fs.readFileSync(
            abs,
            "utf8",
          );

        if (
          !text.includes(
            SYMBOL,
          )
        ) {
          return null;
        }

        const invokes =
          new RegExp(
            `(?:await\\s+)?${SYMBOL}\\s*\\(`,
            "m",
          ).test(
            text,
          );

        const imports =
          new RegExp(
            `import[\\s\\S]{0,250}${SYMBOL}`,
            "m",
          ).test(
            text,
          );

        const dbWriteSignals = {
          update:
            /\.update\s*\(/.test(
              text,
            ),

          insert:
            /\.insert\s*\(/.test(
              text,
            ),

          rpc:
            /\.rpc\s*\(/.test(
              text,
            ),

          fromPaperPositions:
            /from\s*\(\s*["']paper_positions["']\s*\)/.test(
              text,
            ),

          fromPaperTrades:
            /from\s*\(\s*["'][^"']*paper[^"']*trade[^"']*["']\s*\)/i.test(
              text,
            ),
        };

        const provenanceSignals = {
          priceSource:
            /priceSource|execution_price_source/.test(
              text,
            ),

          marketImpact:
            /marketImpactBps/.test(
              text,
            ),

          syntheticSpread:
            /syntheticSpreadBps/.test(
              text,
            ),

          topOfBook:
            /topOfBookQuantityCap/.test(
              text,
            ),

          freshness:
            /serverQuoteAgeMs|freshnessBlocker/.test(
              text,
            ),

          fallback:
            /protectiveFallbackUsed|protectiveFallbackReason/.test(
              text,
            ),
        };

        return {
          file,
          imports,
          invokes,
          dbWriteSignals,
          provenanceSignals,
          contexts:
            contextWindows(
              text,
              [
                new RegExp(
                  SYMBOL,
                ),
                /\.update\s*\(/,
                /\.insert\s*\(/,
                /\.rpc\s*\(/,
                /execution_price_source/,
                /marketImpactBps/,
                /protectiveFallbackUsed/,
              ],
              55,
            ),
        };
      },
    )
    .filter(
      (
        row,
      ): row is NonNullable<
        typeof row
      > =>
        row !==
        null,
    );

const runtimeCallers =
  callerRows.filter(
    row =>
      row.invokes,
  );

const callerHasPersistence =
  runtimeCallers.some(
    row => {
      const writes =
        Object.values(
          row.dbWriteSignals,
        ).some(Boolean);

      const provenance =
        row.provenanceSignals.priceSource ||
        row.provenanceSignals.marketImpact ||
        row.provenanceSignals.syntheticSpread ||
        row.provenanceSignals.topOfBook ||
        row.provenanceSignals.freshness;

      return (
        writes &&
        provenance
      );
    },
  );

const migrationPersistenceRows =
  allFiles
    .filter(
      abs =>
        rel(abs).startsWith(
          "supabase/migrations/",
        ),
    )
    .map(
      abs => {
        const file =
          rel(abs);

        const text =
          fs.readFileSync(
            abs,
            "utf8",
          );

        const relevant =
          /SELL|sell|protective/i.test(
            text,
          ) &&
          /execution_price_source|execution_risk_snapshot|BEST_BID|marketImpactBps|serverQuoteAgeMs/i.test(
            text,
          );

        if (!relevant) {
          return null;
        }

        return {
          file,
          contexts:
            contextWindows(
              text,
              [
                /SELL|sell|protective/i,
                /execution_price_source/i,
                /execution_risk_snapshot/i,
                /BEST_BID/,
                /marketImpactBps/,
                /serverQuoteAgeMs/,
              ],
              38,
            ),
        };
      },
    )
    .filter(
      (
        row,
      ): row is NonNullable<
        typeof row
      > =>
        row !==
        null,
    );

const explicitSellPersistence =
  callerHasPersistence ||
  migrationPersistenceRows.length >
    0;

let classification:
  string;

if (
  !sellUsesBestBidByCanonicalChain
) {
  classification =
    "SELL_CANONICAL_BEST_BID_CHAIN_NOT_PROVEN";
}
else if (
  !resultReturnsOrderbookMetadata &&
  !returnBlockHasOrderbookMetadata &&
  !explicitSellPersistence
) {
  classification =
    "SELL_BEST_BID_REALISM_CONFIRMED_BUT_ORDERBOOK_PROVENANCE_NOT_EXPOSED_OR_PERSISTED";
}
else if (
  sellUsesBestBidByCanonicalChain &&
  explicitSellPersistence
) {
  classification =
    "SELL_BEST_BID_REALISM_AND_PERSISTENCE_SURFACE_FOUND_REVIEW_EXACT_BINDING";
}
else {
  classification =
    "SELL_BEST_BID_REALISM_CONFIRMED_PARTIAL_PROVENANCE_SURFACE";
}

const checks = {
  resolverExists,
  realismExists,
  resolverPassesSellSide,
  resolverPassesQuote,
  canonicalModelHasBestBid,
  canonicalModelSelectsBidForSell,
  sellUsesBestBidByCanonicalChain,
  resolverHasFreshnessGate,
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
          ? "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_TRACE_PROBE_PASS"
          : "AI_STOCK_LAB_PAPER_PROTECTIVE_SELL_EXECUTION_PROVENANCE_V1_TRACE_PROBE_FAIL",

      classification,

      canonicalSellChain: {
        resolverPassesSellSide,
        resolverPassesQuote,
        canonicalModelHasBestBid,
        canonicalModelHasSellSyntheticFallback,
        canonicalModelSelectsBidForSell,
        sellUsesBestBidByCanonicalChain,
      },

      freshness: {
        resolverHasFreshnessGate,

        resultInterfaceReturnsOrderbookMetadata:
          resultReturnsOrderbookMetadata,

        returnBlockHasOrderbookMetadata,
      },

      callerDiscovery: {
        referenceFiles:
          callerRows.length,

        runtimeCallers:
          runtimeCallers.length,

        callers:
          callerRows,
      },

      persistence: {
        callerHasPersistence,
        migrationPersistenceCandidateCount:
          migrationPersistenceRows.length,
        explicitSellPersistence,
        migrationCandidates:
          migrationPersistenceRows,
      },

      resolverContract: {
        resultInterfaceBody:
          resultInterfaceBody.trim(),

        returnBlock:
          returnBlock.trim(),
      },

      interpretation: {
        previousFalseNegative:
          "The V1 probe incorrectly required BEST_BID to appear literally inside the protective SELL resolver. BEST_BID selection belongs to the shared canonical Realism V2 model.",

        target:
          "Prove the full SELL chain and discover the exact caller/persistence surface before changing production code.",

        ifNoPersistence:
          "Expose orderbook provenance from the protective SELL resolver, then bind it atomically to the canonical SELL persistence path.",

        ifPersistenceFound:
          "Verify the existing persistence path before adding any new schema or write.",
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
          ? "DESIGN_PROTECTIVE_SELL_PROVENANCE_BINDING_FROM_DISCOVERED_CALLER"
          : "REPAIR_PROTECTIVE_SELL_CANONICAL_TRACE",
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
