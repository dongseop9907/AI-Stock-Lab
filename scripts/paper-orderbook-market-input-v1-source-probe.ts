import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const TARGETS = [
  "lib/trading/resolve-paper-execution-realism-v2-market-input.ts",
  "lib/market/sync-snapshots.ts",
  "lib/market/latest-snapshots.ts",
  "lib/kis/client.ts",
] as const;

const MIGRATION_DIR =
  path.join(
    ROOT,
    "supabase",
    "migrations",
  );

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

function windows(
  lines: string[],
  patterns: RegExp[],
  radius = 28,
) {
  const indexes:
    number[] = [];

  lines.forEach(
    (
      line,
      index,
    ) => {
      if (
        patterns.some(
          pattern =>
            pattern.test(
              line,
            ),
        )
      ) {
        indexes.push(
          index,
        );
      }
    },
  );

  const raw =
    indexes.map(
      index => ({
        start:
          Math.max(
            0,
            index - radius,
          ),
        end:
          Math.min(
            lines.length - 1,
            index + radius,
          ),
      }),
    );

  const merged:
    Array<{
      start: number;
      end: number;
    }> = [];

  for (
    const current of raw
  ) {
    const last =
      merged.at(
        -1,
      );

    if (
      last &&
      current.start <=
        last.end + 2
    ) {
      last.end =
        Math.max(
          last.end,
          current.end,
        );
    }
    else {
      merged.push({
        ...current,
      });
    }
  }

  return merged.map(
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
              text,
              offset,
            ) => ({
              line:
                range.start +
                offset +
                1,
              text,
            }),
          ),
    }),
  );
}

const helper =
  read(
    TARGETS[0],
  );

const syncSnapshots =
  read(
    TARGETS[1],
  );

const latestSnapshots =
  read(
    TARGETS[2],
  );

const kisClient =
  read(
    TARGETS[3],
  );

const helperWindows =
  windows(
    helper.lines,
    [
      /export interface/i,
      /return\s*\{/,
      /intervalVolume/,
      /source/,
      /market_snapshots/,
      /market_/,
      /raw_payload/,
      /volume/i,
      /quote/i,
      /bestBid/i,
      /bestAsk/i,
    ],
    32,
  );

const syncSnapshotWindows =
  windows(
    syncSnapshots.lines,
    [
      /market_snapshots/,
      /raw_payload/,
      /close_price/,
      /volume/i,
      /output/i,
      /KIS_DOMESTIC_PRICE/,
      /insert\(/,
      /upsert\(/,
    ],
    30,
  );

const latestSnapshotWindows =
  windows(
    latestSnapshots.lines,
    [
      /interface KisRawPayload/,
      /raw_payload/,
      /close_price/,
      /volume/i,
      /payload/,
    ],
    25,
  );

const kisCurrentPriceWindows =
  windows(
    kisClient.lines,
    [
      /interface KisDomesticPriceOutput/,
      /inquire-price/,
      /output1/,
      /ask/i,
      /bid/i,
      /volume/i,
      /acml_vol/i,
    ],
    26,
  );

const migrationFiles =
  fs.existsSync(
    MIGRATION_DIR,
  )
    ? fs
        .readdirSync(
          MIGRATION_DIR,
        )
        .filter(
          name =>
            name.endsWith(
              ".sql",
            ),
        )
    : [];

const marketSnapshotMigrationHits =
  migrationFiles
    .map(
      name => {
        const abs =
          path.join(
            MIGRATION_DIR,
            name,
          );

        const text =
          fs.readFileSync(
            abs,
            "utf8",
          );

        const lower =
          text.toLowerCase();

        if (
          !lower.includes(
            "market_snapshots",
          )
        ) {
          return null;
        }

        return {
          file:
            `supabase/migrations/${name}`,
          lines:
            text
              .split(/\r?\n/)
              .map(
                (
                  line,
                  index,
                ) => ({
                  line:
                    index + 1,
                  text:
                    line.trim(),
                }),
              )
              .filter(
                row =>
                  /market_snapshots|raw_payload|close_price|volume|observed_at/i.test(
                    row.text,
                  ),
              )
              .slice(
                0,
                120,
              ),
        };
      },
    )
    .filter(
      Boolean,
    );

const helperHasQuoteReturn =
  /\bquote\s*:/.test(
    helper.text,
  ) ||
  /PaperQuoteSnapshot/.test(
    helper.text,
  );

const helperHasIntervalVolume =
  /intervalVolume/.test(
    helper.text,
  );

const snapshotsHaveRawPayload =
  /raw_payload/.test(
    syncSnapshots.text,
  ) ||
  /raw_payload/.test(
    latestSnapshots.text,
  ) ||
  marketSnapshotMigrationHits.some(
    (row: any) =>
      row.lines.some(
        (item: any) =>
          /raw_payload/i.test(
            item.text,
          ),
      ),
  );

const kisCurrentPriceHasTopOfBook =
  /(bestBid|bestAsk|bidp|askp|bid_price|ask_price|매수호가|매도호가)/i.test(
    kisClient.text,
  );

const classification =
  helperHasIntervalVolume &&
  !helperHasQuoteReturn &&
  !kisCurrentPriceHasTopOfBook
    ? snapshotsHaveRawPayload
      ? "HELPER_INTERVAL_VOLUME_ONLY_AND_KIS_HAS_NO_TOP_OF_BOOK_BUT_SNAPSHOT_RAW_PAYLOAD_EXISTS"
      : "HELPER_INTERVAL_VOLUME_ONLY_AND_NO_REUSABLE_TOP_OF_BOOK_SOURCE"
    : helperHasQuoteReturn
      ? "HELPER_ALREADY_RETURNS_QUOTE_REVIEW_CALLER_BINDING"
      : kisCurrentPriceHasTopOfBook
        ? "KIS_CURRENT_PRICE_ALREADY_EXPOSES_TOP_OF_BOOK_REUSE_IT"
        : "INCONCLUSIVE";

const checks = {
  helperExists:
    helper.exists,

  syncSnapshotsExists:
    syncSnapshots.exists,

  latestSnapshotsExists:
    latestSnapshots.exists,

  kisClientExists:
    kisClient.exists,

  migrationScanCompleted:
    fs.existsSync(
      MIGRATION_DIR,
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
          ? "AI_STOCK_LAB_PAPER_ORDERBOOK_MARKET_INPUT_V1_SOURCE_PROBE_PASS"
          : "AI_STOCK_LAB_PAPER_ORDERBOOK_MARKET_INPUT_V1_SOURCE_PROBE_FAIL",

      classification,

      helper: {
        file:
          TARGETS[0],
        hasIntervalVolume:
          helperHasIntervalVolume,
        hasQuoteReturn:
          helperHasQuoteReturn,
        windows:
          helperWindows,
      },

      snapshotStorage: {
        hasRawPayload:
          snapshotsHaveRawPayload,
        syncWindows:
          syncSnapshotWindows,
        latestWindows:
          latestSnapshotWindows,
        migrationHits:
          marketSnapshotMigrationHits,
      },

      kisCurrentPrice: {
        hasTopOfBookFields:
          kisCurrentPriceHasTopOfBook,
        windows:
          kisCurrentPriceWindows,
      },

      interpretation: {
        preferredIfNoTopOfBook:
          "ADD_DEDICATED_READ_ONLY_KIS_ORDERBOOK_ADAPTER",

        preferredIfSnapshotRawContainsTopOfBook:
          "PARSE_AND_REUSE_EXISTING_MARKET_SNAPSHOT_RAW_PAYLOAD_BEFORE_ADDING_NEW_API",

        preferredIfKisPriceAlreadyHasTopOfBook:
          "REUSE_EXISTING_KIS_CURRENT_PRICE_RESPONSE_FIELDS",

        bindingTarget:
          "resolvePaperExecutionRealismV2MarketInput should return quote + intervalVolume and BUY/SELL should pass quote to evaluatePaperExecutionRealismV2",
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
          ? "IMPLEMENT_OR_REUSE_REAL_ORDERBOOK_SOURCE_AND_BIND_QUOTE"
          : "REPAIR_MARKET_INPUT_SOURCE_PROBE",
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
