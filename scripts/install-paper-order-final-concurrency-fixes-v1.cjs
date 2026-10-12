const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");
const STRESS_REL =
  "scripts/paper-order-final-two-http-concurrent-duplicate-fill-stress-v1.cjs";
const STRESS_FULL = path.join(ROOT, STRESS_REL);
const VERIFY_REL =
  "scripts/paper-order-final-concurrency-fixes-v1-verify.cjs";
const VERIFY_FULL = path.join(ROOT, VERIFY_REL);

const FN_START =
  "create or replace function public.execute_paper_buy_order_with_execution_price_v2(";

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_ORDER_FINAL_CONCURRENCY_FIXES_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));
  process.exitCode = 1;
}

function extractLastFunctionBlock(source) {
  const start = source.lastIndexOf(FN_START);
  if (start < 0) return null;

  const bodyStart = source.indexOf("as $$", start);
  if (bodyStart < 0) return null;

  const end = source.indexOf("$$;", bodyStart + 5);
  if (end < 0) return null;

  return source.slice(start, end + 3);
}

if (!fs.existsSync(MIG_DIR)) {
  fail("MIGRATION_DIRECTORY_NOT_FOUND");
}
else if (!fs.existsSync(STRESS_FULL)) {
  fail("STRESS_HARNESS_NOT_FOUND", {
    expected: STRESS_REL,
  });
}
else {
  const sqlFiles = fs.readdirSync(MIG_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const defs = [];

  for (const name of sqlFiles) {
    const full = path.join(MIG_DIR, name);
    const source = fs.readFileSync(full, "utf8");

    if (!source.includes(FN_START)) continue;

    const block = extractLastFunctionBlock(source);
    if (block) {
      defs.push({ name, block });
    }
  }

  if (defs.length === 0) {
    fail("LATEST_BUY_V2_DEFINITION_NOT_FOUND");
  }
  else {
    const latest = defs[defs.length - 1];
    let fixed = latest.block;

    const insertPattern =
/insert into public\.paper_positions\s*\(\s*account_id,\s*stock_code,\s*sector,\s*quantity,\s*average_price,\s*current_stop_price\s*\)\s*select\s*v_order\.account_id,\s*v_order\.stock_code,\s*s\.sector,\s*v_effective_fill_quantity,\s*p_execution_price,\s*v_order\.stop_price\s*from public\.stocks s/mi;

    const alreadyBound =
      /insert into public\.paper_positions[\s\S]{0,400}\bentry_order_id\b/i
        .test(fixed);

    let migrationNeeded = false;

    if (!alreadyBound) {
      if (!insertPattern.test(fixed)) {
        fail(
          "EXPECTED_NEW_POSITION_INSERT_SHAPE_NOT_FOUND",
          {
            sourceMigration: latest.name,
          },
        );
        return;
      }

      fixed = fixed.replace(
        insertPattern,
`insert into public.paper_positions (
      account_id,
      stock_code,
      sector,
      quantity,
      average_price,
      current_stop_price,
      entry_order_id
    )
    select
      v_order.account_id,
      v_order.stock_code,
      s.sector,
      v_effective_fill_quantity,
      p_execution_price,
      v_order.stop_price,
      v_order.id
    from public.stocks s`,
      );

      migrationNeeded = true;
    }

    let migrationRel = null;

    if (migrationNeeded) {
      let maxStamp = 20261011001600;

      for (const name of sqlFiles) {
        if (!/^\d{14}_/.test(name)) continue;

        const stamp = Number(name.slice(0, 14));

        if (
          Number.isFinite(stamp) &&
          stamp > maxStamp
        ) {
          maxStamp = stamp;
        }
      }

      const stamp = Math.max(
        20261011001700,
        maxStamp + 100,
      );

      const filename =
        String(stamp) +
        "_paper_buy_v2_position_entry_order_binding_fix_v1.sql";

      migrationRel =
        path.join(
          "supabase",
          "migrations",
          filename,
        );

      const migrationFull =
        path.join(ROOT, migrationRel);

      const sql =
`-- PAPER BUY V2 position entry-order binding fix V1
-- New positions created by the canonical BUY executor must retain
-- the originating BUY order ID for provenance/model attribution.
-- Existing rows are not rewritten.

begin;

${fixed}

comment on function
  public.execute_paper_buy_order_with_execution_price_v2(
    uuid,
    numeric,
    timestamptz,
    integer,
    numeric
  )
is
  'Canonical PAPER BUY V2 executor. Concurrency hardening fix: new positions persist entry_order_id = originating BUY order ID.';

commit;
`;

      if (fs.existsSync(migrationFull)) {
        const existing =
          fs.readFileSync(migrationFull, "utf8");

        if (existing !== sql) {
          fail(
            "TARGET_MIGRATION_EXISTS_WITH_DIFFERENT_CONTENT",
            {
              target:
                migrationRel.replace(/\\/g, "/"),
            },
          );
          return;
        }
      }
      else {
        fs.writeFileSync(
          migrationFull,
          sql,
          "utf8",
        );
      }
    }

    /*
     * Patch only the SELL fixture values in the final stress harness.
     * Keep highest_price = 11000 unchanged; the protective stop is 9000,
     * and an exit price of 8900 correctly represents a triggered stop.
     */
    let stress =
      fs.readFileSync(
        STRESS_FULL,
        "utf8",
      );

    const replacements = [
      [
        /exitPrice:\s*\n\s*11000,/,
        "exitPrice:\n        8900,",
        "sellFixture.exitPrice",
      ],
      [
        /p_exit_price:\s*\n\s*11000,/,
        "p_exit_price:\n        8900,",
        "sellBody.p_exit_price",
      ],
      [
        /tradeRows\[0\]\?\.exit_price,\s*\n\s*11000,/,
        "tradeRows[0]?.exit_price,\n          8900,",
        "sellCheck.exitPrice",
      ],
    ];

    const patched = [];

    for (const [
      pattern,
      replacement,
      label,
    ] of replacements) {
      if (pattern.test(stress)) {
        stress =
          stress.replace(
            pattern,
            replacement,
          );

        patched.push(label);
      }
      else {
        /*
         * Allow idempotent rerun if already patched.
         */
        const already =
          label === "sellFixture.exitPrice"
            ? /exitPrice:\s*\n\s*8900,/.test(stress)
            : label === "sellBody.p_exit_price"
              ? /p_exit_price:\s*\n\s*8900,/.test(stress)
              : /tradeRows\[0\]\?\.exit_price,\s*\n\s*8900,/.test(stress);

        if (!already) {
          fail(
            "SELL_STRESS_PATCH_TARGET_NOT_FOUND",
            {
              label,
            },
          );
          return;
        }
      }
    }

    fs.writeFileSync(
      STRESS_FULL,
      stress,
      "utf8",
    );

    const verifySource = String.raw`const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR =
  path.join(ROOT, "supabase", "migrations");

const stressPath =
  path.join(
    ROOT,
    "scripts/paper-order-final-two-http-concurrent-duplicate-fill-stress-v1.cjs",
  );

const migrationFiles =
  fs.existsSync(MIG_DIR)
    ? fs.readdirSync(MIG_DIR)
        .filter(
          (name) =>
            name.endsWith(
              "_paper_buy_v2_position_entry_order_binding_fix_v1.sql",
            ),
        )
        .sort()
    : [];

const migration =
  migrationFiles.length
    ? migrationFiles[
        migrationFiles.length - 1
      ]
    : null;

const migrationSource =
  migration
    ? fs.readFileSync(
        path.join(
          MIG_DIR,
          migration,
        ),
        "utf8",
      )
    : "";

const stressSource =
  fs.existsSync(stressPath)
    ? fs.readFileSync(
        stressPath,
        "utf8",
      )
    : "";

const checks = {
  migrationFound:
    Boolean(migration),

  v2FunctionPresent:
    migrationSource.includes(
      "create or replace function public.execute_paper_buy_order_with_execution_price_v2(",
    ),

  positionInsertIncludesEntryOrderId:
    /insert into public\.paper_positions[\s\S]{0,500}\bentry_order_id\b/i
      .test(migrationSource),

  positionInsertUsesOriginOrderId:
    /entry_order_id[\s\S]{0,300}v_order\.id/i
      .test(migrationSource),

  noHistoricalDataRewrite:
    !/\bupdate\s+public\.paper_positions\b[\s\S]{0,200}\bentry_order_id\b/i
      .test(migrationSource),

  sellFixtureBelowStop:
    /exitPrice:\s*\n\s*8900,/.test(
      stressSource,
    ) &&
    /current_stop_price:\s*\n\s*9000,/.test(
      stressSource,
    ),

  sellRpcExitBelowStop:
    /p_exit_price:\s*\n\s*8900,/.test(
      stressSource,
    ),

  sellExpectedExitUpdated:
    /tradeRows\[0\]\?\.exit_price,\s*\n\s*8900,/.test(
      stressSource,
    ),

  buyEntryOrderAssertionStillEnabled:
    /positionEntryOrderMatches:\s*\n\s*positionRows\[0\]\?\.entry_order_id\s*===\s*\n\s*orderId/.test(
      stressSource,
    ),

  realTradingDisabledByHarness:
    /realTradingEnabled:\s*\n\s*false/.test(
      stressSource,
    ),
};

const failed =
  Object.entries(checks)
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
          ? "AI_STOCK_LAB_PAPER_ORDER_FINAL_CONCURRENCY_FIXES_V1_VERIFIED"
          : "AI_STOCK_LAB_PAPER_ORDER_FINAL_CONCURRENCY_FIXES_V1_VERIFY_FAILED",

      migration:
        migration
          ? "supabase/migrations/" +
            migration
          : null,

      stressHarness:
        "scripts/paper-order-final-two-http-concurrent-duplicate-fill-stress-v1.cjs",

      checks,
      failed,

      safety: {
        sourceOnly:
          true,

        migrationApplied:
          false,

        historicalRowsRewritten:
          false,

        realBrokerApiInvoked:
          false,

        realTradingEnabled:
          false,
      },

      nextGate:
        failed.length === 0
          ? "SUPABASE_DB_PUSH_DRY_RUN_FOR_ENTRY_ORDER_BINDING_FIX"
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
      VERIFY_FULL,
      verifySource,
      "utf8",
    );

    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_PAPER_ORDER_FINAL_CONCURRENCY_FIXES_V1_INSTALLED",

          sourceMigration:
            "supabase/migrations/" +
            latest.name,

          generatedMigration:
            migrationRel
              ? migrationRel.replace(
                  /\\/g,
                  "/",
                )
              : null,

          buyFix: {
            issue:
              "NEW_POSITION_ENTRY_ORDER_ID_WAS_NULL",

            fix:
              "PERSIST_V_ORDER_ID_AS_ENTRY_ORDER_ID",

            migrationNeeded,
          },

          sellHarnessFix: {
            currentStopPrice:
              9000,

            oldExitPrice:
              11000,

            newExitPrice:
              8900,

            reason:
              "TRIGGER_PROTECTIVE_STOP_PATH",

            patched,
          },

          generatedVerifier:
            VERIFY_REL,

          safety: {
            historicalMigrationsModified:
              false,

            databaseWrites:
              0,

            migrationApplied:
              false,

            realBrokerApiInvoked:
              false,

            realTradingEnabled:
              false,
          },

          nextAction:
            "VERIFY_AND_DB_PUSH_DRY_RUN",
        },
        null,
        2,
      ),
    );
  }
}
