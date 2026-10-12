const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");
const SCRIPT_DIR = path.join(ROOT, "scripts");

const TARGET_FN =
  "create_paper_buy_order_with_committed_risk_v3";

const FN_START =
  "create or replace function public." +
  TARGET_FN +
  "(";

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_PAPER_BUY_DB_DAILY_LOSS_DEFENSE_V1_INSTALL_FAILED",
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
    source.lastIndexOf(FN_START);

  if (start < 0) return null;

  const bodyStart =
    source.indexOf("as $$", start);

  if (bodyStart < 0) return null;

  const end =
    source.indexOf("$$;", bodyStart + 5);

  if (end < 0) return null;

  return source.slice(start, end + 3);
}

function normalize(rel) {
  return rel.replace(/\\/g, "/");
}

if (!fs.existsSync(MIG_DIR)) {
  fail("MIGRATION_DIRECTORY_NOT_FOUND");
}
else {
  const sqlFiles =
    fs.readdirSync(MIG_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort();

  const definitions = [];

  for (const name of sqlFiles) {
    const full =
      path.join(MIG_DIR, name);

    const source =
      fs.readFileSync(full, "utf8");

    if (!source.includes(FN_START)) {
      continue;
    }

    const block =
      extractFunctionBlock(source);

    if (block) {
      definitions.push({
        name,
        block,
      });
    }
  }

  if (definitions.length === 0) {
    fail("LATEST_COMMITTED_RISK_V3_FUNCTION_NOT_FOUND");
  }
  else {
    const latest =
      definitions[
        definitions.length - 1
      ];

    let patched =
      latest.block;

    const guardCall =
`  perform public.assert_paper_buy_daily_loss_allowed_v1(
    p_account_id,
    p_equity
  );

`;

    const alreadyBound =
      /perform\s+public\.assert_paper_buy_daily_loss_allowed_v1\s*\(/i
        .test(patched);

    if (!alreadyBound) {
      const exposureGuardIndex =
        patched.indexOf(
          "  perform public.assert_paper_buy_exposure_limits_v1("
        );

      const insertIndex =
        patched.lastIndexOf(
          "  insert into public.paper_order_requests ("
        );

      const bindingIndex =
        exposureGuardIndex >= 0
          ? exposureGuardIndex
          : insertIndex;

      if (bindingIndex < 0) {
        fail(
          "DAILY_LOSS_BINDING_POINT_NOT_FOUND",
          {
            sourceMigration:
              "supabase/migrations/" +
              latest.name,
          },
        );
        return;
      }

      patched =
        patched.slice(0, bindingIndex) +
        guardCall +
        patched.slice(bindingIndex);
    }

    let maxStamp =
      20261011002000;

    for (const name of sqlFiles) {
      if (!/^\d{14}_/.test(name)) {
        continue;
      }

      const stamp =
        Number(name.slice(0, 14));

      if (
        Number.isFinite(stamp) &&
        stamp > maxStamp
      ) {
        maxStamp = stamp;
      }
    }

    const stamp =
      Math.max(
        20261011002100,
        maxStamp + 100,
      );

    const migrationName =
      String(stamp) +
      "_paper_buy_db_daily_loss_defense_v1.sql";

    const migrationRel =
      path.join(
        "supabase",
        "migrations",
        migrationName,
      );

    const migrationFull =
      path.join(
        ROOT,
        migrationRel,
      );

    const helperSql =
`create or replace function public.assert_paper_buy_daily_loss_allowed_v1(
  p_account_id uuid,
  p_equity numeric,
  p_max_daily_loss_rate numeric default 0.02
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_daily_realized_pnl numeric := 0;
  v_max_daily_loss_amount numeric := 0;
begin
  if p_account_id is null then
    raise exception 'ACCOUNT_ID_REQUIRED';
  end if;

  if p_equity is null or p_equity <= 0 then
    raise exception 'EQUITY_INVALID';
  end if;

  if
    p_max_daily_loss_rate is null or
    p_max_daily_loss_rate <= 0 or
    p_max_daily_loss_rate > 1
  then
    raise exception 'MAX_DAILY_LOSS_RATE_INVALID';
  end if;

  /*
   * Serialize with other account-level BUY risk checks and with
   * account PnL/cash mutations.
   */
  select
    coalesce(a.daily_realized_pnl, 0)
  into
    v_daily_realized_pnl
  from public.paper_accounts a
  where a.id = p_account_id
  for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  v_max_daily_loss_amount :=
    p_equity *
    p_max_daily_loss_rate;

  if
    v_daily_realized_pnl <=
    -v_max_daily_loss_amount
  then
    raise exception 'DAILY_LOSS_LIMIT_REACHED'
      using detail =
        jsonb_build_object(
          'dailyRealizedPnl',
            v_daily_realized_pnl,
          'maxDailyLossAmount',
            v_max_daily_loss_amount,
          'maxDailyLossRate',
            p_max_daily_loss_rate,
          'equity',
            p_equity
        )::text;
  end if;
end;
$$;`;

    const migrationSql =
`-- AI Stock Lab
-- PAPER BUY DB Daily Loss Defense-in-Depth V1
--
-- App policy alignment:
--   maxDailyLossRate = 2%
--   dailyRealizedPnl <= -(equity * 2%) blocks new BUY risk.
--
-- The canonical create_paper_buy_order_with_committed_risk_v3
-- signature remains unchanged.
--
-- No historical rows are rewritten.

begin;

${helperSql}

revoke all on function
  public.assert_paper_buy_daily_loss_allowed_v1(
    uuid,
    numeric,
    numeric
  )
from public, anon, authenticated;

${patched}

comment on function
  public.assert_paper_buy_daily_loss_allowed_v1(
    uuid,
    numeric,
    numeric
  )
is
  'Fail-closed PAPER BUY daily realized loss guard. Defaults to 2% of supplied account equity and serializes on paper_accounts FOR UPDATE.';

comment on function
  public.create_paper_buy_order_with_committed_risk_v3(
    uuid,
    text,
    integer,
    numeric,
    numeric,
    uuid,
    boolean,
    numeric,
    numeric
  )
is
  'Canonical committed-risk PAPER BUY order-create RPC with kill-switch/freshness, daily-loss, aggregate-open-risk and notional exposure defense-in-depth.';

commit;
`;

    if (fs.existsSync(migrationFull)) {
      const existing =
        fs.readFileSync(
          migrationFull,
          "utf8",
        );

      if (existing !== migrationSql) {
        fail(
          "TARGET_MIGRATION_EXISTS_WITH_DIFFERENT_CONTENT",
          {
            target:
              normalize(migrationRel),
          },
        );
        return;
      }
    }
    else {
      fs.writeFileSync(
        migrationFull,
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

    const verifierRel =
      "scripts/paper-buy-db-daily-loss-defense-v1-verify.cjs";

    const verifierFull =
      path.join(
        ROOT,
        verifierRel,
      );

    const verifierSource = String.raw`const fs = require("fs");
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
              "_paper_buy_db_daily_loss_defense_v1.sql",
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
        path.join(MIG_DIR, target),
        "utf8",
      )
    : "";

const checks = {
  migrationFound:
    Boolean(target),

  helperFunctionPresent:
    /create or replace function public\.assert_paper_buy_daily_loss_allowed_v1\s*\(/i
      .test(source),

  dailyRealizedPnlRead:
    /daily_realized_pnl/i
      .test(source),

  accountRowLocked:
    /from public\.paper_accounts[\s\S]{0,180}for update;/i
      .test(source),

  defaultRateTwoPercent:
    /p_max_daily_loss_rate numeric default 0\.02/i
      .test(source),

  thresholdUsesEquity:
    /v_max_daily_loss_amount\s*:=\s*p_equity\s*\*\s*p_max_daily_loss_rate/i
      .test(source),

  failClosedError:
    /DAILY_LOSS_LIMIT_REACHED/i
      .test(source),

  createRpcSignaturePreserved:
    /create or replace function public\.create_paper_buy_order_with_committed_risk_v3\s*\(\s*p_account_id uuid,\s*p_stock_code text,\s*p_requested_quantity integer,\s*p_entry_price numeric,\s*p_stop_price numeric,\s*p_risk_decision_id uuid,\s*p_preflight_approved boolean,\s*p_equity numeric,\s*p_max_aggregate_open_risk_rate numeric default 0\.02\s*\)/mi
      .test(source),

  dailyLossGuardBound:
    /perform public\.assert_paper_buy_daily_loss_allowed_v1\s*\(\s*p_account_id,\s*p_equity\s*\);/mi
      .test(source),

  exposureGuardPreserved:
    /perform public\.assert_paper_buy_exposure_limits_v1\s*\(/i
      .test(source),

  freshnessGuardPreserved:
    /assert_paper_buy_data_freshness_allowed_v1/i
      .test(source),

  killSwitchGuardPreserved:
    /assert_paper_buy_new_risk_allowed_v1/i
      .test(source),

  historicalDataRewriteAbsent:
    !/\bupdate\s+public\.paper_accounts\b[\s\S]{0,120}\bdaily_realized_pnl\b/i
      .test(
        source.replace(
          /create or replace function[\s\S]*?\$\$;/gi,
          "",
        ),
      ),

  transactionWrapped:
    /\bbegin\s*;/i.test(source) &&
    /\bcommit\s*;/i.test(source),

  noRealTradingEnable:
    !/REAL_TRADING_ENABLED\s*=\s*true/i
      .test(source),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_BUY_DB_DAILY_LOSS_DEFENSE_V1_VERIFIED"
          : "AI_STOCK_LAB_PAPER_BUY_DB_DAILY_LOSS_DEFENSE_V1_VERIFY_FAILED",

      migration:
        target
          ? "supabase/migrations/" +
            target
          : null,

      checks,
      failed,

      policy: {
        maxDailyLossRate:
          0.02,

        blockCondition:
          "daily_realized_pnl <= -(equity * 0.02)",

        concurrency:
          "paper_accounts row FOR UPDATE",
      },

      safety: {
        sourceOnly: true,
        databaseReads: 0,
        databaseWrites: 0,
        migrationApplied: false,
        historicalRowsRewritten: false,
        realTradingEnabled: false,
      },

      nextGate:
        failed.length === 0
          ? "SUPABASE_DB_PUSH_DRY_RUN_FOR_DAILY_LOSS_DEFENSE"
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
      verifierFull,
      verifierSource,
      "utf8",
    );

    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_PAPER_BUY_DB_DAILY_LOSS_DEFENSE_V1_INSTALLED",

          sourceMigration:
            "supabase/migrations/" +
            latest.name,

          generatedMigration:
            normalize(migrationRel),

          generatedVerifier:
            verifierRel,

          changes: {
            createRpcSignatureChanged:
              false,

            dailyLossDbGuard:
              true,

            maxDailyLossRate:
              0.02,

            accountLevelSerialization:
              true,

            exposureGuardPreserved:
              true,

            freshnessGuardPreserved:
              true,

            killSwitchGuardPreserved:
              true,
          },

          safety: {
            historicalMigrationsModified:
              false,

            historicalRowsRewritten:
              false,

            databaseWrites:
              0,

            migrationApplied:
              false,

            productTypeScriptModified:
              false,

            realTradingEnabled:
              false,
          },

          nextAction:
            "VERIFY_SOURCE_AND_SUPABASE_DB_PUSH_DRY_RUN",
        },
        null,
        2,
      ),
    );
  }
}
