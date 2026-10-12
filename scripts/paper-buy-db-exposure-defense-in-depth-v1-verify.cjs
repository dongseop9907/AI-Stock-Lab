const fs = require("fs");
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
