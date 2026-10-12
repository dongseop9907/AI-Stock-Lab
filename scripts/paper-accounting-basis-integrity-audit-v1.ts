import fs from "node:fs";
import path from "node:path";

const ROOT =
  process.cwd();

const SEARCH_ROOTS = [
  "lib",
  "app",
  "supabase/migrations",
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

    if (entry.isDirectory()) {
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
        ...walk(abs),
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

function context(
  text: string,
  patterns: RegExp[],
  radius = 12,
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
    i < lines.length;
    i++
  ) {
    if (
      !patterns.some(
        pattern =>
          pattern.test(
            lines[i],
          ),
      )
    ) {
      continue;
    }

    const start =
      Math.max(
        0,
        i - radius,
      );

    const end =
      Math.min(
        lines.length - 1,
        i + radius,
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
  SEARCH_ROOTS.flatMap(
    root =>
      walk(
        path.join(
          ROOT,
          root,
        ),
      ),
  );

const rows =
  files.map(
    abs => {
      const text =
        fs.readFileSync(
          abs,
          "utf8",
        );

      return {
        file:
          rel(abs),

        text,

        buyExecutionHits:
          context(
            text,
            [
              /execute_paper_buy_order_with_execution_price_v[234]/i,
              /p_execution_price/i,
              /average_entry_price/i,
              /average_price/i,
              /v_new_average_price/i,
            ],
          ),

        sellExecutionHits:
          context(
            text,
            [
              /execute_paper_protective_sell_v[23]/i,
              /p_exit_price/i,
              /realized_pnl/i,
              /gross_pnl/i,
              /net_pnl/i,
            ],
          ),

        costHits:
          context(
            text,
            [
              /broker_fee/i,
              /sell_tax/i,
              /transaction_cost/i,
              /slippage/i,
              /cost_attribution/i,
            ],
          ),
      };
    },
  );

const buyCandidates =
  rows.filter(
    row =>
      row.buyExecutionHits.length >
      0,
  );

const sellCandidates =
  rows.filter(
    row =>
      row.sellExecutionHits.length >
      0,
  );

const costCandidates =
  rows.filter(
    row =>
      row.costHits.length >
      0,
  );

function hasAny(
  text: string,
  patterns: RegExp[],
) {
  return patterns.some(
    pattern =>
      pattern.test(
        text,
      ),
  );
}

const production =
  rows.filter(
    row =>
      row.file.startsWith(
        "lib/",
      ) ||
      row.file.startsWith(
        "app/",
      ),
  );

const migrations =
  rows.filter(
    row =>
      row.file.startsWith(
        "supabase/migrations/",
      ),
  );

const activeBuySql =
  migrations
    .filter(
      row =>
        row.text.includes(
          "execute_paper_buy_order_with_execution_price_v2",
        ),
    )
    .sort(
      (
        a,
        b,
      ) =>
        a.file.localeCompare(
          b.file,
        ),
    )
    .at(-1) ??
  null;

const activeSellSql =
  migrations
    .filter(
      row =>
        row.text.includes(
          "execute_paper_protective_sell_v2",
        ),
    )
    .sort(
      (
        a,
        b,
      ) =>
        a.file.localeCompare(
          b.file,
        ),
    )
    .at(-1) ??
  null;

const buySqlText =
  activeBuySql?.text ??
  "";

const sellSqlText =
  activeSellSql?.text ??
  "";

const buyChecks = {
  buyV2Found:
    activeBuySql !==
    null,

  executionPriceUsedForPositionCostBasis:
    hasAny(
      buySqlText,
      [
        /v_new_average_price[\s\S]{0,1200}p_execution_price/i,
        /average_entry_price[\s\S]{0,800}p_execution_price/i,
        /average_price[\s\S]{0,800}p_execution_price/i,
      ],
    ),

  plannedEntryPriceNotUsedAsNewPositionAverage:
    !hasAny(
      buySqlText,
      [
        /v_new_average_price\s*:=\s*entry_price/i,
        /average_entry_price\s*=\s*entry_price/i,
        /average_price\s*=\s*entry_price/i,
      ],
    ),

  brokerFeeIncludedInBuyExecutionSurface:
    /p_broker_fee/i.test(
      buySqlText,
    ),

  partialFillAccountingPresent:
    /v_prior_filled_quantity/i.test(
      buySqlText,
    ) &&
    /v_effective_fill_quantity/i.test(
      buySqlText,
    ),
};

const sellChecks = {
  sellV2Found:
    activeSellSql !==
    null,

  exitPriceUsedInRealizedPnl:
    hasAny(
      sellSqlText,
      [
        /realized_pnl[\s\S]{0,1400}p_exit_price/i,
        /p_exit_price[\s\S]{0,1400}realized_pnl/i,
        /gross_pnl[\s\S]{0,1400}p_exit_price/i,
      ],
    ),

  positionCostBasisUsedInRealizedPnl:
    hasAny(
      sellSqlText,
      [
        /average_entry_price[\s\S]{0,1800}realized_pnl/i,
        /realized_pnl[\s\S]{0,1800}average_entry_price/i,
        /entry_price[\s\S]{0,1800}realized_pnl/i,
      ],
    ),

  brokerFeeSurfacePresent:
    /p_broker_fee/i.test(
      sellSqlText,
    ),

  sellTaxSurfacePresent:
    /p_sell_tax/i.test(
      sellSqlText,
    ),

  protectiveFillLedgerPresent:
    /paper_protective_execution_fills_v2/i.test(
      sellSqlText,
    ),
};

const downstreamSuspicious: Array<{
  file: string;
  reason: string;
  hits: unknown;
}> = [];

for (const row of production) {
  const text =
    row.text;

  const suspiciousPatterns = [
    {
      reason:
        "PLANNED_ENTRY_PRICE_USED_AS_REALIZED_COST_BASIS",

      regex:
        /realizedPnl[\s\S]{0,500}entryPrice|realized_pnl[\s\S]{0,500}entry_price/i,
    },

    {
      reason:
        "EXIT_PNL_IGNORES_FEES_OR_TAX_REVIEW",

      regex:
        /realizedPnl[\s\S]{0,600}(?:exitPrice|sellPrice)[\s\S]{0,600}(?:entryPrice|averageEntryPrice)/i,
    },

    {
      reason:
        "ORDER_FILLED_PRICE_USED_AS_POSITION_COST_BASIS_REVIEW",

      regex:
        /filledPrice[\s\S]{0,500}(?:position|averageEntryPrice|costBasis)/i,
    },
  ];

  for (const pattern of suspiciousPatterns) {
    if (
      pattern.regex.test(
        text,
      )
    ) {
      downstreamSuspicious.push({
        file:
          row.file,

        reason:
          pattern.reason,

        hits:
          context(
            text,
            [
              /realizedPnl/i,
              /realized_pnl/i,
              /filledPrice/i,
              /averageEntryPrice/i,
              /entryPrice/i,
            ],
            16,
          ).slice(
            0,
            12,
          ),
      });

      break;
    }
  }
}

const costAttributionFiles =
  costCandidates
    .map(
      row =>
        row.file,
    )
    .filter(
      file =>
        /cost|execution|trade|paper/i.test(
          file,
        ),
    );

const checks = {
  sourceFilesScanned:
    files.length >
    0,

  buyExecutionChainFound:
    buyChecks.buyV2Found,

  sellExecutionChainFound:
    sellChecks.sellV2Found,

  buyExecutionPriceFeedsCostBasis:
    buyChecks.executionPriceUsedForPositionCostBasis,

  buyPlannedPriceNotUsedAsAverage:
    buyChecks.plannedEntryPriceNotUsedAsNewPositionAverage,

  sellExitPriceFeedsPnl:
    sellChecks.exitPriceUsedInRealizedPnl,

  sellCostBasisFeedsPnl:
    sellChecks.positionCostBasisUsedInRealizedPnl,

  buyFeeSurfacePresent:
    buyChecks.brokerFeeIncludedInBuyExecutionSurface,

  sellFeeSurfacePresent:
    sellChecks.brokerFeeSurfacePresent,

  sellTaxSurfacePresent:
    sellChecks.sellTaxSurfacePresent,

  noObviousProductionSemanticConflict:
    downstreamSuspicious.length ===
    0,

  noWrites:
    true,

  noRealTrading:
    true,
};

const requiredKeys = [
  "sourceFilesScanned",
  "buyExecutionChainFound",
  "sellExecutionChainFound",
  "buyExecutionPriceFeedsCostBasis",
  "buyPlannedPriceNotUsedAsAverage",
  "sellExitPriceFeedsPnl",
  "sellCostBasisFeedsPnl",
  "buyFeeSurfacePresent",
  "sellFeeSurfacePresent",
  "sellTaxSurfacePresent",
  "noWrites",
  "noRealTrading",
] as const;

const failed =
  requiredKeys.filter(
    key =>
      checks[key] !==
      true,
  );

let classification:
  string;

if (
  failed.length >
  0
) {
  classification =
    "ACCOUNTING_CHAIN_SOURCE_GAP_OR_INCONCLUSIVE";
}
else if (
  downstreamSuspicious.length >
  0
) {
  classification =
    "ACCOUNTING_CHAIN_STRUCTURALLY_PRESENT_DOWNSTREAM_REVIEW_REQUIRED";
}
else {
  classification =
    "EXECUTION_PRICE_TO_COST_BASIS_TO_REALIZED_PNL_CHAIN_STRUCTURALLY_CONSISTENT";
}

console.log(
  JSON.stringify(
    {
      status:
        failed.length ===
          0
          ? "AI_STOCK_LAB_PAPER_ACCOUNTING_BASIS_INTEGRITY_AUDIT_V1_PASS"
          : "AI_STOCK_LAB_PAPER_ACCOUNTING_BASIS_INTEGRITY_AUDIT_V1_FAIL",

      classification,

      counts: {
        sourceFilesScanned:
          files.length,

        buyCandidateFiles:
          buyCandidates.length,

        sellCandidateFiles:
          sellCandidates.length,

        costCandidateFiles:
          costCandidates.length,

        downstreamSuspicious:
          downstreamSuspicious.length,
      },

      activeSources: {
        buyV2Migration:
          activeBuySql?.file ??
          null,

        sellV2Migration:
          activeSellSql?.file ??
          null,
      },

      buyChecks,
      sellChecks,

      downstreamSuspicious:
        downstreamSuspicious.slice(
          0,
          30,
        ),

      costAttributionFiles:
        costAttributionFiles.slice(
          0,
          80,
        ),

      sourceEvidence: {
        buy:
          activeBuySql
            ? {
                file:
                  activeBuySql.file,

                hits:
                  activeBuySql.buyExecutionHits.slice(
                    0,
                    20,
                  ),
              }
            : null,

        sell:
          activeSellSql
            ? {
                file:
                  activeSellSql.file,

                hits:
                  [
                    ...activeSellSql.sellExecutionHits,
                    ...activeSellSql.costHits,
                  ].slice(
                    0,
                    30,
                  ),
              }
            : null,
      },

      interpretation:
        classification ===
          "EXECUTION_PRICE_TO_COST_BASIS_TO_REALIZED_PNL_CHAIN_STRUCTURALLY_CONSISTENT"
          ? "BUY simulated execution price feeds position cost basis, protective SELL exit price and position basis feed realized PnL, and fee/tax surfaces are present. No obvious production semantic conflict was found."
          : classification ===
              "ACCOUNTING_CHAIN_STRUCTURALLY_PRESENT_DOWNSTREAM_REVIEW_REQUIRED"
            ? "The canonical accounting chain was found, but one or more production consumers need focused semantic review."
            : "At least one canonical accounting link could not be proven from source. Review exact source evidence before modifying production code.",

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
        failed.length >
          0
          ? "REVIEW_ACCOUNTING_CHAIN_SOURCE_GAP"
          : downstreamSuspicious.length >
              0
            ? "FOCUSED_REVIEW_DOWNSTREAM_ACCOUNTING_CONSUMERS"
            : "CLOSE_EXECUTION_ACCOUNTING_CHAIN_AND_MOVE_TO_NEXT_DEVELOPMENT_GAP",
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
