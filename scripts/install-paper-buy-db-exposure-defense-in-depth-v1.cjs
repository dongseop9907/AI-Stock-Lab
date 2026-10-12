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
          "AI_STOCK_LAB_DB_EXPOSURE_DEFENSE_IN_DEPTH_V1_INSTALL_FAILED",
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
`  perform public.assert_paper_buy_exposure_limits_v1(
    p_account_id,
    p_stock_code,
    p_requested_quantity,
    p_entry_price,
    p_equity
  );

`;

    const alreadyBound =
      /perform\s+public\.assert_paper_buy_exposure_limits_v1\s*\(/i
        .test(patched);

    if (!alreadyBound) {
      const insertNeedle =
        "  insert into public.paper_order_requests (";

      const insertIndex =
        patched.lastIndexOf(insertNeedle);

      if (insertIndex < 0) {
        fail(
          "ORDER_INSERT_BINDING_POINT_NOT_FOUND",
          {
            sourceMigration:
              "supabase/migrations/" +
              latest.name,
          },
        );
        return;
      }

      /*
       * Bind immediately before the final order INSERT.
       * Existing idempotent replay / validation branches therefore
       * return before this guard and are not double-counted.
       */
      patched =
        patched.slice(0, insertIndex) +
        guardCall +
        patched.slice(insertIndex);
    }

    let maxStamp =
      20261011001800;

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
        20261011001900,
        maxStamp + 100,
      );

    const migrationName =
      String(stamp) +
      "_paper_buy_db_exposure_defense_in_depth_v1.sql";

    const migrationRel =
      path.join(
        "supabase",
        "migrations",
        migrationName,
      );

    const migrationFull =
      path.join(ROOT, migrationRel);

    const helperSql =
`create or replace function public.assert_paper_buy_exposure_limits_v1(
  p_account_id uuid,
  p_stock_code text,
  p_requested_quantity integer,
  p_entry_price numeric,
  p_equity numeric,
  p_max_position_rate numeric default 0.10,
  p_max_portfolio_exposure_rate numeric default 0.60,
  p_max_sector_exposure_rate numeric default 0.25
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sector text;
  v_order_amount numeric := 0;

  v_position_exposure numeric := 0;
  v_portfolio_exposure numeric := 0;
  v_sector_exposure numeric := 0;

  v_pending_position_exposure numeric := 0;
  v_pending_portfolio_exposure numeric := 0;
  v_pending_sector_exposure numeric := 0;

  v_max_position_amount numeric := 0;
  v_max_portfolio_amount numeric := 0;
  v_max_sector_amount numeric := 0;
begin
  if p_account_id is null then
    raise exception 'ACCOUNT_ID_REQUIRED';
  end if;

  if coalesce(trim(p_stock_code), '') = '' then
    raise exception 'STOCK_CODE_REQUIRED';
  end if;

  if p_requested_quantity is null or p_requested_quantity <= 0 then
    raise exception 'REQUESTED_QUANTITY_INVALID';
  end if;

  if p_entry_price is null or p_entry_price <= 0 then
    raise exception 'ENTRY_PRICE_INVALID';
  end if;

  if p_equity is null or p_equity <= 0 then
    raise exception 'EQUITY_INVALID';
  end if;

  if
    p_max_position_rate is null or
    p_max_position_rate <= 0 or
    p_max_position_rate > 1
  then
    raise exception 'MAX_POSITION_RATE_INVALID';
  end if;

  if
    p_max_portfolio_exposure_rate is null or
    p_max_portfolio_exposure_rate <= 0 or
    p_max_portfolio_exposure_rate > 1
  then
    raise exception 'MAX_PORTFOLIO_EXPOSURE_RATE_INVALID';
  end if;

  if
    p_max_sector_exposure_rate is null or
    p_max_sector_exposure_rate <= 0 or
    p_max_sector_exposure_rate > 1
  then
    raise exception 'MAX_SECTOR_EXPOSURE_RATE_INVALID';
  end if;

  /*
   * Serialize exposure commitments per PAPER account.
   * This prevents two concurrent order-create transactions from both
   * observing the same pre-order exposure and jointly exceeding a limit.
   */
  perform 1
  from public.paper_accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  select
    coalesce(
      nullif(
        trim(s.sector),
        ''
      ),
      '__UNKNOWN__'
    )
  into v_sector
  from public.stocks s
  where s.stock_code = p_stock_code
  limit 1;

  if not found then
    raise exception 'STOCK_NOT_FOUND';
  end if;

  v_order_amount :=
    p_entry_price *
    p_requested_quantity;

  v_max_position_amount :=
    p_equity *
    p_max_position_rate;

  v_max_portfolio_amount :=
    p_equity *
    p_max_portfolio_exposure_rate;

  v_max_sector_amount :=
    p_equity *
    p_max_sector_exposure_rate;

  /*
   * Filled/open position notional exposure.
   * Basis intentionally matches the application risk-manager:
   * quantity * average entry price.
   */
  select
    coalesce(
      sum(
        case
          when p.stock_code = p_stock_code
          then
            coalesce(p.quantity, 0) *
            coalesce(p.average_price, 0)
          else 0
        end
      ),
      0
    ),
    coalesce(
      sum(
        coalesce(p.quantity, 0) *
        coalesce(p.average_price, 0)
      ),
      0
    ),
    coalesce(
      sum(
        case
          when
            coalesce(
              nullif(
                trim(p.sector),
                ''
              ),
              '__UNKNOWN__'
            ) = v_sector
          then
            coalesce(p.quantity, 0) *
            coalesce(p.average_price, 0)
          else 0
        end
      ),
      0
    )
  into
    v_position_exposure,
    v_portfolio_exposure,
    v_sector_exposure
  from public.paper_positions p
  where
    p.account_id = p_account_id and
    coalesce(p.quantity, 0) > 0;

  /*
   * Also reserve notional exposure for active BUY orders that have not
   * yet filled completely. This closes the gap between order creation
   * and position creation.
   */
  select
    coalesce(
      sum(
        case
          when o.stock_code = p_stock_code
          then
            greatest(
              coalesce(
                o.approved_quantity,
                o.requested_quantity,
                0
              ) -
              coalesce(
                o.filled_quantity,
                0
              ),
              0
            ) *
            coalesce(
              o.entry_price,
              0
            )
          else 0
        end
      ),
      0
    ),
    coalesce(
      sum(
        greatest(
          coalesce(
            o.approved_quantity,
            o.requested_quantity,
            0
          ) -
          coalesce(
            o.filled_quantity,
            0
          ),
          0
        ) *
        coalesce(
          o.entry_price,
          0
        )
      ),
      0
    ),
    coalesce(
      sum(
        case
          when
            coalesce(
              nullif(
                trim(s.sector),
                ''
              ),
              '__UNKNOWN__'
            ) = v_sector
          then
            greatest(
              coalesce(
                o.approved_quantity,
                o.requested_quantity,
                0
              ) -
              coalesce(
                o.filled_quantity,
                0
              ),
              0
            ) *
            coalesce(
              o.entry_price,
              0
            )
          else 0
        end
      ),
      0
    )
  into
    v_pending_position_exposure,
    v_pending_portfolio_exposure,
    v_pending_sector_exposure
  from public.paper_order_requests o
  left join public.stocks s
    on s.stock_code = o.stock_code
  where
    o.account_id = p_account_id and
    o.status in (
      'REQUESTED',
      'RISK_APPROVED'
    );

  if
    v_position_exposure +
    v_pending_position_exposure +
    v_order_amount >
    v_max_position_amount
  then
    raise exception 'POSITION_LIMIT_EXCEEDED'
      using detail =
        jsonb_build_object(
          'currentPositionExposure',
            v_position_exposure,
          'pendingPositionExposure',
            v_pending_position_exposure,
          'newOrderAmount',
            v_order_amount,
          'maxPositionAmount',
            v_max_position_amount
        )::text;
  end if;

  if
    v_portfolio_exposure +
    v_pending_portfolio_exposure +
    v_order_amount >
    v_max_portfolio_amount
  then
    raise exception 'PORTFOLIO_LIMIT_EXCEEDED'
      using detail =
        jsonb_build_object(
          'currentPortfolioExposure',
            v_portfolio_exposure,
          'pendingPortfolioExposure',
            v_pending_portfolio_exposure,
          'newOrderAmount',
            v_order_amount,
          'maxPortfolioAmount',
            v_max_portfolio_amount
        )::text;
  end if;

  if
    v_sector_exposure +
    v_pending_sector_exposure +
    v_order_amount >
    v_max_sector_amount
  then
    raise exception 'SECTOR_LIMIT_EXCEEDED'
      using detail =
        jsonb_build_object(
          'sector',
            v_sector,
          'currentSectorExposure',
            v_sector_exposure,
          'pendingSectorExposure',
            v_pending_sector_exposure,
          'newOrderAmount',
            v_order_amount,
          'maxSectorAmount',
            v_max_sector_amount
        )::text;
  end if;
end;
$$;`;

    const migrationSql =
`-- AI Stock Lab
-- PAPER BUY DB Exposure Defense-in-Depth V1
--
-- Purpose:
--   Preserve the application-level 10% ticker / 60% portfolio /
--   25% sector notional exposure policy at the authoritative
--   PostgreSQL order-create boundary.
--
-- Concurrency:
--   Locks paper_accounts row before reading exposure and inserting
--   a new risk-approved BUY order, serializing commitments per account.
--
-- Compatibility:
--   create_paper_buy_order_with_committed_risk_v3 signature is unchanged.
--   Existing callers remain compatible.
--
-- No historical rows are rewritten.

begin;

${helperSql}

revoke all on function
  public.assert_paper_buy_exposure_limits_v1(
    uuid,
    text,
    integer,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric
  )
from public, anon, authenticated;

${patched}

comment on function
  public.assert_paper_buy_exposure_limits_v1(
    uuid,
    text,
    integer,
    numeric,
    numeric,
    numeric,
    numeric,
    numeric
  )
is
  'Fail-closed PAPER BUY notional exposure guard. Serializes by account and enforces ticker 10%, portfolio 60%, sector 25% defaults including active unfilled BUY commitments.';

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
  'Canonical committed-risk PAPER BUY order-create RPC with aggregate open-risk, freshness and DB notional exposure defense-in-depth.';

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
      "scripts/paper-buy-db-exposure-defense-in-depth-v1-verify.cjs";

    const verifierFull =
      path.join(ROOT, verifierRel);

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
              "_paper_buy_db_exposure_defense_in_depth_v1.sql",
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
    /create or replace function public\.assert_paper_buy_exposure_limits_v1\s*\(/i
      .test(source),

  createRpcSignaturePreserved:
    /create or replace function public\.create_paper_buy_order_with_committed_risk_v3\s*\(\s*p_account_id uuid,\s*p_stock_code text,\s*p_requested_quantity integer,\s*p_entry_price numeric,\s*p_stop_price numeric,\s*p_risk_decision_id uuid,\s*p_preflight_approved boolean,\s*p_equity numeric,\s*p_max_aggregate_open_risk_rate numeric default 0\.02\s*\)/mi
      .test(source),

  accountRowSerialized:
    /from public\.paper_accounts[\s\S]{0,160}for update;/i
      .test(source),

  positionNotionalIncluded:
    /p\.quantity[\s\S]{0,80}\*[\s\S]{0,80}p\.average_price/i
      .test(source),

  pendingBuyNotionalIncluded:
    /o\.approved_quantity[\s\S]{0,220}o\.filled_quantity[\s\S]{0,220}o\.entry_price/i
      .test(source),

  tickerLimitEnforced:
    /POSITION_LIMIT_EXCEEDED/i
      .test(source),

  portfolioLimitEnforced:
    /PORTFOLIO_LIMIT_EXCEEDED/i
      .test(source),

  sectorLimitEnforced:
    /SECTOR_LIMIT_EXCEEDED/i
      .test(source),

  defaultTickerRateMatchesApp:
    /p_max_position_rate numeric default 0\.10/i
      .test(source),

  defaultPortfolioRateMatchesApp:
    /p_max_portfolio_exposure_rate numeric default 0\.60/i
      .test(source),

  defaultSectorRateMatchesApp:
    /p_max_sector_exposure_rate numeric default 0\.25/i
      .test(source),

  sectorResolvedFromStocks:
    /from public\.stocks s[\s\S]{0,120}s\.stock_code = p_stock_code/i
      .test(source),

  guardBoundBeforeOrderInsert:
    source.indexOf(
      "perform public.assert_paper_buy_exposure_limits_v1("
    ) >= 0 &&
    source.indexOf(
      "perform public.assert_paper_buy_exposure_limits_v1("
    ) <
    source.lastIndexOf(
      "insert into public.paper_order_requests ("
    ),

  historicalDataRewriteAbsent:
    !/\bupdate\s+public\.paper_positions\b/i
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
          ? "AI_STOCK_LAB_PAPER_BUY_DB_EXPOSURE_DEFENSE_IN_DEPTH_V1_VERIFIED"
          : "AI_STOCK_LAB_PAPER_BUY_DB_EXPOSURE_DEFENSE_IN_DEPTH_V1_VERIFY_FAILED",

      migration:
        target
          ? "supabase/migrations/" +
            target
          : null,

      checks,
      failed,

      policy: {
        tickerExposureRate:
          0.10,

        portfolioExposureRate:
          0.60,

        sectorExposureRate:
          0.25,

        notionalBasis:
          "quantity * average_price for positions; unfilled quantity * entry_price for active BUY commitments",

        concurrency:
          "paper_accounts row FOR UPDATE serializes order-create exposure commitments per account",
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
          ? "SUPABASE_DB_PUSH_DRY_RUN_FOR_EXPOSURE_DEFENSE"
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
            "AI_STOCK_LAB_DB_EXPOSURE_DEFENSE_IN_DEPTH_V1_INSTALLED",

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

            accountLevelSerialization:
              true,

            tickerExposureDbGuard:
              true,

            portfolioExposureDbGuard:
              true,

            sectorExposureDbGuard:
              true,

            activePendingBuyExposureReserved:
              true,

            appPolicyAlignedDefaults: {
              maxPositionRate:
                0.10,

              maxPortfolioExposureRate:
                0.60,

              maxSectorExposureRate:
                0.25,
            },
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
