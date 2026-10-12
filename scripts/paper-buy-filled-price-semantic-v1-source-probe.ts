import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const MIGRATION_HINT =
  "execute_paper_buy_order_with_execution_price_v2";

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
      /\.(sql|ts|tsx|js|cjs|mjs)$/.test(
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

function contexts(
  text: string,
  patterns: RegExp[],
  radius = 28,
) {
  const lines =
    text.split(/\r?\n/);

  const hits =
    lines
      .map(
        (
          line,
          index,
        ) =>
          patterns.some(
            pattern =>
              pattern.test(
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

  for (const index of hits) {
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

const files =
  walk(
    path.join(
      ROOT,
      "supabase",
      "migrations",
    ),
  );

const v2Rows =
  files
    .map(
      abs => {
        const text =
          fs.readFileSync(
            abs,
            "utf8",
          );

        if (
          !text.includes(
            MIGRATION_HINT,
          )
        ) {
          return null;
        }

        const createIndex =
          text.indexOf(
            `create or replace function public.${MIGRATION_HINT}`,
          );

        if (
          createIndex <
          0
        ) {
          return null;
        }

        return {
          file:
            rel(abs),

          text,

          createIndex,
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
    )
    .sort(
      (
        left,
        right,
      ) =>
        left.file.localeCompare(
          right.file,
        ),
    );

const active =
  v2Rows.at(-1) ??
  null;

if (!active) {
  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_SOURCE_PROBE_FAIL",

        reason:
          "BUY_V2_RPC_MIGRATION_NOT_FOUND",

        safety: {
          sourceOnly:
            true,
          databaseReads:
            0,
          databaseWrites:
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
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
}
else {
  const text =
    active.text;

  const hasEntryPriceWrite =
    /filled_price\s*=\s*entry_price/i.test(
      text,
    );

  const hasExecutionPriceWrite =
    /filled_price\s*=\s*p_execution_price/i.test(
      text,
    );

  const returnUsesExecutionPrice =
    /'filledPrice'\s*,\s*p_execution_price/i.test(
      text,
    );

  const supportsPartialFill =
    /v_prior_filled_quantity/i.test(
      text,
    ) &&
    /v_effective_fill_quantity/i.test(
      text,
    ) &&
    /v_is_final_fill/i.test(
      text,
    );

  const accumulatesFilledQuantity =
    /filled_quantity\s*=\s*v_prior_filled_quantity\s*\+\s*v_effective_fill_quantity/i.test(
      text,
    );

  const positionAverageUsesExecutionPrice =
    /v_new_average_price[\s\S]{0,900}p_execution_price/i.test(
      text,
    );

  const existingFilledPriceReferencedBeforeUpdate =
    /v_order\.filled_price/i.test(
      text,
    ) ||
    /filled_price[\s\S]{0,120}v_prior/i.test(
      text,
    );

  const hasPerBuyFillTable =
    files.some(
      abs => {
        const sql =
          fs.readFileSync(
            abs,
            "utf8",
          );

        return (
          /create table[\s\S]{0,150}paper.*(?:buy|execution).*fill/i.test(
            sql,
          ) ||
          /paper_buy_execution_fill/i.test(
            sql,
          )
        );
      },
    );

  const v3Files =
    files
      .map(
        abs => {
          const sql =
            fs.readFileSync(
              abs,
              "utf8",
            );

          if (
            !sql.includes(
              "execute_paper_buy_order_with_execution_price_v3",
            )
          ) {
            return null;
          }

          return {
            file:
              rel(abs),

            delegatesV2:
              sql.includes(
                "execute_paper_buy_order_with_execution_price_v2",
              ),

            overwritesFilledPrice:
              /filled_price\s*=/i.test(
                sql,
              ),

            contexts:
              contexts(
                sql,
                [
                  /execute_paper_buy_order_with_execution_price_v3/,
                  /execute_paper_buy_order_with_execution_price_v2/,
                  /filled_price/,
                ],
                20,
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

  const v3DelegatesBuggyV2 =
    v3Files.some(
      row =>
        row.delegatesV2 &&
        !row.overwritesFilledPrice,
    );

  let semanticRecommendation:
    string;

  if (
    supportsPartialFill &&
    accumulatesFilledQuantity
  ) {
    if (
      existingFilledPriceReferencedBeforeUpdate
    ) {
      semanticRecommendation =
        "WEIGHTED_CUMULATIVE_FILL_PRICE_FROM_PRIOR_FILLED_PRICE_AND_NEW_EXECUTION_PRICE";
    }
    else if (
      hasPerBuyFillTable
    ) {
      semanticRecommendation =
        "RECOMPUTE_WEIGHTED_CUMULATIVE_FILL_PRICE_FROM_CANONICAL_BUY_FILL_LEDGER";
    }
    else {
      semanticRecommendation =
        "ADD_OR_DERIVE_SAFE_CUMULATIVE_FILL_PRICE_STATE_BEFORE_PATCHING";
    }
  }
  else {
    semanticRecommendation =
      "SINGLE_FILL_EXECUTION_PRICE_IS_SUFFICIENT";
  }

  const bugConfirmed =
    hasEntryPriceWrite &&
    returnUsesExecutionPrice;

  const checks = {
    v2MigrationFound:
      true,

    filledPriceDbUsesEntryPrice:
      hasEntryPriceWrite,

    rpcReturnUsesExecutionPrice:
      returnUsesExecutionPrice,

    mismatchConfirmed:
      bugConfirmed,

    partialFillSemanticsDetected:
      supportsPartialFill,

    sourceOnly:
      true,
  };

  const failed =
    [
      "v2MigrationFound",
      "filledPriceDbUsesEntryPrice",
      "rpcReturnUsesExecutionPrice",
      "mismatchConfirmed",
      "sourceOnly",
    ].filter(
      key =>
        checks[
          key as keyof typeof checks
        ] !==
        true,
    );

  console.log(
    JSON.stringify(
      {
        status:
          failed.length ===
            0
            ? "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_SOURCE_PROBE_PASS"
            : "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_SOURCE_PROBE_FAIL",

        classification:
          bugConfirmed
            ? "BUY_V2_FILLED_PRICE_DB_RETURN_MISMATCH_CONFIRMED"
            : "BUY_V2_FILLED_PRICE_MISMATCH_NOT_CONFIRMED",

        activeV2Migration: {
          file:
            active.file,

          hasEntryPriceWrite,
          hasExecutionPriceWrite,
          returnUsesExecutionPrice,

          supportsPartialFill,
          accumulatesFilledQuantity,

          positionAverageUsesExecutionPrice,
          existingFilledPriceReferencedBeforeUpdate,
          hasPerBuyFillTable,

          contexts:
            contexts(
              text,
              [
                /filled_price\s*=/i,
                /'filledPrice'/i,
                /v_prior_filled_quantity/i,
                /v_effective_fill_quantity/i,
                /v_new_average_price/i,
              ],
              35,
            ),
        },

        v3: {
          wrappers:
            v3Files,

          delegatesBuggyV2:
            v3DelegatesBuggyV2,
        },

        semanticRecommendation,

        interpretation: {
          issue:
            "paper_order_requests.filled_price is persisted from entry_price while the RPC reports p_execution_price.",

          whyItMatters:
            "Persisted execution analytics can disagree with the actual simulated fill price and with the RPC result.",

          partialFillCaution:
            "Because V2 supports partial fills, blindly assigning the latest p_execution_price may be semantically wrong for a cumulative filled_price field.",

          nextStep:
            "Use this probe output to design a minimal DB repair migration that preserves V2/V3 behavior and correct cumulative fill-price semantics.",
        },

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
          failed.length ===
            0
            ? "DESIGN_BUY_FILLED_PRICE_SEMANTIC_REPAIR"
            : "REVIEW_BUY_FILLED_PRICE_PROBE",
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
}
