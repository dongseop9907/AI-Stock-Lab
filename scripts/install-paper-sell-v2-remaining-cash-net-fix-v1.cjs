const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");
const SCRIPT_DIR = path.join(ROOT, "scripts");

const FN_START =
  "create or replace function public.execute_paper_protective_sell_v2(";

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_SELL_V2_REMAINING_CASH_NET_FIX_V1_INSTALL_FAILED",
        reason,
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
      FN_START,
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
  fail("MIGRATION_DIRECTORY_NOT_FOUND");
}
else {
  const sqlFiles =
    fs.readdirSync(MIG_DIR)
      .filter(
        (name) =>
          name.endsWith(".sql"),
      )
      .sort();

  const defs = [];

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
        FN_START,
      )
    ) {
      continue;
    }

    const block =
      extractFunctionBlock(
        source,
      );

    if (block) {
      defs.push({
        name,
        block,
      });
    }
  }

  if (defs.length === 0) {
    fail(
      "LATEST_SELL_V2_DEFINITION_NOT_FOUND",
    );
  }
  else {
    const latest =
      defs[
        defs.length - 1
      ];

    const original =
      latest.block;

    const oldPattern =
/'remainingCash'\s*,\s*v_account\.cash_balance\s*\+\s*v_exit_amount\s*,/m;

    const alreadyNetPattern =
/'remainingCash'\s*,\s*v_account\.cash_balance\s*\+\s*v_exit_amount\s*-\s*v_total_transaction_cost\s*,/m;

    let fixed =
      original;

    let replacementCount =
      0;

    if (
      alreadyNetPattern.test(
        original,
      )
    ) {
      replacementCount = 0;
    }
    else {
      const matches =
        original.match(
          new RegExp(
            oldPattern.source,
            "gm",
          ),
        ) || [];

      replacementCount =
        matches.length;

      if (
        replacementCount !== 1
      ) {
        fail(
          "EXPECTED_SINGLE_GROSS_REMAINING_CASH_RETURN_NOT_FOUND",
          {
            sourceMigration:
              latest.name,

            foundCount:
              replacementCount,
          },
        );
        return;
      }

      fixed =
        original.replace(
          oldPattern,
          `'remainingCash',
      v_account.cash_balance +
      v_exit_amount -
      v_total_transaction_cost,`,
        );
    }

    if (
      !alreadyNetPattern.test(
        fixed,
      )
    ) {
      fail(
        "NET_REMAINING_CASH_REPLACEMENT_NOT_VERIFIED",
        {
          sourceMigration:
            latest.name,
        },
      );
      return;
    }

    let maxStamp =
      20261011001700;

    for (const name of sqlFiles) {
      if (
        !/^\d{14}_/.test(
          name,
        )
      ) {
        continue;
      }

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

    const stamp =
      Math.max(
        20261011001800,
        maxStamp + 100,
      );

    const targetName =
      String(stamp) +
      "_paper_sell_v2_remaining_cash_net_fix_v1.sql";

    const targetRel =
      path.join(
        "supabase",
        "migrations",
        targetName,
      );

    const targetFull =
      path.join(
        ROOT,
        targetRel,
      );

    const migrationSql =
`-- PAPER SELL V2 remaining-cash net fix V1
-- The account mutation already credits gross exit proceeds and then
-- deducts broker fee + sell tax. The RPC response must report the
-- same net post-transaction cash balance.
-- No historical rows are rewritten.

begin;

${fixed}

comment on function
  public.execute_paper_protective_sell_v2(
    uuid,
    numeric,
    timestamptz,
    integer,
    numeric,
    numeric,
    text,
    text
  )
is
  'Canonical PAPER protective SELL V2 executor. V1 fix: remainingCash response is net of broker fee and sell tax, matching persisted paper_accounts.cash_balance.';

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
              targetRel.replace(
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
      "scripts/paper-sell-v2-remaining-cash-net-fix-v1-verify.cjs";

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
              "_paper_sell_v2_remaining_cash_net_fix_v1.sql",
            ),
        )
        .sort()
    : [];

const target =
  files.length
    ? files[
        files.length - 1
      ]
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

const fnStart =
  source.lastIndexOf(
    "create or replace function public.execute_paper_protective_sell_v2(",
  );

const bodyStart =
  fnStart >= 0
    ? source.indexOf(
        "as $$",
        fnStart,
      )
    : -1;

const fnEnd =
  bodyStart >= 0
    ? source.indexOf(
        "$$;",
        bodyStart + 5,
      )
    : -1;

const fnBlock =
  (
    fnStart >= 0 &&
    bodyStart >= 0 &&
    fnEnd >= 0
  )
    ? source.slice(
        fnStart,
        fnEnd + 3,
      )
    : "";

const checks = {
  migrationFound:
    Boolean(target),

  sellV2FunctionPresent:
    fnBlock.includes(
      "create or replace function public.execute_paper_protective_sell_v2(",
    ),

  totalTransactionCostDefined:
    /v_total_transaction_cost\s*:=\s*p_broker_fee\s*\+\s*p_sell_tax\s*;/m
      .test(fnBlock),

  accountCreditsGrossExit:
    /cash_balance\s*=\s*cash_balance\s*\+\s*v_exit_amount/m
      .test(fnBlock),

  accountDeductsTransactionCost:
    /cash_balance\s*=\s*cash_balance\s*-\s*v_total_transaction_cost/m
      .test(fnBlock),

  responseReturnsNetCash:
    /'remainingCash'\s*,\s*v_account\.cash_balance\s*\+\s*v_exit_amount\s*-\s*v_total_transaction_cost\s*,/m
      .test(fnBlock),

  responseNoLongerReturnsGrossCash:
    !/'remainingCash'\s*,\s*v_account\.cash_balance\s*\+\s*v_exit_amount\s*,/m
      .test(fnBlock),

  noHistoricalDataRewrite:
    !/\bupdate\s+public\.paper_accounts\b[\s\S]{0,120}\bwhere\b[\s\S]{0,120}\bnot\b/i
      .test(
        source
          .replace(
            fnBlock,
            "",
          ),
      ),

  transactionWrapped:
    /\bbegin\s*;/i.test(
      source,
    ) &&
    /\bcommit\s*;/i.test(
      source,
    ),
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
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_SELL_V2_REMAINING_CASH_NET_FIX_V1_VERIFIED"
          : "AI_STOCK_LAB_PAPER_SELL_V2_REMAINING_CASH_NET_FIX_V1_VERIFY_FAILED",

      migration:
        target
          ? "supabase/migrations/" +
            target
          : null,

      checks,
      failed,

      expectedAccounting: {
        initialCash:
          1000000000,

        exitProceeds:
          8900,

        brokerFee:
          10,

        sellTax:
          5,

        expectedFinalCash:
          1000008885,
      },

      safety: {
        sourceOnly:
          true,

        databaseReads:
          0,

        databaseWrites:
          0,

        migrationApplied:
          false,

        historicalRowsRewritten:
          false,

        realTradingEnabled:
          false,
      },

      nextGate:
        failed.length === 0
          ? "SUPABASE_DB_PUSH_DRY_RUN_FOR_SELL_REMAINING_CASH_FIX"
          : "REPAIR_SOURCE_BEFORE_DB_APPLY",
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
            "AI_STOCK_LAB_PAPER_SELL_V2_REMAINING_CASH_NET_FIX_V1_INSTALLED",

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

          fix: {
            issue:
              "SELL_RPC_REMAINING_CASH_RETURNED_GROSS_PROCEEDS",

            before:
              "v_account.cash_balance + v_exit_amount",

            after:
              "v_account.cash_balance + v_exit_amount - v_total_transaction_cost",

            replacementCount,
          },

          preserved: {
            accountMutationLogic:
              true,

            sellV3V4CallChain:
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
            "VERIFY_AND_SUPABASE_DB_PUSH_DRY_RUN",
        },
        null,
        2,
      ),
    );
  }
}
