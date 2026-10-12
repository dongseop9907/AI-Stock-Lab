const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR =
  path.join(ROOT, "supabase", "migrations");
const SCRIPT_DIR =
  path.join(ROOT, "scripts");

const FUNCTION_START =
  "create or replace function public.execute_paper_buy_order_with_execution_price_v2(";

function fail(message, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_BUY_V2_EXECUTION_RISK_VARIABLE_FIX_V1_INSTALL_FAILED",
        reason:
          message,
        ...extra,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}

function extractFunctionBlock(source) {
  const start =
    source.lastIndexOf(
      FUNCTION_START,
    );

  if (start < 0) {
    return null;
  }

  const bodyStart =
    source.indexOf(
      "as $$",
      start,
    );

  if (bodyStart < 0) {
    return null;
  }

  const end =
    source.indexOf(
      "$$;",
      bodyStart + 5,
    );

  if (end < 0) {
    return null;
  }

  return source.slice(
    start,
    end + 3,
  );
}

if (!fs.existsSync(MIG_DIR)) {
  fail(
    "MIGRATION_DIRECTORY_NOT_FOUND",
  );
}
else {
  const sqlFiles =
    fs.readdirSync(MIG_DIR)
      .filter(
        (name) =>
          name.endsWith(".sql"),
      )
      .sort();

  const definitions = [];

  for (const name of sqlFiles) {
    const full =
      path.join(
        MIG_DIR,
        name,
      );

    const source =
      fs.readFileSync(
        full,
        "utf8",
      );

    if (
      !source.includes(
        FUNCTION_START,
      )
    ) {
      continue;
    }

    const block =
      extractFunctionBlock(
        source,
      );

    if (block) {
      definitions.push({
        name,
        block,
      });
    }
  }

  if (definitions.length === 0) {
    fail(
      "LATEST_BUY_V2_DEFINITION_NOT_FOUND",
    );
  }
  else {
    const latest =
      definitions[
        definitions.length - 1
      ];

    const sourceBlock =
      latest.block;

    const badCount =
      (
        sourceBlock.match(
          /\bv_actual_trade_risk\b/g,
        ) || []
      ).length;

    const goodDecl =
      /\bv_execution_risk_amount\s+numeric\b/i
        .test(
          sourceBlock,
        );

    if (!goodDecl) {
      fail(
        "EXPECTED_V_EXECUTION_RISK_AMOUNT_DECLARATION_NOT_FOUND",
        {
          sourceMigration:
            latest.name,
        },
      );
    }
    else if (badCount < 1) {
      fail(
        "V_ACTUAL_TRADE_RISK_REFERENCE_NOT_FOUND",
        {
          sourceMigration:
            latest.name,
        },
      );
    }
    else {
      const fixedBlock =
        sourceBlock.replace(
          /\bv_actual_trade_risk\b/g,
          "v_execution_risk_amount",
        );

      const remainingBad =
        (
          fixedBlock.match(
            /\bv_actual_trade_risk\b/g,
          ) || []
        ).length;

      const migrationNames =
        sqlFiles.filter(
          (name) =>
            /^\d{14}_/.test(name),
        );

      let maxStamp =
        20261011001400;

      for (const name of migrationNames) {
        const stamp =
          Number(
            name.slice(0, 14),
          );

        if (
          Number.isFinite(stamp) &&
          stamp > maxStamp
        ) {
          maxStamp = stamp;
        }
      }

      const preferredStamp =
        Math.max(
          20261011001500,
          maxStamp + 100,
        );

      const targetBase =
        String(
          preferredStamp,
        ) +
        "_paper_buy_v2_execution_risk_variable_fix_v1.sql";

      const targetRel =
        path.join(
          "supabase",
          "migrations",
          targetBase,
        );

      const targetFull =
        path.join(
          ROOT,
          targetRel,
        );

      const migrationSql =
`-- PAPER BUY V2 execution-risk variable fix V1
-- Fixes an invalid PL/pgSQL identifier in the canonical V2 BUY executor.
-- V3 -> V2, V4 -> V3, V5 -> V4, so this preserves the full existing call chain.
-- No historical rows are rewritten.

begin;

${fixedBlock}

comment on function
  public.execute_paper_buy_order_with_execution_price_v2(
    uuid,
    numeric,
    timestamptz,
    integer,
    numeric
  )
is
  'Canonical PAPER BUY V2 executor. V1 fix: reserved-risk decrement uses declared v_execution_risk_amount instead of nonexistent v_actual_trade_risk.';

commit;
`;

      if (
        fs.existsSync(
          targetFull,
        )
      ) {
        const existing =
          fs.readFileSync(
            targetFull,
            "utf8",
          );

        if (
          existing !==
          migrationSql
        ) {
          fail(
            "TARGET_MIGRATION_ALREADY_EXISTS_WITH_DIFFERENT_CONTENT",
            {
              target:
                targetRel
                  .replace(
                    /\\/g,
                    "/",
                  ),
            },
          );
          return;
        }
      }
      else {
        fs.writeFileSync(
          targetFull,
          migrationSql,
          "utf8",
        );
      }

      fs.mkdirSync(
        SCRIPT_DIR,
        {
          recursive: true,
        },
      );

      const verifyRel =
        "scripts/paper-buy-v2-execution-risk-variable-fix-v1-verify.cjs";

      const verifyFull =
        path.join(
          ROOT,
          verifyRel,
        );

      const verifySource =
String.raw`const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR =
  path.join(ROOT, "supabase", "migrations");

const files =
  fs.existsSync(MIG_DIR)
    ? fs.readdirSync(MIG_DIR)
        .filter(
          (name) =>
            name.endsWith(
              "_paper_buy_v2_execution_risk_variable_fix_v1.sql",
            ),
        )
        .sort()
    : [];

const target =
  files.length
    ? files[files.length - 1]
    : null;

const source =
  target
    ? fs.readFileSync(
        path.join(
          MIG_DIR,
          target,
        ),
        "utf8",
      )
    : "";

const checks = {
  migrationFound:
    Boolean(target),

  v2FunctionPresent:
    source.includes(
      "create or replace function public.execute_paper_buy_order_with_execution_price_v2(",
    ),

  declaredExecutionRisk:
    /\bv_execution_risk_amount\s+numeric\b/i.test(
      source,
    ),

  noBadActualTradeRiskReference:
    (() => {
      const fnStart =
        source.lastIndexOf(
          "create or replace function public.execute_paper_buy_order_with_execution_price_v2(",
        );

      if (fnStart < 0) {
        return false;
      }

      const bodyStart =
        source.indexOf(
          "as $$",
          fnStart,
        );

      if (bodyStart < 0) {
        return false;
      }

      const fnEnd =
        source.indexOf(
          "$$;",
          bodyStart + 5,
        );

      if (fnEnd < 0) {
        return false;
      }

      const fnBlock =
        source.slice(
          fnStart,
          fnEnd + 3,
        );

      return !/\bv_actual_trade_risk\b/.test(
        fnBlock,
      );
    })(),

  reservedRiskUsesExecutionRisk:
    /reserved_risk_amount[\s\S]{0,500}v_execution_risk_amount/i.test(
      source,
    ),

  transactionWrapped:
    /\bbegin\s*;/i.test(source) &&
    /\bcommit\s*;/i.test(source),

  noTableDataRewrite:
    !/\bdelete\s+from\b|\btruncate\b/i.test(
      source,
    ),
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) =>
        value !== true,
    )
    .map(
      ([name]) =>
        name,
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_BUY_V2_EXECUTION_RISK_VARIABLE_FIX_V1_VERIFIED"
          : "AI_STOCK_LAB_PAPER_BUY_V2_EXECUTION_RISK_VARIABLE_FIX_V1_VERIFY_FAILED",

      migration:
        target
          ? "supabase/migrations/" +
            target
          : null,

      checks,
      failed,

      safety: {
        sourceOnly:
          true,

        databaseReads:
          0,

        databaseWrites:
          0,

        historicalRowsRewritten:
          false,

        realTradingEnabled:
          false,
      },

      nextGate:
        failed.length === 0
          ? "SUPABASE_DB_PUSH_DRY_RUN"
          : "REPAIR_GENERATED_MIGRATION_BEFORE_APPLY",
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
`;

      fs.writeFileSync(
        verifyFull,
        verifySource,
        "utf8",
      );

      console.log(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_PAPER_BUY_V2_EXECUTION_RISK_VARIABLE_FIX_V1_INSTALLED",

            sourceMigration:
              "supabase/migrations/" +
              latest.name,

            generatedMigration:
              targetRel.replace(
                /\\/g,
                "/",
              ),

            generatedVerifier:
              verifyRel,

            replacement: {
              from:
                "v_actual_trade_risk",

              to:
                "v_execution_risk_amount",

              replacementCount:
                badCount,

              remainingBadReferences:
                remainingBad,
            },

            preserved: {
              functionSignature:
                true,

              v3V4V5CallChain:
                true,

              historicalMigrationsModified:
                false,

              productTypeScriptModified:
                false,
            },

            safety: {
              databaseReads:
                0,

              databaseWrites:
                0,

              migrationApplied:
                false,

              realTradingEnabled:
                false,
            },

            nextAction:
              "VERIFY_SOURCE_THEN_SUPABASE_DB_PUSH_DRY_RUN",
          },
          null,
          2,
        ),
      );
    }
  }
}
