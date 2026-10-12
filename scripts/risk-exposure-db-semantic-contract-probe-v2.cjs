const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR =
  path.join(ROOT, "supabase", "migrations");

const FN =
  "create_paper_buy_order_with_committed_risk_v3";

function read(rel) {
  const full =
    path.join(ROOT, rel);

  return fs.existsSync(full)
    ? fs.readFileSync(full, "utf8")
    : "";
}

function extractLastFunction(source, fn) {
  const needle =
    "create or replace function public." +
    fn +
    "(";

  const start =
    source.lastIndexOf(needle);

  if (start < 0) return null;

  const bodyStart =
    source.indexOf("as $$", start);

  if (bodyStart < 0) return null;

  const end =
    source.indexOf("$$;", bodyStart + 5);

  if (end < 0) return null;

  return source.slice(start, end + 3);
}

const migrationFiles =
  fs.existsSync(MIG_DIR)
    ? fs.readdirSync(MIG_DIR)
        .filter((x) => x.endsWith(".sql"))
        .sort()
    : [];

const defs = [];

for (const name of migrationFiles) {
  const rel =
    "supabase/migrations/" + name;

  const src =
    read(rel);

  if (
    !src.includes(
      "create or replace function public." +
      FN +
      "("
    )
  ) {
    continue;
  }

  const block =
    extractLastFunction(src, FN);

  if (block) {
    defs.push({
      migration: rel,
      block,
    });
  }
}

const latest =
  defs.length
    ? defs[defs.length - 1]
    : null;

const fn =
  latest
    ? latest.block
    : "";

const riskManager =
  read("lib/trading/risk-manager.ts");

const policy =
  read("lib/trading/policy.ts");

const committedCaller =
  read("lib/trading/committed-risk-reservation.ts");

function has(re, text = fn) {
  return re.test(text);
}

function matchedLines(text, patterns, limit = 80) {
  const out = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    if (
      patterns.some(
        (p) => p.test(lines[i]),
      )
    ) {
      out.push({
        line: i + 1,
        text: lines[i].trim(),
      });

      if (out.length >= limit) {
        break;
      }
    }
  }

  return out;
}

/*
 * Exposure is NOT the same as open risk.
 *
 * Valid DB exposure enforcement must show:
 *   - notional amount semantics (quantity * price)
 *   - dimension-specific aggregation/filtering
 *   - an explicit policy threshold comparison
 *   - a fail-closed exception before order INSERT
 */

const semanticSignals = {
  functionFound:
    Boolean(latest),

  signatureContainsMaxPositionRate:
    has(/p_max_(position|stock|ticker)_.*rate/i),

  signatureContainsMaxPortfolioExposureRate:
    has(/p_max_portfolio_.*rate/i),

  signatureContainsMaxSectorExposureRate:
    has(/p_max_sector_.*rate/i),

  hasExplicitPositionLimitError:
    has(/POSITION_LIMIT_EXCEEDED/i),

  hasExplicitPortfolioLimitError:
    has(/PORTFOLIO_LIMIT_EXCEEDED/i),

  hasExplicitSectorLimitError:
    has(/SECTOR_LIMIT_EXCEEDED/i),

  positionNotionalFormula:
    has(
      /sum\s*\(\s*(?:coalesce\s*\(\s*)?(?:p\.)?quantity[\s\S]{0,120}\*[\s\S]{0,120}(?:average_price|entry_price|current_price)/i,
    ),

  portfolioNotionalFormula:
    has(
      /sum\s*\([\s\S]{0,180}(?:quantity[\s\S]{0,80}\*[\s\S]{0,80}(?:average_price|entry_price|current_price)|(?:average_price|entry_price|current_price)[\s\S]{0,80}\*[\s\S]{0,80}quantity)/i,
    ),

  currentStockFilter:
    has(
      /stock_code\s*=\s*p_stock_code/i,
    ),

  joinsStocksForSector:
    has(
      /join\s+public\.stocks/i,
    ) ||
    has(
      /from\s+public\.stocks/i,
    ),

  readsSector:
    has(/\bsector\b/i),

  comparesAgainstEquity:
    has(
      /p_equity[\s\S]{0,160}(?:max.*rate|0\.1|0\.25|0\.6)/i,
    ) ||
    has(
      /(?:max.*rate|0\.1|0\.25|0\.6)[\s\S]{0,160}p_equity/i,
    ),

  orderInsertPresent:
    has(
      /insert\s+into\s+public\.paper_order_requests/i,
    ),

  aggregateOpenRiskLogic:
    has(/reserved_risk_amount/i) &&
    has(/current_stop_price/i) &&
    has(/sum\s*\(/i),

  aggregateRiskRateParam:
    has(/p_max_aggregate_open_risk_rate/i),
};

const explicitThresholds = {
  position:
    has(
      /(?:current.*stock.*exposure|position.*exposure|stock.*notional)[\s\S]{0,300}p_equity[\s\S]{0,120}(?:max.*position|max.*stock|0\.1)/i,
    ) ||
    semanticSignals.hasExplicitPositionLimitError,

  portfolio:
    has(
      /(?:current.*invested|portfolio.*exposure|portfolio.*notional)[\s\S]{0,300}p_equity[\s\S]{0,120}(?:max.*portfolio|0\.6)/i,
    ) ||
    semanticSignals.hasExplicitPortfolioLimitError,

  sector:
    (
      semanticSignals.joinsStocksForSector &&
      semanticSignals.readsSector &&
      has(
        /(?:sector.*exposure|sector.*notional)[\s\S]{0,300}p_equity[\s\S]{0,120}(?:max.*sector|0\.25)/i,
      )
    ) ||
    semanticSignals.hasExplicitSectorLimitError,
};

const dimensions = {
  tickerExposure: {
    appGuard:
      /POSITION_LIMIT_EXCEEDED/.test(riskManager),

    dbGuard:
      Boolean(
        semanticSignals.positionNotionalFormula &&
        semanticSignals.currentStockFilter &&
        explicitThresholds.position
      ),
  },

  portfolioExposure: {
    appGuard:
      /PORTFOLIO_LIMIT_EXCEEDED/.test(riskManager),

    dbGuard:
      Boolean(
        semanticSignals.portfolioNotionalFormula &&
        explicitThresholds.portfolio
      ),
  },

  sectorExposure: {
    appGuard:
      /SECTOR_LIMIT_EXCEEDED/.test(riskManager),

    dbGuard:
      Boolean(
        semanticSignals.joinsStocksForSector &&
        semanticSignals.readsSector &&
        semanticSignals.portfolioNotionalFormula &&
        explicitThresholds.sector
      ),
  },
};

for (const item of Object.values(dimensions)) {
  item.classification =
    item.appGuard && item.dbGuard
      ? "APP_AND_DB_EXPOSURE_LIMIT_PROVEN"
      : item.appGuard
        ? "APP_ONLY_DB_EXPOSURE_LIMIT_NOT_PROVEN"
        : item.dbGuard
          ? "DB_ONLY_APP_LIMIT_NOT_PROVEN"
          : "EXPOSURE_LIMIT_NOT_PROVEN";
}

const missing =
  Object.entries(dimensions)
    .filter(([, v]) => !v.dbGuard)
    .map(([k]) => k);

const callerSignals = {
  invokesCommittedRiskV3:
    /create_paper_buy_order_with_committed_risk_v3/
      .test(committedCaller),

  passesMaxAggregateOpenRiskRate:
    /p_max_aggregate_open_risk_rate/
      .test(committedCaller),

  passesMaxPositionRate:
    /p_max_(position|stock|ticker)_.*rate/i
      .test(committedCaller),

  passesMaxPortfolioExposureRate:
    /p_max_portfolio_.*rate/i
      .test(committedCaller),

  passesMaxSectorExposureRate:
    /p_max_sector_.*rate/i
      .test(committedCaller),
};

const appPolicy = {
  maxPositionRate:
    (
      policy.match(
        /maxPositionRate\s*:\s*([0-9.]+)/,
      ) || []
    )[1] || null,

  maxPortfolioExposureRate:
    (
      policy.match(
        /maxPortfolioExposureRate\s*:\s*([0-9.]+)/,
      ) || []
    )[1] || null,

  maxSectorExposureRate:
    (
      policy.match(
        /maxSectorExposureRate\s*:\s*([0-9.]+)/,
      ) || []
    )[1] || null,
};

const verdict =
  missing.length === 0
    ? "DB_EXPOSURE_LIMITS_SEMANTICALLY_PROVEN"
    : "DB_EXPOSURE_LIMIT_GAP_CONFIRMED";

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_RISK_EXPOSURE_DB_SEMANTIC_CONTRACT_PROBE_V2_COMPLETE",

      classification:
        verdict,

      createOrderRpc: {
        function:
          FN,

        definitionCount:
          defs.length,

        latestMigration:
          latest
            ? latest.migration
            : null,

        semanticSignals,

        evidence:
          matchedLines(
            fn,
            [
              /create or replace function/i,
              /p_max_/i,
              /paper_positions/i,
              /paper_order_requests/i,
              /reserved_risk_amount/i,
              /average_price/i,
              /current_stop_price/i,
              /stock_code/i,
              /\bsector\b/i,
              /public\.stocks/i,
              /sum\s*\(/i,
              /POSITION_LIMIT_EXCEEDED/i,
              /PORTFOLIO_LIMIT_EXCEEDED/i,
              /SECTOR_LIMIT_EXCEEDED/i,
              /raise exception/i,
            ],
          ),
      },

      appPolicy,
      callerSignals,
      dimensions,

      missingDbExposureGuards:
        missing,

      interpretation:
        missing.length === 0
          ? "Ticker, portfolio and sector notional exposure limits are all explicitly enforced inside the DB order-create boundary."
          : "One or more application exposure limits are not explicitly revalidated at the DB order-create boundary. Aggregate open-risk logic is not accepted as proof of notional exposure enforcement.",

      safety: {
        sourceOnly: true,
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        productionChanged: false,
        realTradingEnabled: false,
      },

      nextGate:
        missing.length === 0
          ? "BUILD_DB_LEVEL_EXPOSURE_STRESS_FROM_PROVEN_LIMITS"
          : "BUILD_MINIMAL_DB_EXPOSURE_DEFENSE_IN_DEPTH_FOR_ALL_MISSING_DIMENSIONS",
    },
    null,
    2,
  ),
);
