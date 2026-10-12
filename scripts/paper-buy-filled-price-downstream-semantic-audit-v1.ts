import fs from "node:fs";
import path from "node:path";

const ROOT =
  process.cwd();

const TARGET_DIRS = [
  "app",
  "lib",
  "scripts",
];

const EXTENSIONS =
  new Set([
    ".ts",
    ".tsx",
    ".js",
    ".cjs",
    ".mjs",
    ".sql",
  ]);

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
          "coverage",
          "backups",
        ].includes(
          entry.name,
        )
      ) {
        continue;
      }

      out.push(
        ...walk(
          abs,
        ),
      );

      continue;
    }

    if (
      entry.isFile() &&
      EXTENSIONS.has(
        path.extname(
          entry.name,
        ),
      )
    ) {
      out.push(
        abs,
      );
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

function extractHits(
  text: string,
  terms: RegExp[],
  radius = 4,
) {
  const lines =
    text.split(
      /\r?\n/,
    );

  const hits: Array<{
    line: number;
    text: string;
    context: Array<{
      line: number;
      text: string;
    }>;
  }> = [];

  for (
    let i = 0;
    i <
      lines.length;
    i++
  ) {
    if (
      !terms.some(
        term =>
          term.test(
            lines[i],
          ),
      )
    ) {
      continue;
    }

    const start =
      Math.max(
        0,
        i -
          radius,
      );

    const end =
      Math.min(
        lines.length -
          1,
        i +
          radius,
      );

    hits.push({
      line:
        i + 1,

      text:
        lines[i],

      context:
        lines
          .slice(
            start,
            end + 1,
          )
          .map(
            (
              line,
              offset,
            ) => ({
              line:
                start +
                offset +
                1,

              text:
                line,
            }),
          ),
    });
  }

  return hits;
}

const files =
  TARGET_DIRS.flatMap(
    dir =>
      walk(
        path.join(
          ROOT,
          dir,
        ),
      ),
  );

const references: Array<{
  file: string;
  filledPriceHits: ReturnType<
    typeof extractHits
  >;
  entryPriceHits: ReturnType<
    typeof extractHits
  >;
  realizedPnlHits: ReturnType<
    typeof extractHits
  >;
}> = [];

for (const abs of files) {
  const text =
    fs.readFileSync(
      abs,
      "utf8",
    );

  const filledPriceHits =
    extractHits(
      text,
      [
        /\bfilled_price\b/i,
        /\bfilledPrice\b/,
      ],
    );

  const entryPriceHits =
    extractHits(
      text,
      [
        /\bentry_price\b/i,
        /\bentryPrice\b/,
      ],
    );

  const realizedPnlHits =
    extractHits(
      text,
      [
        /\brealized_pnl\b/i,
        /\brealizedPnl\b/,
      ],
    );

  if (
    filledPriceHits.length >
      0
  ) {
    references.push({
      file:
        rel(
          abs,
        ),

      filledPriceHits,
      entryPriceHits,
      realizedPnlHits,
    });
  }
}

const suspicious: Array<{
  file: string;
  line: number;
  text: string;
  reason: string;
  context: unknown;
}> = [];

for (const row of references) {
  for (
    const hit of
      row.filledPriceHits
  ) {
    const joined =
      hit.context
        .map(
          x =>
            x.text,
        )
        .join(
          "\n",
        );

    const patterns = [
      {
        regex:
          /filled_(?:price)|filledPrice[\s\S]{0,180}entry_(?:price)|entryPrice[\s\S]{0,180}filled_(?:price)|filledPrice/i,

        reason:
          "FILLED_AND_ENTRY_PRICE_COUPLED_NEARBY",
      },

      {
        regex:
          /filled_(?:price)\s*=\s*entry_(?:price)|filledPrice\s*[:=]\s*entryPrice/i,

        reason:
          "FILLED_PRICE_DIRECTLY_ASSIGNED_FROM_ENTRY_PRICE",
      },

      {
        regex:
          /coalesce\s*\(\s*filled_(?:price)\s*,\s*entry_(?:price)\s*\)/i,

        reason:
          "FILLED_PRICE_FALLS_BACK_TO_ENTRY_PRICE",
      },

      {
        regex:
          /entry_(?:price)\s*\?\?\s*filled_(?:price)|entryPrice\s*\?\?\s*filledPrice/i,

        reason:
          "ENTRY_PRICE_PREFERRED_OVER_FILLED_PRICE",
      },

      {
        regex:
          /filled_(?:price)\s*\?\?\s*entry_(?:price)|filledPrice\s*\?\?\s*entryPrice/i,

        reason:
          "FILLED_PRICE_FALLBACK_TO_ENTRY_PRICE_REVIEW",
      },
    ];

    for (const pattern of patterns) {
      if (
        pattern.regex.test(
          joined,
        )
      ) {
        suspicious.push({
          file:
            row.file,

          line:
            hit.line,

          text:
            hit.text,

          reason:
            pattern.reason,

          context:
            hit.context,
        });

        break;
      }
    }
  }
}

const productionSuspicious =
  suspicious.filter(
    row =>
      row.file.startsWith(
        "lib/",
      ) ||
      row.file.startsWith(
        "app/",
      ),
  );

const scriptSuspicious =
  suspicious.filter(
    row =>
      row.file.startsWith(
        "scripts/",
      ),
  );

const filledPriceFiles =
  references.map(
    row =>
      row.file,
  );

const classification =
  productionSuspicious.length ===
    0
    ? "NO_PRODUCTION_FILLED_PRICE_ENTRY_PRICE_COUPLING_FOUND"
    : "PRODUCTION_FILLED_PRICE_SEMANTIC_REVIEW_REQUIRED";

const checks = {
  sourceFilesScanned:
    files.length >
    0,

  filledPriceReferencesFound:
    references.length >
    0,

  noProductionCoupling:
    productionSuspicious.length ===
    0,

  noWrites:
    true,

  noRealTrading:
    true,
};

const failed =
  Object.entries(
    checks,
  )
    .filter(
      (
        [key, ok],
      ) =>
        [
          "sourceFilesScanned",
          "noWrites",
          "noRealTrading",
        ].includes(
          key,
        ) &&
        ok !==
          true,
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
          ? "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_DOWNSTREAM_SEMANTIC_AUDIT_V1_PASS"
          : "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_DOWNSTREAM_SEMANTIC_AUDIT_V1_FAIL",

      classification,

      counts: {
        sourceFilesScanned:
          files.length,

        filesWithFilledPriceReferences:
          references.length,

        productionSuspicious:
          productionSuspicious.length,

        scriptSuspicious:
          scriptSuspicious.length,
      },

      filledPriceFiles,

      productionSuspicious:
        productionSuspicious.slice(
          0,
          50,
        ),

      scriptSuspicious:
        scriptSuspicious.slice(
          0,
          50,
        ),

      referenceSummary:
        references.map(
          row => ({
            file:
              row.file,

            filledPriceHitCount:
              row.filledPriceHits.length,

            entryPriceHitCount:
              row.entryPriceHits.length,

            realizedPnlHitCount:
              row.realizedPnlHits.length,
          }),
        ),

      interpretation:
        productionSuspicious.length ===
          0
          ? "No obvious production code still couples filled_price to planned entry_price. The V4 semantic change appears isolated."
          : "At least one production code path references filled_price and entry_price closely enough to require exact review before closing downstream semantics.",

      safety: {
        sourceOnly:
          true,

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
        productionSuspicious.length ===
          0
          ? "CLOSE_BUY_FILLED_PRICE_SEMANTIC_V1_AND_MOVE_TO_NEXT_DEVELOPMENT_GAP"
          : "REVIEW_PRODUCTION_FILLED_PRICE_CONSUMERS",
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
