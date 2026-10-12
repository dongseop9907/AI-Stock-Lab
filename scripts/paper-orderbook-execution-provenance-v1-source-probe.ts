import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const SEARCH_ROOTS = [
  "lib",
  "app",
  "supabase/migrations",
] as const;

const KEY_PATTERNS = [
  /execution_risk_snapshot/i,
  /priceSource/,
  /price_source/i,
  /quoteAgeMs/,
  /quote_age/i,
  /bestAsk/i,
  /bestBid/i,
  /topOfBook/i,
  /marketImpactBps/,
  /market_impact/i,
  /syntheticSpreadBps/,
  /synthetic_spread/i,
  /serverQuoteAgeMs/,
  /server_quote_age/i,
  /orderbookQuote/,
  /KIS_DOMESTIC_ORDERBOOK_REST/,
  /execute_paper_buy_order_with_execution_price_v2/i,
] as const;

function walk(dir: string): string[] {
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

function scan(abs: string) {
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
      const matched =
        KEY_PATTERNS
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
        hits.push({
          line:
            index + 1,
          text:
            line.trim(),
          matched,
        });
      }
    },
  );

  return {
    file:
      rel(abs),
    text,
    hitCount:
      hits.length,
    hits:
      hits.slice(
        0,
        160,
      ),
  };
}

const files =
  SEARCH_ROOTS.flatMap(
    root =>
      walk(
        path.join(
          ROOT,
          root,
        ),
      ),
  );

const scanned =
  files
    .map(scan)
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
    );

const executionFile =
  scanned.find(
    row =>
      row.file ===
      "lib/trading/execute-paper-order.ts",
  );

const realismFile =
  scanned.find(
    row =>
      row.file ===
      "lib/trading/paper-execution-realism-v2.ts",
  );

const migrations =
  scanned.filter(
    row =>
      row.file.startsWith(
        "supabase/migrations/",
      ),
  );

const reporting =
  scanned.filter(
    row =>
      /dashboard|report|history|evaluate/i.test(
        row.file,
      ),
  );

const successRpcArgs =
  executionFile
    ? executionFile.hits.filter(
        hit =>
          /p_execution_|p_fill_|p_broker_fee|execute_paper_buy_order_with_execution_price_v2/i.test(
            hit.text,
          ),
      )
    : [];

const hasSuccessRiskSnapshotWrite =
  executionFile
    ? /execution_risk_snapshot/.test(
        executionFile.text,
      ) &&
      /realismDecision|orderbookQuote/.test(
        executionFile.text,
      )
    : false;

const hasPriceSourcePersistence =
  scanned.some(
    row =>
      /execution_price_source|price_source/.test(
        row.text,
      ) &&
      /BEST_ASK|BEST_BID|priceSource/.test(
        row.text,
      ),
  );

const hasQuoteAgePersistence =
  scanned.some(
    row =>
      /quote_age|quoteAgeMs|server_quote_age|serverQuoteAgeMs/.test(
        row.text,
      ) &&
      /insert|update|rpc|snapshot|jsonb|risk/i.test(
        row.text,
      ),
  );

const hasMarketImpactPersistence =
  scanned.some(
    row =>
      /market_impact|marketImpactBps/.test(
        row.text,
      ) &&
      /insert|update|rpc|snapshot|jsonb|risk/i.test(
        row.text,
      ),
  );

const hasTopOfBookPersistence =
  scanned.some(
    row =>
      /top_of_book|topOfBook|bestAsk|bestBid/.test(
        row.text,
      ) &&
      /insert|update|rpc|snapshot|jsonb|risk/i.test(
        row.text,
      ),
  );

const classification =
  hasSuccessRiskSnapshotWrite &&
  hasPriceSourcePersistence &&
  hasQuoteAgePersistence &&
  hasMarketImpactPersistence &&
  hasTopOfBookPersistence
    ? "ORDERBOOK_EXECUTION_PROVENANCE_ALREADY_PERSISTED_REVIEW_REPORTING"
    : (
        !hasSuccessRiskSnapshotWrite &&
        !hasPriceSourcePersistence &&
        !hasQuoteAgePersistence &&
        !hasMarketImpactPersistence &&
        !hasTopOfBookPersistence
      )
      ? "ORDERBOOK_EXECUTION_USED_FOR_FILL_BUT_PROVENANCE_NOT_PERSISTED"
      : "PARTIAL_ORDERBOOK_EXECUTION_PROVENANCE_PERSISTENCE";

const checks = {
  sourceScanCompleted:
    files.length >
    0,

  executionFileFound:
    Boolean(
      executionFile,
    ),

  realismFileFound:
    Boolean(
      realismFile,
    ),

  migrationScanCompleted:
    fs.existsSync(
      path.join(
        ROOT,
        "supabase",
        "migrations",
      ),
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
          ? "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_SOURCE_PROBE_PASS"
          : "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_SOURCE_PROBE_FAIL",

      classification,

      currentPersistence: {
        hasSuccessRiskSnapshotWrite,
        hasPriceSourcePersistence,
        hasQuoteAgePersistence,
        hasMarketImpactPersistence,
        hasTopOfBookPersistence,
      },

      successRpcSurface: {
        args:
          successRpcArgs,
      },

      executionHits:
        executionFile?.hits ??
        [],

      migrationHits:
        migrations.map(
          row => ({
            file:
              row.file,
            hitCount:
              row.hitCount,
            hits:
              row.hits,
          }),
        ),

      reportingHits:
        reporting.map(
          row => ({
            file:
              row.file,
            hitCount:
              row.hitCount,
            hits:
              row.hits,
          }),
        ),

      interpretation: {
        target:
          "A successful PAPER fill should preserve enough execution provenance to explain why the simulated fill price was produced.",

        desiredEvidence: [
          "priceSource BEST_ASK/BEST_BID or synthetic fallback",
          "quoteAgeMs/serverQuoteAgeMs",
          "best bid/ask and top-of-book quantity cap",
          "marketImpactBps",
          "syntheticSpreadBps",
          "fill quantity",
          "transaction costs",
          "orderbook source/freshness metadata"
        ],

        nextIfMissing:
          "Persist execution realism/orderbook provenance on successful PAPER fills without changing trade decisions.",

        nextIfAlreadyPresent:
          "Verify dashboards/evaluation expose the persisted provenance read-only.",
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
        failed.length ===
          0
          ? "DESIGN_SUCCESSFUL_PAPER_EXECUTION_PROVENANCE_BINDING"
          : "REPAIR_PROVENANCE_SOURCE_PROBE",
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
